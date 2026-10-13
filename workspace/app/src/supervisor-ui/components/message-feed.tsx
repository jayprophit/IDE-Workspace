import { useMemo, useState } from 'react';
import type { SupervisorEvent } from '../api/types';

/**
 * MessageFeed (§14) — the vibe-prototype's ChatPanel list, made honest.
 *
 * PORTED: the list anatomy. One row per event with a type badge, a readable
 * timestamp, the worker it concerns, and a payload summary — the same
 * information hierarchy the prototype's chat rows used, applied to real
 * machine events instead of invented conversation.
 *
 * NOT PORTED, deliberately and completely:
 *   - the prototype's `mentionsList` (invented agents and files), the "JD"
 *     hardcoded user initials, the "Autonomous Planner" fixed role, and the
 *     four-message inter-agent transcript were all literals. A dashboard that
 *     invents chatter between workers is worse than one with no chat, because
 *     a person cannot tell invented rows from real ones.
 *   - there is no composer here. The supervisor API is read-only plus the
 *     §17.J/§18 worker controls; it exposes no way to post a message, so a
 *     send box would be a control that cannot send.
 *
 * DATA: `events` is a prop, supplied by the caller from the EXISTING
 * `useSupervisor()` hook. This component performs no fetch of its own and
 * opens no second stream — the events it renders are already in memory,
 * shared with the Events tab.
 */

/** How a raw event name reads to a person. */
const TYPE_PHRASE: Record<string, string> = {
  worker_status: 'worker status',
  worker_started: 'worker started',
  worker_finished: 'worker finished',
  task_started: 'task started',
  task_finished: 'task finished',
  handoff: 'handoff',
  gap_opened: 'gap opened',
  gap_closed: 'gap closed',
  decision: 'decision',
  test_result: 'test result',
  quota: 'quota',
  error: 'error',
  heartbeat: 'heartbeat',
};

/**
 * Turn an event name into prose.
 *
 * Unknown names are passed through with underscores replaced, never guessed at.
 * An event type this build has never seen is still worth showing verbatim —
 * inventing a friendlier label would risk misdescribing what happened.
 */
export function humanType(raw: string): string {
  const key = raw.trim().toLowerCase();
  if (key === '') return 'unnamed event';
  return TYPE_PHRASE[key] ?? key.replace(/_/g, ' ');
}

/**
 * Pull the worker id out of an event payload.
 *
 * Looks in the handful of keys the runtime actually uses. Returns null when it
 * cannot find one — the row then says so rather than attributing the event to
 * an unnamed worker that may not exist.
 */
export function workerOf(event: SupervisorEvent): string | null {
  const e = event.event as Record<string, unknown>;
  for (const key of ['worker_id', 'worker', 'agent_id', 'agent']) {
    const v = e[key];
    if (typeof v === 'string' && v.trim() !== '') return v.trim();
  }
  return null;
}

/**
 * One-line payload summary.
 *
 * Only scalar fields are summarised. A nested object is described by its key
 * count rather than dumped as JSON, because a wall of escaped JSON in a feed
 * is unreadable and would obscure the one useful line above it.
 */
export function summarise(event: SupervisorEvent, limit = 3): string {
  const e = event.event as Record<string, unknown>;
  const parts: string[] = [];
  for (const [key, value] of Object.entries(e)) {
    if (parts.length >= limit) break;
    if (key === 'event' || key === 'timestamp') continue;
    if (value === null || value === undefined) continue;
    if (typeof value === 'string') parts.push(`${key}=${value}`);
    else if (typeof value === 'number' || typeof value === 'boolean') parts.push(`${key}=${String(value)}`);
    else if (Array.isArray(value)) parts.push(`${key}=[${value.length}]`);
    else if (typeof value === 'object') parts.push(`${key}={${Object.keys(value as object).length}}`);
  }
  return parts.length === 0 ? 'no payload' : parts.join('  ');
}

/**
 * RFC3339 or epoch-millis to a readable clock time, or the raw value.
 *
 * Formatted with `toISOString` + slice rather than `toLocaleTimeString`: the
 * locale formatter pulls in ICU, which is both heavier than this view needs and
 * capable of stalling a test run for seconds. The supervisor stream is
 * machine-generated and already carries UTC ISO timestamps, so a stable UTC
 * clock is also the least surprising thing to show. The source timestamp is
 * still rendered verbatim in the tooltip, so the UTC choice is visible rather
 * than hidden.
 */
export function readableTime(event: SupervisorEvent): string {
  const candidates = [event.event.timestamp, event.received_at];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim() !== '') {
      const ms = Date.parse(c);
      if (!Number.isNaN(ms)) return `${new Date(ms).toISOString().slice(11, 19)}Z`;
      return c;
    }
    if (typeof c === 'number' && Number.isFinite(c)) {
      return `${new Date(c).toISOString().slice(11, 19)}Z`;
    }
  }
  return 'time not reported';
}

export interface MessageFeedProps {
  /** Already in memory from useSupervisor(). This component never fetches. */
  events: SupervisorEvent[];
  /** Rendered when the stream is connected but silent. */
  testId?: string;
}

export function MessageFeed({ events, testId = 'message-feed' }: MessageFeedProps) {
  const [onlyWorkers, setOnlyWorkers] = useState(false);

  /* Newest first, the way a message list reads. The hook already caps the
     buffer; reversing is presentation, not a second ordering of the truth. */
  const ordered = useMemo(() => [...events].reverse(), [events]);

  const visible = useMemo(() => (onlyWorkers ? ordered.filter((e) => workerOf(e) !== null) : ordered), [onlyWorkers, ordered]);

  if (events.length === 0) {
    return (
      <div className="sv-empty" data-testid={`${testId}-empty`}>
        <span className="sv-empty__title">No events yet</span>
        <span>
          The supervisor event stream is connected and has reported nothing since the last cursor. No message is invented
          to fill this space.
        </span>
      </div>
    );
  }

  return (
    <div data-testid={testId}>
      <div className="sv-conf__filters">
        <span className="sv-muted">{events.length} event{events.length === 1 ? '' : 's'} from the live stream</span>
        <button
          type="button"
          className="sv-chipbtn"
          aria-pressed={onlyWorkers}
          onClick={() => setOnlyWorkers((v) => !v)}
          data-testid="msgfilter-workers"
        >
          worker events only
        </button>
      </div>

      {visible.length === 0 ? (
        <div className="sv-empty" data-testid={`${testId}-filtered-empty`}>
          <span className="sv-empty__title">No worker events in the buffer</span>
          <span>
            The stream has {events.length} event{events.length === 1 ? '' : 's'}, none of which name a worker. Turn the
            filter off to see them.
          </span>
        </div>
      ) : (
        /* role="log" so assistive tech treats this as a chronological record.
           aria-live is OFF: a supervisor stream can produce a burst, and
           announcing every row makes the page unusable. */
        <div className="sv-msgfeed" role="log" aria-live="off" data-testid={`${testId}-list`}>
          {visible.map((e) => {
            const worker = workerOf(e);
            return (
              <article className="sv-msg" key={e.seq} data-testid={`msg-${e.seq}`}>
                <div className="sv-msg__head">
                  <span className="sv-msg__type" data-testid={`msg-type-${e.seq}`}>
                    {humanType(String(e.event.event ?? ''))}
                  </span>
                  <span className="sv-msg__worker" data-testid={`msg-worker-${e.seq}`}>
                    {worker ?? 'worker not reported'}
                  </span>
                  <span className="sv-msg__time" title={String(e.event.timestamp ?? e.received_at ?? 'not reported')}>
                    {readableTime(e)}
                  </span>
                  <span className="sv-msg__seq sv-mono">#{e.seq}</span>
                </div>
                <div className="sv-msg__payload sv-mono" data-testid={`msg-payload-${e.seq}`}>
                  {summarise(e)}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}