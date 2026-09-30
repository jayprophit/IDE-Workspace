import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cancelTask,
  createSession,
  decideApproval,
  describeOutcome,
  parseEvidence,
  parseOutcome,
  parseSession,
  parseSessionStatus,
  parseTaskHandle,
  pendingApprovals,
  sessionEvents,
  sessionStatus,
  submitTask,
  taskEvidence,
  taskOutcome,
} from './genesisBridge';

/**
 * The IDE is not the backend owner, so these tests are about two things only:
 * the client speaks the Bridge's documented /v1 surface, and it never turns a
 * refused or effect-free run into a success. Everything asserted here is a
 * claim the IDE would otherwise be making to a human.
 */

const BASE = 'http://127.0.0.1:8471';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function lastCall(): [string, RequestInit] {
  const call = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  return call;
}

describe('parsers refuse to invent state', () => {
  it('rejects a session payload with no id', () => {
    expect(() => parseSession({ mode: 'build' })).toThrow(/session_id/);
  });

  it('rejects a task payload with no id', () => {
    expect(() => parseTaskHandle({ status: 'QUEUED' })).toThrow(/task_id/);
  });

  it('defaults a session status to unknown rather than optimistic values', () => {
    const st = parseSessionStatus({});
    expect(st.status).toBe('unknown');
    expect(st.interactive).toBe(false);
    expect(st.pending_approvals).toEqual([]);
    expect(st.tasks).toEqual({});
  });

  it('reads effect truth straight from the result', () => {
    const outcome = parseOutcome(
      {
        status: 'COMPLETED',
        effect_achieved: false,
        denied_actions: 1,
        blocked: true,
        errors: [{ kind: 'APPROVAL_DENIED', error: 'denied' }],
        approvals: [{ action: 'write', decision: 'deny' }],
      },
      't-1',
    );
    expect(outcome.task_id).toBe('t-1');
    expect(outcome.blocked).toBe(true);
    expect(outcome.effect_achieved).toBe(false);
    expect(outcome.denied_actions).toBe(1);
  });

  it('reads the effect truth out of the Bridge export wrapper', () => {
    // /export returns {"task_result": {...}}. Reading the wrapper as the
    // result would report "no effect" for a run that changed the world.
    const wrapped = parseOutcome(
      { task_result: { status: 'COMPLETED', effect_achieved: true, files_created: ['a.py'] } },
      't-9',
    );
    expect(wrapped.effect_achieved).toBe(true);
    expect(wrapped.files_created).toEqual(['a.py']);
    // a bare result is still accepted
    const bare = parseOutcome({ status: 'COMPLETED', effect_achieved: true }, 't-10');
    expect(bare.effect_achieved).toBe(true);
  });

  it('treats a missing effect_achieved field as false, never as true', () => {
    // An older or unexpected result must not read as success.
    const outcome = parseOutcome({ status: 'COMPLETED' }, 't-2');
    expect(outcome.effect_achieved).toBe(false);
    expect(outcome.blocked).toBe(false);
  });

  it('parses evidence from three different payload shapes', () => {
    const ev = parseEvidence({
      manifest: { changes: [{ path: 'a.py', action: 'write' }] },
      scorecard: { scorecard: { categories: { correctness: { status: 'pass' } } } },
      timeline: { timeline: ['t0 start', 't1 done'] },
    });
    expect(ev.manifest).toEqual([{ path: 'a.py', action: 'write' }]);
    expect(ev.scorecard_categories).toEqual({ correctness: 'pass' });
    expect(ev.timeline).toHaveLength(2);
  });

  it('survives malformed evidence without throwing', () => {
    const ev = parseEvidence({ manifest: null, scorecard: 7, timeline: 'nope' });
    expect(ev.manifest).toEqual([]);
    expect(ev.timeline).toEqual([]);
  });
});

describe('approval rows come from ids plus real event detail', () => {
  const status = parseSessionStatus({
    session_id: 's-1',
    status: 'WAITING_APPROVAL',
    interactive: true,
    pending_approvals: ['ap-abc'],
  });

  it('joins the approval id to its action and risk', () => {
    const rows = pendingApprovals(status, [
      { event: 'approval.requested', approval_id: 'ap-abc', action: { action: 'write' }, risk: 'RISKY' },
    ]);
    expect(rows).toEqual([{ approval_id: 'ap-abc', action: 'write', risk: 'RISKY' }]);
  });

  it('shows unknown rather than a fabricated action when no event matches', () => {
    const rows = pendingApprovals(status, []);
    expect(rows).toEqual([{ approval_id: 'ap-abc', action: 'unknown', risk: '' }]);
  });
});

describe('client speaks the documented /v1 surface', () => {
  it('creates a session with the approval level and interactivity asked for', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ session_id: 's-1', mode: 'build', approval: 'ASK_ALL_WRITES', interactive: true }),
    );
    const res = await createSession(BASE, {
      workspace: 'C:/ws',
      approval: 'ASK_ALL_WRITES',
      interactive: true,
    });
    expect(res.ok).toBe(true);
    const [url, init] = lastCall();
    expect(url).toBe(`${BASE}/v1/sessions`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toMatchObject({
      workspace: 'C:/ws',
      approval: 'ASK_ALL_WRITES',
      interactive: true,
    });
  });

  it('reports a refused interactive session honestly instead of failing silently', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ok: false, error: 'interactive approvals are not enabled on this runtime' }, 403),
    );
    const res = await createSession(BASE, { workspace: 'C:/ws', interactive: true });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('not enabled');
  });

  it('submits a task to the session', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ task_id: 't-1', status: 'QUEUED', deduped: false }));
    const res = await submitTask(BASE, 's-1', 'read the project');
    expect(res.data?.task_id).toBe('t-1');
    const [url, init] = lastCall();
    expect(url).toBe(`${BASE}/v1/sessions/s-1/tasks`);
    expect(JSON.parse(String(init.body))).toMatchObject({ text: 'read the project' });
  });

  it('encodes ids so a crafted id cannot escape the path', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ tasks: {}, status: 'ok' }));
    await sessionStatus(BASE, 's-1/../../etc');
    const [url] = lastCall();
    expect(url).toBe(`${BASE}/v1/sessions/s-1%2F..%2F..%2Fetc/status`);
  });

  it('posts an approval decision and surfaces a refusal', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, approval_id: 'ap-1', decision: 'deny' }));
    const ok = await decideApproval(BASE, 's-1', 'ap-1', 'deny');
    expect(ok.data).toEqual({ approval_id: 'ap-1', decision: 'deny' });
    expect(JSON.parse(String(lastCall()[1].body))).toEqual({ decision: 'deny' });

    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: false, error: 'unknown approval: ap-9' }, 404));
    const bad = await decideApproval(BASE, 's-1', 'ap-9', 'approve-once');
    expect(bad.ok).toBe(false);
    expect(bad.error).toContain('unknown approval');
  });

  it('treats an approval response without ok as refused', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ approval_id: 'ap-1' }));
    const res = await decideApproval(BASE, 's-1', 'ap-1', 'approve-once');
    expect(res.ok).toBe(false);
  });

  it('cancels a task and reads the task outcome', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ task_id: 't-1', status: 'CANCELLED' }));
    const cancelled = await cancelTask(BASE, 's-1', 't-1');
    expect(cancelled.data?.status).toBe('CANCELLED');

    fetchMock.mockResolvedValueOnce(
      jsonResponse({ task_result: { status: 'COMPLETED', effect_achieved: true } }),
    );
    const outcome = await taskOutcome(BASE, 's-1', 't-1');
    expect(outcome.ok).toBe(true);
    expect(outcome.data?.effect_achieved).toBe(true);
    expect(lastCall()[0]).toContain('/export?task=t-1&format=json');
  });

  it('rejects an events payload that is not a list', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ events: 'nope' }));
    const res = await sessionEvents(BASE, 's-1');
    expect(res.ok).toBe(false);
    expect(res.error).toContain('not a list');
  });

  it('fetches manifest, scorecard and timeline for evidence', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ changes: [{ path: 'a.py', action: 'write' }] }))
      .mockResolvedValueOnce(jsonResponse({ scorecard: { categories: {} } }))
      .mockResolvedValueOnce(jsonResponse({ timeline: [] }));
    const ev = await taskEvidence(BASE, 's-1');
    expect(ev.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe('human summaries never say done for blocked work', () => {
  it('names the denial kinds when a run achieved nothing', () => {
    const blocked = parseOutcome(
      { status: 'COMPLETED', effect_achieved: false, denied_actions: 2, blocked: true,
        errors: [{ kind: 'APPROVAL_DENIED' }, { kind: 'POLICY_DENIED' }] },
      't-1',
    );
    const text = describeOutcome(blocked);
    expect(text).toContain('blocked');
    expect(text).toContain('2 action(s) denied');
    expect(text).toContain('APPROVAL_DENIED');
    expect(text).not.toMatch(/\bdone\b/);
  });

  it('says "no world change" when a run ended with no effect and no denial', () => {
    const none = parseOutcome({ status: 'COMPLETED', effect_achieved: false, denied_actions: 0 }, 't-2');
    expect(describeOutcome(none)).toBe('COMPLETED: no world change recorded');
  });

  it('reports the real change count when there was an effect', () => {
    const ok = parseOutcome(
      { status: 'COMPLETED', effect_achieved: true, files_created: ['a.py'], commands_executed: [{ command: 'pytest', ok: true }] },
      't-3',
    );
    expect(describeOutcome(ok)).toBe('COMPLETED: 1 file(s) changed, 1 command(s)');
  });
});
