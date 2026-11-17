# What this stage really wrote

## Comment on LIN-4455 at 15:02:16

## Survey open-0: LIN-4455 @ cfd152fa4

(origin/main is one docs-only commit past the ticket's 4b5001ddf, the LIN-4453 baseline.)

**Why it's harder than "import instead of restate"**

1. **`wakeHook.releaseNote` can't reach most releases.** The hook is built per request (`leftoverStep.forRequest`, `routes/dispatch.js:1636`, `routes/proxy-runner.js:213`) and is only passed into `addFeedback`. Most releases come through `_archiveItem` → `_releaseIfHeld` (`lib/dispatch-store.js:1890`, `:1949`). That path is reached from `removeItem`, `cleanup()` expiry and the stopped-run cleanup, and none of them has a request or a hook. Only the `_applyWakeHook` re-release (`:3429`) holds one. So the wording has to sit on `leftoverStep` and be late-bound into the store, the way `setWakeCredentialProvisionerFactory` already is (`server.js:1146`). Someone also has to decide what an unbound store says. `lin-4373-leftover-step.test.js` asserts "did not run" five times. This is also the second hook surface that Waiting #5 (one `wakeHook`) warns about, so shape it with that in mind.

2. **Putting `FEEDBACK_KINDS` in `dispatch-feedback-validation.js` creates import cycles.** That file imports `dispatch-validation.js`, which reaches `session-telemetry.js` (through prompt-templates → … → wall-clock-summary) and `dispatch-terminal.js` (through dispatch-fields → dispatch-wake). If those two import the table and build Sets from it at load, load order decides whether they hit a TDZ error. A leaf module with no imports avoids this, e.g. `lib/dispatch-feedback-kinds.js`. Validation and the store would import from it, and the store would keep re-exporting `FEEDBACK_ENTRY_KINDS`. That changes the plan, so it needs a comment on LIN-4447.

3. **`findWakeEvent` has no skip rule.** It returns the last matching marker of any kind (`dispatch-terminal.js:631`), and `session-telemetry.js:82` says it is "Deliberately NOT shared". Deriving a filter for it would change the mint path (`dispatch-store.js:3696`) and every reader of stored rows (task-page-loader, run-view, digest-feedback, run-loop-state). That goes against "never recompute stored pre-cutover history". I'd record its role as a column ("every kind may carry a wake") and pin that the current behaviour matches it, rather than add a filter.

4. **Prompt seam.** `lib/prompts/runner-kickoff.js` (A14's side) renders `FEEDBACK_ENTRY_KINDS` into the runner prompt in its current order. A derived list must keep that exact order, which `runner-kickoff.test.js:191` checks. The table also needs rows for kinds that are deliberately not on the allowlist (`decision-answer`, `decision-withdrawal-reversed`; see `DECISION_LIFECYCLE_STAMP_KINDS`, `session-telemetry.js:60`). Without them, "roles" quietly widens what the runner is allowed to post.

5. **`NEVER_RAN` has nothing to import from.** `'cancelled'`/`'expired'` is spelled out at `dispatch-leftover.js:29`, `dispatch-store.js:1906` and `:1176`. One home has to be created where neither side learns "leftover" (`lin-4377-store-knows-no-leftover`). `dispatch-fields.js` is already imported by both. The other two owners are safe, import-free leaves: `HALT_MODES` (`workspace-halt.js`), and `followUpTarget(t) == null` (`dispatch-targets.js`), which is equivalent to `!RESUMABLE_TARGETS.has(t || 'cli')`.

**What I'd do first:** item 1, the late-bound release note. It is the only part that changes the store's shape, and it decides what the rewritten lin-4377 witness counts: no `formatHeldWakeNote` import in the store. Next the leaf kinds module (2–4), with a test that `FEEDBACK_ENTRY_KINDS` keeps its exact order. Constants last; they are mechanical. Lessons are at about 4.3 KB of the 6,144-byte limit, so there is room.

