/**
 * Unit tests for routes/jira-auth.js (LIN-1885, Phase 1 of LIN-275).
 *
 * The Jira link flow is synchronous validate-then-link (no OAuth round-trip),
 * so unlike GitHub/GitHub Projects there is no callback/state-guard surface to
 * test — just GET (render the form for a workspace) and POST (probe via the
 * fake client, then write the binding). Never live Jira: the router is driven
 * against a JiraProvider whose clientFactory returns lib/providers/jira/
 * fake-client.js.
 *
 * Run with: node --test tests/unit/jira-auth.test.js
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MangoClient } from '@jkershaw/mangodb'
import { createJiraAuthRoutes } from '../../routes/jira-auth.js'
import { JiraProvider } from '../../lib/providers/jira/index.js'
import { createFakeJiraClient } from '../../lib/providers/jira/fake-client.js'
import { AccountStore } from '../../lib/account-store.js'
import { AccountWorkspaceStore } from '../../lib/account-workspace-store.js'

const SITE = 'https://acme.atlassian.net'

function workingProvider() {
  const client = createFakeJiraClient({})
  client.getMyself = async () => ({ accountId: 'jira-acct-1', emailAddress: 'ada@acme.com', displayName: 'Ada Lovelace' })
  return new JiraProvider({ clientFactory: () => client })
}

function badCredentialProvider() {
  const client = createFakeJiraClient({})
  client.getMyself = async () => { throw Object.assign(new Error('Jira API GET /rest/api/3/myself failed: unauthorized'), { status: 401 }) }
  return new JiraProvider({ clientFactory: () => client })
}

function getHandler(router, method, path) {
  const layer = router.stack.find(l => l.route?.path === path && l.route.methods[method])
  assert.ok(layer, `${method.toUpperCase()} ${path} route is registered`)
  return layer.route.stack[layer.route.stack.length - 1].handle
}

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    redirectedTo: null,
    status(code) { this.statusCode = code; return this },
    send(html) { this.body = html; return this },
    redirect(url) { this.redirectedTo = url; return this },
  }
}

function makeSession(initial = {}) {
  return {
    ...initial,
    save(cb) { if (cb) cb() },
  }
}

describe('routes/jira-auth.js', () => {
  let dbClient
  let dbDir
  let acctCounter = 0

  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'jira-auth-route-'))
    dbClient = new MangoClient(dbDir)
    await dbClient.connect()
  })
  after(async () => {
    if (dbClient?.close) await dbClient.close()
    if (dbDir) rmSync(dbDir, { recursive: true, force: true })
  })
  function freshAccountStores() {
    const db = dbClient.db(`acct_${acctCounter++}`)
    return {
      accountStore: new AccountStore({ collection: db.collection('accounts') }),
      accountWorkspaceStore: new AccountWorkspaceStore({ collection: db.collection('account-workspaces') }),
    }
  }

  describe('GET /auth/jira', () => {
    test('400s with no ?workspace', async () => {
      const router = createJiraAuthRoutes({ provider: workingProvider(), ...freshAccountStores() })
      const handler = getHandler(router, 'get', '/auth/jira')
      const res = makeRes()
      await handler({ query: {}, session: makeSession({ workspaces: [] }) }, res)
      assert.equal(res.statusCode, 400)
      assert.match(res.body, /No Workspace Selected/)
    })

    test('400s when the named workspace is not in this session', async () => {
      const router = createJiraAuthRoutes({ provider: workingProvider(), ...freshAccountStores() })
      const handler = getHandler(router, 'get', '/auth/jira')
      const res = makeRes()
      await handler({ query: { workspace: 'acme' }, session: makeSession({ workspaces: [] }) }, res)
      assert.equal(res.statusCode, 400)
    })

    test('renders the link form, carrying the target workspace as a hidden field', async () => {
      const router = createJiraAuthRoutes({ provider: workingProvider(), ...freshAccountStores() })
      const handler = getHandler(router, 'get', '/auth/jira')
      const res = makeRes()
      const session = makeSession({ workspaces: [{ id: 'ws-1', name: 'Acme', urlKey: 'acme' }] })
      await handler({ query: { workspace: 'acme' }, session }, res)
      assert.equal(res.statusCode, 200)
      assert.match(res.body, /data-testid="jira-link-form"/)
      assert.match(res.body, /name="workspace" value="acme"/)
    })
  })

  describe('POST /auth/jira/link', () => {
    test('400s when email/apiToken/site are missing', async () => {
      const router = createJiraAuthRoutes({ provider: workingProvider(), ...freshAccountStores() })
      const handler = getHandler(router, 'post', '/auth/jira/link')
      const res = makeRes()
      const session = makeSession({ workspaces: [{ id: 'ws-1', name: 'Acme', urlKey: 'acme' }] })
      await handler({ body: { workspace: 'acme', email: 'a@b.com' }, session }, res)
      assert.equal(res.statusCode, 400)
      assert.match(res.body, /required/)
      assert.equal(session.workspaces[0].provider, undefined, 'no binding written')
    })

    test('400s when the target workspace is not in this session', async () => {
      const router = createJiraAuthRoutes({ provider: workingProvider(), ...freshAccountStores() })
      const handler = getHandler(router, 'post', '/auth/jira/link')
      const res = makeRes()
      const session = makeSession({ workspaces: [] })
      await handler({ body: { workspace: 'nope', email: 'a@b.com', apiToken: 't', site: SITE }, session }, res)
      assert.equal(res.statusCode, 400)
      assert.match(res.body, /No Active Workspace/)
    })

    test('a failed credential probe 400s and writes NO binding (validate-before-link)', async () => {
      const { accountStore, accountWorkspaceStore } = freshAccountStores()
      const router = createJiraAuthRoutes({ provider: badCredentialProvider(), accountStore, accountWorkspaceStore })
      const handler = getHandler(router, 'post', '/auth/jira/link')
      const res = makeRes()
      const session = makeSession({ workspaces: [{ id: 'ws-1', name: 'Acme', urlKey: 'acme' }] })
      await handler({ body: { workspace: 'acme', email: 'a@b.com', apiToken: 'bad-token', site: SITE }, session }, res)
      assert.equal(res.statusCode, 400)
      assert.match(res.body, /Could not authenticate with Jira/)
      assert.equal(session.workspaces[0].provider, undefined)
      assert.equal(session.accountId, undefined)
    })

    test('a successful probe links the binding onto the named workspace, stamps MAX_SAFE_INTEGER, and establishes the account', async () => {
      const { accountStore, accountWorkspaceStore } = freshAccountStores()
      const router = createJiraAuthRoutes({ provider: workingProvider(), accountStore, accountWorkspaceStore })
      const handler = getHandler(router, 'post', '/auth/jira/link')
      const res = makeRes()
      const session = makeSession({ workspaces: [{ id: 'ws-1', name: 'Acme', urlKey: 'acme' }] })

      await handler({ body: { workspace: 'acme', email: 'ada@acme.com', apiToken: 'tok-123', site: `${SITE}/` }, session }, res)

      assert.equal(res.redirectedTo, '/workspace/acme/settings?provider_ok=jira')

      const ws = session.workspaces[0]
      assert.equal(ws.provider, 'jira')
      // Trailing slash stripped before it becomes the binding scope.
      assert.deepEqual(ws.bindings, [{
        provider: 'jira', scope: SITE,
        credentials: { token: 'tok-123', email: 'ada@acme.com', tokenExpiresAt: Number.MAX_SAFE_INTEGER },
      }])
      // Both projections carry the stamp — the scalar mirror (headless resolve reads this)...
      assert.equal(ws.tokenExpiresAt, Number.MAX_SAFE_INTEGER)
      // ...and the binding's own credentials (mirrorActiveBinding reads THIS on a provider switch).
      assert.equal(ws.bindings[0].credentials.tokenExpiresAt, Number.MAX_SAFE_INTEGER)

      assert.ok(session.accountId, 'session.accountId set by establishAccount')
      const account = await accountStore.getAccount(session.accountId)
      assert.deepEqual(account.identities, [{
        provider: 'jira', scope: 'jira-acct-1',
        credentials: { email: 'ada@acme.com', displayName: 'Ada Lovelace' },
      }])
      const workspaces = await accountWorkspaceStore.listWorkspacesForAccount(session.accountId)
      assert.deepEqual(workspaces, ['ws-1'])
    })

    test('a returning Jira identity (fresh session, previously-seen accountId) lands on their EXISTING account', async () => {
      const { accountStore, accountWorkspaceStore } = freshAccountStores()
      const router = createJiraAuthRoutes({ provider: workingProvider(), accountStore, accountWorkspaceStore })
      const handler = getHandler(router, 'post', '/auth/jira/link')

      const firstSession = makeSession({ workspaces: [{ id: 'ws-1', name: 'Acme', urlKey: 'acme' }] })
      await handler({ body: { workspace: 'acme', email: 'ada@acme.com', apiToken: 'tok-1', site: SITE }, session: firstSession }, makeRes())
      const firstAccountId = firstSession.accountId

      // A second, unrelated fresh session links the SAME Jira human onto a different workspace.
      const secondSession = makeSession({ workspaces: [{ id: 'ws-2', name: 'Other', urlKey: 'other' }] })
      await handler({ body: { workspace: 'other', email: 'ada@acme.com', apiToken: 'tok-2', site: SITE }, session: secondSession }, makeRes())

      assert.equal(secondSession.accountId, firstAccountId, 'same Jira human resolves to the same durable account')
      const workspaces = await accountWorkspaceStore.listWorkspacesForAccount(firstAccountId)
      assert.deepEqual(workspaces.sort(), ['ws-1', 'ws-2'])
    })
  })
})
