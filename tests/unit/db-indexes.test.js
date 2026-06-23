/**
 * Unit tests for lib/db-indexes.js (LIN-610).
 *
 * Run with: node --test tests/unit/db-indexes.test.js
 *
 * Covers:
 * - every declared INDEX_SPEC is applied against a real MangoDB instance
 * - ensureIndexes is idempotent (safe to run twice, no duplicates)
 * - a failing (e.g. duplicate unique) build is tolerated: it is logged and
 *   skipped, the rest still apply, and startup never throws
 * - the deliberately-excluded `_id`-only collections get no extra index
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MangoClient } from '@jkershaw/mangodb';
import { INDEX_SPECS, ensureIndexes } from '../../lib/db-indexes.js';

// Collections the audit deliberately left on the auto `_id` index.
const EXCLUDED_COLLECTIONS = [
  'user-preferences',
  'workspace-preferences',
  'recap-cache',
  'run-summary-cache',
  'session-summary-cache',
  'brief-cache'
];

// MangoDB serialises an index key into a name; compare by key spec instead.
function hasIndexFor(indexList, keySpec) {
  const want = JSON.stringify(keySpec);
  return indexList.some(idx => JSON.stringify(idx.key) === want);
}

describe('db-indexes', () => {
  let dbDir;
  let client;
  let counter = 0;

  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'db-indexes-'));
    client = new MangoClient(dbDir);
    await client.connect();
  });

  after(async () => {
    if (client?.close) await client.close();
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  });

  function freshDb() {
    return client.db(`idx_${counter++}`);
  }

  test('INDEX_SPECS only targets non-excluded collections', () => {
    const targeted = new Set(INDEX_SPECS.map(s => s.collection));
    for (const excluded of EXCLUDED_COLLECTIONS) {
      assert.ok(
        !targeted.has(excluded),
        `excluded collection "${excluded}" must not be indexed`
      );
    }
  });

  test('every declared index is applied on a MangoDB instance', async () => {
    const db = freshDb();
    const { applied, failed } = await ensureIndexes(db);

    assert.strictEqual(failed.length, 0, 'no spec should fail on a clean db');
    assert.strictEqual(applied.length, INDEX_SPECS.length);

    // Confirm each spec is actually present on its collection.
    for (const spec of INDEX_SPECS) {
      const list = await db.collection(spec.collection).indexes();
      assert.ok(
        hasIndexFor(list, spec.keySpec),
        `expected index ${JSON.stringify(spec.keySpec)} on "${spec.collection}"`
      );
    }
  });

  test('unique option is honoured for tokenHash indexes', async () => {
    const db = freshDb();
    await ensureIndexes(db);

    const list = await db.collection('proxy-tokens').indexes();
    const tokenHashIdx = list.find(idx => JSON.stringify(idx.key) === JSON.stringify({ tokenHash: 1 }));
    assert.ok(tokenHashIdx, 'proxy-tokens tokenHash index should exist');
    assert.strictEqual(tokenHashIdx.unique, true, 'tokenHash index should be unique');
  });

  test('is idempotent: running twice does not duplicate indexes or throw', async () => {
    const db = freshDb();
    await ensureIndexes(db);

    const before = {};
    for (const spec of INDEX_SPECS) {
      before[spec.collection] = (await db.collection(spec.collection).indexes()).length;
    }

    // Second run must be a no-op (createIndex early-returns on a matching spec).
    const { failed } = await ensureIndexes(db);
    assert.strictEqual(failed.length, 0, 'second run should not fail');

    for (const spec of INDEX_SPECS) {
      const after = (await db.collection(spec.collection).indexes()).length;
      assert.strictEqual(
        after,
        before[spec.collection],
        `index count for "${spec.collection}" changed on re-run`
      );
    }
  });

  test('tolerates a failing index build: logs, skips, continues, never throws', async () => {
    // Fake db whose first collection's createIndex throws (simulating a
    // production unique build over pre-existing duplicate tokenHash data), and
    // whose every other createIndex succeeds. ensureIndexes must catch the
    // throw, record it as failed, and still apply the rest.
    const failingCollection = INDEX_SPECS[0].collection;
    let firstThrown = false;
    const warnings = [];

    const fakeDb = {
      collection(name) {
        return {
          async createIndex(keySpec) {
            if (name === failingCollection && !firstThrown) {
              firstThrown = true;
              const err = new Error('E11000 duplicate key error');
              err.name = 'DuplicateKeyError';
              throw err;
            }
            return `${name}_${JSON.stringify(keySpec)}`;
          }
        };
      }
    };

    const logger = { warn: msg => warnings.push(msg) };

    let result;
    await assert.doesNotReject(async () => {
      result = await ensureIndexes(fakeDb, { logger });
    }, 'ensureIndexes must never throw on a failing build');

    assert.strictEqual(result.failed.length, 1, 'exactly one build should fail');
    assert.strictEqual(result.failed[0].collection, failingCollection);
    assert.strictEqual(result.applied.length, INDEX_SPECS.length - 1, 'the rest still apply');
    assert.strictEqual(warnings.length, 1, 'the failure should be logged once');
    assert.match(warnings[0], /db-indexes/);
    assert.match(warnings[0], new RegExp(failingCollection));
  });
});
