import type { ReactNode } from 'react';
import { isSourceFact } from '../api/client';
import { SECTION_LABEL, type RepositoryFacts, type SectionId, type SourceFact, type SourceState, type SupervisorSnapshot } from '../api/types';

/**
 * Fact primitives.
 *
 * The whole point of this file is that it renders the state it is given and
 * never adjusts it. There is no "recompute staleness" step here and no default
 * that turns an absent field into a zero. If the backend says DEGRADED, the
 * chip says DEGRADED; if a section is missing, the section says NOT_EXPOSED.
 */

/* --- format ---------------------------------------------------------------- */

/**
 * Render a fact's value.
 *
 * Distinguishes three cases the brief calls out, because they are not the same
 * thing and collapsing them is the classic dashboard lie:
 *   - no value AND a state that explains it (null + OFFLINE/NOT_EXPOSED/…)
 *     -> the state's own words, never "0" and never "—"
 *   - an empty collection that was really observed
 *     -> "none" plus the fact's state, so a verified-empty list is not confused
 *        with a list that could not be read
 *   - a real value -> formatted, with the state chip beside it
 */
export function formatFactValue(fact: SourceFact): { text: string; absent: boolean } {
  const v = fact.value;

  if (v === null || v === undefined) {
    /* The backend gave no value. The state says why. */
    return { text: STATE_PHRASE[fact.state], absent: true };
  }

  if (typeof v === 'number') return { text: String(v), absent: false };
  if (typeof v === 'boolean') return { text: v ? 'yes' : 'no', absent: false };
  if (typeof v === 'string') return { text: v === '' ? STATE_PHRASE[fact.state] : v, absent: v === '' };

  if (Array.isArray(v)) {
    if (v.length === 0) {
      /* Observed and empty. Distinct from unreadable. */
      return { text: `none observed (${STATE_PHRASE[fact.state]})`, absent: false };
    }
    if (v.length <= 3) return { text: v.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(', '), absent: false };
    return { text: `${v.length} items`, absent: false };
  }

  if (typeof v === 'object') {
    const keys = Object.keys(v as Record<string, unknown>);
    return { text: keys.length === 0 ? `none observed (${STATE_PHRASE[fact.state]})` : `{ ${keys.join(', ')} }`, absent: false };
  }

  return { text: String(v), absent: false };
}

/** Short human phrasing for a state, used when a value is absent. */
export const STATE_PHRASE: Record<SourceState, string> = {
  LIVE_VERIFIED: 'verified live',
  LIVE: 'live',
  STALE: 'stale — last known value',
  DEGRADED: 'degraded — partial data',
  OFFLINE: 'source offline — no value',
  FIXTURE: 'fixture — not live',
  UNKNOWN: 'unknown — no source',
  BLOCKED: 'blocked — permission required',
  NOT_EXPOSED: 'not exposed by backend',
  DEFERRED_BACKEND_INTERFACE: 'deferred — no backend interface',
};

/** Compact age label. Honest about magnitude rather than rounding to "now". */
export function formatAge(ageSeconds: number): string {
  if (!Number.isFinite(ageSeconds) || ageSeconds < 0) return 'unknown age';
  if (ageSeconds < 2) return 'just now';
  if (ageSeconds < 60) return `${Math.round(ageSeconds)}s ago`;
  if (ageSeconds < 3600) return `${Math.round(ageSeconds / 60)}m ago`;
  if (ageSeconds < 86400) return `${Math.round(ageSeconds / 3600)}h ago`;
  return `${Math.round(ageSeconds / 86400)}d ago`;
}

/* --- chips ----------------------------------------------------------------- */

/** States that mean "the backend does not expose this", not "nothing to report". */
const DECLARED_GAPS: ReadonlySet<SourceState> = new Set<SourceState>(['NOT_EXPOSED', 'DEFERRED_BACKEND_INTERFACE']);

/**
 * FactChip — the 1:1 honesty vocabulary.
 *
 * Renders the exact state string the backend sent, so a reader (and a test)
 * can never be told "live" for a degraded fact. The dashed border on
 * NOT_EXPOSED / DEFERRED is deliberate: those are declared gaps.
 *
 * `data-declared-gap` mirrors that visual distinction so it is assertable
 * without depending on a stylesheet being applied (jsdom does not load CSS,
 * and a computed-style assertion would silently pass for the wrong reason).
 */
export function FactChip({ state, testId, title }: { state: SourceState; testId?: string; title?: string }) {
  return (
    <span
      className="sv-chip"
      data-state={state}
      data-declared-gap={DECLARED_GAPS.has(state) ? 'true' : 'false'}
      data-testid={testId ?? `chip-${state}`}
      title={title ?? STATE_PHRASE[state]}
    >
      {state}
    </span>
  );
}

/* --- fact row -------------------------------------------------------------- */

/**
 * FactRow — one observed value, its state, how old it is, and the backend's
 * note when it gave one. The note is shown verbatim; it is often the reason
 * (e.g. a URLError) and paraphrasing it would lose the evidence.
 */
export function FactRow({ name, fact, testId }: { name: string; fact: SourceFact; testId?: string }) {
  const { text, absent } = formatFactValue(fact);
  return (
    <div className="sv-fact" data-state={fact.state} data-source={fact.source} data-testid={testId}>
      <span className="sv-fact__key" title={name}>
        {name}
      </span>
      <span className={`sv-fact__val${absent ? ' sv-val--absent' : ''}`}>{text}</span>
      <FactChip state={fact.state} />
      <span className="sv-fact__age" title={fact.observed_at}>
        {formatAge(fact.age_s)}
      </span>
      {fact.note && <span className="sv-fact__note">{fact.note}</span>}
    </div>
  );
}

/* --- card ------------------------------------------------------------------ */

export function Card({
  title,
  state,
  actions,
  children,
  flush,
  testId,
}: {
  title: ReactNode;
  state?: SourceState;
  actions?: ReactNode;
  children: ReactNode;
  flush?: boolean;
  testId?: string;
}) {
  return (
    <section className={`sv-card${flush ? ' sv-card--flush' : ''}`} data-testid={testId}>
      <header className="sv-card__head">
        <h2 className="sv-card__title">{title}</h2>
        <div className="sv-row">
          {state && <FactChip state={state} />}
          {actions}
        </div>
      </header>
      <div className="sv-card__body sv-scroll">{children}</div>
    </section>
  );
}

/**
 * StatTile — a count, with the state that says how much to trust it.
 *
 * When the fact has no value the tile shows the state's phrase, NOT a zero. A
 * dashboard that renders "0 workers" when the source is offline has invented a
 * fact, and that is the single most damaging thing this view could do.
 */
export function StatTile({ label, fact, testId }: { label: string; fact: SourceFact | undefined; testId?: string }) {
  if (!fact) {
    return (
      <div className="sv-stat sv-stat--absent" data-testid={testId}>
        <span className="sv-stat__value">not reported</span>
        <span className="sv-stat__label">{label}</span>
      </div>
    );
  }
  const hasValue = fact.value !== null && fact.value !== undefined;
  const numeric = typeof fact.value === 'number' ? String(fact.value) : Array.isArray(fact.value) ? String(fact.value.length) : null;
  /* A count is only trustworthy alongside its freshness, so the tile carries
     the age whenever the backend flagged the fact as anything but current. */
  const showAge = fact.state !== 'LIVE_VERIFIED' && fact.state !== 'LIVE';

  return (
    <div
      className={`sv-stat${hasValue && numeric === null ? ' sv-stat--absent' : ''}`}
      data-testid={testId}
      data-state={fact.state}
    >
      <span className="sv-stat__value">{numeric ?? (hasValue ? '—' : STATE_PHRASE[fact.state])}</span>
      <span className="sv-stat__label">{label}</span>
      {showAge && (
        <span className="sv-stat__age" data-testid={`${testId}-age`}>
          {formatAge(fact.age_s)}
        </span>
      )}
    </div>
  );
}

/* --- section shell --------------------------------------------------------- */

export function EmptyState({ title, note }: { title: string; note?: string }) {
  return (
    <div className="sv-empty" data-testid="sv-empty">
      <span className="sv-empty__title">{title}</span>
      {note && <span>{note}</span>}
    </div>
  );
}

export function Notice({ tone = 'default', children, testId }: { tone?: 'default' | 'warn' | 'down'; children: ReactNode; testId?: string }) {
  const cls = tone === 'warn' ? ' sv-notice--warn' : tone === 'down' ? ' sv-notice--down' : '';
  return (
    <div className={`sv-notice${cls}`} data-testid={testId ?? 'sv-notice'}>
      <span aria-hidden="true">{tone === 'default' ? 'i' : '!'}</span>
      <span>{children}</span>
    </div>
  );
}

/** Renders every fact in a section, flattened. Used by most section views. */
export function FactList({ section, testId }: { section: Record<string, unknown> | undefined; testId?: string }) {
  if (!section || Object.keys(section).length === 0) {
    return <EmptyState title="Section not present" note="The backend did not include this section in the snapshot." />;
  }

  const rows: ReactNode[] = [];
  for (const [key, value] of Object.entries(section)) {
    if (isSourceFact(value)) {
      rows.push(<FactRow key={key} name={key} fact={value} testId={`fact-${key}`} />);
    } else if (typeof value === 'object' && value !== null) {
      /* Nested group (repositories[label], opencode.liveness). */
      for (const [k2, v2] of Object.entries(value as Record<string, unknown>)) {
        if (isSourceFact(v2)) rows.push(<FactRow key={`${key}.${k2}`} name={`${key}.${k2}`} fact={v2} testId={`fact-${key}-${k2}`} />);
      }
    }
  }
  if (rows.length === 0) return <EmptyState title="No readable facts" note="Nothing in this section parsed as an observed value." />;
  return <div data-testid={testId}>{rows}</div>;
}

export { SECTION_LABEL };
export type { SectionId, SupervisorSnapshot };