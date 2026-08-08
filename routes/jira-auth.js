/**
 * Jira Cloud auth routes (LIN-1885, Phase 1 of LIN-275) — the API-token
 * Basic-auth consumer of the LIN-562 provider-binding seam.
 *
 * Unlike GitHub's three-step OAuth App flow (install → callback → link), Jira
 * Phase 1 has no OAuth exchange at all: it is a SYNCHRONOUS validate-then-link,
 * closer to the Local provider's non-OAuth create (routes/workspace.js) than
 * to GitHub's picker. Two routes:
 *
 *   GET  /auth/jira        → render the {email, apiToken, site} link form
 *                             (lib/render-pages.js renderJiraLinkForm), for the
 *                             target workspace named in `?workspace=<urlKey>`.
 *   POST /auth/jira/link   → validate the credential via a lightweight read
 *                             probe (provider.validateCredential — GET
 *                             /rest/api/3/myself), then linkProvider it onto
 *                             that same workspace.
 *
 * The Phase 1 BASIC routes above remain ADD-SOURCE ONLY, and deliberately so:
 * an API token authenticates a workspace binding, not a human, so it cannot
 * establish a login. Because they have no OAuth redirect round-trip, the target
 * workspace's urlKey rides as a plain form field (GET → hidden POST field)
 * rather than session-carried `mode`/`workspaceUrlKey` intent.
 *
 * The OAuth 3LO routes (LIN-1887, further down) DO carry that intent, and
 * LIN-1890 uses it to add the second entry point — a top-level "Continue with
 * Jira" login for a Jira-only human:
 *
 *   GET  /auth/jira/oauth?mode=new           → landing sign-in (the default)
 *   GET  /auth/jira/oauth?workspace=<urlKey>&mode=add-source
 *                                            → settings "add a source"
 *
 * Both entry points share the SAME three routes and differ only by the
 * server-side `mode` in `req.session.oauthIntent` — the GitHub precedent
 * (`routes/github-auth.js`), never intent encoded into the `state` nonce.
 */
import crypto from 'crypto'
import { Router } from 'express'
import { renderErrorPage, renderJiraLinkForm, renderJiraSiteSelectPage } from '../lib/render-pages.js'
import {
  getWorkspaceByUrlKey,
  validateWorkspaceUrlKey,
  linkProvider,
  saveSession,
  upsertWorkspace,
} from '../lib/workspace.js'
import { establishAccount } from '../lib/account-session.js'
import { applyUserPreferencesToSession } from '../lib/user-preferences.js'
import { calculateExpiresAt } from '../lib/token-refresh.js'
import {
  getMissingJiraOAuthConfig,
  buildJiraAuthorizeUrl,
  exchangeJiraCode,
  fetchJiraAccessibleResources,
} from '../lib/providers/jira/oauth.js'

const NO_WORKSPACE_MESSAGE = 'Jira can only be added as an additional source on an existing workspace — open Settings on the workspace you want to add it to, then try again.'
const INVALID_SITE_MESSAGE = 'Site must be a Jira Cloud URL like https://yourteam.atlassian.net — no path, port, or credentials.'

/**
 * The SSRF guard: `site` reaches `createJiraClient` as a literal fetch base
 * (`lib/providers/jira/client.js`), so an unvalidated value lets a caller make
 * the server issue arbitrary requests to arbitrary hosts (LIN-1885 re-review
 * blocker — confirmed reachable via this exact form, no auth bypass needed).
 * Accepts ONLY a bare `https://<tenant>.atlassian.net` tenant base:
 *   - `endsWith('.atlassian.net')`, never `includes` — `includes` would pass
 *     a suffix-confusion host like `https://acme.atlassian.net.evil.com`.
 *   - no embedded credentials, no non-default port, no path/query/fragment —
 *     a trailing `?` in the raw input would otherwise land in `url.search`
 *     and push the client's fixed `/rest/api/3/myself` suffix into the query
 *     string, handing the caller control of the full request path.
 * `URL` lower-cases `hostname` for us, so this is case-insensitive for free.
 * @param {string} site
 * @returns {string|null} the normalized `https://<tenant>.atlassian.net` base, or null if invalid.
 */
export function normalizeJiraSite(site) {
  let url
  try {
    url = new URL(String(site))
  } catch {
    return null
  }
  if (url.protocol !== 'https:') return null
  if (url.username || url.password) return null
  if (url.port) return null
  if (url.pathname !== '/') return null
  if (url.search || url.hash) return null
  if (!url.hostname.endsWith('.atlassian.net')) return null
  return `https://${url.hostname}`
}

/**
 * Derive a workspace `urlKey` for a Jira-only login container from the SITE
 * tenant (LIN-1890 N2).
 *
 * The identity cannot supply it: an Atlassian `accountId` is commonly
 * `557058:<uuid>`, and the colon fails `URL_KEY_REGEX` (`lib/workspace.js`), so
 * `jira:${accountId}` is a legal workspace *id* but never a legal urlKey. The
 * tenant label of `https://<tenant>.atlassian.net` is the only human-meaningful
 * value in hand at pick time.
 *
 * The collision fallback is load-bearing rather than defensive: tenant names are
 * company names, so two humans connecting `acme.atlassian.net` and an unrelated
 * `acme` Linear workspace in the SAME session is an ordinary case, not a freak
 * one. A urlKey collision would make `getWorkspaceByUrlKey` resolve the wrong
 * workspace for every subsequent request.
 *
 * @param {{url: string}} site - the picked site (its `url` is the tenant base).
 * @param {Array<{urlKey?: string}>} [existingWorkspaces] - the session's current workspaces.
 * @returns {string} a urlKey that passes `validateWorkspaceUrlKey` and is unused in this session.
 */
export function deriveJiraUrlKey(site, existingWorkspaces = []) {
  let tenant = ''
  try {
    tenant = new URL(String(site?.url)).hostname.split('.')[0]
  } catch {
    tenant = ''
  }
  const base = validateWorkspaceUrlKey(tenant) ? tenant.toLowerCase() : 'jira'
  const taken = new Set((existingWorkspaces || []).map(w => w?.urlKey).filter(Boolean))
  if (!taken.has(base)) return base
  // Bounded by MAX_WORKSPACES-worth of headroom; `upsertWorkspace` refuses long
  // before this loop could exhaust, so it cannot spin.
  for (let n = 2; n <= 100; n++) {
    const candidate = `${base}-${n}`.slice(0, 50)
    if (!taken.has(candidate)) return candidate
  }
  return `jira-${Date.now()}`.slice(0, 50)
}

/**
 * @param {Object} options
 * @param {import('../lib/providers/jira/index.js').JiraProvider} options.provider - injected by JiraProvider.getAuthRouter().
 * @param {import('../lib/account-store.js').AccountStore} [options.accountStore] - LIN-1329: find-or-create the durable account for the signing-in Jira identity.
 * @param {import('../lib/account-workspace-store.js').AccountWorkspaceStore} [options.accountWorkspaceStore] - LIN-1329: bind the account to the workspace.
 * @param {Object} [options.userPreferencesStore] - LIN-1890 N1: rehydrates durable preferences onto the regenerated session of a `mode: 'new'` Jira login, mirroring routes/github-auth.js. `server.js`'s auth-mount loop has always passed this and `getAuthRouter` has always spread it through — this router simply dropped it on the floor until the bootstrap needed it.
 * @returns {import('express').Router}
 */
export function createJiraAuthRoutes({ provider, accountStore, accountWorkspaceStore, ownerCredentialStore, userPreferencesStore } = {}) {
  const router = Router()

  const notConfigured = (res) => res.status(503).send(renderErrorPage(
    'Jira OAuth Not Configured',
    `Jira OAuth login is not available. Missing environment variables: ${getMissingJiraOAuthConfig().join(', ')}. See .env.example for setup instructions.`,
    { action: 'Go to homepage', actionUrl: '/' }
  ))

  /**
   * Resolve the ADD-SOURCE target workspace for an OAuth hop. Same contract as
   * the Basic routes above (an existing workspace is required), but the urlKey
   * arrives from `req.session.oauthIntent` rather than a form field, because an
   * OAuth round-trip has nowhere else to carry it. Never called on the
   * `mode: 'new'` path, which by definition has no workspace to resolve.
   */
  const resolveIntentWorkspace = (req) => {
    const urlKey = req.session.oauthIntent?.workspaceUrlKey
    if (!validateWorkspaceUrlKey(urlKey)) return null
    return getWorkspaceByUrlKey(req.session, urlKey) || null
  }

  /**
   * Step 1: render the link form for the workspace the user is adding Jira
   * onto. `?workspace=<urlKey>` mirrors every other add-source entry point's
   * `workspace` query param (routes/github-auth.js), even though Jira never
   * carries a `mode` — it has no "new" (fresh top-level) path this phase.
   */
  router.get('/auth/jira', (req, res) => {
    const workspaceUrlKey = req.query.workspace
    if (!validateWorkspaceUrlKey(workspaceUrlKey) || !getWorkspaceByUrlKey(req.session, workspaceUrlKey)) {
      return res.status(400).send(renderErrorPage('No Workspace Selected', NO_WORKSPACE_MESSAGE, {
        action: 'Go to homepage', actionUrl: '/'
      }))
    }
    res.send(renderJiraLinkForm({ workspaceUrlKey }))
  })

  /**
   * Step 2: validate-then-link, synchronously — no redirect round-trip.
   */
  router.post('/auth/jira/link', async (req, res) => {
    const { email, apiToken, site, workspace: workspaceUrlKey } = req.body || {}

    const workspace = validateWorkspaceUrlKey(workspaceUrlKey) && getWorkspaceByUrlKey(req.session, workspaceUrlKey)
    if (!workspace) {
      return res.status(400).send(renderErrorPage('No Active Workspace', NO_WORKSPACE_MESSAGE, {
        action: 'Go to homepage', actionUrl: '/'
      }))
    }

    if (!email || !apiToken || !site) {
      return res.status(400).send(renderJiraLinkForm({
        workspaceUrlKey,
        error: 'Email, API token, and site are all required.',
      }))
    }
    const normalizedSite = normalizeJiraSite(site)
    if (!normalizedSite) {
      return res.status(400).send(renderJiraLinkForm({
        workspaceUrlKey,
        error: INVALID_SITE_MESSAGE,
      }))
    }

    // Validate BEFORE linking — a lightweight read probe (GET /rest/api/3/myself)
    // rather than the settings refresh route's generic READ_PROBES list, which
    // Jira's Phase 1 surface has no fetchViewer/fetchOrganization/
    // fetchProjectsList to satisfy. A failed probe never links a dead credential.
    let myself
    try {
      myself = await provider.validateCredential({ email, apiToken, site: normalizedSite })
    } catch (err) {
      return res.status(400).send(renderJiraLinkForm({
        workspaceUrlKey,
        error: 'Could not authenticate with Jira. Check the email, API token, and site URL and try again.',
      }))
    }

    // LIN-1329: establish the durable account for this identity. `jira` is
    // its own identity provider (mirrors GitHub's userId-keyed identity,
    // github-projects/routes/github-auth.js), keyed on the human's Jira
    // accountId — never the workspace/site, which is a resource address, not
    // an identity (the LIN-1329 Q1 ruling: a resource-scoped identity would
    // let two humans sharing a site false-conflict).
    const established = await establishAccount(
      req.session, accountStore, accountWorkspaceStore, 'jira', myself.accountId,
      { email: myself.emailAddress, displayName: myself.displayName }, workspace.id
    )
    if (!established.ok) {
      return res.status(409).send(renderErrorPage('Account Conflict', 'This Jira account is already linked to a different Harbour account. Please sign in with that account, or contact support.', {
        action: 'Go to homepage', actionUrl: '/'
      }))
    }

    // linkProvider (lib/workspace.js) is the single seam: it writes
    // `credentials` into the (provider, scope) BINDING (the durable source of
    // truth) and, for the active binding, copies `tokenExpiresAt` onto the
    // legacy scalar mirror too — one write, both projections (LIN-1885
    // research finding 3: the MAX_SAFE_INTEGER stamp must land in
    // `binding.credentials`, not only the scalar mirror, so a later
    // setActiveProvider/mirrorActiveBinding re-point carries it forward, and
    // so the headless-resolve token-expiry check — which reads the scalar
    // mirror — sees it too). `site` is the binding's `scope` (third arg),
    // exactly like a GitHub binding's `scope` is its repo — not duplicated
    // into `credentials`, so there is only one place it can drift from.
    linkProvider(workspace, 'jira', normalizedSite, {
      token: apiToken,
      email,
      tokenExpiresAt: Number.MAX_SAFE_INTEGER,
    })

    await saveSession(req.session)
    res.redirect(`/workspace/${encodeURIComponent(workspace.urlKey)}/settings?provider_ok=jira`)
  })

  // ---------------------------------------------------------------------------
  // OAuth 2.0 3LO (LIN-1887, Phase 3) — alongside, never replacing, the Phase 1
  // Basic routes above.
  // ---------------------------------------------------------------------------

  /**
   * Step 1: begin the 3LO round-trip.
   *
   * `state` is an OPAQUE CSRF nonce and carries no intent; intent lives in
   * `req.session.oauthIntent`, the LIN-562 convention every other router follows
   * (`routes/github-auth.js`). LIN-1887 built the whole round-trip — nonce,
   * intent carry, config gate — and recorded `mode` so this could be added
   * without reshaping the session state.
   *
   * LIN-1890 E1 is that addition, and ONLY that: the `mode` ternary now defaults
   * to `'new'` (the landing "Continue with Jira" entry, which has no workspace
   * yet) instead of hard-coding `'add-source'`, and the target workspace is
   * required — and attached — only on the `add-source` branch. Every other line
   * here is LIN-1887's, deliberately untouched; the byte-for-byte shape of the
   * ternary matches `routes/github-auth.js:100`, which is the point.
   */
  router.get('/auth/jira/oauth', (req, res) => {
    if (getMissingJiraOAuthConfig().length > 0) return notConfigured(res)

    const mode = req.query.mode === 'add-source' ? 'add-source' : 'new'
    const workspaceUrlKey = req.query.workspace
    // Add-source still REFUSES without a resolvable target — the Phase 1
    // contract (`NO_WORKSPACE_MESSAGE`) is unchanged for that entry point. A
    // `mode: 'new'` login has no workspace by definition, so the guard cannot
    // apply to it; the container is found-or-created at pick time instead.
    if (mode === 'add-source' && (!validateWorkspaceUrlKey(workspaceUrlKey) || !getWorkspaceByUrlKey(req.session, workspaceUrlKey))) {
      return res.status(400).send(renderErrorPage('No Workspace Selected', NO_WORKSPACE_MESSAGE, {
        action: 'Go to homepage', actionUrl: '/'
      }))
    }

    const state = crypto.randomUUID()
    let authorizeUrl
    try {
      authorizeUrl = buildJiraAuthorizeUrl({ state })
    } catch (err) {
      console.error('Jira beginAuth error:', err)
      return notConfigured(res)
    }

    req.session.oauthState = state
    const intent = { mode, provider: 'jira' }
    if (mode === 'add-source') intent.workspaceUrlKey = workspaceUrlKey
    req.session.oauthIntent = intent
    req.session.save(() => res.redirect(authorizeUrl))
  })

  /**
   * Step 2: the callback — validate `state`, exchange the code, discover which
   * sites the grant reaches.
   *
   * The rotating refresh token goes STRAIGHT to the durable store and never into
   * the session (LIN-1524). GitHub's `githubPending` is not a usable precedent
   * here: it holds no credential at all (a slug→installationId map; the secret is
   * minted server-side AFTER the pick), and Jira cannot copy that because
   * Atlassian's code exchange is single-use and must happen here. So the token
   * genuinely survives the pick — which is fine for the short-lived ACCESS token
   * (session workspaces already carry access tokens) and is not fine for the
   * rotating refresh token, hence the durable-first write.
   *
   * Writing durable-first has one consequence, stated rather than discovered
   * later: an ABANDONED pick leaves an orphan durable Jira record for a workspace
   * with no Jira binding. It is inert — nothing reads a provider partition whose
   * binding does not exist, the next link attempt overwrites it, and
   * whole-workspace removal deletes every partition — but it is asserted rather
   * than assumed (see the LIN-1887 route tests).
   */
  router.get('/auth/jira/oauth/callback', async (req, res) => {
    if (getMissingJiraOAuthConfig().length > 0) return notConfigured(res)

    const { code, state, error } = req.query
    if (error) {
      return res.status(400).send(renderErrorPage('Connection Cancelled',
        error === 'access_denied' ? 'You cancelled the Jira authorization request.' : `Jira authorization failed: ${error}`,
        { action: 'Go to homepage', actionUrl: '/' }))
    }
    if (!state || state !== req.session.oauthState) {
      return res.status(400).send(renderErrorPage('Session Expired', 'Your Jira sign-in session expired or was invalid. Please try again.', {
        action: 'Go to homepage', actionUrl: '/'
      }))
    }

    // LIN-1890 E2: `mode: 'new'` has no workspace to resolve — the container is
    // found-or-created at pick time, once identity and the site are both known.
    // `add-source` keeps LIN-1887's guard verbatim.
    const mode = req.session.oauthIntent?.mode === 'add-source' ? 'add-source' : 'new'
    const workspace = mode === 'add-source' ? resolveIntentWorkspace(req) : null
    if (mode === 'add-source' && !workspace) {
      return res.status(400).send(renderErrorPage('No Workspace Selected', NO_WORKSPACE_MESSAGE, {
        action: 'Go to homepage', actionUrl: '/'
      }))
    }

    let tokenBag
    try {
      tokenBag = await exchangeJiraCode(code)
    } catch (err) {
      console.error('Jira code exchange error:', err)
      return res.status(400).send(renderErrorPage('Authentication Failed', 'Could not complete authentication with Jira. Please try again.', {
        action: 'Go to homepage', actionUrl: '/'
      }))
    }

    let sites
    try {
      sites = await fetchJiraAccessibleResources(tokenBag.access_token)
    } catch (err) {
      console.error('Jira accessible-resources error:', err)
      return res.status(502).send(renderErrorPage('Connection Error', 'Could not read which Jira sites your account can access. Please try again.', {
        action: 'Go to homepage', actionUrl: '/'
      }))
    }
    if (!sites.length) {
      return res.status(400).send(renderErrorPage('No Jira Sites', 'Your Atlassian account has no Jira sites this app can access.', {
        action: 'Go to homepage', actionUrl: '/'
      }))
    }

    // Durable-first: the rotating refresh token is persisted under the JIRA
    // partition (never Linear's — LIN-1887 F1) before anything else can fail.
    //
    // This writes through the store's own `put` rather than
    // `persistOwnerCredential`, and the difference is load-bearing rather than
    // an oversight (LIN-1887 close-out): that helper derives the record's
    // `token` from the workspace's binding for `provider`, falling back to the
    // scalar `workspace.accessToken` mirror. At THIS point in the flow the site
    // has not been picked yet, so there is no Jira binding to read — the helper
    // would fall back and write LINEAR's access token into the Jira partition.
    // Nor can the write simply move after `linkProvider` in
    // `completeJiraOAuthLink`: the refresh token deliberately never enters
    // `jiraPending`, so the callback is the only place it exists. The
    // partitioning is identical either way — `put` derives the partition from
    // the record's own `provider` field, which is exactly what
    // `persistOwnerCredential` passes it.
    //
    // LIN-1890 E2 — why this is add-source ONLY. The store is keyed
    // `(accountId, urlKey)`, and on a `mode: 'new'` login NEITHER key exists
    // yet: there is no `session.accountId` until `establishAccount` runs (which
    // needs the identity, which needs a picked site), and no `urlKey` until the
    // container is created from that same site. Writing durable-first is not
    // merely inconvenient there — it is unaddressable. The `new` branch performs
    // the identical write inside `completeJiraOAuthLink`, at the first point
    // both keys exist.
    if (mode === 'add-source' && tokenBag.refresh_token && ownerCredentialStore) {
      await ownerCredentialStore.put(req.session.accountId, workspace.urlKey, {
        provider: 'jira',
        token: tokenBag.access_token,
        refreshToken: tokenBag.refresh_token,
        tokenExpiresAt: calculateExpiresAt(tokenBag.expires_in)
      })
    }

    // `jiraPending` carries NO rotating credential on the add-source path —
    // only the pick's inputs and the short-lived access token.
    req.session.jiraPending = {
      mode,
      workspaceUrlKey: workspace?.urlKey,
      sites,
      accessToken: tokenBag.access_token,
      expiresIn: tokenBag.expires_in,
    }

    // The one `mode: 'new'` exception, stated rather than discovered later. With
    // MULTIPLE sites the pick is a separate HTTP round-trip, and the durable
    // write cannot happen until after it (see above), so the rotating token has
    // nowhere else to wait. This is narrower than the LIN-1524 anti-pattern it
    // resembles: the value is written once, read exactly once, and deleted the
    // moment it is consumed — it is never the credential a REFRESH rotates
    // against (that is always the durable record), so it cannot go stale and
    // cannot lose a rotation. With a single site the pick is skipped entirely
    // and the token is passed as an argument, never touching the session at all.
    if (mode === 'new' && sites.length > 1 && tokenBag.refresh_token) {
      req.session.jiraPending.refreshToken = tokenBag.refresh_token
    }

    // One site is the common case: skip the picker entirely, which removes the
    // pending state altogether.
    if (sites.length === 1) {
      return completeJiraOAuthLink(req, res, sites[0], tokenBag.refresh_token)
    }
    return req.session.save(() => res.send(renderJiraSiteSelectPage(sites)))
  })

  /**
   * Step 3: the pick. Resolves `cloudId` against the session's own `sites` list —
   * never trusting the client to assert a site the grant does not reach.
   */
  router.post('/auth/jira/oauth/link', async (req, res) => {
    const pending = req.session.jiraPending
    if (!pending) {
      return res.status(400).send(renderErrorPage('Session Expired', 'Your Jira sign-in session expired. Please try again.', {
        action: 'Go to homepage', actionUrl: '/'
      }))
    }
    const site = (pending.sites || []).find(s => s.cloudId === req.body?.cloudId)
    if (!site) {
      return res.status(400).send(renderErrorPage('Unknown Jira Site', 'That Jira site is not one your account authorized. Please try again.', {
        action: 'Go to homepage', actionUrl: '/'
      }))
    }
    return completeJiraOAuthLink(req, res, site, pending.refreshToken)
  })

  /**
   * Steps 4–5: identity, then the binding write.
   *
   * Identity is the HUMAN's Atlassian `accountId` from `GET /rest/api/3/myself`
   * — the same endpoint and the same id Phase 1 keys on, so a human upgrading a
   * Basic link to OAuth resolves to the same Harbour account. Keying on cloudId
   * or site instead would false-conflict two humans on one site (LIN-1329 Q1).
   */
  async function completeJiraOAuthLink(req, res, site, refreshToken) {
    const pending = req.session.jiraPending
    const mode = pending?.mode === 'add-source' ? 'add-source' : 'new'
    const workspace = mode === 'add-source' ? getWorkspaceByUrlKey(req.session, pending.workspaceUrlKey) : null
    if (mode === 'add-source' && !workspace) {
      return res.status(400).send(renderErrorPage('No Active Workspace', NO_WORKSPACE_MESSAGE, {
        action: 'Go to homepage', actionUrl: '/'
      }))
    }

    let myself
    try {
      myself = await provider.validateCredential({ authType: 'oauth', accessToken: pending.accessToken, cloudId: site.cloudId, site: site.url })
    } catch (err) {
      console.error('Jira OAuth identity lookup error:', err)
      return res.status(400).send(renderErrorPage('Authentication Failed', 'Could not verify your Jira account. Please try again.', {
        action: 'Go to homepage', actionUrl: '/'
      }))
    }

    if (mode === 'new') {
      return completeJiraNewLogin(req, res, site, myself, refreshToken)
    }

    const established = await establishAccount(
      req.session, accountStore, accountWorkspaceStore, 'jira', myself.accountId,
      { email: myself.emailAddress, displayName: myself.displayName }, workspace.id
    )
    if (!established.ok) {
      return res.status(409).send(renderErrorPage('Account Conflict', 'This Jira account is already linked to a different Harbour account. Please sign in with that account, or contact support.', {
        action: 'Go to homepage', actionUrl: '/'
      }))
    }

    // LIN-1887 Step 5. Three things are load-bearing here:
    //
    //  * `tokenExpiresAt` is REAL, derived from `expires_in`. The
    //    `Number.MAX_SAFE_INTEGER` sentinel the Basic path writes above is
    //    correct for an API token that genuinely never expires, and would be a
    //    lie here — it is what keeps a lapsed OAuth token resolving forever on
    //    the headless lane (`lib/workspace-token-resolver.js`).
    //  * the ACCESS token goes in `credentials.token`, because that is what
    //    `linkProvider` mirrors to `workspace.accessToken` and what
    //    `mirrorActiveBinding` re-points from; anywhere else silently breaks the
    //    scalar mirror, `getWorkspaceToken`, and the headless resolver.
    //  * the REFRESH token is NOT in `credentials` at all — it is already in the
    //    durable store, which is the only place a rotating credential lives
    //    (LIN-1524), and `linkProvider` deliberately never mirrors it.
    //
    // `scope` is the human-facing site URL (so `${site}/browse/${key}` deep links
    // keep working) and `authType` is the explicit discriminator every Jira
    // projection now branches on. Per D1, a same-site Basic→OAuth link is an
    // upgrade IN PLACE: bindings key on `(provider, scope)` and MERGE, so the two
    // shapes cannot coexist on one site — `authType` is what stops the merged
    // result from being read as Basic and sending the OAuth access token to the
    // tenant in a Basic header.
    linkProvider(workspace, 'jira', site.url, {
      token: pending.accessToken,
      authType: 'oauth',
      cloudId: site.cloudId,
      tokenExpiresAt: calculateExpiresAt(pending.expiresIn),
    })

    delete req.session.jiraPending
    delete req.session.oauthState
    delete req.session.oauthIntent
    await saveSession(req.session)
    res.redirect(`/workspace/${encodeURIComponent(workspace.urlKey)}/settings?provider_ok=jira`)
  }

  /**
   * LIN-1890 E2 — the `mode: 'new'` bootstrap: a Jira-only human, holding zero
   * Linear and zero GitHub bindings, lands in a working workspace.
   *
   * Mirrors `routes/github-auth.js:413-500` step for step, because the sequence
   * is not arbitrary — each step depends on the one before it:
   *
   *   find-or-create `jira:${accountId}` → regenerate → restore workspaces →
   *   upsertWorkspace → establishAccount → applyUserPreferencesToSession →
   *   activeWorkspaceId → save → redirect to the workspace (NOT settings)
   *
   * The container is keyed on the human's Atlassian `accountId`, so a second
   * SITE for the same human adds a binding rather than minting a second
   * workspace — bindings are keyed `(provider, scope)` and the scope is the site
   * (LIN-1329 Q1: identity is the human, never the site, which is a resource
   * address). The urlKey cannot come from that same id and is derived from the
   * tenant instead — see {@link deriveJiraUrlKey}.
   *
   * `regenerate()` is the session-fixation defence every fresh-login path runs.
   * It wipes the session, which is why `existingWorkspaces` is captured BEFORE
   * it and restored after (a user adding Jira as a second identity must not lose
   * their other workspaces), why `establishAccount` re-resolves the account by
   * IDENTITY rather than session continuity, and why preferences are rehydrated
   * afterwards rather than assumed to have survived.
   */
  async function completeJiraNewLogin(req, res, site, myself, refreshToken) {
    const pending = req.session.jiraPending
    const credentials = {
      token: pending.accessToken,
      authType: 'oauth',
      cloudId: site.cloudId,
      tokenExpiresAt: calculateExpiresAt(pending.expiresIn),
    }
    const workspaceId = `jira:${myself.accountId}`

    // The durable rotating-credential write, shared by both arms below. Deferred
    // from the callback (where neither key exists on this path) to here, the
    // first point at which `accountId` and `urlKey` are BOTH known.
    const persistRefresh = async (accountId, urlKey) => {
      if (!refreshToken || !ownerCredentialStore) return
      await ownerCredentialStore.put(accountId, urlKey, {
        provider: 'jira',
        token: pending.accessToken,
        refreshToken,
        tokenExpiresAt: credentials.tokenExpiresAt,
      })
    }

    const finish = async (workspace) => {
      delete req.session.jiraPending
      delete req.session.oauthState
      delete req.session.oauthIntent
      await saveSession(req.session)
      res.redirect(`/workspace/${encodeURIComponent(workspace.urlKey)}/`)
    }

    // Returning user, same session: the container already exists, so this is a
    // binding add — no regenerate (the session is already theirs, and wiping it
    // would drop the workspaces we are adding to).
    const existing = (req.session.workspaces || []).find(w => w.id === workspaceId)
    if (existing) {
      const established = await establishAccount(
        req.session, accountStore, accountWorkspaceStore, 'jira', myself.accountId,
        { email: myself.emailAddress, displayName: myself.displayName }, existing.id
      )
      if (!established.ok) {
        return res.status(409).send(renderErrorPage('Account Conflict', 'This Jira account is already linked to a different Harbour account. Please sign in with that account, or contact support.', {
          action: 'Go to homepage', actionUrl: '/'
        }))
      }
      linkProvider(existing, 'jira', site.url, credentials)
      req.session.activeWorkspaceId = existing.id
      await persistRefresh(established.accountId, existing.urlKey)
      return finish(existing)
    }

    // Fresh container. `deriveJiraUrlKey` reads the CURRENT session workspaces,
    // so it must run before regenerate() wipes them.
    const workspace = {
      id: workspaceId,
      name: site.name || site.url,
      urlKey: deriveJiraUrlKey(site, req.session.workspaces),
      addedAt: Date.now(),
      // Stamp the real expiry explicitly so the workspace is never momentarily
      // marked never-expires; linkProvider's active-binding mirror overwrites it
      // with the same value (mirrors github-auth.js's identical note).
      tokenExpiresAt: credentials.tokenExpiresAt,
    }
    linkProvider(workspace, 'jira', site.url, credentials)

    const existingWorkspaces = req.session.workspaces || []
    // Awaited for the same reason github-auth.js awaits it: regenerate() does
    // not await its own callback, so without this the handler could resolve
    // before the async account/preference work inside it finished.
    //
    // The try/catch around the CALL (not just inside the callback) is the
    // LIN-761 lesson applied here: a throw that escapes an async callback
    // outside Express's middleware chain reaches no error handler and no
    // response is ever written, so the request hangs until the platform kills it
    // at 30s. A synchronous throw from `regenerate` itself has exactly that
    // shape, and it is strictly better to answer 500 than to hang.
    try {
      await new Promise((resolve, reject) => {
        try {
          req.session.regenerate(async (regenerateErr) => {
        try {
              if (regenerateErr) {
                console.error('Jira session regeneration error:', regenerateErr)
                return res.status(500).send(renderErrorPage('Session Error', 'Could not create a secure session. Please try again.', {
                  action: 'Go to homepage', actionUrl: '/'
                }))
              }
              req.session.workspaces = existingWorkspaces

              try {
                upsertWorkspace(req.session, workspace)
              } catch (limitError) {
                return res.status(400).send(renderErrorPage('Workspace Limit Reached', 'You have reached the maximum number of connected workspaces. Please remove one before adding another.', {
                  action: 'Go to dashboard', actionUrl: '/'
                }))
              }

              const established = await establishAccount(
                req.session, accountStore, accountWorkspaceStore, 'jira', myself.accountId,
                { email: myself.emailAddress, displayName: myself.displayName }, workspace.id
              )
              if (!established.ok) {
                return res.status(409).send(renderErrorPage('Account Conflict', 'This Jira account is already linked to a different Harbour account. Please sign in with that account, or contact support.', {
                  action: 'Go to homepage', actionUrl: '/'
                }))
              }

              // Strictly after established.accountId is populated (LIN-1353 S9).
              if (userPreferencesStore) {
                const savedPrefs = await userPreferencesStore.getUserPreferences(established.accountId)
                applyUserPreferencesToSession(req.session, savedPrefs)
              }

              await persistRefresh(established.accountId, workspace.urlKey)

              req.session.activeWorkspaceId = workspace.id
              await finish(workspace)
            } catch (err) {
              console.error('Jira post-regenerate callback error:', err)
              if (!res.headersSent) {
                res.status(500).send(renderErrorPage('Something Went Wrong', 'Could not complete your Jira sign-in. Please try again.', {
                  action: 'Go to homepage', actionUrl: '/'
                }))
              }
            } finally {
              resolve()
            }
          })
        } catch (regenerateThrow) {
          reject(regenerateThrow)
        }
      })
    } catch (err) {
      console.error('Jira session regenerate threw:', err)
      if (!res.headersSent) {
        res.status(500).send(renderErrorPage('Session Error', 'Could not create a secure session. Please try again.', {
          action: 'Go to homepage', actionUrl: '/'
        }))
      }
    }
  }

  return router
}
