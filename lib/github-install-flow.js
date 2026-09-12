/**
 * Shared GitHub App OAuth + installation flow (LIN-2397, pure move out of
 * routes/github-auth.js and routes/github-projects-auth.js). The two routers
 * are one program differing only in what the picker chooses — a repo
 * (`owner/name`) versus a Projects v2 board (`org/projectNumber`) — and 13
 * mechanical substitutions (route path prefix, picker renderer, slug regex +
 * body field, pending session key, two provider methods, the rebind map's
 * field name + key derivation, `provider_ok=`, `respondToAccountConflict`'s
 * `reauthUrl`, six pairs of per-surface copy, and console.error labels).
 * `createGitHubInstallFlowRoutes(descriptor)` carries the shared orchestration
 * (redirect -> callback -> mint -> establish -> merge); each route file keeps
 * its own docblock, slug regex, picker-renderer import, and descriptor.
 *
 * What is NOT parameterised, because doing so would let the two surfaces
 * drift again: `identityLabel: 'GitHub'`, the `'github'` identity-provider
 * argument to establishAccount, the `githubHumanId` session key, the
 * `github:<userId>` / `gh-<userId>` id/urlKey literals, `installationExpiryMs`,
 * the `mode` default (`'new'` — both routers intentionally fail OPEN to it;
 * this is load-bearing production behaviour, not a fallback to tidy away),
 * and every shared error title/body. `provider` stays injected from the
 * caller — never resolved via the registry here (that is exactly what the
 * dead `getProvider` import in the old github-auth.js invited).
 */
import crypto from 'crypto'
import { Router } from 'express'
import { renderErrorPage } from './render-pages.js'
import { githubErrorDiagnostic } from './errors.js'
import { getMissingGitHubConfig, getGitHubConfigProblems, withTimeout, GITHUB_VIEWER_TIMEOUT_MS } from './providers/github/app-auth.js'
import { establishAccount, clearUnresolvableAccountSession } from './account-session.js'
import { respondToAccountConflict } from './account-conflict.js'
import { applyUserPreferencesToSession } from './user-preferences.js'
import {
  upsertWorkspace,
  saveSession,
  linkProvider,
  getActiveWorkspace,
  getWorkspaceByUrlKey,
  validateWorkspaceUrlKey,
} from './workspace.js'

/**
 * Consume the OAuth/install CSRF nonce and its intent (LIN-2499).
 *
 * Called at the callback's TERMINAL exits only — the two picker renders, which
 * are the last point in the flow that reads either field. Deliberately NOT
 * called on the `!reboundable.length` arm, which re-uses the same nonce for the
 * beginInstall round-trip (LIN-735) and comes back through this callback a
 * second time; clearing there would 400 every first-time connect.
 *
 * By the time a picker renders, `intent`'s `mode`/`workspaceUrlKey` have been
 * copied into `session[pendingKey]`, so the link step reads nothing from these
 * fields — which is why one clear here covers all three of its success arms
 * (only the new-container arm regenerates the session, and so was the only one
 * implicitly covered before). The callback's own mismatch guard then rejects a
 * replayed callback with the consumed nonce — the same pairing routes/
 * jira-auth.js uses: the guard at :356, the consume at :562.
 */
function consumeOAuthNonce(session) {
  delete session.oauthState
  delete session.oauthIntent
}

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
 * Derive a fresh signed-in GitHub container's initial `urlKey` from the repo
 * slug's NAME segment (LIN-2802). A local copy of `deriveJiraUrlKey`'s exact
 * collision-loop shape (`routes/jira-auth.js`) — not an import, since the
 * only in-tree slugify (`slugifyName`, `routes/workspace.js`) is module-
 * private, and reusing it would mean a `lib/ -> routes/` import purely to
 * borrow slugification, a change this ticket has no other reason to make.
 *
 * `REPO_SLUG_REGEX` (`routes/github-auth.js`) admits `[\w.-]`, wider than
 * `URL_KEY_REGEX`'s `[a-z0-9-]` (`lib/workspace.js`) — so a repo name with an
 * underscore or dot (`my_repo`, `foo.js`) is collapsed to lowercase with
 * every non-alphanumeric run replaced by a single hyphen (mirroring
 * `slugifyName`'s own transform) rather than falling through to the generic
 * `'github'` fallback, which is reserved for the genuinely unslugifiable case
 * (an empty/symbol-only name segment).
 *
 * @param {string} repoName - The slug's name segment (`owner/name` -> `name`).
 * @param {Array<{urlKey?: string}>} [existingWorkspaces] - Read BEFORE
 *   `session.regenerate()` wipes `req.session.workspaces` — same timing
 *   `deriveJiraUrlKey` uses.
 * @returns {string}
 */
export function deriveGithubFreshUrlKey(repoName, existingWorkspaces = []) {
  const slugified = String(repoName || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  const base = validateWorkspaceUrlKey(slugified) ? slugified : 'github'
  const taken = new Set((existingWorkspaces || []).map(w => w?.urlKey).filter(Boolean))
  if (!taken.has(base)) return base
  // Bounded by MAX_WORKSPACES-worth of headroom; `upsertWorkspace` refuses long
  // before this loop could exhaust, so it cannot spin.
  for (let n = 2; n <= 100; n++) {
    const candidate = `${base}-${n}`.slice(0, 50)
    if (!taken.has(candidate)) return candidate
  }
  return `github-${Date.now()}`.slice(0, 50)
}

/**
 * Create the shared GitHub App install-flow routes for one surface (GitHub
 * Issues repos, or GitHub Projects boards). `descriptor` carries the runtime
 * deps (spread through unchanged from the surface's `getAuthRouter`) plus the
 * 13 categories of surface identity/behaviour/copy that distinguish the two
 * consumers.
 *
 * @param {Object} descriptor
 * @param {Object} [descriptor.sessionStore] - Session store with cleanup() (optional; mirrors Linear router shape).
 * @param {Object} descriptor.provider - The provider instance (injected by <Provider>.getAuthRouter). Never resolved via the registry here.
 * @param {import('./account-store.js').AccountStore} descriptor.accountStore - LIN-1329: find-or-create the durable account for the signing-in identity.
 * @param {import('./account-workspace-store.js').AccountWorkspaceStore} descriptor.accountWorkspaceStore - LIN-1329: bind the account to the workspace.
 * @param {Object} [descriptor.userPreferencesStore] - LIN-1353: rehydrates durable preferences onto the fresh-login regenerated session.
 * @param {string} descriptor.basePath - Route path prefix (e.g. `/auth/github`). Every actionUrl, reauthUrl, and the callback/link sub-routes derive from this.
 * @param {string} descriptor.providerOkKey - `?provider_ok=` value and `respondToAccountConflict`'s `provider` argument.
 * @param {string} descriptor.pendingKey - Session key the acquired token/identity are held under until the picker resolves.
 * @param {string} descriptor.notConfiguredLead - `notConfigured` page's lead sentence.
 * @param {string} descriptor.bodyField - The picker form's body field name (e.g. `repo`/`board`).
 * @param {RegExp} descriptor.slugRegex - Validates the picked slug's shape.
 * @param {string} descriptor.rebindMapKey - Field name of the server-side slug->installationId map stashed on the rebind pending session.
 * @param {(provider: Object, userToken: string) => Promise<Array>} descriptor.listReboundable - Enumerate the user's re-bindable installations. Arity-sensitive — a closure, never a method-name string.
 * @param {(item: Object) => string} descriptor.rebindSlugOf - Derive a reboundable item's slug for the rebind map key.
 * @param {(provider: Object, creds: Object) => Promise<Array>} descriptor.listChoices - List the installation's choices for the picker. Arity-sensitive (`listBoards` needs `creds.login`, `listRepos` does not) — a closure, never a method-name string.
 * @param {(choices: Array, opts: Object) => string} descriptor.renderPicker - Render the picker page.
 * @param {Object} descriptor.log - The eleven console.error label strings that differ per surface.
 * @param {Object} descriptor.copy - The per-surface copy pairs (invalid-slug title/body, not-in-map body, connection-error body, link-failure body, link-session-expired action label).
 * @param {boolean} [descriptor.supportsFreshContainer] - LIN-2802: whether a
 *   signed-in `mode=new` request on this descriptor may mint a brand-new
 *   container per invocation instead of reusing the per-account
 *   `github:<userId>` one. `true` only for `routes/github-auth.js` (the
 *   descriptor with a switcher entry point); `routes/github-projects-auth.js`
 *   omits it (falsy), so its signed-in `mode=new` behavior is unchanged.
 * @param {boolean} [descriptor.passLoginOnRebind] - LIN-2820: whether the
 *   re-bind path's `renderPicker` call includes `login`. `renderPicker` is one
 *   shared call site consumed by BOTH `renderGitHubRepoSelectPage` (which
 *   newly wants `login` for its subtitle) and `renderGitHubProjectSelectPage`
 *   (which already reads `login` too, but must stay byte-identical) — unlike
 *   `installationId`/`truncated`, which the Projects renderer ignores as
 *   unknown keys, `login` is NOT unknown to it, so passing it unconditionally
 *   would change the Projects picker's re-bind subtitle for the first time.
 *   `true` only for `routes/github-auth.js`; `routes/github-projects-auth.js`
 *   omits it (falsy), preserving its pre-LIN-2820 re-bind output exactly.
 * @returns {Router} Express router
 */
export function createGitHubInstallFlowRoutes({
  sessionStore, provider, accountStore, accountWorkspaceStore, userPreferencesStore,
  basePath, providerOkKey, pendingKey, notConfiguredLead,
  bodyField, slugRegex, rebindMapKey, listReboundable, rebindSlugOf, listChoices, renderPicker,
  log, copy, supportsFreshContainer, passLoginOnRebind,
} = {}) {
  const router = Router()
  const callbackPath = `${basePath}/callback`
  const linkPath = `${basePath}/link`

  // The complete config gate (LIN-761): validate the FULL env set the flow
  // consumes (getMissingGitHubConfig), not just the GITHUB_APP_* subset. A partial
  // config — App vars present but GITHUB_CLIENT_ID unset — used to sail past the old
  // App-only guard and then throw deep in beginAuth, hanging the request; the
  // complete gate returns a clean 503 up front instead (root cause B).
  //
  // The message keeps getMissingGitHubConfig()'s narrower "what's unset" wording
  // for that common case; a shape-invalid-but-present GITHUB_APP_PRIVATE_KEY
  // (LIN-2081 review finding 4 — getGitHubConfigProblems() reports it, but never
  // as an unset var, since it IS set) gets its own clause instead of a confusing
  // empty "Missing environment variables: ." message.
  function notConfigured(res) {
    const missing = getMissingGitHubConfig()
    const detail = missing.length > 0
      ? `Missing environment variables: ${missing.join(', ')}.`
      : 'GITHUB_APP_PRIVATE_KEY is set but is not a valid PEM key.'
    return res.status(503).send(renderErrorPage(
      'GitHub App Not Configured',
      `${notConfiguredLead} ${detail} See .env.example for setup instructions.`
    ))
  }

  /**
   * Step 1: Initiate the GitHub OAuth flow. `mode` distinguishes the two entry
   * points — `add-source` (settings, link onto the active workspace) vs `new`
   * (login page, find-or-create the GitHub account container). It lives in the
   * session, never in `state`.
   */
  router.get(basePath, async (req, res) => {
    if (getGitHubConfigProblems().length > 0) return notConfigured(res)
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
      console.error(log.beginAuth, err)
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
    // LIN-2802: captured at flow START, never inferred later at the callback —
    // same reasoning as the `workspaceUrlKey` carry above. A signed-in
    // "+ GitHub Issues" click from the switcher (mode=new, req.session.accountId
    // present) must mint a fresh container even though the account may already
    // hold a `github:<userId>` workspace; a signed-out re-login (no accountId
    // yet) must keep reusing it, byte-identical to today. Gated on
    // `supportsFreshContainer` so `github-projects` (no switcher entry point)
    // never sets this, regardless of session state.
    if (mode === 'new' && req.session.accountId && supportsFreshContainer) {
      intent.fresh = true
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
   * what it may access. We mint an installation access token from
   * `installation_id` (the surface-1 helper) and look up the installation's
   * `account` for identity — replacing the old code->user-token exchange and the
   * `/user` viewer (an installation token cannot read `/user`).
   *
   * The LIN-541 intent carry is preserved unchanged: `mode`/`workspaceUrlKey`
   * round-trip via the session, and `state` stays an opaque CSRF nonce (never
   * repurposed to carry intent). The acquired token + identity are held in
   * session (the pending key) until the user picks a choice (POST .../link).
   */
  router.get(callbackPath, async (req, res) => {
    if (getGitHubConfigProblems().length > 0) return notConfigured(res)

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
        action: 'Try again', actionUrl: basePath
      }))
    }

    // `state` stays the opaque CSRF nonce minted by the begin route — the SAME
    // guard as the OAuth flow. Intent is read from the session, never decoded
    // from `state` (LIN-562).
    if (!state || state !== req.session.oauthState) {
      return res.status(400).send(renderErrorPage('Session Expired', 'Your GitHub sign-in session expired or was invalid. Please try again.', {
        action: 'Try again', actionUrl: basePath
      }))
    }

    const intent = req.session.oauthIntent || {}
    const mode = intent.mode === 'add-source' ? 'add-source' : 'new'

    // OAuth-`code` path (LIN-728 + LIN-735). beginAuth is now the user-to-server
    // OAuth authorize URL, so the typical inbound is a `code` with no fresh
    // `installation_id` — for an already-installed App AND for a first-time connect.
    // Exchange it for a discovery user token, enumerate the user's installations, and
    // render the SAME picker. The user token is DISCOVERY-ONLY — it is never stored;
    // the link step mints an installation token for the chosen selection (the
    // LIN-711 binding shape).
    if (!installationId && code) {
      let userToken
      try {
        const tokenBag = await provider.completeAuth(code)
        userToken = tokenBag.access_token
      } catch (authError) {
        console.error(log.rebindExchange, authError)
        return res.status(400).send(renderErrorPage('Authentication Failed', 'Could not complete authentication with GitHub. Please try again.', {
          action: 'Try again', actionUrl: basePath, diagnostic: githubErrorDiagnostic(authError)
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
        console.error(log.viewerLookup, viewerError)
        return res.status(400).send(renderErrorPage('Authentication Failed', 'Could not verify your GitHub account. Please try again.', {
          action: 'Try again', actionUrl: basePath, diagnostic: githubErrorDiagnostic(viewerError)
        }))
      }
      req.session.githubHumanId = String(viewer.id)

      let reboundable
      try {
        reboundable = await listReboundable(provider, userToken)
      } catch (fetchError) {
        console.error(log.enumerateReboundable, fetchError)
        return res.status(500).send(renderErrorPage('Connection Error', copy.fetchFailBody, {
          action: 'Try again', actionUrl: basePath, diagnostic: githubErrorDiagnostic(fetchError)
        }))
      }

      // No installations yet — the user authorized but has never installed the App
      // (a first-time connect, NOT a re-bind). Send them to the installation picker
      // to install + choose; they return with a fresh `installation_id` and flow
      // through the install branch below. Reuse the existing CSRF nonce so that
      // post-install callback still passes the state guard (LIN-735).
      //
      // Throw-safe (LIN-2081 review finding 3), same beginAuth precedent as above:
      // beginInstall() calls getAppConfig() for `slug`, which — since this ticket —
      // validates GITHUB_APP_PRIVATE_KEY's shape unconditionally even though this
      // call never signs with it. This handler is async and outside Express's
      // middleware chain (LIN-761 root cause A), so an unguarded throw here would
      // hang the request with no response rather than surface a clean 503.
      if (!reboundable.length) {
        let installUrl
        try {
          installUrl = provider.beginInstall({ state: req.session.oauthState })
        } catch (err) {
          console.error(log.beginInstall, err)
          return notConfigured(res)
        }
        return res.redirect(installUrl)
      }

      // Stash a slug->installationId map (NOT the user token, NOT a per-choice
      // credential): the link step resolves the chosen slug's installation
      // server-side from this map and mints the installation token then, so a
      // client can never assert which installation a choice belongs to. The LIN-541
      // `mode`/`workspaceUrlKey` carry rides along exactly as the install branch.
      const rebindMap = {}
      for (const item of reboundable) rebindMap[rebindSlugOf(item)] = String(item.installationId)
      const pending = { rebind: true, mode, [rebindMapKey]: rebindMap }
      if (intent.workspaceUrlKey) pending.workspaceUrlKey = intent.workspaceUrlKey
      if (intent.fresh === true) pending.fresh = true
      req.session[pendingKey] = pending
      consumeOAuthNonce(req.session)
      return req.session.save(() => {
        // LIN-2820: `login` was previously dropped on this path (only the
        // install branch below passed it), silently omitting the subtitle's
        // identity line on a re-bind — but only add it back for descriptors
        // that opt in (`passLoginOnRebind`), since the Projects renderer reads
        // `login` too and must stay byte-identical (see the descriptor JSDoc
        // above). `truncated` rides straight off the provider's own array
        // property, and is safe unconditionally — the Projects renderer
        // ignores it as an unknown key.
        const rebindOpts = { mode, truncated: reboundable.truncated }
        if (passLoginOnRebind) rebindOpts.login = viewer.login
        res.send(renderPicker(reboundable, rebindOpts))
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
        action: 'Try again', actionUrl: basePath
      }))
    }

    try {
      // Acquire the installation credential + identity. provider.completeInstallation
      // mints an installation access token from installation_id (the surface-1
      // helper) and resolves the installation's `account` for identity — replacing
      // the old completeAuth(code) user-token exchange and the `/user` viewer (an
      // installation token cannot read `/user`). Driving it through the provider
      // keeps the route's acquisition seam consistent with beginAuth/listChoices.
      let creds
      try {
        creds = await provider.completeInstallation(installationId)
      } catch (mintError) {
        console.error(log.installMint, mintError)
        return res.status(400).send(renderErrorPage('Authentication Failed', 'Could not complete authentication with GitHub. Please try again.', {
          action: 'Try again', actionUrl: basePath, diagnostic: githubErrorDiagnostic(mintError)
        }))
      }

      // Choices come from the installation now (LIN-710): the picker is
      // constrained to exactly what was selected at install time.
      let choices
      try {
        choices = await listChoices(provider, creds)
      } catch (fetchError) {
        console.error(log.listChoicesFail, fetchError)
        return res.status(500).send(renderErrorPage('Connection Error', copy.fetchFailBody, {
          action: 'Try again', actionUrl: basePath, diagnostic: githubErrorDiagnostic(fetchError)
        }))
      }

      // Hold the installation token + identity until the user picks a choice. The
      // picker selection completes the binding (POST .../link). `installationId`
      // is the re-mint key the link step now persists on the binding (LIN-711), and
      // `tokenExpiresAt` (GitHub's raw `expires_at` ISO string) rides along so the
      // link step can stamp the binding with the real ms expiry rather than the old
      // OAuth-App never-expires MAX. The add-source target workspace (if any) rides
      // along too so the link binds onto the viewed workspace, not the active one (LIN-541).
      const pending = { token: creds.token, mode, login: creds.login, userId: creds.userId, installationId: String(installationId), tokenExpiresAt: creds.tokenExpiresAt }
      if (intent.workspaceUrlKey) pending.workspaceUrlKey = intent.workspaceUrlKey
      if (intent.fresh === true) pending.fresh = true
      req.session[pendingKey] = pending
      consumeOAuthNonce(req.session)
      req.session.save(() => {
        // LIN-2820: thread the fresh-install installationId (already in scope
        // from this branch's own `installationId` var, and mirrored onto
        // `pending`) so the picker's per-installation "add more repos" link
        // has a real settings URL instead of only the generic fallback.
        res.send(renderPicker(choices, { mode, login: creds.login, installationId: String(installationId), truncated: choices.truncated }))
      })
    } catch (err) {
      console.error(log.callbackCatch, err)
      res.status(500).send(renderErrorPage('Something Went Wrong', 'An unexpected error occurred during GitHub authentication. Please try again.', {
        action: 'Try again', actionUrl: basePath, diagnostic: githubErrorDiagnostic(err)
      }))
    }
  })

  /**
   * Step 3: Write the binding. `linkProvider(workspace, provider.name, slug, creds)`
   * is the single seam both modes converge on (LIN-562) — they differ only in
   * WHICH container is linked: the active workspace (add-source) vs a find-or-
   * created GitHub account container (new login).
   */
  router.post(linkPath, async (req, res) => {
    const pending = req.session[pendingKey]
    // The human identity resolved at callback time (LIN-1329), captured now
    // (before any session.regenerate below wipes it) so every branch — add-source,
    // existing container, or a fresh regenerate — establishes the account against
    // the same value.
    const humanId = req.session.githubHumanId
    // Two pending shapes converge here: the install branch already minted an
    // installation `token`; the re-bind branch (LIN-728) carries only a
    // slug->installationId map (`rebind`) and mints the token at link time.
    if (!pending || (!pending.token && !pending.rebind) || !humanId) {
      return res.status(400).send(renderErrorPage('Session Expired', 'Your GitHub sign-in session expired. Please start again.', {
        action: copy.linkSessionExpiredAction, actionUrl: basePath
      }))
    }

    const slug = String(req.body[bodyField] || '').trim()
    if (!slugRegex.test(slug)) {
      return res.status(400).send(renderErrorPage(copy.invalidSlugTitle, copy.invalidSlugBody, {
        action: 'Try again', actionUrl: basePath
      }))
    }

    try {
      // Resolve the binding credential. The install branch already holds the
      // minted installation token + identity in `pending`. The re-bind branch
      // (LIN-728) holds only a slug->installationId map: resolve the chosen slug's
      // installation server-side (a client-supplied installation is never trusted)
      // and mint the installation token NOW via the same completeInstallation seam.
      // EITHER WAY the persisted credential is an installation token, so re-mint
      // (LIN-712) keeps working — the user token is never stored.
      let creds
      if (pending.rebind) {
        const installationId = pending[rebindMapKey]?.[slug]
        if (!installationId) {
          return res.status(400).send(renderErrorPage(copy.invalidSlugTitle, copy.notInMapBody, {
            action: 'Try again', actionUrl: basePath
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
      // which this surface feeds (lib/workspace-token-refresh.js).
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
          if (!established.conflict) clearUnresolvableAccountSession(req.session)
          return res.status(409).send(renderErrorPage('Account Conflict', 'This GitHub account is already linked to a different Harbour account. Please sign in with that account, or contact support.', {
            action: 'Go to homepage', actionUrl: '/'
          }))
        }

        linkProvider(workspace, provider.name, slug, credentials)
        delete req.session[pendingKey]
        delete req.session.githubHumanId
        await saveSession(req.session)
        return res.redirect(`/workspace/${encodeURIComponent(workspace.urlKey)}/settings?provider_ok=${providerOkKey}`)
      }

      // New-container login: find-or-create the GitHub *account* container so a
      // second binding for the same account adds a binding rather than clobbering
      // the first (bindings are keyed by (provider, scope)). Identity is the
      // GitHub user; per-choice bindings are bindings on it (LIN-544).
      //
      // EXCEPTION (LIN-2802): a signed-in "+ GitHub Issues" click from the
      // switcher carries `pending.fresh === true` and must NOT reuse — or even
      // look up — the per-account `github:<userId>` container below. That id is
      // one-per-account by construction, which is exactly what would collapse a
      // second "+ new workspace" invocation into the first workspace instead of
      // minting its own. It always builds a brand-new, random-id container,
      // named from the repo slug's NAME segment (mirrors `deriveJiraUrlKey`'s own
      // collision-loop shape, see `deriveGithubFreshUrlKey` below), reading
      // `req.session.workspaces` for the collision set BEFORE `regenerate()`
      // wipes it — the same timing the existing branch below already uses to
      // build its own `workspace`. `pending.fresh` is only ever `true` for the
      // `github` descriptor (`supportsFreshContainer`, set in the GET handler
      // above); `github-projects` never sets it and always falls into this
      // branch's `else`, byte-identical to its pre-ticket behavior.
      let workspace
      if (pending.fresh === true) {
        const repoName = slug.split('/').pop()
        workspace = {
          id: crypto.randomUUID(),
          name: repoName,
          urlKey: deriveGithubFreshUrlKey(repoName, req.session.workspaces),
          addedAt: Date.now(),
          tokenExpiresAt,
        }
        linkProvider(workspace, provider.name, slug, credentials)
      } else {
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
          linkProvider(existing, provider.name, slug, credentials)
          req.session.activeWorkspaceId = existing.id
          delete req.session[pendingKey]
          delete req.session.githubHumanId
          await saveSession(req.session)
          return res.redirect(`/workspace/${encodeURIComponent(existing.urlKey)}/`)
        }

        const urlKey = validateWorkspaceUrlKey(creds.login) ? creds.login : `gh-${creds.userId}`
        workspace = {
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
        linkProvider(workspace, provider.name, slug, credentials)
      }

      // Preserve existing workspaces across the fixation-preventing regenerate
      // (mirrors the Linear callback).
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
              console.error(log.regenerateError, regenerateErr)
              return res.status(500).send(renderErrorPage('Session Error', 'Could not create a secure session. Please try again.', {
                action: 'Try again', actionUrl: basePath
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
            // identity lookup even with no live session.accountId, same as
            // the Linear OAuth callback.
            // LIN-2267 (review F2): snapshot BEFORE upsertWorkspace, so a
            // conflict return can restore it — mirrors routes/auth.js:348.
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
              req.session.workspaces = workspacesBeforeLogin
              return await respondToAccountConflict({
                req, res, established, workspace, mode: 'new', returnUrlKey: workspace.urlKey,
                identityLabel: 'GitHub', reauthUrl: basePath, provider: providerOkKey
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
            console.error(log.postRegenerateCatch, err)
            if (!res.headersSent) {
              res.status(500).send(renderErrorPage('Something Went Wrong', copy.linkFailBody, {
                action: 'Try again', actionUrl: basePath, diagnostic: githubErrorDiagnostic(err)
              }))
            }
          } finally {
            resolve()
          }
        })
      })
    } catch (err) {
      console.error(log.linkCatch, err)
      res.status(500).send(renderErrorPage('Something Went Wrong', copy.linkFailBody, {
        action: 'Try again', actionUrl: basePath, diagnostic: githubErrorDiagnostic(err)
      }))
    }
  })

  return router
}
