/**
 * Shared steps for the workspace API routers (LIN-2246: extracted from
 * workspace-api.js). Both routes/workspace-api.js and
 * routes/workspace-api-prompts.js import them; each is defined here once.
 */

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
