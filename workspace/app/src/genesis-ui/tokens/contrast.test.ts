import { describe, expect, it } from 'vitest';

/**
 * WCAG 2.x contrast checks, computed from the actual token values.
 *
 * Why compute rather than eyeball: the C3 correction was a real miss. The
 * `placeholder` label inherited `--text-muted`, which is tuned for the page
 * canvas, but it renders on a translucent scrim composited over the avatar
 * interior. In frost that measured 2.14:1 - legible enough to pass a visual
 * review and still fail AA. A test that recomputes the composite is the only
 * thing that catches that class of error.
 */

/* --- WCAG 2.1 relative luminance and contrast ---------------------------- */

function srgb(channel8: number): number {
  const c = channel8 / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function luminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
}

export function contrastRatio(fg: string, bg: string): number {
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

function rgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

function toHex(c: [number, number, number]): string {
  return `#${c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;
}

/** Composite a translucent foreground over an opaque background (alpha blend). */
export function composite(bgHex: string, fgHex: string, alpha: number): string {
  const bg = rgb(bgHex);
  const fg = rgb(fgHex);
  return toHex([
    fg[0] * alpha + bg[0] * (1 - alpha),
    fg[1] * alpha + bg[1] * (1 - alpha),
    fg[2] * alpha + bg[2] * (1 - alpha),
  ]);
}

/* --- The values under test ---------------------------------------------- */

/**
 * Per-theme avatar placeholder label.
 *
 * `interior` is the avatar's background (`--surface-sunken`), and the label's
 * scrim (`--surface-scrim`) composites over it at the theme's alpha. These are
 * transcribed from tokens.css and kept next to the assertions so a token
 * change that breaks contrast fails here rather than in a browser.
 */
const PLACEHOLDER_LABEL: { theme: string; interior: string; scrim: string; scrimAlpha: number; label: string }[] = [
  { theme: 'abyss', interior: '#020617', scrim: '#020617', scrimAlpha: 0.72, label: '#a8b6cf' },
  { theme: 'aurora', interior: '#080310', scrim: '#080310', scrimAlpha: 0.75, label: '#bda9e0' },
  { theme: 'ember', interior: '#0c0703', scrim: '#0c0703', scrimAlpha: 0.74, label: '#d6bd97' },
  { theme: 'graphite', interior: '#0a0b0d', scrim: '#0a0b0d', scrimAlpha: 0.76, label: '#a9adb8' },
  { theme: 'frost', interior: '#e2e8f0', scrim: '#94a3b8', scrimAlpha: 0.4, label: '#334155' },
];

/** Body text pair per theme: primary on the base surface. */
const BODY_TEXT: { theme: string; bg: string; primary: string; secondary: string }[] = [
  { theme: 'abyss', bg: '#0b1120', primary: '#e8eefb', secondary: '#a8b6cf' },
  { theme: 'aurora', bg: '#150a24', primary: '#f1e9ff', secondary: '#bda9e0' },
  { theme: 'ember', bg: '#1c1208', primary: '#fdf2e0', secondary: '#d6bd97' },
  { theme: 'graphite', bg: '#17181c', primary: '#eceef2', secondary: '#a9adb8' },
  { theme: 'frost', bg: '#f7f9fc', primary: '#0f172a', secondary: '#475569' },
];

describe('WCAG contrast', () => {
  it('computes known ratios correctly (sanity check on the maths)', () => {
    /* Black on white is the 21:1 maximum. */
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
    /* Identical colours have no contrast. */
    expect(contrastRatio('#123456', '#123456')).toBeCloseTo(1, 5);
  });

  it('composites a translucent scrim correctly', () => {
    /* A 50% grey scrim over white lands mid-grey. */
    expect(composite('#ffffff', '#000000', 0.5)).toBe('#808080');
    /* Fully opaque returns the foreground. */
    expect(composite('#ffffff', '#112233', 1)).toBe('#112233');
  });

  describe('C3 - avatar placeholder label', () => {
    it('clears WCAG AA (4.5:1) in every theme', () => {
      const failures: string[] = [];
      for (const t of PLACEHOLDER_LABEL) {
        const effectiveBg = composite(t.interior, t.scrim, t.scrimAlpha);
        const ratio = contrastRatio(t.label, effectiveBg);
        if (ratio < 4.5) failures.push(`${t.theme}: ${ratio.toFixed(2)}:1 on ${effectiveBg}`);
      }
      expect(failures, `placeholder label below AA:\n${failures.join('\n')}`).toEqual([]);
    });

    it('specifically fixes frost, which measured 2.14:1 before C3', () => {
      const frost = PLACEHOLDER_LABEL.find((t) => t.theme === 'frost')!;
      const bg = composite(frost.interior, frost.scrim, frost.scrimAlpha);
      const ratio = contrastRatio(frost.label, bg);

      expect(ratio).toBeGreaterThanOrEqual(4.5);
      /* Guard against a regression back to the old --text-muted value. */
      expect(frost.label).not.toBe('#7c8ba1');
      /* And confirm the old value genuinely failed, so this test is not
       * vacuously passing on an easy background. */
      expect(contrastRatio('#7c8ba1', bg)).toBeLessThan(4.5);
    });

    it('reports the actual ratios, so the margin is visible in test output', () => {
      const report = PLACEHOLDER_LABEL.map((t) => {
        const bg = composite(t.interior, t.scrim, t.scrimAlpha);
        return `${t.theme}=${contrastRatio(t.label, bg).toFixed(2)}:1`;
      });
      expect(report).toHaveLength(5);
      /* Every value must parse as a plausible ratio. */
      for (const r of report) {
        const value = Number.parseFloat(r.split('=')[1]);
        expect(value).toBeGreaterThan(1);
        expect(value).toBeLessThanOrEqual(21);
      }
    });
  });

  describe('body text', () => {
    it('primary text clears AA on the base surface in every theme', () => {
      for (const t of BODY_TEXT) {
        expect(contrastRatio(t.primary, t.bg), `${t.theme} primary text`).toBeGreaterThanOrEqual(4.5);
      }
    });

    it('secondary text clears AA on the base surface in every theme', () => {
      for (const t of BODY_TEXT) {
        expect(contrastRatio(t.secondary, t.bg), `${t.theme} secondary text`).toBeGreaterThanOrEqual(4.5);
      }
    });
  });
});