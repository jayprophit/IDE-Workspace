"""Expanded realistic workflow: a buggy project, fixed through the real stack.

A disposable fixture project contains a real bug. The harness drives the full
loop — inspect, plan, propose, authorize, edit, test, observe REAL failure,
reason, correct, rerun, verify — through the proposal adapter and the live
Bridge service. No stage is faked; no model is involved (directed actions
only, with a canary proving the injected model never runs).

Honesty boundaries, stated once:
- "Genesis reasoning" below means the test harness deciding the next step
  from known fixture state. It is labeled REASONING_HARNESS wherever it
  appears and is never presented as Genesis cognition (proven separately by
  the C++ suites).
- The human approval role is played by the harness approving listed pending
  ids. Every decision is journalled server-side; the harness never invents
  an approval.
- World-state verification reads the workspace files directly. Those files
  ARE the world state; reading them is readback, not injection.
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

CALC_BUGGY = "def add(a, b):\n    return a + b + 1\n"
CALC_FIXED = "def add(a, b):\n    return a + b\n"
TEST_CALC = (
    "from calc import add\n"
    "\n"
    "\n"
    "def test_add():\n"
    "    assert add(1, 1) == 2\n"
    "\n"
    "\n"
    "def test_add_zero():\n"
    "    assert add(0, 5) == 5\n"
)
# Environment pin: passes with or without the bug, with or without imports.
# If the runner cannot even pass this, the environment (not the code) is broken
# and the scenario must say so instead of blaming the bug.
TEST_SANITY = "def test_sanity():\n    assert 1 + 1 == 2\n"
CANARY_SCRIPT = [
    '{"action":"write","path":"SHOULD-NEVER-RUN.txt","content":"x"}',
    '{"action":"finish","message":"unused"}',
]
GENESIS_ID = "genesis-canonical-0001"


def _bridge_root() -> str:
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
    root = _bridge_root()
    if not (Path(root) / "runtime.py").exists():
        raise unittest.SkipTest(f"Agent-Bridge checkout absent at {root}")
    return root


def _proposal(action: str, resource: str, params: dict,
              run_id: str, disposition: str = "proposed",
              tag: str = "") -> tuple[dict, dict]:
    import hashlib
    # Content-addressed and collision-free: the full triple is hashed, so two
    # different steps can never share an id no matter how long names get.
    # (A 60-char truncation here once caused a real 409 collision, which at
    # least proved the intake refuses aliases.)
    digest = hashlib.sha256(
        f"{run_id}|{tag}|{action}|{resource}|"
        f"{canonical_parameters_digest(params)}".encode()).hexdigest()[:16]
    label = f"{tag}-{action}" if tag else action
    return {
        "proposal_id": f"apx-{label}-{digest}",
        "genesis_id": GENESIS_ID,
        "run_id": run_id,
        "capability_id": "tool-runner",
        "tool_id": "tool-runner",
        "action": action,
        "resource": resource,
        "parameter_digest": canonical_parameters_digest(params),
        "evidence_digest": "d" * 64,
        "receipt_digest": "e" * 64,
        "disposition": disposition,
        "rationale": "expanded workflow step",
        "authority_owner": "p25",
    }, params


class WorkflowBase(unittest.TestCase):
    approval = "ASK_ALL_WRITES"
    external_approvals = True

    def setUp(self):
        bridge_root = _require_bridge()
        self.tmp = Path(tempfile.mkdtemp(prefix="ide_expand_"))
        self.ws = self.tmp / "proj"
        self.ws.mkdir()
        # the known fixture project, buggy as found, plus an environment pin
        (self.ws / "calc.py").write_text(CALC_BUGGY, encoding="utf-8")
        (self.ws / "test_calc.py").write_text(TEST_CALC, encoding="utf-8")
        (self.ws / "test_sanity.py").write_text(TEST_SANITY, encoding="utf-8")
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
            script=CANARY_SCRIPT, port=self.port,
            external_approvals=self.external_approvals, approval=self.approval)
        self.client = IdeBridgeClient(self.config)
        self.run_id = f"run-expand-{self._testMethodName}"
        self.seen_approvals: list[str] = []

    def tearDown(self):
        self.service.stop()
        shutil.rmtree(self.tmp, ignore_errors=True)
        self.assertFalse(self.tmp.exists(), "harness leaked its temp dir")

    # -- harness helpers (human-proxy + reasoning, labeled as such) --------
    def propose(self, action: str, resource: str, params: dict,
                disposition: str = "proposed", tag: str = "",
                approval: str | None = None,
                interactive: bool | None = None, **kw) -> dict:
        """REASONING_HARNESS: build the proposal a Genesis would emit.

        Sessions default to the class approval level with a real decision
        channel, because an ASK session without interactivity denies
        fail-closed by design - and a workflow that never authorizes its own
        writes would prove nothing.
        """
        proposal, _ = _proposal(action, resource, params, self.run_id,
                                disposition, tag or action)
        if approval is None:
            approval = self.approval
        if interactive is None:
            interactive = self.external_approvals
        sent = self.client.submit_proposal(
            proposal, params, workspace=str(self.ws), approval=approval,
            interactive=interactive, **kw)
        # identity stability: every request attributable to one Genesis
        self.assertEqual(sent["request"]["principal"],
                         {"kind": "genesis", "id": GENESIS_ID})
        return sent

    def approve_all(self, session_id: str, limit: int = 10) -> list[str]:
        """HUMAN_PROXY: approve listed pending ids, recording each one."""
        approved: list[str] = []
        for _ in range(limit):
            pending = self.client.get_approvals(session_id)
            if not pending:
                return approved
            for aid in pending:
                self.client.approve(session_id, aid)
                approved.append(aid)
                self.seen_approvals.append(aid)
        self.fail(f"approvals never drained: {approved}")
        raise AssertionError

    def wait_settled(self, action_id: str, timeout: float = 90.0) -> dict:
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

    def run_to_settled(self, sent: dict, approve: bool = True,
                       timeout: float = 90.0) -> dict:
        """Drive one proposal to a terminal outcome, approving as human."""
        action_id = sent["request"]["action_id"]
        session_id = sent["response"]["session_id"]
        end = time.time() + timeout
        while time.time() < end:
            st = self.client.action_status(action_id)
            if st.get("outcome") == "WAITING_APPROVAL":
                if not approve:
                    return st
                self.approve_all(session_id)
                continue
            if st.get("outcome") in ("SUCCEEDED", "DENIED", "FAILED",
                                     "CANCELLED"):
                return st
            time.sleep(0.3)
        self.fail(f"action {action_id} never settled")
        raise AssertionError

    def read_world(self, name: str) -> str | None:
        target = self.ws / name
        return target.read_text(encoding="utf-8") if target.exists() else None


class TestExpandedWorkflow(WorkflowBase):
    def test_inspect_plan_fix_verify(self):
        # 1. INSPECT: read the unfamiliar files through the stack
        for name in ("calc.py", "test_calc.py"):
            sent = self.propose("read", name, {})
            final = self.run_to_settled(sent)
            self.assertEqual(final["outcome"], "SUCCEEDED", final)
        # world-state readback: the files really are what the fixture says
        self.assertEqual(self.read_world("calc.py"), CALC_BUGGY)
        self.assertEqual(self.read_world("test_calc.py"), TEST_CALC)

        # 2. REASONING_HARNESS plan from observed state: the bug is `+ 1`;
        #    the fix is a full-file write; correctness is proven by tests.
        # 3a. ENVIRONMENT PIN: an import-free test must pass, or the runner
        # (not the code) is broken and the scenario must say so.
        # NOTE on ids: every invocation gets a distinct tag even when the
        # command string repeats. The intake keys idempotency on the requested
        # effect, so reusing one id across different world states would
        # replay the earlier recorded result instead of executing - which is
        # correct intake behavior and would silently test nothing here.
        sent = self.propose("test", "test_sanity.py",
                            {"command": "python -m pytest test_sanity.py -q"},
                            tag="sanity-baseline")
        final = self.run_to_settled(sent)
        self.assertEqual(final["outcome"], "SUCCEEDED", final)
        cmds = final["output"]["commands_executed"]
        self.assertTrue(cmds and cmds[0]["ok"],
                        f"test runner environment broken: {cmds}")
        # 3b. BASELINE: the buggy code must REALLY fail now that the runner
        # is proven healthy.
        sent = self.propose("test", "test_calc.py",
                            {"command": "python -m pytest test_calc.py -q"},
                            tag="calc-baseline")
        final = self.run_to_settled(sent)
        self.assertEqual(final["outcome"], "SUCCEEDED", final)
        cmds = final["output"]["commands_executed"]
        self.assertTrue(cmds, "no command record in the journal")
        self.assertFalse(cmds[0]["ok"], "baseline must REALLY fail")
        self.assertNotEqual(cmds[0].get("exit_code"), 0)

        # 4. PROPOSE the fix under human authority
        sent = self.propose("write", "calc.py", {"content": CALC_FIXED},
                            disposition="approval_required",
                            tag="fix-write",
                            approval="ASK_ALL_WRITES", interactive=True)
        waiting = self.wait_settled(sent["request"]["action_id"])
        self.assertEqual(waiting["outcome"], "WAITING_APPROVAL", waiting)
        self.approve_all(waiting["session_id"])
        final = self.wait_settled(sent["request"]["action_id"])
        self.assertEqual(final["outcome"], "SUCCEEDED", final)
        self.assertTrue(final["effect_achieved"])
        # 5. WORLD-STATE VERIFICATION: bytes on disk changed, nothing else did
        self.assertEqual(self.read_world("calc.py"), CALC_FIXED)
        self.assertEqual(self.read_world("test_calc.py"), TEST_CALC)

        # 6. RERUN: the same tests now pass for real (fresh id: the world
        # changed since the baseline, so replaying its id would return the
        # recorded failure instead of executing)
        sent = self.propose("test", "test_calc.py",
                            {"command": "python -m pytest test_calc.py -q"},
                            tag="calc-rerun")
        final = self.run_to_settled(sent)
        self.assertEqual(final["outcome"], "SUCCEEDED", final)
        cmds = final["output"]["commands_executed"]
        self.assertTrue(cmds and cmds[0]["ok"], f"rerun must pass: {cmds}")
        # and the environment pin still passes alongside
        sent = self.propose("test", "test_sanity.py",
                            {"command": "python -m pytest test_sanity.py -q"},
                            tag="sanity-rerun")
        final = self.run_to_settled(sent)
        cmds = final["output"]["commands_executed"]
        self.assertTrue(cmds and cmds[0]["ok"], f"sanity regressed: {cmds}")

        # 7. COMPLETION = goal achievement: manifest, journal and bytes agree
        evidence = self.client.get_evidence(final["session_id"])
        paths = [c.get("path") for c in
                 evidence["manifest"].get("changes", [])]
        self.assertTrue(any("calc.py" in str(p) for p in paths), paths)
        outcome = self.client.get_outcome(final["session_id"],
                                          final["task_id"])
        self.assertTrue(outcome["effect_achieved"])
        # the injected model never ran anywhere in this workflow
        self.assertIsNone(self.read_world("SHOULD-NEVER-RUN.txt"))
        # one Genesis, one run lineage, approvals all recorded
        self.assertTrue(self.seen_approvals, "no human decision was exercised")


class TestWorkflowFailures(WorkflowBase):
    def test_denied_correction_leaves_world_unchanged(self):
        sent = self.propose("write", "calc.py", {"content": "junk"},
                            disposition="approval_required",
                            approval="ASK_ALL_WRITES", interactive=True)
        waiting = self.wait_settled(sent["request"]["action_id"])
        self.assertEqual(waiting["outcome"], "WAITING_APPROVAL")
        pending = self.client.get_approvals(waiting["session_id"])
        self.assertTrue(pending)
        self.client.deny(waiting["session_id"], pending[0])
        final = self.wait_settled(sent["request"]["action_id"])
        self.assertEqual(final["outcome"], "DENIED")
        self.assertTrue(final["blocked"])
        self.assertEqual(self.read_world("calc.py"), CALC_BUGGY)

    def test_tampered_parameters_refused_before_wire(self):
        proposal, params = _proposal("write", "calc.py",
                                     {"content": CALC_FIXED}, self.run_id)
        params["content"] = "tampered"
        with self.assertRaises(ProposalAdapterError):
            adapt_proposal(proposal, params, workspace=str(self.ws))
        self.assertEqual(self.read_world("calc.py"), CALC_BUGGY)

    def test_malformed_request_fails_closed(self):
        from client import ClientError  # noqa: PLC0415 (test-only probe)
        with self.assertRaises(ClientError):
            self.client.client.submit_action(
                "wf-malformed", "write", "*.txt", workspace=str(self.ws),
                payload={"content": "x"})

    def test_delayed_result_then_poll(self):
        sent = self.propose("read", "calc.py", {})
        # ask with no wait: the request times out honestly, the task continues
        quick = self.client.client.submit_action(
            sent["request"]["action_id"] + "-nowait", "read", "calc.py",
            workspace=str(self.ws), wait_ms=0)
        self.assertIn(quick["outcome"], ("UNKNOWN_OUTCOME", "TIMED_OUT",
                                         "SUCCEEDED"))
        final = self.wait_settled(sent["request"]["action_id"] + "-nowait")
        self.assertEqual(final["outcome"], "SUCCEEDED")

    def test_stale_approval_cannot_authorize(self):
        sent = self.propose("write", "calc.py", {"content": CALC_FIXED},
                            disposition="approval_required",
                            approval="ASK_ALL_WRITES", interactive=True)
        waiting = self.wait_settled(sent["request"]["action_id"])
        self.assertEqual(waiting["outcome"], "WAITING_APPROVAL")
        self.approve_all(waiting["session_id"])
        final = self.wait_settled(sent["request"]["action_id"])
        self.assertEqual(final["outcome"], "SUCCEEDED")
        # second mutation needs a fresh human decision: the first approval
        # must not linger as authority
        sent2 = self.propose("write", "calc.py", {"content": CALC_BUGGY},
                             disposition="approval_required",
                             approval="ASK_ALL_WRITES", interactive=True)
        waiting2 = self.wait_settled(sent2["request"]["action_id"])
        self.assertEqual(waiting2["outcome"], "WAITING_APPROVAL",
                         "a consumed approval reused would be a grant leak")
        self.client.deny(waiting2["session_id"], waiting2["approval_id"])
        self.assertEqual(self.read_world("calc.py"), CALC_FIXED)

    def test_service_down_fails_loud(self):
        self.service.stop()
        with self.assertRaises(Exception):
            self.client.submit_proposal(
                *_proposal("read", "calc.py", {}, self.run_id),
                workspace=str(self.ws))


class TestWorkflowRepeat(WorkflowBase):
    def test_core_flow_repeats_cleanly(self):
        # Repeatability: the inspect-fix-verify core twice in fresh sessions.
        # Goes through propose() so sessions get a real decision channel: a
        # directed write without one denies fail-closed by design, which is
        # what an earlier draft of this test tripped over.
        for round_no in range(2):
            sent = self.propose("write", f"round{round_no}.txt",
                                {"content": f"r{round_no}"},
                                tag=f"round{round_no}")
            final = self.run_to_settled(sent)
            self.assertEqual(final["outcome"], "SUCCEEDED", (round_no, final))
            self.assertTrue(final["effect_achieved"], (round_no, final))
            self.assertEqual(self.read_world(f"round{round_no}.txt"),
                             f"r{round_no}")


if __name__ == "__main__":
    unittest.main()
