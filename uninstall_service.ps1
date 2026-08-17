<#
.SYNOPSIS
  Removes the JARVIS voice server Windows Service and its firewall rule.
#>

$ErrorActionPreference = "Stop"

$repoRoot   = Split-Path -Parent $MyInvocation.MyCommand.Path
$pythonExe  = Join-Path $repoRoot ".venv\Scripts\python.exe"
$servicePy  = Join-Path $repoRoot "jarvis\service.py"
$svcName    = "JarvisVoiceServer"
$fwRuleName = "JARVIS Voice Server (127.0.0.1:8765)"

function Assert-Admin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    $pr = New-Object Security.Principal.WindowsPrincipal($id)
    $adminRole = [Security.Principal.WindowsBuiltInRole]::Administrator
    if (-not $pr.IsInRole($adminRole)) {
        $argList = @("-NoProfile", "-ExecutionPolicy", "Bypass",
                     "-File", "`"$PSCommandPath`"") + $args
        Write-Host "[uninstall] re-launching elevated..." -ForegroundColor Yellow
        Start-Process -FilePath "powershell" -ArgumentList $argList -Verb RunAs -Wait
        exit $LASTEXITCODE
    }
}
Assert-Admin

# Stop + remove
$svc = Get-Service $svcName -ErrorAction SilentlyContinue
if ($svc) {
    if ($svc.Status -eq "Running") {
        Write-Host "[uninstall] stopping service..." -ForegroundColor Cyan
        Stop-Service $svcName -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
    }
    Write-Host "[uninstall] removing service..." -ForegroundColor Cyan
    & $pythonExe $servicePy remove | Out-Null
    if ($LASTEXITCODE -ne 0) { Write-Warning "remove returned $LASTEXITCODE" }
} else {
    Write-Host "[uninstall] service '$svcName' is not installed" -ForegroundColor Yellow
}

# Firewall rule
$fw = Get-NetFirewallRule -DisplayName $fwRuleName -ErrorAction SilentlyContinue
if ($fw) {
    Remove-NetFirewallRule -DisplayName $fwRuleName | Out-Null
    Write-Host "[uninstall] firewall rule removed" -ForegroundColor Cyan
}

Write-Host ""
Write-Host "uninstall complete" -ForegroundColor Green
