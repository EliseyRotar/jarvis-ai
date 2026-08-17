"""Context window management — token estimation, per-model limits, and multi-stage compression.

Works across all LLM backends (Claude, OpenRouter, Ollama) to prevent context
overflow errors before they happen, and recover gracefully when they do.
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any

log = logging.getLogger("jarvis.context")

# ──────────────────────────────────────────────────────────────────────────
# Per-model context window limits (in tokens)
# ──────────────────────────────────────────────────────────────────────────

MODEL_CONTEXT_LIMITS: dict[str, int] = {
    # Claude models
    "claude-haiku-4-5": 200_000,
    "claude-sonnet-4-6": 200_000,
    "claude-opus-4-7": 200_000,
    # OpenRouter popular models (conservative estimates)
    "openai/gpt-oss-120b:free": 32_000,
    "openai/gpt-4o": 128_000,
    "openai/gpt-4o-mini": 128_000,
    "google/gemini-2.5-pro": 1_000_000,
    "google/gemini-2.5-flash": 1_000_000,
    "anthropic/claude-sonnet-4-6": 200_000,
    "meta-llama/llama-3.1-405b": 128_000,
    "meta-llama/llama-3.1-70b": 128_000,
    "meta-llama/llama-3.1-8b": 128_000,
    "mistralai/mistral-large": 128_000,
    "deepseek/deepseek-chat-v3": 64_000,
    "qwen/qwen-2.5-72b-instruct": 32_000,
    # Ollama models (defaults — can be overridden with num_ctx)
    "llama3.1": 128_000,
    "llama3.2": 128_000,
    "qwen2.5": 32_000,
    "qwen2.5-coder": 32_000,
    "qwen2.5-coder:14b": 32_000,
    "qwen3": 40_000,
    "qwen3:0.6b": 40_000,
    "qwen3.5": 262_000,
    "qwen3.5:0.8b": 262_000,
    "mycoder": 32_000,
    "mycoder:latest": 32_000,
    "dolphin-mistral": 32_000,
    "mistral": 32_000,
    "gemma2": 8_000,
    "phi3": 4_000,
}

DEFAULT_CONTEXT_LIMIT = 32_000
RESPONSE_TOKEN_RESERVE = 4_096


def _estimate_tokens(text: str) -> int:
    """Estimate token count from text. ~4 chars per token is industry standard."""
    return max(1, len(text) // 4)


def estimate_messages_tokens(messages: list[dict[str, Any]]) -> int:
    """Estimate total token count for a list of messages."""
    total = 0
    for msg in messages:
        content = msg.get("content", "")
        if isinstance(content, str):
            total += _estimate_tokens(content)
        elif isinstance(content, list):
            for block in content:
                if isinstance(block, dict):
                    total += _estimate_tokens(block.get("text", ""))
                elif isinstance(block, str):
                    total += _estimate_tokens(block)
        # Tool calls in the message add tokens too
        for tc in msg.get("tool_calls", []):
            fn = tc.get("function", {})
            total += _estimate_tokens(fn.get("name", ""))
            total += _estimate_tokens(fn.get("arguments", ""))
        total += 4  # per-message overhead (role, formatting)
    return total


def get_context_limit(model: str) -> int:
    """Get context window limit for a model, with fuzzy matching."""
    if model in MODEL_CONTEXT_LIMITS:
        return MODEL_CONTEXT_LIMITS[model]
    # Try prefix matching (e.g. "claude-sonnet-4-6" matches "claude-sonnet-4-6-20250514")
    for known, limit in MODEL_CONTEXT_LIMITS.items():
        if model.startswith(known) or known.startswith(model):
            return limit
    # Try base name matching for Ollama models (e.g. "llama3.1:latest" → "llama3.1")
    base = model.split(":")[0]
    if base in MODEL_CONTEXT_LIMITS:
        return MODEL_CONTEXT_LIMITS[base]
    return DEFAULT_CONTEXT_LIMIT


def get_token_budget(model: str) -> int:
    """Get usable token budget (context limit minus response reserve)."""
    return get_context_limit(model) - RESPONSE_TOKEN_RESERVE


# ──────────────────────────────────────────────────────────────────────────
# Context-overflow error detection
# ──────────────────────────────────────────────────────────────────────────

_CONTEXT_ERROR_PATTERNS = [
    re.compile(r"context.?length.?exceed", re.IGNORECASE),
    re.compile(r"maximum.?context.?length", re.IGNORECASE),
    re.compile(r"too.?many.?tokens", re.IGNORECASE),
    re.compile(r"token.?limit", re.IGNORECASE),
    re.compile(r"input.?too.?long", re.IGNORECASE),
    re.compile(r"exceeds.*model.*maximum", re.IGNORECASE),
    re.compile(r"prompt.?is.?too.?long", re.IGNORECASE),
    re.compile(r"1M.?context", re.IGNORECASE),
    re.compile(r"usage.?credits.?required.*context", re.IGNORECASE),
    re.compile(r"max_tokens.*exceeds", re.IGNORECASE),
    re.compile(r"request.?too.?large", re.IGNORECASE),
    re.compile(r"num_ctx", re.IGNORECASE),
]


def is_context_overflow_error(error_text: str) -> bool:
    """Detect if an error is a context window overflow."""
    return any(p.search(error_text) for p in _CONTEXT_ERROR_PATTERNS)


# ──────────────────────────────────────────────────────────────────────────
# 4-stage context compression (inspired by OpenJarvis's LoopGuard)
# ──────────────────────────────────────────────────────────────────────────


def trim_messages(
    messages: list[dict[str, Any]],
    model: str,
    *,
    budget_ratio: float = 0.75,
) -> list[dict[str, Any]]:
    """Trim messages to fit within the model's context window.

    Uses a 4-stage approach:
      1. Truncate old tool results (first half of conversation)
      2. Sliding window — keep system messages + most recent
      3. Aggressively truncate remaining tool results
      4. Nuclear — system + last 2 exchanges

    Args:
        messages: Full conversation history.
        model: Model identifier for looking up context limits.
        budget_ratio: Fraction of context window to target (default 75%).

    Returns:
        Trimmed message list that fits within budget.
    """
    budget = int(get_context_limit(model) * budget_ratio)
    current_tokens = estimate_messages_tokens(messages)

    if current_tokens <= budget:
        return messages

    log.info(
        "context compression: %d tokens > %d budget (model=%s), trimming",
        current_tokens, budget, model,
    )

    # Stage 1: Truncate old tool results in the first half
    result = _stage1_truncate_old_tool_results(messages)
    if estimate_messages_tokens(result) <= budget:
        log.info("stage 1 sufficient: %d tokens", estimate_messages_tokens(result))
        return result

    # Stage 2: Sliding window — keep system + recent messages
    result = _stage2_sliding_window(result, budget)
    if estimate_messages_tokens(result) <= budget:
        log.info("stage 2 sufficient: %d tokens", estimate_messages_tokens(result))
        return result

    # Stage 3: Aggressively truncate ALL tool results
    result = _stage3_aggressive_tool_truncation(result)
    if estimate_messages_tokens(result) <= budget:
        log.info("stage 3 sufficient: %d tokens", estimate_messages_tokens(result))
        return result

    # Stage 4: Nuclear — keep only system prompt + last 2 exchanges
    result = _stage4_nuclear(result)
    log.info("stage 4 (nuclear): %d tokens", estimate_messages_tokens(result))
    return result


def _stage1_truncate_old_tool_results(
    messages: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Replace tool result content in the first half with a short placeholder."""
    threshold = len(messages) // 2
    result = []
    for i, msg in enumerate(messages):
        if i < threshold and msg.get("role") == "tool":
            content = msg.get("content", "")
            if isinstance(content, str) and len(content) > 200:
                truncated = dict(msg)
                truncated["content"] = content[:100] + "\n... [truncated, see recent results]"
                result.append(truncated)
                continue
        result.append(msg)
    return result


def _stage2_sliding_window(
    messages: list[dict[str, Any]],
    budget: int,
) -> list[dict[str, Any]]:
    """Keep system messages + fill remaining budget with most recent messages."""
    system_msgs = [m for m in messages if m.get("role") == "system"]
    non_system = [m for m in messages if m.get("role") != "system"]

    system_tokens = estimate_messages_tokens(system_msgs)
    remaining_budget = budget - system_tokens

    # Walk backwards through non-system messages, keeping what fits
    kept: list[dict[str, Any]] = []
    used = 0
    for msg in reversed(non_system):
        msg_tokens = estimate_messages_tokens([msg])
        if used + msg_tokens > remaining_budget:
            break
        kept.insert(0, msg)
        used += msg_tokens

    return system_msgs + kept


def _stage3_aggressive_tool_truncation(
    messages: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Truncate ALL tool results and long assistant messages."""
    result = []
    for msg in messages:
        if msg.get("role") == "tool":
            content = msg.get("content", "")
            if isinstance(content, str) and len(content) > 100:
                truncated = dict(msg)
                truncated["content"] = "[Tool result truncated]"
                result.append(truncated)
                continue
        elif msg.get("role") == "assistant":
            content = msg.get("content", "")
            if isinstance(content, str) and len(content) > 2000:
                truncated = dict(msg)
                truncated["content"] = content[:1000] + "\n... [response truncated]"
                result.append(truncated)
                continue
        result.append(msg)
    return result


def _stage4_nuclear(
    messages: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Emergency: keep only system prompt + last 2 user/assistant exchanges."""
    system_msgs = [m for m in messages if m.get("role") == "system"]
    non_system = [m for m in messages if m.get("role") != "system"]
    # Keep last 4 non-system messages (roughly 2 exchanges)
    return system_msgs + non_system[-4:]


# ──────────────────────────────────────────────────────────────────────────
# In-memory conversation trimming
# ──────────────────────────────────────────────────────────────────────────


def trim_conversation_in_place(
    conversation: list[dict[str, Any]],
    max_messages: int = 100,
) -> int:
    """Trim an in-memory conversation list, keeping system messages + recent.

    Returns the number of messages removed.
    """
    system_msgs = [m for m in conversation if m.get("role") == "system"]
    non_system = [m for m in conversation if m.get("role") != "system"]

    if len(non_system) <= max_messages:
        return 0

    removed = len(non_system) - max_messages
    kept = non_system[-max_messages:]
    conversation.clear()
    conversation.extend(system_msgs + kept)
    log.info("trimmed %d old messages from conversation (kept %d)", removed, max_messages)
    return removed
