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
import { upsertWorkspace, saveSession, linkProvider, getActiveWorkspace, validateWorkspaceUrlKey } from '../lib/workspace.js'
import { calculateExpiresAt } from '../lib/token-refresh.js'
import { applyUserPreferencesToSession, setThemeCookie } from '../lib/user-preferences.js'
import { establishAccount } from '../lib/account-session.js'

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
 * @param {(key: string) => void} [options.evictWorkspaceToken] - LIN-1507: evicts a resolved-token cache entry by its pre-computed key (see `workspaceTokenCacheKey`). Not yet called here — wiring at the logout call site lands in a follow-up beat.
 * @returns {Router} Express router
 */
export function createAuthRoutes({ sessionStore, userPreferencesStore, provider, accountStore, accountWorkspaceStore, evictWorkspaceToken }) {
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

      linkProvider(workspace, authProvider.name, org.id, {
        token: data.access_token,
        refreshToken: data.refresh_token,
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
          // Strict conflict (LIN-1326, no auto-merge): the 2nd org's identity is
          // already owned by a DIFFERENT account. 409 with NOTHING written —
          // establishAccount returns before bindAccountToWorkspace, so no binding,
          // no account mutation, session.accountId unchanged, and NO session save on
          // this path. This 409 IS reachable (accountId is live) — the point of the
          // branch, unlike the login path's deliberately-unreachable 409 below.
          //
          // LIN-1351 review fix: RESTORE session.workspaces so org-2 (whose live
          // connection was just refused) does not linger and authorize
          // /workspace/:urlKey/* access via workspaceFromUrl, and clear the OAuth
          // state/intent so nothing leaks across this failed round-trip.
          req.session.workspaces = workspacesBeforeAddSource
          delete req.session.oauthState
          delete req.session.oauthIntent
          const html = renderErrorPage('Account Conflict', 'This Linear account is already linked to a different Harbour account. Please sign in with that account, or contact support.', {
            action: 'Go to homepage',
            actionUrl: '/'
          })
          return res.status(409).send(html)
        }

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

      // === Normal Linear login (mode:'new') — BYTE-IDENTICAL to the pre-LIN-1351 path ===
      // Preserve existing workspaces before regenerating session
      const existingWorkspaces = req.session.workspaces || []

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

            // LIN-1329 (Phase C): establish the durable account for this identity —
            // the single seam every sign-in path converges on. Identity scope is
            // Linear's viewer.id (the human), never the org — regenerate() just
            // wiped any prior session.accountId, so a returning user's existing
            // account is found by identity lookup, not session continuity.
            // Add/update workspace in session
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
              const html = renderErrorPage('Account Conflict', 'This Linear account is already linked to a different Harbour account. Please sign in with that account, or contact support.', {
                action: 'Go to homepage',
                actionUrl: '/'
              })
              return res.status(409).send(html)
            }

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
   * Step 3: Logout
   * Destroys the session, logging the user out.
   */
  router.get('/logout', (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        console.error('Session destroy error during logout:', err)
      }
      res.redirect('/')
    })
  })

  return router
}
