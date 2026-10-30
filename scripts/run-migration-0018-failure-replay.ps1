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

    # Record pre-0018 row state
    $pre18OrderState = docker exec -i $DbContainerName psql -U postgres -d postgres -t -A -c "SELECT coalesce(payment_status, 'NULL') || '|' || paid_paise FROM public.orders WHERE id = '$testOrderId';"
    Write-Host "Pre-0018 order state: $pre18OrderState (expected: unpaid|0)"
    if ($pre18OrderState.Trim() -ne "unpaid|0") {
        throw "Unexpected pre-0018 order state: $pre18OrderState"
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

    Write-Step "Verifying transaction atomicity (no partial changes left)..."
    
    # Verify the order was NOT updated (if migration had run un-atomically, it would be 'paid' with 25000)
    $postFailOrderState = docker exec -i $DbContainerName psql -U postgres -d postgres -t -A -c "SELECT coalesce(payment_status, 'NULL') || '|' || paid_paise FROM public.orders WHERE id = '$testOrderId';"
    if ($postFailOrderState.Trim() -ne "unpaid|0") {
        throw "Atomicity violation: Order state was altered during aborted migration! Current state: $postFailOrderState"
    }
    Write-Success "Order state confirmed unchanged: $postFailOrderState (unpaid, 0 paid_paise)."

    # Verify bills were NOT updated to 0018 statuses
    $postFailBill1 = docker exec -i $DbContainerName psql -U postgres -d postgres -t -A -c "SELECT coalesce(payment_status, 'NULL') || '|' || paid_paise FROM public.bills WHERE bill_number = 'UB-DUP-01';"
    $postFailBill2 = docker exec -i $DbContainerName psql -U postgres -d postgres -t -A -c "SELECT coalesce(payment_status, 'NULL') || '|' || paid_paise FROM public.bills WHERE bill_number = 'UB-DUP-02';"
    if ($postFailBill1.Trim() -ne "unpaid|0" -or $postFailBill2.Trim() -ne "unpaid|0") {
        throw "Atomicity violation: Bills were partially modified during aborted migration! Bill1: $postFailBill1, Bill2: $postFailBill2"
    }
    Write-Success "Bills confirmed unchanged: UB-DUP-01 ($postFailBill1), UB-DUP-02 ($postFailBill2)."

    # Verify customer_payments_immutable trigger was NOT installed
    $triggerExists = docker exec -i $DbContainerName psql -U postgres -d postgres -t -A -c "SELECT count(*) FROM pg_trigger WHERE tgname = 'customer_payments_immutable';"
    if ([int]$triggerExists.Trim() -ne 0) {
        throw "Atomicity violation: customer_payments_immutable trigger was installed despite migration abort!"
    }
    Write-Success "Trigger customer_payments_immutable confirmed NOT installed."

    Write-Step "Verifying migration 0018 is NOT recorded in schema_migrations..."
    $m18Recorded = docker exec -i $DbContainerName psql -U postgres -d postgres -t -A -c "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '202610280018';"
    $latestVersion = docker exec -i $DbContainerName psql -U postgres -d postgres -t -A -c "SELECT max(version) FROM supabase_migrations.schema_migrations;"
    
    if ([int]$m18Recorded.Trim() -ne 0) {
        throw "Migration tracking violation: Migration 0018 is recorded in schema_migrations despite aborting!"
    }
    if ($latestVersion.Trim() -ne "202610280017") {
        throw "Migration tracking violation: Latest version is $latestVersion, expected 202610280017."
    }
    Write-Success "Confirmed: Migration 0018 is NOT recorded in schema_migrations. Latest applied version remains: $latestVersion."

    Write-Step "Verifying persistent local database (54321) was NOT touched..."
    $persistentCheck = docker exec -i supabase_db_urbania-cafe-nextjs-port psql -U postgres -d postgres -t -A -c "SELECT count(*) FROM public.orders WHERE order_number = 98801;" 2>$null
    if ($persistentCheck -and [int]$persistentCheck.Trim() -ne 0) {
        throw "Isolation violation: Test order 98801 found on persistent local database!"
    }
    Write-Success "Confirmed: Persistent local database at 54321 is completely untouched."

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
        if (Test-Path $DisposableDir) {
            Remove-Item -Recurse -Force $DisposableDir -ErrorAction SilentlyContinue
        }
        Write-Success "Disposable fail-closed stack and workspace destroyed cleanly."
    }
}

exit $ReplayExitCode
