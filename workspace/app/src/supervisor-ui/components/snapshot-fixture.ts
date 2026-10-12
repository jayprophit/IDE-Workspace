import type { SourceState, SupervisorSnapshot } from '../api/types';

/**
 * Snapshot fixtures shaped exactly like the live backend response.
 *
 * Taken from a real `/v1/supervisor/state` capture (git repos, ollama down,
 * opencode CLI up), then trimmed. The point is that the degraded and
 * offline states in the default fixture are REAL — Ollama genuinely was not
 * running when this was captured — so the tests exercise the states the
 * dashboard actually has to handle, not only the happy path.
 */

function fact(value: unknown, state: SourceState, source: string, note = '', ageS = 2) {
  return {
    value,
    state,
    source,
    observed_at: '2026-10-12T12:22:32+00:00',
    age_s: ageS,
    note,
  };
}

export function buildSnapshot(): SupervisorSnapshot {
  return {
    schema_version: 1,
    supervisor: 'hermes',
    session_id: 'supervisor-ui-dev',
    generated_at: '2026-10-12T12:22:32+00:00',
    last_event_seq: 3,
    sections: {
      repositories: {
        'IDE-Workspace': {
          head: fact('cb1eb26', 'LIVE_VERIFIED', 'git'),
          branch: fact('master', 'LIVE_VERIFIED', 'git'),
          ahead: fact(0, 'LIVE_VERIFIED', 'git'),
          behind: fact(0, 'LIVE_VERIFIED', 'git'),
          dirty_count: fact(1, 'LIVE_VERIFIED', 'git'),
          dirty_files: fact(['?? docs/handoffs/'], 'LIVE_VERIFIED', 'git'),
          last_commit: fact('cb1eb26 P0-A: bind the Genesis UI to real Agent Bridge', 'LIVE_VERIFIED', 'git'),
        },
        'Agent-Bridge': {
          head: fact('4c5f0a7', 'LIVE_VERIFIED', 'git'),
          branch: fact('main', 'LIVE_VERIFIED', 'git'),
          ahead: fact(0, 'LIVE_VERIFIED', 'git'),
          behind: fact(0, 'LIVE_VERIFIED', 'git'),
          dirty_count: fact(0, 'LIVE_VERIFIED', 'git'),
          last_commit: fact('4c5f0a7 docs: reconciliation checkpoint', 'LIVE_VERIFIED', 'git'),
        },
        'Aetherius-OS': {
          /* A repo the backend could not read. This is a real OFFLINE shape. */
          repo: fact('C:/Projects/Aetherius-OS', 'OFFLINE', 'git', 'fatal: not a git repository', 3),
        },
      },
      local_models: {
        /* Real capture: Ollama was not listening. */
        ollama: fact(null, 'OFFLINE', 'ollama', 'URLError: connection refused'),
      },
      team_registry: {
        worker_count: fact(2, 'LIVE_VERIFIED', 'team_registry'),
        team_count: fact(0, 'LIVE_VERIFIED', 'team_registry'),
        workers: fact(
          [
            { worker_id: 'w-hermes', role_id: 'supervisor', department: 'orchestration', execution_target: 'hermes-host', career_state: 'ACTIVE' },
            { worker_id: 'w-opencode', role_id: 'implementer', department: 'engineering', execution_target: 'opencode-cli', career_state: 'ACTIVE' },
          ],
          'LIVE_VERIFIED',
          'team_registry',
        ),
        teams: fact([], 'LIVE_VERIFIED', 'team_registry'),
      },
      opencode: {
        cli: fact('available', 'LIVE_VERIFIED', 'opencode-cli'),
        raw_line_count: fact(5, 'LIVE_VERIFIED', 'opencode-cli'),
        liveness: {
          process_present: fact(true, 'LIVE_VERIFIED', 'tasklist', '', 2.83),
          cli: fact('available', 'LIVE_VERIFIED', 'opencode-cli'),
          verdict: fact('ACTIVE', 'LIVE_VERIFIED', 'derived', 'freshest session updated 2s ago (window 600s)'),
          liveness_window_s: fact(600, 'LIVE_VERIFIED', 'config'),
        },
      },
      supervision: {
        workers_total: fact(5, 'LIVE_VERIFIED', 'supervision'),
        workers_by_status: fact({ ACTIVE: 3, IDLE: 2 }, 'LIVE_VERIFIED', 'supervision'),
        handoffs_pending: fact(1, 'LIVE_VERIFIED', 'supervision'),
        handoffs_total: fact(4, 'LIVE_VERIFIED', 'supervision'),
        gaps_open: fact(2, 'LIVE_VERIFIED', 'supervision'),
        gaps_by_severity: fact({ high: 1, low: 1 }, 'LIVE_VERIFIED', 'supervision'),
        /* An aged fact: the backend computed STALE itself. */
        continuation_required: fact(true, 'STALE', 'supervision', 'last observed 90s ago', 90),
      },
      resources: {
        pressure_state: fact('nominal', 'LIVE_VERIFIED', 'resource_governor'),
        sample: fact({ cpu_pct: 22, mem_pct: 61 }, 'LIVE_VERIFIED', 'resource_governor'),
        throttle_actions: fact([], 'LIVE_VERIFIED', 'resource_governor'),
      },
      hive: {
        /* A scheduler that IS wired. `waiting_for_quota: []` is a real
           observation of emptiness, which the UI must distinguish from an
           unreadable source. `remaining_fraction: null` is the documented
           UNKNOWN case and must never render as 0%. */
        hive: fact(null, 'DEGRADED', 'hive-scheduler', 'scheduler returned a partial overview'),
        workers: fact(
          [
            { worker_id: 'h-hermes', provider: 'anthropic', tier: 'local', state: 'ACTIVE' },
            { worker_id: 'h-opencode', provider: 'anthropic', tier: 'remote', state: 'IDLE' },
          ],
          'LIVE_VERIFIED',
          'hive-scheduler',
        ),
        quotas: fact([{ worker_id: 'h-hermes', remaining_fraction: null }], 'LIVE_VERIFIED', 'hive-scheduler'),
        waiting_for_quota: fact([], 'LIVE_VERIFIED', 'hive-scheduler'),
        handoffs: fact([], 'LIVE_VERIFIED', 'hive-scheduler'),
      },
      /* knowledge / codex are deliberately absent: `refresh_snapshot` only
         emits them when the dependency is injected, and an absent section must
         render NOT_EXPOSED rather than looking empty. */
    },
  };
}

export function healthPayload(over: Partial<{ ok: boolean; error_code: string; supervisor: string; schema_version: number; last_event_seq: number }> = {}) {
  return { ok: true, supervisor: 'hermes', schema_version: 1, last_event_seq: 3, ...over };
}