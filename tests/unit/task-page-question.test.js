/**
 * LIN-3499 — the task page shows the question and its answer box wherever it
 * says "needs you" (LIN-4103 beat 3; LIN-4159: the word Home uses).
 *
 * Pinned here:
 *   - the card is present exactly when the owner is being asked: the pill says
 *     waiting AND the wait is on an open ruling (`model.waitingFor` 'ruling').
 *     A shelved ruling or a bare `[blocked]` reads parked, as on Home (LIN-4038),
 *     and gets no card. For the owner only; a guest and a non-owner get none;
 *   - it sits OUTSIDE `task-page-answer`, so the poll's repaint cannot wipe a
 *     half-typed answer, and the poll removes it once the state read's `questionHtml` is empty;
 *   - it is the run page's own markup (`lib/question-card.js`), and the press
 *     goes through the same `window.ReplyDelivery` entry the run page uses.
 *
 * Run with: node --test tests/unit/task-page-question.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { renderTaskPage, renderTaskStatus, renderTaskQuestion } from '../../lib/render-task-page.js';
import { loadWorld, fireDOMContentLoaded, clickOn } from './helpers/client-world.js';
import { pageWorld } from './helpers/task-page-world.js';
import { bodyOf } from './helpers/task-page-body.js';
import { buildTaskPageModel } from '../../lib/task-page-loader.js';
import { gatherTaskStates } from '../../lib/home-row-states.js';
import { pageStatusOf } from '../../lib/task-state.js';
import { enrichLoop, deriveSessionWaiting } from '../../routes/dashboard.js';
import { standingOfLoops, openQuestionRowsOf } from './helpers/question-records.js';
import { rulingStandingFromQuestions } from '../../lib/ruling-standing.js';
import { NOW, PAGE_OPTIONS, loop } from './helpers/task-page-loop.js';

const URL_KEY = 'acme';

// A worker waiting on an open ruling: the `[blocked]` line plus its structured decision.
const blocked = (over) => loop({
  loopId: 'impl-2', wakeMarker: 'blocked', waitingMessage: '[blocked] which API key?', feedback: [{ message: '[blocked] which API key?' }],
  decision: { decision_id: 'd-key', question: 'which API key?' }, ...over,
});
// A bare `[blocked]` with no structured decision: the pill says waiting, but the wait reads parked (LIN-4010).
const bareBlocked = (over) => loop({ loopId: 'impl-2', wakeMarker: 'blocked', waitingMessage: '[blocked] which API key?', feedback: [{ message: '[blocked] which API key?' }], ...over });

// LIN-4071: each model's gathered state, as the route sends it (the one gatherer over the model's own loops and ruling).
const STATES = new WeakMap();
const stateOf = (loops, { ctx = null, ruling = standingOfLoops(loops, { urlKey: URL_KEY }) }) => {
  const type = ctx?.issue?.state?.type ?? 'started';
  return gatherTaskStates({ roots: [{ issue: { identifier: 'LIN-50', state: { type } }, children: [] }], loops, ruling, at: NOW, enrichLoop, deriveSessionWaiting }).states.get('LIN-50');
};

// The page-load path (LIN-4038): the loader gives the model the workspace's question standing.
// LIN-4538: the question section reads question records (questionRecords, routes/task-page.js); the standing reads the same questions.
function model(loops, { ruling = standingOfLoops(loops, { urlKey: URL_KEY }), questionRecords = openQuestionRowsOf(loops), ...over } = {}) {
  const m = buildTaskPageModel({
    identifier: 'LIN-50', loops, ctx: null, enrichLoop, deriveSessionWaiting, ruling, now: NOW, ...over,
  });
  m.questionRecords = questionRecords;
  STATES.set(m, stateOf(loops, { ctx: over.ctx ?? null, ruling }));
  return m;
}
const render = (m, viewer = 'owner', stateUrl = '/s') => renderTaskPage(m, {
  viewer, urlKey: URL_KEY, binding: { source: 'linear' }, stateUrl, now: NOW, pageOptions: PAGE_OPTIONS, taskState: STATES.get(m) ?? null,
});
/** The page's status word and its header, from the model's gathered state. */
const statusOf = (m) => pageStatusOf(STATES.get(m));
const headerOf = (m) => renderTaskStatus(m, { now: NOW, taskState: STATES.get(m) ?? null });

describe('the card appears exactly when the owner is being asked (waiting on an open ruling)', () => {
  test('waiting: the owner gets the question and an answer box, outside task-page-answer', () => {
    const m = model([blocked()]);
    assert.equal(m.waitingFor, 'ruling');
    assert.equal(statusOf(m), 'waiting');
    const html = render(m);
    assert.match(html, /data-testid="task-page-question"/);
    assert.match(html, /data-testid="question-record-card-input"/);
    assert.match(html, /data-testid="question-record-card-answer"/);
    assert.match(html, /question-record-card-question">which API key\?</, 'the [blocked] marker is dropped, as in the pill');
    // The poll replaces the answer section's innerHTML, so the card cannot be inside it.
    const answerStart = html.indexOf('data-testid="task-page-answer"');
    const answerEnd = html.indexOf('</section>', answerStart);
    assert.ok(html.indexOf('data-testid="task-page-question"') > answerEnd, 'after the answer section closes');
    assert.doesNotMatch(html.slice(answerStart, answerEnd), /question-record-card/);
    assert.ok(html.indexOf('data-testid="task-page-question"') < html.indexOf('data-testid="task-page-track-mount"'), 'right under the pill');
  });

  test('an open question renders with its options, dismiss and "if you don\'t answer" (LIN-4538: the record is the card)', () => {
    const q = { questionId: 'q1', asks: 'Which API?', options: ['v1', 'v2'], recommended: 'v1', ifUnanswered: 'v1 ships.', taskId: 'task-LIN-50', ticket: 'LIN-50', runId: 'impl-2', askedAt: '2026-10-30T10:05:00.000Z', state: 'gone', reason: 'no-session', interactive: true };
    const m = model([blocked()], { questionRecords: [q] });
    const html = render(m);
    assert.match(html, /question-record-card-question">Which API\?</);
    assert.match(html, /data-question-id="q1"/);
    assert.equal((html.match(/data-testid="question-record-card-option"/g) || []).length, 2);
    assert.match(html, /data-testid="question-record-card-dismiss"/);
    assert.match(html, /if you don't answer: v1 ships\./);
  });

  test('running, idle and done with no open question: no card, whatever the viewer', () => {
    for (const m of [model([loop()]), model([]), model([loop({ terminalStatus: 'done', terminalCompletedAt: '2026-10-06T11:00:00.000Z' })])]) {
      assert.notEqual(statusOf(m), 'waiting');
      assert.doesNotMatch(render(m), /task-page-question|question-record-card/);
    }
  });

  test('a finished tracker with a loop still [blocked]: the live wait outranks the finished word (LIN-4071 D2), so the owner is asked', () => {
    const ctx = { issue: { identifier: 'LIN-50', title: 'T', state: { name: 'Done', type: 'completed' }, comments: [] }, stateTransitions: [] };
    const m = model([blocked()], { ctx });
    assert.equal(STATES.get(m).state, 'needs-you', 'the gathered state is the wait, not done');
    assert.equal(statusOf(m), 'waiting');
    assert.match(render(m, 'owner'), /data-testid="task-page-question"/);
  });

  test('"ready to merge" is also a waiting pill but has no question: no card, no empty section', () => {
    const m = model([loop({ terminalStatus: 'done', terminalCompletedAt: '2026-10-06T11:00:00.000Z', agentState: 'done' })], {
      evidence: { state: { status: 'ready', pr: { number: 41 } }, evidence: null, ledger: null, closeOut: { owner: true, status: 'ready', pr: { number: 41 } } },
    });
    assert.ok(m.readyHeader, 'the ready header is set');
    assert.equal(m.question, null);
    assert.doesNotMatch(render(m), /task-page-question/);
  });

  test('a question whose run is still working renders read-only: no input (LIN-4538)', () => {
    const q = { questionId: 'q1', asks: 'Which API?', options: ['v1', 'v2'], recommended: 'v1', ifUnanswered: null, taskId: 'task-LIN-50', ticket: 'LIN-50', runId: 'impl-2', askedAt: '2026-10-30T10:05:00.000Z', state: 'mid-turn', reason: null, interactive: false };
    const html = render(model([blocked()], { questionRecords: [q] }));
    assert.match(html, /data-testid="question-record-card-readonly"/);
    assert.doesNotMatch(html, /question-record-card-input|question-record-card-answer/);
  });

});

describe('a parked wait is not a question on the task page, as on Home (LIN-4038)', () => {
  test('an answered question: the standing reads parked, the pill says waiting, and no card renders even to the owner (LIN-4538)', () => {
    const loops = [blocked()];
    const m = model(loops, { ruling: rulingStandingFromQuestions({ urlKey: URL_KEY, loops, facts: [] }), questionRecords: [] });
    assert.equal(statusOf(m), 'waiting', 'the pill still says waiting');
    assert.equal(m.waitingFor, 'parked');
    const html = render(m, 'owner');
    assert.doesNotMatch(html, /task-page-question|question-record-card/);
    assert.match(headerOf(m), /status-pill--queued/, 'the pill is in the queued tone, as Home\'s parked');
    assert.match(headerOf(m), />parked</);
    assert.match(headerOf(m), /data-status="waiting"/, 'data-status stays waiting: the client and Go key on it');
  });

  test('an open ruling still renders the card', () => {
    const m = model([blocked()]);
    assert.equal(m.waitingFor, 'ruling');
    assert.match(render(m, 'owner'), /data-testid="task-page-question"/);
    assert.match(headerOf(m), /status-pill--needs-you/);
    assert.match(headerOf(m), />needs you</);
  });


  test('a bare [blocked] with no structured decision reads parked and renders no card', () => {
    const m = model([bareBlocked()]);
    assert.equal(statusOf(m), 'waiting');
    assert.equal(m.waitingFor, 'parked');
    assert.doesNotMatch(render(m, 'owner'), /task-page-question|question-record-card/);
    assert.match(headerOf(m), /status-pill--queued/);
    assert.match(headerOf(m), />parked</);
  });
});

describe('only the owner sees controls (hidden, not disabled)', () => {
  test('a guest gets no card and no question markup at all', () => {
    const html = render(model([blocked()]), 'guest');
    assert.doesNotMatch(html, /task-page-question|question-record-card|sess-qcard/);
    assert.match(html, /data-testid="task-page-status-pill"/, 'the pill is still there');
  });

  test('the card is in the owner fragment only: renderOwnerControls is the one viewer read', () => {
    const owner = render(model([blocked()]), 'owner');
    const guest = render(model([blocked()]), 'guest');
    assert.ok(owner.length > guest.length);
    assert.equal((owner.match(/data-testid="task-page-question"/g) || []).length, 1);
  });

  test('the pill\'s sentence is unchanged', () => {
    assert.match(renderTaskStatus(model([blocked()])), /task-sentence" data-testid="task-page-sentence">which API key\?</);
  });
});

// ── client ────────────────────────────────────────────────────────────────────
// The card and the poll run on the server's own markup (`renderTaskPage`, `renderTaskQuestion`) in a client world.
// The poll's replies are the state route's fields, built from the same renderers the route calls.
const STATE_URL = '/workspace/acme/api/task/LIN-50/state';
const settle = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

/** The waiting task: an open ruling with two options, so the card has an option button (LIN-4114). */
const ASKED = () => model([blocked({ decision: { decision_id: 'd1', question: 'Which API?', options: [{ id: 'a', label: 'Ship it' }, { id: 'b', label: 'Wait for review' }] } })]);
const RUNNING = () => model([loop()]);
const PARKED = () => model([bareBlocked()]);

/**
 * The state read's reply for model `m`, as `routes/task-page.js` sends it: the header from `renderTaskStatus`, and the card
 * from `renderTaskQuestion` (LIN-4024), which is '' when the viewer is not the owner or the wait is not an open ruling.
 * `asked: false` is the reply a shelved or parked wait gets.
 */
const replyFor = (m, { asked = true } = {}) => ({
  status: statusOf(m),
  live: statusOf(m) === 'running',
  headerHtml: headerOf(m),
  questionHtml: asked ? renderTaskQuestion(m, { urlKey: URL_KEY, binding: { source: 'linear' } }) : '',
});

/**
 * The task page as the server draws it, with the real `public/task-page.js` imported as a module over the fake DOM
 * (LIN-4472). `m` is the model it is drawn from; `owner: false` draws the guest page. The page loads (DOMContentLoaded),
 * then `pollOnce` runs one poll with the next of `polls`. `QuestionCards` is a stub: the poll does not reach the card's
 * own script.
 */
async function makePage(t, { m, owner = true, polls = [] }) {
  const timers = [];
  const reloads = [];
  const inits = [];
  const queue = [...polls];
  const { document: doc } = await pageWorld(t, {
    timers,
    window: {
      QuestionCards: { initQuestionCards: () => inits.push(1) },
      api: async (url) => { if (url === STATE_URL) return queue.shift(); throw new Error('unexpected ' + url); },
    },
  });
  doc.body.innerHTML = bodyOf(render(m, owner ? 'owner' : 'guest', STATE_URL));
  doc.defaultView = { location: { reload: () => reloads.push(1) } };
  await fireDOMContentLoaded(doc);
  const card = doc.querySelector('[data-testid="task-page-question"]');
  return {
    card,
    timers,
    reloads,
    inits,
    textarea: card ? card.querySelector('textarea') : null,
    optionBtn: card ? card.querySelector('[data-testid="question-record-card-option"]') : null,
    wasRemoved: () => doc.querySelector('[data-testid="task-page-question"]') === null,
    cardNode: () => doc.querySelector('[data-testid="task-page-question"]'),
    async pollOnce() { timers.shift().fn(); await settle(); },
  };
}

describe('the poll leaves a half-typed answer alone and removes the card when the wait ends', () => {
  test('init captures the card once, before any poll', async (t) => {
    const page = await makePage(t, { m: ASKED() });
    assert.equal(page.inits.length, 1);
  });

  test('a poll that still says waiting repaints the header but keeps the card and the typed text', async (t) => {
    const page = await makePage(t, { m: ASKED(), polls: [replyFor(ASKED())] });
    page.textarea.value = 'half a typed answer';
    await page.pollOnce();
    assert.equal(page.wasRemoved(), false, 'the card stays');
    assert.equal(page.cardNode(), page.card, 'the very same card node, not a re-render');
    assert.equal(page.card.querySelector('textarea'), page.textarea, 'the same textarea object');
    assert.equal(page.textarea.value, 'half a typed answer', 'the typed text survives the poll');
    assert.equal(page.card.querySelector('[data-testid="question-record-card-option"]'), page.optionBtn, 'the same option button, not a re-render');
    assert.equal(page.optionBtn.disabled, false, 'the option buttons are still live after the poll');
    assert.equal(page.reloads.length, 0);
  });

  test('a poll that finds the task no longer waiting removes the card', async (t) => {
    const page = await makePage(t, { m: ASKED(), polls: [replyFor(RUNNING())] });
    await page.pollOnce();
    assert.equal(page.wasRemoved(), true);
  });

  test('a poll that says waiting with no question (questionHtml "") removes the card and does not reload (LIN-4038)', async (t) => {
    // Shelving the ruling while the page is open: the status is still waiting, but the server says no question.
    const page = await makePage(t, { m: ASKED(), polls: [replyFor(ASKED(), { asked: false })] });
    await page.pollOnce();
    assert.equal(page.wasRemoved(), true, 'the card goes');
    assert.equal(page.reloads.length, 0, 'no reload for a card that should not be there');
  });

  test('a waiting-but-parked poll on a page with no card does not reload (LIN-4038)', async (t) => {
    const page = await makePage(t, { m: RUNNING(), polls: [replyFor(PARKED(), { asked: false })] });
    await page.pollOnce();
    assert.equal(page.reloads.length, 0);
  });

  test('an owner page that becomes asked reloads once to fetch the card; a page with no owner marker does not', async (t) => {
    const own = await makePage(t, { m: RUNNING(), polls: [replyFor(ASKED())] });
    await own.pollOnce();
    assert.equal(own.reloads.length, 1);
    const guest = await makePage(t, { m: RUNNING(), owner: false, polls: [replyFor(ASKED())] });
    await guest.pollOnce();
    assert.equal(guest.reloads.length, 0);
  });
});


describe('a joined ruling row on the task page (LIN-3959)', () => {
});
