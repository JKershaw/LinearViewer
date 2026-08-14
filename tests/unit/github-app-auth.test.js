/**
 * Unit tests for the GitHub App auth primitives (LIN-707) — the root credential
 * seam of the GitHub App migration (LIN-703).
 *
 * Fully offline:
 *   - mintAppJwt()           : sign with an in-test ephemeral RSA keypair and
 *                              VERIFY the signature with the public key (round
 *                              trip), plus header/payload claims.
 *   - mintInstallationToken(): a stub `fetchImpl` asserts method/URL/Bearer and
 *                              returns a canned 201 — no `fake-client.js` change.
 *   - getAppConfig()         : required-field throws and PEM newline handling.
 *
 * Run with: node --test tests/unit/github-app-auth.test.js
 */
import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert'
import crypto from 'node:crypto'
import { mintAppJwt, mintInstallationToken, fetchInstallation, exchangeOAuthCode, getAppConfig, withTimeout, GITHUB_VIEWER_TIMEOUT_MS } from '../../lib/providers/github/app-auth.js'

// One ephemeral RSA keypair for the whole suite — generated, never on disk.
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
const PEM = privateKey.export({ type: 'pkcs1', format: 'pem' })

const ENV = ['GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY', 'GITHUB_APP_SLUG']

function decodeSegment(seg) {
  return JSON.parse(Buffer.from(seg.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))
}

describe('GitHub App auth primitives (LIN-707)', () => {
  let saved
  beforeEach(() => {
    saved = Object.fromEntries(ENV.map(k => [k, process.env[k]]))
    process.env.GITHUB_APP_ID = '123456'
    process.env.GITHUB_APP_PRIVATE_KEY = PEM
    process.env.GITHUB_APP_SLUG = 'my-app'
  })
  afterEach(() => {
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  })

  // -------------------------------------------------------------------------
  // getAppConfig()
  // -------------------------------------------------------------------------

  test('getAppConfig returns id/key/slug', () => {
    const cfg = getAppConfig()
    assert.equal(cfg.appId, '123456')
    assert.equal(cfg.privateKey, PEM)
    assert.equal(cfg.slug, 'my-app')
  })

  test('getAppConfig un-escapes a single-line PEM', () => {
    process.env.GITHUB_APP_PRIVATE_KEY = 'line1\\nline2'
    assert.equal(getAppConfig().privateKey, 'line1\nline2')
  })

  test('getAppConfig throws clearly when GITHUB_APP_ID missing', () => {
    delete process.env.GITHUB_APP_ID
    assert.throws(() => getAppConfig(), /GITHUB_APP_ID/)
  })

  test('getAppConfig throws clearly when GITHUB_APP_PRIVATE_KEY missing', () => {
    delete process.env.GITHUB_APP_PRIVATE_KEY
    assert.throws(() => getAppConfig(), /GITHUB_APP_PRIVATE_KEY/)
  })

  test('getAppConfig does NOT require GITHUB_APP_SLUG', () => {
    delete process.env.GITHUB_APP_SLUG
    assert.equal(getAppConfig().slug, undefined)
  })

  // -------------------------------------------------------------------------
  // mintAppJwt()
  // -------------------------------------------------------------------------

  test('mintAppJwt produces an RS256 JWT with correct claims', () => {
    const now = 1_700_000_000_000 // fixed epoch ms
    const jwt = mintAppJwt({ now })
    const [h, p] = jwt.split('.')
    const header = decodeSegment(h)
    const payload = decodeSegment(p)

    assert.deepEqual(header, { alg: 'RS256', typ: 'JWT' })
    assert.equal(payload.iss, '123456')
    const nowS = Math.floor(now / 1000)
    assert.equal(payload.iat, nowS - 60, 'iat backdated 60s for clock drift')
    assert.equal(payload.exp - payload.iat, 600, 'exp is 10 minutes after iat')
  })

  test('mintAppJwt signature verifies against the public key (round trip)', () => {
    const jwt = mintAppJwt()
    const [h, p, sig] = jwt.split('.')
    const signingInput = `${h}.${p}`
    const ok = crypto
      .createVerify('RSA-SHA256')
      .update(signingInput)
      .verify(publicKey, Buffer.from(sig.replace(/-/g, '+').replace(/_/g, '/'), 'base64'))
    assert.equal(ok, true)
  })

  test('mintAppJwt signature is rejected for a tampered payload', () => {
    const jwt = mintAppJwt()
    const [h, , sig] = jwt.split('.')
    const forged = Buffer.from(JSON.stringify({ iss: 'evil' })).toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    const ok = crypto
      .createVerify('RSA-SHA256')
      .update(`${h}.${forged}`)
      .verify(publicKey, Buffer.from(sig.replace(/-/g, '+').replace(/_/g, '/'), 'base64'))
    assert.equal(ok, false)
  })

  test('mintAppJwt throws when app config is missing', () => {
    delete process.env.GITHUB_APP_ID
    assert.throws(() => mintAppJwt(), /GITHUB_APP_ID/)
  })

  // -------------------------------------------------------------------------
  // mintInstallationToken()
  // -------------------------------------------------------------------------

  test('mintInstallationToken POSTs to the install access_tokens endpoint with the App JWT', async () => {
    let captured
    const fetchImpl = async (url, init) => {
      captured = { url, init }
      return {
        ok: true,
        status: 201,
        text: async () => JSON.stringify({ token: 'ghs_abc', expires_at: '2026-06-25T20:00:00Z', permissions: { issues: 'write' } }),
      }
    }
    const payload = await mintInstallationToken('42', { fetchImpl })

    assert.equal(captured.url, 'https://api.github.com/app/installations/42/access_tokens')
    assert.equal(captured.init.method, 'POST')
    assert.match(captured.init.headers.Authorization, /^Bearer [\w-]+\.[\w-]+\.[\w-]+$/)
    assert.equal(captured.init.headers.Accept, 'application/vnd.github+json')
    assert.equal(captured.init.headers['X-GitHub-Api-Version'], '2022-11-28')

    // Full payload preserved; {token, expires_at} guaranteed.
    assert.equal(payload.token, 'ghs_abc')
    assert.equal(payload.expires_at, '2026-06-25T20:00:00Z')
    assert.deepEqual(payload.permissions, { issues: 'write' })
  })

  test('mintInstallationToken path-encodes the installation id', async () => {
    let capturedUrl
    const fetchImpl = async (url) => {
      capturedUrl = url
      return { ok: true, status: 201, text: async () => '{"token":"t","expires_at":"x"}' }
    }
    await mintInstallationToken('a/b', { fetchImpl })
    assert.equal(capturedUrl, 'https://api.github.com/app/installations/a%2Fb/access_tokens')
  })

  test('mintInstallationToken throws with status on a non-2xx response', async () => {
    const fetchImpl = async () => ({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      text: async () => JSON.stringify({ message: 'Not Found' }),
    })
    await assert.rejects(
      () => mintInstallationToken('99', { fetchImpl }),
      (err) => {
        assert.equal(err.status, 404)
        assert.match(err.message, /Not Found/)
        return true
      },
    )
  })

  test('mintInstallationToken requires an installationId', async () => {
    await assert.rejects(() => mintInstallationToken('', { fetchImpl: async () => ({}) }), /installationId is required/)
    await assert.rejects(() => mintInstallationToken(null, { fetchImpl: async () => ({}) }), /installationId is required/)
  })

  // -------------------------------------------------------------------------
  // fetchInstallation() — App-JWT installation lookup for callback identity (LIN-709)
  // -------------------------------------------------------------------------

  test('fetchInstallation GETs the installation endpoint with the App JWT and returns account', async () => {
    let captured
    const fetchImpl = async (url, init) => {
      captured = { url, init }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ id: 42, account: { id: 7, login: 'octocat' } }),
      }
    }
    const data = await fetchInstallation('42', { fetchImpl })

    assert.equal(captured.url, 'https://api.github.com/app/installations/42')
    assert.equal(captured.init.method, 'GET')
    assert.match(captured.init.headers.Authorization, /^Bearer [\w-]+\.[\w-]+\.[\w-]+$/)
    assert.equal(captured.init.headers.Accept, 'application/vnd.github+json')
    assert.equal(captured.init.headers['X-GitHub-Api-Version'], '2022-11-28')

    assert.deepEqual(data.account, { id: 7, login: 'octocat' })
  })

  test('fetchInstallation path-encodes the installation id', async () => {
    let capturedUrl
    const fetchImpl = async (url) => {
      capturedUrl = url
      return { ok: true, status: 200, text: async () => '{"account":{"id":1,"login":"x"}}' }
    }
    await fetchInstallation('a/b', { fetchImpl })
    assert.equal(capturedUrl, 'https://api.github.com/app/installations/a%2Fb')
  })

  test('fetchInstallation throws with status on a non-2xx response', async () => {
    const fetchImpl = async () => ({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      text: async () => JSON.stringify({ message: 'Not Found' }),
    })
    await assert.rejects(
      () => fetchInstallation('99', { fetchImpl }),
      (err) => {
        assert.equal(err.status, 404)
        assert.match(err.message, /Not Found/)
        return true
      },
    )
  })

  test('fetchInstallation requires an installationId', async () => {
    await assert.rejects(() => fetchInstallation('', { fetchImpl: async () => ({}) }), /installationId is required/)
    await assert.rejects(() => fetchInstallation(null, { fetchImpl: async () => ({}) }), /installationId is required/)
  })
})

// -------------------------------------------------------------------------
// exchangeOAuthCode() (LIN-2080) — the code exchange must mirror
// buildAuthorizeUrl's redirect_uri guard: OMIT the param entirely when
// unset. `redirect_uri: redirectUri || process.env.GITHUB_REDIRECT_URI`
// inside a `new URLSearchParams({...})` literal stringifies a missing value
// to the LITERAL text "undefined", which GitHub rejects as a mismatch.
// -------------------------------------------------------------------------
describe('exchangeOAuthCode (LIN-2080)', () => {
  const ENV = ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'GITHUB_REDIRECT_URI']
  let saved
  beforeEach(() => {
    saved = Object.fromEntries(ENV.map(k => [k, process.env[k]]))
    process.env.GITHUB_CLIENT_ID = 'client-123'
    process.env.GITHUB_CLIENT_SECRET = 'secret-abc'
    delete process.env.GITHUB_REDIRECT_URI
  })
  afterEach(() => {
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  })

  function fakeFetch(captured) {
    return async (url, init) => {
      captured.url = url
      captured.init = init
      return { ok: true, status: 200, json: async () => ({ access_token: 'gho_abc' }) }
    }
  }

  test('omits redirect_uri entirely when neither opts.redirectUri nor GITHUB_REDIRECT_URI is set', async () => {
    const captured = {}
    const result = await exchangeOAuthCode('a-code', { fetchImpl: fakeFetch(captured) })

    assert.equal(result.access_token, 'gho_abc')
    assert.equal(
      captured.init.body.has('redirect_uri'),
      false,
      `redirect_uri must be OMITTED when unset, not stringified — got "${captured.init.body.get('redirect_uri')}"`,
    )
  })

  test('includes the exact redirect_uri when passed as opts.redirectUri', async () => {
    const captured = {}
    await exchangeOAuthCode('a-code', { redirectUri: 'https://example.com/cb', fetchImpl: fakeFetch(captured) })
    assert.equal(captured.init.body.get('redirect_uri'), 'https://example.com/cb')
  })

  test('includes the exact redirect_uri from the GITHUB_REDIRECT_URI env fallback', async () => {
    process.env.GITHUB_REDIRECT_URI = 'https://example.com/env-cb'
    const captured = {}
    await exchangeOAuthCode('a-code', { fetchImpl: fakeFetch(captured) })
    assert.equal(captured.init.body.get('redirect_uri'), 'https://example.com/env-cb')
  })
})

// -------------------------------------------------------------------------
// withTimeout() (LIN-1348) — the generic race-a-promise-against-a-timeout
// helper backing the GET /user viewer lookup's 8s budget (LIN-761 hang
// history). NOTE: routes/proxy.js has its own SEPARATE private `withTimeout`
// with its own budgets — out of scope here, do not conflate.
// -------------------------------------------------------------------------

describe('withTimeout (LIN-1348)', () => {
  test('resolves with the value when the promise settles within budget, no timeout fires', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const result = await withTimeout(Promise.resolve('viewer-data'), GITHUB_VIEWER_TIMEOUT_MS)
    assert.equal(result, 'viewer-data')
  })

  test('rejects with ETIMEDOUT and the budget in the message once the timer fires at exactly the budget', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const hang = new Promise(() => {}) // never settles on its own
    const promise = withTimeout(hang, GITHUB_VIEWER_TIMEOUT_MS)
    const assertion = assert.rejects(promise, (err) => {
      assert.equal(err.code, 'ETIMEDOUT')
      assert.match(err.message, /8000ms/)
      return true
    })
    t.mock.timers.tick(GITHUB_VIEWER_TIMEOUT_MS)
    await assertion
  })

  test('has not rejected yet at 7999ms, one ms short of the budget', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const hang = new Promise(() => {})
    const promise = withTimeout(hang, GITHUB_VIEWER_TIMEOUT_MS)
    let settled = false
    promise.then(() => { settled = true }, () => { settled = true })

    t.mock.timers.tick(GITHUB_VIEWER_TIMEOUT_MS - 1)
    await Promise.resolve() // flush microtasks queued by the (non-firing) tick
    assert.equal(settled, false, 'must not reject before the full budget has elapsed')
  })
})
