/**
 * LIN-3398 / LIN-3408 (Part A, session lane): halt POST/DELETE, queue-item
 * delete, trim and dispatch-token revoke are owner-only, through the real
 * `createDispatchRoutes` handlers and the one runner-owner gate.
 *
 * Per action: a non-owner is refused 403 RUNNER_OWNER_ONLY with the plain copy
 * and the store is never written; the owner succeeds. Delete and trim also
 * prove the 403 never echoes the row (it carries `bootstrapToken`) and that a
 * `dash`/`local` row stays member-reachable. Fail-closed is tested ONCE for the
 * lane (seam absent on a halt POST); the other branches are the shared
 * resolver's (lin-3383-runner-owner-gate.test.js).
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createDispatchRoutes } from '../../routes/dispatch.js';

const COPY = "Only this workspace's owner can act on its runner.";
const ITEM = '11111111-2222-4333-8444-555555555555';
const TOKEN_ID = '99999999-2222-4333-8444-555555555555';
const SECRET = 'hbr_SECRET_BOOTSTRAP';
const ownerCheck = async ({ accountId }) => ({ status: accountId === 'acct-owner' ? 'owner' : 'not-owner' });

function makeStores({ rowTarget = 'cli' } = {}) {
  const writes = [];
  const rows = { [ITEM]: { id: ITEM, target: rowTarget, prompt: 'p', bootstrapToken: SECRET } };
  return {
    writes,
    queue: {
      async getItemStatus(urlKey, id) { return rows[id] ? { ...rows[id] } : null; },
      async removeItem(urlKey, id) { writes.push(['removeItem', id]); return true; },
      async trimSessionBudget(urlKey, id, bounds) {
        writes.push(['trimSessionBudget', id]);
        return { ok: true, item: { id, target: rows[id]?.target, bootstrapToken: SECRET, maxTasks: bounds.maxTasks } };
      }
    },
    halt: {
      async setWorkspaceHalt(urlKey, h) { writes.push(['setWorkspaceHalt', h.mode]); },
      async clearWorkspaceHalt() { writes.push(['clearWorkspaceHalt']); }
    },
    tokens: { async revokeToken(urlKey, id) { writes.push(['revokeToken', id]); return true; } }
  };
}

function buildApp(stores, { accountId, check = ownerCheck } = {}) {
  const app = express();
  app.use(express.json());
  app.use(createDispatchRoutes({
    dispatchQueueStore: stores.queue,
    dispatchTokenStore: stores.tokens,
    workspaceHaltStore: stores.halt,
    workspaceOwnerCheck: check,
    workspaceFromUrl: (req, res, next) => {
      req.workspace = { urlKey: 'alpha', id: 'ws-alpha' };
      req.session = { accountId };
      next();
    },
    userPreferencesStore: {},
    harbourFeedbackTokenStore: null
  }));
  return app;
}

async function call(app, method, path, body) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await res.text();
    let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed, text };
  } finally {
    await new Promise(r => server.close(r));
  }
}

const BASE = '/workspace/alpha/api/dispatch';
function assertRefused(res, writes) {
  assert.equal(res.status, 403, res.text);
  assert.equal(res.body.code, 'RUNNER_OWNER_ONLY');
  assert.equal(res.body.error, COPY);
  assert.equal(res.body.category, 'auth');
  assert.equal(res.body.retryable, false);
  assert.deepEqual(writes, [], 'no store write');
  assert.ok(!res.text.includes(SECRET), 'the 403 never echoes the row');
}

describe('LIN-3398 session lane — halt POST', () => {
  test('non-owner: 403 + copy, no halt written', async () => {
    const s = makeStores();
    assertRefused(await call(buildApp(s, { accountId: 'acct-member' }), 'POST', `${BASE}/halt`, { mode: 'stop' }), s.writes);
  });
  test('owner: halts', async () => {
    const s = makeStores();
    const res = await call(buildApp(s, { accountId: 'acct-owner' }), 'POST', `${BASE}/halt`, { mode: 'stop' });
    assert.equal(res.status, 200, res.text);
    assert.deepEqual(s.writes, [['setWorkspaceHalt', 'stop']]);
  });
  test('an invalid mode is still a 400 for anyone (validation precedes the gate)', async () => {
    const s = makeStores();
    const res = await call(buildApp(s, { accountId: 'acct-member' }), 'POST', `${BASE}/halt`, { mode: 'bogus' });
    assert.equal(res.status, 400);
  });
  // Fail-closed, once for the lane: the other branches (throwing seam, no
  // account, ownerless workspace) are the shared resolver's.
  test('FAIL-CLOSED (lane): owner seam absent → 503 OWNER_CHECK_UNAVAILABLE, no halt written', async () => {
    const s = makeStores();
    const res = await call(buildApp(s, { accountId: 'acct-owner', check: null }), 'POST', `${BASE}/halt`, { mode: 'stop' });
    assert.equal(res.status, 503, res.text);
    assert.equal(res.body.code, 'OWNER_CHECK_UNAVAILABLE');
    assert.deepEqual(s.writes, []);
  });
});

describe('LIN-3398 session lane — halt DELETE (resume)', () => {
  test('non-owner: 403 + copy, halt not cleared', async () => {
    const s = makeStores();
    assertRefused(await call(buildApp(s, { accountId: 'acct-member' }), 'DELETE', `${BASE}/halt`), s.writes);
  });
  test('owner: clears', async () => {
    const s = makeStores();
    const res = await call(buildApp(s, { accountId: 'acct-owner' }), 'DELETE', `${BASE}/halt`);
    assert.equal(res.status, 200, res.text);
    assert.deepEqual(s.writes, [['clearWorkspaceHalt']]);
  });
});

describe('LIN-3398 session lane — delete queued item', () => {
  test('non-owner on a cli row: 403 + copy, nothing removed, row not echoed', async () => {
    const s = makeStores();
    assertRefused(await call(buildApp(s, { accountId: 'acct-member' }), 'DELETE', `${BASE}/${ITEM}`), s.writes);
  });
  test('owner: removes', async () => {
    const s = makeStores();
    const res = await call(buildApp(s, { accountId: 'acct-owner' }), 'DELETE', `${BASE}/${ITEM}`);
    assert.equal(res.status, 200, res.text);
    assert.deepEqual(s.writes, [['removeItem', ITEM]]);
  });
  for (const target of ['dash', 'local']) {
    test(`a ${target} row stays member-reachable`, async () => {
      const s = makeStores({ rowTarget: target });
      const res = await call(buildApp(s, { accountId: 'acct-member' }), 'DELETE', `${BASE}/${ITEM}`);
      assert.equal(res.status, 200, res.text);
      assert.deepEqual(s.writes, [['removeItem', ITEM]]);
    });
  }
  test('an absent row is gated as cli: non-owner 403 (no existence leak), owner 404', async () => {
    const other = '22222222-2222-4333-8444-555555555555';
    const s = makeStores();
    const refused = await call(buildApp(s, { accountId: 'acct-member' }), 'DELETE', `${BASE}/${other}`);
    assert.equal(refused.status, 403);
    s.queue.removeItem = async () => false;
    const owner = await call(buildApp(s, { accountId: 'acct-owner' }), 'DELETE', `${BASE}/${other}`);
    assert.equal(owner.status, 404);
  });
});

describe('LIN-3398 session lane — trim', () => {
  const PATH = `${BASE}/${ITEM}/trim`;
  test('non-owner on a cli row: 403 + copy, nothing trimmed, row not echoed', async () => {
    const s = makeStores();
    assertRefused(await call(buildApp(s, { accountId: 'acct-member' }), 'PATCH', PATH, { maxTasks: 1 }), s.writes);
  });
  test('owner: trims', async () => {
    const s = makeStores();
    const res = await call(buildApp(s, { accountId: 'acct-owner' }), 'PATCH', PATH, { maxTasks: 1 });
    assert.equal(res.status, 200, res.text);
    assert.deepEqual(s.writes, [['trimSessionBudget', ITEM]]);
  });
  for (const target of ['dash', 'local']) {
    test(`a ${target} row stays member-reachable`, async () => {
      const s = makeStores({ rowTarget: target });
      const res = await call(buildApp(s, { accountId: 'acct-member' }), 'PATCH', PATH, { maxTasks: 1 });
      assert.equal(res.status, 200, res.text);
      assert.deepEqual(s.writes, [['trimSessionBudget', ITEM]]);
    });
  }
});

describe('LIN-3398 session lane — dispatch-token revoke', () => {
  test('non-owner: 403 + copy, token not revoked', async () => {
    const s = makeStores();
    assertRefused(await call(buildApp(s, { accountId: 'acct-member' }), 'DELETE', `${BASE}/tokens/${TOKEN_ID}`), s.writes);
  });
  test('owner: revokes', async () => {
    const s = makeStores();
    const res = await call(buildApp(s, { accountId: 'acct-owner' }), 'DELETE', `${BASE}/tokens/${TOKEN_ID}`);
    assert.equal(res.status, 200, res.text);
    assert.deepEqual(s.writes, [['revokeToken', TOKEN_ID]]);
  });
});
