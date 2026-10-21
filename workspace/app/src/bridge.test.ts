/**
 * The bridge status poll must not spend the Bridge's request budget.
 *
 * The Bridge allows 120 requests a minute per address, and everything on
 * the machine shares 127.0.0.1. The IDE polls every five seconds, so
 * three requests per poll meant one tab used a third of the whole
 * budget and four tabs exhausted it. When that happened the Bridge
 * answered 429 and the IDE reported itself disconnected, which is a
 * false statement about the state of the machine.
 *
 * The runtime route carries the health and the model inventory, so one
 * request is enough. These tests pin that, so the saving cannot quietly
 * disappear, and they pin the fallback for a Bridge that does not carry
 * the models in its runtime snapshot.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchBridgeStatus } from './bridge';

type Stubbed = {
  calls: string[];
  respond: (url: string) => { status: number; body: unknown };
};

function stubFetch(respond: (url: string) => { status: number; body: unknown }): Stubbed {
  const calls: string[] = [];
  vi.stubGlobal('fetch', (url: string) => {
    calls.push(String(url));
    const { status, body } = respond(String(url));
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    } as unknown as Response);
  });
  return { calls, respond };
}

const RUNTIME_WITH_MODELS = {
  timestamp: 1,
  tasks: [],
  queue_depth: 0,
  queued_ids: [],
  active_model: '',
  models: [{ name: 'hhao/qwen2.5-coder-tools:3b', parameter_size: '3B' }],
  workers: [],
  approvals_pending: [],
  progress_pct: 0,
  results: [],
  evidence_refs: [],
  resources: {},
  health: 'HEALTHY',
  errors: [],
};

const RUNTIME_WITHOUT_MODELS = { ...RUNTIME_WITH_MODELS, models: [] };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchBridgeStatus', () => {
  it('asks the Bridge once when the runtime route carries the health and the models', async () => {
    const stub = stubFetch((url) => {
      if (url.endsWith('/v1/runtime')) {
        return { status: 200, body: RUNTIME_WITH_MODELS };
      }
      return { status: 404, body: { error: 'unknown route' } };
    });

    const status = await fetchBridgeStatus('http://127.0.0.1:8471');

    expect(status.connected).toBe(true);
    expect(status.health).toBe('HEALTHY');
    expect(status.models).toHaveLength(1);
    expect(status.models[0].name).toBe('hhao/qwen2.5-coder-tools:3b');
    /* One request for one answer. The Bridge's budget is shared with
     * everything else on the machine. */
    expect(stub.calls).toEqual(['http://127.0.0.1:8471/v1/runtime']);
  });

  it('falls back to the model route when the runtime snapshot carries no models', async () => {
    const stub = stubFetch((url) => {
      if (url.endsWith('/v1/runtime')) {
        return { status: 200, body: RUNTIME_WITHOUT_MODELS };
      }
      if (url.endsWith('/v1/models')) {
        return {
          status: 200,
          body: { models: [{ name: 'granite3.3:2b' }] },
        };
      }
      return { status: 404, body: { error: 'unknown route' } };
    });

    const status = await fetchBridgeStatus('http://127.0.0.1:8471');

    expect(status.connected).toBe(true);
    expect(status.models).toHaveLength(1);
    expect(status.models[0].name).toBe('granite3.3:2b');
    expect(stub.calls).toHaveLength(2);
  });

  it('reports the health route when the runtime does not carry a health string', async () => {
    const stub = stubFetch((url) => {
      if (url.endsWith('/v1/runtime')) {
        return {
          status: 200,
          body: { ...RUNTIME_WITH_MODELS, health: { status: 'DEGRADED' } },
        };
      }
      if (url.endsWith('/health')) {
        return { status: 200, body: { status: 'HEALTHY' } };
      }
      return { status: 404, body: { error: 'unknown route' } };
    });

    const status = await fetchBridgeStatus('http://127.0.0.1:8471');

    expect(status.health).toBe('HEALTHY');
    expect(stub.calls.some((c) => c.endsWith('/health'))).toBe(true);
  });

  it('carries the reason the Bridge could not be reached', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.reject(new Error('HTTP 429')),
    );

    const status = await fetchBridgeStatus('http://127.0.0.1:8471');

    expect(status.connected).toBe(false);
    /* A rate-limited Bridge and a Bridge that is not running have
     * different fixes, so the reason has to survive to the interface. */
    expect(status.error).toContain('429');
  });
});
