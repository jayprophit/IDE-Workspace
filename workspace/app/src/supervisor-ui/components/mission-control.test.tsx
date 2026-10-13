import { describe, expect, it } from 'vitest';
import { MissionControl } from './mission-control';

/**
 * MissionControl tests — the §6/§10 owner overview ported from the M2 shell.
 *
 * The contract is honesty: every tile carries its SourceState, an absent fact
 * reads NOT_EXPOSED (never a fabricated zero), and quota is derived from the
 * roster when by_status is absent rather than invented. These pin that the
 * merge did not launder a degraded fact into a healthy-looking tile.
 *
 * MissionControl is a pure function of the snapshot, so these assert on the
 * element tree it returns (serialised), which is what a renderer would mount.
 */

/* A SourceFact wrapper matching the client's runtime shape. */
function fact(value: unknown, state = 'LIVE_VERIFIED') {
  return { value, state, source: 'supervision', observed_at: '2026-10-13T00:00:00Z', age_s: 0, note: '' };
}

function snapshotWith(sections: Record<string, unknown>) {
  return {
    schema_version: 1,
    supervisor: 'hermes',
    session_id: 'test',
    generated_at: '2026-10-13T00:00:00Z',
    last_event_seq: 0,
    sections,
  } as never;
}

/* Serialise the returned element tree so we can assert on what it contains. */
function html(snapshot: unknown): string {
  return JSON.stringify(MissionControl({ snapshot: snapshot as never }));
}

describe('MissionControl', () => {
  it('renders no snapshot as not-live, never as zeros', () => {
    const out = html(null);
    expect(out).toContain('not live');
    // No fabricated worker counts when there is no snapshot.
    expect(out).not.toContain('mission-tile-active');
  });

  it('rolls the live supervision facts into owner tiles', () => {
    const out = html(snapshotWith({
      supervision: {
        workers_total: fact(3),
        workers_by_status: fact({ IMPLEMENTING: 2, WAITING_FOR_QUOTA: 1 }),
        continuation_required: fact(false),
        handoffs_pending: fact(0),
        gaps_open: fact(0),
        workers: fact([
          { worker_id: 'a', status: 'IMPLEMENTING' },
          { worker_id: 'b', status: 'IMPLEMENTING' },
          { worker_id: 'c', status: 'WAITING_FOR_QUOTA' },
        ]),
      },
      resources: { pressure_state: fact('NOMINAL') },
    }));
    // Programme QUIET when continuation_required is false.
    expect(out).toContain('QUIET');
    // The overview tiles all render.
    for (const key of ['programme', 'active', 'total', 'quota', 'handoffs', 'gaps', 'resources']) {
      expect(out).toContain(`mission-tile-${key}`);
    }
    // Resources NOMINAL surfaces as green.
    expect(out).toContain('NOMINAL');
  });

  it('marks an absent fact NOT_EXPOSED rather than a healthy zero', () => {
    const out = html(snapshotWith({
      supervision: {
        workers_total: fact(2),
        workers: fact([{ worker_id: 'a', status: 'IDLE' }]),
        // handoffs_pending and gaps_open deliberately absent
      },
    }));
    // An absent tile must carry NOT_EXPOSED, not read as 0.
    expect(out).toContain('NOT_EXPOSED');
    // Specifically the gaps tile is flagged absent.
    expect(out).toMatch(/mission-tile-gaps[\s\S]*NOT_EXPOSED/);
  });

  it('derives quota from the roster when by_status is absent', () => {
    const out = html(snapshotWith({
      supervision: {
        workers: fact([
          { worker_id: 'a', status: 'WAITING_FOR_QUOTA' },
          { worker_id: 'b', status: 'WAITING_FOR_QUOTA' },
          { worker_id: 'c', status: 'IMPLEMENTING' },
        ]),
        // workers_by_status absent -> derive from roster, do not invent
      },
    }));
    // The quota tile must read the roster-derived count (2), sourced from the
    // roster fact (LIVE_VERIFIED), not a fabricated 0 and not NOT_EXPOSED.
    const quotaTile = out.slice(out.indexOf('mission-tile-quota'), out.indexOf('mission-tile-handoffs'));
    expect(quotaTile).toContain('LIVE_VERIFIED');
    expect(quotaTile).not.toContain('NOT_EXPOSED');
    // two quota workers -> the tile value is "2"
    expect(quotaTile).toMatch(/"children":"2"/);
  });

  it('surfaces CRITICAL resources as a warning, not laundered green', () => {
    const out = html(snapshotWith({
      supervision: { workers_total: fact(1), workers: fact([{ worker_id: 'a', status: 'IMPLEMENTING' }]) },
      resources: { pressure_state: fact('CRITICAL') },
    }));
    expect(out).toContain('CRITICAL');
    expect(out).toContain('governor throttling');
  });
});
