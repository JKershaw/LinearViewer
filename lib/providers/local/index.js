// =============================================================================
// Local Provider (LIN-356) — the writable, first-party second provider
// =============================================================================
//
// A Mongo/Mango-backed provider that implements the FULL provider surface the
// abstraction has only declared until now: reads AND writes. It exists to prove
// the provider write path (declared-but-unimplemented since Phase 2, LIN-176)
// and to unblock a provider-agnostic E2E that runs against a genuine second
// provider with no `test-token` mock short-circuit.
//
// --- Token semantics ---------------------------------------------------------
// The landed read-routing seam (LIN-356 / PR #382) calls every provider as
// `provider.fetchX(getWorkspaceToken(workspace), …)`. Linear's token is an API
// key; the Local provider has no external API, so it treats the token argument
// as the STORE PARTITION KEY (the workspace urlKey). "Token irrelevant" (per the
// research) means it carries no auth — it only selects which partition of the
// local-issues collection to read/write. A `provider: 'local'` workspace simply
// sets its credential to its own urlKey.
//
// --- Capability profile (LIN-356) --------------------------------------------
// Deliberately NOT a full mirror of Linear, so capability-gating exercises real
// graceful degradation:
//   write: true     → overrides getCreateTaskUrl (that's what ui.write derives from)
//   comments: true  → implements fetchIssueComments
//   labels: true    → implements addLabel/removeLabel/labels (method capability)
//   subtasks: true  → ui getter (parent/child is natural in a doc store)
//   estimates: false→ ui getter
//   cycles: false   → cycles()/cycleDetail() left as the base throw
//   teams:  false   → fetchTeams returns [] (projects-only; zero teams, not a throw,
//                     so the dashboard's fetchAndPrepareProjects works unchanged)

import { ProviderInterface } from '../interface.js'
import { registerProvider } from '../registry.js'

/**
 * Canonical workflow states the Local provider exposes (states() read).
 * Each maps 1:1 onto a canonical state.type from lib/providers/models.js.
 */
const LOCAL_STATES = [
  { id: 'backlog', name: 'Backlog', type: 'backlog', position: 0 },
  { id: 'unstarted', name: 'Todo', type: 'unstarted', position: 1 },
  { id: 'started', name: 'In Progress', type: 'started', position: 2 },
  { id: 'completed', name: 'Done', type: 'completed', position: 3 },
  { id: 'canceled', name: 'Canceled', type: 'canceled', position: 4 },
]

export class LocalProvider extends ProviderInterface {
  /**
   * @param {{ store?: import('../../local-store.js').LocalStore }} [opts]
   */
  constructor({ store } = {}) {
    super()
    this.name = 'local'
    this.store = store || null
  }

  /**
   * Inject the store at server boot (after the db.collection is created).
   * Keeps registration import-driven while allowing dependency injection of the
   * collection. @returns {this}
   */
  configure({ store }) {
    this.store = store
    return this
  }

  _requireStore() {
    if (!this.store) {
      throw new Error('LocalProvider: store not configured (call configure({ store }) at boot)')
    }
    return this.store
  }

  // ---------------------------------------------------------------------------
  // Shape mapping: stored doc → canonical issue (mirrors tests/fixtures/mock-data.js)
  // ---------------------------------------------------------------------------
  _toCanonicalIssue(doc, projectNameById = {}) {
    return {
      id: doc._id,
      identifier: doc.identifier,
      title: doc.title,
      description: doc.description ?? '',
      estimate: doc.estimate ?? null,
      priority: doc.priority ?? 0,
      sortOrder: doc.sortOrder ?? 0,
      createdAt: doc.createdAt,
      dueDate: doc.dueDate ?? null,
      completedAt: doc.completedAt ?? null,
      url: doc.url ?? null,
      parent: doc.parentId ? { id: doc.parentId } : null,
      project: doc.projectId
        ? { id: doc.projectId, name: projectNameById[doc.projectId] || null }
        : null,
      state: doc.state || { name: 'Backlog', type: 'backlog' },
      assignee: doc.assignee ?? null,
      labels: { nodes: (doc.labels || []).map(name => ({ name })) },
      relations: {
        nodes: (doc.relations || []).map(r => ({
          type: r.type,
          relatedIssue: { id: r.relatedIssueId },
        })),
      },
    }
  }

  _toCanonicalProject(doc) {
    return {
      id: doc._id,
      name: doc.name,
      content: doc.content ?? null,
      url: doc.url ?? null,
      sortOrder: doc.sortOrder ?? 0,
    }
  }

  async _projectNameMap(scope) {
    const projects = await this._requireStore().listProjects(scope)
    const map = {}
    for (const p of projects) map[p._id] = p.name
    return map
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  /**
   * Projects + issues for the dashboard. `token` is the store partition key.
   * @returns {Promise<{organizationName, projects, issues}>}
   */
  async fetchProjects(token, _teamId = null) {
    const store = this._requireStore()
    const [projectDocs, issueDocs] = await Promise.all([
      store.listProjects(token),
      store.listIssues(token),
    ])
    const nameById = {}
    for (const p of projectDocs) nameById[p._id] = p.name
    return {
      organizationName: 'Local',
      projects: projectDocs.map(p => this._toCanonicalProject(p)),
      issues: issueDocs.map(d => this._toCanonicalIssue(d, nameById)),
    }
  }

  /** Lightweight project list (no issues). */
  async fetchProjectsList(token) {
    const projectDocs = await this._requireStore().listProjects(token)
    return projectDocs.map(p => this._toCanonicalProject(p))
  }

  /**
   * Projects-only backend: no teams. Returning [] (rather than throwing) keeps
   * the dashboard's fetchAndPrepareProjects provider-agnostic — see the A⇄D
   * interaction note in the header. This is why `teams:false` is not a decline.
   */
  async fetchTeams(_token) {
    return []
  }

  /**
   * Single-issue context for the detail/recommendation surfaces.
   * Returns the same shape as the Linear provider's fetchIssueContext.
   */
  async fetchIssueContext(token, issueId) {
    const store = this._requireStore()
    const doc = await store.getIssue(token, issueId)
    if (!doc) throw new Error(`Issue not found: ${issueId}`)

    const nameById = await this._projectNameMap(token)

    const parentDoc = doc.parentId ? await store.getIssue(token, doc.parentId) : null

    // Siblings = other children of the same parent (top-level issues are
    // siblings of each other when there is no parent).
    const allIssues = await store.listIssues(token)
    const siblingDocs = allIssues.filter(i =>
      i._id !== doc._id && (i.parentId ?? null) === (doc.parentId ?? null))
    const parentChildCount = doc.parentId ? siblingDocs.length + 1 : null

    const childDocs = await store.getChildren(token, doc._id)

    return {
      issue: {
        id: doc._id,
        identifier: doc.identifier,
        title: doc.title,
        description: doc.description ?? '',
        url: doc.url ?? null,
        state: doc.state,
        labels: { nodes: (doc.labels || []).map(name => ({ name })) },
      },
      parent: parentDoc ? {
        id: parentDoc._id,
        identifier: parentDoc.identifier,
        title: parentDoc.title,
        state: parentDoc.state,
      } : null,
      siblings: siblingDocs.map(d => this._toCanonicalIssue(d, nameById)),
      siblingsTotal: siblingDocs.length,
      parentChildCount,
      cousins: [],
      cousinsTotal: 0,
      project: doc.projectId ? {
        name: nameById[doc.projectId] || null,
        description: null,
      } : null,
      children: childDocs.map(d => this._toCanonicalIssue(d, nameById)),
      comments: await this.fetchIssueComments(token, doc._id),
    }
  }

  /** Comments for an issue, oldest-first. Implementing this sets ui.comments=true. */
  async fetchIssueComments(token, issueId) {
    const doc = await this._requireStore().getIssue(token, issueId)
    if (!doc) throw new Error(`Issue not found: ${issueId}`)
    return (doc.comments || [])
      .map(c => ({ id: c.id, body: c.body, createdAt: c.createdAt, user: c.user || 'Local' }))
      .sort((a, b) => {
        const ta = new Date(a.createdAt).getTime() || 0
        const tb = new Date(b.createdAt).getTime() || 0
        return ta - tb
      })
  }

  /** Substring search over title/description. */
  async search(token, query) {
    const docs = await this._requireStore().searchIssues(token, query)
    const nameById = await this._projectNameMap(token)
    return docs.map(d => this._toCanonicalIssue(d, nameById))
  }

  /** Canonical workflow states (team-agnostic for this provider). */
  async states(_token, _teamId = null) {
    return LOCAL_STATES.map(s => ({ ...s }))
  }

  /** Distinct labels across the partition. */
  async labels(token) {
    const names = await this._requireStore().listLabels(token)
    return names.map(name => ({ id: name, name, color: null }))
  }

  // ---------------------------------------------------------------------------
  // URLs / UI capability surface
  // ---------------------------------------------------------------------------

  /**
   * Local "create task" deep link. Overriding this is what makes `ui.write`
   * true — render gates the "+ Add task" affordance on it.
   */
  getCreateTaskUrl(urlKey, projectId) {
    return `/workspace/${encodeURIComponent(urlKey)}/new?project=${encodeURIComponent(projectId)}`
  }

  /**
   * write/comments auto-derive from the base getter (getCreateTaskUrl override +
   * fetchIssueComments implementation). Override only the abstract bits:
   * subtasks (parent/child is natural here), estimates (no point estimates), and
   * the human displayName.
   */
  get ui() {
    return { ...super.ui, estimates: false, subtasks: true, displayName: 'Local' }
  }

  // ---------------------------------------------------------------------------
  // Writes — the whole reason this provider exists
  // ---------------------------------------------------------------------------

  /** @returns {Promise<Object>} the created issue (canonical shape). */
  async createIssue(token, input = {}) {
    const doc = await this._requireStore().createIssue(token, input)
    const nameById = await this._projectNameMap(token)
    return this._toCanonicalIssue(doc, nameById)
  }

  /** @returns {Promise<Object|null>} the updated issue (canonical shape), or null if missing. */
  async updateIssue(token, issueId, patch = {}) {
    const doc = await this._requireStore().updateIssue(token, issueId, patch)
    if (!doc) return null
    const nameById = await this._projectNameMap(token)
    return this._toCanonicalIssue(doc, nameById)
  }

  /** @returns {Promise<Object>} the created comment. */
  async createComment(token, issueId, body) {
    const comment = await this._requireStore().addComment(token, issueId, body)
    if (!comment) throw new Error(`Issue not found: ${issueId}`)
    return comment
  }

  /** @returns {Promise<Object>} the created relation. */
  async createRelation(token, issueId, { type, relatedIssueId } = {}) {
    const relation = await this._requireStore().addRelation(token, issueId, { type, relatedIssueId })
    if (!relation) throw new Error(`Issue not found: ${issueId}`)
    return relation
  }

  /** @returns {Promise<boolean>} */
  async addLabel(token, issueId, label) {
    return this._requireStore().addLabel(token, issueId, label)
  }

  /** @returns {Promise<boolean>} */
  async removeLabel(token, issueId, label) {
    return this._requireStore().removeLabel(token, issueId, label)
  }
}

/** Singleton Local provider instance (store injected at boot via configure()). */
export const localProvider = new LocalProvider()

// Module-load self-registration (see registry.js header for the lifecycle
// rationale). Importing this module is what populates the registry under
// 'local'; server.js imports it and then injects the store.
registerProvider(localProvider)
