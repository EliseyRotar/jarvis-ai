"""Tests for TTS text cleaning in jarvis.tts."""
from jarvis import tts


def test_strip_removes_jarvis_blocks():
    out = tts.strip_for_tts("<jarvis:think>hidden</jarvis:think>Hello sir.")
    assert "hidden" not in out
    assert "Hello sir." in out


def test_strip_removes_self_closing_tags():
    out = tts.strip_for_tts('Working <jarvis:step n="1" status="running"/> now.')
    assert "step" not in out
    assert "Working" in out and "now." in out


def test_strip_removes_markdown():
    out = tts.strip_for_tts("This is **bold** and `code` and a [link](http://x.com).")
    assert "**" not in out and "`" not in out
    # bold text and link label survive; inline code is dropped entirely (not spoken)
    assert "bold" in out and "link" in out
    assert "code" not in out
    assert "http" not in out


def test_strip_removes_emoji():
    out = tts.strip_for_tts("All systems nominal \U0001F680✅")
    assert "All systems nominal" in out
    # no emoji codepoints remain
    assert all(ord(c) < 0x1F000 for c in out)


def test_strip_empty_returns_empty():
    assert tts.strip_for_tts("") == ""
    assert tts.strip_for_tts("<jarvis:think>only thinking</jarvis:think>").strip() == ""


def test_truncate_short_text_unchanged():
    text = "Short reply."
    assert tts.truncate_for_tts(text) == text


def test_truncate_cuts_at_sentence_boundary():
    long = ("This is sentence one. This is sentence two. " * 40)
    out = tts.truncate_for_tts(long, limit=100)
    assert len(out) < len(long)
    assert "Full details are on screen." in out


def test_detect_piper_bin_returns_string():
    # Should always return a usable binary name, even if none installed.
    assert isinstance(tts._detect_piper_bin(), str)
    assert tts._detect_piper_bin()
