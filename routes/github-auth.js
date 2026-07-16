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
import { githubErrorDiagnostic } from '../lib/errors.js'
import { getMissingGitHubConfig, withTimeout, GITHUB_VIEWER_TIMEOUT_MS } from '../lib/providers/github/app-auth.js'
import { establishAccount } from '../lib/account-session.js'
import { applyUserPreferencesToSession } from '../lib/user-preferences.js'
import {
  upsertWorkspace,
  saveSession,
  linkProvider,
  getActiveWorkspace,
  getWorkspaceByUrlKey,
  validateWorkspaceUrlKey,
} from '../lib/workspace.js'

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
 * @param {import('../lib/account-store.js').AccountStore} options.accountStore - LIN-1329: find-or-create the durable account for the signing-in identity.
 * @param {import('../lib/account-workspace-store.js').AccountWorkspaceStore} options.accountWorkspaceStore - LIN-1329: bind the account to the workspace.
 * @param {Object} [options.userPreferencesStore] - LIN-1353: rehydrates durable preferences (features, theme, OpenRouter key, north star) onto the fresh-login regenerated session, mirroring routes/auth.js.
 * @returns {Router} Express router
 */
export function createGitHubAuthRoutes({ sessionStore, provider, accountStore, accountWorkspaceStore, userPreferencesStore } = {}) {
  const router = Router()

  // The complete config gate (LIN-761): validate the FULL env set the flow
  // consumes (getMissingGitHubConfig), not just the GITHUB_APP_* subset. A partial
  // config — App vars present but GITHUB_CLIENT_ID unset — used to sail past the old
  // App-only guard and then throw deep in beginAuth, hanging the request; the
  // complete gate returns a clean 503 up front instead (root cause B).
  function notConfigured(res) {
    const missing = getMissingGitHubConfig()
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
    if (getMissingGitHubConfig().length > 0) return notConfigured(res)
    if (sessionStore?.cleanup) await sessionStore.cleanup()

    const mode = req.query.mode === 'add-source' ? 'add-source' : 'new'
    const state = crypto.randomUUID()

    // Compute the authorize URL BEFORE persisting the session (LIN-761 root cause
    // A). The old code called beginAuth INSIDE the req.session.save() callback — an
    // async callback outside Express's middleware chain, so a throw there reached no
    // error handler and no response was ever written, hanging until the platform
    // H12 killed the request at 30s. Computing it up front (defended by try/catch)
    // means any throw surfaces as a clean 503 here and can never escape the callback.
    let authorizeUrl
    try {
      authorizeUrl = provider.beginAuth({ state })
    } catch (err) {
      console.error('GitHub beginAuth error:', err)
      return notConfigured(res)
    }

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
      res.redirect(authorizeUrl)
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
    if (getMissingGitHubConfig().length > 0) return notConfigured(res)

    // Two inbound shapes (LIN-735): the user-to-server OAuth round-trip returns a
    // `code` (no `installation_id`) — the default entry now that beginAuth is the
    // authorize URL, covering both already-installed re-bind and first-time connect;
    // the post-install return from `installations/new` returns a fresh
    // `installation_id` + `setup_action`. The `code` branch is handled first.
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

    // OAuth-`code` path (LIN-728 + LIN-735). beginAuth is now the user-to-server
    // OAuth authorize URL, so the typical inbound is a `code` with no fresh
    // `installation_id` — for an already-installed App AND for a first-time connect.
    // Exchange it for a discovery user token, enumerate the user's installations +
    // repos, and render the SAME repo picker. The user token is DISCOVERY-ONLY — it
    // is never stored; the link step mints an installation token for the chosen repo
    // (the LIN-711 binding shape).
    if (!installationId && code) {
      let userToken
      try {
        const tokenBag = await provider.completeAuth(code)
        userToken = tokenBag.access_token
      } catch (authError) {
        console.error('GitHub re-bind code exchange error:', authError)
        return res.status(400).send(renderErrorPage('Authentication Failed', 'Could not complete authentication with GitHub. Please try again.', {
          action: 'Try again', actionUrl: '/auth/github', diagnostic: githubErrorDiagnostic(authError)
        }))
      }

      // Resolve the human GitHub identity NOW, from the discovery user token, while
      // it's in hand — this branch is the ONLY place either flow (re-bind or
      // fresh-install) ever holds a user-to-server token. A fresh install redirects
      // to beginInstall below and returns on a SEPARATE round trip carrying only an
      // installation_id (no code), so the human id is stashed on the session here to
      // survive that hop (LIN-1329 Q1/Q2: identity scope is the human's GitHub user
      // id, never the installation account). Budgeted with a timeout — this callback
      // path has a history of hangs (LIN-761).
      let viewer
      try {
        viewer = await withTimeout(provider.fetchViewer(userToken), GITHUB_VIEWER_TIMEOUT_MS, 'GitHub viewer lookup')
      } catch (viewerError) {
        console.error('GitHub viewer lookup error:', viewerError)
        return res.status(400).send(renderErrorPage('Authentication Failed', 'Could not verify your GitHub account. Please try again.', {
          action: 'Try again', actionUrl: '/auth/github', diagnostic: githubErrorDiagnostic(viewerError)
        }))
      }
      req.session.githubHumanId = String(viewer.id)

      let reboundable
      try {
        reboundable = await provider.listReboundableRepos(userToken)
      } catch (fetchError) {
        console.error('Failed to enumerate GitHub installations for re-bind:', fetchError)
        return res.status(500).send(renderErrorPage('Connection Error', 'Could not fetch your repositories from GitHub. Please try again.', {
          action: 'Try again', actionUrl: '/auth/github', diagnostic: githubErrorDiagnostic(fetchError)
        }))
      }

      // No installations yet — the user authorized but has never installed the App
      // (a first-time connect, NOT a re-bind). Send them to the installation picker
      // to install + pick repos; they return with a fresh `installation_id` and flow
      // through the install branch below. Reuse the existing CSRF nonce so that
      // post-install callback still passes the state guard (LIN-735).
      if (!reboundable.length) {
        return res.redirect(provider.beginInstall({ state: req.session.oauthState }))
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
          action: 'Try again', actionUrl: '/auth/github', diagnostic: githubErrorDiagnostic(mintError)
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
          action: 'Try again', actionUrl: '/auth/github', diagnostic: githubErrorDiagnostic(fetchError)
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
        action: 'Try again', actionUrl: '/auth/github', diagnostic: githubErrorDiagnostic(err)
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
    // The human identity resolved at callback time (LIN-1329), captured now
    // (before any session.regenerate below wipes it) so every branch — add-source,
    // existing container, or a fresh regenerate — establishes the account against
    // the same value.
    const humanId = req.session.githubHumanId
    // Two pending shapes converge here: the install branch already minted an
    // installation `token`; the re-bind branch (LIN-728) carries only a
    // repo->installationId map (`rebind`) and mints the token at link time.
    if (!pending || (!pending.token && !pending.rebind) || !humanId) {
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

        // LIN-1329 (Phase C): establish the durable account for this identity —
        // the single seam every sign-in path converges on. `github` is ONE
        // identity provider shared with GitHub Projects (Q3): the human's GitHub
        // user id, never the installation account (`creds.userId`).
        const established = await establishAccount(req.session, accountStore, accountWorkspaceStore, 'github', humanId, { login: creds.login }, workspace.id)
        if (!established.ok) {
          return res.status(409).send(renderErrorPage('Account Conflict', 'This GitHub account is already linked to a different Harbour account. Please sign in with that account, or contact support.', {
            action: 'Go to homepage', actionUrl: '/'
          }))
        }

        linkProvider(workspace, provider.name, repo, credentials)
        delete req.session.githubPending
        delete req.session.githubHumanId
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
        const established = await establishAccount(req.session, accountStore, accountWorkspaceStore, 'github', humanId, { login: creds.login }, existing.id)
        if (!established.ok) {
          return res.status(409).send(renderErrorPage('Account Conflict', 'This GitHub account is already linked to a different Harbour account. Please sign in with that account, or contact support.', {
            action: 'Go to homepage', actionUrl: '/'
          }))
        }
        linkProvider(existing, provider.name, repo, credentials)
        req.session.activeWorkspaceId = existing.id
        delete req.session.githubPending
        delete req.session.githubHumanId
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
      // Awaited (LIN-1329): establishAccount below does real async I/O, so the
      // handler must not resolve before the callback finishes — regenerate()
      // itself doesn't await its callback, so without this wrapper the response
      // (and the session mutations it depends on) could race the caller.
      await new Promise((resolve) => {
        req.session.regenerate(async (regenerateErr) => {
          try {
            if (regenerateErr) {
              console.error('GitHub session regeneration error:', regenerateErr)
              return res.status(500).send(renderErrorPage('Session Error', 'Could not create a secure session. Please try again.', {
                action: 'Try again', actionUrl: '/auth/github'
              }))
            }
            req.session.workspaces = existingWorkspaces

            // LIN-1329 (Phase C): regenerate() just wiped session.accountId (if
            // any), so a returning user's existing account is found by identity
            // lookup, not session continuity — same as the Linear OAuth callback.
            const established = await establishAccount(req.session, accountStore, accountWorkspaceStore, 'github', humanId, { login: creds.login }, workspace.id)
            if (!established.ok) {
              return res.status(409).send(renderErrorPage('Account Conflict', 'This GitHub account is already linked to a different Harbour account. Please sign in with that account, or contact support.', {
                action: 'Go to homepage', actionUrl: '/'
              }))
            }

            // LIN-1353 S9: regenerate() wiped the session, so rehydrate durable
            // preferences (features, theme, OpenRouter key, north star) the same
            // way routes/auth.js's Linear callback does — strictly after
            // established.accountId is populated, before upsertWorkspace.
            if (userPreferencesStore) {
              const savedPrefs = await userPreferencesStore.getUserPreferences(established.accountId)
              applyUserPreferencesToSession(req.session, savedPrefs)
            }

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
          } catch (err) {
            console.error('GitHub post-regenerate callback error:', err)
            if (!res.headersSent) {
              res.status(500).send(renderErrorPage('Something Went Wrong', 'Could not link your GitHub repository. Please try again.', {
                action: 'Try again', actionUrl: '/auth/github', diagnostic: githubErrorDiagnostic(err)
              }))
            }
          } finally {
            resolve()
          }
        })
      })
    } catch (err) {
      console.error('GitHub link error:', err)
      res.status(500).send(renderErrorPage('Something Went Wrong', 'Could not link your GitHub repository. Please try again.', {
        action: 'Try again', actionUrl: '/auth/github', diagnostic: githubErrorDiagnostic(err)
      }))
    }
  })

  return router
}
