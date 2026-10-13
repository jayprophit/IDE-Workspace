import type { TeamMember } from './roster-types';
import { AvatarTile, stateForStatus } from './avatar';

/**
 * WorkerCard (§7, AV-1..AV-8).
 *
 * A worker reads as a person, not a row: large avatar, identity, role, what
 * they are doing, what they are blocked on, and how to reach them.
 *
 * Honesty rules this component enforces, all of them load-bearing:
 *
 *   - an empty string from the runtime renders as "not reported", NEVER as a
 *     blank cell that could be mistaken for a rendering failure, and NEVER as
 *     a placeholder value the runtime did not send. Real rosters have `""` for
 *     project, model and task_description, and those are absences, not data.
 *   - an unrecognised worker status renders as UNKNOWN and a dashed ring, not
 *     as a healthy colour. `stateForStatus` is conservative on purpose.
 *   - quota is shown with its reset time whenever the worker is waiting on
 *     quota, because that is the single most actionable thing on the card.
 *   - actions with no backend route are rendered DISABLED and DASHED, so the
 *     capability gap is visible before a click rather than after it.
 */

/** Worker actions from §5 / §7. `live` means a real endpoint exists. */
export interface WorkerActionDef {
  id: string;
  label: string;
  live: boolean;
  /** Shown on a deferred control so the reason is legible without a click. */
  reason?: string;
}

/**
 * The eleven worker actions, transcribed from §5 of the reference matrix:
 *   click / talk / inspect / view task / view files / view tests / continue /
 *   pause / reassign / change model / open application.
 *
 * LIVE only where a real endpoint exists today (`inspect`, `continue` - both
 * already wired through api/client.ts by the §17.J/§18 roster work). The rest
 * are DEFERRED_INTERFACE and stay disabled until a route exists.
 *
 * `click` needs no endpoint: selecting a card is pure client state, so it is
 * the one non-adapter action that is live.
 */
export const WORKER_ACTIONS: WorkerActionDef[] = [
  { id: 'click', label: 'Select', live: true },
  { id: 'inspect', label: 'Inspect', live: true },
  { id: 'continue', label: 'Continue', live: true },
  { id: 'talk', label: 'Talk', live: false, reason: 'inter-agent messaging interface not exposed' },
  { id: 'view-task', label: 'Task', live: false, reason: 'task view interface not exposed' },
  { id: 'view-files', label: 'Files', live: false, reason: 'file view interface not exposed' },
  { id: 'view-tests', label: 'Tests', live: false, reason: 'test view interface not exposed' },
  { id: 'pause', label: 'Pause', live: false, reason: 'pause control not exposed' },
  { id: 'reassign', label: 'Reassign', live: false, reason: 'reassignment interface not exposed' },
  { id: 'change-model', label: 'Change model', live: false, reason: 'model-change interface not exposed' },
  { id: 'open-app', label: 'Open app', live: false, reason: 'application launch interface not exposed' },
];

export const LIVE_ACTIONS = WORKER_ACTIONS.filter((a) => a.live).map((a) => a.id);
export const DEFERRED_ACTIONS = WORKER_ACTIONS.filter((a) => !a.live).map((a) => a.id);

/** Human text for a value the runtime may legitimately leave empty. */
function orAbsent(value: string | undefined | null, absent = 'not reported'): string | null {
  const v = typeof value === 'string' ? value.trim() : '';
  return v === '' ? absent : v;
}

export interface WorkerCardProps {
  worker: TeamMember;
  selected?: boolean;
  busy?: boolean;
  onAction?: (worker: TeamMember, actionId: string) => void;
  /** Evidence/progress shown when the runtime supplied any. */
  evidence?: string[];
}

export function WorkerCard({ worker, selected, busy, onAction, evidence }: WorkerCardProps) {
  const state = stateForStatus(worker.status);
  const quota = worker.quota_state ?? {};
  const waitingForQuota = (worker.status ?? '').toUpperCase() === 'WAITING_FOR_QUOTA';

  const project = orAbsent(worker.project);
  const task = orAbsent(worker.task_description);
  const model = orAbsent(worker.model);
  const writeOwnership = orAbsent(worker.write_set ?? worker.write_ownership);
  const resetAt = typeof quota.reset_at === 'string' ? quota.reset_at : '';
  const resetsIn = typeof quota.resets_in_s === 'number' ? Math.max(0, Math.round(quota.resets_in_s)) : null;
  const heartbeatAge = typeof worker.last_heartbeat === 'number' ? Math.max(0, Date.now() / 1000 - worker.last_heartbeat) : null;

  return (
    <article
      className="sv-worker-card"
      data-selected={selected ? 'true' : 'false'}
      data-testid={`worker-card-${worker.worker_id}`}
      data-state={state}
    >
      <header className="sv-worker-card__head">
        <AvatarTile workerId={worker.worker_id} role={worker.role} status={worker.status} />

        <div className="sv-worker-card__id">
          <span className="sv-worker-card__name" data-testid={`wc-name-${worker.worker_id}`}>
            {worker.worker_id}
          </span>
          <span className="sv-worker-card__role" data-testid={`wc-role-${worker.worker_id}`}>
            {orAbsent(worker.role, 'role not reported')}
          </span>
          <span className="sv-worker-card__status" data-state={state}>
            <span className="sv-worker-card__dot" data-state={state} aria-hidden="true" />
            <span data-testid={`wc-status-${worker.worker_id}`}>{orAbsent(worker.status, 'status not reported')}</span>
          </span>
        </div>
      </header>

      {/* Quota first: when a worker is blocked on quota it is the only thing
          on the card that changes what a person would do next. */}
      {waitingForQuota && (
        <div className="sv-worker-card__quota" data-testid={`wc-quota-${worker.worker_id}`}>
          <strong>waiting for quota</strong>
          {typeof quota.pool === 'string' && quota.pool !== '' && <span className="sv-mono">{quota.pool}</span>}
          {resetAt !== '' && (
            <span data-testid={`wc-quota-reset-${worker.worker_id}`}>
              resets {resetAt}
              {resetsIn !== null ? ` (${formatDuration(resetsIn)})` : ''}
            </span>
          )}
          {resetAt === '' && <span>reset time not reported</span>}
        </div>
      )}

      <div className="sv-worker-card__facts">
        <Row label="project" value={project} testId={`wc-project-${worker.worker_id}`} />
        <Row label="task" value={task} testId={`wc-task-${worker.worker_id}`} />
        <Row label="model" value={model} testId={`wc-model-${worker.worker_id}`} />
        <Row label="provider" value={orAbsent(worker.provider)} testId={`wc-provider-${worker.worker_id}`} />
        <Row label="application" value={orAbsent(worker.application)} testId={`wc-app-${worker.worker_id}`} />
        <Row label="write set" value={writeOwnership} testId={`wc-write-${worker.worker_id}`} />
        <Row label="heartbeat" value={heartbeatAge === null ? 'not reported' : formatDuration(heartbeatAge) + ' ago'} testId={`wc-heartbeat-${worker.worker_id}`} />
      </div>

      {/* Progress / evidence: AV-7. Only ever what the runtime supplied. */}
      {evidence && evidence.length > 0 && (
        <div className="sv-col" data-testid={`wc-evidence-${worker.worker_id}`}>
          <span className="sv-stat__label">evidence</span>
          {evidence.slice(0, 3).map((e, i) => (
            <span className="sv-mono sv-truncate" key={i} title={e}>
              {e}
            </span>
          ))}
        </div>
      )}

      <div className="sv-worker-card__actions" data-testid={`wc-actions-${worker.worker_id}`}>
        {WORKER_ACTIONS.map((a) => (
          <button
            key={a.id}
            type="button"
            className={`sv-worker-card__btn${a.live ? ' sv-worker-card__btn--live' : ' sv-worker-card__btn--deferred'}${a.id === 'continue' ? ' sv-worker-card__btn--primary' : ''}`}
            disabled={!a.live || busy}
            title={a.live ? a.label : `${a.label}: ${a.reason}`}
            aria-describedby={a.live ? undefined : `act-reason-${a.id}`}
            /* `data-capability`, not `data-live`: genesis-ui owns `data-live`
               in the frozen renderer vocabulary and bounds.test.ts forbids
               supervisor-ui from touching it. This flag records whether a real
               endpoint backs the control, which is a different question. */
            data-capability={a.live ? 'available' : 'deferred'}
            data-testid={`wc-action-${a.id}-${worker.worker_id}`}
            onClick={() => onAction?.(worker, a.id)}
          >
            {a.label}
            {!a.live && (
              <span className="sv-sr-only" id={`act-reason-${a.id}`}>
                {a.reason}
              </span>
            )}
          </button>
        ))}
      </div>
    </article>
  );
}

function Row({ label, value, testId }: { label: string; value: string | null; testId?: string }) {
  const absent = value === null;
  return (
    <div className="sv-worker-card__row">
      <span className="sv-worker-card__key">{label}</span>
      <span className={`sv-worker-card__val${absent ? ' sv-worker-card__val--absent' : ''}`} data-testid={testId}>
        {value ?? 'not reported'}
      </span>
    </div>
  );
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}