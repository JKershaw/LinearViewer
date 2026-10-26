/**
 * LIN-3975 (PR 2, review finding 1): an attempt's run link must open a run page that shows the attempt.
 *
 * The task page links each attempt to the session the session ledger assigns it (`sessionIdOf`). That id is
 * only useful if `readSessionById` resolves it to a session that contains the attempt. A wake row on issue B
 * that continues a run on issue A carries A's `sessionGroupId` but no `sessionId` stamp, so the point read
 * (which scopes by the root's issue and `sessionId` stamps) never reads issue B, and the wake is dropped.
 *
 * Run with: node --test tests/unit/lin-3975-run-link-resolve.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { readSessionById } from '../../lib/dispatch-session-read.js';
import { getLoopsForIssue, getLoopsForWorkspace, sessionIdByLoop } from '../../lib/pipeline-loops.js';
import { sessionIdOf } from '../../lib/live-console.js';
import { runIdsOf } from '../../lib/task-page-loader.js';
import { createMockCollection } from '../fixtures/mock-collection.js';

const URL_KEY = 'acme';

function world() {
  const queue = createMockCollection();
  const history = createMockCollection();
  const store = new DispatchQueueStore({ collection: queue, historyCollection: history });
  const agentStatusStore = { listStatus: async () => ({ items: [], total: 0 }) };
  return { store, queue, history, deps: { dispatchStore: store, agentStatusStore } };
}

/** A taken run on `issueIdentifier`, the way the consumer leaves it once it has run. */
async function taken(store, over) {
  const row = await store.addItem(URL_KEY, { prompt: 'p', ...over });
  await store.takeItem(row._id, URL_KEY, 't');
  return row;
}

describe('LIN-3975 — readSessionById resolves a run link to a session that shows the attempt', () => {
  test('a wake on issue B that continues a run on issue A is in the session the link opens', async () => {
    const { store, deps } = world();
    const anchor = await taken(store, { kind: 'implementation', issueIdentifier: 'LIN-A' });
    const wake = await taken(store, {
      kind: 'wake',
      issueIdentifier: 'LIN-B',
      followUpTo: anchor._id,
      sessionGroupId: anchor._id,
    });

    const session = await readSessionById(URL_KEY, anchor._id, deps);

    assert.ok(session, 'the run resolves');
    const loopIds = new Set(session.loops.map(l => l.loopId));
    assert.ok(loopIds.has(anchor._id), 'the anchor is in its own run');
    assert.ok(loopIds.has(wake._id), 'the wake on issue B is in the run the link opens');
  });
});

/**
 * Every link the task page draws for one issue must open a run page that shows that attempt, and the
 * link must be the id Live Console links to (`sessionIdOf` over the workspace loops). `runIdsOf` is the
 * production path; `readSessionById` is the run page's own resolve.
 */
async function assertLinksResolve(deps, issue, now) {
  const taskLoops = await getLoopsForIssue(URL_KEY, issue, deps);
  const links = runIdsOf(URL_KEY, taskLoops, now);
  const workspaceLoops = (await getLoopsForWorkspace(URL_KEY, deps)).map(l => ({ ...l, workspaceUrlKey: URL_KEY }));
  const liveConsoleIds = sessionIdByLoop(workspaceLoops, { now });
  assert.ok(taskLoops.length > 0, `${issue} has attempts`);
  for (const lp of taskLoops) {
    const runId = links.get(lp.loopId);
    assert.ok(runId, `${issue} attempt ${lp.loopId} has a link`);
    assert.equal(runId, sessionIdOf({ ...lp, workspaceUrlKey: URL_KEY }, liveConsoleIds), `${issue} attempt ${lp.loopId} links to the Live Console run`);
    const run = await readSessionById(URL_KEY, runId, deps);
    assert.ok(run, `${issue} attempt ${lp.loopId}: the run page resolves ${runId}`);
    assert.ok(run.loops.some(l => l.loopId === lp.loopId), `${issue} attempt ${lp.loopId} is in the run it links to`);
  }
}

describe('LIN-3975 — every link resolves on the run page to a run that shows its attempt', () => {
  test('a stamped autopilot worker (sessionId = its anchor)', async () => {
    const { store, deps } = world();
    const anchor = await taken(store, { kind: 'autopilot', issueIdentifier: 'LIN-1' });
    await taken(store, { issueIdentifier: 'LIN-2', sessionId: anchor._id });
    await assertLinksResolve(deps, 'LIN-2', new Date());
  });

  test('a standalone dispatch', async () => {
    const { store, deps } = world();
    await taken(store, { kind: 'implementation', issueIdentifier: 'LIN-9' });
    await assertLinksResolve(deps, 'LIN-9', new Date());
  });

  test('a same-issue follow-up chain', async () => {
    const { store, deps } = world();
    const root = await taken(store, { kind: 'implementation', issueIdentifier: 'LIN-5' });
    await taken(store, { issueIdentifier: 'LIN-5', followUpTo: root._id, sessionGroupId: root._id });
    await assertLinksResolve(deps, 'LIN-5', new Date());
  });

  test('a two-issue run: a wake on LIN-B continues LIN-A, and each issue links to the run both show', async () => {
    const { store, deps } = world();
    const anchor = await taken(store, { kind: 'implementation', issueIdentifier: 'LIN-A' });
    await taken(store, { kind: 'wake', issueIdentifier: 'LIN-B', followUpTo: anchor._id, sessionGroupId: anchor._id });
    await assertLinksResolve(deps, 'LIN-A', new Date());
    await assertLinksResolve(deps, 'LIN-B', new Date());
  });

  test('an unstamped historical follow-up (a pre-LIN-1341 row: no group id, only its followUpTo chain)', async () => {
    const { store, queue, history, deps } = world();
    const root = await taken(store, { kind: 'implementation', issueIdentifier: 'LIN-7' });
    const reply = await taken(store, { issueIdentifier: 'LIN-7', followUpTo: root._id });
    for (const c of [queue, history]) await c.updateOne({ _id: reply._id }, { $set: { sessionGroupId: null } });
    await assertLinksResolve(deps, 'LIN-7', new Date());
  });
});
