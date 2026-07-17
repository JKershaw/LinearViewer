/**
 * LIN-1329 fixture regression: proves the four E2E test fixtures in
 * routes/test.js (`/test/set-session`, `/test/set-local-session`,
 * `/test/set-github-session`, `/test/set-github-projects-session`) establish
 * a real `session.accountId` through the production `establishAccount` seam,
 * rather than fabricating one — the exact gap the ticket's Q4 ruling closes
 * (stop bypassing `linkIdentity`). `linearUserId` is no longer written to the
 * session at all (LIN-1332): `accountId` is the only identity.
 *
 * Run with: node --test tests/unit/test-routes-account-fixtures.test.js
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MangoClient } from '@jkershaw/mangodb';
import { createTestRoutes } from '../../routes/test.js';
import { LocalStore } from '../../lib/local-store.js';
import { AccountStore } from '../../lib/account-store.js';
import { AccountWorkspaceStore } from '../../lib/account-workspace-store.js';

function getHandler(router, method, path) {
  const layer = router.stack.find(l => l.route?.path === path && l.route.methods[method]);
  assert.ok(layer, `${method.toUpperCase()} ${path} route is registered`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function makeReqRes({ query = {}, body = {} } = {}) {
  const session = { save(cb) { if (cb) cb(); } };
  const req = { query, body, session };
  const res = {
    statusCode: 200,
    jsonBody: null,
    status(code) { this.statusCode = code; return this; },
    json(b) { this.jsonBody = b; return this; },
    send(b) { this.jsonBody = b; return this; },
  };
  return { req, res };
}

describe('routes/test.js — LIN-1329 fixture re-point', () => {
  let dbClient;
  let dbDir;
  let counter = 0;

  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'test-routes-fixtures-'));
    dbClient = new MangoClient(dbDir);
    await dbClient.connect();
  });

  after(async () => {
    if (dbClient?.close) await dbClient.close();
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  });

  function freshDeps() {
    const db = dbClient.db(`acct_${counter++}`);
    return {
      accountStore: new AccountStore({ collection: db.collection('accounts') }),
      accountWorkspaceStore: new AccountWorkspaceStore({ collection: db.collection('account-workspaces') }),
      localStore: new LocalStore({ collection: db.collection('local-issues') }),
    };
  }

  test('/test/set-session establishes a real account, with no session.linearUserId (LIN-1332)', async () => {
    const router = createTestRoutes(freshDeps());
    const handler = getHandler(router, 'get', '/test/set-session');
    const { req, res } = makeReqRes();

    await handler(req, res);

    assert.strictEqual(req.session.linearUserId, undefined);
    assert.ok(req.session.accountId, 'session.accountId set through the real seam');
  });

  test('/test/set-session with noLinearUser skips account establishment (mirrors having no identity)', async () => {
    const router = createTestRoutes(freshDeps());
    const handler = getHandler(router, 'get', '/test/set-session');
    const { req, res } = makeReqRes({ query: { noLinearUser: 'true' } });

    await handler(req, res);

    assert.strictEqual(req.session.linearUserId, undefined);
    assert.strictEqual(req.session.accountId, undefined);
  });

  test('/test/set-local-session establishes a real account scoped to the urlKey (Q6), with no fake linearUserId (LIN-1353 S10)', async () => {
    const router = createTestRoutes(freshDeps());
    const handler = getHandler(router, 'get', '/test/set-local-session');
    const { req, res } = makeReqRes();

    await handler(req, res);

    // Production never sets linearUserId for the local provider — the fixture
    // used to fake one; LIN-1353 dropped it so the fixture stops asserting an
    // identity shape production never produces.
    assert.strictEqual(req.session.linearUserId, undefined);
    assert.ok(req.session.accountId, 'session.accountId set through the real seam');
  });

  test('/test/set-github-session establishes a real account under the shared `github` identity provider, with no fake linearUserId (LIN-1353 S10)', async () => {
    const router = createTestRoutes(freshDeps());
    const handler = getHandler(router, 'get', '/test/set-github-session');
    const { req, res } = makeReqRes();

    await handler(req, res);

    assert.strictEqual(req.session.linearUserId, undefined);
    assert.ok(req.session.accountId, 'session.accountId set through the real seam');
  });

  test('/test/set-github-projects-session establishes a real account under the shared `github` identity provider, with no fake linearUserId (LIN-1353 S10)', async () => {
    const router = createTestRoutes(freshDeps());
    const handler = getHandler(router, 'get', '/test/set-github-projects-session');
    const { req, res } = makeReqRes();

    await handler(req, res);

    assert.strictEqual(req.session.linearUserId, undefined);
    assert.ok(req.session.accountId, 'session.accountId set through the real seam');
  });

  test('the github and github-projects fixtures land on DISTINCT accounts (distinct simulated humans)', async () => {
    const deps = freshDeps();
    const ghRouter = createTestRoutes(deps);
    const gh = makeReqRes();
    await getHandler(ghRouter, 'get', '/test/set-github-session')(gh.req, gh.res);

    const gp = makeReqRes();
    await getHandler(ghRouter, 'get', '/test/set-github-projects-session')(gp.req, gp.res);

    assert.notStrictEqual(gh.req.session.accountId, gp.req.session.accountId);
  });
});
