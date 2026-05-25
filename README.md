# J.A.R.V.I.S.

> Just A Rather Very Intelligent System — a local, voice-driven AI operator for
> Linux. Backed by your **Claude Pro** subscription, **OpenRouter**, or a
> fully-offline **Ollama** model.
>
> Runs on **any Linux distro**. Hyprland gets deep window-manager integration via
> the `hypr_dispatch` tool; on other desktops that tool degrades gracefully and
> JARVIS controls things through plain shell commands instead.

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
├── static/{index.html,style.css,jarvis.js}
└── system_prompt.txt
```

## Quick start

```bash
git clone https://github.com/EliseyRotar/jarvis-ai && cd jarvis-ai
./setup.sh        # detects your distro, installs deps, prompts for token + settings
./run_optimized.sh
```

`setup.sh` is interactive and idempotent — it detects your package manager and
desktop, creates the venv, asks for your Claude/OpenRouter token, lets you pick a
model + STT size, downloads piper voices, and generates a personalized system
prompt. The manual steps below are for when you'd rather configure things yourself.

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
| `JARVIS_LOG_LEVEL`          | `INFO`                                                 | `DEBUG` for verbose |

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
