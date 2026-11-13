/**
 * LIN-2241 tier 1 — the client-side basis check on a ruling card.
 *
 * The re-review found this whole half shipping unpinned: nothing referenced
 * `requestBasisCheck`, the concurrency gate, or the `=== true` render. The
 * guards here are the ones most likely to regress silently, because breaking
 * them produces no visible error — just a card that stops flagging, or a poll
 * loop quietly spending the operator's rate limit on their own workspace.
 *
 * `public/observation.js` is a native ES module (LIN-4463 piece 4) with DOM/fetch
 * dependencies at call time but none at LOAD time (its addEventListener calls only
 * run inside `init()`, which this file never calls). It is imported fresh through
 * `importWorld` (tests/unit/helpers/import-world.js) over the shared fake DOM
 * (tests/unit/helpers/fake-dom.js); the DOM it draws into is the world's document.
 *
 * Run with: node --test tests/unit/observation-basis-check.test.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { importWorld } from './helpers/import-world.js';

/**
 * observation.js imported into a world, with the stubs the basis check reaches:
 * `window.api` (the route under test), and the `escapeHtml` and `relativeTime`
 * globals the page gets from common.js. `console` is silent. The caller restores
 * the world (`t.after(() => world.restore())`).
 */
async function makeSandbox({ api } = {}) {
  const world = await importWorld({
    window: {
      addEventListener() {},
      matchMedia: () => ({ matches: false }),
      ChatUI: { appendOptions() {} },
      // LIN-3126 residual: common.js's shared source-query builder. On every
      // real page common.js is loaded before observation.js; this DOM-free
      // harness loads observation.js alone, so the shared builder is stubbed
      // here (the real one is exercised by lin-3126-residual-forwarding.test.js).
      sourceQuery(source) {
        return source ? `?source=${encodeURIComponent(source)}` : '';
      },
      api: api || (async () => { throw new Error('no api stub'); })
    },
    globals: {
      escapeHtml: (str) => (str === undefined || str === null ? '' : String(str)),
      relativeTime: (ts) => (ts ? `rel(${ts})` : ''),
      console: { warn() {}, error() {}, log() {} }
    }
  });
  const page = await world.importPage('observation.js');
  return { world, page };
}

/** The seam requires the Rulings tab to be the active view (`currentView`, a module `let`, set through `switchView`). */
function onRulingsTab(page) {
  page.switchView('rulings');
}

function anchorFor(n) {
  return {
    loopId: null,
    taskDecisionId: `scan_row_${n}`,
    issueId: `11111111-2222-3333-4444-00000000000${n}`,
    workspaceUrlKey: 'acme'
  };
}

const flush = async (times = 8) => {
  for (let i = 0; i < times; i++) await new Promise(r => setImmediate(r));
};

test.describe('requestBasisCheck — request-volume guards', () => {
  test('a row is checked at most ONCE, however many times the feed repaints', async (t) => {
    // The rulings feed repaints wholesale on every poll, so without the
    // one-attempt guard each repaint would enqueue another job per row and the
    // queue would outgrow the concurrency gate — an advisory hint turning into
    // a self-inflicted request flood.
    let calls = 0;
    const { world, page } = await makeSandbox({ api: async () => { calls++; return { basisChanged: false }; } });
    t.after(() => world.restore());
    onRulingsTab(page);
    const { requestBasisCheck } = page;

    const note = world.document.createElement('p');
    for (let repaint = 0; repaint < 25; repaint++) requestBasisCheck(anchorFor(1), note);
    await flush();

    assert.equal(calls, 1, `expected exactly 1 request across 25 repaints, got ${calls}`);
  });

  test('a failed check is not retried on the next repaint', async (t) => {
    // A hint that silently gives up is strictly better than one that hammers.
    let calls = 0;
    const { world, page } = await makeSandbox({ api: async () => { calls++; throw new Error('503'); } });
    t.after(() => world.restore());
    onRulingsTab(page);
    const { requestBasisCheck } = page;

    const note = world.document.createElement('p');
    for (let repaint = 0; repaint < 20; repaint++) {
      requestBasisCheck(anchorFor(2), note);
      await flush(2);
    }
    assert.equal(calls, 1, `a failing route must not produce a retry storm, got ${calls} requests`);
  });

  test('the per-page ceiling caps TOTAL checks, not just parallelism', async (t) => {
    // BASIS_CHECK_CONCURRENCY bounds how many run at once; it does not bound
    // how many run. The unanswered set is the population that provably
    // accumulates, so the total needs its own ceiling.
    let calls = 0;
    const { world, page } = await makeSandbox({ api: async () => { calls++; return { basisChanged: false }; } });
    t.after(() => world.restore());
    onRulingsTab(page);
    const { requestBasisCheck, BASIS_CHECK_MAX_PER_PAGE } = page;

    for (let i = 0; i < BASIS_CHECK_MAX_PER_PAGE + 25; i++) {
      requestBasisCheck(anchorFor(`x${i}`), world.document.createElement('p'));
    }
    await flush(40);

    assert.equal(calls, BASIS_CHECK_MAX_PER_PAGE, `expected the ceiling to hold at ${BASIS_CHECK_MAX_PER_PAGE}, got ${calls}`);
  });

  test('no check is issued unless the Rulings tab is the active view', async (t) => {
    let calls = 0;
    const { world, page } = await makeSandbox({ api: async () => { calls++; return { basisChanged: true }; } });
    t.after(() => world.restore());
    // deliberately NOT onRulingsTab()
    const { requestBasisCheck } = page;
    requestBasisCheck(anchorFor(3), world.document.createElement('p'));
    await flush();
    assert.equal(calls, 0);
  });

  test('a cached verdict is reused without a second request', async (t) => {
    let calls = 0;
    const { world, page } = await makeSandbox({ api: async () => { calls++; return { basisChanged: true }; } });
    t.after(() => world.restore());
    onRulingsTab(page);
    const { requestBasisCheck } = page;

    const first = world.document.createElement('p');
    requestBasisCheck(anchorFor(4), first);
    await flush();
    assert.equal(calls, 1);

    // A repaint hands the same row a NEW note element; the cached verdict must
    // still paint it, without going back to the network.
    const second = world.document.createElement('p');
    second.hidden = true;
    requestBasisCheck(anchorFor(4), second);
    assert.equal(calls, 1);
    assert.equal(second.hidden, false, 'the cached `true` verdict repaints the fresh node');
  });
});

test.describe('applyBasisResult — the tri-state reaches the card correctly', () => {
  test('only `true` reveals the note; `false` and `null` both stay hidden', async (t) => {
    // `false` and `null` are different facts but the same rendering: the note
    // is an additive nudge, never a "we verified this is current" badge, so its
    // absence must claim nothing either way.
    const { world, page } = await makeSandbox();
    t.after(() => world.restore());
    const { applyBasisResult } = page;
    for (const [verdict, expectedHidden] of [[true, false], [false, true], [null, true], [undefined, true]]) {
      const note = world.document.createElement('p');
      applyBasisResult(note, verdict);
      assert.equal(note.hidden, expectedHidden, `verdict ${String(verdict)} should render hidden=${expectedHidden}`);
    }
  });

  test('a non-boolean response body is treated as unknown, never as a change', async (t) => {
    // The route can only answer `true`/`false`/`null`; anything else means the
    // response was not what we think it was, which is not evidence of a change.
    const { world, page } = await makeSandbox({ api: async () => ({ basisChanged: 'yes' }) });
    t.after(() => world.restore());
    onRulingsTab(page);
    const { requestBasisCheck, basisCheckCache } = page;
    const note = world.document.createElement('p');
    requestBasisCheck(anchorFor(5), note);
    await flush();
    assert.equal(note.hidden, true);
    assert.equal(basisCheckCache.get('scan_row_5'), null);
  });

  test('applyBasisResult tolerates a missing node', async (t) => {
    const { world, page } = await makeSandbox();
    t.after(() => world.restore());
    const { applyBasisResult } = page;
    assert.doesNotThrow(() => applyBasisResult(null, true));
  });
});

test.describe('the check targets the RULING\'s own workspace', () => {
  test('the request URL uses anchor.workspaceUrlKey and anchor.issueId', async (t) => {
    // The rulings feed is cross-workspace, so the page being viewed from is not
    // necessarily the ruling's own workspace — the same reason dismiss and
    // reply target the anchor rather than the page.
    let url = null;
    const { world, page } = await makeSandbox({ api: async (u) => { url = u; return { basisChanged: false }; } });
    t.after(() => world.restore());
    onRulingsTab(page);
    const { requestBasisCheck } = page;

    requestBasisCheck({
      loopId: null,
      taskDecisionId: 'scan_row_ws',
      issueId: 'abc-123',
      workspaceUrlKey: 'the-rulings-own-workspace'
    }, world.document.createElement('p'));
    await flush();

    assert.match(url, /^\/workspace\/the-rulings-own-workspace\/api\/scan\/abc-123$/);
  });
});
