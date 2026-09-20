"""IDE-side Agent Bridge service launcher (IDE_NAME_TBD, slice 2).

Starts the canonical Agent Bridge runtime via its supported CLI
(``cli.py serve`` -> HTTP /v1 on 127.0.0.1) as a child process and
waits until ``/health`` responds. The Agent Bridge repository itself
is never modified: it is only executed.
"""
from __future__ import annotations

import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from .bridge_config import BridgeConfig


class BridgeService:
    def __init__(self, config: BridgeConfig | None = None):
        self.config = config or BridgeConfig()
        self.proc: subprocess.Popen | None = None

    def start(
        self,
        approval: str = "",
        preset: str = "STANDARD",
        port: int = 0,
        timeout_s: float = 90,
    ) -> str:
        cfg = self.config
        root = cfg.agent_bridge_root
        if not root:
            raise RuntimeError("AGENT_BRIDGE_ROOT is not configured")
        endpoint = cfg.endpoint
        if port:
            endpoint = f"http://127.0.0.1:{port}"
        host_port = endpoint.rsplit("://", 1)[-1]
        host, _, port_s = host_port.partition(":")
        cmd = [
            sys.executable,
            str(Path(root) / "cli.py"),
            "--root", cfg.workspace_root,
            "--approval", approval or cfg.approval,
            "--preset", preset,
            "serve",
            "--host", host or "127.0.0.1",
            "--port", str(int(port_s or 8471)),
        ]
        log_path = Path(cfg.workspace_root) / ".agent-worker-test" / "bridge-service.log"
        log_path.parent.mkdir(parents=True, exist_ok=True)
        logf = open(log_path, "ab")
        self.proc = subprocess.Popen(
            cmd, cwd=root, stdout=logf, stderr=subprocess.STDOUT
        )
        logf.close()
        deadline = time.time() + timeout_s
        last_err = ""
        health_url = endpoint.rstrip("/") + "/health"
        while time.time() < deadline:
            if self.proc.poll() is not None:
                raise RuntimeError(f"bridge service exited early (rc={self.proc.returncode})")
            try:
                with urllib.request.urlopen(health_url, timeout=5) as resp:
                    if resp.status == 200:
                        return endpoint
            except Exception as e:  # not up yet
                last_err = str(e)[:200]
            time.sleep(1.0)
        self.stop()
        raise TimeoutError(f"bridge /health never responded: {last_err}")

    def stop(self) -> None:
        if self.proc is not None and self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=15)
            except subprocess.TimeoutExpired:
                self.proc.kill()
        self.proc = None
