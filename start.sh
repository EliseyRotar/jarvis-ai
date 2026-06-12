#!/usr/bin/env bash
# JARVIS — single entry point. Installs everything on first run (via a web
# setup wizard) and launches JARVIS. On later runs, launches directly.
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

PYTHON=""
for cand in python3 python; do
    if command -v "$cand" &>/dev/null; then PYTHON="$cand"; break; fi
done
if [ -z "$PYTHON" ]; then
    echo "Python 3 not found. Install it with your package manager and re-run." >&2
    exit 1
fi

exec "$PYTHON" bootstrap.py
