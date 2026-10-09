import { useId } from 'react';
import type { AvatarInstance, AvatarPreset, AvatarSize, AvatarRenderer } from '../types';
import { getAvatarRenderer, PLACEHOLDER_RENDERER_ID } from './renderers';

/**
 * AvatarStage - the single avatar-first surface.
 *
 * Everything visual about an avatar that is NOT the face itself lives here:
 * the presence halo, the rings, the state pill, the caption. That separation
 * is deliberate. A live renderer replaces only the inner frame content and
 * inherits all of this chrome unchanged.
 *
 * Truth rule: `presence` is rendered as given and is never simulated. There is
 * no timer in this component that advances a state on its own.
 */

export interface AvatarStageProps {
  preset: AvatarPreset;
  instance: AvatarInstance;
  size?: AvatarSize;
  /** Which registered renderer draws the avatar. Defaults to the placeholder. */
  rendererId?: string;
  /** Show the concentric rings. Off for chips and dense grids. */
  rings?: boolean;
  /** Show the name/role caption beneath the frame. */
  caption?: boolean;
  /** Show the presence state pill. */
  statePill?: boolean;
  /** Heading level for the avatar name, when captioned. */
  captionLevel?: 'h1' | 'h2' | 'h3' | 'div';
}

const PRESENCE_LABEL: Record<AvatarInstance['presence'], string> = {
  idle: 'idle',
  listening: 'listening',
  speaking: 'speaking',
  thinking: 'thinking',
  offline: 'offline',
};

export function AvatarStage({
  preset,
  instance,
  size = 'lg',
  rendererId = PLACEHOLDER_RENDERER_ID,
  rings = true,
  caption = true,
  statePill = true,
  captionLevel = 'div',
}: AvatarStageProps) {
  const renderer: AvatarRenderer = getAvatarRenderer(rendererId);
  const { presence } = instance;
  const headingId = useId();
  const showRings = rings && size !== 'chip' && size !== 'sm';
  const CaptionTag = captionLevel;

  return (
    <div className="gx-avatar-stage" data-testid="avatar-stage">
      <div className="gx-avatar-stage__frame">
        {showRings && (
          <>
            <span className="gx-avatar-stage__glow" aria-hidden="true" />
            <span className="gx-avatar-stage__ring gx-avatar-stage__ring--outer" aria-hidden="true" />
            <span className="gx-avatar-stage__ring" data-presence={presence} aria-hidden="true" />
          </>
        )}

        <div
          className={`gx-avatar gx-avatar--${size}`}
          data-presence={presence}
          data-testid="avatar-frame"
          data-renderer={renderer.id}
          data-live={renderer.isLive ? 'true' : 'false'}
          role="img"
          aria-labelledby={headingId}
        >
          {renderer.render({ preset, instance, size })}
        </div>
      </div>

      {caption && (
        <div className="gx-avatar-stage__caption">
          <CaptionTag id={headingId} className="gx-avatar-stage__name">
            {preset.name}
          </CaptionTag>
          <span className="gx-avatar-stage__role">{preset.role}</span>
          {instance.utterance && (
            <span className="gx-avatar-stage__role gx-truncate" data-testid="avatar-utterance">
              &ldquo;{instance.utterance}&rdquo;
            </span>
          )}
        </div>
      )}

      {statePill && (
        <span className="gx-avatar-state" data-presence={presence} data-testid="avatar-state">
          <span className={`gx-dot gx-dot--${presence === 'speaking' ? 'success' : presence === 'listening' ? 'info' : presence === 'thinking' ? 'warning' : 'none'}`} />
          {PRESENCE_LABEL[presence]}
        </span>
      )}
    </div>
  );
}

/**
 * AvatarChip - compact inline identity for lists, headers and queues.
 *
 * Same renderer seam, no rings or caption. Used wherever the references show a
 * small circular identity next to a name.
 */
export function AvatarChip({
  preset,
  presence = 'idle',
  size = 'sm',
  rendererId = PLACEHOLDER_RENDERER_ID,
  label,
}: {
  preset: AvatarPreset;
  presence?: AvatarInstance['presence'];
  size?: AvatarSize;
  rendererId?: string;
  label?: string;
}) {
  const renderer = getAvatarRenderer(rendererId);
  const instance: AvatarInstance = { presetId: preset.id, presence };
  return (
    <span
      className={`gx-avatar gx-avatar--${size}`}
      data-presence={presence}
      data-testid="avatar-chip"
      data-live={renderer.isLive ? 'true' : 'false'}
      role="img"
      aria-label={label ?? `${preset.name}, ${preset.role}`}
    >
      {renderer.render({ preset, instance, size })}
    </span>
  );
}