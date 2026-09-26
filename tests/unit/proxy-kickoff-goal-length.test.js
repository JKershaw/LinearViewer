/**
 * LIN-2818 — route-level: POST /api/proxy/autopilot/kickoff
 *
 * Two things this file pins at the real route seam:
 *   1. The scoped `goal` cap was raised from the shared opaque-field default
 *      (MAX_NAME_LENGTH, 1000) to the goal-specific MAX_DESCRIPTION_LENGTH
 *      (100000). A goal between the two is now accepted; one past 100000 is
 *      still a 400 naming the new cap and the received length.
 *   2. The original bug: a SCOPED run (issueIdentifier + variant:'stepper' +
 *      a multi-line goal) used to discard the caller's goal from the rendered
 *      prompt entirely. This asserts the opposite at the same observable the
 *      bug was first seen at — the stored prompt, read back via
 *      GET /api/proxy/dispatch/:id/prompt.
 *
 * Mirrors the real-DispatchQueueStore buildApp scaffolding in
 * proxy-kickoff-max-tasks.test.js (not an addItem-only fake) so the dispatched
 * prompt is actually readable back end to end.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
// Same refusal as the sibling kickoff suites: never reach api.linear.app.
import { installHermeticLinearTransport } from '../fixtures/hermetic-linear.js';
installHermeticLinearTransport();
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { createMockCollection } from '../fixtures/mock-collection.js';

const KICKOFF = '/api/proxy/autopilot/kickoff';

function buildApp({ dispatchQueueStore }) {
  const app = express();
  // express.json() default limit is 100kb — the over-limit fixtures below stay
  // ASCII and close to 100001 chars so they reach route validation, not a 413.
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      validateToken: async () => ({ tokenId: 't1', urlKey: 'acme', label: 'test', scope: 'readWrite', createdBy: 'u1' }),
      createToken: async () => ({ token: 'bootstrap-xyz', kind: 'bootstrap', scope: 'readWrite' })
    },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({ token: 'test-token', reason: 'ok' }),
    getWorkspaceAccessToken: async () => 'test-token',
    getWorkspaceOpenRouterKey: async () => null,
    agentStatusStore: {},
    recapCacheStore: { get: async () => null, set: async () => {} },
    briefCacheStore: { get: async () => null, set: async () => {} },
    dispatchQueueStore,
    workspaceFromUrl: (req, res, next) => next(),
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
    freeTierStore: { tryUse: async () => ({ allowed: true }) }
  }));
  return app;
}

async function call(app, method, path, body) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const opts = { method: method.toUpperCase(), headers: { Authorization: 'Bearer anything' } };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(`http://127.0.0.1:${port}${path}`, opts);
    const text = await res.text();
    let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

function makeStore() {
  return new DispatchQueueStore({
    collection: createMockCollection(),
    historyCollection: createMockCollection()
  });
}

describe('LIN-2818 — POST kickoff goal cap (raised to MAX_DESCRIPTION_LENGTH)', () => {
  test('a goal between the old 1000 cap and 100000 is now accepted (was 400)', async () => {
    const app = buildApp({ dispatchQueueStore: makeStore() });
    const res = await call(app, 'post', KICKOFF, { goal: 'x'.repeat(2000), target: 'cli' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
  });

  test('a goal past 100000 is still a 400 naming the new cap and received length', async () => {
    const app = buildApp({ dispatchQueueStore: makeStore() });
    const res = await call(app, 'post', KICKOFF, { goal: 'x'.repeat(100001), target: 'cli' });
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.equal(res.body.error, 'goal exceeds maximum length of 100000 (got 100001)');
  });

  test('the repo cap is untouched at 1000 (shared MAX_NAME_LENGTH, not goal-specific)', async () => {
    const app = buildApp({ dispatchQueueStore: makeStore() });
    const res = await call(app, 'post', KICKOFF, { goal: 'ship it', repo: 'x'.repeat(1001), target: 'cli' });
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.equal(res.body.error, 'repo exceeds maximum length of 1000 (got 1001)');
  });
});

describe('LIN-2818 — scoped kickoff delivers the caller goal (LIN-2730 shape)', () => {
  test('scoped + stepper + multi-line goal → the fetched prompt contains the goal verbatim', async () => {
    const store = makeStore();
    const app = buildApp({ dispatchQueueStore: store });

    const goal = 'first line\nsecond line\n- a bullet';
    const kickoff = await call(app, 'post', KICKOFF, {
      issueIdentifier: 'TEST-1', variant: 'stepper', goal, target: 'cli'
    });
    assert.equal(kickoff.status, 201, JSON.stringify(kickoff.body));

    const fetched = await call(app, 'get', `/api/proxy/dispatch/${kickoff.body.id}/prompt`);
    assert.equal(fetched.status, 200, JSON.stringify(fetched.body));
    assert.ok(fetched.body.prompt.includes('run on autopilot until **TEST-1**'));
    assert.ok(
      fetched.body.prompt.includes('**Additional context from the human:** ' + goal),
      'the goal must reach the agent verbatim, newlines intact'
    );
  });

  test('an omitted goal on a scoped run adds no context line (byte-identical contract)', async () => {
    const store = makeStore();
    const app = buildApp({ dispatchQueueStore: store });

    const kickoff = await call(app, 'post', KICKOFF, { issueIdentifier: 'TEST-1', target: 'cli' });
    assert.equal(kickoff.status, 201, JSON.stringify(kickoff.body));

    const fetched = await call(app, 'get', `/api/proxy/dispatch/${kickoff.body.id}/prompt`);
    assert.equal(fetched.status, 200, JSON.stringify(fetched.body));
    assert.ok(!fetched.body.prompt.includes('**Additional context from the human:**'));
  });
});

describe('LIN-2175 — the documented Planner launch shape is accepted and carries its goal', () => {
  // The exact `goal` template from docs/passage-planner-prompt.md Step 6, with
  // <passage-identifier> substituted by the passage task's own identifier. This
  // is the literal the Planner sends; the test pins it verbatim so the served
  // prompt's precedence-preserving wording can't silently drift.
  const goal = `This is a Passage Runner launch for TEST-1. The instructions in this prompt under "Goal from the human" and "Your first act" that tell you to call \`POST /recommend-and-dispatch\` on TEST-1 do not apply here — ignore them. Instead, your first act is: \`GET /api/proxy/passage-runner/prompt\`, then follow that served prompt in full; it replaces this block's first act. Under it, your job is to fan out one child dispatch per ratified leg to that leg's own anchor tickets — never to work TEST-1 itself — watch them land, and keep the voyage log on TEST-1.`;

  test('standard + write + maxTasks + goal → 201 echoes maxTasks, the dispatch read returns it, and the prompt carries the exact goal', async () => {
    const store = makeStore();
    const app = buildApp({ dispatchQueueStore: store });

    const kickoff = await call(app, 'post', KICKOFF, {
      issueIdentifier: 'TEST-1',
      variant: 'standard',
      mode: 'write',
      target: 'cli',
      maxTasks: 13,
      goal
    });
    assert.equal(kickoff.status, 201, JSON.stringify(kickoff.body));
    assert.equal(kickoff.body.maxTasks, 13, 'the ratified pool must be echoed on the kickoff response');

    // The read the Runner itself makes in Step 4: GET /dispatch/{own id} → maxTasks.
    const read = await call(app, 'get', `/api/proxy/dispatch/${kickoff.body.id}`);
    assert.equal(read.status, 200, JSON.stringify(read.body));
    assert.equal(read.body.maxTasks, 13, 'the dispatch read must return the declared bound');

    const fetched = await call(app, 'get', `/api/proxy/dispatch/${kickoff.body.id}/prompt`);
    assert.equal(fetched.status, 200, JSON.stringify(fetched.body));
    assert.ok(
      fetched.body.prompt.includes('**Additional context from the human:** ' + goal),
      'the exact precedence-preserving goal text must survive into the served prompt verbatim'
    );
  });
});
