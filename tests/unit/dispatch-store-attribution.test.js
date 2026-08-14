/**
 * LIN-1948 fix 3 — `dispatchedBy` survives to the reads a human actually uses.
 *
 * The field was persisted by `_archiveItem` and returned by `_formatItem`, but
 * `_formatHistoryItem` dropped it. Since a TAKEN dispatch reads through the
 * history formatter, the consumer API reported no dispatcher for exactly the
 * rows anyone would ask about — which is why attributing the twelve phantom
 * dispatches in LIN-1946 cost a whole research pass, and why the session that
 * reproduced this on 2026-08-10 could not tell which lane had dispatched it.
 *
 * A queued-only test would PASS on the unfixed code and prove nothing (the bug
 * is specifically in the history formatter), so both branches are asserted here.
 *
 * The same store fix also repairs `lib/pipeline-loops.js`, which read
 * `dispatchedBy: null` for every archived loop in the Observation feed.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';

const ACTOR = 'acct-dispatcher-1';

function storeUnderTest() {
  // The formatters are pure projections over a doc, so they can be exercised
  // directly — the drop is reproducible in two lines and needs no live store.
  return Object.create(DispatchQueueStore.prototype);
}

function docFixture(overrides = {}) {
  return {
    _id: 'disp-1',
    prompt: 'do the thing',
    promptName: 'Prompt',
    kind: 'custom',
    issueIdentifier: 'TEST-1',
    dispatchedAt: '2026-08-10T17:08:46.062Z',
    dispatchedBy: ACTOR,
    target: 'cli',
    ...overrides,
  };
}

describe('LIN-1948 fix 3a — _formatHistoryItem carries dispatchedBy', () => {
  test('a TAKEN/archived item reports its dispatcher (the branch that was broken)', () => {
    const store = storeUnderTest();
    const out = store._formatHistoryItem(docFixture());
    assert.equal(out.dispatchedBy, ACTOR);
  });

  test('an ownerless dispatch legitimately reports null, not undefined', () => {
    // A pre-LIN-1397 ownerless token stamps no actor. Absent attribution is a
    // real answer; the field must still be PRESENT so a consumer can tell
    // "nobody recorded" from "this API does not report it".
    const store = storeUnderTest();
    const out = store._formatHistoryItem(docFixture({ dispatchedBy: undefined }));
    assert.ok('dispatchedBy' in out, 'the key must be present even when unknown');
    assert.equal(out.dispatchedBy, null);
  });

  test('the queued formatter still carries it too — the two halves now agree', () => {
    const store = storeUnderTest();
    const queued = store._formatItem(docFixture());
    const taken = store._formatHistoryItem(docFixture());
    assert.equal(queued.dispatchedBy, ACTOR);
    assert.equal(taken.dispatchedBy, ACTOR);
  });
});

// ── Route level ─────────────────────────────────────────────────────────────
// Fix 3b plus the boundary that must NOT move: the detail/watch read gains the
// field; the list/poll endpoint re-projects through its own explicit field
// allow-list and deliberately still omits it.
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';

function buildApp({ statusItem, queued = [], history = [] } = {}) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      validateToken: async () => ({
        tokenId: 't1', urlKey: 'acme', label: 'test', scope: 'readWrite', createdBy: 'u1'
      })
    },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({ token: 'test-token', reason: 'ok' }),
    getWorkspaceAccessToken: async () => 'test-token',
    getWorkspaceOpenRouterKey: async () => null,
    agentStatusStore: {},
    recapCacheStore: { get: async () => null, set: async () => {} },
    briefCacheStore: { get: async () => null, set: async () => {} },
    dispatchQueueStore: {
      getItemStatus: async () => statusItem,
      listItems: async () => queued,
      // listHistory returns { items } — not a bare array (dispatch-store.js).
      listHistory: async () => ({ items: history }),
      listHistoryByRootItemIds: async () => [],
    },
    workspaceFromUrl: (req, res, next) => next(),
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
    freeTierStore: { tryUse: async () => ({ allowed: true }) }
  }));
  return app;
}

async function get(app, path) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { headers: { Authorization: 'Bearer anything' } });
    return { status: res.status, body: await res.json() };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

describe('LIN-1948 fix 3b — the detail read reports the dispatcher', () => {
  test('GET /api/proxy/dispatch/:id carries dispatchedBy', async () => {
    const app = buildApp({
      statusItem: { id: 'disp-1', status: 'taken', dispatchedBy: ACTOR, feedback: [], dispatchedAt: '2026-08-10T00:00:00.000Z' }
    });
    const res = await get(app, '/api/proxy/dispatch/disp-1');
    assert.equal(res.status, 200);
    assert.equal(res.body.dispatchedBy, ACTOR);
  });

  test('an unattributed item reports null rather than omitting the field', async () => {
    const app = buildApp({
      statusItem: { id: 'disp-1', status: 'taken', feedback: [], dispatchedAt: '2026-08-10T00:00:00.000Z' }
    });
    const res = await get(app, '/api/proxy/dispatch/disp-1');
    assert.equal(res.status, 200);
    assert.ok('dispatchedBy' in res.body);
    assert.equal(res.body.dispatchedBy, null);
  });

  test('BOUNDARY: the list/poll endpoint still omits dispatchedBy', async () => {
    // GET /api/proxy/dispatch re-projects through an explicit field allow-list.
    // That boundary is real and this fix deliberately does not move it — pinned
    // so a later "make it consistent" edit has to be a deliberate decision.
    const app = buildApp({
      queued: [{ id: 'q-1', status: 'queued', dispatchedBy: ACTOR, dispatchedAt: '2026-08-10T00:00:00.000Z' }],
      history: []
    });
    const res = await get(app, '/api/proxy/dispatch');
    assert.equal(res.status, 200);
    const rows = res.body.items || res.body.dispatches || [];
    assert.ok(rows.length >= 1, `expected at least one row, got ${JSON.stringify(res.body)}`);
    assert.equal('dispatchedBy' in rows[0], false, 'the list allow-list must keep excluding dispatchedBy');
  });
});
