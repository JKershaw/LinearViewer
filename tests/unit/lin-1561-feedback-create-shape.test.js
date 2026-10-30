// =============================================================================
// LIN-1561 — feedback intake reports a created ticket as created on every provider
// =============================================================================
//
// POST /workspace/:urlKey/api/feedback used to count a create as failed unless the
// provider returned `{ success, issue }`. Only Linear returns that envelope; the
// local and GitHub providers return the bare canonical issue, so a ticket that
// was filed was answered 502 and a retry filed a duplicate.
//
// These drive the REAL route against the REAL local and GitHub providers (the
// GitHub one over its in-memory fake client, so no network). The fake-provider
// tests in feedback-route.test.js always returned the envelope, which is why the
// shape mismatch never showed up there.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createWorkspaceApiRoutes } from '../../routes/workspace-api.js';
import { registerProvider } from '../../lib/providers/registry.js';
import { LocalProvider } from '../../lib/providers/local/index.js';
import { GitHubProvider } from '../../lib/providers/github/index.js';
import { createFakeGitHubClient } from '../../lib/providers/github/fake-client.js';
import { createLocalStore } from '../fixtures/local-harness.js';

// feedbackSubmitLimiter skips only under NODE_ENV=test; this file posts the route
// more than its 5-per-window budget.
process.env.NODE_ENV = 'test';

const REPO = 'octocat/feedback-target';
const LOCAL_TOKEN = 'ws-lin-1561-local';
const GITHUB_TOKEN = 'gh-token-lin-1561';

function buildApp({ provider, workspace }) {
  registerProvider(provider);
  const app = express();
  app.use(express.json({ limit: '250kb' }));
  const router = createWorkspaceApiRoutes({
    workspaceOwnerCheck: async () => ({ status: 'owner' }),
    workspaceFromUrl: (req, res, next) => {
      req.workspace = { ...workspace, urlKey: req.params.urlKey };
      req.session = { accountId: 'acct-owner', features: {} };
      next();
    },
    dispatchQueueStore: { addItem: async () => ({}) },
    proxyTokenStore: {},
    freeTierStore: {}, getOpenRouterSource: () => null, userPreferencesStore: {},
    accountStore: null,
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
    customPromptsStore: {}, recapCacheStore: {},
    briefCacheStore: {}, reportHistoryStore: {}, agentStatusStore: {}, promptTraceStore: {}
  });
  app.use(router);
  return app;
}

async function submit(app, urlKey, payload) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/workspace/${urlKey}/api/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(payload)
    });
    let body = {};
    try { body = await res.json(); } catch (_) { /* ignore */ }
    return { status: res.status, body };
  } finally {
    await new Promise(r => server.close(r));
  }
}

// A real LocalProvider over an in-memory store, with the workspace token it is
// partitioned by.
function localFixture() {
  const { store } = createLocalStore();
  const provider = new LocalProvider({ store });
  const workspace = { id: 'ws-local', urlKey: 'local-key', provider: 'local', accessToken: LOCAL_TOKEN };
  return { provider, workspace };
}

// A real GitHubProvider over the in-memory fake client (no network). A legacy
// GitHub workspace's binding scope is its workspace id, which is the repo slug;
// the request-time client comes from clientFactory, so the fake is injected there.
function githubFixture() {
  const client = createFakeGitHubClient({ [REPO]: { milestones: [], labels: [], issues: [] } });
  const provider = new GitHubProvider({ clientFactory: () => client });
  const workspace = { id: REPO, urlKey: 'github-key', provider: 'github', accessToken: GITHUB_TOKEN };
  return { provider, workspace, client };
}

const FEEDBACK = { message: 'The widget filed this', title: 'Widget feedback LIN-1561', teamId: 'team-1' };

describe('feedback submit: a created ticket is reported as created (LIN-1561)', () => {
  test('local workspace: the bare issue the provider returns is a success with the new ticket', async () => {
    const { provider, workspace } = localFixture();
    const app = buildApp({ provider, workspace });

    const { status, body } = await submit(app, workspace.urlKey, FEEDBACK);

    assert.equal(status, 201, `expected 201, got ${status}: ${JSON.stringify(body)}`);
    assert.equal(body.success, true);
    assert.equal(body.issue.title, FEEDBACK.title);
    assert.ok(body.issue.identifier, 'the created ticket carries its identifier');
  });

  test('GitHub workspace: the bare issue the provider returns is a success with the new ticket', async () => {
    const { provider, workspace, client } = githubFixture();
    const app = buildApp({ provider, workspace });

    const { status, body } = await submit(app, workspace.urlKey, FEEDBACK);

    assert.equal(status, 201, `expected 201, got ${status}: ${JSON.stringify(body)}`);
    assert.equal(body.success, true);
    assert.equal(body.issue.title, FEEDBACK.title);
    const filed = await client.listIssues(REPO);
    assert.ok(filed.some(gh => gh.title === FEEDBACK.title), 'the ticket really exists on the repo');
  });

  test('a create the provider rejects (null) still returns 502, not success', async () => {
    const { provider, workspace } = localFixture();
    provider.createIssue = async () => null;
    const app = buildApp({ provider, workspace });

    const { status, body } = await submit(app, workspace.urlKey, FEEDBACK);

    assert.equal(status, 502);
    assert.equal(body.error, 'Failed to create feedback ticket');
  });

  test('a Linear-shaped rejection ({ success: false }) still returns 502', async () => {
    const { provider, workspace } = githubFixture();
    provider.createIssue = async () => ({ success: false, issue: null });
    const app = buildApp({ provider, workspace });

    const { status, body } = await submit(app, workspace.urlKey, FEEDBACK);

    assert.equal(status, 502);
    assert.equal(body.error, 'Failed to create feedback ticket');
  });
});
