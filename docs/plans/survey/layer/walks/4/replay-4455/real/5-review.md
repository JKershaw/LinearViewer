# What this stage really wrote

## Comment on LIN-4455 at 15:53:58

## Review — LIN-4455

Reviewed [PR #2427](https://github.com/JKershaw/LinearViewer/pull/2427) at head `c95b9f139` (base `c205190fd`).

CI: green on `c95b9f139`. All 8 checks passed: Unit tests, Unit tests (proxy, clock +400d), E2E 1–4/4, Secret scan, CI success. I also merged the PR into current `origin/main` `5dcf5bcda` (LIN-4457 has landed since the PR's base). It merges cleanly, and the full unit suite on that merge passed 25,457 of 25,457.

### Against what was asked
- **"dispatch-leftover.js and `_releaseIfHeld` / `releaseHeldWake` import halt modes, `NEVER_RAN` and the follow-up target from their owners"**: met. `HALT_MODES.includes` (`workspace-halt.js`), `followUpTarget(t) == null` (`dispatch-targets.js`) and `NEVER_RAN` (new, in `dispatch-terminal.js`). There was no prior owner for `NEVER_RAN`, and a home in `dispatch-fields` would have made an import cycle. The departure is recorded on LIN-4447 (`2f488272`). Scope grew to all seven spellings, as the Size-of-the-move block allows.
- **"`wakeHook.releaseNote` supplies the release wording, so the store no longer calls `formatHeldWakeNote`"**: met, with a recorded departure. `_applyWakeHook` passes `wakeHook.releaseNote`. Cancel, expiry and the stopped-run cleanup have no request, so their wording is bound late (`setHeldWakeReleaseNote`, bound by `createLeftoverStep`). The store neither imports nor names `formatHeldWakeNote`, and the AST witness pins that. Recorded on LIN-4447 `055a6035`.
- **"One `FEEDBACK_KINDS` table in `dispatch-feedback-validation.js` … `PARKED_WAIT_SKIPPED_KINDS`, `FEEDBACK_ENTRY_KINDS` and `findWakeEvent`'s skip rule derive from it"**: met, with a recorded departure. The table is the leaf `lib/dispatch-feedback-kinds.js`; putting it in validation makes import cycles. `findWakeEvent` had no skip rule. It now reads a `mayCarryWake` column that is true for every kind, unknown kinds included, so the stored-row readers behave as before. Four `lib/` copies of the decision-stamp set also derive from the table now. Both departures are on LIN-4447 (`055a6035`).
- **Retires / Settles Waiting 2, 4, 11**: met. Checked against the note at `4b5001ddf`: entries #2 (leftover restatements), #4 (`releaseHeldWake` prepends `formatHeldWakeNote`) and #11 (no kinds declaration) are the three removed. The stale "counts the word" Lesson is corrected. Lessons are 5,195 bytes on the merged tree, under 6,144.
- **Witness: a test iterating `HALT_MODES`**: met (`lin-4455-kinds-and-constants-characterization.test.js` §5).
- **Witness: `lin-4377` counts the import, not the spelling**: met (acorn walk, with a self-check).
- **Binding constraints**: no GitHub or provider reads added; nothing stored is recomputed; `lib/prompts/` is untouched, and the runner prompt order is pinned by an exact literal; the PR says what it retires.

### Mutation checks (LIN-2274)
Each of these was reverted afterwards, and the tree is clean.
| Mutation | Result |
|---|---|
| Add `drain` to `HALT_MODES` and restate the old pause/stop pair in `decideLeftover` | 2 red |
| Swap the `status`/`recap` table rows (prompt order) | 2 red |
| Drop `releaseNote: wakeHook.releaseNote` from `_applyWakeHook` | 1 red |
| Make `setHeldWakeReleaseNote` a no-op | 5 red |
| `createLeftoverStep` stops binding its wording | 2 red |
| `NEVER_RAN` loses `expired` | 7 red |
| `tool` row's `mayCarryWake` set to false | 1 red |
| Restate the follow-up targets as `{cli,web,local}` | 3 red |
| Drop a kind from the `public/session.js` browser copy | 1 red (drift test) |

### Regression check
`git log -30` on the changed `lib/` files: no recent fix to these properties is undone and no revert is re-applied. The LIN-4383 and LIN-4377 "store knows no leftover" rule still holds, and is now enforced harder.

### Isolated, or one of a class?
The class is "a shared constant restated beside its owner". In `lib/` and `routes/`, no other spelling of the `cancelled`/`expired` pair or of the stamp set remains. The browser copies in `public/dispatch.js:1062` and `public/session.js:128` stay on purpose: browser scripts can't import `lib/`, and the drift test pins them to the table (mutation above). `dispatch-store.js:644` and `runner.mjs` handle a single halt mode on purpose. None of these is an unhandled sibling.

### What CI Did Not Prove
- **Inside (the release-wording move).** Stores built without a leftover step use the neutral wording. `lib/account-erasure.js:590` (`cancelRows` → `removeItem`) builds a bare `DispatchQueueStore`. If an erasure cancels a queued leftover holder, the released wake now opens "The step holding this wake did not run…" rather than `formatHeldWakeNote`'s leftover wording. That path already runs without a credential provisioner, so it degrades the same way it already does. **Before the merge:** close-out adds one sentence to the `setHeldWakeReleaseNote` docblock (`lib/dispatch-store.js`, the "Not done here, on purpose" paragraph): stores built outside server.js (account erasure, `scripts/`) bind no wording and release with `UNBOUND_HELD_WAKE_RELEASE_NOTE`, by design. Binding them is not needed.
- **Inside (the follow-up target change).** A target of `0` or `false` now fails closed. Before, `|| 'cli'` made it resumable; now `producingRowIneligibility` returns `target-not-resumable`. The only effect is that no leftover is queued, and this matches `followUpTarget` everywhere else (LIN-3677). **After the deploy:** monitor the `[leftover] skipped reason=target-not-resumable` log line. Only rows already stored with a non-string target could hit it, and CI cannot see production rows. No rollback is needed.
- **Inside (the remint refusal in `routes/dispatch.js:1470`).** It now asks `NEVER_RAN.has(row.status)`, and only the census covers it. Discharged: it tests the same two statuses as the old literal.
- **Inside (the head being merged).** CI ran on base `c205190fd`; `origin/main` is now `5dcf5bcda`. My local merged-tree unit run (25,457 passed) is not CI and covers no E2E. **Before the merge:** close-out confirms `ci-success` is green on the exact commit that merges. Update the branch if GitHub requires it.
- **Inside (the Leftovers comment).** The builder's `### Leftovers` comment, with its `Retires:` line, is not on LIN-4455 yet. The PR body's "What this retires" names Waiting 2, 4 and 11. **Before the merge:** close-out confirms the Leftovers comment has landed and that its `Retires:` names the Waiting entries this diff removes (2, 4, 11).

### Verdict
Approve — conditional on close-out discharging the ledger

