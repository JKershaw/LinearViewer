// LIN-998: Brief and Recap auto-populate on section open, mirroring Context.
//
// The behavioral contract, driven against the REAL client `init()` in
// public/brief.js and public/recap.js:
//   - status=missing → auto-generate (POST fires once) → land on `fresh`.
//   - status=fresh   → render the cache, NO POST (never clobber fresh).
//   - status=stale   → keep the manual ↻ refresh, NO POST (no reopen tax).
//   - POST error     → land on `error` inline, no crash.
//
// public/{brief,recap}.js are browser scripts (plain globals, no ES module /
// build step), so we evaluate their source in a vm sandbox — as
// observation-card-order.test.js does — against a minimal fake DOM and a stub
// `window.api` that records every call. Only the DOM primitives the modules
// actually touch are modeled.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- Minimal fake DOM: only what init()/applyState()/wireRefresh() touch ----
function makeContainer() {
  return {
    innerHTML: '',
    _state: null,
    // LIN-1016: click handlers wireRefresh() registers, so a test can drive the
    // REAL manual path rather than calling refresh() itself. wireRefresh runs on
    // every applyState, so the last entry is the currently-wired button.
    _clickHandlers: [],
    classList: { add() {} },
    setAttribute(k, v) { if (k === 'data-state') this._state = v; },
    getAttribute(k) { return k === 'data-state' ? this._state : null; },
    // The modules select the refresh button by its data-*-refresh attribute;
    // return a wire-able stub when the current markup contains that attribute
    // (renderGenerating has no button, the terminal states do).
    querySelector(sel) {
      const attr = sel.replace(/[[\]]/g, '');
      if (!this.innerHTML.includes(attr)) return null;
      const handlers = this._clickHandlers;
      return { addEventListener(type, fn) { if (type === 'click') handlers.push(fn); } };
    },
    // Invoke the currently-wired ✦ generate / ↻ refresh handler. The module
    // registers an `async` listener that awaits refresh(), so awaiting the
    // handler awaits the whole render.
    async clickRefresh() {
      const fn = this._clickHandlers[this._clickHandlers.length - 1];
      assert.ok(fn, 'a refresh button was wired before the click');
      await fn();
    },
  };
}

// Load a client section module (brief/recap) into a fresh sandbox with a
// scripted `window.api`. `responder(url, opts)` returns the JSON body for each
// call; `calls` records what was requested so tests can assert POST behavior.
function loadSection(file, globalName, responder) {
  const src = readFileSync(join(__dirname, '../../public', file), 'utf8');
  const calls = [];
  const window = {
    escapeHtml: (s) => (s == null ? '' : String(s)),
    renderMarkdown: (s) => String(s == null ? '' : s),
    relativeTime: () => 'now',
    async api(url, opts) {
      const method = (opts && opts.method) || 'GET';
      calls.push({ url, method });
      return responder(url, method);
    },
  };
  vm.runInNewContext(src, { window });
  return { section: window[globalName], calls };
}

const OPTS = { urlKey: 'ws', identifier: 'LIN-998' };

const FRESH_BRIEF = { status: 'fresh', brief: '## Current\nA live spec.', generatedAt: '2026-07-04T00:00:00Z' };
const FRESH_RECAP = {
  status: 'fresh',
  recap: { done: [{ item: 'Did the thing', type: 'task' }], pending: [], deviations: [] },
  generatedAt: '2026-07-04T00:00:00Z',
};

// Per-section config so the two modules share one behavioral test body.
const SECTIONS = [
  { name: 'Brief', file: 'brief.js', global: 'BriefSection', fresh: FRESH_BRIEF },
  { name: 'Recap', file: 'recap.js', global: 'RecapSection', fresh: FRESH_RECAP },
];

for (const S of SECTIONS) {
  test(`${S.name}: status=missing auto-generates (POST fires once) → fresh`, async () => {
    const responder = (url, method) => (method === 'POST' ? S.fresh : { status: 'missing' });
    const { section, calls } = loadSection(S.file, S.global, responder);

    const container = makeContainer();
    await section.init(container, OPTS);

    const posts = calls.filter(c => c.method === 'POST');
    assert.equal(posts.length, 1, 'exactly one POST (auto-generate) on missing');
    assert.equal(calls.filter(c => c.method === 'GET').length, 1, 'one status GET');
    assert.equal(container.getAttribute('data-state'), 'fresh', 'lands on fresh after auto-generate');
  });

  test(`${S.name}: status=fresh renders cache, NO POST (never clobber fresh)`, async () => {
    const responder = () => S.fresh;
    const { section, calls } = loadSection(S.file, S.global, responder);

    const container = makeContainer();
    await section.init(container, OPTS);

    assert.equal(calls.filter(c => c.method === 'POST').length, 0, 'no POST when already fresh');
    assert.equal(container.getAttribute('data-state'), 'fresh');
  });

  test(`${S.name}: status=stale keeps manual refresh, NO POST (no reopen tax)`, async () => {
    const responder = (url, method) =>
      (method === 'POST' ? S.fresh : { status: 'stale', generatedAt: '2026-07-01T00:00:00Z' });
    const { section, calls } = loadSection(S.file, S.global, responder);

    const container = makeContainer();
    await section.init(container, OPTS);

    assert.equal(calls.filter(c => c.method === 'POST').length, 0, 'no auto-POST on stale');
    assert.equal(container.getAttribute('data-state'), 'stale');
  });

  test(`${S.name}: auto-generate POST error (uncoded 500) lands on error inline (no crash)`, async () => {
    const responder = (url, method) => {
      if (method === 'POST') {
        const err = new Error('Something went wrong');
        err.status = 500;
        throw err;
      }
      return { status: 'missing' };
    };
    const { section, calls } = loadSection(S.file, S.global, responder);

    const container = makeContainer();
    await section.init(container, OPTS);

    assert.equal(calls.filter(c => c.method === 'POST').length, 1, 'auto-generate was attempted');
    assert.equal(container.getAttribute('data-state'), 'error', 'error rendered inline, not thrown');
  });

  test(`${S.name}: 503 AI-not-configured on auto-open lands on manual placeholder, not error`, async () => {
    const responder = (url, method) => {
      if (method === 'POST') {
        const err = new Error('AI is not configured');
        err.status = 503;
        err.body = { code: 'AI_NOT_CONFIGURED', error: 'AI is not configured' };
        throw err;
      }
      return { status: 'missing' };
    };
    const { section, calls } = loadSection(S.file, S.global, responder);

    const container = makeContainer();
    await section.init(container, OPTS);

    assert.equal(calls.filter(c => c.method === 'POST').length, 1, 'exactly one POST, no retry loop');
    assert.equal(container.getAttribute('data-state'), 'missing', 'falls back to the manual placeholder');
    assert.match(container.innerHTML, /generate/, 'placeholder carries the generate button');
    assert.doesNotMatch(container.innerHTML, S.name === 'Brief' ? /brief-error/ : /recap-error/, 'does not carry the error class');
  });

  // LIN-1016 review ledger item 1: the `autoOpen` scoping guard is the ticket's
  // central constraint, and nothing else in this file witnesses it — dropping
  // the guard (fallback on every call, not just auto-open) leaves every other
  // case green while an explicit ✦ generate click silently re-renders the same
  // placeholder with no explanation. This drives the REAL wired click handler.
  test(`${S.name}: manual ✦ generate click on a coded 503 still shows the error banner (autoOpen scoping guard)`, async () => {
    const responder = (url, method) => {
      if (method === 'POST') {
        const err = new Error('AI is not configured');
        err.status = 503;
        err.body = { code: 'AI_NOT_CONFIGURED', error: 'AI is not configured' };
        throw err;
      }
      return { status: 'missing' };
    };
    const { section, calls } = loadSection(S.file, S.global, responder);

    const container = makeContainer();
    // Auto-open first: lands on the placeholder and wires its ✦ generate button.
    await section.init(container, OPTS);
    assert.equal(container.getAttribute('data-state'), 'missing', 'auto-open reached the placeholder');

    // Now the user clicks it — an explicit action, same coded 503.
    await container.clickRefresh();

    assert.equal(calls.filter(c => c.method === 'POST').length, 2, 'the click issued its own POST');
    assert.equal(container.getAttribute('data-state'), 'error', 'a manual click surfaces the reason, never the silent placeholder');
  });

  test(`${S.name}: 503 without the AI_NOT_CONFIGURED code on auto-open still lands on error (regression guard)`, async () => {
    const responder = (url, method) => {
      if (method === 'POST') {
        const err = new Error(S.name === 'Brief' ? 'Brief cache not configured' : 'Recap cache not configured');
        err.status = 503;
        err.body = { error: err.message };
        throw err;
      }
      return { status: 'missing' };
    };
    const { section, calls } = loadSection(S.file, S.global, responder);

    const container = makeContainer();
    await section.init(container, OPTS);

    assert.equal(calls.filter(c => c.method === 'POST').length, 1, 'auto-generate was attempted');
    assert.equal(container.getAttribute('data-state'), 'error', 'an uncoded 503 is not misclassified as missing/unconfigured');
  });
}
