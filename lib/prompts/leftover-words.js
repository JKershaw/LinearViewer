import { REGISTRY_PATH } from './area-registry-path.js';

/**
 * The leftover words (LIN-4376): the one home for what the readers of a change's leftovers and
 * outside finds share. Its constants:
 *   - `LEFTOVER_RULE` (LIN-4376, LIN-4401): where a leftover goes. Rendered by the builder's
 *     leftover step (`leftoverPrompt`, `lib/dispatch-leftover.js`), close-out's Follow-up Triage
 *     (`lib/prompt-template-defs.js`) and, a sentence at a time, the blind read's classes. Review's
 *     class check stopped rendering it when its edges read retired (LIN-4438).
 *   - `CONSEQUENCE_TEST` (LIN-4401): which outside finds become a ticket. Rendered by
 *     `leftoverPrompt`, review's scope section, close-out's Follow-up Triage and
 *     `retrospective-audit`'s Reporting (LIN-4432).
 *   - `FOR_CLOSE_OUT` (LIN-4438): the mark on a builder's leftover line that hands it to close-out.
 *     The leftover prompt asks for it and close-out's Follow-up Triage reads it, so both spell it once.
 *   - `LEFTOVERS_HEADING`, `RETIRES_LABEL`, `RETIRES_NONE` (LIN-4373, LIN-4414): the leftover answer's
 *     heading and its one retirement line, checked by `lib/dispatch-leftover-answer.js`.
 *   - `areaLookup` and `NOTES_PR` (LIN-4469): the area lookup's clause and the notes pull request's,
 *     each rendered where the rule used to be retyped (see their own comments for the readers).
 * Each actor adds one sentence of its own about what it does with them. `docs/areas/README.md`
 * points here rather than restating them.
 *
 * A LEAF that imports only leaves (`area-registry-path.js`, LIN-4469), so both `lib/dispatch-leftover.js` and
 * `lib/prompt-template-defs.js` can import it. The template defs cannot import
 * `lib/dispatch-leftover.js` (it imports `lib/prompt-templates.js`, a cycle), which is
 * why the heading used to sit in `lib/dispatch-fields.js` (LIN-4374).
 *
 * `tests/unit/lin-4374-review-leftover-read.test.js` fails if any other file under `lib/`
 * or `routes/` retypes one of these spellings.
 */

/**
 * The one heading the builder's leftover answer goes under (LIN-4373). Review reads its `Retires:` line and
 * close-out its lines marked for close-out (LIN-4438; review read the whole answer from LIN-4374).
 */
export const LEFTOVERS_HEADING = '### Leftovers';

/**
 * Where a leftover goes, and the one-home distinction. A leftover is code shape a change
 * left at its edges, not a defect.
 */
export const LEFTOVER_RULE = "One home for each leftover. Inside the change's area and fix-sized: fixed on the PR branch. Inside the area but larger: a `## Waiting` entry in that area's `docs/areas/<slug>.md`. Outside the area: a `## Waiting` entry in its note, or a ticket the consequence test sends. A ticket will be done; a note is known but not scheduled; an item never lives in both.";

/**
 * The area lookup's one clause (LIN-4469): the registry names each area's path patterns, and the
 * first area whose pattern matches a path wins. CONSEQUENCE_TEST and the area-notes pointer
 * (`lib/prompt-formatters.js`) say it through this clause; the blind read's sentence keeps its own
 * words, as piloted (LIN-4437).
 * @param {string} registry - the registry's repo-relative path (REGISTRY_PATH)
 * @returns {string}
 */
export const areaLookup = (registry) => `\`${registry}\`, first match wins`;

/**
 * Where an outside find goes (LIN-4401). The one gate: a ticket only for a find that breaks,
 * blocks or touches safety; otherwise a note entry. Each route renders it verbatim. The
 * unmapped-path fallback cites the area whose code the find concerns, not a ticket.
 */
export const CONSEQUENCE_TEST = `Consequence test for an outside find: a ticket only if it breaks something (behaviour is wrong today), blocks work, or touches safety (authentication, secrets, data loss, irreversible writes); where the provider cannot create tickets, the summary comment, addressed to the person. Otherwise a \`## Waiting\` entry in the note of the area its first cited file maps to (${areaLookup(REGISTRY_PATH)}). An unmapped path (\`tests/\`, \`scripts/\`) takes the area whose code it concerns, citing a file there first; no such file or no area notes, the summary comment. Never both.`;

/**
 * The notes pull request a reading or audit that writes area notes opens (LIN-4432, LIN-4469): the
 * report and the note edits, one docs-only PR, rebased and green under the notes guard. Periodical
 * readings (`lib/periodicals.js`) and retrospective-audit's Reporting say it through this one clause.
 */
export const NOTES_PR = 'one docs-only pull request off main, green under the notes guard and required checks';

/**
 * The mark on a line of the builder's leftover answer that leaves the item for close-out to file
 * (LIN-4438): the leftover prompt asks for it (twice) and close-out's Follow-up Triage takes the
 * lines so marked through the gate. Before LIN-4438 they reached close-out only through review's
 * edges read.
 */
export const FOR_CLOSE_OUT = 'for close-out';

/**
 * The label of the one line in the builder's leftover answer that names the waiting entry the
 * build settled (LIN-4414). The leftover prompt asks for it, `lib/dispatch-leftover-answer.js`
 * checks it and the proxy refuses an answer without it.
 */
export const RETIRES_LABEL = 'Retires:';

/**
 * The closed list of reasons a `Retires:` line may give instead of naming an entry (LIN-4414):
 * no area the change touched has a Waiting entry (or the repo has no area notes), or none of
 * their entries is fix-sized (the line then names the smallest entry in the busiest touched area
 * and says why it is larger than a fix).
 */
export const RETIRES_NONE = Object.freeze({
  noWaiting: 'none, no waiting entry',
  nothingFixSized: 'none, nothing fix-sized'
});
