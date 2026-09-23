import type { RightPanelId } from './state';
import { isRightPanelId } from './state';

/**
 * Detached secondary windows (P23 remainder slice).
 *
 * A detached panel opens in a REAL secondary browser window via
 * window.open — never a CSS overlay masquerading as multi-window. The child
 * window loads the same application with ?detach=<panel> and reads the SAME
 * canonical backends (bridge status, persisted layout); it receives no
 * authority, principal, grant or task state through the URL. View lifecycle
 * stays separate from execution lifecycle throughout.
 */

export const DETACH_PARAM = 'detach';

export interface DetachedHandle {
  closed: boolean;
  close(): void;
  focus(): void;
}

export interface WindowOpener {
  open(url: string, target: string, features?: string): DetachedHandle | null;
}

/** Build the detach URL: same origin/path, panel id as the only parameter. */
export function detachUrl(baseHref: string, panelId: RightPanelId): string {
  const [originPath] = baseHref.split('?');
  return `${originPath}?${DETACH_PARAM}=${encodeURIComponent(panelId)}`;
}

/** Parse a detach request from a location href. Null when not detaching. */
export function parseDetachRequest(href: string): RightPanelId | null {
  const query = href.split('?')[1] ?? '';
  const params = new URLSearchParams(query);
  const raw = params.get(DETACH_PARAM);
  if (!raw) return null;
  // Only allowlisted panel ids; anything else falls back to the full shell.
  return isRightPanelId(raw) ? raw : null;
}

/**
 * Open a detached view. Returns the handle, or null when the host blocks
 * popups — the caller must then keep the panel in-shell (fallback).
 * Throws never; failures are returned as null with a reason.
 */
export function openDetachedWindow(
  opener: WindowOpener,
  baseHref: string,
  panelId: RightPanelId,
): { handle: DetachedHandle | null; blocked: boolean } {
  let handle: DetachedHandle | null = null;
  try {
    handle = opener.open(detachUrl(baseHref, panelId), `aetherius-panel-${panelId}`, 'width=420,height=800');
  } catch {
    handle = null;
  }
  if (!handle) return { handle: null, blocked: true };
  try {
    handle.focus();
  } catch {
    // Focus is best-effort; the window itself is what matters.
  }
  return { handle, blocked: false };
}

/** Reattach bookkeeping: close the tracked handle if still open. */
export function closeDetachedHandle(handle: DetachedHandle | null): boolean {
  if (!handle || handle.closed) return false;
  try {
    handle.close();
    return true;
  } catch {
    return false;
  }
}
