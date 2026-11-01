/**
 * LIN-4070 (piece B of LIN-4068) — `/state`, the task page, the guest share page and the Sessions fold read the gathered
 * task state through the held set. Witnesses, run through the real readers with an injected fetcher:
 *
 *   1. agreement: one fixture set through the readers (Home's row, `/state`, the page-load record, the guest share page's
 *      pill, the Sessions fold's list) for the Done-when cases (old sessions; a Done subtask whose last run failed; a parent
 *      with a grandchild running), a Done child with a running close-out, the D2 guards (including the words Home's `/state`
 *      line paints), and the LIN-4008 shape (a subtask in another project, a running grandchild);
 *   2. no poll reaches a provider: a cold holder answers `incomplete`, the fetcher is never called, no run is offered, and
 *      the private `/state` starts exactly one refresh (a second poll inside the attempt floor starts none); a parent whose
 *      subtask runs is busy on `/state`, so the box holds its step line back (the opened-box E2E witnesses the same);
 *   3. task missing from a warm (30 s old) complete set: no `taskState`, no run, exactly one refresh, through the real
 *      `createTaskFactsRefresh` (no stub);
 *   4. a held entry the page's own tracker read contradicts (review note 2): incomplete, dropped, refresh started;
 *   5. B2, the guest share route (section 8): a cold or stale holder answers `incomplete` with no state fields and makes no
 *      credential resolve or provider read; a complete holder paints the pill; a parent with a failed grandchild names no
 *      grandchild on its state reply or its page;
 *   6. D4, the first-render pill (section 9): an incomplete private or guest page paints the display-only provisional pill
 *      (a Done task with a running close-out reads running, a backlog task reads backlog, where the header's own fallback
 *      says done and idle), and offers no run (the run control's `action` is null; a guest page has no run control);
 *   7. source scans: `container=1` is gone from server code; the loader and the public share router start no refresh, and
 *      `server.js` mounts the share router with no refresh function.
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
import express from 'express';
import { createTaskPageRoutes } from '../../routes/task-page.js';
import { createTaskShareRoutes } from '../../routes/task-share.js';
import { createTaskFactsRefresh } from '../../lib/task-facts-holder.js';
import { gatherTaskStates } from '../../lib/home-row-states.js';
import { rowRecordOf } from '../../lib/task-board-view.js';
import { renderTaskStatus } from '../../lib/render-task-page.js';
import { createWorkspaceApiRoutes } from '../../routes/workspace-api.js';
import { findRouteLayer } from './lib/route-layer.js';
import { enrichLoop, deriveSessionWaiting, deriveSessionDecisions } from '../../routes/dashboard.js';
import { heldTaskFacts, heldLoaderDeps } from '../fixtures/held-task-facts.js';
import { stateBodyOf, stateIssue } from '../fixtures/state-route.js';
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

  // The readers the Done-when names beyond the row, /state and the page record: the guest share page's pill and the
  // Sessions fold's list (LIN-4070 review). Each runs through its real route; the fold's stores hold the case's own loops.
  for (const c of CASES) {
    test(`${c.name}: the share page's pill matches the page, and the Sessions fold lists the whole life /state counts`, async () => {
      const holder = holding(c.issues);
      const loader = loaderOver({ loops: c.loops, holder });
      const ctx = ctxFor(c.issues, c.task);
      const own = c.loops.filter((l) => l.issueIdentifier === c.task);
      const { model } = await loader.loadTaskState({ urlKey: URL_KEY, identifier: c.task });
      const fold = await foldOf({ task: c.task, loops: own, loadTaskState: (args) => loader.loadTaskState(args) });
      assert.equal(fold.sessions.length, own.length, 'the fold lists every session the task has (the fixture is the witness)');
      assert.equal(fold.sessions.length, model.sessions.length, 'All N: the fold lists the whole life the state read counts');
      const page = await loader.loadTaskPage({ urlKey: URL_KEY, identifier: c.task, access: providerAnswering(ctx) });
      const srv = await shareServer({ holder, loops: c.loops, ctx, task: c.task });
      try {
        const share = await (await fetch(`${srv.base}/t/${SHARE_TOKEN}/state`)).json();
        assert.equal(pillOf(share.headerHtml), pillOf(renderTaskStatus(page.model, { now: NOW, taskState: page.taskState })), 'the guest pill is the page pill');
        assert.equal(pillOf(share.headerHtml) !== null, true, 'the share pill rendered');
      } finally { await srv.close(); }
    });
  }

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

  // D2 (LIN-4070): a Done task reads done on every reader, including the words Home\'s /state line paints. Before the fix
  // the line fell through to the raw status: a Done task whose last run failed read "failed" there, beside a "done" page.
  test('a Done subtask whose last run failed: Home\'s /state line says done, the page\'s words', async () => {
    const c = CASES[1];
    const { body } = await stateBodyOf({ issues: c.issues, loops: c.loops, identifier: c.task });
    assert.equal(pillOf(body.homeStatusHtml), 'done:done', 'the /state line words the decided state');
    const page = await loaderOver({ loops: c.loops, holder: holding(c.issues) })
      .loadTaskPage({ urlKey: URL_KEY, identifier: c.task, access: providerAnswering(ctxFor(c.issues, c.task)) });
    assert.equal(pillOf(renderTaskStatus(page.model, { now: NOW, taskState: page.taskState })), 'done:done', 'the page says the same');
  });

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
    assert.equal(taskState.action.kind, 'none', 'LIN-4042: the no-run decision on a finished task');
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
function privateRouter({ holder, refresh, loops = [] }) {
  return createTaskPageRoutes({
    workspaceFromUrl: (req, res, next) => next(), getOpenRouterSource: () => 'env', getDeployInfo: () => ({}),
    loader: loaderOver({ loops, holder }), workspaceOwnerCheck: async () => ({ status: 'owner' }),
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

  // The box's busy is the gather's (LIN-4070 D7, found by the opened-box E2E): a parent whose subtask runs is busy, so the
  // box holds the step line back. A cold reply holds it back too: no step is offered on a state that is not known.
  test('a parent whose subtask runs: the state reply is busy, so the box offers no step; a cold reply is busy too', async () => {
    const issues = [issue('LIN-210', 'started'), child('LIN-211', 'LIN-210', 'started')];
    const router = privateRouter({ holder: holding(issues), refresh: () => ({ started: false, reason: 'fresh' }), loops: [loop('LIN-211')] });
    const res = await stateCall(router, 'LIN-210');
    assert.equal(res.jsonBody.taskState.state, 'running');
    assert.equal(res.jsonBody.sessions.busy, true, 'busy includes the running subtree (the gather\'s busy)');
    assert.equal(res.jsonBody.sessions.action, null, 'no main action while busy');
    const cold = privateRouter({ holder: holding(issues, new Date(NOW.getTime() - 10 * 60 * 1000)), refresh: () => ({ started: false, reason: 'fresh' }) });
    const coldRes = await stateCall(cold, 'LIN-210');
    assert.equal(coldRes.jsonBody.incomplete, 'cold');
    assert.equal(coldRes.jsonBody.sessions.busy, true, 'a cold reply holds the step line back');
  });

  // The real trigger (LIN-4070 review): the set is 30 s old, so it is fresh under the 2-minute age rule. Only the urgent
  // path of createTaskFactsRefresh starts a fetch here. A stub would hide whether /state asks for it.
  test('task missing from a warm (30 s old) complete set: no taskState, no run, exactly one refresh starts at once', async () => {
    const holder = holding([issue('LIN-150', 'started')], new Date(NOW.getTime() - 30 * 1000));
    const fetched = [];
    const refresh = createTaskFactsRefresh({
      holder, fetchAndPrepareProjects: (...args) => { fetched.push(args); return new Promise(() => {}); },
      now: () => NOW.getTime(), onError() {},
    });
    const router = privateRouter({ holder, refresh: (args) => refresh(args) });
    const res = await stateCall(router, 'LIN-151');
    assert.equal(res.jsonBody.incomplete, 'task-missing');
    assert.equal('taskState' in res.jsonBody, false, 'no taskState');
    assert.equal(res.jsonBody.sessions.action, null, 'no run is offered');
    assert.equal(fetched.length, 1, 'exactly one refresh starts');
    await stateCall(router, 'LIN-151');
    assert.equal(fetched.length, 1, 'a second poll inside the attempt floor starts nothing');
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

  test('server.js mounts the share router with no refresh function (the router\'s own scan cannot see the wiring)', () => {
    const server = readFileSync(join(repo, 'server.js'), 'utf8');
    const start = server.indexOf('app.use(createTaskShareRoutes({');
    assert.ok(start >= 0, 'the share router is mounted in server.js');
    const block = server.slice(start, server.indexOf('}))', start));
    assert.doesNotMatch(block, /refresh/i, 'the share router\'s options name no refresh');
  });

  test('the refresh is called from one place in the private task-page routes, never from a loader or the share route', () => {
    const source = codeOf(readFileSync(join(repo, 'routes', 'task-page.js'), 'utf8'));
    assert.equal((source.match(/refreshTaskFacts\(/g) || []).length, 1, 'one call site: the shared kick helper');
  });
});

// ── 7. a live task the held set lacks: the page load refreshes at once; a canceled one never does ──

describe('LIN-4070 — a page load for a task the set lacks refreshes at once when the tracker says it is live', () => {
  async function pageLoadWith(trackerType) {
    const issues = [issue('LIN-180', 'started')];
    const holder = holding(issues);
    const ctx = ctxFor([issue('LIN-181', trackerType)], 'LIN-181');
    const refreshed = [];
    const router = createTaskPageRoutes({
      workspaceFromUrl: (req, res, next) => next(), getOpenRouterSource: () => 'env', getDeployInfo: () => ({}),
      loader: loaderOver({ loops: [], holder }), workspaceOwnerCheck: async () => ({ status: 'owner' }), taskFacts: holder,
      refreshTaskFacts: (args) => { refreshed.push(args.urlKey === URL_KEY ? args.urgent : null); return { started: true, reason: 'started' }; },
      now: () => NOW,
    });
    const access = providerAnswering(ctx);
    const layer = router.stack.find((l) => l.route?.path === '/workspace/:urlKey/task/:identifier' && l.route.methods.get);
    const req = {
      session: { workspaces: [], features: {}, accountId: 'acct-1' }, workspace: { urlKey: URL_KEY, id: 'ws-1', provider: access.provider.name, accessToken: 't' },
      params: { urlKey: URL_KEY, identifier: 'LIN-181' }, query: {}, get: () => 'localhost',
    };
    const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, send(b) { this.body = b; return this; }, set() { return this; } };
    await layer.route.stack[layer.route.stack.length - 1].handle(req, res, (err) => { if (err) throw err; });
    return refreshed;
  }

  test('a started task missing from a fresh set: one refresh, started at once (urgent)', async () => {
    assert.deepEqual(await pageLoadWith('started'), [true]);
  });

  test('a canceled task missing from the set: no urgent refresh (it is never in the set)', async () => {
    assert.deepEqual(await pageLoadWith('canceled'), [false]);
  });
});

// ── 8. B2: the guest share route reads the held facts only (LIN-4070 review: the route had no witness) ──

const SHARE_TOKEN = 'A'.repeat(43);
const SHARE_RECORD = {
  _id: 'share-b2', tokenHash: 'hash-b2', urlKey: URL_KEY, workspaceId: 'ws-1', ownerAccountId: 'acct-1',
  issueIdentifier: 'LIN-200', issueId: 'id-LIN-200', source: 'linear', createdAt: NOW, revokedAt: null,
};

/** A provider whose tracker read answers `ctx` and counts each call; `spy.providerCalls` is the witness. */
function countingAccess(ctx, spy) {
  const name = `lin-4070-share-${Math.random().toString(36).slice(2)}`;
  const provider = registerProvider({
    name, ui: { inlineEdit: false, inlineCreate: false }, supports: () => true,
    fetchRecommendationContext: async () => { spy.providerCalls += 1; return ctx; },
    fetchIssueComments: async () => [], fetchIssueFields: async () => null, fetchProjects: async () => ({ projects: [] }),
  });
  return { provider, callScope: null };
}

/**
 * The guest share router over the real loader, wired the way server.js wires it: the loader gets the holder's read side,
 * and the router is built with no refresh function at all. `spy` counts credential resolves and provider reads.
 */
async function shareServer({ holder, loops = [], ctx = null, task = 'LIN-200' }) {
  const spy = { guest: 0, providerCalls: 0 };
  const app = express();
  const record = { ...SHARE_RECORD, issueIdentifier: task, issueId: `id-${task}` };
  app.use(createTaskShareRoutes({
    taskShareStore: { getByToken: async (token) => (token === SHARE_TOKEN ? record : null) },
    loader: loaderOver({ loops, holder }),
    workspaceFromUrl: (req, res, next) => next(),
    workspaceOwnerCheck: async () => ({ status: 'owner' }),
    guestAccess: async () => { spy.guest += 1; return countingAccess(ctx, spy); },
    getDeployInfo: () => ({}), now: () => NOW,
  }));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  return { base: `http://127.0.0.1:${server.address().port}`, spy, close: () => new Promise((r) => server.close(r)) };
}

/** The pill's tone and label, read from rendered task-status markup (`renderTaskStatus`), or null when there is none. */
function pillOf(html) {
  const m = String(html || '').match(/status-pill--(\w+) task-status-pill[\s\S]*?<\/span>([^<]*)<\/span>/);
  return m ? `${m[1]}:${m[2]}` : null;
}

/**
 * The Sessions fold's list for one task, through the real route (`lin-4016` drives it the same way). The stores hold one
 * dispatch item per loop, so the fold's whole-life read returns the same loops the state read counts.
 */
async function foldOf({ task, loops, loadTaskState }) {
  const items = loops.map((l) => ({ id: l.loopId, kind: l.kind, promptName: l.kind, issueIdentifier: task, dispatchedAt: l.dispatchedAt, status: 'done', target: 'cli' }));
  const router = createWorkspaceApiRoutes({
    workspaceFromUrl: (req, res, next) => next(),
    dispatchQueueStore: { listItems: async () => [], listHistory: async () => ({ items }) },
    agentStatusStore: { listStatus: async () => ({ items: [] }) },
    loadTaskState,
  });
  const layer = findRouteLayer(router, 'get', '/workspace/:urlKey/api/sessions/:identifier');
  const req = { workspace: { urlKey: URL_KEY }, params: { urlKey: URL_KEY, identifier: task }, query: {} };
  const res = { statusCode: 200, jsonBody: null, status(code) { this.statusCode = code; return this; }, json(body) { this.jsonBody = body; return this; } };
  await layer.route.stack[layer.route.stack.length - 1].handle(req, res, (err) => { if (err) throw err; });
  return res.jsonBody;
}

describe('LIN-4070 B2 — /t/:token/state reads the held facts only', () => {
  test('a cold holder: incomplete with no state fields; no credential resolve, no provider read, no fetch', async () => {
    const srv = await shareServer({ holder: holding([issue('LIN-200', 'started')], new Date(NOW.getTime() - 10 * 60 * 1000)) });
    try {
      const res = await fetch(`${srv.base}/t/${SHARE_TOKEN}/state`);
      const body = await res.json();
      assert.equal(res.status, 200);
      assert.equal(body.incomplete, 'cold');
      for (const key of ['status', 'live', 'headerHtml']) assert.equal(key in body, false, `no ${key} while incomplete`);
      assert.equal(srv.spy.guest, 0, 'no credential resolve');
      assert.equal(srv.spy.providerCalls, 0, 'no provider read');
    } finally { await srv.close(); }
  });

  test('a complete holder: the pill and track paint through maskFragment, with no credential resolve and no provider read', async () => {
    const srv = await shareServer({ holder: holding([issue('LIN-200', 'started')]), loops: [loop('LIN-200')] });
    try {
      const body = await (await fetch(`${srv.base}/t/${SHARE_TOKEN}/state`)).json();
      assert.equal(body.incomplete, undefined);
      assert.equal(body.status, 'running');
      assert.match(body.headerHtml, /task-status-pill/);
      assert.equal(srv.spy.guest, 0);
      assert.equal(srv.spy.providerCalls, 0);
    } finally { await srv.close(); }
  });

  test('N7: a parent with a failed grandchild shares no grandchild identifier on the state reply or the page', async () => {
    const issues = [issue('LIN-200', 'started'), child('LIN-201', 'LIN-200', 'started'), child('LIN-202', 'LIN-201', 'started')];
    const loops = [failedLoop('LIN-202', 2)];
    const ctx = ctxFor(issues, 'LIN-200');
    const srv = await shareServer({ holder: holding(issues), loops, ctx });
    try {
      const state = await (await fetch(`${srv.base}/t/${SHARE_TOKEN}/state`)).text();
      const page = await (await fetch(`${srv.base}/t/${SHARE_TOKEN}`)).text();
      assert.match(page, /task-status-pill/, 'the page rendered (so the absence below is not an empty body)');
      assert.match(state, /task-status-pill/, 'the state reply rendered its pill');
      assert.doesNotMatch(state, /LIN-202/, 'the state reply names no grandchild');
      assert.doesNotMatch(page, /LIN-202/, 'the page names no grandchild');
    } finally { await srv.close(); }
  });
});

// ── 9. D4: an incomplete page paints the provisional pill and offers no run (LIN-4070 re-review) ──

/** The private task page's HTML for `task`, through the real route over `holder` and the tracker read `ctx`. */
async function privatePageHtml({ holder, loops, ctx, task }) {
  const router = createTaskPageRoutes({
    workspaceFromUrl: (req, res, next) => next(), getOpenRouterSource: () => 'env', getDeployInfo: () => ({}),
    loader: loaderOver({ loops, holder }), workspaceOwnerCheck: async () => ({ status: 'owner' }), taskFacts: holder,
    refreshTaskFacts: () => ({ started: true, reason: 'started' }), now: () => NOW,
  });
  const access = providerAnswering(ctx);
  const layer = router.stack.find((l) => l.route?.path === '/workspace/:urlKey/task/:identifier' && l.route.methods.get);
  const req = {
    session: { workspaces: [], features: {}, accountId: 'acct-1' }, workspace: { urlKey: URL_KEY, id: 'ws-1', provider: access.provider.name, accessToken: 't' },
    params: { urlKey: URL_KEY, identifier: task }, query: {}, get: () => 'localhost',
  };
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, send(b) { this.body = b; return this; }, set() { return this; } };
  await layer.route.stack[layer.route.stack.length - 1].handle(req, res, (err) => { if (err) throw err; });
  return res.body;
}

/** The run control's decision record (`row`) the page hands the browser, read from the mount's `data-run-opts`. */
function runRowOf(html) {
  const m = String(html || '').match(/data-run-opts="([^"]*)"/);
  if (!m) return null;
  const unescaped = m[1].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  return JSON.parse(unescaped).row;
}

describe('LIN-4070 D4 — an incomplete page paints the provisional pill and offers no run', () => {
  // The provisional pill is the gatherer over the page's own detail read: the tracker's types for the task and its direct
  // subtasks, and the task's own sessions. (The page load reads no subtask's sessions; the plan's residual says the pill may
  // differ for one poll on a parent with deep descendants.) Two fixtures tell it from the header's own fallback, which
  // reads `done` for a Done task whatever runs and `idle` for a backlog one:
  //   - a Done task with a running close-out: provisional says `running` (the D2 guard), the fallback `done`;
  //   - a backlog task: provisional says `backlog`, the fallback `idle`.
  const DONE_RUNNING = [issue('LIN-220', 'completed')];
  const DONE_RUNNING_LOOPS = [loop('LIN-220')];
  const BACKLOG = [issue('LIN-221', 'backlog')];
  const LIVE = [issue('LIN-200', 'started'), child('LIN-201', 'LIN-200', 'started')];
  const LIVE_LOOPS = [loop('LIN-200')];
  const cold = (issues) => holding(issues, new Date(NOW.getTime() - 10 * 60 * 1000));

  test('private page, cold holder: a Done task with a running close-out paints running; a backlog task paints backlog', async () => {
    const running = await privatePageHtml({ holder: cold(DONE_RUNNING), loops: DONE_RUNNING_LOOPS, ctx: ctxFor(DONE_RUNNING, 'LIN-220'), task: 'LIN-220' });
    assert.equal(pillOf(running), 'running:running', 'the display-only pill is the gather\'s word, not the header\'s `done`');
    const backlog = await privatePageHtml({ holder: cold(BACKLOG), loops: [], ctx: ctxFor(BACKLOG, 'LIN-221'), task: 'LIN-221' });
    assert.equal(pillOf(backlog), 'queued:backlog', 'the display-only pill is the gather\'s word, not the header\'s `idle`');
  });

  test('guest share page, cold holder: a Done task with a running close-out paints running; a backlog task paints backlog', async () => {
    const paint = async (issues, loops, task) => {
      const srv = await shareServer({ holder: cold(issues), loops, ctx: ctxFor(issues, task), task });
      try { return pillOf(await (await fetch(`${srv.base}/t/${SHARE_TOKEN}`)).text()); } finally { await srv.close(); }
    };
    assert.equal(await paint(DONE_RUNNING, DONE_RUNNING_LOOPS, 'LIN-220'), 'running:running');
    assert.equal(await paint(BACKLOG, [], 'LIN-221'), 'queued:backlog');
  });

  test('private page, cold holder, a live task: the run control carries no action and the page offers no Run to PR', async () => {
    const html = await privatePageHtml({ holder: cold(LIVE), loops: LIVE_LOOPS, ctx: ctxFor(LIVE, 'LIN-200'), task: 'LIN-200' });
    assert.equal(pillOf(html)?.startsWith('running:'), true, `the page paints a pill while incomplete, got ${pillOf(html)}`);
    const row = runRowOf(html);
    assert.notEqual(row, null, 'the owner page mounts the run control');
    assert.equal(row.action, null, 'no run is offered while incomplete');
    assert.doesNotMatch(html, /opened-task-go|Run to PR/);
  });

  test('guest share page, cold holder, a live task: the page has no run control at all', async () => {
    const srv = await shareServer({ holder: cold(LIVE), loops: LIVE_LOOPS, ctx: ctxFor(LIVE, 'LIN-200') });
    try {
      const html = await (await fetch(`${srv.base}/t/${SHARE_TOKEN}`)).text();
      assert.match(html, /task-status-pill/, 'the page painted a pill');
      assert.doesNotMatch(html, /data-run-opts|opened-task-go|Run to PR/);
    } finally { await srv.close(); }
  });

  test('control: a complete holder on an idle task does offer an action, so the null above is the incomplete branch', async () => {
    const issues = [issue('LIN-210', 'started')];
    const html = await privatePageHtml({ holder: holding(issues), loops: [], ctx: ctxFor(issues, 'LIN-210'), task: 'LIN-210' });
    assert.notEqual(runRowOf(html)?.action ?? null, null, 'a complete read offers the next action');
  });
});
