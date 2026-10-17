# SUPERVISOR-MERGE-M3 — HANDOFF (conference + messaging + richer mission control)

Author: OpenCode. Spec: `docs/handoffs/supervisor-merge-m3.md`. Baseline: `01a7343`
(M2 canonical merge).

Scope respected: M3 only. **M4 was not started.**

---

## 1. WHAT LANDED

### ConferenceView (§12) — `components/conference.tsx`
Gallery of conference tiles over the SAME supervision `workers` fact that
`roster.tsx` and `team-room.tsx` already read. One roster, one request, four
views. Tiles carry a large deterministic avatar, role badge, status and current
task. Filters are project/status, derived from the roster itself so no option
can name a worker that does not exist.

### MessageFeed (§14) — `components/message-feed.tsx`
Reads `useSupervisor().events` — the same in-memory array the Events tab uses.
**No new fetch, no second stream, no second connection.** Each row: humanised
type, worker, timestamp, payload summary. Nested payloads are described by shape
(`detail={3}`) rather than dumped as escaped JSON.

### Richer MissionControl (§6/§10) — `components/resource-tiles.tsx`
- `ResourceMeters` — CPU / RAM / GPU / VRAM from `resources.sample`.
- `GitHealthPanel` — per-repo head/branch/ahead/behind/dirty from `repositories`.
- `TestHealthTile` — added to the MissionControl grid.

### F4 polish (§7/§18) — `tokens/tokens.css`
Glass tiles with a luminous edge, an orbit ring and a `pulse-glow` keyframe on
the conference avatar, plus `sv-grad-text` section titles. **Every colour comes
from `--glow-accent*`, a per-theme RGB triple** — the prototype's hard-coded
cyan is not reproduced. All five themes re-grade the glow.

---

## 2. LIVE vs DEFERRED_INTERFACE

### LIVE (real backend data, verified in-browser against 127.0.0.1:8472)
| Surface | Source | Observed |
|---|---|---|
| Conference tiles | `supervision.workers` | 3 tiles: codex-primary, ollama-local, opencode-primary |
| Tile identity | `worker_id` / `role` / `status` / `task_description` | rendered verbatim |
| Filters | roster-derived project/status | "3 of 3 in room" |
| Message feed | `useSupervisor().events` | live stream, **0 events** (stream silent) |
| Git health | `repositories[label]` | agent-bridge main/a6e28640/0, dashboard unit/external-worker-telemetry/778b5852/2 |
| Test health | *scanned for* | none exists → DEFERRED |

### DEFERRED_INTERFACE (rendered honestly, never faked)
| Capability | Treatment | Why |
|---|---|---|
| **Voice / video** | dashed `NOT_IMPLEMENTED` **chips** (not buttons) | no media backend exists |
| **Active speaker** | "No worker is speaking… API exposes no speaking indicator" | no `speaking` field anywhere in the roster |
| **CPU / RAM / GPU / VRAM** | all four `NOT_EXPOSED`, dashed empty tracks | `resources.sample` is `value: null` on this deployment |
| **Test health** | `DEFERRED_BACKEND_INTERFACE` tile | no `test`/`ci`/`build`/`lint` key exists in any section |
| **Message composer** | absent entirely | the API is read-only + §17.J/§18; it exposes no way to post |
| **Sparkline** | deliberately omitted | no real time-series exists; a history buffer would have to be synthesised |

---

## 3. WHAT WAS DELIBERATELY NOT PORTED FROM THE VIBE-PROTOTYPE

The prototype's conference and gauges were almost entirely fabricated. Porting
its *mechanisms* was the task; porting its *data* would have defeated the unit.

- `Math.random()` telemetry on a 1.8s interval (CPU 8–65%, mem 220–780MB), and
  the 15-sample sparkline history seeded from an invented array.
- Five fake processes with invented PIDs 1024–1204; `"RSS: 396 MB"` static
  string; `"4 Cores"`; no-op `handleGC` / `handleClearCache`.
- `agent.speaking: true` — a hardcoded boolean on one of eight mock agents. No
  audio, no WebRTC, no backend field.
- The four-message inter-agent transcript, the conversation queue, and
  `"12/12 Autonomous Agents Active"` (which contradicted its own 8-agent roster).
- `mentionsList` (invented agents/files), hardcoded `"JD"` initials,
  `"Autonomous Planner"` role, `'task-manager'` env fallback.
- Unsplash stock portraits standing in for AI agents — the deterministic hue
  avatar already covers identity without a network fetch.

What *was* taken: the responsive tile grid, the tile anatomy (role badge /
avatar / identity footer), the scrim-under-text pattern, the orbit + pulse-glow
keyframes, and the track-and-fill gauge skeleton — with real thresholds and an
honest NOT_EXPOSED state per axis.

---

## 4. TWO BUGS FOUND IN EXISTING (PRE-M3) CODE

Both were pre-existing from the M2 merge, found by looking at the render rather
than trusting the tests. Both are fixed here because the M3 surfaces exposed
them.

**(a) The whole dashboard was rendering in Times New Roman.**
`[data-supervisor-density]` blocks declared `--sv-font: var(--sv-text-base)` —
a *size*. But `--sv-font` is the **font-family** token declared in `:root`.
So `.sv-root { font-family: var(--sv-font) }` resolved to `12px`, which is an
invalid `font-family`, and the whole UI silently fell back to the browser
default serif. No test caught it because no test asserted a typeface.
Fix: density now sets `--sv-font-size`; `--sv-font` has exactly one definition.

**(b) M3 cards were clipped inside the scroll view.**
`.sv-card` sets `min-height: 0`, and the scroll view is a column flexbox, so a
card is a flex item that gets compressed toward its min-height — the gauge
tracks collapsed to an invisible 46px card. Fix: `flex-shrink: 0` on the M3
cards.

---

## 5. FOUR BUGS MY OWN TESTS CAUGHT

Recorded because each would have shipped a lie:

1. **`worstOf`/`combineStates` were pinned at `NOT_EXPOSED`.** Both seeded the
   fold with a worst-state sentinel, so the result could never improve — a
   perfectly healthy fleet would have rendered as not-exposed. The seed is now
   the fold identity; the empty case still returns `NOT_EXPOSED` (no
   observations is not a healthy result).
2. **`readGitHealth` had the same seeding bug**, so a git panel could never read
   as clean.
3. **`findTestFact` missed section-named test sources.** It only scanned field
   keys inside each section, so `ci: {health: fact}` was invisible — `ci` is the
   *section* name. Now checks both.
4. **`readableTime` used `toLocaleTimeString`**, which pulled ICU into a
   15s-timeout test run. Now `toISOString().slice(11,19)`, with the source
   timestamp in the tooltip so the UTC choice is visible.

Also fixed: a `title={String(event.…)}` reference to an out-of-scope variable in
the message row (crashed the feed), and two of my own test premises that were
wrong rather than the code — a filter chip derived from the roster always
matches at least one worker, so a genuine zero needs two *individually valid*
options to be mutually exclusive.

---

## 6. VERIFICATION

```
npx tsc --noEmit                                  → 0 errors
npx vitest run src/supervisor-ui                  → 186 passed / 7 files
    (147 pre-existing, all still green + 39 new)
npx vitest run src/genesis-ui                     → 175 passed (frozen, untouched)
npx vitest run (full)                             → 441 passed / 25 files
```

**Hard constraints**
- `fetch(` appears only in `api/client.ts` (bounds test asserts this).
- No raw hex in any component; none in the component half of `tokens.css`.
- `client.ts` contains no literal `30`; **client.ts was not modified at all**.
- `genesis-ui/` has zero changes (`git status` clean for that path).
- Live render at `http://127.0.0.1:5199/supervisor-ui.html`: Conference and
  Messages reachable from nav, 0 console errors, 0 failed requests.

---

## 7. NOTE FOR HERMES

Two environment issues encountered, both workarounds rather than code changes:

1. `npx tsc` / `npx vitest` intermittently hang the shell rather than exiting.
   Running via `Start-Job` + `node node_modules\typescript\bin\tsc` is reliable.
2. `--pool=threads` is needed; the default `forks` pool intermittently fails to
   start workers on this host ("Failed to start forks worker").
3. A full-suite run flaked one genesis-ui timing test
   (`shows a static placeholder duration`). It passes in isolation and on a
   clean genesis-ui run (175/175) and is unrelated to M3 — no genesis-ui file
   is modified. Flagging rather than hiding it.