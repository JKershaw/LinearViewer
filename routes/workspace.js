/**
 * Workspace management routes.
 * Handles switching between and removing workspaces.
 */
import { Router } from 'express'
import { UUID_REGEX, removeWorkspace, saveSession } from '../lib/workspace.js'

/**
 * Create workspace management routes.
 * @returns {Router} Express router
 */
export function createWorkspaceRoutes() {
  const router = Router()

  /**
   * Switch active workspace.
   * POST to avoid state change via GET.
   */
  router.post('/workspace/:id/switch', async (req, res) => {
    if (!UUID_REGEX.test(req.params.id)) {
      return res.status(400).send('Invalid workspace ID')
    }

    const workspace = req.session.workspaces?.find(w => w.id === req.params.id)
    if (!workspace) {
      return res.status(404).send('Workspace not found')
    }

    req.session.activeWorkspaceId = workspace.id
    await saveSession(req.session)
    res.redirect('/')
  })

  /**
   * Remove a workspace.
   * POST for safety. If only one workspace, logs out entirely.
   */
  router.post('/workspace/:id/remove', async (req, res) => {
    if (!UUID_REGEX.test(req.params.id)) {
      return res.status(400).send('Invalid workspace ID')
    }

    // If only one workspace, just logout entirely
    if (req.session.workspaces?.length <= 1) {
      return req.session.destroy(() => res.redirect('/'))
    }

    removeWorkspace(req.session, req.params.id)
    await saveSession(req.session)
    res.redirect('/')
  })

  return router
}
