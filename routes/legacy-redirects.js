/**
 * Legacy route redirects for backward compatibility.
 *
 * Redirects old non-workspace-prefixed URLs to their workspace-prefixed equivalents.
 * These exist for users who may have bookmarked or linked to old URLs.
 */
import { Router } from 'express';
import { getActiveWorkspace } from '../lib/workspace.js';

/**
 * Create legacy redirect routes.
 * @returns {Router} Express router
 */
export function createLegacyRedirects() {
  const router = Router();

  /**
   * Helper to create redirect functions for legacy routes.
   */
  function redirectToWorkspace(page) {
    return (req, res) => {
      const workspace = getActiveWorkspace(req.session)
      if (workspace) {
        return res.redirect(`/workspace/${encodeURIComponent(workspace.urlKey)}/${page}`)
      }
      res.redirect('/')
    }
  }

  // Legacy page routes - redirect to workspace-prefixed versions
  router.get('/audit', redirectToWorkspace('audit'))
  router.get('/settings', redirectToWorkspace('settings'))
  router.get('/prompts', redirectToWorkspace('prompts'))

  // Legacy POST route for settings model
  router.post('/settings/model', (req, res) => {
    const workspace = getActiveWorkspace(req.session)
    if (workspace) {
      // Re-submit to the workspace-prefixed route (redirect loses POST data, so we'll handle directly)
      return res.redirect(307, `/workspace/${encodeURIComponent(workspace.urlKey)}/settings/model`)
    }
    res.redirect('/')
  })

  // Legacy API routes - redirect to workspace-prefixed versions
  router.get('/api/audit', (req, res) => {
    const workspace = getActiveWorkspace(req.session)
    if (workspace) {
      return res.redirect(`/workspace/${encodeURIComponent(workspace.urlKey)}/api/audit`)
    }
    res.status(401).json({ error: 'Not authenticated' })
  })

  router.get('/api/prompt/:issueId/:labelName', (req, res) => {
    const workspace = getActiveWorkspace(req.session)
    if (workspace) {
      return res.redirect(`/workspace/${encodeURIComponent(workspace.urlKey)}/api/prompt/${req.params.issueId}/${encodeURIComponent(req.params.labelName)}`)
    }
    res.status(401).json({ error: 'Not authenticated' })
  })

  router.get('/api/recommend/status', (req, res) => {
    const workspace = getActiveWorkspace(req.session)
    if (workspace) {
      return res.redirect(`/workspace/${encodeURIComponent(workspace.urlKey)}/api/recommend/status`)
    }
    res.status(401).json({ error: 'Not authenticated' })
  })

  router.get('/api/recommend/:issueId', (req, res) => {
    const workspace = getActiveWorkspace(req.session)
    if (workspace) {
      return res.redirect(`/workspace/${encodeURIComponent(workspace.urlKey)}/api/recommend/${req.params.issueId}`)
    }
    res.status(401).json({ error: 'Not authenticated' })
  })

  return router;
}
