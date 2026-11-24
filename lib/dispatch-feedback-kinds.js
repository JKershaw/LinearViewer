/**
 * The feedback-entry kinds and their roles: one declaration (LIN-4455, piece 5 of LIN-4447).
 *
 * A feedback ENTRY's `kind` (nested in each `feedback[]` element) is a vocabulary distinct
 * from the dispatch-ITEM `kind` (DISPATCH_KINDS in lib/prompt-templates.js, e.g.
 * "implementation"/"custom"). Never validate one against the other, and never write an
 * entry kind top-level on the doc (LIN-1297).
 *
 * Every kind written anywhere has one row here, and each row declares every role, so a
 * new kind must say what it is (`tests/unit/lin-4455-feedback-kinds-table.test.js`). The
 * lists and sets below are derived from the rows, never written out again:
 *
 *   - `runnerPostable`: on the runner allowlist, `FEEDBACK_ENTRY_KINDS`, which the
 *     runner-facing sanitizer reads (lib/dispatch-feedback-validation.js) and the runner
 *     prompt renders in row order (lib/prompts/runner-kickoff.js imports it from here).
 *     Row order is that rendered order, so a reorder moves prompt bytes.
 *   - `relay`: a relay, not a statement about the session's state (the runner's tool,
 *     usage and resources entries). `parseParkedWait` walks past these
 *     (`PARKED_WAIT_SKIPPED_KINDS`, lib/session-telemetry.js, LIN-4240).
 *   - `decisionStamp`: a decision-lifecycle stamp (LIN-2891/LIN-3037), answer or
 *     withdrawal metadata the store writes, never chat or session prose. Every free-text
 *     reader skips these (`DECISION_LIFECYCLE_STAMP_KINDS`).
 *   - `mayCarryWake`: `findWakeEvent` (lib/dispatch-terminal.js) may read a wake marker on
 *     an entry of this kind. True for every kind today, and an unknown kind passes:
 *     `findWakeEvent` matches the marker alone, and filtering by kind would change wake
 *     minting and every reader of stored rows.
 *
 * The four decision kinds are history (LIN-4541, LIN-4529 P7b-2). A question is a question record and its answer a decision
 * record (POST /api/proxy/records), so nothing writes these kinds any more: no runner may post them and the store's answer,
 * withdrawal and reversal writers are gone. Their rows stay so the display readers keep recognising old rows (the stamps stay
 * `decisionStamp`, which every free-text reader skips, and an old `decision` row still renders as the question it was).
 *
 *   - `refuse`: a runner post naming this kind is refused 422 (lib/dispatch-feedback-validation.js), naming the records
 *     route, rather than dropped kind-less as an unknown kind is. True for the two kinds runners used to post (`decision`,
 *     the scraped DECISION: block, and `decision-withdrawn`, the WITHDRAW: block), so a stale client learns where its
 *     question goes instead of losing it. No translator: a stale block is never turned into a question.
 *
 *   - `speaksForRun`: an entry of this kind is the run's own statement (LIN-4559). False only for `agent-text`, the
 *     words of a child agent the run handed work to (a subagent, simple-dispatcher's `subagents/agent-<id>.jsonl`),
 *     posted on the run's own row with an `agent` field naming the child. A child that writes `[done]` has finished
 *     its piece, not the run, so every reader that takes an entry as the run's statement asks this role first
 *     (`entrySpeaksForRun`): the terminal, wake and lineage-closing markers (lib/dispatch-terminal.js), the bulk
 *     closers' store filter, the KPI terminal entry, the run's account (lib/digest-feedback.js
 *     `correlateDecisionCase`), the run's reported PR (lib/dispatch-wake.js), the parked-wait walk and the run
 *     telemetry (lib/session-telemetry.js). The run page still shows the words: only the readers skip them. A row
 *     that does not speak for the run carries no wake either (`mayCarryWake` false; the census checks the pair).
 *
 * This module imports nothing. The validator, session telemetry, the wake reader
 * (lib/dispatch-terminal.js), the free-text readers and the runner prompt import it, and
 * several of them sit in import cycles with each other; a leaf cannot be caught in one.
 * The store imports only `feedbackKindSpeaksForRun` (LIN-4559, a child's words carry no lineage tag); it never
 * re-exports the allowlist (lib/dispatch-store.js stopped, LIN-4459).
 */

/** @typedef {{kind: string, runnerPostable: boolean, relay: boolean, decisionStamp: boolean, mayCarryWake: boolean, refuse: boolean, speaksForRun: boolean}} FeedbackKind */

/** The role columns every row declares, in order. */
export const FEEDBACK_KIND_ROLES = Object.freeze(['runnerPostable', 'relay', 'decisionStamp', 'mayCarryWake', 'refuse', 'speaksForRun']);

const row = (kind, runnerPostable, relay, decisionStamp, mayCarryWake, refuse, speaksForRun) =>
  Object.freeze({ kind, runnerPostable, relay, decisionStamp, mayCarryWake, refuse, speaksForRun });

/** @type {ReadonlyArray<FeedbackKind>} */
export const FEEDBACK_KINDS = Object.freeze([
  //   kind                            postable relay  stamp  wake   refuse speaks
  row('status',                        true,    false, false, true,  false, true),
  row('recap',                         true,    false, false, true,  false, true),
  row('heartbeat',                     true,    false, false, true,  false, true),
  row('evidence',                      true,    false, false, true,  false, true),
  row('assistant-text',                true,    false, false, true,  false, true),
  row('tool',                          true,    true,  false, true,  false, true),
  row('usage',                         true,    true,  false, true,  false, true),
  row('resources',                     true,    true,  false, true,  false, true),
  row('refusal',                       true,    false, false, true,  false, true),
  // LIN-4559: a child agent's words, posted on its parent run's row with `agent` naming the child. Not the run's.
  row('agent-text',                    true,    false, false, false, false, false),
  // LIN-4541: history. Read so old rows display; written by nothing.
  row('decision',                      false,   false, false, true,  true,  true),
  row('decision-withdrawn',            false,   false, true,  true,  true,  true),
  row('decision-answer',               false,   false, true,  true,  false, true),
  row('decision-withdrawal-reversed',  false,   false, true,  true,  false, true),
]);

const kindsWith = (role) => FEEDBACK_KINDS.filter((r) => r[role]).map((r) => r.kind);

/** The runner allowlist, in rendered order. */
export const FEEDBACK_ENTRY_KINDS = Object.freeze(kindsWith('runnerPostable'));

/** The relay kinds `parseParkedWait` walks past. */
export const PARKED_WAIT_SKIPPED_KINDS = new Set(kindsWith('relay'));

/** The decision-lifecycle stamp kinds every free-text reader skips. */
export const DECISION_LIFECYCLE_STAMP_KINDS = new Set(kindsWith('decisionStamp'));

/** The retired kinds a runner post is refused 422 for (LIN-4541), naming the records route. */
export const RETIRED_DECISION_KINDS = new Set(kindsWith('refuse'));

const BY_KIND = new Map(FEEDBACK_KINDS.map((r) => [r.kind, r]));

/**
 * May an entry of this kind carry a wake marker? From the `mayCarryWake` column; an
 * unknown or missing kind passes, so stored rows of any vintage read as they always have.
 *
 * @param {string|undefined} kind
 * @returns {boolean}
 */
export function feedbackKindMayCarryWake(kind) {
  const known = BY_KIND.get(kind);
  return known ? known.mayCarryWake : true;
}

/** LIN-4559: the kinds whose entries are not the run's own statement (`speaksForRun` false). */
export const RUN_SILENT_KINDS = Object.freeze(FEEDBACK_KINDS.filter((r) => !r.speaksForRun).map((r) => r.kind));

/**
 * Is an entry of this kind the run's own statement? From the `speaksForRun` column; an unknown or
 * missing kind speaks for the run, so stored rows of any vintage read as they always have.
 *
 * @param {string|undefined} kind
 * @returns {boolean}
 */
export function feedbackKindSpeaksForRun(kind) {
  const known = BY_KIND.get(kind);
  return known ? known.speaksForRun : true;
}

/**
 * Is this feedback entry the run's own statement (LIN-4559)? The one question every reader that takes an entry as
 * the run's word asks before it reads a marker, a report line or a tag on it.
 *
 * @param {{kind?: string}|null|undefined} entry
 * @returns {boolean}
 */
export function entrySpeaksForRun(entry) {
  return feedbackKindSpeaksForRun(entry?.kind);
}
