# J.A.R.V.I.S.

> Just A Rather Very Intelligent System — a local, voice-driven AI operator for
> Linux and Windows. Backed by your **Claude Pro** subscription, **OpenRouter**,
> or a fully-offline **Ollama** model.
>
> Runs on **any Linux distro** and **Windows 11**. Hyprland gets deep window-manager
> integration via the `hypr_dispatch` tool; on other desktops/Windows that tool
> degrades gracefully and JARVIS controls things through plain shell/PowerShell
> commands instead.

![JARVIS HUD](docs/img/hud.png)

## Features

- **Voice-first** — "Hey Jarvis" wake word, faster-whisper STT, piper offline TTS
  (or edge-tts), with a live HUD showing JARVIS's thinking, tool calls, and the
  Agentic Task Engine's step-by-step progress.
- **Your AI, your terms** — Claude Pro/Max subscription (via OAuth, no API
  billing), OpenRouter (cloud + free tiers), or fully offline Ollama, with
  automatic fallback between them.
- **Full system access** — shell, files, browser/window control, web search and
  deep research, all with an append-only audited security log.
- **Long-term memory** — SQLite + FTS5 full-text search across everything JARVIS
  has learned, plus a daily/interval/once task scheduler.
- **Reach JARVIS from anywhere** — Telegram bridge, and a vendored
  [WhatsApp MCP integration](#whatsapp-integration) (read/search/send messages,
  files, and voice notes from your own number, linked via a QR code in the
  setup wizard).
- **One-command setup** — `start.sh` / `start.ps1` runs a browser-based wizard
  that installs everything, configures your AI backend, and lets you toggle
  optional integrations (WhatsApp, Gmail, GitHub, Home Assistant, and more).

*The HUD: live thinking stream (left), arc-reactor voice visualizer + response +
transcript (center), and the Agentic Task Engine progress tracker + tool calls
(right). Switch models or shut down from the header.*

```
 Wake word ─▶  STT  ─▶  Claude Agent SDK  ─▶  Tools (bash/hypr/web/memory/...)
                          │ (OAuth via Pro)
                          ▼
                  WebSocket stream ─▶  Web HUD  ─▶  piper TTS  ─▶  speakers
```

> ### ⚠️ Security
> JARVIS is an **autonomous agent with full, unsandboxed system access** — it runs
> arbitrary shell commands and reads/writes any file, without asking for confirmation.
> It has **no authentication** and is meant to be reached only from `localhost`.
> **Never expose port 8765 to the network or internet** (no `0.0.0.0`, no reverse
> proxy, no `ngrok`). See [SECURITY.md](SECURITY.md) before running.

## Layout

```
jarvis/
├── main.py              # FastAPI app + WebSocket + wake-word loop
├── stt.py               # faster-whisper wrapper
├── llm.py               # Claude Agent SDK + OpenRouter (dual backend)
├── task_manager.py      # ATE: parses task_plan/step/task_complete
├── tts.py               # piper wrapper (strips all <jarvis:*> tags first)
├── tools/{bash_exec,file_ops,hypr,web_search,memory}.py
│   memory.py            # SQLite + FTS5 full-text memory
│   audit.py             # security audit log + secret redaction
│   scheduler.py         # daily/interval/once scheduled prompts
│   channels.py          # Telegram bridge (reach JARVIS from your phone)
├── static/{index.html,style.css,jarvis.js}
└── system_prompt.txt

whatsapp-mcp/             # vendored WhatsApp MCP integration (optional)
├── whatsapp-bridge/      # Go service: WhatsApp session, QR pairing, REST API
└── whatsapp-mcp-server/  # Python MCP server: search/read/send tools
```

## Quick start

**Linux / macOS:**

```bash
git clone https://github.com/EliseyRotar/jarvis-ai && cd jarvis-ai
./start.sh
```

**Windows 11:**

```powershell
git clone https://github.com/EliseyRotar/jarvis-ai && cd jarvis-ai
.\start.ps1
```

`start.sh` / `start.ps1` is the single entry point — just run it. On first run
it opens a setup wizard at `http://127.0.0.1:8765` in your browser that:

- creates the virtualenv and installs all dependencies, streaming live
  install logs to the page (and, on Linux, tries to install `piper` /
  `ffmpeg` via your distro's package manager with passwordless sudo);
- lets you choose and configure the AI backend — **Claude Pro** (paste an
  OAuth token from `claude setup-token`), **OpenRouter** (API key), or fully
  offline **Ollama** (auto-detects local models) — with a **Verify** button
  that checks your token/key against the provider before you continue;
- lets you pick the Whisper STT size, enable/disable the "Hey Jarvis" wake
  word, and download piper offline TTS voices (English/Italian/Russian);
- collects a bit of personalization (your name, hardware) for the system
  prompt — hardware (CPU, RAM, GPU) is auto-detected and pre-filled, saved
  to `jarvis/personal info jarvis/system_prompt.txt`, never committed.
- lets you toggle optional **MCP integrations** — including **WhatsApp**: tick
  the box and a QR code appears right in the wizard, scan it with your phone
  (WhatsApp → Linked Devices → Link a device) and JARVIS can read/send WhatsApp
  messages from then on. See [WhatsApp integration](#whatsapp-integration).

On Windows, the wizard also installs `ffmpeg` via `winget` and downloads a
`piper.exe` binary automatically, so offline TTS works out of the box.

Once configured, it launches JARVIS and the page redirects to the live HUD.
On subsequent runs, `start.sh`/`start.ps1` skips the wizard and launches
JARVIS directly — if JARVIS is already running, it just opens your browser
to the HUD instead of failing to bind the port. Config and data live in
`~/.jarvis/` (`%USERPROFILE%\.jarvis\` on Windows).

On Windows, for audio playback install `ffmpeg` (`winget install ffmpeg`) or
`mpv`. Piper TTS binaries can be downloaded from the
[piper releases page](https://github.com/rhasspy/piper/releases) and added to
PATH (optional — edge-tts works without it). Hyprland-specific desktop control
(`hypr_dispatch`) is unavailable on Windows and degrades gracefully — JARVIS
uses `bash_exec`/PowerShell commands instead.

The manual steps below are for advanced users who'd rather configure things
themselves without the wizard.

## Manual setup

### 1 — System packages

| Distro | Command |
|--------|---------|
| Arch | `sudo pacman -S --needed python python-pip nodejs npm piper alsa-utils pipewire-pulse` |
| Debian/Ubuntu | `sudo apt install -y python3 python3-venv python3-pip nodejs npm pulseaudio-utils` |
| Fedora | `sudo dnf install -y python3 python3-pip nodejs npm pulseaudio-utils` |
| openSUSE | `sudo zypper install -y python3 python3-pip nodejs npm pulseaudio-utils` |

> `piper` may be packaged as `piper` or `piper-tts` depending on your distro; if it
> isn't in your repos, grab a release from
> [github.com/rhasspy/piper](https://github.com/rhasspy/piper/releases). JARVIS
> auto-detects either binary name.

### 2 — Install Claude Code CLI (auth gateway for Pro subscription)

```bash
npm install -g @anthropic-ai/claude-code
```

### 3 — Generate your OAuth token

```bash
claude setup-token
```

A browser opens; log in with your **Claude Pro account**. The terminal prints
a token of the form `sk-ant-oat01-...` — copy it.

### 4 — Save credentials

```bash
mkdir -p ~/.jarvis
cat > ~/.jarvis/.env <<'EOF'
CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-PASTE-YOUR-TOKEN-HERE
# Optional fallback when Claude fails / hits quota:
# OPENROUTER_API_KEY=sk-or-...
EOF
chmod 600 ~/.jarvis/.env
```

> ⚠️ **Do NOT also set `ANTHROPIC_API_KEY`** — it shadows the OAuth token and
> would bill against your API account instead of your Pro plan. If it's in
> your shell config, remove it.

### 5 — Python dependencies

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

### 6 — Piper voice models (English + Italian, ~50 MB each)

```bash
mkdir -p ~/.local/share/piper && cd ~/.local/share/piper
curl -LO https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/alan/medium/en_GB-alan-medium.onnx
curl -LO https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/alan/medium/en_GB-alan-medium.onnx.json
curl -LO https://huggingface.co/rhasspy/piper-voices/resolve/main/it/it_IT/riccardo/x_low/it_IT-riccardo-x_low.onnx
curl -LO https://huggingface.co/rhasspy/piper-voices/resolve/main/it/it_IT/riccardo/x_low/it_IT-riccardo-x_low.onnx.json
cd -
```

### 7 — Run

```bash
uvicorn jarvis.main:app --host 127.0.0.1 --port 8765
```

Open <http://127.0.0.1:8765>. Confirm via `curl localhost:8765/healthz`
that `"backend": "claude"`.

## How backend selection works

| State                                                       | Active backend |
| ----------------------------------------------------------- | -------------- |
| `CLAUDE_CODE_OAUTH_TOKEN` set, `ANTHROPIC_API_KEY` unset    | Claude Pro     |
| Only `OPENROUTER_API_KEY` set                               | OpenRouter     |
| Only `JARVIS_OLLAMA_MODEL` set                              | Ollama (offline) |
| Both Claude + OpenRouter set                                | Claude primary; OpenRouter fallback on failure |
| `JARVIS_LLM_BACKEND=claude` / `openrouter` / `ollama`       | Forced         |

Priority when multiple are configured: **Claude → OpenRouter → Ollama**. On Claude
failure or quota exhaustion, JARVIS automatically retries the turn on OpenRouter
(if you have a key for it).

### Fully offline with Ollama

No subscription, no internet, no data leaving your machine:

```bash
# install from https://ollama.com, then pull a tool-capable model:
ollama pull llama3.1          # or qwen2.5, mistral, etc.
echo "JARVIS_OLLAMA_MODEL=llama3.1" >> ~/.jarvis/.env
```

Tool calling requires a model that supports it (llama3.1, qwen2.5, mistral…).
Point at a remote Ollama host with `JARVIS_OLLAMA_URL=http://host:11434`.

### Extra tools via external MCP servers (Claude backend)

JARVIS can connect to any [Model Context Protocol](https://modelcontextprotocol.io)
server (GitHub, filesystem, web fetch, smart home, …) on top of its built-in tools.
Copy [`mcp.json.example`](mcp.json.example) to `~/.jarvis/mcp.json`, list your
servers (same format as Claude Code's `.mcp.json`), and restart. Tools from each
server become available to JARVIS automatically.

## WhatsApp integration

JARVIS ships with [`whatsapp-mcp`](whatsapp-mcp/) — a vendored copy of
[lharries/whatsapp-mcp](https://github.com/lharries/whatsapp-mcp) (MIT) — so it
can search your chats, read message history (including images, audio, and
documents), and send messages, files, and voice notes through **your own
WhatsApp account**, with no third-party server in the middle.

It has two parts:

- **`whatsapp-bridge`** (Go) — connects to WhatsApp's multi-device protocol,
  syncs your chats/messages into a local SQLite database, and exposes a small
  REST API on `localhost:8080`.
- **`whatsapp-mcp-server`** (Python, via `uv`) — an MCP server that gives
  JARVIS tools to search contacts, list chats, read messages, and send content
  by talking to the bridge.

### Easiest: pair during setup

In the setup wizard's **Integrations** step, tick **WhatsApp**. JARVIS launches
the bridge and shows a live QR code right in the page — open WhatsApp on your
phone, go to **Settings → Linked Devices → Link a device**, and scan it. Once
linked, the wizard marks it "✓ Linked" and writes the server entry to
`~/.jarvis/mcp.json` automatically.

### Manual setup

```bash
# 1. Build and run the bridge once to pair via QR code (terminal + qr.png):
cd whatsapp-mcp/whatsapp-bridge
./run.sh        # Linux/macOS — builds with Go + CGO on first run
# .\run.ps1     # Windows

# 2. Add the MCP server to ~/.jarvis/mcp.json (see mcp.json.example):
#    "whatsapp": {
#      "command": "uv",
#      "args": ["--directory", "/path/to/jarvis-ai/whatsapp-mcp/whatsapp-mcp-server", "run", "main.py"]
#    }
```

The bridge needs Go + a C compiler (CGO, for `go-sqlite3`) to build, and the
MCP server needs [`uv`](https://docs.astral.sh/uv/). Both are one-time
requirements — after the first build/pairing, restarting JARVIS is enough.

**Keeping it running:** the bridge must stay running for messages to sync and
for sends to work. On Windows, point a Scheduled Task (trigger: at logon) at
`whatsapp-bridge.exe`; on Linux, a systemd user service or your window manager's
autostart works well.

**Data & privacy:** all session data, message history, and media live in
`whatsapp-mcp/whatsapp-bridge/store/` (gitignored, never leaves your machine).
Delete that folder to unlink and re-pair from scratch.

## Cost notes — Claude Pro programmatic credits

Starting **June 15, 2026**, programmatic usage (SDK / CLI / third-party tools)
draws from a separate monthly credit pool, billed at full API rates:

- **Pro:** $20/month
- **Max 5x:** $100/month
- **Max 20x:** $200/month

Sonnet 4.5 is ~$3/M input, $15/M output — comfortably hundreds of JARVIS turns
per day on Pro. Tight long sessions may exhaust it; that's where the
OpenRouter fallback (with free-tier models like `openai/gpt-oss-120b:free`)
keeps the lights on.

## Environment variables

| Variable                    | Default                                                | Notes |
| --------------------------- | ------------------------------------------------------ | ----- |
| `CLAUDE_CODE_OAUTH_TOKEN`   | *(get from `claude setup-token`)*                       | Claude Pro auth |
| `JARVIS_CLAUDE_MODEL`       | `claude-sonnet-4-6`                                    | Any Claude model your subscription allows |
| `JARVIS_LLM_BACKEND`        | `auto`                                                 | `claude` / `openrouter` / `ollama` / `auto` |
| `OPENROUTER_API_KEY`        | unset                                                  | Optional fallback |
| `JARVIS_MODEL`              | `openai/gpt-oss-120b:free`                             | OpenRouter model id |
| `JARVIS_OLLAMA_MODEL`       | unset                                                  | Set to activate offline Ollama (e.g. `llama3.1`) |
| `JARVIS_OLLAMA_URL`         | `http://localhost:11434`                               | Ollama host |
| `ANTHROPIC_API_KEY`         | **unset**                                              | If set, shadows OAuth — avoid |
| `JARVIS_WHISPER_MODEL`      | `base.en`                                              | `tiny.en`, `base.en`, `small.en`, ... |
| `JARVIS_WHISPER_DEVICE`     | `cpu`                                                  | `cuda` if available |
| `JARVIS_WHISPER_COMPUTE`    | `int8`                                                 | `int8_float16` for GPU |
| `JARVIS_PIPER_BIN`          | `piper`                                                | Path to piper binary |
| `JARVIS_PIPER_MODEL_EN`     | `~/.local/share/piper/en_GB-alan-medium.onnx`          | English voice |
| `JARVIS_PIPER_MODEL_IT`     | `~/.local/share/piper/it_IT-riccardo-x_low.onnx`       | Italian voice |
| `JARVIS_WAKE_MODEL`         | `hey_jarvis`                                           | openwakeword model id |
| `JARVIS_WAKE_THRESHOLD`     | `500`                                                  | /1000 of model score |
| `JARVIS_CAPTURE_SECONDS`    | `5`                                                    | Seconds to capture after wake |
| `JARVIS_DISABLE_WAKEWORD`   | unset                                                  | `1` to skip mic init |
| `SEARX_URL`                 | unset                                                  | e.g. `http://localhost:8080` |
| `BRAVE_API_KEY`             | unset                                                  | Used if SearXNG isn't configured |
| `JARVIS_TELEGRAM_TOKEN`     | unset                                                  | Bot token (from @BotFather) to reach JARVIS via Telegram |
| `JARVIS_TELEGRAM_ALLOWED_IDS` | unset                                                | Comma-separated chat ids allowed to message the bot |
| `JARVIS_LOG_LEVEL`          | `INFO`                                                 | `DEBUG` for verbose |

## Persistent stores

JARVIS keeps everything local under `~/.jarvis/` (`%USERPROFILE%\.jarvis\` on Windows):

| File | Contents |
| ---- | -------- |
| `memory.db` | Long-term memory — SQLite with **FTS5 full-text search** (BM25-ranked). Legacy `memory.json` is migrated automatically on first run. |
| `audit.db` | Append-only **security audit log** of every tool call, with automatic secret redaction (API keys, tokens, private keys). Ask JARVIS "what have you done" to review it. |
| `scheduler.db` | **Scheduled jobs** — prompts that run on a daily/interval/once schedule (e.g. a 6am morning brief). Say "every morning, brief me on…" to create one. |
| `mcp.json` | External MCP connectors enabled via the setup wizard. |

WhatsApp session data (paired device, messages, media) lives separately in
`whatsapp-mcp/whatsapp-bridge/store/` inside the repo — see
[WhatsApp integration](#whatsapp-integration).

## How it works

- `~/.jarvis/.env` is loaded automatically on startup.
- The browser opens a WebSocket to `/ws`. Server messages are small JSON
  envelopes (`think_delta`, `tool_call`, `tool_result`, `task_update`,
  `speaking`, etc.).
- `llm.py` runs the agentic turn — picks Claude or OpenRouter based on
  available credentials. Both backends feed text through the same
  `StreamParser`, which separates `<jarvis:think>` blocks from spoken text
  in real time and recognises `<jarvis:task_plan>`, `<jarvis:step .../>`,
  `<jarvis:task_complete>`.
- Tool calls (from either backend) are dispatched locally to the same
  `dispatch_tool` function — bash, file ops, hyprctl, web search, memory, TTS.
- `tts.py` strips ALL `<jarvis:*>` markup before piping to piper, so the
  spoken output is always clean.
- The wake-word loop runs in the background via `openwakeword` +
  `sounddevice`; if either is unavailable the UI still works via text or
  the in-browser mic.

## Web UI controls

| Button | Action |
|--------|--------|
| **EXEC** | Send a text message |
| **MIC** | Hold to record voice (browser MediaRecorder → 16 kHz PCM) |
| **ABORT** | Cancel the current LLM turn and stop TTS mid-sentence |
| **Model selector** (header) | Switch between HAIKU 4.5 / SONNET 4.6 / OPUS 4.7 live — resets the SDK session, takes effect on the next turn |
| **SHUTDOWN** (header) | Gracefully stop the entire JARVIS process (saves history first) |

## Reset / debug

- `POST /reset` — clears the conversation history AND disconnects the
  persistent Claude SDK session, forcing a fresh one on the next turn.
- `GET /healthz` — current backend, credentials state, model, conversation
  length.
- `JARVIS_LOG_LEVEL=DEBUG` — verbose logging.

## Troubleshooting

**`backend: "none"` in `/healthz`** — neither token is set. Check
`~/.jarvis/.env` exists and `CLAUDE_CODE_OAUTH_TOKEN=` is on a line.

**`anthropic_api_key_shadowing: true`** — `ANTHROPIC_API_KEY` is set in your
environment. Remove it from `~/.zshrc` / `~/.bashrc` and restart the shell.

**"Claude SDK connect failed"** — the `claude` CLI isn't on PATH. Re-install
with `npm install -g @anthropic-ai/claude-code` and verify `which claude`.

**Wake-word silent** — confirm a mic is detected: `python -c "import sounddevice as sd; print(sd.query_devices())"`. Tweak `JARVIS_WAKE_THRESHOLD` if it triggers
too rarely / too often.
