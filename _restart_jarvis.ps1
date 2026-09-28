# Restart JARVIS cleanly: stop whatever is listening on 8765, then relaunch.
$ErrorActionPreference = 'SilentlyContinue'
$port = 8765
Get-NetTCPConnection -State Listen -LocalPort $port | ForEach-Object {
    Stop-Process -Id $_.OwningProcess -Force
}
Start-Sleep -Seconds 1
Set-Location 'C:\Users\eli6-admin\Documents\jarvis-ai'
Start-Process -FilePath '.venv\Scripts\uvicorn.exe' `
    -ArgumentList 'jarvis.main:app','--host','127.0.0.1','--port',$port,'--workers','1','--timeout-keep-alive','75' `
    -WindowStyle Hidden
