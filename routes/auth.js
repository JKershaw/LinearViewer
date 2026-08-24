/**
 * OAuth 2.0 authentication routes for Linear.
 * Implements Authorization Code flow:
 * 1. /auth/linear - Initiates OAuth by redirecting to Linear
 * 2. /auth/callback - Exchanges code for access token
 * 3. /logout - Destroys session
 */
import crypto from 'crypto'
import { Router } from 'express'
import { getProvider } from '../lib/providers/registry.js'
import { AuthExchangeError } from '../lib/providers/interface.js'
import { renderErrorPage } from '../lib/render.js'
import { upsertWorkspace, saveSession, linkProvider, getActiveWorkspace, validateWorkspaceUrlKey, persistOwnerCredential } from '../lib/workspace.js'
import { calculateExpiresAt } from '../lib/token-refresh.js'
import { applyUserPreferencesToSession, setThemeCookie } from '../lib/user-preferences.js'
import { establishAccount, isFreshlyAuthenticated, MERGE_CONFIRM_FRESH_AUTH_WINDOW_MS } from '../lib/account-session.js'
import { evictWorkspaceTokenPair } from '../lib/workspace-token-cache.js'
import { renderMergeConfirmPage, renderMergeReauthRequiredPage } from '../lib/render-pages.js'

/**
 * Respond to an `establishAccount` conflict — the seam both the `mode:'new'`
 * and `mode:'add-source'` callback branches converge on (LIN-2233, L2.2 +
 * LIN-2231 amendment A1).
 *
 * `established.conflict` present means the arriving identity already belongs
 * to a DIFFERENT, pre-existing account: a real merge candidate. Anything else
 * (e.g. `established.reason === 'unknown-account'` — a stale/unrecognised
 * `session.accountId`) is not mergeable and stays the pre-existing dead-end
 * "Account Conflict" page, unchanged.
 *
 * For a real merge candidate, amendment A1 requires BOTH sides freshly
 * authenticated before a merge can be offered as a one-click confirm — a live
 * session for the canonical side plus a fresh auth for the arriving side is
 * NOT enough (a stolen/left-open canonical session + the sitting party's own
 * real login would otherwise yield a merge the session owner never proved).
 * `isFreshlyAuthenticated` checks the canonical side's own last proven
 * identity link in THIS session; the arriving side is fresh by construction
 * (its OAuth exchange just completed, this request). When the canonical side
 * isn't fresh, the merge is refused outright (re-auth-required page, no
 * pending state stored) rather than offered — retry after fresh sign-in.
 *
 * Never writes anything to the account/workspace stores itself — only
 * `POST /auth/merge/confirm` does that, after a second freshness check at
 * confirm time (see below). Declining (not confirming, or navigating away)
 * therefore leaves both accounts byte-identical to today.
 *
 * @param {Object} params
 * @param {Object} params.req
 * @param {Object} params.res
 * @param {{ok: false, conflict?: {accountId: string}, reason?: string}} params.established
 * @param {Object} params.workspace - the arriving identity's workspace (already populated by linkProvider)
 * @param {string} [params.refreshToken] - the arriving identity's OAuth refresh token, if any
 * @param {'new'|'add-source'} params.mode
 * @param {string} params.returnUrlKey - urlKey to land on if the merge is later confirmed
 * @returns {Promise<void>}
 */
async function respondToAccountConflict({ req, res, established, workspace, refreshToken, mode, returnUrlKey }) {
  if (!established.conflict) {
    // Non-mergeable: establishAccount refused with no merge candidate — today
    // that's exclusively `reason: 'unknown-account'` (lib/account-store.js), a
    // session.accountId that no longer resolves to a real account (deleted
    // account, restored/repointed datastore). Clear it — and its freshness
    // stamp — before rendering, or the SAME stale id is carried into every
    // retry (mode:'new' restores it across regenerate per LIN-2233, add-source
    // never regenerates at all) and this 409 becomes a permanent login
    // lockout (LIN-2266) instead of the pre-LIN-2233 self-heal. Also clear the
    // OAuth state/intent here — this early return used to skip the LIN-1351
    // hygiene the mergeable branches below still do, leaking oauthState/
    // oauthIntent across a failed round-trip.
    delete req.session.accountId
    delete req.session.identityAuthenticatedAt
    delete req.session.oauthState
    delete req.session.oauthIntent
    const html = renderErrorPage('Account Conflict', 'This Linear account is already linked to a different Harbour account. Please sign in with that account, or contact support.', {
      action: 'Go to homepage',
      actionUrl: '/'
    })
    return res.status(409).send(html)
  }

  const canonicalAccountId = req.session.accountId
  const mergedAccountId = established.conflict.accountId

  if (!isFreshlyAuthenticated(req.session, MERGE_CONFIRM_FRESH_AUTH_WINDOW_MS)) {
    delete req.session.oauthState
    delete req.session.oauthIntent
    const html = renderMergeReauthRequiredPage()
    return res.status(409).send(html)
  }

  req.session.pendingMerge = {
    canonicalAccountId,
    mergedAccountId,
    workspace,
    refreshToken: refreshToken || null,
    mode,
    returnUrlKey,
    createdAt: Date.now()
  }
  delete req.session.oauthState
  delete req.session.oauthIntent
  await saveSession(req.session)

  const html = renderMergeConfirmPage()
  return res.status(409).send(html)
}

/**
 * Create auth routes with required dependencies.
 * @param {Object} options
 * @param {Object} options.sessionStore - Session store with cleanup() method
 * @param {Object} options.userPreferencesStore - User preferences store for loading saved preferences
 * @param {Object} [options.provider] - The provider this auth router serves. Injected by the
 *   mounting provider (LinearProvider.getAuthRouter passes `this`); falls back to the Linear
 *   provider as a documented legacy default for direct constructions (LIN-561).
 * @param {import('../lib/account-store.js').AccountStore} options.accountStore - LIN-1329: find-or-create the durable account for the signing-in identity.
 * @param {import('../lib/account-workspace-store.js').AccountWorkspaceStore} options.accountWorkspaceStore - LIN-1329: bind the account to the workspace.
 * @param {(key: string) => void} [options.evictWorkspaceToken] - LIN-1507: evicts a resolved-token cache entry by its pre-computed key (see `workspaceTokenCacheKey`). Called at /logout for every workspace the session referenced, before the session is destroyed.
 * @param {import('../lib/owner-credential-store.js').OwnerCredentialStore} [options.ownerCredentialStore] - LIN-1523: durable owner-credential store. Linear-only; other providers' auth routers receive this option too (shared mount loop) but ignore it.
 * @param {import('../lib/account-merge-log.js').AccountMergeLogStore} [options.accountMergeLogStore] - LIN-2233: durable log for confirmed account merges. Optional so tests/callers that don't need the audit trail can omit it.
 * @returns {Router} Express router
 */
export function createAuthRoutes({ sessionStore, userPreferencesStore, provider, accountStore, accountWorkspaceStore, evictWorkspaceToken, ownerCredentialStore, accountMergeLogStore }) {
  const router = Router()

  const OAUTH_ENV_VARS = ['LINEAR_CLIENT_ID', 'LINEAR_CLIENT_SECRET', 'LINEAR_REDIRECT_URI'];

  /**
   * Check if OAuth environment variables are configured.
   * Returns list of missing variable names, or empty array if all set.
   * Skipped in test mode where mock auth is used.
   */
  function getMissingOAuthVars() {
    if (process.env.NODE_ENV === 'test') return [];
    return OAUTH_ENV_VARS.filter(v => !process.env[v]);
  }

  /**
   * Step 1: Initiate OAuth flow
   * Generates a CSRF-prevention state token, stores it in session,
   * and redirects user to Linear's OAuth authorization page.
   */
  router.get('/auth/linear', async (req, res) => {
    const missing = getMissingOAuthVars();
    if (missing.length > 0) {
      return res.status(503).send(renderErrorPage(
        'OAuth Not Configured',
        `Linear OAuth is not available. Missing environment variables: ${missing.join(', ')}. See .env.example for setup instructions.`
      ));
    }

    // Clean up expired sessions before proceeding
    await sessionStore.cleanup()

    // Generate random state token to prevent CSRF attacks. `state` stays an
    // opaque CSRF nonce — intent (new container vs. add-source) lives server-side
    // in the session, never encoded into `state` (LIN-562). Linear login is
    // always the new-container case today; add-source is LIN-541/544.
    const state = crypto.randomUUID()
    const authProvider = provider || getProvider('linear')

    // Intent (new container vs. add-source) lives server-side in the session,
    // never encoded into the opaque CSRF `state`. `mode:'add-source'` (LIN-1351)
    // starts connecting an ADDITIONAL Linear org for an already signed-in user:
    // its callback links the new org's org-scoped identity onto the LIVE account
    // WITHOUT regenerating, mirroring the GitHub add-source begin (github-auth.js).
    const mode = req.query.mode === 'add-source' ? 'add-source' : 'new'

    // Add-source only makes sense while signed in — the live session.accountId is
    // the mechanism that targets the current account. Without one, fall back to a
    // normal login rather than linking against nothing.
    if (mode === 'add-source' && !req.session.accountId) {
      return res.redirect('/auth/linear')
    }

    req.session.oauthState = state
    const intent = { mode, provider: authProvider.name }
    // For add-source, carry the initiating (VIEWED) workspace's urlKey through the
    // OAuth round-trip so the post-link redirect returns to its settings page
    // (LIN-1351, mirroring github-auth.js). Only attach a validated urlKey.
    if (mode === 'add-source' && validateWorkspaceUrlKey(req.query.workspace)) {
      intent.workspaceUrlKey = req.query.workspace
    }
    req.session.oauthIntent = intent

    req.session.save(() => {
      res.redirect(authProvider.beginAuth({ state }))
    })
  })

  /**
   * Step 2: Handle OAuth callback
   * Validates state, exchanges code for token, stores workspace in session.
   */
  router.get('/auth/callback', async (req, res) => {
    const missing = getMissingOAuthVars();
    if (missing.length > 0) {
      return res.status(503).send(renderErrorPage(
        'OAuth Not Configured',
        `Linear OAuth is not available. Missing environment variables: ${missing.join(', ')}. See .env.example for setup instructions.`
      ));
    }

    await sessionStore.cleanup()

    const { code, state, error } = req.query

    // Handle user denial or OAuth errors
    if (error) {
      const errorMessages = {
        'access_denied': 'You cancelled the authorization request.',
        'invalid_request': 'The authorization request was invalid.',
        'unauthorized_client': 'This application is not authorized.',
        'server_error': 'Linear encountered an error. Please try again.',
      }
      const message = errorMessages[error] || `Authorization failed: ${error}`
      const html = renderErrorPage('Authorization Cancelled', message, {
        action: 'Try again',
        actionUrl: '/auth/linear'
      })
      return res.status(400).send(html)
    }

    // Validate state token (CSRF protection)
    if (state !== req.session.oauthState) {
      // Clear the OAuth state/intent so no intent (e.g. a stale add-source
      // mode) leaks across this failed round-trip (LIN-1351 review).
      delete req.session.oauthState
      delete req.session.oauthIntent
      const html = renderErrorPage('Session Expired', 'Your session expired or was invalid. This can happen if you took too long to authorize, or if your browser restarted.', {
        action: 'Try again',
        actionUrl: '/auth/linear'
      })
      return res.status(400).send(html)
    }

    // LIN-561: use the provider this router was mounted for, not a hardcoded
    // getProvider('linear'); fall back to Linear as the documented legacy default.
    const authProvider = provider || getProvider('linear')
    // Intent (new container vs. add-source) is carried server-side in
    // req.session.oauthIntent (LIN-562). Linear login realizes only `mode:'new'`
    // today, so the callback consumes none of it yet; add-source (`mode:'existing'`,
    // a different find-or-create branch) reads it here for LIN-541/544.

    try {
      // Exchange authorization code for credentials via the provider's
      // acquisition seam (LIN-562). A clean exchange failure surfaces as
      // AuthExchangeError → the same 400 page the inline `!response.ok` branch
      // rendered before; anything else falls through to the generic 500 catch.
      let data
      try {
        data = await authProvider.completeAuth(code)
      } catch (exchangeError) {
        if (exchangeError instanceof AuthExchangeError) {
          console.error('Token exchange error:', exchangeError.detail)
          const html = renderErrorPage('Authentication Failed', 'Could not complete authentication with Linear. Please try again.', {
            action: 'Try again',
            actionUrl: '/auth/linear'
          })
          return res.status(400).send(html)
        }
        throw exchangeError
      }

      // Fetch organization info and current user in parallel.
      let org, viewer
      try {
        [org, viewer] = await Promise.all([
          authProvider.fetchOrganization(data.access_token),
          authProvider.fetchViewer(data.access_token)
        ])
      } catch (fetchError) {
        console.error('Failed to fetch from Linear:', fetchError)
        const html = renderErrorPage('Connection Error', 'Could not fetch workspace information from Linear. Please try again.', {
          action: 'Try again',
          actionUrl: '/auth/linear'
        })
        return res.status(500).send(html)
      }

      // Find-or-create the provider-independent container (LIN-562). For Linear,
      // identity stays org-derived for back-compat (existing urlKeys preserved);
      // upsertWorkspace below is the find-or-create by id. The credential is
      // attached through the single linkProvider seam — same path local/PAT use —
      // which also writes the legacy scalar mirror byte-identically.
      const workspace = {
        id: org.id,
        name: org.name,
        urlKey: org.urlKey || org.name,
        addedAt: Date.now()
      }
      // Linear documents expires_in as 86399 — one second off the 86400 fallback
      // below, so the stored tokenExpiresAt cannot tell a real value from a
      // substituted default after the fact. Only the raw field can (LIN-1367).
      console.log(`Linear OAuth callback; expires_in=${JSON.stringify(data.expires_in)} (present=${data.expires_in !== undefined})`)

      // LIN-1524: refreshToken is deliberately NOT passed here — linkProvider
      // would mirror it onto the binding's credentials (and, for the active
      // binding, the scalar mirror), and Linear's rotating credential is
      // durable-store-only now. `data.refresh_token` is threaded straight to
      // persistOwnerCredential below instead, once accountId is known.
      linkProvider(workspace, authProvider.name, org.id, {
        token: data.access_token,
        tokenExpiresAt: calculateExpiresAt(data.expires_in || 86400)
      })

      // Intent (new container vs. add-source) is carried server-side in the
      // session (LIN-562). LIN-1351: an add-source callback links a SECOND Linear
      // org's org-scoped identity onto the CURRENT signed-in account WITHOUT
      // regenerating, so the live session.accountId survives and targets that
      // account — mirroring GitHub add-source. FORK here, before the regenerate
      // wrapper; the default mode:'new' login path below is byte-identical.
      const intent = req.session.oauthIntent || {}
      const mode = intent.mode === 'add-source' ? 'add-source' : 'new'

      if (mode === 'add-source') {
        // === Linear add-source (LIN-1351): NON-regenerating link onto the live account ===
        // Order per LIN-1349: workspace limit-check → establishAccount → bind. The
        // 2nd org IS its own workspace (unlike GitHub, which binds a source onto the
        // already-viewed workspace), so upsert it here; the durable account↔workspace
        // edge is written by bindAccountToWorkspace INSIDE establishAccount on success.
        //
        // LIN-1351 review fix: snapshot session.workspaces BEFORE the push so any
        // post-push failure can restore it. workspaceFromUrl (server.js) authorizes
        // /workspace/:urlKey/* SOLELY from session.workspaces, and this session is
        // resave:false on a persistent store — so leaving org-2 (which carries a
        // LIVE OAuth token) in the list after a refused connection would persist
        // cross-request and grant access to a workspace we just declined. Keeping
        // the push here preserves LIN-1349's limit-check→establish order (the limit
        // check still runs before establishAccount); we only make it reversible.
        const workspacesBeforeAddSource = req.session.workspaces ? [...req.session.workspaces] : []
        try {
          upsertWorkspace(req.session, workspace)
        } catch (limitError) {
          req.session.workspaces = workspacesBeforeAddSource
          const html = renderErrorPage('Workspace Limit Reached', 'You have reached the maximum number of connected workspaces. Please remove one before adding another.', {
            action: 'Go to dashboard',
            actionUrl: '/'
          })
          return res.status(400).send(html)
        }

        // Link the 2nd org's org-scoped viewer.id onto the LIVE account. A live
        // session.accountId takes establishAccount's `else if (session.accountId)`
        // branch, linking (linear, viewer.id_org2) onto the current account and
        // binding it to the new workspace. The seam is reused INLINE, UNMODIFIED.
        const established = await establishAccount(req.session, accountStore, accountWorkspaceStore, 'linear', String(viewer.id), {}, workspace.id)
        if (!established.ok) {
          // Strict conflict (LIN-1326, no auto-merge — unless confirmed, LIN-2233):
          // the 2nd org's identity is already owned by a DIFFERENT account. Nothing
          // written yet — establishAccount returns before bindAccountToWorkspace, so
          // no binding, no account mutation, session.accountId unchanged, and NO
          // session save on the refuse-outright branches. This conflict IS reachable
          // (accountId is live) — the point of the branch, unlike the login path's
          // deliberately-unreachable dead-end conflict below.
          //
          // LIN-1351 review fix: RESTORE session.workspaces so org-2 (whose live
          // connection was just refused/pending) does not linger and authorize
          // /workspace/:urlKey/* access via workspaceFromUrl until a merge actually
          // confirms it (see respondToAccountConflict, which re-adds it on confirm).
          req.session.workspaces = workspacesBeforeAddSource
          const returnUrlKey =
            intent.workspaceUrlKey ||
            (getActiveWorkspace(req.session) || {}).urlKey ||
            workspace.urlKey
          return respondToAccountConflict({ req, res, established, workspace, refreshToken: data.refresh_token, mode: 'add-source', returnUrlKey })
        }

        // LIN-1523: durable dual-write, AFTER the limit-check + establishAccount
        // above — never before, or a refused workspace would leave a durable
        // credential behind. `workspace` was already fully populated by
        // linkProvider earlier in this handler; there is no updateWorkspaceTokens
        // call to wrap here, so this reaches persistOwnerCredential directly.
        // LIN-1524: `data.refresh_token` passed explicitly — `workspace` no
        // longer carries one (linkProvider above was deliberately not given it).
        await persistOwnerCredential(established.accountId, workspace, ownerCredentialStore, data.refresh_token)

        // Success: clear the OAuth state/intent, save the session, and return to
        // the initiating workspace's settings. Do NOT set activeWorkspaceId — the
        // user stays on their current workspace (plan UX (b), mirroring GitHub
        // add-source); the newly connected org is available in the switcher.
        delete req.session.oauthState
        delete req.session.oauthIntent
        await saveSession(req.session)
        const returnUrlKey =
          intent.workspaceUrlKey ||
          (getActiveWorkspace(req.session) || {}).urlKey ||
          workspace.urlKey
        return res.redirect(`/workspace/${encodeURIComponent(returnUrlKey)}/settings?provider_ok=linear`)
      }

      // === Normal Linear login (mode:'new') ===
      // Preserve existing workspaces before regenerating session
      const existingWorkspaces = req.session.workspaces || []
      // LIN-2233 (L2.1): carry session.accountId and its freshness stamp across
      // regenerate() exactly as session.workspaces already is — the manifest
      // simply omitted accountId until now. Without this, a NEW identity scope
      // (a second Linear org, a second provider) arriving while a different
      // account was live in the pre-regenerate session always took the mint
      // branch instead of the link/conflict branch, because session.accountId
      // was gone by the time establishAccount ran below. regenerate() itself is
      // STILL awaited and still runs (session-fixation protection unchanged) —
      // only the field manifest carried across it changes.
      const existingAccountId = req.session.accountId
      const existingIdentityAuthenticatedAt = req.session.identityAuthenticatedAt

      // Regenerate session ID to prevent session fixation attacks. Awaited
      // (LIN-1329): the callback now does real async I/O (establishAccount,
      // preferences) before responding, and regenerate() itself doesn't await
      // its callback — without this wrapper the handler could resolve, and a
      // caller could observe the session, before the callback finishes.
      await new Promise((resolve) => {
        req.session.regenerate(async (regenerateErr) => {
          try {
            if (regenerateErr) {
              console.error('Session regeneration error:', regenerateErr)
              const html = renderErrorPage('Session Error', 'Could not create a secure session. Please try again.', {
                action: 'Try again',
                actionUrl: '/auth/linear'
              })
              return res.status(500).send(html)
            }

            // Restore preserved workspaces
            req.session.workspaces = existingWorkspaces
            // LIN-2233 (L2.1): restore the carried accountId/freshness stamp
            // BEFORE establishAccount runs, so a returning identity (or a brand-
            // new one arriving while this account is live) resolves against the
            // account that was actually live pre-regenerate, not against nothing.
            req.session.accountId = existingAccountId
            req.session.identityAuthenticatedAt = existingIdentityAuthenticatedAt

            // LIN-1329 (Phase C): establish the durable account for this identity —
            // the single seam every sign-in path converges on. Identity scope is
            // Linear's viewer.id (the human).
            // Add/update workspace in session
            const workspacesBeforeLogin = req.session.workspaces ? [...req.session.workspaces] : []
            try {
              upsertWorkspace(req.session, workspace)
            } catch (limitError) {
              const html = renderErrorPage('Workspace Limit Reached', 'You have reached the maximum number of connected workspaces. Please remove one before adding another.', {
                action: 'Go to dashboard',
                actionUrl: '/'
              })
              return res.status(400).send(html)
            }

            const established = await establishAccount(req.session, accountStore, accountWorkspaceStore, 'linear', String(viewer.id), {}, workspace.id)
            if (!established.ok) {
              // LIN-2233 (L2.2): don't leak the arriving (unconfirmed) workspace's
              // live token into session.workspaces — restore it, same discipline
              // as the add-source branch above. respondToAccountConflict re-adds
              // it only if/when the merge is actually confirmed.
              req.session.workspaces = workspacesBeforeLogin
              return await respondToAccountConflict({ req, res, established, workspace, refreshToken: data.refresh_token, mode: 'new', returnUrlKey: workspace.urlKey })
            }

            // LIN-1523: durable dual-write, AFTER the limit-check + establishAccount
            // above — never before, or a refused workspace would leave a durable
            // credential behind. `workspace` was already fully populated by
            // linkProvider earlier in this handler; there is no
            // updateWorkspaceTokens call to wrap here, so this reaches
            // persistOwnerCredential directly.
            // LIN-1524: `data.refresh_token` passed explicitly — `workspace` no
            // longer carries one (linkProvider above was deliberately not given it).
            await persistOwnerCredential(established.accountId, workspace, ownerCredentialStore, data.refresh_token)

            // Load saved user preferences and apply to session.
            // regenerate() wiped the session, so rehydrate every durable field
            // session readers rely on — features, northStarByWorkspace, and the
            // OpenRouter key (LIN-498: previously dropped here, wiping the user's
            // OpenRouter connection on routine re-auth / account / workspace switch).
            // Keyed by accountId (LIN-1353) — established.accountId was just set by
            // establishAccount above. modelId lives at the workspace level (LIN-283)
            // — no session hydration here.
            if (userPreferencesStore) {
              const savedPrefs = await userPreferencesStore.getUserPreferences(established.accountId)
              applyUserPreferencesToSession(req.session, savedPrefs)
            }

            req.session.activeWorkspaceId = workspace.id
            await saveSession(req.session)
            // LIN-785: seed the pre-paint theme cookie from the rehydrated durable
            // preference so a returning/cross-device user's dark choice applies on the
            // very first page after login (the cookie is this device's transport).
            if (req.session.theme) setThemeCookie(res, req.session.theme)
            res.redirect(`/workspace/${encodeURIComponent(workspace.urlKey)}/`)
          } catch (err) {
            console.error('Post-regenerate callback error:', err)
            if (!res.headersSent) {
              res.status(500).send(renderErrorPage('Something Went Wrong', 'An unexpected error occurred during authentication. Please try again.', {
                action: 'Try again',
                actionUrl: '/auth/linear'
              }))
            }
          } finally {
            resolve()
          }
        })
      })
    } catch (err) {
      console.error('OAuth callback error:', err)
      const html = renderErrorPage('Something Went Wrong', 'An unexpected error occurred during authentication. Please try again.', {
        action: 'Try again',
        actionUrl: '/auth/linear'
      })
      res.status(500).send(html)
    }
  })

  /**
   * Decline a pending account merge (LIN-2233, L2.2). Byte-identical to today's
   * behavior: clears the pending offer, writes nothing to either account.
   */
  router.post('/auth/merge/decline', (req, res) => {
    delete req.session.pendingMerge
    req.session.save(() => {
      res.redirect('/')
    })
  })

  /**
   * Confirm a pending account merge (LIN-2233, L2.2 + LIN-2231 amendment A1).
   *
   * Re-checks freshness at confirm time, not just at offer time — the offer
   * page can sit open; the proof standard ("two identities each freshly
   * authenticated in one session") must hold when the merge actually writes,
   * not merely when it was proposed. Also re-checks that the confirming
   * session is still the SAME canonical account the pending merge was built
   * for, so a session swap mid-flow can't redirect a stale pending merge onto
   * a different account.
   *
   * On success: writes the merge (`mergeAccounts`), then completes the
   * identity link exactly as the non-conflict path would have — binds the
   * arriving workspace onto the canonical account and persists its owner
   * credential there. The arriving identity itself is NOT attached to
   * canonical's `identities[]` (`mergeAccounts` never touches `identities[]`
   * — it stays recorded on the merged account and resolves through
   * `mergedInto`, Ticket B's L3 chokepoint).
   */
  router.post('/auth/merge/confirm', async (req, res) => {
    const pending = req.session.pendingMerge
    if (!pending) {
      const html = renderErrorPage('Merge Expired', 'This merge confirmation has expired or was never started. Please try connecting the account again.', {
        action: 'Go to homepage',
        actionUrl: '/'
      })
      return res.status(400).send(html)
    }

    const stillFresh = isFreshlyAuthenticated(req.session, MERGE_CONFIRM_FRESH_AUTH_WINDOW_MS) &&
      (Date.now() - pending.createdAt) <= MERGE_CONFIRM_FRESH_AUTH_WINDOW_MS
    const sameSession = req.session.accountId === pending.canonicalAccountId

    if (!stillFresh || !sameSession) {
      delete req.session.pendingMerge
      const html = renderErrorPage('Merge Expired', 'This merge confirmation is no longer fresh. Please sign in again and retry connecting the account.', {
        action: 'Go to homepage',
        actionUrl: '/'
      })
      return res.status(400).send(html)
    }

    const merged = await accountStore.mergeAccounts(pending.canonicalAccountId, pending.mergedAccountId, { accountWorkspaceStore, mergeLogStore: accountMergeLogStore })
    if (!merged.ok) {
      delete req.session.pendingMerge
      const html = renderErrorPage('Merge Failed', 'Could not complete the merge. Please try again.', {
        action: 'Go to homepage',
        actionUrl: '/'
      })
      return res.status(500).send(html)
    }

    const canonicalAccountId = pending.canonicalAccountId
    try {
      upsertWorkspace(req.session, pending.workspace)
    } catch (limitError) {
      delete req.session.pendingMerge
      const html = renderErrorPage('Workspace Limit Reached', 'You have reached the maximum number of connected workspaces. Please remove one before adding another.', {
        action: 'Go to dashboard',
        actionUrl: '/'
      })
      return res.status(400).send(html)
    }
    await accountWorkspaceStore.bindAccountToWorkspace(canonicalAccountId, pending.workspace.id)
    await persistOwnerCredential(canonicalAccountId, pending.workspace, ownerCredentialStore, pending.refreshToken)

    // LIN-2231 amendment A2: canonicalize the CONFIRMING session explicitly,
    // even though it should already hold canonicalAccountId (canonical is, by
    // definition, the account already live in this session when the offer was
    // made). Cheap insurance, stated explicitly per the amendment. Other
    // still-live sessions of the MERGED account are a documented, accepted
    // tail — they keep resolving under the old id until they naturally expire
    // (≤24h); Ticket B's canonicalization chokepoint (resolveWorkspaceAccess)
    // is what actually closes that gap, not this route.
    req.session.accountId = canonicalAccountId

    delete req.session.pendingMerge
    await saveSession(req.session)

    if (pending.mode === 'add-source') {
      return res.redirect(`/workspace/${encodeURIComponent(pending.returnUrlKey)}/settings?provider_ok=linear`)
    }
    return res.redirect(`/workspace/${encodeURIComponent(pending.workspace.urlKey)}/`)
  })

  /**
   * Step 3: Logout
   * Destroys the session, logging the user out.
   */
  router.get('/logout', (req, res) => {
    // LIN-1507: capture accountId + workspaces BEFORE destroy() — the session
    // data is gone once the callback fires, so the eviction keys must be
    // derived now or not at all.
    const accountId = req.session.accountId
    const workspaces = req.session.workspaces || []
    for (const workspace of workspaces) {
      evictWorkspaceTokenPair(evictWorkspaceToken, workspace.urlKey, accountId)
    }

    req.session.destroy((err) => {
      if (err) {
        console.error('Session destroy error during logout:', err)
      }
      res.redirect('/')
    })
  })

  return router
}
