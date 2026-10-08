/**
 * Dispatch queue routes for prompt dispatch feature.
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
import { badRequest, jsonError, notFound, unauthorized, serviceUnavailable } from '../lib/errors.js';
import rateLimit from 'express-rate-limit';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawnClaudeSession } from '../lib/harbour-spawn.js';
import { isValidDispatchKind, DISPATCH_KINDS, DISPATCH_DEFAULT_KINDS } from '../lib/prompt-templates.js';
import { getPeriodicals, PERIODICAL_AUTOPILOT_TAIL } from '../lib/periodicals.js';
import { isValidSubscription, DEFAULT_SUBSCRIPTION, SUBSCRIPTION_LEVELS } from '../lib/dispatch-wake.js';
import { validateDispatchPayload, validateOpaqueDispatchField } from '../lib/dispatch-validation.js';
import { createDispatchItem } from '../lib/dispatch-factory.js';
import { isDanglingReferent, danglingReferentBody } from '../lib/dispatch-referent-guard.js';
import { getProviderForWorkspace, getProvider } from '../lib/providers/registry.js';
import { getWorkspaceCallScope, AMBIGUOUS_CALL_SCOPE, resolveIssueBinding, dispatchIssueSourceField } from '../lib/workspace.js';
import { attachProxyContext, shouldUseMcpTokenField, provisionResumeCredential, isStructuralGrantRefusal, isCodedGrantRefusal, codedGrantRefusalResponse } from '../lib/proxy-preamble.js';
import { BOOTSTRAP_TOKEN_TTL_SECONDS } from '../lib/proxy-tokens.js';
import { READ_WRITE } from '../lib/proxy-scopes.js';
import { validateFeedbackBody } from '../lib/dispatch-feedback-validation.js';
import { buildWakeCredentialProvisioner } from '../lib/wake-credential.js';
import { readHaltForPoll, projectHaltForPoll, POLL_HALT_READ_TIMEOUT_MS } from '../lib/poll-halt.js';
import { ownerlessCompatEnabled } from '../lib/ownerless-token-policy.js';
import { buildConsumerPollWarning, buildQueuedPollWarning, getConsumerLastSeenAt } from '../lib/consumer-poll-warning.js';
import { HALT_MODES, HALT_MODE_ERROR } from '../lib/workspace-halt.js';
import { deriveTerminalStatus } from '../lib/dispatch-terminal.js';
import { resolveOwnerMintRefusal } from '../lib/owner-mint-refusals.js';
import { DISPATCH_RUNGS, SURFACES } from '../lib/task-mode-store.js';
import { resolveChatCredential, buildRunGate } from '../lib/chat-request.js';
import { resolveAccountGroup } from '../lib/account-group.js';

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
export function createDispatchRoutes({ dispatchQueueStore, dispatchTokenStore, workspaceFromUrl, userPreferencesStore, harbourFeedbackTokenStore, workspacePreferencesStore, dispatchPresetsStore, proxyTokenStore, provider: injectedProvider = null, getWorkspaceAccessToken = null, fetchIssueContext = null, workspaceHaltStore = null, haltReadTimeoutMs = POLL_HALT_READ_TIMEOUT_MS, sessionsFeedCache = null, workspaceOwnerCheck = null, taskModeStore = null, freeTierStore = null, accountStore = null }) {
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
      const { prompt, promptName, kind, issueId, issueIdentifier, issueTitle, issueUrl, issueSource, target, repo, model, harness, terminal, effort, followUpTo, force, abort, abortTo, cascade, sessionId, periodicalId, waitForFollowUps, queueIfBusy, subscription, attachProxy, presetId, maxTasks, maxSessionsPerTask, composedRunMarker, entryRung, surface, stopAt, variant } = req.body;

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

      // Periodical-template join key (LIN-1825): registry-membership check, not
      // format validation, so it stays route-local rather than routing through
      // validateDispatchPayload (deliberately format-only, never against a
      // model registry). Optional; absent/undefined means a non-periodical
      // dispatch and is left untouched.
      if (periodicalId !== undefined && !getPeriodicals().map(p => p.id).includes(periodicalId)) {
        return badRequest.json(res, 'periodicalId must be one of the known periodical template ids');
      }

      // LIN-3136 M2 / M2b: which launches declare the dispatch grant. An
      // autopilot, or a periodical "+ Autopilot" variant: kind 'periodical', a
      // periodicalId validated just above, and the SERVER-OWNED handoff tail in
      // the prompt (lib/periodicals.js). A plain Mint, or a prompt edited to drop
      // the tail, launches a grant-less leaf as before. The client sends no
      // grant intent at all; the owner check at the mint is the authority.
      const isPeriodicalAutopilot = kind === 'periodical'
        && periodicalId !== undefined
        && typeof prompt === 'string'
        && prompt.includes(PERIODICAL_AUTOPILOT_TAIL);
      const launchesOrchestrator = kind === 'autopilot' || isPeriodicalAutopilot;

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

      // Task budget (LIN-1751/LIN-1737): a SCOPE bound on the run — up to this many
      // distinct tasks — enforced deterministically at the dispatch-factory seam.
      // Validated here inline, matching routes/proxy.js's kickoff-seam rule and
      // error text exactly (LIN-1737 D3), so a run kicked off through either seam
      // rejects an invalid budget identically. Optional; absent/null ⇒ no budget,
      // byte-identical to today.
      if (maxTasks !== undefined && maxTasks !== null) {
        if (!Number.isInteger(maxTasks) || maxTasks < 1) {
          return badRequest.json(res, 'maxTasks must be an integer >= 1');
        }
      }
      // Sibling per-task bound (LIN-2934): same rule/error text as maxTasks.
      if (maxSessionsPerTask !== undefined && maxSessionsPerTask !== null) {
        if (!Number.isInteger(maxSessionsPerTask) || maxSessionsPerTask < 1) {
          return badRequest.json(res, 'maxSessionsPerTask must be an integer >= 1');
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

      // Ladder entry rung (LIN-2942): which rung of the opened task's ladder
      // this dispatch was pressed from. Optional; absent/null ⇒ no mode event
      // and the route behaves exactly as without it. Only a fresh dispatch for
      // a task is a ladder press, so a modifier that could never be recorded is
      // rejected rather than silently dropped (the cascade/abortTo precedent).
      const hasEntryRung = entryRung !== undefined && entryRung !== null;
      if (hasEntryRung) {
        if (!DISPATCH_RUNGS.includes(entryRung)) {
          return badRequest.json(res, `entryRung must be one of: ${DISPATCH_RUNGS.join(', ')}`);
        }
        if (isAbort || cascade === true || (followUpTo !== undefined && followUpTo !== null)) {
          return badRequest.json(res, 'entryRung is only valid on a fresh dispatch (not abort, cascade or followUpTo)');
        }
        if (!issueIdentifier) {
          return badRequest.json(res, 'entryRung requires issueIdentifier');
        }
      }

      // Run-boundary fact (LIN-3245 / LIN-2949 P1a): `stopAt: 'pr'` on a fresh
      // autopilot kickoff means this run stops at its PR — its close-out is the
      // person's to send. A DEDICATED, validated body field, never derived from
      // `entryRung` (a browser-sent measurement, not a gate). Only the value
      // `'pr'` is accepted, and only on a fresh autopilot dispatch for a task;
      // any modifier that could never carry the boundary is rejected rather than
      // silently dropped (the entryRung/cascade/abortTo precedent above).
      const hasStopAt = stopAt !== undefined && stopAt !== null;
      if (hasStopAt) {
        if (stopAt !== 'pr') {
          return badRequest.json(res, "stopAt must be 'pr'");
        }
        if (isAbort || cascade === true || (followUpTo !== undefined && followUpTo !== null)) {
          return badRequest.json(res, 'stopAt is only valid on a fresh dispatch (not abort, cascade or followUpTo)');
        }
        if (kind !== 'autopilot') {
          return badRequest.json(res, "stopAt requires kind 'autopilot'");
        }
        if (!issueIdentifier) {
          return badRequest.json(res, 'stopAt requires issueIdentifier');
        }
      }

      // Run variant (LIN-3248 N2): the authoritative standard/stepper fact the
      // run page reads to decide whether the "Harbour never merges on its own"
      // promise is backed. A DEDICATED, validated body field (never sniffed
      // from promptName), only on a fresh autopilot dispatch for a task; absent
      // stays null, which the page reads as unknown and fails the promise
      // closed. Same freshness discipline as stopAt above.
      const hasVariant = variant !== undefined && variant !== null;
      if (hasVariant) {
        if (variant !== 'standard' && variant !== 'stepper') {
          return badRequest.json(res, "variant must be 'standard' or 'stepper'");
        }
        if (isAbort || cascade === true || (followUpTo !== undefined && followUpTo !== null)) {
          return badRequest.json(res, 'variant is only valid on a fresh dispatch (not abort, cascade or followUpTo)');
        }
        if (kind !== 'autopilot') {
          return badRequest.json(res, "variant requires kind 'autopilot'");
        }
      }

      // LIN-2944 P1 (handover d610edd0): the opened-task surface a ladder press
      // came from, recorded on the mode event. Optional — every other dispatch
      // caller (periodical / Setup Prompt / dispatch page / autopilot kickoff)
      // sends no surface, and it records null. Out of vocabulary ⇒ 400.
      const hasSurface = surface !== undefined && surface !== null;
      if (hasSurface && !SURFACES.includes(surface)) {
        return badRequest.json(res, `surface must be one of: ${SURFACES.join(', ')}`);
      }

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

      // LIN-3335 (reduced from LIN-3242): an issue-addressed dispatch may name
      // its provider-kind `issueSource` — a legitimate source-only routing hint
      // (every issue row carries a source), resolved by `resolveIssueBinding`'s
      // source-only rule and persisted as a kind-only stamp.
      const persistedBindingFields = issueIdentifier
        ? dispatchIssueSourceField(issueSource)
        : {};

      // Dangling-referent guard (LIN-1948, surface 2d). The session-cookie twin
      // of the proxy-token check in routes/proxy.js — same hole, different auth
      // lane: `issueIdentifier` is destructured straight off req.body and stored
      // unresolved. MUST run before createDispatchItem, whose finalizePrompt
      // mints a single-use bootstrap.
      //
      // LIN-3335: resolve the referent through the issue's own provider-kind
      // `issueSource` when known, else the workspace's active binding. A legacy
      // workspace whose active binding is ambiguous still yields
      // AMBIGUOUS_CALL_SCOPE, treated as "no credential" and skipped — the same
      // fail-open as every other non-definitive outcome.
      if (!isAbort && issueIdentifier) {
        const binding = resolveIssueBinding(workspace, issueSource);
        const referentProvider = injectedProvider || binding.provider;
        const referentToken = binding.callScope === AMBIGUOUS_CALL_SCOPE ? null : binding.callScope;
        if (await isDanglingReferent({ provider: referentProvider, token: referentToken, issueIdentifier })) {
          return res.status(422).json(danglingReferentBody(issueIdentifier));
        }
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
      // Free-tier run gate (LIN-3238): only a free-tier session is gated.
      // `buildRunGate` returns null for a paid/own key and for a null account
      // (null attribution is not gated), so every other caller stays ungated.
      // The factory invokes it only on a fresh row (step 1.55).
      const { isFreeTier: dispatchIsFreeTier } = resolveChatCredential({ sessionApiKey: req.session?.openRouterApiKey });
      const runGate = buildRunGate({
        isFreeTier: dispatchIsFreeTier,
        freeTierStore,
        accountId: req.session?.accountId,
        accountStore
      });
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
        terminal,
        effort,
        dispatchTokenStore,
        proxyTokenStore,
        runGate,
        // LIN-3200 P5: plan block for the file-pointer pilot on the session/UI
        // dispatch path. Closes over this route's own provider resolution (the
        // same getProviderForWorkspace + getWorkspaceCallScope pair the
        // dangling-referent guard above uses) and the injected fetchIssueContext;
        // a provider without the capability, an ambiguous call scope, or a test
        // sentinel degrades to "no plan paths".
        readPlanBlock: async () => {
          if (!issueIdentifier || typeof fetchIssueContext !== 'function') return null;
          const planProvider = injectedProvider || getProviderForWorkspace(workspace);
          if (!planProvider?.fetchIssueContext) return null;
          let planToken = null;
          if (typeof getWorkspaceAccessToken === 'function') {
            try { planToken = await getWorkspaceAccessToken(workspace.urlKey, req.session); } catch { planToken = null; }
          }
          if (!planToken) {
            const planScope = getWorkspaceCallScope(workspace);
            planToken = planScope === AMBIGUOUS_CALL_SCOPE ? null : planScope;
          }
          if (!planToken) return null;
          const ctx = await fetchIssueContext(planToken, issueIdentifier);
          const issue = ctx?.issue || ctx || {};
          return issue.description || null;
        },
        // LIN-2775 Area 8: threaded straight through, unvalidated here — the
        // marker's own validation and the terminal-anchor guard it gates
        // both live inside createDispatchItem (the one reusable, testable
        // chokepoint), not duplicated at this route layer the way model/
        // harness/terminal are via validateDispatchPayload above.
        composedRunMarker,
        // LIN-3124 PR3 (D16): pass the session so a connection-backed
        // workspace's done-guard reads the session's own hydrated credential.
        getWorkspaceAccessToken: (k) => getWorkspaceAccessToken(k, req.session),
        fetchIssueContext,
        // Follow-up credential provisioning (LIN-1431 S3 #1, LIN-3134 T2-ii). The
        // human reply box (public/session.js) posts only { prompt, followUpTo,
        // target, force } and never sets `attachProxy`; pre-LIN-1431 such a
        // follow-up was enqueued with `bootstrapToken: null` and resumed a session
        // whose local broker had died with its window (LIN-1362/1375). The fix is a
        // SERVER-SIDE default, deliberately not a new client flag (LIN-1252/1298/
        // 1309): EVERY follow-up arms the one resume helper, which takes its
        // credential from the persisted parent record — declared or plain, the
        // RECORDED owner and workspace, never the poster.
        //
        // `followUpTo` is tested first, so this gate covers both modes:
        //   - attach mode when the client asked (`wantProxyContext`, LIN-1162) —
        //     attach always mints, exactly as the launch attach below;
        //   - otherwise pbt mode, `mint` = shouldUseMcpTokenField(RESOLVED harness).
        //     The guard is load-bearing: a prose-harness token has no channel to
        //     reach the worker (the prompt is untouched), and keying on the
        //     resolved harness preserves LIN-1111 — a blank harness resolves null
        //     here (applyDefaultHarness:false), so it never mints.
        // A record never turns a non-minting follow-up into a mint. A follow-up is
        // never an abort and always has a prompt (both are 400s above).
        //
        // Fail-closed is inherited (LIN-1162/LIN-525): a failed mint throws before
        // addItem and the catch below maps it. The server attaches or throws.
        ...(followUpTo
          ? {
              finalizePrompt: async (resolvedHarness) => {
                const resumed = await provisionResumeCredential({
                  proxyTokenStore,
                  dispatchStore: dispatchQueueStore,
                  urlKey: workspace.urlKey,
                  baseUrl,
                  label: 'dispatch-bootstrap',
                  harness: resolvedHarness,
                  followUpTo,
                  // LIN-1376: stamp the launching account (ignored on a declared
                  // resume, where the recorded owner is the authority).
                  createdBy: req.session?.accountId || null,
                  prompt,
                  mint: shouldUseMcpTokenField(resolvedHarness),
                  attach: wantProxyContext
                    ? {
                        issueIdentifier: issueIdentifier || null,
                        prompt,
                        providerDisplayName: getProvider(workspace.provider)?.ui?.displayName ?? null,
                        providerUi: getProvider(workspace.provider)?.ui ?? null
                      }
                    : null
                });
                // LIN-1162's "surface, don't silently drop" check (see the launch
                // attach below) applies to the attach-mode result: same condition,
                // same error.
                if (wantProxyContext && resumed.prompt === prompt) {
                  const err = new Error('proxy context requested but could not be attached');
                  err.proxyAttachFailed = true;
                  throw err;
                }
                return resumed;
              }
            }
          : wantProxyContext
          ? {
              finalizePrompt: async (resolvedHarness) => {
                let attached;
                try {
                  attached = await attachProxyContext({
                    proxyTokenStore,
                    urlKey: workspace.urlKey,
                    baseUrl,
                    issueIdentifier: issueIdentifier || null,
                    prompt,
                    label: 'dispatch-bootstrap',
                    harness: resolvedHarness,
                    // LIN-2354: declared provider identity, fallback-free —
                    // getProvider (unlike getProviderForWorkspace, used above for
                    // capability shaping) never guesses Linear for an undeclared
                    // workspace.
                    providerDisplayName: getProvider(workspace.provider)?.ui?.displayName ?? null,
                    // LIN-2804: capability summary, same source as the displayName above.
                    providerUi: getProvider(workspace.provider)?.ui ?? null,
                    // LIN-1376: stamp the launching account so the dispatched
                    // session's token resolves under LIN-1366 owner-scoping.
                    createdBy: req.session?.accountId || null,
                    // LIN-3136 M2: an orchestrator launch holds the dispatch
                    // grant, minted for this session's own account, which the
                    // mint checks is the workspace owner. A non-owner is refused
                    // (LIN-3085 owns delegation), never given a grant-less run.
                    ...(launchesOrchestrator
                      ? {
                          declaredGrants: ['dispatch'],
                          declaredSite: 'M2',
                          grantOwnerAccountId: req.session?.accountId || null,
                          workspaceId: workspace.id
                        }
                      : {})
                  });
                } catch (err) {
                  // Mark a launch-arm refusal so the catch below answers it with
                  // human text; a follow-up resume's refusal keeps its own relay.
                  if (isCodedGrantRefusal(err)) err.launchRefusal = true;
                  throw err;
                }
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
          periodicalId: periodicalId || null,
          waitForFollowUps: waitForFollowUps === true,
          queueIfBusy: queueIfBusy === true,
          subscription: subscription ?? DEFAULT_SUBSCRIPTION,
          maxTasks: maxTasks ?? null,
          // Sibling per-task bound (LIN-2934): same rationale as maxTasks.
          maxSessionsPerTask: maxSessionsPerTask ?? null,
          // Run-boundary fact (LIN-3245 / LIN-2949 P1a): stamped only when the
          // validated `'pr'` value was supplied; null (the default) is
          // byte-identical to today.
          stopAt: stopAt ?? null,
          // Run variant (LIN-3248 N2): stamped when the validated
          // standard/stepper value was supplied; null otherwise.
          variant: variant ?? null,
          // LIN-3335: the kind-only issue source. Written here as null when
          // absent (the existing route `fields` style), but the STORE writes it
          // SPARSELY — an unstamped persisted row adds no key. Selection-only
          // provenance (never a credential).
          issueSource: persistedBindingFields.issueSource ?? null
        }
      });

      // LIN-2942: the item exists, so record the ladder press that created it,
      // linked by dispatchId. Fire-and-forget: a failed record never fails or
      // delays the dispatch, and the response is the same with or without it.
      // Only a session account can be attributed; without one nothing is recorded.
      if (hasEntryRung && taskModeStore && req.session?.accountId) {
        try {
          Promise.resolve(taskModeStore.record({
            accountId: req.session.accountId,
            urlKey: workspace.urlKey,
            issueId: issueId || null,
            issueIdentifier,
            rung: entryRung,
            ready: true,
            needs: null,
            act: 'dispatch',
            dispatchId: item._id,
            // LIN-2944 P1: the caller's validated surface, or null for the other
            // dispatch callers that pass none.
            surface: hasSurface ? surface : null
          })).catch(err => console.error('Failed to record task-mode dispatch event:', err));
        } catch (err) {
          console.error('Failed to record task-mode dispatch event:', err);
        }
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

      // Consumer poll-recency warning (LIN-2885): read-only telemetry derived
      // from the stamp createDispatchItem already persisted on the item —
      // never a refusal, and omitted entirely (not `warning: null`) when the
      // workspace is being actively polled, per the ticket's own "a dispatch
      // into a live workspace shows nothing new".
      const consumerPollWarning = buildConsumerPollWarning(item.consumerLastSeenAt);
      res.status(201).json({
        success: true,
        item: {
          id: item._id,
          promptName: item.promptName,
          kind: item.kind,
          issueIdentifier: item.issueIdentifier,
          target: item.target,
          dispatchedAt: item.dispatchedAt,
          consumerLastSeenAt: item.consumerLastSeenAt,
          maxSessionsPerTask: item.maxSessionsPerTask ?? null,
          ...(item.budgetPosition ? { budgetPosition: item.budgetPosition } : {})
        },
        ...(consumerPollWarning ? { warning: consumerPollWarning } : {}),
        ...(spawn ? { spawn } : {})
      });
    } catch (err) {
      // Duplicate-dispatch refusal (LIN-1656): a fresh dispatch for this
      // issue+kind already exists from the last few minutes. Same tagged-throw
      // convention as `proxyAttachFailed` just below, and it must sit ahead of the
      // generic 500 — a 500 would be indistinguishable from a real fault, which is
      // worse than having no guard at all.
      //
      // The body is constructed once by `createDispatchItem` and carried on the
      // error, so this is a relay, not a second construction site: `code`
      // (DUPLICATE_DISPATCH) is what a caller branches on, and `id` names the LIVE
      // dispatch to watch instead of re-dispatching. `Retry-After` duplicates the
      // body's `retryAfter` for standards-friendly clients. This route is
      // session-auth'd (no proxy audit log), so there is no logEvent to write.
      if (err && err.duplicateDispatch) {
        res.set('Retry-After', String(err.duplicateDispatch.retryAfter));
        return jsonError(res, 409, err.message, err.duplicateDispatch);
      }
      // Free-tier run-limit refusal (LIN-3238): the body is built once by
      // `createDispatchItem` (step 1.55) and carried on `err.runLimit` —
      // `{ error, code, freeTier, retryAfter }`. A 429 for an exhausted limit
      // (with `Retry-After` to `resetsAt`); a 503 when the count could not be
      // read (fail closed). This route is session-auth'd, so no audit log.
      if (err && err.runLimit) {
        const status = err.runLimit.code === 'RUN_LIMIT_UNVERIFIED' ? 503 : 429;
        if (status === 429) {
          res.set('Retry-After', String(err.runLimit.retryAfter));
        }
        return jsonError(res, status, err.runLimit.error, {
          code: err.runLimit.code,
          freeTier: err.runLimit.freeTier,
          retryAfter: err.runLimit.retryAfter
        });
      }
      // Task-budget refusal (LIN-1751): same tagged-throw relay convention as
      // the duplicate guard above, distinct `code` (BUDGET_EXHAUSTED) so a
      // caller branching on 409 bodies can tell the two refusals apart. No
      // `Retry-After` — the budget doesn't clear on a timer.
      if (err && err.budgetExhausted) {
        return jsonError(res, 409, err.message, err.budgetExhausted);
      }
      // Run-boundary refusal (LIN-3245 / LIN-2949 P1a): a fresh close-out
      // dispatch for a `stopAt: 'pr'` run. Sibling of the budget relay above,
      // distinct code (CLOSE_OUT_IS_THE_PERSONS) so a caller branching on 409
      // bodies can tell it apart. No `Retry-After` — nothing clears on a timer.
      if (err && err.closeOutRefusal) {
        return jsonError(res, 409, err.message, err.closeOutRefusal);
      }
      // Proxy-context attach failure (LIN-1162): a requested `attachProxy:true`
      // could not mint/append its block. Surface it (503, transient — mirrors the
      // client's old token-rate-limit message) rather than the generic 500, and
      // NEVER as a success: no item was enqueued (the throw fired before addItem).
      // LIN-3136 M2: a declared launch the owner check refused (or could not
      // run). Ahead of the attach-failure branch, because a transient
      // OWNER_CHECK_UNAVAILABLE also carries `proxyAttachFailed` and would
      // otherwise read as a token rate limit. Human text from the shared
      // vocabulary; nothing was enqueued.
      if (err && err.launchRefusal) {
        const refusal = codedGrantRefusalResponse(err, 'an autopilot launch credential');
        return jsonError(res, refusal.status, refusal.error, { code: refusal.code, retryable: refusal.retryable });
      }
      if (err && err.proxyAttachFailed) {
        return serviceUnavailable.json(res, 'Proxy context was requested but a proxy token could not be created — you may have hit the token rate limit; wait a minute and try again.');
      }
      // A declared resume whose grant cannot be re-issued (LIN-3134): relay the
      // coded refusal's own status and code rather than the generic 500 below.
      if (isStructuralGrantRefusal(err)) {
        return jsonError(res, err.status, err.message, { code: err.code, retryable: false });
      }
      // Terminal-anchor refusal (LIN-2775 Area 8): same tagged-throw relay
      // convention as the duplicate/budget guards above — the body was
      // already constructed once by createDispatchItem, this is a relay,
      // not a second construction site. Beat 5 correction: this branch was
      // MISSING entirely — a correct, deliberate safety refusal (409,
      // `code: 'ANCHOR_TERMINAL'`) was falling through to the generic 500
      // below, so the stable code this guard's own unit tests assert on
      // never actually reached the wire.
      if (err && err.anchorTerminalRefusal) {
        return jsonError(res, 409, err.message, err.anchorTerminalRefusal);
      }
      // An invalid `composedRunMarker` (LIN-2775 Area 8): a genuine caller
      // validation error, not a fault — same beat-5 correction, this was
      // also falling through to the 500 below.
      if (err && err.composedRunMarkerInvalid) {
        return badRequest.json(res, err.message);
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
      // Consumer poll-recency warning (LIN-2885), derived fresh against the
      // current clock from each item's own enqueue-time stamp — same pure
      // function the proxy watch/list endpoints use — so the dispatch page's
      // queue list and the nav-badge popover (both rendered off this response
      // via window.renderQueueRow) can show "no runner has polled..." on a
      // stale queued row without duplicating the threshold logic client-side.
      // LIN-3367: warning from the LIVE poll recency (read once per request, not
      // per row), queued rows only. This collection is the queue itself, so
      // every row here is queued — the status gate is a no-op; it is routed
      // through the shared helper so the rule lives in one place.
      const liveLastSeenAt = items.length
        ? await getConsumerLastSeenAt(dispatchTokenStore, workspace.urlKey, proxyTokenStore)
        : null;
      res.json({ items: items.map(item => ({ ...item, consumerPollWarning: buildQueuedPollWarning('queued', liveLastSeenAt) })) });
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
      console.error('Read dispatch quota error:', err.message);
      jsonError(res, 500, 'Failed to read dispatch quota');
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
  // This is a REQUEST-only surface (Decision 4, best-effort): setting a halt
  // does not itself pause or stop anything — the runner does not yet honor it
  // (pending LIN-2995). No per-write audit log is added here; the halt
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
      console.error('Workspace halt read error:', err.message);
      jsonError(res, 500, 'Failed to read halt');
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

    if (!workspaceHaltStore) {
      return serviceUnavailable.json(res, 'Failed to set halt');
    }

    const setBy = req.session?.accountId || null;
    const now = new Date();

    try {
      await workspaceHaltStore.setWorkspaceHalt(req.workspace.urlKey, { mode, setBy, now });
      res.json({ success: true, halt: { mode, setAt: now, setBy } });
    } catch (err) {
      console.error('Workspace halt set error:', err.message);
      jsonError(res, 500, 'Failed to set halt');
    }
  });

  /**
   * DELETE /workspace/:urlKey/api/dispatch/halt
   * Resume: clears the stored halt request. Idempotent — harmless when
   * nothing is set (the store's own `deleteOne` semantics).
   */
  router.delete('/workspace/:urlKey/api/dispatch/halt', workspaceFromUrl, async (req, res) => {
    if (!workspaceHaltStore) {
      return serviceUnavailable.json(res, 'Failed to clear halt');
    }

    try {
      await workspaceHaltStore.clearWorkspaceHalt(req.workspace.urlKey);
      res.json({ success: true });
    } catch (err) {
      console.error('Workspace halt clear error:', err.message);
      jsonError(res, 500, 'Failed to clear halt');
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
    const { maxTasks, maxSessionsPerTask } = req.body || {};

    if (!UUID_REGEX.test(sessionId)) {
      return badRequest.json(res, 'Invalid session ID format');
    }
    if (maxTasks === undefined && maxSessionsPerTask === undefined) {
      return badRequest.json(res, 'At least one of maxTasks or maxSessionsPerTask is required');
    }
    if (maxTasks !== undefined && (!Number.isInteger(maxTasks) || maxTasks < 1)) {
      return badRequest.json(res, 'maxTasks must be a positive integer');
    }
    if (maxSessionsPerTask !== undefined && (!Number.isInteger(maxSessionsPerTask) || maxSessionsPerTask < 1)) {
      return badRequest.json(res, 'maxSessionsPerTask must be a positive integer');
    }

    try {
      const result = await dispatchQueueStore.trimSessionBudget(
        workspace.urlKey, sessionId, { maxTasks, maxSessionsPerTask }, { by: req.session?.accountId || null }
      );

      if (result.ok) {
        return res.json({ success: true, item: result.item });
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
      console.error('Trim session budget error:', err.message);
      jsonError(res, 500, 'Failed to trim run');
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
      const effort = typeof entry.effort === 'string' ? entry.effort.trim() : '';
      const modelError = validateOpaqueDispatchField(model, 'model', { maxLength: MAX_NAME_LENGTH });
      if (modelError) return { error: modelError.error };
      const harnessError = validateOpaqueDispatchField(harness, 'harness', { maxLength: MAX_NAME_LENGTH });
      if (harnessError) return { error: harnessError.error };
      const effortError = validateOpaqueDispatchField(effort, 'effort', { maxLength: MAX_NAME_LENGTH });
      if (effortError) return { error: effortError.error };
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
   * Create a new dispatch preset. Body: { name, model?, harness?, effort?, byKind? }.
   */
  router.post('/workspace/:urlKey/api/dispatch/presets', workspaceFromUrl, async (req, res) => {
    if (!dispatchPresetsStore) return jsonError(res, 503, 'Preset storage is not configured');

    const { name, model, harness, effort, byKind } = req.body || {};
    const modelError = validateOpaqueDispatchField(model, 'model', { maxLength: MAX_NAME_LENGTH });
    if (modelError) return badRequest.json(res, modelError.error);
    const harnessError = validateOpaqueDispatchField(harness, 'harness', { maxLength: MAX_NAME_LENGTH });
    if (harnessError) return badRequest.json(res, harnessError.error);
    const effortError = validateOpaqueDispatchField(effort, 'effort', { maxLength: MAX_NAME_LENGTH });
    if (effortError) return badRequest.json(res, effortError.error);
    const byKindResult = normalizeDispatchPresetByKind(byKind);
    if (byKindResult.error) return badRequest.json(res, byKindResult.error);

    try {
      const preset = await dispatchPresetsStore.createCustom(req.workspace.urlKey, {
        name,
        config: buildDispatchPresetConfig({ model, harness, effort, byKind: byKindResult.byKind })
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
    const modelError = validateOpaqueDispatchField(model, 'model', { maxLength: MAX_NAME_LENGTH });
    if (modelError) return badRequest.json(res, modelError.error);
    const harnessError = validateOpaqueDispatchField(harness, 'harness', { maxLength: MAX_NAME_LENGTH });
    if (harnessError) return badRequest.json(res, harnessError.error);
    const effortError = validateOpaqueDispatchField(effort, 'effort', { maxLength: MAX_NAME_LENGTH });
    if (effortError) return badRequest.json(res, effortError.error);
    const byKindResult = normalizeDispatchPresetByKind(byKind);
    if (byKindResult.error) return badRequest.json(res, byKindResult.error);

    try {
      const existing = await dispatchPresetsStore.get(req.workspace.urlKey, req.params.presetId);
      if (!existing) return notFound.json(res, 'Preset not found');

      const effectiveByKind = byKind !== undefined ? byKindResult.byKind : existing.config?.byKind;
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
      console.error('Feedback error:', err.message);
      jsonError(res, 500, 'Failed to post feedback');
    }
  });

  return router;
}
