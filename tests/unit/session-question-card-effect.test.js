/**
 * LIN-3252 F1 — the pinned card's Answer must route by the ruling row's
 * resolved `effect`, not collapse every non-resumable answer to a record.
 *
 * public/session.js is a browser script, so it is vm-sandboxed with a minimal
 * card DOM and a stubbed `window.ReplyDelivery` (the real effect semantics are
 * pinned separately in tests/unit/reply-delivery-contract.test.js). This file
 * pins only the card's OWN branch: which effect it hands over, the composed
 * dispatch brief, the declared record_on, and the success copy.
 *
 * Run with: node --test tests/unit/session-question-card-effect.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SESSION_JS_SRC = readFileSync(join(__dirname, '../../public/session.js'), 'utf8');

function makeEl(over = {}) {
  return Object.assign({
    dataset: {}, textContent: '', value: '', className: '', disabled: false, hidden: false,
    listeners: {},
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
    click() { (this.listeners.click || []).forEach(fn => fn({ preventDefault() {} })); },
    querySelector() { return null; },
    querySelectorAll() { return []; }
  }, over);
}

function makeCard({ effect, recordOn = '', question = 'Ship it?', chunks = [], typed = 'my answer' }) {
  const btn = makeEl();
  const textarea = makeEl({ value: typed });
  const feedback = makeEl();
  const questionEl = makeEl({ textContent: question });
  const chunkEls = chunks.map(c => makeEl({ textContent: c }));
  const card = makeEl({
    dataset: {
      urlKey: 'w', loopId: 'lp', stampLoopId: 'sp', decisionId: 'd1', target: 'cli',
      issueId: 'i1', issueIdentifier: 'LIN-1', disposition: effect === 'resume' ? 'resumable' : 'gone',
      effect, recordOn, sessionWaiting: 'false'
    },
    querySelector(sel) {
      if (sel.includes('answer')) return btn;
      if (sel.includes('card-input')) return textarea;
      if (sel === '.sess-qcard-feedback') return feedback;
      if (sel.includes('question') && sel.includes('card-question')) return questionEl;
      return null; // dismiss / thread / checked option: none in these fixtures
    },
    querySelectorAll(sel) { return sel.includes('why-chunk') ? chunkEls : []; }
  });
  return { card, btn, textarea, feedback };
}

function makeSandbox(cards) {
  const captured = [];
  const sandbox = {
    module: { exports: {} },
    window: {
      ReplyDelivery: {
        deliverRulingAnswer(opts, handlers) { captured.push({ opts, handlers }); handlers.onDispatchOk(); return Promise.resolve(); },
        composeDispatchPrompt(row, chosenAnswer) {
          const parts = [];
          if (row.decision.question) parts.push('Decision: ' + row.decision.question);
          parts.push('Chosen answer: ' + chosenAnswer);
          if (row.decisionCase.length) parts.push('Context:\n' + row.decisionCase.join(' '));
          return parts.join('\n\n');
        }
      },
      ChatUI: { appendMessage() {} }
    },
    document: {
      addEventListener() {},
      querySelectorAll(sel) { return sel.includes('session-question-card') ? cards.map(c => c.card) : []; },
      createElement() { return makeEl(); }
    },
    setTimeout() {},
    console
  };
  vm.createContext(sandbox);
  vm.runInContext(SESSION_JS_SRC, sandbox, { filename: 'session.js' });
  return { sandbox, captured };
}

async function answer(cardFixture) {
  const { sandbox, captured } = makeSandbox([cardFixture]);
  sandbox.module.exports.initQuestionCards();
  cardFixture.btn.click();
  await Promise.resolve();
  await Promise.resolve();
  return captured[0];
}

test('effect=dispatch: hands the card the dispatch effect and a composed brief (question + answer + why), never the raw comment text', async () => {
  const fixture = makeCard({ effect: 'dispatch', question: 'Ship it?', chunks: ['case one', 'case two'], typed: 'my answer' });
  const { opts } = await answer(fixture);

  assert.equal(opts.effect, 'dispatch', 'a gone/dispatch row must NOT collapse to a record-only answer');
  assert.equal(opts.prompt, 'my answer', 'the comment body is the chosen answer');
  assert.match(opts.dispatchPrompt, /Decision: Ship it\?/, 'the agent brief carries the question');
  assert.match(opts.dispatchPrompt, /Chosen answer: my answer/);
  assert.match(opts.dispatchPrompt, /case one case two/, 'the why-chunks are the case recap');
  assert.equal(fixture.feedback.textContent, 'started a new run', 'the success copy matches what actually happened');
  assert.equal(fixture.btn.textContent, 'started ✓');
});

test('effect=record: hands over record (with the declared record_on) and reports recorded, not started', async () => {
  const fixture = makeCard({ effect: 'record', recordOn: 'LIN-SIB' });
  const { opts } = await answer(fixture);

  assert.equal(opts.effect, 'record');
  assert.equal(opts.recordOn, 'LIN-SIB', 'the declared record_on target rides the card so the shared helper can resolve it');
  assert.equal(opts.dispatchPrompt, undefined, 'a record answer never composes a run brief');
  assert.equal(fixture.feedback.textContent, 'recorded on the task');
  assert.equal(fixture.btn.textContent, 'answered ✓');
});

test('effect=resume: keeps the ordinary comment + follow-up chain and queues', async () => {
  const fixture = makeCard({ effect: 'resume' });
  const { opts } = await answer(fixture);

  assert.equal(opts.effect, 'resume');
  assert.equal(opts.followUpTo, 'lp');
  assert.equal(opts.force, true, 'a resumable decision still forces the follow-up');
  assert.equal(opts.dispatchPrompt, undefined);
  assert.match(fixture.feedback.textContent, /reply queued/);
  assert.equal(fixture.btn.textContent, 'queued ✓');
});

test('an empty reply is refused before any delivery is attempted', async () => {
  const fixture = makeCard({ effect: 'dispatch', typed: '' });
  const { sandbox, captured } = makeSandbox([fixture]);
  sandbox.module.exports.initQuestionCards();
  fixture.btn.click();
  assert.equal(captured.length, 0, 'no delivery without an answer');
  assert.equal(fixture.feedback.textContent, 'enter a reply');
});
