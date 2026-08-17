"""Specialized JARVIS subagents.

Each subagent is a thin wrapper around Hermes: a role-specific system prompt
prefix that wraps the user's input before sending it to the LLM. Subagents
share the active Hermes profile (jarvis / eli6 / wwf / custom) — they do NOT
have their own memory or session, so per-project context still works.

To add a new subagent:
  1. Add an entry to SUBAGENTS below.
  2. (Optional) Add a quick-launch button in OrbConsole or SettingsPage.
  3. Done.

The 4 built-ins cover the user's most common asks. They are intentionally
short — Hermes' own SOUL.md gives the persona, the project SOUL.md gives the
context, and the subagent prefix gives the role focus.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass

log = logging.getLogger("jarvis.subagents")


@dataclass(frozen=True)
class SubagentSpec:
    name: str
    label: str
    description: str
    system_prefix: str
    slash_command: str          # /research, /review, etc.
    icon: str                   # for UI


SUBAGENTS: dict[str, SubagentSpec] = {
    "researcher": SubagentSpec(
        name="researcher",
        label="Researcher",
        description="Web research + synthesis. Uses web_search/web_extract + memory.",
        slash_command="/research",
        icon="search",
        system_prefix=(
            "You are JARVIS in RESEARCHER MODE. The operator wants a thorough, "
            "well-cited answer to a question. Use web_search and web_extract to "
            "gather primary sources (Wikipedia, official docs, recent news). "
            "Synthesize a concise report with: (1) the direct answer, (2) key "
            "supporting facts with URLs, (3) any caveats or contradictions. "
            "Cite inline as [n] where n maps to the URL list at the bottom. "
            "Match the operator's language. If the question is project-specific, "
            "use session_search to recall prior project context first."
        ),
    ),
    "reviewer": SubagentSpec(
        name="reviewer",
        label="Code reviewer",
        description="Read a file or branch and surface issues, risk, and improvements.",
        slash_command="/review",
        icon="code",
        system_prefix=(
            "You are JARVIS in CODE REVIEWER MODE. The operator wants a "
            "structured review of the file(s) or branch they specify. Produce "
            "(1) a one-paragraph summary of what the code does, (2) a bulleted "
            "list of issues grouped by severity [BLOCKER, MAJOR, MINOR, NIT], "
            "(3) concrete suggested fixes (with file paths and line numbers), "
            "(4) a test-coverage note. Be terse — no fluff. If reviewing a "
            "diff, focus on the changes, not unchanged code. If asked to "
            "review a single file, read it first."
        ),
    ),
    "email": SubagentSpec(
        name="email",
        label="Email assistant",
        description="Draft professional emails in the operator's voice.",
        slash_command="/email",
        icon="mail",
        system_prefix=(
            "You are JARVIS in EMAIL ASSISTANT MODE. The operator wants you to "
            "draft (or improve) an email. Output ONLY the email — no preamble, "
            "no 'Here's a draft:' header. Use a clear subject line, then the "
            "body. Match the operator's tone from any context they give (the "
            "recipient, prior emails, the project). Default to concise and "
            "professional; flag any tone adjustments ('more casual', 'shorter') "
            "as a one-line note AFTER the email body, in brackets. If they ask "
            "for a reply to a received email, treat their input as the received "
            "email + any reply notes."
        ),
    ),
    "writer": SubagentSpec(
        name="writer",
        label="Content writer",
        description="Write or edit blog posts, docs, READMEs, copy.",
        slash_command="/write",
        icon="pencil",
        system_prefix=(
            "You are JARVIS in CONTENT WRITER MODE. The operator wants "
            "polished written content — blog posts, documentation, README "
            "sections, marketing copy, social posts. Match the voice they "
            "specify (or infer from examples). Default: clear, active voice, "
            "short paragraphs, no marketing fluff, no em-dashes unless they "
            "ask. Always include a one-line meta-note at the top describing "
            "the piece's intended audience and word count."
        ),
    ),
}


def list_subagents() -> list[dict[str, str]]:
    return [
        {"name": s.name, "label": s.label, "description": s.description,
         "slash_command": s.slash_command, "icon": s.icon}
        for s in SUBAGENTS.values()
    ]


def get_subagent(name: str) -> SubagentSpec | None:
    return SUBAGENTS.get(name)


def wrap_prompt(subagent: SubagentSpec, user_prompt: str) -> str:
    """Prepend the subagent's role prompt to the user's text.

    The base Hermes profile (jarvis/eli6/wwf/custom) is untouched — the user
    still gets their persona + project context from the active profile, plus
    the role focus from the subagent.
    """
    return f"{subagent.system_prefix}\n\n---\n\n{user_prompt}"


def slash_to_subagent(command: str) -> tuple[SubagentSpec | None, str]:
    """Map a "/research foo bar" typed input to (subagent, stripped_prompt).

    Returns (None, original_text) if no slash command matched.
    """
    text = command.strip()
    for spec in SUBAGENTS.values():
        if text.lower().startswith(spec.slash_command + " "):
            rest = text[len(spec.slash_command) + 1:].strip()
            return spec, rest
        if text.lower() == spec.slash_command:
            return spec, ""
    return None, text
