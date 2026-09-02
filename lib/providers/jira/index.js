// =============================================================================
// Jira Cloud Provider — Phase 1 (LIN-1885) + Phase 2 writes (LIN-1886, both of
// LIN-275)
// =============================================================================
//
// Phase 1 was read-only Jira Cloud on API-token Basic auth. Phase 2 (LIN-1886)
// adds the write surface: updateIssue (title/description/status transitions),
// createComment, label mutation. LIN-2018 re-pointed the canonical TEAM level
// at Jira projects; LIN-2011 re-pointed the canonical PROJECT level at Jira
// EPICS (team-managed via native `fields.parent`, company-managed via legacy
// "Epic Link" custom-field discovery — see `isEpicParent`/
// `_resolveEpicLinkFieldId` below). Still out of scope: createIssue (deferred
// behind LIN-1557 — no native Jira "team" concept to hang a required teamId
// off), OAuth 3LO (Phase 3), story-point mapping (LIN-1888). See LIN-275's
// Implementation Plan (Revision 4) and LIN-1886's research comments for the
// full reasoning.
//
// --- Capability profile (LIN-1886) -------------------------------------------
//   write:     true  → overrides getCreateTaskUrl (external "create issue" deep
//                      link) — decoupled from inlineCreate, which stays false
//                      (createIssue is still unimplemented)
//   comments:  true  → fetchIssueComments (read) + createComment (write)
//   subtasks:  true  → Jira's native one-level subtasks map to parent/children
//                      on a best-effort basis (fetchIssueContext)
//   estimates: false → no story-point mapping this phase (LIN-1888)
//   teams:     true  → fetchTeams returns the tenant's Jira projects mapped to
//                      canonical teams, id = project key (LIN-2018, Option 2 of
//                      the LIN-2007 ruling) — no in-tree `ui.teams` flag exists,
//                      so this is expressed purely by the read no longer being
//                      empty. INDEPENDENT of the canonical PROJECT level: since
//                      LIN-2011, canonical `project` comes from EPICS
//                      (`_epicToCanonicalProject`/`fetchProjects`), not from
//                      Jira project objects — a Jira project's own numeric id
//                      is no longer surfaced as a canonical project anywhere,
//                      only as this canonical team.
//   cycles:    false → simply not overridden (no in-tree `ui.cycles` flag
//                      either — cycles:false is the base's un-overridden decline)
//   priority:  false → `ui.priority` override (LIN-1886): priority is hardcoded
//                      0/unmapped in `_toCanonicalIssue`, so the in-app edit
//                      form hides the control rather than lying about it (D3)
//   inlineEdit: true → updateIssue is implemented (LIN-1886); inlineCreate stays
//                      false (createIssue remains deferred)
//
// --- Credential / scope shape --------------------------------------------------
// Jira Basic auth needs THREE fields per request (`email`, `apiToken`, `site`),
// unlike GitHub's bare token/repo-string scope. `_clientFor(scope)` therefore
// accepts only a `{ email, apiToken, site }` credential object (built by
// `getWorkspaceCallScope`'s Jira branch — LIN-1885 beat 3) or falls back to a
// boot-configured `client` (the unit-test / DI path, mirroring
// GitHubProvider._requireClient). There is no bare-string scope for Jira: a
// site alone cannot authenticate, and packing all three into one string was
// explicitly rejected by the LIN-1885 research (a second credential
// representation with two writers/parsers) in favor of this per-provider
// dispatch, which is what `getBindingCallScope`/`getWorkspaceCallScope` already
// are for github vs. everyone else.
//
// --- Write-path design notes (LIN-1886, Revision 4) --------------------------
//   D1 (unrenderable-content refusal): a description-overwrite refuses (422)
//     whenever the CURRENT stored ADF contains anything `markdownToAdf` cannot
//     rebuild from `adfToMarkdown`'s output (`adfHasUnrenderableContent`) —
//     never a silent, corrupting overwrite. The gate is derived from the
//     WRITER's vocabulary, not the reader's (LIN-1886 review Blocker 3).
//   D2 (status transitions, LIN-2018 root fix): `patch.stateId` is matched
//     EXACTLY against the issue's current real status id — a same-id patch is
//     a no-op (no `getTransitions`/`doTransition` call at all); otherwise the
//     transition whose `to.id` matches `patch.stateId` exactly wins, and a
//     screen-required transition refuses (422). This replaced the earlier
//     first-match-on-`statusCategory` scheme (LIN-1941's hazard: a `done`
//     target could land on "Won't Do" instead of "Done") now that `states()`
//     exposes the project's own real status ids to match against, rather than
//     a synthetic 3-entry vocabulary with no per-status identity. An id this
//     integration cannot match against any transition (a stale id, a
//     synthetic legacy alias like `"canceled"`) refuses loudly (422) rather
//     than guessing — it can never silently land on the wrong status.
//   D3 (priority exclusion): `patch.priority` is never mapped into the Jira PUT
//     body — silently dropped, mirroring `ui.priority: false` hiding the
//     control client-side.
//   D4 (patch-field refusal): `patch.projectId` (any value) and
//     `patch.parentId === null` refuse (422) — Jira cannot honor either through
//     this integration.
//
// `issueWriteGuard` / `issueDescription` / `issueLabels` / `updateIssueLabels`
// are route-internal reads the write routes call unconditionally (mirrors
// `lib/providers/github/index.js:775-847`) — deliberately OFF the declared
// `PROVIDER_SURFACE`, gated by method EXISTENCE in the routes
// (`denyIfMissingRead`), not by `supports()`.

import { ProviderInterface } from '../interface.js'
import { registerProvider } from '../registry.js'
import { SOURCE_JIRA, STATE_ORDER } from '../models.js'
// The one "this reference cannot be resolved / this write cannot be honored"
// error class both write surfaces (routes/proxy.js, routes/workspace-api.js)
// already map to a clean 422 — reused for the D1/D2/D4 refusals below (mirrors
// GitHub's `githubStateIdToCanonicalType`, see lib/providers/github/index.js).
import { RefResolutionError } from '../../proxy-ref-resolver.js'
import { PartialWriteError } from '../../partial-write-error.js'
import { createJiraClient } from './client.js'
import { createJiraAuthRoutes } from '../../../routes/jira-auth.js'
import { isJiraOAuthConfigured, fetchJiraAccessibleResources } from './oauth.js'
import { selectFocusSubtask } from '../../tree.js'
import { adfToMarkdown, markdownToAdf, adfHasUnrenderableContent } from './adf.js'

export { createJiraClient } from './client.js'

// -----------------------------------------------------------------------------
// Pure state mapping — Jira's `statusCategory.key` → canonical state.
// -----------------------------------------------------------------------------
//
// Jira workflow statuses are fully customizable per-project/per-workflow, so
// the only STABLE signal is the status category every status belongs to:
// `new` | `indeterminate` | `done`. Free-text status names are never mapped
// directly (a "Blocked" status and a "Blocked?" status must not silently
// diverge in meaning). `canceled`/`duplicate` are deliberately NOT reachable
// from statusCategory — Jira has no such category — so an issue Jira itself
// calls "done" (however it got there) always reads as canonical `completed`.
//
// `statusCategoryKeyToType` is the ONE place that key→type mapping lives —
// shared by `jiraStatusCategoryToCanonical` below (per-issue) and `states()`
// (per-project vocabulary, LIN-2018) so the two cannot independently drift.
function statusCategoryKeyToType(key) {
  if (key === 'new') return 'unstarted'
  if (key === 'indeterminate') return 'started'
  if (key === 'done') return 'completed'
  // Unrecognized/missing category — a safe, non-terminal default rather than
  // guessing at canceled/duplicate from a status name.
  return 'unstarted'
}

/**
 * Exported so the mapping is unit-testable in isolation (mirrors
 * githubStateToCanonical).
 *
 * The canonical state also carries the issue's REAL Jira status `id`
 * (LIN-2018 — previously a synthetic 3-entry vocabulary id, LIN-1886 D2).
 * That stamp is load-bearing, not cosmetic: `lib/render-task-edit.js`'s
 * `renderStateControl` preselects the current option via
 * `String(state.id) === currentId` FIRST and only falls back to matching on
 * NAME. Jira's real per-workflow status names are free text ("Ready for
 * QA") and `states()` now returns the project's own real statuses (LIN-2018)
 * — but the id is what makes the match exact rather than name-coincidental,
 * so without it a custom workflow's status could still miss, the browser
 * would default the `<select>` to its first option, and a title-only save
 * would silently regress the issue's status. `id` is `null` only when the
 * upstream status genuinely carries none (defensive — real Jira REST
 * responses always include one), in which case the control degrades
 * gracefully to matching on name instead.
 */
export function jiraStatusCategoryToCanonical(issue = {}) {
  const status = issue?.fields?.status
  const key = status?.statusCategory?.key
  const name = status?.name || 'Unknown'
  const id = status?.id != null ? String(status.id) : null
  return { id, name, type: statusCategoryKeyToType(key) }
}

// -----------------------------------------------------------------------------
// Inverse mapping (LIN-2155) — canonical state.type -> the Jira statusCategory
// NAME a JQL `statusCategory = "..."` clause matches on (JQL matches the
// category's display name, not its wire `key` above). Only the three types
// Jira can reach are present; backlog/canceled/duplicate are deliberately
// absent — Jira has no such category (see the block comment above
// `statusCategoryKeyToType`). This is the ONE place a Jira category literal
// is written — the tiered-fetch query builder below reads through it rather
// than duplicating the strings inline.
// -----------------------------------------------------------------------------
export const CANONICAL_TYPE_TO_JIRA_STATUS_CATEGORY = {
  started: 'In Progress',
  unstarted: 'To Do',
  completed: 'Done',
}

/**
 * Tier order for a Jira status-scoped walk (LIN-2155), driven from canonical
 * `STATE_ORDER` (lib/providers/models.js) rather than a literal array, so the
 * tier list cannot drift from the canonical ordering it mirrors. Filtered to
 * the three types Jira can express — `=> ['started', 'unstarted', 'completed']`.
 * Exported so the mapping is unit-testable in isolation (mirrors
 * `isEpicParent`/`jiraStatusCategoryToCanonical`).
 */
export function jiraReachableTierOrder() {
  return Object.keys(STATE_ORDER)
    .filter(type => type in CANONICAL_TYPE_TO_JIRA_STATUS_CATEGORY)
    .sort((a, b) => STATE_ORDER[a] - STATE_ORDER[b])
}

// -----------------------------------------------------------------------------
// ADF (Atlassian Document Format) <-> Markdown codec — extracted to ./adf.js
// (LIN-2399, mechanical extraction of the self-contained ~800-line codec
// formerly here, LIN-2378 code quality review finding F3). This module reaches
// it only through the three imports below.
// -----------------------------------------------------------------------------


// -----------------------------------------------------------------------------
// The exact `fields` a JQL search must request (LIN-1885 beat 1 review
// blocker) — `/rest/api/3/search/jql` returns only issue IDs by default, so
// every field `_toCanonicalIssue`/`fetchIssueContext` reads off `jira.fields`
// below MUST be listed here or it silently comes back `undefined`. Verified
// against both read sites by hand at beat time; keep this list and those two
// functions in lockstep.
// -----------------------------------------------------------------------------
export const JIRA_ISSUE_FIELDS = [
  'summary', 'status', 'description', 'project', 'parent', 'issuetype',
  'assignee', 'labels', 'created', 'duedate', 'resolutiondate',
]

// -----------------------------------------------------------------------------
// Epic vs. subtask parent detection (LIN-2011) — the signal `_toCanonicalIssue`
// routes an issue's canonical `project` (epic) vs `parent` (native subtask) on.
// -----------------------------------------------------------------------------

/**
 * True when a Jira `issuetype` object identifies an EPIC. `hierarchyLevel`
 * (Jira's own structural epic marker, `1` for the Epic level) is preferred
 * when present; `name === 'Epic'` is the fallback for a tenant/response shape
 * that omits it. Never throws — a missing/malformed `issuetype` reads as "not
 * an epic" rather than guessing.
 */
function issuetypeIsEpic(issuetype) {
  if (!issuetype || typeof issuetype !== 'object') return false
  const level = issuetype.hierarchyLevel
  if (level != null) return level === 1
  return issuetype.name === 'Epic'
}

/**
 * True when a Jira issue's `fields.parent` link points at an EPIC rather than
 * a native subtask's story/task parent. Jira's parent-link representation
 * nests `fields.issuetype` on `fields.parent` regardless of the requested
 * field list, so no extra field request is needed to read it here. Exported
 * for unit coverage (mirrors `jiraStatusCategoryToCanonical`).
 */
export function isEpicParent(parentField) {
  return issuetypeIsEpic(parentField?.fields?.issuetype)
}

/** `key`/`id` -> epic issue, for resolving a legacy Epic Link value (a bare issue key) to the epic it names, with no extra HTTP call when the epic is already part of the same batch (LIN-2011 Surface D). */
function buildEpicByKey(epics) {
  const map = new Map()
  for (const epic of epics) {
    if (epic.key) map.set(epic.key, epic)
    if (epic.id) map.set(epic.id, epic)
  }
  return map
}

/**
 * Normalizes a legacy "Epic Link" custom-field VALUE to a bare key/id string
 * for lookup against `epicByKey`/`getIssue` (LIN-2011 review L3). Real Jira
 * Cloud tenants store this as a bare string (an issue key like `'CMP-1'`, or
 * occasionally the numeric id as a string) — both pass through unchanged.
 * An object shape (`{key: 'CMP-1'}`) and a bare number have both been
 * observed on some legacy/company-managed exports; both are coerced to the
 * string the lookup expects. Anything else (or absent) is not a value this
 * field can meaningfully carry, and resolves to `null` — never throws, and
 * never a silent wrong-key lookup.
 */
function normalizeEpicLinkValue(value) {
  if (typeof value === 'string') return value || null
  if (typeof value === 'number') return String(value)
  if (value && typeof value === 'object' && typeof value.key === 'string') return value.key
  return null
}

/**
 * Jira's known custom-field schema type for the legacy company-managed
 * "Epic Link" field (pre-migration to native `parent`) — matched ALONGSIDE
 * the field's display name, since a tenant could rename the field but not
 * its schema type.
 */
const EPIC_LINK_FIELD_SCHEMA_CUSTOM = 'com.pyxis.greenhopper.jira:gh-epic-link'

// -----------------------------------------------------------------------------
// Tiered Jira fetch (LIN-2155) — replaces the single capped
// `project in (...) ORDER BY key ASC` walk, which returned the OLDEST
// DEFAULT_SEARCH_CAP issues (Jira keys are creation-sequence) and so could
// starve in-progress coverage on a large project. Every tier below is
// project-scoped (LIN-1885 beat 1 review finding #2 — bounds a dashboard
// render to the site's own projects) and ends `, key ASC`: Atlassian breaks a
// sort tie by internal docid, so a non-unique ORDER BY can duplicate/skip
// rows across `nextPageToken` pages.
// -----------------------------------------------------------------------------

// Plan-time tuning defaults (not scope questions — numeric budgets are
// adjustable without reopening LIN-2155's scope). Only the in-progress cap is
// a failure-level condition (see `_epicsForProjects`); the other three are
// ordinary per-tier truncation.
const IN_PROGRESS_SAFETY_CAP = 2000
const TODO_TIER_CAP = 200
const DONE_RECENT_CAP = 200
const EPIC_TIER_CAP = 500

/**
 * One tier's JQL: `project in (...) AND statusCategory = "<name>" [AND extra]
 * ORDER BY <orderBy>`. `statusCategoryName` is always read through
 * `CANONICAL_TYPE_TO_JIRA_STATUS_CATEGORY` by the caller — no Jira category
 * literal is written into this builder (LIN-2155 plan constraint).
 */
function tierJql(projectKeys, statusCategoryName, { extra, orderBy } = {}) {
  const keys = projectKeys.filter(Boolean)
  if (!keys.length) return null
  const list = keys.map(key => `"${key}"`).join(',')
  const clauses = [`project in (${list})`, `statusCategory = "${statusCategoryName}"`, extra].filter(Boolean)
  return `${clauses.join(' AND ')} ORDER BY ${orderBy || 'key ASC'}`
}

/** The epics tier's own JQL — `issuetype = Epic`, not a `statusCategory`, so it is built separately from `tierJql`. */
function epicsTierJql(projectKeys) {
  const keys = projectKeys.filter(Boolean)
  if (!keys.length) return null
  const list = keys.map(key => `"${key}"`).join(',')
  return `project in (${list}) AND issuetype = Epic ORDER BY key ASC`
}

/**
 * Thrown when the in-progress tier itself hits its safety cap (LIN-2155) —
 * treated as a failure-level condition, not ordinary truncation: the tier's
 * whole purpose is an unconditional guarantee, and a capped "guarantee" is
 * not one. Propagates out of `fetchProjects` unchanged, exactly like any
 * other in-progress-tier failure (D7 — fail whole, never silently partial).
 * Exported for unit coverage.
 */
export class JiraInProgressCapExceededError extends Error {
  constructor(jql, cap) {
    super(`Jira in-progress tier hit its ${cap}-issue safety cap (jql: ${jql}) — the in-progress guarantee cannot be honored`)
    this.name = 'JiraInProgressCapExceededError'
  }
}

/** Best-effort human org name from a Jira site URL, for the dashboard header. */
function orgNameFromSite(site) {
  if (!site) return 'Jira'
  try {
    return new URL(site).hostname.replace(/\.atlassian\.net$/, '') || 'Jira'
  } catch {
    return 'Jira'
  }
}

export class JiraProvider extends ProviderInterface {
  /**
   * @param {{ client?: object, clientFactory?: (credential: {email,apiToken,site}) => object, site?: string }} [opts]
   *   client        — boot-configured REST boundary (unit-test / single-tenant DI path).
   *   clientFactory — test/DI seam: builds the PER-REQUEST client from a Basic-auth
   *                   credential. Production leaves it unset, so `_clientForCredential`
   *                   mints a real createJiraClient; tests inject the fake.
   *   site          — default tenant base URL, used only by getCreateTaskUrl (the
   *                   "+ Add task" deep link) when no per-call scope is available —
   *                   mirrors GitHubProvider's single-default-repo limitation.
   */
  constructor({ client, clientFactory, site } = {}) {
    super()
    this.name = 'jira'
    this.client = client || null
    this.clientFactory = clientFactory || null
    this.site = site || null
  }

  /** Boot-time DI, mirroring LocalProvider.configure({ store }) / GitHubProvider.configure. */
  configure({ client, clientFactory, site } = {}) {
    if (client) this.client = client
    if (clientFactory) this.clientFactory = clientFactory
    if (site) this.site = site
    return this
  }

  _requireClient() {
    if (!this.client) {
      throw new Error('JiraProvider: client not configured (call configure({ client }) at boot)')
    }
    return this.client
  }

  /**
   * Resolve the REST client for a single read call. `scope` is one of the two
   * Jira credential shapes (both produced by `getWorkspaceCallScope` /
   * `getBindingCallScope`), or absent, falling back to the boot-configured
   * `client` (unit tests / DI):
   *
   *   - Basic (Phase 1, LIN-1885): `{ email, apiToken, site }`
   *   - OAuth 3LO (Phase 3, LIN-1887): `{ authType: 'oauth', accessToken, cloudId, site }`
   *
   * Discriminated on `authType`, so the Phase 1 shape — validated in production
   * on 2026-08-07 and still live — takes a byte-identical path.
   *
   * Both arms FAIL CLOSED and loudly on a missing field. That is load-bearing
   * beyond hygiene: `getWorkspaceCallScope` (LIN-1887 Step 6) now returns no
   * scope at all rather than guessing when a workspace has several Jira bindings
   * and the mirrored token matches none of them, and this throw is what turns
   * that refusal into a visible failure instead of a silent call against the
   * boot-configured default client.
   *
   * @param {{authType?: string, email?: string, apiToken?: string, accessToken?: string, cloudId?: string, site?: string}} [scope]
   * @returns {object}
   */
  _clientFor(scope) {
    if (scope && typeof scope === 'object') {
      if (scope.ambiguousCallScope) {
        throw new Error('JiraProvider: this workspace has several Jira bindings and the active one could not be identified — refusing to guess which site to call')
      }
      if (scope.authType === 'oauth') {
        const { accessToken, cloudId, site } = scope
        if (!accessToken || !cloudId) {
          throw new Error('JiraProvider: OAuth credential is missing accessToken/cloudId (cannot build a request-time client)')
        }
        return this._clientForCredential({ authType: 'oauth', accessToken, cloudId, site })
      }
      const { email, apiToken, site } = scope
      if (!apiToken || !site) {
        throw new Error('JiraProvider: credential is missing apiToken/site (cannot build a request-time client)')
      }
      return this._clientForCredential({ email, apiToken, site })
    }
    return this._requireClient()
  }

  /** Per-credential REST client — a real createJiraClient in production, the injected fake in tests. */
  _clientForCredential(credential) {
    return this.clientFactory ? this.clientFactory(credential) : createJiraClient(credential)
  }

  /** The tenant base URL for this call — the per-call scope's `site`, else the boot default. */
  _resolveSite(scope) {
    const site = (scope && typeof scope === 'object' ? scope.site : null) || this.site
    return site ? String(site).replace(/\/+$/, '') : null
  }

  // ---------------------------------------------------------------------------
  // Shape mapping: Jira REST issue/project → canonical shapes.
  // ---------------------------------------------------------------------------

  /**
   * `epicContext` (LIN-2011) is the epic-link resolution state a caller
   * gathered up front — never re-fetched here, so this stays synchronous and
   * side-effect-free like every other shape mapper in this file:
   *   - `epicLinkFieldId` — the discovered company-managed legacy "Epic Link"
   *     custom field id, or `null`/absent when none exists on this tenant
   *     (the common case).
   *   - `epicByKey` — a `key`/`id` -> epic issue map for resolving that
   *     field's value with no extra HTTP call (built from the same batch by
   *     `fetchProjects`, or a one-entry map a single-issue read resolved via
   *     one bounded `getIssue` call — see `_resolveLegacyEpicContext`).
   */
  _toCanonicalIssue(jira, site, { epicLinkFieldId, epicByKey } = {}) {
    const fields = jira.fields || {}
    const done = fields.status?.statusCategory?.key === 'done'

    // Epic vs. subtask parent routing (LIN-2011, LIN-2007 ruling: epic ->
    // canonical project). Three cases, in priority order:
    //   1. `fields.parent` is an EPIC (team-managed, or an already-migrated
    //      company-managed tenant) -> canonical `project`; `parent` stays
    //      null (an epic is not a subtask-parent).
    //   2. `fields.parent` is present but NOT an epic -> unchanged native
    //      one-level subtask mapping (Phase 1 behavior).
    //   3. `fields.parent` is absent -> fall back to the legacy
    //      company-managed "Epic Link" custom field, when one was
    //      discovered and is populated on this issue; otherwise no project.
    // Accepted limitation, deliberately not implemented this phase: a
    // subtask's own `project` is not back-filled from its parent STORY's
    // epic (that would need a second hop) — a subtask surfaces with no
    // project even when its parent story has one, matching Phase 1's
    // existing "children render nested, not independently grouped" pattern.
    let parent = null
    let project = null
    if (fields.parent && isEpicParent(fields.parent)) {
      project = { id: fields.parent.id, name: fields.parent.fields?.summary || null }
    } else if (fields.parent) {
      parent = { id: fields.parent.id, identifier: fields.parent.key }
    } else if (epicLinkFieldId) {
      const epicKey = normalizeEpicLinkValue(fields[epicLinkFieldId])
      const epic = epicKey ? epicByKey?.get(epicKey) : null
      if (epic) project = { id: epic.id, name: epic.fields?.summary || null }
    }

    return {
      source: SOURCE_JIRA, // provenance stamp (LIN-561)
      id: jira.id, // the immutable issue id is the opaque identity; `key` is human-readable only
      identifier: jira.key,
      title: fields.summary || '',
      description: adfToMarkdown(fields.description),
      estimate: null, // capability: estimates:false (story-point mapping, LIN-1888)
      priority: 0,
      sortOrder: 0,
      createdAt: fields.created || null,
      dueDate: fields.duedate || null,
      completedAt: done ? (fields.resolutiondate || null) : null,
      url: site && jira.key ? `${site}/browse/${jira.key}` : null,
      parent,
      project,
      // The issue's owning TEAM (LIN-2018) — a Jira project surfaced as a
      // canonical team, id = project key (falls back to the numeric project
      // id only if a key is somehow absent). MUST use the same precedence
      // `issueWriteGuard` below already uses (`project.key || project.id`) —
      // read and write have to agree on what a Jira "team id" is, or
      // `routes/task-edit.js`'s `loadStates(..., issue.team.id)` would ask
      // `states()` about a different scope than a PATCH would resolve
      // against. Without this stamp `teamId` was always null for Jira
      // (`lib/proxy-wire.js`'s flat mirror only fires when `team` is set).
      // NOTE: this is the native Jira PROJECT, unrelated to the epic-derived
      // canonical `project` above since LIN-2011 — the two are independent
      // hierarchy levels that happen to share Jira's own "project" word.
      team: fields.project ? { id: String(fields.project.key || fields.project.id), name: fields.project.name } : null,
      state: jiraStatusCategoryToCanonical(jira),
      assignee: fields.assignee ? { name: fields.assignee.displayName } : null,
      labels: { nodes: (fields.labels || []).map(name => ({ name })) },
      // No typed relations mapped this phase.
      relations: { nodes: [] },
    }
  }

  /**
   * `url` is the user-FACING "View in Jira →" link (`lib/render.js` renders
   * canonical `project.url` as the detail link), so it must be the browsable
   * project page — NOT `project.self`, which is the REST *resource* URL
   * (`.../rest/api/3/project/10000`, raw JSON) — that was LIN-1885 beat 2
   * review finding #4. Mirrors GitHub's `milestone.html_url` (a distinct
   * browsable link, not its REST `url`).
   */
  _toCanonicalProject(project, site) {
    return {
      id: project.id,
      name: project.name,
      content: null,
      url: site && project.key ? `${site}/browse/${project.key}` : null,
      sortOrder: 0,
    }
  }

  /**
   * An EPIC issue → the canonical PROJECT shape (LIN-2011, LIN-2007 ruling) —
   * mirrors `_toCanonicalProject`'s shape, sourced from an issue rather than a
   * Jira project object. `url` is the epic's own browsable issue page (an
   * epic has no separate "project page" the way a Jira project does).
   */
  _epicToCanonicalProject(epicIssue, site) {
    return {
      id: epicIssue.id,
      name: epicIssue.fields?.summary || null,
      content: null,
      url: site && epicIssue.key ? `${site}/browse/${epicIssue.key}` : null,
      sortOrder: 0,
    }
  }

  /**
   * The shared tiered-fetch walk behind `fetchProjects`/`fetchProjectsList`
   * (LIN-2011 Surface C; rebuilt for LIN-2155) — both need the SAME
   * project-scoped search to derive canonical `projects` from EPICS rather
   * than from Jira project objects, so the JQL construction, the legacy
   * field-id discovery, and the truncation read live here once rather than
   * duplicated per caller.
   *
   * LIN-2155: replaces the single capped `project in (...) ORDER BY key ASC`
   * walk (which kept the OLDEST `DEFAULT_SEARCH_CAP` issues — Jira keys are
   * creation-sequence — and so could return zero in-progress issues on a
   * large project) with four SEQUENTIAL status-scoped passes, run in
   * `jiraReachableTierOrder()`'s order (in-progress, to-do, done) plus a
   * separate epics pass. Sequential, not `Promise.all` — pagination already
   * runs serially against the shared per-tenant burst bucket (client.js),
   * and a parallel walk here is the same "one bad script" pattern.
   *
   * Partial-failure rule (D7, non-negotiable): if the in-progress pass fails
   * — either throws, or hits its own `IN_PROGRESS_SAFETY_CAP` — the render
   * fails whole; the guarantee is complete or absent, never silently
   * partial. If a LOWER tier throws after in-progress succeeded, this
   * renders whatever arrived from the other tiers and sets `truncated: true`
   * — a backlog/done/epics hiccup must not discard a good in-progress
   * result.
   *
   * `truncated` (LIN-2006) stays ONE boolean, OR-ed across every raw tier
   * array's own `.truncated` (read BEFORE any `.filter()`/`.map()` — those
   * return a fresh array and silently drop a custom array property, the
   * LIN-2033 hazard) plus a lower-tier hard failure.
   *
   * Merge/dedupe by issue id: tier overlap is real, not hypothetical — an
   * epic whose own status is in-progress matches both the in-progress tier
   * and the epics tier. Tier-priority order decides which copy survives; it
   * is byte-identical either way.
   *
   * LIN-2011 re-review finding F3: an issue's `fields.parent` can point at an
   * epic that is NOT itself part of this batch — a cross-project parent link
   * (a team-scoped read only walks one Jira project, but Jira permits a
   * parent in a different project) or a truncation-order mismatch.
   * `_toCanonicalIssue` still stamps that issue's canonical `project`
   * straight off `fields.parent`, but `fetchProjects`/`fetchProjectsList`
   * only turn `epics` into canonical `projects` — a project id with no
   * matching entry is silently dropped by `server.js`'s `projects.map(p =>
   * forest.get(p.id) ...)` walk. Below, any epic referenced by a merged
   * issue but absent from `epics` is synthesized into it from that same
   * dangling `fields.parent` reference — which already carries the exact
   * `{id, key, fields: {summary}}` shape `_epicToCanonicalProject` needs, so
   * this costs no extra HTTP call.
   * @returns {Promise<{issues: Array, epics: Array, truncated: boolean, epicLinkFieldId: string|null}>}
   */
  async _epicsForProjects(client, projects) {
    const keys = projects.map(p => p.key).filter(Boolean)
    if (!keys.length) return { issues: [], epics: [], truncated: false, epicLinkFieldId: null }

    const epicLinkFieldId = await this._resolveEpicLinkFieldId(client)
    const fields = [...JIRA_ISSUE_FIELDS, epicLinkFieldId].filter(Boolean)

    const [inProgressType, todoType, doneType] = jiraReachableTierOrder()
    const inProgressJql = tierJql(keys, CANONICAL_TYPE_TO_JIRA_STATUS_CATEGORY[inProgressType], { orderBy: 'key ASC' })

    // In-progress: let a throw propagate — the guarantee is complete or
    // absent, never silently partial (D7).
    const inProgress = await client.searchAllIssues(inProgressJql, { fields, cap: IN_PROGRESS_SAFETY_CAP })
    if (inProgress.truncated) {
      // Hitting the safety cap means the in-progress guarantee itself broke
      // — an error-level condition (LIN-2155 scope), handled identically to
      // a thrown in-progress failure under D7.
      throw new JiraInProgressCapExceededError(inProgressJql, IN_PROGRESS_SAFETY_CAP)
    }

    const lowerTiers = [
      {
        name: 'to-do',
        jql: tierJql(keys, CANONICAL_TYPE_TO_JIRA_STATUS_CATEGORY[todoType], { orderBy: 'updated DESC, key ASC' }),
        cap: TODO_TIER_CAP,
      },
      {
        name: 'done',
        jql: tierJql(keys, CANONICAL_TYPE_TO_JIRA_STATUS_CATEGORY[doneType], { orderBy: 'updated DESC, key ASC' }),
        cap: DONE_RECENT_CAP,
      },
      { name: 'epics', jql: epicsTierJql(keys), cap: EPIC_TIER_CAP },
    ]

    let lowerTierFailed = false
    const lowerResults = []
    for (const tier of lowerTiers) {
      // Serial — shared per-tenant burst bucket (client.js), same discipline
      // as pagination itself.
      try {
        lowerResults.push(await client.searchAllIssues(tier.jql, { fields, cap: tier.cap }))
      } catch (err) {
        console.warn(`Jira tiered fetch: ${tier.name} pass failed, rendering partial (${err.message})`)
        lowerTierFailed = true
        lowerResults.push([])
      }
    }

    const rawTiers = [inProgress, ...lowerResults]
    const truncated = rawTiers.some(t => !!t.truncated) || lowerTierFailed

    const seen = new Set()
    const merged = []
    for (const tier of rawTiers) {
      for (const issue of tier) {
        if (seen.has(issue.id)) continue
        seen.add(issue.id)
        merged.push(issue)
      }
    }

    const epics = merged.filter(i => issuetypeIsEpic(i.fields?.issuetype))
    const epicIds = new Set(epics.map(e => e.id))
    for (const issue of merged) {
      const parent = issue.fields?.parent
      if (parent && isEpicParent(parent) && !epicIds.has(parent.id)) {
        epicIds.add(parent.id)
        epics.push(parent)
      }
    }
    return { issues: merged, epics, truncated, epicLinkFieldId }
  }

  /**
   * Company-managed legacy "Epic Link" custom-field discovery (LIN-2011
   * Surface D). Team-managed tenants — and an already-migrated
   * company-managed tenant — carry the epic link natively in `fields.parent`
   * (`isEpicParent` above) and never need this; resolving to `null` here is
   * the EXPECTED common case, not an error. Per-call only (mirrors
   * `_clientFor(scope)`'s per-request construction) — no cross-request cache.
   */
  async _resolveEpicLinkFieldId(client) {
    const allFields = await client.listFields()
    const match = (allFields || []).find(
      f => f?.name === 'Epic Link' || f?.schema?.custom === EPIC_LINK_FIELD_SCHEMA_CUSTOM,
    )
    return match?.id || null
  }

  /**
   * The one-off legacy-epic resolution for a SINGLE-issue read (`fetchIssueFields`)
   * — bounded to at most one extra `getIssue` call, and only reached when the
   * issue genuinely needs it: no native `fields.parent` (LIN-2011 Surface D's
   * "single-issue title resolution"). A batch read (`fetchProjects`) never
   * calls this — it resolves the same case for free from the batch it already
   * fetched (`buildEpicByKey`).
   * @returns {Promise<{epicLinkFieldId?: string|null, epicByKey?: Map}>}
   */
  async _resolveLegacyEpicContext(client, jira) {
    if (jira.fields?.parent) return {}
    const epicLinkFieldId = await this._resolveEpicLinkFieldId(client)
    if (!epicLinkFieldId) return { epicLinkFieldId: null }
    const epicKey = normalizeEpicLinkValue(jira.fields?.[epicLinkFieldId])
    if (!epicKey) return { epicLinkFieldId }
    const epic = await client.getIssue(epicKey)
    if (!epic) return { epicLinkFieldId }
    return { epicLinkFieldId, epicByKey: buildEpicByKey([epic]) }
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  /**
   * Projects + issues for the dashboard, mirroring the GitHub/Local
   * `fetchProjects` shape. `scope` is the per-request Basic-auth credential.
   * Issues are fetched with a JQL scoped to the relevant project(s) (LIN-1885
   * beat 1 review finding #2) — projects must resolve first, so this is
   * sequential rather than the prior Promise.all; an unfiltered `ORDER BY key
   * ASC` is both unbounded (a full-tenant page walk) and, since the beat 1
   * migration to `/search/jql`, rejected outright (`400`) as a filterless
   * query. No projects → no scoped JQL to run, so issues short-circuits to [].
   *
   * `teamId` (LIN-2018) scopes the walk to ONE project — a Jira team id is a
   * project key. When present this reads STRICTLY LESS than the unscoped
   * path: one `getProject` instead of the full `listAllProjects` walk, then
   * each tier's JQL narrows to that single project (`project in ("KEY")`,
   * functionally `project = "KEY"` — `tierJql` builds this form and the fake
   * client's `matchJql` discriminates it). `truncated` (LIN-2006, LIN-2155)
   * is preserved on BOTH branches — OR-ed across every tier's raw array
   * before any `.map()`, same discipline on the unscoped path; a
   * single-project walk cannot itself be truncated at the project level
   * (there is only one).
   *
   * `projects` (LIN-2011) are derived from the EPICS found in this same
   * issues batch, not from the Jira project objects above — those still
   * scope the JQL and stamp canonical `team`, but no longer feed canonical
   * `project`. A Jira project that has no epic among its issues therefore
   * contributes no canonical project (an intentional consequence of the
   * epic-derivation redesign, not a bug).
   *
   * An epic itself is EXCLUDED from canonical `issues` (LIN-2011 review
   * finding F1) — it already surfaces as a canonical `project` above, and no
   * other provider ever renders a project as an issue too. Without this, an
   * epic (whose own `project` is null — an epic has no epic parent) fell
   * into `buildForest`'s "No Project" group and rendered twice: once as its
   * project header, once as an ungrouped row.
   * @returns {Promise<{organizationName, projects, issues, truncated}>}
   */
  async fetchProjects(scope, teamId = null, _opts = {}) {
    const client = this._clientFor(scope)
    const site = this._resolveSite(scope)
    const projects = teamId ? [await client.getProject(teamId)] : await client.listAllProjects()
    const { issues, epics, truncated, epicLinkFieldId } = await this._epicsForProjects(client, projects)
    const epicByKey = buildEpicByKey(epics)
    return {
      organizationName: orgNameFromSite(site),
      projects: epics.map(e => this._epicToCanonicalProject(e, site)),
      issues: issues
        .filter(i => !issuetypeIsEpic(i.fields?.issuetype))
        .map(i => this._toCanonicalIssue(i, site, { epicLinkFieldId, epicByKey })),
      truncated,
    }
  }

  /**
   * A Jira project surfaces as a canonical TEAM, id = project key (LIN-2018,
   * Option 2 of the LIN-2007 ruling) — `resolveTeamRef`
   * (`lib/proxy-ref-resolver.js`) already expects exactly this `{id, name,
   * key}` shape. Reuses `listAllProjects()` unchanged, so its existing
   * 500-project cap + `.truncated` console.warn (LIN-1885 re-review finding
   * #6) apply here too — nothing here widens or drops that cap.
   *
   * Independent of the canonical PROJECT level (LIN-2011 re-pointed that at
   * epics — see `fetchProjects`/`_epicToCanonicalProject`): a Jira project's
   * own numeric id is no longer surfaced as a canonical project anywhere, but
   * it keeps being the canonical TEAM id here, unaffected.
   *
   * `truncated` (LIN-2033 F1) is read off the raw `projects` array BEFORE
   * `.map()` — `listAllProjects()` stamps it as a custom property on the
   * array, which `.map()`'s fresh array would otherwise silently drop, the
   * same hazard `fetchProjects`/`_epicsForProjects` already guard against.
   * It is re-stamped on the RETURNED array for the same reason: `fetchTeams`
   * is a shared provider-interface method every other implementation returns
   * a plain array from, and every caller (`matchTeamId`/`requireTeamMembership`,
   * `resolveTeamRef`, `task-create.js`'s option-list loader, …) treats the
   * result as a bare array — switching Jira alone to `{teams, truncated}`
   * would break every one of them. Stamping preserves that contract while
   * still letting a caller that cares (`GET /api/proxy/teams`) read the flag
   * off the array it already has, exactly like `listAllProjects()` itself.
   * Surfacing it there is what lets a >500-project truncation be told apart
   * from a genuine non-match instead of `requireTeamMembership` reporting it
   * as "no team matches" (LIN-2006's failure class, reappearing here).
   */
  async fetchTeams(scope) {
    const client = this._clientFor(scope)
    const projects = await client.listAllProjects()
    const truncated = !!projects.truncated
    const teams = projects.map(p => ({ id: p.key, name: p.name, key: p.key }))
    teams.truncated = truncated
    return teams
  }

  /**
   * A single Jira issue → the same canonical render shape fetchProjects emits
   * per node (mirrors GitHubProvider.fetchIssueFields). Backs the dashboard's
   * lazy per-issue detail load (LIN-442) — without this, expanding an issue
   * row 404s/silently fails to load its description/comments toggle even
   * though the row itself rendered fine from fetchProjects' bulk read.
   *
   * `getIssue` passes no `fields` param, so it already receives Jira's full
   * default field set (including any custom field) — the epic-vs-subtask
   * routing in `_toCanonicalIssue` needs no extra field request here, only
   * the one-off legacy-epic-link resolution `_resolveLegacyEpicContext`
   * performs when this issue has no native `fields.parent` (LIN-2011).
   */
  async fetchIssueFields(scope, issueId) {
    const client = this._clientFor(scope)
    const site = this._resolveSite(scope)
    const jira = await client.getIssue(issueId)
    if (!jira) throw new Error(`Issue not found: ${issueId}`)
    const epicContext = await this._resolveLegacyEpicContext(client, jira)
    return this._toCanonicalIssue(jira, site, epicContext)
  }

  /**
   * Single-issue context for the detail/recommendation surfaces. Children are
   * Jira's native one-level subtasks (`parent = "<key>"`), fetched best-effort;
   * siblings/cousins stay empty this phase (no team/cross-project traversal).
   *
   * The top-level `parent`/`project` fields on the returned context are the
   * pre-existing bespoke display metadata (unaffected by LIN-2011: `parent`
   * degrades to null when that parent is an epic, matching `_toCanonicalIssue`'s
   * "an epic is not a subtask-parent" rule so the two surfaces cannot
   * disagree; `project` stays the native Jira project name, a distinct field
   * from the epic-derived canonical `project` level). `children` DOES route
   * through `_toCanonicalIssue`, so a child parented directly to an epic
   * reports that epic as its own canonical `project`.
   *
   * No legacy "Epic Link" resolution here (LIN-2011 review finding F2): this
   * used to call `_resolveEpicLinkFieldId` unconditionally, but never passed
   * the `epicByKey` map `_toCanonicalIssue`'s legacy branch also needs, so
   * the resolved field id could never actually resolve anything — a dead
   * branch that still paid for a `listFields()` round trip on every detail
   * read. It is also unreachable in principle: `children` here are native
   * one-level subtasks (`parent = "<key>"`), which cannot carry a legacy
   * Epic Link value.
   */
  async fetchIssueContext(scope, issueId) {
    const client = this._clientFor(scope)
    const site = this._resolveSite(scope)
    const jira = await client.getIssue(issueId)
    if (!jira) throw new Error(`Issue not found: ${issueId}`)
    const fields = jira.fields || {}
    const children = jira.key
      ? await client.searchAllIssues(`parent = "${jira.key}" ORDER BY key ASC`, { fields: JIRA_ISSUE_FIELDS })
      : []
    return {
      issue: {
        id: jira.id,
        identifier: jira.key,
        title: fields.summary || '',
        description: adfToMarkdown(fields.description),
        url: site && jira.key ? `${site}/browse/${jira.key}` : null,
        state: jiraStatusCategoryToCanonical(jira),
        labels: fields.labels || [],
      },
      parent: fields.parent && !isEpicParent(fields.parent)
        ? { id: fields.parent.id, identifier: fields.parent.key, title: null }
        : null,
      siblings: [],
      siblingsTotal: 0,
      parentChildCount: null,
      cousins: [],
      cousinsTotal: 0,
      project: fields.project ? { name: fields.project.name, description: null } : null,
      children: children.map(c => this._toCanonicalIssue(c, site)),
      // Pass `scope` (not the resolved client) so the nested read rebuilds its
      // own request-time client from the credential, mirroring GitHub's pattern.
      comments: await this.fetchIssueComments(scope, issueId),
    }
  }

  /**
   * Recommendation/recap/brief/task-chat context (LIN-1910). Mirrors
   * `localProvider.fetchRecommendationContext` (`lib/providers/local/index.js:292`):
   * a leaf returns its context as-is; a parent gets a `focusedChild` — the
   * subtask the recommender should descend into, chosen by the shared
   * deterministic `selectFocusSubtask` picker. `signal` is accepted but not
   * threaded into the Jira HTTP client — `createJiraClient`/`client.getIssue`
   * have no abort-signal plumbing today, matching `local`'s "accept, don't
   * honor" precedent rather than leaving the option silently dropped.
   */
  async fetchRecommendationContext(scope, issueId, { noDescend = false } = {}) {
    const context = await this.fetchIssueContext(scope, issueId)

    // Leaf task, or caller wants the parent's own work: frame as a leaf with
    // no focusedChild / defer pointer.
    if (noDescend || !context.children?.length) return context

    const focusChild = selectFocusSubtask(context.children)
    if (!focusChild) return context // all children terminal

    return { ...context, focusedChild: await this.fetchIssueContext(scope, focusChild.id) }
  }

  /** Comments for an issue, oldest-first. Implementing this sets ui.comments=true. */
  async fetchIssueComments(scope, issueId) {
    const client = this._clientFor(scope)
    const comments = await client.listAllComments(issueId)
    return comments
      .map(c => ({
        id: String(c.id),
        body: adfToMarkdown(c.body),
        createdAt: c.created,
        user: c.author?.displayName || 'jira',
      }))
      .sort((a, b) => (new Date(a.createdAt).getTime() || 0) - (new Date(b.createdAt).getTime() || 0))
  }

  /**
   * Lightweight project list (no issues) — reuses `fetchProjects`'s
   * epic-derivation (`_epicsForProjects`) rather than mapping
   * `listAllProjects()` directly (LIN-2011): epics are issues, not projects,
   * so this needs its own JQL-scoped issues walk to find them.
   */
  async fetchProjectsList(scope) {
    const client = this._clientFor(scope)
    const site = this._resolveSite(scope)
    const projects = await client.listAllProjects()
    const { epics } = await this._epicsForProjects(client, projects)
    return epics.map(e => this._epicToCanonicalProject(e, site))
  }

  /**
   * The project's REAL per-project workflow statuses (LIN-2018) — replaces
   * the earlier fixed synthetic 3-entry vocabulary (LIN-1886 D2(a)). `teamId`
   * is a Jira project key/id: `GET /rest/api/3/project/{key}/statuses`
   * returns one entry per ISSUE TYPE, each carrying its own `statuses[]`, so
   * this flattens across issue types and DEDUPES BY STATUS ID (never by
   * name — a project with Task/Bug/Story issue types repeats "To Do" once
   * per type). The endpoint carries no ordering, so `position` is
   * synthesized from first-appearance index across the flatten.
   *
   * No `teamId` → degrades to `[]`, not a throw: `routes/task-edit.js` and
   * `routes/task-create.js` both try/catch `states()` to `[]` and fall back
   * to a text input, and states are inherently per-project here (unlike the
   * old team-free synthetic vocabulary) — there is no team-less answer to
   * give.
   * @returns {Promise<Array<{id, name, type, position}>>}
   */
  async states(scope, teamId = null) {
    if (!teamId) return []
    const client = this._clientFor(scope)
    const issueTypes = await client.getProjectStatuses(teamId)
    const byId = new Map()
    for (const issueType of issueTypes || []) {
      for (const status of issueType?.statuses || []) {
        if (status?.id == null) continue
        const id = String(status.id)
        if (byId.has(id)) continue
        byId.set(id, {
          id,
          name: status.name || 'Unknown',
          type: statusCategoryKeyToType(status.statusCategory?.key),
          position: byId.size,
        })
      }
    }
    return [...byId.values()]
  }

  /**
   * Distinct labels on the site — Jira labels are real, global (not
   * per-project), read via `GET /rest/api/3/label`. Shape mirrors GitHub's
   * `labels()` (`{ id: name, name }`, id = name) so `resolveLabelInput`
   * (routes/proxy.js) and `issueLabels`/`updateIssueLabels` below compare like
   * with like.
   */
  async labels(scope) {
    const client = this._clientFor(scope)
    const names = await client.listAllLabels()
    return names.map(name => ({ id: name, name }))
  }

  // ---------------------------------------------------------------------------
  // Route-internal reads (LIN-1886) — the write routes call these
  // UNCONDITIONALLY before mutating. Deliberately OFF the declared
  // PROVIDER_SURFACE (route-internal data-fetch, not a capability), mirroring
  // `lib/providers/github/index.js:775-847`'s issueWriteGuard/issueDescription/
  // issueLabels/updateIssueLabels — `supports()` stays false for all four; the
  // routes gate on method EXISTENCE (`denyIfMissingRead`) instead.
  // ---------------------------------------------------------------------------

  /**
   * Trashed probe + team scope (`{ id, trashed, team }` or null). Jira has no
   * soft-delete, so `trashed` is always false. `team.id` MUST be non-null: the
   * routes pass it to `resolveStateInput` to scope a symbolic `stateId`
   * (`states()` ignores it, but a null team.id 422s "the issue's team could not
   * be determined" before `states()` is ever consulted) — the issue's own
   * project key is a stable, always-present placeholder, mirroring GitHub's
   * `team: { id: repo || 'github' }`.
   * @returns {Promise<Object|null>}
   */
  async issueWriteGuard(scope, issueId) {
    const client = this._clientFor(scope)
    const jira = await client.getIssue(issueId)
    if (!jira) return null
    const teamId = jira.fields?.project?.key || jira.fields?.project?.id || 'jira'
    return { id: jira.id, trashed: false, team: { id: String(teamId) } }
  }

  /**
   * The issue's description as MARKDOWN (`{ id, description, trashed }` or
   * null) — a plain string, matching every other provider's `issueDescription`
   * (`github/index.js`'s `gh.body ?? ''`, `local/index.js`, `linear/index.js`).
   *
   * The string is the CONTRACT, not an incidental convenience: `routes/proxy.js`'s
   * shared `applyDescriptionEdit` is a markdown-string read-modify-write over
   * this field (`merge(issue.description || '')` → `appendBlock`/`replace` in
   * `lib/description-edit.js`, both of which `String(...)` their input). Handed
   * the raw ADF object, that splice stringified it to `"[object Object]"`, so
   * `.../description/append` DESTROYED the stored body and
   * `.../description/replace` could never match — LIN-1886's review Blocker 1.
   *
   * Nothing needs the unconverted wire shape here: `updateIssue`'s D1 refusal
   * check reads the CURRENT stored ADF independently, off its own
   * `client.getIssue(issueId)` call, and never consults this method. So the
   * append/replace lane round-trips ADF→markdown→splice→`markdownToAdf`, while
   * an issue whose stored ADF carries unrenderable content is still refused
   * (422, no write) by that same D1 guard on the way back through `updateIssue`.
   * @returns {Promise<Object|null>}
   */
  async issueDescription(scope, issueId) {
    const client = this._clientFor(scope)
    const jira = await client.getIssue(issueId)
    if (!jira) return null
    return { id: jira.id, description: adfToMarkdown(jira.fields?.description), trashed: false }
  }

  /**
   * Current label set + trashed flag (`{ id, trashed, labels: { nodes } }` or
   * null) for the label add/remove read-modify-write. Jira labels are
   * name-keyed (like GitHub's), so each node is `{ id: name, name }`.
   * @returns {Promise<Object|null>}
   */
  async issueLabels(scope, issueId) {
    const client = this._clientFor(scope)
    const jira = await client.getIssue(issueId)
    if (!jira) return null
    return {
      id: jira.id,
      trashed: false,
      labels: { nodes: (jira.fields?.labels || []).map(name => ({ id: name, name })) },
    }
  }

  /**
   * Write a full label set onto an issue (the write half of the label RMW).
   *
   * Diffed against the CURRENT set and emitted as ONE atomic Jira
   * `PUT /issue/{id}` with `update: { labels: [{add}, {remove}, ...] }` — Jira
   * supports this natively (unlike GitHub's per-label REST endpoints), so no
   * per-label round trip is needed. Re-reads and returns the canonical issue
   * (mirrors GitHub's `updateIssueLabels` return shape: `{ success, issue }`,
   * which `routes/proxy.js` echoes through `writeRejected` + `flattenIssue`).
   * @returns {Promise<{success: boolean, issue: Object|null}>}
   */
  async updateIssueLabels(scope, issueId, labelIds) {
    const client = this._clientFor(scope)
    const site = this._resolveSite(scope)
    const jira = await client.getIssue(issueId)
    if (!jira) return { success: false, issue: null }
    const current = jira.fields?.labels || []
    const desired = (labelIds || []).map(id => String(id))
    const toAdd = desired.filter(name => !current.includes(name))
    const toRemove = current.filter(name => !desired.includes(name))
    if (toAdd.length || toRemove.length) {
      await client.updateIssue(issueId, {
        update: { labels: [...toAdd.map(name => ({ add: name })), ...toRemove.map(name => ({ remove: name }))] },
      })
    }
    const fresh = await client.getIssue(issueId)
    if (!fresh) return { success: false, issue: null }
    return { success: true, issue: this._toCanonicalIssue(fresh, site) }
  }

  // ---------------------------------------------------------------------------
  // Writes (LIN-1886)
  // ---------------------------------------------------------------------------

  /**
   * Update an issue: title/description (D1-guarded), status transition
   * (D2), with `priority` silently excluded (D3) and `projectId`/top-level
   * `parentId` refused (D4). ALWAYS re-reads after any write and returns the
   * canonical mapped issue — never trusts the write response body, since a
   * 204 (title/description PUT) or the transition POST's body is not the full
   * issue shape `_toCanonicalIssue` needs (L4 finding).
   *
   * EVERY refusable check runs before the FIRST write (LIN-1886 review N1) —
   * D4's field refusals, D1's unrenderable-description guard, and the whole of
   * D2's transition resolution. A patch this method refuses therefore leaves
   * the issue untouched; a partially-applied "not updated" is not a state a
   * caller can be handed.
   * @returns {Promise<Object|null>} updated issue (canonical), or null if missing.
   */
  async updateIssue(scope, issueId, patch = {}) {
    const client = this._clientFor(scope)
    const site = this._resolveSite(scope)

    // D4 policy: refuse (422) any patch field this provider cannot genuinely
    // honor, before any read or write is attempted.
    if (patch.projectId) {
      throw new RefResolutionError(
        'Jira does not support moving an issue between projects through this integration yet',
        { status: 422 },
      )
    }
    if (patch.parentId === null) {
      throw new RefResolutionError(
        'Jira does not support promoting an issue to top-level through this integration yet',
        { status: 422 },
      )
    }

    const current = await client.getIssue(issueId)
    if (!current) return null

    // D3: patch.priority is intentionally never read here — silently excluded
    // from the Jira PUT body (mirrors ui.priority: false hiding the control).
    const fields = {}
    if (patch.title != null) fields.summary = patch.title
    if (patch.description !== undefined) {
      // D1: refuse loudly rather than silently destroy Jira-native content this
      // integration cannot round-trip losslessly.
      //
      // The message is the ENTIRE UX of this refusal, so it names the causes
      // that actually fire (LIN-1886 review F3 — it used to say only "a table,
      // attachment, panel, unsupported text formatting", written before
      // `641c7f01` widened the trigger set to mentions, emoji, smart links and
      // the structural rules, and a mention is the most common trigger of all).
      // Keep it in step with `adfHasUnrenderableContent`'s rule list; ordinary
      // Markdown-looking prose is deliberately absent because fix cycle 3
      // escapes it rather than refusing it.
      if (adfHasUnrenderableContent(current.fields?.description)) {
        throw new RefResolutionError(
          "Cannot overwrite this issue's description: it contains Jira content this integration "
          + 'cannot round-trip losslessly — an @-mention, emoji, smart link, table, attachment or '
          + 'panel; a nested list, a multi-paragraph quote, or a code block containing a blank '
          + 'line; text carrying two formatting marks at once; or a numbered list that does not '
          + 'start at 1. Edit the description in Jira instead',
          { status: 422 },
        )
      }
      fields.description = markdownToAdf(patch.description)
    }

    // D2 (LIN-2018 root fix): RESOLVE the status-transition intent completely
    // — every branch that can refuse (no matching transition, a
    // screen-required transition) runs HERE, before the first write is
    // issued. A refusal must leave the issue exactly as it was; issuing the
    // field PUT first meant a refused transition still renamed the issue
    // while telling the caller nothing was updated (LIN-1886 review N1).
    //
    // `patch.stateId` is matched EXACTLY against the issue's current real
    // status id and, on a mismatch, against each candidate transition's
    // `to.id` — never by statusCategory first-match. That was LIN-1941's
    // hazard: a `done`-category target could land on whichever done-category
    // transition happened to sort first ("Won't Do" ahead of "Done"). With
    // `states()` now exposing the project's real per-status ids (LIN-2018),
    // an exact id is always available to match against, so the ambiguity
    // cannot arise here — a `stateId` this integration cannot match against
    // the current status or any transition (a stale id, a legacy synthetic
    // alias) refuses loudly (422) rather than guessing.
    //
    // Skip-on-unchanged is unchanged in spirit: when the requested id already
    // equals the issue's current status id, no getTransitions/doTransition
    // call is made at all.
    let transitionId = null
    if (patch.stateId != null) {
      const targetStatusId = String(patch.stateId)
      const currentStatusId = current.fields?.status?.id != null ? String(current.fields.status.id) : null
      if (targetStatusId !== currentStatusId) {
        const { transitions } = await client.getTransitions(issueId)
        const match = (transitions || []).find(t => t.to?.id != null && String(t.to.id) === targetStatusId)
        if (!match) {
          throw new RefResolutionError(
            `No available Jira transition moves this issue to status '${targetStatusId}' from its current status`,
            { status: 422 },
          )
        }
        if (match.hasScreen) {
          throw new RefResolutionError(
            `Jira transition '${match.name}' requires a screen (additional required fields) this integration cannot drive`,
            { status: 422 },
          )
        }
        transitionId = match.id
      }
    }

    // --- Writes only past this point; nothing below can refuse. --------------
    // LIN-2012: Jira offers no multi-write transaction, so a failure between
    // the field PUT and the status transition (or in the confirmation
    // re-read below) can leave the issue PARTIALLY updated. `applied` names
    // what already landed, in the REQUEST's own vocabulary (title/
    // description/stateId — matching the PATCH body), so a caller can diff
    // it directly against what it sent. `applied.length === 0` is what keeps
    // a genuine total failure (nothing landed) on its unchanged plain-throw
    // path — it must never be reclassified as a partial write it isn't.
    let didWrite = false
    const applied = []
    try {
      if (Object.keys(fields).length > 0) {
        await client.updateIssue(issueId, { fields })
        if (patch.title != null) applied.push('title')
        if (patch.description !== undefined) applied.push('description')
        didWrite = true
      }
      if (transitionId != null) {
        await client.doTransition(issueId, transitionId)
        applied.push('stateId')
        didWrite = true
      }
    } catch (err) {
      if (applied.length === 0) throw err // nothing landed — ordinary total failure, unchanged behavior
      const failed = applied.includes('stateId') ? 're-read-unreachable' : 'stateId'
      console.warn(`Jira updateIssue: partial write — ${applied.join('/')} landed, ${failed} failed (issue ${issueId}): ${err.message}`)
      throw new PartialWriteError(
        `Jira update partially applied: ${applied.join('/')} landed, ${failed} `
        + 'failed — retrying is safe (both writes are idempotent)',
        { applied: [...applied], failed, status: err.status, cause: err },
      )
    }

    let fresh
    try {
      fresh = didWrite ? await client.getIssue(issueId) : current
    } catch (err) {
      console.warn(`Jira updateIssue: partial write — ${applied.join('/')} landed, re-read failed (issue ${issueId}): ${err.message}`)
      throw new PartialWriteError(
        `Jira update landed (${applied.join('/')}) but the confirmation `
        + 're-read failed — retrying is safe',
        { applied: [...applied], failed: 're-read', status: err.status, cause: err },
      )
    }
    if (!fresh) return null
    return this._toCanonicalIssue(fresh, site)
  }

  /**
   * Create a comment from Markdown, converting to ADF on the way in. Jira's
   * comment-create response returns the full comment object (unlike the
   * sparse 204 an issue PUT returns), so this trusts the response directly
   * rather than re-reading.
   * @returns {Promise<Object>} the created comment (canonical shape, matching
   *   `fetchIssueComments`'s per-comment shape).
   */
  async createComment(scope, issueId, body) {
    const client = this._clientFor(scope)
    const adf = markdownToAdf(body)
    const created = await client.createComment(issueId, { body: adf })
    if (!created) throw new Error(`Issue not found: ${issueId}`)
    return {
      id: String(created.id),
      body: adfToMarkdown(created.body),
      createdAt: created.created,
      user: created.author?.displayName || 'jira',
    }
  }

  /** Thin single-label wrapper over `updateIssueLabels` (capability-gate completeness only — no production call site; the routes read-modify-write via `updateIssueLabels` directly). */
  async addLabel(scope, issueId, label) {
    const current = await this.issueLabels(scope, issueId)
    if (!current) return false
    const names = (current.labels?.nodes || []).map(n => n.name)
    if (names.includes(label)) return true
    const result = await this.updateIssueLabels(scope, issueId, [...names, label])
    return !!result.success
  }

  /** Thin single-label wrapper over `updateIssueLabels` (see addLabel). */
  async removeLabel(scope, issueId, label) {
    const current = await this.issueLabels(scope, issueId)
    if (!current) return false
    const names = (current.labels?.nodes || []).map(n => n.name)
    const result = await this.updateIssueLabels(scope, issueId, names.filter(n => n !== label))
    return !!result.success
  }

  // ---------------------------------------------------------------------------
  // URLs / UI capability surface
  // ---------------------------------------------------------------------------

  /**
   * Jira's "create issue" deep link (the global create dialog). Overriding
   * this is what makes `ui.write` true (render gates "+ Add task" on it) —
   * this is an EXTERNAL link, not an in-app write; createIssue/updateIssue
   * stay unimplemented this phase. Uses the boot-configured default `site`
   * (single-tenant limitation, mirrors GitHubProvider.getCreateTaskUrl's
   * single-default-repo note).
   *
   * LIN-2011 re-review finding F4: `projectId` is `render.js`'s generic
   * `project.id` — since LIN-2011 that is the canonical (epic-derived)
   * project id, an EPIC ISSUE id, not a Jira project id. Jira allocates
   * project ids and issue ids from the same numeric entity space, so
   * threading it into `pid=` was a measured regression: at best a dead
   * link, at worst the create dialog opening against an unrelated project
   * that happens to hold that id. `render.js`'s call site
   * (`getCreateTaskUrl(urlKey, project.id)`) is shared, provider-neutral,
   * and pinned byte-identical across every provider (LIN-1973 review F2) —
   * rather than thread a second, Jira-only id through it, `projectId` is
   * ignored here and the link always opens Jira's un-scoped create dialog:
   * a real, safe affordance, not a shortcut to a wrong project.
   */
  getCreateTaskUrl(_urlKey, _projectId) {
    if (!this.site) return 'https://www.atlassian.com/software/jira'
    const base = String(this.site).replace(/\/+$/, '')
    return `${base}/secure/CreateIssue!default.jspa`
  }

  /**
   * `write`/`comments`/`inlineCreate`/`inlineEdit` all auto-derive from the base
   * getter (getCreateTaskUrl override + fetchIssueComments/createComment
   * implemented + createIssue still NOT implemented (LIN-1557), updateIssue NOW
   * implemented (LIN-1886) → inlineEdit flips true, inlineCreate stays false).
   * Override only the abstract flags Jira's own schema decides: subtasks (native
   * one-level parent/child, best-effort mapped), estimates (no story-point field
   * this phase — LIN-1888), priority (LIN-1886 D3: priority is hardcoded 0/
   * unmapped in `_toCanonicalIssue`, so the in-app edit form hides the control
   * rather than lying about it), plus displayName (LIN-1885 research: `server.js`'s
   * bound-binding row reads `ui.displayName` — without this override a bound
   * Jira workspace would render lowercase `jira`. Settings' add-row displayName
   * used to be a SEPARATE static source (`KNOWN_ADD_PROVIDERS`'s own `displayName`
   * field) that could drift from this one; LIN-2010 deleted that list, so the
   * add-row now reads this same `ui.displayName` too — the divergence this
   * comment used to warn about no longer exists).
   */
  get ui() {
    return { ...super.ui, estimates: false, subtasks: true, priority: false, displayName: 'Jira' }
  }

  // ---------------------------------------------------------------------------
  // Identity (LIN-2010)
  // ---------------------------------------------------------------------------

  get landingCatalogue() {
    // LIN-2010: placeholder blurb, unconfirmed with product — no existing
    // string to migrate (raised with John, no reply yet); confirm before merge.
    return { blurb: 'Atlassian sites, token or OAuth', order: 3 }
  }

  /**
   * No row-level `configPredicate` — the row stays unconditional (Basic auth
   * needs no server config). The gate lives on the OAuth *shape* via its
   * existing `requiresConfig: 'jiraOAuth'`, an independent mechanism from the
   * row-level gate `github`/`github-projects` use (F1).
   */
  get addProvider() {
    return {
      blockedBy: null,
      authShapes: [
        { value: 'basic', label: 'API token' },
        { value: 'oauth', label: 'OAuth', requiresConfig: 'jiraOAuth' },
      ],
    }
  }

  get entryCta() {
    return { href: '/auth/jira/oauth?mode=new', isConfigured: isJiraOAuthConfigured }
  }

  /**
   * LIN-2010 Phase 2: Jira has no App-installation layer — an OAuth grant's
   * accessible-resources call yields sites directly (see `fetchJiraAccessibleResources`),
   * so the connection unit and the scope unit are the same granularity: a site.
   */
  get connectionUnit() {
    return 'site'
  }

  /** LIN-2010 Phase 2: a scope is one Atlassian site. */
  get scopeType() {
    return 'site'
  }

  /**
   * LIN-2010 Phase 2 — thin delegation to {@link fetchJiraAccessibleResources},
   * verbatim output, so `supports('listScopes')` and the generic
   * ProviderInterface surface work for Jira without a call-site change.
   * @param {string} accessToken - the OAuth access token from completeAuth.
   * @returns {Promise<Array<{cloudId: string, url: string, name: string}>>}
   */
  async listScopes(accessToken) {
    return fetchJiraAccessibleResources(accessToken)
  }

  // ---------------------------------------------------------------------------
  // Auth — the Jira consumer of the LIN-562 binding seam (LIN-1885 beat 2)
  // ---------------------------------------------------------------------------

  /**
   * Validate a Basic-auth credential via a lightweight read probe (LIN-1885):
   * `GET /rest/api/3/myself`. Mirrors the settings refresh route's READ_PROBES
   * pattern (`server.js` ~2770-2787) in spirit, but Jira's Phase 1 read surface
   * has no `fetchViewer`/`fetchOrganization`/`fetchProjectsList` to reuse
   * through that generic list, so the probe is a direct client call instead.
   * Used by `routes/jira-auth.js`'s link handler to validate-then-link
   * synchronously — a failed probe throws (the client's status-carrying
   * error), never silently linking a dead credential.
   * @param {{email: string, apiToken: string, site: string}} credential
   * @returns {Promise<{accountId: string, emailAddress?: string, displayName?: string}>}
   */
  async validateCredential(credential) {
    // LIN-1887: takes either credential shape verbatim — Basic
    // `{email, apiToken, site}` or OAuth `{authType:'oauth', accessToken, cloudId, site}`
    // — because `createJiraClient` already forks on `authType` and this is a
    // pass-through. `GET /rest/api/3/myself` is deliberately the identity probe
    // for BOTH shapes (rather than `api.atlassian.com/me` for OAuth): it needs no
    // scope beyond `read:jira-user`, so it does not widen the D2 consent set, and
    // it returns the same Atlassian `accountId`, so a human upgrading a Basic
    // link to OAuth resolves to the same Harbour account instead of colliding
    // with themselves.
    const client = this._clientForCredential(credential)
    return client.getMyself()
  }

  /**
   * The Jira auth router (LIN-1885). Mounted by server.js's per-provider
   * auth-mount loop (it iterates `getAllProviders().getAuthRouter()`). Mirrors
   * GitHubProvider.getAuthRouter — folds routes/jira-auth.js behind the
   * provider and injects `this` so the route drives the provider's seam.
   * @param {{sessionStore: Object, accountStore: Object, accountWorkspaceStore: Object}} opts
   * @returns {import('express').Router}
   */
  getAuthRouter(opts) {
    return createJiraAuthRoutes({ ...opts, provider: this })
  }
}

/** Singleton Jira provider (client/site injected at boot via configure()). */
export const jiraProvider = new JiraProvider()

// Module-load self-registration (see registry.js header for the lifecycle
// rationale). Importing this module is what populates the registry under
// 'jira'; server.js's side-effect import (LIN-1885 beat 4) is what makes that
// import actually happen at boot.
registerProvider(jiraProvider)
