/**
 * LIN-2033 F1 — `GET /api/proxy/teams` must surface a `truncated` flag so an
 * agent-facing caller can tell a capped team/project listing (e.g. Jira's
 * 500-project `listAllProjects()` walk) apart from a genuine empty/short
 * list, instead of a later `requireTeamMembership` failure reporting
 * truncation as "no team matches" (LIN-2006's failure class).
 *
 * `fetchTeams()` re-stamps `truncated` on the array it returns (mirroring
 * `listAllProjects()`'s own convention) rather than changing its return
 * shape, since every provider's `fetchTeams()` — and every caller
 * (matchTeamId/requireTeamMembership, resolveTeamRef, task-create.js's
 * option-list loader, …) — treats the result as a bare array. This test
 * drives the REAL route with a stub provider to prove the flag reaches the
 * HTTP response, not just the provider layer (covered separately in
 * tests/unit/jira-provider.test.js).
 *
 * Run with: node --test tests/unit/proxy-teams-truncated.test.js
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';

const PROVIDER_NAME = 'teams-truncated-stub';

function makeStubProvider(teams) {
  return {
    name: PROVIDER_NAME,
    supports: (cap) => cap === 'fetchTeams',
    async fetchTeams() { return teams; },
  };
}

function buildApp(provider) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    provider,
    proxyTokenStore: {
      validateToken: async () => ({
        tokenId: 't1', urlKey: 'acme', label: 'test', scope: 'read', createdBy: 'u1',
      }),
    },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({ token: 'ws-token', reason: 'ok', provider: PROVIDER_NAME }),
    getWorkspaceAccessToken: async () => 'ws-token',
    agentStatusStore: {},
    recapCacheStore: {},
    briefCacheStore: {},
    dispatchQueueStore: {},
    workspaceFromUrl: (req, res, next) => next(),
    getWorkspaceOpenRouterKey: async () => null,
    workspacePreferencesStore: {},
    freeTierStore: { tryUse: async () => ({ allowed: true }) },
  }));
  return app;
}

async function call(app, path) {
  const server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      headers: { Authorization: 'Bearer anything' },
    });
    return { status: res.status, body: await res.json() };
  } finally {
    await new Promise(r => server.close(r));
  }
}

describe('GET /api/proxy/teams truncated flag (LIN-2033 F1)', () => {
  test('reports truncated: false for an ordinary, untruncated team list', async () => {
    const teams = [{ id: 'ENG', name: 'Engineering', key: 'ENG' }];
    const { status, body } = await call(buildApp(makeStubProvider(teams)), '/api/proxy/teams');
    assert.equal(status, 200);
    assert.deepEqual(body.teams, teams);
    assert.equal(body.truncated, false, 'no .truncated on the provider array must coerce to false, not be omitted/undefined');
  });

  test('surfaces truncated: true when the provider array was capped', async () => {
    const teams = [{ id: 'ENG', name: 'Engineering', key: 'ENG' }];
    teams.truncated = true;
    const { status, body } = await call(buildApp(makeStubProvider(teams)), '/api/proxy/teams');
    assert.equal(status, 200);
    assert.deepEqual(body.teams, Array.from(teams), 'the team entries themselves are unaffected by reading the flag');
    assert.equal(body.truncated, true, 'the .truncated flag stamped on the provider array must reach the JSON response as its own field');
  });
});
