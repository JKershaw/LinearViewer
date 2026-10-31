/**
 * LIN-4069 (piece A of LIN-4068): the batched subtree read, `getLoopsForIssues`.
 *
 * Two witnesses. (1) Over the REAL stores on a real MangoDB engine: one `$in` read per store, returning the same loops as
 * the per-task reads it replaces. (2) N2: a retry chain and an agent-status row that straddle the 30-day boundary give
 * the same state and action from the lean windowed subtree read (`getLoopsForIssues`, what Home and `/state` read) as
 * from the whole-life per-task read (`getLoopsForIssue` with `horizon: 'all'`, what the task's own history reads).
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { AgentStatusStore } from '../../lib/agent-status-store.js';
import { getLoopsForIssues, getLoopsForIssue } from '../../lib/pipeline-loops.js';
import { gatherTaskStates } from '../../lib/home-row-states.js';
import { inReadWindow } from '../../lib/read-horizon.js';
import { enrichLoop, deriveSessionWaiting } from '../../routes/dashboard.js';

const shape = (loops) => loops.map((l) => [l.loopId, l.issueIdentifier, l.agentState, l.kind]).sort((a, b) => a[0].localeCompare(b[0]));

describe('one $in read per store, over the real stores (LIN-4069)', () => {
  const harness = createMangoTmpdir('lin-4069-');
  let db;
  before(() => harness.connect());
  after(() => harness.client.close?.());

  test('the subtree read is one batched read per store and returns the per-task and workspace reads’ loops', async () => {
    db = harness.freshDb();
    const dispatchStore = new DispatchQueueStore({ collection: db.collection('q'), historyCollection: db.collection('h') });
    const agentStatusStore = new AgentStatusStore({ collection: db.collection('s') });
    const deps = { dispatchStore, agentStatusStore };
    for (const id of ['LIN-1', 'LIN-2', 'LIN-3', 'LIN-9']) {
      const a = await dispatchStore.addItem('acme', { prompt: `p ${id}`, issueIdentifier: id, kind: 'implementation' });
      await dispatchStore.addItem('acme', { prompt: `q ${id}`, issueIdentifier: id, kind: 'review' });
      assert.ok(await dispatchStore.removeItem('acme', a._id ?? a.id), 'archived to history');
      await agentStatusStore.recordStatus({ urlKey: 'acme', taskIdentifier: id, action: 'working', status: 'running', summary: 's', dispatchId: a._id ?? a.id });
    }
    const subtree = ['LIN-1', 'LIN-2', 'LIN-3'];

    const calls = { live: 0, history: 0, status: 0 };
    const count = (obj, name, key) => {
      const f = obj[name].bind(obj);
      obj[name] = (...args) => { calls[key] += 1; return f(...args); };
    };
    count(dispatchStore, 'listItems', 'live');
    count(dispatchStore, 'listHistory', 'history');
    count(agentStatusStore, 'listStatus', 'status');

    const batched = await getLoopsForIssues('acme', subtree, deps);
    assert.deepEqual(calls, { live: 1, history: 1, status: 1 }, 'one read per store, whatever the subtree size');

    const perTask = (await Promise.all(subtree.map((id) => getLoopsForIssue('acme', id, deps)))).flat();
    assert.equal(batched.length, 6, 'two loops per task, three tasks');
    assert.deepEqual(shape(batched), shape(perTask));
    assert.ok(batched.every((l) => l.issueIdentifier !== 'LIN-9'), 'a task outside the subtree is not read');
  });

  test('an empty subtree is read as nothing, with no store call', async () => {
    db = harness.freshDb();
    const dispatchStore = new DispatchQueueStore({ collection: db.collection('q'), historyCollection: db.collection('h') });
    const agentStatusStore = new AgentStatusStore({ collection: db.collection('s') });
    let calls = 0;
    const counted = { dispatchStore, agentStatusStore };
    const f = dispatchStore.listItems.bind(dispatchStore);
    dispatchStore.listItems = (...args) => { calls += 1; return f(...args); };
    assert.deepEqual(await getLoopsForIssues('acme', [], counted), []);
    assert.equal(calls, 0);
  });
});

/**
 * Mock stores that honour `since` on both reads, as the real stores do (`dispatchedAt` and `timestamp` at or after it),
 * and accept an identifier or an array of them (`$in`).
 */
function boundaryStores({ history = [], status = [] }) {
  const pick = (rows, key, ids) => (ids === undefined ? rows : (Array.isArray(ids) ? rows.filter((r) => ids.includes(r[key])) : rows.filter((r) => r[key] === ids)));
  return {
    dispatchStore: {
      async listItems() { return []; },
      async listHistory(_urlKey, options = {}) {
        let items = pick(history, 'issueIdentifier', options.issueIdentifier);
        if (options.since) items = items.filter((r) => new Date(r.dispatchedAt).getTime() >= options.since.getTime());
        return { items, total: items.length };
      },
    },
    agentStatusStore: {
      async listStatus(_urlKey, options = {}) {
        let items = pick(status, 'taskIdentifier', options.taskIdentifier);
        if (options.since) items = items.filter((r) => new Date(r.timestamp).getTime() >= options.since.getTime());
        return { items, total: items.length };
      },
    },
  };
}

describe('the 30-day boundary: the windowed subtree read and the whole-life read agree (LIN-4069, N2)', () => {
  const NOW = Date.now();
  const at = (days, min = 0) => new Date(NOW - days * 86400000 - min * 60000).toISOString();
  const issue = (identifier, type, parent = null) => ({
    id: `id-${identifier}`, identifier, title: identifier, state: { name: type, type }, parent: parent ? { id: `id-${parent}` } : null,
  });
  // A retry chain for T-8: implementation done 31 days ago, a review failed at 29 days, a retry running now. The
  // iteration of the retry is computed across the chain, so a store that drops the 31-day row must not change the read.
  const history = [
    { id: 'h-impl', issueIdentifier: 'T-8', issueId: 'id-T-8', promptName: 'implementation', prompt: 'p', status: 'taken', lineageStatus: 'resolved', dispatchedAt: at(31), resolvedAt: at(31, -60), takenByTokenLabel: 'c', feedback: [], workspace: { urlKey: 'acme' }, target: 'cli', dispatchedBy: 'u', issueTitle: 'T-8', issueUrl: 'https://x/T-8', terminalStatus: 'done', terminalCompletedAt: at(31, -60) },
    { id: 'h-rev', issueIdentifier: 'T-8', issueId: 'id-T-8', promptName: 'review', prompt: 'p', status: 'taken', lineageStatus: 'resolved', dispatchedAt: at(29), resolvedAt: at(29, -30), takenByTokenLabel: 'c', feedback: [], workspace: { urlKey: 'acme' }, target: 'cli', dispatchedBy: 'u', issueTitle: 'T-8', issueUrl: 'https://x/T-8', terminalStatus: 'failed', terminalCompletedAt: at(29, -30) },
    { id: 'h-t7', issueIdentifier: 'T-7', issueId: 'id-T-7', promptName: 'research', prompt: 'p', status: 'taken', lineageStatus: 'resolved', dispatchedAt: at(40), resolvedAt: at(40, -60), takenByTokenLabel: 'c', feedback: [], workspace: { urlKey: 'acme' }, target: 'cli', dispatchedBy: 'u', issueTitle: 'T-7', issueUrl: 'https://x/T-7', terminalStatus: 'done', terminalCompletedAt: at(40, -60) },
  ];
  // An agent-status row for T-8 at 31 days (outside) and one at 29 days (inside).
  const status = [
    { taskIdentifier: 'T-8', dispatchId: 'h-impl', action: 'working', status: 'running', timestamp: at(31) },
    { taskIdentifier: 'T-8', dispatchId: 'h-rev', action: 'working', status: 'failed', timestamp: at(29) },
  ];
  const issues = [issue('T-7', 'started'), issue('T-8', 'started', 'T-7')];

  test('the states and actions from the lean windowed read equal the whole-life read, for every task', async () => {
    const stores = boundaryStores({ history, status });
    const windowed = await getLoopsForIssues('acme', ['T-7', 'T-8'], stores);
    const whole = (await Promise.all(['T-7', 'T-8'].map((id) => getLoopsForIssue('acme', id, { ...stores, horizon: 'all' })))).flat();
    assert.ok(whole.length > windowed.length, 'the whole-life read holds the 31-day rows the window drops');

    const fromWindowed = gatherTaskStates({ issues, loops: windowed, at: new Date(NOW), enrichLoop, deriveSessionWaiting }).states;
    const fromWhole = gatherTaskStates({ issues, loops: whole, at: new Date(NOW), enrichLoop, deriveSessionWaiting }).states;
    for (const id of ['T-7', 'T-8']) {
      assert.equal(fromWindowed.get(id).state, fromWhole.get(id).state, `${id} state`);
      assert.deepEqual(fromWindowed.get(id).action, fromWhole.get(id).action, `${id} action`);
      assert.equal(fromWindowed.get(id).container, fromWhole.get(id).container, `${id} container`);
    }
  });

  test('every loop the windowed read holds is inside the read window', async () => {
    const windowed = await getLoopsForIssues('acme', ['T-7', 'T-8'], boundaryStores({ history, status }));
    assert.ok(windowed.every((l) => inReadWindow(l.dispatchedAt, new Date(NOW))));
  });
});
