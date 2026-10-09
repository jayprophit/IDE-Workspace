import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AvatarStage } from './AvatarStage';
import { MAIN_AVATARS, SPECIALIST_AVATARS } from '../avatars';
import type { AvatarSize } from '../types';

/**
 * Renderer presentation tests.
 *
 * The size steps decide whether the "placeholder" marker fits inside the
 * circle. These lock that mapping down so a later size change cannot quietly
 * reintroduce overlapping text on the small steps.
 */

const STAGE_SIZES: AvatarSize[] = ['xl', '2xl', '3xl'];
const COMPACT_SIZES: AvatarSize[] = ['chip', 'sm', 'md', 'lg'];

describe('avatar size steps', () => {
  it('shows the placeholder marker on stage sizes', () => {
    const preset = MAIN_AVATARS[0];
    for (const size of STAGE_SIZES) {
      const { unmount } = render(
        <AvatarStage preset={preset} instance={{ presetId: preset.id, presence: 'idle' }} size={size} statePill={false} />,
      );
      expect(screen.getByText('placeholder'), `expected marker at ${size}`).toBeInTheDocument();
      unmount();
    }
  });

  it('omits the marker on compact sizes so it cannot collide with initials', () => {
    const preset = MAIN_AVATARS[0];
    for (const size of COMPACT_SIZES) {
      const { unmount } = render(
        <AvatarStage preset={preset} instance={{ presetId: preset.id, presence: 'idle' }} size={size} statePill={false} />,
      );
      expect(screen.queryByText('placeholder'), `unexpected marker at ${size}`).not.toBeInTheDocument();
      /* Initials must still render at every size. */
      expect(screen.getByText('AE')).toBeInTheDocument();
      unmount();
    }
  });

  it('renders every preset at every size without throwing', () => {
    const sizes: AvatarSize[] = [...COMPACT_SIZES, ...STAGE_SIZES];
    for (const preset of [...MAIN_AVATARS, ...SPECIALIST_AVATARS]) {
      for (const size of sizes) {
        const { unmount } = render(
          <AvatarStage preset={preset} instance={{ presetId: preset.id, presence: 'idle' }} size={size} />,
        );
        expect(screen.getByRole('img')).toBeInTheDocument();
        unmount();
      }
    }
  });

  it('surfaces presence as a labelled state, never a silent visual cue', () => {
    const preset = MAIN_AVATARS[0];
    for (const presence of ['idle', 'listening', 'speaking', 'thinking', 'offline'] as const) {
      const { unmount } = render(
        <AvatarStage preset={preset} instance={{ presetId: preset.id, presence }} size="lg" />,
      );
      expect(screen.getByTestId('avatar-state')).toHaveTextContent(presence);
      expect(screen.getByTestId('avatar-frame')).toHaveAttribute('data-presence', presence);
      unmount();
    }
  });
});