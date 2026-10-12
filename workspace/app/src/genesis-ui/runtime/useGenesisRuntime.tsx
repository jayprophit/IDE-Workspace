import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GenesisSessionStatus } from '../../genesisBridge';
import type { TeamMember } from '../types';
import {
  FIXTURE_SNAPSHOT,
  REAL_CLIENT,
  mapApprovals,
  mapEventToMessage,
  mapTasks,
  mapWorkers,
  type GenesisClient,
  type RuntimeBinding,
  type RuntimeBindingOptions,
  type RuntimeSnapshot,
} from './runtimeTypes';

/**
 * `useGenesisRuntime` — the single Bridge integration point.
 *
 * Owns connection lifecycle and polling. Exposes a plain snapshot that
 * `GenesisShell` passes down as props, exactly as the fixture path does, so
 * switching modes changes where the values come from and nothing else.
 *
 * Failure behaviour is the important part. When the Bridge is unreachable the
 * snapshot goes to `disconnected`, the error is kept VERBATIM, and the last
 * known values are retained but flagged `fresh: false`. Nothing is reset to a
 * fabricated roster: an unreachable runtime produces an honest empty team, not
 * a convincing one.
 */

const DEFAULT_POLL_MS = 1500;

export function useGenesisRuntime(options: RuntimeBindingOptions): RuntimeBinding {
  const {
    source,
    baseUrl,
    workspace,
    mode = 'build',
    approval = 'AUTO_SAFE',
    interactive = false,
    pollMs = DEFAULT_POLL_MS,
    client = REAL_CLIENT,
  } = options;

  const [snapshot, setSnapshot] = useState<RuntimeSnapshot>(() =>
    source === 'fixture' ? FIXTURE_SNAPSHOT : disconnectedSnapshot(baseUrl),
  );
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState(false);

  /**
   * Options are read through a ref rather than captured.
   *
   * Without this, a caller who passes a freshly-built options object (or a
   * `client` literal) on every render restarts the poll effect on every render
   * too, and the loop spins forever without ever completing a cycle. Reading
   * the latest value at use time keeps the loop's identity stable, which is
   * the difference between "polls every 20ms" and "never settles".
   */
  const optionsRef = useRef({ source, baseUrl, workspace, mode, approval, interactive, pollMs, client });
  optionsRef.current = { source, baseUrl, workspace, mode, approval, interactive, pollMs, client };

  const sessionIdRef = useRef('');
  const taskIdRef = useRef('');
  const stoppedRef = useRef(false);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /* Track whether we have ever connected, so a later drop is "reconnecting"
     rather than "connecting" — a distinction a person can act on. */
  const everConnectedRef = useRef(false);

  /* Reset when the mode or target changes. Without this, switching from a
   * live session back to fixtures would leave live values on screen. */
  useEffect(() => {
    sessionIdRef.current = '';
    taskIdRef.current = '';
    everConnectedRef.current = false;
    setLive(false);
    setSnapshot(source === 'fixture' ? FIXTURE_SNAPSHOT : disconnectedSnapshot(baseUrl));
  }, [source, baseUrl]);

  useEffect(() => {
    stoppedRef.current = false;
    return () => {
      stoppedRef.current = true;
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, []);

  /* Optional: reads /v1/runtime for the worker roster. Kept separate from the
   session status call because the roster is genuinely a different question,
   and because it is the piece most likely to be absent. A failure here costs
   us the roster, never the session. */
  const fetchWorkers = useCallback(async (): Promise<TeamMember[]> => {
    const { baseUrl } = optionsRef.current;
    try {
      const resp = await fetch(`${baseUrl}/v1/runtime`);
      if (!resp.ok) return [];
      return mapWorkers(await resp.json());
    } catch {
      /* Unreachable runtime is already reported through the connection state.
         Swallowing here would double-report the same failure. */
      return [];
    }
  }, []);

  const applySession = useCallback(
    async (sid: string, markFresh: boolean) => {
      const { client, baseUrl, approval } = optionsRef.current;
      const [statusRes, eventRes] = await Promise.all([
        client.sessionStatus(baseUrl, sid),
        client.sessionEvents(baseUrl, sid),
      ]);
      if (stoppedRef.current) return;

      if (!statusRes.ok || !statusRes.data) {
        setSnapshot((prev) => ({
          ...prev,
          connection: 'error',
          error: statusRes.error || 'session status unavailable',
          fresh: false,
        }));
        return;
      }

      const status: GenesisSessionStatus = statusRes.data;
      const events = eventRes.ok && eventRes.data ? eventRes.data : [];
      const approvals = mapApprovals(status, events);
      const messages = events
        .map(mapEventToMessage)
        .filter((m): m is NonNullable<typeof m> => m !== null);

      /* Worker roster. The Bridge currently returns workers: [] on every
       * /v1/runtime (the service hardcodes tracker=None), so in practice this
       * is empty. It is mapped from real state rather than backfilled from
       * fixtures, because a runtime that reports no workers must produce no
       * workers. When the Bridge starts exposing them, this is the one place
       * that needs to change. */
      const workers = await fetchWorkers();

      setSnapshot((prev) => ({
        ...prev,
        source: 'agent_bridge',
        connection: 'connected',
        error: '',
        fresh: markFresh,
        sessionId: sid,
        sessionStatus: status.status,
        interactive: status.interactive,
        approvalMode: approval,
        workers,
        tasks: mapTasks(status),
        approvals,
        messages,
      }));
    },
    [fetchWorkers],
  );

  const ensureSession = useCallback(async () => {
    if (sessionIdRef.current) return sessionIdRef.current;
    const { client, baseUrl, workspace, mode, approval, interactive } = optionsRef.current;
    const res = await client.createSession(baseUrl, { workspace, mode, approval, interactive });
    if (!res.ok || !res.data) {
      setSnapshot((prev) => ({ ...prev, connection: 'error', error: res.error, fresh: false }));
      return '';
    }
    sessionIdRef.current = res.data.session_id;
    return res.data.session_id;
  }, []);

  const connect = useCallback(() => {
    if (optionsRef.current.source === 'fixture') {
      /* Fixture mode must never report a live connection. */
      setSnapshot(FIXTURE_SNAPSHOT);
      return;
    }
    setLive(true);
    setSnapshot((prev) => ({
      ...prev,
      connection: everConnectedRef.current ? 'reconnecting' : 'connecting',
      error: '',
    }));
  }, []);

  const disconnect = useCallback(() => {
    setLive(false);
    setSnapshot((prev) => ({
      ...prev,
      connection: 'disconnected',
      fresh: false,
      /* Keep the values but mark them stale. The person is losing context,
       * and pretending otherwise would be worse than admitting it. */
      error: prev.error,
    }));
  }, []);

  /* Poll loop. Runs only while connected and not stopped. */
  useEffect(() => {
    if (!live || optionsRef.current.source === 'fixture') return undefined;

    let cancelled = false;

    /* When the session cannot be created, stop retrying for this connection
   * attempt rather than looping forever. A refused session is a real answer
   * from the runtime, not a transient blip; hammering it would be both
   * wasteful and dishonest about how hard we are trying. */
  const tick = async () => {
    if (cancelled || stoppedRef.current) return;
    const sid = await ensureSession();
    if (!sid || cancelled || stoppedRef.current) {
      /* Session could not be created. The error is already on the snapshot. */
      return;
    }
    everConnectedRef.current = true;
    await applySession(sid, true);
    schedule();
  };

    const schedule = () => {
      if (cancelled || stoppedRef.current) return;
      if (pollRef.current) clearTimeout(pollRef.current);
      pollRef.current = setTimeout(() => void tick(), pollMs);
    };

    void tick();
    return () => {
      cancelled = true;
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [applySession, ensureSession, live, pollMs]);

  /* One-shot refresh used by submit/decide. */
  const refresh = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (sid) await applySession(sid, true);
  }, [applySession]);

  const submit = useCallback(
    async (text: string) => {
      const goal = text.trim();
      if (!goal) return;
      if (optionsRef.current.source === 'fixture') return;

      const { client, baseUrl } = optionsRef.current;
      setBusy(true);
      setSnapshot((prev) => ({ ...prev, error: '' }));
      try {
        const sid = await ensureSession();
        if (!sid) return;
        const res = await client.submitTask(baseUrl, sid, goal);
        if (!res.ok || !res.data) {
          setSnapshot((prev) => ({ ...prev, error: res.error || 'task was refused', fresh: false }));
          return;
        }
        taskIdRef.current = res.data.task_id;
        await refresh();
      } finally {
        setBusy(false);
      }
    },
    [ensureSession, refresh],
  );

  const decide = useCallback(
    async (approvalId: string, decision: 'approve-once' | 'deny') => {
      const { client, baseUrl } = optionsRef.current;
      if (optionsRef.current.source === 'fixture') return;
      const sid = sessionIdRef.current;
      if (!sid) return;

      /* Refuse locally rather than sending a decision the runtime would
       * reject. This mirrors the UI rule: no controls are offered, and the
       * seam enforces it again for callers that bypass the UI. */
      if (!snapshot.interactive) {
        setSnapshot((prev) => ({
          ...prev,
          error: 'this session has no decision channel; the runtime would refuse this decision',
        }));
        return;
      }

      setBusy(true);
      try {
        const res = await client.decideApproval(baseUrl, sid, approvalId, decision);
        if (!res.ok) {
          setSnapshot((prev) => ({ ...prev, error: res.error || 'decision was refused' }));
          return;
        }
        setSnapshot((prev) => ({ ...prev, error: '' }));
        await refresh();
      } finally {
        setBusy(false);
      }
    },
    [refresh, snapshot.interactive],
  );

  return useMemo(
    () => ({ snapshot, connect, disconnect, submit, decide, busy }),
    [busy, connect, decide, disconnect, snapshot, submit],
  );
}

function disconnectedSnapshot(baseUrl: string): RuntimeSnapshot {
  return {
    ...FIXTURE_SNAPSHOT,
    source: 'agent_bridge',
    connection: 'disconnected',
    /* Not stale yet - nothing has ever arrived. Distinguishing "never
     * connected" from "was connected and lost it" matters. */
    fresh: false,
    baseUrl,
    sessionStatus: 'disconnected',
    workers: [],
    tasks: [],
    approvals: [],
    messages: [],
  };
}

export { mapWorkers };