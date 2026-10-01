"""Five vertical scenarios through the proposal adapter and the real stack.

The full chain, with nothing faked except the model (scripted) and the
Genesis emitter (C++ suite proves it; the harness builds the exact dict it
emits, including the digest convention):

    proposal dict -> proposal_adapter -> BridgeActionRequest body
        -> POST /v1/actions -> approval gate -> policy engine -> executor
        -> journal -> world-state readback -> IDE evidence

Each scenario asserts the adapter-specific properties (identity, correlation,
digest binding, no authority smuggling) AND the end-to-end outcome. The paths
are proven without the adapter in test_bridge_vertical_slice.py; these prove
them WITH the adapter, which is the seam under test.
"""
from __future__ import annotations

import shutil
import socket
import tempfile
import time
import unittest
from pathlib import Path

from integration.bridge_client import IdeBridgeClient
from integration.bridge_config import BridgeConfig
from integration.bridge_service import BridgeService
from integration.proposal_adapter import (
    ProposalAdapterError,
    adapt_proposal,
    canonical_parameters_digest,
)

TERMINAL = ("COMPLETED", "FAILED", "CANCELLED", "ROLLED_BACK", "INTERRUPTED")


def _default_bridge_root() -> str:
    import os

    env = os.getenv("AGENT_BRIDGE_ROOT", "")
    if env:
        return env
    integration_root = Path(__file__).resolve().parent.parent
    return str(integration_root.parent.parent.parent / "Agent-Bridge")


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _require_bridge() -> str:
    root = _default_bridge_root()
    if not (Path(root) / "runtime.py").exists():
        raise unittest.SkipTest(f"Agent-Bridge checkout absent at {root}")
    return root


def make_proposal(action: str = "write", resource: str = "scenario.txt",
                  parameters: dict | None = None,
                  disposition: str = "proposed", **overrides) -> tuple[dict, dict]:
    params = {"content": "scenario-ok"} if parameters is None else parameters
    proposal = {
        "proposal_id": f"apx-{action}-{resource}".replace("/", "-")[:60],
        "genesis_id": "genesis-canonical-0001",
        "run_id": "run-scenario-1",
        "capability_id": "tool-writer",
        "tool_id": "tool-writer",
        "action": action,
        "resource": resource,
        "parameter_digest": canonical_parameters_digest(params),
        "evidence_digest": "d" * 64,
        "receipt_digest": "e" * 64,
        "disposition": disposition,
        "rationale": "scenario proposal",
        "authority_owner": "p25",
    }
    proposal.update(overrides)
    return proposal, params


class ScenarioBase(unittest.TestCase):
    approval = "AUTO_SAFE"
    external_approvals = False
    script = [
        '{"action":"write","path":"SHOULD-NEVER-RUN.txt","content":"x"}',
        '{"action":"finish","message":"unused"}',
    ]

    def setUp(self):
        bridge_root = _require_bridge()
        self.tmp = Path(tempfile.mkdtemp(prefix="ide_scen_"))
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
        # The injected model is never used: every action here is directed.
        # Its script would only run if the adapter/intake silently fell back
        # to model-driven execution, in which case the wrong file appears and
        # the scenario fails loudly.
        self.service.start_injected(
            script=self.script, port=self.port,
            external_approvals=self.external_approvals, approval=self.approval)
        self.client = IdeBridgeClient(self.config)

    def tearDown(self):
        self.service.stop()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def wait_outcome(self, action_id: str, timeout: float = 90.0) -> dict:
        end = time.time() + timeout
        last: dict = {}
        while time.time() < end:
            last = self.client.action_status(action_id)
            if last.get("outcome") in ("SUCCEEDED", "DENIED", "FAILED",
                                       "CANCELLED", "WAITING_APPROVAL"):
                return last
            time.sleep(0.3)
        self.fail(f"action {action_id} never settled: {last}")
        raise AssertionError

    def wait_pending(self, session_id: str, timeout: float = 30.0) -> list[str]:
        end = time.time() + timeout
        while time.time() < end:
            pending = self.client.get_approvals(session_id)
            if pending:
                return pending
            time.sleep(0.2)
        return []


class TestScenarioAllow(ScenarioBase):
    """A permitted bounded action, proposal to verified effect."""

    def test_allow_end_to_end(self):
        proposal, params = make_proposal()
        sent = self.client.submit_proposal(proposal, params,
                                           workspace=str(self.ws))
        request, response = sent["request"], sent["response"]
        # adapter properties hold across the wire
        self.assertEqual(request["action_id"], proposal["proposal_id"])
        self.assertEqual(request["principal"],
                         {"kind": "genesis", "id": "genesis-canonical-0001"})
        self.assertEqual(request["session_id"], "run-scenario-1")
        self.assertNotIn("parameter_digest", str(request))
        # execution truth
        self.assertEqual(response["outcome"], "SUCCEEDED")
        self.assertTrue(response["effect_achieved"])
        self.assertEqual((self.ws / "scenario.txt").read_text(), "scenario-ok")
        # the injected model never ran: its canary file must not exist
        self.assertFalse((self.ws / "SHOULD-NEVER-RUN.txt").exists())
        # journal + evidence agree
        outcome = self.client.get_outcome(response["session_id"],
                                          response["task_id"])
        self.assertTrue(outcome["effect_achieved"])
        self.assertIn("scenario.txt", outcome["files_created"])
        evidence = self.client.get_evidence(response["session_id"])
        paths = [c.get("path") for c in
                 evidence["manifest"].get("changes", [])]
        self.assertTrue(any("scenario.txt" in str(p) for p in paths), paths)


class TestScenarioDeny(ScenarioBase):
    approval = "ASK_ALL_WRITES"
    external_approvals = True

    def test_deny_end_to_end(self):
        proposal, params = make_proposal(disposition="approval_required")
        sent = self.client.submit_proposal(
            proposal, params, workspace=str(self.ws),
            approval="ASK_ALL_WRITES", interactive=True)
        response = sent["response"]
        self.assertEqual(response["outcome"], "WAITING_APPROVAL")
        sid = response["session_id"]
        pending = self.wait_pending(sid)
        self.assertEqual(pending, [response["approval_id"]])
        self.client.deny(sid, pending[0])
        final = self.wait_outcome(proposal["proposal_id"])
        self.assertEqual(final["outcome"], "DENIED")
        self.assertFalse((self.ws / "scenario.txt").exists())
        self.assertFalse(final["effect_achieved"])
        self.assertTrue(final["blocked"])
        # the session may say COMPLETED; the action truth says blocked
        st = self.client.get_progress(sid)
        self.assertEqual(st["tasks"][final["task_id"]], "COMPLETED")
        # Genesis must not be able to read this as success
        outcome = self.client.get_outcome(sid, final["task_id"])
        self.assertFalse(outcome["effect_achieved"])


class TestScenarioAsk(ScenarioBase):
    approval = "ASK_ALL_WRITES"
    external_approvals = True

    def test_ask_end_to_end(self):
        proposal, params = make_proposal(disposition="approval_required")
        sent = self.client.submit_proposal(
            proposal, params, workspace=str(self.ws),
            approval="ASK_ALL_WRITES", interactive=True)
        response = sent["response"]
        self.assertEqual(response["outcome"], "WAITING_APPROVAL")
        sid = response["session_id"]
        pending = self.wait_pending(sid)
        self.assertTrue(pending)
        self.client.approve(sid, pending[0])
        final = self.wait_outcome(proposal["proposal_id"])
        self.assertEqual(final["outcome"], "SUCCEEDED")
        self.assertEqual((self.ws / "scenario.txt").read_text(), "scenario-ok")
        # single-use: the approval cannot authorize a second action
        from client import ClientError  # noqa: PLC0415 (test-only probe)
        with self.assertRaises(ClientError):
            self.client.approve(sid, pending[0])

    def test_non_interactive_runtime_refuses_explicitly(self):
        self.service.stop()
        self.service.start_injected(
            script=self.script, port=self.port, external_approvals=False,
            approval="ASK_ALL_WRITES")
        proposal, params = make_proposal()
        with self.assertRaises(Exception) as ctx:
            self.client.submit_proposal(
                proposal, params, workspace=str(self.ws),
                approval="ASK_ALL_WRITES", interactive=True)
        self.assertIn("not enabled", str(ctx.exception))


class TestScenarioMultiResource(ScenarioBase):
    def test_move_both_sides_gated(self):
        (self.ws / "src.txt").write_text("payload", encoding="utf-8")
        proposal, params = make_proposal(action="move", resource="src.txt",
                                         parameters={"dest": "dst.txt"})
        sent = self.client.submit_proposal(proposal, params,
                                           workspace=str(self.ws))
        self.assertEqual(sent["response"]["outcome"], "SUCCEEDED")
        self.assertFalse((self.ws / "src.txt").exists())
        self.assertTrue((self.ws / "dst.txt").exists())
        # the adapter refuses to build a move without a destination, so an
        # authorized source can never imply an unchecked destination
        bad, bad_params = make_proposal(action="move", resource="src2.txt",
                                        parameters={})
        with self.assertRaises(ProposalAdapterError):
            adapt_proposal(bad, bad_params, workspace=str(self.ws))


class TestScenarioAllDenied(ScenarioBase):
    approval = "ASK_ALL_WRITES"
    external_approvals = True

    def test_all_denied_is_blocked_not_success(self):
        proposal, params = make_proposal(disposition="approval_required")
        sent = self.client.submit_proposal(
            proposal, params, workspace=str(self.ws),
            approval="ASK_ALL_WRITES", interactive=True)
        response = sent["response"]
        self.assertEqual(response["outcome"], "WAITING_APPROVAL")
        self.client.deny(response["session_id"], response["approval_id"])
        final = self.wait_outcome(proposal["proposal_id"])
        self.assertEqual(final["outcome"], "DENIED")
        self.assertEqual(final["denied_actions"], 1)
        self.assertFalse(final["effect_achieved"])
        self.assertTrue(final["blocked"])
        # positive reviewer text cannot override journal truth: the outcome
        # mapping reads the journal, not the verdict
        outcome = self.client.get_outcome(response["session_id"],
                                          final["task_id"])
        self.assertFalse(outcome["effect_achieved"])


if __name__ == "__main__":
    unittest.main()
