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
  adfToMarkdown,
} from '../../lib/providers/jira/index.js'
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
// Capability profile + registration
// =============================================================================

describe('JiraProvider capability profile', () => {
  test('registers under "jira" at module load', () => {
    assert.strictEqual(getProvider('jira'), jiraProvider)
    assert.equal(jiraProvider.name, 'jira')
  })

  test('implements exactly the Phase 1 read surface', () => {
    const p = new JiraProvider()
    assert.equal(p.supports('fetchProjects'), true)
    assert.equal(p.supports('fetchTeams'), true)
    assert.equal(p.supports('fetchIssueContext'), true)
    assert.equal(p.supports('fetchIssueComments'), true)
    assert.equal(p.supports('fetchIssueFields'), true, 'backs the dashboard lazy per-issue detail load, LIN-442')
    // Writes are declared-but-unimplemented this phase.
    assert.equal(p.supports('createIssue'), false)
    assert.equal(p.supports('updateIssue'), false)
    assert.equal(p.supports('createComment'), false)
  })

  test('ui surface: write true (external create link) decoupled from inlineCreate false', () => {
    const p = new JiraProvider({ site: SITE })
    assert.equal(p.ui.write, true, 'getCreateTaskUrl is overridden')
    assert.equal(p.ui.inlineCreate, false, 'createIssue is not implemented this phase')
    assert.equal(p.ui.inlineEdit, false, 'updateIssue is not implemented this phase')
    assert.equal(p.ui.comments, true)
    assert.equal(p.ui.estimates, false)
    assert.equal(p.ui.subtasks, true)
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

  test('unimplemented writes still throw NotImplementedError (capability-gated decline)', () => {
    assert.throws(() => provider.createIssue({}, {}), NotImplementedError)
    assert.throws(() => provider.updateIssue({}, 'ENG-1', {}), NotImplementedError)
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
