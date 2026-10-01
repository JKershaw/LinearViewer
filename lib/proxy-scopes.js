/**
 * Proxy token scope + grant vocabulary (LIN-3129 / LIN-3059 S1, decision
 * lin3059-credential-boundary-j1-j4).
 *
 * One vocabulary, shared by the token model and every site that validates,
 * enforces or mints it. Scopes are the base capability on a proxy token; grants
 * are the closed set of extra authorities a credential can carry. `take` gates
 * the runner mounts; `dispatch` gates the three enqueue mounts
 * (`requireGrant('dispatch')`, LIN-2884 T3 / LIN-3136).
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
// `dispatch` gates enqueue (POST /dispatch, /recommend-and-dispatch,
// /autopilot/kickoff).
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

// LIN-3132 (LIN-3059 S1b): the closed lifetime-profile table. Declaring a grant
// changes authority, never lifetime — so a grant-bearing mint picks one of these
// two named profiles and the exchange derives the working TTL from the profile
// STAMPED on the bootstrap, never from a caller/route `ttl`.
//
//   runner — J3(b): 1h bootstrap, 24h working (unchanged).
//   worker — LIN-376's native agent lifetimes: 48h bootstrap (must outlive the
//            24h dispatch queue), 48h working.
export const LIFETIME_PROFILES = Object.freeze({
  runner: Object.freeze({ bootstrapTtlSeconds: 3600, workingTtlSeconds: 86400 }),
  worker: Object.freeze({ bootstrapTtlSeconds: 172800, workingTtlSeconds: 172800 })
});

// J3(b): the runner profile's values, kept as named exports for the existing
// readers. Derived from the table so the two can never drift apart.
export const RUNNER_BOOTSTRAP_TTL_SECONDS = LIFETIME_PROFILES.runner.bootstrapTtlSeconds;
export const RUNNER_WORKING_TTL_SECONDS = LIFETIME_PROFILES.runner.workingTtlSeconds;

/**
 * Resolve a lifetime-profile NAME to a known profile name, failing safe to the
 * tighter `runner` profile. An own-property check (not truthiness or a property
 * read) means a missing, non-string, or unknown name — including inherited keys
 * like `constructor`/`__proto__` — can never widen a lifetime.
 *
 * @param {unknown} name
 * @returns {'runner'|'worker'}
 */
export function resolveLifetimeProfile(name) {
  return (typeof name === 'string' && Object.prototype.hasOwnProperty.call(LIFETIME_PROFILES, name))
    ? name
    : 'runner';
}
