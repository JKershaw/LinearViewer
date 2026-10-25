/**
 * The one place an absolute URL's origin comes from (LIN-3692, for LIN-3643).
 *
 * `PUBLIC_ORIGIN` (or its older alias, resolved by `resolveEmailLinkOrigin`)
 * pins every generated link to one host, so a forged `Host:` header cannot
 * steer a link, a callback or a worker's base URL. When it is unset, the
 * origin is derived from the request as before, so tests and local use are
 * unchanged. An invalid configured value behaves as unset: this never returns
 * null, and the alias is not consulted (that rule lives in
 * `resolveEmailLinkOrigin`).
 *
 * Reads only `req.protocol` and `req.get('host')`; no trailing slash.
 * This file deliberately never spells the alias variable's name: the Q15 scan
 * in tests/unit/email-import-boundary.test.js allows only the email modules to.
 */
import { resolveEmailLinkOrigin } from './email-availability.js';

const SAFE_HOST = /^[a-z0-9.-]+(:\d+)?$/i;

/**
 * @param {{ protocol: string, get: (name: string) => (string|undefined) }} req
 * @param {{ env?: Object, safeHost?: boolean }} [options] `safeHost` validates
 *   the Host header and falls back to `harbour.cat` (the public library's
 *   canonical tags, formerly its own `baseUrl()`).
 * @returns {string}
 */
export function publicOrigin(req, { env = process.env, safeHost = false } = {}) {
  const configured = resolveEmailLinkOrigin(env);
  if (configured !== null) return configured;
  let host = req.get('host');
  if (safeHost) {
    host = host || 'harbour.cat';
    if (!SAFE_HOST.test(host)) host = 'harbour.cat';
  }
  return `${req.protocol}://${host}`;
}

/**
 * `publicOrigin`, or null when there is no origin to build from: no configured
 * origin and no Host header. publicOrigin() would return `http://undefined` there,
 * so a caller that queues work for a callback must refuse instead (LIN-3908).
 * @param {{ protocol: string, get: (name: string) => (string|undefined) }} req
 * @param {{ env?: Object }} [options]
 * @returns {string|null}
 */
export function requestOriginOrNull(req, { env = process.env } = {}) {
  if (resolveEmailLinkOrigin(env) === null && !req.get('host')) return null;
  return publicOrigin(req, { env });
}

/**
 * The one refusal for a request that would embed an origin it does not have (LIN-3908 for the
 * feedback lanes, LIN-3931 for every other site that writes the origin into run or kickoff text).
 * Non-retryable: a retry from the same request cannot succeed. The fix is a Host header or a
 * configured PUBLIC_ORIGIN. Every site answers with this one code and message.
 */
export const ORIGIN_UNRESOLVED_REFUSAL = {
  code: 'ORIGIN_UNRESOLVED',
  retryable: false,
  message: 'This request has no Host header and PUBLIC_ORIGIN is not set, so a run could not call back to this workspace.',
};
