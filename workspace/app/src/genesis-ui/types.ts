/**
 * Genesis / Aetherius domain types.
 *
 * These are the contracts the UI is built against. They are deliberately
 * renderer-agnostic: nothing here knows whether an avatar is drawn as SVG, a
 * video element, a canvas, or a 3D scene. That separation is what lets the
 * placeholder renderer be swapped for a real one without touching views.
 */

import type { ReactNode } from 'react';

/* ---------------------------------------------------------------------------
 * Theme + layout
 * ------------------------------------------------------------------------ */

export type ThemeId = 'abyss' | 'aurora' | 'ember' | 'graphite' | 'frost';

export interface ThemeDefinition {
  id: ThemeId;
  label: string;
  note: string;
  /** `color-scheme` the browser uses for native scrollbars and form controls. */
  scheme: 'dark' | 'light';
}

export type LayoutModeId = 'simple' | 'standard' | 'dense' | 'focus';

export interface LayoutModeDefinition {
  id: LayoutModeId;
  label: string;
  note: string;
  /** True when the shell drops all chrome for a single avatar. */
  immersive: boolean;
}

/* ---------------------------------------------------------------------------
 * Avatar
 * ------------------------------------------------------------------------ */

export type AvatarPresentation = 'female' | 'male' | 'neutral';

export type AvatarArchetype = 'main' | 'specialist';

/**
 * Presence states. This is a state machine the host drives, not something the
 * UI infers from a timer. `idle` is the honest default.
 */
export type AvatarPresence =
  | 'idle'
  | 'listening'
  | 'speaking'
  | 'thinking'
  | 'offline';

/**
 * The full visual identity of one avatar.
 *
 * `appearance` is a declarative description, not pixels. A renderer maps it
 * to whatever medium it supports. Because it is data, a real renderer added
 * later can honour the same preset without any per-view work.
 */
export interface AvatarAppearance {
  presentation: AvatarPresentation;
  /** Free-text descriptor, e.g. 'swept-back undercut, dark'. */
  hair: string;
  /** Free-text descriptor, e.g. 'high-collar technical jacket, charcoal'. */
  wardrobe: string;
  /** Free-text descriptor, e.g. 'soft warm key light, dark background'. */
  lighting: string;
  /** 0..1 trait dial used by the renderer for subtle secondary variation. */
  intensity?: number;
}

export interface AvatarPreset {
  id: string;
  name: string;
  role: string;
  archetype: AvatarArchetype;
  appearance: AvatarAppearance;
  /** Short tagline shown under the name. */
  tagline: string;
  /** Capability tags used by the specialist filter. */
  capabilities: string[];
}

/**
 * A live avatar instance: a preset plus its mutable state.
 *
 * Truth rule: `presence` must only ever be set from a real signal. The
 * scaffold's demo controls move it manually and are labelled as such; no
 * code path here infers speech from a timer.
 */
export interface AvatarInstance {
  presetId: string;
  presence: AvatarPresence;
  /** Optional transcript line. Rendered as text; never synthesised to speech. */
  utterance?: string;
}

/* ---------------------------------------------------------------------------
 * Renderer contract - the upgrade seam
 * ------------------------------------------------------------------------ */

/**
 * What every avatar renderer must provide.
 *
 * The scaffold ships `PlaceholderAvatarRenderer`, which draws an explicitly
 * labelled geometric stand-in. A future live implementation (video, canvas,
 * or 3D) implements this same interface and is selected through
 * `AvatarRendererRegistry`. No view imports a renderer directly.
 */
export interface AvatarRendererProps {
  preset: AvatarPreset;
  instance: AvatarInstance;
  size: AvatarSize;
}

/** Human-readable size steps. Pixel values live in CSS tokens, not here. */
export type AvatarSize = 'chip' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl';

export interface AvatarRenderer {
  /** Stable id used for registry lookup and for diagnostics. */
  readonly id: string;
  /**
   * True only if this renderer draws a genuinely animated/live avatar.
   * The UI uses it to decide whether to advertise animation. A placeholder
   * must return false, so the scaffold can never overstate what it renders.
   */
  readonly isLive: boolean;
  render(props: AvatarRendererProps): ReactNode;
}

/* ---------------------------------------------------------------------------
 * Team
 * ------------------------------------------------------------------------ */

export type WorkerStatus =
  | 'active'
  | 'idle'
  | 'in-call'
  | 'reviewing'
  | 'thinking'
  | 'offline';

export interface TeamMember {
  id: string;
  name: string;
  role: string;
  avatarId: string;
  status: WorkerStatus;
  /** Current task text. Empty string means "no task", not "unknown". */
  currentTask: string;
  recentActivity: string;
  /** 0..1, only meaningful when a task is actually running. */
  progress?: number;
  /** Ordered speaking queue position, if the host has assigned one. */
  queuePosition?: number;
  capabilities: string[];
}

/** Conference-level toggles. Observe mode is presentation, not authority. */
export interface TeamMode {
  /** Text-only: hide avatars, keep the transcript. */
  silentMode: boolean;
  /** Observe: watch without being placed in the queue. */
  observeMode: boolean;
  /** Queue discipline, mirroring the reference's meeting controls. */
  autoQueue: boolean;
  raiseHand: boolean;
}

/* ---------------------------------------------------------------------------
 * Chat / work / calls
 * ------------------------------------------------------------------------ */

export interface ChatMessage {
  id: string;
  author: 'user' | 'agent';
  /** Display name. Agent messages carry the avatar's name. */
  authorName: string;
  /** Avatar id, when the message came from an avatar. */
  avatarId?: string;
  timestamp: string;
  body: string;
  /** Optional plan/task checklist attached to an agent message. */
  checklist?: ChecklistItem[];
}

export interface ChecklistItem {
  id: string;
  label: string;
  status: 'pending' | 'in-progress' | 'done' | 'failed';
}

export interface FileNode {
  id: string;
  name: string;
  kind: 'file' | 'folder';
  /** Folders only. */
  children?: FileNode[];
}

export interface TerminalEntry {
  id: string;
  time: string;
  kind: 'command' | 'info' | 'success' | 'warn' | 'error';
  text: string;
}

export interface CallRecord {
  id: string;
  peerId: string;
  peerName: string;
  kind: 'voice' | 'video';
  direction: 'incoming' | 'outgoing' | 'missed';
  timestamp: string;
  durationLabel: string;
}

export interface TaskSummary {
  id: string;
  label: string;
  owner: string;
  status: 'todo' | 'active' | 'review' | 'done' | 'blocked';
}

/* ---------------------------------------------------------------------------
 * View registry
 * ------------------------------------------------------------------------ */

export type ViewId =
  | 'home'
  | 'chat'
  | 'work'
  | 'team'
  | 'worker'
  | 'calls'
  | 'settings';

export interface ViewDefinition {
  id: ViewId;
  label: string;
  glyph: string;
  /** Views that require a worker id and therefore need a route parameter. */
  requiresWorker?: boolean;
}