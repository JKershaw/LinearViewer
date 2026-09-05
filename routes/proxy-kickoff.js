/**
 * Group H kickoff routes (LIN-679 Stage 5 / LIN-2539: extracted from
 * routes/proxy.js, byte-identical handler bodies).
 *
 * Autopilot kickoff (GET+POST), Autopilot manual, Passage Runner kickoff prompt.
 */
import { Router } from 'express';
import { badRequest, jsonError, notFound, classifyUpstreamError } from '../lib/errors.js';
import { MAX_NAME_LENGTH } from '../lib/issue-write-validation.js';
import { validateOpaqueDispatchField, validateSessionId, DISPATCH_EFFORT_LEVELS } from '../lib/dispatch-validation.js';
import { isValidSubscription, DEFAULT_SUBSCRIPTION, SUBSCRIPTION_LEVELS } from '../lib/dispatch-wake.js';
import { createDispatchItem } from '../lib/dispatch-factory.js';
import { parseRepoFromDescription } from '../lib/prompt-formatters.js';
import { attachProxyContext } from '../lib/proxy-preamble.js';
import { buildAutopilotKickoff, AUTOPILOT_MODES, AUTOPILOT_MODE_DEFAULT, AUTOPILOT_VARIANTS, AUTOPILOT_VARIANT_DEFAULT } from '../lib/prompts/autopilot-kickoff.js';
import { buildAutopilotManual } from '../lib/prompts/autopilot-manual.js';
import { buildPassageRunnerKickoff } from '../lib/prompts/passage-runner-kickoff.js';
import { isValidIssueId } from '../lib/workspace.js';
import { declaredProviderDisplayName } from '../lib/proxy-graphql-errors.js';

/**
 * @param {Object} deps
 * @param {Function} deps.proxyLimiter - Per-IP rate limiter middleware (module-scope in routes/proxy.js, shared as-is; injected here rather than redeclared so that lifetime is preserved)
 * @param {Function} deps.authenticateProxyToken - Consumer-token auth middleware (closure-local in createProxyRoutes)
 * @param {Function} deps.requireWriteScope - Requires readWrite scope on the token (closure-local)
 * @param {Function} deps.logEvent - Audit/witness event logger (closure-local)
 * @param {Object} deps.dispatchQueueStore - Dispatch queue storage instance
 * @param {Object} deps.dispatchPresetsStore - Dispatch preset storage instance
 * @param {Object} deps.workspacePreferencesStore - Workspace-level preference storage
 * @param {Object} deps.proxyTokenStore - Proxy token storage instance
 * @param {Function} deps.resolveProviderAccess - Resolves {token, reason, provider} for the active workspace/provider (closure-local)
 * @param {Function} deps.workspaceUnavailable - 503 envelope for an unresolvable workspace credential (closure-local)
 * @param {Function} deps.denyIfUnsupported - Capability gate; 422s an unsupported provider method (closure-local)
 * @param {Function} deps.resolvePromptIssueContext - Resolves the issue + prompt context for deterministic, server-side prompt generation (module-scope, shared with groups F/I)
 * @param {Function} deps.refuseIfDuplicateDispatch - 409s a duplicate dispatch error (closure-local)
 * @param {Function} deps.refuseIfBudgetExhausted - 409s a budget-exhausted dispatch error (closure-local)
 * @param {Function} deps.graphqlErrorStatus - Maps a provider/GraphQL error to an HTTP status (closure-local)
 * @param {string[]} deps.VALID_PROXY_DISPATCH_TARGETS - Valid dispatch target values (closure-local)
 * @param {string} deps.PROXY_ATTACH_FAILED_MESSAGE - 503 message when the out-of-band bootstrap token could not be minted (closure-local)
 */
export function createKickoffRoutes({
  proxyLimiter,
  authenticateProxyToken,
  requireWriteScope,
  logEvent,
  dispatchQueueStore,
  dispatchPresetsStore,
  workspacePreferencesStore,
  proxyTokenStore,
  resolveProviderAccess,
  workspaceUnavailable,
  denyIfUnsupported,
  resolvePromptIssueContext,
  refuseIfDuplicateDispatch,
  refuseIfBudgetExhausted,
  graphqlErrorStatus,
  VALID_PROXY_DISPATCH_TARGETS,
  PROXY_ATTACH_FAILED_MESSAGE,
}) {
  const router = Router();

  /**
   * GET /api/proxy/autopilot/kickoff
   * Returns the Autopilot kickoff prompt as plain text — the briefing that
   * turns the receiving session into the Autopilot orchestrator (it dispatches
   * work to a separate worker and judges completion from external evidence).
   * General (stack-walk) by default; `?goal=` supplies a focus, `?mode=readonly`
   * restricts to investigation/research prompts, `?variant=stepper` swaps in the
   * beat-stepping disposition.
   */
  router.get('/api/proxy/autopilot/kickoff', proxyLimiter, authenticateProxyToken, async (req, res) => {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const mode = AUTOPILOT_MODES.includes(req.query.mode) ? req.query.mode : AUTOPILOT_MODE_DEFAULT;
    const variant = AUTOPILOT_VARIANTS.includes(req.query.variant) ? req.query.variant : AUTOPILOT_VARIANT_DEFAULT;
    const goal = typeof req.query.goal === 'string' ? req.query.goal.slice(0, 1000) : '';

    logEvent(req, '/api/proxy/autopilot/kickoff', 200);

    const kickoff = buildAutopilotKickoff({ baseUrl, goal, mode, variant, standalone: true });
    res.type('text/plain').send(kickoff);
  });

  /**
   * POST /api/proxy/autopilot/kickoff
   * Fused launch verb (LIN-569): build the Autopilot kickoff AND enqueue it in
   * one call, returning the dispatch id — which IS the run's session id. This is
   * the single verb that actually *starts* a run from a goal. It collapses the
   * UI's old two-step round-trip (GET the kickoff → ship the whole body back via
   * POST /dispatch) into one server-side composition, the same fusion shape as
   * POST /recommend-and-dispatch: the prompt body is generated server-side and
   * never returned to the caller. The GET twin above stays the text-only
   * preview/inspect form.
   *
   * Body (all optional): { goal?, mode?, variant?, issueIdentifier?, target?, repo?, appendProxyContext?, sessionId?, subscription? }
   *   - issueIdentifier present → SCOPED run ("autopilot until THIS task is
   *     done"): the issue's title is resolved for the goal line and its project
   *     `repo=` is inherited (an explicit caller `repo` wins, mirroring /prompt).
   *   - issueIdentifier absent  → GENERAL run; `goal` focuses the stack walk.
   *   - mode: 'write' (default) | 'readonly'.
   *   - variant: 'standard' (default) | 'stepper' (warm beat-stepping disposition,
   *     LIN-791); orthogonal to mode.
   *   - sessionId + subscription (LIN-813): the coordinator up-chain edge, a GUIDE
   *     capability available to any autopilot contextually (NOT a launch-time
   *     variant — see the operating manual's "Dispatching a child autopilot"). An
   *     autopilot acting as a coordinator that dispatches a CHILD autopilot for a
   *     whole task passes its OWN session id as `sessionId` (the wake target) with
   *     `subscription: 'everything'`, so the child's reports wake the coordinator. A
   *     top-level kickoff omits both (undeclared → 'terminal-only').
   * Dispatches with kind:'autopilot', so addItem appends the session-id self-ref
   * block and the returned id is the session id (LIN-591/LIN-599).
   */
  router.post('/api/proxy/autopilot/kickoff', proxyLimiter, authenticateProxyToken, requireWriteScope, async (req, res) => {
    if (!dispatchQueueStore) {
      logEvent(req, '/api/proxy/autopilot/kickoff', 503);
      return jsonError(res, 503, 'Dispatch is not available');
    }

    try {
      const { goal, mode, variant, issueIdentifier, target, repo, appendProxyContext, sessionId, subscription, model, harness, effort, presetId, maxTasks } = req.body || {};

      // Validate caller-supplied inputs. (The composed body is server-generated
      // and trusted, so only these raw inputs are checked — same split as the
      // recommend-and-dispatch override path.)
      const resolvedMode = mode === undefined ? AUTOPILOT_MODE_DEFAULT : mode;
      if (!AUTOPILOT_MODES.includes(resolvedMode)) {
        logEvent(req, '/api/proxy/autopilot/kickoff', 400);
        return badRequest.json(res, `mode must be one of: ${AUTOPILOT_MODES.join(', ')}`);
      }
      const resolvedVariant = variant === undefined ? AUTOPILOT_VARIANT_DEFAULT : variant;
      if (!AUTOPILOT_VARIANTS.includes(resolvedVariant)) {
        logEvent(req, '/api/proxy/autopilot/kickoff', 400);
        return badRequest.json(res, `variant must be one of: ${AUTOPILOT_VARIANTS.join(', ')}`);
      }
      const kickoffGoalValidationError = validateOpaqueDispatchField(goal, 'goal', {
        maxLength: MAX_NAME_LENGTH,
        reportReceivedLength: true,
      });
      if (kickoffGoalValidationError) {
        logEvent(req, '/api/proxy/autopilot/kickoff', 400);
        return badRequest.json(res, kickoffGoalValidationError.error);
      }
      if (target !== undefined && !VALID_PROXY_DISPATCH_TARGETS.includes(target)) {
        logEvent(req, '/api/proxy/autopilot/kickoff', 400);
        return badRequest.json(res, `target must be one of: ${VALID_PROXY_DISPATCH_TARGETS.join(', ')}`);
      }
      const kickoffRepoValidationError = validateOpaqueDispatchField(repo, 'repo', {
        maxLength: MAX_NAME_LENGTH,
        reportReceivedLength: true,
      });
      if (kickoffRepoValidationError) {
        logEvent(req, '/api/proxy/autopilot/kickoff', 400);
        return badRequest.json(res, kickoffRepoValidationError.error);
      }
      if (issueIdentifier !== undefined && !isValidIssueId(issueIdentifier)) {
        logEvent(req, '/api/proxy/autopilot/kickoff', 400);
        return badRequest.json(res, 'Invalid identifier format');
      }
      // Coordinator up-chain wiring (LIN-813): an autopilot acting as a coordinator
      // dispatches a task-altitude CHILD autopilot for a whole task, stamping its
      // OWN session id as `sessionId` (the up-chain wake target) and declaring
      // `subscription: 'everything'` so the child's PENDING/terminal reports wake it.
      // Both are stored + forwarded blindly onto the dispatched item (same contract
      // as POST /dispatch); validate shape only. This is a guide capability, not a
      // variant — any autopilot can use it contextually.
      // Opaque string, not a UUID (LIN-1118) — shared rule, same as POST /dispatch.
      const kickoffSessionIdError = validateSessionId(sessionId);
      if (kickoffSessionIdError) {
        logEvent(req, '/api/proxy/autopilot/kickoff', 400);
        return badRequest.json(res, kickoffSessionIdError.error);
      }
      if (subscription !== undefined && !isValidSubscription(subscription)) {
        logEvent(req, '/api/proxy/autopilot/kickoff', 400);
        return badRequest.json(res, `subscription must be one of: ${SUBSCRIPTION_LEVELS.join(', ')}`);
      }
      // Execution model + harness (LIN-438, LIN-1084): opaque strings, validated
      // via the shared helper (type/length/dangerous-chars only — NOT checked
      // against a model registry). Mirrors POST /dispatch + recommend-and-dispatch.
      const kickoffModelValidationError = validateOpaqueDispatchField(model, 'model', { maxLength: MAX_NAME_LENGTH });
      if (kickoffModelValidationError) {
        logEvent(req, '/api/proxy/autopilot/kickoff', 400);
        return badRequest.json(res, kickoffModelValidationError.error);
      }
      const kickoffHarnessValidationError = validateOpaqueDispatchField(harness, 'harness', { maxLength: MAX_NAME_LENGTH });
      if (kickoffHarnessValidationError) {
        logEvent(req, '/api/proxy/autopilot/kickoff', 400);
        return badRequest.json(res, kickoffHarnessValidationError.error);
      }
      // Execution effort (LIN-2615): opaque string, same helper/convention as
      // model/harness above — closes the ingress gap review flagged (kickoff
      // forwarded effort without validating it, unlike every other write verb).
      const kickoffEffortValidationError = validateOpaqueDispatchField(effort, 'effort', { maxLength: MAX_NAME_LENGTH });
      if (kickoffEffortValidationError) {
        logEvent(req, '/api/proxy/autopilot/kickoff', 400);
        return badRequest.json(res, kickoffEffortValidationError.error);
      }
      // An out-of-set level stays accepted (fail-soft, never a 400) but is
      // logged, the same as the other three write verbs. Symmetry only — the
      // caller-observable contract is identical either way; without it the
      // runtime-served `## Effort` docs describe a warning this verb alone
      // never emitted.
      if (effort && !DISPATCH_EFFORT_LEVELS.includes(effort)) {
        console.warn(`Unknown dispatch effort level: ${effort}`);
      }
      // Selected dispatch preset (LIN-1390): an unknown/invalid id is rejected
      // here, up front — the factory treats a presetId it can't resolve as "no
      // preset" (a defensive fallback for this seam's own store lookup below),
      // not a validation gate, so this is the one place that contract is enforced.
      if (presetId !== undefined && presetId !== null) {
        if (typeof presetId !== 'string' || !presetId.trim()) {
          logEvent(req, '/api/proxy/autopilot/kickoff', 400);
          return badRequest.json(res, 'presetId must be a non-empty string');
        }
        if (dispatchPresetsStore) {
          const preset = await dispatchPresetsStore.get(req.proxyUrlKey, presetId);
          if (!preset) {
            logEvent(req, '/api/proxy/autopilot/kickoff', 400);
            return badRequest.json(res, 'Invalid or unknown presetId');
          }
        }
      }
      // Task budget (LIN-1751): a SCOPE bound on the run — up to this many
      // distinct tasks — enforced deterministically at the dispatch-factory seam
      // (never a cost control; see the kickoff prose). Optional; validated here,
      // up front, following the presetId precedent just above. Absent/null ⇒ no
      // budget, byte-identical to today.
      if (maxTasks !== undefined && maxTasks !== null) {
        if (!Number.isInteger(maxTasks) || maxTasks < 1) {
          logEvent(req, '/api/proxy/autopilot/kickoff', 400);
          return badRequest.json(res, 'maxTasks must be an integer >= 1');
        }
      }

      // Subscription is DECLARED on the edge (LIN-900 §6), never reconstructed from
      // incidental fields: an undeclared edge is `terminal-only`, full stop. (This
      // deliberately removes the old `!!sessionId` derivation — §6 forbids inferring
      // subscription from "has a sessionId". A coordinator that wants every beat
      // declares `subscription: 'everything'` explicitly; the autopilot prompts are
      // the sole declarers.)
      const subscriptionResolved = subscription ?? DEFAULT_SUBSCRIPTION;

      const baseUrl = `${req.protocol}://${req.get('host')}`;

      // SCOPED run: resolve the named issue so the goal line can name it and we
      // can inherit the project repo (mirrors /prompt + recommend-and-dispatch).
      let issue = null;
      let resolvedRepo = repo || null;
      if (issueIdentifier) {
        const { token: accessToken, reason, provider } = await resolveProviderAccess(req.proxyUrlKey, req.proxyCreatedBy, req);
        // LIN-1980: stamp before any other logic (incl. the !accessToken early
        // return below) so the fingerprint is present even when this request
        // later 401s from a shared credential another site marked suspect.
        if (!accessToken) {
          return workspaceUnavailable(req, res, '/api/proxy/autopilot/kickoff', reason);
        }
        if (denyIfUnsupported(provider, 'fetchIssueContext', req, res, '/api/proxy/autopilot/kickoff')) return;
        const isTestMode = process.env.NODE_ENV === 'test' && accessToken === 'test-token';
        let ctx;
        try {
          ctx = await resolvePromptIssueContext(provider, accessToken, issueIdentifier, isTestMode);
        } catch (err) {
          if (err.message?.includes('not found')) {
            logEvent(req, '/api/proxy/autopilot/kickoff', 404);
            return notFound.json(res, 'Issue not found');
          }
          throw err;
        }
        if (!ctx) {
          logEvent(req, '/api/proxy/autopilot/kickoff', 404);
          return notFound.json(res, 'Issue not found');
        }
        issue = { identifier: ctx.issue.identifier, title: ctx.issue.title };
        resolvedRepo = repo || parseRepoFromDescription(ctx.project?.description) || null;
      }

      const kickoff = buildAutopilotKickoff({
        baseUrl,
        issue,
        goal: typeof goal === 'string' ? goal : '',
        mode: resolvedMode,
        variant: resolvedVariant,
        maxTasks: maxTasks ?? null
      });

      // Create the dispatch item through the shared factory (LIN-1139): it
      // resolves model/harness from workspace dispatchDefaults (LIN-1138 —
      // `autopilot` is a meta-kind ∉ PROMPT_TEMPLATES, so only the workspace-wide
      // default applies), interposes the default harness (LIN-1159), and calls
      // addItem. The proxy-context append is the default ("+proxy block" the
      // kickoff guide refers to); it runs inside finalizePrompt AFTER the harness
      // is resolved so it can gate its MCP-token-vs-prose branch on it (LIN-1155),
      // and hands back the bootstrapToken to carry as a structured field. Opt out
      // with appendProxyContext:false.
      const item = await createDispatchItem({
        store: dispatchQueueStore,
        urlKey: req.proxyUrlKey,
        workspacePreferencesStore,
        dispatchPresetsStore,
        presetId: presetId || null,
        kind: 'autopilot',
        model,
        harness,
        effort,
        finalizePrompt: async (resolvedHarness) => {
          if (appendProxyContext !== false) {
            // LIN-376: embed a fresh single-use bootstrap, never the caller's own
            // authenticating token. Skips the block if minting fails (graceful).
            // LIN-1155: for the claude-code harness the token is stripped from the
            // prose and returned as `bootstrapToken` to carry on the item instead.
            return attachProxyContext({
              proxyTokenStore,
              urlKey: req.proxyUrlKey,
              baseUrl,
              issueIdentifier: issueIdentifier || null,
              prompt: kickoff,
              label: 'kickoff-bootstrap',
              harness: resolvedHarness,
              createdBy: req.proxyCreatedBy || null,
              // LIN-2354: only resolved when this was a SCOPED kickoff (the
              // `if (issueIdentifier)` block above called resolveProviderAccess,
              // stamping req.resolvedProvider); a goal-only kickoff resolves no
              // provider and correctly stays neutral rather than triggering a
              // fresh resolve just to fill this sentence.
              providerDisplayName: declaredProviderDisplayName(req)
            });
          }
          return { prompt: kickoff, bootstrapToken: null };
        },
        fields: {
          promptName: issue ? `Autopilot (${issue.identifier})` : 'Autopilot (stack walk)',
          issueIdentifier: issueIdentifier || null,
          dispatchedBy: req.proxyCreatedBy || null,
          target: target || 'cli',
          repo: resolvedRepo,
          // Park the orchestrator holdable (LIN-826). Under push-based comms the
          // subscribed children run independently to terminal and then WAKE the
          // parent with a follow-up (the LIN-826 auto-enqueue), so the orchestrator
          // must stop at a holdable AWAITING_FOLLOWUP point to receive those wakes
          // instead of polling. This inverts the old "free the producer" rule only
          // for the subscribed case; Phase 2 retires that rule in the prose.
          waitForFollowUps: true,
          // Coordinator up-chain edge (LIN-813): when this kickoff is a CHILD
          // autopilot dispatched by a coordinator, `sessionId` targets the coordinator
          // and a declared `subscription: 'everything'` routes the child's reports back
          // up to it. A top-level kickoff passes neither, so subscription defaults to
          // 'terminal-only' and the standard single-head behavior is unchanged. Stored
          // + forwarded blindly; note `sessionId` here is the PARENT edge — the child's
          // own `_id` is what addItem stamps into its prompt for its own sub-workers,
          // so the two ids stay distinct by construction.
          sessionId: sessionId || null,
          subscription: subscriptionResolved,
          // Scope bound (LIN-1751): stored on the run row so the dispatch-factory
          // seam can enforce it on every later worker dispatch under this run's
          // own id. null ⇒ unbounded, byte-identical to today.
          maxTasks: maxTasks ?? null
        }
      });

      logEvent(req, '/api/proxy/autopilot/kickoff', 201);
      res.status(201).json({
        success: true,
        // The dispatch id IS the autopilot session id (LIN-591/LIN-599); surface
        // it under both names so callers can use whichever reads clearer.
        id: item._id,
        sessionId: item._id,
        status: 'queued',
        kind: item.kind,
        promptName: item.promptName,
        mode: resolvedMode,
        variant: resolvedVariant,
        issueIdentifier: item.issueIdentifier,
        target: item.target,
        dispatchedAt: item.dispatchedAt?.toISOString?.() || item.dispatchedAt,
        maxTasks: item.maxTasks
      });
    } catch (err) {
      // An issue-scoped kickoff (kind 'autopilot') can duplicate like any other
      // fresh dispatch — LIN-1656. A stack-walk kickoff carries no issueIdentifier
      // and can never be refused. Ahead of the generic 500: a 500 here is worse
      // than no guard, since a caller cannot tell it from a real fault.
      if (refuseIfDuplicateDispatch(err, req, res, '/api/proxy/autopilot/kickoff')) return;
      // Task budget reached (LIN-1751) — a kickoff itself is never budget-refused
      // (this route's own dispatch is the run's OWNER row, not a worker dispatch
      // under a budgeted sessionId), but a child-autopilot kickoff dispatched
      // with `sessionId` set to a coordinator's budgeted run can be.
      if (refuseIfBudgetExhausted(err, req, res, '/api/proxy/autopilot/kickoff')) return;
      // Fail closed (LIN-1175): a claude-code dispatch whose out-of-band bootstrap
      // token could not be minted must be REFUSED, never launched credential-less.
      // attachProxyContext flags this as proxyAttachFailed (same convention as the
      // dispatch.js route) — surface it as a transient 503, not a generic 500.
      if (err && err.proxyAttachFailed) {
        logEvent(req, '/api/proxy/autopilot/kickoff', 503);
        return jsonError(res, 503, PROXY_ATTACH_FAILED_MESSAGE);
      }
      // LIN-2216: an upstream provider-auth failure (Linear 401/403) —
      // resolvePromptIssueContext's own try/catch above only catches a
      // "not found" message and rethrows everything else, so this is where
      // it lands. Ahead of the generic 500, same reasoning as the three
      // guards above: a bare 500 cannot be told apart from a real fault, and
      // the caller (often an autopilot at its own dispatch seam) needs to
      // know whether to retry or escalate. `graphqlErrorStatus` carries the
      // SAME transient-vs-terminal classification the data routes now use
      // (LIN-2216: 503 when this router's own bookkeeping believed the
      // credential was still live when Linear rejected it; 401 otherwise) —
      // reused here rather than re-derived, so the two surfaces can never
      // disagree about the same rejection. `classifyUpstreamError` supplies
      // the machine-matchable `code`/`category` — the existing LINEAR_AUTH
      // vocabulary render-pages.js's human-facing error page already uses
      // for this exact upstream shape, not a new taxonomy.
      const authStatus = graphqlErrorStatus(err, req);
      if (authStatus === 401 || authStatus === 503) {
        // LIN-2363: attribute the failure to the backend actually called. This
        // branch built its envelope inline rather than through
        // `graphqlErrorDetail`, so it forwarded `classifyUpstreamError`'s
        // Linear-hardcoded `detail` verbatim — the one `detail` field in this
        // file LIN-2351 did not reach.
        //
        // `req.resolvedProvider.displayName` (NOT `.declared`) is the right read
        // here, and the distinction is deliberate: this is ERROR ATTRIBUTION, not
        // identity assertion. The question is "which backend did we just call and
        // get rejected by", so the post-fallback name is correct — the same read
        // `graphqlErrorDetail` uses, reused rather than re-derived so the two can
        // never disagree about one rejection. (LIN-2354's `.declared` gate is for
        // prose that CLAIMS what a workspace is backed by; that is a different
        // question.) Nothing stamped ⇒ null ⇒ provider-neutral wording, never a
        // guessed "Linear".
        //
        // WHY NOW, given this is latent: `graphqlErrorStatus` above reads only
        // `err.response.status`, while all three non-Linear clients set
        // `err.status` — so a real GitHub/Jira 401 currently maps to 500 and never
        // reaches here (re-verified at HEAD). The moment anyone normalises that
        // shape — the obvious fix, tracked separately — this branch would start
        // telling GitHub and Jira operators that *Linear* rejected their
        // credentials, in the exact field LIN-2351 just cleaned. Fixing the trap
        // before it arms is the whole point.
        //
        // `code`/`category`/`retryable` are untouched: the `LINEAR_*` codes are a
        // published, machine-matchable contract and renaming them is a breaking
        // change needing a deprecation path — LIN-2351's boundary, held here.
        const classification = classifyUpstreamError(err, req.resolvedProvider?.displayName ?? null);
        logEvent(req, '/api/proxy/autopilot/kickoff', authStatus);
        console.error('Proxy autopilot kickoff error:', err.message);
        return jsonError(res, authStatus, 'Failed to dispatch autopilot kickoff', {
          code: classification.code,
          category: classification.category,
          retryable: authStatus === 503,
          detail: classification.detail,
        });
      }
      logEvent(req, '/api/proxy/autopilot/kickoff', 500);
      console.error('Proxy autopilot kickoff error:', err.message);
      jsonError(res, 500, 'Failed to dispatch autopilot kickoff');
    }
  });

  /**
   * GET /api/proxy/autopilot/manual
   * Returns the Autopilot operating manual (the "handbook") as plain text — the
   * portable senior-lead disposition that sits beside the kickoff's mechanics.
   * The kickoff composes this same text inline, so this endpoint is for re-reading
   * a part mid-run (and for humans / other consumers).
   */
  router.get('/api/proxy/autopilot/manual', proxyLimiter, authenticateProxyToken, async (req, res) => {
    logEvent(req, '/api/proxy/autopilot/manual', 200);
    res.type('text/plain').send(buildAutopilotManual());
  });

  /**
   * GET /api/proxy/passage-runner/prompt
   * Returns the Passage Runner kickoff prompt (docs/passage-runner-prompt.md,
   * preamble stripped) as plain text — for re-reading a part mid-run.
   */
  router.get('/api/proxy/passage-runner/prompt', proxyLimiter, authenticateProxyToken, async (req, res) => {
    logEvent(req, '/api/proxy/passage-runner/prompt', 200);
    res.type('text/plain').send(buildPassageRunnerKickoff());
  });

  return router;
}
