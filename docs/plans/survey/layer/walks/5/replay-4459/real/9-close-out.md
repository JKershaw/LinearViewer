# What this stage really wrote

## Comment on LIN-4448 at 2026-11-13T17:06:52.284Z (b564445b)

## LIN-4459 (LIN-4447 piece 4): addition to the renewed ask — the runner-kickoff import and one retired LLM entry

Adding two things my renewed ask (0510ffe0) did not mention. PR: https://github.com/JKershaw/LinearViewer/pull/2432

1. **`lib/prompts/runner-kickoff.js` changes its import only.** It now imports `FEEDBACK_ENTRY_KINDS` from the leaf `lib/dispatch-feedback-kinds.js`, because the PR drops the `lib/dispatch-store.js` re-export (LIN-4455 left it "for existing importers"). Kinds and their order are unchanged, and `runner-kickoff.test.js` (prompt bytes) and the LIN-4455 table test pass.
2. **`docs/areas/llm-and-prompts.md`: the entry opening "`lib/prompts/runner-kickoff.js`: imports `FEEDBACK_ENTRY_KINDS` from the store" is retired.** That entry came from LIN-4455's blind read and asked for exactly this drop on the condition that prompt bytes and kind order do not change.

Your comment 08c9c898 (on LIN-4447) agreed that "whichever of us lands second changes only the import path". Unless you say otherwise on LIN-4459 before then, I am recording that this is covered by that agreement, since the only change in your area's code is an import path and the prompt bytes are unchanged, and proceeding to merge.

## LIN-4459 state set to Done at 2026-11-13T17:29:57.974Z

## Added to LIN-4459 description by 17:29:58: live description against the 17:05:16 snapshot

## Implemented (close-out stub)

Merged: PR [#2432](<https://github.com/JKershaw/LinearViewer/pull/2432>), merge commit `c174185f6`; audit notes PR [#2434](<https://github.com/JKershaw/LinearViewer/pull/2434>) (`5cf4f6aa2`, two Waiting entries). Deployed (footer `17faa83f4` contains the merge).

The plan was implemented as approved, with one recorded departure: the terminal of a parked stage is read from the store's batched lineage (`listHistory({ withLineage: true })`, `deriveLineageFields`), not through `resolveFollowUpRoot`/`heldWakeHolderOf` (LIN-4447 comment `d3553049`, accepted by review). The PR also dropped the store's `FEEDBACK_ENTRY_KINDS` re-export (review accepted it; LIN-4448 told in `b564445b`).

The full history (survey, plan, review, blind read) is preserved in the task snapshots and the comment trail.

## Comment on LIN-4459 at 2026-11-13T17:29:58.525Z (9584b81c)

## Close-out — LIN-4459

**Merged:** PR https://github.com/JKershaw/LinearViewer/pull/2432, merge commit `c174185f6`, pinned to head `2d02bb4a21b4e1cd2212d250cc36d523c34395a1`. Deployed: harbour.cat's footer shows `17faa83f4`, which contains the merge. Audit notes PR https://github.com/JKershaw/LinearViewer/pull/2434 (`5cf4f6aa2`, docs only) holds the Waiting entries below.

**How it meets what was asked:** as in review `db296654` (every sentence met; the one departure, the store's batched lineage read instead of the per-row helper walks, is recorded on LIN-4447 in `d3553049`).

### Changes I made after the approval (not re-reviewed)
- `2d02bb4a2`: `runFact` (`lib/recent-runs.js`) maps the wire word `blocked` to `WAITING_ON_A_PERSON` through one local `outcomeOf` used by both branches. Answers blind read, "Inside the area, fix-sized", item 2.
- `2d02bb4a2`: `tests/unit/session-run-transcript-entries.test.js` header: the garbled parenthesis is reworded and the citation points at `lib/dispatch-feedback-kinds.js` with no line number. Answers blind read item 1.
- PR #2432 body: `## Retires` now names the `FEEDBACK_ENTRY_KINDS` re-export, the eight repointed importers, the changed LIN-4455 assertion, the settled LLM Waiting entry, and the two live-wait and one `runFact` Waiting entries (review fix 1). A "Close-out changes" section lists the commit.
- `5cf4f6aa2` (#2434): two `## Waiting` entries in `docs/areas/runs-and-dispatch.md` for the blind read's larger inside finds (below). Lessons stays 5,400 B including headings, under 6,144; area-note tests pass (57/57).

### Ledger
1. **LIN-4448 coordination (inside).** Posted the `runner-kickoff.js` import change and the retired LLM entry on LIN-4448 (`b564445b`). No reply came before the merge. Recorded here: its comment `08c9c898` on LIN-4447 ("whichever of us lands second changes only the import path") already covers this, because the only change in its area's code is an import path; kinds, order and prompt bytes are unchanged (`runner-kickoff.test.js` and the LIN-4455 table test pass in CI).
2. **Rebase / exact-commit CI (inside).** Neither LIN-4458 nor LIN-4465 had touched `lib/recent-runs.js` on main when I merged (main was `2aab32bf0`, docs-only ahead of the PR base). CI run 43469455968 on exactly `2d02bb4a2`: Unit tests, Unit tests (proxy, clock +400d), E2E 1 to 4, Secret scan and CI success all pass. The LIN-4459 block in `lin-4392-live-stage-wait.test.js` passes in that run, and passed locally (242 related tests) on the fix commit. The notes PR #2434 also had green CI (run 43472269603) on its exact head.
3. **Latency and write cost (inside).** Named monitor (review's): the `console.error` "Lineage recompute lost its compare-and-set …" in `lib/dispatch-lineage-status.js`, plus recommendation latency on the proxy route. Named rollback: revert the #2432 merge commit `c174185f6`. After the deploy, `GET /issues/LIN-4458/recommend` and `/LIN-4460/recommend` answered 200 (4.5 s and 2.0 s, including the LLM call). I have no log access, so the monitor itself is not read here.
4. **Real-world check (post-deploy): not yet observed.** I listed every taken dispatch on the workspace after the deploy: no ticket has a stage parked `[pending]` (the only taken stage rows were LIN-4451, LIN-4459, LIN-4465 and LIN-2537, all `working`), so no ticket has a parked stage with a blocked or skipped ci-wake or held-wake follow-up to check. Not run: the check that `/recommend` no longer answers a `liveWait` naming a parked stage whose follow-up ended `[blocked]`/`[skipped]`. Why: no qualifying ticket exists today. Who can run it: the operator, the next time a parked stage's follow-up blocks. The witnesses W1/W2 (real store writes) cover it until then. This does not hold the close.
5. **Blind read, larger inside finds (settled as Waiting entries, #2434, no ticket: neither breaks behaviour today).** (a) The run-outcome words have two homes (`lib/run-live-wait.js`, `lib/recent-runs.js`); one home touches LLM & prompts importers. (b) A parked stage whose lineage ended is dated by its park time, since `listHistory` carries no lineage end time; fixing it is a store change that alters the Dispatch route's output.
6. **Outside:** none. The second live predicate `liveOnAnchor` is an existing Waiting entry (the claim race note), so no new ticket.

### Related tickets and description
- No related ticket to close or cancel: LIN-4447 stays open (other pieces); LIN-4460 was blocked by this ticket and now proceeds. LIN-4448 owns the LLM side and has the notice above.
- Archive: snapshot `299ad5e0` (17:05Z, the newest) verified before pruning (it matches the live description byte for byte). The description below the `## As asked` block is pruned to the unchanged `## Size of the move` plus an implemented stub.
- Gate tickets filed: none.

**Final CI state:** green on the merged head (run 43469455968); deploy landed.
