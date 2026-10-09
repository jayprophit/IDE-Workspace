import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * C2 regression guard: the conference grid must be size-agnostic.
 *
 * The review found a lone card stranded on a partial final row. The fix was
 * structural - flexbox wrap with centred lines - rather than a rule for any
 * particular member count. These tests exist to stop someone reintroducing a
 * count-specific rule, which would look like a fix and would break at the next
 * roster size.
 */

const COMPONENTS = join(__dirname, '..', 'tokens', 'components.css');
const css = readFileSync(COMPONENTS, 'utf8');

function ruleFor(selector: string): string {
  const idx = css.indexOf(selector);
  if (idx === -1) throw new Error(`rule not found: ${selector}`);
  const open = css.indexOf('{', idx);
  const close = css.indexOf('}', open);
  return css.slice(open, close);
}

describe('C2 - conference grid layout', () => {
  const grid = ruleFor('.gx-conference {');

  it('wraps rather than relying on a fixed column count', () => {
    expect(grid).toContain('flex-wrap: wrap');
  });

  it('centres each wrapped line, so a short final row is not stranded', () => {
    expect(grid).toContain('justify-content: center');
  });

  it('does not hard-code a column count for any roster size', () => {
    /* The original bug. A repeat(N, ...) or nth-child position hack would
     * only ever look right for the demonstration roster. Scoped to the
     * conference rules: other components legitimately use fixed small column
     * counts for their own layout (e.g. the 2x2 home launch pad). */
    const conferenceCss = css.slice(css.indexOf('.gx-conference {'));
    const conferenceTiles = conferenceCss.slice(0, conferenceCss.indexOf('.gx-tile__foot'));
    expect(conferenceTiles).not.toMatch(/repeat\(\s*\d+\s*,/);
    expect(css).not.toMatch(/nth-child\(n\+\s*\d+\)/);
    expect(css).not.toMatch(/\.gx-tile:nth-of-type/);
  });

  it('sizes cards from the density token, not a hard-coded width', () => {
    const tile = ruleFor('.gx-tile {');
    expect(tile).toContain('flex: 1 1 var(--conference-tile-min)');
    expect(tile).toContain('max-width: calc(var(--conference-tile-min) * 1.5)');
  });

  it('caps card growth so a one-card row cannot become a banner', () => {
    const tile = ruleFor('.gx-tile {');
    /* Uncapped growth plus centring would turn the lone card into a
     * full-bleed strip - a different kind of accident. */
    expect(tile).toMatch(/max-width:/);
  });

  it('constrains the avatar inside its tile so it cannot overlap neighbours', () => {
    /* Found while rendering: at narrow columns the fixed-size avatar spilled
     * out of its card. The clamp keeps the circle round and inside. */
    expect(css).toContain('.gx-tile .gx-avatar--2xl');
    expect(css).toMatch(/aspect-ratio:\s*1\s*\/\s*1/);
  });
});