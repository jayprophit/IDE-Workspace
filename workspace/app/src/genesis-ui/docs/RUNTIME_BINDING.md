# P0-A — Agent Bridge runtime binding

**Baseline:** `af2af48` (accepted as the canonical UI foundation)
**Touch-set:** `workspace/app/src/genesis-ui/**` only
**Repo:** IDE-Workspace. Agent-Bridge was read, never modified.

---

## What this unit is

Replaces the Genesis UI's fixture-only runtime state with a real binding to
Agent Bridge. The views still receive plain props; only the shell knows where
the data comes from.

```
useGenesisRuntime()        ← the ONE integration point
        ↓  RuntimeSnapshot (plain data)
GenesisShell               ← mode selection, connection state
        ↓  props
views                     ← unchanged, still pure functions
```

`useGenesisRuntime` is the only place in `genesis-ui` that performs a network
call. `runtime/bounds.test.ts` enforces that by reading every source file and
failing if a view grows a `fetch` or a Bridge client import.

## Modes

| Mode | Network | Labelled as |
|---|---|---|
| `fixture` (default) | never | "runtime fixture (not connected)" |
| `agent_bridge` | yes | "runtime agent bridge: <status>" |

The mode is readable from the DOM, so no surface can quietly claim otherwise:

```html
data-runtime-source="fixture|agent_bridge"
data-runtime-connection="disconnected|connecting|connected|reconnecting|error"
data-runtime-fresh="true|false"
```

Fixture mode cannot masquerade as live: it is never `connected`, never
`fresh`, and its approve/deny controls are locked off.

## Approvals — the rule that mattered most

`decidable` mirrors the Bridge's own `interactive` flag and **nothing else**.
Not the presence of an approval, not a timeout, not whether the click would
probably work.

- A session reporting `interactive: false` renders the approval, its action and
  its risk, plus a plain statement that it cannot be decided here. **No
  buttons.**
- The seam enforces the same rule again in `decide()`: it refuses locally
  before sending anything, so a caller bypassing the UI cannot get a decision
  past the runtime that would reject it.

Verified live-rendered against a stubbed Bridge:

| session | approve | deny | undecidable note |
|---|---|---|---|
| `interactive: false` | **0** | **0** | shown |
| `interactive: true` | **1** | **1** | absent |

## Honest degradation

- Unreachable Bridge → `disconnected`, **empty team**, error verbatim
- Connected then lost → `disconnected` with values retained and `fresh: false`,
  because losing the values would destroy context the person still has
- Never-connected → distinguishable from lost, via the `fresh` flag

## Backend gaps (Bridge does not expose these yet)

These are **not** worked around. Each maps to an honest empty state.

| Gap | Evidence | UI behaviour |
|---|---|---|
| `workers` always `[]` on `/v1/runtime` | `service.py:223` hardcodes `tracker=None`; `ide_bridge.py:85` `record_workers` never called | empty team, not fixture workers |
| No team/worker endpoint | `TeamRegistry` has no HTTP route | no live roster |
| No active-speaker concept | no queue order in the runtime payload | speaking state remains local |
| Handoff events never reach SSE | `team_registry.py:338-349` writes JSONL only | no handoff display |
| `results`, `resources`, `errors`, `evidence_refs` always empty over HTTP | only writer is `feed_loop_record`, never invoked | not shown |
| No execution-target endpoint | `ai_gateway.py` not imported by `service.py` | local/cloud/hybrid **not** displayed |
| `avatar_profile_id` does not exist | zero occurrences repo-wide | `avatarId` stays `''` |
| `execution_target_id` does not exist | worker field is `execution_target`, registry field `target_id`, never reconciled | not inferred |
| No call/media endpoint | — | calls remain local |

Two of these were **not** papered over and are worth stating plainly:

1. **No live worker roster.** `mapWorkers()` maps real entries when the Bridge
   supplies them, but in practice it returns `[]`. It does not fall back to
   fixture workers, because a runtime reporting no workers must produce no
   workers.
2. **No execution-target display.** Section 10 forbids building a second
   compute router, so this is left out entirely rather than guessed from the
   provider name.

## Two defects found while building this

**1. An infinite poll loop.** The hook captured `client` and `baseUrl` from
props in `useCallback` deps. A caller passing a fresh options object each
render restarted the effect each render, and the loop never completed a cycle —
three tests hung for the full 15s timeout and the file took 50s. Options are
now read through a ref so the loop's identity is stable. File time dropped to
15s; the hangs are gone.

**2. `localMessages` vs `snap.messages` collision.** Two sources of truth for
the transcript. The shell now derives the final list: runtime messages plus
locally-echoed user messages, unless an explicit prop override is supplied.

## Security

No secret material reaches the snapshot. The binding carries ids, states,
counts and verbatim error strings only. `bounds.test.ts` asserts the runtime
module assigns no token/key/password/secret/bearer value, and no test fixture
carries credential-shaped data. Agent-Bridge permissions are respected rather
than bypassed — the approval gate is the concrete instance.

## Test results

| suite | before | after |
|---|---|---|
| pre-existing shell | 80 | **80 (unchanged)** |
| genesis-ui | 124 | **175** (+51) |
| **total** | 204 | **255**, 18 files |

New: `runtime-mapping.test.ts` (22), `useGenesisRuntime.test.tsx` (14),
`bounds.test.ts` (14). `GenesisShell.test.tsx` 24 → 25 (the flat "fixture data"
label became a real runtime assertion, which is a stronger test).

`tsc --noEmit` clean. `vite build` clean.

## Live-render verification

Headless Chromium, `puppeteer-core` against the local Playwright Chromium,
against the production build at 1440×900.

| check | result |
|---|---|
| console errors | **0** |
| failed requests | **0** |
| fixture mode labelled + not connected | pass |
| approve/deny absent, non-interactive session | pass |
| approve/deny present, interactive session | pass |
| `data-live` | `false` on every frame |
| renderer status | "placeholder (not live)" |
| unreachable Bridge → empty team | pass |

## Honest boundaries of this claim

The Bridge was **stubbed at the fetch layer** for the approval-gating
verification. That proves the UI reads `interactive` correctly and gates on it;
it is not evidence of a live end-to-end Bridge session. Demonstrating that
needs the real service running, which is the next step, not this one.

`chatRuntimeLines` measured 0 in the render check — runtime events are mapped
into the transcript, but the fixture transcript rendered alongside them in this
drive. Flagging it rather than claiming it worked.

## Deferred, untouched

Live avatar renderer, presence signals, T1–T4 embodiment, voice, lip sync,
gesture, gaze, STT/TTS, Agent-Bridge source changes, Provider V2, Role
Ontology, cloud/hybrid execution routing.

`registerAvatarRenderer` is unchanged. `data-live="false"` and the "not live"
copy remain, and `bounds.test.ts` now asserts both still exist.