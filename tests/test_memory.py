"""Tests for the JSON memory store. Uses a temp store, never touches ~/.jarvis."""
import asyncio

import pytest

from jarvis.tools import memory


@pytest.fixture(autouse=True)
def temp_store(tmp_path, monkeypatch):
    store = tmp_path / "memory.json"
    monkeypatch.setattr(memory, "STORE_PATH", str(store))
    yield store


def run(coro):
    return asyncio.run(coro)


def test_save_and_recall():
    run(memory.save("fav_color", "cyan", tags=["preferences"]))
    res = run(memory.recall("color"))
    assert res["ok"]
    assert any(m["key"] == "fav_color" for m in res["matches"])


def test_save_upserts_existing_key():
    run(memory.save("k", "v1"))
    r = run(memory.save("k", "v2"))
    assert r["updated"] is True
    entries = run(memory.all_entries())
    vals = [e["value"] for e in entries if e["key"] == "k"]
    assert vals == ["v2"]


def test_recall_ranks_relevant_first():
    run(memory.save("python_note", "use list comprehensions"))
    run(memory.save("cooking_note", "boil pasta for 8 minutes"))
    res = run(memory.recall("pasta cooking"))
    assert res["matches"]
    assert res["matches"][0]["key"] == "cooking_note"


def test_delete_removes_entry():
    run(memory.save("temp", "x"))
    r = run(memory.delete("temp"))
    assert r["ok"] and r["deleted"] == "temp"
    res = run(memory.recall("temp"))
    assert all(m["key"] != "temp" for m in res["matches"])


def test_delete_missing_key_fails_gracefully():
    r = run(memory.delete("does_not_exist"))
    assert r["ok"] is False


def test_list_memories_orders_recent_first():
    run(memory.save("a", "1"))
    run(memory.save("b", "2"))
    res = run(memory.list_memories())
    assert res["ok"]
    assert res["count"] == 2
    assert res["memories"][0]["key"] == "b"  # most recently updated


def test_empty_query_returns_no_matches():
    run(memory.save("a", "1"))
    res = run(memory.recall(""))
    assert res["matches"] == []
