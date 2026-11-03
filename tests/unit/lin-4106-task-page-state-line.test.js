/**
 * LIN-4106 (S4, beat 2) — the task page's state line and the ruling card's place.
 *
 * Pinned here:
 *   - the last-run sentence (`deriveHeader`, written from the same session facts the row reads):
 *     "Last run: <stage> finished <when> · all N runs", "… failed <when>: <message> · …",
 *     "… running for <how long>", with the count as "the only run" for one;
 *   - one state line on the task page: exactly one pill and one sentence, drawn from the
 *     server's decision, with no "Tracker:" line and no "Harbour:" label (the tracker's own
 *     word stays in the details block);
 *   - DOM order: the ruling card comes before the run control (where "Runs on" and
 *     "Another step" are drawn) and before the stages.
 *
 * Run with: node --test tests/unit/lin-4106-task-page-state-line.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { renderTaskPage, renderTaskStatus } from '../../lib/render-task-page.js';
import { buildTaskPageModel, deriveHeader } from '../../lib/task-page-loader.js';
import { gatherTaskStates } from '../../lib/home-row-states.js';
import { pageStatusOf } from '../../lib/task-state.js';
import { rulingStandingOf } from '../../lib/unanswered-decisions.js';
import { buildPromptOpts } from '../../lib/render-prompt-opts.js';
import { enrichLoop, deriveSessionWaiting, deriveSessionDecisions } from '../../routes/dashboard.js';

const NOW = new Date('2026-10-06T14:30:00.000Z');
const URL_KEY = 'acme';
const UUID = '11111111-2222-3333-4444-555555555555';
const PAGE_OPTIONS = { deployInfo: { version: 't', commit: 't' }, featureFlags: {}, workspaces: [] };
const PROMPT_OPTS = buildPromptOpts({ openRouterSource: 'env', featureFlags: { runControls: true }, isLocalhost: false });

// ── deriveHeader: the last-run sentence ──────────────────────────────────────

describe('LIN-4106 — the last-run sentence says what the last run did, in plain words, with the count', () => {
  const s = (state, kind, over = {}) => ({ state, kind, loop: { takenAt: '2026-10-06T13:00:00.000Z', dispatchedAt: '2026-10-06T13:00:00.000Z' }, endedAt: '2026-10-06T13:30:00.000Z', ...over });
  const tracker = (type) => ({ state: { name: type, type }, finishedAt: null });
  const noWait = { waiting: false, message: null };

  test('finished, several runs: the last one, and the count of all runs', () => {
    const header = deriveHeader({ sessions: [s('done', 'plan'), s('done', 'implementation'), s('done', 'close-out')], waiting: noWait, tracker: tracker('started'), now: NOW });
    assert.equal(header.sentence, 'Last run: Close-out finished 1 hour ago · all 3 runs');
  });

  test('finished, one run: the count reads as the only run', () => {
    const header = deriveHeader({ sessions: [s('done', 'plan')], waiting: noWait, tracker: tracker('started'), now: NOW });
    assert.equal(header.sentence, 'Last run: Plan finished 1 hour ago · the only run');
  });

  test('failed as the last run: the stage, when, the message and the count', () => {
    const header = deriveHeader({ sessions: [s('done', 'plan'), s('failed', 'review', { message: 'tests red' })], waiting: noWait, tracker: tracker('started'), now: NOW });
    assert.equal(header.sentence, 'Last run: Review failed 1 hour ago: tests red · all 2 runs');
  });

  test('an earlier failure, with a later run that finished, is not called the last run', () => {
    const header = deriveHeader({ sessions: [s('failed', 'review', { message: 'tests red' }), s('done', 'implementation')], waiting: noWait, tracker: tracker('started'), now: NOW });
    assert.equal(header.sentence, 'Review failed 1 hour ago: tests red');
  });

  test('running: the live run in plain words, with no machine word', () => {
    const header = deriveHeader({ sessions: [s('done', 'plan'), s('running', 'implementation', { loop: { takenAt: '2026-10-06T14:02:00.000Z', dispatchedAt: '2026-10-06T14:00:00.000Z' }, endedAt: null })], waiting: noWait, tracker: tracker('started'), now: NOW });
    assert.equal(header.sentence, 'Build running for 28m.');
  });

  test('no sentence carries a machine word: no raw state key (done, completed), no lower-case kind slug', () => {
    const cases = [
      [s('done', 'close-out')],
      [s('failed', 'review', { message: 'x' })],
      [s('done', 'plan'), s('cancelled', 'implementation')],
    ];
    for (const sessions of cases) {
      const { sentence } = deriveHeader({ sessions, waiting: noWait, tracker: tracker('started'), now: NOW });
      assert.doesNotMatch(sentence, /\bdone\b|\bcompleted\b|\bclose-out\b/, sentence);
    }
  });

  test('a cancelled last run reads "was cancelled", the plain word for the state', () => {
    const { sentence } = deriveHeader({ sessions: [s('done', 'plan'), s('cancelled', 'implementation')], waiting: noWait, tracker: tracker('started'), now: NOW });
    assert.equal(sentence, 'Last run: Build was cancelled 1 hour ago · all 2 runs');
  });
});

// ── the page: one state line, no tracker line, no Harbour label ─────────────

describe('LIN-4106 — the task page has one state line: one pill, one sentence, no Tracker and no Harbour', () => {
  function loopOf(over = {}) {
    return {
      loopId: 'loop-x', issueIdentifier: 'LIN-50', issueId: UUID, issueTitle: 'T', kind: 'implementation', iteration: 1,
      source: 'history', historyStatus: 'taken', agentState: 'running', target: 'cli',
      dispatchedAt: '2026-10-06T10:00:00.000Z', takenAt: '2026-10-06T10:01:00.000Z', resolvedAt: '2026-10-06T10:01:00.000Z',
      terminalStatus: null, terminalCompletedAt: null, wakeMarker: null, waitingMessage: null, feedback: [],
      telemetry: { runtime: { ms: 1 }, metrics: [], producedArtifacts: [] }, followUpTo: null,
      ...over,
    };
  }
  const blocked = () => loopOf({
    loopId: 'impl-2', wakeMarker: 'blocked', waitingMessage: '[blocked] which API key?', feedback: [{ message: '[blocked] which API key?' }],
    decision: { decision_id: 'd-key', question: 'which API key?' },
  });
  // The page-load path: the loader gives the model the workspace's ruling standing, and the gather gives the state.
  function modelFor(loops, type = 'started') {
    const ruling = rulingStandingOf({ urlKey: URL_KEY, loops, shelvedRulings: [] }, { now: NOW, enrichLoop });
    const m = buildTaskPageModel({ identifier: 'LIN-50', loops, ctx: null, enrichLoop, deriveSessionWaiting, deriveSessionDecisions, ruling, now: NOW });
    const state = gatherTaskStates({ roots: [{ issue: { identifier: 'LIN-50', state: { type } }, children: [] }], loops, ruling, at: NOW, enrichLoop, deriveSessionWaiting }).states.get('LIN-50');
    return { m, state };
  }
  const page = (m, state, viewer = 'owner', promptOpts = null) => renderTaskPage(m, {
    viewer, urlKey: URL_KEY, binding: { source: 'linear' }, stateUrl: '/s', now: NOW, pageOptions: PAGE_OPTIONS, taskState: state, promptOpts,
  });

  test('the status mount has exactly one pill and exactly one sentence', () => {
    const { m, state } = modelFor([loopOf({ agentState: 'done', terminalStatus: 'completed', historyStatus: 'taken' })], 'started');
    const html = renderTaskStatus(m, { now: NOW, taskState: state });
    assert.equal((html.match(/data-testid="task-page-status-pill"/g) || []).length, 1);
    assert.equal((html.match(/data-testid="task-page-sentence"/g) || []).length, 1);
    assert.doesNotMatch(html, /Harbour:/);
  });

  test('the page has no tracker line and no Harbour label (the tracker\'s word stays in the details)', () => {
    const { m, state } = modelFor([blocked()]);
    const html = page(m, state, 'owner', PROMPT_OPTS);
    assert.doesNotMatch(html, /data-testid="task-page-tracker-state"/);
    assert.doesNotMatch(html, /data-testid="task-page-harbour-label"/);
    assert.doesNotMatch(html, /Tracker:/);
    assert.doesNotMatch(html, />Harbour:</);
    assert.equal((html.match(/data-testid="task-page-status-pill"/g) || []).length, 1, 'one pill on the page');
  });

  test('the state line is the server\'s decision: the pill and the sentence follow the gathered state', () => {
    const { m, state } = modelFor([blocked()]);
    assert.equal(pageStatusOf(state), 'waiting');
    assert.match(renderTaskStatus(m, { now: NOW, taskState: state }), /data-testid="task-page-sentence">which API key\?</);
  });
});

// ── DOM order: the ruling card first ─────────────────────────────────────────

describe('LIN-4106 — the ruling card comes before the run control and the stages', () => {
  function loopOf(over = {}) {
    return {
      loopId: 'loop-x', issueIdentifier: 'LIN-50', issueId: UUID, issueTitle: 'T', kind: 'implementation', iteration: 1,
      source: 'history', historyStatus: 'taken', agentState: 'running', target: 'cli',
      dispatchedAt: '2026-10-06T10:00:00.000Z', takenAt: '2026-10-06T10:01:00.000Z', resolvedAt: '2026-10-06T10:01:00.000Z',
      terminalStatus: null, terminalCompletedAt: null, wakeMarker: null, waitingMessage: null, feedback: [],
      telemetry: { runtime: { ms: 1 }, metrics: [], producedArtifacts: [] }, followUpTo: null,
      ...over,
    };
  }
  const blocked = () => loopOf({
    loopId: 'impl-2', wakeMarker: 'blocked', waitingMessage: '[blocked] which API key?', feedback: [{ message: '[blocked] which API key?' }],
    decision: { decision_id: 'd-key', question: 'which API key?' },
  });

  test('a waiting task: the question sits before the run control and the stages', () => {
    const loops = [blocked()];
    const ruling = rulingStandingOf({ urlKey: URL_KEY, loops, shelvedRulings: [] }, { now: NOW, enrichLoop });
    const m = buildTaskPageModel({ identifier: 'LIN-50', loops, ctx: null, enrichLoop, deriveSessionWaiting, deriveSessionDecisions, ruling, now: NOW });
    const state = gatherTaskStates({ roots: [{ issue: { identifier: 'LIN-50', state: { type: 'started' } }, children: [] }], loops, ruling, at: NOW, enrichLoop, deriveSessionWaiting }).states.get('LIN-50');
    const html = renderTaskPage(m, {
      viewer: 'owner', urlKey: URL_KEY, binding: { source: 'linear' }, stateUrl: '/s', now: NOW, pageOptions: PAGE_OPTIONS, taskState: state, promptOpts: PROMPT_OPTS,
    });
    const question = html.indexOf('data-testid="task-page-question"');
    const run = html.indexOf('data-testid="task-page-run"');
    const stages = html.indexOf('data-testid="task-page-track-mount"');
    assert.ok(question > 0, 'the ruling card is drawn for the owner');
    assert.ok(run > 0, 'the run control is drawn for the owner');
    assert.ok(question < run, 'the ruling card comes before the run control ("Runs on" and "Another step" are drawn there)');
    assert.ok(question < stages, 'the ruling card comes before the stages');
  });
});
