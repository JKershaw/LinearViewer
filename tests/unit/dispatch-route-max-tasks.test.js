/**
 * LIN-1737 Beat 1, seam #5 — route-level: the user-facing
 * POST /workspace/:urlKey/api/dispatch accepts an optional `maxTasks`,
 * validates it inline (integer >= 1, matching routes/proxy.js's kickoff-seam
 * rule and error text exactly — LIN-1737 D3), and threads it into the fields
 * block the shared dispatch factory persists via addItem. Absent/null must
 * stay byte-identical to pre-LIN-1737 behavior (LIN-1751 already defined the
 * stored field; this pins the NEW validating entry point).
 *
 * Mirrors the buildApp/call scaffolding in dispatch-route-presets.test.js.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createDispatchRoutes } from '../../routes/dispatch.js';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { createMockCollection } from '../fixtures/mock-collection.js';

function buildApp(captured) {
  const app = express();
  app.use(express.json());
  app.use(createDispatchRoutes({
    // LIN-3383: owner-only runner enqueue — this fixture acts as the workspace owner.
    workspaceOwnerCheck: async () => ({ status: 'owner' }),
    dispatchQueueStore: {
      addItem: async (urlKey, item) => {
        captured.item = item;
        return { _id: 'disp-1', dispatchedAt: '2026-08-01T00:00:00.000Z', ...item };
      }
    },
    dispatchTokenStore: {},
    workspaceFromUrl: (req, res, next) => {
      req.workspace = { urlKey: req.params.urlKey };
      req.session = { accountId: 'u1', linearUserId: 'u1' };
      next();
    },
    userPreferencesStore: {},
    harbourFeedbackTokenStore: null,
    workspacePreferencesStore: undefined,
    dispatchPresetsStore: undefined
  }));
  return app;
}

// LIN-2934 R4/M10: the addItem-only `buildApp` above never wires
// `countDistinctTasksForSession`/`getItemStatus`, so the dispatch-factory
// budget guard fail-opens (skips) by construction — every test above proves
// validation/persistence, never that the guard actually enforces or that the
// 201 echoes `budgetPosition` end to end. This variant wires a REAL
// DispatchQueueStore so the guard runs for real.
function buildRealApp(store) {
  const app = express();
  app.use(express.json());
  app.use(createDispatchRoutes({
    // LIN-3383: owner-only runner enqueue — this fixture acts as the workspace owner.
    workspaceOwnerCheck: async () => ({ status: 'owner' }),
    dispatchQueueStore: store,
    dispatchTokenStore: {},
    workspaceFromUrl: (req, res, next) => {
      req.workspace = { urlKey: req.params.urlKey };
      req.session = { accountId: 'u1', linearUserId: 'u1' };
      next();
    },
    userPreferencesStore: {},
    harbourFeedbackTokenStore: null,
    workspacePreferencesStore: undefined,
    dispatchPresetsStore: undefined
  }));
  return app;
}

async function call(app, method, path, body) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const opts = { method: method.toUpperCase(), headers: {} };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(`http://127.0.0.1:${port}${path}`, opts);
    const text = await res.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

const PATH = '/workspace/acme/api/dispatch';

describe('LIN-1737 Beat 1 — POST /workspace/:urlKey/api/dispatch maxTasks', () => {
  test('no maxTasks at all: byte-identical to pre-LIN-1737 (defaults to null)', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', PATH, { prompt: 'run me', kind: 'implementation' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.strictEqual(captured.item.maxTasks, null);
  });

  test('a valid maxTasks is persisted onto the fields block', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', PATH, { prompt: 'run me', kind: 'autopilot', maxTasks: 25 });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.strictEqual(captured.item.maxTasks, 25);
  });

  test('maxTasks: 0 is rejected 400 with the exact routes/proxy.js error text', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', PATH, { prompt: 'run me', kind: 'autopilot', maxTasks: 0 });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'maxTasks must be an integer >= 1');
  });

  test('a negative maxTasks is rejected 400', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', PATH, { prompt: 'run me', kind: 'autopilot', maxTasks: -3 });
    assert.equal(res.status, 400);
  });

  test('a non-integer maxTasks is rejected 400', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', PATH, { prompt: 'run me', kind: 'autopilot', maxTasks: 5.5 });
    assert.equal(res.status, 400);
  });

  test('a string maxTasks is rejected 400 (no coercion — must be a real integer)', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', PATH, { prompt: 'run me', kind: 'autopilot', maxTasks: '10' });
    assert.equal(res.status, 400);
  });

  test('maxTasks: null is explicitly accepted as "no budget"', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', PATH, { prompt: 'run me', kind: 'implementation', maxTasks: null });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.strictEqual(captured.item.maxTasks, null);
  });
});

describe('LIN-3461 — POST /workspace/:urlKey/api/dispatch ignores maxSessionsPerTask', () => {
  test('a caller that still sends maxSessionsPerTask (even an invalid one) gets a normal 201 and nothing is stored or echoed', async () => {
    for (const legacy of [10, 0, 5.5, null]) {
      const captured = {};
      const app = buildApp(captured);
      const res = await call(app, 'post', PATH, { prompt: 'run me', kind: 'autopilot', maxSessionsPerTask: legacy });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.ok(!('maxSessionsPerTask' in captured.item));
      assert.ok(!('maxSessionsPerTask' in res.body.item));
    }
  });
});

describe('LIN-3461 — the runaway failsafe, relayed by the session dispatch route', () => {
  async function seedRun() {
    const store = new DispatchQueueStore({ collection: createMockCollection(), historyCollection: createMockCollection() });
    const app = buildRealApp(store);
    const kickoff = await call(app, 'post', PATH, { prompt: 'launch the runner', kind: 'custom', target: 'cli' });
    assert.equal(kickoff.status, 201, JSON.stringify(kickoff.body));
    const sessionId = kickoff.body.item.id;
    for (let i = 0; i < 30; i++) {
      await store.addItem('acme', { prompt: `worker ${i}`, kind: 'implementation', issueIdentifier: 'LIN-1', sessionId });
    }
    return { app, sessionId };
  }

  test('the 31st fresh session to one task is refused 409 TASK_SESSION_RUNAWAY (not BUDGET_EXHAUSTED), even with force: true', async () => {
    const { app, sessionId } = await seedRun();

    const refused = await call(app, 'post', PATH, {
      prompt: 'one more', kind: 'implementation', issueIdentifier: 'LIN-1', target: 'cli', sessionId, force: true
    });
    assert.equal(refused.status, 409, JSON.stringify(refused.body));
    assert.equal(refused.body.code, 'TASK_SESSION_RUNAWAY');
    assert.equal(refused.body.limit, 30);
    assert.equal(refused.body.taskDispatches, 30);
    assert.match(refused.body.error, /30 fresh sessions in this run/);
  });

  test('a different task in the same run is still admitted, and no budgetPosition appears without maxTasks', async () => {
    const { app, sessionId } = await seedRun();

    const other = await call(app, 'post', PATH, {
      prompt: 'other task', kind: 'implementation', issueIdentifier: 'LIN-2', target: 'cli', sessionId
    });
    assert.equal(other.status, 201, JSON.stringify(other.body));
    assert.ok(!('budgetPosition' in other.body.item));
  });
});
