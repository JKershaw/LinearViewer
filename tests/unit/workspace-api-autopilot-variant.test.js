/**
 * LIN-836 — surfacing the stepper Autopilot variant on the UI-facing
 * `autopilot-prompt` endpoints (the seam the dashboard / swipe / dispatch-page
 * buttons fetch from). LIN-791 wired `variant` into the engine and the proxy
 * POST verb; this proves the two GET endpoints in routes/workspace-api.js now:
 *   - accept `?variant=stepper` and swap the stepper disposition into the body,
 *   - relabel ONLY the stepper branch (label / promptName / download filename),
 *   - keep the standard response BYTE-IDENTICAL when variant is absent OR
 *     unrecognized (the LIN-791 additive invariant),
 *   - never change the dispatch contract (kind stays 'autopilot').
 *
 * The endpoints run their test-token mock branch, so no provider is needed.
 */

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createWorkspaceApiRoutes } from '../../routes/workspace-api.js';
import { testMockData } from '../fixtures/mock-data.js';

before(() => { process.env.NODE_ENV = 'test'; });

const MOCK_ISSUE = testMockData.issues[0]; // id 'issue-1', identifier 'TEST-1'
const MOCK_IDENTIFIER = MOCK_ISSUE.url.split('/').pop();

/** Mount the workspace-api router with a proxy-enabled, test-token session. */
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(createWorkspaceApiRoutes({
    // workspaceFromUrl establishes the proxy-enabled test session + test-token
    // workspace, which routes the endpoint down its mock-data branch.
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

/**
 * Run `fn` against a single live server, so multiple requests share one base
 * URL. The kickoff body embeds `${baseUrl}` (host:port), so byte-identical
 * comparisons MUST hit the same listener — a fresh port per request would
 * diff only on the port and mask a real regression.
 */
async function withServer(app, fn) {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  const get = async (path) => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`);
    const ct = res.headers.get('content-type') || '';
    return {
      status: res.status,
      headers: res.headers,
      body: ct.includes('json') ? await res.json() : await res.text(),
    };
  };
  try {
    return await fn(get);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

const request = (app, path) => withServer(app, get => get(path));

// ---------------------------------------------------------------------------
// Issue-scoped endpoint: GET /workspace/:urlKey/api/autopilot-prompt/:issueId
// ---------------------------------------------------------------------------

test('issue-scoped: no variant → standard label/name, no stepper disposition', async () => {
  const app = buildApp();
  const { status, body } = await request(app, `/workspace/test-workspace/api/autopilot-prompt/${MOCK_ISSUE.id}`);
  assert.equal(status, 200);
  assert.equal(body.label, 'autopilot');
  assert.equal(body.promptName, `Autopilot — ${MOCK_IDENTIFIER}`);
  assert.equal(body.kind, 'autopilot');
  assert.doesNotMatch(body.prompt, /STEPPER/);
});

test('issue-scoped: ?variant=stepper → stepper label/name + disposition, kind unchanged', async () => {
  const app = buildApp();
  const { status, body } = await request(app, `/workspace/test-workspace/api/autopilot-prompt/${MOCK_ISSUE.id}?variant=stepper`);
  assert.equal(status, 200);
  assert.equal(body.label, 'autopilot-stepper');
  assert.equal(body.promptName, `Autopilot (stepped) — ${MOCK_IDENTIFIER}`);
  // Dispatch contract is unchanged — still the autopilot meta-loop.
  assert.equal(body.kind, 'autopilot');
  assert.match(body.prompt, /STEPPER/);
});

test('issue-scoped: an unrecognized variant falls back to a byte-identical standard response', async () => {
  await withServer(buildApp(), async (get) => {
    const base = await get(`/workspace/test-workspace/api/autopilot-prompt/${MOCK_ISSUE.id}`);
    const bogus = await get(`/workspace/test-workspace/api/autopilot-prompt/${MOCK_ISSUE.id}?variant=sideways`);
    // The whole JSON payload (label, promptName, kind, prompt body, repo) is identical.
    assert.deepEqual(bogus.body, base.body);
  });
});

test('issue-scoped: ?format=md&variant=stepper names the download autopilot-stepper', async () => {
  const app = buildApp();
  const { headers } = await request(app, `/workspace/test-workspace/api/autopilot-prompt/${MOCK_ISSUE.id}?variant=stepper&format=md`);
  assert.match(headers.get('content-disposition') || '', /autopilot-stepper/);
});

test('issue-scoped: ?format=md with no variant keeps the standard download name', async () => {
  const app = buildApp();
  const { headers } = await request(app, `/workspace/test-workspace/api/autopilot-prompt/${MOCK_ISSUE.id}?format=md`);
  const cd = headers.get('content-disposition') || '';
  assert.match(cd, /autopilot/);
  assert.doesNotMatch(cd, /autopilot-stepper/);
});

// ---------------------------------------------------------------------------
// General (stack-walk) endpoint: GET /workspace/:urlKey/api/autopilot-prompt
// ---------------------------------------------------------------------------

test('general: no variant → standard stack-walk label/name', async () => {
  const app = buildApp();
  const { status, body } = await request(app, '/workspace/test-workspace/api/autopilot-prompt');
  assert.equal(status, 200);
  assert.equal(body.label, 'autopilot');
  assert.equal(body.promptName, 'Autopilot (stack walk)');
  assert.doesNotMatch(body.prompt, /STEPPER/);
});

test('general: ?variant=stepper → stepper stack-walk label/name + disposition', async () => {
  const app = buildApp();
  const { status, body } = await request(app, '/workspace/test-workspace/api/autopilot-prompt?variant=stepper');
  assert.equal(status, 200);
  assert.equal(body.label, 'autopilot-stepper');
  assert.equal(body.promptName, 'Autopilot (stepped, stack walk)');
  assert.equal(body.kind, 'autopilot');
  assert.match(body.prompt, /STEPPER/);
});

test('general: a bogus variant is a byte-identical standard stack-walk response', async () => {
  await withServer(buildApp(), async (get) => {
    const base = await get('/workspace/test-workspace/api/autopilot-prompt');
    const bogus = await get('/workspace/test-workspace/api/autopilot-prompt?variant=nope');
    assert.deepEqual(bogus.body, base.body);
  });
});
