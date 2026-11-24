/**
 * The blind read's words (LIN-4437, piece 2 of LIN-4396): the one home for the spellings the
 * `blind-read` stage writes and its readers parse.
 *   - the stage kind;
 *   - the heading a blind-read comment opened with, `## Blind read`. Since LIN-4533 the blind read posts no comment (its
 *     verdict and finds are records) and no prompt renders it; since LIN-4543 no code reads it either (the write guard and
 *     its opening reader retired). It stays only as the spelling that comments already on the tracker carry: the frozen
 *     landing replay classifies them by it (tests/unit/lin-4516-landing-replay.test.js), and the stage-kind census holds
 *     every other module to never retyping it (tests/unit/stage-kind-tables.test.js);
 *   - the three verdict words, which the verdict record's outcome carries (lib/records/kinds.json). There is
 *     no fourth ("mixed" is refused). Their two prose forms, "better, the same or worse" and "better, same
 *     or worse", are built here too (LIN-4466), so the words are typed once. LIN-4520: the comment no longer
 *     carries a verdict line, so there is no label for one.
 *
 * A LEAF: it imports nothing. The template defs (lib/prompt-template-defs.js) cannot import what
 * imports lib/prompt-templates.js (a cycle; lesson LIN-4376). The prompt renders the kind and the verdict words:
 * none retypes them.
 */

/** The dispatch kind (a PROMPT_TEMPLATES key). */
export const BLIND_READ_KIND = 'blind-read';

/** The comment's first line, exactly. */
export const BLIND_READ_HEADING = '## Blind read';

/** The three verdict words, in the prompt's order. */
export const BLIND_READ_VERDICTS = Object.freeze(['better', 'same', 'worse']);

const [BETTER, SAME, WORSE] = BLIND_READ_VERDICTS;

/** The three words in the prose of the blind read's sentence: "better, the same or worse". */
export const BLIND_READ_VERDICT_PROSE = `${BETTER}, the ${SAME} or ${WORSE}`;

/** The three words in the short list form the completion signals use: "better, same or worse". */
export const BLIND_READ_VERDICT_LIST = `${BETTER}, ${SAME} or ${WORSE}`;
