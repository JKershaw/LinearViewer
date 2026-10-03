/**
 * LIN-2944 P3 (review a6be902a R2) — the proxy-default route write path.
 *
 * Addendum 15's "unit cases in the tests/unit/theme.test.js pattern for the
 * route write": a non-boolean is a 400, the session is the authoritative write,
 * the durable store persists only when the session carries an `accountId`, and
 * nothing is persisted without one. This kills the mutants the review named:
 *   - E8: the route no longer writes `req.session.proxyDefault`;
 *   - U9: the route no longer persists to the store when `accountId` is set.
 *
 * Mounts the SHIPPED `createProxyDefaultRoute` factory (the same one server.js
 * uses) over a stub `workspaceFromUrl` and a captured store/saveSession.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyDefaultRoute } from '../../lib/settings-proxy-default.js';

function buildApp({ accountId } = {}) {
  const calls = { saved: 0, persisted: [] };
  const store = {
    async setProxyDefault(id, value) { calls.persisted.push({ id, value }); return true; },
  };
  const session = {};
  if (accountId) session.accountId = accountId;
  const app = express();
  app.use(express.json());
  app.use(createProxyDefaultRoute({
    workspaceFromUrl: (req, _res, next) => { req.workspace = { urlKey: 'acme' }; req.session = session; next(); },
    userPreferencesStore: store,
    saveSession: async () => { calls.saved += 1; },
  }));
  return { app, session, calls };
}

async function post(app, body) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/workspace/acme/settings/proxy-default`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  } finally {
    await new Promise(r => server.close(r));
  }
}

describe('LIN-2944 P3 — POST settings/proxy-default', () => {
  test('non-boolean is a 400 and writes nothing', async () => {
    for (const bad of ['false', 0, 1, null, undefined]) {
      const { app, session, calls } = buildApp({ accountId: 'acct-1' });
      const { status } = await post(app, { proxyDefault: bad });
      assert.equal(status, 400, `proxyDefault=${JSON.stringify(bad)} is rejected`);
      assert.equal(session.proxyDefault, undefined, 'no session write on 400');
      assert.equal(calls.saved, 0, 'no session save on 400');
      assert.deepEqual(calls.persisted, [], 'no store write on 400');
    }
  });

  test('a boolean writes the session and persists when accountId is set (kills E8/U9)', async () => {
    const { app, session, calls } = buildApp({ accountId: 'acct-1' });
    const { status, body } = await post(app, { proxyDefault: false });
    assert.equal(status, 200);
    assert.deepEqual(body, { ok: true, proxyDefault: false });
    assert.equal(session.proxyDefault, false, 'E8: the session is written');
    assert.equal(calls.saved, 1, 'the session is saved');
    assert.deepEqual(calls.persisted, [{ id: 'acct-1', value: false }], 'U9: the store persists with the account');
  });

  test('without an accountId the session is written but nothing is persisted', async () => {
    const { app, session, calls } = buildApp();
    const { status } = await post(app, { proxyDefault: true });
    assert.equal(status, 200);
    assert.equal(session.proxyDefault, true, 'the session is still authoritative');
    assert.equal(calls.saved, 1);
    assert.deepEqual(calls.persisted, [], 'no account → no durable persist');
  });
});
