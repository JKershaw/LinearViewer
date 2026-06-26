/**
 * Offline integration test for the GitHub App migration (LIN-714).
 *
 * The per-surface unit tests already pin the pieces in isolation: the App
 * JWT + installation-token primitives (LIN-707, github-app-auth.test.js), the
 * provider-aware re-mint seam (LIN-712), and the per-request client built from a
 * binding credential (LIN-713, both in github-provider.test.js). This file
 * exercises the two behaviours the migration ultimately depends on as a single
 * lifecycle, across the seams rather than within one:
 *
 *   1. Installation-token RE-MINT when the stored binding is past expiry —
 *      driven through `GitHubProvider.refreshCredential(binding, { fetchImpl,
 *      now })`, the one seam that threads both the injectable network (`fetchImpl`
 *      into mintInstallationToken) and the injectable clock (`now` into
 *      mintAppJwt). The staleness COMPARISON itself lives in the middleware
 *      (`ensureValidToken`, real `Date.now()`) and is NOT seam-injectable
 *      offline, so we assert that the provider mints a fresh token with a future
 *      expiry — not that the middleware decided to call it (a tracked gap, see
 *      the LIN-714 plan).
 *
 *   2. The per-repo PERMISSION BOUNDARY at the client/scope seam — a binding
 *      scoped to repo A must not read or write repo B. Asserted through a
 *      token-aware `clientFactory` (the LIN-713 DI seam): a token authorises
 *      exactly one repo, and any other repo returns a GitHub-shaped 403. We do
 *      NOT use `createFakeGitHubClient` for this: it lazily auto-creates any repo
 *      partition (fake-client.js), so repo B would return EMPTY rather than 403
 *      and the boundary would falsely pass. The boundary is a property of the
 *      installation token's scope, so it is modelled at the token→client seam.
 *
 *   3. The LIFECYCLE CHAIN — feed the freshly re-minted token into the
 *      request-time client and prove the boundary holds for the token we just
 *      minted (the genuine integration: refreshCredential is the PRODUCER of the
 *      token, _clientFor is the CONSUMER; they meet at the binding credential).
 *
 * Fully offline: an in-test ephemeral RSA keypair signs the App JWT (mirroring
 * github-app-auth.test.js), `fetchImpl` stubs the install-token network, and the
 * `clientFactory` stubs the per-request REST client. No real GitHub App, no real
 * network, no waiting a real hour. Zero production changes.
 *
 * Run with: node --test tests/unit/github-app-integration.test.js
 */
import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert'
import crypto from 'node:crypto'
import { GitHubProvider } from '../../lib/providers/github/index.js'

// One ephemeral RSA keypair for the whole suite so refreshCredential's App JWT
// can be signed offline (mirrors github-app-auth.test.js). Generated, never on disk.
const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
const PEM = privateKey.export({ type: 'pkcs1', format: 'pem' })

const APP_ENV = ['GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY', 'GITHUB_APP_SLUG']

const REPO_A = 'octocat/repo-a'
const REPO_B = 'octocat/repo-b'

/**
 * A request-time REST client scoped to exactly ONE repo, modelling the
 * installation token's GitHub-side permission boundary. Any call for a different
 * repo throws a GitHub-shaped 403 (`status: 403`) — the same surface a real
 * installation token returns when asked to touch a repo it was not granted. This
 * is deliberately NOT createFakeGitHubClient (which auto-creates repo partitions
 * and so cannot express a 403).
 */
function clientScopedTo(authorizedRepo) {
  const guard = (slug) => {
    if (slug !== authorizedRepo) {
      const err = new Error('GitHub: Resource not accessible by integration')
      err.status = 403
      throw err
    }
  }
  return {
    async listIssues(slug) {
      guard(slug)
      return [{ number: 1, title: 'Scoped issue', body: '', state: 'open', created_at: '2026-01-01T00:00:00Z', labels: [], milestone: null }]
    },
    async listMilestones(slug) {
      guard(slug)
      return []
    },
    async getIssue(slug, number) {
      guard(slug)
      return { number: Number(number), title: 'Scoped issue', body: '', state: 'open', created_at: '2026-01-01T00:00:00Z', labels: [], milestone: null }
    },
    async createIssue(slug, { title, body = '' } = {}) {
      guard(slug)
      return { number: 99, title, body, state: 'open', state_reason: null, created_at: '2026-01-01T00:00:00Z', closed_at: null, labels: [], milestone: null }
    },
  }
}

/**
 * Build a GitHubProvider (no boot client — exactly like production GitHub App
 * workspaces) whose request-time `clientFactory` maps each token to the single
 * repo that token authorises. A token absent from the map authorises nothing, so
 * every repo it touches 403s.
 */
function makeBoundProvider(tokenToRepo) {
  return new GitHubProvider({
    clientFactory: (token) => clientScopedTo(tokenToRepo[token] ?? null),
  })
}

describe('GitHub App offline integration: re-mint + per-repo boundary (LIN-714)', () => {
  let saved
  beforeEach(() => {
    saved = Object.fromEntries(APP_ENV.map(k => [k, process.env[k]]))
    process.env.GITHUB_APP_ID = '123456'
    process.env.GITHUB_APP_PRIVATE_KEY = PEM
    process.env.GITHUB_APP_SLUG = 'my-app'
  })
  afterEach(() => {
    for (const k of APP_ENV) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  })

  // ---------------------------------------------------------------------------
  // 1. Installation-token re-mint when the stored binding is past expiry.
  // ---------------------------------------------------------------------------
  test('re-mints a fresh installation token with a future expiry when the stored token is expired', async () => {
    // Drive a deterministic clock. The stored binding expired well in the past;
    // GitHub will hand back a token valid ~1h from `now`.
    const now = 1_700_000_000_000 // fixed epoch ms
    const storedExpiry = now - 60 * 60 * 1000 // expired an hour ago
    const freshExpiryIso = new Date(now + 60 * 60 * 1000).toISOString()

    const calls = []
    const fetchImpl = async (url, init) => {
      calls.push({ url, headers: init?.headers || {}, method: init?.method })
      return {
        ok: true,
        status: 201,
        statusText: 'Created',
        text: async () => JSON.stringify({ token: 'ghs_fresh_token', expires_at: freshExpiryIso }),
      }
    }

    const provider = new GitHubProvider() // no boot client — production GitHub App shape
    const binding = {
      provider: 'github',
      scope: REPO_A,
      credentials: { installationId: '987', token: 'ghs_expired_token', tokenExpiresAt: storedExpiry },
    }

    const patch = await provider.refreshCredential(binding, { fetchImpl, now })

    // The mint hit the installation access-tokens endpoint, App-JWT-authenticated.
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, 'https://api.github.com/app/installations/987/access_tokens')
    assert.equal(calls[0].method, 'POST')
    assert.match(calls[0].headers.Authorization, /^Bearer [\w-]+\.[\w-]+\.[\w-]+$/, 'App JWT carried as Bearer')

    // The token ROTATED away from the stored (expired) one...
    assert.equal(patch.token, 'ghs_fresh_token')
    assert.notEqual(patch.token, binding.credentials.token)
    // ...and the new expiry is a real ms-epoch number strictly LATER than the
    // expired one we started with (the lifecycle property the middleware relies on).
    assert.equal(typeof patch.tokenExpiresAt, 'number')
    assert.equal(patch.tokenExpiresAt, Date.parse(freshExpiryIso))
    assert.ok(patch.tokenExpiresAt > storedExpiry, 'fresh expiry is later than the stored expired one')
    assert.ok(patch.tokenExpiresAt > now, 'fresh expiry is in the future relative to the controlled now')
    assert.equal(patch.installationId, '987')
  })

  // ---------------------------------------------------------------------------
  // 2. Per-repo permission boundary at the client/scope seam.
  // ---------------------------------------------------------------------------
  test('a binding scoped to repo A can read repo A but is rejected (403) reading repo B', async () => {
    const provider = makeBoundProvider({ tokenA: REPO_A })

    // Repo A through token A: succeeds.
    const issue = await provider.fetchIssueFields({ repo: REPO_A, token: 'tokenA' }, '1')
    assert.equal(issue.title, 'Scoped issue')

    // Repo B through the SAME token A: rejected at the client/scope seam with 403.
    await assert.rejects(
      () => provider.fetchIssueFields({ repo: REPO_B, token: 'tokenA' }, '1'),
      (err) => {
        assert.equal(err.status, 403)
        assert.match(err.message, /not accessible/i)
        return true
      },
    )
  })

  test('the same boundary holds for WRITES: repo A create succeeds, repo B create is rejected (403)', async () => {
    const provider = makeBoundProvider({ tokenA: REPO_A })

    const created = await provider.createIssue({ repo: REPO_A, token: 'tokenA' }, { title: 'From App', description: 'body' })
    assert.equal(created.title, 'From App')

    await assert.rejects(
      () => provider.createIssue({ repo: REPO_B, token: 'tokenA' }, { title: 'Crossing the boundary', description: 'nope' }),
      (err) => {
        assert.equal(err.status, 403)
        return true
      },
    )
  })

  // ---------------------------------------------------------------------------
  // 3. Lifecycle chain — re-mint, then prove the freshly minted token is itself
  //    bounded to its repo. refreshCredential PRODUCES the token; _clientFor
  //    CONSUMES it; they meet at the binding credential.
  // ---------------------------------------------------------------------------
  test('lifecycle: a freshly re-minted token reads its own repo but is still bounded out of repo B', async () => {
    const now = 1_700_000_000_000
    const freshExpiryIso = new Date(now + 60 * 60 * 1000).toISOString()
    const fetchImpl = async () => ({
      ok: true,
      status: 201,
      statusText: 'Created',
      text: async () => JSON.stringify({ token: 'ghs_minted_for_A', expires_at: freshExpiryIso }),
    })

    // Provider whose request-time client maps the to-be-minted token onto repo A.
    const provider = makeBoundProvider({ ghs_minted_for_A: REPO_A })

    // Step 1 — re-mint from an expired binding.
    const patch = await provider.refreshCredential(
      { provider: 'github', scope: REPO_A, credentials: { installationId: '987', token: 'ghs_expired', tokenExpiresAt: now - 1000 } },
      { fetchImpl, now },
    )
    assert.equal(patch.token, 'ghs_minted_for_A')

    // Step 2 — drive a request-time client from the FRESH token (the consumer
    // seam). Repo A reads; repo B is still 403 under the same fresh token.
    const issue = await provider.fetchIssueFields({ repo: REPO_A, token: patch.token }, '1')
    assert.equal(issue.title, 'Scoped issue')

    await assert.rejects(
      () => provider.fetchIssueFields({ repo: REPO_B, token: patch.token }, '1'),
      (err) => {
        assert.equal(err.status, 403)
        return true
      },
    )
  })
})
