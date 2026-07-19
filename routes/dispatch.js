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
 *    - Dispatch presets CRUD (LIN-1391): GET/POST /workspace/:urlKey/api/dispatch/presets,
 *      PATCH/DELETE /workspace/:urlKey/api/dispatch/presets/:presetId
 *
 * 2. Consumer API (token auth):
 *    - GET /api/dispatch/poll - Poll for available items
 *    - POST /api/dispatch/take/:itemId - Atomically claim item
 */

import { Router } from 'express';
import { badRequest, jsonError, notFound, unauthorized, serviceUnavailable, workspaceUnavailableEnvelope } from '../lib/errors.js';
import rateLimit from 'express-rate-limit';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawnClaudeSession } from '../lib/harbour-spawn.js';
import { isValidDispatchKind, DISPATCH_KINDS, DISPATCH_DEFAULT_KINDS } from '../lib/prompt-templates.js';
import { FEEDBACK_ENTRY_KINDS } from '../lib/dispatch-store.js';
import { isValidSubscription, DEFAULT_SUBSCRIPTION, SUBSCRIPTION_LEVELS } from '../lib/dispatch-wake.js';
import { validateDispatchPayload, validateOpaqueDispatchField } from '../lib/dispatch-validation.js';
import { createDispatchItem } from '../lib/dispatch-factory.js';
import { attachProxyContext, provisionBootstrapToken, shouldUseMcpTokenField } from '../lib/proxy-preamble.js';
import { BOOTSTRAP_TOKEN_TTL_SECONDS } from '../lib/proxy-tokens.js';

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

// Input length limits to prevent MongoDB errors (16MB document limit). The
// prompt/identifier caps for the POST /dispatch payload now live in
// lib/dispatch-validation.js (shared with the proxy twin, LIN-1139); these
// remain for the other endpoints in this router (token label, feedback message).
const MAX_NAME_LENGTH = 1000;          // Names/labels/titles
const MAX_URL_LENGTH = 8000;           // URLs (covers long query strings)
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
 * @returns {Router} Express router with dispatch routes
 */
export function createDispatchRoutes({ dispatchQueueStore, dispatchTokenStore, workspaceFromUrl, userPreferencesStore, harbourFeedbackTokenStore, workspacePreferencesStore, dispatchPresetsStore, proxyTokenStore }) {
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
      const { prompt, promptName, kind, issueId, issueIdentifier, issueTitle, issueUrl, target, repo, model, harness, followUpTo, force, abort, abortTo, cascade, sessionId, waitForFollowUps, queueIfBusy, subscription, attachProxy, presetId } = req.body;

      // Abort verb (LIN-743): an abort item asks the consumer to cancel/close an
      // existing session (named by abortTo) instead of running a prompt, so it
      // carries no prompt and skips the prompt-required check below. abort and
      // followUpTo are mutually-exclusive verbs.
      const isAbort = abort === true;
      if (isAbort && followUpTo !== undefined && followUpTo !== null) {
        return badRequest.json(res, 'abort and followUpTo are mutually exclusive');
      }

      // Validate required fields. prompt is required for a normal dispatch; an
      // abort carries none.
      if (!isAbort && (!prompt || typeof prompt !== 'string')) {
        return badRequest.json(res, 'prompt is required and must be a string');
      }

      // Validate target if provided
      const VALID_TARGETS = ['cli', 'web', 'dash', 'local'];
      if (target !== undefined && !VALID_TARGETS.includes(target)) {
        return badRequest.json(res, `target must be one of: ${VALID_TARGETS.join(', ')}`);
      }

      // Abort eligibility (LIN-743): the abort item's OWN target must be
      // poll-eligible (cli/web/dash) — eligibility is NOT derived from the aborted
      // session's substrate. 'local' (Harbour OS) spawns server-side and is never
      // polled, so it cannot carry an abort. Default 'cli'.
      if (isAbort) {
        if (!abortTo || !UUID_REGEX.test(abortTo)) {
          return badRequest.json(res, 'abortTo is required and must be a UUID when abort is true');
        }
        const abortTarget = target || 'cli';
        if (!['cli', 'web', 'dash'].includes(abortTarget)) {
          return badRequest.json(res, 'abort target must be poll-eligible (cli, web, or dash)');
        }
      } else if (abortTo !== undefined && abortTo !== null) {
        return badRequest.json(res, 'abortTo requires abort to be true');
      }

      // Cascade close (LIN-946): a boolean modifier on an abort. When true the
      // abort's `abortTo` names the ROOT session of a subtree; Harbour expands the
      // one call into an abort per discovered descendant session (the recursive
      // sessionId-tree walk lands in a later beat). Like abortTo it is only
      // meaningful alongside abort — reject cascade:true without it rather than
      // storing an inert flag (mirroring the abortTo-requires-abort guard above).
      // Stored + forwarded blindly for now; the walk consumes it, not the runner.
      if (cascade !== undefined && typeof cascade !== 'boolean') {
        return badRequest.json(res, 'cascade must be a boolean');
      }
      if (cascade === true && !isAbort) {
        return badRequest.json(res, 'cascade requires abort to be true');
      }

      // Validate kind if provided; when omitted it is derived from promptName below.
      if (kind !== undefined && !isValidDispatchKind(kind)) {
        return badRequest.json(res, `kind must be one of: ${DISPATCH_KINDS.join(', ')}`);
      }

      // Opt-in completion hold (LIN-797): boolean, default false. Stored +
      // forwarded blindly — the runner owns the behaviour (see LIN-795).
      if (waitForFollowUps !== undefined && typeof waitForFollowUps !== 'boolean') {
        return badRequest.json(res, 'waitForFollowUps must be a boolean');
      }

      // Push-based inter-session comms. Both are stored + forwarded blindly,
      // exactly like waitForFollowUps/force — Harbour owns no semantics beyond wake:
      //   queueIfBusy  — the runner leaves a busy-target follow-up unclaimed
      //                  rather than failing it (LIN-827 runner path).
      //   subscription — edge declaration (LIN-900 §6): enum 'everything'|
      //                  'terminal-only' governing which of this child's events wake
      //                  the dispatching parent (§5 matrix). Declared, never inferred.
      if (queueIfBusy !== undefined && typeof queueIfBusy !== 'boolean') {
        return badRequest.json(res, 'queueIfBusy must be a boolean');
      }
      if (subscription !== undefined && !isValidSubscription(subscription)) {
        return badRequest.json(res, `subscription must be one of: ${SUBSCRIPTION_LEVELS.join(', ')}`);
      }

      // Selected dispatch preset (LIN-1390): an unknown/invalid id is rejected
      // here, up front — the factory treats a presetId it can't resolve as "no
      // preset" (a defensive fallback for this seam's own store lookup below),
      // not a validation gate, so this is the one place that contract is enforced.
      if (presetId !== undefined && presetId !== null) {
        if (typeof presetId !== 'string' || !presetId.trim()) {
          return badRequest.json(res, 'presetId must be a non-empty string');
        }
        if (dispatchPresetsStore) {
          const preset = await dispatchPresetsStore.get(workspace.urlKey, presetId);
          if (!preset) {
            return badRequest.json(res, 'Invalid or unknown presetId');
          }
        }
      }

      // Server-side proxy-context attach (LIN-1162). The dispatch UI used to mint a
      // bootstrap token and append the "+proxy" access block IN THE BROWSER, then POST
      // the finished prompt here — so this route never reached attachProxyContext and
      // a claude-code dispatch could never take the MCP `bootstrapToken` field path.
      // The client now sends `attachProxy:true` (a boolean intent, derived from its
      // +proxy toggle / force) and lets the server attach the block, exactly like the
      // proxy dispatch seams. Only meaningful for a real prompt — an abort carries none.
      if (attachProxy !== undefined && typeof attachProxy !== 'boolean') {
        return badRequest.json(res, 'attachProxy must be a boolean');
      }
      const wantProxyContext = attachProxy === true && !isAbort;

      // Follow-up credential provisioning (LIN-1431 S3 #1). The human reply box
      // (public/session.js) posts only { prompt, followUpTo, target, force } — it
      // never sets `attachProxy`, so `wantProxyContext` is false and, pre-LIN-1431,
      // NO finalizePrompt was passed at all: the follow-up was enqueued with
      // `bootstrapToken: null` and resumed a session whose local broker had died
      // with its window (LIN-1362/1375), leaving it unable to write back.
      //
      // The fix is a SERVER-SIDE default, deliberately not a new client flag: the
      // reply-box client stays dumb by design (LIN-1252/1298/1309). It only arms
      // the callback; whether a credential is actually minted is decided INSIDE it,
      // on the RESOLVED harness (see below) — so this can never upgrade a blank
      // harness, and `applyDefaultHarness:false` below is untouched (7926ee8).
      const wantFollowUpProvisioning = !wantProxyContext && !isAbort && !!followUpTo && !!prompt;

      // Reject local target from non-localhost requests
      if (target === 'local') {
        const host = (req.get('host') || '').split(':')[0];
        if (!['localhost', '127.0.0.1'].includes(host)) {
          return badRequest.json(res, 'local target is only available on localhost');
        }
      }

      // Shared payload validation for the two main handlers (LIN-1139): length
      // caps, opaque model/harness (LIN-438/1084), dangerous-char rejection, and
      // the issueId/followUpTo/force/sessionId format + combination rules. This
      // block ran verbatim here and in the proxy twin; it now lives once in
      // validateDispatchPayload so the two caller-supplied paths cannot drift.
      // dispatch.js owns its own reject response (no logEvent); the helper only
      // returns the error structure. The caller-specific checks that DIFFER
      // between the two handlers (prompt-required, target vocab, abort/cascade/
      // kind/waitForFollowUps/queueIfBusy/subscription, local-target) already ran
      // above, preserving the original interleaving.
      const payloadError = validateDispatchPayload(req.body);
      if (payloadError) {
        return badRequest.json(res, payloadError.error);
      }

      // Cascade close (LIN-946): a cascade request is not a single abort — it is a
      // command Harbour expands into one plain abort per session in abortTo's whole
      // descendant subtree (the recursive sessionId-tree walk). The store owns the
      // walk + emission; the runner still executes each cancel and skips
      // human-continued sessions (LIN-951). INERT: nothing issues a cascade at
      // end-of-run yet — this is the mechanism the future guide-trigger will call.
      if (cascade === true) {
        const result = await dispatchQueueStore.expandCascadeAborts(workspace.urlKey, abortTo, {
          target: target || 'cli',
          dispatchedBy: req.session?.accountId || null
        });
        return res.status(201).json({ success: true, cascade: true, ...result });
      }

      // Create the dispatch item through the shared factory (LIN-1139): it
      // resolves kind, fills blank model/harness from workspace dispatchDefaults
      // (LIN-1094), and calls addItem.
      //
      // applyDefaultHarness:false — the session route deliberately does NOT
      // interpose the claude-code default (LIN-1159 scoped that to the proxy
      // dispatch boundary). The dispatch-page UI owns the harness default (its
      // selector is pre-selected to claude-code, LIN-1111) AND offers an explicit
      // "blank" option whose contract is "send null" (dispatch-page.spec.js's
      // LIN-1111 escape-hatch test). A server-side interpose here would silently
      // override that blank choice, so the null passthrough is load-bearing.
      //
      // Proxy context (LIN-1162): when the client asks (`attachProxy:true`), attach
      // the workspace-API block through the SAME finalizePrompt→attachProxyContext
      // seam the proxy dispatch routes use, so the harness gates the MCP-token-field
      // vs prose branch (LIN-1155) — a claude-code dispatch stores `bootstrapToken`
      // and its prompt carries no token/curl. The client no longer appends the block
      // itself, so the two token-delivery mechanisms don't double-append. When the
      // client does NOT ask, we pass the plain prompt and no finalizePrompt, byte-for-
      // byte the pre-LIN-1162 path (and the copy/download flows still append client-side).
      const baseUrl = `${req.protocol}://${req.get('host')}`;
      const item = await createDispatchItem({
        store: dispatchQueueStore,
        urlKey: workspace.urlKey,
        workspacePreferencesStore,
        dispatchPresetsStore,
        presetId: presetId || null,
        applyDefaultHarness: false,
        kind,
        model,
        harness,
        ...(wantProxyContext
          ? {
              finalizePrompt: async (resolvedHarness) => {
                const attached = await attachProxyContext({
                  proxyTokenStore,
                  urlKey: workspace.urlKey,
                  baseUrl,
                  issueIdentifier: issueIdentifier || null,
                  prompt,
                  label: 'dispatch-bootstrap',
                  harness: resolvedHarness,
                  // LIN-1376: stamp the launching account so the dispatched
                  // session's token resolves under LIN-1366 owner-scoping.
                  createdBy: req.session?.accountId || null
                });
                // "Surface, don't silently drop" (LIN-525): the client dropped its
                // own mint+append and trusted the server to attach the block. If the
                // block did not get appended (mint failed / rate-limited, or no store/
                // baseUrl), attachProxyContext returns the prompt UNCHANGED — enqueuing
                // that would ship a bare prompt while the UI still shows +proxy active.
                // Signal it instead of degrading silently (the buildProxyContextPreamble
                // block always changes the prompt on success, prose or MCP).
                if (attached.prompt === prompt) {
                  const err = new Error('proxy context requested but could not be attached');
                  err.proxyAttachFailed = true;
                  throw err;
                }
                return attached;
              }
            }
          : wantFollowUpProvisioning
            ? {
                // LIN-1431 S3 #1: provision WITHOUT appending prose — S1's shape at
                // routes/proxy.js's dispatch seam. The `shouldUseMcpTokenField` guard
                // is load-bearing, not decorative: provisionBootstrapToken returns the
                // minted token for prose harnesses too, and a prose-path token has no
                // channel to reach the worker (the prompt is untouched here), so
                // minting one would put an unreferenceable credential on the item.
                //
                // Keying on the RESOLVED harness is what preserves LIN-1111: a blank
                // harness resolves to null here (applyDefaultHarness:false, and
                // beat 1's anchor inheritance yields null for a blank anchor), and
                // shouldUseMcpTokenField(null) is false — so a blank-harness reply
                // takes the null branch below, exactly as before this change.
                //
                // Fail-closed comes for free and matches LIN-1162/LIN-525: in MCP mode
                // provisionBootstrapToken THROWS with err.proxyAttachFailed on any
                // inability to mint, createDispatchItem propagates it before addItem,
                // and this route's catch already maps that flag to a transient 503.
                // The server attaches or throws — it never silently drops.
                finalizePrompt: async (resolvedHarness) => {
                  if (shouldUseMcpTokenField(resolvedHarness)) {
                    const bootstrapToken = await provisionBootstrapToken({
                      proxyTokenStore,
                      urlKey: workspace.urlKey,
                      baseUrl,
                      label: 'dispatch-bootstrap',
                      harness: resolvedHarness,
                      // LIN-1376: stamp the launching account, same as the
                      // attachProxyContext branch above.
                      createdBy: req.session?.accountId || null
                    });
                    return { prompt, bootstrapToken };
                  }
                  return { prompt, bootstrapToken: null };
                }
              }
            : { prompt }),
        fields: {
          promptName: promptName || 'Prompt',
          issueId: issueId || null,
          issueIdentifier: issueIdentifier || null,
          issueTitle: issueTitle || null,
          issueUrl: issueUrl || null,
          dispatchedBy: req.session?.accountId || null,
          target: target || 'cli',
          repo: repo || null,
          followUpTo: followUpTo || null,
          force: force === true,
          abort: isAbort,
          abortTo: isAbort ? abortTo : null,
          cascade: cascade === true,
          sessionId: sessionId || null,
          waitForFollowUps: waitForFollowUps === true,
          queueIfBusy: queueIfBusy === true,
          subscription: subscription ?? DEFAULT_SUBSCRIPTION
        }
      });

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
      let spawn = undefined;
      if (target === 'local') {
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

          spawn = spawnClaudeSession(item.prompt, {
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
      // Proxy-context attach failure (LIN-1162): a requested `attachProxy:true`
      // could not mint/append its block. Surface it (503, transient — mirrors the
      // client's old token-rate-limit message) rather than the generic 500, and
      // NEVER as a success: no item was enqueued (the throw fired before addItem).
      if (err && err.proxyAttachFailed) {
        return serviceUnavailable.json(res, 'Proxy context was requested but a proxy token could not be created — you may have hit the token rate limit; wait a minute and try again.');
      }
      console.error('Dispatch error:', err.message);
      jsonError(res, 500, 'Failed to dispatch prompt');
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
      jsonError(res, 500, 'Failed to list dispatch items');
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
      jsonError(res, 500, 'Failed to count dispatch items');
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
      jsonError(res, 500, 'Failed to list dispatch history');
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
    const accountId = req.session.accountId;
    if (!accountId) {
      return unauthorized.json(res, 'Authentication required');
    }
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
    const accountId = req.session.accountId;
    if (!accountId) {
      return unauthorized.json(res, 'Authentication required');
    }
    if (!userPreferencesStore) {
      return jsonError(res, 503, 'Service unavailable');
    }

    const { prompt: rawPrompt } = req.body;
    const prompt = typeof rawPrompt === 'string' ? rawPrompt.trim() : rawPrompt;
    if (!prompt || typeof prompt !== 'string') {
      return badRequest.json(res, 'prompt is required and must be a string');
    }
    if (prompt.length > MAX_CUSTOM_PROMPT_LENGTH) {
      return badRequest.json(res, `prompt exceeds maximum length of ${MAX_CUSTOM_PROMPT_LENGTH}`);
    }
    if (DANGEROUS_CHARS_REGEX.test(prompt)) {
      return badRequest.json(res, 'prompt contains invalid characters');
    }

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
      console.error('Failed to save recent prompt:', err.message);
      jsonError(res, 500, 'Failed to save recent prompt');
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
    const accountId = req.session.accountId;
    if (!accountId) {
      return unauthorized.json(res, 'Authentication required');
    }
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
   * Validation is copied verbatim from the recents POST so a favourite and its
   * recent counterpart accept/reject the same strings (and stay in sync by value).
   */
  router.post('/workspace/:urlKey/api/dispatch/favorite-prompts', workspaceFromUrl, async (req, res) => {
    const accountId = req.session.accountId;
    if (!accountId) {
      return unauthorized.json(res, 'Authentication required');
    }
    if (!userPreferencesStore) {
      return jsonError(res, 503, 'Service unavailable');
    }

    const { prompt: rawPrompt } = req.body;
    const prompt = typeof rawPrompt === 'string' ? rawPrompt.trim() : rawPrompt;
    if (!prompt || typeof prompt !== 'string') {
      return badRequest.json(res, 'prompt is required and must be a string');
    }
    if (prompt.length > MAX_CUSTOM_PROMPT_LENGTH) {
      return badRequest.json(res, `prompt exceeds maximum length of ${MAX_CUSTOM_PROMPT_LENGTH}`);
    }
    if (DANGEROUS_CHARS_REGEX.test(prompt)) {
      return badRequest.json(res, 'prompt contains invalid characters');
    }

    try {
      const prompts = await userPreferencesStore.addFavoritePrompt(accountId, req.workspace.urlKey, prompt);
      res.json({ success: true, prompts });
    } catch (err) {
      console.error('Failed to save favorite prompt:', err.message);
      jsonError(res, 500, 'Failed to save favorite prompt');
    }
  });

  /**
   * DELETE /workspace/:urlKey/api/dispatch/favorite-prompts
   * Remove (un-star) a custom prompt from the favourites list. Prompt comes in
   * the body `{ prompt }` (or `?prompt=`). Same auth gate as the add path.
   */
  router.delete('/workspace/:urlKey/api/dispatch/favorite-prompts', workspaceFromUrl, async (req, res) => {
    const accountId = req.session.accountId;
    if (!accountId) {
      return unauthorized.json(res, 'Authentication required');
    }
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
      console.error('Failed to remove favorite prompt:', err.message);
      jsonError(res, 500, 'Failed to remove favorite prompt');
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
      const removed = await dispatchQueueStore.removeItem(workspace.urlKey, itemId);

      if (!removed) {
        return notFound.json(res, 'Item not found');
      }

      res.json({ success: true });
    } catch (err) {
      console.error('Remove dispatch item error:', err.message);
      jsonError(res, 500, 'Failed to remove item');
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
      console.error('Create token error:', err.message);
      jsonError(res, 500, 'Failed to create token');
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
      jsonError(res, 500, 'Failed to list tokens');
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

    try {
      const revoked = await dispatchTokenStore.revokeToken(workspace.urlKey, tokenId);

      if (!revoked) {
        return notFound.json(res, 'Token not found');
      }

      res.json({ success: true });
    } catch (err) {
      console.error('Revoke token error:', err.message);
      jsonError(res, 500, 'Failed to revoke token');
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
      const modelError = validateOpaqueDispatchField(model, 'model', { maxLength: MAX_NAME_LENGTH });
      if (modelError) return { error: modelError.error };
      const harnessError = validateOpaqueDispatchField(harness, 'harness', { maxLength: MAX_NAME_LENGTH });
      if (harnessError) return { error: harnessError.error };
      if (model || harness) {
        normalized[kind] = {};
        if (model) normalized[kind].model = model;
        if (harness) normalized[kind].harness = harness;
      }
    }
    return { byKind: normalized };
  }

  function buildDispatchPresetConfig({ model, harness, byKind }) {
    const config = {};
    const trimmedModel = typeof model === 'string' ? model.trim() : '';
    const trimmedHarness = typeof harness === 'string' ? harness.trim() : '';
    if (trimmedModel) config.model = trimmedModel;
    if (trimmedHarness) config.harness = trimmedHarness;
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
      console.error('List dispatch presets error:', err.message);
      jsonError(res, 500, 'Failed to list dispatch presets');
    }
  });

  /**
   * POST /workspace/:urlKey/api/dispatch/presets
   * Create a new dispatch preset. Body: { name, model?, harness?, byKind? }.
   */
  router.post('/workspace/:urlKey/api/dispatch/presets', workspaceFromUrl, async (req, res) => {
    if (!dispatchPresetsStore) return jsonError(res, 503, 'Preset storage is not configured');

    const { name, model, harness, byKind } = req.body || {};
    const modelError = validateOpaqueDispatchField(model, 'model', { maxLength: MAX_NAME_LENGTH });
    if (modelError) return badRequest.json(res, modelError.error);
    const harnessError = validateOpaqueDispatchField(harness, 'harness', { maxLength: MAX_NAME_LENGTH });
    if (harnessError) return badRequest.json(res, harnessError.error);
    const byKindResult = normalizeDispatchPresetByKind(byKind);
    if (byKindResult.error) return badRequest.json(res, byKindResult.error);

    try {
      const preset = await dispatchPresetsStore.createCustom(req.workspace.urlKey, {
        name,
        config: buildDispatchPresetConfig({ model, harness, byKind: byKindResult.byKind })
      });
      res.status(201).json({ success: true, preset });
    } catch (error) {
      console.error('Create dispatch preset error:', error.message);
      jsonError(res, dispatchPresetErrorStatus(error.message), error.message || 'Failed to create preset');
    }
  });

  /**
   * PATCH /workspace/:urlKey/api/dispatch/presets/:presetId
   * Update an existing dispatch preset in place. Body: { name?, model?, harness?, byKind? }.
   * `byKind` present in the body (even `{}`) replaces/clears the stored value;
   * `byKind` absent from the body preserves the existing stored value (LIN-1400).
   */
  router.patch('/workspace/:urlKey/api/dispatch/presets/:presetId', workspaceFromUrl, async (req, res) => {
    if (!dispatchPresetsStore) return jsonError(res, 503, 'Preset storage is not configured');

    const { name, model, harness, byKind } = req.body || {};
    const modelError = validateOpaqueDispatchField(model, 'model', { maxLength: MAX_NAME_LENGTH });
    if (modelError) return badRequest.json(res, modelError.error);
    const harnessError = validateOpaqueDispatchField(harness, 'harness', { maxLength: MAX_NAME_LENGTH });
    if (harnessError) return badRequest.json(res, harnessError.error);
    const byKindResult = normalizeDispatchPresetByKind(byKind);
    if (byKindResult.error) return badRequest.json(res, byKindResult.error);

    try {
      const existing = await dispatchPresetsStore.get(req.workspace.urlKey, req.params.presetId);
      if (!existing) return notFound.json(res, 'Preset not found');

      const effectiveByKind = byKind !== undefined ? byKindResult.byKind : existing.config?.byKind;
      const config = buildDispatchPresetConfig({ model, harness, byKind: effectiveByKind });
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
      console.error('Delete dispatch preset error:', error.message);
      jsonError(res, 500, 'Failed to delete preset');
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
      jsonError(res, 500, 'Failed to poll dispatch queue');
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
   * token resolves under LIN-1366's owner-scoped selection. A dispatch token
   * with no owner (minted before LIN-1397, or never re-minted) fails closed
   * here rather than minting a bootstrap that would only fail later at
   * exchange time — the caller (the reaper) treats any failure from this
   * endpoint as "mint failed" and falls through to a token-less refire.
   */
  router.post('/api/dispatch/broker-token', authenticateDispatchToken, async (req, res) => {
    if (!req.dispatchTokenOwner) {
      return res.status(503).json(workspaceUnavailableEnvelope('not_connected', req.dispatchUrlKey));
    }

    if (!proxyTokenStore) {
      return serviceUnavailable.json(res, 'Broker token minting is not configured');
    }

    let minted;
    try {
      minted = await proxyTokenStore.createToken(req.dispatchUrlKey, {
        kind: 'bootstrap',
        scope: 'readWrite',
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
      console.error('Take error:', err.message);
      jsonError(res, 500, 'Failed to take item');
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

    const { message, url, urlLabel, kind, rootItemId } = req.body;

    // Additive, tolerant validation (LIN-1297): an invalid kind/rootItemId is
    // silently dropped, never rejected — mirrors the existing tolerate-unknown-
    // keys behavior for this route. `kind` here is the feedback-ENTRY vocabulary
    // (FEEDBACK_ENTRY_KINDS), distinct from the dispatch-item DISPATCH_KINDS above.
    const sanitizedKind = typeof kind === 'string' && FEEDBACK_ENTRY_KINDS.includes(kind) ? kind : undefined;
    const sanitizedRootItemId = typeof rootItemId === 'string' && UUID_REGEX.test(rootItemId) ? rootItemId : undefined;

    // Validate required fields
    if (!message || typeof message !== 'string') {
      return badRequest.json(res, 'message is required and must be a string');
    }

    // Validate lengths
    if (message.length > MAX_FEEDBACK_MESSAGE_LENGTH) {
      return badRequest.json(res, `message exceeds maximum length of ${MAX_FEEDBACK_MESSAGE_LENGTH}`);
    }
    if (url && url.length > MAX_URL_LENGTH) {
      return badRequest.json(res, `url exceeds maximum length of ${MAX_URL_LENGTH}`);
    }
    if (urlLabel && urlLabel.length > MAX_NAME_LENGTH) {
      return badRequest.json(res, `urlLabel exceeds maximum length of ${MAX_NAME_LENGTH}`);
    }

    // Reject dangerous characters
    if (DANGEROUS_CHARS_REGEX.test(message)) {
      return badRequest.json(res, 'message contains invalid characters');
    }
    if (urlLabel && DANGEROUS_CHARS_REGEX.test(urlLabel)) {
      return badRequest.json(res, 'urlLabel contains invalid characters');
    }

    // Block javascript: and other dangerous URL schemes
    if (url) {
      try {
        const parsed = new URL(url);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          return badRequest.json(res, 'url must use http or https protocol');
        }
      } catch {
        return badRequest.json(res, 'url must be a valid URL');
      }
    }

    try {
      const result = await dispatchQueueStore.addFeedback(
        itemId,
        req.dispatchUrlKey,
        { message, url: url || null, urlLabel: urlLabel || null, kind: sanitizedKind, rootItemId: sanitizedRootItemId },
        req.dispatchTokenLabel
      );

      if (!result) {
        return notFound.json(res, 'Item not found or feedback not allowed');
      }

      res.json(result);
    } catch (err) {
      console.error('Feedback error:', err.message);
      jsonError(res, 500, 'Failed to post feedback');
    }
  });

  return router;
}
