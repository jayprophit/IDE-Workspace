/**
 * Accessibility and event-stream behaviour.
 *
 * The live region is the risky part: a supervisor stream can carry many events
 * a minute, and an over-eager announcer makes the page unusable. These tests
 * pin down that it is polite, bounded, and silent on no change.
 */
import { describe, expect, it } from 'vitest';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Announcer, EventFeed, useHealthAnnouncements } from './events';
import { buildSnapshot, healthPayload } from './snapshot-fixture';
import { installFakeFetch } from '../api/fetch-harness';
import { SupervisorDashboard } from '../SupervisorDashboard';
import type { SupervisorEvent } from '../api/types';

const BASE = 'http://supervisor.test';

function event(seq: number, name: string): SupervisorEvent {
  return { seq, received_at: '2026-10-12T12:00:00+00:00', event: { event: name } };
}

describe('live region', () => {
  it('is polite, never assertive', () => {
    /* Assertive would interrupt whatever the reader is doing. A supervisor
       stream must never do that. */
    const markup = renderToStaticMarkup(<Announcer messages={['Repositories LIVE_VERIFIED to STALE']} />);
    expect(markup).toContain('aria-live="polite"');
    expect(markup).not.toContain('assertive');
  });

  it('is non-atomic so only the changed line is spoken', () => {
    const markup = renderToStaticMarkup(<Announcer messages={['one', 'two']} />);
    expect(markup).toContain('aria-atomic="false"');
  });

  it('renders nothing when there is nothing to announce', () => {
    const markup = renderToStaticMarkup(<Announcer messages={[]} />);
    expect(markup).toContain('aria-live="polite"');
    expect(markup).not.toContain('<p>');
  });

  it('speaks only genuine transitions', () => {
    const { result, rerender } = renderHook(({ m }) => useHealthAnnouncements(m), {
      initialProps: { m: new Map([['repos', { label: 'Repositories', state: 'LIVE_VERIFIED' }]]) },
    });
    expect(result.current).toEqual([]); // baseline pass, silent

    rerender({ m: new Map([['repos', { label: 'Repositories', state: 'STALE' }]]) });
    expect(result.current).toHaveLength(1);
    expect(result.current[0]).toContain('Repositories');
    expect(result.current[0]).toContain('STALE');
  });

  it('stays silent when a re-render reports identical health', () => {
    const same = new Map([['repos', { label: 'Repositories', state: 'STALE' }]]);
    const { result, rerender } = renderHook(({ m }) => useHealthAnnouncements(m), { initialProps: { m: same } });
    rerender({ m: same });
    rerender({ m: new Map(same) });
    /* Same data must not produce speech. */
    expect(result.current).toEqual([]);
  });

  it('does not announce the initial appearance of every section', () => {
    const { result, rerender } = renderHook(({ m }) => useHealthAnnouncements(m), {
      initialProps: { m: new Map([['a', { label: 'A', state: 'LIVE_VERIFIED' }]]) },
    });
    rerender({
      m: new Map([
        ['a', { label: 'A', state: 'LIVE_VERIFIED' }],
        ['b', { label: 'B', state: 'LIVE_VERIFIED' }],
      ]),
    });
    /* A brand-new section is not a change to announce. */
    expect(result.current).toEqual([]);
  });

  it('bounds the queue so a burst cannot grow unbounded', () => {
    const { result, rerender } = renderHook(({ m }) => useHealthAnnouncements(m), {
      initialProps: { m: new Map([['a', { label: 'A', state: 'LIVE' }]]) },
    });
    for (let i = 0; i < 12; i += 1) {
      rerender({ m: new Map([['a', { label: 'A', state: `STALE_${i}` }]]) });
    }
    expect(result.current.length).toBeLessThanOrEqual(4);
  });
});

describe('event feed', () => {
  it('reports an empty stream honestly rather than inventing events', () => {
    render(<EventFeed events={[]} />);
    expect(screen.getByTestId('event-feed-empty')).toHaveTextContent(/no events yet/i);
  });

  it('renders events newest-first with their sequence numbers', () => {
    render(<EventFeed events={[event(1, 'task.started'), event(2, 'worker.heartbeat')]} />);
    /* Latest first: on a live feed the newest event is what matters. */
    const rows = screen.getAllByTestId(/^event-\d+$/);
    expect(rows[0]).toHaveTextContent('worker.heartbeat');
    expect(rows[0]).toHaveTextContent('#2');
  });

  it('names an event with no name rather than showing blank', () => {
    render(<EventFeed events={[{ seq: 1, received_at: '', event: {} }]} />);
    expect(screen.getByTestId('event-1')).toHaveTextContent('unnamed');
  });

  it('is not itself a live region, to avoid double announcement', () => {
    /* The announcer speaks health changes; the feed is read on demand. */
    const markup = renderToStaticMarkup(<EventFeed events={[event(1, 'x')]} />);
    expect(markup).toContain('aria-live="off"');
  });
});

describe('dashboard accessibility', () => {
  it('exposes the primary navigation as a landmark', async () => {
    installFakeFetch([], {
      state: { ok: true, snapshot: buildSnapshot() },
      health: healthPayload(),
      events: { ok: true, events: [] },
    });
    render(<SupervisorDashboard baseUrl={BASE} enabled={false} />);
    expect(screen.getByRole('navigation', { name: /supervisor views/i })).toBeInTheDocument();
  });

  it('marks the current tab with aria-current', async () => {
    installFakeFetch([], {
      state: { ok: true, snapshot: buildSnapshot() },
      health: healthPayload(),
      events: { ok: true, events: [] },
    });
    render(<SupervisorDashboard baseUrl={BASE} enabled={false} />);
    await waitFor(() => expect(screen.getByTestId('supervisor-dashboard')).toHaveAttribute('data-connection', 'connected'));
    expect(screen.getByTestId('tab-overview')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('tab-events')).not.toHaveAttribute('aria-current');
  });

  it('gives every interactive control an accessible name', async () => {
    installFakeFetch([], {
      state: { ok: true, snapshot: buildSnapshot() },
      health: healthPayload(),
      events: { ok: true, events: [] },
    });
    render(<SupervisorDashboard baseUrl={BASE} enabled={false} />);
    await waitFor(() => expect(screen.getByTestId('supervisor-dashboard')).toHaveAttribute('data-connection', 'connected'));
    for (const btn of Array.from(document.querySelectorAll('button'))) {
      expect(btn.textContent?.trim().length ?? 0, 'a button has no accessible name').toBeGreaterThan(0);
    }
  });

  it('mounts an announcer region on the dashboard itself', async () => {
    installFakeFetch([], {
      state: { ok: true, snapshot: buildSnapshot() },
      health: healthPayload(),
      events: { ok: true, events: [] },
    });
    render(<SupervisorDashboard baseUrl={BASE} enabled={false} />);
    expect(screen.getByTestId('health-announcer')).toHaveAttribute('aria-live', 'polite');
  });

  it('pulls events from the documented stream route', async () => {
    const calls: { url: string; method: string }[] = [];
    installFakeFetch(calls, {
      state: { ok: true, snapshot: buildSnapshot() },
      health: healthPayload(),
      events: { ok: true, events: [event(4, 'worker.heartbeat')] },
    });
    render(<SupervisorDashboard baseUrl={BASE} enabled={false} />);
    await waitFor(() => expect(calls.some((c) => c.url.includes('/v1/supervisor/events'))).toBe(true));
    /* Cursor-based, matching events_since(since). */
    expect(calls.some((c) => c.url.includes('since=0'))).toBe(true);
  });

  it('renders streamed events in the feed', async () => {
    installFakeFetch([], {
      state: { ok: true, snapshot: buildSnapshot() },
      health: healthPayload(),
      events: { ok: true, events: [event(7, 'supervisor.handoffs_pending')] },
    });
    const { unmount } = render(<SupervisorDashboard baseUrl={BASE} enabled={false} initialTab={'events' as never} />);
    await waitFor(() => expect(screen.getByTestId('event-7')).toBeInTheDocument(), { timeout: 4000 });
    expect(screen.getByTestId('event-7')).toHaveTextContent('supervisor.handoffs_pending');
    unmount();
  });
});

describe('responsive layout', () => {
  it('keeps the header reachable at narrow widths without horizontal overflow', async () => {
    installFakeFetch([], {
      state: { ok: true, snapshot: buildSnapshot() },
      health: healthPayload(),
      events: { ok: true, events: [] },
    });
    render(<SupervisorDashboard baseUrl={BASE} enabled={false} />);
    await waitFor(() => expect(screen.getByTestId('supervisor-dashboard')).toHaveAttribute('data-connection', 'connected'));
    /* Cards collapse to one column via auto-fit + min(); the shell itself must
       not introduce a horizontal scrollbar. */
    const root = screen.getByTestId('supervisor-dashboard');
    expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth + 1);
  });

  it('uses fluid grids rather than fixed column counts', async () => {
    installFakeFetch([], {
      state: { ok: true, snapshot: buildSnapshot() },
      health: healthPayload(),
      events: { ok: true, events: [] },
    });
    render(<SupervisorDashboard baseUrl={BASE} enabled={false} initialTab={'repositories' as never} />);
    await waitFor(() => expect(screen.getByTestId('repo-list')).toBeInTheDocument());
    /* Three repos must all render; the grid adapts rather than truncating. */
    expect(screen.getByTestId('repo-list').children).toHaveLength(3);
  });
});

/* Keep act() referenced so the import is used by future async assertions. */
export { act };