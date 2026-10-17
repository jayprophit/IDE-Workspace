# SUPERVISOR-MERGE-M4 — UI-F4 REFERENCE-QUALITY PRODUCTION SURFACE

Author: Hermes (supervisor). Spec for: OpenCode. Baseline: `98050eb` (M3
accepted). Target: UI-F4 per §8/§27 acceptance.

## 1. CONTEXT — WHAT M3 ESTABLISHED (do not redo)

M3 landed: conference.tsx, message-feed.tsx, resource-tiles.tsx,
m3-readmodel.ts, m3.test.tsx (433 lines), tokens glow (5 themes),
mission-control test-health tile. Architecture is canonical: ONE React app,
ONE client, ONE event stream, every fact a SourceFact, NOT_EXPOSED honesty
everywhere. HARD RULE retained: NEVER port fabricated prototype data
(Math.random gauges, fake speakers, invented messages) — mechanisms only.

## 2. M4 REQUIRED SURFACES (from §5 gaps + owner directives)

### A. FULL WORKER VIEW (worker inspector — §5.A)
Selecting a worker (roster card, conference tile, message row) opens a full
inspector with every LIVE field: avatar, role, application, model, provider,
plan, quota/reset, project, task, milestone, timeline, files, git, tests,
handoffs, messages, gaps, blockers, resource usage. Fields with no backend
fact render NOT_EXPOSED — never placeholder text. Reuse the existing
worker-detail route + `fetchWorkerDetail` client call (already tested).

### B. IDE / WORK SURFACE (§5.B)
Project tree + editor surface + terminal + problems + git + agent context +
task/evidence panel. **Do NOT build a fake code editor** — if live IDE
integration is unavailable, render an honest DEFERRED_INTERFACE panel that
names exactly what is missing and what it would bind to. (monaco-editor is an
ADOPT_NOW fork decision — MAY integrate as a real editor surface bound to real
files if it can be wired honestly in one bounded unit; otherwise defer.)

### C. PROJECT / MILESTONE SURFACE (§5.C)
Per project: stage (P0–P8 per §20), milestones, requirements, tasks,
dependencies, assigned workers, tests, commits, gaps, readiness. Source: the
existing supervisor snapshot repositories + project registry facts. No
invented milestone data — surface what the backend exposes, NOT_EXPOSED for
the rest.

### D. QUOTA / MODEL WORKFORCE VIEW (§5.D)
Per worker: application, model, plan, quota pools, remaining capacity, reset
time, availability, next assignment recommendation. Codex WAITING_FOR_QUOTA +
reset is already live in the runtime — surface it per-worker, honest for free
local (quota_remaining=None).

### E. SUPERVISOR HEALTH PANEL (§5.E)
Last cycle, cycle count, workers monitored, handoffs processed, reviews, ready
tasks, assignments, missed idle events, NO_PROGRESS flags, watchdog status,
runtime/API/UI health. All from the runtime checkpoint facts.

### F. VISUAL POLISH (§5.F)
Reference-level spacing, hierarchy, avatar prominence, glass panels, Aetherius
technical aesthetic, restrained motion, information density, consistent
typography, card sizing, no clipping. Compare against the vibe-prototype
mechanisms + the NEXUS/NOVA/OE reference images in the reference manifest.

## 3. REGRESSION TESTS M3 FOUND (MANDATORY — §6/§7)

### §6 typography token audit
`--sv-font` was assigned a font SIZE token instead of a family token. Audit
the COMPLETE token stack across ALL five themes + density variants. Add a
regression test: every `--sv-font*` token resolves to a family stack (contains
a family name or a `var(--` chain ending in one), never a bare length/size.
The UI must never silently fall back to Times New Roman.

### §7 card/flex collapse regression
`.sv-card` + column flexbox + `min-height: 0` let cards collapse to ~46px.
Add a layout regression test covering: worker card, conference card, message
panel, mission-control tile, worker inspector — assert content-bearing cards
have a useful minimum (computed style or a `min-height` floor) and do not
collapse.

## 4. HONESTY CONTRACT (non-negotiable)

- Every surface reads the SAME live snapshot/stream — no new fetch paths, no
  second client, no parallel store.
- Absent backend data = NOT_EXPOSED / DEFERRED_INTERFACE, stated explicitly
  with what would bind it.
- NOT_IMPLEMENTED affordances render as chips, not clickable buttons.
- LIVE mode contains zero fabricated data. (M3's refusal to port the
  prototype's fabricated telemetry is the standard — keep it.)

## 5. ACCEPTANCE (§27 — Hermes QA, not owner QA)

- tsc 0 errors.
- Full supervisor-ui suite green (currently 186 incl. m3.test.tsx).
- Browser render verified live against 127.0.0.1:8472 — all M4 surfaces open,
  honest states visible, no console errors, no clipped cards.
- §6 + §7 regression tests added and green.
- Visual comparison vs reference matrix scored by Hermes; F4 threshold met or
  M5 generated with the specific remaining gaps.

## 6. BOUNDS

- M4 only — do not start M5/F5 design-system extraction inside M4.
- Do not touch the backend runtime in this unit (backend gaps are separately
  assigned: resource telemetry, test-health, Genesis flake — supervisor queue).
- Commit message: "supervisor-ui: M4 ..." with the honest live/deferred table
  in the handoff.
