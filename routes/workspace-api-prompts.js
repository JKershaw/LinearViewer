/**
 * Prompt-traces and custom-prompts API routes (LIN-2246: extracted from
 * workspace-api.js, stage 2).
 *
 * Handles /workspace/:urlKey/api/prompt-traces (read-only debug/eval trace
 * listing) and /workspace/:urlKey/api/prompts/custom (CRUD for
 * user-authored custom prompt templates). Both groups are simple store
 * pass-throughs with no owning helpers of their own.
 */
import { Router } from 'express';
import { badRequest, jsonError, notFound } from '../lib/errors.js';

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
      return res.json({ items: [], total: 0 });
    }
    try {
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
      const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
      const result = await promptTraceStore.listTraces(req.workspace.urlKey, { limit, offset });
      res.json(result);
    } catch (err) {
      console.error('Error listing prompt traces:', err);
      res.status(500).json({ error: 'Failed to list prompt traces' });
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

  return router;
}
