/**
 * Session-materializer precompute composition (LIN-3253, LIN-2948 S3; R2 of
 * PR #1722).
 *
 * `server.js` used to inline the whole `observationMaterializer.precomputeSessionSummary`
 * body: the offline/no-key guard, the run-paragraph call, then the
 * terminal-gated session-summary rollup. That composition was untested —
 * deleting the run-paragraph call left the whole unit suite green (review R2,
 * mutation M9). This module moves it into two small factories:
 *
 *   - `createSessionSummaryPrecompute` — the terminal-gated rollup, moved
 *     verbatim out of `server.js`; no new summary behaviour.
 *   - `createMaterializerPrecompute` — the composition: guard once, run the
 *     paragraph precompute (running OR terminal), then the summary precompute
 *     (which applies its own terminal gate).
 *
 * `server.js` now just assigns the composed result.
 */

import { resolvePrecomputeApiKey } from './run-paragraph-hook.js';
import { hashSession } from './session-summary-cache.js';
import { generateSessionSummary, childLoops, DEFAULT_SESSION_SUMMARY_MODEL } from './session-summary.js';

/**
 * The terminal-gated session-summary precompute, moved verbatim from
 * `server.js`'s inline body. Only terminal sessions are cacheable; the
 * `inputHash` cache check is unchanged.
 *
 * @param {Object} deps
 * @param {Object} deps.sessionSummaryStore - the durable session-summary cache.
 * @param {Function} [deps.isTerminal] - `(session) => boolean` (sessionIsTerminal).
 * @param {Object} [deps.runSummaryStore] - optional child run-summary cache.
 * @param {Function} [deps.generateSummary] - one-call summary generator.
 * @param {Function} [deps.hashSessionFn] - session → inputHash digest.
 * @param {Function} [deps.childLoopsFn] - session → child loops.
 * @param {string} [deps.summaryModel] - the session-summary model tier.
 * @returns {(urlKey: string, session: Object, opts?: {apiKey?: string}) => Promise<void>}
 */
export function createSessionSummaryPrecompute(deps = {}) {
  const {
    sessionSummaryStore,
    isTerminal = () => false,
    runSummaryStore = null,
    generateSummary = generateSessionSummary,
    hashSessionFn = hashSession,
    childLoopsFn = childLoops,
    summaryModel = DEFAULT_SESSION_SUMMARY_MODEL,
  } = deps;

  return async function precomputeSessionSummary(urlKey, session, { apiKey } = {}) {
    if (!sessionSummaryStore) return;
    if (!session?.sessionId) return;
    if (!isTerminal(session)) return;            // only terminal sessions are cacheable

    // Skip if a fresh summary for this exact input is already cached.
    const inputHash = hashSessionFn(session);
    const cached = await sessionSummaryStore.get(urlKey, session.sessionId);
    if (cached && cached.inputHash === inputHash) return;

    // Gather already-cached child run-summary outcomes for richer context — never
    // generate per child (the one-LLM-call cost contract).
    const childOutcomes = {};
    if (runSummaryStore) {
      for (const loop of childLoopsFn(session)) {
        const c = await runSummaryStore.get(urlKey, loop.loopId);
        if (c?.summary?.outcome) childOutcomes[loop.loopId] = c.summary.outcome;
      }
    }

    const { summary, model } = await generateSummary(session, { apiKey, model: summaryModel, childOutcomes });
    await sessionSummaryStore.put(urlKey, session.sessionId, { inputHash, summary, model });
  };
}

/**
 * The composed `observationMaterializer.precomputeSessionSummary` hook: resolve
 * the server-side key once (offline / no key → skip both), then run the
 * run-paragraph precompute for a running OR terminal session, then the session
 * summary precompute (terminal only, its own gate).
 *
 * @param {Object} deps
 * @param {Function} deps.precomputeRunParagraph - `(urlKey, session, {apiKey})`.
 * @param {Function} deps.precomputeSessionSummary - `(urlKey, session, {apiKey})`.
 * @param {Function} [deps.resolveApiKey=resolvePrecomputeApiKey] - the key guard.
 * @returns {(urlKey: string, session: Object) => Promise<void>}
 */
export function createMaterializerPrecompute({
  precomputeRunParagraph,
  precomputeSessionSummary,
  resolveApiKey = resolvePrecomputeApiKey,
} = {}) {
  return async function precomputeSession(urlKey, session) {
    if (!session?.sessionId) return;
    const apiKey = resolveApiKey();            // offline / no key → skip both
    if (!apiKey) return;

    // Run paragraph: runs for a running OR terminal session — the summary's own
    // terminal gate must not suppress it.
    if (precomputeRunParagraph) await precomputeRunParagraph(urlKey, session, { apiKey });

    if (precomputeSessionSummary) await precomputeSessionSummary(urlKey, session, { apiKey });
  };
}
