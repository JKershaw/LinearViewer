# What this stage really wrote

## Comment on LIN-4459 at 2026-11-13T17:01:55.610Z (db296654)

## Review — LIN-4459

Reviewed PR https://github.com/JKershaw/LinearViewer/pull/2432 at head `7424cfb8fa42f28b303138c76f20cbb6cb74b5f2` (base `0092d8d9e`, which is 5 docs-only commits behind `origin/main` `2aab32bf0`; mergeable).

CI: green on head 7424cfb8f, run 43466823788. All 8 checks pass: Unit, Unit (proxy, clock +400d), E2E 1–4, Secret scan, CI success. I also re-ran 333 related unit tests myself (area notes incl. `area-map-placement`, lin-4392/4370/4437/4455, runner-kickoff), both on the head and on a local merge of the head with current `origin/main`: 333/333 pass both times.

### Against what was asked, sentence by sentence
- **Create `lib/run-live-wait.js` with the five names.** Met. `QUEUED`/`RUNNING` move with `isLiveRun`, and `run-live-wait.js` imports nothing from `recent-runs.js`, so there is no cycle.
- **Delete `lib/recommendation-live-wait.js`, no shim, update importers.** Met. The ticket's list was partly wrong (Survey 6dc83aaf): `recommendation-blind-read.js` now imports `isLiveRun` from the new home, the two comment-only files are corrected, and the three test importers move too. `recommendation-live-wait` appears nowhere in `lib/`, `routes/`, `tests/`, `scripts/` or `docs/` outside the historical `docs/plans` and `docs/reviews`. `scripts/prompt-template-change-log.md` is untouched.
- **Behaviour change: a `[pending]` stage whose lineage ends `[blocked]`/`[skipped]` is not live.** Met. `runFact` (`lib/recent-runs.js:76-79`) takes the lineage word only for a row that is parked and has no terminal of its own.
- **Resolve from the unfiltered lineage via `resolveFollowUpRoot`/`heldWakeHolderOf`.** Met by a recorded departure, which the ticket allows ("where the code shows it is wrong, change course and say so"). It is recorded on LIN-4447 in d3553049. The helpers walk up and run per row; the store's batched `withLineage` read (`deriveLineageFields`, the one lineage derivation) reads every row sharing the `rootItemId`, independent of the `HISTORY_ROWS` window and the stage filter. I agree with the departure. I checked that production follow-ups do share the stage's root: `lib/dispatch-factory.js:724` sets `inherited.rootItemId = anchor.rootItemId || fields.followUpTo`, and ci-wake goes through `enqueueFollowUp`, which uses the factory.
- **Move the claim compare-and-set note unchanged.** Met. Only the path changed, plus a "moved from" tag (`docs/areas/runs-and-dispatch.md:91`, and in the module docblock).
- **Retires / Settles Waiting.** Met. The `runFact` Waiting entry is gone from the Runs note, and both live-wait entries are gone from the LLM note.
- **Witness / census / area-map-placement.** Met. The census is read as "defined once, plus the old path gone", as Survey recommended. `area-map-placement` is green.
- **"Before starting: ask LIN-4448 again."** Met in part. The original agreement stands (08c9c898, plus correction 097a3442). The renewed ask (LIN-4448 0510ffe0) was posted at 16:42, after the build, and has no reply yet. It also does not mention the `runner-kickoff.js` import change below. This goes to the ledger.
- **Binding constraints.** Met. Readiness is derived on read; there are no provider reads; Lessons is **5,389 B** (under 6,144); the LLM note's Lessons is 3,950 B; no changelog text is edited. The PR's Retires list misses one item (fix 1).

### Mutation checks (each reverted afterwards)
- Dropped `withLineage: true` from `loadRecentRuns`: W1 (blocked) and W2 (skipped) went red.
- Deleted the parked branch in `runFact`: W1 and W2 went red.
- Dropped `'blocked'` from `PARKED_LINEAGE_ENDS`: W1 went red.
- Removed the `park &&` guard: the "NOT parked" control went red.
The builder's census probe (a second `export const isLiveRun`) is reported red in the PR body.

### Regression check
`git log -30` on `recent-runs.js`, `dispatch-store.js` and the lin-4455 test shows LIN-4370's shared `WAITING_ON_A_PERSON` and LIN-3364's closed-stamp time; both are intact. Nothing is re-applied or reverted.

### Scope question: the `FEEDBACK_ENTRY_KINDS` re-export (autopilot cross-check 64561ac2)
My ruling: **keep it.** It is **inside** the parent's bounded class ("each rule has one home, and the copies are gone"), and it is the same idiom this ticket itself bans for its own module ("no re-export or shim"). The Waiting entry it retires was written by LIN-4455's own blind read, which asked for exactly this drop with the condition "runner prompt bytes and the kinds' order must not change". `runner-kickoff.test.js` and the lin-4455 table test pass. No importer of the store re-export remains in this repo or in simple-dispatcher. The lin-4455 assertion it flips pinned the then-current compatibility state, not a requirement. The leftovers `Retires:` line names a Waiting entry this diff does remove (`docs/areas/llm-and-prompts.md`, the `runner-kickoff.js` entry). Two things are missing: the PR body does not say it (fix 1), and the entry sits on A14's side, so LIN-4448 should hear about it (ledger item 1).

### Isolated, or one of a class?
The class is a parked stage judged by its own row. Every reader of the wait (`liveWaitOf`, look-first's off-switch, blind read's `endedReadsSince`, the selector lines) goes through `loadRecentRuns`, so all of them get the fix at once, and the PR lists that reach. No other row-only park reader turned up. **Outside**, not a defect today: the second live predicate `liveOnAnchor` (`lib/live-anchor.js`) beside `isLiveRun`. It reads a different shape (enriched loops), and the `isLiveRun` docblock already records why. The race fix is already a Waiting entry. No ticket is needed.

### Fixes for close-out
1. **PR #2432 body, `## Retires`:** add a bullet: "The store's `FEEDBACK_ENTRY_KINDS` re-export (`lib/dispatch-store.js`). `lib/prompts/runner-kickoff.js` and the tests import it from the leaf `lib/dispatch-feedback-kinds.js`; the `tests/unit/lin-4455-feedback-kinds-table.test.js` assertion now pins that the store does not re-export it. This settles the LLM & prompts Waiting entry from LIN-4455's blind read."

### What CI Did Not Prove
- **Inside** (the ticket's "ask LIN-4448 again" sentence): LIN-4448 has not confirmed the renewed ask (0510ffe0), and it has not been told about the `runner-kickoff.js` import change or the LLM-note entry that change retires. **Before the merge:** close-out posts that addition on LIN-4448, then either a LIN-4448 reply confirms, or close-out records that 08c9c898 ("agree… no shim… whichever of us lands second changes only the import path") already covers the move and that the runner-kickoff change touches only an import path, with the prompt bytes unchanged (`runner-kickoff.test.js`).
- **Inside** (a claim this change depends on): CI ran on base `0092d8d9e`. If LIN-4458 or LIN-4465 (which edits comments in `lib/recent-runs.js`, per 097a3442) lands first, the PR has to be rebased. **Before the merge:** CI green on the exact commit merged, and lin-4392's LIN-4459 describe block still green. My local merge with today's `origin/main` `2aab32bf0` passed 333/333.
- **Inside** (cost of the behaviour change): every recommendation read (`codeRouteOf`, hit by the autopilot and recommend-and-dispatch) now pays one batched `_lineageOf` read, plus the stale-row self-heal writes `recomputeLineageRows` makes. These are the same reads and writes the proxy list and Dispatch history already do, but CI does not measure latency or write volume. **Named monitor:** the `console.error` "Lineage recompute lost its compare-and-set …" in `lib/dispatch-lineage-status.js`, together with recommendation latency on the proxy route. Only production traffic shows contention. **Named rollback:** revert the PR #2432 merge commit. That is reversible: no schema change, and the heal writes are the derivation the list already persists.
- **Inside** (real-world behaviour): the witnesses build rows through the real store but set `rootItemId` by hand. I confirmed production inheritance by reading the code (`dispatch-factory.js:724`), not from live data. **After the deploy:** find one ticket with a stage parked `[pending]` whose ci-wake `custom` or held-wake follow-up has since posted `[blocked]`/`[skipped]`. `GET /api/proxy/recommendation/<id>` must no longer answer "wait" naming that stage (before the change it did, until an abort). If no such ticket exists yet, record that as "not yet observed" rather than discharged.

### Verdict
Approve — conditional on close-out discharging the ledger

Nothing on LIN-4447 or LIN-4448.

No change to the LIN-4459 description (snapshots unchanged across this step).
