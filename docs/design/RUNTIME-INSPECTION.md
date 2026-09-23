# Runtime Inspection (REQ-runtime-inspection, P23)

Visual workflow/worker/tool/event/approval inspection backed by real
bridge state. Owner: IDE.

## Surface

The Inspector panel's **Runtime inspection** card (`App.tsx`) renders:

- **Workers** — id + state rows from the live `/v1/runtime` payload.
- **Approvals** — pending entries from the live payload.
- **Sessions** — explicit **Load sessions** fetch (manual, never polled,
  keeping bridge-call counts deterministic); each row shows status + task
  count; selecting a session loads its events.
- **Events** — labels from `/v1/sessions/{id}/events`.

## Honesty rules

- Disconnected: the card says inspection shows live state only when
  connected; session loading requires connection (no fake controls).
- Connected but empty: per-section empty notes (no workers registered, no
  approvals pending, no sessions loaded, no events recorded).
- Fetch failures surface as error notes, never silent blanks.
- Event labels are best-effort (`kind`/`type`/`event`/`action`/`message`,
  else truncated JSON) — the raw record is preserved, never invented.

## Clients (`src/inspection.ts`)

`fetchInspectionSessions` / `fetchInspectionEvents` with tolerant parsing:
array or `{sessions|events: []}` envelopes accepted; malformed shapes and
transport failures return `{ok: false, error}`.

## Tests

- `src/inspection.test.ts` (6 tests): parser shapes, malformed payloads,
  URL encoding, HTTP/network failures.
- `src/App.test.tsx` runtime-inspection block (4 tests): honest empties,
  live workers/approvals, on-demand sessions + event drill-in, fetch
  failure honesty.
- `scripts/verify-shell.mjs`: inspector offline honesty in headless Chrome.
