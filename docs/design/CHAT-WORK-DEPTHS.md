# Chat / Work interface depths (P23/1)

CHAT and WORK are interface depths over one system, not capability modes.

## Shared canonical state

`workspace/app/src/workspace/state.ts` owns the contract: one Genesis
reference, one owner, one project, one task, one WorkflowRun, one principal,
one pending-approval record, plus bridge/model service states. Mode switches
return the identical shared reference — they cannot duplicate tasks, runs,
models requests or approvals, and they never alter authorization.

## Depth-specific layout state

- Chat: selected conversation, one optional right panel, dock visibility.
- Work: open tabs, selected file, right-panel registry (open/collapse/
  reorder), bottom dock (visible tab).
- Layout persists to localStorage with validation; corrupt state falls back
  to defaults, never to fabricated content.

## Structural shell

- Right contextual surfaces live in a collapsible/tabbed sidebar host.
  Code/Web/Video are never permanently bottom-docked.
- The bottom dock hosts runtime/developer tabs only (terminal, problems,
  output, tests, logs, evidence, git) and is fully hideable.
- Panels open by id from a closed catalog; unknown ids are rejected.

## Honesty rules

Service states distinguish live / disconnected / empty / not-implemented /
denied / error. The UI renders unavailable states instead of mock data;
chat replies without a backend say so; the editor never shows fabricated
file contents; progress shows em-dash without live data.

## Security

Layout state, DOM flags, modes and query parameters grant nothing.
Authority is backend policy only. Owner-kind principals must arrive from
backend session state, never from UI state.

## Specialist presets (P23 remainder slice)

Presets are declarative arrangements over the same shell: `WORKSPACE_PRESETS`
declares depth, main-surface kind, right panels, dock tab and description.
Applying a preset changes presentation only — never tasks, runs, models,
grants or principal state. Unknown preset ids are rejected; unknown panels
fall back honestly. Active preset persists per project. Main-surface kinds
beyond the editor render honest availability states until backends exist.

## Responsive adaptation

Viewport classes (wide ≥1280, medium, narrow ≤760) drive presentation only.
At narrow widths the right sidebar becomes a temporary overlay drawer;
opening/closing it never touches persisted desktop preferences, and
widening restores the exact desktop arrangement. Overlay state is transient
and never persisted. Reduced-motion preferences disable panel transitions.

## Layout system (P23 layout unit)

One structural model serves both depths: header, left activity nav, main
canvas, right contextual sidebar, bottom runtime dock. Chat defaults to
conversation-first with dock hidden; Work defaults to canvas-first with the
dock available; both are presets, not capability gates.

- Right sidebar: registry-driven tabs (Agent, Inspector), collapsible,
  focus/maximize with restore, width 200–640 persisted per project.
- Bottom dock: runtime tabs only (terminal, problems, output, tests, logs,
  evidence, git); Code/Web/Video never live there. Terminal DOM persists
  across collapse; closing a view never terminates its runtime.
- Layout state is schema-versioned (v2, migrates v1), per-project,
  validated per section with safe fallback; reset restores defaults
  without touching canonical task state.
- View lifecycle is separate from execution lifecycle throughout.
