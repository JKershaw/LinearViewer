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
 * Same technique as tests/unit/dispatch-feedback-entries.test.js: the source slice of the two
 * functions is run in a vm sandbox with stubs for their free variables, and the real rendered
 * HTML is asserted.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DISPATCH_JS_SRC = readFileSync(join(__dirname, '../../public/dispatch.js'), 'utf8');

// From `function historyOutcomePill` up to the doc comment of `initDispatchHistory` (the next
// top-level declaration after the two functions under test).
function extractSrc() {
  const start = DISPATCH_JS_SRC.indexOf('function historyOutcomePill');
  assert.notEqual(start, -1, 'historyOutcomePill found in public/dispatch.js');
  const end = DISPATCH_JS_SRC.indexOf('\n/**\n * Initialize dispatch history', start);
  assert.notEqual(end, -1, 'the end of renderDispatchHistoryList marks the end of the slice');
  return DISPATCH_JS_SRC.slice(start, end);
}

function makeSandbox() {
  const sandbox = {
    escapeHtml: (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    formatDispatchTime: () => 'just now',
    formatPromptHtml: (s) => String(s),
    renderFeedbackEntries: () => '',
    window: { taskPageHref: () => null },
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(extractSrc(), sandbox, { filename: 'dispatch.js-history-outcome-slice' });
  return sandbox;
}

// Render a page of history items through the real renderer; returns the container's HTML.
function renderPage(items, { total = items.length, offset = 0 } = {}) {
  const sandbox = makeSandbox();
  const container = { innerHTML: '', querySelector: () => null, insertAdjacentHTML() {}, appendChild() {} };
  sandbox.renderDispatchHistoryList(container, items, total, offset, 'acme');
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
  test('done is the one green success state, with the check glyph', () => {
    const sandbox = makeSandbox();
    const pill = sandbox.historyOutcomePill('done');
    assert.equal(pill.state, 'done');
    assert.equal(pill.char, '✓');
  });

  test('taken (running or unresolved) is in-progress, never green', () => {
    const sandbox = makeSandbox();
    const pill = sandbox.historyOutcomePill('taken');
    assert.equal(pill.state, 'in-progress');
    assert.notEqual(pill.state, 'done');
  });

  test('failed, aborted and cancelled are the red family, never green', () => {
    const sandbox = makeSandbox();
    for (const word of ['failed', 'aborted', 'cancelled']) {
      const pill = sandbox.historyOutcomePill(word);
      assert.equal(pill.state, 'failed', `${word} is red`);
      assert.notEqual(pill.state, 'done', `${word} is never the green success state`);
    }
  });

  test('skipped, closed and blocked are non-green and distinct from one another by state or glyph', () => {
    const sandbox = makeSandbox();
    const skipped = sandbox.historyOutcomePill('skipped');
    const closed = sandbox.historyOutcomePill('closed');
    const blocked = sandbox.historyOutcomePill('blocked');
    for (const p of [skipped, closed, blocked]) assert.notEqual(p.state, 'done');
    assert.notEqual(closed.state, skipped.state);
    assert.notEqual(closed.char, skipped.char);
    assert.notEqual(blocked.char, closed.char);
  });

  test('an unknown word is neutral: no state colour and no glyph, never the expired look', () => {
    const sandbox = makeSandbox();
    const pill = sandbox.historyOutcomePill('some-future-word');
    assert.equal(pill.state, '');
    assert.equal(pill.char, '');
    assert.notEqual(pill.state, 'todo', 'not the dim expired look');
    assert.equal(sandbox.historyOutcomePill('expired').state, 'todo', 'expired keeps its own dim look');
  });

  test('a prototype member name is an unknown word, not a pill from Object.prototype', () => {
    const sandbox = makeSandbox();
    for (const word of ['constructor', '__proto__', 'toString']) {
      const pill = sandbox.historyOutcomePill(word);
      assert.equal(pill.state, '', `${word} is neutral`);
      assert.equal(pill.char, '', `${word} has no glyph`);
    }
  });
});

describe('renderDispatchHistoryList renders the outcome word (LIN-2122)', () => {
  test('a done row is the green pill and shows the word done', () => {
    const html = renderPage([itemFor('done')]);
    assert.ok(html.includes('status-pill--done'), 'green state class');
    assert.ok(html.includes('status-done'), 'status-<outcome> hook');
    assert.ok(html.includes('<span class="status-pill__label">done</span>'));
    assert.ok(html.includes('data-status="done"'));
  });

  test('a failed row is not green, and shows failed', () => {
    const html = renderPage([itemFor('failed')]);
    assert.ok(!html.includes('status-pill--done'), 'a failed run never reads as a green success');
    assert.ok(html.includes('status-pill--failed'));
    assert.ok(html.includes('<span class="status-pill__label">failed</span>'));
  });

  test('an aborted row is not green, and shows aborted', () => {
    const html = renderPage([itemFor('aborted')]);
    assert.ok(!html.includes('status-pill--done'), 'an aborted run never reads as a green success');
    assert.ok(html.includes('<span class="status-pill__label">aborted</span>'));
  });

  test('a running row (taken) is not green', () => {
    const html = renderPage([itemFor('taken')]);
    assert.ok(!html.includes('status-pill--done'));
    assert.ok(html.includes('status-pill--in-progress'));
    assert.ok(html.includes('status-taken'), 'the taken hook the e2e specs read still holds');
  });

  test('a page mixing outcomes shows green only for the done row', () => {
    const html = renderPage([itemFor('done'), itemFor('failed'), itemFor('aborted'), itemFor('taken')]);
    assert.equal((html.match(/status-pill--done/g) || []).length, 1);
  });

  test('an unknown outcome renders neutrally and shows its own word, not expired', () => {
    const html = renderPage([itemFor('some-future-word')]);
    assert.ok(html.includes('<span class="status-pill__label">some-future-word</span>'));
    assert.ok(!html.includes('expired'), 'the old expired fallback is gone');
    assert.ok(!html.includes('status-pill--done'));
    assert.ok(!html.includes('status-pill--todo'));
  });

  test('a server that predates outcome falls back to the stored status', () => {
    const html = renderPage([{ id: 'old', status: 'done', promptName: 'x', dispatchedAt: '2026-06-22T10:00:00.000Z', resolvedAt: '2026-06-22T11:00:00.000Z' }]);
    assert.ok(html.includes('status-pill--done'));
    assert.ok(html.includes('data-status="done"'));
  });

  test('an outcome word is escaped, never injected as markup', () => {
    const html = renderPage([itemFor('<img src=x onerror=alert(1)>')]);
    assert.ok(!html.includes('<img'), 'the word is escaped');
    assert.ok(html.includes('&lt;img'));
  });
});
