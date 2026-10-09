import type { AvatarPreset, AvatarPresentation } from './types';

/**
 * Avatar preset catalogue.
 *
 * Truth rule for this file: these are DESCRIPTIONS, not portraits. There is no
 * photographic or rendered art here. Each preset carries a declarative
 * appearance that a renderer maps to a medium. The shipped renderer draws a
 * labelled placeholder from these fields.
 *
 * Design intent: one visual family across every avatar. Presentation
 * (female / male / neutral) is expressed through the descriptive fields and
 * the accent pair, never by leaving the family. That is what lets a mixed-gender
 * roster still read as one ecosystem, which was the explicit requirement.
 */

const AURA_COOL = { from: '#2563eb', to: '#06b6d4' };
const AURA_VIOLET = { from: '#7c3aed', to: '#a78bfa' };
const AURA_EMBER = { from: '#d97706', to: '#f59e0b' };
const AURA_JADE = { from: '#059669', to: '#22d3ee' };
const AURA_ROSE = { from: '#e11d48', to: '#fb7185' };
const AURA_SLATE = { from: '#475569', to: '#94a3b8' };
const AURA_INDIGO = { from: '#4338ca', to: '#818cf8' };
const AURA_MOSS = { from: '#4d7c0f', to: '#84cc16' };

/* ---------------------------------------------------------------------------
 * Main avatars - the primary companion identity.
 * Two female, two male, one neutral, per the brief.
 * ------------------------------------------------------------------------ */

export const MAIN_AVATARS: AvatarPreset[] = [
  {
    id: 'aether-01',
    name: 'Aether',
    role: 'Primary companion',
    archetype: 'main',
    appearance: {
      presentation: 'female',
      hair: 'long straight, dark with a cool cast, centre parted',
      wardrobe: 'high-collar technical jacket, graphite with cyan trim',
      lighting: 'soft key from front-left, cool rim from behind',
      intensity: 0.55,
    },
    tagline: 'Calm, precise, always present',
    capabilities: ['chat', 'work', 'calls', 'planning'],
  },
  {
    id: 'aether-02',
    name: 'Vela',
    role: 'Primary companion',
    archetype: 'main',
    appearance: {
      presentation: 'female',
      hair: 'short cropped, violet, textured',
      wardrobe: 'open overshirt over dark base layer',
      lighting: 'bright frontal, high key',
      intensity: 0.7,
    },
    tagline: 'Vivid, futuristic, quick to explore',
    capabilities: ['chat', 'work', 'creative', 'calls'],
  },
  {
    id: 'aether-03',
    name: 'Corvus',
    role: 'Primary companion',
    archetype: 'main',
    appearance: {
      presentation: 'male',
      hair: 'swept-back undercut, very dark',
      wardrobe: 'clean crewneck, slate, minimal detailing',
      lighting: 'even studio key, neutral background',
      intensity: 0.4,
    },
    tagline: 'Calm, professional, measured',
    capabilities: ['chat', 'work', 'calls', 'review'],
  },
  {
    id: 'aether-04',
    name: 'Bastion',
    role: 'Primary companion',
    archetype: 'main',
    appearance: {
      presentation: 'male',
      hair: 'close-cropped, dark, squared',
      wardrobe: 'structured jacket, charcoal, heavy collar',
      lighting: 'low key, strong edge light',
      intensity: 0.8,
    },
    tagline: 'Direct, technical, built for load',
    capabilities: ['chat', 'work', 'build', 'debug'],
  },
  {
    id: 'aether-05',
    name: 'Meridian',
    role: 'Primary companion',
    archetype: 'main',
    appearance: {
      presentation: 'neutral',
      hair: 'shoulder length, tucked, warm brown',
      wardrobe: 'soft structured knit, bone, no visible tech trim',
      lighting: 'diffuse, warm, low contrast',
      intensity: 0.45,
    },
    tagline: 'Neutral register, steady tone',
    capabilities: ['chat', 'work', 'planning', 'calls'],
  },
];

/* ---------------------------------------------------------------------------
 * Specialist avatars - the team roster.
 * Mixed presentation, varied roles, shared visual family.
 * ------------------------------------------------------------------------ */

export const SPECIALIST_AVATARS: AvatarPreset[] = [
  {
    id: 'nova',
    name: 'Nova',
    role: 'Strategy',
    archetype: 'specialist',
    appearance: {
      presentation: 'female',
      hair: 'long dark, loosely tied back',
      wardrobe: 'structured blazer, deep navy',
      lighting: 'soft key, warm bounce',
      intensity: 0.5,
    },
    tagline: 'Frames the problem before anyone builds',
    capabilities: ['strategy', 'planning', 'research'],
  },
  {
    id: 'atlas',
    name: 'Atlas',
    role: 'Project lead',
    archetype: 'specialist',
    appearance: {
      presentation: 'male',
      hair: 'short, dark, neat',
      wardrobe: 'open overshirt, charcoal',
      lighting: 'even key, slight rim',
      intensity: 0.45,
    },
    tagline: 'Holds the schedule and the thread',
    capabilities: ['lead', 'planning', 'coordination'],
  },
  {
    id: 'lyra',
    name: 'Lyra',
    role: 'Design',
    archetype: 'specialist',
    appearance: {
      presentation: 'female',
      hair: 'wavy, copper, shoulder length',
      wardrobe: 'relaxed knit, rust accent',
      lighting: 'warm key, low contrast',
      intensity: 0.6,
    },
    tagline: 'Makes it look considered',
    capabilities: ['design', 'creative', 'review'],
  },
  {
    id: 'orion',
    name: 'Orion',
    role: 'Data',
    archetype: 'specialist',
    appearance: {
      presentation: 'male',
      hair: 'short, dark, receding slightly',
      wardrobe: 'plain shirt, slate, sleeves rolled',
      lighting: 'cool key, clean background',
      intensity: 0.35,
    },
    tagline: 'Finds the number that matters',
    capabilities: ['data', 'analysis', 'reporting'],
  },
  {
    id: 'sage',
    name: 'Sage',
    role: 'Research',
    archetype: 'specialist',
    appearance: {
      presentation: 'female',
      hair: 'short silver-grey, textured',
      wardrobe: 'light cardigan, bone',
      lighting: 'bright even key',
      intensity: 0.4,
    },
    tagline: 'Reads widely, reports briefly',
    capabilities: ['research', 'analysis', 'writing'],
  },
  {
    id: 'dev',
    name: 'Dev',
    role: 'Development',
    archetype: 'specialist',
    appearance: {
      presentation: 'male',
      hair: 'mid-length, tucked back',
      wardrobe: 'hoodie over tee, muted teal',
      lighting: 'flat key, screen-lit',
      intensity: 0.5,
    },
    tagline: 'Ships the change, not the description',
    capabilities: ['engineering', 'build', 'debug'],
  },
  {
    id: 'aria',
    name: 'Aria',
    role: 'Research',
    archetype: 'specialist',
    appearance: {
      presentation: 'female',
      hair: 'long, dark, straight',
      wardrobe: 'blazer, deep plum',
      lighting: 'soft key, cool rim',
      intensity: 0.55,
    },
    tagline: 'Cross-checks before anyone commits',
    capabilities: ['research', 'review', 'compliance'],
  },
  {
    id: 'kai',
    name: 'Kai',
    role: 'Operations',
    archetype: 'specialist',
    appearance: {
      presentation: 'male',
      hair: 'short, dark, textured',
      wardrobe: 'utility jacket, olive',
      lighting: 'neutral key, hard edge',
      intensity: 0.65,
    },
    tagline: 'Keeps the pipeline moving',
    capabilities: ['operations', 'automation', 'deploy'],
  },
  {
    id: 'echo',
    name: 'Echo',
    role: 'Documentation',
    archetype: 'specialist',
    appearance: {
      presentation: 'neutral',
      hair: 'understated crop, dark',
      wardrobe: 'high-neck, monochrome',
      lighting: 'flat, even, neutral',
      intensity: 0.3,
    },
    tagline: 'Writes it down so it survives',
    capabilities: ['documentation', 'writing', 'review'],
  },
  {
    id: 'zuri',
    name: 'Zuri',
    role: 'Marketing',
    archetype: 'specialist',
    appearance: {
      presentation: 'female',
      hair: 'coiled natural, dark, full',
      wardrobe: 'bold jacket, magenta accent',
      lighting: 'bright key, saturated backdrop',
      intensity: 0.8,
    },
    tagline: 'Says it in a way people repeat',
    capabilities: ['marketing', 'creative', 'content'],
  },
];

/**
 * Accent pair per avatar.
 *
 * Kept beside the presets rather than inside them because it is a rendering
 * concern, not part of the identity. Every pair is drawn from the token ramps,
 * so accent harmonisation with the active theme stays automatic.
 */
const ACCENTS: Record<string, { from: string; to: string }> = {
  'aether-01': AURA_COOL,
  'aether-02': AURA_VIOLET,
  'aether-03': AURA_SLATE,
  'aether-04': AURA_EMBER,
  'aether-05': AURA_ROSE,
  nova: AURA_VIOLET,
  atlas: AURA_INDIGO,
  lyra: AURA_ROSE,
  orion: AURA_JADE,
  sage: AURA_SLATE,
  dev: AURA_COOL,
  aria: AURA_INDIGO,
  kai: AURA_MOSS,
  echo: AURA_SLATE,
  zuri: AURA_ROSE,
};

const FALLBACK_ACCENT = AURA_COOL;

export const ALL_AVATARS: AvatarPreset[] = [...MAIN_AVATARS, ...SPECIALIST_AVATARS];

const BY_ID = new Map(ALL_AVATARS.map((a) => [a.id, a]));

export function getAvatarPreset(id: string): AvatarPreset | undefined {
  return BY_ID.get(id);
}

export function getMainAvatar(id: string): AvatarPreset | undefined {
  return MAIN_AVATARS.find((a) => a.id === id);
}

export function getAccent(id: string): { from: string; to: string } {
  return ACCENTS[id] ?? FALLBACK_ACCENT;
}

/** Display initials, used by the placeholder renderer and by chips. */
export function initialsOf(preset: AvatarPreset): string {
  return preset.name.slice(0, 2).toUpperCase();
}

export const PRESENTATIONS: AvatarPresentation[] = ['female', 'male', 'neutral'];

export const PRESENTATION_LABEL: Record<AvatarPresentation, string> = {
  female: 'Female',
  male: 'Male',
  neutral: 'Neutral',
};

/** Filter helper for the chooser. All three presentations are first-class. */
export function filterByPresentation(presets: AvatarPreset[], presentation: AvatarPresentation | 'all'): AvatarPreset[] {
  if (presentation === 'all') return presets;
  return presets.filter((p) => p.appearance.presentation === presentation);
}

export function filterByArchetype(presets: AvatarPreset[], archetype: 'all' | 'main' | 'specialist'): AvatarPreset[] {
  if (archetype === 'all') return presets;
  return presets.filter((p) => p.archetype === archetype);
}