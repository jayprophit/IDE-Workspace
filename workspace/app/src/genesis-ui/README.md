# Genesis UI Scaffold

Avatar-first UI scaffold for the Genesis / Aetherius interface.

**The avatar renderer shipped here is a labelled placeholder.** There is no
animation, no lip sync, no voice, no video and no 3D embodiment. The status bar
says so, every avatar frame carries `data-live="false"`, and a test asserts it.

## Run it

```powershell
cd workspace/app
npm install
npm run dev
```

| URL | What |
|---|---|
| `/` | existing IDE shell (unchanged) |
| `/genesis-ui.html` | this scaffold, standalone |

## Verify it

```powershell
npx tsc --noEmit
npx vitest run --maxWorkers=1 --fileParallelism=false
npx vite build
```

`--maxWorkers=1 --fileParallelism=false` avoids a pre-existing worker-startup
timeout on Windows. Single-worker mode passes; the default invocation
intermittently does not, and that reproduces on the untouched baseline.

## What is here

- **Design tokens** — primitives → semantics → themes, in that cascade order
- **5 themes** — abyss (dark blue, default), aurora, ember, graphite, frost
- **4 layout modes** — simple, standard, dense, focus (full-screen worker)
- **Avatar framework** — 15 presets (male / female / neutral), pluggable renderer
- **7 views** — Home, Chat, Work/IDE, Team, Worker detail, Calls, Settings
- **Team surfaces** — strip, conference grid, speaking queue, summon, silent/observe

## The one thing to know

Avatar drawing goes through a registry, and no view imports a renderer:

```ts
registerAvatarRenderer({ id: 'live-portrait', isLive: true, render: (props) => … });
```

A live avatar registers under its own id and every view picks it up unchanged.
Read `avatar/renderers.tsx` before starting that work.

## Docs

- [`IMPLEMENTATION_NOTES.md`](./IMPLEMENTATION_NOTES.md) — architecture, tokens,
  themes, predecessor audit (`migrated` / `rejected`), verification results
- [`GAP_LIST.md`](./GAP_LIST.md) — ordered backlog, including what must never be
  claimed until implemented

## Rules this codebase enforces

1. An empty surface says it is empty. Never fabricate data to fill a panel.
2. A placeholder is labelled in the UI, not just in the docs.
3. Theme and layout density are independently reversible.
4. Components read semantic tokens only, never raw colours.
5. Presence is host-supplied. No timer advances an avatar's state.