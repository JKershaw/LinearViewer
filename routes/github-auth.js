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
 *
 * The shared two-step orchestration (redirect -> callback -> mint -> establish
 * -> merge) lives in lib/github-install-flow.js (LIN-2397, pure move) —
 * identical to routes/github-projects-auth.js's, parameterised by the
 * descriptor below. This file keeps only what is genuinely repo-specific: the
 * slug regex, the repo-picker renderer, and the descriptor's copy/knobs.
 */
import { renderGitHubRepoSelectPage } from '../lib/render-pages.js'
import { createGitHubInstallFlowRoutes } from '../lib/github-install-flow.js'

// A GitHub issues binding's scope is an `owner/name` repo slug. Validate the
// shape of the picked repo before writing it as a binding scope.
const REPO_SLUG_REGEX = /^[\w.-]+\/[\w.-]+$/

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
  return createGitHubInstallFlowRoutes({
    sessionStore, provider, accountStore, accountWorkspaceStore, userPreferencesStore,

    basePath: '/auth/github',
    providerOkKey: 'github',
    pendingKey: 'githubPending',
    notConfiguredLead: 'GitHub login is not available.',

    bodyField: 'repo',
    slugRegex: REPO_SLUG_REGEX,
    rebindMapKey: 'repoInstallations',
    listReboundable: (p, userToken) => p.listReboundableRepos(userToken),
    rebindSlugOf: (r) => r.slug,
    listChoices: (p, creds) => p.listRepos(creds.token),
    renderPicker: (choices, opts) => renderGitHubRepoSelectPage(choices, opts),

    log: {
      beginAuth: 'GitHub beginAuth error:',
      rebindExchange: 'GitHub re-bind code exchange error:',
      viewerLookup: 'GitHub viewer lookup error:',
      enumerateReboundable: 'Failed to enumerate GitHub installations for re-bind:',
      beginInstall: 'GitHub beginInstall error:',
      installMint: 'GitHub App installation-token mint error:',
      listChoicesFail: 'Failed to fetch installation repositories from GitHub:',
      callbackCatch: 'GitHub App callback error:',
      regenerateError: 'GitHub session regeneration error:',
      postRegenerateCatch: 'GitHub post-regenerate callback error:',
      linkCatch: 'GitHub link error:',
    },

    copy: {
      linkSessionExpiredAction: 'Sign in with GitHub',
      invalidSlugTitle: 'Invalid Repository',
      invalidSlugBody: 'That does not look like a valid "owner/name" repository. Please pick a repository.',
      notInMapBody: 'That repository is not one of your installed GitHub repositories. Please pick one from the list.',
      fetchFailBody: 'Could not fetch your repositories from GitHub. Please try again.',
      linkFailBody: 'Could not link your GitHub repository. Please try again.',
    },
  })
}
