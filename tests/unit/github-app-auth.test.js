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
import { mintAppJwt, mintInstallationToken, fetchInstallation, getAppConfig } from '../../lib/providers/github/app-auth.js'

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
