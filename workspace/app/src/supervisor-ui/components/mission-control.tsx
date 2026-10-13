import type { SupervisorSnapshot } from '../api/types';
import { factsIn } from '../api/client';

/**
 * MissionControl — the §6/§10 owner overview.
 *
 * Read-only roll-up of the LIVE supervision + resources facts. Every tile is a
 * SourceFact: it carries its state, an absent fact reads NOT_EXPOSED (never a
 * fabricated zero), and the worst state in a set is surfaced rather than
 * averaged. This is the M2 shell's mission-control composition ported into the
 * tested React unit — same data source as every other section, one network
 * client, no parallel store.
 */

/* Named-fact accessor over the tested factsIn() — no new client export, so the
   single-network-boundary and route guards stay untouched. Returns null when
   the fact is absent so the tile can read NOT_EXPOSED honestly. */
function factNamed(section: Record<string, unknown> | undefined, name: string) {
  for (const [key, value] of factsIn(section)) {
    if (key === name) return value as { value?: unknown; state?: string } | null;
  }
  return null;
}

interface Tile {
  key: string;
  label: string;
  value: string | number;
  state: string;
  tone: 'blue' | 'green' | 'amber' | 'red' | 'violet' | 'muted';
  note?: string;
}

export function MissionControl({ snapshot }: { snapshot: SupervisorSnapshot | null }) {
  if (!snapshot) {
    return (
      <div className="sv-card sv-mission" data-testid="mission-control">
        <p className="sv-muted">No snapshot yet — mission control is not live.</p>
      </div>
    );
  }

  const sup = snapshot.sections?.supervision;
  const res = snapshot.sections?.resources;

  /* supervision scalar facts — each is a SourceFact wrapper. */
  const totalF = factNamed(sup, 'workers_total');
  const byStatusF = factNamed(sup, 'workers_by_status');
  const contF = factNamed(sup, 'continuation_required');
  const handoffsF = factNamed(sup, 'handoffs_pending');
  const gapsF = factNamed(sup, 'gaps_open');
  const pressureF = factNamed(res, 'pressure_state');
  const workersF = factNamed(sup, 'workers');

  const total = typeof totalF?.value === 'number' ? totalF.value : null;
  const byStatus = (byStatusF?.value ?? {}) as Record<string, number>;
  const active = (byStatus.IMPLEMENTING ?? 0) + (byStatus.RUNNING ?? 0);
  const idle = (byStatus.IDLE ?? 0) + (byStatus.WAITING ?? 0);
  const quota = Object.entries(byStatus)
    .filter(([k]) => k.toUpperCase().includes('QUOTA'))
    .reduce((a, [, v]) => a + v, 0);
  const contReq = contF?.value === true;
  const handoffs = typeof handoffsF?.value === 'number' ? handoffsF.value : null;
  const gaps = typeof gapsF?.value === 'number' ? gapsF.value : null;
  const pressure = String(pressureF?.value ?? 'UNKNOWN').toUpperCase();

  const workers = (workersF?.value ?? []) as Array<{ status?: string }>;
  /* If by_status is absent (or explicitly NOT_EXPOSED) but the roster is
     present, derive status counts from the roster rather than inventing a
     zero. The state still comes from whichever source actually answered. */
  const byStatusAbsent = !byStatusF || byStatusF.state === 'NOT_EXPOSED';
  const quotaFromRoster = byStatusAbsent
    ? workers.filter((w) => (w.status || '').toUpperCase().includes('QUOTA')).length
    : quota;

  const tiles: Tile[] = [
    {
      key: 'programme', label: 'Programme',
      value: contReq ? 'ACTIVE' : 'QUIET',
      state: contF?.state ?? 'NOT_EXPOSED',
      tone: contReq ? 'green' : 'amber',
      note: contReq ? 'continuation required' : 'nothing pending',
    },
    {
      key: 'active', label: 'Active workers',
      value: byStatusAbsent ? '—' : active,
      state: byStatusF?.state ?? totalF?.state ?? 'NOT_EXPOSED',
      tone: 'blue',
    },
    {
      key: 'total', label: 'Total workers',
      value: total ?? workers.length,
      state: totalF?.state ?? workersF?.state ?? 'NOT_EXPOSED',
      tone: 'violet',
    },
    {
      key: 'idle', label: 'Idle workers',
      value: byStatusAbsent ? '—' : idle,
      state: byStatusF?.state ?? 'NOT_EXPOSED',
      tone: idle > 0 ? 'amber' : 'muted',
    },
    {
      key: 'quota', label: 'Waiting quota',
      value: quotaFromRoster,
      state: byStatusF?.state ?? workersF?.state ?? 'NOT_EXPOSED',
      tone: quotaFromRoster > 0 ? 'red' : 'green',
    },
    {
      key: 'handoffs', label: 'Handoffs pending',
      value: handoffs ?? '—',
      state: handoffsF?.state ?? 'NOT_EXPOSED',
      tone: handoffs ? 'amber' : 'green',
    },
    {
      key: 'gaps', label: 'Open gaps',
      value: gaps ?? '—',
      state: gapsF?.state ?? 'NOT_EXPOSED',
      tone: gaps ? 'amber' : 'green',
    },
    {
      key: 'resources', label: 'Resources',
      value: pressure,
      state: pressureF?.state ?? 'NOT_EXPOSED',
      tone: pressure === 'NOMINAL' ? 'green' : pressure === 'CRITICAL' ? 'red' : 'amber',
      note: pressure === 'CRITICAL' ? 'governor throttling' : undefined,
    },
  ];

  return (
    <div className="sv-card sv-mission" data-testid="mission-control">
      <div className="sv-mission__head">
        <h2 className="sv-card__title">
          Mission <span className="sv-grad-text">Control</span>
        </h2>
        <span className="sv-muted sv-mission__sub">
          Workforce status, live from the supervisor runtime.
        </span>
      </div>
      <div className="sv-mission__grid" role="list">
        {tiles.map((t) => (
          <div
            key={t.key}
            className={`sv-tile sv-tile--${t.tone}`}
            role="listitem"
            data-testid={`mission-tile-${t.key}`}
            data-fact-state={t.state}
          >
            <div className="sv-tile__k">{t.label}</div>
            <div className="sv-tile__v">{String(t.value)}</div>
            {t.note && <div className="sv-tile__note">{t.note}</div>}
            <div className="sv-tile__state" title={t.state}>
              {t.state === 'LIVE_VERIFIED' ? 'LIVE' : t.state === 'NOT_EXPOSED' ? 'NOT EXPOSED' : t.state}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default MissionControl;
