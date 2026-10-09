import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT, DEFAULT_THEME, LAYOUT_MODES, THEMES, getLayoutMode, getTheme, isLayoutModeId, isThemeId } from './registry';
import type { LayoutModeId, ThemeId } from './types';

/**
 * Registry tests.
 *
 * The registry is the contract that makes themes and layout modes
 * independently reversible, so these check membership, defaults and
 * validation rather than any single theme's colours.
 */

const EXPECTED_THEMES: ThemeId[] = ['abyss', 'aurora', 'ember', 'graphite', 'frost'];
const EXPECTED_LAYOUTS: LayoutModeId[] = ['simple', 'standard', 'dense', 'focus'];

describe('theme registry', () => {
  it('ships exactly the five required themes', () => {
    expect(THEMES.map((t) => t.id)).toEqual(EXPECTED_THEMES);
  });

  it('defaults to dark blue (abyss)', () => {
    expect(DEFAULT_THEME).toBe('abyss');
    expect(getTheme(DEFAULT_THEME).scheme).toBe('dark');
  });

  it('gives every theme a label, note and scheme', () => {
    for (const t of THEMES) {
      expect(t.label.length).toBeGreaterThan(0);
      expect(t.note.length).toBeGreaterThan(0);
      expect(['dark', 'light']).toContain(t.scheme);
    }
  });

  it('has exactly one light theme, so dark-mode assumptions stay testable', () => {
    expect(THEMES.filter((t) => t.scheme === 'light').map((t) => t.id)).toEqual(['frost']);
  });

  it('validates ids and rejects unknown values', () => {
    for (const id of EXPECTED_THEMES) expect(isThemeId(id)).toBe(true);
    expect(isThemeId('neon')).toBe(false);
    expect(isThemeId(null)).toBe(false);
    expect(isThemeId(7)).toBe(false);
  });
});

describe('layout registry', () => {
  it('ships the four required modes', () => {
    expect(LAYOUT_MODES.map((m) => m.id)).toEqual(EXPECTED_LAYOUTS);
  });

  it('defaults to standard density', () => {
    expect(DEFAULT_LAYOUT).toBe('standard');
  });

  it('marks only focus mode as immersive', () => {
    const immersive = LAYOUT_MODES.filter((m) => m.immersive).map((m) => m.id);
    expect(immersive).toEqual(['focus']);
  });

  it('orders modes from simplest to densest, with focus last', () => {
    /* Order is presentation order in Settings, so it should read
     * simple -> standard -> dense -> focus. */
    expect(LAYOUT_MODES.map((m) => m.id)).toEqual(['simple', 'standard', 'dense', 'focus']);
  });

  it('validates ids and rejects unknown values', () => {
    for (const id of EXPECTED_LAYOUTS) expect(isLayoutModeId(id)).toBe(true);
    expect(isLayoutModeId('compact')).toBe(false);
    expect(isLayoutModeId(undefined)).toBe(false);
  });

  it('gives every mode a label and note', () => {
    for (const m of LAYOUT_MODES) {
      expect(m.label.length).toBeGreaterThan(0);
      expect(m.note.length).toBeGreaterThan(0);
    }
  });
});