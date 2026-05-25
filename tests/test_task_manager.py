"""Tests for the Agentic Task Engine state tracker."""
from jarvis.task_manager import TaskManager


def _plan_event(total=2):
    body = (
        "GOAL: deploy the thing\n"
        "STEPS:\n"
        "  [01] build — tool: bash_exec\n"
        "  [02] push — tool: bash_exec\n"
        "CHECKPOINTS: 2\n"
        "ROLLBACK: revert commit"
    )
    return {"type": "tag", "name": "task_plan",
            "attrs": {"id": "t1", "total_steps": str(total)}, "body": body}


def test_task_plan_parsed():
    tm = TaskManager()
    snap = tm.handle_event(_plan_event())
    assert snap["kind"] == "task_plan"
    plan = snap["plan"]
    assert plan["task_id"] == "t1"
    assert plan["total_steps"] == 2
    assert plan["goal"] == "deploy the thing"
    assert len(plan["steps"]) == 2
    assert plan["steps"][0]["label"] == "build"
    assert plan["steps"][0]["tool"] == "bash_exec"


def test_step_status_transitions_and_progress():
    tm = TaskManager()
    tm.handle_event(_plan_event())
    running = tm.handle_event({"type": "step", "attrs": {"n": "1", "status": "running"}})
    assert running["kind"] == "step"
    assert running["plan"]["progress"] == 0.0
    done = tm.handle_event({"type": "step", "attrs": {"n": "1", "status": "done"}})
    assert done["plan"]["progress"] == 50.0  # 1 of 2 done


def test_step_error_records_reason():
    tm = TaskManager()
    tm.handle_event(_plan_event())
    snap = tm.handle_event({"type": "step",
                            "attrs": {"n": "2", "status": "error", "reason": "boom"}})
    changed = snap["plan"]["changed_step"]
    assert changed["status"] == "error"
    assert changed["reason"] == "boom"


def test_task_complete_collects_summary_and_artifacts():
    tm = TaskManager()
    tm.handle_event(_plan_event())
    body = ("SUMMARY: all good\n"
            "ARTIFACTS: https://example.com/repo, /tmp/out.txt\n"
            "ISSUES: none")
    snap = tm.handle_event({"type": "tag", "name": "task_complete",
                            "attrs": {"status": "success"}, "body": body})
    assert snap["kind"] == "task_complete"
    plan = snap["plan"]
    assert plan["status"] == "success"
    assert plan["summary"] == "all good"
    assert "https://example.com/repo" in plan["artifacts"]
    assert "/tmp/out.txt" in plan["artifacts"]


def test_step_without_plan_is_ignored():
    tm = TaskManager()
    assert tm.handle_event({"type": "step", "attrs": {"n": "1", "status": "running"}}) is None


def test_non_task_event_returns_none():
    tm = TaskManager()
    assert tm.handle_event({"type": "response_delta", "text": "hi"}) is None
