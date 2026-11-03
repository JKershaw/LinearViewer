/**
 * LIN-4168: every seed seam calls the one per-key reset, once per workspace it puts in the session, after its seeding and
 * before its session save (or return). Driven through the real routes/test.js handlers with a recording stub in place of
 * the reset, so the call count, the workspace it names and the order against `session.save` are all checked.
 *
 * The seams: /test/set-session (default, multiWorkspace, maxWorkspaces), /test/set-local-session,
 * /test/set-merge-conflict-session, /test/set-github-session, /test/set-github-projects-session, /test/set-jira-session.
 *
 * Run with: node --test tests/unit/key-state-seams.test.js
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MangoClient } from '@jkershaw/mangodb';
import { createTestRoutes } from '../../routes/test.js';
import { LocalStore } from '../../lib/local-store.js';
import { AccountStore } from '../../lib/account-store.js';
import { AccountWorkspaceStore } from '../../lib/account-workspace-store.js';

function getHandler(router, method, path) {
  const layer = router.stack.find((l) => l.route?.path === path && l.route.methods[method]);
  assert.ok(layer, `${method.toUpperCase()} ${path} route is registered`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

/** A session whose save records itself in `log`, and a response that records its status. */
function makeReqRes(log, { query = {}, body = {} } = {}) {
  const session = {
    save(cb) { log.push('save'); if (cb) cb(); },
  };
  const req = { query, body, session };
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(b) { this.body = b; return this; },
    send(b) { this.body = b; return this; },
    redirect() { return this; },
    type() { return this; },
    set() { return this; },
    end() { return this; },
  };
  return { req, res };
}

describe('the seed seams call the one per-key reset (LIN-4168)', () => {
  let dbClient;
  let dbDir;
  let counter = 0;

  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'key-state-seams-'));
    dbClient = new MangoClient(dbDir);
    await dbClient.connect();
  });

  after(async () => {
    if (dbClient?.close) await dbClient.close();
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  });

  /** Fresh stores per test, and a reset stub that records each call and the save order. */
  function harness({ fail = false } = {}) {
    const db = dbClient.db(`keystate_${counter++}`);
    const log = [];
    const calls = [];
    const resetKeyState = async (ctx) => {
      calls.push(ctx);
      log.push(`reset:${ctx.urlKey}`);
      if (fail) throw new Error('clear failed');
    };
    const router = createTestRoutes({
      accountStore: new AccountStore({ collection: db.collection('accounts') }),
      accountWorkspaceStore: new AccountWorkspaceStore({ collection: db.collection('account-workspaces') }),
      localStore: new LocalStore({ collection: db.collection('local-issues') }),
      resetKeyState,
    });
    return { router, log, calls };
  }

  test('/test/set-session calls the reset once for the one workspace it seeds, before the save', async () => {
    const { router, log, calls } = harness();
    const { req, res } = makeReqRes(log);
    await getHandler(router, 'get', '/test/set-session')(req, res);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].urlKey, 'test-workspace');
    assert.equal(calls[0].workspace, req.session.workspaces[0], 'the reset names the session workspace');
    assert.equal(calls[0].accountId, req.session.accountId, 'the reset carries the session account');
    assert.deepEqual(log, ['reset:test-workspace', 'save'], 'the reset runs before the save');
    assert.equal(res.body, 'ok');
  });

  test('/test/set-session with multiWorkspace calls the reset once per workspace in the session, not once per request', async () => {
    const { router, log, calls } = harness();
    const { req, res } = makeReqRes(log, { query: { multiWorkspace: 'true' } });
    await getHandler(router, 'get', '/test/set-session')(req, res);
    assert.deepEqual(calls.map((c) => c.urlKey), ['test-workspace', 'second-workspace']);
    assert.deepEqual(log, ['reset:test-workspace', 'reset:second-workspace', 'save']);
  });

  test('/test/set-session with maxWorkspaces calls the reset for all ten workspaces', async () => {
    const { router, calls, log } = harness();
    const { req, res } = makeReqRes(log, { query: { maxWorkspaces: 'true' } });
    await getHandler(router, 'get', '/test/set-session')(req, res);
    assert.equal(calls.length, 10);
    assert.equal(new Set(calls.map((c) => c.urlKey)).size, 10, 'one call per distinct workspace key');
    assert.equal(log[log.length - 1], 'save', 'the save comes after every reset');
  });

  test('/test/set-session answers 500 and does not save when the reset throws (loud)', async () => {
    const { router, log } = harness({ fail: true });
    const { req, res } = makeReqRes(log);
    await getHandler(router, 'get', '/test/set-session')(req, res);
    assert.equal(res.statusCode, 500);
    assert.match(res.body, /key reset failed: clear failed/);
    assert.ok(!log.includes('save'), 'a failed reset must not save the session');
  });

  test('/test/set-local-session calls the reset with the seeded key and its session workspace, before the save', async () => {
    const { router, log, calls } = harness();
    const { req, res } = makeReqRes(log, { query: { urlKey: 'local-w0' } });
    await getHandler(router, 'get', '/test/set-local-session')(req, res);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].urlKey, 'local-w0');
    assert.equal(calls[0].workspace.urlKey, 'local-w0');
    assert.equal(calls[0].workspace, req.session.workspaces[0], 'the session workspace, not a copy');
    assert.deepEqual(log, ['reset:local-w0', 'save']);
  });

  test('/test/set-merge-conflict-session calls the reset before it answers (its response path saves the session itself)', async () => {
    const { router, log, calls } = harness();
    const { req, res } = makeReqRes(log, { query: { urlKey: 'mc-w0' } });
    await getHandler(router, 'get', '/test/set-merge-conflict-session')(req, res);

    assert.equal(calls.length, 1, 'one call, for the session’s workspace');
    assert.match(calls[0].urlKey, /^mc-w0-c-/);
    // respondToAccountConflict saves the session (lib/account-conflict.js) and only then answers; the reset is before both.
    assert.deepEqual(log, [`reset:${calls[0].urlKey}`, 'save']);
  });

  test('/test/set-github-session calls the reset once, and zeroes the fake counters only after it', async () => {
    const { router, calls, log } = harness();
    const { req, res } = makeReqRes(log);
    await getHandler(router, 'get', '/test/set-github-session')(req, res);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].workspace, req.session.workspaces[0]);
    assert.deepEqual(log, [`reset:${calls[0].urlKey}`, 'save']);
    const counters = { res: null };
    const countersRes = { json(b) { counters.res = b; return this; } };
    await getHandler(router, 'get', '/test/github-fake-counters')({}, countersRes);
    assert.deepEqual(counters.res, { listUserInstallations: 0, beginAuth: 0, beginInstall: 0, completeAuth: 0, completeInstallation: 0 });
  });

  test('/test/set-github-projects-session calls the reset once, before the save', async () => {
    const { router, calls, log } = harness();
    const { req, res } = makeReqRes(log);
    await getHandler(router, 'get', '/test/set-github-projects-session')(req, res);
    assert.equal(calls.length, 1);
    assert.deepEqual(log, [`reset:${calls[0].urlKey}`, 'save']);
  });

  test('/test/set-jira-session calls the reset once, before the save', async () => {
    const { router, calls, log } = harness();
    const { req, res } = makeReqRes(log);
    await getHandler(router, 'get', '/test/set-jira-session')(req, res);
    assert.equal(calls.length, 1);
    assert.deepEqual(log, [`reset:${calls[0].urlKey}`, 'save']);
  });

  test('a router built without a reset still seeds (the reset is optional at the router, required at the server)', async () => {
    const db = dbClient.db(`keystate_${counter++}`);
    const router = createTestRoutes({
      accountStore: new AccountStore({ collection: db.collection('accounts') }),
      accountWorkspaceStore: new AccountWorkspaceStore({ collection: db.collection('account-workspaces') }),
      localStore: new LocalStore({ collection: db.collection('local-issues') }),
    });
    const { req, res } = makeReqRes(null);
    req.session.save = (cb) => cb();
    await getHandler(router, 'get', '/test/set-session')(req, res);
    assert.equal(res.body, 'ok');
  });
});
