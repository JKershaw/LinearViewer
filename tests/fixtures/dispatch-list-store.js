/**
 * A REAL DispatchQueueStore over mock collections, seeded from formatted rows
 * (LIN-3812). `GET /api/proxy/dispatch` reads the persisted lineage fields through
 * the store (`listHistoryLineageRows`), so the route tests seed rows the way the
 * list tests always did (`{id, status, feedback: [...], rootItemId, ...}`) and let the
 * store derive: a seeded row carries no lineage fields, exactly like a pre-LIN-3812
 * row, so the read-time self-heal and `ensureLineageStatus` are what answer.
 */
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { createMockCollection } from './mock-collection.js';

const toDoc = (row, urlKey) => {
  const { id, ...rest } = row;
  return { prompt: null, ...rest, _id: id, urlKey };
};

export async function seededStore({ queued = [], history = [], urlKey = 'acme' } = {}) {
  const collection = createMockCollection();
  const historyCollection = createMockCollection();
  for (const row of queued) await collection.insertOne(toDoc({ status: 'queued', expiresAt: new Date(Date.now() + 86400000), ...row }, urlKey));
  for (const row of history) await historyCollection.insertOne(toDoc(row, urlKey));
  return new DispatchQueueStore({ collection, historyCollection });
}
