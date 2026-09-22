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

export interface WorkLayoutState {
  openTabs: string[];
  selectedFile: string;
  rightPanels: PanelState[];
  dock: DockState;
}

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
  return { selectedConversation: null, rightPanel: null, bottomDockVisible: false };
}

export function createInitialWorkLayout(): WorkLayoutState {
  return {
    openTabs: [],
    selectedFile: '',
    rightPanels: [{ id: 'agent', collapsed: false, order: 0 }],
    dock: { visible: false, selected: 'terminal' },
  };
}

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
  version: 1;
  depth: InterfaceDepth;
  chat: ChatLayoutState;
  work: WorkLayoutState;
}

export function serializeUiState(depth: InterfaceDepth, chat: ChatLayoutState, work: WorkLayoutState): string {
  const payload: PersistedUiState = { version: 1, depth, chat, work };
  return JSON.stringify(payload);
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
  if (record.version !== 1) throw new Error('unsupported UI state version');
  if (record.depth !== 'chat' && record.depth !== 'code') {
    throw new Error('persisted UI state has invalid depth');
  }
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
