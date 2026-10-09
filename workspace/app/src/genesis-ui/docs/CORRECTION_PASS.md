# Correction pass — C1–C5

**Baseline reviewed:** `8b9235d`
**Repo:** IDE-Workspace (`master`)
**Touch-set:** `workspace/app/src/genesis-ui/**` + `genesis-ui.html` only

Correction pass, not a rebuild. The token system, theme set, renderer seam,
layout architecture and honest empty states were independently verified and are
unchanged except where a correction required it.

---

## C1 — selected worker state · VERIFIED

### What was wrong

No conference tile carried a selected state. Clicking a tile navigated
straight to worker detail, so the grid could never show who was focused.

### Two state values were doing one job

The shell held both `workerId` (detail drill-down) and `activeMemberId`
(team-strip highlight). Nothing kept them in step, so the strip could
highlight one worker while the detail view showed another — exactly the
mismatch the correction names. Rather than add a third flag, `activeMemberId`
was **removed** and `workerId` became the single selection for the whole shell.
The team strip, conference grid and worker-focus surface all read it.

### Selection is a separate act from navigation

A tile click now selects and stays put. Navigating on click would hide the
highlight the instant it was made, and drill-down would be the only observable
effect. The explicit **"Open worker detail"** action appears once a worker is
selected.

### Distinguishable by more than colour

Four cues, ordered by how they survive greyscale:

1. a **"Selected"** text badge in the tile body
2. a solid accent ring (`aria-selected="true"`, `aria-current="true"`)
3. a raised surface
4. a corner marker dot

Selection **layers on top of** the speaking treatment rather than replacing it:
a selected speaker gets an accent ring outside the green speaking ring, so
both true facts stay visible. The first implementation had selection winning
the cascade and erasing the speaking ring — caught in the render pass.

Nothing auto-selects. `selectedCount` is 0 until the user acts.

---

## C2 — conference grid rhythm · VERIFIED

### What was wrong

At 1440px the 7-card roster resolved to 6 columns, stranding Echo alone at the
far left of a second row.

### Fix is structural, not counted

`grid-template-columns: repeat(auto-fit, minmax(..., 1fr))` always fills the
available width, so a partial row is always left-hanging; `justify-content`
cannot fix that on a grid. Switched to **flexbox wrap**, where each wrapped
*line* is centred independently:

```css
.gx-conference { display: flex; flex-wrap: wrap; justify-content: center; }
.gx-tile      { flex: 1 1 var(--conference-tile-min);
                max-width: calc(var(--conference-tile-min) * 1.5); }
```

`max-width` stops a one-card row becoming a full-bleed banner. The minimum is
the `--conference-tile-min` density token (240 / 200 / 168px per mode).

No rule is conditioned on a member count. `grid-layout.test.ts` asserts no
`repeat(N, …)` or `nth-child` positioning exists in the conference rules, so
the count-specific "fix" cannot come back.

### Measured (7 cards, real browser)

| viewport | rows | per row | last row centred | avatar spill | doc overflow |
|---|---|---|---|---|---|
| 1920 | 1 | 7 | yes | 0 | no |
| 1600 | 2 | 6 + 1 | yes (593px both sides) | 0 | no |
| 1440 | 2 | 5 + 2 | yes (359px both sides) | 0 | no |
| 1280 | 2 | 4 + 3 | yes (125px both sides) | 0 | no |
| 1100 | 2 | 4 + 3 | yes | 0 | no |
| 960 | 3 | 3 + 3 + 1 | yes (273px both sides) | 0 | no |
| 720 | 4 | 2 + 2 + 2 + 1 | yes (185px both sides) | 0 | no |

Structural rosters of 1–12 are asserted in tests: one tile each, no padding, no
truncation, exactly one tabbable tile at every size.

### Extra defect found while rendering

At narrow columns the fixed-size avatar spilled out of its card and overlapped
neighbours. Clamped inside the tile with `max-width` + `aspect-ratio`, which
keeps the circle round. Verified 0 spills at every viewport.

---

## C3 — Frost placeholder contrast · VERIFIED

### What was wrong

The label inherited `--text-muted`, tuned for the page canvas. It renders on a
translucent scrim over the avatar interior, and in frost that composite put it
at **2.14:1** — passing a visual review, failing AA.

### Fix is a new semantic token, not a component override

Added `--text-on-scrim` to all five themes. No raw colour was added to
component CSS, so the semantic-token guard stays green.

### Measured in the rendered page (compositing the real background chain)

| theme | was | now | AA |
|---|---|---|---|
| abyss | — | 9.80:1 | pass |
| aurora | — | 9.62:1 | pass |
| ember | — | 11.06:1 | pass |
| graphite | — | 8.77:1 | pass |
| **frost** | **2.14:1** | **6.41:1** | pass |

`tokens/contrast.test.ts` computes WCAG ratios itself (with sanity checks on
the maths) and asserts the label clears 4.5:1 in every theme — and asserts the
*old* frost value still fails, so the test cannot pass vacuously on an easy
background. Body text is checked in all five themes too.

---

## C4 — favicon 404 · VERIFIED

`<link rel="icon" href="data:," />` in `genesis-ui.html`. A declaration, not a
placeholder icon nobody asked for.

Verified: `failedRequests: []` across a full sweep of 5 themes × 5 views plus
focus mode. Previously one 404 per load.

---

## C5 — conference keyboard and live presence · VERIFIED

### Roving tabindex

`team/useConferenceA11y.ts`. Measured in the browser with 7 tiles:

- 1 tile at `tabindex="0"`, 6 at `tabindex="-1"`
- ArrowRight → tile 2; End → tile 7; Home → tile 1
- **Tab is not handled**, so focus leaves the grid rather than being trapped
- the index is clamped when the roster shrinks, so the grid can never fall
  entirely out of the tab order

Grid is a labelled `role="listbox"`; tiles are `role="option"`.

### Presence announcements, deliberately quiet

`aria-live="polite"`, `aria-atomic="false"`. Announcements are derived by
**diffing the host-supplied roster between renders**:

- silent on first render (a baseline pass, not a roster read-out)
- silent when nothing changed
- announces joins, unavailability, and departures
- **silent on routine transitions** (speaking → reviewing → idle): those are
  already conveyed by each tile's own status dot and label, and re-announcing
  every tick would flood a screen reader
- bounded to the newest 5

No timer is involved anywhere. Tests assert an unchanged roster produces zero
announcements.

---

## Reporting correction · VERIFIED

The original notes claimed **58** pre-existing shell tests. That was wrong.

Per-file, verified via a JSON reporter run:

| shell test file | tests |
|---|---|
| App.test.tsx | 22 |
| GenesisTaskBar.test.tsx | 10 |
| genesisBridge.test.ts | **22** |
| inspection.test.ts | 6 |
| detach.test.ts | 4 |
| state.test.ts | 16 |
| **shell total** | **80** |

**Why it was wrong:** the baseline `npm test` run hit a vitest
worker-startup failure on `genesisBridge.test.ts`, so its 22 tests never ran.
Five files reported 58 passing and a partial run was reported as a complete
one. Corrected to 80. **No pre-existing test was modified to reach the number.**

---

## Test results

| suite | before | after |
|---|---|---|
| pre-existing shell | 80 | **80** (unchanged) |
| genesis-ui | 62 | **124** |
| **total** | 142 | **204**, 15 files |

New coverage: `conference.test.tsx` (30), `conference-a11y.test.ts` (18),
`tokens/contrast.test.ts` (7), `grid-layout.test.ts` (6). Plus additions to
`tokens.test.ts` (13 → 14) and `GenesisShell.test.tsx` (unchanged count).

`tsc --noEmit` clean · `vite build` clean, two entries.

---

## Visual QA

Rendered in headless Chromium (`puppeteer-core` against the local Playwright
Chromium build), 1440×900 plus the viewport sweep.

- 5 themes × 5 views + focus mode, all screenshotted and inspected
- selected state verified in all 5 themes
- focus mode still chrome-free: rail 0, header 0, status bar 0
- `data-live` still `false` on every avatar frame in every theme and view
- **0 console errors, 0 failed requests**
- 0 horizontal overflow at 1920 / 1440 / 1100 / 820 / 720 across all views
- 0 clipped controls at every width

---

## Preserved, not regressed

- 5 themes: abyss, aurora, ember, graphite, frost
- 4 densities: simple 15px, standard 13px, dense 11px, focus
- `registerAvatarRenderer({ id, isLive, render })` unchanged; unknown-id
  fallback intact; **no view imports a concrete renderer**
- `isLive: false` everywhere; status bar still reads
  `renderer placeholder (not live)` and `fixture data`
- 15 presets: 2 female, 2 male, 1 neutral main + mixed-gender specialists
- `AvatarPreset ≠ AvatarInstance ≠ TeamMember ≠ Role ≠ Model ≠ Provider`
- Genesis identity independent of avatar appearance
- honest empty states: queue, activity, editor, calls, team, docks
- no fabricated timer; nested-file selection bug still fixed

`AvatarInstance` was **not** modified, so no renderer-specific fields were
encoded and T0–T4 forward compatibility is unaffected.

## Deferred, as instructed

- P0-A Agent Bridge live binding — seam preserved, untouched
- P0-B live avatar renderer — seam preserved, untouched
- presence signal source (TTS/VAD/model state)
- T1–T4 embodiment, lip sync, voice, gaze, gesture, cloud rendering
- screen-reader coverage beyond the conference grid (file explorer, dock tabs,
  queue rows)

## Pre-existing, unchanged

`npm test` under default parallelism can fail on this machine with
`[vitest-pool-runner]: Timeout waiting for worker to respond`. It reproduces on
the untouched baseline. Single-worker mode is reliable and is what all
acceptance evidence above was gathered with.