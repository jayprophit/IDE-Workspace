/**
 * Supervisor API contract types.
 *
 * Mirrors `Agent-Bridge/nodes/supervisor.py` exactly. Every observed value is
 * a `SourceFact`, and the frontend's job is to render the state it was given
 * without ever upgrading it. There is deliberately no "resolve state" helper
 * here beyond reading the value the backend already computed.
 *
 * The backend computes `effective_state()` server-side: a LIVE fact older than
 * FRESHNESS_WINDOW_S (30s) is already reported as STALE. The frontend never
 * recomputes that, because a second clock would eventually disagree with the
 * one that made the observation.
 */

/** The honesty vocabulary. Ten states; no others exist. */
export const SOURCE_STATES = [
  'LIVE_VERIFIED',
  'LIVE',
  'STALE',
  'DEGRADED',
  'OFFLINE',
  'FIXTURE',
  'UNKNOWN',
  'BLOCKED',
  'NOT_EXPOSED',
  'DEFERRED_BACKEND_INTERFACE',
] as const;

export type SourceState = (typeof SOURCE_STATES)[number];

/**
 * A single observed value tagged with its honesty state.
 *
 * `value` is deliberately `unknown`: a SourceFact carries git SHAs, counts,
 * nested rows and nulls, and typing each would be a lie about what the backend
 * may send. Accessors below narrow it.
 */
export interface SourceFact {
  value: unknown;
  state: SourceState;
  source: string;
  observed_at: string;
  age_s: number;
  note: string;
}

/* ---------------------------------------------------------------------------
 * Response envelopes
 * ------------------------------------------------------------------------ */

export interface SupervisorHealth {
  ok: boolean;
  supervisor?: string;
  schema_version?: number;
  last_event_seq?: number;
  error_code?: string;
  detail?: string;
}

export interface SupervisorSnapshot {
  schema_version: number;
  supervisor: string;
  session_id: string;
  generated_at: string;
  last_event_seq: number;
  /** Section name -> field path -> fact (sometimes nested one level). */
  sections: Record<string, Record<string, unknown>>;
}

export interface SupervisorStateResponse {
  ok: boolean;
  snapshot?: SupervisorSnapshot;
  error_code?: string;
  detail?: string;
}

/* ---------------------------------------------------------------------------
 * §17.J / §18 control surface
 * ------------------------------------------------------------------------ */

/** One worker's live detail from GET /v1/supervisor/worker/<id>. */
export interface WorkerDetail {
  ok: boolean;
  worker_id: string;
  application?: string;
  role?: string;
  /** Live verdict from the worker's real adapter (RUNNING/IDLE/...). */
  verdict?: string;
  evidence: string[];
  quota?: Record<string, unknown>;
  current_task?: Record<string, unknown>;
  record?: Record<string, unknown>;
  error_code?: string;
  detail?: string;
}

/** Result of POST /v1/supervisor/worker/<id>/continue. */
export interface WorkerContinueResult {
  ok: boolean;
  worker_id: string;
  /** True only when the real adapter channel actually delivered (§15). */
  delivered: boolean;
  channel?: string;
  evidence: string[];
  error_code?: string;
  detail?: string;
}

/** One event from the SSE ring. `event` is the inner bus payload. */
export interface SupervisorEvent {
  seq: number;
  received_at: string;
  event: {
    event?: string;
    timestamp?: string;
    [key: string]: unknown;
  };
}

/* ---------------------------------------------------------------------------
 * Section shapes
 *
 * Field names only. Whether a field is present at all is itself information:
 * `refresh_snapshot` omits sections whose dependency was not injected, and that
 * absence is honest rather than an error.
 * ------------------------------------------------------------------------ */

export interface RepositoryFacts {
  repo?: SourceFact;
  head?: SourceFact;
  branch?: SourceFact;
  behind?: SourceFact;
  ahead?: SourceFact;
  ahead_behind?: SourceFact;
  dirty_count?: SourceFact;
  dirty_files?: SourceFact;
  last_commit?: SourceFact;
}

export interface WorkerRow {
  worker_id?: string;
  role_id?: string;
  department?: string;
  model_id?: string;
  provider_id?: string;
  execution_target?: string;
  career_state?: string;
  success_count?: number;
  failure_count?: number;
}

export interface QuotaRow {
  worker_id?: string;
  remaining_fraction?: number | null;
  [key: string]: unknown;
}

export interface ResourcesFacts {
  pressure_state?: SourceFact;
  sample?: SourceFact;
  throttle_actions?: SourceFact;
  error?: SourceFact;
}

export interface SupervisionFacts {
  workers_total?: SourceFact;
  workers_by_status?: SourceFact;
  /** §17.J: the live per-worker roster (array of worker rows). */
  workers?: SourceFact;
  handoffs_pending?: SourceFact;
  handoffs_total?: SourceFact;
  gaps_open?: SourceFact;
  gaps_by_severity?: SourceFact;
  continuation_required?: SourceFact;
  error?: SourceFact;
}

export interface KnowledgeFacts {
  objects?: SourceFact;
  by_type?: SourceFact;
  by_project?: SourceFact;
  by_confidence?: SourceFact;
  error?: SourceFact;
}

export interface HiveFacts {
  overview?: SourceFact;
  workers?: SourceFact;
  quotas?: SourceFact;
  waiting_for_quota?: SourceFact;
  handoffs?: SourceFact;
  hive?: SourceFact;
}

export interface OpencodeFacts {
  cli?: SourceFact;
  raw_line_count?: SourceFact;
  listing?: SourceFact;
  opencode_session?: SourceFact;
  message_count?: SourceFact;
  session?: SourceFact;
  liveness?: Record<string, SourceFact>;
}

export interface CodexFacts {
  sessions?: SourceFact;
  verdict?: SourceFact;
  [key: string]: SourceFact | undefined;
}

export interface LocalModelsFacts {
  ollama?: SourceFact;
  version?: SourceFact;
  resident_models?: SourceFact;
}

export interface TeamRegistryFacts {
  registry?: SourceFact;
  worker_count?: SourceFact;
  team_count?: SourceFact;
  workers?: SourceFact;
  teams?: SourceFact;
  note?: SourceFact;
  error?: SourceFact;
}

/** Every section the backend can emit. A missing one renders as not-exposed. */
export const SECTION_IDS = [
  'repositories',
  'local_models',
  'team_registry',
  'workers',
  'opencode',
  'codex',
  'hive',
  'supervision',
  'resources',
  'knowledge',
] as const;

export type SectionId = (typeof SECTION_IDS)[number];

/** Human labels. The ids stay machine-shaped; these are for display. */
export const SECTION_LABEL: Record<SectionId, string> = {
  repositories: 'Repositories',
  local_models: 'Local models',
  team_registry: 'Team registry',
  workers: 'Workers',
  opencode: 'OpenCode',
  codex: 'Codex',
  hive: 'Hive',
  supervision: 'Supervision',
  resources: 'Resources',
  knowledge: 'Knowledge',
};