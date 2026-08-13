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
//   cycles:         → cycles()/cycleDetail() return canonical-empty ([] / null).
//                     Originally left as the base throw (LIN-356); LIN-583 wired
//                     them empty so the consumer proxy's /cycles surface returns
//                     `{ cycles: [] }` for a local workspace instead of a 500.
//                     The local harness still has no cycle CONCEPT — empty is the
//                     honest answer, not a feature.
//   teams:  false   → fetchTeams returns [] (projects-only; zero teams, not a throw,
//                     so the dashboard's fetchAndPrepareProjects works unchanged)

import { ProviderInterface } from '../interface.js'
import { registerProvider } from '../registry.js'
import { SOURCE_LOCAL } from '../models.js'
import { selectFocusSubtask } from '../../tree.js'

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

/**
 * LIN-1553: translate a resolved `stateId` (a LOCAL_STATES id, e.g. 'started')
 * in a write patch into the store's `{ name, type }` state shape. The session-auth
 * / proxy write routes resolve a symbolic state to a `stateId`; the LocalStore
 * persists a state OBJECT (it has no `stateId` column), so without this the
 * resolved state would be silently dropped. A patch that already carries a
 * `state` object (the provider's own unit-test path) or no `stateId` passes
 * through untouched; an unknown `stateId` is dropped (store keeps default/current).
 */
function applyLocalStateId(patch = {}) {
  if (!patch || patch.stateId == null) return patch
  const { stateId, ...rest } = patch
  const match = LOCAL_STATES.find(s => s.id === stateId)
  return match ? { ...rest, state: { name: match.name, type: match.type } } : rest
}

/**
 * Linear's 0–4 priority → human-readable label map (LIN-589). Mirrors the names
 * Linear's own `priorityLabel` field returns, so the source-neutral wire reads
 * the same for a Local issue as for a Linear one.
 */
const PRIORITY_LABELS = {
  0: 'No priority',
  1: 'Urgent',
  2: 'High',
  3: 'Medium',
  4: 'Low',
}

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
      source: SOURCE_LOCAL, // provenance stamp (LIN-561)
      id: doc._id,
      identifier: doc.identifier,
      title: doc.title,
      description: doc.description ?? '',
      estimate: doc.estimate ?? null,
      priority: doc.priority ?? 0,
      // priorityLabel mirrors Linear's human-readable priority name (LIN-589) so
      // the source-neutral wire carries it consistently across providers; this is
      // the Local side of "populate priorityLabel wherever priority is present".
      priorityLabel: PRIORITY_LABELS[doc.priority ?? 0] ?? null,
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
  async fetchProjects(token, _teamId = null, _opts = {}) {
    // `_opts.slim` (LIN-442) is the Linear homepage's description-trim hint. A
    // local store read is already cheap and serves from memory, so there is
    // nothing to trim — accept the arg for interface parity and ignore it. (As a
    // result local-workspace homepage search keeps matching description text.)
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

  /**
   * Single-issue canonical fields for the lazy dashboard detail surface
   * (LIN-442). Returns the same `{ nodes }`-labelled shape `fetchProjects`
   * emits, via `_toCanonicalIssue` — so `renderDetailsContent` renders it
   * unchanged. @returns {Promise<Object>}
   */
  async fetchIssueFields(token, issueId) {
    const store = this._requireStore()
    const doc = await store.getIssue(token, issueId)
    if (!doc) throw new Error(`Issue not found: ${issueId}`)
    const nameById = await this._projectNameMap(token)
    return this._toCanonicalIssue(doc, nameById)
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

  // LIN-1972: no teamId — this provider has no teams (see fetchTeams above).
  createFields() {
    return ['title', 'description', 'projectId', 'stateId', 'priority']
  }

  // LIN-1557: parentId is honoured by lib/local-store.js's createIssue even
  // though the create form (createFields() above) never renders it.
  apiWriteFields() {
    return [...this.createFields(), 'parentId']
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
        // fetchIssueContext's curated issue mirrors the Linear provider's shape
        // (index.js:531): labels is a flat name array, not raw `{ nodes }`. The
        // prompt (formatLabels) and AI-recommend (openrouter.js) consumers both
        // read it as an array — `_toCanonicalIssue` keeps `{ nodes }` for the
        // tree/render path. (LIN-406.)
        labels: doc.labels || [],
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

  /**
   * Recommendation/recap/brief context (LIN-388). Mirrors the Linear provider's
   * wrapper over fetchIssueContext: a leaf returns its context as-is; a parent
   * gets a `focusedChild` — the subtask the recommender should descend into,
   * chosen by the shared deterministic `selectFocusSubtask` picker. Implementing
   * it here lets a `provider: 'local'` session drive the recap/brief/recommend/
   * prompt surfaces (their real path calls `provider.fetchRecommendationContext`),
   * which the base ProviderInterface otherwise declines with NotImplementedError.
   * `token` is the store partition key (see header).
   */
  async fetchRecommendationContext(token, issueId, { noDescend = false } = {}) {
    const context = await this.fetchIssueContext(token, issueId)

    // Leaf task, or caller wants the parent's own work (LIN-365): frame as a
    // leaf with no focusedChild / defer pointer.
    if (noDescend || !context.children?.length) return context

    const focusChild = selectFocusSubtask(context.children)
    if (!focusChild) return context  // all children terminal

    return { ...context, focusedChild: await this.fetchIssueContext(token, focusChild.id) }
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
  // Consumer-proxy read + write-guard surface (LIN-583)
  //
  // The Linear API proxy (routes/proxy.js) sources its reads + write-guard reads
  // through the injectable `provider`. These methods give the LocalProvider that
  // surface so `/api/proxy/*` can target a local workspace. They emit the SAME
  // nested-canonical shape (`{ nodes }`, `relatedIssue { id }`, …) the Linear
  // provider's API queries return, so the shared `lib/proxy-wire.js` flatten
  // helpers apply unchanged. Like the Linear provider's equivalents, the
  // write-guard reads (issueWriteGuard/issueDescription/issueLabels/
  // updateIssueLabels) are deliberately OFF the declared PROVIDER_SURFACE — they
  // are route-internal data-fetch, not first-class capabilities.
  //
  // Token is the store partition key (see header). The local store models no
  // soft-delete, so `trashed` is always false.
  // ---------------------------------------------------------------------------

  /** Synthetic API viewer ({ id, name, email }). Local has no real auth. */
  async viewer(_token) {
    return { id: 'local-user', name: 'Local User', email: 'local@localhost' }
  }

  /**
   * Active projects in the proxy's started-projects field shape
   * ({ id, name, content, url }). Local has no project lifecycle, so every
   * project is "active". Distinct from `fetchProjectsList` (which also selects
   * sortOrder — `neutralizeProject` only strips `url`, so reusing it would leak
   * sortOrder onto the wire). Mirrors the Linear provider's `projects()`.
   */
  async projects(token) {
    const projectDocs = await this._requireStore().listProjects(token)
    return projectDocs.map(p => ({
      id: p._id,
      name: p.name,
      content: p.content ?? null,
      url: p.url ?? null,
    }))
  }

  /**
   * A page of issues in the proxy's `{ nodes, pageInfo }` shape. Local has no
   * teams, so a team filter resolves to nothing (parity with "no such team").
   * Pagination is offset-based — the cursor is the next offset as a string.
   */
  async issues(token, { teamId = null, first = 50, after = null } = {}) {
    if (teamId) return { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } }
    const store = this._requireStore()
    const all = await store.listIssues(token)
    const nameById = await this._projectNameMap(token)
    const start = after ? Math.max(0, parseInt(after, 10) || 0) : 0
    const page = all.slice(start, start + first)
    const end = start + page.length
    const hasNextPage = end < all.length
    return {
      nodes: page.map(d => this._toCanonicalIssue(d, nameById)),
      pageInfo: { hasNextPage, endCursor: hasNextPage ? String(end) : null },
    }
  }

  /**
   * A single issue in the proxy's detail shape (nested children/comments/
   * relations/inverseRelations as `{ nodes }`), or null if missing. Richer than
   * `_toCanonicalIssue` alone: it enriches relations with their own id +
   * relatedIssue identifier and computes inverseRelations across the partition.
   */
  async issueDetail(token, issueId) {
    const store = this._requireStore()
    const doc = await store.getIssue(token, issueId)
    if (!doc) return null
    const nameById = await this._projectNameMap(token)
    const base = this._toCanonicalIssue(doc, nameById)
    const childDocs = await store.getChildren(token, doc._id)
    const parentDoc = doc.parentId ? await store.getIssue(token, doc.parentId) : null
    const { relations, inverseRelations } = await this._relationConnections(store, token, doc)
    return {
      ...base,
      trashed: false,
      parent: parentDoc
        ? { id: parentDoc._id, identifier: parentDoc.identifier, title: parentDoc.title }
        : null,
      children: { nodes: childDocs.map(c => this._issueRef(c)) },
      comments: {
        nodes: (doc.comments || []).map(c => ({
          id: c.id,
          body: c.body,
          createdAt: c.createdAt,
          user: { name: typeof c.user === 'string' ? c.user : (c.user?.name || 'Local') },
        })),
      },
      relations,
      inverseRelations,
    }
  }

  /**
   * An issue's relations + inverse relations in the proxy's
   * `{ trashed, relations: { nodes }, inverseRelations: { nodes } }` shape, or
   * null if the issue is missing. Mirrors the Linear provider's `relations()`.
   */
  async relations(token, issueId) {
    const store = this._requireStore()
    const doc = await store.getIssue(token, issueId)
    if (!doc) return null
    const { relations, inverseRelations } = await this._relationConnections(store, token, doc)
    return { trashed: false, relations, inverseRelations }
  }

  /** No cycle concept in the local harness — canonical-empty (LIN-583). */
  async cycles(_token, _teamId = null) {
    return []
  }

  /** No cycle concept in the local harness — null, mirroring a missing cycle. */
  async cycleDetail(_token, _cycleId) {
    return null
  }

  // --- Write-path guard reads + label RMW primitive --------------------------

  /** Trashed-only probe ({ id, trashed } or null). Local never trashes. */
  async issueWriteGuard(token, issueId) {
    const doc = await this._requireStore().getIssue(token, issueId)
    // LIN-1553: expose a (synthetic) team so the session-auth + proxy update
    // routes can scope symbolic state resolution. Local states are team-agnostic
    // (`states()` ignores teamId), so the id is a stable placeholder — what
    // matters is that it is non-null, letting the route resolve a state name
    // against LOCAL_STATES instead of failing "team could not be determined".
    return doc ? { id: doc._id, trashed: false, team: { id: 'local' } } : null
  }

  /** Lightweight description read ({ id, description, trashed } or null). */
  async issueDescription(token, issueId) {
    const doc = await this._requireStore().getIssue(token, issueId)
    return doc ? { id: doc._id, description: doc.description ?? '', trashed: false } : null
  }

  /**
   * Current label set + trashed flag ({ id, trashed, labels: { nodes } } or
   * null) for the label add/remove read-modify-write. Local labels are names, so
   * each node is { id: name, name }.
   */
  async issueLabels(token, issueId) {
    const doc = await this._requireStore().getIssue(token, issueId)
    if (!doc) return null
    return {
      id: doc._id,
      trashed: false,
      labels: { nodes: (doc.labels || []).map(name => ({ id: name, name })) },
    }
  }

  /**
   * Write a full label set onto an issue (the write half of the label RMW).
   * Local label "ids" are names, so `labelIds` is stored verbatim. Returns the
   * issueUpdate-shaped payload ({ success, issue }) the route echoes.
   */
  async updateIssueLabels(token, issueId, labelIds) {
    const store = this._requireStore()
    const doc = await store.updateIssue(token, issueId, { labels: labelIds })
    if (!doc) return { success: false, issue: null }
    const nameById = await this._projectNameMap(token)
    return { success: true, issue: this._toCanonicalIssue(doc, nameById) }
  }

  /**
   * Delete a relation by its own id. Returns the issueRelationDelete-shaped
   * payload ({ success }) the route echoes.
   */
  async deleteRelation(token, relationId) {
    const removed = await this._requireStore().deleteRelation(token, relationId)
    return { success: removed }
  }

  /** Minimal issue reference ({ id, identifier, title, state }) for nested nodes. */
  _issueRef(doc) {
    if (!doc) return null
    return {
      id: doc._id,
      identifier: doc.identifier,
      title: doc.title,
      state: doc.state || { name: 'Backlog', type: 'backlog' },
    }
  }

  /**
   * Build the `{ relations: { nodes }, inverseRelations: { nodes } }` pair for an
   * issue. Outgoing relations live on the issue itself (enriched with the target
   * reference); inverse relations are found by scanning the partition for other
   * issues whose relation points back at this one.
   */
  async _relationConnections(store, token, doc) {
    const relNodes = []
    for (const r of (doc.relations || [])) {
      const target = await store.getIssue(token, r.relatedIssueId)
      relNodes.push({
        id: r.id,
        type: r.type,
        relatedIssue: this._issueRef(target) || { id: r.relatedIssueId },
      })
    }
    const invNodes = []
    for (const other of await store.listIssues(token)) {
      if (other._id === doc._id) continue
      for (const r of (other.relations || [])) {
        if (r.relatedIssueId === doc._id || r.relatedIssueId === doc.identifier) {
          invNodes.push({ id: r.id, type: r.type, issue: this._issueRef(other) })
        }
      }
    }
    return { relations: { nodes: relNodes }, inverseRelations: { nodes: invNodes } }
  }

  // ---------------------------------------------------------------------------
  // URLs / UI capability surface
  // ---------------------------------------------------------------------------

  /**
   * Local "create task" deep link. Overriding this is what makes `ui.write`
   * true — render gates the "+ Add task" affordance on it. Dead in practice for
   * Local: `ui.inlineCreate` (Local implements `createIssue`) takes render.js's
   * "+ Add task" link to the dedicated `/workspace/:urlKey/task/new` page
   * instead (LIN-1973), so this URL is never actually rendered. The path below
   * was already stale before that — `/workspace/:urlKey/new` has never been a
   * registered route — left as-is since fixing an unreachable URL is out of
   * scope here; the real create surface is `/workspace/:urlKey/task/new`.
   */
  getCreateTaskUrl(urlKey, projectId) {
    return `/workspace/${encodeURIComponent(urlKey)}/new?project=${encodeURIComponent(projectId)}`
  }

  /**
   * write/comments auto-derive from the base getter (getCreateTaskUrl override +
   * fetchIssueComments implementation). Override only the abstract bits:
   * subtasks (parent/child is natural here), estimates (no point estimates),
   * attachments (LIN-771: descriptions/comments are markdown that can embed upload
   * links the host-anchored collector discovers), and the human displayName.
   */
  get ui() {
    return { ...super.ui, estimates: false, subtasks: true, attachments: true, displayName: 'Local' }
  }

  // ---------------------------------------------------------------------------
  // Writes — the whole reason this provider exists
  // ---------------------------------------------------------------------------

  /** @returns {Promise<Object>} the created issue (canonical shape). */
  async createIssue(token, input = {}) {
    const doc = await this._requireStore().createIssue(token, applyLocalStateId(input))
    const nameById = await this._projectNameMap(token)
    return this._toCanonicalIssue(doc, nameById)
  }

  /** @returns {Promise<Object|null>} the updated issue (canonical shape), or null if missing. */
  async updateIssue(token, issueId, patch = {}) {
    const doc = await this._requireStore().updateIssue(token, issueId, applyLocalStateId(patch))
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

  /**
   * Delete a comment by its own id. Returns the commentDelete-shaped payload
   * ({ success }) the route echoes (mirrors deleteRelation).
   */
  async deleteComment(token, commentId) {
    const removed = await this._requireStore().removeComment(token, commentId)
    return { success: removed }
  }

  /**
   * @returns {Promise<Object|null>} the updated comment (bare entity, wrapped
   * by the route's normalizeWritePayload), or null if not found.
   */
  async updateComment(token, commentId, body) {
    return this._requireStore().updateComment(token, commentId, body)
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
