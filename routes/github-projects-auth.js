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
import { githubErrorDiagnostic } from '../lib/errors.js'
import { getMissingGitHubConfig, getGitHubConfigProblems, withTimeout, GITHUB_VIEWER_TIMEOUT_MS } from '../lib/providers/github/app-auth.js'
import { establishAccount, clearUnresolvableAccountSession } from '../lib/account-session.js'
import { respondToAccountConflict } from '../lib/account-conflict.js'
import { applyUserPreferencesToSession } from '../lib/user-preferences.js'
import {
  upsertWorkspace,
  saveSession,
  linkProvider,
  getActiveWorkspace,
  getWorkspaceByUrlKey,
  validateWorkspaceUrlKey,
} from '../lib/workspace.js'

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
 * @param {import('../lib/account-store.js').AccountStore} options.accountStore - LIN-1329: find-or-create the durable account for the signing-in identity.
 * @param {import('../lib/account-workspace-store.js').AccountWorkspaceStore} options.accountWorkspaceStore - LIN-1329: bind the account to the workspace.
 * @param {Object} [options.userPreferencesStore] - LIN-1353: rehydrates durable preferences (features, theme, OpenRouter key, north star) onto the fresh-login regenerated session, mirroring routes/auth.js.
 * @returns {Router} Express router
 */
export function createGitHubProjectsAuthRoutes({ sessionStore, provider, accountStore, accountWorkspaceStore, userPreferencesStore } = {}) {
  const router = Router()

  // The complete config gate (LIN-761) — byte-symmetric with routes/github-auth.js:
  // validate the FULL env set the shared App flow consumes, not just GITHUB_APP_*,
  // so a partial config returns a clean 503 rather than hanging in beginAuth.
  //
  // Byte-symmetric wording split with routes/github-auth.js (LIN-2081 finding 4):
  // getMissingGitHubConfig()'s narrower "what's unset" message for the common
  // case, a distinct clause for a shape-invalid-but-present GITHUB_APP_PRIVATE_KEY
  // so the page never claims it as "missing" when it's actually set.
  function notConfigured(res) {
    const missing = getMissingGitHubConfig()
    const detail = missing.length > 0
      ? `Missing environment variables: ${missing.join(', ')}.`
      : 'GITHUB_APP_PRIVATE_KEY is set but is not a valid PEM key.'
    return res.status(503).send(renderErrorPage(
      'GitHub App Not Configured',
      `GitHub Projects is not available. ${detail} See .env.example for setup instructions.`
    ))
  }

  /**
   * Step 1: Initiate the install flow. `mode` distinguishes the two entry points —
   * `add-source` (settings, link onto the viewed workspace) vs `new` (find-or-create
   * the GitHub account container). It lives in the session, never in `state`.
   */
  router.get('/auth/github-projects', async (req, res) => {
    if (getGitHubConfigProblems().length > 0) return notConfigured(res)
    if (sessionStore?.cleanup) await sessionStore.cleanup()

    const mode = req.query.mode === 'add-source' ? 'add-source' : 'new'
    const state = crypto.randomUUID()

    // Throw-safe begin (LIN-761 root cause A) — compute the authorize URL BEFORE
    // req.session.save so a throw can't escape the async callback and hang the
    // request. Byte-symmetric with routes/github-auth.js.
    let authorizeUrl
    try {
      authorizeUrl = provider.beginAuth({ state })
    } catch (err) {
      console.error('GitHub Projects beginAuth error:', err)
      return notConfigured(res)
    }

    req.session.oauthState = state
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
    if (getGitHubConfigProblems().length > 0) return notConfigured(res)

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

    // OAuth-`code` re-bind path (LIN-735 — the Projects analogue of LIN-728). With
    // beginAuth now the user-to-server OAuth authorize URL, the typical inbound is a
    // `code` with no fresh `installation_id` — for an already-installed shared App
    // AND for a first-time connect. Exchange it for a discovery user token, list the
    // user's installations' boards, and render the SAME board picker. The user token
    // is DISCOVERY-ONLY — never stored; the link step mints an installation token for
    // the chosen board (the LIN-711 binding shape).
    if (!installationId && code) {
      let userToken
      try {
        const tokenBag = await provider.completeAuth(code)
        userToken = tokenBag.access_token
      } catch (authError) {
        console.error('GitHub Projects re-bind code exchange error:', authError)
        return res.status(400).send(renderErrorPage('Authentication Failed', 'Could not complete authentication with GitHub. Please try again.', {
          action: 'Try again', actionUrl: '/auth/github-projects', diagnostic: githubErrorDiagnostic(authError)
        }))
      }

      // Resolve the human GitHub identity NOW, from the discovery user token, while
      // it's in hand — mirrors routes/github-auth.js (LIN-1329). `github` is ONE
      // identity provider shared with GitHub Issues (Q3): stashed on the session so
      // it survives the separate fresh-install round trip (installation_id, no code).
      let viewer
      try {
        viewer = await withTimeout(provider.fetchViewer(userToken), GITHUB_VIEWER_TIMEOUT_MS, 'GitHub viewer lookup')
      } catch (viewerError) {
        console.error('GitHub Projects viewer lookup error:', viewerError)
        return res.status(400).send(renderErrorPage('Authentication Failed', 'Could not verify your GitHub account. Please try again.', {
          action: 'Try again', actionUrl: '/auth/github-projects', diagnostic: githubErrorDiagnostic(viewerError)
        }))
      }
      req.session.githubHumanId = String(viewer.id)

      let reboundable
      try {
        reboundable = await provider.listReboundableBoards(userToken)
      } catch (fetchError) {
        console.error('Failed to enumerate GitHub Projects boards for re-bind:', fetchError)
        return res.status(500).send(renderErrorPage('Connection Error', 'Could not fetch your project boards from GitHub. Please try again.', {
          action: 'Try again', actionUrl: '/auth/github-projects', diagnostic: githubErrorDiagnostic(fetchError)
        }))
      }

      // No installations yet — the user authorized but has never installed the App
      // (a first-time connect, NOT a re-bind). Send them to install + grant the
      // Projects (read) permission; they return with a fresh `installation_id` and
      // flow through the install branch below. Reuse the CSRF nonce so the
      // post-install callback still passes the state guard (LIN-735).
      //
      // Throw-safe (LIN-2081 review finding 3), byte-symmetric with
      // routes/github-auth.js: beginInstall() calls getAppConfig() for `slug`,
      // which validates GITHUB_APP_PRIVATE_KEY's shape unconditionally even
      // though this call never signs with it. Unguarded, a throw here would hang
      // the request (LIN-761 root cause A) rather than surface a clean 503.
      if (!reboundable.length) {
        let installUrl
        try {
          installUrl = provider.beginInstall({ state: req.session.oauthState })
        } catch (err) {
          console.error('GitHub Projects beginInstall error:', err)
          return notConfigured(res)
        }
        return res.redirect(installUrl)
      }

      // Stash a board->installationId map (NOT the user token): the link step
      // resolves the chosen board's installation server-side and mints the
      // installation token then, so a client can never assert which installation a
      // board belongs to. The LIN-541 `mode`/`workspaceUrlKey` carry rides along.
      const boardInstallations = {}
      for (const b of reboundable) boardInstallations[`${b.login}/${b.number}`] = String(b.installationId)
      const pending = { rebind: true, mode, boardInstallations }
      if (intent.workspaceUrlKey) pending.workspaceUrlKey = intent.workspaceUrlKey
      req.session.githubProjectsPending = pending
      return req.session.save(() => {
        res.send(renderGitHubProjectSelectPage(reboundable, { mode }))
      })
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
          action: 'Try again', actionUrl: '/auth/github-projects', diagnostic: githubErrorDiagnostic(mintError)
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
          action: 'Try again', actionUrl: '/auth/github-projects', diagnostic: githubErrorDiagnostic(fetchError)
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
        action: 'Try again', actionUrl: '/auth/github-projects', diagnostic: githubErrorDiagnostic(err)
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
    // The human identity resolved at callback time (LIN-1329), captured now
    // (before any session.regenerate below wipes it).
    const humanId = req.session.githubHumanId
    // Two pending shapes converge here: the install branch already minted an
    // installation `token`; the re-bind branch (LIN-735) carries only a
    // board->installationId map (`rebind`) and mints the token at link time.
    if (!pending || (!pending.token && !pending.rebind) || !humanId) {
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
      // Resolve the binding credential. The install branch already holds the minted
      // installation token + identity in `pending`. The re-bind branch (LIN-735)
      // holds only a board->installationId map: resolve the chosen board's
      // installation server-side (a client-supplied installation is never trusted)
      // and mint the installation token NOW via completeInstallation. EITHER WAY the
      // persisted credential is an installation token, so re-mint keeps working and
      // the discovery user token is never stored.
      let creds
      if (pending.rebind) {
        const installationId = pending.boardInstallations?.[board]
        if (!installationId) {
          return res.status(400).send(renderErrorPage('Invalid Project Board', 'That board is not one of your installed GitHub project boards. Please pick one from the list.', {
            action: 'Try again', actionUrl: '/auth/github-projects'
          }))
        }
        creds = await provider.completeInstallation(installationId)
      } else {
        creds = pending
      }

      // GitHub App binding shape (LIN-711): persist `installationId` (the re-mint
      // key) and stamp the binding with the real installation-token expiry in ms.
      // installationExpiryMs throws on a missing/unparseable expiry (kept inside the
      // try so it renders the clean error page below).
      const tokenExpiresAt = installationExpiryMs(creds.tokenExpiresAt)
      const credentials = { installationId: creds.installationId, token: creds.token, tokenExpiresAt }

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

        // LIN-1329 (Phase C): establish the durable account for this identity —
        // `github` is ONE identity provider shared with GitHub Issues (Q3): the
        // human's GitHub user id, never the installation account (`creds.userId`).
        const established = await establishAccount(req.session, accountStore, accountWorkspaceStore, 'github', humanId, { login: creds.login }, workspace.id)
        if (!established.ok) {
          if (!established.conflict) clearUnresolvableAccountSession(req.session)
          return res.status(409).send(renderErrorPage('Account Conflict', 'This GitHub account is already linked to a different Harbour account. Please sign in with that account, or contact support.', {
            action: 'Go to homepage', actionUrl: '/'
          }))
        }

        linkProvider(workspace, provider.name, board, credentials)
        delete req.session.githubProjectsPending
        delete req.session.githubHumanId
        await saveSession(req.session)
        return res.redirect(`/workspace/${encodeURIComponent(workspace.urlKey)}/settings?provider_ok=github-projects`)
      }

      // New-container login: find-or-create the GitHub *account* container keyed by
      // identity, so a Projects board (or a second board, or an Issues repo) for the
      // same account adds a binding rather than clobbering the first.
      const workspaceId = `github:${creds.userId}`
      const existing = (req.session.workspaces || []).find(w => w.id === workspaceId)
      if (existing) {
        const established = await establishAccount(req.session, accountStore, accountWorkspaceStore, 'github', humanId, { login: creds.login }, existing.id)
        if (!established.ok) {
          if (!established.conflict) clearUnresolvableAccountSession(req.session)
          return res.status(409).send(renderErrorPage('Account Conflict', 'This GitHub account is already linked to a different Harbour account. Please sign in with that account, or contact support.', {
            action: 'Go to homepage', actionUrl: '/'
          }))
        }
        linkProvider(existing, provider.name, board, credentials)
        req.session.activeWorkspaceId = existing.id
        delete req.session.githubProjectsPending
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
        tokenExpiresAt,
      }
      linkProvider(workspace, provider.name, board, credentials)

      const existingWorkspaces = req.session.workspaces || []
      // LIN-2267 (class fix of LIN-2233's L2.1): carry session.accountId and its
      // freshness stamp across regenerate() exactly as session.workspaces already
      // is. Without this, a NEW GitHub identity arriving while a different
      // account was live in the pre-regenerate session always took the mint
      // branch instead of the link/conflict branch below, because
      // session.accountId was gone by the time establishAccount ran —
      // mirrors the fix applied to routes/auth.js's Linear callback.
      const existingAccountId = req.session.accountId
      const existingIdentityAuthenticatedAt = req.session.identityAuthenticatedAt
      // Awaited (LIN-1329): establishAccount below does real async I/O, so the
      // handler must not resolve before the callback finishes — regenerate()
      // itself doesn't await its callback, so without this wrapper the response
      // (and the session mutations it depends on) could race the caller.
      await new Promise((resolve) => {
        req.session.regenerate(async (regenerateErr) => {
          try {
            if (regenerateErr) {
              console.error('GitHub Projects session regeneration error:', regenerateErr)
              return res.status(500).send(renderErrorPage('Session Error', 'Could not create a secure session. Please try again.', {
                action: 'Try again', actionUrl: '/auth/github-projects'
              }))
            }
            req.session.workspaces = existingWorkspaces
            // LIN-2267: restore the carried accountId/freshness stamp BEFORE
            // establishAccount runs below, so a returning identity (or a
            // brand-new one arriving while this account is live) resolves
            // against the account that was actually live pre-regenerate, not
            // against nothing.
            req.session.accountId = existingAccountId
            req.session.identityAuthenticatedAt = existingIdentityAuthenticatedAt

            // LIN-1329 (Phase C): find-or-create the durable account for this
            // identity — a returning user's existing account is found by
            // identity lookup even with no live session.accountId.
            // LIN-2267 (review F2): snapshot BEFORE upsertWorkspace, so a
            // conflict return can restore it — mirrors routes/auth.js:437.
            const workspacesBeforeLogin = req.session.workspaces ? [...req.session.workspaces] : []
            try {
              upsertWorkspace(req.session, workspace)
            } catch (limitError) {
              return res.status(400).send(renderErrorPage('Workspace Limit Reached', 'You have reached the maximum number of connected workspaces. Please remove one before adding another.', {
                action: 'Go to dashboard', actionUrl: '/'
              }))
            }

            const established = await establishAccount(req.session, accountStore, accountWorkspaceStore, 'github', humanId, { login: creds.login }, workspace.id)
            if (!established.ok) {
              // LIN-2304: route this conflict through the shared merge-offer
              // seam instead of the old dead-end 409 — a MERGEABLE conflict
              // (established.conflict present) needs session.accountId to
              // survive as canonicalAccountId, so the identity-clear below is
              // conditional on `!established.conflict` (inside
              // respondToAccountConflict's non-mergeable arm), not
              // unconditional as it was before. Restoring
              // session.workspaces to its pre-login snapshot stays
              // unconditional and at the call site (LIN-2267 F2) — the
              // arriving unconfirmed workspace's live credentials must not
              // leak into a session that belongs to another account, whether
              // or not the conflict turns out to be mergeable.
              //
              // identityLabel is 'GitHub', not 'GitHub Projects' — GitHub App
              // (Issues) and GitHub Projects share ONE identity provider
              // (lib/account-session.js), so the arriving identity really is
              // "a GitHub account", regardless of which surface it signed in
              // through.
              req.session.workspaces = workspacesBeforeLogin
              return await respondToAccountConflict({
                req, res, established, workspace, mode: 'new', returnUrlKey: workspace.urlKey,
                identityLabel: 'GitHub', reauthUrl: '/auth/github-projects', provider: 'github-projects'
              })
            }

            // LIN-1353 S9: regenerate() wiped the session, so rehydrate durable
            // preferences (features, theme, OpenRouter key, north star) the same
            // way routes/auth.js's Linear callback does — strictly after
            // established.accountId is populated, before upsertWorkspace.
            if (userPreferencesStore) {
              const savedPrefs = await userPreferencesStore.getUserPreferences(established.accountId)
              applyUserPreferencesToSession(req.session, savedPrefs)
            }

            req.session.activeWorkspaceId = workspace.id
            await saveSession(req.session)
            res.redirect(`/workspace/${encodeURIComponent(workspace.urlKey)}/`)
          } catch (err) {
            console.error('GitHub Projects post-regenerate callback error:', err)
            if (!res.headersSent) {
              res.status(500).send(renderErrorPage('Something Went Wrong', 'Could not link your GitHub project board. Please try again.', {
                action: 'Try again', actionUrl: '/auth/github-projects', diagnostic: githubErrorDiagnostic(err)
              }))
            }
          } finally {
            resolve()
          }
        })
      })
    } catch (err) {
      console.error('GitHub Projects link error:', err)
      res.status(500).send(renderErrorPage('Something Went Wrong', 'Could not link your GitHub project board. Please try again.', {
        action: 'Try again', actionUrl: '/auth/github-projects', diagnostic: githubErrorDiagnostic(err)
      }))
    }
  })

  return router
}
