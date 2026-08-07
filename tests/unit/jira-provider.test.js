/**
 * Unit tests for lib/providers/jira/{index,client,fake-client}.js (LIN-1885,
 * Phase 1 of LIN-275).
 *
 * Mirrors github-provider.test.js's shape. Pins:
 *   - the pure statusCategory → canonical state mapping;
 *   - the capability profile (method capabilities + the ui surface, incl. the
 *     displayName override that keeps a bound row from rendering lowercase 'jira');
 *   - module-load self-registration under 'jira';
 *   - reads returning the canonical shape, driven through the in-memory fake
 *     client (no network, no auth) — fetchProjects, fetchIssueContext (best-effort
 *     subtask children), fetchIssueComments, fetchTeams → [];
 *   - adfToMarkdown covering the ADF node/mark types real Jira content uses;
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
  jiraStateIdToCanonicalType,
  adfToMarkdown,
  markdownToAdf,
  adfHasUnrenderableContent,
} from '../../lib/providers/jira/index.js'
import { RefResolutionError } from '../../lib/proxy-ref-resolver.js'
import { createFakeJiraClient } from '../../lib/providers/jira/fake-client.js'
import { createJiraClient } from '../../lib/providers/jira/client.js'
import { getProvider } from '../../lib/providers/registry.js'
import { NotImplementedError } from '../../lib/providers/interface.js'
import { SOURCE_JIRA } from '../../lib/providers/models.js'

const SITE = 'https://acme.atlassian.net'

function seededProvider() {
  const client = createFakeJiraClient({
    projects: [
      { id: '10001', key: 'ENG', name: 'Engineering' },
    ],
    issues: [
      {
        id: '20001',
        key: 'ENG-1',
        fields: {
          summary: 'Parent story',
          description: { type: 'doc', version: 1, content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'A parent issue.' }] },
          ] },
          status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
          project: { id: '10001', key: 'ENG', name: 'Engineering' },
          created: '2026-01-01T00:00:00.000Z',
          duedate: null,
          resolutiondate: null,
          labels: ['backend'],
          assignee: { displayName: 'Ada Lovelace' },
          parent: null,
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
          status: { name: 'Done', statusCategory: { key: 'done' } },
          project: { id: '10001', key: 'ENG', name: 'Engineering' },
          created: '2026-01-03T00:00:00.000Z',
          duedate: null,
          resolutiondate: '2026-01-04T00:00:00.000Z',
          labels: [],
          assignee: null,
          parent: { id: '20001', key: 'ENG-1' },
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
    const state = jiraStatusCategoryToCanonical({ fields: { status: { name: 'To Do', statusCategory: { key: 'new' } } } })
    assert.deepEqual(state, { name: 'To Do', type: 'unstarted' })
  })

  test('indeterminate → started', () => {
    const state = jiraStatusCategoryToCanonical({ fields: { status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } } } })
    assert.deepEqual(state, { name: 'In Progress', type: 'started' })
  })

  test('done → completed', () => {
    const state = jiraStatusCategoryToCanonical({ fields: { status: { name: 'Done', statusCategory: { key: 'done' } } } })
    assert.deepEqual(state, { name: 'Done', type: 'completed' })
  })

  test('an unrecognized/missing category defaults to unstarted, never canceled/duplicate', () => {
    assert.equal(jiraStatusCategoryToCanonical({ fields: { status: { name: 'Weird', statusCategory: { key: 'something-else' } } } }).type, 'unstarted')
    assert.equal(jiraStatusCategoryToCanonical({}).type, 'unstarted')
  })

  test('never maps from the free-text status name', () => {
    // A status literally named "Done" but in the 'new' category must still read unstarted.
    const state = jiraStatusCategoryToCanonical({ fields: { status: { name: 'Done', statusCategory: { key: 'new' } } } })
    assert.equal(state.type, 'unstarted')
  })
})

// =============================================================================
// ADF → Markdown
// =============================================================================

describe('adfToMarkdown', () => {
  test('null/undefined/non-object → empty string', () => {
    assert.equal(adfToMarkdown(null), '')
    assert.equal(adfToMarkdown(undefined), '')
    assert.equal(adfToMarkdown('not adf'), '')
  })

  test('paragraph + text marks (strong/em/code/strike/link)', () => {
    const doc = {
      type: 'doc', version: 1, content: [{
        type: 'paragraph', content: [
          { type: 'text', text: 'bold', marks: [{ type: 'strong' }] },
          { type: 'text', text: ' and ' },
          { type: 'text', text: 'italic', marks: [{ type: 'em' }] },
          { type: 'text', text: ' and ' },
          { type: 'text', text: 'code', marks: [{ type: 'code' }] },
          { type: 'text', text: ' and ' },
          { type: 'text', text: 'struck', marks: [{ type: 'strike' }] },
          { type: 'text', text: ' and ' },
          { type: 'text', text: 'a link', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] },
        ],
      }],
    }
    assert.equal(
      adfToMarkdown(doc),
      '**bold** and _italic_ and `code` and ~~struck~~ and [a link](https://example.com)'
    )
  })

  test('heading level clamps into 1-6', () => {
    const doc = { content: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Title' }] }] }
    assert.equal(adfToMarkdown(doc), '## Title')
  })

  test('bulletList and orderedList', () => {
    const bullets = { content: [{ type: 'bulletList', content: [
      { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }] },
      { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'two' }] }] },
    ] }] }
    assert.equal(adfToMarkdown(bullets), '- one\n- two')

    const ordered = { content: [{ type: 'orderedList', content: [
      { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'first' }] }] },
      { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'second' }] }] },
    ] }] }
    assert.equal(adfToMarkdown(ordered), '1. first\n2. second')
  })

  test('codeBlock preserves the language and fenced body', () => {
    const doc = { content: [{ type: 'codeBlock', attrs: { language: 'js' }, content: [{ type: 'text', text: "console.log('hi')" }] }] }
    assert.equal(adfToMarkdown(doc), "```js\nconsole.log('hi')\n```")
  })

  test('blockquote prefixes every line with >', () => {
    const doc = { content: [{ type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'quoted' }] }] }] }
    assert.equal(adfToMarkdown(doc), '> quoted')
  })

  test('rule and hardBreak', () => {
    assert.equal(adfToMarkdown({ content: [{ type: 'rule' }] }), '---')
    const doc = { content: [{ type: 'paragraph', content: [
      { type: 'text', text: 'line one' }, { type: 'hardBreak' }, { type: 'text', text: 'line two' },
    ] }] }
    assert.equal(adfToMarkdown(doc), 'line one\nline two')
  })

  test('mention falls back to attrs.text, then a synthesized @id', () => {
    assert.equal(adfToMarkdown({ content: [{ type: 'mention', attrs: { text: '@ada' } }] }), '@ada')
    assert.equal(adfToMarkdown({ content: [{ type: 'mention', attrs: { id: '123' } }] }), '@123')
  })

  test('an unknown node type falls through to its child content instead of vanishing', () => {
    const doc = { content: [{ type: 'someFutureNode', content: [{ type: 'text', text: 'still here' }] }] }
    assert.equal(adfToMarkdown(doc), 'still here')
  })
})

// =============================================================================
// markdownToAdf — the write-direction inverse of adfToMarkdown (LIN-1886 Step 1)
// =============================================================================

describe('markdownToAdf', () => {
  test('null/undefined/blank → an empty doc', () => {
    assert.deepEqual(markdownToAdf(null), { type: 'doc', version: 1, content: [] })
    assert.deepEqual(markdownToAdf(undefined), { type: 'doc', version: 1, content: [] })
    assert.deepEqual(markdownToAdf('   '), { type: 'doc', version: 1, content: [] })
  })

  test('round-trips through adfToMarkdown for every modeled node type', () => {
    const md = [
      '# Round trip',
      'plain **bold** and _em_ and `code` and ~~strike~~ and [a link](https://example.com)',
      '- one\n- two',
      '1. first\n2. second',
      '```js\nconsole.log(1)\n```',
      '> quoted',
      '---',
      'line one\nline two',
    ]
    for (const original of md) {
      const roundTripped = adfToMarkdown(markdownToAdf(original))
      assert.equal(roundTripped, original, `round trip failed for: ${JSON.stringify(original)}`)
    }
  })

  test('a full multi-block document round-trips as a whole', () => {
    const original = [
      '# Title',
      'A paragraph with **bold** text.',
      '- item one\n- item two',
      '```js\nconst x = 1\n```',
    ].join('\n\n')
    assert.equal(adfToMarkdown(markdownToAdf(original)), original)
  })

  test('never throws on unsupported Markdown — degrades to a plain paragraph', () => {
    assert.doesNotThrow(() => markdownToAdf('| a | b |\n| - | - |\n| 1 | 2 |'))
    const adf = markdownToAdf('| a | b |')
    assert.equal(adf.content[0].type, 'paragraph')
  })
})

// =============================================================================
// adfHasUnrenderableContent — D1 policy detection (LIN-1886 Step 1)
// =============================================================================

describe('adfHasUnrenderableContent', () => {
  test('false for a doc using only modeled nodes and modeled marks', () => {
    const doc = {
      type: 'doc', version: 1, content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'bold', marks: [{ type: 'strong' }] }] },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Title' }] },
        { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }] }] },
      ],
    }
    assert.equal(adfHasUnrenderableContent(doc), false)
  })

  test('null/undefined/non-object doc → false', () => {
    assert.equal(adfHasUnrenderableContent(null), false)
    assert.equal(adfHasUnrenderableContent(undefined), false)
  })

  for (const nodeType of ['table', 'media', 'panel', 'taskList', 'status', 'date']) {
    test(`true for a doc containing a bare '${nodeType}' node`, () => {
      const doc = { type: 'doc', version: 1, content: [{ type: nodeType, content: [] }] }
      assert.equal(adfHasUnrenderableContent(doc), true)
    })
  }

  test('true when the unmodeled node is nested inside otherwise-modeled structure (proves recursion)', () => {
    const doc = {
      type: 'doc', version: 1, content: [
        { type: 'bulletList', content: [
          { type: 'listItem', content: [
            { type: 'blockquote', content: [
              { type: 'table', content: [] },
            ] },
          ] },
        ] },
      ],
    }
    assert.equal(adfHasUnrenderableContent(doc), true)
  })

  test('true for a paragraph carrying an unmodeled MARK only (no unmodeled node anywhere) — proves mark-walking, not just node-type walking', () => {
    const underline = {
      type: 'doc', version: 1, content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'underline' }] }] },
      ],
    }
    assert.equal(adfHasUnrenderableContent(underline), true)

    const textColor = {
      type: 'doc', version: 1, content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'textColor', attrs: { color: '#ff0000' } }] }] },
      ],
    }
    assert.equal(adfHasUnrenderableContent(textColor), true)
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

  test('getCreateTaskUrl builds a project-scoped deep link when a site + projectId are known', () => {
    const p = new JiraProvider({ site: SITE })
    assert.equal(p.getCreateTaskUrl('urlKey', '10001'), `${SITE}/secure/CreateIssue.jspa?pid=10001`)
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

  test('fetchTeams always returns [] (capability teams:false)', async () => {
    assert.deepEqual(await provider.fetchTeams({ email: 'a@b.com', apiToken: 't', site: SITE }), [])
  })

  test('fetchProjects returns canonical projects + issues, stamped with SOURCE_JIRA', async () => {
    const scope = { email: 'a@b.com', apiToken: 't', site: SITE }
    const result = await provider.fetchProjects(scope)
    assert.equal(result.organizationName, 'acme')
    assert.equal(result.projects.length, 1)
    assert.equal(result.projects[0].id, '10001')
    assert.equal(result.projects[0].url, `${SITE}/browse/ENG`, 'project url is the browsable /browse/ link, never the raw REST resource URL (project.self)')
    assert.equal(result.issues.length, 2)
    for (const issue of result.issues) assert.equal(issue.source, SOURCE_JIRA)

    const parent = result.issues.find(i => i.identifier === 'ENG-1')
    assert.equal(parent.title, 'Parent story')
    assert.equal(parent.description, 'A parent issue.')
    assert.equal(parent.state.type, 'started')
    assert.equal(parent.url, `${SITE}/browse/ENG-1`)
    assert.equal(parent.assignee.name, 'Ada Lovelace')
    assert.deepEqual(parent.labels.nodes, [{ name: 'backend' }])
    assert.equal(parent.id, '20001', 'the immutable issue id is the primary identity, key is human-readable only')

    const child = result.issues.find(i => i.identifier === 'ENG-2')
    assert.equal(child.state.type, 'completed')
    assert.equal(child.completedAt, '2026-01-04T00:00:00.000Z')
    assert.deepEqual(child.parent, { id: '20001', identifier: 'ENG-1' })
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

  test('fetchProjectsList returns the same canonical projects fetchProjects emits (LIN-1886 Step 2)', async () => {
    const scope = { email: 'a@b.com', apiToken: 't', site: SITE }
    const projects = await provider.fetchProjectsList(scope)
    assert.equal(projects.length, 1)
    assert.equal(projects[0].id, '10001')
    assert.equal(projects[0].url, `${SITE}/browse/ENG`)
  })
})

// =============================================================================
// jiraStateIdToCanonicalType — the reverse of jiraStatusCategoryToCanonical
// (LIN-1886 Step 2, mirrors githubStateIdToCanonicalType)
// =============================================================================

describe('jiraStateIdToCanonicalType', () => {
  test('maps the three synthetic states() ids to their canonical types', () => {
    assert.equal(jiraStateIdToCanonicalType('todo'), 'unstarted')
    assert.equal(jiraStateIdToCanonicalType('in-progress'), 'started')
    assert.equal(jiraStateIdToCanonicalType('done'), 'completed')
  })

  test('an unknown id (e.g. a UUID that slipped the routes\' UUID fast-path) throws a 422-shaped RefResolutionError', () => {
    assert.throws(() => jiraStateIdToCanonicalType('11111111-1111-1111-1111-111111111111'), err => {
      assert.ok(err instanceof RefResolutionError)
      assert.equal(err.status, 422)
      return true
    })
  })

  test('there is no id mapping to canceled/duplicate — those categories are unreachable from Jira\'s statusCategory vocabulary', () => {
    for (const id of ['todo', 'in-progress', 'done']) {
      const type = jiraStateIdToCanonicalType(id)
      assert.notEqual(type, 'canceled')
      assert.notEqual(type, 'duplicate')
    }
  })
})

// =============================================================================
// Step 2 — states()/labels()/route-internal reads (LIN-1886)
// =============================================================================

describe('JiraProvider Step 2 reads (fake client)', () => {
  let provider

  beforeEach(() => {
    ({ provider } = seededProvider())
  })

  test('states() returns the fixed synthetic todo/in-progress/done vocabulary, never real per-workflow status names', async () => {
    const scope = { email: 'a@b.com', apiToken: 't', site: SITE }
    const states = await provider.states(scope, null)
    assert.deepEqual(states.map(s => s.id), ['todo', 'in-progress', 'done'])
    assert.deepEqual(states.map(s => s.type), ['unstarted', 'started', 'completed'])
    for (const s of states) {
      assert.equal(typeof s.name, 'string')
      assert.equal(typeof s.position, 'number')
    }
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
    issues: [
      {
        id: '30001', key: 'ENG-10',
        fields: {
          summary: 'Writable issue',
          description: { type: 'doc', version: 1, content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Plain description.' }] },
          ] },
          status: { name: 'To Do', statusCategory: { key: 'new' } },
          project: { id: '10001', key: 'ENG', name: 'Engineering' },
          created: '2026-01-01T00:00:00.000Z', duedate: null, resolutiondate: null,
          labels: ['bug'], assignee: null, parent: null,
          _transitions: [
            { id: '11', name: 'Start Progress', to: { name: 'In Progress', statusCategory: { key: 'indeterminate' } } },
            { id: '21', name: 'Done', to: { name: 'Done', statusCategory: { key: 'done' } } },
          ],
        },
      },
      {
        id: '30002', key: 'ENG-11', // unrenderable description: an unmodeled NODE (table)
        fields: {
          summary: 'Issue with a table in its description',
          description: { type: 'doc', version: 1, content: [{ type: 'table', content: [] }] },
          status: { name: 'To Do', statusCategory: { key: 'new' } },
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
          status: { name: 'To Do', statusCategory: { key: 'new' } },
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
          status: { name: 'Done', statusCategory: { key: 'done' } },
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
          status: { name: 'To Do', statusCategory: { key: 'new' } },
          project: { id: '10001', key: 'ENG', name: 'Engineering' },
          created: '2026-01-01T00:00:00.000Z', duedate: null, resolutiondate: null,
          labels: [], assignee: null, parent: null,
          _transitions: [
            { id: '31', name: 'Resolve', to: { name: 'Done', statusCategory: { key: 'done' } }, fields: { resolution: { required: true } } },
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

  test('D2: happy-path status transition (todo → in-progress) actually moves the issue', async () => {
    const issue = await provider.updateIssue(SCOPE, 'ENG-10', { stateId: 'in-progress' })
    assert.equal(issue.state.type, 'started')
  })

  test('D2: happy-path status transition (todo → done)', async () => {
    const issue = await provider.updateIssue(SCOPE, 'ENG-10', { stateId: 'done' })
    assert.equal(issue.state.type, 'completed')
  })

  test('D2: a same-category stateId is a SKIPPED no-op — no getTransitions/doTransition call at all', async () => {
    let getTransitionsCalls = 0
    const originalGetTransitions = client.getTransitions.bind(client)
    client.getTransitions = async (...args) => { getTransitionsCalls += 1; return originalGetTransitions(...args) }

    const issue = await provider.updateIssue(SCOPE, 'ENG-10', { stateId: 'todo' })
    assert.equal(issue.state.type, 'unstarted')
    assert.equal(getTransitionsCalls, 0, 'the current type already matched — no transitions call should have been made')
  })

  test('a title-only patch leaves status untouched (no stateId in the patch at all)', async () => {
    const before = await provider.fetchIssueFields(SCOPE, 'ENG-10')
    const issue = await provider.updateIssue(SCOPE, 'ENG-10', { title: 'Only the title changes' })
    assert.equal(issue.state.type, before.state.type)
  })

  test('D2: no available transition to the target category → 422, never a silent no-op', async () => {
    // ENG-13 is `done` with an EMPTY _transitions list; targeting `todo` finds nothing.
    await assert.rejects(
      () => provider.updateIssue(SCOPE, 'ENG-13', { stateId: 'todo' }),
      err => {
        assert.ok(err instanceof RefResolutionError)
        assert.equal(err.status, 422)
        return true
      }
    )
  })

  test('D2: a screen-required transition refuses (422) rather than attempting a screen-driven update', async () => {
    await assert.rejects(
      () => provider.updateIssue(SCOPE, 'ENG-14', { stateId: 'done' }),
      err => {
        assert.ok(err instanceof RefResolutionError)
        assert.equal(err.status, 422)
        return true
      }
    )
  })

  test('D2: a symbolic stateId of "canceled"/"duplicate" is refused (422) — Jira has no such statusCategory, never silently folds to done', async () => {
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
