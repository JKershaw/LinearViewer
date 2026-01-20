/**
 * Dispatch queue routes for prompt dispatch feature.
 *
 * Two types of endpoints:
 * 1. User-facing API (workspace-prefixed, session auth):
 *    - POST /workspace/:urlKey/api/dispatch - Add prompt to queue
 *    - GET /workspace/:urlKey/api/dispatch - List queued items
 *    - DELETE /workspace/:urlKey/api/dispatch/:itemId - Remove item
 *    - GET /workspace/:urlKey/api/dispatch/count - Get queue count
 *    - Token management endpoints
 *
 * 2. Consumer API (token auth):
 *    - GET /api/dispatch/poll - Poll for available items
 *    - POST /api/dispatch/take/:itemId - Atomically claim item
 */

import { Router } from 'express';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Input length limits to prevent database bloat
const MAX_PROMPT_LENGTH = 100000;      // 100KB max for prompt content
const MAX_NAME_LENGTH = 200;           // Short names/labels/titles
const MAX_URL_LENGTH = 2000;           // URLs
const MAX_IDENTIFIER_LENGTH = 50;      // Issue identifiers like "LIN-123"

/**
 * Creates dispatch routes with injected dependencies.
 *
 * @param {Object} options - Dependencies
 * @param {Object} options.dispatchQueueStore - Queue storage instance
 * @param {Object} options.dispatchTokenStore - Token storage instance
 * @param {Function} options.workspaceFromUrl - Middleware to validate workspace
 * @returns {Router} Express router with dispatch routes
 */
export function createDispatchRoutes({ dispatchQueueStore, dispatchTokenStore, workspaceFromUrl }) {
  const router = Router();

  // =========================================================================
  // Consumer API Authentication Middleware
  // =========================================================================

  /**
   * Middleware for token-based authentication (consumer API).
   * Expects: Authorization: Bearer <token>
   * Sets req.dispatchUrlKey on success.
   */
  async function authenticateDispatchToken(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid Authorization header' });
    }

    const token = authHeader.slice(7);

    if (!token) {
      return res.status(401).json({ error: 'Empty token' });
    }

    try {
      const urlKey = await dispatchTokenStore.validateToken(token);

      if (!urlKey) {
        return res.status(401).json({ error: 'Invalid or expired token' });
      }

      req.dispatchUrlKey = urlKey;
      next();
    } catch (err) {
      console.error('Token validation error:', err);
      return res.status(500).json({ error: 'Authentication error' });
    }
  }

  // =========================================================================
  // User-Facing API (Session Auth)
  // =========================================================================

  /**
   * POST /workspace/:urlKey/api/dispatch
   * Add a prompt to the dispatch queue.
   */
  router.post('/workspace/:urlKey/api/dispatch', workspaceFromUrl, async (req, res) => {
    const { workspace } = req;

    try {
      const { prompt, promptName, issueId, issueIdentifier, issueTitle, issueUrl } = req.body;

      // Validate required fields
      if (!prompt || typeof prompt !== 'string') {
        return res.status(400).json({ error: 'prompt is required and must be a string' });
      }

      // Validate input lengths to prevent database bloat
      if (prompt.length > MAX_PROMPT_LENGTH) {
        return res.status(400).json({ error: `prompt exceeds maximum length of ${MAX_PROMPT_LENGTH}` });
      }
      if (promptName && promptName.length > MAX_NAME_LENGTH) {
        return res.status(400).json({ error: `promptName exceeds maximum length of ${MAX_NAME_LENGTH}` });
      }
      if (issueIdentifier && issueIdentifier.length > MAX_IDENTIFIER_LENGTH) {
        return res.status(400).json({ error: `issueIdentifier exceeds maximum length of ${MAX_IDENTIFIER_LENGTH}` });
      }
      if (issueTitle && issueTitle.length > MAX_NAME_LENGTH) {
        return res.status(400).json({ error: `issueTitle exceeds maximum length of ${MAX_NAME_LENGTH}` });
      }
      if (issueUrl && issueUrl.length > MAX_URL_LENGTH) {
        return res.status(400).json({ error: `issueUrl exceeds maximum length of ${MAX_URL_LENGTH}` });
      }

      // Validate issueId format if provided
      if (issueId && !UUID_REGEX.test(issueId)) {
        return res.status(400).json({ error: 'Invalid issueId format' });
      }

      // Create dispatch item
      const item = await dispatchQueueStore.addItem(workspace.urlKey, {
        prompt,
        promptName: promptName || 'Prompt',
        issueId: issueId || null,
        issueIdentifier: issueIdentifier || null,
        issueTitle: issueTitle || null,
        issueUrl: issueUrl || null,
        dispatchedBy: req.session.linearUserId || null
      });

      res.status(201).json({
        success: true,
        item: {
          id: item._id,
          promptName: item.promptName,
          issueIdentifier: item.issueIdentifier,
          dispatchedAt: item.dispatchedAt
        }
      });
    } catch (err) {
      console.error('Dispatch error:', err);
      res.status(500).json({ error: 'Failed to dispatch prompt' });
    }
  });

  /**
   * GET /workspace/:urlKey/api/dispatch
   * List all queued items for this workspace.
   */
  router.get('/workspace/:urlKey/api/dispatch', workspaceFromUrl, async (req, res) => {
    const { workspace } = req;

    try {
      const items = await dispatchQueueStore.listItems(workspace.urlKey);
      res.json({ items });
    } catch (err) {
      console.error('List dispatch items error:', err);
      res.status(500).json({ error: 'Failed to list dispatch items' });
    }
  });

  /**
   * GET /workspace/:urlKey/api/dispatch/count
   * Get the count of queued items (for badge display).
   */
  router.get('/workspace/:urlKey/api/dispatch/count', workspaceFromUrl, async (req, res) => {
    const { workspace } = req;

    try {
      const count = await dispatchQueueStore.countItems(workspace.urlKey);
      res.json({ count });
    } catch (err) {
      console.error('Count dispatch items error:', err);
      res.status(500).json({ error: 'Failed to count dispatch items' });
    }
  });

  /**
   * DELETE /workspace/:urlKey/api/dispatch/:itemId
   * Remove a specific item from the queue.
   */
  router.delete('/workspace/:urlKey/api/dispatch/:itemId', workspaceFromUrl, async (req, res) => {
    const { workspace } = req;
    const { itemId } = req.params;

    // Validate itemId format
    if (!UUID_REGEX.test(itemId)) {
      return res.status(400).json({ error: 'Invalid item ID format' });
    }

    try {
      const removed = await dispatchQueueStore.removeItem(workspace.urlKey, itemId);

      if (!removed) {
        return res.status(404).json({ error: 'Item not found' });
      }

      res.json({ success: true });
    } catch (err) {
      console.error('Remove dispatch item error:', err);
      res.status(500).json({ error: 'Failed to remove item' });
    }
  });

  // =========================================================================
  // Token Management API (Session Auth)
  // =========================================================================

  /**
   * POST /workspace/:urlKey/api/dispatch/tokens
   * Create a new dispatch token for this workspace.
   */
  router.post('/workspace/:urlKey/api/dispatch/tokens', workspaceFromUrl, async (req, res) => {
    const { workspace } = req;

    try {
      const { label } = req.body || {};

      // Validate label length
      if (label && label.length > MAX_NAME_LENGTH) {
        return res.status(400).json({ error: `label exceeds maximum length of ${MAX_NAME_LENGTH}` });
      }

      const result = await dispatchTokenStore.createToken(workspace.urlKey, label || 'default');

      res.status(201).json({
        tokenId: result.tokenId,
        token: result.token, // Plain text - only returned once!
        label: result.label,
        message: 'Token created. Save this token now - it cannot be retrieved later.'
      });
    } catch (err) {
      console.error('Create token error:', err);
      res.status(500).json({ error: 'Failed to create token' });
    }
  });

  /**
   * GET /workspace/:urlKey/api/dispatch/tokens
   * List all tokens for this workspace (metadata only, no secrets).
   */
  router.get('/workspace/:urlKey/api/dispatch/tokens', workspaceFromUrl, async (req, res) => {
    const { workspace } = req;

    try {
      const tokens = await dispatchTokenStore.listTokens(workspace.urlKey);
      res.json({ tokens });
    } catch (err) {
      console.error('List tokens error:', err);
      res.status(500).json({ error: 'Failed to list tokens' });
    }
  });

  /**
   * DELETE /workspace/:urlKey/api/dispatch/tokens/:tokenId
   * Revoke a dispatch token.
   */
  router.delete('/workspace/:urlKey/api/dispatch/tokens/:tokenId', workspaceFromUrl, async (req, res) => {
    const { workspace } = req;
    const { tokenId } = req.params;

    // Validate tokenId format
    if (!UUID_REGEX.test(tokenId)) {
      return res.status(400).json({ error: 'Invalid token ID format' });
    }

    try {
      const revoked = await dispatchTokenStore.revokeToken(workspace.urlKey, tokenId);

      if (!revoked) {
        return res.status(404).json({ error: 'Token not found' });
      }

      res.json({ success: true });
    } catch (err) {
      console.error('Revoke token error:', err);
      res.status(500).json({ error: 'Failed to revoke token' });
    }
  });

  // =========================================================================
  // Consumer API (Token Auth)
  // =========================================================================

  /**
   * GET /api/dispatch/poll
   * Poll for available items in the queue.
   * Requires token authentication.
   */
  router.get('/api/dispatch/poll', authenticateDispatchToken, async (req, res) => {
    try {
      const items = await dispatchQueueStore.pollAvailable(req.dispatchUrlKey);
      res.json({ items });
    } catch (err) {
      console.error('Poll error:', err);
      res.status(500).json({ error: 'Failed to poll dispatch queue' });
    }
  });

  /**
   * POST /api/dispatch/take/:itemId
   * Atomically claim and remove an item from the queue.
   * Requires token authentication.
   */
  router.post('/api/dispatch/take/:itemId', authenticateDispatchToken, async (req, res) => {
    const { itemId } = req.params;

    // Validate itemId format
    if (!UUID_REGEX.test(itemId)) {
      return res.status(400).json({ error: 'Invalid item ID format' });
    }

    try {
      // Take with urlKey verification (consumer can only take from their workspace)
      const item = await dispatchQueueStore.takeItem(itemId, req.dispatchUrlKey);

      if (!item) {
        return res.status(404).json({ error: 'Item not found or already taken' });
      }

      res.json({ item });
    } catch (err) {
      console.error('Take error:', err);
      res.status(500).json({ error: 'Failed to take item' });
    }
  });

  return router;
}
