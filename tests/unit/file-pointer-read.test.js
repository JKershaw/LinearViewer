/**
 * Unit tests for the LIN-3200 P7 read-side row loader
 * (scripts/file-pointer-read.mjs).
 *
 * The load-bearing property: the read must see HISTORY rows. The store's
 * listHistory feeds `_formatHistoryItem`, which invents `kind: 'custom'` when a
 * raw `kind` is absent — and an inclusion projection like `{ prompt: 1 }` makes
 * every raw field absent. With that projection each archived row fails
 * `isPilotEligible`, so the read would see only the live queue. The fake history
 * collection below applies projection faithfully (inclusion collapses, exclusion
 * keeps) so this test goes red under the old `{ prompt: 1 }` and green under
 * `{ feedback: 0 }`. Queue ∪ history is also de-duped by `_id`, as P4 does.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { createMockCollection } from '../fixtures/mock-collection.js';
import { isPilotEligible, classifyPilotRows } from '../../lib/file-pointer.js';
import { loadPilotRows, mergePilotRows, toRow } from '../../scripts/file-pointer-read.mjs';

/**
 * A history collection whose `find().toArray()` applies projection the way real
 * Mongo does: an inclusion projection ({key: 1}) returns only `_id` + the
 * included keys; an exclusion projection ({key: 0}) drops those keys. The shared
 * mock only honours exclusion, so it cannot witness this bug.
 */
function projectionHistoryCollection(docs) {
  return {
    find(query) {
      return {
        async toArray() {
          return docs.filter(d => d.urlKey === query.urlKey).map(d => ({ ...d }));
        }
      };
    }
  };
}

function applyProjection(rows, projection) {
  if (!projection) return rows;
  const keys = Object.keys(projection);
  const included = keys.filter(k => projection[k] === 1 || projection[k] === true);
  if (included.length) {
    return rows.map(d => {
      const out = { _id: d._id };
      for (const k of included) out[k] = d[k];
      return out;
    });
  }
  const excluded = keys.filter(k => projection[k] === 0);
  return rows.map(d => {
    const copy = { ...d };
    for (const k of excluded) delete copy[k];
    return copy;
  });
}

// Same as above, but actually applies the projection (for the regression pin).
function projectedHistoryCollection(docs) {
  const base = projectionHistoryCollection(docs);
  return {
    find(query, options = {}) {
      const inner = base.find(query);
      return {
        async toArray() {
          return applyProjection(await inner.toArray(), options.projection);
        }
      };
    }
  };
}

function historyDoc(extra = {}) {
  return {
    _id: 'hist-1',
    urlKey: 'acme',
    kind: 'implementation',
    issueIdentifier: 'LIN-HIST',
    followUpTo: null,
    abort: false,
    dispatchedAt: new Date('2026-10-01T10:00:00.000Z'),
    resolvedAt: new Date('2026-10-01T10:05:00.000Z'),
    prompt: 'archived work',
    ...extra
  };
}

describe('file-pointer-read — toRow / merge/de-dupe', () => {
  test('de-dupes queue ∪ history by _id and keeps history rows', () => {
    const rows = mergePilotRows({
      liveItems: [toRow({ id: 'a', kind: 'implementation', issueIdentifier: 'LIN-1', prompt: 'x' })],
      historyItems: [
        { id: 'a', kind: 'implementation', issueIdentifier: 'LIN-1', prompt: 'x' },
        { id: 'b', kind: 'implementation', issueIdentifier: 'LIN-2', prompt: 'y' }
      ]
    });
    assert.deepEqual(rows.map(r => r.id), ['a', 'b']);
  });

  test('rows without an id are never collapsed together', () => {
    const rows = mergePilotRows({
      liveItems: [],
      historyItems: [{ kind: 'implementation', issueIdentifier: 'LIN-1' }, { kind: 'implementation', issueIdentifier: 'LIN-1' }]
    });
    assert.equal(rows.length, 2);
  });
});

describe('file-pointer-read — loadPilotRows sees history (P7)', () => {
  test('an archived eligible row survives the loader and counts as eligible', async () => {
    const store = new DispatchQueueStore({
      collection: createMockCollection(),
      historyCollection: projectedHistoryCollection([historyDoc()])
    });
    await store.addItem('acme', { prompt: 'live work', kind: 'implementation', issueIdentifier: 'LIN-LIVE' });

    const rows = await loadPilotRows(store, 'acme');
    const hist = rows.find(r => String(r.id) === 'hist-1');
    assert.ok(hist, 'history row must be visible to the read');
    assert.equal(hist.kind, 'implementation');
    assert.equal(hist.issueIdentifier, 'LIN-HIST');
    assert.ok(hist.dispatchedAt, 'dispatchedAt must survive for the recompute');
    assert.equal(isPilotEligible(hist), true);
    assert.equal(classifyPilotRows(rows).totals.eligible, 2);
  });

  test('regression pin: the old inclusion projection hid every history row', async () => {
    // Directly exercise the store read with the projection the script used to
    // pass, to show why the loader must use an exclusion.
    const store = new DispatchQueueStore({
      collection: createMockCollection(),
      historyCollection: projectedHistoryCollection([historyDoc()])
    });
    const { items } = await store.listHistory('acme', { projection: { prompt: 1 } });
    assert.equal(items.length, 1);
    assert.equal(items[0].kind, 'custom', 'inclusion projection collapses kind');
    assert.equal(items[0].issueIdentifier, undefined);
    assert.equal(isPilotEligible(items[0]), false);
  });

  test('a row in BOTH collections is counted once, not flagged as a duplicate', async () => {
    const doc = historyDoc({ _id: 'both-1', issueIdentifier: 'LIN-BOTH' });
    const history = [doc];
    const store = new DispatchQueueStore({
      collection: createMockCollection(),
      historyCollection: projectedHistoryCollection(history)
    });
    // Seed an identical _id into the live queue.
    await store.collection.insertOne({ ...doc, resolvedAt: null });

    const rows = await loadPilotRows(store, 'acme');
    assert.equal(rows.filter(r => String(r.id) === 'both-1').length, 1);
    assert.equal(classifyPilotRows(rows).totals.eligible, 1);
  });
});
