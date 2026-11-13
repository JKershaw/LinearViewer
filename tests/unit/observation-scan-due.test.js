/**
 * Client-side coverage for the Observation Scan-due tab (LIN-2649 S4 / LIN-2667):
 * tri-state rendering, the never-ambient guarantee, the shared poll-status pill,
 * and cursor-based pagination.
 *
 * `public/observation.js` is a native ES module (LIN-4463 piece 4): it imports its shared
 * leaves and is loaded fresh per test through `importWorld` (tests/unit/helpers/import-world.js)
 * over the shared fake DOM (tests/unit/helpers/fake-dom.js). The page boots the way a browser
 * boots it: `window.__OBSERVATION_DATA__` is set, and the page's own DOMContentLoaded init runs,
 * so the data and the view it opens on come from the page, not from a probe. The due tab's
 * markup is drawn into the world's document by `DUE_PAGE`, and the assertions read the rows
 * back from that DOM (LIN-4283), not from the list's serialized string.
 *
 * Run with: node --test tests/unit/observation-scan-due.test.js
 */
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { importWorld } from './helpers/import-world.js';
import { fireDOMContentLoaded } from './helpers/client-world.js';

// Every world a test makes is put back after the test, last made first, so a stub a later world installed
// is removed before the earlier world's snapshot is restored.
const worlds = [];
afterEach(() => {
  while (worlds.length) worlds.pop().restore();
});

/**
 * The due tab's elements, under the ids observation.js looks up. Nothing is hidden up front: the client sets `hidden`,
 * `disabled` and the text itself, and the tests read those writes back.
 */
const DUE_PAGE = `
<nav id="obs-tabs"></nav>
<p id="obs-poll-status"></p>
<section id="obs-session-views"></section>
<section id="obs-rulings-section"></section>
<section id="obs-due-section">
  <p id="obs-due-dayone"></p>
  <p id="obs-due-progress"></p>
  <p id="obs-due-empty"></p>
  <ul id="obs-due-list"></ul>
  <button id="obs-due-more" type="button"></button>
  <div id="obs-due-bulk-bar">
    <input id="obs-due-select-all" type="checkbox">
    <span id="obs-due-selected-count"></span>
    <span id="obs-due-selected-cost"></span>
    <p id="obs-due-bulk-refusal"></p>
    <button id="obs-due-scan-selected" type="button"></button>
    <button id="obs-due-stop" type="button"></button>
  </div>
</section>`;

/**
 * The page's boot read: init polls the feed and the rulings as a browser page does, and a test that counts reads must not
 * count the page's own first ones. Until the test is armed, a read is answered with this empty payload, which holds every
 * key a read of any of the page's endpoints looks for.
 */
const BOOT_READ = { active: [], recent: [], rulings: [], items: [], nextCursor: null, pageCandidateCount: 0, totalCandidateCount: 0 };

/**
 * observation.js booted into a world with the due tab drawn in (see `DUE_PAGE`). `search` is the query the page was opened
 * with (for example `?view=due`); `fetchImpl` answers the reads the test makes, once the page has booted.
 */
async function makeSandbox({ fetchImpl, scanCostEstimate, postScanImpl, search = '' } = {}) {
  let armed = false;
  const world = importWorld({
    window: {
      addEventListener() {},
      matchMedia: () => ({ matches: false }),
      location: { href: '', search },
      // LIN-2701 §B.7: the pool reaches postScan via window.ScanSection ONLY
      // (never window.api directly — that would be re-deriving the scan
      // endpoint, the same "no fourth scan-URL builder" non-goal
      // observation-bulk-scan.test.js's sandbox also guards). Existing tests
      // in this file never start a run, so this default is never invoked.
      ScanSection: { postScan: postScanImpl || (async () => { throw new Error('no postScan stub configured'); }) },
    },
    globals: {
      escapeHtml: (s) => (s == null ? '' : String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')),
      relativeTime: () => '',
      console: { warn() {}, error() {}, log() {} },
      fetch: (url, opts) => (armed
        ? (fetchImpl || (async () => { throw new Error('no fetch stub configured'); }))(url, opts)
        : Promise.resolve(jsonResponse(BOOT_READ))),
    },
    timers: [],
  });
  worlds.push(world);
  world.document.body.innerHTML = DUE_PAGE;
  // The page's data, as the server hands it over; init reads it on DOMContentLoaded.
  world.window.__OBSERVATION_DATA__ = { urlKey: 'acme', scanCostEstimate: scanCostEstimate ?? null };
  const page = await world.importPage('observation.js');
  await fireDOMContentLoaded(world.document);
  await flush();
  armed = true;
  return {
    ...world,
    page,
    node: (id) => world.document.getElementById(id),
  };
}

/** The drawn due row for `issueId`: its `li`, and its checkbox (`input.obs-due-select`). */
const dueRow = (sandbox, issueId) => sandbox.node('obs-due-list').querySelector(`li.obs-due-row[data-issue-id="${issueId}"]`);
const dueBox = (sandbox, issueId) => sandbox.node('obs-due-list').querySelector(`input.obs-due-select[data-issue-id="${issueId}"]`);

const flush = async (times = 6) => {
  for (let i = 0; i < times; i++) await new Promise((r) => setImmediate(r));
};

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => body };
}

// ─── Tri-state rendering (design §3/§6/§8) ──────────────────────────────────

test.describe('dueStatusCopy / renderDueRowHtml — tri-state rendering', () => {
  test('dueStatus: true renders as due', async () => {
    const { dueStatusCopy } = (await makeSandbox()).page;
    const result = dueStatusCopy({ dueStatus: true });
    assert.match(result.text, /due/i);
    assert.doesNotMatch(result.text, /not due/i);
  });

  test('dueStatus: false renders as not-due', async () => {
    const { dueStatusCopy } = (await makeSandbox()).page;
    const result = dueStatusCopy({ dueStatus: false });
    assert.match(result.text, /not due/i);
  });

  test('plain null (no error) renders the scan-baseline copy, never "not due"', async () => {
    const { dueStatusCopy } = (await makeSandbox()).page;
    const result = dueStatusCopy({ dueStatus: null });
    assert.match(result.text, /not checked yet — scan it once to set its baseline/);
    assert.doesNotMatch(result.text, /not due/i);
  });

  test('null WITH error:true renders the distinct retry copy, never the scan-baseline copy', async () => {
    const { dueStatusCopy } = (await makeSandbox()).page;
    const result = dueStatusCopy({ dueStatus: null, error: true });
    assert.match(result.text, /provider read failed/i);
    assert.doesNotMatch(result.text, /not checked yet/i);
    assert.doesNotMatch(result.text, /not due/i);
  });

  test('a non-boolean, non-null dueStatus (defensive) never renders as due/not-due', async () => {
    // Mirrors the `typeof x === 'boolean'` guard requestBasisCheck already
    // uses for basisChanged — a malformed wire value must fall through to
    // "unknown", never be coerced into a due/not-due claim.
    const { dueStatusCopy } = (await makeSandbox()).page;
    const result = dueStatusCopy({ dueStatus: 'true' });
    assert.match(result.text, /not checked yet — scan it once to set its baseline/);
  });

  test('renderDueRowHtml renders a Retry affordance ONLY on the error branch', async () => {
    const { renderDueRowHtml } = (await makeSandbox()).page;
    const errorRow = renderDueRowHtml({ issueId: 'i1', issueIdentifier: 'LIN-1', dueStatus: null, error: true });
    const okRow = renderDueRowHtml({ issueId: 'i2', issueIdentifier: 'LIN-2', dueStatus: null });
    assert.match(errorRow, /obs-due-retry/);
    assert.doesNotMatch(okRow, /obs-due-retry/);
  });

  test('renderDueRowHtml always carries the provider-read badge, distinct from a scan affordance', async () => {
    const { renderDueRowHtml } = (await makeSandbox()).page;
    const row = renderDueRowHtml({ issueId: 'i1', issueIdentifier: 'LIN-1', dueStatus: true });
    assert.match(row, /obs-due-badge/);
    assert.match(row, /provider read/);
  });
});

// ─── Never-ambient guarantee ([F-1]) ─────────────────────────────────────────

test.describe('pollCurrentView — the due tab is never polled ambiently', () => {
  test('pollCurrentView performs NO fetch while currentView is "due"', async () => {
    let calls = 0;
    // The page is opened on the due tab (`?view=due`), as a browser opens it: its own boot loads the first page.
    const sandbox = await makeSandbox({ search: '?view=due', fetchImpl: async () => { calls++; return jsonResponse({}); } });
    const { pollCurrentView } = sandbox.page;

    // Simulate all three real call sites: the tick loop, a visibilitychange
    // firing, and a repeated call — none may fetch while the due tab is active.
    pollCurrentView();
    pollCurrentView();
    pollCurrentView();
    await flush();

    assert.equal(calls, 0, 'pollCurrentView must be a pure no-op for the due tab, not a due-specific branch that fetches');
  });

  test('pollCurrentView on the runs view makes exactly two reads: the feed, and the rulings for the waiting block', async () => {
    // LIN-3983: the runs view polls the feed and the rulings read that feeds the
    // waiting block. Neither is a due-tab read, so the due early return above
    // leaves both pollers alone.
    const calls = [];
    const sandbox = await makeSandbox({ fetchImpl: async (url) => { calls.push(url); return jsonResponse({ active: [], recent: [], rulings: [] }); } });
    const { pollCurrentView } = sandbox.page;
    pollCurrentView();
    await flush();
    assert.equal(calls.length, 2, `expected the feed and the rulings read, got ${calls.length}`);
    assert.ok(calls.some(u => /\/api\/dashboard\/sessions$/.test(u)), 'the feed read (autopilot filter: no view param)');
    assert.ok(calls.some(u => /\/api\/dashboard\/rulings$/.test(u)), 'the rulings read');
  });
});

test.describe('switchView("due") — the one-shot load, and only from here', () => {
  test('switching to due triggers exactly one fetch, to the scan-due endpoint', async () => {
    const calls = [];
    const sandbox = await makeSandbox({
      fetchImpl: async (url) => { calls.push(url); return jsonResponse({ items: [], nextCursor: null, pageCandidateCount: 0, totalCandidateCount: 0 }); }
    });
    const { switchView } = sandbox.page;
    switchView('due');
    await flush();
    assert.equal(calls.length, 1, `expected exactly one fetch on tab switch, got ${calls.length}`);
    assert.match(calls[0], /\/api\/scan-due$/);
  });

  test('the due section is shown and the session/rulings containers are hidden', async () => {
    const sandbox = await makeSandbox({ fetchImpl: async () => jsonResponse({ items: [], nextCursor: null, pageCandidateCount: 0, totalCandidateCount: 0 }) });
    const { switchView } = sandbox.page;
    switchView('due');
    await flush();
    assert.equal(sandbox.node('obs-due-section').hidden, false);
    assert.equal(sandbox.node('obs-session-views').hidden, true);
    assert.equal(sandbox.node('obs-rulings-section').hidden, true);
  });

  test('switching to due twice in a row (no-op on the second) still issues only one fetch', async () => {
    let calls = 0;
    const sandbox = await makeSandbox({ fetchImpl: async () => { calls++; return jsonResponse({ items: [], nextCursor: null, pageCandidateCount: 0, totalCandidateCount: 0 }); } });
    const { switchView } = sandbox.page;
    switchView('due');
    switchView('due'); // same view — switchView's own `view === currentView` guard no-ops this
    await flush();
    assert.equal(calls, 1);
  });
});

// ─── [C-2] Shared poll-status pill must not strand on "loading…" ────────────

test.describe('setPollStatus pill — entering the due tab resolves, never strands', () => {
  test('a successful due load leaves the pill on "● live", not "loading…"', async () => {
    const sandbox = await makeSandbox({ fetchImpl: async () => jsonResponse({ items: [], nextCursor: null, pageCandidateCount: 0, totalCandidateCount: 0 }) });
    const { switchView } = sandbox.page;
    switchView('due');
    await flush();
    const pill = sandbox.node('obs-poll-status');
    assert.notEqual(pill.textContent, 'loading…');
    assert.equal(pill.textContent, '● live');
  });

  test('a failed due load leaves the pill on "● disconnected", not "loading…"', async () => {
    const sandbox = await makeSandbox({ fetchImpl: async () => jsonResponse({}, { ok: false, status: 500 }) });
    const { switchView } = sandbox.page;
    switchView('due');
    await flush();
    const pill = sandbox.node('obs-poll-status');
    assert.notEqual(pill.textContent, 'loading…');
    assert.equal(pill.textContent, '● disconnected');
  });
});

// ─── Pagination ──────────────────────────────────────────────────────────────

test.describe('loadInitialDueCheckPage / loadMoreDueChecks — pagination', () => {
  test('load-more replays the stored nextCursor VERBATIM as ?cursor=', async () => {
    const calls = [];
    const sandbox = await makeSandbox({
      fetchImpl: async (url) => {
        calls.push(url);
        if (calls.length === 1) {
          return jsonResponse({ items: [{ issueId: 'a', issueIdentifier: 'LIN-1', dueStatus: true }], nextCursor: 'OPAQUE_CURSOR_ABC', pageCandidateCount: 1, totalCandidateCount: 2 });
        }
        return jsonResponse({ items: [{ issueId: 'b', issueIdentifier: 'LIN-2', dueStatus: false }], nextCursor: null, pageCandidateCount: 1, totalCandidateCount: 2 });
      }
    });
    const { loadInitialDueCheckPage, loadMoreDueChecks } = sandbox.page;

    await loadInitialDueCheckPage();
    await loadMoreDueChecks();

    assert.equal(calls.length, 2);
    assert.match(calls[1], /\?cursor=OPAQUE_CURSOR_ABC$/, 'the cursor must be replayed verbatim, never re-encoded/decoded client-side');
  });

  test('load-more APPENDS rather than replacing the list', async () => {
    const sandbox = await makeSandbox({
      fetchImpl: async (url) => (url.includes('cursor')
        ? jsonResponse({ items: [{ issueId: 'b', issueIdentifier: 'LIN-2', dueStatus: false }], nextCursor: null, pageCandidateCount: 1, totalCandidateCount: 2 })
        : jsonResponse({ items: [{ issueId: 'a', issueIdentifier: 'LIN-1', dueStatus: true }], nextCursor: 'CUR1', pageCandidateCount: 1, totalCandidateCount: 2 }))
    });
    const { loadInitialDueCheckPage, loadMoreDueChecks } = sandbox.page;
    await loadInitialDueCheckPage();
    await loadMoreDueChecks();

    assert.ok(dueRow(sandbox, 'a'), 'the first page row stays drawn');
    assert.ok(dueRow(sandbox, 'b'), 'the second page must be appended, not replace the first');
    assert.equal(dueRow(sandbox, 'a').querySelector('.obs-due-issue').textContent, 'LIN-1');
    assert.equal(dueRow(sandbox, 'b').querySelector('.obs-due-issue').textContent, 'LIN-2');
  });

  test('the load-more button is hidden when nextCursor is null, shown when non-null', async () => {
    const sandbox = await makeSandbox({
      fetchImpl: async () => jsonResponse({ items: [{ issueId: 'a', issueIdentifier: 'LIN-1', dueStatus: true }], nextCursor: 'CUR1', pageCandidateCount: 1, totalCandidateCount: 2 })
    });
    const { loadInitialDueCheckPage } = sandbox.page;
    await loadInitialDueCheckPage();
    assert.equal(sandbox.node('obs-due-more').hidden, false, 'a non-null nextCursor must show the load-more button');

    const sandbox2 = await makeSandbox({
      fetchImpl: async () => jsonResponse({ items: [], nextCursor: null, pageCandidateCount: 0, totalCandidateCount: 0 })
    });
    const { loadInitialDueCheckPage: load2 } = sandbox2.page;
    await load2();
    assert.equal(sandbox2.node('obs-due-more').hidden, true, 'a null nextCursor must hide/disable the load-more button');
  });

  test('the "checked N of M" readout comes from pageCandidateCount/totalCandidateCount', async () => {
    const sandbox = await makeSandbox({
      fetchImpl: async (url) => (url.includes('cursor')
        ? jsonResponse({ items: [{ issueId: 'b', issueIdentifier: 'LIN-2', dueStatus: false }], nextCursor: null, pageCandidateCount: 1, totalCandidateCount: 41 })
        : jsonResponse({ items: Array.from({ length: 40 }, (_, i) => ({ issueId: `i${i}`, issueIdentifier: `LIN-${i}`, dueStatus: null })), nextCursor: 'CUR1', pageCandidateCount: 40, totalCandidateCount: 41 }))
    });
    const { loadInitialDueCheckPage, loadMoreDueChecks } = sandbox.page;
    await loadInitialDueCheckPage();
    assert.equal(sandbox.node('obs-due-progress').textContent, 'checked 40 of 41');
    await loadMoreDueChecks();
    assert.equal(sandbox.node('obs-due-progress').textContent, 'checked 41 of 41');
  });

  test('day-one notice shows when the first page is entirely dueStatus:null, hides otherwise', async () => {
    const allNull = await makeSandbox({
      fetchImpl: async () => jsonResponse({ items: [{ issueId: 'a', issueIdentifier: 'LIN-1', dueStatus: null }, { issueId: 'b', issueIdentifier: 'LIN-2', dueStatus: null }], nextCursor: null, pageCandidateCount: 2, totalCandidateCount: 2 })
    });
    await allNull.page.loadInitialDueCheckPage();
    assert.equal(allNull.node('obs-due-dayone').hidden, false);

    const mixed = await makeSandbox({
      fetchImpl: async () => jsonResponse({ items: [{ issueId: 'a', issueIdentifier: 'LIN-1', dueStatus: true }, { issueId: 'b', issueIdentifier: 'LIN-2', dueStatus: null }], nextCursor: null, pageCandidateCount: 2, totalCandidateCount: 2 })
    });
    await mixed.page.loadInitialDueCheckPage();
    assert.equal(mixed.node('obs-due-dayone').hidden, true);
  });

  test('day-one notice stays hidden when the first page is entirely provider-read errors', async () => {
    const allError = await makeSandbox({
      fetchImpl: async () => jsonResponse({ items: [{ issueId: 'a', issueIdentifier: 'LIN-1', dueStatus: null, error: true }, { issueId: 'b', issueIdentifier: 'LIN-2', dueStatus: null, error: true }], nextCursor: null, pageCandidateCount: 2, totalCandidateCount: 2 })
    });
    await allError.page.loadInitialDueCheckPage();
    assert.equal(allError.node('obs-due-dayone').hidden, true, 'an all-error page must not get scan-baseline day-one copy');
  });

  test('loadInitialDueCheckPage guards re-entrancy: a second call while one is in flight is a no-op', async () => {
    let calls = 0;
    let resolveFirst;
    const sandbox = await makeSandbox({
      fetchImpl: () => { calls++; return new Promise((resolve) => { resolveFirst = resolve; }); }
    });
    const { loadInitialDueCheckPage } = sandbox.page;
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
    const sandbox = await makeSandbox({
      fetchImpl: async () => jsonResponse({ items: [{ issueId: 'a', issueIdentifier: 'LIN-1', dueStatus: true }], nextCursor: null, pageCandidateCount: 1, totalCandidateCount: 1 })
    });
    const { loadInitialDueCheckPage, dueSelectedIds, toggleDueSelection } = sandbox.page;
    await loadInitialDueCheckPage();
    toggleDueSelection('a', true);
    assert.ok(dueSelectedIds.has('a'), 'selection sanity check before reload');

    await loadInitialDueCheckPage();
    assert.equal(dueSelectedIds.size, 0, 'a fresh tab entry must clear the selection unconditionally');
  });

  test('survives loadMoreDueChecks — an in-progress selection is not dropped by pagination', async () => {
    const sandbox = await makeSandbox({
      fetchImpl: async (url) => (url.includes('cursor')
        ? jsonResponse({ items: [{ issueId: 'b', issueIdentifier: 'LIN-2', dueStatus: false }], nextCursor: null, pageCandidateCount: 1, totalCandidateCount: 2 })
        : jsonResponse({ items: [{ issueId: 'a', issueIdentifier: 'LIN-1', dueStatus: true }], nextCursor: 'CUR1', pageCandidateCount: 1, totalCandidateCount: 2 }))
    });
    const { loadInitialDueCheckPage, loadMoreDueChecks, dueSelectedIds, toggleDueSelection } = sandbox.page;
    await loadInitialDueCheckPage();
    toggleDueSelection('a', true);

    await loadMoreDueChecks();
    // Read before any repaint: the first page's row is still drawn after the append, and so is the appended one.
    assert.ok(dueBox(sandbox, 'a') && dueBox(sandbox, 'b'), 'both pages\' rows must be drawn after the append');
    assert.ok(dueSelectedIds.has('a'), 'appending a page must not silently drop an in-progress selection');
  });

  test('prunes a vanished row on a full repaint — the count can never exceed what is on screen', async () => {
    // Isolates paintDuePage's OWN prune-by-intersection mechanism from
    // loadInitialDueCheckPage's unconditional clear (tested separately
    // above) by driving paintDuePage directly.
    const sandbox = await makeSandbox();
    const { paintDuePage, dueSelectedIds, toggleDueSelection } = sandbox.page;
    paintDuePage([{ issueId: 'a', issueIdentifier: 'LIN-1', dueStatus: true }, { issueId: 'b', issueIdentifier: 'LIN-2', dueStatus: false }], 2, { append: false });
    toggleDueSelection('a', true);
    toggleDueSelection('b', true);
    assert.equal(dueSelectedIds.size, 2, 'selection sanity check before the repaint');

    // A full repaint (append:false) whose new rows no longer include 'a'.
    paintDuePage([{ issueId: 'b', issueIdentifier: 'LIN-2', dueStatus: false }], 1, { append: false });
    assert.deepEqual([...dueSelectedIds], ['b'], "'a' must be pruned once it is no longer among the loaded rows");
  });

  test('loaded-rows-only: a load-more page never prunes rows from an EARLIER page', async () => {
    const sandbox = await makeSandbox({
      fetchImpl: async (url) => (url.includes('cursor')
        ? jsonResponse({ items: [{ issueId: 'b', issueIdentifier: 'LIN-2', dueStatus: false }], nextCursor: null, pageCandidateCount: 1, totalCandidateCount: 2 })
        : jsonResponse({ items: [{ issueId: 'a', issueIdentifier: 'LIN-1', dueStatus: true }], nextCursor: 'CUR1', pageCandidateCount: 1, totalCandidateCount: 2 }))
    });
    const { loadInitialDueCheckPage, loadMoreDueChecks, dueSelectedIds, toggleDueSelection } = sandbox.page;
    await loadInitialDueCheckPage();
    toggleDueSelection('a', true);
    await loadMoreDueChecks();
    // Read before any repaint: the first page's row is still drawn after the append.
    assert.ok(dueBox(sandbox, 'a') && dueBox(sandbox, 'b'), 'both pages\' rows must be drawn after the append');
    toggleDueSelection('b', true);
    assert.deepEqual([...dueSelectedIds].sort(), ['a', 'b'], 'both pages worth of selection must coexist — pagination is additive, never a prune trigger');
  });
});

test.describe('per-row checkbox + select-all — rendering and tri-state (LIN-2706 §B.3)', () => {
  test('renderDueRowHtml reflects Set membership: checked when selected, unchecked otherwise', async () => {
    const sandbox = await makeSandbox();
    const { renderDueRowHtml, dueSelectedIds } = sandbox.page;
    const item = { issueId: 'a', issueIdentifier: 'LIN-1', dueStatus: true };

    assert.doesNotMatch(renderDueRowHtml(item), /obs-due-select[^>]*checked/, 'unselected row must not render checked');
    dueSelectedIds.add('a');
    assert.match(renderDueRowHtml(item), /class="obs-due-select" data-issue-id="a" checked/, 'selected row must render checked');
  });

  // Review N3 (LIN-2706 PR #1424): the row's identifier lives in a SIBLING
  // span, so the checkbox has no accessible name unless it carries one of its
  // own — a screen reader would otherwise announce an unnamed checkbox with no
  // way to tell which task it selects.
  test('renderDueRowHtml gives every per-row checkbox an accessible name carrying the row identifier', async () => {
    const { renderDueRowHtml } = (await makeSandbox()).page;

    const row = renderDueRowHtml({ issueId: 'a', issueIdentifier: 'LIN-1', dueStatus: true });
    assert.match(row, /<input type="checkbox" aria-label="select LIN-1"/, 'the checkbox must name the row it selects');

    // The identifier is the label when present; the raw id is the fallback,
    // matching the visible `.obs-due-issue` span's own idLabel derivation, so
    // the announced name can never disagree with the name on screen.
    const noIdentifier = renderDueRowHtml({ issueId: 'raw-id-9', dueStatus: null });
    assert.match(noIdentifier, /aria-label="select raw-id-9"/, 'falls back to the issueId, exactly as the visible label does');

    // Escaped, like every other interpolation in this renderer.
    const nasty = renderDueRowHtml({ issueId: 'x', issueIdentifier: '<img src=x>', dueStatus: true });
    assert.match(nasty, /aria-label="select &lt;img src=x&gt;"/, 'the accessible name is escaped, not raw');
    assert.doesNotMatch(nasty, /aria-label="select <img/);
  });

  test('a repaint with the SAME items preserves checked state (idempotent repaint)', async () => {
    const sandbox = await makeSandbox();
    const { paintDuePage, toggleDueSelection } = sandbox.page;
    const items = [{ issueId: 'a', issueIdentifier: 'LIN-1', dueStatus: true }, { issueId: 'b', issueIdentifier: 'LIN-2', dueStatus: false }];
    paintDuePage(items, 2, { append: false });
    toggleDueSelection('a', true);

    // Re-painting the SAME items (e.g. a retry re-running the same load)
    // must reproduce the checked state from the Set, not drop it.
    paintDuePage(items, 2, { append: false });
    assert.equal(dueBox(sandbox, 'a').checked, true, "row 'a' must stay checked across the repaint");
    assert.equal(dueBox(sandbox, 'b').checked, false, "row 'b' must stay unchecked across the repaint");
  });

  // LIN-2760 (John's ruling on LIN-2241 F3, decision `lin2241-f3-selectall`)
  // rewrote this pin: select-all used to select every loaded row — a
  // deliberate day-one choice pinned here, because on day one every
  // previously-scanned task reads `unknown` and a strict due-only rule would
  // select nothing. The ruling keeps day one (unknown stays selected) while
  // stopping the blind billing of the other two statuses: not-due rows are
  // unchanged by definition, and errored rows must not be re-billed blindly
  // — each selected row costs one billable LLM scan.
  test('select-all selects due + unknown only — not-due and errored rows are skipped, exactly two of the four-status fixture selected', async () => {
    const sandbox = await makeSandbox({ scanCostEstimate: { calls: 4, pricedCalls: 4, meanUsd: 0.02, unknown: false } });
    const { paintDuePage, setAllDueSelected, dueSelectedIds } = sandbox.page;
    paintDuePage([
      { issueId: 'due', issueIdentifier: 'LIN-1', dueStatus: true },
      { issueId: 'unknown', issueIdentifier: 'LIN-2', dueStatus: null },
      { issueId: 'not-due', issueIdentifier: 'LIN-3', dueStatus: false },
      { issueId: 'errored', issueIdentifier: 'LIN-4', dueStatus: null, error: true },
    ], 4, { append: false });

    setAllDueSelected(true);
    assert.deepEqual([...dueSelectedIds].sort(), ['due', 'unknown'], 'select-all covers due + unknown only — not-due and errored rows are skipped');
    assert.equal(dueSelectedIds.size, 2, 'exactly two of the four rows are selected');

    // Acceptance: the pre-run count and cost estimate reflect the two
    // selected rows (they are unchanged in MECHANISM — they read
    // dueSelectedIds, which the select-all filter now bounds).
    assert.equal(sandbox.node('obs-due-selected-count').textContent, '2 selected (exact)');
    assert.equal(sandbox.node('obs-due-selected-cost').textContent, 'est. $0.0400', 'meanUsd × 2, not × 4 — the estimate follows the bounded selection');

    setAllDueSelected(false);
    assert.equal(dueSelectedIds.size, 0, 'select-all off must clear exactly the loaded rows');
  });

  // The per-row checkbox stays free under LIN-2760's rule: select-all skips
  // not-due/errored rows, but an operator can still hand-pick one.
  test('a hand-picked not-due row stays selected — select-all off still clears it with the rest', async () => {
    const sandbox = await makeSandbox();
    const { paintDuePage, toggleDueSelection, setAllDueSelected, dueSelectedIds } = sandbox.page;
    paintDuePage([
      { issueId: 'due', issueIdentifier: 'LIN-1', dueStatus: true },
      { issueId: 'not-due', issueIdentifier: 'LIN-2', dueStatus: false },
    ], 2, { append: false });

    setAllDueSelected(true);
    toggleDueSelection('not-due', true);
    assert.deepEqual([...dueSelectedIds].sort(), ['due', 'not-due'], 'a hand-picked not-due row must remain selectable');

    setAllDueSelected(false);
    assert.equal(dueSelectedIds.size, 0, 'select-all off clears every loaded row, hand-picked ones included');
  });

  test('select-all-loaded repaints the list so every row reflects the new membership', async () => {
    const sandbox = await makeSandbox();
    const { paintDuePage, setAllDueSelected } = sandbox.page;
    // LIN-2760: one due + one not-due row — the repaint must reflect the
    // FILTERED membership, not just "everything checked", so this fixture
    // pins both halves of the render at once.
    paintDuePage([{ issueId: 'a', issueIdentifier: 'LIN-1', dueStatus: true }, { issueId: 'b', issueIdentifier: 'LIN-2', dueStatus: false }], 2, { append: false });

    setAllDueSelected(true);
    assert.equal(dueBox(sandbox, 'a').checked, true, 'the due row must render checked');
    assert.equal(dueBox(sandbox, 'b').checked, false, 'the not-due row must render unchecked — select-all skips it (LIN-2760)');
  });

  test('select-all-loaded, driven across a load-more, covers BOTH pages — the loaded population grows additively', async () => {
    const sandbox = await makeSandbox({
      fetchImpl: async (url) => (url.includes('cursor')
        ? jsonResponse({ items: [{ issueId: 'b', issueIdentifier: 'LIN-2', dueStatus: null }], nextCursor: null, pageCandidateCount: 1, totalCandidateCount: 2 })
        : jsonResponse({ items: [{ issueId: 'a', issueIdentifier: 'LIN-1', dueStatus: true }], nextCursor: 'CUR1', pageCandidateCount: 1, totalCandidateCount: 2 }))
    });
    const { loadInitialDueCheckPage, loadMoreDueChecks, setAllDueSelected, dueSelectedIds } = sandbox.page;
    await loadInitialDueCheckPage();
    await loadMoreDueChecks();
    assert.ok(dueBox(sandbox, 'a') && dueBox(sandbox, 'b'), 'both pages\' rows must be drawn after the append');
    setAllDueSelected(true);
    // Both pages' rows are select-all-covered (due + unknown — LIN-2760), so
    // the additive-population property still holds under the new rule.
    assert.deepEqual([...dueSelectedIds].sort(), ['a', 'b']);
  });

  test('tri-state: none/some/all loaded selected, and the bulk bar is hidden with nothing loaded', async () => {
    const sandbox = await makeSandbox();
    const { paintDuePage, toggleDueSelection } = sandbox.page;
    const selectAll = sandbox.node('obs-due-select-all');
    const bar = sandbox.node('obs-due-bulk-bar');

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

  // LIN-2760: the select-all tri-state is keyed on the coverable population
  // (due + unknown), mirroring syncRulingsBulkBar's selectable-keyed tri-state
  // — NOT on all loaded rows. The fixture above cannot distinguish the two
  // semantics (its states coincide under both); this one holds skipped rows
  // and asserts the states where they differ. Without the re-base the
  // checkbox snaps back unchecked the moment a not-due/errored row exists on
  // screen, even though the click did exactly what its label says.
  test('select-all tri-state is keyed on the due+unknown population — checked survives skipped rows, hand-picks alone never read indeterminate', async () => {
    const sandbox = await makeSandbox();
    const { paintDuePage, setAllDueSelected, toggleDueSelection, dueSelectedIds } = sandbox.page;
    const selectAll = sandbox.node('obs-due-select-all');

    paintDuePage([
      { issueId: 'due', issueIdentifier: 'LIN-1', dueStatus: true },
      { issueId: 'not-due', issueIdentifier: 'LIN-2', dueStatus: false },
      { issueId: 'errored', issueIdentifier: 'LIN-3', dueStatus: null, error: true },
    ], 3, { append: false });

    setAllDueSelected(true);
    assert.deepEqual([...dueSelectedIds], ['due'], 'only the coverable row is selected');
    assert.equal(selectAll.checked, true, 'select-all did its whole job (all due+unknown selected) — the checkbox must stay checked, not snap back');
    assert.equal(selectAll.indeterminate, false);

    // A hand-picked skipped row beside a complete coverable selection
    // neither satisfies nor defeats the checked state.
    toggleDueSelection('not-due', true);
    assert.equal(selectAll.checked, true, 'a hand-picked skipped row must not un-check select-all');
    assert.equal(selectAll.indeterminate, false);

    // Dropping the one coverable row leaves only hand-picked skipped rows
    // selected — plain unchecked, never indeterminate.
    toggleDueSelection('due', false);
    assert.equal(selectAll.checked, false);
    assert.equal(selectAll.indeterminate, false, 'hand-picked skipped rows alone must not read as "some coverable selected"');
  });

  // LIN-2760 follow-up ruling (2026-09-13): when EVERY loaded row is skipped
  // (not-due/errored) the coverable population is empty, and the coverable-
  // keyed tri-state above would render the checkbox unchecked and not
  // indeterminate even while hand-picked rows are selected — leaving
  // "check" (a no-op with nothing coverable) as the only reachable click and
  // stranding the uncheck branch ("clears every loaded row", deliberately
  // preserved by the ruling) behind per-row unticks only. The tri-state
  // therefore falls back to the pre-ruling ALL-LOADED keying when coverable
  // is empty — the same all-loaded keying the bar's own visibility already
  // uses, and the same rationale: a skipped row is still hand-pickable, so
  // the control that can clear it must stay reachable.
  test('empty-coverable fallback: on an all-skipped page the tri-state keys on all loaded rows so a hand-picked selection is clearable from select-all', async () => {
    const sandbox = await makeSandbox();
    const { paintDuePage, toggleDueSelection, setAllDueSelected, dueSelectedIds } = sandbox.page;
    const selectAll = sandbox.node('obs-due-select-all');

    paintDuePage([
      { issueId: 'not-due', issueIdentifier: 'LIN-1', dueStatus: false },
      { issueId: 'errored', issueIdentifier: 'LIN-2', dueStatus: null, error: true },
    ], 2, { append: false });
    assert.equal(selectAll.checked, false);
    assert.equal(selectAll.indeterminate, false, 'nothing selected on an all-skipped page: plain unchecked');

    // One of the two loaded rows hand-picked: all-loaded keying reads
    // "some" — the indeterminate state the coverable keying cannot show
    // with an empty coverable population (0 < n < 0 is impossible).
    toggleDueSelection('not-due', true);
    assert.equal(selectAll.checked, false);
    assert.equal(selectAll.indeterminate, true, 'a partial hand-pick on an all-skipped page must read indeterminate under the all-loaded fallback');

    // Every loaded row hand-picked: checked — so the operator's next click
    // on the control is the UNCHECK branch, which clears every loaded row.
    toggleDueSelection('errored', true);
    assert.equal(selectAll.checked, true, 'all loaded rows hand-picked on an all-skipped page: the fallback reads checked, keeping the clear path reachable');
    assert.equal(selectAll.indeterminate, false);

    // The escape hatch itself: the uncheck branch (what a click on the
    // checked box drives) clears the hand-picked selection.
    setAllDueSelected(false);
    assert.equal(dueSelectedIds.size, 0, 'the hand-picked selection must be clearable from the select-all control itself');
    assert.equal(selectAll.checked, false);
    assert.equal(selectAll.indeterminate, false);
  });
});

// ─── Exact count, honest cost estimate, over-ceiling refusal (LIN-2706 §B.4/§B.5/§B.8) ───
//
// Still no spend path and no scan-triggering control anywhere in this file's
// exports — no "Scan selected" button, no Stop button, nothing that calls
// startBulkScan. These are pre-run-only surfaces.

test.describe('dueSelectedCountText — exact count (LIN-2706 §B.4)', () => {
  test('renders the exact selected count, never merged with the cost figure', async () => {
    const sandbox = await makeSandbox();
    const { paintDuePage, toggleDueSelection, dueSelectedCountText } = sandbox.page;
    paintDuePage([{ issueId: 'a', issueIdentifier: 'LIN-1', dueStatus: true }, { issueId: 'b', issueIdentifier: 'LIN-2', dueStatus: false }], 2, { append: false });
    assert.match(dueSelectedCountText(), /^0 selected/);
    assert.doesNotMatch(dueSelectedCountText(), /\$/, 'the count text must never carry a dollar figure');

    toggleDueSelection('a', true);
    assert.match(dueSelectedCountText(), /^1 selected/);
    toggleDueSelection('b', true);
    assert.match(dueSelectedCountText(), /^2 selected/);
  });

  test('the rendered #obs-due-selected-count hook tracks selection via syncDueBulkBar', async () => {
    const sandbox = await makeSandbox();
    const { paintDuePage, toggleDueSelection } = sandbox.page;
    paintDuePage([{ issueId: 'a', issueIdentifier: 'LIN-1', dueStatus: true }], 1, { append: false });
    const countEl = sandbox.node('obs-due-selected-count');
    assert.match(countEl.textContent, /^0 selected/);
    toggleDueSelection('a', true);
    assert.match(countEl.textContent, /^1 selected/);
  });
});

test.describe('formatDueScanCostEstimate — honest unknown, never $0.00 for it (LIN-2706 §B.5)', () => {
  test('unknown:true renders "est. unknown"', async () => {
    const sandbox = await makeSandbox();
    const { formatDueScanCostEstimate } = sandbox.page;
    assert.equal(formatDueScanCostEstimate({ calls: 0, pricedCalls: 0, meanUsd: null, unknown: true }, 5), 'est. unknown');
  });

  test('a null/absent estimate renders "est. unknown"', async () => {
    const sandbox = await makeSandbox();
    const { formatDueScanCostEstimate } = sandbox.page;
    assert.equal(formatDueScanCostEstimate(null, 5), 'est. unknown');
    assert.equal(formatDueScanCostEstimate(undefined, 5), 'est. unknown');
  });

  test('a priced row averaging exactly zero renders est. $0.0000 (fine: a real zero), unknown:false — distinct from the unknown state', async () => {
    const sandbox = await makeSandbox();
    const { formatDueScanCostEstimate } = sandbox.page;
    assert.equal(formatDueScanCostEstimate({ calls: 3, pricedCalls: 3, meanUsd: 0, unknown: false }, 5), 'est. $0.0000');
  });

  test('a normal priced mean renders meanUsd × selectedCount', async () => {
    const sandbox = await makeSandbox();
    const { formatDueScanCostEstimate } = sandbox.page;
    // Sub-$1 totals keep 4 decimals, mirroring formatCost's own precision idiom
    // (0.02 * 5 = 0.10, still < 1).
    assert.equal(formatDueScanCostEstimate({ calls: 10, pricedCalls: 10, meanUsd: 0.02, unknown: false }, 5), 'est. $0.1000');
    assert.equal(formatDueScanCostEstimate({ calls: 10, pricedCalls: 10, meanUsd: 0.001, unknown: false }, 1), 'est. $0.0010');
    // A total >= 1 rounds to 2 decimals instead.
    assert.equal(formatDueScanCostEstimate({ calls: 10, pricedCalls: 10, meanUsd: 0.5, unknown: false }, 5), 'est. $2.50');
  });

  test('regression: no input path yields $0.00 for an unknown estimate', async () => {
    const sandbox = await makeSandbox();
    const { formatDueScanCostEstimate } = sandbox.page;
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

  test('the rendered #obs-due-selected-cost hook reflects the wired scanCostEstimate via syncDueBulkBar', async () => {
    const sandbox = await makeSandbox({ scanCostEstimate: { calls: 4, pricedCalls: 4, meanUsd: 0.02, unknown: false } });
    const { paintDuePage, toggleDueSelection } = sandbox.page;
    paintDuePage([{ issueId: 'a', issueIdentifier: 'LIN-1', dueStatus: true }, { issueId: 'b', issueIdentifier: 'LIN-2', dueStatus: false }], 2, { append: false });
    const estimateEl = sandbox.node('obs-due-selected-cost');
    assert.equal(estimateEl.textContent, 'est. $0.0000', 'zero selected: meanUsd × 0');
    toggleDueSelection('a', true);
    toggleDueSelection('b', true);
    assert.equal(estimateEl.textContent, 'est. $0.0400');
  });

  test('the rendered hook renders "est. unknown" (never $0.00) when the wired estimate is unknown', async () => {
    const sandbox = await makeSandbox({ scanCostEstimate: { calls: 0, pricedCalls: 0, meanUsd: null, unknown: true } });
    const { paintDuePage, toggleDueSelection } = sandbox.page;
    paintDuePage([{ issueId: 'a', issueIdentifier: 'LIN-1', dueStatus: true }], 1, { append: false });
    toggleDueSelection('a', true);
    assert.equal(sandbox.node('obs-due-selected-cost').textContent, 'est. unknown');
  });

  // Review finding 5 (LIN-2706 PR #1424): §B.5's "copy length is bounded"
  // witness never landed — nothing measured RENDERED output. The disclaimer
  // (lib/render-observation.js's renderBulkScanDisclaimer) is now the
  // longest paragraph on the tab; this pins the estimate/count readouts
  // specifically, since those are the two that grow with the data
  // (selectedCount, meanUsd) rather than being fixed prose.
  test('bounded copy: the estimate and count readouts stay short regardless of selection size or price', async () => {
    const sandbox = await makeSandbox();
    const { formatDueScanCostEstimate, dueSelectedCountText } = sandbox.page;
    const worstCaseEstimate = formatDueScanCostEstimate({ calls: 40, pricedCalls: 40, meanUsd: 999999.9999, unknown: false }, 40);
    assert.ok(worstCaseEstimate.length <= 40, `estimate readout too long: "${worstCaseEstimate}" (${worstCaseEstimate.length} chars)`);
    for (let i = 0; i < 45; i++) sandbox.page.toggleDueSelection(`row-${i}`, true);
    const countText = dueSelectedCountText();
    assert.ok(countText.length <= 40, `count readout too long: "${countText}" (${countText.length} chars)`);
  });
});

test.describe('over-ceiling refusal — refuse, never truncate (LIN-2706 §B.8)', () => {
  test('selecting past BULK_SCAN_MAX_PER_RUN shows the refusal, interpolating the REAL constant', async () => {
    const sandbox = await makeSandbox();
    const { paintDuePage, setAllDueSelected, BULK_SCAN_MAX_PER_RUN, dueBulkScanRefusalMessage } = sandbox.page;
    const items = Array.from({ length: BULK_SCAN_MAX_PER_RUN + 5 }, (_, i) => ({ issueId: `i${i}`, issueIdentifier: `LIN-${i}`, dueStatus: null }));
    paintDuePage(items, items.length, { append: false });
    setAllDueSelected(true);

    const message = dueBulkScanRefusalMessage();
    assert.ok(message, 'an over-ceiling selection must produce a refusal message');
    assert.match(message, new RegExp(String(BULK_SCAN_MAX_PER_RUN)), 'the message must interpolate the REAL constant, never a hard-coded 40');

    const refusalEl = sandbox.node('obs-due-bulk-refusal');
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
  test('a refusal enqueues nothing and leaves the selection COMPLETELY intact — no truncation', async () => {
    const sandbox = await makeSandbox();
    const { paintDuePage, setAllDueSelected, dueSelectedIds, BULK_SCAN_MAX_PER_RUN } = sandbox.page;
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

  test('the refusal clears on the next selection change once back within the ceiling', async () => {
    const sandbox = await makeSandbox();
    const { paintDuePage, setAllDueSelected, toggleDueSelection, dueBulkScanRefusalMessage, BULK_SCAN_MAX_PER_RUN } = sandbox.page;
    const items = Array.from({ length: BULK_SCAN_MAX_PER_RUN + 1 }, (_, i) => ({ issueId: `i${i}`, issueIdentifier: `LIN-${i}`, dueStatus: null }));
    paintDuePage(items, items.length, { append: false });
    setAllDueSelected(true);
    assert.ok(dueBulkScanRefusalMessage(), 'sanity: over the ceiling by 1');
    assert.equal(sandbox.node('obs-due-bulk-refusal').hidden, false, 'sanity: the refusal is drawn over the ceiling');

    toggleDueSelection('i0', false);
    assert.equal(dueBulkScanRefusalMessage(), null, 'dropping back to exactly the ceiling must clear the refusal');
    // The drawn element, not only the message: a refusal that stays on screen after the message clears is the defect.
    assert.equal(sandbox.node('obs-due-bulk-refusal').hidden, true, 'the drawn refusal must hide, not stay on screen');
  });

  test('a within-ceiling selection never shows a refusal', async () => {
    const sandbox = await makeSandbox();
    const { paintDuePage, setAllDueSelected, dueBulkScanRefusalMessage } = sandbox.page;
    paintDuePage([{ issueId: 'a', issueIdentifier: 'LIN-1', dueStatus: true }, { issueId: 'b', issueIdentifier: 'LIN-2', dueStatus: false }], 2, { append: false });
    setAllDueSelected(true);
    assert.equal(dueBulkScanRefusalMessage(), null);
  });
});

// ─── LIN-2701 §B.7 — the run controls, wired (Session 2, beat 3) ───────────
//
// These two witnesses need BOTH the real due-tab render (real row paint, real
// run controls) AND a controllable/deferred postScan stub — exactly what
// tests/unit/observation-bulk-scan.test.js's sandbox structurally cannot
// offer (it stubs window.ScanSection and never renders real due rows), and
// what this file already has everything else for. Building it here, not a
// third file, keeps the DOM/fetch-free harness in one place per surface.

test.describe('"Scan selected (N)" / Stop — button enablement (Witness 6, moved from §B.3 per N3)', () => {
  test('enabled state tracks (selection non-empty) AND (no live run), across all four combinations', async () => {
    const gates = [];
    const postScan = async () => new Promise((_resolve, reject) => { gates.push(reject); });
    const sandbox = await makeSandbox({ postScanImpl: postScan });
    const { paintDuePage, setAllDueSelected, toggleDueSelection, startDueBulkScan, stopBulkScan } = sandbox.page;
    const scanBtn = sandbox.node('obs-due-scan-selected');
    const stopBtn = sandbox.node('obs-due-stop');

    paintDuePage([
      { issueId: 'a', issueIdentifier: 'LIN-1', dueStatus: true },
      { issueId: 'b', issueIdentifier: 'LIN-2', dueStatus: true }
    ], 2, { append: false });

    // Cell 1: nothing selected, no run — disabled, Stop hidden.
    assert.equal(scanBtn.disabled, true, 'empty selection + no run must disable the button');
    assert.equal(scanBtn.textContent, 'Scan selected (0)');
    assert.equal(stopBtn.hidden, true);

    // Cell 2: selection non-empty, no run — enabled.
    setAllDueSelected(true);
    assert.equal(scanBtn.disabled, false, 'non-empty selection + no run must enable the button');
    assert.equal(scanBtn.textContent, 'Scan selected (2)');
    assert.equal(stopBtn.hidden, true);

    // Cell 4: selection non-empty, run live — disabled again, Stop visible.
    startDueBulkScan();
    await flush();
    assert.equal(gates.length, 2, 'both rows must actually be in flight');
    assert.equal(scanBtn.disabled, true, 'a live run must disable the button even though the selection is still non-empty');
    assert.equal(stopBtn.hidden, false, 'Stop must be visible while a run is live');

    // Cell 3: selection cleared WHILE the run is still live — still disabled
    // (a live run alone is sufficient; the formula is OR, not merely AND).
    toggleDueSelection('a', false);
    toggleDueSelection('b', false);
    assert.equal(scanBtn.disabled, true, 'a live run must keep the button disabled even with an empty selection');
    assert.equal(stopBtn.hidden, false);

    // Tear down, then restore the selection — back to cell 2 (enabled).
    for (const reject of gates) reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    stopBulkScan();
    await flush();
    assert.equal(stopBtn.hidden, true, 'Stop must hide again once the run tears down');
    assert.equal(scanBtn.disabled, true, 'the selection is still empty (cell 1) immediately after teardown — teardown does not restore it');
    setAllDueSelected(true);
    assert.equal(scanBtn.disabled, false, 'reselecting after teardown must re-enable the button (cell 2)');
  });
});

test.describe('startBulkScan — cancellation / late settlement (Witness 10, LIN-2701 §B.12 item 10 — mandatory)', () => {
  test('a stop with rows in flight, driven through the REAL startDueBulkScan (no hand-passed callbacks): settled entries classify cancelled, repaint the row exactly once, and never flip the run control back to running — with the selection left intact', async () => {
    const gates = [];
    const postScan = async () => new Promise((_resolve, reject) => { gates.push(reject); });
    let createElementCalls = 0;
    const sandbox = await makeSandbox({ postScanImpl: postScan });
    const realCreateElement = sandbox.document.createElement;
    sandbox.document.createElement = (...args) => { createElementCalls++; return realCreateElement.apply(sandbox.document, args); };

    const {
      paintDuePage, setAllDueSelected, startDueBulkScan, stopBulkScan, paintBulkScanRowResult
    } = sandbox.page;

    paintDuePage([
      { issueId: 'a', issueIdentifier: 'LIN-1', dueStatus: true },
      { issueId: 'b', issueIdentifier: 'LIN-2', dueStatus: true }
    ], 2, { append: false });

    const scanBtn = sandbox.node('obs-due-scan-selected');
    const stopBtn = sandbox.node('obs-due-stop');

    // Select both rows, then drive the run through the REAL entry point —
    // no hand-passed onResult/onTeardown, no mirrored syncDueBulkBar call.
    // This is the exact gap the previous version of this witness left open
    // (flagged in review): it must exercise startDueBulkScan's OWN wiring,
    // so a future drift in its callbacks can fail THIS test, not just a
    // hand-rolled mirror of it.
    setAllDueSelected(true);
    startDueBulkScan();
    await flush();
    assert.equal(gates.length, 2, 'both rows must be in flight before stop');
    assert.equal(stopBtn.hidden, false, 'Stop must be visible while the run is live');
    assert.equal(scanBtn.disabled, true, 'a live run must disable the button even with a non-empty selection');

    stopBulkScan();

    // Teardown is synchronous inside stopBulkScan() — the control must
    // already read "torn down" before any straggler has settled, exactly as
    // startBulkScan's own doc comment describes the ordering. Non-vacuous:
    // the selection is genuinely non-empty here (2 rows), so a real
    // re-enable is being asserted, not a button that was disabled anyway.
    assert.equal(stopBtn.hidden, true, 'teardown must hide Stop immediately — it does not wait for stragglers');
    assert.equal(scanBtn.disabled, false, 'teardown must re-enable the button — the 2-row selection is still intact, never auto-cleared by teardown');
    assert.equal(scanBtn.textContent, 'Scan selected (2)', 'teardown must leave the selection itself untouched');

    // Now let the already-issued (now-aborted) calls actually settle — the
    // late arrival: onResult fires AFTER onTeardown, by construction (stop()
    // tears down synchronously; the already-issued runOne()s only reject a
    // microtask later).
    for (const reject of gates) reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    await flush();

    // (i) each aborted row classifies as cancelled — observed via the REAL
    // classify->paint pipeline startDueBulkScan wires up internally (never a
    // hand-passed onResult): 'cancelled' is BULK_SCAN_RESULT_COPY's text for
    // that ONE bucket, so seeing it painted is direct evidence of the real
    // classification, not an assumption about it.
    const list = sandbox.node('obs-due-list');
    const rowA = list.children.find((r) => r.dataset.issueId === 'a');
    const rowB = list.children.find((r) => r.dataset.issueId === 'b');
    assert.ok(rowA && rowB, 'both rows must still be in the DOM');
    const badgeA = rowA.querySelector('.obs-bulk-scan-result');
    const badgeB = rowB.querySelector('.obs-bulk-scan-result');
    assert.ok(badgeA && badgeB, 'the late onResult must still paint both rows — presentation-only, the run itself is unaffected');
    assert.equal(badgeA.textContent, 'cancelled');
    assert.equal(badgeB.textContent, 'cancelled');
    assert.equal(createElementCalls, 2, 'exactly one badge element created per row (2 rows total), never per-arrival');

    // (ii) re-delivering the SAME kind of settled entry to the real,
    // directly-exported paintBulkScanRowResult paints the row exactly once,
    // not twice — idempotent, keyed by issueId. Constructed to match exactly
    // what the real pool hands onResult for an aborted row (LIN-2700's
    // classifyBulkScanError: AbortError, no .status).
    paintBulkScanRowResult({ item: { identifier: 'a' }, outcome: 'aborted', error: Object.assign(new Error('aborted'), { name: 'AbortError' }) });
    assert.equal(createElementCalls, 2, 'repainting the SAME issueId must reuse the existing badge, never create a second one');
    assert.equal(rowA.querySelector('.obs-bulk-scan-result'), badgeA, 'it must be the exact same badge object, not a new one appended alongside it');

    // (iii) — the real teeth: these late onResults must NEVER have flipped
    // the run control back to "running", and the selection must still read
    // intact — non-vacuous because the selection is genuinely non-empty.
    assert.equal(stopBtn.hidden, true, 'a late onResult must never revive the Stop control');
    assert.equal(scanBtn.disabled, false, 'a late onResult must never re-disable the Scan-selected control');
    assert.equal(scanBtn.textContent, 'Scan selected (2)', 'a late onResult must never touch the selection either');
  });
});
