import { useState } from 'react';
import type {
  AvatarInstance,
  AvatarPreset,
  CallRecord,
  ChatMessage,
  FileNode,
  TaskSummary,
  TeamMember,
  TeamMode,
  TerminalEntry,
  ViewId,
} from './types';
import { AvatarStage, AvatarChip } from './avatar/AvatarStage';
import { AvatarPicker } from './avatar/AvatarPicker';
import { LAYOUT_MODES, THEMES, getLayoutMode, getTheme } from './registry';
import { Badge, Button, EmptyState, Field, KeyValue, Notice, Panel, Progress, StatusDot, Switch, Tabs } from './components/ui';
import { TeamPanel, TeamStrip } from './team/TeamViews';

/**
 * Core views.
 *
 * Every view is a pure function of props. None of them fetch, none of them
 * invent live state, and none of them claim capability the host has not
 * provided. Where a surface would be empty or would need a backend that is not
 * connected, the view says so.
 */

export interface ViewCommonProps {
  mainAvatar: AvatarPreset;
  mainInstance: AvatarInstance;
  members: TeamMember[];
  presets: Record<string, AvatarPreset>;
  mode: TeamMode;
  goTo: (view: ViewId, workerId?: string) => void;
}

/* ---------------------------------------------------------------------------
 * Home / Dashboard
 * ------------------------------------------------------------------------ */

const LAUNCH_ACTIONS: { id: ViewId; label: string; note: string; glyph: string }[] = [
  { id: 'chat', label: 'Chat', note: 'Talk with your companion', glyph: '◉' },
  { id: 'work', label: 'Work', note: 'Open the work surface', glyph: '◧' },
  { id: 'team', label: 'Teams', note: 'Bring in specialists', glyph: '◍' },
  { id: 'calls', label: 'Calls', note: 'Voice and video', glyph: '☎' },
];

export function HomeView({
  mainAvatar,
  mainInstance,
  members,
  presets,
  mode,
  goTo,
  tasks,
}: ViewCommonProps & { tasks: TaskSummary[] }) {
  const greeting = 'Same AI. A different view.';
  const activeWorkers = members.filter((m) => m.status === 'active' || m.status === 'reviewing').length;

  return (
    <div className="gx-view gx-scroll">
      <Panel className="gx-hero" testId="home-hero">
        <div className="gx-hero__greeting">
          <span className="gx-hint">
            {mode.silentMode ? 'Silent mode is on — avatars are hidden.' : 'Your companion is present in every view.'}
          </span>
          <h2 className="gx-hero__title">{greeting}</h2>
          <span className="gx-hero__sub">
            One avatar across chat, work and calls. Switch views without losing the thread.
          </span>
        </div>

        <div className="gx-col" style={{ alignItems: 'center', gap: 'var(--space-6)' }}>
          {mode.silentMode ? (
            <Notice tone="warning">Avatar hidden by silent mode. Turn it off in Team settings to see {mainAvatar.name}.</Notice>
          ) : (
            <AvatarStage preset={mainAvatar} instance={mainInstance} size="2xl" captionLevel="h3" />
          )}
        </div>
      </Panel>

      <div className="gx-grid gx-grid--4">
        {LAUNCH_ACTIONS.map((a) => (
          <button key={a.id} type="button" className="gx-launch__btn" onClick={() => goTo(a.id)} data-testid={`launch-${a.id}`}>
            <span className="gx-launch__glyph" aria-hidden="true">
              {a.glyph}
            </span>
            <span className="gx-launch__meta">
              <strong>{a.label}</strong>
              <span>{a.note}</span>
            </span>
          </button>
        ))}
      </div>

      <div className="gx-grid gx-grid--3">
        <Panel title="Team" testId="home-team">
          <TeamStrip
            members={members}
            activeId={null}
            onSelect={(m) => goTo('worker', m.id)}
            presets={presets}
            mode={mode}
          />
        </Panel>

        <Panel title="Activity" testId="home-activity">
          <div className="gx-grid gx-grid--4">
            <Stat label="Workers" value={String(members.length)} />
            <Stat label="Active" value={String(activeWorkers)} />
            <Stat label="Tasks" value={String(tasks.length)} />
            <Stat label="Mode" value={mode.silentMode ? 'Silent' : 'Full'} />
          </div>
          {tasks.length === 0 ? (
            <EmptyState title="No tasks" note="Nothing has been submitted in this session." />
          ) : (
            <div className="gx-col" style={{ gap: 'var(--space-3)', marginTop: 'var(--space-5)' }}>
              {tasks.slice(0, 4).map((t) => (
                <div key={t.id} className="gx-row gx-row--between">
                  <span className="gx-truncate">{t.label}</span>
                  <Badge tone={t.status === 'blocked' ? 'danger' : t.status === 'done' ? 'success' : t.status === 'active' ? 'accent' : 'neutral'}>
                    {t.status}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Appearance" testId="home-appearance">
          <div className="gx-col" style={{ gap: 'var(--space-4)' }}>
            <span className="gx-hint">Themes and layout density apply instantly across every view.</span>
            <Button onClick={() => goTo('settings')} testId="home-open-settings">
              Open appearance settings
            </Button>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="gx-col" style={{ gap: 2 }}>
      <span className="gx-mono" style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-heavy)', color: 'var(--text-primary)' }}>
        {value}
      </span>
      <span className="gx-hint">{label}</span>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Chat
 * ------------------------------------------------------------------------ */

export function ChatView({ mainAvatar, mainInstance, mode, messages, onSend, sending }: ViewCommonProps & {
  messages: ChatMessage[];
  onSend: (text: string) => void;
  sending: boolean;
}) {
  const [draft, setDraft] = useState('');

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    onSend(text);
    setDraft('');
  };

  return (
    <div className="gx-chat">
      <div className="gx-chat__stage">
        {mode.silentMode ? (
          <Notice tone="warning">Silent mode. The transcript is unaffected, but {mainAvatar.name} is hidden.</Notice>
        ) : (
          <>
            <AvatarStage preset={mainAvatar} instance={mainInstance} size="2xl" captionLevel="h2" />
            <Notice>Placeholder renderer. This is not a live, animated, or speaking avatar — see the gap list.</Notice>
          </>
        )}
      </div>

      <div className="gx-chat__thread">
        <div className="gx-thread" data-testid="chat-thread">
          {messages.length === 0 ? (
            <EmptyState title="No messages yet" note="Sent messages appear here. Nothing is pre-filled." />
          ) : (
            messages.map((m) => (
              <div key={m.id} className={`gx-msg ${m.author === 'user' ? 'gx-msg--user' : ''}`} data-testid={`msg-${m.id}`}>
                <span className="gx-msg__meta" style={{ alignSelf: 'flex-end', marginBottom: 2 }}>
                  {m.timestamp}
                </span>
                <div className="gx-msg__bubble">
                  <div>{m.body}</div>
                  {m.checklist && m.checklist.length > 0 && (
                    <ul className="gx-col" style={{ gap: 'var(--space-2)', listStyle: 'none', margin: 'var(--space-5) 0 0', padding: 0 }}>
                      {m.checklist.map((c) => (
                        <li key={c.id} className="gx-row" style={{ fontSize: 'var(--text-xs)' }}>
                          <span
                            aria-hidden="true"
                            style={{
                              width: 12,
                              height: 12,
                              borderRadius: 'var(--radius-xs)',
                              border: 'var(--border-width-hair) solid var(--border-default)',
                              background:
                                c.status === 'done' ? 'var(--state-success)' : c.status === 'failed' ? 'var(--state-danger)' : c.status === 'in-progress' ? 'var(--state-warning)' : 'transparent',
                              flexShrink: 0,
                            }}
                          />
                          <span className={c.status === 'done' ? 'gx-muted' : ''}>{c.label}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="gx-msg__meta">{m.authorName}</div>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="gx-composer">
          <textarea
            className="gx-textarea"
            rows={1}
            value={draft}
            placeholder={`Message ${mainAvatar.name}…`}
            aria-label={`Message ${mainAvatar.name}`}
            data-testid="chat-input"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <Button variant="primary" onClick={submit} disabled={sending || !draft.trim()} testId="chat-send">
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Work / IDE
 * ------------------------------------------------------------------------ */

const SAMPLE_CODE = `export function greet(name: string): string {
  // Placeholder buffer content. Not a real file.
  return \`Hello, \${name}\`;
}`;

export function WorkView({
  mainAvatar,
  mainInstance,
  mode,
  files,
  terminal,
  openFileId,
  onOpenFile,
  dockTab,
  onDockTab,
}: ViewCommonProps & {
  files: FileNode[];
  terminal: TerminalEntry[];
  openFileId: string | null;
  onOpenFile: (id: string) => void;
  dockTab: string;
  onDockTab: (tab: string) => void;
}) {
  const flat = flattenFiles(files);
  /* Lookup must use the flattened list, not the top-level array: files live
   * inside folders, and resolving against `files` alone silently failed to
   * find any nested file the explorer had just opened. */
  const openFile = flat.find((f) => f.id === openFileId && f.kind === 'file') ?? null;

  return (
    <div className="gx-ide">
      <Panel title="Explorer" className="gx-ide__explorer" bodyClassName="gx-scroll" testId="ide-explorer">
        {flat.length === 0 ? (
          <EmptyState title="No files" note="Nothing has been loaded into the work surface." />
        ) : (
          flat.map((f) => (
            <button
              key={f.id}
              type="button"
              className="gx-file gx-mono"
              aria-selected={f.id === openFileId}
              onClick={() => onOpenFile(f.id)}
              data-testid={`ide-file-${f.id}`}
            >
              <span aria-hidden="true">{f.kind === 'folder' ? '▸' : '·'}</span>
              <span className="gx-truncate">{f.name}</span>
            </button>
          ))
        )}
      </Panel>

      <div className="gx-ide__main">
        <Panel variant="flush" className="gx-grow" testId="ide-editor">
          <Tabs
            tabs={[{ id: 'editor', label: openFile?.name ?? 'No file open' }]}
            active="editor"
            onSelect={() => undefined}
          />
          {openFile ? (
            <pre className="gx-code" data-testid="ide-code">
              {SAMPLE_CODE}
            </pre>
          ) : (
            <EmptyState title="No file open" note="Select a file from the explorer. This scaffold never fabricates file contents." />
          )}
        </Panel>

        <Panel
          variant="solid"
          className="gx-ide__dock"
          title={
            <span role="tablist">
              {['terminal', 'problems', 'output'].map((t) => (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  aria-selected={dockTab === t}
                  className="gx-tab"
                  onClick={() => onDockTab(t)}
                  data-testid={`dock-${t}`}
                >
                  {t}
                </button>
              ))}
            </span>
          }
          bodyClassName="gx-scroll"
          testId="ide-dock"
        >
          {dockTab !== 'terminal' ? (
            <EmptyState title={`${dockTab} not wired up`} note="This scaffold ships the terminal surface only. Other docks render an honest empty state." />
          ) : terminal.length === 0 ? (
            <EmptyState title="No terminal output" note="Nothing has run in this session." />
          ) : (
            <div className="gx-col gx-mono" style={{ gap: 0 }} data-testid="ide-terminal">
              {terminal.map((e) => (
                <div key={e.id} className="gx-terminal-line" data-kind={e.kind}>
                  <span className="gx-terminal-line__time">{e.time}</span>
                  <span>{e.text}</span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <Panel title={mainAvatar.name} actions={<Badge tone="accent">assistant</Badge>} className="gx-ide__assistant" testId="ide-assistant">
        <div className="gx-col gx-scroll" style={{ gap: 'var(--space-6)' }}>
          {!mode.silentMode && <AvatarStage preset={mainAvatar} instance={mainInstance} size="xl" caption={false} />}
          <Notice>Assistant panel is a scaffold surface. No model is connected and no code is generated here.</Notice>
          <div className="gx-col" style={{ gap: 'var(--space-3)' }}>
            <span className="gx-label">Context</span>
            <KeyValue
              items={[
                ['renderer', mainInstance ? 'placeholder' : 'none'],
                ['live', 'no — placeholder renderer'],
                ['workspace', 'scaffold'],
              ]}
            />
          </div>
        </div>
      </Panel>
    </div>
  );
}

function flattenFiles(nodes: FileNode[]): FileNode[] {
  const out: FileNode[] = [];
  for (const n of nodes) {
    out.push(n);
    if (n.children) out.push(...flattenFiles(n.children));
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * Worker detail
 * ------------------------------------------------------------------------ */

export function WorkerDetailView({ member, presets, goTo, members }: ViewCommonProps & { member: TeamMember | null }) {
  if (!member) {
    return (
      <div className="gx-view">
        <EmptyState
          title="No worker selected"
          note="Choose a participant from the team view to see their detail."
          action={<Button onClick={() => goTo('team')}>Back to team</Button>}
        />
      </div>
    );
  }

  const queue = members.filter((m) => m.id !== member.id).slice(0, 5);
  const preset = member ? presets[member.avatarId] : undefined;

  return (
    <div className="gx-worker">
      <Panel testId="worker-stage">
        <div className="gx-worker__stage">
          {preset ? (
            <AvatarStage
              preset={preset}
              instance={{ presetId: preset.id, presence: 'idle' }}
              size="2xl"
              captionLevel="h2"
            />
          ) : (
            <Notice tone="warning">No avatar is mapped to this worker.</Notice>
          )}
          <div className="gx-row">
            <Badge tone="neutral">{member.status}</Badge>
            <Badge tone="accent">{member.role}</Badge>
          </div>
        </div>
      </Panel>

      <div className="gx-worker__detail">
        <Panel title="Detail" testId="worker-detail">
          <div className="gx-col" style={{ gap: 'var(--space-6)' }}>
            <KeyValue
              items={[
                ['name', member.name],
                ['role', member.role],
                ['status', member.status],
                ['capabilities', member.capabilities.join(', ')],
                ['current task', member.currentTask || 'none'],
              ]}
            />
            {typeof member.progress === 'number' && <Progress value={member.progress} label="Task progress" />}
          </div>
        </Panel>

        <Panel title="Activity" testId="worker-activity">
          {member.recentActivity ? (
            <p className="gx-muted" style={{ margin: 0, lineHeight: 'var(--leading-relaxed)' }}>
              {member.recentActivity}
            </p>
          ) : (
            <EmptyState title="Nothing reported" note="This worker has not reported activity." />
          )}
        </Panel>

        <Panel title="Others in session" testId="worker-others">
          <div className="gx-row gx-wrap">
            {queue.length === 0 ? (
              <span className="gx-hint">No other participants.</span>
            ) : (
              queue.map((m) => (
                <button key={m.id} type="button" className="gx-row" onClick={() => goTo('worker', m.id)} data-testid={`worker-peer-${m.id}`}>
                  {presets[m.avatarId] && <AvatarChip preset={presets[m.avatarId]} size="sm" />}
                  <span className="gx-truncate">{m.name}</span>
                  <StatusDot tone={m.status === 'active' ? 'success' : 'none'} />
                </button>
              ))
            )}
          </div>
        </Panel>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Calls
 * ------------------------------------------------------------------------ */

export function CallsView({
  members,
  presets,
  calls,
  activeCallId,
  onStartCall,
  onEndCall,
  micOn,
  videoOn,
  onToggleMic,
  onToggleVideo,
  mode,
}: ViewCommonProps & {
  calls: CallRecord[];
  activeCallId: string | null;
  onStartCall: (member: TeamMember, kind: 'voice' | 'video') => void;
  onEndCall: () => void;
  micOn: boolean;
  videoOn: boolean;
  onToggleMic: () => void;
  onToggleVideo: () => void;
}) {
  const active = calls.find((c) => c.id === activeCallId) ?? null;
  const activeMember = active ? members.find((m) => m.id === active.peerId) ?? null : null;
  const activePreset = activeMember ? presets[activeMember.avatarId] : undefined;

  return (
    <div className="gx-grid gx-grid--2" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(240px,340px)', height: '100%', minHeight: 0 }}>
      <Panel testId="call-stage" className="gx-grow">
        {!active || !activeMember ? (
          <EmptyState title="No active call" note="Start a call with a participant to see the call surface." />
        ) : mode.silentMode ? (
          <EmptyState title="Call continues without avatars" note="Silent mode hides the avatar. Audio is not part of this scaffold." />
        ) : activePreset ? (
          <div className="gx-call">
            <AvatarStage
              preset={activePreset}
              instance={{ presetId: activePreset.id, presence: 'listening' }}
              size="2xl"
              captionLevel="h2"
            />
            <span className="gx-call__timer gx-mono" data-testid="call-timer">
              {active.durationLabel}
            </span>
            <div className="gx-call__controls">
              <button type="button" className="gx-call__btn" aria-pressed={micOn} onClick={onToggleMic} aria-label="Mute microphone" data-testid="call-mic">
                {micOn ? '●' : '○'}
              </button>
              <button type="button" className="gx-call__btn" aria-pressed={videoOn} onClick={onToggleVideo} aria-label="Toggle video" data-testid="call-video">
                {videoOn ? '▣' : '▢'}
              </button>
              <button type="button" className="gx-call__btn gx-call__btn--end" onClick={onEndCall} aria-label="End call" data-testid="call-end">
                ✕
              </button>
            </div>
            <Notice>
              Call controls are local UI state. No microphone, camera, or audio stream is opened by this scaffold.
            </Notice>
          </div>
        ) : (
          <EmptyState title="No avatar mapped" note="This participant has no avatar preset assigned." />
        )}
      </Panel>

      <div className="gx-col" style={{ minHeight: 0, gap: 'var(--density-gap)' }}>
        <Panel title="Call someone" testId="call-dial">
          <div className="gx-col" style={{ gap: 'var(--space-3)' }}>
            {members.length === 0 ? (
              <EmptyState title="No participants" />
            ) : (
              members.map((m) => (
                <div key={m.id} className="gx-row gx-row--between">
                  <span className="gx-row gx-truncate">
                    {presets[m.avatarId] && <AvatarChip preset={presets[m.avatarId]} size="sm" />}
                    {m.name}
                  </span>
                  <span className="gx-row">
                    <Button size="sm" onClick={() => onStartCall(m, 'voice')} testId={`call-voice-${m.id}`}>
                      Voice
                    </Button>
                    <Button size="sm" onClick={() => onStartCall(m, 'video')} testId={`call-video-${m.id}`}>
                      Video
                    </Button>
                  </span>
                </div>
              ))
            )}
          </div>
        </Panel>

        <Panel title="History" className="gx-grow" testId="call-history">
          {calls.length === 0 ? (
            <EmptyState title="No call history" />
          ) : (
            <div className="gx-col gx-scroll" style={{ gap: 'var(--space-2)' }}>
              {calls.map((c) => (
                <div key={c.id} className="gx-row gx-row--between">
                  <span className="gx-truncate">{c.peerName}</span>
                  <span className="gx-row">
                    <Badge tone={c.direction === 'missed' ? 'danger' : 'neutral'}>{c.kind}</Badge>
                    <span className="gx-hint gx-mono">{c.durationLabel}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Settings / Appearance
 * ------------------------------------------------------------------------ */

export function SettingsView({
  theme,
  onTheme,
  layout,
  onLayout,
  mainAvatar,
  onAvatar,
  mode,
  onModeChange,
  rendererId,
  onRenderer,
}: ViewCommonProps & {
  theme: string;
  onTheme: (id: string) => void;
  layout: string;
  onLayout: (id: string) => void;
  onAvatar: (p: AvatarPreset) => void;
  onRenderer: (id: string) => void;
  onModeChange: (m: TeamMode) => void;
  rendererId: string;
}) {
  const [tab, setTab] = useState('appearance');

  return (
    <div className="gx-settings">
      <Panel variant="solid" testId="settings-nav">
        <div className="gx-col" style={{ gap: 'var(--space-2)' }}>
          {[
            { id: 'appearance', label: 'Appearance' },
            { id: 'avatar', label: 'Avatar' },
            { id: 'team', label: 'Team' },
            { id: 'about', label: 'About' },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              className="gx-navbtn"
              aria-current={tab === t.id ? 'page' : undefined}
              onClick={() => setTab(t.id)}
              data-testid={`settings-tab-${t.id}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </Panel>

      <Panel className="gx-scroll" testId="settings-body">
        {tab === 'appearance' && (
          <>
            <div className="gx-section">
              <div className="gx-section__head">
                <span className="gx-section__title">Theme</span>
                <span className="gx-section__desc">Same layout and behaviour, different skin. Applies to every view immediately.</span>
              </div>
              <div className="gx-themes" data-testid="theme-grid">
                {THEMES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className="gx-theme-card"
                    aria-pressed={theme === t.id}
                    onClick={() => onTheme(t.id)}
                    data-testid={`theme-${t.id}`}
                  >
                    <span className="gx-theme-card__preview" data-theme={t.id} aria-hidden="true" />
                    <span className="gx-theme-card__label">{t.label}</span>
                    <span className="gx-theme-card__note">{t.note}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="gx-section">
              <div className="gx-section__head">
                <span className="gx-section__title">Layout density</span>
                <span className="gx-section__desc">Independent of theme. Focus mode removes all chrome for one worker.</span>
              </div>
              <div className="gx-modes" data-testid="layout-grid">
                {LAYOUT_MODES.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    className="gx-mode-card"
                    aria-pressed={layout === m.id}
                    onClick={() => onLayout(m.id)}
                    data-testid={`layout-${m.id}`}
                  >
                    <span className="gx-mode-card__label">{m.label}</span>
                    <span className="gx-mode-card__note">{m.note}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="gx-section">
              <div className="gx-section__head">
                <span className="gx-section__title">Active theme</span>
              </div>
              <KeyValue items={[['theme', getTheme(theme as never).label], ['layout', getLayoutMode(layout as never).label]]} />
            </div>
          </>
        )}

        {tab === 'avatar' && (
          <>
            <div className="gx-section">
              <div className="gx-section__head">
                <span className="gx-section__title">Renderer</span>
                <span className="gx-section__desc">
                  The renderer is the upgrade seam. A live avatar registers here and every view picks it up without change.
                </span>
              </div>
              <Field label="Active renderer" hint="Only the placeholder is registered. Nothing here animates, lip-syncs, or uses audio.">
                <input className="gx-input" value={rendererId} readOnly data-testid="renderer-input" />
              </Field>
            </div>
            <div className="gx-section">
              <div className="gx-section__head">
                <span className="gx-section__title">Companion</span>
                <span className="gx-section__desc">Currently {mainAvatar.name}. Female, male and neutral presets are all first-class.</span>
              </div>
              <AvatarPicker selectedId={mainAvatar.id} onSelect={onAvatar} />
            </div>
          </>
        )}

        {tab === 'team' && (
          <div className="gx-section">
            <div className="gx-section__head">
              <span className="gx-section__title">Team defaults</span>
              <span className="gx-section__desc">Applied to every view that shows the team.</span>
            </div>
            <div className="gx-col">
              {[
                { key: 'silentMode' as const, label: 'Silent mode', note: 'Hide avatars across all views.' },
                { key: 'observeMode' as const, label: 'Observe mode', note: 'Watch without joining the queue.' },
                { key: 'autoQueue' as const, label: 'Auto queue', note: 'Let the host order speaking turns.' },
              ].map((row) => (
                <div key={row.key} className="gx-section__row">
                  <span className="gx-col" style={{ gap: 1 }}>
                    <span className="gx-section__title">{row.label}</span>
                    <span className="gx-section__desc">{row.note}</span>
                  </span>
                  <Switch
                    checked={mode[row.key]}
                    onChange={(v) => onModeChange({ ...mode, [row.key]: v })}
                    label={row.label}
                    testId={`settings-toggle-${row.key}`}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'about' && (
          <div className="gx-section">
            <div className="gx-section__head">
              <span className="gx-section__title">What this is</span>
              <span className="gx-section__desc">A UI scaffold. Read this before assuming it does more than it does.</span>
            </div>
            <div className="gx-col" style={{ gap: 'var(--space-4)' }}>
              <Notice tone="warning">
                The avatar renderer is a labelled placeholder. There is no animation, no lip sync, no voice and no 3D embodiment
                in this build.
              </Notice>
              <KeyValue
                items={[
                  ['themes', `${THEMES.length} available`],
                  ['layout modes', `${LAYOUT_MODES.length} available`],
                  ['renderer', 'placeholder (not live)'],
                  ['backend', 'not connected'],
                  ['typeface', 'system stacks, no webfont bundled'],
                ]}
              />
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}