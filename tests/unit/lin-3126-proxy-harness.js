/**
 * LIN-3241 (LIN-3126 slice 2) shared proxy-lane test harness.
 *
 * The proxy routes resolve credentials through `resolveProviderAccess`
 * (`routes/proxy.js`), which calls the injected `resolveWorkspaceAccess`. This
 * harness runs the REAL `server.js` `resolveWorkspaceAccess` body (vm-executed,
 * the same technique `lin-3126-proxy-selector.test.js` uses) over the REAL
 * connection-first arm (`lib/connection-credential.js`), mounted on a REAL
 * `createProxyRoutes` app with a recording fake provider.
 *
 * Extracted so the two plan-named files that need the proxy lane —
 * `lin-3126-acceptance-witness.test.js` (slice-2 witness (b)) and
 * `lin-3126-creation-default.test.js` (the proxy creation row) — share ONE
 * harness rather than duplicating it.
 */
import express from 'express';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createConnectionAccess } from '../../lib/connection-credential.js';
import { fingerprintCredential } from '../../lib/credential-diagnostics.js';
import { workspaceTokenCacheKey, createWorkspaceTokenCache } from '../../lib/workspace-token-cache.js';
import { UNSCOPED, TOKEN_REFRESH_BUFFER_MS, selectOwnerWorkspaceToken, classifyWorkspaceFailure, describeWorkspaceResolution } from '../../lib/workspace-token-resolver.js';
import { selectOwnerWorkspaceTokenExcludingSuperseded } from '../../lib/superseded-selection.js';
import { createRejectedCredentialRegistry } from '../../lib/rejected-credentials.js';
import { CREDENTIAL_LIFECYCLE_EVENT_KINDS } from '../../lib/credential-lifecycle-events.js';
import { CREDENTIAL_SOURCES } from '../../lib/credential-diagnostics.js';
import { createProxyRoutes } from '../../routes/proxy.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_SRC = readFileSync(join(__dirname, '../../server.js'), 'utf8');

export const REPO_A = 'octo/repoA';
export const REPO_B = 'octo/repoB';
export const INSTALLATION_ID = '99';
export const CONNECTION_ID = 'acct::github::99';
export const BUFFER = 5 * 60 * 1000;
export const OWNER = 'acct';

const future = () => Date.now() + 3_600_000;

/** A live GitHub Connection whose `unitId` is the App installation id, not a repo. */
export function githubConnection() {
  return {
    _id: CONNECTION_ID,
    accountId: OWNER,
    provider: 'github',
    unitId: INSTALLATION_ID,
    credentials: { token: 'tok-a', installationId: INSTALLATION_ID, tokenExpiresAt: future() },
    referents: [],
  };
}

/** The owner's session-row workspace: repoA active, repoB beside it, one Connection. */
export function twoRepoOwnerRow() {
  return {
    session: {
      workspaces: [{
        urlKey: 'acme',
        provider: 'github',
        bindings: [
          { provider: 'github', scope: REPO_A, connectionId: CONNECTION_ID },
          { provider: 'github', scope: REPO_B, connectionId: CONNECTION_ID },
        ],
        activeBinding: { provider: 'github', scope: REPO_A },
      }],
    },
    workspaceIndex: 0,
  };
}

export function stripSrcComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

export function extractResolveBody(src) {
  const start = src.indexOf('async function resolveWorkspaceAccess');
  if (start < 0) throw new Error('async function resolveWorkspaceAccess not found in server.js');
  const end = src.indexOf('\n}', start);
  if (end < 0) throw new Error("could not find resolveWorkspaceAccess's top-level closing brace");
  return src.slice(start, end + 2);
}

/** A cache that records calls but ALWAYS misses (the pre-LIN-1507 spy). */
export function makeSpyCache() {
  return {
    gets: [],
    sets: [],
    get(key) { this.gets.push(key); return undefined; },
    set(key, value) { this.sets.push({ key, value }); return true; },
  };
}

/**
 * A cache that RECORDS get/set/evict but actually HOLDS entries (a real
 * `createWorkspaceTokenCache` under the hood), so warm-entry and eviction
 * behaviour is exercised rather than trivially missed.
 */
export function makeHoldingCache({ ttlMs = 30_000, blockWindowMs, now } = {}) {
  const inner = createWorkspaceTokenCache({ ttlMs, blockWindowMs, now });
  return {
    gets: [],
    sets: [],
    evicts: [],
    inner,
    get(key) { this.gets.push(key); return inner.get(key); },
    set(key, value) { this.sets.push({ key, value }); return inner.set(key, value); },
    evict(key) { this.evicts.push(key); return inner.evict(key); },
  };
}

/** Execute the REAL server.js resolveWorkspaceAccess body with injected collaborators. */
export function makeVmResolver({ sessions = [], connectionAccess = { resolveConnectionBackedAccess: async () => null }, cache = makeSpyCache() } = {}) {
  const context = vm.createContext({
    UNSCOPED, TOKEN_REFRESH_BUFFER_MS,
    selectOwnerWorkspaceToken, classifyWorkspaceFailure, describeWorkspaceResolution,
    selectOwnerWorkspaceTokenExcludingSuperseded,
    rejectedCredentialRegistry: createRejectedCredentialRegistry(),
    CREDENTIAL_SOURCES, fingerprintCredential, CREDENTIAL_LIFECYCLE_EVENT_KINDS,
    accountStore: { resolveCanonicalAccountId: async (id) => id },
    workspaceTokenCacheKey,
    sessionsCollection: { find: () => ({ toArray: async () => sessions }) },
    workspaceTokenCache: cache,
    ownerCredentialStore: { get: async () => null },
    refreshOnResolveGate: { shouldAttempt: () => false },
    credentialLifecycleEventStore: { recordEvent: async () => {} },
    attemptSuspectCredentialRefresh: async () => null,
    connectionAccess,
    console: { log() {}, warn() {}, error() {} },
    process: { env: {} },
  });
  const script = extractResolveBody(SERVER_SRC) + '\nresolveWorkspaceAccess';
  const fn = vm.runInContext(script, context);
  return { fn, cache };
}

/** The real connection-first arm for a two-repo owner (repoA active). */
export function twoRepoConnectionAccess() {
  return createConnectionAccess({
    connectionStore: { readConnectionsByReferent: async () => [githubConnection()] },
    ownerCredentialStore: { getByConnection: async () => null },
    refreshConnection: async () => null,
    resolveCanonicalAccountId: async (id) => id,
    selectOwnerSessionRow: () => twoRepoOwnerRow(),
    normalizeProvider: (ws) => ws?.provider || 'linear',
    fingerprintCredential,
    gate: { shouldAttempt: () => true },
    lifecycleEventStore: { recordEvent: async () => {} },
    bufferMs: BUFFER,
  });
}

/** The real vm resolver + two-repo arm, returning `{ fn, cache }`. */
export function makeTwoRepoResolver({ cache, extraSessions = [] } = {}) {
  const ownerRow = twoRepoOwnerRow();
  const ownerSession = { accountId: OWNER, workspaces: ownerRow.session.workspaces };
  const connectionAccess = twoRepoConnectionAccess();
  return makeVmResolver({
    sessions: [{ _id: 'sid', session: ownerSession }, ...extraSessions],
    connectionAccess,
    cache,
  });
}

/** The default proxy-route dependency set; `provider` records call scopes. */
export function buildProxyApp({ resolveWorkspaceAccess, provider, extraDeps = {} }) {
  const captured = {};
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      mintGrantBootstrap: async () => ({ token: 'b', kind: 'bootstrap', scope: 'readWrite' }),
      createToken: async () => ({ token: 'b', kind: 'bootstrap', scope: 'readWrite' }),
      validateToken: async () => ({
        grants: ['dispatch'], workspaceId: 'ws-acme', tokenId: 't1', urlKey: 'acme',
        label: 'test', scope: 'readWrite', createdBy: OWNER,
      }),
    },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess,
    getWorkspaceAccessToken: async () => null,
    getWorkspaceOpenRouterKey: async () => null,
    agentStatusStore: {},
    recapCacheStore: { get: async () => null, set: async () => {} },
    briefCacheStore: { get: async () => null, set: async () => {} },
    dispatchQueueStore: {
      getGrantDeclaration: async () => ({ state: 'none' }),
      addItem: async (urlKey, item) => { captured.item = item; return { _id: 'disp-1', ...item }; },
    },
    workspaceFromUrl: (req, res, next) => next(),
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
    freeTierStore: { tryUse: async () => ({ allowed: true }) },
    provider,
    ...extraDeps,
  }));
  return { app, captured };
}

export async function callProxy(app, method, path, body) {
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise(resolve => server.once('listening', resolve));
    const { port } = server.address();
    const opts = { method, headers: { Authorization: 'Bearer anything' } };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(`http://127.0.0.1:${port}${path}`, opts);
    const text = await res.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
    return { status: res.status, body: parsed, text };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

/** Provider for `GET /api/proxy/issues/:id`, recording each `issueDetail` scope. */
export function issueDetailProvider(calls) {
  return {
    name: 'github',
    ui: { displayName: 'GitHub', name: 'github' },
    supports: () => true,
    issueDetail: async (scope, issueId) => {
      calls.push(scope);
      return { id: issueId, identifier: 'GB-1', title: 'repoB', description: 'REPO_B_MARKER', state: { name: 'Todo', type: 'unstarted' } };
    },
  };
}

/** Provider for `POST /api/proxy/issues`, recording each `createIssue` scope. */
export function createIssueProvider(calls) {
  return {
    name: 'github',
    ui: { displayName: 'GitHub', name: 'github' },
    supports: () => true,
    createFields: () => [],
    apiWriteFields: () => [],
    createIssue: async (scope, input) => {
      calls.push({ method: 'createIssue', scope, input });
      return { success: true, issue: { id: 'new-1', identifier: 'NEW-1', title: input.title } };
    },
  };
}
