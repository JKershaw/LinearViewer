/**
 * LIN-2122 — the Dispatch page's history pill is chosen by the outcome word.
 *
 * Run with: node --test tests/unit/lin-2122-history-outcome-pill.test.js
 *
 * Before: `renderDispatchHistoryList` mapped the stored `status` onto a pill, and the stored
 * `taken` (every archived row) rendered as a green ✓ success. After: the pill is chosen by
 * `historyOutcomePill(outcome)`, a pure top-level function in public/dispatch.js. Only `done`
 * is green. `taken` is in-progress, failed/aborted/cancelled are red, and an unknown word is
 * neutral and shows its own word.
 *
 * public/dispatch.js is a native ES module (LIN-4560): this suite imports it over the fake DOM
 * (tests/unit/helpers/import-world.js) with stubs for the common.js globals it reads, drives its two
 * exported functions, and asserts the real rendered HTML. The container is a real element of the fake
 * document. Until LIN-4560 it ran a source slice of the classic script in loadWorld.
 */
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { importWorld } from './helpers/import-world.js';

let world = null;
afterEach(() => { if (world) world.restore(); world = null; });

// The page module over the fake DOM. The stubs are the common.js globals it reads: the escape, the relative time its
// `formatDispatchTime` words, and `taskPageHref`, the window helper. Its own formatPromptHtml and the shared transcript
// module (LIN-4560, which retired renderFeedbackEntries) are real; the items here carry no prompt or feedback, so
// neither draws anything.
async function loadPage() {
  world = importWorld({
    window: {
      escapeHtml: (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
      relativeTime: () => 'just now',
      taskPageHref: () => null,
      addEventListener() {},
    },
  });
  return world.importPage('dispatch.js');
}

function makeContainer() {
  const el = world.document.createElement('div');
  world.document.body.appendChild(el);
  return el;
}

// Render a page of history items through the real renderer; returns the container's HTML.
async function renderPage(items, { total = items.length, offset = 0 } = {}) {
  const page = await loadPage();
  const container = makeContainer();
  page.renderDispatchHistoryList(container, items, total, offset, 'acme');
  return container.innerHTML;
}

const itemFor = (outcome, extra = {}) => ({
  id: `id-${outcome}`,
  status: 'taken',
  outcome,
  promptName: 'implementation',
  issueIdentifier: 'LIN-2122',
  dispatchedAt: '2026-06-22T10:00:00.000Z',
  resolvedAt: '2026-06-22T11:00:00.000Z',
  ...extra,
});

describe('historyOutcomePill (LIN-2122)', () => {
  test('done is the one green success state, with the check glyph', async () => {
    const sandbox = await loadPage();
    const pill = sandbox.historyOutcomePill('done');
    assert.equal(pill.state, 'done');
    assert.equal(pill.char, '✓');
  });

  test('taken (running or unresolved) is in-progress, never green', async () => {
    const sandbox = await loadPage();
    const pill = sandbox.historyOutcomePill('taken');
    assert.equal(pill.state, 'in-progress');
    assert.notEqual(pill.state, 'done');
  });

  test('failed, aborted and cancelled are the red family, never green', async () => {
    const sandbox = await loadPage();
    for (const word of ['failed', 'aborted', 'cancelled']) {
      const pill = sandbox.historyOutcomePill(word);
      assert.equal(pill.state, 'failed', `${word} is red`);
      assert.notEqual(pill.state, 'done', `${word} is never the green success state`);
    }
  });

  test('skipped, closed and blocked are non-green and distinct from one another by state or glyph', async () => {
    const sandbox = await loadPage();
    const skipped = sandbox.historyOutcomePill('skipped');
    const closed = sandbox.historyOutcomePill('closed');
    const blocked = sandbox.historyOutcomePill('blocked');
    for (const p of [skipped, closed, blocked]) assert.notEqual(p.state, 'done');
    assert.notEqual(closed.state, skipped.state);
    assert.notEqual(closed.char, skipped.char);
    assert.notEqual(blocked.char, closed.char);
  });

  test('an unknown word is neutral: no state colour and no glyph, never the expired look', async () => {
    const sandbox = await loadPage();
    const pill = sandbox.historyOutcomePill('some-future-word');
    assert.equal(pill.state, '');
    assert.equal(pill.char, '');
    assert.notEqual(pill.state, 'todo', 'not the dim expired look');
    assert.equal(sandbox.historyOutcomePill('expired').state, 'todo', 'expired keeps its own dim look');
  });

  test('a prototype member name is an unknown word, not a pill from Object.prototype', async () => {
    const sandbox = await loadPage();
    for (const word of ['constructor', '__proto__', 'toString']) {
      const pill = sandbox.historyOutcomePill(word);
      assert.equal(pill.state, '', `${word} is neutral`);
      assert.equal(pill.char, '', `${word} has no glyph`);
    }
  });
});

describe('renderDispatchHistoryList renders the outcome word (LIN-2122)', () => {
  test('a done row is the green pill and shows the word done', async () => {
    const html = await renderPage([itemFor('done')]);
    assert.ok(html.includes('status-pill--done'), 'green state class');
    assert.ok(html.includes('status-done'), 'status-<outcome> hook');
    assert.ok(html.includes('<span class="status-pill__label">done</span>'));
    assert.ok(html.includes('data-status="done"'));
  });

  test('a failed row is not green, and shows failed', async () => {
    const html = await renderPage([itemFor('failed')]);
    assert.ok(!html.includes('status-pill--done'), 'a failed run never reads as a green success');
    assert.ok(html.includes('status-pill--failed'));
    assert.ok(html.includes('<span class="status-pill__label">failed</span>'));
  });

  test('an aborted row is not green, and shows aborted', async () => {
    const html = await renderPage([itemFor('aborted')]);
    assert.ok(!html.includes('status-pill--done'), 'an aborted run never reads as a green success');
    assert.ok(html.includes('<span class="status-pill__label">aborted</span>'));
  });

  test('a running row (taken) is not green', async () => {
    const html = await renderPage([itemFor('taken')]);
    assert.ok(!html.includes('status-pill--done'));
    assert.ok(html.includes('status-pill--in-progress'));
    assert.ok(html.includes('status-taken'), 'the taken hook the e2e specs read still holds');
  });

  test('a page mixing outcomes shows green only for the done row', async () => {
    const html = await renderPage([itemFor('done'), itemFor('failed'), itemFor('aborted'), itemFor('taken')]);
    assert.equal((html.match(/status-pill--done/g) || []).length, 1);
  });

  test('an unknown outcome renders neutrally and shows its own word, not expired', async () => {
    const html = await renderPage([itemFor('some-future-word')]);
    assert.ok(html.includes('<span class="status-pill__label">some-future-word</span>'));
    assert.ok(!html.includes('expired'), 'the old expired fallback is gone');
    assert.ok(!html.includes('status-pill--done'));
    assert.ok(!html.includes('status-pill--todo'));
  });

  test('a server that predates outcome falls back to the stored status', async () => {
    const html = await renderPage([{ id: 'old', status: 'done', promptName: 'x', dispatchedAt: '2026-06-22T10:00:00.000Z', resolvedAt: '2026-06-22T11:00:00.000Z' }]);
    assert.ok(html.includes('status-pill--done'));
    assert.ok(html.includes('data-status="done"'));
  });

  // The word lands as text in the label, as a class fragment and as data-status, all escaped. It leads with a `"` so an
  // unescaped attribute site breaks out and creates the <img>; without a quote, only the label site could show it. Read off the live tree (LIN-4310): a
  // browser's serializer leaves `<` bare inside an attribute value, so the markup string cannot show "escaped" the way
  // the old plain-string container did. No element is created, and the label reads back the word exactly.
  test('an outcome word is escaped, never injected as markup', async () => {
    const word = '"><img src=x onerror=alert(1)>';
    const page = await loadPage();
    const container = makeContainer();
    page.renderDispatchHistoryList(container, [itemFor(word)], 1, 0, 'acme');
    assert.equal(container.querySelector('img'), null, 'the word is text, not an element');
    assert.equal(container.querySelector('.status-pill__label').textContent, word);
  });
});
