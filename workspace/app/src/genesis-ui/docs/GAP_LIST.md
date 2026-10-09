# Gap list — later animation / live avatar work

Ordered by what unblocks the most. Each item names the seam it plugs into, so
none of this requires reworking the scaffold.

---

## P0 — blocks honest live behaviour

### 1. Agent Bridge binding

**Now:** `fixtures.ts` supplies a static roster, messages, files and terminal
output. `GenesisShell` accepts `members` / `messages` as props.

**Needed:** subscribe to real sessions via the existing `genesisBridge.ts`
client. Every view is a pure function of props, so this touches
`GenesisShell` only.

**Done when:** status, tasks, approvals and approvals-channel availability come
from the Bridge. Preserve the existing rule: a session without an interactive
approval channel must not offer approve/deny controls.

### 2. Live avatar renderer

**Now:** `PlaceholderAvatarRenderer` draws initials over a gradient.

**Needed:** implement `AvatarRenderer` (`id`, `isLive`, `render`) for a real
medium — video, canvas, or 3D.

```ts
registerAvatarRenderer({
  id: 'live-portrait',
  isLive: true,
  render: ({ preset, instance, size }) => { /* ... */ },
});
```

**No view changes.** No component imports a renderer directly. The existing
`isLiveRenderer()` helper and the `data-live` attribute already carry the
honesty signal; once a live renderer is active, the UI will report it
accurately and automatically.

**Do not** claim lip-sync, expression, or gaze behaviour until a real pipeline
backs it.

### 3. Presence signal source

**Now:** `AvatarInstance.presence` is host-supplied and defaults to `idle`.
Nothing advances it.

**Needed:** wire it to real signals — TTS boundary events for `speaking`, VAD
or an audio-level meter for `listening`, model state for `thinking`.

**Rule:** never infer speech from a timer. A presence that lies is worse than
one that stays `idle`.

---

## P1 — visual quality

### 4. Real avatar art

**Now:** abstract placeholder, by design.

**Needed:** actual portraits or a 3D rig per preset. `AvatarAppearance` already
carries hair / wardrobe / lighting / intensity as data — a renderer can consume
it directly.

**Note:** also close the `references/vibe-prototype` habit of hotlinking
Unsplash URLs. Assets must be local and deterministic.

### 5. Bundled typeface

**Now:** system stacks (`Segoe UI`, `Plus Jakarta Sans`, `Cascadia Code`).
A test asserts no `@font-face` and no remote font import.

**Needed:** decide whether to bundle a face. The references imply a geometric
sans. Whichever is chosen, self-host it and add a metric-compatible fallback so
the 13px density holds.

### 6. Per-theme avatar grading

**Now:** accent pairs come from fixed hex ramps, independent of the active
theme.

**Needed:** derive avatar accent from `--accent-*` so an ember avatar inside
the ember theme harmonises instead of merely co-existing. Small change in
`getAccent()`.

---

## P2 — surfaces that exist but are thin

### 7. Wire the remaining IDE docks

`problems`, `output` and `ports` render honest "not wired up" states. Bind them
to the shell's existing dock infrastructure.

### 8. Summon actually adds a worker

`summon()` currently records intent in shell state. It should create a real
session via the Bridge and insert the member into the roster.

### 9. Meeting controls reach the host

`silentMode`, `observeMode`, `autoQueue` and `raiseHand` are local UI state,
and the UI says so. They should map to real host requests once the Bridge
accepts them.

### 10. Conference queue is host-ordered

`ConversationQueue` renders `queuePosition` when supplied and shows an honest
empty state otherwise. It does not reorder or arbitrate. That is correct until
a host owns the order.

---

## P3 — polish and robustness

### 11. Avatar personality depth

The brief describes distinct archetypes (refined/calm, vibrant/futuristic,
strong/technical). Presets carry a tagline and a capability list, but no
system reads them. When a model is connected, these should shape tone and
verbosity.

### 12. Keyboard and screen-reader pass

Focus rings and ARIA roles are in place, and the rail is landmarked. Not yet
done: a full roving-tabindex pass over the conference grid, and live-region
announcements for presence changes.

### 13. Responsive audit at real breakpoints

Three breakpoints (1180 / 900 / 720) collapse the rail, then the avatar stage,
then the side panels. Verified at 1600×1000 only. The conference grid and
worker split need checking on narrow and very wide viewports.

### 14. Theme transition

Theme and density switch instantly. A short cross-fade would feel better, but
must respect `prefers-reduced-motion`.

### 15. Fix the local test-runner instability

`npm test` can hit `[vitest-pool-runner]: Timeout waiting for worker to respond`
on this machine under default parallelism. Single-worker mode is reliable.
Worth a `poolOptions` or `isolate: false` change so the default invocation is
trustworthy.

---

## Explicit non-goals until backed by implementation

Do not describe, label, or imply any of the following until real code supports
it: live animation, lip sync, voice I/O, video streaming, 3D embodiment,
emotion recognition, real-time facial rendering.

The scaffold's `isLive` flag, the `data-live` attribute, the `Notice`
components and the status bar exist specifically to keep these claims honest.
If a future change makes one of them true, update `isLive` — do not update the
copy and leave the flag false.