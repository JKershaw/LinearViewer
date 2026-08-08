/**
 * Workspace management routes.
 * Handles creating local workspaces and removing workspaces.
 */
import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import { removeWorkspace, upsertWorkspace, saveSession, getActiveWorkspace, getWorkspaceByUrlKey, validateWorkspaceUrlKey, URL_KEY_REGEX, linkProvider } from '../lib/workspace.js'
import { badRequest, notFound, serverError } from '../lib/errors.js'
import { establishAccount } from '../lib/account-session.js'
import { evictWorkspaceTokenPair } from '../lib/workspace-token-cache.js'

/**
 * Slugify a workspace name into the urlKey body (alphanumeric + hyphens).
 * Empty/blank names fall back to 'local'. Capped to leave room for the
 * uniqueness suffix appended by the caller (urlKey must stay ≤ 50 chars).
 * @param {string} name
 * @returns {string}
 */
function slugifyName(name) {
  const base = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return base || 'local'
}

/**
 * Starter content seeded into a fresh local workspace so it is not a dead-end.
 * There is no user-facing create-task route yet (LIN-377 follow-up), so an empty
 * local workspace would have no in-app way to add content. Shape mirrors the E2E
 * harness seed (routes/test.js).
 * @param {string} urlKey - Workspace partition scope (also the issue URL prefix).
 */
function starterSeed(urlKey) {
  return {
    projects: [
      { id: `${urlKey}-proj-1`, name: 'Getting started', content: 'Your first local project. Edit or add issues via the API/CLI for now.', sortOrder: 1 },
    ],
    issues: [
      { id: `${urlKey}-issue-1`, identifier: 'LOCAL-1', title: 'Welcome to your local workspace', description: 'This workspace is backed by the local provider — no Linear account required. It lives entirely in this app.', projectId: `${urlKey}-proj-1`, sortOrder: 1, state: { name: 'In Progress', type: 'started' }, url: `/workspace/${urlKey}/issue/${urlKey}-issue-1` },
      { id: `${urlKey}-issue-2`, identifier: 'LOCAL-2', title: 'Add your own tasks', description: 'Use the Linear API proxy or CLI to create issues until the in-app create flow lands.', projectId: `${urlKey}-proj-1`, parentId: `${urlKey}-issue-1`, sortOrder: 2, state: { name: 'Todo', type: 'unstarted' }, url: `/workspace/${urlKey}/issue/${urlKey}-issue-2` },
    ],
  }
}

/**
 * Create workspace management routes.
 * @param {Object} [deps]
 * @param {import('../lib/local-store.js').LocalStore} [deps.localStore] - Local provider store, used to seed starter content for new local workspaces.
 * @param {import('../lib/account-store.js').AccountStore} [deps.accountStore] - LIN-1329: find-or-create the durable account for a new local workspace.
 * @param {import('../lib/account-workspace-store.js').AccountWorkspaceStore} [deps.accountWorkspaceStore] - LIN-1329: bind the account to the workspace.
 * @param {(key: string) => void} [deps.evictWorkspaceToken] - LIN-1507: evicts a resolved-token cache entry by its pre-computed key (see `workspaceTokenCacheKey`).
 * @param {import('../lib/owner-credential-store.js').OwnerCredentialStore} [deps.ownerCredentialStore] - LIN-1523: durable owner-credential store. Deleted alongside the LIN-1507 cache eviction on disconnect — a cache is not a grant, but a disconnected workspace's durable credential must not outlive the disconnect either.
 * @returns {Router} Express router
 */
export function createWorkspaceRoutes({ localStore, accountStore, accountWorkspaceStore, evictWorkspaceToken, ownerCredentialStore } = {}) {
  const router = Router()

  /**
   * Create a new local-provider workspace (non-OAuth bootstrap).
   *
   * Local has no credential exchange, so this lives here alongside the other
   * non-OAuth session lifecycle route (`/workspace/:urlKey/remove`) rather than
   * in a provider auth router. Builds the known local session shape (mirror of
   * the E2E harness: token === urlKey, never-expiring), seeds a minimal starter
   * project so the workspace is usable, sets it active, and redirects in.
   */
  router.post('/workspace/new', async (req, res) => {
    const rawName = typeof req.body?.name === 'string' ? req.body.name.trim() : ''
    const name = rawName || 'Local Workspace'

    // urlKey is BOTH the session workspace key AND the LocalStore partition
    // scope, so it must be globally unique — reusing a key would merge the seed
    // into another workspace's data. A random suffix guarantees a fresh
    // partition; the in-session guard is belt-and-braces.
    const existing = new Set((req.session.workspaces || []).map(w => w.urlKey))
    let urlKey
    do {
      urlKey = `${slugifyName(name)}-${randomUUID().slice(0, 8)}`
    } while (existing.has(urlKey) || !URL_KEY_REGEX.test(urlKey))

    // Local is the non-OAuth credential-acquisition strategy: its credential is
    // the urlKey used as a store-partition key, acquired synchronously (no
    // redirect), so it converges on the SAME linkProvider seam as OAuth login
    // and PAT (LIN-562) rather than hand-assembling the credential shape. The
    // scope IS the urlKey (the partition); token === partition, never-expiring.
    // linkProvider writes the legacy scalar mirror (provider/credentials/
    // accessToken/tokenExpiresAt) so the existing local readers stay green.
    const workspace = {
      id: randomUUID(),
      name,
      urlKey,
      addedAt: Date.now(),
    }
    linkProvider(workspace, 'local', urlKey, {
      token: urlKey,
      tokenExpiresAt: Number.MAX_SAFE_INTEGER, // keeps token-refresh from firing for local
    })

    try {
      upsertWorkspace(req.session, workspace)
    } catch (err) {
      // MAX_WORKSPACES reached
      return badRequest.html(res, err.message)
    }
    req.session.activeWorkspaceId = workspace.id

    // LIN-1329 (Phase C): establish the durable account for this identity —
    // the single seam every sign-in path converges on. Local has no human
    // credential to identify by (Q6), so the identity scope is the urlKey
    // itself: freshly random per create, so it can never false-conflict
    // across two humans the way a shared resource address would.
    const established = await establishAccount(req.session, accountStore, accountWorkspaceStore, 'local', urlKey, {}, workspace.id)
    if (!established.ok) {
      return serverError.html(res, 'Could not set up your workspace account. Please try again.')
    }

    if (localStore) {
      await localStore.seed(urlKey, starterSeed(urlKey))
    }

    await saveSession(req.session)
    res.redirect(`/workspace/${encodeURIComponent(urlKey)}/`)
  })

  /**
   * Remove a workspace.
   * POST for safety. If only one workspace, logs out entirely.
   */
  router.post('/workspace/:urlKey/remove', async (req, res) => {
    if (!validateWorkspaceUrlKey(req.params.urlKey)) {
      return badRequest.html(res, 'Invalid workspace ID')
    }

    // If only one workspace, just logout entirely
    if (req.session.workspaces?.length <= 1) {
      // LIN-1507: same treatment as /logout — capture accountId + workspaces
      // BEFORE destroy() destroys the session data.
      const accountId = req.session.accountId
      const workspaces = req.session.workspaces || []
      for (const workspace of workspaces) {
        evictWorkspaceTokenPair(evictWorkspaceToken, workspace.urlKey, accountId)
        // LIN-1523: this IS a disconnect (unlike /logout) — the durable
        // credential must not outlive it, or a proxy token keeps resolving
        // indefinitely against a workspace the user believes is gone.
        // LIN-1887 N2: whole-workspace teardown, so EVERY provider partition
        // goes — a single-partition delete would orphan the others.
        if (ownerCredentialStore) await ownerCredentialStore.deleteAll(accountId, workspace.urlKey)
      }
      return req.session.destroy(() => res.redirect('/'))
    }

    const workspace = getWorkspaceByUrlKey(req.session, req.params.urlKey)
    if (!workspace) {
      return notFound.html(res, 'Workspace not found')
    }

    // LIN-1507: the session survives this removal (unlike the branch above),
    // so evict just this one workspace's cache entries rather than treating
    // it as a destroy.
    evictWorkspaceTokenPair(evictWorkspaceToken, workspace.urlKey, req.session.accountId)
    // LIN-1523: durable delete alongside the cache eviction — see the note above.
    // LIN-1887 N2: whole-workspace teardown → every provider partition.
    if (ownerCredentialStore) await ownerCredentialStore.deleteAll(req.session.accountId, workspace.urlKey)

    removeWorkspace(req.session, workspace.id)
    await saveSession(req.session)

    // Redirect to the remaining active workspace's URL
    const activeWorkspace = getActiveWorkspace(req.session)
    if (activeWorkspace) {
      res.redirect(`/workspace/${encodeURIComponent(activeWorkspace.urlKey)}/`)
    } else {
      res.redirect('/')
    }
  })

  return router
}
