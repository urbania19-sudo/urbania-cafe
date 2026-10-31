<#
.SYNOPSIS
    Repeatable, fully isolated, disposable financial integration test runner for Urbania Café POS.
.DESCRIPTION
    Provisions a 100% ephemeral local Supabase instance in Docker on dedicated non-conflicting
    ports (API: 54421, DB: 54422), applies all chronological migrations from scratch (0001 through 0027),
    runs tests/financial-workflow-integration.test.ts, and unconditionally tears down all containers,
    volumes, and temporary files.

    Strict Safety Invariants:
    - Never targets or modifies production Supabase.
    - Never targets, modifies, resets, or touches the persistent local Supabase database at 127.0.0.1:54321.
    - Fails closed if Docker is not running or if port collisions occur.
    - Cleans up ephemeral containers and volumes in a finally block regardless of test pass/fail.
#>

[CmdletBinding()]
param(
    [switch]$KeepRunning
)

$ErrorActionPreference = 'Stop'

function Write-Step {
    param([string]$Message)
    Write-Host "`n=== [DISPOSABLE INTEGRATION] $Message ===" -ForegroundColor Cyan
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

$ApiPort = 54421
$DbPort = 54422
$ShadowPort = 54420
$PoolerPort = 54429
$ProjectId = "urbania-disposable-env"
$TempBase = [System.IO.Path]::GetTempPath()
$DisposableDir = Join-Path $TempBase "urbania-disposable-env"

# -----------------------------------------------------------------------------
# 1. Environment & Preflight Checks
# -----------------------------------------------------------------------------
Write-Step "Checking environment prerequisites..."

# Check Docker is running
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

# Verify persistent instance (54321) is NOT targeted
if ($env:SUPABASE_URL -match ":54321" -and -not $env:ALLOW_DISPOSABLE_FINANCIAL_INTEGRATION) {
    Write-Host "Persistent development Supabase detected on port 54321. Ensuring complete isolation..." -ForegroundColor Yellow
}

# Check for port collisions on dedicated disposable ports
function Test-PortListening {
    param([int]$Port)
    $activeListeners = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    return [bool]$activeListeners
}

# Check if old disposable containers are running; if so, clean them before checking ports
$oldContainers = docker ps -q --filter "name=$ProjectId"
if ($oldContainers) {
    Write-Host "Removing leftover disposable containers from previous run..." -ForegroundColor Yellow
    docker rm -f $oldContainers | Out-Null
}

$portsToCheck = @($ApiPort, $DbPort, $ShadowPort, $PoolerPort)
foreach ($p in $portsToCheck) {
    if (Test-PortListening -Port $p) {
        Write-Failure "Port $p is already in use by another process. Cannot safely launch isolated disposable Supabase."
        exit 1
    }
}
Write-Success "All dedicated disposable ports ($ApiPort, $DbPort, $ShadowPort, $PoolerPort) are available."

# -----------------------------------------------------------------------------
# 2. Provision Disposable Workspace
# -----------------------------------------------------------------------------
Write-Step "Setting up isolated workspace at $DisposableDir..."

if (Test-Path $DisposableDir) {
    Remove-Item -Recurse -Force $DisposableDir -ErrorAction SilentlyContinue
}
New-Item -ItemType Directory -Path (Join-Path $DisposableDir "supabase\migrations") -Force | Out-Null

# Copy all chronological migrations
$migrationSource = Join-Path $RepoRoot "supabase\migrations"
$migrationFiles = Get-ChildItem -Path "$migrationSource\*.sql" | Sort-Object Name
Write-Host "Copying $($migrationFiles.Count) migrations (0001 through 0027)..."
Copy-Item -Path "$migrationSource\*.sql" -Destination (Join-Path $DisposableDir "supabase\migrations")

# Copy seed.sql if present
$seedSource = Join-Path $RepoRoot "supabase\seed.sql"
if (Test-Path $seedSource) {
    Copy-Item -Path $seedSource -Destination (Join-Path $DisposableDir "supabase\seed.sql")
    Write-Host "Copied baseline seed.sql."
}

# Derive config.toml from repo's base config to ensure all required schemas (storage, etc.) exist
$baseConfigPath = Join-Path $RepoRoot "supabase\config.toml"
$configText = Get-Content -Path $baseConfigPath -Raw

# Replace project_id and ports
$configText = $configText -replace 'project_id\s*=\s*"[^"]*"', "project_id = `"$ProjectId`""
$configText = $configText -replace '(?m)^port\s*=\s*54321', "port = $ApiPort"
$configText = $configText -replace '(?m)^port\s*=\s*54322', "port = $DbPort"
$configText = $configText -replace '(?m)^shadow_port\s*=\s*54320', "shadow_port = $ShadowPort"
$configText = $configText -replace '(?m)^port\s*=\s*54329', "port = $PoolerPort"

# Disable services that bind host ports conflicting with the persistent dev instance
$configText = $configText -replace '(?ms)(\[studio\]\s*\r?\n\s*enabled\s*=\s*)true', '${1}false'
$configText = $configText -replace '(?ms)(\[local_smtp\]\s*\r?\n\s*enabled\s*=\s*)true', '${1}false'
$configText = $configText -replace '(?ms)(\[inbucket\]\s*\r?\n\s*enabled\s*=\s*)true', '${1}false'
$configText = $configText -replace '(?ms)(\[analytics\]\s*\r?\n\s*enabled\s*=\s*)true', '${1}false'
$configText = $configText -replace '(?ms)(\[edge_runtime\]\s*\r?\n\s*enabled\s*=\s*)true', '${1}false'
$configText = $configText -replace '(?ms)(\[realtime\]\s*\r?\n\s*enabled\s*=\s*)true', '${1}false'

Set-Content -Path (Join-Path $DisposableDir "supabase\config.toml") -Value $configText -Encoding UTF8
Write-Success "Disposable configuration created successfully."

$TestExitCode = 1

try {
    # -------------------------------------------------------------------------
    # 3. Launch Disposable Supabase Instance
    # -------------------------------------------------------------------------
    Write-Step "Starting disposable Supabase container stack..."
    npx supabase start --workdir $DisposableDir
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to start disposable Supabase stack."
    }
    Write-Success "Disposable Supabase is up on API port $ApiPort and DB port $DbPort."

    # Retrieve keys from status output
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
    # 4. Execute Financial Integration Tests
    # -------------------------------------------------------------------------
    Write-Step "Executing tests/financial-workflow-integration.test.ts against disposable instance..."
    $env:ALLOW_DISPOSABLE_FINANCIAL_INTEGRATION = "true"
    $env:DISPOSABLE_CONTAINER_LIFECYCLE = "true"
    $env:DISPOSABLE_SUPABASE_URL = $TargetUrl
    $env:DISPOSABLE_ANON_KEY = $AnonKey
    $env:DISPOSABLE_SERVICE_KEY = $ServiceKey

    npx vitest run tests/financial-workflow-integration.test.ts --config vitest.integration.config.ts
    $TestExitCode = $LASTEXITCODE

    if ($TestExitCode -eq 0) {
        Write-Success "All financial integration tests passed against disposable container!"
    } else {
        Write-Failure "One or more financial integration tests failed (Exit code: $TestExitCode)."
    }

} catch {
    Write-Failure "Disposable integration run encountered an error: $_"
    $TestExitCode = 1
} finally {
    # -------------------------------------------------------------------------
    # 5. Guaranteed Teardown and Cleanup
    # -------------------------------------------------------------------------
    if (-not $KeepRunning) {
        Write-Step "Tearing down disposable containers and temporary workspace..."

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
        Remove-Item Env:\ALLOW_DISPOSABLE_FINANCIAL_INTEGRATION -ErrorAction SilentlyContinue
        Remove-Item Env:\DISPOSABLE_CONTAINER_LIFECYCLE -ErrorAction SilentlyContinue
        Remove-Item Env:\DISPOSABLE_SUPABASE_URL -ErrorAction SilentlyContinue
        Remove-Item Env:\DISPOSABLE_ANON_KEY -ErrorAction SilentlyContinue
        Remove-Item Env:\DISPOSABLE_SERVICE_KEY -ErrorAction SilentlyContinue

        # Verify no disposable containers remain
        $checkLingering = docker ps -q --filter "name=$ProjectId"
        if ($checkLingering) {
            Write-Failure "Warning: Lingering disposable containers detected: $checkLingering"
        } else {
            Write-Success "Disposable container teardown complete. Persistent DB at 54321 untouched."
        }
    } else {
        Write-Host "[NOTE] -KeepRunning flag provided; preserving disposable containers on port $ApiPort." -ForegroundColor Yellow
    }
}

exit $TestExitCode
