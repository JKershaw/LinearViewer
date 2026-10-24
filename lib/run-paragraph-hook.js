/**
 * Run-paragraph precompute hook (LIN-3253, S3 of LIN-2948).
 *
 * The write-time half of the stored paragraph: whenever a session is
 * (re)materialized, regenerate its paragraph when the *finished-step set*
 * changes (step end) or when the session turns terminal (close-out), gated on
 * `inputHash` so an unchanged input is a hit. The page route only ever reads the
 * store; it never calls the generator.
 *
 * It is wired into the SAME `observationMaterializer.precomputeSessionSummary`
 * hook the session-summary rollup uses (server.js), so there is no second hook
 * and no new scheduler. Like that precompute it runs at WRITE time with no user
 * session, skips cleanly offline / without a server-side key, and never lets a
 * generation failure block the read-model write it rode in on.
 */

import { getFreeTierKey } from './chat-request.js';
import { isFreeFor } from './plan-allowance.js';
import { buildRunView } from './run-view.js';
import { inputHash, generateRunParagraph } from './run-paragraph.js';

/**
 * The offline guard shared with the session-summary precompute. Returns the
 * server-side API key to use, or `null` when precompute must skip entirely:
 * tests (`NODE_ENV=test`) stay fully offline, and no key means no LLM.
 *
 * LIN-3856 (D2): also says whether the key it chose is the shared free-tier key, so
 * the caller can apply the free-tier model clamp. `isFreeTier` is the result of the
 * same `isFreeFor('keyed', ...)` call that picks the key (one seam, LIN-3706).
 *
 * @param {Object} [env=process.env]
 * @returns {{apiKey: string, isFreeTier: boolean}|null}
 */
export function resolvePrecomputeCredential(env = process.env) {
  if (env.NODE_ENV === 'test') return null;
  // LIN-3664: trim the paid key like getPaidEnvKey does (LIN-961), so a blank one
  // falls through to the free-tier key instead of being spent upstream. Env-param
  // driven, so not getPaidEnvKey() (that reads process.env).
  const paid = typeof env.OPENROUTER_API_KEY === 'string' ? env.OPENROUTER_API_KEY.trim() : '';
  const free = getFreeTierKey(env);
  const isFreeTier = isFreeFor('keyed', { hasSessionKey: false, hasPaidEnvKey: !!paid, hasFreeKey: !!free });
  if (paid) return { apiKey: paid, isFreeTier };
  return isFreeTier && free ? { apiKey: free, isFreeTier } : null;
}

/**
 * Build the run-paragraph precompute hook.
 *
 * @param {Object} deps
 * @param {Object} deps.runParagraphStore - the durable store (get/put).
 * @param {Function} [deps.generateParagraph=generateRunParagraph] - one-call generator.
 * @param {Function} [deps.buildView=buildRunView] - the page route's run-view builder.
 * @param {Function} [deps.isTerminal] - `(session) => boolean` (sessionIsTerminal).
 * @param {Function} [deps.resolveModel] - async `({urlKey, jobId, isFreeTier}) => modelId` (LIN-3856);
 *   unwired, the generator keeps DEFAULT_MODEL.
 * @param {Object} [deps.logger=console]
 * @returns {(urlKey: string, session: Object, opts?: {apiKey?: string, isFreeTier?: boolean}) => Promise<void>}
 */
export function createRunParagraphPrecompute(deps = {}) {
  const {
    runParagraphStore,
    generateParagraph = generateRunParagraph,
    buildView = buildRunView,
    isTerminal = () => false,
    resolveModel = null,
    logger = console,
  } = deps;

  return async function precomputeRunParagraph(urlKey, session, { apiKey, isFreeTier = false } = {}) {
    if (!runParagraphStore || !session?.sessionId) return;
    if (!apiKey) return; // offline / no server-side key → skip (the shared guard)

    try {
      const runView = buildView(session, { now: new Date() });
      const hash = inputHash(runView);
      const terminal = !!isTerminal(session);

      // Same input is a hit — except when the session just became terminal and
      // the stored paragraph was not yet stamped final (the close-out trigger).
      const cached = await runParagraphStore.get(urlKey, session.sessionId);
      if (cached && cached.inputHash === hash && (!terminal || cached.final)) return;

      // LIN-3856: resolved after the cache-hit return, so a hit costs no store read.
      const resolved = resolveModel ? await resolveModel({ urlKey, jobId: 'run-paragraph', isFreeTier }) : undefined;
      const { paragraph, model } = await generateParagraph(runView, { apiKey, model: resolved, callMeta: { urlKey } });
      await runParagraphStore.put(urlKey, session.sessionId, {
        inputHash: hash,
        paragraph,
        model,
        final: terminal,
      });
    } catch (err) {
      // Never block the read-model write this rode in on.
      logger.error('run-paragraph precompute error:', err?.message || err);
    }
  };
}
