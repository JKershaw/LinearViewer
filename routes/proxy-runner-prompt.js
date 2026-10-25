/**
 * The served runner prompt (LIN-3098 S3):
 *
 *   GET /api/proxy/runner/prompt
 *
 * Returns, as text/plain, the prompt that turns a person's Claude Code session
 * into this workspace's runner (docs/runner-prompt.md via
 * lib/prompts/runner-kickoff.js), with this request's base URL filled in. A request
 * with no origin (no Host, no PUBLIC_ORIGIN) gets 400 ORIGIN_UNRESOLVED instead of a
 * prompt that names `http://undefined` (LIN-3931).
 *
 * Its own chain, `proxyLimiter → authenticateProxyToken → requireGrant('take')`:
 * the prompt is for a runner credential, so any other token gets
 * `403 TAKE_GRANT_REQUIRED`. `routes/proxy.js` mounts this factory BEFORE
 * `createProxyRunnerRoutes`, whose own path-scoped gate at /api/proxy/runner
 * would otherwise run a second limiter and auth pass over this request (R8).
 * routes/proxy-runner.js (LIN-3059's) is not edited.
 */
import { Router } from 'express';
import { buildRunnerKickoff } from '../lib/prompts/runner-kickoff.js';
import { requestOriginOrNull, ORIGIN_UNRESOLVED_REFUSAL } from '../lib/public-origin.js';
import { jsonError } from '../lib/errors.js';

const PROMPT_ROUTE = '/api/proxy/runner/prompt';

/**
 * @param {Object} deps
 * @param {Function} deps.proxyLimiter - Per-IP rate limiter middleware
 * @param {Function} deps.authenticateProxyToken - Proxy bearer-token auth middleware
 * @param {Function} deps.requireGrant - Grant-gate middleware factory (lib/require-grant.js)
 * @param {Function} deps.logEvent - Proxy event/audit logger
 * @param {Function} [deps.buildPrompt] - The prompt builder (default buildRunnerKickoff)
 */
export function createProxyRunnerPromptRoutes({
  proxyLimiter,
  authenticateProxyToken,
  requireGrant,
  logEvent,
  buildPrompt = buildRunnerKickoff
}) {
  const router = Router();

  router.get(PROMPT_ROUTE, proxyLimiter, authenticateProxyToken, requireGrant('take'), (req, res) => {
    // LIN-3931: the prompt names this request's origin as the runner's callback base. With no Host
    // and no PUBLIC_ORIGIN that origin would read `http://undefined`, so refuse instead of serving it.
    const baseUrl = requestOriginOrNull(req);
    if (baseUrl === null) {
      logEvent(req, PROMPT_ROUTE, 400);
      return jsonError(res, 400, ORIGIN_UNRESOLVED_REFUSAL.message, { code: ORIGIN_UNRESOLVED_REFUSAL.code, retryable: ORIGIN_UNRESOLVED_REFUSAL.retryable });
    }
    logEvent(req, PROMPT_ROUTE, 200);
    res.type('text/plain').send(buildPrompt({ baseUrl }));
  });

  return router;
}
