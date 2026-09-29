/**
 * LIN-3125 Phase 0 — one shared `completeAppInstallation` + provider-level
 * `fetchImpl` DI.
 *
 * Before Phase 0, `GitHubProvider.completeInstallation` and
 * `GitHubProjectsProvider.completeInstallation` carried byte-identical copies of
 * the mint+fetch body, so the identity shape had to be fixed twice and no single
 * seam existed to drive the REAL body offline. Phase 0 moves the body to
 * `lib/providers/github/app-auth.js:completeAppInstallation` and threads a
 * provider-level `fetchImpl` through it (and `completeAuth`) so the LIN-3125
 * acceptance witness can run the real flow and count calls by URL.
 *
 * Tests:
 *   1. both providers drive the ONE shared body, observable via injected fetchImpl
 *      (exactly one access_tokens POST + one installation GET per call, identical
 *      result);
 *   2. a source guard: exactly one body calls both `mintInstallationToken(` and
 *      `fetchInstallation(` — the shared one (the duplication cannot return);
 *   3. the default is global fetch (no behaviour change without the DI).
 *
 * Run with: node --test tests/unit/lin-3125-phase0-complete-installation.test.js
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { GitHubProvider } from '../../lib/providers/github/index.js';
import { GitHubProjectsProvider } from '../../lib/providers/github-projects/index.js';
import { loadStrippedSources } from '../fixtures/connection-access-guards.js';
import { namedCallOffenders } from '../fixtures/connection-access-guards.js';

const APP_AUTH = 'lib/providers/github/app-auth.js';
const GH_INDEX = 'lib/providers/github/index.js';
const GP_INDEX = 'lib/providers/github-projects/index.js';

// Ephemeral RSA keypair so the App JWT signing runs for real against a valid PEM.
const { privateKey: RSA_PRIVATE_KEY } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const RSA_PEM = RSA_PRIVATE_KEY.export({ type: 'pkcs1', format: 'pem' });

const EXPECTED = {
  token: 'ghs_inst',
  login: 'octocat',
  userId: '7',
  installationId: '42',
  tokenExpiresAt: '2026-06-25T20:00:00Z',
};

/** A recording fetch that answers the two App calls and records every URL. */
function recordingFetch(calls) {
  return async (url, init) => {
    const u = String(url);
    calls.push({ url: u, method: init?.method });
    if (u.endsWith('/access_tokens')) {
      return { ok: true, status: 201, text: async () => JSON.stringify({ token: 'ghs_inst', expires_at: '2026-06-25T20:00:00Z' }) };
    }
    return { ok: true, status: 200, text: async () => JSON.stringify({ id: 42, account: { id: 7, login: 'octocat' } }) };
  };
}

/** Brace-matched body of an `async NAME(...) { ... }` method. */
function methodBody(src, name) {
  const m = new RegExp(`async\\s+${name}\\s*\\(`).exec(src);
  assert.ok(m, `method ${name} not found`);
  return bodyAfterParams(src, m.index + m[0].length - 1);
}

/** Brace-matched body of a `function NAME(...) { ... }` (destructured params ok). */
function functionBody(src, name) {
  const m = new RegExp(`function\\s+${name}\\s*\\(`).exec(src);
  assert.ok(m, `function ${name} not found`);
  return bodyAfterParams(src, m.index + m[0].length - 1);
}

/** Given the index of the opening `(`, return the `{ ... }` body that follows. */
function bodyAfterParams(src, openParen) {
  let depth = 0;
  let i = openParen;
  for (; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')') {
      depth--;
      if (depth === 0) break;
    }
  }
  const open = src.indexOf('{', i);
  assert.ok(open !== -1, 'function body brace not found');
  depth = 0;
  for (let j = open; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') {
      depth--;
      if (depth === 0) return src.slice(open, j + 1);
    }
  }
  throw new Error('unbalanced function body');
}

describe('LIN-3125 Phase 0 — completeAppInstallation collapse + fetchImpl DI', () => {
  let saved;
  beforeEach(() => {
    saved = { GITHUB_APP_ID: process.env.GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY: process.env.GITHUB_APP_PRIVATE_KEY };
    process.env.GITHUB_APP_ID = '12345';
    process.env.GITHUB_APP_PRIVATE_KEY = RSA_PEM;
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  test('lin3125 phase0: both providers drive ONE completeAppInstallation (observed by injected fetchImpl: exactly one access_tokens POST + one installation GET per call, identical result)', async () => {
    // A global fetch that would explode proves the injected seam is the one used.
    const realFetch = global.fetch;
    global.fetch = () => { throw new Error('global fetch must not be reached when fetchImpl is injected'); };
    try {
      const githubCalls = [];
      const projectsCalls = [];
      const github = await new GitHubProvider({ fetchImpl: recordingFetch(githubCalls) }).completeInstallation('42');
      const projects = await new GitHubProjectsProvider({ fetchImpl: recordingFetch(projectsCalls) }).completeInstallation('42');

      assert.deepEqual(github, EXPECTED, 'GitHub identity shape preserved');
      assert.deepEqual(projects, EXPECTED, 'Projects identity shape preserved');
      assert.deepEqual(github, projects, 'both providers produce the identical result from the one body');

      for (const [label, calls] of [['github', githubCalls], ['github-projects', projectsCalls]]) {
        assert.equal(calls.length, 2, `${label}: exactly the two App calls`);
        assert.equal(calls.filter(c => c.method === 'POST' && c.url.endsWith('/app/installations/42/access_tokens')).length, 1, `${label}: one access_tokens POST`);
        assert.equal(calls.filter(c => c.method === 'GET' && c.url.endsWith('/app/installations/42')).length, 1, `${label}: one installation GET`);
      }
    } finally {
      global.fetch = realFetch;
    }
  });

  test('lin3125 phase0: exactly one body contains mintInstallationToken( + fetchInstallation(', () => {
    const REAL = loadStrippedSources();
    const appAuth = REAL.get(APP_AUTH);
    const shared = functionBody(appAuth, 'completeAppInstallation');
    assert.match(shared, /mintInstallationToken\s*\(/, 'shared body mints the installation token');
    assert.match(shared, /fetchInstallation\s*\(/, 'shared body reads the installation');

    // Neither provider carries its own copy of the body — each delegates.
    for (const rel of [GH_INDEX, GP_INDEX]) {
      const body = methodBody(REAL.get(rel), 'completeInstallation');
      assert.match(body, /completeAppInstallation\s*\(/, `${rel}: completeInstallation delegates to the shared body`);
      assert.doesNotMatch(body, /mintInstallationToken\s*\(/, `${rel}: no duplicated mint call`);
      assert.doesNotMatch(body, /fetchInstallation\s*\(/, `${rel}: no duplicated installation read`);
    }

    // `fetchInstallation` is called from exactly one place in the corpus: the
    // shared body (the callers pin makes a reintroduced copy fail here).
    assert.deepEqual(
      namedCallOffenders(REAL, ['fetchInstallation'], [APP_AUTH]),
      [],
      'fetchInstallation( has no caller outside the shared body',
    );
  });

  test('lin3125 phase0: provider fetchImpl defaults to global fetch (no behaviour change)', async () => {
    const realFetch = global.fetch;
    const calls = [];
    global.fetch = recordingFetch(calls);
    try {
      const creds = await new GitHubProvider().completeInstallation('42');
      assert.deepEqual(creds, EXPECTED);
      assert.equal(calls.length, 2, 'a provider without a fetchImpl still reaches global fetch');
      assert.equal(calls.filter(c => c.url.endsWith('/access_tokens')).length, 1);
      assert.equal(calls.filter(c => c.method === 'GET').length, 1);
    } finally {
      global.fetch = realFetch;
    }
  });
});