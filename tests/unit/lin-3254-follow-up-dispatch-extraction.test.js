/**
 * LIN-3254 beat 1 — the follow-up dispatch composition extraction.
 *
 * `approve-follow-up` used to build its enqueue inline; LIN-3254 S4 moves that
 * composition into `lib/follow-up-dispatch.js` (`dispatchSessionFollowUp`) so
 * the run page's proposal-Apply route can share it. These tests prove the
 * extraction is behavior-preserving: the helper's envelopes and the mounted
 * route's HTTP responses are asserted to be the SAME for every outcome, on the
 * same store fixtures.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createFlightCompanionRoutes } from '../../routes/flight-companion.js';
import { dispatchSessionFollowUp } from '../../lib/follow-up-dispatch.js';

const PATH = '/workspace/acme/api/flight-companion/approve-follow-up';
const URL_KEY = 'acme';
const T_DISPATCHED = new Date(Date.now() - 60 * 60 * 1000).toISOString();
const T_DONE = new Date(Date.now() - 30 * 60 * 1000).toISOString();

function historyItem({ id, target }) {
  return {
    id,
    promptName: 'implementation',
    prompt: 'prompt body',
    issueId: 'uuid-500',
    issueIdentifier: 'LIN-500',
    issueTitle: 'A task',
    issueUrl: 'https://linear.app/x/issue/LIN-500',
    workspace: { urlKey: URL_KEY },
    dispatchedAt: T_DISPATCHED,
    dispatchedBy: 'user-1',
    target,
    repo: null,
    status: 'taken',
    resolvedAt: T_DONE,
    kind: 'autopilot',
    feedback: [{ message: '[done] Task completed in 8s', timestamp: T_DONE }],
  };
}

// A second loop in `anchorId`'s lineage: sessionId + rootItemId both point at
// the anchor, and it dispatches LATER, so it is the lineage tail. `kind` is not
// 'autopilot' so it never becomes its own session anchor.
function lineageTailItem(anchorId, tailId) {
  return {
    ...historyItem({ id: tailId, target: 'cli' }),
    sessionId: anchorId,
    rootItemId: anchorId,
    kind: 'implementation',
    dispatchedAt: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
    resolvedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
  };
}

function makeStores({ history = [], anchorStatus = null, grantDeclaration = async () => ({ state: 'none' }) } = {}) {
  const addItemCalls = [];
  const dispatchQueueStore = {
    getGrantDeclaration: grantDeclaration,
    async listItems() { return []; },
    async listHistory() { return { items: history, total: history.length }; },
    async getItemStatus() { return anchorStatus; },
    async addItem(urlKey, item) {
      addItemCalls.push({ urlKey, item });
      return { _id: 'disp-new-1', dispatchedAt: new Date().toISOString(), ...item };
    },
  };
  const agentStatusStore = { async listStatus() { return { items: [], total: 0 }; } };
  const proxyTokenStore = { async createToken() { return { token: 'minted' }; } };
  return { dispatchQueueStore, agentStatusStore, proxyTokenStore, addItemCalls };
}

async function post(app, body) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, body: json };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function mountRoute(stores, { ownerCheck } = {}) {
  const app = express();
  app.use(express.json());
  app.use(createFlightCompanionRoutes({
    // LIN-3383: owner-only runner enqueue — this fixture acts as the workspace owner.
    workspaceOwnerCheck: ownerCheck === undefined ? (async () => ({ status: 'owner' })) : ownerCheck,
    workspaceFromUrl: (req, res, next) => {
      req.workspace = { urlKey: URL_KEY, id: 'ws-1' };
      req.session = { accountId: 'u1', features: { flightCompanion: true } };
      next();
    },
    getOpenRouterSource: () => null,
    getDeployInfo: () => ({}),
    observerStateStore: null,
    freeTierStore: null,
    workspacePreferencesStore: null,
    recapCacheStore: null,
    briefCacheStore: null,
    dispatchQueueStore: stores.dispatchQueueStore,
    agentStatusStore: stores.agentStatusStore,
    proxyTokenStore: stores.proxyTokenStore,
  }));
  return app;
}

function helperOptions(stores, overrides = {}) {
  return {
    dispatchQueueStore: stores.dispatchQueueStore,
    agentStatusStore: stores.agentStatusStore,
    workspacePreferencesStore: null,
    proxyTokenStore: stores.proxyTokenStore,
    urlKey: URL_KEY,
    sessionId: 'sess-done',
    prompt: 'next beat',
    baseUrl: 'http://127.0.0.1',
    dispatchedBy: 'u1',
    ownerCheck: async () => ({ status: 'owner' }), // LIN-3383
    workspaceId: 'ws-1',
    ...overrides,
  };
}

// ── The helper's own contract ────────────────────────────────────────────────

describe('dispatchSessionFollowUp — the extracted composition', () => {
  test('a terminal cli anchor enqueues through the factory and returns the success envelope', async () => {
    const stores = makeStores({ history: [historyItem({ id: 'sess-done', target: 'cli' })] });

    const outcome = await dispatchSessionFollowUp(helperOptions(stores));

    assert.deepEqual(outcome, {
      status: 200,
      body: { queued: true, itemId: 'disp-new-1', sessionId: 'sess-done', target: 'cli', force: true },
    });
    assert.strictEqual(stores.addItemCalls.length, 1);
    const { item } = stores.addItemCalls[0];
    assert.strictEqual(item.followUpTo, 'sess-done');
    assert.strictEqual(item.prompt, 'next beat');
    assert.strictEqual(item.dispatchedBy, 'u1');
    assert.ok('harness' in item, 'the factory owns the harness field');
  });

  test('enqueues to the lineage TAIL when it differs from the anchor sessionId (RC3)', async () => {
    // Anchor 'sess-done' plus a later loop sharing its lineage. The helper must
    // use deriveFollowUpDispatch(session).followUpTo (the tail), not the
    // sessionId it was handed. Mutation M8 (`followUpTo = sessionId`) is RED here.
    const stores = makeStores({
      history: [historyItem({ id: 'sess-done', target: 'cli' }), lineageTailItem('sess-done', 'tail-loop')],
    });

    const outcome = await dispatchSessionFollowUp(helperOptions(stores));

    assert.strictEqual(outcome.status, 200);
    assert.strictEqual(stores.addItemCalls.length, 1);
    const { item } = stores.addItemCalls[0];
    assert.notStrictEqual(item.followUpTo, 'sess-done', 'the anchor sessionId is not the tail');
    assert.strictEqual(item.followUpTo, 'tail-loop', 'followUpTo is the lineage tail');
  });

  test('an unknown sessionId is a 404 envelope, nothing enqueued', async () => {
    const stores = makeStores({ history: [] });

    const outcome = await dispatchSessionFollowUp(helperOptions(stores, { sessionId: 'nope' }));

    assert.strictEqual(outcome.status, 404);
    assert.match(outcome.body.error, /nope/);
    assert.strictEqual(stores.addItemCalls.length, 0);
  });

  test('a dash anchor is a 422 envelope, nothing enqueued', async () => {
    const stores = makeStores({ history: [historyItem({ id: 'sess-done', target: 'dash' })] });

    const outcome = await dispatchSessionFollowUp(helperOptions(stores));

    assert.strictEqual(outcome.status, 422);
    assert.match(outcome.body.error, /dash\/local targets are not supported/);
    assert.strictEqual(stores.addItemCalls.length, 0);
  });

  test('a transient declaration-lookup fault is a retryable 503 envelope', async () => {
    const stores = makeStores({
      history: [historyItem({ id: 'sess-done', target: 'cli' })],
      anchorStatus: { harness: 'claude-code' },
      grantDeclaration: async () => { throw new Error('store read fault'); },
    });

    const outcome = await dispatchSessionFollowUp(helperOptions(stores));

    assert.strictEqual(outcome.status, 503);
    assert.strictEqual(outcome.body.code, 'OWNER_CHECK_UNAVAILABLE');
    assert.strictEqual(outcome.body.retryable, true);
    assert.strictEqual(stores.addItemCalls.length, 0);
  });

  test('a structural grant refusal is a non-retryable 422 envelope', async () => {
    const stores = makeStores({
      history: [historyItem({ id: 'sess-done', target: 'cli' })],
      anchorStatus: { harness: 'claude-code' },
      grantDeclaration: async () => ({
        state: 'record',
        record: { grants: [], workspaceId: 'ws-acme', site: 'acme', ownerAccountId: 'owner-1' },
      }),
    });

    const outcome = await dispatchSessionFollowUp(helperOptions(stores));

    assert.strictEqual(outcome.status, 422);
    assert.strictEqual(outcome.body.code, 'INVALID_GRANTS');
    assert.strictEqual(outcome.body.retryable, false);
    assert.strictEqual(stores.addItemCalls.length, 0);
  });

  test('an unexpected enqueue error is rethrown for the caller\'s own 500 path', async () => {
    const stores = makeStores({ history: [historyItem({ id: 'sess-done', target: 'cli' })] });
    stores.dispatchQueueStore.addItem = async () => { throw new Error('boom'); };

    await assert.rejects(() => dispatchSessionFollowUp(helperOptions(stores)), /boom/);
  });
});

// ── Parity: the route is exactly this composition ────────────────────────────

describe('approve-follow-up behaves identically through the extraction', () => {
  const CASES = [
    {
      name: 'success (terminal cli anchor)',
      stores: () => makeStores({ history: [historyItem({ id: 'sess-done', target: 'cli' })] }),
      body: { sessionId: 'sess-done', prompt: 'next beat' },
    },
    {
      name: 'unknown session (404)',
      stores: () => makeStores({ history: [] }),
      body: { sessionId: 'sess-done', prompt: 'next beat' },
    },
    {
      name: 'dash anchor (422)',
      stores: () => makeStores({ history: [historyItem({ id: 'sess-done', target: 'dash' })] }),
      body: { sessionId: 'sess-done', prompt: 'next beat' },
    },
    {
      name: 'transient declaration fault (503)',
      stores: () => makeStores({
        history: [historyItem({ id: 'sess-done', target: 'cli' })],
        anchorStatus: { harness: 'claude-code' },
        grantDeclaration: async () => { throw new Error('store read fault'); },
      }),
      body: { sessionId: 'sess-done', prompt: 'next beat' },
    },
    {
      name: 'structural grant refusal (422)',
      stores: () => makeStores({
        history: [historyItem({ id: 'sess-done', target: 'cli' })],
        anchorStatus: { harness: 'claude-code' },
        grantDeclaration: async () => ({
          state: 'record',
          record: { grants: [], workspaceId: 'ws-acme', site: 'acme', ownerAccountId: 'owner-1' },
        }),
      }),
      body: { sessionId: 'sess-done', prompt: 'next beat' },
    },
  ];

  for (const c of CASES) {
    test(`${c.name}: HTTP response equals the helper envelope`, async () => {
      const routeStores = c.stores();
      const helperStores = c.stores();

      const http = await post(mountRoute(routeStores), c.body);
      const outcome = await dispatchSessionFollowUp(helperOptions(helperStores, {
        sessionId: c.body.sessionId,
        prompt: c.body.prompt,
      }));

      assert.strictEqual(http.status, outcome.status);
      assert.deepEqual(http.body, outcome.body);
      assert.strictEqual(routeStores.addItemCalls.length, helperStores.addItemCalls.length);
    });
  }
});

// ── LIN-3383: the seam is owner-only and fails closed ────────────────────────

describe('LIN-3383 — dispatchSessionFollowUp is owner-only', () => {
  const anchorHistory = () => [historyItem({ id: 'sess-done', target: 'cli' })];

  test('a non-owner is refused 422 RUNNER_ENQUEUE_OWNER_ONLY (never 403) and nothing is enqueued', async () => {
    const stores = makeStores({ history: anchorHistory() });
    const outcome = await dispatchSessionFollowUp(helperOptions(stores, { ownerCheck: async () => ({ status: 'not-owner' }) }));
    assert.strictEqual(outcome.status, 422, '403 would read as flag-off to public/flight-companion.js');
    assert.strictEqual(outcome.body.code, 'RUNNER_ENQUEUE_OWNER_ONLY');
    assert.strictEqual(outcome.body.retryable, false);
    assert.strictEqual(stores.addItemCalls.length, 0);
  });

  test('missing ownerCheck → 503 OWNER_CHECK_UNAVAILABLE (fail closed)', async () => {
    const stores = makeStores({ history: anchorHistory() });
    const outcome = await dispatchSessionFollowUp(helperOptions(stores, { ownerCheck: undefined }));
    assert.strictEqual(outcome.status, 503);
    assert.strictEqual(outcome.body.code, 'OWNER_CHECK_UNAVAILABLE');
    assert.strictEqual(stores.addItemCalls.length, 0);
  });

  test('missing dispatchedBy (no account) → 503 GRANT_OWNERLESS; missing workspaceId → 409 WORKSPACE_OWNER_UNSET', async () => {
    const real = async ({ workspaceId }) => (workspaceId ? { status: 'owner' } : { status: 'no-owner' });
    const a = makeStores({ history: anchorHistory() });
    const noAccount = await dispatchSessionFollowUp(helperOptions(a, { ownerCheck: real, dispatchedBy: undefined }));
    assert.strictEqual(noAccount.status, 503);
    assert.strictEqual(noAccount.body.code, 'GRANT_OWNERLESS');
    const b = makeStores({ history: anchorHistory() });
    const noWorkspace = await dispatchSessionFollowUp(helperOptions(b, { ownerCheck: real, workspaceId: undefined }));
    assert.strictEqual(noWorkspace.status, 409);
    assert.strictEqual(noWorkspace.body.code, 'WORKSPACE_OWNER_UNSET');
    assert.strictEqual(a.addItemCalls.length + b.addItemCalls.length, 0);
  });

  test('the seam is asked about the route workspace and the dispatching account', async () => {
    const seen = [];
    const stores = makeStores({ history: anchorHistory() });
    const outcome = await dispatchSessionFollowUp(helperOptions(stores, { ownerCheck: async (a) => { seen.push(a); return { status: 'owner' }; } }));
    assert.strictEqual(outcome.status, 200);
    assert.deepEqual(seen, [{ workspaceId: 'ws-1', accountId: 'u1' }]);
  });

  test('a dash anchor is still the derivation 422 and never consults the seam first', async () => {
    let calls = 0;
    const stores = makeStores({ history: [historyItem({ id: 'sess-done', target: 'dash' })] });
    const outcome = await dispatchSessionFollowUp(helperOptions(stores, { ownerCheck: async () => { calls++; return { status: 'not-owner' }; } }));
    assert.strictEqual(outcome.status, 422);
    assert.strictEqual(calls, 0);
  });

  test('FC approve-follow-up: a non-owner gets 422 (not the flag-off 403), nothing enqueued; the owner still enqueues', async () => {
    const refused = makeStores({ history: anchorHistory() });
    const r = await post(mountRoute(refused, { ownerCheck: async () => ({ status: 'not-owner' }) }), { sessionId: 'sess-done', prompt: 'next beat' });
    assert.strictEqual(r.status, 422);
    assert.strictEqual(r.body.code, 'RUNNER_ENQUEUE_OWNER_ONLY');
    assert.strictEqual(refused.addItemCalls.length, 0);

    const allowed = makeStores({ history: anchorHistory() });
    const o = await post(mountRoute(allowed), { sessionId: 'sess-done', prompt: 'next beat' });
    assert.strictEqual(o.status, 200);
    assert.strictEqual(allowed.addItemCalls.length, 1);
  });
});
