import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { resolve } from 'node:path';

/**
 * Two entry points:
 *   /              -> the existing workspace IDE shell (src/main.tsx)
 *   /genesis-ui.html -> the Genesis avatar-first UI scaffold, standalone
 *
 * The scaffold is a separate HTML entry rather than a route in the shell so it
 * can be reviewed in isolation without changing how the existing shell boots.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5199,
    host: '127.0.0.1',
    strictPort: true,
  },
  preview: {
    port: 5199,
    host: '127.0.0.1',
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        'genesis-ui': resolve(__dirname, 'genesis-ui.html'),
      },
    },
  },
});
