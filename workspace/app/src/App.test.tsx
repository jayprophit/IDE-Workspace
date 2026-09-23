import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { fetchBridgeStatus, createTerminalSession } from './bridge';

vi.mock('./bridge', async (importOriginal) => {
  const original = await importOriginal<typeof import('./bridge')>();
  return {
    ...original,
    // Connected with empty runtime: exercises the live-data path shape while
    // keeping every value honest-empty, and avoids the offline retry storm
    // so bridge-call counts stay deterministic under test.
    fetchBridgeStatus: vi.fn(async () => ({
      connected: true,
      baseUrl: 'http://127.0.0.1:8471',
      health: 'UNKNOWN',
      runtime: null,
      models: [],
      error: '',
      agentBridgeVersion: '',
      ideVersion: '',
      versionCompatible: false,
    })),
    bridgeBase: () => 'http://127.0.0.1:8471',
    createTerminalSession: vi.fn(async () => {
      throw new Error('no terminal backend in unit test');
    }),
  };
});

const mockedStatus = vi.mocked(fetchBridgeStatus);
const mockedTerminal = vi.mocked(createTerminalSession);

beforeEach(() => {
  window.localStorage.clear();
  mockedStatus.mockClear();
  mockedTerminal.mockClear();
});

async function renderOffline() {
  const user = userEvent.setup({ delay: null });
  const view = render(<App />);
  await waitFor(() => expect(screen.getByTestId('shell-root')).toBeTruthy());
  await waitFor(() => expect(screen.getByTestId('backend-state').textContent).toContain('backend:'));
  return { user, view };
}

describe('chat/work parity', () => {
  it('shares task pill and genesis ref across depths', async () => {
    const { user } = await renderOffline();
    const taskChat = screen.getByTestId('status-task').textContent;
    const genesisChat = screen.getByTestId('genesis-ref').textContent;
    await user.click(screen.getByTestId('mode-chat-btn'));
    expect(screen.getByTestId('status-task').textContent).toBe(taskChat);
    expect(screen.getByTestId('genesis-ref').textContent).toBe(genesisChat);
    await user.click(screen.getByTestId('mode-code-btn'));
    expect(screen.getByTestId('status-task').textContent).toBe(taskChat);
    expect(screen.getByTestId('genesis-ref').textContent).toBe(genesisChat);
  });
  it('mode switches issue no new bridge calls and duplicate nothing', async () => {
    const { user } = await renderOffline();
    const statusCalls = mockedStatus.mock.calls.length;
    const termCalls = mockedTerminal.mock.calls.length;
    await user.click(screen.getByTestId('mode-chat-btn'));
    await user.click(screen.getByTestId('mode-code-btn'));
    await user.click(screen.getByTestId('mode-chat-btn'));
    await user.click(screen.getByTestId('mode-code-btn'));
    // No model re-request, no workflow re-invocation, no bridge polling
    // beyond the mount-time calls: reconstruction reads state only.
    expect(mockedStatus.mock.calls.length).toBe(statusCalls);
    expect(mockedTerminal.mock.calls.length).toBe(termCalls);
  });
  it('chat send records locally without backend execution', async () => {
    const { user } = await renderOffline();
    await user.click(screen.getByTestId('mode-chat-btn'));
    const callsBefore = mockedStatus.mock.calls.length;
    await user.type(screen.getByTestId('chat-input'), 'hello parity');
    await user.click(screen.getByTestId('chat-send'));
    await waitFor(() =>
      expect(screen.getByTestId('chat-log').textContent).toContain('hello parity'),
    );
    await waitFor(() =>
      expect(screen.getByTestId('chat-log').textContent).toContain('not connected'),
    );
    expect(mockedStatus.mock.calls.length).toBe(callsBefore);
  });
});

describe('sidebar tabs and focus', () => {
  it('switches agent/inspector tabs without touching canonical state', async () => {
    const { user } = await renderOffline();
    const taskBefore = screen.getByTestId('status-task').textContent;
    await user.click(screen.getByTestId('sidebar-tab-inspector'));
    expect(screen.getByTestId('sidebar-panel-inspector').textContent).toContain('Inspector');
    expect(screen.getByTestId('status-task').textContent).toBe(taskBefore);
    await user.click(screen.getByTestId('sidebar-tab-agent'));
    expect(screen.getByTestId('status-task').textContent).toBeTruthy();
  });
  it('focus toggle and width control persist without bridge calls', async () => {
    const { user } = await renderOffline();
    const callsBefore = mockedStatus.mock.calls.length;
    await user.click(screen.getByTestId('sidebar-focus'));
    expect(screen.getByTestId('right-sidebar').getAttribute('data-focused')).toBe('true');
    const width = screen.getByTestId('sidebar-width') as HTMLInputElement;
    fireEvent.change(width, { target: { value: '400' } });
    expect(screen.getByTestId('right-sidebar').getAttribute('style')).toContain('400');
    await user.click(screen.getByTestId('sidebar-focus'));
    expect(screen.getByTestId('right-sidebar').getAttribute('data-focused')).toBe('false');
    expect(mockedStatus.mock.calls.length).toBe(callsBefore);
  });
});

describe('workspace presets', () => {
  it('applies presets without bridge calls and keeps canonical state', async () => {
    const { user } = await renderOffline();
    const callsBefore = mockedStatus.mock.calls.length;
    const taskBefore = screen.getByTestId('status-task').textContent;
    await user.click(screen.getByTestId('settings-btn'));
    const select = screen.getByTestId('preset-select') as HTMLSelectElement;
    await user.selectOptions(select, 'research');
    expect(screen.getByTestId('active-preset').textContent).toContain('research');
    expect(screen.getByTestId('sidebar-tab-web')).toBeTruthy();
    expect(screen.getByTestId('status-task').textContent).toBe(taskBefore);
    expect(mockedStatus.mock.calls.length).toBe(callsBefore);
    await user.click(screen.getByTestId('settings-close'));
  });
  it('unavailable preset panels render honestly, never fabricated', async () => {
    const { user } = await renderOffline();
    await user.click(screen.getByTestId('settings-btn'));
    await user.selectOptions(screen.getByTestId('preset-select'), 'research');
    await user.click(screen.getByTestId('settings-close'));
    await user.click(screen.getByTestId('sidebar-tab-web'));
    expect(screen.getByTestId('panel-unavailable-web').textContent).toContain('not connected');
    expect(screen.getByTestId('status-task').textContent).toContain('no active task');
  });
});

describe('responsive overlay drawer', () => {
  const setWidth = (width: number) => {
    Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
    window.dispatchEvent(new Event('resize'));
  };
  it('narrows to overlay drawer, widens back with desktop preference intact', async () => {
    setWidth(1440);
    const { user } = await renderOffline();
    expect(screen.getByTestId('shell-root').getAttribute('data-viewport')).toBe('wide');
    const width = screen.getByTestId('sidebar-width') as HTMLInputElement;
    fireEvent.change(width, { target: { value: '400' } });
    const callsBefore = mockedStatus.mock.calls.length;
    setWidth(500);
    expect(await screen.findByTestId('sidebar-drawer-toggle')).toBeTruthy();
    expect(screen.getByTestId('shell-root').getAttribute('data-viewport')).toBe('narrow');
    expect(screen.getByTestId('right-sidebar').getAttribute('data-overlay')).toBe('closed');
    await user.click(screen.getByTestId('sidebar-drawer-toggle'));
    expect(screen.getByTestId('right-sidebar').getAttribute('data-overlay')).toBe('open');
    expect(screen.getByTestId('status-task').textContent).toContain('no active task');
    setWidth(1440);
    expect(await screen.findByTestId('sidebar-width')).toBeTruthy();
    // Desktop preference survived the narrow excursion untouched.
    expect((screen.getByTestId('sidebar-width') as HTMLInputElement).value).toBe('400');
    expect(screen.getByTestId('right-sidebar').getAttribute('data-overlay')).toBe('none');
    expect(mockedStatus.mock.calls.length).toBe(callsBefore);
  });
  it('unmount cleans up without errors', async () => {
    const { view } = await renderOffline();
    view.unmount();
    window.dispatchEvent(new Event('resize'));
  });
});

describe('detach and reattach', () => {
  const stubOpen = (impl: () => unknown) => {
    Object.defineProperty(window, 'open', { value: impl, configurable: true, writable: true });
  };
  it('blocked popup keeps the panel in shell with zero bridge calls', async () => {
    stubOpen(() => null);
    const { user } = await renderOffline();
    const callsBefore = mockedStatus.mock.calls.length;
    await user.click(screen.getByTestId('sidebar-detach'));
    expect(screen.queryByTestId('detached-list')).toBeNull();
    expect(screen.getByTestId('sidebar-panel-agent')).toBeTruthy();
    expect(mockedStatus.mock.calls.length).toBe(callsBefore);
    stubOpen(() => { throw new Error('nope'); });
  });
  it('successful detach hides in-shell panel; reattach restores it', async () => {
    const closed: boolean[] = [];
    stubOpen(() => ({ get closed() { return closed[0] ?? false; }, close: () => {}, focus: () => {} }));
    const { user } = await renderOffline();
    const callsBefore = mockedStatus.mock.calls.length;
    await user.click(screen.getByTestId('sidebar-detach'));
    expect(screen.getByTestId('reattach-agent')).toBeTruthy();
    expect(screen.getByTestId('sidebar-panel-agent').getAttribute('style')).toContain('none');
    expect(screen.getByTestId('status-task').textContent).toContain('no active task');
    await user.click(screen.getByTestId('reattach-agent'));
    expect(screen.queryByTestId('reattach-agent')).toBeNull();
    expect(mockedStatus.mock.calls.length).toBe(callsBefore);
    stubOpen(() => null);
  });
  it('invalid detach parameter falls back to the full shell', async () => {
    window.history.replaceState({}, '', '/?detach=evil-panel');
    try {
      await renderOffline();
      expect(screen.getByTestId('shell-root')).toBeTruthy();
      expect(screen.queryByTestId('detached-root')).toBeNull();
    } finally {
      window.history.replaceState({}, '', '/');
    }
  });
  it('valid detach parameter renders the standalone view on shared backend', async () => {
    window.history.replaceState({}, '', '/?detach=inspector');
    try {
      render(<App />);
      await waitFor(() => expect(screen.getByTestId('detached-root')).toBeTruthy());
      expect(screen.getByTestId('detached-root').getAttribute('data-detached-panel')).toBe('inspector');
      expect(screen.getByTestId('detached-genesis').textContent).toContain('genesis-prime');
      expect(screen.getByTestId('detached-note').textContent).toContain('Closing this window changes nothing');
      expect(screen.queryByTestId('shell-root')).toBeNull();
    } finally {
      window.history.replaceState({}, '', '/');
    }
  });
});

describe('dock tabs', () => {
  it('selects runtime tabs with honest empty states, terminal keeps DOM', async () => {
    const { user } = await renderOffline();
    await user.click(screen.getByTestId('dock-toggle'));
    await user.click(screen.getByTestId('dock-tab-problems'));
    expect(screen.getByTestId('dock-empty-problems').textContent).toContain('No problems');
    await user.click(screen.getByTestId('dock-tab-terminal'));
    expect(screen.getByTestId('terminal-panel')).toBeTruthy();
    expect(screen.queryByTestId('dock-tab-code')).toBeNull();
    expect(screen.queryByTestId('dock-tab-web')).toBeNull();
    expect(screen.queryByTestId('dock-tab-video')).toBeNull();
  });
  it('reset restores defaults without touching canonical state', async () => {
    const { user } = await renderOffline();
    await user.click(screen.getByTestId('dock-toggle'));
    await user.click(screen.getByTestId('settings-btn'));
    await user.click(screen.getByTestId('layout-reset'));
    expect(screen.getByTestId('bottom-dock').getAttribute('data-state')).toBe('hidden');
    expect(screen.getByTestId('status-task').textContent).toContain('no active task');
  });
});

describe('dock and layout', () => {
  it('bottom dock toggles without touching canonical state', async () => {
    const { user } = await renderOffline();
    const dock = screen.getByTestId('bottom-dock');
    expect(dock.getAttribute('data-state')).toBe('hidden');
    await user.click(screen.getByTestId('dock-toggle'));
    expect(screen.getByTestId('bottom-dock').getAttribute('data-state')).toBe('visible');
    expect(screen.getByTestId('terminal-panel')).toBeTruthy();
    await user.click(screen.getByTestId('dock-toggle'));
    expect(screen.getByTestId('bottom-dock').getAttribute('data-state')).toBe('hidden');
    // Task pill untouched by dock visibility.
    expect(screen.getByTestId('status-task').textContent).toContain('no active task');
  });
  it('corrupt persisted layout falls back to defaults', async () => {
    window.localStorage.setItem('aetherius.ide.ui.v1', '{broken');
    await renderOffline();
    expect(screen.getByTestId('shell-root')).toBeTruthy();
    expect(screen.getByTestId('bottom-dock').getAttribute('data-state')).toBe('hidden');
  });
  it('honest empty states, never fabricated live data', async () => {
    await renderOffline();
    expect(screen.getByTestId('status-progress').textContent).toBe('—');
    expect(screen.getByTestId('models-empty').textContent).toContain('no inventory yet');
    expect(screen.getByTestId('open-file').textContent).toBe('no file open');
    await act(async () => {});
  });
});
