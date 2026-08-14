/**
 * LIN-1559 — the GitHub-backed proxy write routes actually write.
 *
 * Every write route calls a ROUTE-INTERNAL read before mutating
 * (`issueWriteGuard` / `issueDescription` / `issueLabels` / `updateIssueLabels`).
 * Those four are deliberately OFF the declared PROVIDER_SURFACE — route-internal
 * data-fetch, not capabilities — so `denyIfUnsupported` never spoke for them, and
 * on a GitHub-backed workspace each was `undefined`: a TypeError inside the
 * route's `try`, surfaced as **500 "Linear API request failed"** on the
 * agent-facing bearer-token proxy. A server error, naming the wrong backend, for
 * a request that could never succeed.
 *
 * These tests drive the REAL `createProxyRoutes` handlers against the REAL
 * `GitHubProvider` and the repo's own in-memory fake client — the production
 * LIN-581 selection path (`resolveWorkspaceAccess` reports the provider NAME and
 * the registry resolves it), so nothing is injected past the seam under test.
 * Each asserts the 2xx AND the round-tripped value in the fake store: a status
 * alone would not catch the `stateId` no-op this ticket also fixes.
 *
 * The two capability controls at the end pin what must NOT change: a write GitHub
 * genuinely cannot do still declines 422, so the fix is not a blanket "GitHub can
 * do everything now".
 *
 * Run with: node --test tests/unit/proxy-github-write-routes.test.js
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { githubProvider } from '../../lib/providers/github/index.js';
import { createFakeGitHubClient } from '../../lib/providers/github/fake-client.js';

// The workspace "token" IS the call scope for the GitHub provider, and a bare
// string scope means "authenticate via the boot client, repo = this slug".
const REPO = 'octocat/hello-world';
const UUID = '11111111-1111-1111-1111-111111111111';

let fake;
const savedClient = githubProvider.client;

function seed() {
  return createFakeGitHubClient({
    [REPO]: {
      labels: [{ name: 'bug' }, { name: 'urgent' }],
      issues: [
        {
          number: 7, title: 'Original title', body: 'original body', state: 'open',
          html_url: `https://github.com/${REPO}/issues/7`, created_at: '2026-01-01T00:00:00Z',
          labels: [{ name: 'bug' }], milestone: null,
        },
      ],
    },
  });
}

beforeEach(() => {
  fake = seed();
  githubProvider.configure({ client: fake, repo: REPO });
});

afterEach(() => {
  // Restore the module singleton so a later suite in this process sees it as it
  // was found (production configures no boot client at all).
  githubProvider.client = savedClient;
});

/** The stored fake issue — the round-trip witness, read straight from the store. */
const stored = () => fake.getIssue(REPO, 7);

function buildApp({ providerName = 'github', token = REPO } = {}) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      validateToken: async () => ({
        tokenId: 't1', urlKey: 'acme', label: 'test', scope: 'readWrite', createdBy: 'u1',
      }),
    },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({ token, reason: 'ok', provider: providerName }),
    getWorkspaceAccessToken: async () => token,
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

async function call(app, method, path, body) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: {
        Authorization: 'Bearer anything',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    let parsed = {};
    try { parsed = await res.json(); } catch { /* empty body */ }
    return { status: res.status, body: parsed };
  } finally {
    await new Promise(r => server.close(r));
  }
}

// ---------------------------------------------------------------------------
// The seven reachable write routes: 2xx + the value actually persisted.
// ---------------------------------------------------------------------------
describe('GitHub-backed proxy writes land (were 500 "Linear API request failed")', () => {
  test('PATCH /issues/:id {title} → 200 and the title round-trips', async () => {
    const { status, body } = await call(buildApp(), 'PATCH', '/api/proxy/issues/7', { title: 'Renamed' });
    assert.equal(status, 200);
    assert.equal(body.success, true);
    assert.equal(body.issue.title, 'Renamed');
    assert.equal((await stored()).title, 'Renamed');
  });

  test('PATCH /issues/:id {stateId:"closed"} → 200 and the issue is ACTUALLY closed', async () => {
    // The LIN-1569 half. Before the provider mapped `stateId`, this returned 200
    // with the issue still `open` — a silent lie, strictly worse for an agent
    // than the 500 it replaced. Asserting the store, not just the status.
    const { status, body } = await call(buildApp(), 'PATCH', '/api/proxy/issues/7', { stateId: 'closed' });
    assert.equal(status, 200);
    assert.equal(body.issue.state.type, 'completed');
    assert.equal((await stored()).state, 'closed');
  });

  test('PATCH /issues/:id {stateId:"done"} → the symbolic ref resolves and closes it', async () => {
    // `done` is resolved against the provider's own states() by the route, which
    // needs a non-null team.id from issueWriteGuard to scope the lookup at all.
    const { status } = await call(buildApp(), 'PATCH', '/api/proxy/issues/7', { stateId: 'done' });
    assert.equal(status, 200);
    assert.equal((await stored()).state, 'closed');
  });

  test('PATCH /issues/:id with an unresolvable stateId → 422, and NOTHING is written', async () => {
    // A UUID slips past the route's UUID fast-path without consulting states(),
    // so the provider is the last line of defence. It must refuse loudly (a
    // caller error is never a 500) and must not half-apply the rest of the patch.
    const { status, body } = await call(buildApp(), 'PATCH', '/api/proxy/issues/7',
      { title: 'should not land', stateId: UUID });
    assert.equal(status, 422);
    assert.match(body.error, /Cannot resolve state/);
    const issue = await stored();
    assert.equal(issue.title, 'Original title');
    assert.equal(issue.state, 'open');
  });

  test('POST /issues/:id/comments → 201 and the comment is stored', async () => {
    const { status, body } = await call(buildApp(), 'POST', '/api/proxy/issues/7/comments', { body: 'hello from the proxy' });
    assert.equal(status, 201);
    assert.equal(body.success, true);
    const comments = await fake.listComments(REPO, 7);
    assert.equal(comments.length, 1);
    assert.equal(comments[0].body, 'hello from the proxy');
  });

  test('POST /issues/:id/description/append → 200 and the body is appended', async () => {
    const { status } = await call(buildApp(), 'POST', '/api/proxy/issues/7/description/append', { block: 'appended line' });
    assert.equal(status, 200);
    const body = (await stored()).body;
    assert.match(body, /^original body/);
    assert.match(body, /appended line$/);
  });

  test('POST /issues/:id/description/replace → 200 and the substring is replaced', async () => {
    const { status } = await call(buildApp(), 'POST', '/api/proxy/issues/7/description/replace',
      { oldString: 'original', newString: 'edited' });
    assert.equal(status, 200);
    assert.equal((await stored()).body, 'edited body');
  });

  test('POST /issues/:id/labels → 200 and the label is added (existing labels kept)', async () => {
    const { status, body } = await call(buildApp(), 'POST', '/api/proxy/issues/7/labels', { labelId: 'urgent' });
    assert.equal(status, 200);
    assert.equal(body.success, true);
    const names = (await stored()).labels.map(l => l.name).sort();
    assert.deepEqual(names, ['bug', 'urgent']);
  });

  test('DELETE /issues/:id/labels/:labelId → 200 and the label is removed', async () => {
    const { status, body } = await call(buildApp(), 'DELETE', '/api/proxy/issues/7/labels/bug');
    assert.equal(status, 200);
    assert.equal(body.success, true);
    assert.deepEqual((await stored()).labels, []);
  });

  test('a label already present is still the no-op 200 (RMW short-circuit intact)', async () => {
    const { status, body } = await call(buildApp(), 'POST', '/api/proxy/issues/7/labels', { labelId: 'bug' });
    assert.equal(status, 200);
    assert.match(body.message, /already present/);
  });

  test('a write to a missing issue is a 404, not a 500', async () => {
    const { status } = await call(buildApp(), 'POST', '/api/proxy/issues/999/description/append', { block: 'x' });
    assert.equal(status, 404);
  });
});

// ---------------------------------------------------------------------------
// Controls: the capability contract is unchanged.
// ---------------------------------------------------------------------------
describe('the unsupported-write contract is untouched (LIN-1559 controls)', () => {
  test('relations still decline 422 CAPABILITY_NOT_SUPPORTED on GitHub', async () => {
    const { status, body } = await call(buildApp(), 'POST', '/api/proxy/issues/7/relations',
      { type: 'blocks', relatedIssueId: UUID });
    assert.equal(status, 422);
    assert.equal(body.code, 'CAPABILITY_NOT_SUPPORTED');
    assert.equal(body.capability, 'createRelation');
  });

  test('attachments still decline 422 (uploadFile), before any description read', async () => {
    const { status, body } = await call(buildApp(), 'POST', '/api/proxy/issues/7/attachments',
      { target: 'description', image: 'data:image/png;base64,iVBORw0KGgo=' });
    assert.equal(status, 422);
    assert.equal(body.code, 'CAPABILITY_NOT_SUPPORTED');
    assert.equal(body.capability, 'uploadFile');
  });

  test('the four route-internal reads stay OFF the declared capability surface', () => {
    // The fix is an implementation, NOT a surface widening: PROVIDER_SURFACE is
    // owned by LIN-1557 and this ticket ships no change to it. `supports()` must
    // still be false for all four — which is exactly why the route backstop is
    // keyed on method existence rather than on supports().
    for (const m of ['issueWriteGuard', 'issueDescription', 'issueLabels', 'updateIssueLabels']) {
      assert.equal(githubProvider.supports(m), false, `${m} must stay off the declared surface`);
      assert.equal(typeof githubProvider[m], 'function', `${m} must still be implemented`);
    }
  });
});
