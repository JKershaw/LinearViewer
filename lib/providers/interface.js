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
//   * `routes/proxy.js` can catch `NotImplementedError` (introspect
//     `.code === 'NOT_IMPLEMENTED'`) to answer a clean 4xx, never 500.
//   * Callers that want to decline *gracefully* — without triggering the throw
//     at all — introspect `provider.supports(method)` / `provider.capabilities`
//     first. The capability descriptor is the "never 500" path; the throw is
//     the backstop for code that calls blind. On the consumer write path this
//     is exactly what `denyIfUnsupported()` does: it gates on `supports()` and
//     returns 422 `CAPABILITY_NOT_SUPPORTED` (LIN-309), so the documented
//     unsupported-write convention is 422, not 501.
// None of the declared-but-unimplemented methods has a current consumer, so the
// choice has zero effect on this phase's behavior; it only shapes LIN-306/307.

import { getStateDisplay, getStateOrder } from './state-map.js'

/**
 * Thrown by interface methods a provider has not implemented.
 * Carries the method name and provider so a route can map it to a clean 4xx
 * (the consumer write path returns 422 `CAPABILITY_NOT_SUPPORTED`, not 500/501)
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
 * Thrown by `completeAuth(code)` when the provider's credential exchange fails
 * cleanly (e.g. a non-2xx token-endpoint response). Distinct from an unexpected
 * runtime error so the shared auth callback can map it to a "could not
 * authenticate, try again" page (HTTP 400) rather than a generic 500 — keeping
 * the Linear retrofit byte-identical to the old inline `!response.ok` branch.
 */
export class AuthExchangeError extends Error {
  constructor(detail, providerName = 'provider') {
    super(`${providerName} auth code exchange failed`)
    this.name = 'AuthExchangeError'
    this.detail = detail
    this.provider = providerName
    this.code = 'AUTH_EXCHANGE_FAILED'
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
  // Writes as first-class methods. The original six landed declared-only in
  // LIN-176; LIN-307 wires them on the Linear provider and adds the three that
  // complete the consumer API's write surface (relation delete + comment
  // edit/delete). Still capability-gated — non-Linear providers opt out.
  writes: [
    'createIssue',
    'updateIssue',
    'createComment',
    'updateComment',
    'deleteComment',
    'createRelation',
    'deleteRelation',
    'addLabel',
    'removeLabel',
  ],
  // File/asset uploads (LIN-636). A single additive method whose consumers are
  // the feedback-submit route and the agent-facing attachment upload route
  // (LIN-891) — it returns a hosted URL the caller embeds in markdown. Listed
  // here so `supports('uploadFile')` and the 422 CAPABILITY_NOT_SUPPORTED gate
  // work; non-upload providers inherit the decline.
  uploads: ['uploadFile'],
  // Formal attachment id -> backend URL/title resolution (LIN-890). A single
  // additive method whose sole consumer is the attachment relay's `att:` branch
  // — it resolves an opaque attachment id to `{ url, title }` so the relay can
  // run the URL through the existing SSRF-guarded fetch/stream path. Providers
  // with no formal-attachment node (e.g. GitHub Issues) correctly never mint
  // `att:` handles, so they inherit the capability decline.
  attachments: ['fetchAttachment'],
}

const ALL_SURFACE_METHODS = [
  ...PROVIDER_SURFACE.reads,
  ...PROVIDER_SURFACE.readsHeadroom,
  ...PROVIDER_SURFACE.writes,
  ...PROVIDER_SURFACE.uploads,
  ...PROVIDER_SURFACE.attachments,
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
      // LIN-1552: derived, session-auth in-app issue write affordances. Unlike
      // `write` (an external create-URL link), these gate the in-app create/edit
      // forms on the provider's real createIssue/updateIssue support, so they
      // can't drift. Derived here for every provider — no per-provider edits.
      inlineCreate: this.supports('createIssue'),             // in-app create form
      inlineEdit: this.supports('updateIssue'),               // in-app edit form
      estimates: false,   // abstract — opt in per provider
      subtasks: false,    // abstract — opt in per provider
      attachments: false, // abstract — read-attachments support, opt in (LIN-649)
      // LIN-1886: whether the in-app edit form should show a priority control.
      // Default true for every provider (Linear/GitHub/Local all map a real
      // priority field, even where the field is otherwise unmapped/constant);
      // a provider whose priority is genuinely unmapped/unhonored overrides it
      // false so the control is hidden rather than lying (Jira: D3).
      priority: true,
      displayName: this.name, // fall back to machine name; never undefined
    }
  }

  // ---------------------------------------------------------------------------
  // Identity surface (LIN-2010) — declared, not hand-maintained
  // ---------------------------------------------------------------------------
  //
  // Provider identity (landing blurb/order, Settings add-row shape, entry CTA)
  // used to live in four independent hand-maintained lists that no provider
  // owned — it has already drifted once (Jira's landing-strip omission). These
  // three getters extend the `refresh-strategy.js` declared-table idiom to
  // identity: each provider states its own facts, and render surfaces read the
  // registry instead of a parallel list. `displayName` is deliberately NOT
  // duplicated here — `ui.displayName` stays the single source of truth.
  //
  // All three default to `null` on the base class. `null`, not an empty object,
  // is the fail-safe default: a provider that declares nothing is never
  // silently rendered with blank/broken markup — it is simply absent from that
  // surface (landing sorts it last via `?? Infinity`; Settings/hero/navbar skip
  // it entirely), which is the correct behavior for a provider that doesn't
  // participate in that surface (e.g. `local` has no Settings add row, and
  // `github-projects` has no entry CTA) rather than an oversight to paper over.

  /**
   * Landing-strip identity: `{ blurb, order }` or `null` for "not shown".
   * `order` is a declared integer, not derived from Map/import order — see
   * lib/providers/index.js's barrel-order comment for why import order is not
   * trustworthy as a display order.
   * @returns {{blurb: string, order: number}|null}
   */
  get landingCatalogue() {
    return null
  }

  /**
   * Settings "add a source" row identity: `{ authShapes, addHint, blockedBy,
   * configPredicate }` or `null` for "no row" (e.g. `local`, whose door is
   * `POST /workspace/new`, not `/providers/add`).
   * `configPredicate` is a row-level gate — a zero-arg function returning
   * boolean, or `undefined` for an unconditionally-enabled row. It is
   * independent of and composable with a per-shape `authShapes[].requiresConfig`
   * gate (e.g. Jira's OAuth shape): a provider may use either, both, or neither.
   * @returns {{authShapes?: object[], addHint?: string, blockedBy?: string|null, configPredicate?: () => boolean}|null}
   */
  get addProvider() {
    return null
  }

  /**
   * New-login entry-point identity: `{ href, isConfigured() }` or `null` for
   * "no CTA" (e.g. `github-projects`, which has route capability but is
   * deliberately not a login entry point). Deliberately minimal — copy, CSS
   * classes, and testids stay surface-owned on each render site; only the href
   * and configured-ness are shared facts.
   * @returns {{href: string, isConfigured: () => boolean}|null}
   */
  get entryCta() {
    return null
  }

  // ---------------------------------------------------------------------------
  // Create-field capability contract (LIN-1504/LIN-1972)
  // ---------------------------------------------------------------------------
  //
  // The create form's field set is capability-derived from this list, never a
  // fixed form — a provider that can't round-trip a field must not declare it,
  // so it is never rendered and never silently dropped. Deliberately NOT
  // sourced from `supports()` or `fetchTeams()`: a provider can be writable
  // with no teams (Local, GitHub), so team capability is declared here, not
  // inferred from an empty `fetchTeams()` list.
  createFields() {
    return ['title', 'description']
  }

  // ---------------------------------------------------------------------------
  // Headless write-door capability contract (LIN-1557)
  // ---------------------------------------------------------------------------
  //
  // The agent-facing proxy's accept-list for POST /api/proxy/issues' OPTIONAL
  // fields. Deliberately separate from `createFields()` above: that method is
  // the UI-form descriptor (pinned byte-identical by tests/unit/providers.test.js,
  // rendered EXACTLY by lib/render-task-create.js) and must not be repurposed
  // as an API accept-list — a provider's real write surface can be wider than
  // its form (e.g. Linear's IssueCreateInput honours assigneeId/parentId/
  // cycleId end-to-end even though the create form never renders them).
  // Default is the UI-form list, fail-closed for any provider that doesn't
  // override it.
  apiWriteFields() {
    return this.createFields()
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

  // beginAuth({ state }) returns the external authorization URL to redirect the
  // user to (OAuth providers), given an opaque CSRF `state` nonce. completeAuth(
  // code) exchanges the returned authorization code for credentials and resolves
  // to a token bag (`{ access_token, refresh_token, expires_in }`-shaped). These
  // are the credential-ACQUISITION seam the generic auth callback drives (LIN-562);
  // a synchronous, non-OAuth provider (local) acquires its credential without
  // either (it links directly via linkProvider), so both stay declared headroom
  // here. Linear implements both; see lib/providers/linear/index.js.
  beginAuth() {
    throw new NotImplementedError('beginAuth', this.name)
  }

  completeAuth() {
    throw new NotImplementedError('completeAuth', this.name)
  }

  // refreshCredential(binding) renews a binding's credential WITHOUT a fresh user
  // interaction, returning a credentials patch the caller folds back through
  // linkProvider (LIN-712). It is the provider-aware seam the token-refresh
  // middleware (server.js ensureValidToken) routes through for providers whose
  // tokens are minted rather than exchanged: GitHub App installation tokens are
  // RE-MINTED from the App JWT + installationId (no refresh_token). Linear is NOT
  // routed here — it keeps its own refresh_token exchange, byte-identical — so
  // this stays declared headroom for the base/Linear and is implemented by GitHub.
  refreshCredential() {
    throw new NotImplementedError('refreshCredential', this.name)
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
  updateComment() { throw new NotImplementedError('updateComment', this.name) }
  deleteComment() { throw new NotImplementedError('deleteComment', this.name) }
  createRelation() { throw new NotImplementedError('createRelation', this.name) }
  deleteRelation() { throw new NotImplementedError('deleteRelation', this.name) }
  addLabel() { throw new NotImplementedError('addLabel', this.name) }
  removeLabel() { throw new NotImplementedError('removeLabel', this.name) }

  // ---------------------------------------------------------------------------
  // Uploads (LIN-636) — declared headroom; only the Linear provider implements
  // it this phase. uploadFile(apiKey, bytes, meta) uploads raw bytes and
  // resolves to the public hosted URL (e.g. for embedding as ![](url)).
  // ---------------------------------------------------------------------------
  uploadFile() { throw new NotImplementedError('uploadFile', this.name) }

  // ---------------------------------------------------------------------------
  // Attachments (LIN-890) — declared headroom; only the Linear provider
  // implements it this phase. fetchAttachment(apiKey, attachmentId) resolves a
  // formal attachment id to `{ url, title } | null` (null on missing, mirroring
  // `cycleDetail`'s not-found convention).
  // ---------------------------------------------------------------------------
  fetchAttachment() { throw new NotImplementedError('fetchAttachment', this.name) }
}
