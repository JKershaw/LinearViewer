# What this stage really wrote

## Comment on LIN-4455 at 15:05:16

## Survey global: LIN-4455 @ cfd152fa4

(`origin/main` has moved on from the ticket's grounding commit `4b5001ddf`, but nothing this piece touches changed in a way that matters here.)

**Where it lands.** `lib/dispatch-leftover.js` (157 lines, no I/O) and `lib/dispatch-feedback-validation.js` (109) are tidy. `lib/dispatch-store.js` is 4,530 lines with 58 commits since 1 Oct. Rules are moving to their owners (LIN-4383), so the trend is good. But the validator imports its kind list from the store (`dispatch-feedback-validation.js:13`), so that dependency points the wrong way.

**Where the plan doesn't match the code.**
- **`wakeHook.releaseNote` can't reach most releases.** `wakeHook` is built per request (`routes/dispatch.js:1636`, `routes/proxy-runner.js:213`). The common release path, `_archiveItem → _releaseIfHeld` on cancel or expiry, has no request and so no hook. Bind the wording late, the way `setWakeCredentialProvisionerFactory` is, and decide what an unbound release says.
- **`findWakeEvent` has no skip rule.** It matches messages against a regex and ignores `kind` (`dispatch-terminal.js:631`). `session-telemetry.js:82` says it is "Deliberately NOT shared". Deriving one would change every wake reader. Settle Waiting 11 by recording that.
- **Putting the table in validation creates an import cycle.** Validation imports the store. Make the table a leaf module that imports nothing, and keep the store's re-export.

**Done the obvious way, what it leaves behind.**
- **A fourth kind set.** `DECISION_LIFECYCLE_STAMP_KINDS` (`session-telemetry.js:60`) is another hand-written role set. Without a stamp role in the table, it stays a copy.
- **More `NEVER_RAN` spellings.** Three more exist: `observer-sweep.js:108`, `task-page-loader.js:248` and `dispatch-store.js:1176`. Rewiring only the two named consumers leaves them behind.
- **A kind-order change nobody would catch.** `runner-kickoff.js:61` renders `FEEDBACK_ENTRY_KINDS` into the runner prompt, and its test compares against the same source, so a reorder changes prompt bytes and still passes. Pin the exact literal.
- **Wording to update with the code.** The Lesson at `runs-and-dispatch.md:32` ("counts the word") and the docblocks at `dispatch-store.js:3481` and `dispatch-leftover.js:10` need changing. The `lin-4377` witness should forbid the `formatHeldWakeNote` import. Nothing fails if the Lesson goes stale. Lessons are 4,269 bytes, so there is room.
- **Safe swaps.** `RESUMABLE_TARGETS` gives the same answer as `followUpTarget(t) != null` for null, `''`, unknown values and all four targets, and the halt check is `HALT_MODES.includes`. `dispatch-store.js:644` and `runner.mjs` handle one mode on purpose; leave them.

**Better, and affordable here.** A leaf `dispatch-feedback-kinds.js` with a stamp role, all five `NEVER_RAN` spellings rewired, an exact-order test, and late-bound release wording with a stated default.

**Better still, but not this ticket's.** The store would take leftover policy two ways: a hook per request for feedback, and late-bound setters for releases. One late-bound held-wake policy for both paths is Waiting 5 ("composable hooks"). Name it in the PR rather than adding more setters. Whether `findWakeEvent` should ignore relay kinds (`tool`, `usage`, `resources`) is a real question, but it changes wake behaviour widely.

