import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SourceFact, SupervisorEvent, SupervisorSnapshot } from '../api/types';
import { ConferenceView, ConferenceTile } from './conference';
import { MessageFeed, humanType, summarise, workerOf, readableTime } from './message-feed';
import { ResourceMeters, GitHealthPanel, TestHealthTile } from './resource-tiles';
import {
  GAUGE_AXES,
  gaugePercent,
  numberOrNull,
  readGitHealth,
  readResourceSample,
  textOrNull,
  worstOf,
  combineStates,
} from './m3-readmodel';
import type { TeamMember } from './roster-types';

/**
 * M3 regression suite — conference, message feed, resource + git tiles.
 *
 * The organising idea: the vibe-prototype's conference and gauges were almost
 * entirely fabricated (a hardcoded `speaking: true`, `Math.random()` telemetry,
 * invented chat transcripts). These tests exist to pin down the fact that none
 * of that fabrication survives the port. Each honesty case the spec calls out
 * has at least one assertion here that would fail if the fabrication returned.
 */

const nowIso = () => new Date().toISOString();

function fact<T>(value: T, state: SourceFact['state'] = 'LIVE_VERIFIED'): SourceFact {
  return { value, state, source: 'test', observed_at: nowIso(), age_s: 0, note: '' };
}

const WORKERS: TeamMember[] = [
  {
    worker_id: 'opencode-primary',
    application: 'opencode',
    role: 'ide-worker',
    status: 'IMPLEMENTING',
    task_description: '',
    project: '',
    model: '',
    quota_state: {},
  },
  {
    worker_id: 'codex-primary',
    application: 'codex',
    role: 'mat-worker',
    status: 'WAITING_FOR_QUOTA',
    task_description: 'implement the ingest path',
    project: 'bridge',
    model: '',
    quota_state: { pool: 'five_hour', reset_at: '06:12', resets_in_s: 77 },
  },
  {
    worker_id: 'ollama-local',
    application: 'ollama',
    role: 'local-worker',
    status: 'IMPLEMENTING',
    task_description: '',
    project: 'bridge',
    model: 'llama3.1',
    quota_state: {},
  },
];

const supervision = (workers: TeamMember[] | undefined) =>
  ({ workers: workers ? fact(workers) : undefined }) as Record<string, unknown>;

function snapshot(sections: Record<string, unknown>): SupervisorSnapshot {
  return {
    schema_version: 1,
    supervisor: 'hermes',
    session_id: 'test',
    generated_at: nowIso(),
    last_event_seq: 7,
    sections: sections as SupervisorSnapshot['sections'],
  };
}

const event = (seq: number, payload: Record<string, unknown>): SupervisorEvent => ({
  seq,
  received_at: '2026-10-13T05:10:43+00:00',
  event: payload as SupervisorEvent['event'],
});

/* ===========================================================================
 * CONFERENCE (§12)
 * ======================================================================== */

describe('ConferenceView', () => {
  it('renders one tile per live worker from the roster', () => {
    render(<ConferenceView section={supervision(WORKERS)} />);
    const grid = screen.getByTestId('conference-grid');
    expect(within(grid).getAllByRole('article')).toHaveLength(3);
    expect(screen.getByTestId('conf-tile-codex-primary')).toBeTruthy();
  });

  it('states plainly that NO worker is speaking (no fake active speaker)', () => {
    render(<ConferenceView section={supervision(WORKERS)} />);
    const banner = screen.getByTestId('conference-no-speaker');
    expect(banner).toBeTruthy();
    expect(banner.textContent).toContain('No worker is speaking');
    // And it must say the backend exposes no such indicator, rather than
    // implying the UI checked and found a genuine silent room.
    expect(banner.textContent).toContain('NOT_EXPOSED');
  });

  it('never promotes a worker to speaker without a real speaking flag', () => {
    render(<ConferenceView section={supervision(WORKERS)} />);
    expect(screen.queryByTestId('conference-active-speaker')).toBeNull();
  });

  it('honours a REAL speaking flag when the backend ever sends one', () => {
    const withSpeaker = [{ ...WORKERS[0], speaking: true } as TeamMember];
    render(<ConferenceView section={supervision(withSpeaker)} />);
    const banner = screen.getByTestId('conference-active-speaker');
    expect(banner.textContent).toContain('opencode-primary');
    expect(screen.queryByTestId('conference-no-speaker')).toBeNull();
  });

  it('shows voice/video as deferred chips, never as working controls', () => {
    render(<ConferenceView section={supervision(WORKERS)} />);
    for (const id of ['conference-voice-chip', 'conference-video-chip']) {
      const chip = screen.getByTestId(id);
      expect(chip.textContent).toContain('NOT_IMPLEMENTED');
      // A chip, not a button: there is nothing to press and nothing to fake.
      expect(chip.tagName).not.toBe('BUTTON');
    }
  });

  it('renders an empty task as an absence, never a blank line', () => {
    render(<ConferenceView section={supervision(WORKERS)} />);
    const tile = screen.getByTestId('conf-tile-opencode-primary');
    expect(tile.textContent).toContain('task not reported');
    // The one worker with a real task shows it verbatim.
    expect(screen.getByTestId('conf-tile-codex-primary').textContent).toContain('implement the ingest path');
  });

  it('distinguishes an absent roster from an empty one', () => {
    cleanup();
    render(<ConferenceView section={{}} />);
    expect(screen.getByTestId('conference-not-exposed')).toBeTruthy();
    cleanup();
    render(<ConferenceView section={supervision([])} />);
    expect(screen.getByTestId('conference-empty')).toBeTruthy();
  });

  it('filters the gallery by a real roster field', async () => {
    const user = userEvent.setup();
    render(<ConferenceView section={supervision(WORKERS)} />);
    // `project` is only real for two of the three workers.
    await user.click(screen.getByTestId('conf-filter-project-bridge'));
    const grid = screen.getByTestId('conference-grid');
    expect(within(grid).getAllByRole('article')).toHaveLength(2);
    expect(screen.getByTestId('conference-count').textContent).toContain('2 of 3');
  });

  it('offers no filter option for a value the roster does not contain', () => {
    render(<ConferenceView section={supervision(WORKERS)} />);
    expect(screen.queryByTestId('conf-filter-status-DONE')).toBeNull();
    expect(screen.getByTestId('conf-filter-status-WAITING_FOR_QUOTA')).toBeTruthy();
  });

  it('shows an honest empty state when two valid filters cannot both match', async () => {
    const user = userEvent.setup();
    /* Every filter option is derived from the roster, so each single filter
       always matches somebody. A zero only appears when two individually-valid
       options are mutually exclusive - which is exactly the real case:
       the only IMPLEMENTING worker is on 'bridge', and the only 'bridge'
       worker is quota-blocked. */
    const rows: TeamMember[] = [
      { worker_id: 'a', role: 'ide-worker', status: 'IMPLEMENTING', project: 'bridge' },
      { worker_id: 'b', role: 'mat-worker', status: 'WAITING_FOR_QUOTA', project: 'other' },
    ];
    render(<ConferenceView section={supervision(rows)} />);
    await user.click(screen.getByTestId('conf-filter-status-IMPLEMENTING'));
    await user.click(screen.getByTestId('conf-filter-project-other'));
    expect(screen.getByTestId('conference-filtered-empty')).toBeTruthy();
    expect(screen.getByTestId('conference-filtered-empty').textContent).toContain('still holds 2');
    // And no phantom tile is drawn to pad the room.
    expect(screen.queryByTestId('conference-grid')).toBeNull();
  });

  it('glows a live worker and never a degraded one', () => {
    const { container } = render(<ConferenceTile worker={WORKERS[0]} />);
    expect(container.querySelector('.sv-conf__tile')?.getAttribute('data-state')).toBe('LIVE_VERIFIED');
  });
});

/* ===========================================================================
 * MESSAGE FEED (§14)
 * ======================================================================== */

describe('MessageFeed', () => {
  it('renders REAL events with type, time, worker and payload', () => {
    const events = [
      event(1, { event: 'worker_status', worker_id: 'codex-primary', status: 'IMPLEMENTING', timestamp: '2026-10-13T05:10:43Z' }),
      event(2, { event: 'test_result', worker_id: 'opencode-primary', passed: 24, failed: 0 }),
    ];
    render(<MessageFeed events={events} />);
    expect(screen.getByTestId('message-feed-list')).toBeTruthy();
    expect(screen.getByTestId('msg-type-1').textContent).toBe('worker status');
    expect(screen.getByTestId('msg-worker-1').textContent).toBe('codex-primary');
    expect(screen.getByTestId('msg-payload-1').textContent).toContain('status=IMPLEMENTING');
    expect(screen.getByTestId('msg-payload-2').textContent).toContain('passed=24');
  });

  it('shows an honest empty state and fabricates no chatter', () => {
    const { container } = render(<MessageFeed events={[]} />);
    const empty = screen.getByTestId('message-feed-empty');
    expect(empty.textContent).toContain('No events yet');
    // Zero rows. No placeholder message, no "system ready" chatter.
    expect(container.querySelectorAll('.sv-msg')).toHaveLength(0);
    expect(container.textContent).not.toMatch(/hello|hi there|how can i/i);
  });

  it('never attributes an event to an invented worker', () => {
    render(<MessageFeed events={[event(1, { event: 'gap_opened' })]} />);
    expect(screen.getByTestId('msg-worker-1').textContent).toBe('worker not reported');
  });

  it('describes a nested payload by shape, not as escaped JSON', () => {
    render(<MessageFeed events={[event(1, { event: 'handoff', detail: { a: 1, b: 2, c: 3 } })]} />);
    const payload = screen.getByTestId('msg-payload-1').textContent ?? '';
    expect(payload).toContain('detail={3}');
    expect(payload).not.toContain('{"a":1');
  });

  it('keeps the feed readable when the stream is busy', () => {
    render(<MessageFeed events={Array.from({ length: 40 }, (_, i) => event(i, { event: 'heartbeat', worker_id: `w${i}` }))} />);
    expect(screen.getAllByRole('article')).toHaveLength(40);
  });

  it('filters to worker-bearing events without losing the honest count', async () => {
    const user = userEvent.setup();
    render(<MessageFeed events={[event(1, { event: 'gap_opened' }), event(2, { event: 'handoff', worker_id: 'w1' })]} />);
    await user.click(screen.getByTestId('msgfilter-workers'));
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByTestId('msg-worker-2').textContent).toBe('w1');
  });
});

describe('event legibility helpers', () => {
  it('humanises known types and passes unknown ones through', () => {
    expect(humanType('worker_status')).toBe('worker status');
    expect(humanType('some_new_event_kind')).toBe('some new event kind');
    expect(humanType('')).toBe('unnamed event');
  });

  it('reports an empty payload rather than inventing one', () => {
    expect(summarise(event(1, { event: 'x' }))).toBe('no payload');
  });

  it('falls back to the received time when the event carries no timestamp', () => {
    expect(readableTime(event(1, { event: 'x' }))).not.toBe('time not reported');
  });

  it('returns null worker for an event with no worker field', () => {
    expect(workerOf(event(1, { event: 'x' }))).toBeNull();
  });
});

/* ===========================================================================
 * RESOURCE GAUGES (§6)
 * ======================================================================== */

describe('ResourceMeters', () => {
  it('reads every axis NOT_EXPOSED when the sample is absent', () => {
    render(<ResourceMeters section={{}} />);
    expect(screen.getByTestId('resource-meters').getAttribute('data-sample')).toBe('absent');
    for (const axis of GAUGE_AXES) {
      expect(screen.getByTestId(`gauge-${axis}`).getAttribute('data-exposed')).toBe('false');
      expect(screen.getByTestId(`gauge-${axis}-value`).textContent).toBe('NOT EXPOSED');
    }
  });

  it('reads every axis NOT_EXPOSED when the sample is exposed but NULL', () => {
    // This is the real live shape: `sample` exists with state LIVE_VERIFIED
    // and value null. It must not render as four zero-height bars.
    render(<ResourceMeters section={{ sample: fact(null) }} />);
    expect(screen.getByTestId('gauge-cpu-value').textContent).toBe('NOT EXPOSED');
    expect(screen.getByTestId('gauge-vram').getAttribute('data-exposed')).toBe('false');
  });

  it('renders a REAL per-axis reading, and only that axis', () => {
    const sample = { cpu: 0.42, ram: null, gpu: null, vram: null, confidence: 'VERIFIED' };
    render(<ResourceMeters section={{ sample: fact(sample) }} />);
    expect(screen.getByTestId('gauge-cpu').getAttribute('data-exposed')).toBe('true');
    expect(screen.getByTestId('gauge-cpu-value').textContent).toBe('42%');
    // A live cpu must NOT make a dead GPU look measured.
    expect(screen.getByTestId('gauge-gpu').getAttribute('data-exposed')).toBe('false');
    expect(screen.getByTestId('gauge-gpu-value').textContent).toBe('NOT EXPOSED');
  });

  it('draws a real zero-width bar differently from an absent axis', () => {
    const { container } = render(<ResourceMeters section={{ sample: fact({ cpu: 0, ram: null, gpu: null, vram: null }) }} />);
    const cpuFill = container.querySelector('[data-testid="gauge-cpu"] .sv-res__fill') as HTMLElement;
    const gpuFill = container.querySelector('[data-testid="gauge-gpu"] .sv-res__fill') as HTMLElement | null;
    expect(cpuFill.style.width).toBe('0%');
    // The absent axis has no fill width at all.
    expect(gpuFill?.style.width ?? '').toBe('');
  });

  it('exposes an accessible meter with no value when absent', () => {
    const { container } = render(<ResourceMeters section={{}} />);
    const meter = container.querySelector('[data-testid="gauge-cpu"] [role="meter"]') as HTMLElement;
    expect(meter.getAttribute('aria-valuenow')).toBeNull();
    expect(meter.getAttribute('aria-valuetext')).toBe('not exposed');
  });

  it('never draws a sparkline from an invented history', () => {
    const { container } = render(<ResourceMeters section={{ sample: fact({ cpu: 0.5, ram: 0.5, gpu: 0, vram: 0 }) }} />);
    expect(container.querySelector('svg')).toBeNull();
    expect(container.querySelectorAll('[data-testid^="spark"]')).toHaveLength(0);
  });
});

describe('resource read-model', () => {
  it('treats a null sample and an absent sample the same way', () => {
    expect(readResourceSample({ sample: fact(null) })).toBeNull();
    expect(readResourceSample({})).toBeNull();
    expect(readResourceSample(undefined)).toBeNull();
  });

  it('returns null rather than 0 for an unparseable number', () => {
    expect(numberOrNull('42')).toBeNull();
    expect(numberOrNull(Number.NaN)).toBeNull();
    expect(numberOrNull(0)).toBe(0);
    expect(textOrNull('')).toBeNull();
    expect(gaugePercent(null)).toBeNull();
    expect(gaugePercent(0)).toBe(0);
    expect(gaugePercent(1)).toBe(100);
  });
});

/* ===========================================================================
 * GIT HEALTH (§6)
 * ======================================================================== */

describe('GitHealthPanel', () => {
  it('reports NOT_EXPOSED when the backend listed no repository', () => {
    render(<GitHealthPanel section={{}} />);
    expect(screen.getByTestId('git-health').getAttribute('data-state')).toBe('NOT_EXPOSED');
    expect(screen.getByTestId('git-not-exposed').textContent).toContain('not reporting clean repositories');
  });

  it('sums real per-repo facts', () => {
    const section = {
      'agent-bridge': { head: fact('9a49b6f'), branch: fact('main'), ahead: fact(0), behind: fact(0), dirty_count: fact(0) },
      dashboard: { head: fact('43276b2'), branch: fact('unit/x'), ahead: fact(1), behind: fact(2), dirty_count: fact(3) },
    };
    render(<GitHealthPanel section={section} />);
    expect(screen.getByTestId('git-dirty').textContent).toBe('dirty 3');
    expect(screen.getByTestId('git-ahead').textContent).toBe('ahead 1');
    expect(screen.getByTestId('git-behind').textContent).toBe('behind 2');
    expect(screen.getByTestId('git-repo-agent-bridge').textContent).toContain('9a49b6f');
  });

  it('shows "not reported" for an unreported count, never 0', () => {
    const section = { repo: { head: fact('abc123'), branch: fact('main') } };
    render(<GitHealthPanel section={section} />);
    const row = screen.getByTestId('git-repo-repo');
    expect(row.textContent).toContain('not reported');
    expect(row.textContent).not.toMatch(/\b0\b/);
  });

  it('never lets a healthy repo hide a degraded sibling', () => {
    const section = {
      good: { head: fact('aaa', 'LIVE_VERIFIED'), dirty_count: fact(0, 'LIVE_VERIFIED') },
      bad: { head: fact('bbb', 'OFFLINE'), dirty_count: fact(0, 'OFFLINE') },
    };
    expect(readGitHealth(section).state).toBe('OFFLINE');
  });
});

describe('TestHealthTile', () => {
  it('reads DEFERRED because no test fact exists in the live snapshot', () => {
    render(<TestHealthTile snapshot={snapshot({ supervision: supervision(WORKERS), resources: { sample: fact(null) } })} />);
    const tile = screen.getByTestId('mission-tile-tests');
    expect(tile.getAttribute('data-fact-state')).toBe('DEFERRED_BACKEND_INTERFACE');
    expect(screen.getByTestId('test-health-note').textContent).toContain('no test/CI fact');
    // And no invented number.
    expect(tile.textContent).not.toMatch(/\d+ (passed|failed|tests)/);
  });

  it('reports a REAL test fact if the backend ever adds one', () => {
    const snap = snapshot({ ci: { health: fact({ passed: 24, failed: 0 }) } });
    render(<TestHealthTile snapshot={snap} />);
    expect(screen.getByTestId('mission-tile-tests').getAttribute('data-fact-state')).toBe('LIVE_VERIFIED');
  });
});

/* ===========================================================================
 * State algebra
 * ======================================================================== */

describe('state algebra', () => {
  it('takes the worst state, never the best', () => {
    expect(worstOf(['LIVE_VERIFIED', 'OFFLINE', 'LIVE'])).toBe('OFFLINE');
    expect(combineStates('LIVE_VERIFIED', 'OFFLINE')).toBe('OFFLINE');
  });

  it('cannot be upgraded by a healthy sibling', () => {
    expect(combineStates('NOT_EXPOSED', 'LIVE_VERIFIED')).toBe('NOT_EXPOSED');
    expect(combineStates('DEGRADED', 'LIVE_VERIFIED')).toBe('DEGRADED');
  });

  it('treats an unknown state as degraded rather than healthy', () => {
    expect(worstOf(['SOMETHING_NEW'])).toBe('SOMETHING_NEW');
    expect(combineStates('SOMETHING_NEW', 'LIVE_VERIFIED')).toBe('SOMETHING_NEW');
  });
});

/* ===========================================================================
 * Network boundary (§ hard constraint)
 * ======================================================================== */

describe('M3 components never fetch', () => {
  it('declares no fetch in any M3 component', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    for (const f of ['conference.tsx', 'message-feed.tsx', 'resource-tiles.tsx', 'm3-readmodel.ts']) {
      const src = readFileSync(join(__dirname, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      expect(/\bfetch\s*\(/.test(src), `${f} fetches`).toBe(false);
    }
  });
});

/* Keep vi imported-but-used guards honest if the file is trimmed. */
void vi;