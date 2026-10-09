import type { LayoutModeDefinition, LayoutModeId, ThemeDefinition, ThemeId, ViewDefinition, ViewId } from './types';

/**
 * Theme registry.
 *
 * Order is presentation order in Settings. The first entry is the default so a
 * missing or corrupt preference still resolves to a working theme.
 */
export const THEMES: ThemeDefinition[] = [
  { id: 'abyss', label: 'Abyss', note: 'Default dark blue. Glass panels over near-black.', scheme: 'dark' },
  { id: 'aurora', label: 'Aurora', note: 'Purple / violet, higher saturation.', scheme: 'dark' },
  { id: 'ember', label: 'Ember', note: 'Amber / warm, low-glare dark.', scheme: 'dark' },
  { id: 'graphite', label: 'Graphite', note: 'Neutral grey. Colour reserved for state.', scheme: 'dark' },
  { id: 'frost', label: 'Frost', note: 'Light, frosted glass, high legibility.', scheme: 'light' },
];

export const DEFAULT_THEME: ThemeId = 'abyss';

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && THEMES.some((t) => t.id === value);
}

export function getTheme(id: ThemeId): ThemeDefinition {
  const found = THEMES.find((t) => t.id === id);
  /* istanbul ignore next - unreachable while DEFAULT_THEME stays in THEMES */
  if (!found) throw new Error(`unknown theme: ${id}`);
  return found;
}

/**
 * Layout density registry.
 *
 * `focus` is separated out because it is not merely denser or looser: it
 * removes the chrome entirely and hands the viewport to one avatar. The shell
 * reads `immersive` to decide whether to render the rail and header.
 */
export const LAYOUT_MODES: LayoutModeDefinition[] = [
  { id: 'simple', label: 'Simple', note: 'Larger type and touch targets. Fewest controls.', immersive: false },
  { id: 'standard', label: 'Standard', note: 'Default desktop density, 13px base.', immersive: false },
  { id: 'dense', label: 'Dense', note: 'Power-user density. Maximum information on screen.', immersive: false },
  { id: 'focus', label: 'Focus worker', note: 'One avatar full screen. All chrome removed.', immersive: true },
];

export const DEFAULT_LAYOUT: LayoutModeId = 'standard';

export function isLayoutModeId(value: unknown): value is LayoutModeId {
  return typeof value === 'string' && LAYOUT_MODES.some((m) => m.id === value);
}

export function getLayoutMode(id: LayoutModeId): LayoutModeDefinition {
  const found = LAYOUT_MODES.find((m) => m.id === id);
  /* istanbul ignore next - unreachable while DEFAULT_LAYOUT stays in LAYOUT_MODES */
  if (!found) throw new Error(`unknown layout mode: ${id}`);
  return found;
}

export const VIEWS: ViewDefinition[] = [
  { id: 'home', label: 'Home', glyph: '⌂' },
  { id: 'chat', label: 'Chat', glyph: '◉' },
  { id: 'work', label: 'Work', glyph: '◧' },
  { id: 'team', label: 'Teams', glyph: '◍' },
  { id: 'calls', label: 'Calls', glyph: '☎' },
  { id: 'settings', label: 'Settings', glyph: '⚙' },
];

export const DEFAULT_VIEW: ViewId = 'home';

/** `worker` is reachable by drill-down but is not a primary nav item. */
export const WORKER_VIEW: ViewDefinition = { id: 'worker', label: 'Worker', glyph: '◐', requiresWorker: true };

export function isViewId(value: unknown): value is ViewId {
  return typeof value === 'string' && [...VIEWS, WORKER_VIEW].some((v) => v.id === value);
}

export function getView(id: ViewId): ViewDefinition {
  const found = [...VIEWS, WORKER_VIEW].find((v) => v.id === id);
  /* istanbul ignore next - unreachable for ids produced by isViewId */
  if (!found) throw new Error(`unknown view: ${id}`);
  return found;
}