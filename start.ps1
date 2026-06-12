# JARVIS — single entry point. Installs everything on first run (via a web
# setup wizard) and launches JARVIS. On later runs, launches directly.
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

$python = $null
foreach ($cand in @("python", "py")) {
    if (Get-Command $cand -ErrorAction SilentlyContinue) { $python = $cand; break }
}
if (-not $python) {
    Write-Error "Python not found. Install it from https://www.python.org/downloads/ (check 'Add to PATH') and re-run."
    exit 1
}

& $python bootstrap.py
