/**
 * LIN-1016 review ledger items 2 and 3 — the SERVER half of the
 * AI-unconfigured contract, and the composed wire between the two halves.
 *
 * `public/brief.js` / `public/recap.js` fall back to the manual ✦ generate
 * placeholder only when an auto-open POST fails with `status === 503 &&
 * body.code === 'AI_NOT_CONFIGURED'`. Every other test of that behaviour drives
 * a hand-written fixture error, so nothing proved the real routes actually emit
 * that field: rename or drop it server-side and all the client cases stay green
 * while the feature silently reverts to the pre-fix error banner.
 *
 * Two tiers here, both pinning the ends together:
 *
 *   1. Route contract (ledger item 2) — the wire body of the two
 *      AI-unconfigured 503s, plus the other half of that contract: the
 *      neighbouring cache-not-configured 503 on the same routes stays UNCODED,
 *      since the client must keep showing the error banner for it.
 *   2. Composed wire (ledger item 3) — the whole chain in one test, with no
 *      hand-written error anywhere: real route → real `jsonError` → real HTTP →
 *      the REAL `window.api` from public/common.js parsing the body → `err.body
 *      .code` → the real `refresh()` → `renderMissing()`. Each hop was
 *      previously confirmed only by reading.
 *
 * The 503 returns before any provider or OpenRouter call, so no network stub is
 * needed; the harness follows tests/unit/openrouter-models-endpoint.js's
 * mount-the-real-router pattern.
 *
 * Run with: node --test tests/unit/brief-recap-ai-not-configured-contract.test.js
 */
import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import express from 'express';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createWorkspaceApiRoutes } from '../../routes/workspace-api.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

before(() => { process.env.NODE_ENV = 'test'; });

// The unconfigured state is an ENV state — an OpenRouter key of any kind takes
// the routes past the guard — so it is established explicitly, not inherited
// from whatever the developer has in .env.
let savedEnv;
beforeEach(() => {
  savedEnv = {
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    OPENROUTER_FREE_TIER_KEY: process.env.OPENROUTER_FREE_TIER_KEY,
  };
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_FREE_TIER_KEY;
});
afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

/**
 * Mount the real workspace-api router. `accessToken` is deliberately NOT
 * 'test-token' and the provider is not 'local' — either one flips
 * `shouldMockAi()` on under NODE_ENV=test and skips the guard entirely.
 * `stores` lets a test null out a cache store to reach the OTHER 503.
 */
function buildApp(stores = {}) {
  const app = express();
  app.use(express.json());
  app.use(createWorkspaceApiRoutes({
    workspaceFromUrl: (req, _res, next) => {
      req.workspace = { accessToken: 'real-linear-token', urlKey: 'test-workspace' };
      req.session = { features: {} };
      next();
    },
    freeTierStore: {},
    getOpenRouterSource: () => null,
    userPreferencesStore: {},
    workspacePreferencesStore: {},
    customPromptsStore: {},
    recapCacheStore: {},
    briefCacheStore: {},
    reportHistoryStore: {},
    dispatchQueueStore: {},
    agentStatusStore: {},
    promptTraceStore: {},
    proxyTokenStore: {},
    ...stores,
  }));
  return app;
}

async function post(app, path) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    return await new Promise((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port, path, method: 'POST', headers: { 'content-type': 'application/json' } },
        (res) => {
          let raw = '';
          res.on('data', chunk => { raw += chunk; });
          res.on('end', () => {
            try {
              resolve({ status: res.statusCode, body: JSON.parse(raw) });
            } catch (e) {
              reject(e);
            }
          });
        }
      );
      req.on('error', reject);
      req.end('{}');
    });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

// --- Composed-wire harness (ledger item 3) --------------------------------
//
// A sandbox holding the REAL public/common.js (for its `window.api`) plus the
// section module, wired to a live server. The single seam is `fetch`: the
// modules build ORIGIN-RELATIVE URLs, which a browser resolves against the page
// origin and Node's fetch rejects — so the shim resolves them the same way. No
// error, status, or body is fabricated anywhere in this path.
function loadWiredSection(file, globalName, origin) {
  const window = {
    addEventListener() {},
    location: { href: '' },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
  };
  const document = {
    addEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    documentElement: { classList: { add() {}, remove() {}, contains: () => false } },
    body: { classList: { add() {}, remove() {} } },
    createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }),
  };
  const sandbox = {
    window, document, console, setTimeout, clearTimeout, navigator: {},
    localStorage: { getItem: () => null, setItem() {} },
    URLSearchParams,
    fetch: (url, opts) => globalThis.fetch(new URL(url, origin), opts),
  };
  const ctx = vm.createContext(sandbox);
  // Real window.api — the hop the ledger flagged as read-verified only.
  vm.runInContext(readFileSync(join(__dirname, '../../public/common.js'), 'utf8'), ctx);
  assert.equal(typeof window.api, 'function', 'the real window.api loaded');
  vm.runInContext(readFileSync(join(__dirname, '../../public', file), 'utf8'), ctx);
  return window[globalName];
}

function makeContainer() {
  return {
    innerHTML: '',
    _state: null,
    classList: { add() {} },
    setAttribute(k, v) { if (k === 'data-state') this._state = v; },
    getAttribute(k) { return k === 'data-state' ? this._state : null; },
    querySelector(sel) {
      const attr = sel.replace(/[[\]]/g, '');
      return this.innerHTML.includes(attr) ? { addEventListener() {} } : null;
    },
  };
}

/** Run `fn(origin)` against a live server on an ephemeral port. */
async function withServer(app, fn) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

// Mirrors the SECTIONS loop in brief-recap-autogenerate.test.js so the two ends
// of the contract are enumerated the same way.
const SECTIONS = [
  { name: 'Brief', file: 'brief.js', global: 'BriefSection', errorClass: 'brief-error', path: '/workspace/test-workspace/api/brief/LIN-1016', cacheStore: 'briefCacheStore', message: 'AI brief is not configured. Connect OpenRouter or set OPENROUTER_API_KEY.', cacheMessage: 'Brief cache not configured' },
  { name: 'Recap', file: 'recap.js', global: 'RecapSection', errorClass: 'recap-error', path: '/workspace/test-workspace/api/recap/LIN-1016', cacheStore: 'recapCacheStore', message: 'AI recap is not configured. Connect OpenRouter or set OPENROUTER_API_KEY.', cacheMessage: 'Recap cache not configured' },
];

for (const S of SECTIONS) {
  test(`POST ${S.name}: unconfigured AI 503 carries code AI_NOT_CONFIGURED (client contract)`, async () => {
    const { status, body } = await post(buildApp(), S.path);

    assert.equal(status, 503, 'unconfigured AI is a 503');
    assert.deepEqual(body, { error: S.message, code: 'AI_NOT_CONFIGURED' },
      'the exact wire body public/{brief,recap}.js isAiNotConfigured() matches');
  });

  test(`POST ${S.name}: the cache-not-configured 503 on the same route stays UNCODED`, async () => {
    const { status, body } = await post(buildApp({ [S.cacheStore]: null }), S.path);

    assert.equal(status, 503, 'a missing cache store is also a 503');
    assert.equal(body.error, S.cacheMessage);
    assert.equal(body.code, undefined,
      'only the AI-unconfigured 503 is coded — an uncoded 503 must keep its error banner');
  });

  // Ledger item 3: the whole chain at once, nothing fabricated. The auto-open
  // and manual halves run against the same live route, so the placeholder and
  // the banner are produced by the same real 503 — the difference is only the
  // `autoOpen` flag, which is exactly the contract.
  test(`${S.name}: composed wire — real route → real window.api → renderMissing on auto-open, error banner on manual`, async () => {
    await withServer(buildApp(), async (origin) => {
      const section = loadWiredSection(S.file, S.global, origin);

      const auto = makeContainer();
      await section.refresh(auto, 'test-workspace', 'LIN-1016', undefined, { autoOpen: true });
      assert.equal(auto.getAttribute('data-state'), 'missing',
        'the real server 503 reached renderMissing() through the real client stack');
      assert.match(auto.innerHTML, /generate/, 'the placeholder carries the ✦ generate button');
      assert.doesNotMatch(auto.innerHTML, new RegExp(S.errorClass), 'no error banner on auto-open');

      const manual = makeContainer();
      await section.refresh(manual, 'test-workspace', 'LIN-1016', undefined);
      assert.equal(manual.getAttribute('data-state'), 'error',
        'the same real 503 without autoOpen still surfaces the reason');
      assert.match(manual.innerHTML, new RegExp(S.errorClass), 'the manual path renders the error banner');
    });
  });
}
