/**
 * Workspace management routes.
 * Handles removing workspaces.
 */
import { Router } from 'express'
import { removeWorkspace, saveSession, getActiveWorkspace, getWorkspaceByUrlKey, validateWorkspaceUrlKey } from '../lib/workspace.js'
import { badRequest, notFound } from '../lib/errors.js'

/**
 * Create workspace management routes.
 * @returns {Router} Express router
 */
export function createWorkspaceRoutes() {
  const router = Router()

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
