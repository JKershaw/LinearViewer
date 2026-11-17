# What this stage really wrote

## Comment on LIN-4447 at 2026-11-13T16:42:08.173Z (d3553049)

## LIN-4459 (piece 4): departure from the approved plan, and a finding

PR: https://github.com/JKershaw/LinearViewer/pull/2432 (branch `feat/lin-4459-run-live-wait`, commit e9a3cb324, on `origin/main` 0092d8d9e).

**Departure.** Piece 4 says to resolve a parked stage's terminal with `resolveFollowUpRoot` and `heldWakeHolderOf`. It does not, and reads the store's shared lineage instead: `listHistory({ withLineage: true })` gives each row the wire outcome from `deriveLineageFields`, through one batched lineage read over the page's anchors. Reasons (the survey comments on LIN-4459 set these out): both helpers are async per-row store walks that go **up** from a follow-up, while a parked stage needs its **descendants**; `recentRuns` and `stageRuns` are pure and synchronous; and a second walk would be a second definition of "what ended". Validated before adopting it: with real store writes, a ci-wake `custom` follow-up and a held-wake `leftover` holder both carry the stage's `rootItemId` and entry tags, so the lineage read covers both cases.

**Scope kept to the plan.** Only a stage parked `[pending]` on its own row is judged by its lineage. A stage that is not parked, whose follow-up posts `[blocked]`, stays live, as before. A parked stage whose lineage ends `done`, `failed` or `aborted` is also not live; those already reached the closed stamp, so that is a no-op in practice.

**Consequences surfaced in the PR, not in scope to change:** selector lines and look-first's "newest run waiting on a person" off-switch now see the lineage's end; a parked blind read whose lineage ends counts as an ended read; a stage ended by its lineage is dated by its park, because the wire row does not carry the lineage's end time.

**Finding, left for a person.** Stages not parked and blocked by a follow-up (not `[pending]`) still read running and hold the wait. That is a separate rule; flagging it for a decision, not changing it here.

**Retires:** `lib/recommendation-live-wait.js` (no shim); `runFact`'s row-only read of a parked stage. **Settles** the runs-and-dispatch Waiting entry on `runFact`, and the two live-wait entries in the LLM & prompts note. The claim compare-and-set note moved to the Runs note.

## Comment on LIN-4448 at 2026-11-13T16:42:14.992Z (0510ffe0)

## LIN-4459 (LIN-4447 piece 4): renewed ask on the live-stage wait move

Your reply 08c9c898 agreed the move. Piece 4 is now built: PR https://github.com/JKershaw/LinearViewer/pull/2432.

What it touches on your side: `lib/openrouter.js`, `lib/proxy-instructions.js`, `lib/recommendation-blind-read.js`, `lib/recommendation-facts.js` and `lib/recommendation-look-first.js` change only their import or comment text. The code-route list in `openrouter.js` is untouched. In `docs/areas/llm-and-prompts.md` the two live-wait entries leave; the claim compare-and-set note moves to the Runs note, unchanged.

Please confirm on LIN-4459 or LIN-4447 that you still agree before the PR merges. If you want a different boundary, say so there and I will change it.

## Comment on LIN-4459 at 2026-11-13T16:42:15.485Z (3e09d1fa)

## Summary: LIN-4459 implemented, PR open

PR: https://github.com/JKershaw/LinearViewer/pull/2432 (commit e9a3cb324, branch `feat/lin-4459-run-live-wait`)

- The live-stage wait moves to `lib/run-live-wait.js`. `lib/recommendation-live-wait.js` is deleted, with no shim.
- A stage parked `[pending]` now takes its lineage's end: `blocked`, `skipped` or a terminal word. Witnesses W1 and W2 failed before the change (`running`) and pass after it.
- The departure from the plan (the store's lineage read, not the helper walks) is recorded on LIN-4447.
- Area notes updated: the `runFact` Waiting entry is settled; the LLM-side live-wait entries leave.
- Tests: the three live-wait files (126 tests) and 65 related files (2073 tests) pass locally. CI is the full proof, and its results are on the PR.

## Comment on LIN-4459 at 2026-11-13T16:48:10.976Z (1cfa16d5)

## LIN-4459: CI green on PR #2432

CI run 43465308840 on commit e9a3cb324: Unit tests, Unit tests (proxy, clock +400d), E2E shards 1 to 4, Secret scan and CI success all pass. The PR is open and mergeable; the merge is for review and the orchestrator, not this run.

No change to the LIN-4459 description (snapshots unchanged across this step).
