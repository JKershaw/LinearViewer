/**
 * LIN-3364 — the closed-row fact (`bookkeeping` stamp) on the dispatch wire.
 *
 * Helpers table (`deriveWireStatus` / `deriveWireTerminal` / `closedProjection`
 * / `isRowClosed`), plus the proxy list + `:id` watch driven through the real
 * router over a real DispatchQueueStore (harness lifted from
 * dispatch-watch-lineage-forward-only.test.js).
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { createMockCollection } from '../fixtures/mock-collection.js';
import {
  deriveLifecycleStatus, deriveWireStatus, deriveWireTerminal, closedProjection, isRowClosed
} from '../../lib/dispatch-terminal.js';
import { recentRuns } from '../../lib/recent-runs.js';
import { normalizeDispatchRow } from '../../lib/effort-readout.js';
import { NO_ATTEMPT_STATUSES } from '../../lib/plan-review-round-trips.js';

const TOKEN = 'consumer-1';
const URLKEY = 'acme';
const fb = (...messages) => messages.map((message, i) => ({ message, timestamp: `2026-08-01T00:0${i}:00.000Z` }));
const STAMP = { at: new Date('2026-08-02T00:00:00.000Z'), by: 'acct', reason: 'handed-on' };

describe('LIN-3364 helpers', () => {
  const cases = [
    ['no feedback, unstamped', [], null, null],
    ['[pending], stamped → closed', fb('[pending] x'), STAMP, 'closed'],
    ['[blocked], stamped → closed (closed beats blocked)', fb('[blocked] x'), STAMP, 'closed'],
    ['[blocked], unstamped → blocked', fb('[blocked] x'), null, 'blocked'],
    ['[blocked] then [working] Session resumed., unstamped → null', fb('[blocked] x', '[working] Session resumed.'), null, null],
    ['[blocked] then resumed, stamped → closed', fb('[blocked] x', '[working] Session resumed.'), STAMP, 'closed'],
    ['[done], stamped → done (terminal first)', fb('[done] x'), STAMP, 'done'],
    ['[failed], unstamped → failed', fb('[failed] x'), null, 'failed'],
  ];
  for (const [name, feedback, bookkeeping, expected] of cases) {
    test(`deriveWireStatus: ${name}`, () => {
      assert.equal(deriveWireStatus({ feedback, bookkeeping }), expected);
    });
  }

  test('deriveLifecycleStatus is unchanged: ignores the stamp', () => {
    assert.equal(deriveLifecycleStatus(fb('[pending] x')), null);
    assert.equal(deriveLifecycleStatus(fb('[blocked] x')), 'blocked');
    assert.equal(deriveLifecycleStatus(fb('[done] x')), 'done');
  });

  test('deriveWireTerminal: closed is terminal, blocked is not', () => {
    assert.equal(deriveWireTerminal({ feedback: fb('[pending] x'), bookkeeping: STAMP }), 'closed');
    assert.equal(deriveWireTerminal({ feedback: fb('[blocked] x'), bookkeeping: null }), null);
    assert.equal(deriveWireTerminal({ feedback: fb('[done] x'), bookkeeping: STAMP }), 'done');
  });

  test('closedProjection normalises reasons; legacy free text → operator; unstamped → nulls', () => {
    for (const reason of ['handed-on', 'lineage-terminal', 'ticket-closed']) {
      assert.equal(closedProjection({ at: STAMP.at, reason }).closedReason, reason);
    }
    assert.equal(closedProjection({ at: STAMP.at, reason: 'fossil-pass-lin2633' }).closedReason, 'operator');
    assert.equal(closedProjection({ at: STAMP.at, reason: null }).closedReason, 'operator');
    assert.equal(closedProjection({ at: STAMP.at, reason: 'handed-on' }).closedAt, '2026-08-02T00:00:00.000Z');
    assert.deepEqual(closedProjection(null), { closedAt: null, closedReason: null });
  });

  test('isRowClosed reads the stamp only', () => {
    assert.equal(isRowClosed({ bookkeeping: STAMP }), true);
    assert.equal(isRowClosed({ bookkeeping: null }), false);
    assert.equal(isRowClosed(null), false);
  });

  test('recentRuns: a closed row reports outcome closed, not running', () => {
    const rows = [{ id: 'r1', kind: 'implementation', status: 'taken', dispatchedAt: '2026-08-01T00:00:00.000Z', feedback: fb('[pending] x'), bookkeeping: STAMP }];
    assert.equal(recentRuns(rows)[0].outcome, 'closed');
    assert.equal(recentRuns([{ ...rows[0], bookkeeping: null }])[0].outcome, 'running');
  });

  test('recentRuns: a closed row carries its stamp time and sorts by it, not last (review F1)', () => {
    const closedOld = { id: 'old', kind: 'plan', status: 'taken', dispatchedAt: '2026-01-01T00:00:00.000Z', feedback: fb('[pending] x'), bookkeeping: { ...STAMP, at: new Date('2026-01-02T00:00:00.000Z') } };
    const done = Array.from({ length: 5 }, (_, i) => ({
      id: `d${i}`, kind: 'implementation', status: 'taken', dispatchedAt: `2026-09-0${i + 1}T00:00:00.000Z`,
      feedback: [{ message: '[done] ok', timestamp: `2026-09-0${i + 1}T01:00:00.000Z` }], bookkeeping: null
    }));
    const runs = recentRuns([closedOld, ...done]);
    assert.equal(runs.length, 5);
    assert.ok(runs.every(r => r.outcome === 'done'), 'the January closed row falls out of the newest five');
    assert.equal(runs[0].at, '2026-09-01T01:00:00.000Z', 'the oldest September run is kept');
    const alone = recentRuns([closedOld]);
    assert.deepEqual(alone, [{ stage: 'plan', at: '2026-01-02T00:00:00.000Z', outcome: 'closed' }]);
  });

  test('effort-readout: a closed row is lifecycleStatus closed and a no-attempt status', () => {
    const row = { id: 'r1', kind: 'implementation', status: 'taken', dispatchedAt: '2026-08-01T00:00:00.000Z', feedback: fb('[pending] x'), bookkeeping: STAMP };
    const n = normalizeDispatchRow(row, { isLive: false });
    assert.equal(n.lifecycleStatus, 'closed');
    assert.equal(n.completedAt, null);
    assert.ok(NO_ATTEMPT_STATUSES.has('closed'));
  });
});

function buildApp({ dispatchQueueStore }) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      validateToken: async () => ({ tokenId: 't1', urlKey: URLKEY, label: 'test', scope: 'readWrite', createdBy: 'u1' })
    },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({ token: 'test-token', reason: 'ok' }),
    getWorkspaceAccessToken: async () => 'test-token',
    getWorkspaceOpenRouterKey: async () => null,
    agentStatusStore: {},
    recapCacheStore: { get: async () => null, set: async () => {} },
    briefCacheStore: { get: async () => null, set: async () => {} },
    dispatchQueueStore,
    workspaceFromUrl: (req, res, next) => next(),
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
    freeTierStore: { tryUse: async () => ({ allowed: true }) }
  }));
  return app;
}

async function call(app, path) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const started = Date.now();
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { headers: { Authorization: 'Bearer anything' } });
    return { status: res.status, body: await res.json(), elapsedMs: Date.now() - started };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

const makeStore = () => new DispatchQueueStore({ collection: createMockCollection(), historyCollection: createMockCollection() });

async function dispatchTaken(store, message) {
  const doc = await store.addItem(URLKEY, { prompt: 'p', issueIdentifier: 'LIN-1' });
  await store.takeItem(doc._id, URLKEY, TOKEN);
  if (message) await store.addFeedback(doc._id, URLKEY, { message, rootItemId: doc._id }, TOKEN);
  return doc;
}
const stamp = (store, id, bookkeeping = STAMP) =>
  store.historyCollection.updateOne({ _id: id, urlKey: URLKEY }, { $set: { bookkeeping } });

describe('LIN-3364 wire: proxy list + :id watch', () => {
  test('list and detail report status closed with closedAt/closedReason (including a fossil stamp → operator)', async () => {
    const store = makeStore();
    const app = buildApp({ dispatchQueueStore: store });
    const a = await dispatchTaken(store, '[pending] waiting');
    const b = await dispatchTaken(store, '[blocked] parked');
    await stamp(store, a._id);
    await stamp(store, b._id, { at: STAMP.at, by: null, reason: 'fossil-pass-lin2633' });

    const list = await call(app, '/api/proxy/dispatch');
    const rowA = list.body.items.find(i => i.id === a._id);
    const rowB = list.body.items.find(i => i.id === b._id);
    assert.equal(rowA.status, 'closed');
    assert.equal(rowA.closedReason, 'handed-on');
    assert.equal(rowA.closedAt, '2026-08-02T00:00:00.000Z');
    assert.equal(rowB.status, 'closed', 'closed beats blocked');
    assert.equal(rowB.closedReason, 'operator');

    const detail = await call(app, `/api/proxy/dispatch/${a._id}`);
    assert.equal(detail.body.status, 'closed');
    assert.equal(detail.body.closedReason, 'handed-on');
    assert.equal(detail.body.closedAt, '2026-08-02T00:00:00.000Z');
    assert.equal(detail.body.completedAt, null, 'completedAt stays null on the wire');
  });

  test('unstamped rows carry closedAt/closedReason as null keys', async () => {
    const store = makeStore();
    const app = buildApp({ dispatchQueueStore: store });
    const a = await dispatchTaken(store, '[pending] waiting');
    const list = await call(app, '/api/proxy/dispatch');
    const row = list.body.items.find(i => i.id === a._id);
    assert.ok('closedAt' in row && 'closedReason' in row);
    assert.equal(row.closedAt, null);
    assert.equal(row.status, 'taken');
  });

  test('?status=closed selects exactly the stamped rows', async () => {
    const store = makeStore();
    const app = buildApp({ dispatchQueueStore: store });
    const a = await dispatchTaken(store, '[pending] waiting');
    const b = await dispatchTaken(store, '[pending] waiting');
    await stamp(store, a._id);
    const list = await call(app, '/api/proxy/dispatch?status=closed');
    assert.deepEqual(list.body.items.map(i => i.id), [a._id]);
    assert.ok(b._id);
  });

  test('a later [done] on a stamped row reads done', async () => {
    const store = makeStore();
    const app = buildApp({ dispatchQueueStore: store });
    const a = await dispatchTaken(store, '[pending] waiting');
    await stamp(store, a._id);
    await store.addFeedback(a._id, URLKEY, { message: '[done] finished', rootItemId: a._id }, TOKEN);
    const detail = await call(app, `/api/proxy/dispatch/${a._id}`);
    assert.equal(detail.body.status, 'done');
  });

  test('watcher: a closed row ends the long poll immediately as terminal; a blocked row still holds it', async () => {
    const store = makeStore();
    const app = buildApp({ dispatchQueueStore: store });
    const closed = await dispatchTaken(store, '[pending] waiting');
    await stamp(store, closed._id);
    const res = await call(app, `/api/proxy/dispatch/${closed._id}?wait=1`);
    assert.equal(res.body.reason, 'terminal');
    assert.equal(res.body.waitedMs, 0);
    assert.equal(res.body.status, 'closed');

    const blocked = await dispatchTaken(store, '[blocked] parked');
    const held = await call(app, `/api/proxy/dispatch/${blocked._id}?wait=1`);
    assert.notEqual(held.body.reason, 'terminal');
    assert.ok(held.elapsedMs > 500, `expected a ~1s hold, took ${held.elapsedMs}ms`);
  });

  test('watcher: stamping a row mid-poll ends the long poll as a change (comparator + baseline)', async () => {
    const store = makeStore();
    const app = buildApp({ dispatchQueueStore: store });
    const a = await dispatchTaken(store, '[pending] waiting');
    setTimeout(() => { stamp(store, a._id); }, 150);
    const res = await call(app, `/api/proxy/dispatch/${a._id}?wait=5`);
    assert.equal(res.body.status, 'closed');
    assert.equal(res.body.reason, 'change');
    assert.ok(res.elapsedMs < 4000, `should return on the change, took ${res.elapsedMs}ms`);
  });
});
