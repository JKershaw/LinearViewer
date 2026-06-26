/**
 * GitHub auth routes (LIN-541) — the GitHub consumer of the LIN-562
 * provider-binding seam, migrated to the GitHub App installation flow (LIN-703).
 *
 * GitHub login is a TWO-step flow, which is why it is its own router rather than
 * a reuse of the Linear-only routes/auth.js:
 *   1. /auth/github           → redirect to the GitHub App installation page
 *                               (the user picks which repos the App may access)
 *   2. /auth/github/callback  → mint an installation access token from the
 *                               returned `installation_id`, then show a repo
 *                               picker (a GitHub issues binding is scoped to one
 *                               `owner/name` repo)
 *   3. POST /auth/github/link → write the binding via linkProvider and land in
 *                               the workspace
 *
 * Both entry points (login-page "Continue with GitHub" and settings "Add a
 * source") drive the SAME routes, differing only by the server-side intent
 * (`mode`) carried in the session — never encoded into the `state`, which stays
 * an opaque CSRF nonce (the LIN-562 pattern).
 */
import crypto from 'crypto'
import { Router } from 'express'
import { getProvider } from '../lib/providers/registry.js'
import { renderErrorPage, renderGitHubRepoSelectPage } from '../lib/render-pages.js'
import {
  upsertWorkspace,
  saveSession,
  linkProvider,
  getActiveWorkspace,
  getWorkspaceByUrlKey,
  validateWorkspaceUrlKey,
} from '../lib/workspace.js'

// GitHub App config the install flow needs (LIN-703 migration): the App's id +
// private key (to mint the App JWT / installation token) and its slug (to build
// the installation URL in beginAuth). This replaces the OAuth
// client_id/secret/redirect_uri the code→token exchange used — the App flow no
// longer reads them, so the "not configured" guard now gates on the App vars.
const APP_ENV_VARS = ['GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY', 'GITHUB_APP_SLUG']

// A GitHub issues binding's scope is an `owner/name` repo slug. Validate the
// shape of the picked repo before writing it as a binding scope.
const REPO_SLUG_REGEX = /^[\w.-]+\/[\w.-]+$/

/**
 * Convert GitHub's installation-token expiry (`expires_at`, an ISO-8601 string,
 * ~1h out) to the ms-epoch the token-refresh middleware compares against
 * `Date.now()` (server.js `ensureValidToken`). This replaces the OAuth-App
 * `Number.MAX_SAFE_INTEGER` never-expires stamp (LIN-711): GitHub App
 * installation tokens DO expire, so the binding must carry a real expiry.
 *
 * A missing/unparseable expiry is a hard error, never a silent MAX fallback —
 * resurrecting never-expires is exactly what this surface removes. The throw is
 * caught by the link handler's try/catch and surfaced as an auth failure.
 *
 * @param {string} expiresAt - GitHub's raw `expires_at` ISO string.
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
 * Create the GitHub OAuth routes.
 * @param {Object} options
 * @param {Object} [options.sessionStore] - Session store with cleanup() (optional; mirrors Linear router shape).
 * @param {Object} options.provider - The GitHub provider instance (injected by GitHubProvider.getAuthRouter).
 * @returns {Router} Express router
 */
export function createGitHubAuthRoutes({ sessionStore, provider } = {}) {
  const router = Router()

  function getMissingAppVars() {
    return APP_ENV_VARS.filter(v => !process.env[v])
  }

  function notConfigured(res) {
    const missing = getMissingAppVars()
    return res.status(503).send(renderErrorPage(
      'GitHub App Not Configured',
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
    if (getMissingAppVars().length > 0) return notConfigured(res)
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
   * Step 2: Handle the GitHub App installation callback (LIN-709 — surface 3 of
   * the LIN-703 App migration). The inbound is `installation_id` + `setup_action`,
   * NOT an OAuth `code`: the user has just installed/updated the App and picked
   * which repos it may access. We mint an installation access token from
   * `installation_id` (the surface-1 helper) and look up the installation's
   * `account` for identity — replacing the old code→user-token exchange and the
   * `/user` viewer (an installation token cannot read `/user`).
   *
   * The LIN-541 intent carry is preserved unchanged: `mode`/`workspaceUrlKey`
   * round-trip via the session, and `state` stays an opaque CSRF nonce (never
   * repurposed to carry intent). The acquired token + identity are held in
   * session (`githubPending`) until the user picks a repo (POST .../link).
   */
  router.get('/auth/github/callback', async (req, res) => {
    if (getMissingAppVars().length > 0) return notConfigured(res)

    // App-flow inbound: `installation_id` + `setup_action`. An ALREADY-INSTALLED
    // App instead round-trips an OAuth `code` (LIN-728): GitHub re-issues no
    // `installation_id` because there is nothing to install, so the re-bind path
    // keys off `code`.
    const { installation_id: installationId, setup_action: setupAction, code, state, error } = req.query

    if (error) {
      const message = error === 'access_denied'
        ? 'You cancelled the GitHub App installation request.'
        : `GitHub App installation failed: ${error}`
      return res.status(400).send(renderErrorPage('Installation Cancelled', message, {
        action: 'Try again', actionUrl: '/auth/github'
      }))
    }

    // `state` stays the opaque CSRF nonce minted by /auth/github — the SAME guard
    // as the OAuth flow. Intent is read from the session, never decoded from
    // `state` (LIN-562).
    if (!state || state !== req.session.oauthState) {
      return res.status(400).send(renderErrorPage('Session Expired', 'Your GitHub sign-in session expired or was invalid. Please try again.', {
        action: 'Try again', actionUrl: '/auth/github'
      }))
    }

    const intent = req.session.oauthIntent || {}
    const mode = intent.mode === 'add-source' ? 'add-source' : 'new'

    // ALREADY-INSTALLED re-bind path (LIN-728). No fresh `installation_id`, but an
    // OAuth `code` is present: the App is already installed, so GitHub round-trips
    // a user-to-server `code` instead of an install event. Exchange it for a user
    // token, enumerate the user's installations + repos, and render the SAME repo
    // picker. The user token is DISCOVERY-ONLY — it is never stored; the link step
    // mints an installation token for the chosen repo (the LIN-711 binding shape).
    if (!installationId && code) {
      let userToken
      try {
        const tokenBag = await provider.completeAuth(code)
        userToken = tokenBag.access_token
      } catch (authError) {
        console.error('GitHub re-bind code exchange error:', authError)
        return res.status(400).send(renderErrorPage('Authentication Failed', 'Could not complete authentication with GitHub. Please try again.', {
          action: 'Try again', actionUrl: '/auth/github'
        }))
      }

      let reboundable
      try {
        reboundable = await provider.listReboundableRepos(userToken)
      } catch (fetchError) {
        console.error('Failed to enumerate GitHub installations for re-bind:', fetchError)
        return res.status(500).send(renderErrorPage('Connection Error', 'Could not fetch your repositories from GitHub. Please try again.', {
          action: 'Try again', actionUrl: '/auth/github'
        }))
      }

      // Stash a repo->installationId map (NOT the user token, NOT a per-repo
      // credential): the link step resolves the chosen repo's installation
      // server-side from this map and mints the installation token then, so a
      // client can never assert which installation a repo belongs to. The LIN-541
      // `mode`/`workspaceUrlKey` carry rides along exactly as the install branch.
      const repoInstallations = {}
      for (const r of reboundable) repoInstallations[r.slug] = String(r.installationId)
      const pending = { rebind: true, mode, repoInstallations }
      if (intent.workspaceUrlKey) pending.workspaceUrlKey = intent.workspaceUrlKey
      req.session.githubPending = pending
      return req.session.save(() => {
        res.send(renderGitHubRepoSelectPage(reboundable, { mode }))
      })
    }

    // No installation id means the install did not complete on GitHub's side —
    // most commonly `setup_action=request` (an org member asked an admin to
    // approve the App, which is therefore not yet installed). There is nothing to
    // mint a token from, so steer the user rather than 500 on a missing id.
    if (!installationId) {
      const message = setupAction === 'request'
        ? 'Your GitHub App installation needs an organization admin to approve it. Once approved, sign in again.'
        : 'The GitHub App installation did not complete. Please try again.'
      return res.status(400).send(renderErrorPage('Installation Incomplete', message, {
        action: 'Try again', actionUrl: '/auth/github'
      }))
    }

    try {
      // Acquire the installation credential + identity. provider.completeInstallation
      // mints an installation access token from installation_id (the surface-1
      // helper) and resolves the installation's `account` for identity — replacing
      // the old completeAuth(code) user-token exchange and the `/user` viewer (an
      // installation token cannot read `/user`). Driving it through the provider
      // keeps the route's acquisition seam consistent with beginAuth/listRepos.
      let creds
      try {
        creds = await provider.completeInstallation(installationId)
      } catch (mintError) {
        console.error('GitHub App installation-token mint error:', mintError)
        return res.status(400).send(renderErrorPage('Authentication Failed', 'Could not complete authentication with GitHub. Please try again.', {
          action: 'Try again', actionUrl: '/auth/github'
        }))
      }

      // Repos come from the installation now (LIN-710): listRepos reads
      // /installation/repositories with the installation token, so the picker is
      // constrained to exactly the repos selected at install time.
      let repos
      try {
        repos = await provider.listRepos(creds.token)
      } catch (fetchError) {
        console.error('Failed to fetch installation repositories from GitHub:', fetchError)
        return res.status(500).send(renderErrorPage('Connection Error', 'Could not fetch your repositories from GitHub. Please try again.', {
          action: 'Try again', actionUrl: '/auth/github'
        }))
      }

      // Hold the installation token + identity until the user picks a repo. The
      // repo selection completes the binding (POST /auth/github/link). `installationId`
      // is the re-mint key the link step now persists on the binding (LIN-711), and
      // `tokenExpiresAt` (GitHub's raw `expires_at` ISO string) rides along so the
      // link step can stamp the binding with the real ms expiry rather than the old
      // OAuth-App never-expires MAX. The add-source target workspace (if any) rides
      // along too so the link binds onto the viewed workspace, not the active one (LIN-541).
      const pending = { token: creds.token, mode, login: creds.login, userId: creds.userId, installationId: String(installationId), tokenExpiresAt: creds.tokenExpiresAt }
      if (intent.workspaceUrlKey) pending.workspaceUrlKey = intent.workspaceUrlKey
      req.session.githubPending = pending
      req.session.save(() => {
        res.send(renderGitHubRepoSelectPage(repos, { mode, login: creds.login }))
      })
    } catch (err) {
      console.error('GitHub App callback error:', err)
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
    // Two pending shapes converge here: the install branch already minted an
    // installation `token`; the re-bind branch (LIN-728) carries only a
    // repo->installationId map (`rebind`) and mints the token at link time.
    if (!pending || (!pending.token && !pending.rebind)) {
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

    try {
      // Resolve the binding credential. The install branch already holds the
      // minted installation token + identity in `pending`. The re-bind branch
      // (LIN-728) holds only a repo->installationId map: resolve the chosen repo's
      // installation server-side (a client-supplied installation is never trusted)
      // and mint the installation token NOW via the same completeInstallation seam.
      // EITHER WAY the persisted credential is an installation token, so re-mint
      // (LIN-712) keeps working — the user token is never stored.
      let creds
      if (pending.rebind) {
        const installationId = pending.repoInstallations?.[repo]
        if (!installationId) {
          return res.status(400).send(renderErrorPage('Invalid Repository', 'That repository is not one of your installed GitHub repositories. Please pick one from the list.', {
            action: 'Try again', actionUrl: '/auth/github'
          }))
        }
        creds = await provider.completeInstallation(installationId)
      } else {
        creds = pending
      }

      // GitHub App binding shape (LIN-711): persist `installationId` (the re-mint
      // key) and stamp the binding with the real installation-token expiry in ms,
      // dropping the old OAuth-App `Number.MAX_SAFE_INTEGER` never-expires stamp.
      // installationExpiryMs throws on a missing/unparseable expiry (never a silent
      // MAX fallback); kept inside this try so it renders the clean error page below
      // rather than escaping the handler.
      // SHARED BOUNDARY: a real (~1h) expiry means the refresh middleware
      // (server.js `ensureValidToken`) will now consider this binding stale, but a
      // GitHub binding carries no `refreshToken`, so provider-aware re-minting from
      // `installationId` is deliberately NOT wired here — that is LIN-712 (surface 6),
      // which this surface feeds. Until it lands, this binding is reachable only when
      // GITHUB_APP_* is configured (not in production), so no live flow regresses.
      const tokenExpiresAt = installationExpiryMs(creds.tokenExpiresAt)
      const credentials = { installationId: creds.installationId, token: creds.token, tokenExpiresAt }

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
      const workspaceId = `github:${creds.userId}`
      const existing = (req.session.workspaces || []).find(w => w.id === workspaceId)
      if (existing) {
        linkProvider(existing, provider.name, repo, credentials)
        req.session.activeWorkspaceId = existing.id
        delete req.session.githubPending
        await saveSession(req.session)
        return res.redirect(`/workspace/${encodeURIComponent(existing.urlKey)}/`)
      }

      const urlKey = validateWorkspaceUrlKey(creds.login) ? creds.login : `gh-${creds.userId}`
      const workspace = {
        id: workspaceId,
        name: creds.login,
        urlKey,
        addedAt: Date.now(),
        // Real installation-token expiry, mirroring the binding (LIN-711); the
        // active-binding scalar mirror in linkProvider overwrites this with the
        // same value, but stamp it explicitly so the workspace is never momentarily
        // marked never-expires.
        tokenExpiresAt,
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
