/**
 * GitHub Projects auth routes (LIN-560 Session 2) — the GitHub-Projects consumer
 * of the LIN-562 provider-binding seam, on the shared GitHub App installation flow
 * (LIN-703). Sibling to routes/github-auth.js: same two-step shape, but the picker
 * chooses a Projects v2 BOARD (`org/projectNumber`) rather than an `owner/name` repo.
 *
 *   1. /auth/github-projects           → redirect to the shared GitHub App
 *                                         installation page (the user grants access;
 *                                         the App must hold the Projects (read)
 *                                         permission — the operational prerequisite)
 *   2. /auth/github-projects/callback  → mint an installation access token from the
 *                                         returned `installation_id`, list the
 *                                         installation account's Projects v2 boards,
 *                                         and show a board picker
 *   3. POST /auth/github-projects/link → write the binding via linkProvider, scoped
 *                                         to the chosen `org/projectNumber`
 *
 * Both entry points (a future login button and the settings "Add a source") drive
 * the SAME routes, differing only by the server-side `mode` carried in the session —
 * never encoded into `state`, which stays an opaque CSRF nonce (the LIN-562 pattern).
 *
 * Scope vs Issues: this V1 covers the INSTALL path, exactly as Issues shipped its
 * picker in LIN-541 before the already-installed re-bind (LIN-728) landed as a
 * separate follow-up. When the shared App is ALREADY installed, GitHub round-trips
 * an OAuth `code` (no `installation_id`); rather than 500, the callback steers the
 * user with a clear message. The board-list re-bind across installations is the
 * Projects analogue of LIN-728 and is a named follow-up.
 */
import crypto from 'crypto'
import { Router } from 'express'
import { renderErrorPage, renderGitHubProjectSelectPage } from '../lib/render-pages.js'
import {
  upsertWorkspace,
  saveSession,
  linkProvider,
  getActiveWorkspace,
  getWorkspaceByUrlKey,
  validateWorkspaceUrlKey,
} from '../lib/workspace.js'

// The shared GitHub App config the install flow needs (LIN-703): the App's id +
// private key (to mint the installation token) and its slug (to build the install
// URL in beginAuth). Same App as Issues — the gate is identical.
const APP_ENV_VARS = ['GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY', 'GITHUB_APP_SLUG']

// A Projects binding's scope is an `org/projectNumber` board slug: an owner login
// followed by a NUMERIC board number. Validate the shape before writing it.
const BOARD_SLUG_REGEX = /^[\w.-]+\/\d+$/

/**
 * Convert GitHub's installation-token expiry (`expires_at`, ISO-8601, ~1h out) to
 * the ms-epoch the token-refresh middleware compares against `Date.now()`. Mirrors
 * routes/github-auth.js `installationExpiryMs`: a missing/unparseable expiry is a
 * hard error, never a silent never-expires fallback. Caught by the link handler's
 * try/catch and surfaced as a clean auth-failure page.
 * @param {string} expiresAt
 * @returns {number} expiry as ms since epoch.
 */
function installationExpiryMs(expiresAt) {
  const ms = Date.parse(expiresAt)
  if (!Number.isFinite(ms)) {
    throw new Error(`GitHub App: invalid installation token expiry: ${expiresAt}`)
  }
  return ms
}

/**
 * Create the GitHub Projects auth routes.
 * @param {Object} options
 * @param {Object} [options.sessionStore] - Session store with cleanup() (optional).
 * @param {Object} options.provider - The GitHubProjects provider (injected by getAuthRouter).
 * @returns {Router} Express router
 */
export function createGitHubProjectsAuthRoutes({ sessionStore, provider } = {}) {
  const router = Router()

  function getMissingAppVars() {
    return APP_ENV_VARS.filter(v => !process.env[v])
  }

  function notConfigured(res) {
    const missing = getMissingAppVars()
    return res.status(503).send(renderErrorPage(
      'GitHub App Not Configured',
      `GitHub Projects is not available. Missing environment variables: ${missing.join(', ')}. See .env.example for setup instructions.`
    ))
  }

  /**
   * Step 1: Initiate the install flow. `mode` distinguishes the two entry points —
   * `add-source` (settings, link onto the viewed workspace) vs `new` (find-or-create
   * the GitHub account container). It lives in the session, never in `state`.
   */
  router.get('/auth/github-projects', async (req, res) => {
    if (getMissingAppVars().length > 0) return notConfigured(res)
    if (sessionStore?.cleanup) await sessionStore.cleanup()

    const mode = req.query.mode === 'add-source' ? 'add-source' : 'new'
    const state = crypto.randomUUID()
    req.session.oauthState = state
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
   * Step 2: Handle the install callback. The inbound is `installation_id` +
   * `setup_action`: the user has just installed/configured the App. We mint an
   * installation access token from `installation_id` and look up the installation's
   * `account` for the board owner + identity, then list the account's Projects v2
   * boards for the picker. The token + identity are held in session
   * (`githubProjectsPending`) until the user picks a board (POST .../link).
   *
   * `state` stays an opaque CSRF nonce; intent is read from the session.
   */
  router.get('/auth/github-projects/callback', async (req, res) => {
    if (getMissingAppVars().length > 0) return notConfigured(res)

    const { installation_id: installationId, setup_action: setupAction, code, state, error } = req.query

    if (error) {
      const message = error === 'access_denied'
        ? 'You cancelled the GitHub App installation request.'
        : `GitHub App installation failed: ${error}`
      return res.status(400).send(renderErrorPage('Installation Cancelled', message, {
        action: 'Try again', actionUrl: '/auth/github-projects'
      }))
    }

    if (!state || state !== req.session.oauthState) {
      return res.status(400).send(renderErrorPage('Session Expired', 'Your GitHub sign-in session expired or was invalid. Please try again.', {
        action: 'Try again', actionUrl: '/auth/github-projects'
      }))
    }

    const intent = req.session.oauthIntent || {}
    const mode = intent.mode === 'add-source' ? 'add-source' : 'new'

    // ALREADY-INSTALLED case: no fresh `installation_id`, an OAuth `code` instead.
    // The shared App is already installed (commonly for Issues), so GitHub round-
    // trips a `code` with nothing to install. Re-binding a board across existing
    // installations is the Projects analogue of LIN-728 (a named follow-up); for
    // now steer the user clearly rather than 500 on a missing id.
    if (!installationId && code) {
      return res.status(400).send(renderErrorPage(
        'App Already Installed',
        'The Harbour GitHub App is already installed on your account. Re-selecting a Projects board on an existing installation is coming soon — for now, open the App installation settings on GitHub, add or reconfigure an installation, and you will be returned to the board picker.',
        { action: 'Try again', actionUrl: '/auth/github-projects' }
      ))
    }

    // No installation id (e.g. setup_action=request — an org member asked an admin
    // to approve the App). Nothing to mint a token from; steer rather than 500.
    if (!installationId) {
      const message = setupAction === 'request'
        ? 'Your GitHub App installation needs an organization admin to approve it. Once approved, sign in again.'
        : 'The GitHub App installation did not complete. Please try again.'
      return res.status(400).send(renderErrorPage('Installation Incomplete', message, {
        action: 'Try again', actionUrl: '/auth/github-projects'
      }))
    }

    try {
      // Acquire the installation credential + account identity (the shared App
      // helpers, via the provider). `login` is the board owner the picker lists.
      let creds
      try {
        creds = await provider.completeInstallation(installationId)
      } catch (mintError) {
        console.error('GitHub Projects installation-token mint error:', mintError)
        return res.status(400).send(renderErrorPage('Authentication Failed', 'Could not complete authentication with GitHub. Please try again.', {
          action: 'Try again', actionUrl: '/auth/github-projects'
        }))
      }

      // List the installation account's Projects v2 boards for the picker. An empty
      // list (rendered as the "Projects permission" hint) is NOT an error — the App
      // may simply lack the Projects (read) permission.
      let boards
      try {
        boards = await provider.listBoards(creds.token, creds.login)
      } catch (fetchError) {
        console.error('Failed to list GitHub Projects boards:', fetchError)
        return res.status(500).send(renderErrorPage('Connection Error', 'Could not fetch your project boards from GitHub. Please try again.', {
          action: 'Try again', actionUrl: '/auth/github-projects'
        }))
      }

      // Hold the installation token + identity until the user picks a board. The
      // binding shape (LIN-711) needs `installationId` (the re-mint key) and the raw
      // `expires_at` (link converts to ms). The add-source target workspace rides
      // along so the link binds onto the viewed workspace, not the active one.
      const pending = { token: creds.token, mode, login: creds.login, userId: creds.userId, installationId: String(installationId), tokenExpiresAt: creds.tokenExpiresAt }
      if (intent.workspaceUrlKey) pending.workspaceUrlKey = intent.workspaceUrlKey
      req.session.githubProjectsPending = pending
      req.session.save(() => {
        res.send(renderGitHubProjectSelectPage(boards, { mode, login: creds.login }))
      })
    } catch (err) {
      console.error('GitHub Projects callback error:', err)
      res.status(500).send(renderErrorPage('Something Went Wrong', 'An unexpected error occurred during GitHub authentication. Please try again.', {
        action: 'Try again', actionUrl: '/auth/github-projects'
      }))
    }
  })

  /**
   * Step 3: Write the binding. `linkProvider(workspace, 'github-projects', board,
   * creds)` is the single seam both modes converge on (LIN-562) — they differ only
   * in WHICH container is linked: the viewed workspace (add-source) vs a find-or-
   * created GitHub account container (new). The container id is `github:<userId>`
   * so a Projects board and an Issues repo for the SAME GitHub account converge on
   * one workspace as coexisting bindings (LIN-544), rather than a duplicate.
   */
  router.post('/auth/github-projects/link', async (req, res) => {
    const pending = req.session.githubProjectsPending
    if (!pending || !pending.token) {
      return res.status(400).send(renderErrorPage('Session Expired', 'Your GitHub sign-in session expired. Please start again.', {
        action: 'Connect GitHub Projects', actionUrl: '/auth/github-projects'
      }))
    }

    const board = String(req.body.board || '').trim()
    if (!BOARD_SLUG_REGEX.test(board)) {
      return res.status(400).send(renderErrorPage('Invalid Project Board', 'That does not look like a valid "org/projectNumber" board. Please pick a board.', {
        action: 'Try again', actionUrl: '/auth/github-projects'
      }))
    }

    try {
      // GitHub App binding shape (LIN-711): persist `installationId` (the re-mint
      // key) and stamp the binding with the real installation-token expiry in ms.
      // installationExpiryMs throws on a missing/unparseable expiry (kept inside the
      // try so it renders the clean error page below).
      const tokenExpiresAt = installationExpiryMs(pending.tokenExpiresAt)
      const credentials = { installationId: pending.installationId, token: pending.token, tokenExpiresAt }

      if (pending.mode === 'add-source') {
        // Link onto the VIEWED workspace (its urlKey rode through the session
        // intent), falling back to the active workspace when none was carried.
        const workspace =
          (pending.workspaceUrlKey && getWorkspaceByUrlKey(req.session, pending.workspaceUrlKey)) ||
          getActiveWorkspace(req.session)
        if (!workspace) {
          return res.status(400).send(renderErrorPage('No Active Workspace', 'Could not find a workspace to add this source to.', {
            action: 'Go to homepage', actionUrl: '/'
          }))
        }
        linkProvider(workspace, provider.name, board, credentials)
        delete req.session.githubProjectsPending
        await saveSession(req.session)
        return res.redirect(`/workspace/${encodeURIComponent(workspace.urlKey)}/settings?provider_ok=github-projects`)
      }

      // New-container login: find-or-create the GitHub *account* container keyed by
      // identity, so a Projects board (or a second board, or an Issues repo) for the
      // same account adds a binding rather than clobbering the first.
      const workspaceId = `github:${pending.userId}`
      const existing = (req.session.workspaces || []).find(w => w.id === workspaceId)
      if (existing) {
        linkProvider(existing, provider.name, board, credentials)
        req.session.activeWorkspaceId = existing.id
        delete req.session.githubProjectsPending
        await saveSession(req.session)
        return res.redirect(`/workspace/${encodeURIComponent(existing.urlKey)}/`)
      }

      const urlKey = validateWorkspaceUrlKey(pending.login) ? pending.login : `gh-${pending.userId}`
      const workspace = {
        id: workspaceId,
        name: pending.login,
        urlKey,
        addedAt: Date.now(),
        tokenExpiresAt,
      }
      linkProvider(workspace, provider.name, board, credentials)

      const existingWorkspaces = req.session.workspaces || []
      req.session.regenerate(async (regenerateErr) => {
        if (regenerateErr) {
          console.error('GitHub Projects session regeneration error:', regenerateErr)
          return res.status(500).send(renderErrorPage('Session Error', 'Could not create a secure session. Please try again.', {
            action: 'Try again', actionUrl: '/auth/github-projects'
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
      console.error('GitHub Projects link error:', err)
      res.status(500).send(renderErrorPage('Something Went Wrong', 'Could not link your GitHub project board. Please try again.', {
        action: 'Try again', actionUrl: '/auth/github-projects'
      }))
    }
  })

  return router
}
