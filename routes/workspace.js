/**
 * Workspace management routes.
 * Handles creating local workspaces and removing workspaces.
 */
import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import { removeWorkspace, upsertWorkspace, saveSession, getActiveWorkspace, getWorkspaceByUrlKey, validateWorkspaceUrlKey, URL_KEY_REGEX } from '../lib/workspace.js'
import { badRequest, notFound } from '../lib/errors.js'

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
 * @returns {Router} Express router
 */
export function createWorkspaceRoutes({ localStore } = {}) {
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

    const workspace = {
      id: randomUUID(),
      name,
      urlKey,
      provider: 'local',
      credentials: { token: urlKey },
      accessToken: urlKey, // un-migrated readers use this as the store-partition selector
      tokenExpiresAt: Number.MAX_SAFE_INTEGER, // keeps token-refresh from firing for local
      addedAt: Date.now(),
    }

    try {
      upsertWorkspace(req.session, workspace)
    } catch (err) {
      // MAX_WORKSPACES reached
      return badRequest.html(res, err.message)
    }
    req.session.activeWorkspaceId = workspace.id

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
      return req.session.destroy(() => res.redirect('/'))
    }

    const workspace = getWorkspaceByUrlKey(req.session, req.params.urlKey)
    if (!workspace) {
      return notFound.html(res, 'Workspace not found')
    }

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
