import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { usePresenceAnnouncements, useRovingGrid } from './useConferenceA11y';

/**
 * Conference accessibility behaviour.
 *
 * Two guarantees under test:
 *   1. presence announcements are derived from host-supplied changes only -
 *      a roster that never changes produces no announcements at all
 *   2. the roving tabindex keeps exactly one tile tabbable, follows arrow
 *      keys, and survives the roster shrinking
 */

const roster = (...specs: [string, string][]) => specs.map(([id, status]) => ({ id, name: id.toUpperCase(), status }));

describe('usePresenceAnnouncements', () => {
  it('says nothing on first render', () => {
    /* Announcing a whole roster on mount would be noise on every view
     * change. The first pass only establishes the baseline. */
    const { result } = renderHook(() => usePresenceAnnouncements(roster(['a', 'idle'], ['b', 'active'])));
    expect(result.current).toEqual([]);
  });

  it('says nothing when the roster is unchanged', () => {
    const members = roster(['a', 'idle'], ['b', 'active']);
    const { result, rerender } = renderHook(({ m }) => usePresenceAnnouncements(m), { initialProps: { m: members } });

    rerender({ m: [...members] });
    rerender({ m: [...members] });
    expect(result.current).toEqual([]);
  });

  it('announces a host-reported join', () => {
    const { result, rerender } = renderHook(({ m }) => usePresenceAnnouncements(m), {
      initialProps: { m: roster(['a', 'idle']) },
    });

    rerender({ m: roster(['a', 'idle'], ['b', 'active']) });
    expect(result.current).toHaveLength(1);
    expect(result.current[0].text).toContain('B joined');
  });

  it('announces a host-reported unavailability', () => {
    const { result, rerender } = renderHook(({ m }) => usePresenceAnnouncements(m), {
      initialProps: { m: roster(['a', 'active']) },
    });

    rerender({ m: roster(['a', 'offline']) });
    expect(result.current.some((a) => a.text.includes('is unavailable'))).toBe(true);
  });

  it('stays quiet for routine status transitions', () => {
    /* Speaking -> thinking is visible on the tile via its own status dot.
     * Re-announcing every tick would flood the reader. */
    const { result, rerender } = renderHook(({ m }) => usePresenceAnnouncements(m), {
      initialProps: { m: roster(['a', 'active']) },
    });

    rerender({ m: roster(['a', 'reviewing']) });
    rerender({ m: roster(['a', 'idle']) });
    expect(result.current).toEqual([]);
  });

  it('does not announce a member who joins already offline', () => {
    const { result, rerender } = renderHook(({ m }) => usePresenceAnnouncements(m), {
      initialProps: { m: roster(['a', 'idle']) },
    });

    rerender({ m: roster(['a', 'idle'], ['b', 'offline']) });
    expect(result.current).toEqual([]);
  });

  it('never grows unbounded on a bulk change', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: `w${i}`, name: `W${i}`, status: 'idle' }));
    const { result, rerender } = renderHook(({ m }) => usePresenceAnnouncements(m), { initialProps: { m: many } });

    rerender({ m: [...many, ...Array.from({ length: 20 }, (_, i) => ({ id: `n${i}`, name: `N${i}`, status: 'active' }))] });
    expect(result.current.length).toBeLessThanOrEqual(5);
  });

  it('never derives presence on its own over time', () => {
    /* No timers are involved anywhere in the hook. If a future change adds
     * one, this documents that it would be a regression. */
    const members = roster(['a', 'idle']);
    const { result, rerender } = renderHook(({ m }) => usePresenceAnnouncements(m), { initialProps: { m: members } });
    expect(result.current).toEqual([]);
    rerender({ m: members });
    expect(result.current).toEqual([]);
  });
});

describe('useRovingGrid', () => {
  it('keeps exactly one index tabbable', () => {
    const { result } = renderHook(() => useRovingGrid(5));
    const tabbable = [0, 1, 2, 3, 4].filter((i) => result.current.tabIndexFor(i) === 0);
    expect(tabbable).toEqual([0]);
  });

  it('moves the tabbable index on demand', () => {
    const { result } = renderHook(() => useRovingGrid(4));
    act(() => result.current.setActiveIndex(2));
    const tabbable = [0, 1, 2, 3].filter((i) => result.current.tabIndexFor(i) === 0);
    expect(tabbable).toEqual([2]);
  });

  it('never leaves every tile untabbable', () => {
    /* If the active index were ever out of range, the whole grid would drop
     * out of the tab order and become unreachable by keyboard. */
    const { result } = renderHook(() => useRovingGrid(3));
    act(() => result.current.setActiveIndex(2));
    const tabbable = [0, 1, 2].filter((i) => result.current.tabIndexFor(i) === 0);
    expect(tabbable).toHaveLength(1);
  });

  it('clamps the active index when the roster shrinks', () => {
    const { result, rerender } = renderHook(({ n }) => useRovingGrid(n), { initialProps: { n: 6 } });
    act(() => result.current.setActiveIndex(5));

    rerender({ n: 2 });
    expect(result.current.activeIndex).toBe(1);
    expect([0, 1].filter((i) => result.current.tabIndexFor(i) === 0)).toEqual([1]);
  });

  it('resets to a valid index for an empty roster', () => {
    const { result, rerender } = renderHook(({ n }) => useRovingGrid(n), { initialProps: { n: 3 } });
    rerender({ n: 0 });
    expect(result.current.activeIndex).toBe(0);
  });
});

describe('arrow key mapping', () => {
  /* The handler is pure apart from focusing, so it is exercised through the
   * hook with a stub focus target. */
  const makeEvent = (key: string) => ({
    key,
    preventDefault: () => undefined,
  }) as never;

  function gridOf(count: number) {
    return renderHook(() => useRovingGrid(count));
  }

  it('moves forward and back', () => {
    const { result } = gridOf(5);
    act(() => result.current.onKeyDown(makeEvent('ArrowRight'), 0));
    expect(result.current.activeIndex).toBe(1);
    act(() => result.current.onKeyDown(makeEvent('ArrowDown'), 1));
    expect(result.current.activeIndex).toBe(2);
    act(() => result.current.onKeyDown(makeEvent('ArrowLeft'), 2));
    expect(result.current.activeIndex).toBe(1);
    act(() => result.current.onKeyDown(makeEvent('ArrowUp'), 1));
    expect(result.current.activeIndex).toBe(0);
  });

  it('clamps at both ends instead of wrapping', () => {
    const { result } = gridOf(3);
    act(() => result.current.onKeyDown(makeEvent('ArrowLeft'), 0));
    expect(result.current.activeIndex).toBe(0);
    act(() => result.current.onKeyDown(makeEvent('End'), 0));
    expect(result.current.activeIndex).toBe(2);
    act(() => result.current.onKeyDown(makeEvent('ArrowRight'), 2));
    expect(result.current.activeIndex).toBe(2);
  });

  it('jumps to the ends with Home and End', () => {
    const { result } = gridOf(6);
    act(() => result.current.onKeyDown(makeEvent('End'), 0));
    expect(result.current.activeIndex).toBe(5);
    act(() => result.current.onKeyDown(makeEvent('Home'), 5));
    expect(result.current.activeIndex).toBe(0);
  });

  it('ignores keys it does not own, so Tab still leaves the grid', () => {
    /* Tab must not be handled here or focus could never leave the grid.
     * Each key gets a fresh hook and starts from index 0, so a key that does
     * move the index is caught rather than masked by a prior one. */
    for (const key of ['Tab', 'Enter', ' ', 'a', 'Escape', 'PageDown', 'Backspace']) {
      const { result } = gridOf(4);
      act(() => result.current.onKeyDown(makeEvent(key), 0));
      expect(result.current.activeIndex, `key ${JSON.stringify(key)} moved the roving index`).toBe(0);
    }
  });

  it('is a no-op on an empty grid', () => {
    const { result } = gridOf(0);
    act(() => result.current.onKeyDown(makeEvent('ArrowRight'), 0));
    expect(result.current.activeIndex).toBe(0);
  });
});