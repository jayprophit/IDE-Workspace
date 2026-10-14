# SUPERVISOR-MERGE-M4 — WRITE-AHEAD TASK JOURNAL (§3)
Hermes supervisor. Independently observable state for M4. Updated at each
checkpoint. This file is the task-level truth — NOT session timestamps.

## RECORD
| field | value |
|---|---|
| task_id | SUPERVISOR-MERGE-M4 |
| objective | UI-F4 reference-quality production surface (§5 A–F) |
| worker | opencode-primary (session continuity from M2/M3) |
| repo | C:/Users/jpowe/Desktop/Projects/IDE-Workspace |
| worktree | workspace/app (main checkout) |
| branch | master |
| baseline_sha | 98050eb (M3 accepted) |
| spec | docs/handoffs/supervisor-merge-m4.md |
| model | opencode default: ollama-qwen25-coder/qwen2.5-coder:3b-instruct-q4_K_M |
| provider | ollama (local, free) |

## PLANNED WRITE-SET (evidence to watch for)
1. components/worker-inspector.tsx (full worker view — §5.A)
2. components/quota-view.tsx (§5.D)
3. components/project-view.tsx (§5.C)
4. components/supervisor-health.tsx (§5.E)
5. SupervisorDashboard.tsx (wiring + tab for each new surface)
6. tests: typography token regression (§15), card-collapse regression (§16)
7. tokens/tokens.css (F4 polish only if required by 6)

## STATE LOG (evidence-based — §18: session fresh != task active)
- 2026-10-14 08:45 — M4 = **ASSIGNED_UNVERIFIED**. Evidence audit: repo clean
  vs 98050eb (git diff empty), newest supervisor-ui file mtime Oct 13 07:40
  (M3's message-feed.tsx), OpenCode procs alive but low CPU (10–20s total).
  Earlier "M4 RUNNING" claim retracted — it rested on session freshness alone.
  M4 prompt WAS delivered (clipboard paste verified by the session appearing
  81s later) but no task-specific activity followed.
- 2026-10-14 09:00 — M4 redelivered explicitly with evidence criteria (first
  increment = worker-inspector + 2 regression tests; verification = those
  files exist + tests green). Ollama restarted (was down — 11434 free).
  Model routing decision (§4): Codex CLI 0.155.1 (OWNED_PAID_ENTITLEMENT) is
  the strongest zero-incremental-cost option and is on MAT; OpenCode keeps M4
  for session continuity on the bounded first increment. Qwen 3B adequate
  only for the small self-contained increment, not the whole F4 redesign.
- 2026-10-14 09:20 — M4 = **RUNNING_VERIFIED** (task-specific evidence per §1:
  OpenCode session transcript is titled "Supervisor M4 Increment 1" and
  actively updating — the worker NAMES the task, which session freshness
  alone never proved). Delivered via headless `opencode run` (structured CLI
  channel) because cua-driver UIA is still degraded (§10 fallback ladder:
  API/CLI > file control > clipboard > mouse/keyboard). Awaiting first files.
- 2026-10-14 (this hour) — Watchdog stall detection SHIPPED (3ebda2e):
  checkpoint-age check + PROCESS_ALIVE_BUT_STALLED recovery + watchdog
  self-heartbeat, 4 regression tests, 45/45 runtime suite green.
- 2026-10-14 18:11 — **INCREMENT 1 FAILED ON QWEN-3B — model-capability
  evidence (§4/§18).** The headless run exited 0 but produced NO artifact:
  no worker-inspector.tsx in the real repo OR the opencode snapshot
  (snapshot ls-files + git status inspected). The logs show the model
  EMITTED a ```json write-tool call in its TEXT ("filePath":
  "src/components/worker-inspector.tsx") — it mimicked the tool instead of
  executing it, and the path was wrong anyway (required:
  workspace/app/src/supervisor-ui/components/). Conclusion: Qwen 2.5 Coder
  3B cannot carry even this bounded increment — it simulates tool use.
  ROUTING DECISION (§4): increment 1 REASSIGNED to Codex (CLI 0.155.1,
  OWNED_PAID_ENTITLEMENT, zero incremental cost, proven tool execution on
  MAT). Qwen-3B retained only for trivial work (docs, simple greps).
  Also learned: headless `opencode run` works in an ISOLATED SNAPSHOT
  (~/.local/share/opencode/snapshot/<projid>/<hash>) — writes there never
  reach the real repo; that channel is unsuitable for write-bearing units
  regardless of model.

## CHECKPOINT LOG (updated as evidence lands)
- 2026-10-14 ~19:55 — **INCREMENT 1 DONE (Hermes-implemented).** tsc 0 errors;
  supervisor-ui 195/195 (186 prior + 9 new: 5 typography-token §15, 4
  card-collapse §16). Landed: worker-inspector.tsx (full worker view, same
  roster fact + existing worker-detail route, NOT_EXPOSED honesty);
  typography-token.test.tsx + card-collapse.test.tsx (both caught REAL state:
  no size-valued font tokens today; .sv-card min-height WAS 0 — the M3
  card-clipping defect still live in shipped CSS); .sv-card min-height fixed
  to 140px; conference tiles now selectable (click/Enter/Space, role=button,
  focus-visible ring) opening the inspector; inspector CSS (tokens only).
  The two regression tests are load-bearing, not green-washing: they read the
  real tokens.css and failed until the CSS defect was fixed.
- Why Hermes built it: Qwen-3B mimicked a tool call instead of executing one
  (artifact-less run, snapshot-isolated); Codex quota-blocked (5h pool resets
  12:56); GUI delivery flaky under UIA degradation. The supervisor is a
  competent coding worker for a fully-specified bounded unit — §5's
  decomposition exists precisely so increments can be delivered by whatever
  worker is actually capable RIGHT NOW.
- NEXT: commit + push; visual QA of the inspector against the live API; then
  increment 2 (quota/model workforce view + project/milestone surface +
  supervisor health panel) — reassigned to OpenCode (GUI, stronger model via
  /models) or Codex when quota returns, whichever is capable.

## ACCEPTANCE CRITERIA (§14)
canonical React UI; avatar-first; worker full view; conference; messages;
project/milestone view; IDE/work view (honest deferral OK); quotas/models;
real resources; test health; supervisor health; 5-theme compat; responsive;
keyboard; ARIA; no card clipping; correct typography; no fake LIVE data;
real worker controls. Gaps remain -> M5.
