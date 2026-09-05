/**
 * Unit tests for `stampBookkeeping` (LIN-2653, S1 of the LIN-2633 fossil
 * bookkeeping pass). Mirrors `trimSessionBudget`'s shape and the header note
 * on `tests/unit/dispatch-store-trim.test.js`, but run against a REAL MangoDB
 * tmpdir instance, not the shared mock — same reasoning as
 * `dispatch-store-silence-predicate.test.js` (LIN-2079): the idempotence
 * clause is expressed as `{ bookkeeping: null }` in the FILTER, which is
 * engine `null`-or-missing semantics (`query-matcher.js`'s `null` branch).
 * `tests/fixtures/mock-collection.js`'s plain-equality fallthrough treats
 * `undefined === null` as `false`, so a mock-based idempotence test would
 * pass vacuously (falling through to a JS `not-downward`-style refusal for
 * the wrong reason) while the real query matched every row, stamped or not.
 * This is the ONLY reason this store method needs a real-tmpdir test — the
 * selection logic that used to force this requirement (Revision 1's
 * `silentSince`/`$nor` predicate) no longer lives in the store at all (see
 * LIN-2633's Implementation Plan, Revision 2 note, point 4).
 *
 * Covers the plan's T8/T9/T15:
 *   T8  — idempotence: a second stamp call is a no-op; `bookkeeping.at` is
 *         UNCHANGED, not merely still present.
 *   T9  — audit entry shape: `{at, by, reason}`, `by` defaulting to `null`.
 *   T15 — `_formatHistoryItem` threading: a stamped row read back through
 *         `listHistory`/`getItemStatus` still carries `bookkeeping`.
 */
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MangoClient } from '@jkershaw/mangodb';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';

const URL_KEY = 'acme';

describe('stampBookkeeping (real MangoDB tmpdir, LIN-2653)', () => {
  let dbDir;
  let client;
  let counter = 0;
  let store;
  let history;

  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'dispatch-store-bookkeeping-'));
    client = new MangoClient(dbDir);
    await client.connect();
  });

  after(async () => {
    if (client?.close) await client.close();
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    const db = client.db(`bookkeeping_${counter++}`);
    history = db.collection('dispatch-history');
    store = new DispatchQueueStore({
      collection: db.collection('dispatch-queue'),
      historyCollection: history
    });
  });

  // A minimal, real `taken` history row — the shape `_archiveItem` writes.
  async function seedTakenRow(id, overrides = {}) {
    await history.insertOne({
      _id: id,
      urlKey: URL_KEY,
      prompt: 'p',
      promptName: 'implementation',
      dispatchedAt: new Date('2026-08-01T00:00:00.000Z'),
      status: 'taken',
      resolvedAt: new Date('2026-08-01T00:05:00.000Z'),
      feedback: [],
      bookkeeping: null,
      ...overrides
    });
  }

  describe('not-found guard', () => {
    test('an unknown row is not-found', async () => {
      const result = await store.stampBookkeeping(URL_KEY, 'nonexistent', { reason: 'stale' });
      assert.equal(result.ok, false);
      assert.equal(result.reason, 'not-found');
    });

    test('a still-queued (non-history) row is not-found — history-only, no queue fallback', async () => {
      // Unlike trimSessionBudget, stampBookkeeping never checks the active
      // queue collection at all — a bookkeeping stamp never applies to a
      // queue row (Revision 2 note, point 4).
      await store.collection.insertOne({ _id: 'queued-1', urlKey: URL_KEY, prompt: 'p' });
      const result = await store.stampBookkeeping(URL_KEY, 'queued-1', { reason: 'stale' });
      assert.equal(result.ok, false);
      assert.equal(result.reason, 'not-found');
    });

    test('a non-taken (e.g. cancelled) history row is not-found — filter requires status: taken', async () => {
      await seedTakenRow('c-1', { status: 'cancelled' });
      const result = await store.stampBookkeeping(URL_KEY, 'c-1', { reason: 'stale' });
      assert.equal(result.ok, false);
      assert.equal(result.reason, 'not-found');
    });

    test('a wrong urlKey never matches another workspace\'s row', async () => {
      await seedTakenRow('cross-1');
      const result = await store.stampBookkeeping('other-workspace', 'cross-1', { reason: 'stale' });
      assert.equal(result.ok, false);
      assert.equal(result.reason, 'not-found');
    });
  });

  // ── T9: audit entry shape ────────────────────────────────────────────────
  describe('T9 — audit entry shape', () => {
    test('a stamped row carries {at, by, reason}, by as passed', async () => {
      await seedTakenRow('t9-a');
      const before = Date.now();
      const result = await store.stampBookkeeping(URL_KEY, 't9-a', { by: 'operator-1', reason: 'fossil pass 2026-09-05' });

      assert.equal(result.ok, true);
      assert.ok(result.item.bookkeeping, 'the returned item carries the stamp');
      assert.equal(result.item.bookkeeping.by, 'operator-1');
      assert.equal(result.item.bookkeeping.reason, 'fossil pass 2026-09-05');
      assert.ok(new Date(result.item.bookkeeping.at).getTime() >= before, 'at is a fresh timestamp');
    });

    test('`by` defaults to null when omitted, mirroring trimSessionBudget\'s precedent', async () => {
      await seedTakenRow('t9-b');
      const result = await store.stampBookkeeping(URL_KEY, 't9-b', { reason: 'fossil pass' });

      assert.equal(result.ok, true);
      assert.strictEqual(result.item.bookkeeping.by, null);
    });
  });

  // ── T8: idempotence ──────────────────────────────────────────────────────
  describe('T8 — idempotence', () => {
    test('a second call on an already-stamped row is a no-op; the first bookkeeping.at is UNCHANGED', async () => {
      await seedTakenRow('t8-a');

      const first = await store.stampBookkeeping(URL_KEY, 't8-a', { by: 'operator-1', reason: 'first pass' });
      assert.equal(first.ok, true);
      const firstAt = new Date(first.item.bookkeeping.at).getTime();

      // A second run, moments later, with a DIFFERENT by/reason — proving the
      // filter's `{ bookkeeping: null }` clause (null-or-missing, engine
      // semantics) is what refuses the second write, not a JS-level guard
      // that a mock's `undefined === null` fallthrough would satisfy by
      // accident.
      const second = await store.stampBookkeeping(URL_KEY, 't8-a', { by: 'operator-2', reason: 'second pass' });
      assert.equal(second.ok, false, 'the second call must be refused, not silently overwrite');
      assert.equal(second.reason, 'not-found');

      const status = await store.getItemStatus(URL_KEY, 't8-a');
      assert.equal(new Date(status.bookkeeping.at).getTime(), firstAt, 'the first stamp\'s `at` is unchanged, not merely still present');
      assert.equal(status.bookkeeping.by, 'operator-1', 'the first stamp\'s `by` is unchanged');
      assert.equal(status.bookkeeping.reason, 'first pass', 'the first stamp\'s `reason` is unchanged');
    });

    test('a row with an explicit `bookkeeping: null` field (not merely missing) is still stampable — the engine null-or-missing filter, not $exists:false', async () => {
      // Every seeded row already sets bookkeeping: null explicitly (this
      // file's house convention, matching _formatHistoryItem's `|| null`).
      // This test names that fact instead of leaving it implicit.
      await seedTakenRow('t8-b');
      const doc = await history.findOne({ _id: 't8-b' });
      assert.strictEqual(doc.bookkeeping, null, 'seeded row carries an explicit null, not an absent field');

      const result = await store.stampBookkeeping(URL_KEY, 't8-b', { reason: 'stale' });
      assert.equal(result.ok, true, '{ bookkeeping: null } must match an explicit null, not just a missing field');
    });
  });

  // ── T15: _formatHistoryItem / listHistory / getItemStatus threading ─────
  describe('T15 — _formatHistoryItem threading', () => {
    test('a stamped row read back via getItemStatus still carries bookkeeping', async () => {
      await seedTakenRow('t15-a');
      await store.stampBookkeeping(URL_KEY, 't15-a', { by: 'operator-1', reason: 'fossil pass' });

      const status = await store.getItemStatus(URL_KEY, 't15-a');
      assert.ok(status.bookkeeping, 'getItemStatus must carry the stamp, not silently drop it');
      assert.equal(status.bookkeeping.by, 'operator-1');
      assert.equal(status.bookkeeping.reason, 'fossil pass');
    });

    test('a stamped row read back via listHistory still carries bookkeeping', async () => {
      await seedTakenRow('t15-b');
      await store.stampBookkeeping(URL_KEY, 't15-b', { by: 'operator-1', reason: 'fossil pass' });

      const { items } = await store.listHistory(URL_KEY);
      const found = items.find(i => i.id === 't15-b');
      assert.ok(found, 'the stamped row is present in listHistory');
      assert.ok(found.bookkeeping, 'listHistory must carry the stamp via _formatHistoryItem');
      assert.equal(found.bookkeeping.by, 'operator-1');
    });

    test('an unstamped row reads bookkeeping: null at every seam, never undefined', async () => {
      await seedTakenRow('t15-c');

      const status = await store.getItemStatus(URL_KEY, 't15-c');
      assert.strictEqual(status.bookkeeping, null);

      const { items } = await store.listHistory(URL_KEY);
      const found = items.find(i => i.id === 't15-c');
      assert.strictEqual(found.bookkeeping, null);
    });
  });
});
