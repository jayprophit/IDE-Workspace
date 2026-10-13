import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { resolve } from 'node:path';

/**
 * Entry points:
 *   /                    -> the workspace IDE shell (src/main.tsx)
 *   /genesis-ui.html     -> the Genesis avatar-first UI scaffold
 *   /supervisor-ui.html  -> the Supervisor Dashboard (Agent Bridge telemetry)
 *
 * Three separate entries rather than one app with routes, so each unit can be
 * reviewed, built and (where applicable) deprecated on its own. genesis-ui and
 * supervisor-ui share no module; that isolation is enforced by bounds.test.ts.
 */

/**
 * Supervisor loopback proxy (dev + preview only).
 *
 * The supervisor API is a stdlib `http.server` on 127.0.0.1 that sends no CORS
 * headers, so a browser on :5199/:5203 cannot read it cross-origin. Rather
 * than change Agent-Bridge (out of scope for this unit) or add a second
 * transport, the dev server forwards the three documented routes unchanged.
 *
 * This is a transport detail, not a new protocol: same host, same paths, same
 * SSE framing, same client. `supervisor-ui` talks to `/api/supervisor/*` in
 * dev, which is one path segment ahead of the real route; nothing else changes.
 *
 * A production deployment should serve the dashboard same-origin behind an
 * equivalent reverse proxy. That is recorded in the unit's handoff notes.
 */
const SUPERVISOR_TARGET = 'http://127.0.0.1:8472';

/**
 * Proxy prefix is `/api`, NOT `/api/supervisor`.
 *
 * The client owns the `/v1/supervisor` path segments and appends them to the
 * base. So the base must be a bare `/api` and the proxy must pass the rest
 * through untouched: /api/v1/supervisor/state -> /v1/supervisor/state.
 *
 * The earlier `/api/supervisor` prefix was the bug: the client produced
 * /api/supervisor/v1/supervisor/state, the proxy stripped its own prefix and
 * emitted /v1/supervisor/v1/supervisor/state, and the backend 404'd. Two
 * layers each adding a version segment is how that happens.
 */
const supervisorProxy = {
  '/api': {
    target: SUPERVISOR_TARGET,
    changeOrigin: false,
    /* Strip only the proxy prefix. The client owns the /v1/supervisor segments,
     * so /api/v1/supervisor/state forwards as /v1/supervisor/state. */
    rewrite: (p: string) => p.replace(/^\/api/, ''),
  },
};

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5199,
    host: '127.0.0.1',
    strictPort: true,
    proxy: supervisorProxy,
  },
  preview: {
    port: 5199,
    host: '127.0.0.1',
    proxy: supervisorProxy,
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        'genesis-ui': resolve(__dirname, 'genesis-ui.html'),
        'supervisor-ui': resolve(__dirname, 'supervisor-ui.html'),
        'supervisor-m2': resolve(__dirname, 'supervisor-m2.html'),
      },
    },
  },
});