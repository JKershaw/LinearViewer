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
    dispatchQueueStore: {
      addItem: async (urlKey, item) => {
        captured.item = item;
        return { _id: 'disp-1', dispatchedAt: '2026-08-01T00:00:00.000Z', ...item };
      }
    },
    dispatchTokenStore: {},
    workspaceFromUrl: (req, res, next) => {
      req.workspace = { urlKey: req.params.urlKey };
      req.session = { linearUserId: 'u1' };
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
    dispatchQueueStore: store,
    dispatchTokenStore: {},
    workspaceFromUrl: (req, res, next) => {
      req.workspace = { urlKey: req.params.urlKey };
      req.session = { linearUserId: 'u1' };
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

describe('LIN-2934 — POST /workspace/:urlKey/api/dispatch maxSessionsPerTask', () => {
  test('no maxSessionsPerTask at all: byte-identical (defaults to null)', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', PATH, { prompt: 'run me', kind: 'implementation' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.strictEqual(captured.item.maxSessionsPerTask, null);
    assert.strictEqual(res.body.item.maxSessionsPerTask, null);
  });

  test('a valid maxSessionsPerTask is persisted onto the fields block and echoed on the 201', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', PATH, { prompt: 'run me', kind: 'autopilot', maxSessionsPerTask: 10 });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.strictEqual(captured.item.maxSessionsPerTask, 10);
    assert.strictEqual(res.body.item.maxSessionsPerTask, 10);
  });

  test('maxSessionsPerTask: 0 is rejected 400 with the exact error text', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', PATH, { prompt: 'run me', kind: 'autopilot', maxSessionsPerTask: 0 });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'maxSessionsPerTask must be an integer >= 1');
  });

  test('a non-integer maxSessionsPerTask is rejected 400', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', PATH, { prompt: 'run me', kind: 'autopilot', maxSessionsPerTask: 5.5 });
    assert.equal(res.status, 400);
  });

  test('maxSessionsPerTask: null is explicitly accepted as "no bound"', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', PATH, { prompt: 'run me', kind: 'implementation', maxSessionsPerTask: null });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.strictEqual(captured.item.maxSessionsPerTask, null);
  });

  test('both bounds may be declared together, independently', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', PATH, { prompt: 'run me', kind: 'autopilot', maxTasks: 8, maxSessionsPerTask: 10 });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.strictEqual(captured.item.maxTasks, 8);
    assert.strictEqual(captured.item.maxSessionsPerTask, 10);
  });
});

describe('LIN-2934 R4 — end-to-end: the guard actually runs, and the 201 echoes budgetPosition', () => {
  test('a real store: budgetPosition.sessionsPerTask is echoed on the 201, and a bound-exceeding dispatch is refused (M10)', async () => {
    const store = new DispatchQueueStore({ collection: createMockCollection(), historyCollection: createMockCollection() });
    const app = buildRealApp(store);

    const kickoff = await call(app, 'post', PATH, { prompt: 'launch the runner', kind: 'custom', target: 'cli', maxSessionsPerTask: 1 });
    assert.equal(kickoff.status, 201, JSON.stringify(kickoff.body));
    const sessionId = kickoff.body.item.id;

    const t1 = await call(app, 'post', PATH, {
      prompt: 'work on it', kind: 'implementation', issueIdentifier: 'LIN-1', target: 'cli', sessionId
    });
    assert.equal(t1.status, 201, JSON.stringify(t1.body));
    assert.deepEqual(t1.body.item.budgetPosition.sessionsPerTask, { count: 1, maxSessionsPerTask: 1 });

    const t2 = await call(app, 'post', PATH, {
      prompt: 'review it', kind: 'review', issueIdentifier: 'LIN-1', target: 'cli', sessionId
    });
    assert.equal(t2.status, 409, JSON.stringify(t2.body));
    assert.equal(t2.body.code, 'BUDGET_EXHAUSTED');
    assert.equal(t2.body.bound, 'sessionsPerTask');
  });

  test('force: true does NOT bypass the sessionsPerTask bound — the guard never reads `force` (plan §6)', async () => {
    const store = new DispatchQueueStore({ collection: createMockCollection(), historyCollection: createMockCollection() });
    const app = buildRealApp(store);

    const kickoff = await call(app, 'post', PATH, { prompt: 'launch the runner', kind: 'custom', target: 'cli', maxSessionsPerTask: 1 });
    const sessionId = kickoff.body.item.id;

    const t1 = await call(app, 'post', PATH, {
      prompt: 'work on it', kind: 'implementation', issueIdentifier: 'LIN-1', target: 'cli', sessionId
    });
    assert.equal(t1.status, 201, JSON.stringify(t1.body));

    // The operator escape hatch bypasses the DUPLICATE_DISPATCH guard, but the
    // budget bound is not advisory — a forced dispatch is still refused.
    const forced = await call(app, 'post', PATH, {
      prompt: 'review it', kind: 'review', issueIdentifier: 'LIN-1', target: 'cli', sessionId, force: true
    });
    assert.equal(forced.status, 409, JSON.stringify(forced.body));
    assert.equal(forced.body.code, 'BUDGET_EXHAUSTED');
    assert.equal(forced.body.bound, 'sessionsPerTask');
  });
});
