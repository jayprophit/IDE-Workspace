"""IDE-side Agent Bridge configuration (IDE_NAME_TBD, slice 2).

Reads local development defaults from environment variables and an
optional ``workspace/.env.local`` file (git-ignored). No personal
absolute paths are hard-coded: everything resolves from env or from
this file's location on disk.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


def _load_dotenv(path: Path) -> None:
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


WORKSPACE_ROOT = Path(__file__).resolve().parent.parent
_load_dotenv(WORKSPACE_ROOT / ".env.local")


@dataclass(frozen=True)
class BridgeConfig:
    """Connection + task defaults for the IDE-side bridge client."""

    agent_bridge_root: str = field(
        default_factory=lambda: os.getenv("AGENT_BRIDGE_ROOT", "")
    )
    endpoint: str = field(
        default_factory=lambda: os.getenv("AGENT_BRIDGE_ENDPOINT", "http://127.0.0.1:8471")
    )
    token: str = field(default_factory=lambda: os.getenv("AGENT_BRIDGE_TOKEN", ""))
    workspace_root: str = field(
        default_factory=lambda: os.getenv("IDE_WORKSPACE_ROOT", str(WORKSPACE_ROOT))
    )
    worker_dir: str = field(
        default_factory=lambda: os.getenv(
            "IDE_WORKER_DIR", str(WORKSPACE_ROOT / ".agent-worker-test")
        )
    )
    model: str = field(
        default_factory=lambda: os.getenv("IDE_MODEL", "hhao/qwen2.5-coder-tools:3b")
    )
    approval: str = field(default_factory=lambda: os.getenv("IDE_APPROVAL", "AUTO_SAFE"))
    mode: str = field(default_factory=lambda: os.getenv("IDE_MODE", "build"))
    # Human-in-the-loop. The runtime switch is server-side and owner-chosen
    # (AGENT_BRIDGE_EXTERNAL_APPROVALS); the session opt-in is per session. Both
    # are off by default, so a session can never start waiting for a decision
    # the runtime would refuse to accept.
    external_approvals: bool = field(
        default_factory=lambda: os.getenv("AGENT_BRIDGE_EXTERNAL_APPROVALS", "") == "1"
    )
    interactive_approvals: bool = field(
        default_factory=lambda: os.getenv("IDE_INTERACTIVE_APPROVALS", "") == "1"
    )
    task_timeout_s: float = field(
        default_factory=lambda: float(os.getenv("IDE_TASK_TIMEOUT_S", "1500"))
    )
    poll_interval_s: float = field(
        default_factory=lambda: float(os.getenv("IDE_POLL_S", "3.0"))
    )
