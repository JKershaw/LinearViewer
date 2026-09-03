/**
 * LIN-2397 stage A — byte-parity golden harness for the two GitHub App
 * install-flow routers (routes/github-auth.js, routes/github-projects-auth.js).
 *
 * The research comment on LIN-2397 (§3) measured the existing suites
 * (tests/unit/github-auth.test.js, github-projects-auth.test.js): 67
 * `assert.match(res.body, /…/)` regex assertions and ZERO exact-body
 * assertions. A green suite there proves "a page whose title matches
 * survived", not "the same bytes came back" — a parameterization slip in the
 * planned stage-B extraction that wires the WRONG router's `actionUrl` into
 * an error page (the single most likely mistake: the base path recurs ~14
 * times per router) would pass every existing test in both files unchanged.
 *
 * This file drives each REAL router (via the same getHandler/makeRes/
 * makeSession harness the two route test files already use — see
 * tests/fixtures/github-install-flow-branches.js) across a broad branch
 * matrix and asserts the exact `{statusCode, body, redirectedTo}` triple
 * byte-for-byte against tests/fixtures/github-install-flow-golden.json, a
 * fixture captured on `main` at LIN-2397 stage A (HEAD `2261cc67`) BEFORE any
 * production code moves. Stage B must keep every one of these byte-identical.
 *
 * Two bytes are genuinely non-deterministic and are normalized identically on
 * both sides of the comparison (see github-install-flow-branches.js):
 *   - `githubErrorDiagnostic`'s `time` field (`new Date().toISOString()`,
 *     lib/errors.js) → normalized to `[TIME]`.
 *   - `begin`'s freshly minted CSRF nonce (`crypto.randomUUID()`) as it
 *     appears in the authorize-URL redirect → normalized to `[STATE]`.
 * Everything else — every character of every error page, every picker page,
 * every redirect target's non-nonce portion — is asserted verbatim.
 *
 * Scope: this is a broad, explicitly-bounded matrix (34 branches per router,
 * covering the config gate, every begin/callback/link error page, every
 * success redirect, and every documented LIN-2397 characterization gap) — not
 * a literal enumeration of all ~50+ branches in the two routers (the
 * account-conflict/merge-offer branches already have dedicated coverage in
 * the two route test files and are not duplicated here). See the LIN-2397
 * summary comment for the full branch list.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { MangoClient } from '@jkershaw/mangodb';
import { createGitHubAuthRoutes } from '../../routes/github-auth.js';
import { createGitHubProjectsAuthRoutes } from '../../routes/github-projects-auth.js';
import { AccountStore } from '../../lib/account-store.js';
import { AccountWorkspaceStore } from '../../lib/account-workspace-store.js';
import { buildBranches, runBranch } from '../fixtures/github-install-flow-branches.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GOLDEN = JSON.parse(readFileSync(join(__dirname, '../fixtures/github-install-flow-golden.json'), 'utf8'));

const { privateKey: RSA_PRIVATE_KEY } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const RSA_PEM = RSA_PRIVATE_KEY.export({ type: 'pkcs1', format: 'pem' });

function fakeGithubProvider() {
  return {
    name: 'github',
    beginAuth: ({ state }) => `https://github.com/login/oauth/authorize?client_id=cid&state=${state}`,
    beginInstall: ({ state }) => `https://github.com/apps/my-app/installations/new?state=${state}`,
    completeInstallation: async (installationId) => {
      if (installationId === 'bad') throw new Error('GitHub App auth: installation-token request failed');
      return { token: 'ghs_inst', login: 'octocat', userId: '42', installationId: String(installationId), tokenExpiresAt: '2026-06-25T20:00:00Z' };
    },
    listRepos: async () => ([{ slug: 'octocat/hello-world', name: 'octocat/hello-world', private: false }]),
    completeAuth: async (code) => {
      if (code === 'bad') { const e = new Error('bad_verification_code'); e.detail = 'bad_verification_code'; throw e; }
      return { access_token: 'gho_user' };
    },
    listReboundableRepos: async () => ([{ slug: 'octocat/hello-world', name: 'octocat/hello-world', private: false, installationId: '77' }]),
    fetchViewer: async () => ({ id: 'human-42', login: 'octocat', name: 'The Octocat' }),
  };
}

function fakeGithubProjectsProvider() {
  return {
    name: 'github-projects',
    beginAuth: ({ state }) => `https://github.com/login/oauth/authorize?client_id=cid&state=${state}`,
    beginInstall: ({ state }) => `https://github.com/apps/my-app/installations/new?state=${state}`,
    completeInstallation: async (installationId) => {
      if (installationId === 'bad') throw new Error('GitHub App auth: installation-token request failed');
      return { token: 'ghs_inst', login: 'octocat', userId: '42', installationId: String(installationId), tokenExpiresAt: '2026-06-25T20:00:00Z' };
    },
    listBoards: async (_token, login) => ([{ login, number: 5, title: 'Roadmap', url: 'u', shortDescription: null, closed: false }]),
    completeAuth: async (code) => {
      if (code === 'bad') { const e = new Error('bad_verification_code'); e.detail = 'bad_verification_code'; throw e; }
      return { access_token: 'gho_user' };
    },
    listReboundableBoards: async () => ([{ login: 'octocat', number: 5, title: 'Roadmap', url: 'u', shortDescription: null, closed: false, installationId: '77' }]),
    fetchViewer: async () => ({ id: 'human-42', login: 'octocat', name: 'The Octocat' }),
  };
}

const DESCRIPTORS = [
  {
    routerKey: 'github',
    createRoutes: createGitHubAuthRoutes,
    basePath: '/auth/github',
    providerName: 'github',
    bodyField: 'repo',
    pendingKey: 'githubPending',
    goodSlug: 'octocat/hello-world',
    notEnumeratedSlug: 'octocat/not-enumerated',
    listChoicesMethod: 'listRepos',
    listReboundableMethod: 'listReboundableRepos',
    rebindMapKey: 'repoInstallations',
    baseFakeProvider: fakeGithubProvider,
  },
  {
    routerKey: 'github-projects',
    createRoutes: createGitHubProjectsAuthRoutes,
    basePath: '/auth/github-projects',
    providerName: 'github-projects',
    bodyField: 'board',
    pendingKey: 'githubProjectsPending',
    goodSlug: 'octocat/5',
    notEnumeratedSlug: 'octocat/99',
    listChoicesMethod: 'listBoards',
    listReboundableMethod: 'listReboundableBoards',
    rebindMapKey: 'boardInstallations',
    baseFakeProvider: fakeGithubProjectsProvider,
  },
];

describe('GitHub install-flow golden harness (byte-parity, LIN-2397 stage A)', () => {
  const ENV = ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY', 'GITHUB_APP_SLUG'];
  let saved;
  let dbClient;
  let dbDir;
  let acctCounter = 0;

  before(async () => {
    saved = Object.fromEntries(ENV.map(k => [k, process.env[k]]));
    process.env.GITHUB_CLIENT_ID = 'cid';
    process.env.GITHUB_CLIENT_SECRET = 'secret';
    process.env.GITHUB_APP_ID = '12345';
    process.env.GITHUB_APP_PRIVATE_KEY = RSA_PEM;
    process.env.GITHUB_APP_SLUG = 'my-app';
    dbDir = mkdtempSync(join(tmpdir(), 'github-golden-'));
    dbClient = new MangoClient(dbDir);
    await dbClient.connect();
  });
  after(async () => {
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    if (dbClient?.close) await dbClient.close();
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  });

  function freshAccountStores() {
    const db = dbClient.db(`acct_${acctCounter++}`);
    return {
      accountStore: new AccountStore({ collection: db.collection('accounts') }),
      accountWorkspaceStore: new AccountWorkspaceStore({ collection: db.collection('account-workspaces') }),
    };
  }

  for (const d of DESCRIPTORS) {
    describe(d.routerKey, () => {
      const branches = buildBranches(d);
      assert.equal(branches.length, Object.keys(GOLDEN[d.routerKey]).length,
        `branch count drifted from the golden fixture for ${d.routerKey} — regenerate the fixture deliberately, don't just widen this assertion`);

      for (const branch of branches) {
        test(branch.key, async () => {
          const expected = GOLDEN[d.routerKey][branch.key];
          assert.ok(expected, `no golden fixture entry for ${d.routerKey}:${branch.key}`);

          const provider = branch.provider ? branch.provider() : d.baseFakeProvider();
          let savedAppId;
          if (branch.notConfigured) {
            savedAppId = process.env.GITHUB_APP_ID;
            delete process.env.GITHUB_APP_ID;
          }
          try {
            const router = d.createRoutes({
              provider,
              ...freshAccountStores(),
              ...(branch.userPreferencesStore ? { userPreferencesStore: branch.userPreferencesStore } : {}),
            });
            const actual = await runBranch(router, branch);
            assert.deepStrictEqual(actual, expected);
          } finally {
            if (branch.notConfigured) process.env.GITHUB_APP_ID = savedAppId;
          }
        });
      }
    });
  }
});
