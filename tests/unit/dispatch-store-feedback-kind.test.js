/**
 * Unit tests for persisting the additive feedback-entry `kind`/`rootItemId`
 * fields in DispatchQueueStore#addFeedback (LIN-1297). The store trusts what
 * it is given (the route is the validation boundary, see feedback-route level
 * tests in tests/e2e/dispatch.spec.js) — these tests pin the storage shape:
 * present when truthy, absent (not null) when omitted, so a POST that omits
 * them yields a byte-identical entry to pre-LIN-1297 behavior.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createMockCollection } from '../fixtures/mock-collection.js';
import { DispatchQueueStore, FEEDBACK_ENTRY_KINDS } from '../../lib/dispatch-store.js';

const URL_KEY = 'acme';

function makeStore() {
  const collection = createMockCollection();
  const historyCollection = createMockCollection();
  return new DispatchQueueStore({ collection, historyCollection });
}

async function takenItem(store) {
  const item = await store.addItem(URL_KEY, {
    prompt: 'do the thing',
    kind: 'implementation',
    issueIdentifier: 'LIN-42'
  });
  await store.takeItem(item._id, URL_KEY, 'token-a');
  return item;
}

describe('addFeedback persists kind/rootItemId (LIN-1297)', () => {
  test('a valid kind + rootItemId persist onto the stored feedback entry', async () => {
    const store = makeStore();
    const item = await takenItem(store);
    const rootItemId = '11111111-2222-3333-4444-555555555555';

    const res = await store.addFeedback(
      item._id,
      URL_KEY,
      { message: 'Heartbeat', kind: 'heartbeat', rootItemId },
      'token-a'
    );

    assert.ok(res && res.success);
    const doc = store.historyCollection._docs.find(d => d._id === item._id);
    assert.equal(doc.feedback[0].kind, 'heartbeat');
    assert.equal(doc.feedback[0].rootItemId, rootItemId);
  });

  test('omitted kind/rootItemId are absent (not null) on the stored entry, byte-identical to prior shape', async () => {
    const store = makeStore();
    const item = await takenItem(store);

    await store.addFeedback(item._id, URL_KEY, { message: 'plain feedback' }, 'token-a');

    const doc = store.historyCollection._docs.find(d => d._id === item._id);
    assert.deepEqual(doc.feedback[0], {
      message: 'plain feedback',
      url: null,
      urlLabel: null,
      timestamp: doc.feedback[0].timestamp
    });
    assert.ok(!('kind' in doc.feedback[0]));
    assert.ok(!('rootItemId' in doc.feedback[0]));
  });

  test('the store persists whatever it is given — validation is the caller/route concern', async () => {
    const store = makeStore();
    const item = await takenItem(store);

    await store.addFeedback(
      item._id,
      URL_KEY,
      { message: 'trusted input', kind: 'not-a-real-kind', rootItemId: 'not-a-uuid' },
      'token-a'
    );

    const doc = store.historyCollection._docs.find(d => d._id === item._id);
    assert.equal(doc.feedback[0].kind, 'not-a-real-kind');
    assert.equal(doc.feedback[0].rootItemId, 'not-a-uuid');
  });

  test('LIN-1425: "usage" is a recognized FEEDBACK_ENTRY_KINDS member', () => {
    assert.ok(FEEDBACK_ENTRY_KINDS.includes('usage'));
  });

  test('LIN-1425: a kind:"usage" feedback entry persists, keyed on rootItemId', async () => {
    const store = makeStore();
    const item = await takenItem(store);
    const rootItemId = '11111111-2222-3333-4444-555555555555';
    const message = '[usage] {"schema":1,"harness":"claude-code","model":"claude-opus-4-8","inputTokens":5529,"outputTokens":25811,"cacheCreationInputTokens":145449,"cacheReadInputTokens":4588835,"costUsd":null}';

    const res = await store.addFeedback(
      item._id,
      URL_KEY,
      { message, kind: 'usage', rootItemId },
      'token-a'
    );

    assert.ok(res && res.success);
    const doc = store.historyCollection._docs.find(d => d._id === item._id);
    assert.equal(doc.feedback[0].kind, 'usage');
    assert.equal(doc.feedback[0].rootItemId, rootItemId);
    assert.equal(doc.feedback[0].message, message);
  });

  test('LIN-1427: "refusal" is a recognized FEEDBACK_ENTRY_KINDS member', () => {
    assert.ok(FEEDBACK_ENTRY_KINDS.includes('refusal'));
  });

  test('LIN-1427: a kind:"refusal" feedback entry posted at a [blocked] finalize boundary persists as given', async () => {
    const store = makeStore();
    const item = await takenItem(store);
    const rootItemId = '11111111-2222-3333-4444-555555555555';
    const message = '[blocked] refused to proceed: task required bypassing a safety control';

    const res = await store.addFeedback(
      item._id,
      URL_KEY,
      { message, kind: 'refusal', rootItemId },
      'token-a'
    );

    assert.ok(res && res.success);
    const doc = store.historyCollection._docs.find(d => d._id === item._id);
    assert.equal(doc.feedback[0].kind, 'refusal');
    assert.equal(doc.feedback[0].rootItemId, rootItemId);
    assert.equal(doc.feedback[0].message, message);
  });
});
