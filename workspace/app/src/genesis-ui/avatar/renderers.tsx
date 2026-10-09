import type { AvatarRenderer, AvatarRendererProps, AvatarSize } from '../types';
import { getAccent, initialsOf } from '../avatars';

/**
 * PLACEHOLDER RENDERER.
 *
 * This draws a geometric stand-in - initials over a gradient derived from the
 * avatar's own accent, inside a soft vignette. It is deliberately abstract.
 *
 * What this renderer is NOT, stated plainly because the distinction matters:
 *   - it is not a rendered face, portrait, or photograph
 *   - it does not animate the face
 *   - it does not lip-sync, and there is no audio pipeline behind it
 *   - it is not a 3D or video avatar
 *
 * `isLive` is false, and the UI reads that flag rather than assuming, so no
 * view can advertise animation that does not exist.
 *
 * Replacing it: implement `AvatarRenderer`, register it (see registry below),
 * and select it in `AvatarStage`. Views do not change, because none of them
 * import a renderer.
 */
export const PlaceholderAvatarRenderer: AvatarRenderer = {
  id: 'placeholder',
  isLive: false,
  render({ preset, size }: AvatarRendererProps) {
    const accent = getAccent(preset.id);
    const gradientId = `gx-av-grad-${preset.id}`;
    /* The "placeholder" marker is only shown on stage-sized avatars. At chip,
     * sm and md the circle is too small for it to sit under the initials
     * without colliding with them, and the surrounding surfaces (team strip,
     * queues, headers) already label the scaffold's status. Colliding text
     * would be worse than no marker. */
    const showMarker = size === 'xl' || size === '2xl' || size === '3xl';

    return (
      <>
        <svg
          aria-hidden="true"
          viewBox="0 0 100 100"
          preserveAspectRatio="xMidYMid slice"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={accent.from} stopOpacity="0.42" />
              <stop offset="100%" stopColor={accent.to} stopOpacity="0.08" />
            </linearGradient>
          </defs>
          <rect x="0" y="0" width="100" height="100" fill={`url(#${gradientId})`} />
          {/* Vignette. Gives the circle a centre of gravity without implying
              a face - a drawn feature would read as an attempt at a likeness. */}
          <circle cx="50" cy="42" r="30" fill={accent.to} opacity="0.1" />
          <circle cx="50" cy="50" r="46" fill="none" stroke={accent.to} strokeOpacity="0.16" strokeWidth="1.5" />
        </svg>

        <span
          aria-hidden="true"
          className="gx-avatar__placeholder-mark"
          style={{ position: 'relative', zIndex: 1 }}
        >
          {initialsOf(preset)}
        </span>

        {showMarker && <span className="gx-avatar__placeholder-label">placeholder</span>}
      </>
    );
  },
};

/* ---------------------------------------------------------------------------
 * Registry - the actual upgrade seam.
 * ------------------------------------------------------------------------ */

const RENDERERS = new Map<string, AvatarRenderer>([[PlaceholderAvatarRenderer.id, PlaceholderAvatarRenderer]]);

/**
 * Register an alternative renderer.
 *
 * A live implementation registers under its own id and becomes selectable.
 * No view, token, or registry file needs to change - that is the whole point
 * of routing avatar drawing through this seam.
 */
export function registerAvatarRenderer(renderer: AvatarRenderer): void {
  RENDERERS.set(renderer.id, renderer);
}

export function getAvatarRenderer(id: string): AvatarRenderer {
  const found = RENDERERS.get(id);
  /* istanbul ignore next - the fallback is defensive; ids come from our own UI */
  if (!found) return PlaceholderAvatarRenderer;
  return found;
}

export function listAvatarRenderers(): AvatarRenderer[] {
  return [...RENDERERS.values()];
}

/** Whether the active renderer can actually animate. Views use this, not a guess. */
export function isLiveRenderer(id: string): boolean {
  return getAvatarRenderer(id).isLive;
}

export const PLACEHOLDER_RENDERER_ID = PlaceholderAvatarRenderer.id;
export const AVATAR_SIZES: AvatarSize[] = ['chip', 'sm', 'md', 'lg', 'xl', '2xl', '3xl'];