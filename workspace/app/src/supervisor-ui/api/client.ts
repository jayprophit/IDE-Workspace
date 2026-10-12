import {
  SECTION_IDS,
  type SectionId,
  type SourceFact,
  type SourceState,
  type SupervisorEvent,
  type SupervisorHealth,
  type SupervisorSnapshot,
  type SupervisorStateResponse,
  type WorkerContinueResult,
  type WorkerDetail,
} from './types';

/**
 * Supervisor API client — the ONLY place supervisor-ui performs network I/O.
 *
 * Mirrors `bounds.test.ts` from the runtime-binding unit: a test reads every
 * source file in this directory tree and fails if anything other than this
 * module (or the SSE hook) issues a request. One transport, no second client.
 *
 * Tolerance rules, inherited from `genesisBridge.ts` and the Python side:
 *   - a malformed shape becomes an honest error, never a default-filled object
 *   - a 404 or an unparseable body is reported as unreachable, not as "empty"
 *   - nothing is invented when the backend omits a field
 */

/**
 * Default base.
 *
 * In dev/preview this is a SAME-ORIGIN path handled by the Vite proxy in
 * `vite.config.ts`, because the supervisor API is a stdlib http.server that
 * sends no CORS headers — a browser cannot read it cross-origin, and changing
 * Agent-Bridge is out of scope for this unit.
 *
 * The proxy forwards to the identical loopback host and paths, so this is a
 * transport detail rather than a second protocol. Production should serve the
 * dashboard same-origin behind an equivalent reverse proxy.
 */
const DEFAULT_BASE = '/api';

/** Absolute loopback, for non-browser callers and for the fallback below. */
export const SUPERVISOR_LOOPBACK = 'http://127.0.0.1:8472';

export const SUPERVISOR_DEFAULT_BASE = DEFAULT_BASE;

/**
 * Mirrors `bridge.ts::resolveBase`: a test hook, used the same way.
 *
 * A caller that explicitly wants the absolute loopback (a Node-side check, or
 * a browser with the proxy disabled) passes it and it is honoured as-is.
 */
export function resolveBase(baseUrl?: string): string {
  const override = (window as unknown as Record<string, unknown>).__SUPERVISOR_BASE__;
  if (typeof override === 'string' && override) return override;
  /* An explicit base wins; otherwise the same-origin default. This function is
     the single owner of that decision so no caller can reintroduce the
     cross-origin loopback default. */
  return baseUrl ?? DEFAULT_BASE;
}

/**
 * Join the configured base with an absolute API path.
 *
 * `DEFAULT_BASE` is the same-origin prefix `/api/supervisor`, and the dev proxy
 * rewrites that to `/v1/supervisor` upstream. Concatenating naively produced
 * `/api/supervisor/v1/supervisor/state`, which the proxy then rewrote into a
 * doubled path and 404'd. So the join is explicit about which half it owns:
 * a base that already names the version is a full base and gets no version
 * appended; anything else is treated as a prefix.
 */
function apiUrl(base: string, path: string): string {
  const versioned = /\/v1\/supervisor\/?$/.test(base);
  return versioned ? `${base}${path.replace('/v1/supervisor', '')}` : `${base}${path}`;
}

async function getJson(url: string, timeoutMs: number): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return (await resp.json()) as unknown;
  } finally {
    window.clearTimeout(timer);
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** A SourceFact only if it really looks like one. Anything else is rejected. */
export function isSourceFact(value: unknown): value is SourceFact {
  const rec = asRecord(value);
  return rec !== null && typeof rec.state === 'string' && typeof rec.source === 'string';
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/* ---------------------------------------------------------------------------
 * Health
 * ------------------------------------------------------------------------ */

export async function fetchSupervisorHealth(
  baseUrl: string = DEFAULT_BASE,
  timeoutMs = 4000,
): Promise<SupervisorHealth> {
  baseUrl = resolveBase(baseUrl);
  try {
    const payload = asRecord(await getJson(apiUrl(baseUrl, '/v1/supervisor/health'), timeoutMs));
    if (!payload) throw new Error('health payload is not an object');
    return {
      ok: payload.ok === true,
      supervisor: typeof payload.supervisor === 'string' ? payload.supervisor : undefined,
      schema_version: typeof payload.schema_version === 'number' ? payload.schema_version : undefined,
      last_event_seq: typeof payload.last_event_seq === 'number' ? payload.last_event_seq : undefined,
      error_code: typeof payload.error_code === 'string' ? payload.error_code : undefined,
    };
  } catch (e) {
    /* Unreachable is reported as unreachable. Never as "healthy but empty". */
    return { ok: false, error_code: 'UNREACHABLE', detail: e instanceof Error ? e.message : String(e) };
  }
}

/* ---------------------------------------------------------------------------
 * Snapshot
 * ------------------------------------------------------------------------ */

export function parseSnapshot(payload: unknown): SupervisorSnapshot {
  const rec = asRecord(payload);
  if (!rec) throw new Error('snapshot payload is not an object');
  const sections = asRecord(rec.sections) ?? {};
  return {
    schema_version: num(rec.schema_version, 0),
    supervisor: str(rec.supervisor, 'unknown'),
    session_id: str(rec.session_id),
    generated_at: str(rec.generated_at),
    last_event_seq: num(rec.last_event_seq, 0),
    /* Sections keep whatever the backend sent, including nested fact groups.
       Filtering to a fixed list here would hide a section the backend added. */
    sections: sections as Record<string, Record<string, unknown>>,
  };
}

export async function fetchSupervisorState(
  baseUrl: string = DEFAULT_BASE,
  timeoutMs = 10000,
): Promise<SupervisorStateResponse> {
  baseUrl = resolveBase(baseUrl);
  try {
    const payload = asRecord(await getJson(apiUrl(baseUrl, '/v1/supervisor/state'), timeoutMs));
    if (!payload) throw new Error('state payload is not an object');
    return { ok: payload.ok === true, snapshot: parseSnapshot(payload.snapshot) };
  } catch (e) {
    return { ok: false, error_code: 'UNREACHABLE', detail: e instanceof Error ? e.message : String(e) };
  }
}

/* ---------------------------------------------------------------------------
 * §17.J worker detail / §18 continue — the control surface
 *
 * All network I/O for these stays in this file (bounds.test.ts forbids a
 * fetch outside api/client.ts). detail is a GET; continue is a POST through
 * the loopback proxy to the REAL adapter channel — the API never opens a
 * second channel to a worker.
 * ------------------------------------------------------------------------ */

export async function fetchWorkerDetail(
  workerId: string,
  baseUrl: string = DEFAULT_BASE,
  timeoutMs = 10000,
): Promise<WorkerDetail> {
  baseUrl = resolveBase(baseUrl);
  try {
    const payload = asRecord(await getJson(apiUrl(baseUrl, `/v1/supervisor/worker/${encodeURIComponent(workerId)}`), timeoutMs));
    if (!payload) throw new Error('worker detail payload is not an object');
    return {
      ok: payload.ok === true,
      worker_id: str(payload.worker_id),
      application: typeof payload.application === 'string' ? payload.application : undefined,
      role: typeof payload.role === 'string' ? payload.role : undefined,
      verdict: typeof payload.verdict === 'string' ? payload.verdict : undefined,
      evidence: Array.isArray(payload.evidence) ? (payload.evidence as unknown[]).map(String) : [],
      quota: asRecord(payload.quota) ?? undefined,
      current_task: asRecord(payload.current_task) ?? undefined,
      record: asRecord(payload.record) ?? undefined,
      error_code: typeof payload.error_code === 'string' ? payload.error_code : undefined,
    };
  } catch (e) {
    return { ok: false, worker_id: workerId, error_code: 'UNREACHABLE', evidence: [], detail: e instanceof Error ? e.message : String(e) };
  }
}

export async function continueWorker(
  workerId: string,
  baseUrl: string = DEFAULT_BASE,
  timeoutMs = 10000 * 6,
): Promise<WorkerContinueResult> {
  baseUrl = resolveBase(baseUrl);
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(apiUrl(baseUrl, `/v1/supervisor/worker/${encodeURIComponent(workerId)}/continue`), {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: '{}',
    });
    const payload = asRecord(await resp.json());
    if (!payload) throw new Error('continue payload is not an object');
    return {
      ok: payload.ok === true,
      worker_id: str(payload.worker_id),
      delivered: payload.delivered === true,
      channel: typeof payload.channel === 'string' ? payload.channel : undefined,
      evidence: Array.isArray(payload.evidence) ? (payload.evidence as unknown[]).map(String) : [],
      error_code: typeof payload.error_code === 'string' ? payload.error_code : undefined,
    };
  } catch (e) {
    return { ok: false, worker_id: workerId, delivered: false, evidence: [], error_code: 'UNREACHABLE', detail: e instanceof Error ? e.message : String(e) };
  } finally {
    window.clearTimeout(timer);
  }
}

/* ---------------------------------------------------------------------------
 * Events (SSE)
 * ------------------------------------------------------------------------ */

/**
 * Parse one SSE frame body.
 *
 * The server frames `id:` / `event: supervisor` / `data: {...}` per event,
 * matching `node_server._send_sse` so one parser serves both streams. Frames
 * are split on the blank line; anything unparseable is skipped rather than
 * becoming a fake event.
 */
export function parseSseFrames(body: string): SupervisorEvent[] {
  const out: SupervisorEvent[] = [];
  for (const chunk of body.split(/\r?\n\r?\n/)) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;

    let id: number | null = null;
    let data: string | null = null;

    for (const line of trimmed.split(/\r?\n/)) {
      if (line.startsWith('id:')) {
        const n = Number(line.slice(3).trim());
        if (Number.isFinite(n)) id = n;
      } else if (line.startsWith('data:')) {
        /* SSE allows multi-line data; accumulate rather than take the last. */
        data = data === null ? line.slice(5).trim() : `${data}\n${line.slice(5).trim()}`;
      }
    }
    if (data === null) continue;

    const rec = asRecord(JSON.parse(data) as unknown);
    if (!rec) continue;
    out.push({
      seq: typeof rec.seq === 'number' ? rec.seq : (id ?? 0),
      received_at: str(rec.received_at),
      event: asRecord(rec.event) ?? {},
    });
  }
  return out;
}

export async function fetchSupervisorEvents(
  baseUrl: string = DEFAULT_BASE,
  since = 0,
  timeoutMs = 8000,
): Promise<{ ok: boolean; events: SupervisorEvent[]; error: string }> {
  baseUrl = resolveBase(baseUrl);
  try {
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const resp = await fetch(apiUrl(baseUrl, `/v1/supervisor/events?since=${since}`), { signal: ctrl.signal });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const body = await resp.text();
      return { ok: true, events: parseSseFrames(body), error: '' };
    } finally {
      window.clearTimeout(timer);
    }
  } catch (e) {
    return { ok: false, events: [], error: e instanceof Error ? e.message : String(e) };
  }
}

/* ---------------------------------------------------------------------------
 * Section access
 * ------------------------------------------------------------------------ */

/** Every fact in a section, flattened one level. Nested groups keep their shape. */
export function factsIn(section: Record<string, unknown> | undefined): [string, SourceFact | Record<string, SourceFact>][] {
  if (!section) return [];
  const out: [string, SourceFact | Record<string, SourceFact>][] = [];
  for (const [key, value] of Object.entries(section)) {
    if (isSourceFact(value)) {
      out.push([key, value]);
    } else {
      /* Nested groups (repositories[label], opencode.liveness, codex) are
         flattened here so a renderer can treat every leaf uniformly. */
      const rec = asRecord(value);
      if (!rec) continue;
      const nested: Record<string, SourceFact> = {};
      for (const [k, v] of Object.entries(rec)) {
        if (isSourceFact(v)) nested[k] = v;
      }
      if (Object.keys(nested).length > 0) out.push([key, nested]);
    }
  }
  return out;
}

/** The single fact in an error-shaped section, if that is what it holds. */
export function errorFactOf(section: Record<string, unknown> | undefined): SourceFact | null {
  if (!section) return null;
  const err = section.error;
  return isSourceFact(err) ? err : null;
}

/**
 * Worst state in a set of facts.
 *
 * Used for the section-level roll-up chip. Ordered from most to least
 * trustworthy, because the roll-up must never make a degraded section look
 * healthy: one NOT_EXPOSED or OFFLINE field poisons the section.
 */
const SEVERITY: Record<SourceState, number> = {
  NOT_EXPOSED: 0,
  DEFERRED_BACKEND_INTERFACE: 1,
  OFFLINE: 2,
  DEGRADED: 3,
  BLOCKED: 4,
  UNKNOWN: 5,
  STALE: 6,
  FIXTURE: 7,
  LIVE: 8,
  LIVE_VERIFIED: 9,
};

export function worstState(facts: { state: SourceState }[]): SourceState | null {
  if (facts.length === 0) return null;
  let worst: SourceState = facts[0].state;
  for (const f of facts.slice(1)) {
    if (SEVERITY[f.state] < SEVERITY[worst]) worst = f.state;
  }
  return worst;
}

/** Flatten a section's facts to leaves only, for the roll-up. */
export function leafFacts(section: Record<string, unknown> | undefined): SourceFact[] {
  const leaves: SourceFact[] = [];
  for (const [, v] of factsIn(section)) {
    if (isSourceFact(v)) leaves.push(v);
    else leaves.push(...Object.values(v));
  }
  return leaves;
}

/** State of a whole section, or NOT_EXPOSED when the section is absent. */
export function sectionState(section: Record<string, unknown> | undefined): SourceState {
  /* Absent means the backend did not wire it. That is NOT_EXPOSED, the same
     thing `not_exposed()` produces server-side - not "empty" and not "live". */
  if (!section || Object.keys(section).length === 0) return 'NOT_EXPOSED';
  const err = errorFactOf(section);
  if (err) return err.state;
  return worstState(leafFacts(section)) ?? 'NOT_EXPOSED';
}

/** Present sections, in the canonical display order. */
export function presentSections(snapshot: SupervisorSnapshot | null): SectionId[] {
  if (!snapshot) return [];
  return SECTION_IDS.filter((id) => {
    const s = snapshot.sections[id];
    return s !== undefined && Object.keys(s).length > 0;
  });
}

/** Fields in a section that report "no data" as a real, stated value. */
export function countOf(fact: SourceFact | undefined): number | null {
  if (!fact) return null;
  if (typeof fact.value === 'number') return fact.value;
  if (Array.isArray(fact.value)) return fact.value.length;
  return null;
}