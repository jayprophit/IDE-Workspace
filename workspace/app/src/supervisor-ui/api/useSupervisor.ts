import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchSupervisorEvents, fetchSupervisorHealth, fetchSupervisorState, resolveBase } from './client';
import type { SupervisorEvent, SupervisorHealth, SupervisorSnapshot } from './types';

/**
 * useSupervisor — the single data seam for the whole dashboard.
 *
 * One poll for the snapshot, one event stream, one health probe. Components
 * receive plain values; none of them fetch. Same shape as the runtime binding
 * that passed review, for the same reason.
 *
 * Truth rules this hook is responsible for:
 *   - a failed poll keeps the last snapshot but marks it STALE; it does not
 *     blank the screen, and it does not keep showing a green dot
 *   - the section roll-up reads the backend's own states, never a local guess
 *   - staleness is reported in real elapsed time, not by a client-side re-derivation
 *     of FRESHNESS_WINDOW_S, because that constant belongs to the backend's clock
 */

export type SupervisorConnection = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'unreachable';

export interface SupervisorState_ {
  connection: SupervisorConnection;
  snapshot: SupervisorSnapshot | null;
  health: SupervisorHealth | null;
  events: SupervisorEvent[];
  /** True when `snapshot` is the last good one and a poll since then failed. */
  stale: boolean;
  /** Verbatim transport error, or ''. Never paraphrased. */
  error: string;
  lastPolledAt: number | null;
  poll: () => void;
}

export interface UseSupervisorOptions {
  /**
   * Leave unset to use the same-origin dev proxy (see `client.ts`). Pass
   * `SUPERVISOR_LOOPBACK` to talk to the service directly.
   */
  baseUrl?: string;
  /** Snapshot poll interval. */
  pollMs?: number;
  /** Event stream poll interval. */
  eventPollMs?: number;
  enabled?: boolean;
}

export const DEFAULT_POLL_MS = 5000;
export const DEFAULT_EVENT_POLL_MS = 4000;
/** Events kept in memory. Mirrors the server ring closely enough for the UI. */
const MAX_EVENTS = 120;

export function useSupervisor({
  baseUrl,
  pollMs = DEFAULT_POLL_MS,
  eventPollMs = DEFAULT_EVENT_POLL_MS,
  enabled = true,
}: UseSupervisorOptions = {}): SupervisorState_ {
  /* Deliberately no default here. Leaving `baseUrl` undefined lets
     `resolveBase` supply the same-origin default owned by the client module.
     Hard-coding the loopback in two places is exactly how they drift apart,
     and a cross-origin default fails CORS silently in the browser. */
  const resolvedBase = resolveBase(baseUrl);

  const [connection, setConnection] = useState<SupervisorConnection>('idle');
  const [snapshot, setSnapshot] = useState<SupervisorSnapshot | null>(null);
  const [health, setHealth] = useState<SupervisorHealth | null>(null);
  const [events, setEvents] = useState<SupervisorEvent[]>([]);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState('');
  const [lastPolledAt, setLastPolledAt] = useState<number | null>(null);

  const everConnected = useRef(false);
  const lastSeq = useRef(0);
  const stopped = useRef(false);
  /* The latest snapshot, readable from callbacks without making their
     identity depend on it. A closure over state here would restart the poll
     interval on every tick and the loop would never settle. */
  const snapshotRef = useRef<SupervisorSnapshot | null>(null);
  snapshotRef.current = snapshot;

  const poll = useCallback(() => {
    if (stopped.current) return;
    setConnection((prev) => (prev === 'connected' ? 'reconnecting' : prev === 'idle' ? 'connecting' : prev));

    void (async () => {
      const [stateRes, healthRes] = await Promise.all([
        fetchSupervisorState(resolvedBase),
        fetchSupervisorHealth(resolvedBase),
      ]);
      if (stopped.current) return;

      setHealth(healthRes);

      if (stateRes.ok && stateRes.snapshot) {
        everConnected.current = true;
        setSnapshot(stateRes.snapshot);
        setStale(false);
        setError('');
        setConnection('connected');
        setLastPolledAt(Date.now());
        /* Advance the event cursor only from a snapshot we actually trust. */
        lastSeq.current = Math.max(lastSeq.current, stateRes.snapshot.last_event_seq);
      } else {
        /* Keep the last snapshot: the person does not lose their context
           because a poll timed out. It is marked stale so the freshness chip
           tells the truth. */
        setStale(snapshotRef.current !== null || everConnected.current);
        setError(stateRes.detail ?? 'supervisor API unreachable');
        setConnection('unreachable');
      }
    })();
  }, [resolvedBase]);

  /* Event stream. Polled with the `since` cursor rather than held open, so a
     dropped connection is indistinguishable from silence and recovers on the
     next tick.
     *
     * Reads once even when polling is disabled, for the same reason the
     * snapshot poll does: a live view that starts empty is useless, and the
     * initial read is what establishes the cursor. */
  useEffect(() => {
    let cancelled = false;

    const tickEvents = async () => {
      if (cancelled || stopped.current) return;
      const res = await fetchSupervisorEvents(resolvedBase, lastSeq.current);
      if (cancelled || stopped.current) return;
      if (!res.ok || res.events.length === 0) return;

      setEvents((prev) => {
        const merged = [...prev, ...res.events];
        /* De-duplicate by seq: a retry after a timeout can replay a frame. */
        const seen = new Set<number>();
        return merged.filter((e) => !seen.has(e.seq) && seen.add(e.seq)).slice(-MAX_EVENTS);
      });
      const newest = res.events[res.events.length - 1].seq;
      lastSeq.current = Math.max(lastSeq.current, newest);
    };

    void tickEvents();
    if (!enabled) {
      return () => {
        cancelled = true;
      };
    }
    const id = window.setInterval(() => void tickEvents(), eventPollMs);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [enabled, eventPollMs, resolvedBase]);

  useEffect(() => {
    stopped.current = false;
    /* Always fetch once, even when polling is disabled.
     *
     * `enabled` means "keep polling", not "never talk to the API". A dashboard
     * that renders nothing on first paint and waits for a timer is worse than
     * useless, and disabling polling should still give you a current reading.
     * This also makes the disabled path deterministic for tests: exactly one
     * request, no timers, no flakiness. */
    poll();
    if (!enabled) {
      setConnection('connected');
      return () => {
        stopped.current = true;
      };
    }
    const id = window.setInterval(poll, pollMs);
    return () => {
      stopped.current = true;
      window.clearInterval(id);
    };
    /* `poll` is intentionally excluded: it closes over `snapshot`, and
       re-subscribing on every snapshot would restart the interval forever.
       It reads the latest snapshot through a ref instead. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, pollMs, resolvedBase]);

  return useMemo(
    () => ({ connection, snapshot, health, events, stale, error, lastPolledAt, poll }),
    [connection, error, events, health, lastPolledAt, poll, snapshot, stale],
  );
}