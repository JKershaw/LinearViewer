/**
 * LIN-4198 beat 3: the shared usage intake (lib/request-usage-intake.js), unit level.
 *
 * Pure validation (judgeRecord / validateUsageBody) and the shared flow (postUsage) against
 * fake collaborators, so each rule is visible in one place. The HTTP-level behaviour of both
 * routes is in tests/unit/lin-4198-usage-routes.test.js, against a real MangoDB.
 *
 * Run with: node --test tests/unit/lin-4198-request-usage-intake.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  judgeRecord, validateUsageBody, postUsage, requestUsageStoreFor,
  USAGE_MAX_RECORDS_PER_CALL, USAGE_MAX_PROMPT_TOKENS, USAGE_MAX_TEXT_LENGTH, REQUEST_USAGE_COLLECTION
} from '../../lib/request-usage-intake.js';
import { DispatchStoreFault } from '../../lib/errors.js';

const ITEM = '11111111-2222-4333-8444-555555555555';
const ROOT = '99999999-8888-4777-8666-555555555555';

/** A valid record, as a runner posts it. */
const rec = (requestId, tokens = {}, extra = {}) => ({
  requestId,
  harness: 'claude-code',
  model: 'claude-haiku-5-5',
  effort: 'high',
  lane: 'build',
  agent: 'main',
  inputTokens: 100,
  outputTokens: 10,
  ...tokens,
  ...extra
});

describe('judgeRecord — each per-record guard, with its reason', () => {
  test('a valid record is accepted and normalized', () => {
    const j = judgeRecord(rec('msg_1'));
    assert.equal(j.ok, true);
    assert.equal(j.zero, false);
    assert.equal(j.record.requestId, 'msg_1');
    assert.equal(j.record.inputTokens, 100);
  });

  test('a missing or empty requestId is rejected with a reason', () => {
    assert.deepEqual(judgeRecord({ inputTokens: 1 }), { ok: false, requestId: null, reason: 'requestId is required' });
    assert.deepEqual(judgeRecord({ requestId: '   ', inputTokens: 1 }), { ok: false, requestId: null, reason: 'requestId is required' });
    assert.equal(judgeRecord({ requestId: 42, inputTokens: 1 }).ok, false);
  });

  test('an over-long requestId is rejected and named', () => {
    const j = judgeRecord(rec('x'.repeat(USAGE_MAX_TEXT_LENGTH + 1)));
    assert.equal(j.ok, false);
    assert.match(j.reason, /requestId exceeds 200 characters/);
  });

  test('an over-long text field is rejected', () => {
    const j = judgeRecord(rec('m', {}, { model: 'm'.repeat(USAGE_MAX_TEXT_LENGTH + 1) }));
    assert.equal(j.ok, false);
    assert.match(j.reason, /model exceeds 200 characters/);
  });

  test('a non-string text field is rejected', () => {
    assert.equal(judgeRecord(rec('m', {}, { harness: 7 })).ok, false);
  });

  test('non-finite and negative token counts are rejected per field', () => {
    for (const [field, value] of [['inputTokens', Infinity], ['outputTokens', NaN], ['cacheReadInputTokens', -1], ['inputTokens', '5']]) {
      const j = judgeRecord(rec('m', { [field]: value }));
      assert.equal(j.ok, false, `${field}=${String(value)} must be rejected`);
      assert.equal(j.reason, `${field} must be a finite non-negative number`);
    }
  });

  test('a negative or non-finite costUsd is rejected; an absent or null one is simply absent', () => {
    assert.equal(judgeRecord(rec('m', {}, { costUsd: -0.01 })).ok, false);
    assert.equal(judgeRecord(rec('m', {}, { costUsd: Infinity })).ok, false);
    const absent = judgeRecord(rec('m'));
    assert.equal('costUsd' in absent.record, false);
    assert.equal(judgeRecord(rec('m', {}, { costUsd: null })).ok, true);
  });

  test('an unparseable at is rejected; a date string or epoch number is accepted', () => {
    assert.equal(judgeRecord(rec('m', {}, { at: 'not a time' })).reason, 'at is not a valid time');
    assert.ok(judgeRecord(rec('m', {}, { at: '2026-11-04T03:00:00Z' })).record.at instanceof Date);
    assert.ok(judgeRecord(rec('m', {}, { at: 1793800000000 })).record.at instanceof Date);
  });

  test('the prompt bound: exactly 2,000,000 prompt tokens is accepted, one more is rejected', () => {
    assert.equal(judgeRecord(rec('m', { inputTokens: USAGE_MAX_PROMPT_TOKENS, outputTokens: 0 })).ok, true);
    const over = judgeRecord(rec('m', { inputTokens: USAGE_MAX_PROMPT_TOKENS, outputTokens: 0, cacheReadInputTokens: 1 }));
    assert.equal(over.ok, false);
    assert.match(over.reason, /prompt tokens 2000001 exceed 2000000/);
  });

  test('the prompt bound counts input, cache-read and cache-write, and never output', () => {
    // prompt 1 + 500000 + 1000000 = 1,500,001: under the bound, whatever the 9M output
    const j = judgeRecord(rec('m', { inputTokens: 1, outputTokens: 9_000_000, cacheCreationInputTokens: 500_000, cacheReadInputTokens: 1_000_000 }));
    assert.equal(j.ok, true, 'output tokens do not count toward the prompt bound');
    // prompt 1 + 1000000 + 1000000 = 2,000,001: over the bound, so it must be rejected
    const k = judgeRecord(rec('m', { inputTokens: 1, outputTokens: 0, cacheCreationInputTokens: 1_000_000, cacheReadInputTokens: 1_000_000 }));
    assert.equal(k.ok, false, '2,000,001 prompt tokens is over the bound');
  });

  test('a record whose five token counts are all zero is accepted as zero, with nothing to store', () => {
    const j = judgeRecord({ requestId: 'synthetic', harness: 'claude-code', model: '<synthetic>' });
    assert.equal(j.ok, true);
    assert.equal(j.zero, true);
    assert.equal(j.requestId, 'synthetic');
  });

  test('a non-object record is rejected', () => {
    assert.deepEqual(judgeRecord(null), { ok: false, requestId: null, reason: 'record must be an object' });
    assert.equal(judgeRecord([rec('m')]).ok, false);
    assert.equal(judgeRecord('record').ok, false);
  });
});

describe('validateUsageBody — the call-level refusals and the per-record split', () => {
  test('records must be an array', () => {
    assert.deepEqual(validateUsageBody({}), { error: 'records is required and must be an array' });
    assert.deepEqual(validateUsageBody({ records: 'x' }), { error: 'records is required and must be an array' });
    assert.deepEqual(validateUsageBody(undefined), { error: 'records is required and must be an array' });
  });

  test(`more than ${USAGE_MAX_RECORDS_PER_CALL} records refuses the whole call; exactly ${USAGE_MAX_RECORDS_PER_CALL} is fine`, () => {
    const at = Array.from({ length: USAGE_MAX_RECORDS_PER_CALL }, (_, i) => rec(`m${i}`));
    assert.equal(validateUsageBody({ records: at }).applied.length, USAGE_MAX_RECORDS_PER_CALL);
    const over = Array.from({ length: USAGE_MAX_RECORDS_PER_CALL + 1 }, (_, i) => rec(`m${i}`));
    assert.deepEqual(validateUsageBody({ records: over }), { error: 'records exceeds the maximum of 100 per call' });
  });

  test('a mixed batch: the valid records apply, the invalid ones are reported with reasons, and neither fails the other', () => {
    const v = validateUsageBody({ records: [rec('good-1'), rec('bad', { inputTokens: -3 }), rec('good-2'), { inputTokens: 5 }] });
    assert.deepEqual(v.applied, ['good-1', 'good-2']);
    assert.deepEqual(v.toStore.map((r) => r.requestId), ['good-1', 'good-2']);
    assert.deepEqual(v.rejected, [
      { requestId: 'bad', reason: 'inputTokens must be a finite non-negative number' },
      { requestId: null, reason: 'requestId is required' }
    ]);
  });

  test('a zero-token record is applied but never queued for storage', () => {
    const v = validateUsageBody({ records: [{ requestId: 'synthetic', model: '<synthetic>' }, rec('real')] });
    assert.deepEqual(v.applied, ['synthetic', 'real']);
    assert.deepEqual(v.toStore.map((r) => r.requestId), ['real']);
    assert.deepEqual(v.rejected, []);
  });
});

/** Fake dispatch queue store: readTakenForUsage answers from `row`, and records what it was asked. */
function fakeQueue(row, { fault = null } = {}) {
  const calls = [];
  return {
    calls,
    async readTakenForUsage(itemId, urlKey, tokenLabel, ownership) {
      calls.push({ itemId, urlKey, tokenLabel, ownership });
      if (fault) throw fault;
      return row;
    }
  };
}

/** Fake usage store: captures upserts. */
function fakeStore({ fault = null } = {}) {
  const upserts = [];
  return {
    upserts,
    async upsertRecords(args) {
      if (fault) throw fault;
      upserts.push(args);
      return { upserted: args.records.length };
    }
  };
}

describe('postUsage — the shared flow', () => {
  test('the rootItemId is the taken row’s anchor, never the body’s, and itemId and issueIdentifier come from the row', async () => {
    const queue = fakeQueue({ _id: ITEM, rootItemId: ROOT, issueIdentifier: 'LIN-42' });
    const store = fakeStore();
    const out = await postUsage({
      dispatchQueueStore: queue, store, itemId: ITEM, urlKey: 'acme', tokenLabel: 'consumer',
      body: { rootItemId: 'attacker-chosen-lineage', records: [rec('msg_1')] }, now: new Date('2026-11-04T03:00:00Z')
    });
    assert.equal(out.status, 200);
    assert.deepEqual(out.body, { applied: ['msg_1'], rejected: [] });
    assert.equal(store.upserts.length, 1);
    assert.equal(store.upserts[0].rootItemId, ROOT, 'the anchor comes from the taken row, not the body');
    assert.equal(store.upserts[0].itemId, ITEM);
    assert.equal(store.upserts[0].issueIdentifier, 'LIN-42');
    assert.equal(store.upserts[0].urlKey, 'acme');
  });

  test('a row with no rootItemId anchors on its own id (anchorOf)', async () => {
    const store = fakeStore();
    await postUsage({ dispatchQueueStore: fakeQueue({ _id: ITEM }), store, itemId: ITEM, urlKey: 'acme', tokenLabel: 'consumer', body: { records: [rec('m')] } });
    assert.equal(store.upserts[0].rootItemId, ITEM);
    assert.equal(store.upserts[0].issueIdentifier, null);
  });

  test('ownership: the read is made with the token label and the runner token id, exactly as given', async () => {
    const queue = fakeQueue({ _id: ITEM });
    await postUsage({ dispatchQueueStore: queue, store: fakeStore(), itemId: ITEM, urlKey: 'acme', tokenLabel: 'sd-runner', takenByTokenId: 'tok-9', body: { records: [] } });
    assert.deepEqual(queue.calls[0], { itemId: ITEM, urlKey: 'acme', tokenLabel: 'sd-runner', ownership: { takenByTokenId: 'tok-9' } });
  });

  test('a body that is refused never reaches the ownership read (validation before ownership, the feedback order)', async () => {
    const queue = fakeQueue({ _id: ITEM });
    const out = await postUsage({ dispatchQueueStore: queue, store: fakeStore(), itemId: ITEM, urlKey: 'acme', tokenLabel: 'c', body: {} });
    assert.equal(out.status, 400);
    assert.deepEqual(out.body, { error: 'records is required and must be an array' });
    assert.equal(queue.calls.length, 0);
  });

  test('not taken by this token (no row) is a 404 and writes nothing', async () => {
    const store = fakeStore();
    const out = await postUsage({ dispatchQueueStore: fakeQueue(null), store, itemId: ITEM, urlKey: 'acme', tokenLabel: 'c', body: { records: [rec('m')] } });
    assert.equal(out.status, 404);
    assert.deepEqual(out.body, { error: 'Item not found or usage not allowed' });
    assert.equal(store.upserts.length, 0);
  });

  test('an all-zero batch answers applied and writes nothing (not even an upsert call)', async () => {
    const store = fakeStore();
    const out = await postUsage({ dispatchQueueStore: fakeQueue({ _id: ITEM }), store, itemId: ITEM, urlKey: 'acme', tokenLabel: 'c', body: { records: [{ requestId: 'z' }] } });
    assert.equal(out.status, 200);
    assert.deepEqual(out.body.applied, ['z']);
    assert.equal(store.upserts.length, 0);
  });

  test('a missing usage store answers 503, never a silent drop', async () => {
    const out = await postUsage({ dispatchQueueStore: fakeQueue({ _id: ITEM }), store: null, itemId: ITEM, urlKey: 'acme', tokenLabel: 'c', body: { records: [rec('m')] } });
    assert.equal(out.status, 503);
  });

  test('a store fault on the ownership read propagates as a DispatchStoreFault (the retryable 503 route answer)', async () => {
    const fault = new DispatchStoreFault('readTakenForUsage', new Error('connection lost'));
    await assert.rejects(
      postUsage({ dispatchQueueStore: fakeQueue(null, { fault }), store: fakeStore(), itemId: ITEM, urlKey: 'acme', tokenLabel: 'c', body: { records: [rec('m')] } }),
      (err) => err instanceof DispatchStoreFault
    );
  });

  test('a failed upsert is reported as a DispatchStoreFault with writeLanded false (a re-send is safe)', async () => {
    await assert.rejects(
      postUsage({ dispatchQueueStore: fakeQueue({ _id: ITEM }), store: fakeStore({ fault: new Error('E-down') }), itemId: ITEM, urlKey: 'acme', tokenLabel: 'c', body: { records: [rec('m')] } }),
      (err) => err instanceof DispatchStoreFault && err.writeLanded === false && err.operation === 'postUsage'
    );
  });
});

describe('requestUsageStoreFor — the app builds the store on the collection the schema names', () => {
  test('it opens the collections the store names (request-usage, and dispatch-history for the member read), on the given database, and wraps them as the store', () => {
    const names = [];
    const handle = { fake: true };
    const historyHandle = { fake: 'history' };
    const db = { collection: (name) => { names.push(name); return name === 'dispatch-history' ? historyHandle : handle; } };
    const store = requestUsageStoreFor(db);
    assert.deepEqual(names, [REQUEST_USAGE_COLLECTION, 'dispatch-history']);
    assert.equal(store.collection, handle, 'the store writes through the handle it was given');
    assert.equal(store.historyCollection, historyHandle, 'the loader reads members from dispatch-history');
    assert.equal(typeof store.upsertRecords, 'function');
    assert.equal(typeof store.listForAnchors, 'function');
  });
});
