/**
 * LIN-4114 (verdict note 2): a dismiss announces the ruling as gone BEFORE the card leaves the DOM.
 *
 * Witness (corrective, beat 3): the order is observable from outside through the card alone. The fake card is attached
 * (`isConnected` follows `parentNode`), and the test records whether it was still attached when the event fired. Fire the
 * event after removing the card and no event reaches Home (the desk root is unset here), so the first assertion fails.
 *
 * The card client runs for real (public/common.js and public/question-cards.js in a vm sandbox); the card's markup is the
 * real renderDecisionCard output; only the dismiss route is stubbed.
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

/** A card the client can dismiss: attached until removeChild runs, and recording what each event saw at dispatch time. */
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
  return { card, dismissBtn, events };
}

async function flush() { for (let i = 0; i < 12; i++) await new Promise((r) => setImmediate(r)); }

function makeSandbox(cards) {
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
    fetch() { return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ success: true }) }); },
    setTimeout() {},
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(withHarnessModels(COMMON_JS_SRC), sandbox, { filename: 'common.js' });
  sandbox.window.api = async () => ({});
  sandbox.window.dispatchPrompt = async () => ({ id: 'run-1' });
  vm.runInContext(QUESTION_CARDS_JS_SRC, sandbox, { filename: 'question-cards.js' });
  return sandbox;
}

test('dismiss: the ruling is announced while its card is still attached, then the card leaves (verdict note 2)', async () => {
  const html = renderDecisionCard(structuredClone(LOOP_BACKED_ROWS['loop-with-options']), RENDER_OPTS);
  const f = makeCard(html);
  const sandbox = makeSandbox([f.card]);
  sandbox.module.exports.initQuestionCards();
  f.dismissBtn.click();
  await flush();
  assert.equal(f.events.length, 1, 'exactly one announcement reaches the page (a card removed first announces nothing)');
  assert.equal(f.events[0].type, 'harbour:question-answered');
  assert.equal(f.events[0].bubbles, true, 'the event bubbles to Home\'s <main>');
  assert.equal(f.events[0].connectedAtDispatch, true, 'the card was still on the page when the event fired');
  assert.equal(f.events[0].detail.key, 'loop:lp-1|d-opts', 'the detail names the ruling every copy shares');
  assert.equal(f.card.parentNode, null, 'the card leaves the page after the announcement');
});
