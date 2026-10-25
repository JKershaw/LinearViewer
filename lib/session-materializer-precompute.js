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

import { resolvePrecomputeCredential } from './run-paragraph-hook.js';
import { checkFreeTierGate } from './chat-request.js';
import { hashSession } from './session-summary-cache.js';
import { generateSessionSummary, childLoops } from './session-summary.js';

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
 * @param {Function} [deps.resolveModel] - async `({urlKey, jobId, isFreeTier}) => modelId` (LIN-3856);
 *   unwired, the generator keeps DEFAULT_MODEL.
 * @param {Object} [deps.freeTierStore] - the shared hourly free-tier store (LIN-3875). On the
 *   free key the precompute charges it right before the generator call; unwired on the free
 *   key it fails closed (skips) rather than bypass the gate.
 * @returns {(urlKey: string, session: Object, opts?: {apiKey?: string, isFreeTier?: boolean}) => Promise<void>}
 */
export function createSessionSummaryPrecompute(deps = {}) {
  const {
    sessionSummaryStore,
    isTerminal = () => false,
    runSummaryStore = null,
    generateSummary = generateSessionSummary,
    hashSessionFn = hashSession,
    childLoopsFn = childLoops,
    resolveModel = null,
    freeTierStore = null,
  } = deps;

  return async function precomputeSessionSummary(urlKey, session, { apiKey, isFreeTier = false } = {}) {
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

    // LIN-3856: the job's stored setting, or the free-tier clamp on the shared free key.
    // A store failure throws before any write, so no summary is stored.
    const resolved = resolveModel ? await resolveModel({ urlKey, jobId: 'session-summary', isFreeTier }) : undefined;

    // LIN-3875: the hourly free-tier gate, charged only now that a generator call is certain
    // (after the cache hit and model resolution) — never in createMaterializerPrecompute,
    // which also runs on cache hits. A refusal stores nothing and retries on the next
    // rebuild or click; an unwired store on the free key fails closed.
    if (isFreeTier) {
      if (!freeTierStore) return;
      if (await checkFreeTierGate({ isFreeTier, urlKey, freeTierStore })) return;
    }
    const { summary, model } = await generateSummary(session, {
      apiKey,
      model: resolved,
      childOutcomes,
      // LIN-3852: logs as the on-demand `session-summary` job (no job of its own).
      // LIN-3864: `via` tells this background row apart from the user-triggered
      // on-demand row that shares the job id (lib/llm-call-log.js `listCalls`).
      callMeta: { urlKey, via: 'precompute' },
    });
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
 * @param {Function} [deps.resolveCredential=resolvePrecomputeCredential] - the key guard; `{apiKey, isFreeTier}` or null.
 * @returns {(urlKey: string, session: Object) => Promise<void>}
 */
export function createMaterializerPrecompute({
  precomputeRunParagraph,
  precomputeSessionSummary,
  resolveCredential = resolvePrecomputeCredential,
} = {}) {
  return async function precomputeSession(urlKey, session) {
    if (!session?.sessionId) return;
    const credential = resolveCredential();    // offline / no key → skip both
    if (!credential) return;
    const { apiKey, isFreeTier } = credential;

    // Run paragraph: runs for a running OR terminal session — the summary's own
    // terminal gate must not suppress it.
    if (precomputeRunParagraph) await precomputeRunParagraph(urlKey, session, { apiKey, isFreeTier });

    if (precomputeSessionSummary) await precomputeSessionSummary(urlKey, session, { apiKey, isFreeTier });
  };
}
