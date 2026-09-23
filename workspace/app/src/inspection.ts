// Runtime inspection clients (REQ-runtime-inspection, P23).
//
// Visual workflow/worker/tool/event/approval inspection is backed by REAL
// bridge state: the Inspector renders the live /v1/runtime payload plus
// sessions and session events fetched here. Tolerant parsing: unknown
// shapes become honest errors, never fabricated rows.

export interface InspectionSession {
  session_id: string;
  status: string;
  mode: string;
  workspace: string;
  created_at: number;
  tasks: Record<string, string>;
}

export interface InspectionEvent {
  /** Best-effort human label extracted from the raw record. */
  label: string;
  raw: Record<string, unknown>;
}

async function getJson(url: string, timeoutMs: number): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { signal: ctrl.signal });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return (await resp.json()) as unknown;
  } finally {
    clearTimeout(timer);
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function parseInspectionSessions(payload: unknown): InspectionSession[] {
  const list = Array.isArray(payload) ? payload : asRecord(payload)?.sessions;
  if (!Array.isArray(list)) throw new Error('sessions payload is not a list');
  return list.map((entry) => {
    const record = asRecord(entry);
    if (!record || !str(record.session_id)) throw new Error('session entry without session_id');
    const tasks = asRecord(record.tasks) ?? {};
    const cleanTasks: Record<string, string> = {};
    for (const [key, value] of Object.entries(tasks)) {
      cleanTasks[key] = str(value, 'unknown');
    }
    return {
      session_id: str(record.session_id),
      status: str(record.status, 'unknown'),
      mode: str(record.mode, ''),
      workspace: str(record.workspace, ''),
      created_at: num(record.created_at, 0),
      tasks: cleanTasks,
    };
  });
}

export function parseInspectionEvents(payload: unknown): InspectionEvent[] {
  const list = Array.isArray(payload) ? payload : asRecord(payload)?.events;
  if (!Array.isArray(list)) throw new Error('events payload is not a list');
  return list.map((entry) => {
    const record = (asRecord(entry) ?? { value: entry }) as Record<string, unknown>;
    const label =
      str(record.kind) ||
      str(record.type) ||
      str(record.event) ||
      str(record.action) ||
      str(record.message) ||
      JSON.stringify(entry).slice(0, 120);
    return { label, raw: record };
  });
}

export interface InspectionResult<T> {
  ok: boolean;
  data: T | null;
  error: string;
}

export async function fetchInspectionSessions(
  baseUrl: string,
  timeoutMs = 8000,
): Promise<InspectionResult<InspectionSession[]>> {
  try {
    const payload = await getJson(`${baseUrl}/v1/sessions`, timeoutMs);
    return { ok: true, data: parseInspectionSessions(payload), error: '' };
  } catch (e: unknown) {
    return { ok: false, data: null, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function fetchInspectionEvents(
  baseUrl: string,
  sessionId: string,
  since = 0,
  timeoutMs = 8000,
): Promise<InspectionResult<InspectionEvent[]>> {
  try {
    const payload = await getJson(
      `${baseUrl}/v1/sessions/${encodeURIComponent(sessionId)}/events?since=${since}`,
      timeoutMs,
    );
    return { ok: true, data: parseInspectionEvents(payload), error: '' };
  } catch (e: unknown) {
    return { ok: false, data: null, error: e instanceof Error ? e.message : String(e) };
  }
}
