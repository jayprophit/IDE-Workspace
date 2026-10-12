import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GenesisSessionStatus } from '../../genesisBridge';
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

  const sessionIdRef = useRef('');
  const taskIdRef = useRef('');
  const stoppedRef = useRef(false);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /* Track whether we have ever connected, so a later drop is "reconnecting"
     rather than "connecting" — a distinction a person can act on. */
  const everConnectedRef = useRef(false);
  const createdRef = useRef(false);

  /* Reset when the mode or target changes. Without this, switching from a
   * live session back to fixtures would leave live values on screen. */
  useEffect(() => {
    createdRef.current = false;
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

  const applySession = useCallback(
    async (sid: string, markFresh: boolean) => {
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
        tasks: mapTasks(status),
        approvals,
        messages,
      }));
    },
    [approval, baseUrl, client],
  );

  const ensureSession = useCallback(async () => {
    if (sessionIdRef.current) return sessionIdRef.current;
    const res = await client.createSession(baseUrl, { workspace, mode, approval, interactive });
    if (!res.ok || !res.data) {
      setSnapshot((prev) => ({ ...prev, connection: 'error', error: res.error, fresh: false }));
      return '';
    }
    sessionIdRef.current = res.data.session_id;
    createdRef.current = true;
    return res.data.session_id;
  }, [approval, baseUrl, client, interactive, mode, workspace]);

  const connect = useCallback(() => {
    if (source === 'fixture') {
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
  }, [source]);

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
    if (!live || source === 'fixture') return undefined;

    let cancelled = false;

    const tick = async () => {
      if (cancelled || stoppedRef.current) return;
      const sid = await ensureSession();
      if (!sid || cancelled || stoppedRef.current) {
        /* Session could not be created. Stay honest about the failure. */
        schedule();
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
  }, [applySession, ensureSession, live, pollMs, source]);

  /* One-shot refresh used by submit/decide. */
  const refresh = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (sid) await applySession(sid, true);
  }, [applySession]);

  const submit = useCallback(
    async (text: string) => {
      const goal = text.trim();
      if (!goal) return;
      if (source === 'fixture') return;

      setBusy(true);
      setSnapshot((prev) => ({ ...prev, connection: prev.connection, error: '' }));
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
    [baseUrl, client, ensureSession, refresh, source],
  );

  const decide = useCallback(
    async (approvalId: string, decision: 'approve-once' | 'deny') => {
      if (source === 'fixture') return;
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
    [baseUrl, client, refresh, snapshot.interactive, source],
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