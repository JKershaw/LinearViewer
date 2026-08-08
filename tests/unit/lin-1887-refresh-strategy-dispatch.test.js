/**
 * LIN-1887 Step 1 — ONE provider-declared refresh strategy, read by BOTH
 * dispatches.
 *
 * Two of these pins were RED on HEAD before this change, and that is the real
 * signal — a pin that was already green enforces nothing:
 *
 *   (a) proactive, `provider: 'jira'`, expired → HEAD:
 *       `{linearSeamCalled: 1, remainingWorkspaces: 0, sessionDestroyed: true}`
 *   (c) reactive, a `none`-strategy provider's first 401 → HEAD:
 *       `{removed: [{id:'w-x'}], sessionDestroyed: true}`
 *
 * Both dispatches are sliced out of the REAL server.js and executed in a
 * `node:vm` context (server.js is not import-safe in a unit test — it connects
 * to Mongo and listens at module load). The strategy table, `removeWorkspace`
 * and `serviceUnavailable` are the REAL implementations; only I/O boundaries are
 * faked. This is the same harness convention as
 * `lin-1885-jira-401-workspace-preservation.test.js` and
 * `lin-1503-github-family-401-remint-behaviour.test.js`.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

import { removeWorkspace, normalizeProvider } from '../../lib/workspace.js';
import { serviceUnavailable } from '../../lib/errors.js';
import { REFRESH_STRATEGY, refreshDeclarationFor, refreshStrategyFor, relinkNotice } from '../../lib/refresh-strategy.js';
import { TokenRefreshError } from '../../lib/token-refresh.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_SRC = readFileSync(join(__dirname, '../../server.js'), 'utf8');

function sliceBetween(startMarker, endMarker) {
  const startIdx = SERVER_SRC.indexOf(startMarker);
  assert.notEqual(startIdx, -1, `expected to find ${startMarker.slice(0, 60)} in server.js`);
  const endIdx = SERVER_SRC.indexOf(endMarker, startIdx);
  assert.notEqual(endIdx, -1, `expected the marker bounding ${startMarker.slice(0, 60)}`);
  return SERVER_SRC.slice(startIdx, endIdx);
}

const ensureValidTokenSrc = () => sliceBetween(
  'async function ensureValidToken(req, res, next) {',
  '\n// Apply middleware to all routes except auth and logout'
);

const handleUnauthorizedErrorSrc = () => sliceBetween(
  'async function handleUnauthorizedError(workspace, session, teamId, openRouterSource, res) {',
  '\n/**\n * Home page'
);

const handleWorkspaceRemovalSrc = () => sliceBetween(
  'async function handleWorkspaceRemoval(session, workspaceId, res, deleteDurable = true) {',
  '\n/**\n * Attempts to refresh an expired token and retry the request.'
);

/** The shared collaborator set both dispatches are executed against. */
function makeContext({ workspace, extraWorkspaces = [], durableRecord = null, calls, refreshResult, remintResult, definitiveRevocation = false }) {
  const session = {
    accountId: 'acct-1',
    activeWorkspaceId: workspace.id,
    workspaces: [workspace, ...extraWorkspaces],
    destroy(cb) { calls.sessionDestroyed = true; cb(null); },
  };

  return vm.createContext({
    // Real: the declaration table under test, plus the genuine session mutation
    // and the genuine retryable-503 response.
    REFRESH_STRATEGY,
    refreshDeclarationFor,
    relinkNotice,
    normalizeProvider,
    removeWorkspace,
    serviceUnavailable,
    isDefinitiveRevocation: () => definitiveRevocation,
    isTransientRefreshFailure: (e) => e instanceof TokenRefreshError && e.code !== 'EXPIRED',

    // Faked I/O.
    renderErrorPage: (title, message, opts) => { calls.renderErrorPage.push({ title, message, opts }); return `<error:${title}>`; },
    refreshOwnerCredential: async (args) => {
      calls.refreshCalls.push({ provider: args.provider, urlKey: args.urlKey });
      // Identify WHICH exchange was handed over — the "Linear seam un-called"
      // assertion is about the exchange, not just the seam.
      calls.exchangesUsed.push(args.refreshAccessToken?.__name ?? 'unknown');
      if (typeof refreshResult === 'function') return refreshResult(args);
      return refreshResult;
    },
    remintActiveCredential: async () => { calls.remint++; return remintResult; },
    refreshAccessToken: Object.assign(async () => ({}), { __name: 'linear' }),
    refreshJiraAccessToken: Object.assign(async () => ({}), { __name: 'jira' }),
    getProviderForWorkspace: () => ({ name: workspace.provider }),
    applyAccessTokenToWorkspace: (ws, token, expiresAt) => { ws.accessToken = token; ws.tokenExpiresAt = expiresAt; },
    saveSession: async () => { calls.save++; },
    renderDashboardAfterRefresh: async () => 'RENDERED',
    handleTokenRefreshAndRetry: async (...args) => { calls.tokenRefreshAndRetry++; return args; },
    evictAllWorkspaceTokens: () => { calls.evictAll++; },
    evictWorkspaceToken: () => {},
    evictWorkspaceTokenPair: (_e, urlKey) => { calls.evictions.push(urlKey); },
    ownerCredentialStore: {
      get: async (_a, _u, provider) => { calls.durableGets.push(provider); return durableRecord; },
      delete: async (accountId, urlKey, provider) => { calls.durableDeletes.push([accountId, urlKey, provider]); },
      deleteAll: async (accountId, urlKey) => { calls.durableDeleteAlls.push([accountId, urlKey]); },
    },
    getActiveWorkspace: () => workspace,
    TOKEN_REFRESH_BUFFER_MS: 5 * 60 * 1000,
    getDeployInfo: () => ({}),
    renderLandingPage: () => '<landing/>',
    isGitHubConfigured: () => true,
    Date,
    process: { env: {} },
    console: { log() {}, warn() {}, error() {} },
    __session: session,
  });
}

function freshCalls() {
  return {
    renderErrorPage: [], refreshCalls: [], exchangesUsed: [], durableGets: [], durableDeletes: [],
    durableDeleteAlls: [], evictions: [], remint: 0, save: 0, evictAll: 0, tokenRefreshAndRetry: 0,
    sessionDestroyed: false, nextCalled: false,
  };
}

/** Execute the REAL ensureValidToken body. */
async function runProactive(opts) {
  const calls = freshCalls();
  const context = makeContext({ ...opts, calls });
  const res = {
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    send(p) { this.body = p; return this; },
    redirect(t) { this.body = `redirect:${t}`; return this; },
  };
  const script = [
    handleWorkspaceRemovalSrc(),
    ensureValidTokenSrc(),
    // The helpers ensureValidToken calls, reproduced from server.js by SLICE, so
    // a change to either is caught here rather than silently modelled.
    sliceBetween('const REFRESH_EXCHANGES = {', '\n/**\n * Render the non-destructive'),
    sliceBetween('function sendRelinkNotice(workspace, res) {', '\n/**\n * Middleware to ensure access token is valid'),
    'ensureValidToken',
  ].join('\n');
  const fn = vm.runInContext(script, context);
  const req = { session: context.__session };
  await fn(req, res, () => { calls.nextCalled = true; });
  return { calls, res, session: context.__session };
}

/** Execute the REAL handleUnauthorizedError body. */
async function runReactive(opts) {
  const calls = freshCalls();
  const context = makeContext({ ...opts, calls });
  const res = {
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    send(p) { this.body = p; return this; },
    redirect(t) { this.body = `redirect:${t}`; return this; },
  };
  const script = [
    handleWorkspaceRemovalSrc(),
    handleUnauthorizedErrorSrc(),
    sliceBetween('const REFRESH_EXCHANGES = {', '\n/**\n * Render the non-destructive'),
    sliceBetween('function sendRelinkNotice(workspace, res) {', '\n/**\n * Middleware to ensure access token is valid'),
    'handleUnauthorizedError',
  ].join('\n');
  const fn = vm.runInContext(script, context);
  await fn(opts.workspace, context.__session, 'team-1', null, res);
  return { calls, res, session: context.__session };
}

const expired = (over) => ({ id: 'w-x', urlKey: 'acme', tokenExpiresAt: Date.now() - 10_000, ...over });

// ---------------------------------------------------------------------------
// The declaration itself
// ---------------------------------------------------------------------------

describe('LIN-1887 Step 1 — the declaration normalises before the table read (G2)', () => {
  test('a LEGACY providerless workspace reads Linear’s row, not the undeclared default', () => {
    // The mutation this guards: a table keyed on the raw `workspace.provider`
    // with a `?? 'none'` default silently routes every pre-binding workspace to
    // "nothing to refresh". It looks like a one-character choice.
    assert.deepEqual(refreshDeclarationFor({ urlKey: 'a' }), { strategy: REFRESH_STRATEGY.OAUTH_REFRESH, destructiveOnFailure: true });
    assert.equal(refreshStrategyFor({ provider: undefined }), REFRESH_STRATEGY.OAUTH_REFRESH);
  });

  test('each declared provider gets its own strategy', () => {
    assert.equal(refreshStrategyFor({ provider: 'linear' }), REFRESH_STRATEGY.OAUTH_REFRESH);
    assert.equal(refreshStrategyFor({ provider: 'github' }), REFRESH_STRATEGY.REMINT);
    assert.equal(refreshStrategyFor({ provider: 'github-projects' }), REFRESH_STRATEGY.REMINT);
    assert.equal(refreshStrategyFor({ provider: 'jira' }), REFRESH_STRATEGY.OAUTH_REFRESH);
    assert.equal(refreshStrategyFor({ provider: 'local' }), REFRESH_STRATEGY.NONE);
  });

  test('an UNDECLARED provider gets the fail-safe, not Linear’s exchange', () => {
    // The whole point: adding a provider without touching this table can no
    // longer route its credential into Linear's endpoint and delete the
    // workspace when that fails.
    assert.deepEqual(refreshDeclarationFor({ provider: 'gitlab' }), { strategy: REFRESH_STRATEGY.NONE, destructiveOnFailure: false });
  });
});

describe('LIN-1887 G3 — the non-destructive response is provider-appropriate', () => {
  test('a `local` workspace is NOT told to reconnect Jira', () => {
    const notice = relinkNotice({ provider: 'local', urlKey: 'acme' });
    assert.doesNotMatch(notice.message, /Jira/, 'the pre-LIN-1887 response was Jira’s, hard-coded');
    assert.doesNotMatch(notice.action, /Jira/);
    assert.equal(notice.actionUrl, '/workspace/acme/settings');
  });

  test('a Basic Jira workspace keeps LIN-1885’s copy byte-for-byte', () => {
    const notice = relinkNotice({ provider: 'jira', urlKey: 'acme', bindings: [{ provider: 'jira', scope: 'https://acme.atlassian.net', credentials: { token: 't', email: 'a@b.c' } }], accessToken: 't' });
    assert.equal(notice.title, 'Access Token Invalid');
    assert.equal(notice.message, 'Your Jira API token is no longer valid. Reconnect Jira with a fresh API token to continue.');
    assert.equal(notice.action, 'Reconnect Jira');
    assert.equal(notice.actionUrl, '/auth/jira?workspace=acme');
  });

  test('an OAuth Jira workspace is pointed at the OAuth re-link, not the API-token form', () => {
    const notice = relinkNotice({ provider: 'jira', urlKey: 'acme', accessToken: 't', bindings: [{ provider: 'jira', scope: 'https://acme.atlassian.net', credentials: { token: 't', authType: 'oauth', cloudId: 'cid' } }] });
    assert.match(notice.actionUrl, /^\/auth\/jira\/oauth\?/);
    assert.doesNotMatch(notice.message, /API token/);
  });
});

// ---------------------------------------------------------------------------
// (a) The proactive dispatch
// ---------------------------------------------------------------------------

describe('LIN-1887 Step 1(a) — proactive: a jira workspace never reaches Linear’s exchange [RED on HEAD]', () => {
  test('an expired jira workspace refreshes through the JIRA exchange, and survives when it cannot', async () => {
    // HEAD: `{linearSeamCalled: 1, remainingWorkspaces: 0, sessionDestroyed: true}`.
    const workspace = expired({ provider: 'jira' });
    const { calls, session, res } = await runProactive({ workspace, refreshResult: null });

    assert.deepEqual(calls.exchangesUsed, ['jira'], 'the Linear exchange must never be handed a Jira credential');
    assert.deepEqual(calls.refreshCalls, [{ provider: 'jira', urlKey: 'acme' }], 'and the durable read is jira-partitioned');
    assert.equal(session.workspaces.length, 1, 'the workspace must survive a failed Jira refresh');
    assert.equal(calls.sessionDestroyed, false);
    assert.deepEqual(calls.durableDeletes, [], 'nothing revoked');
    assert.deepEqual(calls.evictions, []);
    assert.equal(res.statusCode, 401, 'the user gets an actionable re-link page, not a deletion');
  });

  test('a successful jira refresh mirrors the token and continues the request', async () => {
    const workspace = expired({ provider: 'jira' });
    const { calls } = await runProactive({
      workspace,
      refreshResult: { token: 'fresh-jira', expiresAt: Date.now() + 3_600_000, provider: 'jira' },
    });
    assert.equal(calls.nextCalled, true);
    assert.equal(workspace.accessToken, 'fresh-jira');
  });

  test('(d) a LEGACY providerless expired workspace still routes to the Linear arm', async () => {
    const workspace = expired({});
    const { calls } = await runProactive({
      workspace,
      refreshResult: { token: 'fresh', expiresAt: Date.now() + 3_600_000, provider: 'linear' },
    });
    assert.deepEqual(calls.exchangesUsed, ['linear']);
    assert.deepEqual(calls.refreshCalls, [{ provider: 'linear', urlKey: 'acme' }]);
    assert.equal(calls.nextCalled, true);
  });

  test('(b) Linear’s removal-on-missing-credential semantics are unchanged', async () => {
    const workspace = expired({ provider: 'linear' });
    const { calls, session } = await runProactive({ workspace, refreshResult: null });
    assert.equal(session.workspaces.length, 0, 'a Linear workspace with no refreshable credential IS disconnected');
    assert.equal(calls.sessionDestroyed, true);
    assert.deepEqual(calls.evictions, ['acme']);
  });

  test('(b) github-family still re-mints and never touches the durable seam', async () => {
    for (const provider of ['github', 'github-projects']) {
      const workspace = expired({ provider });
      const { calls } = await runProactive({ workspace });
      assert.equal(calls.remint, 1, `${provider} must re-mint`);
      assert.deepEqual(calls.refreshCalls, [], `${provider} must never reach the durable exchange`);
      assert.equal(calls.nextCalled, true);
    }
  });

  test('a `none` provider is not refreshed, and above all is not removed', async () => {
    const workspace = expired({ provider: 'local' });
    const { calls, session, res } = await runProactive({ workspace });
    assert.deepEqual(calls.refreshCalls, []);
    assert.equal(calls.remint, 0);
    assert.equal(session.workspaces.length, 1);
    assert.equal(calls.sessionDestroyed, false);
    assert.equal(res.statusCode, 401);
  });

  test('the durable delete on a definitive revocation is PARTITIONED to the routed provider (N2)', async () => {
    const workspace = expired({ provider: 'linear' });
    const { calls } = await runProactive({
      workspace,
      definitiveRevocation: true,
      refreshResult: () => { throw new TokenRefreshError('invalid_grant', 'EXPIRED'); },
    });
    assert.deepEqual(calls.durableDeletes, [['acct-1', 'acme', 'linear']], 'the partition deleted is the one that was ROUTED');
  });
});

// ---------------------------------------------------------------------------
// (c) The reactive dispatch — the half that made HEAD's fail-safe only half a
// fail-safe.
// ---------------------------------------------------------------------------

describe('LIN-1887 Step 1(c) — reactive: a `none` provider survives its first 401 [RED on HEAD]', () => {
  test('renders re-link and removes nothing', async () => {
    // HEAD: `{removed: [{id:'w-x'}], sessionDestroyed: true}` — the workspace the
    // proactive fail-safe spared was destroyed one hop later, here.
    const workspace = { id: 'w-x', urlKey: 'acme', provider: 'local' };
    const { calls, session, res } = await runReactive({ workspace });

    assert.equal(session.workspaces.length, 1, 'must not be removed');
    assert.equal(calls.sessionDestroyed, false);
    assert.equal(calls.tokenRefreshAndRetry, 0);
    assert.deepEqual(calls.durableDeletes, []);
    assert.deepEqual(calls.durableDeleteAlls, []);
    assert.deepEqual(calls.evictions, []);
    assert.equal(calls.evictAll, 0);
    assert.equal(res.statusCode, 401);
    assert.doesNotMatch(calls.renderErrorPage[0].message, /Jira/, 'and is not told to reconnect Jira (G3)');
  });

  test('a BASIC jira 401 is byte-for-byte LIN-1885’s response', async () => {
    const workspace = { id: 'w-x', urlKey: 'acme', provider: 'jira' };
    const { calls, session } = await runReactive({ workspace, durableRecord: null });
    assert.equal(calls.tokenRefreshAndRetry, 0, 'no durable record → nothing to refresh');
    assert.equal(session.workspaces.length, 1);
    assert.equal(calls.sessionDestroyed, false);
    assert.equal(calls.renderErrorPage[0].title, 'Access Token Invalid');
    assert.equal(calls.renderErrorPage[0].message, 'Your Jira API token is no longer valid. Reconnect Jira with a fresh API token to continue.');
    assert.equal(calls.renderErrorPage[0].opts.actionUrl, '/auth/jira?workspace=acme');
  });

  test('an OAUTH jira 401 DOES attempt a refresh — the Phase 1 branch could not (Step 7)', async () => {
    const workspace = { id: 'w-x', urlKey: 'acme', provider: 'jira' };
    const { calls } = await runReactive({ workspace, durableRecord: { refreshToken: 'JIRA-RT', provider: 'jira' } });
    assert.deepEqual(calls.durableGets, ['jira'], 'the durable read is jira-partitioned — never Linear’s');
    assert.equal(calls.tokenRefreshAndRetry, 1);
  });

  test('a FAILED oauth jira refresh degrades to the re-link page and never reaches handleWorkspaceRemoval', async () => {
    const workspace = { id: 'w-x', urlKey: 'acme', provider: 'jira' };
    const context = { workspace, durableRecord: { refreshToken: 'JIRA-RT', provider: 'jira' }, definitiveRevocation: true };
    const calls = freshCalls();
    const ctx = makeContext({ ...context, calls });
    ctx.handleTokenRefreshAndRetry = async () => { throw new TokenRefreshError('invalid_grant', 'EXPIRED'); };
    const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, send(p) { this.body = p; return this; }, redirect(t) { this.body = `redirect:${t}`; return this; } };
    const fn = vm.runInContext([
      handleWorkspaceRemovalSrc(),
      handleUnauthorizedErrorSrc(),
      sliceBetween('const REFRESH_EXCHANGES = {', '\n/**\n * Render the non-destructive'),
      sliceBetween('function sendRelinkNotice(workspace, res) {', '\n/**\n * Middleware to ensure access token is valid'),
      'handleUnauthorizedError',
    ].join('\n'), ctx);
    await fn(workspace, ctx.__session, 'team-1', null, res);

    assert.equal(ctx.__session.workspaces.length, 1, 'a dead Jira token must not strand a co-resident workspace');
    assert.equal(calls.sessionDestroyed, false);
    assert.deepEqual(calls.durableDeleteAlls, [], 'handleWorkspaceRemoval must not be reached');
    assert.equal(res.statusCode, 401);
  });

  test('(b) Linear’s reactive ladder is unchanged: refresh when there is a durable record, remove when there is not', async () => {
    const withRecord = await runReactive({ workspace: { id: 'w-x', urlKey: 'acme', provider: 'linear' }, durableRecord: { refreshToken: 'R0', provider: 'linear' } });
    assert.equal(withRecord.calls.tokenRefreshAndRetry, 1);
    assert.deepEqual(withRecord.calls.durableGets, ['linear']);

    const without = await runReactive({ workspace: { id: 'w-x', urlKey: 'acme', provider: 'linear' }, durableRecord: null });
    assert.equal(without.session.workspaces.length, 0, 'no durable record → genuinely disconnected → removed');
    assert.equal(without.calls.sessionDestroyed, true);
  });

  test('(b) a LEGACY providerless 401 still takes the Linear ladder', async () => {
    const { calls } = await runReactive({ workspace: { id: 'w-x', urlKey: 'acme' }, durableRecord: { refreshToken: 'R0', provider: 'linear' } });
    assert.deepEqual(calls.durableGets, ['linear']);
    assert.equal(calls.tokenRefreshAndRetry, 1);
  });

  test('(b) github-family still re-mints, ahead of any durable read', async () => {
    const { calls } = await runReactive({ workspace: { id: 'w-x', urlKey: 'acme', provider: 'github' } });
    assert.equal(calls.remint, 1);
    assert.deepEqual(calls.durableGets, [], 'the re-mint arm must never perform a durable read');
  });

  test('whole-workspace removal deletes EVERY partition (N2)', async () => {
    const { calls } = await runReactive({ workspace: { id: 'w-x', urlKey: 'acme', provider: 'linear' }, durableRecord: null });
    assert.deepEqual(calls.durableDeleteAlls, [['acct-1', 'acme']], 'a single-partition delete here would orphan the sibling');
  });
});

// ---------------------------------------------------------------------------
// Close-out F2 — non-destructive spares the WORKSPACE, not a revoked credential
// ---------------------------------------------------------------------------

describe('LIN-1887 close-out F2 — a definitively-revoked non-destructive credential is revoked from its own partition', () => {
  // The defect these pin: both non-destructive early returns sat BEFORE their
  // dispatch's durable delete, so a Jira `invalid_grant` rendered the re-link
  // page and left the dead rotating Atlassian token in the store indefinitely.
  // The fix must revoke the dead partition and NOTHING else — sparing the
  // workspace is the whole point of the branch it lives in.
  const revoked = () => { throw new TokenRefreshError('invalid_grant', 'EXPIRED'); };

  test('proactive: the jira partition is deleted, while the workspace, its sibling and the session all survive', async () => {
    const workspace = expired({ provider: 'jira' });
    const { calls, session, res } = await runProactive({
      workspace,
      extraWorkspaces: [{ id: 'w-y', urlKey: 'other', provider: 'linear' }],
      definitiveRevocation: true,
      refreshResult: revoked,
    });

    assert.deepEqual(calls.durableDeletes, [['acct-1', 'acme', 'jira']], 'exactly the dead partition — never Linear’s, never a deleteAll');
    assert.deepEqual(calls.durableDeleteAlls, [], 'the whole-workspace verb would take every co-resident partition with it');
    assert.equal(session.workspaces.length, 2, 'F2 is a hygiene fix, not a licence to remove the workspace');
    assert.equal(calls.sessionDestroyed, false);
    assert.deepEqual(calls.evictions, [], 'eviction tracks session-side removal, which did not happen');
    assert.equal(res.statusCode, 401, 'the user still gets the actionable re-link page');
  });

  test('reactive: the same, on a 401 whose refresh comes back definitively revoked', async () => {
    const workspace = { id: 'w-x', urlKey: 'acme', provider: 'jira' };
    const calls = freshCalls();
    const ctx = makeContext({
      workspace,
      extraWorkspaces: [{ id: 'w-y', urlKey: 'other', provider: 'linear' }],
      durableRecord: { refreshToken: 'JIRA-RT', provider: 'jira' },
      definitiveRevocation: true,
      calls,
    });
    ctx.handleTokenRefreshAndRetry = async () => revoked();
    const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, send(p) { this.body = p; return this; }, redirect(t) { this.body = `redirect:${t}`; return this; } };
    const fn = vm.runInContext([
      handleWorkspaceRemovalSrc(),
      handleUnauthorizedErrorSrc(),
      sliceBetween('const REFRESH_EXCHANGES = {', '\n/**\n * Render the non-destructive'),
      sliceBetween('function sendRelinkNotice(workspace, res) {', '\n/**\n * Middleware to ensure access token is valid'),
      'handleUnauthorizedError',
    ].join('\n'), ctx);
    await fn(workspace, ctx.__session, 'team-1', null, res);

    assert.deepEqual(calls.durableDeletes, [['acct-1', 'acme', 'jira']]);
    assert.deepEqual(calls.durableDeleteAlls, [], 'handleWorkspaceRemoval must still not be reached');
    assert.equal(ctx.__session.workspaces.length, 2);
    assert.equal(calls.sessionDestroyed, false);
    assert.equal(res.statusCode, 401);
  });

  test('a NON-definitive failure still keeps the credential, in both dispatches', async () => {
    // The gate is LIN-1545's, shared with the destructive arm: a transient blip
    // returns a 503 earlier, and a plain Error (the "no durable credential"
    // throw, or a post-refresh save failure where the token may in fact have
    // just rotated) must never delete a record it cannot prove is dead.
    const proactive = await runProactive({ workspace: expired({ provider: 'jira' }), refreshResult: null });
    assert.deepEqual(proactive.calls.durableDeletes, []);

    const calls = freshCalls();
    const ctx = makeContext({
      workspace: { id: 'w-x', urlKey: 'acme', provider: 'jira' },
      durableRecord: { refreshToken: 'JIRA-RT', provider: 'jira' },
      calls,
    });
    ctx.handleTokenRefreshAndRetry = async () => { throw new Error('post-refresh render blew up'); };
    const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, send(p) { this.body = p; return this; } };
    const fn = vm.runInContext([
      handleWorkspaceRemovalSrc(),
      handleUnauthorizedErrorSrc(),
      sliceBetween('const REFRESH_EXCHANGES = {', '\n/**\n * Render the non-destructive'),
      sliceBetween('function sendRelinkNotice(workspace, res) {', '\n/**\n * Middleware to ensure access token is valid'),
      'handleUnauthorizedError',
    ].join('\n'), ctx);
    await fn({ id: 'w-x', urlKey: 'acme', provider: 'jira' }, ctx.__session, 'team-1', null, res);
    assert.deepEqual(calls.durableDeletes, []);
  });

  test('the DESTRUCTIVE providers are unchanged: Linear still deletes-and-removes, github-family still never reads the store', async () => {
    // The control that matters — F2 adds a delete to the branch Linear never
    // enters, so Linear's own delete must still be the one below it (fired
    // alongside removal), and github-family must still reach neither.
    const linear = await runProactive({
      workspace: expired({ provider: 'linear' }),
      definitiveRevocation: true,
      refreshResult: revoked,
    });
    assert.deepEqual(linear.calls.durableDeletes, [['acct-1', 'acme', 'linear']]);
    assert.equal(linear.session.workspaces.length, 0, 'Linear’s removal-on-revocation semantics are byte-for-byte');
    assert.equal(linear.calls.sessionDestroyed, true);

    for (const provider of ['github', 'github-projects']) {
      const { calls } = await runProactive({ workspace: expired({ provider }), definitiveRevocation: true });
      assert.deepEqual(calls.durableDeletes, [], `${provider} re-mints and owns no durable record`);
      assert.deepEqual(calls.durableDeleteAlls, []);
    }
  });
});

// ---------------------------------------------------------------------------
// Step 10 — the monitor's key
// ---------------------------------------------------------------------------

describe('LIN-1887 Step 10 — the refresh monitor keys on a stable log string', () => {
  test('the log line still carries the keyed prefix, and now names the provider so the monitor can filter to Jira', () => {
    // Per LIN-1579 the two discriminating signals for this ticket (a session
    // surviving past `expires_in`; a headless proxy call after expiry) are
    // ELAPSED-TIME and route to a named monitor, never a pre-merge gate. The
    // monitor keys on the LOG STRING, never on a line number — Step 1 edits the
    // function directly above it, so the number moves. This is the pin that
    // stops the key itself moving silently.
    assert.match(SERVER_SRC, /console\.log\(`Token refreshed for workspace \$\{workspace\.id\} \(provider=\$\{provider\}\)`\)/);
    // The keyed prefix must remain a contiguous substring — appending is safe,
    // interpolating INTO it is not.
    assert.ok(SERVER_SRC.includes('Token refreshed for workspace ${workspace.id}'));
  });

  test('a mislabelled durable record fails loudly rather than silently, so the credential-gate has a watchable signal too', async () => {
    const { refreshOwnerCredential, _resetInflightForTests } = await import('../../lib/workspace-token-refresh.js');
    _resetInflightForTests();
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (msg) => warnings.push(String(msg));
    try {
      const store = { async get() { return { provider: 'jira', refreshToken: 'JIRA-RT' }; } };
      const result = await refreshOwnerCredential({ ownerAccountId: 'a', urlKey: 'acme', provider: 'linear', store, refreshAccessToken: async () => { throw new Error('must not be called'); } });
      assert.equal(result, null);
    } finally {
      console.warn = originalWarn;
    }
    assert.equal(warnings.length, 1, 'the refusal must be observable, not a silent null');
    assert.match(warnings[0], /labelled jira in the linear partition/);
  });
});
