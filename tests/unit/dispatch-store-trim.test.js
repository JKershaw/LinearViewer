/**
 * Unit tests for `trimSessionBudget` (LIN-2147, graceful trim).
 *
 * Mirrors tests/unit/dispatch-store-task-budget.test.js's pattern for the
 * sibling `maxTasks` field this trims. Two layers:
 *
 *  1. The store method in isolation (validation, not-found/not-downward
 *     refusals, queue-vs-history resolution, audit trail, formatter
 *     threading) — this file.
 *  2. End-to-end against the REAL `createDispatchItem` guard (LIN-1751),
 *     proving the acceptance sketch directly: a trimmed run refuses a new
 *     task but keeps admitting the current one's continuation — the
 *     "describe('trim + the LIN-1751 guard, end-to-end')" block below.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { createDispatchItem } from '../../lib/dispatch-factory.js';
import { createMockCollection } from '../fixtures/mock-collection.js';

function makeStore() {
  return new DispatchQueueStore({
    collection: createMockCollection(),
    historyCollection: createMockCollection()
  });
}

describe('trimSessionBudget — validation', () => {
  test('rejects a non-integer maxTasks', async () => {
    const store = makeStore();
    const result = await store.trimSessionBudget('acme', 'run-1', 2.5);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'invalid-input');
  });

  test('rejects maxTasks < 1', async () => {
    const store = makeStore();
    const result = await store.trimSessionBudget('acme', 'run-1', 0);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'invalid-input');
  });

  test('rejects a missing urlKey/sessionId', async () => {
    const store = makeStore();
    assert.equal((await store.trimSessionBudget(null, 'run-1', 3)).reason, 'invalid-input');
    assert.equal((await store.trimSessionBudget('acme', null, 3)).reason, 'invalid-input');
  });
});

describe('trimSessionBudget — not-found / not-downward', () => {
  test('an unknown run is not-found', async () => {
    const store = makeStore();
    const result = await store.trimSessionBudget('acme', 'nonexistent', 2);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'not-found');
  });

  test('a bound already <= the requested value is refused as not-downward', async () => {
    const store = makeStore();
    await store.addItem('acme', { prompt: 'run me', kind: 'autopilot', maxTasks: 5 });
    const items = await store.pollAvailable('acme');
    const runId = items[0].id;

    const same = await store.trimSessionBudget('acme', runId, 5);
    assert.equal(same.ok, false);
    assert.equal(same.reason, 'not-downward', 'trimming to the SAME value does not tighten the bound');

    const wider = await store.trimSessionBudget('acme', runId, 8);
    assert.equal(wider.ok, false);
    assert.equal(wider.reason, 'not-downward', 'trim is amend-DOWNWARD only');
  });
});

describe('trimSessionBudget — successful trims', () => {
  test('trims a numeric maxTasks downward, in the ACTIVE QUEUE', async () => {
    const store = makeStore();
    await store.addItem('acme', { prompt: 'run me', kind: 'autopilot', maxTasks: 10 });
    const runId = (await store.pollAvailable('acme'))[0].id;

    const result = await store.trimSessionBudget('acme', runId, 3, { by: 'user-1' });
    assert.equal(result.ok, true);
    assert.equal(result.item.maxTasks, 3);

    const status = await store.getItemStatus('acme', runId);
    assert.equal(status.maxTasks, 3, 'persisted, readable back via getItemStatus');
  });

  test('trims a run whose maxTasks was never set (null → bounded) — turning on a bound for the first time is a downward move', async () => {
    const store = makeStore();
    await store.addItem('acme', { prompt: 'run me', kind: 'autopilot' }); // no maxTasks
    const runId = (await store.pollAvailable('acme'))[0].id;

    const result = await store.trimSessionBudget('acme', runId, 4);
    assert.equal(result.ok, true);
    assert.equal(result.item.maxTasks, 4);
  });

  test('trims an ALREADY-ARCHIVED (taken) run — the common real-world case, since a live kickoff is usually already in history', async () => {
    const store = makeStore();
    const created = await store.addItem('acme', { prompt: 'run me', kind: 'autopilot', maxTasks: 10 });
    await store.takeItem(created._id, 'acme');

    const result = await store.trimSessionBudget('acme', created._id, 2);
    assert.equal(result.ok, true);
    assert.equal(result.item.maxTasks, 2);

    const status = await store.getItemStatus('acme', created._id);
    assert.equal(status.maxTasks, 2);
  });

  test('is idempotent: repeating the identical trim twice yields the identical end state', async () => {
    const store = makeStore();
    const created = await store.addItem('acme', { prompt: 'run me', kind: 'autopilot', maxTasks: 10 });
    await store.takeItem(created._id, 'acme');

    const first = await store.trimSessionBudget('acme', created._id, 3);
    assert.equal(first.ok, true);

    // A SECOND call with the same value is a not-downward refusal (3 >= 3),
    // not a crash or a duplicate mutation — the state (maxTasks: 3) is
    // unchanged either way, which is what "idempotent" means for an
    // absolute-set operation.
    const second = await store.trimSessionBudget('acme', created._id, 3);
    assert.equal(second.ok, false);
    assert.equal(second.reason, 'not-downward');

    const status = await store.getItemStatus('acme', created._id);
    assert.equal(status.maxTasks, 3, 'end state identical after the repeat call');
  });

  test('a genuinely tighter follow-up trim after an earlier one still applies', async () => {
    const store = makeStore();
    const created = await store.addItem('acme', { prompt: 'run me', kind: 'autopilot', maxTasks: 10 });
    await store.takeItem(created._id, 'acme');

    await store.trimSessionBudget('acme', created._id, 5);
    const second = await store.trimSessionBudget('acme', created._id, 2);
    assert.equal(second.ok, true);
    assert.equal(second.item.maxTasks, 2);
  });
});

describe('trimSessionBudget — auditable (who/when/what)', () => {
  test('appends an audit entry recording at/maxTasks/by, readable via getItemStatus/_formatItem/_formatHistoryItem', async () => {
    const store = makeStore();
    const created = await store.addItem('acme', { prompt: 'run me', kind: 'autopilot', maxTasks: 10 });
    await store.takeItem(created._id, 'acme');

    const before = Date.now();
    const result = await store.trimSessionBudget('acme', created._id, 4, { by: 'account-42' });
    assert.equal(result.ok, true);
    assert.equal(result.item.trimHistory.length, 1);
    const entry = result.item.trimHistory[0];
    assert.equal(entry.maxTasks, 4);
    assert.equal(entry.by, 'account-42');
    assert.ok(entry.at instanceof Date || !Number.isNaN(new Date(entry.at).getTime()));
    assert.ok(new Date(entry.at).getTime() >= before);

    const status = await store.getItemStatus('acme', created._id);
    assert.equal(status.trimHistory.length, 1);
    assert.equal(status.trimHistory[0].by, 'account-42');
  });

  test('a null `by` is recorded honestly, never a fabricated actor', async () => {
    const store = makeStore();
    const created = await store.addItem('acme', { prompt: 'run me', kind: 'autopilot', maxTasks: 10 });
    await store.takeItem(created._id, 'acme');

    const result = await store.trimSessionBudget('acme', created._id, 3);
    assert.strictEqual(result.item.trimHistory[0].by, null);
  });

  test('multiple trims accumulate a full audit trail, not just the latest', async () => {
    const store = makeStore();
    const created = await store.addItem('acme', { prompt: 'run me', kind: 'autopilot', maxTasks: 20 });
    await store.takeItem(created._id, 'acme');

    await store.trimSessionBudget('acme', created._id, 10, { by: 'a' });
    const second = await store.trimSessionBudget('acme', created._id, 5, { by: 'b' });
    assert.equal(second.item.trimHistory.length, 2);
    assert.equal(second.item.trimHistory[0].maxTasks, 10);
    assert.equal(second.item.trimHistory[1].maxTasks, 5);
  });

  test('a run never trimmed reads trimHistory: [], not undefined, at every seam', async () => {
    const store = makeStore();
    const created = await store.addItem('acme', { prompt: 'run me' });
    const polled = await store.pollAvailable('acme');
    assert.deepEqual(polled[0].trimHistory, []);

    await store.takeItem(created._id, 'acme');
    const status = await store.getItemStatus('acme', created._id);
    assert.deepEqual(status.trimHistory, []);
  });

  test('trimHistory survives the queue→history archive hop (trimmed while still queued, then taken)', async () => {
    const store = makeStore();
    const created = await store.addItem('acme', { prompt: 'run me', kind: 'autopilot', maxTasks: 10 });
    await store.trimSessionBudget('acme', created._id, 4, { by: 'account-1' }); // still queued at this point
    await store.takeItem(created._id, 'acme'); // archives to history

    const status = await store.getItemStatus('acme', created._id);
    assert.equal(status.maxTasks, 4, 'the trimmed bound survives the archive hop');
    assert.equal(status.trimHistory.length, 1, 'the audit entry survives the archive hop too');
    assert.equal(status.trimHistory[0].by, 'account-1');
  });
});

describe('trim + the LIN-1751 guard, end-to-end', () => {
  test('acceptance sketch: trimmed to the current count, the run refuses a genuinely NEW task but keeps admitting the in-flight one\'s continuation', async () => {
    const store = makeStore();
    const kickoff = await store.addItem('acme', { prompt: 'kickoff', kind: 'autopilot', maxTasks: 10 });
    const sessionId = kickoff._id;

    // Two distinct tasks dispatched under this run so far.
    await createDispatchItem({
      store, urlKey: 'acme', prompt: 'do LIN-1', kind: 'implementation',
      fields: { issueIdentifier: 'LIN-1', sessionId }
    });
    await createDispatchItem({
      store, urlKey: 'acme', prompt: 'do LIN-2', kind: 'implementation',
      fields: { issueIdentifier: 'LIN-2', sessionId }
    });

    // Trim to 0 remaining (per the acceptance sketch): the current count IS
    // the new bound, so no further NEW task can be admitted.
    const trim = await store.trimSessionBudget('acme', sessionId, 2, { by: 'operator' });
    assert.equal(trim.ok, true);

    // A genuinely NEW task (LIN-3) is refused.
    await assert.rejects(
      () => createDispatchItem({
        store, urlKey: 'acme', prompt: 'do LIN-3', kind: 'implementation',
        fields: { issueIdentifier: 'LIN-3', sessionId }
      }),
      err => err.status === 409 && err.budgetExhausted?.code === 'BUDGET_EXHAUSTED',
      'trim must make the run refuse a genuinely new task at the next boundary'
    );

    // The IN-FLIGHT ticket's own continuation (review of LIN-1, already
    // counted) is still admitted — a trim must never interrupt a beat
    // already in progress.
    const reviewDispatch = await createDispatchItem({
      store, urlKey: 'acme', prompt: 'review LIN-1', kind: 'review',
      fields: { issueIdentifier: 'LIN-1', sessionId }
    });
    assert.ok(reviewDispatch._id, 'the already-counted task\'s continuation must still be admitted after trim');
  });
});
