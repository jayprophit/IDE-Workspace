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
