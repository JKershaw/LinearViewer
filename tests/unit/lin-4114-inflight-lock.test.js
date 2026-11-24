/**
 * LIN-4114 (verdict F2): the card-wide in-flight lock, and "stays off after success".
 *
 * The E2E witness (W3) cannot see either: a delivered answer removes the card from Home, so there is nothing left to press.
 * This witness runs the real client (public/common.js and public/question-cards.js in a vm sandbox) over the pinned reply
 * card and its Answer button (LIN-4541: the decision card's option buttons and its fresh-run effect went with the ruling
 * machinery; a question is answered on its question record's card). The comment write is held open by a gate, so the test can press again while the
 * answer is in flight, the way a person would. A press on a disabled button does nothing, as in a browser, so `press()`
 * respects `disabled`. Each assertion is a mutation witness: removing `setControls(true)` makes the second press send a
 * second comment; restoring the controls after success makes the post-success assertion fail.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { withHarnessModels } from '../fixtures/harness-models.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../..');
const COMMON_JS_SRC = readFileSync(join(REPO, 'public/common.js'), 'utf8');
const QUESTION_CARDS_JS_SRC = readFileSync(join(REPO, 'public/question-cards.js'), 'utf8');

const el = (over = {}) => Object.assign({
  dataset: {}, textContent: '', value: '', disabled: false, isConnected: true, className: '', listeners: {},
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
  click() { (this.listeners.click || []).forEach((fn) => fn({ preventDefault() {} })); },
  querySelector() { return null; },
  querySelectorAll() { return []; },
}, over);

/** A browser does not dispatch a click to a disabled button. */
const press = (button) => { if (!button.disabled) button.click(); };

/** A pinned reply card: the Answer button and its box, for a run parked on a bare [blocked]. */
function makeLiveCard() {
  const answer = el({ textContent: 'Answer' });
  const textarea = el({ value: 'my own words' });
  const feedback = el();
  const card = {
    dataset: { urlKey: 'ws-1', loopId: 'lp-1', target: 'cli', issueIdentifier: 'LOCAL-S', issueId: 'iss-1', sessionWaiting: 'true' },
    parentNode: { removeChild(c) { c.parentNode = null; } },
    get isConnected() { return this.parentNode !== null; },
    dispatchEvent() { return true; },
    querySelector(sel) {
      switch (sel) {
        case '[data-testid="session-question-card-answer"]': return answer;
        case '[data-testid="session-question-card-input"]': return textarea;
        case '.sess-qcard-feedback': return feedback;
        default: return null;
      }
    },
    querySelectorAll() { return []; },
  };
  return { card, answer, textarea, feedback };
}

async function flush() { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); }

/**
 * The sandbox. `fetch` holds the comment write on `gate` until the test releases it, and answers every other call at once.
 * The comment's outcome is the test's choice (`commentResult`), so the same harness proves success and failure.
 */
function makeSandbox(cards) {
  const calls = { comments: 0, other: 0 };
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const sandbox = {
    module: { exports: {} },
    window: {
      _listeners: {},
      addEventListener() {},
      matchMedia: () => ({ matches: false }),
      ChatUI: { appendMessage() {} },
    },
    document: {
      addEventListener() {},
      querySelectorAll(sel) { return sel.includes('session-question-card') ? cards : []; },
      createElement() { return el(); },
    },
    CustomEvent: class { constructor(type, init) { this.type = type; this.bubbles = !!init.bubbles; this.detail = init.detail; } },
    localStorage: { getItem: () => null, setItem() {} },
    fetch: null,
    setTimeout() {},
    console,
  };
  const respond = (r) => ({ ok: r.ok, status: r.status, json: () => Promise.resolve(r.data || {}) });
  sandbox.fetch = (url) => {
    if (/\/api\/comments\//.test(url)) {
      calls.comments++;
      return gate.then(() => respond(sandbox.commentResult));
    }
    calls.other++;
    return Promise.resolve(respond({ ok: true, status: 200, data: { success: true } }));
  };
  sandbox.commentResult = { ok: true, status: 200, data: { success: true, comment: { id: 'c-1' } } };
  vm.createContext(sandbox);
  vm.runInContext(withHarnessModels(COMMON_JS_SRC), sandbox, { filename: 'common.js' });
  vm.runInContext(QUESTION_CARDS_JS_SRC, sandbox, { filename: 'question-cards.js' });
  return { sandbox, calls, release };
}

/** Every control on the card: the Answer button. */
const controlsOf = (f) => [f.answer];

test('in flight: while one answer is being written, the card cannot start a second one (a double press)', async () => {
  const f = makeLiveCard();
  const { sandbox, calls, release } = makeSandbox([f.card]);
  sandbox.module.exports.initQuestionCards();

  press(f.answer);
  await flush();
  assert.equal(calls.comments, 1, 'the first press starts one comment write');
  for (const b of controlsOf(f)) assert.equal(b.disabled, true, `control "${b.textContent}" is disabled while in flight`);

  press(f.answer); // a double press
  press(f.answer); // and a third
  await flush();
  assert.equal(calls.comments, 1, 'no second comment write while the first is in flight');

  release();
  await flush();
  assert.equal(calls.comments, 1, 'one comment for the whole sequence of presses');
});

test('after success: the card\'s buttons stay off, and no timer brings them back (the card goes on Home; elsewhere it must not answer again)', async () => {
  const f = makeLiveCard();
  const { sandbox, calls, release } = makeSandbox([f.card]);
  sandbox.module.exports.initQuestionCards();

  press(f.answer);
  await flush();
  release();
  await flush();
  assert.equal(calls.comments, 1, 'the answer was delivered once');
  assert.equal(f.feedback.textContent !== '', true, 'the card reports the outcome');
  for (const b of controlsOf(f)) assert.equal(b.disabled, true, `control "${b.textContent}" stays disabled after success`);

  press(f.answer);
  await flush();
  assert.equal(calls.comments, 1, 'a settled answer is not sent again from the same card');
});

test('after failure: the controls come back, so the person can answer again', async () => {
  const f = makeLiveCard();
  const { sandbox, calls, release } = makeSandbox([f.card]);
  sandbox.commentResult = { ok: false, status: 500, data: { error: 'boom' } };
  sandbox.module.exports.initQuestionCards();

  press(f.answer);
  await flush();
  release();
  await flush();
  assert.equal(calls.comments, 1);
  for (const b of controlsOf(f)) assert.equal(b.disabled, false, `control "${b.textContent}" works again after a failure`);

  sandbox.commentResult = { ok: true, status: 200, data: { success: true, comment: { id: 'c-2' } } };
  press(f.answer);
  await flush();
  assert.equal(calls.comments, 2, 'the retry is a second comment, because the first one failed');
});

/**
 * LIN-4242: the card marks itself `answerInFlight` while its answer is out, so the live Waiting section keeps it (a merge
 * never removes an answer still in flight, and a repaint keeps a card that holds the reader's place). The mark is set and
 * cleared in this harness, where a real answer's outcome is known.
 */
test('LIN-4242: the card is marked answerInFlight while its write is out, and the mark clears when the answer is delivered', async () => {
  // Witness: remove the `answerInFlight = \'true\'` line in sendReply → the first assertion fails.
  const f = makeLiveCard();
  const { sandbox, release } = makeSandbox([f.card]);
  sandbox.module.exports.initQuestionCards();
  press(f.answer);
  await flush();
  assert.equal(f.card.dataset.answerInFlight, 'true', 'marked while the write is out');
  release();
  await flush();
  assert.equal(f.card.dataset.answerInFlight, undefined, 'cleared once delivered');
});

test('LIN-4242: a failed answer clears the mark, so the card is not held after its controls come back', async () => {
  const f = makeLiveCard();
  const { sandbox, release } = makeSandbox([f.card]);
  sandbox.commentResult = { ok: false, status: 500, data: { error: 'boom' } };
  sandbox.module.exports.initQuestionCards();
  press(f.answer);
  await flush();
  release();
  await flush();
  assert.equal(f.card.dataset.answerInFlight, undefined, 'a failure settles the answer');
});

test('LIN-4242: a partial failure (the answer recorded, the run refused) keeps the mark, so the card stays in flight for its Retry', async () => {
  // Witness: drop the `if (outcome !== \'partial\')` guard → the mark clears on the partial outcome and this fails.
  const f = makeLiveCard();
  const { sandbox, release } = makeSandbox([f.card]);
  const comments = sandbox.fetch;
  sandbox.fetch = (url, opts) => (/\/api\/comments\//.test(url)
    ? comments(url, opts)
    : Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({ error: 'queue busy' }) }));
  sandbox.module.exports.initQuestionCards();
  press(f.answer);
  await flush();
  release();
  await flush();
  assert.equal(f.card.dataset.answerInFlight, 'true', 'the partial card stays in flight');
});
