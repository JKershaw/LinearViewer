/**
 * scripts/lin3014/lib/replay-core.mjs (LIN-3014)
 *
 * Pure helpers for the local replay copy ruling `16c2be3e` authorized:
 * `prompt` must never be in the copy, and every deletion must produce a
 * structured record (path + command) fit to post on the ticket verbatim.
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { buildDeletionRecord, replayProjection, replayWindowQuery } from '../../scripts/lin3014/lib/replay-core.mjs';
import { copyProductionWindow } from '../../scripts/lin3014/replay.mjs';

test('LIN-3014 replayProjection: excludes prompt and nothing else', () => {
  assert.deepStrictEqual(replayProjection(), { prompt: 0 });
});

test('LIN-3014 replayWindowQuery: builds the urlKey + dispatchedAt window query', () => {
  const sinceMs = Date.parse('2026-08-25T00:00:00.000Z');
  const query = replayWindowQuery({ urlKey: 'linearviewer', sinceMs });
  assert.strictEqual(query.urlKey, 'linearviewer');
  assert.ok(query.dispatchedAt.$gte instanceof Date);
  assert.strictEqual(query.dispatchedAt.$gte.getTime(), sinceMs);
});

test('LIN-3014 replayWindowQuery: requires urlKey and a finite sinceMs', () => {
  assert.throws(() => replayWindowQuery({ sinceMs: 1 }), /urlKey/);
  assert.throws(() => replayWindowQuery({ urlKey: 'x', sinceMs: NaN }), /sinceMs/);
});

test('LIN-3014 buildDeletionRecord: records path, command and row count, fit to post verbatim', () => {
  const record = buildDeletionRecord({
    dbPath: 'mongodb://127.0.0.1:27999/lv_replay',
    collectionName: 'dispatch-history',
    rowsDeleted: 42,
    command: 'db.getCollection("dispatch-history").drop()',
    deletedAt: new Date('2026-09-24T21:00:00.000Z')
  });
  assert.strictEqual(record.event, 'lin3014-replay-deleted');
  assert.strictEqual(record.dbPath, 'mongodb://127.0.0.1:27999/lv_replay');
  assert.strictEqual(record.collectionName, 'dispatch-history');
  assert.strictEqual(record.rowsDeleted, 42);
  assert.strictEqual(record.command, 'db.getCollection("dispatch-history").drop()');
  assert.strictEqual(record.deletedAt, '2026-09-24T21:00:00.000Z');
});

test('LIN-3014 buildDeletionRecord: requires dbPath and command — a deletion record with no path/command is not evidence', () => {
  assert.throws(() => buildDeletionRecord({ collectionName: 'x', rowsDeleted: 0, command: 'drop' }), /dbPath/);
  assert.throws(() => buildDeletionRecord({ dbPath: 'mongodb://127.0.0.1:1/x', collectionName: 'x', rowsDeleted: 0 }), /command/);
});

// LIN-3014 beat 3 production-run finding: copyProductionWindow originally
// called `prodCollection.find(query, projection)` — the mongosh SHELL's
// 2-arg form. The MongoDB NODE DRIVER's find(filter, options) takes the
// projection under `options.projection`; passed bare, it's silently treated
// as an unrecognised options object and EVERY field comes back, including
// `prompt` — exactly what ruling `16c2be3e` forbids the replay copy from
// ever carrying. Caught only by the actual production run (a local replica
// full of `prompt` text), never by a test that mocks `.find` as a no-op.
test('LIN-3014 copyProductionWindow: calls find() with the projection under options.projection (the Node driver shape), not as a bare 2nd arg', async () => {
  let capturedArgs = null;
  const stubCollection = {
    find(filter, options) {
      capturedArgs = [filter, options];
      return { toArray: async () => [] };
    }
  };
  await copyProductionWindow(stubCollection, { urlKey: 'linearviewer', sinceMs: Date.parse('2026-08-25T00:00:00.000Z') });
  assert.ok(capturedArgs, 'find() must have been called');
  const [filter, options] = capturedArgs;
  assert.strictEqual(filter.urlKey, 'linearviewer');
  assert.deepStrictEqual(options, { projection: { prompt: 0 } }, 'the projection must be nested under options.projection (Node driver), not passed bare as the 2nd argument (mongosh shell shape)');
});

test('LIN-3014 copyProductionWindow: returns exactly what find().toArray() yields', async () => {
  const docs = [{ _id: 'a' }, { _id: 'b' }];
  const stubCollection = { find: () => ({ toArray: async () => docs }) };
  const result = await copyProductionWindow(stubCollection, { urlKey: 'linearviewer', sinceMs: Date.now() });
  assert.deepStrictEqual(result, docs);
});
