// LIN-3210 (sub-task (c) of LIN-3197): pure classifiers for the D5x detector over the runner's
// completion-post record. Imported by survey-hides-detect-runner.mjs; it does nothing when run.
//
// Grounded on the merged simple-dispatcher event shapes:
//   - hook.done_post_started  hook.js:2137  { session, item }
//   - hook.done_posted        hook.js:2148  { session, item }
//   - hook.done_post_failed   hook.js:2150  { session, item, status, error, cause, url, attempts, skipped }
//   - feedback.post           hook.js:154   { item, ok, status, error, cause, url, attempts, msg }
//
// The judgement: `hook.done_posted` is positive proof the [done] POST landed, so a `done_posted`
// with NO ok `[done]` `feedback.post` for its item is a FALSE posted (the old unconditional marker).
// A retry that healed has an ok row, so it never counts. This is the M22 after-read's "zero false
// done_posted". A `done_post_failed` is an honest loss; a `done_post_started` with neither outcome
// is `unresolved` (a hook killed mid-retry).

const DONE_HEAD = /^\s*\[done\]/i;

const at = (o) => (typeof o.t === 'number' ? o.t : Date.parse(o.ts));

// A `hook.done_posted` with no ok `[done]` `feedback.post` for that item.
export function falseDonePosted(ops) {
  const okDoneItems = new Set();
  for (const o of ops) {
    if (o.event === 'feedback.post' && o.ok && DONE_HEAD.test(o.msg || '')) okDoneItems.add(o.item);
  }
  return ops.filter((o) => o.event === 'hook.done_posted' && !okDoneItems.has(o.item));
}

export function donePostFailedEvents(ops) {
  return ops.filter((o) => o.event === 'hook.done_post_failed');
}

// A `hook.done_post_started` with no `hook.done_posted` / `hook.done_post_failed` for the same
// session (and item, where both name one) at or after it.
export function unresolvedStarted(ops) {
  const outcomes = ops.filter((o) => o.event === 'hook.done_posted' || o.event === 'hook.done_post_failed');
  const same = (o, st) => o.session === st.session && (o.item == null || st.item == null || o.item === st.item);
  return ops
    .filter((o) => o.event === 'hook.done_post_started')
    .filter((st) => !outcomes.some((o) => same(o, st) && at(o) >= at(st)));
}

// The D5x counts, plus the underlying events. `failures` is runner.json's failed-post rows
// (`{ item, terminal, healed, ... }`); a healed terminal failure is not a loss.
export function classifyDonePosts(ops, failures = []) {
  const falsePosted = falseDonePosted(ops);
  const failed = donePostFailedEvents(ops);
  const unresolved = unresolvedStarted(ops);
  const terminal = failures.filter((f) => f.terminal);
  return {
    doneLoggedAnyway: falsePosted.length,
    donePostFailed: failed.length,
    unresolved: unresolved.length,
    healedLosses: terminal.filter((f) => f.healed).length,
    unhealedLosses: terminal.filter((f) => !f.healed).length,
    falseDonePosted: falsePosted,
    donePostFailedEvents: failed,
    unresolvedStarted: unresolved,
  };
}
