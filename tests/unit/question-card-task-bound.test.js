/**
 * LIN-4140 — the shared question card answers and dismisses a scan-raised
 * (task-bound) ruling, and loop-backed cards stay byte-for-byte unchanged.
 *
 * Beat 1 (witnesses first): the `LOOP-BACKED` and `GUARD` tests pin today's
 * behaviour and must keep passing; the `NEW` tests describe the behaviour to
 * build and are expected to FAIL against the unmodified code.
 *
 * The card client runs for real: public/common.js (ReplyDelivery) and
 * public/question-cards.js are vm-sandboxed with a stubbed `fetch`, and the
 * card's DOM is built from the REAL `renderDecisionCard` markup, so the
 * markup→client contract is what is under test.
 *
 * Run with: node --test tests/unit/question-card-task-bound.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { withHarnessModels } from '../fixtures/harness-models.js';
import { renderDecisionCard } from '../../lib/question-card.js';
import {
  LOOP_BACKED_ROWS, RENDER_OPTS, TASK_BOUND_ROW, TASK_DECISION_ID, TASK_ISSUE_UUID
} from '../fixtures/question-card-rows.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '../..');
const COMMON_JS_SRC = readFileSync(join(REPO, 'public/common.js'), 'utf8');
const QUESTION_CARDS_JS_SRC = readFileSync(join(REPO, 'public/question-cards.js'), 'utf8');
const GOLDEN = JSON.parse(readFileSync(join(__dirname, '../fixtures/question-card-loop-golden.json'), 'utf8'));

const OPEN_TASK = { hydrated: true, state: { name: 'In Progress', type: 'started' } };
const NOOP_HANDLERS = {
  onCommentFailed() {}, onDispatchFailed() {}, onPartialFailure() {}, onDispatchOk() {}, onNoTarget() {}, onNoLinkedIssue() {}
};

// ── helpers ────────────────────────────────────────────────────────────────

function unescapeHtml(s) {
  return s.replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function el(over = {}) {
  return Object.assign({
    dataset: {}, textContent: '', value: '', className: '', disabled: false, hidden: false, isConnected: true,
    listeners: {},
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
    click() { (this.listeners.click || []).forEach(fn => fn({ preventDefault() {} })); },
    querySelector() { return null; },
    querySelectorAll() { return []; }
  }, over);
}

/**
 * Build the card's client-side DOM from the real rendered markup: the root's
 * data-* attributes become `dataset` (camelCased, entity-decoded), and the
 * controls the client looks up are fakes whose state the tests read.
 */
function makeFakeCard(html, { typed = '' } = {}) {
  const root = html.match(/<div class="sess-qcard" ([^>]*)>/);
  assert.ok(root, 'the rendered card has a root element');
  const dataset = {};
  for (const m of root[1].matchAll(/data-([a-z-]+)="([^"]*)"/g)) {
    dataset[m[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = unescapeHtml(m[2]);
  }
  const questionMatch = html.match(/data-testid="session-question-card-question">([^<]*)</);
  const questionEl = el({ textContent: questionMatch ? unescapeHtml(questionMatch[1]) : '' });
  const btn = el();
  const textarea = el({ value: typed });
  const feedback = el();
  const dismissBtn = html.includes('data-testid="session-question-card-dismiss"') ? el() : null;
  // LIN-4114: each option is a button. A press answers with that button's own label (no radio is ticked any more).
  const optionBtns = [...html.matchAll(/<button [^>]*data-option-id="([^"]*)"[^>]*>([^<]*)<\/button>/g)]
    .map(m => el({ dataset: { optionId: unescapeHtml(m[1]) }, textContent: unescapeHtml(m[2]) }));
  const optionBtn = (id) => {
    const b = optionBtns.find(x => x.dataset.optionId === id);
    assert.ok(b, `option ${id} is rendered`);
    return b;
  };
  const card = el({
    dataset,
    parentNode: { removeChild() { card.removed = true; } },
    querySelector(sel) {
      switch (sel) {
        case '[data-testid="session-question-card-answer"]': return btn;
        case '[data-testid="session-question-card-input"]': return textarea;
        case '.sess-qcard-feedback': return feedback;
        case '[data-testid="session-question-card-dismiss"]': return dismissBtn;
        case '[data-testid="session-question-card-question"]': return questionEl;
        default: return null;
      }
    },
    querySelectorAll(sel) { return sel === '[data-testid="session-question-card-option"]' ? optionBtns : []; }
  });
  return { card, btn, textarea, feedback, dismissBtn, optionBtn };
}

async function flush() { for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r)); }

/**
 * A vm sandbox holding the REAL common.js and question-cards.js. Only the
 * network seams are stubbed: `fetch` (recorded), `window.api` (the hydrate),
 * and `window.dispatchPrompt` (the fresh-run starter).
 */
function makeSandbox(cards, { hydrate = OPEN_TASK, commentOk = true, dismissOk = true } = {}) {
  const calls = [];
  const dispatched = [];
  const sandbox = {
    module: { exports: {} },
    window: {
      _listeners: {},
      addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); },
      matchMedia: () => ({ matches: false }),
      ChatUI: { appendMessage() {} }
    },
    document: {
      addEventListener() {},
      querySelectorAll(sel) { return sel.includes('session-question-card') ? cards.map(c => c.card) : []; },
      createElement() { return el(); }
    },
    localStorage: { getItem: () => null, setItem() {} },
    fetch(url, opts) {
      const body = opts && opts.body ? JSON.parse(opts.body) : undefined;
      calls.push({ url: String(url), opts, body });
      let ok = true;
      if (/\/api\/comments\//.test(String(url))) ok = commentOk;
      if (/\/api\/scan\/|\/rulings\/dismiss/.test(String(url))) ok = dismissOk;
      return Promise.resolve({ ok, status: ok ? 200 : 500, json: () => Promise.resolve(ok ? { success: true } : { error: 'boom' }) });
    },
    setTimeout() {},
    console
  };
  vm.createContext(sandbox);
  vm.runInContext(withHarnessModels(COMMON_JS_SRC), sandbox, { filename: 'common.js' });
  sandbox.window.api = async () => hydrate;
  sandbox.window.dispatchPrompt = async (o) => { dispatched.push(o); return { id: 'run-1' }; };
  vm.runInContext(QUESTION_CARDS_JS_SRC, sandbox, { filename: 'question-cards.js' });
  const commentCalls = () => calls.filter(c => /\/api\/comments\//.test(c.url));
  const runStarts = () => calls.filter(c => /\/api\/dispatch/.test(c.url)).length + dispatched.length;
  return { sandbox, calls, dispatched, commentCalls, runStarts };
}

const noopHandlers = () => ({ ...NOOP_HANDLERS });
const taskBoundMarkup = (over = {}) => renderDecisionCard(
  structuredClone({ ...TASK_BOUND_ROW, ...over }), RENDER_OPTS
);

// ── characterization: loop-backed markup is byte-identical ─────────────────

for (const name of Object.keys(LOOP_BACKED_ROWS)) {
  test(`LOOP-BACKED render: ${name} is byte-identical to the pre-LIN-4140 golden`, () => {
    const html = renderDecisionCard(structuredClone(LOOP_BACKED_ROWS[name]), RENDER_OPTS);
    assert.equal(html, GOLDEN[name]);
  });
}

// ── guards: the attribute is sparse (passes now, must keep passing) ────────

test('GUARD markup: no loop-backed row ever carries data-task-decision-id', () => {
  for (const name of Object.keys(LOOP_BACKED_ROWS)) {
    const html = renderDecisionCard(structuredClone(LOOP_BACKED_ROWS[name]), RENDER_OPTS);
    assert.doesNotMatch(html, /data-task-decision-id/, name);
  }
});

test('GUARD markup: a row with both a loop and a scan id does not carry the attribute', () => {
  const row = structuredClone({
    ...LOOP_BACKED_ROWS['loop-with-options'],
    anchor: { ...LOOP_BACKED_ROWS['loop-with-options'].anchor, taskDecisionId: TASK_DECISION_ID }
  });
  assert.doesNotMatch(renderDecisionCard(row, RENDER_OPTS), /data-task-decision-id/);
});

test('GUARD markup: a task-bound row with no scan id does not carry the attribute', () => {
  const html = taskBoundMarkup({ anchor: { ...TASK_BOUND_ROW.anchor, taskDecisionId: null } });
  assert.doesNotMatch(html, /data-task-decision-id/);
});

test('GUARD markup: a task-bound row whose issue id is not a UUID does not carry the attribute (no provider-lookup path)', () => {
  const html = taskBoundMarkup({ anchor: { ...TASK_BOUND_ROW.anchor, issueId: 'LIN-7' } });
  assert.doesNotMatch(html, /data-task-decision-id/);
});

test('GUARD markup: a task-bound row with no issue id does not carry the attribute', () => {
  const html = taskBoundMarkup({ anchor: { ...TASK_BOUND_ROW.anchor, issueId: null } });
  assert.doesNotMatch(html, /data-task-decision-id/);
});

test('GUARD client: a loop-backed answer carries no task-decision fields and keeps its chosen option', async () => {
  const f = makeFakeCard(renderDecisionCard(structuredClone(LOOP_BACKED_ROWS['loop-with-options']), RENDER_OPTS), { typed: '' });
  const h = makeSandbox([f]);
  h.sandbox.module.exports.initQuestionCards();
  f.optionBtn('opt-a').click();
  await flush();
  const [comment] = h.commentCalls();
  assert.ok(comment, 'the answer writes its comment');
  assert.equal(comment.body.optionId, 'opt-a', 'the loop-backed body keeps optionId');
  assert.equal('taskDecisionId' in comment.body, false);
  assert.equal('taskDecisionIssueId' in comment.body, false);
});

test('GUARD client: a loop-backed dismiss still hits the rulings dismiss route first, with the loop stamp', async () => {
  const f = makeFakeCard(renderDecisionCard(structuredClone(LOOP_BACKED_ROWS['loop-with-options']), RENDER_OPTS));
  const h = makeSandbox([f]);
  h.sandbox.module.exports.initQuestionCards();
  f.dismissBtn.click();
  await flush();
  assert.equal(h.calls[0].url, '/workspace/w/api/dashboard/rulings/dismiss');
  assert.deepEqual(h.calls[0].body, { decisionLoopId: 'lp-1', decisionId: 'd-opts' });
});

// ── NEW: the markup carries the scan decision id ───────────────────────────

test('NEW markup: a task-bound row with a scan id and an issue UUID emits data-task-decision-id', () => {
  const html = taskBoundMarkup();
  assert.match(html, new RegExp(`data-task-decision-id="${TASK_DECISION_ID}"`));
});

// ── NEW: comment writes forward the scan pair (real ReplyDelivery) ──────────

test('NEW client: a task-bound free-text answer writes the comment with the scan pair and no optionId', async () => {
  const f = makeFakeCard(taskBoundMarkup(), { typed: 'my answer' });
  const h = makeSandbox([f]);
  h.sandbox.module.exports.initQuestionCards();
  f.btn.click();
  await flush();
  const [comment] = h.commentCalls();
  assert.ok(comment, 'the answer writes its comment');
  assert.equal(comment.body.taskDecisionId, TASK_DECISION_ID);
  assert.equal(comment.body.taskDecisionIssueId, TASK_ISSUE_UUID);
  assert.equal('optionId' in comment.body, false);
  assert.equal('decisionLoopId' in comment.body, false, 'no loop stamp on a scan row');
});

test('NEW client: a task-bound option press drops the chosen option id from the body', async () => {
  const f = makeFakeCard(taskBoundMarkup(), { typed: '' });
  const h = makeSandbox([f]);
  h.sandbox.module.exports.initQuestionCards();
  f.optionBtn('opt-a').click();
  await flush();
  const [comment] = h.commentCalls();
  assert.ok(comment, 'the press writes its comment');
  assert.equal(comment.body.taskDecisionId, TASK_DECISION_ID, 'the scan pair is forwarded');
  assert.equal('optionId' in comment.body, false, 'the body matches the Rulings tab: no optionId');
  assert.equal(comment.body.body, 'Yes, ship it');
});

test('NEW client: a task-bound row that declares dispatch is delivered as record — no run, "recorded on the task"', async () => {
  const f = makeFakeCard(taskBoundMarkup({ effect: 'dispatch', declaredEffect: 'dispatch' }), { typed: 'go ahead' });
  const h = makeSandbox([f]);
  h.sandbox.module.exports.initQuestionCards();
  f.btn.click();
  await flush();
  assert.equal(h.runStarts(), 0, 'no fresh run is started for a scan row, even when an older row declares dispatch');
  assert.equal(h.commentCalls().length, 1, 'the answer is recorded');
  assert.equal(h.commentCalls()[0].body.taskDecisionId, TASK_DECISION_ID);
  assert.match(f.feedback.textContent, /recorded on the task/);
});

test('NEW client: a task-bound row that declares resume is also delivered as record — no follow-up dispatch', async () => {
  const f = makeFakeCard(taskBoundMarkup({ effect: 'resume', declaredEffect: 'resume' }), { typed: 'go ahead' });
  const h = makeSandbox([f]);
  h.sandbox.module.exports.initQuestionCards();
  f.btn.click();
  await flush();
  assert.equal(h.runStarts(), 0, 'no resume follow-up for a scan row');
  assert.equal(h.commentCalls()[0].body.taskDecisionId, TASK_DECISION_ID);
});

test('NEW write site (deliverReply, resume branch): forwards the scan pair', async () => {
  const h = makeSandbox([]);
  await h.sandbox.window.ReplyDelivery.deliverReply({
    urlKey: 'w', issueId: TASK_ISSUE_UUID, followUpTo: 'lp-1', target: 'cli', source: 'github',
    taskDecisionId: TASK_DECISION_ID, taskDecisionIssueId: TASK_ISSUE_UUID
  }, 'my answer', noopHandlers());
  const [comment] = h.commentCalls();
  assert.ok(comment, 'the comment is written');
  assert.equal(comment.body.taskDecisionId, TASK_DECISION_ID);
  assert.equal(comment.body.taskDecisionIssueId, TASK_ISSUE_UUID);
});

test('NEW write site (deliverReply, recordOnly branch): forwards the scan pair and starts no run', async () => {
  const h = makeSandbox([]);
  await h.sandbox.window.ReplyDelivery.deliverReply({
    urlKey: 'w', issueId: TASK_ISSUE_UUID, followUpTo: 'lp-1', target: 'cli', source: 'github', recordOnly: true,
    taskDecisionId: TASK_DECISION_ID, taskDecisionIssueId: TASK_ISSUE_UUID
  }, 'my answer', noopHandlers());
  const [comment] = h.commentCalls();
  assert.ok(comment, 'the comment is written');
  assert.equal(comment.body.taskDecisionId, TASK_DECISION_ID);
  assert.equal(comment.body.taskDecisionIssueId, TASK_ISSUE_UUID);
  assert.equal(h.runStarts(), 0);
});

test('NEW write site (deliverRulingRecord): forwards the scan pair', async () => {
  const h = makeSandbox([]);
  await h.sandbox.window.ReplyDelivery.deliverRulingRecord({
    urlKey: 'w', issueId: TASK_ISSUE_UUID, issueIdentifier: 'LIN-7', source: 'github', prompt: 'my answer',
    taskDecisionId: TASK_DECISION_ID, taskDecisionIssueId: TASK_ISSUE_UUID
  }, noopHandlers());
  const [comment] = h.commentCalls();
  assert.ok(comment, 'the comment is written');
  assert.equal(comment.body.taskDecisionId, TASK_DECISION_ID);
  assert.equal(comment.body.taskDecisionIssueId, TASK_ISSUE_UUID);
});

test('NEW write site (deliverRulingDispatch, the defensive downgrade/dispatch path): forwards the scan pair', async () => {
  const h = makeSandbox([]);
  await h.sandbox.window.ReplyDelivery.deliverRulingDispatch({
    urlKey: 'w', issueId: TASK_ISSUE_UUID, issueIdentifier: 'LIN-7', source: 'github', prompt: 'my answer',
    dispatchPrompt: 'brief', target: 'cli',
    taskDecisionId: TASK_DECISION_ID, taskDecisionIssueId: TASK_ISSUE_UUID
  }, { ...noopHandlers(), onPartialFailure() {} });
  const [comment] = h.commentCalls();
  assert.ok(comment, 'the comment is written before any run');
  assert.equal(comment.body.taskDecisionId, TASK_DECISION_ID);
  assert.equal(comment.body.taskDecisionIssueId, TASK_ISSUE_UUID);
});

// ── NEW: the card's answer is the Rulings tab's answer ──────────────────────

// LIN-4241: the card's `answerAttemptId` is its own per-submission id, the one deliberate divergence from the Rulings
// tab (unconverted, so it sends none). Parity is asserted on everything else: the same anchor, text and scan pair.
const withoutAttemptId = ({ answerAttemptId, ...rest }) => rest;

// Verbatim shape of the Rulings tab's task-bound comment write
// (public/observation.js, the `task-bound` branch of the ruling-reply path):
//   postComment(targetUrlKey, anchor.issueId || anchor.issueIdentifier, prompt,
//     { taskDecisionId: anchor.taskDecisionId, taskDecisionIssueId: anchor.issueId, source: anchor.source })
async function rulingsTabCommentFor(prompt) {
  const h = makeSandbox([]);
  await h.sandbox.window.ReplyDelivery.postComment('w', TASK_ISSUE_UUID, prompt, {
    taskDecisionId: TASK_DECISION_ID, taskDecisionIssueId: TASK_ISSUE_UUID, source: 'github'
  });
  const [comment] = h.commentCalls();
  return { url: comment.url, body: comment.body };
}

test('NEW differential: a task-bound free-text answer sends the same comment request as the Rulings tab', async () => {
  const tab = await rulingsTabCommentFor('my answer');
  const f = makeFakeCard(taskBoundMarkup(), { typed: 'my answer' });
  const h = makeSandbox([f]);
  h.sandbox.module.exports.initQuestionCards();
  f.btn.click();
  await flush();
  const [comment] = h.commentCalls();
  assert.ok(comment, 'the card writes its comment');
  assert.equal(comment.url, tab.url);
  assert.deepEqual(withoutAttemptId(comment.body), tab.body);
});

test('NEW differential: a task-bound option press sends the same comment request as the Rulings tab', async () => {
  const tab = await rulingsTabCommentFor('Yes, ship it');
  const f = makeFakeCard(taskBoundMarkup(), { typed: '' });
  const h = makeSandbox([f]);
  h.sandbox.module.exports.initQuestionCards();
  f.optionBtn('opt-a').click();
  await flush();
  const [comment] = h.commentCalls();
  assert.ok(comment, 'the card writes its comment');
  assert.equal(comment.url, tab.url);
  assert.deepEqual(withoutAttemptId(comment.body), tab.body);
});

test('NEW differential: a stray record_on on a scan row never redirects the comment off the anchor (the Rulings tab never does)', async () => {
  const row = { ...TASK_BOUND_ROW, decision: { ...TASK_BOUND_ROW.decision, on_answer: { effect: 'record', record_on: 'LIN-9' } } };
  const neighbourhood = {
    hydrated: true,
    state: { name: 'In Progress', type: 'started' },
    neighborhood: { parent: null, siblings: [{ identifier: 'LIN-9', id: 'uuid-9', state: { type: 'started' } }], children: [], cousins: [] }
  };
  const tab = await rulingsTabCommentFor('my answer');
  const f = makeFakeCard(renderDecisionCard(structuredClone(row), RENDER_OPTS), { typed: 'my answer' });
  const h = makeSandbox([f], { hydrate: neighbourhood });
  h.sandbox.module.exports.initQuestionCards();
  f.btn.click();
  await flush();
  const [comment] = h.commentCalls();
  assert.ok(comment, 'the card writes its comment');
  assert.equal(comment.url, tab.url, 'the comment lands on the anchor, not on LIN-9');
  assert.deepEqual(withoutAttemptId(comment.body), tab.body);
});

// ── NEW: dismissal of a scan row goes to the scan route ─────────────────────

test('NEW dismiss: a task-bound dismiss makes exactly one request, to the scan dismiss route by issue UUID with the source, body {id}', async () => {
  const f = makeFakeCard(taskBoundMarkup());
  const h = makeSandbox([f]);
  h.sandbox.module.exports.initQuestionCards();
  f.dismissBtn.click();
  await flush();
  assert.equal(h.calls.length, 1, 'one request — no rulings dismiss, no follow-up');
  assert.equal(h.calls[0].url, `/workspace/w/api/scan/${TASK_ISSUE_UUID}/dismiss?source=github`);
  assert.deepEqual(h.calls[0].body, { id: TASK_DECISION_ID });
  assert.equal(h.runStarts(), 0);
  assert.equal(f.card.removed, true, 'the card is removed on success');
});

test('NEW dismiss: a failed scan dismiss leaves the card in place, re-enables its buttons and says so', async () => {
  const f = makeFakeCard(taskBoundMarkup());
  const h = makeSandbox([f], { dismissOk: false });
  h.sandbox.module.exports.initQuestionCards();
  f.dismissBtn.click();
  await flush();
  assert.equal(h.calls[0].url, `/workspace/w/api/scan/${TASK_ISSUE_UUID}/dismiss?source=github`);
  assert.equal(f.card.removed, undefined, 'the card stays');
  assert.equal(f.dismissBtn.disabled, false);
  assert.equal(f.btn.disabled, false);
  assert.match(f.feedback.textContent, /dismiss failed/);
});

test('NEW dismiss: a task-bound dismiss sends no follow-up even when the disposition reads resumable', async () => {
  const f = makeFakeCard(taskBoundMarkup());
  f.card.dataset.disposition = 'resumable';
  const h = makeSandbox([f]);
  h.sandbox.module.exports.initQuestionCards();
  f.dismissBtn.click();
  await flush();
  assert.equal(h.calls.length, 1, 'the scan dismiss is the only request');
  assert.equal(h.runStarts(), 0, 'no run is started for a scan row');
});

// ── NEW: the delivered-effect rule ─────────────────────────────────────────

test('NEW effect: deliveredEffect returns record for a card carrying a scan decision id, whatever it declares', () => {
  const h = makeSandbox([]);
  const { deliveredEffect } = h.sandbox.window.ReplyDelivery;
  const scan = { taskDecisionId: TASK_DECISION_ID, taskDecisionIssueId: TASK_ISSUE_UUID };
  assert.equal(deliveredEffect({ ...scan, effect: 'dispatch' }), 'record');
  assert.equal(deliveredEffect({ ...scan, effect: 'resume', disposition: 'resumable' }), 'record');
});

test('GUARD effect: deliveredEffect leaves a loop-backed dispatch declared as dispatch', () => {
  const h = makeSandbox([]);
  assert.equal(h.sandbox.window.ReplyDelivery.deliveredEffect({ effect: 'dispatch' }), 'dispatch');
});

// ── NEW: the search guard — every postComment( call site is named ──────────

function listPostCommentSites(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) listPostCommentSites(path, out);
    else if (entry.name.endsWith('.js')) {
      readFileSync(path, 'utf8').split('\n').forEach((line, i) => {
        if (/(?<!function )\bpostComment\(/.test(line)) out.push({ file: relative(REPO, path), line: i + 1, text: line });
      });
    }
  }
  return out;
}

test('NEW search guard: every postComment( call under public/ is one of the named sites', () => {
  const sites = listPostCommentSites(join(REPO, 'public'));
  const perFile = {};
  for (const s of sites) perFile[s.file] = (perFile[s.file] || 0) + 1;
  assert.deepEqual(perFile, {
    'public/common.js': 4,        // deliverReply (record-only + resume), deliverRulingRecord, deliverRulingDispatch
    'public/session.js': 1,       // sendSave — a loop-box comment save, not a ruling answer
    'public/observation.js': 1,   // the Rulings tab's task-bound branch (already sends the pair)
    'public/flight-companion.js': 1, // already sends the pair
    'public/scan.js': 1           // already sends the pair
  }, 'a new postComment( call site must be named here and in the PR');
});

test('NEW search guard: each ReplyDelivery-internal call in common.js forwards the scan pair', () => {
  const sites = listPostCommentSites(join(REPO, 'public')).filter(s => s.file === 'public/common.js');
  assert.equal(sites.length, 4);
  for (const s of sites) {
    assert.match(s.text, /taskDecisionId/, `common.js:${s.line} forwards taskDecisionId`);
    assert.match(s.text, /taskDecisionIssueId/, `common.js:${s.line} forwards taskDecisionIssueId`);
  }
});
