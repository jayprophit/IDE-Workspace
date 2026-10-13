import { useMemo, useState } from 'react';
import { presentSections, sectionState } from './api/client';
import { useSupervisor } from './api/useSupervisor';
import { SECTION_LABEL, type SectionId } from './api/types';
import { Announcer, EventFeed, useHealthAnnouncements, useHealthMap } from './components/events';
import { Card, EmptyState, FactChip, Notice, formatAge } from './components/fact';
import { MissionControl } from './components/mission-control';
import {
  AbsentSections,
  CodexSection,
  HiveSection,
  KnowledgeSection,
  LocalModelsSection,
  OpencodeSection,
  Overview,
  RepositoriesSection,
  ResourcesSection,
  SupervisionSection,
  TeamRegistrySection,
} from './components/sections';
import './tokens/tokens.css';

/**
 * SupervisorDashboard — V1.
 *
 * A read-only view over the Agent-Bridge supervisor API. It renders what the
 * backend reports and nothing else:
 *
 *   - every value arrives tagged with a SourceState and is displayed as tagged
 *   - an absent section reads NOT_EXPOSED, not "nothing to report"
 *   - an unreachable API produces an honest disconnected view, not zeros
 *   - the placeholder renderer and the genesis avatar stack are NOT involved;
 *     there is no avatar in this view and none is implied
 *
 * The one thing this view deliberately cannot do is make a degraded fact look
 * healthy. Every aggregate (the Overview roll-up) takes the WORST state in its
 * set, so a single offline source is visible rather than averaged away.
 */

type TabId = 'overview' | 'repositories' | 'runtime' | 'events';

const TABS: { id: TabId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'repositories', label: 'Repositories' },
  { id: 'runtime', label: 'Runtime' },
  { id: 'events', label: 'Events' },
];

export interface SupervisorDashboardProps {
  baseUrl?: string;
  /** Disable the timers entirely. Used by tests and by embedding. */
  enabled?: boolean;
  pollMs?: number;
  eventPollMs?: number;
  initialTab?: TabId;
}

export function SupervisorDashboard({
  baseUrl,
  enabled = true,
  pollMs,
  eventPollMs,
  initialTab = 'overview',
}: SupervisorDashboardProps) {
  const [tab, setTab] = useState<TabId>(initialTab);
  const supervisor = useSupervisor({ baseUrl, enabled, pollMs, eventPollMs });

  const present = useMemo(() => presentSections(supervisor.snapshot), [supervisor.snapshot]);

  /* Health map drives announcements. Built from the same sectionState the
     cards display, so what is spoken matches what is seen. */
  const healthEntries = useMemo(
    () =>
      present.map((id) => ({
        key: id,
        label: SECTION_LABEL[id as SectionId] ?? id,
        state: sectionState(supervisor.snapshot?.sections?.[id]),
      })),
    [present, supervisor.snapshot],
  );
  const announcements = useHealthAnnouncements(useHealthMap(healthEntries));

  const connTone =
    supervisor.connection === 'connected' ? (supervisor.stale ? 'connecting' : 'live') : supervisor.connection === 'unreachable' ? 'down' : 'connecting';

  return (
    <div
      className="sv-root"
      data-supervisor-theme="abyss"
      data-supervisor-density="comfortable"
      data-connection={supervisor.connection}
      data-stale={supervisor.stale ? 'true' : 'false'}
      data-testid="supervisor-dashboard"
    >
      <Announcer messages={announcements} />

      <div className="sv-shell">
        <header className="sv-header">
          <div className="sv-brand">
            <span className="sv-brand__mark" aria-hidden="true">
              S
            </span>
            <span className="sv-brand__text">
              <strong>Supervisor</strong>
              <span data-testid="supervisor-identity">
                {supervisor.snapshot ? supervisor.snapshot.supervisor : 'unknown'} · schema {supervisor.snapshot?.schema_version ?? '?'}
              </span>
            </span>
          </div>

          <nav className="sv-nav" aria-label="Supervisor views">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                className="sv-navbtn"
                aria-current={tab === t.id ? 'page' : undefined}
                onClick={() => setTab(t.id)}
                data-testid={`tab-${t.id}`}
              >
                {t.label}
              </button>
            ))}
          </nav>

          <div className="sv-row">
            {/* The connection chip is the honest one. Green only when the API
                answered AND the last poll succeeded. */}
            <span className="sv-row" data-testid="connection-chip">
              <span className={`sv-dot sv-dot--${connTone}`} aria-hidden="true" />
              <span className="sv-muted">
                {supervisor.connection === 'connected'
                  ? supervisor.stale
                    ? 'connected, last poll failed'
                    : 'live'
                  : supervisor.connection === 'unreachable'
                    ? 'unreachable'
                    : supervisor.connection}
              </span>
            </span>
            <button type="button" className="sv-btn" onClick={supervisor.poll} data-testid="refresh-now">
              Refresh
            </button>
          </div>
        </header>

        <div className="sv-body">
          <div className="sv-view sv-scroll" data-testid={`view-${tab}`}>
            {/* Connection honesty comes before any content, so a reader never
                sees numbers without knowing whether they are current. */}
            {supervisor.connection === 'unreachable' && (
              <Notice tone="down" testId="unreachable-notice">
                The supervisor API is not reachable at {baseUrl}
                {supervisor.error ? ` (${supervisor.error})` : ''}. Nothing below is live.{' '}
                {supervisor.stale ? 'The last known snapshot is shown and marked stale.' : 'No snapshot has been received.'}
              </Notice>
            )}
            {supervisor.connection === 'connected' && supervisor.stale && (
              <Notice tone="warn" testId="stale-notice">
                Connected, but the most recent poll failed. Everything below is the last known snapshot and is marked
                stale — it may no longer be true.
              </Notice>
            )}

            {tab === 'overview' && (
              <>
                {/* §6/§10: the avatar-era owner overview. Mission control is
                    the M2 shell's composition, ported in: it rolls the SAME
                    live supervision/resources facts up into the owner tiles,
                    above the detailed sections. One data source, no new store. */}
                <MissionControl snapshot={supervisor.snapshot} />
                <Overview snapshot={supervisor.snapshot} presentIds={present} />
                {/* Live, wired sections only. Absent ones are collected into a
                    single "Not wired" card below, so one list of them cannot
                    bury the sections that actually have data. */}
                <TeamRegistrySection snapshot={supervisor.snapshot} />
                <SupervisionSection snapshot={supervisor.snapshot} />
                <ResourcesSection snapshot={supervisor.snapshot} />
                <AbsentSections snapshot={supervisor.snapshot} presentIds={present} />
              </>
            )}

            {tab === 'repositories' && (
              <>
                <RepositoriesSection snapshot={supervisor.snapshot} />
                <KnowledgeSection snapshot={supervisor.snapshot} />
                <AbsentSections snapshot={supervisor.snapshot} presentIds={present} />
              </>
            )}

            {tab === 'runtime' && (
              <>
                <OpencodeSection snapshot={supervisor.snapshot} />
                <CodexSection snapshot={supervisor.snapshot} />
                <HiveSection snapshot={supervisor.snapshot} />
                <LocalModelsSection snapshot={supervisor.snapshot} />
                <AbsentSections snapshot={supervisor.snapshot} presentIds={present} />
              </>
            )}

            {tab === 'events' && (
              <Card
                title="Event stream"
                testId="events-card"
                actions={
                  <span className="sv-row">
                    <span className="sv-muted sv-mono" data-testid="event-seq">
                      seq {supervisor.snapshot?.last_event_seq ?? 0}
                    </span>
                    <FactChip state={supervisor.connection === 'connected' ? 'LIVE' : 'OFFLINE'} />
                  </span>
                }
              >
                <EventFeed events={supervisor.events} />
              </Card>
            )}
          </div>
        </div>

        <footer className="sv-statusbar" data-testid="sv-statusbar">
          <span className="sv-row">
            <span className={`sv-dot sv-dot--${connTone}`} aria-hidden="true" />
            {supervisor.connection}
          </span>
          {supervisor.snapshot && (
            <span data-testid="status-generated">
              generated {formatAge((Date.now() - Date.parse(supervisor.snapshot.generated_at)) / 1000 || 0)}
            </span>
          )}
          <span data-testid="status-sections">sections {present.length}</span>
          <span className="sv-statusbar__spacer" />
          <span data-testid="status-events">events {supervisor.events.length}</span>
          <span data-testid="status-session">session {supervisor.snapshot?.session_id || 'none'}</span>
          <span data-testid="status-readonly">read-only view</span>
        </footer>
      </div>
    </div>
  );
}

export default SupervisorDashboard;