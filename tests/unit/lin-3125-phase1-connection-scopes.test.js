/**
 * LIN-3125 Phase 1 — held-connection scope enumeration.
 *
 * `listConnectionScopes(credentials)` enumerates the scopes a HELD connection
 * can reach from the connection's OWN stored credential, so adding a source
 * needs no user OAuth token and no auth/install round trip. These tests drive
 * the REAL provider methods over the existing fakes and COUNT the seams:
 *   - github: `listRepos` (the per-installation read) is used; `listUserInstallations`
 *     (the user-token enumeration) is never called; the client is built with the
 *     installation token only.
 *   - github-projects: the board owner's login is read via the App-JWT
 *     installation GET (a read, not a mint — no `/access_tokens` POST); boards
 *     are read with the installation token; `_listUserInstallations` is never
 *     called.
 * plus the pure `heldScopeView` mapper and the LIN-2820 `.truncated` carry.
 *
 * Run with: node --test tests/unit/lin-3125-phase1-connection-scopes.test.js
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { GitHubProvider } from '../../lib/providers/github/index.js';
import { createFakeGitHubClient } from '../../lib/providers/github/fake-client.js';
import { GitHubProjectsProvider } from '../../lib/providers/github-projects/index.js';
import { createFakeGitHubProjectsClient } from '../../lib/providers/github-projects/fake-client.js';

// Ephemeral RSA keypair so the App JWT signing runs for real against a valid PEM
// (the same seam the Phase 0 test uses).
const { privateKey: RSA_PRIVATE_KEY } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const RSA_PEM = RSA_PRIVATE_KEY.export({ type: 'pkcs1', format: 'pem' });

describe('LIN-3125 Phase 1 — GitHub listConnectionScopes (held)', () => {
  test('enumerates from the installation token via listRepos; never listUserInstallations; no auth/install round trip', async () => {
    const provider = new GitHubProvider();
    const counts = { listRepos: 0, listUserInstallations: 0, tokens: [] };
    const fake = createFakeGitHubClient({
      _repos: [
        { full_name: 'octocat/hello-world', private: false },
        { full_name: 'octocat/secret', private: true },
      ],
    });
    const realListRepos = fake.listRepos.bind(fake);
    fake.listRepos = async (...args) => { counts.listRepos++; return realListRepos(...args); };
    fake.listUserInstallations = async (...args) => { counts.listUserInstallations++; return []; };
    provider._clientForToken = (token) => { counts.tokens.push(token); return fake; };

    const rows = await provider.listConnectionScopes({ token: 'ghs_inst', installationId: 77 });

    assert.equal(counts.listRepos, 1, 'one per-installation repository read');
    assert.equal(counts.listUserInstallations, 0, 'the user-token enumeration is never reached');
    assert.deepEqual(counts.tokens, ['ghs_inst'], 'the client is built with the installation token only');
    assert.deepEqual(rows, [
      { slug: 'octocat/hello-world', name: 'octocat/hello-world', private: false, installationId: '77' },
      { slug: 'octocat/secret', name: 'octocat/secret', private: true, installationId: '77' },
    ]);
  });

  test('preserves the .truncated carry (LIN-2820)', async () => {
    const provider = new GitHubProvider();
    const fake = createFakeGitHubClient({ _repos: [{ full_name: 'a/b', private: false }] });
    const realListRepos = fake.listRepos.bind(fake);
    fake.listRepos = async () => { const r = await realListRepos(); r.truncated = true; return r; };
    provider._clientForToken = () => fake;

    const rows = await provider.listConnectionScopes({ token: 'ghs_inst', installationId: 5 });

    assert.equal(rows.truncated, true, 'an aggregate truncated read stays truncated');
  });

  test('heldScopeView maps a row to the minimal held-picker view', () => {
    const provider = new GitHubProvider();
    assert.deepEqual(
      provider.heldScopeView({ slug: 'a/b', name: 'a/b', private: true, installationId: '77' }),
      { scope: 'a/b', label: 'a/b', detail: 'private', installationId: '77' },
    );
    assert.deepEqual(
      provider.heldScopeView({ slug: 'a/c', name: 'a/c', private: false, installationId: '77' }),
      { scope: 'a/c', label: 'a/c', installationId: '77' },
    );
  });
});

describe('LIN-3125 Phase 1 — GitHub Projects listConnectionScopes (held)', () => {
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

  test('reads the installation login by App JWT, then boards with the installation token; never _listUserInstallations; no access_tokens POST', async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url: String(url), method: init?.method });
      return { ok: true, status: 200, text: async () => JSON.stringify({ id: 77, account: { id: 7, login: 'octocat' } }) };
    };
    const provider = new GitHubProjectsProvider({ fetchImpl });
    const counts = { listBoards: 0, listUserInstallations: 0, tokens: [] };
    const fake = createFakeGitHubProjectsClient({
      'octocat/5': { project: { number: 5, title: 'Roadmap', url: 'u5', shortDescription: 'd5' } },
    });
    const realListBoards = fake.listBoards.bind(fake);
    fake.listBoards = async (...args) => { counts.listBoards++; return realListBoards(...args); };
    provider._listUserInstallations = async () => { counts.listUserInstallations++; return []; };
    provider._clientForToken = (token) => { counts.tokens.push(token); return fake; };

    const rows = await provider.listConnectionScopes({ token: 'ghs_inst', installationId: 77 });

    assert.equal(counts.listBoards, 1, 'one board read');
    assert.equal(counts.listUserInstallations, 0, 'the user-token enumeration is never reached');
    assert.deepEqual(counts.tokens, ['ghs_inst'], 'boards are read with the installation token only');
    assert.equal(calls.length, 1, 'exactly the one App-JWT installation read (no mint)');
    assert.deepEqual(calls[0], { url: 'https://api.github.com/app/installations/77', method: 'GET' });
    assert.equal(calls.some(c => c.url.endsWith('/access_tokens')), false, 'never mints an installation token');
    assert.deepEqual(rows, [
      { login: 'octocat', number: 5, title: 'Roadmap', url: 'u5', shortDescription: 'd5', closed: false, installationId: '77' },
    ]);
  });

  test('returns [] without a read when the connection has no installationId', async () => {
    const calls = [];
    const provider = new GitHubProjectsProvider({ fetchImpl: async (url) => { calls.push(url); return { ok: true, status: 200, text: async () => '{}' }; } });
    provider._clientForToken = () => { throw new Error('must not build a client'); };
    const rows = await provider.listConnectionScopes({ token: 'ghs_inst' });
    assert.deepEqual(rows, []);
    assert.equal(calls.length, 0);
  });

  test('heldScopeView maps a board row to the minimal held-picker view', () => {
    const provider = new GitHubProjectsProvider();
    assert.deepEqual(
      provider.heldScopeView({ login: 'octocat', number: 5, title: 'Roadmap', shortDescription: 'd5', installationId: '77' }),
      { scope: 'octocat/5', label: 'Roadmap', detail: 'd5', installationId: '77' },
    );
    assert.deepEqual(
      provider.heldScopeView({ login: 'octocat', number: 6, title: 'X', shortDescription: null, installationId: '77' }),
      { scope: 'octocat/6', label: 'X', installationId: '77' },
    );
  });
});
