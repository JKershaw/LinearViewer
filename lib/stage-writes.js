/**
 * What a stage may write (LIN-4253): the value every prompt template declares as `writes`.
 *
 * A dependency-free leaf, so the templates can import it to declare and the dispatch preamble
 * can import it to know the vocabulary. Neither imports the template registry: the preamble
 * stays registry-free (lib/proxy-preamble.js), and dispatch-entrance resolves a stage's value
 * from its template and passes it down.
 *
 * - `work` (the default): reversible work, closed with PR evidence.
 * - `one-comment`: a read-only forecast; its only write is one comment on the surveyed ticket.
 *
 * Named for what it controls, not `readOnly`: a boolean negation is the wrong shape once a stage
 * writes but is not reversible work (LIN-4251's triage writes ticket updates). Relation to the
 * reading pass (STAGE_INTENT's READING) and to grounding (GROUNDING_BY_KIND): separate decisions.
 * Every `writes !== 'work'` stage is READING; the converse is false today (context, look-into and
 * retro are READING and still `work`, until LIN-4251 moves them).
 */
export const WRITES = Object.freeze({ WORK: 'work', ONE_COMMENT: 'one-comment' });

/** The accepted values, for the preamble's guard and the completeness test. */
export const WRITES_VALUES = Object.freeze(Object.values(WRITES));
