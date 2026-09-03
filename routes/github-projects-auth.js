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
 *
 * The shared two-step orchestration (redirect -> callback -> mint -> establish
 * -> merge) lives in lib/github-install-flow.js (LIN-2397, pure move) —
 * identical to routes/github-auth.js's, parameterised by the descriptor below.
 * This file keeps only what is genuinely board-specific: the slug regex, the
 * board-picker renderer, and the descriptor's copy/knobs.
 */
import { renderGitHubProjectSelectPage } from '../lib/render-pages.js'
import { createGitHubInstallFlowRoutes } from '../lib/github-install-flow.js'

// A Projects binding's scope is an `org/projectNumber` board slug: an owner login
// followed by a NUMERIC board number. Validate the shape before writing it.
const BOARD_SLUG_REGEX = /^[\w.-]+\/\d+$/

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
  return createGitHubInstallFlowRoutes({
    sessionStore, provider, accountStore, accountWorkspaceStore, userPreferencesStore,

    basePath: '/auth/github-projects',
    providerOkKey: 'github-projects',
    pendingKey: 'githubProjectsPending',
    notConfiguredLead: 'GitHub Projects is not available.',

    bodyField: 'board',
    slugRegex: BOARD_SLUG_REGEX,
    rebindMapKey: 'boardInstallations',
    listReboundable: (p, userToken) => p.listReboundableBoards(userToken),
    rebindSlugOf: (b) => `${b.login}/${b.number}`,
    listChoices: (p, creds) => p.listBoards(creds.token, creds.login),
    renderPicker: (choices, opts) => renderGitHubProjectSelectPage(choices, opts),

    log: {
      beginAuth: 'GitHub Projects beginAuth error:',
      rebindExchange: 'GitHub Projects re-bind code exchange error:',
      viewerLookup: 'GitHub Projects viewer lookup error:',
      enumerateReboundable: 'Failed to enumerate GitHub Projects boards for re-bind:',
      beginInstall: 'GitHub Projects beginInstall error:',
      installMint: 'GitHub Projects installation-token mint error:',
      listChoicesFail: 'Failed to list GitHub Projects boards:',
      callbackCatch: 'GitHub Projects callback error:',
      regenerateError: 'GitHub Projects session regeneration error:',
      postRegenerateCatch: 'GitHub Projects post-regenerate callback error:',
      linkCatch: 'GitHub Projects link error:',
    },

    copy: {
      linkSessionExpiredAction: 'Connect GitHub Projects',
      invalidSlugTitle: 'Invalid Project Board',
      invalidSlugBody: 'That does not look like a valid "org/projectNumber" board. Please pick a board.',
      notInMapBody: 'That board is not one of your installed GitHub project boards. Please pick one from the list.',
      fetchFailBody: 'Could not fetch your project boards from GitHub. Please try again.',
      linkFailBody: 'Could not link your GitHub project board. Please try again.',
    },
  })
}
