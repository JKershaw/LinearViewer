/**
 * The leftover words (LIN-4376): the one home for what the three readers of a change's
 * leftovers share. The builder's leftover step (`leftoverPrompt`, `lib/dispatch-leftover.js`),
 * review's class check and close-out's Follow-up Triage (`lib/prompt-template-defs.js`)
 * each render `LEFTOVER_RULE` verbatim and add one sentence of their own about what that
 * actor does with it. `docs/areas/README.md` points here rather than restating it.
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
export const LEFTOVER_RULE = "One home for each leftover. Inside the change's area and fix-sized: fixed on the PR branch. Inside the area but larger: a `## Waiting` entry in that area's `docs/areas/<slug>.md`. Outside the area: a follow-up only close-out files. A filed follow-up will be done, a note is known but not scheduled; an item never lives in both.";

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
