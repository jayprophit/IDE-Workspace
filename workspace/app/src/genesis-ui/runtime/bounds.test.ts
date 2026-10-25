import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Architectural boundary tests.
 *
 * These are the structural promises the handoff said must not regress. They
 * are cheap to run and catch the failure mode that matters most here: someone
 * wiring a Bridge client into a view, or reintroducing a raw colour.
 */

const SRC = join(__dirname, '..');
const COMPONENTS = join(SRC, 'tokens', 'components.css');

/** Every .ts/.tsx under genesis-ui, excluding tests. */
function sourceFiles(dir = SRC, prefix = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    const rel = prefix ? `${prefix}/${entry}` : entry;
    if (statSync(abs).isDirectory()) {
      out.push(...sourceFiles(abs, rel));
    } else if (/\.tsx?$/.test(entry) && !entry.includes('.test.')) {
      out.push(rel);
    }
  }
  return out;
}

const SOURCES = sourceFiles();

/**
 * The runtime directory is the integration boundary. Both of its modules are
 * allowed to reach the Bridge: `runtimeTypes` owns the client shape and the
 * mappers, `useGenesisRuntime` owns the connection lifecycle and the one
 * `fetch` for the worker roster.
 */
const RUNTIME_FILES = SOURCES.filter((rel) => rel.startsWith('runtime/'));

/**
 * Files that render UI. A renderer lookup inside one of these is a boundary
 * break; `index.ts` is a barrel that re-exports the public API, so it is not
 * a consumer.
 */
const VIEW_FILES = SOURCES.filter(
  (rel) => rel.endsWith('.tsx') && !rel.startsWith('runtime/') && !rel.startsWith('avatar/renderers'),
);

/** Source with comments stripped, so a docstring naming a symbol is not read
 *  as an import of it. */
function code(rel: string): string {
  return readFileSync(join(SRC, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

describe('renderer seam', () => {
  it('no view module resolves the renderer registry itself', () => {
    /* AvatarStage is the one legitimate exception: it is the seam. */
    const offenders = VIEW_FILES.filter((rel) => rel !== 'avatar/AvatarStage.tsx' && /getAvatarRenderer/.test(code(rel)));
    expect(offenders).toEqual([]);
  });

  it('the renderer registry is reached only through AvatarStage', () => {
    /* index.ts re-exports it as public API, which is not a consumer. */
    const importers = SOURCES.filter((rel) => rel !== 'index.ts' && /getAvatarRenderer/.test(code(rel)));
    expect(importers.sort()).toEqual(['avatar/AvatarStage.tsx', 'avatar/renderers.tsx']);
  });

  it('no view module imports a concrete renderer', () => {
    const forbidden = ['three', '@react-three', 'vrm', 'gltf', 'livekit', 'liveportrait'];
    for (const rel of SOURCES) {
      const src = code(rel).toLowerCase();
      for (const lib of forbidden) {
        expect(src.includes(`from '${lib}`), `${rel} imports ${lib}`).toBe(false);
      }
    }
  });
});

describe('single Bridge integration boundary', () => {
  it('only the runtime directory imports genesisBridge', () => {
    const importers = SOURCES.filter((rel) => /from '(\.\.\/)+genesisBridge'/.test(code(rel)));
    expect(importers.sort()).toEqual(['runtime/runtimeTypes.ts', 'runtime/useGenesisRuntime.tsx']);
    /* Asserted against the runtime directory as a whole, because the boundary
     * is the module, not the single file. */
    expect(importers.every((rel) => RUNTIME_FILES.includes(rel))).toBe(true);
  });

  it('only the shell imports the bridge runtime hook', () => {
    /* The hook's own definition does not count as an importer, and index.ts
     * re-exports it as public API. */
    const importers = SOURCES.filter(
      (rel) => rel !== 'runtime/useGenesisRuntime.tsx' && rel !== 'index.ts' && /useGenesisRuntime/.test(code(rel)),
    );
    expect(importers.sort()).toEqual(['GenesisShell.tsx']);
  });

  it('only the runtime boundary performs network calls', () => {
    /* Views are pure functions of props. A fetch in one would mean a second,
     * uncontrolled integration boundary.
     *
     * Importing a CONFIGURATION CONSTANT (the default base URL) is not a
     * network call and is allowed - the shell needs to pass it down. What is
     * forbidden is importing a client FUNCTION outside the boundary. */
    const CLIENT_FUNCTIONS = /import[^;]*\b(fetchBridgeStatus|listWorkspace|readWorkspaceFile|writeWorkspaceFile|searchWorkspace|gitWorkspace|createTerminalSession|execTerminal|fetchTerminalSession)\b[^;]*from '\.\.\/bridge'/;

    const offenders = SOURCES.filter((rel) => {
      if (RUNTIME_FILES.includes(rel)) return false;
      const src = code(rel);
      return /\bfetch\s*\(/.test(src) || CLIENT_FUNCTIONS.test(src);
    });
    expect(offenders).toEqual([]);
  });

  it('the runtime hook is the only genesis-ui file with a fetch', () => {
    const fetchers = SOURCES.filter((rel) => /\bfetch\s*\(/.test(code(rel)));
    expect(fetchers.sort()).toEqual(['runtime/GenesisClient.ts', 'runtime/useGenesisRuntime.tsx']);
  });
});
describe('token discipline', () => {
  it('component CSS still has no raw colours outside swatch previews', () => {
    const css = readFileSync(COMPONENTS, 'utf8');
    const withoutSwatches = css.replace(/\.gx-theme-card__preview\[data-theme='[^']+'\][^}]*}/g, '');
    const offenders = [...new Set(withoutSwatches.match(/#[0-9a-f]{3,8}\b/gi) ?? [])]
      .map((h) => h.toLowerCase())
      .filter((h) => !['#fff', '#ffffff'].includes(h));
    expect(offenders).toEqual([]);
  });

  it('introduced no new colour literal in the runtime module', () => {
    /* The runtime surfaces must stay token-driven like everything else. */
    const src = readFileSync(join(SRC, 'runtime', 'RuntimeViews.tsx'), 'utf8');
    const hexes = src.match(/#[0-9a-f]{3,8}\b/gi) ?? [];
    expect(hexes).toEqual([]);
  });
});

describe('honesty invariants', () => {
  it('the shell still renders the non-live renderer label', () => {
    /* Copy and flag move together. The status bar is the surface where a
     * person is most likely to believe the avatar is live. */
    expect(readFileSync(join(SRC, 'GenesisShell.tsx'), 'utf8')).toContain('not live');
  });

  it('the avatar frame still carries the data-live attribute', () => {
    /* Owned by AvatarStage, which is where the renderer is resolved. */
    expect(readFileSync(join(SRC, 'avatar', 'AvatarStage.tsx'), 'utf8')).toContain('data-live');
  });

  it('the runtime module contains no speech or presence inference', () => {
    /* No timers that flip state, and no fabricated utterance generation. */
    const src = readFileSync(join(SRC, 'runtime', 'useGenesisRuntime.tsx'), 'utf8');
    expect(src).not.toMatch(/speechSynthesis|SpeechSynthesisUtterance/);
    expect(src).not.toMatch(/setInterval/);
  });

  it('runtime messaging never claims an avatar spoke', () => {
    const src = readFileSync(join(SRC, 'runtime', 'runtimeTypes.ts'), 'utf8');
    expect(src).not.toMatch(/speechSynthesis|utterance\s*=/i);
  });

  it('no secret material can enter the snapshot', () => {
    /* The snapshot is rendered, logged and passed to views. It carries ids,
     * states and counts only. */
    const src = readFileSync(join(SRC, 'runtime', 'runtimeTypes.ts'), 'utf8');
    for (const forbidden of ['token', 'apiKey', 'api_key', 'password', 'secret', 'bearer']) {
      /* `token` legitimately appears in "idempotency" phrasing and comments;
         assert on assignment-shaped uses only. */
      const pattern = new RegExp(`${forbidden}\\s*[:=]\\s*['"\`]`, 'i');
      expect(pattern.test(src), `runtimeTypes.ts assigns a ${forbidden}`).toBe(false);
    }
  });
});