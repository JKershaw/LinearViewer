/**
 * LIN-4140 — the shared question card answers and dismisses a scan-raised
 * (task-bound) ruling, and loop-backed cards stay byte-for-byte unchanged.
 *
 * Beat 1 (witnesses first): the `LOOP-BACKED` and `GUARD` tests pin today's
 * behaviour and must keep passing; the `NEW` tests describe the behaviour to
 * build and are expected to FAIL against the unmodified code.
 *
 * The card client runs for real: public/common.js (ReplyDelivery) and
 * public/question-cards.js load into one `loadWorld` (the shared fake DOM,
 * tests/unit/helpers/fake-dom.js) with a stubbed `fetch`, and the card's DOM is
 * the REAL `renderDecisionCard` markup parsed into the page, so the
 * markup→client contract is what is under test. The page has no `CustomEvent`,
 * so `announceRulingGone` exits before its bubbling `dispatchEvent` (LIN-4309).
 *
 * Run with: node --test tests/unit/question-card-task-bound.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { harnessModelsBlock } from '../../lib/model-routing-harnesses.js';
import { renderDecisionCard } from '../../lib/question-card.js';
import {
  LOOP_BACKED_ROWS, RENDER_OPTS, TASK_BOUND_ROW, TASK_DECISION_ID, TASK_ISSUE_UUID
} from '../fixtures/question-card-rows.js';
import { clickOn, loadWorld } from './helpers/client-world.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '../..');
const GOLDEN = JSON.parse(readFileSync(join(__dirname, '../fixtures/question-card-loop-golden.json'), 'utf8'));

const OPEN_TASK = { hydrated: true, state: { name: 'In Progress', type: 'started' } };
const NOOP_HANDLERS = {
  onCommentFailed() {}, onDispatchFailed() {}, onPartialFailure() {}, onDispatchOk() {}, onNoTarget() {}, onNoLinkedIssue() {}
};

// ── helpers ────────────────────────────────────────────────────────────────

async function flush() { for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r)); }

/**
 * A world with the REAL common.js and question-cards.js. Only the network seams are stubbed: `fetch` (recorded),
 * `window.api` (the hydrate), and `window.dispatchPrompt` (the fresh-run starter). common.js defines `api` and
 * `dispatchPrompt` as it loads, so the stubs are set after it, as the page's own script order left them.
 * `timers` collects the client's timeouts instead of running them, so a restore never fires mid-test.
 */
function makeWorld({ hydrate = OPEN_TASK, commentOk = true, dismissOk = true } = {}) {
  const calls = [];
  const dispatched = [];
  const world = loadWorld({
    window: {
      __HARNESS_MODELS__: harnessModelsBlock(),
      ChatUI: { appendMessage() {} },
      fetch(url, opts) {
        const body = opts && opts.body ? JSON.parse(opts.body) : undefined;
        calls.push({ url: String(url), opts, body });
        let ok = true;
        if (/\/api\/comments\//.test(String(url))) ok = commentOk;
        if (/\/api\/scan\/|\/rulings\/dismiss/.test(String(url))) ok = dismissOk;
        return Promise.resolve({ ok, status: ok ? 200 : 500, json: () => Promise.resolve(ok ? { success: true } : { error: 'boom' }) });
      }
    },
    scripts: ['common.js', 'question-cards.js'],
    timers: [],
  });
  world.window.api = async () => hydrate;
  world.window.dispatchPrompt = async (o) => { dispatched.push(o); return { id: 'run-1' }; };
  const commentCalls = () => calls.filter(c => /\/api\/comments\//.test(c.url));
  const runStarts = () => calls.filter(c => /\/api\/dispatch/.test(c.url)).length + dispatched.length;
  return { world, calls, commentCalls, runStarts };
}

/**
 * Parses the rendered card into the page and returns its controls. The controls are the real nodes the client looks up;
 * `typed` sets the textarea's value, which the markup does not carry.
 */
function mountCard(world, html, { typed = '' } = {}) {
  world.document.body.innerHTML = html;
  const card = world.document.querySelector('[data-testid="session-question-card"]');
  assert.ok(card, 'the rendered card is on the page');
  const btn = card.querySelector('[data-testid="session-question-card-answer"]');
  const textarea = card.querySelector('[data-testid="session-question-card-input"]');
  textarea.value = typed;
  const feedback = card.querySelector('.sess-qcard-feedback');
  const dismissBtn = card.querySelector('[data-testid="session-question-card-dismiss"]');
  const optionBtn = (id) => {
    const b = card.querySelector(`[data-testid="session-question-card-option"][data-option-id="${id}"]`);
    assert.ok(b, `option ${id} is rendered`);
    return b;
  };
  return { card, btn, textarea, feedback, dismissBtn, optionBtn };
}

/** A world with `html` mounted and the card bound, as the page's own init binds it. */
function answerable(html, { typed = '', ...opts } = {}) {
  const h = makeWorld(opts);
  const f = mountCard(h.world, html, { typed });
  h.world.window.QuestionCards.initQuestionCards();
  return { ...h, ...f };
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
  const f = answerable(renderDecisionCard(structuredClone(LOOP_BACKED_ROWS['loop-with-options']), RENDER_OPTS), { typed: '' });
  await clickOn(f.optionBtn('opt-a'));
  await flush();
  const [comment] = f.commentCalls();
  assert.ok(comment, 'the answer writes its comment');
  assert.equal(comment.body.optionId, 'opt-a', 'the loop-backed body keeps optionId');
  assert.equal('taskDecisionId' in comment.body, false);
  assert.equal('taskDecisionIssueId' in comment.body, false);
});

test('GUARD client: a loop-backed dismiss still hits the rulings dismiss route first, with the loop stamp', async () => {
  const f = answerable(renderDecisionCard(structuredClone(LOOP_BACKED_ROWS['loop-with-options']), RENDER_OPTS));
  await clickOn(f.dismissBtn);
  await flush();
  assert.equal(f.calls[0].url, '/workspace/w/api/dashboard/rulings/dismiss');
  assert.deepEqual(f.calls[0].body, { decisionLoopId: 'lp-1', decisionId: 'd-opts' });
});

// ── NEW: the markup carries the scan decision id ───────────────────────────

test('NEW markup: a task-bound row with a scan id and an issue UUID emits data-task-decision-id', () => {
  const html = taskBoundMarkup();
  assert.match(html, new RegExp(`data-task-decision-id="${TASK_DECISION_ID}"`));
});

// ── NEW: comment writes forward the scan pair (real ReplyDelivery) ──────────

test('NEW client: a task-bound free-text answer writes the comment with the scan pair and no optionId', async () => {
  const f = answerable(taskBoundMarkup(), { typed: 'my answer' });
  await clickOn(f.btn);
  await flush();
  const [comment] = f.commentCalls();
  assert.ok(comment, 'the answer writes its comment');
  assert.equal(comment.body.taskDecisionId, TASK_DECISION_ID);
  assert.equal(comment.body.taskDecisionIssueId, TASK_ISSUE_UUID);
  assert.equal('optionId' in comment.body, false);
  assert.equal('decisionLoopId' in comment.body, false, 'no loop stamp on a scan row');
});

test('NEW client: a task-bound option press drops the chosen option id from the body', async () => {
  const f = answerable(taskBoundMarkup(), { typed: '' });
  await clickOn(f.optionBtn('opt-a'));
  await flush();
  const [comment] = f.commentCalls();
  assert.ok(comment, 'the press writes its comment');
  assert.equal(comment.body.taskDecisionId, TASK_DECISION_ID, 'the scan pair is forwarded');
  assert.equal('optionId' in comment.body, false, 'the body matches the Rulings tab: no optionId');
  assert.equal(comment.body.body, 'Yes, ship it');
});

test('NEW client: a task-bound row that declares dispatch is delivered as record — no run, "recorded on the task"', async () => {
  const f = answerable(taskBoundMarkup({ effect: 'dispatch', declaredEffect: 'dispatch' }), { typed: 'go ahead' });
  await clickOn(f.btn);
  await flush();
  assert.equal(f.runStarts(), 0, 'no fresh run is started for a scan row, even when an older row declares dispatch');
  assert.equal(f.commentCalls().length, 1, 'the answer is recorded');
  assert.equal(f.commentCalls()[0].body.taskDecisionId, TASK_DECISION_ID);
  assert.match(f.feedback.textContent, /recorded on the task/);
});

test('NEW client: a task-bound row that declares resume is also delivered as record — no follow-up dispatch', async () => {
  const f = answerable(taskBoundMarkup({ effect: 'resume', declaredEffect: 'resume' }), { typed: 'go ahead' });
  await clickOn(f.btn);
  await flush();
  assert.equal(f.runStarts(), 0, 'no resume follow-up for a scan row');
  assert.equal(f.commentCalls()[0].body.taskDecisionId, TASK_DECISION_ID);
});

test('NEW write site (deliverReply, resume branch): forwards the scan pair', async () => {
  const h = makeWorld();
  await h.world.window.ReplyDelivery.deliverReply({
    urlKey: 'w', issueId: TASK_ISSUE_UUID, followUpTo: 'lp-1', target: 'cli', source: 'github',
    taskDecisionId: TASK_DECISION_ID, taskDecisionIssueId: TASK_ISSUE_UUID
  }, 'my answer', noopHandlers());
  const [comment] = h.commentCalls();
  assert.ok(comment, 'the comment is written');
  assert.equal(comment.body.taskDecisionId, TASK_DECISION_ID);
  assert.equal(comment.body.taskDecisionIssueId, TASK_ISSUE_UUID);
});

test('NEW write site (deliverReply, recordOnly branch): forwards the scan pair and starts no run', async () => {
  const h = makeWorld();
  await h.world.window.ReplyDelivery.deliverReply({
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
  const h = makeWorld();
  await h.world.window.ReplyDelivery.deliverRulingRecord({
    urlKey: 'w', issueId: TASK_ISSUE_UUID, issueIdentifier: 'LIN-7', source: 'github', prompt: 'my answer',
    taskDecisionId: TASK_DECISION_ID, taskDecisionIssueId: TASK_ISSUE_UUID
  }, noopHandlers());
  const [comment] = h.commentCalls();
  assert.ok(comment, 'the comment is written');
  assert.equal(comment.body.taskDecisionId, TASK_DECISION_ID);
  assert.equal(comment.body.taskDecisionIssueId, TASK_ISSUE_UUID);
});

test('NEW write site (deliverRulingDispatch, the defensive downgrade/dispatch path): forwards the scan pair', async () => {
  const h = makeWorld();
  await h.world.window.ReplyDelivery.deliverRulingDispatch({
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
  const h = makeWorld();
  await h.world.window.ReplyDelivery.postComment('w', TASK_ISSUE_UUID, prompt, {
    taskDecisionId: TASK_DECISION_ID, taskDecisionIssueId: TASK_ISSUE_UUID, source: 'github'
  });
  const [comment] = h.commentCalls();
  return { url: comment.url, body: comment.body };
}

test('NEW differential: a task-bound free-text answer sends the same comment request as the Rulings tab', async () => {
  const tab = await rulingsTabCommentFor('my answer');
  const f = answerable(taskBoundMarkup(), { typed: 'my answer' });
  await clickOn(f.btn);
  await flush();
  const [comment] = f.commentCalls();
  assert.ok(comment, 'the card writes its comment');
  assert.equal(comment.url, tab.url);
  assert.deepEqual(withoutAttemptId(comment.body), tab.body);
});

test('NEW differential: a task-bound option press sends the same comment request as the Rulings tab', async () => {
  const tab = await rulingsTabCommentFor('Yes, ship it');
  const f = answerable(taskBoundMarkup(), { typed: '' });
  await clickOn(f.optionBtn('opt-a'));
  await flush();
  const [comment] = f.commentCalls();
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
  // The markup blanks record_on on a scan row (lib/question-card.js), so the card below is given one, as a stale or forged
  // card would carry it: the client's own guard (deliverRulingRecord) is what must keep the comment on the anchor. The card
  // reads data-record-on when it binds, so the attribute is set before initQuestionCards runs.
  const h = makeWorld({ hydrate: neighbourhood });
  const f = mountCard(h.world, renderDecisionCard(structuredClone(row), RENDER_OPTS), { typed: 'my answer' });
  f.card.dataset.recordOn = 'LIN-9';
  h.world.window.QuestionCards.initQuestionCards();
  await clickOn(f.btn);
  await flush();
  const [comment] = h.commentCalls();
  assert.ok(comment, 'the card writes its comment');
  assert.equal(comment.url, tab.url, 'the comment lands on the anchor, not on LIN-9');
  assert.deepEqual(withoutAttemptId(comment.body), tab.body);
});

// ── NEW: dismissal of a scan row goes to the scan route ─────────────────────

test('NEW dismiss: a task-bound dismiss makes exactly one request, to the scan dismiss route by issue UUID with the source, body {id}', async () => {
  const f = answerable(taskBoundMarkup());
  await clickOn(f.dismissBtn);
  await flush();
  assert.equal(f.calls.length, 1, 'one request — no rulings dismiss, no follow-up');
  assert.equal(f.calls[0].url, `/workspace/w/api/scan/${TASK_ISSUE_UUID}/dismiss?source=github`);
  assert.deepEqual(f.calls[0].body, { id: TASK_DECISION_ID });
  assert.equal(f.runStarts(), 0);
  assert.equal(f.card.isConnected, false, 'the card is removed on success');
});

test('NEW dismiss: a failed scan dismiss leaves the card in place, re-enables its buttons and says so', async () => {
  const f = answerable(taskBoundMarkup(), { dismissOk: false });
  await clickOn(f.dismissBtn);
  await flush();
  assert.equal(f.calls[0].url, `/workspace/w/api/scan/${TASK_ISSUE_UUID}/dismiss?source=github`);
  assert.equal(f.card.isConnected, true, 'the card stays');
  assert.equal(f.dismissBtn.disabled, false);
  assert.equal(f.btn.disabled, false);
  assert.match(f.feedback.textContent, /dismiss failed/);
});

test('NEW dismiss: a task-bound dismiss sends no follow-up even when the disposition reads resumable', async () => {
  const f = answerable(taskBoundMarkup());
  f.card.dataset.disposition = 'resumable';
  await clickOn(f.dismissBtn);
  await flush();
  assert.equal(f.calls.length, 1, 'the scan dismiss is the only request');
  assert.equal(f.runStarts(), 0, 'no run is started for a scan row');
});

// ── NEW: the delivered-effect rule ─────────────────────────────────────────

test('NEW effect: deliveredEffect returns record for a card carrying a scan decision id, whatever it declares', () => {
  const h = makeWorld();
  const { deliveredEffect } = h.world.window.ReplyDelivery;
  const scan = { taskDecisionId: TASK_DECISION_ID, taskDecisionIssueId: TASK_ISSUE_UUID };
  assert.equal(deliveredEffect({ ...scan, effect: 'dispatch' }), 'record');
  assert.equal(deliveredEffect({ ...scan, effect: 'resume', disposition: 'resumable' }), 'record');
});

test('GUARD effect: deliveredEffect leaves a loop-backed dispatch declared as dispatch', () => {
  const h = makeWorld();
  assert.equal(h.world.window.ReplyDelivery.deliveredEffect({ effect: 'dispatch' }), 'dispatch');
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
