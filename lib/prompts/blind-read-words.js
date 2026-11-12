/**
 * The blind read's words (LIN-4437, piece 2 of LIN-4396): the one home for the spellings the
 * `blind-read` stage writes and its readers parse.
 *   - the stage kind;
 *   - the comment's heading, `## Blind read`. It names neither a review (`isReviewSummary` keys on
 *     "review") nor a close-out (`isCloseOut` keys on "close-out"), so a read is never taken for
 *     either. It is matched exactly: the first non-blank line, then end of line or `:`
 *     (`opensWithHeading`, lib/run-ledger.js), so `## Blind read pilot` is never a read;
 *   - the verdict label and the three verdict words. There is no fourth ("mixed" is refused).
 *
 * A LEAF: it imports nothing. The template defs (lib/prompt-template-defs.js) cannot import what
 * imports lib/prompt-templates.js (a cycle; lesson LIN-4376), and lib/run-ledger.js, the parser,
 * stays free of anything heavier than this. The prompt renders these spellings, the parser and
 * the proxy's shape check (lib/run-ledger.js `checkBlindRead`) read them: none retypes them.
 */

/** The dispatch kind (a PROMPT_TEMPLATES key). */
export const BLIND_READ_KIND = 'blind-read';

/** The comment's first line, exactly. */
export const BLIND_READ_HEADING = '## Blind read';

/** The label of the one verdict line. */
export const BLIND_READ_VERDICT_LABEL = 'Verdict:';

/** The three verdict words, in the prompt's order. */
export const BLIND_READ_VERDICTS = Object.freeze(['better', 'same', 'worse']);
