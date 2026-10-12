/**
 * LIN-1737 Beat 1, seam #3 — GET /workspace/:urlKey/api/autopilot-prompt (the
 * general, stack-walk kickoff next-run's dial calls through fetchAutopilotKickoff)
 * accepts an optional `?maxTasks=` query param, validates it (integer >= 1, same
 * rule/error text as every other maxTasks entry point — LIN-1737 D3), and forwards
 * it to buildAutopilotKickoff so the kickoff prose states the bound. Query params
 * are always strings, so blank/whitespace must be treated as ABSENT, not an error
 * — the one respect in which this entry point differs from the JSON-body ones.
 *
 * Scaffolding mirrors tests/unit/workspace-api-autopilot-variant.test.js.
 */

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createWorkspaceApiRoutes } from '../../routes/workspace-api.js';

before(() => { process.env.NODE_ENV = 'test'; });

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(createWorkspaceApiRoutes({
    workspaceFromUrl: (req, _res, next) => {
      req.workspace = { accessToken: 'test-token', urlKey: 'test-workspace' };
      req.session = { features: { proxy: true } };
      next();
    },
    freeTierStore: {},
    getOpenRouterSource: () => null,
    userPreferencesStore: {},
    workspacePreferencesStore: {},
    customPromptsStore: {},
    recapCacheStore: {},
    briefCacheStore: {},
    reportHistoryStore: {},
    dispatchQueueStore: {},
    agentStatusStore: {},
    promptTraceStore: {},
    proxyTokenStore: {},
  }));
  return app;
}

async function get(app, path) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`);
    const ct = res.headers.get('content-type') || '';
    return { status: res.status, body: ct.includes('json') ? await res.json() : await res.text() };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

const PATH = '/workspace/test-workspace/api/autopilot-prompt';

test('no maxTasks: byte-identical — no budget statement in the kickoff prose', async () => {
  const { status, body } = await get(buildApp(), PATH);
  assert.equal(status, 200);
  assert.doesNotMatch(body.prompt, /Task budget/);
  assert.doesNotMatch(body.prompt, /distinct.*tasks/);
});

test('?maxTasks=5 states the bound in the kickoff prose', async () => {
  const { status, body } = await get(buildApp(), `${PATH}?maxTasks=5`);
  assert.equal(status, 200);
  assert.match(body.prompt, /up to 5 distinct tasks/);
  assert.match(body.prompt, /Task budget: up to 5 distinct tasks/);
});

test('blank ?maxTasks= is treated as ABSENT, not an error', async () => {
  const { status, body } = await get(buildApp(), `${PATH}?maxTasks=`);
  assert.equal(status, 200);
  assert.doesNotMatch(body.prompt, /Task budget/);
});

test('whitespace-only ?maxTasks= is treated as ABSENT, not an error', async () => {
  const { status, body } = await get(buildApp(), `${PATH}?maxTasks=${encodeURIComponent('   ')}`);
  assert.equal(status, 200);
  assert.doesNotMatch(body.prompt, /Task budget/);
});

test('?maxTasks=0 is rejected 400 with the exact shared error text', async () => {
  const { status, body } = await get(buildApp(), `${PATH}?maxTasks=0`);
  assert.equal(status, 400);
  assert.equal(body.error, 'maxTasks must be an integer >= 1');
});

test('?maxTasks=-1 is rejected 400', async () => {
  const { status } = await get(buildApp(), `${PATH}?maxTasks=-1`);
  assert.equal(status, 400);
});

test('?maxTasks=5.5 (non-integer) is rejected 400', async () => {
  const { status } = await get(buildApp(), `${PATH}?maxTasks=5.5`);
  assert.equal(status, 400);
});

test('?maxTasks=abc (not a number) is rejected 400', async () => {
  const { status } = await get(buildApp(), `${PATH}?maxTasks=abc`);
  assert.equal(status, 400);
});
