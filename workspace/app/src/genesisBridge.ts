// Session / task / approval client for the Genesis-in-IDE vertical slice.
//
// The IDE already talks to Agent Bridge for health, models, the terminal and
// the workspace (bridge.ts) and for read-only runtime inspection
// (inspection.ts). Neither could do the one thing the minimum harness
// requires: ask for a task, watch it, and answer the authority question it
// raises. This module adds exactly that surface, and nothing else.
//
// Rules this module keeps:
//   - the IDE is not the backend owner. Every call goes to the Bridge's
//     documented /v1 API; no authority, policy or execution logic lives here.
//   - never fabricate. Unknown shapes become honest errors, and a task that
//     was refused is never rendered as a success.
//   - effect truth is read from the Bridge result, not inferred from the
//     status string: a run that ended COMPLETED with every action denied is
//     reported as blocked, because that is what happened.

export interface GenesisSession {
  session_id: string;
  mode: string;
  approval: string;
  interactive: boolean;
}

export interface GenesisTaskHandle {
  task_id: string;
  status: string;
  deduped: boolean;
}

export interface GenesisPendingApproval {
  approval_id: string;
  action: string;
  risk: string;
}

export interface GenesisSessionStatus {
  session_id: string;
  status: string;
  interactive: boolean;
  tasks: Record<string, string>;
  pending_approvals: string[];
  files_touched: string[];
  errors: { step?: string; kind?: string; error?: string }[];
  approvals: { action?: string; decision?: string }[];
  tests: { ran?: number; passed?: number; all_passed?: boolean | null; verified?: boolean };
  review: string;
}

export interface GenesisOutcome {
  task_id: string;
  status: string;
  /** Did the run actually change the world? Read from the Bridge journal. */
  effect_achieved: boolean;
  denied_actions: number;
  /** Denied work with no effect: completed, but nothing was achieved. */
  blocked: boolean;
  files_created: string[];
  files_modified: string[];
  files_deleted: string[];
  commands: { command?: string; ok?: boolean }[];
  errors: { kind?: string; error?: string }[];
  approvals: { action?: string; decision?: string }[];
  review_verdict: string;
  finished_reason: string;
  tests_ran: number;
  tests_passed: number;
  tests_verified: boolean;
  duration_s: number;
}

export interface GenesisManifestEntry {
  path: string;
  action: string;
}

export interface GenesisEvidence {
  manifest: GenesisManifestEntry[];
  scorecard_categories: Record<string, string>;
  timeline: string[];
}

export interface GenesisResult<T> {
  ok: boolean;
  data: T | null;
  error: string;
}

const JSON_TIMEOUT_MS = 8000;
const MUTATION_TIMEOUT_MS = 15000;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function bool(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function strList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

async function request(url: string, init: RequestInit, timeoutMs: number): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { ...init, signal: ctrl.signal });
    if (!resp.ok) {
      let detail = `HTTP ${resp.status}`;
      try {
        const body = (await resp.json()) as { error?: string };
        if (body?.error) detail = body.error;
      } catch {
        /* a non-JSON error body is not more informative than the status */
      }
      throw new Error(detail);
    }
    return (await resp.json()) as unknown;
  } finally {
    clearTimeout(timer);
  }
}

function getJson(url: string, timeoutMs = JSON_TIMEOUT_MS): Promise<unknown> {
  return request(url, { method: 'GET' }, timeoutMs);
}

function postJson(url: string, body: unknown, timeoutMs = MUTATION_TIMEOUT_MS): Promise<unknown> {
  return request(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    timeoutMs,
  );
}

function wrap<T>(fn: () => Promise<T>): Promise<GenesisResult<T>> {
  return fn()
    .then((data) => ({ ok: true, data, error: '' }))
    .catch((e: unknown) => ({
      ok: false,
      data: null,
      error: e instanceof Error ? e.message : String(e),
    }));
}

export function parseSession(payload: unknown): GenesisSession {
  const record = asRecord(payload);
  const id = str(record?.session_id);
  if (!id) throw new Error('session payload has no session_id');
  return {
    session_id: id,
    mode: str(record?.mode, 'build'),
    approval: str(record?.approval, 'AUTO_SAFE'),
    interactive: bool(record?.interactive, false),
  };
}

export function parseTaskHandle(payload: unknown): GenesisTaskHandle {
  const record = asRecord(payload);
  const id = str(record?.task_id);
  if (!id) throw new Error('task payload has no task_id');
  return { task_id: id, status: str(record?.status, 'unknown'), deduped: bool(record?.deduped) };
}

export function parseSessionStatus(payload: unknown): GenesisSessionStatus {
  const record = asRecord(payload);
  if (!record) throw new Error('session status is not an object');
  const tasks: Record<string, string> = {};
  const rawTasks = asRecord(record.tasks) ?? {};
  for (const [key, value] of Object.entries(rawTasks)) tasks[key] = str(value, 'unknown');
  const tests = asRecord(record.tests) ?? {};
  return {
    session_id: str(record.session_id),
    status: str(record.status, 'unknown'),
    interactive: bool(record.interactive, false),
    tasks,
    pending_approvals: strList(record.pending_approvals),
    files_touched: strList(record.files_touched),
    errors: Array.isArray(record.errors)
      ? (record.errors as { step?: string; kind?: string; error?: string }[])
      : [],
    approvals: Array.isArray(record.approvals)
      ? (record.approvals as { action?: string; decision?: string }[])
      : [],
    tests: {
      ran: num(tests.ran),
      passed: num(tests.passed),
      all_passed: typeof tests.all_passed === 'boolean' ? tests.all_passed : null,
      verified: bool(tests.verified),
    },
    review: str(record.review, ''),
  };
}

/**
 * Turn a session status into the approval rows a human can act on. The Bridge
 * reports approval ids; the action and risk come from the event log, which is
 * the only place they exist. A missing detail renders as unknown rather than
 * being invented.
 */
export function pendingApprovals(
  status: GenesisSessionStatus,
  events: Record<string, unknown>[],
): GenesisPendingApproval[] {
  const byId = new Map<string, { action: string; risk: string }>();
  for (const raw of events) {
    const id = str(raw.approval_id);
    if (!id) continue;
    const action = asRecord(raw.action);
    byId.set(id, {
      action: str(action?.action, str(raw.action, 'unknown')),
      risk: str(raw.risk, ''),
    });
  }
  return status.pending_approvals.map((id) => ({
    approval_id: id,
    action: byId.get(id)?.action ?? 'unknown',
    risk: byId.get(id)?.risk ?? '',
  }));
}

export function parseOutcome(payload: unknown, taskId: string): GenesisOutcome {
  // The Bridge export endpoint wraps the run result in `task_result`. Accept a
  // bare result too, but never read the wrapper as if it were the result: doing
  // so would report "no effect" for a run that really changed the world.
  const outer = asRecord(payload);
  const record = asRecord(outer?.task_result) ?? outer;
  if (!record) throw new Error('task result is not an object');
  const tests = asRecord(record.tests) ?? {};
  return {
    task_id: str(record.task_id, taskId),
    status: str(record.status, 'unknown'),
    effect_achieved: bool(record.effect_achieved),
    denied_actions: num(record.denied_actions),
    blocked: bool(record.blocked),
    files_created: strList(record.files_created),
    files_modified: strList(record.files_modified),
    files_deleted: strList(record.files_deleted),
    commands: Array.isArray(record.commands_executed)
      ? (record.commands_executed as { command?: string; ok?: boolean }[])
      : [],
    errors: Array.isArray(record.errors)
      ? (record.errors as { kind?: string; error?: string }[])
      : [],
    approvals: Array.isArray(record.approvals)
      ? (record.approvals as { action?: string; decision?: string }[])
      : [],
    review_verdict: str(record.review_verdict, 'skipped'),
    finished_reason: str(record.finished_reason),
    tests_ran: num(tests.ran),
    tests_passed: num(tests.passed),
    tests_verified: bool(tests.verified),
    duration_s: num(record.duration_s),
  };
}

export function parseEvidence(payload: {
  manifest: unknown;
  scorecard: unknown;
  timeline: unknown;
}): GenesisEvidence {
  const manifestRecord = asRecord(payload.manifest) ?? {};
  const changes = Array.isArray(manifestRecord.changes) ? manifestRecord.changes : [];
  const scRecord = asRecord(payload.scorecard) ?? {};
  const scorecard = asRecord(scRecord.scorecard) ?? {};
  const categories = asRecord(scorecard.categories) ?? {};
  const tlRecord = asRecord(payload.timeline) ?? {};
  const out: GenesisEvidence = { manifest: [], scorecard_categories: {}, timeline: [] };
  for (const change of changes) {
    const record = asRecord(change);
    if (record?.path) out.manifest.push({ path: str(record.path), action: str(record.action) });
  }
  for (const [key, value] of Object.entries(categories)) {
    const cat = asRecord(value);
    out.scorecard_categories[key] = str(cat?.status, str(value));
  }
  out.timeline = strList(tlRecord.timeline);
  return out;
}

export async function createSession(
  baseUrl: string,
  options: { workspace: string; mode?: string; approval?: string; interactive?: boolean },
): Promise<GenesisResult<GenesisSession>> {
  return wrap(async () =>
    parseSession(
      await postJson(`${baseUrl}/v1/sessions`, {
        workspace: options.workspace,
        mode: options.mode ?? 'build',
        approval: options.approval ?? 'AUTO_SAFE',
        interactive: options.interactive ?? false,
      }),
    ),
  );
}

export async function submitTask(
  baseUrl: string,
  sessionId: string,
  text: string,
  idempotencyKey = '',
): Promise<GenesisResult<GenesisTaskHandle>> {
  return wrap(async () =>
    parseTaskHandle(
      await postJson(
        `${baseUrl}/v1/sessions/${encodeURIComponent(sessionId)}/tasks`,
        { text, idempotency_key: idempotencyKey },
        30000,
      ),
    ),
  );
}

export async function sessionStatus(
  baseUrl: string,
  sessionId: string,
): Promise<GenesisResult<GenesisSessionStatus>> {
  return wrap(async () =>
    parseSessionStatus(
      await getJson(`${baseUrl}/v1/sessions/${encodeURIComponent(sessionId)}/status`),
    ),
  );
}

export async function sessionEvents(
  baseUrl: string,
  sessionId: string,
  since = 0,
): Promise<GenesisResult<Record<string, unknown>[]>> {
  return wrap(async () => {
    const payload = await getJson(
      `${baseUrl}/v1/sessions/${encodeURIComponent(sessionId)}/events?since=${since}`,
    );
    const record = asRecord(payload);
    const list = Array.isArray(payload) ? payload : record?.events;
    if (!Array.isArray(list)) throw new Error('events payload is not a list');
    return list.map((entry) => (asRecord(entry) ?? { value: entry }) as Record<string, unknown>);
  });
}

export async function decideApproval(
  baseUrl: string,
  sessionId: string,
  approvalId: string,
  decision: 'approve-once' | 'deny',
): Promise<GenesisResult<{ approval_id: string; decision: string }>> {
  return wrap(async () => {
    const payload = await postJson(
      `${baseUrl}/v1/sessions/${encodeURIComponent(sessionId)}/approvals/${encodeURIComponent(approvalId)}`,
      { decision },
    );
    const record = asRecord(payload);
    if (!bool(record?.ok)) throw new Error(str(record?.error, 'approval was not accepted'));
    return { approval_id: str(record?.approval_id, approvalId), decision: str(record?.decision, decision) };
  });
}

export async function cancelTask(
  baseUrl: string,
  sessionId: string,
  taskId: string,
): Promise<GenesisResult<{ task_id: string; status: string }>> {
  return wrap(async () => {
    const payload = await postJson(
      `${baseUrl}/v1/sessions/${encodeURIComponent(sessionId)}/cancel`,
      { task_id: taskId },
    );
    const record = asRecord(payload);
    return { task_id: str(record?.task_id, taskId), status: str(record?.status, 'unknown') };
  });
}

/** Effect truth and evidence for one finished task, read back from the Bridge. */
export async function taskOutcome(
  baseUrl: string,
  sessionId: string,
  taskId: string,
): Promise<GenesisResult<GenesisOutcome>> {
  return wrap(async () =>
    parseOutcome(
      await getJson(
        `${baseUrl}/v1/sessions/${encodeURIComponent(sessionId)}/export?task=${encodeURIComponent(taskId)}&format=json`,
        15000,
      ),
      taskId,
    ),
  );
}

export async function taskEvidence(
  baseUrl: string,
  sessionId: string,
): Promise<GenesisResult<GenesisEvidence>> {
  return wrap(async () =>
    parseEvidence({
      manifest: await getJson(`${baseUrl}/v1/sessions/${encodeURIComponent(sessionId)}/manifest`),
      scorecard: await getJson(`${baseUrl}/v1/sessions/${encodeURIComponent(sessionId)}/scorecard`),
      timeline: await getJson(`${baseUrl}/v1/sessions/${encodeURIComponent(sessionId)}/timeline`),
    }),
  );
}

/** Human summary of what actually happened. Never says "done" for blocked work. */
export function describeOutcome(outcome: GenesisOutcome): string {
  if (outcome.blocked) {
    const kinds = outcome.errors.map((e) => e.kind).filter(Boolean);
    const detail = kinds.length > 0 ? ` (${kinds.join(', ')})` : '';
    return `blocked: ${outcome.denied_actions} action(s) denied, no effect${detail}`;
  }
  if (!outcome.effect_achieved) {
    return `${outcome.status}: no world change recorded`;
  }
  const files = outcome.files_created.length + outcome.files_modified.length + outcome.files_deleted.length;
  return `${outcome.status}: ${files} file(s) changed, ${outcome.commands.length} command(s)`;
}
