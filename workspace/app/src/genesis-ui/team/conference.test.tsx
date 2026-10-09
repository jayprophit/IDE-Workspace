import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GenesisShell } from '../GenesisShell';
import { FIXTURE_TEAM } from '../fixtures';
import type { TeamMember } from '../types';

/**
 * C1/C5 corrections: worker selection and conference keyboard behaviour.
 *
 * The rule being defended throughout: selection is host-driven UI state. It is
 * never auto-selected, it never changes a worker's identity, and the same
 * value drives the conference tile, the team strip and the worker detail view
 * so they cannot disagree about who is selected.
 */

/** Build a roster of any size by cloning fixture members with fresh ids. */
function rosterOf(count: number): TeamMember[] {
  return Array.from({ length: count }, (_, i) => {
    const base = FIXTURE_TEAM[i % FIXTURE_TEAM.length];
    return { ...base, id: `w${i}`, name: `Worker${i}` };
  });
}

const tile = (id: string) => screen.getByTestId(`conference-tile-${id}`);

/** Drill-down is explicit: select a tile, then open the detail. */
async function openWorkerDetail(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /open worker detail/i }));
}

describe('C1 - selected worker state', () => {
  it('starts with nothing selected, because selection is never fabricated', () => {
    render(<GenesisShell />);
    expect(screen.getByTestId('nav-team')).toBeTruthy();
    /* No tile may claim selection before the user chooses. */
    expect(document.querySelectorAll('.gx-tile[data-selected="true"]')).toHaveLength(0);
    expect(screen.queryByText('Selected')).not.toBeInTheDocument();
  });

  it('marks exactly the chosen worker as selected', async () => {
    const user = userEvent.setup();
    render(<GenesisShell />);
    await user.click(screen.getByTestId('nav-team'));

    await user.click(tile(FIXTURE_TEAM[1].id));

    const selected = document.querySelectorAll('.gx-tile[data-selected="true"]');
    expect(selected).toHaveLength(1);
    expect(tile(FIXTURE_TEAM[1].id)).toHaveAttribute('data-selected', 'true');
  });

  it('exposes selection semantically, not only visually', async () => {
    const user = userEvent.setup();
    render(<GenesisShell />);
    await user.click(screen.getByTestId('nav-team'));
    await user.click(tile(FIXTURE_TEAM[0].id));

    const chosen = tile(FIXTURE_TEAM[0].id);
    expect(chosen).toHaveAttribute('aria-selected', 'true');
    expect(chosen).toHaveAttribute('aria-current', 'true');
    /* A text label too, so the state does not depend on colour vision. */
    expect(within(chosen).getByText('Selected')).toBeInTheDocument();
  });

  it('deselects the previous worker when another is chosen', async () => {
    const user = userEvent.setup();
    render(<GenesisShell />);
    await user.click(screen.getByTestId('nav-team'));

    await user.click(tile(FIXTURE_TEAM[0].id));
    await user.click(tile(FIXTURE_TEAM[2].id));

    expect(tile(FIXTURE_TEAM[0].id)).toHaveAttribute('data-selected', 'false');
    expect(tile(FIXTURE_TEAM[2].id)).toHaveAttribute('data-selected', 'true');
    expect(document.querySelectorAll('.gx-tile[data-selected="true"]')).toHaveLength(1);
  });

  it('selection does not alter worker identity', async () => {
    const user = userEvent.setup();
    render(<GenesisShell />);
    await user.click(screen.getByTestId('nav-team'));

    await user.click(tile(FIXTURE_TEAM[0].id));
    const nameBefore = within(tile(FIXTURE_TEAM[0].id)).getByText(FIXTURE_TEAM[0].name).textContent;

    /* Selecting a different worker, then coming back, must not have renamed
     * or reshaped the first one. */
    await user.click(tile(FIXTURE_TEAM[1].id));
    await user.click(tile(FIXTURE_TEAM[0].id));

    expect(within(tile(FIXTURE_TEAM[0].id)).getByText(FIXTURE_TEAM[0].name).textContent).toBe(nameBefore);

    await openWorkerDetail(user);
    const detail = screen.getByTestId('worker-detail');
    /* Scope to the detail panel: the name also appears in the persistent
     * team strip, so an unscoped query would match both. */
    expect(within(detail).getByText(FIXTURE_TEAM[0].name)).toBeInTheDocument();
  });

  it('selection survives the conference -> worker detail transition', async () => {
    const user = userEvent.setup();
    render(<GenesisShell />);
    await user.click(screen.getByTestId('nav-team'));
    await user.click(tile(FIXTURE_TEAM[3].id));
    await openWorkerDetail(user);

    /* We are now on worker detail for that same worker. */
    expect(screen.getByTestId('worker-detail')).toBeInTheDocument();

    /* Going back to the conference, the same tile is still selected. */
    await user.click(screen.getByTestId('nav-team'));
    expect(tile(FIXTURE_TEAM[3].id)).toHaveAttribute('data-selected', 'true');
    expect(document.querySelectorAll('.gx-tile[data-selected="true"]')).toHaveLength(1);
  });

  it('the team strip and the conference agree on the selection', async () => {
    const user = userEvent.setup();
    render(<GenesisShell />);
    await user.click(screen.getByTestId('nav-team'));

    await user.click(tile(FIXTURE_TEAM[2].id));
    await user.click(screen.getByTestId('nav-team'));

    const stripMember = screen.getAllByTestId(`team-strip-${FIXTURE_TEAM[2].id}`)[0];
    expect(stripMember).toHaveAttribute('aria-pressed', 'true');
    expect(stripMember).toHaveAttribute('aria-current', 'true');
  });

  it('carries selection through into focus mode', async () => {
    const user = userEvent.setup();
    render(<GenesisShell />);
    await user.click(screen.getByTestId('nav-team'));
    await user.click(tile(FIXTURE_TEAM[0].id));

    /* Focus mode is chrome-free, so the conference is not on screen to check
     * the highlight against. What must hold is that the worker focus surface
     * resolves to the selected worker and not to a default. */
    await user.click(screen.getByTestId('nav-settings'));
    await user.click(screen.getByTestId('layout-focus'));
    await user.click(screen.getByTestId('nav-team'));
    await openWorkerDetail(user);

    const focus = screen.getByTestId('genesis-focus');
    expect(focus).toBeInTheDocument();
    expect(focus).toHaveAttribute('data-genesis-layout', 'focus');
    expect(within(focus).getByText(FIXTURE_TEAM[0].name)).toBeInTheDocument();
  });
});

describe('C5 - conference keyboard navigation', () => {
  it('keeps exactly one tile in the tab order', async () => {
    const user = userEvent.setup();
    render(<GenesisShell />);
    await user.click(screen.getByTestId('nav-team'));

    const tiles = screen.getAllByRole('option');
    expect(tiles.length).toBeGreaterThan(1);
    expect(tiles.filter((t) => t.getAttribute('tabindex') === '0')).toHaveLength(1);
    expect(tiles.filter((t) => t.getAttribute('tabindex') === '-1')).toHaveLength(tiles.length - 1);
  });

  it('moves between tiles with the arrow keys', async () => {
    const user = userEvent.setup();
    render(<GenesisShell />);
    await user.click(screen.getByTestId('nav-team'));

    await user.tab();
    const first = tile(FIXTURE_TEAM[0].id);
    first.focus();

    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(tile(FIXTURE_TEAM[1].id));
    expect(tile(FIXTURE_TEAM[1].id)).toHaveAttribute('tabindex', '0');

    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(tile(FIXTURE_TEAM[2].id));

    await user.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(tile(FIXTURE_TEAM[1].id));
  });

  it('clamps at the ends rather than wrapping', async () => {
    const user = userEvent.setup();
    render(<GenesisShell />);
    await user.click(screen.getByTestId('nav-team'));
    tile(FIXTURE_TEAM[0].id).focus();

    await user.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(tile(FIXTURE_TEAM[0].id));

    await user.keyboard('{End}');
    const last = FIXTURE_TEAM[FIXTURE_TEAM.length - 1].id;
    expect(document.activeElement).toBe(tile(last));

    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(tile(last));
  });

  it('jumps to the first tile with Home', async () => {
    const user = userEvent.setup();
    render(<GenesisShell />);
    await user.click(screen.getByTestId('nav-team'));
    tile(FIXTURE_TEAM[FIXTURE_TEAM.length - 1].id).focus();

    await user.keyboard('{Home}');
    expect(document.activeElement).toBe(tile(FIXTURE_TEAM[0].id));
  });

  it('does not trap focus: Tab leaves the grid entirely', async () => {
    const user = userEvent.setup();
    render(<GenesisShell />);
    await user.click(screen.getByTestId('nav-team'));
    tile(FIXTURE_TEAM[0].id).focus();

    /* Tab must not be swallowed by the grid, which would trap a keyboard
     * user inside the conference. */
    await user.keyboard('{Tab}');
    expect(tile(FIXTURE_TEAM[0].id)).not.toHaveFocus();
  });

  it('activates a tile with Enter, which selects that worker', async () => {
    const user = userEvent.setup();
    render(<GenesisShell />);
    await user.click(screen.getByTestId('nav-team'));
    tile(FIXTURE_TEAM[0].id).focus();

    await user.keyboard('{Enter}');
    expect(tile(FIXTURE_TEAM[0].id)).toHaveAttribute('data-selected', 'true');
  });

  it('exposes the grid as a labelled listbox of options', async () => {
    const user = userEvent.setup();
    render(<GenesisShell />);
    await user.click(screen.getByTestId('nav-team'));

    const grid = screen.getByRole('listbox', { name: 'Conference participants' });
    expect(grid).toBeInTheDocument();
    expect(within(grid).getAllByRole('option').length).toBe(FIXTURE_TEAM.length);
  });
});

describe('C5 - presence announcements', () => {
  it('renders a polite live region for the conference', async () => {
    const user = userEvent.setup();
    render(<GenesisShell />);
    await user.click(screen.getByTestId('nav-team'));

    const announcer = screen.getByTestId('presence-announcer');
    expect(announcer).toHaveAttribute('aria-live', 'polite');
    /* Quiet by default: an unchanged roster must not speak on mount. */
    expect(announcer).toHaveTextContent('');
  });
});

describe('C2 - conference grid across roster sizes', () => {
  /* The grid must hold up for any team size. These counts are asserted for
   * structure only: no crash, no invented members, every member present. */
  for (const count of [1, 2, 3, 4, 5, 6, 7, 8, 10, 12]) {
    it(`renders a ${count}-member roster with one tile each`, async () => {
      const user = userEvent.setup();
      render(<GenesisShell members={rosterOf(count)} />);
      await user.click(screen.getByTestId('nav-team'));

      const tiles = within(screen.getByTestId('conference-grid')).getAllByRole('option');
      expect(tiles).toHaveLength(count);
      for (let i = 0; i < count; i += 1) {
        expect(tiles[i]).toHaveAttribute('data-testid', `conference-tile-w${i}`);
      }
    });
  }

  it('never pads or truncates the roster to a round number', async () => {
    const user = userEvent.setup();
    render(<GenesisShell members={rosterOf(7)} />);
    await user.click(screen.getByTestId('nav-team'));
    /* 7 is awkward on purpose. Nothing may be added to make the row tidy. */
    expect(within(screen.getByTestId('conference-grid')).getAllByRole('option')).toHaveLength(7);
  });

  it('keeps a single tabbable tile at every roster size', async () => {
    const user = userEvent.setup();
    for (const count of [1, 2, 7, 12]) {
      const { unmount } = render(<GenesisShell members={rosterOf(count)} key={count} />);
      await user.click(screen.getByTestId('nav-team'));
      const tiles = screen.getAllByRole('option');
      expect(tiles.filter((t) => t.getAttribute('tabindex') === '0'), `roster of ${count}`).toHaveLength(1);
      unmount();
    }
  });
});

describe('regressions preserved', () => {
  it('renderer seam and honesty are untouched by selection', async () => {
    const user = userEvent.setup();
    render(<GenesisShell />);
    await user.click(screen.getByTestId('nav-team'));
    await user.click(tile(FIXTURE_TEAM[0].id));

    /* Selecting a worker must not turn the placeholder into something live. */
    const frames = document.querySelectorAll('[data-live]');
    expect(frames.length).toBeGreaterThan(0);
    for (const f of Array.from(frames)) {
      expect(f.getAttribute('data-live')).toBe('false');
    }
    expect(screen.getByTestId('status-renderer')).toHaveTextContent('not live');
  });

  it('an empty team still reports honestly rather than padding the grid', () => {
    render(<GenesisShell members={[]} />);
    expect(screen.getAllByText(/No team loaded/i).length).toBeGreaterThan(0);
    expect(screen.queryByTestId('conference-grid')).not.toBeInTheDocument();
  });
});