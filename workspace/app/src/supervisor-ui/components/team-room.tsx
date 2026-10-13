import { useCallback, useMemo, useState } from 'react';
import { continueWorker, fetchWorkerDetail } from '../api/client';
import type { WorkerContinueResult, WorkerDetail } from '../api/types';
import { readRoster, type TeamMember } from './roster-types';
import { DEFERRED_ACTIONS, WORKER_ACTIONS, WorkerCard } from './worker-card';
import { Notice } from './fact';

/**
 * TeamRoom (§7) — the avatar-first workforce view.
 *
 * Closes G1/G4: workers become team members rather than table rows.
 *
 * Data source: the supervision section's `workers` fact, the SAME fact
 * `roster.tsx` reads. No second request, no parallel roster.
 *
 * LIVE vs DESIGN: there is exactly one mode here and it is LIVE. Roster rows
 * come from the backend or the room is empty; no fixture is ever injected. A
 * design/demo mode is M2-B work and must default OFF when it lands.
 *
 * Honesty law, applied to actions:
 *   - `inspect` and `continue` are LIVE; they call the real endpoints in
 *     api/client.ts and report what came back.
 *   - every other action is DEFERRED_INTERFACE: rendered disabled and dashed,
 *     with its reason legible on the control, so the gap is visible BEFORE a
 *     click rather than reported after one.
 *   - `delivered` is echoed only when the adapter said so. Nothing here sets
 *     a success state optimistically.
 */

/** An outcome the user can see, whether or not anything was delivered. */
export interface ActionOutcome {
  workerId: string;
  actionId: string;
  /** True ONLY when a real adapter confirmed delivery. */
  delivered: boolean;
  detail: string;
  evidence?: string[];
  at: number;
}

export interface TeamRoomProps {
  /** The supervision section, passed down from sections.tsx. */
  section: Record<string, unknown> | undefined;
  /** Rendered when no worker is selected. Keeps the room honest about state. */
  emptyNote?: string;
}

export function TeamRoom({ section }: TeamRoomProps) {
  const rows = readRoster(section);

  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [projectFilter, setProjectFilter] = useState<string>('all');
  const [appFilter, setAppFilter] = useState<string>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<WorkerDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionOutcome | null>(null);

  const visible = useMemo(() => {
    if (rows === null) return null;
    return rows.filter((r) => {
      if (statusFilter !== 'all' && (r.status ?? '') !== statusFilter) return false;
      if (projectFilter !== 'all' && (r.project ?? '') !== projectFilter) return false;
      if (appFilter !== 'all' && (r.application ?? '') !== appFilter) return false;
      return true;
    });
  }, [rows, statusFilter, projectFilter, appFilter]);

  /** Filter values are derived from the roster itself, never hardcoded. */
  const options = useMemo(() => {
    const uniq = (pick: (r: TeamMember) => string | undefined) => {
      const set = new Set<string>();
      for (const r of rows ?? []) {
        const v = pick(r);
        if (typeof v === 'string' && v.trim() !== '') set.add(v);
      }
      return [...set].sort();
    };
    return {
      status: uniq((r) => r.status),
      project: uniq((r) => r.project),
      application: uniq((r) => r.application),
    };
  }, [rows]);

  const runAction = useCallback(
    async (worker: TeamMember, actionId: string) => {
      if (!WORKER_ACTIONS.find((a) => a.id === actionId)?.live) {
        /* Unreachable via the UI: deferred controls are disabled. Kept as a
           guard so a future caller cannot bypass the capability gap. */
        setOutcome({
          workerId: worker.worker_id,
          actionId,
          delivered: false,
          detail: 'deferred interface — no backend route exists for this action',
          at: Date.now(),
        });
        return;
      }

      setBusy(true);
      setOutcome(null);

      if (actionId === 'click') {
        /* Selection is client state, not an adapter call - and it is NOT a
           success claim. No outcome notice, no delivered flag. */
        setDetail(null);
        setSelectedId(worker.worker_id);
        setBusy(false);
        return;
      }

      if (actionId === 'inspect') {
        const d = await fetchWorkerDetail(worker.worker_id);
        setSelectedId(worker.worker_id);
        setDetail(d);
        setOutcome({
          workerId: worker.worker_id,
          actionId,
          /* inspect is a read: it delivered iff the read succeeded. */
          delivered: d.ok,
          detail: d.ok
            ? `inspect ok — verdict ${d.verdict ?? 'not reported'}`
            : `inspect failed: ${d.error_code ?? 'unreachable'}`,
          evidence: d.evidence,
          at: Date.now(),
        });
        setBusy(false);
        return;
      }

      if (actionId === 'continue') {
        const r: WorkerContinueResult = await continueWorker(worker.worker_id);
        setOutcome({
          workerId: worker.worker_id,
          actionId,
          /* Exactly the adapter's word. Never inferred from ok alone. */
          delivered: r.delivered === true,
          detail: r.delivered
            ? `continue delivered via ${r.channel ?? 'adapter'}`
            : `continue NOT delivered${r.error_code ? ` (${r.error_code})` : ''}`,
          evidence: r.evidence,
          at: Date.now(),
        });
        const d = await fetchWorkerDetail(worker.worker_id);
        setSelectedId(worker.worker_id);
        setDetail(d);
        setBusy(false);
      }
    },
    [],
  );

  if (rows === null) {
    return (
      <Notice tone="warn" testId="teamroom-not-exposed">
        Worker roster not exposed by the backend. The team room needs the supervision section&apos;s live
        <span className="sv-mono"> workers </span> fact, and it is not present in this snapshot.
      </Notice>
    );
  }

  if (rows.length === 0) {
    return (
      <Notice tone="default" testId="teamroom-empty">
        The roster is exposed and currently empty. No workers are registered — this is a real, observed zero, not a
        missing source.
      </Notice>
    );
  }

  const filtered = visible ?? [];

  return (
    <div className="sv-teamroom" data-testid="team-room" data-count={filtered.length} data-roster={rows.length}>
      <div className="sv-teamroom__filters" data-testid="teamroom-filters">
        <FilterGroup label="status" value={statusFilter} options={options.status} onChange={setStatusFilter} testId="status" />
        <FilterGroup label="project" value={projectFilter} options={options.project} onChange={setProjectFilter} testId="project" />
        <FilterGroup label="application" value={appFilter} options={options.application} onChange={setAppFilter} testId="app" />
        <span className="sv-health__meta" data-testid="teamroom-count">
          {filtered.length} of {rows.length} worker{rows.length === 1 ? '' : 's'}
        </span>
      </div>

      {/* A filter that matches nothing produces an honest empty state. It must
          never pad the grid to make the filter look like it worked. */}
      {filtered.length === 0 ? (
        <Notice tone="warn" testId="teamroom-filtered-empty">
          No worker matches these filters. The roster still holds {rows.length} worker{rows.length === 1 ? '' : 's'}; clear a
          filter to see them.
        </Notice>
      ) : (
        <div className="sv-teamroom__grid" data-testid="teamroom-grid">
          {filtered.map((w) => (
            <WorkerCard
              key={w.worker_id}
              worker={w}
              selected={selectedId === w.worker_id}
              busy={busy}
              evidence={selectedId === w.worker_id && detail?.ok ? detail.evidence : undefined}
              onAction={(worker, actionId) => void runAction(worker, actionId)}
            />
          ))}
        </div>
      )}

      {outcome && <OutcomeNotice outcome={outcome} />}
    </div>
  );
}

/**
 * OutcomeNotice — states what actually happened.
 *
 * A delivered action and a refused one are rendered identically in structure
 * and differently in wording, so "did my click work" is never a judgement
 * call from the layout.
 */
function OutcomeNotice({ outcome }: { outcome: ActionOutcome }) {
  return (
    <Notice tone={outcome.delivered ? 'default' : 'warn'} testId="action-outcome">
      <span data-testid="action-outcome-text">
        <strong className="sv-mono">
          {outcome.workerId} / {outcome.actionId}
        </strong>{' '}
        — {outcome.detail}
      </span>
      {outcome.evidence && outcome.evidence.length > 0 && (
        <span className="sv-mono sv-truncate" data-testid="action-outcome-evidence">
          {outcome.evidence[0]}
        </span>
      )}
    </Notice>
  );
}

function FilterGroup({
  label,
  value,
  options,
  onChange,
  testId,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
  testId: string;
}) {
  const all = ['all', ...options];
  return (
    <span className="sv-teamroom__filtergroup" role="group" aria-label={`filter by ${label}`}>
      <span className="sv-teamroom__filterlabel">{label}</span>
      {all.map((opt) => (
        <button
          key={opt}
          type="button"
          className="sv-chipbtn"
          aria-pressed={value === opt}
          onClick={() => onChange(opt)}
          data-testid={`filter-${testId}-${opt}`}
        >
          {opt === 'all' ? 'all' : opt}
        </button>
      ))}
    </span>
  );
}

export { DEFERRED_ACTIONS, WORKER_ACTIONS };