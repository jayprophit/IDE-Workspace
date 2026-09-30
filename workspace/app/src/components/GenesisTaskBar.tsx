import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  cancelTask,
  createSession,
  decideApproval,
  pendingApprovals,
  sessionEvents,
  sessionStatus,
  submitTask,
  taskEvidence,
  taskOutcome,
  describeOutcome,
  type GenesisEvidence,
  type GenesisOutcome,
  type GenesisPendingApproval,
  type GenesisSessionStatus,
} from '../genesisBridge';

/**
 * GenesisTaskBar: the minimum human-in-the-loop surface.
 *
 * This is the seam the IDE was missing. It owns nothing canonical - it creates
 * a session on Agent Bridge, submits a task, watches the real status, and lets
 * a human answer the authority question when the Bridge raises one. Canonical
 * work state stays in the Bridge; this is a view and a control.
 *
 * Truth rules baked in:
 *   - a task that ended with every action denied is rendered as BLOCKED, not
 *     as a success. The outcome comes from the Bridge's effect truth, never
 *     from the status string alone.
 *   - if the session cannot ask for approvals (non-interactive), the approve
 *     and deny buttons never appear. The UI must not offer a human decision
 *     the runtime would refuse to accept.
 *   - errors are shown verbatim. A refused session (403) says so instead of
 *     pretending a task is running.
 */

const POLL_MS = 1500;
const TERMINAL = new Set(['COMPLETED', 'FAILED', 'CANCELLED', 'ROLLED_BACK', 'INTERRUPTED']);

export interface GenesisTaskBarProps {
  baseUrl: string;
  workspace: string;
  /** Ask the Bridge for a human approval channel on this session. */
  interactive?: boolean;
  approval?: string;
  pollMs?: number;
  /** Injected in tests; defaults to the real Bridge client. */
  onSubmitted?: (taskId: string) => void;
}

type Phase = 'idle' | 'starting' | 'running' | 'waiting-approval' | 'finished' | 'error';

export function GenesisTaskBar({
  baseUrl,
  workspace,
  interactive = false,
  approval = 'AUTO_SAFE',
  pollMs = POLL_MS,
  onSubmitted,
}: GenesisTaskBarProps) {
  const [text, setText] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [taskId, setTaskId] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [status, setStatus] = useState<GenesisSessionStatus | null>(null);
  const [approvals, setApprovals] = useState<GenesisPendingApproval[]>([]);
  const [outcome, setOutcome] = useState<GenesisOutcome | null>(null);
  const [evidence, setEvidence] = useState<GenesisEvidence | null>(null);
  const [error, setError] = useState('');
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stoppedRef = useRef(false);

  const finish = useCallback(
    async (sid: string, tid: string) => {
      const [res, ev] = await Promise.all([taskOutcome(baseUrl, sid, tid), taskEvidence(baseUrl, sid)]);
      setOutcome(res.ok && res.data ? res.data : null);
      setEvidence(ev.ok && ev.data ? ev.data : null);
      if (!res.ok) setError(res.error);
      else if (!ev.ok) setError(ev.error);
      setPhase('finished');
    },
    [baseUrl],
  );

  const poll = useCallback(
    async (sid: string, tid: string) => {
      const [st, evs] = await Promise.all([sessionStatus(baseUrl, sid), sessionEvents(baseUrl, sid)]);
      if (stoppedRef.current) return;
      if (!st.ok || !st.data) {
        setError(st.error || 'session status unavailable');
        setPhase('error');
        return;
      }
      setStatus(st.data);
      setApprovals(pendingApprovals(st.data, evs.ok && evs.data ? evs.data : []));
      if (st.data.pending_approvals.length > 0) {
        setPhase('waiting-approval');
        return;
      }
      const taskState = st.data.tasks[tid];
      if (taskState && TERMINAL.has(taskState)) {
        stoppedRef.current = true;
        await finish(sid, tid);
        return;
      }
      setPhase('running');
    },
    [baseUrl, finish],
  );

  useEffect(() => {
    return () => {
      stoppedRef.current = true;
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, []);

  useEffect(() => {
    if (phase !== 'running' && phase !== 'waiting-approval') return undefined;
    const handle = setTimeout(() => {
      if (sessionId && taskId) void poll(sessionId, taskId);
    }, pollMs);
    return () => clearTimeout(handle);
  }, [phase, sessionId, taskId, pollMs, poll]);

  const submit = useCallback(async () => {
    const goal = text.trim();
    if (!goal) return;
    setError('');
    setOutcome(null);
    setEvidence(null);
    setPhase('starting');
    stoppedRef.current = false;
    const session = await createSession(baseUrl, { workspace, mode: 'build', approval, interactive });
    if (!session.ok || !session.data) {
      setError(session.error || 'could not create a session');
      setPhase('error');
      return;
    }
    setSessionId(session.data.session_id);
    const handle = await submitTask(baseUrl, session.data.session_id, goal);
    if (!handle.ok || !handle.data) {
      setError(handle.error || 'could not submit the task');
      setPhase('error');
      return;
    }
    setTaskId(handle.data.task_id);
    onSubmitted?.(handle.data.task_id);
    setPhase('running');
  }, [approval, baseUrl, interactive, onSubmitted, text, workspace]);

  const decide = useCallback(
    async (approvalId: string, decision: 'approve-once' | 'deny') => {
      if (!sessionId) return;
      const res = await decideApproval(baseUrl, sessionId, approvalId, decision);
      if (!res.ok) {
        setError(res.error || 'decision was refused');
        return;
      }
      setError('');
      await poll(sessionId, taskId);
    },
    [baseUrl, poll, sessionId, taskId],
  );

  const cancel = useCallback(async () => {
    if (!sessionId || !taskId) return;
    const res = await cancelTask(baseUrl, sessionId, taskId);
    if (!res.ok) {
      setError(res.error || 'cancel was refused');
      return;
    }
    await poll(sessionId, taskId);
  }, [baseUrl, poll, sessionId, taskId]);

  const canDecide = useMemo(
    () => (status?.interactive ?? false) && phase === 'waiting-approval',
    [phase, status],
  );

  return (
    <section className="genesis-bar" data-testid="genesis-task-bar">
      <header>
        <span className="k">genesis task</span>
        <span className="badge" data-testid="genesis-phase">
          {phase}
        </span>
        {status && (
          <span className="badge" data-testid="genesis-session-mode">
            {status.session_id} {status.status}
          </span>
        )}
        <span className="badge" data-testid="genesis-approval-mode">
          approval: {approval}
          {status ? (status.interactive ? ' (interactive)' : ' (non-interactive)') : ''}
        </span>
      </header>

      <div className="row">
        <input
          aria-label="genesis task text"
          data-testid="genesis-task-input"
          value={text}
          placeholder="Describe a bounded task for Genesis"
          onChange={(e) => setText(e.target.value)}
        />
        <button
          type="button"
          data-testid="genesis-submit"
          disabled={!text.trim() || phase === 'starting' || phase === 'running' || phase === 'waiting-approval'}
          onClick={() => void submit()}
        >
          submit
        </button>
        <button
          type="button"
          data-testid="genesis-cancel"
          disabled={!(taskId && (phase === 'running' || phase === 'waiting-approval'))}
          onClick={() => void cancel()}
        >
          cancel
        </button>
      </div>

      {approvals.length > 0 && (
        <ul className="approvals" data-testid="genesis-approvals">
          {approvals.map((item) => (
            <li key={item.approval_id} data-testid={`genesis-approval-${item.approval_id}`}>
              <span>
                {item.action}
                {item.risk ? ` (${item.risk})` : ''} &middot; {item.approval_id}
              </span>
              {canDecide ? (
                <>
                  <button
                    type="button"
                    data-testid={`genesis-approve-${item.approval_id}`}
                    onClick={() => void decide(item.approval_id, 'approve-once')}
                  >
                    approve once
                  </button>
                  <button
                    type="button"
                    data-testid={`genesis-deny-${item.approval_id}`}
                    onClick={() => void decide(item.approval_id, 'deny')}
                  >
                    deny
                  </button>
                </>
              ) : (
                <span className="muted" data-testid={`genesis-approval-undecidable-${item.approval_id}`}>
                  no decision channel on this session
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {outcome && (
        <div
          className={`outcome ${outcome.blocked ? 'blocked' : outcome.effect_achieved ? 'achieved' : 'none'}`}
          data-testid="genesis-outcome"
          data-blocked={outcome.blocked ? 'true' : 'false'}
          data-effect={outcome.effect_achieved ? 'true' : 'false'}
          data-status={outcome.status}
        >
          {describeOutcome(outcome)}
        </div>
      )}

      {evidence && evidence.manifest.length > 0 && (
        <div className="evidence" data-testid="genesis-evidence">
          <span>changed: {evidence.manifest.map((m) => m.path).join(', ')}</span>
          {Object.keys(evidence.scorecard_categories).length > 0 && (
            <span>
              scorecard:{' '}
              {Object.entries(evidence.scorecard_categories)
                .map(([k, v]) => `${k}=${v}`)
                .join(', ')}
            </span>
          )}
        </div>
      )}

      {error && (
        <div className="error" data-testid="genesis-error">
          {error}
        </div>
      )}
    </section>
  );
}

export default GenesisTaskBar;
