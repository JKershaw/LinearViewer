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
import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawnClaudeSession } from '../lib/harbour-spawn.js';
import { isValidDispatchKind, deriveDispatchKind, DISPATCH_KINDS } from '../lib/prompt-templates.js';

// Directory for Harbour dispatch prompt staging files. The OS tmp dir is
// shared between the Node server and the Harbour terminal that reads the
// staged prompt back out via `cat` inside the spawned `sh -c` command.
const HARBOUR_STAGING_DIR = path.join(os.tmpdir(), 'harbour-dispatch');

/**
 * Writes the prompt to a staging file under HARBOUR_STAGING_DIR (mode 0600
 * inside a 0700 dir). The file is read back by the Harbour-spawned `sh -c`
 * command via `cat`, sidestepping argv length limits and shell-escaping
 * pain for multi-line prompts. Cleanup is the responsibility of the
 * cloned repo's Claude `SessionStart` hook.
 *
 * @param {string} itemId - Dispatch item UUID (used as filename)
 * @param {string} prompt - Raw prompt text
 * @returns {string} Absolute path to the staging file
 */
function writeHarbourStagingFile(itemId, prompt) {
  fs.mkdirSync(HARBOUR_STAGING_DIR, { mode: 0o700, recursive: true });
  const filePath = path.join(HARBOUR_STAGING_DIR, `${itemId}.prompt`);
  fs.writeFileSync(filePath, prompt, { mode: 0o600 });
  return filePath;
}

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
 * @param {Object} [options.harbourFeedbackTokenStore] - Short-TTL feedback token store for Harbour dispatches
 * @returns {Router} Express router with dispatch routes
 */
export function createDispatchRoutes({ dispatchQueueStore, dispatchTokenStore, workspaceFromUrl, userPreferencesStore, harbourFeedbackTokenStore }) {
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

  /**
   * Middleware for the dispatch feedback endpoint. Accepts either:
   *  - A short-lived single-use Harbour feedback token (bound to the
   *    itemId in the URL); or
   *  - A workspace-scoped consumer dispatch token (existing path).
   *
   * Harbour tokens are tried first because they're the more constrained
   * credential — a leaked harbour token can post one feedback against one
   * item, where a leaked dispatch token would have full workspace scope.
   * On success sets req.dispatchUrlKey and req.dispatchTokenLabel.
   */
  async function authenticateFeedbackToken(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid Authorization header' });
    }
    const token = authHeader.slice(7);
    if (!token) {
      return res.status(401).json({ error: 'Empty token' });
    }

    if (harbourFeedbackTokenStore) {
      try {
        const result = await harbourFeedbackTokenStore.validateAndConsume(token, req.params.itemId);
        if (result) {
          req.dispatchUrlKey = result.urlKey;
          req.dispatchTokenLabel = 'harbour';
          return next();
        }
      } catch (err) {
        console.error('Harbour feedback token validation error:', err.message);
        // Fall through to standard dispatch token check
      }
    }

    return authenticateDispatchToken(req, res, next);
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
      const { prompt, promptName, kind, issueId, issueIdentifier, issueTitle, issueUrl, target, repo, followUpTo } = req.body;

      // Validate required fields
      if (!prompt || typeof prompt !== 'string') {
        return res.status(400).json({ error: 'prompt is required and must be a string' });
      }

      // Validate target if provided
      const VALID_TARGETS = ['cli', 'web', 'dash', 'local'];
      if (target !== undefined && !VALID_TARGETS.includes(target)) {
        return res.status(400).json({ error: `target must be one of: ${VALID_TARGETS.join(', ')}` });
      }

      // Validate kind if provided; when omitted it is derived from promptName below.
      if (kind !== undefined && !isValidDispatchKind(kind)) {
        return res.status(400).json({ error: `kind must be one of: ${DISPATCH_KINDS.join(', ')}` });
      }

      // Reject local target from non-localhost requests
      if (target === 'local') {
        const host = (req.get('host') || '').split(':')[0];
        if (!['localhost', '127.0.0.1'].includes(host)) {
          return res.status(400).json({ error: 'local target is only available on localhost' });
        }
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

      // Validate follow-up reference if provided. A follow-up resumes an
      // existing session, so it carries the original dispatchId (a UUID).
      // We store + forward it blindly — the downstream dispatcher owns session
      // liveness — but the value must be well-formed. Follow-ups are cli/web
      // only; resuming a Harbour/dash session is out of scope. See LIN-415.
      if (followUpTo !== undefined && followUpTo !== null) {
        if (!UUID_REGEX.test(followUpTo)) {
          return res.status(400).json({ error: 'Invalid followUpTo format' });
        }
        const followUpTarget = target || 'cli';
        if (!['cli', 'web'].includes(followUpTarget)) {
          return res.status(400).json({ error: 'followUpTo is only supported for cli/web targets' });
        }
      }

      // Create dispatch item
      const item = await dispatchQueueStore.addItem(workspace.urlKey, {
        prompt,
        promptName: promptName || 'Prompt',
        kind: kind || deriveDispatchKind(promptName),
        issueId: issueId || null,
        issueIdentifier: issueIdentifier || null,
        issueTitle: issueTitle || null,
        issueUrl: issueUrl || null,
        dispatchedBy: req.session.linearUserId || null,
        target: target || 'cli',
        repo: repo || null,
        followUpTo: followUpTo || null
      });

      // Spawn a Harbour Claude session when target is 'local' (the API value
      // 'local' is preserved for backward compatibility; user-facing surfaces
      // refer to this as "Harbour"). We ALWAYS stage the prompt to a file
      // for target='local' — regardless of whether a repo was picked — so
      // the prompt never lands inline on jsh's stdin line (where embedded
      // newlines break single-quote parsing and appear as "pasted over many
      // lines"). When a feedback token store is wired we also mint a short-
      // lived token and pass the feedback URL in the OSC env; when a repo
      // is set, spawnClaudeSession prepends `git clone` + `cd`. Successful
      // spawns move the item into history with tokenLabel 'harbour' so the
      // addFeedback ownership check accepts the hook callback.
      let spawn = undefined;
      if (target === 'local') {
        try {
          const stagingFilePath = writeHarbourStagingFile(item._id, prompt);

          let feedbackUrl;
          let mintedToken;
          if (harbourFeedbackTokenStore) {
            const minted = await harbourFeedbackTokenStore.mintToken(item._id, workspace.urlKey);
            feedbackUrl = `${req.protocol}://${req.get('host')}/api/dispatch/feedback/${item._id}`;
            mintedToken = minted.token;
          }

          spawn = spawnClaudeSession(prompt, {
            repo: item.repo || undefined,
            dispatchId: item._id,
            feedbackUrl,
            token: mintedToken,
            stagingFilePath
          });

          if (spawn.success && harbourFeedbackTokenStore) {
            // Best-effort take so the hook can post feedback against an
            // archived "taken" item. If the take fails (e.g. the user
            // already cancelled the queued item between insert and now),
            // the spawn still proceeds — the hook callback will simply
            // 404, which is acceptable.
            try {
              await dispatchQueueStore.takeItem(item._id, workspace.urlKey, 'harbour');
            } catch (takeErr) {
              console.error('Harbour take after spawn failed:', takeErr.message);
            }
          }
        } catch (err) {
          console.error('Harbour spawn setup failed:', err.message);
          spawn = { success: false, error: 'Harbour spawn setup failed' };
        }
      }

      res.status(201).json({
        success: true,
        item: {
          id: item._id,
          promptName: item.promptName,
          kind: item.kind,
          issueIdentifier: item.issueIdentifier,
          target: item.target,
          dispatchedAt: item.dispatchedAt
        },
        ...(spawn ? { spawn } : {})
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

      // Echo `dispatchId` as a top-level alias of `item.id` so consumers see it
      // without having to dig into the item shape. Forward this value as
      // `dispatchId` when posting to /api/proxy/foreman/status to enable exact
      // loop-reconstruction joins (see LIN-245). Purely additive — existing
      // consumers that destructure `{ item }` are unaffected.
      res.json({ item, dispatchId: item.id });
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
  router.post('/api/dispatch/feedback/:itemId', feedbackLimiter, authenticateFeedbackToken, async (req, res) => {
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
