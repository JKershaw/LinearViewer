/**
 * OAuth PKCE authentication routes for OpenRouter.
 * Implements PKCE flow:
 * 1. /auth/openrouter - Initiates OAuth by redirecting to OpenRouter
 * 2. /auth/openrouter/callback - Exchanges code for API key
 * 3. /auth/openrouter/disconnect - Removes stored API key
 */
import crypto from 'crypto'
import { Router } from 'express'
import { renderErrorPage } from '../lib/render.js'
import { saveSession, getActiveWorkspace } from '../lib/workspace.js'

/**
 * Generate a cryptographically secure code verifier for PKCE
 * @returns {string} Base64url-encoded random string
 */
function generateCodeVerifier() {
  return crypto.randomBytes(32).toString('base64url')
}

/**
 * Create SHA-256 code challenge from verifier (S256 method)
 * @param {string} verifier - The code verifier
 * @returns {Promise<string>} Base64url-encoded SHA-256 hash
 */
async function createCodeChallenge(verifier) {
  const encoder = new TextEncoder()
  const data = encoder.encode(verifier)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Buffer.from(hash).toString('base64url')
}

/**
 * Create OpenRouter auth routes.
 * @returns {Router} Express router
 */
export function createOpenRouterAuthRoutes() {
  const router = Router()

  /**
   * Step 1: Initiate PKCE OAuth flow
   * Generates code verifier/challenge, stores verifier in session,
   * and redirects user to OpenRouter's auth page.
   * Requires Linear authentication first.
   */
  router.get('/auth/openrouter', async (req, res) => {
    // Require Linear authentication before connecting OpenRouter
    const workspace = getActiveWorkspace(req.session)
    if (!workspace) {
      return res.redirect('/')
    }

    // Generate PKCE code verifier and challenge
    const codeVerifier = generateCodeVerifier()
    const codeChallenge = await createCodeChallenge(codeVerifier)

    // Store code verifier in session for later exchange
    req.session.openRouterCodeVerifier = codeVerifier

    // Build callback URL from environment or derive from request
    const callbackUrl = process.env.OPENROUTER_REDIRECT_URI ||
      `${req.protocol}://${req.get('host')}/auth/openrouter/callback`

    const params = new URLSearchParams({
      callback_url: callbackUrl,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256'
    })

    req.session.save(() => {
      res.redirect(`https://openrouter.ai/auth?${params}`)
    })
  })

  /**
   * Step 2: Handle OAuth callback
   * Exchanges authorization code for API key using stored code verifier.
   * Requires Linear authentication.
   */
  router.get('/auth/openrouter/callback', async (req, res) => {
    // Require Linear authentication
    const workspace = getActiveWorkspace(req.session)
    if (!workspace) {
      return res.redirect('/')
    }

    const { code } = req.query
    const codeVerifier = req.session.openRouterCodeVerifier

    // Validate we have the required data
    if (!code) {
      const html = renderErrorPage('Authorization Failed', 'No authorization code received from OpenRouter.', {
        action: 'Try again',
        actionUrl: '/auth/openrouter'
      })
      return res.status(400).send(html)
    }

    if (!codeVerifier) {
      const html = renderErrorPage('Session Expired', 'Your session expired or was invalid. Please try again.', {
        action: 'Try again',
        actionUrl: '/auth/openrouter'
      })
      return res.status(400).send(html)
    }

    try {
      // Exchange authorization code for API key
      const response = await fetch('https://openrouter.ai/api/v1/auth/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          code_verifier: codeVerifier,
          code_challenge_method: 'S256'
        })
      })

      const data = await response.json()

      if (!response.ok) {
        console.error('OpenRouter token exchange error:', data)
        const html = renderErrorPage('Authentication Failed', 'Could not complete authentication with OpenRouter. Please try again.', {
          action: 'Try again',
          actionUrl: '/auth/openrouter'
        })
        return res.status(400).send(html)
      }

      if (!data.key) {
        console.error('OpenRouter response missing key:', data)
        const html = renderErrorPage('Authentication Failed', 'Invalid response from OpenRouter. Please try again.', {
          action: 'Try again',
          actionUrl: '/auth/openrouter'
        })
        return res.status(400).send(html)
      }

      // Store API key in session (permanent key, no expiry)
      req.session.openRouterApiKey = data.key
      // Clean up code verifier
      delete req.session.openRouterCodeVerifier

      await saveSession(req.session)

      // Redirect back to the fancy page (where OpenRouter features are used)
      res.redirect('/fancy')
    } catch (err) {
      console.error('OpenRouter OAuth callback error:', err)
      const html = renderErrorPage('Something Went Wrong', 'An unexpected error occurred during authentication. Please try again.', {
        action: 'Try again',
        actionUrl: '/auth/openrouter'
      })
      res.status(500).send(html)
    }
  })

  /**
   * Step 3: Disconnect OpenRouter
   * Removes the stored API key from the session.
   * Requires Linear authentication.
   */
  router.post('/auth/openrouter/disconnect', async (req, res) => {
    // Require Linear authentication
    const workspace = getActiveWorkspace(req.session)
    if (!workspace) {
      return res.redirect('/')
    }

    delete req.session.openRouterApiKey
    await saveSession(req.session)
    res.redirect('/settings')
  })

  return router
}
