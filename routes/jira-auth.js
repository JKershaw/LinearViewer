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
 * Jira Phase 1 is ADD-SOURCE ONLY — there is no top-level "Continue with
 * Jira" login entry point (no KNOWN_ADD_PROVIDERS/landing wiring points here
 * without an existing workspace; that wiring is LIN-1885 beat 4). Because
 * there is no OAuth redirect round-trip, the target workspace's urlKey rides
 * as a plain form field (GET → hidden POST field) rather than session-carried
 * `mode`/`workspaceUrlKey` intent the way GitHub's flow needs it.
 */
import crypto from 'crypto'
import { Router } from 'express'
import { renderErrorPage, renderJiraLinkForm, renderJiraSiteSelectPage } from '../lib/render-pages.js'
import { getWorkspaceByUrlKey, validateWorkspaceUrlKey, linkProvider, saveSession } from '../lib/workspace.js'
import { establishAccount } from '../lib/account-session.js'
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
 * @param {Object} options
 * @param {import('../lib/providers/jira/index.js').JiraProvider} options.provider - injected by JiraProvider.getAuthRouter().
 * @param {import('../lib/account-store.js').AccountStore} [options.accountStore] - LIN-1329: find-or-create the durable account for the signing-in Jira identity.
 * @param {import('../lib/account-workspace-store.js').AccountWorkspaceStore} [options.accountWorkspaceStore] - LIN-1329: bind the account to the workspace.
 * @returns {import('express').Router}
 */
export function createJiraAuthRoutes({ provider, accountStore, accountWorkspaceStore, ownerCredentialStore } = {}) {
  const router = Router()

  const notConfigured = (res) => res.status(503).send(renderErrorPage(
    'Jira OAuth Not Configured',
    `Jira OAuth login is not available. Missing environment variables: ${getMissingJiraOAuthConfig().join(', ')}. See .env.example for setup instructions.`,
    { action: 'Go to homepage', actionUrl: '/' }
  ))

  /**
   * Resolve the add-source target workspace for an OAuth hop. Same contract as
   * the Basic routes above (an existing workspace is required — Jira has no
   * `mode: 'new'` this phase; that is LIN-1890's), but the urlKey arrives from
   * `req.session.oauthIntent` rather than a form field, because an OAuth
   * round-trip has nowhere else to carry it.
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
   * (`routes/github-auth.js`). Add-source only this phase — there is no `mode:
   * 'new'` — but `mode` is still recorded so LIN-1890 can add one without
   * reshaping the session state.
   */
  router.get('/auth/jira/oauth', (req, res) => {
    if (getMissingJiraOAuthConfig().length > 0) return notConfigured(res)

    const workspaceUrlKey = req.query.workspace
    if (!validateWorkspaceUrlKey(workspaceUrlKey) || !getWorkspaceByUrlKey(req.session, workspaceUrlKey)) {
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
    req.session.oauthIntent = { mode: 'add-source', provider: 'jira', workspaceUrlKey }
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

    const workspace = resolveIntentWorkspace(req)
    if (!workspace) {
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
    if (tokenBag.refresh_token && ownerCredentialStore) {
      await ownerCredentialStore.put(req.session.accountId, workspace.urlKey, {
        provider: 'jira',
        token: tokenBag.access_token,
        refreshToken: tokenBag.refresh_token,
        tokenExpiresAt: calculateExpiresAt(tokenBag.expires_in)
      })
    }

    // `jiraPending` carries NO rotating credential — only the pick's inputs and
    // the short-lived access token.
    req.session.jiraPending = {
      mode: 'add-source',
      workspaceUrlKey: workspace.urlKey,
      sites,
      accessToken: tokenBag.access_token,
      expiresIn: tokenBag.expires_in,
    }

    // One site is the common case: skip the picker entirely, which removes the
    // pending state altogether.
    if (sites.length === 1) {
      return completeJiraOAuthLink(req, res, sites[0])
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
    return completeJiraOAuthLink(req, res, site)
  })

  /**
   * Steps 4–5: identity, then the binding write.
   *
   * Identity is the HUMAN's Atlassian `accountId` from `GET /rest/api/3/myself`
   * — the same endpoint and the same id Phase 1 keys on, so a human upgrading a
   * Basic link to OAuth resolves to the same Harbour account. Keying on cloudId
   * or site instead would false-conflict two humans on one site (LIN-1329 Q1).
   */
  async function completeJiraOAuthLink(req, res, site) {
    const pending = req.session.jiraPending
    const workspace = getWorkspaceByUrlKey(req.session, pending.workspaceUrlKey)
    if (!workspace) {
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

  return router
}
