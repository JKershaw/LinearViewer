/**
 * LIN-1397 — POST /api/dispatch/broker-token: the new consumer-dispatch-token-
 * authenticated endpoint the Simple Dispatcher stall-failsafe reaper calls to
 * mint a fresh single-use bootstrap when re-arming a broker-armed session's
 * local credential broker at refire time.
 *
 * Key behaviors pinned here:
 *  - Valid dispatch token with a non-null createdBy -> 201, mints a
 *    kind:'bootstrap'/scope:'readWrite' proxy token scoped to the dispatch
 *    token's own urlKey, with createdBy stamped from the dispatch token owner.
 *  - Dispatch token with createdBy: null (pre-LIN-1397 / never re-minted) ->
 *    201, mints the same kind:'bootstrap'/scope:'readWrite' proxy token with
 *    createdBy stamped null (TEMPORARY ownerless-legacy compat lane, LIN-1447).
 *    LIN-1448 keeps this as the DEFAULT (deploying strictness before the host
 *    runner's own dispatch token is re-issued as owned would 503 its mints) but
 *    puts it behind DISPATCH_OWNERLESS_BROKER_COMPAT — see the LIN-1448 block
 *    at the bottom of this file for the strict lane.
 *  - Invalid/absent Authorization -> 401, no mint attempted.
 *  - proxyTokenStore absent -> 503 (endpoint not configured), no crash.
 *  - Mint throws / returns no token -> 503, fail-closed.
 *
 * Mirrors the buildApp/call scaffolding of dispatch-route-proxy-context.test.js.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createDispatchRoutes } from '../../routes/dispatch.js';

const PATH = '/api/dispatch/broker-token';

function buildApp(opts = {}) {
  const dispatchTokenStore = opts.dispatchTokenStore || {
    validateToken: async (token) => {
      if (token === 'good-token') return { urlKey: 'acme', label: 'refire', createdBy: 'account-A' };
      if (token === 'no-owner-token') return { urlKey: 'acme', label: 'legacy', createdBy: null };
      return null;
    }
  };
  const proxyTokenStore = 'proxyTokenStore' in opts
    ? opts.proxyTokenStore
    : {
        createToken: async (urlKey, options) => ({
          tokenId: 'pt-1',
          token: 'minted-bootstrap',
          label: options.label,
          scope: options.scope,
          kind: options.kind,
          expiresAt: '2026-07-20T00:00:00.000Z',
          _urlKey: urlKey,
          _createdBy: options.createdBy
        })
      };

  const app = express();
  app.use(express.json());
  app.use(createDispatchRoutes({
    dispatchQueueStore: {},
    dispatchTokenStore,
    workspaceFromUrl: (req, res, next) => next(),
    userPreferencesStore: {},
    proxyTokenStore
  }));
  return app;
}

async function call(app, path, token) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const headers = {};
    if (token !== undefined) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', headers });
    const text = await res.text();
    let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

describe('LIN-1397 — POST /api/dispatch/broker-token', () => {
  test('valid token with an owner -> 201, mints a scoped bootstrap with createdBy stamped', async () => {
    const captured = [];
    const proxyTokenStore = {
      createToken: async (urlKey, options) => {
        captured.push({ urlKey, options });
        return { token: 'minted-bootstrap', expiresAt: '2026-07-20T00:00:00.000Z' };
      }
    };
    const res = await call(buildApp({ proxyTokenStore }), PATH, 'good-token');
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.token, 'minted-bootstrap');
    assert.equal(captured.length, 1);
    assert.equal(captured[0].urlKey, 'acme');
    assert.equal(captured[0].options.kind, 'bootstrap');
    assert.equal(captured[0].options.scope, 'readWrite');
    assert.equal(captured[0].options.createdBy, 'account-A');
  });

  test('dispatch token with no owner -> 201, ownerless-legacy compat lane mints with createdBy: null (LIN-1447)', async () => {
    const captured = [];
    const proxyTokenStore = {
      createToken: async (urlKey, options) => {
        captured.push({ urlKey, options });
        return { token: 'minted-bootstrap', expiresAt: '2026-07-20T00:00:00.000Z' };
      }
    };
    const res = await call(buildApp({ proxyTokenStore }), PATH, 'no-owner-token');
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.token, 'minted-bootstrap');
    assert.equal(captured.length, 1, 'mints for an ownerless legacy token instead of 503ing');
    assert.equal(captured[0].urlKey, 'acme');
    assert.equal(captured[0].options.kind, 'bootstrap');
    assert.equal(captured[0].options.scope, 'readWrite');
    assert.equal(captured[0].options.createdBy, null, 'never fabricates an owner for a legacy token');
  });

  test('missing Authorization -> 401', async () => {
    const res = await call(buildApp(), PATH, undefined);
    assert.equal(res.status, 401);
  });

  test('invalid token -> 401', async () => {
    const res = await call(buildApp(), PATH, 'garbage');
    assert.equal(res.status, 401);
  });

  test('proxyTokenStore absent -> 503, no crash', async () => {
    const res = await call(buildApp({ proxyTokenStore: null }), PATH, 'good-token');
    assert.equal(res.status, 503);
  });

  test('mint throws -> 503 fail-closed', async () => {
    const proxyTokenStore = { createToken: async () => { throw new Error('boom'); } };
    const res = await call(buildApp({ proxyTokenStore }), PATH, 'good-token');
    assert.equal(res.status, 503);
  });

  test('mint returns no token -> 503 fail-closed', async () => {
    const proxyTokenStore = { createToken: async () => ({ token: null }) };
    const res = await call(buildApp({ proxyTokenStore }), PATH, 'good-token');
    assert.equal(res.status, 503);
  });
});

// ---------------------------------------------------------------------------
// LIN-1448 — the ownerless compat lane becomes switchable, and switching it OFF
// restores the strict owner-required mint this file's LIN-1397 header describes.
//
// Why a switch rather than a straight deletion. LIN-1448's own exit condition
// ("remove once no ownerless tokens remain / the lane has been cold for a safe
// window") is unsatisfiable: this lane is the ONLY minter of the `refire-broker`
// label, so it never goes cold. But per LIN-1447 the lane exists because the host
// runner authenticates with an ownerless pre-LIN-1397 consumer token — deleting it
// outright would 503 the runner's mints on deploy. So removal is gated on the
// operator having re-issued that token as owned (part 1), which is an on-host
// action Harbour cannot perform for itself. Default stays compat-on so a deploy
// can never break the runner; the operator flips the env var after rotating.
// ---------------------------------------------------------------------------

describe('LIN-1448 — DISPATCH_OWNERLESS_BROKER_COMPAT gates the ownerless lane', () => {
  const ENV = 'DISPATCH_OWNERLESS_BROKER_COMPAT';
  const restore = (t) => {
    const before = process.env[ENV];
    t.after(() => {
      if (before === undefined) delete process.env[ENV];
      else process.env[ENV] = before;
    });
  };

  function recordingStore(captured) {
    return {
      createToken: async (urlKey, options) => {
        captured.push({ urlKey, options });
        return { token: 'minted-bootstrap', expiresAt: '2026-07-20T00:00:00.000Z' };
      }
    };
  }

  test('unset -> compat lane on (default is deploy-safe: the runner keeps minting)', async (t) => {
    restore(t);
    delete process.env[ENV];
    const captured = [];
    const res = await call(buildApp({ proxyTokenStore: recordingStore(captured) }), PATH, 'no-owner-token');
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(captured.length, 1);
    assert.equal(captured[0].options.createdBy, null);
  });

  for (const value of ['off', 'OFF', 'false', '0', 'no']) {
    test(`${ENV}=${value} -> ownerless caller 503s BEFORE any mint (strict lane restored)`, async (t) => {
      restore(t);
      process.env[ENV] = value;
      const captured = [];
      const res = await call(buildApp({ proxyTokenStore: recordingStore(captured) }), PATH, 'no-owner-token');
      assert.equal(res.status, 503, JSON.stringify(res.body));
      assert.equal(captured.length, 0, 'a token that cannot work must never be minted');
      // The refusal must name its own remedy — the whole cost of this incident was
      // four sessions reading a generic failure as "reconnect the workspace".
      const blob = JSON.stringify(res.body);
      assert.match(blob, /LIN-1448/, 'the 503 names the ticket so the operator can find the remedy');
      assert.match(blob, /owner/i, 'the 503 names ownership as the cause, not the workspace');
    });
  }

  test('strict mode leaves OWNER-STAMPED tokens completely unaffected (LIN-1447 constraint)', async (t) => {
    restore(t);
    process.env[ENV] = 'off';
    const captured = [];
    const res = await call(buildApp({ proxyTokenStore: recordingStore(captured) }), PATH, 'good-token');
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(captured.length, 1);
    assert.equal(captured[0].options.createdBy, 'account-A');
  });

  test('an unrecognised value is treated as compat-on (fails SAFE, never strict-by-typo)', async (t) => {
    restore(t);
    process.env[ENV] = 'maybe';
    const captured = [];
    const res = await call(buildApp({ proxyTokenStore: recordingStore(captured) }), PATH, 'no-owner-token');
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(captured.length, 1);
  });

  test('the compat lane still logs its hit, with the token label, while it is on', async (t) => {
    restore(t);
    delete process.env[ENV];
    const warnings = [];
    const warn = console.warn;
    console.warn = (...args) => { warnings.push(args.join(' ')); };
    t.after(() => { console.warn = warn; });

    const captured = [];
    await call(buildApp({ proxyTokenStore: recordingStore(captured) }), PATH, 'no-owner-token');

    const hit = warnings.find(w => w.includes('LIN-1447'));
    assert.ok(hit, `expected the compat-lane warning; got ${JSON.stringify(warnings)}`);
    assert.match(hit, /acme/, 'names the workspace');
    assert.match(hit, /legacy/, 'names the offending token label so the operator knows WHICH token to re-issue');
  });
});
