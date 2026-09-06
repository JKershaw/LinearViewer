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

function makeSandbox({ fetchImpl, scanCostEstimate } = {}) {
  const nodes = new Map();
  const register = (id) => { const el = new FakeElement(id); nodes.set(id, el); return el; };
  register('obs-due-list');
  register('obs-due-empty');
  register('obs-due-more');
  register('obs-due-progress');
  register('obs-due-dayone');
  register('obs-due-bulk-bar');
  register('obs-due-select-all');
  register('obs-due-selected-count');
  register('obs-due-selected-cost');
  register('obs-due-bulk-refusal');
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
  vm.runInContext(`observationData = { urlKey: "acme", scanCostEstimate: ${JSON.stringify(scanCostEstimate ?? null)} };`, sandbox);
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

  test('day-one notice stays hidden when the first page is entirely provider-read errors', async () => {
    const allError = makeSandbox({
      fetchImpl: async () => jsonResponse({ items: [{ issueId: 'a', issueIdentifier: 'LIN-1', dueStatus: null, error: true }, { issueId: 'b', issueIdentifier: 'LIN-2', dueStatus: null, error: true }], nextCursor: null, pageCandidateCount: 2, totalCandidateCount: 2 })
    });
    await allError.module.exports.loadInitialDueCheckPage();
    assert.equal(allError.__nodes.get('obs-due-dayone').hidden, true, 'an all-error page must not get scan-baseline day-one copy');
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

// ─── Selection lifecycle + selection UI (LIN-2706 §B.2/§B.3) ───────────────────
//
// This session adds NO spend path and NO scan-triggering control — these
// tests exercise only the Set that owns the selection, the checkbox
// rendering that reflects it, and the select-all/tri-state sync. There is
// no "Scan selected" button anywhere in this file's exports; it does not
// exist yet (Session 2, LIN-2707).

test.describe('dueSelectedIds — lifecycle (LIN-2706 §B.2)', () => {
  test('clears on loadInitialDueCheckPage, even when the reloaded page re-lists the SAME id', async () => {
    // The stronger claim than "prune by intersection": a fresh tab entry
    // clears unconditionally. Re-using issueId 'a' on both loads is what
    // distinguishes this from paintDuePage's own prune-by-intersection,
    // which would leave 'a' selected since it is still present.
    const sandbox = makeSandbox({
      fetchImpl: async () => jsonResponse({ items: [{ issueId: 'a', issueIdentifier: 'LIN-1', dueStatus: true }], nextCursor: null, pageCandidateCount: 1, totalCandidateCount: 1 })
    });
    const { loadInitialDueCheckPage, dueSelectedIds, toggleDueSelection } = sandbox.module.exports;
    await loadInitialDueCheckPage();
    toggleDueSelection('a', true);
    assert.ok(dueSelectedIds.has('a'), 'selection sanity check before reload');

    await loadInitialDueCheckPage();
    assert.equal(dueSelectedIds.size, 0, 'a fresh tab entry must clear the selection unconditionally');
  });

  test('survives loadMoreDueChecks — an in-progress selection is not dropped by pagination', async () => {
    const sandbox = makeSandbox({
      fetchImpl: async (url) => (url.includes('cursor')
        ? jsonResponse({ items: [{ issueId: 'b', issueIdentifier: 'LIN-2', dueStatus: false }], nextCursor: null, pageCandidateCount: 1, totalCandidateCount: 2 })
        : jsonResponse({ items: [{ issueId: 'a', issueIdentifier: 'LIN-1', dueStatus: true }], nextCursor: 'CUR1', pageCandidateCount: 1, totalCandidateCount: 2 }))
    });
    const { loadInitialDueCheckPage, loadMoreDueChecks, dueSelectedIds, toggleDueSelection } = sandbox.module.exports;
    await loadInitialDueCheckPage();
    toggleDueSelection('a', true);

    await loadMoreDueChecks();
    assert.ok(dueSelectedIds.has('a'), 'appending a page must not silently drop an in-progress selection');
  });

  test('prunes a vanished row on a full repaint — the count can never exceed what is on screen', () => {
    // Isolates paintDuePage's OWN prune-by-intersection mechanism from
    // loadInitialDueCheckPage's unconditional clear (tested separately
    // above) by driving paintDuePage directly.
    const sandbox = makeSandbox();
    const { paintDuePage, dueSelectedIds, toggleDueSelection } = sandbox.module.exports;
    paintDuePage([{ issueId: 'a', issueIdentifier: 'LIN-1', dueStatus: true }, { issueId: 'b', issueIdentifier: 'LIN-2', dueStatus: false }], 2, { append: false });
    toggleDueSelection('a', true);
    toggleDueSelection('b', true);
    assert.equal(dueSelectedIds.size, 2, 'selection sanity check before the repaint');

    // A full repaint (append:false) whose new rows no longer include 'a'.
    paintDuePage([{ issueId: 'b', issueIdentifier: 'LIN-2', dueStatus: false }], 1, { append: false });
    assert.deepEqual([...dueSelectedIds], ['b'], "'a' must be pruned once it is no longer among the loaded rows");
  });

  test('loaded-rows-only: a load-more page never prunes rows from an EARLIER page', async () => {
    const sandbox = makeSandbox({
      fetchImpl: async (url) => (url.includes('cursor')
        ? jsonResponse({ items: [{ issueId: 'b', issueIdentifier: 'LIN-2', dueStatus: false }], nextCursor: null, pageCandidateCount: 1, totalCandidateCount: 2 })
        : jsonResponse({ items: [{ issueId: 'a', issueIdentifier: 'LIN-1', dueStatus: true }], nextCursor: 'CUR1', pageCandidateCount: 1, totalCandidateCount: 2 }))
    });
    const { loadInitialDueCheckPage, loadMoreDueChecks, dueSelectedIds, toggleDueSelection } = sandbox.module.exports;
    await loadInitialDueCheckPage();
    toggleDueSelection('a', true);
    await loadMoreDueChecks();
    toggleDueSelection('b', true);
    assert.deepEqual([...dueSelectedIds].sort(), ['a', 'b'], 'both pages worth of selection must coexist — pagination is additive, never a prune trigger');
  });
});

test.describe('per-row checkbox + select-all — rendering and tri-state (LIN-2706 §B.3)', () => {
  test('renderDueRowHtml reflects Set membership: checked when selected, unchecked otherwise', () => {
    const sandbox = makeSandbox();
    const { renderDueRowHtml, dueSelectedIds } = sandbox.module.exports;
    const item = { issueId: 'a', issueIdentifier: 'LIN-1', dueStatus: true };

    assert.doesNotMatch(renderDueRowHtml(item), /obs-due-select[^>]*checked/, 'unselected row must not render checked');
    dueSelectedIds.add('a');
    assert.match(renderDueRowHtml(item), /class="obs-due-select" data-issue-id="a" checked/, 'selected row must render checked');
  });

  test('a repaint with the SAME items preserves checked state (idempotent repaint)', () => {
    const sandbox = makeSandbox();
    const { paintDuePage, toggleDueSelection } = sandbox.module.exports;
    const items = [{ issueId: 'a', issueIdentifier: 'LIN-1', dueStatus: true }, { issueId: 'b', issueIdentifier: 'LIN-2', dueStatus: false }];
    paintDuePage(items, 2, { append: false });
    toggleDueSelection('a', true);

    // Re-painting the SAME items (e.g. a retry re-running the same load)
    // must reproduce the checked state from the Set, not drop it.
    paintDuePage(items, 2, { append: false });
    const html = sandbox.__nodes.get('obs-due-list').innerHTML;
    assert.match(html, /data-issue-id="a" checked/, "row 'a' must stay checked across the repaint");
    assert.doesNotMatch(html, /data-issue-id="b" checked/, "row 'b' must stay unchecked across the repaint");
  });

  test('select-all-loaded selects only the currently PAINTED rows, never an implicit all-pages sweep', () => {
    const sandbox = makeSandbox();
    const { paintDuePage, setAllDueSelected, dueSelectedIds } = sandbox.module.exports;
    paintDuePage([{ issueId: 'a', issueIdentifier: 'LIN-1', dueStatus: true }, { issueId: 'b', issueIdentifier: 'LIN-2', dueStatus: false }], 2, { append: false });

    setAllDueSelected(true);
    assert.deepEqual([...dueSelectedIds].sort(), ['a', 'b']);

    setAllDueSelected(false);
    assert.equal(dueSelectedIds.size, 0, 'select-all off must clear exactly the loaded rows');
  });

  test('select-all-loaded repaints the list so every row reflects the new membership', () => {
    const sandbox = makeSandbox();
    const { paintDuePage, setAllDueSelected } = sandbox.module.exports;
    paintDuePage([{ issueId: 'a', issueIdentifier: 'LIN-1', dueStatus: true }, { issueId: 'b', issueIdentifier: 'LIN-2', dueStatus: false }], 2, { append: false });

    setAllDueSelected(true);
    const html = sandbox.__nodes.get('obs-due-list').innerHTML;
    assert.match(html, /data-issue-id="a" checked/);
    assert.match(html, /data-issue-id="b" checked/);
  });

  test('select-all-loaded, driven across a load-more, covers BOTH pages — the loaded population grows additively', async () => {
    const sandbox = makeSandbox({
      fetchImpl: async (url) => (url.includes('cursor')
        ? jsonResponse({ items: [{ issueId: 'b', issueIdentifier: 'LIN-2', dueStatus: false }], nextCursor: null, pageCandidateCount: 1, totalCandidateCount: 2 })
        : jsonResponse({ items: [{ issueId: 'a', issueIdentifier: 'LIN-1', dueStatus: true }], nextCursor: 'CUR1', pageCandidateCount: 1, totalCandidateCount: 2 }))
    });
    const { loadInitialDueCheckPage, loadMoreDueChecks, setAllDueSelected, dueSelectedIds } = sandbox.module.exports;
    await loadInitialDueCheckPage();
    await loadMoreDueChecks();
    setAllDueSelected(true);
    assert.deepEqual([...dueSelectedIds].sort(), ['a', 'b']);
  });

  test('tri-state: none/some/all loaded selected, and the bulk bar is hidden with nothing loaded', () => {
    const sandbox = makeSandbox();
    const { paintDuePage, toggleDueSelection } = sandbox.module.exports;
    const selectAll = sandbox.__nodes.get('obs-due-select-all');
    const bar = sandbox.__nodes.get('obs-due-bulk-bar');

    paintDuePage([], 0, { append: false });
    assert.equal(bar.hidden, true, 'an empty loaded page: the bulk bar stays hidden');

    paintDuePage([{ issueId: 'a', issueIdentifier: 'LIN-1', dueStatus: true }, { issueId: 'b', issueIdentifier: 'LIN-2', dueStatus: false }, { issueId: 'c', issueIdentifier: 'LIN-3', dueStatus: null }], 3, { append: false });
    assert.equal(bar.hidden, false, 'rows are loaded: the bulk bar must be shown');
    assert.equal(selectAll.checked, false);
    assert.equal(selectAll.indeterminate, false, 'none selected: not indeterminate');

    toggleDueSelection('a', true);
    assert.equal(selectAll.checked, false);
    assert.equal(selectAll.indeterminate, true, 'some (not all) selected: indeterminate');

    toggleDueSelection('b', true);
    toggleDueSelection('c', true);
    assert.equal(selectAll.checked, true, 'all loaded selected: checked, not indeterminate');
    assert.equal(selectAll.indeterminate, false);

    toggleDueSelection('a', false);
    assert.equal(selectAll.checked, false);
    assert.equal(selectAll.indeterminate, true, 'dropping back to "some" must clear the all-checked state');
  });
});

// ─── Exact count, honest cost estimate, over-ceiling refusal (LIN-2706 §B.4/§B.5/§B.8) ───
//
// Still no spend path and no scan-triggering control anywhere in this file's
// exports — no "Scan selected" button, no Stop button, nothing that calls
// startBulkScan. These are pre-run-only surfaces.

test.describe('dueSelectedCountText — exact count (LIN-2706 §B.4)', () => {
  test('renders the exact selected count, never merged with the cost figure', () => {
    const sandbox = makeSandbox();
    const { paintDuePage, toggleDueSelection, dueSelectedCountText } = sandbox.module.exports;
    paintDuePage([{ issueId: 'a', issueIdentifier: 'LIN-1', dueStatus: true }, { issueId: 'b', issueIdentifier: 'LIN-2', dueStatus: false }], 2, { append: false });
    assert.match(dueSelectedCountText(), /^0 selected/);
    assert.doesNotMatch(dueSelectedCountText(), /\$/, 'the count text must never carry a dollar figure');

    toggleDueSelection('a', true);
    assert.match(dueSelectedCountText(), /^1 selected/);
    toggleDueSelection('b', true);
    assert.match(dueSelectedCountText(), /^2 selected/);
  });

  test('the rendered #obs-due-selected-count hook tracks selection via syncDueBulkBar', () => {
    const sandbox = makeSandbox();
    const { paintDuePage, toggleDueSelection } = sandbox.module.exports;
    paintDuePage([{ issueId: 'a', issueIdentifier: 'LIN-1', dueStatus: true }], 1, { append: false });
    const countEl = sandbox.__nodes.get('obs-due-selected-count');
    assert.match(countEl.textContent, /^0 selected/);
    toggleDueSelection('a', true);
    assert.match(countEl.textContent, /^1 selected/);
  });
});

test.describe('formatDueScanCostEstimate — honest unknown, never $0.00 for it (LIN-2706 §B.5)', () => {
  test('unknown:true renders "est. unknown"', () => {
    const sandbox = makeSandbox();
    const { formatDueScanCostEstimate } = sandbox.module.exports;
    assert.equal(formatDueScanCostEstimate({ calls: 0, pricedCalls: 0, meanUsd: null, unknown: true }, 5), 'est. unknown');
  });

  test('a null/absent estimate renders "est. unknown"', () => {
    const sandbox = makeSandbox();
    const { formatDueScanCostEstimate } = sandbox.module.exports;
    assert.equal(formatDueScanCostEstimate(null, 5), 'est. unknown');
    assert.equal(formatDueScanCostEstimate(undefined, 5), 'est. unknown');
  });

  test('a priced row averaging exactly zero renders est. $0.00, unknown:false — distinct from the unknown state', () => {
    const sandbox = makeSandbox();
    const { formatDueScanCostEstimate } = sandbox.module.exports;
    assert.equal(formatDueScanCostEstimate({ calls: 3, pricedCalls: 3, meanUsd: 0, unknown: false }, 5), 'est. $0.00');
  });

  test('a normal priced mean renders meanUsd × selectedCount', () => {
    const sandbox = makeSandbox();
    const { formatDueScanCostEstimate } = sandbox.module.exports;
    // Sub-$1 totals keep 4 decimals, mirroring formatCost's own precision idiom
    // (0.02 * 5 = 0.10, still < 1).
    assert.equal(formatDueScanCostEstimate({ calls: 10, pricedCalls: 10, meanUsd: 0.02, unknown: false }, 5), 'est. $0.1000');
    assert.equal(formatDueScanCostEstimate({ calls: 10, pricedCalls: 10, meanUsd: 0.001, unknown: false }, 1), 'est. $0.0010');
    // A total >= 1 rounds to 2 decimals instead.
    assert.equal(formatDueScanCostEstimate({ calls: 10, pricedCalls: 10, meanUsd: 0.5, unknown: false }, 5), 'est. $2.50');
  });

  test('regression: no input path yields $0.00 for an unknown estimate', () => {
    const sandbox = makeSandbox();
    const { formatDueScanCostEstimate } = sandbox.module.exports;
    const unknownInputs = [
      { calls: 0, pricedCalls: 0, meanUsd: null, unknown: true },
      null,
      undefined,
      { unknown: true, meanUsd: 0 } // unknown must win even when meanUsd is present/zero
    ];
    for (const estimate of unknownInputs) {
      for (const count of [0, 1, 5, 40]) {
        assert.notEqual(formatDueScanCostEstimate(estimate, count), '$0.00', `estimate=${JSON.stringify(estimate)} count=${count} must never render $0.00`);
        assert.notEqual(formatDueScanCostEstimate(estimate, count), 'est. $0.00', `estimate=${JSON.stringify(estimate)} count=${count} must never render est. $0.00`);
      }
    }
  });

  test('the rendered #obs-due-selected-cost hook reflects the wired scanCostEstimate via syncDueBulkBar', () => {
    const sandbox = makeSandbox({ scanCostEstimate: { calls: 4, pricedCalls: 4, meanUsd: 0.02, unknown: false } });
    const { paintDuePage, toggleDueSelection } = sandbox.module.exports;
    paintDuePage([{ issueId: 'a', issueIdentifier: 'LIN-1', dueStatus: true }, { issueId: 'b', issueIdentifier: 'LIN-2', dueStatus: false }], 2, { append: false });
    const estimateEl = sandbox.__nodes.get('obs-due-selected-cost');
    assert.equal(estimateEl.textContent, 'est. $0.00', 'zero selected: meanUsd × 0');
    toggleDueSelection('a', true);
    toggleDueSelection('b', true);
    assert.equal(estimateEl.textContent, 'est. $0.0400');
  });

  test('the rendered hook renders "est. unknown" (never $0.00) when the wired estimate is unknown', () => {
    const sandbox = makeSandbox({ scanCostEstimate: { calls: 0, pricedCalls: 0, meanUsd: null, unknown: true } });
    const { paintDuePage, toggleDueSelection } = sandbox.module.exports;
    paintDuePage([{ issueId: 'a', issueIdentifier: 'LIN-1', dueStatus: true }], 1, { append: false });
    toggleDueSelection('a', true);
    assert.equal(sandbox.__nodes.get('obs-due-selected-cost').textContent, 'est. unknown');
  });

  // Review finding 5 (LIN-2706 PR #1424): §B.5's "copy length is bounded"
  // witness never landed — nothing measured RENDERED output. The disclaimer
  // (lib/render-observation.js's renderBulkScanDisclaimer) is now the
  // longest paragraph on the tab; this pins the estimate/count readouts
  // specifically, since those are the two that grow with the data
  // (selectedCount, meanUsd) rather than being fixed prose.
  test('bounded copy: the estimate and count readouts stay short regardless of selection size or price', () => {
    const sandbox = makeSandbox();
    const { formatDueScanCostEstimate, dueSelectedCountText } = sandbox.module.exports;
    const worstCaseEstimate = formatDueScanCostEstimate({ calls: 40, pricedCalls: 40, meanUsd: 999999.9999, unknown: false }, 40);
    assert.ok(worstCaseEstimate.length <= 40, `estimate readout too long: "${worstCaseEstimate}" (${worstCaseEstimate.length} chars)`);
    for (let i = 0; i < 45; i++) sandbox.module.exports.toggleDueSelection(`row-${i}`, true);
    const countText = dueSelectedCountText();
    assert.ok(countText.length <= 40, `count readout too long: "${countText}" (${countText.length} chars)`);
  });
});

test.describe('over-ceiling refusal — refuse, never truncate (LIN-2706 §B.8)', () => {
  test('selecting past BULK_SCAN_MAX_PER_RUN shows the refusal, interpolating the REAL constant', () => {
    const sandbox = makeSandbox();
    const { paintDuePage, setAllDueSelected, BULK_SCAN_MAX_PER_RUN, dueBulkScanRefusalMessage } = sandbox.module.exports;
    const items = Array.from({ length: BULK_SCAN_MAX_PER_RUN + 5 }, (_, i) => ({ issueId: `i${i}`, issueIdentifier: `LIN-${i}`, dueStatus: null }));
    paintDuePage(items, items.length, { append: false });
    setAllDueSelected(true);

    const message = dueBulkScanRefusalMessage();
    assert.ok(message, 'an over-ceiling selection must produce a refusal message');
    assert.match(message, new RegExp(String(BULK_SCAN_MAX_PER_RUN)), 'the message must interpolate the REAL constant, never a hard-coded 40');

    const refusalEl = sandbox.__nodes.get('obs-due-bulk-refusal');
    assert.equal(refusalEl.hidden, false);
    assert.equal(refusalEl.textContent, message);
  });

  // ACCEPTANCE-WITNESS EXCEPTION (recorded per beat-4 follow-up, since no PR
  // existed yet to carry it): this test could NOT be made to fail against
  // beat 3's own diff in isolation. Stashing lib/render-observation.js +
  // public/observation.js back to beat 2 (commit 373d9e91) and re-running
  // this test still passed — the "selection stays completely intact, never
  // truncated" invariant is established by beat 2's setAllDueSelected/
  // dueSelectedIds (no cap logic exists anywhere in that path), not
  // introduced by beat 3. Beat 3 only ADDS the refusal *display* on top of
  // an already-non-truncating selection. Kept anyway as a real regression
  // guard for the pairing (a future change that capped the selection to
  // "fix" the refusal display would fail this), just not one this specific
  // beat's diff could ever fail on its own.
  test('a refusal enqueues nothing and leaves the selection COMPLETELY intact — no truncation', () => {
    const sandbox = makeSandbox();
    const { paintDuePage, setAllDueSelected, dueSelectedIds, BULK_SCAN_MAX_PER_RUN } = sandbox.module.exports;
    const items = Array.from({ length: BULK_SCAN_MAX_PER_RUN + 5 }, (_, i) => ({ issueId: `i${i}`, issueIdentifier: `LIN-${i}`, dueStatus: null }));
    paintDuePage(items, items.length, { append: false });
    setAllDueSelected(true);

    assert.equal(dueSelectedIds.size, BULK_SCAN_MAX_PER_RUN + 5, 'the selection must be left completely intact, never capped/trimmed down to the ceiling');
    // Nothing is enqueued: startBulkScan is never called from this pre-run
    // surface at all (Session 2, LIN-2707, owns the run control) — there is
    // no call path here to assert a count against. That absence is a
    // structural property of this beat's diff (grep for startBulkScan finds
    // no new call site), not a runtime behaviour this test can probe.
  });

  test('the refusal clears on the next selection change once back within the ceiling', () => {
    const sandbox = makeSandbox();
    const { paintDuePage, setAllDueSelected, toggleDueSelection, dueBulkScanRefusalMessage, BULK_SCAN_MAX_PER_RUN } = sandbox.module.exports;
    const items = Array.from({ length: BULK_SCAN_MAX_PER_RUN + 1 }, (_, i) => ({ issueId: `i${i}`, issueIdentifier: `LIN-${i}`, dueStatus: null }));
    paintDuePage(items, items.length, { append: false });
    setAllDueSelected(true);
    assert.ok(dueBulkScanRefusalMessage(), 'sanity: over the ceiling by 1');

    toggleDueSelection('i0', false);
    assert.equal(dueBulkScanRefusalMessage(), null, 'dropping back to exactly the ceiling must clear the refusal');
  });

  test('a within-ceiling selection never shows a refusal', () => {
    const sandbox = makeSandbox();
    const { paintDuePage, setAllDueSelected, dueBulkScanRefusalMessage } = sandbox.module.exports;
    paintDuePage([{ issueId: 'a', issueIdentifier: 'LIN-1', dueStatus: true }, { issueId: 'b', issueIdentifier: 'LIN-2', dueStatus: false }], 2, { append: false });
    setAllDueSelected(true);
    assert.equal(dueBulkScanRefusalMessage(), null);
  });
});
