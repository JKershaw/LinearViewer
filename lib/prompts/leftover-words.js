import { REGISTRY_PATH } from './area-registry-path.js';

/**
 * The leftover words: the one home for where a change's leftovers and outside finds go (LIN-4376, LIN-4401,
 * LIN-4495). Its constants:
 *   - `LEFTOVER_RULE` (LIN-4376, LIN-4495): where a leftover goes. Rendered by the builder's leftover step
 *     (`leftoverPrompt`, `lib/dispatch-leftover.js`) and close-out's Follow-up Triage (`lib/prompt-template-defs.js`).
 *   - `CONSEQUENCE_TEST` (LIN-4401, LIN-4495): how an outside find is worded, so the person can tell which one
 *     breaks something, blocks work or touches safety. Rendered by the same readers.
 *   - `areaLookup` (LIN-4469): the area lookup's clause, said where a lesson's area note is named.
 *
 * LIN-4495 retired the Waiting list these words used to send outside finds to, and the `### Leftovers` answer
 * with its `Retires:` line (lib/dispatch-leftover-answer.js is gone). A hand-off is a finding record now: the
 * protocol that writes it is lib/prompts/handoff-words.js (`HANDOFF_BLOCK`), and these words say which record.
 *
 * A LEAF that imports only leaves (`area-registry-path.js`), so both `lib/dispatch-leftover.js` and
 * `lib/prompt-template-defs.js` can import it.
 */

/**
 * Where a leftover goes (LIN-4495). A leftover is code shape a change left at its edges, not a defect. One home
 * each: a fix on the branch, or a finding. A finding is never written twice.
 */
export const LEFTOVER_RULE = 'One home for each leftover. Inside the change\'s own edges and fix-sized: fixed on the PR branch. Anything else: a finding (`kind: finding`) to `close-out` on this task when the work belongs to this task\'s close-out, or to `project` when no task owns it. A finding is written once, and a fix is never also a finding.';

/**
 * The area lookup's one clause (LIN-4469): the registry names each area's path patterns, and the first area whose
 * pattern matches a path wins. The area-notes pointer (`lib/prompt-formatters.js`) says it through this clause.
 * @param {string} registry - the registry's repo-relative path (REGISTRY_PATH)
 * @returns {string}
 */
export const areaLookup = (registry) => `\`${registry}\`, first match wins`;

/**
 * How an outside find is worded (LIN-4401, LIN-4495). The person sees the `project` findings as the backlog,
 * ordered oldest first; the words say whether the find breaks something (behaviour is wrong today), blocks work,
 * or touches safety (authentication, secrets, data loss, irreversible writes), so the person can rank it without
 * reading the code. An unmapped path names the area whose code the find concerns, in `says`.
 */
export const CONSEQUENCE_TEST = `Word an outside find's \`says\` so the person can rank it: say whether it breaks something (behaviour is wrong today), blocks work, or touches safety (authentication, secrets, data loss, irreversible writes), and name the area whose code it concerns (${areaLookup(REGISTRY_PATH)}). Otherwise it is a backlog item, and says so.`;
