/**
 * LIN-3977 (review finding 8): what the Live Console events endpoint reads from the stores per
 * request, measured with counting fakes behind the real router and the real run-controls resolver.
 *
 * Base (f2b68b80): the events gate read the stored flag only, so a poll read no owner or token
 * rows, and a "view earlier" page read no loops. Head: the gate resolves the owner-with-runner rule
 * on every request (requestFeatureFlags), and a history page reads the loops the fold needs.
 * These counts are the head numbers recorded in the PR body.
 */
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createLiveConsoleRoutes } from '../../routes/live-console.js';
import { createRunControlsResolver, setRunControlsResolver } from '../../lib/run-controls.js';

function counting(methods) {
  const calls = {};
  const store = {};
  for (const [name, impl] of Object.entries(methods)) {
    calls[name] = 0;
    store[name] = async (...args) => { calls[name] += 1; return impl(...args); };
  }
  return { store, calls };
}

// One events request through the real router, for a session with the given stored flags.
async function requestEvents({ owner, runner, features, query = '' }) {
  const status = counting({ listStatus: async () => ({ items: [], total: 0 }) });
  const items = counting({ listItems: async () => [], listHistory: async () => [] });
  const ownerCheck = counting({ check: async () => ({ status: owner ? 'owner' : 'not-owner' }) });
  const proxy = counting({ listTokens: async () => (runner ? [{ grants: ['take'], expiresAt: null }] : []) });
  const queue = counting({ listTokens: async () => [] });

  setRunControlsResolver(createRunControlsResolver({
    ownerCheck: (args) => ownerCheck.store.check(args),
    proxyTokenStore: proxy.store,
    dispatchTokenStore: queue.store,
  }));

  const app = express();
  app.use(createLiveConsoleRoutes({
    workspaceFromUrl: (req, res, next) => {
      req.workspace = { id: 'ws-1', urlKey: 'acme', name: 'Acme' };
      req.session = { accountId: 'a', features, workspaces: [{ urlKey: 'acme', name: 'Acme' }] };
      next();
    },
    agentStatusStore: status.store,
    dispatchQueueStore: items.store,
    getOpenRouterSource: () => null,
    getDeployInfo: () => ({}),
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/workspace/acme/api/live-console/events${query}`);
    return { httpStatus: res.status, ownerCheck: ownerCheck.calls.check, tokenRows: proxy.calls.listTokens + queue.calls.listTokens, status: status.calls.listStatus, listItems: items.calls.listItems, listHistory: items.calls.listHistory };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

after(() => setRunControlsResolver(null));

describe('the events endpoint: store reads per poll and per "view earlier" page (LIN-3977 finding 8)', () => {
  test('a poll by a non-owner with no stored flag: one owner check, no token rows; 403', async () => {
    const r = await requestEvents({ owner: false, runner: true, features: undefined });
    assert.equal(r.httpStatus, 403);
    assert.equal(r.ownerCheck, 1);
    assert.equal(r.tokenRows, 0, 'a non-owner never reads the token stores');
  });

  test('a poll by an owner with a runner and no stored flag: one owner check and two token reads; 200', async () => {
    const r = await requestEvents({ owner: true, runner: true, features: undefined });
    assert.equal(r.httpStatus, 200);
    assert.equal(r.ownerCheck, 1);
    assert.equal(r.tokenRows, 2, 'the proxy and the queue token lists, once each');
  });

  test('a poll with a stored false still costs the owner check (the gate resolves before it reads the stored flag)', async () => {
    const r = await requestEvents({ owner: true, runner: true, features: { liveConsole: false } });
    assert.equal(r.httpStatus, 403);
    assert.equal(r.ownerCheck, 1);
  });

  test('a live poll reads the status twice (the stream, and the loops\' own match) and the dispatch items once each, per workspace', async () => {
    // The loop read matches each run to its status row inside _fetchWorkspaceData, so the status
    // store is read by both the stream and the loops. The base poll read the loops too (readLoops),
    // so this is the same as base; the owner gate adds only the reads in the tests above.
    const r = await requestEvents({ owner: true, runner: true, features: { liveConsole: true } });
    assert.equal(r.httpStatus, 200);
    assert.equal(r.status, 2);
    assert.equal(r.listItems, 1);
    assert.equal(r.listHistory, 1);
  });

  test('a "view earlier" page reads the loops the fold needs, once per workspace, in addition to the status', async () => {
    const before = Date.now() - 60_000;
    const r = await requestEvents({ owner: true, runner: true, features: { liveConsole: true }, query: `?before=${before}&limit=40` });
    assert.equal(r.httpStatus, 200);
    assert.equal(r.status, 2, 'the history status page, and the loops\' own match');
    assert.equal(r.listItems, 1, 'the loops the fold needs: live items (base read none on this path)');
    assert.equal(r.listHistory, 1, 'and the history items');
  });
});
