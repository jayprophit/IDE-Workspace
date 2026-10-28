import { useCallback, useEffect, useRef, useState } from 'react';
import { GenesisClient as GenesisHttpClient } from './GenesisClient';
import type { ChatMessage } from '../types';
import {
  FIXTURE_SNAPSHOT,
  type RuntimeBinding,
  type RuntimeSnapshot,
} from './runtimeTypes';

/**
 * Minimal Genesis chat hook. Returns a RuntimeBinding so GenesisShell can
 * consume it identically to useGenesisRuntime. Reuses GenesisClient.
 */
export function useGenesisChat(baseUrl: string, active: boolean = true): RuntimeBinding {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [connection, setConnection] = useState<RuntimeSnapshot['connection']>('disconnected');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const clientRef = useRef(new GenesisHttpClient(baseUrl));

  useEffect(() => {
    clientRef.current = new GenesisHttpClient(baseUrl);
  }, [baseUrl]);

  const connect = useCallback(() => {
    setConnection('connecting');
    setError('');
    clientRef.current
      .health()
      .then(() => setConnection('connected'))
      .catch((e: unknown) => {
        setConnection('error');
        setError(e instanceof Error ? e.message : String(e));
      });
  }, []);

  const disconnect = useCallback(() => {
    setConnection('disconnected');
  }, []);

  const submit = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setBusy(true);
    setError('');
    try {
      const res = await clientRef.current.agent(trimmed, { max_steps: 6 });
      const reply: ChatMessage = {
        id: `genesis-${Date.now()}`,
        author: 'agent',
        authorName: 'Genesis',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        body: res.answer ?? JSON.stringify(res),
      };
      setMessages((prev) => [...prev, reply]);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const decide = useCallback(async () => {}, []);

  const snapshot: RuntimeSnapshot = {
    source: 'genesis',
    connection,
    error,
    fresh: connection === 'connected',
    baseUrl,
    sessionId: 'genesis',
    sessionStatus: connection,
    interactive: false,
    approvalMode: 'GENESIS',
    workers: [],
    tasks: [],
    approvals: [],
    messages,
    outcome: null,
  };

  // Auto-connect on mount, but ONLY when this binding is the active runtime.
  // GenesisShell always instantiates the genesis hook (so the hook identity is
  // stable across mode switches); connecting while the shell is on fixture or
  // Agent-Bridge mode would fire an unwanted background request to a backend
  // the user has not selected. See Phase B lifecycle finding.
  useEffect(() => {
    if (active) connect();
  }, [active, connect]);

  return { snapshot, connect, disconnect, submit, decide, busy };
}
