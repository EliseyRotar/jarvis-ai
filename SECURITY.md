# Security

## ⚠️ Read this before running JARVIS

JARVIS is an **autonomous agent with full system access**. By design it:

- Runs **arbitrary shell commands** on your machine (`bash_exec`) with no sandbox.
- Reads, writes, and deletes **any file** your user can access (`file_ops`).
- Controls your window manager, installs packages, manages services.
- Runs the LLM in `bypassPermissions` mode — it does **not** ask before acting.

This is intentional — it's what makes JARVIS useful as a local operator. But it means
**JARVIS can do anything you can do from a terminal**, including destructive actions.

## Threat model

JARVIS is built to be reached **only from `localhost`**. The server binds to
`127.0.0.1:8765` and there is **no authentication** on any endpoint or on the
WebSocket. Anyone who can send a request to that port can make JARVIS execute
commands on your machine.

### Do

- Keep the bind address at `127.0.0.1` (the default).
- Keep `~/.jarvis/.env` at `chmod 600` — it holds your Claude/OpenRouter tokens.
- Review what you ask JARVIS to do, especially anything destructive or irreversible.

### Do NOT

- **Do not expose the port to the network or the internet.** Do not put it behind
  a public reverse proxy, `ngrok`, `localtunnel`, port-forwarding, or bind to
  `0.0.0.0`. Doing so hands remote code execution on your machine to anyone who
  finds the URL.
- Do not run JARVIS as `root`.
- Do not commit `~/.jarvis/.env`, `memory.json`, `history.json`, or anything from
  `jarvis/personal info jarvis/` — these are gitignored for a reason.

## Credentials

- `CLAUDE_CODE_OAUTH_TOKEN` and `OPENROUTER_API_KEY` live in `~/.jarvis/.env`,
  outside the repository and excluded by `.gitignore`.
- If a token is ever leaked, revoke it: rotate the OAuth token with
  `claude setup-token`, or regenerate the OpenRouter key at openrouter.ai.

## Reporting a vulnerability

This is a personal/hobby project with no formal security support. If you find an
issue, open a GitHub issue (for non-sensitive bugs) or contact the maintainer
privately for anything that could be abused.
