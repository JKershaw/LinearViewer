/**
 * OAuth 2.0 authentication routes for Linear.
 * Implements Authorization Code flow:
 * 1. /auth/linear - Initiates OAuth by redirecting to Linear
 * 2. /auth/callback - Exchanges code for access token
 * 3. /logout - Destroys session
 */
import crypto from 'crypto'
import { Router } from 'express'
import { fetchOrganization, fetchViewer } from '../lib/linear.js'
import { renderErrorPage } from '../lib/render.js'
import { upsertWorkspace, saveSession, updateWorkspaceTokens } from '../lib/workspace.js'

/**
 * Create auth routes with required dependencies.
 * @param {Object} options
 * @param {Object} options.sessionStore - Session store with cleanup() method
 * @param {Object} options.userPreferencesStore - User preferences store for loading saved preferences
 * @returns {Router} Express router
 */
export function createAuthRoutes({ sessionStore, userPreferencesStore }) {
  const router = Router()

  /**
   * Step 1: Initiate OAuth flow
   * Generates a CSRF-prevention state token, stores it in session,
   * and redirects user to Linear's OAuth authorization page.
   */
  router.get('/auth/linear', async (req, res) => {
    // Clean up expired sessions before proceeding
    await sessionStore.cleanup()

    // Generate random state token to prevent CSRF attacks
    const state = crypto.randomUUID()
    req.session.oauthState = state

    const params = new URLSearchParams({
      client_id: process.env.LINEAR_CLIENT_ID,
      redirect_uri: process.env.LINEAR_REDIRECT_URI,
      response_type: 'code',
      scope: 'read',
      state,
      prompt: 'consent'
    })

    req.session.save(() => {
      res.redirect(`https://linear.app/oauth/authorize?${params}`)
    })
  })

  /**
   * Step 2: Handle OAuth callback
   * Validates state, exchanges code for token, stores workspace in session.
   */
  router.get('/auth/callback', async (req, res) => {
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

    try {
      // Exchange authorization code for access token
      const response = await fetch('https://api.linear.app/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: process.env.LINEAR_CLIENT_ID,
          client_secret: process.env.LINEAR_CLIENT_SECRET,
          redirect_uri: process.env.LINEAR_REDIRECT_URI,
          code
        })
      })

      const data = await response.json()

      if (!response.ok) {
        console.error('Token exchange error:', data.error)
        const html = renderErrorPage('Authentication Failed', 'Could not complete authentication with Linear. Please try again.', {
          action: 'Try again',
          actionUrl: '/auth/linear'
        })
        return res.status(400).send(html)
      }

      // Fetch organization info and current user in parallel
      let org, viewer
      try {
        [org, viewer] = await Promise.all([
          fetchOrganization(data.access_token),
          fetchViewer(data.access_token)
        ])
      } catch (fetchError) {
        console.error('Failed to fetch from Linear:', fetchError)
        const html = renderErrorPage('Connection Error', 'Could not fetch workspace information from Linear. Please try again.', {
          action: 'Try again',
          actionUrl: '/auth/linear'
        })
        return res.status(500).send(html)
      }

      // Build workspace object
      const workspace = {
        id: org.id,
        name: org.name,
        urlKey: org.urlKey || org.name,
        addedAt: Date.now()
      }
      // Add token fields using helper (with default expires_in for safety)
      updateWorkspaceTokens(workspace, { ...data, expires_in: data.expires_in || 86400 })

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

        // Load saved user preferences and apply to session
        if (userPreferencesStore) {
          const savedPrefs = await userPreferencesStore.getUserPreferences(viewer.id)
          if (savedPrefs.modelId) {
            req.session.modelId = savedPrefs.modelId
          }
          // Future preferences can be loaded here (theme, language, etc.)
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
        res.redirect(`/workspace/${workspace.urlKey}/`)
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
