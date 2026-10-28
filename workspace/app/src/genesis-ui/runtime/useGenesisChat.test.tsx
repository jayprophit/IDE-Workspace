import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGenesisChat } from './useGenesisChat';
import type { RuntimeBinding } from './runtimeTypes';

const BASE = 'http://127.0.0.1:8471';

/**
 * useGenesisChat wires the Aetherius shell to the GenesisRuntime HTTP API
 * (/health + /v1/agent). It builds GenesisClient internally, so the client is
 * stubbed here: assertions check WHEN the backend is contacted, never a real
 * network round-trip.
 *
 * These guard the Phase-B lifecycle fix: the hook must NOT auto-connect when it
 * is not the active runtime, otherwise every non-genesis mode fires an unwanted
 * background request to a backend the user has not selected.
 */
const { health, agent } = vi.hoisted(() => ({
  health: vi.fn(async () => undefined),
  agent: vi.fn(async (_task: string, _opts: Record<string, unknown>) => ({ answer: '105' })),
}));

vi.mock('./GenesisClient', () => ({
  GenesisClient: class Stub {
    constructor(_baseUrl: string) {}
    health = health;
    agent = agent;
  },
}));

describe('useGenesisChat lifecycle', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('connects to the Genesis runtime on mount when active', async () => {
    const { result } = renderHook(() => useGenesisChat(BASE, true) as RuntimeBinding);
    await waitFor(() => expect(health).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.snapshot.connection).toBe('connected'));
    expect(result.current.snapshot.source).toBe('genesis');
  });

  it('does NOT connect when inactive (prevents background requests in non-genesis mode)', async () => {
    renderHook(() => useGenesisChat(BASE, false) as RuntimeBinding);
    await new Promise((r) => setTimeout(r, 80));
    expect(health).not.toHaveBeenCalled();
  });

  it('defaults to active for the original single-arg call shape', async () => {
    renderHook(() => useGenesisChat(BASE) as RuntimeBinding);
    await waitFor(() => expect(health).toHaveBeenCalledTimes(1));
  });

  it('forwards the task and appends the agent answer (47+58 -> 105)', async () => {
    const { result } = renderHook(() => useGenesisChat(BASE, true) as RuntimeBinding);
    await act(async () => {
      await result.current.submit('Calculate 47 + 58 using Agent Bridge.');
    });
    expect(agent).toHaveBeenCalledTimes(1);
    expect(agent.mock.calls[0][0]).toBe('Calculate 47 + 58 using Agent Bridge.');
    expect(result.current.snapshot.messages.length).toBe(1);
    expect(result.current.snapshot.messages[0].body).toBe('105');
  });

  it('ignores empty submissions without contacting the runtime', async () => {
    const { result } = renderHook(() => useGenesisChat(BASE, true) as RuntimeBinding);
    await act(async () => {
      await result.current.submit('   ');
    });
    expect(agent).not.toHaveBeenCalled();
    expect(result.current.snapshot.messages).toEqual([]);
  });

  it('surfaces an error if the runtime call rejects', async () => {
    agent.mockRejectedValueOnce(new Error('boom') as never);
    const { result } = renderHook(() => useGenesisChat(BASE, true) as RuntimeBinding);
    await act(async () => {
      await result.current.submit('Calculate 47 + 58 using Agent Bridge.');
    });
    expect(result.current.snapshot.error).toBe('boom');
    expect(result.current.snapshot.messages).toEqual([]);
  });
});
