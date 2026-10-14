import { useMemo, useState } from 'react';
import { readRoster, type TeamMember } from './roster-types';
import { AvatarTile, stateForStatus } from './avatar';
import { Notice } from './fact';
import { readFact } from './m3-readmodel';

/**
 * ConferenceView (§12) — the gallery ported from the vibe-prototype.
 *
 * PORTED: the composition. A responsive gallery of conference tiles, each
 * built around a large avatar with a role badge, a status pill and the current
 * task, plus the project/status filter bar. That is a genuinely better way to
 * see a workforce than a table row, and the prototype's layout is worth taking.
 *
 * NOT PORTED, and this is the whole point of the exercise:
 *
 *   - the prototype's active-speaker concept is a hardcoded `speaking: true`
 *     on one of eight mock agents. There is no audio, no WebRTC, and no
 *     backend field called "speaking". So this view asks the LIVE roster
 *     whether any worker reports itself as speaking, and when none does - which
 *     is every time, because the backend exposes no such field - it says so in
 *     an honest empty state instead of promoting someone to speaker.
 *   - the prototype's `interAgentChats`, `queue`, and "12/12 agents active"
 *     strings were literals. Invented chatter is not rendered here at all.
 *   - voice/video controls are DEFERRED_INTERFACE chips. A call that does not
 *     exist must not look like one that does.
 *
 * Data: the SAME `workers` fact as `roster.tsx` and `team-room.tsx`. One
 * roster, one request, three views over it.
 */

/** Does any roster row claim to be speaking? */
function speakingWorkers(rows: TeamMember[]): TeamMember[] {
  return rows.filter((w) => {
    const flag = (w as unknown as { speaking?: unknown }).speaking;
    return flag === true;
  });
}

export interface ConferenceViewProps {
  section?: Record<string, unknown>;
  /** §5.A (M4 increment 1): open the full worker inspector for a tile. */
  onSelectWorker?: (workerId: string) => void;
}

export function ConferenceView({ section, onSelectWorker }: ConferenceViewProps) {
  const rows = readRoster(section);
  const [project, setProject] = useState('all');
  const [status, setStatus] = useState('all');

  const projects = useMemo(() => uniq(rows, (w) => w.project), [rows]);
  const statuses = useMemo(() => uniq(rows, (w) => w.status), [rows]);

  if (rows === null) {
    return (
      <Notice tone="warn" testId="conference-not-exposed">
        Conference needs the supervision section&apos;s live <span className="sv-mono">workers</span> fact, and it is not
        present in this snapshot. No conference can be composed without it.
      </Notice>
    );
  }

  if (rows.length === 0) {
    return (
      <Notice tone="default" testId="conference-empty">
        The roster is exposed and currently empty. There is nobody to hold a conference with — this is an observed zero,
        not a missing source.
      </Notice>
    );
  }

  const visible = rows.filter(
    (w) => (project === 'all' || (w.project ?? '') === project) && (status === 'all' || (w.status ?? '') === status),
  );

  /* Asking the LIVE roster who is speaking. Today the answer is always
     "nobody, and the backend does not expose it", and both halves of that are
     reported. */
  const speakers = speakingWorkers(visible);
  const speakingFact = readFact(section, 'speaking');
  const speakingExposed = speakingFact !== null;

  return (
    <div className="sv-card sv-conf" data-testid="conference-view" data-tiles={visible.length} data-roster={rows.length}>
      <div className="sv-conf__head">
        <h2 className="sv-card__title">
          Conference <span className="sv-grad-text">Room</span>
        </h2>
        <div className="sv-conf__media" data-testid="conference-media-chips">
          <span className="sv-chip sv-chip--deferred" data-testid="conference-voice-chip">
            voice · <span className="sv-mono">NOT_IMPLEMENTED</span>
          </span>
          <span className="sv-chip sv-chip--deferred" data-testid="conference-video-chip">
            video · <span className="sv-mono">NOT_IMPLEMENTED</span>
          </span>
        </div>
      </div>

      {/* The honest speaker state. No fake active speaker, ever. */}
      {speakers.length === 0 ? (
        <div className="sv-conf__nobody" data-testid="conference-no-speaker" data-exposed={speakingExposed ? 'true' : 'false'}>
          {speakingExposed ? (
            <span>No worker is currently speaking.</span>
          ) : (
            <span>
              No worker is speaking. The supervisor API exposes no speaking indicator, so &ldquo;who is talking&rdquo; is{' '}
              <span className="sv-mono">NOT_EXPOSED</span> — this room will not invent one.
            </span>
          )}
        </div>
      ) : (
        <div className="sv-conf__speaker" data-testid="conference-active-speaker">
          <span className="sv-chip" data-state="LIVE_VERIFIED">
            speaking now
          </span>
          {speakers.map((w) => (
            <span className="sv-mono" key={w.worker_id}>
              {w.worker_id}
            </span>
          ))}
        </div>
      )}

      <div className="sv-conf__filters" data-testid="conference-filters">
        <Filter label="project" value={project} options={projects} onChange={setProject} id="project" />
        <Filter label="status" value={status} options={statuses} onChange={setStatus} id="status" />
        <span className="sv-muted" data-testid="conference-count">
          {visible.length} of {rows.length} in room
        </span>
      </div>

      {visible.length === 0 ? (
        <Notice tone="warn" testId="conference-filtered-empty">
          No worker matches these filters. The roster still holds {rows.length} worker{rows.length === 1 ? '' : 's'}.
        </Notice>
      ) : (
        <div className="sv-conf__grid" data-testid="conference-grid">
          {visible.map((w) => (
            <ConferenceTile key={w.worker_id} worker={w} onSelect={onSelectWorker} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * ConferenceTile — one worker in the gallery.
 *
 * The prototype's tile anatomy: large avatar, role badge top-left, status line,
 * current task along the bottom. The glow treatment is a token, so it re-grades
 * with the theme instead of being the prototype's hardcoded cyan.
 */
export function ConferenceTile({ worker, onSelect }: { worker: TeamMember; onSelect?: (workerId: string) => void }) {
  const state = stateForStatus(worker.status);
  const task = (worker.task_description ?? '').trim();

  return (
    <article
      className="sv-conf__tile"
      data-testid={`conf-tile-${worker.worker_id}`}
      data-state={state}
      aria-label={`${worker.worker_id} — ${worker.role ?? 'role not reported'}`}
      role={onSelect ? 'button' : undefined}
      tabIndex={onSelect ? 0 : undefined}
      onClick={onSelect ? () => onSelect(worker.worker_id) : undefined}
      onKeyDown={onSelect ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(worker.worker_id); }
      } : undefined}
    >
      <div className="sv-conf__tile-badge">
        <span className="sv-chip" data-testid={`conf-role-${worker.worker_id}`}>
          {worker.role?.trim() || 'role not reported'}
        </span>
      </div>

      <div className="sv-conf__tile-avatar">
        <AvatarTile workerId={worker.worker_id} role={worker.role} status={worker.status} />
      </div>

      <div className="sv-conf__tile-foot">
        <span className="sv-conf__tile-name">{worker.worker_id}</span>
        <span className="sv-conf__tile-status" data-testid={`conf-status-${worker.worker_id}`}>
          {worker.status?.trim() || 'status not reported'}
        </span>
        {/* An empty task_description is an absence: the backend sends "" here
            routinely, and a blank line would read as "nothing to say" rather
            than "the runtime did not report one". */}
        <span className={task === '' ? 'sv-conf__tile-task sv-conf__tile-task--absent' : 'sv-conf__tile-task'}>
          {task === '' ? 'task not reported' : task}
        </span>
      </div>
    </article>
  );
}

function uniq(rows: TeamMember[] | null, pick: (w: TeamMember) => string | undefined): string[] {
  const set = new Set<string>();
  for (const r of rows ?? []) {
    const v = pick(r);
    if (typeof v === 'string' && v.trim() !== '') set.add(v);
  }
  return [...set].sort();
}

function Filter({
  label,
  value,
  options,
  onChange,
  id,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
  id: string;
}) {
  return (
    <span className="sv-row" role="group" aria-label={`filter conference by ${label}`}>
      <span className="sv-muted">{label}</span>
      {['all', ...options].map((opt) => (
        <button
          key={opt}
          type="button"
          className="sv-chipbtn"
          aria-pressed={value === opt}
          onClick={() => onChange(opt)}
          data-testid={`conf-filter-${id}-${opt}`}
        >
          {opt}
        </button>
      ))}
    </span>
  );
}