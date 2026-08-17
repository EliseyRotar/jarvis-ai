# J.A.R.V.I.S.

> Just A Rather Very Intelligent System — a local, voice-driven AI operator for
> Linux and Windows. Backed by **Hermes Agent** (v0.20.1) with Ollama Cloud, plus
> Hermes' built-in toolset and MCP ecosystem (WhatsApp, Firefox, Android,
> Playwright, and more).
>
> Runs on **Windows 11** natively (Hermes + JARVIS voice server + MCP servers all
> run on the host). Linux works too — no WSL required.

![JARVIS orb](docs/img/orb.png)

## Architecture

JARVIS is a thin voice + UI layer on top of **Hermes Agent**. Hermes owns the
brain (LLM, tools, memory, MCP servers, sessions); JARVIS owns the wake-word loop,
WebSocket bridge to the React HUD, and the orb canvas.

```
   voice input
       │
       ▼
┌──────────────┐    wake-word   ┌─────────────────┐    SSE stream    ┌──────────────┐
│  microphone  │ ─────────────▶│  JARVIS voice   │ ────────────────▶│  React HUD   │
│  (openwakew.) │   "hey jarvis"│  server :8765   │   (WS /api/ws)   │  orb + chat  │
└──────────────┘                └─────────────────┘                   └──────────────┘
                                          │
                                          ▼
                                   ┌─────────────────┐    MCP stdio     ┌──────────────┐
                                   │  Hermes gateway │ ────────────────▶│  whatsapp    │
                                   │  :8642          │                  │  firefox     │
                                   │  Ollama Cloud   │                  │  android     │
                                   │  (gpt-oss:120b) │                  │  + more      │
                                   └─────────────────┘                  └──────────────┘
                                          │
                                          ▼
                                  Hermes profiles
                                  (jarvis / eli6 / wwf / custom)
```

## Features

- **Hermes Agent brain** — full agent SDK, multi-profile, sessions, memory,
  todo planning, MCP tool ecosystem.
- **Voice-first** — "Hey Jarvis" wake word (openwakeword), faster-whisper STT,
  Piper offline TTS, Italian + English out of the box.
- **Per-project profiles** — each major project gets its own Hermes profile
  (SOUL.md, memory, session, terminal cwd). Switch via orb button, voice
  command, or `POST /api/mode {"mode": "wwf"}`.
- **Persona overrides** — JARVIS (default, British butler) and ELI6 (direct
  co-founder voice) are orthogonal to project mode; you can be ELI6 in any
  project.
- **Ultron Three.js orb** — holographic orb with bloom + chromatic aberration,
  state-reactive modulation (wake flash, speaking surge, listening mic-amp,
  thinking spin, mode-themed brightness).
- **Compact task tracker** — Agentic Task Engine renders live `todo` tool calls
  as a click-to-expand pill on the orb console.
- **MCP servers** — WhatsApp (read/send messages, files, voice), Firefox
  (Playwright-driven, persistent profile), Android (mobile-mcp for tap/swipe/
  screenshot/launch on wireless-ADB devices). Add more via `hermes mcp add`.
- **Voice-driven project onboarding** — say "JARVIS, create a new project
  called finance" to open the wizard pre-filled.
- **Subagents** — `/research`, `/review`, `/email`, `/write` slash commands
  prepend role-specific prompts to the active profile; or quick-launch via
  buttons on the orb console.
- **Project wizard** — UI panel on the Settings page (or CLI) that creates a
  Hermes profile, generates a SOUL.md from your answers, restarts the gateway,
  and verifies the new profile is live. Add a new project in under a minute.

> ### ⚠️ Security
> JARVIS has full, unsandboxed system access — the Hermes agent executes shell
> commands and reads/writes files without confirmation. It binds only to
> localhost. **Never expose port 8765 or 8642 to the network.** Hermes' own
> threat scanner blocks known prompt-injection patterns; see Hermes docs for
> details.

## Quick start

### Windows 11

```powershell
# 1. Clone (or download) and cd into the repo
cd jarvis-ai

# 2. One-time bootstrap (creates venv, installs deps, runs the wizard)
.\start.ps1 -Bootstrap

# 3. Subsequent runs — start the gateway + voice server
.\start.ps1

# 4. Open the orb HUD
start http://127.0.0.1:8765/

# 5. Shut down
.\stop.ps1
```

`start.ps1` orchestrates: kills stale processes, starts Hermes gateway on
`127.0.0.1:8642`, waits for `/health`, starts JARVIS voice server on
`127.0.0.1:8765`, writes PIDs to `.jarvis.pids` for `stop.ps1`.

### Adding a new project

Say "JARVIS, create a new project called finance" — the wizard opens
pre-filled. Or open Settings → Projects → Add project.

Required: name (kebab-case), absolute working-directory path. Optional:
project title, description, tech stack, key conventions. The wizard generates
a SOUL.md, creates the profile directory under `~/.hermes/profiles/<name>/`,
restarts the gateway, and verifies the new profile is live.

To switch to a project after creation: orb console → mode button, or
"switch to project <name>", or `POST /api/mode {"mode":"<name>"}`.

## Configuration

### Environment

- `JARVIS_HERMES_URL` — Hermes API server base URL (default
  `http://127.0.0.1:8642`).
- `JARVIS_HERMES_API_KEY` — default profile key (or read from
  `~/.hermes/.env`).
- `JARVIS_HERMES_WWF_KEY` / `JARVIS_HERMES_ELI6_KEY` — per-profile overrides.
- `JARVIS_DISABLE_WAKEWORD=1` — disable the openwakeword loop (text only).
- `JARVIS_WAKE_MODEL` — openwakeword model id (default `hey_jarvis`).

### Files

- `~/.hermes/SOUL.md` — JARVIS default persona.
- `~/.hermes/profiles/<name>/SOUL.md` — per-project persona + context.
- `~/.hermes/profiles/<name>/.env` — `API_SERVER_KEY` + provider keys.
- `~/.hermes/profiles/<name>/config.yaml` — model, cwd, terminal settings.
- `~/.jarvis/projects.json` — JARVIS-side record of created projects.
- `~/.jarvis/mcp.json` — legacy JARVIS MCP config (retired; Hermes owns MCPs).

### Switching voices (personas)

`POST /api/persona {"persona":"eli6"}` — switches the voice layer. Persona is
orthogonal to project mode.

| Persona | Voice | Use case |
|---|---|---|
| `jarvis` | British butler, dry wit, "sir" | Default. Coding, dev work, anything where formal feedback helps. |
| `eli6`  | Direct, lowercase, opinionated | Fast iteration, "don't tell me I'm right, tell me what's wrong." |

## MCP servers

| Name | Tools | Setup |
|---|---|---|
| **whatsapp** | search_contacts, list_messages, list_chats, send_message, send_file, send_audio_message, download_media | Run the Go bridge (`whatsapp-mcp/whatsapp-bridge/whatsapp-bridge.exe`) and scan the QR. |
| **firefox** | browser_navigate, browser_click, browser_type, browser_take_screenshot, browser_snapshot, … | Spawns its own Firefox via Playwright. Profile at `~/.hermes/firefox-profile`. |
| **android** | mobile_click_on_screen_at_coordinates, mobile_swipe_on_screen, mobile_take_screenshot, mobile_launch_app, mobile_open_url, … | `adb pair <phone_ip>:<port> <code>` then `adb connect <phone_ip>:<port>`. |
| **playwright** (alt) | Same as firefox but Chrome — not registered by default. | `hermes mcp add playwright --command npx --args "-y","@playwright/mcp@latest"` |

Add more via `hermes mcp add <name> --command <cmd> --args ...`.

## Subagents

Slash commands (in chat or via WS):

- `/research <question>` — web search + synthesis with citations.
- `/review <file or branch>` — code review grouped by severity.
- `/email <recipient + context>` — drafts email in your voice.
- `/write <topic>` — polished copy / docs with audience + word-count meta.

Or quick-launch via the right-side buttons on the orb console.

## Development

```bash
# Lint / typecheck the frontend
cd jarvis/web && npm run build

# Run all existing tests
.venv/Scripts/python.exe -m pytest tests/ -q

# Rebuild the frontend after a change
cd jarvis/web && npm run build
# (the built assets go to jarvis/static/dist/)
```

### Repository layout

```
jarvis-ai/
├── start.ps1, stop.ps1            # one-command lifecycle
├── bootstrap.py                   # first-run wizard (venv, deps, Hermes install)
├── jarvis/
│   ├── main.py                    # FastAPI + WebSocket + wake-word loop
│   ├── hermes_client.py           # bridge to Hermes Sessions API
│   ├── persona.py                 # voice-layer overrides (jarvis/eli6)
│   ├── stream_parser.py           # tag-aware streaming parser
│   ├── voice_intents.py           # deterministic voice commands
│   ├── subagents/                 # role-prefixed LLM wrappers
│   ├── admin/add_project.py       # project wizard (CLI + HTTP)
│   ├── web/                       # React + Vite frontend
│   ├── tools/                     # memory, connectors, channels
│   └── static/dist/               # built frontend (gitignored or committed)
└── tests/                         # pytest suite
```

## License

Same as before — see `LICENSE`.
