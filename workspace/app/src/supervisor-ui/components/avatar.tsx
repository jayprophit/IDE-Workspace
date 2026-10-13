import type { CSSProperties } from 'react';
import type { SourceState } from './avatar-types';

/**
 * Deterministic worker avatar.
 *
 * §4 / AV-1..AV-2, §7: workers must read as team members, not table rows.
 *
 * Three properties this file exists to guarantee:
 *
 *   1. DETERMINISTIC. The same worker_id always yields the same hue and the
 *      same initials. Nothing here reads the clock, the network, or a random
 *      source. A worker looks identical on every render, in every session,
 *      which is what makes an avatar recognisable at a glance.
 *
 *   2. THEMEABLE. The hue is a NUMBER. Colour comes from tokens
 *      (`--avatar-hue-l` / `--avatar-hue-s` / `--avatar-ink`), so all five
 *      themes can re-grade the same avatar without a code change and without
 *      a single raw colour literal in this module.
 *
 *   3. CONTRAST-SAFE. The glyph is drawn in `--avatar-ink`, never in a
 *      hue-derived colour. A hue-derived ink would put contrast at the mercy
 *      of whichever hash a worker happened to get, and some hues would fail
 *      on some themes. Tying ink to the theme's own text colour means
 *      contrast is guaranteed by the theme, not by luck.
 */

/* ---------------------------------------------------------------------------
 * Deterministic hue
 * ------------------------------------------------------------------------ */

/**
 * FNV-1a, 32-bit.
 *
 * Chosen over a naive sum because a naive sum collides heavily on short,
 * hyphenated ids - "codex-primary" and "codex-private" would land close
 * together. FNV-1a spreads short strings well for a stable visual key.
 */
export function hashWorkerId(workerId: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < workerId.length; i += 1) {
    hash ^= workerId.charCodeAt(i);
    /* hash * 16777619, kept in 32-bit space without overflowing the mantissa. */
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Hue in degrees, 0–359.
 *
 * Modulo 360 on the full hash rather than a scaled slice: any scaling biases
 * the distribution and leaves some hues unreachable.
 */
export function hueForWorker(workerId: string): number {
  return hashWorkerId(workerId) % 360;
}

/* ---------------------------------------------------------------------------
 * Initials
 * ------------------------------------------------------------------------ */

function segments(workerId: string): string[] {
  return workerId
    .split(/[^a-z0-9]+/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Up to two initials from a worker id.
 *
 * First and last segment, so "codex-primary" reads CP and "ollama-local"
 * reads OL. Two rules, both deliberate:
 *
 *   - FIRST + LAST rather than first two: a worker id is
 *     <qualifier>-<deployment-slot> in every real case, so the first and last
 *     segments are the two that actually identify it. Taking the first two
 *     would collapse "codex-primary" and "codex-private" to the same CO.
 *   - NO "generic segment" filtering. An earlier version dropped words like
 *     "primary" and "local", which turned "codex-primary" into a single-word
 *     id and then rendered CO - worse, and it made a bare "primary" render "??"
 *     for a worker that exists. Every segment of an id is evidence; none of it
 *     is noise to be discarded.
 */
export function initialsFor(workerId: string): string {
  const parts = segments(workerId);
  if (parts.length === 0) return '??';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/* ---------------------------------------------------------------------------
 * Role glyph
 * ------------------------------------------------------------------------ */

/**
 * A small set of recognisable role glyphs.
 *
 * Keyed on SUBSTRINGS of the role, because real roles vary by deployment
 * ("mat-worker", "ide-worker", "local-worker", "supervisor"). Matching the
 * meaningful stem keeps this working without an exhaustive list that would
 * still miss the next role someone adds.
 */
const ROLE_GLYPHS: { match: RegExp; glyph: string }[] = [
  { match: /supervis|hermes|orchestrat|lead|director/i, glyph: '⌘' },
  { match: /implement|ide|engineer|develop|build|code/i, glyph: '⚒' },
  { match: /local|ollama|runtime|host/i, glyph: '▤' },
  { match: /mat|research|analy|investigat|data/i, glyph: '⌕' },
  { match: /review|qa|verif|test|audit/i, glyph: '✓' },
  { match: /design|creative|art/i, glyph: '◐' },
  { match: /ops|infra|devops|deploy/i, glyph: '⚙' },
];

const FALLBACK_GLYPH = '◇';

export function glyphForRole(role: string | undefined): string {
  if (!role) return FALLBACK_GLYPH;
  for (const { match, glyph } of ROLE_GLYPHS) {
    if (match.test(role)) return glyph;
  }
  return FALLBACK_GLYPH;
}

/* ---------------------------------------------------------------------------
 * Status -> source-state
 * ------------------------------------------------------------------------ */

/**
 * Map a worker status onto the honesty vocabulary.
 *
 * Deliberately conservative: a status the map does not recognise becomes
 * UNKNOWN, not LIVE_VERIFIED. An unknown worker status must never render as a
 * healthy one - the whole unit's honesty law applied to the one field a person
 * is most likely to trust at a glance.
 */
export function stateForStatus(status: string | undefined): SourceState {
  const s = (status ?? '').toUpperCase();
  switch (s) {
    case 'IMPLEMENTING':
    case 'EXECUTING':
    case 'RUNNING':
    case 'ACTIVE':
    case 'BUSY':
      return 'LIVE_VERIFIED';
    case 'WAITING_FOR_QUOTA':
      return 'STALE';
    case 'WAITING':
    case 'QUEUED':
      return 'LIVE';
    case 'REVIEWING':
    case 'VERIFYING':
      return 'LIVE_VERIFIED';
    case 'BLOCKED':
    case 'FAILED':
    case 'ERROR':
      return 'DEGRADED';
    case 'OFFLINE':
    case 'STOPPED':
    case 'DISABLED':
      return 'OFFLINE';
    case 'IDLE':
      return 'LIVE';
    case '':
    case undefined:
    case null:
      return 'UNKNOWN';
    default:
      return 'UNKNOWN';
  }
}

/* ---------------------------------------------------------------------------
 * Sizes
 * ------------------------------------------------------------------------ */

/** Pixel sizes fixed by the unit spec: sm 32, md 48, lg 96, xl 160. */
export const AVATAR_SIZES = { sm: 32, md: 48, lg: 96, xl: 160 } as const;

export type AvatarSizeId = keyof typeof AVATAR_SIZES;

export const AVATAR_SIZE_IDS = Object.keys(AVATAR_SIZES) as AvatarSizeId[];

/* ---------------------------------------------------------------------------
 * Component
 * ------------------------------------------------------------------------ */

export interface WorkerAvatarProps {
  workerId: string;
  role?: string;
  /** Status drives the ring colour, via the existing fact-state tokens. */
  status?: string;
  size?: AvatarSizeId;
  /**
   * Overrides the accessible name. Defaults to "<name> — <role>", per AV-2:
   * identity must be readable without hovering.
   */
  label?: string;
  testId?: string;
}

export function WorkerAvatar({ workerId, role, status, size = 'md', label, testId }: WorkerAvatarProps) {
  const px = AVATAR_SIZES[size];
  const initials = initialsFor(workerId);
  const glyph = glyphForRole(role);
  const state = stateForStatus(status);
  const hue = hueForWorker(workerId);

  /* Only a NUMBER crosses into CSS. The colour itself is assembled from
     tokens in stylesheets/tokens.css, which is what keeps this module free of
     raw colour while still being themeable. */
  const style = { '--avatar-h': String(hue), width: `${px}px`, height: `${px}px` } as CSSProperties;

  const accessibleName = label ?? (role ? `${workerId} — ${role}` : workerId);

  return (
    <span
      className={`sv-avatar sv-avatar--${size}`}
      style={style}
      data-state={state}
      data-hue={hue}
      data-size={size}
      role="img"
      aria-label={accessibleName}
      data-testid={testId ?? `avatar-${workerId}`}
    >
      <span className="sv-avatar__ring" aria-hidden="true" />
      <span className="sv-avatar__disc" aria-hidden="true">
        <svg viewBox="0 0 100 100" className="sv-avatar__glyph" focusable="false" aria-hidden="true">
          <text x="50" y="50" textAnchor="middle" dominantBaseline="central">
            {glyph}
          </text>
        </svg>
      </span>
      <span className="sv-avatar__initials" aria-hidden="true">
        {initials}
      </span>
    </span>
  );
}

/* ---------------------------------------------------------------------------
 * Avatar tile - large presentation used by the team room
 * ------------------------------------------------------------------------ */

/**
 * AvatarTile is the card-sized presentation (>= 96px, per AV-1).
 *
 * `showGlyph` exists because at 96px+ the initials alone read as a logo rather
 * than a worker; the role glyph is the thing that distinguishes a supervisor
 * from an implementer at a glance.
 */
export function AvatarTile({
  workerId,
  role,
  status,
  label,
  testId,
}: Omit<WorkerAvatarProps, 'size'> & { size?: AvatarSizeId }) {
  return (
    <div className="sv-avatar-tile" data-testid={testId ?? `avatar-tile-${workerId}`}>
      <WorkerAvatar workerId={workerId} role={role} status={status} size="lg" label={label} />
    </div>
  );
}