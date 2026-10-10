// LIN-3443: PR state is read with the workspace's own GitHub token.
//
// GitHub answers HTTP 403 to anonymous calls from Harbour's shared outbound
// address, so a GitHub-bound workspace's task page showed "PR couldn't be read"
// and withheld the PR link and close-out button. These tests drive the real
// readers against a GitHub stub that 403s without `Authorization` and answers
// with it, and pin that the token and the workspace scope key reach every
// reader and never cross into an anonymous (or another workspace's) cache entry.
//
// Run with: node --test tests/unit/authenticated-pr-reads.test.js

import { test, describe, beforeEach, before } from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchGitHubJson,
  fetchPrStatus,
  isNotFoundOrThrow,
  prReadToken,
  readPrStatusFailOpen,
  clearFailOpenPrStatus,
} from '../../lib/github-pr-status.js';
import { createPrStateStore, prStateUpstreamFetchCount, clearPrStateCache } from '../../lib/pr-state-store.js';
import { createTaskPageLoader } from '../../lib/task-page-loader.js';
import { readRunEvidence } from '../../lib/run-evidence.js';
import { renderTaskPullRequest } from '../../lib/render-task-page.js';
import { enrichLoop, deriveSessionWaiting } from '../../routes/dashboard.js';
import { createWorkspaceApiRoutes } from '../../routes/workspace-api.js';

const REPO = 'acme/widget';
const PR_URL = `https://github.com/${REPO}/pull/12`;
const TOKEN = 'ghs_workspace_token';
const AUTH = `Bearer ${TOKEN}`;

before(() => { process.env.NODE_ENV = 'test'; });

function json(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: name => headers[name.toLowerCase()] ?? null },
    async json() { return body; },
  };
}

/**
 * A GitHub stub that 403s without a Bearer token (the production failure) and
 * answers a normal open PR with one. `private` makes the repo probe report a
 * private repo. Records each call's headers.
 */
function githubStub({ priv = false, checkRuns = [{ name: 'unit', conclusion: 'success' }] } = {}) {
  const calls = [];
  const impl = async (url, opts = {}) => {
    const headers = opts.headers || {};
    calls.push({ url, headers });
    if (!headers.Authorization) {
      return json(403, { message: 'API rate limit exceeded for 1.2.3.4' }, { 'x-ratelimit-remaining': '0' });
    }
    if (/\/repos\/[^/]+\/[^/]+$/.test(url)) return json(200, { private: priv });
    if (/\/pulls\/\d+$/.test(url)) return json(200, { state: 'open', merged: false, head: { ref: 'f', sha: 'abc1234' }, base: { ref: 'main' }, mergeable: true });
    if (/\/check-runs$/.test(url)) return json(200, { check_runs: checkRuns });
    if (/\/status$/.test(url)) return json(200, { statuses: [] });
    return json(404, { message: 'Not Found' });
  };
  impl.calls = calls;
  return impl;
}

const GH_SCOPE = { repo: REPO, token: TOKEN };

beforeEach(() => { clearFailOpenPrStatus(); clearPrStateCache(); });

describe('fetch layer', () => {
  test('Authorization only with a token; User-Agent always', async () => {
    const seen = [];
    const doFetch = async (url, opts) => { seen.push(opts.headers); return json(200, {}); };
    await fetchGitHubJson(doFetch, '/repos/a/b');
    await fetchGitHubJson(doFetch, '/repos/a/b', { token: TOKEN });
    assert.equal(seen[0].Authorization, undefined);
    assert.equal(seen[0]['User-Agent'], 'harbour');
    assert.equal(seen[1].Authorization, AUTH);
    assert.equal(seen[1]['User-Agent'], 'harbour');
  });

  test('a private repo is readable with a token, not readable without', async () => {
    const withToken = await fetchPrStatus(githubStub({ priv: true }), { repo: REPO, number: 12, token: TOKEN });
    assert.equal(withToken.readable, true);
    // Anonymous: the same private 200 (a stub that ignores auth) is withheld.
    const open = async (url) => (/\/repos\/[^/]+\/[^/]+$/.test(url) ? json(200, { private: true }) : json(404, {}));
    const anon = await fetchPrStatus(open, { repo: REPO, number: 12 });
    assert.equal(anon.readable, false);
  });

  test('a 404 with a token still means not readable', async () => {
    const notFound = async () => json(404, { message: 'Not Found' });
    const res = await fetchPrStatus(notFound, { repo: REPO, number: 12, token: TOKEN });
    assert.equal(res.readable, false);
  });

  test('the token reaches all four calls', async () => {
    const stub = githubStub();
    await fetchPrStatus(stub, { repo: REPO, number: 12, token: TOKEN });
    assert.equal(stub.calls.length, 4);
    assert.ok(stub.calls.every(c => c.headers.Authorization === AUTH));
  });

  test('the thrown error carries GitHub\'s message and the rate-limit header', async () => {
    await assert.rejects(
      () => fetchPrStatus(githubStub(), { repo: REPO, number: 12 }),
      err => err.status === 403
        && /HTTP 403/.test(err.message)
        && /API rate limit exceeded/.test(err.message)
        && /x-ratelimit-remaining 0/.test(err.message),
    );
    assert.throws(() => isNotFoundOrThrow({ ok: false, status: 500 }, 'ctx'), /HTTP 500$/);
  });
});

describe('prReadToken: the one rule for who may use the workspace token', () => {
  test('GitHub-issues scope + the bound repo (case-insensitive) → token', () => {
    assert.equal(prReadToken(GH_SCOPE, REPO), TOKEN);
    assert.equal(prReadToken(GH_SCOPE, 'ACME/Widget'), TOKEN);
  });
  test('another repo → null', () => {
    assert.equal(prReadToken(GH_SCOPE, 'acme/other'), null);
  });
  test('Linear (string), Jira, Projects v2 and missing scopes → null', () => {
    assert.equal(prReadToken('lin_tok', REPO), null);
    assert.equal(prReadToken({ apiToken: 'x', baseUrl: 'y' }, REPO), null);
    assert.equal(prReadToken({ scope: 'proj', token: TOKEN }, REPO), null);
    assert.equal(prReadToken({ repo: REPO }, REPO), null, 'no token');
    assert.equal(prReadToken(null, REPO), null);
    assert.equal(prReadToken(undefined, REPO), null);
  });
});

describe('readPrStatusFailOpen', () => {
  test('a token without a scopeKey throws, not unknown, before any cache access', async () => {
    const stub = githubStub();
    const cache = new Map();
    await assert.rejects(
      () => readPrStatusFailOpen({ repo: REPO, number: 12, token: TOKEN, doFetch: stub, cache }),
      /scopeKey/,
    );
    assert.equal(stub.calls.length, 0);
    assert.equal(cache.size, 0);
  });

  test('authenticated read succeeds where anonymous is unknown', async () => {
    const stub = githubStub();
    const anon = await readPrStatusFailOpen({ repo: REPO, number: 12, doFetch: stub });
    assert.equal(anon.state, 'unknown');
    const authed = await readPrStatusFailOpen({ repo: REPO, number: 12, token: TOKEN, scopeKey: 'ws-a', doFetch: stub });
    assert.equal(authed.readable, true);
    assert.equal(authed.state, 'open');
  });

  test('cache entries are separate per scopeKey and from anonymous', async () => {
    const stub = githubStub();
    const cache = new Map();
    const read = args => readPrStatusFailOpen({ repo: REPO, number: 12, doFetch: stub, cache, ...args });
    await read({ token: TOKEN, scopeKey: 'ws-a' });
    const afterA = stub.calls.length;
    await read({ token: TOKEN, scopeKey: 'ws-a' });
    assert.equal(stub.calls.length, afterA, 'same scope key hits its cache');
    await read({ token: TOKEN, scopeKey: 'ws-b' });
    assert.ok(stub.calls.length > afterA, 'another workspace does not reuse it');
    const anon = await read({});
    assert.equal(anon.state, 'unknown', 'anonymous does not see the authenticated entry');
    assert.equal(cache.size, 3);
  });
});

describe('pr-state store', () => {
  const ref = { repo: REPO, number: 12 };
  const makeStore = (stub) => createPrStateStore({ cache: new Map(), bucket: [], now: () => 1_000, githubFetch: stub });

  test('authenticated and anonymous reads do not share a cache entry', async () => {
    const store = makeStore(githubStub());
    const authed = await store.readResult(ref, 1_000, { token: TOKEN, scopeKey: 'ws-a' });
    assert.equal(authed.result.readable, true);
    const anon = await store.readResult(ref, 1_000);
    assert.equal(anon.result, null, 'anonymous read 403s; it must not be served the authenticated result');
    assert.equal(store.cache.has(`${REPO}#12`), false, 'no anonymous key written by the authenticated read');
    assert.equal(store.cache.has(`ws-a|${REPO}#12`), true);
  });

  test('two workspaces do not share an authenticated entry', async () => {
    const stub = githubStub();
    const store = makeStore(stub);
    await store.readResult(ref, 1_000, { token: TOKEN, scopeKey: 'ws-a' });
    const n = stub.calls.length;
    await store.readResult(ref, 1_000, { token: TOKEN, scopeKey: 'ws-b' });
    assert.equal(stub.calls.length, n * 2);
  });

  test('authenticated reads leave the anonymous budget and fetch counter untouched', async () => {
    const store = makeStore(githubStub());
    await store.readResult(ref, 1_000, { token: TOKEN, scopeKey: 'ws-a' });
    assert.equal(store.bucket.length, 0);
    assert.equal(prStateUpstreamFetchCount(), 0);
  });

  test('an authenticated read still runs when the anonymous budget is spent', async () => {
    const full = Array.from({ length: 36 }, () => 1_000);
    const store = createPrStateStore({ cache: new Map(), bucket: full, now: () => 1_000, githubFetch: githubStub() });
    const { result } = await store.readResult(ref, 1_000, { token: TOKEN, scopeKey: 'ws-a' });
    assert.equal(result.readable, true);
  });

  test('a token without a scopeKey throws before the cache is touched', async () => {
    const stub = githubStub();
    const store = makeStore(stub);
    await assert.rejects(() => store.readResult(ref, 1_000, { token: TOKEN }), /scopeKey/);
    await assert.rejects(() => store.readPayload(ref, 1_000, { token: TOKEN }), /scopeKey/);
    assert.equal(stub.calls.length, 0);
  });
});

describe('task page loader', () => {
  const comments = [{ id: 'c1', body: `opened ${PR_URL}`, createdAt: '2026-10-06T11:00:00.000Z' }];
  const provider = {
    async fetchRecommendationContext() {
      return {
        issue: { id: 'i1', identifier: 'GH-12', title: 'T', url: 'https://x', state: { name: 'In Progress', type: 'started' }, labels: [], blockedBy: [], description: null, createdAt: '2026-10-01T09:00:00.000Z', updatedAt: '2026-10-06T10:00:00.000Z' },
        parent: null, children: [], comments, stateTransitions: [],
      };
    },
  };
  const NOW = new Date('2026-10-06T12:00:00.000Z');

  function loaderFor(stub) {
    const prStateStore = createPrStateStore({ cache: new Map(), bucket: [], githubFetch: stub });
    return createTaskPageLoader({
      dispatchStore: {}, agentStatusStore: {},
      briefCacheStore: { async get() { return null; } },
      recapCacheStore: { async get() { return null; } },
      readRunEvidence, prStateStore, enrichLoop, deriveSessionWaiting,
      getLoopsForIssue: async () => [],
      now: () => NOW,
    });
  }
  const load = (loader, callScope, urlKey = 'ws-a') =>
    loader.loadTaskPage({ urlKey, identifier: 'GH-12', access: { provider, callScope } });

  test('GitHub-bound workspace: the PR is readable and the close-out is ready', async () => {
    const { model } = await load(loaderFor(githubStub()), GH_SCOPE);
    assert.equal(model.evidence.state.status, 'ready');
    assert.equal(model.evidence.evidence.checked.now.read, true);
    const html = renderTaskPullRequest(model, '', NOW);
    assert.ok(html.includes(PR_URL), 'the PR link is rendered');
    assert.doesNotMatch(html, /couldn(&#039;|')t be read just now/);
  });

  test('a guest reading through the owner\'s access sees the same authenticated state', async () => {
    // /t/:token calls loadTaskPage with the owner's access (LIN-3330/3373);
    // pinned so the share-link behaviour stays a decision, not an accident.
    const { model } = await load(loaderFor(githubStub()), GH_SCOPE);
    assert.equal(model.evidence.state.status, 'ready');
  });

  test('copy: a readable PR with no checks vs an unreadable PR', async () => {
    const noChecks = await load(loaderFor(githubStub({ checkRuns: [] })), GH_SCOPE);
    const readable = renderTaskPullRequest(noChecks.model, '', NOW);
    assert.match(readable, /No checks are set up for this pull request/);
    assert.doesNotMatch(readable, /Checks couldn(&#039;|')t be read/);
    const unreadable = await load(loaderFor(githubStub()), 'lin_token');
    assert.match(renderTaskPullRequest(unreadable.model, '', NOW), /Checks couldn(&#039;|')t be read/);
  });

  test('Linear access (string scope) stays anonymous → unknown', async () => {
    const stub = githubStub();
    const { model } = await load(loaderFor(stub), 'lin_token');
    assert.equal(model.evidence.state.status, 'unknown');
    assert.ok(stub.calls.every(c => !c.headers.Authorization));
  });

  test('a PR in another repo than the bound one stays anonymous', async () => {
    const stub = githubStub();
    const { model } = await load(loaderFor(stub), { repo: 'acme/other', token: TOKEN });
    assert.equal(model.evidence.state.status, 'unknown');
    assert.ok(stub.calls.every(c => !c.headers.Authorization));
  });
});

describe('readRunEvidence default reader (run page / run-evidence route path)', () => {
  const base = { issueIdentifier: 'GH-12', provider: null, comments: [{ body: PR_URL, createdAt: '2026-10-06T11:00:00.000Z' }] };

  test('threads the token and urlKey into the default fail-open reader', async () => {
    const stub = githubStub();
    const model = await readRunEvidence({ ...base, callScope: GH_SCOPE, urlKey: 'ws-a', githubFetch: stub });
    assert.equal(model.state.status, 'ready');
  });

  test('without a urlKey it reads anonymously rather than tripping the scope-key guard', async () => {
    const stub = githubStub();
    const model = await readRunEvidence({ ...base, callScope: GH_SCOPE, githubFetch: stub });
    assert.equal(model.state.status, 'unknown');
    assert.ok(stub.calls.every(c => !c.headers.Authorization));
  });

  test('copy flag: a readable PR with no checks is read:true; unreadable is read:false', async () => {
    const readable = await readRunEvidence({ ...base, callScope: GH_SCOPE, urlKey: 'ws-a', githubFetch: githubStub({ checkRuns: [] }) });
    assert.equal(readable.evidence.checked.now.state, 'unknown');
    assert.equal(readable.evidence.checked.now.read, true);
    const unreadable = await readRunEvidence({ ...base, callScope: 'lin', urlKey: 'ws-a', githubFetch: githubStub() });
    assert.equal(unreadable.evidence.checked.now.read, false);
  });
});

describe('routes', () => {
  function getHandler(router, method, path) {
    const layer = router.stack.find(l => l.route?.path === path && l.route.methods[method]);
    assert.ok(layer, `${method} ${path} registered`);
    return layer.route.stack[layer.route.stack.length - 1].handle;
  }
  function resObj() {
    return {
      statusCode: 200, jsonBody: null,
      status(c) { this.statusCode = c; return this; },
      json(b) { this.jsonBody = b; return this; },
    };
  }
  const provider = { async fetchIssueComments() { return [{ body: PR_URL, createdAt: '2026-10-06T11:00:00.000Z' }]; } };
  const workspaceOf = urlKey => ({ urlKey, accessToken: 't' });

  test('GET run-evidence: authenticated, and a second workspace on the same repo does not reuse the first one\'s cache entry', async () => {
    const stub = githubStub();
    const router = createWorkspaceApiRoutes({
      workspaceFromUrl: (req, res, next) => next(),
      runEvidence: { resolveProvider: () => ({ provider, callScope: GH_SCOPE }), githubFetch: stub },
    });
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/run-evidence/:issueIdentifier');
    const call = async urlKey => {
      const res = resObj();
      await handler({ session: {}, workspace: workspaceOf(urlKey), params: { urlKey, issueIdentifier: 'GH-12' }, query: {} }, res, e => { if (e) throw e; });
      return res;
    };
    const a = await call('ws-a');
    assert.equal(a.jsonBody.state.status, 'ready');
    const n = stub.calls.length;
    await call('ws-a');
    assert.equal(stub.calls.length, n, 'same workspace is served from its entry');
    await call('ws-b');
    assert.equal(stub.calls.length, n * 2, 'another workspace reads for itself');
  });

  test('POST close-out check: threads token and scopeKey; other repos and non-GitHub scopes get none', async () => {
    const seen = [];
    const build = callScope => createWorkspaceApiRoutes({
      workspaceFromUrl: (req, res, next) => next(),
      closeOut: {
        resolveProvider: () => ({ provider, callScope }),
        readPrStatus: async args => { seen.push(args); return { readable: false, state: 'unknown' }; },
        isStopAtRun: async () => 'pr',
        runnerReady: () => true,
      },
    });
    const run = async callScope => {
      const handler = getHandler(build(callScope), 'post', '/workspace/:urlKey/api/run-evidence/:issueIdentifier/check');
      await handler({
        session: { accountId: 'acct-1', workspaces: ['ws-a'] }, workspace: workspaceOf('ws-a'),
        params: { urlKey: 'ws-a', issueIdentifier: 'GH-12' }, query: {}, body: {},
      }, resObj(), e => { if (e) throw e; });
      return seen.pop();
    };
    const gh = await run(GH_SCOPE);
    assert.equal(gh.token, TOKEN);
    assert.equal(gh.scopeKey, 'ws-a');
    assert.equal((await run('lin_token')).token, undefined);
    assert.equal((await run({ repo: 'acme/other', token: TOKEN })).token, undefined);
  });
});
