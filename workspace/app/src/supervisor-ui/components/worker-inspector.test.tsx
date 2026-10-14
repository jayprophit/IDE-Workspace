import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SourceFact, WorkerContinueResult, WorkerDetail } from '../api/types';
import { WorkerInspector, fieldsFromDetail } from './worker-inspector';
import { readRoster, type TeamMember } from './roster-types';

/**
 * §5.A WorkerInspector regression suite.
 *
 * The load-bearing rule under test: an ABSENT field and an OBSERVED-EMPTY field
 * are different facts and must render differently.
 *
 * The live worker record is mostly empty — the runtime sends "" for project,
 * model, provider, write_set, task_description and next_action, and []/{} for
 * files_changed, tests and blockers. Rendering those as "0 files changed" or a
 * blank cell would be a fabrication: the runtime never reported a count of
 * zero, it reported nothing at all. So:
 *
 *   absent  -> NOT_EXPOSED chip
 *   empty   -> "none reported"   (observed zero)
 *   value   -> the value
 *
 * These tests exist to make collapsing those three into two impossible.
 */

vi.mock('../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/client')>()),
  fetchWorkerDetail: vi.fn(),
  continueWorker: vi.fn(),
}));

const client = await import('../api/client');
const mockedDetail = vi.mocked(client.fetchWorkerDetail);
const mockedContinue = vi.mocked(client.continueWorker);

const WORKER: TeamMember = {
  worker_id: 'codex-primary',
  application: 'codex',
  role: 'mat-worker',
  status: 'WAITING_FOR_QUOTA',
  task_description: '',
  project: '',
  model: '',
  quota_state: { pool: 'five_hour', reset_at: null, resets_in_s: null },
};

const supervision = {
  workers: {
    value: [WORKER],
    state: 'LIVE_VERIFIED',
    source: 'test',
    observed_at: '',
    age_s: 0,
    note: '',
  } as SourceFact,
} as Record<string, unknown>;

/** Shaped exactly like the live worker-detail response. */
const REAL_DETAIL = {
  ok: true,
  worker_id: 'codex-primary',
  application: 'codex',
  role: 'mat-worker',
  verdict: 'WAITING_FOR_QUOTA',
  evidence: ['usage_limit_exceeded; resets None'],
  quota: { pool: 'five_hour', reset_at: null, resets_in_s: null },
  current_task: { task: '', evidence: [] },
  record: {
    worker_id: 'codex-primary',
    worker_type: 'EXTERNAL_AI_AGENT',
    application: 'codex',
    role: 'mat-worker',
    status: 'WAITING_FOR_QUOTA',
    project: '',
    task_id: '',
    task_description: '',
    repo: '',
    worktree: '',
    branch: '',
    write_set: '',
    model: '',
    provider: '',
    tier: '',
    phase: '',
    started_at: 0.0,
    last_heartbeat: 1792010444.83,
    last_activity: 1792010444.83,
    files_changed: [],
    tests: {},
    latest_commit: '',
    latest_push: '',
    blockers: [],
    handoff_state: '',
    review_state: '',
    next_action: '',
    quota_state: { pool: 'five_hour', reset_at: null, resets_in_s: null },
  },
} as unknown as WorkerDetail;

describe('WorkerInspector (§5.A)', () => {
  beforeEach(() => {
    mockedDetail.mockReset();
    mockedContinue.mockReset();
    mockedDetail.mockResolvedValue(REAL_DETAIL);
  });
  afterEach(cleanup);

  it('renders nothing when no worker is selected', () => {
    const { container } = render(<WorkerInspector workerId={null} onClose={() => {}} />);
    expect(container.querySelector('[data-testid="worker-inspector"]')).toBeNull();
    expect(mockedDetail).not.toHaveBeenCalled();
  });

  it('renders an empty field as NOT_EXPOSED, never as a blank or a dash', async () => {
    render(<WorkerInspector workerId="codex-primary" supervision={supervision} onClose={() => {}} />);
    await screen.findByTestId('inspector-rows');
    // `project` is "" in the live record.
    expect(screen.getByTestId('inspector-absent-project')).toBeTruthy();
    expect(screen.queryByTestId('inspector-value-project')).toBeNull();
    expect(screen.queryByTestId('inspector-empty-project')).toBeNull();
  });

  it('renders an observed-EMPTY collection as "none reported", not as NOT_EXPOSED', async () => {
    render(<WorkerInspector workerId="codex-primary" supervision={supervision} onClose={() => {}} />);
    await screen.findByTestId('inspector-rows');
    // files_changed is [] — the backend reported a collection and it was empty.
    expect(screen.getByTestId('inspector-empty-files_changed').textContent).toBe('none reported');
    expect(screen.queryByTestId('inspector-absent-files_changed')).toBeNull();
  });

  it('keeps "none reported" and NOT_EXPOSED distinct across the whole record', async () => {
    render(<WorkerInspector workerId="codex-primary" supervision={supervision} onClose={() => {}} />);
    await screen.findByTestId('inspector-rows');
    // "" -> absent
    expect(screen.getByTestId('inspector-absent-model')).toBeTruthy();
    expect(screen.getByTestId('inspector-absent-branch')).toBeTruthy();
    // [] or {} -> empty
    expect(screen.getByTestId('inspector-empty-blockers')).toBeTruthy();
    expect(screen.getByTestId('inspector-empty-tests')).toBeTruthy();
  });

  it('renders a REAL value verbatim', async () => {
    render(<WorkerInspector workerId="codex-primary" supervision={supervision} onClose={() => {}} />);
    await screen.findByTestId('inspector-rows');
    expect(screen.getByTestId('inspector-value-quota_pool').textContent).toBe('five_hour');
    expect(screen.getByTestId('inspector-value-worker_type').textContent).toBe('EXTERNAL_AI_AGENT');
    expect(screen.getByTestId('inspector-value-evidence').textContent).toContain('usage_limit_exceeded');
  });

  it('never fabricates a count of zero for an unreported field', async () => {
    render(<WorkerInspector workerId="codex-primary" supervision={supervision} onClose={() => {}} />);
    await screen.findByTestId('inspector-rows');
    // The inspector must not claim "0 files changed".
    expect(document.body.textContent).not.toMatch(/0 files changed/i);
    expect(document.body.textContent).not.toMatch(/\b0 tests\b/i);
  });

  it('covers every §5.A field group the record can answer', async () => {
    render(<WorkerInspector workerId="codex-primary" supervision={supervision} onClose={() => {}} />);
    await screen.findByTestId('inspector-rows');
    for (const key of [
      'application', 'role', 'status', 'model', 'provider', 'plan',
      'quota_pool', 'quota_reset', 'project', 'task', 'milestone',
      'write_ownership', 'files_changed', 'tests', 'git_latest_commit',
      'git_latest_push', 'handoffs', 'blockers', 'next_action', 'evidence',
    ]) {
      const row = screen.queryByTestId(`inspector-row-${key}`);
      expect(row, `missing §5.A field: ${key}`).toBeTruthy();
    }
  });

  it('shows identity from the same roster fact the rest of the UI reads', async () => {
    render(<WorkerInspector workerId="codex-primary" supervision={supervision} onClose={() => {}} />);
    expect(screen.getByTestId('inspector-worker-id').textContent).toBe('codex-primary');
    expect(screen.getByTestId('inspector-status').textContent).toBe('WAITING_FOR_QUOTA');
    expect(screen.getByTestId('inspector-avatar-codex-primary')).toBeTruthy();
  });

  it('reports an unreachable detail route instead of an empty inspector', async () => {
    mockedDetail.mockResolvedValue({
      ok: false, worker_id: 'codex-primary', error_code: 'UNREACHABLE', evidence: [],
    } satisfies WorkerDetail);
    render(<WorkerInspector workerId="codex-primary" supervision={supervision} onClose={() => {}} />);
    const el = await screen.findByTestId('inspector-unreachable');
    expect(el.textContent).toContain('UNREACHABLE');
  });

  it('reports continue exactly as the adapter did — never optimistically', async () => {
    const user = userEvent.setup();
    mockedContinue.mockResolvedValue({
      ok: true, worker_id: 'codex-primary', delivered: false, evidence: [], error_code: 'ADAPTER_UNAVAILABLE',
    } satisfies WorkerContinueResult);
    render(<WorkerInspector workerId="codex-primary" supervision={supervision} onClose={() => {}} />);
    await user.click(screen.getByTestId('inspector-continue'));
    await waitFor(() => {
      expect(screen.getByTestId('inspector-continue-note').textContent).toContain('NOT delivered');
    });
  });

  it('confirms a delivered continue with the real channel name', async () => {
    const user = userEvent.setup();
    mockedContinue.mockResolvedValue({
      ok: true, worker_id: 'codex-primary', delivered: true, channel: 'codex-api', evidence: [],
    } satisfies WorkerContinueResult);
    render(<WorkerInspector workerId="codex-primary" supervision={supervision} onClose={() => {}} />);
    await user.click(screen.getByTestId('inspector-continue'));
    await waitFor(() => {
      expect(screen.getByTestId('inspector-continue-note').textContent).toContain('delivered via codex-api');
    });
  });

  it('fires exactly one detail request per selected worker', async () => {
    const { rerender } = render(<WorkerInspector workerId="codex-primary" supervision={supervision} onClose={() => {}} />);
    await screen.findByTestId('inspector-rows');
    rerender(<WorkerInspector workerId="codex-primary" supervision={supervision} onClose={() => {}} />);
    await waitFor(() => expect(mockedDetail).toHaveBeenCalledTimes(1));
  });

  it('closes on request', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<WorkerInspector workerId="codex-primary" supervision={supervision} onClose={onClose} />);
    await user.click(screen.getByTestId('inspector-close'));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('field classification (pure)', () => {
  it('classifies the three states correctly', () => {
    const rows = fieldsFromDetail(REAL_DETAIL);
    const by = (k: string) => rows.find((r) => r.key === k);
    expect(by('model')?.sourced).toBe('absent');       // ""
    expect(by('files_changed')?.sourced).toBe('empty'); // []
    expect(by('worker_type')?.sourced).toBe('live');    // real string
  });

  it('treats a null detail as all-absent rather than throwing', () => {
    const rows = fieldsFromDetail(null);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.sourced === 'absent')).toBe(true);
  });

  it('reads the roster through the single shared fact reader', () => {
    expect(readRoster(supervision)?.[0]?.worker_id).toBe('codex-primary');
    expect(readRoster(undefined)).toBeNull();
  });
});