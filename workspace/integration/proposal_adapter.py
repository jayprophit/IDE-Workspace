"""Genesis proposal -> BridgeActionRequest adapter (structural translation only).

The chain has three different contracts with three different jobs:

    Genesis ActionProposal  (intent + evidence, never authority, never effect)
        -> BridgeActionRequest / POST /v1/actions body (a typed ask)
            -> P25 / policy / approval (the decision)
                -> executor / journal (the effect and its record)

This module is the first arrow and nothing else. It translates fields,
verifies the parameter digest, and refuses anything it cannot translate
honestly. It does not authorize, approve, execute, mutate, grant, or claim.

Trust boundary: the proposal and parameters originate outside this process
(Genesis, possibly via a model) and are UNTRUSTED. The adapter options
(workspace, approval, interactive, owner_mode, wait_ms) come from the host
(the IDE/session configuration) and are trusted. Anything in the untrusted
half that smells like authority is refused, never passed through.

Field classification against the real contracts
(Genesis include/genesis/agents/action_proposal.hpp,
Aetherius src/workflows/bridgeAction.ts, Agent Bridge actions.py):

    DIRECT MAP      proposal_id   -> action_id (both content-addressed ids)
    DIRECT MAP      action (verb) -> action (bare verb; the server validates
                        the canonical service:verb pairing, so inventing a
                        namespace here would be forging authority context)
    DIRECT MAP      resource      -> resource (one resource per proposal, which
                        is exactly the intake's one-resource rule)
    DIRECT MAP      genesis_id    -> principal {kind: genesis, id}
    DIRECT MAP      run_id        -> session_id label (correlation, not identity)
    DIRECT MAP      parameters    -> payload (only after digest verification)
    VERIFIED+DROP   parameter_digest (integrity check, then dropped: a digest
                        is not executable and has no wire field)
    DROP (logged)   evidence_digest, receipt_digest, rationale, capability_id,
                    tool_id (scenario evidence, not execution input; P25
                    derives capability from the verb canonically, so passing
                    Genesis-side routing ids would be misleading, not helpful)
    HOST OPTION     workspace, approval, interactive, owner_mode, wait_ms
                        (never read from the proposal; a proposal carrying
                        them is refused as smuggling)
    REFUSED         disposition == refused, unknown dispositions, `finish`
                        verbs, move/copy without dest, banned authority keys

Permanent:
    ADAPTER != AUTHORITY
    ADAPTER != EXECUTOR
    EVIDENCE FOR ACTION != PERMISSION FOR ACTION
"""
from __future__ import annotations

import hashlib
import json
from typing import Any


class ProposalAdapterError(ValueError):
    """The proposal cannot be honestly translated. Refusal, not failure."""


# Keys that must never cross from an untrusted proposal into a request.
# Mirrors the governance convention that a proposal must not express its own
# authority (Aetherius proposals.ts BANNED_AUTHORITY_KEYS), extended to
# execution-adjacent claims. Matched case-insensitively against key names.
BANNED_KEYS = frozenset({
    "authorized", "authorize", "approve", "approved",
    "approvalgranted", "approval_granted",
    "execute", "executed", "grant", "grantapproved", "grant_approved",
    "policybypass", "policy_bypass", "owneroverride", "owner_override",
    "canmerge", "can_merge", "candeploy", "can_deploy", "applied",
    "allow", "allowed", "permission", "permissions", "privileged",
    "root", "admin", "sudo", "superuser", "bypass", "override",
    "approval", "interactive", "owner_mode", "ownermode",
})
# Deliberate trade-off, stated plainly: a legitimate parameter can in theory
# be named "approve" (approving a pull request, for example), and this refuses
# it. Fail-closed wins for a first typed contract because an "approve" key
# flowing into an authority-adjacent request is exactly what field injection
# looks like; the refusal names the key, so the caller renames to something
# unambiguous like "approve_pr". Values are never scanned, only key names.

REQUIRED_PROPOSAL_FIELDS = (
    "proposal_id", "genesis_id", "run_id", "capability_id",
    "tool_id", "action", "resource", "parameter_digest",
)

VALID_DISPOSITIONS = ("proposed", "approval_required")

MAX_ID_LENGTH = 128


def canonical_parameters_digest(parameters: dict[str, Any]) -> str:
    """The digest convention hosts must use when producing parameter_digest.

    Canonical JSON (sorted keys, compact separators, UTF-8), SHA-256 hex.
    The Genesis C++ emitter treats parameter_digest opaquely (shape-checked
    only), so this module owns the convention and verifies against it.
    """
    canonical = json.dumps(parameters, sort_keys=True, separators=(",", ":"),
                           ensure_ascii=True)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _find_banned_keys(value: Any, path: str = "") -> list[str]:
    """Recursively collect banned key names (case-insensitive)."""
    found: list[str] = []
    if isinstance(value, dict):
        for key, item in value.items():
            name = str(key)
            here = f"{path}.{name}" if path else name
            flat = name.lower().replace("-", "").replace(" ", "")
            if flat in BANNED_KEYS:
                found.append(here)
            found.extend(_find_banned_keys(item, here))
    elif isinstance(value, (list, tuple)):
        for index, item in enumerate(value):
            found.extend(_find_banned_keys(item, f"{path}[{index}]"))
    return found


def _check_id(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value:
        raise ProposalAdapterError(f"invalid proposal: {field} is required")
    if len(value) > MAX_ID_LENGTH:
        raise ProposalAdapterError(f"invalid proposal: {field} is too long")
    return value


def adapt_proposal(
    proposal: dict[str, Any],
    parameters: dict[str, Any] | None = None,
    *,
    workspace: str,
    session_id: str = "",
    approval: str = "",
    interactive: bool = False,
    owner_mode: str = "",
    wait_ms: int = 30000,
) -> dict[str, Any]:
    """Translate a Genesis action proposal into a POST /v1/actions body.

    Raises ProposalAdapterError on anything that cannot be translated
    honestly. Never authorizes, never executes, never claims effect.
    """
    if not isinstance(proposal, dict):
        raise ProposalAdapterError("invalid proposal: must be an object")
    if parameters is None:
        parameters = {}
    if not isinstance(parameters, dict):
        raise ProposalAdapterError("invalid parameters: must be an object")
    if not isinstance(workspace, str) or not workspace:
        raise ProposalAdapterError("invalid adapter options: workspace is required")

    banned = _find_banned_keys(proposal, "proposal") + \
        _find_banned_keys(parameters, "parameters")
    if banned:
        raise ProposalAdapterError(
            "refused: authority-adjacent keys must never cross the adapter: "
            + ", ".join(sorted(set(banned))))

    for field in REQUIRED_PROPOSAL_FIELDS:
        if field not in proposal:
            raise ProposalAdapterError(f"invalid proposal: {field} is required")

    proposal_id = _check_id(proposal["proposal_id"], "proposal_id")
    genesis_id = _check_id(proposal["genesis_id"], "genesis_id")
    run_id = _check_id(proposal["run_id"], "run_id")
    _check_id(proposal["capability_id"], "capability_id")
    _check_id(proposal["tool_id"], "tool_id")

    disposition = proposal.get("disposition", "")
    if disposition == "refused":
        raise ProposalAdapterError(
            "refused: Genesis declined to propose; there is nothing to send")
    if disposition not in VALID_DISPOSITIONS:
        raise ProposalAdapterError(
            f"invalid proposal: unknown disposition {disposition!r}")

    verb = proposal.get("action", "")
    if not isinstance(verb, str) or not verb:
        raise ProposalAdapterError("invalid proposal: action is required")
    if verb == "finish":
        raise ProposalAdapterError(
            "refused: finish is loop control, not a world action")

    resource = proposal.get("resource", "")
    if not isinstance(resource, str) or not resource:
        raise ProposalAdapterError("invalid proposal: resource is required")

    digest = proposal.get("parameter_digest", "")
    if not isinstance(digest, str) or len(digest) != 64:
        raise ProposalAdapterError(
            "invalid proposal: parameter_digest must be a SHA-256 hex digest")
    if digest != canonical_parameters_digest(parameters):
        raise ProposalAdapterError(
            "refused: parameters do not match the proposal parameter_digest")

    if verb in ("move", "copy") and not parameters.get("dest"):
        raise ProposalAdapterError(
            f"invalid proposal: {verb!r} needs parameters.dest")

    label = session_id or run_id
    return {
        "action_id": proposal_id,
        "action": verb,
        "resource": resource,
        "workspace": workspace,
        "session_id": label,
        "payload": parameters,
        "principal": {"kind": "genesis", "id": genesis_id},
        "owner_mode": owner_mode,
        "approval": approval,
        "interactive": interactive,
        "wait_ms": wait_ms,
    }
