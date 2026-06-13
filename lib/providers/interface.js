// =============================================================================
// Provider Interface (LIN-176 Phase 2, Subtask 1 — the Contract)
// =============================================================================
//
// The base class every issue-tracker provider extends. It declares the *full
// eventual surface* (Option 2): reads, writes, and auth are all first-class
// methods here, even the ones no provider implements yet. Concrete providers
// override only what they support this phase; everything else inherits a
// capability-gated decline so LIN-306/307 can *extend* this surface rather than
// redesign it.
//
// --- NotImplemented shape: thrown error, not a returned sentinel -------------
// Unimplemented methods throw `NotImplementedError` (a named subclass) rather
// than returning an `{unsupported: true}` sentinel. Rationale:
//   * The dashboard read methods this phase already signal failure by throwing
//     (callers catch and map e.g. 401 → re-auth). A sentinel return would force
//     every existing call site to add an `if (result.unsupported)` branch —
//     that is behavior change. A throw matches the established contract.
//   * `routes/proxy.js` wraps handlers and can catch `NotImplementedError`
//     (introspect `.code === 'NOT_IMPLEMENTED'`) to answer 501, never 500.
//   * Callers that want to decline *gracefully* — without triggering the throw
//     at all — introspect `provider.supports(method)` / `provider.capabilities`
//     first. The capability descriptor is the "never 500" path; the throw is
//     the backstop for code that calls blind.
// None of the declared-but-unimplemented methods has a current consumer, so the
// choice has zero effect on this phase's behavior; it only shapes LIN-306/307.

import { getStateDisplay, getStateOrder } from './state-map.js'

/**
 * Thrown by interface methods a provider has not implemented.
 * Carries the method name and provider so a route can map it to 501 (not 500)
 * and a caller can log precisely what was declined.
 */
export class NotImplementedError extends Error {
  constructor(method, providerName = 'provider') {
    super(`${providerName}.${method}() is not implemented`)
    this.name = 'NotImplementedError'
    this.method = method
    this.provider = providerName
    this.code = 'NOT_IMPLEMENTED'
  }
}

/**
 * The full declared surface, grouped. Used by the capability descriptor to
 * report what each provider implements vs. what is merely declared headroom.
 * Keep this in sync with the method declarations below.
 */
export const PROVIDER_SURFACE = {
  // Reads the Linear provider wires this phase.
  reads: [
    'fetchProjects',
    'fetchProjectsList',
    'fetchTeams',
    'fetchOrganization',
    'fetchViewer',
    'fetchIssueContext',
    'fetchIssueComments',
    'fetchIssueFields',
    'fetchFocusedChild',
    'fetchRecommendationContext',
  ],
  // Reads declared as headroom — unimplemented this phase (LIN-306/307).
  readsHeadroom: ['search', 'states', 'labels', 'cycles', 'cycleDetail', 'relations'],
  // Writes as first-class methods — declared now, unimplemented this phase.
  writes: ['createIssue', 'updateIssue', 'createComment', 'createRelation', 'addLabel', 'removeLabel'],
}

const ALL_SURFACE_METHODS = [
  ...PROVIDER_SURFACE.reads,
  ...PROVIDER_SURFACE.readsHeadroom,
  ...PROVIDER_SURFACE.writes,
]

export class ProviderInterface {
  constructor() {
    this.name = 'base'
  }

  // ---------------------------------------------------------------------------
  // Capability descriptor
  // ---------------------------------------------------------------------------
  //
  // Derived by comparing each surface method against the base prototype: if a
  // subclass overrode it, it is "implemented"; if it still resolves to the
  // base's throwing stub, it is "declared but unimplemented". Deriving it (vs.
  // a hand-maintained list) means the descriptor can never drift from reality.

  get capabilities() {
    const base = ProviderInterface.prototype
    const caps = {}
    for (const method of ALL_SURFACE_METHODS) {
      caps[method] = typeof this[method] === 'function' && this[method] !== base[method]
    }
    return caps
  }

  /** True if this provider actually implements `method` (safe to call). */
  supports(method) {
    return this.capabilities[method] === true
  }

  /** { implemented: [...], declared: [...] } split of the declared surface. */
  getCapabilities() {
    const caps = this.capabilities
    const implemented = []
    const declared = []
    for (const method of ALL_SURFACE_METHODS) {
      ;(caps[method] ? implemented : declared).push(method)
    }
    return { provider: this.name, implemented, declared }
  }

  // ---------------------------------------------------------------------------
  // UI/prompt capability surface (LIN-332, S0 of LIN-177 Phase 3)
  // ---------------------------------------------------------------------------
  //
  // A small, ABSTRACT map of presentation/prompt affordances — deliberately
  // separate from the method-keyed `capabilities`/`supports()` descriptor above.
  // Render (S3) and prompt-formatters/templates (S4/S5) read `provider.ui.<flag>`
  // as their single decision point; they never branch on `supports()` for these.
  //
  // Two flags auto-derive from real signals so they can't drift; two are abstract
  // literals with no backing method (opt-in per provider). `displayName` is the
  // single source of the human-facing provider name (S3 + S4/S5 both read it) and
  // falls back to `this.name` so downstream reads are always a string, never
  // undefined.
  //
  // NOTE: `write` derives from `getCreateTaskUrl` being overridden, NOT from
  // `supports('createIssue')`. `supports('createIssue')` is intentionally false
  // this phase; gating "+ Add task" on it would hide the affordance for Linear.
  // That decoupling is the entire reason this surface exists — see the regression
  // guard in tests/unit/providers.test.js.
  get ui() {
    const base = ProviderInterface.prototype
    return {
      write: this.getCreateTaskUrl !== base.getCreateTaskUrl, // has a create affordance
      comments: this.supports('fetchIssueComments'),          // implemented read
      estimates: false,   // abstract — opt in per provider
      subtasks: false,    // abstract — opt in per provider
      displayName: this.name, // fall back to machine name; never undefined
    }
  }

  // ---------------------------------------------------------------------------
  // Canonical state mapping — delegates to the Phase-1 state-map (LIN-175).
  // Do not reinvent the model here.
  // ---------------------------------------------------------------------------

  /**
   * Map a canonical state.type to its display info and sort order.
   * @param {string|undefined} type
   * @returns {{class: string, char: string, label: string, order: number|undefined}}
   */
  mapState(type) {
    return { ...getStateDisplay(type), order: getStateOrder(type) }
  }

  // ---------------------------------------------------------------------------
  // Auth — declared here, but non-Linear auth semantics are deferred.
  // ---------------------------------------------------------------------------
  //
  // getAuthRouter() returns an Express router mounting this provider's auth
  // flow. The Linear provider's implementation (wiring routes/auth.js) lands in
  // LIN-331 (Subtask 2); other providers' auth semantics are deferred entirely.
  // Declared now so the contract is fixed.
  getAuthRouter() {
    throw new NotImplementedError('getAuthRouter', this.name)
  }

  // ---------------------------------------------------------------------------
  // URLs — provider-specific deep links the dashboard renders.
  // ---------------------------------------------------------------------------
  //
  // getCreateTaskUrl(urlKey, projectId) returns the external URL for creating a
  // new task in `projectId` within workspace `urlKey`. render.js consumes this
  // instead of hard-coding a Linear URL. Linear's implementation lands in
  // LIN-331; other providers' link semantics are deferred.
  getCreateTaskUrl() {
    throw new NotImplementedError('getCreateTaskUrl', this.name)
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------
  fetchProjects() { throw new NotImplementedError('fetchProjects', this.name) }
  fetchProjectsList() { throw new NotImplementedError('fetchProjectsList', this.name) }
  fetchTeams() { throw new NotImplementedError('fetchTeams', this.name) }
  fetchOrganization() { throw new NotImplementedError('fetchOrganization', this.name) }
  fetchViewer() { throw new NotImplementedError('fetchViewer', this.name) }
  fetchIssueContext() { throw new NotImplementedError('fetchIssueContext', this.name) }
  fetchIssueComments() { throw new NotImplementedError('fetchIssueComments', this.name) }
  // Single-issue canonical fields for the lazy dashboard detail surface (LIN-442).
  // Returns one issue in the same `{ nodes }`-labelled shape `fetchProjects` emits
  // per node, so `renderDetailsContent` consumes it unchanged.
  fetchIssueFields() { throw new NotImplementedError('fetchIssueFields', this.name) }
  fetchFocusedChild() { throw new NotImplementedError('fetchFocusedChild', this.name) }
  fetchRecommendationContext() { throw new NotImplementedError('fetchRecommendationContext', this.name) }

  // Reads declared as headroom (unimplemented this phase).
  search() { throw new NotImplementedError('search', this.name) }
  states() { throw new NotImplementedError('states', this.name) }
  labels() { throw new NotImplementedError('labels', this.name) }
  cycles() { throw new NotImplementedError('cycles', this.name) }
  cycleDetail() { throw new NotImplementedError('cycleDetail', this.name) }
  relations() { throw new NotImplementedError('relations', this.name) }

  // ---------------------------------------------------------------------------
  // Writes — first-class methods (not a special-case path). Declared now,
  // unimplemented this phase.
  // ---------------------------------------------------------------------------
  createIssue() { throw new NotImplementedError('createIssue', this.name) }
  updateIssue() { throw new NotImplementedError('updateIssue', this.name) }
  createComment() { throw new NotImplementedError('createComment', this.name) }
  createRelation() { throw new NotImplementedError('createRelation', this.name) }
  addLabel() { throw new NotImplementedError('addLabel', this.name) }
  removeLabel() { throw new NotImplementedError('removeLabel', this.name) }
}
