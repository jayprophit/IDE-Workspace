"""Genesis proposal -> BridgeActionRequest adapter: structural translation only.

Pure unit tests (no service): the adapter translates fields, verifies the
parameter digest, and refuses anything it cannot translate honestly. It must
never authorize, approve, execute, or claim effect - these tests pin every one
of those boundaries.
"""
from __future__ import annotations

import unittest

from integration.proposal_adapter import (
    BANNED_KEYS,
    ProposalAdapterError,
    adapt_proposal,
    canonical_parameters_digest,
)

WS = "C:/work/proj"


def proposal(**overrides) -> dict:
    params = {"content": "hello"}
    base = {
        "proposal_id": "apx-0123456789abcdef",
        "genesis_id": "genesis-canonical-0001",
        "run_id": "run-1",
        "capability_id": "tool-writer",
        "tool_id": "tool-writer",
        "action": "write",
        "resource": "notes.txt",
        "parameter_digest": canonical_parameters_digest(params),
        "evidence_digest": "d" * 64,
        "receipt_digest": "e" * 64,
        "disposition": "proposed",
        "rationale": "record the current state",
        "authority_owner": "p25",
    }
    base.update(overrides)
    return base, params


class AdaptValid(unittest.TestCase):
    def test_valid_proposal_maps_every_wire_field(self):
        p, params = proposal()
        body = adapt_proposal(p, params, workspace=WS)
        self.assertEqual(body, {
            "action_id": "apx-0123456789abcdef",
            "action": "write",
            "resource": "notes.txt",
            "workspace": WS,
            "session_id": "run-1",
            "payload": {"content": "hello"},
            "principal": {"kind": "genesis", "id": "genesis-canonical-0001"},
            "owner_mode": "",
            "approval": "",
            "interactive": False,
            "wait_ms": 30000,
        })

    def test_identity_and_correlation_survive(self):
        p, params = proposal()
        body = adapt_proposal(p, params, workspace=WS)
        # three different ids, three different jobs, none collapsed
        self.assertEqual(body["principal"]["id"], "genesis-canonical-0001")
        self.assertEqual(body["session_id"], "run-1")
        self.assertEqual(body["action_id"], "apx-0123456789abcdef")
        self.assertNotEqual(body["action_id"], body["session_id"])
        self.assertNotEqual(body["principal"]["id"], body["action_id"])

    def test_explicit_session_label_overrides_run(self):
        p, params = proposal()
        body = adapt_proposal(p, params, workspace=WS, session_id="wf-9")
        self.assertEqual(body["session_id"], "wf-9")

    def test_host_options_pass_through_untouched(self):
        p, params = proposal()
        body = adapt_proposal(p, params, workspace=WS, approval="ASK_ALL_WRITES",
                              interactive=True, owner_mode="", wait_ms=5000)
        self.assertEqual(body["approval"], "ASK_ALL_WRITES")
        self.assertTrue(body["interactive"])
        self.assertEqual(body["wait_ms"], 5000)

    def test_digests_do_not_reach_the_wire(self):
        p, params = proposal()
        body = adapt_proposal(p, params, workspace=WS)
        flat = str(body)
        self.assertNotIn("d" * 64, flat)
        self.assertNotIn("e" * 64, flat)
        self.assertNotIn("record the current state", flat)

    def test_approval_required_disposition_passes_through(self):
        p, params = proposal(disposition="approval_required")
        body = adapt_proposal(p, params, workspace=WS)
        # the adapter does not decide authority: the caller still supplies
        # approval/interactive, and the defaults decide nothing
        self.assertEqual(body["approval"], "")
        self.assertFalse(body["interactive"])

    def test_empty_parameters_with_matching_digest(self):
        p, params = proposal()
        params.clear()
        p["parameter_digest"] = canonical_parameters_digest(params)
        p["action"] = "read"
        body = adapt_proposal(p, params, workspace=WS)
        self.assertEqual(body["payload"], {})

    def test_digest_convention_is_stable(self):
        self.assertEqual(
            canonical_parameters_digest({"b": 1, "a": [1, 2]}),
            canonical_parameters_digest({"a": [1, 2], "b": 1}))
        self.assertRegex(canonical_parameters_digest({}), r"^[0-9a-f]{64}$")


class AdaptRefusals(unittest.TestCase):
    def test_non_object_proposal_refused(self):
        with self.assertRaises(ProposalAdapterError):
            adapt_proposal("nope", {}, workspace=WS)  # type: ignore[arg-type]

    def test_missing_fields_refused(self):
        for field in ("proposal_id", "genesis_id", "run_id", "capability_id",
                      "tool_id", "action", "resource", "parameter_digest"):
            p, params = proposal()
            del p[field]
            with self.assertRaises(ProposalAdapterError, msg=field):
                adapt_proposal(p, params, workspace=WS)

    def test_refused_disposition_refused(self):
        p, params = proposal(disposition="refused")
        with self.assertRaises(ProposalAdapterError) as ctx:
            adapt_proposal(p, params, workspace=WS)
        self.assertIn("declined to propose", str(ctx.exception))

    def test_unknown_disposition_refused(self):
        p, params = proposal(disposition="authorized")
        with self.assertRaises(ProposalAdapterError):
            adapt_proposal(p, params, workspace=WS)

    def test_digest_mismatch_refused(self):
        p, params = proposal()
        params["content"] = "tampered"
        with self.assertRaises(ProposalAdapterError) as ctx:
            adapt_proposal(p, params, workspace=WS)
        self.assertIn("do not match", str(ctx.exception))

    def test_malformed_digest_refused(self):
        p, params = proposal(parameter_digest="not-a-digest")
        with self.assertRaises(ProposalAdapterError):
            adapt_proposal(p, params, workspace=WS)

    def test_finish_verb_refused(self):
        p, params = proposal(action="finish")
        with self.assertRaises(ProposalAdapterError) as ctx:
            adapt_proposal(p, params, workspace=WS)
        self.assertIn("loop control", str(ctx.exception))

    def test_move_without_dest_refused(self):
        p, params = proposal(action="move")
        params.clear()
        p["parameter_digest"] = canonical_parameters_digest(params)
        with self.assertRaises(ProposalAdapterError):
            adapt_proposal(p, params, workspace=WS)

    def test_move_with_dest_maps(self):
        p, params = proposal(action="move")
        params.clear()
        params["dest"] = "dst.txt"
        p["parameter_digest"] = canonical_parameters_digest(params)
        body = adapt_proposal(p, params, workspace=WS)
        self.assertEqual(body["payload"], {"dest": "dst.txt"})
        self.assertEqual(body["resource"], "notes.txt")

    def test_missing_workspace_refused(self):
        p, params = proposal()
        with self.assertRaises(ProposalAdapterError):
            adapt_proposal(p, params, workspace="")

    def test_non_dict_parameters_refused(self):
        p, _ = proposal()
        with self.assertRaises(ProposalAdapterError):
            adapt_proposal(p, "params", workspace=WS)  # type: ignore[arg-type]


class AdaptNoAuthoritySmuggling(unittest.TestCase):
    def test_banned_keys_in_proposal_refused(self):
        for key in ("authorized", "approve", "grant", "execute", "executed",
                    "allow", "policy_bypass", "owner_override", "admin"):
            p, params = proposal()
            p[key] = True
            with self.assertRaises(ProposalAdapterError, msg=key):
                adapt_proposal(p, params, workspace=WS)

    def test_banned_keys_in_parameters_refused(self):
        for key in ("authorized", "grant_approved", "permission", "sudo"):
            p, params = proposal()
            params[key] = True
            p["parameter_digest"] = canonical_parameters_digest(params)
            with self.assertRaises(ProposalAdapterError, msg=key):
                adapt_proposal(p, params, workspace=WS)

    def test_nested_banned_keys_refused(self):
        p, params = proposal()
        params["options"] = {"nested": {"approve": True}}
        p["parameter_digest"] = canonical_parameters_digest(params)
        with self.assertRaises(ProposalAdapterError):
            adapt_proposal(p, params, workspace=WS)

    def test_host_fields_smuggled_in_proposal_refused(self):
        for key in ("approval", "interactive", "owner_mode"):
            p, params = proposal()
            p[key] = "ASK_ALL_WRITES" if isinstance(p.get(key), str) else True
            with self.assertRaises(ProposalAdapterError, msg=key):
                adapt_proposal(p, params, workspace=WS)

    def test_adapter_never_invents_approval(self):
        # approval_required proposals still leave the decision to the caller;
        # the adapter must not read authority intent out of the disposition.
        p, params = proposal(disposition="approval_required")
        body = adapt_proposal(p, params, workspace=WS)
        self.assertEqual(body["approval"], "")
        self.assertFalse(body["interactive"])
        self.assertEqual(body["owner_mode"], "")

    def test_banned_list_is_not_empty(self):
        self.assertGreater(len(BANNED_KEYS), 20)


if __name__ == "__main__":
    unittest.main()
