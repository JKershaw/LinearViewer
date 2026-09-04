/**
 * GraphQL error-shape + write-payload normalization helpers extracted from
 * routes/proxy.js (LIN-2548, Stage 2.5 of LIN-679). Verbatim relocation of
 * the four pure helpers in the graphqlError* family — `graphqlErrorStatus`
 * and its shared helper `isTransientProviderAuthFailure` deliberately stay
 * in routes/proxy.js (registry-bound + source-text pinned); `writeRejected`
 * stays too (route-local `logEvent`/`jsonError`).
 */
import { classifyUpstreamError } from './errors.js';
import { STAGE_PROVIDER_LANE } from './proxy-events.js';

/**
 * LIN-2216: the extra JSON fields a data-route auth-shaped (401/503)
 * response carries, alongside the existing `detail` every one of these
 * ~28 catch blocks already sends. Every other status (404/429/400/500) is
 * untouched — `{}` — so this diff changes nothing about their response
 * shape. Reuses `classifyUpstreamError`'s existing `LINEAR_AUTH` code/
 * category (the same vocabulary render-pages.js's human-facing error page
 * and the autopilot/kickoff branch below both use for this exact upstream
 * shape) so a consumer built against docs/proxy-integration.md's
 * documented 503 contract has a machine-matchable field to update against,
 * not just a status-code split it has to infer (found by code review —
 * that doc's Best Practice #4 said "a 503 means re-authenticate", which
 * this ticket's new transient-503 case makes only conditionally true; see
 * the doc update alongside this change).
 *
 * LIN-1985: a genuine (non-transient-reclassified) 401 here always means
 * `stage: 'provider-lane'` — this function is only ever reached from a
 * route's catch block AFTER the route's own `if (!token) return
 * workspaceUnavailable(...)` guard already passed, so the error came from
 * an actual upstream call to `provider.*`, never from a caller-token
 * rejection (that class 401s from `authenticateProxyToken`, before any
 * provider is ever touched — see `PROXY_TOKEN_REJECTED_EXTRA` above, its
 * counterpart). Stamping it explicitly here — rather than leaving the
 * agent to infer stage from `code === 'LINEAR_AUTH'` — is the fix for the
 * LIN-1985 gap: before this, the two failure classes' response bodies
 * were undocumented and easy to conflate (one carried `code`/`category`,
 * the other carried nothing at all, with no field either way that named
 * the distinction directly). Deliberately NOT added to the 503 branch:
 * that status already carries its own richer, already-documented
 * discriminators (`workspaceUnavailableEnvelope`'s per-reason `code`s, or
 * `provider-503-transient`'s `LINEAR_AUTH` — both unambiguously
 * provider-lane by construction, so a same-valued `stage` there would be
 * redundant, not clarifying).
 *
 * @param {*} err
 * @param {number} status - the value `graphqlErrorStatus(err, req)` already returned
 * @returns {{code?: string, category?: string, retryable?: boolean, stage?: string}}
 */
export function graphqlErrorExtra(err, status) {
  if (status !== 401 && status !== 503) return {};
  const classification = classifyUpstreamError(err);
  return {
    code: classification.code,
    category: classification.category,
    retryable: status === 503,
    ...(status === 401 ? { stage: STAGE_PROVIDER_LANE } : {})
  };
}

/**
 * Extract a human-readable error message from a GraphQL error.
 *
 * graphql-request splits errors into two buckets:
 *  - err.response.errors[].message  → originated from Linear's GraphQL
 *    response. These describe resource state or API misuse and are safe
 *    to pass through — callers (especially autonomous agents) need them
 *    to self-diagnose.
 *  - err.message                    → network / fetch / parse failure,
 *    potentially containing internal stack traces or proxy-level details.
 *    Log server-side and return a generic message to the caller.
 *
 * Within the first bucket, `extensions.userPresentableMessage` is preferred
 * over the top-level `message` when Linear supplies one: it is the same trust
 * class (Linear-authored, on the same `errors[0]`, explicitly named as
 * caller-presentable) but far more actionable — "after is not a valid
 * pagination cursor identifier." instead of the generic "Argument Validation
 * Error", which is precisely the self-diagnosis this policy exists to serve.
 * Only that one string is surfaced: the sibling `extensions.validationErrors`
 * carries the whole echoed variables object and stays server-side. (LIN-1511)
 *
 * `req` (LIN-2351) supplies the resolved provider's display name, stamped by
 * `resolveProviderAccess` onto `req.resolvedProvider`, so the fallback and
 * timeout strings — and the auth-error log line — name the actual backend
 * instead of hardcoding Linear. On a Linear workspace `displayName` is
 * `'Linear'`, so this yields the byte-identical strings this function
 * always returned; when nothing is stamped (an error thrown before
 * `resolveProviderAccess` resolves) the wording stays provider-neutral
 * rather than guessing `'Linear'`.
 */

/**
 * The declared provider's display name for identity-asserting prose (LIN-2354:
 * the "currently backed by X" clause), or `null` when nothing was actually
 * declared. Deliberately gated on `req.resolvedProvider.declared`, NOT a bare
 * read of `.displayName` — `.displayName` always names some provider (Linear
 * included) once `resolveProviderAccess`'s legacy fallback applies, which is
 * exactly the "unresolved workspace reads as Linear" defect this ticket fixes.
 * `.declared` is the pre-fallback name, `null` only when truly unresolved.
 *
 * @param {import('express').Request} req
 * @returns {string|null}
 */
export function declaredProviderDisplayName(req) {
  return req?.resolvedProvider?.declared ? req.resolvedProvider.displayName : null;
}

export function graphqlErrorDetail(err, req) {
  const displayName = req?.resolvedProvider?.displayName;
  if (err.name === 'TimeoutError' || err.name === 'AbortError') {
    return displayName
      ? `${displayName} API request timed out — the response may be too large or ${displayName} is slow. Try a more specific query.`
      : 'The upstream request timed out — the response may be too large or the provider is slow. Try a more specific query.';
  }

  const gqlError = err.response?.errors?.[0];
  const gqlMessage = gqlError?.extensions?.userPresentableMessage || gqlError?.message;
  if (gqlMessage) {
    const status = err.response?.status || err.response?.errors?.[0]?.extensions?.statusCode;
    if (status === 401 || status === 403) {
      console.error(`${displayName ?? 'Provider'} auth error (HTTP ${status}): ${gqlMessage}`);
    }
    return gqlMessage;
  }

  console.error('GraphQL error detail (suppressed from response):', err.message || 'Unknown error');
  return displayName ? `${displayName} API request failed` : 'The upstream provider request failed';
}

/**
 * Normalize a provider write result into the `{ success, <entityKey> }`
 * envelope the route echoes and `writeRejected` guards (LIN-584).
 *
 * Linear's mutation methods already return that envelope (Linear's
 * *Create/*Update payloads carry a `success` boolean), so they pass through
 * BYTE-IDENTICAL — the Linear proxy path is unchanged. Providers whose write
 * methods return the bare canonical entity instead (LocalProvider's LIN-356
 * create/update methods, which stay bare for their non-proxy callers; the
 * GitHub provider) are wrapped here: a truthy entity is a landed write, a
 * null/undefined one (e.g. updateIssue on a missing target) is a rejected
 * write that `writeRejected` will surface as a 502. This keeps the proxy
 * write path provider-agnostic without forcing every provider onto Linear's
 * payload shape.
 *
 * @param {*} result - the provider's write return value
 * @param {string} entityKey - the payload key Linear uses ('issue'|'comment'|'issueRelation')
 * @returns {{success: boolean}} the normalized envelope
 */
export function normalizeWritePayload(result, entityKey) {
  if (result && typeof result === 'object' && 'success' in result) return result;
  return { success: !!result, [entityKey]: result ?? null };
}
