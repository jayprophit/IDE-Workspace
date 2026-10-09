import type { AvatarInstance, AvatarPreset, TeamMember, TeamMode } from './types';
import { ALL_AVATARS, SPECIALIST_AVATARS, getAvatarPreset } from './avatars';

/**
 * Sample data.
 *
 * IMPORTANT: this is FIXTURE data for rendering the scaffold. It is not
 * connected to Agent Bridge and it is not a live roster. Every surface that
 * uses it labels itself accordingly, and the shell exposes `isFixture` so a
 * consumer can tell a demo roster from a real one.
 *
 * Progress and status values here are illustrative. The shell never advances
 * them over time.
 */

export const PRESET_MAP: Record<string, AvatarPreset> = Object.fromEntries(ALL_AVATARS.map((a) => [a.id, a]));

export const DEFAULT_MAIN_AVATAR_ID = 'aether-01';

export function defaultMainInstance(): AvatarInstance {
  return { presetId: DEFAULT_MAIN_AVATAR_ID, presence: 'idle' };
}

export const FIXTURE_TEAM: TeamMember[] = [
  {
    id: 'w-atlas',
    name: 'Atlas',
    role: 'Project lead',
    avatarId: 'atlas',
    status: 'active',
    currentTask: 'Coordinating the redesign milestones',
    recentActivity: 'Atlas → Nova: holding the review until Thursday',
    progress: 0.62,
    queuePosition: 0,
    capabilities: ['lead', 'planning', 'coordination'],
  },
  {
    id: 'w-nova',
    name: 'Nova',
    role: 'Strategy',
    avatarId: 'nova',
    status: 'reviewing',
    currentTask: 'Drafting the positioning brief',
    recentActivity: 'Nova → Kai: brief looks tight, one open question',
    progress: 0.41,
    queuePosition: 1,
    capabilities: ['strategy', 'planning', 'research'],
  },
  {
    id: 'w-dev',
    name: 'Dev',
    role: 'Development',
    avatarId: 'dev',
    status: 'active',
    currentTask: 'Implementing the token pipeline',
    recentActivity: 'Dev → Atlas: build is green on the default branch',
    progress: 0.78,
    queuePosition: 2,
    capabilities: ['engineering', 'build', 'debug'],
  },
  {
    id: 'w-lyra',
    name: 'Lyra',
    role: 'Design',
    avatarId: 'lyra',
    status: 'idle',
    currentTask: '',
    recentActivity: 'Lyra is waiting on a brief',
    capabilities: ['design', 'creative', 'review'],
  },
  {
    id: 'w-orion',
    name: 'Orion',
    role: 'Data',
    avatarId: 'orion',
    status: 'in-call',
    currentTask: 'Validating the usage figures',
    recentActivity: 'Orion: figures reconcile against the source',
    progress: 0.3,
    capabilities: ['data', 'analysis', 'reporting'],
  },
  {
    id: 'w-sage',
    name: 'Sage',
    role: 'Research',
    avatarId: 'sage',
    status: 'thinking',
    currentTask: 'Cross-checking the market scan',
    recentActivity: 'Sage → Nova: two sources disagree on the date',
    capabilities: ['research', 'analysis', 'writing'],
  },
  {
    id: 'w-echo',
    name: 'Echo',
    role: 'Documentation',
    avatarId: 'echo',
    status: 'idle',
    currentTask: '',
    recentActivity: 'Echo is idle',
    capabilities: ['documentation', 'writing', 'review'],
  },
];

export const DEFAULT_TEAM_MODE: TeamMode = {
  silentMode: false,
  observeMode: false,
  autoQueue: true,
  raiseHand: false,
};

export const SPECIALIST_PRESETS = SPECIALIST_AVATARS;

/** True while the shell is showing fixture data rather than a real roster. */
export const IS_FIXTURE = true;

/** Guards against a preset id that is not in the catalogue. */
export function resolvePreset(id: string): AvatarPreset | undefined {
  return getAvatarPreset(id) ?? PRESET_MAP[id];
}