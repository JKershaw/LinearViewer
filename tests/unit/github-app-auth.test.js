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
import { mintAppJwt, mintInstallationToken, fetchInstallation, exchangeOAuthCode, getAppConfig, buildInstallUrl, withTimeout, isGitHubConfigured, GITHUB_VIEWER_TIMEOUT_MS } from '../../lib/providers/github/app-auth.js'

// One ephemeral RSA keypair for the whole suite — generated, never on disk.
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
const PEM = privateKey.export({ type: 'pkcs1', format: 'pem' })

// GITHUB_CLIENT_ID/SECRET are included here (not just the GITHUB_APP_* trio)
// so every test in this file starts with ALL FIVE GITHUB_REQUIRED_ENV vars
// present — isGitHubConfigured() assertions below then isolate purely on
// GITHUB_APP_PRIVATE_KEY's shape, never a missing-var false negative.
const ENV = ['GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY', 'GITHUB_APP_SLUG', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET']

function decodeSegment(seg) {
  return JSON.parse(Buffer.from(seg.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))
}

// Cross-checks a PEM string against what it will actually be used for
// (LIN-2081 review findings 1+2): sign, then verify with the matching public
// key. This is ground truth, independent of assertPemShape's own opinion —
// the review's blocking findings were both missed by tests that only
// asserted "throws"/"doesn't throw" without ever driving a real signature.
function signsOk(pem) {
  try {
    const sig = crypto.createSign('RSA-SHA256').update('probe').sign(pem)
    return crypto.createVerify('RSA-SHA256').update('probe').verify(publicKey, sig)
  } catch {
    return false
  }
}

describe('GitHub App auth primitives (LIN-707)', () => {
  let saved
  beforeEach(() => {
    saved = Object.fromEntries(ENV.map(k => [k, process.env[k]]))
    process.env.GITHUB_APP_ID = '123456'
    process.env.GITHUB_APP_PRIVATE_KEY = PEM
    process.env.GITHUB_APP_SLUG = 'my-app'
    process.env.GITHUB_CLIENT_ID = 'client-id'
    process.env.GITHUB_CLIENT_SECRET = 'client-secret'
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
    // The real-world case the escape handling exists for: a multi-line PEM
    // squeezed onto one line via literal `\n` sequences (LIN-2081 — the
    // fixture must be PEM-shaped so it also survives shape validation).
    process.env.GITHUB_APP_PRIVATE_KEY = PEM.replace(/\n/g, '\\n')
    assert.equal(getAppConfig().privateKey, PEM)
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
  // getAppConfig() — PEM shape validation (LIN-2081)
  //
  // Three real-world misconfigurations from the LIN-2057 test-App setup all
  // surfaced identically as OpenSSL's opaque `ERR_OSSL_UNSUPPORTED` deep
  // inside Sign.sign — these pin that getAppConfig() now catches each one at
  // config time and names the SPECIFIC defect, not just "throws".
  // -------------------------------------------------------------------------

  test('getAppConfig rejects a truncated ~12-char stub key (LIN-2081)', () => {
    process.env.GITHUB_APP_PRIVATE_KEY = 'abcdefghijkl'
    assert.throws(
      () => getAppConfig(),
      /GitHub App auth: GITHUB_APP_PRIVATE_KEY does not start with a PEM '-----BEGIN' header/
    )
  })

  test('getAppConfig rejects a shell-poisoned fragment glued onto the front (LIN-2081)', () => {
    // e.g. a stray path fragment left in the env var by a broken shell quoting
    process.env.GITHUB_APP_PRIVATE_KEY = '$HOME/.ssh/' + PEM
    assert.throws(
      () => getAppConfig(),
      /GitHub App auth: GITHUB_APP_PRIVATE_KEY has 11 unexpected character\(s\) before the '-----BEGIN' header/
    )
  })

  test('getAppConfig rejects a stray zsh %% glued onto the END armor (LIN-2081)', () => {
    // zsh appends a bare `%` to output with no trailing newline when a value
    // gets pasted/echoed into an env file — exactly the LIN-2057 defect.
    process.env.GITHUB_APP_PRIVATE_KEY = PEM.replace(/\n$/, '') + '%'
    assert.throws(
      () => getAppConfig(),
      /GitHub App auth: GITHUB_APP_PRIVATE_KEY ends with stray characters after the END line: '%'/
    )
  })

  test('getAppConfig rejects an implausibly short key even with valid-looking armor (LIN-2081)', () => {
    process.env.GITHUB_APP_PRIVATE_KEY = '-----BEGIN RSA PRIVATE KEY-----\nAAAA\n-----END RSA PRIVATE KEY-----\n'
    assert.throws(
      () => getAppConfig(),
      /GitHub App auth: GITHUB_APP_PRIVATE_KEY is too short to be a real PEM key \(\d+ chars, expected 1000\+\)/
    )
  })

  test('getAppConfig rejects a body character outside the PEM alphabet, naming the line (LIN-2081)', () => {
    const lines = PEM.split('\n')
    lines[2] = lines[2].slice(0, 4) + '!' + lines[2].slice(4) // corrupt a body line, not the headers
    process.env.GITHUB_APP_PRIVATE_KEY = lines.join('\n')
    assert.throws(
      () => getAppConfig(),
      /GitHub App auth: GITHUB_APP_PRIVATE_KEY contains invalid characters outside the PEM alphabet on line 3: /
    )
  })

  test('getAppConfig accepts a real, valid PEM cleanly (no throw)', () => {
    assert.doesNotThrow(() => getAppConfig())
  })

  // -------------------------------------------------------------------------
  // getAppConfig() — PEM-shape validator fix pass (LIN-2081 review findings
  // 1+2). The original 7 tests above all used ONE canonical LF fixture, which
  // is exactly why CI was green while the validator was wrong in both
  // directions: it let a newline-stripped key sail through to the ORIGINAL
  // ERR_OSSL_UNSUPPORTED bug (finding 1), and it hard-rejected several key
  // formats OpenSSL happily signs (finding 2). Every "should be accepted" row
  // below is cross-checked against a real crypto.createSign(...).sign() round
  // trip via signsOk(), not just "getAppConfig doesn't throw" — and every
  // "should be rejected" row asserts the SPECIFIC defect message, not just
  // "throws".
  // -------------------------------------------------------------------------

  describe('PEM shape validator matrix (LIN-2081 fix pass)', () => {
    test('sanity: signsOk() itself agrees the canonical fixture signs, and a garbage string does not', () => {
      assert.equal(signsOk(PEM), true)
      assert.equal(signsOk('not a key'), false)
    })

    // --- Finding 2: four working formats must be ACCEPTED, and the value ---
    // --- getAppConfig() returns must be provably signable, not just non-throwing.

    test('accepts CRLF line endings, and the normalized key actually signs', () => {
      process.env.GITHUB_APP_PRIVATE_KEY = PEM.replace(/\n/g, '\r\n')
      const cfg = getAppConfig()
      assert.equal(signsOk(cfg.privateKey), true)
    })

    test('accepts an extra trailing blank line, and the normalized key actually signs', () => {
      process.env.GITHUB_APP_PRIVATE_KEY = PEM + '\n' // PEM already ends with one '\n'
      const cfg = getAppConfig()
      assert.equal(signsOk(cfg.privateKey), true)
    })

    test('accepts a trailing space after the END footer (with a final newline), and the normalized key actually signs', () => {
      process.env.GITHUB_APP_PRIVATE_KEY = PEM.replace(/\n$/, ' \n')
      const cfg = getAppConfig()
      assert.equal(signsOk(cfg.privateKey), true)
    })

    test('accepts a trailing space after the END footer (no final newline), and the normalized key actually signs', () => {
      process.env.GITHUB_APP_PRIVATE_KEY = PEM.replace(/\n$/, '') + ' '
      const cfg = getAppConfig()
      assert.equal(signsOk(cfg.privateKey), true)
    })

    test('accepts a leading blank line, and the normalized key actually signs', () => {
      process.env.GITHUB_APP_PRIVATE_KEY = '\n' + PEM
      const cfg = getAppConfig()
      assert.equal(signsOk(cfg.privateKey), true)
    })

    test('accepts leading whitespace (no blank line) — raw OpenSSL rejects it unnormalized, but getAppConfig strips it and the result signs', () => {
      // Empirically, `'   ' + PEM` does NOT sign raw (OpenSSL requires
      // '-----BEGIN' to start its own line) — but getAppConfig's leading-
      // whitespace strip removes it before the key is ever used, so the
      // NORMALIZED value must sign even though the raw input would not have.
      process.env.GITHUB_APP_PRIVATE_KEY = '   ' + PEM
      assert.equal(signsOk(process.env.GITHUB_APP_PRIVATE_KEY), false, 'raw input should NOT sign — confirms normalization is doing real work')
      const cfg = getAppConfig()
      assert.equal(signsOk(cfg.privateKey), true)
    })

    test('accepts a tab-indented PEM body (YAML block-scalar / heredoc leak), and the normalized key actually signs (LIN-2081 review observation A)', () => {
      // OpenSSL signs an indented body fine — confirmed independently before
      // deciding: rejecting it would be the same "reject-what-signs"
      // availability risk finding 2 fixed for the other whitespace variants,
      // so it is normalized away rather than left a strict-by-omission gap.
      const lines = PEM.split('\n')
      const indented = lines.map((l, i) => (i > 0 && i < lines.length - 2 ? '\t' + l : l)).join('\n')
      assert.equal(signsOk(indented), true, 'sanity: OpenSSL itself accepts a tab-indented body')
      process.env.GITHUB_APP_PRIVATE_KEY = indented
      const cfg = getAppConfig()
      assert.equal(signsOk(cfg.privateKey), true)
      assert.equal(cfg.privateKey, PEM, 'indentation is stripped, not merely tolerated')
    })

    test('accepts a space-indented PEM body, and the normalized key actually signs (LIN-2081 review observation A)', () => {
      const lines = PEM.split('\n')
      const indented = lines.map((l, i) => (i > 0 && i < lines.length - 2 ? '  ' + l : l)).join('\n')
      assert.equal(signsOk(indented), true, 'sanity: OpenSSL itself accepts a space-indented body')
      process.env.GITHUB_APP_PRIVATE_KEY = indented
      const cfg = getAppConfig()
      assert.equal(signsOk(cfg.privateKey), true)
      assert.equal(cfg.privateKey, PEM, 'indentation is stripped, not merely tolerated')
    })

    test('getAppConfig returns the byte-identical PEM when there is no stray whitespace to normalize', () => {
      // Guards against the normalization regressing to a blanket `.trim()`,
      // which would silently drop the fixture's real trailing '\n' and break
      // the exact-equality assertions in the tests above this describe block.
      assert.equal(getAppConfig().privateKey, PEM)
    })

    // --- Finding 1: a fully newline-stripped key must be REJECTED, naming ---
    // --- the defect — and never allowed to reach Sign.sign's opaque error.

    test('rejects a PEM with all line breaks stripped, naming the defect (LIN-2081 finding 1)', () => {
      const stripped = PEM.replace(/\n/g, '')
      // Ground truth: confirm this is the real bug — the raw stripped key
      // DOES fail to sign, with OpenSSL's opaque decoder error, so a
      // validator that let it through would reproduce the original defect.
      assert.equal(signsOk(stripped), false)
      process.env.GITHUB_APP_PRIVATE_KEY = stripped
      assert.throws(
        () => getAppConfig(),
        /GitHub App auth: GITHUB_APP_PRIVATE_KEY has no line breaks between the '-----BEGIN'\/'-----END' armor/
      )
    })

    test('mintAppJwt surfaces the no-line-breaks config error for a stripped key, never the raw OpenSSL decoder error', () => {
      process.env.GITHUB_APP_PRIVATE_KEY = PEM.replace(/\n/g, '')
      assert.throws(() => mintAppJwt(), (err) => {
        assert.match(err.message, /GITHUB_APP_PRIVATE_KEY has no line breaks/)
        assert.doesNotMatch(err.message, /ERR_OSSL_UNSUPPORTED|DECODER routines|unsupported/i)
        return true
      })
    })

    // --- Round-2 re-review: normalizePrivateKey's trailing-whitespace collapse
    // --- (`.replace(/\s+$/, '\n')`) re-opens finding 1 for a SIBLING input
    // --- class the `headerEnd === -1` guard alone could not catch — newlines
    // --- collapsed to some OTHER whitespace character, not stripped to
    // --- nothing. The normalizer puts a single '\n' back, but only at the
    // --- very END of the string (after the END footer), so `headerEnd` lands
    // --- PAST `endMatch.index` — the body slice is still empty, still passes
    // --- the alphabet check vacuously, still reaches Sign.sign's opaque
    // --- ERR_OSSL_UNSUPPORTED. This is exactly the "shell-poisoned fragment"
    // --- class the ticket itself names: an unquoted `export KEY=$KEY` word-
    // --- splits and rejoins a PEM's lines on spaces.

    for (const [label, collapse] of [
      ['spaces (unquoted `export KEY=$KEY` word-splitting)', s => s.replace(/\n/g, ' ')],
      ['a bare CR (stray `\\r`, no `\\n`)', s => s.replace(/\n/g, '\r')],
    ]) {
      test(`rejects newlines collapsed to ${label}, naming the defect (LIN-2081 re-review)`, () => {
        const collapsed = collapse(PEM)
        // Ground truth first: the raw collapsed key genuinely fails to sign —
        // confirms this is the real bug, not a validator being overly strict.
        assert.equal(signsOk(collapsed), false)
        process.env.GITHUB_APP_PRIVATE_KEY = collapsed
        assert.throws(
          () => getAppConfig(),
          /GitHub App auth: GITHUB_APP_PRIVATE_KEY has no line breaks between the '-----BEGIN'\/'-----END' armor/
        )
      })

      test(`mintAppJwt never emits the raw OpenSSL decoder error for newlines collapsed to ${label}`, () => {
        process.env.GITHUB_APP_PRIVATE_KEY = collapse(PEM)
        assert.throws(() => mintAppJwt(), (err) => {
          assert.match(err.message, /GITHUB_APP_PRIVATE_KEY has no line breaks between/)
          assert.doesNotMatch(err.message, /ERR_OSSL_UNSUPPORTED|DECODER routines|unsupported/i)
          return true
        })
      })

      test(`isGitHubConfigured() is false for newlines collapsed to ${label}, not a false "configured"`, () => {
        process.env.GITHUB_APP_PRIVATE_KEY = collapse(PEM)
        assert.equal(isGitHubConfigured(), false)
      })
    }
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

  test('mintAppJwt surfaces the getAppConfig PEM-shape error and never reaches Sign.sign (LIN-2081)', () => {
    // The original bug: a malformed key used to sail past getAppConfig and
    // blow up inside Sign.sign with OpenSSL's opaque ERR_OSSL_UNSUPPORTED /
    // "DECODER routines" decoder error, with no hint the key was the problem.
    // This pins that the config-time check now catches it first.
    process.env.GITHUB_APP_PRIVATE_KEY = PEM.replace(/\n$/, '') + '%'
    assert.throws(() => mintAppJwt(), (err) => {
      assert.match(err.message, /GitHub App auth: GITHUB_APP_PRIVATE_KEY ends with stray characters after the END line: '%'/)
      assert.doesNotMatch(err.message, /ERR_OSSL_UNSUPPORTED|DECODER routines|unsupported/i)
      return true
    })
  })

  test('buildInstallUrl surfaces the SAME getAppConfig PEM-shape error on a malformed key, even though it never signs anything with it (LIN-2081 review finding 5)', () => {
    // The review's own point: buildInstallUrl() calls getAppConfig() purely to
    // read `slug`, but getAppConfig() validates the FULL key shape
    // unconditionally — so a malformed key breaks the install-URL path too,
    // not just signing. Pin that it fails with the SAME named-defect config
    // error (never a raw OpenSSL error, since nothing here ever calls Sign.sign).
    process.env.GITHUB_APP_PRIVATE_KEY = PEM.replace(/\n$/, '') + '%'
    assert.throws(() => buildInstallUrl({ state: 'nonce-123' }), (err) => {
      assert.match(err.message, /GitHub App auth: GITHUB_APP_PRIVATE_KEY ends with stray characters after the END line: '%'/)
      assert.doesNotMatch(err.message, /ERR_OSSL_UNSUPPORTED|DECODER routines|unsupported/i)
      return true
    })
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
