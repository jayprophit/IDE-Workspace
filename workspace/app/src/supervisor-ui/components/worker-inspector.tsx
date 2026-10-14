import { useEffect, useState } from 'react';
import { fetchWorkerDetail, continueWorker } from '../api/client';
import type { WorkerDetail } from '../api/types';
import { AvatarTile } from './avatar';
import { FactChip, Card } from './fact';
import { readRoster, type TeamMember } from './roster-types';

/**
 * WorkerInspector — the §5.A full worker view.
 *
 * M4 increment 1. Opens when a worker is selected anywhere in the UI (roster,
 * team room, conference gallery) and shows everything the backend actually
 * says about that worker.
 *
 * DATA — one roster, one detail route, no parallel store:
 *   - identity comes from the SAME supervision `workers` fact that
 *     `roster.tsx` / `team-room.tsx` / `conference.tsx` read (readRoster)
 *   - detail comes from the existing worker-detail route via fetchWorkerDetail,
 *     already covered by api/client.test.ts
 *   - there is no second event stream and no second snapshot poll
 *
 * HONESTY CONTRACT — the load-bearing rule of this component:
 *
 *   Every row is rendered even when the backend has nothing to say about it.
 *   A missing field renders a NOT_EXPOSED chip, never a blank, never a dash
 *   that could read as "zero", and never placeholder text like "N/A" or "unknown"
 *   dressed up as if it were a value.
 *
 *   This matters because the live record is mostly empty: the runtime sends ""
 *   for project, model, provider, write_set, task_description, next_action and
 *   handoff_state on an idle worker, and `[]`/`{}` for files_changed, tests and
 *   blockers. Those are ABSENCES. Rendering them as "0 files changed" or an
 *   empty list would be a fabrication - the runtime never reported a count of
 *   zero, it reported nothing at all. So:
 *
 *     undefined / null / ""  -> NOT_EXPOSED chip
 *     []  / {}               -> "none reported"  (observed zero, distinct)
 *     a real value           -> the value
 *
 *   That distinction is the difference between "the backend said none" and
 *   "the backend said nothing", and collapsing it is how a dashboard starts
 *   lying about a worker.
 */

export interface WorkerInspectorProps {
  workerId: string | null;
  /** The live supervision section, for roster-derived identity. */
  supervision?: Record<string, unknown>;
  onClose: () => void;
  baseUrl?: string;
}

/** How a field was sourced — drives the rendering, never inferred from the value. */
type Sourced = 'live' | 'empty' | 'absent';

interface Field {
  key: string;
  label: string;
  /** Present only when sourced === 'live'. */
  value?: string;
  /** How the backend answered. */
  sourced: Sourced;
}

/**
 * Classify a raw record value.
 *
 * The three-way split is the whole point: an empty collection is an OBSERVED
 * zero and is shown as such, while an absent key is an UNOBSERVED field and
 * gets the NOT_EXPOSED chip. Both are honest, and they are not the same.
 */
function classify(v: unknown): { sourced: Sourced; text?: string } {
  if (v === undefined || v === null) return { sourced: 'absent' };

  if (typeof v === 'string') {
    const t = v.trim();
    return t === '' ? { sourced: 'absent' } : { sourced: 'live', text: t };
  }
  if (typeof v === 'number') {
    return Number.isFinite(v) ? { sourced: 'live', text: String(v) } : { sourced: 'absent' };
  }
  if (typeof v === 'boolean') {
    return { sourced: 'live', text: v ? 'yes' : 'no' };
  }
  if (Array.isArray(v)) {
    return v.length === 0 ? { sourced: 'empty' } : { sourced: 'live', text: v.map((x) => String(x)).join(', ') };
  }
  if (typeof v === 'object') {
    const rec = v as Record<string, unknown>;
    const keys = Object.keys(rec);
    if (keys.length === 0) return { sourced: 'empty' };
    /* A nested object is described by its key/value pairs rather than dumped
       as escaped JSON, which is unreadable in a narrow inspector column. */
    const parts = keys.slice(0, 4).map((k) => `${k}=${String(rec[k])}`);
    return { sourced: 'live', text: `${parts.join(' ')}${keys.length > 4 ? ` +${keys.length - 4} more` : ''}` };
  }
  return { sourced: 'absent' };
}

/** Build one field row from a raw value. */
function field(key: string, label: string, v: unknown): Field {
  const c = classify(v);
  return { key, label, sourced: c.sourced, value: c.text };
}

/**
 * Every §5.A field, from the worker record + quota + current_task.
 *
 * The record is the backend's own per-worker record; each key below is one the
 * runtime actually emits (verified against a live worker-detail response), so
 * a missing key means "not reported" rather than "not implemented".
 */
export function fieldsFromDetail(d: WorkerDetail | null): Field[] {
  const rec = (d?.record ?? {}) as Record<string, unknown>;
  const quota = (d?.quota ?? {}) as Record<string, unknown>;
  const task = (d?.current_task ?? {}) as Record<string, unknown>;

  const rows: Field[] = [
    /* identity — from the detail payload, which is authoritative for the
       selected worker rather than whatever the roster snapshot last held */
    field('application', 'Application', d?.application),
    field('role', 'Role', d?.role),
    field('status', 'Status', d?.verdict ?? rec.status),
    field('model', 'Model', rec.model),
    field('provider', 'Provider', rec.provider),
    field('plan', 'Plan', rec.plan ?? rec.tier),
    field('phase', 'Phase', rec.phase),
    field('worker_type', 'Worker type', rec.worker_type),

    /* work */
    field('project', 'Project', rec.project),
    field('task', 'Task', rec.task_description ?? task.task_description ?? task.task),
    field('task_id', 'Task id', rec.task_id),
    field('milestone', 'Milestone', task.milestone),
    field('write_ownership', 'Write ownership', rec.write_set ?? rec.write_ownership),
    field('repo', 'Repo', rec.repo),
    field('branch', 'Branch', rec.branch),
    field('worktree', 'Worktree', rec.worktree),

    /* quota — the reason most workers block */
    field('quota_pool', 'Quota pool', quota.pool ?? (rec.quota_state as Record<string, unknown>)?.pool),
    field('quota_reset', 'Quota reset', quota.reset_at ?? (rec.quota_state as Record<string, unknown>)?.reset_at),
    field(
      'quota_resets_in',
      'Quota resets in',
      quota.resets_in_s ?? (rec.quota_state as Record<string, unknown>)?.resets_in_s,
    ),

    /* activity + evidence */
    field('files_changed', 'Files changed', rec.files_changed),
    field('tests', 'Tests', rec.tests),
    field('git_latest_commit', 'Latest commit', rec.latest_commit),
    field('git_latest_push', 'Latest push', rec.latest_push),
    field('blockers', 'Blockers', rec.blockers),
    field('handoffs', 'Handoffs', rec.handoff_state),
    field('review_state', 'Review state', rec.review_state),
    field('next_action', 'Next action', rec.next_action),
    field('started_at', 'Started at', rec.started_at),
    field('last_activity', 'Last activity', rec.last_activity),
  ];

  if (d && d.evidence.length > 0) {
    rows.push({
      key: 'evidence',
      label: 'Evidence',
      sourced: 'live',
      value: d.evidence.join('\n'),
    });
  }
  return rows;
}

/* ---------------------------------------------------------------------------
 * Rendering
 * ------------------------------------------------------------------------ */

export function WorkerInspector({ workerId, supervision, onClose, baseUrl }: WorkerInspectorProps) {
  const [detail, setDetail] = useState<WorkerDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [continuing, setContinuing] = useState(false);
  const [continueNote, setContinueNote] = useState<string | null>(null);

  useEffect(() => {
    if (!workerId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setContinueNote(null);
    fetchWorkerDetail(workerId, baseUrl).then((d) => {
      /* The guard matters: StrictMode double-invokes effects in dev, and a
         slow response for a worker the user has already navigated away from
         must not overwrite the current one. */
      if (!cancelled) {
        setDetail(d);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [workerId, baseUrl]);

  const onContinue = async () => {
    if (!workerId) return;
    setContinuing(true);
    setContinueNote(null);
    const res = await continueWorker(workerId, baseUrl);
    /* `delivered` is echoed from the adapter and nothing else. `ok: true` with
       `delivered: false` means the call reached the backend but no real
       channel carried it - reporting success there would be a lie. */
    setContinueNote(
      res.delivered
        ? `Continue delivered via ${res.channel ?? 'adapter'}.`
        : `Continue NOT delivered${res.error_code ? ` (${res.error_code})` : ''}.`,
    );
    setContinuing(false);
  };

  if (!workerId) return null;

  const roster: TeamMember[] = readRoster(supervision) ?? [];
  const member = roster.find((m) => m.worker_id === workerId);
  const rows = fieldsFromDetail(detail);

  return (
    <Card testId="worker-inspector" title={`Inspector — ${workerId}`}>
      <div className="sv-inspector" data-testid="inspector-body" data-worker={workerId}>
        <div className="sv-inspector__head">
          <AvatarTile
            workerId={workerId}
            role={member?.role ?? detail?.role}
            status={member?.status ?? detail?.verdict}
            size="lg"
            testId={`inspector-avatar-${workerId}`}
          />
          <div className="sv-col sv-inspector__id">
            <span className="sv-mono" data-testid="inspector-worker-id">
              {workerId}
            </span>
            <span className="sv-muted" data-testid="inspector-status">
              {member?.status ?? detail?.verdict ?? 'status not reported'}
            </span>
          </div>
        </div>

        {loading && (
          <span className="sv-muted" data-testid="inspector-loading">
            Loading live worker detail…
          </span>
        )}

        {/* An unreachable detail route is reported as such. It never falls back
            to rendering an empty inspector, which would look identical to a
            worker that has no facts. */}
        {!loading && detail && !detail.ok && (
          <span className="sv-muted" data-testid="inspector-unreachable">
            Worker detail unreachable{detail.error_code ? ` (${detail.error_code})` : ''}
          </span>
        )}

        <div className="sv-inspector__rows" data-testid="inspector-rows">
          {rows.map((r) => (
            <div key={r.key} className="sv-inspector__row" data-testid={`inspector-row-${r.key}`}>
              <span className="sv-inspector__label">{r.label}</span>
              {r.sourced === 'live' && (
                <span className="sv-inspector__value sv-mono" data-testid={`inspector-value-${r.key}`}>
                  {r.value}
                </span>
              )}
              {r.sourced === 'empty' && (
                /* Observed zero: the backend reported a collection and it was
                   empty. Distinct from not exposed, and labelled as such. */
                <span className="sv-inspector__value sv-inspector__value--empty" data-testid={`inspector-empty-${r.key}`}>
                  none reported
                </span>
              )}
              {r.sourced === 'absent' && (
                <FactChip state="NOT_EXPOSED" testId={`inspector-absent-${r.key}`} />
              )}
            </div>
          ))}
        </div>

        <div className="sv-inspector__actions">
          <button type="button" className="sv-btn" data-testid="inspector-continue" disabled={continuing} onClick={onContinue}>
            {continuing ? 'Continuing…' : 'Continue worker'}
          </button>
          <button type="button" className="sv-btn" data-testid="inspector-close" onClick={onClose}>
            Close
          </button>
          {continueNote && (
            <span className="sv-muted" data-testid="inspector-continue-note">
              {continueNote}
            </span>
          )}
        </div>
      </div>
    </Card>
  );
}

export default WorkerInspector;