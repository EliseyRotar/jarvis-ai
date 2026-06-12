# Cross-platform launcher for the WhatsApp bridge (Windows).
# Builds whatsapp-bridge.exe if missing (requires Go + a C compiler on PATH
# for CGO/go-sqlite3), then runs it. First run prompts for a QR code scan.

Set-Location $PSScriptRoot

if (-not (Test-Path ".\whatsapp-bridge.exe")) {
    Write-Host "Building whatsapp-bridge.exe (requires Go + gcc, CGO_ENABLED=1)..."
    $env:CGO_ENABLED = "1"
    go build -o whatsapp-bridge.exe .
}

.\whatsapp-bridge.exe
