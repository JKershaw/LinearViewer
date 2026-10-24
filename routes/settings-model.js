/**
 * The three old Settings model forms (LIN-3853), moved out of server.js so a unit test can
 * drive them. They keep working, but they write through the model-routing store instead of
 * the old preference fields (item 4 of LIN-3820 retires them):
 *
 *   POST /workspace/:urlKey/settings/model              — the Harbour-call model
 *   POST /workspace/:urlKey/settings/dispatch-defaults  — agent-session harness/model/effort
 *   POST /workspace/:urlKey/settings/ai-model-overrides — per-operation Harbour-call models
 *
 * The forms have no reason field, so each POST logs exactly one entry with a fixed reason
 * that names the form. Validation and redirects are the originals'.
 */
import { Router } from 'express';
import { renderErrorPage } from '../lib/render.js';
import { DISPATCH_DEFAULT_KINDS } from '../lib/prompt-templates.js';
import { validateOpaqueDispatchField, MAX_NAME_LENGTH } from '../lib/dispatch-validation.js';
import { AI_OPERATION_KINDS } from '../lib/model-routing.js';

export const LEGACY_FORM_REASONS = Object.freeze({
  model: 'Changed on the old Settings form: Model',
  dispatchDefaults: 'Changed on the old Settings form: Dispatch defaults',
  aiOverrides: 'Changed on the old Settings form: AI model overrides'
});

export function createSettingsModelRoutes({ workspaceFromUrl, modelRoutingStore }) {
  const router = Router();

  const settingsUrlOf = (workspace) => `/workspace/${encodeURIComponent(workspace.urlKey)}/settings/models`;
  const contextOf = (req, reason) => ({
    urlKey: req.workspace.urlKey,
    reason,
    actor: { via: 'page', ...(req.session?.accountId ? { id: req.session.accountId } : {}) }
  });
  const failure = (res, workspace, title, message) => res.status(500).send(renderErrorPage(title, message, {
    action: 'Back to settings',
    actionUrl: settingsUrlOf(workspace)
  }));

  /**
   * Save the workspace AI model selection.
   * Accepts either a preset model ID or a custom model ID.
   */
  router.post('/workspace/:urlKey/settings/model', workspaceFromUrl, async (req, res) => {
    const workspace = req.workspace;

    const { modelId, customModelId } = req.body;

    // Use custom model ID if provided, otherwise use selected preset
    let selectedModel = customModelId?.trim() || modelId;

    // Validate model ID format: provider/model (with optional :variant)
    // Example: anthropic/claude-sonnet-4, meta-llama/llama-3.3-70b-instruct:free
    // Dots allowed for version numbers (e.g., claude-3.5-sonnet) but not consecutive (..)
    const modelIdRegex = /^[a-z0-9-]+\/[a-z0-9.-]+(?::[a-z0-9-]+)?$/i;

    // Validate and provide feedback on failure
    if (!selectedModel) {
      return res.redirect(`${settingsUrlOf(workspace)}?error=empty`);
    }

    if (selectedModel.length > 100) {
      return res.redirect(`${settingsUrlOf(workspace)}?error=too-long`);
    }

    // Reject path traversal sequences
    if (selectedModel.includes('..')) {
      return res.redirect(`${settingsUrlOf(workspace)}?error=invalid-format`);
    }

    if (!modelIdRegex.test(selectedModel)) {
      return res.redirect(`${settingsUrlOf(workspace)}?error=invalid-format`);
    }

    // Validation passed — save the model. Workspace-scoped (shared across all users of the
    // org), so the selection applies to both UI and proxy/agent traffic.
    try {
      await modelRoutingStore.saveHarbourModel(selectedModel, contextOf(req, LEGACY_FORM_REASONS.model));
    } catch (err) {
      console.error('Failed to save workspace model preference:', err);
      return failure(res, workspace, 'Settings Error', 'Failed to save model preference. Please try again.');
    }

    res.redirect(settingsUrlOf(workspace));
  });

  /**
   * Save workspace-wide + per-prompt-type dispatch model/harness/effort defaults
   * (LIN-1095, `effort` added LIN-2616/G2). Distinct from /settings/model above:
   * that selects the model used to WRITE prompts; this selects the
   * model/harness/effort dispatched agents EXECUTE with, consumed at dispatch
   * time via resolveDispatchDefaults() (LIN-1094). All three fields stay opaque
   * strings (no registry), validated with the same shared
   * validateOpaqueDispatchField() the dispatch/proxy routes use (LIN-1084).
   * The top-level row sets every agent group's default; a per-kind row is that
   * job's own setting, and a blank field clears it so the job follows its group.
   */
  router.post('/workspace/:urlKey/settings/dispatch-defaults', workspaceFromUrl, async (req, res) => {
    const workspace = req.workspace;
    const settingsUrl = settingsUrlOf(workspace);

    const readField = (key) => (req.body[key] || '').trim() || undefined;
    // The free-text "custom harness" input was removed in LIN-1282; the harness is
    // now only ever the select's value (one of the two real harnesses, or blank).
    const readHarness = (selectKey) => (req.body[selectKey] || '').trim() || undefined;

    let hasFieldError = false;
    const validate = (value, name) => {
      if (validateOpaqueDispatchField(value, name, { maxLength: MAX_NAME_LENGTH })) {
        hasFieldError = true;
      }
    };

    const model = readField('defaultModel');
    const harness = readHarness('defaultHarnessSelect');
    const effort = readField('defaultEffort');
    validate(model, 'model');
    validate(harness, 'harness');
    validate(effort, 'effort');

    // byKind is scoped to DISPATCH_DEFAULT_KINDS (the PROMPT_TEMPLATES step-kinds
    // plus `autopilot`, LIN-1278), both by only ever reading these specific field
    // names (any other posted field is simply never looked at) and defensively at
    // read time in resolveDispatchDefaults.
    const byKind = {};
    for (const kind of DISPATCH_DEFAULT_KINDS) {
      const kindModel = readField(`kind__${kind}__Model`);
      const kindHarness = readHarness(`kind__${kind}__HarnessSelect`);
      const kindEffort = readField(`kind__${kind}__Effort`);
      validate(kindModel, 'model');
      validate(kindHarness, 'harness');
      validate(kindEffort, 'effort');
      if (kindModel || kindHarness || kindEffort) {
        byKind[kind] = {};
        if (kindModel) byKind[kind].model = kindModel;
        if (kindHarness) byKind[kind].harness = kindHarness;
        if (kindEffort) byKind[kind].effort = kindEffort;
      }
    }

    if (hasFieldError) {
      return res.redirect(`${settingsUrl}?dispatchDefaultsError=invalid-field`);
    }

    try {
      await modelRoutingStore.saveDispatchDefaults({ model, harness, effort }, byKind, contextOf(req, LEGACY_FORM_REASONS.dispatchDefaults));
    } catch (err) {
      console.error('Failed to save workspace dispatch defaults:', err);
      return failure(res, workspace, 'Settings Error', 'Failed to save dispatch defaults. Please try again.');
    }

    res.redirect(settingsUrl);
  });

  /**
   * Save per-operation AI model overrides (LIN-1145).
   * Each kind in AI_OPERATION_KINDS gets an optional model of its own. Blank rows signal
   * "inherit the group default" and clear that job's own model (a `scan` override also
   * sets `scan-retire`, as the retire route reads it for both).
   */
  router.post('/workspace/:urlKey/settings/ai-model-overrides', workspaceFromUrl, async (req, res) => {
    const workspace = req.workspace;
    const settingsUrl = settingsUrlOf(workspace);
    const modelIdRegex = /^[a-z0-9-]+\/[a-z0-9.-]+(?::[a-z0-9-]+)?$/i;
    const MAX_LENGTH = 100;

    let hasFieldError = false;

    const byKind = {};
    for (const kind of AI_OPERATION_KINDS) {
      const fieldName = `byKind__${kind}__model`;
      const customFieldName = `${fieldName}Custom`;
      const custom = (req.body[customFieldName] || '').trim();
      const select = (req.body[fieldName] || '').trim();
      const model = custom || select || '';

      if (!model) continue;

      if (model.length > MAX_LENGTH || model.includes('..') || !modelIdRegex.test(model)) {
        hasFieldError = true;
        break;
      }

      byKind[kind] = { model };
    }

    if (hasFieldError) {
      return res.redirect(`${settingsUrl}?aiOverridesError=invalid-format`);
    }

    try {
      await modelRoutingStore.saveAiOverrides(byKind, contextOf(req, LEGACY_FORM_REASONS.aiOverrides));
    } catch (err) {
      console.error('Failed to save workspace AI model overrides:', err);
      return failure(res, workspace, 'Settings Error', 'Failed to save AI model overrides. Please try again.');
    }

    res.redirect(settingsUrl);
  });

  return router;
}
