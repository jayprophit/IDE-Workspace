# GENESIS UI CORRECTION — INDEPENDENT ACCEPTANCE QA

**Reviewer:** Hermes (independent design/architecture acceptance QA)
**Baseline reviewed SHA:** `8b9235d`
**OpenCode correction SHA:** `af2af48`
**Date:** 2026-10-09
**Method:** independent verification — no claim taken on OpenCode's report alone.

---

## A. Final SHA verification

| Field | Value |
|---|---|
| Local HEAD | `af2af48d0bed7aa1ac71d1b48298fd70586eb661` |
| `origin/master` | `af2af48d0bed7aa1ac71d1b48298fd70586eb661` |
| Ahead/behind | **0 / 0** |
| Changed files | **17**, +1,424 / −42 |
| Touch-set | all under `genesis-ui*` + `genesis-ui.html` + genesis-ui docs — **existing IDE shell untouched** |

## B. Actual git/worktree status — contradiction resolved

OpenCode reported "working tree clean" **and** "docs/handoffs/ left untracked." These are
both true and not contradictory:

- **All 17 tracked changes are committed.** No modified/staged tracked files remain — clean
  w.r.t. tracked content.
- **`docs/handoffs/` is genuinely UNTRACKED and NOT gitignored** (proven: `git check-ignore`
  returns nothing; `git ls-files docs/handoffs/` is empty). It contains
  `docs/handoffs/avatar-ui/OPENCODE_UI_CORRECTION_HANDOFF.md` — **Hermes-owned supervisor
  material** written by this reviewer in the prior QA pass.

**Ownership ruling:** `docs/handoffs/` belongs to Hermes (the supervisor), not OpenCode.
OpenCode was **correct not to commit it** — committing another agent's handoff material
would corrupt provenance. It is intentionally left untracked as Hermes-owned evidence. The
tree is "clean" only in the tracked-file sense; the accurate statement is: *tracked tree
clean at `af2af48`; one Hermes-owned untracked handoff directory present by design.* Not
deleted, not absorbed, not ignored.

## C. Test counts (independently run, reliable single-worker config)

`npx vitest run --maxWorkers=1 --fileParallelism=false`

| Suite | Count |
|---|---|
| **Total** | **204 passed, 0 failed** |
| Pre-existing shell (App, GenesisTaskBar, genesisBridge, inspection, detach, state) | **80, unchanged** |
| Genesis UI | **124** (was 62 — doubled, per C1–C5 + render-regression coverage) |

New correction tests inspected and confirmed **behavioral, not snapshots**:
- `contrast.test.ts` — computes WCAG ratios from token values, composites the scrim,
  asserts the *old* frost value genuinely failed (non-vacuous).
- `grid-layout.test.ts` — guards against reintroducing count-specific `repeat(N,…)` /
  `nth-child` hacks; asserts token-driven sizing + avatar clamp.
- `conference-a11y.test.ts` — roving tabindex, arrow/Home/End, Tab-not-trapped, roster
  shrink, presence announcements silent on unchanged rosters, no timers.
- `conference.test.tsx` — selection never fabricated, exactly-one, semantic state,
  identity preserved, drill-down separate, survives transitions.

## D. C1 — Selection: **PASS**
Verified in tests + live render: click selects (exactly one, `data-selected="true"`,
`aria-selected` + `aria-current` + visible "Selected" label); deselect-previous; identity
unchanged; **worker detail is a separate explicit action** ("Open worker detail"); selection
survives conference↔detail↔focus-mode; team strip and conference agree. Selected and
speaking states **coexist** (Atlas shows both "Selected" and "Speaking" pills) — verified
live.

## E. C2 — Team grid: **PASS** (one deferred polish note)
Live-rendered at 1–7 workers and viewports 1440/900/720: flex-wrap + centred lines, no
orphan (7th card centres, not stranded), no overlap, **zero avatar spills**, no horizontal
overflow at 720px. Final-row treatment is structural (centred), not count-specific.
**Deferred note (not a C1–C5 correction):** at 720px the three *secondary* panels (Speaking
Queue / Recent Activity / Session Controls) are cramped — this is the pre-existing
responsive-density gap (GAP_LIST §13), outside the correction scope, non-blocking for the
foundation baseline.

## F. C3 — Frost contrast: **PASS**
New `--text-on-scrim` semantic token; frost placeholder label now **~6.4:1** (was 2.14:1),
all five themes clear AA via computed contrast; no raw-hex component workaround introduced
(component CSS still token-only). Verified by the contrast test's own math.

## G. C4 — Favicon/network: **PASS**
Inline `data:,` favicon; live render shows **zero failed/4xx requests** — the 404 is gone,
no new network errors.

## H. C5 — Accessibility: **PASS** (UI support; runtime presence remains deferred)
Roving tabindex (exactly one tabbable), arrow-key movement, Home/End, Enter/Space action,
focus visible, **Tab not trapped** (leaves the grid), roster changes handled (index clamps),
restrained `aria-live` (announces host-reported join/leave only, silent on routine status
ticks, capped at 5 on bulk change, **never timer-derived**). This is UI accessibility
support; **live runtime presence signals remain deferred** (correctly).

## I. Render-only regressions: **PASS**
- A. selected + active-speaker coexist — verified live (Atlas: "Selected" + "Speaking").
- B. avatar no longer spills outside its card at narrow layouts — verified live
  (`avatarSpills: 0` at 720px). Both have regression test coverage (grid-layout.test.ts,
  conference.test.tsx).

## J. Visual comparison: **TEAM/CONFERENCE moved PARTIAL → MATCHED**
Live-rendered all views × 5 themes. HOME/CHAT/WORK **did not regress** (HOME re-confirmed
UNCHANGED_GOOD). TEAM now shows selected-worker highlight, coexisting states, balanced grid,
per-worker status rings — a polished team presentation. **Not** merely
ACCEPTED_WITH_MINOR_GAPS for the team view itself.

## K. Architecture/seam: **PASS**
No view imports a concrete renderer (only `AvatarStage` imports the registry *function*).
`registerAvatarRenderer` seam intact; `isLive:false` placeholder unchanged. 15 presets,
2F/2M/1N main, roster intact. Worker identity ≠ avatar ≠ role ≠ model ≠ provider (types +
tests). Avatar selection does not change Genesis identity.

## L. Honesty: **PASS**
Live render: `data-live="false"` × 16, `data-live="true"` × 0; placeholder + fixture-data
labels present. No fake voice/lipsync/3D, no fake call timers, no fabricated team
execution, no fake Agent Bridge connectivity, no timer-derived presence.

## M. Remaining accessibility gaps
Full screen-reader review beyond the implemented conference-grid support (roving tabindex +
presence live-region) remains deferred — consistent with the original deferral list.

## N. Deferred items (correctly still deferred)
Agent Bridge live binding · real avatar renderer · real runtime presence feed · T1–T4
embodiment · voice · lip-sync · expression/gesture/gaze · cloud avatar rendering · full
screen-reader review beyond conference support · narrow-viewport secondary-panel density.

---

## O. Final classification

# **ACCEPTED**

All five correction classes (C1–C5) independently verified as behavioural, tested, and
live-rendered. Both render-only regressions fixed with coverage. Honesty, renderer seam,
identity separation, and avatar presets all intact and unregressed. Tests 204/204, shell
80 unchanged, no console/network errors.

**`af2af48` is declared the canonical `GENESIS AVATAR-FIRST UI FOUNDATION` baseline.**

The UI progression continues as separate bounded units (not this pass):
real Agent Bridge/state binding → real avatar renderer → T0→T1→T2→T3→T4 embodiment.

**Provenance note:** subagent/worker findings are independently validated before promotion
to fact. This pass independently re-ran every claim; the one prior false positive
(`comms/fabric.py` "syntax error" in the Agent-Bridge audit) was disproven at byte level and
recorded as DISPROVED — the same discipline applies here.
