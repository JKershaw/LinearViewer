/**
 * Client-side coverage for the Observation Scan-due tab (LIN-2649 S4 / LIN-2667):
 * tri-state rendering, the never-ambient guarantee, the shared poll-status pill,
 * and cursor-based pagination.
 *
 * `public/observation.js` is a browser script with DOM/fetch dependencies at
 * call time but none at LOAD time, so it is vm-sandboxed the same way
 * tests/unit/observation-basis-check.test.js and observation-card-order.test.js
 * already do — a minimal fake DOM/fetch, then the real module-scope functions
 * exercised via the guarded CommonJS test export at the end of the file.
 *
 * Run with: node --test tests/unit/observation-scan-due.test.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(__dirname, '../../public/observation.js'), 'utf8');

class FakeElement {
  constructor(id) {
    this.id = id;
    this.hidden = false;
    this.disabled = false;
    this.textContent = '';
    this._html = '';
    this.dataset = {};
    this.classList = { toggle() {}, add() {}, remove() {} };
  }
  get innerHTML() { return this._html; }
  set innerHTML(v) { this._html = v; }
  insertAdjacentHTML(_pos, html) { this._html += html; }
  addEventListener() {}
  querySelectorAll() { return []; }
  querySelector() { return null; }
  setAttribute() {}
  remove() {}
}

function makeSandbox({ fetchImpl } = {}) {
  const nodes = new Map();
  const register = (id) => { const el = new FakeElement(id); nodes.set(id, el); return el; };
  register('obs-due-list');
  register('obs-due-empty');
  register('obs-due-more');
  register('obs-due-progress');
  register('obs-due-dayone');
  register('obs-due-section');
  register('obs-session-views');
  register('obs-rulings-section');
  register('obs-tabs');
  register('obs-poll-status');

  const sandbox = {
    module: { exports: {} },
    window: {
      addEventListener() {},
      matchMedia: () => ({ matches: false }),
      location: { href: '' },
    },
    document: {
      addEventListener() {},
      getElementById: (id) => nodes.get(id) || null,
      querySelector: () => null,
    },
    escapeHtml: (s) => (s == null ? '' : String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')),
    relativeTime: () => '',
    console: { warn() {}, error() {}, log() {} },
    fetch: fetchImpl || (async () => { throw new Error('no fetch stub configured'); }),
    setTimeout,
    clearTimeout,
  };
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox, { filename: 'observation.js' });
  sandbox.__nodes = nodes;
  vm.runInContext('observationData = { urlKey: "acme" };', sandbox);
  return sandbox;
}

const flush = async (times = 6) => {
  for (let i = 0; i < times; i++) await new Promise((r) => setImmediate(r));
};

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => body };
}

// ─── Tri-state rendering (design §3/§6/§8) ──────────────────────────────────

test.describe('dueStatusCopy / renderDueRowHtml — tri-state rendering', () => {
  test('dueStatus: true renders as due', () => {
    const { dueStatusCopy } = makeSandbox().module.exports;
    const result = dueStatusCopy({ dueStatus: true });
    assert.match(result.text, /due/i);
    assert.doesNotMatch(result.text, /not due/i);
  });

  test('dueStatus: false renders as not-due', () => {
    const { dueStatusCopy } = makeSandbox().module.exports;
    const result = dueStatusCopy({ dueStatus: false });
    assert.match(result.text, /not due/i);
  });

  test('plain null (no error) renders the scan-baseline copy, never "not due"', () => {
    const { dueStatusCopy } = makeSandbox().module.exports;
    const result = dueStatusCopy({ dueStatus: null });
    assert.match(result.text, /basis not comparable yet/i);
    assert.doesNotMatch(result.text, /not due/i);
  });

  test('null WITH error:true renders the distinct retry copy, never the scan-baseline copy', () => {
    const { dueStatusCopy } = makeSandbox().module.exports;
    const result = dueStatusCopy({ dueStatus: null, error: true });
    assert.match(result.text, /provider read failed/i);
    assert.doesNotMatch(result.text, /basis not comparable yet/i);
    assert.doesNotMatch(result.text, /not due/i);
  });

  test('a non-boolean, non-null dueStatus (defensive) never renders as due/not-due', () => {
    // Mirrors the `typeof x === 'boolean'` guard requestBasisCheck already
    // uses for basisChanged — a malformed wire value must fall through to
    // "unknown", never be coerced into a due/not-due claim.
    const { dueStatusCopy } = makeSandbox().module.exports;
    const result = dueStatusCopy({ dueStatus: 'true' });
    assert.match(result.text, /basis not comparable yet/i);
  });

  test('renderDueRowHtml renders a Retry affordance ONLY on the error branch', () => {
    const { renderDueRowHtml } = makeSandbox().module.exports;
    const errorRow = renderDueRowHtml({ issueId: 'i1', issueIdentifier: 'LIN-1', dueStatus: null, error: true });
    const okRow = renderDueRowHtml({ issueId: 'i2', issueIdentifier: 'LIN-2', dueStatus: null });
    assert.match(errorRow, /obs-due-retry/);
    assert.doesNotMatch(okRow, /obs-due-retry/);
  });

  test('renderDueRowHtml always carries the provider-read badge, distinct from a scan affordance', () => {
    const { renderDueRowHtml } = makeSandbox().module.exports;
    const row = renderDueRowHtml({ issueId: 'i1', issueIdentifier: 'LIN-1', dueStatus: true });
    assert.match(row, /obs-due-badge/);
    assert.match(row, /provider read/);
  });
});

// ─── Never-ambient guarantee ([F-1]) ─────────────────────────────────────────

test.describe('pollCurrentView — the due tab is never polled ambiently', () => {
  test('pollCurrentView performs NO fetch while currentView is "due"', async () => {
    let calls = 0;
    const sandbox = makeSandbox({ fetchImpl: async () => { calls++; return jsonResponse({}); } });
    vm.runInContext('currentView = "due";', sandbox);
    const { pollCurrentView } = sandbox.module.exports;

    // Simulate all three real call sites: the tick loop, a visibilitychange
    // firing, and a repeated call — none may fetch while the due tab is active.
    pollCurrentView();
    pollCurrentView();
    pollCurrentView();
    await flush();

    assert.equal(calls, 0, 'pollCurrentView must be a pure no-op for the due tab, not a due-specific branch that fetches');
  });

  test('pollCurrentView still dispatches normally for autopilot/sessions/rulings', async () => {
    let calls = 0;
    const sandbox = makeSandbox({ fetchImpl: async () => { calls++; return jsonResponse({ active: [], recent: [] }); } });
    vm.runInContext('currentView = "autopilot";', sandbox);
    const { pollCurrentView } = sandbox.module.exports;
    pollCurrentView();
    await flush();
    assert.equal(calls, 1, 'the pre-existing pollers must be unaffected by the due early return');
  });
});

test.describe('switchView("due") — the one-shot load, and only from here', () => {
  test('switching to due triggers exactly one fetch, to the scan-due endpoint', async () => {
    const calls = [];
    const sandbox = makeSandbox({
      fetchImpl: async (url) => { calls.push(url); return jsonResponse({ items: [], nextCursor: null, pageCandidateCount: 0, totalCandidateCount: 0 }); }
    });
    const { switchView } = sandbox.module.exports;
    switchView('due');
    await flush();
    assert.equal(calls.length, 1, `expected exactly one fetch on tab switch, got ${calls.length}`);
    assert.match(calls[0], /\/api\/scan-due$/);
  });

  test('the due section is shown and the session/rulings containers are hidden', async () => {
    const sandbox = makeSandbox({ fetchImpl: async () => jsonResponse({ items: [], nextCursor: null, pageCandidateCount: 0, totalCandidateCount: 0 }) });
    const { switchView } = sandbox.module.exports;
    switchView('due');
    await flush();
    assert.equal(sandbox.__nodes.get('obs-due-section').hidden, false);
    assert.equal(sandbox.__nodes.get('obs-session-views').hidden, true);
    assert.equal(sandbox.__nodes.get('obs-rulings-section').hidden, true);
  });

  test('switching to due twice in a row (no-op on the second) still issues only one fetch', async () => {
    let calls = 0;
    const sandbox = makeSandbox({ fetchImpl: async () => { calls++; return jsonResponse({ items: [], nextCursor: null, pageCandidateCount: 0, totalCandidateCount: 0 }); } });
    const { switchView } = sandbox.module.exports;
    switchView('due');
    switchView('due'); // same view — switchView's own `view === currentView` guard no-ops this
    await flush();
    assert.equal(calls, 1);
  });
});

// ─── [C-2] Shared poll-status pill must not strand on "loading…" ────────────

test.describe('setPollStatus pill — entering the due tab resolves, never strands', () => {
  test('a successful due load leaves the pill on "● live", not "loading…"', async () => {
    const sandbox = makeSandbox({ fetchImpl: async () => jsonResponse({ items: [], nextCursor: null, pageCandidateCount: 0, totalCandidateCount: 0 }) });
    const { switchView } = sandbox.module.exports;
    switchView('due');
    await flush();
    const pill = sandbox.__nodes.get('obs-poll-status');
    assert.notEqual(pill.textContent, 'loading…');
    assert.equal(pill.textContent, '● live');
  });

  test('a failed due load leaves the pill on "● disconnected", not "loading…"', async () => {
    const sandbox = makeSandbox({ fetchImpl: async () => jsonResponse({}, { ok: false, status: 500 }) });
    const { switchView } = sandbox.module.exports;
    switchView('due');
    await flush();
    const pill = sandbox.__nodes.get('obs-poll-status');
    assert.notEqual(pill.textContent, 'loading…');
    assert.equal(pill.textContent, '● disconnected');
  });
});

// ─── Pagination ──────────────────────────────────────────────────────────────

test.describe('loadInitialDueCheckPage / loadMoreDueChecks — pagination', () => {
  test('load-more replays the stored nextCursor VERBATIM as ?cursor=', async () => {
    const calls = [];
    const sandbox = makeSandbox({
      fetchImpl: async (url) => {
        calls.push(url);
        if (calls.length === 1) {
          return jsonResponse({ items: [{ issueId: 'a', issueIdentifier: 'LIN-1', dueStatus: true }], nextCursor: 'OPAQUE_CURSOR_ABC', pageCandidateCount: 1, totalCandidateCount: 2 });
        }
        return jsonResponse({ items: [{ issueId: 'b', issueIdentifier: 'LIN-2', dueStatus: false }], nextCursor: null, pageCandidateCount: 1, totalCandidateCount: 2 });
      }
    });
    const { loadInitialDueCheckPage, loadMoreDueChecks } = sandbox.module.exports;

    await loadInitialDueCheckPage();
    await loadMoreDueChecks();

    assert.equal(calls.length, 2);
    assert.match(calls[1], /\?cursor=OPAQUE_CURSOR_ABC$/, 'the cursor must be replayed verbatim, never re-encoded/decoded client-side');
  });

  test('load-more APPENDS rather than replacing the list', async () => {
    const sandbox = makeSandbox({
      fetchImpl: async (url) => (url.includes('cursor')
        ? jsonResponse({ items: [{ issueId: 'b', issueIdentifier: 'LIN-2', dueStatus: false }], nextCursor: null, pageCandidateCount: 1, totalCandidateCount: 2 })
        : jsonResponse({ items: [{ issueId: 'a', issueIdentifier: 'LIN-1', dueStatus: true }], nextCursor: 'CUR1', pageCandidateCount: 1, totalCandidateCount: 2 }))
    });
    const { loadInitialDueCheckPage, loadMoreDueChecks } = sandbox.module.exports;
    await loadInitialDueCheckPage();
    await loadMoreDueChecks();

    const list = sandbox.__nodes.get('obs-due-list');
    assert.match(list.innerHTML, /LIN-1/);
    assert.match(list.innerHTML, /LIN-2/, 'the second page must be appended, not replace the first');
  });

  test('the load-more button is hidden when nextCursor is null, shown when non-null', async () => {
    const sandbox = makeSandbox({
      fetchImpl: async () => jsonResponse({ items: [{ issueId: 'a', issueIdentifier: 'LIN-1', dueStatus: true }], nextCursor: 'CUR1', pageCandidateCount: 1, totalCandidateCount: 2 })
    });
    const { loadInitialDueCheckPage } = sandbox.module.exports;
    await loadInitialDueCheckPage();
    assert.equal(sandbox.__nodes.get('obs-due-more').hidden, false, 'a non-null nextCursor must show the load-more button');

    const sandbox2 = makeSandbox({
      fetchImpl: async () => jsonResponse({ items: [], nextCursor: null, pageCandidateCount: 0, totalCandidateCount: 0 })
    });
    const { loadInitialDueCheckPage: load2 } = sandbox2.module.exports;
    await load2();
    assert.equal(sandbox2.__nodes.get('obs-due-more').hidden, true, 'a null nextCursor must hide/disable the load-more button');
  });

  test('the "checked N of M" readout comes from pageCandidateCount/totalCandidateCount', async () => {
    const sandbox = makeSandbox({
      fetchImpl: async (url) => (url.includes('cursor')
        ? jsonResponse({ items: [{ issueId: 'b', issueIdentifier: 'LIN-2', dueStatus: false }], nextCursor: null, pageCandidateCount: 1, totalCandidateCount: 41 })
        : jsonResponse({ items: Array.from({ length: 40 }, (_, i) => ({ issueId: `i${i}`, issueIdentifier: `LIN-${i}`, dueStatus: null })), nextCursor: 'CUR1', pageCandidateCount: 40, totalCandidateCount: 41 }))
    });
    const { loadInitialDueCheckPage, loadMoreDueChecks } = sandbox.module.exports;
    await loadInitialDueCheckPage();
    assert.equal(sandbox.__nodes.get('obs-due-progress').textContent, 'checked 40 of 41');
    await loadMoreDueChecks();
    assert.equal(sandbox.__nodes.get('obs-due-progress').textContent, 'checked 41 of 41');
  });

  test('day-one notice shows when the first page is entirely dueStatus:null, hides otherwise', async () => {
    const allNull = makeSandbox({
      fetchImpl: async () => jsonResponse({ items: [{ issueId: 'a', issueIdentifier: 'LIN-1', dueStatus: null }, { issueId: 'b', issueIdentifier: 'LIN-2', dueStatus: null }], nextCursor: null, pageCandidateCount: 2, totalCandidateCount: 2 })
    });
    await allNull.module.exports.loadInitialDueCheckPage();
    assert.equal(allNull.__nodes.get('obs-due-dayone').hidden, false);

    const mixed = makeSandbox({
      fetchImpl: async () => jsonResponse({ items: [{ issueId: 'a', issueIdentifier: 'LIN-1', dueStatus: true }, { issueId: 'b', issueIdentifier: 'LIN-2', dueStatus: null }], nextCursor: null, pageCandidateCount: 2, totalCandidateCount: 2 })
    });
    await mixed.module.exports.loadInitialDueCheckPage();
    assert.equal(mixed.__nodes.get('obs-due-dayone').hidden, true);
  });

  test('loadInitialDueCheckPage guards re-entrancy: a second call while one is in flight is a no-op', async () => {
    let calls = 0;
    let resolveFirst;
    const sandbox = makeSandbox({
      fetchImpl: () => { calls++; return new Promise((resolve) => { resolveFirst = resolve; }); }
    });
    const { loadInitialDueCheckPage } = sandbox.module.exports;
    const p1 = loadInitialDueCheckPage();
    const p2 = loadInitialDueCheckPage();
    resolveFirst(jsonResponse({ items: [], nextCursor: null, pageCandidateCount: 0, totalCandidateCount: 0 }));
    await Promise.all([p1, p2]);
    assert.equal(calls, 1, 'a load already in flight must not be duplicated');
  });
});
