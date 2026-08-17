# JARVIS — single entry point.
#
# First run:  installs Hermes Agent + JARVIS deps via the bootstrap wizard.
# Later runs: starts Hermes gateway, then JARVIS voice server.
#
# Usage:
#   .\start.ps1                   # normal start (gateway + voice server)
#   .\start.ps1 -RebuildFrontend  # also rebuild the React/Vite frontend
#   .\start.ps1 -SkipGateway      # don't start Hermes (assume it's already up)
#   .\start.ps1 -OnlyGateway      # only start Hermes, skip voice server
#   .\start.ps1 -Bootstrap        # force the bootstrap wizard (re-install / re-config)
#
# All PIDs are written to .\.jarvis.pids so .\stop.ps1 can shut everything down.

[CmdletBinding()]
param(
    [switch]$RebuildFrontend,
    [switch]$SkipGateway,
    [switch]$OnlyGateway,
    [switch]$Bootstrap
)

$ErrorActionPreference = 'Stop'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

$PidFile = Join-Path $ScriptDir '.jarvis.pids'

function Write-Status($msg) { Write-Host "[jarvis] $msg" -ForegroundColor Cyan }
function Write-Warn_($msg) { Write-Host "[jarvis] $msg" -ForegroundColor Yellow }

# ── 1. Pick a Python ──────────────────────────────────────────────────────
$python = $null
foreach ($cand in @('python', 'py')) {
    if (Get-Command $cand -ErrorAction SilentlyContinue) { $python = $cand; break }
}
if (-not $python) {
    Write-Error "Python not found. Install it from https://www.python.org/downloads/ (check 'Add to PATH') and re-run."
    exit 1
}

# ── 2. Ensure JARVIS venv exists ─────────────────────────────────────────
$VenvDir = Join-Path $ScriptDir '.venv'
$VenvPython = Join-Path $VenvDir 'Scripts\python.exe'
if (-not (Test-Path $VenvPython)) {
    Write-Status "Creating JARVIS virtualenv at $VenvDir ..."
    & $python -m venv $VenvDir
    & $VenvPython -m pip install --upgrade pip
    & $VenvPython -m pip install -r (Join-Path $ScriptDir 'requirements.txt')
}

# ── 3. Bootstrap (first run / forced) ─────────────────────────────────────
$ConfiguredFlag = Join-Path $ScriptDir '.jarvis.configured'
if ($Bootstrap -or -not (Test-Path $ConfiguredFlag)) {
    Write-Status "Running bootstrap wizard ..."
    & $VenvPython (Join-Path $ScriptDir 'bootstrap.py')
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    Set-Content -Path $ConfiguredFlag -Value (Get-Date -Format 'o')
}

# ── 4. Optional frontend rebuild ─────────────────────────────────────────
if ($RebuildFrontend) {
    Write-Status "Rebuilding frontend (npm run build) ..."
    Push-Location (Join-Path $ScriptDir 'jarvis\web')
    try {
        if (-not (Test-Path 'node_modules')) { npm install }
        npm run build
        if ($LASTEXITCODE -ne 0) { throw "frontend build failed" }
    } finally { Pop-Location }
}

# ── 5. Start Hermes gateway ───────────────────────────────────────────────
if (-not $SkipGateway) {
    Write-Status "Starting Hermes gateway ..."
    $GatewayScript = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup\Hermes_Gateway.vbs'
    if (-not (Test-Path $GatewayScript)) {
        Write-Warn_ "Startup script not found at $GatewayScript — gateway must be started manually."
    } else {
        # Kill any pre-existing gateway first so the new one binds 8642.
        Get-CimInstance Win32_Process -Filter "Name='python.exe'" |
            Where-Object { $_.CommandLine -like '*gateway*' } |
            ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
        Start-Sleep -Seconds 2
        Start-Process -FilePath 'wscript.exe' -ArgumentList "`"$GatewayScript`"" -WindowStyle Hidden
        # Wait for /health
        $Ready = $false
        for ($i = 1; $i -le 30; $i++) {
            try {
                $r = Invoke-WebRequest -Uri 'http://127.0.0.1:8642/health' -UseBasicParsing -TimeoutSec 2 -Headers @{'Authorization'='Bearer health'}
                if ($r.StatusCode -eq 200) { $Ready = $true; break }
            } catch { }
            Start-Sleep -Seconds 1
        }
        if (-not $Ready) {
            Write-Warn_ "Hermes gateway did not respond on :8642 within 30s — continuing anyway."
        } else {
            Write-Status "Hermes gateway ready on :8642."
        }
    }
}

if ($OnlyGateway) { exit 0 }

# ── 6. Start JARVIS voice server ──────────────────────────────────────────
Write-Status "Starting JARVIS voice server on :8765 ..."
# Kill any pre-existing uvicorn bound to 8765
Get-CimInstance Win32_Process -Filter "Name='python.exe'" |
    Where-Object { $_.CommandLine -like '*uvicorn*' -or $_.CommandLine -like '*jarvis.main*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2

$Uvicorn = Join-Path $VenvDir 'Scripts\uvicorn.exe'
$Proc = Start-Process -FilePath $Uvicorn `
    -ArgumentList @('jarvis.main:app', '--host', '127.0.0.1', '--port', '8765', '--workers', '1', '--timeout-keep-alive', '75') `
    -WindowStyle Hidden -PassThru
Write-Status "JARVIS PID = $($Proc.Id)"

# ── 7. Wait for voice server /health ──────────────────────────────────────
$VoiceReady = $false
for ($i = 1; $i -le 30; $i++) {
    try {
        $r = Invoke-WebRequest -Uri 'http://127.0.0.1:8765/healthz' -UseBasicParsing -TimeoutSec 2
        if ($r.StatusCode -eq 200) { $VoiceReady = $true; break }
    } catch { }
    Start-Sleep -Seconds 1
}
if (-not $VoiceReady) {
    Write-Warn_ "JARVIS voice server did not respond on :8765 within 30s."
} else {
    Write-Status "JARVIS voice server ready on :8765 — open http://127.0.0.1:8765/ in your browser."
}

# Save PIDs for stop.ps1
$GatewayPids = @(Get-CimInstance Win32_Process -Filter "Name='python.exe'" |
    Where-Object { $_.CommandLine -like '*gateway*' } |
    ForEach-Object { $_.ProcessId })
"PidFile v1`nGatewayPids: $($GatewayPids -join ',')`nVoiceServerPid: $($Proc.Id)" |
    Set-Content -Path $PidFile -Encoding UTF8

Write-Status "All up. Use .\stop.ps1 to shut down."
