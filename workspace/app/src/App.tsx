import { useEffect, useRef, useState } from 'react';
import type { ThemeId, WorkspaceMode } from './types';
import { fetchBridgeStatus, type BridgeStatus, bridgeBase, createTerminalSession, execTerminal, fetchTerminalSession, type TerminalEntryView, listWorkspace, readWorkspaceFile, writeWorkspaceFile, searchWorkspace, gitWorkspace, createWorkspaceEntry, deleteWorkspaceEntry, renameWorkspaceEntry, type WorkspaceEntry } from './bridge';
import { fetchInspectionEvents, fetchInspectionSessions, type InspectionEvent, type InspectionSession } from './inspection';
import {
  serializeUiState,
  createInitialChatLayout,
  createInitialWorkLayout,
  recoverUiState,
  uiStorageKey,
  applyPreset,
  classifyViewport,
  sidebarOverlays,
  WORKSPACE_PRESETS,
  type DockTabId,
  type RightPanelId,
  type UiStorage,
} from './workspace/state';
import {
  closeDetachedHandle,
  openDetachedWindow,
  parseDetachRequest,
  type DetachedHandle,
} from './workspace/detach';
import DetachedView from './DetachedView';
import GenesisTaskBar from './components/GenesisTaskBar';

function browserWindowOpener(): {
  open(url: string, target: string, features?: string): DetachedHandle | null;
} {
  return {
    open: (url, target, features) => {
      try {
        const child = window.open(url, target, features);
        if (!child) return null;
        return {
          get closed() {
            return child.closed;
          },
          close: () => child.close(),
          focus: () => child.focus(),
        };
      } catch {
        return null;
      }
    },
  };
}

const PROJECT_ID = 'workspace/app';

function browserUiStorage(): UiStorage | null {
  try {
    const ls = window.localStorage;
    const key = uiStorageKey(PROJECT_ID);
    return {
      load: () => ls.getItem(key) ?? ls.getItem('aetherius.ide.ui.v1'),
      save: (raw: string) => ls.setItem(key, raw),
    };
  } catch {
    return null;
  }
}

/** Shared canonical refs: one Genesis, one task source for BOTH depths. */
const SHARED_GENESIS_REF = 'genesis-prime · local preview (unverified)';

const BRIDGE_POLL_MS = 5000;
const BRIDGE_INITIAL_RETRY_MS = 1000;
const BRIDGE_MAX_RETRIES = 5;

function useBridgeStatus(): BridgeStatus {
  const [status, setStatus] = useState<BridgeStatus>({
    connected: false,
    baseUrl: '',
    health: 'UNKNOWN',
    runtime: null,
    models: [],
    error: '',
    agentBridgeVersion: '',
    ideVersion: '',
    versionCompatible: false,
  });
  useEffect(() => {
    let cancelled = false;
    let retryCount = 0;
    const poll = async () => {
      const next = await fetchBridgeStatus();
      if (!cancelled) {
        setStatus(next);
        if (next.connected) {
          retryCount = 0;
        } else if (retryCount < BRIDGE_MAX_RETRIES) {
          retryCount++;
          setTimeout(() => void poll(), BRIDGE_INITIAL_RETRY_MS * retryCount);
        }
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), BRIDGE_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);
  return status;
}

const NO_FILE_TEXT = '// No file open — browse a workspace above to edit real files.\n// The editor never shows fabricated file contents.';
const NO_TASK_TEXT = 'no active task';

const THEMES: { id: ThemeId; label: string }[] = [
  { id: 'dark', label: 'Dark' },
  { id: 'frost', label: 'Frost' },
  { id: 'aurora', label: 'Aurora' },
  { id: 'amber', label: 'Amber' },
];

const DOCK_TABS: DockTabId[] = ['terminal', 'problems', 'output', 'tests', 'logs', 'evidence', 'git'];

const DOCK_EMPTY_TEXT: Record<Exclude<DockTabId, 'terminal'>, string> = {
  problems: 'No problems reported.',
  output: 'No output captured.',
  tests: 'No test results.',
  logs: 'No logs captured.',
  evidence: 'No evidence recorded.',
  git: 'Git activity unavailable.',
};

export default function App() {
  // Detached secondary window: render the requested panel view instead of
  // the full shell. Invalid ids fall back to the full shell.
  if (typeof window !== 'undefined') {
    const detachedPanel = parseDetachRequest(window.location.href);
    if (detachedPanel) {
      return <DetachedView panelId={detachedPanel} />;
    }
  }
  // Depth + layout restore: per-section recovery, corrupt parts fall back.
  const restoredLayout = (() => {
    try {
      return recoverUiState(browserUiStorage()?.load() ?? null);
    } catch {
      return null;
    }
  })();
  const [mode, setModeState] = useState<WorkspaceMode>(restoredLayout?.state.depth ?? 'code');
  const [aiOpen, setAiOpenState] = useState<boolean>(() => {
    const agent = restoredLayout?.state.work.rightPanels.find((p) => p.id === 'agent');
    return agent ? !agent.collapsed : true;
  });
  const [dockVisible, setDockVisibleState] = useState<boolean>(
    restoredLayout?.state.work.dock.visible ?? false,
  );
  const [dockTab, setDockTabState] = useState<DockTabId>(
    restoredLayout?.state.work.dock.selected ?? 'terminal',
  );
  const [sidebarWidth, setSidebarWidthState] = useState<number | null>(
    restoredLayout?.state.work.sidebar.width ?? null,
  );
  const [sidebarFocused, setSidebarFocused] = useState<boolean>(
    restoredLayout?.state.work.sidebar.focused ?? false,
  );
  const [sidebarTab, setSidebarTab] = useState<RightPanelId>(
    restoredLayout?.state.work.sidebar.activeTabId ?? 'agent',
  );
  const [openPanels, setOpenPanels] = useState<RightPanelId[]>(() => {
    const ids = restoredLayout?.state.work.rightPanels.map((p) => p.id) ?? ['agent', 'inspector'];
    return ids.length > 0 ? ids : ['agent', 'inspector'];
  });
  const [presetId, setPresetId] = useState<string>(
    restoredLayout?.state.work.activePresetId ?? 'default',
  );
  // Detached secondary windows: panel ids hosted outside the shell. View-only
  // bookkeeping — execution lifecycle is untouched by detaching. Handles live
  // in a ref (never persisted); persisted detached entries reattach on load
  // because closed windows cannot be resurrected across reloads.
  const [detached, setDetachedState] = useState<RightPanelId[]>([]);
  const detachedHandles = useRef(new Map<RightPanelId, { closed: boolean; close(): void; focus(): void }>());
  useEffect(() => {
    const handles = detachedHandles.current;
    return () => {
      handles.clear();
    };
  }, []);
  // Responsive viewport tracking: transient overlay state only — desktop
  // preferences (width, panels, dock) are never overwritten by narrow views.
  const [viewportWidth, setViewportWidth] = useState<number>(() =>
    typeof window === 'undefined' ? 1440 : window.innerWidth,
  );
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerToggleRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const viewport = classifyViewport(viewportWidth);
  const overlaySidebar = sidebarOverlays(viewport);
  const closeDrawer = () => {
    setDrawerOpen(false);
    drawerToggleRef.current?.focus();
  };
  interface LayoutSnapshot {
    mode: WorkspaceMode;
    aiOpen: boolean;
    dockVisible: boolean;
    dockTab: DockTabId;
    sidebarWidth: number | null;
    sidebarFocused: boolean;
    sidebarTab: RightPanelId;
    openPanels: RightPanelId[];
    presetId: string;
    detached: RightPanelId[];
  }
  const persistSnapshot = (s: LayoutSnapshot) => {
    try {
      const storage = browserUiStorage();
      if (!storage) return;
      const chat = createInitialChatLayout();
      const work = createInitialWorkLayout();
      const listed = s.openPanels.length > 0 ? s.openPanels : (['agent'] as RightPanelId[]);
      work.rightPanels = listed.map((id, order) => ({
        id,
        collapsed: id === 'agent' ? !s.aiOpen : false,
        order,
      }));
      work.sidebar = { width: s.sidebarWidth, focused: s.sidebarFocused, activeTabId: s.sidebarTab };
      work.dock = { visible: s.dockVisible, selected: s.dockTab, height: null };
      work.activePresetId = WORKSPACE_PRESETS[s.presetId] !== undefined ? s.presetId : 'default';
      work.detached = s.detached.filter((id) => listed.includes(id));
      storage.save(serializeUiState(s.mode, chat, work));
    } catch {
      // Persistence is best-effort; layout state must never break the shell.
    }
  };
  const snapshotLayout = (): LayoutSnapshot => ({
    mode, aiOpen, dockVisible, dockTab, sidebarWidth, sidebarFocused, sidebarTab,
    openPanels, presetId, detached,
  });
  const setMode = (next: WorkspaceMode) => {
    setModeState(next);
    persistSnapshot({ ...snapshotLayout(), mode: next });
  };
  const setAiOpen = (next: boolean | ((v: boolean) => boolean)) => {
    setAiOpenState((prev) => {
      const value = typeof next === 'function' ? (next as (v: boolean) => boolean)(prev) : next;
      persistSnapshot({ ...snapshotLayout(), aiOpen: value });
      return value;
    });
  };
  const setDockVisible = (next: boolean) => {
    setDockVisibleState(next);
    persistSnapshot({ ...snapshotLayout(), dockVisible: next });
  };
  const setDockTab = (next: DockTabId) => {
    setDockTabState(next);
    persistSnapshot({ ...snapshotLayout(), dockTab: next });
  };
  const setSidebarWidth = (next: number | null) => {
    const clamped = next === null ? null : Math.min(640, Math.max(200, Math.round(next)));
    setSidebarWidthState(clamped);
    persistSnapshot({ ...snapshotLayout(), sidebarWidth: clamped });
  };
  const setSidebarFocus = (next: boolean) => {
    setSidebarFocused(next);
    persistSnapshot({ ...snapshotLayout(), sidebarFocused: next });
  };
  const selectSidebarTab = (next: RightPanelId) => {
    setSidebarTab(next);
    persistSnapshot({ ...snapshotLayout(), sidebarTab: next });
  };
  const applyPresetToApp = (id: string) => {
    const preset = WORKSPACE_PRESETS[id];
    if (!preset) return;
    const applied = applyPreset(createInitialWorkLayout(), id);
    const panels = applied.rightPanels.map((p) => p.id);
    const activeTab = applied.sidebar.activeTabId ?? 'agent';
    setOpenPanels(panels);
    setSidebarTab(activeTab);
    setDockTab(applied.dock.selected);
    setPresetId(applied.activePresetId);
    setModeState(preset.depth);
    persistSnapshot({
      ...snapshotLayout(),
      mode: preset.depth,
      openPanels: panels,
      sidebarTab: activeTab,
      dockTab: applied.dock.selected,
      presetId: applied.activePresetId,
    });
  };
  const resetLayout = () => {
    try {
      browserUiStorage()?.save(
        serializeUiState('code', createInitialChatLayout(), createInitialWorkLayout()),
      );
    } catch {
      // Best effort only.
    }
    setModeState('code');
    setAiOpenState(true);
    setDockVisibleState(false);
    setDockTabState('terminal');
    setSidebarWidthState(null);
    setSidebarFocused(false);
    setSidebarTab('agent');
    setOpenPanels(['agent']);
    setPresetId('default');
    for (const handle of detachedHandles.current.values()) {
      try {
        if (!handle.closed) handle.close();
      } catch {
        // Best effort: detached windows belong to the user session.
      }
    }
    detachedHandles.current.clear();
    setDetachedState([]);
  };
  const detachPanel = (id: RightPanelId) => {
    const { handle, blocked } = openDetachedWindow(browserWindowOpener(), window.location.href, id);
    if (blocked || !handle) return false;
    detachedHandles.current.set(id, handle);
    setDetachedState((prev) => (prev.includes(id) ? prev : [...prev, id]));
    if (sidebarTab === id) {
      const fallback = openPanels.find((openId) => openId !== id) ?? 'agent';
      setSidebarTab(fallback);
    }
    persistSnapshot({ ...snapshotLayout(), detached: [...detached, id] });
    return true;
  };
  const reattachPanel = (id: RightPanelId) => {
    closeDetachedHandle(detachedHandles.current.get(id) ?? null);
    detachedHandles.current.delete(id);
    setDetachedState((prev) => {
      const next = prev.filter((openId) => openId !== id);
      persistSnapshot({ ...snapshotLayout(), detached: next });
      return next;
    });
  };
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [theme, setTheme] = useState<ThemeId>('dark');
  const [messages, setMessages] = useState<{ from: 'agent' | 'user'; text: string }[]>([
    { from: 'agent' as const, text: 'Workspace shell ready. Backend execution runs only through Agent Bridge when connected.' },
  ]);
  const [draft, setDraft] = useState('');

  // Live Agent Bridge status when reachable; honest fallback labels stay
  // visible while disconnected (never fake live data).
  const bridge = useBridgeStatus();
  const live = bridge.connected ? bridge.runtime : null;
  const firstTask = live?.tasks?.[0];
  // One shared canonical task source for BOTH depths: identical pill text in
  // Chat and Work. Honest fallbacks only — never fabricated live data.
  const status = {
    model: live?.active_model || 'no model connected',
    agent: firstTask?.worker || 'no agent connected',
    task: firstTask?.objective || firstTask?.task_id || NO_TASK_TEXT,
    progress: firstTask?.progress_pct ?? live?.progress_pct ?? null,
    approval: (live && live.approvals_pending.length > 0 ? 'pending' : 'none') as 'none' | 'pending',
    verification: 'idle' as const,
  };
  const connection = bridge.connected
    ? `backend: connected (${bridge.health})`
    : 'backend: disconnected';
  const queueDepth = live?.queue_depth ?? 0;
  const workerCount = live?.workers?.length ?? 0;
  const approvalsCount = live?.approvals_pending.length ?? 0;

  // Real terminal session against the loopback bridge (policy-gated).
  const [termId, setTermId] = useState('');
  const [termCwd, setTermCwd] = useState('');
  const [termHistory, setTermHistory] = useState<TerminalEntryView[]>([]);
  const [termInput, setTermInput] = useState('');
  const [termBusy, setTermBusy] = useState(false);
  const [termError, setTermError] = useState('');

  // Live workspace explorer/editor backed by /v1/workspace routes.
  const [wsRoot, setWsRoot] = useState('');
  const [wsPath, setWsPath] = useState('');
  const [wsEntries, setWsEntries] = useState<WorkspaceEntry[]>([]);
  const [wsError, setWsError] = useState('');
  const [openFile, setOpenFile] = useState('');
  const [editorText, setEditorText] = useState('');
  const [saveNote, setSaveNote] = useState('');
  const [searchPat, setSearchPat] = useState('');
  const [searchHits, setSearchHits] = useState<{ path: string; line: number; preview: string }[]>([]);
  const [gitInfo, setGitInfo] = useState('');
  const [newEntryName, setNewEntryName] = useState('');
  const [newEntryIsDir, setNewEntryIsDir] = useState(false);
  const [showNewEntry, setShowNewEntry] = useState(false);

  // Runtime inspection: real bridge state only (workers/approvals from the
  // live payload; sessions/events fetched explicitly, never polled, never
  // fabricated). Manual refresh keeps bridge-call counts deterministic.
  const [inspectSessions, setInspectSessions] = useState<InspectionSession[]>([]);
  const [inspectSessionsError, setInspectSessionsError] = useState('');
  const [inspectLoading, setInspectLoading] = useState(false);
  const [selectedInspectSession, setSelectedInspectSession] = useState('');
  const [inspectEvents, setInspectEvents] = useState<InspectionEvent[]>([]);
  const [inspectEventsError, setInspectEventsError] = useState('');
  const [inspectEventsLoading, setInspectEventsLoading] = useState(false);
  const refreshInspection = async () => {
    setInspectSessionsError('');
    setInspectEventsError('');
    setInspectEvents([]);
    setSelectedInspectSession('');
    if (!bridge.connected) {
      setInspectSessionsError('Bridge disconnected — inspection unavailable.');
      return;
    }
    setInspectLoading(true);
    try {
      const res = await fetchInspectionSessions(bridgeBase());
      if (!res.ok || !res.data) throw new Error(res.error || 'sessions fetch failed');
      setInspectSessions(res.data);
    } catch (e: unknown) {
      setInspectSessionsError(e instanceof Error ? e.message : String(e));
    } finally {
      setInspectLoading(false);
    }
  };
  const selectInspectSession = async (sessionId: string) => {
    setSelectedInspectSession(sessionId);
    setInspectEvents([]);
    setInspectEventsError('');
    if (!bridge.connected) {
      setInspectEventsError('Bridge disconnected — inspection unavailable.');
      return;
    }
    setInspectEventsLoading(true);
    try {
      const res = await fetchInspectionEvents(bridgeBase(), sessionId);
      if (!res.ok || !res.data) throw new Error(res.error || 'events fetch failed');
      setInspectEvents(res.data);
    } catch (e: unknown) {
      setInspectEventsError(e instanceof Error ? e.message : String(e));
    } finally {
      setInspectEventsLoading(false);
    }
  };
  const refreshExplorer = async (root: string, path: string) => {
    setWsError('');
    try {
      const res = await listWorkspace(bridgeBase(), root, path);
      if (!res.ok) throw new Error(res.error || 'list failed');
      setWsEntries(res.entries ?? []);
      setWsPath(path);
    } catch (e: unknown) {
      setWsError(e instanceof Error ? e.message : String(e));
    }
  };
  const openWsFile = async (root: string, path: string) => {
    setWsError('');
    setSaveNote('');
    try {
      const res = await readWorkspaceFile(bridgeBase(), root, path);
      if (!res.ok) throw new Error(res.error || 'read failed');
      setOpenFile(path);
      setEditorText(res.content ?? '');
    } catch (e: unknown) {
      setWsError(e instanceof Error ? e.message : String(e));
    }
  };
  const saveWsFile = async () => {
    if (!openFile) return;
    setSaveNote('');
    try {
      const res = await writeWorkspaceFile(bridgeBase(), wsRoot, openFile, editorText);
      if (!res.ok) throw new Error(res.error || 'save failed');
      setSaveNote(`saved ${res.bytes ?? 0} bytes, verified=${res.verified === true}`);
    } catch (e: unknown) {
      setSaveNote(`save failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const runSearch = async () => {
    try {
      const res = await searchWorkspace(bridgeBase(), wsRoot, searchPat, wsPath);
      if (!res.ok) throw new Error(res.error || 'search failed');
      setSearchHits(res.hits ?? []);
    } catch (e: unknown) {
      setWsError(e instanceof Error ? e.message : String(e));
    }
  };
  const refreshGit = async () => {
    try {
      const res = await gitWorkspace(bridgeBase(), wsRoot, 'status');
      setGitInfo(res.ok ? JSON.stringify(res).slice(0, 300) : `not a repo: ${res.error ?? ''}`);
    } catch (e: unknown) {
      setGitInfo(`error: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const createEntry = async () => {
    if (!newEntryName.trim()) return;
    setWsError('');
    try {
      const fullPath = wsPath ? `${wsPath}/${newEntryName}` : newEntryName;
      const res = await createWorkspaceEntry(bridgeBase(), wsRoot, fullPath, newEntryIsDir);
      if (!res.ok) throw new Error(res.error || 'create failed');
      setNewEntryName('');
      setShowNewEntry(false);
      void refreshExplorer(wsRoot, wsPath);
    } catch (e: unknown) {
      setWsError(e instanceof Error ? e.message : String(e));
    }
  };
  const deleteEntry = async (path: string) => {
    if (!confirm(`Delete ${path}?`)) return;
    setWsError('');
    try {
      const res = await deleteWorkspaceEntry(bridgeBase(), wsRoot, path);
      if (!res.ok) throw new Error(res.error || 'delete failed');
      if (openFile === path) {
        setOpenFile('');
        setEditorText('');
      }
      void refreshExplorer(wsRoot, wsPath);
    } catch (e: unknown) {
      setWsError(e instanceof Error ? e.message : String(e));
    }
  };
  const renameEntry = async (oldPath: string) => {
    const oldName = oldPath.split('/').pop() || '';
    const newName = prompt('Rename to:', oldName);
    if (!newName || newName === oldName) return;
    setWsError('');
    try {
      const dir = oldPath.substring(0, oldPath.lastIndexOf('/'));
      const newPath = dir ? `${dir}/${newName}` : newName;
      const res = await renameWorkspaceEntry(bridgeBase(), wsRoot, oldPath, newPath);
      if (!res.ok) throw new Error(res.error || 'rename failed');
      if (openFile === oldPath) setOpenFile(newPath);
      void refreshExplorer(wsRoot, wsPath);
    } catch (e: unknown) {
      setWsError(e instanceof Error ? e.message : String(e));
    }
  };
  useEffect(() => {
    let cancelled = false;
    createTerminalSession(bridgeBase())
      .then((s) => {
        if (cancelled) return;
        setTermId(s.session_id);
        setTermCwd(s.cwd);
        setTermHistory(s.history);
      })
      .catch((e: unknown) => {
        if (!cancelled) setTermError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const termSend = async (origin: 'user' | 'agent') => {
    const command = termInput.trim();
    if (!command || !termId || termBusy) return;
    setTermBusy(true);
    setTermError('');
    try {
      await execTerminal(bridgeBase(), termId, command, origin);
      const s = await fetchTerminalSession(bridgeBase(), termId);
      setTermHistory(s.history);
      setTermInput('');
    } catch (e: unknown) {
      setTermError(e instanceof Error ? e.message : String(e));
    } finally {
      setTermBusy(false);
    }
  };

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    setMessages((m) => [...m, { from: 'user' as const, text }]);
    setDraft('');
    window.setTimeout(() => {
      setMessages((m) => [...m, { from: 'agent' as const, text: `Noted: "${text}". Backend execution is not connected in this build — the message was recorded locally only.` }]);
    }, 250);
  };

  return (
    <div className="shell" data-theme={theme} data-testid="shell-root" data-viewport={viewport}>
      <header className="topbar" data-testid="top-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden>◈</span>
          <span>IDE_NAME_TBD</span>
          <span className="pill" data-testid="project-pill">project: workspace/app</span>
        </div>

        <nav className="mode-switch" aria-label="Workspace mode">
          <button
            data-testid="mode-chat-btn"
            className={mode === 'chat' ? 'active' : ''}
            onClick={() => setMode('chat')}
          >
            Chat
          </button>
          <button
            data-testid="mode-code-btn"
            className={mode === 'code' ? 'active' : ''}
            onClick={() => setMode('code')}
          >
            Code
          </button>
        </nav>

        <div className="top-actions">
          <span className="pill" data-testid="model-pill">model: {status.model}</span>
          <button className="btn" data-testid="settings-btn" onClick={() => setSettingsOpen((s) => !s)}>
            Settings
          </button>
        </div>
      </header>

      <div className="main">
        <aside className="sidebar" data-testid="left-nav" aria-label="Primary">
          <button className="nav-item active"><span className="label">◉ Work</span></button>
          <button className="nav-item"><span className="label">✦ Chat</span></button>
          <button className="nav-item"><span className="label">▤ Files</span></button>
          <button className="nav-item"><span className="label">⚙ Agents</span></button>
          <div className="dock" aria-label="Quick dock">
            <button><span>Chat</span></button>
            <button><span>Files</span></button>
            <button><span>Apps</span></button>
            <button><span>Tools</span></button>
            <button><span>Canvas</span></button>
            <button><span>Settings</span></button>
          </div>
        </aside>

        <section className="workspace" data-testid="center-workspace" aria-label="Universal workspace">
          <div className="card workspace-head">
            <strong data-testid="workspace-title">
              {mode === 'chat' ? 'Universal Workspace - Chat mode' : 'Universal Workspace - Code mode'}
            </strong>
            <span className="pill">mode: {mode}</span>
            <span className="pill" data-testid="active-preset" title="Workspace arrangement preset (presentation only)">
              preset: {presetId}
            </span>
          </div>

          <div className="card workspace-body" data-testid="workspace-body">
            {mode === 'chat' ? (
              <div>
                <div className="chat-log" data-testid="chat-log">
                  {messages.map((m, i) => (
                    <div key={i} className={`bubble ${m.from}`} data-testid={`msg-${i}`}>
                      {m.text}
                    </div>
                  ))}
                </div>
                <div className="composer">
                  <input
                    data-testid="chat-input"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
                    placeholder="Type a message…"
                    aria-label="Chat message"
                  />
                  <button className="btn primary" data-testid="chat-send" onClick={send}>Send</button>
                </div>
              </div>
            ) : (
              <div className="code-grid">
                <div className="card file-list" data-testid="file-list">
                  <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                    <input
                      data-testid="explorer-root"
                      value={wsRoot}
                      onChange={(e) => setWsRoot(e.target.value)}
                      placeholder="workspace root path…"
                      aria-label="Workspace root"
                      style={{ flex: 1 }}
                    />
                    <button className="btn" data-testid="explorer-list" onClick={() => void refreshExplorer(wsRoot, '')}>Browse</button>
                    <button className="btn" data-testid="new-entry-btn" onClick={() => setShowNewEntry(!showNewEntry)}>+ New</button>
                  </div>
                  {showNewEntry && (
                    <div style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
                      <input
                        data-testid="new-entry-name"
                        value={newEntryName}
                        onChange={(e) => setNewEntryName(e.target.value)}
                        placeholder="filename or folder name…"
                        aria-label="New entry name"
                        style={{ flex: 1 }}
                        onKeyDown={(e) => { if (e.key === 'Enter') void createEntry(); }}
                      />
                      <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <input
                          type="checkbox"
                          checked={newEntryIsDir}
                          onChange={(e) => setNewEntryIsDir(e.target.checked)}
                        />
                        Folder
                      </label>
                      <button className="btn primary" data-testid="create-entry" onClick={() => void createEntry()}>Create</button>
                      <button className="btn" data-testid="cancel-entry" onClick={() => { setShowNewEntry(false); setNewEntryName(''); }}>Cancel</button>
                    </div>
                  )}
                  <div data-testid="explorer-path">{wsPath || '/'}</div>
                  {wsEntries.map((e) => {
                    const rel = `${wsPath}/${e.name}`.replace(/^\//, '');
                    return (
                    <div key={rel} style={{ display: 'flex', alignItems: 'center' }}>
                      <button
                        data-testid={`file-${e.name}`}
                        className={openFile === rel ? 'active' : ''}
                        style={{ flex: 1, textAlign: 'left' }}
                        onClick={() => {
                          if (e.dir) void refreshExplorer(wsRoot, rel);
                          else void openWsFile(wsRoot, rel);
                        }}
                      >
                        {e.dir ? `${e.name}/` : e.name}
                      </button>
                      <button
                        data-testid={`rename-${e.name}`}
                        onClick={() => void renameEntry(rel)}
                        title="Rename"
                        style={{ fontSize: 10, padding: '2px 4px', marginLeft: 2 }}
                      >
                        ✎
                      </button>
                      <button
                        data-testid={`delete-${e.name}`}
                        onClick={() => void deleteEntry(rel)}
                        title="Delete"
                        style={{ fontSize: 10, padding: '2px 4px', color: 'red' }}
                      >
                        ✕
                      </button>
                    </div>
                    );
                  })}
                  {wsError && <div data-testid="explorer-error">{wsError}</div>}
                  <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                    <input
                      data-testid="search-input"
                      value={searchPat}
                      onChange={(e) => setSearchPat(e.target.value)}
                      placeholder="search pattern…"
                      aria-label="Search pattern"
                      style={{ flex: 1 }}
                    />
                    <button className="btn" data-testid="search-run" onClick={() => void runSearch()}>Search</button>
                    <button className="btn" data-testid="git-refresh" onClick={() => void refreshGit()}>Git</button>
                  </div>
                  <div data-testid="search-hits">
                    {searchHits.slice(0, 20).map((h, i) => (
                      <div key={i} data-testid={`hit-${i}`}>{h.path}:{h.line} — {h.preview}</div>
                    ))}
                  </div>
                  {gitInfo && <div data-testid="git-info">{gitInfo}</div>}
                </div>
                <div className="card code-view">
                  <div data-testid="open-file">{openFile || 'no file open'}</div>
                  <textarea
                    data-testid="code-view"
                    value={openFile ? editorText : NO_FILE_TEXT}
                    onChange={(e) => { setEditorText(e.target.value); }}
                    readOnly={!openFile}
                    rows={18}
                    style={{ width: '100%' }}
                    aria-label="File editor"
                  />
                  {openFile && (
                    <div style={{ display: 'flex', gap: 6, marginTop: 6, alignItems: 'center' }}>
                      <button className="btn primary" data-testid="editor-save" onClick={() => void saveWsFile()}>Save</button>
                      {saveNote && <span data-testid="save-note">{saveNote}</span>}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
          <section
            className="card bottom-dock"
            data-testid="bottom-dock"
            data-state={dockVisible ? 'visible' : 'hidden'}
            aria-label="Bottom runtime dock"
            style={{ marginTop: 10 }}
          >
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 6 }}>
              <strong>Runtime dock</strong>
              <button
                className="btn"
                data-testid="dock-toggle"
                onClick={() => setDockVisible(!dockVisible)}
                aria-expanded={dockVisible}
              >
                {dockVisible ? 'Hide dock' : 'Show dock'}
              </button>
            </div>
            <div data-testid="dock-tabs" role="tablist" aria-label="Bottom dock tabs" style={{ display: dockVisible ? 'flex' : 'none', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
              {DOCK_TABS.map((tab) => (
                <button
                  key={tab}
                  role="tab"
                  aria-selected={dockTab === tab}
                  data-testid={`dock-tab-${tab}`}
                  className={dockTab === tab ? 'active' : ''}
                  onClick={() => setDockTab(tab)}
                >
                  {tab}
                </button>
              ))}
            </div>
            {dockTab !== 'terminal' && (
              <div data-testid={`dock-empty-${dockTab}`} style={{ color: 'var(--muted)', fontSize: 11, display: dockVisible ? 'block' : 'none' }}>
                {DOCK_EMPTY_TEXT[dockTab]} Backend data not connected.
              </div>
            )}
          <div className="card terminal-panel" data-testid="terminal-panel" style={{ display: dockVisible && dockTab === 'terminal' ? 'block' : 'none' }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <strong>Terminal</strong>
              <span className="pill" data-testid="terminal-cwd">{termCwd || 'no session'}</span>
              {termBusy && <span className="pill" data-testid="terminal-busy">running…</span>}
            </div>
            <div data-testid="terminal-history" style={{ marginTop: 8 }}>
              {termHistory.map((h, i) => (
                <div key={i} data-testid={`term-entry-${i}`} style={{ marginBottom: 6 }}>
                  <span className="pill" data-testid={`term-origin-${i}`}>{h.origin === 'agent' ? 'AGENT BRIDGE EXECUTION' : 'USER TERMINAL COMMAND'}</span>
                  <span> </span>
                  <code>{h.command}</code>
                  <span data-testid={`term-exit-${i}`}> [exit {h.exit_code === null || h.exit_code === undefined ? '?' : h.exit_code}]</span>
                  {h.stdout && <pre data-testid={`term-out-${i}`}>{h.stdout}</pre>}
                  {h.stderr && <pre data-testid={`term-err-${i}`}>{h.stderr}</pre>}
                </div>
              ))}
            </div>
            {termError && <div data-testid="terminal-error">{termError}</div>}
            <div className="composer">
              <input
                data-testid="terminal-input"
                value={termInput}
                onChange={(e) => setTermInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void termSend('user'); }}
                placeholder="Run a policy-gated command…"
                aria-label="Terminal command"
              />
              <button className="btn primary" data-testid="terminal-send" onClick={() => void termSend('user')} disabled={termBusy || !termId}>Send</button>
              <button className="btn" data-testid="terminal-send-agent" onClick={() => void termSend('agent')} disabled={termBusy || !termId}>Run as agent</button>
            </div>
          </div>
          </section>
        </section>

        {overlaySidebar && (
          <button
            className="btn"
            data-testid="sidebar-drawer-toggle"
            ref={drawerToggleRef}
            aria-expanded={drawerOpen}
            onClick={() => (drawerOpen ? closeDrawer() : setDrawerOpen(true))}
            title="Toggle contextual sidebar drawer"
          >
            Panel
          </button>
        )}
        <aside
          className={`ai-panel ${aiOpen ? '' : 'collapsed'}${sidebarFocused ? ' focused' : ''}${overlaySidebar ? ' overlay' : ''}`}
          data-testid="right-sidebar"
          data-focused={sidebarFocused ? 'true' : 'false'}
          data-overlay={overlaySidebar ? (drawerOpen ? 'open' : 'closed') : 'none'}
          aria-label="Right contextual workspace"
          style={
            overlaySidebar
              ? { display: drawerOpen ? 'flex' : 'none' }
              : sidebarWidth
                ? { width: sidebarWidth }
                : undefined
          }
        >
        <div data-testid="ai-panel" data-state={aiOpen ? 'expanded' : 'collapsed'}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', width: '100%' }}>
              <div
                className="avatar"
                data-testid="ai-avatar"
                data-state={live?.avatar?.state ?? 'idle'}
                title={`AI avatar (${live?.avatar?.state ?? 'idle'})${live?.avatar?.activity ? ` — ${live.avatar.activity}` : ''}`}
              >AI</div>
            <div className="collapse-only-hidden" style={{ flex: 1 }}>
              <div style={{ fontWeight: 800 }}>Agent Dock</div>
              <div style={{ color: 'var(--muted)', fontSize: 11 }} data-testid="backend-state">{connection}</div>
            </div>
            <button
              className="btn"
              data-testid="sidebar-focus"
              onClick={() => setSidebarFocus(!sidebarFocused)}
              aria-pressed={sidebarFocused}
              title={sidebarFocused ? 'Restore sidebar' : 'Focus sidebar'}
            >
              {sidebarFocused ? 'Restore' : 'Focus'}
            </button>
            <button
              className="btn"
              data-testid="ai-toggle"
              onClick={() => setAiOpen((v) => !v)}
              title={aiOpen ? 'Collapse AI panel' : 'Expand AI panel'}
            >
              {aiOpen ? '⟩' : '⟨'}
            </button>
            </div>
            <div className="collapse-only-hidden" style={{ display: 'flex', gap: 6, alignItems: 'center', width: '100%', marginTop: 8 }}>
              <div role="tablist" aria-label="Right sidebar panels" style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {openPanels
                  .filter((tab) => !detached.includes(tab))
                  .map((tab) => (
                    <button
                      key={tab}
                      role="tab"
                      aria-selected={sidebarTab === tab}
                      data-testid={`sidebar-tab-${tab}`}
                      className={sidebarTab === tab ? 'active' : ''}
                      onClick={() => selectSidebarTab(tab)}
                    >
                      {tab === 'agent' ? 'Agent' : tab.charAt(0).toUpperCase() + tab.slice(1)}
                    </button>
                  ))}
                <button
                  className="btn"
                  data-testid="sidebar-detach"
                  title="Open active panel in a secondary window"
                  onClick={() => detachPanel(sidebarTab)}
                >
                  Detach
                </button>
              </div>
              {detached.length > 0 && (
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }} data-testid="detached-list">
                  {detached.map((id) => (
                    <button
                      key={id}
                      className="btn"
                      data-testid={`reattach-${id}`}
                      title={`Reattach ${id} panel`}
                      onClick={() => reattachPanel(id)}
                    >
                      Reattach {id}
                    </button>
                  ))}
                </div>
              )}
              <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto' }}>
                Width
                <input
                  type="range"
                  min={200}
                  max={640}
                  step={10}
                  value={sidebarWidth ?? 320}
                  data-testid="sidebar-width"
                  aria-label="Right sidebar width"
                  onChange={(e) => setSidebarWidth(Number(e.target.value))}
                />
              </label>
            </div>
          </div>

          <div
            className="collapse-only-hidden"
            data-testid="sidebar-panel-agent"
            role="tabpanel"
            aria-label="Agent panel"
            style={{ display: sidebarTab === 'agent' && openPanels.includes('agent') && !detached.includes('agent') ? 'flex' : 'none', flexDirection: 'column', gap: 10, width: '100%' }}
          >
            <div className="card" style={{ padding: 10 }}>
              <div className="status-row"><span className="k">genesis</span><span className="v" data-testid="genesis-ref">{SHARED_GENESIS_REF}</span></div>
              <div className="status-row"><span className="k">active model</span><span className="v" data-testid="status-model">{status.model}</span></div>
              <div className="status-row"><span className="k">active agent</span><span className="v" data-testid="status-agent">{status.agent}</span></div>
              <div className="status-row"><span className="k">task</span><span className="v" data-testid="status-task">{status.task}</span></div>
            </div>
            <div className="card" style={{ padding: 10 }}>
              <div className="status-row"><span className="k">progress</span><span className="v" data-testid="status-progress">{status.progress === null ? '—' : `${status.progress}%`}</span></div>
              <div className="progress" data-testid="progress-bar"><div style={{ width: `${status.progress}%` }} /></div>
            </div>
            <div className="card" style={{ padding: 10 }} data-testid="models-panel">
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Models ({bridge.models.length})</div>
              {bridge.models.length === 0 && (
                <div style={{ color: 'var(--muted)', fontSize: 11 }} data-testid="models-empty">no inventory yet</div>
              )}
              {bridge.models.slice(0, 12).map((m) => (
                <div className="status-row" key={m.name} data-testid={`model-row-${m.name}`}>
                  <span className="k">{m.name}</span>
                  <span className="v">{m.parameter_size ?? ''}{m.context ? ` · ctx ${m.context}` : ''}{(m.capabilities ?? []).slice(0, 3).join(', ')}</span>
                </div>
              ))}
            </div>
            <div className="card" style={{ padding: 10 }}>
              <div className="status-row"><span className="k">queue</span><span className="v" data-testid="status-queue">{queueDepth} waiting</span></div>
              <div className="status-row"><span className="k">workers</span><span className="v" data-testid="status-workers">{workerCount} registered</span></div>
              <div className="status-row"><span className="k">approvals</span><span className="v" data-testid="status-approvals">{approvalsCount} pending</span></div>
            </div>
            <div className="card" style={{ padding: 10 }}>
              <div className="status-row">
                <span className="k">approval</span>
                <span className={`badge ${status.approval}`} data-testid="status-approval">{status.approval}</span>
              </div>
              <div className="status-row" style={{ marginTop: 8 }}>
                <span className="k">verification</span>
                <span className="badge idle" data-testid="status-verification">idle</span>
              </div>
            </div>
          </div>
          <div
            className="collapse-only-hidden"
            data-testid="sidebar-panel-inspector"
            role="tabpanel"
            aria-label="Inspector panel"
            style={{ display: sidebarTab === 'inspector' && openPanels.includes('inspector') && !detached.includes('inspector') ? 'flex' : 'none', flexDirection: 'column', gap: 10, width: '100%' }}
          >
            <div className="card" style={{ padding: 10 }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Inspector</div>
              <div style={{ color: 'var(--muted)', fontSize: 11 }} data-testid="inspector-empty">
                {openFile ? `Selected file: ${openFile}` : 'Nothing selected — inspector shows contextual details for the current selection.'}
              </div>
            </div>
            {/*
              The human-in-the-loop seam. It owns no canonical state: the
              session, the task and the authority decision all live in Agent
              Bridge. It exists because the inspector could previously only
              display approvals it could never answer.
            */}
            {bridge.connected && (
              <div className="card" style={{ padding: 10 }}>
                <GenesisTaskBar baseUrl={bridge.baseUrl} workspace={wsRoot || 'C:/'} />
              </div>
            )}
            <div className="card" style={{ padding: 10 }} data-testid="inspector-runtime">
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Runtime inspection</div>
              {!bridge.connected && (
                <div style={{ color: 'var(--muted)', fontSize: 11 }} data-testid="inspector-runtime-offline">
                  Bridge disconnected — inspection shows live state only when connected.
                </div>
              )}
              {bridge.connected && (
                <>
                  <div style={{ fontWeight: 700, fontSize: 12, margin: '6px 0 4px' }}>Workers ({(live?.workers ?? []).length})</div>
                  {(live?.workers ?? []).length === 0 && (
                    <div style={{ color: 'var(--muted)', fontSize: 11 }} data-testid="inspector-workers-empty">no workers registered</div>
                  )}
                  {(live?.workers ?? []).slice(0, 12).map((w, i) => (
                    <div className="status-row" key={w.worker ?? w.worker_id ?? i} data-testid={`inspector-worker-${w.worker ?? w.worker_id ?? i}`}>
                      <span className="k">{w.worker ?? w.worker_id ?? `worker-${i}`}</span>
                      <span className="v">{w.state ?? 'unknown'}</span>
                    </div>
                  ))}
                  <div style={{ fontWeight: 700, fontSize: 12, margin: '6px 0 4px' }}>Approvals ({(live?.approvals_pending ?? []).length})</div>
                  {(live?.approvals_pending ?? []).length === 0 && (
                    <div style={{ color: 'var(--muted)', fontSize: 11 }} data-testid="inspector-approvals-empty">no approvals pending</div>
                  )}
                  {(live?.approvals_pending ?? []).slice(0, 12).map((a, i) => (
                    <div className="status-row" key={i} data-testid={`inspector-approval-${i}`}>
                      <span className="k">approval-{i}</span>
                      <span className="v">{typeof a === 'string' ? a : JSON.stringify(a).slice(0, 80)}</span>
                    </div>
                  ))}
                  <div style={{ fontWeight: 700, fontSize: 12, margin: '6px 0 4px' }}>Sessions ({inspectSessions.length})</div>
                  <button data-testid="inspector-sessions-refresh" onClick={() => void refreshInspection()} disabled={inspectLoading}>
                    {inspectLoading ? 'Loading…' : 'Load sessions'}
                  </button>
                  {inspectSessionsError && (
                    <div style={{ color: 'var(--danger, #f66)', fontSize: 11 }} data-testid="inspector-sessions-error">{inspectSessionsError}</div>
                  )}
                  {inspectSessions.length === 0 && !inspectSessionsError && (
                    <div style={{ color: 'var(--muted)', fontSize: 11 }} data-testid="inspector-sessions-empty">no sessions loaded — press Load sessions</div>
                  )}
                  {inspectSessions.slice(0, 12).map((s) => (
                    <button
                      key={s.session_id}
                      data-testid={`inspector-session-${s.session_id}`}
                      onClick={() => void selectInspectSession(s.session_id)}
                      style={{ display: 'block', width: '100%', textAlign: 'left', marginTop: 4 }}
                    >
                      {s.session_id} · {s.status} · {Object.keys(s.tasks).length} tasks
                    </button>
                  ))}
                  {selectedInspectSession && (
                    <div style={{ marginTop: 6 }}>
                      <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 4 }} data-testid="inspector-events-title">
                        Events · {selectedInspectSession} ({inspectEvents.length})
                      </div>
                      {inspectEventsLoading && <div style={{ fontSize: 11 }} data-testid="inspector-events-loading">Loading…</div>}
                      {inspectEventsError && (
                        <div style={{ color: 'var(--danger, #f66)', fontSize: 11 }} data-testid="inspector-events-error">{inspectEventsError}</div>
                      )}
                      {inspectEvents.length === 0 && !inspectEventsLoading && !inspectEventsError && (
                        <div style={{ color: 'var(--muted)', fontSize: 11 }} data-testid="inspector-events-empty">no events recorded</div>
                      )}
                      {inspectEvents.slice(0, 20).map((e, i) => (
                        <div className="status-row" key={i} data-testid={`inspector-event-${i}`}>
                          <span className="v">{e.label}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
          {openPanels
            .filter((id) => id !== 'agent' && id !== 'inspector')
            .map((id) => (
              <div
                key={id}
                className="collapse-only-hidden"
                data-testid={`sidebar-panel-${id}`}
                role="tabpanel"
                aria-label={`${id} panel`}
                style={{ display: sidebarTab === id && !detached.includes(id) ? 'flex' : 'none', flexDirection: 'column', gap: 10, width: '100%' }}
              >
                <div className="card" style={{ padding: 10 }}>
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>
                    {id.charAt(0).toUpperCase() + id.slice(1)}
                  </div>
                  <div style={{ color: 'var(--muted)', fontSize: 11 }} data-testid={`panel-unavailable-${id}`}>
                    {id} surface: backend not connected. No fabricated content is shown.
                  </div>
                </div>
              </div>
            ))}
        </aside>
      </div>

      <footer className="statusbar" data-testid="status-bar">
        <span data-testid="statusbar-model">model: {status.model}</span>
        <span data-testid="statusbar-agent">agent: {status.agent}</span>
        <span data-testid="statusbar-task">task: {status.task} {status.progress === null ? '—' : `${status.progress}%`}</span>
        <span data-testid="statusbar-approval">approval: {status.approval}</span>
        <span data-testid="statusbar-verification">verification: {status.verification}</span>
      </footer>

      {settingsOpen && (
        <div className="card settings-drawer" data-testid="settings-drawer">
          <h3>Settings (slice 1)</h3>
          <div style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 8 }}>Theme foundation from approved references</div>
          <div className="theme-row">
            {THEMES.map((t) => (
              <button
                key={t.id}
                data-testid={`theme-${t.id}`}
                className={theme === t.id ? 'active' : ''}
                onClick={() => setTheme(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div style={{ marginTop: 12 }}>
            <label style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
              Workspace preset (arrangement only — grants no capabilities)
            </label>
            <select
              data-testid="preset-select"
              aria-label="Workspace preset"
              value={presetId}
              onChange={(e) => applyPresetToApp(e.target.value)}
            >
              {Object.values(WORKSPACE_PRESETS).map((preset) => (
                <option key={preset.preset_id} value={preset.preset_id}>
                  {preset.title}
                </option>
              ))}
            </select>
          </div>
          <div style={{ marginTop: 12, display: 'flex', gap: 6 }}>
            <button className="btn" data-testid="layout-reset" onClick={() => resetLayout()}>Reset layout</button>
            <button className="btn" data-testid="settings-close" onClick={() => setSettingsOpen(false)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
