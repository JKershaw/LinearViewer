/**
 * Unit tests for lib/providers/jira/{index,client,fake-client}.js (LIN-1885,
 * Phase 1 of LIN-275; LIN-2018 canonical project→team remap).
 *
 * The ADF <-> Markdown codec's own tests (adfToMarkdown/markdownToAdf/
 * adfHasUnrenderableContent) live separately in
 * tests/unit/jira-provider-adf-codec.test.js (LIN-2399, split alongside the
 * codec's extraction into lib/providers/jira/adf.js) — this file covers the
 * provider surface that calls the codec, not the codec itself.
 *
 * Mirrors github-provider.test.js's shape. Pins:
 *   - the pure statusCategory → canonical state mapping (now id-stamped off
 *     the issue's REAL Jira status id, LIN-2018);
 *   - the capability profile (method capabilities + the ui surface, incl. the
 *     displayName override that keeps a bound row from rendering lowercase 'jira');
 *   - module-load self-registration under 'jira';
 *   - reads returning the canonical shape, driven through the in-memory fake
 *     client (no network, no auth) — fetchProjects (incl. team-scoped),
 *     fetchIssueContext (best-effort subtask children), fetchIssueComments,
 *     fetchTeams → the tenant's projects as canonical teams (LIN-2018);
 *   - states() reading a project's REAL per-project workflow statuses
 *     (LIN-2018) — flattened/deduped-by-id across issue types, synthetic
 *     position, degrade to [] with no teamId;
 *   - updateIssue's D2 exact-status-id transition match (LIN-2018, LIN-1941's
 *     root fix) — never first-match-on-category;
 *   - createJiraClient's serial pagination and bounded 429/Retry-After retry,
 *     against a captured fetchImpl (real client, not the fake — the fake never
 *     rate-limits or paginates on the wire).
 *
 * Run with: node --test tests/unit/jira-provider.test.js
 */
import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert'
import {
  JiraProvider,
  jiraProvider,
  jiraStatusCategoryToCanonical,
  isEpicParent,
  JIRA_ISSUE_FIELDS,
  CANONICAL_TYPE_TO_JIRA_STATUS_CATEGORY,
  jiraReachableTierOrder,
  JiraInProgressCapExceededError,
} from '../../lib/providers/jira/index.js'
import { RefResolutionError } from '../../lib/proxy-ref-resolver.js'
import { PartialWriteError } from '../../lib/partial-write-error.js'
import { createFakeJiraClient } from '../../lib/providers/jira/fake-client.js'
import { createJiraClient } from '../../lib/providers/jira/client.js'
import { getProvider } from '../../lib/providers/registry.js'
import { NotImplementedError } from '../../lib/providers/interface.js'
import { SOURCE_JIRA } from '../../lib/providers/models.js'
import { buildForest } from '../../lib/tree.js'

const SITE = 'https://acme.atlassian.net'

// LIN-2018: ENG's real per-project statuses, seeded across TWO issue types on
// purpose — 'Task' and 'Bug' each repeat status id '11' ('To Do') and '13'
// ('Done'), so a dedup-by-id bug (vs. a correct implementation) is
// distinguishable. '15' ('Ready for QA') is a CUSTOM name only 'Bug' carries,
// and '13'/'14' are two DISTINCT done-category statuses ('Done' / "Won't
// Do") — the exact shape LIN-1941's hazard needs to be provable against.
const ENG_PROJECT_STATUSES = [
  {
    id: '1', name: 'Task', subtask: false,
    statuses: [
      { id: '11', name: 'To Do', statusCategory: { key: 'new' } },
      { id: '12', name: 'In Progress', statusCategory: { key: 'indeterminate' } },
      { id: '13', name: 'Done', statusCategory: { key: 'done' } },
      { id: '14', name: "Won't Do", statusCategory: { key: 'done' } },
    ],
  },
  {
    id: '2', name: 'Bug', subtask: false,
    statuses: [
      { id: '11', name: 'To Do', statusCategory: { key: 'new' } },
      { id: '15', name: 'Ready for QA', statusCategory: { key: 'indeterminate' } },
      { id: '13', name: 'Done', statusCategory: { key: 'done' } },
    ],
  },
]

/** Jira's own epic-level `issuetype` marker (LIN-2011) — `hierarchyLevel: 1`. */
const EPIC_ISSUETYPE = { id: '10000', name: 'Epic', hierarchyLevel: 1 }

function seededProvider() {
  const client = createFakeJiraClient({
    projects: [
      { id: '10001', key: 'ENG', name: 'Engineering' },
    ],
    projectStatuses: { ENG: ENG_PROJECT_STATUSES },
    issues: [
      {
        id: '20001',
        key: 'ENG-1',
        fields: {
          summary: 'Parent story',
          description: { type: 'doc', version: 1, content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'A parent issue.' }] },
          ] },
          status: { id: '12', name: 'In Progress', statusCategory: { key: 'indeterminate' } },
          project: { id: '10001', key: 'ENG', name: 'Engineering' },
          created: '2026-01-01T00:00:00.000Z',
          duedate: null,
          resolutiondate: null,
          labels: ['backend'],
          assignee: { displayName: 'Ada Lovelace' },
          // LIN-2011: a native team-managed epic link — `fields.parent` points
          // at an EPIC (the nested `issuetype` is what `isEpicParent` reads),
          // so this routes to canonical `project`, not `parent`.
          parent: { id: '30001', key: 'ENG-9', fields: { issuetype: EPIC_ISSUETYPE, summary: 'Platform Epic' } },
          _comments: [
            { id: '1', body: { type: 'doc', version: 1, content: [
              { type: 'paragraph', content: [{ type: 'text', text: 'First comment' }] },
            ] }, created: '2026-01-02T00:00:00.000Z', author: { displayName: 'Ada Lovelace' } },
          ],
        },
      },
      {
        id: '20002',
        key: 'ENG-2',
        fields: {
          summary: 'Subtask of ENG-1',
          description: null,
          status: { id: '13', name: 'Done', statusCategory: { key: 'done' } },
          project: { id: '10001', key: 'ENG', name: 'Engineering' },
          created: '2026-01-03T00:00:00.000Z',
          duedate: null,
          resolutiondate: '2026-01-04T00:00:00.000Z',
          labels: [],
          assignee: null,
          // Native one-level subtask parent — ENG-1 is a STORY, not an epic
          // (no nested `issuetype`), so this must stay routed to canonical
          // `parent`, unaffected by LIN-2011 (regression coverage).
          parent: { id: '20001', key: 'ENG-1' },
        },
      },
      {
        id: '30001',
        key: 'ENG-9',
        fields: {
          summary: 'Platform Epic',
          description: null,
          issuetype: EPIC_ISSUETYPE,
          status: { id: '11', name: 'To Do', statusCategory: { key: 'new' } },
          project: { id: '10001', key: 'ENG', name: 'Engineering' },
          created: '2026-01-01T00:00:00.000Z',
          duedate: null,
          resolutiondate: null,
          labels: [],
          assignee: null,
          parent: null,
        },
      },
    ],
  })
  const provider = new JiraProvider({ clientFactory: () => client, site: SITE })
  return { provider, client }
}

/** A second-project variant of `seededProvider` (LIN-2018) — proves a team-scoped read is actually SCOPED, not client-side-filtered after a full walk. Each project (LIN-2011) carries its own epic, so the epic-derivation walk has something real to find per project. */
function multiTeamSeededProvider() {
  const client = createFakeJiraClient({
    projects: [
      { id: '10001', key: 'ENG', name: 'Engineering' },
      { id: '10002', key: 'OPS', name: 'Operations' },
    ],
    projectStatuses: {
      ENG: ENG_PROJECT_STATUSES,
      OPS: [{ id: '3', name: 'Task', subtask: false, statuses: [{ id: '21', name: 'To Do', statusCategory: { key: 'new' } }] }],
    },
    issues: [
      {
        id: '20001', key: 'ENG-1',
        fields: {
          summary: 'Engineering issue', description: null,
          status: { id: '12', name: 'In Progress', statusCategory: { key: 'indeterminate' } },
          project: { id: '10001', key: 'ENG', name: 'Engineering' },
          created: '2026-01-01T00:00:00.000Z', duedate: null, resolutiondate: null,
          labels: [], assignee: null,
          parent: { id: '30001', key: 'ENG-9', fields: { issuetype: EPIC_ISSUETYPE, summary: 'Platform Epic' } },
        },
      },
      {
        id: '30001', key: 'ENG-9',
        fields: {
          summary: 'Platform Epic', description: null, issuetype: EPIC_ISSUETYPE,
          status: { id: '11', name: 'To Do', statusCategory: { key: 'new' } },
          project: { id: '10001', key: 'ENG', name: 'Engineering' },
          created: '2026-01-01T00:00:00.000Z', duedate: null, resolutiondate: null,
          labels: [], assignee: null, parent: null,
        },
      },
      {
        id: '40001', key: 'OPS-1',
        fields: {
          summary: 'Operations issue', description: null,
          status: { id: '21', name: 'To Do', statusCategory: { key: 'new' } },
          project: { id: '10002', key: 'OPS', name: 'Operations' },
          created: '2026-01-01T00:00:00.000Z', duedate: null, resolutiondate: null,
          labels: [], assignee: null, parent: null,
        },
      },
      {
        id: '40002', key: 'OPS-9',
        fields: {
          summary: 'Ops Epic', description: null, issuetype: EPIC_ISSUETYPE,
          status: { id: '21', name: 'To Do', statusCategory: { key: 'new' } },
          project: { id: '10002', key: 'OPS', name: 'Operations' },
          created: '2026-01-01T00:00:00.000Z', duedate: null, resolutiondate: null,
          labels: [], assignee: null, parent: null,
        },
      },
    ],
  })
  const provider = new JiraProvider({ clientFactory: () => client, site: SITE })
  return { provider, client }
}

/**
 * A variant of `multiTeamSeededProvider` (LIN-2011 re-review finding F3):
 * ENG-77 lives in the ENG project but is parented to OPS-9, an epic in a
 * DIFFERENT Jira project — a cross-project parent link, which Jira permits.
 * A team-scoped read (`fetchProjects(scope, 'ENG')`) walks only the ENG
 * project's issues, so OPS-9 is never itself part of the fetched batch —
 * exactly the "referenced but out-of-batch epic" shape the fix must not
 * silently drop.
 */
function crossProjectEpicSeededProvider() {
  const client = createFakeJiraClient({
    projects: [
      { id: '10001', key: 'ENG', name: 'Engineering' },
      { id: '10002', key: 'OPS', name: 'Operations' },
    ],
    projectStatuses: {
      ENG: ENG_PROJECT_STATUSES,
      OPS: [{ id: '3', name: 'Task', subtask: false, statuses: [{ id: '21', name: 'To Do', statusCategory: { key: 'new' } }] }],
    },
    issues: [
      {
        id: '50001', key: 'ENG-77',
        fields: {
          summary: 'Engineering story under a cross-project epic', description: null,
          status: { id: '12', name: 'In Progress', statusCategory: { key: 'indeterminate' } },
          project: { id: '10001', key: 'ENG', name: 'Engineering' },
          created: '2026-01-01T00:00:00.000Z', duedate: null, resolutiondate: null,
          labels: [], assignee: null,
          parent: { id: '40002', key: 'OPS-9', fields: { issuetype: EPIC_ISSUETYPE, summary: 'Ops Epic' } },
        },
      },
      {
        id: '40002', key: 'OPS-9',
        fields: {
          summary: 'Ops Epic', description: null, issuetype: EPIC_ISSUETYPE,
          status: { id: '21', name: 'To Do', statusCategory: { key: 'new' } },
          project: { id: '10002', key: 'OPS', name: 'Operations' },
          created: '2026-01-01T00:00:00.000Z', duedate: null, resolutiondate: null,
          labels: [], assignee: null, parent: null,
        },
      },
    ],
  })
  const provider = new JiraProvider({ clientFactory: () => client, site: SITE })
  return { provider, client }
}

// =============================================================================
// Pure state mapping
// =============================================================================

describe('jiraStatusCategoryToCanonical', () => {
  test('new → unstarted', () => {
    const state = jiraStatusCategoryToCanonical({ fields: { status: { id: '1', name: 'To Do', statusCategory: { key: 'new' } } } })
    assert.deepEqual(state, { id: '1', name: 'To Do', type: 'unstarted' })
  })

  test('indeterminate → started', () => {
    const state = jiraStatusCategoryToCanonical({ fields: { status: { id: '3', name: 'In Progress', statusCategory: { key: 'indeterminate' } } } })
    assert.deepEqual(state, { id: '3', name: 'In Progress', type: 'started' })
  })

  test('done → completed', () => {
    const state = jiraStatusCategoryToCanonical({ fields: { status: { id: '10001', name: 'Done', statusCategory: { key: 'done' } } } })
    assert.deepEqual(state, { id: '10001', name: 'Done', type: 'completed' })
  })

  test('an unrecognized/missing category defaults to unstarted, never canceled/duplicate', () => {
    assert.equal(jiraStatusCategoryToCanonical({ fields: { status: { id: '9', name: 'Weird', statusCategory: { key: 'something-else' } } } }).type, 'unstarted')
    assert.equal(jiraStatusCategoryToCanonical({}).type, 'unstarted')
  })

  // LIN-2018: the id stamp is now the issue's REAL Jira status id (previously
  // a synthetic 3-entry vocabulary id, LIN-1886 D2) — the id, NOT the
  // free-text status name, is what the task-edit <select> preselects on. A
  // CUSTOM workflow status name proves the stamp cannot be coming from a name
  // match: only the id ties it back to the real per-project status.
  test('stamps the REAL Jira status id — not a synthetic vocabulary id', () => {
    const state = jiraStatusCategoryToCanonical({ fields: { status: { id: '10050', name: 'Ready for QA', statusCategory: { key: 'indeterminate' } } } })
    assert.equal(state.id, '10050')
    assert.equal(state.name, 'Ready for QA')
    assert.equal(state.type, 'started')
  })

  test('a status with no id (defensive — real Jira REST responses always carry one) stamps id: null rather than a synthetic placeholder', () => {
    const state = jiraStatusCategoryToCanonical({ fields: { status: { name: 'Ready for QA', statusCategory: { key: 'indeterminate' } } } })
    assert.equal(state.id, null)
    assert.equal(jiraStatusCategoryToCanonical({}).id, null)
  })

  test('never maps from the free-text status name', () => {
    // A status literally named "Done" but in the 'new' category must still read unstarted.
    const state = jiraStatusCategoryToCanonical({ fields: { status: { id: '1', name: 'Done', statusCategory: { key: 'new' } } } })
    assert.equal(state.type, 'unstarted')
  })
})

// =============================================================================
// Capability profile + registration
// =============================================================================

describe('JiraProvider capability profile', () => {
  test('registers under "jira" at module load', () => {
    assert.strictEqual(getProvider('jira'), jiraProvider)
    assert.equal(jiraProvider.name, 'jira')
  })

  test('implements the Phase 1 read + Phase 2 (LIN-1886) write surface', () => {
    const p = new JiraProvider()
    assert.equal(p.supports('fetchProjects'), true)
    assert.equal(p.supports('fetchTeams'), true)
    assert.equal(p.supports('fetchIssueContext'), true)
    assert.equal(p.supports('fetchIssueComments'), true)
    assert.equal(p.supports('fetchRecommendationContext'), true, 'LIN-1910 — recap/brief/recommend/task-chat')
    assert.equal(p.supports('fetchIssueFields'), true, 'backs the dashboard lazy per-issue detail load, LIN-442')
    assert.equal(p.supports('fetchProjectsList'), true, 'LIN-1886 Step 2')
    // createIssue stays deferred behind LIN-1557; everything else in the
    // LIN-1886 write surface is now implemented.
    assert.equal(p.supports('createIssue'), false)
    assert.equal(p.supports('updateIssue'), true)
    assert.equal(p.supports('createComment'), true)
    assert.equal(p.supports('addLabel'), true)
    assert.equal(p.supports('removeLabel'), true)
  })

  test('the four route-internal reads exist but stay OFF the declared PROVIDER_SURFACE (LIN-1886, mirrors GitHub LIN-1559)', () => {
    const p = new JiraProvider()
    for (const m of ['issueWriteGuard', 'issueDescription', 'issueLabels', 'updateIssueLabels']) {
      assert.equal(p.supports(m), false, `${m} must stay off the declared surface`)
      assert.equal(typeof p[m], 'function', `${m} must still be implemented`)
    }
  })

  test('ui surface: write true (external create link) decoupled from inlineCreate false; inlineEdit true (LIN-1886)', () => {
    const p = new JiraProvider({ site: SITE })
    assert.equal(p.ui.write, true, 'getCreateTaskUrl is overridden')
    assert.equal(p.ui.inlineCreate, false, 'createIssue is not implemented (deferred behind LIN-1557)')
    assert.equal(p.ui.inlineEdit, true, 'updateIssue is implemented (LIN-1886)')
    assert.equal(p.ui.comments, true)
    assert.equal(p.ui.estimates, false)
    assert.equal(p.ui.subtasks, true)
    assert.equal(p.ui.priority, false, 'priority is unmapped (D3) — the edit form must hide the control')
  })

  test('ui.displayName is "Jira", not the lowercase machine name (LIN-1885 research trap)', () => {
    const p = new JiraProvider()
    assert.equal(p.ui.displayName, 'Jira')
    assert.notEqual(p.ui.displayName, p.name)
  })

  test('getCreateTaskUrl falls back to a generic URL with no configured site', () => {
    const p = new JiraProvider()
    assert.equal(p.getCreateTaskUrl('urlKey', null), 'https://www.atlassian.com/software/jira')
  })

  test('getCreateTaskUrl always opens the un-scoped create dialog — never pid=<epic id> (LIN-2011 review F4)', () => {
    const p = new JiraProvider({ site: SITE })
    // `projectId` is render.js's canonical `project.id`, which since LIN-2011
    // is an EPIC ISSUE id, not a Jira project id — passing it through as
    // `pid=` was a measured regression (dead link, or worse, opens the
    // create dialog against an unrelated project sharing that numeric id).
    assert.equal(p.getCreateTaskUrl('urlKey', '10001'), `${SITE}/secure/CreateIssue!default.jspa`)
    assert.equal(p.getCreateTaskUrl('urlKey', null), `${SITE}/secure/CreateIssue!default.jspa`)
  })

  test('_clientFor throws with no boot client and no credential scope', () => {
    const p = new JiraProvider()
    assert.throws(() => p._clientFor(undefined), /client not configured/)
  })

  test('_clientFor throws on a credential missing apiToken/site', () => {
    const p = new JiraProvider()
    assert.throws(() => p._clientFor({ email: 'a@b.com' }), /missing apiToken\/site/)
  })
})

// =============================================================================
// Reads, driven through the in-memory fake client
// =============================================================================

describe('JiraProvider reads (fake client)', () => {
  let provider

  beforeEach(() => {
    ({ provider } = seededProvider())
  })

  // LIN-2018: a Jira project surfaces as a canonical team, id = project key.
  test('fetchTeams maps projects to {id, name, key}, id = project key (LIN-2018, Option 2 of the LIN-2007 ruling)', async () => {
    const teams = await provider.fetchTeams({ email: 'a@b.com', apiToken: 't', site: SITE })
    assert.deepEqual(Array.from(teams), [{ id: 'ENG', name: 'Engineering', key: 'ENG' }])
    assert.equal(teams.truncated, false, 'the shared fake client never sets .truncated, so the untruncated path must coerce to false, not undefined')
  })

  // LIN-2033 F1: `listAllProjects()` stamps `truncated` as a custom property
  // on the array; `.map()` returns a fresh array and silently drops it — the
  // exact mechanism `fetchProjects` already guards against (see its own
  // truncated-preservation tests below). `fetchTeams` must re-stamp it on the
  // array it returns, since every provider's `fetchTeams()` (and every
  // caller: matchTeamId/requireTeamMembership, resolveTeamRef,
  // task-create.js's option-list loader, …) treats the result as a bare
  // array — so the flag has to ride the array, not replace its shape.
  test('fetchTeams preserves the truncated flag (LIN-2033 F1) when listAllProjects() hit its cap', async () => {
    const cappedProjects = [{ id: '10001', key: 'ENG', name: 'Engineering' }]
    cappedProjects.truncated = true
    const stubClient = { listAllProjects: async () => cappedProjects }
    const cappedProvider = new JiraProvider({ clientFactory: () => stubClient, site: SITE })
    const teams = await cappedProvider.fetchTeams({ email: 'a@b.com', apiToken: 't', site: SITE })
    assert.deepEqual(Array.from(teams), [{ id: 'ENG', name: 'Engineering', key: 'ENG' }], 'the .truncated flag must survive the canonical .map() mapping, not be silently dropped')
    assert.equal(teams.truncated, true)
  })

  test('fetchProjects returns canonical projects + issues, stamped with SOURCE_JIRA (LIN-2011: projects are epic-derived)', async () => {
    const scope = { email: 'a@b.com', apiToken: 't', site: SITE }
    const result = await provider.fetchProjects(scope)
    assert.equal(result.organizationName, 'acme')
    // LIN-2011: the canonical project is the EPIC (ENG-9), not the Jira
    // project (ENG) — the Jira project's own numeric id no longer surfaces
    // as a canonical project anywhere.
    assert.equal(result.projects.length, 1)
    assert.equal(result.projects[0].id, '30001')
    assert.equal(result.projects[0].name, 'Platform Epic')
    assert.equal(result.projects[0].url, `${SITE}/browse/ENG-9`, 'project url is the epic\'s own browsable /browse/ link')
    // LIN-2011 review finding F1: the epic itself (ENG-9) is excluded from
    // `issues` — it already surfaces as the canonical project above, and
    // including it too double-rendered it (project header + "No Project" row).
    assert.equal(result.issues.length, 2, 'ENG-1 and ENG-2 only — the epic ENG-9 is not also an issue')
    assert.ok(!result.issues.some(i => i.identifier === 'ENG-9'), 'the epic must not double-render as an ungrouped issue')
    for (const issue of result.issues) assert.equal(issue.source, SOURCE_JIRA)

    const parent = result.issues.find(i => i.identifier === 'ENG-1')
    assert.equal(parent.title, 'Parent story')
    assert.equal(parent.description, 'A parent issue.')
    assert.equal(parent.state.type, 'started')
    assert.equal(parent.url, `${SITE}/browse/ENG-1`)
    assert.equal(parent.assignee.name, 'Ada Lovelace')
    assert.deepEqual(parent.labels.nodes, [{ name: 'backend' }])
    assert.equal(parent.id, '20001', 'the immutable issue id is the primary identity, key is human-readable only')
    // LIN-2018: the team stamp — id = project key, matching issueWriteGuard's
    // own precedence — is what makes `loadStates(..., issue.team.id)` and the
    // proxy wire's flat `teamId` mirror stop always seeing null for Jira.
    assert.deepEqual(parent.team, { id: 'ENG', name: 'Engineering' })
    // LIN-2011: ENG-1's parent is the epic ENG-9, so it routes to canonical
    // `project`, not `parent` — an epic is not a subtask-parent.
    assert.deepEqual(parent.project, { id: '30001', name: 'Platform Epic' })
    assert.equal(parent.parent, null)

    const child = result.issues.find(i => i.identifier === 'ENG-2')
    assert.equal(child.state.type, 'completed')
    assert.equal(child.completedAt, '2026-01-04T00:00:00.000Z')
    // ENG-2's parent (ENG-1) is a story, not an epic — regression: the native
    // subtask mapping stays byte-identical, unaffected by LIN-2011.
    assert.deepEqual(child.parent, { id: '20001', identifier: 'ENG-1' })
    assert.equal(child.project, null, 'accepted limitation: a subtask\'s project is not back-filled from its parent story\'s epic')
  })

  test('an issue with no project stamps team: null (mirrors project: null)', async () => {
    const client = createFakeJiraClient({
      projects: [], issues: [{ id: '99', key: 'X-1', fields: { summary: 'orphan', status: { statusCategory: { key: 'new' } }, project: null } }],
    })
    const orphanProvider = new JiraProvider({ clientFactory: () => client, site: SITE })
    const issue = await orphanProvider.fetchIssueFields({ email: 'a@b.com', apiToken: 't', site: SITE }, 'X-1')
    assert.equal(issue.team, null)
    assert.equal(issue.project, null)
  })

  test('fetchProjects(scope, teamId) scopes to ONE project via getProject + a single-project JQL — not a client-side filter after a full walk (LIN-2018)', async () => {
    const { provider: multi, client } = multiTeamSeededProvider()
    const listAllCalls = { count: 0 }
    const originalListAllProjects = client.listAllProjects.bind(client)
    client.listAllProjects = async (...args) => { listAllCalls.count += 1; return originalListAllProjects(...args) }
    const scope = { email: 'a@b.com', apiToken: 't', site: SITE }

    const result = await multi.fetchProjects(scope, 'ENG')
    assert.equal(result.projects.length, 1)
    assert.equal(result.projects[0].id, '30001', 'the ENG epic, not the ENG Jira project (LIN-2011)')
    assert.deepEqual(result.issues.map(i => i.identifier).sort(), ['ENG-1'], 'OPS-1/OPS-9 must be absent (scoped read) and ENG-9 must be absent too (F1: the epic is not also an issue)')
    assert.equal(listAllCalls.count, 0, 'a team-scoped read must use getProject, never the full listAllProjects walk')
  })

  // LIN-2011 re-review finding F3: a cross-project epic link (Jira permits
  // an issue's parent to live in a different project than the issue itself)
  // meant a team-scoped read's `issues` stamped a `project` id that had no
  // matching entry in the SAME read's `projects` array — `server.js`'s
  // `projects.map(p => forest.get(p.id) ...)` walk then silently dropped
  // that issue's whole forest group from the rendered dashboard. Proven here
  // by running the provider's real output through the SAME `buildForest` +
  // project-iteration server.js uses, not just inspecting the canonical shape.
  test('fetchProjects(scope, teamId) synthesizes a canonical project for a cross-project epic so the issue is not silently dropped from the rendered dashboard (F3)', async () => {
    const { provider: multi } = crossProjectEpicSeededProvider()
    const scope = { email: 'a@b.com', apiToken: 't', site: SITE }

    const result = await multi.fetchProjects(scope, 'ENG')
    const issue = result.issues.find(i => i.identifier === 'ENG-77')
    assert.ok(issue, 'the cross-project-epic issue must still be fetched')
    assert.deepEqual(issue.project, { id: '40002', name: 'Ops Epic' }, 'canonical project is unchanged — stamped straight off fields.parent')

    // The regression: a `projects` entry matching that id must ALSO exist,
    // or the issue's forest group is unreachable from the rendered trees.
    assert.ok(result.projects.some(p => p.id === '40002'), 'a synthesized canonical project must cover the out-of-batch epic')

    const forest = buildForest(result.issues)
    const trees = result.projects.map(project => forest.get(project.id) || { roots: [] })
    const rendered = trees.flatMap(({ roots }) => roots).map(node => node.issue.identifier)
    assert.ok(rendered.includes('ENG-77'), 'the issue must be reachable via server.js\'s own projects.map(forest.get) walk, not just present in the canonical issues array')
  })

  test('fetchProjects with no teamId still walks every project (unscoped, unchanged)', async () => {
    const { provider: multi } = multiTeamSeededProvider()
    const scope = { email: 'a@b.com', apiToken: 't', site: SITE }
    const result = await multi.fetchProjects(scope)
    // LIN-2011: each Jira project's OWN epic surfaces as its canonical
    // project — 30001 (ENG-9) and 40002 (OPS-9), not the Jira project ids.
    assert.deepEqual(result.projects.map(p => p.id).sort(), ['30001', '40002'])
    // F1: neither epic (ENG-9, OPS-9) is also an issue — each is a project header only.
    assert.deepEqual(result.issues.map(i => i.identifier).sort(), ['ENG-1', 'OPS-1'])
  })

  // LIN-2155: `_epicsForProjects` now issues UP TO FOUR distinct JQL calls
  // (in-progress, to-do, done, epics) rather than one — a stub that ignores
  // the `jql` argument and returns the same capped array unconditionally
  // would (a) make the in-progress tier see `.truncated: true` and throw
  // `JiraInProgressCapExceededError` (D7: an in-progress cap hit is
  // failure-level, not ordinary truncation) instead of exercising the
  // LOWER-tier truncation path this test means to cover, and (b) collapse
  // the four tiers' worth of "different JQL, different fixture" down to one
  // coincidentally-passing assertion. Routes explicitly by JQL instead.
  test('fetchProjects(scope, teamId) preserves the truncated flag (LIN-2006) on the SCOPED branch too — a LOWER tier (to-do) hitting its cap', async () => {
    const cappedTodoIssues = [{
      id: '1', key: 'ENG-1',
      fields: {
        summary: 'x', description: null, status: { statusCategory: { key: 'new' } },
        project: { id: '10001', key: 'ENG', name: 'Engineering' },
        created: '2026-01-01T00:00:00.000Z', duedate: null, resolutiondate: null, labels: [], assignee: null, parent: null,
      },
    }]
    cappedTodoIssues.truncated = true
    const stubClient = {
      getProject: async () => ({ id: '10001', key: 'ENG', name: 'Engineering' }),
      searchAllIssues: async jql => {
        if (jql.includes('statusCategory = "To Do"')) return cappedTodoIssues
        const empty = []
        empty.truncated = false
        return empty
      },
      listFields: async () => [],
    }
    const provider = new JiraProvider({ clientFactory: () => stubClient, site: SITE })
    const scope = { email: 'a@b.com', apiToken: 't', site: SITE }
    const result = await provider.fetchProjects(scope, 'ENG')
    assert.equal(result.truncated, true, 'a lower-tier (to-do) cap hit sets truncated: true, D7\'s "render partial" case')
    assert.equal(result.issues.length, 1, 'the in-progress guarantee still succeeded — the to-do issue rendered, not discarded')
  })

  test('fetchProjects reports truncated: false by default (LIN-2006)', async () => {
    const scope = { email: 'a@b.com', apiToken: 't', site: SITE }
    const result = await provider.fetchProjects(scope)
    assert.equal(result.truncated, false, 'the shared fake client never sets .truncated, so the untruncated path must coerce to false, not undefined')
  })

  // LIN-2155: routes by JQL (see the SCOPED-branch test above for why an
  // unconditional stub would false-pass this via the in-progress tier's
  // fail-whole path instead of the lower-tier truncation path it means to
  // cover) — this variant hits the cap on the unscoped (listAllProjects)
  // branch, mirroring the pre-LIN-2155 test's coverage of that branch.
  test('fetchProjects surfaces truncated: true when the client hit its search cap (LIN-2006)', async () => {
    // A dedicated stub, not the shared fake client (which never sets .truncated) —
    // mirrors the shape client.js's real searchAllIssues produces on a capped walk:
    // an array with a `.truncated` property attached.
    const cappedTodoIssues = [
      {
        id: '20001',
        key: 'ENG-1',
        fields: {
          summary: 'Parent story',
          description: null,
          status: { name: 'To Do', statusCategory: { key: 'new' } },
          project: { id: '10001', key: 'ENG', name: 'Engineering' },
          created: '2026-01-01T00:00:00.000Z',
          duedate: null,
          resolutiondate: null,
          labels: [],
          assignee: null,
          parent: null,
        },
      },
    ]
    cappedTodoIssues.truncated = true
    const stubClient = {
      listAllProjects: async () => [{ id: '10001', key: 'ENG', name: 'Engineering' }],
      searchAllIssues: async jql => {
        if (jql.includes('statusCategory = "To Do"')) return cappedTodoIssues
        const empty = []
        empty.truncated = false
        return empty
      },
      listFields: async () => [],
    }
    const provider = new JiraProvider({ clientFactory: () => stubClient, site: SITE })
    const scope = { email: 'a@b.com', apiToken: 't', site: SITE }
    const result = await provider.fetchProjects(scope)
    assert.equal(result.truncated, true, 'the .truncated flag must survive the canonical .map() mapping, not be silently dropped')
    assert.equal(result.issues.length, 1, 'the mapped issues themselves are unaffected by reading the flag first')
  })

  test('fetchIssueContext maps the issue, best-effort subtask children, and comments', async () => {
    const scope = { email: 'a@b.com', apiToken: 't', site: SITE }
    const ctx = await provider.fetchIssueContext(scope, 'ENG-1')
    assert.equal(ctx.issue.identifier, 'ENG-1')
    assert.equal(ctx.issue.description, 'A parent issue.')
    assert.equal(ctx.parent, null)
    assert.equal(ctx.children.length, 1)
    assert.equal(ctx.children[0].identifier, 'ENG-2')
    assert.equal(ctx.comments.length, 1)
    assert.equal(ctx.comments[0].body, 'First comment')
    assert.equal(ctx.comments[0].user, 'Ada Lovelace')
  })

  test('fetchIssueFields returns the same canonical shape fetchProjects emits per node (dashboard lazy detail load, LIN-442)', async () => {
    const scope = { email: 'a@b.com', apiToken: 't', site: SITE }
    const issue = await provider.fetchIssueFields(scope, 'ENG-2')
    assert.equal(issue.identifier, 'ENG-2')
    assert.equal(issue.source, SOURCE_JIRA)
    assert.equal(issue.state.type, 'completed')
    assert.equal(issue.url, `${SITE}/browse/ENG-2`)
  })

  test('fetchIssueFields throws a clean error for an unknown issue', async () => {
    const scope = { email: 'a@b.com', apiToken: 't', site: SITE }
    await assert.rejects(() => provider.fetchIssueFields(scope, 'ENG-999'), /Issue not found/)
  })

  test('fetchIssueContext throws a clean error for an unknown issue', async () => {
    const scope = { email: 'a@b.com', apiToken: 't', site: SITE }
    await assert.rejects(() => provider.fetchIssueContext(scope, 'ENG-999'), /Issue not found/)
  })

  // LIN-1910: fetchRecommendationContext — mirrors localProvider's tests
  // (tests/unit/local-provider.test.js:160-182).
  describe('fetchRecommendationContext (LIN-1910)', () => {
    const scope = { email: 'a@b.com', apiToken: 't', site: SITE }

    test('a leaf task returns its context as-is, no focusedChild', async () => {
      const ctx = await provider.fetchRecommendationContext(scope, 'ENG-2')
      assert.equal(ctx.issue.identifier, 'ENG-2')
      assert.equal(ctx.children.length, 0)
      assert.equal(ctx.focusedChild, undefined)
    })

    // ENG-1's only seeded child, ENG-2, is Done (terminal) — selectFocusSubtask
    // filters terminal children out, so this exercises the "all children
    // terminal" branch (children still reported, but nothing to descend into).
    test('a parent whose only child is terminal gets no focusedChild', async () => {
      const ctx = await provider.fetchRecommendationContext(scope, 'ENG-1')
      assert.equal(ctx.issue.identifier, 'ENG-1')
      assert.equal(ctx.children.length, 1, 'ENG-2 is still reported as a child')
      assert.equal(ctx.focusedChild, undefined, 'ENG-2 is Done — nothing eligible for selectFocusSubtask to pick')
    })

    // Shared by the two tests below: a parent (ENG-90) with a genuinely open
    // (non-terminal) child (ENG-91), so noDescend has something real to suppress.
    function createOpenChildProvider() {
      const client = createFakeJiraClient({
        projects: [{ id: '10001', key: 'ENG', name: 'Engineering' }],
        projectStatuses: { ENG: ENG_PROJECT_STATUSES },
        issues: [
          {
            id: '90001', key: 'ENG-90',
            fields: {
              summary: 'Parent with an open child', description: null,
              status: { id: '12', name: 'In Progress', statusCategory: { key: 'indeterminate' } },
              project: { id: '10001', key: 'ENG', name: 'Engineering' },
              created: '2026-02-01T00:00:00.000Z', duedate: null, resolutiondate: null,
              labels: [], assignee: null, parent: null,
            },
          },
          {
            id: '90002', key: 'ENG-91',
            fields: {
              summary: 'Open subtask', description: null,
              status: { id: '11', name: 'To Do', statusCategory: { key: 'new' } },
              project: { id: '10001', key: 'ENG', name: 'Engineering' },
              created: '2026-02-02T00:00:00.000Z', duedate: null, resolutiondate: null,
              labels: [], assignee: null, parent: { id: '90001', key: 'ENG-90' },
            },
          },
        ],
      })
      return new JiraProvider({ clientFactory: () => client, site: SITE })
    }

    test('a parent with a non-terminal child attaches focusedChild via the shared selectFocusSubtask picker', async () => {
      const p = createOpenChildProvider()
      const ctx = await p.fetchRecommendationContext(scope, 'ENG-90')
      assert.equal(ctx.children.length, 1)
      assert.ok(ctx.focusedChild, 'the open (non-terminal) child must be attached')
      assert.equal(ctx.focusedChild.issue.identifier, 'ENG-91')
    })

    // Regression (LIN-1910 review F2): the original version of this test ran
    // against ENG-1, whose only child (ENG-2) is already Done — the preceding
    // "terminal child" test proves that fixture yields no focusedChild even
    // WITHOUT noDescend, so the assertion passed whether or not the noDescend
    // branch existed (confirmed by mutation: deleting `noDescend ||` from the
    // implementation left this test green). ENG-90/ENG-91 has a genuinely open
    // child, so this now actually exercises noDescend suppressing the descent
    // that the test directly above proves would otherwise happen.
    test('noDescend frames a parent as a leaf — no focusedChild even with a live child', async () => {
      const p = createOpenChildProvider()
      const ctx = await p.fetchRecommendationContext(scope, 'ENG-90', { noDescend: true })
      assert.equal(ctx.children.length, 1, 'children are still reported')
      assert.equal(ctx.focusedChild, undefined, 'but no descent happens')
    })

    test('a missing issue rejects, same as fetchIssueContext', async () => {
      await assert.rejects(() => provider.fetchRecommendationContext(scope, 'ENG-999'), /Issue not found/)
    })
  })

  test('fetchIssueComments returns [] for an issue with no comments, oldest-first when present', async () => {
    const scope = { email: 'a@b.com', apiToken: 't', site: SITE }
    assert.deepEqual(await provider.fetchIssueComments(scope, 'ENG-2'), [])
    const comments = await provider.fetchIssueComments(scope, 'ENG-1')
    assert.equal(comments.length, 1)
  })

  // Regression: routes/workspace-api.js's GET /api/comments/:issueId calls
  // fetchIssueComments(scope, issue.id) — the canonical IMMUTABLE id (LIN-1885's
  // own "id is the opaque identity, key is human-readable only" rule) — never
  // the key. An earlier fake-client draft indexed comments by key ONLY, so this
  // real call shape returned [] against a genuinely-commented issue while every
  // OTHER test here (which always passed the key) stayed green. Caught while
  // building the beat 4 E2E spec, fixed in fake-client.js's commentsByIssue index.
  test('fetchIssueComments works when called with the canonical id, not just the key (real call shape)', async () => {
    const scope = { email: 'a@b.com', apiToken: 't', site: SITE }
    const comments = await provider.fetchIssueComments(scope, '20001') // ENG-1's immutable id
    assert.equal(comments.length, 1)
    assert.equal(comments[0].body, 'First comment')
  })

  test('createIssue stays unimplemented (deferred behind LIN-1557) — still throws NotImplementedError', () => {
    assert.throws(() => provider.createIssue({}, {}), NotImplementedError)
  })

  test('fetchProjectsList returns the same canonical projects fetchProjects emits (LIN-1886 Step 2; LIN-2011 epic-derived)', async () => {
    const scope = { email: 'a@b.com', apiToken: 't', site: SITE }
    const projects = await provider.fetchProjectsList(scope)
    assert.equal(projects.length, 1)
    assert.equal(projects[0].id, '30001')
    assert.equal(projects[0].url, `${SITE}/browse/ENG-9`)
  })
})

// =============================================================================
// LIN-2155 — tiered Jira fetch (in-progress guaranteed, to-do/done/epics
// budgeted), the inverse status mapping that drives it, and the fake
// client's matching JQL-clause coverage
// =============================================================================

describe('CANONICAL_TYPE_TO_JIRA_STATUS_CATEGORY / jiraReachableTierOrder (LIN-2155)', () => {
  test('the inverse map carries exactly the three types Jira can reach', () => {
    assert.deepEqual(CANONICAL_TYPE_TO_JIRA_STATUS_CATEGORY, {
      started: 'In Progress',
      unstarted: 'To Do',
      completed: 'Done',
    })
  })

  test('jiraReachableTierOrder() returns the canonical STATE_ORDER-driven sequence, filtered to Jira-reachable types', () => {
    assert.deepEqual(jiraReachableTierOrder(), ['started', 'unstarted', 'completed'])
  })
})

describe('JiraProvider — tiered fetch (LIN-2155)', () => {
  const scope = { email: 'a@b.com', apiToken: 't', site: SITE }

  // The research's own repro, rebuilt against the real _epicsForProjects
  // path (via fetchProjects) with a JQL-routing fake client: a 3,000-issue
  // project where the 40 in-progress issues carry the NEWEST keys — exactly
  // the shape that starved the old `ORDER BY key ASC` capped walk (0 of 40
  // fetched). This is the ticket's own named acceptance test.
  test('reproduction: a 3,000-issue project with 40 in-progress issues fetches all 40 (0 → 40), not the oldest 500 by key', async () => {
    const projectRef = { id: '10001', key: 'BIG', name: 'Big Project' }
    const issues = []
    for (let i = 1; i <= 2960; i++) {
      issues.push({
        id: String(1000 + i),
        key: `BIG-${i}`,
        fields: {
          summary: `Backlog item ${i}`, description: null,
          status: { statusCategory: { key: 'new' } },
          project: projectRef,
          created: '2026-01-01T00:00:00.000Z', duedate: null, resolutiondate: null,
          labels: [], assignee: null, parent: null,
        },
      })
    }
    for (let i = 1; i <= 40; i++) {
      const n = 2960 + i
      issues.push({
        id: String(1000 + n),
        key: `BIG-${n}`,
        fields: {
          summary: `In progress ${i}`, description: null,
          status: { statusCategory: { key: 'indeterminate' } },
          project: projectRef,
          created: '2026-08-01T00:00:00.000Z', duedate: null, resolutiondate: null,
          labels: [], assignee: null, parent: null,
        },
      })
    }
    const client = createFakeJiraClient({ projects: [projectRef], issues })
    const provider = new JiraProvider({ clientFactory: () => client, site: SITE })

    const result = await provider.fetchProjects(scope)
    const inProgressFetched = result.issues.filter(i => i.state.type === 'started')
    assert.equal(inProgressFetched.length, 40, 'every in-progress issue is fetched at any project size — the LIN-2155 guarantee')
    assert.equal(result.truncated, true, 'the to-do tier still hits its own budget cap on a project this size — by design, not a regression')
  })

  // Tier overlap is real, not hypothetical: an epic whose own status is
  // In Progress matches both the in-progress tier's JQL and the epics
  // tier's `issuetype = Epic` JQL. If dedupe-by-id failed, the epic would
  // appear twice in the merged batch and double-render as two project
  // headers.
  test('dedup across tiers: an epic whose own status is In Progress is fetched by both the in-progress and epics tiers but surfaces once', async () => {
    const client = createFakeJiraClient({
      projects: [{ id: '10001', key: 'ENG', name: 'Engineering' }],
      issues: [
        {
          id: '90001', key: 'ENG-90',
          fields: {
            summary: 'An epic that is itself in progress', description: null,
            issuetype: EPIC_ISSUETYPE,
            status: { statusCategory: { key: 'indeterminate' } },
            project: { id: '10001', key: 'ENG', name: 'Engineering' },
            created: '2026-01-01T00:00:00.000Z', duedate: null, resolutiondate: null,
            labels: [], assignee: null, parent: null,
          },
        },
      ],
    })
    const provider = new JiraProvider({ clientFactory: () => client, site: SITE })
    const result = await provider.fetchProjects(scope)
    assert.equal(result.projects.length, 1, 'the epic surfaces exactly once as a canonical project header, not once per tier that fetched it')
    assert.equal(result.projects[0].id, '90001')
    assert.equal(result.issues.length, 0, 'an epic is excluded from canonical issues (F1) regardless of how many tiers fetched it')
  })

  // D7 partial-failure semantics.
  test('D7: an in-progress tier failure (throw) rejects the whole render, never partial', async () => {
    const stubClient = {
      listAllProjects: async () => [{ id: '10001', key: 'ENG', name: 'Engineering' }],
      searchAllIssues: async jql => {
        if (jql.includes('statusCategory = "In Progress"')) throw new Error('in-progress tier boom')
        const empty = []; empty.truncated = false; return empty
      },
      listFields: async () => [],
    }
    const provider = new JiraProvider({ clientFactory: () => stubClient, site: SITE })
    await assert.rejects(() => provider.fetchProjects(scope), /in-progress tier boom/)
  })

  test('D7: an in-progress tier hitting its own safety cap is failure-level, not ordinary truncation', async () => {
    const cappedInProgress = [{
      id: '1', key: 'ENG-1',
      fields: {
        summary: 'x', description: null, status: { statusCategory: { key: 'indeterminate' } },
        project: { id: '10001', key: 'ENG', name: 'Engineering' },
        created: '2026-01-01T00:00:00.000Z', duedate: null, resolutiondate: null, labels: [], assignee: null, parent: null,
      },
    }]
    cappedInProgress.truncated = true
    const stubClient = {
      listAllProjects: async () => [{ id: '10001', key: 'ENG', name: 'Engineering' }],
      searchAllIssues: async jql => {
        if (jql.includes('statusCategory = "In Progress"')) return cappedInProgress
        const empty = []; empty.truncated = false; return empty
      },
      listFields: async () => [],
    }
    const provider = new JiraProvider({ clientFactory: () => stubClient, site: SITE })
    await assert.rejects(() => provider.fetchProjects(scope), JiraInProgressCapExceededError)
  })

  for (const [tierLabel, categoryClause] of [['to-do', 'statusCategory = "To Do"'], ['done', 'statusCategory = "Done"']]) {
    test(`D7: a ${tierLabel} tier failure renders partial data with truncated: true, keeping the good in-progress result`, async () => {
      const inProgressIssues = [{
        id: '20001', key: 'ENG-1',
        fields: {
          summary: 'In progress', description: null,
          status: { statusCategory: { key: 'indeterminate' } },
          project: { id: '10001', key: 'ENG', name: 'Engineering' },
          created: '2026-01-01T00:00:00.000Z', duedate: null, resolutiondate: null,
          labels: [], assignee: null, parent: null,
        },
      }]
      inProgressIssues.truncated = false
      const stubClient = {
        listAllProjects: async () => [{ id: '10001', key: 'ENG', name: 'Engineering' }],
        searchAllIssues: async jql => {
          if (jql.includes('statusCategory = "In Progress"')) return inProgressIssues
          if (jql.includes(categoryClause)) throw new Error(`${tierLabel} tier boom`)
          const empty = []; empty.truncated = false; return empty
        },
        listFields: async () => [],
      }
      const provider = new JiraProvider({ clientFactory: () => stubClient, site: SITE })
      const result = await provider.fetchProjects(scope)
      assert.equal(result.truncated, true, `a ${tierLabel} tier failure must not discard the good in-progress result — it must set truncated instead`)
      assert.equal(result.issues.length, 1, 'the in-progress issue still renders')
      assert.equal(result.issues[0].identifier, 'ENG-1')
    })
  }

  // Cross-cutting consequence of D7 (named in the plan, not silently
  // assumed): project-header derivation depends on the epics tier arriving
  // — when it fails, headers regress to whatever epics rode the OTHER
  // tiers (partial, not absent), never to nothing.
  test('D7: an epics-tier failure renders partial — an epic also reachable via another tier still produces its project header', async () => {
    const inProgressEpic = [{
      id: '90001', key: 'ENG-90',
      fields: {
        summary: 'In-progress epic', description: null, issuetype: EPIC_ISSUETYPE,
        status: { statusCategory: { key: 'indeterminate' } },
        project: { id: '10001', key: 'ENG', name: 'Engineering' },
        created: '2026-01-01T00:00:00.000Z', duedate: null, resolutiondate: null,
        labels: [], assignee: null, parent: null,
      },
    }]
    inProgressEpic.truncated = false
    const stubClient = {
      listAllProjects: async () => [{ id: '10001', key: 'ENG', name: 'Engineering' }],
      searchAllIssues: async jql => {
        if (jql.includes('statusCategory = "In Progress"')) return inProgressEpic
        if (jql.includes('issuetype = Epic')) throw new Error('epics tier boom')
        const empty = []; empty.truncated = false; return empty
      },
      listFields: async () => [],
    }
    const provider = new JiraProvider({ clientFactory: () => stubClient, site: SITE })
    const result = await provider.fetchProjects(scope)
    assert.equal(result.truncated, true, 'the epics-tier failure sets truncated: true (D7 partial render)')
    assert.equal(result.projects.length, 1, 'the in-progress epic still derives its project header even though the dedicated epics pass failed')
    assert.equal(result.projects[0].id, '90001')
  })

  // Mirrors the existing LIN-2006/LIN-2033 `truncated`-preservation pattern
  // (see the fetchTeams/fetchProjects tests above): `.truncated` is a custom
  // array property that `.filter()`/`.map()` silently drop on a fresh array
  // — this pins that the OR reads every raw tier BEFORE any such
  // transformation, regardless of WHICH tier carried the flag.
  test('truncated is a boolean OR across every raw tier array, not just the first one checked', async () => {
    for (const targetClause of ['statusCategory = "Done"', 'issuetype = Epic']) {
      const cappedIssues = []
      cappedIssues.truncated = true
      const stubClient = {
        listAllProjects: async () => [{ id: '10001', key: 'ENG', name: 'Engineering' }],
        searchAllIssues: async jql => {
          if (jql.includes(targetClause)) return cappedIssues
          const empty = []; empty.truncated = false; return empty
        },
        listFields: async () => [],
      }
      const provider = new JiraProvider({ clientFactory: () => stubClient, site: SITE })
      const result = await provider.fetchProjects(scope)
      assert.equal(result.truncated, true, `a truncated tier behind clause "${targetClause}" must still surface truncated: true`)
    }
  })

  // LIN-2158 regression guard (a) — behavioural. The done tier used to be
  // windowed to `resolutiondate >= -7d`, which silently excluded (1) Done
  // issues resolved more than 7 days ago and (2) Done-category issues with
  // no resolutiondate at all (status category and resolution are
  // independent in Jira). Both classes must now be fetched. The ancient
  // date is a FIXED literal, not `Date.now()`-relative — a relative date
  // would silently re-acquire the exact drift this ticket exists to undo.
  test('LIN-2158: an ancient-fixed-date Done issue and a null-resolutiondate Done issue are both fetched, truncated: false', async () => {
    const client = createFakeJiraClient({
      projects: [{ id: '10001', key: 'ENG', name: 'Engineering' }],
      issues: [
        {
          id: '1', key: 'ENG-1',
          fields: {
            summary: 'Ancient done issue', description: null,
            status: { statusCategory: { key: 'done' } },
            project: { id: '10001', key: 'ENG', name: 'Engineering' },
            created: '2020-01-01T00:00:00.000Z', duedate: null, resolutiondate: '2020-01-01T00:00:00.000Z',
            labels: [], assignee: null, parent: null,
          },
        },
        {
          id: '2', key: 'ENG-2',
          fields: {
            summary: 'Done with no resolution date', description: null,
            status: { statusCategory: { key: 'done' } },
            project: { id: '10001', key: 'ENG', name: 'Engineering' },
            created: '2026-01-01T00:00:00.000Z', duedate: null, resolutiondate: null,
            labels: [], assignee: null, parent: null,
          },
        },
      ],
    })
    const provider = new JiraProvider({ clientFactory: () => client, site: SITE })
    const result = await provider.fetchProjects(scope)
    const ancient = result.issues.find(i => i.identifier === 'ENG-1')
    const nullResolution = result.issues.find(i => i.identifier === 'ENG-2')
    assert.ok(ancient, 'a Done issue resolved years ago must still be fetched — the window that used to exclude it is gone')
    assert.equal(ancient.state.type, 'completed')
    assert.ok(nullResolution, 'a Done-category issue with no resolutiondate at all must be fetched — no predicate can exclude it')
    assert.equal(nullResolution.state.type, 'completed')
    assert.equal(result.truncated, false)
  })

  // LIN-2158 regression guard (b) — structural. (a) alone doesn't prove
  // *why* it passes; (b) alone would pass a window re-added under a
  // different field/mechanism. Both are required together.
  test('LIN-2158: the done tier\'s emitted JQL carries no resolutiondate clause', async () => {
    let doneJql = null
    const stubClient = {
      listAllProjects: async () => [{ id: '10001', key: 'ENG', name: 'Engineering' }],
      searchAllIssues: async jql => {
        if (jql.includes('statusCategory = "Done"')) doneJql = jql
        const empty = []; empty.truncated = false; return empty
      },
      listFields: async () => [],
    }
    const provider = new JiraProvider({ clientFactory: () => stubClient, site: SITE })
    await provider.fetchProjects(scope)
    assert.ok(doneJql, 'the done tier must have been queried')
    assert.ok(!doneJql.includes('resolutiondate'), `done tier JQL must carry no resolutiondate clause, got: ${doneJql}`)
  })
})

describe('fake-client.js — LIN-2155 JQL clause coverage', () => {
  function tieredClient() {
    return createFakeJiraClient({
      projects: [{ id: '10001', key: 'ENG', name: 'Engineering' }],
      issues: [
        { id: '1', key: 'ENG-1', fields: { project: { key: 'ENG' }, status: { statusCategory: { key: 'indeterminate' } }, updated: '2026-01-05T00:00:00.000Z', resolutiondate: null } },
        { id: '2', key: 'ENG-2', fields: { project: { key: 'ENG' }, status: { statusCategory: { key: 'new' } }, updated: '2026-01-10T00:00:00.000Z', resolutiondate: null } },
        { id: '3', key: 'ENG-3', fields: { project: { key: 'ENG' }, status: { statusCategory: { key: 'new' } }, updated: '2026-01-01T00:00:00.000Z', resolutiondate: null } },
        { id: '4', key: 'ENG-4', fields: { project: { key: 'ENG' }, issuetype: EPIC_ISSUETYPE, status: { statusCategory: { key: 'done' } }, resolutiondate: null } },
        { id: '5', key: 'ENG-5', fields: { project: { key: 'ENG' }, status: { statusCategory: { key: 'done' } } } },
        { id: '6', key: 'ENG-6', fields: { project: { key: 'ENG' }, status: { statusCategory: { key: 'done' } }, resolutiondate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString() } },
      ],
    })
  }

  test('statusCategory = "In Progress" matches only the indeterminate-category issue', async () => {
    const out = await tieredClient().searchAllIssues('project in ("ENG") AND statusCategory = "In Progress" ORDER BY key ASC')
    assert.deepEqual(out.map(i => i.key), ['ENG-1'])
  })

  test('issuetype = Epic matches only the epic issue', async () => {
    const out = await tieredClient().searchAllIssues('project in ("ENG") AND issuetype = Epic ORDER BY key ASC')
    assert.deepEqual(out.map(i => i.key), ['ENG-4'])
  })

  test('ORDER BY updated DESC, key ASC sorts newest-touched first', async () => {
    const out = await tieredClient().searchAllIssues('project in ("ENG") AND statusCategory = "To Do" ORDER BY updated DESC, key ASC')
    assert.deepEqual(out.map(i => i.key), ['ENG-2', 'ENG-3'])
  })

  test('a cap truncates and stamps .truncated; an omitted cap returns every match unbounded', async () => {
    const capped = await tieredClient().searchAllIssues('project in ("ENG") AND statusCategory = "To Do" ORDER BY key ASC', { cap: 1 })
    assert.equal(capped.length, 1)
    assert.equal(capped.truncated, true)
    const uncapped = await tieredClient().searchAllIssues('project in ("ENG") AND statusCategory = "To Do" ORDER BY key ASC')
    assert.equal(uncapped.length, 2)
    assert.equal(uncapped.truncated, false)
  })

  test('an unrecognized JQL clause throws rather than silently matching everything (LIN-2050)', async () => {
    await assert.rejects(
      () => tieredClient().searchAllIssues('project in ("ENG") AND priority = "High" ORDER BY key ASC'),
      /unrecognized JQL clause/,
    )
  })
})

// =============================================================================
// LIN-2011 — epic-vs-subtask parent detection + company-managed legacy
// "Epic Link" custom-field discovery
// =============================================================================

describe('isEpicParent (LIN-2011)', () => {
  test('true when hierarchyLevel === 1', () => {
    assert.equal(isEpicParent({ fields: { issuetype: { hierarchyLevel: 1, name: 'Epic' } } }), true)
  })

  test('false when hierarchyLevel is present and not 1 — the value wins over the name fallback', () => {
    assert.equal(isEpicParent({ fields: { issuetype: { hierarchyLevel: 0, name: 'Epic' } } }), false)
  })

  test('falls back to issuetype.name === "Epic" only when hierarchyLevel is absent', () => {
    assert.equal(isEpicParent({ fields: { issuetype: { name: 'Epic' } } }), true)
    assert.equal(isEpicParent({ fields: { issuetype: { name: 'Story' } } }), false)
  })

  test('degrades to false on missing/malformed input — never throws', () => {
    assert.equal(isEpicParent(null), false)
    assert.equal(isEpicParent(undefined), false)
    assert.equal(isEpicParent({}), false)
    assert.equal(isEpicParent({ fields: null }), false)
    assert.equal(isEpicParent({ fields: {} }), false)
    assert.equal(isEpicParent({ fields: { issuetype: null } }), false)
    assert.equal(isEpicParent({ fields: { issuetype: 'Epic' } }), false, 'a string issuetype (malformed) is not an object')
  })

  test('JIRA_ISSUE_FIELDS requests issuetype — the signal a top-level issue\'s own epic-ness needs (fetchProjects\' epic filter)', () => {
    assert.ok(JIRA_ISSUE_FIELDS.includes('issuetype'))
  })
})

describe('JiraProvider — company-managed legacy "Epic Link" resolution (LIN-2011 Surface D)', () => {
  const EPIC_LINK_FIELD = { id: 'customfield_10014', name: 'Epic Link', schema: { custom: 'com.pyxis.greenhopper.jira:gh-epic-link' } }

  function companyManagedClient(extraIssues = []) {
    return createFakeJiraClient({
      projects: [{ id: '50001', key: 'CMP', name: 'Company' }],
      fields: [EPIC_LINK_FIELD],
      issues: [
        {
          id: '60001', key: 'CMP-1',
          fields: {
            summary: 'Company Epic', description: null, issuetype: EPIC_ISSUETYPE,
            status: { statusCategory: { key: 'new' } },
            project: { id: '50001', key: 'CMP', name: 'Company' },
            created: '2026-02-01T00:00:00.000Z', duedate: null, resolutiondate: null,
            labels: [], assignee: null, parent: null,
          },
        },
        {
          id: '60002', key: 'CMP-2',
          fields: {
            summary: 'Story under the legacy epic link', description: null,
            status: { statusCategory: { key: 'new' } },
            project: { id: '50001', key: 'CMP', name: 'Company' },
            created: '2026-02-02T00:00:00.000Z', duedate: null, resolutiondate: null,
            labels: [], assignee: null, parent: null,
            customfield_10014: 'CMP-1',
          },
        },
        ...extraIssues,
      ],
    })
  }

  test('fetchProjects (batch): resolves via listFields() discovery + a same-batch epic map, with no extra HTTP call per issue', async () => {
    const client = companyManagedClient()
    const listFieldsCalls = { count: 0 }
    const originalListFields = client.listFields.bind(client)
    client.listFields = async (...args) => { listFieldsCalls.count += 1; return originalListFields(...args) }
    const provider = new JiraProvider({ clientFactory: () => client, site: SITE })
    const scope = { email: 'a@b.com', apiToken: 't', site: SITE }

    const result = await provider.fetchProjects(scope)
    assert.equal(listFieldsCalls.count, 1, 'field discovery happens once per fetchProjects call, not once per issue')
    assert.equal(result.projects.length, 1)
    assert.equal(result.projects[0].id, '60001')
    const story = result.issues.find(i => i.identifier === 'CMP-2')
    assert.deepEqual(story.project, { id: '60001', name: 'Company Epic' })
    assert.equal(story.parent, null)
  })

  test('field discovered but unset on a given issue → project: null, no crash', async () => {
    const client = companyManagedClient([{
      id: '60003', key: 'CMP-3',
      fields: {
        summary: 'Story with no epic link at all', description: null,
        status: { statusCategory: { key: 'new' } },
        project: { id: '50001', key: 'CMP', name: 'Company' },
        created: '2026-02-03T00:00:00.000Z', duedate: null, resolutiondate: null,
        labels: [], assignee: null, parent: null,
      },
    }])
    const provider = new JiraProvider({ clientFactory: () => client, site: SITE })
    const scope = { email: 'a@b.com', apiToken: 't', site: SITE }
    const result = await provider.fetchProjects(scope)
    const bare = result.issues.find(i => i.identifier === 'CMP-3')
    assert.equal(bare.project, null)
  })

  test('listFields() returns no Epic Link field at all → unchanged pre-ticket behavior, no extra per-issue request attempted', async () => {
    const client = createFakeJiraClient({
      projects: [{ id: '50001', key: 'CMP', name: 'Company' }],
      issues: [{
        id: '60002', key: 'CMP-2',
        fields: {
          summary: 'Story with no native parent, no legacy field on this tenant', description: null,
          status: { statusCategory: { key: 'new' } },
          project: { id: '50001', key: 'CMP', name: 'Company' },
          created: '2026-02-02T00:00:00.000Z', duedate: null, resolutiondate: null,
          labels: [], assignee: null, parent: null,
        },
      }],
    })
    const provider = new JiraProvider({ clientFactory: () => client, site: SITE })
    const scope = { email: 'a@b.com', apiToken: 't', site: SITE }
    const result = await provider.fetchProjects(scope)
    assert.equal(result.issues[0].project, null)
  })

  // LIN-2011 review L3: the legacy Epic Link field's VALUE was assumed to
  // always be a bare issue-key string. A re-review measured it silently
  // failing to resolve (no crash, but no grouping either) for an
  // object-shaped or bare-numeric value — normalizeEpicLinkValue closes
  // that gap for the four observed shapes, exercised here through both
  // resolution paths (batch + single-issue).
  describe('legacy Epic Link value normalization (LIN-2011 review L3)', () => {
    test('bare key string (the common case) resolves — regression', async () => {
      const client = companyManagedClient()
      const provider = new JiraProvider({ clientFactory: () => client, site: SITE })
      const scope = { email: 'a@b.com', apiToken: 't', site: SITE }
      const result = await provider.fetchProjects(scope)
      assert.deepEqual(result.issues.find(i => i.identifier === 'CMP-2').project, { id: '60001', name: 'Company Epic' })
    })

    test('bare id string (the epic\'s numeric id, not its key) resolves via epicByKey\'s id index', async () => {
      const client = companyManagedClient([{
        id: '60004', key: 'CMP-4',
        fields: {
          summary: 'Story linked by the epic\'s numeric id', description: null,
          status: { statusCategory: { key: 'new' } },
          project: { id: '50001', key: 'CMP', name: 'Company' },
          created: '2026-02-04T00:00:00.000Z', duedate: null, resolutiondate: null,
          labels: [], assignee: null, parent: null,
          customfield_10014: '60001',
        },
      }])
      const provider = new JiraProvider({ clientFactory: () => client, site: SITE })
      const scope = { email: 'a@b.com', apiToken: 't', site: SITE }
      const result = await provider.fetchProjects(scope)
      assert.deepEqual(result.issues.find(i => i.identifier === 'CMP-4').project, { id: '60001', name: 'Company Epic' })
    })

    test('object shape ({key}) normalizes to the bare key — previously silent null', async () => {
      const client = companyManagedClient([{
        id: '60005', key: 'CMP-5',
        fields: {
          summary: 'Story with an object-shaped legacy epic link', description: null,
          status: { statusCategory: { key: 'new' } },
          project: { id: '50001', key: 'CMP', name: 'Company' },
          created: '2026-02-05T00:00:00.000Z', duedate: null, resolutiondate: null,
          labels: [], assignee: null, parent: null,
          customfield_10014: { key: 'CMP-1' },
        },
      }])
      const provider = new JiraProvider({ clientFactory: () => client, site: SITE })
      const scope = { email: 'a@b.com', apiToken: 't', site: SITE }
      const result = await provider.fetchProjects(scope)
      assert.deepEqual(result.issues.find(i => i.identifier === 'CMP-5').project, { id: '60001', name: 'Company Epic' })
    })

    test('bare numeric value normalizes to its string form — previously silent null', async () => {
      const client = companyManagedClient([{
        id: '60006', key: 'CMP-6',
        fields: {
          summary: 'Story with a numeric legacy epic link', description: null,
          status: { statusCategory: { key: 'new' } },
          project: { id: '50001', key: 'CMP', name: 'Company' },
          created: '2026-02-06T00:00:00.000Z', duedate: null, resolutiondate: null,
          labels: [], assignee: null, parent: null,
          customfield_10014: 60001,
        },
      }])
      const provider = new JiraProvider({ clientFactory: () => client, site: SITE })
      const scope = { email: 'a@b.com', apiToken: 't', site: SITE }
      const result = await provider.fetchProjects(scope)
      assert.deepEqual(result.issues.find(i => i.identifier === 'CMP-6').project, { id: '60001', name: 'Company Epic' })
    })

    test('an unsupported shape (array) degrades to project: null — never throws', async () => {
      const client = companyManagedClient([{
        id: '60007', key: 'CMP-7',
        fields: {
          summary: 'Story with an unsupported legacy epic link shape', description: null,
          status: { statusCategory: { key: 'new' } },
          project: { id: '50001', key: 'CMP', name: 'Company' },
          created: '2026-02-07T00:00:00.000Z', duedate: null, resolutiondate: null,
          labels: [], assignee: null, parent: null,
          customfield_10014: ['CMP-1'],
        },
      }])
      const provider = new JiraProvider({ clientFactory: () => client, site: SITE })
      const scope = { email: 'a@b.com', apiToken: 't', site: SITE }
      const result = await provider.fetchProjects(scope)
      assert.equal(result.issues.find(i => i.identifier === 'CMP-7').project, null)
    })

    test('the single-issue fallback path (_resolveLegacyEpicContext) also normalizes an object-shaped value', async () => {
      const client = companyManagedClient([{
        id: '60008', key: 'CMP-8',
        fields: {
          summary: 'Story with an object-shaped legacy epic link', description: null,
          status: { statusCategory: { key: 'new' } },
          project: { id: '50001', key: 'CMP', name: 'Company' },
          created: '2026-02-08T00:00:00.000Z', duedate: null, resolutiondate: null,
          labels: [], assignee: null, parent: null,
          customfield_10014: { key: 'CMP-1' },
        },
      }])
      const provider = new JiraProvider({ clientFactory: () => client, site: SITE })
      const scope = { email: 'a@b.com', apiToken: 't', site: SITE }
      const issue = await provider.fetchIssueFields(scope, 'CMP-8')
      assert.deepEqual(issue.project, { id: '60001', name: 'Company Epic' })
    })
  })

  test('fetchIssueFields (single-issue): resolves via ONE bounded getIssue(epicKey) call, only on the no-native-parent fallback path', async () => {
    const client = companyManagedClient()
    const getIssueCalls = { count: 0 }
    const originalGetIssue = client.getIssue.bind(client)
    client.getIssue = async (...args) => { getIssueCalls.count += 1; return originalGetIssue(...args) }
    const provider = new JiraProvider({ clientFactory: () => client, site: SITE })
    const scope = { email: 'a@b.com', apiToken: 't', site: SITE }

    const issue = await provider.fetchIssueFields(scope, 'CMP-2')
    assert.deepEqual(issue.project, { id: '60001', name: 'Company Epic' })
    assert.equal(getIssueCalls.count, 2, 'one for the primary issue, one bounded fallback call for the epic')

    getIssueCalls.count = 0
    // The epic itself has no legacy field value (it isn't itself epic-linked) —
    // the fallback must not fire a second time when there is nothing to resolve.
    await provider.fetchIssueFields(scope, 'CMP-1')
    assert.equal(getIssueCalls.count, 1, 'no legacy field value on this issue -> no fallback call')
  })

  test('a native-parent single-issue read never calls listFields() — legacy discovery is skipped entirely when unnecessary', async () => {
    const { provider, client } = seededProvider()
    const listFieldsCalls = { count: 0 }
    const original = client.listFields.bind(client)
    client.listFields = async (...args) => { listFieldsCalls.count += 1; return original(...args) }
    const scope = { email: 'a@b.com', apiToken: 't', site: SITE }
    await provider.fetchIssueFields(scope, 'ENG-2') // native subtask parent (ENG-1) — no legacy fallback needed
    assert.equal(listFieldsCalls.count, 0)
  })

  // LIN-2011 review finding F2: fetchIssueContext used to call
  // _resolveEpicLinkFieldId unconditionally but never threaded epicByKey
  // through to _toCanonicalIssue, so the legacy resolution could never
  // actually resolve — a dead branch that still paid for a listFields()
  // round trip on every detail read. Fixed by removing the call entirely
  // (children are native subtasks, which cannot carry a legacy Epic Link).
  test('fetchIssueContext never calls listFields() — the legacy Epic Link path was dead code (F2)', async () => {
    const client = companyManagedClient()
    const listFieldsCalls = { count: 0 }
    const original = client.listFields.bind(client)
    client.listFields = async (...args) => { listFieldsCalls.count += 1; return original(...args) }
    const provider = new JiraProvider({ clientFactory: () => client, site: SITE })
    const scope = { email: 'a@b.com', apiToken: 't', site: SITE }

    await provider.fetchIssueContext(scope, 'CMP-1')
    assert.equal(listFieldsCalls.count, 0, 'fetchIssueContext must not pay for legacy Epic Link discovery on any read')
  })
})

// =============================================================================
// Step 2 — states()/labels()/route-internal reads (LIN-1886; LIN-2018 remap)
// =============================================================================

describe('JiraProvider Step 2 reads (fake client)', () => {
  let provider

  beforeEach(() => {
    ({ provider } = seededProvider())
  })

  test('states() with no teamId degrades to [] rather than throwing (LIN-2018) — states are per-project now, there is no team-less answer', async () => {
    const scope = { email: 'a@b.com', apiToken: 't', site: SITE }
    assert.deepEqual(await provider.states(scope, null), [])
    assert.deepEqual(await provider.states(scope), [])
  })

  test('states(scope, teamId) returns the REAL per-project statuses, never the old synthetic todo/in-progress/done vocabulary (LIN-2018)', async () => {
    const scope = { email: 'a@b.com', apiToken: 't', site: SITE }
    const states = await provider.states(scope, 'ENG')
    const names = states.map(s => s.name).sort()
    assert.deepEqual(names, ['Done', 'In Progress', 'Ready for QA', 'To Do', "Won't Do"])
    assert.ok(states.some(s => s.name === 'Ready for QA'), 'a CUSTOM status name must appear — proves this is not the fixed synthetic vocabulary')
    for (const s of states) {
      assert.equal(typeof s.id, 'string')
      assert.equal(typeof s.name, 'string')
      assert.equal(typeof s.position, 'number')
      assert.ok(['unstarted', 'started', 'completed'].includes(s.type))
    }
  })

  test('states() dedupes by status id across issue types, never by name (LIN-2018)', async () => {
    const scope = { email: 'a@b.com', apiToken: 't', site: SITE }
    const states = await provider.states(scope, 'ENG')
    // ENG_PROJECT_STATUSES repeats id '11' ('To Do') and '13' ('Done') across
    // the 'Task' and 'Bug' issue types — each must appear exactly ONCE.
    const ids = states.map(s => s.id)
    assert.equal(new Set(ids).size, ids.length, 'no duplicate ids survived the flatten')
    assert.equal(ids.filter(id => id === '11').length, 1)
    assert.equal(ids.filter(id => id === '13').length, 1)
    assert.equal(states.length, 5, 'exactly the 5 DISTINCT ids across both issue types (11,12,13,14,15)')
  })

  test('states() synthesizes position from first-appearance order (the endpoint carries none) (LIN-2018)', async () => {
    const scope = { email: 'a@b.com', apiToken: 't', site: SITE }
    const states = await provider.states(scope, 'ENG')
    const byId = Object.fromEntries(states.map(s => [s.id, s.position]))
    // First-appearance order walking ENG_PROJECT_STATUSES's 'Task' entries
    // then 'Bug' entries: 11, 12, 13, 14 (Task) then 15 (Bug; 11/13 already seen).
    assert.deepEqual(byId, { 11: 0, 12: 1, 13: 2, 14: 3, 15: 4 })
  })

  test('states() surfaces two DISTINCT done-category statuses (Done / Won\'t Do) — the exact shape LIN-1941\'s hazard needs (LIN-2018)', async () => {
    const scope = { email: 'a@b.com', apiToken: 't', site: SITE }
    const states = await provider.states(scope, 'ENG')
    const doneCategory = states.filter(s => s.type === 'completed')
    assert.deepEqual(doneCategory.map(s => s.name).sort(), ['Done', "Won't Do"])
  })

  test('states() for a project with no seeded statuses returns [] rather than throwing', async () => {
    const client = createFakeJiraClient({ projects: [{ id: '999', key: 'BARE', name: 'Bare' }] })
    const bareProvider = new JiraProvider({ clientFactory: () => client, site: SITE })
    const scope = { email: 'a@b.com', apiToken: 't', site: SITE }
    assert.deepEqual(await bareProvider.states(scope, 'BARE'), [])
  })

  // LIN-2032 gap 1 (LIN-2018 review ledger item 3): getProjectStatuses requires
  // Jira's Browse Projects permission. A user lacking it gets a 403 — proves
  // states() PROPAGATES that error rather than swallowing it to [] (unlike the
  // no-teamId/no-seeded-statuses branches above, which are deliberate,
  // documented degradations). Callers (routes/task-edit.js, routes/task-create.js,
  // the GET /api/proxy/states/{key} route) are what decide whether that surfaces
  // to a human (degraded fallback) or an agent (a loud error) — this pins the
  // provider's half of that contract.
  test('states() propagates a getProjectStatuses 403 (missing Browse Projects) rather than swallowing it', async () => {
    const { provider, client } = seededProvider()
    client.getProjectStatuses = async () => {
      const err = new Error('Jira API GET /rest/api/3/project/ENG/statuses failed: Forbidden')
      err.status = 403
      throw err
    }
    const scope = { email: 'a@b.com', apiToken: 't', site: SITE }
    await assert.rejects(provider.states(scope, 'ENG'), (err) => {
      assert.equal(err.status, 403)
      assert.match(err.message, /Forbidden/)
      return true
    })
  })

  test('labels() returns the site-wide label vocabulary as {id, name} pairs (id = name, mirrors GitHub)', async () => {
    const scope = { email: 'a@b.com', apiToken: 't', site: SITE }
    const labels = await provider.labels(scope)
    assert.ok(labels.some(l => l.id === 'backend' && l.name === 'backend'))
  })

  test('issueWriteGuard returns a non-null, stable team.id (required by resolveStateInput) — null for a missing issue', async () => {
    const scope = { email: 'a@b.com', apiToken: 't', site: SITE }
    const guard = await provider.issueWriteGuard(scope, 'ENG-1')
    assert.equal(guard.trashed, false)
    assert.ok(guard.team?.id, 'team.id must be non-null')
    assert.equal(await provider.issueWriteGuard(scope, 'ENG-999'), null)
  })

  // LIN-1886 review Blocker 1: this used to pin the RAW ADF object, which broke
  // routes/proxy.js's markdown-string read-modify-write (`applyDescriptionEdit`)
  // — `String(<ADF object>)` is "[object Object]", so append DESTROYED the body.
  // A markdown STRING is the shared contract every other provider already meets.
  test('issueDescription returns MARKDOWN (a string, matching every other provider) — null for a missing issue', async () => {
    const scope = { email: 'a@b.com', apiToken: 't', site: SITE }
    const desc = await provider.issueDescription(scope, 'ENG-1')
    assert.equal(desc.trashed, false)
    assert.equal(typeof desc.description, 'string', 'must be a markdown string, not the raw ADF object')
    assert.equal(desc.description, 'A parent issue.')
    assert.ok(!String(desc.description).includes('[object Object]'))
    // A missing/empty ADF degrades to '' (adfToMarkdown's own contract), never null.
    const empty = await provider.issueDescription(scope, 'ENG-3')
    if (empty) assert.equal(typeof empty.description, 'string')
    assert.equal(await provider.issueDescription(scope, 'ENG-999'), null)
  })

  test('issueLabels returns {id, trashed, labels:{nodes}} with id = name — null for a missing issue', async () => {
    const scope = { email: 'a@b.com', apiToken: 't', site: SITE }
    const labels = await provider.issueLabels(scope, 'ENG-1')
    assert.equal(labels.trashed, false)
    assert.deepEqual(labels.labels.nodes, [{ id: 'backend', name: 'backend' }])
    assert.equal(await provider.issueLabels(scope, 'ENG-999'), null)
  })

  test('updateIssueLabels diffs current vs desired and emits ONE atomic write, re-reading the canonical issue', async () => {
    const scope = { email: 'a@b.com', apiToken: 't', site: SITE }
    const result = await provider.updateIssueLabels(scope, 'ENG-1', ['backend', 'urgent'])
    assert.equal(result.success, true)
    assert.deepEqual(result.issue.labels.nodes.map(n => n.name).sort(), ['backend', 'urgent'])

    const removed = await provider.updateIssueLabels(scope, 'ENG-1', ['urgent'])
    assert.equal(removed.success, true)
    assert.deepEqual(removed.issue.labels.nodes.map(n => n.name), ['urgent'])
  })

  test('addLabel/removeLabel are thin wrappers over updateIssueLabels (capability-gate completeness)', async () => {
    const scope = { email: 'a@b.com', apiToken: 't', site: SITE }
    assert.equal(await provider.addLabel(scope, 'ENG-1', 'urgent'), true)
    const afterAdd = await provider.issueLabels(scope, 'ENG-1')
    assert.deepEqual(afterAdd.labels.nodes.map(n => n.name).sort(), ['backend', 'urgent'])

    assert.equal(await provider.removeLabel(scope, 'ENG-1', 'backend'), true)
    const afterRemove = await provider.issueLabels(scope, 'ENG-1')
    assert.deepEqual(afterRemove.labels.nodes.map(n => n.name), ['urgent'])
  })
})

// =============================================================================
// Step 3 — updateIssue() + status-transition write path (LIN-1886)
// =============================================================================

/** A seed purpose-built for updateIssue's write-path branches (transitions, unrenderable content). */
function writableSeededProvider() {
  const client = createFakeJiraClient({
    projects: [{ id: '10001', key: 'ENG', name: 'Engineering' }],
    projectStatuses: { ENG: ENG_PROJECT_STATUSES },
    issues: [
      {
        id: '30001', key: 'ENG-10',
        fields: {
          summary: 'Writable issue',
          description: { type: 'doc', version: 1, content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Plain description.' }] },
          ] },
          status: { id: '11', name: 'To Do', statusCategory: { key: 'new' } },
          project: { id: '10001', key: 'ENG', name: 'Engineering' },
          created: '2026-01-01T00:00:00.000Z', duedate: null, resolutiondate: null,
          labels: ['bug'], assignee: null, parent: null,
          // LIN-2018: `to.id` is what D2 now matches EXACTLY — the id, not the
          // statusCategory, decides which transition a `stateId` resolves to.
          _transitions: [
            { id: '111', name: 'Start Progress', to: { id: '12', name: 'In Progress', statusCategory: { key: 'indeterminate' } } },
            { id: '211', name: 'Done', to: { id: '13', name: 'Done', statusCategory: { key: 'done' } } },
          ],
        },
      },
      {
        id: '30002', key: 'ENG-11', // unrenderable description: an unmodeled NODE (table)
        fields: {
          summary: 'Issue with a table in its description',
          description: { type: 'doc', version: 1, content: [{ type: 'table', content: [] }] },
          status: { id: '11', name: 'To Do', statusCategory: { key: 'new' } },
          project: { id: '10001', key: 'ENG', name: 'Engineering' },
          created: '2026-01-01T00:00:00.000Z', duedate: null, resolutiondate: null,
          labels: [], assignee: null, parent: null, _transitions: [],
        },
      },
      {
        id: '30003', key: 'ENG-12', // unrenderable description: an unmodeled MARK only
        fields: {
          summary: 'Issue with an underline mark in its description',
          description: { type: 'doc', version: 1, content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'underline' }] }] },
          ] },
          status: { id: '11', name: 'To Do', statusCategory: { key: 'new' } },
          project: { id: '10001', key: 'ENG', name: 'Engineering' },
          created: '2026-01-01T00:00:00.000Z', duedate: null, resolutiondate: null,
          labels: [], assignee: null, parent: null, _transitions: [],
        },
      },
      {
        id: '30004', key: 'ENG-13', // done, with NO available transitions at all
        fields: {
          summary: 'Done issue with nothing else available',
          description: null,
          status: { id: '13', name: 'Done', statusCategory: { key: 'done' } },
          project: { id: '10001', key: 'ENG', name: 'Engineering' },
          created: '2026-01-01T00:00:00.000Z', duedate: null, resolutiondate: null,
          labels: [], assignee: null, parent: null, _transitions: [],
        },
      },
      {
        id: '30005', key: 'ENG-14', // its only forward transition requires a screen
        fields: {
          summary: 'Issue whose only transition to Done requires a screen',
          description: null,
          status: { id: '11', name: 'To Do', statusCategory: { key: 'new' } },
          project: { id: '10001', key: 'ENG', name: 'Engineering' },
          created: '2026-01-01T00:00:00.000Z', duedate: null, resolutiondate: null,
          labels: [], assignee: null, parent: null,
          _transitions: [
            { id: '31', name: 'Resolve', to: { id: '13', name: 'Done', statusCategory: { key: 'done' } }, hasScreen: true },
          ],
        },
      },
      {
        id: '30006', key: 'ENG-15', // its only forward transition carries `fields` but no `hasScreen` — must NOT be refused
        fields: {
          summary: 'Issue whose only transition carries fields but not hasScreen',
          description: null,
          status: { id: '11', name: 'To Do', statusCategory: { key: 'new' } },
          project: { id: '10001', key: 'ENG', name: 'Engineering' },
          created: '2026-01-01T00:00:00.000Z', duedate: null, resolutiondate: null,
          labels: [], assignee: null, parent: null,
          _transitions: [
            { id: '32', name: 'Resolve', to: { id: '13', name: 'Done', statusCategory: { key: 'done' } }, fields: { resolution: { required: true } } },
          ],
        },
      },
      {
        id: '30007', key: 'ENG-16', // two DISTINCT done-category transitions available — LIN-1941's root-fix proof
        fields: {
          summary: 'Issue with two done-category transitions available (Done / Won\'t Do)',
          description: null,
          status: { id: '11', name: 'To Do', statusCategory: { key: 'new' } },
          project: { id: '10001', key: 'ENG', name: 'Engineering' },
          created: '2026-01-01T00:00:00.000Z', duedate: null, resolutiondate: null,
          labels: [], assignee: null, parent: null,
          _transitions: [
            { id: '41', name: 'Resolve', to: { id: '13', name: 'Done', statusCategory: { key: 'done' } } },
            { id: '42', name: 'Abandon', to: { id: '14', name: "Won't Do", statusCategory: { key: 'done' } } },
          ],
        },
      },
    ],
  })
  const provider = new JiraProvider({ clientFactory: () => client, site: SITE })
  return { provider, client }
}

const SCOPE = { email: 'a@b.com', apiToken: 't', site: SITE }

describe('JiraProvider.updateIssue (LIN-1886 Step 3)', () => {
  let provider, client

  beforeEach(() => {
    ({ provider, client } = writableSeededProvider())
  })

  test('title update: ALWAYS re-reads and returns the canonical issue, never trusting the 204 write response', async () => {
    const issue = await provider.updateIssue(SCOPE, 'ENG-10', { title: 'Renamed' })
    assert.ok(issue, 'a truthy canonical issue, never a {success:false}/502-shaped miss')
    assert.equal(issue.title, 'Renamed')
    assert.equal(issue.source, SOURCE_JIRA)
  })

  test('description update: renderable current content is overwritten with the markdownToAdf conversion', async () => {
    const issue = await provider.updateIssue(SCOPE, 'ENG-10', { description: 'New **bold** body' })
    assert.equal(issue.description, 'New **bold** body')
  })

  test('D1: description overwrite is refused (422) when the CURRENT ADF contains an unmodeled NODE (table)', async () => {
    await assert.rejects(
      () => provider.updateIssue(SCOPE, 'ENG-11', { description: 'replacement text' }),
      err => {
        assert.ok(err instanceof RefResolutionError)
        assert.equal(err.status, 422)
        return true
      }
    )
  })

  test('D1: description overwrite is refused (422) when the CURRENT ADF contains an unmodeled MARK only (no unmodeled node)', async () => {
    await assert.rejects(
      () => provider.updateIssue(SCOPE, 'ENG-12', { description: 'replacement text' }),
      err => {
        assert.ok(err instanceof RefResolutionError)
        assert.equal(err.status, 422)
        return true
      }
    )
  })

  test('D2: happy-path status transition (To Do id 11 → In Progress id 12) actually moves the issue', async () => {
    const issue = await provider.updateIssue(SCOPE, 'ENG-10', { stateId: '12' })
    assert.equal(issue.state.type, 'started')
    assert.equal(issue.state.id, '12')
  })

  test('D2: happy-path status transition (To Do id 11 → Done id 13)', async () => {
    const issue = await provider.updateIssue(SCOPE, 'ENG-10', { stateId: '13' })
    assert.equal(issue.state.type, 'completed')
    assert.equal(issue.state.id, '13')
  })

  test('D2 (LIN-2018 root fix): an EXACT status id wins even when another transition shares its statusCategory — never first-match', async () => {
    // ENG-16 offers BOTH a Done (id 13) and a Won't Do (id 14) transition,
    // both statusCategory 'done'. Requesting each id must land on THAT exact
    // status, proving the match is on id, not "first done-category transition".
    const toDone = await provider.updateIssue(SCOPE, 'ENG-16', { stateId: '13' })
    assert.equal(toDone.state.id, '13')
    assert.equal(toDone.state.name, 'Done')
  })

  test('D2 (LIN-2018 root fix): the other exact id (Won\'t Do) is reachable too — proves the match is not hardcoded to the first candidate', async () => {
    const toWontDo = await provider.updateIssue(SCOPE, 'ENG-16', { stateId: '14' })
    assert.equal(toWontDo.state.id, '14')
    assert.equal(toWontDo.state.name, "Won't Do")
  })

  test('D2: a same-id stateId is a SKIPPED no-op — no getTransitions/doTransition call at all', async () => {
    let getTransitionsCalls = 0
    const originalGetTransitions = client.getTransitions.bind(client)
    client.getTransitions = async (...args) => { getTransitionsCalls += 1; return originalGetTransitions(...args) }

    const issue = await provider.updateIssue(SCOPE, 'ENG-10', { stateId: '11' })
    assert.equal(issue.state.type, 'unstarted')
    assert.equal(getTransitionsCalls, 0, 'the current status id already matched — no transitions call should have been made')
  })

  test('a title-only patch leaves status untouched (no stateId in the patch at all)', async () => {
    const before = await provider.fetchIssueFields(SCOPE, 'ENG-10')
    const issue = await provider.updateIssue(SCOPE, 'ENG-10', { title: 'Only the title changes' })
    assert.equal(issue.state.type, before.state.type)
  })

  test('D2: no available transition to the target id → 422, never a silent no-op', async () => {
    // ENG-13 is `done` with an EMPTY _transitions list; targeting id '11' ('To Do') finds nothing.
    await assert.rejects(
      () => provider.updateIssue(SCOPE, 'ENG-13', { stateId: '11' }),
      err => {
        assert.ok(err instanceof RefResolutionError)
        assert.equal(err.status, 422)
        return true
      }
    )
  })

  test('D2: a screen-required transition refuses (422) rather than attempting a screen-driven update', async () => {
    await assert.rejects(
      () => provider.updateIssue(SCOPE, 'ENG-14', { stateId: '13' }),
      err => {
        assert.ok(err instanceof RefResolutionError)
        assert.equal(err.status, 422)
        return true
      }
    )
  })

  test('D2: a transition carrying `fields` but no `hasScreen` is NOT refused (LIN-2020: `fields` is never populated by real Jira without `expand`, so it must not drive the guard)', async () => {
    const issue = await provider.updateIssue(SCOPE, 'ENG-15', { stateId: '13' })
    assert.equal(issue.state.type, 'completed')
  })

  test('D2: a stateId this integration cannot match against any transition (a stale/legacy synthetic id like "canceled") is refused (422) — never silently folds to any status', async () => {
    await assert.rejects(() => provider.updateIssue(SCOPE, 'ENG-10', { stateId: 'canceled' }), RefResolutionError)
    await assert.rejects(() => provider.updateIssue(SCOPE, 'ENG-10', { stateId: 'duplicate' }), RefResolutionError)
  })

  test('D3: patch.priority is silently excluded — never mapped into the Jira PUT body, never causes a rejection', async () => {
    const issue = await provider.updateIssue(SCOPE, 'ENG-10', { title: 'Still renamed', priority: 2 })
    assert.equal(issue.title, 'Still renamed')
    // The fake client's updateIssue only ever applies `fields`/`update.labels`;
    // nothing about priority is readable back because nothing was ever sent.
  })

  test('D4: a truthy projectId is refused (422) — Jira cannot move an issue between projects through this integration', async () => {
    await assert.rejects(
      () => provider.updateIssue(SCOPE, 'ENG-10', { projectId: '99999' }),
      err => {
        assert.ok(err instanceof RefResolutionError)
        assert.equal(err.status, 422)
        return true
      }
    )
  })

  test('D4: parentId === null is refused (422) — Jira cannot promote an issue to top-level through this integration', async () => {
    await assert.rejects(
      () => provider.updateIssue(SCOPE, 'ENG-10', { parentId: null }),
      err => {
        assert.ok(err instanceof RefResolutionError)
        assert.equal(err.status, 422)
        return true
      }
    )
  })

  test('a missing issue returns null (never throws, mirrors GitHub)', async () => {
    assert.equal(await provider.updateIssue(SCOPE, 'ENG-999', { title: 'x' }), null)
  })
})

// =============================================================================
// updateIssue partial-write reporting (LIN-2012)
// =============================================================================

describe('JiraProvider.updateIssue — partial-write reporting (LIN-2012)', () => {
  let provider, client

  beforeEach(() => {
    ({ provider, client } = writableSeededProvider())
  })

  test('transition fails after the field PUT succeeds → PartialWriteError{applied:[title], failed:stateId}, preserving upstream status', async (t) => {
    const warnMock = t.mock.method(console, 'warn', () => {})
    client.doTransition = async () => {
      const err = new Error('Jira API POST .../transitions failed: rate limited')
      err.status = 429
      throw err
    }
    await assert.rejects(
      () => provider.updateIssue(SCOPE, 'ENG-10', { title: 'New title', stateId: '12' }),
      err => {
        assert.ok(err instanceof PartialWriteError)
        assert.deepEqual(err.applied, ['title'])
        assert.equal(err.failed, 'stateId')
        assert.equal(err.status, 429)
        return true
      }
    )
    // The title write actually landed — this is not a total failure.
    assert.equal((await client.getIssue('ENG-10')).fields.summary, 'New title')
    assert.equal(warnMock.mock.callCount(), 1)
    assert.match(warnMock.mock.calls[0].arguments[0], /partial write.*title.*stateId/)
  })

  test('re-read fails after both writes succeed → PartialWriteError{applied:[title,stateId], failed:re-read}', async (t) => {
    const warnMock = t.mock.method(console, 'warn', () => {})
    const originalGetIssue = client.getIssue.bind(client)
    let calls = 0
    client.getIssue = async (...args) => {
      calls += 1
      // First call resolves the current issue (pre-write read); second is the
      // post-write confirmation re-read that this test fails.
      if (calls === 1) return originalGetIssue(...args)
      throw new Error('Jira API GET .../issue failed: connection reset')
    }
    await assert.rejects(
      () => provider.updateIssue(SCOPE, 'ENG-10', { title: 'New title', stateId: '12' }),
      err => {
        assert.ok(err instanceof PartialWriteError)
        assert.deepEqual(err.applied, ['title', 'stateId'])
        assert.equal(err.failed, 're-read')
        return true
      }
    )
    assert.equal((await originalGetIssue('ENG-10')).fields.summary, 'New title', 'field write landed')
    assert.equal((await originalGetIssue('ENG-10')).fields.status.id, '12', 'transition landed')
    assert.equal(warnMock.mock.callCount(), 1)
  })

  test('re-read fails after a field-only write (no stateId in the patch) — the description/append & /replace sub-case', async (t) => {
    t.mock.method(console, 'warn', () => {})
    const originalGetIssue = client.getIssue.bind(client)
    let calls = 0
    client.getIssue = async (...args) => {
      calls += 1
      if (calls === 1) return originalGetIssue(...args)
      throw new Error('connection reset')
    }
    await assert.rejects(
      () => provider.updateIssue(SCOPE, 'ENG-10', { description: 'New body' }),
      err => {
        assert.ok(err instanceof PartialWriteError)
        assert.deepEqual(err.applied, ['description'])
        assert.equal(err.failed, 're-read')
        return true
      }
    )
  })

  test('the field PUT itself throws (nothing applied) → the ORIGINAL error propagates unchanged, never PartialWriteError', async (t) => {
    const warnMock = t.mock.method(console, 'warn', () => {})
    const originalErr = new Error('Jira API PUT .../issue failed: forbidden')
    originalErr.status = 403
    client.updateIssue = async () => { throw originalErr }
    await assert.rejects(
      () => provider.updateIssue(SCOPE, 'ENG-10', { title: 'New title', stateId: '12' }),
      err => {
        assert.equal(err, originalErr, 'the exact original error, not a wrapped PartialWriteError')
        assert.ok(!(err instanceof PartialWriteError))
        return true
      }
    )
    assert.equal(warnMock.mock.callCount(), 0, 'no partial-write warning for a genuine total failure')
  })
})

// =============================================================================
// Step 5 — createComment (LIN-1886)
// =============================================================================

describe('JiraProvider.createComment (LIN-1886 Step 5)', () => {
  test('converts markdown to ADF on the way in, and returns the canonical comment shape matching fetchIssueComments', async () => {
    const { provider } = seededProvider()
    const comment = await provider.createComment(SCOPE, 'ENG-1', 'A **bold** reply')
    assert.equal(typeof comment.id, 'string')
    assert.equal(comment.body, 'A **bold** reply')
    assert.equal(comment.user, 'Tester')
    assert.ok(comment.createdAt)

    // Round-trips through a real read too.
    const comments = await provider.fetchIssueComments(SCOPE, 'ENG-1')
    assert.ok(comments.some(c => c.body === 'A **bold** reply'))
  })

  test('a missing issue throws a clean, status-carrying error (404, propagated from the client)', async () => {
    const { provider } = seededProvider()
    await assert.rejects(() => provider.createComment(SCOPE, 'ENG-999', 'hello'), err => {
      assert.equal(err.status, 404)
      return true
    })
  })
})

// =============================================================================
// createJiraClient — serial pagination + bounded 429/Retry-After (real client,
// captured fetchImpl; the fake never rate-limits or paginates on the wire).
// =============================================================================

describe('createJiraClient — Basic auth wire shape', () => {
  test('sends a Basic auth header built from email:apiToken, and Accept: application/json', async () => {
    const calls = []
    const fetchImpl = async (url, opts) => {
      calls.push({ url, headers: opts.headers })
      return { status: 200, ok: true, headers: { get: () => null }, text: async () => JSON.stringify({ values: [], startAt: 0, maxResults: 50, total: 0, isLast: true }) }
    }
    const client = createJiraClient({ email: 'a@b.com', apiToken: 'tok', site: SITE, fetchImpl })
    await client.listProjects()
    assert.equal(calls.length, 1)
    const expected = `Basic ${Buffer.from('a@b.com:tok').toString('base64')}`
    assert.equal(calls[0].headers.Authorization, expected)
    assert.equal(calls[0].headers.Accept, 'application/json')
    assert.ok(calls[0].url.startsWith(`${SITE}/rest/api/3/project/search`))
  })

  test('every request carries an abort signal, so a black-holing host cannot pin the handler forever (LIN-1885 re-review blocker, part 4)', async () => {
    const calls = []
    const fetchImpl = async (url, opts) => {
      calls.push(opts)
      return { status: 200, ok: true, headers: { get: () => null }, text: async () => JSON.stringify({ values: [], startAt: 0, maxResults: 50, total: 0, isLast: true }) }
    }
    const client = createJiraClient({ email: 'a@b.com', apiToken: 'tok', site: SITE, fetchImpl })
    await client.listProjects()
    assert.ok(calls[0].signal instanceof AbortSignal, 'a real, timing-out AbortSignal is attached to every request')
  })

  test('refuses a non-https site at construction (belt-and-braces SSRF guard, LIN-1885 re-review blocker)', () => {
    assert.throws(
      () => createJiraClient({ email: 'a@b.com', apiToken: 'tok', site: 'http://169.254.169.254' }),
      /https/
    )
  })

  test('a non-2xx, non-429 response throws with the status exposed on err.status', async () => {
    const fetchImpl = async () => ({
      status: 404, ok: false, statusText: 'Not Found', headers: { get: () => null },
      text: async () => JSON.stringify({ errorMessages: ['Issue does not exist'] }),
    })
    const client = createJiraClient({ email: 'a@b.com', apiToken: 'tok', site: SITE, fetchImpl })
    await assert.rejects(
      () => client.getIssue('ENG-1'),
      err => {
        assert.equal(err.status, 404)
        return true
      }
    )
  })
})

// =============================================================================
// LIN-1891 acceptance item 3 — the headless/proxy lane's structured scope
// reaches JiraProvider and produces the LITERAL Basic-auth header, driven
// through the real per-request seam (_clientFor -> _clientForCredential ->
// clientFactory) rather than calling createJiraClient directly (the block
// above tests that boundary in isolation, credential-blind). This file's
// `seededProvider()` helper (used everywhere above) is `clientFactory: () =>
// client` — it ignores its credential argument entirely, so it would pass
// even if the scope object lost a field between getWorkspaceCallScope and
// the client. This describe block builds a SEPARATE, credential-KEYED
// provider instead, mirroring tests/unit/github-app-integration.test.js's
// `clientFactory: (token) => clientScopedTo(...)` template — never extending
// seededProvider's blind factory into this evidence.
// =============================================================================

describe('JiraProvider — literal Basic-auth header through the real per-request scope seam (LIN-1891)', () => {
  // Builds a JiraProvider with NO boot client (mirrors production: a
  // headless-lane Jira workspace has no configure({client}) call) whose
  // clientFactory is keyed on the credential it receives — a wrong or
  // incomplete credential produces a wrong or missing header, rather than
  // being silently ignored.
  function providerWithCapturingFactory(calls) {
    const fetchImpl = async (url, opts) => {
      calls.push({ url, headers: opts.headers })
      return { status: 200, ok: true, headers: { get: () => null }, text: async () => JSON.stringify({ values: [], startAt: 0, maxResults: 50, total: 0, isLast: true }) }
    }
    return new JiraProvider({ clientFactory: cred => createJiraClient({ ...cred, fetchImpl }) })
  }

  test('a getWorkspaceCallScope-shaped {email, apiToken, site} credential produces the literal Authorization: Basic header', async () => {
    const calls = []
    const provider = providerWithCapturingFactory(calls)
    // Exactly the shape lib/workspace.js's getWorkspaceCallScope produces for
    // a Jira workspace — the structured scope LIN-1891's edits 1-4 thread
    // through the headless lane in place of a bare token string.
    const scope = { email: 'ada@acme.com', apiToken: 'tok-123', site: SITE }

    await provider.fetchProjects(scope)

    assert.equal(calls.length, 1, 'fetchProjects makes exactly one request when the site has no projects')
    const expected = `Basic ${Buffer.from('ada@acme.com:tok-123').toString('base64')}`
    // The LITERAL header value, not merely "a header is present" or "no
    // error was thrown" — see the module comment above for why that
    // distinction is load-bearing here.
    assert.equal(calls[0].headers.Authorization, expected);
  });
});

describe('createJiraClient serial pagination', () => {
  test('listAllProjects walks pages serially via startAt until isLast', async () => {
    const pages = [
      { values: [{ id: '1', key: 'A' }, { id: '2', key: 'B' }], startAt: 0, maxResults: 2, total: 3, isLast: false },
      { values: [{ id: '3', key: 'C' }], startAt: 2, maxResults: 2, total: 3, isLast: true },
    ]
    const calls = []
    const fetchImpl = async (url) => {
      calls.push(url)
      return { status: 200, ok: true, headers: { get: () => null }, text: async () => JSON.stringify(pages[calls.length - 1]) }
    }
    const client = createJiraClient({ email: 'a@b.com', apiToken: 'tok', site: SITE, fetchImpl })
    const all = await client.listAllProjects()
    assert.equal(calls.length, 2, 'pages fetched one at a time, serially')
    assert.ok(calls[0].includes('startAt=0'))
    assert.ok(calls[1].includes('startAt=2'))
    assert.deepEqual(all.map(p => p.key), ['A', 'B', 'C'])
    assert.equal(all.truncated, false, 'reached the natural end (isLast), not the cap')
  })

  test('listAllProjects stops at the project cap even if more pages remain, never an unbounded walk (LIN-1885 re-review finding #6)', async () => {
    let calls = 0
    const fetchImpl = async (url) => {
      calls += 1
      const maxResults = Number(new URL(url).searchParams.get('maxResults'))
      const values = Array.from({ length: maxResults }, (_, i) => ({ id: String(calls * 100 + i), key: `P${calls}-${i}` }))
      return { status: 200, ok: true, headers: { get: () => null }, text: async () => JSON.stringify({ values, startAt: 0, maxResults, total: 999, isLast: false }) }
    }
    const client = createJiraClient({ email: 'a@b.com', apiToken: 'tok', site: SITE, fetchImpl })
    const all = await client.listAllProjects({ cap: 5 })
    assert.equal(all.length, 5, `capped at exactly 5 projects, got ${all.length}`)
    assert.equal(all.truncated, true, 'stopping on the cap, not the natural end, must be signalled')
  })

  test('getProjectStatuses (LIN-2018) GETs /rest/api/3/project/{key}/statuses and returns the plain array verbatim — no pagination, one request', async () => {
    const payload = [
      { id: '1', name: 'Task', subtask: false, statuses: [{ id: '11', name: 'To Do', statusCategory: { key: 'new' } }] },
    ]
    const calls = []
    const fetchImpl = async (url) => {
      calls.push(url)
      return { status: 200, ok: true, headers: { get: () => null }, text: async () => JSON.stringify(payload) }
    }
    const client = createJiraClient({ email: 'a@b.com', apiToken: 'tok', site: SITE, fetchImpl })
    const result = await client.getProjectStatuses('ENG')
    assert.equal(calls.length, 1, 'exactly one request — this endpoint is not paginated')
    assert.ok(calls[0].endsWith('/rest/api/3/project/ENG/statuses'))
    assert.deepEqual(result, payload)
  })

  test('getProjectStatuses reuses the shared request() rate-limit path — a 429 here retries exactly like any other read, no second backoff implementation', async () => {
    let attempt = 0
    const fetchImpl = async () => {
      attempt += 1
      if (attempt === 1) return { status: 429, ok: false, headers: { get: h => (h === 'Retry-After' ? '0' : null) } }
      return { status: 200, ok: true, headers: { get: () => null }, text: async () => JSON.stringify([]) }
    }
    const client = createJiraClient({ email: 'a@b.com', apiToken: 'tok', site: SITE, fetchImpl, sleepImpl: async () => {} })
    const result = await client.getProjectStatuses('ENG')
    assert.equal(attempt, 2, 'retried exactly once through the shared 429 handling')
    assert.deepEqual(result, [])
  })

  test('searchIssues posts to /search/jql (not the removed /search) with jql/maxResults/fields, no startAt', async () => {
    const calls = []
    const fetchImpl = async (url, opts) => {
      calls.push({ url, body: JSON.parse(opts.body) })
      return { status: 200, ok: true, headers: { get: () => null }, text: async () => JSON.stringify({ issues: [] }) }
    }
    const client = createJiraClient({ email: 'a@b.com', apiToken: 'tok', site: SITE, fetchImpl })
    await client.searchIssues('project = ENG ORDER BY key ASC', { fields: ['summary', 'status'] })
    assert.equal(calls.length, 1)
    assert.ok(calls[0].url.startsWith(`${SITE}/rest/api/3/search/jql`))
    assert.equal(calls[0].body.jql, 'project = ENG ORDER BY key ASC')
    assert.deepEqual(calls[0].body.fields, ['summary', 'status'])
    assert.equal('startAt' in calls[0].body, false, 'startAt is not a /search/jql param — random page access is gone')
  })

  test('searchAllIssues walks JQL search pages serially via nextPageToken, stopping once the token is absent', async () => {
    const pages = [
      { issues: [{ id: '1', key: 'ENG-1' }], nextPageToken: 'p2' },
      { issues: [{ id: '2', key: 'ENG-2' }] }, // no nextPageToken → last page, no `total` field anywhere
    ]
    const calls = []
    const fetchImpl = async (url, opts) => {
      calls.push({ url, body: JSON.parse(opts.body) })
      return { status: 200, ok: true, headers: { get: () => null }, text: async () => JSON.stringify(pages[calls.length - 1]) }
    }
    const client = createJiraClient({ email: 'a@b.com', apiToken: 'tok', site: SITE, fetchImpl })
    const all = await client.searchAllIssues('project = ENG ORDER BY key ASC')
    assert.equal(calls.length, 2, 'stopped once nextPageToken was absent, not on a total count')
    assert.equal(calls[0].body.nextPageToken, undefined, 'first page requests no cursor')
    assert.equal(calls[1].body.nextPageToken, 'p2', 'second page carries the cursor the first page returned')
    assert.deepEqual(all.map(i => i.key), ['ENG-1', 'ENG-2'])
    assert.equal(all.truncated, false, 'reached the natural end (no nextPageToken), not the cap')
  })

  test('searchAllIssues stops at the issue cap even if more pages remain, never an unbounded walk', async () => {
    let calls = 0
    const fetchImpl = async (url, opts) => {
      calls += 1
      const body = JSON.parse(opts.body)
      const issues = Array.from({ length: body.maxResults }, (_, i) => ({ id: String(calls * 100 + i), key: `ENG-${calls}-${i}` }))
      return { status: 200, ok: true, headers: { get: () => null }, text: async () => JSON.stringify({ issues, nextPageToken: 'more' }) }
    }
    const client = createJiraClient({ email: 'a@b.com', apiToken: 'tok', site: SITE, fetchImpl })
    const all = await client.searchAllIssues('ORDER BY key ASC', { cap: 5, maxResults: 3 })
    assert.ok(all.length <= 5, `capped at 5 issues, got ${all.length}`)
    assert.equal(all.length, 5)
    assert.equal(all.truncated, true, 'stopping on the cap, not the natural end (more pages remained), must be signalled')
  })

  // LIN-2155: the measurement oracle for per-tier coverage.
  test('searchApproximateCount POSTs to /search/approximate-count with the jql and returns .count, round-tripping through request()', async () => {
    const calls = []
    const fetchImpl = async (url, opts) => {
      calls.push({ url, body: JSON.parse(opts.body) })
      return { status: 200, ok: true, headers: { get: () => null }, text: async () => JSON.stringify({ count: 42 }) }
    }
    const client = createJiraClient({ email: 'a@b.com', apiToken: 'tok', site: SITE, fetchImpl })
    const count = await client.searchApproximateCount('project = "ENG" AND statusCategory = "In Progress"')
    assert.equal(calls.length, 1)
    assert.ok(calls[0].url.endsWith('/rest/api/3/search/approximate-count'))
    assert.equal(calls[0].body.jql, 'project = "ENG" AND statusCategory = "In Progress"')
    assert.equal(count, 42)
  })

  test('searchApproximateCount inherits the shared 429/Retry-After retry — no second backoff path', async () => {
    let attempt = 0
    const fetchImpl = async () => {
      attempt += 1
      if (attempt === 1) return { status: 429, ok: false, headers: { get: h => (h === 'Retry-After' ? '0' : null) } }
      return { status: 200, ok: true, headers: { get: () => null }, text: async () => JSON.stringify({ count: 7 }) }
    }
    const client = createJiraClient({ email: 'a@b.com', apiToken: 'tok', site: SITE, fetchImpl, sleepImpl: async () => {} })
    const count = await client.searchApproximateCount('project = "ENG"')
    assert.equal(attempt, 2, 'retried exactly once through the shared 429 handling')
    assert.equal(count, 7)
  })

  test('searchApproximateCount returns null when the response carries no count', async () => {
    const fetchImpl = async () => ({ status: 200, ok: true, headers: { get: () => null }, text: async () => JSON.stringify({}) })
    const client = createJiraClient({ email: 'a@b.com', apiToken: 'tok', site: SITE, fetchImpl })
    assert.equal(await client.searchApproximateCount('project = "ENG"'), null)
  })
})

describe('createJiraClient 429 handling', () => {
  test('honours Retry-After (seconds) and retries once, then succeeds', async () => {
    const sleeps = []
    let attempt = 0
    const fetchImpl = async () => {
      attempt += 1
      if (attempt === 1) {
        return {
          status: 429, ok: false,
          headers: { get: (name) => (name === 'Retry-After' ? '2' : null) },
          text: async () => '',
        }
      }
      return { status: 200, ok: true, headers: { get: () => null }, text: async () => JSON.stringify({ id: '1', key: 'ENG-1' }) }
    }
    const client = createJiraClient({
      email: 'a@b.com', apiToken: 'tok', site: SITE, fetchImpl,
      sleepImpl: async (ms) => { sleeps.push(ms) },
    })
    const issue = await client.getIssue('ENG-1')
    assert.equal(attempt, 2, 'retried exactly once after the 429')
    assert.deepEqual(sleeps, [2000], 'honoured the Retry-After header verbatim (2s), not the backoff formula')
    assert.equal(issue.key, 'ENG-1')
  })

  test('falls back to bounded backoff-with-jitter when Retry-After is absent', async () => {
    const sleeps = []
    let attempt = 0
    const fetchImpl = async () => {
      attempt += 1
      if (attempt <= 2) {
        return { status: 429, ok: false, headers: { get: () => null }, text: async () => '' }
      }
      return { status: 200, ok: true, headers: { get: () => null }, text: async () => JSON.stringify({ values: [], startAt: 0, maxResults: 50, total: 0, isLast: true }) }
    }
    const client = createJiraClient({
      email: 'a@b.com', apiToken: 'tok', site: SITE, fetchImpl,
      sleepImpl: async (ms) => { sleeps.push(ms) },
      randomImpl: () => 0.5, // pins jitter mid-range: factor = 0.7 + 0.5*(1.3-0.7) = 1.0
    })
    await client.listProjects()
    assert.equal(attempt, 3, 'retried twice after two 429s')
    assert.deepEqual(sleeps, [2000, 4000], 'base 2s, doubling, with jitter pinned to 1.0x')
  })

  test('a 429 status survives to the caller as err.status (never silently swallowed)', async () => {
    const fetchImpl = async () => ({ status: 429, ok: false, headers: { get: () => null }, text: async () => '' })
    const client = createJiraClient({
      email: 'a@b.com', apiToken: 'tok', site: SITE, fetchImpl,
      sleepImpl: async () => {},
    })
    await assert.rejects(
      () => client.getIssue('ENG-1'),
      err => {
        assert.equal(err.status, 429)
        return true
      }
    )
  })

  test('retries are bounded — a persistent 429 throws after MAX_429_RETRIES, never loops forever', async () => {
    let attempts = 0
    const fetchImpl = async () => {
      attempts += 1
      return { status: 429, ok: false, headers: { get: () => null }, text: async () => '' }
    }
    const client = createJiraClient({
      email: 'a@b.com', apiToken: 'tok', site: SITE, fetchImpl,
      sleepImpl: async () => {},
    })
    await assert.rejects(() => client.getIssue('ENG-1'), err => {
      assert.equal(err.status, 429)
      return true
    })
    // 1 initial attempt + 4 bounded retries = 5 total fetch calls, never unbounded.
    assert.equal(attempts, 5)
  })

  test('a quota-reason 429 (RateLimit-Reason: jira-quota-tenant-based) fails fast on first sight, never sleeps', async () => {
    const sleeps = []
    let attempts = 0
    const fetchImpl = async () => {
      attempts += 1
      return {
        status: 429, ok: false,
        headers: { get: (name) => (name === 'RateLimit-Reason' ? 'jira-quota-tenant-based' : name === 'Retry-After' ? '2' : null) },
        text: async () => '',
      }
    }
    const client = createJiraClient({
      email: 'a@b.com', apiToken: 'tok', site: SITE, fetchImpl,
      sleepImpl: async (ms) => { sleeps.push(ms) },
    })
    await assert.rejects(() => client.getIssue('ENG-1'), err => {
      assert.equal(err.status, 429)
      assert.equal(err.rateLimitReason, 'jira-quota-tenant-based')
      return true
    })
    assert.equal(attempts, 1, 'failed on the first 429, never retried a quota-exhausted bucket')
    assert.deepEqual(sleeps, [], 'never slept — an hour-scale quota wait is not worth parking the handler for')
  })

  test('a burst-reason 429 still retries normally (only quota reasons fail fast)', async () => {
    let attempt = 0
    const fetchImpl = async () => {
      attempt += 1
      if (attempt === 1) {
        return {
          status: 429, ok: false,
          headers: { get: (name) => (name === 'RateLimit-Reason' ? 'jira-burst-based' : name === 'Retry-After' ? '2' : null) },
          text: async () => '',
        }
      }
      return { status: 200, ok: true, headers: { get: () => null }, text: async () => JSON.stringify({ id: '1', key: 'ENG-1' }) }
    }
    const client = createJiraClient({
      email: 'a@b.com', apiToken: 'tok', site: SITE, fetchImpl,
      sleepImpl: async () => {},
    })
    const issue = await client.getIssue('ENG-1')
    assert.equal(attempt, 2, 'a burst-based 429 was retried, not failed fast')
    assert.equal(issue.key, 'ENG-1')
  })

  test('a Retry-After above the MAX_RETRY_AFTER_MS ceiling fails fast instead of sleeping through an hour-scale wait', async () => {
    const sleeps = []
    let attempts = 0
    const fetchImpl = async () => {
      attempts += 1
      // 3600s (1h) — clearly quota-scale, well past any sane inline retry.
      return { status: 429, ok: false, headers: { get: (name) => (name === 'Retry-After' ? '3600' : null) }, text: async () => '' }
    }
    const client = createJiraClient({
      email: 'a@b.com', apiToken: 'tok', site: SITE, fetchImpl,
      sleepImpl: async (ms) => { sleeps.push(ms) },
    })
    await assert.rejects(() => client.getIssue('ENG-1'), err => {
      assert.equal(err.status, 429)
      return true
    })
    assert.equal(attempts, 1, 'failed on the first 429 — an over-ceiling Retry-After is never honoured')
    assert.deepEqual(sleeps, [], 'never slept the full hour-scale delay')
  })

  test('a 429 never lands on classifyUpstreamError as an auth failure', async () => {
    const { classifyUpstreamError, isAuthError } = await import('../../lib/errors.js')
    const fetchImpl = async () => ({ status: 429, ok: false, headers: { get: () => null }, text: async () => '' })
    const client = createJiraClient({
      email: 'a@b.com', apiToken: 'tok', site: SITE, fetchImpl,
      sleepImpl: async () => {},
    })
    try {
      await client.getIssue('ENG-1')
      assert.fail('expected a throw')
    } catch (err) {
      assert.equal(isAuthError(err), false)
      assert.equal(classifyUpstreamError(err).category, 'upstream')
      assert.equal(classifyUpstreamError(err).retryable, true)
    }
  })
})
