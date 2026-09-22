import { act, render, screen, waitFor } from '@testing-library/react';
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
