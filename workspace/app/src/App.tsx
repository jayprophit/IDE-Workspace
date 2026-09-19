import { useEffect, useState } from 'react';
import type { ThemeId, WorkspaceMode } from './types';
import { fetchBridgeStatus, type BridgeStatus, bridgeBase, createTerminalSession, execTerminal, fetchTerminalSession, type TerminalEntryView, listWorkspace, readWorkspaceFile, writeWorkspaceFile, searchWorkspace, gitWorkspace, createWorkspaceEntry, deleteWorkspaceEntry, renameWorkspaceEntry, type WorkspaceEntry } from './bridge';

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

const FILES: Record<string, string> = {
  '/src/App.tsx': `// IDE_NAME_TBD — slice 1\n// Provenance: fresh file for vertical slice (layout concepts only\n// adapted from references/vibe-prototype App.tsx/Header.tsx).\nexport function workspace() {\n  return 'universal workspace ready';\n}\n`,
  '/src/agent.ts': `// Future Agent Bridge client seam (not wired in slice 1).\nexport const AGENT_SEAM = 'DefaultAgent via Agent Bridge v0.8.1';\n`,
  '/README.md': `# IDE_NAME_TBD slice 1\nShell-only vertical slice. No backend. Mock agent state.\n`,
};

const THEMES: { id: ThemeId; label: string }[] = [
  { id: 'dark', label: 'Dark' },
  { id: 'frost', label: 'Frost' },
  { id: 'aurora', label: 'Aurora' },
  { id: 'amber', label: 'Amber' },
];

export default function App() {
  const [mode, setMode] = useState<WorkspaceMode>('code');
  const [aiOpen, setAiOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [theme, setTheme] = useState<ThemeId>('dark');
  const [activeFile, setActiveFile] = useState('/src/App.tsx');
  const [messages, setMessages] = useState<{ from: 'agent' | 'user'; text: string }[]>([
    { from: 'agent' as const, text: 'Shell slice 1 ready. Agent Bridge wiring comes in the next milestone.' },
  ]);
  const [draft, setDraft] = useState('');

  // Live Agent Bridge status when reachable; honest fallback labels stay
  // visible while disconnected (never fake live data).
  const bridge = useBridgeStatus();
  const live = bridge.connected ? bridge.runtime : null;
  const firstTask = live?.tasks?.[0];
  const status = {
    model: live?.active_model || 'hhao/qwen2.5-coder-tools:3b (planned)',
    agent: firstTask?.worker || 'DefaultAgent (planned)',
    task: firstTask?.objective || firstTask?.task_id || 'slice-1 shell demo',
    progress: firstTask?.progress_pct ?? live?.progress_pct ?? 38,
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
      setMessages((m) => [...m, { from: 'agent' as const, text: `Noted: "${text}". Backend/agent execution is out of scope for slice 1.` }]);
    }, 250);
  };

  return (
    <div className="shell" data-theme={theme} data-testid="shell-root">
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
              {mode === 'chat' ? 'Universal Workspace — Chat mode' : 'Universal Workspace — Code mode'}
            </strong>
            <span className="pill">mode: {mode}</span>
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
                    placeholder="Type a message (mock)…"
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
                  <div data-testid="open-file">{openFile || activeFile}</div>
                  <textarea
                    data-testid="code-view"
                    value={openFile ? editorText : FILES[activeFile]}
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
          <div className="card terminal-panel" data-testid="terminal-panel" style={{ marginTop: 10 }}>
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

        <aside
          className={`ai-panel ${aiOpen ? '' : 'collapsed'}`}
          data-testid="ai-panel"
          data-state={aiOpen ? 'expanded' : 'collapsed'}
          aria-label="AI agent panel"
        >
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
              data-testid="ai-toggle"
              onClick={() => setAiOpen((v) => !v)}
              title={aiOpen ? 'Collapse AI panel' : 'Expand AI panel'}
            >
              {aiOpen ? '⟩' : '⟨'}
            </button>
          </div>

          <div className="collapse-only-hidden" style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>
            <div className="card" style={{ padding: 10 }}>
              <div className="status-row"><span className="k">active model</span><span className="v" data-testid="status-model">{status.model}</span></div>
              <div className="status-row"><span className="k">active agent</span><span className="v" data-testid="status-agent">{status.agent}</span></div>
              <div className="status-row"><span className="k">task</span><span className="v" data-testid="status-task">{status.task}</span></div>
            </div>
            <div className="card" style={{ padding: 10 }}>
              <div className="status-row"><span className="k">progress</span><span className="v" data-testid="status-progress">{status.progress}%</span></div>
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
        </aside>
      </div>

      <footer className="statusbar" data-testid="status-bar">
        <span data-testid="statusbar-model">model: {status.model}</span>
        <span data-testid="statusbar-agent">agent: {status.agent}</span>
        <span data-testid="statusbar-task">task: {status.task} {status.progress}%</span>
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
            <button className="btn" data-testid="settings-close" onClick={() => setSettingsOpen(false)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
