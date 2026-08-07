/**
 * LIN-1891 acceptance item 4 — the headline acceptance criterion of the whole
 * ticket: a GitHub-backed workspace's proxy WRITE goes 500 -> 200.
 *
 * Before this fix: `resolveWorkspaceAccess` (server.js) hands the headless
 * proxy lane a bare installation-token STRING for every provider, never the
 * structured `{token, repo}` call scope `getWorkspaceCallScope` produces for
 * the session lane. `GitHubProvider._clientFor` treats a string scope as the
 * LEGACY single-account path — "authenticate via the boot `client`, repo =
 * this string" — but production never configures a boot client for GitHub
 * App installations (the installation token IS the per-request credential).
 * So `_requireClient()` throws, and `PATCH /api/proxy/issues/:issueId`
 * answers a bare 500 for every GitHub-backed workspace, always.
 *
 * `tests/unit/proxy-github-write-routes.test.js` (LIN-1559) does NOT catch
 * this: its `beforeEach` calls `githubProvider.configure({ client: fake,
 * repo: REPO })`, installing exactly the boot client production does not
 * have, and its `buildApp` stub resolves `{ token: REPO, reason: 'ok',
 * provider: 'github' }` — a bare string, with no `scope` field at all. That
 * fixture is deliberately NOT extended here (LIN-1901 owns its cleanup) —
 * see the module docstring there for why it would pass identically before
 * and after this fix.
 *
 * This test instead drives the REAL `createProxyRoutes` handlers against:
 *   - a `resolveWorkspaceAccess` stub shaped like the REAL selector's output
 *     post-LIN-1891 — `{ token, scope, reason, provider }`, where `scope` is
 *     the `{token, repo}` object `getWorkspaceCallScope`/`selectOwner
 *     WorkspaceToken` now produce for a GitHub-family workspace;
 *   - a `GitHubProvider` with NO boot client (`client` left unset — the
 *     production GitHub App shape) and a credential-KEYED `clientFactory`
 *     (mirrors `tests/unit/github-app-integration.test.js:101`), so a wrong
 *     or missing token cannot silently succeed against the wrong repo.
 *
 * Run with: node --test tests/unit/proxy-github-credential-scope.test.js
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { GitHubProvider } from '../../lib/providers/github/index.js';
import { createFakeGitHubClient } from '../../lib/providers/github/fake-client.js';

const REPO = 'octocat/hello-world';
const INSTALL_TOKEN = 'ghs_installation_token';

/**
 * A GitHubProvider with no boot client, whose `clientFactory` maps ONLY the
 * expected installation token to the seeded fake client — an unexpected or
 * missing token authorises nothing (mirrors `clientScopedTo` in
 * tests/unit/github-app-integration.test.js, applied to tokens rather than
 * per-repo scoping since this test drives a single repo).
 */
function buildTokenBoundProvider(fake) {
  return new GitHubProvider({
    clientFactory: (token) => {
      if (token !== INSTALL_TOKEN) {
        throw new Error(`unexpected token reached the client factory: ${token}`);
      }
      return fake;
    },
  });
}

function buildApp({ provider, resolveWorkspaceAccess }) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      validateToken: async () => ({
        tokenId: 't1', urlKey: 'acme', label: 'test', scope: 'readWrite', createdBy: 'u1',
      }),
    },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess,
    getWorkspaceAccessToken: async () => INSTALL_TOKEN,
    agentStatusStore: {},
    recapCacheStore: {},
    briefCacheStore: {},
    dispatchQueueStore: {},
    workspaceFromUrl: (req, res, next) => next(),
    getWorkspaceOpenRouterKey: async () => null,
    workspacePreferencesStore: {},
    freeTierStore: { tryUse: async () => ({ allowed: true }) },
    provider,
  }));
  return app;
}

async function call(app, method, path, body) {
  const server = app.listen(0);
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

describe('PATCH /api/proxy/issues/:issueId on a GitHub App workspace (LIN-1891, no boot client)', () => {
  test('the structured {token, repo} scope authenticates the write: 200, and the title round-trips in the store', async () => {
    const fake = createFakeGitHubClient({
      [REPO]: {
        issues: [
          {
            number: 7, title: 'Original title', body: 'original body', state: 'open',
            html_url: `https://github.com/${REPO}/issues/7`, created_at: '2026-01-01T00:00:00Z',
            labels: [], milestone: null,
          },
        ],
      },
    });
    const provider = buildTokenBoundProvider(fake);
    // Shaped like the REAL post-LIN-1891 selector output: a truthy scalar
    // `token` AND the structured `scope` resolveProviderAccess substitutes
    // it for (`token ? (scope ?? token) : token`).
    const resolveWorkspaceAccess = async () => ({
      token: INSTALL_TOKEN,
      scope: { token: INSTALL_TOKEN, repo: REPO },
      reason: 'ok',
      provider: 'github',
    });

    const { status, body } = await call(
      buildApp({ provider, resolveWorkspaceAccess }),
      'PATCH', '/api/proxy/issues/7', { title: 'Renamed via credential scope' }
    );

    assert.equal(status, 200, `expected 200, got ${status}: ${JSON.stringify(body)}`);
    assert.equal(body.success, true);
    assert.equal(body.issue.title, 'Renamed via credential scope');
    const stored = await fake.getIssue(REPO, 7);
    assert.equal(stored.title, 'Renamed via credential scope', 'the round-trip witness — a 200 alone would not catch a silent no-op');
  });

  test('sanity: an installation token the clientFactory does not recognise never reaches this repo (proves the token-bound provider is a real gate, not a rubber stamp)', async () => {
    const fake = createFakeGitHubClient({ [REPO]: { issues: [{ number: 7, title: 'x', body: '', state: 'open', html_url: '', created_at: '2026-01-01T00:00:00Z', labels: [], milestone: null }] } });
    const provider = buildTokenBoundProvider(fake);
    const resolveWorkspaceAccess = async () => ({
      token: 'wrong-token',
      scope: { token: 'wrong-token', repo: REPO },
      reason: 'ok',
      provider: 'github',
    });

    const { status } = await call(
      buildApp({ provider, resolveWorkspaceAccess }),
      'PATCH', '/api/proxy/issues/7', { title: 'should not land' }
    );

    assert.equal(status, 500, 'a token the factory rejects must fail loudly, not silently authenticate as someone else');
  });
});
