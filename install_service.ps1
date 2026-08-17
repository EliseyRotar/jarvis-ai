<#
.SYNOPSIS
  Registers the JARVIS voice server as a Windows Service running under
  LOCAL SYSTEM. After this runs once (with a single UAC prompt), Cosmo
  has full admin rights on the box without any further UAC prompts.

.DESCRIPTION
  This is the *only* UAC prompt you'll ever see for JARVIS. The service
  registers itself to auto-start at boot, runs as NT AUTHORITY\SYSTEM,
  and supervises the uvicorn child process — so from this point on,
  every reboot, every start, every restart is silent.

  - Creates %ProgramData%\JarvisVoiceServer for logs
  - Adds a Windows Firewall rule so port 8765 is reachable from localhost
  - Registers the service via Python's win32serviceutil
  - Sets recovery: restart on first/second/subsequent failure with 5s delay
  - Starts the service and prints a status line

  To remove the service later:
    powershell -ExecutionPolicy Bypass -File uninstall_service.ps1

  Requires the operator's account to be a member of the local
  Administrators group. If you see "Access is denied" when the script
  tries to register, add yourself to Administrators first:
    net localgroup Administrators eli6-admin /add
#>
[CmdletBinding()]
param(
    [switch]$NoFirewall,   # skip adding the Windows Firewall rule
    [switch]$Quiet         # don't print the post-install banner
)

$ErrorActionPreference = "Stop"

$repoRoot   = Split-Path -Parent $MyInvocation.MyCommand.Path
$pythonExe  = Join-Path $repoRoot ".venv\Scripts\python.exe"
$servicePy  = Join-Path $repoRoot "jarvis\service.py"
$svcName    = "JarvisVoiceServer"
$logDir     = "$env:ProgramData\JarvisVoiceServer"

# â”€â”€ sanity â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
if (-not (Test-Path $pythonExe)) {
    throw "Python venv not found at $pythonExe. Run scripts\setup.ps1 first."
}
if (-not (Test-Path $servicePy)) {
    throw "Service module not found at $servicePy."
}

# â”€â”€ log dir â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
Write-Host "[install] logs â†’ $logDir\service.log" -ForegroundColor Cyan

# â”€â”€ register â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# pywin32's HandleCommandLine with `install` and `--startup auto` writes
# the appropriate registry keys under HKLM\SYSTEM\CurrentControlSet\Services.
# Run from an elevated process â€” re-launch ourselves if needed.
function Assert-Admin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    $pr = New-Object Security.Principal.WindowsPrincipal($id)
    # Avoid the [Type]::Member form — PS 5.1's parser sometimes misreads
    # `]::Administrator` as a type literal and chokes on the trailing `)`.
    $adminRole = [Security.Principal.WindowsBuiltInRole]::Administrator
    if (-not $pr.IsInRole($adminRole)) {
        $argList = @("-NoProfile", "-ExecutionPolicy", "Bypass",
                     "-File", "`"$PSCommandPath`"") + $args
        Write-Host "[install] not elevated — re-launching as admin..." -ForegroundColor Yellow
        Start-Process -FilePath "powershell" -ArgumentList $argList -Verb RunAs -Wait
        exit $LASTEXITCODE
    }
}
Assert-Admin

Write-Host "[install] registering service '$svcName' (start=auto)..." -ForegroundColor Cyan
& $pythonExe $servicePy install --startup auto | Out-Null
if ($LASTEXITCODE -ne 0) { throw "service install failed (exit $LASTEXITCODE)" }

# â”€â”€ description â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
sc.exe description $svcName "Cosmo voice + LLM server (LOCAL SYSTEM). Auto-starts at boot." | Out-Null

# â”€â”€ recovery â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# restart on first/second/subsequent failure with 5s delay
& sc.exe failure $svcName reset= 60 actions= restart/5000/restart/5000/restart/5000 | Out-Null

# â”€â”€ firewall (defensive: uvicorn already binds 127.0.0.1) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# Allow inbound on 8765 only from localhost. Existing rule is skipped.
$fwRuleName = "JARVIS Voice Server (127.0.0.1:8765)"
$fwRule = Get-NetFirewallRule -DisplayName $fwRuleName -ErrorAction SilentlyContinue
if (-not $fwRule) {
    New-NetFirewallRule -DisplayName $fwRuleName `
        -Direction Inbound -Action Allow -Protocol TCP `
        -LocalAddress 127.0.0.1 -LocalPort 8765 `
        -Profile Any -Enabled True | Out-Null
    Write-Host "[install] firewall rule added: $fwRuleName" -ForegroundColor Cyan
}

# â”€â”€ start â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
Write-Host "[install] starting service..." -ForegroundColor Cyan
& sc.exe start $svcName | Out-Null
Start-Sleep -Seconds 3

$svc = Get-Service $svcName -ErrorAction SilentlyContinue
if ($svc -and $svc.Status -eq "Running") {
    if (-not $Quiet) {
        Write-Host ""
        Write-Host "service installed + running as LOCAL SYSTEM" -ForegroundColor Green
        Write-Host "  name    : $svcName" -ForegroundColor Green
        Write-Host "  status  : $($svc.Status)" -ForegroundColor Green
        Write-Host "  url     : http://127.0.0.1:8765/#/" -ForegroundColor Green
        Write-Host "  logs    : $logDir\service.log" -ForegroundColor Green
        Write-Host ""
        Write-Host "From now on, jarvis starts at every boot without prompts." -ForegroundColor Yellow
        Write-Host ""
        Write-Host "Useful commands:" -ForegroundColor Yellow
        Write-Host "  Get-Service        $svcName"
        Write-Host "  Restart-Service    $svcName"
        Write-Host "  Stop-Service       $svcName"
        Write-Host "  .\uninstall_service.ps1     (removes the service)"
    }
} else {
    throw "service did not start — check $logDir\service.log"
}
