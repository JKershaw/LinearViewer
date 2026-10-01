/**
 * superseded-selection.js — owner-token selection that skips a credential the
 * registry has recorded as SUPERSEDED (LIN-3186).
 *
 * THE GAP THIS CLOSES. `lib/rejected-credentials.js` marks a provider-rejected
 * credential suspect and `attemptSuspectCredentialRefresh` (LIN-2473) adopts a
 * newer durable credential in its place — but adoption alone did not stop
 * selection from re-picking the SAME dead session row on the next resolve, so
 * the workspace adopted-then-re-rejected on every cache window. This wrapper
 * routes `selectOwnerWorkspaceToken` around the superseded fingerprint.
 *
 * WHY A WRAPPER RATHER THAN A SELECTOR PARAMETER. `selectOwnerWorkspaceToken`'s
 * body is hash-pinned (tests/unit/lin-3124-selector-body-hashes.test.js, D7/T6)
 * and carries the LIN-2278/2349/2275/1982 ranking protections; the accepted
 * design is to route AROUND it, never edit it. This is deliberately a thin,
 * temporary seam to be deleted once the LIN-3124 single-source cutover lands.
 *
 * NEVER A WORKSPACE-WIDE REFUSAL. If filtering out superseded rows would yield
 * no token at all — the superseded credential is the only candidate — this
 * FALLS BACK to the unfiltered selection and serves it. The result is a visible
 * terminal rejection (401, not a retryable 503), never the "refuse to serve a
 * live credential" latch PR #1099 was rejected for. Bounded and fail-visible,
 * not "the loop is impossible".
 *
 * OWNER SCOPING IS UNCHANGED. Only rows `selectOwnerWorkspaceToken` already
 * considers for `ownerAccountId` are filtered; the wrapper can never widen to
 * another account's rows. An UNScoped (owner-blind) caller delegates untouched.
 *
 * SHAPE CONSTRAINT. This module contains EXACTLY ONE call to
 * `selectOwnerWorkspaceToken` (the local `pick` helper) so the
 * `off-session-readers` count pin in tests/unit/lin-3124-pr1-count-pins.test.js
 * stays at 7 when server.js's own call is replaced by this wrapper's. Do not add
 * a second.
 *
 * Depends only on the registry's public read `supersededFingerprints()`; the
 * optional chain lets an older fake registry (or its absence) degrade to the
 * unchanged selector rather than throw.
 */
import { UNSCOPED, selectOwnerWorkspaceToken } from './workspace-token-resolver.js';
import { getWorkspaceCallScope } from './workspace.js';
import { fingerprintCredential } from './credential-diagnostics.js';

/**
 * A structural copy of `row` in which the `urlKey` workspace's `accessToken` is
 * removed when its call-scope fingerprint is superseded. Returns the original
 * row untouched otherwise. Never mutates the input.
 */
function withoutSupersededToken(row, urlKey, superseded) {
  const data = typeof row?.session === 'string' ? JSON.parse(row.session) : row?.session;
  // Named `entry`, not a `w`-suffixed identifier: the `urlkey-lookups` count pin
  // (tests/unit/lin-3124-pr1-count-pins.test.js) counts `/w\??\.urlKey === urlKey/`,
  // and this module must not move that baseline.
  const entry = data?.workspaces?.find(candidate => candidate.urlKey === urlKey);
  if (!entry) return row;
  const fingerprint = fingerprintCredential(getWorkspaceCallScope(entry));
  if (!fingerprint || !superseded.has(fingerprint)) return row;
  const nextData = {
    ...data,
    workspaces: data.workspaces.map(candidate => (candidate === entry ? { ...candidate, accessToken: null } : candidate)),
  };
  return { ...row, session: typeof row?.session === 'string' ? JSON.stringify(nextData) : nextData };
}

/**
 * @param {Array} sessions - same shape `selectOwnerWorkspaceToken` accepts
 * @param {string} urlKey
 * @param {string|symbol} ownerAccountId - `UNSCOPED` delegates untouched
 * @param {Object} [registry] - rejectedCredentialRegistry (may be absent/older fake)
 * @returns {{token: *, reason: string, provider: *, scope?: *, expiresAt?: number}}
 */
export function selectOwnerWorkspaceTokenExcludingSuperseded(sessions, urlKey, ownerAccountId, registry) {
  const pick = rows => selectOwnerWorkspaceToken(rows, urlKey, ownerAccountId);

  const superseded = ownerAccountId === UNSCOPED ? null : registry?.supersededFingerprints?.();
  if (!superseded || superseded.size === 0) return pick(sessions);

  // Run the pinned selector once over the real rows. Only when ITS winner is
  // superseded can removing superseded rows change the outcome — removal is
  // subtractive, so a non-superseded winner is unchanged.
  const baseline = pick(sessions);
  if (!baseline.token) return baseline;
  const baselineFingerprint = fingerprintCredential(baseline.scope ?? baseline.token);
  if (!baselineFingerprint || !superseded.has(baselineFingerprint)) return baseline;

  const filtered = sessions.map(row => withoutSupersededToken(row, urlKey, superseded));
  const filteredResult = pick(filtered);
  // Fallback: never withhold the only credential there is. A superseded-only
  // workspace gets a visible terminal rejection instead of a workspace-wide 503.
  if (!filteredResult.token) return baseline;

  console.log('[credential-superseded-skipped]', JSON.stringify({
    urlKey,
    skippedFingerprint: baselineFingerprint,
    servedFingerprint: fingerprintCredential(filteredResult.scope ?? filteredResult.token),
  }));
  return filteredResult;
}
