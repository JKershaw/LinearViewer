/**
 * LIN-4198 (piece 1 of LIN-4195): the `request-usage` store. Upsert semantics,
 * the E11000 retry, the listForAnchors projection, and the rule that nothing
 * outside the store (and its declared registers) names the collection.
 *
 * Real MangoDB over a tmpdir (tests/fixtures/mango-tmpdir.js). The concurrent-
 * batch witness needs a real mongod and lives in
 * tests/unit/lin-4198-request-usage-mongod.test.js.
 * Run with: node --test tests/unit/lin-4198-request-usage-store.test.js
 */
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import {
  RequestUsageStore, REQUEST_USAGE_COLLECTION, USAGE_TOKEN_FIELDS, LIST_PROJECTION, upsertOpFor
} from '../../lib/request-usage-store.js';
import { INDEX_SPECS, tierOf, sameKeySpec } from '../../lib/db-indexes.js';
import { INVENTORY } from '../../lib/account-erasure.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const NOW = new Date('2026-11-04T03:00:00.000Z');
const LATER = new Date('2026-11-04T03:05:00.000Z');

/** A validated record as the intake will hand it over. */
const record = (requestId, tokens = {}, extra = {}) => ({
  requestId,
  harness: 'claude-code',
  model: 'claude-haiku-5-5',
  effort: 'high',
  lane: 'build',
  agent: 'main',
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationInputTokens: 0,
  cacheCreation1hInputTokens: 0,
  cacheReadInputTokens: 0,
  ...tokens,
  ...extra
});

const harness = createMangoTmpdir('lin-4198-usage-');
before(() => harness.connect());
after(() => harness.close());

let db, raw, store;
beforeEach(async () => {
  db = harness.freshDb();
  raw = db.collection(REQUEST_USAGE_COLLECTION);
  // The two declared specs, as ensureIndexes would build them.
  await raw.createIndex({ urlKey: 1, rootItemId: 1, requestId: 1 }, { unique: true });
  await raw.createIndex({ urlKey: 1, rootItemId: 1 });
  store = new RequestUsageStore({ collection: raw });
});

const docsOf = async (filter = {}) => raw.find(filter).toArray();
const one = async (requestId, urlKey = 'ws-a', rootItemId = 'root-1') =>
  raw.findOne({ urlKey, rootItemId, requestId });

describe('RequestUsageStore.upsertRecords — the upsert contract', () => {
  test('a record posted twice leaves one document', async () => {
    const r = record('msg_1', { inputTokens: 100, outputTokens: 10 });
    await store.upsertRecords({ urlKey: 'ws-a', rootItemId: 'root-1', itemId: 'item-1', records: [r], now: NOW });
    await store.upsertRecords({ urlKey: 'ws-a', rootItemId: 'root-1', itemId: 'item-1', records: [r], now: LATER });
    assert.equal((await docsOf({ requestId: 'msg_1' })).length, 1);
  });

  test('a larger repost grows the usage fields', async () => {
    const small = record('msg_1', { inputTokens: 100, outputTokens: 10, cacheReadInputTokens: 5 });
    const grown = record('msg_1', { inputTokens: 100, outputTokens: 240, cacheReadInputTokens: 5, cacheCreationInputTokens: 30 });
    await store.upsertRecords({ urlKey: 'ws-a', rootItemId: 'root-1', itemId: 'item-1', records: [small], now: NOW });
    await store.upsertRecords({ urlKey: 'ws-a', rootItemId: 'root-1', itemId: 'item-1', records: [grown], now: LATER });
    const doc = await one('msg_1');
    assert.equal(doc.outputTokens, 240, 'a streamed message that grew since the last post grows in the store');
    assert.equal(doc.cacheCreationInputTokens, 30);
    assert.equal(doc.inputTokens, 100);
  });

  test('a smaller repost leaves the usage fields unchanged', async () => {
    const big = record('msg_1', { inputTokens: 100, outputTokens: 240 });
    const small = record('msg_1', { inputTokens: 100, outputTokens: 10 });
    await store.upsertRecords({ urlKey: 'ws-a', rootItemId: 'root-1', itemId: 'item-1', records: [big], now: NOW });
    await store.upsertRecords({ urlKey: 'ws-a', rootItemId: 'root-1', itemId: 'item-1', records: [small], now: LATER });
    assert.equal((await one('msg_1')).outputTokens, 240, 'a smaller repost never shrinks a record');
  });

  test('the same record reposted is a no-op on every usage field', async () => {
    const r = record('msg_1', { inputTokens: 7, outputTokens: 3, cacheReadInputTokens: 2 });
    await store.upsertRecords({ urlKey: 'ws-a', rootItemId: 'root-1', itemId: 'item-1', records: [r], now: NOW });
    const before = await one('msg_1');
    await store.upsertRecords({ urlKey: 'ws-a', rootItemId: 'root-1', itemId: 'item-1', records: [r], now: LATER });
    const after = await one('msg_1');
    for (const f of USAGE_TOKEN_FIELDS) assert.equal(after[f], before[f], f);
  });

  test('native costUsd grows with $max like the token fields', async () => {
    await store.upsertRecords({ urlKey: 'ws-a', rootItemId: 'root-1', itemId: 'i', records: [record('m', { inputTokens: 1 }, { costUsd: 0.25 })], now: NOW });
    await store.upsertRecords({ urlKey: 'ws-a', rootItemId: 'root-1', itemId: 'i', records: [record('m', { inputTokens: 1 }, { costUsd: 0.1 })], now: LATER });
    assert.equal((await one('m')).costUsd, 0.25);
    await store.upsertRecords({ urlKey: 'ws-a', rootItemId: 'root-1', itemId: 'i', records: [record('m', { inputTokens: 1 }, { costUsd: 0.5 })], now: LATER });
    assert.equal((await one('m')).costUsd, 0.5);
  });

  test('a record without costUsd stores none (no stored price, no null costUsd)', async () => {
    await store.upsertRecords({ urlKey: 'ws-a', rootItemId: 'root-1', itemId: 'i', records: [record('m', { inputTokens: 1 })], now: NOW });
    const doc = await one('m');
    assert.equal('costUsd' in doc, false);
    assert.equal('price' in doc, false);
  });

  test('identity and metadata are set on insert and never overwritten by a repost', async () => {
    await store.upsertRecords({ urlKey: 'ws-a', rootItemId: 'root-1', itemId: 'item-1', issueIdentifier: 'LIN-1', records: [record('m', { inputTokens: 1 }, { model: 'claude-haiku-5-5', harness: 'claude-code' })], now: NOW });
    await store.upsertRecords({ urlKey: 'ws-a', rootItemId: 'root-1', itemId: 'item-2', issueIdentifier: 'LIN-2', records: [record('m', { inputTokens: 2 }, { model: 'claude-opus-5-5', harness: 'opencode' })], now: LATER });
    const doc = await one('m');
    assert.equal(doc.itemId, 'item-1');
    assert.equal(doc.issueIdentifier, 'LIN-1');
    assert.equal(doc.model, 'claude-haiku-5-5');
    assert.equal(doc.harness, 'claude-code');
    assert.deepEqual(doc.at, NOW);
    assert.equal(doc.inputTokens, 2, 'the usage still grows');
  });

  test('rootItemId and urlKey are part of the identity: the same requestId under another anchor is another document', async () => {
    const r = record('msg_1', { inputTokens: 1 });
    await store.upsertRecords({ urlKey: 'ws-a', rootItemId: 'root-1', itemId: 'i', records: [r], now: NOW });
    await store.upsertRecords({ urlKey: 'ws-a', rootItemId: 'root-2', itemId: 'i', records: [r], now: NOW });
    await store.upsertRecords({ urlKey: 'ws-b', rootItemId: 'root-1', itemId: 'i', records: [r], now: NOW });
    assert.equal((await docsOf({ requestId: 'msg_1' })).length, 3);
  });

  test('an empty batch is a no-op and sends nothing', async () => {
    let sent = 0;
    const fake = { bulkWrite: async () => { sent++; } };
    const s = new RequestUsageStore({ collection: fake });
    assert.deepEqual(await s.upsertRecords({ urlKey: 'ws-a', rootItemId: 'r', itemId: 'i', records: [], now: NOW }), { upserted: 0 });
    assert.equal(sent, 0);
  });

  test('a store with no collection refuses to start', () => {
    assert.throws(() => new RequestUsageStore({}), /collection is required/);
  });
});

describe('upsertOpFor — the operator split', () => {
  test('identity in the filter, metadata in $setOnInsert, usage and updatedAt in $max, no null costUsd', () => {
    const op = upsertOpFor({ urlKey: 'ws-a', rootItemId: 'root-1', itemId: 'i', issueIdentifier: null, record: record('m', { outputTokens: 4 }), now: NOW }).updateOne;
    assert.deepEqual(op.filter, { urlKey: 'ws-a', rootItemId: 'root-1', requestId: 'm' });
    assert.deepEqual(Object.keys(op.update.$setOnInsert).sort(), ['agent', 'at', 'effort', 'harness', 'issueIdentifier', 'itemId', 'lane', 'model']);
    assert.deepEqual(Object.keys(op.update.$max).sort(), [...USAGE_TOKEN_FIELDS, 'updatedAt'].sort());
    assert.equal(op.update.$max.outputTokens, 4);
    assert.equal(op.update.$max.costUsd, undefined, 'an absent costUsd is not sent as $max null');
    assert.equal(op.upsert, true);
  });

  test('defaults: agent is main, at falls back to now', () => {
    const r = record('m');
    delete r.agent;
    delete r.at;
    const op = upsertOpFor({ urlKey: 'ws-a', rootItemId: 'r', itemId: 'i', record: r, now: NOW }).updateOne;
    assert.equal(op.update.$setOnInsert.agent, 'main');
    assert.deepEqual(op.update.$setOnInsert.at, NOW);
  });
});

describe('upsertRecords — the E11000 retry for concurrent first inserts', () => {
  const dupError = () => Object.assign(new Error('E11000 duplicate key'), {
    writeErrors: [{ code: 11000 }, { error: { code: 11000 } }]
  });

  test('a batch whose every write error is E11000 is retried once, and the retry is sent', async () => {
    const calls = [];
    let attempts = 0;
    const fake = {
      bulkWrite: async (ops, opts) => {
        attempts++;
        calls.push({ n: ops.length, opts });
        if (attempts === 1) throw dupError();
      }
    };
    const s = new RequestUsageStore({ collection: fake });
    const r = record('m', { inputTokens: 1 });
    const out = await s.upsertRecords({ urlKey: 'ws-a', rootItemId: 'r', itemId: 'i', records: [r, record('n')], now: NOW });
    assert.equal(attempts, 2);
    assert.deepEqual(out, { upserted: 2 });
    assert.deepEqual(calls[0].opts, { ordered: false });
    assert.equal(calls[1].n, 2, 'the retry carries the same batch');
  });

  test('a second E11000 propagates', async () => {
    let attempts = 0;
    const fake = { bulkWrite: async () => { attempts++; throw dupError(); } };
    const s = new RequestUsageStore({ collection: fake });
    await assert.rejects(s.upsertRecords({ urlKey: 'ws-a', rootItemId: 'r', itemId: 'i', records: [record('m')], now: NOW }), /E11000/);
    assert.equal(attempts, 2);
  });

  test('a mixed error (E11000 plus another) does not retry and propagates', async () => {
    let attempts = 0;
    const err = Object.assign(new Error('boom'), { writeErrors: [{ code: 11000 }, { code: 121 }] });
    const fake = { bulkWrite: async () => { attempts++; throw err; } };
    const s = new RequestUsageStore({ collection: fake });
    await assert.rejects(s.upsertRecords({ urlKey: 'ws-a', rootItemId: 'r', itemId: 'i', records: [record('m')], now: NOW }), /boom/);
    assert.equal(attempts, 1);
  });

  test('a plain error propagates without a retry', async () => {
    let attempts = 0;
    const fake = { bulkWrite: async () => { attempts++; throw new Error('network'); } };
    const s = new RequestUsageStore({ collection: fake });
    await assert.rejects(s.upsertRecords({ urlKey: 'ws-a', rootItemId: 'r', itemId: 'i', records: [record('m')], now: NOW }), /network/);
    assert.equal(attempts, 1);
  });
});

describe('listForAnchors — the one loader', () => {
  beforeEach(async () => {
    await store.upsertRecords({ urlKey: 'ws-a', rootItemId: 'root-1', itemId: 'item-1', issueIdentifier: 'LIN-1', records: [
      record('a1', { inputTokens: 10 }, { costUsd: 0.01 }),
      record('a2', { outputTokens: 5 })
    ], now: NOW });
    await store.upsertRecords({ urlKey: 'ws-a', rootItemId: 'root-2', itemId: 'item-2', records: [record('b1', { inputTokens: 3 })], now: NOW });
    await store.upsertRecords({ urlKey: 'ws-b', rootItemId: 'root-1', itemId: 'item-3', records: [record('c1', { inputTokens: 9 })], now: NOW });
  });

  test('returns the records of the requested anchors within the one workspace', async () => {
    const rows = await store.listForAnchors('ws-a', ['root-1']);
    assert.deepEqual(rows.map((r) => r.requestId).sort(), ['a1', 'a2']);
  });

  test('several anchors at once, and never another workspace under the same anchor', async () => {
    const rows = await store.listForAnchors('ws-a', ['root-1', 'root-2', 'root-1']);
    assert.deepEqual(rows.map((r) => r.requestId).sort(), ['a1', 'a2', 'b1']);
    assert.equal(rows.some((r) => r.requestId === 'c1'), false);
  });

  test('an unknown anchor, and an empty or non-string anchor list, return nothing without a query', async () => {
    assert.deepEqual(await store.listForAnchors('ws-a', ['nope']), []);
    assert.deepEqual(await store.listForAnchors('ws-a', []), []);
    assert.deepEqual(await store.listForAnchors('ws-a', [null, '', 7]), []);
  });

  test('projects only the fields the read needs: no itemId, issueIdentifier, updatedAt or _id', async () => {
    const [row] = await store.listForAnchors('ws-a', ['root-1']);
    assert.equal('itemId' in row, false);
    assert.equal('issueIdentifier' in row, false);
    assert.equal('updatedAt' in row, false);
    assert.equal('_id' in row, false);
    assert.equal('urlKey' in row, false, 'urlKey is the query key, not returned');
    for (const f of ['rootItemId', 'requestId', 'harness', 'model', 'effort', 'lane', 'agent', 'at', ...USAGE_TOKEN_FIELDS]) {
      assert.ok(f in row, `${f} is needed by the read`);
    }
  });

  test('the projection constant names exactly the fields above', () => {
    const included = Object.entries(LIST_PROJECTION).filter(([, v]) => v === 1).map(([k]) => k).sort();
    assert.deepEqual(included, ['agent', 'at', 'costUsd', 'effort', 'harness', 'lane', 'model', 'requestId', 'rootItemId', ...USAGE_TOKEN_FIELDS].sort());
    assert.equal(LIST_PROJECTION._id, 0);
  });
});

describe('registers', () => {
  test('both index specs are declared on request-usage, the unique key and the lookup together, at boot tier', () => {
    const specs = INDEX_SPECS.filter((s) => s.collection === REQUEST_USAGE_COLLECTION);
    const unique = specs.find((s) => sameKeySpec(s.keySpec, { urlKey: 1, rootItemId: 1, requestId: 1 }));
    const lookup = specs.find((s) => sameKeySpec(s.keySpec, { urlKey: 1, rootItemId: 1 }));
    assert.ok(unique && unique.options.unique === true, 'the unique upsert key');
    assert.ok(lookup && !lookup.options.unique, 'the {urlKey, rootItemId} lookup');
    assert.equal(tierOf(unique), 'boot');
    assert.equal(tierOf(lookup), 'boot');
  });

  test('the collection is in account erasure as a workspace row (Full wipe deletes it, no account field)', () => {
    const row = INVENTORY.find((r) => r.collection === REQUEST_USAGE_COLLECTION);
    assert.ok(row, 'request-usage must be in INVENTORY');
    assert.equal(row.kind, 'workspace');
    assert.equal(row.full, 'delete');
    assert.deepEqual(row.accountFields, []);
  });
});

describe('census: nothing outside the store reads the collection', () => {
  // Scans the source tree for the collection name and the store class. The store module itself, its
  // index and erasure registers, and this test are the only places allowed to name it. The shared
  // intake handler (piece 3, lib/request-usage-intake.js) is the one reader that writes through the
  // store; the routes call the handler and never name the store. The cost read (piece 4) adds its own
  // file when it lands.
  const ALLOWED = new Set([
    'lib/request-usage-store.js',
    'lib/request-usage-intake.js',
    'lib/db-indexes.js',
    'lib/account-erasure.js',
    // LIN-4200 (piece 3): the one-off measurement reads request-usage with find() only, never writes.
    'scripts/lin-4200-measure-records-vs-snapshots.mjs',
    // LIN-4200 (beat 3): the D13 volume and timing measurement; read-only against production, scratch writes only on a local mongod.
    'scripts/lin-4200-d13-volume-timing.mjs',
    'tests/unit/lin-4198-request-usage-store.test.js',
    'tests/unit/lin-4198-request-usage-mongod.test.js',
    // LIN-4212: the wake-posted lineage witnesses drive the store and the shared intake (both allowed) against real mongod.
    'tests/unit/lin-4212-wake-records-stranded.test.js'
  ]);
  const SCANNED_DIRS = ['lib', 'routes', 'scripts', 'tests', 'server.js'];
  const SKIP = new Set(['node_modules', 'experiments', 'public']);

  // Collects into `out` (a file returns its own path through the same array, so a recursion
  // never drops one). Without that, a directory walk collected nothing and the test passed vacuously.
  function filesUnder(path, out = []) {
    const full = join(ROOT, path);
    if (statSync(full).isFile()) {
      out.push(full);
      return out;
    }
    for (const name of readdirSync(full)) {
      if (SKIP.has(name)) continue;
      filesUnder(join(path, name), out);
    }
    return out;
  }

  test('only the allowed files name the collection or the store', () => {
    const offenders = [];
    let scanned = 0;
    for (const dir of SCANNED_DIRS) {
      for (const file of filesUnder(dir)) {
        if (!/\.(m?js|cjs)$/.test(file)) continue;
        scanned++;
        const rel = relative(ROOT, file);
        const text = readFileSync(file, 'utf8');
        if (/['"`]request-usage['"`]|RequestUsageStore|request-usage-store/.test(text) && !ALLOWED.has(rel)) {
          offenders.push(rel);
        }
      }
    }
    // lib/ alone holds hundreds of modules; a walk that found almost nothing is a broken walk, not a pass.
    assert.ok(scanned > 300, `the census must scan the source tree (scanned ${scanned})`);
    assert.deepEqual(offenders, [], 'a reader of request-usage outside the store is a defect until piece 3/4 add it here');
  });
});

describe('LIN-4198 registers: code-shape area, source map, endpoint catalogue, architecture doc', () => {
  const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

  test('the usage modules land in the Runs & dispatch code-shape area (first match wins)', () => {
    const areas = JSON.parse(read('scripts/code-shape/areas.json'));
    const list = areas.areas || areas;
    const areaOf = (file) => list.find((a) => (a.match || []).some((m) => new RegExp(m).test(file)))?.name;
    assert.equal(areaOf('lib/request-usage-store.js'), 'Runs & dispatch');
    assert.equal(areaOf('lib/request-usage-intake.js'), 'Runs & dispatch');
  });

  test('the source map has an entry for each new module and for model-pricing.js', () => {
    const map = read('docs/architecture/source-map.md');
    assert.match(map, /^\s+request-usage-store\.js\s+The `request-usage` collection \(LIN-4198/m);
    assert.match(map, /^\s+request-usage-intake\.js\s+The shared usage intake \(LIN-4198\)/m);
    assert.match(map, /^\s+model-pricing\.js\s+The rate table/m);
  });

  test('the endpoint catalogue documents the runner usage route, its limits and that no price is stored', () => {
    const cat = read('lib/proxy-instructions.js');
    assert.match(cat, /POST \$\{baseUrl\}\/api\/proxy\/runner\/usage\/:id/);
    assert.match(cat, /at most 100 per call/);
    assert.match(cat, /over 2,000,000 is rejected/);
    assert.match(cat, /No price is stored/);
  });

  test('the architecture doc states the consumer-token deviation, the growth rule and the reader list', () => {
    const doc = read('docs/architecture/dispatch-and-proxy.md');
    assert.match(doc, /POST \/api\/dispatch\/usage\/:itemId/);
    assert.match(doc, /Auth deviation from feedback, on purpose/);
    assert.match(doc, /largest|\$max/);
    assert.match(doc, /No stored price/);
    assert.match(doc, /nothing reads the collection yet except the intake route and `listForAnchors`/);
  });

  test('the db-indexes reason on the lookup index says why it is kept beside the unique key', () => {
    const idx = read('lib/db-indexes.js');
    assert.match(idx, /the unique key prefix also serves it, and the planner prefers this smaller index/);
  });
});
