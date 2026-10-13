import type { SourceFact } from '../api/types';

/**
 * M3 read-model helpers — conference, message feed, resource tiles.
 *
 * Pure readers over the SAME snapshot sections the rest of the unit uses. No
 * fetching, no fetching-adjacent state, no derived store: each function takes
 * what the backend already sent and either returns it or returns null.
 *
 * The recurring question every function here answers is "is this absent, or is
 * it zero?" — and the answer must never be confused:
 *
 *   null  -> the backend did not expose this fact, or exposed it with no
 *            value. The caller renders NOT_EXPOSED.
 *   0     -> the backend reported a real zero. The caller renders 0.
 *
 * Collapsing the two is the single easiest way for this dashboard to start
 * lying, because a fabricated 0 is indistinguishable from a healthy reading at
 * a glance and completely different in meaning.
 */

function isFact(value: unknown): value is SourceFact {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { state?: unknown }).state === 'string' &&
    typeof (value as { source?: unknown }).source === 'string'
  );
}

/** One leaf fact from a section, or null when the key is absent. */
export function readFact(section: Record<string, unknown> | undefined, key: string): SourceFact | null {
  if (!section) return null;
  const v = section[key];
  return isFact(v) ? v : null;
}

/**
 * A number that is either real or absent.
 *
 * Returns null for anything that is not a finite number, INCLUDING a
 * non-numeric string. A value the client could not parse is an absence to be
 * reported, not a zero to be displayed.
 */
export function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** A non-empty trimmed string, or null. Empty string is an absence. */
export function textOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  return t === '' ? null : t;
}

/* ---------------------------------------------------------------------------
 * Resource gauges (§6 / §10)
 * ------------------------------------------------------------------------ */

/**
 * One axis of the governor's live sample.
 *
 * Mirrors `resource_governor.ResourceSample`: every axis is independently
 * Optional, and `confidence` says how the reading was obtained. A host with no
 * GPU reports `gpu: None` while still reporting a real `cpu` — so the axes must
 * be read independently, never as a block.
 */
export interface ResourceAxes {
  cpu: number | null;
  ram: number | null;
  gpu: number | null;
  vram: number | null;
  disk_free_gb: number | null;
  confidence: string | null;
}

/** The axis identifiers a gauge renders, in display order. */
export const GAUGE_AXES = ['cpu', 'ram', 'gpu', 'vram'] as const;
export type GaugeAxis = (typeof GAUGE_AXES)[number];

/**
 * Read `resources.sample`.
 *
 * Returns null when the sample is absent OR exposed with a null value. Both
 * mean the same thing to a reader — there is no reading to show — and both must
 * render NOT_EXPOSED rather than a bar at zero.
 */
export function readResourceSample(section: Record<string, unknown> | undefined): ResourceAxes | null {
  const fact = readFact(section, 'sample');
  if (!fact) return null;
  const v = fact.value;
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const rec = v as Record<string, unknown>;
  return {
    cpu: numberOrNull(rec.cpu),
    ram: numberOrNull(rec.ram),
    gpu: numberOrNull(rec.gpu),
    vram: numberOrNull(rec.vram),
    disk_free_gb: numberOrNull(rec.disk_free_gb),
    confidence: textOrNull(rec.confidence),
  };
}

/**
 * Clamp a 0..1 axis into a bar width percentage.
 *
 * Returns null when there is no reading, so the caller can render the
 * NOT_EXPOSED treatment instead of a 0%-wide bar. The distinction is visible:
 * an absent bar and an idle bar look different because only the real reading
 * gets a fill.
 */
export function gaugePercent(value: number | null): number | null {
  if (value === null) return null;
  if (value <= 0) return 0;
  if (value >= 1) return 100;
  return value * 100;
}

/* ---------------------------------------------------------------------------
 * Git health (§6)
 * ------------------------------------------------------------------------ */

/** Per-repository git facts, as `repositories[label]` exposes them. */
export interface RepoHealth {
  label: string;
  head: string | null;
  branch: string | null;
  ahead: number | null;
  behind: number | null;
  dirty: number | null;
  /** The worst SourceState across this repo's facts. */
  state: string;
}

export interface GitHealth {
  repos: RepoHealth[];
  /** True when the section exposed no repository at all. */
  absent: boolean;
  ahead: number | null;
  behind: number | null;
  dirty: number | null;
  state: string;
}

/**
 * Roll the `repositories` section up into one git-health reading.
 *
 * Only repositories that actually appear in the snapshot are included; a repo
 * the backend never mentioned cannot be reported as clean. The totals are
 * null when no repo contributed a value for that field, so "nothing to sum" is
 * never rendered as 0.
 */
export function readGitHealth(section: Record<string, unknown> | undefined): GitHealth {
  const repos: RepoHealth[] = [];
  let ahead: number | null = null;
  let behind: number | null = null;
  let dirty: number | null = null;
  /* Collected, not folded from a seed: seeding with a worst-state sentinel
     would pin the roll-up at that sentinel forever, so a healthy fleet could
     never read as healthy. */
  const repoStates: string[] = [];

  if (section) {
    for (const [label, value] of Object.entries(section)) {
      if (!isFact(value)) {
        /* repositories is a group of per-repo groups. */
        const group = value as Record<string, unknown> | null;
        if (typeof group !== 'object' || group === null) continue;
        const leaves = Object.entries(group).filter(([, f]) => isFact(f)) as [string, SourceFact][];
        if (leaves.length === 0) continue;

        const pick = (key: string) => {
          const found = leaves.find(([k]) => k === key);
          return found ? found[1] : null;
        };
        const repo: RepoHealth = {
          label,
          head: textOrNull(pick('head')?.value),
          branch: textOrNull(pick('branch')?.value),
          ahead: numberOrNull(pick('ahead')?.value),
          behind: numberOrNull(pick('behind')?.value),
          dirty: numberOrNull(pick('dirty_count')?.value),
          state: worstOf(leaves.map(([, f]) => f.state)),
        };
        repos.push(repo);
        ahead = addNullable(ahead, repo.ahead);
        behind = addNullable(behind, repo.behind);
        dirty = addNullable(dirty, repo.dirty);
        repoStates.push(repo.state);
      }
    }
  }

  return {
    repos,
    absent: repos.length === 0,
    ahead,
    behind,
    dirty,
    state: repos.length === 0 ? 'NOT_EXPOSED' : worstOf(repoStates),
  };
}

function addNullable(acc: number | null, next: number | null): number | null {
  if (next === null) return acc;
  return (acc ?? 0) + next;
}

/* ---------------------------------------------------------------------------
 * State algebra
 * ------------------------------------------------------------------------ */

/**
 * Severity ranking for the honesty vocabulary.
 *
 * Deliberately total: an unrecognised state is treated as DEGRADED so a new
 * backend state degrades the roll-up rather than silently improving it.
 */
const SEVERITY: Record<string, number> = {
  LIVE_VERIFIED: 0,
  LIVE: 1,
  FIXTURE: 2,
  UNKNOWN: 3,
  DEGRADED: 4,
  STALE: 5,
  OFFLINE: 6,
  BLOCKED: 7,
  NOT_EXPOSED: 8,
  DEFERRED_BACKEND_INTERFACE: 9,
};

function worse(a: string, b: string): string {
  return (SEVERITY[b] ?? 3) > (SEVERITY[a] ?? 3) ? b : a;
}

/**
 * Worst state in a set, or NOT_EXPOSED when the set is empty.
 *
 * The empty case is NOT_EXPOSED rather than LIVE_VERIFIED on purpose: no
 * observations is not a healthy result. Callers that genuinely have nothing to
 * compare should say so rather than look clean.
 */
export function worstOf(states: string[]): string {
  if (states.length === 0) return 'NOT_EXPOSED';
  return states.reduce(worse);
}

/**
 * Combine facts into one state without ever upgrading any of them.
 *
 * Two properties this must keep:
 *   - a fact that is not exposed cannot make the result look healthier
 *   - an OFFLINE reading can never be masked by a healthy sibling
 *
 * So an all-healthy set reports healthy, and a set containing any degraded or
 * absent fact reports that worst fact. The seed is NOT a "worst state" value —
 * it is the identity for the fold — otherwise the result would be pinned at
 * NOT_EXPOSED and could never improve, which is its own kind of dishonesty.
 */
export function combineStates(...states: (string | null | undefined)[]): string {
  const present = states.filter((s): s is string => typeof s === 'string' && s !== '');
  if (present.length === 0) return 'NOT_EXPOSED';
  return present.reduce(worse);
}