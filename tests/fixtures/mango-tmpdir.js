/**
 * Real-engine MangoDB test harness (LIN-3162 A2).
 *
 * The A2 acceptance tests must exercise queries on a real engine: the inline
 * collection doubles in tests/unit/*.test.js ignore unknown operators, expose a
 * `toArray()`-only cursor, and have no `countDocuments` — so `$or`/`$exists`
 * matching, sort/skip/limit cursor chaining and `countDocuments` all pass
 * vacuously against them. This harness gives a real `@jkershaw/mangodb`
 * instance over a fresh `mkdtemp` dir (the established pattern in
 * tests/unit/dispatch-store-add-feedback-atomic.test.js and
 * tests/unit/db-indexes.test.js), plus a thin recording proxy used to prove
 * that paging happens in the database rather than by materialising and slicing.
 *
 * Usage:
 *   const harness = createMangoTmpdir('lin-3162-agent-status-');
 *   before(() => harness.connect());
 *   after(() => harness.close());
 *   beforeEach(() => { db = harness.freshDb(); raw = db.collection('foreman-status'); });
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MangoClient } from '@jkershaw/mangodb';

/**
 * Open a MangoDB client over a fresh tmpdir, with a `freshDb()` that returns a
 * new database per call so each test starts from an empty namespace.
 *
 * @param {string} [prefix]
 * @returns {{ client: MangoClient, connect: () => Promise<void>, freshDb: () => object, close: () => Promise<void> }}
 */
export function createMangoTmpdir(prefix = 'lin-3162-') {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const client = new MangoClient(dir);
  let counter = 0;
  return {
    client,
    async connect() {
      await client.connect();
    },
    freshDb() {
      return client.db(`db_${counter++}`);
    },
    async close() {
      try {
        if (client?.close) await client.close();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  };
}

/**
 * Wrap a REAL MangoDB collection so a test can assert how the store issued its
 * read, without faking any matching. Every actual query, sort, skip, limit and
 * count is delegated to the real engine; only the calls are recorded.
 *
 * Recorded on `collection.__record`:
 *   finds:           [{ query, options }] for every find() call
 *   countDocuments:  [{ query, options }] for every countDocuments() call
 *   cursors:         [{ query, options, sorts, skips, limits, materialized }]
 * `materialized` is the number of documents `toArray()` actually returned — the
 * proof that the database paged, not the caller slicing a full array.
 *
 * @param {object} collection - a real MangoDB collection
 * @returns {object} a delegating proxy with `__record`
 */
export function recordingCollection(collection) {
  const record = { finds: [], countDocuments: [], cursors: [] };

  const handlers = {
    __record: record,
    find(query, options) {
      const cursor = collection.find(query, options);
      const cursorRecord = { query, options, sorts: [], skips: [], limits: [], materialized: null };
      record.finds.push({ query, options });
      record.cursors.push(cursorRecord);
      const wrapped = {
        sort(spec) {
          cursorRecord.sorts.push(spec);
          cursor.sort(spec);
          return wrapped;
        },
        skip(n) {
          cursorRecord.skips.push(n);
          cursor.skip(n);
          return wrapped;
        },
        limit(n) {
          cursorRecord.limits.push(n);
          cursor.limit(n);
          return wrapped;
        },
        project(spec) {
          if (typeof cursor.project === 'function') cursor.project(spec);
          return wrapped;
        },
        async toArray() {
          const rows = await cursor.toArray();
          cursorRecord.materialized = rows.length;
          return rows;
        }
      };
      return wrapped;
    },
    countDocuments(query, options) {
      record.countDocuments.push({ query, options });
      return collection.countDocuments(query, options);
    }
  };

  return new Proxy(handlers, {
    get(target, prop, receiver) {
      if (prop in target) return Reflect.get(target, prop, receiver);
      const value = collection[prop];
      return typeof value === 'function' ? value.bind(collection) : value;
    }
  });
}
