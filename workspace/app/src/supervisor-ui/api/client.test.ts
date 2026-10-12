/**
 * Supervisor API client tests.
 *
 * Behavioural, not snapshot. What matters is that the client reads the
 * backend's honesty states faithfully and never substitutes a default for a
 * value it could not read.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  countOf,
  errorFactOf,
  fetchSupervisorEvents,
  fetchSupervisorHealth,
  fetchSupervisorState,
  factsIn,
  isSourceFact,
  leafFacts,
  parseSseFrames,
  parseSnapshot,
  presentSections,
  sectionState,
  worstState,
} from './client';
import { SOURCE_STATES, type SourceFact, type SourceState } from './types';

function fact(value: unknown, state: SourceState, over: Partial<SourceFact> = {}): SourceFact {
  return {
    value,
    state,
    source: 'git',
    observed_at: '2026-10-12T00:00:00+00:00',
    age_s: 1,
    note: '',
    ...over,
  };
}

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as unknown as Response;
}

function textResponse(body: string, ok = true, status = 200) {
  return { ok, status, text: async () => body } as unknown as Response;
}

describe('SourceFact detection', () => {
  it('accepts a well-formed fact', () => {
    expect(isSourceFact(fact('abc', 'LIVE_VERIFIED'))).toBe(true);
  });

  it('rejects anything that is not a fact', () => {
    /* A plain object with a value but no state must not be rendered as if it
       were verified. That is the failure this guard exists to prevent. */
    expect(isSourceFact({ value: 3 })).toBe(false);
    expect(isSourceFact({ state: 'LIVE_VERIFIED' })).toBe(false);
    expect(isSourceFact('LIVE_VERIFIED')).toBe(false);
    expect(isSourceFact(null)).toBe(false);
    expect(isSourceFact([fact(1, 'LIVE')])).toBe(false);
  });
});

describe('snapshot parsing', () => {
  it('reads the documented envelope', () => {
    const snap = parseSnapshot({
      schema_version: 1,
      supervisor: 'hermes',
      session_id: 's1',
      generated_at: '2026-10-12T00:00:00+00:00',
      last_event_seq: 7,
      sections: { repositories: { p: { head: fact('abc', 'LIVE_VERIFIED') } } },
    });
    expect(snap.schema_version).toBe(1);
    expect(snap.supervisor).toBe('hermes');
    expect(snap.last_event_seq).toBe(7);
    expect(snap.sections.repositories).toBeDefined();
  });

  it('rejects a non-object rather than defaulting fields to zeros', () => {
    /* Defaulting schema_version to 0 and generated_at to '' would produce a
       dashboard that looks populated but reports nothing. */
    expect(() => parseSnapshot('nope')).toThrow();
    expect(() => parseSnapshot(null)).toThrow();
  });

  it('preserves a section the client does not know about', () => {
    const snap = parseSnapshot({
      schema_version: 1, supervisor: 'h', session_id: '', generated_at: '', last_event_seq: 0,
      sections: { brand_new_section: { a: fact(1, 'LIVE') } },
    });
    expect(Object.keys(snap.sections)).toContain('brand_new_section');
  });
});

describe('section state roll-up', () => {
  it('reports NOT_EXPOSED for an absent section', () => {
    /* Absent is a finding, not an empty section. */
    expect(sectionState(undefined)).toBe('NOT_EXPOSED');
    expect(sectionState({})).toBe('NOT_EXPOSED');
  });

  it('takes the WORST state, never the best', () => {
    const section = {
      ok_field: fact(1, 'LIVE_VERIFIED'),
      bad_field: fact(null, 'OFFLINE'),
      mid_field: fact(2, 'STALE'),
    };
    /* One offline source must make the section look as bad as it is. */
    expect(sectionState(section)).toBe('OFFLINE');
  });

  it('escalates an error-shaped section', () => {
    const section = { error: fact('boom', 'DEGRADED', { note: 'TypeError: x' }) };
    expect(sectionState(section)).toBe('DEGRADED');
    expect(errorFactOf(section)?.note).toBe('TypeError: x');
  });

  it('flattens nested fact groups', () => {
    const leaves = leafFacts({
      liveness: { verdict: fact('ACTIVE', 'LIVE_VERIFIED'), cli: fact('available', 'LIVE_VERIFIED') },
      flat: fact(3, 'STALE'),
    });
    expect(leaves).toHaveLength(3);
  });

  it('separates nested groups from flat facts', () => {
    const pairs = factsIn({ flat: fact(1, 'LIVE'), nested: { a: fact(2, 'LIVE') }, notAFact: { x: 1 } });
    expect(pairs.map(([k]) => k)).toEqual(['flat', 'nested']);
  });

  it('orders severity worst-first', () => {
    expect(worstState([fact(1, 'LIVE_VERIFIED'), fact(1, 'NOT_EXPOSED'), fact(1, 'LIVE')])).toBe('NOT_EXPOSED');
    expect(worstState([fact(1, 'STALE'), fact(1, 'DEGRADED')])).toBe('DEGRADED');
    expect(worstState([])).toBeNull();
  });

  it('lists only sections that carry data', () => {
    const snap = parseSnapshot({
      schema_version: 1, supervisor: 'h', session_id: '', generated_at: '', last_event_seq: 0,
      sections: { repositories: { a: fact(1, 'LIVE') }, knowledge: {} },
    });
    expect(presentSections(snap)).toEqual(['repositories']);
  });

  it('returns nothing when there is no snapshot at all', () => {
    expect(presentSections(null)).toEqual([]);
  });
});

describe('counts', () => {
  it('reads a number and a list length', () => {
    expect(countOf(fact(4, 'LIVE_VERIFIED'))).toBe(4);
    expect(countOf(fact([1, 2, 3], 'LIVE_VERIFIED'))).toBe(3);
  });

  it('returns null rather than 0 for a value it cannot count', () => {
    /* null is not zero. The distinction is the whole point of the field. */
    expect(countOf(fact(null, 'OFFLINE'))).toBeNull();
    expect(countOf(fact('abc', 'LIVE_VERIFIED'))).toBeNull();
    expect(countOf(undefined)).toBeNull();
  });

  it('returns a real 0 for an observed empty list', () => {
    expect(countOf(fact([], 'LIVE_VERIFIED'))).toBe(0);
  });
});

describe('url joining', () => {
  /* The dev base is a PREFIX (`/api/supervisor`); an explicit loopback base
     already names the version. Joining them naively doubles the path, which
     the proxy then 404s. This pins both shapes so the two cannot drift. */
  it('keeps a bare prefix and appends the versioned path', () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ok: true, supervisor: 'hermes', schema_version: 1, last_event_seq: 0 })));
    return fetchSupervisorHealth('/api').then(() => {
      const called = (globalThis.fetch as unknown as { mock: { calls: string[][] } }).mock.calls[0][0];
      expect(called).toBe('/api/v1/supervisor/health');
      vi.unstubAllGlobals();
    });
  });

  it('does not double the version when the base already names it', () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ok: true, supervisor: 'hermes', schema_version: 1, last_event_seq: 0 })));
    return fetchSupervisorHealth('http://127.0.0.1:8472/v1/supervisor').then(() => {
      const called = (globalThis.fetch as unknown as { mock: { calls: string[][] } }).mock.calls[0][0];
      expect(called).toBe('http://127.0.0.1:8472/v1/supervisor/health');
      expect(called).not.toContain('v1/supervisor/v1/supervisor');
      vi.unstubAllGlobals();
    });
  });

  it('passes the since cursor through untouched', () => {
    vi.stubGlobal('fetch', vi.fn(async () => textResponse('')));
    return fetchSupervisorEvents('/api', 12).then(() => {
      const called = (globalThis.fetch as unknown as { mock: { calls: string[][] } }).mock.calls[0][0];
      expect(called).toContain('since=12');
      vi.unstubAllGlobals();
    });
  });
});

describe('health', () => {
  it('reports unreachable rather than a healthy-but-empty response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('refused'); }));
    const res = await fetchSupervisorHealth('http://x');
    expect(res.ok).toBe(false);
    expect(res.error_code).toBe('UNREACHABLE');
    expect(res.detail).toContain('refused');
    vi.unstubAllGlobals();
  });

  it('surfaces a 500 as an error, not as ok', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, false, 500)));
    const res = await fetchSupervisorHealth('http://x');
    expect(res.ok).toBe(false);
    vi.unstubAllGlobals();
  });

  it('reports unreachable state without a snapshot', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ok: false, error_code: 'SUPERVISOR_ERROR' }, false, 500)));
    const res = await fetchSupervisorState('http://x');
    expect(res.ok).toBe(false);
    expect(res.snapshot).toBeUndefined();
    vi.unstubAllGlobals();
  });
});

describe('SSE parsing', () => {
  const frame = (seq: number, name: string, extra = '') =>
    `id: ${seq}\nevent: supervisor\ndata: {"seq":${seq},"received_at":"2026-10-12T00:00:00+00:00","event":{"event":"${name}"${extra}}}`;

  it('parses the backend framing', () => {
    /* Framing comes from _send_sse: id / event: supervisor / data. */
    const events = parseSseFrames(`${frame(1, 'task.started')}\n\n${frame(2, 'worker.heartbeat', ',"worker":"opencode"')}`);
    expect(events).toHaveLength(2);
    expect(events[0].seq).toBe(1);
    expect(events[0].event.event).toBe('task.started');
    expect(events[1].event.worker).toBe('opencode');
  });

  it('preserves inner event payload fields', () => {
    const events = parseSseFrames(frame(3, 'supervisor.handoffs_pending', ',"count":2'));
    expect(events[0].event.count).toBe(2);
  });

  it('ignores blank frames rather than inventing an event', () => {
    expect(parseSseFrames('\n\n\n')).toEqual([]);
    expect(parseSseFrames('')).toEqual([]);
  });

  it('skips a frame with no data line', () => {
    expect(parseSseFrames('id: 5\nevent: supervisor\n')).toEqual([]);
  });

  it('handles multi-line data by accumulating', () => {
    const body = 'id: 1\nevent: supervisor\ndata: {"seq":1,\ndata: "received_at":"t","event":{"event":"x"}}\n';
    expect(parseSseFrames(body)).toHaveLength(1);
  });

  it('returns no events and an error when the stream is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('no stream'); }));
    const res = await fetchSupervisorEvents('http://x', 0);
    expect(res.ok).toBe(false);
    expect(res.events).toEqual([]);
    expect(res.error).toContain('no stream');
    vi.unstubAllGlobals();
  });

  it('reads a live stream', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => textResponse(`${frame(9, 'execution.started')}\n\n`)));
    const res = await fetchSupervisorEvents('http://x', 8);
    expect(res.ok).toBe(true);
    expect(res.events[0].seq).toBe(9);
    vi.unstubAllGlobals();
  });
});

describe('vocabulary', () => {
  it('declares exactly the ten documented states', () => {
    expect(SOURCE_STATES).toHaveLength(10);
    for (const s of SOURCE_STATES) expect(isSourceFact(fact(1, s))).toBe(true);
  });

  it('covers every state the backend can emit', () => {
    /* supervisor.py SOURCE_STATES. If the backend adds one, this test should
       fail loudly rather than the chip rendering as unknown. */
    expect([...SOURCE_STATES].sort()).toEqual(
      ['BLOCKED', 'DEFERRED_BACKEND_INTERFACE', 'DEGRADED', 'FIXTURE', 'LIVE', 'LIVE_VERIFIED', 'NOT_EXPOSED', 'OFFLINE', 'STALE', 'UNKNOWN'].sort(),
    );
  });
});