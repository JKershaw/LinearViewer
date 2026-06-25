// =============================================================================
// GitHub App auth primitives (LIN-707) — the ROOT credential seam for the
// GitHub App migration (LIN-703: OAuth App → GitHub App, per-repo Issues-only).
// =============================================================================
//
// Surface 1 of 8. This module owns the *primitives*; the sibling surfaces own
// the *wiring* (install URL → LIN-708, callback mint → LIN-709, binding expiry →
// LIN-711, per-request client threading → LIN-713, refresh/re-mint → LIN-712).
//
// Two credentials, two functions:
//   * mintAppJwt()             — a short-lived (~10 min) App-level JWT, signed
//                                with the App's private key. Identifies the App
//                                itself; used only to mint installation tokens.
//   * mintInstallationToken()  — exchanges the App JWT for an installation
//                                access token (~1 h) scoped to one installation.
//                                This is the token the REST client actually uses.
//
// Design constraints (LIN-707):
//   * NO JWT dependency — RS256 is signed with Node's built-in `crypto`
//     (`createSign('RSA-SHA256')`). package.json carries no jsonwebtoken and none
//     is to be added.
//   * Fully offline-testable — `mintInstallationToken` takes an injectable
//     `fetchImpl` (mirroring client.js's seam) so tests stub the network rather
//     than bloating the repo-scoped fake-client.js.
//   * Single config seam — `getAppConfig()` is the one reader of GITHUB_APP_*,
//     consumed downstream by LIN-708/709 so env parsing isn't duplicated.

import crypto from 'node:crypto'

const GITHUB_API_BASE = 'https://api.github.com'

// App JWT lifetime. GitHub caps App JWTs at 10 minutes; we backdate `iat` by 60s
// to tolerate clock drift between us and GitHub (per GitHub's own guidance), so
// the effective forward window is ~9 minutes.
const JWT_CLOCK_DRIFT_S = 60
const JWT_LIFETIME_S = 600

// base64url with no padding — the JWT wire encoding (RFC 7515 §2).
function base64url(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input)
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Read the GitHub App env config. The single seam for GITHUB_APP_* — downstream
 * surfaces (LIN-708 install URL, LIN-709 callback) consume this rather than
 * re-reading process.env.
 *
 * @returns {{ appId: string, privateKey: string, slug: string|undefined }}
 *   `appId` and `privateKey` are required (clear throw if missing). `slug` is
 *   install-URL config (LIN-708/709) and is NOT required by the minting
 *   functions, so it is returned as-is (possibly undefined).
 */
export function getAppConfig() {
  const appId = process.env.GITHUB_APP_ID
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY
  const slug = process.env.GITHUB_APP_SLUG

  if (!appId) throw new Error('GitHub App auth: GITHUB_APP_ID is not configured')
  if (!privateKey) throw new Error('GitHub App auth: GITHUB_APP_PRIVATE_KEY is not configured')

  // Allow `\n`-escaped PEMs (common when a multi-line key is squeezed into a
  // single-line env var) by normalizing them back to real newlines.
  return { appId, privateKey: privateKey.replace(/\\n/g, '\n'), slug }
}

/**
 * Mint a short-lived GitHub App JWT (RS256), signed with the App private key.
 * This is the App's own credential — it authenticates the App to GitHub and is
 * used only to mint installation tokens, never to call the Issues API directly.
 *
 * @param {{ now?: number }} [opts] - `now` (epoch ms) is injectable for
 *   deterministic tests; defaults to the current time.
 * @returns {string} a signed `header.payload.signature` JWT.
 */
export function mintAppJwt({ now = Date.now() } = {}) {
  const { appId, privateKey } = getAppConfig()

  const iat = Math.floor(now / 1000) - JWT_CLOCK_DRIFT_S
  const header = { alg: 'RS256', typ: 'JWT' }
  const payload = { iat, exp: iat + JWT_LIFETIME_S, iss: appId }

  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`
  const signature = crypto.createSign('RSA-SHA256').update(signingInput).sign(privateKey)
  return `${signingInput}.${base64url(signature)}`
}

/**
 * Exchange the App JWT for an installation access token. POSTs to
 * `/app/installations/{id}/access_tokens`; the 201 payload carries the
 * `{ token, expires_at }` the REST client and binding (LIN-711) need.
 *
 * @param {string|number} installationId - the GitHub installation id.
 * @param {{ fetchImpl?: Function, now?: number }} [opts] - `fetchImpl` is the
 *   injectable network seam (defaults to global fetch); `now` flows through to
 *   the App JWT for deterministic tests.
 * @returns {Promise<object>} the full GitHub response payload. `{ token,
 *   expires_at }` are the guaranteed fields; `permissions`/`repositories` may
 *   also be present and are preserved for future surfaces.
 */
export async function mintInstallationToken(installationId, { fetchImpl, now } = {}) {
  if (installationId === undefined || installationId === null || installationId === '') {
    throw new Error('GitHub App auth: installationId is required to mint an installation token')
  }
  const doFetch = fetchImpl || globalThis.fetch
  if (!doFetch) throw new Error('mintInstallationToken: no fetch implementation available')

  const appJwt = mintAppJwt({ now })
  const url = `${GITHUB_API_BASE}/app/installations/${encodeURIComponent(installationId)}/access_tokens`
  const res = await doFetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${appJwt}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })

  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) {
    const message = data?.message || res.statusText || `HTTP ${res.status}`
    const err = new Error(`GitHub App auth: installation-token request failed: ${message}`)
    err.status = res.status
    throw err
  }
  return data
}
