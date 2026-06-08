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
 *
 * Terminal-state awareness (LIN-353): the resolver also guards the descent against
 * crossing into terminal (Done/Canceled/Duplicate) nodes. `isTerminalState` and
 * `selectFocusSubtask` are pure tree helpers (no network), so importing them keeps
 * the resolver unit-testable without breaking its dependency-free traversal.
 */
import { isTerminalState, selectFocusSubtask } from './tree.js';

/** Default maximum number of defer hops before the descent is truncated. */
export const DEFAULT_DEFER_MAX_DEPTH = 10;

/**
 * Arm a per-hop abort signal for the in-flight LLM/Linear call (gap #3, LIN-346).
 *
 * `resolveRecommendation` checks the shared descent deadline only BETWEEN hops, so a
 * single hop that stalls mid-generation can blow the budget while the resolver waits.
 * Callers wrap each hop's network work with this signal: it fires when either the
 * outer client disconnects (`clientSignal`) OR the remaining descent budget elapses,
 * interrupting the in-flight call rather than only being checked once it returns. The
 * resolver itself stays pure — its between-hops check remains as a coarse guard.
 *
 * Composes via `AbortSignal.any` (Node 20+) so it layers cleanly with a call's own
 * timeout (e.g. CONTEXT_FETCH_TIMEOUT_MS): the caller does
 * `AbortSignal.any([hop.signal, AbortSignal.timeout(...)])` and the first to fire wins.
 *
 * @param {Object} params
 * @param {AbortSignal} [params.clientSignal] - Outer client-disconnect signal, if any.
 * @param {number} [params.deadline=Infinity] - Absolute ms timestamp for the shared
 *   descent budget. When Infinity, no per-hop timeout is armed.
 * @param {() => number} [params.now=Date.now] - Injectable clock (for tests).
 * @returns {{ signal: AbortSignal, release: () => void }} The composed signal plus a
 *   teardown that clears the per-hop timer — call `release()` when the hop settles so
 *   the timer cannot leak across hops.
 */
export function armHopSignal({ clientSignal, deadline = Infinity, now = Date.now } = {}) {
  const signals = [];
  if (clientSignal) signals.push(clientSignal);

  let timeoutId = null;
  if (deadline !== Infinity) {
    // A clearable timer (not AbortSignal.timeout, which has no cancel handle) so the
    // hop's settle can release it — no orphaned 180s timers stacking across hops.
    const timeoutController = new AbortController();
    const remaining = Math.max(0, deadline - now());
    timeoutId = setTimeout(() => timeoutController.abort(), remaining);
    if (typeof timeoutId.unref === 'function') timeoutId.unref();
    signals.push(timeoutController.signal);
  }

  // AbortSignal.any over zero inputs would never abort; fall back to a never-firing
  // signal so the caller can unconditionally thread `hop.signal`.
  const signal = signals.length ? AbortSignal.any(signals) : new AbortController().signal;
  return {
    signal,
    release: () => { if (timeoutId !== null) clearTimeout(timeoutId); }
  };
}

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
 * @returns {Promise<{recommendation: Object, deferredVia: string[], deferTruncated: boolean, deferStopReason: (null|'depth'|'cycle'|'unresolved'|'timeout'|'terminal'|'non-child')}>}
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
      // Terminal-state EDGE guard (LIN-353). Only enforced when the hop surfaced
      // its children (each carrying `state`); a leaner computeOne shape that omits
      // them falls back to the historical permissive descent. Guarding the *edge*
      // (the deferTo step) rather than the landed node is deliberate: it blocks a
      // buggy descent INTO a Done child while still letting a user review a Done
      // ticket directly (that arrives as the depth-0 start node, never an edge).
      const children = Array.isArray(rec.children) ? rec.children : null;
      if (children) {
        const target = children.find(c => c.identifier === rec.deferTo);
        if (!target) {
          // deferTo is not an actual child — reject the hallucinated/cross-tree hop
          // rather than fetching and descending into an arbitrary identifier.
          deferTruncated = true;
          deferStopReason = 'non-child';
          break;
        }
        if (isTerminalState(target.state?.type)) {
          // Refuse the descent into a terminal child; redirect to the deterministic
          // non-terminal pick (the ready crux). When every child is terminal there
          // is nothing to advance to — stop and surface the anomaly.
          const focus = selectFocusSubtask(children);
          if (!focus) {
            deferTruncated = true;
            deferStopReason = 'terminal';
            break;
          }
          identifier = focus.identifier;
          continue;
        }
      }
      identifier = rec.deferTo;
      continue;
    }

    // Landed-node safety net (LIN-353): a descent that LANDS on a terminal node —
    // reached via defer (depth > 0), not named directly as the start node — is a
    // no-op against finished work. Treat it as a non-actionable stop instead of
    // dispatching its action. The start node (depth 0) is always honored whatever
    // its state, so a directly-triggered Done ticket still resolves normally.
    if (depth > 0 && isTerminalState(rec.state?.type)) {
      deferTruncated = true;
      deferStopReason = 'terminal';
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
