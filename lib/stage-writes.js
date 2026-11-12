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
 * - `blind-comment`: the blind read (LIN-4437). Its only write is one comment on the ticket named in
 *   its task, like `one-comment`, and it is also a read limit: that ticket is where the comment goes,
 *   not something to read, so its endpoint hints carry no brief, issue-detail or relations line
 *   (lib/proxy-preamble.js).
 * - `ticket-fields`: triage. Changes this ticket's labels, priority, state and project and comments
 *   on it; no code, no branches, no PRs, no new tickets, no rewrite of its description.
 *
 * Named for what it controls, not `readOnly`: a boolean cannot say "ticket fields and a comment,
 * nothing else", which triage needs.
 *
 * Relation to the reading pass (STAGE_INTENT's reading-pass lines): a stage is a reading pass exactly
 * when its `writes` is `none`, `one-comment` or `blind-comment`. Each stage is a reading pass or not
 * and writes what it writes; the two are stated together here, and lib/prompts/stage-intent.js keeps
 * the text (`blind-comment` has its own line, which names no ticket). Since LIN-4437 the name
 * `writes` also covers a read limit (`blind-comment`). Grounding (GROUNDING_BY_KIND) is a separate
 * decision.
 */
export const WRITES = Object.freeze({
  WORK: 'work',
  NONE: 'none',
  ONE_COMMENT: 'one-comment',
  BLIND_COMMENT: 'blind-comment',
  TICKET_FIELDS: 'ticket-fields'
});

/** The accepted values, for the preamble's guard and the completeness test. */
export const WRITES_VALUES = Object.freeze(Object.values(WRITES));
