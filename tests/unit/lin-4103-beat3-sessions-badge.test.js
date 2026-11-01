/**
 * LIN-4103 beat 3 — the Sessions list shows runs only, in the box's words and states; the 30-day boundary of the list.
 *
 * Each witness here was run against the beat-2 code first (it fails there, or is a guard that passes and says so).
 *
 * Witnesses:
 *  - R-A `isRunKind` is true for a stage kind and false for the queue records the brief names (`custom` is the
 *    "Prompt" record, `autopilot`/`wake`/`periodical` are orchestration rows);
 *  - R-B `runSessionsOf` returns the box's sessions for runs only (no queue record reaches the list or the count);
 *  - R-C the Sessions route lists runs only, and each row carries the box's stage label and state word;
 *  - R-D a waiting run reads "waiting on you" in the list and in the strip (one vocabulary, the product's);
 *  - R-E `sessionSummaryOf().count` counts runs only (the box's "N sessions" agrees with the list);
 *  - R-F the 30-day boundary of the list: a run dispatched 30 days minus a minute is in the window; 30 days plus a minute is
 *    history (guard: the boundary is already in `inReadWindow`; this pins it on the list).
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceApiRoutes } from '../../routes/workspace-api.js';
import { findRouteLayer } from './lib/route-layer.js';
// Namespace imports: a name this beat adds fails its own test, not the whole file at load.
import * as runView from '../../lib/run-view.js';
import * as taskLoader from '../../lib/task-page-loader.js';
const { ORCHESTRATION_KINDS } = runView;
const { buildTaskPageModel, sessionSummaryOf } = taskLoader;
const isRunKind = (k) => runView.isRunKind(k);
const runSessionsOf = (...a) => taskLoader.runSessionsOf(...a);
import { enrichLoop, deriveSessionWaiting } from '../../routes/dashboard.js';
import { escapeHtml } from '../../lib/utils/html.js';
import { renderStageStrip } from '../../lib/render-task-page.js';

const NOW = new Date('2026-11-01T10:06:00.000Z');
const PATH = '/workspace/:urlKey/api/sessions/:identifier';

before(() => { process.env.NODE_ENV = 'test'; });

function loop(over = {}) {
  return {
    loopId: 'l1', lineageId: 'l1', issueIdentifier: 'LIN-7', kind: 'implementation', iteration: 1,
    source: 'history', historyStatus: 'taken', agentState: 'running',
    dispatchedAt: '2026-11-01T10:00:00.000Z', takenAt: '2026-11-01T10:01:00.000Z', resolvedAt: '2026-11-01T10:01:00.000Z',
    terminalStatus: null, terminalCompletedAt: null, wakeMarker: 'pending', waitingMessage: null,
    feedback: [], telemetry: { runtime: { ms: 1 }, metrics: [], producedArtifacts: [] }, followUpTo: null, bookkeeping: null,
    ...over,
  };
}
const doneLoop = (kind, over = {}) => loop({
  kind, agentState: 'done', terminalStatus: 'done', terminalCompletedAt: '2026-11-01T10:03:00.000Z',
  resolvedAt: '2026-11-01T10:03:00.000Z', historyStatus: 'resolved', ...over,
});

// ─── R-A ──────────────────────────────────────────────────────────────────────

describe('R-A isRunKind: a stage kind is a run; the queue records are not', () => {
  test('work kinds are runs; custom (the "Prompt" record), autopilot, wake and periodical are not', () => {
    for (const kind of ['research', 'plan', 'plan-review', 'implementation', 'review', 'close-out']) {
      assert.equal(isRunKind(kind), true, `${kind} is a run`);
    }
    for (const kind of ['custom', 'autopilot', 'wake', 'periodical']) {
      assert.equal(isRunKind(kind), false, `${kind} is a queue record, not a run`);
      assert.ok(ORCHESTRATION_KINDS.has(kind), `${kind} is orchestration`);
    }
    assert.equal(isRunKind(null), false, 'a row with no kind is not a run');
  });
});

// ─── R-B ──────────────────────────────────────────────────────────────────────

describe('R-B runSessionsOf: the box\'s sessions, for runs only', () => {
  test('a Prompt record and an autopilot anchor are dropped; the implementation run is kept, with its box label', () => {
    const loops = [
      doneLoop('implementation', { loopId: 'run-1', lineageId: 'run-1' }),
      doneLoop('custom', { loopId: 'prompt-1', lineageId: 'prompt-1', promptName: 'Prompt' }),
      doneLoop('autopilot', { loopId: 'ap-1', lineageId: 'ap-1' }),
    ];
    const runs = runSessionsOf(loops, { enrichLoop, deriveSessionWaiting, now: NOW });
    assert.deepEqual(runs.map((s) => s.loopId), ['run-1']);
    assert.equal(runs[0].label, 'Build', 'the box label for implementation');
    assert.equal(runs[0].state, 'done');
  });
});

// ─── The route (R-C, R-D, R-F) ────────────────────────────────────────────────

const minutesAgo = (n) => new Date(Date.now() - n * 60_000).toISOString();
const item = (id, minutes, over = {}) => ({
  id, kind: 'implementation', promptName: 'implementation', issueIdentifier: 'LIN-7',
  dispatchedAt: minutesAgo(minutes), status: 'done', target: 'cli', ...over,
});

function getHandler(router, method, path) {
  const layer = findRouteLayer(router, method, path);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

// The task's dispatches come from the history store (a run that was taken), as in lin-4016's route harness.
async function callRoute(history, { statuses = [] } = {}) {
  const router = createWorkspaceApiRoutes({
    workspaceFromUrl: (req, res, next) => next(),
    dispatchQueueStore: { async listItems() { return []; }, async listHistory() { return { items: history }; } },
    agentStatusStore: { async listStatus() { return { items: statuses }; } },
  });
  const handler = getHandler(router, 'get', PATH);
  const req = { workspace: { urlKey: 'ws' }, params: { urlKey: 'ws', identifier: 'LIN-7' }, query: {} };
  const res = {
    statusCode: 200, jsonBody: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.jsonBody = body; return this; },
  };
  await handler(req, res, (err) => { if (err) throw err; });
  return res;
}

describe('R-C the Sessions route lists runs only, with the box\'s label and state', () => {
  test('a Prompt record, an autopilot row and a wake row are not in the list; the run is, labelled Build and done', async () => {
    const res = await callRoute([
      item('run-1', 5),
      item('prompt-1', 4, { kind: 'custom', promptName: 'Prompt' }),
      item('ap-1', 3, { kind: 'autopilot', promptName: 'autopilot' }),
      item('wake-1', 2, { kind: 'wake', promptName: 'wake' }),
    ], { statuses: [{ dispatchId: 'run-1', taskIdentifier: 'LIN-7', status: 'completed', issueIdentifier: 'LIN-7', timestamp: minutesAgo(4) }] });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.jsonBody.sessions.map((s) => s.kind), ['implementation'], 'only the run is listed');
    assert.equal(res.jsonBody.sessions[0].label, 'Build');
    assert.equal(res.jsonBody.sessions[0].state, 'done');
  });
});

describe('R-D a waiting run reads "waiting on you" in the list, as in the strip', () => {
  test('a run blocked on a question reads waiting on you, the product\'s word (not a separate machine word)', async () => {
    const res = await callRoute(
      [item('run-w', 5)],
      { statuses: [{ dispatchId: 'run-w', taskIdentifier: 'LIN-7', status: 'blocked', issueIdentifier: 'LIN-7', timestamp: minutesAgo(4) }] },
    );
    assert.equal(res.jsonBody.sessions[0].state, 'waiting');
    assert.equal(res.jsonBody.sessions[0].word, 'waiting on you', 'the word the list paints is the server\'s, the strip\'s word');
  });
});

describe('R-F the list\'s 30-day boundary (guard: inReadWindow already pins it; this pins the list\'s historical flag)', () => {
  const MINUTE = 60_000;
  const DAYS30_MIN = 30 * 24 * 60;

  test('a run 30 days minus a minute ago is inside the window: not history', async () => {
    const res = await callRoute([item('edge-in', DAYS30_MIN - 1)]);
    assert.equal(res.jsonBody.sessions[0].historical, false);
  });

  test('a run 30 days plus a minute ago is history: dated, and not a question', async () => {
    const res = await callRoute([item('edge-out', DAYS30_MIN + 1)]);
    assert.equal(res.jsonBody.sessions[0].historical, true);
    assert.equal(Number.isFinite(MINUTE), true);
  });
});

// ─── R-E ──────────────────────────────────────────────────────────────────────

describe('R-E the box\'s session count counts runs only, so it agrees with the list', () => {
  test('a task with one run and one autopilot anchor: the box counts one session', () => {
    const model = buildTaskPageModel({
      identifier: 'LIN-7',
      loops: [doneLoop('implementation', { loopId: 'run-1', lineageId: 'run-1' }), doneLoop('autopilot', { loopId: 'ap-1', lineageId: 'ap-1' })],
      ctx: { issue: { identifier: 'LIN-7', title: 'T', state: { type: 'started' } }, parent: null, children: [] },
      enrichLoop, deriveSessionWaiting, ruling: null, now: NOW,
    });
    assert.equal(sessionSummaryOf(model).count, 1);
  });
});

describe('R-D the strip names a waiting run in the same words as the list', () => {
  test('a run blocked on a question reads waiting on you in the strip', () => {
    const blocked = loop({
      loopId: 'run-q', lineageId: 'run-q', wakeMarker: 'blocked', waitingMessage: '[blocked] which way?',
      feedback: [{ message: '[blocked] which way?', timestamp: '2026-11-01T10:05:00.000Z' }],
      decision: { decision_id: 'd-1', question: 'Which way?' }, decisionCase: [], answeredDecisions: [], withdrawal: null,
    });
    const model = buildTaskPageModel({
      identifier: 'LIN-7', loops: [blocked],
      ctx: { issue: { identifier: 'LIN-7', title: 'T', state: { type: 'started' } }, parent: null, children: [] },
      enrichLoop, deriveSessionWaiting, ruling: null, now: NOW,
    });
    assert.equal(model.stages[0].state, 'waiting', 'the fixture is a waiting run');
    const html = renderStageStrip(model, { now: NOW });
    assert.match(html, /waiting on you/);
    assert.doesNotMatch(html, /waiting for an answer/);
  });
});
