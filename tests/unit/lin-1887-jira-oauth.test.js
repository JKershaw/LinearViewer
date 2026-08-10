/**
 * LIN-1887 Steps 3–6 and 9 — the Jira OAuth 3LO auth shape.
 *
 * Everything here is REAL for the wiring and says nothing about whether
 * Atlassian accepts the request. No live Atlassian OAuth app exists (D3), so
 * every claim about Atlassian's RUNTIME behaviour — the consent round-trip, the
 * token response shape and actual `expires_in`, that refresh tokens rotate as
 * documented, the `accessible-resources` payload, and that
 * `/ex/jira/{cloudId}/rest/api/3/...` accepts a Bearer token identically to the
 * tenant REST base — is doc-derived and unobserved. These tests pin what Harbour
 * SENDS and how it stores what comes back.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';

import {
  jiraOAuthApiBase,
  buildJiraAuthorizeUrl,
  refreshJiraAccessToken,
  exchangeJiraCode,
  fetchJiraAccessibleResources,
  getMissingJiraOAuthConfig,
  isJiraOAuthConfigured,
  JIRA_OAUTH_SCOPES,
} from '../../lib/providers/jira/oauth.js';
import { createJiraClient } from '../../lib/providers/jira/client.js';
import { JiraProvider } from '../../lib/providers/jira/index.js';
import { getWorkspaceCallScope, getBindingCallScope, AMBIGUOUS_CALL_SCOPE, linkProvider } from '../../lib/workspace.js';
import { TokenRefreshError } from '../../lib/token-refresh.js';
import { renderSettingsPage } from '../../lib/render-settings.js';

const ENV_KEYS = ['JIRA_CLIENT_ID', 'JIRA_CLIENT_SECRET', 'JIRA_REDIRECT_URI'];
let savedEnv;
function withConfig() {
  process.env.JIRA_CLIENT_ID = 'client-id-1';
  process.env.JIRA_CLIENT_SECRET = 'secret-1';
  process.env.JIRA_REDIRECT_URI = 'https://harbour.example/auth/jira/oauth/callback';
}
beforeEach(() => { savedEnv = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]])); });
afterEach(() => { for (const k of ENV_KEYS) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; } });

// ---------------------------------------------------------------------------
// Step 4 — the config predicate (F3.2)
// ---------------------------------------------------------------------------

describe('LIN-1887 Step 4 — the Jira config predicate is provider-owned', () => {
  test('names every missing var, and is empty exactly when the flow can complete', () => {
    for (const k of ENV_KEYS) delete process.env[k];
    assert.deepEqual(getMissingJiraOAuthConfig(), ENV_KEYS);
    assert.equal(isJiraOAuthConfigured(), false);
    withConfig();
    assert.deepEqual(getMissingJiraOAuthConfig(), []);
    assert.equal(isJiraOAuthConfigured(), true);
  });

  test('JIRA_REDIRECT_URI is REQUIRED, unlike GitHub’s optional one', () => {
    // Atlassian has no "the app's default callback" fallback: `redirect_uri` is
    // sent on both the authorize and the token call and must match exactly. A
    // server missing it can begin the flow and never complete it — which is the
    // precise failure the predicate exists to make un-promisable.
    withConfig();
    delete process.env.JIRA_REDIRECT_URI;
    assert.deepEqual(getMissingJiraOAuthConfig(), ['JIRA_REDIRECT_URI']);
  });
});

// ---------------------------------------------------------------------------
// Step 3 / F6 — the OAuth API base allowlist
// ---------------------------------------------------------------------------

describe('LIN-1887 F6 — the OAuth API base is hard-pinned to api.atlassian.com', () => {
  test('builds the documented gateway base', () => {
    assert.equal(jiraOAuthApiBase('abc-123'), 'https://api.atlassian.com/ex/jira/abc-123');
  });

  test('a hostile cloudId cannot escape the host, the path, or into a query string', () => {
    // The client's own https check is a bare `^https://` PREFIX test. On the
    // Basic path `normalizeJiraSite` is the real allowlist upstream; on this
    // path there is no upstream validator at all, so encoding + the hostname
    // assertion are the allowlist.
    for (const hostile of ['../../evil', 'x/../../..', 'a?b=c', 'a#frag', 'evil.com/x', 'a b']) {
      const base = jiraOAuthApiBase(hostile);
      const url = new URL(base);
      assert.equal(url.hostname, 'api.atlassian.com', `hostile cloudId escaped the host: ${hostile}`);
      assert.ok(url.pathname.startsWith('/ex/jira/'), `hostile cloudId escaped the path: ${hostile}`);
      assert.equal(url.search, '', `hostile cloudId reached the query string: ${hostile}`);
      assert.equal(url.hash, '', `hostile cloudId reached the fragment: ${hostile}`);
    }
  });

  test('an empty cloudId is refused rather than silently producing a bare-host base', () => {
    assert.throws(() => jiraOAuthApiBase(''), /cloudId is required/);
    assert.throws(() => jiraOAuthApiBase(undefined), /cloudId is required/);
  });
});

describe('LIN-1887 D2 — the requested scope set', () => {
  test('is read+write and includes offline_access', () => {
    assert.deepEqual(JIRA_OAUTH_SCOPES, ['read:jira-work', 'write:jira-work', 'read:jira-user', 'offline_access']);
  });

  test('requests write:jira-work — LIN-1968, so an OAuth binding can honour the inlineEdit it advertises', () => {
    // The capability gate is provider-level: `get ui()`/`supports()` derive from
    // which methods are implemented, so `inlineEdit` is true for Basic and OAuth
    // bindings alike. Without this scope an OAuth binding renders edit
    // affordances that 403 at Atlassian, and a Basic→OAuth link (bindings key on
    // `(provider, scope)` and MERGE) silently downgrades a read-write binding.
    //
    // Dropping it is not a tidy-up: it re-opens LIN-1968 AND, because widening a
    // consent screen re-prompts every consented user, re-adding it later is a
    // one-way door that is no longer cheap. John's ruling, 2026-08-09.
    assert.ok(JIRA_OAUTH_SCOPES.includes('write:jira-work'));
  });

  test('does NOT request read:me — identity comes from /rest/api/3/myself instead', () => {
    // The plan's Step 4 proposed `GET api.atlassian.com/me`, which needs
    // `read:me`. D2 fixed the scope set explicitly, and widening a consent screen
    // is the one-way door D2 exists to protect. `/rest/api/3/myself` is covered
    // by `read:jira-user`, returns the same Atlassian accountId, and is already
    // Phase 1's identity probe — so a human upgrading a Basic link to OAuth
    // resolves to the SAME Harbour account rather than colliding with themself.
    assert.ok(!JIRA_OAUTH_SCOPES.includes('read:me'));
  });

  test('the authorize URL targets auth.atlassian.com with an opaque state and the api audience', () => {
    withConfig();
    const url = new URL(buildJiraAuthorizeUrl({ state: 'nonce-1' }));
    assert.equal(url.origin, 'https://auth.atlassian.com');
    assert.equal(url.pathname, '/authorize');
    assert.equal(url.searchParams.get('state'), 'nonce-1');
    assert.equal(url.searchParams.get('audience'), 'api.atlassian.com');
    assert.equal(url.searchParams.get('response_type'), 'code');
    assert.equal(url.searchParams.get('scope'), JIRA_OAUTH_SCOPES.join(' '));
    assert.equal(url.searchParams.get('redirect_uri'), process.env.JIRA_REDIRECT_URI);
  });

  test('the authorize URL refuses to be built on an unconfigured server', () => {
    for (const k of ENV_KEYS) delete process.env[k];
    assert.throws(() => buildJiraAuthorizeUrl({ state: 'x' }), /not configured/);
  });
});

// ---------------------------------------------------------------------------
// The exchange — the error taxonomy the durable delete guard depends on
// ---------------------------------------------------------------------------

describe('LIN-1887 — the Jira exchange is substitutable with Linear’s at the refresh seam', () => {
  const okResponse = (body) => ({ ok: true, status: 200, json: async () => body });
  const errResponse = (body, status = 400) => ({ ok: false, status, json: async () => body });

  test('returns the {access_token, refresh_token, expires_in} triple the seam expects', async () => {
    withConfig();
    let sent;
    const fetchImpl = async (url, opts) => { sent = { url, body: JSON.parse(opts.body) }; return okResponse({ access_token: 'a', refresh_token: 'r2', expires_in: 3600 }); };
    const result = await refreshJiraAccessToken('r1', { fetchImpl });
    assert.deepEqual(result, { access_token: 'a', refresh_token: 'r2', expires_in: 3600 });
    assert.equal(sent.url, 'https://auth.atlassian.com/oauth/token');
    assert.equal(sent.body.grant_type, 'refresh_token');
    assert.equal(sent.body.refresh_token, 'r1');
  });

  test('invalid_grant maps to EXPIRED — the ONLY code that may delete a durable credential', async () => {
    withConfig();
    const fetchImpl = async () => errResponse({ error: 'invalid_grant' });
    await assert.rejects(refreshJiraAccessToken('r1', { fetchImpl }),
      (e) => e instanceof TokenRefreshError && e.code === 'EXPIRED');
  });

  test('any other failure is NOT definitive, so a blip can never revoke the credential', async () => {
    withConfig();
    await assert.rejects(refreshJiraAccessToken('r1', { fetchImpl: async () => errResponse({ error: 'server_error' }, 500) }),
      (e) => e instanceof TokenRefreshError && e.code === 'INVALID');
    await assert.rejects(refreshJiraAccessToken('r1', { fetchImpl: async () => { throw new Error('socket hang up'); } }),
      (e) => e instanceof TokenRefreshError && e.code === 'NETWORK');
  });

  test('a rotation response with no refresh_token is REJECTED, never persisted as undefined', async () => {
    // Atlassian documents rotating refresh tokens. Persisting `undefined` would
    // wipe the durable credential's only renewable half and turn the next
    // refresh into an unrecoverable "nothing to refresh".
    withConfig();
    await assert.rejects(refreshJiraAccessToken('r1', { fetchImpl: async () => okResponse({ access_token: 'a', expires_in: 3600 }) }),
      (e) => e instanceof TokenRefreshError && e.code === 'INVALID');
  });

  test('the code exchange sends the redirect_uri and tolerates a bag with no refresh_token', async () => {
    // Unlike a rotation, a first exchange with no refresh_token is a real state
    // (the grant did not include offline_access) — the caller simply has nothing
    // durable to store, and the flow still links a working access token.
    withConfig();
    let sent;
    const fetchImpl = async (_u, opts) => { sent = JSON.parse(opts.body); return okResponse({ access_token: 'a', expires_in: 3600 }); };
    const bag = await exchangeJiraCode('code-1', { fetchImpl });
    assert.equal(bag.access_token, 'a');
    assert.equal(sent.grant_type, 'authorization_code');
    assert.equal(sent.redirect_uri, process.env.JIRA_REDIRECT_URI);
  });

  test('accessible-resources projects the payload to {cloudId, url, name} and drops malformed rows', async () => {
    const fetchImpl = async (url, opts) => {
      assert.equal(url, 'https://api.atlassian.com/oauth/token/accessible-resources');
      assert.equal(opts.headers.Authorization, 'Bearer at-1');
      return { ok: true, json: async () => [
        { id: 'cid-1', url: 'https://a.atlassian.net', name: 'A' },
        { id: 'cid-2', url: 'https://b.atlassian.net' },
        { url: 'https://no-id.atlassian.net' },
      ] };
    };
    assert.deepEqual(await fetchJiraAccessibleResources('at-1', { fetchImpl }), [
      { cloudId: 'cid-1', url: 'https://a.atlassian.net', name: 'A' },
      { cloudId: 'cid-2', url: 'https://b.atlassian.net', name: 'https://b.atlassian.net' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// LIN-2001 — the OAuth test-override base
// ---------------------------------------------------------------------------

describe('LIN-2001 — the OAuth test-override base', () => {
  const OVERRIDE_KEYS = ['NODE_ENV', 'JIRA_OAUTH_TEST_BASE'];
  let savedOverrideEnv;
  beforeEach(() => {
    savedOverrideEnv = Object.fromEntries(OVERRIDE_KEYS.map(k => [k, process.env[k]]));
    withConfig();
  });
  afterEach(() => {
    for (const k of OVERRIDE_KEYS) {
      if (savedOverrideEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedOverrideEnv[k];
    }
  });

  const okResponse = (body) => ({ ok: true, status: 200, json: async () => body });
  const okResources = (body) => ({ ok: true, json: async () => body });

  test('override unset: the code exchange and accessible-resources hit the real hosts, byte-identical to today', async () => {
    delete process.env.JIRA_OAUTH_TEST_BASE;
    let tokenUrl, resourcesUrl;
    await exchangeJiraCode('code-1', { fetchImpl: async (url) => { tokenUrl = url; return okResponse({ access_token: 'a', expires_in: 3600 }); } });
    await fetchJiraAccessibleResources('at-1', { fetchImpl: async (url) => { resourcesUrl = url; return okResources([]); } });
    assert.equal(tokenUrl, 'https://auth.atlassian.com/oauth/token');
    assert.equal(resourcesUrl, 'https://api.atlassian.com/oauth/token/accessible-resources');
  });

  test('override set but NODE_ENV !== "test": still the real hosts — fails closed', async () => {
    process.env.JIRA_OAUTH_TEST_BASE = 'http://localhost:9999/fake-atlassian';
    process.env.NODE_ENV = 'production';
    let tokenUrl;
    await exchangeJiraCode('code-1', { fetchImpl: async (url) => { tokenUrl = url; return okResponse({ access_token: 'a', expires_in: 3600 }); } });
    assert.equal(tokenUrl, 'https://auth.atlassian.com/oauth/token');
  });

  test('override set AND NODE_ENV === "test": both call sites resolve to the override base with the path suffix preserved', async () => {
    process.env.JIRA_OAUTH_TEST_BASE = 'http://localhost:9999/test/atlassian';
    process.env.NODE_ENV = 'test';
    let exchangeUrl, resourcesUrl;
    await exchangeJiraCode('code-1', { fetchImpl: async (url) => { exchangeUrl = url; return okResponse({ access_token: 'a', expires_in: 3600 }); } });
    await fetchJiraAccessibleResources('at-1', { fetchImpl: async (url) => { resourcesUrl = url; return okResources([]); } });
    // No `.origin` normalisation anywhere in the resolution — a base carrying a
    // path prefix (`/test/atlassian`) must survive verbatim (F8).
    assert.equal(exchangeUrl, 'http://localhost:9999/test/atlassian/oauth/token');
    assert.equal(resourcesUrl, 'http://localhost:9999/test/atlassian/oauth/token/accessible-resources');
  });

  // N3: `postJiraToken` is shared by `exchangeJiraCode` AND `refreshJiraAccessToken`
  // — the live durable-credential refresh caller (server.js) — so the override
  // reaches it too. Pinned on both sides of the gate: it must resolve the same
  // way the code exchange does when active, and must NOT when inactive.
  test('N3: the REFRESH caller (refreshJiraAccessToken) resolves the same way as the code exchange', async () => {
    process.env.JIRA_OAUTH_TEST_BASE = 'http://localhost:9999/test/atlassian';
    process.env.NODE_ENV = 'test';
    let refreshUrl;
    await refreshJiraAccessToken('r1', { fetchImpl: async (url) => { refreshUrl = url; return okResponse({ access_token: 'a', refresh_token: 'r2', expires_in: 3600 }); } });
    assert.equal(refreshUrl, 'http://localhost:9999/test/atlassian/oauth/token');
  });

  test('N3: the refresh caller stays on the real host when the override is unset or NODE_ENV !== "test"', async () => {
    delete process.env.JIRA_OAUTH_TEST_BASE;
    let refreshUrl;
    await refreshJiraAccessToken('r1', { fetchImpl: async (url) => { refreshUrl = url; return okResponse({ access_token: 'a', refresh_token: 'r2', expires_in: 3600 }); } });
    assert.equal(refreshUrl, 'https://auth.atlassian.com/oauth/token');

    process.env.JIRA_OAUTH_TEST_BASE = 'http://localhost:9999/test/atlassian';
    process.env.NODE_ENV = 'production';
    await refreshJiraAccessToken('r1', { fetchImpl: async (url) => { refreshUrl = url; return okResponse({ access_token: 'a', refresh_token: 'r2', expires_in: 3600 }); } });
    assert.equal(refreshUrl, 'https://auth.atlassian.com/oauth/token');
  });
});

// ---------------------------------------------------------------------------
// Step 3 — the client fork
// ---------------------------------------------------------------------------

describe('LIN-1887 Step 3 — createJiraClient forks on authType', () => {
  function capturingFetch(captured) {
    return async (url, opts) => { captured.push({ url, headers: opts.headers }); return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({}), text: async () => '{}' }; };
  }

  test('OAuth: a Bearer header against the api.atlassian.com gateway, not the tenant', async () => {
    const captured = [];
    const client = createJiraClient({ authType: 'oauth', accessToken: 'at-1', cloudId: 'cid-1', site: 'https://acme.atlassian.net', fetchImpl: capturingFetch(captured) });
    await client.getMyself();
    assert.equal(captured[0].url, 'https://api.atlassian.com/ex/jira/cid-1/rest/api/3/myself');
    assert.equal(captured[0].headers.Authorization, 'Bearer at-1');
  });

  test('Basic (Phase 1): unchanged — a Basic header against the tenant base', async () => {
    const captured = [];
    const client = createJiraClient({ email: 'a@b.c', apiToken: 'tok', site: 'https://acme.atlassian.net', fetchImpl: capturingFetch(captured) });
    await client.getMyself();
    assert.equal(captured[0].url, 'https://acme.atlassian.net/rest/api/3/myself');
    assert.equal(captured[0].headers.Authorization, `Basic ${Buffer.from('a@b.c:tok').toString('base64')}`);
  });

  test('the header branches on authType, not on the falsiness of email', async () => {
    // `linkProvider`'s merge can make a key falsy but never absent, so an
    // upgraded binding that "cleared" email yields `{email: undefined}`. Under
    // the old presence test that dropped the header by COINCIDENCE (a clean 401
    // rather than a leak). An explicit discriminator makes the outcome stop
    // depending on that accident.
    const captured = [];
    const client = createJiraClient({ authType: 'oauth', email: undefined, apiToken: 'stale-basic-token', accessToken: 'at-1', cloudId: 'cid-1', fetchImpl: capturingFetch(captured) });
    await client.getMyself();
    assert.equal(captured[0].headers.Authorization, 'Bearer at-1', 'a stale Basic field must not resurrect the Basic header');
  });

  test('the https-only guard still rejects a plaintext tenant base', () => {
    assert.throws(() => createJiraClient({ email: 'a@b.c', apiToken: 't', site: 'http://acme.atlassian.net' }), /must be an https:\/\/ URL/);
  });
});

describe('LIN-1887 Step 3 — JiraProvider._clientFor accepts both shapes and fails closed', () => {
  const provider = new JiraProvider({ clientFactory: (c) => ({ credential: c }) });

  test('routes an OAuth scope to the OAuth client shape', () => {
    const built = provider._clientFor({ authType: 'oauth', accessToken: 'at', cloudId: 'cid', site: 'https://acme.atlassian.net' });
    assert.deepEqual(built.credential, { authType: 'oauth', accessToken: 'at', cloudId: 'cid', site: 'https://acme.atlassian.net' });
  });

  test('routes a Basic scope to the unchanged Basic shape', () => {
    const built = provider._clientFor({ email: 'a@b.c', apiToken: 't', site: 'https://acme.atlassian.net' });
    assert.deepEqual(built.credential, { email: 'a@b.c', apiToken: 't', site: 'https://acme.atlassian.net' });
  });

  test('an OAuth scope missing its cloudId throws rather than falling back to a boot client', () => {
    assert.throws(() => provider._clientFor({ authType: 'oauth', accessToken: 'at' }), /missing accessToken\/cloudId/);
  });
});

// ---------------------------------------------------------------------------
// Step 5 / Step 6 — the binding write and the call-scope projections
// ---------------------------------------------------------------------------

describe('LIN-1887 Step 5 — the OAuth binding carries a REAL expiry', () => {
  test('the access token lands in credentials.token (the scalar mirror’s source) and the expiry is finite', () => {
    const workspace = { urlKey: 'acme', provider: 'jira' };
    const expiry = Date.now() + 3_600_000;
    linkProvider(workspace, 'jira', 'https://acme.atlassian.net', { token: 'at-1', authType: 'oauth', cloudId: 'cid-1', tokenExpiresAt: expiry });

    assert.equal(workspace.accessToken, 'at-1', 'anywhere but credentials.token silently breaks the scalar mirror');
    assert.equal(workspace.tokenExpiresAt, expiry);
    assert.ok(workspace.tokenExpiresAt < Number.MAX_SAFE_INTEGER, 'the Phase 1 sentinel is a LIE for an OAuth token — it keeps a lapsed token resolving forever on the headless lane');
  });

  test('the refresh token is never mirrored onto the binding or the workspace', () => {
    const workspace = { urlKey: 'acme', provider: 'jira' };
    linkProvider(workspace, 'jira', 'https://acme.atlassian.net', { token: 'at-1', authType: 'oauth', cloudId: 'cid-1', tokenExpiresAt: 1 });
    assert.equal(workspace.refreshToken, undefined);
    assert.equal(workspace.credentials.refreshToken, undefined);
    assert.equal(workspace.bindings[0].credentials.refreshToken, undefined);
  });

  test('mirrorActiveBinding carries the real expiry AND the discriminator across a re-point', async () => {
    // `setActiveProvider` re-points the scalar mirror from the binding. If the
    // expiry did not travel, a re-point would resurrect the Phase 1 sentinel's
    // behaviour (never expires -> never refreshes) on an OAuth binding, and if
    // `authType` did not travel the merged `workspace.credentials` would read as
    // Basic. `mirrorActiveBinding` full-replaces `workspace.credentials`, which
    // is what makes both true — pinned here because Step 5 depends on it.
    const { setActiveProvider } = await import('../../lib/workspace.js');
    const expiry = Date.now() + 3_600_000;
    const workspace = { urlKey: 'acme', provider: 'linear', accessToken: 'linear-tok', tokenExpiresAt: Number.MAX_SAFE_INTEGER, bindings: [] };
    linkProvider(workspace, 'linear', 'org-1', { token: 'linear-tok', tokenExpiresAt: Number.MAX_SAFE_INTEGER });
    linkProvider(workspace, 'jira', 'https://acme.atlassian.net', { token: 'at-1', authType: 'oauth', cloudId: 'cid-1', tokenExpiresAt: expiry });

    setActiveProvider(workspace, 'jira', 'https://acme.atlassian.net');

    assert.equal(workspace.provider, 'jira');
    assert.equal(workspace.accessToken, 'at-1');
    assert.equal(workspace.tokenExpiresAt, expiry, 'the real expiry must survive the re-point');
    assert.equal(workspace.credentials.authType, 'oauth');
    assert.equal(workspace.credentials.refreshToken, undefined, 'and the rotating credential is still nowhere near the session object');
  });

  test('D1: a same-site Basic→OAuth link is an upgrade IN PLACE, and authType is what stops the merge being read as Basic', () => {
    // Bindings key on `(provider, scope)` and MERGE, so two shapes cannot
    // coexist on one site. Without the discriminator the merged binding would
    // build `Basic base64(email:<oauth access token>)` aimed at the tenant.
    const workspace = { urlKey: 'acme', provider: 'jira' };
    linkProvider(workspace, 'jira', 'https://acme.atlassian.net', { token: 'basic-tok', email: 'a@b.c', tokenExpiresAt: Number.MAX_SAFE_INTEGER });
    linkProvider(workspace, 'jira', 'https://acme.atlassian.net', { token: 'at-1', authType: 'oauth', cloudId: 'cid-1', tokenExpiresAt: 42 });

    assert.equal(workspace.bindings.length, 1, 'an upgrade in place, not a second binding');
    const scope = getWorkspaceCallScope(workspace);
    assert.equal(scope.authType, 'oauth');
    assert.equal(scope.accessToken, 'at-1');
    assert.equal(scope.cloudId, 'cid-1');
    assert.equal(scope.apiToken, undefined, 'the OAuth access token must never be projected as a Basic apiToken');
  });
});

describe('LIN-1887 Step 6 — the Jira projections branch on authType', () => {
  const basicBinding = { provider: 'jira', scope: 'https://acme.atlassian.net', credentials: { token: 'tok', email: 'a@b.c' } };
  const oauthBinding = { provider: 'jira', scope: 'https://acme.atlassian.net', credentials: { token: 'at-1', authType: 'oauth', cloudId: 'cid-1' } };

  test('getBindingCallScope: the Basic projection is byte-identical to HEAD', () => {
    assert.deepEqual(getBindingCallScope(basicBinding), { email: 'a@b.c', apiToken: 'tok', site: 'https://acme.atlassian.net' });
  });

  test('getBindingCallScope: the OAuth projection carries cloudId and the discriminator', () => {
    assert.deepEqual(getBindingCallScope(oauthBinding), { authType: 'oauth', accessToken: 'at-1', cloudId: 'cid-1', site: 'https://acme.atlassian.net' });
  });

  test('getWorkspaceCallScope: a single-binding Basic workspace is byte-identical to HEAD', () => {
    const workspace = { urlKey: 'acme', provider: 'jira', accessToken: 'tok', bindings: [basicBinding] };
    assert.deepEqual(getWorkspaceCallScope(workspace), { email: 'a@b.c', apiToken: 'tok', site: 'https://acme.atlassian.net' });
  });
});

describe('LIN-1887 F3.3 — the selectors refuse to guess, in BOTH copies', () => {
  test('Jira: two bindings and a mirror matching neither no longer pairs site A’s scope with site B’s token', () => {
    // HEAD: `{email: 'a@x.io', apiToken: 'rotated-token-not-yet-in-any-binding', site: 'https://a.atlassian.net'}`
    // — i.e. authenticated against the WRONG tenant.
    const workspace = {
      urlKey: 'acme', provider: 'jira', accessToken: 'rotated-token-not-yet-in-any-binding',
      bindings: [
        { provider: 'jira', scope: 'https://a.atlassian.net', credentials: { token: 'tok-a', email: 'a@x.io' } },
        { provider: 'jira', scope: 'https://b.atlassian.net', credentials: { token: 'tok-b', email: 'b@x.io' } },
      ],
    };
    const scope = getWorkspaceCallScope(workspace);
    assert.equal(scope, AMBIGUOUS_CALL_SCOPE);
    assert.notEqual(scope.site, 'https://a.atlassian.net', 'the wrong-tenant pairing must be gone entirely, not merely reordered');
  });

  test('Jira: the refusal fails CLOSED and loudly at _clientFor', () => {
    const provider = new JiraProvider({ clientFactory: () => ({}) });
    assert.throws(() => provider._clientFor(AMBIGUOUS_CALL_SCOPE), /refusing to guess which site/);
  });

  test('a SINGLE-binding workspace keeps HEAD’s unambiguous fallback exactly', () => {
    const workspace = {
      urlKey: 'acme', provider: 'jira', accessToken: 'rotated-not-in-the-binding',
      bindings: [{ provider: 'jira', scope: 'https://a.atlassian.net', credentials: { token: 'tok-a', email: 'a@x.io' } }],
    };
    assert.deepEqual(getWorkspaceCallScope(workspace), { email: 'a@x.io', apiToken: 'rotated-not-in-the-binding', site: 'https://a.atlassian.net' });
  });

  test('github and github-projects get the SAME refusal — and their own explicit throw', async () => {
    // The github half is NOT the same three lines as Jira's: `_clientFor`
    // accepts `repo ?? null` / `board ?? null` by design, so merely dropping the
    // scope would be swallowed into a silent scope-LESS call rather than a
    // wrong-repo one. Hence an explicit failure on each.
    const { GitHubProvider } = await import('../../lib/providers/github/index.js');
    const { GitHubProjectsProvider } = await import('../../lib/providers/github-projects/index.js');

    for (const [provider, expected] of [['github', /refusing to guess which repo/], ['github-projects', /refusing to guess which board/]]) {
      const workspace = {
        urlKey: 'acme', provider, accessToken: 'rotated-not-in-any-binding',
        bindings: [
          { provider, scope: 'org/one', credentials: { token: 'tok-1' } },
          { provider, scope: 'org/two', credentials: { token: 'tok-2' } },
        ],
      };
      assert.equal(getWorkspaceCallScope(workspace), AMBIGUOUS_CALL_SCOPE, `${provider} must refuse too`);
      const instance = provider === 'github' ? new GitHubProvider() : new GitHubProjectsProvider();
      assert.throws(() => instance._clientFor(AMBIGUOUS_CALL_SCOPE), expected);
    }
  });

  test('a single-binding github workspace’s resolved scope is byte-identical to HEAD', () => {
    const workspace = { urlKey: 'acme', provider: 'github', accessToken: 'rotated', bindings: [{ provider: 'github', scope: 'org/one', credentials: { token: 'tok-1' } }] };
    assert.deepEqual(getWorkspaceCallScope(workspace), { token: 'rotated', repo: 'org/one' });
  });
});

// ---------------------------------------------------------------------------
// Step 9 — the add-source entry point
// ---------------------------------------------------------------------------

describe('LIN-1887 Step 9 — the OAuth flow is reachable from Settings', () => {
  const render = (opts) => renderSettingsPage('Acme', { urlKey: 'acme', providerBindings: [], ...opts });

  test('the Jira row offers an explicit CHOICE of auth shape (D5), each carrying its authType', () => {
    const html = render({ jiraOAuthEnabled: true });
    assert.match(html, /data-testid="settings-provider-add-btn-jira-basic"/);
    assert.match(html, /data-testid="settings-provider-add-btn-jira-oauth"/);
    assert.match(html, /<input type="hidden" name="authType" value="oauth">/);
  });

  test('an unconfigured server disables the OAuth OPTION and leaves the Basic add working', () => {
    // The gate belongs on the option, not the row: Basic needs no server config,
    // so a row-level gate would disable an add path validated in production on
    // 2026-08-07.
    const html = render({ jiraOAuthEnabled: false });
    assert.match(html, /data-testid="settings-provider-add-btn-jira-basic"/, 'the Basic add must survive a missing Atlassian app');
    assert.match(html, /data-testid="settings-provider-add-btn-jira-oauth-blocked"/);
    assert.doesNotMatch(html, /data-testid="settings-provider-add-btn-jira-oauth"[^-]/);
    assert.match(html, /data-testid="settings-provider-add-jira"/, 'the ROW itself stays enabled');
  });

  test('the GitHub rows are unchanged by the auth-shape mechanism', () => {
    const html = render({ githubEnabled: true });
    assert.match(html, /data-testid="settings-provider-add-github"/);
    assert.match(html, /data-testid="settings-provider-add-btn"/, 'a provider with one auth shape renders the original single button');
    const blocked = render({ githubEnabled: false });
    assert.match(blocked, /data-testid="settings-provider-add-github"[\s\S]{0,400}GitHub is not configured/);
  });
});
