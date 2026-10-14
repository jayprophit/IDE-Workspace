import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * §15 TYPOGRAPHY TOKEN REGRESSION.
 *
 * M3 shipped a live defect: `--sv-font` was assigned a font SIZE token
 * instead of a font-family token, so the whole UI silently rendered in
 * Times New Roman. This test reads the real tokens.css and asserts every
 * `--sv-font*` custom property resolves to a font-FAMILY stack — never a
 * bare size/length. It must fail loudly if that ever regresses.
 */

const CSS_PATH = resolve(__dirname, '../tokens/tokens.css');

/** A family reference: a quoted/unquoted family name, or a var() chain. */
const FAMILY_HINT = /(sans|serif|mono|jakarta|fira|system-ui|ui-sans|ui-monospace|-apple|segoe|roboto|arial|helvetica|courier)/i;
/** A size token: bare length or size function — never valid as a family. */
const SIZE_ONLY = /^\s*(calc\s*\(\s*)?\d+(\.\d+)?\s*(px|rem|em|pt|%)\s*\)?\s*;?\s*$/i;

function declarations(css: string, prop: string): string[] {
  // match `--sv-font...: value;` across themes (last wins per block, but we
  // check EVERY occurrence — any single bad one is the defect)
  const re = new RegExp(`(--${prop}[a-z0-9-]*)\\s*:\\s*([^;]+);`, 'gi');
  const out: string[] = [];
  for (const m of css.matchAll(re)) out.push(m[2].trim());
  return out;
}

/** Font-FAMILY token names: --sv-font and --sv-font-mono carry families;
 *  --sv-font-size etc. are legitimately size tokens and are excluded. */
function familyTokenNames(css: string): string[] {
  const re = /(--sv-font[a-z0-9-]*)\s*:/gi;
  const names = new Set<string>();
  for (const m of css.matchAll(re)) {
    if (!/-size$/i.test(m[1])) names.add(m[1]);
  }
  return [...names];
}

function familyDeclarations(css: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const name of familyTokenNames(css)) {
    const re = new RegExp(`${name}\\s*:\\s*([^;]+);`, 'gi');
    for (const m of css.matchAll(re)) out.push([name, m[1].trim()]);
  }
  return out;
}

describe('typography token validity (§15)', () => {
  const css = readFileSync(CSS_PATH, 'utf8');

  it('has at least one --sv-font family declaration to check', () => {
    expect(familyDeclarations(css).length).toBeGreaterThan(0);
  });

  it('every --sv-font family declaration resolves to a font-family stack', () => {
    const decls = familyDeclarations(css);
    const bad = decls.filter(([, v]) => {
      // a var() chain is allowed ONLY if it eventually references a font var;
      // check the referenced token exists and is family-like
      if (/^var\(/.test(v)) {
        const inner = v.match(/var\((--[a-z0-9-]+)/i);
        if (!inner) return true;
        const ref = inner[1];
        const refDecls = declarations(css, ref.replace(/^--/, ''));
        if (refDecls.length === 0) return true; // dangling reference
        return !refDecls.some((d) => FAMILY_HINT.test(d) || /^var\(/.test(d));
      }
      return !FAMILY_HINT.test(v);
    });
    expect(bad, `non-family font declarations: ${JSON.stringify(bad)}`).toEqual([]);
  });

  it('no --sv-font family declaration is a bare size (the Times New Roman defect)', () => {
    const decls = familyDeclarations(css);
    const bad = decls.filter(([, v]) => SIZE_ONLY.test(v));
    expect(bad, `size-valued font tokens: ${JSON.stringify(bad)}`).toEqual([]);
  });

  it('the concrete family tokens resolve to a real family name', () => {
    // the design system names its fonts explicitly — guard both
    for (const token of ['sv-font-sans', 'sv-font-mono']) {
      const decls = declarations(css, token);
      if (decls.length === 0) continue; // token may not exist in every theme
      const hasFamily = decls.some((d) =>
        FAMILY_HINT.test(d) || /^var\(/.test(d));
      expect(hasFamily, `${token} never resolves to a family`).toBe(true);
    }
  });

  it('--sv-font-size (a legitimate size token) is never used as a family', () => {
    // guard the inverse mistake: size tokens stay sizes
    const sizeDecls = declarations(css, 'sv-font-size');
    for (const v of sizeDecls) {
      expect(FAMILY_HINT.test(v), `--sv-font-size must be a size, got ${v}`).toBe(false);
    }
  });
});
