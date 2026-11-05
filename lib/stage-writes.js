/**
 * What a stage may write (LIN-4253, LIN-4251): the value every prompt template declares as `writes`.
 *
 * A dependency-free leaf, so the templates can import it to declare and the dispatch preamble
 * can import it to know the vocabulary. Neither imports the template registry: the preamble
 * stays registry-free (lib/proxy-preamble.js), and dispatch-entrance resolves a stage's value
 * from its template and passes it down (lib/prompt-templates.js `stageWrites`).
 *
 * - `work` (the default): reversible work: code, branches, PRs, comments, ticket updates; closed
 *   with PR evidence.
 * - `none`: a reading pass (look-into, retro). Changes nothing; reports its findings in the session.
 * - `one-comment`: a read-only stage (context, and the LIN-4248 Surveys). Its only write is one
 *   comment on the ticket named in its task.
 * - `ticket-fields`: triage. Changes this ticket's labels, priority, state and project and comments
 *   on it; no code, no branches, no PRs, no new tickets, no rewrite of its description.
 *
 * Named for what it controls, not `readOnly`: a boolean cannot say "ticket fields and a comment,
 * nothing else", which triage needs.
 *
 * Relation to the reading pass (STAGE_INTENT's READING): a stage is READING exactly when its
 * `writes` is `none` or `one-comment`. Each stage is READING or not and writes what it writes;
 * the two are stated together here, and lib/prompts/stage-intent.js keeps the text. Grounding
 * (GROUNDING_BY_KIND) is a separate decision.
 */
export const WRITES = Object.freeze({
  WORK: 'work',
  NONE: 'none',
  ONE_COMMENT: 'one-comment',
  TICKET_FIELDS: 'ticket-fields'
});

/** The accepted values, for the preamble's guard and the completeness test. */
export const WRITES_VALUES = Object.freeze(Object.values(WRITES));
