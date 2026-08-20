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

import { ProviderInterface } from '../interface.js'
import { registerProvider } from '../registry.js'
import { SOURCE_GITHUB } from '../models.js'
// The one "this reference cannot be resolved" error class both write surfaces
// (routes/proxy.js `refResolutionFailed`, routes/workspace-api.js
// `issueRefResolutionFailed`) already map to a clean 422 (LIN-1559 — see
// `githubStateIdToCanonicalType`). A leaf module (it imports only workspace.js +
// models.js), so this adds no cycle.
import { RefResolutionError } from '../../proxy-ref-resolver.js'
import { createGitHubClient } from './client.js'
import { mintInstallationToken, fetchInstallation, buildAuthorizeUrl, buildInstallUrl, exchangeOAuthCode, isGitHubConfigured } from './app-auth.js'
import { createGitHubAuthRoutes } from '../../../routes/github-auth.js'

export { createGitHubClient } from './client.js'

// The GitHub App auth URLs (authorize / token / installation) live in the shared
// app-auth seam now (LIN-735) — beginAuth/beginInstall/completeAuth delegate there
// so the Issues and Projects providers build identical URLs.

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

/**
 * Resolve one of THIS provider's own state ids (`open` / `closed`, as emitted by
 * `states()`) back to a canonical `state.type` (LIN-1559).
 *
 * Why this exists: both PATCH surfaces resolve a symbolic state ref against
 * `states()` and then hand the provider `input.stateId` — the provider's own id,
 * NOT a canonical `state` object. `updateIssue` only ever read `patch.state.type`,
 * so every `stateId` write was silently dropped: a 200 whose issue never moved.
 * An unknown id (e.g. a UUID that the routes' UUID fast-path waved through
 * without consulting `states()`) is a caller error, so it raises the same
 * `RefResolutionError` an unmatched symbolic name would — a loud 422 naming the
 * accepted vocabulary, never a dropped patch and never a 500.
 *
 * @param {string} stateId
 * @returns {string} the canonical state.type
 * @throws {RefResolutionError} 422 when the id is not one this provider emits
 */
export function githubStateIdToCanonicalType(stateId) {
  const match = GITHUB_STATES.find(s => s.id === String(stateId))
  if (match) return match.type
  throw new RefResolutionError(
    `Cannot resolve state '${stateId}' — GitHub issues are only ${GITHUB_STATES.map(s => s.id).join(' or ')}`,
    { status: 422, candidates: GITHUB_STATES.map(s => s.id) },
  )
}

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
      // LIN-1887 F3.3: the ambiguous-binding refusal must fail LOUDLY here.
      // Without this check the marker carries no `token`, so it would land on
      // the throw below with a misleading "missing installation token" message —
      // and, worse, a scope that merely dropped its `repo` would be swallowed
      // silently by the `repo ?? null` default and turn a wrong-repo call into a
      // scope-less one. That is why the github half needed its own explicit
      // failure rather than inheriting Jira's, whose `!apiToken || !site` throw
      // already fails closed.
      if (scope.ambiguousCallScope) {
        throw new Error('GitHubProvider: this workspace has several GitHub bindings and the active one could not be identified — refusing to guess which repo to call')
      }
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

  // LIN-1972: no teamId (no teams). `projectId` means milestone id only —
  // stateId/priority are deliberately NOT declared: createIssue above already
  // silently drops both, and narrowing the contract to match is the interim
  // guard LIN-1557 asks for.
  createFields() {
    return ['title', 'description', 'projectId']
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
   * `attachments: true` (LIN-771): GitHub issues/comments carry body uploads
   * (pasted images + uploaded files on the user-content asset hosts), which the
   * host-anchored collector discovers — so attachments are a supported capability,
   * not a Linear-only one.
   */
  get ui() {
    return { ...super.ui, estimates: false, subtasks: false, attachments: true, displayName: 'GitHub Issues' }
  }

  // ---------------------------------------------------------------------------
  // Identity (LIN-2010)
  // ---------------------------------------------------------------------------

  get landingCatalogue() {
    return { blurb: 'first foreign backend', order: 1 }
  }

  /**
   * `configPredicate` is a row-level gate (F1) — the same `isGitHubConfigured`
   * function reference github-projects declares below, since both share the
   * one GitHub App config.
   */
  get addProvider() {
    return { blockedBy: null, configPredicate: isGitHubConfigured }
  }

  /**
   * Acceptance #4: `isGitHubConfigured` is wider than "one env var present" —
   * all five GITHUB_* vars set AND the private key structurally PEM-valid.
   */
  get entryCta() {
    return { href: '/auth/github', isConfigured: isGitHubConfigured }
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
   * Build the begin URL for the GitHub connect flow (LIN-735). This is the
   * user-to-server OAuth **authorize** URL, NOT `installations/new` — the latter
   * dead-ends for an already-installed App (GitHub shows its configure page and
   * never round-trips a `code`, the LIN-728 bug). The authorize URL ALWAYS returns
   * a `code`, so the callback can exchange it, enumerate the user's installations,
   * and re-pick a repo (re-bind) OR fall through to {@link beginInstall} when the
   * user has no installation yet. One entry now covers fresh-install, add-source,
   * and already-installed re-bind.
   *
   * No `scope` is sent — App permissions declare access, so keeping `repo` would
   * resurrect the over-grant the App migration removed (security M1, LIN-683 /
   * LIN-708). `state` is an opaque CSRF nonce; intent stays server-side (LIN-562).
   *
   * @param {{ state: string }} args
   * @returns {string} the `login/oauth/authorize?client_id=…&state=…` URL.
   * @throws {Error} if `GITHUB_CLIENT_ID` is unset.
   */
  beginAuth({ state }) {
    return buildAuthorizeUrl({ state, redirectUri: process.env.GITHUB_REDIRECT_URI })
  }

  /**
   * Build the App installation URL (`installations/new`) — the fresh-install entry
   * and the callback fallback when an authorize round-trip finds the user has no
   * installation yet (LIN-735). Kept separate from {@link beginAuth} so the
   * already-installed re-bind never lands here (where it dead-ends). `state` is the
   * same opaque CSRF nonce the authorize round-trip carries, reused so the
   * post-install callback still passes the state guard.
   *
   * @param {{ state: string }} args
   * @returns {string} the `apps/<slug>/installations/new?state=<nonce>` URL.
   * @throws {Error} if `GITHUB_APP_SLUG` is unset.
   */
  beginInstall({ state }) {
    return buildInstallUrl({ state })
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
    return exchangeOAuthCode(code, { providerName: this.name, redirectUri: process.env.GITHUB_REDIRECT_URI })
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
   * The App installations the authenticated user administers (LIN-728), used by
   * the already-installed re-bind flow. When an App is already installed, GitHub
   * does NOT re-issue a fresh `installation_id` to the callback — it round-trips
   * an OAuth `code` instead — so there is no install event to act on. This is the
   * Harbour-side path back into binding: exchange the `code` for a user token,
   * enumerate the user's installations, and re-pick a repo. The user token is for
   * DISCOVERY ONLY; the binding still mints/persists an installation token.
   * @param {string} userToken - the user-to-server OAuth token from completeAuth.
   * @returns {Promise<Array<{id: string, account: object|null}>>}
   */
  async listUserInstallations(userToken) {
    const installations = await this._clientForToken(userToken).listUserInstallations()
    return installations.map(i => ({ id: String(i.id), account: i.account || null }))
  }

  /**
   * Flatten the user's installations + their repos into the SAME repo-picker
   * shape `listRepos` emits, plus the `installationId` each repo belongs to
   * (LIN-728). The callback renders this through the existing picker; the link
   * step resolves the chosen repo's `installationId` server-side and mints the
   * installation token for it (never persisting the user token). Carrying
   * `installationId` per repo is what lets one picker span an App installed on
   * several accounts while still binding to the right installation.
   * @param {string} userToken - the user-to-server OAuth token from completeAuth.
   * @returns {Promise<Array<{slug: string, name: string, private: boolean, installationId: string}>>}
   */
  async listReboundableRepos(userToken) {
    const client = this._clientForToken(userToken)
    const installations = await client.listUserInstallations()
    const out = []
    for (const inst of installations) {
      const repos = await client.listUserInstallationRepos(inst.id)
      for (const r of repos) {
        out.push({
          slug: r.full_name,
          name: r.full_name,
          private: !!r.private,
          installationId: String(inst.id),
        })
      }
    }
    return out
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
   *
   * `stateId` (this provider's own `open`/`closed` id, which is what BOTH PATCH
   * routes actually send after resolving a symbolic ref against `states()`) is
   * accepted as an equivalent input and mapped to the same canonical type
   * (LIN-1559 / LIN-1569): before, only `patch.state.type` was read, so a
   * `stateId` write returned 200 with the issue unmoved. An explicit
   * `patch.state.type` still wins; an unresolvable `stateId` throws a 422-shaped
   * RefResolutionError rather than being dropped.
   * @returns {Promise<Object|null>} updated issue (canonical), or null if missing.
   */
  async updateIssue(scope, issueId, patch = {}) {
    const { client, repo } = this._clientFor(scope)
    const ghPatch = {}
    if (patch.title != null) ghPatch.title = patch.title
    if (patch.description != null || patch.body != null) {
      ghPatch.body = patch.description ?? patch.body
    }
    // Validated whenever present, so an unknown id fails loudly even alongside a
    // canonical `state` (never a half-applied patch reported as a full success).
    const stateIdType = patch.stateId != null ? githubStateIdToCanonicalType(patch.stateId) : null
    const stateType = patch.state?.type || stateIdType
    if (stateType) {
      const type = stateType
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

  // ---------------------------------------------------------------------------
  // Write-path guard reads + the label read-modify-write primitive (LIN-1559)
  //
  // The write routes (routes/proxy.js, routes/workspace-api.js) call these
  // UNCONDITIONALLY before mutating — they are route-internal data-fetch, not
  // first-class capabilities, so like their Linear (~2148) and Local (:451)
  // equivalents they stay deliberately OFF the declared PROVIDER_SURFACE
  // (`supports()` is false for all four on EVERY provider; the declaration
  // question is LIN-1557's). Without them every GitHub-backed write route threw
  // a TypeError inside the route's `try` and answered 500 "Linear API request
  // failed" — a server error, naming the wrong backend, for a request that could
  // never succeed.
  //
  // Each mirrors the shape the routes already consume from Linear/Local. GitHub
  // Issues has no soft-delete, so `trashed` is constant false and the routes'
  // 409 branch is dead-but-correct here; a missing issue returns null, which the
  // routes already map to 404.
  // ---------------------------------------------------------------------------

  /**
   * Trashed probe + team scope (`{ id, trashed, team }` or null).
   *
   * `team.id` MUST be non-null: it is what the routes pass to `resolveStateInput`
   * to scope a symbolic `stateId`, which otherwise fails 422 "the issue's team
   * could not be determined". GitHub's `states()` ignores `teamId` entirely, so
   * the repo slug is a stable local placeholder that is never transmitted —
   * exactly LocalProvider's `team: { id: 'local' }` reasoning.
   * @returns {Promise<Object|null>}
   */
  async issueWriteGuard(scope, issueId) {
    const { client, repo } = this._clientFor(scope)
    const gh = await client.getIssue(repo, issueId)
    if (!gh) return null
    return { id: String(gh.number), trashed: false, team: { id: repo || 'github' } }
  }

  /**
   * Lightweight description read (`{ id, description, trashed }` or null) for the
   * description append/replace read-modify-write. GitHub's issue body is the
   * canonical description; an absent body reads as '' (never null), so the
   * routes' `merge(issue.description || '')` sees the same empty-string floor.
   * @returns {Promise<Object|null>}
   */
  async issueDescription(scope, issueId) {
    const { client, repo } = this._clientFor(scope)
    const gh = await client.getIssue(repo, issueId)
    return gh ? { id: String(gh.number), description: gh.body ?? '', trashed: false } : null
  }

  /**
   * Current label set + trashed flag (`{ id, trashed, labels: { nodes } }` or
   * null) for the label add/remove read-modify-write. GitHub labels are
   * name-keyed, so each node is `{ id: name, name }` — matching `labels()`
   * (`id = l.name`) so the routes' `currentLabelIds.includes(resolvedLabelId)`
   * compares like with like.
   * @returns {Promise<Object|null>}
   */
  async issueLabels(scope, issueId) {
    const { client, repo } = this._clientFor(scope)
    const gh = await client.getIssue(repo, issueId)
    if (!gh) return null
    return {
      id: String(gh.number),
      trashed: false,
      labels: { nodes: (gh.labels || []).map(l => {
        const name = typeof l === 'string' ? l : l.name
        return { id: name, name }
      }) },
    }
  }

  /**
   * Write a full label set onto an issue (the write half of the label RMW).
   *
   * Applied as a DIFF over `addLabel`/`removeLabel` — GitHub's real per-label
   * endpoints — rather than a `updateIssue(repo, n, { labels })` PATCH: the whole-
   * set form is not part of the client's method surface (`client.js` exposes
   * add/remove only, and the in-memory fake's `updateIssue` ignores `labels`), so
   * a PATCH here would be both off-contract and unprovable offline. Costs one
   * REST call per CHANGED label; an unchanged set costs none.
   *
   * Returns the issueUpdate-shaped `{ success, issue }` envelope the routes echo
   * through `writeRejected` + `flattenIssue`, re-read after the diff so the echo
   * reflects the persisted labels rather than the requested ones.
   * @returns {Promise<{success: boolean, issue: Object|null}>}
   */
  async updateIssueLabels(scope, issueId, labelIds) {
    const { client, repo } = this._clientFor(scope)
    const gh = await client.getIssue(repo, issueId)
    if (!gh) return { success: false, issue: null }
    const current = (gh.labels || []).map(l => (typeof l === 'string' ? l : l.name))
    const desired = (labelIds || []).map(id => String(id))
    for (const name of desired.filter(n => !current.includes(n))) {
      await client.addLabel(repo, issueId, name)
    }
    for (const name of current.filter(n => !desired.includes(n))) {
      await client.removeLabel(repo, issueId, name)
    }
    const fresh = await client.getIssue(repo, issueId)
    if (!fresh) return { success: false, issue: null }
    return { success: true, issue: this._toCanonicalIssue(fresh) }
  }
}

/** Singleton GitHub provider (client injected at boot via configure()). */
export const githubProvider = new GitHubProvider()

// Module-load self-registration (see registry.js header for the lifecycle
// rationale). Importing this module is what populates the registry under
// 'github'; the boot wiring (LIN-541) injects the authenticated client.
registerProvider(githubProvider)
