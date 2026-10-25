/**
 * The Settings › Models page's writes (LIN-3855). The three legacy forms (the Harbour model, the Dispatch
 * defaults and the AI model overrides) are retired: their POSTs are gone, and so is the old 307 that pointed a
 * bare POST at them. Every model write now goes through the page's staged save, the presets or the undo.
 *
 *   POST /workspace/:urlKey/settings/models/changes                  { reason, version, c__… fields }
 *   POST /workspace/:urlKey/settings/models/presets                  { reason, name }
 *   POST /workspace/:urlKey/settings/models/presets/:presetId/apply  { reason }
 *
 * A refused write goes back to the Models page with the reason in place and the staged values kept (the
 * session holds them for one page load). Each write is one logged change with one reason.
 */
import { Router } from 'express';
import { renderErrorPage } from '../lib/render.js';
import { RoutingError } from '../lib/model-routing.js';
import { stagedChanges, runnableGuard } from '../lib/model-routing-edit.js';
import { settingsAreaUrl } from '../lib/settings-areas.js';

/** What a refused page write says, in place, on the Models page (LIN-3855). */
const REFUSAL_MESSAGES = {
  CONFLICT: 'The models changed while you were editing, so nothing was saved. Your edits are still here: check them and save again.',
  REASON_REQUIRED: 'Save needs a reason: say why these models are changing.'
};

export function createSettingsModelRoutes({ workspaceFromUrl, modelRoutingStore }) {
  const router = Router();

  const modelsUrlOf = (workspace, query) => settingsAreaUrl(workspace.urlKey, 'models', query);
  const reasonOfBody = (body) => (typeof body?.reason === 'string' ? body.reason.trim() : '');
  /** The staged fields a refused save posted, so the page shows them again rather than the stored values. */
  const stagedValuesOf = (body) => Object.fromEntries(Object.entries(body || {}).filter(([k]) => k.startsWith('c__')));
  /**
   * A refused write goes back to the Models page with its reason and the staged values (the session holds
   * them for one page load). A refusal the store did not name is a real failure and is not hidden.
   */
  const refuse = (req, res, workspace, err, body) => {
    if (!(err instanceof RoutingError)) {
      return failure(res, workspace, 'Settings Error', 'Failed to save model changes. Please try again.');
    }
    const message = REFUSAL_MESSAGES[err.code] || err.message;
    if (req.session) req.session.modelsFlash = { code: err.code, message, values: stagedValuesOf(body) };
    return res.redirect(modelsUrlOf(workspace));
  };

  const contextOf = (req, reason) => ({
    urlKey: req.workspace.urlKey,
    reason,
    actor: { via: 'page', ...(req.session?.accountId ? { id: req.session.accountId } : {}) }
  });
  const failure = (res, workspace, title, message) => res.status(500).send(renderErrorPage(title, message, {
    action: 'Back to settings',
    actionUrl: modelsUrlOf(workspace)
  }));

  /**
   * Save the staged Models page: every field the page posted, diffed against the table, as ONE logged change
   * with one reason. `version` is the table the page was rendered from; a table that has moved since is
   * CONFLICT, never an overwrite. The runnable check refuses a change that would leave a job's model unable
   * to run on its harness (it names the jobs, and writes nothing).
   */
  router.post('/workspace/:urlKey/settings/models/changes', workspaceFromUrl, async (req, res) => {
    const workspace = req.workspace;
    const reason = reasonOfBody(req.body);
    const version = Number(req.body?.version);
    try {
      if (!reason) throw new RoutingError('REASON_REQUIRED', 'a change needs a reason');
      const table = await modelRoutingStore.getTable(workspace.urlKey);
      if (!Number.isInteger(version) || table.version !== version) {
        throw new RoutingError('CONFLICT', 'the routing table changed since this page was loaded', { version: table.version });
      }
      const changes = stagedChanges(req.body, table);
      if (!changes.length) return res.redirect(modelsUrlOf(workspace, { nothing: '1' }));
      await modelRoutingStore.applyChanges(changes, contextOf(req, reason), { expectedVersion: version, ...runnableGuard() });
    } catch (err) {
      console.error('Settings › Models save:', err?.code || err?.message);
      return refuse(req, res, workspace, err, req.body);
    }
    return res.redirect(modelsUrlOf(workspace, { changed: '1' }));
  });

  /** Save the current table as a named routing preset. The table does not change; the save is one log entry. */
  router.post('/workspace/:urlKey/settings/models/presets', workspaceFromUrl, async (req, res) => {
    const workspace = req.workspace;
    try {
      await modelRoutingStore.savePreset(req.body?.name, contextOf(req, reasonOfBody(req.body)));
    } catch (err) {
      return refuse(req, res, workspace, err, req.body);
    }
    return res.redirect(modelsUrlOf(workspace, { saved: '1' }));
  });

  /** Make the table equal a preset's snapshot, as one logged change, refused the same way a staged save is. */
  router.post('/workspace/:urlKey/settings/models/presets/:presetId/apply', workspaceFromUrl, async (req, res) => {
    const workspace = req.workspace;
    try {
      await modelRoutingStore.applyPreset(req.params.presetId, contextOf(req, reasonOfBody(req.body)), runnableGuard());
    } catch (err) {
      return refuse(req, res, workspace, err, req.body);
    }
    return res.redirect(modelsUrlOf(workspace, { applied: '1' }));
  });

  return router;
}
