/**
 * Unit tests for the cascade subtree walk + expansion (LIN-946, beat 2).
 *
 * `collectCascadeTargets(urlKey, root)` recursively enumerates a root autopilot
 * session's whole descendant subtree using the per-level `sessionId` lineage
 * (direct children carry `sessionId=parent`; a child autopilot stamps ITS workers
 * with its own `_id`, so the walk recurses into each child autopilot's id). Both
 * the live queue and history are scanned per level; a `visited` set makes it
 * cycle-safe. `expandCascadeAborts(...)` turns that set into one plain
 * `abort`/`abortTo` item per session, with NO `sessionId` (Observation-safety) so
 * the cascade's aborts never enter the sessions feed.
 *
 * The maybe-interactive / human-continued skip is the runner's job (LIN-951) and
 * the `[skipped]` token handling is beat 3 — not exercised here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { createMockCollection } from '../fixtures/mock-collection.js';

function makeStore() {
  return new DispatchQueueStore({
    collection: createMockCollection(),
    historyCollection: createMockCollection()
  });
}

test('collectCascadeTargets walks the whole subtree, root first, across live + history', async () => {
  const store = makeStore();

  // root autopilot — its own _id is the session id.
  const root = await store.addItem('acme', { prompt: 'root', kind: 'autopilot' });
  // direct workers of root (one live, one archived to history).
  const wLive = await store.addItem('acme', { prompt: 'w-live', sessionId: root._id });
  const wHist = await store.addItem('acme', { prompt: 'w-hist', sessionId: root._id });
  await store.takeItem(wHist._id, 'acme'); // move wHist to history
  // a child autopilot of root — stamps ITS workers with its OWN id.
  const child = await store.addItem('acme', { prompt: 'child', kind: 'autopilot', sessionId: root._id });
  const grand = await store.addItem('acme', { prompt: 'grand', sessionId: child._id });

  const targets = await store.collectCascadeTargets('acme', root._id);

  assert.equal(targets[0], root._id, 'root is closed first');
  assert.deepEqual(
    [...targets].sort(),
    [root._id, wLive._id, wHist._id, child._id, grand._id].sort(),
    'every session in the subtree is collected exactly once'
  );
  assert.equal(targets.length, 5);
});

test('collectCascadeTargets de-dupes and returns a lone root for a childless session', async () => {
  const store = makeStore();
  const root = await store.addItem('acme', { prompt: 'root', kind: 'autopilot' });

  const targets = await store.collectCascadeTargets('acme', root._id);

  assert.deepEqual(targets, [root._id]);
});

test('collectCascadeTargets is cycle-safe (mutual + self reference terminate)', async () => {
  const store = makeStore();
  const future = new Date(Date.now() + 1_000_000);

  // A ⇄ B mutual reference: A's child list contains B and B's contains A.
  store.collection._docs.push(
    { _id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', urlKey: 'acme', kind: 'autopilot', sessionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', expiresAt: future },
    { _id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', urlKey: 'acme', kind: 'autopilot', sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', expiresAt: future }
  );
  const cycle = await store.collectCascadeTargets('acme', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  assert.deepEqual([...cycle].sort(), [
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  ].sort());

  // Self reference: an autopilot whose own worker points back at itself.
  store.collection._docs.push(
    { _id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', urlKey: 'acme', kind: 'autopilot', sessionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', expiresAt: future }
  );
  const selfCycle = await store.collectCascadeTargets('acme', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
  assert.deepEqual(selfCycle, ['cccccccc-cccc-4ccc-8ccc-cccccccccccc']);
});

test('expandCascadeAborts emits one plain abort per session, no sessionId (Observation-safe)', async () => {
  const store = makeStore();
  const root = await store.addItem('acme', { prompt: 'root', kind: 'autopilot' });
  const worker = await store.addItem('acme', { prompt: 'w', sessionId: root._id });

  const result = await store.expandCascadeAborts('acme', root._id, { target: 'cli' });

  assert.equal(result.count, 2);
  assert.equal(result.closed.length, 2);
  // The emitted set aborts exactly the discovered sessions.
  assert.deepEqual(
    result.closed.map(c => c.abortTo).sort(),
    [root._id, worker._id].sort()
  );

  // Read the emitted abort items back off the queue and assert their shape.
  const live = await store.pollAvailable('acme');
  const emitted = live.filter(i => i.abort === true);
  assert.equal(emitted.length, 2);
  for (const abortItem of emitted) {
    assert.equal(abortItem.abort, true);
    assert.ok(abortItem.abortTo, 'carries an abortTo');
    assert.equal(abortItem.target, 'cli', 'inherits the cascade target');
    assert.equal(abortItem.sessionId, null, 'no sessionId → never enters the Observation feed');
    assert.notEqual(abortItem.kind, 'autopilot', 'not an autopilot kind → feed-notify gate stays shut');
    assert.equal(abortItem.cascade, false, 'emitted aborts are plain — the runner never sees cascade');
    assert.equal(abortItem.prompt, null, 'an abort carries no prompt');
  }
});

test('expandCascadeAborts inherits the target and is safely re-issuable (idempotent)', async () => {
  const store = makeStore();
  const root = await store.addItem('acme', { prompt: 'root', kind: 'autopilot' });

  const first = await store.expandCascadeAborts('acme', root._id, { target: 'dash' });
  assert.equal(first.count, 1);
  assert.equal(first.closed[0].target, 'dash');

  // Re-issuing the cascade re-emits harmless aborts and never throws — closing an
  // already-terminal session is a safe downstream no-op (the runner settles it).
  const second = await store.expandCascadeAborts('acme', root._id, { target: 'dash' });
  assert.equal(second.count, 1);
});

test('collectCascadeTargets returns [] on a missing root/urlKey', async () => {
  const store = makeStore();
  assert.deepEqual(await store.collectCascadeTargets('', 'x'), []);
  assert.deepEqual(await store.collectCascadeTargets('acme', ''), []);
});
