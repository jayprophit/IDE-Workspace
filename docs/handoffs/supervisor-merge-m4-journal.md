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

## CHECKPOINT LOG (updated as evidence lands)
(none yet — awaiting first M4 file)

## ACCEPTANCE CRITERIA (§14)
canonical React UI; avatar-first; worker full view; conference; messages;
project/milestone view; IDE/work view (honest deferral OK); quotas/models;
real resources; test health; supervisor health; 5-theme compat; responsive;
keyboard; ARIA; no card clipping; correct typography; no fake LIVE data;
real worker controls. Gaps remain -> M5.
