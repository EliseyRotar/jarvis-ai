#!/usr/bin/env bash
# Cross-platform launcher for the WhatsApp bridge (Linux/macOS).
# Builds the binary if missing (requires Go + a C compiler for CGO/go-sqlite3),
# then runs it. First run prompts for a QR code scan.
set -e
cd "$(dirname "$0")"

if [ ! -f ./whatsapp-bridge ]; then
    echo "Building whatsapp-bridge (requires Go + gcc, CGO_ENABLED=1)..."
    CGO_ENABLED=1 go build -o whatsapp-bridge .
fi

exec ./whatsapp-bridge
