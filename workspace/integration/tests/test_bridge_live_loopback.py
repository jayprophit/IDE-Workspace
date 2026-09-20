"""P7: IDE <-> Agent Bridge live loopback (localhost, ephemeral port).

Starts the canonical Bridge runtime (cli.py serve, unmodified repo) as a
child process, then drives the IDE-side facade: health -> capabilities ->
models -> session create/status. No task execution here (covered
in-process by Agent-Bridge P5 tests); this proves the live transport and
the identity/status surface the IDE shell polls.
"""
from __future__ import annotations

import os
import shutil
import socket
import tempfile
import unittest
from pathlib import Path

INTEGRATION_ROOT = Path(__file__).resolve().parent.parent


def _default_bridge_root() -> str:
    env = os.getenv("AGENT_BRIDGE_ROOT", "")
    if env:
        return env
    candidate = INTEGRATION_ROOT.parent.parent.parent / "Agent-Bridge"
    return str(candidate)


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


class LiveLoopbackTests(unittest.TestCase):
    def test_health_capabilities_session(self):
        bridge_root = _default_bridge_root()
        if not (Path(bridge_root) / "cli.py").exists():
            self.skipTest(f"Agent-Bridge checkout absent at {bridge_root}")
        from integration.bridge_config import BridgeConfig
        from integration.bridge_service import BridgeService
        from integration.bridge_client import IdeBridgeClient

        workspace = Path(tempfile.mkdtemp(prefix="p7_ide_ws_"))
        port = _free_port()
        config = BridgeConfig(
            agent_bridge_root=bridge_root,
            endpoint=f"http://127.0.0.1:{port}",
            workspace_root=str(workspace),
            worker_dir=str(workspace / ".agent-worker-test"),
        )
        service = BridgeService(config)
        try:
            endpoint = service.start(port=port, timeout_s=90)
            self.assertTrue(endpoint.endswith(f":{port}"))
            client = IdeBridgeClient(config)

            health = client.health()
            self.assertTrue(health)
            capabilities = client.capabilities()
            self.assertTrue(capabilities)
            models = client.models()
            self.assertIsNotNone(models)

            session = client.create_session(workspace=str(workspace))
            session_id = session.get("session_id") or session.get("id")
            self.assertTrue(session_id)
            status = client.client.session_status(session_id)
            self.assertTrue(status)
        finally:
            service.stop()
            shutil.rmtree(workspace, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
