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
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MangoClient } from '@jkershaw/mangodb';

import {
  runRetentionLifetimePass,
  buildRetentionReport,
  gateDropCandidate
} from '../../scripts/retention-lifetime-pass-lin3157.js';

const SCRIPT_PATH = fileURLToPath(new URL('../../scripts/retention-lifetime-pass-lin3157.js', import.meta.url));

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

  // ─────────────────────────────────────────────────────────────────────────
  // Corrective pass — tests for review R1–R6 / ledger L1–L6 (LIN-3164).
  // These anchor the safety surface the review found untested. They are written
  // against the reviewed head `b6b82ece`; each fail-first witness reds for the
  // behaviour it names (R1/R2/R3/R5/R6), while L4/M15 and L5/M19 are
  // mutation-witnesses for behaviour the code already has (they go red only
  // under the M15/M19 mutations; see the beat report).
  // ─────────────────────────────────────────────────────────────────────────

  // A dry run must never materialise a whole collection: a cursor that reaches
  // `toArray()` without an intervening `.limit()` is an unbounded read and a
  // violation (R5 / L6).
  function wrapCountingCursor(cursor, collection, violations, state = { limited: false }) {
    return new Proxy(cursor, {
      get(target, prop) {
        if (prop === 'limit') {
          return (...args) => {
            state.limited = true;
            return wrapCountingCursor(target.limit(...args), collection, violations, state);
          };
        }
        if (prop === 'sort') {
          return (...args) => wrapCountingCursor(target.sort(...args), collection, violations, state);
        }
        if (prop === 'toArray') {
          return (...args) => {
            if (!state.limited) violations.push({ collection });
            return target.toArray(...args);
          };
        }
        const value = Reflect.get(target, prop);
        return typeof value === 'function' ? value.bind(target) : value;
      }
    });
  }

  function spyDb(realDb, violations) {
    return {
      collection(name) {
        const real = realDb.collection(name);
        return new Proxy(real, {
          get(target, prop) {
            if (prop === 'find') {
              return (filter, ...rest) =>
                wrapCountingCursor(target.find(filter, ...rest), name, violations);
            }
            const value = Reflect.get(target, prop);
            return typeof value === 'function' ? value.bind(target) : value;
          }
        });
      }
    };
  }

  // L1 / R1 / M18 — a refused drop target must fail before ANY write.
  test('L1/R1/M18 — an execute run with a refused drop target leaves every stamp in place', async () => {
    const typoDb = freshDb();
    await seedOneStampedEach(typoDb);
    await assert.rejects(
      runRetentionLifetimePass({ db: typoDb, execute: true, dropIndex: 'prompt-traces:typo_1', now: NOW, log: () => {} }),
      /refus|not found/i,
      'a nonexistent index name is refused'
    );
    for (const collection of EVIDENCE) {
      const rows = await typoDb.collection(collection).find({}).toArray();
      assert.ok(rows.length > 0, `${collection}: seeded row present`);
      for (const row of rows) {
        assert.ok(
          STAMP[collection] in row,
          `${collection} ${row._id}: stamp survives a refused nonexistent-name drop`
        );
      }
    }

    const disallowedDb = freshDb();
    await seedOneStampedEach(disallowedDb);
    await assert.rejects(
      runRetentionLifetimePass({ db: disallowedDb, execute: true, dropIndex: 'email-magic-links:expiresAt_1', now: NOW, log: () => {} }),
      /refus/i,
      'a disallowed target is refused'
    );
    for (const collection of EVIDENCE) {
      const rows = await disallowedDb.collection(collection).find({}).toArray();
      for (const row of rows) {
        assert.ok(
          STAMP[collection] in row,
          `${collection} ${row._id}: stamp survives a refused disallowed-target drop`
        );
      }
    }
  });

  // L3 / R3 — the allowed drop set is dropCandidates ∪ strayTtls (six evidence
  // collections only); it is never the live replacement, a withheld candidate,
  // email-magic-links, observation-sessions or _id_.
  test('R3/L3 — --drop-index refuses the live replacement index and a replacement-missing (withheld) vestigial index', async () => {
    // (a) the live LIN-3163 paged-list replacement must never be droppable.
    const liveDb = freshDb();
    await liveDb.collection('prompt-traces').createIndex(EXTENDED['prompt-traces']);
    const liveName = await indexNameForKey(liveDb, 'prompt-traces', EXTENDED['prompt-traces']);
    assert.equal(liveName, 'urlKey_1_timestamp_-1__seq_-1__id_-1', 'the live replacement auto-name matches the review');
    const liveAudit = await runRetentionLifetimePass({ db: liveDb, now: NOW, log: () => {} });
    assert.ok(
      !liveAudit.indexAudit.dropCandidates.some((c) => c.name === liveName),
      'the live replacement is not a drop candidate'
    );
    await assert.rejects(
      runRetentionLifetimePass({ db: liveDb, dropIndex: `prompt-traces:${liveName}`, now: NOW, log: () => {} }),
      /refus/i,
      'the live replacement is refused'
    );
    assert.ok(await indexPresent(liveDb, 'prompt-traces', EXTENDED['prompt-traces']), 'the live replacement survives');

    // (b) a vestigial index the audit withheld (replacement missing) must not drop.
    const withheldDb = freshDb();
    await withheldDb.collection('prompt-traces').createIndex(VESTIGIAL['prompt-traces']);
    await withheldDb.collection('prompt-traces').createIndex(A2_SHAPE);
    const withheldName = await indexNameForKey(withheldDb, 'prompt-traces', VESTIGIAL['prompt-traces']);
    const dry = await runRetentionLifetimePass({ db: withheldDb, now: NOW, log: () => {} });
    assert.ok(
      dry.indexAudit.withheld.some((w) => w.name === withheldName),
      'the vestigial index is withheld in this fixture (A2 shape only)'
    );
    await assert.rejects(
      runRetentionLifetimePass({ db: withheldDb, dropIndex: `prompt-traces:${withheldName}`, now: NOW, log: () => {} }),
      /refus/i,
      'a replacement-missing (withheld) candidate is refused'
    );
    assert.ok(await indexPresent(withheldDb, 'prompt-traces', VESTIGIAL['prompt-traces']), 'the withheld vestigial survives');
  });

  // L3 / R3 positive half — the fix must not over-refuse: a gated candidate and
  // a stray TTL this run found stay droppable. (Over-refusal guard: passes on
  // the unfixed head too, by design.)
  test('R3/L3 — --drop-index still allows a gated candidate and a stray TTL this run found', async () => {
    const gatedDb = freshDb();
    await gatedDb.collection('prompt-traces').createIndex(VESTIGIAL['prompt-traces']);
    await gatedDb.collection('prompt-traces').createIndex(EXTENDED['prompt-traces']);
    const gatedName = await indexNameForKey(gatedDb, 'prompt-traces', VESTIGIAL['prompt-traces']);
    const gated = await runRetentionLifetimePass({ db: gatedDb, dropIndex: `prompt-traces:${gatedName}`, now: NOW, log: () => {} });
    assert.ok(gated.dropped.some((d) => d.name === gatedName), 'a replacement-present candidate is droppable');
    assert.equal(await indexPresent(gatedDb, 'prompt-traces', VESTIGIAL['prompt-traces']), false, 'the gated candidate is gone');

    const strayDb = freshDb();
    await strayDb.collection('proxy-events').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 3600 });
    const strayName = await indexNameForKey(strayDb, 'proxy-events', { expiresAt: 1 });
    const audited = await runRetentionLifetimePass({ db: strayDb, now: NOW, log: () => {} });
    assert.ok(
      audited.indexAudit.strayTtls.some((s) => s.collection === 'proxy-events' && s.name === strayName),
      'the stray TTL is audited on an evidence collection'
    );
    const strayDrop = await runRetentionLifetimePass({ db: strayDb, dropIndex: `proxy-events:${strayName}`, now: NOW, log: () => {} });
    assert.ok(strayDrop.dropped.some((d) => d.name === strayName), 'a stray TTL this run found is droppable');
  });

  // L2 / R2 — the report's mode must match what actually happened.
  test('L2/R2 — a drop-only report is not a dry run, never says nothing was written, and names the drop', async () => {
    const db = freshDb();
    await db.collection('prompt-traces').createIndex(VESTIGIAL['prompt-traces']);
    await db.collection('prompt-traces').createIndex(EXTENDED['prompt-traces']);
    const name = await indexNameForKey(db, 'prompt-traces', VESTIGIAL['prompt-traces']);

    const dropOnly = await runRetentionLifetimePass({ db, dropIndex: `prompt-traces:${name}`, now: NOW, log: () => {} });
    assert.equal(dropOnly.dropped.length, 1, 'the drop happened');
    assert.doesNotMatch(dropOnly.report, /DRY RUN/, 'a run that dropped an index is not labelled a dry run');
    assert.doesNotMatch(dropOnly.report, /nothing was written/i, 'a run that dropped an index must not say nothing was written');
    assert.match(dropOnly.report, new RegExp(name), 'the report names the dropped index');

    const pureDryDb = freshDb();
    await seedOneStampedEach(pureDryDb);
    const pureDry = await runRetentionLifetimePass({ db: pureDryDb, now: NOW, log: () => {} });
    assert.match(pureDry.report, /DRY RUN/, 'a pure dry run still says DRY RUN');
    assert.match(pureDry.report, /nothing was written/i, 'a pure dry run still says nothing was written');
  });

  // L4 / M15 — an asymmetric fixture so a `<`→`>` mutation changes the count.
  test('L4/M15 — the past-stamp count is pinned with an asymmetric 2-past / 1-future fixture', async () => {
    const db = freshDb();
    await db.collection('prompt-traces').insertMany([
      { _id: 'p1', urlKey: URL_KEY, timestamp: daysAgo(30), expiresAt: daysAgo(5) },
      { _id: 'p2', urlKey: URL_KEY, timestamp: daysAgo(20), expiresAt: daysAgo(2) },
      { _id: 'f1', urlKey: URL_KEY, timestamp: daysAgo(10), expiresAt: daysAhead(5) }
    ]);
    const result = await runRetentionLifetimePass({ db, now: NOW, log: () => {} });
    const entry = result.perCollection.find((e) => e.collection === 'prompt-traces');
    assert.equal(entry.total, 3, 'three rows');
    assert.equal(entry.stamped, 3, 'all three stamped');
    assert.equal(entry.pastStamp, 2, 'exactly two past stamps — not one');
  });

  // L5 / M19 — the _id_ guard has a witness.
  test('L5/M19 — --drop-index refuses _id_ on an evidence collection', async () => {
    const db = freshDb();
    await db.collection('prompt-traces').insertOne({ _id: 'row', urlKey: URL_KEY });
    await assert.rejects(
      runRetentionLifetimePass({ db, dropIndex: 'prompt-traces:_id_', now: NOW, log: () => {} }),
      /refus/i,
      '_id_ is refused'
    );
    assert.ok(await indexPresent(db, 'prompt-traces', { _id: 1 }), 'the _id_ index survives');
  });

  // R6 — the CLI arg parser must refuse a bare flag, not fall through to a dry run.
  test('R6 — a bare --drop-index with no value is refused loudly at the CLI seam', () => {
    const dir = mkdtempSync(join(tmpdir(), 'retention-cli-'));
    try {
      let refusal = null;
      try {
        execFileSync(process.execPath, [SCRIPT_PATH, '--drop-index'], {
          encoding: 'utf8',
          env: { ...process.env, HARBOUR_DATA_DIR: dir, MONGODB_URI: '' }
        });
      } catch (err) {
        refusal = err;
      }
      assert.ok(refusal, 'a bare --drop-index must fail loudly (non-zero), not fall back to a dry run');
      assert.notEqual(refusal.status, 0, 'the CLI exits non-zero');
      assert.match(String(refusal.stderr || ''), /refus|--drop-index/i, 'stderr explains the refusal');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // R6 — the Unset lines must name the stamp field.
  test('R6 — the ## Unset section names each collection\'s stamp field, never a blank', async () => {
    const db = freshDb();
    await seedOneStampedEach(db);
    const result = await runRetentionLifetimePass({ db, execute: true, now: NOW, log: () => {} });
    const start = result.report.indexOf('## Unset');
    assert.notEqual(start, -1, 'an execute report has an Unset section');
    const end = result.report.indexOf('Execute —', start);
    const section = result.report.slice(start, end === -1 ? undefined : end);
    for (const collection of EVIDENCE) {
      assert.match(section, new RegExp(STAMP[collection]), `the Unset line for ${collection} names ${STAMP[collection]}`);
    }
    assert.doesNotMatch(section, /undefined/, 'no undefined is rendered');
  });

  // L6 / R5 — the dry run must not read whole collections for its counts.
  test('L6/R5 — the dry run never reads a whole collection for its counts', async () => {
    const db = freshDb();
    await seedFullEvidence(db);
    const violations = [];
    const result = await runRetentionLifetimePass({ db: spyDb(db, violations), now: NOW, log: () => {} });
    assert.deepEqual(violations, [], 'no unbounded find(...).toArray() over any collection');
    assert.equal(result.perCollection.length, EVIDENCE.length, 'the counts are still produced');
    assert.ok(result.perCollection.every((entry) => entry.total === 3), 'the counts remain correct');
  });
});
