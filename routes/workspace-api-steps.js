/**
 * Shared steps for the workspace API routers (LIN-2246: extracted from
 * workspace-api.js). routes/workspace-api.js, routes/workspace-api-prompts.js
 * (failureOf) and routes/workspace-api-issue-read.js (failureOf, openIssue) and
 * routes/workspace-api-issue-write.js (refuseCapability) and
 * routes/workspace-api-feedback.js (refuseCapability) import them; each is defined here once. `openIssue` and
 * `refuseCapability` moved here with LIN-3872; `refuseFreeTier` with LIN-3877. LIN-4537 retired
 * `aiNotConfigured`, `keepaliveFailure` and `loadContext` with the recap and brief routes, their only readers.
 */
import { badRequest, jsonError } from '../lib/errors.js';
import { freeTierRefusalBlock } from '../lib/chat-request.js';
import { truncationFailureOf } from '../lib/openrouter.js';
import { isValidIssueId, resolveIssueBinding } from '../lib/workspace.js';

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
  // LIN-4358: a cut-off model answer is its own failure, named as such, whatever the arms.
  const truncated = truncationFailureOf(error);
  if (truncated) return truncated;
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
 * provider), then refuse, in this order, a malformed id and a provider without
 * recommendation context (LIN-1910). Replies
 * and returns null when it refuses.
 * @param {Object} [checks]
 * @param {string} [checks.capability] - require `fetchRecommendationContext`, worded "<capability> for this issue"
 * @param {boolean} [checks.bind=true] - false where the route resolves the binding only on a branch
 */
export function openIssue(req, res, { capability, bind = true } = {}) {
  const workspace = req.workspace;
  const { issueId } = req.params;
  const binding = bind ? resolveIssueBinding(workspace, req.query.source) : null;

  if (!isValidIssueId(issueId)) {
    badRequest.json(res, 'Invalid issue ID format');
    return null;
  }
  if (capability && !binding.provider.supports('fetchRecommendationContext')) {
    refuseCapability(res, binding.provider.name, 'fetchRecommendationContext', `${capability} for this issue`);
    return null;
  }
  return { workspace, issueId, provider: binding?.provider, callScope: binding?.callScope };
}

export const refuseFreeTier = (res, check) => jsonError(res, 429, check.reason, freeTierRefusalBlock(check));
