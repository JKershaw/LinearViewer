/**
 * LIN-3444 — the title lane must call GitHub with the binding's `owner/name`
 * slug, never the Connection's `unitId` (the App installation id).
 *
 * Drives the REAL chain: createWorkspaceTitleResolver → resolveConnectionBackedWorkspace
 * → getWorkspaceCallScope → GitHubProvider.fetchProjects → createGitHubClient,
 * with only the HTTP fetch faked, and asserts the requested `/repos/...` paths.
 */
process.env.NODE_ENV = 'test';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createConnectionAccess } from '../../lib/connection-credential.js';
import { createWorkspaceTitleResolver } from '../../lib/workspace-title-resolver.js';
import { fingerprintCredential } from '../../lib/credential-diagnostics.js';
import { getWorkspaceCallScope } from '../../lib/workspace.js';
import { GitHubProvider, createGitHubClient } from '../../lib/providers/github/index.js';

const ACCT = 'acct-3444';
const INSTALLATION_ID = '142745078';
const SLUG = 'JKershaw/Herd';
const CONNECTION_ID = `${ACCT}::github::${INSTALLATION_ID}`;

const connection = {
  _id: CONNECTION_ID, accountId: ACCT, provider: 'github', unitId: INSTALLATION_ID, referents: [],
  credentials: { token: 'ghs_install', installationId: INSTALLATION_ID, tokenExpiresAt: Date.now() + 3_600_000 },
};

const ownerWorkspace = (scope) => ({
  id: 'w', urlKey: 'gh-herd', provider: 'github',
  activeBinding: { provider: 'github', scope },
  bindings: [{ provider: 'github', scope, connectionId: CONNECTION_ID }],
});

function build({ workspace, fetchImpl }) {
  const row = { session: { workspaces: [workspace] }, workspaceIndex: 0 };
  const access = createConnectionAccess({
    connectionStore: { readConnectionsByReferent: async () => [connection], readConnectionById: async () => connection, mirrorCredentialIfToken: async () => true },
    ownerCredentialStore: { getByConnection: async () => null },
    refreshConnection: async () => null,
    resolveCanonicalAccountId: async (id) => id,
    selectOwnerSessionRow: () => row,
    normalizeProvider: (ws) => ws?.provider || 'linear',
    fingerprintCredential,
    gate: { shouldAttempt: () => true },
    lifecycleEventStore: { recordEvent: async () => {} },
    bufferMs: 5 * 60 * 1000,
    now: () => Date.now(),
  });
  const provider = new GitHubProvider({ clientFactory: (token) => createGitHubClient({ token, fetchImpl }) });
  return createWorkspaceTitleResolver({
    sessionsCollection: { find: () => ({ toArray: async () => [] }) },
    fetchWorkspaceIssues: (ws) => provider.fetchProjects(getWorkspaceCallScope(ws)).then((r) => r.issues),
    resolveConnectionBackedWorkspace: (args) => access.resolveConnectionBackedWorkspace(args),
  });
}

const okFetch = (paths) => async (url) => {
  paths.push(new URL(url).pathname);
  const body = url.includes('/issues') ? [{ number: 7, title: 'Seven', state: 'open', labels: [] }] : [];
  return { ok: true, status: 200, statusText: 'OK', text: async () => JSON.stringify(body) };
};

test('title lane requests /repos/<owner>/<name>/..., never the installation id', async () => {
  const paths = [];
  const resolver = build({ workspace: ownerWorkspace(SLUG), fetchImpl: okFetch(paths) });
  const titles = await resolver.resolveWorkspaceTitles('gh-herd', ACCT);

  assert.ok(paths.length >= 2, 'issues and milestones are both requested');
  for (const p of paths) {
    assert.match(p, /^\/repos\/JKershaw\/Herd\/(issues|milestones)$/, `slug path, got ${p}`);
    assert.ok(!p.includes(INSTALLATION_ID), `numeric id must not appear in ${p}`);
  }
  assert.deepEqual(titles, { '#7': 'Seven' });
});

test('fail-open: a GitHub 404 yields an empty map and does not throw', async () => {
  const fetchImpl = async () => ({ ok: false, status: 404, statusText: 'Not Found', text: async () => '{"message":"Not Found"}' });
  const resolver = build({ workspace: ownerWorkspace(SLUG), fetchImpl });
  const origError = console.error;
  console.error = () => {};
  try {
    assert.deepEqual(await resolver.resolveWorkspaceTitles('gh-herd', ACCT), {});
  } finally {
    console.error = origError;
  }
});
