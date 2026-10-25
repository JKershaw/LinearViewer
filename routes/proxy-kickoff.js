/**
 * Group H kickoff routes (LIN-679 Stage 5 / LIN-2539: extracted from
 * routes/proxy.js, byte-identical handler bodies; rebuilt design-first in LIN-3592:
 * the same routes, refusals and audit events, with the POST's checks written down
 * once as an ordered list).
 *
 * Autopilot kickoff (GET+POST), Autopilot manual, Passage Runner kickoff prompt.
 */
import { Router } from 'express';
import { buildAutopilotKickoff, AUTOPILOT_MODES, AUTOPILOT_MODE_DEFAULT, AUTOPILOT_VARIANTS, AUTOPILOT_VARIANT_DEFAULT } from '../lib/prompts/autopilot-kickoff.js';
import { buildAutopilotManual } from '../lib/prompts/autopilot-manual.js';
import { buildPassageRunnerKickoff } from '../lib/prompts/passage-runner-kickoff.js';
import { enterKickoff } from '../lib/dispatch-entrance.js';
import { requestOriginOrNull, ORIGIN_UNRESOLVED_REFUSAL } from '../lib/public-origin.js';
import { jsonError } from '../lib/errors.js';

/**
 * @param {Object} deps
 * @param {Function} deps.proxyLimiter - Per-IP rate limiter middleware (module-scope in routes/proxy.js, shared as-is; injected here rather than redeclared so that lifetime is preserved)
 * @param {Function} deps.authenticateProxyToken - Consumer-token auth middleware (closure-local in createProxyRoutes)
 * @param {Function} deps.requireWriteScope - Requires readWrite scope on the token (closure-local)
 * @param {Function} deps.requireGrant - The grant gate middleware factory (module-scope in routes/proxy.js); gates POST /autopilot/kickoff on the `dispatch` grant, after the scope check (LIN-3136)
 * @param {Function} deps.logEvent - Audit/witness event logger (closure-local)
 * @param {Object} deps.dispatchQueueStore - Dispatch queue storage instance
 * @param {Object} [deps.dispatchTokenStore] - Consumer-token store (LIN-2885):
 *   threaded into `createDispatchItem` to stamp `consumerLastSeenAt`. Optional —
 *   an absent store just means every kickoff stamps null (never seen).
 * @param {Object} deps.dispatchPresetsStore - Dispatch preset storage instance
 * @param {Object} deps.workspacePreferencesStore - Workspace-level preference storage
 * @param {Object} deps.proxyTokenStore - Proxy token storage instance
 * @param {Function} deps.resolveProviderAccess - Resolves {token, reason, provider} for the active workspace/provider (closure-local)
 * @param {Function} deps.workspaceUnavailable - 503 envelope for an unresolvable workspace credential (closure-local)
 * @param {Function} deps.denyIfUnsupported - Capability gate; 422s an unsupported provider method (closure-local)
 * @param {Function} deps.resolvePromptIssueContext - Resolves the issue + prompt context for deterministic, server-side prompt generation (module-scope, shared with groups F/I)
 * @param {Function} deps.relayDispatchRefusal - replies to a tagged factory refusal (closure-local)
 * @param {Function} deps.graphqlErrorStatus - Maps a provider/GraphQL error to an HTTP status (closure-local)
 * @param {string} deps.PROXY_ATTACH_FAILED_MESSAGE - 503 message when the out-of-band bootstrap token could not be minted (closure-local)
 */
export function createKickoffRoutes({
  proxyLimiter,
  authenticateProxyToken,
  requireWriteScope,
  requireGrant,
  logEvent,
  dispatchQueueStore,
  dispatchTokenStore = null,
  dispatchPresetsStore,
  workspacePreferencesStore,
  proxyTokenStore,
  resolveProviderAccess,
  workspaceUnavailable,
  denyIfUnsupported,
  resolvePromptIssueContext,
  relayDispatchRefusal,
  freeTierStore = null,
  accountStore = null,
  getWorkspaceOpenRouterKey = null,
  graphqlErrorStatus,
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
    // LIN-3931: the kickoff text names this request's origin as its proxy base. With no Host and no
    // PUBLIC_ORIGIN that would read `http://undefined`, so refuse the preview instead of serving it.
    const baseUrl = requestOriginOrNull(req);
    if (baseUrl === null) {
      logEvent(req, '/api/proxy/autopilot/kickoff', 400);
      return jsonError(res, 400, ORIGIN_UNRESOLVED_REFUSAL.message, { code: ORIGIN_UNRESOLVED_REFUSAL.code, retryable: ORIGIN_UNRESOLVED_REFUSAL.retryable });
    }
    const mode = AUTOPILOT_MODES.includes(req.query.mode) ? req.query.mode : AUTOPILOT_MODE_DEFAULT;
    const variant = AUTOPILOT_VARIANTS.includes(req.query.variant) ? req.query.variant : AUTOPILOT_VARIANT_DEFAULT;
    // LIN-2818: unlike the POST body's goal cap (now 100000), this preview-only
    // GET slices at 1000 on purpose. Its `goal` arrives in the URL query string,
    // and Node's default 16KB header ceiling means a larger value can't reliably
    // round-trip; raising it here would advertise a preview capability the
    // transport can't carry. The GET never enqueues, so nothing real is dropped.
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
   * Body (all optional): { goal?, mode?, variant?, issueIdentifier?, issueSource?, target?, repo?,
   * appendProxyContext?, sessionId?, subscription?, model?, harness?, effort?, presetId?, maxTasks? }
   * (the authority documents each: lib/dispatch-entrance.js, enterKickoff).
   */
  router.post('/api/proxy/autopilot/kickoff', proxyLimiter, authenticateProxyToken, requireWriteScope, requireGrant('dispatch'), async (req, res) => {
    await enterKickoff({
      req,
      res,
      endpoint: '/api/proxy/autopilot/kickoff',
      dispatchQueueStore,
      dispatchTokenStore,
      dispatchPresetsStore,
      workspacePreferencesStore,
      proxyTokenStore,
      freeTierStore,
      accountStore,
      logEvent,
      resolveProviderAccess,
      workspaceUnavailable,
      denyIfUnsupported,
      resolvePromptIssueContext,
      relayDispatchRefusal,
      graphqlErrorStatus,
      getWorkspaceOpenRouterKey,
      PROXY_ATTACH_FAILED_MESSAGE
    });
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
