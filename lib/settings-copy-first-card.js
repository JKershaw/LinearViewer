/**
 * The copy-first card dismissal route (LIN-3833, "Got it" on Home's first-visit hint).
 *
 * Extracted from server.js, in the same shape as `settings-proxy-default.js`, so the write path is
 * unit-testable: the session is the immediate write, the durable preference is best-effort and only
 * written when the session carries an `accountId`. Dismissal is for good, so there is no value to read
 * from the body and no way to undo it here.
 */
import { Router } from 'express';
import { serverError } from './errors.js';

/**
 * @param {Object} deps
 * @param {import('express').RequestHandler} deps.workspaceFromUrl - Resolves `req.workspace` from the urlKey.
 * @param {{ setCopyFirstCardDismissed: (accountId: string, value: boolean) => Promise<boolean> }} deps.userPreferencesStore
 * @param {(session: Object) => Promise<void>} deps.saveSession
 * @returns {import('express').Router}
 */
export function createCopyFirstCardRoute({ workspaceFromUrl, userPreferencesStore, saveSession }) {
  const router = Router();

  router.post('/workspace/:urlKey/settings/copy-first-card', workspaceFromUrl, async (req, res) => {
    // Session is the authoritative, immediate path, so the card leaves at once for this session.
    req.session.copyFirstCardDismissed = true;
    try {
      await saveSession(req.session);
    } catch (err) {
      console.error('Failed to save copy-first card dismissal:', err);
      return serverError.json(res, 'Failed to save');
    }
    // Best-effort durable persist, so a new session for the same account stays dismissed.
    if (req.session.accountId) {
      try {
        await userPreferencesStore.setCopyFirstCardDismissed(req.session.accountId, true);
      } catch (err) {
        console.error('Failed to persist copy-first card dismissal:', err);
      }
    }
    res.json({ ok: true });
  });

  return router;
}
