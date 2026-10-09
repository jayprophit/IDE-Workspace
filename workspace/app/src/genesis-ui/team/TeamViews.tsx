import type { TeamMember, TeamMode, AvatarPreset, AvatarPresence } from '../types';
import { AvatarChip, AvatarStage } from '../avatar/AvatarStage';
import { SpecialistCard } from '../avatar/AvatarPicker';
import { Badge, Button, EmptyState, Notice, Panel, StatusDot, Switch } from '../components/ui';
import { PresenceAnnouncer } from './PresenceAnnouncer';
import { usePresenceAnnouncements, useRovingGrid } from './useConferenceA11y';

/**
 * Team surfaces.
 *
 * Truth rules encoded here:
 *   - a member with no current task renders "Idle", never a fabricated one
 *   - speaking state comes from the member's status, never a rotation timer
 *   - silent mode hides avatars but keeps the transcript, and says it is on
 *   - observe mode is presented as observation, not as participation
 */

/** Map a worker status onto the avatar presence vocabulary. */
export function presenceOf(member: TeamMember): AvatarPresence {
  switch (member.status) {
    case 'active':
      return 'speaking';
    case 'in-call':
      return 'listening';
    case 'reviewing':
      return 'thinking';
    case 'thinking':
      return 'thinking';
    case 'offline':
      return 'offline';
    case 'idle':
    default:
      return 'idle';
  }
}

export function statusTone(status: TeamMember['status']): 'success' | 'warning' | 'danger' | 'info' | 'none' {
  switch (status) {
    case 'active':
      return 'success';
    case 'in-call':
    case 'reviewing':
    case 'thinking':
      return 'info';
    case 'offline':
      return 'danger';
    case 'idle':
    default:
      return 'none';
  }
}

/**
 * TeamStrip - the persistent horizontal roster.
 *
 * Visible in every team-aware view, per the brief. When silent mode is on the
 * avatars are dropped but the names remain, so you can still see who is in the
 * room without the presence display.
 */
export function TeamStrip({
  members,
  selectedId,
  onSelect,
  presets,
  mode,
}: {
  members: TeamMember[];
  /** The same selection the conference grid and worker detail use. */
  selectedId: string | null;
  onSelect: (member: TeamMember) => void;
  presets: Record<string, AvatarPreset>;
  mode: TeamMode;
}) {
  if (members.length === 0) {
    return (
      <div className="gx-teamstrip">
        <span className="gx-hint">No team loaded. This surface stays empty until the host supplies a roster.</span>
      </div>
    );
  }

  return (
    <div className="gx-teamstrip" data-testid="team-strip" role="list" aria-label="Team roster">
      {members.map((member) => {
        const preset = presets[member.avatarId];
        const speaking = member.status === 'active';
        return (
          <button
            key={member.id}
            type="button"
            role="listitem"
            aria-pressed={member.id === selectedId}
            aria-current={member.id === selectedId ? 'true' : undefined}
            className="gx-teamstrip__member"
            onClick={() => onSelect(member)}
            data-testid={`team-strip-${member.id}`}
          >
            {!mode.silentMode && preset ? (
              <AvatarChip preset={preset} presence={presenceOf(member)} size="md" />
            ) : (
              <span className="gx-avatar gx-avatar--md" data-presence={presenceOf(member)}>
                <span className="gx-avatar__placeholder">
                  <span className="gx-avatar__placeholder-mark">{member.name.slice(0, 2).toUpperCase()}</span>
                </span>
              </span>
            )}
            <span className="gx-teamstrip__name">{member.name}</span>
            {speaking ? (
              <span className="gx-teamstrip__speaking">speaking</span>
            ) : (
              <span className="gx-teamstrip__name gx-muted">{member.role}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * ConferenceGrid - multi-party grid, one tile per member.
 *
 * Selection (`selectedId`) is host-driven: nothing selects itself. The tile
 * exposes selection semantically via `aria-current` and visually via a token-
 * driven accent treatment, so it is distinguishable by more than colour.
 *
 * Keyboard: roving tabindex. Exactly one tile is in the tab order; arrows move
 * between tiles and Tab leaves the grid. Presence announcements are emitted
 * only for host-supplied changes - never inferred.
 */
export function ConferenceGrid({
  members,
  presets,
  onSelect,
  selectedId,
  mode,
}: {
  members: TeamMember[];
  presets: Record<string, AvatarPreset>;
  /** Selects a worker. Deliberately does NOT navigate: selection has to stay
   *  visible in the grid, and navigating on click would hide it immediately. */
  onSelect: (member: TeamMember) => void;
  selectedId?: string | null;
  mode: TeamMode;
}) {
  const grid = useRovingGrid(members.length);
  const announcements = usePresenceAnnouncements(members);

  if (members.length === 0) {
    return <EmptyState title="No participants" note="A conference grid appears once the host reports participants." />;
  }

  return (
    <>
      <PresenceAnnouncer announcements={announcements} />
      <div
        className="gx-conference"
        data-testid="conference-grid"
        /* A composite widget: arrows move within it, Tab leaves it. */
        role="listbox"
        aria-label="Conference participants"
        aria-orientation="horizontal"
      >
        {members.map((member, index) => {
        const preset = presets[member.avatarId];
        const speaking = member.status === 'active';
        const selected = selectedId === member.id;
        return (
          <button
            key={member.id}
            type="button"
            role="option"
            className={`gx-tile${selected ? ' gx-tile--selected' : ''}`}
            data-speaking={speaking}
            data-selected={selected}
            /* Selection is announced semantically, not only drawn. */
            aria-selected={selected}
            aria-current={selected ? 'true' : undefined}
            ref={grid.registerRef(index)}
            tabIndex={grid.tabIndexFor(index)}
            onKeyDown={(e) => grid.onKeyDown(e, index)}
            onClick={() => onSelect(member)}
            data-testid={`conference-tile-${member.id}`}
            aria-label={`${member.name}, ${member.role}${speaking ? ', speaking' : ''}${selected ? ', selected' : ''}`}
          >
            {!mode.silentMode && preset ? (
              <AvatarStage
                preset={preset}
                instance={{ presetId: preset.id, presence: presenceOf(member) }}
                size="2xl"
                caption={false}
                statePill={false}
                rings={false}
              />
            ) : (
              <div className="gx-col" style={{ alignItems: 'center', gap: 'var(--space-3)', flex: 1, justifyContent: 'center' }}>
                <Badge tone={speaking ? 'success' : 'neutral'}>{speaking ? 'Speaking' : 'Avatar hidden'}</Badge>
                <span className="gx-hint">Silent mode is on</span>
              </div>
            )}

            <div className="gx-tile__foot">
              <span className="gx-tile__who">
                <span className="gx-tile__name">{member.name}</span>
                <span className="gx-tile__role">{member.role}</span>
              </span>
              <span className="gx-tile__status">
                <StatusDot tone={statusTone(member.status)} live={member.status !== 'offline' && member.status !== 'idle'} />
                {/* Selection is carried by a text label too, so it never
                    depends on colour alone to be perceivable. */}
                {selected && <Badge tone="accent">Selected</Badge>}
                {speaking && <Badge tone="success">Speaking</Badge>}
              </span>
            </div>

            <span className="gx-tile__task">{member.currentTask || 'No current task'}</span>
          </button>
        );
      })}
      </div>
    </>
  );
}

/** ConversationQueue - who speaks next. */
export function ConversationQueue({ members }: { members: TeamMember[] }) {
  const queued = members
    .filter((m) => typeof m.queuePosition === 'number' && m.status !== 'offline')
    .sort((a, b) => (a.queuePosition ?? 0) - (b.queuePosition ?? 0));

  if (queued.length === 0) {
    return <EmptyState title="No speaking order" note="The host has not assigned a queue. Order appears here when it does." />;
  }

  return (
    <div className="gx-queue" data-testid="conversation-queue">
      {queued.map((member, i) => (
        <div key={member.id} className="gx-queue__row" data-current={i === 0} data-testid={`queue-${member.id}`}>
          <span className="gx-queue__index">{i + 1}</span>
          <StatusDot tone={statusTone(member.status)} />
          <span className="gx-queue__who">{member.name}</span>
          <span className="gx-queue__note gx-truncate">{member.recentActivity}</span>
        </div>
      ))}
    </div>
  );
}

/** Inter-agent log. Renders only what the host actually reported. */
export function TeamActivityLog({ members }: { members: TeamMember[] }) {
  const entries = members.filter((m) => m.recentActivity);
  if (entries.length === 0) {
    return <EmptyState title="No activity reported" note="Nothing has been reported yet." />;
  }
  return (
    <div className="gx-col" style={{ gap: 'var(--space-2)' }} data-testid="team-activity">
      {entries.map((m) => (
        <div key={m.id} className="gx-queue__row" style={{ alignItems: 'flex-start' }}>
          <span className="gx-dot gx-dot--info" aria-hidden="true" />
          <span className="gx-col" style={{ gap: 1, minWidth: 0 }}>
            <span className="gx-queue__who">{m.name}</span>
            <span className="gx-muted" style={{ lineHeight: 'var(--leading-snug)' }}>
              {m.recentActivity}
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}

/** SummonPanel - add a specialist to the roster. */
export function SummonPanel({
  specialists,
  summonedIds,
  onSummon,
}: {
  specialists: AvatarPreset[];
  summonedIds: string[];
  onSummon: (preset: AvatarPreset) => void;
}) {
  return (
    <div className="gx-summon" data-testid="summon-panel">
      {specialists.length === 0 ? (
        <EmptyState title="No specialists available" />
      ) : (
        specialists.map((s) => (
          <SpecialistCard key={s.id} preset={s} onSummon={onSummon} summoned={summonedIds.includes(s.id)} />
        ))
      )}
    </div>
  );
}

/** TeamControls - the meeting toggles, including silent and observe mode. */
export function TeamControls({
  mode,
  onChange,
  onEndSession,
  canEnd,
}: {
  mode: TeamMode;
  onChange: (next: TeamMode) => void;
  onEndSession: () => void;
  canEnd: boolean;
}) {
  const set = (patch: Partial<TeamMode>) => onChange({ ...mode, ...patch });
  return (
    <div className="gx-col" data-testid="team-controls">
      <Notice>
        Meeting controls are local UI state. They do not change who the host has actually admitted to the session.
      </Notice>

      {[
        { key: 'silentMode' as const, label: 'Silent mode (text only)', note: 'Hides avatars. The transcript continues.' },
        { key: 'observeMode' as const, label: 'Observe mode', note: 'Watch without taking a place in the queue.' },
        { key: 'autoQueue' as const, label: 'Auto queue', note: 'Let the host order speaking turns.' },
        { key: 'raiseHand' as const, label: 'Raise hand', note: 'Request the floor rather than taking it.' },
      ].map((row) => (
        <div key={row.key} className="gx-section__row">
          <span className="gx-col" style={{ gap: 1, minWidth: 0 }}>
            <span className="gx-section__title">{row.label}</span>
            <span className="gx-section__desc">{row.note}</span>
          </span>
          <Switch checked={mode[row.key]} onChange={(v) => set({ [row.key]: v })} label={row.label} testId={`team-toggle-${row.key}`} />
        </div>
      ))}

      <Button variant="danger" onClick={onEndSession} disabled={!canEnd} testId="team-end-session">
        End session
      </Button>
      <span className="gx-hint">Ending is offered only when the host reports an active session.</span>
    </div>
  );
}

/** TeamPanel - the team tab body. */
export function TeamPanel({
  members,
  presets,
  specialists,
  summonedIds,
  mode,
  selectedId,
  onSelectMember,
  onOpenWorker,
  onSummon,
  onModeChange,
  onEndSession,
  canEnd,
}: {
  members: TeamMember[];
  presets: Record<string, AvatarPreset>;
  specialists: AvatarPreset[];
  summonedIds: string[];
  mode: TeamMode;
  selectedId: string | null;
  onSelectMember: (m: TeamMember) => void;
  onOpenWorker: (m: TeamMember) => void;
  onSummon: (p: AvatarPreset) => void;
  onModeChange: (m: TeamMode) => void;
  onEndSession: () => void;
  canEnd: boolean;
}) {
  return (
    <div className="gx-view">
      <div className="gx-view__head">
        <div className="gx-col" style={{ gap: 2 }}>
          <h2 className="gx-view__title">Team</h2>
          <span className="gx-view__sub">
            {members.length} participant{members.length === 1 ? '' : 's'}
            {mode.silentMode ? ' · silent mode' : ''}
            {mode.observeMode ? ' · observing' : ''}
          </span>
        </div>
        {selectedId && members.some((m) => m.id === selectedId) && (
          <Button onClick={() => onOpenWorker(members.find((m) => m.id === selectedId)!)}>Open worker detail</Button>
        )}
      </div>

      <Panel title="Conference" bodyClassName="gx-scroll" className="gx-grow" testId="conference-panel">
        {/*
          A tile click SELECTS; it does not navigate. Selection has to be
          visible in the grid to be useful, and navigating away on click would
          hide it the moment it was made. Drill-down is the explicit
          "Open worker detail" action below, which is enabled only once a
          worker is selected.
        */}
        <ConferenceGrid
          members={members}
          presets={presets}
          onSelect={onSelectMember}
          selectedId={selectedId}
          mode={mode}
        />
      </Panel>

      <div className="gx-grid gx-grid--3">
        <Panel title="Speaking queue" testId="queue-panel">
          <ConversationQueue members={members} />
        </Panel>
        <Panel title="Recent activity" testId="activity-panel">
          <TeamActivityLog members={members} />
        </Panel>
        <Panel title="Session controls" testId="controls-panel">
          <TeamControls mode={mode} onChange={onModeChange} onEndSession={onEndSession} canEnd={canEnd} />
        </Panel>
      </div>

      <Panel title="Summon a specialist" testId="summon-wrap">
        <SummonPanel specialists={specialists} summonedIds={summonedIds} onSummon={onSummon} />
      </Panel>
    </div>
  );
}