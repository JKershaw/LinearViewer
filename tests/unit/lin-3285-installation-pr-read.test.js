// LIN-3285: a Linear- or Jira-bound workspace reads PR state with the workspace
// OWNER's GitHub App installation token, only when the installation covering the
// PR's repo is one of the owner's own. Everything else stays anonymous.
//
// All fakes: the GitHub API is a function handed in as `fetchImpl`, the App key
// is generated here, and no socket is opened.
//
// Run with: node --test tests/unit/lin-3285-installation-pr-read.test.js

import { test, describe, beforeEach, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  readsPrViaOwnerInstallation,
  resolvePrReadToken,
  clearFailOpenPrStatus,
} from '../../lib/github-pr-status.js';
import { createInstallationTokenResolver, INSTALLATION_KEYED_PROVIDERS } from '../../lib/connection-credential.js';
import { readRunEvidence } from '../../lib/run-evidence.js';
import { readPrStatuses, closeOutNotReady } from '../../lib/close-out-readiness.js';
import { createChatToolCatalog } from '../../lib/chat-tools.js';
import { createTaskPageLoader } from '../../lib/task-page-loader.js';
import { createPrStateStore, clearPrStateCache } from '../../lib/pr-state-store.js';
import { enrichLoop, deriveSessionWaiting } from '../../routes/dashboard.js';
import { getAllProviders } from '../../lib/providers/registry.js';
import { unitIdForBinding } from '../../lib/connection-binding.js';

const REPO = 'acme/widget';
const PR_URL = `https://github.com/${REPO}/pull/12`;
const MINTED = 'ghs_minted_installation_token';
const MINTED_AUTH = `Bearer ${MINTED}`;
const OWNER = 'acct-owner';
const OTHER = 'acct-other';
const WS = 'ws-id-1';
const NOW = Date.parse('2026-10-19T12:00:00.000Z');

before(() => {
  process.env.NODE_ENV = 'test';
  const { privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  process.env.GITHUB_APP_ID = '12345';
  process.env.GITHUB_APP_PRIVATE_KEY = privateKey;
});

beforeEach(() => { clearFailOpenPrStatus(); clearPrStateCache(); });

function res(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    headers: { get: name => headers[name.toLowerCase()] ?? null },
    async json() { return body; },
    async text() { return JSON.stringify(body); },
  };
}

/**
 * One fake GitHub: the App endpoints (JWT-authed) and the PR REST endpoints
 * (403 without a Bearer, answers a normal open PR with one). `coveredBy` is the
 * installation id that covers REPO (null → 404 "not installed").
 */
function fakeGitHub({ coveredBy = 'inst-1', mintStatus = 201, repoLookupStatus = 200, throwOn = null, expiresInMs = 60 * 60 * 1000, clock = () => NOW } = {}) {
  const calls = [];
  const impl = async (url, opts = {}) => {
    const headers = opts.headers || {};
    calls.push({ url, method: opts.method || 'GET', auth: headers.Authorization || null });
    if (throwOn && throwOn.test(url)) throw new Error('socket hang up');
    if (/\/repos\/[^/]+\/[^/]+\/installation$/.test(url)) {
      if (repoLookupStatus !== 200) return res(repoLookupStatus, { message: 'boom' });
      if (coveredBy === null) return res(404, { message: 'Not Found' });
      return res(200, { id: Number.isNaN(Number(coveredBy)) ? coveredBy : coveredBy });
    }
    const mint = url.match(/\/app\/installations\/([^/]+)\/access_tokens$/);
    if (mint) {
      if (mintStatus !== 201) return res(mintStatus, { message: 'mint failed' });
      return res(201, { token: MINTED, expires_at: new Date(clock() + expiresInMs).toISOString() });
    }
    if (!headers.Authorization) return res(403, { message: 'API rate limit exceeded' }, { 'x-ratelimit-remaining': '0' });
    if (/\/repos\/[^/]+\/[^/]+$/.test(url)) return res(200, { private: true });
    if (/\/pulls\/\d+$/.test(url)) return res(200, { state: 'open', merged: false, head: { ref: 'f', sha: 'abc1234' }, base: { ref: 'main' }, mergeable: true });
    if (/\/check-runs$/.test(url)) return res(200, { check_runs: [{ name: 'unit', conclusion: 'success' }] });
    if (/\/status$/.test(url)) return res(200, { state: 'success', statuses: [] });
    return res(404, {});
  };
  impl.calls = calls;
  impl.prCalls = () => calls.filter(c => /\/(pulls|check-runs|status)\b|\/repos\/[^/]+\/[^/]+$/.test(c.url) && !/installation/.test(c.url));
  impl.appCalls = () => calls.filter(c => /installation/.test(c.url));
  return impl;
}

function connection(accountId, provider, installationId, extra = {}) {
  return { accountId, provider, unitId: String(installationId), credentials: { installationId: String(installationId) }, referents: [], ...extra };
}

/** Build the seam over fakes. `rows` are the connection rows; `owners` maps workspace id → owner account id. */
function makeSeam({ rows = [], owners = { [WS]: OWNER }, ownerAnswer, github = fakeGitHub(), clock = () => NOW, fetchImpl: fetchImplOverride = undefined, noFetch = false } = {}) {
  const fetchImpl = noFetch ? undefined : (fetchImplOverride ?? github);
  const readLog = [];
  const connectionStore = {
    async readConnectionsByAccountPrefix(accountId) {
      readLog.push(accountId);
      return rows.filter(r => r.accountId === accountId);
    },
  };
  const ownerChecks = [];
  const workspaceOwnerCheck = async (args) => {
    ownerChecks.push(args);
    if (ownerAnswer) return ownerAnswer(args);
    return owners[args.workspaceId] === args.accountId ? { status: 'owner' } : { status: 'not-owner' };
  };
  const installationTokenFor = createInstallationTokenResolver({
    connectionStore,
    resolveCanonicalAccountId: id => id,
    getWorkspaceOwnerAccountId: async id => owners[id] ?? null,
    workspaceOwnerCheck,
    fetchImpl,
    now: clock,
  });
  return { installationTokenFor, github, readLog, ownerChecks };
}

const linearProvider = (comments = [{ id: 'c1', body: `opened ${PR_URL}`, createdAt: '2026-10-19T11:00:00.000Z' }]) => ({
  name: 'linear',
  async fetchIssueComments() { return comments; },
});

describe('readsPrViaOwnerInstallation / resolvePrReadToken', () => {
  test('keyed on provider kind: linear and jira only', () => {
    assert.equal(readsPrViaOwnerInstallation('linear'), true);
    assert.equal(readsPrViaOwnerInstallation('jira'), true);
    for (const k of ['github', 'github-projects', 'local', undefined, null, '']) {
      assert.equal(readsPrViaOwnerInstallation(k), false, String(k));
    }
  });

  test('provider-kind table over the registry: only linear and jira ask for the installation', async () => {
    for (const p of getAllProviders()) {
      let asked = 0;
      await resolvePrReadToken({ callScope: 'x', repo: REPO, providerKind: p.name, workspaceId: WS, installationTokenFor: async () => { asked++; return 't'; } });
      const expected = p.name === 'linear' || p.name === 'jira' ? 1 : 0;
      assert.equal(asked, expected, `${p.name} must${expected ? '' : ' not'} ask for the owner installation`);
    }
    assert.deepEqual(getAllProviders().map(p => p.name).sort(), ['github', 'github-projects', 'jira', 'linear', 'local']);
  });

  test('a GitHub-bound scope on its own repo uses its own token; the seam is never called', async () => {
    let asked = 0;
    const token = await resolvePrReadToken({
      callScope: { repo: REPO, token: 'own_tok' }, repo: REPO, providerKind: 'github', workspaceId: WS,
      installationTokenFor: async () => { asked++; return 'inst'; },
    });
    assert.equal(token, 'own_tok');
    assert.equal(asked, 0);
  });

  test('GitHub-bound, another repo: anonymous, seam not called (GitHub kind)', async () => {
    let asked = 0;
    const token = await resolvePrReadToken({
      callScope: { repo: REPO, token: 'own_tok' }, repo: 'other/repo', providerKind: 'github', workspaceId: WS,
      installationTokenFor: async () => { asked++; return 'inst'; },
    });
    assert.equal(token, null);
    assert.equal(asked, 0);
  });

  test('Jira Basic and Jira OAuth scopes both reach the seam (a shape rule would lose OAuth)', async () => {
    const seen = [];
    const installationTokenFor = async (a) => { seen.push(a); return 'inst'; };
    const basic = { email: 'a@b.c', apiToken: 'x', site: 'https://s.atlassian.net' };
    const oauth = { authType: 'oauth', accessToken: 'y', cloudId: 'c', site: 'https://s.atlassian.net' };
    assert.equal(await resolvePrReadToken({ callScope: basic, repo: REPO, providerKind: 'jira', workspaceId: WS, installationTokenFor }), 'inst');
    assert.equal(await resolvePrReadToken({ callScope: oauth, repo: REPO, providerKind: 'jira', workspaceId: WS, installationTokenFor }), 'inst');
    assert.equal(await resolvePrReadToken({ callScope: 'lin_key', repo: REPO, providerKind: 'linear', workspaceId: WS, installationTokenFor }), 'inst');
    assert.deepEqual(seen.map(s => s.workspaceId), [WS, WS, WS]);
  });

  test('no workspaceId, no seam, a throwing seam, a non-string answer: anonymous, never a throw', async () => {
    const ok = async () => 'inst';
    assert.equal(await resolvePrReadToken({ callScope: 'k', repo: REPO, providerKind: 'linear', workspaceId: null, installationTokenFor: ok }), null);
    assert.equal(await resolvePrReadToken({ callScope: 'k', repo: REPO, providerKind: 'linear', workspaceId: WS }), null);
    assert.equal(await resolvePrReadToken({ callScope: 'k', repo: REPO, providerKind: 'linear', workspaceId: WS, installationTokenFor: async () => { throw new Error('x'); } }), null);
    assert.equal(await resolvePrReadToken({ callScope: 'k', repo: REPO, providerKind: 'linear', workspaceId: WS, installationTokenFor: async () => ({ token: 'obj' }) }), null);
  });
});

describe('createInstallationTokenResolver', () => {
  test('the owner\'s installation covers the repo → the minted token', async () => {
    const { installationTokenFor, github } = makeSeam({ rows: [connection(OWNER, 'github', 'inst-1')] });
    assert.equal(await installationTokenFor({ workspaceId: WS, repo: REPO }), MINTED);
    assert.equal(github.appCalls().length, 2, 'one repo lookup, one mint');
    assert.ok(github.appCalls().every(c => /^Bearer [\w-]+\.[\w-]+\.[\w-]+$/.test(c.auth)), 'both are App-JWT authed');
  });

  test('cross-account witness: the covering installation belongs to ANOTHER account → null, and no mint', async () => {
    const { installationTokenFor, github } = makeSeam({
      rows: [connection(OWNER, 'github', 'inst-mine'), connection(OTHER, 'github', 'inst-1')],
      github: fakeGitHub({ coveredBy: 'inst-1' }),
    });
    assert.equal(await installationTokenFor({ workspaceId: WS, repo: REPO }), null);
    assert.equal(github.calls.filter(c => c.method === 'POST').length, 0, 'never minted for an installation that is not the owner\'s');
  });

  test('an installation held on the owner\'s github-projects connection covers the repo', async () => {
    const { installationTokenFor } = makeSeam({ rows: [connection(OWNER, 'github-projects', 'inst-1')] });
    assert.equal(await installationTokenFor({ workspaceId: WS, repo: REPO }), MINTED);
  });

  test('the same installation held on another account\'s github-projects connection → null', async () => {
    const { installationTokenFor } = makeSeam({ rows: [connection(OTHER, 'github-projects', 'inst-1')] });
    assert.equal(await installationTokenFor({ workspaceId: WS, repo: REPO }), null);
  });

  test('a legacy put-born row (no referents array) is not the owner\'s installation', async () => {
    const row = connection(OWNER, 'github', 'inst-1');
    delete row.referents;
    const { installationTokenFor } = makeSeam({ rows: [row] });
    assert.equal(await installationTokenFor({ workspaceId: WS, repo: REPO }), null);
  });

  test('no owner → null with no GitHub call', async () => {
    const { installationTokenFor, github } = makeSeam({ rows: [connection(OWNER, 'github', 'inst-1')], owners: {} });
    assert.equal(await installationTokenFor({ workspaceId: WS, repo: REPO }), null);
    assert.equal(github.calls.length, 0);
  });

  test('a non-owner / no-owner / unrecognised owner answer, or an owner-check throw → null', async () => {
    for (const answer of [() => ({ status: 'not-owner' }), () => ({ status: 'no-owner' }), () => null, () => ({ status: 'maybe' }), () => { throw new Error('store down'); }]) {
      const { installationTokenFor, github } = makeSeam({ rows: [connection(OWNER, 'github', 'inst-1')], ownerAnswer: answer });
      assert.equal(await installationTokenFor({ workspaceId: WS, repo: REPO }), null);
      assert.equal(github.calls.length, 0);
    }
  });

  test('the viewer is irrelevant: the owner check is asked about the OWNER, whoever is looking', async () => {
    const { installationTokenFor, ownerChecks, readLog } = makeSeam({ rows: [connection(OWNER, 'github', 'inst-1')] });
    // The function takes no viewer input; extra fields are ignored.
    assert.equal(await installationTokenFor({ workspaceId: WS, repo: REPO, accountId: OTHER, viewer: OTHER }), MINTED);
    assert.deepEqual(ownerChecks, [{ workspaceId: WS, accountId: OWNER }]);
    assert.ok(readLog.every(a => a === OWNER), 'connections are read for the owner only');
  });

  test('errors fail open: a throwing fetch, a repo-lookup 500, a mint 500, no App config', async () => {
    const rows = [connection(OWNER, 'github', 'inst-1')];
    for (const github of [
      fakeGitHub({ throwOn: /./ }),
      fakeGitHub({ repoLookupStatus: 500 }),
      fakeGitHub({ mintStatus: 500 }),
      fakeGitHub({ coveredBy: null }),
    ]) {
      const { installationTokenFor } = makeSeam({ rows, github });
      assert.equal(await installationTokenFor({ workspaceId: WS, repo: REPO }), null);
    }
    const saved = process.env.GITHUB_APP_ID;
    delete process.env.GITHUB_APP_ID;
    try {
      const { installationTokenFor } = makeSeam({ rows });
      assert.equal(await installationTokenFor({ workspaceId: WS, repo: REPO }), null);
    } finally { process.env.GITHUB_APP_ID = saved; }
  });

  test('an omitted fetchImpl is anonymous and opens no socket (the module never falls back to a global)', async () => {
    const realFetch = globalThis.fetch;
    let sockets = 0;
    globalThis.fetch = async () => { sockets++; throw new Error('no network in tests'); };
    try {
      const { installationTokenFor } = makeSeam({ rows: [connection(OWNER, 'github', 'inst-1')], noFetch: true });
      assert.equal(await installationTokenFor({ workspaceId: WS, repo: REPO }), null);
      assert.equal(sockets, 0);
    } finally { globalThis.fetch = realFetch; }
  });

  test('a repo that is not an owner/name slug never reaches GitHub', async () => {
    const { installationTokenFor, github } = makeSeam({ rows: [connection(OWNER, 'github', 'inst-1')] });
    for (const repo of ['../etc/passwd', 'a/b/c', 'noslash', '', null, 'a/..']) {
      assert.equal(await installationTokenFor({ workspaceId: WS, repo }), null);
    }
    assert.equal(github.calls.length, 0);
  });

  test('caching: the token is reused until expiry − 5 min, "none" is remembered, concurrent callers share one lookup', async () => {
    let t = NOW;
    const github = fakeGitHub({ clock: () => t, expiresInMs: 60 * 60 * 1000 });
    const { installationTokenFor } = makeSeam({ rows: [connection(OWNER, 'github', 'inst-1')], github, clock: () => t });
    const burst = await Promise.all(Array.from({ length: 5 }, () => installationTokenFor({ workspaceId: WS, repo: REPO })));
    assert.deepEqual(burst, Array(5).fill(MINTED));
    assert.equal(github.appCalls().length, 2, 'single-flight: one lookup + one mint for five callers');

    t = NOW + 2 * 60 * 1000; // inside the lookup TTL and the token's life
    for (let i = 0; i < 20; i++) await installationTokenFor({ workspaceId: WS, repo: REPO });
    assert.equal(github.appCalls().length, 2, 'twenty polls cost no call');

    t = NOW + 6 * 60 * 1000; // lookup TTL (5 min) passed, token still good
    await installationTokenFor({ workspaceId: WS, repo: REPO });
    assert.equal(github.appCalls().filter(c => c.method === 'POST').length, 1, 'the token is reused');
    assert.equal(github.appCalls().filter(c => c.method === 'GET').length, 2, 'the lookup is refreshed');

    t = NOW + 56 * 60 * 1000; // inside the 5-minute margin before expiry
    await installationTokenFor({ workspaceId: WS, repo: REPO });
    assert.equal(github.appCalls().filter(c => c.method === 'POST').length, 2, 'a token near expiry is re-minted');
  });

  test('caching: "no installation" and "not the owner\'s" cost no call per poll', async () => {
    for (const github of [fakeGitHub({ coveredBy: null }), fakeGitHub({ coveredBy: 'inst-x' })]) {
      const { installationTokenFor } = makeSeam({ rows: [connection(OWNER, 'github', 'inst-1')], github });
      for (let i = 0; i < 10; i++) assert.equal(await installationTokenFor({ workspaceId: WS, repo: REPO }), null);
      assert.equal(github.calls.length, 1, 'one repo lookup, then remembered');
    }
  });

  test('no token appears in any console line, and keys carry no token', async () => {
    const lines = [];
    const saved = { log: console.log, warn: console.warn, error: console.error };
    console.log = console.warn = console.error = (...a) => lines.push(a.map(String).join(' '));
    try {
      const ok = makeSeam({ rows: [connection(OWNER, 'github', 'inst-1')] });
      await ok.installationTokenFor({ workspaceId: WS, repo: REPO });
      for (const github of [fakeGitHub({ throwOn: /./ }), fakeGitHub({ mintStatus: 500 }), fakeGitHub({ repoLookupStatus: 500 })]) {
        await makeSeam({ rows: [connection(OWNER, 'github', 'inst-1')], github }).installationTokenFor({ workspaceId: WS, repo: REPO });
      }
    } finally { Object.assign(console, saved); }
    assert.ok(lines.length > 0, 'failures are logged');
    assert.ok(lines.every(l => !l.includes(MINTED) && !/eyJ|BEGIN/.test(l)), lines.join('\n'));
  });

  test('INSTALLATION_KEYED_PROVIDERS is exactly the registry names whose connection unit is the installation id', () => {
    const keyed = getAllProviders()
      .map(p => p.name)
      .filter(provider => {
        try { return unitIdForBinding({ provider, scope: 'S', credentials: { installationId: 'I' } }) === 'I'; } catch { return false; }
      })
      .sort();
    assert.deepEqual(keyed, [...INSTALLATION_KEYED_PROVIDERS].sort());
  });
});

describe('readers: a Linear workspace reads with the minted token', () => {
  const owned = () => makeSeam({ rows: [connection(OWNER, 'github', 'inst-1')] });

  test('readRunEvidence: authenticated read, scoped to the urlKey', async () => {
    const { installationTokenFor, github } = owned();
    const out = await readRunEvidence({
      issueIdentifier: 'LIN-1', provider: linearProvider(), callScope: 'lin_key',
      urlKey: 'ws-a', workspaceId: WS, installationTokenFor, githubFetch: github,
    });
    assert.ok(github.prCalls().length > 0 && github.prCalls().every(c => c.auth === MINTED_AUTH));
    assert.equal(out.evidence.checked.now.read, true);
  });

  test('without the seam the same read is anonymous and 403s (the failing case this ticket fixes)', async () => {
    const github = fakeGitHub();
    const out = await readRunEvidence({
      issueIdentifier: 'LIN-1', provider: linearProvider(), callScope: 'lin_key',
      urlKey: 'ws-a', workspaceId: WS, githubFetch: github,
    });
    assert.ok(github.prCalls().every(c => c.auth === null));
    assert.notEqual(out.evidence.checked.now.read, true);
  });

  test('a cross-account installation leaves the read anonymous', async () => {
    const { installationTokenFor, github } = makeSeam({ rows: [connection(OTHER, 'github', 'inst-1')] });
    await readRunEvidence({
      issueIdentifier: 'LIN-1', provider: linearProvider(), callScope: 'lin_key',
      urlKey: 'ws-a', workspaceId: WS, installationTokenFor, githubFetch: github,
    });
    assert.ok(github.prCalls().every(c => c.auth === null));
  });

  test('readPrStatuses (close-out chain / sweep): token per PR; a 403 reason is unchanged for the sweep', async () => {
    const { installationTokenFor, github } = owned();
    const [ok] = await readPrStatuses({
      prUrls: [{ repo: REPO, number: 12 }], callScope: 'lin_key', workspace: { urlKey: 'ws-a' },
      seam: { githubFetch: github }, providerKind: 'linear', workspaceId: WS, installationTokenFor,
    });
    assert.equal(ok.readable, true);
    clearFailOpenPrStatus();
    const [anon] = await readPrStatuses({
      prUrls: [{ repo: REPO, number: 12 }], callScope: 'lin_key', workspace: { urlKey: 'ws-a' },
      seam: { githubFetch: fakeGitHub() }, providerKind: 'linear', workspaceId: WS,
    });
    assert.equal(anon.readable, false);
    // C3: the sweep matches /\b403\b|rate limit/i on this reason.
    assert.match(anon.reason, /\b403\b|rate limit/i);
  });

  test('C1: a close-out that does not stop at the PR makes zero installation calls and zero provider reads', async () => {
    let asked = 0;
    let providerReads = 0;
    const state = await closeOutNotReady({
      workspace: { urlKey: 'ws-a', id: WS }, issueIdentifier: 'LIN-1', store: {},
      seam: {
        isStopAtRun: async () => null,
        resolveProvider: () => { providerReads++; return { provider: linearProvider(), callScope: 'k' }; },
      },
      installationTokenFor: async () => { asked++; return 't'; },
    });
    assert.equal(state, null);
    assert.equal(asked, 0);
    assert.equal(providerReads, 0);
  });

  test('C2: a guard read after a cached read still fetches the live head', async () => {
    const { installationTokenFor, github } = owned();
    const args = { prUrls: [{ repo: REPO, number: 12 }], callScope: 'lin_key', workspace: { urlKey: 'ws-a' }, seam: { githubFetch: github }, providerKind: 'linear', workspaceId: WS, installationTokenFor };
    await readPrStatuses(args);
    const before = github.prCalls().length;
    await readPrStatuses({ ...args, prStatusCache: new Map() });
    assert.ok(github.prCalls().length > before, 'a fresh cache map reads upstream again');
  });

  test('chat get_pr_status: a Linear catalog reads with the minted token; without workspaceId (proxy chat) it is anonymous', async () => {
    const { installationTokenFor, github } = owned();
    const provider = { name: 'linear' };
    const withSeam = createChatToolCatalog({ provider, scope: 'lin_key', githubFetch: github, workspaceId: WS, installationTokenFor });
    const out = await withSeam.executeTool({ name: 'get_pr_status', arguments: { repo: REPO, number: 12 } });
    assert.ok(out);
    assert.ok(github.prCalls().every(c => c.auth === MINTED_AUTH));

    let asked = 0;
    const anonGithub = fakeGitHub();
    const proxyLike = createChatToolCatalog({
      provider, scope: 'lin_key', githubFetch: anonGithub,
      installationTokenFor: async () => { asked++; return 't'; },
    });
    await proxyLike.executeTool({ name: 'get_pr_status', arguments: { repo: REPO, number: 12 } }).catch(() => null);
    assert.equal(asked, 0);
    assert.ok(anonGithub.prCalls().every(c => c.auth === null));
  });

  describe('task page', () => {
    const issueComments = [{ id: 'c1', body: `opened ${PR_URL}`, createdAt: '2026-10-19T11:00:00.000Z' }];
    const provider = {
      name: 'linear',
      async fetchIssueComments() { return issueComments; },
      async fetchRecommendationContext() {
        return {
          issue: { id: 'i1', identifier: 'LIN-1', title: 'T', url: 'https://x', state: { name: 'In Progress', type: 'started' }, labels: [], blockedBy: [], description: null, createdAt: '2026-10-01T09:00:00.000Z', updatedAt: '2026-10-06T10:00:00.000Z' },
          parent: null, children: [], comments: issueComments, stateTransitions: [],
        };
      },
    };
    function loaderFor(github, installationTokenFor) {
      const prStateStore = createPrStateStore({ cache: new Map(), bucket: [], githubFetch: github });
      return createTaskPageLoader({
        dispatchStore: {}, agentStatusStore: {},
        briefCacheStore: { async get() { return null; } },
        recapCacheStore: { async get() { return null; } },
        readRunEvidence, prStateStore, installationTokenFor, enrichLoop, deriveSessionWaiting,
        getLoopsForIssue: async () => [],
        now: () => new Date('2026-10-19T12:00:00.000Z'),
      });
    }

    test('owner page: the token is resolved once per read, with the workspace id, and the PR is readable', async () => {
      const { installationTokenFor: real, github } = owned();
      const asks = [];
      const installationTokenFor = async (a) => { asks.push(a); return real(a); };
      const { model } = await loaderFor(github, installationTokenFor)
        .loadTaskPage({ urlKey: 'ws-a', workspaceId: WS, identifier: 'LIN-1', access: { provider, callScope: 'lin_key' } });
      assert.deepEqual(asks, [{ workspaceId: WS, repo: REPO }]);
      assert.equal(model.evidence.evidence.checked.now.read, true);
      assert.ok(github.prCalls().every(c => c.auth === MINTED_AUTH));
    });

    test('guest page (no workspaceId): zero installation calls, anonymous read', async () => {
      const { github } = owned();
      let asked = 0;
      await loaderFor(github, async () => { asked++; return MINTED; })
        .loadTaskPage({ urlKey: 'ws-a', identifier: 'LIN-1', access: { provider, callScope: 'lin_key' } });
      assert.equal(asked, 0);
      assert.ok(github.prCalls().every(c => c.auth === null));
    });
  });
});

describe('wiring', () => {
  const read = p => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

  test('prReadToken( is called only from its own module (callers use the async resolver)', () => {
    const hits = [];
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) { if (name !== 'node_modules') walk(path); continue; }
        if (!/\.(js|mjs)$/.test(name)) continue;
        if (/prReadToken\(/.test(readFileSync(path, 'utf8'))) hits.push(path);
      }
    };
    const root = new URL('../../', import.meta.url).pathname;
    walk(join(root, 'lib')); walk(join(root, 'routes'));
    assert.deepEqual(hits.map(h => h.slice(root.length)), ['lib/github-pr-status.js']);
  });

  test('server.js builds the resolver before its first eager use and injects the seven session-side targets, not the proxy chat', () => {
    const src = read('server.js');
    const built = src.indexOf('const installationTokenFor = createInstallationTokenResolver(');
    assert.ok(built > src.indexOf('const connectionStore = new ConnectionStore('), 'after connectionStore');
    assert.ok(built < src.indexOf('run: createCiWakeSweepRun('), 'before the eager sweep (TDZ)');
    for (const factory of ['createDispatchRoutes', 'createWorkspaceApiRoutes', 'createDashboardRoutes', 'createTaskChatRoutes', 'createFlightCompanionRoutes']) {
      assert.match(src, new RegExp(`app\\.use\\(${factory}\\(\\{ installationTokenFor,`), factory);
    }
    assert.match(src, /createTaskPageLoader\(\{[^}]*installationTokenFor/);
    assert.match(src, /createCiWakeSweepRun\(\{[\s\S]*?installationTokenFor\s*\n\s*\}\)/);
    const proxyLine = src.split('\n').find(l => l.startsWith('app.use(createProxyRoutes('));
    assert.ok(proxyLine && !proxyLine.includes('installationTokenFor'), 'the worker proxy chat stays anonymous');
  });

  test('the module header still names the one network-capable member', () => {
    const src = read('lib/connection-credential.js');
    assert.match(src, /only network-capable member/);
  });
});
