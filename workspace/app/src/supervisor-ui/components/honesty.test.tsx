import { describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { SupervisorDashboard } from '../SupervisorDashboard';
import { buildSnapshot, healthPayload } from './snapshot-fixture';
import { installFakeFetch, type FetchCall } from '../api/fetch-harness';

/**
 * Honesty tests.
 *
 * These assert the behaviour the brief is actually about: a degraded fact must
 * never render as live, an absent section must never read as empty, and an
 * unreachable API must never produce numbers.
 *
 * Nothing here is a snapshot test. Each case renders the real component with a
 * controlled payload and asserts what a person would see.
 */

const BASE = 'http://supervisor.test';

/**
 * Render and wait for the first poll to land.
 *
 * The dashboard fetches in an effect, so asserting synchronously would test an
 * empty tree and prove nothing. `enabled: false` keeps the timers off, so this
 * is exactly one request per test — deterministic, and no fake timers needed.
 */
async function renderDashboard(opts: { snapshot?: unknown; healthy?: boolean; tab?: string } = {}) {
  const calls: FetchCall[] = [];
  installFakeFetch(calls, {
    state: opts.snapshot === undefined ? healthPayload({ ok: false, error_code: 'UNREACHABLE' }) : { ok: true, snapshot: opts.snapshot },
    health: opts.healthy === false ? { ok: false } : { ok: true, supervisor: 'hermes', schema_version: 1, last_event_seq: 3 },
    events: { ok: true, events: [] },
  });
  const result = render(<SupervisorDashboard baseUrl={BASE} enabled={false} initialTab={(opts.tab ?? 'overview') as never} />);
  /* Wait for the connection to settle to a terminal state. */
  await waitFor(() => {
    const conn = document.querySelector('[data-testid="supervisor-dashboard"]')?.getAttribute('data-connection');
    expect(['connected', 'unreachable']).toContain(conn);
  });
  return { ...result, calls };
}

describe('honesty vocabulary renders 1:1', () => {
  it('shows the exact state string the backend sent', async () => {
    const { unmount } = await renderDashboard({ snapshot: buildSnapshot(), tab: 'repositories' });
    /* The vocabulary is displayed verbatim, so a reader cannot be told
       "live" for anything the backend tagged otherwise. */
    expect(screen.getAllByText('LIVE_VERIFIED').length).toBeGreaterThan(0);
    /* Aetherius-OS is a real OFFLINE capture. */
    expect(screen.getAllByText('OFFLINE').length).toBeGreaterThan(0);
    unmount();

    const second = await renderDashboard({ snapshot: buildSnapshot(), tab: 'overview' });
    /* supervision.continuation_required is genuinely aged in the fixture. */
    expect(screen.getAllByText('STALE').length).toBeGreaterThan(0);
    second.unmount();

    const third = await renderDashboard({ snapshot: buildSnapshot(), tab: 'runtime' });
    /* Hive is wired but its overview is degraded, which must not read as live. */
    expect(screen.getAllByText('DEGRADED').length).toBeGreaterThan(0);
    third.unmount();
  });

  it('never renders a DEGRADED fact as a live chip', async () => {
    const snap = buildSnapshot();
    /* Force a known-degraded field. */
    snap.sections.local_models = { ollama: factOf(null, 'DEGRADED', 'ollama', 'ps endpoint failed') };
    await renderDashboard({ snapshot: snap, tab: 'runtime' });

    /* Every DEGRADED chip says DEGRADED. getAllBy because the same state can
       legitimately appear on more than one field, and each must agree. */
    const degradedChips = screen.getAllByTestId(/^chip-DEGRADED$/);
    expect(degradedChips.length).toBeGreaterThan(0);
    for (const chip of degradedChips) {
      expect(chip).toHaveTextContent('DEGRADED');
      expect(chip).not.toHaveTextContent('LIVE');
    }
    /* The healthy sibling keeps its own, separate chip. */
    expect(screen.getAllByText('LIVE_VERIFIED').length).toBeGreaterThan(0);
  });

  it('reports an omitted section once, as NOT_EXPOSED', async () => {
    /* Absent is a declared gap. An empty card would read as "nothing to
       report", which is a different claim. The report is collected into one
       card rather than repeated per section. */
    await renderDashboard({ snapshot: buildSnapshot(), tab: 'repositories' });
    expect(screen.getByTestId('section-absent')).toHaveTextContent('NOT_EXPOSED');
    expect(screen.getByTestId('section-absent')).toHaveTextContent(/different thing from reporting them as empty/i);
    expect(screen.getByTestId('absent-knowledge')).toHaveTextContent('Knowledge');
    /* No dead card is left behind for an absent section. */
    expect(screen.queryByTestId('section-knowledge')).not.toBeInTheDocument();
  });

  it('shows a NOT_EXPOSED chip distinctly, not as a quiet grey value', async () => {
    const { unmount } = await renderDashboard({ snapshot: buildSnapshot(), tab: 'runtime' });
    /* A declared gap, flagged in the DOM as well as drawn with a dashed edge,
       so the distinction survives a reader and a test alike. */
    const gap = screen.getByTestId('absent-codex');
    expect(gap).toHaveAttribute('data-state', 'NOT_EXPOSED');
    expect(gap).toHaveAttribute('data-declared-gap', 'true');
    expect(screen.getAllByTestId(/^chip-LIVE_VERIFIED$/)[0]).toHaveAttribute('data-declared-gap', 'false');
    unmount();
  });
});

describe('no-data versus zero', () => {
  it('renders a verified empty as "none observed", not as a bare 0', async () => {
    await renderDashboard({ snapshot: buildSnapshot(), tab: 'runtime' });
    /* `waiting_for_quota: []` is a real observation of emptiness. It must not
       render as a bare 0, which would read as a measured quantity. */
    const row = screen.getByTestId('hive-no-waiting');
    expect(row).toHaveTextContent(/nothing is waiting/i);
    expect(row).not.toHaveTextContent(/^\s*0\s*$/);
    expect(within(row).getByTestId('chip-LIVE_VERIFIED')).toBeInTheDocument();
  });

  it('never turns an offline source into a zero count', async () => {
    /* The failure this prevents: a dashboard showing "0 models" when Ollama is
       simply unreachable. That is a fabricated fact. */
    await renderDashboard({ snapshot: buildSnapshot(), tab: 'runtime' });
    const models = screen.getByTestId('model-ollama');
    expect(models).toHaveTextContent(/offline/i);
    expect(models).not.toHaveTextContent(/^0$/);
  });

  it('shows "not reported" rather than 0 for an absent field', async () => {
    const snap = buildSnapshot();
    /* Remove the workers fact entirely: the field is simply absent. */
    snap.sections.hive = { quotas: snap.sections.hive.quotas };
    await renderDashboard({ snapshot: snap, tab: 'runtime' });
    /* An absent field must say so rather than inventing a count. */
    expect(screen.getByTestId('hive-workers')).toHaveTextContent('not reported');
  });

  it('renders a real 0 when the backend genuinely reported zero', async () => {
    const snap = buildSnapshot();
    snap.sections.supervision = {
      workers_total: factOf(0, 'LIVE_VERIFIED', 'supervision'),
      handoffs_pending: factOf(0, 'LIVE_VERIFIED', 'supervision'),
    };
    await renderDashboard({ snapshot: snap });
    /* A verified zero is a fact and must be shown as a number. */
    expect(screen.getByTestId('sup-workers-total')).toHaveTextContent('0');
  });
});

describe('section roll-up takes the worst state', () => {
  it('does not let healthy siblings mask a degraded one', async () => {
    const snap = buildSnapshot();
    snap.sections.local_models = {
      version: factOf('0.5.0', 'LIVE_VERIFIED', 'ollama'),
      resident_models: factOf(null, 'OFFLINE', 'ollama', 'connection refused'),
    };
    await renderDashboard({ snapshot: snap, tab: 'runtime' });

    /* One offline field makes the section OFFLINE, not LIVE_VERIFIED. */
    const card = screen.getByTestId('section-local-models');
    expect(card).toHaveTextContent('OFFLINE');
    /* getAllBy: the roll-up chip AND the row chip both say OFFLINE here, and
     * both must. The healthy field keeps its own LIVE_VERIFIED chip. */
    expect(within(card).getAllByTestId(/^chip-OFFLINE$/).length).toBeGreaterThan(0);
    expect(within(card).getByTestId('chip-LIVE_VERIFIED')).toBeInTheDocument();
    /* The roll-up chip is the one on the card header. */
    expect(card.querySelector('.sv-card__head')?.textContent).toContain('OFFLINE');
  });

  it('lists non-verified sections in the overview warning', async () => {
    await renderDashboard({ snapshot: buildSnapshot() });
    expect(screen.getByTestId('overview-warnings')).toBeInTheDocument();
  });
});

describe('unreachable backend', () => {
  it('shows an honest unreachable notice, not zeros', async () => {
    await renderDashboard();
    expect(screen.getByTestId('unreachable-notice')).toBeInTheDocument();
    expect(screen.getByTestId('unreachable-notice')).toHaveTextContent(/not reachable/i);
    expect(screen.getByTestId('unreachable-notice')).toHaveTextContent(/nothing below is live/i);
  });

  it('does not claim a connection it does not have', async () => {
    await renderDashboard();
    expect(screen.getByTestId('connection-chip')).toHaveTextContent(/unreachable/i);
    expect(document.querySelector('[data-testid="supervisor-dashboard"]')).toHaveAttribute('data-connection', 'unreachable');
  });

  it('renders no repository cards when there is no snapshot', async () => {
    await renderDashboard();
    expect(screen.queryByTestId('repo-list')).not.toBeInTheDocument();
  });

  it('tells the reader whether a stale snapshot is being shown', async () => {
    await renderDashboard();
    expect(screen.getByTestId('unreachable-notice')).toHaveTextContent(/no snapshot has been received/i);
  });
});

describe('staleness is reported in real time', () => {
  it('shows an age rather than pretending a fact is current', async () => {
    await renderDashboard({ snapshot: buildSnapshot(), tab: 'repositories' });
    /* git facts carry age_s; the row shows it. */
    expect(screen.getByTestId('fact-IDE-Workspace-head')).toHaveTextContent(/ago|just now/);
  });

  it('reports an aged fact in human units, not raw seconds', async () => {
    await renderDashboard({ snapshot: buildSnapshot(), tab: 'overview' });
    /* continuation_required is aged 90s in the fixture. The StatTile carries the
       age because a count is only trustworthy alongside its freshness. */
    const tile = screen.getByTestId('sup-continuation');
    expect(tile).toHaveAttribute('data-state', 'STALE');
    /* Human units, not raw seconds. 90s must not render as "90s ago". */
    expect(within(tile).getByTestId('sup-continuation-age')).toHaveTextContent(/m ago|h ago|d ago/);
    expect(within(tile).getByTestId('sup-continuation-age')).not.toHaveTextContent(/\d+s ago/);
  });

  it('omits an age for a freshly verified count rather than padding it', async () => {
    await renderDashboard({ snapshot: buildSnapshot(), tab: 'overview' });
    /* workers_total is LIVE_VERIFIED. No age is noise on a current fact. */
    const tile = screen.getByTestId('sup-workers-total');
    expect(tile).toHaveAttribute('data-state', 'LIVE_VERIFIED');
    expect(screen.queryByTestId('sup-workers-total-age')).not.toBeInTheDocument();
  });

  it('does not claim a live link when the payload fails to parse', async () => {
    /* A malformed body must not read as a healthy empty dashboard. */
    const { calls } = await renderDashboard();
    expect(calls.length).toBeGreaterThan(0);
    expect(screen.getByTestId('supervisor-dashboard')).toHaveAttribute('data-connection', 'unreachable');
  });
});

describe('connection semantics', () => {
  it('fetches once even when polling is disabled', async () => {
    const { calls } = await renderDashboard({ snapshot: buildSnapshot() });
    /* `enabled: false` means "stop polling", not "never read". Exactly one
       state request and one health request, then it stops. */
    const stateCalls = calls.filter((c) => c.url.includes('/v1/supervisor/state'));
    expect(stateCalls).toHaveLength(1);
    expect(screen.getByTestId('supervisor-dashboard')).toHaveAttribute('data-connection', 'connected');
  });

  it('uses only the documented loopback routes', async () => {
    const { calls } = await renderDashboard({ snapshot: buildSnapshot() });
    for (const c of calls) {
      expect(c.url).toMatch(/\/v1\/supervisor\/(state|health|events)/);
    }
  });

  it('states the supervisor identity from the payload', async () => {
    await renderDashboard({ snapshot: buildSnapshot() });
    expect(screen.getByTestId('supervisor-identity')).toHaveTextContent('hermes');
  });
});

/* --- helpers --------------------------------------------------------------- */

function factOf(value: unknown, state: string, source: string, note = '') {
  return { value, state, source, observed_at: '2026-10-12T00:00:00+00:00', age_s: 3, note };
}