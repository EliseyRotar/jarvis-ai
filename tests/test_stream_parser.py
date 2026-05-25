"""Tests for the streaming tag-aware parser in jarvis.llm."""
from jarvis.llm import StreamParser


def _collect(*chunks):
    p = StreamParser()
    events = []
    for c in chunks:
        events.extend(p.feed(c))
    events.extend(p.finalize())
    return events


def _types(events):
    return [e["type"] for e in events]


def test_plain_text_is_response_delta():
    events = _collect("Hello, sir.")
    assert _types(events) == ["response_delta"]
    assert events[0]["text"] == "Hello, sir."


def test_think_block_emits_start_delta_end():
    events = _collect("<jarvis:think>reasoning here</jarvis:think>Done.")
    types = _types(events)
    assert types[0] == "think_start"
    assert "think_delta" in types
    assert "think_end" in types
    # the trailing plain text becomes a response_delta
    assert any(e["type"] == "response_delta" and "Done." in e["text"] for e in events)


def test_think_text_separated_from_response():
    events = _collect("<jarvis:think>secret</jarvis:think>spoken")
    think = "".join(e["text"] for e in events if e["type"] == "think_delta")
    resp = "".join(e["text"] for e in events if e["type"] == "response_delta")
    assert "secret" in think
    assert "secret" not in resp
    assert "spoken" in resp


def test_self_closing_step_tag():
    events = _collect('<jarvis:step n="1" of="3" label="do thing" status="running"/>')
    step = [e for e in events if e["type"] == "step"]
    assert len(step) == 1
    assert step[0]["attrs"]["n"] == "1"
    assert step[0]["attrs"]["status"] == "running"


def test_task_plan_block_becomes_tag_event():
    body = "GOAL: ship it\nSTEPS:\n  [01] first — tool: bash_exec"
    events = _collect(f"<jarvis:task_plan id=\"t1\" total_steps=\"1\">{body}</jarvis:task_plan>")
    tags = [e for e in events if e["type"] == "tag"]
    assert len(tags) == 1
    assert tags[0]["name"] == "task_plan"
    assert tags[0]["attrs"]["id"] == "t1"
    assert "GOAL: ship it" in tags[0]["body"]


def test_split_across_chunks_reassembles_tag():
    # A tag split mid-token across feed() calls must still parse correctly.
    events = _collect("<jarvis:th", "ink>partial</jarvis:", "think>after")
    types = _types(events)
    assert "think_start" in types and "think_end" in types
    resp = "".join(e["text"] for e in events if e["type"] == "response_delta")
    assert "after" in resp
