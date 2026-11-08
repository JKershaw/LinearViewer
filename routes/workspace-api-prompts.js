/**
 * Prompt-traces and custom-prompts API routes (LIN-2246: extracted from
 * workspace-api.js, stage 2).
 *
 * Handles /workspace/:urlKey/api/prompt-traces (read-only debug/eval trace
 * listing) and /workspace/:urlKey/api/prompts/custom (CRUD for
 * user-authored custom prompt templates). Both groups are simple store
 * pass-throughs with no owning helpers of their own.
 *
 * Also hosts the prompt-generation routes (LIN-3842: moved from
 * workspace-api.js): GET /api/prompt/:issueId/:labelName and both
 * GET /api/autopilot-prompt routes, with the helpers only they use.
 */
import { Router } from 'express';
import { badRequest, jsonError, notFound, serverError } from '../lib/errors.js';
import { getProviderForWorkspace } from '../lib/providers/registry.js';
import { EMPTY_PROVIDER_CONTEXT } from '../lib/prompt-trace-store.js';
import { generatePrompt, generateCustomPrompt, hasPrompt } from '../lib/prompt-templates.js';
import { buildPromptFilename } from '../lib/prompt-formatters.js';
import { buildAutopilotKickoff, AUTOPILOT_MODES, AUTOPILOT_MODE_DEFAULT, AUTOPILOT_VARIANTS, AUTOPILOT_VARIANT_DEFAULT } from '../lib/prompts/autopilot-kickoff.js';
import { validateRunField } from '../lib/dispatch-fields.js';
import { isValidIssueId, resolveIssueBinding } from '../lib/workspace.js';
import { getFeatureFlags } from '../lib/feature-defaults.js';
import { testMockData } from '../lib/sample-data/mock-data.js';
import { publicOrigin } from '../lib/public-origin.js';
import { buildMockPromptInput } from '../lib/workspace-api-mocks.js';
import { isTestToken, failureOf } from './workspace-api-steps.js';

/**
 * Send a generated prompt as JSON (default) or as a downloadable markdown
 * file when `?format=md` is set. The markdown branch serves the bare prompt
 * string with attachment headers (Content-Disposition); the in-app `+proxy`
 * block is appended client-side, so it intentionally never appears here.
 * Default JSON behaviour is unchanged for every existing consumer.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {Object} opts
 * @param {Object} opts.json - JSON body returned when not downloading
 * @param {string} opts.prompt - Raw prompt string for the markdown download
 * @param {string} opts.identifier - Issue identifier for the filename (may be empty)
 * @param {string} opts.downloadName - Prompt name slug for the filename
 */
function sendPromptResult(req, res, { json, prompt, identifier, downloadName }) {
  if (req.query.format === 'md') {
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${buildPromptFilename(identifier, downloadName)}"`);
    return res.send(prompt);
  }
  return res.json(json);
}

// LIN-836: surface the stepper variant in the UI. Validate against the shared
// list (unknown/absent → standard), thread it into the kickoff body, and let
// ONLY the stepper branch change label/promptName/downloadName — the standard
// strings stay byte-identical to preserve the LIN-791 additive invariant.
function autopilotParams(req) {
  const mode = AUTOPILOT_MODES.includes(req.query.mode) ? req.query.mode : AUTOPILOT_MODE_DEFAULT;
  const variant = AUTOPILOT_VARIANTS.includes(req.query.variant) ? req.query.variant : AUTOPILOT_VARIANT_DEFAULT;
  return { mode, variant, stepper: variant === 'stepper', baseUrl: publicOrigin(req) };
}

function sendAutopilotPrompt(req, res, { stepper, identifier, promptName, prompt }) {
  const label = stepper ? 'autopilot-stepper' : 'autopilot';
  sendPromptResult(req, res, {
    identifier,
    downloadName: label,
    prompt,
    json: { label, promptName, kind: 'autopilot', prompt }
  });
}

const autopilotTitle = (stepper) => (stepper ? 'Autopilot (stepped)' : 'Autopilot');

/**
 * @param {Object} deps
 * @param {Function} deps.workspaceFromUrl - Middleware resolving req.workspace from :urlKey
 * @param {Object} deps.promptTraceStore - Debug/eval trace store (optional; 503-free empty read when absent)
 * @param {Object} deps.customPromptsStore - Custom prompt template CRUD store
 */
export function createPromptsRoutes({ workspaceFromUrl, promptTraceStore, customPromptsStore }) {
  const router = Router();

  /**
   * List captured prompt traces for the workspace (debug/eval harness read
   * path). Session-auth only and workspace-scoped — these are content-bearing
   * records (rendered ticket content + model output), deliberately NOT
   * exposed on the proxy token-auth surface and never fed to /kpis.
   * @route GET /workspace/:urlKey/api/prompt-traces
   */
  router.get('/workspace/:urlKey/api/prompt-traces', workspaceFromUrl, async (req, res) => {
    if (!promptTraceStore) {
      return res.json({ items: [], total: 0, providerContext: EMPTY_PROVIDER_CONTEXT });
    }
    try {
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
      const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
      // Sequential, not Promise.all: listTraces must run (and throw, if it's
      // going to) before summarizeProviderContext is ever called, so the
      // store-throw path below stays byte-identical to its pre-LIN-2357 body.
      const result = await promptTraceStore.listTraces(req.workspace.urlKey, { limit, offset });
      const expectedUi = getProviderForWorkspace(req.workspace)?.ui || null;
      const providerContext = await promptTraceStore.summarizeProviderContext(req.workspace.urlKey, { expectedUi });
      res.json({ ...result, providerContext });
    } catch (err) {
      console.error('Error listing prompt traces:', err);
      serverError.json(res, 'Failed to list prompt traces');
    }
  });


  /**
   * List all custom prompts for the workspace.
   * @route GET /workspace/:urlKey/api/prompts/custom
   */
  router.get('/workspace/:urlKey/api/prompts/custom', workspaceFromUrl, async (req, res) => {
    try {
      const prompts = await customPromptsStore.list(req.workspace.urlKey);
      res.json({ prompts });
    } catch (error) {
      console.error('Custom prompts list error:', error);
      jsonError(res, 500, 'Failed to list custom prompts');
    }
  });

  /**
   * Create a new custom prompt.
   * @route POST /workspace/:urlKey/api/prompts/custom
   */
  router.post('/workspace/:urlKey/api/prompts/custom', workspaceFromUrl, async (req, res) => {
    const { name, template } = req.body;

    try {
      const prompt = await customPromptsStore.create(req.workspace.urlKey, { name, template });
      res.json({ prompt });
    } catch (error) {
      console.error('Custom prompt create error:', error);
      const status = error.message.includes('required') || error.message.includes('maximum') || error.message.includes('characters') ? 400 : 500;
      jsonError(res, status, error.message || 'Failed to create custom prompt');
    }
  });

  /**
   * Update an existing custom prompt.
   * @route PUT /workspace/:urlKey/api/prompts/custom/:id
   */
  router.put('/workspace/:urlKey/api/prompts/custom/:id', workspaceFromUrl, async (req, res) => {
    const { id } = req.params;
    const { name, template } = req.body;

    if (name !== undefined && (typeof name !== 'string' || !name.trim())) {
      return badRequest.json(res, 'Name cannot be empty');
    }
    if (template !== undefined && (typeof template !== 'string' || !template.trim())) {
      return badRequest.json(res, 'Template cannot be empty');
    }

    try {
      const updated = await customPromptsStore.update(req.workspace.urlKey, id, { name, template });
      if (!updated) {
        return notFound.json(res, 'Custom prompt not found');
      }
      res.json({ prompt: updated });
    } catch (error) {
      console.error('Custom prompt update error:', error);
      const status = error.message.includes('characters') ? 400 : 500;
      jsonError(res, status, error.message || 'Failed to update custom prompt');
    }
  });

  /**
   * Delete a custom prompt.
   * @route DELETE /workspace/:urlKey/api/prompts/custom/:id
   */
  router.delete('/workspace/:urlKey/api/prompts/custom/:id', workspaceFromUrl, async (req, res) => {
    const { id } = req.params;

    try {
      const deleted = await customPromptsStore.delete(req.workspace.urlKey, id);
      if (!deleted) {
        return notFound.json(res, 'Custom prompt not found');
      }
      res.json({ ok: true });
    } catch (error) {
      console.error('Custom prompt delete error:', error);
      jsonError(res, 500, 'Failed to delete custom prompt');
    }
  });

  // ===========================================================================
  // Prompt Generation API
  // ===========================================================================

  /**
   * Generate a prompt for a specific issue and label.
   * Returns a prompt that can be copied and used with Claude Code and the workspace API.
   *
   * @route GET /workspace/:urlKey/api/prompt/:issueId/:labelName
   * @param {string} issueId - The Linear issue ID
   * @param {string} labelName - The label name (must have a prompt template)
   * @returns {Object} { label, promptName, prompt } or error
   */
  router.get('/workspace/:urlKey/api/prompt/:issueId/:labelName', workspaceFromUrl, async (req, res) => {
    const workspace = req.workspace;
    const { issueId, labelName } = req.params;

    if (!isValidIssueId(issueId)) {
      return badRequest.json(res, 'Invalid issue ID format');
    }

    // Check if this is a custom prompt request (format: custom:promptId)
    const isCustomPrompt = labelName.startsWith('custom:');

    // Check if label has a prompt template (unless it's a custom prompt)
    if (!isCustomPrompt && !hasPrompt(labelName)) {
      return notFound.json(res, `No prompt template for label: ${labelName}`);
    }

    // Capability-aware prompt generation (LIN-177 S4/S5): thread the active
    // provider's UI surface into prompt generation. Resolved from the workspace
    // (source isn't populated on canonical issues); falls back to Linear for
    // legacy workspaces. For Linear this is a no-op — output stays byte-identical.
    const providerUi = getProviderForWorkspace(workspace)?.ui || null;

    try {
      // The issue and the context the template reads: fixtures in test mode, else the provider's.
      let identifier, issue, context;
      if (isTestToken(workspace)) {
        const mock = buildMockPromptInput(issueId);
        if (!mock) {
          return notFound.json(res, 'Issue not found');
        }
        ({ identifier, issue, context } = mock);
      } else {
        // LIN-1904: resolve the issue's OWN binding (per the `source` provenance
        // stamp LIN-561 puts on every merged-tree row, LIN-544) rather than
        // always the workspace's active provider — same fix as /api/detail
        // (LIN-1903), same helper.
        const { provider: issueProvider, callScope: issueCallScope } = resolveIssueBinding(workspace, req.query.source);
        const { issue: fetched, parent, siblings, project, children, comments, attachments } = await issueProvider.fetchIssueContext(issueCallScope, issueId);
        issue = fetched;
        identifier = issue.identifier;
        // Forward `attachments` (LIN-776) so the in-app /prompt endpoint surfaces the
        // worker-facing Attachments section, matching the proxy /prompt route.
        context = { parent, siblings, project, children, comments, attachments };
      }

      let result;
      if (isCustomPrompt) {
        const customPromptDef = await customPromptsStore.get(workspace.urlKey, labelName.slice('custom:'.length));
        if (!customPromptDef) {
          return notFound.json(res, 'Custom prompt not found');
        }
        // NOTE: generateCustomPrompt renders no Attachments section (variable
        // substitution only) — passing `attachments` would be a no-op, so it's left
        // out here; that's a separate pre-existing gap, not part of LIN-776.
        const { attachments: _unused, ...customContext } = context;
        result = generateCustomPrompt(customPromptDef, issue, customContext, getFeatureFlags(req.session), providerUi);
      } else {
        result = generatePrompt(labelName, issue, context, getFeatureFlags(req.session), providerUi);
      }

      if (!result) {
        return jsonError(res, 500, 'Failed to generate prompt');
      }

      sendPromptResult(req, res, {
        identifier,
        downloadName: result.name,
        prompt: result.prompt,
        json: {
          label: labelName,
          promptName: result.name,
          prompt: result.prompt
        }
      });
    } catch (error) {
      console.error('Prompt generation error:', error);
      jsonError(res, ...failureOf(error, 'Failed to generate prompt'));
    }
  });

  /**
   * Generate an Autopilot kickoff prompt scoped to a specific issue — the
   * "run on autopilot until this task is done" instruction. Autopilot is a
   * light orchestrator that dispatches the actual work to a separate worker;
   * dispatching this prompt to `web` lets the user sit back and watch the loop.
   *
   * The general (stack-walk) kickoff is served at the issueless route below and
   * at /api/proxy/autopilot/kickoff for external agents.
   *
   * The kickoff drives the proxy API exclusively (no per-user switch, LIN-3849). Optional `?mode=readonly` restricts the run to
   * investigation/research prompts; default is write (merge-gated).
   *
   * @route GET /workspace/:urlKey/api/autopilot-prompt/:issueId
   * @param {string} issueId - The Linear issue ID (UUID)
   * @returns {Object} { label, promptName, kind, prompt, repo } or error
   */
  router.get('/workspace/:urlKey/api/autopilot-prompt/:issueId', workspaceFromUrl, async (req, res) => {
    const workspace = req.workspace;
    const { issueId } = req.params;

    if (!isValidIssueId(issueId)) {
      return badRequest.json(res, 'Invalid issue ID format');
    }

    const { mode, variant, stepper, baseUrl } = autopilotParams(req);

    // Run boundary (LIN-3246 / LIN-2949 P1b): optional `?stopAt=pr`. Query params
    // are always strings, so blank/whitespace-only is ABSENT, not an error — the
    // same rule maxTasks follows on the general twin below. Only the literal 'pr'
    // is valid; any other non-blank value is a 400, matching the dispatch route's
    // contract (`routes/dispatch.js`).
    let stopAt = null;
    if (typeof req.query.stopAt === 'string' && req.query.stopAt.trim() !== '') {
      const stopAtMsg = validateRunField('stopAt', req.query.stopAt.trim());
      if (stopAtMsg) {
        return badRequest.json(res, stopAtMsg);
      }
      stopAt = 'pr';
    }

    try {
      // Use mock data in test mode
      if (isTestToken(workspace)) {
        const mockIssue = testMockData.issues.find(i => i.id === issueId);
        if (!mockIssue) {
          return notFound.json(res, 'Issue not found');
        }
        const identifier = mockIssue.url?.split('/').pop() || '';
        const prompt = buildAutopilotKickoff({
          baseUrl,
          issue: { identifier, title: mockIssue.title },
          mode,
          variant,
          stopAt,
          standalone: true
        });
        return sendAutopilotPrompt(req, res, { stepper, identifier, prompt, promptName: `${autopilotTitle(stepper)} — ${identifier}` });
      }

      // LIN-1904: resolve the issue's own binding via `source`, same as /api/prompt.
      const { provider: issueProvider, callScope: issueCallScope } = resolveIssueBinding(workspace, req.query.source);
      const { issue } = await issueProvider.fetchIssueContext(issueCallScope, issueId);
      const prompt = buildAutopilotKickoff({
        baseUrl,
        issue: { identifier: issue.identifier, title: issue.title },
        mode,
        variant,
        stopAt,
        standalone: true,
        // LIN-2804: mirrors the identical generatePrompt pattern already at
        // lines 948/1299/1388 in this file — issueProvider is the actually
        // resolved (possibly cross-source) provider for this issue.
        providerUi: issueProvider.ui || null
      });
      sendAutopilotPrompt(req, res, { stepper, identifier: issue.identifier, prompt, promptName: `${autopilotTitle(stepper)} — ${issue.identifier}` });
    } catch (error) {
      console.error('Autopilot prompt error:', error);
      jsonError(res, ...failureOf(error, 'Failed to generate autopilot prompt'));
    }
  });

  /**
   * Generate a general (stack-walking) Autopilot kickoff — no issue scope.
   * Autopilot orients off `GET /stack` under the precedence policy and works the
   * backlog until it needs the human. Optional `?goal=` supplies a free-text
   * focus; `?mode=readonly` restricts to investigation/research prompts.
   *
   * @route GET /workspace/:urlKey/api/autopilot-prompt
   * @returns {Object} { label, promptName, kind, prompt } or error
   */
  router.get('/workspace/:urlKey/api/autopilot-prompt', workspaceFromUrl, async (req, res) => {
    // LIN-836: same variant wiring as the issue-scoped twin above (stepper only
    // changes the response strings; standard stays byte-identical).
    const { mode, variant, stepper, baseUrl } = autopilotParams(req);
    // LIN-2818: stays at 1000 on purpose. This general/stack-walk goal arrives in
    // the URL query string (the dispatch page's goal textarea round-trips it via
    // `?goal=`), and Node's default 16KB header ceiling can't reliably carry more;
    // it is matched to the textarea's own maxlength. The scoped POST body cap
    // (routes/proxy-kickoff.js) is the surface that rose to MAX_DESCRIPTION_LENGTH.
    const goal = typeof req.query.goal === 'string' ? req.query.goal.slice(0, 1000) : '';

    // Task budget (LIN-1737 D3/Beat 1 seam #3): an optional scope bound threaded
    // into the kickoff so its prose states it, then forwarded by the client to
    // POST /api/dispatch where it is actually enforced (LIN-1751). Query params
    // are always strings, so blank/whitespace-only is treated as ABSENT, not an
    // error — distinct from the JSON-body validation at the dispatch route,
    // which has no such "blank" case to account for. A non-blank value follows
    // the same integer->=1 rule and error text as every other maxTasks entry point.
    let maxTasks = null;
    if (typeof req.query.maxTasks === 'string' && req.query.maxTasks.trim() !== '') {
      const parsedMaxTasks = Number(req.query.maxTasks.trim());
      const maxTasksRuleError = validateRunField('maxTasks', parsedMaxTasks);
      if (maxTasksRuleError) {
        return badRequest.json(res, maxTasksRuleError);
      }
      maxTasks = parsedMaxTasks;
    }

    try {
      // LIN-2804: mirrors the identical generatePrompt pattern at lines 439/3415.
      const prompt = buildAutopilotKickoff({ baseUrl, goal, mode, variant, standalone: true, maxTasks, providerUi: getProviderForWorkspace(req.workspace)?.ui || null });
      sendAutopilotPrompt(req, res, {
        stepper,
        identifier: '',
        prompt,
        promptName: goal.trim()
          ? `${autopilotTitle(stepper)} — ${goal.trim().slice(0, 60)}`
          : (stepper ? 'Autopilot (stepped, stack walk)' : 'Autopilot (stack walk)')
      });
    } catch (error) {
      console.error('Autopilot kickoff error:', error);
      jsonError(res, 500, 'Failed to generate autopilot kickoff', { message: error.message });
    }
  });

  return router;
}
