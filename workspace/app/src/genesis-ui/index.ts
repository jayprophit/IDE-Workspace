/**
 * Genesis / Aetherius avatar-first UI scaffold.
 *
 * Public surface for embedding the scaffold. Import `GenesisShell` for the
 * whole app, or the individual modules for composition.
 *
 * Truth statement for this package: the avatar renderer shipped here is a
 * labelled placeholder. There is no animation, lip sync, audio, video or 3D
 * embodiment. See docs/genesis-ui/GAP_LIST.md.
 */

export { GenesisShell, default, runtimeDot, runtimeLabel } from './GenesisShell';
export type { GenesisShellProps } from './GenesisShell';

export * from './types';
export * from './registry';
export * from './avatars';
export * from './fixtures';

export { AvatarStage, AvatarChip } from './avatar/AvatarStage';
export { AvatarPicker, SpecialistCard } from './avatar/AvatarPicker';
export {
  PlaceholderAvatarRenderer,
  registerAvatarRenderer,
  getAvatarRenderer,
  listAvatarRenderers,
  isLiveRenderer,
  PLACEHOLDER_RENDERER_ID,
} from './avatar/renderers';

export { Panel, Badge, Button, StatusDot, Switch, Field, Tabs, EmptyState, Notice, KeyValue, Progress } from './components/ui';
export { TeamStrip, ConferenceGrid, ConversationQueue, SummonPanel, TeamPanel, presenceOf } from './team/TeamViews';
export { HomeView, ChatView, WorkView, WorkerDetailView, CallsView, SettingsView } from './views';

/* Runtime binding (P0-A). The single Agent Bridge integration point. Views
   never import a client; only the shell wires the binding to props. */
export { useGenesisRuntime } from './runtime/useGenesisRuntime';
export {
  FIXTURE_SNAPSHOT,
  REAL_CLIENT,
  mapApprovals,
  mapEventToMessage,
  mapTaskStatus,
  mapTasks,
  mapWorkerStatus,
  mapWorkers,
} from './runtime/runtimeTypes';
export type {
  GenesisClient,
  RuntimeApproval,
  RuntimeBinding,
  RuntimeBindingOptions,
  RuntimeConnection,
  RuntimeSnapshot,
  RuntimeSource,
} from './runtime/runtimeTypes';
export { ApprovalList, RuntimeBadge, RuntimeNotice, connectionLabel, connectionTone } from './runtime/RuntimeViews';