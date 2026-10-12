import { vi } from 'vitest';
import type { SupervisorEvent } from './types';

/**
 * A controlled `fetch` for tests.
 *
 * jsdom has no server, and the dashboard polls on timers. Rather than mocking
 * the client module (which would let a bug in the URL construction hide), this
 * replaces `fetch` and records what was asked for. So a test also asserts the
 * client hit the documented loopback routes.
 */

export interface FetchCall {
  url: string;
  method: string;
}

export interface FakeRoutes {
  state: unknown;
  health: unknown;
  events: { ok: boolean; events: SupervisorEvent[] };
  /** Force a failure for every route, to exercise the degraded path. */
  failAll?: boolean;
}

function json(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as unknown as Response;
}

function text(body: string, ok = true, status = 200) {
  return { ok, status, text: async () => body } as unknown as Response;
}

/** SSE body in the exact framing the Python server emits. */
export function sseBody(events: SupervisorEvent[]): string {
  return events
    .map((e, i) => `id: ${e.seq}\nevent: supervisor\ndata: ${JSON.stringify(e)}\n`)
    .join('\n');
}

export function installFakeFetch(calls: FetchCall[], routes: FakeRoutes) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method ?? 'GET' });
      if (routes.failAll) throw new Error('network unreachable');

      if (String(url).includes('/v1/supervisor/state')) return json(routes.state);
      if (String(url).includes('/v1/supervisor/health')) return json(routes.health);
      if (String(url).includes('/v1/supervisor/events')) {
        return routes.events.ok ? text(sseBody(routes.events.events)) : json({}, false, 500);
      }
      throw new Error(`unstubbed route: ${url}`);
    }),
  );
  return calls;
}

export function clearFakeFetch() {
  vi.unstubAllGlobals();
}