import type { PresenceAnnouncement } from './useConferenceA11y';

/**
 * Live region for presence announcements.
 *
 * Kept in its own `.tsx` so `useConferenceA11y.ts` can stay a hook module
 * without JSX, and so `TeamViews.tsx` imports the component from one place.
 *
 * Behaviour is deliberately restrained:
 *   - `aria-live="polite"`, so it never interrupts the reader
 *   - `aria-atomic="false"`, so only the changed line is spoken
 *   - it renders nothing at all until the host actually reports a change
 *
 * The content is supplied by `usePresenceAnnouncements`, which diffs the roster.
 * Nothing here infers presence from a timer.
 */
export function PresenceAnnouncer({ announcements }: { announcements: PresenceAnnouncement[] }) {
  return (
    <div aria-live="polite" aria-atomic="false" className="gx-sr-only" data-testid="presence-announcer">
      {announcements.map((a) => (
        <p key={`${a.id}-${a.text}`}>{a.text}</p>
      ))}
    </div>
  );
}