/**
 * P23/1 shared Chat/Work state contract.
 *
 * CHAT and WORK are interface depths over the SAME canonical state: same
 * Genesis, same task, same WorkflowRun, same permissions. Mode switches
 * never duplicate execution, never reinvoke models, never alter authority.
 * Framework-agnostic: no React import, fully unit-testable.
 */

/** 'code' is the WORK depth (legacy shell naming preserved for harness). */
export type InterfaceDepth = 'chat' | 'code';

export interface GenesisRef {
  genesisId: string;
  /** How this reference was obtained; unverified defaults say so. */
  provenance: string;
  verified: boolean;
}

export interface PrincipalRef {
  kind: 'genesis' | 'worker' | 'owner';
  id: string;
  onBehalfOf?: string;
}

export interface TaskRef {
  taskId: string;
  objective?: string;
  workflowRunId?: string;
  status?: string;
}

export type ServiceState =
  | { kind: 'live'; summary: string }
  | { kind: 'disconnected'; detail: string }
  | { kind: 'empty' }
  | { kind: 'not-implemented'; feature: string }
  | { kind: 'denied'; reason: string }
  | { kind: 'error'; message: string };

export interface SharedAppState {
  genesis: GenesisRef;
  owner: { ownerId: string };
  project: { root: string; name: string };
  task: TaskRef | null;
  workflowRunId: string | null;
  principal: PrincipalRef | null;
  /** Approval record currently awaited, if any (same record both depths). */
  pendingApprovalId: string | null;
  bridge: ServiceState;
  models: ServiceState;
}

export type RightPanelId =
  | 'agent' | 'details' | 'code' | 'web' | 'preview' | 'video'
  | 'files' | 'tools' | 'inspector' | 'data' | 'media' | 'results';

export type DockTabId =
  | 'terminal' | 'problems' | 'output' | 'tests' | 'logs' | 'evidence' | 'git';

export interface PanelState {
  id: RightPanelId;
  collapsed: boolean;
  order: number;
}

export interface DockState {
  visible: boolean;
  selected: DockTabId;
}

export interface ChatLayoutState {
  selectedConversation: string | null;
  rightPanel: PanelState | null;
  bottomDockVisible: boolean;
}

export interface SidebarLayout {
  /** Pixel width, null = automatic. Clamped 200..640 on load. */
  width: number | null;
  /** Focused/maximized sidebar; canvas yields space but keeps state. */
  focused: boolean;
  activeTabId: RightPanelId | null;
}

export interface WorkLayoutState {
  openTabs: string[];
  selectedFile: string;
  rightPanels: PanelState[];
  sidebar: SidebarLayout;
  dock: DockState & { height: number | null };
  /** Active workspace preset id; 'default' means unmodified Work default. */
  activePresetId: string;
}

export type MainSurfaceKind = 'editor' | 'documents' | 'canvas';

export interface WorkspacePreset {
  preset_id: string;
  title: string;
  depth: InterfaceDepth;
  mainKind: MainSurfaceKind;
  rightPanels: RightPanelId[];
  dockTab: DockTabId;
  description: string;
}

/** Declarative presets: arrangement only, never capability grants. */
export const WORKSPACE_PRESETS: Record<string, WorkspacePreset> = {
  default: {
    preset_id: 'default', title: 'Work default', depth: 'code', mainKind: 'editor',
    rightPanels: ['agent'], dockTab: 'terminal',
    description: 'Standard IDE arrangement.',
  },
  research: {
    preset_id: 'research', title: 'Research', depth: 'code', mainKind: 'documents',
    rightPanels: ['agent', 'inspector', 'web'], dockTab: 'evidence',
    description: 'Documents-first with evidence dock; web surfaces show honest availability.',
  },
  code: {
    preset_id: 'code', title: 'Code', depth: 'code', mainKind: 'editor',
    rightPanels: ['agent'], dockTab: 'tests',
    description: 'Editor-first with tests dock.',
  },
  document: {
    preset_id: 'document', title: 'Document', depth: 'code', mainKind: 'documents',
    rightPanels: ['agent', 'preview'], dockTab: 'output',
    description: 'Document-first with preview and output.',
  },
  cad: {
    preset_id: 'cad', title: 'CAD / 3D', depth: 'code', mainKind: 'canvas',
    rightPanels: ['agent', 'inspector'], dockTab: 'logs',
    description: 'Canvas host with inspector; CAD backends report honest availability.',
  },
  data: {
    preset_id: 'data', title: 'Data', depth: 'code', mainKind: 'canvas',
    rightPanels: ['agent', 'data'], dockTab: 'output',
    description: 'Canvas host with data panel and output dock.',
  },
};

export function resolvePreset(presetId: string): WorkspacePreset {
  const preset = WORKSPACE_PRESETS[presetId];
  if (!preset) throw new Error(`unknown workspace preset ${presetId}`);
  return preset;
}

/**
 * Apply a preset to a work layout: arrangement only. Canonical task/run
 * state is untouched; unknown panels fall back honestly (never fabricated).
 */
export function applyPreset(layout: WorkLayoutState, presetId: string): WorkLayoutState {
  const preset = resolvePreset(presetId);
  const panels: PanelState[] = [];
  for (const id of preset.rightPanels) {
    if (!isRightPanelId(id)) continue;
    if (panels.some((p) => p.id === id)) continue;
    panels.push({ id, collapsed: false, order: panels.length });
  }
  return {
    ...layout,
    rightPanels: panels.length > 0 ? panels : [{ id: 'agent', collapsed: false, order: 0 }],
    sidebar: { ...layout.sidebar, activeTabId: panels.length > 0 ? panels[0].id : 'agent' },
    dock: { ...layout.dock, selected: preset.dockTab },
    activePresetId: preset.preset_id,
  };
}

/** Depth defaults: chat prioritizes conversation, work prioritizes canvas. */
export const CHAT_DEFAULT: ChatLayoutState = {
  selectedConversation: null,
  rightPanel: null,
  bottomDockVisible: false,
};

export const WORK_DEFAULT: WorkLayoutState = {
  openTabs: [],
  selectedFile: '',
  rightPanels: [
    { id: 'agent', collapsed: false, order: 0 },
    { id: 'inspector', collapsed: false, order: 1 },
  ],
  sidebar: { width: null, focused: false, activeTabId: 'agent' },
  dock: { visible: false, selected: 'terminal', height: null },
  activePresetId: 'default',
};

const PANEL_CATALOG: RightPanelId[] = [
  'agent', 'details', 'code', 'web', 'preview', 'video',
  'files', 'tools', 'inspector', 'data', 'media', 'results',
];

const DOCK_CATALOG: DockTabId[] = [
  'terminal', 'problems', 'output', 'tests', 'logs', 'evidence', 'git',
];

export function isRightPanelId(value: string): value is RightPanelId {
  return (PANEL_CATALOG as string[]).includes(value);
}

export function isDockTabId(value: string): value is DockTabId {
  return (DOCK_CATALOG as string[]).includes(value);
}

export function createInitialSharedState(projectRoot: string, projectName: string): SharedAppState {
  return {
    genesis: {
      genesisId: 'genesis-prime',
      provenance: 'local-default (unverified)',
      verified: false,
    },
    owner: { ownerId: 'owner-local' },
    project: { root: projectRoot, name: projectName },
    task: null,
    workflowRunId: null,
    principal: null,
    pendingApprovalId: null,
    bridge: { kind: 'disconnected', detail: 'bridge not yet probed' },
    models: { kind: 'empty' },
  };
}

export function createInitialChatLayout(): ChatLayoutState {
  return JSON.parse(JSON.stringify(CHAT_DEFAULT)) as ChatLayoutState;
}

export function createInitialWorkLayout(): WorkLayoutState {
  return JSON.parse(JSON.stringify(WORK_DEFAULT)) as WorkLayoutState;
}

/** Storage key is per project root so layouts restore per workspace. */
export function uiStorageKey(projectRoot: string): string {
  const slug = projectRoot.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'default';
  return `aetherius.ide.ui.v1:${slug.slice(0, 64)}`;
}

/** @deprecated Use uiStorageKey for per-project state. Kept for migration. */
export const LEGACY_UI_STORAGE_KEY = 'aetherius.ide.ui.v1';

export interface DepthSwitch {
  depth: InterfaceDepth;
  /** The SAME shared-state object reference: switching never clones canonical state. */
  shared: SharedAppState;
}

/** Switch interface depth. Returns the identical shared reference. */
export function switchDepth(shared: SharedAppState, depth: InterfaceDepth): DepthSwitch {
  if (depth !== 'chat' && depth !== 'code') {
    throw new Error(`invalid interface depth ${String(depth)}`);
  }
  return { depth, shared };
}

export function setTask(shared: SharedAppState, task: TaskRef | null): SharedAppState {
  return { ...shared, task };
}

export function setWorkflowRun(shared: SharedAppState, runId: string | null): SharedAppState {
  return { ...shared, workflowRunId: runId };
}

export function setPrincipal(shared: SharedAppState, principal: PrincipalRef | null): SharedAppState {
  if (principal !== null) {
    if (principal.kind !== 'genesis' && principal.kind !== 'worker' && principal.kind !== 'owner') {
      throw new Error(`invalid principal kind ${principal.kind}`);
    }
    if (!principal.id.trim()) throw new Error('principal id is required');
    // UI layer may never escalate: owner-kind principals require backend proof.
    if (principal.kind === 'owner') {
      throw new Error('owner-kind principals must come from backend session state, not UI state');
    }
  }
  return { ...shared, principal };
}

/** Right-panel registry ops: unknown ids rejected, never created implicitly. */
export function openPanel(panels: PanelState[], id: string): PanelState[] {
  if (!isRightPanelId(id)) throw new Error(`unknown panel ${id}`);
  const rest = panels.filter((p) => p.id !== id);
  const order = rest.length === 0 ? 0 : Math.max(...rest.map((p) => p.order)) + 1;
  return [...rest, { id, collapsed: false, order }].sort((a, b) => a.order - b.order);
}

export function closePanel(panels: PanelState[], id: string): PanelState[] {
  return panels.filter((p) => p.id !== id);
}

export function togglePanel(panels: PanelState[], id: string): PanelState[] {
  const found = panels.find((p) => p.id === id);
  if (!found) throw new Error(`panel ${id} is not open`);
  return panels.map((p) => (p.id === id ? { ...p, collapsed: !p.collapsed } : p));
}

export function reorderPanels(panels: PanelState[], idsInOrder: string[]): PanelState[] {
  const wanted = [...idsInOrder];
  const current = new Set(panels.map((p) => p.id));
  if (wanted.length !== panels.length || !wanted.every((id) => current.has(id as RightPanelId))) {
    throw new Error('reorder must list exactly the open panels');
  }
  const byId = new Map(panels.map((p) => [p.id, p] as const));
  return wanted.map((id, order) => {
    // Validated above: every wanted id is an open panel id.
    const panel = byId.get(id as RightPanelId) as PanelState;
    return { ...panel, order };
  });
}

/** Bottom dock: only runtime/developer tabs; Code/Web/Video never live here. */
export function selectDockTab(dock: DockState, tab: string): DockState {
  if (!isDockTabId(tab)) throw new Error(`unknown dock tab ${tab}`);
  return { visible: true, selected: tab };
}

export function setDockVisible(dock: DockState, visible: boolean): DockState {
  return { ...dock, visible };
}

export interface PersistedUiState {
  version: 2;
  depth: InterfaceDepth;
  chat: ChatLayoutState;
  work: WorkLayoutState;
}

export function serializeUiState(depth: InterfaceDepth, chat: ChatLayoutState, work: WorkLayoutState): string {
  const payload: PersistedUiState = { version: 2, depth, chat, work };
  return JSON.stringify(payload);
}

function sanitizePanels(panels: unknown, warnings: string[], where: string): PanelState[] {
  if (!Array.isArray(panels)) {
    warnings.push(`${where}: panels not an array, using default`);
    return [{ id: 'agent', collapsed: false, order: 0 }];
  }
  const seen = new Set<string>();
  const out: PanelState[] = [];
  for (const panel of panels) {
    if (typeof panel !== 'object' || panel === null) {
      warnings.push(`${where}: dropping malformed panel entry`);
      continue;
    }
    const record = panel as Record<string, unknown>;
    if (typeof record.id !== 'string' || !isRightPanelId(record.id)) {
      warnings.push(`${where}: dropping unknown panel ${String((record as { id?: unknown }).id)}`);
      continue;
    }
    if (seen.has(record.id)) {
      warnings.push(`${where}: dropping duplicate panel ${record.id}`);
      continue;
    }
    seen.add(record.id);
    out.push({ id: record.id, collapsed: record.collapsed === true, order: out.length });
  }
  return out.length > 0 ? out : [{ id: 'agent', collapsed: false, order: 0 }];
}

function clampWidth(value: unknown, warnings: string[]): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    warnings.push('sidebar width invalid, using automatic');
    return null;
  }
  return Math.min(640, Math.max(200, Math.round(value)));
}

function sanitizeWork(raw: unknown, warnings: string[]): WorkLayoutState {
  const fallback = createInitialWorkLayout();
  if (typeof raw !== 'object' || raw === null) {
    warnings.push('work layout missing, using default');
    return fallback;
  }
  const record = raw as Record<string, unknown>;
  const dock = (record.dock ?? {}) as Record<string, unknown>;
  const dockTab = typeof dock.selected === 'string' && isDockTabId(dock.selected) ? dock.selected : 'terminal';
  if (dock.selected !== undefined && dockTab === 'terminal' && dock.selected !== 'terminal') {
    warnings.push('work dock tab unknown, using terminal');
  }
  const sidebar = (record.sidebar ?? {}) as Record<string, unknown>;
  const presetId = typeof record.activePresetId === 'string' && WORKSPACE_PRESETS[record.activePresetId] !== undefined
    ? record.activePresetId
    : 'default';
  if (record.activePresetId !== undefined && presetId === 'default' && record.activePresetId !== 'default') {
    warnings.push('work preset unknown, using default');
  }
  return {
    openTabs: Array.isArray(record.openTabs) ? record.openTabs.filter((t): t is string => typeof t === 'string') : [],
    selectedFile: typeof record.selectedFile === 'string' ? record.selectedFile : '',
    activePresetId: presetId,
    rightPanels: sanitizePanels(record.rightPanels, warnings, 'work'),
    sidebar: {
      width: clampWidth(sidebar.width, warnings),
      focused: sidebar.focused === true,
      activeTabId:
        typeof sidebar.activeTabId === 'string' && isRightPanelId(sidebar.activeTabId)
          ? sidebar.activeTabId
          : 'agent',
    },
    dock: {
      visible: dock.visible === true,
      selected: dockTab,
      height:
        typeof dock.height === 'number' && Number.isFinite(dock.height) && dock.height >= 80 && dock.height <= 600
          ? Math.round(dock.height)
          : null,
    },
  };
}

function sanitizeChat(raw: unknown, warnings: string[]): ChatLayoutState {
  const fallback = createInitialChatLayout();
  if (typeof raw !== 'object' || raw === null) {
    warnings.push('chat layout missing, using default');
    return fallback;
  }
  const record = raw as Record<string, unknown>;
  let rightPanel: PanelState | null = null;
  if (record.rightPanel !== null && record.rightPanel !== undefined) {
    const single = sanitizePanels([record.rightPanel], warnings, 'chat');
    rightPanel = single[0].id === 'agent' && (record.rightPanel as { id?: unknown }).id !== 'agent' ? null : { ...single[0], order: 0 };
    if (rightPanel === null) warnings.push('chat panel unknown, cleared');
  }
  return {
    selectedConversation: typeof record.selectedConversation === 'string' ? record.selectedConversation : null,
    rightPanel,
    bottomDockVisible: record.bottomDockVisible === true,
  };
}

function migrateV1ToV2(record: Record<string, unknown>, warnings: string[]): PersistedUiState {
  warnings.push('migrated persisted UI state v1 to v2');
  const depth = record.depth === 'chat' || record.depth === 'code' ? record.depth : 'code';
  return {
    version: 2,
    depth,
    chat: sanitizeChat(record.chat, warnings),
    work: sanitizeWork(record.work, warnings),
  };
}

/** Corrupt/foreign persisted state surfaces as an error, never silent defaults. */
export function parseUiState(raw: string): PersistedUiState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error('persisted UI state is malformed');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('persisted UI state has wrong shape');
  }
  const record = parsed as Record<string, unknown>;
  if (record.version !== 1 && record.version !== 2) throw new Error('unsupported UI state version');
  if (record.depth !== 'chat' && record.depth !== 'code') {
    throw new Error('persisted UI state has invalid depth');
  }
  if (record.version === 1) {
    return migrateV1ToV2(record, []);
  }
  // v2 strict path: unknown panels/sizes fail loudly here; recoverUiState
  // below offers per-section recovery for runtime use.
  const chat = record.chat as ChatLayoutState;
  const work = record.work as WorkLayoutState;
  if (typeof chat !== 'object' || chat === null || typeof work !== 'object' || work === null) {
    throw new Error('persisted UI state missing layouts');
  }
  if (chat.rightPanel !== null && !isRightPanelId(chat.rightPanel.id)) {
    throw new Error('persisted UI state has unknown chat panel');
  }
  for (const panel of work.rightPanels ?? []) {
    if (!isRightPanelId(panel.id)) throw new Error('persisted UI state has unknown work panel');
  }
  if (!isDockTabId(work.dock?.selected)) throw new Error('persisted UI state has unknown dock tab');
  return parsed as PersistedUiState;
}

/**
 * Runtime recovery entry: never throws. Recovers each section
 * independently, collects warnings, falls back to defaults per section.
 */
export function recoverUiState(raw: string | null): { state: PersistedUiState; warnings: string[]; recovered: boolean } {
  const warnings: string[] = [];
  const defaults = (): PersistedUiState => ({
    version: 2,
    depth: 'code',
    chat: createInitialChatLayout(),
    work: createInitialWorkLayout(),
  });
  if (!raw) return { state: defaults(), warnings, recovered: false };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    warnings.push('persisted UI state malformed, using defaults');
    return { state: defaults(), warnings, recovered: true };
  }
  if (typeof parsed !== 'object' || parsed === null) {
    warnings.push('persisted UI state has wrong shape, using defaults');
    return { state: defaults(), warnings, recovered: true };
  }
  const record = parsed as Record<string, unknown>;
  if (record.version !== 1 && record.version !== 2) {
    warnings.push(`unsupported UI state version ${String(record.version)}, using defaults`);
    return { state: defaults(), warnings, recovered: true };
  }
  const depth = record.depth === 'chat' || record.depth === 'code' ? record.depth : 'code';
  if (record.depth !== 'chat' && record.depth !== 'code') {
    warnings.push('persisted depth invalid, using code');
  }
  return {
    state: {
      version: 2,
      depth,
      chat: sanitizeChat(record.chat, warnings),
      work: sanitizeWork(record.work, warnings),
    },
    warnings,
    recovered: warnings.length > 0,
  };
}

export interface UiStorage {
  load(): string | null;
  save(raw: string): void;
}

export function loadUiState(storage: UiStorage | null): PersistedUiState | null {
  if (!storage) return null;
  const raw = storage.load();
  if (!raw) return null;
  return parseUiState(raw);
}
