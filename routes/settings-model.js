/**
 * The Settings › Models page's writes (LIN-3855). The three legacy forms (the Harbour model, the Dispatch
 * defaults and the AI model overrides) are retired: their POSTs are gone, and so is the old 307 that pointed a
 * bare POST at them. Every model write now goes through the page's staged save, the presets or the undo.
 *
 *   POST /workspace/:urlKey/settings/models/changes                  { reason, version, back?, c__… fields }
 *   POST /workspace/:urlKey/settings/models/presets                  { reason, name }
 *   POST /workspace/:urlKey/settings/models/presets/:presetId/apply  { reason }
 *
 * A refused write goes back to the Models page with the reason in place and the staged values kept (the
 * session holds them for one page load). Each write is one logged change with one reason.
 *
 * `back=dispatch` (LIN-3952) is the Dispatch page's "No job" section posting the same save. It is the one
 * whitelisted return besides Models. Its result comes back on the Dispatch page as a query (`no_job` /
 * `no_job_error`), not in the session flash, which only the Models page reads.
 */
import { Router } from 'express';
import { renderErrorPage } from '../lib/render.js';
import { RoutingError } from '../lib/model-routing.js';
import { stagedChanges, runnableGuard, REFUSAL_MESSAGES } from '../lib/model-routing-edit.js';
import { settingsAreaUrl } from '../lib/settings-areas.js';

export function createSettingsModelRoutes({ workspaceFromUrl, modelRoutingStore }) {
  const router = Router();

  const modelsUrlOf = (workspace, query) => settingsAreaUrl(workspace.urlKey, 'models', query);
  const dispatchUrlOf = (workspace, query) => `/workspace/${encodeURIComponent(workspace.urlKey)}/dispatch?${new URLSearchParams(query)}`;
  const reasonOfBody = (body) => (typeof body?.reason === 'string' ? body.reason.trim() : '');
  /** The whitelisted return: `dispatch` only when the Dispatch page posted it; anything else is Models. */
  const backOf = (body) => (body?.back === 'dispatch' ? 'dispatch' : 'models');
  /** The staged fields a refused save posted, so the page shows them again rather than the stored values. */
  const stagedValuesOf = (body) => Object.fromEntries(Object.entries(body || {}).filter(([k]) => k.startsWith('c__')));
  /**
   * A refused write goes back to the Models page with its reason and the staged values (the session holds
   * them for one page load). A refusal the store did not name is a real failure and is not hidden.
   * From the Dispatch page the refusal is a query code instead, so it is read where it was made.
   */
  const refuse = (req, res, workspace, err, body) => {
    if (!(err instanceof RoutingError)) {
      return failure(res, workspace, 'Settings Error', 'Failed to save model changes. Please try again.');
    }
    if (backOf(body) === 'dispatch') return res.redirect(dispatchUrlOf(workspace, { no_job_error: err.code }));
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
    const back = backOf(req.body);
    let entry = null;
    let nothing = false;
    try {
      if (!reason) throw new RoutingError('REASON_REQUIRED', 'a change needs a reason');
      const table = await modelRoutingStore.getTable(workspace.urlKey);
      if (!Number.isInteger(version) || table.version !== version) {
        throw new RoutingError('CONFLICT', 'the routing table changed since this page was loaded', { version: table.version });
      }
      const changes = stagedChanges(req.body, table);
      if (!changes.length) nothing = true;
      else entry = await modelRoutingStore.applyChanges(changes, contextOf(req, reason), { expectedVersion: version, ...runnableGuard() });
    } catch (err) {
      console.error('Settings › Models save:', err?.code || err?.message);
      return refuse(req, res, workspace, err, req.body);
    }
    if (back === 'dispatch') return res.redirect(dispatchUrlOf(workspace, { no_job: nothing ? 'nothing' : 'saved' }));
    if (nothing) return res.redirect(modelsUrlOf(workspace, { nothing: '1' }));
    // The saved entry's id, so the page can mark the rows it saved and offer one Undo for all of them (LIN-3952).
    return res.redirect(modelsUrlOf(workspace, { changed: entry?._id || '1' }));
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
