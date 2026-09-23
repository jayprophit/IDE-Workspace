import { useEffect, useState } from 'react';
import { fetchBridgeStatus, type BridgeStatus } from './bridge';
import type { RightPanelId } from './workspace/state';

/**
 * Standalone detached panel view (?detach=<panel>).
 *
 * A REAL secondary window rendering the same canonical backends: it fetches
 * its own bridge status and shows the same Genesis/task state. It creates
 * no sessions, tasks, runs or approvals, carries no principal or grant, and
 * never executes actions — presentation of shared state only.
 */
export default function DetachedView({ panelId }: { panelId: RightPanelId }) {
  const [status, setStatus] = useState<BridgeStatus | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetchBridgeStatus()
      .then((next) => {
        if (!cancelled) setStatus(next);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const task = status?.runtime?.tasks?.[0];
  return (
    <div className="shell" data-testid="detached-root" data-detached-panel={panelId} data-theme="dark">
      <header className="topbar" data-testid="detached-header">
        <span>
          Aetherius · {panelId} (detached view)
        </span>
        <span className="pill" data-testid="detached-shared-note">
          same backend · view only
        </span>
      </header>
      <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="card" style={{ padding: 10 }}>
          <div className="status-row">
            <span className="k">genesis</span>
            <span className="v" data-testid="detached-genesis">genesis-prime · local preview (unverified)</span>
          </div>
          <div className="status-row">
            <span className="k">task</span>
            <span className="v" data-testid="detached-task">
              {task?.objective || task?.task_id || 'no active task'}
            </span>
          </div>
          <div className="status-row">
            <span className="k">backend</span>
            <span className="v" data-testid="detached-backend">
              {error ? `unavailable: ${error}` : status ? (status.connected ? 'connected' : 'disconnected') : '…'}
            </span>
          </div>
        </div>
        <div className="card" style={{ padding: 10 }}>
          <div style={{ color: 'var(--muted)', fontSize: 11 }} data-testid="detached-note">
            Detached presentation of the {panelId} panel. Closing this window changes nothing:
            no task is cancelled, no session ends, no authority changes.
          </div>
        </div>
      </div>
    </div>
  );
}
