/**
 * LIN-4068 spike: the batched subtree read (`getLoopsForIssues`) over the REAL stores on a real MangoDB instance. One
 * `$in` read per store returns the same loops as the per-task reads it replaces, and the same loops Home's lean
 * workspace read holds for those tasks (so `/state` and Home decide from one set of facts).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MangoClient } from '@jkershaw/mangodb';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { AgentStatusStore } from '../../lib/agent-status-store.js';
import { getLoopsForIssues, getLoopsForIssue, getLoopsForWorkspace } from '../../lib/pipeline-loops.js';

let client;
let dir;
before(async () => { dir = mkdtempSync(join(tmpdir(), 'lin-4068-')); client = new MangoClient(dir); await client.connect(); });
after(async () => { await client?.close?.(); rmSync(dir, { recursive: true, force: true }); });

const shape = (loops) => loops.map((l) => [l.loopId, l.issueIdentifier, l.agentState, l.kind]).sort((a, b) => a[0].localeCompare(b[0]));

test('one $in read per store returns the subtree loops the per-task and workspace reads give', async () => {
  const db = client.db('lin4068');
  const dispatchStore = new DispatchQueueStore({ collection: db.collection('q'), historyCollection: db.collection('h') });
  const agentStatusStore = new AgentStatusStore({ collection: db.collection('s') });
  const deps = { dispatchStore, agentStatusStore };
  const ids = ['LIN-1', 'LIN-2', 'LIN-3', 'LIN-9'];
  for (const id of ids) {
    const a = await dispatchStore.addItem('acme', { prompt: `p ${id}`, issueIdentifier: id, kind: 'implementation' });
    const b = await dispatchStore.addItem('acme', { prompt: `q ${id}`, issueIdentifier: id, kind: 'review' });
    assert.ok(await dispatchStore.removeItem('acme', a._id ?? a.id), 'archived to history');
    await agentStatusStore.recordStatus({ urlKey: 'acme', taskIdentifier: id, action: 'working', status: 'running', summary: 's', dispatchId: a._id ?? a.id });
    void b;
  }
  const subtree = ['LIN-1', 'LIN-2', 'LIN-3'];
  // Both stores' rows are present: the removed item is in history, the other is still queued.
  assert.equal((await dispatchStore.listHistory('acme', { since: new Date(0) })).items.length, 4);
  assert.equal((await dispatchStore.listItems('acme')).length, 4);

  const calls = { live: 0, history: 0, status: 0 };
  const count = (obj, name, key) => { const f = obj[name].bind(obj); obj[name] = (...args) => { calls[key] += 1; return f(...args); }; };
  count(dispatchStore, 'listItems', 'live');
  count(dispatchStore, 'listHistory', 'history');
  count(agentStatusStore, 'listStatus', 'status');
  const batched = await getLoopsForIssues('acme', subtree, deps);
  assert.deepEqual(calls, { live: 1, history: 1, status: 1 }, 'one read per store, whatever the subtree size');

  const perTask = (await Promise.all(subtree.map((id) => getLoopsForIssue('acme', id, deps)))).flat();
  const workspace = (await getLoopsForWorkspace('acme', { ...deps, lean: true })).filter((l) => subtree.includes(l.issueIdentifier));
  assert.equal(batched.length, 6);
  assert.deepEqual(shape(batched), shape(perTask));
  assert.deepEqual(shape(batched), shape(workspace));
  assert.ok(batched.every((l) => l.issueIdentifier !== 'LIN-9'), 'a task outside the subtree is not read');
});
