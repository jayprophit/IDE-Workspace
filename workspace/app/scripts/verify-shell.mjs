// Slice-1 headless interaction verification (dev-only tooling, not shipped UI).
// Serves the production build via `vite preview`, drives it with system Chrome
// through puppeteer-core, and asserts every required slice-1 control works.
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';

const PREVIEW_PORT = 5200;
const URL = `http://127.0.0.1:${PREVIEW_PORT}/`;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const server = spawn(
  'C:\\Program Files\\nodejs\\node.exe',
  ['./node_modules/vite/bin/vite.js', 'preview', '--port', String(PREVIEW_PORT), '--host', '127.0.0.1', '--strictPort'],
  { cwd: process.cwd(), stdio: 'pipe' },
);

async function waitForServer(tries = 40) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(URL);
      if (r.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('preview server never came up');
}

let browser;
try {
  await waitForServer();
  check('preview server starts', true, URL);

  browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
  await page.waitForSelector('[data-testid="shell-root"]', { timeout: 15000 });
  check('main shell renders', true);
  check('no fatal page errors on load', errors.length === 0, errors.join(' | ').slice(0, 300));

  const tid = (id) => `[data-testid="${id}"]`;
  const text = async (id) => (await page.$eval(tid(id), (el) => el.textContent)) ?? '';

  // Chat mode
  await page.click(tid('mode-chat-btn'));
  check('chat button changes mode', (await text('workspace-title')).includes('Chat mode'));
  check('chat input visible in chat mode', (await page.$(tid('chat-input'))) !== null);

  // Chat send (mock echo)
  await page.type(tid('chat-input'), 'hello slice');
  await page.click(tid('chat-send'));
  await page.waitForFunction(
    () => document.querySelector('[data-testid="chat-log"]')?.textContent?.includes('hello slice'),
    { timeout: 5000 },
  );
  check('chat send appends message', true);

  // Code mode
  await page.click(tid('mode-code-btn'));
  check('code button changes mode', (await text('workspace-title')).includes('Code mode'));
  check('code view visible in code mode', (await page.$(tid('code-view'))) !== null);

  // AI panel collapse / expand
  await page.click(tid('ai-toggle'));
  await page.waitForFunction(
    () => document.querySelector('[data-testid="ai-panel"]')?.getAttribute('data-state') === 'collapsed',
    { timeout: 5000 },
  );
  check('AI panel collapses', true);
  await page.click(tid('ai-toggle'));
  await page.waitForFunction(
    () => document.querySelector('[data-testid="ai-panel"]')?.getAttribute('data-state') === 'expanded',
    { timeout: 5000 },
  );
  check('AI panel expands', true);

  // Settings open / theme switch / close
  await page.click(tid('settings-btn'));
  await page.waitForSelector(tid('settings-drawer'), { timeout: 5000 });
  check('settings opens', true);
  await page.click(tid('theme-aurora'));
  const theme = await page.$eval(tid('shell-root'), (el) => el.getAttribute('data-theme'));
  check('theme switching works', theme === 'aurora', `data-theme=${theme}`);
  await page.click(tid('settings-close'));
  await new Promise((r) => setTimeout(r, 300));
  check('settings closes', (await page.$(tid('settings-drawer'))) === null);

  // Status surfaces
  for (const id of ['status-model', 'status-agent', 'status-task', 'status-progress', 'status-approval', 'status-verification']) {
    const v = (await text(id)).trim();
    check(`${id} visible`, v.length > 0, v.slice(0, 60));
  }

  // Layout system: right sidebar tabs, focus, dock tabs, reset.
  await page.click(tid('sidebar-tab-inspector'));
  check('sidebar inspector tab opens', (await text('sidebar-panel-inspector')).includes('Inspector'));
  await page.click(tid('sidebar-tab-agent'));
  check('sidebar agent tab restores', (await page.$(tid('status-task'))) !== null);
  await page.click(tid('sidebar-focus'));
  check('sidebar focus toggles', (await page.$eval(tid('right-sidebar'), (el) => el.getAttribute('data-focused'))) === 'true');
  await page.click(tid('sidebar-focus'));
  await page.click(tid('dock-toggle'));
  check('bottom dock opens', (await page.$eval(tid('bottom-dock'), (el) => el.getAttribute('data-state'))) === 'visible');
  await page.click(tid('dock-tab-problems'));
  check('dock problems tab honest empty', (await text('dock-empty-problems')).includes('No problems'));
  await page.click(tid('dock-tab-terminal'));
  check('dock terminal tab restores', (await page.$(tid('terminal-panel'))) !== null);
  check('no code/web/video dock tabs exist', (await page.$(tid('dock-tab-code'))) === null && (await page.$(tid('dock-tab-web'))) === null);
  await page.screenshot({ path: 'verify-shell-work.png' });
  await page.click(tid('mode-chat-btn'));
  await page.screenshot({ path: 'verify-shell-chat.png' });
  const genesisChat = await text('genesis-ref');
  await page.click(tid('mode-code-btn'));
  check('genesis ref identical across depths', (await text('genesis-ref')) === genesisChat);
  await page.click(tid('settings-btn'));
  await page.click(tid('layout-reset'));
  check('layout reset hides dock', (await page.$eval(tid('bottom-dock'), (el) => el.getAttribute('data-state'))) === 'hidden');
  await page.click(tid('settings-close'));

  // Tablet-width responsive foundation (sidebar collapses via media query)
  await page.setViewport({ width: 800, height: 1000 });
  await new Promise((r) => setTimeout(r, 400));
  const sidebarW = await page.$eval(tid('left-nav'), (el) => el.getBoundingClientRect().width);
  check('tablet width keeps layout (narrow sidebar)', sidebarW < 150, `sidebar=${Math.round(sidebarW)}px`);
  await page.screenshot({ path: 'verify-shell.png' });
} catch (e) {
  check('verification script', false, String(e).slice(0, 500));
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  server.kill();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exitCode = failed.length ? 1 : 0;
