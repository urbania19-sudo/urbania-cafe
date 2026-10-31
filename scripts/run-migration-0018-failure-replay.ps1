# =============================================================================
# Urbania Cafe - Actual Migration 0018 Fail-Closed Abort Replay Harness
#
# Tests the actual migration file (202610280018_payment_reconciliation_hardening.sql)
# against seeded duplicate-bill fixtures in a genuinely isolated disposable Supabase container.
#
# Scenario:
# 1. Bootstraps disposable stack with migrations 0001 through 0015 applied.
# 2. Removes uniqueness constraint only inside this disposable environment.
# 3. Creates an order and two bills linked to it (ambiguous duplicate-bill fixture).
# 4. Applies migrations 0016 and 0017 successfully.
# 5. Executes the actual migration 0018 via Supabase CLI.
# 6. Verifies migration 0018 fails closed with URB:ambiguous_multiple_bills_detected.
# 7. Verifies transaction atomicity (no partial changes left on orders or bills).
# 8. Verifies migration 0018 is NOT recorded in schema_migrations.
# 9. Verifies persistent local database (54321) was completely untouched.
# 10. Automatically tears down all temporary containers and files.
# =============================================================================

[CmdletBinding()]
param(
    [switch]$KeepRunning
)

$ErrorActionPreference = "Stop"

# Strict 7-bit ASCII helpers
function Write-Step($msg) {
    Write-Host "`n=== [FAIL-CLOSED REPLAY] $msg ===" -ForegroundColor Cyan
}

function Write-Success($msg) {
    Write-Host "[OK] $msg" -ForegroundColor Green
}

function Write-Failure($msg) {
    Write-Host "[ERROR] $msg" -ForegroundColor Red
}

function Query-DisposableDb($sql) {
    $out = docker exec -i $DbContainerName psql -U postgres -d postgres -t -A -c $sql
    if ($out -is [array]) {
        return ($out -join "`n").Trim()
    } elseif ($null -ne $out) {
        return ([string]$out).Trim()
    }
    return ""
}

$RepoRoot = (Get-Item $PSScriptRoot).Parent.FullName
$ProjectId = "urbania-migration-fail-closed-env"
$ApiPort = 54441
$DbPort = 54442
$ShadowPort = 54440
$PoolerPort = 54449
$DbContainerName = "supabase_db_$ProjectId"
$DisposableDir = Join-Path ([System.IO.Path]::GetTempPath()) "urbania-migration-fail-closed-env"

Write-Step "Checking environment prerequisites..."

$dockerRunning = docker info 2>$null
if (-not $dockerRunning) {
    Write-Failure "Docker engine is not running. Please start Docker Desktop."
    exit 1
}
Write-Success "Docker engine is running."

function Test-PortAvailable($port) {
    $listener = $null
    try {
        $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $port)
        $listener.Start()
        return $true
    } catch {
        return $false
    } finally {
        if ($listener) { $listener.Stop() }
    }
}

$dedicatedPorts = @($ApiPort, $DbPort, $ShadowPort, $PoolerPort)
foreach ($p in $dedicatedPorts) {
    if (-not (Test-PortAvailable $p)) {
        Write-Failure "Port $p is already in use. Cannot launch isolated replay stack."
        exit 1
    }
}
Write-Success "All dedicated fail-closed replay ports ($ApiPort, $DbPort, $ShadowPort, $PoolerPort) are available."

Write-Step "Setting up isolated workspace with migrations 0001 through 0015..."

if (Test-Path $DisposableDir) {
    Remove-Item -Recurse -Force $DisposableDir -ErrorAction SilentlyContinue
}
New-Item -ItemType Directory -Path (Join-Path $DisposableDir "supabase\migrations") -Force | Out-Null

$migrationSource = Join-Path $RepoRoot "supabase\migrations"
$allMigrations = Get-ChildItem -Path "$migrationSource\*.sql" | Sort-Object Name
$phase1Migrations = $allMigrations | Where-Object { $_.Name -le "202610260015_z" }

Write-Host "Copying baseline migrations (count: $($phase1Migrations.Count))..."
foreach ($f in $phase1Migrations) {
    Copy-Item -Path $f.FullName -Destination (Join-Path $DisposableDir "supabase\migrations\$($f.Name)")
}

$seedSource = Join-Path $RepoRoot "supabase\seed.sql"
if (Test-Path $seedSource) {
    Copy-Item -Path $seedSource -Destination (Join-Path $DisposableDir "supabase\seed.sql")
    Write-Host "Copied baseline seed.sql."
}

$baseConfigPath = Join-Path $RepoRoot "supabase\config.toml"
$configText = Get-Content -Path $baseConfigPath -Raw

$configText = $configText -replace 'project_id\s*=\s*"[^"]*"', "project_id = `"$ProjectId`""
$configText = $configText -replace '(?m)^port\s*=\s*54321', "port = $ApiPort"
$configText = $configText -replace '(?m)^port\s*=\s*54322', "port = $DbPort"
$configText = $configText -replace '(?m)^shadow_port\s*=\s*54320', "shadow_port = $ShadowPort"
$configText = $configText -replace '(?m)^port\s*=\s*54329', "port = $PoolerPort"

$configText = $configText -replace '(?ms)(\[studio\]\s*\r?\n\s*enabled\s*=\s*)true', '${1}false'
$configText = $configText -replace '(?ms)(\[local_smtp\]\s*\r?\n\s*enabled\s*=\s*)true', '${1}false'
$configText = $configText -replace '(?ms)(\[inbucket\]\s*\r?\n\s*enabled\s*=\s*)true', '${1}false'
$configText = $configText -replace '(?ms)(\[analytics\]\s*\r?\n\s*enabled\s*=\s*)true', '${1}false'
$configText = $configText -replace '(?ms)(\[edge_runtime\]\s*\r?\n\s*enabled\s*=\s*)true', '${1}false'
$configText = $configText -replace '(?ms)(\[realtime\]\s*\r?\n\s*enabled\s*=\s*)true', '${1}false'

Set-Content -Path (Join-Path $DisposableDir "supabase\config.toml") -Value $configText -Encoding UTF8
Write-Success "Configuration created successfully."

$ReplayExitCode = 1

try {
    Write-Step "Starting disposable Supabase stack (applying migrations 0001-0015)..."
    npx supabase start --workdir $DisposableDir
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to start disposable Supabase container stack."
    }

    $appliedBaseline = docker exec -i $DbContainerName psql -U postgres -d postgres -t -A -c "SELECT count(*) FROM supabase_migrations.schema_migrations;"
    if ([int]$appliedBaseline.Trim() -ne 15) {
        throw "Expected 15 migrations applied in baseline, found: $appliedBaseline"
    }
    Write-Success "Baseline stack active on port $DbPort with 15 migrations recorded."

    Write-Step "Removing uniqueness constraint on bills(order_id) in disposable database..."
    docker exec -i $DbContainerName psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c @"
ALTER TABLE public.bills DROP CONSTRAINT IF EXISTS bills_order_id_key;
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_order_source_check;
ALTER TABLE public.bills DROP CONSTRAINT IF EXISTS bills_order_source_check;
"@
    Write-Success "Uniqueness constraint bills_order_id_key dropped in disposable database only."

    Write-Step "Inserting duplicate-bill test fixture..."
    $testOrderId = "88888888-8888-4888-8888-888888888888"
    $fixturePath = Join-Path $RepoRoot "supabase\tests\fixture-duplicate-bills.sql"
    $null = Get-Content $fixturePath -Raw | docker exec -i $DbContainerName psql -U postgres -d postgres -v ON_ERROR_STOP=1

    $dupBillCount = docker exec -i $DbContainerName psql -U postgres -d postgres -t -A -c "SELECT count(*) FROM public.bills WHERE order_id = '$testOrderId';"
    if ([int]$dupBillCount.Trim() -ne 2) {
        throw "Expected 2 duplicate bills for order $testOrderId, found: $dupBillCount"
    }
    Write-Success "Seeded test order 98801 with 2 associated bills (UB-DUP-01: issued, UB-DUP-02: cancelled)."

    Write-Step "Applying migrations 0016 and 0017..."
    $m16 = Join-Path $migrationSource "202610280016_operational_improvements.sql"
    $m17 = Join-Path $migrationSource "202610280017_offline_customer_payment_methods.sql"
    Copy-Item -Path $m16 -Destination (Join-Path $DisposableDir "supabase\migrations\202610280016_operational_improvements.sql")
    Copy-Item -Path $m17 -Destination (Join-Path $DisposableDir "supabase\migrations\202610280017_offline_customer_payment_methods.sql")

    npx supabase migration up --local --workdir $DisposableDir
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to apply migrations 0016 and 0017."
    }

    $count17 = docker exec -i $DbContainerName psql -U postgres -d postgres -t -A -c "SELECT count(*) FROM supabase_migrations.schema_migrations;"
    if ([int]$count17.Trim() -ne 17) {
        throw "Expected 17 migrations applied after 0017, found: $count17"
    }
    Write-Success "Migrations 0016 and 0017 applied successfully (recorded count: 17)."

    # =========================================================================
    # Capture comprehensive pre-0018 state to verify complete DDL & data rollback
    # =========================================================================
    Write-Step "Capturing baseline schema, constraint, trigger, and row state prior to migration 0018..."
    $preOrdersNullable = Query-DisposableDb "SELECT is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'payment_status';"
    $preBillsNullable = Query-DisposableDb "SELECT is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'bills' AND column_name = 'payment_status';"
    $preConstraints = Query-DisposableDb "SELECT conname || '::' || pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid IN ('public.orders'::regclass, 'public.bills'::regclass) AND conname LIKE '%payment_status%' ORDER BY conname;"
    $preTriggers = Query-DisposableDb "SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.customer_payments'::regclass AND NOT tgisinternal ORDER BY tgname;"
    $preOrderPayment = Query-DisposableDb "SELECT coalesce(payment_status, 'NULL') || '|' || paid_paise FROM public.orders WHERE id = '$testOrderId';"
    $preBillsPayment = Query-DisposableDb "SELECT bill_number || '::' || coalesce(payment_status, 'NULL') || '|' || paid_paise FROM public.bills WHERE order_id = '$testOrderId' ORDER BY bill_number;"
    $preLatestVersion = Query-DisposableDb "SELECT max(version) FROM supabase_migrations.schema_migrations;"

    Write-Host "Pre-0018 state captured:"
    Write-Host "  orders.payment_status nullable: $preOrdersNullable"
    Write-Host "  bills.payment_status nullable:  $preBillsNullable"
    Write-Host "  constraints:                    $preConstraints"
    Write-Host "  customer_payments triggers:     $(if ($preTriggers) { $preTriggers } else { '<none>' })"
    Write-Host "  order payment values:           $preOrderPayment"
    Write-Host "  bills payment values:           $preBillsPayment"
    Write-Host "  latest migration version:       $preLatestVersion"

    if ($preOrderPayment -ne "unpaid|0" -or $preLatestVersion -ne "202610280017") {
        throw "Unexpected pre-0018 baseline state: Order=$preOrderPayment, Version=$preLatestVersion"
    }

    Write-Step "Copying actual migration 0018 and executing against duplicate-bill fixture..."
    $m18 = Join-Path $migrationSource "202610280018_payment_reconciliation_hardening.sql"
    Copy-Item -Path $m18 -Destination (Join-Path $DisposableDir "supabase\migrations\202610280018_payment_reconciliation_hardening.sql")

    # Execute actual migration 0018 via Supabase CLI wrapped in cmd /c to capture stderr safely
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $cliOutput = (& cmd.exe /c "npx supabase migration up --local --workdir ""$DisposableDir"" 2>&1") | Out-String
    $cliExitCode = $LASTEXITCODE
    $ErrorActionPreference = $prevEap

    Write-Host "Migration 0018 execution exit code: $cliExitCode"

    if ($cliExitCode -eq 0) {
        throw "CRITICAL FAILURE: Actual migration 0018 succeeded when duplicate bills were present! Expected fail-closed abort."
    }

    if ($cliOutput -notmatch "URB:ambiguous_multiple_bills_detected") {
        throw "CRITICAL FAILURE: Migration 0018 failed but did NOT output URB:ambiguous_multiple_bills_detected. Output was:`n$cliOutput"
    }
    Write-Success "Actual migration 0018 FAILED CLOSED as expected with 'URB:ambiguous_multiple_bills_detected'!"

    # =========================================================================
    # Verify comprehensive rollback assertions (all properties unchanged)
    # =========================================================================
    Write-Step "Verifying full DDL, constraint, trigger, and data rollback assertions..."

    # 1. orders.payment_status nullability
    $postOrdersNullable = Query-DisposableDb "SELECT is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'payment_status';"
    if ($postOrdersNullable -ne $preOrdersNullable) {
        throw "DDL rollback violation: orders.payment_status nullability altered! (Pre: $preOrdersNullable, Post: $postOrdersNullable)"
    }
    Write-Success "Confirmed: orders.payment_status nullability unchanged ($postOrdersNullable)."

    # 2. bills.payment_status nullability
    $postBillsNullable = Query-DisposableDb "SELECT is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'bills' AND column_name = 'payment_status';"
    if ($postBillsNullable -ne $preBillsNullable) {
        throw "DDL rollback violation: bills.payment_status nullability altered! (Pre: $preBillsNullable, Post: $postBillsNullable)"
    }
    Write-Success "Confirmed: bills.payment_status nullability unchanged ($postBillsNullable)."

    # 3. Check constraints
    $postConstraints = Query-DisposableDb "SELECT conname || '::' || pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid IN ('public.orders'::regclass, 'public.bills'::regclass) AND conname LIKE '%payment_status%' ORDER BY conname;"
    if ($postConstraints -ne $preConstraints) {
        throw "DDL rollback violation: Payment-status check constraints altered! (Pre: $preConstraints, Post: $postConstraints)"
    }
    Write-Success "Confirmed: Payment-status check constraints unchanged."

    # 4. Triggers on customer_payments
    $postTriggers = Query-DisposableDb "SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.customer_payments'::regclass AND NOT tgisinternal ORDER BY tgname;"
    if ($postTriggers -ne $preTriggers) {
        throw "DDL rollback violation: Triggers on customer_payments altered! (Pre: $preTriggers, Post: $postTriggers)"
    }
    $triggerExists = Query-DisposableDb "SELECT count(*) FROM pg_trigger WHERE tgname = 'customer_payments_immutable';"
    if ([int]$triggerExists -ne 0) {
        throw "Atomicity violation: customer_payments_immutable trigger was installed despite migration abort!"
    }
    Write-Success "Confirmed: customer_payments triggers unchanged; customer_payments_immutable was NOT installed."

    # 5. Order payment values
    $postOrderPayment = Query-DisposableDb "SELECT coalesce(payment_status, 'NULL') || '|' || paid_paise FROM public.orders WHERE id = '$testOrderId';"
    if ($postOrderPayment -ne $preOrderPayment) {
        throw "Data rollback violation: Order payment state altered! (Pre: $preOrderPayment, Post: $postOrderPayment)"
    }
    Write-Success "Confirmed: Order payment values unchanged ($postOrderPayment)."

    # 6. Bills payment values
    $postBillsPayment = Query-DisposableDb "SELECT bill_number || '::' || coalesce(payment_status, 'NULL') || '|' || paid_paise FROM public.bills WHERE order_id = '$testOrderId' ORDER BY bill_number;"
    if ($postBillsPayment -ne $preBillsPayment) {
        throw "Data rollback violation: Bills payment state altered! (Pre: $preBillsPayment, Post: $postBillsPayment)"
    }
    Write-Success "Confirmed: Bills payment values unchanged ($postBillsPayment)."

    # 7. Migration history tracking
    Write-Step "Verifying migration 0018 is absent from schema_migrations..."
    $m18Recorded = Query-DisposableDb "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '202610280018';"
    $postLatestVersion = Query-DisposableDb "SELECT max(version) FROM supabase_migrations.schema_migrations;"
    
    if ([int]$m18Recorded -ne 0) {
        throw "Migration tracking violation: Migration 0018 is recorded in schema_migrations despite aborting!"
    }
    if ($postLatestVersion -ne $preLatestVersion) {
        throw "Migration tracking violation: Latest version is $postLatestVersion, expected $preLatestVersion."
    }
    Write-Success "Confirmed: Migration 0018 is absent from schema_migrations. Latest applied version remains: $postLatestVersion."

    # =========================================================================
    # Explicit persistent local database isolation verification
    # =========================================================================
    Write-Step "Verifying persistent local database isolation..."
    $persistentContainerName = "supabase_db_urbania-cafe-nextjs-port"
    $persistentRunning = docker ps --filter "name=^/${persistentContainerName}$" --filter "status=running" --format "{{.Names}}"

    if (-not $persistentRunning -or $persistentRunning.Trim() -ne $persistentContainerName) {
        Write-Failure "ISOLATION VERIFICATION BLOCKED: Expected persistent local container '$persistentContainerName' is not running or unreachable."
        throw "ISOLATION VERIFICATION BLOCKED: Persistent local container '$persistentContainerName' is not running."
    }

    $persistentCheck = docker exec -i $persistentContainerName psql -U postgres -d postgres -v ON_ERROR_STOP=1 -t -A -c "SELECT count(*) FROM public.orders WHERE order_number = 98801;" 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Failure "ISOLATION VERIFICATION BLOCKED: Read-only query execution failed on persistent container '$persistentContainerName': $persistentCheck"
        throw "ISOLATION VERIFICATION BLOCKED: Read-only query execution failed on persistent container."
    }

    $persistentCount = [int]$persistentCheck.Trim()
    if ($persistentCount -ne 0) {
        throw "Isolation violation: Test order 98801 found on persistent local database (found $persistentCount rows)!"
    }
    Write-Success "Confirmed: Persistent local database '$persistentContainerName' was reached and is completely untouched (test order count = 0)."

    $ReplayExitCode = 0
    Write-Step "MIGRATION 0018 FAIL-CLOSED ABORT REPLAY COMPLETED SUCCESSFULLY!"

} catch {
    Write-Failure "Fail-closed migration replay failed: $_"
    $ReplayExitCode = 1
} finally {
    if (-not $KeepRunning) {
        Write-Step "Tearing down disposable fail-closed replay stack..."
        npx supabase stop --workdir $DisposableDir --no-backup 2>$null | Out-Null
        $lingering = docker ps -aq --filter "name=$ProjectId"
        if ($lingering) {
            docker rm -f $lingering 2>$null | Out-Null
        }
        $lingeringNetworks = docker network ls -q --filter "name=$ProjectId"
        if ($lingeringNetworks) {
            docker network rm $lingeringNetworks 2>$null | Out-Null
        }
        $lingeringVolumes = docker volume ls -q --filter "name=$ProjectId"
        if ($lingeringVolumes) {
            docker volume rm $lingeringVolumes 2>$null | Out-Null
        }
        if (Test-Path $DisposableDir) {
            Remove-Item -Recurse -Force $DisposableDir -ErrorAction SilentlyContinue
        }
        Write-Success "Disposable fail-closed stack, networks, volumes, and workspace destroyed cleanly without touching unrelated Docker resources."
    }
}

exit $ReplayExitCode
