import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  fetchInspectionEvents,
  fetchInspectionSessions,
  parseInspectionEvents,
  parseInspectionSessions,
} from './inspection';

describe('inspection parsers', () => {
  it('parses session lists in both envelope shapes', () => {
    const row = {
      session_id: 's1', status: 'ACTIVE', mode: 'work', workspace: '/tmp/w',
      created_at: 123, tasks: { t1: 'EXECUTING', t2: 7 },
    };
    expect(parseInspectionSessions([row])).toEqual([{
      session_id: 's1', status: 'ACTIVE', mode: 'work', workspace: '/tmp/w',
      created_at: 123, tasks: { t1: 'EXECUTING', t2: 'unknown' },
    }]);
    expect(parseInspectionSessions({ sessions: [row] })).toHaveLength(1);
    expect(parseInspectionSessions([])).toEqual([]);
  });

  it('rejects malformed session payloads honestly', () => {
    expect(() => parseInspectionSessions({})).toThrowError(/not a list/);
    expect(() => parseInspectionSessions([{ status: 'x' }])).toThrowError(/without session_id/);
  });

  it('parses event lists with best-effort labels', () => {
    const events = parseInspectionEvents({
      events: [{ kind: 'task.started', id: 1 }, { message: 'hello' }, 42],
    });
    expect(events.map((e) => e.label)).toEqual(['task.started', 'hello', '42']);
    expect(parseInspectionEvents([])).toEqual([]);
    expect(() => parseInspectionEvents({})).toThrowError(/not a list/);
  });
});

describe('inspection clients', () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.stubGlobal('fetch', realFetch);
    vi.unstubAllGlobals();
  });

  function okJson(payload: unknown) {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => payload,
    });
  }

  it('fetches sessions and surfaces HTTP failures', async () => {
    okJson([{ session_id: 's1', tasks: {} }]);
    const good = await fetchInspectionSessions('http://x');
    expect(good.ok).toBe(true);
    expect(good.data).toHaveLength(1);
    expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain('/v1/sessions');

    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, status: 500 });
    const bad = await fetchInspectionSessions('http://x');
    expect(bad.ok).toBe(false);
    expect(bad.error).toContain('HTTP 500');
  });

  it('fetches events for a session and encodes the id', async () => {
    okJson({ events: [{ kind: 'done' }] });
    const res = await fetchInspectionEvents('http://x', 's 1', 12);
    expect(res.ok).toBe(true);
    expect(res.data?.[0]?.label).toBe('done');
    const url = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain('/v1/sessions/s%201/events?since=12');
  });

  it('reports network errors honestly', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('boom'));
    const res = await fetchInspectionEvents('http://x', 's1');
    expect(res.ok).toBe(false);
    expect(res.error).toBe('boom');
  });
});
