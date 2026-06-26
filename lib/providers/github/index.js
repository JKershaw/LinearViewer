// =============================================================================
// GitHub Issues Provider (LIN-178) — the abstraction's first FOREIGN backend
// =============================================================================
//
// Where the Local provider (LIN-356) was a self-designed backend built to fit
// the canonical model, GitHub Issues is a genuinely hostile third-party schema:
//   * no subtasks        — issues have no parent/child hierarchy
//   * no estimates        — there is no story-point field
//   * repos, not teams    — work is partitioned by repository, not by "team"
//   * binary state        — an issue is only `open` / `closed`, never a
//                           multi-step workflow
// Surviving that schema unchanged is the whole point of this ticket: it proves
// the canonical state model + provider contract are real abstractions, not a
// Linear shape wearing a trench coat.
//
// Scope (LIN-178, per the finalized scope comments): GitHub **Issues only**.
// GitHub Projects (column→state mapping) is a separate provider/ticket, and the
// OAuth login flow, login-page provider selection, and workspace-switcher icons
// are LIN-541. This module is the provider mapping + capability declaration only.
//
// --- Token / repo / auth split (mirrors LocalProvider's token semantics) ------
// The landed read seam (LIN-356 / PR #382) calls every provider as
// `provider.fetchX(getWorkspaceToken(workspace), …)`. The Local provider treats
// that token as its STORE PARTITION KEY. The GitHub provider treats the per-call
// first argument as the **call scope** — which repo to read/write AND, on the
// GitHub App path, the credential that authenticates the call.
//
// Two scope shapes are accepted (see `_clientFor`):
//   * a bare `owner/name` repo STRING → authenticate via the boot `client`
//     (configure({ client })). The legacy single-account path: one configured
//     client serves every repo on that account; the per-call string picks the
//     repo. Used by the unit tests and any deploy that injects a client at boot.
//   * a `{ repo, token }` BINDING CREDENTIAL → build a REQUEST-TIME client from
//     the installation `token` (createGitHubClient) and read `repo` per call.
//     This is the GitHub App credential path (LIN-713): production NEVER
//     configures a boot client (server.js wires only the local provider; the
//     boot `client` is configured only in routes/test.js), so the stored
//     installation token is what mints a working request-time auth header. The
//     repo slug is still the per-call argument — never hoisted to boot config.
// One configured client (one account / PAT) therefore serves the boot path; the
// binding credential carries its own installation token on the App path.
//
// --- Capability profile (LIN-178) --------------------------------------------
//   write:     true  → overrides getCreateTaskUrl (what ui.write derives from) +
//                      implements createIssue/updateIssue/createComment
//   comments:  true  → implements fetchIssueComments
//   labels:    true  → implements addLabel/removeLabel/labels
//   subtasks:  false → ui getter (GitHub issues have no hierarchy)
//   estimates: false → ui getter (no estimate field)
//   teams:     false → fetchTeams returns [] (repos are the team analog, but the
//                      canonical `teams` surface stays empty — not a throw, so the
//                      dashboard's fetchAndPrepareProjects works unchanged)
// Relations are NOT implemented: GitHub has no native typed issue relations, so
// createRelation stays the base NotImplementedError decline (supports() === false).

import { ProviderInterface, AuthExchangeError } from '../interface.js'
import { registerProvider } from '../registry.js'
import { SOURCE_GITHUB } from '../models.js'
import { createGitHubClient } from './client.js'
import { getAppConfig, mintInstallationToken, fetchInstallation } from './app-auth.js'
import { createGitHubAuthRoutes } from '../../../routes/github-auth.js'

export { createGitHubClient } from './client.js'

// GitHub OAuth endpoints (web application flow). Classic OAuth App tokens do
// not expire and carry no refresh token, so completeAuth normalizes to a token
// bag with no `refresh_token`/`expires_in` — the link path stamps a MAX expiry
// so the refresh middleware skips it (mirrors the local/PAT credential shape).
const GITHUB_OAUTH_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize'
const GITHUB_OAUTH_TOKEN_URL = 'https://github.com/login/oauth/access_token'
// GitHub App installation base — `https://github.com/apps/<slug>/installations/new`
// is where the user picks which repos the App may access (LIN-708). This replaces
// the OAuth authorize URL for the begin step of the GitHub App migration (LIN-703).
const GITHUB_APP_INSTALL_BASE = 'https://github.com/apps'

// -----------------------------------------------------------------------------
// Pure state mapping — GitHub open/closed (+ state_reason) → canonical state.
// -----------------------------------------------------------------------------
//
// GitHub issue state is binary (`open` / `closed`) with an optional
// `state_reason` on closed issues (`completed` | `not_planned` | `reopened`).
// The canonical model has no "in progress" signal GitHub can supply, so an open
// issue maps to `unstarted` (the neutral "to do" — ○), never `started`: claiming
// every open issue is in-progress would be a lie the schema does not support.
//   open                         → unstarted  (To Do)
//   closed, reason not_planned   → canceled   (treated like Linear's canceled)
//   closed (completed / default) → completed  (Done)
// Exported so the mapping is unit-testable in isolation (mirrors state-map.js).
export function githubStateToCanonical(issue = {}) {
  if (issue.state === 'closed') {
    if (issue.state_reason === 'not_planned') {
      return { name: 'Closed (not planned)', type: 'canceled' }
    }
    return { name: 'Closed', type: 'completed' }
  }
  return { name: 'Open', type: 'unstarted' }
}

/**
 * Canonical workflow states the GitHub provider exposes (states() read).
 * GitHub has no native workflow — these are the two real states an issue can be
 * in, each mapping 1:1 onto a canonical state.type.
 */
const GITHUB_STATES = [
  { id: 'open', name: 'Open', type: 'unstarted', position: 0 },
  { id: 'closed', name: 'Closed', type: 'completed', position: 1 },
]

/** Split an `owner/name` repo slug into its parts. */
function parseRepo(repo) {
  const [owner, name] = String(repo || '').split('/')
  return { owner: owner || '', name: name || '' }
}

export class GitHubProvider extends ProviderInterface {
  /**
   * @param {{ client?: object, repo?: string, clientFactory?: (token: string) => object }} [opts]
   *   client        — the GitHub REST boundary (see client.js / fake-client.js).
   *   repo          — default `owner/name` used ONLY by getCreateTaskUrl (the "+
   *                   Add task" deep link); reads/writes take the repo per call.
   *   clientFactory — test/DI seam (LIN-713): builds the PER-REQUEST client from a
   *                   token. Production leaves it unset, so `_clientForToken`
   *                   mints a real createGitHubClient; tests inject the fake so the
   *                   request-time path runs offline.
   */
  constructor({ client, repo, clientFactory } = {}) {
    super()
    this.name = 'github'
    this.client = client || null
    this.repo = repo || null
    this.clientFactory = clientFactory || null
  }

  /**
   * Inject the client (and optional default repo / per-request client factory) at
   * server boot, keeping registration import-driven while allowing dependency
   * injection of the HTTP boundary — exactly LocalProvider.configure({ store }).
   * @returns {this}
   */
  configure({ client, repo, clientFactory } = {}) {
    if (client) this.client = client
    if (repo) this.repo = repo
    if (clientFactory) this.clientFactory = clientFactory
    return this
  }

  _requireClient() {
    if (!this.client) {
      throw new Error('GitHubProvider: client not configured (call configure({ client }) at boot)')
    }
    return this.client
  }

  /**
   * Resolve the REST client + repo slug for a single read/write call (LIN-713).
   *
   * The per-call `scope` is either:
   *   - a bare `owner/name` STRING → authenticate via the boot `client`
   *     (`_requireClient`). Legacy single-account path; unchanged behaviour for
   *     the unit tests and any boot-configured deploy.
   *   - a `{ repo, token }` BINDING CREDENTIAL → build a REQUEST-TIME client from
   *     the installation `token` (`_clientForToken` → createGitHubClient) and take
   *     the repo from `repo`. The GitHub App path: production never configures a
   *     boot client, so the stored installation token authorizes the request.
   *
   * Either way the repo slug is the per-call argument. A credential missing its
   * installation token is a hard error (no silent fall-through to a boot client
   * that production does not have).
   * @param {string | {repo?: string, token?: string}} scope
   * @returns {{ client: object, repo: string|null }}
   */
  _clientFor(scope) {
    if (scope && typeof scope === 'object') {
      const { token, repo } = scope
      if (!token) {
        throw new Error('GitHubProvider: binding credential is missing an installation token (cannot build a request-time client)')
      }
      return { client: this._clientForToken(token), repo: repo ?? null }
    }
    return { client: this._requireClient(), repo: scope }
  }

  // ---------------------------------------------------------------------------
  // Shape mapping: GitHub REST issue → canonical issue (mirrors LocalProvider).
  // ---------------------------------------------------------------------------
  _toCanonicalIssue(gh) {
    const milestone = gh.milestone || null
    return {
      source: SOURCE_GITHUB, // provenance stamp (LIN-561)
      id: String(gh.number),
      identifier: `#${gh.number}`,
      title: gh.title,
      description: gh.body ?? '',
      estimate: null, // GitHub has no estimates (capability: estimates:false)
      priority: 0,
      sortOrder: gh.number,
      createdAt: gh.created_at,
      dueDate: milestone?.due_on ?? null,
      completedAt: gh.closed_at ?? null,
      url: gh.html_url ?? null,
      parent: null, // GitHub issues have no hierarchy (capability: subtasks:false)
      project: milestone
        ? { id: String(milestone.number), name: milestone.title }
        : null,
      state: githubStateToCanonical(gh),
      assignee: gh.assignee ? { name: gh.assignee.login } : null,
      labels: { nodes: (gh.labels || []).map(l => ({ name: typeof l === 'string' ? l : l.name })) },
      // No native typed relations on GitHub — always empty (createRelation is
      // declined). The dependency views read this shape and find no edges.
      relations: { nodes: [] },
    }
  }

  /** GitHub milestone → canonical project. */
  _toCanonicalProject(milestone) {
    return {
      id: String(milestone.number),
      name: milestone.title,
      content: milestone.description ?? null,
      url: milestone.html_url ?? null,
      sortOrder: milestone.number ?? 0,
    }
  }

  /**
   * The repo binding itself → a canonical project/container (LIN-718).
   *
   * GitHub milestones are optional, so a repo can have zero milestones AND zero
   * issues — and milestones-only `projects` then yields no container at all, so
   * an installed repo renders nothing in the tree (no fallback fires either: the
   * synthetic 'No Project' group is added only when a milestone-less issue
   * exists). Linear/Local both list projects independently of issues, so their
   * empty projects surface for free; emitting a per-repo container here makes
   * GitHub behave the same — an installed repo always has at least one container.
   *
   * Its `id` is the `owner/name` slug (milestone ids are numeric, NO_PROJECT is
   * `__no_project__`, so this never collides with either), and `sortOrder: 0`
   * sorts it above the repo's milestones. No issue references the slug as its
   * `project.id`, so the container's forest roots are empty — exactly the
   * empty-state the renderer already draws for an empty Linear/Local project.
   */
  _toRepoContainerProject(repo) {
    const { owner, name } = parseRepo(repo)
    const slug = owner && name ? `${owner}/${name}` : String(repo || 'github')
    return {
      id: slug,
      name: slug,
      content: null,
      url: owner && name ? `https://github.com/${owner}/${name}` : null,
      sortOrder: 0,
    }
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  /**
   * Projects + issues for the dashboard. `repo` is the `owner/name` slug.
   * Milestones become canonical projects; issues without a milestone have
   * `project: null` (the dashboard groups them in the cross-project sections).
   * @returns {Promise<{organizationName, projects, issues}>}
   */
  async fetchProjects(scope, _teamId = null, _opts = {}) {
    const { client, repo } = this._clientFor(scope)
    const [issues, milestones] = await Promise.all([
      client.listIssues(repo),
      client.listMilestones(repo),
    ])
    const { owner } = parseRepo(repo)
    return {
      organizationName: owner || 'GitHub',
      // The repo binding is always emitted as a container (LIN-718), so an
      // installed repo with zero milestones/issues still renders an empty
      // GitHub Issues container. Milestones follow as their own projects.
      projects: [this._toRepoContainerProject(repo), ...milestones.map(m => this._toCanonicalProject(m))],
      issues: issues.map(gh => this._toCanonicalIssue(gh)),
    }
  }

  /** Lightweight project list (milestones only, no issues). */
  async fetchProjectsList(scope) {
    const { client, repo } = this._clientFor(scope)
    const milestones = await client.listMilestones(repo)
    return milestones.map(m => this._toCanonicalProject(m))
  }

  /**
   * Repos are GitHub's team analog, but the canonical `teams` surface stays
   * EMPTY (capability teams:false). Returning [] rather than throwing keeps the
   * dashboard's fetchAndPrepareProjects provider-agnostic — same A⇄D contract
   * the Local provider documents.
   */
  async fetchTeams(_scope) {
    return []
  }

  /** A single GitHub issue → the same canonical render shape fetchProjects emits. */
  async fetchIssueFields(scope, issueId) {
    const { client, repo } = this._clientFor(scope)
    const gh = await client.getIssue(repo, issueId)
    if (!gh) throw new Error(`Issue not found: ${issueId}`)
    return this._toCanonicalIssue(gh)
  }

  /**
   * Single-issue context for the detail/recommendation surfaces. GitHub issues
   * are flat, so there is no parent and no children; siblings/cousins are empty.
   * Mirrors the Local provider's fetchIssueContext shape.
   */
  async fetchIssueContext(scope, issueId) {
    const { client, repo } = this._clientFor(scope)
    const gh = await client.getIssue(repo, issueId)
    if (!gh) throw new Error(`Issue not found: ${issueId}`)
    const milestone = gh.milestone || null
    return {
      issue: {
        id: String(gh.number),
        identifier: `#${gh.number}`,
        title: gh.title,
        description: gh.body ?? '',
        url: gh.html_url ?? null,
        state: githubStateToCanonical(gh),
        // Flat name array, matching the Linear/Local fetchIssueContext contract
        // the prompt (formatLabels) + AI-recommend consumers read (LIN-406).
        labels: (gh.labels || []).map(l => (typeof l === 'string' ? l : l.name)),
      },
      parent: null,
      siblings: [],
      siblingsTotal: 0,
      parentChildCount: null,
      cousins: [],
      cousinsTotal: 0,
      project: milestone ? { name: milestone.title, description: milestone.description ?? null } : null,
      children: [],
      // Pass `scope` (not the resolved `repo`) so the nested read rebuilds the
      // same per-request client from the binding credential on the App path.
      comments: await this.fetchIssueComments(scope, issueId),
    }
  }

  /**
   * Recommendation/recap/brief context. GitHub issues never have children, so
   * this is always the leaf case: return the context as-is with no focusedChild,
   * regardless of noDescend. (Mirrors the Local provider's leaf branch.)
   */
  async fetchRecommendationContext(scope, issueId, _opts = {}) {
    return this.fetchIssueContext(scope, issueId)
  }

  /** Comments for an issue, oldest-first. Implementing this sets ui.comments=true. */
  async fetchIssueComments(scope, issueId) {
    const { client, repo } = this._clientFor(scope)
    const comments = await client.listComments(repo, issueId)
    return (comments || [])
      .map(c => ({
        id: String(c.id),
        body: c.body,
        createdAt: c.created_at,
        user: c.user?.login || 'github',
      }))
      .sort((a, b) => (new Date(a.createdAt).getTime() || 0) - (new Date(b.createdAt).getTime() || 0))
  }

  /** Substring/qualifier search over the repo's issues. */
  async search(scope, query) {
    const { client, repo } = this._clientFor(scope)
    const issues = await client.searchIssues(repo, query)
    return issues.map(gh => this._toCanonicalIssue(gh))
  }

  /** The two canonical workflow states a GitHub issue can occupy. */
  async states(_repo, _teamId = null) {
    return GITHUB_STATES.map(s => ({ ...s }))
  }

  /** Distinct labels defined on the repo. */
  async labels(scope) {
    const { client, repo } = this._clientFor(scope)
    const labels = await client.listLabels(repo)
    return labels.map(l => ({ id: l.name, name: l.name, color: l.color ?? null }))
  }

  // ---------------------------------------------------------------------------
  // URLs / UI capability surface
  // ---------------------------------------------------------------------------

  /**
   * GitHub "new issue" deep link. Overriding this is what makes `ui.write` true
   * (render gates "+ Add task" on it). Uses the configured default repo — the
   * per-workspace repo binding is LIN-541, so V1 is single-repo. `_urlKey`/
   * `_projectId` are accepted for interface parity but GitHub's new-issue URL is
   * repo-scoped, not project-scoped.
   */
  getCreateTaskUrl(_urlKey, _projectId) {
    const { owner, name } = parseRepo(this.repo)
    return owner && name
      ? `https://github.com/${owner}/${name}/issues/new`
      : 'https://github.com/issues/new'
  }

  /**
   * write/comments auto-derive from the base getter (getCreateTaskUrl override +
   * fetchIssueComments). Override only the abstract flags GitHub cannot back:
   * subtasks (no hierarchy) and estimates (no estimate field), plus displayName.
   */
  get ui() {
    return { ...super.ui, estimates: false, subtasks: false, displayName: 'GitHub Issues' }
  }

  // ---------------------------------------------------------------------------
  // Auth — the GitHub consumer of the LIN-562 binding seam (LIN-541)
  // ---------------------------------------------------------------------------
  //
  // GitHub auth is its OWN router (routes/github-auth.js) mounted at /auth/github
  // rather than reusing the Linear-only routes/auth.js (/auth/linear,
  // /auth/callback): GitHub login is a two-step flow (OAuth → repo picker) and
  // has no org-derived identity, so generalizing the Linear path would not be
  // byte-identical. The provider supplies the credential-ACQUISITION primitives
  // (beginAuth/completeAuth, mirroring Linear) and the router drives linkProvider.

  /**
   * Build the GitHub App installation redirect URL (LIN-708 — surface 2 of the
   * LIN-703 GitHub App migration). The user is sent to the App's installation
   * picker to choose which repos the App may access; access (Issues: read &
   * write) is declared by the App's permissions, NOT by an OAuth scope.
   *
   * This replaces the OAuth authorize URL + `scope: 'repo read:user'`. Dropping
   * `scope` removes the residual `repo` over-grant — all-or-nothing across every
   * private repo — that an OAuth App could not narrow (security M1, LIN-683).
   * The OAuth-only params (`client_id`, `redirect_uri`, `allow_signup`) are gone
   * too: the App identifies itself by slug, and the callback / installation-token
   * mint (`installation_id`) is surface 3 / LIN-709, out of scope here.
   *
   * `state` is an opaque CSRF nonce minted by the route, passed through
   * unchanged; intent (new container vs add-source) stays server-side in the
   * session, NOT encoded here.
   *
   * @param {{ state: string }} args
   * @returns {string} The `https://github.com/apps/<slug>/installations/new?state=<nonce>` URL.
   * @throws {Error} if `GITHUB_APP_SLUG` is unset (would otherwise emit a broken
   *   `apps/undefined/...` URL).
   */
  beginAuth({ state }) {
    const { slug } = getAppConfig()
    if (!slug) {
      throw new Error('GitHub App auth: GITHUB_APP_SLUG is not configured; cannot build the App installation URL')
    }
    const params = new URLSearchParams({ state })
    return `${GITHUB_APP_INSTALL_BASE}/${encodeURIComponent(slug)}/installations/new?${params}`
  }

  /**
   * Exchange an OAuth authorization code for a GitHub access token (LIN-562).
   * Throws {@link AuthExchangeError} on a non-2xx response or an error payload —
   * GitHub returns HTTP 200 with an `{ error }` body on a bad code — so the
   * shared callback renders a clean "could not authenticate" page, not a 500.
   * @param {string} code - The authorization code from the OAuth redirect.
   * @returns {Promise<{access_token: string}>} Normalized token bag.
   */
  async completeAuth(code) {
    const response = await fetch(GITHUB_OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        redirect_uri: process.env.GITHUB_REDIRECT_URI,
        code,
      }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok || data.error || !data.access_token) {
      throw new AuthExchangeError(data.error || `HTTP ${response.status}`, this.name)
    }
    return { access_token: data.access_token }
  }

  /**
   * Acquire an installation credential + identity from a GitHub App installation
   * id (LIN-709 — surface 3 of the LIN-703 App migration). Mints an installation
   * access token (surface-1 `mintInstallationToken`) and resolves the installation's
   * `account` (surface-1 `fetchInstallation`) for the workspace identity. This is
   * the App-flow replacement for `completeAuth(code)` + `fetchViewer`: an
   * installation token cannot call `/user`, so identity comes from the installation
   * itself. The route (routes/github-auth.js) drives this through the provider so
   * the acquisition seam stays consistent with beginAuth/listRepos.
   *
   * @param {string|number} installationId - the `installation_id` from the
   *   /auth/github/callback query.
   * @returns {Promise<{token: string, login: string, userId: string, installationId: string, tokenExpiresAt: string}>}
   *   `token` is the installation access token; `login`/`userId` are the
   *   installation account identity; `tokenExpiresAt` is GitHub's raw `expires_at`
   *   ISO string — the binding-shape surface (LIN-711) converts it to real ms and
   *   persists `installationId` as the re-mint key.
   */
  async completeInstallation(installationId) {
    const tokenBag = await mintInstallationToken(installationId)
    const installation = await fetchInstallation(installationId)
    const account = installation?.account || {}
    return {
      token: tokenBag.token,
      login: account.login,
      userId: String(account.id),
      installationId: String(installationId),
      tokenExpiresAt: tokenBag.expires_at,
    }
  }

  /**
   * Re-mint the installation access token for a GitHub App binding (LIN-712 —
   * surface 6 of the LIN-703 App migration). GitHub App installation tokens are
   * short-lived (~1h) and carry NO `refresh_token`: they are RE-MINTED from the
   * App JWT + `installationId`, not exchanged via an OAuth refresh endpoint. This
   * is the refresh-middleware counterpart to {@link completeInstallation} — the
   * same `mintInstallationToken` mint, but keyed off the persisted binding rather
   * than a fresh install callback.
   *
   * Returns a credentials PATCH in the binding's own shape: `{ token,
   * tokenExpiresAt (real ms epoch), installationId }`. The caller folds it back
   * through `linkProvider`, which merges over the existing binding, so any other
   * binding-only field survives. Deliberately emits NO `refreshToken` — a GitHub
   * binding never has one, and emitting one would route it back through the
   * Linear refresh path the migration is steering it away from.
   *
   * `tokenExpiresAt` is converted to ms here (mirroring `installationExpiryMs` in
   * routes/github-auth.js) with the same strict contract: a missing/unparseable
   * expiry is a hard error, never a silent never-expires fallback.
   *
   * @param {{credentials?: {installationId?: string}}} binding - the GitHub
   *   binding to refresh; its `installationId` is the re-mint key.
   * @param {{fetchImpl?: Function, now?: number}} [opts] - injectable network/time
   *   seams (forwarded to mintInstallationToken) for deterministic tests.
   * @returns {Promise<{token: string, tokenExpiresAt: number, installationId: string}>}
   */
  async refreshCredential(binding, { fetchImpl, now } = {}) {
    const installationId = binding?.credentials?.installationId
    if (!installationId) {
      throw new Error('GitHub credential refresh: binding is missing installationId (cannot re-mint)')
    }
    const tokenBag = await mintInstallationToken(installationId, { fetchImpl, now })
    const tokenExpiresAt = Date.parse(tokenBag.expires_at)
    if (!Number.isFinite(tokenExpiresAt)) {
      throw new Error(`GitHub credential refresh: invalid installation token expiry: ${tokenBag.expires_at}`)
    }
    return { token: tokenBag.token, tokenExpiresAt, installationId: String(installationId) }
  }

  /**
   * The authenticated GitHub user for an OAuth token. Distinct from the boot
   * `client` (a single-account PAT for repo reads): OAuth tokens are per-user, so
   * this builds a per-token client. Implementing it also makes the settings
   * refresh/test probe validate a GitHub binding's credential.
   * @param {string} token - A GitHub OAuth/PAT access token.
   * @returns {Promise<{id: string, login: string, name: string|null}>}
   */
  async fetchViewer(token) {
    const user = await this._clientForToken(token).getAuthenticatedUser()
    return { id: String(user.id), login: user.login, name: user.name || null }
  }

  /**
   * Repositories the App installation was granted, for the post-install repo
   * picker (LIN-710). Under the GitHub App model (LIN-703) this is the install-time
   * selection — not every repo the user can reach — surfaced by the client's
   * `/installation/repositories` read. Each becomes a candidate `owner/name` scope
   * for a GitHub issues binding (LIN-541). The installation-shaped repo objects
   * carry the same `full_name`/`private` fields as the old `/user/repos` payload, so
   * the mapping below is unchanged.
   * @param {string} token - The installation access token the per-call client is
   *   built with (the OAuth user token under the legacy path; threading the
   *   installation token from the binding is LIN-711/LIN-713).
   * @returns {Promise<Array<{slug: string, name: string, private: boolean}>>}
   */
  async listRepos(token) {
    const repos = await this._clientForToken(token).listRepos()
    return repos.map(r => ({
      slug: r.full_name,
      name: r.full_name,
      private: !!r.private,
    }))
  }

  /**
   * Per-token REST client (never the single-account boot client). Builds a
   * real createGitHubClient in production; a configured `clientFactory` (test/DI
   * seam, LIN-713) overrides it so the request-time path can run against the
   * in-memory fake offline. Used by the OAuth reads (fetchViewer/listRepos) and
   * by `_clientFor`'s binding-credential branch.
   */
  _clientForToken(token) {
    return this.clientFactory ? this.clientFactory(token) : createGitHubClient({ token })
  }

  /**
   * The GitHub OAuth router (LIN-541). Mounted by server.js's per-provider
   * auth-mount loop (it iterates getAllProviders().getAuthRouter()). Mirrors
   * LinearProvider.getAuthRouter — folds routes/github-auth.js behind the
   * provider and injects `this` so the route drives the provider's seam.
   * @param {{sessionStore: Object, userPreferencesStore: Object}} opts
   * @returns {import('express').Router}
   */
  getAuthRouter(opts) {
    return createGitHubAuthRoutes({ ...opts, provider: this })
  }

  // ---------------------------------------------------------------------------
  // Writes
  // ---------------------------------------------------------------------------

  /** @returns {Promise<Object>} the created issue (canonical shape). */
  async createIssue(scope, input = {}) {
    const { client, repo } = this._clientFor(scope)
    const gh = await client.createIssue(repo, {
      title: input.title,
      body: input.description ?? input.body ?? '',
      labels: input.labels || [],
      milestone: input.projectId != null ? Number(input.projectId) : undefined,
    })
    return this._toCanonicalIssue(gh)
  }

  /**
   * Update an issue. A canonical `state` patch maps back to GitHub's open/closed
   * (+ state_reason): terminal canceled → closed/not_planned, other terminal →
   * closed/completed, any non-terminal → reopened/open.
   * @returns {Promise<Object|null>} updated issue (canonical), or null if missing.
   */
  async updateIssue(scope, issueId, patch = {}) {
    const { client, repo } = this._clientFor(scope)
    const ghPatch = {}
    if (patch.title != null) ghPatch.title = patch.title
    if (patch.description != null || patch.body != null) {
      ghPatch.body = patch.description ?? patch.body
    }
    if (patch.state?.type) {
      const type = patch.state.type
      if (type === 'completed') { ghPatch.state = 'closed'; ghPatch.state_reason = 'completed' }
      else if (type === 'canceled' || type === 'duplicate') { ghPatch.state = 'closed'; ghPatch.state_reason = 'not_planned' }
      else { ghPatch.state = 'open'; ghPatch.state_reason = 'reopened' }
    }
    const gh = await client.updateIssue(repo, issueId, ghPatch)
    if (!gh) return null
    return this._toCanonicalIssue(gh)
  }

  /** @returns {Promise<Object>} the created comment (canonical shape). */
  async createComment(scope, issueId, body) {
    const { client, repo } = this._clientFor(scope)
    const c = await client.createComment(repo, issueId, body)
    if (!c) throw new Error(`Issue not found: ${issueId}`)
    return { id: String(c.id), body: c.body, createdAt: c.created_at, user: c.user?.login || 'github' }
  }

  /** @returns {Promise<boolean>} */
  async addLabel(scope, issueId, label) {
    const { client, repo } = this._clientFor(scope)
    return client.addLabel(repo, issueId, label)
  }

  /** @returns {Promise<boolean>} */
  async removeLabel(scope, issueId, label) {
    const { client, repo } = this._clientFor(scope)
    return client.removeLabel(repo, issueId, label)
  }
}

/** Singleton GitHub provider (client injected at boot via configure()). */
export const githubProvider = new GitHubProvider()

// Module-load self-registration (see registry.js header for the lifecycle
// rationale). Importing this module is what populates the registry under
// 'github'; the boot wiring (LIN-541) injects the authenticated client.
registerProvider(githubProvider)
