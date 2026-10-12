import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SupervisorDashboard } from './SupervisorDashboard';

/**
 * Standalone entry point for the Supervisor Dashboard UI.
 *
 * Separate from the genesis-ui scaffold and from the workspace shell. This is a
 * read-only view; it has no avatar, no renderer and no runtime binding, and it
 * shares nothing with those units.
 *
 * No base URL is passed, so it uses the same-origin default, which the dev
 * server proxies to the loopback service. Pointing it straight at
 * `http://127.0.0.1:8472` from a browser would fail: that service is a stdlib
 * http.server and sends no CORS headers.
 */

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SupervisorDashboard />
  </StrictMode>,
);