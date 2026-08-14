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
import { AuthExchangeError } from '../interface.js'

const GITHUB_API_BASE = 'https://api.github.com'

// User-to-server OAuth endpoints (the App's OWN OAuth credentials, LIN-541) and
// the App installation picker base. Centralised here — the single GitHub App seam
// — so both the Issues and Projects providers build the SAME entry/exchange URLs
// rather than each duplicating the literals (LIN-735).
const GITHUB_OAUTH_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize'
const GITHUB_OAUTH_TOKEN_URL = 'https://github.com/login/oauth/access_token'
const GITHUB_APP_INSTALL_BASE = 'https://github.com/apps'

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

// The FULL env set the GitHub add/auth flow consumes end-to-end (LIN-761). The
// OAuth authorize begin (buildAuthorizeUrl) needs GITHUB_CLIENT_ID; the callback
// code exchange (exchangeOAuthCode) needs GITHUB_CLIENT_ID + GITHUB_CLIENT_SECRET;
// the install / installation-token mint (getAppConfig + buildInstallUrl) needs the
// three GITHUB_APP_* vars. GITHUB_REDIRECT_URI is deliberately NOT here — it is
// optional (GitHub falls back to the App's default callback URL when unset).
//
// This is the "what's unset" half of "GitHub configured" — accurate for the
// 503 page's "Missing environment variables: ..." message, which is why
// getMissingGitHubConfig() below keeps this narrower contract unchanged. It
// is NO LONGER the single definition the gates consume, though: since
// LIN-2081 finding 4, GITHUB_APP_PRIVATE_KEY can be PRESENT but not
// PEM-shaped, which blocks the flow exactly like a missing var does — so the
// route guards, the settings add affordance, and the landing hero all read
// the WIDER getGitHubConfigProblems() (below) instead, and it is THAT
// predicate whose promise can never drift from what /auth/github can
// actually deliver (LIN-761 root cause C). Shared by BOTH GitHub providers
// (Issues + Projects) since they share one App and one OAuth client id.
const GITHUB_REQUIRED_ENV = [
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
  'GITHUB_APP_ID',
  'GITHUB_APP_PRIVATE_KEY',
  'GITHUB_APP_SLUG',
]

/**
 * Which of the FULL GitHub config env vars are missing (LIN-761). NOT the
 * single config predicate on its own since LIN-2081 finding 4 — an empty
 * array here means every required var is SET, not that the flow can
 * complete (GITHUB_APP_PRIVATE_KEY can be present but not PEM-shaped). Use
 * getGitHubConfigProblems() for the flow-can-complete predicate; this one
 * stays narrow because its exact wording feeds the 503 page's "Missing
 * environment variables: ..." message.
 * @returns {string[]} the names of the unset required env vars (empty when all are set).
 */
export function getMissingGitHubConfig() {
  return GITHUB_REQUIRED_ENV.filter(v => !process.env[v])
}

// Minimum plausible length (chars) for a real PEM private key (LIN-2081) — a
// truncated/stubbed key is orders of magnitude shorter than this.
const PEM_MIN_LENGTH = 1000

// Base64 alphabet a PEM body line may contain (RFC 7468) — no PEM body line
// itself carries anything outside this set.
const PEM_ARMOR_LINE = /^[A-Za-z0-9+/=]*$/

/**
 * Normalize a raw GITHUB_APP_PRIVATE_KEY env value before shape validation
 * (LIN-2081): un-escape literal `\n` sequences (a multi-line PEM squeezed
 * onto one line), convert CRLF to LF, strip leading AND trailing tab/space
 * whitespace from every line, and collapse leading/trailing whitespace to at
 * most a single trailing newline — a CRLF round-trip (Windows/secret
 * manager), a stray leading blank line, an extra trailing blank line, a
 * trailing space after the END footer, an indented body (a YAML
 * block-scalar or heredoc indentation leak), and a body line with trailing
 * whitespace (the same leak, other end of the line) all sign fine in
 * OpenSSL and must not be rejected (review finding 2 + observation A +
 * round-3 finding — one "reject-what-signs" risk, one DECISION: this file's
 * whole point is to never hard-reject a key that actually works, so leading
 * and trailing per-line whitespace are normalized away symmetrically, not
 * as two separate special cases). Targeted regexes rather than a blanket
 * `.trim()` so a key with NO stray whitespace round-trips byte-for-byte.
 * Shared by getAppConfig() and getGitHubConfigProblems() so the two never
 * validate different bytes.
 * @param {string} privateKey
 * @returns {string} the normalized key
 */
function normalizePrivateKey(privateKey) {
  return privateKey
    .replace(/\\n/g, '\n')
    .replace(/\r\n/g, '\n')
    .replace(/^[ \t]+/gm, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/^\s+/, '')
    .replace(/\s+$/, '\n')
}

/**
 * Sanity-check a normalized PEM private key's *shape* (LIN-2081): armor
 * headers, plausible length, body alphabet. Three real-world misconfigurations
 * (a truncated stub, a shell-poisoned fragment, a stray character glued onto
 * the END line) all surfaced identically as OpenSSL's opaque
 * `ERR_OSSL_UNSUPPORTED` deep inside `Sign.sign` — this throws here instead,
 * naming the specific defect. Cheap and pure; runs on the ALREADY-normalized
 * key (`\n`-escapes unescaped) so it never fights that normalization.
 * @param {string} privateKey
 * @throws {Error} naming the specific PEM defect found
 */
function assertPemShape(privateKey) {
  if (!privateKey.startsWith('-----BEGIN')) {
    const beginAt = privateKey.indexOf('-----BEGIN')
    if (beginAt > 0) {
      throw new Error(`GitHub App auth: GITHUB_APP_PRIVATE_KEY has ${beginAt} unexpected character(s) before the '-----BEGIN' header`)
    }
    throw new Error("GitHub App auth: GITHUB_APP_PRIVATE_KEY does not start with a PEM '-----BEGIN' header")
  }

  const endMatch = privateKey.match(/-----END [A-Z0-9 ]*KEY-----/)
  if (!endMatch) {
    throw new Error("GitHub App auth: GITHUB_APP_PRIVATE_KEY is missing its '-----END ... KEY-----' footer")
  }
  const trailing = privateKey.slice(endMatch.index + endMatch[0].length)
  if (trailing !== '' && trailing !== '\n') {
    throw new Error(`GitHub App auth: GITHUB_APP_PRIVATE_KEY ends with stray characters after the END line: '${trailing}'`)
  }

  if (privateKey.length < PEM_MIN_LENGTH) {
    throw new Error(`GitHub App auth: GITHUB_APP_PRIVATE_KEY is too short to be a real PEM key (${privateKey.length} chars, expected 1000+)`)
  }

  const headerEnd = privateKey.indexOf('\n')
  if (headerEnd === -1 || headerEnd > endMatch.index) {
    // A PEM whose line breaks were collapsed entirely, or collapsed to some
    // OTHER whitespace (e.g. spaces from an unquoted `export KEY=$KEY`, or a
    // bare `\r`), has no line break BETWEEN the BEGIN and END armor. The
    // second case still passes `headerEnd !== -1` because
    // normalizePrivateKey's `.replace(/\s+$/, '\n')` puts a newline back —
    // but only after the END footer, so `headerEnd` lands past
    // `endMatch.index`. Either way the body slice below would be empty and
    // the alphabet check would pass vacuously, letting the exact bug this
    // ticket exists to fix sail through to Sign.sign's opaque
    // ERR_OSSL_UNSUPPORTED. Reject both explicitly here.
    throw new Error("GitHub App auth: GITHUB_APP_PRIVATE_KEY has no line breaks between the '-----BEGIN'/'-----END' armor — the key body must sit on its own line(s) (were newlines stripped or collapsed to spaces?)")
  }
  const body = privateKey.slice(headerEnd + 1, endMatch.index)
  const bodyLines = body.split('\n')
  if (bodyLines.every(line => line === '')) {
    // Defense in depth for the CLASS, not just the two instances above: `body`
    // is inferred positionally by slicing between two indices, so any future
    // input that makes those indices degenerate would otherwise yield '' and
    // pass the alphabet check on `['']` vacuously (`[''].every(ok)` is
    // trivially true). A real PEM always has at least one non-empty base64
    // body line between its armor lines, so reject the empty case by name.
    throw new Error('GitHub App auth: GITHUB_APP_PRIVATE_KEY has no key material between the \'-----BEGIN\'/\'-----END\' armor lines')
  }
  const badLineIndex = bodyLines.findIndex(line => !PEM_ARMOR_LINE.test(line))
  if (badLineIndex !== -1) {
    // Report the offending character(s) and their column, never the line
    // itself (review finding, round 4) — bodyLines[badLineIndex] is a real
    // slice of the configured key, and echoing it leaked 64 chars of key
    // material into application logs (routes/github-auth.js, LIN-2081
    // ledger item 2). Same precedent as the pre-BEGIN branch above, which
    // reports a count rather than content. This is safe by construction:
    // only characters OUTSIDE the base64 alphabet are ever named, so a
    // reported character can never itself be a byte of the key.
    const badChars = [...bodyLines[badLineIndex]]
      .map((ch, col) => ({ ch, col: col + 1 }))
      .filter(({ ch }) => !PEM_ARMOR_LINE.test(ch))
      .map(({ ch, col }) => `'${ch}' at column ${col}`)
      .join(', ')
    throw new Error(`GitHub App auth: GITHUB_APP_PRIVATE_KEY contains invalid characters outside the PEM alphabet on line ${badLineIndex + 2}: ${badChars}`)
  }
}

/**
 * Configuration problems blocking the GitHub add/auth flow (LIN-761 origin;
 * widened LIN-2081 review finding 4). `getMissingGitHubConfig()` alone
 * answers "what's unset" — accurate for the 503 page's "Missing environment
 * variables: ..." message, so it keeps that narrower contract unchanged.
 * This is the WIDER predicate: a GITHUB_APP_PRIVATE_KEY that is PRESENT but
 * not PEM-shaped blocks the flow exactly like a missing one does —
 * getAppConfig() rejects it unconditionally, including on the install-URL
 * path that never signs with it (LIN-2081's own review finding) — so
 * reporting "configured" for it would reintroduce the drift LIN-761 closed
 * (root cause C: the UI promising a flow that cannot complete). The shape
 * check only runs when the var is present (an unset key already reports via
 * the missing-var branch) and reuses assertPemShape's existing cheap
 * regex/length checks — no I/O, no new cost class.
 * @returns {string[]} problem descriptions — getMissingGitHubConfig()'s
 *   unset var names, or (mutually exclusive with those) a one-item array
 *   describing a shape-invalid GITHUB_APP_PRIVATE_KEY. Empty when the flow
 *   can complete.
 */
export function getGitHubConfigProblems() {
  const missing = getMissingGitHubConfig()
  if (missing.length > 0) return missing
  try {
    assertPemShape(normalizePrivateKey(process.env.GITHUB_APP_PRIVATE_KEY))
    return []
  } catch {
    return ['GITHUB_APP_PRIVATE_KEY is set but is not a valid PEM key']
  }
}

/**
 * Whether the GitHub add/auth flow is fully configured on this server
 * (LIN-761; PEM-shape-aware since LIN-2081 finding 4). Consumed by the route
 * guards, the settings add affordance, and the landing hero, so the UI's
 * promise can never drift from what the flow can actually deliver.
 * @returns {boolean} true when the flow can be started and completed.
 */
export function isGitHubConfigured() {
  return getGitHubConfigProblems().length === 0
}

/**
 * Read the GitHub App env config. The single seam for GITHUB_APP_* — downstream
 * surfaces (LIN-708 install URL, LIN-709 callback) consume this rather than
 * re-reading process.env.
 *
 * @returns {{ appId: string, privateKey: string, slug: string|undefined }}
 *   `appId` and `privateKey` are required (clear throw if missing) and
 *   `privateKey` must be PEM-shaped after normalization (LIN-2081; clear
 *   throw naming the defect otherwise). `slug` is install-URL config
 *   (LIN-708/709) and is NOT required by the minting functions, so it is
 *   returned as-is (possibly undefined).
 */
export function getAppConfig() {
  const appId = process.env.GITHUB_APP_ID
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY
  const slug = process.env.GITHUB_APP_SLUG

  if (!appId) throw new Error('GitHub App auth: GITHUB_APP_ID is not configured')
  if (!privateKey) throw new Error('GitHub App auth: GITHUB_APP_PRIVATE_KEY is not configured')

  const normalizedKey = normalizePrivateKey(privateKey)
  assertPemShape(normalizedKey)

  return { appId, privateKey: normalizedKey, slug }
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

/**
 * Look up an installation's metadata (GET /app/installations/{id}) with the App
 * JWT. The 200 payload carries `account` — the user/org the App is installed on
 * — which is the identity the callback (LIN-709) builds/selects the workspace
 * container from, replacing the OAuth `/user` viewer the old code→token flow
 * used (an installation token cannot read `/user`, so identity comes from the
 * installation itself). App-JWT-authed like {@link mintInstallationToken}, so it
 * lives here in the App config seam rather than on the per-installation client.
 *
 * @param {string|number} installationId - the GitHub installation id.
 * @param {{ fetchImpl?: Function, now?: number }} [opts] - `fetchImpl` is the
 *   injectable network seam (defaults to global fetch); `now` flows through to
 *   the App JWT for deterministic tests.
 * @returns {Promise<object>} the installation payload. `account` (`{ id, login,
 *   … }`) is the field downstream identity reads; the rest is preserved as-is.
 */
export async function fetchInstallation(installationId, { fetchImpl, now } = {}) {
  if (installationId === undefined || installationId === null || installationId === '') {
    throw new Error('GitHub App auth: installationId is required to fetch an installation')
  }
  const doFetch = fetchImpl || globalThis.fetch
  if (!doFetch) throw new Error('fetchInstallation: no fetch implementation available')

  const appJwt = mintAppJwt({ now })
  const url = `${GITHUB_API_BASE}/app/installations/${encodeURIComponent(installationId)}`
  const res = await doFetch(url, {
    method: 'GET',
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
    const err = new Error(`GitHub App auth: installation lookup failed: ${message}`)
    err.status = res.status
    throw err
  }
  return data
}

/**
 * Build the user-to-server OAuth **authorize** URL — the re-bind / already-installed
 * entry path (LIN-735). This replaces `installations/new` as the begin URL: an
 * already-installed App returns nothing useful from `installations/new` (GitHub
 * shows its configure page and never round-trips a `code`), whereas the authorize
 * URL ALWAYS round-trips an OAuth `code` whether or not the App is installed, so
 * the callback can exchange it, enumerate the user's installations, and re-pick a
 * binding target. When the user turns out to have NO installations, the callback
 * falls through to {@link buildInstallUrl} to install first.
 *
 * NO `scope` param is sent — a GitHub App's permissions declare access, so adding
 * `repo` would resurrect the all-or-nothing over-grant the App migration removed
 * (security M1, LIN-683 / LIN-708). The App identifies itself by its OAuth
 * `client_id` (GITHUB_CLIENT_ID, the App's own client id), and `state` passes
 * through unchanged as an opaque CSRF nonce minted by the route (LIN-562).
 *
 * @param {{ state: string, redirectUri?: string }} args - `redirectUri` is the
 *   per-flow callback (Issues vs Projects use different callback paths); omitted
 *   when unset so GitHub falls back to the App's default callback URL.
 * @returns {string} the `login/oauth/authorize?client_id=…&state=…` URL.
 * @throws {Error} if GITHUB_CLIENT_ID is unset (would emit a broken authorize URL).
 */
export function buildAuthorizeUrl({ state, redirectUri } = {}) {
  const clientId = process.env.GITHUB_CLIENT_ID
  if (!clientId) {
    throw new Error('GitHub App auth: GITHUB_CLIENT_ID is not configured; cannot build the OAuth authorize URL')
  }
  const params = new URLSearchParams({ client_id: clientId, state })
  if (redirectUri) params.set('redirect_uri', redirectUri)
  return `${GITHUB_OAUTH_AUTHORIZE_URL}?${params}`
}

/**
 * Build the GitHub App installation URL (`apps/<slug>/installations/new`). This is
 * the FRESH-install entry and the callback fallback when an authorize round-trip
 * finds the user has no installations yet (LIN-735) — it is no longer the begin
 * URL itself. `state` passes through unchanged as an opaque CSRF nonce.
 *
 * @param {{ state: string }} args
 * @returns {string} the `apps/<slug>/installations/new?state=<nonce>` URL.
 * @throws {Error} if GITHUB_APP_SLUG is unset (avoids a broken `apps/undefined` URL).
 */
export function buildInstallUrl({ state } = {}) {
  const { slug } = getAppConfig()
  if (!slug) {
    throw new Error('GitHub App auth: GITHUB_APP_SLUG is not configured; cannot build the App installation URL')
  }
  const params = new URLSearchParams({ state })
  return `${GITHUB_APP_INSTALL_BASE}/${encodeURIComponent(slug)}/installations/new?${params}`
}

/**
 * Exchange a user-to-server OAuth `code` for a DISCOVERY token (the re-bind path,
 * LIN-728/LIN-735). GitHub returns HTTP 200 with an `{ error }` body on a bad
 * code, so a 200 is not enough — an error payload or a missing `access_token`
 * raises {@link AuthExchangeError} so the route renders a clean auth-failure page,
 * not a 500. The token is for DISCOVERY ONLY (enumerate installations + targets);
 * the binding still mints/persists an installation token at link time.
 *
 * Shared by both GitHub providers (the App + its OAuth credentials are App-level),
 * which is why it lives in this seam rather than being duplicated per provider.
 *
 * @param {string} code - the authorization code from the OAuth redirect.
 * @param {{ providerName?: string, redirectUri?: string, fetchImpl?: Function }} [opts]
 *   `providerName` tags the thrown error; `redirectUri` must match the authorize
 *   `redirect_uri`; `fetchImpl` is the injectable network seam (defaults to global fetch).
 * @returns {Promise<{access_token: string}>} normalized token bag.
 */
export async function exchangeOAuthCode(code, { providerName = 'github', redirectUri, fetchImpl } = {}) {
  const doFetch = fetchImpl || globalThis.fetch
  if (!doFetch) throw new Error('exchangeOAuthCode: no fetch implementation available')

  const params = new URLSearchParams({
    client_id: process.env.GITHUB_CLIENT_ID,
    client_secret: process.env.GITHUB_CLIENT_SECRET,
    code,
  })
  const resolvedRedirectUri = redirectUri || process.env.GITHUB_REDIRECT_URI
  if (resolvedRedirectUri) params.set('redirect_uri', resolvedRedirectUri)

  const response = await doFetch(GITHUB_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: params,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || data.error || !data.access_token) {
    throw new AuthExchangeError(data.error || `HTTP ${response.status}`, providerName)
  }
  return { access_token: data.access_token }
}

// Budget for the ROUTE-level GET /user viewer lookup added by LIN-1329 (identity
// scope = the human's GitHub user id, not a resource address). This callback
// path (routes/github-auth.js, routes/github-projects-auth.js) has a history of
// timeout bugs (LIN-761 was literally "fix GitHub add timeout"), so the lookup
// must fail fast rather than hang the whole sign-in.
export const GITHUB_VIEWER_TIMEOUT_MS = 8000;

/**
 * Race an arbitrary promise against a timeout, rejecting with a clearly-labeled
 * error if the promise hasn't settled in time. Generic (not GitHub-specific) but
 * lives here because its one caller today is the GET /user viewer lookup both
 * GitHub auth routers add via `provider.fetchViewer()`.
 * @param {Promise} promise
 * @param {number} ms
 * @param {string} [label]
 * @returns {Promise}
 */
export function withTimeout(promise, ms, label = 'operation') {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`${label} timed out after ${ms}ms`);
      err.code = 'ETIMEDOUT';
      reject(err);
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * List the App installations the authenticated user administers (GET
 * /user/installations) with a user-to-server token — the re-bind enumeration for
 * the already-installed case (LIN-735). App-level and shared: the Issues provider
 * pairs this with per-installation repos via its REST client, while the Projects
 * provider (GraphQL-only, no REST client) reads it through this seam to discover
 * each installation's account before listing that account's boards. The endpoint
 * wraps its result in a `{ total_count, installations: [...] }` envelope, so unwrap
 * `installations` and return a bare array. The user token is DISCOVERY-only.
 *
 * @param {string} userToken - the user-to-server OAuth token from exchangeOAuthCode.
 * @param {{ fetchImpl?: Function }} [opts] - injectable network seam.
 * @returns {Promise<Array<{id: string|number, account: object|null}>>}
 */
export async function listUserInstallations(userToken, { fetchImpl } = {}) {
  const doFetch = fetchImpl || globalThis.fetch
  if (!doFetch) throw new Error('listUserInstallations: no fetch implementation available')

  const res = await doFetch(`${GITHUB_API_BASE}/user/installations?per_page=100`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${userToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) {
    const message = data?.message || res.statusText || `HTTP ${res.status}`
    const err = new Error(`GitHub App auth: user-installations lookup failed: ${message}`)
    err.status = res.status
    throw err
  }
  return data?.installations || []
}
