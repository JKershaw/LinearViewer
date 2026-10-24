/**
 * The workspace feature toggle route (LIN-340), moved out of server.js unchanged so a unit
 * test can drive it (LIN-3854: the proxy model-routing writes sit behind one of these
 * features, and "toggled only through this session-authed route" needs a witness).
 * Like the model forms in routes/settings-model.js it has no role check: any signed-in
 * member of the workspace may toggle, which is the access the setting is meant to share.
 */
import { Router } from 'express';
import { renderErrorPage } from '../lib/render.js';
import { badRequest } from '../lib/errors.js';
import { setWorkspaceFeature } from '../lib/workspace-preferences.js';
import { isValidWorkspaceFeatureKey } from '../lib/feature-defaults.js';

export function createSettingsWorkspaceFeatureRoutes({ workspaceFromUrl, workspacePreferencesStore }) {
  const router = Router();

  /**
   * Toggle a workspace-scoped feature flag on or off (LIN-340).
   * Accepts { feature, enabled } in body.
   *
   * Mirrors the model handlers (routes/settings-model.js): persists to the workspace preferences store
   * (shared across all users of the org), then redirects back to settings. It
   * deliberately does NOT touch session.features, the session feature flags, or the
   * per-user UserPreferencesStore — workspace features are a separate contract.
   */
  router.post('/workspace/:urlKey/settings/workspace-features', workspaceFromUrl, async (req, res) => {
    const workspace = req.workspace;
    const { feature, enabled } = req.body;

    // Validate workspace feature key
    if (!feature || !isValidWorkspaceFeatureKey(feature)) {
      return badRequest.json(res, 'Invalid workspace feature key');
    }

    const isEnabled = enabled === 'true' || enabled === true;

    // Persist to the workspace preferences store. setWorkspaceFeature preserves
    // every other workspace preference key (e.g. modelId) and every other
    // workspace feature flag while flipping just this one.
    try {
      const ok = await setWorkspaceFeature({
        urlKey: workspace.urlKey,
        featureKey: feature,
        enabled: isEnabled,
        store: workspacePreferencesStore
      });
      if (!ok) throw new Error('setWorkspaceFeature returned false');
    } catch (err) {
      console.error('Failed to save workspace feature toggle:', err);
      return res.status(500).send(renderErrorPage('Settings Error', 'Failed to save workspace feature. Please try again.', {
        action: 'Back to settings',
        actionUrl: `/workspace/${encodeURIComponent(workspace.urlKey)}/settings`
      }));
    }

    // AJAX requests get JSON; regular form submissions get redirect. This is only
    // the response shape the settings-page toggle client (app.js) expects for ALL
    // settings toggles — persistence above is exclusively to workspacePreferencesStore,
    // never to session.features or the per-user store.
    if (req.headers['x-requested-with'] === 'XMLHttpRequest') {
      res.json({ ok: true, feature, enabled: isEnabled });
    } else {
      res.redirect(`/workspace/${encodeURIComponent(workspace.urlKey)}/settings`);
    }
  });

  return router;
}
