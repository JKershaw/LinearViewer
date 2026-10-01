/**
 * LIN-3125 Phase 3 — the held-connection picker route.
 *
 * `GET /connect/:provider/held` is where the `/auth/github` held-entry hook
 * (`lib/github-install-flow.js`, §D-F1) sends an EXPLICIT add-source / new-
 * workspace click that can be served from an already-held Connection;
 * `POST /connect/:provider/held/bind` writes the chosen scope through the same
 * held-mode `persistBinding` seam.
 *
 * The picker reads the server-side intent from `req.session.heldEntry` only —
 * never the query (LIN-2882 lesson) — and resolves `:provider` through the
 * registry, so it imports neither a provider index (no fifth provider→routes
 * edge) nor a connection-store/credential module (C1: every store/credential
 * capability and the D11 predicate arrive by injection from `server.js`).
 *
 * GET (beat 3):
 *   - D11 off ⇒ redirect to `heldEntry.beginUrl`, zero reads (F2);
 *   - missing/expired `heldEntry` ⇒ Session Expired;
 *   - the account's AUTHORIZED held connections via the injected C1 reader;
 *   - a stale installation token is refreshed ONCE per connection before
 *     enumeration; a failed refresh/enumeration drops that connection;
 *   - scopes are mapped with the provider's `heldScopeView`, already-bound
 *     scopes excluded, and the server-side offer map (`scope -> connectionId`)
 *     stashed on `heldEntry.offered` — only offered scopes can be POSTed;
 *   - rendered through the LIN-2820 renderer via the new `formAction` option.
 *
 * POST (add-source; `mode=new` is beat 4):
 *   - D11 re-check; `scope` must be in the offer map (or already bound);
 *   - the connection row is re-read + authorized via the injected reader
 *     (a deleted/racing/foreign connection ⇒ 409, no partial binding);
 *   - persistence is `persistBinding({ heldConnectionId })` (C3: retryable on
 *     any failure, never a legacy write, no credential on the binding);
 *   - `providerAdded` flash + the settings redirect; `heldEntry` cleared.
 */
import crypto from 'node:crypto'
import { Router } from 'express'
import { renderErrorPage, renderWorkspaceLimitPage, renderGitHubRepoSelectPage, renderGitHubProjectSelectPage } from '../lib/render-pages.js'
import { getProvider } from '../lib/providers/registry.js'
import { getWorkspaceByUrlKey, upsertWorkspace } from '../lib/workspace.js'
import { persistBinding } from '../lib/persist-binding.js'
import { TOKEN_REFRESH_BUFFER_MS } from '../lib/workspace-token-resolver.js'
import { deriveGithubFreshUrlKey } from '../lib/github-install-flow.js'

/**
 * The two held-capable surfaces (the only providers declaring
 * `listConnectionScopes`). A local map, not a provider import: it selects the
 * LIN-2820 renderer, the picker form field, the `provider_ok` value, and the
 * heldScopeView -> renderer-row adapter. Copy (display names, scope nouns)
 * always comes from the provider, never from here.
 */
const SURFACES = {
  github: {
    render: renderGitHubRepoSelectPage,
    field: 'repo',
    providerOkKey: 'github',
    row: (view) => ({ slug: view.scope, name: view.label, private: view.detail === 'private', installationId: view.installationId }),
  },
  'github-projects': {
    render: renderGitHubProjectSelectPage,
    field: 'board',
    providerOkKey: 'github-projects',
    row: (view) => {
      const [login, number] = String(view.scope).split('/')
      return { login, number, title: view.label, shortDescription: view.detail ?? null, installationId: view.installationId }
    },
  },
}

/** English plural for the registry `scopeType` singular (repository -> repositories). */
function pluralize(scopeType) {
  const s = String(scopeType || 'source')
  return /[^aeiou]y$/.test(s) ? `${s.slice(0, -1)}ies` : `${s}s`
}

function displayNameOf(provider) {
  return provider.ui?.displayName || provider.name
}

function sessionExpired(res) {
  return res.status(400).send(renderErrorPage('Session Expired', 'Your connection session expired. Please start again.', {
    action: 'Go to homepage', actionUrl: '/',
  }))
}

/**
 * The held empty / all-failed / unavailable pages. Registry copy only
 * (`displayName`, `scopeType`); the "connect a different account" link is a
 * BARE emitter (the unmarked `heldEntry.beginUrl`), so a fall-through never
 * re-enters the held path.
 */
function renderHeldState(res, { provider, heldEntry, title, message, status = 200 }) {
  return res.status(status).send(renderErrorPage(title, message, {
    action: `Connect a different ${displayNameOf(provider)} account`,
    actionUrl: heldEntry.beginUrl || '/',
  }))
}

/**
 * @param {Object} [deps]
 * @param {(name: string) => Object|undefined} [deps.resolveProvider] - registry lookup (injectable for tests)
 * @param {Object} [deps.connectionStore] - injected store instance (held-mode `persistBinding` passthrough + C2 referent compensation)
 * @param {Object} [deps.accountWorkspaceStore] - injected edge writer (F8 owner edge; no import)
 * @param {Function} [deps.listAuthorizedAccountConnections] - injected C1 reader (connectionStore bound in server.js)
 * @param {Function} [deps.heldConnectionCredentials] - injected seam reader for a held row's credentials (button: `lib/connection-credential.js`)
 * @param {Function} [deps.connectionBackedWritesEnabled] - D11 predicate (read per request)
 * @param {Function} [deps.refreshConnection] - the single connection refresher `(connectionId, accountId) => Promise<{token, expiresAt}|null>`
 * @param {Function} [deps.convertToConnectionBacked] - injected converter for `persistBinding`
 * @param {Function} [deps.resolveCanonicalAccountId]
 * @param {{title: string, message: string}} [deps.connectionRetry] - the canonical retry copy
 * @param {Function} [deps.now]
 * @returns {Router} Express router
 */
export function createHeldConnectionRoutes({
  resolveProvider = getProvider,
  connectionStore,
  accountWorkspaceStore,
  listAuthorizedAccountConnections,
  heldConnectionCredentials,
  connectionBackedWritesEnabled = () => true,
  refreshConnection,
  convertToConnectionBacked,
  resolveCanonicalAccountId = (id) => id,
  connectionRetry = { title: 'Connection Not Saved', message: 'We could not finish saving this connection. Anything already connected is unchanged. Please try again in a moment.' },
  now = () => Date.now(),
} = {}) {
  const router = Router()
  const writesEnabled = () => (typeof connectionBackedWritesEnabled === 'function' ? connectionBackedWritesEnabled() : true)

  /** Resolve a held-capable provider, or null (404 for the caller). */
  function resolveHeldProvider(name) {
    const provider = typeof resolveProvider === 'function' ? resolveProvider(name) : null
    if (!provider || typeof provider.supports !== 'function' || !provider.supports('listConnectionScopes')) return null
    if (!SURFACES[provider.name]) return null
    return provider
  }

  router.get('/connect/:provider/held', async (req, res) => {
    const provider = resolveHeldProvider(req.params.provider)
    if (!provider) {
      return res.status(404).send(renderErrorPage('Not Found', 'This provider does not support adding a source from a held connection.', {
        action: 'Go to homepage', actionUrl: '/',
      }))
    }
    const heldEntry = req?.session?.heldEntry
    if (!heldEntry || heldEntry.provider !== provider.name) return sessionExpired(res)

    // D11 (F2): off ⇒ back to today's bare flow, zero reads. The held entry is
    // kept (the picker test pins this); the POST D11 exit is the terminal one
    // that consumes it.
    if (!writesEnabled()) return res.redirect(heldEntry.beginUrl || '/')

    const isNew = heldEntry.mode === 'new'

    const workspace = (!isNew && heldEntry.workspaceUrlKey) ? getWorkspaceByUrlKey(req.session, heldEntry.workspaceUrlKey) : null
    // L8 (finding 11): the add-source workspace vanished between the click and
    // this GET. Falling through to a dead Session Expired page strands the user;
    // return to the bare begin flow (heldEntry.beginUrl) instead.
    if (!isNew && !workspace) return res.redirect(heldEntry.beginUrl || '/')

    let accountId
    try { accountId = await resolveCanonicalAccountId(req.session.accountId) } catch { accountId = null }
    if (!accountId) return sessionExpired(res)

    const connections = await listAuthorizedAccountConnections({ accountId, provider: provider.name })

    const offers = {}
    const rows = []
    let failed = 0
    let succeeded = 0
    let truncated = false

    for (const connection of connections) {
      // Held credentials arrive through the injected seam reader, so this route
      // never performs a raw `.credentials` read (D15 census stays 13).
      let creds = heldConnectionCredentials(connection)
      // Refresh a STALE installation token once before enumeration. A fresh
      // token is used as-is so adds #2/#3 incur no auth/install activity.
      const expiresAt = creds.tokenExpiresAt
      if (Number.isFinite(expiresAt) && expiresAt <= now() + TOKEN_REFRESH_BUFFER_MS) {
        let refreshed = null
        try { refreshed = await refreshConnection?.(connection._id, accountId) } catch (err) { console.error('[held-connection] token refresh failed:', err) }
        if (!refreshed?.token) { failed += 1; continue }
        creds = { ...creds, token: refreshed.token, tokenExpiresAt: refreshed.expiresAt }
      }

      let scopes
      try { scopes = await provider.listConnectionScopes(creds) } catch (err) {
        // suspended / uninstalled / revoked (401/403/404) or any read failure:
        // never selectable, omitted — a "failed connection".
        failed += 1
        console.error('[held-connection] scope enumeration failed:', err?.message || err)
        continue
      }
      succeeded += 1
      if (scopes?.truncated) truncated = true

      for (const item of Array.isArray(scopes) ? scopes : []) {
        const view = provider.heldScopeView(item)
        if (!view?.scope) continue
        if ((workspace?.bindings || []).some(b => b && b.provider === provider.name && b.scope === view.scope)) continue // already bound
        if (Object.prototype.hasOwnProperty.call(offers, view.scope)) { console.warn(`[held-connection] scope ${view.scope} offered by more than one connection; keeping the first`); continue }
        offers[view.scope] = connection._id
        rows.push(SURFACES[provider.name].row(view))
      }
    }

    if (rows.length === 0) {
      const allFailed = connections.length > 0 && failed === connections.length
      const name = displayNameOf(provider)
      if (allFailed) {
        return renderHeldState(res, { provider, heldEntry, status: 502, title: 'Connection Unavailable', message: `We couldn't reach your ${name} connection. It may have been removed or suspended on ${name}.` })
      }
      return renderHeldState(res, { provider, heldEntry, title: 'No Sources Available', message: `No ${pluralize(provider.scopeType)} available from your connected ${name} accounts.` })
    }

    req.session.heldEntry = { ...heldEntry, offered: offers }
    const html = SURFACES[provider.name].render(rows, {
      mode: heldEntry.mode,
      truncated,
      formAction: `/connect/${encodeURIComponent(provider.name)}/held/bind`,
    })
    return saveThen(req, () => res.send(html))
  })

  router.post('/connect/:provider/held/bind', async (req, res) => {
    const provider = resolveHeldProvider(req.params.provider)
    if (!provider) {
      return res.status(404).send(renderErrorPage('Not Found', 'This provider does not support adding a source from a held connection.', {
        action: 'Go to homepage', actionUrl: '/',
      }))
    }
    const heldEntry = req?.session?.heldEntry
    if (!heldEntry || heldEntry.provider !== provider.name) return sessionExpired(res)

    const surface = SURFACES[provider.name]
    const pickerUrl = `/connect/${encodeURIComponent(provider.name)}/held`
    const retryPage = (r) => r.status(503).send(renderErrorPage(connectionRetry.title, connectionRetry.message, { action: `Back to ${displayNameOf(provider)}`, actionUrl: pickerUrl }))

    // D11 (F2): off ⇒ retryable page with a link back to the bare begin flow,
    // zero writes and no legacy fallback (held mode has no credential to copy).
    // L1: the held intent cannot proceed, so consume it; the action returns the
    // user to the bare (unmarked) flow rather than a now-empty picker.
    if (!writesEnabled()) {
      const actionUrl = heldEntry.beginUrl || pickerUrl
      delete req.session.heldEntry
      return res.status(503).send(renderErrorPage(connectionRetry.title, connectionRetry.message, { action: `Back to ${displayNameOf(provider)}`, actionUrl }))
    }

    const scope = String(req.body?.[surface.field] ?? '').trim()
    let accountId
    try { accountId = await resolveCanonicalAccountId(req.session.accountId) } catch { accountId = null }
    if (!accountId) return sessionExpired(res)

    const isNew = heldEntry.mode === 'new'

    if (!isNew) {
      const workspace = heldEntry.workspaceUrlKey ? getWorkspaceByUrlKey(req.session, heldEntry.workspaceUrlKey) : null
      if (!workspace) return sessionExpired(res)
      // Already bound ⇒ idempotent: keep the existing binding, no write, no
      // downgrade, and land exactly like a fresh add.
      const existing = (workspace.bindings || []).find(b => b && b.provider === provider.name && b.scope === scope)
      if (existing) return finishAdd(req, res, { provider, surface, workspace, scope })
      return bindAddSource(req, res, { provider, surface, heldEntry, workspace, scope, accountId, pickerUrl, retryPage })
    }

    // Held NEW workspace (§D-F3/F8). Only `github` reaches here: the shared
    // `intent.fresh` predicate requires `supportsFreshContainer`, which
    // github-projects does not declare, so `resolveHeldEntry` never returns a
    // `mode=new` target for it.
    const connectionId = await authorizedOfferedConnection({ req, accountId, provider, heldEntry, scope, pickerUrl, res })
    if (typeof connectionId !== 'string') return // response already sent

    const repoName = String(scope).split('/').pop()
    const container = {
      id: crypto.randomUUID(),
      name: repoName,
      urlKey: deriveGithubFreshUrlKey(repoName, req.session.workspaces),
      addedAt: Date.now(),
      // F3: provider is set so `rewriteAsConnectionBacked` flips the active
      // binding (linkProvider's first-link rule is bypassed — it is never called).
      provider: provider.name,
    }

    // Phase 2 L4: snapshot a COPY of the live array, not the array itself
    // (`upsertWorkspace` mutates `session.workspaces` in place; the F3 restore
    // reassigns this copy back).
    const snapshot = [...(req.session.workspaces || [])]
    try {
      upsertWorkspace(req.session, container)
    } catch {
      // Identical 400 page as the credentials-mode flow; nothing else written,
      // no referent, no edge. L1: the held intent is terminal here (no room to
      // land the new workspace), so consume it.
      delete req.session.heldEntry
      return res.status(400).send(renderWorkspaceLimitPage())
    }

    let conversion
    try {
      conversion = await persistBinding({
        connectionStore, session: req.session, accountId, workspace: container,
        provider: provider.name, scope, heldConnectionId: connectionId,
        resolveCanonicalAccountId, writesEnabled: writesEnabled(), workspacesSnapshot: snapshot,
        convertToConnectionBacked,
      })
    } catch (err) {
      console.error('[held-connection] held new persist failed:', err)
      conversion = { connectionBacked: false, error: 'retryable' }
    }
    // C3: held conversion is retryable and never a legacy write; persistBinding
    // already restored the snapshot on failure.
    if (!conversion?.connectionBacked) return retryPage(res)

    // F8: the owner edge, written directly (NO establishAccount, so no
    // identityAuthenticatedAt freshness stamp — a held add proves no identity).
    let edge = null
    try { edge = await accountWorkspaceStore.bindAccountToWorkspace(accountId, container.id) } catch (err) { console.error('[held-connection] owner-edge write failed:', err) }
    // L4 (D7): `bindAccountToWorkspace` swallows a failed `_markOwnerIfFirstEdge`
    // and returns the edge WITHOUT `role:'owner'` (`account-workspace-store.js`).
    // A bound-but-ownerless workspace is the one C2 invariant the route must
    // never leave behind, so a non-owner edge takes the same compensation path.
    if (!edge || edge.role !== 'owner') {
      // C2: never leave a bound workspace ownerless. Compensate the referent the
      // converter just added, restore the session snapshot, show the retry page.
      try { await connectionStore.removeReferent(connectionId, { urlKey: container.urlKey, provider: provider.name, scope }) } catch (err) { console.error('[held-connection] referent compensation failed:', err) }
      req.session.workspaces = snapshot
      return retryPage(res)
    }

    req.session.providerAdded = { provider: surface.providerOkKey, scope }
    delete req.session.heldEntry
    return saveThen(req, () => res.redirect(`/workspace/${encodeURIComponent(container.urlKey)}/`))
  })

  /**
   * Validate the POST'd scope against the server-side offer map and re-read +
   * authorize the holding Connection. Returns the connectionId, or sends the
   * 409 page and returns null. Shared by add-source and mode=new.
   */
  async function authorizedOfferedConnection({ req, accountId, provider, heldEntry, scope, pickerUrl, res }) {
    const offeredConnectionId = heldEntry.offered?.[scope]
    if (!offeredConnectionId) {
      // L1: this is the empty-offer RETRY arm — the picker is still live, so
      // keep `heldEntry` and send the user back to it to choose another source.
      res.status(409).send(renderErrorPage('Source Unavailable', 'That source is no longer available. Please choose another.', { action: `Back to ${displayNameOf(provider)}`, actionUrl: pickerUrl }))
      return null
    }
    const connections = await listAuthorizedAccountConnections({ accountId, provider: provider.name })
    const connection = connections.find(c => c && c._id === offeredConnectionId)
    if (!connection) {
      // L1: terminal — the holding connection is gone, so consume the held
      // intent and return to the bare begin flow (the picker would be empty).
      const actionUrl = heldEntry.beginUrl || pickerUrl
      delete req.session.heldEntry
      res.status(409).send(renderErrorPage('Connection Unavailable', 'That connection is no longer available. Please start again.', { action: `Back to ${displayNameOf(provider)}`, actionUrl }))
      return null
    }
    return connection._id
  }

  /** Add-source held binding onto an EXISTING workspace (beat 3). */
  async function bindAddSource(req, res, { provider, surface, heldEntry, workspace, scope, accountId, pickerUrl, retryPage }) {
    const connectionId = await authorizedOfferedConnection({ req, accountId, provider, heldEntry, scope, pickerUrl, res })
    if (typeof connectionId !== 'string') return

    const snapshot = [...(req.session.workspaces || [])]
    let conversion
    try {
      conversion = await persistBinding({
        connectionStore, session: req.session, accountId, workspace,
        provider: provider.name, scope, heldConnectionId: connectionId,
        resolveCanonicalAccountId, writesEnabled: writesEnabled(), workspacesSnapshot: snapshot,
        convertToConnectionBacked,
      })
    } catch (err) {
      console.error('[held-connection] persist failed:', err)
      conversion = { connectionBacked: false, error: 'retryable' }
    }
    // C3: a held failure is retryable and NEVER a legacy write (no credential copy).
    if (!conversion?.connectionBacked) return retryPage(res)
    return finishAdd(req, res, { provider, surface, workspace, scope })
  }

  return router
}

/** Persist the session before responding (express-session would also autosave). */
function saveThen(req, send) {
  if (typeof req.session?.save === 'function') return req.session.save(send)
  return send()
}

/** Success: one-shot flash, clear the held intent, redirect into settings. */
function finishAdd(req, res, { provider, surface, workspace, scope }) {
  req.session.providerAdded = { provider: surface.providerOkKey, scope }
  delete req.session.heldEntry
  const redirect = `/workspace/${encodeURIComponent(workspace.urlKey)}/settings?provider_ok=${surface.providerOkKey}`
  return saveThen(req, () => res.redirect(redirect))
}
