// Agent Bridge live-status client (Phase 2 integration).
//
// Polls the loopback Agent Bridge service started via
// workspace/integration `BridgeService` (default http://127.0.0.1:8471).
// Never fakes data: when unreachable, reports connected:false and the UI
// keeps its honest disconnected labels.
export interface BridgeTask {
  task_id: string;
  session_id: string;
  objective: string;
  status: string;
  progress_pct: number;
  worker: string;
  model: string;
}

export interface BridgeAvatar {
  state: string;
  activity: string;
  progress_pct: number;
}

export interface BridgeRuntimeModel {
  model?: string;
  name?: string;
  status?: string;
  family?: string;
  provider?: string;
  runtime?: string;
  format?: string;
  quantisation?: string;
  parameter_size?: string;
  disk_footprint?: string;
  context?: number;
  vram_estimate?: string | null;
  license?: string;
  provenance?: string;
}

export interface BridgeHealthMetrics {
  status?: string;
  tokens_per_second?: number;
  first_token_s?: number;
}

export interface BridgeRuntime {
  timestamp: number;
  avatar?: BridgeAvatar;
  tasks: BridgeTask[];
  queue_depth: number;
  queued_ids: string[];
  active_model: string;
  models: BridgeRuntimeModel[];
  workers: { worker?: string; worker_id?: string; state?: string }[];
  approvals_pending: unknown[];
  progress_pct: number;
  results: unknown[];
  evidence_refs: string[];
  resources: Record<string, unknown>;
  health: string | BridgeHealthMetrics;
  errors: string[];
}

export interface BridgeModel {
  name: string;
  parameter_size?: string;
  context?: number;
  capabilities?: string[];
  size_bytes?: number;
}

export interface BridgeStatus {
  connected: boolean;
  baseUrl: string;
  health: string;
  runtime: BridgeRuntime | null;
  models: BridgeModel[];
  error: string;
  agentBridgeVersion: string;
  ideVersion: string;
  versionCompatible: boolean;
}

const DEFAULT_BASE = 'http://127.0.0.1:8471';

async function getJson(url: string, timeoutMs: number): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { signal: ctrl.signal });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return (await resp.json()) as unknown;
  } finally {
    window.clearTimeout(timer);
  }
}

function resolveBase(baseUrl: string): string {
  // Test hook: integration tests point the UI at an ephemeral service.
  const override = (window as unknown as Record<string, unknown>).__BRIDGE_BASE__;
  return typeof override === 'string' && override ? override : baseUrl;
}

export function bridgeBase(baseUrl: string = DEFAULT_BASE): string {
  return resolveBase(baseUrl);
}

export async function fetchBridgeStatus(
  baseUrl: string = DEFAULT_BASE,
  timeoutMs = 4000,
): Promise<BridgeStatus> {
  baseUrl = resolveBase(baseUrl);
  const base: BridgeStatus = {
    connected: false,
    baseUrl,
    health: 'UNKNOWN',
    runtime: null,
    models: [],
    error: '',
    agentBridgeVersion: '',
    ideVersion: '',
    versionCompatible: false,
  };
  try {
    const health = (await getJson(`${baseUrl}/health`, timeoutMs)) as {
      status?: string;
    };
    base.health = typeof health?.status === 'string' ? health.status : 'UNKNOWN';
    const runtime = (await getJson(
      `${baseUrl}/v1/runtime`,
      timeoutMs,
    )) as BridgeRuntime;
    base.runtime = runtime;
    try {
      const inv = (await getJson(`${baseUrl}/v1/models`, timeoutMs)) as {
        models?: BridgeModel[];
      };
      if (Array.isArray(inv?.models)) base.models = inv.models;
    } catch {
      base.models = [];
    }
    base.connected = true;
  } catch (e) {
    base.error = e instanceof Error ? e.message : String(e);
  }
  return base;
}

export function checkVersionCompatibility(
  agentBridgeVersion: string,
  ideVersion: string,
  allowedVersions: string[] = ["0.8.1"]
): boolean {
  return allowedVersions.includes(agentBridgeVersion);
}

export const BRIDGE_DEFAULT_BASE = DEFAULT_BASE;

export interface TerminalEntryView {
  command: string;
  cwd: string;
  exit_code: number | null;
  stdout: string;
  stderr: string;
  state: string;
  origin: string;
  pid?: number | null;
}

export interface TerminalSessionView {
  session_id: string;
  cwd: string;
  history: TerminalEntryView[];
  running: boolean;
}

async function postJson(url: string, body: unknown, timeoutMs: number): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return (await resp.json()) as unknown;
  } finally {
    window.clearInterval(timer);
  }
}

export async function createTerminalSession(baseUrl: string): Promise<TerminalSessionView> {
  const out = (await postJson(`${baseUrl}/v1/terminal/sessions`, {}, 8000)) as TerminalSessionView;
  if (!out.session_id) throw new Error('no session id');
  return out;
}

export async function execTerminal(
  baseUrl: string,
  sessionId: string,
  command: string,
  origin: 'user' | 'agent' = 'user',
): Promise<{ ok: boolean; state: string; stdout?: string; stderr?: string; exit_code?: number | null; error?: string }> {
  const out = (await postJson(
    `${baseUrl}/v1/terminal/sessions/${sessionId}/exec`,
    { command, origin },
    90000,
  )) as {
    ok: boolean;
    state: string;
    stdout?: string;
    stderr?: string;
    exit_code?: number | null;
    error?: string;
  };
  return out;
}

export async function fetchTerminalSession(
  baseUrl: string,
  sessionId: string,
): Promise<TerminalSessionView> {
  return (await getJson(
    `${baseUrl}/v1/terminal/sessions/${sessionId}`,
    8000,
  )) as TerminalSessionView;
}

export async function cancelTerminal(baseUrl: string, sessionId: string): Promise<unknown> {
  return postJson(`${baseUrl}/v1/terminal/sessions/${sessionId}/cancel`, {}, 8000);
}

export interface WorkspaceEntry {
  name: string;
  dir: boolean;
  size: number;
}

export async function listWorkspace(
  baseUrl: string, root: string, path = '',
): Promise<{ ok: boolean; entries?: WorkspaceEntry[]; error?: string }> {
  const q = `root=${encodeURIComponent(root)}&path=${encodeURIComponent(path)}`;
  return (await getJson(`${baseUrl}/v1/workspace/files?${q}`, 8000)) as {
    ok: boolean;
    entries?: WorkspaceEntry[];
    error?: string;
  };
}

export async function readWorkspaceFile(
  baseUrl: string, root: string, path: string,
): Promise<{ ok: boolean; content?: string; error?: string }> {
  const q = `root=${encodeURIComponent(root)}&path=${encodeURIComponent(path)}`;
  return (await getJson(`${baseUrl}/v1/workspace/file?${q}`, 8000)) as {
    ok: boolean;
    content?: string;
    error?: string;
  };
}

export async function writeWorkspaceFile(
  baseUrl: string, root: string, path: string, content: string,
): Promise<{ ok: boolean; bytes?: number; verified?: boolean; error?: string }> {
  return (await postJson(
    `${baseUrl}/v1/workspace/file`,
    { root, path, content },
    15000,
  )) as { ok: boolean; bytes?: number; verified?: boolean; error?: string };
}

export async function searchWorkspace(
  baseUrl: string, root: string, pattern: string, path = '',
): Promise<{ ok: boolean; hits?: { path: string; line: number; preview: string }[]; error?: string }> {
  const q = `root=${encodeURIComponent(root)}&pattern=${encodeURIComponent(pattern)}&path=${encodeURIComponent(path)}`;
  return (await getJson(`${baseUrl}/v1/workspace/search?${q}`, 15000)) as {
    ok: boolean;
    hits?: { path: string; line: number; preview: string }[];
    error?: string;
  };
}

export async function gitWorkspace(
  baseUrl: string, root: string, op: string,
): Promise<{ ok: boolean; error?: string; [key: string]: unknown }> {
  const q = `root=${encodeURIComponent(root)}&op=${encodeURIComponent(op)}`;
  return (await getJson(`${baseUrl}/v1/git?${q}`, 15000)) as {
    ok: boolean;
    error?: string;
    [key: string]: unknown;
  };
}

export async function createWorkspaceEntry(
  baseUrl: string, root: string, path: string, isDir = false,
): Promise<{ ok: boolean; error?: string }> {
  return (await postJson(
    `${baseUrl}/v1/workspace/create`,
    { root, path, is_dir: isDir },
    10000,
  )) as { ok: boolean; error?: string };
}

export async function deleteWorkspaceEntry(
  baseUrl: string, root: string, path: string,
): Promise<{ ok: boolean; error?: string }> {
  const q = `root=${encodeURIComponent(root)}&path=${encodeURIComponent(path)}`;
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), 10000);
  try {
    const resp = await fetch(`${baseUrl}/v1/workspace/file?${q}`, {
      method: 'DELETE',
      signal: ctrl.signal,
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return (await resp.json()) as { ok: boolean; error?: string };
  } finally {
    window.clearTimeout(timer);
  }
}

export async function renameWorkspaceEntry(
  baseUrl: string, root: string, oldPath: string, newPath: string,
): Promise<{ ok: boolean; error?: string }> {
  return (await postJson(
    `${baseUrl}/v1/workspace/rename`,
    { root, old_path: oldPath, new_path: newPath },
    10000,
  )) as { ok: boolean; error?: string };
}
