/**
 * LIN-4518 (finding 398df7e5): the records words that the landing (lib/records/landing.js) and the standing
 * (lib/records/standing.js) both read, spelled once. If the landing and the standing spelled a word apart, changing it in
 * one would split the round they cut: the landing's cut would read a different review from the standing's. Lib/records/
 * imports only Platform, so the verdict vocabulary that is not a records word stays injected (lib/prompts/blind-read-words.js).
 */

/** The verdict judgement of a review (lib/records/kinds.json outcome sets). */
export const REVIEW_JUDGEMENT = 'review';

/** LIN-4533: the judgement of a periodical's adversarial second read (lib/records/kinds.json outcome set: agree | disagree). */
export const ADVERSARIAL_READ_JUDGEMENT = 'adversarial-read';

/** The stage kind a close-out run is filed under. */
export const CLOSE_OUT_STAGE = 'close-out';

/** The stage kind an audit run is filed under (lib/prompts/stage-kinds.js). */
export const AUDIT_STAGE = 'retrospective-audit';

/**
 * LIN-4531: the stage a fresh autopilot kickoff's run is filed under, the coordinator. It is no stage of a task's own
 * (lib/records/brief.js); LIN-4536: a credential with no run reads a task's brief as the coordinator.
 */
export const COORDINATOR_STAGE = 'autopilot';

/**
 * LIN-4536: the heading of the brief's part 1, the task as filed (its ref, done-when and the person's words, the `asked`
 * of the task and each ancestor). The stage prompts name "the `## As asked` block", so the brief renders part 1 under
 * exactly this heading (lib/records/brief.js). Its one owner: every text that names the heading imports it from here and
 * never retypes it (tests/unit/lin-4536-as-asked-heading-census.test.js). It moved here from the module that quoted the
 * words above the model-written brief, which retired with that quote.
 */
export const ASKED_HEADING = '## As asked';

/**
 * LIN-4536: what `GET /api/proxy/brief/<id>` answers, in the words every surface that points an agent at it uses (the
 * proxy preamble, the proxy instructions, the autopilot and Flight Companion kickoffs). Each keeps only its own framing
 * around it ("it opens with …"). The brief is the records brief (lib/records/run-brief.js), read for the credential's
 * own run; nothing in it is written by a model.
 */
export const BRIEF_HINT = `the task as filed under \`${ASKED_HEADING}\`, from the task's record; no step may change it; then the records addressed to you, what stands and the previous stage`;

/**
 * LIN-4542: the selector's size line when the task has no standing decision by scoping (lib/recommendation-facts.js
 * sizeFactOf), and the words scoping's `when` reads it by (lib/prompts/stage-kinds.js). One owner, so the route cannot
 * name a value the facts line no longer prints.
 */
export const SIZE_NOT_DECIDED = 'not decided';
