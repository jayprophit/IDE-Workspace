import { useCallback, useState } from 'react';
import { continueWorker, fetchWorkerDetail, isSourceFact } from '../api/client';
import type { WorkerContinueResult, WorkerDetail } from '../api/types';
import { Notice } from './fact';

/* ---------------------------------------------------------------------------
 * §17.J / §18 Worker roster + control surface
 *
 * Reads the live per-worker roster from the supervision section's `workers`
 * fact (same records the runtime cycle uses). A row click opens that worker's
 * detail (verdict, task, quota, evidence); a Continue button issues a real
 * continue instruction through the worker's own adapter channel.
 *
 * Honesty (§15): every value shown comes from a SourceFact or a live detail
 * response. An unreachable backend says UNREACHABLE, never a fabricated row.
 * ------------------------------------------------------------------------ */

interface RosterRow {
  worker_id: string;
  application?: string;
  role?: string;
  status?: string;
  task_description?: string;
  quota_state?: Record<string, unknown>;
  review_state?: string;
}

function readRoster(section: Record<string, unknown> | undefined): RosterRow[] | null {
  if (!section) return null;
  const fact = section['workers'];
  if (!isSourceFact(fact) || !Array.isArray(fact.value)) return null;
  return fact.value as RosterRow[];
}

export function WorkerRoster({ section }: { section: Record<string, unknown> | undefined }) {
  const rows = readRoster(section);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<WorkerDetail | null>(null);
  const [continueResult, setContinueResult] = useState<WorkerContinueResult | null>(null);
  const [busy, setBusy] = useState(false);

  const openWorker = useCallback(async (workerId: string) => {
    setSelected(workerId);
    setDetail(null);
    setContinueResult(null);
    const d = await fetchWorkerDetail(workerId);
    setDetail(d);
  }, []);

  const onContinue = useCallback(async (workerId: string) => {
    setBusy(true);
    setContinueResult(null);
    const r = await continueWorker(workerId);
    setContinueResult(r);
    setBusy(false);
    // refresh the detail so the roster reflects the new state
    const d = await fetchWorkerDetail(workerId);
    setDetail(d);
  }, []);

  if (rows === null) {
    return <Notice tone="warn" testId="roster-not-exposed">Worker roster not exposed by the backend.</Notice>;
  }
  if (rows.length === 0) {
    return <Notice tone="default" testId="roster-empty">No workers registered in the live supervision registry.</Notice>;
  }

  return (
    <div className="sv-col" data-testid="worker-roster">
      <div className="sv-scroll" style={{ maxHeight: 260 }}>
        <table className="sv-table" data-testid="roster-table">
          <thead>
            <tr><th>worker</th><th>app</th><th>status</th><th>task</th><th></th></tr>
          </thead>
          <tbody>
            {rows.map((w) => (
              <tr
                key={w.worker_id}
                data-testid={`roster-row-${w.worker_id}`}
                className={selected === w.worker_id ? 'sv-row--selected' : undefined}
              >
                <td className="sv-mono">{w.worker_id}</td>
                <td>{w.application ?? '—'}</td>
                <td>{w.status ?? '—'}</td>
                <td>{(w.task_description || '—').slice(0, 48)}</td>
                <td>
                  <button
                    type="button"
                    className="sv-btn"
                    data-testid={`roster-open-${w.worker_id}`}
                    onClick={() => void openWorker(w.worker_id)}
                  >
                    inspect
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected && (
        <div className="sv-col" data-testid="worker-detail">
          <div className="sv-row">
            <span className="sv-mono sv-small" data-testid="detail-worker-id">{selected}</span>
          </div>
          {detail === null && <Notice tone="default">loading…</Notice>}
          {detail && !detail.ok && (
            <Notice tone="warn" testId="detail-error">{detail.error_code ?? 'unreachable'}{detail.detail ? `: ${detail.detail}` : ''}</Notice>
          )}
          {detail && detail.ok && (
            <>
              <div className="sv-row sv-wrap" data-testid="detail-fields">
                {detail.application && <span className="sv-chip">app: {detail.application}</span>}
                {detail.verdict && <span className="sv-chip">verdict: {detail.verdict}</span>}
                {detail.role && <span className="sv-chip">role: {detail.role}</span>}
                {detail.quota && typeof detail.quota.reset_at === 'string' && (
                  <span className="sv-chip">quota reset: {detail.quota.reset_at}</span>
                )}
              </div>
              {detail.evidence.length > 0 && (
                <div className="sv-col" data-testid="detail-evidence">
                  {detail.evidence.slice(0, 4).map((e, i) => (
                    <span key={i} className="sv-mono sv-small">{e}</span>
                  ))}
                </div>
              )}
              <div className="sv-row">
                <button
                  type="button"
                  className="sv-btn sv-btn--primary"
                  data-testid={`detail-continue-${detail.worker_id}`}
                  disabled={busy}
                  onClick={() => void onContinue(detail.worker_id)}
                >
                  {busy ? 'sending…' : 'continue'}
                </button>
              </div>
              {continueResult && (
                <Notice
                  tone={continueResult.delivered ? 'default' : 'warn'}
                  testId="continue-result"
                >
                  {continueResult.delivered
                    ? `continue delivered via ${continueResult.channel ?? 'adapter'}`
                    : `continue NOT delivered${continueResult.error_code ? ` (${continueResult.error_code})` : ''}`}
                  {continueResult.evidence[0] ? ` — ${continueResult.evidence[0].slice(0, 160)}` : ''}
                </Notice>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
