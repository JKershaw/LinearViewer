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
import rateLimit from 'express-rate-limit';

// Rate limiters for dispatch endpoints to prevent abuse
// Consumer feedback: 100 requests per minute per IP
const feedbackLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many feedback requests, please try again later' },
  // Skip rate limiting in test mode
  skip: () => process.env.NODE_ENV === 'test'
});

// Dispatch queue: 30 requests per minute per IP (reasonable for adding prompts)
const dispatchQueueLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many dispatch requests, please try again later' },
  // Skip rate limiting in test mode
  skip: () => process.env.NODE_ENV === 'test'
});

// Token creation: 5 requests per 15 minutes per IP (tokens rarely created)
const tokenCreationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many token creation requests, please try again later' },
  // Skip rate limiting in test mode
  skip: () => process.env.NODE_ENV === 'test'
});

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Input length limits to prevent MongoDB errors (16MB document limit)
const MAX_PROMPT_LENGTH = 10000000;    // 10MB max for prompt content
const MAX_NAME_LENGTH = 1000;          // Names/labels/titles
const MAX_URL_LENGTH = 8000;           // URLs (covers long query strings)
const MAX_IDENTIFIER_LENGTH = 100;     // Issue identifiers
const MAX_FEEDBACK_MESSAGE_LENGTH = 2000; // Feedback message

// Pattern to detect null bytes and dangerous control characters (except common whitespace)
const DANGEROUS_CHARS_REGEX = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;

/**
 * Creates dispatch routes with injected dependencies.
 *
 * @param {Object} options - Dependencies
 * @param {Object} options.dispatchQueueStore - Queue storage instance
 * @param {Object} options.dispatchTokenStore - Token storage instance
 * @param {Function} options.workspaceFromUrl - Middleware to validate workspace
 * @param {Object} options.userPreferencesStore - User preferences store for recent prompts
 * @returns {Router} Express router with dispatch routes
 */
export function createDispatchRoutes({ dispatchQueueStore, dispatchTokenStore, workspaceFromUrl, userPreferencesStore }) {
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
      const result = await dispatchTokenStore.validateToken(token);

      if (!result) {
        return res.status(401).json({ error: 'Invalid or expired token' });
      }

      req.dispatchUrlKey = result.urlKey;
      req.dispatchTokenLabel = result.label;
      next();
    } catch (err) {
      console.error('Token validation error:', err.message);
      return res.status(500).json({ error: 'Authentication error' });
    }
  }

  // =========================================================================
  // User-Facing API (Session Auth)
  // =========================================================================

  /**
   * POST /workspace/:urlKey/api/dispatch
   * Add a prompt to the dispatch queue.
   * Rate limited to 30 requests per minute per IP.
   */
  router.post('/workspace/:urlKey/api/dispatch', dispatchQueueLimiter, workspaceFromUrl, async (req, res) => {
    const { workspace } = req;

    try {
      const { prompt, promptName, issueId, issueIdentifier, issueTitle, issueUrl, target, repo } = req.body;

      // Validate required fields
      if (!prompt || typeof prompt !== 'string') {
        return res.status(400).json({ error: 'prompt is required and must be a string' });
      }

      // Validate target if provided (must be 'cli', 'web', or 'dash')
      const VALID_TARGETS = ['cli', 'web', 'dash'];
      if (target !== undefined && !VALID_TARGETS.includes(target)) {
        return res.status(400).json({ error: `target must be one of: ${VALID_TARGETS.join(', ')}` });
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
      if (repo && repo.length > MAX_NAME_LENGTH) {
        return res.status(400).json({ error: `repo exceeds maximum length of ${MAX_NAME_LENGTH}` });
      }

      // Reject null bytes and dangerous control characters
      if (DANGEROUS_CHARS_REGEX.test(prompt)) {
        return res.status(400).json({ error: 'prompt contains invalid characters' });
      }
      if (promptName && DANGEROUS_CHARS_REGEX.test(promptName)) {
        return res.status(400).json({ error: 'promptName contains invalid characters' });
      }
      if (issueTitle && DANGEROUS_CHARS_REGEX.test(issueTitle)) {
        return res.status(400).json({ error: 'issueTitle contains invalid characters' });
      }
      if (repo && DANGEROUS_CHARS_REGEX.test(repo)) {
        return res.status(400).json({ error: 'repo contains invalid characters' });
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
        dispatchedBy: req.session.linearUserId || null,
        target: target || 'cli',
        repo: repo || null
      });

      res.status(201).json({
        success: true,
        item: {
          id: item._id,
          promptName: item.promptName,
          issueIdentifier: item.issueIdentifier,
          target: item.target,
          dispatchedAt: item.dispatchedAt
        }
      });
    } catch (err) {
      console.error('Dispatch error:', err.message);
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
      console.error('List dispatch items error:', err.message);
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
      console.error('Count dispatch items error:', err.message);
      res.status(500).json({ error: 'Failed to count dispatch items' });
    }
  });

  /**
   * GET /workspace/:urlKey/api/dispatch/history
   * List dispatch history for this workspace.
   */
  router.get('/workspace/:urlKey/api/dispatch/history', workspaceFromUrl, async (req, res) => {
    const { workspace } = req;

    try {
      const limit = req.query.limit ? Math.min(Math.max(parseInt(req.query.limit, 10), 1), 100) : undefined;
      const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

      const result = await dispatchQueueStore.listHistory(workspace.urlKey, { limit, offset });
      res.json(result);
    } catch (err) {
      console.error('List dispatch history error:', err.message);
      res.status(500).json({ error: 'Failed to list dispatch history' });
    }
  });

  // =========================================================================
  // Recent Custom Prompts API (Session Auth)
  // =========================================================================

  const MAX_RECENT_PROMPTS = 10;
  const MAX_CUSTOM_PROMPT_LENGTH = 10000;

  /**
   * GET /workspace/:urlKey/api/dispatch/recent-prompts
   * Fetch recent custom prompts for the current user and workspace.
   */
  router.get('/workspace/:urlKey/api/dispatch/recent-prompts', workspaceFromUrl, async (req, res) => {
    const linearUserId = req.session.linearUserId;
    if (!linearUserId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (!userPreferencesStore) {
      return res.json({ prompts: [] });
    }

    try {
      const prefs = await userPreferencesStore.getUserPreferences(linearUserId);
      const recentByWorkspace = prefs.recentCustomPrompts || {};
      const prompts = recentByWorkspace[req.workspace.urlKey] || [];
      res.json({ prompts });
    } catch (err) {
      console.error('Failed to fetch recent prompts:', err.message);
      res.json({ prompts: [] });
    }
  });

  /**
   * POST /workspace/:urlKey/api/dispatch/recent-prompts
   * Save a custom prompt to the recent list for the current user and workspace.
   */
  router.post('/workspace/:urlKey/api/dispatch/recent-prompts', workspaceFromUrl, async (req, res) => {
    const linearUserId = req.session.linearUserId;
    if (!linearUserId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (!userPreferencesStore) {
      return res.status(503).json({ error: 'Service unavailable' });
    }

    const { prompt: rawPrompt } = req.body;
    const prompt = typeof rawPrompt === 'string' ? rawPrompt.trim() : rawPrompt;
    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'prompt is required and must be a string' });
    }
    if (prompt.length > MAX_CUSTOM_PROMPT_LENGTH) {
      return res.status(400).json({ error: `prompt exceeds maximum length of ${MAX_CUSTOM_PROMPT_LENGTH}` });
    }
    if (DANGEROUS_CHARS_REGEX.test(prompt)) {
      return res.status(400).json({ error: 'prompt contains invalid characters' });
    }

    try {
      const prefs = await userPreferencesStore.getUserPreferences(linearUserId);
      const recentByWorkspace = prefs.recentCustomPrompts || {};
      const urlKey = req.workspace.urlKey;
      let list = recentByWorkspace[urlKey] || [];

      // Deduplicate: remove existing match, prepend new
      list = list.filter(p => p !== prompt);
      list.unshift(prompt);
      list = list.slice(0, MAX_RECENT_PROMPTS);

      await userPreferencesStore.saveUserPreferences(linearUserId, {
        ...prefs,
        recentCustomPrompts: {
          ...recentByWorkspace,
          [urlKey]: list
        }
      });

      res.json({ success: true });
    } catch (err) {
      console.error('Failed to save recent prompt:', err.message);
      res.status(500).json({ error: 'Failed to save recent prompt' });
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
      console.error('Remove dispatch item error:', err.message);
      res.status(500).json({ error: 'Failed to remove item' });
    }
  });

  // =========================================================================
  // Token Management API (Session Auth)
  // =========================================================================

  /**
   * POST /workspace/:urlKey/api/dispatch/tokens
   * Create a new dispatch token for this workspace.
   * Rate limited to 5 requests per 15 minutes per IP.
   */
  router.post('/workspace/:urlKey/api/dispatch/tokens', tokenCreationLimiter, workspaceFromUrl, async (req, res) => {
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
      console.error('Create token error:', err.message);
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
      console.error('List tokens error:', err.message);
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
      console.error('Revoke token error:', err.message);
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
      console.error('Poll error:', err.message);
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
      const item = await dispatchQueueStore.takeItem(itemId, req.dispatchUrlKey, req.dispatchTokenLabel);

      if (!item) {
        return res.status(404).json({ error: 'Item not found or already taken' });
      }

      res.json({ item });
    } catch (err) {
      console.error('Take error:', err.message);
      res.status(500).json({ error: 'Failed to take item' });
    }
  });

  /**
   * POST /api/dispatch/feedback/:itemId
   * Post feedback on a taken item.
   * Requires token authentication. Only the token that took the item can post feedback.
   * Rate limited to 100 requests per minute per IP.
   */
  router.post('/api/dispatch/feedback/:itemId', feedbackLimiter, authenticateDispatchToken, async (req, res) => {
    const { itemId } = req.params;

    // Validate itemId format
    if (!UUID_REGEX.test(itemId)) {
      return res.status(400).json({ error: 'Invalid item ID format' });
    }

    const { message, url, urlLabel } = req.body;

    // Validate required fields
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'message is required and must be a string' });
    }

    // Validate lengths
    if (message.length > MAX_FEEDBACK_MESSAGE_LENGTH) {
      return res.status(400).json({ error: `message exceeds maximum length of ${MAX_FEEDBACK_MESSAGE_LENGTH}` });
    }
    if (url && url.length > MAX_URL_LENGTH) {
      return res.status(400).json({ error: `url exceeds maximum length of ${MAX_URL_LENGTH}` });
    }
    if (urlLabel && urlLabel.length > MAX_NAME_LENGTH) {
      return res.status(400).json({ error: `urlLabel exceeds maximum length of ${MAX_NAME_LENGTH}` });
    }

    // Reject dangerous characters
    if (DANGEROUS_CHARS_REGEX.test(message)) {
      return res.status(400).json({ error: 'message contains invalid characters' });
    }
    if (urlLabel && DANGEROUS_CHARS_REGEX.test(urlLabel)) {
      return res.status(400).json({ error: 'urlLabel contains invalid characters' });
    }

    // Block javascript: and other dangerous URL schemes
    if (url) {
      try {
        const parsed = new URL(url);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          return res.status(400).json({ error: 'url must use http or https protocol' });
        }
      } catch {
        return res.status(400).json({ error: 'url must be a valid URL' });
      }
    }

    try {
      const result = await dispatchQueueStore.addFeedback(
        itemId,
        req.dispatchUrlKey,
        { message, url: url || null, urlLabel: urlLabel || null },
        req.dispatchTokenLabel
      );

      if (!result) {
        return res.status(404).json({ error: 'Item not found or feedback not allowed' });
      }

      res.json(result);
    } catch (err) {
      console.error('Feedback error:', err.message);
      res.status(500).json({ error: 'Failed to post feedback' });
    }
  });

  return router;
}
