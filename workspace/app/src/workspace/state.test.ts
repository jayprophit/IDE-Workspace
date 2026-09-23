import { describe, expect, it } from 'vitest';
import {
  closePanel,
  createInitialChatLayout,
  createInitialSharedState,
  createInitialWorkLayout,
  loadUiState,
  openPanel,
  parseUiState,
  reorderPanels,
  selectDockTab,
  serializeUiState,
  setDockVisible,
  setPrincipal,
  setTask,
  setWorkflowRun,
  switchDepth,
  togglePanel,
} from './state';

describe('shared state contract', () => {
  it('carries one genesis/task/run identity across depths', () => {
    const shared = setWorkflowRun(
      setTask(createInitialSharedState('/ws', 'demo'), { taskId: 'T1', workflowRunId: 'W1' }),
      'W1',
    );
    const chat = switchDepth(shared, 'chat');
    const code = switchDepth(shared, 'code');
    // Identical reference: no clone, no second task/run/identity.
    expect(chat.shared).toBe(shared);
    expect(code.shared).toBe(shared);
    expect(chat.shared.task?.taskId).toBe('T1');
    expect(code.shared.workflowRunId).toBe('W1');
    expect(chat.shared.genesis.genesisId).toBe(code.shared.genesis.genesisId);
  });
  it('rejects invalid depths and corrupt persisted layouts', () => {
    const shared = createInitialSharedState('/ws', 'demo');
    expect(() => switchDepth(shared, 'vr' as 'chat')).toThrowError(/invalid interface depth/);
    expect(() => parseUiState('{broken')).toThrowError(/malformed/);
    expect(() => parseUiState('{"version":3}')).toThrowError(/version/);
    expect(() => parseUiState('{"version":1,"depth":"vr","chat":{},"work":{}}')).toThrowError(/depth/);
    // v1 payloads migrate with recovery (unknown panels reset to default).
    expect(
      parseUiState('{"version":1,"depth":"chat","chat":{"rightPanel":{"id":"nope"}},"work":{"rightPanels":[],"dock":{"selected":"terminal"}}}').chat
        .rightPanel,
    ).toBeNull();
    // v2 strict path still fails loudly on unknown panels.
    expect(() =>
      parseUiState('{"version":2,"depth":"chat","chat":{"rightPanel":{"id":"nope"}},"work":{"rightPanels":[],"dock":{"selected":"terminal"}}}'),
    ).toThrowError(/unknown chat panel/);
  });
  it('serializes and reloads layout state round-trip', () => {
    const raw = serializeUiState('code', createInitialChatLayout(), createInitialWorkLayout());
    const back = parseUiState(raw);
    expect(back.depth).toBe('code');
    expect(back.work.dock.selected).toBe('terminal');
    expect(loadUiState(null)).toBeNull();
    expect(loadUiState({ load: () => null, save: () => {} })).toBeNull();
    expect(loadUiState({ load: () => raw, save: () => {} })?.depth).toBe('code');
  });
  it('principal rules: genesis/worker allowed, owner escalations rejected', () => {
    const shared = createInitialSharedState('/ws', 'demo');
    expect(setPrincipal(shared, { kind: 'genesis', id: 'genesis-prime', onBehalfOf: 'owner-jp' }).principal?.id).toBe(
      'genesis-prime',
    );
    expect(setPrincipal(shared, { kind: 'worker', id: 'worker-1' }).principal?.kind).toBe('worker');
    expect(() => setPrincipal(shared, { kind: 'owner', id: 'owner-jp' })).toThrowError(/backend session/);
    expect(() => setPrincipal(shared, { kind: 'admin' as 'genesis', id: 'x' })).toThrowError(/invalid principal kind/);
    expect(setPrincipal(shared, null).principal).toBeNull();
  });
});

describe('right sidebar registry', () => {
  it('opens, collapses, reorders and closes known panels only', () => {
    let panels = openPanel([], 'web');
    panels = openPanel(panels, 'code');
    expect(panels.map((p) => p.id)).toEqual(['web', 'code']);
    panels = togglePanel(panels, 'web');
    expect(panels.find((p) => p.id === 'web')?.collapsed).toBe(true);
    panels = reorderPanels(panels, ['code', 'web']);
    expect(panels.map((p) => p.id)).toEqual(['code', 'web']);
    panels = closePanel(panels, 'web');
    expect(panels.map((p) => p.id)).toEqual(['code']);
    expect(() => openPanel(panels, 'teleport')).toThrowError(/unknown panel/);
    expect(() => togglePanel(panels, 'video')).toThrowError(/not open/);
    expect(() => reorderPanels(panels, ['code', 'web'])).toThrowError(/exactly/);
  });
  it('chat and work keep independent panel layouts over shared task', () => {
    const chat = createInitialChatLayout();
    const work = createInitialWorkLayout();
    expect(chat.rightPanel).toBeNull();
    expect(work.rightPanels.map((p) => p.id)).toEqual(['agent', 'inspector']);
    expect(chat.bottomDockVisible).toBe(false);
  });
});

describe('bottom dock', () => {
  it('hosts runtime tabs, hides fully, rejects code/web/video placement', () => {
    const dock = setDockVisible({ visible: false, selected: 'terminal' }, true);
    expect(selectDockTab(dock, 'tests').selected).toBe('tests');
    expect(setDockVisible(dock, false).visible).toBe(false);
    expect(() => selectDockTab(dock, 'code')).toThrowError(/unknown dock tab/);
    expect(() => selectDockTab(dock, 'web')).toThrowError(/unknown dock tab/);
    expect(() => selectDockTab(dock, 'video')).toThrowError(/unknown dock tab/);
  });
});

describe('service states', () => {
  it('distinguishes unavailable, empty, unimplemented and denied', () => {
    const shared = createInitialSharedState('/ws', 'demo');
    expect(shared.bridge.kind).toBe('disconnected');
    expect(shared.models.kind).toBe('empty');
    expect(shared.task).toBeNull();
  });
});

describe('layout presets', () => {
  it('chat prioritizes conversation, work prioritizes canvas', async () => {
    const { CHAT_DEFAULT, WORK_DEFAULT } = await import('./state');
    expect(CHAT_DEFAULT.bottomDockVisible).toBe(false);
    expect(CHAT_DEFAULT.rightPanel).toBeNull();
    expect(WORK_DEFAULT.rightPanels.map((p) => p.id)).toEqual(['agent', 'inspector']);
    expect(WORK_DEFAULT.sidebar).toMatchObject({ width: null, focused: false, activeTabId: 'agent' });
    expect(WORK_DEFAULT.dock).toMatchObject({ visible: false, selected: 'terminal', height: null });
  });
  it('project storage keys differ per workspace', async () => {
    const { uiStorageKey } = await import('./state');
    expect(uiStorageKey('workspace/app')).not.toBe(uiStorageKey('workspace/other'));
    expect(uiStorageKey('workspace/app')).toContain('aetherius.ide.ui.v1:');
    expect(uiStorageKey('').length).toBeGreaterThan(0);
  });
});

describe('workspace presets', () => {
  it('resolves declarative presets deterministically', async () => {
    const { WORKSPACE_PRESETS, resolvePreset, applyPreset, createInitialWorkLayout } = await import('./state');
    expect(Object.keys(WORKSPACE_PRESETS).sort()).toEqual(
      ['cad', 'code', 'data', 'default', 'document', 'research'],
    );
    expect(resolvePreset('research').depth).toBe('code');
    expect(() => resolvePreset('teleport')).toThrowError(/unknown workspace preset/);
    const applied = applyPreset(createInitialWorkLayout(), 'research');
    expect(applied.rightPanels.map((p) => p.id)).toEqual(['agent', 'inspector', 'web']);
    expect(applied.dock.selected).toBe('evidence');
    expect(applied.activePresetId).toBe('research');
    expect(applied.sidebar.activeTabId).toBe('agent');
  });
  it('preset application is pure and repeatable', async () => {
    const { applyPreset, createInitialWorkLayout } = await import('./state');
    const first = applyPreset(createInitialWorkLayout(), 'cad');
    const second = applyPreset(createInitialWorkLayout(), 'cad');
    expect(first).toEqual(second);
    expect(first.rightPanels.map((p) => p.id)).toEqual(['agent', 'inspector']);
  });
});

describe('version migration and section recovery', () => {
  it('migrates v1 payloads with defaults for new fields', async () => {
    const { parseUiState } = await import('./state');
    const v1 = JSON.stringify({
      version: 1, depth: 'code',
      chat: { selectedConversation: null, rightPanel: null, bottomDockVisible: false },
      work: {
        openTabs: [], selectedFile: '', rightPanels: [{ id: 'agent', collapsed: false, order: 0 }],
        dock: { visible: true, selected: 'tests' },
      },
    });
    const migrated = parseUiState(v1);
    expect(migrated.version).toBe(2);
    expect(migrated.work.sidebar).toMatchObject({ width: null, focused: false, activeTabId: 'agent' });
    expect(migrated.work.dock.selected).toBe('tests');
  });
  it('recovers corrupt sections independently with warnings', async () => {
    const { recoverUiState } = await import('./state');
    const bad = JSON.stringify({
      version: 2, depth: 'code',
      chat: { selectedConversation: null, rightPanel: { id: 'teleport' }, bottomDockVisible: false },
      work: {
        openTabs: [], selectedFile: 'a.ts',
        rightPanels: [{ id: 'agent', collapsed: false, order: 0 }],
        sidebar: { width: 9999, focused: false, activeTabId: 'agent' },
        dock: { visible: true, selected: 'terminal', height: null },
      },
    });
    const { state, warnings, recovered } = recoverUiState(bad);
    expect(recovered).toBe(true);
    expect(state.chat.rightPanel).toBeNull();
    expect(state.work.selectedFile).toBe('a.ts');
    expect(state.work.sidebar.width).toBe(640);
    expect(warnings.length).toBeGreaterThan(0);
    const clean = recoverUiState(null);
    expect(clean.recovered).toBe(false);
    expect(clean.warnings).toEqual([]);
  });
  it('clamps sizes and validates dock height', async () => {
    const { recoverUiState } = await import('./state');
    const raw = JSON.stringify({
      version: 2, depth: 'code',
      chat: { selectedConversation: null, rightPanel: null, bottomDockVisible: false },
      work: {
        openTabs: [], selectedFile: '',
        rightPanels: [{ id: 'agent', collapsed: false, order: 0 }],
        sidebar: { width: 50, focused: true, activeTabId: 'agent' },
        dock: { visible: true, selected: 'logs', height: 5 },
      },
    });
    const { state } = recoverUiState(raw);
    expect(state.work.sidebar.width).toBe(200);
    expect(state.work.sidebar.focused).toBe(true);
    expect(state.work.dock.height).toBeNull();
  });
});
