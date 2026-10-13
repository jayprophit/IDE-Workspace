import type { SupervisorSnapshot } from '../api/types';
import { readGitHealth, readResourceSample, gaugePercent, GAUGE_AXES, type GaugeAxis, type GitHealth } from './m3-readmodel';

/**
 * ResourceMeters (§6 / §10) — the PerformanceDashboardModal mechanism, honest.
 *
 * The prototype's version produced CPU 8-65% and memory 220-780MB from
 * `Math.random()` on a 1.8s interval, with a sparkline seeded from an invented
 * 15-sample history. It looked measured and was not. None of that is ported.
 *
 * What IS ported is the mechanism: a track-and-fill bar per axis, which is the
 * right shape for a 0..1 utilisation reading, plus the honesty that makes it
 * trustworthy.
 *
 * The contract is `resource_governor.ResourceSample`: cpu / ram / gpu / vram
 * are each independently Optional, with a `confidence` string. A host with no
 * GPU reports `gpu: None` while still reporting a real cpu. So:
 *
 *   - an axis with no reading renders a dashed NOT_EXPOSED track, never a
 *     0%-filled bar. An idle CPU and an unmeasurable GPU must not look alike.
 *   - when `resources.sample` itself is null, EVERY axis is NOT_EXPOSED. That
 *     is the live situation on this deployment today.
 *   - no sparkline. There is no real time-series in the snapshot; a history
 *     buffer would have to be synthesised, which is the exact thing this unit
 *     forbids.
 */

const AXIS_LABEL: Record<GaugeAxis, string> = {
  cpu: 'CPU',
  ram: 'RAM',
  gpu: 'GPU',
  vram: 'VRAM',
};

export function ResourceMeters({ section }: { section: Record<string, unknown> | undefined }) {
  const sample = readResourceSample(section);

  return (
    <div className="sv-card sv-res" data-testid="resource-meters" data-sample={sample ? 'present' : 'absent'}>
      <div className="sv-mission__head">
        <h3 className="sv-card__title">
          Resource <span className="sv-grad-text">gauges</span>
        </h3>
        <span className="sv-muted sv-mission__sub">
          {sample
            ? `governor confidence: ${sample.confidence ?? 'not reported'}`
            : 'the governor has not exposed a sample'}
        </span>
      </div>

      <div className="sv-res__grid" role="list">
        {GAUGE_AXES.map((axis) => {
          const value = sample ? sample[axis] : null;
          const pct = gaugePercent(value);
          /* An axis with no reading is NOT_EXPOSED, full stop. The fact state
             for the whole sample is irrelevant here: one live axis must not
             make a dead sibling look measured. */
          const exposed = pct !== null;
          return (
            <div
              key={axis}
              className="sv-res__gauge"
              role="listitem"
              data-testid={`gauge-${axis}`}
              data-exposed={exposed ? 'true' : 'false'}
              data-state={exposed ? 'LIVE' : 'NOT_EXPOSED'}
            >
              <div className="sv-res__gauge-head">
                <span className="sv-tile__k">{AXIS_LABEL[axis]}</span>
                <span className="sv-res__gauge-val" data-testid={`gauge-${axis}-value`}>
                  {exposed ? `${Math.round(pct as number)}%` : 'NOT EXPOSED'}
                </span>
              </div>
              <div
                className="sv-res__track"
                role="meter"
                aria-label={`${AXIS_LABEL[axis]} utilisation`}
                aria-valuenow={exposed ? Math.round(pct as number) : undefined}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuetext={exposed ? `${Math.round(pct as number)} percent` : 'not exposed'}
              >
                {/* A dash rather than a zero-width fill: the empty track is
                    drawn so the axis is still legible as a gauge. */}
                <div className="sv-res__fill" style={exposed ? { width: `${pct}%` } : undefined} />
              </div>
            </div>
          );
        })}
      </div>

      {sample && sample.disk_free_gb !== null && (
        <div className="sv-res__foot" data-testid="gauge-disk">
          disk free {sample.disk_free_gb} GB
        </div>
      )}
    </div>
  );
}

/**
 * GitHealthPanel (§6) — repository health from the `repositories` section.
 *
 * Reports only repositories the backend actually listed. ahead/behind/dirty
 * totals are null when no repository contributed that field, so "nothing to
 * sum" is not rendered as a healthy 0.
 */
export function GitHealthPanel({ section }: { section: Record<string, unknown> | undefined }) {
  const git = readGitHealth(section);

  if (git.absent) {
    return (
      <div className="sv-card sv-git" data-testid="git-health" data-state="NOT_EXPOSED">
        <h3 className="sv-card__title">
          Git <span className="sv-grad-text">health</span>
        </h3>
        <div className="sv-muted" data-testid="git-not-exposed">
          No repository facts in this snapshot. Reporting no repositories — not reporting clean repositories.
        </div>
      </div>
    );
  }

  return (
    <div className="sv-card sv-git" data-testid="git-health" data-state={git.state}>
      <h3 className="sv-card__title">
        Git <span className="sv-grad-text">health</span>
      </h3>
      <div className="sv-git__totals" data-testid="git-totals">
        <span data-testid="git-dirty">
          dirty {git.dirty ?? 'not reported'}
        </span>
        <span data-testid="git-ahead">ahead {git.ahead ?? 'not reported'}</span>
        <span data-testid="git-behind">behind {git.behind ?? 'not reported'}</span>
      </div>
      <table className="sv-table">
        <thead>
          <tr>
            <th scope="col">repository</th>
            <th scope="col">branch</th>
            <th scope="col">head</th>
            <th scope="col">dirty</th>
          </tr>
        </thead>
        <tbody>
          {git.repos.map((r) => (
            <tr key={r.label} data-testid={`git-repo-${r.label}`}>
              <td>{r.label}</td>
              <td className="sv-mono">{r.branch ?? 'not reported'}</td>
              <td className="sv-mono">{r.head ?? 'not reported'}</td>
              {/* A null count stays null: an unreported dirty_count is not 0. */}
              <td>{r.dirty ?? 'not reported'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * TestHealthTile (§6) — a tile whose source does not exist YET.
 *
 * There is no test/CI fact anywhere in the supervisor snapshot: the live
 * payload contains no `test`, `ci`, `build` or `lint` key at all. The honest
 * thing is to say exactly that, rather than ship a plausible-looking tile
 * reading "0 failures" that no backend produced.
 *
 * It is rendered as a DEFERRED_BACKEND_INTERFACE tile rather than being omitted,
 * because "test health is not wired yet" is information a reader wants; a
 * missing tile would be indistinguishable from an oversight.
 */
export function TestHealthTile({ snapshot }: { snapshot: SupervisorSnapshot | null }) {
  /* Proving the absence rather than assuming it: scan every section for a
     test-shaped key. If the backend ever adds one, this tile finds it and
     reports the real value instead of claiming there is none. */
  const discovered = findTestFact(snapshot);

  return (
    <div
      className="sv-tile sv-tile--amber"
      role="listitem"
      data-testid="mission-tile-tests"
      data-fact-state={discovered ? discovered.state : 'DEFERRED_BACKEND_INTERFACE'}
      data-tone="muted"
    >
      <div className="sv-tile__k">Test health</div>
      <div className="sv-tile__v">{discovered ? String(discovered.value) : '—'}</div>
      <div className="sv-tile__note" data-testid="test-health-note">
        {discovered ? 'reported by the backend' : 'no test/CI fact in the supervisor API'}
      </div>
      <div className="sv-tile__state">
        {discovered ? discovered.state === 'NOT_EXPOSED' ? 'NOT EXPOSED' : discovered.state : 'DEFERRED'}
      </div>
    </div>
  );
}

/** Keys that would count as a real test-health source, if the backend had one. */
const TEST_KEYS = ['tests', 'test_health', 'ci', 'ci_health', 'build', 'build_health', 'lint'];

/**
 * Scan the whole snapshot for a test-shaped fact. Returns null when absent.
 *
 * Two places a test source can live, and BOTH are checked:
 *   - as a section name (`ci: {health: fact}`) — the section itself is the
 *     signal, and skipping this case is how a real reading gets missed
 *   - as a field inside a section (`repositories.tests: fact`)
 */
function findTestFact(snapshot: SupervisorSnapshot | null): { value: unknown; state: string } | null {
  const sections = snapshot?.sections;
  if (!sections) return null;
  for (const [sectionName, section] of Object.entries(sections)) {
    if (typeof section !== 'object' || section === null) continue;

    if (TEST_KEYS.includes(sectionName)) {
      const fromSection = asTestFact(section);
      if (fromSection) return fromSection;
    }

    for (const [key, value] of Object.entries(section)) {
      if (!TEST_KEYS.includes(key)) continue;
      const found = asTestFact(value);
      if (found) return found;
    }
  }
  return null;
}

/**
 * A test key may hold a fact directly (`tests: SourceFact`) or a group of them
 * (`ci: { health: SourceFact }`). Both shapes are accepted so the tile reports a
 * real reading as soon as the backend exposes one in either form.
 */
function asTestFact(value: unknown): { value: unknown; state: string } | null {
  const rec = value as { value?: unknown; state?: string } | null;
  if (rec && typeof rec === 'object' && typeof rec.state === 'string') {
    return { value: rec.value, state: rec.state };
  }
  if (rec && typeof rec === 'object') {
    for (const inner of Object.values(rec)) {
      const nested = asTestFact(inner);
      if (nested) return nested;
    }
  }
  return null;
}

/** Re-exported so the dashboard composes tiles without importing two modules. */
export type { GitHealth };