# JARVIS — graceful shutdown. Stops the JARVIS voice server, the Hermes
# gateway, and any background MCP servers they spawned. Reads PIDs from
# .\.jarvis.pids if present, otherwise kills anything python that matches.

[CmdletBinding()]
param(
    [switch]$Force
)

$ErrorActionPreference = 'SilentlyContinue'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$PidFile = Join-Path $ScriptDir '.jarvis.pids'

function Write-Status($msg) { Write-Host "[jarvis] $msg" -ForegroundColor Cyan }

if ($Force) { Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Out-Null }

Write-Status "Stopping JARVIS voice server ..."
$Svc = Get-Service 'JarvisVoiceServer' -ErrorAction SilentlyContinue
if ($Svc) {
    if ($Svc.Status -eq 'Running') {
        Write-Status "  stopping Windows Service 'JarvisVoiceServer'"
        Stop-Service 'JarvisVoiceServer' -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
    }
}
# Also kill any foreground uvicorn (in case the service isn't installed
# or someone started it manually).
Get-CimInstance Win32_Process -Filter "Name='python.exe'" |
    Where-Object { $_.CommandLine -like '*uvicorn*' -or $_.CommandLine -like '*jarvis.main*' } |
    ForEach-Object {
        Write-Status "  killing uvicorn PID $($_.ProcessId)"
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }

Write-Status "Stopping Hermes gateway ..."
Get-CimInstance Win32_Process -Filter "Name='python.exe'" |
    Where-Object { $_.CommandLine -like '*gateway*' -or $_.CommandLine -like '*hermes_cli.main*' } |
    ForEach-Object {
        Write-Status "  killing gateway PID $($_.ProcessId)"
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }

Write-Status "Stopping MCP child processes (npx, uv, node) ..."
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -like '*mcp*' -or $_.CommandLine -like '*playwright*' -or $_.CommandLine -like '*mobile-mcp*' -or $_.CommandLine -like '*@mobilenext*' } |
    ForEach-Object {
        Write-Status "  killing node PID $($_.ProcessId)"
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }

if (Test-Path $PidFile) { Remove-Item $PidFile -Force -ErrorAction SilentlyContinue }

Write-Status "All JARVIS-related processes stopped."
