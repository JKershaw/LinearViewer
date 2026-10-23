/**
 * LIN-3774 (S7): the per-request freshness step on /workspace/:urlKey.
 *
 * The dashboard re-mints a stale secondary GitHub token inside
 * fetchAndPrepareProjects, but the task page, task edit/chat, brief/scan, the
 * issue PATCH, the settings "Refresh / test" button and dispatch read a secondary
 * credential through the session side-table too. One `app.use` step, mounted
 * after hydration + ensureValidToken and before any route, brings the addressed
 * workspace's secondary tokens up to date for all of them.
 *
 * server.js is not import-safe: the block's real source is sliced into a vm
 * context with an Express-like `app.use` recorder. The seam is the REAL module.
 *
 * Run: node --test tests/unit/lin-3774-workspace-freshness-middleware.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { createSecondaryBindingRemint } from '../../lib/connection-secondary-remint.js';
import { rehydrateBindingAfterRefresh } from '../../lib/connection-credential.js';
import { setBindingCredential, readBindingCredential } from '../../lib/connection-binding.js';
import { getWorkspaceByUrlKey } from '../../lib/workspace.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_SRC = readFileSync(join(__dirname, '../../server.js'), 'utf8');
const NOW = 1_800_000_000_000;
const MOUNT = "app.use('/workspace/:urlKey', async (req, res, next) => {";

function sliceBlock() {
  const start = SERVER_SRC.indexOf(MOUNT);
  assert.notEqual(start, -1, 'expected the /workspace/:urlKey freshness step in server.js');
  const end = SERVER_SRC.indexOf('\n})\n', start);
  assert.notEqual(end, -1);
  return SERVER_SRC.slice(start, end + 3);
}

function makeSession({ ghExpiry = NOW - 1000, accountId = 'a' } = {}) {
  const linear = { provider: 'linear', scope: 'org-1', connectionId: 'a::linear::org-1' };
  const github = { provider: 'github', scope: 'JKershaw/LinearViewer', connectionId: 'a::github::1' };
  setBindingCredential(linear, { token: 'lin', tokenExpiresAt: NOW + 3_600_000 });
  setBindingCredential(github, { token: 'stale-gh', tokenExpiresAt: ghExpiry });
  const workspace = { id: 'org-1', urlKey: 'lv', provider: 'linear', activeBinding: { provider: 'linear', scope: 'org-1' }, bindings: [linear, github] };
  return { workspace, session: { accountId, workspaces: [workspace] } };
}

async function runStep({ session, urlKey = 'lv', remint = async () => ({ token: 'fresh-gh', expiresAt: NOW + 3_600_000 }) }) {
  const calls = { remint: [], next: 0, errors: [] };
  const mounted = [];
  const secondaryRemint = createSecondaryBindingRemint({
    refreshConnectionForWorkspace: async (...args) => { calls.remint.push(args); return remint(...args); },
    applyRefreshed: rehydrateBindingAfterRefresh,
    now: () => NOW,
    logger: { error: () => {} },
  });
  const context = vm.createContext({
    app: { use: (...args) => mounted.push(args) },
    getWorkspaceByUrlKey,
    secondaryRemint,
    console: { ...console, error: (...a) => calls.errors.push(a) },
  });
  vm.runInContext(sliceBlock(), context);
  assert.equal(mounted.length, 1);
  assert.equal(mounted[0][0], '/workspace/:urlKey');
  await mounted[0][1]({ session, params: { urlKey } }, {}, () => { calls.next++; });
  return calls;
}

describe('LIN-3774 /workspace/:urlKey freshness step', () => {
  test('an expired secondary on the addressed workspace is re-minted once before next(); Linear is untouched', async () => {
    const { workspace, session } = makeSession();
    const calls = await runStep({ session });
    assert.equal(calls.remint.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(calls.remint[0])), [{ _id: 'a::github::1', provider: 'github' }, 'a', 'lv']);
    assert.equal(readBindingCredential(workspace.bindings[1]).token, 'fresh-gh', 'the route will read the fresh token');
    assert.equal(readBindingCredential(workspace.bindings[0]).token, 'lin');
    assert.equal(calls.next, 1);
  });

  test('no stale secondary: next() with zero re-mints', async () => {
    const { session } = makeSession({ ghExpiry: NOW + 3_600_000 });
    const calls = await runStep({ session });
    assert.equal(calls.remint.length, 0);
    assert.equal(calls.next, 1);
  });

  test('an unknown urlKey and a session with no accountId both go straight to next()', async () => {
    const unknown = await runStep({ session: makeSession().session, urlKey: 'nope' });
    assert.equal(unknown.remint.length, 0);
    assert.equal(unknown.next, 1);
    const anonymous = await runStep({ session: makeSession({ accountId: null }).session });
    assert.equal(anonymous.remint.length, 0);
    assert.equal(anonymous.next, 1);
  });

  test('a throwing or null re-mint never blocks the request', async () => {
    for (const remint of [async () => { throw new Error('GitHub down'); }, async () => null]) {
      const { workspace, session } = makeSession();
      const calls = await runStep({ session, remint });
      assert.equal(calls.next, 1);
      assert.equal(readBindingCredential(workspace.bindings[1]).token, 'stale-gh');
    }
  });

  test('a throw from the lookup itself is logged and still calls next()', async () => {
    const calls = await runStep({ session: { get workspaces() { throw new Error('session store down'); } } });
    assert.equal(calls.next, 1);
    assert.equal(calls.errors.length, 1);
  });
});

describe('LIN-3774 freshness step mount order', () => {
  const at = (needle, from = 0) => {
    const i = SERVER_SRC.indexOf(needle, from);
    assert.notEqual(i, -1, `expected ${needle} in server.js`);
    return i;
  };

  test('it sits after hydration and the ensureValidToken middleware, and before the first route mount', () => {
    const step = at(MOUNT);
    assert.ok(step > at('app.use(createHydrationMiddleware('), 'after the hydration middleware');
    assert.ok(step > at('ensureValidToken(req, res, next);'), 'after the ensureValidToken app.use');
    assert.ok(step < at('// Route Mounting'), 'before the first route mount');
    assert.ok(step < at('app.use(createDispatchRoutes('), 'before the dispatch routes');
  });

  test('dispatch is mounted under /workspace/:urlKey, so the step covers it', () => {
    const dispatch = readFileSync(join(__dirname, '../../routes/dispatch.js'), 'utf8');
    assert.match(dispatch, /['"`]\/workspace\/:urlKey\/api\/dispatch['"`]/);
  });
});
