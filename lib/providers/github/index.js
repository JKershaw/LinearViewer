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
// that token as its STORE PARTITION KEY. The GitHub provider treats it as the
// **repository slug** (`owner/name`) — it selects *which repo* to read/write,
// not *who* you are. Authentication (the GitHub PAT / OAuth token) lives on the
// injected `client`, configured once at boot — exactly as the Local provider's
// store is injected via `configure()`. One configured client (one account /
// PAT) therefore serves every repo on that account; the per-call token picks the
// repo. Multi-account auth and the per-workspace repo binding are LIN-541.
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

export { createGitHubClient } from './client.js'

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
   * @param {{ client?: object, repo?: string }} [opts]
   *   client — the GitHub REST boundary (see client.js / fake-client.js).
   *   repo   — default `owner/name` used ONLY by getCreateTaskUrl (the "+ Add
   *            task" deep link); reads/writes take the repo per call. Single-repo
   *            V1: the per-workspace repo binding is LIN-541.
   */
  constructor({ client, repo } = {}) {
    super()
    this.name = 'github'
    this.client = client || null
    this.repo = repo || null
  }

  /**
   * Inject the client (and optional default repo) at server boot, keeping
   * registration import-driven while allowing dependency injection of the HTTP
   * boundary — exactly LocalProvider.configure({ store }). @returns {this}
   */
  configure({ client, repo } = {}) {
    if (client) this.client = client
    if (repo) this.repo = repo
    return this
  }

  _requireClient() {
    if (!this.client) {
      throw new Error('GitHubProvider: client not configured (call configure({ client }) at boot)')
    }
    return this.client
  }

  // ---------------------------------------------------------------------------
  // Shape mapping: GitHub REST issue → canonical issue (mirrors LocalProvider).
  // ---------------------------------------------------------------------------
  _toCanonicalIssue(gh) {
    const milestone = gh.milestone || null
    return {
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

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  /**
   * Projects + issues for the dashboard. `repo` is the `owner/name` slug.
   * Milestones become canonical projects; issues without a milestone have
   * `project: null` (the dashboard groups them in the cross-project sections).
   * @returns {Promise<{organizationName, projects, issues}>}
   */
  async fetchProjects(repo, _teamId = null, _opts = {}) {
    const client = this._requireClient()
    const [issues, milestones] = await Promise.all([
      client.listIssues(repo),
      client.listMilestones(repo),
    ])
    const { owner } = parseRepo(repo)
    return {
      organizationName: owner || 'GitHub',
      projects: milestones.map(m => this._toCanonicalProject(m)),
      issues: issues.map(gh => this._toCanonicalIssue(gh)),
    }
  }

  /** Lightweight project list (milestones only, no issues). */
  async fetchProjectsList(repo) {
    const milestones = await this._requireClient().listMilestones(repo)
    return milestones.map(m => this._toCanonicalProject(m))
  }

  /**
   * Repos are GitHub's team analog, but the canonical `teams` surface stays
   * EMPTY (capability teams:false). Returning [] rather than throwing keeps the
   * dashboard's fetchAndPrepareProjects provider-agnostic — same A⇄D contract
   * the Local provider documents.
   */
  async fetchTeams(_repo) {
    return []
  }

  /** A single GitHub issue → the same canonical render shape fetchProjects emits. */
  async fetchIssueFields(repo, issueId) {
    const gh = await this._requireClient().getIssue(repo, issueId)
    if (!gh) throw new Error(`Issue not found: ${issueId}`)
    return this._toCanonicalIssue(gh)
  }

  /**
   * Single-issue context for the detail/recommendation surfaces. GitHub issues
   * are flat, so there is no parent and no children; siblings/cousins are empty.
   * Mirrors the Local provider's fetchIssueContext shape.
   */
  async fetchIssueContext(repo, issueId) {
    const client = this._requireClient()
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
      comments: await this.fetchIssueComments(repo, issueId),
    }
  }

  /**
   * Recommendation/recap/brief context. GitHub issues never have children, so
   * this is always the leaf case: return the context as-is with no focusedChild,
   * regardless of noDescend. (Mirrors the Local provider's leaf branch.)
   */
  async fetchRecommendationContext(repo, issueId, _opts = {}) {
    return this.fetchIssueContext(repo, issueId)
  }

  /** Comments for an issue, oldest-first. Implementing this sets ui.comments=true. */
  async fetchIssueComments(repo, issueId) {
    const comments = await this._requireClient().listComments(repo, issueId)
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
  async search(repo, query) {
    const issues = await this._requireClient().searchIssues(repo, query)
    return issues.map(gh => this._toCanonicalIssue(gh))
  }

  /** The two canonical workflow states a GitHub issue can occupy. */
  async states(_repo, _teamId = null) {
    return GITHUB_STATES.map(s => ({ ...s }))
  }

  /** Distinct labels defined on the repo. */
  async labels(repo) {
    const labels = await this._requireClient().listLabels(repo)
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
    return { ...super.ui, estimates: false, subtasks: false, displayName: 'GitHub' }
  }

  // ---------------------------------------------------------------------------
  // Writes
  // ---------------------------------------------------------------------------

  /** @returns {Promise<Object>} the created issue (canonical shape). */
  async createIssue(repo, input = {}) {
    const gh = await this._requireClient().createIssue(repo, {
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
  async updateIssue(repo, issueId, patch = {}) {
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
    const gh = await this._requireClient().updateIssue(repo, issueId, ghPatch)
    if (!gh) return null
    return this._toCanonicalIssue(gh)
  }

  /** @returns {Promise<Object>} the created comment (canonical shape). */
  async createComment(repo, issueId, body) {
    const c = await this._requireClient().createComment(repo, issueId, body)
    if (!c) throw new Error(`Issue not found: ${issueId}`)
    return { id: String(c.id), body: c.body, createdAt: c.created_at, user: c.user?.login || 'github' }
  }

  /** @returns {Promise<boolean>} */
  async addLabel(repo, issueId, label) {
    return this._requireClient().addLabel(repo, issueId, label)
  }

  /** @returns {Promise<boolean>} */
  async removeLabel(repo, issueId, label) {
    return this._requireClient().removeLabel(repo, issueId, label)
  }
}

/** Singleton GitHub provider (client injected at boot via configure()). */
export const githubProvider = new GitHubProvider()

// Module-load self-registration (see registry.js header for the lifecycle
// rationale). Importing this module is what populates the registry under
// 'github'; the boot wiring (LIN-541) injects the authenticated client.
registerProvider(githubProvider)
