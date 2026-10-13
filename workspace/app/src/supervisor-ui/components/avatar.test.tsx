import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SourceFact, WorkerContinueResult, WorkerDetail } from '../api/types';
import {
  AVATAR_SIZES,
  WorkerAvatar,
  glyphForRole,
  hashWorkerId,
  hueForWorker,
  initialsFor,
  stateForStatus,
} from './avatar';
import { DEFERRED_ACTIONS, LIVE_ACTIONS, WORKER_ACTIONS, WorkerCard } from './worker-card';
import { TeamRoom } from './team-room';
import { readRoster, type TeamMember } from './roster-types';

/**
 * M2-A regression suite: avatars, worker cards, team room.
 *
 * Every assertion here is an honesty law made executable. If one of these has
 * to be relaxed to make a UI change pass, the honesty law moved - which should
 * be a deliberate, reviewed decision, not an accident.
 */

const nowIso = () => new Date().toISOString();

function fact<T>(value: T, state: SourceFact['state'] = 'LIVE'): SourceFact {
  return { value, state, source: 'test', observed_at: nowIso(), age_s: 0, note: '' };
}

/** Transcribed from a REAL roster cycle, including the empty strings. */
const REAL_WORKERS: TeamMember[] = [
  {
    worker_id: 'opencode-primary',
    application: 'IDE',
    role: 'ide-worker',
    worker_type: 'primary',
    status: 'IMPLEMENTING',
    task_description: '',
    project: '',
    model: '',
    provider: 'opencode',
    write_set: 'workspace/app/src',
    quota_state: {},
    last_heartbeat: 1_700_000_000,
    review_state: '',
    next_action: '',
  },
  {
    worker_id: 'codex-primary',
    application: 'MAT',
    role: 'mat-worker',
    worker_type: 'primary',
    status: 'WAITING_FOR_QUOTA',
    task_description: '',
    project: '',
    model: '',
    provider: 'openai',
    write_set: '',
    quota_state: { pool: 'codex-pool', reset_at: '2026-02-11T15:04:05Z', resets_in_s: 245 },
    last_heartbeat: 1_700_000_000,
  },
  {
    worker_id: 'ollama-local',
    application: 'IDE',
    role: 'local-worker',
    worker_type: 'local',
    status: 'IMPLEMENTING',
    task_description: '',
    project: '',
    model: 'llama3.1',
    provider: 'ollama',
    write_set: '',
    quota_state: {},
  },
];

const section = (workers: TeamMember[] | undefined) => ({
  workers_total: fact(workers ? workers.length : 0),
  workers: workers ? fact(workers) : undefined,
}) as Record<string, unknown>;

/* ---------------------------------------------------------------------------
 * Determinism (AV-1)
 * ------------------------------------------------------------------------ */

describe('avatar determinism', () => {
  it('hashes the same worker_id to the same value every time', () => {
    expect(hashWorkerId('codex-primary')).toBe(hashWorkerId('codex-primary'));
  });

  it('gives different workers different hues', () => {
    const hues = REAL_WORKERS.map((w) => hueForWorker(w.worker_id));
    expect(new Set(hues).size).toBe(hues.length);
  });

  it('keeps every hue inside 0-359 so the CSS hsl() is always valid', () => {
    for (const id of ['a', 'opencode-primary', 'codex-primary', 'ollama-local', 'zzz-worker-9999', '']) {
      const h = hueForWorker(id);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(360);
    }
  });

  it('prefers the first and last segment for initials', () => {
    // "codex-primary" must not read as just "P", and must not collapse to CO.
    expect(initialsFor('codex-primary')).toBe('CP');
    expect(initialsFor('ollama-local')).toBe('OL');
    expect(initialsFor('opencode-primary')).toBe('OP');
  });

  it('handles single-segment and empty ids without throwing', () => {
    expect(initialsFor('primary')).toBe('PR');
    expect(initialsFor('hermes')).toBe('HE');
    expect(initialsFor('')).toBe('??');
  });
});

/* ---------------------------------------------------------------------------
 * Role glyphs + honest status mapping (AV-3, AV-8)
 * ------------------------------------------------------------------------ */

describe('avatar role glyphs and state mapping', () => {
  it('maps each real role to a distinct glyph', () => {
    expect(glyphForRole('ide-worker')).toBe('⚒');
    expect(glyphForRole('mat-worker')).toBe('⌕');
    expect(glyphForRole('local-worker')).toBe('▤');
  });

  it('falls back rather than guessing an unknown role', () => {
    expect(glyphForRole('wat')).toBe('◇');
    expect(glyphForRole(undefined)).toBe('◇');
  });

  it('never maps an unrecognised status to a healthy state', () => {
    // The critical honesty case: unknown in, UNKNOWN out - never LIVE_VERIFIED.
    expect(stateForStatus('TOTALLY_MADE_UP')).toBe('UNKNOWN');
    expect(stateForStatus('')).toBe('UNKNOWN');
    expect(stateForStatus(undefined)).toBe('UNKNOWN');
  });

  it('maps the real observed statuses', () => {
    expect(stateForStatus('IMPLEMENTING')).toBe('LIVE_VERIFIED');
    expect(stateForStatus('WAITING_FOR_QUOTA')).toBe('STALE');
    expect(stateForStatus('BLOCKED')).toBe('DEGRADED');
    expect(stateForStatus('OFFLINE')).toBe('OFFLINE');
  });
});

/* ---------------------------------------------------------------------------
 * Avatar component (AV-1..AV-4)
 * ------------------------------------------------------------------------ */

describe('WorkerAvatar', () => {
  it('exposes the spec pixel sizes', () => {
    expect(AVATAR_SIZES).toEqual({ sm: 32, md: 48, lg: 96, xl: 160 });
  });

  it('labels itself "<worker_id> — <role>" for screen readers', () => {
    render(<WorkerAvatar workerId="codex-primary" role="mat-worker" status="IMPLEMENTING" />);
    const img = screen.getByRole('img', { name: 'codex-primary — mat-worker' });
    expect(img).toBeTruthy();
  });

  it('keeps the role glyph out of the accessible name', () => {
    const { container } = render(<WorkerAvatar workerId="ollama-local" role="local-worker" />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('aria-hidden')).not.toBe(null);
    expect(svg?.getAttribute('focusable')).toBe('false');
  });

  it('renders at the requested size', () => {
    render(<WorkerAvatar workerId="ollama-local" role="local-worker" size="xl" />);
    const img = screen.getByRole('img');
    expect(img.style.width).toBe('160px');
  });

  it('passes only a hue NUMBER into inline style, never a colour', () => {
    const { container } = render(<WorkerAvatar workerId="ollama-local" role="local-worker" />);
    const el = container.querySelector('.sv-avatar') as HTMLElement;
    expect(el.style.getPropertyValue('--avatar-h')).toMatch(/^\d+$/);
  });
});

/* ---------------------------------------------------------------------------
 * Worker card (AV-5..AV-7, §7)
 * ------------------------------------------------------------------------ */

describe('WorkerCard', () => {
  const worker = REAL_WORKERS[1]; // codex-primary, WAITING_FOR_QUOTA

  it('uses an avatar of at least the lg size (96px)', () => {
    const { container } = render(<WorkerCard worker={worker} />);
    const avatar = container.querySelector('.sv-avatar') as HTMLElement;
    expect(parseInt(avatar.style.width, 10)).toBeGreaterThanOrEqual(96);
  });

  it('shows name, role and status', () => {
    render(<WorkerCard worker={worker} />);
    expect(screen.getByTestId('wc-name-codex-primary').textContent).toBe('codex-primary');
    expect(screen.getByTestId('wc-role-codex-primary').textContent).toBe('mat-worker');
    expect(screen.getByTestId('wc-status-codex-primary').textContent).toBe('WAITING_FOR_QUOTA');
  });

  it('shows quota and reset when the worker is waiting for quota', () => {
    render(<WorkerCard worker={worker} />);
    const q = screen.getByTestId('wc-quota-codex-primary');
    expect(q.textContent).toContain('waiting for quota');
    expect(screen.getByTestId('wc-quota-reset-codex-primary').textContent).toContain('2026-02-11T15:04:05Z');
  });

  it('does NOT show a quota block for a worker that is not quota-blocked', () => {
    render(<WorkerCard worker={REAL_WORKERS[0]} />);
    expect(screen.queryByTestId('wc-quota-opencode-primary')).toBeNull();
  });

  it('renders an empty backend field as "not reported", never as blank', () => {
    render(<WorkerCard worker={REAL_WORKERS[0]} />);
    // project / model / task_description are "" in the real roster.
    expect(screen.getByTestId('wc-project-opencode-primary').textContent).toBe('not reported');
    expect(screen.getByTestId('wc-model-opencode-primary').textContent).toBe('not reported');
    expect(screen.getByTestId('wc-task-opencode-primary').textContent).toBe('not reported');
  });

  it('renders a real value verbatim', () => {
    render(<WorkerCard worker={REAL_WORKERS[2]} />);
    expect(screen.getByTestId('wc-model-ollama-local').textContent).toBe('llama3.1');
    expect(screen.getByTestId('wc-provider-ollama-local').textContent).toBe('ollama');
  });

  it('never fabricates a value for a missing worker_id field', () => {
    render(<WorkerCard worker={{ worker_id: 'ghost' } as TeamMember} />);
    expect(screen.getByTestId('wc-status-ghost').textContent).toBe('status not reported');
    expect(screen.getByTestId('wc-role-ghost').textContent).toBe('role not reported');
    expect(screen.getByTestId('wc-heartbeat-ghost').textContent).toBe('not reported');
  });

  it('escalates an unknown status to a visible UNKNOWN state', () => {
    const { container } = render(<WorkerCard worker={{ worker_id: 'x', status: 'MADE_UP' } as TeamMember} />);
    expect(container.querySelector('.sv-worker-card')?.getAttribute('data-state')).toBe('UNKNOWN');
  });

  it('shows a state dot alongside the avatar', () => {
    const { container } = render(<WorkerCard worker={worker} />);
    expect(container.querySelector('.sv-worker-card__dot')).toBeTruthy();
  });
});

/* ---------------------------------------------------------------------------
 * Actions (§5, §15) - LIVE vs DEFERRED
 * ------------------------------------------------------------------------ */

describe('worker actions', () => {
  it('offers all eleven worker actions', () => {
    expect(WORKER_ACTIONS).toHaveLength(11);
  });

  it('marks only the actions with a real path LIVE', () => {
    // click is client-side selection; inspect and continue are the two real
    // endpoints in api/client.ts. Nothing else may claim to be live.
    expect(LIVE_ACTIONS).toEqual(['click', 'inspect', 'continue']);
  });

  it('marks the remaining eight actions DEFERRED with a stated reason', () => {
    expect(DEFERRED_ACTIONS).toHaveLength(8);
    for (const def of WORKER_ACTIONS.filter((a) => !a.live)) {
      expect(def.reason, `${def.id} needs a reason`).toBeTruthy();
    }
  });

  it('renders deferred actions disabled, so the gap is visible before a click', () => {
    const { container } = render(<WorkerCard worker={REAL_WORKERS[0]} />);
    const talk = container.querySelector('[data-testid="wc-action-talk-opencode-primary"]') as HTMLButtonElement;
    expect(talk.disabled).toBe(true);
    expect(talk.getAttribute('data-capability')).toBe('deferred');
    // The reason is on the control itself, not hidden until after a click.
    expect(talk.textContent).toContain('Talk');
    expect(talk.getAttribute('title')).toContain('not exposed');
  });

  it('leaves the live actions enabled', () => {
    render(<WorkerCard worker={REAL_WORKERS[0]} />);
    expect((screen.getByTestId('wc-action-inspect-opencode-primary') as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByTestId('wc-action-continue-opencode-primary') as HTMLButtonElement).disabled).toBe(false);
  });

  it('disables even live actions while one is in flight', () => {
    render(<WorkerCard worker={REAL_WORKERS[0]} busy />);
    expect((screen.getByTestId('wc-action-inspect-opencode-primary') as HTMLButtonElement).disabled).toBe(true);
  });

  it('reports the action a person actually clicked', async () => {
    const onAction = vi.fn();
    const user = userEvent.setup();
    render(<WorkerCard worker={REAL_WORKERS[0]} onAction={onAction} />);
    await user.click(screen.getByTestId('wc-action-inspect-opencode-primary'));
    expect(onAction).toHaveBeenCalledWith(REAL_WORKERS[0], 'inspect');
  });
});

/* ---------------------------------------------------------------------------
 * Team room (§7) - one source, honest states, filters
 * ------------------------------------------------------------------------ */

const client = await import('../api/client');
vi.mock('../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/client')>()),
  fetchWorkerDetail: vi.fn(),
  continueWorker: vi.fn(),
}));

const mockedDetail = vi.mocked(client.fetchWorkerDetail);
const mockedContinue = vi.mocked(client.continueWorker);

describe('TeamRoom', () => {
  beforeEach(() => {
    mockedDetail.mockReset();
    mockedContinue.mockReset();
  });
  afterEach(cleanup);

  it('renders one card per worker in the live roster', () => {
    render(<TeamRoom section={section(REAL_WORKERS)} />);
    const grid = screen.getByTestId('teamroom-grid');
    expect(within(grid).getAllByRole('article')).toHaveLength(3);
  });

  it('reads the SAME workers fact the roster table reads', () => {
    // One roster, one source: no second request for a list of workers.
    render(<TeamRoom section={section(REAL_WORKERS)} />);
    expect(client.fetchWorkerDetail).not.toHaveBeenCalled();
  });

  it('says the roster is not exposed when the workers fact is absent', () => {
    render(<TeamRoom section={{ workers_total: fact(3) }} />);
    expect(screen.getByTestId('teamroom-not-exposed')).toBeTruthy();
  });

  it('distinguishes an exposed-but-empty roster from a missing one', () => {
    render(<TeamRoom section={section([])} />);
    expect(screen.getByTestId('teamroom-empty')).toBeTruthy();
    expect(screen.queryByTestId('teamroom-not-exposed')).toBeNull();
    expect(screen.getByTestId('teamroom-empty').textContent).toContain('empty');
  });

  it('invents no worker when the roster is empty', () => {
    const { container } = render(<TeamRoom section={section([])} />);
    expect(container.querySelectorAll('.sv-worker-card')).toHaveLength(0);
  });

  it('derives its filter options from the roster itself', () => {
    render(<TeamRoom section={section(REAL_WORKERS)} />);
    // Only values actually present in the roster may become filter options.
    expect(screen.getByTestId('filter-status-IMPLEMENTING')).toBeTruthy();
    expect(screen.getByTestId('filter-status-WAITING_FOR_QUOTA')).toBeTruthy();
    expect(screen.queryByTestId('filter-status-DONE')).toBeNull();
  });

  it('filters the grid and reports the honest count', async () => {
    const user = userEvent.setup();
    render(<TeamRoom section={section(REAL_WORKERS)} />);
    await user.click(screen.getByTestId('filter-status-IMPLEMENTING'));
    const grid = screen.getByTestId('teamroom-grid');
    expect(within(grid).getAllByRole('article')).toHaveLength(2);
    expect(screen.getByTestId('teamroom-count').textContent).toContain('2 of 3');
  });

  it('shows an honest empty state when filters match nothing', async () => {
    const user = userEvent.setup();
    render(<TeamRoom section={section(REAL_WORKERS)} />);

    // Every chip is derived from the roster, so a single chip always matches at
    // least one worker. A genuine zero needs two filters to conflict: codex-
    // primary is WAITING_FOR_QUOTA but belongs to MAT, not IDE.
    await user.click(screen.getByTestId('filter-status-WAITING_FOR_QUOTA'));
    expect(screen.getByTestId('teamroom-grid')).toBeTruthy();

    await user.click(screen.getByTestId('filter-app-IDE'));
    expect(screen.getByTestId('teamroom-filtered-empty')).toBeTruthy();
    // It must not pretend the roster is empty, and must not pad the grid.
    expect(screen.getByTestId('teamroom-filtered-empty').textContent).toContain('still holds 3');
    expect(screen.queryByTestId('teamroom-grid')).toBeNull();
  });

  it('reports a delivered continue exactly as the adapter reported it', async () => {
    const user = userEvent.setup();
    mockedContinue.mockResolvedValue({
      ok: true,
      worker_id: 'opencode-primary',
      delivered: true,
      channel: 'opencode-app-server',
      evidence: ['sent: continue', 'ack: queued'],
    } satisfies WorkerContinueResult);
    mockedDetail.mockResolvedValue({ ok: true, worker_id: 'opencode-primary', evidence: [], verdict: 'RUNNING' } satisfies WorkerDetail);

    render(<TeamRoom section={section(REAL_WORKERS)} />);
    await user.click(screen.getByTestId('wc-action-continue-opencode-primary'));

    const out = await screen.findByTestId('action-outcome-text');
    expect(out.textContent).toContain('continue delivered via opencode-app-server');
  });

  it('reports a REFUSED continue as not delivered rather than as success', async () => {
    const user = userEvent.setup();
    mockedContinue.mockResolvedValue({
      ok: true,
      worker_id: 'opencode-primary',
      delivered: false,
      evidence: [],
      error_code: 'ADAPTER_UNAVAILABLE',
    } satisfies WorkerContinueResult);
    mockedDetail.mockResolvedValue({ ok: true, worker_id: 'opencode-primary', evidence: [] } satisfies WorkerDetail);

    render(<TeamRoom section={section(REAL_WORKERS)} />);
    await user.click(screen.getByTestId('wc-action-continue-opencode-primary'));

    const out = await screen.findByTestId('action-outcome-text');
    // The critical assertion: ok:true must NOT be reported as delivered.
    expect(out.textContent).toContain('continue NOT delivered');
    expect(out.textContent).toContain('ADAPTER_UNAVAILABLE');
  });

  it('reports an unreachable inspect instead of an empty card', async () => {
    const user = userEvent.setup();
    mockedDetail.mockResolvedValue({
      ok: false,
      worker_id: 'opencode-primary',
      error_code: 'UNREACHABLE',
      evidence: [],
      detail: 'fetch failed',
    } satisfies WorkerDetail);

    render(<TeamRoom section={section(REAL_WORKERS)} />);
    await user.click(screen.getByTestId('wc-action-inspect-opencode-primary'));

    const out = await screen.findByTestId('action-outcome-text');
    expect(out.textContent).toContain('inspect failed');
    expect(out.textContent).toContain('UNREACHABLE');
  });

  it('surfaces adapter evidence after a live action', async () => {
    const user = userEvent.setup();
    mockedDetail.mockResolvedValue({
      ok: true,
      worker_id: 'opencode-primary',
      verdict: 'RUNNING',
      evidence: ['git rev abc123', 'tests 24/24'],
    } satisfies WorkerDetail);

    render(<TeamRoom section={section(REAL_WORKERS)} />);
    await user.click(screen.getByTestId('wc-action-inspect-opencode-primary'));

    await waitFor(() => expect(screen.getByTestId('action-outcome-evidence').textContent).toContain('git rev abc123'));
  });
});

/* ---------------------------------------------------------------------------
 * readRoster - the single-source reader
 * ------------------------------------------------------------------------ */

describe('readRoster', () => {
  it('returns null when the workers fact is absent', () => {
    expect(readRoster({})).toBeNull();
    expect(readRoster(undefined)).toBeNull();
  });

  it('returns null when workers is not an array, rather than inventing rows', () => {
    expect(readRoster({ workers: fact('not-an-array') })).toBeNull();
  });

  it('returns an empty array for a genuinely empty roster', () => {
    // null (not exposed) and [] (observed zero) must stay distinguishable.
    expect(readRoster({ workers: fact([]) })).toEqual([]);
  });
});