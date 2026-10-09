# Genesis UI Scaffold — Implementation Notes

Location: `workspace/app/src/genesis-ui/`
Repo: **IDE-Workspace** (branch `master`)
Status: scaffold complete, avatar renderer is a **placeholder**

---

## 1. What this is

An avatar-first UI scaffold for the Genesis / Aetherius interface: a design
token system, five themes, four layout densities, an avatar framework with a
pluggable renderer, seven views, and the team/conference surfaces.

It runs standalone at `/genesis-ui.html` alongside the existing IDE shell at `/`.

## 2. What this is NOT

Stated plainly because the reference images imply far more than is here:

| Not implemented | Status |
|---|---|
| Animated / live avatar | **No.** Placeholder renderer, `isLive: false` |
| Lip sync | **No.** No audio pipeline exists |
| Voice / microphone | **No.** Call controls are local UI state |
| Video stream / camera | **No.** Not opened |
| 3D embodiment | **No.** Flat SVG |
| Realistic portrait art | **No.** Initials over a gradient |
| Backend / model connection | **No.** Fixture data only |
| Bundled webfont | **No.** System stacks only |

Everything above is surfaced in the UI itself, not only here. See §7.

## 3. File structure

```
workspace/app/
├── genesis-ui.html                 standalone entry (new)
├── vite.config.ts                 two entry points (modified)
└── src/genesis-ui/
    ├── index.ts                   public exports
    ├── main.tsx                   standalone mount
    ├── types.ts                   domain contracts
    ├── registry.ts                themes / layout / views + validation
    ├── avatars.ts                 preset catalogue, accents, filters
    ├── fixtures.ts                sample data (labelled IS_FIXTURE)
    ├── GenesisShell.tsx           app shell: state, persistence, composition
    ├── views.tsx                  Home, Chat, Work, Worker, Calls, Settings
    ├── avatar/
    │   ├── renderers.tsx          renderer contract + registry  ← upgrade seam
    │   ├── AvatarStage.tsx        AvatarStage, AvatarChip
    │   ├── AvatarPicker.tsx       AvatarPicker, SpecialistCard
    │   ├── avatar.test.ts         catalogue + renderer seam
    │   └── avatar-stage.test.tsx  size steps, presence
    ├── team/TeamViews.tsx         strip, grid, queue, summon, controls
    ├── components/ui.tsx          Panel, Badge, Button, Switch, Tabs…
    └── tokens/
        ├── tokens.css             primitives, semantics, themes, density
        ├── components.css         component layer
        └── tokens.test.ts         cross-theme contract tests
```

`@types/node` was added as a devDependency: the token contract tests read the
CSS with `node:fs`.

## 4. Design token system

Three layers, strict cascade order.

**1. Primitives** — raw scales, no meaning: colour ramps (`--p-blue-500` …),
spacing on a 4px grid (`--space-1` … `--space-32`), radii, border widths,
type scale, weights, leading, tracking, durations, easings, z-index ladder,
avatar geometry.

**2. Semantic** — role names: `--surface-*`, `--glass-*`, `--text-*`,
`--border-*`, `--accent-*`, `--state-*`, `--shadow-*`, `--focus-ring`,
`--canvas-glow`. Components reference **only** this layer.

**3. Themes and density** — remap semantics. Never invent a token name.

The rule that keeps one layout correct under all five themes: a component
never reaches past the semantic layer. This is enforced by test — component
CSS is asserted to contain no raw hex or `rgb()` outside the theme-swatch
previews (which must show a *different* theme than the active one, so they
cannot read semantic tokens).

## 5. Theme system

| id | Label | Character |
|---|---|---|
| `abyss` | Abyss | **Default.** Dark blue, frosted glass over near-black |
| `aurora` | Aurora | Purple / violet, higher saturation |
| `ember` | Ember | Amber / warm, low-glare dark |
| `graphite` | Graphite | Neutral grey, colour reserved for state only |
| `frost` | Frost | Light, frosted glass, high legibility |

Applied via `data-genesis-theme` on the root element. Exactly one theme is
light (`frost`), which keeps dark-mode assumptions testable. Frost darkens its
state colours, because the 400-step values used by the dark themes do not clear
contrast on white.

## 6. Layout modes

| id | Font | Rail | Header | Character |
|---|---|---|---|---|
| `simple` | 15px | 76px | 56px | Touch-friendly, fewest controls |
| `standard` | 13px | 64px | 48px | Default, VS Code-class density |
| `dense` | 11px | 52px | 42px | Power user, maximum information |
| `focus` | 13px | — | — | One worker full screen, **all chrome removed** |

`focus` is not a density step — it renders a different tree. Verified in a
browser: no rail, no header, no status bar.

Theme and density are **independently reversible** (tested both directions).

## 7. Avatar framework — the upgrade seam

This is the part that matters most for later work.

```
AvatarPreset        declarative identity (presentation, hair, wardrobe, lighting)
  ↓
AvatarInstance      preset + mutable presence + optional utterance
  ↓
AvatarRenderer      interface { id, isLive, render(props) }
  ↓
renderers.tsx       registry: registerAvatarRenderer(), getAvatarRenderer()
```

**No view imports a renderer.** A live implementation registers under its own
id and every view picks it up unchanged. Tested: registering a renderer leaves
the preset catalogue untouched.

`isLive` is read by the UI rather than assumed, so no view can advertise
animation that does not exist. Every frame carries `data-live="false"`, and a
test asserts all of them are false.

### Presets

5 main (2 female, 2 male, 1 neutral) + 10 specialists (mixed presentation).
Female, male and neutral are one equal filter row — no default-sex assumption
anywhere. Selection is caller-supplied.

Presentation is expressed through descriptive fields and an accent pair, never
by splitting the catalogue into separate designs. That is what keeps a
mixed-gender roster reading as one ecosystem.

### Placeholder renderer

Initials over an accent gradient inside a vignette. Deliberately abstract: a
drawn facial feature would read as an attempt at a likeness the scaffold cannot
deliver.

The `placeholder` label shows only at `xl`/`2xl`/`3xl`. At chip/sm/md/lg the
circle is too small for it to sit under the initials without colliding, and
surrounding surfaces already carry the status. (This was caught in browser
verification — the first pass had it overlapping at every size.)

## 8. Views

| View | Notes |
|---|---|
| Home | Avatar hero, launch actions, team, activity, appearance |
| Chat | Avatar stage column + thread + composer |
| Work / IDE | Explorer, editor, dock, assistant panel |
| Team | Conference grid, queue, activity, controls, summon |
| Worker detail | Large stage + detail + peers |
| Calls | Stage + dial + history |
| Settings | Theme, density, avatar, team defaults, about |

Team: `TeamStrip` (persistent), `ConferenceGrid`, `ConversationQueue`,
`SummonPanel`, `TeamControls` (silent / observe / auto-queue / raise-hand).

## 9. Truthfulness rules (the repo's existing convention, extended)

The existing shell already required *"honest empty states, never fabricated"*.
That rule is enforced here too:

- No task → **"No current task"**, never an invented one
- No file open → explicit empty state, **never** fabricated file contents
- No active call → **"No active call"**, not a fake timer
- Unwired dock tab → **"`<tab>` not wired up"**
- Empty team → **"No team loaded"**, no placeholder participant
- Silent mode → says it is on, and genuinely hides avatars
- Chat send echoes locally and **invents no agent reply**
- Status bar shows `renderer placeholder (not live)` and `fixture data` at all
  times

## 10. Predecessor audit — `references/vibe-prototype` (aetherius-ide)

### Migrated (concept / approach)

| From | Decision |
|---|---|
| 13px base, VS Code density | Adopted for `standard` mode |
| Avatar as primary element, not a widget | Adopted throughout |
| Frosted glass panels over canvas | Adopted as default `abyss` reading |
| Blue→cyan gradient brand mark | Adopted as `--accent-gradient` |
| Collapsible/neutral theme list | Replaced by the 5-theme registry |
| Circular avatar with presence ring | Adopted as `AvatarStage` chrome |
| Rail + panel + content composition | Adopted for the shell layout |
| Honest empty states | Adopted and extended (§9) |

### Rejected (with reasons)

| From | Reason |
|---|---|
| **Tailwind utility classes** | Project uses hand-written CSS with tokens. Mixing both would produce two competing token systems. |
| **Unsplash remote portraits** | Hotlinked external URLs; non-deterministic; breaks offline. Presets are local descriptions instead. |
| **CSS-drawn cyber-art "hologram" overlay** | Implied a rendered face that does not exist. Replaced with abstract placeholder. |
| **Simulated presence animation** | `animate-pulse-glow` implied live behaviour. Presence is now host-driven data with `isLive: false`. |
| **`motion` / `@google/genai` deps** | Not needed for a scaffold. The avatar seam means a live renderer can arrive without this layer depending on an animation library. |
| **Monolithic 30–50k single-file views** | Scaffold splits by concern. |
| **Hardcoded model catalogue (`models.ts`)** | Provider-specific; belongs to a model hub, not the UI scaffold. |
| **`ThemeType` = 7 overlapping light variants** | `dark`, `dark-light`, `light`, `white` are four names for two intents. Replaced by 5 themes with explicit `scheme`. |
| **Usage/plan pricing widgets** | Product decisions not established. |

### Also inspected, not migrated

`references/omniagent-runtime-&-workspace` — a newer, larger prototype. It has
more views but the same architecture (monolithic view files, remote portraits).
Its surface list informed the view roster only.

## 11. Verification

| Check | Result |
|---|---|
| `tsc --noEmit` | clean |
| `npm test` (existing shell) | **58 passed**, unchanged |
| `npm test` (genesis-ui) | **62 passed** |
| `vite build` | clean, two entries |
| Browser: all 7 views | render, no uncaught errors |
| Browser: 5 themes | 5 distinct canvases, correct `color-scheme` |
| Browser: 4 densities | distinct font sizes + rail widths |
| Browser: all tokens resolve | no `UNRESOLVED` |
| Browser: focus mode | chrome fully removed |
| Browser: silent mode | avatars 1 → 0 |

Only console message is a favicon 404. `pageErrors`: none.

### Pre-existing issue (not caused by this work)

`npm test` on this machine can fail with
`[vitest-pool-runner]: Timeout waiting for worker to respond` under default
parallelism. Single-worker mode passes. It reproduces on the untouched
baseline and is a worker-startup timeout, not a test failure.

## 12. Verification commands

```powershell
cd workspace/app
npx tsc --noEmit
npx vitest run --maxWorkers=1 --fileParallelism=false
npx vite build
npm run dev        # then open /genesis-ui.html
```

## 13. Next steps

See `GAP_LIST.md` for the ordered backlog. The two that unblock everything else:

1. **Agent Bridge binding** — replace `fixtures.ts` with real sessions. Every
   view already takes its data as props, so this touches the shell only.
2. **Live avatar renderer** — implement `AvatarRenderer`, register it. No view
   changes.