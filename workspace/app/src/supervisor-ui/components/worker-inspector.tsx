import { useEffect, useState } from 'react';
import { fetchWorkerDetail, continueWorker } from '../api/client';
import type { WorkerDetail } from '../api/types';
import { AvatarTile } from './avatar';
import { FactChip, Card } from './fact';
import { readRoster } from './roster-types';

/**
 * WorkerInspector — the §5.A full worker view.
 *
 * M4 increment 1. Clicking a worker card or conference tile opens this
 * inspector over the SAME live data the rest of the UI reads: the roster
 * comes from the snapshot's supervision section (readRoster — one request,
 * one fact, no second stream), and the detail facts come from the existing
 * worker-detail route via fetchWorkerDetail (already tested in
 * client.test.ts). NO new fetch path, NO parallel store.
 *
 * HONESTY CONTRACT: every field with no backend fact renders a NOT_EXPOSED
 * chip — never placeholder text, never invented values. The runtime genuinely
 * sends empty strings for project/model/task on idle workers; those are
 * absences and this component renders them as absences.
 */

interface Props {
  workerId: string | null;
  /** The live supervision section, for roster-derived fields. */
  supervision?: Record<string, unknown>;
  onClose: () => void;
  baseUrl?: string;
}

interface Row {
  label: string;
  value: string;
  /** 'live' = real backend fact; 'absent' = the backend exposed no value. */
  state: 'live' | 'absent';
}

function rowsFromDetail(d: WorkerDetail | null): Row[] {
  if (!d) return [];
  const rows: Row[] = [];
  const push = (label: string, v: unknown) => {
    const s = typeof v === 'string' ? v.trim() : v == null ? '' : String(v);
    rows.push({ label, value: s, state: s ? 'live' : 'absent' });
  };
  push('Application', d.application);
  push('Role', d.role);
  push('Verdict', d.verdict);
  const q = d.quota ?? {};
  if (Object.keys(q).length > 0) {
    push('Quota pool', q.pool);
    push('Quota reset', q.reset_at);
    const rem = q.quota_remaining;
    push('Quota remaining', rem == null ? '' : String(rem));
  }
  const ct = d.current_task ?? {};
  if (Object.keys(ct).length > 0) {
    push('Task', ct.task_description ?? ct.title);
    push('Milestone', ct.milestone);
    push('Project', ct.project);
  }
  const rec = d.record ?? {};
  if (Object.keys(rec).length > 0) {
    push('Model', rec.model);
    push('Provider', rec.provider);
    push('Plan', rec.plan);
    push('Write ownership', rec.write_ownership);
  }
  if (d.evidence.length > 0) {
    rows.push({ label: 'Evidence', value: d.evidence.join(' · '), state: 'live' });
  }
  return rows;
}

export function WorkerInspector({ workerId, supervision, onClose, baseUrl }: Props) {
  const [detail, setDetail] = useState<WorkerDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [continuing, setContinuing] = useState(false);
  const [continueNote, setContinueNote] = useState<string | null>(null);

  useEffect(() => {
    if (!workerId) { setDetail(null); return; }
    let cancelled = false;
    setLoading(true);
    fetchWorkerDetail(workerId, baseUrl).then((d) => {
      if (!cancelled) { setDetail(d); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [workerId, baseUrl]);

  if (!workerId) return null;

  // roster-derived identity: the SAME workers fact roster.tsx/team-room read
  const roster = readRoster(supervision) ?? [];
  const member = roster.find((m) => m.worker_id === workerId);
  const rows = rowsFromDetail(detail);

  const onContinue = async () => {
    setContinuing(true);
    setContinueNote(null);
    const res = await continueWorker(workerId, baseUrl);
    setContinueNote(res.delivered
      ? `Continue delivered via ${res.channel ?? 'adapter'}.`
      : `Continue NOT delivered${res.error_code ? ` (${res.error_code})` : ''}.`);
    setContinuing(false);
  };

  return (
    <Card testId="worker-inspector" title={`Inspector — ${workerId}`}>
      <div className="sv-col sv-gap-12">
        <div className="sv-row sv-gap-12 sv-items-center">
          <AvatarTile
            workerId={workerId}
            role={member?.role ?? detail?.role}
            status={member?.status ?? detail?.verdict}
            size="lg"
            testId={`inspector-avatar-${workerId}`}
          />
          <div className="sv-col sv-gap-4">
            <span className="sv-mono" data-testid="inspector-worker-id">{workerId}</span>
            <span className="sv-muted" data-testid="inspector-status">
              {member?.status ?? detail?.verdict ?? '—'}
            </span>
          </div>
        </div>

        {loading && <span className="sv-muted">Loading live worker detail…</span>}
        {!loading && detail && !detail.ok && (
          <span className="sv-muted" data-testid="inspector-unreachable">
            Worker detail unreachable{detail.error_code ? ` (${detail.error_code})` : ''}
          </span>
        )}

        <div className="sv-col sv-gap-6" data-testid="inspector-rows">
          {rows.length === 0 && !loading && (
            <span className="sv-muted" data-testid="inspector-no-facts">
              No detail facts exposed for this worker yet.
            </span>
          )}
          {rows.map((r) => (
            <div key={r.label} className="sv-row sv-gap-8">
              <span className="sv-inspector__label">{r.label}</span>
              {r.state === 'live'
                ? <span className="sv-mono" data-testid={`inspector-${r.label.toLowerCase().replace(/\s+/g, '-')}`}>{r.value}</span>
                : <FactChip state="NOT_EXPOSED" testId={`inspector-${r.label.toLowerCase().replace(/\s+/g, '-')}-absent`} />}
            </div>
          ))}
        </div>

        <div className="sv-row sv-gap-8">
          <button
            type="button"
            className="sv-btn"
            data-testid="inspector-continue"
            disabled={continuing}
            onClick={onContinue}
          >
            {continuing ? 'Continuing…' : 'Continue worker'}
          </button>
          <button
            type="button"
            className="sv-btn"
            data-testid="inspector-close"
            onClick={onClose}
          >
            Close
          </button>
          {continueNote && (
            <span className="sv-muted" data-testid="inspector-continue-note">{continueNote}</span>
          )}
        </div>
      </div>
    </Card>
  );
}
