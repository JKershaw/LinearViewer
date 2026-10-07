/**
 * LIN-3335 review R1 — the proxy lane must keep the kind-only `source` routing
 * that decision 6 and the P2 Keep list require.
 *
 * On a Linear-primary CONNECTION-BACKED workspace with a connection-backed Jira
 * binding beside it:
 *
 *   - `POST /api/proxy/dispatch {issueIdentifier, issueSource:'jira'}` is accepted
 *     (201) and its referent guard probes JIRA, never the active Linear binding;
 *   - `GET /api/proxy/issues/ABC-12?source=jira` reads JIRA;
 *   - with NO source, the same calls stay on Linear;
 *   - a Jira-source resolution never pollutes the per-(urlKey, owner) token cache,
 *     so a following no-source read within the 30s TTL is not served Jira.
 *
 * Drives the REAL proxy routes over the REAL server.js `resolveWorkspaceAccess`
 * body (vm-executed) and the REAL connection-first arm, via the shared
 * `lin-3126-proxy-harness.js`. The arm-level selection is `selectIssueSourceBinding`
 * (the same rule `resolveIssueBinding` uses).
 *
 * Pre-fix (PR 7b832382) the arm always resolved the ACTIVE Linear binding, so the
 * Jira-source dispatch 422'd `ISSUE_NOT_FOUND` against Linear and the Jira read
 * was served by Linear. The mutation check recorded in the PR ran this file with
 * the source selection reverted and watched the Jira assertions go red.
 *
 * Run with: node --test tests/unit/lin-3335-proxy-source-routing.test.js
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { registerProvider } from '../../lib/providers/registry.js';
import { createConnectionAccess } from '../../lib/connection-credential.js';
import { fingerprintCredential } from '../../lib/credential-diagnostics.js';
import {
  makeVmResolver, makeHoldingCache, buildProxyApp, callProxy, OWNER, BUFFER,
} from './lin-3126-proxy-harness.js';

const LINEAR_TOKEN = 'lin-tok';
const JIRA_TOKEN = 'jira-tok';
const URL_KEY = 'acme';
const future = () => Date.now() + 3_600_000;

// ── Fake providers (registered, never injected) ──────────────────────────────

function installProviders({ linearGuardReturns = null } = {}) {
  const calls = { linearGuard: [], linearDetail: [], jiraDetail: [] };
  registerProvider({
    name: 'linear',
    ui: { displayName: 'Linear', name: 'linear' },
    supports: () => true,
    createFields: () => ['title', 'teamId'],
    // The real guard allow-list includes 'linear'; returning null is "definitively
    // absent", so an unstamped dispatch is refused with 422 ISSUE_NOT_FOUND.
    issueWriteGuard: async (callScope, id) => { calls.linearGuard.push({ callScope, id }); return linearGuardReturns; },
    issueDetail: async (callScope, id) => {
      calls.linearDetail.push({ callScope, id });
      return { id, identifier: 'ABC-12', title: 'Linear task', description: '', state: { name: 'Todo', type: 'unstarted' } };
    },
    fetchIssueContext: async (callScope, id) => ({ issue: { id, identifier: 'ABC-12', title: 'Linear task' } }),
  });
  registerProvider({
    name: 'jira',
    ui: { displayName: 'Jira', name: 'jira' },
    supports: () => true,
    // Deliberately NO `issueWriteGuard`: Jira is not a GUARDED_PROVIDER, so the
    // dispatch referent guard fails open and the Jira task stays dispatchable.
    issueDetail: async (callScope, id) => {
      calls.jiraDetail.push({ callScope, id });
      return { id, identifier: 'ABC-12', title: 'Jira task', description: '', state: { name: 'Todo', type: 'unstarted' } };
    },
    fetchIssueContext: async (callScope, id) => ({ issue: { id, identifier: 'ABC-12', title: 'Jira task' } }),
  });
  return calls;
}

// ── Owner session row: Linear active, Jira beside it, both connection-backed ──

function linearPrimaryOwnerRow() {
  return {
    session: {
      workspaces: [{
        id: 'ws-1',
        urlKey: URL_KEY,
        provider: 'linear',
        bindings: [
          { provider: 'linear', scope: 'org-1', connectionId: 'conn-lin' },
          { provider: 'jira', scope: 'https://site-1', connectionId: 'conn-jira' },
        ],
        activeBinding: { provider: 'linear', scope: 'org-1' },
      }],
    },
    workspaceIndex: 0,
  };
}

function linearConnection() {
  return {
    _id: 'conn-lin',
    accountId: OWNER,
    provider: 'linear',
    unitId: 'org-1',
    credentials: { token: LINEAR_TOKEN, tokenExpiresAt: future() },
    referents: [{ urlKey: URL_KEY, provider: 'linear', scope: 'org-1' }],
  };
}

function jiraConnection() {
  return {
    _id: 'conn-jira',
    accountId: OWNER,
    provider: 'jira',
    unitId: 'https://site-1',
    credentials: { token: JIRA_TOKEN, authType: 'oauth', cloudId: 'c1', tokenExpiresAt: future() },
    referents: [{ urlKey: URL_KEY, provider: 'jira', scope: 'https://site-1' }],
  };
}

/** The real vm resolver + real connection-first arm over the mixed-kind workspace. */
function makeMixedResolver({ cache } = {}) {
  const row = linearPrimaryOwnerRow();
  const ownerSession = { accountId: OWNER, workspaces: row.session.workspaces };
  const connectionAccess = createConnectionAccess({
    // Ignore the provider arg: the arm filters by the target binding's
    // `connectionId`, so returning both Connections is faithful here.
    connectionStore: { readConnectionsByReferent: async () => [linearConnection(), jiraConnection()], mirrorCredentialIfToken: async () => true },
    ownerCredentialStore: { getByConnection: async () => null },
    refreshConnection: async () => null,
    resolveCanonicalAccountId: async (id) => id,
    selectOwnerSessionRow: () => row,
    normalizeProvider: (ws) => ws?.provider || 'linear',
    fingerprintCredential,
    gate: { shouldAttempt: () => true },
    lifecycleEventStore: { recordEvent: async () => {} },
    bufferMs: BUFFER,
  });
  return makeVmResolver({ sessions: [{ _id: 'sid', session: ownerSession }], connectionAccess, cache });
}

/** Wrap the resolver so the test can read the raw resolution it handed the route. */
function recordingResolver(fn) {
  const seen = [];
  return {
    seen,
    resolveWorkspaceAccess: async (urlKey, ownerAccountId, opts) => {
      const out = await fn(urlKey, ownerAccountId, opts);
      seen.push({ ...out, opts });
      return out;
    },
  };
}

// ── The proxy seam routes by source ──────────────────────────────────────────

describe('LIN-3335 R1 — proxy dispatch/read routes a Jira task to Jira', () => {
  test('POST /api/proxy/dispatch {issueSource:jira} is accepted and never probes Linear', async () => {
    const calls = installProviders();
    const { fn } = makeMixedResolver();
    const { seen, resolveWorkspaceAccess } = recordingResolver(fn);
    const { app, captured } = buildProxyApp({ resolveWorkspaceAccess, provider: null });

    const res = await callProxy(app, 'POST', '/api/proxy/dispatch', {
      prompt: 'run the jira task', issueIdentifier: 'ABC-12', issueSource: 'jira',
    });

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(seen.at(-1).provider, 'jira', 'the seam resolved the Jira provider');
    assert.equal(seen.at(-1).token, JIRA_TOKEN, 'the seam served the Jira Connection credential');
    assert.deepEqual(calls.linearGuard, [], 'the referent guard must not probe the active Linear binding');
    assert.equal(captured.item.issueSource, 'jira', 'the kind-only source is stamped on the row');
  });

  test('POST /api/proxy/dispatch with NO source stays on Linear and is refused', async () => {
    const calls = installProviders({ linearGuardReturns: null });
    const { fn } = makeMixedResolver();
    const { seen, resolveWorkspaceAccess } = recordingResolver(fn);
    const { app } = buildProxyApp({ resolveWorkspaceAccess, provider: null });

    const res = await callProxy(app, 'POST', '/api/proxy/dispatch', {
      prompt: 'run it', issueIdentifier: 'ABC-12',
    });

    assert.equal(res.status, 422, JSON.stringify(res.body));
    assert.equal(res.body.code, 'ISSUE_NOT_FOUND');
    assert.equal(calls.linearGuard.length, 1, 'the unstamped dispatch probes the active Linear binding');
    assert.equal(seen.at(-1).provider, 'linear');
    assert.equal(seen.at(-1).token, LINEAR_TOKEN);
  });

  test('GET /api/proxy/issues/ABC-12?source=jira reads Jira', async () => {
    const calls = installProviders();
    const { fn } = makeMixedResolver();
    const { seen, resolveWorkspaceAccess } = recordingResolver(fn);
    const { app } = buildProxyApp({ resolveWorkspaceAccess, provider: null });

    const res = await callProxy(app, 'GET', `/api/proxy/issues/ABC-12?source=jira`);

    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(calls.jiraDetail.length, 1, 'Jira served the read');
    assert.equal(calls.linearDetail.length, 0, 'Linear was never queried');
    assert.equal(calls.jiraDetail[0].callScope.authType, 'oauth');
    assert.equal(calls.jiraDetail[0].callScope.accessToken, JIRA_TOKEN);
    assert.equal(seen.at(-1).provider, 'jira');
  });

  test('GET /api/proxy/issues/ABC-12 with NO source reads Linear', async () => {
    const calls = installProviders();
    const { fn } = makeMixedResolver();
    const { resolveWorkspaceAccess } = recordingResolver(fn);
    const { app } = buildProxyApp({ resolveWorkspaceAccess, provider: null });

    const res = await callProxy(app, 'GET', `/api/proxy/issues/ABC-12`);

    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(calls.linearDetail.length, 1, 'Linear served the read');
    assert.equal(calls.jiraDetail.length, 0, 'Jira was never queried');
  });
});

// ── The per-kind credential never contaminates the base token cache ───────────

describe('LIN-3335 R1 — the token cache stays per-kind correct', () => {
  test('a Jira-source resolution is never served to a following no-source read within the TTL', async () => {
    const { fn, cache } = makeMixedResolver({ cache: makeHoldingCache() });

    const first = await fn(URL_KEY, OWNER, { source: 'jira' });
    assert.equal(first.provider, 'jira');
    assert.equal(first.token, JIRA_TOKEN);

    const second = await fn(URL_KEY, OWNER);
    assert.equal(second.provider, 'linear', 'the no-source read resolves Linear, not the cached Jira credential');
    assert.equal(second.token, LINEAR_TOKEN);

    const third = await fn(URL_KEY, OWNER, { source: 'jira' });
    assert.equal(third.provider, 'jira', 'the Jira source still resolves Jira after the Linear read');
    assert.equal(third.token, JIRA_TOKEN);

    assert.ok(
      !cache.sets.some(entry => entry.value?.token === JIRA_TOKEN),
      'the Jira credential is never written to the per-(urlKey, owner) base cache'
    );
  });
});
