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
 *     prompt renders in row order (lib/prompts/runner-kickoff.js, through the store's
 *     re-export). Row order is that rendered order, so a reorder moves prompt bytes.
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
 * Why the allowlist leaves two stamps out. `'decision-answer'` (LIN-1728) is written only
 * by `markDecisionAnswered`, never through `addFeedback` or the runner-facing sanitizer: a
 * human Save authenticates by session, not a runner token, and cannot use the runner-token
 * write path. Keeping the kind off the allowlist makes that guarantee structural rather
 * than a convention. `'decision-withdrawal-reversed'` stays off for the same reason: only a
 * logged-in human reaches the reversal, via `workspaceFromUrl`.
 *
 * `'decision-withdrawn'` (LIN-2891/LIN-3035) IS on it. The validator checks its
 * `{decision_id, reason}` message (both required, non-empty) before the sole `addFeedback`
 * call, but any caller holding a valid feedback credential for the `taken` item can post
 * one. That is narrower than "only the dispatcher process can reach the route": the
 * workspace-wide dispatch (runner) token lives in simple-dispatcher's `workspaces.json`,
 * readable by the agent's own OS user, and the Stop hook reads it from disk inside the
 * agent's own process tree, so an agent session that reaches that file can stamp a
 * withdrawal, with its stated reason, on any item its token has taken. The Harbour OS
 * local-target token is narrower still: bound to one item, single-use, localhost-only.
 * Neither path is gated out (John's ruling, LIN-3035 comment `e56de2e1`; class audit in
 * `c4ac57e1`). What bounds a wrong withdrawal is the required, visible `reason`, the
 * item-scoped read, and the terminal reversal, which no token can call.
 *
 * This module imports nothing. The store, the validator, session telemetry, the wake
 * reader and the free-text readers all import it, and several of them sit in import
 * cycles with each other; a leaf cannot be caught in one.
 */

/** @typedef {{kind: string, runnerPostable: boolean, relay: boolean, decisionStamp: boolean, mayCarryWake: boolean}} FeedbackKind */

/** The role columns every row declares, in order. */
export const FEEDBACK_KIND_ROLES = Object.freeze(['runnerPostable', 'relay', 'decisionStamp', 'mayCarryWake']);

const row = (kind, runnerPostable, relay, decisionStamp, mayCarryWake) =>
  Object.freeze({ kind, runnerPostable, relay, decisionStamp, mayCarryWake });

/** @type {ReadonlyArray<FeedbackKind>} */
export const FEEDBACK_KINDS = Object.freeze([
  //   kind                            postable relay  stamp  wake
  row('status',                        true,    false, false, true),
  row('recap',                         true,    false, false, true),
  row('heartbeat',                     true,    false, false, true),
  row('evidence',                      true,    false, false, true),
  row('assistant-text',                true,    false, false, true),
  row('tool',                          true,    true,  false, true),
  row('usage',                         true,    true,  false, true),
  row('resources',                     true,    true,  false, true),
  row('refusal',                       true,    false, false, true),
  row('decision',                      true,    false, false, true),
  row('decision-withdrawn',            true,    false, true,  true),
  row('decision-answer',               false,   false, true,  true),
  row('decision-withdrawal-reversed',  false,   false, true,  true),
]);

const kindsWith = (role) => FEEDBACK_KINDS.filter((r) => r[role]).map((r) => r.kind);

/** The runner allowlist, in rendered order. */
export const FEEDBACK_ENTRY_KINDS = Object.freeze(kindsWith('runnerPostable'));

/** The relay kinds `parseParkedWait` walks past. */
export const PARKED_WAIT_SKIPPED_KINDS = new Set(kindsWith('relay'));

/** The decision-lifecycle stamp kinds every free-text reader skips. */
export const DECISION_LIFECYCLE_STAMP_KINDS = new Set(kindsWith('decisionStamp'));

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
