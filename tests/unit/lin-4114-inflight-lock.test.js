/**
 * LIN-4114 (verdict F2): the card-wide in-flight lock, and "stays off after success".
 *
 * The E2E witness (W3) cannot see either: a delivered answer removes the card from Home, so there is nothing left to press.
 * This witness runs the real client (public/common.js and public/question-cards.js in a vm sandbox) over a card with three
 * option buttons and an Answer button. The comment write is held open by a gate, so the test can press again while the
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

const OPTIONS = [
  { id: 'a', label: 'Split the change' },
  { id: 'b', label: 'Keep it whole' },
  { id: 'c', label: 'Ask me again' },
];

/** A pinned loop-backed card: a recommended (primary) option button, two secondary ones, the Answer button and its box. */
function makeLiveCard() {
  const answer = el({ textContent: 'Answer' });
  const textarea = el({ value: 'my own words' });
  const feedback = el();
  const optionBtns = OPTIONS.map((o, i) => el({
    textContent: o.label,
    className: i === 0 ? 'btn btn--primary' : 'btn',
    dataset: { optionId: o.id, recommended: i === 0 ? 'true' : 'false' },
  }));
  const card = {
    dataset: {
      urlKey: 'ws-1', loopId: 'lp-1', target: 'cli', effect: 'resume', disposition: 'resumable',
      issueIdentifier: 'LOCAL-S', issueId: 'iss-1', stampLoopId: 'lp-1', decisionId: 'd-opts',
    },
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
    querySelectorAll(sel) { return sel === '[data-testid="session-question-card-option"]' ? optionBtns : []; },
  };
  return { card, answer, textarea, feedback, optionBtns };
}

async function flush() { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); }

/**
 * The sandbox. `fetch` holds the comment write on `gate` until the test releases it, and answers every other call at once.
 * The comment's outcome is the test's choice (`commentResult`), so the same harness proves success and failure.
 */
function makeSandbox(cards) {
  const calls = { comments: 0, other: 0, runs: [], hydrates: 0 };
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
  // The hydrate read (press-time anchor check) answers like a live, open task; a fresh run is recorded, not started.
  sandbox.window.api = async () => { calls.hydrates++; return { hydrated: true, state: { type: 'started' } }; };
  sandbox.window.dispatchPrompt = async (req) => { calls.runs.push(req); return { id: 'run-1' }; };
  vm.runInContext(QUESTION_CARDS_JS_SRC, sandbox, { filename: 'question-cards.js' });
  return { sandbox, calls, release };
}

/** Every control on the card: the Answer button, the option buttons. */
const controlsOf = (f) => [f.answer, ...f.optionBtns];

test('in flight: while one answer is being written, no button on the card can start a second one (a double press and another option)', async () => {
  const f = makeLiveCard();
  const { sandbox, calls, release } = makeSandbox([f.card]);
  sandbox.module.exports.initQuestionCards();

  press(f.optionBtns[0]);
  await flush();
  assert.equal(calls.comments, 1, 'the first press starts one comment write');
  for (const b of controlsOf(f)) assert.equal(b.disabled, true, `control "${b.textContent}" is disabled while in flight`);

  press(f.optionBtns[0]); // a double press on the same option
  press(f.optionBtns[1]); // another option
  press(f.answer); // Answer, with text in the box
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

  press(f.optionBtns[0]);
  await flush();
  release();
  await flush();
  assert.equal(calls.comments, 1, 'the answer was delivered once');
  assert.equal(f.feedback.textContent !== '', true, 'the card reports the outcome');
  for (const b of controlsOf(f)) assert.equal(b.disabled, true, `control "${b.textContent}" stays disabled after success`);

  press(f.optionBtns[1]);
  press(f.answer);
  await flush();
  assert.equal(calls.comments, 1, 'a settled answer is not sent again from the same card');
});

test('after failure: the controls come back, so the person can answer again', async () => {
  const f = makeLiveCard();
  const { sandbox, calls, release } = makeSandbox([f.card]);
  sandbox.commentResult = { ok: false, status: 500, data: { error: 'boom' } };
  sandbox.module.exports.initQuestionCards();

  press(f.optionBtns[0]);
  await flush();
  release();
  await flush();
  assert.equal(calls.comments, 1);
  for (const b of controlsOf(f)) assert.equal(b.disabled, false, `control "${b.textContent}" works again after a failure`);

  sandbox.commentResult = { ok: true, status: 200, data: { success: true, comment: { id: 'c-2' } } };
  press(f.optionBtns[1]);
  await flush();
  assert.equal(calls.comments, 2, 'the retry is a second comment, because the first one failed');
});

/**
 * LIN-4114 (close-out, review ledger "the `gone`/`dispatch` delivery through the Home card"): a ruling whose loop is gone
 * (disposition `gone`, effect `dispatch`) is answered with one comment, then ONE fresh run, and the card announces itself
 * answered once, under the ruling's own key. The card gets no resume follow-up (nothing to resume).
 */
test('gone / dispatch: pressing the recommended option writes one comment, starts one fresh run, and announces the card answered once', async () => {
  const f = makeLiveCard();
  Object.assign(f.card.dataset, { effect: 'dispatch', disposition: 'gone' });
  const events = [];
  f.card.dispatchEvent = (e) => { events.push(e); return true; };
  const { sandbox, calls, release } = makeSandbox([f.card]);
  sandbox.module.exports.initQuestionCards();

  press(f.optionBtns[0]); // the recommended (primary) option
  await flush();
  release();
  await flush();

  assert.equal(calls.comments, 1, 'one comment write');
  assert.equal(calls.runs.length, 1, 'one fresh run through window.dispatchPrompt');
  assert.equal(calls.other, 0, 'no resume follow-up request: a gone loop has nothing to resume');
  assert.equal(calls.runs[0].issue.identifier, 'LOCAL-S', 'the run is scoped to the ruling\'s anchor task');
  assert.match(calls.runs[0].prompt, /Chosen answer: Split the change/, 'the run brief carries the chosen answer');
  assert.equal(f.feedback.textContent, 'started a new run', 'the card reports a run, not a queued reply');
  assert.equal(events.length, 1, 'harbour:question-answered is dispatched exactly once');
  assert.equal(events[0].type, 'harbour:question-answered');
  assert.equal(events[0].detail.key, sandbox.module.exports.rulingKeyOf(f.card), 'under the ruling\'s own key');
  assert.equal(events[0].detail.key, 'loop:lp-1|d-opts');
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
  press(f.optionBtns[0]);
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
  press(f.optionBtns[0]);
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
  press(f.optionBtns[0]);
  await flush();
  release();
  await flush();
  assert.equal(f.card.dataset.answerInFlight, 'true', 'the partial card stays in flight');
});
