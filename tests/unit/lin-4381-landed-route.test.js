/**
 * LIN-4381 — route-level, real-store witness for the self-trigger exclusion
 * (plan risk 1; plan-review b79ff49e, B1).
 *
 * A Periodical's own PR must not make its lane `landed`. The fold ignores a
 * landing on an issue a Periodical row names, but the route reads rows under
 * PERIODICAL_PROJECTION / PERIODICAL_HISTORY_PROJECTION, and a field those
 * inclusion projections do not grant arrives empty. A fold test can't see that.
 * This one runs GET /api/proxy/periodicals over a real DispatchQueueStore and a
 * real CloseOutEventsStore (MangoDB on disk, no store stubs), so it fails when
 * `issueIdentifier` is not projected. The positive case (a landing on an
 * unrelated issue reads `landed`) keeps the exclusion case from passing
 * vacuously.
 *
 * The route reads the clock itself, so the seeded run is aged by writing its
 * archived `dispatchedAt` back three days in the real history collection.
 */
process.env.NODE_ENV = 'test';

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MangoClient } from '@jkershaw/mangodb';
import { createProxyRoutes } from '../../routes/proxy.js';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { CloseOutEventsStore } from '../../lib/close-out-events-store.js';
import { getPeriodicals } from '../../lib/periodicals.js';

const URL_KEY = 'acme';
const DAY_MS = 24 * 60 * 60 * 1000;
const TEMPLATE = getPeriodicals().find(t => t.scope === 'repo');
const REVIEW_ISSUE = 'LIN-900';

describe('LIN-4381: GET /api/proxy/periodicals over real stores', () => {
  let client;
  let dbDir;
  let counter = 0;

  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'lin-4381-landed-route-'));
    client = new MangoClient(dbDir);
    await client.connect();
  });

  after(async () => {
    if (client?.close) await client.close();
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  });

  // Real stores, plus a Stage-2 run of TEMPLATE that names REVIEW_ISSUE, carries
  // the periodicalId stamp, was taken and reported [done], three days ago.
  async function seed() {
    const db = client.db(`lin_4381_route_${counter++}`);
    const historyCollection = db.collection('dispatch-history');
    const dispatchQueueStore = new DispatchQueueStore({ collection: db.collection('dispatch-queue'), historyCollection });
    const closeOutEventsStore = new CloseOutEventsStore({ collection: db.collection('close-out-events') });

    const created = await dispatchQueueStore.addItem(URL_KEY, {
      prompt: 'run the review',
      promptName: 'review',
      kind: 'review',
      periodicalId: TEMPLATE.id,
      issueIdentifier: REVIEW_ISSUE
    });
    await dispatchQueueStore.takeItem(created._id, URL_KEY, 'token-a');
    await dispatchQueueStore.addFeedback(created._id, URL_KEY, { message: '[done] review written' }, 'token-a');
    const aged = await historyCollection.updateOne(
      { urlKey: URL_KEY, issueIdentifier: REVIEW_ISSUE },
      { $set: { dispatchedAt: new Date(Date.now() - 3 * DAY_MS) } }
    );
    assert.equal(aged.matchedCount, 1, 'setup: the archived Stage-2 row must exist to age');
    return { dispatchQueueStore, closeOutEventsStore };
  }

  async function recordMerge(closeOutEventsStore, issueIdentifier, n) {
    const event = await closeOutEventsStore.record({
      urlKey: URL_KEY,
      accountId: null,
      issueId: null,
      issueIdentifier,
      by: 'close-out',
      prUrl: `https://github.com/JKershaw/LinearViewer/pull/${n}`,
      headSha: `sha${n}`,
      merged: true,
      openItems: { inside: 0, outside: 0, unknown: 0, total: 0 },
      prMergedAt: new Date(Date.now() - DAY_MS)
    });
    assert.ok(event?._id, 'setup: the merged event must record');
  }

  async function getPeriodicalsRoute({ dispatchQueueStore, closeOutEventsStore }) {
    const app = express();
    app.use(express.json());
    app.use(createProxyRoutes({
      proxyTokenStore: {
        validateToken: async () => ({ tokenId: 't1', urlKey: URL_KEY, label: 'test', scope: 'read', createdBy: 'u1' }),
        describeRejectionCause: async () => null
      },
      proxyEventStore: { recordEvent: async () => {} },
      resolveWorkspaceAccess: async () => ({ token: 'test-token', reason: 'ok' }),
      getWorkspaceAccessToken: async () => 'test-token',
      getWorkspaceOpenRouterKey: async () => null,
      agentStatusStore: {},
      recapCacheStore: { get: async () => null, set: async () => {} },
      briefCacheStore: { get: async () => null, set: async () => {} },
      dispatchQueueStore,
      closeOutEventsStore,
      workspaceFromUrl: (req, res, next) => next(),
      freeTierStore: { tryUse: async () => ({ allowed: true }) }
    }));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    try {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/api/proxy/periodicals`, {
        headers: { Authorization: 'Bearer anything' }
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      return body.periodicals.find(p => p.id === TEMPLATE.id);
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  }

  test('a merged event on the review issue a Periodical row names leaves the lane recent', async () => {
    const stores = await seed();
    await recordMerge(stores.closeOutEventsStore, REVIEW_ISSUE, 1);
    const item = await getPeriodicalsRoute(stores);
    assert.equal(item.repos[0].state, 'recent', 'a Periodical\'s own PR merge must not make its lane landed');
    assert.equal(item.state, 'recent');
  });

  test('a merged event on an unrelated issue, past the one-day gap, makes the lane landed', async () => {
    const stores = await seed();
    await recordMerge(stores.closeOutEventsStore, 'LIN-77', 2);
    const item = await getPeriodicalsRoute(stores);
    assert.equal(item.repos[0].state, 'landed');
    assert.equal(item.state, 'landed');
  });
});
