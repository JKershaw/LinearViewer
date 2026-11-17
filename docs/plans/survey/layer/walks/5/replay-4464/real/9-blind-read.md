# What this stage really wrote

## Comment on LIN-4464 at 16:31:12

## Blind read
Verdict: worse. It simplifies the held-wake release in `lib/dispatch-store.js`: `setHeldWakeReleaseNote`, `_releaseNoteFor` and `UNBOUND_HELD_WAKE_RELEASE_NOTE` are gone, so there is one wording path instead of two. It also drops the always-true `mayCarryWake` filter from `findWakeEvent` (`lib/dispatch-terminal.js`). Against that, it deletes the one-owner declarations `lib/dispatch-feedback-kinds.js` and `NEVER_RAN`, and copies those values back out into about ten files across runs-and-dispatch and agent-api, with nothing checking they stay in step. The store also takes back the leftover wording through `formatHeldWakeNote`.

Read: https://github.com/JKershaw/LinearViewer/pull/2430 at `444b58246` against `0092d8d9e`.

### Inside the area, fix-sized
- `lib/dispatch-leftover.js` (runs-and-dispatch): it spells out two rules that already have an owner. `RESUMABLE_TARGETS = new Set(['cli','web'])` with `doc.target || 'cli'` repeats `followUpTarget` (`lib/dispatch-targets.js`, whose header names it the one follow-up target rule, LIN-3672). `halt?.mode === 'pause' || halt?.mode === 'stop'` repeats `HALT_MODES` (`lib/workspace-halt.js`). Fix: import `followUpTarget` and `HALT_MODES` again and drop the local copies. That is two lines in one file and changes no behaviour.
- `tests/unit/decision-lifecycle-stamp-drift.test.js` (runs-and-dispatch, concerns `lib/digest-feedback.js`): `lib/run-view.js` now carries its own copy of the three stamp kinds (`DECISION_STAMP_KINDS`). That copy is not in the test's `sites` list, and the docblock's count ("4 literal copies across 5 call sites") leaves it out, so this copy can drift with no alarm. Fix: add `lib/run-view.js` to `sites` and update the count in the docblock. A related tidy-up in `lib/run-view.js`: the "A wake marker is a leading prefix…" comment now sits on its own between the set and `lastWakeEntry`'s docblock. Fold it back into that docblock.

### Inside the area, larger
- `lib/dispatch-store.js` (runs-and-dispatch): `releaseHeldWake` calls `formatHeldWakeNote({ status })`, which returns "The leftover step did not run…" (`lib/dispatch-wake.js:331`). The store that `tests/unit/lin-4377-store-knows-no-leftover.test.js` says "knows no leftovers" therefore speaks the leftover wording again. That test's docblock still claims "what its wake says, live[s] in the injected hook". The test only counts the word "leftover", so it does not witness that claim, and the dependency check that did witness it was deleted. Larger because someone has to decide who owns the release wording, and that is the design this change took out.
- `lib/dispatch-store.js`, `lib/dispatch-leftover.js`, `lib/dispatch-terminal.js`, `lib/observer-sweep.js`, `lib/task-page-loader.js`, `lib/plan-review-round-trips.js`, `routes/dispatch.js` (runs-and-dispatch): "a row that never ran" (`cancelled`/`expired`) is now written out separately at each site. `dispatch-store.js` does it twice (lines 1176 and 1906), and `dispatch-leftover.js:29` declares a private `NEVER_RAN`. A third archive-without-running status would need every site found by hand. Larger because it needs one owner chosen and imported across areas (see Outside).
- `lib/dispatch-store.js`, `lib/session-telemetry.js`, `lib/digest-feedback.js`, `lib/wall-clock-summary.js`, `lib/run-view.js` (runs-and-dispatch): the feedback-entry kinds have no single declaration again:
  - the runner allowlist is in the store;
  - the relay kinds are in `session-telemetry.js` (`PARKED_WAIT_SKIPPED_KINDS`);
  - the stamp kinds are in four lib copies.

  With the table and its test deleted, a new kind no longer has to say what its roles are. `lib/dispatch-feedback-validation.js` also now imports the whole run store just to read one array. Larger because giving the kinds a home is a design decision.

### Outside the area
- `routes/proxy-dispatch.js` (agent-api): `['queued', 'cancelled', 'expired'].includes(statusFilter)` is another inline copy of the never-ran statuses. It needs to stay in step with the runs-and-dispatch sites above.
