// =============================================================================
// Jira Cloud Provider — Phase 1 (LIN-1885, Phase 1 of LIN-275)
// =============================================================================
//
// Read-only Jira Cloud MVP on API-token Basic auth. Scope is strictly the
// Phase 1 boundary: reads only — no writes, no OAuth 3LO (Phase 3), no
// story-point/epic-link mapping (Phase 4). See LIN-275's Implementation Plan
// (Revision 3) and LIN-1885's research comments for the full reasoning.
//
// --- Capability profile (LIN-1885) -------------------------------------------
//   write:     true  → overrides getCreateTaskUrl (external "create issue" deep
//                      link only — createIssue/updateIssue stay unimplemented,
//                      so ui.write/supports('createIssue') stay decoupled, same
//                      as every other provider)
//   comments:  true  → implements fetchIssueComments
//   subtasks:  true  → Jira's native one-level subtasks map to parent/children
//                      on a best-effort basis (fetchIssueContext)
//   estimates: false → no story-point mapping this phase (Phase 4)
//   teams:     false → fetchTeams returns [] (Jira projects are NOT coerced
//                      into canonical teams — no in-tree `ui.teams` flag exists
//                      to set; teams:false is expressed purely by the empty read)
//   cycles:    false → simply not overridden (no in-tree `ui.cycles` flag
//                      either — cycles:false is the base's un-overridden decline)
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

import { ProviderInterface } from '../interface.js'
import { registerProvider } from '../registry.js'
import { SOURCE_JIRA } from '../models.js'
import { createJiraClient } from './client.js'
import { createJiraAuthRoutes } from '../../../routes/jira-auth.js'

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
// Exported so the mapping is unit-testable in isolation (mirrors
// githubStateToCanonical).
export function jiraStatusCategoryToCanonical(issue = {}) {
  const status = issue?.fields?.status
  const key = status?.statusCategory?.key
  const name = status?.name || 'Unknown'
  if (key === 'new') return { name, type: 'unstarted' }
  if (key === 'indeterminate') return { name, type: 'started' }
  if (key === 'done') return { name, type: 'completed' }
  // Unrecognized/missing category — a safe, non-terminal default rather than
  // guessing at canceled/duplicate from a status name.
  return { name, type: 'unstarted' }
}

// -----------------------------------------------------------------------------
// ADF (Atlassian Document Format) → Markdown.
// -----------------------------------------------------------------------------
//
// Jira Cloud's `description`/comment `body` fields are ADF documents, not
// plain text or HTML. This is a deliberately MINIMAL renderer covering the
// node/mark types real Jira content actually uses — not a full ADF spec
// implementation. Unknown node types fall through to their child content (if
// any) so an unhandled node degrades to its text rather than vanishing.
const MARK_RENDERERS = {
  strong: text => `**${text}**`,
  em: text => `_${text}_`,
  code: text => `\`${text}\``,
  strike: text => `~~${text}~~`,
  link: (text, mark) => `[${text}](${mark?.attrs?.href || ''})`,
}

function renderMarks(text, marks) {
  return (marks || []).reduce((out, mark) => {
    const render = MARK_RENDERERS[mark.type]
    return render ? render(out, mark) : out
  }, text)
}

function renderAdfNodes(nodes) {
  return (nodes || []).map(renderAdfNode).join('')
}

function renderAdfNode(node) {
  if (!node || typeof node !== 'object') return ''
  switch (node.type) {
    case 'text':
      return renderMarks(node.text || '', node.marks)
    case 'paragraph':
      return `${renderAdfNodes(node.content)}\n\n`
    case 'heading': {
      const level = Math.min(Math.max(node.attrs?.level || 1, 1), 6)
      return `${'#'.repeat(level)} ${renderAdfNodes(node.content)}\n\n`
    }
    case 'bulletList':
      return `${(node.content || []).map(li => `- ${renderAdfNodes(li.content).trim()}\n`).join('')}\n`
    case 'orderedList':
      return `${(node.content || []).map((li, i) => `${i + 1}. ${renderAdfNodes(li.content).trim()}\n`).join('')}\n`
    case 'codeBlock': {
      const lang = node.attrs?.language || ''
      const code = renderAdfNodes(node.content).replace(/\n+$/, '')
      return `\`\`\`${lang}\n${code}\n\`\`\`\n\n`
    }
    case 'blockquote':
      return `${renderAdfNodes(node.content).trim().split('\n').map(l => `> ${l}`).join('\n')}\n\n`
    case 'rule':
      return '---\n\n'
    case 'hardBreak':
      return '\n'
    case 'mention':
      return node.attrs?.text || `@${node.attrs?.id || 'user'}`
    case 'inlineCard':
    case 'blockCard':
      return node.attrs?.url || ''
    case 'emoji':
      return node.attrs?.text || node.attrs?.shortName || ''
    default:
      return node.content ? renderAdfNodes(node.content) : ''
  }
}

/**
 * Convert an ADF document (Jira's rich-text wire shape) to Markdown.
 * @param {{type?: string, content?: Array}|null|undefined} doc
 * @returns {string}
 */
export function adfToMarkdown(doc) {
  if (!doc || typeof doc !== 'object') return ''
  return renderAdfNodes(doc.content).trim()
}

// -----------------------------------------------------------------------------
// The exact `fields` a JQL search must request (LIN-1885 beat 1 review
// blocker) — `/rest/api/3/search/jql` returns only issue IDs by default, so
// every field `_toCanonicalIssue`/`fetchIssueContext` reads off `jira.fields`
// below MUST be listed here or it silently comes back `undefined`. Verified
// against both read sites by hand at beat time; keep this list and those two
// functions in lockstep.
// -----------------------------------------------------------------------------
export const JIRA_ISSUE_FIELDS = [
  'summary', 'status', 'description', 'project', 'parent',
  'assignee', 'labels', 'created', 'duedate', 'resolutiondate',
]

/** JQL scoping every mapped project's issues (LIN-1885 beat 1 review finding #2)
 *  — bounds a dashboard render to the site's own projects instead of an
 *  unfiltered site-wide walk (the "one bad script" pattern the shared
 *  per-tenant burst bucket punishes), and Jira now rejects a bare
 *  `ORDER BY key ASC` with no filter clause as `400 Bad Request` anyway. */
function projectScopedJql(projectKeys) {
  const keys = projectKeys.filter(Boolean)
  if (!keys.length) return null
  const list = keys.map(key => `"${key}"`).join(',')
  return `project in (${list}) ORDER BY key ASC`
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

  _toCanonicalIssue(jira, site) {
    const fields = jira.fields || {}
    const done = fields.status?.statusCategory?.key === 'done'
    return {
      source: SOURCE_JIRA, // provenance stamp (LIN-561)
      id: jira.id, // the immutable issue id is the opaque identity; `key` is human-readable only
      identifier: jira.key,
      title: fields.summary || '',
      description: adfToMarkdown(fields.description),
      estimate: null, // capability: estimates:false (Phase 4)
      priority: 0,
      sortOrder: 0,
      createdAt: fields.created || null,
      dueDate: fields.duedate || null,
      completedAt: done ? (fields.resolutiondate || null) : null,
      url: site && jira.key ? `${site}/browse/${jira.key}` : null,
      // Best-effort: Jira's native one-level subtask parent link.
      parent: fields.parent ? { id: fields.parent.id, identifier: fields.parent.key } : null,
      project: fields.project ? { id: fields.project.id, name: fields.project.name } : null,
      state: jiraStatusCategoryToCanonical(jira),
      assignee: fields.assignee ? { name: fields.assignee.displayName } : null,
      labels: { nodes: (fields.labels || []).map(name => ({ name })) },
      // No typed relations mapped this phase (epic-link deferred to Phase 4).
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

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  /**
   * Projects + issues for the dashboard, mirroring the GitHub/Local
   * `fetchProjects` shape. `scope` is the per-request Basic-auth credential.
   * Issues are fetched with a JQL scoped to the site's own projects (LIN-1885
   * beat 1 review finding #2) — projects must resolve first, so this is
   * sequential rather than the prior Promise.all; an unfiltered `ORDER BY key
   * ASC` is both unbounded (a full-tenant page walk) and, since the beat 1
   * migration to `/search/jql`, rejected outright (`400`) as a filterless
   * query. No projects → no scoped JQL to run, so issues short-circuits to [].
   * @returns {Promise<{organizationName, projects, issues}>}
   */
  async fetchProjects(scope, _teamId = null, _opts = {}) {
    const client = this._clientFor(scope)
    const site = this._resolveSite(scope)
    const projects = await client.listAllProjects()
    const jql = projectScopedJql(projects.map(p => p.key))
    const issues = jql ? await client.searchAllIssues(jql, { fields: JIRA_ISSUE_FIELDS }) : []
    return {
      organizationName: orgNameFromSite(site),
      projects: projects.map(p => this._toCanonicalProject(p, site)),
      issues: issues.map(i => this._toCanonicalIssue(i, site)),
    }
  }

  /**
   * Jira projects are NOT coerced into canonical teams (capability teams:false).
   * Returning [] rather than throwing keeps the dashboard's
   * fetchAndPrepareProjects provider-agnostic, mirroring GitHub/Local.
   */
  async fetchTeams(_scope) {
    return []
  }

  /**
   * A single Jira issue → the same canonical render shape fetchProjects emits
   * per node (mirrors GitHubProvider.fetchIssueFields). Backs the dashboard's
   * lazy per-issue detail load (LIN-442) — without this, expanding an issue
   * row 404s/silently fails to load its description/comments toggle even
   * though the row itself rendered fine from fetchProjects' bulk read.
   */
  async fetchIssueFields(scope, issueId) {
    const client = this._clientFor(scope)
    const site = this._resolveSite(scope)
    const jira = await client.getIssue(issueId)
    if (!jira) throw new Error(`Issue not found: ${issueId}`)
    return this._toCanonicalIssue(jira, site)
  }

  /**
   * Single-issue context for the detail/recommendation surfaces. Children are
   * Jira's native one-level subtasks (`parent = "<key>"`), fetched best-effort;
   * siblings/cousins stay empty this phase (no team/cross-project traversal).
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
      parent: fields.parent ? { id: fields.parent.id, identifier: fields.parent.key, title: null } : null,
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

  // ---------------------------------------------------------------------------
  // URLs / UI capability surface
  // ---------------------------------------------------------------------------

  /**
   * Jira's "create issue" deep link (the global create dialog, project-scoped
   * when `projectId` is known). Overriding this is what makes `ui.write` true
   * (render gates "+ Add task" on it) — this is an EXTERNAL link, not an
   * in-app write; createIssue/updateIssue stay unimplemented this phase.
   * Uses the boot-configured default `site` (single-tenant limitation,
   * mirrors GitHubProvider.getCreateTaskUrl's single-default-repo note).
   */
  getCreateTaskUrl(_urlKey, projectId) {
    if (!this.site) return 'https://www.atlassian.com/software/jira'
    const base = String(this.site).replace(/\/+$/, '')
    return projectId
      ? `${base}/secure/CreateIssue.jspa?pid=${encodeURIComponent(projectId)}`
      : `${base}/secure/CreateIssue!default.jspa`
  }

  /**
   * `write`/`comments`/`inlineCreate`/`inlineEdit` all auto-derive from the base
   * getter (getCreateTaskUrl override + fetchIssueComments implemented +
   * createIssue/updateIssue NOT implemented, correctly false this phase).
   * Override only the abstract flags Jira's own schema decides: subtasks (native
   * one-level parent/child, best-effort mapped), estimates (no story-point field
   * this phase — Phase 4), plus displayName (LIN-1885 research: `server.js`'s
   * bound-binding row reads `ui.displayName`, a DIFFERENT source than the
   * Settings add-list's static `displayName` — without this override a bound
   * Jira workspace would render lowercase `jira`).
   */
  get ui() {
    return { ...super.ui, estimates: false, subtasks: true, displayName: 'Jira' }
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
