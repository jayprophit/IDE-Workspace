# OPENCODE — UI CORRECTION HANDOFF

**Source:** Hermes independent design/architecture QA of commit `8b9235d`
**Repo:** IDE-Workspace (branch `master`)
**Reviewed implementation:** `workspace/app/src/genesis-ui/` (27 files, 6,275 lines)
**Verdict:** **ACCEPTED_WITH_CORRECTIONS**

This is a genuinely strong, honest scaffold. The architecture boundaries the
owner cares about most — identity separation, renderer replaceability,
theme-token discipline, and honesty about the placeholder state — are all
correct and mostly better than specified. The corrections below are polish,
accessibility, and one reporting fix. **Do not regress what already works.**

---

## 0. What was independently verified (do not break these)

- Commit `8b9235d` exists; local == `origin/master` == `8b9235d`; tree clean; 0/0 ahead/behind.
- 27 files / 6,275 insertions — matches your report.
- Touch-set is `genesis-ui*` + `src/genesis-ui/**` + config (package.json, vite.config) only. **No existing IDE shell file was modified.**
- Tests: `npx vitest run --maxWorkers=1 --fileParallelism=false` → **142 passed (11 files)**. Breakdown: 62 genesis-ui + 80 pre-existing shell (App, GenesisTaskBar, genesisBridge, inspection, detach, state). All green.
- **No view imports a concrete renderer.** Only `avatar/AvatarStage.tsx` imports the registry *function* (`getAvatarRenderer`, `PLACEHOLDER_RENDERER_ID`). The upgrade seam holds.
- **Zero raw hex/rgb in components** (`views.tsx`, `GenesisShell.tsx`, `team/`, `components/`). Semantic-token guard holds; only `tokens.css` theme-swatch previews use raw colour (correct — they must show a different theme).
- **Identity separation is sound:** `AvatarPreset` (identity) ≠ `AvatarInstance` (preset + host-driven presence) ≠ `TeamMember` (own `id`, separate from `avatarId`/`role`) ≠ role ≠ model ≠ provider.
- **Honesty is structural, not cosmetic:** `presence` is host-supplied (defaults `idle`, never inferred from a timer); `utterance` "never synthesised to speech"; `durationLabel` is a static string; status bar shows `renderer placeholder (not live)` + `fixture data`; editor says "never fabricates file contents"; every avatar frame carries `data-live="false"`. Verified in render + tests.
- **Renderer seam (T0–T4 ready):** `registerAvatarRenderer({id, isLive, render})`; `isLiveRenderer()`; unknown-id fallback to placeholder. A live renderer registers and every view picks it up unchanged. `AvatarRendererProps` carries `preset + instance + size`, which is sufficient for T0–T2 today.
- **Agent Bridge seam (P0-A) is clean:** `GenesisShell.tsx` documents that every view is a pure function of props and swapping fixtures for a real client "touches this file" only. `fixtures.ts` centralizes all mock data. Integration will NOT require view rewrites. Confirmed.

Visual assessment (headless Chrome, 1440×900, all 5 themes):
- **HOME / CHAT / WORK: MATCHED** to the reference design language (dark navy/black, cyan accent, glassmorphic content panels, prominent glowing hero avatar, clear hierarchy). Strong.
- **TEAM: PARTIAL** (see corrections below).
- **Themes are real, not swaps:** each theme remaps the accent family (aurora→purple nav/glow/status; ember→warm; graphite→grey; frost→light) while preserving semantic status colours. Frost is a purpose-built light theme with tuned accents.

---

## 1. Reporting correction (no code change)

Your IMPLEMENTATION_NOTES §11 and the handoff state **"58 shell tests unchanged."**
The true pre-existing shell count is **80** (142 total − 62 genesis-ui). The gap is
`genesisBridge.test.ts` (22 tests), which appears not to have been counted. All 80
pass and none were modified by `8b9235d`. Fix the number in the notes so the
evidence matches reality — the substantive claim (unchanged + green) is correct.

---

## 2. Required corrections

### C1 — Worker-card selected state (TEAM / conference)  ·  priority: high
**Where:** `team/TeamViews.tsx` — `ConferenceGrid` / worker cards.
**Issue:** No worker card renders a selected/active visual treatment. §6 requires
the UI to represent "selected speaker" and "worker focus." Clicking a worker does
not visibly distinguish it, so the conference cannot show who is focused.
**Fix:** add a selected state driven by the shell's existing `workerId` state
(passed as a prop / callback already wired for the Worker detail drill-down).
Selected card gets an accent border + raised surface via existing semantic
tokens (`--accent-*`, `--shadow-*`). Do not invent new token names.
**Done when:** selecting a worker in the conference grid visibly highlights it,
and the highlight tracks the same `workerId` the Worker detail view uses.

### C2 — Conference grid orphaned final card  ·  priority: low
**Where:** `team/TeamViews.tsx` — `ConferenceGrid` layout.
**Issue:** with 7 workers the grid leaves the 7th (Echo) alone on a second row,
breaking the row rhythm. Cosmetic, but it undercuts the "one ecosystem" read.
**Fix:** either centre the final partial row, or cap the grid and overflow into
the roster strip. Your call; keep it token-driven.

### C3 — Frost theme PLACEHOLDER label contrast  ·  priority: medium (accessibility)
**Where:** `avatar/renderers.tsx` (`gx-avatar__placeholder-label`) + `tokens.css`.
**Issue:** in the light `frost` theme the "placeholder" label sits at roughly
2:1–3:1 contrast — below WCAG AA (4.5:1) for normal text. It is legible but
subtle. The honesty label must be *reliably* readable in every theme.
**Fix:** give the placeholder label a theme-aware colour that clears AA on light
backgrounds (darken in `frost`). Keep it unobtrusive but legible.

### C4 — Favicon 404  ·  priority: trivial
**Where:** `genesis-ui.html`.
**Issue:** no icon declared → browser requests `/favicon.ico` → 404 (the only
console message in a clean render). Add a tiny local favicon or a
`<link rel="icon" href="data:,">` to suppress it.

### C5 — Accessibility: conference grid keyboard/SR  ·  priority: medium
**Where:** `team/TeamViews.tsx`.
**Issue:** your own GAP_LIST §12 notes focus rings + ARIA are in place but the
roving-tabindex pass over the conference grid and live-region announcements for
presence changes are not done. For a worker grid that is focusable, this is the
real accessibility gap (not just polish).
**Fix:** roving tabindex over grid cards; `aria-live` region announcing presence
changes (respecting `prefers-reduced-motion` for any transition).

---

## 3. Explicitly NOT corrections — deferred P0 units (correct as-is)

These are the two reported P0 gaps. They are **correctly deferred**; the seams
are proven sufficient, so they are separate implementation units, not fixes to
this build. Do not attempt them in this correction pass.

- **P0-A — Agent Bridge binding.** Seam confirmed clean (props-based shell).
  Plug `fixtures.ts` → real sessions via the existing `genesisBridge.ts` client.
  Touches `GenesisShell` only. Preserve the rule: no approve/deny controls when a
  session lacks an interactive approval channel.
- **P0-B — Live avatar renderer.** Seam confirmed clean
  (`registerAvatarRenderer`, no view imports a renderer). Implement `AvatarRenderer`
  for a real medium; register it; the UI reports `isLive` accurately and
  automatically. **Do not** claim lip-sync / expression / gaze until a real
  pipeline backs it — the `isLive` flag and copy must move together.
- **Presence signal source** (GAP_LIST §3): wire `presence` to TTS-boundary / VAD
  / model-state signals. Never infer speech from a timer.

---

## 4. Render-tier readiness note (for the deferred renderer unit)

The `AvatarRendererProps` shape (`preset`, `instance`, `size`) is sufficient for
**T0** (current placeholder), **T1** (2D), and **T2** (lightweight 3D) today —
`AvatarAppearance` (hair/wardrobe/lighting/intensity) is already declarative data
a renderer consumes. For **T3/T4** (enhanced realtime / remote high-fidelity),
the `instance` will need richer animation state (expression, gaze, audio-driven
mouth) than the current `presence` + `utterance` carry. That is a **forward-compatible
extension** to `AvatarInstance` / renderer props, not a rewrite — design the seam
to accept it without touching views. Same Genesis identity survives all tiers.

---

## 5. Acceptance criteria for the correction pass

1. C1–C5 implemented; no regression in the 142 tests.
2. All 5 themes re-verified: placeholder label legible in `frost` (AA); no new console errors.
3. Selecting a conference worker visibly highlights it and tracks Worker detail.
4. `npx vitest run --maxWorkers=1 --fileParallelism=false` still 142+ passing.
5. Correct the shell-test count to 80 in IMPLEMENTATION_NOTES §11.
6. Commit + push; report the SHA and re-verify local == remote.

Fix the vitest worker-startup timeout (your GAP_LIST §15) only if you choose to —
it is confirmed environmental (reproduces on the untouched baseline; single-worker
is reliable). It does not block acceptance.
