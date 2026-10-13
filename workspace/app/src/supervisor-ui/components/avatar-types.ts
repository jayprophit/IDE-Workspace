import type { SourceState } from '../api/types';

/**
 * Avatar-local type re-export.
 *
 * `avatar.tsx` needs `SourceState` for the honest status mapping, but that
 * type is owned by the API contract, not by the presentation layer. Re-export
 * it here so the avatar module's dependency surface stays a single line and
 * obvious, without duplicating the ten-state union.
 *
 * (The pixel size union lives in `avatar.tsx` next to `AVATAR_SIZES`, since
 * the two must stay in lockstep and there is no reason to split them.)
 */
export type { SourceState };