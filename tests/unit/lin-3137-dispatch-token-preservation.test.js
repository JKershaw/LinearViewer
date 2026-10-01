/**
 * LIN-3137 J5 — preservation + source pins for the owner-only dispatch-token
 * mint gate.
 *
 * The gate is a MINT gate only. These tests prove nothing else changed:
 *   - existing legacy tokens (createdBy null, and a NON-owner createdBy) still
 *     authenticate on the verify path (`GET /api/dispatch/poll`);
 *   - `validateToken` has no owner branch;
 *   - GET list and DELETE revoke still work for a non-owner session;
 *   - the POST chain order is limiter → workspaceFromUrl → gate → createToken.
 *
 * `NODE_ENV=test` before import so the module-scope limiter skips.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import express from 'express';
import { createDispatchRoutes } from '../../routes/dispatch.js';
import { DispatchTokenStore } from '../../lib/dispatch-tokens.js';
import { createMockCollection } from '../fixtures/mock-collection.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '../..');

const TOKENS_PATH = '/workspace/acme/api/dispatch/tokens';
const POLL_PATH = '/api/dispatch/poll';
const ITEMS = [{ id: 'item-1' }];
const NON_OWNER = async () => ({ status: 'not-owner' });

function buildApp({ dispatchTokenStore, workspaceOwnerCheck = NON_OWNER }) {
  const app = express();
  app.use(express.json());
  app.use(createDispatchRoutes({
    dispatchQueueStore: { pollAvailable: async () => ITEMS },
    dispatchTokenStore,
    workspaceFromUrl: (req, res, next) => {
      req.workspace = { urlKey: 'acme', id: 'ws-1', provider: 'linear' };
      req.session = { accountId: 'account-A' };
      next();
    },
    userPreferencesStore: {},
    workspaceOwnerCheck
  }));
  return app;
}

async function call(app, method, path, headers = {}) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers });
    const text = await res.text();
    let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed };
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

describe('LIN-3137 — legacy tokens keep authenticating after the mint gate', () => {
  for (const [desc, createdBy] of [
    ['createdBy null (pre-LIN-1397 legacy token)', null],
    ['createdBy a NON-owner account', 'account-someone-else']
  ]) {
    test(`${desc} still polls 200 while the same app refuses a non-owner mint`, async () => {
      const dispatchTokenStore = new DispatchTokenStore({ collection: createMockCollection() });
      const { token } = await dispatchTokenStore.createToken('acme', 'legacy', createdBy);
      const app = buildApp({ dispatchTokenStore });

      // Verify path: the legacy token authenticates regardless of its owner.
      const poll = await call(app, 'GET', POLL_PATH, { Authorization: `Bearer ${token}` });
      assert.equal(poll.status, 200, JSON.stringify(poll.body));
      assert.deepEqual(poll.body.items, ITEMS);

      // The same app's MINT path is gated: the non-owner cannot mint.
      const mint = await call(app, 'POST', TOKENS_PATH, { 'Content-Type': 'application/json' });
      assert.equal(mint.status, 403, JSON.stringify(mint.body));
      assert.equal(mint.body.code, 'GRANT_OWNER_ONLY');
    });
  }
});

describe('LIN-3137 — GET list and DELETE revoke are unchanged for a non-owner', () => {
  test('a non-owner session can list and revoke (only mint is gated)', async () => {
    const dispatchTokenStore = new DispatchTokenStore({ collection: createMockCollection() });
    const { tokenId } = await dispatchTokenStore.createToken('acme', 'existing', 'account-someone-else');
    const app = buildApp({ dispatchTokenStore });

    const list = await call(app, 'GET', TOKENS_PATH);
    assert.equal(list.status, 200, JSON.stringify(list.body));
    assert.equal(list.body.tokens.length, 1);
    assert.equal(list.body.tokens[0].tokenId, tokenId);
    assert.equal(list.body.tokens[0].token, undefined, 'no secret in the list');

    const del = await call(app, 'DELETE', `${TOKENS_PATH}/${tokenId}`);
    assert.equal(del.status, 200, JSON.stringify(del.body));
    assert.deepEqual(del.body, { success: true });
  });
});

describe('LIN-3137 — source pins', () => {
  test('validateToken in lib/dispatch-tokens.js has no owner branch', () => {
    const src = readFileSync(join(REPO, 'lib', 'dispatch-tokens.js'), 'utf8');
    const start = src.indexOf('async validateToken(');
    assert.notEqual(start, -1, 'validateToken must exist');
    const end = src.indexOf('\n  }\n', start);
    assert.notEqual(end, -1, 'validateToken body must close');
    const body = src.slice(start, end);
    assert.ok(!/owner/i.test(body), 'validateToken must not consult an owner');
    assert.ok(!body.includes('role'), 'validateToken must not read a role edge');
  });

  test('the POST mint chain is limiter → workspaceFromUrl → gate → createToken', () => {
    const src = readFileSync(join(REPO, 'routes', 'dispatch.js'), 'utf8');
    const handlerStart = src.indexOf("router.post('/workspace/:urlKey/api/dispatch/tokens'");
    assert.notEqual(handlerStart, -1, 'the POST mint handler must exist');
    const handlerEnd = src.indexOf("router.get('/workspace/:urlKey/api/dispatch/tokens'", handlerStart);
    assert.notEqual(handlerEnd, -1, 'the POST handler slice must end before the GET');

    const registration = src.slice(handlerStart, src.indexOf('\n', handlerStart));
    assert.match(
      registration,
      /router\.post\('\/workspace\/:urlKey\/api\/dispatch\/tokens',\s*tokenCreationLimiter,\s*workspaceFromUrl,/,
      'the limiter must stay first, then workspaceFromUrl'
    );

    const handler = src.slice(handlerStart, handlerEnd);
    const iLimiter = handler.indexOf('tokenCreationLimiter');
    const iResolve = handler.indexOf('workspaceFromUrl');
    const iGate = handler.indexOf('resolveOwnerMintRefusal');
    const iMint = handler.indexOf('dispatchTokenStore.createToken');
    assert.ok(iLimiter > -1 && iResolve > -1 && iGate > -1 && iMint > -1, 'all four stages present');
    assert.ok(iLimiter < iResolve, 'limiter before workspaceFromUrl');
    assert.ok(iResolve < iGate, 'workspaceFromUrl (auth) before the owner gate');
    assert.ok(iGate < iMint, 'the owner gate before createToken');
  });
});
