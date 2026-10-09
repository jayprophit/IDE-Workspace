import type { ReactNode } from 'react';

/**
 * Reusable UI primitives.
 *
 * These are the pieces every view composes from. Each one is presentational:
 * it owns no state beyond what it needs to render itself, and it never invents
 * data. Empty and unavailable states are explicit components rather than
 * ad-hoc markup, so "nothing here" always looks the same and is never
 * mistaken for a populated panel.
 */

export function Panel({
  title,
  actions,
  children,
  footer,
  variant,
  selected,
  interactive,
  className,
  bodyClassName,
  testId,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  variant?: 'glass' | 'solid' | 'flush';
  selected?: boolean;
  interactive?: boolean;
  className?: string;
  bodyClassName?: string;
  testId?: string;
}) {
  const classes = [
    'gx-panel',
    variant === 'solid' && 'gx-panel--solid',
    variant === 'flush' && 'gx-panel--flush',
    interactive && 'gx-panel--interactive',
    selected && 'gx-panel--selected',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <section className={classes} data-testid={testId}>
      {(title || actions) && (
        <header className="gx-panel__head">
          <h3 className="gx-panel__title">{title}</h3>
          {actions && <div className="gx-row">{actions}</div>}
        </header>
      )}
      {children !== undefined && <div className={`gx-panel__body ${bodyClassName ?? ''}`}>{children}</div>}
      {footer && <footer className="gx-panel__foot">{footer}</footer>}
    </section>
  );
}

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

export function Badge({ tone = 'neutral', children, title }: { tone?: BadgeTone; children: ReactNode; title?: string }) {
  return (
    <span className={`gx-badge ${tone !== 'neutral' ? `gx-badge--${tone}` : ''}`} title={title}>
      {children}
    </span>
  );
}

/**
 * PresenceDot.
 *
 * `live` adds a decorative ping. It does NOT assert that a worker is online -
 * the colour comes from the status the host supplied, and the ping stops for
 * `offline` because there is nothing to signal.
 */
export function StatusDot({ tone, live }: { tone: 'success' | 'warning' | 'danger' | 'info' | 'none'; live?: boolean }) {
  return <span className={`gx-dot gx-dot--${tone} ${live ? 'gx-dot--live' : ''}`} aria-hidden="true" />;
}

export function Button({
  children,
  onClick,
  variant,
  size,
  disabled,
  type = 'button',
  title,
  testId,
  ariaLabel,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'default' | 'primary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  disabled?: boolean;
  type?: 'button' | 'submit';
  title?: string;
  testId?: string;
  ariaLabel?: string;
}) {
  const classes = [
    'gx-btn',
    variant && variant !== 'default' && `gx-btn--${variant}`,
    size === 'sm' && 'gx-btn--sm',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button type={type} className={classes} onClick={onClick} disabled={disabled} title={title} data-testid={testId} aria-label={ariaLabel}>
      {children}
    </button>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  testId,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  testId?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="gx-switch"
      onClick={() => onChange(!checked)}
      data-testid={testId}
    >
      <span className="gx-switch__knob" />
    </button>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="gx-field">
      <span className="gx-label">{label}</span>
      {children}
      {hint && <span className="gx-hint">{hint}</span>}
    </div>
  );
}

export function Tabs<T extends string>({
  tabs,
  active,
  onSelect,
  testId,
}: {
  tabs: { id: T; label: string; badge?: ReactNode }[];
  active: T;
  onSelect: (id: T) => void;
  testId?: string;
}) {
  return (
    <div className="gx-tabbar" role="tablist" data-testid={testId}>
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={t.id === active}
          className="gx-tab"
          onClick={() => onSelect(t.id)}
          data-testid={`tab-${t.id}`}
        >
          {t.label}
          {t.badge}
        </button>
      ))}
    </div>
  );
}

/**
 * EmptyState - "nothing here, and that is accurate".
 *
 * Used instead of leaving a panel blank, so an unpopulated surface is never
 * mistaken for a rendering failure.
 */
export function EmptyState({ title, note, action }: { title: string; note?: string; action?: ReactNode }) {
  return (
    <div className="gx-empty" data-testid="empty-state">
      <span className="gx-empty__title">{title}</span>
      {note && <span className="gx-empty__note">{note}</span>}
      {action}
    </div>
  );
}

/**
 * Notice - explicitly labels a placeholder or an unimplemented capability.
 *
 * This is the mechanism that keeps the scaffold honest: anything not really
 * implemented says so in the UI, not just in the docs.
 */
export function Notice({
  children,
  tone = 'default',
  testId,
}: {
  children: ReactNode;
  tone?: 'default' | 'warning';
  testId?: string;
}) {
  return (
    <div className={`gx-notice ${tone === 'warning' ? 'gx-notice--warning' : ''}`} data-testid={testId ?? 'notice'}>
      <span aria-hidden="true">{tone === 'warning' ? '!' : 'i'}</span>
      <span>{children}</span>
    </div>
  );
}

export function KeyValue({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="gx-kv">
      {items.map(([k, v]) => (
        <div key={k} style={{ display: 'contents' }}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Progress({ value, label }: { value: number; label?: string }) {
  const pct = Math.max(0, Math.min(100, Math.round(value * 100)));
  return (
    <div className="gx-col" style={{ gap: 'var(--space-2)' }}>
      {label && (
        <div className="gx-row gx-row--between" style={{ fontSize: 'var(--text-xs)' }}>
          <span className="gx-muted gx-truncate">{label}</span>
          <span className="gx-mono">{pct}%</span>
        </div>
      )}
      <div
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ?? 'progress'}
        style={{ height: 6, borderRadius: 'var(--radius-full)', background: 'var(--state-neutral-soft)', overflow: 'hidden' }}
      >
        <div style={{ height: '100%', width: `${pct}%`, background: 'var(--accent-gradient)' }} />
      </div>
    </div>
  );
}