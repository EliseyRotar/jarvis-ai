#!/usr/bin/env bash
# JARVIS setup — run once after cloning.
# Idempotent: safe to run again to update settings.
set -euo pipefail

# ── colours ────────────────────────────────────────────────────────────────
C_BLUE='\033[0;34m'; C_CYAN='\033[0;36m'; C_GREEN='\033[0;32m'
C_YELLOW='\033[1;33m'; C_RED='\033[0;31m'; C_BOLD='\033[1m'; C_OFF='\033[0m'
ok()   { echo -e "  ${C_GREEN}✓${C_OFF} $*"; }
warn() { echo -e "  ${C_YELLOW}!${C_OFF} $*"; }
err()  { echo -e "  ${C_RED}✗${C_OFF} $*"; }
hdr()  { echo -e "\n${C_BOLD}${C_CYAN}[$1/$TOTAL]${C_OFF} ${C_BOLD}$2${C_OFF}"; }
ask()  { echo -en "    ${C_BLUE}▶${C_OFF} $1 "; }

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TOTAL=7

echo -e "\n${C_BOLD}${C_CYAN}"
echo "  ╔══════════════════════════════════════════════╗"
echo "  ║         J . A . R . V . I . S .             ║"
echo "  ║           Setup & Configuration             ║"
echo "  ╚══════════════════════════════════════════════╝"
echo -e "${C_OFF}"

# ── 1. Dependencies ─────────────────────────────────────────────────────────
hdr 1 "Checking system dependencies"

check_cmd() {
    if command -v "$1" &>/dev/null; then
        ok "$1 ($(command -v "$1"))"
        return 0
    else
        return 1
    fi
}

check_cmd python3  || { err "python3 not found — install with: sudo pacman -S python"; exit 1; }
check_cmd pip      || check_cmd pip3 || { err "pip not found"; exit 1; }

# Detect piper binary name (Arch uses piper-tts, others use piper)
PIPER_BIN=""
if   command -v piper-tts &>/dev/null; then PIPER_BIN="piper-tts"; ok "piper-tts"
elif command -v piper     &>/dev/null; then PIPER_BIN="piper";     ok "piper"
else warn "piper not found — TTS will be disabled. Install: sudo pacman -S piper"
fi

if command -v npm &>/dev/null; then ok "npm (needed for claude setup-token)"
else warn "npm not found — needed to get a Claude OAuth token. Install: sudo pacman -S nodejs npm"
fi

if python3 -c "import openwakeword, sounddevice" 2>/dev/null; then
    ok "openwakeword + sounddevice (wake word available)"
    HAS_WAKEWORD=1
else
    warn "openwakeword / sounddevice not installed — wake word disabled"
    warn "  To enable: pip install openwakeword sounddevice  (in the venv)"
    HAS_WAKEWORD=0
fi

# ── 2. Python venv ───────────────────────────────────────────────────────────
hdr 2 "Python virtual environment"

VENV="$SCRIPT_DIR/.venv"
if [ ! -d "$VENV" ]; then
    echo "    Creating venv…"
    python3 -m venv "$VENV"
fi

PIP="$VENV/bin/pip"
"$PIP" install --quiet --upgrade pip
echo "    Installing requirements…"
"$PIP" install --quiet -r "$SCRIPT_DIR/requirements.txt"
ok "Virtual environment ready at .venv/"

# ── 3. Credentials ───────────────────────────────────────────────────────────
hdr 3 "Credentials"

JARVIS_DIR="$HOME/.jarvis"
mkdir -p "$JARVIS_DIR"
ENV_FILE="$JARVIS_DIR/.env"

# Load existing values if present
EXISTING_CLAUDE_TOKEN=""
EXISTING_OR_KEY=""
if [ -f "$ENV_FILE" ]; then
    EXISTING_CLAUDE_TOKEN=$(grep -E '^CLAUDE_CODE_OAUTH_TOKEN=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- | tr -d '"' || true)
    EXISTING_OR_KEY=$(grep -E '^OPENROUTER_API_KEY=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- | tr -d '"' || true)
fi

echo ""
echo -e "  ${C_BOLD}Claude OAuth token${C_OFF} (required for Claude Pro backend)"
echo -e "  Get one with: ${C_CYAN}npm install -g @anthropic-ai/claude-code && claude setup-token${C_OFF}"
if [ -n "$EXISTING_CLAUDE_TOKEN" ]; then
    echo -e "  Current: ${C_GREEN}${EXISTING_CLAUDE_TOKEN:0:20}…${C_OFF} (press Enter to keep)"
fi
ask "Token [sk-ant-oat01-...]:"; read -r INPUT_CLAUDE_TOKEN
if [ -n "$INPUT_CLAUDE_TOKEN" ]; then
    CLAUDE_TOKEN="$INPUT_CLAUDE_TOKEN"
elif [ -n "$EXISTING_CLAUDE_TOKEN" ]; then
    CLAUDE_TOKEN="$EXISTING_CLAUDE_TOKEN"
    ok "Keeping existing Claude token"
else
    warn "No Claude token provided — JARVIS will fall back to OpenRouter if configured"
    CLAUDE_TOKEN=""
fi

echo ""
echo -e "  ${C_BOLD}OpenRouter API key${C_OFF} (optional fallback — free models available at openrouter.ai)"
if [ -n "$EXISTING_OR_KEY" ]; then
    echo -e "  Current: ${C_GREEN}${EXISTING_OR_KEY:0:16}…${C_OFF} (press Enter to keep, 'none' to clear)"
fi
ask "Key [sk-or-... or Enter to skip]:"; read -r INPUT_OR_KEY
if [ "$INPUT_OR_KEY" = "none" ]; then
    OR_KEY=""
elif [ -n "$INPUT_OR_KEY" ]; then
    OR_KEY="$INPUT_OR_KEY"
else
    OR_KEY="$EXISTING_OR_KEY"
fi

# ── 4. Model selection ───────────────────────────────────────────────────────
hdr 4 "Model selection"

EXISTING_MODEL=$(grep -E '^JARVIS_CLAUDE_MODEL=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- | tr -d '"' || true)
[ -z "$EXISTING_MODEL" ] && EXISTING_MODEL="claude-sonnet-4-6"

echo ""
echo "  Available Claude models:"
echo -e "    ${C_CYAN}1)${C_OFF} claude-haiku-4-5   — fast, low cost"
echo -e "    ${C_CYAN}2)${C_OFF} claude-sonnet-4-6  — balanced ${C_GREEN}(recommended)${C_OFF}"
echo -e "    ${C_CYAN}3)${C_OFF} claude-opus-4-7    — most capable, slower"
echo ""
case "$EXISTING_MODEL" in
    *haiku*)  CUR_N=1 ;;
    *opus*)   CUR_N=3 ;;
    *)        CUR_N=2 ;;
esac
ask "Choice [1-3, Enter = $CUR_N]:"; read -r MODEL_CHOICE
case "${MODEL_CHOICE:-$CUR_N}" in
    1) CLAUDE_MODEL="claude-haiku-4-5"  ;;
    3) CLAUDE_MODEL="claude-opus-4-7"   ;;
    *) CLAUDE_MODEL="claude-sonnet-4-6" ;;
esac
ok "Model: $CLAUDE_MODEL"

# ── 5. Voice / wake word ─────────────────────────────────────────────────────
hdr 5 "Voice & wake word"

EXISTING_DISABLE_WW=$(grep -E '^JARVIS_DISABLE_WAKEWORD=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- || true)
EXISTING_WHISPER=$(grep -E '^JARVIS_WHISPER_MODEL=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- | tr -d '"' || true)
[ -z "$EXISTING_WHISPER" ] && EXISTING_WHISPER="base.en"

if [ "$HAS_WAKEWORD" = "1" ]; then
    if [ "$EXISTING_DISABLE_WW" = "1" ]; then
        ask "Enable 'hey jarvis' wake word? [y/N]:"; read -r WW_CHOICE
    else
        ask "Enable 'hey jarvis' wake word? [Y/n]:"; read -r WW_CHOICE
    fi
    case "${WW_CHOICE,,}" in
        n|no) DISABLE_WAKEWORD=1 ;;
        *)    DISABLE_WAKEWORD=0 ;;
    esac
else
    DISABLE_WAKEWORD=1
    warn "Wake word disabled (missing deps)"
fi

echo ""
echo "  Whisper STT model (larger = more accurate, slower to load):"
echo -e "    ${C_CYAN}1)${C_OFF} tiny.en   — fastest, lowest accuracy"
echo -e "    ${C_CYAN}2)${C_OFF} base.en   — good balance ${C_GREEN}(recommended)${C_OFF}"
echo -e "    ${C_CYAN}3)${C_OFF} small.en  — better accuracy, ~1 GB RAM"
echo -e "    ${C_CYAN}4)${C_OFF} medium.en — high accuracy, ~2.5 GB RAM"
echo ""
case "$EXISTING_WHISPER" in
    tiny*)   CUR_W=1 ;;
    small*)  CUR_W=3 ;;
    medium*) CUR_W=4 ;;
    *)       CUR_W=2 ;;
esac
ask "Choice [1-4, Enter = $CUR_W]:"; read -r WHISPER_CHOICE
case "${WHISPER_CHOICE:-$CUR_W}" in
    1) WHISPER_MODEL="tiny.en"   ;;
    3) WHISPER_MODEL="small.en"  ;;
    4) WHISPER_MODEL="medium.en" ;;
    *) WHISPER_MODEL="base.en"   ;;
esac
ok "STT model: $WHISPER_MODEL"

# ── 6. Piper voice models ────────────────────────────────────────────────────
hdr 6 "Piper TTS voice models"

PIPER_DIR="$HOME/.local/share/piper"
EN_MODEL="$PIPER_DIR/en_GB-alan-medium.onnx"
IT_MODEL="$PIPER_DIR/it_IT-riccardo-x_low.onnx"

if [ -z "$PIPER_BIN" ]; then
    warn "Piper not installed — skipping model download"
else
    mkdir -p "$PIPER_DIR"

    download_piper_model() {
        local base_url="https://huggingface.co/rhasspy/piper-voices/resolve/main"
        local path="$1"
        local dest="$2"
        if [ -f "$dest" ]; then
            ok "$(basename "$dest") already downloaded"
        else
            echo "    Downloading $(basename "$dest")…"
            curl -fsSL --progress-bar "$base_url/$path" -o "$dest"
            curl -fsSL --progress-bar "$base_url/$path.json" -o "$dest.json"
            ok "$(basename "$dest")"
        fi
    }

    echo ""
    ask "Download English voice (en_GB-alan-medium, ~65 MB)? [Y/n]:"; read -r DL_EN
    if [[ ! "${DL_EN,,}" =~ ^n ]]; then
        download_piper_model "en/en_GB/alan/medium/en_GB-alan-medium.onnx" "$EN_MODEL"
    fi

    ask "Download Italian voice (it_IT-riccardo-x_low, ~30 MB)? [y/N]:"; read -r DL_IT
    if [[ "${DL_IT,,}" =~ ^y ]]; then
        download_piper_model "it/it_IT/riccardo/x_low/it_IT-riccardo-x_low.onnx" "$IT_MODEL"
    fi
fi

# ── 7. Personal system prompt ────────────────────────────────────────────────
hdr 7 "Personal system prompt"

PERSONAL_DIR="$SCRIPT_DIR/jarvis/personal info jarvis"
PERSONAL_PROMPT="$PERSONAL_DIR/system_prompt.txt"

mkdir -p "$PERSONAL_DIR"

if [ -f "$PERSONAL_PROMPT" ]; then
    echo ""
    warn "Personal system prompt already exists at:"
    warn "  jarvis/personal info jarvis/system_prompt.txt"
    ask "Overwrite it with a fresh template? [y/N]:"; read -r OVERWRITE
    if [[ ! "${OVERWRITE,,}" =~ ^y ]]; then
        ok "Keeping existing personal system prompt"
        SKIP_PROMPT=1
    else
        SKIP_PROMPT=0
    fi
else
    SKIP_PROMPT=0
fi

if [ "$SKIP_PROMPT" = "0" ]; then
    echo ""
    echo -e "  JARVIS will personalize responses based on the info below."
    echo -e "  ${C_YELLOW}This file is gitignored — it never gets committed.${C_OFF}"
    echo ""
    ask "Your name (e.g. 'John'):"; read -r USER_NAME
    ask "Your hardware (e.g. 'i7-12700, 32GB, RTX 4070'):"; read -r USER_HW

    TEMPLATE=$(cat "$SCRIPT_DIR/jarvis/system_prompt.txt")

    # Replace placeholders with user input
    PERSONALIZED="${TEMPLATE//\[YOUR_NAME\]/${USER_NAME:-operator}}"
    PERSONALIZED="${PERSONALIZED//\[YOUR_HARDWARE — e.g. \"Intel i7-12700, 32 GB RAM, RTX 4070\"\]/${USER_HW:-fill in your hardware}}"
    PERSONALIZED="${PERSONALIZED//your operator/${USER_NAME:-your operator}\'s operator}"

    printf '%s\n' "$PERSONALIZED" > "$PERSONAL_PROMPT"
    ok "Personal system prompt written to jarvis/personal info jarvis/system_prompt.txt"
fi

# ── Write ~/.jarvis/.env ─────────────────────────────────────────────────────
echo ""
echo -e "  Writing ${C_CYAN}~/.jarvis/.env${C_OFF}…"

{
    echo "# JARVIS credentials — generated by setup.sh"
    echo "# Keep this file private (chmod 600)."
    echo ""
    [ -n "$CLAUDE_TOKEN" ] && echo "CLAUDE_CODE_OAUTH_TOKEN=$CLAUDE_TOKEN"
    [ -n "$OR_KEY"       ] && echo "OPENROUTER_API_KEY=$OR_KEY"
    echo ""
    echo "# Model & backend"
    echo "JARVIS_CLAUDE_MODEL=$CLAUDE_MODEL"
    echo "# JARVIS_LLM_BACKEND=auto"
    echo ""
    echo "# STT"
    echo "JARVIS_WHISPER_MODEL=$WHISPER_MODEL"
    echo "# JARVIS_WHISPER_DEVICE=cpu"
    echo ""
    echo "# TTS"
    [ -n "$PIPER_BIN" ] && echo "JARVIS_PIPER_BIN=$PIPER_BIN"
    [ -f "$EN_MODEL"  ] && echo "JARVIS_PIPER_MODEL_EN=$EN_MODEL"
    [ -f "$IT_MODEL"  ] && echo "JARVIS_PIPER_MODEL_IT=$IT_MODEL"
    echo ""
    echo "# Wake word"
    [ "$DISABLE_WAKEWORD" = "1" ] && echo "JARVIS_DISABLE_WAKEWORD=1"
    echo "# JARVIS_WAKE_THRESHOLD=500"
    echo "# JARVIS_CAPTURE_SECONDS=8"
    echo ""
    echo "# Search (optional)"
    echo "# SEARX_URL=http://localhost:8080"
    echo "# BRAVE_API_KEY="
    echo ""
    echo "# Logging"
    echo "# JARVIS_LOG_LEVEL=INFO"
} > "$ENV_FILE"
chmod 600 "$ENV_FILE"
ok "~/.jarvis/.env written (chmod 600)"

# ── Done ─────────────────────────────────────────────────────────────────────
echo ""
echo -e "${C_BOLD}${C_GREEN}  ══════════════════════════════════════════${C_OFF}"
echo -e "${C_BOLD}${C_GREEN}  ✓  Setup complete!${C_OFF}"
echo -e "${C_BOLD}${C_GREEN}  ══════════════════════════════════════════${C_OFF}"
echo ""
echo -e "  Start JARVIS:"
echo -e "    ${C_CYAN}./run_optimized.sh${C_OFF}"
echo ""
echo -e "  Or manually:"
echo -e "    ${C_CYAN}.venv/bin/uvicorn jarvis.main:app --host 127.0.0.1 --port 8765${C_OFF}"
echo ""
echo -e "  Open: ${C_CYAN}http://127.0.0.1:8765${C_OFF}"
echo -e "  Health check: ${C_CYAN}curl http://127.0.0.1:8765/healthz${C_OFF}"
echo ""
echo -e "  To customize your system prompt:"
echo -e "    ${C_CYAN}$PERSONAL_PROMPT${C_OFF}"
echo ""
