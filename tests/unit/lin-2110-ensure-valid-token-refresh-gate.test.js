/**
 * LIN-2110 — ensureValidToken's proactive (expiry-triggered) refresh no
 * longer spends one OAuth exchange per request when the provider hands back
 * byte-identical access-token bytes.
 *
 * Same harness convention as tests/unit/lin-1887-refresh-strategy-dispatch.test.js
 * (server.js is not import-safe in a unit test — it connects to Mongo and
 * listens at module load): the REAL `ensureValidToken` body is sliced out of
 * server.js and executed in a `node:vm` context, with the REAL
 * `refreshOnResolveGate`/`fingerprintCredential`/`CREDENTIAL_LIFECYCLE_EVENT_KINDS`
 * bound (this ticket's whole point is the gate's actual behavior, not a mock
 * of it) and only I/O boundaries (the exchange, the durable store, session
 * persistence) faked.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

import { removeWorkspace, normalizeProvider } from '../../lib/workspace.js';
import { serviceUnavailable } from '../../lib/errors.js';
import { REFRESH_STRATEGY, refreshDeclarationFor, relinkNotice } from '../../lib/refresh-strategy.js';
import { TokenRefreshError } from '../../lib/token-refresh.js';
import { fingerprintCredential } from '../../lib/credential-diagnostics.js';
import { createRefreshOnResolveGate, DEFAULT_REFRESH_ON_RESOLVE_COOLDOWN_MS } from '../../lib/refresh-on-resolve-gate.js';
import { CREDENTIAL_LIFECYCLE_EVENT_KINDS } from '../../lib/credential-lifecycle-events.js';

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

const handleWorkspaceRemovalSrc = () => sliceBetween(
  'async function handleWorkspaceRemoval(session, workspaceId, res, deleteDurable = true) {',
  '\n/**\n * Attempts to refresh an expired token and retry the request.'
);

/**
 * One shared gate instance across the calls a single test makes (passed in,
 * never created fresh per call) — the whole point is proving state persists
 * ACROSS requests, which a fresh-per-call gate would hide by construction.
 */
function makeContext({ workspace, durableRecord, calls, refreshOnResolveGate }) {
  const session = {
    accountId: 'acct-1',
    activeWorkspaceId: workspace.id,
    workspaces: [workspace],
    destroy(cb) { calls.sessionDestroyed = true; cb(null); },
  };

  return vm.createContext({
    REFRESH_STRATEGY,
    refreshDeclarationFor,
    relinkNotice,
    normalizeProvider,
    removeWorkspace,
    serviceUnavailable,
    isDefinitiveRevocation: () => false,
    isTransientRefreshFailure: (e) => e instanceof TokenRefreshError && e.code !== 'EXPIRED',

    renderErrorPage: () => '<error/>',
    refreshOwnerCredential: async (args) => {
      calls.refreshCalls.push({ provider: args.provider, urlKey: args.urlKey });
      return { token: durableRecord?.nextToken ?? durableRecord?.token, expiresAt: Date.now() + 3600_000, provider: workspace.provider || 'linear' };
    },
    remintActiveCredential: async () => { calls.remint++; },
    refreshAccessToken: Object.assign(async () => ({}), { __name: 'linear' }),
    refreshJiraAccessToken: Object.assign(async () => ({}), { __name: 'jira' }),
    getProviderForWorkspace: () => ({ name: workspace.provider }),
    applyAccessTokenToWorkspace: (ws, token, expiresAt) => { ws.accessToken = token; ws.tokenExpiresAt = expiresAt; },
    saveSession: async () => { calls.save++; },
    handleTokenRefreshAndRetry: async () => {},
    evictAllWorkspaceTokens: () => {},
    evictWorkspaceToken: () => {},
    evictWorkspaceTokenPair: () => {},
    ownerCredentialStore: {
      get: async (_a, _u, provider) => { calls.durableGets.push(provider); return durableRecord ?? null; },
      delete: async () => {},
      deleteAll: async () => {},
    },
    credentialLifecycleEventStore: {
      recordEvent: async (evt) => { calls.lifecycleEvents.push(evt); },
    },
    getActiveWorkspace: () => workspace,
    TOKEN_REFRESH_BUFFER_MS: 5 * 60 * 1000,
    fingerprintCredential,
    refreshOnResolveGate,
    CREDENTIAL_LIFECYCLE_EVENT_KINDS,
    getDeployInfo: () => ({}),
    renderLandingPage: () => '<landing/>',
    getProvider: () => ({ entryCta: { isConfigured: () => true } }),
    Date,
    process: { env: {} },
    console: { log() {}, warn() {}, error() {} },
    __session: session,
  });
}

function freshCalls() {
  return { refreshCalls: [], durableGets: [], lifecycleEvents: [], remint: 0, save: 0, sessionDestroyed: false, nextCalled: false };
}

/** Execute the REAL ensureValidToken body once, against a shared gate. */
async function runOnce({ workspace, durableRecord, refreshOnResolveGate }) {
  const calls = freshCalls();
  const context = makeContext({ workspace, durableRecord, calls, refreshOnResolveGate });
  const res = {
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    send(p) { this.body = p; return this; },
    redirect(t) { this.body = `redirect:${t}`; return this; },
  };
  const script = [
    handleWorkspaceRemovalSrc(),
    ensureValidTokenSrc(),
    sliceBetween('const REFRESH_EXCHANGES = {', '\n/**\n * Render the non-destructive'),
    sliceBetween('function sendRelinkNotice(workspace, res) {', '\n/**\n * Middleware to ensure access token is valid'),
    'ensureValidToken',
  ].join('\n');
  const fn = vm.runInContext(script, context);
  const req = { session: context.__session };
  await fn(req, res, () => { calls.nextCalled = true; });
  return { calls, res, workspace };
}

const expiredLinear = (over) => ({ id: 'w-x', urlKey: 'acme', provider: undefined, tokenExpiresAt: Date.now() - 10_000, ...over });
const expiredGithub = (over) => ({ id: 'w-g', urlKey: 'acme', provider: 'github', installationId: 'inst-1', tokenExpiresAt: Date.now() - 10_000, ...over });

describe('LIN-2110 — the proactive OAuth-exchange arm is gated against a byte-identical exchange', () => {
  test('a byte-identical exchange (same durable token before and after) attempts once, then is suppressed on the very next request', async () => {
    const gate = createRefreshOnResolveGate();
    const durableRecord = { token: 'lin_dead_token' }; // refreshOwnerCredential fake echoes this back (byte-identical)

    const first = await runOnce({ workspace: expiredLinear(), durableRecord, refreshOnResolveGate: gate });
    assert.equal(first.calls.refreshCalls.length, 1, 'first request attempts the exchange');
    assert.equal(first.calls.nextCalled, true);

    const second = await runOnce({ workspace: expiredLinear(), durableRecord, refreshOnResolveGate: gate });
    assert.equal(second.calls.refreshCalls.length, 0, 'second request within the cooldown window is suppressed — no exchange spent');
    assert.equal(second.calls.nextCalled, true, 'the request still proceeds — current token kept, 401 ladder owns any real failure');
    assert.equal(second.calls.sessionDestroyed, false, 'suppression is the NONE-strategy fail-safe shape: no teardown');
    assert.equal(second.calls.lifecycleEvents.length, 1);
    assert.equal(second.calls.lifecycleEvents[0].kind, CREDENTIAL_LIFECYCLE_EVENT_KINDS.REFRESH_SKIP);
    assert.equal(second.calls.lifecycleEvents[0].detail.branch, 'ensure-valid-token-cooldown-gate');
  });

  test('five consecutive expired-and-frozen requests spend exactly ONE exchange, not five — the defect this ticket fixes', async () => {
    const gate = createRefreshOnResolveGate();
    const durableRecord = { token: 'lin_dead_token' };
    let exchanges = 0;
    for (let i = 0; i < 5; i++) {
      const { calls } = await runOnce({ workspace: expiredLinear(), durableRecord, refreshOnResolveGate: gate });
      exchanges += calls.refreshCalls.length;
    }
    assert.equal(exchanges, 1, 'pre-LIN-2110 this was 5/5 (PR #1138 case A) — the loop had no exit');
  });

  test('a GENUINELY new durable credential (different fingerprint) is never throttled by a prior dead one, even seconds later', async () => {
    const gate = createRefreshOnResolveGate();
    const first = await runOnce({ workspace: expiredLinear(), durableRecord: { token: 'lin_dead_token' }, refreshOnResolveGate: gate });
    assert.equal(first.calls.refreshCalls.length, 1);

    // A human re-authorized in between — the durable record now carries a
    // DIFFERENT credential. Immediately after (well inside the cooldown).
    const second = await runOnce({ workspace: expiredLinear(), durableRecord: { token: 'lin_fresh_token_after_reauth' }, refreshOnResolveGate: gate });
    assert.equal(second.calls.refreshCalls.length, 1, 'a new credential fingerprints differently and is never gated by the old one\'s cooldown');
  });

  test('the gate re-opens once the cooldown window elapses for the SAME fingerprint', async () => {
    // The gate's OWN clock (injected at construction, per its real
    // constructor contract) — not the VM's `Date`, which the real
    // refreshOnResolveGate instance lives outside of and never reads.
    let t = 1_000_000;
    const gate = createRefreshOnResolveGate({ now: () => t });
    const durableRecord = { token: 'lin_dead_token' };

    const first = await runOnce({ workspace: expiredLinear(), durableRecord, refreshOnResolveGate: gate });
    assert.equal(first.calls.refreshCalls.length, 1);

    t += DEFAULT_REFRESH_ON_RESOLVE_COOLDOWN_MS + 1;
    const second = await runOnce({ workspace: expiredLinear(), durableRecord, refreshOnResolveGate: gate });
    assert.equal(second.calls.refreshCalls.length, 1, 'cooldown elapsed — the gate attempts again, matching the bounded (not zero) exposure the ticket accepts');
  });

  test('no durable record at all (nothing to fingerprint) is never gated — falls straight through to the pre-existing failure handling', async () => {
    const gate = createRefreshOnResolveGate();
    const first = await runOnce({ workspace: expiredLinear(), durableRecord: null, refreshOnResolveGate: gate });
    // refreshOwnerCredential's fake still gets called (the gate always attempts
    // with no fingerprint to bound); its own null-token echo is a separate,
    // pre-existing failure path unrelated to this ticket's gate.
    assert.equal(first.calls.refreshCalls.length, 1);
  });

  test('REMINT (GitHub-family) never consults the gate — repeated re-mints are unaffected', async () => {
    const gate = createRefreshOnResolveGate();
    for (let i = 0; i < 3; i++) {
      const { calls } = await runOnce({ workspace: expiredGithub(), durableRecord: null, refreshOnResolveGate: gate });
      assert.equal(calls.remint, 1, 'each request re-mints — never suppressed, never durable-store-gated');
      assert.equal(calls.durableGets.length, 0, 'REMINT never reads the durable store the gate would key on');
    }
  });
});
