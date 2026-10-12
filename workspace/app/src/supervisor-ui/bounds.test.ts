import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SOURCE_STATES } from './api/types';
import { STATE_PHRASE } from './components/fact';

/**
 * Architectural boundary tests for supervisor-ui.
 *
 * Same enforcement shape as `genesis-ui/runtime/bounds.test.ts`, which passed
 * review. The point is that the guarantees are structural, not conventions
 * someone has to remember:
 *
 *   - one network boundary
 *   - no colour literals in components
 *   - no avatar / renderer / runtime coupling to the frozen genesis-ui unit
 *   - the honesty vocabulary is complete and unmodified
 */

/* This file sits at the supervisor-ui root, so ROOT is its own directory. */
const ROOT = __dirname;

/**
 * CSS rules only, comments stripped.
 *
 * The token:component split only works if the token definitions and the
 * component rules are genuinely separate blocks. A component rule that
 * *inherits* tokens is fine (that is what `var(--x)` is); what must never happen
 * is a literal leaking in. So the check runs against the component half only,
 * not the whole file, and it strips comments first so prose about colours does
 * not read as a violation.
 */
function componentRules(css: string): string {
  const tokensEnd = css.indexOf('/* --- base ---');
  const base = tokensEnd === -1 ? css : css.slice(tokensEnd);
  return base.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function sourceFiles(dir = ROOT, prefix = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    const rel = prefix ? `${prefix}/${entry}` : entry;
    if (statSync(abs).isDirectory()) out.push(...sourceFiles(abs, rel));
    else if (/\.tsx?$/.test(entry) && !entry.includes('.test.') && !entry.endsWith('.d.ts')) out.push(rel);
  }
  return out;
}

const SOURCES = sourceFiles();

/** The single integration boundary. `useSupervisor` is a hook, not a client. */
const NETWORK_FILES = ['api/client.ts'];

/**
 * Source with comments stripped, so a docstring naming a symbol is not read as
 * a reference to it.
 *
 * The negative lookbehind matters: a naive `//.*$` strips from the `//` in
 * `http://127.0.0.1:8472` and silently deletes the rest of that line, which
 * would hide a real violation AND make a real assertion fail for the wrong
 * reason.
 */
function code(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('single network boundary', () => {
  it('only the API client performs network calls', () => {
    const fetchers = SOURCES.filter((rel) => /\bfetch\s*\(/.test(code(rel)));
    expect(fetchers.sort()).toEqual(NETWORK_FILES);
  });

  it('no component module imports a Bridge or genesis client', () => {
    for (const rel of SOURCES) {
      const src = code(rel);
      expect(src.includes('from \'../genesisBridge\''), `${rel} imports genesisBridge`).toBe(false);
      expect(src.includes('from \'./bridge\''), `${rel} imports bridge`).toBe(false);
    }
  });

  it('uses only the documented supervisor routes', () => {
    const src = code('api/client.ts');
    expect(src).toContain('/v1/supervisor/health');
    expect(src).toContain('/v1/supervisor/state');
    expect(src).toContain('/v1/supervisor/events');
    /* No invented parallel endpoints. */
    expect(src).not.toMatch(/\/v1\/supervisor\/(?!health|state|events)/);
  });

  it('defaults to a same-origin path, not a cross-origin loopback URL', () => {
    /* The service sends no CORS headers, so a browser cannot read it
       cross-origin. The default must be same-origin (proxied in dev); the
       absolute loopback is only reachable via an explicit opt-in. */
    expect(code('api/client.ts')).toContain("const DEFAULT_BASE = '/api'");
    expect(code('api/client.ts')).toContain('http://127.0.0.1:8472');
  });

  it('proxies the supervisor routes in dev rather than re-implementing them', () => {
    /* The proxy must forward to the identical upstream paths, not translate
       them. vite.config.ts is one level above this test's directory. */
    const vite = readFileSync(join(__dirname, '..', '..', 'vite.config.ts'), 'utf8');
    expect(vite).toContain('127.0.0.1:8472');
    expect(vite).toContain('/v1/supervisor');
  });
});

describe('token discipline', () => {
  const css = readFileSync(join(ROOT, 'tokens', 'tokens.css'), 'utf8');

  it('declares no raw colour in any component module', () => {
    for (const rel of SOURCES) {
      const hexes = code(rel).match(/#[0-9a-f]{3,8}\b/gi) ?? [];
      expect(hexes, `${rel} hard-codes a colour`).toEqual([]);
    }
  });

  it('declares no raw colour in the component CSS body', () => {
    /* Tokens carry primitives by design; the component rules must not. */
    const hexes = componentRules(css).match(/#[0-9a-f]{3,8}\b/gi) ?? [];
    expect(hexes, 'component CSS hard-codes a colour').toEqual([]);
  });

  it('has no raw colour anywhere after the token layer, including the state chips', () => {
    /* Every one of the ten fact states gets its colour from a token. A literal
       in a chip rule would still theme correctly today, and would silently
       break the next theme added. */
    const tail = css.slice(css.indexOf('/* --- fact chip'));
    const hexes = tail.match(/#[0-9a-f]{3,8}\b/gi) ?? [];
    expect(hexes, 'the fact-chip layer hard-codes a colour').toEqual([]);
  });

  it('defines a colour and soft-wash token for every SourceState', () => {
    /* A state without tokens would fall back to the chip's base styling, which
       would make two different states look identical. DEFERRED_BACKEND_INTERFACE
       uses a shorter token name, so it is checked against its own mapping. */
    const tokenFor: Record<string, string> = {
      DEFERRED_BACKEND_INTERFACE: 'deferred',
      ...Object.fromEntries(SOURCE_STATES.filter((s) => s !== 'DEFERRED_BACKEND_INTERFACE').map((s) => [s, s.toLowerCase().replace(/_/g, '-')])),
    };
    for (const state of SOURCE_STATES) {
      const slug = tokenFor[state];
      expect(css, `no base token for ${state}`).toContain(`--fact-${slug}:`);
      expect(css, `no soft wash for ${state}`).toContain(`--fact-${slug}-soft:`);
    }
  });

  it('defines a chip rule for every SourceState', () => {
    for (const state of SOURCE_STATES) {
      expect(css, `no chip rule for ${state}`).toContain(`[data-state='${state}']`);
    }
  });

  it('gives NOT_EXPOSED a dashed edge, distinct from a soft value', () => {
    const idx = css.indexOf("[data-state='NOT_EXPOSED']");
    expect(idx).toBeGreaterThan(-1);
    const block = css.slice(idx, css.indexOf('}', idx));
    expect(block).toContain('border-style: dashed');
  });

  it('respects reduced motion', () => {
    expect(css).toContain('prefers-reduced-motion');
  });
});

describe('isolation from the frozen genesis-ui unit', () => {
  it('imports nothing from genesis-ui', () => {
    for (const rel of SOURCES) {
      expect(code(rel).includes("from '../genesis-ui"), `${rel} couples to genesis-ui`).toBe(false);
      expect(code(rel).includes("from './genesis-ui"), `${rel} couples to genesis-ui`).toBe(false);
    }
  });

  it('does not touch the avatar or renderer stack', () => {
    for (const rel of SOURCES) {
      const src = code(rel).toLowerCase();
      for (const forbidden of ['avatarstage', 'avatarselection', 'data-live', 'registeravatarrenderer']) {
        expect(src.includes(forbidden), `${rel} references ${forbidden}`).toBe(false);
      }
    }
  });

  it('keeps its own token namespace', () => {
    const css = readFileSync(join(ROOT, 'tokens', 'tokens.css'), 'utf8');
    expect(css).not.toContain('.gx-');
  });
});

describe('honesty vocabulary', () => {
  it('is not narrowed or renamed by the client', () => {
    /* A state the backend can emit must survive to the renderer. Asserted
       against the runtime value, not a source string: STATE_PHRASE keys are
       bare identifiers, and matching quoted literals would pass vacuously. */
    expect(SOURCE_STATES).toHaveLength(10);
    /* Imported live so the assertion cannot drift from what ships. */
    expect(Object.keys(STATE_PHRASE).sort()).toEqual([...SOURCE_STATES].sort());
  });

  it('never computes a state the backend did not send', () => {
    /* The client may roll facts UP to a worst state, but it must not invent a
       new state name, and must never upgrade one. */
    const client = code('api/client.ts');
    expect(client).not.toMatch(/state\s*=\s*'LIVE_VERIFIED'/);
    expect(client).not.toMatch(/return\s*'LIVE_VERIFIED'/);
  });

  it('keeps FRESHNESS_WINDOW_S owned by the backend', () => {
    /* The client must not re-derive staleness against its own clock: a second
       clock would eventually disagree with the one that observed the value. */
    expect(code('api/client.ts')).not.toContain('30');
    expect(code('api/types.ts')).toContain('age_s');
  });
});

describe('no fabricated runtime state', () => {
  it('has no timers that invent state', () => {
    /* setInterval here is a POLL, not a simulation. Nothing may flip a state
       on a schedule. */
    for (const rel of SOURCES) {
      const src = code(rel);
      expect(src, `${rel} uses a timeout to change state`).not.toMatch(/setTimeout\([^)]*set[A-Z]\w*State/);
    }
  });

  it('does not synthesise counts from absent facts', () => {
    /* `?? 0` on a fact value is the specific bug: it turns "no data" into
       "zero measured". */
    const components = SOURCES.filter((rel) => rel.startsWith('components/')).map((r) => code(r)).join('\n');
    expect(components).not.toMatch(/value\s*\?\?\s*0/);
  });

  it('carries no secret-shaped fields', () => {
    for (const rel of SOURCES) {
      const src = code(rel);
      for (const forbidden of ['apikey', 'api_key', 'password', 'bearer', 'secret']) {
        expect(new RegExp(`${forbidden}\\s*[:=]\\s*['"\`]`, 'i').test(src), `${rel} assigns a ${forbidden}`).toBe(false);
      }
    }
  });
});