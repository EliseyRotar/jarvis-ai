"""Agentic Task Engine (ATE) state tracker.

Consumes events emitted by llm.stream_chat and maintains the live state of
any in-flight task_plan: total steps, status of each step, elapsed time,
artifacts, and final outcome. It exposes a serialisable snapshot suitable
for pushing to the Web UI over WebSocket.
"""
from __future__ import annotations

import re
import time
from dataclasses import dataclass, field
from typing import Any


_STEP_LINE_RE = re.compile(
    r"\[?\s*0*(?P<n>\d+)\s*\]?[\s.\-:]+(?P<label>.+?)(?:\s+(?:—|--)\s+tool:\s*(?P<tool>\S+))?\s*$"
)


@dataclass
class Step:
    n: int
    label: str
    tool: str | None = None
    status: str = "pending"      # pending | running | done | error
    reason: str | None = None
    started_at: float | None = None
    finished_at: float | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "n": self.n,
            "label": self.label,
            "tool": self.tool,
            "status": self.status,
            "reason": self.reason,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
        }


@dataclass
class TaskPlan:
    task_id: str
    total_steps: int
    goal: str = ""
    checkpoints: str = ""
    rollback: str = ""
    steps: dict[int, Step] = field(default_factory=dict)
    started_at: float = field(default_factory=time.time)
    finished_at: float | None = None
    status: str = "running"      # running | success | partial | failed
    summary: str = ""
    artifacts: list[str] = field(default_factory=list)
    issues: str = ""

    def progress(self) -> float:
        if self.total_steps <= 0:
            return 0.0
        done = sum(1 for s in self.steps.values() if s.status == "done")
        return round((done / self.total_steps) * 100.0, 1)

    def elapsed(self) -> float:
        end = self.finished_at or time.time()
        return round(end - self.started_at, 2)

    def to_dict(self) -> dict[str, Any]:
        return {
            "task_id": self.task_id,
            "total_steps": self.total_steps,
            "goal": self.goal,
            "checkpoints": self.checkpoints,
            "rollback": self.rollback,
            "steps": [self.steps[k].to_dict() for k in sorted(self.steps)],
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "status": self.status,
            "summary": self.summary,
            "artifacts": self.artifacts,
            "issues": self.issues,
            "progress": self.progress(),
            "elapsed": self.elapsed(),
        }


class TaskManager:
    """Stateful consumer of llm.stream_chat events."""

    def __init__(self) -> None:
        self.current: TaskPlan | None = None
        self.history: list[TaskPlan] = []

    # ── plan / step / complete handlers ──────────────────────────────────

    def on_task_plan(self, attrs: dict[str, str], body: str) -> dict[str, Any]:
        task_id = attrs.get("id") or f"task_{int(time.time())}"
        try:
            total = int(attrs.get("total_steps", "0"))
        except ValueError:
            total = 0

        goal, checkpoints, rollback = "", "", ""
        steps_block: list[str] = []
        section = None
        for raw in body.splitlines():
            line = raw.strip()
            if not line:
                continue
            upper = line.upper()
            if upper.startswith("GOAL:"):
                section = "goal"
                goal = line.split(":", 1)[1].strip()
                continue
            if upper.startswith("STEPS:"):
                section = "steps"
                continue
            if upper.startswith("CHECKPOINTS:"):
                section = "checkpoints"
                checkpoints = line.split(":", 1)[1].strip()
                continue
            if upper.startswith("ROLLBACK:"):
                section = "rollback"
                rollback = line.split(":", 1)[1].strip()
                continue
            if section == "steps":
                steps_block.append(line)
            elif section == "goal" and not goal:
                goal = line
            elif section == "checkpoints" and not checkpoints:
                checkpoints = line
            elif section == "rollback" and not rollback:
                rollback = line

        plan = TaskPlan(
            task_id=task_id,
            total_steps=total,
            goal=goal,
            checkpoints=checkpoints,
            rollback=rollback,
        )
        for line in steps_block:
            m = _STEP_LINE_RE.match(line)
            if not m:
                continue
            n = int(m.group("n"))
            plan.steps[n] = Step(
                n=n,
                label=m.group("label").strip(" .—-"),
                tool=(m.group("tool") or "").strip() or None,
            )
        if plan.total_steps == 0 and plan.steps:
            plan.total_steps = max(plan.steps)
        self.current = plan
        return plan.to_dict()

    def on_step(self, attrs: dict[str, str]) -> dict[str, Any] | None:
        if self.current is None:
            return None
        try:
            n = int(attrs.get("n", "0"))
        except ValueError:
            return None
        if n <= 0:
            return None
        step = self.current.steps.get(n)
        if step is None:
            step = Step(n=n, label=attrs.get("label", f"step {n}"))
            self.current.steps[n] = step
        if "label" in attrs and attrs["label"]:
            step.label = attrs["label"]
        status = attrs.get("status", "running")
        now = time.time()
        if status == "running":
            step.status = "running"
            step.started_at = step.started_at or now
        elif status == "done":
            step.status = "done"
            step.finished_at = now
            if step.started_at is None:
                step.started_at = now
        elif status == "error":
            step.status = "error"
            step.reason = attrs.get("reason")
            step.finished_at = now
        else:
            step.status = status
        snapshot = self.current.to_dict()
        snapshot["changed_step"] = step.to_dict()
        return snapshot

    def on_task_complete(self, attrs: dict[str, str], body: str) -> dict[str, Any] | None:
        if self.current is None:
            return None
        self.current.status = attrs.get("status", "success")
        self.current.finished_at = time.time()

        summary, artifacts, issues = "", [], ""
        section = None
        for raw in body.splitlines():
            line = raw.strip()
            if not line:
                continue
            upper = line.upper()
            if upper.startswith("SUMMARY:"):
                section = "summary"
                summary = line.split(":", 1)[1].strip()
                continue
            if upper.startswith("ARTIFACTS:"):
                section = "artifacts"
                rest = line.split(":", 1)[1].strip()
                if rest:
                    artifacts.extend(_parse_artifact_line(rest))
                continue
            if upper.startswith("ISSUES:"):
                section = "issues"
                issues = line.split(":", 1)[1].strip()
                continue
            if section == "summary":
                summary += " " + line
            elif section == "artifacts":
                artifacts.extend(_parse_artifact_line(line))
            elif section == "issues":
                issues += " " + line
        self.current.summary = summary.strip()
        self.current.artifacts = [a for a in artifacts if a]
        self.current.issues = issues.strip()

        completed = self.current.to_dict()
        self.history.append(self.current)
        self.current = None
        return completed

    # ── universal event entrypoint ───────────────────────────────────────

    def handle_event(self, event: dict[str, Any]) -> dict[str, Any] | None:
        """Return a snapshot dict for the UI if the event mutates task state."""
        etype = event.get("type")
        if etype == "tag":
            name = event.get("name")
            if name == "task_plan":
                return {"kind": "task_plan", "plan": self.on_task_plan(event.get("attrs", {}), event.get("body", ""))}
            if name == "task_complete":
                snap = self.on_task_complete(event.get("attrs", {}), event.get("body", ""))
                if snap is not None:
                    return {"kind": "task_complete", "plan": snap}
        elif etype == "step":
            snap = self.on_step(event.get("attrs", {}))
            if snap is not None:
                return {"kind": "step", "plan": snap}
        return None


def _parse_artifact_line(s: str) -> list[str]:
    parts = re.split(r"[;,]\s*", s)
    return [p.strip(" -•·\t") for p in parts if p.strip(" -•·\t")]
