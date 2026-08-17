"""Windows service wrapper for the JARVIS voice server.

Run as LOCAL SYSTEM so Cosmo has full admin rights on the box without
triggering UAC on every start. Service auto-starts at boot.

Usage (one-time setup, needs a single UAC prompt):
    powershell -ExecutionPolicy Bypass -File install_service.ps1

Manual control:
    Start-Service jarvis
    Stop-Service jarvis
    Restart-Service jarvis
    Get-Service jarvis
"""
from __future__ import annotations

import os
import sys
import time
import socket
import servicemanager
import win32event
import win32service
import win32serviceutil

SERVICE_NAME = "JarvisVoiceServer"
SERVICE_DISPLAY_NAME = "JARVIS Voice Server"
SERVICE_DESCRIPTION = (
    "Cosmo's voice + LLM server (FastAPI + WebSocket). Runs as LOCAL SYSTEM "
    "so the operator's normal Windows session stays unprivileged while "
    "Cosmo can still manage services, kill processes, edit system files, "
    "and drive MCP servers that need admin."
)


class JarvisVoiceService(win32serviceutil.ServiceFramework):
    """Spawns uvicorn in a child process and supervises it. Stops cleanly on
    service stop. Writes logs to %ProgramData%\\JarvisVoiceServer\\service.log."""

    _svc_name_ = SERVICE_NAME
    _svc_display_name_ = SERVICE_DISPLAY_NAME
    _svc_description_ = SERVICE_DESCRIPTION

    def __init__(self, args):
        super().__init__(args)
        self._stop_event = win32event.CreateEvent(None, 0, 0, None)
        self._child: subprocess.Popen | None = None  # type: ignore[name-defined]
        self._log_path = os.path.join(
            os.environ.get("ProgramData", r"C:\ProgramData"),
            "JarvisVoiceServer",
            "service.log",
        )
        os.makedirs(os.path.dirname(self._log_path), exist_ok=True)

    # ── service control ──────────────────────────────────────────────────
    def SvcStop(self):
        self.ReportServiceStatus(win32service.SERVICE_STOP_PENDING)
        win32event.SetEvent(self._stop_event)
        if self._child and self._child.poll() is None:
            try:
                self._child.terminate()
            except Exception:
                pass

    def SvcDoRun(self):
        servicemanager.LogMsg(
            servicemanager.EVENTLOG_INFORMATION_TYPE,
            servicemanager.PYS_SERVICE_STARTED,
            (self._svc_name_, ""),
        )
        self._log(f"service starting; pid={os.getpid()}")
        self._run_supervisor()

    # ── supervisor loop ──────────────────────────────────────────────────
    def _run_supervisor(self):
        """Restart uvicorn if it dies, until the service is stopped."""
        import subprocess  # local: only on Windows

        while True:
            if win32event.WaitForSingleObject(self._stop_event, 0) == win32event.WAIT_OBJECT_0:
                self._log("stop event received; exiting supervisor")
                return

            self._log("spawning uvicorn child process")
            try:
                self._child = subprocess.Popen(
                    [
                        sys.executable,
                        "-m",
                        "uvicorn",
                        "jarvis.main:app",
                        "--host",
                        "127.0.0.1",
                        "--port",
                        "8765",
                        "--workers",
                        "1",
                        "--timeout-keep-alive",
                        "75",
                    ],
                    cwd=self._repo_root(),
                    stdout=open(self._log_path, "a", buffering=1),
                    stderr=subprocess.STDOUT,
                    env={**os.environ, "JARVIS_RUNNING_AS_SERVICE": "1"},
                )
            except Exception as exc:
                self._log(f"failed to spawn uvicorn: {exc!r}")
                time.sleep(5)
                continue

            # Wait for either the child to exit or a stop signal
            while True:
                if win32event.WaitForSingleObject(self._stop_event, 1000) == win32event.WAIT_OBJECT_0:
                    self._log("stop event during wait; terminating child")
                    try:
                        self._child.terminate()
                        self._child.wait(timeout=10)
                    except Exception:
                        try:
                            self._child.kill()
                        except Exception:
                            pass
                    return

                rc = self._child.poll()
                if rc is not None:
                    self._log(f"uvicorn exited with code {rc}; restarting in 3s")
                    time.sleep(3)
                    break  # outer while-loop respawns

    # ── helpers ──────────────────────────────────────────────────────────
    @staticmethod
    def _repo_root() -> str:
        # service.py lives in jarvis/service.py; repo is one level up.
        here = os.path.abspath(__file__)
        return os.path.dirname(os.path.dirname(here))

    def _log(self, msg: str) -> None:
        line = f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {msg}\n"
        try:
            with open(self._log_path, "a", buffering=1) as fh:
                fh.write(line)
        except Exception:
            pass
        servicemanager.LogInfoMsg(line)


if __name__ == "__main__":
    win32serviceutil.HandleCommandLine(JarvisVoiceService)
