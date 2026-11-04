/**
 * LIN-4241 (client): a `ruling-settled` refusal is "answered elsewhere", not a failure.
 *
 * When the server refuses an answer or a dismissal with 409 `ruling-settled`, the
 * card must leave the page and announce "Answered elsewhere" through the existing
 * RULING_GONE_EVENT path, and no "reply failed" / "dismiss failed" copy may show.
 * No follow-up run may be dispatched after such a refusal.
 *
 * The card client runs for real (public/common.js and public/question-cards.js in a
 * vm sandbox) on the real card markup from renderDecisionCard. Only fetch is stubbed.
 * The two control cases use a generic 500, so the test shows the settled branch is
 * the one that differs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { withHarnessModels } from '../fixtures/harness-models.js';
import { renderDecisionCard } from '../../lib/question-card.js';
import { LOOP_BACKED_ROWS, RENDER_OPTS } from '../fixtures/question-card-rows.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../..');
const COMMON_JS_SRC = readFileSync(join(REPO, 'public/common.js'), 'utf8');
const QUESTION_CARDS_JS_SRC = readFileSync(join(REPO, 'public/question-cards.js'), 'utf8');

const unescapeHtml = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const el = (over = {}) => Object.assign({
  dataset: {}, textContent: '', value: '', disabled: false, isConnected: true, listeners: {},
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
  click() { (this.listeners.click || []).forEach((fn) => fn({ preventDefault() {} })); },
  querySelector() { return null; },
  querySelectorAll() { return []; },
}, over);

/** A real card: attached until removeChild runs, recording what each event saw at dispatch time. */
function makeCard(html) {
  const root = html.match(/<div class="sess-qcard" ([^>]*)>/);
  const dataset = {};
  for (const m of root[1].matchAll(/data-([a-z-]+)="([^"]*)"/g)) {
    dataset[m[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = unescapeHtml(m[2]);
  }
  const dismissBtn = el();
  const btn = el();
  const textarea = el({ value: '' });
  const feedback = el();
  const events = [];
  const card = {
    dataset,
    parentNode: { removeChild(c) { c.parentNode = null; } },
    get isConnected() { return this.parentNode !== null; },
    dispatchEvent(ev) { events.push({ type: ev.type, bubbles: ev.bubbles, detail: ev.detail, connectedAtDispatch: this.parentNode !== null }); return true; },
    querySelector(sel) {
      switch (sel) {
        case '[data-testid="session-question-card-answer"]': return btn;
        case '[data-testid="session-question-card-input"]': return textarea;
        case '.sess-qcard-feedback': return feedback;
        case '[data-testid="session-question-card-dismiss"]': return dismissBtn;
        default: return null;
      }
    },
    querySelectorAll() { return []; },
  };
  return { card, btn, dismissBtn, textarea, feedback, events };
}

async function flush() { for (let i = 0; i < 16; i++) await new Promise((r) => setImmediate(r)); }

/**
 * Builds the sandbox with a routed fetch stub. `responses` maps a URL fragment to
 * {status, data}. Every fetch is recorded so a test can prove what was (and was not)
 * sent after a refusal.
 */
function makeSandbox(cards, responses) {
  const requests = [];
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
    setTimeout() {},
    console,
  };
  sandbox.fetch = (url) => {
    requests.push(String(url));
    const hit = Object.keys(responses).find((frag) => String(url).includes(frag));
    const { status, data } = hit ? responses[hit] : { status: 200, data: { success: true, comment: { id: 'c-1' } } };
    return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(data) });
  };
  vm.createContext(sandbox);
  vm.runInContext(withHarnessModels(COMMON_JS_SRC), sandbox, { filename: 'common.js' });
  sandbox.window.api = async () => ({});
  sandbox.window.dispatchPrompt = async () => ({ id: 'run-1' });
  vm.runInContext(QUESTION_CARDS_JS_SRC, sandbox, { filename: 'question-cards.js' });
  return { sandbox, requests };
}

const SETTLED = { status: 409, data: { error: 'This ruling was already answered or dismissed.', code: 'ruling-settled' } };
const SERVER_ERROR = { status: 500, data: { error: 'boom' } };

function loopCard() {
  const html = renderDecisionCard(structuredClone(LOOP_BACKED_ROWS['loop-with-options']), RENDER_OPTS);
  return makeCard(html);
}

test('answer refused ruling-settled: the card leaves, "Answered elsewhere" is announced, no run is dispatched', async () => {
  const f = loopCard();
  const { sandbox, requests } = makeSandbox([f.card], { '/api/comments/': SETTLED });
  sandbox.module.exports.initQuestionCards();
  f.textarea.value = 'Yes, go ahead';
  f.btn.click();
  await flush();

  assert.ok(requests.some((u) => u.includes('/api/comments/')), 'the answer reached the comment route');
  assert.equal(f.events.length, 1, 'exactly one announcement reaches the page');
  assert.equal(f.events[0].type, 'harbour:question-answered');
  assert.equal(f.events[0].detail.message, 'Answered elsewhere');
  assert.equal(f.events[0].connectedAtDispatch, true, 'announced while the card is still on the page');
  assert.equal(f.card.parentNode, null, 'the card leaves the page');
  assert.ok(!/reply failed/.test(f.feedback.textContent), 'no generic "reply failed" copy');
  assert.ok(!requests.some((u) => u.includes('/api/dispatch')), 'no follow-up run is dispatched after the refusal');
});

test('dismiss refused ruling-settled: the card leaves with "Answered elsewhere", not a failed dismiss, and no run follows', async () => {
  const f = loopCard();
  const { sandbox, requests } = makeSandbox([f.card], { '/api/dashboard/rulings/dismiss': SETTLED });
  sandbox.module.exports.initQuestionCards();
  f.dismissBtn.click();
  await flush();

  assert.ok(requests.some((u) => u.includes('/api/dashboard/rulings/dismiss')), 'the dismiss reached the route');
  assert.equal(f.events.length, 1, 'exactly one announcement reaches the page');
  assert.equal(f.events[0].detail.message, 'Answered elsewhere', 'not "Dismissed": the ruling was settled by someone else');
  assert.equal(f.events[0].connectedAtDispatch, true);
  assert.equal(f.card.parentNode, null, 'the card leaves the page');
  assert.ok(!/dismiss failed/.test(f.feedback.textContent), 'no generic "dismiss failed" copy');
  assert.ok(!requests.some((u) => u.includes('/api/dispatch') || u.includes('/api/comments/')), 'the dismiss sends no follow-up run and no comment');
});

test('control: a generic server failure on answer is still a failure — the card stays with "reply failed"', async () => {
  const f = loopCard();
  const { sandbox } = makeSandbox([f.card], { '/api/comments/': SERVER_ERROR });
  sandbox.module.exports.initQuestionCards();
  f.textarea.value = 'Yes, go ahead';
  f.btn.click();
  await flush();

  assert.equal(f.events.length, 0, 'a failure announces nothing');
  assert.equal(f.card.parentNode !== null, true, 'the card stays on the page');
  assert.match(f.feedback.textContent, /reply failed/);
});

test('control: a generic server failure on dismiss is still "dismiss failed" — the card stays', async () => {
  const f = loopCard();
  const { sandbox } = makeSandbox([f.card], { '/api/dashboard/rulings/dismiss': SERVER_ERROR });
  sandbox.module.exports.initQuestionCards();
  f.dismissBtn.click();
  await flush();

  assert.equal(f.events.length, 0, 'a failed dismiss announces nothing');
  assert.equal(f.card.parentNode !== null, true, 'the card stays on the page');
  assert.match(f.feedback.textContent, /dismiss failed/);
});
