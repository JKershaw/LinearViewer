/**
 * LIN-3438 — `ifParked` (the parked-only abort, LIN-3436/H0) is retired.
 *
 *  - POST /dispatch refuses `ifParked` for any value other than absent or
 *    `false`, ahead of the `sessionId` check. It must NOT be silently ignored:
 *    an ignored `ifParked:true` is a plain abort and can end a running session.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { validateDispatchPayload } from '../../lib/dispatch-validation.js';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { createDispatchRoutes } from '../../routes/dispatch.js';
import { ACME, buildApp, call } from './lib/proxy-fake-deps.js';
import { createMockCollection } from '../fixtures/mock-collection.js';

const TARGET = '11111111-1111-4111-8111-111111111111';
const ERROR = 'ifParked is no longer supported: the parked-only abort was retired (LIN-3438)';

function makeStore() {
  return new DispatchQueueStore({ collection: createMockCollection(), historyCollection: createMockCollection() });
}

function workspaceApp(store) {
  const app = express();
  app.use(express.json());
  app.use(createDispatchRoutes({
    workspaceOwnerCheck: async () => ({ status: 'owner' }),
    dispatchQueueStore: store,
    dispatchTokenStore: {},
    workspaceFromUrl: (req, res, next) => {
      req.workspace = { urlKey: req.params.urlKey };
      req.session = { accountId: 'u1', linearUserId: 'u1' };
      next();
    },
    userPreferencesStore: {},
    workspaceHaltStore: null
  }));
  return app;
}

describe('LIN-3438 — ifParked is refused, not ignored', () => {
  test('any value other than absent or false is a 400 with the exact error', async () => {
    for (const bad of [true, 'true', null, 1]) {
      for (const extra of [{}, { abort: true, abortTo: TARGET }]) {
        assert.deepEqual(validateDispatchPayload({ prompt: 'x', ...extra, ifParked: bad }), { error: ERROR }, `${String(bad)} ${JSON.stringify(extra)}`);
      }
    }
    const store = makeStore();
    const runnerToken = { tokenId: 't1', urlKey: ACME, label: 'runner', scope: 'readWrite', createdBy: 'u1', grants: ['take', 'dispatch'], workspaceId: 'ws-acme' };
    const proxyStore = makeStore();
    const proxy = buildApp({
      proxyTokenStore: { validateToken: async () => runnerToken, listTokens: async () => [], describeRejectionCause: async () => null },
      dispatchQueueStore: proxyStore,
      workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) }
    });
    const body = { abort: true, abortTo: TARGET, ifParked: true, target: 'cli' };

    const ws = await call(workspaceApp(store), 'post', '/workspace/acme/api/dispatch', { body });
    assert.equal(ws.status, 400, JSON.stringify(ws.body));
    assert.match(JSON.stringify(ws.body), /ifParked is no longer supported/);
    assert.deepEqual(await store.listItems('acme'), [], 'nothing queued (workspace route)');

    const px = await call(proxy, 'post', '/api/proxy/dispatch', { body });
    assert.equal(px.status, 400, JSON.stringify(px.body));
    assert.match(JSON.stringify(px.body), /ifParked is no longer supported/);
    assert.deepEqual(await proxyStore.listItems(ACME), [], 'nothing queued (proxy route)');
  });

  test('absent and false pass', () => {
    assert.equal(validateDispatchPayload({ abort: true, abortTo: TARGET }), null);
    assert.equal(validateDispatchPayload({ abort: true, abortTo: TARGET, ifParked: false }), null);
    assert.equal(validateDispatchPayload({ prompt: 'x', ifParked: false }), null);
  });

  test('ifParked is checked before sessionId (first-error order)', () => {
    assert.deepEqual(
      validateDispatchPayload({ abort: true, abortTo: TARGET, ifParked: true, sessionId: 'bad id with spaces\n' }),
      { error: ERROR }
    );
  });
});
