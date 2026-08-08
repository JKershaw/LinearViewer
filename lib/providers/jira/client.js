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
//   1. `Retry-After` (seconds) is authoritative when present, UNLESS it exceeds
//      MAX_RETRY_AFTER_MS — a quota-scale wait (hour-scale) is not worth
//      sleeping through inline, so it fails fast instead (LIN-1885 beat 2
//      review finding #3).
//   2. Exponential backoff with jitter (base 2s, doubling, factor 0.7-1.3) only
//      when the header is absent.
//   3. `RateLimit-Reason` is read on EVERY 429, not just the terminal one, and
//      a quota reason (`jira-quota-global-based`/`jira-quota-tenant-based`)
//      fails fast on first sight — that bucket won't refill soon, unlike
//      `jira-burst-based`, where retrying is worthwhile (research §1.5).
//   4. Bounded at MAX_429_RETRIES attempts otherwise, then throws a
//      status-carrying error — never an unbounded retry loop.
//   5. Every thrown error carries `err.status = res.status` (mirrors
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
// Hard ceiling on issues returned by a single searchAllIssues walk (LIN-1885
// beat 1 review finding #2) — a full-tenant page walk is exactly the "one bad
// script" pattern the shared per-tenant burst bucket punishes. Callers that
// need more must page themselves; this is a safety net, not a UX limit.
const DEFAULT_SEARCH_CAP = 500
// A `Retry-After` above this is quota-scale, not burst-scale (LIN-1885 beat 2
// review finding #3) — Atlassian's quota buckets reset hour-scale, so honouring
// the header verbatim can park an Express handler for hours before failing
// anyway. Above the ceiling, fail fast with a typed error instead of sleeping.
const MAX_RETRY_AFTER_MS = 5 * 60 * 1000
// `RateLimit-Reason` values that mean "this bucket won't refill soon" (research
// §1.5) — retrying at request scope is pointless, unlike a `jira-burst-based`
// 429 (short, retry works). Fail fast on the FIRST occurrence rather than
// burning through MAX_429_RETRIES first.
const QUOTA_RATE_LIMIT_REASONS = new Set(['jira-quota-global-based', 'jira-quota-tenant-based'])
// Per-request timeout (LIN-1885 re-review blocker, part 4) — without this a
// `site` pointed at a black-holing host (unreachable IP, firewall drop) parks
// the Express handler indefinitely; the platform is the only thing that would
// eventually kill it. Matches lib/linear-fetch.js's DEFAULT_TIMEOUT_MS.
const REQUEST_TIMEOUT_MS = 15_000
// Hard ceiling on projects returned by a single listAllProjects walk (LIN-1885
// re-review finding #6) — projects are far fewer than issues in practice, but
// this is the one remaining unbounded serial walk on the dashboard path, and
// it feeds a `project in (...)` JQL whose length grows with it.
const DEFAULT_PROJECT_CAP = 500

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
  // Belt-and-braces (LIN-1885 re-review blocker, part 2): routes/jira-auth.js
  // is the one place `site` is validated as a Jira Cloud tenant URL today, but
  // this client is the actual SSRF sink — refusing a non-https base here means
  // no future caller (a script, a different route, a slipped regression) can
  // reintroduce the vulnerability by skipping that validation.
  if (!/^https:\/\//i.test(baseUrl)) {
    throw new Error(`createJiraClient: site must be an https:// URL, got: ${baseUrl || '(empty)'}`)
  }

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
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })

      if (res.status === 429) {
        attempt += 1
        const reason = res.headers?.get?.('RateLimit-Reason') || null
        const headerDelay = retryAfterMs(res)
        const quotaExhausted = reason != null && QUOTA_RATE_LIMIT_REASONS.has(reason)
        const overCeiling = headerDelay != null && headerDelay > MAX_RETRY_AFTER_MS
        if (attempt > MAX_429_RETRIES || quotaExhausted || overCeiling) {
          const failFastReason = quotaExhausted
            ? `quota exhausted (${reason})`
            : overCeiling
              ? `Retry-After (${headerDelay}ms) exceeds the ${MAX_RETRY_AFTER_MS}ms ceiling`
              : `after ${MAX_429_RETRIES} retries`
          const err = new Error(`Jira API ${method} ${path} failed: rate-limited, ${failFastReason} — retrying is not worthwhile`)
          err.status = 429
          err.rateLimitReason = reason
          throw err
        }
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

    /**
     * Every project on the site, walked serially page by page. Bounded at
     * `cap` projects (default `DEFAULT_PROJECT_CAP`, LIN-1885 re-review
     * finding #6) — the one remaining unbounded loop on the dashboard path,
     * and it feeds a `project in (...)` JQL whose length grows with it. The
     * returned array carries a `.truncated` flag (mirrors `searchAllIssues`)
     * so a capped read is never mistaken for "that's every project".
     */
    async listAllProjects({ cap = DEFAULT_PROJECT_CAP } = {}) {
      const out = []
      let startAt = 0
      let truncated = false
      for (;;) {
        const remaining = cap - out.length
        if (remaining <= 0) { truncated = true; break }
        const page = await this.listProjects({ startAt, maxResults: Math.min(DEFAULT_MAX_RESULTS, remaining) })
        out.push(...(page?.values || []))
        if (page?.isLast || !page?.values?.length || out.length >= (page?.total ?? out.length)) break
        startAt += page.values.length
      }
      out.truncated = truncated
      if (truncated) {
        console.warn(`Jira listAllProjects: hit the ${cap}-project cap with more projects remaining on the site — results are truncated, not exhaustive`)
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
     * One page of a JQL search (`POST /rest/api/3/search/jql` — Atlassian
     * removed the legacy `POST /rest/api/3/search` endpoint; it now returns
     * `410 Gone`). Returns `{issues, nextPageToken?}` — there is no `total`
     * on this endpoint, and random page access (`startAt`) is gone: paging is
     * cursor-based via `nextPageToken`, present only when more pages remain.
     * `fields` defaults to `['*navigable']` server-side, which is only issue
     * **IDs**' worth of summary data on this endpoint's actual default (bare
     * `id`/`key`/`self`) — callers that need mapped data MUST pass `fields`
     * explicitly.
     */
    async searchIssues(jql, { nextPageToken, maxResults = DEFAULT_MAX_RESULTS, fields } = {}) {
      return request('POST', '/rest/api/3/search/jql', {
        body: {
          jql,
          maxResults,
          fields: fields || undefined,
          nextPageToken: nextPageToken || undefined,
        },
      })
    },

    /**
     * Every issue matching a JQL query, walked serially page by page via
     * `nextPageToken` until the token is absent — never on a `total`, which
     * `/search/jql` does not return. Bounded at `cap` issues (default
     * `DEFAULT_SEARCH_CAP`) so an unfiltered/broad JQL can't turn one
     * dashboard render into thousands of sequential requests against the
     * shared per-tenant burst bucket; callers needing a wider walk pass a
     * larger `cap` explicitly.
     *
     * The returned array carries a `.truncated` flag (LIN-1885 re-review
     * finding #5) — `cap` is a safety net, and a tenant with more than `cap`
     * matching issues silently losing the tail (no flag, no log) is
     * indistinguishable from "that's every issue" without it. `truncated` is
     * only ever true when the cap, not the natural end of results, is what
     * stopped the walk.
     */
    async searchAllIssues(jql, { fields, cap = DEFAULT_SEARCH_CAP, maxResults = DEFAULT_MAX_RESULTS } = {}) {
      const out = []
      let nextPageToken
      let truncated = false
      for (;;) {
        const remaining = cap - out.length
        if (remaining <= 0) { truncated = true; break }
        const page = await this.searchIssues(jql, { nextPageToken, fields, maxResults: Math.min(maxResults, remaining) })
        const issues = page?.issues || []
        out.push(...issues)
        nextPageToken = page?.nextPageToken || null
        if (!issues.length || !nextPageToken) break
      }
      out.truncated = truncated
      if (truncated) {
        console.warn(`Jira searchAllIssues: hit the ${cap}-issue cap with more results remaining (jql: ${jql}) — results are truncated, not exhaustive`)
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

    // -------------------------------------------------------------------------
    // Writes (LIN-1886, Phase 2 of LIN-275)
    // -------------------------------------------------------------------------

    /**
     * `PUT /rest/api/3/issue/{idOrKey}` — update fields and/or apply a label
     * diff (`{ fields, update }`, either or both present). Jira answers `204`
     * on success (mapped to `null` by `request()` above) — the caller must
     * re-read via `getIssue` to see the persisted result.
     */
    async updateIssue(issueIdOrKey, body) {
      return request('PUT', `/rest/api/3/issue/${enc(issueIdOrKey)}`, { body })
    },

    /** `GET /rest/api/3/issue/{idOrKey}/transitions` — the workflow transitions currently available on this issue. */
    async getTransitions(issueIdOrKey) {
      return request('GET', `/rest/api/3/issue/${enc(issueIdOrKey)}/transitions`)
    },

    /** `POST /rest/api/3/issue/{idOrKey}/transitions` — execute a transition by id. Jira answers `204` on success. */
    async doTransition(issueIdOrKey, transitionId) {
      return request('POST', `/rest/api/3/issue/${enc(issueIdOrKey)}/transitions`, {
        body: { transition: { id: String(transitionId) } },
      })
    },

    /** `POST /rest/api/3/issue/{idOrKey}/comment` — create a comment (`body` is an ADF document). Jira returns the full created comment object. */
    async createComment(issueIdOrKey, body) {
      return request('POST', `/rest/api/3/issue/${enc(issueIdOrKey)}/comment`, { body })
    },

    /** One page of `GET /rest/api/3/label` (`{values, startAt, maxResults, total, isLast}` — `values` is an array of plain label name strings, Jira labels are global). */
    async listLabels({ startAt = 0, maxResults = DEFAULT_MAX_RESULTS } = {}) {
      return request('GET', '/rest/api/3/label', { query: { startAt, maxResults } })
    },

    /** Every label defined on the site, walked serially page by page. Bounded at `cap` (mirrors `listAllProjects`) since site-wide labels are, like projects, far fewer than issues but still an unbounded walk without one. */
    async listAllLabels({ cap = DEFAULT_PROJECT_CAP } = {}) {
      const out = []
      let startAt = 0
      let truncated = false
      for (;;) {
        const remaining = cap - out.length
        if (remaining <= 0) { truncated = true; break }
        const page = await this.listLabels({ startAt, maxResults: Math.min(DEFAULT_MAX_RESULTS, remaining) })
        out.push(...(page?.values || []))
        if (page?.isLast || !page?.values?.length || out.length >= (page?.total ?? out.length)) break
        startAt += page.values.length
      }
      out.truncated = truncated
      if (truncated) {
        console.warn(`Jira listAllLabels: hit the ${cap}-label cap with more labels remaining on the site — results are truncated, not exhaustive`)
      }
      return out
    },
  }
}
