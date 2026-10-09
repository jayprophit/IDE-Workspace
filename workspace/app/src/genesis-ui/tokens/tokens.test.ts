import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Token contract tests.
 *
 * These read the CSS as text rather than importing it, because the property
 * under test is cross-file consistency. A missing token does not fail to
 * compile - it renders as a transparent or inherited value in one theme only,
 * which is exactly the kind of bug that ships.
 *
 * The rule being defended: a theme OVERRIDES semantic tokens and inherits the
 * rest from `:root`. So a theme block is not expected to redeclare everything,
 * but it must always define the core role set, and it must never define a
 * token name the default layer does not have.
 */

const TOKENS = join(__dirname, 'tokens.css');
const COMPONENTS = join(__dirname, 'components.css');

const read = (path: string): string => readFileSync(path, 'utf8');

/** Extract `--token-name` declarations from the block starting at `selector`. */
function declarationsIn(css: string, selector: string): Set<string> {
  const idx = css.indexOf(selector);
  if (idx === -1) return new Set();
  const open = css.indexOf('{', idx);
  const close = css.indexOf('}', open);
  if (open === -1 || close === -1) return new Set();
  const body = css.slice(open, close);
  const out = new Set<string>();
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:/g)) out.add(m[1]);
  return out;
}

const THEME_IDS = ['abyss', 'aurora', 'ember', 'graphite', 'frost'];
const THEME_SELECTORS = THEME_IDS.map((id) => `[data-genesis-theme='${id}']`);
const LAYOUT_IDS = ['simple', 'standard', 'dense', 'focus'];

/** Tokens every theme must define itself, because no theme may inherit them
 * from another theme and nothing downstream can work without them. */
const CORE_ROLES = [
  '--surface-canvas',
  '--surface-raised',
  '--glass-bg',
  '--text-primary',
  '--text-secondary',
  '--text-muted',
  '--border-default',
  '--border-accent',
  '--accent-base',
  '--accent-strong',
  '--accent-text',
  '--state-success',
  '--state-warning',
  '--state-danger',
  '--canvas-glow',
];

describe('theme tokens', () => {
  const css = read(TOKENS);

  it('defines a block for all five themes', () => {
    for (const sel of THEME_SELECTORS) {
      expect(css, `missing theme block ${sel}`).toContain(sel);
    }
  });

  it('defines --text-on-scrim in every theme (C3 contrast fix)', () => {
    /* The placeholder label reads on a scrim, not on the page canvas, so it
     * needs its own token. If a theme lacks it the label silently falls back
     * to --text-muted and drops below AA. */
    for (const [i, sel] of THEME_SELECTORS.entries()) {
      expect(declarationsIn(css, sel).has('--text-on-scrim'), `theme ${THEME_IDS[i]} is missing --text-on-scrim`).toBe(true);
    }
  });

  it('gives every theme the full set of core roles', () => {
    for (const [i, sel] of THEME_SELECTORS.entries()) {
      const declared = declarationsIn(css, sel);
      for (const role of CORE_ROLES) {
        expect(declared.has(role), `theme ${THEME_IDS[i]} is missing ${role}`).toBe(true);
      }
    }
  });

  it('never lets a theme invent a token the default layer lacks', () => {
    /* The default semantic layer is the `:root, [data-genesis-theme='abyss']`
     * block - note this is NOT the first `:root` in the file, which is the
     * primitive scale. */
    const marker = ":root,\n[data-genesis-theme='abyss'] {";
    const rootOpen = css.indexOf(marker);
    expect(rootOpen, 'default semantic layer not found').toBeGreaterThan(-1);
    const rootEnd = css.indexOf('}', rootOpen);
    const defaults = new Set<string>();
    for (const m of css.slice(rootOpen, rootEnd).matchAll(/(--[a-z0-9-]+)\s*:/g)) defaults.add(m[1]);
    expect(defaults.size).toBeGreaterThan(20);

    for (const [i, sel] of THEME_SELECTORS.entries()) {
      for (const token of declarationsIn(css, sel)) {
        if (token.startsWith('--p-')) continue; /* primitives are layer 1 */
        expect(defaults.has(token), `theme ${THEME_IDS[i]} defines unknown token ${token}`).toBe(true);
      }
    }
  });

  it('is dark by default and light only for frost', () => {
    const abyss = css.slice(css.indexOf(THEME_SELECTORS[0]));
    expect(abyss.slice(0, 200)).toContain("color-scheme: dark");
    for (const id of ['aurora', 'ember', 'graphite']) {
      const block = declarationsIn(css, `[data-genesis-theme='${id}']`);
      expect(block.size).toBeGreaterThan(0);
      const start = css.indexOf(`[data-genesis-theme='${id}']`);
      expect(css.slice(start, css.indexOf('}', start))).toContain('color-scheme: dark');
    }
    const frostStart = css.indexOf("[data-genesis-theme='frost']");
    expect(css.slice(frostStart, css.indexOf('}', frostStart))).toContain('color-scheme: light');
  });
});

describe('primitive tokens', () => {
  const css = read(TOKENS);

  it('defines every required token category', () => {
    const required: [string, RegExp][] = [
      ['colour ramps', /--p-blue-500\s*:/],
      ['spacing', /--space-4\s*:/],
      ['radii', /--radius-lg\s*:/],
      ['border widths', /--border-width-hair\s*:/],
      ['panel surfaces', /--glass-bg\s*:/],
      ['shadows', /--shadow-panel\s*:/],
      ['font stacks', /--font-mono\s*:/],
      ['type scale', /--text-display\s*:/],
      ['weights', /--weight-bold\s*:/],
      ['leading', /--leading-normal\s*:/],
      ['tracking', /--tracking-wide\s*:/],
      ['motion', /--duration-fast\s*:/],
      ['z-index ladder', /--z-modal\s*:/],
      ['avatar geometry', /--avatar-size-3xl\s*:/],
      ['focus ring', /--focus-ring\s*:/],
    ];
    for (const [label, re] of required) {
      expect(css, `no tokens found for category: ${label}`).toMatch(re);
    }
  });

  it('declares fonts as stacks without bundling a webfont', () => {
    /* Placeholder typography: stacks only. No @font-face, no remote font. */
    expect(css).not.toMatch(/@font-face/);
    expect(css).not.toMatch(/https?:\/\/fonts\./);
    expect(css).not.toMatch(/@import\s+url/);
  });
});

describe('layout density tokens', () => {
  const css = read(TOKENS);

  it('defines a block for all four layout modes', () => {
    for (const id of LAYOUT_IDS) {
      expect(css, `missing density block for ${id}`).toContain(`[data-genesis-layout='${id}']`);
    }
  });

  it('gives every mode the same density token set', () => {
    const sets = LAYOUT_IDS.map((id) => declarationsIn(css, `[data-genesis-layout='${id}']`));
    const reference = sets[0];
    expect(reference.size).toBeGreaterThan(10);
    for (const [i, set] of sets.entries()) {
      expect(set.size, `layout ${LAYOUT_IDS[i]} disagrees on density token count`).toBe(reference.size);
      for (const token of reference) {
        expect(set.has(token), `layout ${LAYOUT_IDS[i]} is missing ${token}`).toBe(true);
      }
    }
  });

  it('does not let a density block redefine a colour token', () => {
    /* Density must stay orthogonal to theme. A colour here would couple the
     * two switches that are supposed to be independently reversible. */
    for (const id of LAYOUT_IDS) {
      for (const token of declarationsIn(css, `[data-genesis-layout='${id}']`)) {
        expect(token.startsWith('--p-'), `${id} defines a primitive`).toBe(false);
        expect(/--(surface|text|border|accent|state|glass|shadow)-/.test(token), `${id} redefines ${token}`).toBe(false);
      }
    }
  });
});

describe('component CSS discipline', () => {
  const css = read(COMPONENTS);

  /**
   * The theme-swatch previews are the one legitimate exception: each swatch
   * must show a DIFFERENT theme than the active one, so they cannot read
   * semantic tokens at all. They are stripped before the check.
   */
  const withoutSwatches = css.replace(/\.gx-theme-card__preview\[data-theme='[^']+'\][^}]*}/g, '');

  it('hard-codes no colour outside the swatch previews', () => {
    const hexes: string[] = (withoutSwatches.match(/#[0-9a-f]{3,8}\b/gi) ?? []).map((h: string) => h.toLowerCase());
    const offenders = [...new Set(hexes)].filter((h: string) => !['#fff', '#ffffff'].includes(h));
    expect(offenders, `component CSS contains raw colours: ${offenders.join(', ')}`).toEqual([]);
  });

  it('hard-codes no rgb()/hsl() colour either', () => {
    /* The same discipline, different syntax. rgb() literals in a component
     * would silently ignore the active theme. */
    expect(withoutSwatches, 'component CSS contains rgb() literals').not.toMatch(/rgba?\(/i);
  });

  it('gives every theme swatch a preview', () => {
    for (const id of THEME_IDS) {
      expect(css, `no swatch preview for ${id}`).toContain(`.gx-theme-card__preview[data-theme='${id}']`);
    }
  });
});

describe('motion is opt-out', () => {
  const css = read(TOKENS);

  it('stops all decorative animation under prefers-reduced-motion', () => {
    expect(css).toContain('prefers-reduced-motion: reduce');
    const block = css.slice(css.indexOf('prefers-reduced-motion: reduce'));
    expect(block).toContain('animation-iteration-count: 1');
    expect(block).toContain('transition-duration');
  });
});