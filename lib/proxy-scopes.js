/**
 * Proxy token scope + grant vocabulary (LIN-3129 / LIN-3059 S1, decision
 * lin3059-credential-boundary-j1-j4).
 *
 * One vocabulary, shared by the token model and every site that validates,
 * enforces or mints it. Scopes are the base capability on a proxy token; grants
 * are the closed set of extra authorities a credential can carry. `dispatch` is
 * recorded now (J2(a)) but not enforced until LIN-2884 adds `requireGrant`; S1
 * only lays the groundwork, so nothing reads grants at a mount yet.
 *
 * Keep this file a leaf: no imports, no side effects. It is imported by
 * routes/proxy.js, lib/proxy-tokens.js, routes/proxy-tokens-admin.js,
 * routes/dispatch.js and lib/proxy-preamble.js (the A2 five).
 */

export const READ = 'read';
export const READ_WRITE = 'readWrite';

// The only two token scopes. Frozen so no site can widen the vocabulary in
// place and quietly create a second dialect.
export const SCOPES = Object.freeze([READ, READ_WRITE]);

// J1/J2(a): the closed grant set. `take` gates runner poll/take/feedback;
// `dispatch` is stamped now and enforced by LIN-2884.
export const GRANTS = Object.freeze(['take', 'dispatch']);

// The runner credential carries the whole set (J2(a)).
export const RUNNER_GRANTS = Object.freeze(['take', 'dispatch']);

/**
 * Whether a grant is present in a grants value. Fails closed on anything that
 * is not an array (null/undefined/string/object), so an ownerless document or a
 * malformed field can never be read as holding authority.
 *
 * @param {unknown} grants
 * @param {string} name
 * @returns {boolean}
 */
export function hasGrant(grants, name) {
  return Array.isArray(grants) && grants.includes(name);
}

// J3(b): the runner bootstrap lives one hour and the exchanged working token
// 24 hours. The working TTL is forced by the exchange and cannot be extended by
// a route-supplied TTL.
export const RUNNER_BOOTSTRAP_TTL_SECONDS = 3600;
export const RUNNER_WORKING_TTL_SECONDS = 86400;
