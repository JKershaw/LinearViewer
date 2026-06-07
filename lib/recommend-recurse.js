/**
 * Server-side recommendation recursion (LIN-329).
 *
 * The recommender can emit a `defer` routing decision (LIN-327): "the real next
 * action lives at child X, not here." `defer` is a meta action — it must be
 * resolved entirely server-side, before any dispatch, so no consumer ever receives
 * a `defer` to act on. This module is that resolver: given a single-hop recommend
 * function, it follows `defer` decisions down the task tree until it reaches the
 * first node whose recommendation is *real work* (a non-`defer` action), and
 * returns that terminal recommendation plus the descent breadcrumb.
 *
 * It is deliberately pure and dependency-free — the per-hop Linear fetch + LLM call
 * is injected as `computeOne(identifier)` — so the traversal, its guards, and the
 * shared cross-hop budget are unit-testable without a network. The three recommend
 * surfaces (proxy GET /recommend, proxy recommend-and-dispatch, workspace-api UI)
 * all wrap their own `computeOne` with this same resolver.
 */

/** Default maximum number of defer hops before the descent is truncated. */
export const DEFAULT_DEFER_MAX_DEPTH = 10;

/**
 * Resolve a recommendation, following `defer` decisions to a terminal actionable node.
 *
 * @param {Object} params
 * @param {(identifier: string) => Promise<Object>} params.computeOne - One recommend
 *   hop. Returns a recommendation `{ identifier, recommendedAction, deferTo, prompt, ... }`.
 *   Throws an Error whose message includes "not found" when an identifier doesn't resolve.
 * @param {string} params.startIdentifier - The node to start from.
 * @param {number} [params.maxDepth=DEFAULT_DEFER_MAX_DEPTH] - Depth cap (hops).
 * @param {number} [params.deadline=Infinity] - Absolute ms timestamp; the descent stops
 *   before starting a hop once `now() >= deadline` (shared cross-hop budget).
 * @param {() => number} [params.now=Date.now] - Injectable clock (for tests).
 * @param {(rec: Object, info: {depth: number, deferring: boolean}) => (void|Promise<void>)} [params.onHop]
 *   Optional callback invoked after each successful hop, before the descent continues.
 *   Lets a streaming caller surface the descent live (e.g. SSE breadcrumbs) without the
 *   resolver knowing anything about transport. `deferring` is true when this hop is a
 *   defer that will be followed.
 * @returns {Promise<{recommendation: Object, deferredVia: string[], deferTruncated: boolean, deferStopReason: (null|'depth'|'cycle'|'unresolved'|'timeout')}>}
 *   `recommendation` is the terminal hop's result. On a clean finish it is a real
 *   (non-`defer`) action carrying a prompt; on an abnormal stop (`deferTruncated`)
 *   it is the last node reached, which may still be a `defer` with no prompt — the
 *   caller must treat that as an anomaly to surface, not dispatch. `deferredVia` is
 *   the ordered list of nodes actually recommended (length 1 ⇒ no descent happened).
 */
export async function resolveRecommendation({
  computeOne,
  startIdentifier,
  maxDepth = DEFAULT_DEFER_MAX_DEPTH,
  deadline = Infinity,
  now = Date.now,
  onHop
}) {
  const deferredVia = [];
  const visited = new Set();
  let identifier = startIdentifier;
  let recommendation = null;
  let deferTruncated = false;
  let deferStopReason = null;

  for (let depth = 0; ; depth++) {
    // Depth cap — stop rather than loop forever down a pathological tree.
    if (depth >= maxDepth) {
      deferTruncated = true;
      deferStopReason = 'depth';
      break;
    }
    // Shared cross-hop budget — stop before spending another fetch + LLM call.
    if (now() >= deadline) {
      deferTruncated = true;
      deferStopReason = 'timeout';
      break;
    }
    // Cycle guard — a deferTo pointing back at an already-recommended node.
    if (visited.has(identifier)) {
      deferTruncated = true;
      deferStopReason = 'cycle';
      break;
    }

    let rec;
    try {
      rec = await computeOne(identifier);
    } catch (err) {
      // A deferTo that doesn't resolve (missing / invalid child): stop at the
      // node that deferred (recommendation stays its defer rec) and surface the
      // anomaly. A first-hop failure (the caller's own start id is bad) is a real
      // error — rethrow it so the route reports not-found as it always has.
      if (recommendation && /not found/i.test(err && err.message)) {
        deferTruncated = true;
        deferStopReason = 'unresolved';
        break;
      }
      throw err;
    }

    deferredVia.push(identifier);
    visited.add(identifier);
    recommendation = rec;

    const deferring = rec.recommendedAction === 'defer' && !!rec.deferTo;
    if (onHop) await onHop(rec, { depth, deferring });

    // Follow a defer; otherwise this node's action is real work — terminal.
    if (deferring) {
      identifier = rec.deferTo;
      continue;
    }
    break;
  }

  return { recommendation, deferredVia, deferTruncated, deferStopReason };
}

/**
 * Build a one-line descent breadcrumb for narration, e.g.
 *   "LIN-318 is a container → descended to LIN-297 (research)"
 * Returns null when no descent happened (deferredVia has a single node), so callers
 * can omit the line for ordinary direct recommendations.
 *
 * @param {string[]} deferredVia - The ordered descent path from resolveRecommendation.
 * @param {Object} recommendation - The terminal recommendation.
 * @returns {string|null}
 */
export function describeDescent(deferredVia, recommendation) {
  if (!Array.isArray(deferredVia) || deferredVia.length < 2) return null;
  const top = deferredVia[0];
  const terminal = recommendation?.identifier || deferredVia[deferredVia.length - 1];
  const action = recommendation?.recommendedAction || 'work';
  return `${top} is a container → descended to ${terminal} (${action})`;
}
