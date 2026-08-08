/**
 * Jira Cloud OAuth 2.0 (3LO) — the auth-shape half of LIN-1887 (Phase 3 of
 * LIN-275).
 *
 * Phase 1 (LIN-1885) linked Jira with a static API token and Basic auth, which
 * deliberately routed AROUND the credential-refresh contract. This module is the
 * other shape: an authorization-code round-trip against `auth.atlassian.com`,
 * whose access token is short-lived and whose ROTATING refresh token lives in the
 * durable owner-credential store (never the session — LIN-1524).
 *
 * ## The two hosts are not interchangeable
 *
 * - `https://auth.atlassian.com` — authorize + token endpoints ONLY.
 * - `https://api.atlassian.com` — the API gateway: `/oauth/token/accessible-resources`
 *   (which sites this grant can reach) and `/ex/jira/{cloudId}/rest/api/3/...`
 *   (the Jira REST surface, addressed by cloudId rather than tenant hostname).
 *
 * Neither is the tenant URL. `normalizeJiraSite` (`routes/jira-auth.js`) — the
 * Phase 1 SSRF guard — validates the human-facing `https://<tenant>.atlassian.net`
 * base and is deliberately NOT applied to either host here: its
 * `.atlassian.net`-only rule would reject both. The OAuth API base gets its own,
 * stricter guard instead (see {@link jiraOAuthApiBase}) — a hard-coded host, an
 * encoded cloudId, and an assertion on the parsed hostname. That matters because
 * the client's own https check (`client.js`) is a bare `^https://` prefix test:
 * on the Basic path `normalizeJiraSite` is the real allowlist upstream, so
 * removing it on the OAuth path would leave no allowlist at all.
 *
 * ## Runtime contract: doc-derived, unobserved (D3)
 *
 * No live Atlassian app exists yet, so every claim here about Atlassian's
 * RUNTIME behaviour — the consent round-trip, the token response shape and real
 * `expires_in`, that refresh tokens rotate as documented, the
 * `accessible-resources` payload, and that `/ex/jira/{cloudId}` accepts a Bearer
 * token identically to the tenant REST base — is taken from Atlassian's
 * documentation and is NOT runtime-verified. Everything in this module is
 * unit-tested against injected fetches; none of it is proven.
 */
import { TokenRefreshError, TOKEN_REFRESH_TIMEOUT_MS } from '../../token-refresh.js';

/** Authorize + token endpoints. Never the API gateway. */
export const JIRA_AUTH_HOST = 'https://auth.atlassian.com';
/** The API gateway host — hard-coded, and asserted on every base we build. */
export const JIRA_API_HOST = 'api.atlassian.com';
const JIRA_API_ORIGIN = `https://${JIRA_API_HOST}`;

/**
 * The requested scope set (D2 — John's decision, read-only for this phase).
 *
 * `offline_access` is what makes a refresh token issued at all; without it the
 * whole `oauth-refresh` strategy has nothing to refresh from. The Jira scopes are
 * read-only: LIN-1886 adds writes and `write:jira-work` cannot be added silently,
 * because every already-consented user gets a fresh consent prompt.
 *
 * Deliberately does NOT include `read:me`. The plan's Step 4 proposed resolving
 * identity via `GET https://api.atlassian.com/me`, which requires that scope —
 * but D2 fixed the scope set at these three, and widening a consent screen is
 * exactly the one-way door D2 exists to protect. Identity is instead resolved
 * through `GET /rest/api/3/myself` on the chosen site, covered by
 * `read:jira-user`. That is the SAME endpoint and the SAME `accountId` Phase 1
 * already keys identity on (`routes/jira-auth.js`), which is load-bearing beyond
 * scope economy: a human upgrading a Basic link to OAuth must resolve to the
 * same Harbour account, and two identity endpoints could drift.
 */
export const JIRA_OAUTH_SCOPES = ['read:jira-work', 'read:jira-user', 'offline_access'];

/**
 * The full config env this flow needs (LIN-1887 F3.2), mirroring
 * `lib/providers/github/app-auth.js`'s `GITHUB_REQUIRED_ENV`.
 *
 * `JIRA_REDIRECT_URI` is required, unlike GitHub's optional one: Atlassian has no
 * "the app's default callback" fallback — the `redirect_uri` must be sent on both
 * the authorize and the token call and must match the registered value exactly.
 */
const JIRA_REQUIRED_ENV = [
  'JIRA_CLIENT_ID',
  'JIRA_CLIENT_SECRET',
  'JIRA_REDIRECT_URI',
];

/**
 * Which of the required Jira OAuth env vars are missing. The SINGLE config
 * predicate, provider-owned, consumed by every gate that promises or begins the
 * flow — the route guard, the Settings add affordance, and (LIN-1890) the
 * landing CTA — so the UI's promise can never drift from what `/auth/jira/oauth`
 * can actually deliver. Never an inline `process.env` read at a call site; that
 * is the divergence already flagged at `public/navbar.js`.
 *
 * @returns {string[]} names of the unset required env vars (empty when configured)
 */
export function getMissingJiraOAuthConfig() {
  return JIRA_REQUIRED_ENV.filter(v => !process.env[v]);
}

/**
 * Whether the Jira OAuth flow is fully configured on this server.
 * @returns {boolean}
 */
export function isJiraOAuthConfigured() {
  return getMissingJiraOAuthConfig().length === 0;
}

/**
 * The Jira REST base for an OAuth grant: `https://api.atlassian.com/ex/jira/{cloudId}`.
 *
 * Three guards, all of which matter because `cloudId` is data that arrives over
 * the network and is then concatenated into a fetch base (LIN-1887 F6):
 *   1. the host is a hard-coded constant, never derived from input;
 *   2. `cloudId` is `encodeURIComponent`-escaped, so `../` or a `?`/`#` cannot
 *      re-shape the path or push the client's fixed `/rest/api/3/...` suffix into
 *      a query string;
 *   3. the assembled base is re-parsed and its `hostname` asserted, so any future
 *      edit that reintroduces interpolation into the host fails loudly here
 *      rather than silently becoming an SSRF sink.
 *
 * @param {string} cloudId
 * @returns {string} the validated base URL, with no trailing slash
 */
export function jiraOAuthApiBase(cloudId) {
  if (!cloudId) throw new Error('jiraOAuthApiBase: cloudId is required');
  const base = `${JIRA_API_ORIGIN}/ex/jira/${encodeURIComponent(String(cloudId))}`;
  const parsed = new URL(base);
  if (parsed.hostname !== JIRA_API_HOST) {
    throw new Error(`jiraOAuthApiBase: refusing a base outside ${JIRA_API_HOST}: ${base}`);
  }
  return base;
}

/**
 * The consent URL the user is redirected to. `state` is an opaque CSRF nonce and
 * carries NO intent — intent rides in `req.session.oauthIntent`, the LIN-562
 * convention every other router follows.
 *
 * @param {{state: string, prompt?: string}} options
 * @returns {string}
 */
export function buildJiraAuthorizeUrl({ state, prompt = 'consent' } = {}) {
  const missing = getMissingJiraOAuthConfig();
  if (missing.length) {
    throw new Error(`Jira OAuth is not configured. Missing: ${missing.join(', ')}`);
  }
  const url = new URL(`${JIRA_AUTH_HOST}/authorize`);
  url.searchParams.set('audience', JIRA_API_HOST);
  url.searchParams.set('client_id', process.env.JIRA_CLIENT_ID);
  url.searchParams.set('scope', JIRA_OAUTH_SCOPES.join(' '));
  url.searchParams.set('redirect_uri', process.env.JIRA_REDIRECT_URI);
  url.searchParams.set('state', state);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('prompt', prompt);
  return url.toString();
}

/**
 * POST the token endpoint. Shared by the code exchange and the refresh so the
 * error taxonomy is identical for both — in particular, `invalid_grant` →
 * `TokenRefreshError('EXPIRED')`, which is the ONLY code
 * `isDefinitiveRevocation` (`lib/token-refresh.js`) treats as a real revocation
 * and therefore the only one that may delete a durable credential.
 */
async function postJiraToken(body, { fetchImpl = fetch } = {}) {
  const missing = getMissingJiraOAuthConfig();
  if (missing.length) {
    throw new TokenRefreshError(`Missing Jira OAuth configuration: ${missing.join(', ')}`, 'INVALID');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TOKEN_REFRESH_TIMEOUT_MS);
  let response;
  let data;
  try {
    response = await fetchImpl(`${JIRA_AUTH_HOST}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: process.env.JIRA_CLIENT_ID,
        client_secret: process.env.JIRA_CLIENT_SECRET,
        ...body,
      }),
      signal: controller.signal,
    });
    data = await response.json().catch(() => ({}));
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new TokenRefreshError(`Jira token request timed out after ${TOKEN_REFRESH_TIMEOUT_MS}ms`, 'NETWORK');
    }
    throw new TokenRefreshError(`Jira token request failed: ${err.message}`, 'NETWORK');
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    if (data.error === 'invalid_grant') {
      throw new TokenRefreshError('Jira refresh token expired or invalid', 'EXPIRED');
    }
    throw new TokenRefreshError(`Jira token request failed: ${data.error || response.status}`, 'INVALID');
  }
  return data;
}

/**
 * Exchange an authorization code for the initial token bag.
 * @returns {Promise<{access_token: string, refresh_token: string|undefined, expires_in: number}>}
 */
export async function exchangeJiraCode(code, { fetchImpl = fetch } = {}) {
  if (!code) throw new TokenRefreshError('Missing Jira authorization code', 'INVALID');
  const data = await postJiraToken({
    grant_type: 'authorization_code',
    code,
    redirect_uri: process.env.JIRA_REDIRECT_URI,
  }, { fetchImpl });

  if (!data.access_token || !data.expires_in) {
    throw new TokenRefreshError('Invalid Jira token response: missing required fields', 'INVALID');
  }
  return data;
}

/**
 * Spend a rotating Jira refresh token for a fresh bag — the `oauth-refresh`
 * strategy's exchange, injected into `refreshOwnerCredential`.
 *
 * Signature is `(refreshToken) => {access_token, refresh_token, expires_in}` so
 * it is substitutable with Linear's `refreshAccessToken` at that seam. Atlassian
 * documents rotating refresh tokens, so a response WITHOUT `refresh_token` is
 * rejected rather than silently persisted as `undefined` — that would wipe the
 * durable credential's only renewable half and turn the next refresh into an
 * unrecoverable "nothing to refresh".
 */
export async function refreshJiraAccessToken(refreshToken, { fetchImpl = fetch } = {}) {
  if (!refreshToken || typeof refreshToken !== 'string') {
    throw new TokenRefreshError('Invalid Jira refresh token', 'INVALID');
  }
  const data = await postJiraToken({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  }, { fetchImpl });

  if (!data.access_token || !data.refresh_token || !data.expires_in) {
    throw new TokenRefreshError('Invalid Jira token response: missing required fields', 'INVALID');
  }
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_in: data.expires_in,
  };
}

/**
 * Which Jira sites this grant can reach. Returns `[{cloudId, url, name}]`, the
 * shape the site picker renders and `jiraPending.sites` carries.
 *
 * `url` is the human-facing tenant URL and becomes the binding's `scope` (so the
 * existing `${site}/browse/${key}` deep links keep working). `cloudId` is what
 * every API call is actually addressed by.
 */
export async function fetchJiraAccessibleResources(accessToken, { fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`${JIRA_API_ORIGIN}/oauth/token/accessible-resources`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(TOKEN_REFRESH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`Jira accessible-resources lookup failed: ${res.status}`);
  }
  const sites = await res.json();
  if (!Array.isArray(sites)) {
    throw new Error('Jira accessible-resources returned an unexpected payload');
  }
  return sites
    .filter(s => s && s.id && s.url)
    .map(s => ({ cloudId: String(s.id), url: String(s.url), name: String(s.name || s.url) }));
}
