/**
 * LIN-2122 — the Dispatch page's history reports each archived dispatch's real outcome word.
 *
 * Run with: node --test tests/unit/lin-2122-dispatch-history-outcome.test.js
 *
 * Before: `GET /workspace/:urlKey/api/dispatch/history` returned only the stored `status`,
 * which is `taken` for every archived row, so a failed run read as a green success pill.
 * After: each history item also carries `outcome`, the same word `GET /api/proxy/dispatch`
 * reports for that dispatch (`wireStatusOf`: the lineage status, else the stored one).
 * `status` is kept as stored, for compatibility.
 *
 * Every case runs over ONE real DispatchQueueStore (tests/fixtures/dispatch-list-store.js),
 * read through BOTH routes, so the page-vs-proxy parity test compares the same rows.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createDispatchRoutes } from '../../routes/dispatch.js';
import { createProxyRoutes } from '../../routes/proxy.js';
import { seededStore } from '../fixtures/dispatch-list-store.js';

const URL_KEY = 'acme';
const T1 = '2026-06-22T10:00:00.000Z';
const T2 = '2026-06-22T11:00:00.000Z';

// An archived row as the store keeps it: status `taken` (the stored value the page showed
// as green ✓ before LIN-2122), with its own feedback. No lineage fields: exactly like a
// pre-LIN-3812 row, so the read-time self-heal is what derives the outcome.
function archived(overrides = {}) {
  return {
    id: 'row',
    status: 'taken',
    promptName: 'implementation',
    kind: 'implementation',
    issueIdentifier: 'LIN-2122',
    issueUrl: null,
    target: 'cli',
    prompt: 'do the thing',
    dispatchedAt: T1,
    resolvedAt: T2,
    feedback: [],
    ...overrides
  };
}

// One row per outcome word the page must render, plus the two stored-status cases.
const ROWS = [
  archived({ id: 'done-1', feedback: [{ message: '[done] shipped', rootItemId: 'done-1', timestamp: T2 }] }),
  archived({ id: 'failed-1', feedback: [{ message: '[failed] the build broke', rootItemId: 'failed-1', timestamp: T2 }] }),
  archived({ id: 'aborted-1', feedback: [{ message: '[aborted] stopped by the operator', rootItemId: 'aborted-1', timestamp: T2 }] }),
  archived({ id: 'blocked-1', feedback: [{ message: '[blocked] waiting on credentials', rootItemId: 'blocked-1', timestamp: T2 }] }),
  archived({ id: 'skipped-1', feedback: [{ message: '[skipped] not needed any more', rootItemId: 'skipped-1', timestamp: T2 }] }),
  archived({ id: 'closed-1', bookkeeping: { at: new Date(T2), by: 'fossil-pass', reason: 'operator' } }),
  archived({ id: 'running-1' }),
  archived({ id: 'cancelled-1', status: 'cancelled' })
];

async function buildApps(store) {
  const dispatch = express();
  dispatch.use((req, res, next) => { req.session = { accountId: 'acct-1' }; next(); });
  dispatch.use(createDispatchRoutes({
    dispatchQueueStore: store,
    dispatchTokenStore: {},
    workspaceFromUrl: (req, res, next) => { req.workspace = { urlKey: URL_KEY }; next(); },
    userPreferencesStore: {},
    workspaceOwnerCheck: async () => ({ status: 'owner' }),
    proxyTokenStore: {}
  }));

  const proxy = express();
  proxy.use(express.json());
  proxy.use(createProxyRoutes({
    proxyTokenStore: {
      validateToken: async () => ({ tokenId: 't1', urlKey: URL_KEY, label: 'test', scope: 'read', createdBy: 'u1' })
    },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({ token: 'test-token', reason: 'ok' }),
    getWorkspaceAccessToken: async () => 'test-token',
    getWorkspaceOpenRouterKey: async () => null,
    agentStatusStore: {},
    recapCacheStore: { get: async () => null, set: async () => {} },
    briefCacheStore: { get: async () => null, set: async () => {} },
    dispatchQueueStore: store,
    workspaceFromUrl: (req, res, next) => next(),
    freeTierStore: { tryUse: async () => ({ allowed: true }) }
  }));
  return { dispatch, proxy };
}

// Loopback server per request, addressed the way it was bound (LIN-2023).
async function call(app, path) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      headers: { Authorization: 'Bearer anything' }
    });
    return { status: res.status, body: await res.json() };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

async function pageHistory(apps, query = '') {
  return call(apps.dispatch, `/workspace/${URL_KEY}/api/dispatch/history${query}`);
}

async function proxyList(apps, query = '') {
  return call(apps.proxy, `/api/proxy/dispatch${query}`);
}

const byId = (items) => new Map(items.map(i => [i.id, i]));

describe('GET /workspace/:urlKey/api/dispatch/history reports the outcome word (LIN-2122)', () => {
  test('done is reported as done, and the stored status stays taken', async () => {
    const apps = await buildApps(await seededStore({ history: structuredClone(ROWS), urlKey: URL_KEY }));
    const { status, body } = await pageHistory(apps);
    assert.equal(status, 200);
    const item = byId(body.items).get('done-1');
    assert.equal(item.outcome, 'done');
    assert.equal(item.status, 'taken', 'the stored status is preserved for compatibility');
  });

  test('failed is reported as failed, never as done', async () => {
    const apps = await buildApps(await seededStore({ history: structuredClone(ROWS), urlKey: URL_KEY }));
    const item = byId((await pageHistory(apps)).body.items).get('failed-1');
    assert.equal(item.outcome, 'failed');
    assert.equal(item.status, 'taken');
  });

  test('aborted is reported as aborted, never as done', async () => {
    const apps = await buildApps(await seededStore({ history: structuredClone(ROWS), urlKey: URL_KEY }));
    const item = byId((await pageHistory(apps)).body.items).get('aborted-1');
    assert.equal(item.outcome, 'aborted');
    assert.equal(item.status, 'taken');
  });

  test('blocked, skipped and closed each keep their own word', async () => {
    const apps = await buildApps(await seededStore({ history: structuredClone(ROWS), urlKey: URL_KEY }));
    const items = byId((await pageHistory(apps)).body.items);
    assert.equal(items.get('blocked-1').outcome, 'blocked');
    assert.equal(items.get('skipped-1').outcome, 'skipped');
    assert.equal(items.get('closed-1').outcome, 'closed', 'a bookkeeping stamp reads closed, not taken');
  });

  test('a running row with no terminal word stays taken (unresolved, not success)', async () => {
    const apps = await buildApps(await seededStore({ history: structuredClone(ROWS), urlKey: URL_KEY }));
    const item = byId((await pageHistory(apps)).body.items).get('running-1');
    assert.equal(item.outcome, 'taken');
  });

  test('a cancelled archive reports its stored word', async () => {
    const apps = await buildApps(await seededStore({ history: structuredClone(ROWS), urlKey: URL_KEY }));
    const item = byId((await pageHistory(apps)).body.items).get('cancelled-1');
    assert.equal(item.outcome, 'cancelled');
    assert.equal(item.status, 'cancelled');
  });

  test('a legacy row with no lineage fields at all is healed on read to its real word', async () => {
    const legacy = archived({ id: 'legacy-1', feedback: [{ message: '[failed] old run', rootItemId: 'legacy-1', timestamp: T2 }] });
    assert.equal(legacy.lineageStatusBasis, undefined, 'the fixture row carries no lineage fields');
    const apps = await buildApps(await seededStore({ history: [structuredClone(legacy)], urlKey: URL_KEY }));
    const item = byId((await pageHistory(apps)).body.items).get('legacy-1');
    assert.equal(item.outcome, 'failed');
  });

  test('a history read still answers the same rows and total with outcome added', async () => {
    const apps = await buildApps(await seededStore({ history: structuredClone(ROWS), urlKey: URL_KEY }));
    const { body } = await pageHistory(apps);
    assert.equal(body.total, ROWS.length);
    assert.equal(body.items.length, ROWS.length);
    assert.ok(body.items.every(i => typeof i.outcome === 'string'), 'every row carries an outcome');
  });
});

describe('the Dispatch page and the proxy list agree for the same dispatch (LIN-2122)', () => {
  test('for every seeded dispatch the page outcome equals the proxy list status', async () => {
    const apps = await buildApps(await seededStore({ history: structuredClone(ROWS), urlKey: URL_KEY }));
    const page = byId((await pageHistory(apps)).body.items);
    const proxy = byId((await proxyList(apps)).body.items);
    assert.equal(page.size, ROWS.length);
    for (const row of ROWS) {
      assert.ok(proxy.has(row.id), `${row.id} is in the proxy list`);
      assert.equal(page.get(row.id).outcome, proxy.get(row.id).status, `${row.id}: page outcome === proxy status`);
    }
  });

  test('parity holds on the first read too, when the proxy list is the one that heals the rows', async () => {
    const store = await seededStore({ history: structuredClone(ROWS), urlKey: URL_KEY });
    const apps = await buildApps(store);
    // The proxy list reads first here, so it derives the stale rows; the page then reads the healed ones.
    const proxy = byId((await proxyList(apps)).body.items);
    const page = byId((await pageHistory(apps)).body.items);
    for (const row of ROWS) {
      assert.equal(page.get(row.id).outcome, proxy.get(row.id).status, `${row.id}: parity regardless of which read heals first`);
    }
  });

  test('?status=done selects exactly the rows whose page outcome is done', async () => {
    const apps = await buildApps(await seededStore({ history: structuredClone(ROWS), urlKey: URL_KEY }));
    const page = byId((await pageHistory(apps)).body.items);
    const greenOnPage = [...page.values()].filter(i => i.outcome === 'done').map(i => i.id);
    const filtered = (await proxyList(apps, '?status=done')).body.items.map(i => i.id);
    assert.deepEqual(filtered.sort(), greenOnPage.sort());
    assert.deepEqual(greenOnPage, ['done-1']);
  });
});
