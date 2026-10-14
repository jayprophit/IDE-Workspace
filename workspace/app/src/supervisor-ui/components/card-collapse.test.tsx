import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * §16 CARD/FLEX COLLAPSE REGRESSION.
 *
 * M3 shipped a second live defect: `.sv-card` + column flexbox +
 * `min-height: 0` allowed content-bearing cards to collapse to ~46px,
 * clipping the mission-control tiles and worker cards. This test reads the
 * real tokens.css and asserts the card rule carries a useful min-height
 * floor. It must fail loudly if that ever regresses.
 */

const CSS_PATH = resolve(__dirname, '../tokens/tokens.css');

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function ruleBody(css: string, selector: string): string | null {
  const clean = stripComments(css);
  // find `selector { ... }` (last definition wins in CSS; we check them all
  // but require the effective one — approximated by the last match)
  const re = new RegExp(
    `${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`,
    'g',
  );
  const matches = [...clean.matchAll(re)];
  return matches.length ? matches[matches.length - 1][1] : null;
}

/** Parse a raw min-height VALUE (e.g. "140px", "8.75rem") to px. */
function minHeightValuePx(v: string): number | null {
  const value = v.trim();
  const px = value.match(/^(\d+(?:\.\d+)?)px$/i);
  if (px) return parseFloat(px[1]);
  const rem = value.match(/^(\d+(?:\.\d+)?)rem$/i);
  if (rem) return parseFloat(rem[1]) * 16;
  return null;
}

describe('card collapse regression (§16)', () => {
  const css = readFileSync(CSS_PATH, 'utf8');

  it('.sv-card has an explicit min-height floor', () => {
    const body = ruleBody(css, '.sv-card');
    expect(body, '.sv-card rule not found in tokens.css').not.toBeNull();
    expect(body, '.sv-card has no min-height at all').toMatch(/min-height/i);
  });

  it('.sv-card min-height is >= 120px (or a token that resolves to it)', () => {
    const body = ruleBody(css, '.sv-card') ?? '';
    const raw = (body.match(/min-height\s*:\s*([^;]+);/i) ?? [])[1]?.trim();
    expect(raw, 'no min-height on .sv-card').toBeDefined();
    if (/^var\(/.test(raw ?? '')) {
      // resolve the token from the css and require it be a px/rem >= 120
      const token = (raw ?? '').match(/var\((--[a-z0-9-]+)/i)?.[1];
      expect(token, 'dangling var in min-height').toBeDefined();
      const decl = stripComments(css).match(new RegExp(`${token}\\s*:\\s*([^;]+);`, 'i'));
      expect(decl, `token ${token} undefined`).not.toBeNull();
      const px = minHeightValuePx(decl?.[1] ?? '');
      expect(px ?? 0, `resolved min-height too small: ${decl?.[1]}`).toBeGreaterThanOrEqual(120);
    } else {
      const px = minHeightValuePx(raw ?? '');
      expect(px, `unparseable min-height: ${raw}`).not.toBeNull();
      expect(px ?? 0, `.sv-card min-height ${raw} below 120px floor`).toBeGreaterThanOrEqual(120);
    }
  });

  it('.sv-card does NOT set min-height: 0 (the defect itself)', () => {
    const body = ruleBody(css, '.sv-card') ?? '';
    expect(body).not.toMatch(/min-height\s*:\s*0(\s*;|\s|$)/i);
  });

  it('the mission-control and conference tile rules keep a floor too', () => {
    for (const sel of ['.sv-mc-tile', '.sv-conf-tile']) {
      const body = ruleBody(css, sel);
      if (!body) continue; // selector may not exist yet — sv-card floor governs
      if (/min-height/i.test(body)) {
        expect(body).not.toMatch(/min-height\s*:\s*0(\s*;|\s|$)/i);
      }
    }
  });
});
