# What this stage really wrote

## Build comment on LIN-4455 at 15:47:57 (after five build beats, 15:09-15:48)

## Piece 5 built: PR open, CI green

**PR:** https://github.com/JKershaw/LinearViewer/pull/2427 (base `main`, head c95b9f139). Not merged.

**CI on c95b9f139:** all eight checks passed (run 43455220050): `Unit tests`, `Unit tests (proxy, clock +400d)`, `E2E shard 1/4` to `4/4`, `Secret scan (source)` and `CI success`. Before the PR, I ran 578 test files locally on the rebased branch: 14,629 of 14,629 passed. These were the tests that touch a changed file, the tests that grep a moved symbol, and the repo-wide census tests.

**What this retires:**
- **The restated constants.** `NEVER_RAN` was spelled out in seven places and now has one home. The leftover decision's halt pair and its `RESUMABLE_TARGETS` now come from their owners.
- **The store's ownership of the release wording.** The store no longer imports or calls `formatHeldWakeNote`.
- **The hand-written kind sets:** the store's runner allowlist, the parked-wait relay set, and four copies of the decision-stamp set in `lib/`.
- **Waiting 2, 4 and 11:** settled and removed from the area note. The "counts the word" Lesson is corrected and one Lesson is added. Lessons are 4,794 bytes.

**Decisions:**
- **`FEEDBACK_KINDS` is a leaf module, `lib/dispatch-feedback-kinds.js`, that imports nothing.** The validator sits in import cycles. The store keeps re-exporting `FEEDBACK_ENTRY_KINDS`, so `lib/prompts/` is untouched and the runner prompt is byte-identical.
- **`findWakeEvent` gets a `mayCarryWake` column, not a filter.** The column is true for every kind and unknown kinds pass, so its behaviour and the stored rows it reads are unchanged.
- **`NEVER_RAN` lives in `lib/dispatch-terminal.js`.** It already held both statuses and imports only leaf modules. `dispatch-fields` would have created an import cycle.
- **The release wording is bound late by the leftover step.** `createLeftoverStep` binds its wording into its store when it is built. The re-release uses `wakeHook.releaseNote`. An unbound store says "did not run" with a default line that names no feature. This keeps lin-4373 unchanged and keeps "leftover" out of the store's code.
- **One existing test re-pointed: `decision-lifecycle-stamp-drift`.** Its copy-sync assertions now check against the table; none was dropped.
- **One behaviour edge:** a target of `0` or `false` used to be resumable through `|| 'cli'`. It is now refused like any unknown target, which is how `followUpTarget` fails closed everywhere else.

**Deliberately left:**
- Waiting 5: one composable `wakeHook`. The setter's docblock names it.
- The browser copies of the stamp kinds in `public/dispatch.js` and `public/session.js`. Browser scripts can't import `lib/`, so the drift test pins both copies to the table.
- The remint refusal in `routes/dispatch.js`. It asks `NEVER_RAN` now, but only the census covers it: the response is identical either way.

**Plan departures** are recorded on LIN-4447 in comments 055a6035 and 2f488272.

## Comment on LIN-4447 (the parent) at 2026-11-13T15:42:41.079Z

## Piece 5 (LIN-4455): PR open, one more change to the plan

PR: https://github.com/JKershaw/LinearViewer/pull/2427

This adds to comment 055a6035, which covered the leaf `FEEDBACK_KINDS` module, giving `findWakeEvent` a column rather than a filter, and binding the release wording late.

**`NEVER_RAN` lives in `lib/dispatch-terminal.js`.** The plan said to import it "from its owner", but no owner existed, and the survey suggested `lib/dispatch-fields.js`. `dispatch-terminal` already holds both statuses in `TERMINAL_HISTORY_STATUSES`, every consumer already imports it, and it imports only leaf modules. `dispatch-fields` imports `dispatch-wake`, which imports `dispatch-terminal`, so homing it there would have left the terminal set as a copy or created an import cycle.

**How the release wording is bound.** `createLeftoverStep` binds its own wording into the store when it is built (once, in server.js). The `_applyWakeHook` re-release uses `wakeHook.releaseNote`. An unbound store uses a default line that names no feature. The PR names Waiting 5 (one composable held-wake policy) as the follow-up this piece leaves.

## PR #2427 body (opened 15:41)

## Body

LIN-4455, piece 5 of LIN-4447 (Runs & dispatch, left simpler): one declaration per restated constant, one `FEEDBACK_KINDS` table.

## What this retires

- **The restated constants.** `NEVER_RAN` (cancelled/expired) was spelled out in seven places. It now has one home, `lib/dispatch-terminal.js`, which every consumer already imported:
  - `lib/dispatch-leftover.js`;
  - the store's `_releaseIfHeld` and `listHistoryLineageRows`;
  - `lib/observer-sweep.js` and `lib/task-page-loader.js`;
  - `routes/dispatch.js` and `routes/proxy-dispatch.js`.

  `TERMINAL_HISTORY_STATUSES` and `NO_ATTEMPT_STATUSES` are now built from `NEVER_RAN`. The leftover decision's hand-written halt pair is now `HALT_MODES` (`lib/workspace-halt.js`), and its `RESUMABLE_TARGETS` is now `followUpTarget` (`lib/dispatch-targets.js`).
- **The store's ownership of the release wording.** `lib/dispatch-store.js` no longer imports or calls `formatHeldWakeNote`.
- **The hand-written kind sets:** the store's runner allowlist, the parked-wait relay set, and the four `lib/` copies of the decision-stamp set (`session-telemetry`, `wall-clock-summary`, `run-view`, `digest-feedback`).
- **Waiting 2, 4 and 11** in `docs/areas/runs-and-dispatch.md` are settled and removed.

## Against `## As asked`

| Clause | Delivered by |
|---|---|
| `dispatch-leftover.js` and `_releaseIfHeld` / `releaseHeldWake` import halt modes, `NEVER_RAN` and the follow-up target from their owners | Beat 3 (46b8d00a5). `releaseHeldWake` restated none of them; `_releaseIfHeld` now asks `NEVER_RAN`. |
| `wakeHook.releaseNote` supplies the release wording; the store stops calling `formatHeldWakeNote` | Beat 4 (c95b9f139). `wakeHook.releaseNote` on the hook's re-release; late binding for every release that has no request (see below). |
| One `FEEDBACK_KINDS` table carries each kind's roles; `PARKED_WAIT_SKIPPED_KINDS`, `FEEDBACK_ENTRY_KINDS` and `findWakeEvent`'s rule derive from it | Beat 2 (ec4b2a68f), in a leaf module (see below). |
| Settles Waiting 2, 4, 11 | Beat 4: all three entries removed. |
| Witness: a test that iterates `HALT_MODES` and shows every mode stops a leftover | `lin-4455-kinds-and-constants-characterization` (beat 1). Before beat 3 it failed when a mode was added to `HALT_MODES`; now that passes, and the test fails if the leftover drops a mode. |
| Witness: `lin-4377` counts the import, not the spelling | `lin-4377-store-knows-no-leftover` keeps its word count and adds an AST check: the store neither imports nor names `formatHeldWakeNote`. On the old store it failed at the import and at the call. |
| Remove the settled Waiting entries and the stale Lesson clause; keep Lessons under 6,144 bytes | The "counts the word" Lesson is corrected and one Lesson is added (the kinds table, and constants imported from their owners). Lessons are 4,794 bytes after rebasing onto LIN-4454. |
| Readiness never stored; no GitHub/provider reads; stored history never recomputed; prompt changelog untouched; the LLM & prompts side stays LIN-4448's | None of these touched. `lib/prompts/` has no diff, and the rendered runner prompt is byte-identical (15,766 bytes, checked with `cmp` against main). `findWakeEvent`'s behaviour is unchanged, so stored rows read as before. |

## Where this departs from LIN-4447's plan

Recorded on LIN-4447 (comment 055a6035) and on LIN-4455.

1. **`FEEDBACK_KINDS` lives in a leaf module, `lib/dispatch-feedback-kinds.js`, not `lib/dispatch-feedback-validation.js`.** The validator sits in import cycles with telemetry and the terminal reader. The leaf imports nothing (a test checks this), validation and the store import from it, and the store keeps re-exporting `FEEDBACK_ENTRY_KINDS`, so `lib/prompts/runner-kickoff.js` is untouched.
2. **`NEVER_RAN` is homed in `lib/dispatch-terminal.js`, not `lib/dispatch-fields.js`** (the survey's suggestion). `dispatch-terminal` already held both statuses in `TERMINAL_HISTORY_STATUSES` and imports only leaves. `dispatch-fields` imports `dispatch-wake`, which imports `dispatch-terminal`, so homing it there would have left the terminal set as a copy or created a cycle.
3. **The release wording is bound late, not only through a per-request `wakeHook`.** Cancel, expiry and the stopped-run cleanup all go through `_archiveItem` → `_releaseIfHeld` with no request, so no hook.
   - `createLeftoverStep` owns the wording and binds it into its store (`setHeldWakeReleaseNote`, the `setWakeCredentialProvisionerFactory` pattern) when it is built, once in server.js.
   - The re-release in `_applyWakeHook` takes `wakeHook.releaseNote`.
   - An unbound store says `The step holding this wake did not run (its row was <status>). The build's own outcome follows.` It names no feature, and a wording that throws falls back to it.
4. **`findWakeEvent` gets a table column (`mayCarryWake`, true for every kind, unknown kinds pass), not a derived filter.** It had no skip rule; adding one would change wake minting and every reader of stored rows.

## Tests

New:
- `lin-4455-kinds-and-constants-characterization`: today's behaviour, pinned from outside the declarations.
- `lin-4455-feedback-kinds-table`: every row declares every role; the leaf imports nothing; each set is the table filtered by one role; a census for hand-written kind sets.
- `lin-4455-constants-owners`: behaviour driven by each owner, and a census for `[cancelled, expired]`, `[pause, stop]` and `[cli, web]` written outside their owners. `lib/runner-kit/` is exempt: it is self-contained and pinned by the contract test.
- `lin-4455-release-wording`: the bound wording on all three requestless paths, the hook's wording on the re-release, and the unbound default.

Every new test was seen to fail, either against the unfixed code or under a mutation that was then restored.

**One existing test re-pointed:** `tests/unit/decision-lifecycle-stamp-drift.test.js`. Its copy-sync assertions now check against the table instead of the copies this PR retires:
- the expected trio is still checked against the exact three-kind literal;
- the `lib/` readers must import the set and spell no stamp literal;
- "declared once" now means zero literals in `session-telemetry.js`.

No assertion was dropped.

## Behaviour edge

- **A target of `0` or `false` is no longer resumable.** Before, `RESUMABLE_TARGETS.has(doc.target || 'cli')` treated it as resumable. Now it is refused like any unknown target, which is the fail-closed rule `followUpTarget` already applies everywhere else.

## Deliberately left

- **Waiting 5, one composable `wakeHook`.** The store now takes held-wake policy two ways: the hook per request, and the late-bound wording. Unifying them is that entry's job; the setter's docblock names it.
- **The browser copies of the stamp kinds in `public/dispatch.js` and `public/session.js`.** Browser scripts can't import `lib/`; the drift test pins both copies to the table.
- **The remint refusal in `routes/dispatch.js`.** It now asks `NEVER_RAN`, but every refusal there returns the same 403 body and the next check refuses such a row as `not-taker`, so only the log reason differs. Only the census covers it.
- **The intentional one-mode sites** (the store's stopped-run gate, `lib/runner-kit/runner.mjs`) are unchanged.

## Area note

`docs/areas/runs-and-dispatch.md`:
- Waiting entries removed: `lib/dispatch-leftover.js` restating constants (2); `releaseHeldWake` prepending leftover wording (4); feedback kinds lacking one declaration (11).
- Lesson corrected: "The store knows no leftovers", which said the witness "counts the word".
- Lesson added: the kinds table, and constants imported from their owners.

`docs/architecture/source-map.md` has an entry for the new leaf module.

