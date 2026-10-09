import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { GenesisShell } from './GenesisShell';

/**
 * Standalone entry point for the Genesis / Aetherius UI scaffold.
 *
 * This mounts the scaffold on its own so it can be reviewed in a browser
 * without the workspace shell around it. The existing IDE shell still boots
 * from `src/main.tsx` and is untouched.
 */

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <GenesisShell />
  </StrictMode>,
);