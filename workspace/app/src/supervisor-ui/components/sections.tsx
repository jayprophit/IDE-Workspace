import type { ReactNode } from 'react';
import { isSourceFact, leafFacts, sectionState } from '../api/client';
import { SECTION_IDS, SECTION_LABEL, type RepositoryFacts, type SectionId, type SourceFact, type SourceState, type SupervisorSnapshot } from '../api/types';
import { Card, EmptyState, FactChip, FactRow, Notice, StatTile, formatAge } from './fact';
import { WorkerRoster } from './roster';
import { TeamRoom } from './team-room';

/**
 * Section views.
 *
 * Every view follows the same three rules:
 *   1. a section that is absent renders NOT_EXPOSED, never an empty card that
 *      looks like "nothing to report"
 *   2. a count is only rendered as a number when a real fact carries it
 *   3. a degraded field never inherits a healthy sibling's treatment
 *
 * Section bodies are data-driven from the snapshot rather than hardcoded per
 * field, so a field the backend adds later appears without a UI change, and a
 * field it removes disappears instead of rendering as undefined.
 */

export function sectionOf(snapshot: SupervisorSnapshot | null, id: string): Record<string, unknown> | undefined {
  return snapshot?.sections?.[id];
}

/**
 * Direct fact lookups, narrowed once.
 *
 * Section bodies are typed `Record<string, unknown>` because the backend may
 * send anything. Reading a named field therefore needs narrowing, and doing it
 * inline at each use site produced a dozen casts. These two helpers centralise
 * it and return `undefined` rather than a dummy, so a missing fact renders as
 * absent instead of as a blank object that looks present.
 */
function factAt(section: Record<string, unknown>, key: string): SourceFact | undefined {
  const v = section[key];
  return isSourceFact(v) ? v : undefined;
}

/** Every direct fact field in a section, in insertion order. */
function factEntries(section: Record<string, unknown>): [string, SourceFact][] {
  return Object.entries(section).filter(([, v]) => isSourceFact(v)) as [string, SourceFact][];
}

/** A nested fact group, e.g. `opencode.liveness`. Empty when absent. */
function livenessFacts(section: Record<string, unknown>): Record<string, SourceFact> {
  const nested = section.liveness;
  if (typeof nested !== 'object' || nested === null) return {};
  const out: Record<string, SourceFact> = {};
  for (const [k, v] of Object.entries(nested as Record<string, unknown>)) {
    if (isSourceFact(v)) out[k] = v;
  }
  return out;
}

function SectionShell({
  snapshot,
  id,
  children,
  testId,
}: {
  snapshot: SupervisorSnapshot | null;
  id: SectionId;
  children: (section: Record<string, unknown>, state: SourceState) => ReactNode;
  testId: string;
}) {
  const section = sectionOf(snapshot, id);
  const state = sectionState(section);

  if (!snapshot) {
    return (
      <Card title={SECTION_LABEL[id]} testId={testId}>
        <EmptyState title="No snapshot yet" note="The supervisor API has not returned a snapshot." />
      </Card>
    );
  }

  if (!section || Object.keys(section).length === 0) {
    /* Absent is a finding, and `AbsentSections` reports it once for the whole
     * view. Rendering a card per absent section repeated the same notice and
     * pushed the live data off screen. */
    return null;
  }

  return (
    <Card title={SECTION_LABEL[id]} state={state} testId={testId}>
      {children(section, state)}
    </Card>
  );
}

/* ---------------------------------------------------------------------------
 * Repositories
 * ------------------------------------------------------------------------ */

export function RepositoriesSection({ snapshot }: { snapshot: SupervisorSnapshot | null }) {
  const section = sectionOf(snapshot, 'repositories');
  const labels = section ? Object.keys(section) : [];
  /* Each repository label maps to its own fact group. Narrowed once here so
     the JSX does not re-narrow on every access. */
  const groups = labels.map((label) => ({ label, facts: (section?.[label] ?? {}) as RepositoryFacts }));

  if (!snapshot) {
    return <Card title="Repositories"><EmptyState title="No snapshot yet" /></Card>;
  }
  if (labels.length === 0) {
    return (
      <Card title="Repositories" state="NOT_EXPOSED" testId="section-repositories">
        <Notice tone="warn">No repositories were observed. The backend reported no repository sources, which is not the same as an empty working tree.</Notice>
      </Card>
    );
  }

  const allDirty = groups.filter(
    (g) => typeof g.facts.dirty_count?.value === 'number' && (g.facts.dirty_count?.value as number) > 0,
  );
  const allBehind = groups.filter(
    (g) => typeof g.facts.behind?.value === 'number' && (g.facts.behind?.value as number) > 0,
  );

  return (
    <Card
      title="Repositories"
      state={sectionState(section)}
      testId="section-repositories"
      actions={
        <span className="sv-row" data-testid="repo-rollup">
          <span className="sv-muted sv-mono">{labels.length} observed</span>
        </span>
      }
    >
      <div className="sv-grid sv-grid--wide" data-testid="repo-list">
        {groups.map(({ label, facts }) => {
          const dirty = facts.dirty_count;
          const behind = facts.behind;
          const repoState = sectionState((section?.[label] ?? {}) as Record<string, unknown>);
          return (
            <article className="sv-card" key={label} data-testid={`repo-${label}`} data-state={repoState}>
              <header className="sv-card__head">
                <h3 className="sv-card__title">{label}</h3>
                <FactChip state={repoState} />
              </header>
              <div className="sv-card__body">
                {/* Count tiles are safe here because every number comes from a
                    real SourceFact, and a missing one renders as "not reported". */}
                <div className="sv-grid sv-grid--narrow" style={{ marginBottom: 'var(--sv-space-4)' }}>
                  <StatTile label="dirty" fact={dirty} testId={`repo-${label}-dirty`} />
                  <StatTile label="behind" fact={behind} testId={`repo-${label}-behind`} />
                  <StatTile label="ahead" fact={facts.ahead} testId={`repo-${label}-ahead`} />
                </div>
                {facts.head && <FactRow name="head" fact={facts.head} testId={`fact-${label}-head`} />}
                {facts.branch && <FactRow name="branch" fact={facts.branch} testId={`fact-${label}-branch`} />}
                {facts.last_commit && <FactRow name="last commit" fact={facts.last_commit} testId={`fact-${label}-commit`} />}
                {!facts.head && !facts.repo && <Notice tone="warn">No git facts for this repository.</Notice>}
              </div>
            </article>
          );
        })}
      </div>
      {(allDirty.length > 0 || allBehind.length > 0) && (
        <div style={{ marginTop: 'var(--sv-space-5)' }} data-testid="repo-summary">
          <Notice tone={allBehind.length > 0 ? 'warn' : 'default'}>
            {allDirty.length > 0 && <span>{allDirty.length} repo(s) have uncommitted changes.</span>}
            {allDirty.length > 0 && allBehind.length > 0 && <span> </span>}
            {allBehind.length > 0 && <span>{allBehind.length} repo(s) are behind their upstream.</span>}
          </Notice>
        </div>
      )}
    </Card>
  );
}

/* ---------------------------------------------------------------------------
 * Local models
 * ------------------------------------------------------------------------ */

export function LocalModelsSection({ snapshot }: { snapshot: SupervisorSnapshot | null }) {
  const section = sectionOf(snapshot, 'local_models');
  return (
    <SectionShell snapshot={snapshot} id="local_models" testId="section-local-models">
      {(s) => {
        const facts = factEntries(s);
        return facts.length === 0 ? <EmptyState title="No model facts" /> : facts.map(([k, f]) => <FactRow key={k} name={k} fact={f} testId={`model-${k}`} />);
      }}
    </SectionShell>
  );
}

/* ---------------------------------------------------------------------------
 * Team registry
 * ------------------------------------------------------------------------ */

export function TeamRegistrySection({ snapshot }: { snapshot: SupervisorSnapshot | null }) {
  const section = sectionOf(snapshot, 'team_registry') ?? sectionOf(snapshot, 'workers');
  return (
    <SectionShell snapshot={snapshot} id="team_registry" testId="section-team-registry">
      {(s) => {
        const workers = factAt(s, 'workers');
        const list = workers && Array.isArray(workers.value) ? (workers.value as Record<string, unknown>[]) : null;
        const noteFact = factAt(s, 'note');
        const registryFact = factAt(s, 'registry');

        return (
          <div className="sv-col" data-testid="team-body">
            <div className="sv-grid sv-grid--narrow">
              <StatTile label="workers" fact={factAt(s, 'worker_count')} testId="team-worker-count" />
              <StatTile label="teams" fact={factAt(s, 'team_count')} testId="team-count" />
              {/* The list length is the source's own count, so it is safe to
                  show; but it is labelled with the fact's state beside it. */}
              <StatTile label="rows returned" fact={workers} testId="team-rows" />
            </div>
            {noteFact && <Notice tone="warn">{noteFact.note || 'the backend supplied a note for this section'}</Notice>}
            {registryFact && !list && <FactRow name="registry" fact={registryFact} />}
            {list && list.length === 0 && <EmptyState title="No workers reported" note="The registry was read successfully and contained no workers. This is a verified empty, not a missing source." />}
            {list && list.length > 0 && (
              <div className="sv-scroll" style={{ maxHeight: 320 }}>
                <table className="sv-table" data-testid="worker-table">
                  <thead>
                    <tr>
                      <th>worker_id</th><th>role</th><th>dept</th><th>target</th><th>state</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((w, i) => (
                      <tr key={String(w.worker_id ?? i)} data-testid={`worker-row-${String(w.worker_id ?? i)}`}>
                        <td className="sv-mono">{String(w.worker_id ?? '—')}</td>
                        <td>{String(w.role_id ?? '—')}</td>
                        <td>{String(w.department ?? '—')}</td>
                        <td className="sv-mono">{String(w.execution_target ?? '—')}</td>
                        <td>{String(w.career_state ?? '—')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      }}
    </SectionShell>
  );
}

/* ---------------------------------------------------------------------------
 * OpenCode
 * ------------------------------------------------------------------------ */

export function OpencodeSection({ snapshot }: { snapshot: SupervisorSnapshot | null }) {
  const section = sectionOf(snapshot, 'opencode');
  return (
    <SectionShell snapshot={snapshot} id="opencode" testId="section-opencode">
      {(s) => {
        const liveness = livenessFacts(s);
        const verdict = liveness.verdict;
        const facts = Object.entries(s).filter(([k, v]) => k !== 'liveness' && isSourceFact(v)) as [string, SourceFact][];

        return (
          <div className="sv-col" data-testid="opencode-body">
            {/* The verdict is derived backend-side from real signals. We render
                its state, never our own opinion of liveness. */}
            <div className="sv-row sv-wrap" data-testid="opencode-verdict">
              <span className="sv-labelish">verdict</span>
              {verdict ? (
                <>
                  <strong className="sv-mono">{String(verdict.value ?? '—')}</strong>
                  <FactChip state={verdict.state} />
                  <span className="sv-muted">{verdict.note}</span>
                </>
              ) : (
                <span className="sv-muted">no verdict reported</span>
              )}
            </div>
            {facts.length > 0 && (
              <div>
                {facts.map(([k, f]) => <FactRow key={k} name={k} fact={f} testId={`oc-${k}`} />)}
              </div>
            )}
            {Object.keys(liveness).length > 0 && (
              <div>
                <span className="sv-labelish">liveness signals</span>
                {Object.entries(liveness).map(([k, f]) => (
                  <FactRow key={k} name={k} fact={f} testId={`oc-liveness-${k}`} />
                ))}
              </div>
            )}
          </div>
        );
      }}
    </SectionShell>
  );
}

/* ---------------------------------------------------------------------------
 * Codex
 * ------------------------------------------------------------------------ */

export function CodexSection({ snapshot }: { snapshot: SupervisorSnapshot | null }) {
  const section = sectionOf(snapshot, 'codex');
  return (
    <SectionShell snapshot={snapshot} id="codex" testId="section-codex">
      {(s) => {
        const facts = factEntries(s);
        return facts.length === 0 ? <EmptyState title="No codex facts" /> : facts.map(([k, f]) => <FactRow key={k} name={k} fact={f} testId={`codex-${k}`} />);
      }}
    </SectionShell>
  );
}

/* ---------------------------------------------------------------------------
 * Hive
 * ------------------------------------------------------------------------ */

export function HiveSection({ snapshot }: { snapshot: SupervisorSnapshot | null }) {
  const section = sectionOf(snapshot, 'hive');
  return (
    <SectionShell snapshot={snapshot} id="hive" testId="section-hive">
      {(s) => {
        const workers = factAt(s, 'workers');
        const rows = workers && Array.isArray(workers.value) ? (workers.value as Record<string, unknown>[]) : [];
        const waiting = factAt(s, 'waiting_for_quota');
        const waitingRows = waiting && Array.isArray(waiting.value) ? (waiting.value as unknown[]) : null;

        return (
          <div className="sv-col" data-testid="hive-body">
            {/* remaining_fraction can legitimately be null (unknown quota).
                That renders as absent, never as 0% - an invented percentage is
                exactly what the backend forbids. */}
            <div className="sv-grid sv-grid--narrow">
              <StatTile label="workers" fact={workers} testId="hive-workers" />
              <StatTile label="waiting on quota" fact={waiting} testId="hive-waiting" />
            </div>
            {rows.length === 0 ? (
              <EmptyState title="No hive workers" note="The scheduler reported no workers in its current overview." />
            ) : (
              <div className="sv-scroll" style={{ maxHeight: 260 }}>
                <table className="sv-table" data-testid="hive-table">
                  <thead><tr><th>worker_id</th><th>provider</th><th>tier</th><th>state</th></tr></thead>
                  <tbody>
                    {rows.map((w, i) => (
                      <tr key={String(w.worker_id ?? i)}>
                        <td className="sv-mono">{String(w.worker_id ?? '—')}</td>
                        <td>{String(w.provider ?? '—')}</td>
                        <td>{String(w.tier ?? '—')}</td>
                        <td>{String(w.state ?? '—')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {waitingRows && waitingRows.length === 0 && (
              <span className="sv-muted sv-row" data-testid="hive-no-waiting">
                <FactChip state={(waiting as SourceFact).state} />
                nothing is waiting on a quota
              </span>
            )}
          </div>
        );
      }}
    </SectionShell>
  );
}

/* ---------------------------------------------------------------------------
 * Supervision
 * ------------------------------------------------------------------------ */

export function SupervisionSection({ snapshot }: { snapshot: SupervisorSnapshot | null }) {
  const section = sectionOf(snapshot, 'supervision');
  return (
    <SectionShell snapshot={snapshot} id="supervision" testId="section-supervision">
      {(s) => {
        const byStatus = factAt(s, 'workers_by_status');
        const gaps = factAt(s, 'gaps_by_severity');
        const errorFact = factAt(s, 'error');
        const byStatusRows = byStatus && typeof byStatus.value === 'object' && byStatus.value !== null ? (byStatus.value as Record<string, unknown>) : null;
        const gapRows = gaps && typeof gaps.value === 'object' && gaps.value !== null ? (gaps.value as Record<string, unknown>) : null;

        return (
          <div className="sv-col" data-testid="supervision-body">
            <div className="sv-grid sv-grid--narrow">
              <StatTile label="workers" fact={factAt(s, 'workers_total')} testId="sup-workers-total" />
              <StatTile label="handoffs pending" fact={factAt(s, 'handoffs_pending')} testId="sup-handoffs-pending" />
              <StatTile label="gaps open" fact={factAt(s, 'gaps_open')} testId="sup-gaps-open" />
              <StatTile label="continuation required" fact={factAt(s, 'continuation_required')} testId="sup-continuation" />
            </div>

            {byStatus && <FactRow name="workers_by_status" fact={byStatus} testId="sup-by-status-fact" />}
            {byStatusRows && (
              <div className="sv-grid sv-grid--narrow" data-testid="sup-status-grid">
                {Object.entries(byStatusRows).map(([k, v]) => (
                  <div className="sv-stat" key={k}>
                    <span className="sv-stat__value">{String(v)}</span>
                    <span className="sv-stat__label">{k}</span>
                  </div>
                ))}
              </div>
            )}

            {/* §17.J / §18: the live worker roster — click a worker to inspect
                its detail and issue a continue through its real channel. */}
            <WorkerRoster section={s} />

            {/* §7 / AV-1..AV-8 (M2-A): the avatar-first team room. Reads the
                SAME `workers` fact as WorkerRoster above - one roster, one
                source, no second request. Mounted alongside the table rather
                than replacing it so the roster's detail/continue path stays
                intact until M2-B lands. */}
            <div data-testid="sup-team-room">
              <h3 className="sv-card__title">Team room</h3>
              <TeamRoom section={s} />
            </div>

            {gaps && <FactRow name="gaps_by_severity" fact={gaps} testId="sup-gaps-fact" />}
            {gapRows && (
              <div className="sv-row sv-wrap" data-testid="sup-severity-row">
                {Object.entries(gapRows).map(([k, v]) => (
                  <span className="sv-chip" key={k} data-testid={`sup-severity-${k}`}>
                    {k}: {String(v)}
                  </span>
                ))}
              </div>
            )}
            {errorFact && <Notice tone="warn" testId="sup-error">{errorFact.note}</Notice>}
          </div>
        );
      }}
    </SectionShell>
  );
}

/* ---------------------------------------------------------------------------
 * Resources
 * ------------------------------------------------------------------------ */

export function ResourcesSection({ snapshot }: { snapshot: SupervisorSnapshot | null }) {
  const section = sectionOf(snapshot, 'resources');
  return (
    <SectionShell snapshot={snapshot} id="resources" testId="section-resources">
      {(s) => {
        const pressure = factAt(s, 'pressure_state');
        const sample = factAt(s, 'sample');
        const throttles = factAt(s, 'throttle_actions');
        const errorFact = factAt(s, 'error');
        const sampleRows = sample && typeof sample.value === 'object' && sample.value !== null ? (sample.value as Record<string, unknown>) : null;
        const throttleList = throttles && Array.isArray(throttles.value) ? (throttles.value as unknown[]) : null;

        return (
          <div className="sv-col" data-testid="resources-body">
            <div className="sv-row sv-wrap" data-testid="resources-pressure">
              <span className="sv-labelish">pressure</span>
              {pressure ? (
                <>
                  <strong className="sv-mono">{String(pressure.value ?? '—')}</strong>
                  <FactChip state={pressure.state} />
                </>
              ) : (
                <span className="sv-muted">not reported</span>
              )}
            </div>
            {sample && <FactRow name="sample" fact={sample} testId="resources-sample" />}
            {sampleRows && (
              <div className="sv-grid sv-grid--narrow" data-testid="resource-samples">
                {Object.entries(sampleRows).map(([k, v]) => (
                  <div className="sv-stat" key={k}>
                    <span className="sv-stat__value sv-mono">{typeof v === 'number' ? String(v) : String(v ?? '—')}</span>
                    <span className="sv-stat__label">{k}</span>
                  </div>
                ))}
              </div>
            )}
            {throttleList && throttleList.length > 0 && (
              <div data-testid="throttle-list">
                <span className="sv-labelish">throttle actions</span>
                {throttleList.map((t, i) => (
                  <div className="sv-mono sv-truncate" key={i}>{typeof t === 'string' ? t : JSON.stringify(t)}</div>
                ))}
              </div>
            )}
            {throttleList && throttleList.length === 0 && (
              <span className="sv-muted" data-testid="no-throttles">
                <FactChip state={(throttles as SourceFact).state} />
                no throttle actions recorded
              </span>
            )}
            {errorFact && <Notice tone="warn" testId="resources-error">{errorFact.note}</Notice>}
          </div>
        );
      }}
    </SectionShell>
  );
}

/* ---------------------------------------------------------------------------
 * Knowledge
 * ------------------------------------------------------------------------ */

export function KnowledgeSection({ snapshot }: { snapshot: SupervisorSnapshot | null }) {
  const section = sectionOf(snapshot, 'knowledge');
  return (
    <SectionShell snapshot={snapshot} id="knowledge" testId="section-knowledge">
      {(s) => {
        const byType = factAt(s, 'by_type');
        const byConf = factAt(s, 'by_confidence');
        const errorFact = factAt(s, 'error');
        const toEntries = (f: unknown): [string, unknown][] | null =>
          isSourceFact(f) && typeof f.value === 'object' && f.value !== null ? Object.entries(f.value as Record<string, unknown>) : null;

        return (
          <div className="sv-col" data-testid="knowledge-body">
            <div className="sv-grid sv-grid--narrow">
              <StatTile label="objects" fact={factAt(s, 'objects')} testId="kn-objects" />
              <StatTile label="types" fact={byType} testId="kn-by-type" />
              <StatTile label="projects" fact={factAt(s, 'by_project')} testId="kn-by-project" />
            </div>
            {byType && <FactRow name="by_type" fact={byType} testId="kn-by-type-fact" />}
            {toEntries(byType) && toEntries(byType)!.length > 0 && (
              <div className="sv-row sv-wrap" data-testid="kn-types">
                {toEntries(byType)!.map(([k, v]) => (
                  <span className="sv-chip" key={k} data-testid={`kn-type-${k}`}>{k}: {String(v)}</span>
                ))}
              </div>
            )}
            {byConf && <FactRow name="by_confidence" fact={byConf} testId="kn-by-confidence" />}
            {toEntries(byConf) && toEntries(byConf)!.length > 0 && (
              <div className="sv-row sv-wrap" data-testid="kn-confidence">
                {toEntries(byConf)!.map(([k, v]) => (
                  <span className="sv-chip" key={k} data-testid={`kn-conf-${k}`}>{k}: {String(v)}</span>
                ))}
              </div>
            )}
            {errorFact && <Notice tone="warn" testId="kn-error">{errorFact.note}</Notice>}
          </div>
        );
      }}
    </SectionShell>
  );
}

/* ---------------------------------------------------------------------------
 * Overview roll-up
 * ------------------------------------------------------------------------ */

/**
 * Overview — every section's worst state at a glance.
 *
 * This is the surface most likely to mislead, because a summary invites a
 * reader to generalise. So it shows the WORST state per section, and a single
 * degraded section is visible rather than averaged away.
 */
export function Overview({ snapshot, presentIds }: { snapshot: SupervisorSnapshot | null; presentIds: string[] }) {
  const tiles = presentIds.map((id) => {
    const section = snapshot?.sections?.[id];
    const state = sectionState(section);
    const leaves = leafFacts(section);
    const worst = leaves.reduce<SourceFact | null>((acc, f) => (!acc || rank(f.state) < rank(acc.state) ? f : acc), null);
    return { id, label: SECTION_LABEL[id as keyof typeof SECTION_LABEL] ?? id, state, age: worst?.age_s ?? null, count: leaves.length };
  });

  if (tiles.length === 0) {
    return (
      <Card title="Overview" testId="overview">
        <EmptyState title="No sections reported" note="The snapshot contained no sections at all." />
      </Card>
    );
  }

  const notLive = tiles.filter((t) => t.state !== 'LIVE_VERIFIED' && t.state !== 'LIVE');

  return (
    <Card title="Overview" testId="overview">
      <div className="sv-grid sv-grid--narrow" data-testid="overview-grid">
        {tiles.map((t) => (
          <div className="sv-health" key={t.id} data-testid={`overview-${t.id}`} data-state={t.state}>
            <span className="sv-stat__label">{t.label}</span>
            <FactChip state={t.state} />
            <span className="sv-health__meta">
              {t.age === null ? 'no facts' : `${t.count} facts · oldest ${formatAge(t.age)}`}
            </span>
          </div>
        ))}
      </div>
      {notLive.length > 0 && (
        <div style={{ marginTop: 'var(--sv-space-5)' }} data-testid="overview-warnings">
          <Notice tone="warn">
            {notLive.length} section(s) are not fully verified: {notLive.map((t) => `${t.label}=${t.state}`).join(', ')}.
          </Notice>
        </div>
      )}
    </Card>
  );
}

/**
 * AbsentSections — every section the backend did not emit, in one place.
 *
 * `refresh_snapshot` only emits a section when its dependency was injected, so
 * absence is a configuration fact. Stating it once is clearer than repeating
 * the same dashed card, and it keeps the live cards from being buried under
 * notices about things that were never going to arrive.
 */
export function AbsentSections({ snapshot, presentIds }: { snapshot: SupervisorSnapshot | null; presentIds: string[] }) {
  if (!snapshot) return null;
  const missing = SECTION_IDS.filter((id) => !presentIds.includes(id));
  if (missing.length === 0) return null;

  return (
    <Card title="Not wired" state="NOT_EXPOSED" testId="section-absent">
      <div className="sv-col" data-testid="absent-list">
        <span className="sv-hint">
          The backend did not include {missing.length} section{missing.length === 1 ? '' : 's'} in this snapshot. That
          is a different thing from reporting them as empty.
        </span>
        <div className="sv-row sv-wrap">
          {missing.map((id) => (
            <span className="sv-chip" key={id} data-state="NOT_EXPOSED" data-testid={`absent-${id}`} data-declared-gap="true">
              {SECTION_LABEL[id]}
            </span>
          ))}
        </div>
      </div>
    </Card>
  );
}

/* --- local severity mirror, kept in step with the client's SEVERITY ------- */
function rank(state: string): number {
  const order: Record<string, number> = {
    NOT_EXPOSED: 0, DEFERRED_BACKEND_INTERFACE: 1, OFFLINE: 2, DEGRADED: 3,
    BLOCKED: 4, UNKNOWN: 5, STALE: 6, FIXTURE: 7, LIVE: 8, LIVE_VERIFIED: 9,
  };
  return order[state] ?? 5;
}