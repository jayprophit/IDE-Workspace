import type { SourceFact } from '../api/types';

/**
 * Roster row shape, as the LIVE backend emits it.
 *
 * Transcribed from `SupervisorRuntime.worker_roster()`. Verified against a real
 * cycle: three workers (opencode-primary, codex-primary, ollama-local), of
 * which codex-primary carries a live `quota_state` and the rest return `{}`.
 *
 * Every optional field below is optional because the runtime genuinely sends
 * an empty string for project, model, task_description, review_state and
 * next_action. Those are absences, and the UI must render them as absences.
 */
export interface TeamMember {
  worker_id: string;
  application?: string;
  role?: string;
  worker_type?: string;
  status?: string;
  task_description?: string;
  project?: string;
  model?: string;
  provider?: string;
  /** Write ownership: the scope this worker may write to. */
  write_set?: string;
  write_ownership?: string;
  quota_state?: Record<string, unknown>;
  /** Epoch seconds of the worker's last heartbeat. */
  last_heartbeat?: number;
  review_state?: string;
  next_action?: string;
}

/** Narrow a supervision field to a SourceFact without trusting its shape. */
function isSourceFactLike(value: unknown): value is SourceFact {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && 'state' in (value as object);
}

/**
 * Read the roster out of the supervision section.
 *
 * THE SINGLE DATA SOURCE. Both `roster.tsx` and `team-room.tsx` read this same
 * `workers` fact; nothing in this unit issues a second request to get a roster.
 * Returns null when the fact is absent so callers can distinguish "not exposed"
 * from "exposed and empty" - the distinction the whole unit turns on.
 */
export function readRoster(section: Record<string, unknown> | undefined): TeamMember[] | null {
  if (!section) return null;
  const fact = section.workers;
  if (!isSourceFactLike(fact)) return null;
  if (!Array.isArray(fact.value)) return null;
  return fact.value as TeamMember[];
}