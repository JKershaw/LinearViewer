/**
 * Group I dispatch routes (LIN-679 Stage 6 / LIN-2540: extracted from
 * routes/proxy.js, byte-identical handler bodies).
 *
 * POST /api/proxy/dispatch, POST /api/proxy/recommend-and-dispatch,
 * GET /api/proxy/dispatch, GET /api/proxy/dispatch/:id,
 * GET /api/proxy/dispatch/:id/prompt.
 */
import { Router } from 'express';
import { armKeepalive } from '../lib/http-keepalive.js';
import { attachProxyContext, shouldUseMcpTokenField, provisionBootstrapToken } from '../lib/proxy-preamble.js';
import { badRequest, jsonError, notFound } from '../lib/errors.js';
import { createDispatchItem } from '../lib/dispatch-factory.js';
import { MAX_NAME_LENGTH, DANGEROUS_CHARS_REGEX } from '../lib/issue-write-validation.js';
import { isDanglingReferent, ISSUE_NOT_FOUND_CODE, DANGLING_REFERENT_MESSAGE } from '../lib/dispatch-referent-guard.js';
import { declaredProviderDisplayName, graphqlErrorDetail, graphqlErrorExtra } from '../lib/proxy-graphql-errors.js';
import { isValidSubscription, DEFAULT_SUBSCRIPTION, SUBSCRIPTION_LEVELS } from '../lib/dispatch-wake.js';
import { deriveCompletedAt, deriveLifecycleStatus, deriveTerminalStatus, feedbackWithHarvestedAbort, harvestAbortedTargets, mergeLineageFeedback } from '../lib/dispatch-terminal.js';
import { describeDescent, resolveRecommendation } from '../lib/recommend-recurse.js';
import { generatePrompt, hasPrompt, isValidDispatchKind, deriveDispatchKind, getPromptDisplayName, PROMPT_TEMPLATES, DISPATCH_KINDS } from '../lib/prompt-templates.js';
import { getPeriodicals } from '../lib/periodicals.js';
import { isValidIssueId, UUID_REGEX } from '../lib/workspace.js';
import { parseRepoFromDescription, resolveDispatchRepo } from '../lib/prompt-formatters.js';
import { validateOpaqueDispatchField, validateSessionId, validateDispatchPayload, DISPATCH_EFFORT_LEVELS } from '../lib/dispatch-validation.js';
import { isRecommendationEnabled } from '../lib/openrouter.js';

// Dispatch input limits. The prompt/url caps for the POST /dispatch payload now
// live in lib/dispatch-validation.js (shared with the session-auth twin via
// validateDispatchPayload, LIN-1139); MAX_IDENTIFIER_LENGTH remains for the other
// proxy handlers that cap an identifier directly.
const MAX_IDENTIFIER_LENGTH = 100;     // Issue identifiers

// Long-poll tuning for GET /api/proxy/dispatch/:id?wait=Ns (LIN-392).
// DISPATCH_WAIT_MAX_S caps the hold below the ~60s ceiling that armKeepalive
// (flush at 25s) buys us past Heroku's 30s H12; the re-check interval bounds
// worst-case detection latency. Module-level so tests can drive the loop at
// short `wait` values instead of real-time waits.
const DISPATCH_WAIT_MAX_S = 50;
const DISPATCH_WAIT_POLL_MS = 1500;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Shapes a store item into the watch-endpoint response body. Shared by the
// immediate short-poll and the long-poll.
//
// `meta` (long-poll only) makes the response self-describing about WHY it
// returned, so a held-the-full-window return is distinguishable from a
// short-circuit — they were previously byte-identical, which made a working
// 50s hold look like a fast empty return to a caller with no wall-clock on its
// own calls. `reason` ∈ 'terminal' (already done before the hold), 'change'
// (status transition or new feedback during the hold), 'timeout' (held the full
// window, nothing new); `waitedMs` is how long the handler actually held. Omitted
// on the plain short-poll (no `?wait`) so that path stays byte-identical.
function formatDispatchWatch(item, meta = null) {
  // LIN-2079: the REPORTED status is the lifecycle one (terminal, else `blocked`
  // when the lineage is parked on a human). `item.feedback` is already
  // lineage-merged by getItemStatus({includeGroupFeedback:true}).
  // This is the ONLY call site here that moves: `alreadyTerminal`, the long-poll
  // baseline and `dispatchWatchChanged` all deliberately keep calling
  // `deriveTerminalStatus`, because a `blocked` item is NOT terminal and must
  // keep holding the long poll rather than short-circuiting it.
  const terminalStatus = deriveLifecycleStatus(item.feedback);
  const body = {
    id: item.id,
    status: terminalStatus || item.status,
    promptName: item.promptName,
    kind: item.kind || 'custom',
    issueIdentifier: item.issueIdentifier,
    issueUrl: item.issueUrl,
    target: item.target,
    model: item.model || null,
    harness: item.harness || null,
    terminal: item.terminal || null,
    effort: item.effort || null,
    presetName: item.presetName || null,
    followUpTo: item.followUpTo || null,
    force: item.force === true,
    abort: item.abort === true,
    abortTo: item.abortTo || null,
    cascade: item.cascade === true,
    sessionId: item.sessionId || null,
    // Scope bound (LIN-1751): visible on the poll/watch response like every
    // other stored field, so a caller inspecting its own run can see the
    // declared budget without guessing. null ⇒ unbounded.
    maxTasks: item.maxTasks ?? null,
    dispatchedAt: item.dispatchedAt,
    // Attribution (LIN-1948, fix 3b): the detail/watch read is where a human
    // asking "who dispatched this?" actually looks. Paired with the
    // `_formatHistoryItem` fix so the queued and taken halves agree. This is
    // the DETAIL read — `GET /api/proxy/dispatch` (list/poll) re-projects
    // through its own explicit field allow-list, which does not include this
    // and is deliberately left alone.
    dispatchedBy: item.dispatchedBy || null,
    // resolvedAt is take/archive time (when the runner claimed the item), NOT
    // completion. completedAt is the real completion time, null until terminal.
    resolvedAt: item.resolvedAt || null,
    completedAt: deriveCompletedAt(item.feedback),
    feedback: (item.feedback || []).map(f => {
      const entry = {
        message: f.message,
        url: f.url || null,
        urlLabel: f.urlLabel || null,
        timestamp: f.timestamp || null
      };
      // Additive-only (LIN-1297 idiom, matching _formatFeedbackEntries):
      // assign only when present, never emit `rootItemId: null` (LIN-1468).
      if (f.rootItemId) entry.rootItemId = f.rootItemId;
      // Additive-only (LIN-1297 idiom, matching _formatFeedbackEntries):
      // assign only when present, never emit `kind: null` (LIN-1475).
      if (f.kind) entry.kind = f.kind;
      return entry;
    })
  };
  if (meta) {
    body.reason = meta.reason;
    body.waitedMs = meta.waitedMs;
  }
  return body;
}

// A dispatch item has "changed" for long-poll purposes when its derived
// terminal status appears (or shifts — last-marker-wins is not monotonic) or
// new feedback arrives. Compared against a baseline snapshot captured on the
// handler's first read.
function dispatchWatchChanged(baseline, item) {
  return (
    (deriveTerminalStatus(item.feedback) || item.status) !== baseline.status ||
    (item.feedback || []).length !== baseline.feedbackLength
  );
}

/**
 * @param {Object} deps
 * @param {Function} deps.authenticateProxyToken - Consumer-token auth middleware (closure-local in createProxyRoutes)
 * @param {Function} deps.chargeFreeTierOrReject - Free-tier quota gate for a recommendation-style call (closure-local)
 * @param {Function} deps.computeRecommendation - Shared recommendation compute path (closure-local, also injected into group F's routes/proxy-compute.js)
 * @param {Function} deps.denyIfUnsupported - Capability gate; 422s an unsupported provider method (closure-local)
 * @param {Object} deps.dispatchQueueStore - Dispatch queue storage instance
 * @param {Function} deps.getWorkspaceOpenRouterKey - Resolves the token-creator's OAuth OpenRouter key for a workspace (closure-local)
 * @param {Function} deps.graphqlErrorStatus - Maps a provider/GraphQL error to an HTTP status (closure-local, the route's own registry-bound error mapper)
 * @param {number} deps.LINEAGE_QUERY_LIMIT - Defensive cap on the list endpoint's lineage batch query (module-scope, exported from routes/proxy.js)
 * @param {Function} deps.logEvent - Audit/witness event logger (closure-local)
 * @param {Function} deps.logOpenRouterCredentialSource - Logs which OpenRouter credential source served a request (closure-local)
 * @param {Function} deps.proxyLimiter - Per-IP rate limiter middleware (module-scope in routes/proxy.js, shared as-is)
 * @param {string} deps.PROXY_ATTACH_FAILED_MESSAGE - 503 message when the out-of-band bootstrap token could not be minted (module-scope)
 * @param {Object} deps.proxyTokenStore - Proxy token storage instance
 * @param {Function} deps.recommendErrorResponse - Shapes a recommendation-path error into a status+body pair (closure-local)
 * @param {number} deps.RECOMMEND_DESCENT_BUDGET_MS - Shared cross-hop budget for the recommend recursion (module-scope)
 * @param {Function} deps.refuseIfBudgetExhausted - 409s a budget-exhausted dispatch error (closure-local)
 * @param {Function} deps.refuseIfDuplicateDispatch - 409s a duplicate dispatch error (closure-local)
 * @param {Function} deps.requireWriteScope - Requires readWrite scope on the token (closure-local)
 * @param {Function} deps.resolvePromptIssueContext - Resolves the issue + prompt context for deterministic, server-side prompt generation (module-scope, shared with groups F/H)
 * @param {Function} deps.resolveProviderAccess - Resolves {token, reason, provider} for the active workspace/provider (closure-local)
 * @param {Function} deps.resolveProxyLLM - Resolves OpenRouter credentials for a proxy LLM call (module-scope, exported from routes/proxy.js)
 * @param {string[]} deps.VALID_PROXY_DISPATCH_TARGETS - Valid dispatch target values (module-scope)
 * @param {Object} deps.workspacePreferencesStore - Workspace-level preference storage
 * @param {Function} deps.workspaceUnavailable - 503 envelope for an unresolvable workspace credential (closure-local)
 */
export function createDispatchRoutes({
  authenticateProxyToken,
  chargeFreeTierOrReject,
  computeRecommendation,
  denyIfUnsupported,
  dispatchQueueStore,
  getWorkspaceOpenRouterKey,
  graphqlErrorStatus,
  LINEAGE_QUERY_LIMIT,
  logEvent,
  logOpenRouterCredentialSource,
  proxyLimiter,
  PROXY_ATTACH_FAILED_MESSAGE,
  proxyTokenStore,
  recommendErrorResponse,
  RECOMMEND_DESCENT_BUDGET_MS,
  refuseIfBudgetExhausted,
  refuseIfDuplicateDispatch,
  requireWriteScope,
  resolvePromptIssueContext,
  resolveProviderAccess,
  resolveProxyLLM,
  VALID_PROXY_DISPATCH_TARGETS,
  workspacePreferencesStore,
  workspaceUnavailable,
}) {
  const router = Router();

  // ===========================================================================
  // Dispatch Endpoints (proxy-token twin of routes/dispatch.js)
  // ===========================================================================

  /**
   * POST /api/proxy/dispatch
   * Queue a prompt for the workspace's dispatch consumer (the runner).
   * Proxy-token equivalent of POST /workspace/:urlKey/api/dispatch — same
   * body shape and validation, but scoped by the token's workspace and
   * requiring readWrite scope. Excludes target 'local' (Harbour OS spawns on
   * the server's own tty, which a remote consumer can't drive). This is the
   * write half the autopilot orchestrator uses to dispatch a chosen task.
   */
  router.post('/api/proxy/dispatch', proxyLimiter, authenticateProxyToken, requireWriteScope, async (req, res) => {
    if (!dispatchQueueStore) {
      logEvent(req, '/api/proxy/dispatch', 503);
      return jsonError(res, 503, 'Dispatch is not available');
    }

    try {
      const { prompt, promptName, kind, issueId, issueIdentifier, issueTitle, issueUrl, target, repo, model, harness, terminal, effort, followUpTo, force, abort, abortTo, cascade, sessionId, periodicalId, waitForFollowUps, queueIfBusy, subscription } = req.body || {};

      // Abort verb (LIN-743): an abort item cancels/closes an existing session
      // (named by abortTo) instead of running a prompt — it carries no prompt and
      // skips the prompt-required check. abort and followUpTo are mutually exclusive.
      const isAbort = abort === true;
      if (isAbort && followUpTo !== undefined && followUpTo !== null) {
        logEvent(req, '/api/proxy/dispatch', 400);
        return badRequest.json(res, 'abort and followUpTo are mutually exclusive');
      }

      if (!isAbort && (!prompt || typeof prompt !== 'string')) {
        logEvent(req, '/api/proxy/dispatch', 400);
        return badRequest.json(res, 'prompt is required and must be a string');
      }
      if (target !== undefined && !VALID_PROXY_DISPATCH_TARGETS.includes(target)) {
        logEvent(req, '/api/proxy/dispatch', 400);
        return badRequest.json(res, `target must be one of: ${VALID_PROXY_DISPATCH_TARGETS.join(', ')}`);
      }

      // Abort eligibility (LIN-743): the abort item's OWN target must be
      // poll-eligible — NOT derived from the aborted session's substrate. The
      // proxy target set (cli/web/dash) is already exactly the poll-eligible set,
      // so the check above suffices; here we only enforce abortTo's presence/shape.
      if (isAbort) {
        if (!abortTo || !UUID_REGEX.test(abortTo)) {
          logEvent(req, '/api/proxy/dispatch', 400);
          return badRequest.json(res, 'abortTo is required and must be a UUID when abort is true');
        }
      } else if (abortTo !== undefined && abortTo !== null) {
        logEvent(req, '/api/proxy/dispatch', 400);
        return badRequest.json(res, 'abortTo requires abort to be true');
      }
      // Cascade close (LIN-946): a boolean modifier on an abort. When true the
      // abort's `abortTo` names the ROOT session of a subtree; Harbour expands the
      // one call into an abort per discovered descendant session (the recursive
      // sessionId-tree walk lands in a later beat). Like abortTo it is only
      // meaningful alongside abort — reject cascade:true without it rather than
      // storing an inert flag (mirroring the abortTo-requires-abort guard above).
      // Stored + forwarded blindly for now; the walk consumes it, not the runner.
      // This is the proxy-token twin the autopilot actually hits.
      if (cascade !== undefined && typeof cascade !== 'boolean') {
        logEvent(req, '/api/proxy/dispatch', 400);
        return badRequest.json(res, 'cascade must be a boolean');
      }
      if (cascade === true && !isAbort) {
        logEvent(req, '/api/proxy/dispatch', 400);
        return badRequest.json(res, 'cascade requires abort to be true');
      }
      // Validate kind if provided; when omitted it is derived from promptName below.
      if (kind !== undefined && !isValidDispatchKind(kind)) {
        logEvent(req, '/api/proxy/dispatch', 400);
        return badRequest.json(res, `kind must be one of: ${DISPATCH_KINDS.join(', ')}`);
      }
      // Periodical-template join key (LIN-1825): registry-membership check, not
      // format validation, so it stays route-local rather than routing through
      // validateDispatchPayload (deliberately format-only, never against a
      // model registry). This is the entry point that makes "works from any
      // entry point, including a bare-token agent POST" true — the id must be
      // validated here too, not just at the session route.
      if (periodicalId !== undefined && !getPeriodicals().map(p => p.id).includes(periodicalId)) {
        logEvent(req, '/api/proxy/dispatch', 400);
        return badRequest.json(res, 'periodicalId must be one of the known periodical template ids');
      }
      // Opt-in completion hold (LIN-797): boolean, default false. Stored +
      // forwarded blindly — the runner owns the behaviour (see LIN-795).
      if (waitForFollowUps !== undefined && typeof waitForFollowUps !== 'boolean') {
        logEvent(req, '/api/proxy/dispatch', 400);
        return badRequest.json(res, 'waitForFollowUps must be a boolean');
      }
      // Push-based inter-session comms (LIN-826): stored + forwarded blindly,
      // exactly like waitForFollowUps/force — no Harbour-side semantics.
      if (queueIfBusy !== undefined && typeof queueIfBusy !== 'boolean') {
        logEvent(req, '/api/proxy/dispatch', 400);
        return badRequest.json(res, 'queueIfBusy must be a boolean');
      }
      // Subscription edge declaration (LIN-900 §6): enum, no legacy boolean.
      if (subscription !== undefined && !isValidSubscription(subscription)) {
        logEvent(req, '/api/proxy/dispatch', 400);
        return badRequest.json(res, `subscription must be one of: ${SUBSCRIPTION_LEVELS.join(', ')}`);
      }

      // Shared payload validation for the two main handlers (LIN-1139): length
      // caps, opaque model/harness (LIN-438/1084), dangerous-char rejection, and
      // the issueId/followUpTo/force/sessionId format + combination rules. Lifted
      // verbatim + in order into validateDispatchPayload so this proxy twin and
      // the session route can't re-drift. The proxy caller keeps its own
      // logEvent(..., 400) on reject — the helper only returns the error
      // structure. The caller-specific checks that DIFFER (prompt-required,
      // target vocab, abort/cascade/kind/waitForFollowUps/queueIfBusy/subscription)
      // already ran above, preserving the original interleaving/first-error.
      const payloadError = validateDispatchPayload(req.body || {});
      if (payloadError) {
        logEvent(req, '/api/proxy/dispatch', 400);
        return badRequest.json(res, payloadError.error);
      }

      // Subscription is DECLARED on the edge (LIN-900 §6), never reconstructed from
      // incidental fields. An undeclared edge is `terminal-only`. This deliberately
      // removes the old LIN-881 `!!sessionId` default-on: §6 forbids inferring
      // subscription from "has a sessionId". A stepper beat that needs its PENDING
      // to wake its head declares `subscription: 'everything'` explicitly (the
      // stepper kickoff body does exactly this); a plain sessioned worker correctly
      // defaults to `terminal-only` and no longer wakes its orchestrator on PENDING.
      // The `buildWakeFollowUp` self-skip `childId === sessionId` still prevents an
      // orchestrator from waking itself.
      const subscriptionResolved = subscription ?? DEFAULT_SUBSCRIPTION;

      // Cascade close (LIN-946): a cascade request is not a single abort — it is a
      // command Harbour expands into one plain abort per session in abortTo's whole
      // descendant subtree (the recursive sessionId-tree walk). The store owns the
      // walk + emission; the runner still executes each cancel and skips
      // human-continued sessions (LIN-951). Handled here, before the prompt-context
      // work below (a cascade carries no prompt). This is the proxy-token twin the
      // autopilot actually hits. INERT: nothing issues a cascade at end-of-run yet.
      if (cascade === true) {
        const result = await dispatchQueueStore.expandCascadeAborts(req.proxyUrlKey, abortTo, {
          target: target || 'cli',
          dispatchedBy: req.proxyCreatedBy || null
        });
        logEvent(req, '/api/proxy/dispatch', 201);
        return res.status(201).json({ success: true, cascade: true, ...result });
      }

      // Dangling-referent guard (LIN-1948, surface 2a). MUST run before
      // createDispatchItem: `finalizePrompt` mints a single-use bootstrap token
      // inside the factory, so refusing afterwards would leak a minted
      // credential and burn a dedupe-window slot for a dispatch that never
      // existed.
      //
      // This route resolves no provider of its own — dispatch has never needed
      // one, and the guard is written to keep that true: every non-definitive
      // outcome allows (see lib/dispatch-referent-guard.js). The added
      // resolution is diagnostic-safe; `resolveProviderAccess`'s
      // `recordCredentialResolution` is explicitly read by nothing downstream.
      // Skipped for aborts/cascades so a cancel can never be blocked by a
      // dangling referent.
      if (!isAbort && issueIdentifier) {
        const { token: referentToken, provider: referentProvider } =
          await resolveProviderAccess(req.proxyUrlKey, req.proxyCreatedBy, req);
        if (await isDanglingReferent({ provider: referentProvider, token: referentToken, issueIdentifier })) {
          logEvent(req, '/api/proxy/dispatch', 422, `${ISSUE_NOT_FOUND_CODE} ${issueIdentifier}`);
          return jsonError(res, 422, DANGLING_REFERENT_MESSAGE, {
            code: ISSUE_NOT_FOUND_CODE,
            issueIdentifier,
          });
        }
      }

      // Auto-append the proxy context (workspace API access + reporting channel) by
      // default, so the worker can both read context and report its result.
      // Opt out with appendProxyContext:false (e.g. a self-contained prompt).
      const { appendProxyContext } = req.body || {};
      let finalPrompt = prompt;
      // Follow-up beats (LIN-805): a followUpTo resumes a warm session that already
      // received the proxy-context block on its FIRST beat, so re-appending it on
      // every later beat is redundant and risks confusing the worker. Default the
      // append OFF when followUpTo is set; an explicit appendProxyContext:true still
      // opts back in. Fresh dispatches keep the default-ON behaviour (opt out with
      // appendProxyContext:false). This is the systemic fix — every follow-up
      // consumer benefits, not just one orchestrator. (`/recommend-and-dispatch`
      // accepts no followUpTo, so it needs no equivalent suppression.)
      //
      // LIN-1429: this suppression governs the PROSE APPEND only. Whether a
      // credential is PROVISIONED is now a separate decision, keyed on the resolved
      // harness (see finalizePrompt below) — the follow-up default here means "don't
      // repeat the prose", never "don't mint a credential". Conflating the two was
      // the LIN-1429 bug: a broker-dependent (claude-code/MCP) follow-up needs a
      // live credential even when the prose is (correctly) suppressed, because the
      // original credential died with the window that held it (LIN-1375/1362).
      const isFollowUp = followUpTo !== undefined && followUpTo !== null;
      // The caller's own explicit instruction. Distinct from isFollowUp: an opt-out
      // means "I don't want proxy context"; a follow-up default means only "I
      // already have it".
      const explicitOptOut = appendProxyContext === false;
      // Prose append: unchanged (LIN-805).
      const shouldAppendProxyContext = isFollowUp
        ? appendProxyContext === true
        : !explicitOptOut;

      // Create the dispatch item through the shared factory (LIN-1139): it
      // resolves kind, fills blank model/harness from workspace dispatchDefaults
      // (LIN-1099), interposes the default harness (LIN-1159), and calls addItem.
      // The proxy-context ordering constraint (LIN-1155 — harness resolved BEFORE
      // the append, because attachProxyContext gates its MCP-token-vs-prose branch
      // on the resolved harness) is preserved by the finalizePrompt(resolvedHarness)
      // callback: the factory hands it the resolved harness, it runs the append,
      // and returns { prompt, bootstrapToken } to carry on the item. An abort item
      // carries no prompt, so the append stays guarded on prompt presence (LIN-743).
      const item = await createDispatchItem({
        store: dispatchQueueStore,
        urlKey: req.proxyUrlKey,
        workspacePreferencesStore,
        kind,
        model,
        harness,
        terminal,
        effort,
        finalizePrompt: async (resolvedHarness) => {
          const baseUrl = `${req.protocol}://${req.get('host')}`;
          if (prompt && shouldAppendProxyContext) {
            // LIN-376: embed a fresh single-use bootstrap, never the caller's own token.
            // LIN-1155: claude-code harness -> token stripped from prose, returned here.
            return attachProxyContext({
              proxyTokenStore,
              urlKey: req.proxyUrlKey,
              baseUrl,
              issueIdentifier: issueIdentifier || null,
              prompt,
              label: 'dispatch-bootstrap',
              harness: resolvedHarness,
              createdBy: req.proxyCreatedBy || null,
              // LIN-2354: only resolved when the dangling-referent guard above ran
              // resolveProviderAccess (`!isAbort && issueIdentifier`), stamping
              // req.resolvedProvider — an unscoped dispatch resolves no provider
              // and correctly stays neutral rather than triggering a fresh resolve.
              providerDisplayName: declaredProviderDisplayName(req)
            });
          }
          // LIN-1429: the prose block may be suppressed for a warm follow-up
          // (LIN-805), but a broker-dependent harness still needs a LIVE
          // credential — the original died with the window that held it
          // (LIN-1375/1362). Provision without appending. Keyed on the RESOLVED
          // harness, never on isFollowUp.
          if (prompt && !explicitOptOut && shouldUseMcpTokenField(resolvedHarness)) {
            const bootstrapToken = await provisionBootstrapToken({
              proxyTokenStore,
              urlKey: req.proxyUrlKey,
              baseUrl,
              label: 'dispatch-bootstrap',
              harness: resolvedHarness,
              createdBy: req.proxyCreatedBy || null
            });
            return { prompt: finalPrompt, bootstrapToken };
          }
          return { prompt: finalPrompt, bootstrapToken: null };
        },
        fields: {
          promptName: promptName || 'Prompt',
          issueId: issueId || null,
          issueIdentifier: issueIdentifier || null,
          issueTitle: issueTitle || null,
          issueUrl: issueUrl || null,
          dispatchedBy: req.proxyCreatedBy || null,
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
          subscription: subscriptionResolved
        }
      });

      logEvent(req, '/api/proxy/dispatch', 201);
      res.status(201).json({
        success: true,
        id: item._id,
        status: 'queued',
        promptName: item.promptName,
        kind: item.kind,
        issueIdentifier: item.issueIdentifier,
        target: item.target,
        abort: item.abort === true,
        abortTo: item.abortTo || null,
        cascade: item.cascade === true,
        sessionId: item.sessionId || null,
        dispatchedAt: item.dispatchedAt?.toISOString?.() || item.dispatchedAt
      });
    } catch (err) {
      // Duplicate-dispatch refusal (LIN-1656) — see the responder. Ahead of the
      // generic 500 so an orchestrator can branch on `code` and adopt the `id`.
      if (refuseIfDuplicateDispatch(err, req, res, '/api/proxy/dispatch')) return;
      // Task-budget refusal (LIN-1751) — see the responder.
      if (refuseIfBudgetExhausted(err, req, res, '/api/proxy/dispatch')) return;
      // Fail closed on a missing out-of-band token (LIN-1175) — see kickoff catch.
      if (err && err.proxyAttachFailed) {
        logEvent(req, '/api/proxy/dispatch', 503);
        return jsonError(res, 503, PROXY_ATTACH_FAILED_MESSAGE);
      }
      logEvent(req, '/api/proxy/dispatch', 500);
      console.error('Proxy dispatch error:', err.message);
      jsonError(res, 500, 'Failed to dispatch prompt');
    }
  });

  /**
   * POST /api/proxy/recommend-and-dispatch
   * Fused verb (LIN-321): run /recommend and forward the recommended prompt
   * straight into a dispatch, SERVER-SIDE, returning only the task header.
   * The prompt body never reaches the caller, so the orchestrator's context-
   * economy rule (autopilot invariant 4) becomes mechanical instead of a rule
   * it must remember. `kind` is derived from the recommendation's own action
   * signal — no need to read the prompt to classify the task.
   *
   * Optional verb override (LIN-573): when the caller supplies `kind` (a
   * PROMPT_TEMPLATES key), the LLM recommendation + descent is bypassed and the
   * body is generated deterministically for the NAMED issue with that template —
   * "autopilot picks the verb, never the words." The body is still server-
   * generated and never returned; only the verb key is caller-supplied. Omitting
   * `kind` leaves the original LLM-driven behaviour byte-identical.
   *
   * `periodicalId` (LIN-1825/LIN-2385): optional periodical-template join key,
   * registry-validated exactly like `POST /api/proxy/dispatch`'s field of the
   * same name. Stamped onto BOTH `createDispatchItem` fields blocks below —
   * the verb-override branch AND the recommendation-derived one — because
   * this fused verb, not `POST /dispatch`, is what every autopilot loop
   * actually calls to continue a tracked task (see `lib/prompts/
   * autopilot-kickoff.js`'s "Trigger the next step"), and the normal trigger
   * carries no `kind`, landing on the recommendation-derived branch.
   */
  router.post('/api/proxy/recommend-and-dispatch', proxyLimiter, authenticateProxyToken, requireWriteScope, async (req, res) => {
    if (!dispatchQueueStore) {
      logEvent(req, '/api/proxy/recommend-and-dispatch', 503);
      return jsonError(res, 503, 'Dispatch is not available');
    }

    try {
      const { issueIdentifier, target, repo, repoInherited, model, harness, effort, appendProxyContext, noDescend, kind, sessionId, waitForFollowUps, queueIfBusy, subscription, periodicalId } = req.body || {};

      // Validate caller-supplied inputs. (Only the server-generated prompt skips
      // the dangerous-char/length checks — see the dispatch step below.)
      if (!issueIdentifier || typeof issueIdentifier !== 'string') {
        logEvent(req, '/api/proxy/recommend-and-dispatch', 400);
        return badRequest.json(res, 'issueIdentifier is required and must be a string');
      }
      if (!isValidIssueId(issueIdentifier)) {
        logEvent(req, '/api/proxy/recommend-and-dispatch', 400);
        return badRequest.json(res, 'Invalid identifier format');
      }
      if (target !== undefined && !VALID_PROXY_DISPATCH_TARGETS.includes(target)) {
        logEvent(req, '/api/proxy/recommend-and-dispatch', 400);
        return badRequest.json(res, `target must be one of: ${VALID_PROXY_DISPATCH_TARGETS.join(', ')}`);
      }
      if (noDescend !== undefined && typeof noDescend !== 'boolean') {
        logEvent(req, '/api/proxy/recommend-and-dispatch', 400);
        return badRequest.json(res, 'noDescend must be a boolean');
      }
      // Opt-in completion hold (LIN-797): boolean, default false. Threaded through
      // to the dispatched item and forwarded blindly — the runner owns the behaviour.
      if (waitForFollowUps !== undefined && typeof waitForFollowUps !== 'boolean') {
        logEvent(req, '/api/proxy/recommend-and-dispatch', 400);
        return badRequest.json(res, 'waitForFollowUps must be a boolean');
      }
      // Push-based inter-session comms (LIN-826): stored + forwarded blindly,
      // exactly like waitForFollowUps. queueIfBusy is never defaulted here (it is
      // Harbour-set only on the auto-enqueued wake follow-up); subscription is a
      // declared enum (LIN-900 §6) that defaults to `terminal-only` when omitted.
      if (queueIfBusy !== undefined && typeof queueIfBusy !== 'boolean') {
        logEvent(req, '/api/proxy/recommend-and-dispatch', 400);
        return badRequest.json(res, 'queueIfBusy must be a boolean');
      }
      if (subscription !== undefined && !isValidSubscription(subscription)) {
        logEvent(req, '/api/proxy/recommend-and-dispatch', 400);
        return badRequest.json(res, `subscription must be one of: ${SUBSCRIPTION_LEVELS.join(', ')}`);
      }
      const recommendRepoValidationError = validateOpaqueDispatchField(repo, 'repo', {
        maxLength: MAX_NAME_LENGTH,
        reportReceivedLength: true,
      });
      if (recommendRepoValidationError) {
        logEvent(req, '/api/proxy/recommend-and-dispatch', 400);
        return badRequest.json(res, recommendRepoValidationError.error);
      }
      // Inherited-repo marker (LIN-1210): when true, `repo` was merely inherited
      // (e.g. an autopilot orchestrator forwarding a parent project's repo onto a
      // cross-project child fan-out), NOT deliberately chosen for THIS dispatch, so
      // the server-derived child/node repo wins over it (see resolveDispatchRepo).
      // Default false keeps the LIN-537 explicit-caller-repo precedence byte-for-byte.
      if (repoInherited !== undefined && typeof repoInherited !== 'boolean') {
        logEvent(req, '/api/proxy/recommend-and-dispatch', 400);
        return badRequest.json(res, 'repoInherited must be a boolean');
      }
      // Execution model + harness (LIN-438, LIN-1084): opaque strings, validated
      // via the shared helper (length + dangerous-chars). NOT a generation-model
      // registry check — these are the consumer's execution-model/harness fields.
      const recommendModelValidationError = validateOpaqueDispatchField(model, 'model', { maxLength: MAX_NAME_LENGTH });
      if (recommendModelValidationError) {
        logEvent(req, '/api/proxy/recommend-and-dispatch', 400);
        return badRequest.json(res, recommendModelValidationError.error);
      }
      const recommendHarnessValidationError = validateOpaqueDispatchField(harness, 'harness', { maxLength: MAX_NAME_LENGTH });
      if (recommendHarnessValidationError) {
        logEvent(req, '/api/proxy/recommend-and-dispatch', 400);
        return badRequest.json(res, recommendHarnessValidationError.error);
      }
      // Effort (LIN-2615): same opaque rule, own inline check since this route
      // validates model/harness itself rather than through validateDispatchPayload.
      // An out-of-set level is a console.warn only, never a 400.
      const recommendEffortValidationError = validateOpaqueDispatchField(effort, 'effort', { maxLength: MAX_NAME_LENGTH });
      if (recommendEffortValidationError) {
        logEvent(req, '/api/proxy/recommend-and-dispatch', 400);
        return badRequest.json(res, recommendEffortValidationError.error);
      }
      if (effort && !DISPATCH_EFFORT_LEVELS.includes(effort)) {
        console.warn(`Unknown dispatch effort level: ${effort}`);
      }
      // Optional verb override (LIN-573). When present, the caller pins the step
      // and the server still writes the body — "autopilot picks the verb, never
      // the words." Validate with hasPrompt() (PROMPT_TEMPLATES keys only), NOT
      // isValidDispatchKind(): the latter admits body-less meta-kinds (defer/
      // custom/autopilot/periodical) that have no generate() and would dispatch
      // an empty prompt. The caller never supplies prompt text — only the key.
      if (kind !== undefined && (typeof kind !== 'string' || !hasPrompt(kind))) {
        logEvent(req, '/api/proxy/recommend-and-dispatch', 400);
        return badRequest.json(res, `kind must be a valid prompt template key: ${Object.keys(PROMPT_TEMPLATES).join(', ')}`);
      }
      // Periodical-template join key (LIN-1825/LIN-2385): registry-membership
      // check, mirroring POST /api/proxy/dispatch's identical guard above and
      // routes/dispatch.js's. This is the fused verb every autopilot loop
      // actually uses to continue a tracked task, so it needs the same
      // stamping capability POST /dispatch already has (LIN-2385 B1) — without
      // it, a periodical's Stage-2 batch/lane dispatch has no way to stamp
      // `periodicalId` on the verb it actually takes.
      if (periodicalId !== undefined && !getPeriodicals().map(p => p.id).includes(periodicalId)) {
        logEvent(req, '/api/proxy/recommend-and-dispatch', 400);
        return badRequest.json(res, 'periodicalId must be one of the known periodical template ids');
      }
      // Autopilot session reference (LIN-591): the autopilot dispatchId that is
      // driving this run, stamped onto the spawned worker so the dashboard can
      // reconstruct the session. This is the verb the autopilot actually drives,
      // so it is the important one. Optional opaque string (LIN-1118, was
      // UUID-only); stored + forwarded blindly, no target restriction (sessions
      // span all targets).
      const recommendSessionIdError = validateSessionId(sessionId);
      if (recommendSessionIdError) {
        logEvent(req, '/api/proxy/recommend-and-dispatch', 400);
        return badRequest.json(res, recommendSessionIdError.error);
      }

      // Resolve the subscription edge once for both dispatch paths below (LIN-900
      // §6): DECLARED on the edge, never reconstructed from `sessionId`. An
      // undeclared edge is `terminal-only` — the old `!!sessionId` default-on is
      // removed (§6 forbids inferring subscription from incidental fields). A
      // caller that wants a worker's every event to wake it declares
      // `subscription: 'everything'`.
      const subscriptionResolved = subscription ?? DEFAULT_SUBSCRIPTION;

      // Recommendation preconditions — identical to GET /recommend.
      const { token: accessToken, reason, provider } = await resolveProviderAccess(req.proxyUrlKey, req.proxyCreatedBy, req);
      // LIN-1980: stamp before any other logic (incl. the !accessToken early
      // return below) so the fingerprint is present even when this request
      // later 401s from a shared credential another site marked suspect.
      if (!accessToken) {
        return workspaceUnavailable(req, res, '/api/proxy/recommend-and-dispatch', reason);
      }
      // Two capability-gated fetchers can serve this route — see the matching
      // comment on GET /recommend above.
      if (denyIfUnsupported(provider, 'fetchIssueContext', req, res, '/api/proxy/recommend-and-dispatch')) return;
      if (denyIfUnsupported(provider, 'fetchRecommendationContext', req, res, '/api/proxy/recommend-and-dispatch')) return;
      const isTestMode = process.env.NODE_ENV === 'test' && accessToken === 'test-token';

      // ── Verb-override path (LIN-573) ──────────────────────────────────────
      // When the caller pins `kind`, skip the LLM recommendation + descent
      // entirely: fetch the named issue's context, generate the body
      // deterministically with the chosen template key, and dispatch with that
      // override kind. The wobble this fixes is the *verb*, not the *target*, so
      // the override pins the named issue with NO descent. It is purely
      // deterministic (no OpenRouter call), so it bypasses the LLM-config gate
      // and free-tier metering below. provider?.ui is threaded through (LIN-2353);
      // Linear output stays byte-identical to the /prompt endpoint since its ui
      // is the DEFAULT_PROMPT_UI floor.
      if (kind !== undefined) {
        let ctx;
        try {
          ctx = await resolvePromptIssueContext(provider, accessToken, issueIdentifier, isTestMode);
        } catch (err) {
          if (err.message?.includes('not found')) {
            logEvent(req, '/api/proxy/recommend-and-dispatch', 404);
            return notFound.json(res, 'Issue not found');
          }
          throw err;
        }
        if (!ctx) {
          logEvent(req, '/api/proxy/recommend-and-dispatch', 404);
          return notFound.json(res, 'Issue not found');
        }

        const { issue, parent, siblings, project, children, comments, attachments } = ctx;
        // Forward `attachments` (LIN-776): the verb-override dispatch path must
        // surface the same Attachments section as the LLM recommend-and-dispatch
        // path, which already passes the full context. provider?.ui is threaded
        // through (LIN-2353) so a non-Linear provider renders capability-appropriate
        // text; Linear output stays byte-identical.
        const generated = generatePrompt(kind, issue, { parent, siblings, project, children, comments, attachments }, {}, provider?.ui || null);
        if (!generated) {
          logEvent(req, '/api/proxy/recommend-and-dispatch', 500);
          return jsonError(res, 500, 'Failed to generate prompt');
        }

        // The body is server-generated/trusted, so it skips the dangerous-char /
        // length checks the caller-supplied POST /dispatch path runs, and is
        // never returned to the caller — same contract as the LLM-driven path.
        try {
          // Create the dispatch item through the shared factory (LIN-1139): it
          // resolves model/harness from workspace dispatchDefaults (LIN-1099;
          // `kind` is guaranteed set on this verb-override branch), interposes the
          // default harness (LIN-1159), and calls addItem. The proxy-context append
          // runs inside finalizePrompt AFTER the harness is resolved (LIN-1155), so
          // it can gate its MCP-token-vs-prose branch on it and hand back the
          // bootstrapToken to carry as a field. Opt out with appendProxyContext:false.
          const item = await createDispatchItem({
            store: dispatchQueueStore,
            urlKey: req.proxyUrlKey,
            workspacePreferencesStore,
            kind,
            model,
            harness,
            effort,
            finalizePrompt: async (resolvedHarness) => {
              if (appendProxyContext !== false) {
                const baseUrl = `${req.protocol}://${req.get('host')}`;
                // LIN-376: embed a fresh single-use bootstrap, never the caller's own token.
                // LIN-1155: claude-code harness -> token stripped from prose, returned here.
                return attachProxyContext({
                  proxyTokenStore,
                  urlKey: req.proxyUrlKey,
                  baseUrl,
                  issueIdentifier,
                  prompt: generated.prompt,
                  label: 'dispatch-bootstrap',
                  harness: resolvedHarness,
                  createdBy: req.proxyCreatedBy || null,
                  // LIN-2354: resolveProviderAccess runs unconditionally near the
                  // top of this route, so req.resolvedProvider is always stamped
                  // here.
                  providerDisplayName: declaredProviderDisplayName(req)
                });
              }
              return { prompt: generated.prompt, bootstrapToken: null };
            },
            fields: {
              promptName: generated.name || getPromptDisplayName(kind),
              issueId: null,
              issueIdentifier,
              issueTitle: null,
              issueUrl: null,
              dispatchedBy: req.proxyCreatedBy || null,
              target: target || 'cli',
              // Mirror /prompt's repo resolution: project `repo=` from the
              // description, with an explicit caller repo winning (LIN-537). When
              // the caller marks its repo as inherited (LIN-1210), the named node's
              // own project repo wins over it instead (repoInherited: true).
              repo: resolveDispatchRepo(repo, parseRepoFromDescription(project?.description), { inherited: repoInherited === true }),
              sessionId: sessionId || null,
              // Periodical-template join key (LIN-1825/LIN-2385): validated above.
              periodicalId: periodicalId || null,
              // Push-comms: `subscription` is the declared edge (LIN-900 §6),
              // `terminal-only` unless the caller declares `everything`; queueIfBusy
              // forwarded blindly. Both stored + forwarded, no Harbour-side semantics.
              queueIfBusy: queueIfBusy === true,
              subscription: subscriptionResolved
            }
          });

          // Record the override so it can feed heuristic improvement — the
          // engine's verb was demonstrably wrong here (LIN-573). The distinct
          // endpoint tag keeps these auditable in the proxy event log.
          logEvent(req, `/api/proxy/recommend-and-dispatch (override:${kind})`, 201);
          return res.status(201).json({
            success: true,
            id: item._id,
            status: 'queued',
            kind: item.kind,
            promptName: item.promptName,
            issueIdentifier: item.issueIdentifier,
            target: item.target,
            sessionId: item.sessionId || null,
            dispatchedAt: item.dispatchedAt?.toISOString?.() || item.dispatchedAt,
            // The override pins the named issue with no descent — surface that
            // explicitly so callers can distinguish it from the LLM-driven path.
            override: true
          });
        } catch (err) {
          // Duplicate-dispatch refusal (LIN-1656). This is the verb-OVERRIDE arm,
          // which creates its dispatch BEFORE `armKeepalive` runs, so it replies on
          // plain `res` — no keepalive to thread. (The LLM arm below is armed and
          // must pass one.)
          if (refuseIfDuplicateDispatch(err, req, res, '/api/proxy/recommend-and-dispatch')) return;
          // Task-budget refusal (LIN-1751) — same plain-`res` arm as above.
          if (refuseIfBudgetExhausted(err, req, res, '/api/proxy/recommend-and-dispatch')) return;
          // Fail closed on a missing out-of-band token (LIN-1175) — see kickoff catch.
          if (err && err.proxyAttachFailed) {
            logEvent(req, '/api/proxy/recommend-and-dispatch', 503);
            return jsonError(res, 503, PROXY_ATTACH_FAILED_MESSAGE);
          }
          // LIN-2260: classify an upstream provider-auth failure the same way
          // the read path (and GET /recommend via recommendErrorResponse)
          // already does, instead of collapsing every non-classified throw
          // into an opaque 500 — graphqlErrorStatus() falls back to 500 for
          // anything it doesn't recognize, so a genuinely internal failure is
          // unchanged.
          const status = graphqlErrorStatus(err, req);
          logEvent(req, '/api/proxy/recommend-and-dispatch', status);
          console.error('Proxy recommend-and-dispatch override error:', err.message);
          return jsonError(res, status, 'Failed to dispatch prompt', { detail: graphqlErrorDetail(err, req), ...graphqlErrorExtra(err, status) });
        }
      }

      const sessionApiKey = await getWorkspaceOpenRouterKey(req.proxyUrlKey, req.proxyCreatedBy);
      // A free-tier-only deployment is accepted via isFreeTier. computeRecommendation
      // resolves the effective key per hop; here we only gate and meter.
      const { isFreeTier } = resolveProxyLLM(sessionApiKey);
      if (!isTestMode && !isRecommendationEnabled(sessionApiKey) && !isFreeTier) {
        logEvent(req, '/api/proxy/recommend-and-dispatch', 503);
        return jsonError(res, 503, 'AI recommendations not configured. Connect OpenRouter via OAuth or set OPENROUTER_API_KEY on the server.');
      }

      // LIN-1458: witness which credential source served this request.
      if (!isTestMode) {
        logOpenRouterCredentialSource(req, '/api/proxy/recommend-and-dispatch', { sessionApiKey, isFreeTier });
      }

      // Charge one free-tier unit ONCE per request (not per descent hop). Charge
      // before resolveRecommendation so an exhausted user gets a clean 429.
      if (isFreeTier && !isTestMode) {
        const rejection = await chargeFreeTierOrReject(req, '/api/proxy/recommend-and-dispatch');
        if (rejection) {
          logEvent(req, '/api/proxy/recommend-and-dispatch', 429);
          return res.status(rejection.status).json(rejection.body);
        }
      }

      // /recommend is slow (Linear + OpenRouter) — arm keepalive before computing.
      const keepalive = armKeepalive(res);

      let rec, deferredVia, deferTruncated, deferStopReason;
      try {
        // Resolve `defer` to a terminal actionable node server-side (LIN-329) so
        // Autopilot can fire this verb on ANY task — node or leaf — and get the
        // actionable descendant's prompt + kind, never a `defer` to act on.
        const recommendDeadline = Date.now() + RECOMMEND_DESCENT_BUDGET_MS;
        ({ recommendation: rec, deferredVia, deferTruncated, deferStopReason } = await resolveRecommendation({
          startIdentifier: issueIdentifier,
          deadline: recommendDeadline,
          // noDescend (LIN-365): dispatch the named node's OWN work, never an open child.
          noDescend: noDescend === true,
          computeOne: (id) => computeRecommendation({
            urlKey: req.proxyUrlKey,
            createdBy: req.proxyCreatedBy,
            identifier: id,
            accessToken,
            provider,
            isTestMode,
            sessionApiKey,
            deadline: recommendDeadline,
            noDescend: noDescend === true
          })
        }));
      } catch (err) {
        keepalive.stop();
        const { status, body } = recommendErrorResponse(err, req);
        logEvent(req, '/api/proxy/recommend-and-dispatch', status);
        return keepalive.send(status, body);
      }

      // The descent should always terminate on a real action carrying a prompt.
      // If it stopped abnormally (depth cap / cycle / unresolved child / timeout)
      // it may have halted on a `defer` with no prompt — surface that anomaly
      // rather than dispatching an empty prompt. `defer` must never reach dispatch.
      if (rec.recommendedAction === 'defer' || !rec.prompt) {
        keepalive.stop();
        logEvent(req, '/api/proxy/recommend-and-dispatch', 422);
        return keepalive.send(422, {
          error: 'Recommendation did not resolve to an actionable task',
          deferredVia,
          deferTruncated,
          deferStopReason
        });
      }

      try {
        // The recommended prompt is server-generated/trusted, so we forward it
        // verbatim and intentionally SKIP the DANGEROUS_CHARS/length checks the
        // caller-supplied POST /dispatch path runs. The prompt body is never
        // returned to the caller — that is the whole point of this verb.
        // The dispatched item references the TERMINAL actionable node (rec.identifier),
        // not the parent the caller named — the worker should inherit context for the
        // task it is actually working on (LIN-327). For a leaf these are identical.
        const terminalIdentifier = rec.identifier || issueIdentifier;

        // kind provenance: parseRecommendedAction (in computeRecommendation) →
        // recommendedAction → deriveDispatchKind → BOTH the stored item's kind
        // and the response kind (same value); falls back to 'custom' when the
        // action can't be parsed.
        const effectiveKind = deriveDispatchKind(rec.recommendedAction);

        // Create the dispatch item through the shared factory (LIN-1139): it
        // resolves model/harness from workspace dispatchDefaults (LIN-1099, keyed
        // on the recommendation-derived effectiveKind), interposes the default
        // harness (LIN-1159), and calls addItem. The proxy-context append runs
        // inside finalizePrompt AFTER the harness is resolved (LIN-1155), so it can
        // gate its MCP-token-vs-prose branch on it and hand back the bootstrapToken
        // to carry as a field. Opt out with appendProxyContext:false.
        const item = await createDispatchItem({
          store: dispatchQueueStore,
          urlKey: req.proxyUrlKey,
          workspacePreferencesStore,
          kind: effectiveKind,
          model,
          harness,
          effort,
          finalizePrompt: async (resolvedHarness) => {
            if (appendProxyContext !== false) {
              const baseUrl = `${req.protocol}://${req.get('host')}`;
              // LIN-376: embed a fresh single-use bootstrap, never the caller's own token.
              // LIN-1155: claude-code harness -> token stripped from prose, returned here.
              return attachProxyContext({
                proxyTokenStore,
                urlKey: req.proxyUrlKey,
                baseUrl,
                issueIdentifier: terminalIdentifier,
                prompt: rec.prompt,
                label: 'dispatch-bootstrap',
                harness: resolvedHarness,
                createdBy: req.proxyCreatedBy || null,
                // LIN-2354: resolveProviderAccess runs unconditionally near the
                // top of this route, so req.resolvedProvider is always stamped
                // here.
                providerDisplayName: declaredProviderDisplayName(req)
              });
            }
            return { prompt: rec.prompt, bootstrapToken: null };
          },
          fields: {
            promptName: rec.recommendedAction || 'Prompt',
            issueId: null,
            issueIdentifier: terminalIdentifier,
            issueTitle: null,
            issueUrl: null,
            dispatchedBy: req.proxyCreatedBy || null,
            target: target || 'cli',
            // Inherit the server-resolved repo (terminal node's project `repo=`)
            // when the caller omits one; an explicit caller repo still wins. repo
            // is functional execution context (working directory), so this fused
            // verb must propagate it, not just the display header fields (LIN-537).
            // On a cross-project descent the terminal child's repo (rec.repo) also
            // wins over a merely *inherited* caller repo (repoInherited: true), so
            // the worker runs in the child project's repo, not the parent's (LIN-1210).
            repo: resolveDispatchRepo(repo, rec.repo, { inherited: repoInherited === true }),
            sessionId: sessionId || null,
            // Periodical-template join key (LIN-1825/LIN-2385): validated above.
            // This is the branch autopilot actually takes on the normal
            // Stage-2-opening trigger (no `kind` override) — see the route's
            // own doc comment above for why both fields blocks must carry it.
            periodicalId: periodicalId || null,
            // Opt-in completion hold (LIN-797), forwarded blindly to the runner.
            waitForFollowUps: waitForFollowUps === true,
            // Push-comms: `subscription` is the declared edge (LIN-900 §6),
            // `terminal-only` unless the caller declares `everything`; queueIfBusy
            // forwarded blindly. Both stored + forwarded, no Harbour-side semantics.
            queueIfBusy: queueIfBusy === true,
            subscription: subscriptionResolved
          }
        });

        keepalive.stop();
        logEvent(req, '/api/proxy/recommend-and-dispatch', 201);
        // Task header ONLY — no prompt body. deferredVia + descent are additive
        // (LIN-327): they let Autopilot read the descent ("LIN-318 → LIN-297
        // (research) · dispatched") from the structured header, never a prompt body.
        const descent = describeDescent(deferredVia, rec);
        keepalive.send(201, {
          success: true,
          id: item._id,
          status: 'queued',
          kind: item.kind,
          promptName: item.promptName,
          issueIdentifier: item.issueIdentifier,
          target: item.target,
          sessionId: item.sessionId || null,
          dispatchedAt: item.dispatchedAt?.toISOString?.() || item.dispatchedAt,
          deferredVia,
          deferTruncated,
          ...(descent ? { descent: `${descent} · dispatched` } : {})
        });
      } catch (err) {
        keepalive.stop();
        // Duplicate-dispatch refusal (LIN-1656). Keepalive is ARMED on this arm, so
        // the refusal must ride `keepalive.send` — if the 25s flush already fired,
        // the 200 is committed and the real 409 travels as `statusCode` in the body
        // (same contract as the 503 below). The responder also skips the
        // `Retry-After` header once headers are sent.
        if (refuseIfDuplicateDispatch(err, req, res, '/api/proxy/recommend-and-dispatch', keepalive)) return;
        // Task-budget refusal (LIN-1751) — same keepalive-armed arm as above.
        if (refuseIfBudgetExhausted(err, req, res, '/api/proxy/recommend-and-dispatch', keepalive)) return;
        // Fail closed on a missing out-of-band token (LIN-1175) — see kickoff catch.
        if (err && err.proxyAttachFailed) {
          logEvent(req, '/api/proxy/recommend-and-dispatch', 503);
          return keepalive.send(503, { error: PROXY_ATTACH_FAILED_MESSAGE });
        }
        // LIN-2260: classify an upstream provider-auth failure (retryable
        // 503/LINEAR_AUTH) the same way GET /recommend's recommendErrorResponse
        // already does, instead of collapsing every non-classified throw into
        // an opaque 500 — graphqlErrorStatus() falls back to 500 for anything
        // it doesn't recognize, so a genuinely internal failure is unchanged.
        const status = graphqlErrorStatus(err, req);
        logEvent(req, '/api/proxy/recommend-and-dispatch', status);
        console.error('Proxy recommend-and-dispatch error:', err.message);
        keepalive.send(status, { error: 'Failed to dispatch prompt', detail: graphqlErrorDetail(err, req), ...graphqlErrorExtra(err, status) });
      }
    } catch (err) {
      // LIN-2260: same classification as the inner catch arms above — this
      // outer catch-all fronts every non-classified throw the two arms didn't
      // already handle (e.g. a failure before `kind` is known which arm to run).
      const status = graphqlErrorStatus(err, req);
      logEvent(req, '/api/proxy/recommend-and-dispatch', status);
      console.error('Proxy recommend-and-dispatch error:', err.message);
      jsonError(res, status, 'Failed to dispatch prompt', { detail: graphqlErrorDetail(err, req), ...graphqlErrorExtra(err, status) });
    }
  });

  /**
   * GET /api/proxy/dispatch
   * List the workspace's dispatch items across both the live queue (status
   * 'queued') and recent history (taken/cancelled/expired, with feedback),
   * newest first. Lets the orchestrator discover its own in-flight items
   * without having to remember every id it dispatched. Optional filters:
   *   ?issueIdentifier=LIN-42   exact match on the issue identifier
   *   ?status=queued|taken|...  exact match on lifecycle status
   *   ?limit=N                  cap (default 20, max 100)
   */
  router.get('/api/proxy/dispatch', proxyLimiter, authenticateProxyToken, async (req, res) => {
    if (!dispatchQueueStore) {
      logEvent(req, '/api/proxy/dispatch', 503);
      return jsonError(res, 503, 'Dispatch is not available');
    }

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);

    let issueIdentifier = null;
    if (req.query.issueIdentifier !== undefined) {
      issueIdentifier = String(req.query.issueIdentifier);
      if (issueIdentifier.length > MAX_IDENTIFIER_LENGTH || DANGEROUS_CHARS_REGEX.test(issueIdentifier)) {
        logEvent(req, '/api/proxy/dispatch', 400);
        return badRequest.json(res, 'Invalid issueIdentifier');
      }
    }

    let statusFilter = null;
    if (req.query.status !== undefined) {
      statusFilter = String(req.query.status);
      if (statusFilter.length > MAX_NAME_LENGTH || DANGEROUS_CHARS_REGEX.test(statusFilter)) {
        logEvent(req, '/api/proxy/dispatch', 400);
        return badRequest.json(res, 'Invalid status');
      }
    }

    try {
      // Live queue (still 'queued') + resolved history (with feedback), merged.
      // When scoped to one issue, push `issueIdentifier` into both store reads
      // (LIN-613/LIN-615 index-backed predicate) instead of fetching the whole
      // workspace and filtering in JS. The 200-history bound is preserved.
      //
      // This list response is metadata-only — it never returns `prompt`, only
      // status/feedback-derived fields. So exclude `prompt` at the query (the
      // LIN-623 lean-feed pattern): for an unscoped read the whole-workspace
      // 30-day history carries a multi-KB-to-10-MB prompt per row, and
      // transferring + BSON-deserialising all of them is what pushes a busy
      // workspace's read past the 30s router timeout into a 503. Column
      // exclusion only — same rows, correctness-identical.
      const scopeOpts = issueIdentifier ? { issueIdentifier } : {};
      const [queued, history] = await Promise.all([
        dispatchQueueStore.listItems(req.proxyUrlKey, { ...scopeOpts, projection: { prompt: 0 } }),
        dispatchQueueStore.listHistory(req.proxyUrlKey, { limit: 200, ...scopeOpts, projection: { prompt: 0 } })
      ]);

      const merged = [
        ...queued.map(i => ({ ...i, status: 'queued', feedback: [] })),
        ...history.items
      ];

      // LIN-1470: lineage join. A repoint (follow-up dispatch) mints a NEW row;
      // without this, the original row's feedbackCount/completedAt/status freeze
      // at the point of repoint. Derive each row's lineage anchor per the pinned
      // two-tier precedence — doc-level rootItemId, then the first OWN feedback
      // entry carrying rootItemId, then the row's own id — and batch-fetch every
      // OTHER row sharing an anchor in ONE indexed query (constant in N: 2 reads
      // above + 1 here, never 2+N). NEVER sessionId/sessionGroupId: every worker
      // an autopilot spawns shares its orchestrator's sessionId, so grouping on
      // it would collapse all siblings onto one anchor and reinstate the
      // LIN-1461 production bug. Anchors are null-filtered before the $in query
      // ($in: [null] would mass-mis-group every field-less legacy row); the
      // `?? row.id` fallback means this is defensive rather than reachable today.
      // History-only (queued rows carry no feedback) and deliberately NOT scoped
      // by issueIdentifier — rootItemId already isolates the lineage, and
      // inheriting the issue scope would drop siblings filed under a different
      // issue. `projection: {prompt: 0}` preserved (the H12/503 read-cost guard).
      const anchorFor = item => item.rootItemId ?? item.feedback?.find(f => f.rootItemId)?.rootItemId ?? item.id;

      // LIN-1470 (review F1): only rows that actually RAN join the lineage —
      // i.e. `status === 'taken'`, not merely "not queued". `_archiveItem` is
      // called with exactly three statuses (`taken` dispatch-store.js:678,
      // `cancelled` :635, `expired` :715), so a `!== 'queued'` denylist also
      // swept in cancelled/expired rows, which then inherited a sibling's
      // terminal feedback: a cancelled/expired follow-up reported `done`/a
      // completedAt it never earned, and was routed into `?status=done` while
      // vanishing from `?status=cancelled`/`?status=expired`. The eligible set
      // is exactly the rows that ran, so this is an allowlist, not an
      // extended denylist — it needs no future enumeration as new archived
      // statuses can't be added without also adding an `_archiveItem` call
      // site. Queued rows still opt out for the original beat-4 reason: a
      // still-queued row (e.g. a follow-up reply to a finished session,
      // queued but not yet run) must not inherit an already-completed
      // sibling's terminal feedback. Mirrors the existing precedent at the
      // `:id` watch endpoint (`getItemStatus` returns immediately for the
      // active/queued branch, never calling `_collectGroupFeedback`).
      const historyRows = merged.filter(i => i.status === 'taken');
      const anchors = [...new Set(historyRows.map(anchorFor).filter(Boolean))];

      // LIN-1494 (superseding review F2 on LIN-1470): `listHistory` runs
      // `find()` AND `countDocuments()` under `Promise.all` whenever `limit`
      // is set (lib/dispatch-store.js `if (limit) { ... }` branch). Earlier
      // revisions destructured `{ items }` only and recorded the discarded
      // count as an accepted indexed cost; it is now CONSUMED — the pre-slice
      // `total` is the exact truncation signal for the L3 telemetry below,
      // replacing the `length === cap` proxy that false-positived on a
      // lineage of exactly LINEAGE_QUERY_LIMIT rows and could never report
      // how far over the cap real traffic runs. (The page query's twin count
      // feeds the response's honest `total`/`truncated` the same way.)
      const siblingsByAnchor = new Map();
      if (anchors.length) {
        const { items: lineageSiblings, total: lineageTotal } = await dispatchQueueStore.listHistory(req.proxyUrlKey, {
          rootItemId: { $in: anchors },
          limit: LINEAGE_QUERY_LIMIT,
          projection: { prompt: 0 }
        });
        // L3 (LIN-1485, exactness via LIN-1494): the store's pre-slice count
        // says precisely whether the newest-N cap dropped the oldest members
        // of a lineage — and by how much (the question LIN-1485 named as the
        // point of this telemetry). Exactly-at-cap is complete, not truncated.
        if (lineageTotal > LINEAGE_QUERY_LIMIT) {
          console.warn(`Lineage query exceeded LINEAGE_QUERY_LIMIT (${LINEAGE_QUERY_LIMIT}) for urlKey=${req.proxyUrlKey}, anchors=${anchors.length}, total=${lineageTotal} — result truncated to the newest ${LINEAGE_QUERY_LIMIT}`);
        }
        for (const sib of lineageSiblings) {
          const bucket = siblingsByAnchor.get(sib.rootItemId);
          if (bucket) bucket.push(sib);
          else siblingsByAnchor.set(sib.rootItemId, [sib]);
        }
      }

      // LIN-1261 F2: attribute an abort's terminality to the loop it TARGETS at the
      // proxy read boundary too (same class as the reconstruction path, different
      // consumer). Simple Dispatcher posts `[aborted]` to the abort row's OWN
      // feedback, never to the `abortTo` target's — so without this a lister of the
      // aborted TARGET reads it non-terminal until the 24h stale cutoff. Harvest the
      // abort rows already in `merged` (no extra store call) and derive each item's
      // effective feedback through the SAME shared F1 guard the reconstruction path
      // uses — never overriding a later genuine terminal or rewinding completedAt.
      // NOTE: an issue-scoped list (`?issueIdentifier=`) excludes abort rows at the
      // store (they carry `issueIdentifier: null`), so attribution applies to the
      // unscoped list; the point-read watch + follow-up gate are deliberately not
      // reached here (they need a store seam that finds an abort by target; deferred).
      const abortedTargets = harvestAbortedTargets(merged);

      // Resolve each item's effective status once (terminal marker → done/failed/
      // aborted, else `blocked` when the lineage is parked on a human, else the
      // STORED status) so filtering and the response agree. LIN-2079: this one
      // assignment feeds the reported field, the `?status=` FILTER and `total`,
      // so deriving `blocked` here is a wire-behaviour change by design —
      // `?status=taken` no longer returns parked rows, `?status=blocked` does.
      // LIN-1470: the lineage merge runs BEFORE abort attribution — ordering is
      // load-bearing, since `feedbackWithHarvestedAbort`'s F1 guard only lets an
      // abort win when it is strictly later than the existing terminal, so it
      // must see the true lineage terminal (a later child `[done]`), not just
      // this row's own. `_lineageFeedback` (own + verified siblings) feeds the
      // reported `feedbackCount`; `_terminalFeedback` is `_lineageFeedback` PLUS
      // any harvested abort and feeds `status`/`completedAt` — kept separate so
      // the synthetic abort entry never inflates `feedbackCount`.
      //
      // Review F7: `joinsLineage` (WHICH ROWS may join) says nothing about
      // WHICH FEEDBACK a joined row may inherit — a still-`taken` follow-up
      // dispatched AFTER its parent already finished was absorbing the
      // parent's earlier terminal. The invariant is structural, not another
      // status carve-out: a row is never reported complete before it was
      // itself dispatched. `mergeLineageFeedback` enforces this directly by
      // taking `i.dispatchedAt` as `since` — a sibling entry only counts if
      // its timestamp is at or after this row's own dispatch time.
      const resolved = merged.map(i => {
        // Rows that never ran (queued, cancelled, expired) opt out of the
        // lineage join entirely (see above) — `lineageFeedback` stays this
        // row's own (empty) feedback, same as pre-LIN-1470.
        const joinsLineage = i.status === 'taken';
        const anchor = joinsLineage ? anchorFor(i) : null;
        const siblingRows = anchor ? (siblingsByAnchor.get(anchor) || []).filter(s => s.id !== i.id) : [];
        const lineageFeedback = joinsLineage ? mergeLineageFeedback(i.feedback, siblingRows, anchor, i.dispatchedAt) : (i.feedback || []);
        const terminalFeedback = feedbackWithHarvestedAbort(lineageFeedback, abortedTargets.get(i.id));
        return { ...i, _lineageFeedback: lineageFeedback, _terminalFeedback: terminalFeedback, status: deriveLifecycleStatus(terminalFeedback) || i.status };
      });

      // `status` is derived from feedback (not stored), so it stays a JS filter;
      // `issueIdentifier` is already enforced at the store layer above.
      const filtered = resolved.filter(i =>
        (!statusFilter || i.status === statusFilter)
      );

      filtered.sort((a, b) => {
        const at = new Date(a.dispatchedAt || 0).getTime();
        const bt = new Date(b.dispatchedAt || 0).getTime();
        return bt - at;
      });

      const items = filtered.slice(0, limit).map(i => ({
        id: i.id,
        status: i.status,
        promptName: i.promptName,
        kind: i.kind || 'custom',
        issueIdentifier: i.issueIdentifier,
        issueUrl: i.issueUrl,
        target: i.target,
        dispatchedAt: i.dispatchedAt,
        // resolvedAt = take/archive time; completedAt = real completion (null until terminal).
        resolvedAt: i.resolvedAt || null,
        completedAt: deriveCompletedAt(i._terminalFeedback),
        // LIN-1470: lineage-wide (own + verified siblings), not just this row's
        // own stored feedback — see the merge above. Excludes any synthetic
        // harvested-abort entry (that only lives in `_terminalFeedback`).
        feedbackCount: i._lineageFeedback.length
      }));

      logEvent(req, '/api/proxy/dispatch', 200);
      // LIN-1494: `total` is exact wherever the store can count it. Unfiltered
      // and issue-scoped reads report queued + the page query's pre-slice
      // history count (the repo convention that `total` is "the full count
      // before limit" — /stack, /agent/status, /api/dispatch/history) — not a
      // count over the newest-200 window presented as the matching total.
      // A `?status=` read keeps the windowed `filtered.length`: status is
      // feedback-derived in JS, so an exact per-status total is unknowable
      // without reading the whole history (not an acceptable trade on an
      // endpoint with two prior H12/503 incidents). `truncated` (naming
      // precedent: deferTruncated) discloses the newest-200 window in both
      // cases — including that the lineage join's anchor set is seeded from
      // that window only. A windowed list is normal operation, not an
      // anomaly, so there is no console.warn here.
      const historyTotal = history.total ?? history.items.length;
      const total = statusFilter ? filtered.length : queued.length + historyTotal;
      res.json({ items, total, truncated: historyTotal > history.items.length });
    } catch (err) {
      logEvent(req, '/api/proxy/dispatch', 500);
      console.error('Proxy dispatch list error:', err.message);
      jsonError(res, 500, 'Failed to list dispatch items');
    }
  });

  /**
   * GET /api/proxy/dispatch/:id
   * Watch a dispatched item: report whether it is still queued or has been
   * taken by the runner, plus any feedback the runner has posted. This is the
   * poll half of the autopilot loop — the orchestrator reads feedback here to
   * decide its next step. Feedback is free-form by design; the orchestrator
   * (the judge) reads it rather than relying on a structured "done" flag.
   *
   * Optional ?wait=Ns (LIN-392) turns this into a server-side long-poll: the
   * handler holds the request open (re-checking the store every ~1.5s) and
   * returns the instant the derived status transitions or new feedback arrives,
   * else returns the current snapshot at a ~50s cap so the caller simply calls
   * again. This collapses the autopilot watch loop to a no-sleep/no-backoff
   * `do { GET ...?wait=50 } while (!terminal)`. No ?wait preserves today's
   * immediate short-poll, byte-for-byte.
   */
  router.get('/api/proxy/dispatch/:id', proxyLimiter, authenticateProxyToken, async (req, res) => {
    if (!dispatchQueueStore) {
      logEvent(req, '/api/proxy/dispatch/:id', 503);
      return jsonError(res, 503, 'Dispatch is not available');
    }

    const { id } = req.params;
    if (!id || id.length > MAX_IDENTIFIER_LENGTH || DANGEROUS_CHARS_REGEX.test(id)) {
      logEvent(req, '/api/proxy/dispatch/:id', 400);
      return badRequest.json(res, 'Invalid dispatch id');
    }

    // Parse + clamp ?wait. Garbage / non-positive → 0 → unchanged short-poll.
    const waitSeconds = Math.min(
      Math.max(0, Math.floor(Number(req.query.wait)) || 0),
      DISPATCH_WAIT_MAX_S
    );

    try {
      // This watch/poll seam is the one caller of getItemStatus that actually
      // reads `feedback` to derive terminal status, so it's the one caller
      // that opts into the (indexed-query-plus-merge) group feedback read —
      // see getItemStatus's includeGroupFeedback doc (LIN-1461).
      const item = await dispatchQueueStore.getItemStatus(req.proxyUrlKey, id, { includeGroupFeedback: true });
      if (!item) {
        logEvent(req, '/api/proxy/dispatch/:id', 404);
        return notFound.json(res, 'Dispatch item not found');
      }

      // First read short-circuits: no wait requested, or already terminal.
      // (The terminal short-circuit also keeps re-polling a finished item free
      // — the caller can re-verify without ever incurring the hold.)
      let current = item;
      const alreadyTerminal = deriveTerminalStatus(current.feedback) !== null;
      if (waitSeconds > 0) {
        // Long-poll path. The response carries `reason`/`waitedMs` so the caller
        // can tell WHY it came back (see formatDispatchWatch) — a terminal item
        // short-circuits with no hold; otherwise we hold and report 'change' vs
        // 'timeout'.
        if (alreadyTerminal) {
          logEvent(req, '/api/proxy/dispatch/:id', 200);
          return res.json(formatDispatchWatch(current, { reason: 'terminal', waitedMs: 0 }));
        }
        // Hold the request open. armKeepalive flushes 200 + JSON whitespace at
        // 25s so the connection survives Heroku's 30s H12 while we wait; the
        // baseline is this first (non-terminal) read, so a change that already
        // landed is reflected in the baseline AND in whatever we ultimately
        // return — the caller never loses data, only an early return.
        const keepalive = armKeepalive(res);
        const baseline = {
          status: deriveTerminalStatus(current.feedback) || current.status,
          feedbackLength: (current.feedback || []).length
        };
        const waitStart = Date.now();
        const deadline = waitStart + waitSeconds * 1000;
        let reason = 'timeout'; // default: held the full window, nothing new
        while (Date.now() < deadline) {
          await sleep(DISPATCH_WAIT_POLL_MS);
          if (res.writableEnded || res.destroyed) {
            keepalive.stop();
            return; // client gave up
          }
          const next = await dispatchQueueStore.getItemStatus(req.proxyUrlKey, id, { includeGroupFeedback: true });
          if (!next) break; // item expired mid-wait; return last known snapshot
          current = next;
          if (dispatchWatchChanged(baseline, current)) { reason = 'change'; break; }
        }
        keepalive.stop();
        logEvent(req, '/api/proxy/dispatch/:id', 200);
        return keepalive.send(200, formatDispatchWatch(current, { reason, waitedMs: Date.now() - waitStart }));
      }

      logEvent(req, '/api/proxy/dispatch/:id', 200);
      res.json(formatDispatchWatch(current));
    } catch (err) {
      logEvent(req, '/api/proxy/dispatch/:id', 500);
      console.error('Proxy dispatch watch error:', err.message);
      jsonError(res, 500, 'Failed to read dispatch item');
    }
  });

  /**
   * GET /api/proxy/dispatch/:id/prompt
   * Return the CANONICAL prompt Harbour dispatched for this item, so a consuming
   * agent can CONFIRM a task it received against the trusted dispatch record. A
   * task arriving in a live session as plain conversational text (carrying a
   * token + an external host) is indistinguishable from prompt injection unless
   * the agent can check it against what Harbour actually dispatched — this is
   * that check, fetched over the same authenticated Bearer channel it already
   * trusts (LIN-1128).
   *
   * The watch twin (GET .../:id) deliberately OMITS `prompt` — a payload /
   * Heroku-H12 defense on the long-poll + list paths, not a security choice. This
   * targeted single-item read adds it back: bounded (one item), exactly like
   * poll/take which already hand the full prompt to the runner. Read scope is
   * sufficient (reading the workspace's own record, not a mutation), and the
   * lookup is workspace-scoped via req.proxyUrlKey like every sibling read, so a
   * token can only see its own workspace's dispatches.
   *
   * Returns only THIS item's prompt — no followUpTo/root walk (the agent can
   * chase followUpTo itself if it ever needs the chain root).
   */
  router.get('/api/proxy/dispatch/:id/prompt', proxyLimiter, authenticateProxyToken, async (req, res) => {
    if (!dispatchQueueStore) {
      logEvent(req, '/api/proxy/dispatch/:id/prompt', 503);
      return jsonError(res, 503, 'Dispatch is not available');
    }

    const { id } = req.params;
    if (!id || id.length > MAX_IDENTIFIER_LENGTH || DANGEROUS_CHARS_REGEX.test(id)) {
      logEvent(req, '/api/proxy/dispatch/:id/prompt', 400);
      return badRequest.json(res, 'Invalid dispatch id');
    }

    try {
      const item = await dispatchQueueStore.getItemStatus(req.proxyUrlKey, id);
      if (!item) {
        logEvent(req, '/api/proxy/dispatch/:id/prompt', 404);
        return notFound.json(res, 'Dispatch item not found');
      }

      logEvent(req, '/api/proxy/dispatch/:id/prompt', 200);
      res.json({
        id: item.id,
        promptName: item.promptName,
        kind: item.kind || 'custom',
        prompt: item.prompt || null,
        issueIdentifier: item.issueIdentifier || null,
        issueUrl: item.issueUrl || null,
        target: item.target,
        followUpTo: item.followUpTo || null,
        sessionId: item.sessionId || null,
        dispatchedAt: item.dispatchedAt
      });
    } catch (err) {
      logEvent(req, '/api/proxy/dispatch/:id/prompt', 500);
      console.error('Proxy dispatch prompt read error:', err.message);
      jsonError(res, 500, 'Failed to read dispatch prompt');
    }
  });

  return router;
}
