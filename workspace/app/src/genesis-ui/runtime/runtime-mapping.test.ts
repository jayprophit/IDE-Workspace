import { describe, expect, it } from 'vitest';
import {
  FIXTURE_SNAPSHOT,
  mapApprovals,
  mapEventToMessage,
  mapTaskStatus,
  mapTasks,
  mapWorkerStatus,
  mapWorkers,
  type GenesisClient,
} from './runtimeTypes';
import type { GenesisSessionStatus } from '../../genesisBridge';

/**
 * Runtime mapping tests.
 *
 * These cover the translation layer between the Bridge's vocabulary and the
 * UI's. The property under test throughout is that an unrecognised or absent
 * value produces an explicitly unconfident UI state — never a confident wrong
 * one.
 */

function status(overrides: Partial<GenesisSessionStatus> = {}): GenesisSessionStatus {
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

describe('task mapping', () => {
  it('maps every status the Bridge documents', () => {
    expect(mapTaskStatus('COMPLETED')).toBe('done');
    expect(mapTaskStatus('EXECUTING')).toBe('active');
    expect(mapTaskStatus('PLANNING')).toBe('active');
    expect(mapTaskStatus('TESTING')).toBe('active');
    expect(mapTaskStatus('WAITING_APPROVAL')).toBe('review');
    expect(mapTaskStatus('FAILED')).toBe('blocked');
    expect(mapTaskStatus('QUEUED')).toBe('todo');
  });

  it('treats an unknown status as queued, never as progress', () => {
    /* The failure this prevents: a status string the UI has never seen
     * defaulting to "active", which would show work that is not happening. */
    expect(mapTaskStatus('WAT')).toBe('todo');
    expect(mapTaskStatus('')).toBe('todo');
    expect(mapTaskStatus('SOMETHING_NEW')).toBe('todo');
  });

  it('maps a session status to task rows', () => {
    const rows = mapTasks(status({ tasks: { a: 'COMPLETED', b: 'EXECUTING', c: 'Mystery' } }));
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.id === 'a')?.status).toBe('done');
    expect(rows.find((r) => r.id === 'b')?.status).toBe('active');
    expect(rows.find((r) => r.id === 'c')?.status).toBe('todo');
  });

  it('produces no rows for a session with no tasks', () => {
    expect(mapTasks(status({ tasks: {} }))).toEqual([]);
  });
});

describe('approval mapping', () => {
  const events = [{ approval_id: 'a1', action: { action: 'write_file' }, risk: 'low' }];

  it('marks approvals undecidable when the session is not interactive', () => {
    const rows = mapApprovals(status({ interactive: false, pending_approvals: ['a1'] }), events);
    expect(rows).toHaveLength(1);
    expect(rows[0].decidable).toBe(false);
  });

  it('marks approvals decidable only when the Bridge says interactive', () => {
    const rows = mapApprovals(status({ interactive: true, pending_approvals: ['a1'] }), events);
    expect(rows[0].decidable).toBe(true);
  });

  it('reports unknown action/risk rather than inventing them', () => {
    const rows = mapApprovals(status({ pending_approvals: ['ghost'] }), []);
    expect(rows[0].action).toBe('unknown');
    expect(rows[0].risk).toBe('');
  });

  it('never fabricates an approval the Bridge did not report', () => {
    const rows = mapApprovals(status({ pending_approvals: [] }), events);
    expect(rows).toEqual([]);
  });
});

describe('worker mapping', () => {
  it('returns nothing when the Bridge reports no workers', () => {
    /* The Bridge currently returns workers: [] on every /v1/runtime. This is
     * the case that matters: it must produce an empty roster, not the fixture
     * roster dressed up as runtime state. */
    expect(mapWorkers({ workers: [] })).toEqual([]);
    expect(mapWorkers({})).toEqual([]);
    expect(mapWorkers(null)).toEqual([]);
  });

  it('maps real worker entries when the Bridge supplies them', () => {
    const rows = mapWorkers({
      workers: [
        { worker_id: 'w1', name: 'Atlas', role_id: 'lead', state: 'BUSY', current_task: 'coordinating' },
        { worker: 'w2', state: 'IDLE' },
      ],
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: 'w1', name: 'Atlas', role: 'lead', status: 'active', currentTask: 'coordinating' });
    expect(rows[1]).toMatchObject({ id: 'w2', name: 'w2', status: 'idle' });
  });

  it('leaves avatarId empty rather than borrowing a fixture face', () => {
    /* There is no avatar_profile_id anywhere in the Bridge. Mapping an
     * unmapped worker onto a fixture avatar would be a fabricated identity. */
    const rows = mapWorkers({ workers: [{ worker_id: 'w1' }] });
    expect(rows[0].avatarId).toBe('');
  });

  it('skips entries with no usable identity', () => {
    expect(mapWorkers({ workers: [{ state: 'BUSY' }, 'nope', null] })).toEqual([]);
  });

  it('maps only recognised worker states', () => {
    expect(mapWorkerStatus('BUSY')).toBe('active');
    expect(mapWorkerStatus('REVIEWING')).toBe('reviewing');
    expect(mapWorkerStatus('OFFLINE')).toBe('offline');
    expect(mapWorkerStatus('SOMETHING_ELSE')).toBe('idle');
  });
});

describe('event to message mapping', () => {
  it('reports runtime lifecycle events verbatim', () => {
    expect(mapEventToMessage({ kind: 'task.started', timestamp: '10:00:00' })?.body).toBe('Task accepted by the runtime.');
    expect(mapEventToMessage({ kind: 'task.failed', timestamp: '10:00:00' })?.body).toBe('Task failed.');
  });

  it('never claims success for a task that has not completed', () => {
    /* The specific fabrication this must prevent: an optimistic "opened the
     * project" line on task.started. */
    const started = mapEventToMessage({ kind: 'task.started' });
    expect(started?.body).not.toMatch(/opened|completed|done/i);
  });

  it('ignores event kinds it does not recognise', () => {
    expect(mapEventToMessage({ kind: 'mystery.event' })).toBeNull();
    expect(mapEventToMessage({})).toBeNull();
  });

  it('produces stable ids so React does not remount rows', () => {
    const a = mapEventToMessage({ kind: 'task.started', timestamp: '10:00:00' });
    const b = mapEventToMessage({ kind: 'task.started', timestamp: '10:00:00' });
    expect(a?.id).toBe(b?.id);
  });

  it('attributes runtime events to the runtime, never to an avatar', () => {
    /* Runtime events are not the avatar speaking. There is no speech
     * synthesis anywhere in this module. */
    expect(mapEventToMessage({ kind: 'task.started' })?.authorName).toBe('Runtime');
  });
});

describe('fixture snapshot', () => {
  it('is explicitly not live', () => {
    expect(FIXTURE_SNAPSHOT.source).toBe('fixture');
    expect(FIXTURE_SNAPSHOT.connection).toBe('disconnected');
    expect(FIXTURE_SNAPSHOT.fresh).toBe(false);
  });

  it('claims no interactive approval channel', () => {
    /* Fixture data must never unlock decision controls. */
    expect(FIXTURE_SNAPSHOT.interactive).toBe(false);
  });

  it('never pre-populates an approval', () => {
    expect(FIXTURE_SNAPSHOT.approvals).toEqual([]);
  });
});

describe('client injection', () => {
  it('exposes a GenesisClient surface a test can replace entirely', () => {
    /* Every bridge call in this module goes through this shape, which is what
     * makes the runtime testable without a live Bridge. */
    const stub: GenesisClient = {
      createSession: async () => ({ ok: true, data: { session_id: 's', mode: 'build', approval: 'AUTO_SAFE', interactive: false }, error: '' }),
      submitTask: async () => ({ ok: true, data: { task_id: 't', status: 'QUEUED', deduped: false }, error: '' }),
      sessionStatus: async () => ({ ok: true, data: status(), error: '' }),
      sessionEvents: async () => ({ ok: true, data: [], error: '' }),
      decideApproval: async () => ({ ok: true, data: { approval_id: 'a', decision: 'approve-once' }, error: '' }),
    };
    expect(Object.keys(stub).sort()).toEqual([
      'createSession',
      'decideApproval',
      'sessionEvents',
      'sessionStatus',
      'submitTask',
    ]);
  });
});