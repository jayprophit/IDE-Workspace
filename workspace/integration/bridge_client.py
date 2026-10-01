"""Thin IDE-side client for Agent Bridge v0.8.1 (IDE_NAME_TBD, slice 2).

This module contains NO agent logic: it imports the supported Agent
Bridge SDK (``client.AgentRuntimeClient`` over the HTTP ``/v1`` API,
read-only w.r.t. the Agent Bridge repository) and exposes the small
surface the IDE shell needs. All execution (DefaultAgent, ModelRouter,
ToolRouter, approvals, verification) stays inside Agent Bridge.
"""
from __future__ import annotations

import os
import sys
import time
from typing import Any

from .bridge_config import BridgeConfig


def _load_sdk(agent_bridge_root: str):
    """Import the Agent Bridge SDK without modifying that repository."""
    root = agent_bridge_root or os.getenv("AGENT_BRIDGE_ROOT", "")
    if not root:
        raise RuntimeError("AGENT_BRIDGE_ROOT is not configured")
    if root not in sys.path:
        sys.path.insert(0, root)
    import client as _sdk  # type: ignore[import-not-found]

    return _sdk


class IdeBridgeClient:
    """IDE-side facade over Agent Bridge's supported HTTP /v1 + SDK."""

    def __init__(self, config: BridgeConfig | None = None):
        self.config = config or BridgeConfig()
        sdk = _load_sdk(self.config.agent_bridge_root)
        self._sdk = sdk
        self.client = sdk.AgentRuntimeClient(
            base=self.config.endpoint, token=self.config.token
        )

    # -- connection ----------------------------------------------------
    def connect(self) -> dict:
        return self.health()

    def health(self) -> dict:
        return self.client.health()

    def capabilities(self) -> dict:
        return self.client.capabilities()

    def models(self) -> dict:
        return self.client.models()

    def selfcheck(self) -> dict:
        return self.client.selfcheck()

    # -- sessions / tasks ----------------------------------------------
    def create_session(
        self,
        workspace: str = "",
        approval: str = "",
        model: str = "",
        mode: str = "",
        interactive: bool | None = None,
    ) -> dict:
        cfg = self.config
        # Use the configured workspace root, or fall back to worker_dir,
        # but the Agent Bridge server must be started with --root set to
        # a path that contains the workspace directory being used.
        ws = workspace or cfg.worker_dir
        return self.client.create_session(
            workspace=ws,
            mode=mode or cfg.mode,
            approval=approval or cfg.approval,
            model=model or cfg.model,
            interactive=cfg.interactive_approvals if interactive is None else interactive,
        )

    def submit_task(self, session_id: str, text: str, idempotency_key: str = "") -> dict:
        return self.client.submit_task(session_id, text, idempotency_key)

    def submit_action(
        self,
        action_id: str,
        action: str,
        resource: str,
        workspace: str = "",
        session_id: str = "",
        payload: dict | None = None,
        principal: dict | None = None,
        owner_mode: str = "",
        approval: str = "",
        interactive: bool = False,
        wait_ms: int = 30000,
    ) -> dict:
        """Typed action intake. Carries a decided action to the Bridge; the
        session's own approval gate, policy engine, executor and journal do
        the rest. Never authorizes anything."""
        return self.client.submit_action(
            action_id=action_id, action=action, resource=resource,
            workspace=workspace or self.config.workspace_root,
            session_id=session_id, payload=payload or {},
            principal=principal, owner_mode=owner_mode, approval=approval,
            interactive=interactive, wait_ms=wait_ms)

    def action_status(self, action_id: str) -> dict:
        return self.client.action_status(action_id)

    def submit_proposal(
        self,
        proposal: dict,
        parameters: dict | None = None,
        workspace: str = "",
        approval: str = "",
        interactive: bool = False,
        owner_mode: str = "",
        wait_ms: int = 30000,
    ) -> dict:
        """Genesis proposal -> BridgeActionRequest -> POST /v1/actions.

        Returns both halves for evidence: the translated request and the
        intake response. The adapter translates only; authority still comes
        from P25/policy/approval, never from the proposal.
        """
        from .proposal_adapter import adapt_proposal
        body = adapt_proposal(
            proposal, parameters, workspace=workspace or self.config.workspace_root,
            approval=approval, interactive=interactive, owner_mode=owner_mode,
            wait_ms=wait_ms)
        response = self.submit_action(
            action_id=body["action_id"], action=body["action"],
            resource=body["resource"], workspace=body["workspace"],
            session_id=body["session_id"], payload=body["payload"],
            principal=body["principal"], owner_mode=body["owner_mode"],
            approval=body["approval"], interactive=body["interactive"],
            wait_ms=body["wait_ms"])
        return {"request": body, "response": response}

    def get_progress(self, session_id: str) -> dict:
        """Session status: task states + pending approvals."""
        return self.client.session_status(session_id)

    def get_actions(self, session_id: str, since: int = 0) -> list[dict]:
        return self.client.events(session_id, since).get("events", [])

    def wait_for_task(
        self,
        session_id: str,
        task_id: str,
        timeout: float = 0,
        poll: float = 0,
        on_approval: Any = None,
    ) -> dict:
        """Poll until a task reaches a terminal state.

        ``on_approval`` is an optional callback receiving the list of
        pending approval ids; it may approve/deny through this client.
        """
        cfg = self.config
        timeout = timeout or cfg.task_timeout_s
        poll = poll or cfg.poll_interval_s
        end = time.time() + timeout
        last: dict = {}
        while time.time() < end:
            last = self.get_progress(session_id)
            tasks = last.get("tasks", {})
            pending = list(last.get("pending_approvals", []))
            if pending and on_approval is not None:
                on_approval(pending)
            if tasks.get(task_id) in (
                "COMPLETED",
                "FAILED",
                "CANCELLED",
                "ROLLED_BACK",
                "INTERRUPTED",
            ):
                return last
            time.sleep(poll)
        raise TimeoutError(f"task {task_id} did not finish within {timeout}s")

    # -- approvals -------------------------------------------------------
    def get_approvals(self, session_id: str) -> list[str]:
        return list(self.get_progress(session_id).get("pending_approvals", []))

    def approve(self, session_id: str, approval_id: str) -> dict:
        return self.client.approve(session_id, approval_id, "approve-once")

    def deny(self, session_id: str, approval_id: str) -> dict:
        return self.client.approve(session_id, approval_id, "deny")

    # -- verification / recovery -----------------------------------------
    def get_verification(self, session_id: str, task_id: str = "") -> dict:
        return self.client.scorecard(session_id)

    def get_outcome(self, session_id: str, task_id: str) -> dict:
        """Effect truth for one task, straight from the Bridge result.

        ``effect_achieved`` / ``denied_actions`` / ``blocked`` are the fields
        that stop a refused run from being shown as a success. They are read,
        never inferred from the status string.
        """
        payload = self.client.export(session_id, task_id, "json")
        result = payload.get("task_result") if isinstance(payload, dict) else None
        if not isinstance(result, dict):
            raise RuntimeError("export payload has no task_result")
        return result

    def get_evidence(self, session_id: str) -> dict:
        """Manifest + scorecard + timeline in one readback."""
        return {
            "manifest": self.client.manifest(session_id),
            "scorecard": self.client.scorecard(session_id),
            "timeline": self.client.timeline(session_id),
        }

    def timeline(self, session_id: str) -> dict:
        return self.client.timeline(session_id)

    def manifest(self, session_id: str) -> dict:
        return self.client.manifest(session_id)

    def export_session(self, session_id: str, task_id: str = "") -> Any:
        return self.client.export(session_id, task_id, "json")

    def cancel(self, session_id: str, task_id: str) -> dict:
        return self.client.cancel(session_id, task_id)

    def checkpoint(self, session_id: str) -> dict:
        """Best-effort checkpoint label via session export metadata."""
        return {"session_id": session_id, "export": self.export_session(session_id)}

    def rollback(self, session_id: str, label: str = "") -> dict:
        return self.client.rollback(session_id, label)
