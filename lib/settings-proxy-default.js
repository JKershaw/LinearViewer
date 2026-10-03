/**
 * The proxy-default preference route (LIN-2944 P3, addendum 15).
 *
 * Extracted from server.js so the route's write path is unit-testable in the
 * `tests/unit/theme.test.js` pattern (review a6be902a R2): a non-boolean is a
 * 400, the session is the authoritative write, and the durable store is
 * best-effort persisted only when the session carries an `accountId`. Mirrors
 * the theme route's shape (session + best-effort store, JSON for XHR / redirect
 * otherwise).
 */
import { Router } from 'express';

/**
 * @param {Object} deps
 * @param {import('express').RequestHandler} deps.workspaceFromUrl - Resolves `req.workspace` from the urlKey.
 * @param {{ setProxyDefault: (accountId: string, value: boolean) => Promise<boolean> }} deps.userPreferencesStore
 * @param {(session: Object) => Promise<void>} deps.saveSession
 * @returns {import('express').Router}
 */
export function createProxyDefaultRoute({ workspaceFromUrl, userPreferencesStore, saveSession }) {
  const router = Router();

  router.post('/workspace/:urlKey/settings/proxy-default', workspaceFromUrl, async (req, res) => {
    const workspace = req.workspace;
    const { proxyDefault } = req.body || {};

    if (typeof proxyDefault !== 'boolean') {
      return res.status(400).json({ error: 'Invalid proxyDefault' });
    }

    // Session is the authoritative, immediate path.
    req.session.proxyDefault = proxyDefault;
    try {
      await saveSession(req.session);
    } catch (err) {
      console.error('Failed to save proxy default:', err);
      return res.status(500).json({ error: 'Failed to save proxy default' });
    }

    // Best-effort durable persist for cross-device sync (non-fatal: the session
    // already carries the choice for this device/session).
    if (req.session.accountId) {
      try {
        await userPreferencesStore.setProxyDefault(req.session.accountId, proxyDefault);
      } catch (err) {
        console.error('Failed to persist proxy default to preferences store:', err);
      }
    }

    if (req.headers['x-requested-with'] === 'XMLHttpRequest') {
      res.json({ ok: true, proxyDefault });
    } else {
      res.redirect(`/workspace/${encodeURIComponent(workspace.urlKey)}/settings`);
    }
  });

  return router;
}
