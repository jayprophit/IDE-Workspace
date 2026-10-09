import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

/**
 * Conference grid keyboard + presence announcement behaviour.
 *
 * Extracted from `TeamViews.tsx` because both concerns are stateful and testable
 * on their own, and neither belongs in a presentational render.
 *
 * Truth rules:
 *   - nothing here infers presence. Announcements are derived by diffing the
 *     host-supplied roster between renders, so a status that never changed is
 *     never announced.
 *   - the roving index is a focus-management detail, not domain state. It
 *     follows the roster when members join or leave rather than stranding
 *     focus on a removed tile.
 */

/** Announce only transitions a person would actually need to know about. */
export interface PresenceAnnouncement {
  id: string;
  text: string;
}

/** What a status change means for a listener, grouped so we stay quiet. */
function meaningful(before: string | undefined, after: string): string | null {
  /* Joining: was absent, now present. */
  if (before === undefined) {
    return after === 'offline' ? null : `joined`;
  }
  if (before === after) return null;
  /* Going unavailable is worth announcing; other transitions are not, because
   * the tile's own status dot and label already convey them visually and
   * re-announcing on every status tick would flood the reader. */
  if (after === 'offline') return 'is unavailable';
  return null;
}

/**
 * Derive announcements from host-supplied roster changes.
 *
 * Diffs on member id + status only. `currentTask` changing is deliberately not
 * announced: it is a frequent update and the reader did not ask for it.
 */
export function usePresenceAnnouncements(members: { id: string; name: string; status: string }[]): PresenceAnnouncement[] {
  const previous = useRef<Map<string, string> | null>(null);
  const [announcements, setAnnouncements] = useState<PresenceAnnouncement[]>([]);

  useEffect(() => {
    const next = new Map(members.map((m) => [m.id, m.status]));
    const prior = previous.current;

    /* First pass establishes the baseline and says nothing. Announcing a whole
     * roster on mount would be noise on every view change. */
    if (prior === null) {
      previous.current = next;
      return;
    }

    const produced: PresenceAnnouncement[] = [];
    for (const member of members) {
      const phrase = meaningful(prior.get(member.id), member.status);
      if (phrase) produced.push({ id: `${member.id}-${member.status}`, text: `${member.name} ${phrase}` });
    }
    /* Someone left the roster entirely. */
    for (const [id] of prior) {
      if (!next.has(id)) {
        const name = members.find((m) => m.id === id)?.name;
        if (name) produced.push({ id: `${id}-left`, text: `${name} left the session` });
      }
    }

    previous.current = next;
    /* Bounded: only the newest few, so a bulk change cannot grow unbounded. */
    if (produced.length > 0) setAnnouncements((prev) => [...produced, ...prev].slice(0, 5));
  }, [members]);

  return announcements;
}

/**
 * Roving tabindex over the conference tiles.
 *
 * One tile is in the tab order at a time; arrows move between tiles, Home/End
 * jump to the ends. Enter and Space activate, which is native button behaviour
 * and needs no handler here.
 *
 * Focus is never trapped: Tab leaves the grid entirely, because only the
 * active tile carries tabIndex=0 and the rest are -1.
 */
export function useRovingGrid(count: number) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);

  /* Keep the index valid when the roster changes. Without this, removing a
   * member could leave the grid pointing past its own end. */
  useEffect(() => {
    setActiveIndex((i) => (count === 0 ? 0 : Math.min(i, count - 1)));
  }, [count]);

  const focusIndex = useCallback((index: number) => {
    setActiveIndex(index);
    const node = refs.current[index];
    if (node) node.focus();
  }, []);

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
      const last = count - 1;
      if (last < 0) return;

      let next: number | null = null;
      switch (event.key) {
        case 'ArrowRight':
        case 'ArrowDown':
          next = Math.min(index + 1, last);
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
          next = Math.max(index - 1, 0);
          break;
        case 'Home':
          next = 0;
          break;
        case 'End':
          next = last;
          break;
        default:
          return;
      }

      event.preventDefault();
      focusIndex(next);
    },
    [count, focusIndex],
  );

  return useMemo(
    () => ({
      activeIndex,
      setActiveIndex,
      registerRef: (index: number) => (node: HTMLButtonElement | null) => {
        refs.current[index] = node;
      },
      onKeyDown,
      /** Only the active tile is tabbable; the rest are reachable by arrows. */
      tabIndexFor: (index: number) => (index === activeIndex ? 0 : -1),
    }),
    [activeIndex, onKeyDown],
  );
}