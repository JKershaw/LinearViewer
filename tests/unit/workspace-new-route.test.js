/**
 * Unit tests for POST /workspace/new — the non-OAuth local-workspace bootstrap
 * (LIN-377). Exercises the route handler directly against an in-memory LocalStore
 * and a fake session, asserting the load-bearing contract: the local session
 * shape, starter seeding, collision-safe urlKey, and the post-create redirect.
 *
 * Run with: node --test tests/unit/workspace-new-route.test.js
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MangoClient } from '@jkershaw/mangodb';
import { createWorkspaceRoutes } from '../../routes/workspace.js';
import { LocalStore } from '../../lib/local-store.js';
import { URL_KEY_REGEX } from '../../lib/workspace.js';
import { AccountStore } from '../../lib/account-store.js';
import { AccountWorkspaceStore } from '../../lib/account-workspace-store.js';

// Minimal in-memory collection matching the Mango/Mongo surface LocalStore uses.
function makeCollection() {
  const docs = [];
  const matches = (doc, q) => Object.entries(q).every(([k, v]) => doc[k] === v);
  return {
    async updateOne(filter, update, opts = {}) {
      const existing = docs.find(d => matches(d, filter));
      if (existing) Object.assign(existing, update.$set);
      else if (opts.upsert) docs.push({ ...update.$set });
      return { matchedCount: existing ? 1 : 0 };
    },
    async findOne(q) { return docs.find(d => matches(d, q)) || null; },
    find(q) { return { toArray: async () => docs.filter(d => matches(d, q)) }; },
    async deleteMany(q) {
      let n = 0;
      for (let i = docs.length - 1; i >= 0; i--) if (matches(docs[i], q)) { docs.splice(i, 1); n++; }
      return { deletedCount: n };
    },
  };
}

// Pull the POST /workspace/new handler out of the router stack.
function getHandler(router) {
  const layer = router.stack.find(l => l.route?.path === '/workspace/new' && l.route.methods.post);
  assert.ok(layer, 'POST /workspace/new route is registered');
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function makeReqRes({ body = {}, session = {} } = {}) {
  session.save = session.save || ((cb) => cb && cb());
  const req = { body, session };
  const res = {
    redirectedTo: null,
    statusCode: 200,
    sentBody: null,
    redirect(url) { this.redirectedTo = url; },
    status(code) { this.statusCode = code; return this; },
    send(b) { this.sentBody = b; return this; },
  };
  return { req, res };
}

describe('POST /workspace/new (local bootstrap)', () => {
  let dbDir;
  let client;
  let counter = 0;

  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'workspace-new-route-'));
    client = new MangoClient(dbDir);
    await client.connect();
  });

  after(async () => {
    if (client?.close) await client.close();
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  });

  // LIN-1329: every POST /workspace/new must establish a durable account
  // through the real establishAccount seam — fresh MangoDB-backed stores per
  // test so accounts from one test can't leak identity conflicts into another.
  function freshAccountStores() {
    const db = client.db(`acct_${counter++}`);
    return {
      accountStore: new AccountStore({ collection: db.collection('accounts') }),
      accountWorkspaceStore: new AccountWorkspaceStore({ collection: db.collection('account-workspaces') }),
    };
  }

  test('creates a local workspace with the exact required session shape', async () => {
    const store = new LocalStore({ collection: makeCollection() });
    const handler = getHandler(createWorkspaceRoutes({ localStore: store, ...freshAccountStores() }));
    const { req, res } = makeReqRes({ body: { name: 'My Notes' } });

    await handler(req, res);

    assert.strictEqual(req.session.workspaces.length, 1);
    const ws = req.session.workspaces[0];
    assert.strictEqual(ws.provider, 'local');
    assert.strictEqual(ws.name, 'My Notes');
    assert.strictEqual(ws.credentials.token, ws.urlKey, 'credentials.token === urlKey');
    assert.strictEqual(ws.accessToken, ws.urlKey, 'accessToken === urlKey (partition selector)');
    assert.strictEqual(ws.tokenExpiresAt, Number.MAX_SAFE_INTEGER, 'never-expiring (no refresh)');
    assert.ok(ws.id && ws.id !== ws.urlKey, 'id is a distinct uuid, not the urlKey');
    assert.ok(typeof ws.addedAt === 'number');
    assert.strictEqual(req.session.activeWorkspaceId, ws.id, 'new workspace is active');
    // LIN-562: local creation converges on linkProvider, so it carries a single
    // local binding scoped to its urlKey (the store partition).
    assert.deepStrictEqual(ws.bindings, [
      { provider: 'local', scope: ws.urlKey, credentials: { token: ws.urlKey, tokenExpiresAt: Number.MAX_SAFE_INTEGER } }
    ], 'one local binding, scope === urlKey, token === partition');
    // LIN-1329: the account seam ran for real — session.accountId is set.
    assert.ok(req.session.accountId, 'session.accountId set by establishAccount');
  });

  test('derives a valid, slugged, collision-safe urlKey and redirects into it', async () => {
    const store = new LocalStore({ collection: makeCollection() });
    const handler = getHandler(createWorkspaceRoutes({ localStore: store, ...freshAccountStores() }));
    const { req, res } = makeReqRes({ body: { name: 'My Notes' } });

    await handler(req, res);

    const ws = req.session.workspaces[0];
    assert.ok(URL_KEY_REGEX.test(ws.urlKey), 'urlKey matches URL_KEY_REGEX');
    assert.ok(ws.urlKey.startsWith('my-notes-'), 'urlKey is slugged from the name');
    assert.ok(ws.urlKey.length <= 50, 'urlKey within 50 chars');
    assert.strictEqual(res.redirectedTo, `/workspace/${ws.urlKey}/`);
  });

  test('defaults the name to "Local Workspace" when none given', async () => {
    const store = new LocalStore({ collection: makeCollection() });
    const handler = getHandler(createWorkspaceRoutes({ localStore: store, ...freshAccountStores() }));
    const { req } = makeReqRes({ body: {} });

    await handler(req, makeReqRes().res);

    assert.strictEqual(req.session.workspaces[0].name, 'Local Workspace');
    assert.ok(req.session.workspaces[0].urlKey.startsWith('local-workspace-'));
  });

  test('seeds a starter project + issues into the new partition', async () => {
    const store = new LocalStore({ collection: makeCollection() });
    const handler = getHandler(createWorkspaceRoutes({ localStore: store, ...freshAccountStores() }));
    const { req, res } = makeReqRes({ body: { name: 'Seeded' } });

    await handler(req, res);

    const scope = req.session.workspaces[0].urlKey;
    const projects = await store.listProjects(scope);
    const issues = await store.listIssues(scope);
    assert.strictEqual(projects.length, 1, 'one starter project');
    assert.ok(issues.length >= 1, 'at least one starter issue');
    // Seeded into THIS partition only — nothing leaks to another scope.
    assert.strictEqual((await store.listIssues('some-other-scope')).length, 0);
  });

  test('two creates with the same name get distinct partitions but the same account (no merge, no conflict)', async () => {
    const store = new LocalStore({ collection: makeCollection() });
    const handler = getHandler(createWorkspaceRoutes({ localStore: store, ...freshAccountStores() }));
    const session = {};

    const a = makeReqRes({ body: { name: 'Dup' }, session });
    await handler(a.req, a.res);
    const firstAccountId = session.accountId;
    const b = makeReqRes({ body: { name: 'Dup' }, session });
    await handler(b.req, b.res);

    const keys = session.workspaces.map(w => w.urlKey);
    assert.strictEqual(new Set(keys).size, 2, 'urlKeys are unique within the session');
    // LIN-1329 Q6: distinct freshly-random urlKeys never false-conflict, and
    // the SAME session continues onto the SAME account across both creates
    // (one human, two local workspaces) rather than minting a second account.
    assert.ok(firstAccountId);
    assert.strictEqual(session.accountId, firstAccountId);
  });

  test('still creates the session workspace when no localStore is wired', async () => {
    const handler = getHandler(createWorkspaceRoutes({ ...freshAccountStores() }));
    const { req, res } = makeReqRes({ body: { name: 'No Store' } });

    await handler(req, res);

    assert.strictEqual(req.session.workspaces.length, 1);
    assert.ok(res.redirectedTo.startsWith('/workspace/no-store-'));
  });

  test('rejects with 400 when MAX_WORKSPACES is exceeded', async () => {
    const handler = getHandler(createWorkspaceRoutes({ ...freshAccountStores() }));
    const workspaces = Array.from({ length: 10 }, (_, i) => ({ id: `w${i}`, urlKey: `w${i}` }));
    const { req, res } = makeReqRes({ body: { name: 'Overflow' }, session: { workspaces } });

    await handler(req, res);

    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(req.session.workspaces.length, 10, 'no workspace added on overflow');
  });
});
