// =============================================================================
// GitHub Projects v2 Provider (LIN-560) — a SIBLING to the GitHub Issues provider
// =============================================================================
//
// Split out of LIN-178 per the 2026-06-20 scope decision: GitHub *Issues* and
// GitHub *Projects* are two SEPARATE providers, not one with a mode flag. Issues
// is a REST backend with binary open/closed state and repos-as-teams; a Projects
// v2 board is a materially different shape — a single board with user-defined
// "Status" columns, custom fields, and cross-repo membership — read over GraphQL.
// This module mirrors the proven Issues provider template (self-registering,
// injectable client, real + fake client seam) without modifying it.
//
// --- V1 = READ-ONLY, declared honestly ---------------------------------------
// The first slice renders a board in the dashboard. Capabilities are declared by
// what is implemented (interface.js derives `supports()`/`ui` by prototype diff),
// so the honest profile is:
//   write:     false → getCreateTaskUrl NOT overridden (no "+ Add task" affordance)
//   comments:  false → fetchIssueComments NOT implemented (drafts have none; the
//                      mixed item types make comments a post-V1 question)
//   estimates: false → ui getter (a custom number field COULD map later; not V1)
//   subtasks:  false → ui getter (no item hierarchy in V1)
//   teams:     false → fetchTeams returns [] (a board is not partitioned by team)
//   labels:    read-only display only (carried on canonical issues, no add/remove)
// Live auth (the org/projectNumber project picker + the GitHub App Projects
// permission) is a deliberate second session — exactly how Issues shipped its
// read seam (LIN-178) before LIN-541 added login. No getAuthRouter here, so the
// server's auth-mount loop skips this provider (base throws NotImplementedError).
//
// --- Board model --------------------------------------------------------------
// scope = `org/projectNumber` → ONE canonical container project
// (`_toBoardContainerProject`, mirrors the Issues provider's repo container). All
// board items (issues / PRs / drafts) parent to that container — no sub-grouping
// in V1. Milestones stay with the Issues provider (mapping them here would
// double-map). The same board issue may ALSO surface from a GitHub Issues binding
// in a combined workspace; SOURCE_GITHUB_PROJECTS keeps the `<source>:<id>` merge
// keys distinct so both render with source badges (an accepted V1 double-surface,
// not a bug — dedup is a later refinement).
//
// --- Token / scope / auth split (mirrors the Issues provider) -----------------
// Two scope shapes are accepted (see `_clientFor`):
//   * a bare `org/number` STRING → authenticate via the boot `client`
//     (configure({ client })). The boot path the unit tests + test route use.
//   * a `{ token, scope }` BINDING CREDENTIAL → build a REQUEST-TIME GraphQL
//     client from the installation `token` and read `scope` per call. The GitHub
//     App credential path: production configures no boot client, so the stored
//     installation token authenticates the call. (The Issues binding uses `repo`;
//     a Projects binding carries its board scope under `scope`.)

import { ProviderInterface } from '../interface.js'
import { registerProvider } from '../registry.js'
import { SOURCE_GITHUB_PROJECTS } from '../models.js'
import { createGitHubProjectsClient, parseBoardScope } from './client.js'
// The GitHub App auth primitives are SHARED with the Issues provider (LIN-707):
// the App, its install URL, and the installation-token mint are App-level, not
// Issues-specific. A Projects binding reuses the SAME installation token when the
// App is granted the Projects (read) permission — the operational prerequisite —
// so Session 2's live auth imports these rather than forking a second flow.
import { mintInstallationToken, fetchInstallation, buildAuthorizeUrl, buildInstallUrl, exchangeOAuthCode, listUserInstallations } from '../github/app-auth.js'
import { createGitHubProjectsAuthRoutes } from '../../../routes/github-projects-auth.js'

export { createGitHubProjectsClient } from './client.js'

// The GitHub Projects callback uses its OWN OAuth redirect_uri (a sibling path to
// Issues), so the authorize URL and the code→token exchange must round-trip
// through it. Prefer a Projects-specific override, else reuse GITHUB_REDIRECT_URI
// (single-callback setups) — the value must be one of the App's registered
// callback URLs (LIN-735).
function projectsRedirectUri() {
  return process.env.GITHUB_PROJECTS_REDIRECT_URI || process.env.GITHUB_REDIRECT_URI
}

// -----------------------------------------------------------------------------
// Pure status mapping — a Projects v2 "Status" single-select option name →
// canonical state.
// -----------------------------------------------------------------------------
//
// Unlike GitHub Issues' fixed open/closed enum, a v2 board column is a
// USER-DEFINED single-select option with no canonical done/in-progress meaning,
// so the mapping is a NAME HEURISTIC over the normalized (lowercased/trimmed)
// option name. An unrecognized name — or an item with no Status field at all —
// falls back to `unstarted` (the neutral "to do" ○), never a guessed terminal
// state. The board's own option name is preserved as the display `name` so the
// dashboard shows the real column label while the canonical `type` drives icons
// and ordering. Exported so the heuristic is unit-testable in isolation.
const STATUS_RULES = [
  { type: 'backlog', words: ['backlog', 'triage', 'icebox'] },
  { type: 'unstarted', words: ['todo', 'to do', 'ready', 'up next', 'planned'] },
  { type: 'started', words: ['in progress', 'in review', 'doing', 'started', 'review'] },
  { type: 'completed', words: ['done', 'shipped', 'complete', 'completed', 'closed', 'merged'] },
  { type: 'canceled', words: ['cancelled', 'canceled', 'not planned', "won't do", 'wont do', 'abandoned'] },
]

export function githubProjectStatusToCanonical(statusName) {
  const raw = typeof statusName === 'string' ? statusName.trim() : ''
  if (!raw) return { name: 'No status', type: 'unstarted' }
  const norm = raw.toLowerCase()
  for (const rule of STATUS_RULES) {
    if (rule.words.includes(norm)) return { name: raw, type: rule.type }
  }
  // Unrecognized column name: keep its label, default the type to unstarted.
  return { name: raw, type: 'unstarted' }
}

export class GitHubProjectsProvider extends ProviderInterface {
  /**
   * @param {{ client?: object, clientFactory?: (token: string) => object }} [opts]
   *   client        — the GitHub Projects GraphQL boundary (client.js / fake-client.js).
   *   clientFactory — test/DI seam: builds the PER-REQUEST client from a token.
   *                   Production leaves it unset, so `_clientForToken` mints a real
   *                   createGitHubProjectsClient; tests inject the fake so the
   *                   request-time path runs offline.
   */
  constructor({ client, clientFactory } = {}) {
    super()
    this.name = 'github-projects'
    this.client = client || null
    this.clientFactory = clientFactory || null
  }

  /**
   * Inject the client (and optional per-request client factory) at server boot,
   * keeping registration import-driven while allowing DI of the HTTP boundary —
   * exactly GitHubProvider.configure / LocalProvider.configure.
   * @returns {this}
   */
  configure({ client, clientFactory } = {}) {
    if (client) this.client = client
    if (clientFactory) this.clientFactory = clientFactory
    return this
  }

  _requireClient() {
    if (!this.client) {
      throw new Error('GitHubProjectsProvider: client not configured (call configure({ client }) at boot)')
    }
    return this.client
  }

  /**
   * Per-token GraphQL client (never the single-account boot client). Builds a real
   * createGitHubProjectsClient in production; a configured `clientFactory` (test/DI
   * seam) overrides it so the request-time path runs against the in-memory fake
   * offline.
   */
  _clientForToken(token) {
    return this.clientFactory ? this.clientFactory(token) : createGitHubProjectsClient({ token })
  }

  /**
   * Resolve the GraphQL client + board scope for a single read call.
   *
   * The per-call `scope` is either:
   *   - a bare `org/number` STRING → authenticate via the boot `client`.
   *   - a `{ token, scope }` BINDING CREDENTIAL → build a REQUEST-TIME client from
   *     the installation `token` and take the board slug from `scope`. A credential
   *     missing its installation token is a hard error (no silent fall-through to a
   *     boot client production does not have), matching the Issues provider.
   * @param {string | {scope?: string, token?: string}} scope
   * @returns {{ client: object, board: string|null }}
   */
  _clientFor(scope) {
    if (scope && typeof scope === 'object') {
      const { token, scope: board } = scope
      if (!token) {
        throw new Error('GitHubProjectsProvider: binding credential is missing an installation token (cannot build a request-time client)')
      }
      return { client: this._clientForToken(token), board: board ?? null }
    }
    return { client: this._requireClient(), board: scope }
  }

  // ---------------------------------------------------------------------------
  // Shape mapping: clean board shape → canonical model.
  // ---------------------------------------------------------------------------

  /**
   * The board binding itself → a canonical project/container (mirrors the Issues
   * provider's `_toRepoContainerProject`). Its `id` is the `org/number` scope slug
   * so EVERY board item parents onto it (`project.id` below), rendering all items
   * under one board container — unlike the Issues repo container, which is empty
   * because milestones own the issues there.
   */
  _toBoardContainerProject(board, project) {
    const slug = String(board || 'github-projects')
    return {
      id: slug,
      name: project?.title || slug,
      content: project?.shortDescription ?? null,
      url: project?.url ?? null,
      sortOrder: 0,
    }
  }

  /**
   * A clean board item → canonical issue. The canonical `id` is the item NODE id
   * (always present and unique per board item — draft items have no number), so
   * the merge keys on `<source>:<id>` and drill-down (`fetchIssueFields`) can look
   * the item back up. `identifier` is `#<number>` for issue/PR items and a `draft`
   * marker for draft items.
   */
  _toCanonicalIssue(item, board, project) {
    const c = item.content || {}
    const isDraft = item.type === 'DRAFT_ISSUE' || c.number == null
    return {
      source: SOURCE_GITHUB_PROJECTS, // provenance stamp (LIN-561)
      id: String(item.id),
      identifier: isDraft ? 'draft' : `#${c.number}`,
      title: c.title || '',
      description: c.body ?? '',
      estimate: null, // V1: no estimate mapping (capability: estimates:false)
      priority: 0,
      sortOrder: c.number ?? 0,
      createdAt: c.createdAt ?? null,
      dueDate: null,
      completedAt: c.closedAt ?? null,
      url: c.url ?? null, // drafts have no URL
      parent: null, // no item hierarchy in V1 (capability: subtasks:false)
      // Every item parents to the single board container so the board renders as
      // one group (the container id is the board scope slug).
      project: { id: String(board), name: project?.title || String(board) },
      state: githubProjectStatusToCanonical(item.status),
      assignee: c.assignees?.length ? { name: c.assignees[0] } : null,
      labels: { nodes: (c.labels || []).map(name => ({ name })) },
      relations: { nodes: [] }, // no native typed relations
    }
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  /**
   * Projects + issues for the dashboard. `scope` is the `org/number` board slug
   * (or a `{ token, scope }` binding credential). The board becomes one canonical
   * container project and every item parents to it.
   * @returns {Promise<{organizationName, projects, issues}>}
   */
  async fetchProjects(scope, _teamId = null, _opts = {}) {
    const { client, board } = this._clientFor(scope)
    const { project, items } = await client.fetchBoard(board)
    const { login } = parseBoardScope(board)
    return {
      organizationName: login || 'GitHub',
      projects: [this._toBoardContainerProject(board, project)],
      issues: items.map(item => this._toCanonicalIssue(item, board, project)),
    }
  }

  /** Lightweight project list (the single board container, no items). */
  async fetchProjectsList(scope) {
    const { client, board } = this._clientFor(scope)
    const { project } = await client.fetchBoard(board)
    return [this._toBoardContainerProject(board, project)]
  }

  /**
   * A board is not partitioned by team, so the canonical `teams` surface stays
   * EMPTY (capability teams:false). Returning [] rather than throwing keeps the
   * dashboard's fetchAndPrepareProjects provider-agnostic — same A⇄D contract the
   * Issues/Local providers document.
   */
  async fetchTeams(_scope) {
    return []
  }

  /** Find one board item by its canonical id (the item node id). */
  async _findItem(scope, issueId) {
    const { client, board } = this._clientFor(scope)
    const { project, items } = await client.fetchBoard(board)
    const item = items.find(i => String(i.id) === String(issueId)) || null
    return { board, project, item }
  }

  /** A single board item → the same canonical render shape fetchProjects emits. */
  async fetchIssueFields(scope, issueId) {
    const { board, project, item } = await this._findItem(scope, issueId)
    if (!item) throw new Error(`Issue not found: ${issueId}`)
    return this._toCanonicalIssue(item, board, project)
  }

  /**
   * Single-item context for the detail/recommendation surfaces. Board items are
   * flat in V1 (no parent, no children); comments are not surfaced (V1 read-only,
   * capability comments:false — drafts have none), so `comments` is always empty.
   * Mirrors the Issues provider's flat fetchIssueContext shape.
   */
  async fetchIssueContext(scope, issueId) {
    const { board, project, item } = await this._findItem(scope, issueId)
    if (!item) throw new Error(`Issue not found: ${issueId}`)
    const c = item.content || {}
    const isDraft = item.type === 'DRAFT_ISSUE' || c.number == null
    return {
      issue: {
        id: String(item.id),
        identifier: isDraft ? 'draft' : `#${c.number}`,
        title: c.title || '',
        description: c.body ?? '',
        url: c.url ?? null,
        state: githubProjectStatusToCanonical(item.status),
        // Flat name array, matching the Linear/Local/Issues fetchIssueContext
        // contract the prompt (formatLabels) + AI-recommend consumers read.
        labels: c.labels || [],
      },
      parent: null,
      siblings: [],
      siblingsTotal: 0,
      parentChildCount: null,
      cousins: [],
      cousinsTotal: 0,
      project: project ? { name: project.title, description: project.shortDescription ?? null } : null,
      children: [],
      comments: [], // V1: comments not surfaced (capability comments:false)
    }
  }

  /**
   * Recommendation/recap/brief context. Board items are flat in V1, so this is
   * always the leaf case: return the context as-is with no focusedChild.
   */
  async fetchRecommendationContext(scope, issueId, _opts = {}) {
    return this.fetchIssueContext(scope, issueId)
  }

  // ---------------------------------------------------------------------------
  // Auth — live project picker (LIN-560 Session 2), the GitHub-Projects consumer
  // of the LIN-562 binding seam.
  // ---------------------------------------------------------------------------
  //
  // GitHub Projects auth is its OWN router (routes/github-projects-auth.js),
  // sibling to routes/github-auth.js: the two-step App-install → PICKER flow is
  // the same SHAPE as Issues, but the picker chooses an `org/projectNumber` BOARD
  // rather than an `owner/repo` repo, so generalizing the Issues router would not
  // be byte-identical. The provider supplies the credential-ACQUISITION primitives
  // (reusing the shared App helpers) and the board list; the router drives
  // linkProvider. V1 stays READ-ONLY — auth only adds the binding, never a write
  // affordance.

  /**
   * Build the begin URL — the user-to-server OAuth **authorize** URL (LIN-735,
   * mirrors GitHubProvider.beginAuth). Replaces `installations/new` as the entry so
   * an already-installed shared App round-trips an OAuth `code` instead of
   * dead-ending on GitHub's configure page (the Projects analogue of LIN-728). The
   * callback exchanges the code, enumerates the user's installations, and lists each
   * account's boards for the picker — or falls through to {@link beginInstall} when
   * there is no installation yet. No `scope` is sent; `state` is an opaque CSRF nonce.
   * @param {{ state: string }} args
   * @returns {string} the `login/oauth/authorize?client_id=…&state=…` URL.
   * @throws {Error} if `GITHUB_CLIENT_ID` is unset.
   */
  beginAuth({ state }) {
    return buildAuthorizeUrl({ state, redirectUri: projectsRedirectUri() })
  }

  /**
   * Build the App installation URL (`installations/new`) — the fresh-install entry
   * and the callback fallback when an authorize round-trip finds no installation
   * (LIN-735). `state` is the same opaque CSRF nonce the authorize round-trip
   * carries, reused so the post-install callback still passes the state guard.
   * @param {{ state: string }} args
   * @returns {string} the `apps/<slug>/installations/new?state=<nonce>` URL.
   * @throws {Error} if `GITHUB_APP_SLUG` is unset.
   */
  beginInstall({ state }) {
    return buildInstallUrl({ state })
  }

  /**
   * Exchange a user-to-server OAuth `code` for a DISCOVERY token (the re-bind path,
   * LIN-735). Delegates to the shared App OAuth seam (the App + its OAuth creds are
   * App-level, so this is byte-for-byte the Issues exchange but tagged with this
   * provider's name and the Projects callback redirect_uri). The token is
   * discovery-only — the binding still mints/persists an installation token at link.
   * @param {string} code - the authorization code from the OAuth redirect.
   * @returns {Promise<{access_token: string}>} normalized token bag.
   */
  async completeAuth(code) {
    return exchangeOAuthCode(code, { providerName: this.name, redirectUri: projectsRedirectUri() })
  }

  /**
   * Wrap the shared user-installations enumeration (GET /user/installations) so the
   * re-bind flow can be driven offline: tests override this method (as the Issues
   * tests override `_clientForToken`) to inject installations without a network call.
   * @param {string} userToken - the discovery user-to-server token.
   * @returns {Promise<Array<{id: string|number, account: object|null}>>}
   */
  async _listUserInstallations(userToken) {
    return listUserInstallations(userToken)
  }

  /**
   * Flatten the user's installations + each account's open Projects v2 boards into
   * the board-picker shape, tagged with the `installationId` each board belongs to
   * (LIN-735 — the Projects analogue of GitHubProvider.listReboundableRepos). The
   * callback renders this through the same board picker; the link step resolves the
   * chosen board's `installationId` server-side and mints the installation token for
   * it (the discovery user token is never persisted). Carrying `installationId` per
   * board is what lets one picker span an App installed on several accounts while
   * still binding to the right installation. Closed boards are dropped (not useful
   * binding targets), exactly like {@link listBoards}.
   * @param {string} userToken - the user-to-server OAuth token from completeAuth.
   * @returns {Promise<Array<{login: string, number: number, title: string, url: string|null, shortDescription: string|null, closed: boolean, installationId: string}>>}
   */
  async listReboundableBoards(userToken) {
    const installations = await this._listUserInstallations(userToken)
    const client = this._clientForToken(userToken)
    const out = []
    for (const inst of installations) {
      const login = inst.account?.login
      if (!login) continue
      const boards = await client.listBoards(login)
      for (const b of boards) {
        if (b.closed) continue
        out.push({ ...b, installationId: String(inst.id) })
      }
    }
    return out
  }

  /**
   * Acquire an installation credential + account identity from an installation id
   * (mirrors GitHubProvider.completeInstallation — the SAME shared App helpers).
   * Mints the installation access token and resolves the installation's `account`
   * (the org/user that owns the boards the picker then lists). The `login` is the
   * board-owner the picker queries; `installationId` is the re-mint key the binding
   * persists; `tokenExpiresAt` is GitHub's raw ISO expiry the link step converts to ms.
   * @param {string|number} installationId
   * @returns {Promise<{token: string, login: string, userId: string, installationId: string, tokenExpiresAt: string}>}
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
   * Re-mint the installation access token for a Projects binding (mirrors
   * GitHubProvider.refreshCredential — the SAME shared `mintInstallationToken`,
   * keyed off the persisted binding's `installationId`). GitHub App installation
   * tokens are short-lived (~1h) and carry NO refresh token; a Projects binding
   * never has one, so this emits none. A missing/unparseable expiry is a hard error.
   * @param {{credentials?: {installationId?: string}}} binding
   * @param {{fetchImpl?: Function, now?: number}} [opts]
   * @returns {Promise<{token: string, tokenExpiresAt: number, installationId: string}>}
   */
  async refreshCredential(binding, { fetchImpl, now } = {}) {
    const installationId = binding?.credentials?.installationId
    if (!installationId) {
      throw new Error('GitHub Projects credential refresh: binding is missing installationId (cannot re-mint)')
    }
    const tokenBag = await mintInstallationToken(installationId, { fetchImpl, now })
    const tokenExpiresAt = Date.parse(tokenBag.expires_at)
    if (!Number.isFinite(tokenExpiresAt)) {
      throw new Error(`GitHub Projects credential refresh: invalid installation token expiry: ${tokenBag.expires_at}`)
    }
    return { token: tokenBag.token, tokenExpiresAt, installationId: String(installationId) }
  }

  /**
   * The Projects v2 boards the installation can read, for the post-install picker.
   * Each board becomes a candidate `org/projectNumber` scope for a github-projects
   * binding. Built from a PER-REQUEST GraphQL client (the installation token), never
   * the boot client — the token here is the freshly minted installation token. An
   * empty list usually means the App lacks the Projects (read) permission, which the
   * picker page surfaces as a prerequisite hint.
   * @param {string} token - the installation access token to read boards with.
   * @param {string} login - the installation account (board owner) to list boards for.
   * @returns {Promise<Array<{login: string, number: number, title: string, url: string|null, shortDescription: string|null, closed: boolean}>>}
   */
  async listBoards(token, login) {
    const boards = await this._clientForToken(token).listBoards(login)
    // Closed boards are not useful binding targets; keep the open ones.
    return boards.filter(b => !b.closed)
  }

  /**
   * The GitHub Projects auth router. Mounted by server.js's per-provider auth-mount
   * loop (it iterates getAllProviders().getAuthRouter()); mirrors
   * GitHubProvider.getAuthRouter — folds routes/github-projects-auth.js behind the
   * provider and injects `this` so the route drives the provider's seam.
   * @param {{sessionStore?: Object, userPreferencesStore?: Object}} opts
   * @returns {import('express').Router}
   */
  getAuthRouter(opts) {
    return createGitHubProjectsAuthRoutes({ ...opts, provider: this })
  }

  // ---------------------------------------------------------------------------
  // UI capability surface
  // ---------------------------------------------------------------------------

  /**
   * V1 is read-only: write/comments auto-derive false from the base getter (no
   * getCreateTaskUrl override, no fetchIssueComments). Override only the abstract
   * flags GitHub Projects v2 does not back in V1 (estimates, subtasks) plus the
   * human-facing displayName. `attachments: true` (LIN-771): a Projects item maps
   * to a GitHub issue/PR whose body can carry user-content uploads, discovered by
   * the host-anchored collector; the read-only comments gap just limits discovery
   * to the description body, it does not make uploads unsupported.
   */
  get ui() {
    return { ...super.ui, estimates: false, subtasks: false, attachments: true, displayName: 'GitHub Projects' }
  }
}

/** Singleton GitHub Projects provider (client injected at boot via configure()). */
export const githubProjectsProvider = new GitHubProjectsProvider()

// Module-load self-registration (see registry.js header for the lifecycle
// rationale). Importing this module is what populates the registry under
// 'github-projects'; the boot wiring injects the authenticated client.
registerProvider(githubProjectsProvider)
