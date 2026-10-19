/**
 * LIN-3688: POST /workspace/:urlKey/api/roadmap/generate resolves the body's
 * `team` against the workspace's team list (`matchTeamId`, LIN-2025) and must
 * hand the RESOLVED id to `provider.fetchProjects`, never the raw body value.
 * Same blind spot as fetchAndPrepareProjects (lin-3688-fetch-and-prepare-
 * projects-matched-team-id.test.js) and the roadmap page route (LIN-3683,
 * lin-2522-roadmap-unconditional-teams-fetch.test.js); this closes the third
 * call site.
 *
 * The distinguishing precondition is a raw `team` that is NOT in the team list:
 * the real matchTeamId turns it into null, so a regression passing the raw
 * value through is visible ('Nonexistent' vs null). A raw ref that matches
 * returns the same id, so it cannot tell the two apart on its own; it is kept
 * as the control that a real team still reaches fetchProjects.
 *
 * No production change: the route resolves its provider through the public
 * registry (`registerProvider`), so the test registers a fake provider under a
 * unique name and points the workspace at it. The workspace is not
 * `test-token`/`local`, so shouldMockAi is false and the real fetch branch runs.
 * fetchProjects records its arguments and then throws, so the handler returns
 * its 500 before any OpenRouter call is made.
 *
 * Run with: node --test tests/unit/lin-3688-roadmap-generate-matched-team-id.test.js
 */
process.env.NODE_ENV = 'test';

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createRoadmapRoutes } from '../../routes/workspace-api-roadmap.js';
import { registerProvider } from '../../lib/providers/registry.js';

const URL_KEY = 'acme';
const PROVIDER_NAME = 'lin-3688-fake-provider';

let fetchProjectsCalls;
let originalConsoleError;

beforeEach(() => {
  fetchProjectsCalls = [];
  originalConsoleError = console.error;
  console.error = () => {}; // the sentinel throw below is logged by the route
  registerProvider({
    name: PROVIDER_NAME,
    fetchTeams: async () => [{ id: 't1', name: 'Engineering' }],
    fetchProjects: async (scope, teamId) => {
      fetchProjectsCalls.push({ teamId });
      throw new Error('stop before the LLM layers');
    }
  });
});

afterEach(() => {
  console.error = originalConsoleError;
});

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = { features: { roadmap: true }, openRouterApiKey: 'sk-or-lin-3688' };
    req.workspace = { urlKey: URL_KEY, provider: PROVIDER_NAME };
    next();
  });
  app.use(createRoadmapRoutes({
    workspaceFromUrl: (req, res, next) => next(),
    freeTierStore: {},
    userPreferencesStore: {},
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
    reportHistoryStore: {}
  }));
  return app;
}

async function generate(body) {
  const server = buildApp().listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/workspace/${URL_KEY}/api/roadmap/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return { status: res.status, body: await res.json() };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

describe('POST /workspace/:urlKey/api/roadmap/generate — fetchProjects gets the matched team id (LIN-3688)', () => {
  test('a team ref not in the workspace team list reaches fetchProjects as null, not the raw ref', async () => {
    const res = await generate({ team: 'Nonexistent' });

    assert.equal(res.status, 500, 'the fetch branch ran and the sentinel error surfaced as the 500');
    assert.deepEqual(fetchProjectsCalls, [{ teamId: null }]);
  });

  test('a team ref in the team list reaches fetchProjects as its id', async () => {
    const res = await generate({ team: 't1' });

    assert.equal(res.status, 500);
    assert.deepEqual(fetchProjectsCalls, [{ teamId: 't1' }]);
  });
});
