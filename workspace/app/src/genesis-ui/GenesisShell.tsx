import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AvatarInstance, AvatarPreset, CallRecord, ChatMessage, FileNode, LayoutModeId, TaskSummary, TeamMember, TeamMode, TerminalEntry, ThemeId, ViewId } from './types';
import { Button, Panel } from './components/ui';
import { DEFAULT_LAYOUT, DEFAULT_THEME, DEFAULT_VIEW, VIEWS, getLayoutMode, getTheme, isLayoutModeId, isThemeId, isViewId } from './registry';
import { AvatarStage } from './avatar/AvatarStage';
import { Badge, Notice } from './components/ui';
import { TeamPanel, TeamStrip } from './team/TeamViews';
import { CallsView, ChatView, HomeView, SettingsView, WorkView, WorkerDetailView } from './views';
import { DEFAULT_MAIN_AVATAR_ID, DEFAULT_TEAM_MODE, PRESET_MAP, SPECIALIST_PRESETS, resolvePreset } from './fixtures';
import { PLACEHOLDER_RENDERER_ID } from './avatar/renderers';
import { BRIDGE_DEFAULT_BASE } from '../bridge';
import { useGenesisRuntime } from './runtime/useGenesisRuntime';
import { useGenesisChat } from './runtime/useGenesisChat';
import type { GenesisClient, RuntimeBinding, RuntimeConnection, RuntimeSnapshot, RuntimeSource } from './runtime/runtimeTypes';
import './tokens/tokens.css';
import './tokens/components.css';

/**
 * GenesisShell - the scaffold application shell.
 *
 * Responsibilities:
 *   - own view / theme / layout / avatar selection state
 *   - persist those four preferences (view is session-only by design)
 *   - compose the chrome and the active view
 *
 * Deliberately NOT its responsibility: talking to Agent Bridge. The shell is
 * wired to fixtures so the scaffold renders standalone. Every prop the views
 * need is passed in, so swapping fixtures for a real client touches this file
 * only.
 */

const STORAGE_KEY = 'genesis-ui-prefs';

interface StoredPrefs {
  theme?: string;
  layout?: string;
  avatar?: string;
  renderer?: string;
  silent?: boolean;
}

/**
 * Read persisted preferences.
 *
 * Everything is validated on read. A corrupt or stale payload resolves to
 * defaults rather than throwing - the shell must always render something.
 */
function loadPrefs(): StoredPrefs {
  /* istanbul ignore next - localStorage throws in some privacy modes */
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    return parsed as StoredPrefs;
  } catch {
    return {};
  }
}

function savePrefs(prefs: StoredPrefs): void {
  /* istanbul ignore next */
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* Preference persistence is best-effort; failing to save must not
     * break the running app. */
  }
}

const FIXTURE_FILES: FileNode[] = [
  { id: 'f-src', name: 'src', kind: 'folder', children: [{ id: 'f-app', name: 'app.tsx', kind: 'file' }, { id: 'f-tokens', name: 'tokens.css', kind: 'file' }] },
  { id: 'f-readme', name: 'README.md', kind: 'file' },
];

const FIXTURE_TERMINAL: TerminalEntry[] = [
  { id: 't1', time: '10:24', kind: 'command', text: 'npm run dev' },
  { id: 't2', time: '10:24', kind: 'info', text: 'starting dev server' },
  { id: 't3', time: '10:25', kind: 'success', text: 'ready' },
];

const FIXTURE_TASKS: TaskSummary[] = [
  { id: 'k1', label: 'Extract theme tokens', owner: 'Dev', status: 'done' },
  { id: 'k2', label: 'Avatar picker states', owner: 'Lyra', status: 'active' },
  { id: 'k3', label: 'Conference grid layout', owner: 'Nova', status: 'review' },
];

const FIXTURE_MESSAGES: ChatMessage[] = [
  {
    id: 'm1',
    author: 'agent',
    authorName: 'Aether',
    avatarId: 'aether-01',
    timestamp: '10:24',
    body: 'Ready when you are. Pick a view and I will follow you across it.',
    checklist: [
      { id: 'c1', label: 'Tokens extracted', status: 'done' },
      { id: 'c2', label: 'Avatar presets wired', status: 'in-progress' },
      { id: 'c3', label: 'Live renderer connected', status: 'pending' },
    ],
  },
  { id: 'm2', author: 'user', authorName: 'You', timestamp: '10:25', body: 'Show me the team view.' },
];

export interface GenesisShellProps {
  /** Overrides for tests and embedding. Defaults to fixture data. */
  members?: TeamMember[];
  messages?: ChatMessage[];
  initialView?: ViewId;
  /**
   * Runtime binding (P0-A).
   *
   * `fixture` never touches the network and is the default, so the scaffold
   * still runs standalone. `agent_bridge` subscribes to real sessions through
   * `useGenesisRuntime` — the single integration point. Views receive the
   * result as props and never import a client, so switching modes changes
   * where values come from and nothing else.
   */
  runtimeSource?: RuntimeSource;
  /** Agent Bridge base URL. Only read in `agent_bridge` mode. */
  bridgeBaseUrl?: string;
  workspace?: string;
  /** Ask the Bridge for a human approval channel for the session. */
  runtimeInteractive?: boolean;
  /** Injected in tests; defaults to the real genesisBridge client. */
  runtimeClient?: GenesisClient;
}

export function GenesisShell({
  members: membersOverride,
  messages: messagesOverride,
  initialView = DEFAULT_VIEW,
  runtimeSource = 'fixture',
  bridgeBaseUrl = BRIDGE_DEFAULT_BASE,
  workspace = 'workspace/app',
  runtimeInteractive = false,
  runtimeClient,
}: GenesisShellProps) {
  const stored = useMemo(loadPrefs, []);

  /* Debug/embedding aid, also what the live-render QA drives. Lets a harness
   * or a future settings toggle opt a scaffold running in fixture mode into
   * the real Bridge without a rebuild. Absent in normal use, so the default
   * stays fixture and nothing reaches the network unless explicitly asked. */
  const liveOverride = useMemo(() => {
    if (typeof window === 'undefined') return null;
    const flag = (window as unknown as Record<string, unknown>).__GENESIS_RUNTIME_SOURCE__;
    if (flag === 'agent_bridge') return 'agent_bridge';
    if (flag === 'genesis') return 'genesis';
    return null;
  }, []);
  const baseOverride = useMemo(() => {
    if (typeof window === 'undefined') return null;
    const v = (window as unknown as Record<string, unknown>).__GENESIS_RUNTIME_BASE_URL__;
    return typeof v === 'string' ? v : null;
  }, []);
  const effectiveSource = liveOverride ?? runtimeSource;
  const effectiveBase = baseOverride ?? bridgeBaseUrl;

  const runtimeAB = useGenesisRuntime({
    source: effectiveSource === 'genesis' ? 'fixture' : effectiveSource,
    baseUrl: effectiveBase,
    workspace,
    interactive: runtimeInteractive,
    client: runtimeClient,
  });
  const runtimeGenesis = useGenesisChat(effectiveBase, effectiveSource === 'genesis');
  const runtime = effectiveSource === 'genesis' ? runtimeGenesis : runtimeAB;

  const snap = runtime.snapshot;

  /* Explicit prop overrides win, so tests and embedding stay deterministic.
   * Otherwise the binding is the single source of truth for members/tasks/
   * messages in live mode. */
  const members = membersOverride ?? snap.workers;
  const tasks = snap.tasks;

  const [view, setView] = useState<ViewId>(() => (isViewId(initialView) ? initialView : DEFAULT_VIEW));
  /* Single selection state for the whole shell.
   *
   * Selection and drill-down are the same fact: the worker the user has chosen.
   * Two separate ids would let the conference highlight one worker while the
   * detail view showed another, which is exactly the mismatch C1 was raised
   * against. The team strip, the conference grid and worker focus all read
   * this one value.
   *
   * It stays host-driven UI state. Nothing auto-selects a worker on the user's
   * behalf, and clearing it is as valid as setting it. */
  const [workerId, setWorkerId] = useState<string | null>(null);
  const [theme, setTheme] = useState<ThemeId>(() => (isThemeId(stored.theme) ? stored.theme : DEFAULT_THEME));
  const [layout, setLayout] = useState<LayoutModeId>(() => (isLayoutModeId(stored.layout) ? stored.layout : DEFAULT_LAYOUT));
  const [avatarId, setAvatarId] = useState<string>(() => (typeof stored.avatar === 'string' ? stored.avatar : DEFAULT_MAIN_AVATAR_ID));
  const [rendererId, setRendererId] = useState<string>(() => (typeof stored.renderer === 'string' ? stored.renderer : PLACEHOLDER_RENDERER_ID));
  const [mode, setMode] = useState<TeamMode>(() => ({ ...DEFAULT_TEAM_MODE, silentMode: stored.silent === true }));
  const [summoned, setSummoned] = useState<string[]>([]);
  /* Transcript. Seeded from an explicit override when given, otherwise owned
   * entirely by the runtime binding. Live mode appends the user's own message
   * locally and lets the runtime supply everything else. */
  const [localMessages, setLocalMessages] = useState<ChatMessage[]>(messagesOverride ?? []);
  const [sending, setSending] = useState(false);
  const messages = useMemo(
    () => (messagesOverride ? messagesOverride : [...snap.messages, ...localMessages]),
    [localMessages, messagesOverride, snap.messages],
  );
  const [openFileId, setOpenFileId] = useState<string | null>(null);
  const [dockTab, setDockTab] = useState('terminal');
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [activeCallId, setActiveCallId] = useState<string | null>(null);
  const [micOn, setMicOn] = useState(true);
  const [videoOn, setVideoOn] = useState(false);

  const mainAvatar = resolvePreset(avatarId) ?? PRESET_MAP[DEFAULT_MAIN_AVATAR_ID];
  const mainInstance: AvatarInstance = useMemo(() => ({ presetId: mainAvatar.id, presence: 'idle' }), [mainAvatar.id]);
  const layoutDef = getLayoutMode(layout);
  const themeDef = getTheme(theme);
  const worker = useMemo(() => members.find((m) => m.id === workerId) ?? null, [members, workerId]);

  useEffect(() => {
    savePrefs({ theme, layout, avatar: avatarId, renderer: rendererId, silent: mode.silentMode });
  }, [theme, layout, avatarId, rendererId, mode.silentMode]);

  const goTo = useCallback((next: ViewId, id?: string) => {
    if (next === 'worker') {
      if (!id) return;
      setWorkerId(id);
    }
    setView(next);
  }, []);

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      setSending(true);

      /* The user's own message is always local and immediate. */
      const echo: ChatMessage = {
        id: `local-${Date.now()}`,
        author: 'user',
        authorName: 'You',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        body: trimmed,
      };
      setLocalMessages((prev) => [...prev, echo]);

      try {
        if (runtimeSource === 'fixture' && effectiveSource !== 'genesis') {
          /* Fixture mode has no backend and says so. The echo above stands on
           * its own; nothing pretends a run happened. */
          return;
        }
        /* Live mode: submit through the Bridge. The runtime decides what
         * actually happens, and the next poll brings back what it reported. */
        await runtime.submit(trimmed);
      } finally {
        setSending(false);
      }
    },
    [runtime, runtimeSource],
  );

  const startCall = useCallback((member: TeamMember, kind: 'voice' | 'video') => {
    const record: CallRecord = {
      id: `call-${Date.now()}`,
      peerId: member.id,
      peerName: member.name,
      kind,
      direction: 'outgoing',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      /* A static placeholder label, NOT a running timer. */
      durationLabel: '00:00',
    };
    setCalls((prev) => [record, ...prev]);
    setActiveCallId(record.id);
  }, []);

  const endCall = useCallback(() => setActiveCallId(null), []);

  const summon = useCallback((preset: AvatarPreset) => {
    setSummoned((prev) => (prev.includes(preset.id) ? prev : [...prev, preset.id]));
  }, []);

  const common = { mainAvatar, mainInstance, members, presets: PRESET_MAP, mode, goTo, runtime };

  const body = (() => {
    switch (view) {
      case 'home':
        return <HomeView {...common} tasks={tasks} runtime={runtime} />;
      case 'chat':
        return <ChatView {...common} messages={messages} onSend={sendMessage} sending={sending} runtime={runtime} />;
      case 'work':
        /* Files and terminal stay fixture-backed: the Bridge's workspace and
           terminal clients already exist in `bridge.ts` and are wired into the
           outer shell, but routing them through genesis-ui is a separate unit.
           Saying so beats implying these files are live. */
        return (
          <WorkView
            {...common}
            files={FIXTURE_FILES}
            terminal={FIXTURE_TERMINAL}
            openFileId={openFileId}
            onOpenFile={setOpenFileId}
            dockTab={dockTab}
            onDockTab={setDockTab}
          />
        );
      case 'team':
        return (
          <TeamPanel
            members={members}
            presets={PRESET_MAP}
            specialists={SPECIALIST_PRESETS}
            summonedIds={summoned}
            mode={mode}
            selectedId={workerId}
            onSelectMember={(m) => setWorkerId(m.id)}
            onOpenWorker={(m) => goTo('worker', m.id)}
            onSummon={summon}
            onModeChange={setMode}
            onEndSession={runtime.disconnect}
            canEnd={snap.connection === 'connected'}
          />
        );
      case 'worker':
        return <WorkerDetailView {...common} member={worker} />;
      case 'calls':
        return (
          <CallsView
            {...common}
            calls={calls}
            activeCallId={activeCallId}
            onStartCall={startCall}
            onEndCall={endCall}
            micOn={micOn}
            videoOn={videoOn}
            onToggleMic={() => setMicOn((v) => !v)}
            onToggleVideo={() => setVideoOn((v) => !v)}
          />
        );
      case 'settings':
        return (
          <SettingsView
            {...common}
            theme={theme}
            onTheme={(id) => isThemeId(id) && setTheme(id)}
            layout={layout}
            onLayout={(id) => isLayoutModeId(id) && setLayout(id)}
            onAvatar={(p) => setAvatarId(p.id)}
            onModeChange={setMode}
            rendererId={rendererId}
            onRenderer={setRendererId}
          />
        );
      default:
        return <HomeView {...common} tasks={FIXTURE_TASKS} />;
    }
  })();

  /* Focus mode is genuinely chrome-free: the shell renders the single worker
   * full-screen and nothing else, which is what the layout promises. */
  if (layoutDef.immersive && view === 'worker' && worker) {
    const preset = PRESET_MAP[worker.avatarId];
    return (
      <div className="gx-root" data-genesis-theme={theme} data-genesis-layout={layout} data-testid="genesis-focus">
        <div className="gx-shell">
          <div className="gx-body">
            <Panel testId="focus-panel" className="gx-grow">
              <div className="gx-call">
                {preset ? (
                  <AvatarStage preset={preset} instance={{ presetId: preset.id, presence: 'idle' }} size="3xl" captionLevel="h1" />
                ) : (
                  <Notice tone="warning">No avatar mapped to this worker.</Notice>
                )}
                <div className="gx-row">
                  <Badge tone="accent">{worker.role}</Badge>
                  <Badge tone="neutral">{worker.status}</Badge>
                </div>
                <Notice>Focus mode. One worker, full screen. Audio and video are not part of this scaffold.</Notice>
                <Button onClick={() => setLayout('standard')}>Exit focus</Button>
              </div>
            </Panel>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="gx-root"
      data-genesis-theme={theme}
      data-genesis-layout={layout}
      /* Honest state, readable from the DOM: which mode, which connection,
         and whether the values on screen are current. */
      data-runtime-source={snap.source}
      data-runtime-connection={snap.connection}
      data-runtime-fresh={snap.fresh ? 'true' : 'false'}
      data-renderer={rendererId}
      data-testid="genesis-shell"
    >
      <div className="gx-shell">
        <header className="gx-header">
          <div className="gx-header__brand">
            <span className="gx-brand-mark" aria-hidden="true">
              G
            </span>
            <span className="gx-brand-text">
              <strong>Genesis</strong>
              <span>Aetherius avatar shell</span>
            </span>
          </div>

          <nav className="gx-header__nav" aria-label="Primary">
            {VIEWS.map((v) => (
              <button
                key={v.id}
                type="button"
                className="gx-navbtn"
                aria-current={view === v.id ? 'page' : undefined}
                onClick={() => goTo(v.id)}
                data-testid={`nav-${v.id}`}
              >
                <span aria-hidden="true">{v.glyph}</span>
                {v.label}
              </button>
            ))}
          </nav>

          <div className="gx-header__right">
            <Badge tone="neutral" title="Theme">
              {themeDef.label}
            </Badge>
            <Badge tone="neutral" title="Layout density">
              {layoutDef.label}
            </Badge>
            <span className="gx-row">
              {!mode.silentMode && <AvatarStage preset={mainAvatar} instance={mainInstance} size="sm" caption={false} statePill={false} rings={false} />}
            </span>
          </div>
        </header>

        <div className="gx-body">
          {!layoutDef.immersive && (
            <nav className="gx-rail" aria-label="Views">
              <div className="gx-rail__group">
                {VIEWS.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    className="gx-railbtn"
                    aria-current={view === v.id ? 'page' : undefined}
                    onClick={() => goTo(v.id)}
                    data-testid={`rail-${v.id}`}
                  >
                    <span className="gx-railbtn__glyph" aria-hidden="true">
                      {v.glyph}
                    </span>
                    <span className="gx-railbtn__label">{v.label}</span>
                  </button>
                ))}
              </div>
              <div className="gx-rail__group">
                <button type="button" className="gx-railbtn" onClick={() => goTo('settings')} data-testid="rail-appearance">
                  <span className="gx-railbtn__glyph" aria-hidden="true">
                    ◐
                  </span>
                  <span className="gx-railbtn__label">Theme</span>
                </button>
              </div>
            </nav>
          )}

          <div className="gx-scroll gx-grow">{body}</div>
        </div>

        {/* Persistent team strip - present in every team-aware view. */}
        {view !== 'settings' && view !== 'calls' && (
          <div style={{ flexShrink: 0 }}>
            <TeamStrip
              members={members}
              selectedId={workerId}
              onSelect={(m) => goTo('worker', m.id)}
              presets={PRESET_MAP}
              mode={mode}
            />
          </div>
        )}

        <footer className="gx-statusbar">
          {/*
            The runtime line is the honest one. In fixture mode it says
            fixture and the dot is neutral, because nothing is connected. In
            live mode it reports the real connection state and turns amber when
            values are stale. It never shows green unless the Bridge answered.
          */}
          <span className="gx-statusbar__item" data-testid="status-runtime">
            <span className={`gx-dot gx-dot--${runtimeDot(snap.connection)}`} aria-hidden="true" />
            runtime {runtimeLabel(snap)}
          </span>
          <span className="gx-statusbar__item">theme {theme}</span>
          <span className="gx-statusbar__item">layout {layout}</span>
          <span className="gx-statusbar__item" data-testid="status-renderer">
            renderer {rendererId} (not live)
          </span>
          <span className="gx-statusbar__spacer" />
          <span className="gx-statusbar__item">workers {members.length}</span>
          <span className="gx-statusbar__item">{mode.silentMode ? 'silent' : 'full'}</span>
        </footer>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Runtime status presentation
 *
 * Small pure functions so the mapping is testable without rendering, and so
 * "green" can only ever be reached through a real connected state.
 * ------------------------------------------------------------------------ */

/** Green is reserved for a live connection the Bridge actually confirmed. */
export function runtimeDot(connection: RuntimeConnection): 'success' | 'warning' | 'danger' | 'none' {
  switch (connection) {
    case 'connected':
      return 'success';
    case 'connecting':
    case 'reconnecting':
      return 'warning';
    case 'error':
      return 'danger';
    case 'disconnected':
    default:
      return 'none';
  }
}

export function runtimeLabel(snap: RuntimeSnapshot): string {
  if (snap.source === 'genesis') {
    switch (snap.connection) {
      case 'connected': return 'genesis: connected';
      case 'connecting': return 'genesis: connecting';
      case 'error': return snap.error ? `genesis: error - ${snap.error}` : 'genesis: error';
      case 'disconnected': default: return snap.error ? `genesis: disconnected - ${snap.error}` : 'genesis: disconnected';
    }
  }
  if (snap.source === 'fixture') return 'fixture (not connected)';
  switch (snap.connection) {
    case 'connected':
      /* Connected but the data is a retained snapshot, e.g. the last poll
       * failed after a good one. Say so rather than implying liveness. */
      return snap.fresh ? `agent bridge: ${snap.sessionStatus || 'connected'}` : 'agent bridge: connected (stale)';
    case 'connecting':
      return 'agent bridge: connecting';
    case 'reconnecting':
      return 'agent bridge: reconnecting';
    case 'error':
      return snap.error ? `agent bridge: error - ${snap.error}` : 'agent bridge: error';
    case 'disconnected':
    default:
      return snap.error ? `agent bridge: disconnected - ${snap.error}` : 'agent bridge: disconnected';
  }
}

export default GenesisShell;