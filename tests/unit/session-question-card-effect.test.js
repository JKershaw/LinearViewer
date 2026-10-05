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
const COMMON_JS_SRC = readFileSync(join(__dirname, '../../public/common.js'), 'utf8');

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

function makeCard({ effect, recordOn = '', question = 'Ship it?', chunks = [], typed = 'my answer', issueIdentifier = 'LIN-1', issueId = 'i1', disposition, source, bindingScope }) {
  const btn = makeEl();
  const textarea = makeEl({ value: typed });
  const feedback = makeEl();
  const questionEl = makeEl({ textContent: question });
  const chunkEls = chunks.map(c => makeEl({ textContent: c }));
  const card = makeEl({
    dataset: {
      urlKey: 'w', loopId: 'lp', stampLoopId: 'sp', decisionId: 'd1', target: 'cli',
      issueId, issueIdentifier, disposition: disposition || (effect === 'resume' ? 'resumable' : 'gone'),
      effect, recordOn, sessionWaiting: 'false',
      ...(source ? { source } : {}),
      ...(bindingScope ? { bindingScope } : {})
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
        deliveredEffect(opts) {
          const e = opts.effect;
          if (e === 'resume' && opts.disposition && opts.disposition !== 'resumable') return 'dispatch';
          return e;
        },
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

// Real-delivery sandbox (G1/G4 card-level): the REAL common.js owns
// deliverRulingAnswer, with only the network seams stubbed, so the card's
// press-time anchor guard and no-issue refusal are exercised end to end.
function makeRealDeliverySandbox(cards, { hydrate, commentOk = true } = {}) {
  const calls = [];
  const sandbox = {
    module: { exports: {} },
    window: {
      _listeners: {},
      addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); },
      matchMedia: () => ({ matches: false }),
      ChatUI: { appendMessage() {} },
      api: async () => hydrate || { hydrated: false }
    },
    document: {
      addEventListener() {},
      querySelectorAll(sel) { return sel.includes('session-question-card') ? cards.map(c => c.card) : []; },
      createElement() { return makeEl(); }
    },
    localStorage: { getItem: () => null, setItem() {} },
    fetch(url, opts) {
      calls.push({ url: String(url), opts });
      if (String(url).includes('/api/comments/')) return Promise.resolve({ ok: commentOk, status: commentOk ? 201 : 502, json: () => Promise.resolve({ success: commentOk }) });
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
    },
    setTimeout() {},
    console
  };
  vm.createContext(sandbox);
  vm.runInContext(COMMON_JS_SRC, sandbox, { filename: 'common.js' });
  // Override the shared helper's network seam after common.js has defined it.
  sandbox.window.api = async () => hydrate || { hydrated: false };
  const dispatched = [];
  sandbox.window.dispatchPrompt = async (opts) => { dispatched.push(opts); return { id: 'run-1' }; };
  vm.runInContext(SESSION_JS_SRC, sandbox, { filename: 'session.js' });
  return { sandbox, calls, dispatched };
}

async function flush() { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); }

test('G1 card-level: answering a dispatch card whose anchor is TERMINAL records instead of starting a run', async () => {
  const fixture = makeCard({ effect: 'dispatch', typed: 'go ahead' });
  const { sandbox, calls, dispatched } = makeRealDeliverySandbox([fixture], {
    hydrate: { hydrated: true, state: { name: 'Done', type: 'completed' } }
  });
  sandbox.module.exports.initQuestionCards();
  fixture.btn.click();
  await flush();

  assert.equal(dispatched.length, 0, 'no fresh run onto a closed task');
  const comments = calls.filter(c => c.url.includes('/api/comments/'));
  assert.equal(comments.length, 1, 'the answer is recorded instead');
  assert.match(fixture.feedback.textContent, /recorded on the task/);
  assert.match(fixture.feedback.textContent, /now closed/, 'the downgrade note is surfaced to the person');
  assert.equal(fixture.btn.textContent, 'answered ✓');
});

// H1 (pass 3): a declared `resume` on a reaped loop (`gone`) is delivered as a
// fresh run (G3). The card's copy must describe the delivered effect, not the
// declared one, or it claims "queued" while a run actually started.
test('H1 card-level: gone + declared resume reports the delivered fresh run, not a queued resume', async () => {
  const fixture = makeCard({ effect: 'resume', disposition: 'gone', typed: 'go ahead' });
  const { sandbox, calls, dispatched } = makeRealDeliverySandbox([fixture], {
    hydrate: { hydrated: true, state: { name: 'Backlog', type: 'backlog' } }
  });
  sandbox.module.exports.initQuestionCards();
  fixture.btn.click();
  await flush();

  assert.equal(dispatched.length, 1, 'the reaped resume is delivered as one fresh run');
  assert.match(fixture.feedback.textContent, /started a new run/, 'the copy matches what was delivered');
  assert.doesNotMatch(fixture.feedback.textContent, /queued/);
  assert.equal(fixture.btn.textContent, 'started ✓');
});

test('H1 card-level: gone + declared resume on a TERMINAL anchor reports recorded with the closed note', async () => {
  const fixture = makeCard({ effect: 'resume', disposition: 'gone', typed: 'go ahead' });
  const { sandbox, dispatched } = makeRealDeliverySandbox([fixture], {
    hydrate: { hydrated: true, state: { name: 'Done', type: 'completed' } }
  });
  sandbox.module.exports.initQuestionCards();
  fixture.btn.click();
  await flush();

  assert.equal(dispatched.length, 0, 'no run onto a closed task (G1 downgrade)');
  assert.match(fixture.feedback.textContent, /recorded on the task/);
  assert.match(fixture.feedback.textContent, /now closed/, 'the downgrade note is not dropped');
  assert.equal(fixture.btn.textContent, 'answered ✓');
});

test('G4 card-level: an issueless dispatch card refuses with the tab message — no comment, no run', async () => {
  const fixture = makeCard({ effect: 'dispatch', issueIdentifier: '', issueId: '', typed: 'go ahead' });
  const { sandbox, calls, dispatched } = makeRealDeliverySandbox([fixture]);
  sandbox.module.exports.initQuestionCards();
  fixture.btn.click();
  await flush();

  assert.equal(calls.length, 0, 'no comment against an empty issue id, no run');
  assert.equal(dispatched.length, 0);
  assert.equal(fixture.feedback.textContent, 'cannot start a fresh run: no linked issue');
});

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
  assert.equal(opts.disposition, 'gone', 'the disposition rides the card so the shared path can refuse a resume on a reaped loop (G3)');
  assert.match(opts.dispatchPrompt, /Decision: Ship it\?/, 'the brief is composed for every answer; the record path simply ignores it');
  assert.equal(fixture.feedback.textContent, 'recorded on the task');
  assert.equal(fixture.btn.textContent, 'answered ✓');
});

test('effect=resume: keeps the ordinary comment + follow-up chain and queues', async () => {
  const fixture = makeCard({ effect: 'resume' });
  const { opts } = await answer(fixture);

  assert.equal(opts.effect, 'resume');
  assert.equal(opts.followUpTo, 'lp');
  assert.equal(opts.force, true, 'a resumable decision still forces the follow-up');
  assert.equal(opts.disposition, 'resumable', 'the disposition rides the card for the shared G3 guard');
  assert.match(opts.dispatchPrompt, /Decision: Ship it\?/, 'the brief is composed for every answer; the resume path simply ignores it');
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

// LIN-3126 residual (review `5902c5c1`): the card's own `data-source` /
// `data-binding-scope` stamps (rendered by lib/render-session.js) must ride the
// answer's opts, or the shared helper's strict comment/dispatch resolution 422s
// on a two-binding workspace. Mutation: delete the two dataset reads in
// public/session.js:475-476.
test('the card answer forwards its data-source/data-binding-scope to the shared helper', async () => {
  const fixture = makeCard({ effect: 'resume', source: 'github', bindingScope: 'octo/repoB' });
  const { opts } = await answer(fixture);

  assert.equal(opts.source, 'github', 'the card source rides the answer opts');
  assert.equal(opts.bindingScope, 'octo/repoB', 'the card scope rides the answer opts');
});

