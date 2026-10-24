/**
 * Shared steps for the workspace API routers (LIN-2246: extracted from
 * workspace-api.js). routes/workspace-api.js, routes/workspace-api-prompts.js
 * (isTestToken, failureOf) and routes/workspace-api-issue-read.js (isTestToken,
 * failureOf, openIssue) and routes/workspace-api-issue-write.js (isTestToken,
 * refuseCapability) and routes/workspace-api-scan.js (failureOf, openIssue,
 * refuseCapability, refuseFreeTier, aiNotConfigured, keepaliveFailure, loadContext) import them; each is defined here once. `openIssue` and
 * `refuseCapability` moved here with LIN-3872; `refuseFreeTier`, `aiNotConfigured`,
 * `keepaliveFailure` and `loadContext` with LIN-3877 (the composer reads them too).
 */
import { badRequest, jsonError, keepaliveError } from '../lib/errors.js';
import { freeTierRefusalBlock } from '../lib/chat-request.js';
import { buildMockRecapContext } from '../lib/workspace-api-mocks.js';
import { isValidIssueId, resolveIssueBinding } from '../lib/workspace.js';

/**
 * The test-token workspace (`/test/set-session`): data comes from `testMockData`,
 * never from a provider. `mockAi` (lib/should-mock-ai.js) is the separate, wider
 * predicate for the AI mock, which local-provider sessions also trip (LIN-388/LIN-405).
 */
export const isTestToken = (workspace) => process.env.NODE_ENV === 'test' && workspace.accessToken === 'test-token';

/**
 * The error ladder shared by the upstream-calling routes, as `[status, message, extra]`
 * ready to spread into `jsonError(res, …)` or `keepaliveError(keepalive, …)`. Arms, in
 * order: a provider 401; "not found" (the message is relayed); an OpenRouter failure.
 * Anything else is the route's own 500.
 * @param {{notFound?: boolean, openRouter?: boolean}} [arms] - which optional arms the route has
 */
export function failureOf(error, fallbackMessage, { notFound: hasNotFoundArm = true, openRouter: hasOpenRouterArm = false } = {}) {
  if (error.response?.status === 401) return [401, 'Token expired or invalid'];
  if (hasNotFoundArm && error.message?.includes('not found')) return [404, error.message];
  if (hasOpenRouterArm && error.message?.includes('OpenRouter')) return [503, 'AI service temporarily unavailable', { message: error.message }];
  return [500, fallbackMessage, { message: error.message }];
}

/**
 * Clean 422 (never a raw NotImplementedError) when the provider cannot do `capability`.
 * @param {string} doing - the tail of "This workspace's provider does not support …"
 */
export function refuseCapability(res, providerName, capability, doing) {
  return jsonError(res, 422, `This workspace's provider does not support ${doing}`, {
    code: 'CAPABILITY_NOT_SUPPORTED', capability, provider: providerName,
  });
}

/**
 * The preamble every issue-addressed route opens with: resolve the issue's own binding
 * (LIN-1904: per the `source` provenance stamp, not always the workspace's active
 * provider), then refuse, in this order, a malformed id, a missing scan-record id, an
 * unconfigured store, and a provider without recommendation context (LIN-1910). Replies
 * and returns null when it refuses.
 * @param {Object} [checks]
 * @param {boolean} [checks.recordId] - the body must carry a scan record `id`
 * @param {*} [checks.store] - the store the route needs, checked with `storeName`
 * @param {string} [checks.storeName] - "<storeName> not configured" (503)
 * @param {string} [checks.capability] - require `fetchRecommendationContext`, worded "<capability> for this issue"
 * @param {boolean} [checks.bind=true] - false where the route resolves the binding only on a branch
 */
export function openIssue(req, res, { recordId = false, store, storeName, capability, bind = true } = {}) {
  const workspace = req.workspace;
  const { issueId } = req.params;
  const binding = bind ? resolveIssueBinding(workspace, req.query.source) : null;

  if (!isValidIssueId(issueId)) {
    badRequest.json(res, 'Invalid issue ID format');
    return null;
  }
  if (recordId && (typeof req.body?.id !== 'string' || !req.body.id)) {
    badRequest.json(res, 'A scan record id is required');
    return null;
  }
  if (storeName && !store) {
    jsonError(res, 503, `${storeName} not configured`);
    return null;
  }
  if (capability && !binding.provider.supports('fetchRecommendationContext')) {
    refuseCapability(res, binding.provider.name, 'fetchRecommendationContext', `${capability} for this issue`);
    return null;
  }
  return { workspace, issueId, recordId: req.body?.id, provider: binding?.provider, callScope: binding?.callScope };
}

export const refuseFreeTier = (res, check) => jsonError(res, 429, check.reason, freeTierRefusalBlock(check));

export const aiNotConfigured = (res, noun) =>
  jsonError(res, 503, `AI ${noun} is not configured. Connect OpenRouter or set OPENROUTER_API_KEY.`, { code: 'AI_NOT_CONFIGURED' });

/** The catch tail of the keepalive routes: stop the keepalive, log, and reply through it with the ladder's answer. */
export function keepaliveFailure(keepalive, label, error, fallbackMessage, arms) {
  keepalive.stop();
  console.error(label, error);
  keepaliveError(keepalive, ...failureOf(error, fallbackMessage, arms));
}

/**
 * The context a recommend-family route works from: the fixtures under a test token,
 * otherwise the provider's. `missing` is true only when the fixture issue is absent;
 * a provider's answer is taken as given.
 */
export async function loadContext(workspace, issueId, { provider, callScope }) {
  if (isTestToken(workspace)) {
    const context = buildMockRecapContext(issueId);
    return { context, missing: !context };
  }
  return { context: await provider.fetchRecommendationContext(callScope, issueId), missing: false };
}
