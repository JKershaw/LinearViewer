/**
 * LIN-3499 — the task page shows the question and its answer box wherever it
 * says "waiting for an answer".
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
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderTaskPage, renderTaskStatus } from '../../lib/render-task-page.js';
import { buildTaskPageModel } from '../../lib/task-page-loader.js';
import { rulingStandingOf } from '../../lib/unanswered-decisions.js';
import { enrichLoop, deriveSessionWaiting, deriveSessionDecisions } from '../../routes/dashboard.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const NOW = new Date('2026-10-06T15:00:00.000Z');
const URL_KEY = 'acme';
const UUID = '11111111-2222-3333-4444-555555555555';
const PAGE_OPTIONS = { deployInfo: { version: 't', commit: 't' }, featureFlags: {}, workspaces: [] };

function loop(over = {}) {
  return {
    loopId: 'loop-x', issueIdentifier: 'LIN-50', issueId: UUID, issueTitle: 'T', kind: 'implementation', iteration: 1,
    source: 'history', historyStatus: 'taken', agentState: 'running', target: 'cli',
    dispatchedAt: '2026-10-06T10:00:00.000Z', takenAt: '2026-10-06T10:01:00.000Z', resolvedAt: '2026-10-06T10:01:00.000Z',
    terminalStatus: null, terminalCompletedAt: null, wakeMarker: null, waitingMessage: null, feedback: [],
    telemetry: { runtime: { ms: 1 }, metrics: [], producedArtifacts: [] }, followUpTo: null,
    ...over,
  };
}
// A worker waiting on an open ruling: the `[blocked]` line plus its structured decision.
const blocked = (over) => loop({
  loopId: 'impl-2', wakeMarker: 'blocked', waitingMessage: '[blocked] which API key?', feedback: [{ message: '[blocked] which API key?' }],
  decision: { decision_id: 'd-key', question: 'which API key?' }, ...over,
});
// A bare `[blocked]` with no structured decision: the pill says waiting, but the wait reads parked (LIN-4010).
const bareBlocked = (over) => loop({ loopId: 'impl-2', wakeMarker: 'blocked', waitingMessage: '[blocked] which API key?', feedback: [{ message: '[blocked] which API key?' }], ...over });

// The page-load path (LIN-4038): the loader gives the model the workspace's `rulingStandingOf`, so shelves count.
function model(loops, { shelvedRulings = [], ...over } = {}) {
  const ruling = rulingStandingOf({ urlKey: URL_KEY, loops, shelvedRulings }, { now: NOW, enrichLoop });
  return buildTaskPageModel({
    identifier: 'LIN-50', loops, ctx: null, enrichLoop, deriveSessionWaiting, deriveSessionDecisions, ruling, now: NOW, ...over,
  });
}
const render = (m, viewer = 'owner') => renderTaskPage(m, {
  viewer, urlKey: URL_KEY, binding: { source: 'linear' }, stateUrl: '/s', now: NOW, pageOptions: PAGE_OPTIONS,
});

describe('the card appears exactly when the owner is being asked (waiting on an open ruling)', () => {
  test('waiting: the owner gets the question and an answer box, outside task-page-answer', () => {
    const m = model([blocked()]);
    assert.equal(m.waitingFor, 'ruling');
    assert.equal(m.status, 'waiting');
    const html = render(m);
    assert.match(html, /data-testid="task-page-question"/);
    assert.match(html, /data-testid="session-question-card-input"/);
    assert.match(html, /data-testid="session-question-card-answer"/);
    assert.match(html, /data-loop-id="impl-2"/, 'the reply target is the waiting loop');
    assert.match(html, /data-session-waiting="true"/);
    assert.match(html, /session-question-card-question">which API key\?</, 'the [blocked] marker is dropped, as in the pill');
    // The poll replaces the answer section's innerHTML, so the card cannot be inside it.
    const answerStart = html.indexOf('data-testid="task-page-answer"');
    const answerEnd = html.indexOf('</section>', answerStart);
    assert.ok(html.indexOf('data-testid="task-page-question"') > answerEnd, 'after the answer section closes');
    assert.doesNotMatch(html.slice(answerStart, answerEnd), /session-question-card/);
    assert.ok(html.indexOf('data-testid="task-page-question"') < html.indexOf('data-testid="task-page-track-mount"'), 'right under the pill');
  });

  test('a decision on the waiting loop renders with its options, dismiss and "if you don\'t answer"', () => {
    const decision = { decision_id: 'd1', question: 'Which API?', options: [{ id: 'a', label: 'v1' }, { id: 'b', label: 'v2' }], if_unanswered: { summary: 'v1 ships.' } };
    const m = model([blocked({ decision, decisionCase: ['because of the old client'] })]);
    const html = render(m);
    assert.match(html, /session-question-card-question">Which API\?</);
    assert.match(html, /data-decision-id="d1"/);
    assert.equal((html.match(/data-testid="session-question-card-option"/g) || []).length, 2);
    assert.match(html, /data-testid="session-question-card-dismiss"/);
    assert.match(html, /because of the old client/);
    assert.match(html, /if you don't answer: v1 ships\./);
  });

  test('running, idle and done: no card, whatever the viewer', () => {
    for (const m of [model([loop()]), model([]), model([blocked({ terminalStatus: 'done', terminalCompletedAt: '2026-10-06T11:00:00.000Z' })])]) {
      assert.notEqual(m.status, 'waiting');
      assert.doesNotMatch(render(m), /task-page-question|session-question-card/);
    }
  });

  test('a finished tracker with a loop still [blocked]: the pill says done, so no card (the gate is model.status)', () => {
    const ctx = { issue: { identifier: 'LIN-50', title: 'T', state: { name: 'Done', type: 'completed' }, comments: [] }, stateTransitions: [] };
    const m = model([blocked()], { ctx });
    assert.equal(m.status, 'done');
    assert.equal(m.question, null);
    assert.doesNotMatch(render(m, 'owner'), /task-page-question|session-question-card/);
  });

  test('"ready to merge" is also a waiting pill but has no question: no card, no empty section', () => {
    const m = model([loop({ terminalStatus: 'done', terminalCompletedAt: '2026-10-06T11:00:00.000Z', agentState: 'done' })], {
      evidence: { state: { status: 'ready', pr: { number: 41 } }, evidence: null, ledger: null, closeOut: { owner: true, status: 'ready', pr: { number: 41 } } },
    });
    assert.equal(m.status, 'waiting');
    assert.equal(m.question, null);
    assert.doesNotMatch(render(m), /task-page-question/);
  });

  test('a loop on a non-session target (dash) renders the read-only form, no input', () => {
    const html = render(model([blocked({ target: 'dash' })]));
    assert.match(html, /data-testid="session-question-card-readonly"/);
    assert.doesNotMatch(html, /session-question-card-input|session-question-card-answer/);
  });

  test('an older unanswered decision on a finished loop does not surface on a waiting page', () => {
    const old = loop({ loopId: 'old', kind: 'plan', terminalStatus: 'done', terminalCompletedAt: '2026-10-06T09:00:00.000Z', agentState: 'done', decision: { decision_id: 'dold', question: 'Stale?' } });
    const html = render(model([old, blocked()]));
    assert.doesNotMatch(html, /Stale\?/);
    assert.match(html, /which API key\?/);
  });
});

describe('a parked wait is not a question on the task page, as on Home (LIN-4038)', () => {
  const SHELF = (resurfaceAt) => [{ urlKey: URL_KEY, decisionId: 'd-key', resurfaceAt, lapseCount: 1 }];

  test('a shelved ruling, built through the real model path, renders no question card even to the owner', () => {
    const m = model([blocked()], { shelvedRulings: SHELF('2026-10-07T15:00:00.000Z') });
    assert.equal(m.status, 'waiting', 'the pill still says waiting');
    assert.equal(m.waitingFor, 'parked');
    const html = render(m, 'owner');
    assert.doesNotMatch(html, /task-page-question|session-question-card/);
    assert.match(renderTaskStatus(m), /which API key\?/, 'the pill sentence is still shown');
    const header = renderTaskStatus(m);
    assert.match(header, /status-pill--queued/, 'the pill is in the queued tone, as Home\'s parked');
    assert.match(header, />parked</);
    assert.doesNotMatch(header, /status-pill--needs-you/);
    assert.match(header, /data-status="waiting"/, 'data-status stays waiting: the client and Go key on it');
    assert.match(render(m, 'owner'), /Nothing comes next while it is parked\./, 'no card above, so the next line does not point at one');
    assert.doesNotMatch(render(m, 'owner'), /question above/);
  });

  test('an open ruling still renders the card', () => {
    const m = model([blocked()]);
    assert.equal(m.waitingFor, 'ruling');
    assert.match(render(m, 'owner'), /data-testid="task-page-question"/);
    assert.match(renderTaskStatus(m), /status-pill--needs-you/);
    assert.match(renderTaskStatus(m), />waiting</);
  });

  test('a shelf that has lapsed (resurfaceAt passed) makes the ruling open again, and the card returns', () => {
    const m = model([blocked()], { shelvedRulings: SHELF('2026-10-05T15:00:00.000Z') });
    assert.equal(m.waitingFor, 'ruling');
    assert.match(render(m, 'owner'), /data-testid="task-page-question"/);
  });

  test('a bare [blocked] with no structured decision reads parked and renders no card', () => {
    const m = model([bareBlocked()]);
    assert.equal(m.status, 'waiting');
    assert.equal(m.waitingFor, 'parked');
    assert.doesNotMatch(render(m, 'owner'), /task-page-question|session-question-card/);
    assert.match(renderTaskStatus(m), /status-pill--queued/);
    assert.match(renderTaskStatus(m), />parked</);
  });
});

describe('only the owner sees controls (hidden, not disabled)', () => {
  test('a guest gets no card and no question markup at all', () => {
    const html = render(model([blocked()]), 'guest');
    assert.doesNotMatch(html, /task-page-question|session-question-card|sess-qcard/);
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
const TASK_PAGE_SRC = readFileSync(join(__dirname, '../../public/task-page.js'), 'utf8');

describe('the poll leaves a half-typed answer alone and removes the card when the wait ends', () => {
  const STATE_URL = '/workspace/acme/api/task/LIN-50/state';
  const statusHtml = (status) => `<div class="task-status" data-testid="task-page-status" data-status="${status}"><p>x</p></div>`;
  // The state read carries the card as `questionHtml` (LIN-4038): non-empty while the owner is being asked, '' otherwise.
  const QUESTION_HTML = '<section data-testid="task-page-question"><p>which API key?</p></section>';

  function makePage({ withCard = true, owner = true, loadStatus = 'waiting', polls }) {
    const attrs = { 'data-state-url': STATE_URL, 'data-status': loadStatus, 'data-live': 'false', 'data-merge-ready': 'false' };
    const main = { getAttribute: (k) => (k in attrs ? attrs[k] : null), setAttribute: (k, v) => { attrs[k] = v; }, querySelector: () => null, querySelectorAll: () => [] };
    const answer = {
      innerHTML: statusHtml(loadStatus),
      querySelector(sel) {
        if (sel !== '[data-testid="task-page-status"]') return null;
        const m = /data-status="([^"]*)"/.exec(this.innerHTML);
        return m ? { getAttribute: () => m[1] } : null;
      },
    };
    // The typed text and the picked option live on controls the CARD owns, so
    // only a repaint of the card (or an ancestor) could wipe them.
    const textarea = { value: 'half a typed answer' };
    const radio = { checked: true, value: 'b' };
    let removed = false;
    const card = {
      parentNode: { removeChild() { removed = true; } },
      querySelector: (sel) => (sel === 'textarea' ? textarea : sel === 'input[type="radio"]:checked' ? (radio.checked ? radio : null) : null),
    };
    const reloads = [];
    const timers = [];
    let onReady = null;
    const doc = {
      hidden: false,
      defaultView: { location: { reload: () => reloads.push(1) } },
      querySelector: (sel) => {
        if (sel === '[data-testid="task-page"][data-state-url]') return main;
        if (sel === '[data-testid="task-page-answer"]') return answer;
        if (sel === '[data-testid="task-page-question"]') return withCard && !removed ? card : null;
        if (sel === '[data-testid="task-page-owner-widgets"]') return owner ? {} : null;
        return null;
      },
      querySelectorAll: () => [],
      addEventListener: (type, fn) => { if (type === 'DOMContentLoaded') onReady = fn; },
    };
    const queue = [...polls];
    const inits = [];
    const window = {
      addEventListener() {},
      QuestionCards: { initQuestionCards: () => inits.push(1) },
      api: async (url) => { if (url === STATE_URL) return queue.shift(); throw new Error('unexpected ' + url); },
    };
    const ctx = {
      module: { exports: {} }, window, Set, Math, Promise, Date, String, isNaN, Array, URLSearchParams, encodeURIComponent, JSON,
      document: doc,
      setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
      clearTimeout: () => {}, setInterval: () => 0,
    };
    vm.runInNewContext(TASK_PAGE_SRC, ctx);
    onReady();
    return { timers, answer, card, textarea, radio, reloads, inits, wasRemoved: () => removed, cardNode: () => doc.querySelector('[data-testid="task-page-question"]') };
  }
  const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

  test('init captures the card once, before any poll', () => {
    const page = makePage({ polls: [] });
    assert.equal(page.inits.length, 1);
  });

  test('a poll that still says waiting repaints the header but keeps the card and the typed text', async () => {
    const page = makePage({ polls: [{ status: 'waiting', live: false, headerHtml: statusHtml('waiting'), questionHtml: QUESTION_HTML }] });
    page.timers.shift().fn();
    await flush();
    assert.equal(page.wasRemoved(), false, 'the card stays');
    assert.equal(page.cardNode(), page.card, 'the very same card node, not a re-render');
    assert.equal(page.card.querySelector('textarea'), page.textarea, 'the same textarea object');
    assert.equal(page.textarea.value, 'half a typed answer', 'the typed text survives the poll');
    assert.equal(page.card.querySelector('input[type="radio"]:checked'), page.radio, 'the same selected option');
    assert.equal(page.radio.checked, true, 'the selection survives the poll');
    assert.equal(page.reloads.length, 0);
  });

  test('a poll that finds the task no longer waiting removes the card', async () => {
    const page = makePage({ polls: [{ status: 'running', live: true, headerHtml: statusHtml('running'), questionHtml: '' }] });
    page.timers.shift().fn();
    await flush();
    assert.equal(page.wasRemoved(), true);
  });

  test('a poll that says waiting with no question (questionHtml "") removes the card and does not reload (LIN-4038)', async () => {
    // Shelving the ruling while the page is open: the status is still waiting, but the server says no question.
    const page = makePage({ polls: [{ status: 'waiting', live: false, headerHtml: statusHtml('waiting'), questionHtml: '' }] });
    page.timers.shift().fn();
    await flush();
    assert.equal(page.wasRemoved(), true, 'the card goes');
    assert.equal(page.reloads.length, 0, 'no reload for a card that should not be there');
  });

  test('a waiting-but-parked poll on a page with no card does not reload (LIN-4038)', async () => {
    const page = makePage({ withCard: false, loadStatus: 'running', polls: [{ status: 'waiting', live: false, headerHtml: statusHtml('waiting'), questionHtml: '' }] });
    page.timers.shift().fn();
    await flush();
    assert.equal(page.reloads.length, 0);
  });

  test('an owner page that becomes asked reloads once to fetch the card; a page with no owner marker does not', async () => {
    const own = makePage({ withCard: false, loadStatus: 'running', polls: [{ status: 'waiting', live: false, headerHtml: statusHtml('waiting'), questionHtml: QUESTION_HTML }] });
    own.timers.shift().fn();
    await flush();
    assert.equal(own.reloads.length, 1);
    const guest = makePage({ withCard: false, owner: false, loadStatus: 'running', polls: [{ status: 'waiting', live: false, headerHtml: statusHtml('waiting'), questionHtml: QUESTION_HTML }] });
    guest.timers.shift().fn();
    await flush();
    assert.equal(guest.reloads.length, 0);
  });
});

describe('the press goes through the run page\'s ReplyDelivery entry', () => {
  test('the shared client hands the answer to window.ReplyDelivery.deliverRulingAnswer', async () => {
    const calls = [];
    const el = (over = {}) => ({ dataset: {}, textContent: '', value: '', className: '', disabled: false, listeners: {}, addEventListener(t, f) { this.listeners[t] = f; }, querySelector() { return null; }, querySelectorAll() { return []; }, ...over });
    const btn = el(); const textarea = el({ value: 'ship it' }); const feedback = el();
    const card = el({
      dataset: { urlKey: 'acme', loopId: 'impl-2', stampLoopId: 'impl-2', target: 'cli', issueId: UUID, issueIdentifier: 'LIN-50', disposition: 'resumable', effect: 'resume', sessionWaiting: 'true' },
      querySelector(sel) {
        if (sel.includes('answer')) return btn;
        if (sel.includes('card-input')) return textarea;
        if (sel === '.sess-qcard-feedback') return feedback;
        return null;
      },
    });
    const sandbox = {
      module: { exports: {} },
      window: { ReplyDelivery: { deliverRulingAnswer(opts, h) { calls.push(opts); h.onDispatchOk(); return Promise.resolve(); }, deliveredEffect: (o) => o.effect, composeDispatchPrompt: () => '' }, ChatUI: { appendMessage() {} } },
      document: { querySelectorAll: () => [card], createElement: () => el() },
      setTimeout() {}, console,
    };
    vm.runInNewContext(readFileSync(join(__dirname, '../../public/question-cards.js'), 'utf8'), sandbox);
    sandbox.module.exports.initQuestionCards();
    btn.listeners.click({ preventDefault() {} });
    await Promise.resolve();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].prompt, 'ship it');
    assert.equal(calls[0].followUpTo, 'impl-2');
    assert.equal(calls[0].force, true);
  });
});

describe('a joined ruling row on the task page (LIN-3959)', () => {
  test('the page of the autopilot copy keeps a joined row whose anchor is the worker', () => {
    const rows = [
      { anchor: { loopId: 'wk' }, stampLoopId: 'wk', stampLoopIds: ['wk', 'ap'], decision: { decision_id: 'd-1' } },
      { anchor: { loopId: 'other' }, stampLoopId: 'other', decision: { decision_id: 'd-2' } },
    ];
    const m = model([blocked({ loopId: 'ap' })], { deriveSessionDecisions: () => rows });
    assert.equal(m.question.decisions.length, 1, 'only the joined row is kept');
    assert.equal(m.question.decisions[0].anchor.loopId, 'wk');
  });
});
