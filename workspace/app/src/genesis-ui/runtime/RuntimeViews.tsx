import type { ReactNode } from 'react';
import type { RuntimeBinding } from './runtimeTypes';

/**
 * Runtime status + approval surfaces.
 *
 * These are the two places where a real runtime can contradict the person
 * using the app, so both are deliberately conservative:
 *
 *   - a state that has not been reported is shown as unknown, not as idle
 *   - approve/deny controls exist ONLY when the Bridge says the session has a
 *     decision channel. An approval that cannot be decided is still shown,
 *     because hiding it would hide real pending work; it is shown with the
 *     reason it cannot be acted on.
 */

/** Tone mapping for the connection state. Green requires a confirmed link. */
export function connectionTone(connection: RuntimeBinding['snapshot']['connection']): 'success' | 'warning' | 'danger' | 'neutral' {
  switch (connection) {
    case 'connected':
      return 'success';
    case 'connecting':
    case 'reconnecting':
      return 'warning';
    case 'error':
      return 'danger';
    case 'disconnected':
    default:
      return 'neutral';
  }
}

export function connectionLabel(runtime: RuntimeBinding): string {
  const snap = runtime.snapshot;
  if (snap.source === 'fixture') return 'fixture data — not connected';
  switch (snap.connection) {
    case 'connected':
      return snap.fresh ? `agent bridge · ${snap.sessionStatus || 'connected'}` : 'agent bridge · stale';
    case 'connecting':
      return 'connecting to agent bridge';
    case 'reconnecting':
      return 'reconnecting to agent bridge';
    case 'error':
      return 'agent bridge error';
    case 'disconnected':
    default:
      return 'agent bridge disconnected';
  }
}

/** Compact connection indicator for panel headers. */
export function RuntimeBadge({ runtime }: { runtime: RuntimeBinding }) {
  const snap = runtime.snapshot;
  const tone = connectionTone(snap.connection);
  const dotTone = tone === 'success' ? 'success' : tone === 'warning' ? 'warning' : tone === 'danger' ? 'danger' : 'none';

  return (
    <span className="gx-badge gx-badge--info" data-testid="runtime-badge" data-connection={snap.connection} data-fresh={snap.fresh ? 'true' : 'false'}>
      <span className={`gx-dot gx-dot--${dotTone}`} aria-hidden="true" />
      {connectionLabel(runtime)}
    </span>
  );
}

/**
 * Pending approvals.
 *
 * The critical line is `decidable`. It comes from the Bridge's `interactive`
 * flag and from nothing else — not from the presence of an approval, not from
 * a timeout, not from whether the click would probably work.
 */
export function ApprovalList({ runtime }: { runtime: RuntimeBinding }) {
  const snap = runtime.snapshot;

  return (
    <ul className="gx-col" style={{ gap: 'var(--space-3)', listStyle: 'none', margin: 0, padding: 0 }} data-testid="approval-list">
      {snap.approvals.map((a) => (
        <li key={a.approval_id} className="gx-panel gx-panel--solid" style={{ padding: 'var(--space-4)' }} data-testid={`approval-${a.approval_id}`}>
          <div className="gx-col" style={{ gap: 'var(--space-2)' }}>
            <div className="gx-row gx-row--between gx-wrap">
              <span style={{ fontWeight: 'var(--weight-semibold)' }}>{a.action}</span>
              {a.risk ? (
                <span className="gx-badge gx-badge--warning" data-testid={`approval-risk-${a.approval_id}`}>
                  {a.risk}
                </span>
              ) : (
                /* Risk comes from the event log. Absent means absent, not low. */
                <span className="gx-badge" data-testid={`approval-risk-${a.approval_id}`}>
                  risk unknown
                </span>
              )}
            </div>
            <span className="gx-mono gx-hint">{a.approval_id}</span>

            {a.decidable ? (
              <div className="gx-row">
                <button
                  type="button"
                  className="gx-btn gx-btn--sm gx-btn--primary"
                  disabled={runtime.busy}
                  onClick={() => void runtime.decide(a.approval_id, 'approve-once')}
                  data-testid={`approve-${a.approval_id}`}
                >
                  Approve once
                </button>
                <button
                  type="button"
                  className="gx-btn gx-btn--sm gx-btn--danger"
                  disabled={runtime.busy}
                  onClick={() => void runtime.decide(a.approval_id, 'deny')}
                  data-testid={`deny-${a.approval_id}`}
                >
                  Deny
                </button>
              </div>
            ) : (
              <span className="gx-hint" data-testid={`approval-undecidable-${a.approval_id}`}>
                This session has no decision channel, so it cannot be approved from here. The runtime would refuse the
                decision.
              </span>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * Runtime banner for views that show runtime-derived data.
 *
 * States the source plainly so fixture data can never read as live, and
 * reports the transport error verbatim rather than paraphrasing it.
 */
export function RuntimeNotice({ runtime, children }: { runtime: RuntimeBinding; children?: ReactNode }) {
  const snap = runtime.snapshot;

  if (snap.source === 'fixture') {
    return (
      <div className="gx-notice" data-testid="runtime-notice-fixture">
        <span aria-hidden="true">i</span>
        <span>
          Fixture mode. The roster and tasks below are sample data, not a connected runtime.
        </span>
      </div>
    );
  }

  if (snap.connection === 'error') {
    return (
      <div className="gx-notice gx-notice--warning" data-testid="runtime-notice-error">
        <span aria-hidden="true">!</span>
        <span>
          Agent Bridge reported an error: <code className="gx-mono">{snap.error || 'unknown error'}</code>
        </span>
      </div>
    );
  }

  if (snap.connection === 'disconnected' || snap.connection === 'reconnecting') {
    return (
      <div className="gx-notice gx-notice--warning" data-testid="runtime-notice-disconnected">
        <span aria-hidden="true">!</span>
        <span>
          {snap.connection === 'reconnecting' ? 'Reconnecting to Agent Bridge.' : 'Agent Bridge is not connected.'}
          {snap.error ? ` (${snap.error})` : ''} Runtime values are hidden rather than shown as if they were current.
        </span>
      </div>
    );
  }

  if (!snap.fresh) {
    return (
      <div className="gx-notice gx-notice--warning" data-testid="runtime-notice-stale">
        <span aria-hidden="true">!</span>
        <span>Connected, but the last refresh failed. These values may be out of date.</span>
      </div>
    );
  }

  return <>{children}</>;
}