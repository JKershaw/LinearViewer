/**
 * LIN-3436 (H0 of LIN-3358) — the `ifParked` abort contract, the consumer
 * capability header, and the delivery gate.
 *
 *  - `ifParked` is a boolean valid only with `abort:true`; 400 with `force` or
 *    `cascade` (validator, proxy route, session route);
 *  - both poll routes read `X-Harbour-Consumer-Caps`, record the workspace's
 *    last advertised caps, and `pollAvailable(urlKey, { caps })` omits
 *    `ifParked` rows unless the poller advertised `if-parked`;
 *  - the enqueue helper writes `abort:true, ifParked:true` only when the
 *    workspace's consumer advertised.
 */
process.env.NODE_ENV = 'test';

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { validateDispatchPayload } from '../../lib/dispatch-validation.js';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import {
  parseConsumerCaps, recordConsumerCaps, getConsumerCaps, workspaceConsumerAdvertises, _resetConsumerCapsForTests
} from '../../lib/consumer-caps.js';
import { enqueueIfParkedAbort } from '../../lib/ticket-close-abort.js';
import { createDispatchRoutes } from '../../routes/dispatch.js';
import { ACME, buildApp, call } from './lib/proxy-fake-deps.js';
import { createMockCollection } from '../fixtures/mock-collection.js';

const TARGET = '11111111-1111-4111-8111-111111111111';

function makeStore() {
  return new DispatchQueueStore({ collection: createMockCollection(), historyCollection: createMockCollection() });
}

beforeEach(() => _resetConsumerCapsForTests());

describe('LIN-3436 — validateDispatchPayload: the ifParked matrix', () => {
  const base = { abort: true, abortTo: TARGET };

  test('ifParked with abort is valid', () => {
    assert.equal(validateDispatchPayload({ ...base, ifParked: true }), null);
    assert.equal(validateDispatchPayload({ ...base, ifParked: false }), null);
    assert.equal(validateDispatchPayload({ ...base }), null);
  });

  test('ifParked alone (no abort) is a 400', () => {
    assert.deepEqual(validateDispatchPayload({ prompt: 'x', ifParked: true }), { error: 'ifParked requires abort to be true' });
  });

  test('ifParked with force is a 400 (a force would defeat the guard)', () => {
    assert.deepEqual(validateDispatchPayload({ ...base, ifParked: true, force: true }), { error: 'ifParked and force are mutually exclusive' });
  });

  test('ifParked with cascade is a 400', () => {
    assert.deepEqual(validateDispatchPayload({ ...base, ifParked: true, cascade: true }), { error: 'ifParked and cascade are mutually exclusive' });
  });

  test('ifParked must be a boolean', () => {
    for (const bad of ['true', 1, {}, null]) {
      assert.deepEqual(validateDispatchPayload({ ...base, ifParked: bad }), { error: 'ifParked must be a boolean' }, String(bad));
    }
  });
});

describe('LIN-3436 — consumer caps parsing and the per-workspace record', () => {
  test('parseConsumerCaps: tokens are trimmed, lowercased, de-duplicated; junk dropped', () => {
    assert.deepEqual(parseConsumerCaps(' If-Parked, if-parked ,x-y'), ['if-parked', 'x-y']);
    assert.deepEqual(parseConsumerCaps(undefined), []);
    assert.deepEqual(parseConsumerCaps(''), []);
    assert.deepEqual(parseConsumerCaps('bad token,$$,'), []);
    assert.deepEqual(parseConsumerCaps(['if-parked', 'b']), ['if-parked', 'b']);
  });

  test('workspaceConsumerAdvertises: unknown ⇒ false; last poller wins, an empty advertisement clears', () => {
    assert.equal(workspaceConsumerAdvertises('acme'), false);
    recordConsumerCaps('acme', ['if-parked']);
    assert.equal(workspaceConsumerAdvertises('acme'), true);
    assert.equal(workspaceConsumerAdvertises('other'), false, 'per workspace');
    recordConsumerCaps('acme', []);
    assert.equal(workspaceConsumerAdvertises('acme'), false, 'an old consumer taking over clears the claim');
    assert.deepEqual(getConsumerCaps('acme').caps, []);
  });
});

describe('LIN-3436 — the store: ifParked persists, is delivered, and is gated at delivery', () => {
  test('addItem persists ifParked and the poll formatter carries it', async () => {
    const store = makeStore();
    const doc = await store.addItem('acme', { abort: true, abortTo: TARGET, ifParked: true });
    assert.equal(doc.ifParked, true);
    const [item] = await store.pollAvailable('acme', { caps: ['if-parked'] });
    assert.equal(item.ifParked, true);
  });

  test('the flag survives the take → archive hop and the history formatter', async () => {
    const store = makeStore();
    const doc = await store.addItem('acme', { abort: true, abortTo: TARGET, ifParked: true });
    await store.takeItem(doc._id, 'acme');
    const { items } = await store.listHistory('acme');
    assert.equal(items.find(i => i.id === doc._id).ifParked, true);
  });

  test('a plain abort and a normal dispatch carry no ifParked key at all (sparse: existing key sets are unchanged)', async () => {
    const store = makeStore();
    await store.addItem('acme', { abort: true, abortTo: TARGET });
    await store.addItem('acme', { prompt: 'p' });
    const items = await store.pollAvailable('acme', { caps: [] });
    assert.equal(items.length, 2);
    assert.ok(items.every(i => !('ifParked' in i)));
  });

  test('pollAvailable omits ifParked rows unless the poller advertised if-parked; other rows are untouched', async () => {
    const store = makeStore();
    await store.addItem('acme', { abort: true, abortTo: TARGET, ifParked: true });
    await store.addItem('acme', { abort: true, abortTo: TARGET });
    await store.addItem('acme', { prompt: 'p' });
    assert.equal((await store.pollAvailable('acme')).length, 2, 'no options');
    assert.equal((await store.pollAvailable('acme', { caps: [] })).length, 2);
    assert.equal((await store.pollAvailable('acme', { caps: ['something-else'] })).length, 2);
    assert.equal((await store.pollAvailable('acme', { caps: ['if-parked'] })).length, 3);
  });

  test('a row queued before a consumer swap is withheld from the new, non-advertising consumer', async () => {
    const store = makeStore();
    await store.addItem('acme', { abort: true, abortTo: TARGET, ifParked: true });
    assert.equal((await store.pollAvailable('acme', { caps: ['if-parked'] })).length, 1, 'advertising consumer sees it');
    assert.equal((await store.pollAvailable('acme', { caps: [] })).length, 0, 'plain-abort consumer does not');
    assert.equal((await store.pollAvailable('acme', { caps: ['if-parked'] })).length, 1, 'the row was withheld, not dropped');
  });
});

describe('LIN-3436 — GET /api/dispatch/poll reads X-Harbour-Consumer-Caps', () => {
  function dispatchApp(store) {
    const app = express();
    app.use(express.json());
    app.use(createDispatchRoutes({
      dispatchQueueStore: store,
      dispatchTokenStore: { validateToken: async (t) => (t === 'good' ? { urlKey: 'acme', label: 'sd', createdBy: 'a' } : null) },
      workspaceFromUrl: (req, res, next) => next(),
      userPreferencesStore: {},
      workspaceHaltStore: null
    }));
    return app;
  }
  async function poll(app, headers = {}) {
    const server = app.listen(0, '127.0.0.1');
    await new Promise(r => server.once('listening', r));
    try {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/api/dispatch/poll`, { headers: { Authorization: 'Bearer good', ...headers } });
      return { status: res.status, body: await res.json() };
    } finally {
      server.closeAllConnections();
      await new Promise(r => server.close(r));
    }
  }

  test('no header ⇒ ifParked rows omitted and the workspace record is empty; header ⇒ served and recorded', async () => {
    const store = makeStore();
    await store.addItem('acme', { abort: true, abortTo: TARGET, ifParked: true });
    const app = dispatchApp(store);

    let res = await poll(app);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.items, []);
    assert.equal(workspaceConsumerAdvertises('acme'), false);

    res = await poll(app, { 'X-Harbour-Consumer-Caps': 'if-parked' });
    assert.equal(res.body.items.length, 1);
    assert.equal(res.body.items[0].ifParked, true);
    assert.equal(workspaceConsumerAdvertises('acme'), true);

    res = await poll(app);
    assert.deepEqual(res.body.items, [], 'a later non-advertising poller is gated again');
    assert.equal(workspaceConsumerAdvertises('acme'), false, 'and its poll clears the claim');
  });
});

describe('LIN-3436 — the runner poll route and POST /api/proxy/dispatch', () => {
  const runnerToken = { tokenId: 't1', urlKey: ACME, label: 'runner', scope: 'readWrite', createdBy: 'u1', grants: ['take', 'dispatch'], workspaceId: 'ws-acme' };
  function proxyApp() {
    const store = makeStore();
    const app = buildApp({
      proxyTokenStore: { validateToken: async () => runnerToken, listTokens: async () => [], describeRejectionCause: async () => null },
      dispatchQueueStore: store,
      workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) }
    });
    return { app, store };
  }

  test('contract: ifParked + abort is accepted and echoed; without abort, with force, with cascade ⇒ 400', async () => {
    const { app } = proxyApp();
    const ok = await call(app, 'post', '/api/proxy/dispatch', { body: { abort: true, abortTo: TARGET, ifParked: true } });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.equal(ok.body.ifParked, true);

    for (const [name, body, msg] of [
      ['no abort', { prompt: 'x', ifParked: true }, 'ifParked requires abort to be true'],
      ['force', { abort: true, abortTo: TARGET, ifParked: true, force: true }, 'ifParked and force are mutually exclusive'],
      ['cascade', { abort: true, abortTo: TARGET, ifParked: true, cascade: true }, 'ifParked and cascade are mutually exclusive'],
      ['non-boolean', { abort: true, abortTo: TARGET, ifParked: 'yes' }, 'ifParked must be a boolean']
    ]) {
      const res = await call(app, 'post', '/api/proxy/dispatch', { body });
      assert.equal(res.status, 400, `${name}: ${JSON.stringify(res.body)}`);
      assert.match(JSON.stringify(res.body), new RegExp(msg), name);
    }
  });

  test('the runner poll serves an ifParked row only with the if-parked header, and records the caps', async () => {
    const { app } = proxyApp();
    await call(app, 'post', '/api/proxy/dispatch', { body: { abort: true, abortTo: TARGET, ifParked: true } });

    const bare = await call(app, 'get', '/api/proxy/runner/poll');
    assert.equal(bare.status, 200);
    assert.deepEqual(bare.body.items, []);
    assert.equal(workspaceConsumerAdvertises(ACME), false);

    const withCaps = await call(app, 'get', '/api/proxy/runner/poll', { headers: { 'X-Harbour-Consumer-Caps': 'if-parked' } });
    assert.equal(withCaps.body.items.length, 1);
    assert.equal(withCaps.body.items[0].ifParked, true);
    assert.equal(withCaps.body.items[0].abort, true);
    assert.equal(workspaceConsumerAdvertises(ACME), true);
  });
});

describe('LIN-3436 — enqueueIfParkedAbort', () => {
  test('refuses (writes nothing) when the workspace consumer has not advertised if-parked', async () => {
    const store = makeStore();
    const r = await enqueueIfParkedAbort({ store, urlKey: 'acme', abortTo: TARGET });
    assert.deepEqual(r, { enqueued: false, reason: 'consumer-not-advertised' });
    assert.equal(await store.countItems('acme'), 0);
  });

  test('enqueues abort:true + ifParked:true once the consumer advertised, and only that consumer is served it', async () => {
    const store = makeStore();
    recordConsumerCaps('acme', ['if-parked']);
    const r = await enqueueIfParkedAbort({ store, urlKey: 'acme', abortTo: TARGET, issueIdentifier: 'LIN-1', target: 'cli' });
    assert.equal(r.enqueued, true);
    assert.equal(r.item.abort, true);
    assert.equal(r.item.ifParked, true);
    assert.equal(r.item.abortTo, TARGET);
    assert.equal(r.item.force, false);
    assert.equal(r.item.cascade, false);
    assert.equal((await store.pollAvailable('acme', { caps: [] })).length, 0);
    assert.equal((await store.pollAvailable('acme', { caps: ['if-parked'] })).length, 1);
  });

  test('a missing target is refused', async () => {
    recordConsumerCaps('acme', ['if-parked']);
    assert.deepEqual(await enqueueIfParkedAbort({ store: makeStore(), urlKey: 'acme', abortTo: null }), { enqueued: false, reason: 'missing-target' });
  });
});
