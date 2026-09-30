/**
 * Unit tests for `scripts/retention-lifetime-pass-lin3157.js` (LIN-3164, phase C
 * of LIN-3157) — the post-deploy retention-lifetime operator pass.
 *
 * CHARACTERIZATION-FIRST (LIN-3164 beat 2): this file is written BEFORE the
 * script exists. Running it against the current tree therefore fails at the
 * import with `ERR_MODULE_NOT_FOUND` — that is the intended fail-first witness
 * for a brand-new file, not a broken test. The imports below are the contract
 * beat 3 must satisfy:
 *
 *   runRetentionLifetimePass({ db, execute?, dropIndex?, now?, log? })
 *     -> { report, perCollection, indexAudit, unsets, dropped, execute }
 *   buildRetentionReport({ perCollection, indexAudit, now, headSha, execute, dropIndex, dropped })
 *     -> string (pure)
 *   gateDropCandidate({ collection, candidate, indexes })
 *     -> { drop, replacement, reason }
 *
 * Harness: a real MangoDB tmpdir, `node --test`, one fresh db per test, teardown
 * in `after()` — the pattern at tests/unit/dispatch-store-add-feedback-atomic.test.js:275-300
 * and tests/unit/repair-account-merge-lin2233.test.js:24-40. MangoDB 0.1.2
 * supports createIndex({...},{expireAfterSeconds}), indexes()/listIndexes()
 * and dropIndex(name|keySpec), so the audit and drop paths are exercised on a
 * real engine rather than the shared mock.
 *
 * Cases covered (beat-2 Do list):
 *   1. dry run writes nothing; counts (total, stamped, past-stamp, oldest) and
 *      per-collection time field
 *   2. --execute unsets the stamp on all six; second run is a no-op
 *   3. email-magic-links / observation-sessions / dispatch-queue byte-for-byte
 *      untouched in either mode
 *   4. index audit flags a stray TTL on an evidence collection and on
 *      observation-sessions, never the email-magic-links TTL
 *   5. --drop-index drops only the named index; no flag drops nothing; refuses
 *      the email-magic-links TTL and any collection outside the six
 *   6. replacement gate: a vestigial index is a candidate only when the exact
 *      extended replacement is present (order-sensitive key match); the old A2
 *      shape, and dispatch-history's {urlKey:1,resolvedAt:-1}, are enforced
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MangoClient } from '@jkershaw/mangodb';

import {
  runRetentionLifetimePass,
  buildRetentionReport,
  gateDropCandidate
} from '../../scripts/retention-lifetime-pass-lin3157.js';

const URL_KEY = 'acme';
const DAY_MS = 24 * 60 * 60 * 1000;

// Clock anchor read once; every fixture offset derives from it and `now` is
// injected into every run, so the suite is deterministic (unlike the fossil
// pass, whose store-side `since` derives from the real clock).
const NOW_MS = Date.now();
const NOW = new Date(NOW_MS);
const daysAgo = (d) => new Date(NOW_MS - d * DAY_MS);
const daysAhead = (d) => new Date(NOW_MS + d * DAY_MS);

const EVIDENCE = [
  'dispatch-history',
  'prompt-traces',
  'foreman-status',
  'llm-call-log',
  'proxy-events',
  'credential-lifecycle-events'
];
const PROTECTED = ['email-magic-links', 'observation-sessions', 'dispatch-queue'];

// Each evidence collection's own stamp/time field names (LIN-3164 beat 1).
const STAMP = {
  'dispatch-history': 'historyExpiresAt',
  'prompt-traces': 'expiresAt',
  'foreman-status': 'expiresAt',
  'llm-call-log': 'expiresAt',
  'proxy-events': 'expiresAt',
  'credential-lifecycle-events': 'expiresAt'
};
const TIME = {
  'dispatch-history': 'dispatchedAt',
  'prompt-traces': 'timestamp',
  'foreman-status': 'timestamp',
  'llm-call-log': 'timestamp',
  'proxy-events': 'timestamp',
  'credential-lifecycle-events': 'at'
};

// The exact extended replacement shapes (order-sensitive), mirroring
// scripts/explain-paged-lists-lin3163.js:35-40.
const EXTENDED = {
  'prompt-traces': { urlKey: 1, timestamp: -1, _seq: -1, _id: -1 },
  'foreman-status': { urlKey: 1, timestamp: -1, _id: -1 },
  'llm-call-log': { urlKey: 1, timestamp: -1, _id: -1 },
  'proxy-events': { urlKey: 1, timestamp: -1, _id: -1 }
};
const A2_SHAPE = { urlKey: 1, timestamp: -1 };
const DISPATCH_LIST_INDEX = { urlKey: 1, resolvedAt: -1 };

const VESTIGIAL = {
  'prompt-traces': { urlKey: 1, expiresAt: 1 },
  'foreman-status': { urlKey: 1, expiresAt: 1 },
  'llm-call-log': { urlKey: 1, expiresAt: 1 },
  'proxy-events': { urlKey: 1, expiresAt: 1 }
};

describe('scripts/retention-lifetime-pass-lin3157.js — post-deploy retention pass', () => {
  let dbDir;
  let client;
  let counter = 0;

  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'retention-lifetime-'));
    client = new MangoClient(dbDir);
    await client.connect();
  });

  after(async () => {
    if (client?.close) await client.close();
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  });

  function freshDb() {
    return client.db(`retention_${counter++}`);
  }

  // ── fixtures ──────────────────────────────────────────────────────────────

  // Three rows per collection: one stamped-future (survivor), one stamped-past
  // (hidden but present), one unstamped. Oldest time field = 45d ago.
  async function seedFullEvidence(db) {
    await db.collection('dispatch-history').insertMany([
      { _id: 'dh-old', urlKey: URL_KEY, status: 'taken', dispatchedAt: daysAgo(45), historyExpiresAt: daysAhead(2) },
      { _id: 'dh-past', urlKey: URL_KEY, status: 'taken', dispatchedAt: daysAgo(20), historyExpiresAt: daysAgo(3) },
      { _id: 'dh-none', urlKey: URL_KEY, status: 'taken', dispatchedAt: daysAgo(1) }
    ]);
    for (const collection of ['prompt-traces', 'foreman-status', 'llm-call-log', 'proxy-events']) {
      await db.collection(collection).insertMany([
        { _id: `${collection}-old`, urlKey: URL_KEY, timestamp: daysAgo(45), expiresAt: daysAhead(2) },
        { _id: `${collection}-past`, urlKey: URL_KEY, timestamp: daysAgo(20), expiresAt: daysAgo(3) },
        { _id: `${collection}-none`, urlKey: URL_KEY, timestamp: daysAgo(1) }
      ]);
    }
    await db.collection('credential-lifecycle-events').insertMany([
      { _id: 'cle-old', accountId: 'acct', at: daysAgo(45), expiresAt: daysAhead(2) },
      { _id: 'cle-past', accountId: 'acct', at: daysAgo(20), expiresAt: daysAgo(3) },
      { _id: 'cle-none', accountId: 'acct', at: daysAgo(1) }
    ]);
  }

  async function seedOneStampedEach(db) {
    await db.collection('dispatch-history').insertOne({ _id: 'x-dh', urlKey: URL_KEY, dispatchedAt: daysAgo(5), historyExpiresAt: daysAhead(1) });
    for (const collection of ['prompt-traces', 'foreman-status', 'llm-call-log', 'proxy-events']) {
      await db.collection(collection).insertOne({ _id: `x-${collection}`, urlKey: URL_KEY, timestamp: daysAgo(5), expiresAt: daysAhead(1) });
    }
    await db.collection('credential-lifecycle-events').insertOne({ _id: 'x-cle', accountId: 'acct', at: daysAgo(5), expiresAt: daysAhead(1) });
  }

  // Stamp-like fields AND indexes on the stores the pass must never touch.
  async function seedProtected(db) {
    await db.collection('email-magic-links').createIndex({ emailNorm: 1, createdAt: -1 });
    await db.collection('email-magic-links').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 86400 });
    await db.collection('email-magic-links').insertOne({ _id: 'link-1', emailNorm: 'a@b.c', createdAt: NOW, expiresAt: daysAhead(1) });

    await db.collection('observation-sessions').createIndex({ urlKey: 1 });
    await db.collection('observation-sessions').createIndex({ historyExpiresAt: 1 });
    await db.collection('observation-sessions').insertOne({ _id: 'obs-1', urlKey: URL_KEY, historyExpiresAt: daysAhead(1) });

    await db.collection('dispatch-queue').createIndex({ urlKey: 1, expiresAt: 1 });
    await db.collection('dispatch-queue').insertOne({ _id: 'q-1', urlKey: URL_KEY, expiresAt: daysAhead(1), status: 'queued' });
  }

  // ── snapshot helpers ─────────────────────────────────────────────────────

  function indexShape(idx) {
    const shape = { name: idx.name, key: idx.key };
    if (idx.expireAfterSeconds !== undefined) shape.expireAfterSeconds = idx.expireAfterSeconds;
    return shape;
  }

  async function snapshot(db, collections = [...EVIDENCE, ...PROTECTED]) {
    const out = {};
    for (const collection of collections) {
      out[collection] = {
        docs: await db.collection(collection).find({}).sort({ _id: 1 }).toArray(),
        indexes: (await db.collection(collection).indexes()).map(indexShape)
      };
    }
    return out;
  }

  async function indexPresent(db, collection, keySpec) {
    const list = await db.collection(collection).indexes();
    return list.some((idx) => JSON.stringify(idx.key) === JSON.stringify(keySpec));
  }

  async function indexNameForKey(db, collection, keySpec) {
    const list = await db.collection(collection).indexes();
    const found = list.find((idx) => JSON.stringify(idx.key) === JSON.stringify(keySpec));
    return found ? found.name : null;
  }

  // ── 1. dry run: writes nothing, counts and field names correct ────────────

  test('dry run (default) writes nothing and reports correct counts and field names', async () => {
    const db = freshDb();
    await seedFullEvidence(db);

    const before = await snapshot(db);
    const result = await runRetentionLifetimePass({ db, now: NOW, log: () => {} });
    const after = await snapshot(db);

    assert.deepEqual(after, before, 'dry run must not change any document or index');
    assert.equal(result.execute, false, 'execute defaults to false');
    assert.match(result.report, /DRY RUN/);
    assert.match(result.report, /nothing was written/i);

    const by = Object.fromEntries(result.perCollection.map((entry) => [entry.collection, entry]));
    assert.deepEqual(Object.keys(by).sort(), [...EVIDENCE].sort(), 'reports all six evidence collections');
    for (const collection of EVIDENCE) {
      const entry = by[collection];
      assert.equal(entry.total, 3, `${collection}: total rows`);
      assert.equal(entry.stamped, 2, `${collection}: rows carrying a stamp`);
      assert.equal(entry.pastStamp, 1, `${collection}: rows whose stamp is already past`);
      assert.equal(new Date(entry.oldest).getTime(), daysAgo(45).getTime(), `${collection}: oldest ${TIME[collection]}`);
      assert.equal(entry.stamp, STAMP[collection], `${collection}: stamp field name`);
      assert.equal(entry.time, TIME[collection], `${collection}: time field name`);
    }

    // Ruling 1: the field actually used is visible in the report.
    assert.match(result.report, /dispatchedAt/, 'dispatch-history time field is named');
    assert.match(result.report, /\bat\b/, 'credential-lifecycle-events time field is named');
  });

  // ── buildRetentionReport is pure and labels the mode ─────────────────────

  test('buildRetentionReport is pure and labels DRY RUN / EXECUTE with the HEAD sha', () => {
    const base = {
      perCollection: [],
      indexAudit: { strayTtls: [], dropCandidates: [], withheld: [] },
      now: NOW,
      headSha: 'deadbeef',
      dropIndex: null,
      dropped: []
    };
    const dry = buildRetentionReport({ ...base, execute: false });
    const exec = buildRetentionReport({ ...base, execute: true });
    assert.equal(typeof dry, 'string');
    assert.match(dry, /DRY RUN/);
    assert.match(dry, /HEAD: deadbeef/);
    assert.match(exec, /EXECUTE/);
  });

  // ── 2. --execute unsets the stamp on all six, idempotent ─────────────────

  test('--execute unsets the stamp on all six collections and is idempotent', async () => {
    const db = freshDb();
    await seedOneStampedEach(db);

    const first = await runRetentionLifetimePass({ db, execute: true, now: NOW, log: () => {} });
    const firstModified = first.unsets.reduce((sum, entry) => sum + entry.modified, 0);
    assert.equal(firstModified, EVIDENCE.length, 'one stamp unset per collection');

    for (const collection of EVIDENCE) {
      const rows = await db.collection(collection).find({}).toArray();
      assert.ok(rows.length > 0, `${collection}: seeded row present`);
      for (const row of rows) {
        assert.equal(STAMP[collection] in row, false, `${collection} ${row._id}: ${STAMP[collection]} removed`);
      }
    }
    // The stamp is the only change: the time field survives.
    const dh = await db.collection('dispatch-history').findOne({ _id: 'x-dh' });
    assert.ok(dh.dispatchedAt instanceof Date, 'dispatchedAt survives the unset');
    const cle = await db.collection('credential-lifecycle-events').findOne({ _id: 'x-cle' });
    assert.ok(cle.at instanceof Date, 'credential event `at` survives the unset');

    const second = await runRetentionLifetimePass({ db, execute: true, now: NOW, log: () => {} });
    assert.ok(second.unsets.every((entry) => entry.modified === 0), 'a second --execute is a no-op');
  });

  // ── 3. protected stores untouched ────────────────────────────────────────

  test('email-magic-links, observation-sessions and the dispatch queue are untouched in either mode', async () => {
    const db = freshDb();
    await seedProtected(db);

    const before = await snapshot(db, PROTECTED);
    await runRetentionLifetimePass({ db, now: NOW, log: () => {} });
    assert.deepEqual(await snapshot(db, PROTECTED), before, 'dry run leaves the protected stores alone');

    await runRetentionLifetimePass({ db, execute: true, now: NOW, log: () => {} });
    assert.deepEqual(await snapshot(db, PROTECTED), before, '--execute leaves the protected stores alone');

    const obs = await db.collection('observation-sessions').findOne({ _id: 'obs-1' });
    assert.ok(obs.historyExpiresAt instanceof Date, 'observation-sessions keeps its stamp');
    const queue = await db.collection('dispatch-queue').findOne({ _id: 'q-1' });
    assert.ok(queue.expiresAt instanceof Date, 'the dispatch queue keeps its stamp');
  });

  // ── 4. stray-TTL index audit ─────────────────────────────────────────────

  test('index audit flags a stray TTL on an evidence collection and observation-sessions, never email-magic-links', async () => {
    const db = freshDb();
    await db.collection('prompt-traces').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 3600 });
    await db.collection('email-magic-links').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 86400 });
    await db.collection('observation-sessions').createIndex({ historyExpiresAt: 1 }, { expireAfterSeconds: 7200 });

    const result = await runRetentionLifetimePass({ db, now: NOW, log: () => {} });
    const stray = result.indexAudit.strayTtls;
    assert.ok(stray.some((s) => s.collection === 'prompt-traces'), 'flags the seeded evidence TTL');
    assert.ok(stray.some((s) => s.collection === 'observation-sessions'), 'flags the seeded observation-sessions TTL');
    assert.ok(!stray.some((s) => s.collection === 'email-magic-links'), 'the legitimate email-magic-links TTL is not a stray');
    assert.match(result.report, /stray/i, 'the report names the stray-TTL finding');
  });

  // ── 5. --drop-index drops only the named index; refuses unsafe targets ───

  test('--drop-index drops only the named index and nothing is dropped without the flag', async () => {
    const db = freshDb();
    await db.collection('prompt-traces').createIndex({ urlKey: 1, expiresAt: 1 });
    await db.collection('prompt-traces').createIndex(EXTENDED['prompt-traces']);
    const target = await indexNameForKey(db, 'prompt-traces', { urlKey: 1, expiresAt: 1 });
    assert.ok(target, 'the vestigial index was built');

    await runRetentionLifetimePass({ db, now: NOW, log: () => {} });
    assert.ok(await indexPresent(db, 'prompt-traces', { urlKey: 1, expiresAt: 1 }), 'dry run drops nothing');

    await runRetentionLifetimePass({ db, execute: true, now: NOW, log: () => {} });
    assert.ok(await indexPresent(db, 'prompt-traces', { urlKey: 1, expiresAt: 1 }), '--execute alone drops nothing');

    const result = await runRetentionLifetimePass({ db, dropIndex: `prompt-traces:${target}`, now: NOW, log: () => {} });
    assert.ok(result.dropped.some((d) => d.collection === 'prompt-traces' && d.name === target), 'reports the drop');
    assert.equal(await indexPresent(db, 'prompt-traces', { urlKey: 1, expiresAt: 1 }), false, 'the named index is gone');
    assert.ok(await indexPresent(db, 'prompt-traces', EXTENDED['prompt-traces']), 'the replacement index survives');
  });

  test('--drop-index refuses the email-magic-links TTL and collections outside the six evidence stores', async () => {
    const db = freshDb();
    await db.collection('email-magic-links').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 86400 });
    await db.collection('observation-sessions').createIndex({ historyExpiresAt: 1 });

    await assert.rejects(
      runRetentionLifetimePass({ db, dropIndex: 'email-magic-links:expiresAt_1', now: NOW, log: () => {} }),
      /refus/i
    );
    await assert.rejects(
      runRetentionLifetimePass({ db, dropIndex: 'observation-sessions:historyExpiresAt_1', now: NOW, log: () => {} }),
      /refus/i
    );

    assert.ok(await indexPresent(db, 'email-magic-links', { expiresAt: 1 }), 'the email-magic-links TTL survives');
    assert.ok(await indexPresent(db, 'observation-sessions', { historyExpiresAt: 1 }), 'the observation-sessions index survives');
  });

  // ── 6. replacement gate ──────────────────────────────────────────────────

  test('gateDropCandidate requires the exact extended replacement, order-sensitively', () => {
    // Exact extended shape present -> candidate.
    for (const collection of ['prompt-traces', 'foreman-status', 'llm-call-log', 'proxy-events']) {
      const verdict = gateDropCandidate({
        collection,
        candidate: VESTIGIAL[collection],
        indexes: [{ name: 'extended', key: EXTENDED[collection] }]
      });
      assert.equal(verdict.drop, true, `${collection}: exact replacement -> drop`);
      assert.deepEqual(verdict.replacement, EXTENDED[collection], `${collection}: names the replacement`);
    }

    // Only the old A2 shape -> withheld, with a reason.
    const a2Only = gateDropCandidate({
      collection: 'prompt-traces',
      candidate: VESTIGIAL['prompt-traces'],
      indexes: [{ name: 'urlKey_1_timestamp_-1', key: A2_SHAPE }]
    });
    assert.equal(a2Only.drop, false, 'A2 shape without _id/_seq is not the replacement');
    assert.match(a2Only.reason, /replacement|missing|absent/i, 'says why it is withheld');

    // Same fields, different key order -> not a match (order-sensitive).
    const reordered = gateDropCandidate({
      collection: 'prompt-traces',
      candidate: VESTIGIAL['prompt-traces'],
      indexes: [{ name: 'reordered', key: { _id: -1, _seq: -1, timestamp: -1, urlKey: 1 } }]
    });
    assert.equal(reordered.drop, false, 'key comparison is order-sensitive');

    // dispatch-history is gated on the live list index {urlKey:1,resolvedAt:-1}.
    const dh = gateDropCandidate({
      collection: 'dispatch-history',
      candidate: { historyExpiresAt: 1 },
      indexes: [{ name: 'urlKey_1_resolvedAt_-1', key: DISPATCH_LIST_INDEX }]
    });
    assert.equal(dh.drop, true, 'dispatch-history gated on urlKey_1_resolvedAt_-1');
    const dhMissing = gateDropCandidate({
      collection: 'dispatch-history',
      candidate: { historyExpiresAt: 1 },
      indexes: [{ name: 'urlKey_1', key: { urlKey: 1 } }]
    });
    assert.equal(dhMissing.drop, false, 'dispatch-history withholds when resolvedAt list index is absent');

    // llm-call-log per-issue successor.
    const llm = gateDropCandidate({
      collection: 'llm-call-log',
      candidate: { urlKey: 1, issueIdentifier: 1, expiresAt: 1 },
      indexes: [{ name: 'urlKey_1_issueIdentifier_1_timestamp_-1', key: { urlKey: 1, issueIdentifier: 1, timestamp: -1 } }]
    });
    assert.equal(llm.drop, true, 'llm-call-log per-issue candidate gated on its exact successor');
    const llmMissing = gateDropCandidate({
      collection: 'llm-call-log',
      candidate: { urlKey: 1, issueIdentifier: 1, expiresAt: 1 },
      indexes: [{ name: 'extended', key: EXTENDED['llm-call-log'] }]
    });
    assert.equal(llmMissing.drop, false, 'the per-issue candidate is not covered by the list index');
  });

  test('the audit recommends a vestigial drop only when its exact replacement is present, and withholds otherwise', async () => {
    const db = freshDb();
    await db.collection('prompt-traces').createIndex(VESTIGIAL['prompt-traces']);
    await db.collection('prompt-traces').createIndex(A2_SHAPE);

    const withheld = await runRetentionLifetimePass({ db, now: NOW, log: () => {} });
    assert.ok(
      !withheld.indexAudit.dropCandidates.some((c) => JSON.stringify(c.keySpec) === JSON.stringify(VESTIGIAL['prompt-traces'])),
      'A2-only replacement -> not a candidate'
    );
    assert.ok(
      withheld.indexAudit.withheld.some((w) => w.collection === 'prompt-traces' && JSON.stringify(w.keySpec) === JSON.stringify(VESTIGIAL['prompt-traces'])),
      'A2-only replacement -> withheld and named'
    );

    await db.collection('prompt-traces').createIndex(EXTENDED['prompt-traces']);
    const recommended = await runRetentionLifetimePass({ db, now: NOW, log: () => {} });
    assert.ok(
      recommended.indexAudit.dropCandidates.some((c) => c.collection === 'prompt-traces' && JSON.stringify(c.keySpec) === JSON.stringify(VESTIGIAL['prompt-traces'])),
      'exact replacement present -> candidate'
    );
    assert.match(recommended.report, /urlKey_1_expiresAt_1/, 'the report names the droppable index');
  });

  test('dispatch-history historyExpiresAt is a candidate only when {urlKey:1,resolvedAt:-1} is present', async () => {
    const missingDb = freshDb();
    await missingDb.collection('dispatch-history').createIndex({ historyExpiresAt: 1 });
    await missingDb.collection('dispatch-history').createIndex({ urlKey: 1 });
    const withheld = await runRetentionLifetimePass({ db: missingDb, now: NOW, log: () => {} });
    assert.ok(
      withheld.indexAudit.withheld.some((w) => w.collection === 'dispatch-history' && JSON.stringify(w.keySpec) === JSON.stringify({ historyExpiresAt: 1 })),
      'no resolvedAt list index -> withheld'
    );

    const presentDb = freshDb();
    await presentDb.collection('dispatch-history').createIndex({ historyExpiresAt: 1 });
    await presentDb.collection('dispatch-history').createIndex(DISPATCH_LIST_INDEX);
    const recommended = await runRetentionLifetimePass({ db: presentDb, now: NOW, log: () => {} });
    assert.ok(
      recommended.indexAudit.dropCandidates.some((c) => c.collection === 'dispatch-history' && JSON.stringify(c.keySpec) === JSON.stringify({ historyExpiresAt: 1 })),
      'resolvedAt list index present -> candidate'
    );
  });
});
