# Contributing

Thanks for your interest in JARVIS. Contributions are welcome — bug fixes, new tools, voice improvements, UI polish.

## Getting started

```bash
git clone https://github.com/EliseyRotar/jarvis-ai
cd jarvis-ai
python -m venv .venv && source .venv/bin/activate
pip install -e ".[wakeword]"
cp .env.example ~/.jarvis/.env   # fill in your credentials
```

## What's worth contributing

- **New tools** — add a file under `jarvis/tools/`, register it in `llm.py` (`TOOL_SCHEMAS` + `dispatch_tool`), and document it in the system prompt.
- **STT / TTS backends** — `stt.py` and `tts.py` are self-contained wrappers; swapping backends is straightforward.
- **UI improvements** — `jarvis/static/` is plain HTML/CSS/JS, no build step needed.
- **Cross-platform support** — currently Arch Linux / Hyprland only; PRs making `hypr.py` gracefully degrade on other systems are welcome.
- **Bug fixes** — open an issue first if the fix is non-trivial.

## Style

- Python: follow the existing style (no type stubs required, but type hints on public functions are appreciated).
- JS: vanilla ES2020+, no frameworks, no build step.
- No new dependencies without a good reason — keep the install lean.

## Pull requests

1. Fork → branch off `main`
2. Make your change with a clear commit message
3. Open a PR describing *what* and *why*
4. Keep PRs focused — one feature or fix per PR

## Sensitive data

Never commit real credentials, tokens, or API keys. The `.gitignore` excludes `.env` files, but double-check before pushing.
