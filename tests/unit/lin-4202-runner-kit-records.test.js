/**
 * LIN-4202 (LIN-4195 piece 5, D12): runner-kit posts its subagent transcript's requests as
 * per-request records, beside the unchanged `[usage]` snapshot.
 *
 * What this file proves:
 *  - the records walk (transcriptRequestRecords) over piece 0's transcripts gives piece 0's
 *    records, and they sum to the independent oracle (LIN4197_CASES[...].oracleUsd, the
 *    LIN-4126 method; never computed by the code under test);
 *  - the two walk rules piece 0's data cannot prove (LIN-4199 review note from LIN-4197): a
 *    per-field MAX per message id (not last-line-wins, not first-line-wins), and a `<synthetic>`
 *    message skipped even when its tokens are non-zero;
 *  - review note 8: a line without message.id falls back to its top-level requestId, and a line
 *    with neither is skipped and counted, never given an invented id;
 *  - posting is batched at 100, a 404 stops, a failed batch does not stop the others, and none
 *    of it throws (postRequestRecords);
 *  - re-posting is idempotent against the REAL intake and store (postUsage + the intake's
 *    requestUsageStoreFor, over MangoDB): the stored set and its priced sum do not change, and a grown transcript grows;
 *  - the retired `[usage]` snapshot fold (LIN-4203 deleted sumTranscriptUsage) has no test now; its golden
 *    (recorded at origin/main 9cc5ff9c) stays as frozen data.
 *
 * The command-level wiring (the `usage` command posts both, and a record failure leaves the
 * snapshot post and the command's result alone) is in tests/unit/runner-kit-helper.test.js.
 *
 * Run with: node --test tests/unit/lin-4202-runner-kit-records.test.js
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MangoClient } from '@jkershaw/mangodb';
import {
  transcriptRequestRecords,
  postRequestRecords,
  TRANSCRIPT_TOKEN_FIELDS,
  USAGE_RECORDS_PER_CALL,
  RUNNER_HARNESS
} from '../../lib/runner-kit/runner.mjs';
import { LIN4197_CASES } from '../fixtures/cost-replay/corpus.js';
import { priceRequest } from '../../lib/model-pricing.js';
import { postUsage, requestUsageStoreFor, USAGE_MAX_RECORDS_PER_CALL } from '../../lib/request-usage-intake.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const KIT_FIXTURES = join(ROOT, 'tests', 'fixtures', 'runner-kit');
const CORPUS_DIR = join(KIT_FIXTURES, 'transcript-corpus');
const GOLDEN = JSON.parse(readFileSync(join(KIT_FIXTURES, 'sum-transcript-usage-golden.json'), 'utf8'));
const AGENT = 'a1b2c3d4';

const linesOf = (file) => readFileSync(file, 'utf8').split('\n');
/** `<case>--<stage>.jsonl` ↔ LIN4197_CASES key `<case>/<stage>`. */
const corpusFiles = () => readdirSync(CORPUS_DIR).filter((f) => f.endsWith('.jsonl')).sort();
const caseKeyOf = (file) => file.replace(/\.jsonl$/, '').replace('--', '/');
const sumPriced = (records) => records.reduce((s, r) => s + priceRequest(r), 0);

/** One Claude Code assistant line, as the transcript writes it. */
const line = ({ id, requestId, model = 'claude-sonnet-5', ts, usage }) => JSON.stringify({
  type: 'assistant',
  ...(requestId ? { requestId } : {}),
  ...(ts ? { timestamp: ts } : {}),
  message: { ...(id ? { id } : {}), model, role: 'assistant', usage }
});
const u = (input, output, cacheWrite = 0, cacheRead = 0) => ({
  input_tokens: input, output_tokens: output, cache_creation_input_tokens: cacheWrite, cache_read_input_tokens: cacheRead
});

describe('LIN-4202 records walk over piece 0\'s transcripts: the records and the oracle', () => {
  test('every copied single-file stage has its piece-0 case', () => {
    const files = corpusFiles();
    assert.equal(files.length, 8);
    for (const f of files) assert.ok(LIN4197_CASES[caseKeyOf(f)], `${f} has a LIN4197_CASES entry`);
  });

  for (const file of corpusFiles()) {
    const key = caseKeyOf(file);
    test(`${key}: the records equal piece 0's and sum to the oracle ${LIN4197_CASES[key].oracleUsd}`, () => {
      const { records } = transcriptRequestRecords(linesOf(join(CORPUS_DIR, file)), { agent: AGENT });
      const expected = LIN4197_CASES[key].records;
      // Piece 0's records carry `agent: 'main'` and an `effort`; runner-kit's agent is the subagent
      // id and it has no effort control. Everything that prices must match exactly.
      const priced = (r) => ({ requestId: r.requestId, model: r.model, at: r.at, ...Object.fromEntries(TRANSCRIPT_TOKEN_FIELDS.map((f) => [f, r[f]])) });
      assert.deepEqual(records.map(priced), expected.map(priced));
      for (const r of records) {
        assert.equal(r.harness, RUNNER_HARNESS);
        assert.equal(r.agent, AGENT);
        assert.ok(priceRequest(r) !== null, `${r.requestId} prices`);
      }
      const total = sumPriced(records);
      assert.ok(Math.abs(total - LIN4197_CASES[key].oracleUsd) < 1e-9, `${key}: ${total} vs oracle ${LIN4197_CASES[key].oracleUsd}`);
    });
  }

  test('the Haiku-over-100k stage prices per request (the cumulative snapshot would not)', () => {
    const { records } = transcriptRequestRecords(linesOf(join(CORPUS_DIR, 'haiku-over-100k--final.jsonl')), { agent: AGENT });
    assert.equal(records.length, 3);
    assert.ok(records.every((r) => priceRequest(r) > 0));
  });
});

describe('LIN-4202 records walk: the rules piece 0\'s data cannot prove', () => {
  test('per-field MAX per message id: a later line with a SMALLER field does not shrink it', () => {
    // Non-monotone lines for one id: input peaks on the first line, output on the second, cache
    // read on the third. Last-line-wins gives (10, 5, 0, 900); first-line-wins (400, 20, 0, 100).
    const { records } = transcriptRequestRecords([
      line({ id: 'msg_nm', ts: '2026-11-02T09:00:00.000Z', usage: u(400, 20, 0, 100) }),
      line({ id: 'msg_nm', ts: '2026-11-02T09:00:01.000Z', usage: u(10, 300, 0, 50) }),
      line({ id: 'msg_nm', ts: '2026-11-02T09:00:02.000Z', usage: u(10, 5, 0, 900) })
    ], { agent: AGENT });
    assert.equal(records.length, 1);
    assert.equal(records[0].inputTokens, 400);
    assert.equal(records[0].outputTokens, 300);
    assert.equal(records[0].cacheReadInputTokens, 900);
    assert.equal(records[0].at, '2026-11-02T09:00:00.000Z', 'at is the first line, stable across re-walks');
  });

  test('a <synthetic> message with NON-zero tokens produces no record, and is counted', () => {
    const { records, skipped } = transcriptRequestRecords([
      line({ id: 'msg_real', usage: u(100, 10) }),
      line({ id: 'msg_synth', model: '<synthetic>', usage: u(250, 40, 0, 1000) })
    ], { agent: AGENT });
    assert.deepEqual(records.map((r) => r.requestId), ['msg_real']);
    assert.equal(skipped.synthetic, 1);
  });

  test('an all-zero message produces no record, and is counted', () => {
    const { records, skipped } = transcriptRequestRecords([line({ id: 'msg_zero', usage: u(0, 0) })]);
    assert.deepEqual(records, []);
    assert.equal(skipped.zero, 1);
  });

  test('review note 8: no message.id → the line\'s top-level requestId; neither → skipped and counted', () => {
    const lines = [
      line({ requestId: 'req_top', usage: u(100, 10) }),
      line({ requestId: 'req_top', usage: u(100, 30) }),
      line({ usage: u(999, 99) }),
      line({ id: 'msg_both', requestId: 'req_other', usage: u(5, 5) })
    ];
    const { records, skipped } = transcriptRequestRecords(lines);
    assert.deepEqual(records.map((r) => [r.requestId, r.outputTokens]), [['req_top', 30], ['msg_both', 5]]);
    assert.equal(skipped.noId, 1);
    // The retired snapshot (LIN-4203) counted both req_top lines and the line with no id at all. The records
    // fold the two req_top lines into one request and post nothing for the id-less line.
  });

  test('non-assistant, usage-less and unparsable lines are ignored', () => {
    const { records, skipped } = transcriptRequestRecords([
      '{"type":"user","message":{"role":"user","content":"x"}}',
      '{"type":"assistant","message":{"id":"msg_nousage","model":"claude-sonnet-5"}}',
      '{"type":"assistant","message":{"id":"msg_trunc","usage":{"input_tok',
      ''
    ]);
    assert.deepEqual(records, []);
    assert.deepEqual(skipped, { noId: 0, synthetic: 0, zero: 0 });
  });
});

describe('LIN-4202 postRequestRecords: batches, 404, failures, never throws', () => {
  const many = (n) => Array.from({ length: n }, (_, i) => ({ requestId: `msg_${i}`, inputTokens: 1 }));
  const ok = (batch) => ({ status: 200, json: { applied: batch.map((r) => r.requestId), rejected: [] } });

  test('posts in batches of at most 100 (the intake\'s own cap)', async () => {
    assert.equal(USAGE_RECORDS_PER_CALL, USAGE_MAX_RECORDS_PER_CALL);
    const sizes = [];
    const out = await postRequestRecords(many(250), async (b) => { sizes.push(b.length); return ok(b); });
    assert.deepEqual(sizes, [100, 100, 50]);
    assert.equal(out.posted, 250);
    assert.equal(out.applied, 250);
    assert.equal(out.failedBatches, 0);
  });

  test('no records → no call', async () => {
    let calls = 0;
    const out = await postRequestRecords([], async () => { calls++; return ok([]); });
    assert.equal(calls, 0);
    assert.equal(out.posted, 0);
  });

  test('a 404 (row not taken by this token) stops posting: later batches would 404 too', async () => {
    let calls = 0;
    const out = await postRequestRecords(many(250), async () => { calls++; return { status: 404, json: { error: 'nf' } }; });
    assert.equal(calls, 1);
    assert.equal(out.notTaken, true);
    assert.equal(out.posted, 0);
  });

  test('a 500 or a throw on one batch is reported and the other batches are still sent', async () => {
    let n = 0;
    const out = await postRequestRecords(many(300), async (b) => {
      n++;
      if (n === 2) return { status: 500, json: null };
      if (n === 3) throw new Error('socket hang up');
      return ok(b);
    });
    assert.equal(n, 3);
    assert.equal(out.posted, 100);
    assert.equal(out.failedBatches, 2);
    assert.deepEqual(out.errors, ['HTTP 500', 'socket hang up']);
  });

  test('per-record rejections are collected, not resent', async () => {
    const out = await postRequestRecords(many(2), async (b) => ({ status: 200, json: { applied: [b[0].requestId], rejected: [{ requestId: b[1].requestId, reason: 'too big' }] } }));
    assert.equal(out.applied, 1);
    assert.deepEqual(out.rejected, [{ requestId: 'msg_1', reason: 'too big' }]);
  });
});

describe('LIN-4202 re-posting against the real intake and store changes nothing (MangoDB)', () => {
  const ITEM = '11111111-2222-4333-8444-555555555555';
  const ANCHOR = '99999999-8888-4777-8666-555555555555';
  let dbDir, client, n = 0;

  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'lin4202-records-'));
    client = new MangoClient(dbDir);
    await client.connect();
  });
  after(async () => {
    if (client?.close) await client.close();
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  });

  /** postUsage with a real store and a taken row whose anchor is ANCHOR. */
  async function world() {
    const db = client.db(`lin4202_${n++}`);
    const store = requestUsageStoreFor(db);
    // LIN-4212: the loader reads the posting row from dispatch-history (its anchor is ANCHOR).
    await db.collection('dispatch-history').insertOne({ _id: ITEM, urlKey: 'acme', rootItemId: ANCHOR, status: 'taken', abort: false });
    await store.collection.createIndex({ urlKey: 1, rootItemId: 1, requestId: 1 }, { unique: true });
    const dispatchQueueStore = { readTakenForUsage: async () => ({ _id: ITEM, rootItemId: ANCHOR, status: 'taken' }) };
    const send = async (batch) => {
      const r = await postUsage({ dispatchQueueStore, store, itemId: ITEM, urlKey: 'acme', tokenLabel: 'runner', takenByTokenId: 't', body: { records: batch } });
      return { status: r.status, json: r.body };
    };
    const stored = async () => (await store.listForAnchors('acme', [ANCHOR])).sort((a, b) => a.requestId.localeCompare(b.requestId));
    return { send, stored };
  }

  const recordsOf = (file) => transcriptRequestRecords(linesOf(join(CORPUS_DIR, file)), { agent: AGENT }).records;
  const strip = (docs) => docs.map(({ _id, updatedAt, ...rest }) => rest);

  test('posting the same transcript twice leaves the same documents and the oracle sum', async () => {
    const { send, stored } = await world();
    const records = recordsOf('mixed-model--final.jsonl');
    const first = await postRequestRecords(records, send);
    assert.equal(first.applied, records.length);
    const once = await stored();
    const second = await postRequestRecords(records, send);
    assert.equal(second.applied, records.length);
    const twice = await stored();
    assert.equal(twice.length, records.length);
    assert.deepEqual(strip(twice), strip(once));
    assert.ok(Math.abs(sumPriced(twice) - LIN4197_CASES['mixed-model/final'].oracleUsd) < 1e-9);
  });

  test('a transcript that grew (Stop → reap) grows Harbour to the later oracle, counted once', async () => {
    const { send, stored } = await world();
    await postRequestRecords(recordsOf('reap-tail--atStop.jsonl'), send);
    assert.ok(Math.abs(sumPriced(await stored()) - LIN4197_CASES['reap-tail/atStop'].oracleUsd) < 1e-9);
    await postRequestRecords(recordsOf('reap-tail--atReap.jsonl'), send);
    await postRequestRecords(recordsOf('reap-tail--atStop.jsonl'), send); // an older, smaller re-post
    const docs = await stored();
    assert.equal(docs.length, LIN4197_CASES['reap-tail/atReap'].records.length);
    assert.ok(Math.abs(sumPriced(docs) - LIN4197_CASES['reap-tail/atReap'].oracleUsd) < 1e-9);
  });
});

