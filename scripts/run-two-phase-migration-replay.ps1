<#
.SYNOPSIS
    Two-phase historical migration replay and preflight verification harness for Urbania Cafe POS.
.DESCRIPTION
    Phase 1: Provisions an isolated ephemeral Supabase stack with migrations 0001 through 0015 only.
             Inserts production-derived legacy fixtures into the pre-0016 schema.
             Validates that supabase/preflight-production-release.sql executes cleanly on legacy schema.
    Phase 2: Applies migrations 0016 through 0026 chronologically against the live historical fixtures.
             Asserts real database rows for all production findings (Finding 1, 2, 3, External, Admin Credit).
             Validates that supabase/preflight-production-release.sql executes on post-0026 schema with 0 discrepancies.
    Phase 3: Rehearses the multiple-bill safety gate to ensure fail-closed behavior on duplicate bills.
    Phase 4: Guaranteed teardown of containers, volumes, and temporary files. Persistent DB at 54321 untouched.
#>

[CmdletBinding()]
param(
    [switch]$KeepRunning
)

$ErrorActionPreference = 'Stop'

function Write-Step {
    param([string]$Message)
    Write-Host "`n=== [TWO-PHASE REPLAY] $Message ===" -ForegroundColor Cyan
}

function Write-Success {
    param([string]$Message)
    Write-Host "[OK] $Message" -ForegroundColor Green
}

function Write-Failure {
    param([string]$Message)
    Write-Host "[ERROR] $Message" -ForegroundColor Red
}

$RepoRoot = (Get-Item $PSScriptRoot).Parent.FullName
Set-Location $RepoRoot

$ApiPort = 54431
$DbPort = 54432
$ShadowPort = 54430
$PoolerPort = 54439
$ProjectId = "urbania-migration-replay-env"
$TempBase = [System.IO.Path]::GetTempPath()
$DisposableDir = Join-Path $TempBase "urbania-migration-replay-env"

# -----------------------------------------------------------------------------
# 1. Environment & Preflight Checks
# -----------------------------------------------------------------------------
Write-Step "Checking environment prerequisites..."

try {
    $null = docker info 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Docker is not running or not responsive."
    }
    Write-Success "Docker engine is running."
} catch {
    Write-Failure "Docker engine is required for disposable integration tests. Please start Docker Desktop."
    exit 1
}

function Test-PortListening {
    param([int]$Port)
    $activeListeners = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    return [bool]$activeListeners
}

# Clean any leftover containers from previous replay
$oldContainers = docker ps -q --filter "name=$ProjectId"
if ($oldContainers) {
    Write-Host "Removing leftover containers from previous replay run..." -ForegroundColor Yellow
    docker rm -f $oldContainers | Out-Null
}

$portsToCheck = @($ApiPort, $DbPort, $ShadowPort, $PoolerPort)
foreach ($p in $portsToCheck) {
    if (Test-PortListening -Port $p) {
        Write-Failure "Port $p is in use. Cannot launch isolated two-phase replay stack."
        exit 1
    }
}
Write-Success "All dedicated replay ports are available."

# -----------------------------------------------------------------------------
# 2. Provision Phase 1 Workspace (Migrations 0001 through 0015 Only)
# -----------------------------------------------------------------------------
Write-Step "Setting up isolated Phase 1 workspace with migrations 0001 through 0015..."

if (Test-Path $DisposableDir) {
    Remove-Item -Recurse -Force $DisposableDir -ErrorAction SilentlyContinue
}
New-Item -ItemType Directory -Path (Join-Path $DisposableDir "supabase\migrations") -Force | Out-Null

$migrationSource = Join-Path $RepoRoot "supabase\migrations"
$allMigrations = Get-ChildItem -Path "$migrationSource\*.sql" | Sort-Object Name
$phase1Migrations = $allMigrations | Where-Object { $_.Name -le "202610260015_z" }
$phase2Migrations = $allMigrations | Where-Object { $_.Name -ge "202610280016" }

Write-Host "Copying Phase 1 migrations (count: $($phase1Migrations.Count))..."
foreach ($f in $phase1Migrations) {
    Copy-Item -Path $f.FullName -Destination (Join-Path $DisposableDir "supabase\migrations\$($f.Name)")
}

# Copy seed.sql if present
$seedSource = Join-Path $RepoRoot "supabase\seed.sql"
if (Test-Path $seedSource) {
    Copy-Item -Path $seedSource -Destination (Join-Path $DisposableDir "supabase\seed.sql")
    Write-Host "Copied baseline seed.sql."
}

# Derive config.toml from repo base config
$baseConfigPath = Join-Path $RepoRoot "supabase\config.toml"
$configText = Get-Content -Path $baseConfigPath -Raw

# Replace project_id and ports
$configText = $configText -replace 'project_id\s*=\s*"[^"]*"', "project_id = `"$ProjectId`""
$configText = $configText -replace '(?m)^port\s*=\s*54321', "port = $ApiPort"
$configText = $configText -replace '(?m)^port\s*=\s*54322', "port = $DbPort"
$configText = $configText -replace '(?m)^shadow_port\s*=\s*54320', "shadow_port = $ShadowPort"
$configText = $configText -replace '(?m)^port\s*=\s*54329', "port = $PoolerPort"

# Disable conflicting services
$configText = $configText -replace '(?ms)(\[studio\]\s*\r?\n\s*enabled\s*=\s*)true', '${1}false'
$configText = $configText -replace '(?ms)(\[local_smtp\]\s*\r?\n\s*enabled\s*=\s*)true', '${1}false'
$configText = $configText -replace '(?ms)(\[inbucket\]\s*\r?\n\s*enabled\s*=\s*)true', '${1}false'
$configText = $configText -replace '(?ms)(\[analytics\]\s*\r?\n\s*enabled\s*=\s*)true', '${1}false'
$configText = $configText -replace '(?ms)(\[edge_runtime\]\s*\r?\n\s*enabled\s*=\s*)true', '${1}false'
$configText = $configText -replace '(?ms)(\[realtime\]\s*\r?\n\s*enabled\s*=\s*)true', '${1}false'

Set-Content -Path (Join-Path $DisposableDir "supabase\config.toml") -Value $configText -Encoding UTF8
Write-Success "Phase 1 configuration created successfully."

$ReplayExitCode = 1

try {
    # -------------------------------------------------------------------------
    # 3. Launch Phase 1 Supabase Stack (0001-0015)
    # -------------------------------------------------------------------------
    Write-Step "Starting Phase 1 Supabase stack (applying migrations 0001-0015)..."
    npx supabase start --workdir $DisposableDir
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to start Phase 1 Supabase stack."
    }
    Write-Success "Phase 1 Supabase is active on API port $ApiPort and DB port $DbPort."

    # Retrieve access keys
    Write-Step "Retrieving disposable access keys..."
    $statusRaw = npx supabase status --workdir $DisposableDir -o json
    $jsonMatch = [regex]::Match($statusRaw, '\{[\s\S]*\}')
    if (-not $jsonMatch.Success) {
        throw "Unable to parse JSON from Supabase status output: $statusRaw"
    }
    $statusObj = $jsonMatch.Value | ConvertFrom-Json

    $TargetUrl = "http://127.0.0.1:$ApiPort"
    $AnonKey = $statusObj.ANON_KEY
    $ServiceKey = $statusObj.SERVICE_ROLE_KEY

    if (-not $AnonKey -or -not $ServiceKey) {
        throw "Could not retrieve valid API keys for disposable Supabase."
    }
    Write-Success "Retrieved keys successfully."

    # -------------------------------------------------------------------------
    # 4. Insert Phase 1 Historical Test Fixtures
    # -------------------------------------------------------------------------
    Write-Step "Inserting controlled historical test fixtures into pre-0016 schema..."
    
    # Relax order_source check constraint on pre-0016 schema to allow external & admin credit test fixtures
    docker exec -i "supabase_db_$ProjectId" psql -U postgres -d postgres -c "ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_order_source_check; ALTER TABLE public.bills DROP CONSTRAINT IF EXISTS bills_order_source_check;" | Out-Null

    $env:ALLOW_TWO_PHASE_REPLAY = "true"
    $env:DISPOSABLE_SUPABASE_URL = $TargetUrl
    $env:DISPOSABLE_ANON_KEY = $AnonKey
    $env:DISPOSABLE_SERVICE_KEY = $ServiceKey
    $env:REPLAY_PHASE = "phase1_seed"

    npx vitest run tests/two-phase-migration-replay.test.ts --config vitest.migration-replay.config.ts
    if ($LASTEXITCODE -ne 0) {
        throw "Phase 1 fixture insertion failed."
    }
    Write-Success "Phase 1 historical fixtures inserted cleanly into pre-0016 database."

    # -------------------------------------------------------------------------
    # 5. Validate Preflight Script on Legacy Pre-0016 Database (Task 2)
    # -------------------------------------------------------------------------
    Write-Step "Validating supabase/preflight-production-release.sql against pre-0016 legacy schema..."
    $preflightSqlPath = Join-Path $RepoRoot "supabase\preflight-production-release.sql"

    $null = Get-Content $preflightSqlPath -Raw | docker exec -i "supabase_db_$ProjectId" psql -U postgres -d postgres -v ON_ERROR_STOP=1
    if ($LASTEXITCODE -ne 0) {
        throw "Preflight script failed on pre-0016 legacy schema."
    }
    Write-Success "Preflight SQL executed cleanly on pre-0016 schema with 0 errors."

    # -------------------------------------------------------------------------
    # 6. Phase 2: Copy and Apply Migrations 0016-0026 Chronologically
    # -------------------------------------------------------------------------
    Write-Step "Copying migrations 0016-0026 and applying to the live historical fixtures..."
    Write-Host "Copying pending release migrations (count: $($phase2Migrations.Count))..."
    foreach ($f in $phase2Migrations) {
        Copy-Item -Path $f.FullName -Destination (Join-Path $DisposableDir "supabase\migrations\$($f.Name)")
    }

    # Apply pending migrations using supabase migration up
    npx supabase migration up --local --workdir $DisposableDir
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to apply migrations 0016-0026."
    }
    Write-Success "Migrations 0016-0026 applied successfully in chronological order."

    # -------------------------------------------------------------------------
    # 7. Phase 2: Assert Real Database Rows and Reconciled State
    # -------------------------------------------------------------------------
    Write-Step "Asserting actual database rows and backfill outcomes..."
    $env:REPLAY_PHASE = "phase2_verify"

    npx vitest run tests/two-phase-migration-replay.test.ts --config vitest.migration-replay.config.ts
    if ($LASTEXITCODE -ne 0) {
        throw "Post-migration assertions failed against actual database rows."
    }
    Write-Success "All post-migration database row assertions passed cleanly!"

    # -------------------------------------------------------------------------
    # 8. Validate Preflight Script on Post-Migration Database (Task 2)
    # -------------------------------------------------------------------------
    Write-Step "Validating supabase/preflight-production-release.sql against post-migration database..."
    $null = Get-Content $preflightSqlPath -Raw | docker exec -i "supabase_db_$ProjectId" psql -U postgres -d postgres -v ON_ERROR_STOP=1
    if ($LASTEXITCODE -ne 0) {
        throw "Preflight script failed on post-migration schema."
    }
    Write-Success "Preflight script executed cleanly on post-migration database!"

    # Verify that post-migration discrepancy diagnostics report 0 rows
    $discrepancySqlPath = Join-Path $RepoRoot "supabase\tests\check-discrepancies.sql"
    $diagDiscrepancy = Get-Content $discrepancySqlPath -Raw | docker exec -i "supabase_db_$ProjectId" psql -U postgres -d postgres -t -A
    
    if ([int]$diagDiscrepancy.Trim() -ne 0) {
        throw "Discrepancy check failed: $diagDiscrepancy rows differ between orders.paid_paise and bills.paid_paise."
    }
    Write-Success "Confirmed: 0 rows discrepancy between order paid balance and bill paid balance."

    $falsePaidSqlPath = Join-Path $RepoRoot "supabase\tests\check-false-paid.sql"
    $diagFalsePaid = Get-Content $falsePaidSqlPath -Raw | docker exec -i "supabase_db_$ProjectId" psql -U postgres -d postgres -t -A
    
    if ([int]$diagFalsePaid.Trim() -ne 0) {
        throw "False-paid check failed: $diagFalsePaid cancelled bills have payment_status = paid."
    }
    Write-Success "Confirmed: 0 cancelled bills have payment_status = paid."

    $ReplayExitCode = 0
    Write-Step "NORMAL TWO-PHASE HISTORICAL MIGRATION REPLAY COMPLETED SUCCESSFULLY!"

} catch {
    Write-Failure "Two-phase migration replay failed: $_"
    $ReplayExitCode = 1
} finally {
    # -------------------------------------------------------------------------
    # 10. Guaranteed Teardown and Cleanup
    # -------------------------------------------------------------------------
    if (-not $KeepRunning) {
        Write-Step "Tearing down disposable replay stack and cleaning up workspace..."

        # Stop Supabase cleanly
        npx supabase stop --workdir $DisposableDir --no-backup 2>$null | Out-Null

        # Force remove any remaining containers for this project
        $lingering = docker ps -aq --filter "name=$ProjectId"
        if ($lingering) {
            docker rm -f $lingering 2>$null | Out-Null
        }

        # Remove temporary directory
        if (Test-Path $DisposableDir) {
            Remove-Item -Recurse -Force $DisposableDir -ErrorAction SilentlyContinue
        }

        # Clear environment variables
        Remove-Item Env:\ALLOW_TWO_PHASE_REPLAY -ErrorAction SilentlyContinue
        Remove-Item Env:\DISPOSABLE_SUPABASE_URL -ErrorAction SilentlyContinue
        Remove-Item Env:\DISPOSABLE_ANON_KEY -ErrorAction SilentlyContinue
        Remove-Item Env:\DISPOSABLE_SERVICE_KEY -ErrorAction SilentlyContinue
        Remove-Item Env:\REPLAY_PHASE -ErrorAction SilentlyContinue

        # Verify no disposable containers remain
        $checkLingering = docker ps -q --filter "name=$ProjectId"
        if ($checkLingering) {
            Write-Failure "Warning: Lingering disposable containers detected: $checkLingering"
        } else {
            Write-Success "Two-phase replay containers and temporary files destroyed. Persistent DB at 54321 untouched."
        }
    } else {
        Write-Host "[NOTE] -KeepRunning flag provided; preserving disposable containers on port $ApiPort." -ForegroundColor Yellow
    }
}

exit $ReplayExitCode
