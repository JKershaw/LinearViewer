/**
 * lib/credential-state.js
 *
 * Per-session credential DISPLAY state (LIN-1588, Beat 2 of LIN-1577).
 *
 * This module is NOT the credential-health rule. That rule is Beat 1's
 * (`credentialVerdict` / `listCredentialHealth` in lib/proxy-events.js) and it
 * is reused by CALLING it — never forked, extracted, or restated here. What
 * lives here is the one step downstream of the verdict: turning
 * `(agentTokenId, verdict index)` into the three-state value the Live Console
 * lane and the session page both render.
 *
 * It exists as a shared module because BOTH surfaces need exactly that
 * resolution, and two copies of "what does a missing token mean" is precisely
 * how a false `ok` gets introduced on one surface and not the other.
 *
 * Pure and store-free by design: `lib/live-console.js` is a pure, network-free,
 * `now`-injected transform and a Mongo read inside it would be the regression.
 * The ROUTES do the async read, fold it with `foldCredentialIndex`, and inject
 * the resulting index; these helpers only read it.
 */

/**
 * The verdict string Beat 1 emits for a dead credential (lib/proxy-events.js).
 * Matched by exact equality — a verdict this module does not recognise resolves
 * to `unknown`, never to `ok`.
 */
export const CREDENTIAL_DEAD_VERDICT = 'credential_dead';

/**
 * Fold Beat 1's per-workspace `listCredentialHealth(...).tokens` rows into a
 * flat `tokenId → verdict` index for injection into the render surfaces.
 *
 * Accepts rows merged across workspaces. Tokens are workspace-scoped, so a
 * tokenId collision across workspaces is not expected — but if one ever occurs,
 * **`credential_dead` wins**. The invariant this protects is one-directional: a
 * missed death is a triage miss, a fabricated `ok` is the false-healthy reading
 * this ticket exists to prevent.
 *
 * @param {Array<{tokenId: string, verdict: string}>} rows
 * @returns {Object<string, string>} tokenId → verdict
 */
export function foldCredentialIndex(rows) {
  const index = {};
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || !row.tokenId) continue;
    const existing = index[row.tokenId];
    if (existing === CREDENTIAL_DEAD_VERDICT) continue; // dead is never downgraded
    index[row.tokenId] = row.verdict;
  }
  return index;
}

/**
 * Resolve one session's/run's credential display state.
 *
 * Resolution order — the `unknown` branches are the load-bearing ones:
 *   - no token id            → `unknown`. Per LIN-1585 this is the ORDINARY
 *                              case (~99.86% of dispatches have no joinable
 *                              agent-status row), not an edge case.
 *   - token not in the index → `unknown`. No recent events means no evidence,
 *                              and no evidence is NEVER `ok`.
 *   - verdict credential_dead → `dead`
 *   - verdict ok              → `ok`. A WEAK verdict: "no death evidence in the
 *                              last 15 minutes", not "verified healthy".
 *   - anything else           → `unknown` (fail towards no-evidence)
 *
 * @param {string|null|undefined} agentTokenId
 * @param {Object<string, string>} [credentialByToken] - tokenId → verdict
 * @returns {'dead'|'ok'|'unknown'}
 */
export function resolveCredentialState(agentTokenId, credentialByToken = {}) {
  if (agentTokenId == null || agentTokenId === '') return 'unknown';
  const index = credentialByToken || {};
  if (!Object.prototype.hasOwnProperty.call(index, agentTokenId)) return 'unknown';
  const verdict = index[agentTokenId];
  if (verdict === CREDENTIAL_DEAD_VERDICT) return 'dead';
  if (verdict === 'ok') return 'ok';
  return 'unknown';
}

/**
 * Collect the distinct non-null `agentTokenId`s carried by a set of loops.
 *
 * Both routes use this to answer "is a credential read worth doing at all?" —
 * an EMPTY result means skip the read entirely, which is the ~99.86% path and
 * the reason the Live Console poll's cost contract is unchanged.
 *
 * @param {Array<Object>} loops
 * @param {(loop: Object) => boolean} [filter] - optional per-loop predicate (e.g. isLoopActive)
 * @returns {Set<string>}
 */
export function collectAgentTokenIds(loops, filter = null) {
  const ids = new Set();
  for (const loop of Array.isArray(loops) ? loops : []) {
    if (!loop) continue;
    if (filter && !filter(loop)) continue;
    if (loop.agentTokenId) ids.add(loop.agentTokenId);
  }
  return ids;
}
