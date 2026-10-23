/**
 * LIN-3798 — `/test/set-session` gives each per-worker urlKey its own workspace id.
 *
 * The workspace id keys the owner edge that the LIN-3383 owner-only enqueue gate
 * reads. When every worker's session workspace shared `11111111-…`, a spec that
 * seeded `foreign` ownership on ITS worker's key (autopilot-proxy-force.spec.js,
 * runner-enqueue-owner-only.spec.js, …) took ownership from every other worker
 * for that window, and a parallel collective fan-out came back RUNNER_OWNER_ONLY
 * (collective.spec.js `every(d => d.ok)`, rescued only by retry).
 *
 * The behaviour witness is the last test: a `foreign` seed on worker 1's key must
 * leave worker 0's workspace owned by worker 0's account.
 *
 * Run with: node --test tests/unit/test-routes-worker-workspace-ids.test.js
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

const TEST_UUID_1 = '11111111-1111-1111-1111-111111111111';
const TEST_UUID_2 = '22222222-2222-2222-2222-222222222222';

function getHandler(router, method, path) {
  const layer = router.stack.find(l => l.route?.path === path && l.route.methods[method]);
  assert.ok(layer, `${method.toUpperCase()} ${path} route is registered`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function makeReqRes(query = {}, session = { save(cb) { if (cb) cb(); } }) {
  const req = { query, body: {}, session };
  const res = {
    statusCode: 200,
    jsonBody: null,
    status(code) { this.statusCode = code; return this; },
    json(b) { this.jsonBody = b; return this; },
    send(b) { this.jsonBody = b; return this; },
  };
  return { req, res };
}

describe('routes/test.js — per-worker workspace ids (LIN-3798)', () => {
  let dbClient;
  let dbDir;
  let counter = 0;

  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'test-routes-worker-ids-'));
    dbClient = new MangoClient(dbDir);
    await dbClient.connect();
  });

  after(async () => {
    if (dbClient?.close) await dbClient.close();
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  });

  function freshDeps() {
    const db = dbClient.db(`ids_${counter++}`);
    return {
      accountStore: new AccountStore({ collection: db.collection('accounts') }),
      accountWorkspaceStore: new AccountWorkspaceStore({ collection: db.collection('account-workspaces') }),
      localStore: new LocalStore({ collection: db.collection('local-issues') }),
    };
  }

  async function setSession(router, query) {
    const { req, res } = makeReqRes(query);
    await getHandler(router, 'get', '/test/set-session')(req, res);
    return req.session;
  }

  test('two worker keys get distinct workspace ids, stable per key', async () => {
    const router = createTestRoutes(freshDeps());
    const w0 = await setSession(router, { urlKey: 'test-workspace-w0' });
    const w1 = await setSession(router, { urlKey: 'test-workspace-w1' });
    const w0Again = await setSession(router, { urlKey: 'test-workspace-w0' });

    assert.notStrictEqual(w0.workspaces[0].id, w1.workspaces[0].id);
    assert.strictEqual(w0Again.workspaces[0].id, w0.workspaces[0].id, 'same urlKey, same id');
    assert.strictEqual(w0.activeWorkspaceId, w0.workspaces[0].id);
  });

  test('multiWorkspace and maxWorkspaces siblings are per-worker too', async () => {
    const router = createTestRoutes(freshDeps());
    const m0 = await setSession(router, { urlKey: 'test-workspace-w0', multiWorkspace: 'true' });
    const m1 = await setSession(router, { urlKey: 'test-workspace-w1', multiWorkspace: 'true' });
    assert.notStrictEqual(m0.workspaces[1].id, m1.workspaces[1].id);

    const x0 = await setSession(router, { urlKey: 'test-workspace-w0', maxWorkspaces: 'true' });
    const x1 = await setSession(router, { urlKey: 'test-workspace-w1', maxWorkspaces: 'true' });
    const ids0 = new Set(x0.workspaces.map(w => w.id));
    assert.strictEqual(ids0.size, 10);
    assert.ok(x1.workspaces.every(w => !ids0.has(w.id)), 'no maxWorkspaces id is shared across workers');
  });

  test('the fixed default keys keep their fixed ids', async () => {
    const router = createTestRoutes(freshDeps());
    const single = await setSession(router, {});
    assert.strictEqual(single.workspaces[0].urlKey, 'test-workspace');
    assert.strictEqual(single.workspaces[0].id, TEST_UUID_1);

    const multi = await setSession(router, { multiWorkspace: 'true' });
    assert.deepStrictEqual(multi.workspaces.map(w => w.id), [TEST_UUID_1, TEST_UUID_2]);

    const max = await setSession(router, { maxWorkspaces: 'true' });
    assert.strictEqual(max.workspaces[3].id, '33333333-3333-3333-3333-333333333333');
  });

  test("a 'foreign' ownership seed on one worker's key leaves another worker's workspace owned", async () => {
    const deps = freshDeps();
    const router = createTestRoutes(deps);
    const w0 = await setSession(router, { urlKey: 'test-workspace-w0' });
    const w1 = await setSession(router, { urlKey: 'test-workspace-w1' });
    const seed = getHandler(router, 'get', '/test/set-workspace-ownership');

    const owner0 = makeReqRes({ urlKey: 'test-workspace-w0', state: 'owner' }, w0);
    await seed(owner0.req, owner0.res);
    assert.strictEqual(owner0.res.statusCode, 200);

    const foreign1 = makeReqRes({ urlKey: 'test-workspace-w1', state: 'foreign' }, w1);
    await seed(foreign1.req, foreign1.res);
    assert.strictEqual(foreign1.res.statusCode, 200);

    assert.strictEqual(
      await deps.accountWorkspaceStore.getWorkspaceOwnerAccountId(w0.workspaces[0].id, deps.accountStore),
      w0.accountId,
      "worker 0 still owns its workspace after worker 1's foreign seed"
    );
    assert.notStrictEqual(
      await deps.accountWorkspaceStore.getWorkspaceOwnerAccountId(w1.workspaces[0].id, deps.accountStore),
      w1.accountId
    );
  });
});
