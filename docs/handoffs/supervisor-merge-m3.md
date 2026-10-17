# SUPERVISOR-MERGE-M3 — NEXT CANONICAL UI TASK (for OpenCode)

Status: MERGE M2 DONE (01a7343). Canonical React supervisor-ui.html now carries
the M2 mission-control composition. This is the next bounded task.

## CONTEXT (read these first — both pushed)
- Agent-Bridge-dashboard/docs/REFERENCE_MANIFEST_AND_DESIGN_MATRIX.md
  (the vibe-prototype design DNA + component map)
- The vibe-prototype source:
  C:\Users\jpowe\Desktop\Projects\IDE-Workspace-dashboard\references\vibe-prototype\aetherius-ide\src\
  (TeamMeetingView.tsx = conference; AvatarHologram = glow avatar;
   PerformanceDashboardModal = resource gauges; ChatPanel = messaging)
- Your own M2-A: components/avatar.tsx, worker-card.tsx, team-room.tsx

## OBJECTIVE — M3: CONFERENCE + MESSAGING + RICHER MISSION CONTROL (§11/§12/§14)

Port the vibe-prototype's mechanisms into the CANONICAL React supervisor-ui,
bound to LIVE data, keeping every existing test green.

### 1. CONFERENCE VIEW (§12) — port TeamMeetingView's composition
- A `ConferenceView` component reading the SAME `workers` fact.
- Layouts: gallery grid (all active workers as conference tiles with large
  avatars + status). NO fake active speaker — if no worker is `speaking`,
  show an honest empty state ("no worker is currently speaking").
- Filters: project / status (from roster fields; unknown -> honest empty).
- Each tile: avatar (your Avatar), name, role, status, current task.
- Voice/video controls: honest NOT_IMPLEMENTED / DEFERRED_INTERFACE chips —
  do NOT fake a live call.

### 2. INTER-AGENT MESSAGE FEED (§14) — port ChatPanel's list
- A `MessageFeed` component reading the REAL supervisor event stream
  (useSupervisor().events — the same SSE source the Events tab uses; ONE
  event stream, no second connection).
- Render each event: human-readable type, timestamp, worker, payload summary.
- Do NOT fabricate team chatter. If there are no events, show an honest
  empty state. This is machine events made legible, not invented conversation.

### 3. RICHER MISSION CONTROL (§10) — extend MissionControl
- Add the missing §6 tiles that have a LIVE source today: CPU/RAM/GPU/VRAM
  from resources.sample (if the governor exposes them), GIT health, TEST
  health. Any tile whose source is absent MUST read NOT_EXPOSED, never 0.
- Consider a small sparkline/trend ONLY if a real time-series fact exists;
  otherwise skip — do not invent data to fill a chart.

### 4. VISUAL POLISH TOWARD F4 (§7/§18) — port vibe-prototype mechanisms
- Glass panels + subtle glow on active/selected worker cards (CSS only, via
  tokens — NO raw hex, bounds test enforces this).
- The `sv-grad-text` treatment on section titles (already seeded).
- Keep the five themes working (Abyss/Aurora/Ember/Graphite/Frost) — every new
  colour from a token.

## HARD CONSTRAINTS (unchanged — the unit's laws)
- Network ONLY in api/client.ts (bounds test). MessageFeed uses the EXISTING
  useSupervisor() hook, no new fetch.
- No raw hex in any component or the component half of tokens.css.
- client.ts must not contain literal '30' (FRESHNESS_WINDOW_S guard).
- No fabricated state: an absent fact reads NOT_EXPOSED; a degraded fact keeps
  its state; nothing upgrades OFFLINE->LIVE in the client.
- Do NOT touch genesis-ui (frozen). Do NOT modify the tested client/hook shape.
- LIVE mode shows real workers only.

## ACCEPTANCE (Hermes verifies independently — do not self-report done)
- npx tsc --noEmit exits 0
- npx vitest run src/supervisor-ui: ALL existing 147 pass + new tests
- >= 8 new tests: conference empty-state (no speaker), conference renders live
  workers, message feed renders real events, message feed empty-state, new
  mission tiles read NOT_EXPOSED when source absent, no-fake-call chips.
- Renders live at http://127.0.0.1:5199/supervisor-ui.html (Conference +
  Messages reachable from the nav).
- COMMIT + PUSH to master. Write a handoff listing LIVE vs DEFERRED_INTERFACE.

When M3 lands, Hermes re-runs the §42 scorecard (target F3, then F4). Do not
stop after committing — if M3 finishes early, write the handoff and stop
cleanly; Hermes assigns M4 (IDE/work surface).
