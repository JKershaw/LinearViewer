/**
 * LIN-4070 (piece B of LIN-4068) — `/state`, the task page, the guest share page and the Sessions fold read the gathered
 * task state through the held set. Witnesses, run through the real readers with an injected fetcher:
 *
 *   1. agreement: one fixture set through the readers (Home's row, `/state`, the page-load record) for the Done-when cases
 *      (old sessions; a Done subtask whose last run failed; a parent with a grandchild running), a Done child with a running
 *      close-out, the D2 guards, and the LIN-4008 shape (a subtask in another project, a running grandchild);
 *   2. no poll reaches a provider: a cold holder answers `incomplete`, the fetcher is never called, no run is offered, and
 *      the private `/state` starts exactly one refresh (a second poll inside the attempt floor starts none);
 *   3. task missing from a warm complete set: no `taskState`, no run, one refresh;
 *   4. a held entry the page's own tracker read contradicts (review note 2): incomplete, dropped, refresh started;
 *   5. source scans: `container=1` is gone from server code; the loader and the public share router start no refresh.
 *
 * The Sessions fold's own witnesses (whole life, `historical`, the incomplete read) are in lin-4016-sessions-fold-parked.test.js.
 *
 * Run with: node --test tests/unit/lin-4070-state-reads-gatherer.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTaskPageLoader } from '../../lib/task-page-loader.js';
import { createTaskPageRoutes } from '../../routes/task-page.js';
import { createTaskFactsRefresh } from '../../lib/task-facts-holder.js';
import { gatherTaskStates } from '../../lib/home-row-states.js';
import { rowRecordOf } from '../../lib/task-board-view.js';
import { enrichLoop, deriveSessionWaiting, deriveSessionDecisions } from '../../routes/dashboard.js';
import { heldTaskFacts, heldLoaderDeps } from '../fixtures/held-task-facts.js';
import { registerProvider } from '../../lib/providers/registry.js';
import '../../lib/providers/linear/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
const NOW = new Date('2026-10-31T12:00:00.000Z');
const URL_KEY = 'acme';
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n) => new Date(NOW.getTime() - n * DAY).toISOString();

// ── fixtures ─────────────────────────────────────────────────────────────────

const issue = (identifier, type, over = {}) => ({
  id: `id-${identifier}`, identifier, title: `Task ${identifier}`, state: { name: type, type },
  parent: null, project: { id: 'p1', name: 'Main' }, assignee: null, ...over,
});
const child = (identifier, parentIdentifier, type, over = {}) => issue(identifier, type, { parent: { id: `id-${parentIdentifier}` }, ...over });

function loop(identifier, over = {}) {
  return {
    loopId: `${identifier}-${over.kind || 'implementation'}-${over.n || 1}`, lineageId: `${identifier}-l`, issueIdentifier: identifier,
    kind: 'implementation', iteration: 1, source: 'history', historyStatus: 'taken', agentState: 'running',
    dispatchedAt: daysAgo(0.1), takenAt: daysAgo(0.1), resolvedAt: null, terminalStatus: null, terminalCompletedAt: null,
    wakeMarker: 'pending', waitingMessage: null, feedback: [], telemetry: { producedArtifacts: [] }, followUpTo: null, bookkeeping: null,
    ...over,
  };
}
const failedLoop = (identifier, days, over = {}) => loop(identifier, {
  agentState: 'failed', terminalStatus: 'failed', terminalCompletedAt: daysAgo(days), resolvedAt: daysAgo(days),
  dispatchedAt: daysAgo(days + 0.1), takenAt: daysAgo(days + 0.1), historyStatus: 'resolved', ...over,
});

/** A holder with one complete set of `issues`, written at `writtenAt` and read now. */
const holding = (issues, writtenAt = NOW) => heldTaskFacts({ issues, now: writtenAt, readAt: NOW });

/** The loader over a stored set of loops and a held set, wired the way server.js wires it. */
function loaderOver({ loops, holder }) {
  return createTaskPageLoader({
    dispatchStore: {}, agentStatusStore: {}, enrichLoop, deriveSessionWaiting, deriveSessionDecisions,
    getLoopsForIssue: async (_urlKey, identifier) => loops.filter((l) => l.issueIdentifier === identifier),
    getLoopsForIssues: async (_urlKey, ids) => loops.filter((l) => ids.includes(l.issueIdentifier)),
    now: () => NOW,
    ...heldLoaderDeps(holder),
  });
}

/** Home's row states for the set: the gather over the same held index and the same stored loops. */
function rowsOf(issues, loops) {
  return gatherTaskStates({ issues, loops, at: NOW, enrichLoop, deriveSessionWaiting }).states;
}

/** A provider whose tracker read answers `ctx`; returns the access the page load takes. */
function providerAnswering(ctx) {
  const name = `lin-4070-provider-${Math.random().toString(36).slice(2)}`;
  const provider = registerProvider({
    name, ui: { inlineEdit: false, inlineCreate: false }, supports: () => true,
    fetchRecommendationContext: async () => ctx,
    fetchIssueComments: async () => [], fetchIssueFields: async () => null, fetchProjects: async () => ({ projects: [] }),
  });
  return { provider, callScope: null };
}

/** The tracker's context for `task` in `issues`: the issue and its direct children, as the detail read returns them. */
function ctxFor(issues, task) {
  const node = issues.find((i) => i.identifier === task);
  return {
    issue: { id: node.id, identifier: node.identifier, title: node.title, state: node.state, labels: [], blockedBy: [] },
    parent: null,
    children: issues.filter((i) => i.parent?.id === node.id).map((i) => ({ id: i.id, identifier: i.identifier, title: i.title, state: i.state })),
    comments: [],
  };
}

// ── 1. agreement across the readers ─────────────────────────────────────────

describe('LIN-4070 D1-D3 — the row, /state and the page-load record agree', () => {
  const CASES = [
    {
      name: 'old sessions (Build failed 45 days ago)',
      issues: [issue('LIN-90', 'started')], loops: [failedLoop('LIN-90', 45)], task: 'LIN-90', expect: 'next',
    },
    {
      name: 'a Done subtask whose last run failed',
      issues: [issue('LIN-91', 'started'), child('LIN-92', 'LIN-91', 'completed')], loops: [failedLoop('LIN-92', 2)], task: 'LIN-92', expect: 'done',
    },
    {
      name: 'a parent whose grandchild runs, three levels deep, another project',
      issues: [
        issue('LIN-100', 'backlog'),
        child('LIN-101', 'LIN-100', 'unstarted'),
        child('LIN-102', 'LIN-101', 'started', { project: { id: 'p2', name: 'Other' } }),
      ],
      loops: [loop('LIN-102', { n: 3 })], task: 'LIN-100', expect: 'running',
    },
  ];

  for (const c of CASES) {
    test(`${c.name}: Home's row, /state and the page-load record say ${c.expect}`, async () => {
      const holder = holding(c.issues);
      const loader = loaderOver({ loops: c.loops, holder });
      const row = rowsOf(c.issues, c.loops).get(c.task);
      const { taskState, incomplete } = await loader.loadTaskState({ urlKey: URL_KEY, identifier: c.task });
      assert.equal(incomplete, null, 'a complete held set answers');
      const page = await loader.loadTaskPage({ urlKey: URL_KEY, identifier: c.task, access: providerAnswering(ctxFor(c.issues, c.task)) });
      assert.equal(row.state, c.expect, 'Home row');
      assert.equal(taskState.state, c.expect, '/state');
      assert.equal(page.taskState.state, c.expect, 'the page-load pill');
      assert.deepEqual(page.taskState.action, taskState.action, 'the page and /state offer the same action');
      assert.deepEqual(row.action, taskState.action, 'the row and /state offer the same action');
    });
  }

  test('old sessions: the history still lists the failure, and the state does not re-decide it', async () => {
    const issues = [issue('LIN-90', 'started')];
    const { model, taskState } = await loaderOver({ loops: [failedLoop('LIN-90', 45)], holder: holding(issues) })
      .loadTaskState({ urlKey: URL_KEY, identifier: 'LIN-90' });
    assert.equal(model.sessions.length, 1, 'the whole-life history lists the old session');
    assert.equal(taskState.state, 'next', 'the state reads the 30-day window only');
  });

  test('a Done child with a running close-out: its parent reads running (terminal children roll up)', async () => {
    const issues = [issue('LIN-110', 'started'), child('LIN-111', 'LIN-110', 'completed')];
    const { taskState } = await loaderOver({ loops: [loop('LIN-111', { kind: 'close-out', n: 2 })], holder: holding(issues) })
      .loadTaskState({ urlKey: URL_KEY, identifier: 'LIN-110' });
    assert.equal(taskState.state, 'running');
  });

  test('D2 guards: a Done task reads done even when its last stage failed; a started task whose last stage failed still reads failed', async () => {
    const doneIssues = [issue('LIN-120', 'completed')];
    const done = await loaderOver({ loops: [failedLoop('LIN-120', 1)], holder: holding(doneIssues) })
      .loadTaskState({ urlKey: URL_KEY, identifier: 'LIN-120' });
    assert.equal(done.taskState.state, 'done');
    const startedIssues = [issue('LIN-121', 'started')];
    const started = await loaderOver({ loops: [failedLoop('LIN-121', 1)], holder: holding(startedIssues) })
      .loadTaskState({ urlKey: URL_KEY, identifier: 'LIN-121' });
    assert.equal(started.taskState.state, 'failed');
  });

  test('a finished task offers no run on any reader, and a finished task with a running close-out still reads running', async () => {
    const issues = [issue('LIN-125', 'completed')];
    const { taskState } = await loaderOver({ loops: [], holder: holding(issues) }).loadTaskState({ urlKey: URL_KEY, identifier: 'LIN-125' });
    assert.equal(taskState.state, 'done');
    assert.equal(taskState.action, null, 'LIN-4042: no run on a finished task');
    const closing = await loaderOver({ loops: [loop('LIN-125', { kind: 'close-out' })], holder: holding(issues) })
      .loadTaskState({ urlKey: URL_KEY, identifier: 'LIN-125' });
    assert.equal(closing.taskState.state, 'running');
  });

  test('LIN-4008 shape: a Backlog parent, a child in another project and a running grandchild read running and offer no run', async () => {
    const issues = [
      issue('LIN-130', 'backlog'),
      child('LIN-131', 'LIN-130', 'unstarted', { assignee: { id: 'u2' }, project: { id: 'p9', name: 'Elsewhere' } }),
      child('LIN-132', 'LIN-131', 'started', { assignee: { id: 'u1' } }),
    ];
    const loops = [loop('LIN-132', { n: 4 })];
    const { taskState } = await loaderOver({ loops, holder: holding(issues) }).loadTaskState({ urlKey: URL_KEY, identifier: 'LIN-130' });
    assert.equal(taskState.state, 'running');
    assert.equal(taskState.action, null, 'busy: a running grandchild offers no run (D7)');
    assert.equal(rowsOf(issues, loops).get('LIN-130').action, null, 'Home offers the same');
  });
});

// ── 2. no poll reaches a provider; the private state read starts one refresh ──

/** The private route over one holder, shared by its loader as server.js shares them. */
function privateRouter({ holder, refresh }) {
  return createTaskPageRoutes({
    workspaceFromUrl: (req, res, next) => next(), getOpenRouterSource: () => 'env', getDeployInfo: () => ({}),
    loader: loaderOver({ loops: [], holder }), workspaceOwnerCheck: async () => ({ status: 'owner' }),
    taskFacts: holder, refreshTaskFacts: refresh, now: () => NOW,
  });
}

async function stateCall(router, identifier) {
  const layer = router.stack.find((l) => l.route?.path === '/workspace/:urlKey/api/task/:identifier/state' && l.route.methods.get);
  const req = {
    session: { workspaces: [], features: {}, accountId: 'acct-1' }, workspace: { urlKey: URL_KEY, id: 'ws-1' },
    params: { urlKey: URL_KEY, identifier }, query: {}, get: () => 'localhost',
  };
  const res = { statusCode: 200, jsonBody: null, status(c) { this.statusCode = c; return this; }, json(b) { this.jsonBody = b; return this; }, send() { return this; }, set() { return this; } };
  await layer.route.stack[layer.route.stack.length - 1].handle(req, res, (err) => { if (err) throw err; });
  return res;
}

describe('LIN-4070 — no poll calls a provider; the private state read starts one refresh', () => {
  test('a cold holder: /state answers incomplete with no state; the fetcher runs once, off the request, and a second poll starts nothing', async () => {
    const holder = holding([issue('LIN-140', 'started')], new Date(NOW.getTime() - 10 * 60 * 1000));
    const calls = [];
    // The fetcher never resolves: the request must answer without waiting for it.
    const refresh = createTaskFactsRefresh({
      holder, fetchAndPrepareProjects: (...args) => { calls.push(args); return new Promise(() => {}); },
      now: () => NOW.getTime(), onError() {},
    });
    const router = privateRouter({ holder, refresh: (args) => refresh(args) });
    const res = await stateCall(router, 'LIN-140');
    assert.equal(res.jsonBody.incomplete, 'cold');
    assert.equal('taskState' in res.jsonBody, false, 'no taskState');
    assert.equal(res.jsonBody.sessions.action, null, 'no run is offered');
    assert.equal(calls.length, 1, 'one refresh started');
    await stateCall(router, 'LIN-140');
    assert.equal(calls.length, 1, 'the in-flight refresh is single-flight: a second poll starts nothing');
  });

  test('the loader alone starts nothing: a cold read names the reason and calls no fetcher', async () => {
    const loader = createTaskPageLoader({
      dispatchStore: {}, agentStatusStore: {}, enrichLoop, deriveSessionWaiting,
      getLoopsForIssue: async () => [], getLoopsForIssues: async () => [], now: () => NOW,
    });
    const { incomplete, taskState } = await loader.loadTaskState({ urlKey: URL_KEY, identifier: 'LIN-141' });
    assert.equal(incomplete, 'cold', 'no holder is wired: every read is cold');
    assert.equal(taskState, null);
  });

  test('task missing from a warm complete set: no taskState, no run, one refresh started', async () => {
    const refreshed = [];
    const router = privateRouter({
      holder: holding([issue('LIN-150', 'started')]),
      refresh: (args) => { refreshed.push(args.urlKey); return { started: true, reason: 'started' }; },
    });
    const res = await stateCall(router, 'LIN-151');
    assert.equal(res.jsonBody.incomplete, 'task-missing');
    assert.equal('taskState' in res.jsonBody, false);
    assert.deepEqual(refreshed, [URL_KEY]);
  });
});

// ── 4. the held entry the page's own tracker read contradicts (review note 2) ─

describe('LIN-4070 note 2 — a warm holder staler than the page read', () => {
  test('the holder says In Progress and the detail read says Done: incomplete, stale; the private page drops the entry and refreshes', async () => {
    const issues = [issue('LIN-160', 'started')];
    const holder = holding(issues);
    const loader = loaderOver({ loops: [], holder });
    const ctx = ctxFor([issue('LIN-160', 'completed')], 'LIN-160');
    const result = await loader.loadTaskPage({ urlKey: URL_KEY, identifier: 'LIN-160', access: providerAnswering(ctx) });
    assert.equal(result.incomplete, 'stale');
    assert.equal(result.stale, true);
    assert.equal(result.taskState, null, 'no run is offered on the held entry\'s word');

    const refreshed = [];
    const router = createTaskPageRoutes({
      workspaceFromUrl: (req, res, next) => next(), getOpenRouterSource: () => 'env', getDeployInfo: () => ({}),
      loader, workspaceOwnerCheck: async () => ({ status: 'owner' }), taskFacts: holder,
      refreshTaskFacts: (args) => { refreshed.push(args.urlKey); return { started: true, reason: 'started' }; }, now: () => NOW,
    });
    const access = providerAnswering(ctx);
    const layer = router.stack.find((l) => l.route?.path === '/workspace/:urlKey/task/:identifier' && l.route.methods.get);
    const req = {
      session: { workspaces: [], features: {}, accountId: 'acct-1' }, workspace: { urlKey: URL_KEY, id: 'ws-1', provider: access.provider.name, accessToken: 't' },
      params: { urlKey: URL_KEY, identifier: 'LIN-160' }, query: {}, get: () => 'localhost',
    };
    const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, send(b) { this.body = b; return this; }, set() { return this; } };
    await layer.route.stack[layer.route.stack.length - 1].handle(req, res, (err) => { if (err) throw err; });
    assert.deepEqual(refreshed, [URL_KEY]);
    assert.equal(holder.read(URL_KEY, { identifier: 'LIN-160' }).complete, false, 'the stale entry is dropped');
  });
});

// ── 5. source scans ──────────────────────────────────────────────────────────

/** The source with its comments removed: the scans judge code, not the prose that explains it. */
function codeOf(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
}

function filesUnder(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === 'node_modules' ? [] : filesUnder(full);
    return /\.(js|mjs)$/.test(name) ? [full] : [];
  });
}

describe('LIN-4070 source scans', () => {
  test('container=1 is gone from server code: no route, lib, public script or server.js carries it', () => {
    for (const dir of ['routes', 'lib', 'public']) {
      for (const file of filesUnder(join(repo, dir))) {
        assert.doesNotMatch(readFileSync(file, 'utf8'), /container=1/, `${file} still carries the container hint`);
      }
    }
    assert.doesNotMatch(readFileSync(join(repo, 'server.js'), 'utf8'), /container=1/);
  });

  test('the loader can start no refresh: it names no refresh and no all-bindings or active-binding fetch', () => {
    const source = codeOf(readFileSync(join(repo, 'lib', 'task-page-loader.js'), 'utf8'));
    assert.doesNotMatch(source, /refresh/i);
    assert.doesNotMatch(source, /fetchAndPrepareProjects|fetchWorkspaceIssues/);
  });

  test('the public share router takes no refresh and names no fetch', () => {
    const source = codeOf(readFileSync(join(repo, 'routes', 'task-share.js'), 'utf8'));
    assert.doesNotMatch(source, /refresh/i);
    assert.doesNotMatch(source, /fetchAndPrepareProjects|fetchWorkspaceIssues/);
  });

  test('the refresh is called from one place in the private task-page routes, never from a loader or the share route', () => {
    const source = codeOf(readFileSync(join(repo, 'routes', 'task-page.js'), 'utf8'));
    assert.equal((source.match(/refreshTaskFacts\(/g) || []).length, 1, 'one call site: the shared kick helper');
  });
});
