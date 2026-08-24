import { createHash } from 'node:crypto';

/**
 * credential-diagnostics.js — secret-safe description of WHICH credential a
 * request authenticated with, and what the server believed about it.
 *
 * Why this exists (2026-08-09 incident). Production served a sustained wall of
 * `Proxy /issue error: Authentication required, not authenticated` — Linear
 * rejecting the workspace credential — at roughly one per second for ~25
 * minutes. The logs could not answer a single one of the questions that would
 * have identified it:
 *
 *   - Which credential did this call actually use? (One operator's own proxy
 *     token read the SAME issue ids at 200 in the same window, so the failure
 *     was credential-specific, not workspace-wide. Nothing in the logs could
 *     distinguish the two.)
 *   - Where did that credential come from — the 30s cache, the session scan, or
 *     refresh-on-resolve?
 *   - What expiry did the server think it had? (`selectOwnerWorkspaceToken`
 *     admits any token whose `tokenExpiresAt` is in the future, so a REVOKED
 *     token is indistinguishable from a healthy one until Linear answers 401.)
 *   - Which provider was resolved, and was the credential the right SHAPE for
 *     it? (`linkProvider`'s scalar mirror writes the newly-linked provider's
 *     token onto the workspace whenever `workspace.provider` is unset — the
 *     legacy Linear state — so a cross-provider credential landing on a Linear
 *     call is a real, reachable state.)
 *
 * Every field here is derived from values the server already holds at the
 * moment of failure. Nothing is fetched, nothing is stored.
 *
 * PRIVACY CONTRACT — identical to `describeWorkspaceResolution`
 * (lib/workspace-token-resolver.js), which this is modelled on:
 *   - NEVER any token bytes, in any field, under any shape.
 *   - NEVER another account's id. `ownerAccountId` is the CALLER'S OWN owner
 *     stamp, which the proxy already logs and returns in its 503 envelopes.
 *   - Only public workspace slugs, provider names, and derived booleans.
 * A credential is represented ONLY by `credentialFingerprint` (below), which is
 * one-way and carries no recoverable material.
 *
 * Pure over its arguments (`now` injected), so the whole module is unit-testable
 * without a request, a clock, or a store — the same discipline as
 * lib/live-console.js and lib/periodical-runs.js.
 */

/**
 * Expiry values at or above this are the codebase's "never expires" sentinel
 * rather than a real timestamp — GitHub-family and Jira Basic bindings store
 * `Number.MAX_SAFE_INTEGER` (≈ year 287396) for credentials with no expiry.
 *
 * This is load-bearing diagnostically, not cosmetic. Before LIN-1982,
 * `selectOwnerWorkspaceToken` ranked candidates by raw MAXIMUM `tokenExpiresAt`,
 * so a sentinel expiry mirrored onto a workspace's scalar fields (e.g. by
 * LIN-1981's `linkProvider` mis-mirror) won selection PERMANENTLY over a
 * genuine, actively-refreshed token — no refresh or reconnect could outbid a
 * fake "never". LIN-1982 fixed the selector itself (`isBetterCandidate` in
 * lib/workspace-token-resolver.js): a finite expiry now always beats a
 * sentinel regardless of magnitude, so that failure mode is closed. A sentinel
 * still wins, correctly, when it is the ONLY eligible candidate (the ordinary
 * case for a Local/PAT/Basic-only workspace) — this field remains useful for
 * spotting that a resolved credential IS a sentinel, e.g. to distinguish that
 * ordinary case from a cross-provider mis-mirror, even though a sentinel can
 * no longer silently outrank a healthy finite-expiry token.
 *
 * Year 3000 as the boundary: comfortably above any real OAuth expiry, comfortably
 * below the sentinel, and readable as "obviously not a real date".
 */
export const SENTINEL_EXPIRY_FLOOR_MS = Date.UTC(3000, 0, 1);

/** How the resolver obtained the credential it handed back. */
export const CREDENTIAL_SOURCES = Object.freeze({
  CACHE: 'cache',
  SESSION_SCAN: 'session-scan',
  REFRESH_ON_RESOLVE: 'refresh-on-resolve',
});

/**
 * Pull the raw secret out of whichever call-scope shape a provider uses, so the
 * fingerprint below identifies the same credential regardless of how it is
 * wrapped. Mirrors the shapes `getWorkspaceCallScope` (lib/workspace.js) emits.
 *
 * Returns null for anything with no token in it — never throws, never coerces a
 * non-string to one (a coerced object would fingerprint every distinct
 * credential to the identical '[object Object]' digest, silently defeating the
 * whole point of this module).
 */
function extractSecret(credential) {
  if (typeof credential === 'string') return credential || null;
  if (!credential || typeof credential !== 'object') return null;
  const candidate = credential.token ?? credential.apiToken ?? credential.accessToken;
  return typeof candidate === 'string' && candidate ? candidate : null;
}

/**
 * A stable, one-way, non-reversible id for a credential: the first 12 hex chars
 * of its SHA-256.
 *
 * This is the field that answers "are these two callers using the SAME
 * credential?" — the question that went unanswerable during the incident, when
 * one token 200'd and another 401'd against the identical workspace, endpoint,
 * and issue ids.
 *
 * Safe to log. The inputs are always high-entropy machine-generated secrets
 * (OAuth access tokens, API tokens), so a truncated digest is not a meaningful
 * disclosure — there is no small candidate space to enumerate against it. It is
 * deliberately UNSALTED so the same credential fingerprints identically across
 * replicas and restarts; a per-process salt would make cross-replica correlation
 * impossible, which is most of the value here. 12 chars (48 bits) is far more
 * than enough to distinguish the handful of credentials a workspace ever holds
 * while staying short enough to scan by eye in a log.
 *
 * @returns {string|null} fingerprint, or null when there is no credential
 */
export function fingerprintCredential(credential) {
  const secret = extractSecret(credential);
  if (!secret) return null;
  return createHash('sha256').update(secret).digest('hex').slice(0, 12);
}

/**
 * Name the call-scope SHAPE a credential is wrapped in, without inspecting its
 * secret. Mirrors `getWorkspaceCallScope`/`getBindingCallScope`
 * (lib/workspace.js) one-for-one.
 */
export function describeCredentialShape(credential) {
  if (credential === null || credential === undefined) return 'absent';
  if (typeof credential === 'string') return 'bare-token';
  if (typeof credential !== 'object') return 'unrecognised';
  if (credential.ambiguousCallScope === true) return 'ambiguous';
  if (credential.authType === 'oauth') return 'jira-oauth';
  if ('apiToken' in credential || 'email' in credential) return 'jira-basic';
  if ('repo' in credential) return 'github';
  if ('scope' in credential) return 'github-projects';
  return 'unrecognised-object';
}

/** The credential shape each provider's `_clientFor` actually expects. */
const EXPECTED_SHAPE = Object.freeze({
  linear: 'bare-token',
  local: 'bare-token',
  jira: 'jira-basic',
  github: 'github',
  'github-projects': 'github-projects',
});

/**
 * Does the credential's shape match what the resolved provider expects?
 *
 * A mismatch is the direct, on-sight signature of a cross-provider credential
 * leak through `linkProvider`'s scalar mirror — e.g. a Jira credential
 * authenticating a Linear GraphQL call. Reported as a boolean rather than
 * inferred later from two separate fields, so it is greppable on its own.
 *
 * Jira accepts either of its two auth shapes; every other provider has exactly
 * one. An unknown provider name yields null (no expectation to compare against)
 * rather than a false positive.
 *
 * @returns {boolean|null} true on mismatch, false on match, null when unknown
 */
export function detectShapeMismatch(providerName, credential) {
  const expected = EXPECTED_SHAPE[providerName || 'linear'];
  if (!expected) return null;
  const actual = describeCredentialShape(credential);
  if (actual === 'absent') return null;
  if (expected === 'jira-basic') return actual !== 'jira-basic' && actual !== 'jira-oauth';
  return actual !== expected;
}

/**
 * Classify a recorded expiry, and say how long the server believed it had left.
 *
 * `expiryKind` separates the three cases that behave completely differently
 * under selection: `absent` (no expiry recorded), `sentinel` (never-expires —
 * permanently wins selection, see SENTINEL_EXPIRY_FLOOR_MS), and `finite`.
 */
export function describeExpiry(expiresAt, now = Date.now()) {
  if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) {
    return { expiryKind: 'absent', expiresAt: null, msUntilExpiry: null };
  }
  if (expiresAt >= SENTINEL_EXPIRY_FLOOR_MS) {
    return { expiryKind: 'sentinel', expiresAt: null, msUntilExpiry: null };
  }
  return {
    expiryKind: 'finite',
    expiresAt: new Date(expiresAt).toISOString(),
    msUntilExpiry: expiresAt - now,
  };
}

/**
 * The full secret-safe descriptor of one credential resolution.
 *
 * Assembled once per provider-lane resolution and held only long enough to be
 * attached to a failure (see the recorder in routes/proxy.js). On its own it
 * says nothing interesting; paired with a 401 it says exactly which credential,
 * from which source, with which believed expiry, on which provider, was the one
 * the upstream rejected.
 */
export function describeCredentialResolution({
  urlKey,
  ownerAccountId,
  provider,
  credential,
  source,
  expiresAt,
} = {}, now = Date.now()) {
  return {
    urlKey: urlKey ?? null,
    // The CALLER'S OWN owner stamp only — never another account's id. A null
    // owner is its own diagnosis (an ownerless token can never resolve), so it
    // is rendered explicitly rather than omitted.
    ownerAccountId: ownerAccountId ? String(ownerAccountId) : '<null>',
    // A legacy workspace carries no `provider` and is read as Linear everywhere
    // (normalizeProviderName); rendering that explicitly keeps "defaulted" and
    // "explicitly linear" distinguishable in the log, which matters because only
    // the FORMER is exposed to linkProvider's scalar-mirror clobber.
    provider: provider || '<unset:defaults-to-linear>',
    credentialSource: source ?? 'unknown',
    credentialFingerprint: fingerprintCredential(credential),
    credentialShape: describeCredentialShape(credential),
    shapeMismatch: detectShapeMismatch(provider, credential),
    ...describeExpiry(expiresAt, now),
  };
}
