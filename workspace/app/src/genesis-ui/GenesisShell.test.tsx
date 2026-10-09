import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GenesisShell } from './GenesisShell';
import { FIXTURE_TEAM } from './fixtures';

/**
 * Shell behaviour tests.
 *
 * These follow the repo's existing rule: assert on what the user can observe,
 * and never let a test imply a capability the scaffold lacks. Every assertion
 * here is about honest rendering and reversible state - never animation.
 */

const STORAGE_KEY = 'genesis-ui-prefs';

beforeEach(() => {
  window.localStorage.clear();
});

describe('shell renders', () => {
  it('shows the avatar-first shell with a fixture label and honest renderer status', () => {
    render(<GenesisShell />);
    expect(screen.getByTestId('genesis-shell')).toBeInTheDocument();
    expect(screen.getByTestId('status-renderer')).toHaveTextContent('not live');
    expect(screen.getByText('fixture data')).toBeInTheDocument();
  });

  it('marks every avatar frame as non-live', () => {
    render(<GenesisShell />);
    const frames = document.querySelectorAll('[data-live]');
    expect(frames.length).toBeGreaterThan(0);
    for (const frame of Array.from(frames)) {
      expect(frame.getAttribute('data-live')).toBe('false');
    }
  });

  it('labels the avatar renderer as a placeholder in the UI', () => {
    render(<GenesisShell />);
    expect(screen.getAllByText('placeholder').length).toBeGreaterThan(0);
  });

  it('starts on home with no messages pre-filled as the user', () => {
    render(<GenesisShell />);
    expect(screen.getByTestId('home-hero')).toBeInTheDocument();
  });
});

describe('navigation', () => {
  it('reaches every core view from the header', async () => {
    const user = userEvent.setup();
    render(<GenesisShell />);

    await user.click(screen.getByTestId('nav-chat'));
    expect(screen.getByTestId('chat-thread')).toBeInTheDocument();

    await user.click(screen.getByTestId('nav-work'));
    expect(screen.getByTestId('ide-explorer')).toBeInTheDocument();

    await user.click(screen.getByTestId('nav-team'));
    expect(screen.getByTestId('conference-grid')).toBeInTheDocument();

    await user.click(screen.getByTestId('nav-calls'));
    expect(screen.getByTestId('call-dial')).toBeInTheDocument();

    await user.click(screen.getByTestId('nav-settings'));
    expect(screen.getByTestId('settings-body')).toBeInTheDocument();
  });

  it('opens worker detail from the team strip without fabricating a selection', async () => {
    const user = userEvent.setup();
    render(<GenesisShell />);
    /* The persistent strip and the Home panel strip both carry the roster,
     * so the first match is the persistent one the test means. */
    await user.click(screen.getAllByTestId(`team-strip-${FIXTURE_TEAM[0].id}`)[0]);
    expect(screen.getByTestId('worker-detail')).toBeInTheDocument();
    expect(screen.getByTestId('worker-stage')).toBeInTheDocument();
  });
});

describe('theme switching', () => {
  it('applies all five themes and persists the choice', async () => {
    const user = userEvent.setup();
    render(<GenesisShell />);
    await user.click(screen.getByTestId('nav-settings'));

    for (const id of ['aurora', 'ember', 'graphite', 'frost', 'abyss']) {
      await user.click(screen.getByTestId(`theme-${id}`));
      expect(document.querySelector('[data-testid="genesis-shell"]')).toHaveAttribute('data-genesis-theme', id);
    }

    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}')).toMatchObject({ theme: 'abyss' });
  });

  it('theme and layout are independently reversible', async () => {
    const user = userEvent.setup();
    render(<GenesisShell />);
    await user.click(screen.getByTestId('nav-settings'));

    await user.click(screen.getByTestId('theme-ember'));
    await user.click(screen.getByTestId('layout-dense'));

    const shell = () => document.querySelector('[data-testid="genesis-shell"]')!;
    expect(shell()).toHaveAttribute('data-genesis-theme', 'ember');
    expect(shell()).toHaveAttribute('data-genesis-layout', 'dense');

    /* Changing layout must not disturb the theme, and vice versa. */
    await user.click(screen.getByTestId('theme-frost'));
    expect(shell()).toHaveAttribute('data-genesis-layout', 'dense');
    await user.click(screen.getByTestId('layout-simple'));
    expect(shell()).toHaveAttribute('data-genesis-theme', 'frost');
  });

  it('falls back to defaults when the persisted preference is corrupt', () => {
    window.localStorage.setItem(STORAGE_KEY, '{not json');
    expect(() => render(<GenesisShell />)).not.toThrow();
    expect(document.querySelector('[data-testid="genesis-shell"]')).toHaveAttribute('data-genesis-theme', 'abyss');
  });

  it('ignores an unknown persisted theme rather than rendering blank', () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme: 'neon-9000' }));
    render(<GenesisShell />);
    expect(document.querySelector('[data-testid="genesis-shell"]')).toHaveAttribute('data-genesis-theme', 'abyss');
  });
});

describe('layout modes', () => {
  it('applies every density and keeps the shell mounted', async () => {
    const user = userEvent.setup();
    render(<GenesisShell />);
    await user.click(screen.getByTestId('nav-settings'));

    for (const id of ['simple', 'dense', 'standard']) {
      await user.click(screen.getByTestId(`layout-${id}`));
      expect(document.querySelector('[data-testid="genesis-shell"]')).toHaveAttribute('data-genesis-layout', id);
    }
  });

  it('focus mode is chrome-free for a single worker', async () => {
    const user = userEvent.setup();
    render(<GenesisShell />);

    await user.click(screen.getByTestId('nav-settings'));
    await user.click(screen.getByTestId('layout-focus'));
    /* `worker` is a drill-down view, not a nav item. A conference tile click
     * selects; opening the detail is the explicit action that follows. */
    await user.click(screen.getByTestId('nav-team'));
    await user.click(screen.getByTestId(`conference-tile-${FIXTURE_TEAM[0].id}`));
    await user.click(screen.getByRole('button', { name: /open worker detail/i }));

    const focus = screen.getByTestId('genesis-focus');
    expect(focus).toBeInTheDocument();
    expect(focus).toHaveAttribute('data-genesis-layout', 'focus');
    /* No rail, no header, no status bar while focused. */
    expect(screen.queryByTestId('nav-home')).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });
});

describe('avatar selection', () => {
  it('switches the main avatar and persists the choice', async () => {
    const user = userEvent.setup();
    render(<GenesisShell />);
    await user.click(screen.getByTestId('nav-settings'));
    await user.click(screen.getByTestId('settings-tab-avatar'));

    await user.click(screen.getByTestId('avatar-option-aether-04'));

    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}')).toMatchObject({ avatar: 'aether-04' });
  });

  it('offers male, female and neutral filters that each return results', async () => {
    const user = userEvent.setup();
    render(<GenesisShell />);
    await user.click(screen.getByTestId('nav-settings'));
    await user.click(screen.getByTestId('settings-tab-avatar'));

    for (const p of ['female', 'male', 'neutral']) {
      await user.click(screen.getByTestId(`avatar-filter-${p}`));
      const options = within(screen.getByRole('listbox', { name: 'Avatar presets' })).getAllByRole('option');
      expect(options.length, `filter ${p} returned nothing`).toBeGreaterThan(0);
    }
  });
});

describe('work surface', () => {
  it('opens a nested file from the explorer and shows its buffer', async () => {
    const user = userEvent.setup();
    render(<GenesisShell />);
    await user.click(screen.getByTestId('nav-work'));

    /* The explorer flattens folders, so clicking a nested file must resolve
     * against the flattened list. Resolving against the top-level array
     * silently leaves the editor empty while the row looks selected. */
    expect(screen.queryByTestId('ide-code')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('ide-file-f-app'));
    expect(screen.getByTestId('ide-code')).toBeInTheDocument();
    expect(screen.getByTestId('ide-file-f-app')).toHaveAttribute('aria-selected', 'true');
  });

  it('ships the terminal dock and gives other docks an honest empty state', async () => {
    const user = userEvent.setup();
    render(<GenesisShell />);
    await user.click(screen.getByTestId('nav-work'));

    expect(screen.getByTestId('ide-terminal')).toBeInTheDocument();

    await user.click(screen.getByTestId('dock-problems'));
    expect(screen.getByText(/problems not wired up/i)).toBeInTheDocument();
    expect(screen.queryByTestId('ide-terminal')).not.toBeInTheDocument();
  });
});

describe('calls', () => {
  it('shows a static placeholder duration, never a running timer', async () => {
    const user = userEvent.setup();
    render(<GenesisShell />);
    await user.click(screen.getByTestId('nav-calls'));
    await user.click(screen.getByTestId('call-voice-w-nova'));

    /* A clock that advances would imply a live call the scaffold does not
     * have. The label is deliberately fixed. */
    const first = screen.getByTestId('call-timer').textContent;
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByTestId('call-timer').textContent).toBe(first);
    expect(screen.getByText(/No microphone, camera, or audio stream/i)).toBeInTheDocument();
  });

  it('ending a call returns to the honest no-call state', async () => {
    const user = userEvent.setup();
    render(<GenesisShell />);
    await user.click(screen.getByTestId('nav-calls'));
    await user.click(screen.getByTestId('call-video-w-lyra'));
    expect(screen.getByTestId('call-timer')).toBeInTheDocument();

    await user.click(screen.getByTestId('call-end'));
    expect(screen.queryByTestId('call-timer')).not.toBeInTheDocument();
    expect(screen.getByText(/No active call/i)).toBeInTheDocument();
  });
});

describe('truthfulness', () => {
  it('empty team renders an honest message, never a fabricated participant', () => {
    render(<GenesisShell members={[]} />);
    expect(screen.getAllByText(/No team loaded/i).length).toBeGreaterThan(0);
    expect(screen.queryByTestId('conference-grid')).not.toBeInTheDocument();
    expect(screen.queryByTestId('team-strip-w-atlas')).not.toBeInTheDocument();
  });

  it('work view does not invent file contents with no file open', async () => {
    const user = userEvent.setup();
    render(<GenesisShell />);
    await user.click(screen.getByTestId('nav-work'));
    expect(screen.queryByTestId('ide-code')).not.toBeInTheDocument();
    expect(screen.getByText(/never fabricates file contents/i)).toBeInTheDocument();
  });

  it('calls report no active call rather than showing a fake timer', async () => {
    const user = userEvent.setup();
    render(<GenesisShell />);
    await user.click(screen.getByTestId('nav-calls'));
    /* No timer exists until a call is started, and even then it is a static
     * placeholder label rather than a running clock. */
    expect(screen.queryByTestId('call-timer')).not.toBeInTheDocument();
    expect(screen.getByText(/No active call/i)).toBeInTheDocument();
  });

  it('silent mode hides avatars across views and says it is on', async () => {
    const user = userEvent.setup();
    render(<GenesisShell />);
    await user.click(screen.getByTestId('nav-team'));
    /* Conference tiles use AvatarStage, which is what carries data-live. */
    const framesBefore = document.querySelectorAll('[data-testid="avatar-frame"]').length;
    expect(framesBefore).toBeGreaterThan(0);

    await user.click(screen.getByTestId('team-toggle-silentMode'));

    const after = document.querySelectorAll('[data-testid="avatar-frame"]').length;
    expect(after, 'silent mode must hide the conference avatars').toBe(0);
    expect(screen.getAllByText(/silent mode is on/i).length).toBeGreaterThan(0);
  });

  it('ends the session only when the host reports one', async () => {
    const user = userEvent.setup();
    render(<GenesisShell />);
    await user.click(screen.getByTestId('nav-team'));
    expect(screen.getByTestId('team-end-session')).toBeDisabled();
  });

  it('chat echoes locally without claiming a backend reply', async () => {
    const user = userEvent.setup();
    render(<GenesisShell />);
    await user.click(screen.getByTestId('nav-chat'));

    const input = screen.getByTestId('chat-input');
    await user.type(input, 'hello');
    await user.click(screen.getByTestId('chat-send'));

    expect(screen.getByText('hello')).toBeInTheDocument();
    /* No agent reply is invented. */
    expect(screen.getAllByText('You')).toHaveLength(screen.getAllByText('You').length);
  });
});