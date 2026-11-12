/**
 * The leftover words (LIN-4376): the one home for what the readers of a change's leftovers and
 * outside finds share. Two constants:
 *   - `LEFTOVER_RULE` (LIN-4376, LIN-4401): where a leftover goes. Rendered by the builder's
 *     leftover step (`leftoverPrompt`, `lib/dispatch-leftover.js`), review's class check and
 *     close-out's Follow-up Triage (`lib/prompt-template-defs.js`).
 *   - `CONSEQUENCE_TEST` (LIN-4401): which outside finds become a ticket. Rendered by
 *     `leftoverPrompt`, review's scope section and close-out's Follow-up Triage.
 * Each actor adds one sentence of its own about what it does with them. `docs/areas/README.md`
 * points here rather than restating them.
 *
 * A LEAF: it imports nothing, so both `lib/dispatch-leftover.js` and
 * `lib/prompt-template-defs.js` can import it. The template defs cannot import
 * `lib/dispatch-leftover.js` (it imports `lib/prompt-templates.js`, a cycle), which is
 * why the heading used to sit in `lib/dispatch-fields.js` (LIN-4374).
 *
 * `tests/unit/lin-4374-review-leftover-read.test.js` fails if any other file under `lib/`
 * or `routes/` retypes one of these spellings.
 */

/** The one heading the builder's leftover answer goes under (LIN-4373), which review reads (LIN-4374). */
export const LEFTOVERS_HEADING = '### Leftovers';

/**
 * Where a leftover goes, and the one-home distinction. A leftover is code shape a change
 * left at its edges, not a defect.
 */
export const LEFTOVER_RULE = "One home for each leftover. Inside the change's area and fix-sized: fixed on the PR branch. Inside the area but larger: a `## Waiting` entry in that area's `docs/areas/<slug>.md`. Outside the area: a `## Waiting` entry in that area's note, unless the consequence test below sends it to a ticket. A ticket the test files will be done, a note is known but not scheduled; an item never lives in both.";

/**
 * Where an outside find goes (LIN-4401). The one gate: a ticket only for a find that breaks,
 * blocks or touches safety; otherwise a note entry. Each route renders it verbatim. The
 * unmapped-path fallback cites the area whose code the find concerns, not a ticket.
 */
export const CONSEQUENCE_TEST = "Consequence test for an outside find. A ticket only if it breaks something (behaviour is wrong today), blocks work, or touches safety (authentication, secrets, data loss, irreversible writes); where the provider cannot create tickets, the summary comment, addressed to the person. Otherwise a `## Waiting` entry in the note of the area its first cited file maps to (`docs/areas/areas.json`, first match wins). An unmapped path (`tests/`, `scripts/`) takes the area whose code it concerns, citing a file there first; no such file or no area notes, the summary comment. Never both.";

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
