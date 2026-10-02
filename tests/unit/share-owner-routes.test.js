/**
 * Unit tests for the owner management surface in routes/share.js (LIN-3244,
 * Session B of LIN-3073).
 *
 * Run with: node --test tests/unit/share-owner-routes.test.js
 *
 * Drives a real Express app on 127.0.0.1 with a fake store + injected seams
 * (no provider, no Mongo), matching tests/unit/share-route.test.js. Covers:
 * create rate limit, the four owner-mint refusals (nothing minted), no persist
 * on a failed first snapshot, the parent `ui.subtasks:false` refusal, L9's
 * subject.id === issue.parent.id matching, cross-workspace revoke refusal, the
 * list's token/hash omission, and revoke immediacy on the public page.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createShareRoutes, createShareLimiters } from '../../routes/share.js';

const OWNER_OK = async () => ({ status: 'owner' });
const NOOP_TIMEOUT = (promise) => promise;
const NOOP_LIMITER = (req, res, next) => next();

const PARENT_ID = '48ab75af-9a3b-454b-a0aa-07f99e49b072';

function makeStore() {
  const byToken = new Map();
  const byId = new Map();
  const calls = { create: 0, saveSnapshot: 0, listByUrlKey: 0, revokeById: 0, getByToken: 0 };
  let seq = 0;

  return {
    byToken,
    byId,
    calls,
    async create({ urlKey, workspaceId, ownerAccountId, subject, includeDescriptions = false }) {
      calls.create++;
      seq += 1;
      const token = 'A'.repeat(42) + String.fromCharCode(64 + seq);
      const tokenHash = `id-${String(seq).padStart(4, '0')}`;
      const record = {
        _id: tokenHash,
        tokenHash,
        urlKey,
        workspaceId,
        ownerAccountId,
        subject: { type: 'collection', kind: subject.kind, id: subject.id },
        includeDescriptions: includeDescriptions === true,
        createdAt: new Date(),
        revokedAt: null,
        snapshot: null,
        snapshotAt: null,
        lastRefreshAttemptAt: null
      };
      byToken.set(token, record);
      byId.set(tokenHash, record);
      return { token, record: { ...record } };
    },
    async saveSnapshot(tokenHash, snapshot, { at = new Date() } = {}) {
      calls.saveSnapshot++;
      const record = byId.get(tokenHash);
      if (!record) return false;
      record.lastRefreshAttemptAt = at;
      if (snapshot != null) {
        record.snapshot = snapshot;
        record.snapshotAt = at;
      }
      return true;
    },
    async listByUrlKey(urlKey) {
      calls.listByUrlKey++;
      return [...byId.values()].filter(r => r.urlKey === urlKey).map(r => ({ ...r }));
    },
    async getById(id) {
      const record = byId.get(id);
      return record ? { ...record } : null;
    },
    async revokeById(id, urlKey) {
      calls.revokeById++;
      const record = byId.get(id);
      if (!record) return null;
      if (urlKey && record.urlKey !== urlKey) return null;
      if (!record.revokedAt) record.revokedAt = new Date();
      return { ...record };
    },
    async getByToken(token) {
      calls.getByToken++;
      const record = byToken.get(token);
      return record ? { ...record } : null;
    }
  };
}

function buildApp({
  store,
  readOwnerIssues,
  workspaceOwnerCheck = OWNER_OK,
  getProviderForWorkspace = () => ({ ui: { subtasks: true } }),
  withTimeout = NOOP_TIMEOUT,
  readLimiter = NOOP_LIMITER,
  createLimiter = NOOP_LIMITER,
  accountId = 'acct-1'
} = {}) {
  const app = express();
  app.use(express.json());
  // Mirrors the real workspaceFromUrl: resolves req.workspace from the path and
  // sets the session account, so cross-workspace tests can vary the urlKey.
  const workspaceFromUrl = (req, res, next) => {
    req.workspace = { id: `uuid-${req.params.urlKey}`, urlKey: req.params.urlKey };
    req.session = accountId === null ? {} : { accountId };
    next();
  };
  app.use(createShareRoutes({
    shareStore: store,
    readOwnerIssues,
    workspaceOwnerCheck,
    workspaceFromUrl,
    getProviderForWorkspace,
    withTimeout,
    readLimiter,
    createLimiter
  }));
  return app;
}

async function request(app, path, { method = 'GET', body } = {}) {
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise(resolve => server.once('listening', resolve));
    const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(5000)
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* html/empty */ }
    return { status: res.status, headers: res.headers, body: text, json };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

const LABEL_BODY = { subject: { kind: 'label', id: 'bug' } };

describe('owner create — rate limit', () => {
  test('third create over max=2 → 429 and nothing minted', async () => {
    const store = makeStore();
    const app = buildApp({
      store,
      readOwnerIssues: async () => ({ reason: 'ok', issues: [] }),
      createLimiter: createShareLimiters({ max: 2, skip: () => false }).create
    });

    assert.equal((await request(app, '/workspace/ws-1/shares', { method: 'POST', body: LABEL_BODY })).status, 201);
    assert.equal((await request(app, '/workspace/ws-1/shares', { method: 'POST', body: LABEL_BODY })).status, 201);
    const third = await request(app, '/workspace/ws-1/shares', { method: 'POST', body: LABEL_BODY });
    assert.equal(third.status, 429);
    assert.equal(store.calls.create, 2, 'the throttled request never minted');
  });
});

describe('owner create — refusal gate', () => {
  const CASES = [
    ['GRANT_OWNER_ONLY', 403, async () => ({ status: 'not-owner' }), 'acct-1'],
    ['WORKSPACE_OWNER_UNSET', 409, async () => ({ status: 'no-owner' }), 'acct-1'],
    ['GRANT_OWNERLESS', 503, OWNER_OK, null],
    ['OWNER_CHECK_UNAVAILABLE', 503, async () => { throw new Error('owner check down'); }, 'acct-1']
  ];

  for (const [code, status, workspaceOwnerCheck, accountId] of CASES) {
    test(`${code} → ${status}, nothing minted`, async () => {
      const store = makeStore();
      const app = buildApp({
        store,
        readOwnerIssues: async () => ({ reason: 'ok', issues: [] }),
        workspaceOwnerCheck,
        accountId
      });
      const res = await request(app, '/workspace/ws-1/shares', { method: 'POST', body: LABEL_BODY });
      assert.equal(res.status, status);
      assert.equal(res.json.code, code);
      assert.equal(store.calls.create, 0, 'a refused caller mints nothing');
      assert.equal(store.calls.saveSnapshot, 0);
    });
  }

  test('list and revoke use the same gate (non-owner → 403, nothing read/revoked)', async () => {
    const store = makeStore();
    const app = buildApp({
      store,
      readOwnerIssues: async () => ({ reason: 'ok', issues: [] }),
      workspaceOwnerCheck: async () => ({ status: 'not-owner' })
    });
    const list = await request(app, '/workspace/ws-1/shares');
    assert.equal(list.status, 403);
    assert.equal(list.json.code, 'GRANT_OWNER_ONLY');
    assert.equal(store.calls.listByUrlKey, 0);

    const revoke = await request(app, '/workspace/ws-1/shares/id-0001/revoke', { method: 'POST' });
    assert.equal(revoke.status, 403);
    assert.equal(revoke.json.code, 'GRANT_OWNER_ONLY');
    assert.equal(store.calls.revokeById, 0);
  });
});

describe('owner create — first snapshot', () => {
  test('a failed first read persists nothing (reason arm)', async () => {
    const store = makeStore();
    const app = buildApp({
      store,
      readOwnerIssues: async () => ({ reason: 'session_expired', issues: null })
    });
    const res = await request(app, '/workspace/ws-1/shares', { method: 'POST', body: LABEL_BODY });
    assert.equal(res.status, 503);
    assert.equal(res.json.code, 'SHARE_SNAPSHOT_UNAVAILABLE');
    assert.equal(store.calls.create, 0, 'no share record is created');
  });

  test('a thrown first read persists nothing', async () => {
    const store = makeStore();
    const app = buildApp({
      store,
      readOwnerIssues: async () => { throw new Error('provider exploded'); }
    });
    const res = await request(app, '/workspace/ws-1/shares', { method: 'POST', body: LABEL_BODY });
    assert.equal(res.status, 503);
    assert.equal(store.calls.create, 0);
  });

  test('a successful create returns only { token, url } and snapshots synchronously', async () => {
    const issues = [{ id: 'i-1', identifier: 'TEST-1', title: 't', labels: { nodes: [{ name: 'bug' }] }, state: { type: 'unstarted' }, priority: 1, updatedAt: 'x' }];
    const store = makeStore();
    const app = buildApp({ store, readOwnerIssues: async () => ({ reason: 'ok', issues }) });

    const res = await request(app, '/workspace/ws-1/shares', { method: 'POST', body: LABEL_BODY });
    assert.equal(res.status, 201);
    assert.deepEqual(Object.keys(res.json).sort(), ['token', 'url']);
    assert.match(res.json.url, /^\/s\/[A-Za-z0-9_-]{43}$/);
    assert.equal(store.calls.saveSnapshot, 1, 'the first snapshot is persisted at create time');
    assert.equal([...store.byId.values()][0].snapshot.items.length, 1);
  });

  test('an invalid subject → 400 and nothing minted', async () => {
    const store = makeStore();
    const app = buildApp({ store, readOwnerIssues: async () => ({ reason: 'ok', issues: [] }) });
    const res = await request(app, '/workspace/ws-1/shares', { method: 'POST', body: { subject: { kind: 'nope', id: 'x' } } });
    assert.equal(res.status, 400);
    assert.equal(store.calls.create, 0);
  });
});

describe('owner create — parent provider capability (verdict b)', () => {
  test('parent refused when ui.subtasks is false; label still works', async () => {
    const store = makeStore();
    const app = buildApp({
      store,
      readOwnerIssues: async () => ({ reason: 'ok', issues: [] }),
      getProviderForWorkspace: () => ({ ui: { subtasks: false } })
    });

    const parent = await request(app, '/workspace/ws-1/shares', {
      method: 'POST',
      body: { subject: { kind: 'parent', id: PARENT_ID } }
    });
    assert.equal(parent.status, 422);
    assert.equal(parent.json.code, 'PARENT_SHARES_UNSUPPORTED');
    assert.match(parent.json.error, /label/i, 'the refusal tells the owner to share a label');
    assert.equal(store.calls.create, 0);

    const label = await request(app, '/workspace/ws-1/shares', { method: 'POST', body: LABEL_BODY });
    assert.equal(label.status, 201);
    assert.equal(store.calls.create, 1);
  });
});

describe('owner create — L9 subject.id matches fetchProjects issue.parent.id', () => {
  test('a parent subject.id equal to issue.parent.id selects the children', async () => {
    const issues = [
      { id: PARENT_ID, identifier: 'LIN-1', title: 'Parent', state: { type: 'started' }, priority: 1, updatedAt: 'x' },
      { id: 'child-uuid', identifier: 'LIN-2', title: 'Child', parent: { id: PARENT_ID }, state: { type: 'unstarted' }, priority: 2, updatedAt: 'y' },
      { id: 'other-child', identifier: 'LIN-3', title: 'Other', parent: { id: 'someone-else' }, state: { type: 'unstarted' }, priority: 2, updatedAt: 'z' }
    ];
    const store = makeStore();
    const app = buildApp({ store, readOwnerIssues: async () => ({ reason: 'ok', issues }) });

    const res = await request(app, '/workspace/ws-1/shares', {
      method: 'POST',
      body: { subject: { kind: 'parent', id: PARENT_ID } }
    });
    assert.equal(res.status, 201);

    const record = [...store.byId.values()][0];
    assert.equal(record.subject.id, PARENT_ID, 'subject.id is stored verbatim (the provider issue id)');
    assert.deepEqual(record.snapshot.items.map(i => i.identifier), ['LIN-2']);
  });

  test('a parent input may be the human identifier and resolves to the provider id', async () => {
    const issues = [
      { id: PARENT_ID, identifier: 'LIN-1', title: 'Parent', state: { type: 'started' }, priority: 1, updatedAt: 'x' },
      { id: 'child-uuid', identifier: 'LIN-2', title: 'Child', parent: { id: PARENT_ID }, state: { type: 'unstarted' }, priority: 2, updatedAt: 'y' }
    ];
    const store = makeStore();
    const app = buildApp({ store, readOwnerIssues: async () => ({ reason: 'ok', issues }) });

    const res = await request(app, '/workspace/ws-1/shares', {
      method: 'POST',
      body: { subject: { kind: 'parent', id: 'LIN-1' } }
    });
    assert.equal(res.status, 201);

    const record = [...store.byId.values()][0];
    assert.equal(record.subject.id, PARENT_ID, 'the identifier is resolved to the provider-native id');
    assert.deepEqual(record.snapshot.items.map(i => i.identifier), ['LIN-2']);
  });

  test('a parent input that matches no issue is kept verbatim (already a provider id)', async () => {
    const store = makeStore();
    const app = buildApp({ store, readOwnerIssues: async () => ({ reason: 'ok', issues: [] }) });

    const res = await request(app, '/workspace/ws-1/shares', {
      method: 'POST',
      body: { subject: { kind: 'parent', id: 'orphan-uuid' } }
    });
    assert.equal(res.status, 201);
    assert.equal([...store.byId.values()][0].subject.id, 'orphan-uuid');
  });
});

describe('owner list', () => {
  test('never returns the token or tokenHash', async () => {
    const store = makeStore();
    const app = buildApp({ store, readOwnerIssues: async () => ({ reason: 'ok', issues: [] }) });
    await request(app, '/workspace/ws-1/shares', { method: 'POST', body: LABEL_BODY });

    const res = await request(app, '/workspace/ws-1/shares');
    assert.equal(res.status, 200);
    assert.equal(res.json.shares.length, 1);
    const item = res.json.shares[0];
    assert.ok(!('token' in item), 'no raw token field');
    assert.ok(!('tokenHash' in item), 'no tokenHash field');
    assert.ok(!res.body.includes([...store.byToken.keys()][0]), 'the raw token is absent from the whole body');
    const storedHash = [...store.byId.keys()][0];
    assert.ok(!res.body.includes(storedHash), 'the stored token hash is absent from the whole body');
    assert.ok(item.id && item.id !== storedHash, 'the id is a derived opaque value, not the stored hash');
    assert.equal(item.kind, 'label');
    assert.equal(item.subjectId, 'bug');
  });

  test('is scoped to the route workspace', async () => {
    const store = makeStore();
    const app = buildApp({ store, readOwnerIssues: async () => ({ reason: 'ok', issues: [] }) });
    await request(app, '/workspace/ws-A/shares', { method: 'POST', body: LABEL_BODY });
    const res = await request(app, '/workspace/ws-B/shares');
    assert.equal(res.status, 200);
    assert.deepEqual(res.json.shares, []);
  });
});

describe('owner revoke', () => {
  test('refuses a share whose urlKey is not the route\'s', async () => {
    const store = makeStore();
    const app = buildApp({ store, readOwnerIssues: async () => ({ reason: 'ok', issues: [] }) });
    await request(app, '/workspace/ws-A/shares', { method: 'POST', body: LABEL_BODY });
    const listed = await request(app, '/workspace/ws-A/shares');
    const id = listed.json.shares[0].id;

    const res = await request(app, `/workspace/ws-B/shares/${id}/revoke`, { method: 'POST' });
    assert.equal(res.status, 404);
    assert.equal([...store.byId.values()][0].revokedAt, null, 'the other workspace\'s share is untouched');
  });

  test('revoking stops the public /s/:token page (410)', async () => {
    const issues = [
      { id: PARENT_ID, identifier: 'LIN-1', title: 'Parent', state: { type: 'started' }, priority: 1, updatedAt: 'x' },
      { id: 'child-uuid', identifier: 'LIN-2', title: 'Child', parent: { id: PARENT_ID }, state: { type: 'unstarted' }, priority: 2, updatedAt: 'y' }
    ];
    const store = makeStore();
    const app = buildApp({ store, readOwnerIssues: async () => ({ reason: 'ok', issues }) });

    const created = await request(app, '/workspace/ws-1/shares', {
      method: 'POST',
      body: { subject: { kind: 'parent', id: PARENT_ID } }
    });
    assert.equal(created.status, 201);
    const token = created.json.token;

    const before = await request(app, `/s/${token}`);
    assert.equal(before.status, 200);
    assert.ok(before.body.includes('LIN-2'), 'the child renders before revoke');

    const listed = await request(app, '/workspace/ws-1/shares');
    const id = listed.json.shares[0].id;
    const revoke = await request(app, `/workspace/ws-1/shares/${id}/revoke`, { method: 'POST' });
    assert.equal(revoke.status, 200);
    assert.equal(revoke.json.success, true);
    assert.ok(revoke.json.share.revokedAt, 'the revoked row is returned');

    const after = await request(app, `/s/${token}`);
    assert.equal(after.status, 410, 'revoked shares are gone immediately');
  });

  test('an unknown id → 404', async () => {
    const store = makeStore();
    const app = buildApp({ store, readOwnerIssues: async () => ({ reason: 'ok', issues: [] }) });
    const res = await request(app, '/workspace/ws-1/shares/does-not-exist/revoke', { method: 'POST' });
    assert.equal(res.status, 404);
  });
});