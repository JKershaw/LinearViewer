// =============================================================================
// Jira Cloud REST v3 client (LIN-1885, Phase 1 of LIN-275) — the HTTP boundary
// the provider reads through.
// =============================================================================
//
// A thin wrapper over the Jira Cloud REST API (`https://<site>.atlassian.net`).
// Mirrors the github/client.js split — this file owns auth, URL/wire handling,
// pagination, and rate-limit retry; canonical mapping stays in index.js.
//
// Auth is **API-token Basic auth** (`email:apiToken`, base64), not OAuth — the
// Phase 1 credential shape. `site` is the tenant's full base URL
// (`https://<tenant>.atlassian.net`); `fetchImpl` is injectable (proxy-aware
// fetch / test stub), defaulting to global fetch.
//
// --- Rate limiting (LIN-1885 research, binding constraint) -------------------
// API-token traffic is NOT points-based-rate-limit-exempt (that shorthand was
// refuted) but it IS still governed by Jira's per-tenant, per-endpoint BURST
// limit — a bucket shared across every integration on the customer's site, so
// Harbour can be 429'd by an unrelated script regardless of its own request
// volume. Handling is therefore load-bearing, not defensive-nice-to-have:
//   1. `Retry-After` (seconds) is authoritative when present.
//   2. Exponential backoff with jitter (base 2s, doubling, factor 0.7-1.3) only
//      when the header is absent.
//   3. Bounded at MAX_429_RETRIES attempts, then throws a status-carrying error
//      — never an unbounded retry loop.
//   4. Every thrown error carries `err.status = res.status` (mirrors
//      github/client.js:45-46) so `classifyUpstreamError` (lib/errors.js) can
//      route a 429 to `upstream`/retryable and a 401/403 to `auth` — the 429
//      must never be misread as an auth failure by `isAuthError`.
// Pagination is SERIAL (one page at a time, never concurrent) — a parallel page
// walk is exactly the "one bad script" pattern the shared bucket punishes.

const DEFAULT_MAX_RESULTS = 50
const MAX_429_RETRIES = 4
const BASE_BACKOFF_MS = 2000
const JITTER_MIN = 0.7
const JITTER_MAX = 1.3

function realSleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * @param {{ email?: string, apiToken?: string, site?: string, fetchImpl?: Function, sleepImpl?: Function, randomImpl?: Function }} [opts]
 *   email/apiToken — Basic-auth credential pair.
 *   site           — tenant base URL, e.g. `https://mycompany.atlassian.net`.
 *   fetchImpl      — injectable fetch (proxy-aware fetch in production, a stub in tests).
 *   sleepImpl      — injectable delay function (tests inject a no-op/fast stub).
 *   randomImpl     — injectable jitter source (tests can pin it for determinism).
 * @returns {object} a client with the high-level methods the provider calls.
 */
export function createJiraClient({ email, apiToken, site, fetchImpl, sleepImpl, randomImpl } = {}) {
  const doFetch = fetchImpl || globalThis.fetch
  if (!doFetch) throw new Error('createJiraClient: no fetch implementation available')
  const sleep = sleepImpl || realSleep
  const random = randomImpl || Math.random
  const baseUrl = String(site || '').replace(/\/+$/, '')

  function authHeader() {
    if (!email || !apiToken) return null
    const encoded = Buffer.from(`${email}:${apiToken}`, 'utf8').toString('base64')
    return `Basic ${encoded}`
  }

  /** Seconds/HTTP-date `Retry-After` → a delay in ms, or null if absent/invalid. */
  function retryAfterMs(res) {
    const header = res.headers?.get?.('Retry-After')
    if (!header) return null
    const asSeconds = Number(header)
    if (Number.isFinite(asSeconds)) return Math.max(0, asSeconds * 1000)
    const asDate = Date.parse(header)
    if (Number.isFinite(asDate)) return Math.max(0, asDate - Date.now())
    return null
  }

  function backoffMs(attempt) {
    const doubled = BASE_BACKOFF_MS * 2 ** (attempt - 1)
    const jitter = JITTER_MIN + random() * (JITTER_MAX - JITTER_MIN)
    return Math.round(doubled * jitter)
  }

  /**
   * One HTTP round-trip, honoring bounded 429 retry. `query` is a plain object
   * of query-string params (undefined values dropped); `body`, when present, is
   * sent as JSON.
   */
  async function request(method, path, { query, body } = {}) {
    const url = new URL(`${baseUrl}${path}`)
    for (const [key, value] of Object.entries(query || {})) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value))
    }

    const headers = { Accept: 'application/json' }
    const auth = authHeader()
    if (auth) headers.Authorization = auth
    if (body !== undefined) headers['Content-Type'] = 'application/json'

    let attempt = 0
    for (;;) {
      const res = await doFetch(url.toString(), {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      })

      if (res.status === 429) {
        attempt += 1
        if (attempt > MAX_429_RETRIES) {
          const err = new Error(`Jira API ${method} ${path} failed: rate-limited after ${MAX_429_RETRIES} retries`)
          err.status = 429
          err.rateLimitReason = res.headers?.get?.('RateLimit-Reason') || null
          throw err
        }
        const headerDelay = retryAfterMs(res)
        await sleep(headerDelay != null ? headerDelay : backoffMs(attempt))
        continue
      }

      if (res.status === 204) return null
      const text = await res.text()
      const data = text ? JSON.parse(text) : null
      if (!res.ok) {
        const message = (data?.errorMessages || []).join('; ') || data?.message || res.statusText || `HTTP ${res.status}`
        const err = new Error(`Jira API ${method} ${path} failed: ${message}`)
        err.status = res.status
        throw err
      }
      return data
    }
  }

  const enc = encodeURIComponent

  return {
    /** A single project's REST v3 shape, or throws on a 404. */
    async getProject(projectIdOrKey) {
      return request('GET', `/rest/api/3/project/${enc(projectIdOrKey)}`)
    },

    /** One page of `GET /rest/api/3/project/search` (`{values, startAt, maxResults, total, isLast}`). */
    async listProjects({ startAt = 0, maxResults = DEFAULT_MAX_RESULTS } = {}) {
      return request('GET', '/rest/api/3/project/search', { query: { startAt, maxResults } })
    },

    /** Every project on the site, walked serially page by page. */
    async listAllProjects() {
      const out = []
      let startAt = 0
      for (;;) {
        const page = await this.listProjects({ startAt })
        out.push(...(page?.values || []))
        if (page?.isLast || !page?.values?.length || out.length >= (page?.total ?? out.length)) break
        startAt += page.values.length
      }
      return out
    },

    /**
     * A single issue (`GET /rest/api/3/issue/{idOrKey}`). Mirrors
     * github/client.js's `getIssue`: a missing issue throws (status 404 on the
     * error, same as any other non-2xx) rather than returning null — the
     * null-on-missing convention lives in the fake client, exercised by tests.
     */
    async getIssue(issueIdOrKey, { fields } = {}) {
      return request('GET', `/rest/api/3/issue/${enc(issueIdOrKey)}`, {
        query: fields ? { fields: fields.join(',') } : undefined,
      })
    },

    /**
     * One page of a JQL search (`POST /rest/api/3/search`), returning
     * `{issues, startAt, maxResults, total}`.
     */
    async searchIssues(jql, { startAt = 0, maxResults = DEFAULT_MAX_RESULTS, fields } = {}) {
      return request('POST', '/rest/api/3/search', {
        body: { jql, startAt, maxResults, fields: fields || undefined },
      })
    },

    /** Every issue matching a JQL query, walked serially page by page. */
    async searchAllIssues(jql, { fields } = {}) {
      const out = []
      let startAt = 0
      for (;;) {
        const page = await this.searchIssues(jql, { startAt, fields })
        out.push(...(page?.issues || []))
        if (!page?.issues?.length || out.length >= (page?.total ?? out.length)) break
        startAt += page.issues.length
      }
      return out
    },

    /** One page of `GET /rest/api/3/issue/{idOrKey}/comment` (`{comments, startAt, maxResults, total}`). */
    async listComments(issueIdOrKey, { startAt = 0, maxResults = DEFAULT_MAX_RESULTS } = {}) {
      return request('GET', `/rest/api/3/issue/${enc(issueIdOrKey)}/comment`, { query: { startAt, maxResults } })
    },

    /** Every comment on an issue, walked serially page by page. */
    async listAllComments(issueIdOrKey) {
      const out = []
      let startAt = 0
      for (;;) {
        const page = await this.listComments(issueIdOrKey, { startAt })
        out.push(...(page?.comments || []))
        if (!page?.comments?.length || out.length >= (page?.total ?? out.length)) break
        startAt += page.comments.length
      }
      return out
    },

    /** `GET /rest/api/3/myself` — the authenticated user, used to validate a link-form token (LIN-1885 beat 2). */
    async getMyself() {
      return request('GET', '/rest/api/3/myself')
    },
  }
}
