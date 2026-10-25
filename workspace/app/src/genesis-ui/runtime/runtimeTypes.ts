import type { ChatMessage, TaskSummary, TeamMember } from '../types';
import { FIXTURE_TEAM } from '../fixtures';
import {
  createSession,
  decideApproval,
  pendingApprovals,
  sessionEvents,
  sessionStatus,
  submitTask,
  type GenesisOutcome,
  type GenesisPendingApproval,
  type GenesisSessionStatus,
} from '../../genesisBridge';

/**
 * Genesis runtime binding — P0-A.
 *
 * THE RULE OF THIS FILE: it is the ONLY place in `genesis-ui` that talks to
 * Agent Bridge. Views receive plain props and never import a client, so this
 * adapter is the whole integration surface. That is what lets the fixture and
 * real modes be swapped without touching a single view.
 *
 * It reuses the existing `genesisBridge.ts` client rather than introducing a
 * second transport: same base URL, same `/v1` contract, same honest-error
 * convention. No new protocol, no parallel event vocabulary.
 *
 * Honesty rules this module enforces:
 *   - `source` is always stated. Fixture data can never be presented as real.
 *   - while disconnected, no team, task or approval is synthesised. The last
 *     known values are kept but explicitly marked stale.
 *   - approve/deny controls are gated on `interactive` coming FROM the Bridge.
 *     A session that reports no decision channel never gets the buttons, so the
 *     UI cannot offer a human a decision the runtime would refuse.
 *   - nothing is timed or inferred. There is no timer that turns a state into
 *     another state anywhere below.
 */

export type RuntimeSource = 'fixture' | 'agent_bridge' | 'genesis';
export type RuntimeConnection = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';

export interface RuntimeApproval {
  approval_id: string;
  action: string;
  risk: string;
  /** True only when the Bridge says this session can actually be decided. */
  decidable: boolean;
}

export interface RuntimeSnapshot {
  source: RuntimeSource;
  connection: RuntimeConnection;
  /** Verbatim transport error, or '' when there is none. Never paraphrased. */
  error: string;
  /** True when the values below came from the Bridge and are current. */
  fresh: boolean;
  baseUrl: string;
  sessionId: string;
  sessionStatus: string;
  /** False unless the Bridge reports an interactive channel for this session. */
  interactive: boolean;
  approvalMode: string;
  workers: TeamMember[];
  tasks: TaskSummary[];
  approvals: RuntimeApproval[];
  messages: ChatMessage[];
  /** Last real outcome, verbatim. Null until the Bridge reports one. */
  outcome: GenesisOutcome | null;
}

export interface RuntimeBinding {
  snapshot: RuntimeSnapshot;
  connect: () => void;
  disconnect: () => void;
  /** Submit real work through the Bridge. No-op in fixture mode. */
  submit: (text: string) => Promise<void>;
  /** Answer a pending approval. Refuses unless the Bridge allows it. */
  decide: (approvalId: string, decision: 'approve-once' | 'deny') => Promise<void>;
  busy: boolean;
}

export const FIXTURE_SNAPSHOT: RuntimeSnapshot = {
  source: 'fixture',
  connection: 'disconnected',
  error: '',
  /* Fixture mode is not "stale", it is simply not live. Saying otherwise
   * would make the two modes indistinguishable in the status bar. */
  fresh: false,
  baseUrl: '',
  sessionId: '',
  sessionStatus: 'fixture',
  interactive: false,
  approvalMode: 'FIXTURE',
  workers: FIXTURE_TEAM,
  tasks: [
    { id: 'k1', label: 'Extract theme tokens', owner: 'Dev', status: 'done' },
    { id: 'k2', label: 'Avatar picker states', owner: 'Lyra', status: 'active' },
    { id: 'k3', label: 'Conference grid layout', owner: 'Nova', status: 'review' },
  ],
  approvals: [],
  messages: [
    {
      id: 'm1',
      author: 'agent',
      authorName: 'Aether',
      timestamp: '10:24',
      body: 'Ready when you are. Pick a view and I will follow you across it.',
      checklist: [
        { id: 'c1', label: 'Tokens extracted', status: 'done' },
        { id: 'c2', label: 'Avatar presets wired', status: 'in-progress' },
        { id: 'c3', label: 'Live renderer connected', status: 'pending' },
      ],
    },
    { id: 'm2', author: 'user', authorName: 'You', timestamp: '10:25', body: 'Show me the team view.' },
  ],
  outcome: null,
};

/**
 * Session/task status from the Bridge -> the UI's task vocabulary.
 *
 * Only statuses the Bridge actually reports are mapped. Anything unrecognised
 * becomes `todo`, never a guessed "active".
 */
export function mapTasks(status: GenesisSessionStatus): TaskSummary[] {
  return Object.entries(status.tasks).map(([id, value]) => ({
    id,
    label: id,
    owner: '',
    status: mapTaskStatus(value),
  }));
}

export function mapTaskStatus(raw: string): TaskSummary['status'] {
  switch (raw) {
    case 'COMPLETED':
      return 'done';
    case 'EXECUTING':
    case 'PLANNING':
    case 'TESTING':
    case 'REVIEWING':
    case 'REVISING':
      return 'active';
    case 'WAITING_APPROVAL':
    case 'WAITING_FINAL_APPROVAL':
      return 'review';
    case 'FAILED':
    case 'ROLLED_BACK':
      return 'blocked';
    case 'CANCELLED':
    case 'INTERRUPTED':
      return 'todo';
    case 'QUEUED':
      return 'todo';
    default:
      /* An unknown status is queued work, never assumed progress. */
      return 'todo';
  }
}

/**
 * Approval rows for the UI.
 *
 * `decidable` is the important field: it mirrors the Bridge's own `interactive`
 * flag and nothing else. The UI must not decide that a human can answer just
 * because an approval exists.
 */
export function mapApprovals(
  status: GenesisSessionStatus,
  events: Record<string, unknown>[],
): RuntimeApproval[] {
  return pendingApprovals(status, events).map((a: GenesisPendingApproval) => ({
    approval_id: a.approval_id,
    action: a.action,
    risk: a.risk,
    decidable: status.interactive,
  }));
}

/**
 * Team roster from runtime state.
 *
 * The Bridge's `/v1/runtime` returns `workers: []` on every response (the
 * service hardcodes `tracker=None`), and there is no team endpoint at all. So
 * there is NOTHING real to map here, and this returns an empty roster rather
 * than dressing fixture workers up as runtime truth.
 *
 * When the Bridge does expose workers, this is the single place to map them.
 */
export function mapWorkers(payload: unknown): TeamMember[] {
  const record = typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : null;
  const list = Array.isArray(payload) ? payload : record?.workers;
  if (!Array.isArray(list)) return [];

  const out: TeamMember[] = [];
  for (const entry of list) {
    if (typeof entry !== 'object' || entry === null) continue;
    const e = entry as Record<string, unknown>;
    /* Identity is whatever the runtime calls the worker. Fields the runtime
     * does not send are left empty rather than guessed. */
    const id = typeof e.worker_id === 'string' ? e.worker_id : typeof e.worker === 'string' ? e.worker : '';
    if (!id) continue;
    out.push({
      id,
      name: typeof e.name === 'string' && e.name ? e.name : id,
      role: typeof e.role_id === 'string' ? e.role_id : '',
      /* There is no avatar_profile_id anywhere in the Bridge. Until one
       * exists, an unmapped avatar must render as unmapped, not borrow a
       * fixture face. */
      avatarId: '',
      status: mapWorkerStatus(typeof e.state === 'string' ? e.state : typeof e.status === 'string' ? e.status : ''),
      currentTask: typeof e.current_task === 'string' ? e.current_task : '',
      recentActivity: '',
      capabilities: Array.isArray(e.specialisms) ? e.specialisms.filter((s): s is string => typeof s === 'string') : [],
    });
  }
  return out;
}

export function mapWorkerStatus(raw: string): TeamMember['status'] {
  switch (raw) {
    case 'BUSY':
    case 'EXECUTING':
    case 'ACTIVE':
      return 'active';
    case 'IN_CALL':
      return 'in-call';
    case 'REVIEWING':
      return 'reviewing';
    case 'THINKING':
      return 'thinking';
    case 'OFFLINE':
    case 'STOPPED':
      return 'offline';
    default:
      /* Unknown means unknown. An idle-looking worker is a claim the runtime
       * did not make. */
      return 'idle';
  }
}

/**
 * Map a runtime task event into a chat line.
 *
 * Deliberately reports what the Bridge said. It never writes "opened the
 * project" for a task that has not actually completed, and it never speaks on
 * the avatar's behalf — there is no speech synthesis anywhere in this module.
 */
export function mapEventToMessage(event: Record<string, unknown>): ChatMessage | null {
  const kind = typeof event.kind === 'string' ? event.kind : typeof event.event === 'string' ? event.event : '';
  const at = typeof event.timestamp === 'string' ? event.timestamp : '';

  const text = ((): string | null => {
    switch (kind) {
      case 'task.started':
        return 'Task accepted by the runtime.';
      case 'task.completed':
        return 'Task completed.';
      case 'task.failed':
        return 'Task failed.';
      case 'task.cancelled':
        return 'Task cancelled.';
      case 'task.deduplicated':
        return 'Task deduplicated; an identical task already exists.';
      case 'approval.requested':
        return 'Approval requested.';
      case 'approval.resolved':
        return 'Approval resolved.';
      case 'gate.waiting':
        return 'Waiting on a gate.';
      case 'gate.resolved':
        return 'Gate resolved.';
      case 'gate.timeout':
        return 'Gate timed out.';
      case 'revision.requested':
        return 'Revision requested.';
      case 'rollback.started':
        return 'Rollback started.';
      case 'rollback.completed':
        return 'Rollback completed.';
      default:
        return null;
    }
  })();

  if (text === null) return null;
  return {
    id: `rt-${kind}-${at}-${Math.abs(hashCode(String(event.id ?? text)))}`,
    author: 'agent',
    /* Named after the runtime, not after an avatar. No speech is implied. */
    authorName: 'Runtime',
    timestamp: at,
    body: text,
  };
}

/** Stable, dependency-free hash so event ids are deterministic in tests. */
function hashCode(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) {
    h = (h << 5) - h + value.charCodeAt(i);
    h |= 0;
  }
  return h;
}

/* ---------------------------------------------------------------------------
 * Options
 * ------------------------------------------------------------------------ */

export interface RuntimeBindingOptions {
  /** 'fixture' never touches the network. */
  source: RuntimeSource;
  baseUrl: string;
  workspace: string;
  mode?: string;
  approval?: string;
  /** Ask the Bridge for a human decision channel. */
  interactive?: boolean;
  /** Poll interval for session status. */
  pollMs?: number;
  /** Injected in tests; defaults to the real genesisBridge client. */
  client?: GenesisClient;
}

/** The subset of `genesisBridge.ts` this module uses. Injectable for tests. */
export interface GenesisClient {
  createSession: typeof createSession;
  submitTask: typeof submitTask;
  sessionStatus: typeof sessionStatus;
  sessionEvents: typeof sessionEvents;
  decideApproval: typeof decideApproval;
}

export const REAL_CLIENT: GenesisClient = {
  createSession,
  submitTask,
  sessionStatus,
  sessionEvents,
  decideApproval,
};