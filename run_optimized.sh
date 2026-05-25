#!/bin/bash
# JARVIS startup — uvloop + httptools for faster I/O, single worker required
# because all state (hub, conversation, wake-word loop, TTS) is in-memory.
# Multiple workers each get their own copy → WebSockets break, voice breaks.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VENV_UVICORN="$SCRIPT_DIR/.venv/bin/uvicorn"

if [ ! -x "$VENV_UVICORN" ]; then
    echo "ERROR: venv not found at $SCRIPT_DIR/.venv — run: cd $SCRIPT_DIR && python -m venv .venv && .venv/bin/pip install -e ." >&2
    exit 1
fi

cd "$SCRIPT_DIR"

exec "$VENV_UVICORN" jarvis.main:app \
    --host 127.0.0.1 \
    --port 8765 \
    --workers 1 \
    --timeout-keep-alive 75 \
    --loop uvloop \
    --http httptools
