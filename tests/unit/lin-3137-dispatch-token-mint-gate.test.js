/**
 * LIN-3137 (LIN-2884 T4 / J5) — owner-only mint gate on the legacy dispatch
 * token, `POST /workspace/:urlKey/api/dispatch/tokens`.
 *
 * Red-first: these refusal tests are written against the UNCHANGED route, with
 * the new `workspaceOwnerCheck` dependency supplied by the harness but ignored
 * by the route today. They must fail on the current 201 and pass once the gate
 * lands. The owner-success case passes pre-fix by design (it is the mutation
 * check's target, not a red).
 *
 * Harness per the approved plan (grounded `ac3ac010`): real
 * `createDispatchRoutes` over a real `DispatchTokenStore` with a mock
 * collection; the mock `workspaceFromUrl` sets `req.workspace={id,urlKey}` and
 * `req.session={accountId}`. `NODE_ENV=test` is set before the import so the
 * module-scope `tokenCreationLimiter` skips (it is a real 5/15min limiter
 * otherwise).
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createDispatchRoutes } from '../../routes/dispatch.js';
import { DispatchTokenStore } from '../../lib/dispatch-tokens.js';

const TOKENS_PATH = '/workspace/acme/api/dispatch/tokens';
const WORKSPACE = { urlKey: 'acme', id: 'ws-1', provider: 'linear' };
const OWNER = 'account-owner';
const SESSION_ACCOUNT = 'account-A';

function createMockCollection() {
  let docs = [];
  const matches = (d, query) => Object.keys(query).every(k => {
    if (k === '$or') return query.$or.some(sub => matches(d, sub));
    const val = query[k];
    if (val && typeof val === 'object') {
      if ('$lt' in val && '$ne' in val) {
        return d[k] !== val.$ne && d[k] !== null && new Date(d[k]) < new Date(val.$lt);
      }
      if ('$lt' in val) return d[k] !== null && new Date(d[k]) < new Date(val.$lt);
      return true;
    }
    return d[k] === val;
  });
  return {
    async insertOne(doc) { docs.push({ ...doc }); return { insertedId: doc._id }; },
    async findOne(query) { return docs.find(d => matches(d, query)) || null; },
    async updateOne(query, update) {
      const idx = docs.findIndex(d => matches(d, query));
      if (idx === -1) return { matchedCount: 0, modifiedCount: 0 };
      if (update.$set) Object.assign(docs[idx], update.$set);
      return { matchedCount: 1, modifiedCount: 1 };
    },
    async deleteOne(query) {
      const idx = docs.findIndex(d => matches(d, query));
      if (idx === -1) return { deletedCount: 0 };
      docs.splice(idx, 1);
      return { deletedCount: 1 };
    },
    async deleteMany(query) {
      const before = docs.length;
      docs = docs.filter(d => !matches(d, query));
      return { deletedCount: before - docs.length };
    },
    find(query = {}) { return { toArray: async () => docs.filter(d => matches(d, query)) }; },
    _docs: () => docs
  };
}

/**
 * Build the route with a real store and a tracking owner seam. `ownerCheck`
 * omitted/null means the unwired seam (`workspaceOwnerCheck: null`), exactly the
 * fail-closed default. `seam()` reads the captured call count/args.
 */
function harness({ ownerCheck = null } = {}) {
  const collection = createMockCollection();
  const dispatchTokenStore = new DispatchTokenStore({ collection });
  const seam = { calls: 0, args: null };
  let workspaceOwnerCheck = null;
  if (ownerCheck) {
    workspaceOwnerCheck = async (args) => {
      seam.calls += 1;
      seam.args = args;
      return ownerCheck(args);
    };
  }
  return { collection, dispatchTokenStore, workspaceOwnerCheck, seam };
}

function buildApp({ dispatchTokenStore, workspaceOwnerCheck, session }) {
  const app = express();
  app.use(express.json());
  app.use(createDispatchRoutes({
    dispatchQueueStore: {},
    dispatchTokenStore,
    workspaceFromUrl: (req, res, next) => {
      req.workspace = WORKSPACE;
      req.session = session;
      next();
    },
    userPreferencesStore: {},
    workspaceOwnerCheck
  }));
  return app;
}

async function call(app, body) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${TOKENS_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
    const text = await res.text();
    let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed };
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

const session = (overrides = {}) => ({ accountId: SESSION_ACCOUNT, ...overrides });

// ---------------------------------------------------------------------------
// Owner success — the outcome passes pre-fix by design (mutation-checked via
// the server.js wiring census + e2e in a later beat).
// ---------------------------------------------------------------------------

describe('LIN-3137 — owner session mints as today', () => {
  test('owner -> 201 with the exact unchanged body and createdBy = session account', async () => {
    const { collection, dispatchTokenStore, workspaceOwnerCheck } = harness({
      ownerCheck: async () => ({ status: 'owner' })
    });
    const app = buildApp({ dispatchTokenStore, workspaceOwnerCheck, session: session() });

    const res = await call(app, {});

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.deepEqual(Object.keys(res.body).sort(), ['label', 'message', 'token', 'tokenId'].sort());
    assert.equal(res.body.label, 'default');
    assert.ok(res.body.token && res.body.tokenId);
    assert.equal(collection._docs().length, 1, 'the owner mints exactly one token');
    assert.equal(collection._docs()[0].createdBy, SESSION_ACCOUNT);
  });
});

// ---------------------------------------------------------------------------
// Authority source — the gate must consult the seam with the route workspace +
// session account, never the request body. Red pre-fix: the unchanged route
// ignores the seam entirely.
// ---------------------------------------------------------------------------

describe('LIN-3137 — the owner seam is asked about the route workspace + session account', () => {
  test('seam called once with exactly { workspaceId, accountId }, body-supplied authority ignored', async () => {
    const { dispatchTokenStore, workspaceOwnerCheck, seam } = harness({
      ownerCheck: async () => ({ status: 'owner' })
    });
    const app = buildApp({ dispatchTokenStore, workspaceOwnerCheck, session: session() });

    const res = await call(app, {
      accountId: 'attacker',
      workspaceId: 'other-ws',
      urlKey: 'other-key',
      ownerAccountId: OWNER
    });

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(seam.calls, 1, 'the owner seam is consulted exactly once');
    assert.deepEqual(seam.args, { workspaceId: 'ws-1', accountId: SESSION_ACCOUNT },
      'body-supplied authority is ignored; the seam keys on route workspace + session account');
  });
});

// ---------------------------------------------------------------------------
// Refusals (fail closed) — these MUST fail pre-fix (the route returns 201)
// ---------------------------------------------------------------------------

describe('LIN-3137 — mint refusals fail closed with zero documents', () => {
  test('non-owner -> 403 GRANT_OWNER_ONLY, retryable false, nothing written, no account id', async () => {
    const { collection, dispatchTokenStore, workspaceOwnerCheck } = harness({
      ownerCheck: async () => ({ status: 'not-owner' })
    });
    const app = buildApp({ dispatchTokenStore, workspaceOwnerCheck, session: session() });

    const res = await call(app, {});

    assert.equal(res.status, 403, JSON.stringify(res.body));
    assert.equal(res.body.code, 'GRANT_OWNER_ONLY');
    assert.equal(res.body.category, 'auth');
    assert.equal(res.body.retryable, false);
    assert.equal(collection._docs().length, 0, 'nothing is written on the refusal');
    assert.ok(!JSON.stringify(res.body).includes('account-'), 'the refusal never names an account id');
  });

  test('no owner edge -> 409 WORKSPACE_OWNER_UNSET, retryable false, nothing written', async () => {
    const { collection, dispatchTokenStore, workspaceOwnerCheck } = harness({
      ownerCheck: async () => ({ status: 'no-owner' })
    });
    const app = buildApp({ dispatchTokenStore, workspaceOwnerCheck, session: session() });

    const res = await call(app, {});

    assert.equal(res.status, 409, JSON.stringify(res.body));
    assert.equal(res.body.code, 'WORKSPACE_OWNER_UNSET');
    assert.equal(res.body.category, 'config');
    assert.equal(res.body.retryable, false);
    assert.equal(collection._docs().length, 0, 'nothing is written on the refusal');
  });

  test('missing accountId -> 503 GRANT_OWNERLESS, seam NOT called, nothing written', async () => {
    const { collection, dispatchTokenStore, workspaceOwnerCheck, seam } = harness({
      ownerCheck: async () => ({ status: 'owner' })
    });
    const app = buildApp({ dispatchTokenStore, workspaceOwnerCheck, session: session({ accountId: null }) });

    const res = await call(app, {});

    assert.equal(res.status, 503, JSON.stringify(res.body));
    assert.equal(res.body.code, 'GRANT_OWNERLESS');
    assert.equal(res.body.category, 'auth');
    assert.equal(res.body.retryable, false);
    assert.equal(seam.calls, 0, 'the seam is not called when the session has no accountId');
    assert.equal(collection._docs().length, 0, 'nothing is written on the refusal');
  });

  test('throwing seam -> 503 OWNER_CHECK_UNAVAILABLE, retryable true, nothing written', async () => {
    const { collection, dispatchTokenStore, workspaceOwnerCheck } = harness({
      ownerCheck: async () => { throw new Error('owner store down'); }
    });
    const app = buildApp({ dispatchTokenStore, workspaceOwnerCheck, session: session() });

    const res = await call(app, {});

    assert.equal(res.status, 503, JSON.stringify(res.body));
    assert.equal(res.body.code, 'OWNER_CHECK_UNAVAILABLE');
    assert.equal(res.body.category, 'upstream');
    assert.equal(res.body.retryable, true);
    assert.equal(collection._docs().length, 0, 'nothing is written on the refusal');
  });

  test('unwired (null) seam -> 503 OWNER_CHECK_UNAVAILABLE, retryable true, nothing written', async () => {
    const { collection, dispatchTokenStore, workspaceOwnerCheck } = harness({ ownerCheck: null });
    const app = buildApp({ dispatchTokenStore, workspaceOwnerCheck, session: session() });

    const res = await call(app, {});

    assert.equal(res.status, 503, JSON.stringify(res.body));
    assert.equal(res.body.code, 'OWNER_CHECK_UNAVAILABLE');
    assert.equal(res.body.category, 'upstream');
    assert.equal(res.body.retryable, true);
    assert.equal(collection._docs().length, 0, 'nothing is written on the refusal');
  });

  test('malformed seam status -> 503 OWNER_CHECK_UNAVAILABLE, retryable true, nothing written', async () => {
    const { collection, dispatchTokenStore, workspaceOwnerCheck } = harness({
      ownerCheck: async () => ({ status: 'bogus' })
    });
    const app = buildApp({ dispatchTokenStore, workspaceOwnerCheck, session: session() });

    const res = await call(app, {});

    assert.equal(res.status, 503, JSON.stringify(res.body));
    assert.equal(res.body.code, 'OWNER_CHECK_UNAVAILABLE');
    assert.equal(res.body.category, 'upstream');
    assert.equal(res.body.retryable, true);
    assert.equal(collection._docs().length, 0, 'nothing is written on the refusal');
  });
});
