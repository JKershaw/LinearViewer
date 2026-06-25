/**
 * GitHub OAuth routes (LIN-541) — the GitHub consumer of the LIN-562
 * provider-binding seam.
 *
 * GitHub login is a TWO-step flow, which is why it is its own router rather than
 * a reuse of the Linear-only routes/auth.js:
 *   1. /auth/github           → redirect to GitHub's OAuth authorize page
 *   2. /auth/github/callback  → exchange code for a token, then show a repo
 *                               picker (a GitHub issues binding is scoped to one
 *                               `owner/name` repo, which OAuth alone can't pick)
 *   3. POST /auth/github/link → write the binding via linkProvider and land in
 *                               the workspace
 *
 * Both entry points (login-page "Continue with GitHub" and settings "Add a
 * source") drive the SAME routes, differing only by the server-side intent
 * (`mode`) carried in the session — never encoded into the OAuth `state`, which
 * stays an opaque CSRF nonce (the LIN-562 pattern).
 */
import crypto from 'crypto'
import { Router } from 'express'
import { getProvider } from '../lib/providers/registry.js'
import { AuthExchangeError } from '../lib/providers/interface.js'
import { renderErrorPage, renderGitHubRepoSelectPage } from '../lib/render-pages.js'
import {
  upsertWorkspace,
  saveSession,
  linkProvider,
  getActiveWorkspace,
  getWorkspaceByUrlKey,
  validateWorkspaceUrlKey,
} from '../lib/workspace.js'

const OAUTH_ENV_VARS = ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'GITHUB_REDIRECT_URI']

// A GitHub issues binding's scope is an `owner/name` repo slug. Validate the
// shape of the picked repo before writing it as a binding scope.
const REPO_SLUG_REGEX = /^[\w.-]+\/[\w.-]+$/

/**
 * Create the GitHub OAuth routes.
 * @param {Object} options
 * @param {Object} [options.sessionStore] - Session store with cleanup() (optional; mirrors Linear router shape).
 * @param {Object} options.provider - The GitHub provider instance (injected by GitHubProvider.getAuthRouter).
 * @returns {Router} Express router
 */
export function createGitHubAuthRoutes({ sessionStore, provider } = {}) {
  const router = Router()

  function getMissingOAuthVars() {
    return OAUTH_ENV_VARS.filter(v => !process.env[v])
  }

  function notConfigured(res) {
    const missing = getMissingOAuthVars()
    return res.status(503).send(renderErrorPage(
      'GitHub OAuth Not Configured',
      `GitHub login is not available. Missing environment variables: ${missing.join(', ')}. See .env.example for setup instructions.`
    ))
  }

  /**
   * Step 1: Initiate the GitHub OAuth flow. `mode` distinguishes the two entry
   * points — `add-source` (settings, link onto the active workspace) vs `new`
   * (login page, find-or-create the GitHub account container). It lives in the
   * session, never in `state`.
   */
  router.get('/auth/github', async (req, res) => {
    if (getMissingOAuthVars().length > 0) return notConfigured(res)
    if (sessionStore?.cleanup) await sessionStore.cleanup()

    const mode = req.query.mode === 'add-source' ? 'add-source' : 'new'
    const state = crypto.randomUUID()
    req.session.oauthState = state
    // Intent lives server-side in the session, never in `state` (LIN-562). For
    // add-source, also carry the VIEWED workspace's urlKey so the link step binds
    // onto the workspace the user initiated from rather than the active one
    // (LIN-541). Only attach a validated urlKey; absence falls back to active.
    const intent = { mode, provider: provider.name }
    if (mode === 'add-source' && validateWorkspaceUrlKey(req.query.workspace)) {
      intent.workspaceUrlKey = req.query.workspace
    }
    req.session.oauthIntent = intent

    req.session.save(() => {
      res.redirect(provider.beginAuth({ state }))
    })
  })

  /**
   * Step 2: Handle the OAuth callback — validate state, exchange the code, fetch
   * the user + their repos, and render the repo picker. The acquired token and
   * intent are held in session (`githubPending`) until the user picks a repo.
   */
  router.get('/auth/github/callback', async (req, res) => {
    if (getMissingOAuthVars().length > 0) return notConfigured(res)

    const { code, state, error } = req.query

    if (error) {
      const message = error === 'access_denied'
        ? 'You cancelled the GitHub authorization request.'
        : `GitHub authorization failed: ${error}`
      return res.status(400).send(renderErrorPage('Authorization Cancelled', message, {
        action: 'Try again', actionUrl: '/auth/github'
      }))
    }

    if (!state || state !== req.session.oauthState) {
      return res.status(400).send(renderErrorPage('Session Expired', 'Your GitHub sign-in session expired or was invalid. Please try again.', {
        action: 'Try again', actionUrl: '/auth/github'
      }))
    }

    const intent = req.session.oauthIntent || {}
    const mode = intent.mode === 'add-source' ? 'add-source' : 'new'

    try {
      let tokenBag
      try {
        tokenBag = await provider.completeAuth(code)
      } catch (exchangeError) {
        if (exchangeError instanceof AuthExchangeError) {
          console.error('GitHub token exchange error:', exchangeError.detail)
          return res.status(400).send(renderErrorPage('Authentication Failed', 'Could not complete authentication with GitHub. Please try again.', {
            action: 'Try again', actionUrl: '/auth/github'
          }))
        }
        throw exchangeError
      }

      const token = tokenBag.access_token
      let viewer, repos
      try {
        [viewer, repos] = await Promise.all([
          provider.fetchViewer(token),
          provider.listRepos(token),
        ])
      } catch (fetchError) {
        console.error('Failed to fetch from GitHub:', fetchError)
        return res.status(500).send(renderErrorPage('Connection Error', 'Could not fetch your account information from GitHub. Please try again.', {
          action: 'Try again', actionUrl: '/auth/github'
        }))
      }

      // Hold the acquired token + identity until the user picks a repo. The repo
      // selection completes the binding (POST /auth/github/link). The add-source
      // target workspace (if any) rides along so the link step binds onto the
      // viewed workspace, not the active one (LIN-541).
      const pending = { token, mode, login: viewer.login, userId: viewer.id }
      if (intent.workspaceUrlKey) pending.workspaceUrlKey = intent.workspaceUrlKey
      req.session.githubPending = pending
      req.session.save(() => {
        res.send(renderGitHubRepoSelectPage(repos, { mode, login: viewer.login }))
      })
    } catch (err) {
      console.error('GitHub OAuth callback error:', err)
      res.status(500).send(renderErrorPage('Something Went Wrong', 'An unexpected error occurred during GitHub authentication. Please try again.', {
        action: 'Try again', actionUrl: '/auth/github'
      }))
    }
  })

  /**
   * Step 3: Write the binding. `linkProvider(workspace, 'github', repo, creds)`
   * is the single seam both modes converge on (LIN-562) — they differ only in
   * WHICH container is linked: the active workspace (add-source) vs a find-or-
   * created GitHub account container (new login).
   */
  router.post('/auth/github/link', async (req, res) => {
    const pending = req.session.githubPending
    if (!pending?.token) {
      return res.status(400).send(renderErrorPage('Session Expired', 'Your GitHub sign-in session expired. Please start again.', {
        action: 'Sign in with GitHub', actionUrl: '/auth/github'
      }))
    }

    const repo = String(req.body.repo || '').trim()
    if (!REPO_SLUG_REGEX.test(repo)) {
      return res.status(400).send(renderErrorPage('Invalid Repository', 'That does not look like a valid "owner/name" repository. Please pick a repository.', {
        action: 'Try again', actionUrl: '/auth/github'
      }))
    }

    // GitHub OAuth App tokens do not expire and carry no refresh token; a MAX
    // expiry makes the token-refresh middleware skip this workspace.
    const credentials = { token: pending.token, tokenExpiresAt: Number.MAX_SAFE_INTEGER }

    try {
      if (pending.mode === 'add-source') {
        // Link onto the VIEWED workspace the user initiated from — its urlKey was
        // carried through the OAuth round-trip in the session intent (LIN-541) —
        // not the session's ACTIVE workspace. For a multi-workspace user viewing A
        // while B is active, adding a source from A's settings must bind onto A.
        // Falls back to the active workspace when no target was carried (single-
        // workspace and legacy callers), preserving prior behavior.
        const workspace =
          (pending.workspaceUrlKey && getWorkspaceByUrlKey(req.session, pending.workspaceUrlKey)) ||
          getActiveWorkspace(req.session)
        if (!workspace) {
          return res.status(400).send(renderErrorPage('No Active Workspace', 'Could not find a workspace to add this source to.', {
            action: 'Go to homepage', actionUrl: '/'
          }))
        }
        linkProvider(workspace, provider.name, repo, credentials)
        delete req.session.githubPending
        await saveSession(req.session)
        return res.redirect(`/workspace/${encodeURIComponent(workspace.urlKey)}/settings?provider_ok=github`)
      }

      // New-container login: find-or-create the GitHub *account* container so a
      // second repo for the same account adds a binding rather than clobbering
      // the first (bindings are keyed by (provider, scope)). Identity is the
      // GitHub user; per-repo issues are bindings on it (LIN-544).
      const workspaceId = `github:${pending.userId}`
      const existing = (req.session.workspaces || []).find(w => w.id === workspaceId)
      if (existing) {
        linkProvider(existing, provider.name, repo, credentials)
        req.session.activeWorkspaceId = existing.id
        delete req.session.githubPending
        await saveSession(req.session)
        return res.redirect(`/workspace/${encodeURIComponent(existing.urlKey)}/`)
      }

      const urlKey = validateWorkspaceUrlKey(pending.login) ? pending.login : `gh-${pending.userId}`
      const workspace = {
        id: workspaceId,
        name: pending.login,
        urlKey,
        addedAt: Date.now(),
        tokenExpiresAt: Number.MAX_SAFE_INTEGER,
      }
      linkProvider(workspace, provider.name, repo, credentials)

      // Preserve existing workspaces across the fixation-preventing regenerate
      // (mirrors the Linear callback).
      const existingWorkspaces = req.session.workspaces || []
      req.session.regenerate(async (regenerateErr) => {
        if (regenerateErr) {
          console.error('GitHub session regeneration error:', regenerateErr)
          return res.status(500).send(renderErrorPage('Session Error', 'Could not create a secure session. Please try again.', {
            action: 'Try again', actionUrl: '/auth/github'
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
        req.session.activeWorkspaceId = workspace.id
        await saveSession(req.session)
        res.redirect(`/workspace/${encodeURIComponent(workspace.urlKey)}/`)
      })
    } catch (err) {
      console.error('GitHub link error:', err)
      res.status(500).send(renderErrorPage('Something Went Wrong', 'Could not link your GitHub repository. Please try again.', {
        action: 'Try again', actionUrl: '/auth/github'
      }))
    }
  })

  return router
}
