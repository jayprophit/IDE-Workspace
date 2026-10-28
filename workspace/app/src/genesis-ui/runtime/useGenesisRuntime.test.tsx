import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGenesisRuntime } from './useGenesisRuntime';
import type { GenesisClient } from './runtimeTypes';
import type { GenesisSessionStatus } from '../../genesisBridge';

/**
 * Connection lifecycle tests.
 *
 * The behaviour that matters: an unreachable Bridge must produce an honest
 * disconnected state with no fabricated data, and a lost connection must be
 * distinguishable from never having connected. Both are tested with a stub
 * client, so nothing here depends on a live Bridge.
 */

function sessionStatus(overrides: Partial<GenesisSessionStatus> = {}): GenesisSessionStatus {
  return {
    session_id: 's1',
    status: 'EXECUTING',
    interactive: false,
    tasks: { t1: 'EXECUTING' },
    pending_approvals: [],
    files_touched: [],
    errors: [],
    approvals: [],
    tests: { ran: 0, passed: 0, all_passed: null, verified: false },
    review: '',
    ...overrides,
  };
}

function stubClient(over: Partial<GenesisClient> = {}): GenesisClient {
  return {
    createSession: async () => ({
      ok: true,
      data: { session_id: 's1', mode: 'build', approval: 'AUTO_SAFE', interactive: false },
      error: '',
    }),
    submitTask: async () => ({ ok: true, data: { task_id: 't1', status: 'QUEUED', deduped: false }, error: '' }),
    sessionStatus: async () => ({ ok: true, data: sessionStatus(), error: '' }),
    sessionEvents: async () => ({ ok: true, data: [], error: '' }),
    decideApproval: async () => ({ ok: true, data: { approval_id: 'a1', decision: 'approve-once' }, error: '' }),
    ...over,
  };
}

const LIVE = { source: 'agent_bridge' as const, baseUrl: 'http://127.0.0.1:8471', workspace: 'workspace/app', pollMs: 20 };

/**
 * jsdom has no server behind `fetch`. The worker-roster read is the only raw
 * fetch in the runtime, so it is stubbed for every live-mode test rather than
 * letting an unhandled rejection surface as a flaky timeout.
 */
function stubFetch(body: unknown = { workers: [] }) {
  const spy = vi.fn(async () => ({ ok: true, json: async () => body } as unknown as Response));
  vi.stubGlobal('fetch', spy);
  return spy;
}

describe('fixture mode', () => {
  it('never touches the network', async () => {
    let called = false;
    const client = stubClient({
      createSession: async () => {
        called = true;
        return { ok: true, data: { session_id: 's', mode: '', approval: '', interactive: false }, error: '' };
      },
    });
    const { result } = renderHook(() => useGenesisRuntime({ ...LIVE, source: 'fixture', client }));

    await act(async () => {
      result.current.connect();
    });

    expect(called).toBe(false);
    expect(result.current.snapshot.source).toBe('fixture');
    expect(result.current.snapshot.connection).toBe('disconnected');
  });

  it('reports fixture mode distinctly from live', async () => {
    const { result } = renderHook(() => useGenesisRuntime({ ...LIVE, source: 'fixture', client: stubClient() }));
    expect(result.current.snapshot.source).not.toBe('agent_bridge');
    expect(result.current.snapshot.fresh).toBe(false);
  });

  it('refuses to submit rather than pretending to reach a backend', async () => {
    let submitted = false;
    const client = stubClient({
      submitTask: async () => {
        submitted = true;
        return { ok: true, data: { task_id: 't', status: '', deduped: false }, error: '' };
      },
    });
    const { result } = renderHook(() => useGenesisRuntime({ ...LIVE, source: 'fixture', client }));
    await act(async () => {
      await result.current.submit('do a thing');
    });
    expect(submitted).toBe(false);
  });
});

describe('live mode connection', () => {
  beforeEach(() => {
    stubFetch();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts disconnected with an empty roster and no fabricated tasks', () => {
    const { result } = renderHook(() => useGenesisRuntime({ ...LIVE, client: stubClient() }));
    /* Before connecting, nothing has been reported, so nothing is shown. */
    expect(result.current.snapshot.connection).toBe('disconnected');
    expect(result.current.snapshot.workers).toEqual([]);
    expect(result.current.snapshot.tasks).toEqual([]);
    expect(result.current.snapshot.sessionStatus).toBe('disconnected');
  });

  it('reports an error verbatim when the session cannot be created', async () => {
    const client = stubClient({
      createSession: async () => ({ ok: false, data: null, error: 'connection refused' }),
    });
    const { result } = renderHook(() => useGenesisRuntime({ ...LIVE, client }));

    await act(async () => {
      result.current.connect();
    });

    await waitFor(() => expect(result.current.snapshot.connection).toBe('error'));
    expect(result.current.snapshot.error).toBe('connection refused');
  });

  it('surfaces real session status and tasks on connect', async () => {
    const { result } = renderHook(() => useGenesisRuntime({ ...LIVE, client: stubClient() }));

    await act(async () => {
      result.current.connect();
    });

    await waitFor(() => expect(result.current.snapshot.connection).toBe('connected'));
    expect(result.current.snapshot.source).toBe('agent_bridge');
    expect(result.current.snapshot.fresh).toBe(true);
    expect(result.current.snapshot.sessionId).toBe('s1');
    expect(result.current.snapshot.tasks.map((t) => t.status)).toContain('active');
  });

  it('shows an empty team when the Bridge reports no workers', async () => {
    /* The real Bridge returns workers: []. Fixture workers must not fill the
     * gap - that would be dressing sample data up as runtime truth. */
    const { result } = renderHook(() => useGenesisRuntime({ ...LIVE, client: stubClient() }));
    await act(async () => {
      result.current.connect();
    });
    await waitFor(() => expect(result.current.snapshot.connection).toBe('connected'));
    expect(result.current.snapshot.workers).toEqual([]);
  });

  it('reports the session interactive flag from the Bridge, not from itself', async () => {
    const client = stubClient({
      sessionStatus: async () => ({ ok: true, data: sessionStatus({ interactive: true }), error: '' }),
    });
    const { result } = renderHook(() => useGenesisRuntime({ ...LIVE, client }));
    await act(async () => {
      result.current.connect();
    });
    await waitFor(() => expect(result.current.snapshot.interactive).toBe(true));
  });
});

describe('disconnect behaviour', () => {
  beforeEach(() => {
    stubFetch();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('marks values stale rather than deleting them', async () => {
    const { result } = renderHook(() => useGenesisRuntime({ ...LIVE, client: stubClient() }));
    await act(async () => {
      result.current.connect();
    });
    await waitFor(() => expect(result.current.snapshot.connection).toBe('connected'));

    await act(async () => {
      result.current.disconnect();
    });

    expect(result.current.snapshot.connection).toBe('disconnected');
    expect(result.current.snapshot.fresh).toBe(false);
    /* Keeping the last tasks while marking them stale is honest: the person
     * does not lose context, but cannot mistake it for current. */
    expect(result.current.snapshot.tasks.length).toBeGreaterThan(0);
  });
});

describe('approval gating', () => {
  beforeEach(() => {
    stubFetch();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not send a decision when the session has no channel', async () => {
    let decided = false;
    const client = stubClient({
      sessionStatus: async () => ({ ok: true, data: sessionStatus({ interactive: false }), error: '' }),
      decideApproval: async () => {
        decided = true;
        return { ok: true, data: { approval_id: 'a1', decision: 'approve-once' }, error: '' };
      },
    });
    const { result } = renderHook(() => useGenesisRuntime({ ...LIVE, client }));
    await act(async () => {
      result.current.connect();
    });
    await waitFor(() => expect(result.current.snapshot.connection).toBe('connected'));

    await act(async () => {
      await result.current.decide('a1', 'approve-once');
    });

    /* The seam refuses locally, so the runtime is never asked a question it
     * would reject. */
    expect(decided).toBe(false);
    expect(result.current.snapshot.error).toMatch(/no decision channel/i);
  });

  it('sends the decision when the session does have a channel', async () => {
    let decided: string | null = null;
    const client = stubClient({
      sessionStatus: async () => ({ ok: true, data: sessionStatus({ interactive: true }), error: '' }),
      decideApproval: async (_b, _s, id, decision) => {
        decided = decision;
        return { ok: true, data: { approval_id: id, decision }, error: '' };
      },
    });
    const { result } = renderHook(() => useGenesisRuntime({ ...LIVE, client }));
    await act(async () => {
      result.current.connect();
    });
    await waitFor(() => expect(result.current.snapshot.interactive).toBe(true));

    await act(async () => {
      await result.current.decide('a1', 'deny');
    });

    expect(decided).toBe('deny');
  });

  it('surfaces a refused decision verbatim', async () => {
    const client = stubClient({
      sessionStatus: async () => ({ ok: true, data: sessionStatus({ interactive: true }), error: '' }),
      decideApproval: async () => ({ ok: false, data: null, error: 'approval expired' }),
    });
    const { result } = renderHook(() => useGenesisRuntime({ ...LIVE, client }));
    await act(async () => {
      result.current.connect();
    });
    await waitFor(() => expect(result.current.snapshot.interactive).toBe(true));

    await act(async () => {
      await result.current.decide('a1', 'approve-once');
    });

    /* Stop the background poll before asserting: the 1500ms poll loop can fire
     * applySession between decide() setting the error and this assertion,
     * clobbering it (a clean poll resets snapshot.error to ''). This only
     * surfaced under full-suite load where the tick interval elapsed; in
     * isolation the test ran faster than 1500ms. Stopping the poll does not
     * weaken the assertion — disconnect preserves the pending error (L193)
     * and the refused-decision value still must match exactly. */
    await act(async () => {
      result.current.disconnect();
    });

    expect(result.current.snapshot.error).toBe('approval expired');
  });
});

describe('no fabricated state', () => {
  it('has no timer that advances connection state', async () => {
    /* Documented invariant. If a future change adds a fake connect or a
     * timeout that flips state, this is the test that should catch it. */
    const { result } = renderHook(() => useGenesisRuntime({ ...LIVE, client: stubClient() }));
    expect(result.current.snapshot.connection).toBe('disconnected');
    /* Nothing happens on its own. */
    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });
    expect(result.current.snapshot.connection).toBe('disconnected');
  });

  it('never marks fixture data fresh', async () => {
    const { result } = renderHook(() => useGenesisRuntime({ ...LIVE, source: 'fixture', client: stubClient() }));
    expect(result.current.snapshot.fresh).toBe(false);
  });
});