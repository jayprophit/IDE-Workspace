# Supervisor Dashboard UI V1 — Handoff

**Repo:** IDE-Workspace · **Baseline:** `cb1eb26` · **Status:** complete, pushed
**Touch-set:** `workspace/app/src/supervisor-ui/**` + `supervisor-ui.html` + a dev proxy in `vite.config.ts`
**Entry:** `/supervisor-ui.html`

---

## 1. What this is

A read-only React view over the Agent-Bridge supervisor API. It renders what
the backend reports and nothing else. There is no avatar, no renderer, no
runtime binding, and no coupling of any kind to the frozen `genesis-ui` unit.

```
api/client.ts        the ONLY module that performs network I/O
api/useSupervisor.ts poll + event stream + connection state
components/fact.tsx  FactChip, FactRow, Card, StatTile   ← honesty primitives
components/sections  one view per snapshot section
components/events    EventFeed + the polite announcer
bounds.test.ts       architectural enforcement
```

## 2. The honesty vocabulary, rendered 1:1

All ten `SourceState` values are declared, and `bounds.test.ts` fails if the
set is ever narrowed:

```
LIVE_VERIFIED · LIVE · STALE · DEGRADED · OFFLINE · FIXTURE
UNKNOWN · BLOCKED · NOT_EXPOSED · DEFERRED_BACKEND_INTERFACE
```

Each renders as the exact string the backend sent. Nothing upgrades a state.

**`NOT_EXPOSED` and `DEFERRED_BACKEND_INTERFACE` carry a dashed border and
`data-declared-gap="true"`.** A declared gap must not look like one more soft
"empty" value.

### Worst-state roll-up

Every aggregate takes the **worst** state in its set, ordered by severity. One
offline field makes a section read `OFFLINE`, not `LIVE_VERIFIED`. This is
enforced by test — the exact class of bug a summary invites.

### No-data is never zero

| situation | renders |
|---|---|
| value absent, state explains why | the state's phrase, italic |
| observed empty collection | `none observed (LIVE_VERIFIED)` |
| field not in the payload | `not reported` |
| verified `0` | `0` |

The critical case, verified live: Ollama is genuinely down, and the row reads
`source offline — no value · OFFLINE` with the URLError verbatim. It never
renders `0`.

## 3. Deliberately NOT done

- **The client never recomputes staleness.** `FRESHNESS_WINDOW_S` belongs to the
  backend's clock. A second clock would eventually disagree with the one that
  made the observation. `bounds.test.ts` asserts the constant is absent.
- **No section re-derives a state.** The client may roll facts *up* to a worst
  state; it may not invent or upgrade one.
- **No `?? 0` on a fact value.** That expression is the specific bug that turns
  "no data" into "zero measured". Asserted absent from components.
- **Events are not interpreted as state.** The feed shows seq, name and the
  backend's timestamp. Health transitions come from the snapshot, never from
  event traffic.

## 4. Three defects found by rendering, not by review

**1. TypeScript imports had leaked into the top of `tokens.css`.** Two
`import type` lines were prepended to the stylesheet by an earlier scripted
edit. Every build succeeded, `tsc` was clean, and all 92 tests passed — the
whole stylesheet was being parsed as an invalid rule and discarded, so the page
rendered **unstyled** with no error anywhere. Only the screenshot showed it.

**2. The shell had no viewport height.** `.sv-shell` had `height: 100%` against
an unsized body, so the lower ~40% of every page rendered as an unstyled white
strip. Fixed with `100dvh` on both `.sv-root` and `.sv-shell`.

**3. A doubled version segment, twice.** `/api/supervisor` as the base plus the
client's own `/v1/supervisor` produced `/api/supervisor/v1/supervisor/...`;
the proxy then stripped its prefix and emitted `/v1/supervisor/v1/supervisor/…`
— a 404 with no client-side error, surfacing only as an "unreachable" dashboard.
Fixed at both layers: the proxy prefix is a bare `/api`, and `apiUrl()` is
explicit about whether a base already names the version. Three tests pin it.

The through-line: **none of these would have been caught by a passing test
suite.** Each was found by rendering and looking.

## 5. A design change I made and should flag

Absent sections originally rendered their own dashed card each. With six
sections unwired, that pushed every live section off-screen — the dashboard
opened on six identical warnings.

They are now reported **once**, in a single "Not wired" card listing the
missing sections as chips. Live data comes first. The honesty is unchanged and
arguably clearer; the `sectionState()` computation is untouched.

## 6. Transport note (needs a decision before production)

The supervisor API is a stdlib `http.server` that sends **no CORS headers**,
so a browser cannot read it cross-origin. Changing Agent-Bridge was out of
scope, so `vite.config.ts` proxies `/api/*` → `http://127.0.0.1:8472/*` in dev
and preview. The client owns the `/v1/supervisor` path segments; the proxy
strips only its own prefix.

**A production deployment must serve this same-origin behind an equivalent
reverse proxy.** Pointing the built bundle straight at `http://127.0.0.1:8472`
will fail CORS. Flagging it rather than leaving it to be discovered.

## 7. Verification

| gate | result |
|---|---|
| `tsc --noEmit` | exit 0 |
| `vite build` | clean, three entries |
| full suite | **347 passed**, 22 files |
| — pre-existing shell | **80 unchanged** |
| — genesis-ui (frozen) | **175 unchanged** |
| — supervisor-ui (new) | **92** |

**Live-render QA** — headless Chromium against the production build, with the
**real** backend running (real git + Ollama + OpenCode adapters):

| check | result |
|---|---|
| console errors | **0** |
| failed requests | **0** |
| Ollama offline renders as offline, never 0 | pass |
| OpenCode verdict `ACTIVE` + backend note verbatim | pass |
| NOT_EXPOSED dashed + flagged | pass |
| roll-up shows `Local models=OFFLINE` | pass |
| repos: 4 real, real SHAs, real dirty counts | pass |
| horizontal overflow @ 1920/1440/1100/820/700 | **0** |

The fixture used in tests is a **real captured response** — including Ollama
genuinely being down — so the tests exercise the states the dashboard actually
meets, not only the happy path.

## 8. Files

```
workspace/app/supervisor-ui.html            standalone entry
workspace/app/vite.config.ts                + dev proxy + third entry
workspace/app/src/supervisor-ui/
  SupervisorDashboard.tsx  main.tsx  index.ts
  api/     types.ts  client.ts  useSupervisor.ts  client.test.ts  fetch-harness.ts
  components/  fact.tsx  sections.tsx  events.tsx
               honesty.test.tsx  a11y.test.tsx
               snapshot-fixture.ts
  tokens/   tokens.css
  bounds.test.ts
  README.md
```

`docs/handoffs/` is **untracked** and Hermes-owned. Nothing of mine is in it.

## 9. Deferred

Nothing outstanding in this unit. Genuinely out of scope and untouched:

- production reverse proxy (see §6)
- `knowledge` and `codex` sections — the backend emits them only when
  `knowledge_index` / `codex_home` are injected; the UI renders `NOT_EXPOSED`
- `workers` as a standalone section — `refresh_snapshot` falls back to it when
  `team_registry` is absent; the UI reads `team_registry` first
- theme picker UI — five themes are defined in tokens and `abyss` is active;
  wiring a selector is a small follow-up

Deferred from other units, untouched: Agent Bridge live binding, live avatar
renderer, presence signals, T1–T4 embodiment, voice, lip sync.