"""Phase B: the Genesis-in-IDE vertical slice, proven over real HTTP.

This is the loop the minimum harness exists for:

    user -> IDE -> Genesis -> capability -> P25 authorization -> Agent Bridge
         -> bounded action -> world-state readback -> IDE-visible evidence

Every component below is the real one: the Bridge service and its runtime,
session and task lifecycle, the approval gate, the policy engine, the executor
and the sandbox, driven through the IDE's own ``IdeBridgeClient`` facade over
HTTP on an ephemeral port. Only the model is scripted, so a model-quality
problem can never be mistaken for an architecture problem. The same loop
against the real local model is covered separately by
``test_bridge_live_loopback.py``.

The assertions are about truth, not liveness: a denied action must be reported
as denied, an unapproved action must not reach the world, and an approved one
must be observable in the filesystem and in the evidence readback.
"""
from __future__ import annotations

import json
import shutil
import socket
import tempfile
import unittest
from pathlib import Path

INTEGRATION_ROOT = Path(__file__).resolve().parent.parent
TERMINAL = ("COMPLETED", "FAILED", "CANCELLED", "ROLLED_BACK", "INTERRUPTED")
GOAL = "write the file gate.txt with the single word ok, then finish"


def _default_bridge_root() -> str:
    import os

    env = os.getenv("AGENT_BRIDGE_ROOT", "")
    if env:
        return env
    return str(INTEGRATION_ROOT.parent.parent.parent / "Agent-Bridge")


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _bridge_sys_path() -> str:
    """Make the Bridge modules importable for the policy probe assertions."""
    import sys

    root = _default_bridge_root()
    if root not in sys.path:
        sys.path.insert(0, root)
    return root


WRITE_SCRIPT = [
    json.dumps({"action": "write", "path": "gate.txt", "content": "ok"}),
    json.dumps({"action": "finish", "message": "vertical slice complete"}),
]


def _require_bridge() -> str:
    root = _default_bridge_root()
    if not (Path(root) / "runtime.py").exists():
        raise unittest.SkipTest(f"Agent-Bridge checkout absent at {root}")
    return root


class VerticalSliceBase(unittest.TestCase):
    approval = "ASK_ALL_WRITES"
    external_approvals = True

    def setUp(self):
        bridge_root = _require_bridge()
        from integration.bridge_config import BridgeConfig
        from integration.bridge_service import BridgeService

        self.tmp = Path(tempfile.mkdtemp(prefix="ide_slice_"))
        self.ws = self.tmp / "proj"
        self.ws.mkdir()
        self.port = _free_port()
        self.config = BridgeConfig(
            agent_bridge_root=bridge_root,
            endpoint=f"http://127.0.0.1:{self.port}",
            workspace_root=str(self.tmp),
            worker_dir=str(self.tmp / ".agent-worker-test"),
            approval=self.approval,
            interactive_approvals=self.external_approvals,
        )
        self.service = BridgeService(self.config)
        self.service.start_injected(
            script=WRITE_SCRIPT, port=self.port,
            external_approvals=self.external_approvals, approval=self.approval)
        _bridge_sys_path()
        from integration.bridge_client import IdeBridgeClient

        self.client = IdeBridgeClient(self.config)

    def tearDown(self):
        self.service.stop()
        shutil.rmtree(self.tmp, ignore_errors=True)

    # -- loop helpers ----------------------------------------------------
    def wait_for_pending(self, session_id: str, timeout: float = 30.0) -> list[str]:
        import time

        deadline = time.time() + timeout
        while time.time() < deadline:
            pending = self.client.get_approvals(session_id)
            if pending:
                return pending
            time.sleep(0.2)
        return []

    def wait_for_terminal(self, session_id: str, task_id: str,
                          timeout: float = 90.0) -> dict:
        import time

        deadline = time.time() + timeout
        status: dict = {}
        while time.time() < deadline:
            status = self.client.get_progress(session_id)
            if status.get("tasks", {}).get(task_id) in TERMINAL:
                return status
            time.sleep(0.3)
        self.fail(f"task never reached a terminal state: {status.get('tasks')}")

    def read_gate(self) -> str | None:
        target = self.ws / "gate.txt"
        return target.read_text(encoding="utf-8") if target.exists() else None


class TestApprovedVerticalSlice(VerticalSliceBase):
    """The loop a human approves: ask, decide, act, read back, prove."""

    def test_approve_executes_and_the_world_shows_it(self):
        session = self.client.create_session(workspace=str(self.ws))
        session_id = session["session_id"]
        self.assertTrue(session.get("interactive"),
                        "the session must have a decision channel")

        task = self.client.submit_task(session_id, GOAL)
        task_id = task["task_id"]

        pending = self.wait_for_pending(session_id)
        self.assertEqual(len(pending), 1, "the write must reach the human")
        # paused, not silently refused
        self.assertIsNone(self.read_gate(), "nothing may happen before approval")
        self.assertEqual(
            self.client.get_progress(session_id)["status"], "WAITING_APPROVAL")

        self.client.approve(session_id, pending[0])

        self.wait_for_terminal(session_id, task_id)
        # world-state readback
        self.assertEqual(self.read_gate(), "ok")
        # effect truth
        outcome = self.client.get_outcome(session_id, task_id)
        self.assertTrue(outcome["effect_achieved"])
        self.assertEqual(outcome["denied_actions"], 0)
        self.assertFalse(outcome["blocked"])
        self.assertIn("gate.txt", outcome["files_created"])
        # evidence readback
        evidence = self.client.get_evidence(session_id)
        paths = [c.get("path") for c in evidence["manifest"].get("changes", [])]
        self.assertTrue(any("gate.txt" in str(p) for p in paths), paths)
        self.assertTrue(evidence["timeline"].get("timeline"))
        # the action and the decision are both in the event record
        events = [e.get("event") for e in self.client.get_actions(session_id)]
        self.assertIn("approval.requested", events)
        self.assertIn("approval.resolved", events)

    def test_the_approval_only_authorizes_the_approved_effect(self):
        """Approving one write must not leave a standing capability."""
        from aether_policy_bridge import (  # noqa: PLC0415 - test-only probe
            evaluate_capability_request, workspace_subject)

        session = self.client.create_session(workspace=str(self.ws))
        session_id = session["session_id"]
        task_id = self.client.submit_task(session_id, GOAL)["task_id"]
        pending = self.wait_for_pending(session_id)
        self.assertTrue(pending)
        self.client.approve(session_id, pending[0])
        self.wait_for_terminal(session_id, task_id)
        self.assertEqual(self.read_gate(), "ok")

        # a capability nobody approved is still refused
        verdict = evaluate_capability_request(
            subject=workspace_subject(str(self.ws), session_id),
            capability="filesystem:write",
            resource=f"workspace:{self.ws.resolve()}/never-approved.txt",
            context={"timestamp": 0, "network_origin": "local",
                     "device_trust": 100, "attributes": {}},
            principal=None,
        )
        self.assertFalse(verdict["allowed"])


class TestDeniedVerticalSlice(VerticalSliceBase):
    """The loop a human refuses: the refusal must be the visible outcome."""

    def test_deny_blocks_the_effect_and_reports_blocked(self):
        session = self.client.create_session(workspace=str(self.ws))
        session_id = session["session_id"]
        task_id = self.client.submit_task(session_id, GOAL)["task_id"]

        pending = self.wait_for_pending(session_id)
        self.assertEqual(len(pending), 1)
        self.client.deny(session_id, pending[0])

        self.wait_for_terminal(session_id, task_id)
        # the world is unchanged
        self.assertIsNone(self.read_gate(), "a denied write must not happen")
        # and the result says so, rather than reporting success
        outcome = self.client.get_outcome(session_id, task_id)
        self.assertFalse(outcome["effect_achieved"])
        self.assertEqual(outcome["denied_actions"], 1)
        self.assertTrue(outcome["blocked"])
        self.assertIn("APPROVAL_DENIED",
                      [e.get("kind") for e in outcome.get("errors", [])])
        self.assertIn("deny",
                      [a.get("decision") for a in outcome.get("approvals", [])])

    def test_a_denial_cannot_be_overturned_afterwards(self):
        session = self.client.create_session(workspace=str(self.ws))
        session_id = session["session_id"]
        task_id = self.client.submit_task(session_id, GOAL)["task_id"]
        pending = self.wait_for_pending(session_id)
        self.assertTrue(pending)
        self.client.deny(session_id, pending[0])
        self.wait_for_terminal(session_id, task_id)
        from client import ClientError

        with self.assertRaises(ClientError):
            self.client.approve(session_id, pending[0])
        self.assertIsNone(self.read_gate())


class TestUnansweredVerticalSlice(VerticalSliceBase):
    """No decision channel, no human gate: the IDE must be told, not faked."""

    external_approvals = False

    def test_session_creation_is_refused_when_the_runtime_has_no_channel(self):
        from client import ClientError

        with self.assertRaises(ClientError) as ctx:
            self.client.create_session(workspace=str(self.ws), interactive=True)
        self.assertIn("not enabled", str(ctx.exception))

    def test_ask_is_denied_not_routed_to_a_ui_that_cannot_act(self):
        session = self.client.create_session(workspace=str(self.ws),
                                             interactive=False)
        session_id = session["session_id"]
        self.assertFalse(session.get("interactive"))
        task_id = self.client.submit_task(session_id, GOAL)["task_id"]
        self.wait_for_terminal(session_id, task_id)
        # fail closed, and the outcome is honest about it
        self.assertIsNone(self.read_gate())
        self.assertEqual(self.client.get_approvals(session_id), [])
        outcome = self.client.get_outcome(session_id, task_id)
        self.assertFalse(outcome["effect_achieved"])
        self.assertTrue(outcome["denied_actions"] >= 1)
        self.assertTrue(outcome["blocked"])


class TestCancelledVerticalSlice(VerticalSliceBase):
    """A human can stop a run that is waiting on them."""

    def test_cancel_ends_a_waiting_approval_without_effect(self):
        session = self.client.create_session(workspace=str(self.ws))
        session_id = session["session_id"]
        task_id = self.client.submit_task(session_id, GOAL)["task_id"]
        self.assertTrue(self.wait_for_pending(session_id))
        self.client.cancel(session_id, task_id)
        status = self.wait_for_terminal(session_id, task_id)
        self.assertEqual(status["tasks"][task_id], "CANCELLED")
        self.assertIsNone(self.read_gate())


if __name__ == "__main__":
    unittest.main()
