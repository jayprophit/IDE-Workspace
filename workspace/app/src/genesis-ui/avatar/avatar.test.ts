import { describe, expect, it } from 'vitest';
import {
  ALL_AVATARS,
  MAIN_AVATARS,
  PRESENTATIONS,
  SPECIALIST_AVATARS,
  filterByArchetype,
  filterByPresentation,
  getAccent,
  getAvatarPreset,
  initialsOf,
} from '../avatars';
import { PlaceholderAvatarRenderer, getAvatarRenderer, isLiveRenderer, listAvatarRenderers, registerAvatarRenderer } from '../avatar/renderers';
import type { AvatarRenderer } from '../types';

/**
 * These tests exist to hold two promises:
 *   1. the avatar catalogue genuinely supports male, female and neutral
 *   2. nothing here claims to be a live avatar
 *
 * (2) is the one that matters most. A scaffold that quietly implies animation
 * or lip-sync it cannot do is worse than one that says nothing.
 */

describe('avatar catalogue', () => {
  it('offers female, male and neutral main avatars', () => {
    const byPresentation = (p: string) => MAIN_AVATARS.filter((a) => a.appearance.presentation === p);
    expect(byPresentation('female').length).toBeGreaterThanOrEqual(2);
    expect(byPresentation('male').length).toBeGreaterThanOrEqual(2);
    expect(byPresentation('neutral').length).toBeGreaterThanOrEqual(1);
  });

  it('offers a mixed-gender specialist roster', () => {
    const presentations = new Set(SPECIALIST_AVATARS.map((a) => a.appearance.presentation));
    expect(presentations).toContain('female');
    expect(presentations).toContain('male');
    expect(presentations).toContain('neutral');
  });

  it('keeps every preset unique and resolvable', () => {
    const ids = ALL_AVATARS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const a of ALL_AVATARS) {
      expect(getAvatarPreset(a.id)).toBe(a);
    }
  });

  it('gives every preset a description rather than leaving fields blank', () => {
    for (const a of ALL_AVATARS) {
      expect(a.appearance.hair.length).toBeGreaterThan(0);
      expect(a.appearance.wardrobe.length).toBeGreaterThan(0);
      expect(a.appearance.lighting.length).toBeGreaterThan(0);
      expect(a.capabilities.length).toBeGreaterThan(0);
      expect(initialsOf(a)).toMatch(/^[A-Z]{2}$/);
    }
  });

  it('filters by presentation and archetype without losing the others', () => {
    expect(filterByPresentation(ALL_AVATARS, 'all')).toHaveLength(ALL_AVATARS.length);
    expect(filterByPresentation(ALL_AVATARS, 'male').every((a) => a.appearance.presentation === 'male')).toBe(true);
    expect(filterByArchetype(ALL_AVATARS, 'main')).toHaveLength(MAIN_AVATARS.length);
    expect(filterByArchetype(ALL_AVATARS, 'specialist')).toHaveLength(SPECIALIST_AVATARS.length);
  });

  it('has an accent pair for every preset and a fallback for unknown ids', () => {
    for (const a of ALL_AVATARS) {
      const accent = getAccent(a.id);
      expect(accent.from).toMatch(/^#[0-9a-f]{6}$/i);
      expect(accent.to).toMatch(/^#[0-9a-f]{6}$/i);
    }
    const fallback = getAccent('does-not-exist');
    expect(fallback.from).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('declares all three presentations in the shared list', () => {
    expect(PRESENTATIONS).toEqual(['female', 'male', 'neutral']);
  });
});

describe('renderer seam', () => {
  it('reports the placeholder as NOT live', () => {
    expect(PlaceholderAvatarRenderer.isLive).toBe(false);
    expect(isLiveRenderer(PlaceholderAvatarRenderer.id)).toBe(false);
  });

  it('registers an alternative renderer without touching the catalogue', () => {
    const fake: AvatarRenderer = {
      id: 'test-live',
      isLive: true,
      render: () => null,
    };
    const before = getAvatarPreset('aether-01');
    registerAvatarRenderer(fake);

    expect(getAvatarRenderer('test-live')).toBe(fake);
    expect(isLiveRenderer('test-live')).toBe(true);
    expect(listAvatarRenderers().some((r) => r.id === 'test-live')).toBe(true);
    /* The point of the seam: adding a renderer must not disturb presets. */
    expect(getAvatarPreset('aether-01')).toBe(before);
  });

  it('falls back to the placeholder for an unknown renderer id', () => {
    expect(getAvatarRenderer('nope')).toBe(PlaceholderAvatarRenderer);
  });
});