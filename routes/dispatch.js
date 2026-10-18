/**
 * Dispatch queue routes for prompt dispatch feature (rebuilt design-first in LIN-3592:
 * the same routes, bodies and refusals, each body's checks written down once as an
 * ordered list).
 *
 * Two types of endpoints:
 * 1. User-facing API (workspace-prefixed, session auth):
 *    - POST /workspace/:urlKey/api/dispatch - Add prompt to queue
 *    - GET /workspace/:urlKey/api/dispatch - List queued items
 *    - DELETE /workspace/:urlKey/api/dispatch/:itemId - Remove item
 *    - PATCH /workspace/:urlKey/api/dispatch/:sessionId/trim - Graceful trim
 *      (LIN-2147): amend a live run's maxTasks bound downward
 *    - GET /workspace/:urlKey/api/dispatch/count - Get queue count
 *    - Token management endpoints
 *    - Dispatch presets CRUD (LIN-1391): GET/POST /workspace/:urlKey/api/dispatch/presets,
 *      PATCH/DELETE /workspace/:urlKey/api/dispatch/presets/:presetId
 *
 * 2. Consumer API (token auth):
 *    - GET /api/dispatch/poll - Poll for available items
 *    - POST /api/dispatch/take/:itemId - Atomically claim item
 */

import { Router } from 'express';
import { createHeartbeatIngest } from '../lib/consumer-heartbeat-ingest.js';
import { badRequest, jsonError, notFound, unauthorized, serviceUnavailable } from '../lib/errors.js';
import rateLimit from 'express-rate-limit';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawnClaudeSession } from '../lib/harbour-spawn.js';
import { DISPATCH_DEFAULT_KINDS } from '../lib/prompt-templates.js';
import { isPositiveInteger } from '../lib/dispatch-fields.js';
import { enterSessionDispatch, opaqueFieldError } from '../lib/dispatch-entrance.js';
import { provisionResumeCredential, isStructuralGrantRefusal } from '../lib/proxy-preamble.js';
import { BOOTSTRAP_TOKEN_TTL_SECONDS } from '../lib/proxy-tokens.js';
import { READ_WRITE } from '../lib/proxy-scopes.js';
import { validateFeedbackBody } from '../lib/dispatch-feedback-validation.js';
import { buildWakeCredentialProvisioner } from '../lib/wake-credential.js';
import { readHaltForPoll, projectHaltForPoll, POLL_HALT_READ_TIMEOUT_MS } from '../lib/poll-halt.js';
import { ownerlessCompatEnabled } from '../lib/ownerless-token-policy.js';
import { buildQueuedPollWarning, getConsumerLastSeenAt } from '../lib/consumer-poll-warning.js';
import { HALT_MODES, HALT_MODE_ERROR } from '../lib/workspace-halt.js';
import { deriveTerminalStatus } from '../lib/dispatch-terminal.js';
import { resolveOwnerMintRefusal } from '../lib/owner-mint-refusals.js';
import { resolveRunnerOwnerRefusal, sendRunnerRefusal } from '../lib/runner-owner-gate.js';
import { resolveChatCredential } from '../lib/chat-request.js';
import { resolveAccountGroup } from '../lib/account-group.js';
import { redactSessionItem, redactSessionItems } from '../lib/dispatch-session-redaction.js';

// Directory for Harbour OS dispatch prompt staging files. The OS tmp dir is
// shared between the Node server and the Harbour OS terminal that reads the
// staged prompt back out via `cat` inside the spawned `sh -c` command.
const HARBOUR_STAGING_DIR = path.join(os.tmpdir(), 'harbour-dispatch');

/**
 * Writes the prompt to a staging file under HARBOUR_STAGING_DIR (mode 0600
 * inside a 0700 dir). The file is read back by the Harbour OS-spawned `sh -c`
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

// Consumer heartbeat (LIN-1952): same 100/min/IP shape as feedback. A consumer
// sends one a minute; the headroom is for several consumers behind one IP.
const heartbeatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many heartbeat requests, please try again later' },
  skip: () => process.env.NODE_ENV === 'test'
});

// Dispatch queue: 30 requests per minute per IP (reasonable for adding prompts)
// Exported (LIN-2434 R1) so a dispatch-creating route on a different router/
// factory (e.g. routes/flight-companion.js's approve-follow-up route) can
// apply the SAME budget explicitly — mounting on a different router does not
// inherit a limiter applied only within this one.
export const dispatchQueueLimiter = rateLimit({
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

// Input length limits to prevent MongoDB errors (16MB document limit). The
// prompt/identifier caps for the POST /dispatch payload now live in
// lib/dispatch-validation.js (shared with the proxy twin, LIN-1139); the
// feedback message/url caps live in lib/dispatch-feedback-validation.js
// (shared with the runner feedback route, LIN-3130). This remains for the
// other endpoints in this router (token label, model/harness/effort).
const MAX_NAME_LENGTH = 1000;          // Names/labels/titles

// Pattern to detect null bytes and dangerous control characters (except common whitespace)
const DANGEROUS_CHARS_REGEX = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;

// Maximum recent / favourite custom prompts handling (the favourites cap is the store's).
const MAX_RECENT_PROMPTS = 10;
const MAX_CUSTOM_PROMPT_LENGTH = 10000;

// A failed handler answers 500 with a fixed message and logs why; nothing else of the
// error leaves the server.
function reportFailure(res, label, err, message) {
  console.error(label, err.message);
  return jsonError(res, 500, message);
}

// The prompt a recents / favourites POST accepts, trimmed — or why it is refused.
// Validation is the same for both lists so a favourite and its recent counterpart
// accept/reject the same strings (and stay in sync by value).
function promptTextFailure(rawPrompt) {
  const prompt = typeof rawPrompt === 'string' ? rawPrompt.trim() : rawPrompt;
  if (!prompt || typeof prompt !== 'string') return { error: 'prompt is required and must be a string' };
  if (prompt.length > MAX_CUSTOM_PROMPT_LENGTH) return { error: `prompt exceeds maximum length of ${MAX_CUSTOM_PROMPT_LENGTH}` };
  if (DANGEROUS_CHARS_REGEX.test(prompt)) return { error: 'prompt contains invalid characters' };
  return { prompt };
}

// Recents and favourites are per account: the signed-in account id, or null once the 401
// has been sent.
function signedInAccount(req, res) {
  const accountId = req.session.accountId;
  if (!accountId) unauthorized.json(res, 'Authentication required');
  return accountId || null;
}

/**
 * Normalize + validate a `byKind` map from a preset CRUD request body,
 * mirroring the `server.js` dispatch-defaults per-kind loop: only known
 * `DISPATCH_DEFAULT_KINDS` keys are read, each entry is trimmed to
 * `{ model?, harness? }`, and a kind with neither field set is dropped.
 * Throws `{ error }` (via `badRequest`-shaped return, not an exception) on
 * the first invalid field, same convention as the top-level model/harness
 * checks below.
 *
 * @param {*} byKind - Caller-supplied byKind value (any shape)
 * @returns {{ error: string }|{ byKind: Object }}
 */
function normalizeDispatchPresetByKind(byKind) {
  if (byKind === undefined) return { byKind: undefined };
  if (typeof byKind !== 'object' || byKind === null || Array.isArray(byKind)) {
    return { error: 'byKind must be an object' };
  }
  const normalized = {};
  for (const kind of DISPATCH_DEFAULT_KINDS) {
    const entry = byKind[kind];
    if (entry === undefined) continue;
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      return { error: `byKind.${kind} must be an object` };
    }
    const model = typeof entry.model === 'string' ? entry.model.trim() : '';
    const harness = typeof entry.harness === 'string' ? entry.harness.trim() : '';
    const effort = typeof entry.effort === 'string' ? entry.effort.trim() : '';
    const error = opaqueFieldError(model, 'model', { maxLength: MAX_NAME_LENGTH })
      || opaqueFieldError(harness, 'harness', { maxLength: MAX_NAME_LENGTH })
      || opaqueFieldError(effort, 'effort', { maxLength: MAX_NAME_LENGTH });
    if (error) return { error };
    if (model || harness || effort) {
      normalized[kind] = {};
      if (model) normalized[kind].model = model;
      if (harness) normalized[kind].harness = harness;
      if (effort) normalized[kind].effort = effort;
    }
  }
  return { byKind: normalized };
}

function buildDispatchPresetConfig({ model, harness, effort, byKind }) {
  const config = {};
  const trimmedModel = typeof model === 'string' ? model.trim() : '';
  const trimmedHarness = typeof harness === 'string' ? harness.trim() : '';
  const trimmedEffort = typeof effort === 'string' ? effort.trim() : '';
  if (trimmedModel) config.model = trimmedModel;
  if (trimmedHarness) config.harness = trimmedHarness;
  if (trimmedEffort) config.effort = trimmedEffort;
  if (byKind && typeof byKind === 'object' && Object.keys(byKind).length) config.byKind = byKind;
  return config;
}

// Preset store validation errors (name/config shape, custom cap) are the
// only ones this route can cause; anything else is a genuine 500. Mirrors
// the same status-by-message-pattern convention routes/collective.js uses
// for its own preset store.
function dispatchPresetErrorStatus(message) {
  return /required|characters or less|must be|maximum of/.test(message) ? 400 : 500;
}

// What a preset create / update body must satisfy before the store sees it: the opaque
// execution fields (model, harness, effort), then the per-kind map. `{ error }` on the
// first failure, else `{ byKind }` (undefined when the body omits it).
function presetBodyCheck({ model, harness, effort, byKind }) {
  const error = opaqueFieldError(model, 'model', { maxLength: MAX_NAME_LENGTH })
    || opaqueFieldError(harness, 'harness', { maxLength: MAX_NAME_LENGTH })
    || opaqueFieldError(effort, 'effort', { maxLength: MAX_NAME_LENGTH });
  return error ? { error } : normalizeDispatchPresetByKind(byKind);
}

/**
 * Creates dispatch routes with injected dependencies.
 *
 * @param {Object} options - Dependencies
 * @param {Object} options.dispatchQueueStore - Queue storage instance
 * @param {Object} options.dispatchTokenStore - Token storage instance
 * @param {Function} options.workspaceFromUrl - Middleware to validate workspace
 * @param {Object} options.userPreferencesStore - User preferences store for recent prompts
 * @param {Object} [options.harbourFeedbackTokenStore] - Short-TTL feedback token store for Harbour OS dispatches
 * @param {Object} [options.workspacePreferencesStore] - Workspace preferences store, used to
 *   resolve dispatchDefaults (model/harness) for blank incoming values (LIN-1094)
 * @param {Object} [options.dispatchPresetsStore] - Dispatch presets store (LIN-1390), used to
 *   validate an incoming `presetId` and resolve its config's routing precedence over
 *   workspace dispatchDefaults. Absent → `presetId` is accepted but has no effect. Also
 *   backs the preset CRUD API below (LIN-1391 S7) — absent → CRUD routes 503.
 * @param {Object} [options.proxyTokenStore] - Proxy token store, used to mint the single-use
 *   bootstrap and attach the workspace-API proxy-context block server-side when the client
 *   requests it (`attachProxy:true`), so a claude-code dispatch carries the token as the
 *   structured `bootstrapToken` field instead of injectable prose (LIN-1162). Absent → the
 *   attach degrades to a no-op (attachProxyContext returns the prompt unchanged).
 * @param {Function|null} [options.workspaceOwnerCheck] - The workspace-owner seam
 *   (`createWorkspaceOwnerCheck`), used to gate the legacy dispatch-token mint
 *   (LIN-3137 J5) so only a workspace's owner can mint. `null` (unwired) fails
 *   closed with OWNER_CHECK_UNAVAILABLE. Never consulted on the verify path.
 * @returns {Router} Express router with dispatch routes
 */
export function createDispatchRoutes({ dispatchQueueStore, dispatchTokenStore, workspaceFromUrl, userPreferencesStore, harbourFeedbackTokenStore, workspacePreferencesStore, dispatchPresetsStore, proxyTokenStore, provider: injectedProvider = null, getWorkspaceAccessToken = null, fetchIssueContext = null, workspaceHaltStore = null, haltReadTimeoutMs = POLL_HALT_READ_TIMEOUT_MS, sessionsFeedCache = null, workspaceOwnerCheck = null, taskModeStore = null, freeTierStore = null, accountStore = null, consumerHeartbeatStore = null }) {
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
      return unauthorized.json(res, 'Missing or invalid Authorization header');
    }

    const token = authHeader.slice(7);

    if (!token) {
      return unauthorized.json(res, 'Empty token');
    }

    try {
      const result = await dispatchTokenStore.validateToken(token);

      if (!result) {
        return unauthorized.json(res, 'Invalid or expired token');
      }

      req.dispatchUrlKey = result.urlKey;
      req.dispatchTokenLabel = result.label;
      req.dispatchTokenId = result.tokenId ?? null; // LIN-1952: recorded on heartbeats
      // LIN-1397: the dispatch token's creating account, if any — null for
      // tokens minted before createdBy existed. Consumed by the broker-token
      // mint endpoint below, which must not stamp a null owner onto a bootstrap.
      req.dispatchTokenOwner = result.createdBy ?? null;
      next();
    } catch (err) {
      console.error('Token validation error:', err.message);
      return jsonError(res, 500, 'Authentication error');
    }
  }

  /**
   * Middleware for the dispatch feedback endpoint. Accepts either:
   *  - A short-lived single-use Harbour OS feedback token (bound to the
   *    itemId in the URL); or
   *  - A workspace-scoped consumer dispatch token (existing path).
   *
   * Harbour OS tokens are tried first because they're the more constrained
   * credential — a leaked harbour token can post one feedback against one
   * item, where a leaked dispatch token would have full workspace scope.
   * On success sets req.dispatchUrlKey and req.dispatchTokenLabel.
   */
  async function authenticateFeedbackToken(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return unauthorized.json(res, 'Missing or invalid Authorization header');
    }
    const token = authHeader.slice(7);
    if (!token) {
      return unauthorized.json(res, 'Empty token');
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
  // Owner gate and Harbour OS spawn (shared by the session routes below)
  // =========================================================================

  // LIN-3398: owner-only gate for the session-side runner mutations below (halt
  // POST/DELETE, delete, trim, dispatch-token revoke). One call shape for all
  // five: resolve through the shared runner-owner gate, answer through
  // `sendRunnerRefusal`, and return true when the caller must stop. Always runs
  // BEFORE the route's first store write. `target` is the queue row's own target
  // for delete/trim (dash/local stay member-reachable); halt and revoke pass
  // none, which means `cli` and is always checked. The refusal carries only the
  // envelope: never the row read to find `target` (it holds `bootstrapToken`).
  async function refuseNonOwner(req, res, target) {
    const refusal = await resolveRunnerOwnerRefusal({
      ownerCheck: workspaceOwnerCheck,
      workspaceId: req.workspace.id,
      accountId: req.session?.accountId,
      target
    });
    if (!refusal) return false;
    sendRunnerRefusal(res, refusal);
    return true;
  }

  // Spawn a Harbour OS Claude session when target is 'local' (the API value
  // 'local' is preserved for backward compatibility; user-facing surfaces
  // refer to this as "Harbour OS"). We ALWAYS stage the prompt to a file
  // for target='local' — regardless of whether a repo was picked — so
  // the prompt never lands inline on jsh's stdin line (where embedded
  // newlines break single-quote parsing and appear as "pasted over many
  // lines"). When a feedback token store is wired we also mint a short-
  // lived token and pass the feedback URL in the OSC env; when a repo
  // is set, spawnClaudeSession prepends `git clone` + `cd`. Successful
  // spawns move the item into history with tokenLabel 'harbour' so the
  // addFeedback ownership check accepts the hook callback.
  //
  // Answers the `spawn` field of the 201: the session's own result, or a failed-setup
  // marker when staging or minting threw.
  async function host(item, req, workspace) {
    try {
      // Use item.prompt (not the request-body `prompt`): addItem may have
      // amended it — e.g. the LIN-599 autopilot session-id block — and the
      // spawned session must see exactly what cli/web consumers receive.
      const stagingFilePath = writeHarbourStagingFile(item._id, item.prompt);

      let feedbackUrl;
      let mintedToken;
      if (harbourFeedbackTokenStore) {
        const minted = await harbourFeedbackTokenStore.mintToken(item._id, workspace.urlKey);
        feedbackUrl = `${req.protocol}://${req.get('host')}/api/dispatch/feedback/${item._id}`;
        mintedToken = minted.token;
      }

      const spawn = spawnClaudeSession(item.prompt, {
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
      return spawn;
    } catch (err) {
      console.error('Harbour spawn setup failed:', err.message);
      return { success: false, error: 'Harbour spawn setup failed' };
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
    await enterSessionDispatch({
      req,
      res,
      workspace: req.workspace,
      dispatchQueueStore,
      dispatchTokenStore,
      workspacePreferencesStore,
      dispatchPresetsStore,
      proxyTokenStore,
      freeTierStore,
      accountStore,
      injectedProvider,
      getWorkspaceAccessToken,
      fetchIssueContext,
      // LIN-3383: the owner gate is this route's (it runs in the authority at the one point it
      // must: after the body's shape checks, before every read and write).
      ownerGate: (target) => refuseNonOwner(req, res, target),
      // D24: the task-mode record and the Harbour OS spawn stay here, with the route that owns them.
      afterEnqueue: async ({ item, issueId, issueIdentifier, entryRung, surface, target }) => {
        // LIN-2942: the item exists, so record the ladder press that created it, linked by
        // dispatchId. Fire-and-forget: a failed record never fails or delays the dispatch, and the
        // response is the same with or without it. Only a session account can be attributed; without
        // one nothing is recorded.
        if (entryRung !== undefined && entryRung !== null && taskModeStore && req.session?.accountId) {
          try {
            Promise.resolve(taskModeStore.record({
              accountId: req.session.accountId,
              urlKey: req.workspace.urlKey,
              issueId: issueId || null,
              issueIdentifier,
              rung: entryRung,
              ready: true,
              needs: null,
              act: 'dispatch',
              dispatchId: item._id,
              // LIN-2944 P1: the caller's validated surface, or null for the other dispatch callers
              // that pass none.
              surface: surface !== undefined && surface !== null ? surface : null
            })).catch(err => console.error('Failed to record task-mode dispatch event:', err));
          } catch (err) {
            console.error('Failed to record task-mode dispatch event:', err);
          }
        }

        // Harbour OS: a 'local' dispatch is staged to a file and spawned on this server's tty (see
        // host above). Absent for every other target.
        return target === 'local' ? await host(item, req, req.workspace) : undefined;
      }
    });
  });

  /**
   * GET /workspace/:urlKey/api/dispatch
   * List all queued items for this workspace.
   */
  router.get('/workspace/:urlKey/api/dispatch', workspaceFromUrl, async (req, res) => {
    const { workspace } = req;

    try {
      const items = await dispatchQueueStore.listItems(workspace.urlKey);
      // Consumer poll-recency warning (LIN-2885), derived fresh against the
      // current clock from the LIVE poll recency (LIN-3367: read once per
      // request, not per row; queued rows only) — same helper the proxy
      // watch/list endpoints use — so the dispatch page's queue list and the
      // nav-badge popover (both rendered off this response via
      // window.renderQueueRow) can show "no runner has polled..." on a stale
      // queued row without duplicating the threshold logic client-side. This
      // collection is the queue itself, so every row here is queued and the
      // status gate is a no-op; it is routed through the shared helper so the
      // rule lives in one place.
      const liveLastSeenAt = items.length
        ? await getConsumerLastSeenAt(dispatchTokenStore, workspace.urlKey, proxyTokenStore)
        : null;
      // LIN-3384: session-readable — the live bootstrap token never leaves on this route
      // (runner poll/take is the only token-bearing path).
      const callerId = req.session?.accountId || null;
      res.json({ items: items.map(item => ({ ...redactSessionItem(item, callerId), consumerPollWarning: buildQueuedPollWarning('queued', liveLastSeenAt) })) });
    } catch (err) {
      return reportFailure(res, 'List dispatch items error:', err, 'Failed to list dispatch items');
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
      return reportFailure(res, 'Count dispatch items error:', err, 'Failed to count dispatch items');
    }
  });

  /**
   * GET /workspace/:urlKey/api/dispatch/quota
   * The caller's own free-tier run usage (LIN-3238 Q6): `{ limited, runsUsed,
   * limit, remaining, resetsAt }`. Scoped to the session account's merge group
   * only — never another account's or instance-wide figures. `limited:false`
   * when the caller is not free tier (or has no attributable account).
   */
  router.get('/workspace/:urlKey/api/dispatch/quota', workspaceFromUrl, async (req, res) => {
    try {
      const accountId = req.session?.accountId;
      const { isFreeTier } = resolveChatCredential({ sessionApiKey: req.session?.openRouterApiKey });
      if (!isFreeTier || !accountId) {
        return res.json({ limited: false, runsUsed: null, limit: null, remaining: null, resetsAt: null });
      }
      const accountIds = await resolveAccountGroup(accountStore, accountId);
      const usage = await freeTierStore.getRunUsage(accountIds);
      return res.json({
        limited: true,
        runsUsed: usage.runsUsed,
        limit: usage.limit,
        remaining: usage.remaining,
        resetsAt: usage.resetsAt
      });
    } catch (err) {
      return reportFailure(res, 'Read dispatch quota error:', err, 'Failed to read dispatch quota');
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
      // LIN-3384: mask prose-mode bootstrap lines in non-owned prompts.
      res.json({ ...result, items: redactSessionItems(result.items, req.session?.accountId || null) });
    } catch (err) {
      return reportFailure(res, 'List dispatch history error:', err, 'Failed to list dispatch history');
    }
  });

  // =========================================================================
  // Recent Custom Prompts API (Session Auth)
  // =========================================================================

  /**
   * GET /workspace/:urlKey/api/dispatch/recent-prompts
   * Fetch recent custom prompts for the current user and workspace.
   */
  router.get('/workspace/:urlKey/api/dispatch/recent-prompts', workspaceFromUrl, async (req, res) => {
    const accountId = signedInAccount(req, res);
    if (!accountId) return;
    if (!userPreferencesStore) {
      return res.json({ prompts: [] });
    }

    try {
      const prefs = await userPreferencesStore.getUserPreferences(accountId);
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
    const accountId = signedInAccount(req, res);
    if (!accountId) return;
    if (!userPreferencesStore) {
      return jsonError(res, 503, 'Service unavailable');
    }

    const { prompt, error } = promptTextFailure(req.body.prompt);
    if (error) return badRequest.json(res, error);

    try {
      const prefs = await userPreferencesStore.getUserPreferences(accountId);
      const recentByWorkspace = prefs.recentCustomPrompts || {};
      const urlKey = req.workspace.urlKey;
      let list = recentByWorkspace[urlKey] || [];

      // Deduplicate: remove existing match, prepend new
      list = list.filter(p => p !== prompt);
      list.unshift(prompt);
      list = list.slice(0, MAX_RECENT_PROMPTS);

      await userPreferencesStore.saveUserPreferences(accountId, {
        ...prefs,
        recentCustomPrompts: {
          ...recentByWorkspace,
          [urlKey]: list
        }
      });

      res.json({ success: true });
    } catch (err) {
      return reportFailure(res, 'Failed to save recent prompt:', err, 'Failed to save recent prompt');
    }
  });

  // =========================================================================
  // Favourite Custom Prompts API (Session Auth) — LIN-1011
  //
  // A durable, user-curated list on top of the rolling recents window: a
  // starred prompt survives the recents cap instead of rolling off. Mirrors the
  // recents endpoints (session-auth, accountId gate, same validation) plus a
  // DELETE (un-star) — the one path recents has no equivalent of. The cap is
  // owned by the store (MAX_FAVORITE_PROMPTS); identity is the exact string, so
  // a favourite and its recent counterpart stay in sync by value.
  // =========================================================================

  /**
   * GET /workspace/:urlKey/api/dispatch/favorite-prompts
   * Fetch favourite custom prompts for the current user and workspace.
   */
  router.get('/workspace/:urlKey/api/dispatch/favorite-prompts', workspaceFromUrl, async (req, res) => {
    const accountId = signedInAccount(req, res);
    if (!accountId) return;
    if (!userPreferencesStore) {
      return res.json({ prompts: [] });
    }

    try {
      const prompts = await userPreferencesStore.getFavoritePrompts(accountId, req.workspace.urlKey);
      res.json({ prompts });
    } catch (err) {
      console.error('Failed to fetch favorite prompts:', err.message);
      res.json({ prompts: [] });
    }
  });

  /**
   * POST /workspace/:urlKey/api/dispatch/favorite-prompts
   * Add a custom prompt to the favourites list for the current user and workspace.
   * Validation is the recents POST's (promptTextFailure) so a favourite and its
   * recent counterpart accept/reject the same strings (and stay in sync by value).
   */
  router.post('/workspace/:urlKey/api/dispatch/favorite-prompts', workspaceFromUrl, async (req, res) => {
    const accountId = signedInAccount(req, res);
    if (!accountId) return;
    if (!userPreferencesStore) {
      return jsonError(res, 503, 'Service unavailable');
    }

    const { prompt, error } = promptTextFailure(req.body.prompt);
    if (error) return badRequest.json(res, error);

    try {
      const prompts = await userPreferencesStore.addFavoritePrompt(accountId, req.workspace.urlKey, prompt);
      res.json({ success: true, prompts });
    } catch (err) {
      return reportFailure(res, 'Failed to save favorite prompt:', err, 'Failed to save favorite prompt');
    }
  });

  /**
   * DELETE /workspace/:urlKey/api/dispatch/favorite-prompts
   * Remove (un-star) a custom prompt from the favourites list. Prompt comes in
   * the body `{ prompt }` (or `?prompt=`). Same auth gate as the add path. Unlike the
   * add path it checks only that a string came: it removes by exact value, so an
   * over-long or odd string simply matches nothing.
   */
  router.delete('/workspace/:urlKey/api/dispatch/favorite-prompts', workspaceFromUrl, async (req, res) => {
    const accountId = signedInAccount(req, res);
    if (!accountId) return;
    if (!userPreferencesStore) {
      return jsonError(res, 503, 'Service unavailable');
    }

    const rawPrompt = (req.body && req.body.prompt) ?? req.query.prompt;
    const prompt = typeof rawPrompt === 'string' ? rawPrompt.trim() : rawPrompt;
    if (!prompt || typeof prompt !== 'string') {
      return badRequest.json(res, 'prompt is required and must be a string');
    }

    try {
      const prompts = await userPreferencesStore.removeFavoritePrompt(accountId, req.workspace.urlKey, prompt);
      res.json({ success: true, prompts });
    } catch (err) {
      return reportFailure(res, 'Failed to remove favorite prompt:', err, 'Failed to remove favorite prompt');
    }
  });

  // =========================================================================
  // Workspace Halt API (Session Auth) — LIN-2994 Surface 4 / LIN-3026
  //
  // MUST be registered before `DELETE /workspace/:urlKey/api/dispatch/:itemId`
  // below — otherwise `DELETE .../dispatch/halt` falls into that UUID-gated
  // route and returns 400 "Invalid item ID format" instead of clearing the
  // halt, silently breaking Resume. See routes/task-chat.js:289-292 for the
  // same literal-before-`/:param` guard, and
  // tests/unit/task-chat-route.test.js:177-192 for the precedent witness
  // pattern this file's own DELETE-not-captured test follows.
  //
  // Setting a halt is a REQUEST the runner honours (lib/runner-kit/runner.mjs
  // haltAction: pause leaves fresh items, stop sweeps), so set/clear are
  // owner-only (LIN-3398). No per-write audit log is added here; the halt
  // document's own `setAt`/`setBy` is its audit trail.
  // =========================================================================

  /**
   * GET /workspace/:urlKey/api/dispatch/halt
   * Reuses `projectHaltForPoll` from lib/poll-halt.js (shared with the poll
   * handler) so there is exactly one `{mode,setAt,setBy}` projection, not a
   * second copy.
   */
  router.get('/workspace/:urlKey/api/dispatch/halt', workspaceFromUrl, async (req, res) => {
    if (!workspaceHaltStore) {
      return serviceUnavailable.json(res, 'Failed to read halt');
    }

    try {
      const doc = await workspaceHaltStore.getWorkspaceHalt(req.workspace.urlKey);
      res.json({ halt: projectHaltForPoll(doc) });
    } catch (err) {
      return reportFailure(res, 'Workspace halt read error:', err, 'Failed to read halt');
    }
  });

  /**
   * POST /workspace/:urlKey/api/dispatch/halt
   * Body `{ mode }` with `mode` one of `HALT_MODES`; anything else is a 400,
   * checked before any write. `setBy` is the session's own accountId (`null`
   * when absent), exactly as the tokens route attributes `createdBy` above.
   */
  router.post('/workspace/:urlKey/api/dispatch/halt', workspaceFromUrl, async (req, res) => {
    const { mode } = req.body || {};
    if (!HALT_MODES.includes(mode)) {
      return badRequest.json(res, HALT_MODE_ERROR);
    }

    if (await refuseNonOwner(req, res)) return;

    if (!workspaceHaltStore) {
      return serviceUnavailable.json(res, 'Failed to set halt');
    }

    const setBy = req.session?.accountId || null;
    const now = new Date();

    try {
      await workspaceHaltStore.setWorkspaceHalt(req.workspace.urlKey, { mode, setBy, now });
      res.json({ success: true, halt: { mode, setAt: now, setBy } });
    } catch (err) {
      return reportFailure(res, 'Workspace halt set error:', err, 'Failed to set halt');
    }
  });

  /**
   * DELETE /workspace/:urlKey/api/dispatch/halt
   * Resume: clears the stored halt request. Idempotent — harmless when
   * nothing is set (the store's own `deleteOne` semantics).
   */
  router.delete('/workspace/:urlKey/api/dispatch/halt', workspaceFromUrl, async (req, res) => {
    if (await refuseNonOwner(req, res)) return;

    if (!workspaceHaltStore) {
      return serviceUnavailable.json(res, 'Failed to clear halt');
    }

    try {
      await workspaceHaltStore.clearWorkspaceHalt(req.workspace.urlKey);
      res.json({ success: true });
    } catch (err) {
      return reportFailure(res, 'Workspace halt clear error:', err, 'Failed to clear halt');
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
      return badRequest.json(res, 'Invalid item ID format');
    }

    try {
      // LIN-3398: read the row (writes nothing) for its `target`, gate, then
      // write. An absent row is gated as `cli` and, for the owner, falls through
      // to the 404 below.
      const row = await dispatchQueueStore.getItemStatus(workspace.urlKey, itemId);
      if (await refuseNonOwner(req, res, row?.target)) return;

      const removed = await dispatchQueueStore.removeItem(workspace.urlKey, itemId);

      if (!removed) {
        return notFound.json(res, 'Item not found');
      }

      res.json({ success: true });
    } catch (err) {
      return reportFailure(res, 'Remove dispatch item error:', err, 'Failed to remove item');
    }
  });

  /**
   * PATCH /workspace/:urlKey/api/dispatch/:sessionId/trim
   * Graceful trim (LIN-2147): amend a live run's `maxTasks` bound DOWNWARD,
   * a first-class control rather than a free-text/followUpTo wake nudge.
   * The run's own existing LIN-1751 budget guard does the rest: its current
   * in-flight ticket keeps dispatching (review/close-out/corrective
   * follow-ups all read as `alreadyCounted`, so a trim never interrupts a
   * child beat already in progress), while the next genuinely NEW task hits
   * the same 409 BUDGET_EXHAUSTED refusal the orderly-finish path already
   * handles — no second wind-down verb, distinct from abort (which is a
   * hard stop mid-work).
   *
   * Idempotent (an absolute set, never a relative decrement) and auditable
   * (`by`/`at`/`maxTasks` appended to the run's own `trimHistory`, readable
   * via `getItemStatus`/`listHistory`).
   */
  router.patch('/workspace/:urlKey/api/dispatch/:sessionId/trim', workspaceFromUrl, async (req, res) => {
    const { workspace } = req;
    const { sessionId } = req.params;
    const { maxTasks } = req.body || {};

    if (!UUID_REGEX.test(sessionId)) {
      return badRequest.json(res, 'Invalid session ID format');
    }
    if (maxTasks === undefined) {
      return badRequest.json(res, 'maxTasks is required');
    }
    if (!isPositiveInteger(maxTasks)) {
      return badRequest.json(res, 'maxTasks must be a positive integer');
    }

    try {
      // LIN-3398: same read-then-gate-then-write shape as delete above.
      const row = await dispatchQueueStore.getItemStatus(workspace.urlKey, sessionId);
      if (await refuseNonOwner(req, res, row?.target)) return;

      const result = await dispatchQueueStore.trimSessionBudget(
        workspace.urlKey, sessionId, { maxTasks }, { by: req.session?.accountId || null }
      );

      if (result.ok) {
        return res.json({ success: true, item: redactSessionItem(result.item, req.session?.accountId || null) });
      }
      if (result.reason === 'not-found') {
        return notFound.json(res, 'Run not found');
      }
      // 'not-downward': trim is amend-downward only — a bound already at or
      // below the requested value is not a trim (see the constraint on
      // trimSessionBudget above). A caller wanting to widen a budget uses a
      // fresh kickoff, not this control.
      return jsonError(res, 409, 'Trim must reduce the run\'s task budget below its current value');
    } catch (err) {
      return reportFailure(res, 'Trim session budget error:', err, 'Failed to trim run');
    }
  });

  // =========================================================================
  // Token Management API (Session Auth)
  // =========================================================================

  /**
   * POST /workspace/:urlKey/api/dispatch/tokens
   * Create a new dispatch token for this workspace. Owner-only (LIN-3137 J5):
   * a non-owner member is refused 403 GRANT_OWNER_ONLY and nothing is minted.
   * Rate limited to 5 requests per 15 minutes per IP.
   */
  router.post('/workspace/:urlKey/api/dispatch/tokens', tokenCreationLimiter, workspaceFromUrl, async (req, res) => {
    const { workspace } = req;

    // LIN-3137 J5 — the owner-only mint gate. A legacy dispatch token is a take
    // path (any holder can run a runner), so only the workspace's owner may mint
    // one. Runs after auth (`workspaceFromUrl`), before label validation and
    // before `createToken` — a refused caller mints nothing. The seam is keyed
    // on the route workspace id + the session account, never the request body.
    // Fails closed on a missing accountId (pre-check, so it maps to
    // GRANT_OWNERLESS rather than the seam's not-owner), an unwired/absent seam,
    // a throwing seam, or any unexpected verdict.
    const ownerRefusal = await resolveOwnerMintRefusal({
      ownerCheck: workspaceOwnerCheck,
      workspaceId: workspace.id,
      accountId: req.session?.accountId,
      subject: 'a dispatch token'
    });
    if (ownerRefusal) {
      console.warn(
        `Dispatch token mint refused: ${ownerRefusal.code} (urlKey=${workspace.urlKey}) — LIN-3137`
      );
      return jsonError(res, ownerRefusal.status, ownerRefusal.error, {
        code: ownerRefusal.code,
        category: ownerRefusal.category,
        retryable: ownerRefusal.retryable
      });
    }

    try {
      const { label } = req.body || {};

      // Validate label length
      if (label && label.length > MAX_NAME_LENGTH) {
        return badRequest.json(res, `label exceeds maximum length of ${MAX_NAME_LENGTH}`);
      }

      const result = await dispatchTokenStore.createToken(workspace.urlKey, label || 'default', req.session?.accountId || null);

      res.status(201).json({
        tokenId: result.tokenId,
        token: result.token, // Plain text - only returned once!
        label: result.label,
        message: 'Token created. Save this token now - it cannot be retrieved later.'
      });
    } catch (err) {
      return reportFailure(res, 'Create token error:', err, 'Failed to create token');
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
      return reportFailure(res, 'List tokens error:', err, 'Failed to list tokens');
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
      return badRequest.json(res, 'Invalid token ID format');
    }

    if (await refuseNonOwner(req, res)) return;

    try {
      const revoked = await dispatchTokenStore.revokeToken(workspace.urlKey, tokenId);

      if (!revoked) {
        return notFound.json(res, 'Token not found');
      }

      res.json({ success: true });
    } catch (err) {
      return reportFailure(res, 'Revoke token error:', err, 'Failed to revoke token');
    }
  });

  // =========================================================================
  // Dispatch Presets CRUD API (Session Auth) — LIN-1391 S7, byKind authoring LIN-1400
  //
  // Named, workspace-scoped, reusable dispatch routing configs
  // (dispatchPresetsStore, LIN-1390). Follows the routes/collective.js
  // preset-CRUD convention (POST create / DELETE) plus an update route,
  // rather than the single-form dispatch-defaults POST above — a preset list
  // grows/shrinks, so it doesn't fit one fixed-shape form. Config authoring
  // covers both the top-level model/harness AND per-kind (`byKind`)
  // overrides (LIN-1400) — an update replaces `byKind` when the body
  // includes it (even `{}`, which clears it) and preserves the existing
  // `byKind` verbatim only when the body omits the field entirely, so an API
  // caller that never mentions `byKind` keeps today's preserve behavior.
  // =========================================================================

  /**
   * GET /workspace/:urlKey/api/dispatch/presets
   * List saved dispatch presets for this workspace.
   */
  router.get('/workspace/:urlKey/api/dispatch/presets', workspaceFromUrl, async (req, res) => {
    if (!dispatchPresetsStore) return res.json({ presets: [] });
    try {
      const presets = await dispatchPresetsStore.list(req.workspace.urlKey);
      res.json({ presets });
    } catch (err) {
      return reportFailure(res, 'List dispatch presets error:', err, 'Failed to list dispatch presets');
    }
  });

  /**
   * POST /workspace/:urlKey/api/dispatch/presets
   * Create a new dispatch preset. Body: { name, model?, harness?, effort?, byKind? }.
   */
  router.post('/workspace/:urlKey/api/dispatch/presets', workspaceFromUrl, async (req, res) => {
    if (!dispatchPresetsStore) return jsonError(res, 503, 'Preset storage is not configured');

    const { name, model, harness, effort, byKind } = req.body || {};
    const checked = presetBodyCheck({ model, harness, effort, byKind });
    if (checked.error) return badRequest.json(res, checked.error);

    try {
      const preset = await dispatchPresetsStore.createCustom(req.workspace.urlKey, {
        name,
        config: buildDispatchPresetConfig({ model, harness, effort, byKind: checked.byKind })
      });
      res.status(201).json({ success: true, preset });
    } catch (error) {
      console.error('Create dispatch preset error:', error.message);
      jsonError(res, dispatchPresetErrorStatus(error.message), error.message || 'Failed to create preset');
    }
  });

  /**
   * PATCH /workspace/:urlKey/api/dispatch/presets/:presetId
   * Update an existing dispatch preset in place. Body: { name?, model?, harness?, effort?, byKind? }.
   * `byKind` present in the body (even `{}`) replaces/clears the stored value;
   * `byKind` absent from the body preserves the existing stored value (LIN-1400).
   */
  router.patch('/workspace/:urlKey/api/dispatch/presets/:presetId', workspaceFromUrl, async (req, res) => {
    if (!dispatchPresetsStore) return jsonError(res, 503, 'Preset storage is not configured');

    const { name, model, harness, effort, byKind } = req.body || {};
    const checked = presetBodyCheck({ model, harness, effort, byKind });
    if (checked.error) return badRequest.json(res, checked.error);

    try {
      const existing = await dispatchPresetsStore.get(req.workspace.urlKey, req.params.presetId);
      if (!existing) return notFound.json(res, 'Preset not found');

      const effectiveByKind = byKind !== undefined ? checked.byKind : existing.config?.byKind;
      const config = buildDispatchPresetConfig({ model, harness, effort, byKind: effectiveByKind });
      const preset = await dispatchPresetsStore.update(req.workspace.urlKey, req.params.presetId, {
        name: name !== undefined ? name : existing.name,
        config
      });
      if (!preset) return notFound.json(res, 'Preset not found');
      res.json({ success: true, preset });
    } catch (error) {
      console.error('Update dispatch preset error:', error.message);
      jsonError(res, dispatchPresetErrorStatus(error.message), error.message || 'Failed to update preset');
    }
  });

  /**
   * DELETE /workspace/:urlKey/api/dispatch/presets/:presetId
   * Delete a saved dispatch preset.
   */
  router.delete('/workspace/:urlKey/api/dispatch/presets/:presetId', workspaceFromUrl, async (req, res) => {
    if (!dispatchPresetsStore) return jsonError(res, 503, 'Preset storage is not configured');
    try {
      const deleted = await dispatchPresetsStore.delete(req.workspace.urlKey, req.params.presetId);
      if (!deleted) return notFound.json(res, 'Preset not found');
      res.json({ success: true });
    } catch (error) {
      return reportFailure(res, 'Delete dispatch preset error:', error, 'Failed to delete preset');
    }
  });

  // =========================================================================
  // Consumer API (Token Auth)
  // =========================================================================

  /**
   * GET /api/dispatch/poll
   * Poll for available items in the queue.
   * Requires token authentication.
   *
   * LIN-3024 (LIN-2994 Surface 2): additively also reads the operator halt
   * flag for this urlKey through `workspaceHaltStore`, in parallel with the
   * item read above. That halt read alone is bounded by `haltReadTimeoutMs`;
   * `pollAvailable` is never timed out here and its rejection keeps today's
   * 500 behavior unchanged. A halt-read timeout or failure degrades to the
   * store's last-known cached value (warmed by both this read and any
   * successful halt write, lib/workspace-halt.js), or omits the key entirely
   * on a cold cache — it must never turn into a non-2xx response. When there
   * is nothing to add the body stays exactly `{ items }` (no `halt: null`).
   */
  router.get('/api/dispatch/poll', authenticateDispatchToken, async (req, res) => {
    try {
      const itemsPromise = dispatchQueueStore.pollAvailable(req.dispatchUrlKey);
      // Mark this promise as handled right away so a pollAvailable rejection
      // arriving while the (independently bounded) halt read below is still
      // in flight never surfaces as an unhandledRejection. The no-op catch
      // does not swallow the failure: `await itemsPromise` further down
      // still throws with the original error, since it's a second, separate
      // reaction on the same promise.
      itemsPromise.catch(() => {});
      const halt = await readHaltForPoll(workspaceHaltStore, req.dispatchUrlKey, haltReadTimeoutMs);
      const items = await itemsPromise;
      res.json({ items, ...(halt ? { halt } : {}) });
    } catch (err) {
      return reportFailure(res, 'Poll error:', err, 'Failed to poll dispatch queue');
    }
  });

  /**
   * POST /api/dispatch/broker-token
   * Mint a fresh single-use bootstrap token for the caller's own workspace
   * (LIN-1397). Consumed by Simple Dispatcher's stall-failsafe reaper to
   * re-arm a broker-armed session's local credential broker at refire time,
   * when it has no fresh `item.bootstrapToken` to reuse (a failsafe refire is
   * reaper-initiated, not a follow-up dispatch).
   *
   * Mirrors attachProxyContext's mint args (kind/scope/ttl) for parity with
   * the existing dispatch-bootstrap mint. `createdBy` is stamped from the
   * calling dispatch token's own owner (req.dispatchTokenOwner, set by
   * authenticateDispatchToken) — never fabricated — so the exchanged working
   * token resolves under LIN-1366's owner-scoped selection.
   *
   * OWNERLESS COMPAT LANE (LIN-1447), now switchable (LIN-1448): a dispatch
   * token with no owner (minted before LIN-1397, or never re-minted) used to
   * fail closed here with a 503. But the host runner authenticates with
   * exactly such an ownerless legacy token, so that 503 dead-ended LIN-1446's
   * fresh-launch fallback mint and left every fresh worker's local write-back
   * proxy (HARBOUR_LOCAL_BASE) uncomposed. Mint proceeds for the ownerless
   * case the same way it does for an owner-stamped token (createdBy: null,
   * same as createToken already accepts) instead of rejecting it — owner-
   * stamped tokens are completely unaffected either way.
   *
   * LIN-1448 — WHY THIS IS A SWITCH AND NOT A DELETION. The lane's stated exit
   * condition ("remove once no ownerless tokens remain in use / after it has
   * been cold for a safe window") is unsatisfiable: this endpoint is the ONLY
   * minter of the `refire-broker` label, so the lane can never go cold on its
   * own. It is also the confirmed root cause of a ~100-minute halt of four
   * autopilot trees on 2026-07-25 (LIN-1576) — every token it mints is
   * createdBy:null, which selectOwnerWorkspaceToken fails closed on, so the
   * token is dead on arrival for every workspace-scoped verb. That is exactly
   * the reasoning the wake path below already acts on at the `no-token-owner`
   * degrade, and this endpoint contradicted it.
   *
   * Removal alone is NOT the fix, though: the reason the lane exists is that the
   * host runner's own consumer token is ownerless, so deleting it unconditionally
   * would trade a silent failure for a loud one on the very next deploy. The fix
   * is two-part and ordered — (1) re-issue the runner's dispatch token as OWNED
   * (an on-host operator action: create a new token while signed in AS THE
   * WORKSPACE OWNER — the mint is owner-only as of LIN-3137 — which stamps
   * req.session.accountId, and point the runner at it; `GET .../api/dispatch/tokens`
   * now reports `hasOwner` so "are any ownerless tokens still live?" is answerable),
   * then (2) set DISPATCH_OWNERLESS_BROKER_COMPAT=off to restore strict minting.
   * Default stays compat-ON precisely so part 2 cannot take effect before part 1.
   *
   * LIN-3135 (R2) — DECLARED REFIRE. An optional JSON body `{ itemId }` names the
   * refired row. With a declaration record on that row, and only when the caller
   * is the recorded owner's own token (B1) AND the taker of the live, non-terminal
   * row (B2), the bootstrap is re-minted through provisionResumeCredential from
   * the RECORDED owner/workspace/grants, and the response is `{ token }` (no
   * `expiresAt`). A bound failure is a coded 403 REFIRE_CALLER_NOT_PERMITTED; a
   * lookup fault is a 503; structural grant refusals are relayed — never a plain
   * mint. No `itemId`, or a row with no record, keeps the grant-less mint below.
   * The ownerless lanes above still run first.
   */
  router.post('/api/dispatch/broker-token', authenticateDispatchToken, async (req, res) => {
    if (req.dispatchTokenOwner === null) {
      if (!ownerlessCompatEnabled()) {
        // Strict lane (LIN-1448): refuse BEFORE minting. A minted ownerless token
        // is dead on arrival at every workspace-scoped verb, so handing one back
        // only disguises the miss — the same policy the wake path applies below.
        console.warn(
          `Broker-token mint refused: dispatch token has no owner ` +
          `(urlKey=${req.dispatchUrlKey} label=${req.dispatchTokenLabel}) — ` +
          `DISPATCH_OWNERLESS_BROKER_COMPAT is off (LIN-1448)`
        );
        return serviceUnavailable.json(
          res,
          'Dispatch token has no owner (LIN-1448)',
          'A bootstrap minted for an ownerless dispatch token cannot resolve a workspace ' +
          'credential, so it is refused rather than handed over dead. The workspace itself ' +
          'is unaffected — re-issue this dispatch token from an account that has the ' +
          'workspace connected, then point the runner at the new token.'
        );
      }
      console.warn(
        `Broker-token mint: ownerless legacy compat lane (LIN-1447) hit for ` +
        `urlKey=${req.dispatchUrlKey} label=${req.dispatchTokenLabel}`
      );
    }

    if (!proxyTokenStore) {
      return serviceUnavailable.json(res, 'Broker token minting is not configured');
    }

    // LIN-3135 (R2): an optional JSON `itemId` names the refired row. Absent →
    // today's inline mint below, untouched, with no store read. Present → look
    // the declaration up first, then branch: a record re-mints declared from the
    // RECORDED authority behind the caller bound, never falling back to plain;
    // `none` / `row-missing` fall through to today's grant-less mint.
    const itemId = req.body?.itemId;
    if (itemId !== undefined) {
      // Present but malformed fails closed rather than falling back.
      if (typeof itemId !== 'string' || !UUID_REGEX.test(itemId)) {
        return badRequest.json(res, 'Invalid item ID format');
      }

      let lookup;
      try {
        // urlKey from the dispatch token, never the body.
        lookup = await dispatchQueueStore.getGrantDeclaration(req.dispatchUrlKey, itemId);
      } catch {
        // The store already logged the fault (ids only). Never a fallback mint.
        return serviceUnavailable.json(res, 'Could not read the item\'s grant declaration; retry');
      }

      if (lookup?.state === 'record') {
        // One generic body for every reason, so the response never says which
        // condition failed; the reason goes to the server log only.
        const refuse = (reason) => {
          console.warn('[dispatch] broker-declared-remint-refused', { urlKey: req.dispatchUrlKey, itemId, reason });
          return jsonError(res, 403, 'Caller may not re-mint the declared credential for this item', {
            code: 'REFIRE_CALLER_NOT_PERMITTED',
            retryable: false
          });
        };

        // B1 (authority): the caller's dispatch token was created by the
        // RECORDED owner's own session. It gates only — the mint owner stays the
        // recorded one. An ownerless record has no owner to compare, so B1 is
        // skipped and the helper refuses it GRANT_OWNERLESS below (B2 still
        // applies first).
        const recordedOwner = lookup.record?.ownerAccountId;
        if (typeof recordedOwner === 'string' && recordedOwner.trim() !== ''
          && req.dispatchTokenOwner !== recordedOwner) {
          return refuse('owner-mismatch');
        }

        // B2 (session binding): this caller took the row and it is still live on
        // its own feedback — the addFeedback ownership precedent, as a read.
        // getItemStatus swallows read faults into null, so a fault refuses here.
        let row = null;
        try {
          row = await dispatchQueueStore.getItemStatus(req.dispatchUrlKey, itemId);
        } catch {
          row = null;
        }
        if (!row) return refuse('status-unreadable');
        if (row.status === 'expired' || row.status === 'cancelled') return refuse('terminal');
        if (row.status !== 'taken' || !req.dispatchTokenLabel || row.takenByTokenLabel !== req.dispatchTokenLabel) {
          return refuse('not-taker');
        }
        // LIN-3364: deliberately `deriveTerminalStatus`, not `deriveWireTerminal` — a closed stamp is a liveness fact for readers, not a revocation; a still-alive runner keeps its re-mint.
        if (deriveTerminalStatus(row.feedback) !== null) return refuse('terminal');

        // Both hold: re-mint through the T2 helper, which re-reads the record
        // itself (the sibling follow-up arms' form, so no route ever holds the
        // record) and mints from the RECORDED owner/workspace/grants. `createdBy`
        // is ignored on that declared branch; it is passed only for the window
        // where the row vanished between the two reads, where the helper's plain
        // path then mints exactly today's grant-less bootstrap for this caller —
        // never an ownerless one, and never claiming to be declared.
        const baseUrl = `${req.protocol}://${req.get('host')}`;
        let resumed;
        try {
          resumed = await provisionResumeCredential({
            proxyTokenStore,
            dispatchStore: dispatchQueueStore,
            urlKey: req.dispatchUrlKey,
            baseUrl,
            label: 'refire-broker',
            harness: 'claude-code',
            followUpTo: itemId,
            createdBy: req.dispatchTokenOwner,
            prompt: null
          });
        } catch (err) {
          if (isStructuralGrantRefusal(err)) {
            return jsonError(res, err.status, err.message, { code: err.code, retryable: false });
          }
          console.error('Broker-token declared re-mint failed:', err?.code || err?.message);
          if (err?.code === 'OWNER_CHECK_UNAVAILABLE' || err?.proxyAttachFailed) {
            return serviceUnavailable.json(res, 'Could not re-mint the declared broker token; retry');
          }
          return serviceUnavailable.json(res, 'Could not mint a broker bootstrap token');
        }

        if (!resumed?.bootstrapToken) {
          return serviceUnavailable.json(res, 'Could not mint a broker bootstrap token');
        }

        // `expiresAt` is omitted on this branch: the helper does not return it
        // and a derived value would be a second source of truth.
        return res.status(201).json({ token: resumed.bootstrapToken });
      }
    }

    let minted;
    try {
      minted = await proxyTokenStore.createToken(req.dispatchUrlKey, {
        kind: 'bootstrap',
        scope: READ_WRITE,
        label: 'refire-broker',
        ttl: BOOTSTRAP_TOKEN_TTL_SECONDS,
        createdBy: req.dispatchTokenOwner
      });
    } catch (err) {
      console.error('Broker-token mint failed:', err.message);
      return serviceUnavailable.json(res, 'Could not mint a broker bootstrap token');
    }

    if (!minted?.token) {
      return serviceUnavailable.json(res, 'Could not mint a broker bootstrap token');
    }

    res.status(201).json({ token: minted.token, expiresAt: minted.expiresAt });
  });

  /**
   * POST /api/dispatch/take/:itemId
   * Atomically claim and remove an item from the queue.
   * Requires token authentication.
   */
  /**
   * POST /api/dispatch/heartbeat (LIN-1952)
   * Consumer heartbeat from a dispatch consumer (simple-dispatcher). Shares its
   * handler with POST /api/proxy/runner/heartbeat. Writes only to the
   * `consumer-heartbeats` store, never to runner or session state.
   */
  router.post('/api/dispatch/heartbeat', heartbeatLimiter, authenticateDispatchToken, createHeartbeatIngest({
    store: consumerHeartbeatStore,
    endpoint: '/api/dispatch/heartbeat',
    identify: (req) => ({ urlKey: req.dispatchUrlKey, tokenId: req.dispatchTokenId ?? null })
  }));

  router.post('/api/dispatch/take/:itemId', authenticateDispatchToken, async (req, res) => {
    const { itemId } = req.params;

    // Validate itemId format
    if (!UUID_REGEX.test(itemId)) {
      return badRequest.json(res, 'Invalid item ID format');
    }

    try {
      // Take with urlKey verification (consumer can only take from their workspace)
      const item = await dispatchQueueStore.takeItem(itemId, req.dispatchUrlKey, req.dispatchTokenLabel);

      if (!item) {
        return notFound.json(res, 'Item not found or already taken');
      }

      // Echo `dispatchId` as a top-level alias of `item.id` so consumers see it
      // without having to dig into the item shape. Forward this value as
      // `dispatchId` when posting to /api/proxy/agent/status to enable exact
      // loop-reconstruction joins (see LIN-245). Purely additive — existing
      // consumers that destructure `{ item }` are unaffected.
      res.json({ item, dispatchId: item.id });
    } catch (err) {
      return reportFailure(res, 'Take error:', err, 'Failed to take item');
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
      return badRequest.json(res, 'Invalid item ID format');
    }

    // Wake-path credential provisioning policy (LIN-1430 / S2), extracted to
    // lib/wake-credential.js for LIN-3130 S2a so the runner feedback route
    // reuses it rather than forking. The store calls the returned callback
    // between building the wake descriptor and the LIN-1357 CAS/witness update.
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const createdBy = req.dispatchTokenOwner ?? null;
    const provisionWakeCredential = buildWakeCredentialProvisioner({
      proxyTokenStore,
      urlKey: req.dispatchUrlKey,
      baseUrl,
      createdBy
    });

    // Shared, extracted validator (lib/dispatch-feedback-validation.js) — the
    // runner feedback route reuses these exact rules rather than forking them
    // (LIN-3035/LIN-3130). Validation order and error contracts are unchanged.
    const validation = validateFeedbackBody(req.body);
    if (validation.error) {
      return badRequest.json(res, validation.error);
    }
    const {
      message,
      url,
      urlLabel,
      kind: sanitizedKind,
      rootItemId: sanitizedRootItemId
    } = validation.value;

    try {
      const result = await dispatchQueueStore.addFeedback(
        itemId,
        req.dispatchUrlKey,
        { message, url: url || null, urlLabel: urlLabel || null, kind: sanitizedKind, rootItemId: sanitizedRootItemId },
        req.dispatchTokenLabel,
        provisionWakeCredential
      );

      if (!result) {
        return notFound.json(res, 'Item not found or feedback not allowed');
      }

      // Only the decision-withdrawn write needs a hard invalidation (Surface 3);
      // ordinary feedback writes rely on the cache's 5s TTL, so clearing here on
      // every kind would defeat the stale-while-revalidate path for any workspace
      // with active runner traffic (review R1).
      if (sanitizedKind === 'decision-withdrawn') {
        sessionsFeedCache?.clear(req.dispatchUrlKey);
      }

      res.json(result);
    } catch (err) {
      return reportFailure(res, 'Feedback error:', err, 'Failed to post feedback');
    }
  });

  return router;
}
