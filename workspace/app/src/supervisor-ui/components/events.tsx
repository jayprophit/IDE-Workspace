import { useEffect, useMemo, useRef, useState } from 'react';
import type { SupervisorEvent } from '../api/types';

/**
 * Live-region announcements for supervisor changes.
 *
 * Restrained on purpose. A supervisor stream can carry dozens of events a
 * minute, and a live region that announces each one makes the page unusable
 * with a screen reader. So:
 *
 *   - `polite`, never `assertive`
 *   - only CHANGES in section health are announced, not raw event traffic
 *   - the previous value is retained so a re-render with identical data is
 *     silent; announcement requires an actual difference
 *   - the announcer is bounded, so a burst cannot queue unbounded speech
 */

/** What is worth speaking: a section that got worse or better. */
export interface HealthChange {
  key: string;
  label: string;
  from: string;
  to: string;
}

function describeTransition(c: HealthChange): string {
  return `${c.label} ${c.from === 'unknown' ? 'now' : c.from} to ${c.to === 'unknown' ? 'unknown' : c.to}`;
}

/**
 * Diff a map of key -> state against the previous render.
 *
 * Returns only genuine transitions. The first render produces nothing, because
 * "everything appeared" is not an event worth announcing.
 */
export function useHealthAnnouncements(health: Map<string, { label: string; state: string }>): string[] {
  const previous = useRef<Map<string, string> | null>(null);
  const [announcements, setAnnouncements] = useState<string[]>([]);

  useEffect(() => {
    const prior = previous.current;
    previous.current = new Map([...health].map(([k, v]) => [k, v.state]));

    if (prior === null) return; // baseline pass, silent

    const changes: HealthChange[] = [];
    for (const [key, value] of health) {
      const before = prior.get(key);
      if (before === undefined || before === value.state) continue;
      changes.push({ key, label: value.label, from: before, to: value.state });
    }

    if (changes.length === 0) return;
    const text = changes.slice(0, 3).map(describeTransition).join('; ');
    setAnnouncements((prev) => [text, ...prev].slice(0, 4));
  }, [health]);

  return announcements;
}

/**
 * EventFeed — the raw stream.
 *
 * Events are shown verbatim with their sequence number and the backend's own
 * timestamp. Nothing here interprets an event as a state change; that is the
 * snapshot's job, and conflating the two is how a dashboard starts lying.
 */
export function EventFeed({ events, testId = 'event-feed' }: { events: SupervisorEvent[]; testId?: string }) {
  if (events.length === 0) {
    return (
      <div className="sv-empty" data-testid={`${testId}-empty`}>
        <span className="sv-empty__title">No events yet</span>
        <span>The stream is connected and has reported nothing since the last cursor.</span>
      </div>
    );
  }

  return (
    <div data-testid={testId} role="log" aria-live="off">
      {[...events].reverse().map((e) => (
        <div className="sv-event" key={e.seq} data-testid={`event-${e.seq}`}>
          <span className="sv-event__seq">#{e.seq}</span>
          <span className="sv-event__name">{String(e.event.event ?? 'unnamed')}</span>
          <span className="sv-event__at">{e.received_at || e.event.timestamp || ''}</span>
        </div>
      ))}
    </div>
  );
}

/** Screen-reader announcer. Renders nothing when there is nothing to say. */
export function Announcer({ messages }: { messages: string[] }) {
  return (
    <div aria-live="polite" aria-atomic="false" className="sv-sr-only" data-testid="health-announcer">
      {messages.map((m, i) => (
        <p key={`${i}-${m}`}>{m}</p>
      ))}
    </div>
  );
}

/** Newest-event count since the last render, for a subtle "N new" affordance. */
export function useNewEventCount(events: SupervisorEvent[]): number {
  const seen = useRef(0);
  const [count, setCount] = useState(0);
  const length = events.length;

  useEffect(() => {
    if (seen.current === 0) {
      seen.current = length;
      return;
    }
    if (length > seen.current) setCount((c) => c + (length - seen.current));
    seen.current = length;
  }, [length]);

  return count;
}

/** Convenience: build the health map a section-rollup would produce. */
export function useHealthMap(entries: { key: string; label: string; state: string }[]): Map<string, { label: string; state: string }> {
  return useMemo(() => new Map(entries.map((e) => [e.key, { label: e.label, state: e.state }])), [entries]);
}