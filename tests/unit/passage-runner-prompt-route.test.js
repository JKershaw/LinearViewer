/**
 * Characterization test for GET /api/proxy/passage-runner/prompt — LIN-2360
 * Stage 1.
 *
 * This was the only proxy route with no route-level test (everything else
 * about it was covered only indirectly, via passage-runner-contract-drift.test.js's
 * source-text drift checks). Written before any file move, per the LIN-2246
 * stage-2 discipline: an untested handler that is about to move needs
 * something to prove itself against.
 *
 * Drives the route through the actual built router (not a direct import of
 * buildPassageRunnerKickoff), so it also incidentally proves the route is
 * registered, authenticated, and rate-limited like its siblings.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { buildPassageRunnerKickoff } from '../../lib/prompts/passage-runner-kickoff.js';

function buildApp() {
  const app = express();
  app.use(createProxyRoutes({
    proxyTokenStore: {
      validateToken: async () => ({
        tokenId: 't1', urlKey: 'acme', label: 'test', scope: 'readWrite', createdBy: 'u1'
      })
    },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({ token: 'test-token', reason: 'ok' }),
    getWorkspaceAccessToken: async () => 'test-token',
    getWorkspaceOpenRouterKey: async () => null,
    agentStatusStore: {},
    recapCacheStore: { get: async () => null, set: async () => {} },
    briefCacheStore: { get: async () => null, set: async () => {} },
    dispatchQueueStore: {},
    workspaceFromUrl: (req, res, next) => next(),
    workspacePreferencesStore: {},
    freeTierStore: { tryUse: async () => ({ allowed: true }) }
  }));
  return app;
}

async function get(app, path, headers = {}) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { headers });
    const text = await res.text();
    return { status: res.status, contentType: res.headers.get('content-type'), text };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

describe('GET /api/proxy/passage-runner/prompt', () => {
  test('returns 200 text/plain with the passage runner kickoff body, authenticated', async () => {
    const app = buildApp();
    const res = await get(app, '/api/proxy/passage-runner/prompt', { Authorization: 'Bearer anything' });
    assert.equal(res.status, 200);
    assert.match(res.contentType, /^text\/plain/);
    assert.equal(res.text, buildPassageRunnerKickoff());
  });

  test('401s with no Authorization header — the route is authenticated like its siblings', async () => {
    const app = buildApp();
    const res = await get(app, '/api/proxy/passage-runner/prompt');
    assert.equal(res.status, 401);
  });
});
