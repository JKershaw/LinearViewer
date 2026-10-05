/**
 * LIN-3258 — GET /api/proxy/alarms (composed proxy router).
 *
 * Drives the routes through the REAL composed proxy router
 * (`createProxyRoutes`), using the shared `BASE_DEPS`/`buildApp`/`call`
 * harness — the same discipline as tests/unit/proxy-halt.test.js.
 *
 * The route is READ-ONLY: it must never abort, re-dispatch or message.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ACME, BASE_DEPS, buildApp, call } from './lib/proxy-fake-deps.js';

const PATH = '/api/proxy/alarms';

function makeFakeAlarmStore(rows = []) {
  const calls = [];
  return {
    calls,
    async list(urlKey, opts) {
      calls.push({ urlKey, opts });
      return rows;
    },
    async listOpenWorkspaceKeys() { return []; },
  };
}

function readScopeToken() {
  return {
    ...BASE_DEPS().proxyTokenStore,
    validateToken: async () => ({ tokenId: 't1', urlKey: ACME, label: 'test', scope: 'read', createdBy: 'u1' }),
  };
}

const SAMPLE = {
  _id: 'stopped-or-circular-wait:cycle:a,b',
  urlKey: ACME,
  rule: 'stopped-or-circular-wait',
  shape: 'cycle',
  members: ['a', 'b'],
  dispatchIds: ['a', 'b'],
  tickets: ['LIN-3238'],
  startedAt: new Date('2026-10-02T15:12:57.700Z'),
  firedAt: new Date('2026-10-02T15:20:00.000Z'),
  lastSeenAt: new Date('2026-10-02T15:20:00.000Z'),
  clearedAt: null,
  detail: { edges: [{ from: 'a', to: 'b', kind: 'parent' }] }
};

describe('LIN-3258: GET /api/proxy/alarms (composed router)', () => {
  test('returns an empty, well-formed list by default', async () => {
    const { status, body } = await call(buildApp(), 'GET', PATH);
    assert.equal(status, 200);
    assert.deepEqual(body, { alarms: [], total: 0 });
  });

  test('maps a stored alarm to a public shape with ISO dates and strips _id', async () => {
    const app = buildApp({ livenessAlarmStore: makeFakeAlarmStore([SAMPLE]) });
    const { status, body } = await call(app, 'GET', PATH);
    assert.equal(status, 200);
    assert.equal(body.total, 1);
    const [alarm] = body.alarms;
    assert.equal(alarm.id, SAMPLE._id);
    assert.equal(alarm._id, undefined);
    assert.equal(alarm.rule, 'stopped-or-circular-wait');
    assert.equal(alarm.startedAt, '2026-10-02T15:12:57.700Z');
    assert.equal(alarm.clearedAt, null);
    assert.deepEqual(alarm.tickets, ['LIN-3238']);
  });

  test('passes state and a bounded limit to the store', async () => {
    const store = makeFakeAlarmStore([]);
    const app = buildApp({ livenessAlarmStore: store });
    await call(app, 'GET', `${PATH}?state=all&limit=5`);
    assert.deepEqual(store.calls[0], { urlKey: ACME, opts: { state: 'all', limit: 5 } });

    await call(app, 'GET', `${PATH}?state=bogus`);
    assert.equal(store.calls.length, 1, 'an invalid state is rejected before the store');
  });

  test('an invalid state is a JSON 400 and is logged', async () => {
    const recorded = [];
    const app = buildApp({
      livenessAlarmStore: makeFakeAlarmStore([]),
      proxyEventStore: { ...BASE_DEPS().proxyEventStore, recordEvent: async (e) => { recorded.push(e); } }
    });
    const { status, body } = await call(app, 'GET', `${PATH}?state=nope`);
    assert.equal(status, 400);
    assert.ok(body.error);
    assert.ok(recorded.some((e) => e.endpoint === PATH && e.status === 400));
  });

  test('read scope is enough (like GET /dispatch/halt)', async () => {
    const app = buildApp({ livenessAlarmStore: makeFakeAlarmStore([SAMPLE]), proxyTokenStore: readScopeToken() });
    const { status } = await call(app, 'GET', PATH);
    assert.equal(status, 200);
  });

  test('a store throw is a JSON 500, never 503', async () => {
    const recorded = [];
    const app = buildApp({
      livenessAlarmStore: {
        async list() { throw new Error('boom'); },
        async listOpenWorkspaceKeys() { return []; }
      },
      proxyEventStore: { ...BASE_DEPS().proxyEventStore, recordEvent: async (e) => { recorded.push(e); } }
    });
    const { status, body } = await call(app, 'GET', PATH);
    assert.equal(status, 500);
    assert.ok(body.error);
    assert.ok(recorded.some((e) => e.endpoint === PATH && e.status === 500));
    assert.ok(!recorded.some((e) => e.endpoint === PATH && e.status === 503));
  });

  test('a null livenessAlarmStore is a JSON 500, not a thrown error', async () => {
    const app = buildApp({ livenessAlarmStore: null });
    const { status, body } = await call(app, 'GET', PATH);
    assert.equal(status, 500);
    assert.ok(body.error);
  });

  test('the route is read-only: no POST/PUT/PATCH/DELETE handler is registered', async () => {
    const app = buildApp({ livenessAlarmStore: makeFakeAlarmStore([]) });
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const { status } = await call(app, method, PATH, { body: {} });
      assert.equal(status, 404, `${method} ${PATH} must not be a registered form`);
    }
  });
});
