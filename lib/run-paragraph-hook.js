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

import { buildRunView } from './run-view.js';
import { inputHash, generateRunParagraph } from './run-paragraph.js';

/**
 * The offline guard shared with the session-summary precompute. Returns the
 * server-side API key to use, or `null` when precompute must skip entirely:
 * tests (`NODE_ENV=test`) stay fully offline, and no key means no LLM.
 *
 * @param {Object} [env=process.env]
 * @returns {string|null}
 */
export function resolvePrecomputeApiKey(env = process.env) {
  if (env.NODE_ENV === 'test') return null;
  return env.OPENROUTER_API_KEY || env.OPENROUTER_FREE_TIER_KEY || null;
}

/**
 * Build the run-paragraph precompute hook.
 *
 * @param {Object} deps
 * @param {Object} deps.runParagraphStore - the durable store (get/put).
 * @param {Function} [deps.generateParagraph=generateRunParagraph] - one-call generator.
 * @param {Function} [deps.buildView=buildRunView] - the page route's run-view builder.
 * @param {Function} [deps.isTerminal] - `(session) => boolean` (sessionIsTerminal).
 * @param {Object} [deps.logger=console]
 * @returns {(urlKey: string, session: Object, opts?: {apiKey?: string}) => Promise<void>}
 */
export function createRunParagraphPrecompute(deps = {}) {
  const {
    runParagraphStore,
    generateParagraph = generateRunParagraph,
    buildView = buildRunView,
    isTerminal = () => false,
    logger = console,
  } = deps;

  return async function precomputeRunParagraph(urlKey, session, { apiKey } = {}) {
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

      const { paragraph, model } = await generateParagraph(runView, { apiKey });
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
