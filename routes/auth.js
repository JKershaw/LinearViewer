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
import { upsertWorkspace, saveSession, linkProvider } from '../lib/workspace.js'
import { calculateExpiresAt } from '../lib/token-refresh.js'
import { applyUserPreferencesToSession } from '../lib/user-preferences.js'

/**
 * Create auth routes with required dependencies.
 * @param {Object} options
 * @param {Object} options.sessionStore - Session store with cleanup() method
 * @param {Object} options.userPreferencesStore - User preferences store for loading saved preferences
 * @param {Object} [options.provider] - The provider this auth router serves. Injected by the
 *   mounting provider (LinearProvider.getAuthRouter passes `this`); falls back to the Linear
 *   provider as a documented legacy default for direct constructions (LIN-561).
 * @returns {Router} Express router
 */
export function createAuthRoutes({ sessionStore, userPreferencesStore, provider }) {
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
    req.session.oauthState = state
    req.session.oauthIntent = { mode: 'new', provider: authProvider.name }

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
      linkProvider(workspace, authProvider.name, org.id, {
        token: data.access_token,
        refreshToken: data.refresh_token,
        tokenExpiresAt: calculateExpiresAt(data.expires_in || 86400)
      })

      // Preserve existing workspaces before regenerating session
      const existingWorkspaces = req.session.workspaces || []

      // Regenerate session ID to prevent session fixation attacks
      req.session.regenerate(async (regenerateErr) => {
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

        // Store Linear user ID for preference persistence
        req.session.linearUserId = viewer.id

        // Load saved user preferences and apply to session.
        // regenerate() wiped the session, so rehydrate every durable field
        // session readers rely on — features, northStarByWorkspace, and the
        // OpenRouter key (LIN-498: previously dropped here, wiping the user's
        // OpenRouter connection on routine re-auth / account / workspace switch).
        // modelId lives at the workspace level (LIN-283) — no session hydration here.
        if (userPreferencesStore) {
          const savedPrefs = await userPreferencesStore.getUserPreferences(viewer.id)
          applyUserPreferencesToSession(req.session, savedPrefs)
          // Seed the theme cookie so the pre-paint bootstrap themes a fresh-device
          // login before first paint, even with empty localStorage (LIN-756). Not
          // httpOnly — the inline bootstrap reads it via document.cookie.
          if (req.session.theme) {
            res.cookie('theme', req.session.theme, {
              maxAge: 1000 * 60 * 60 * 24 * 365,
              httpOnly: false,
              sameSite: 'lax'
            })
          }
        }

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

        req.session.activeWorkspaceId = workspace.id
        await saveSession(req.session)
        res.redirect(`/workspace/${encodeURIComponent(workspace.urlKey)}/`)
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
