# What this stage really wrote

## Comment on LIN-4459 at 2026-11-13T16:25:47.704Z (6dc83aaf)

## Survey open-0: LIN-4459 @ 0092d8d9e

**The ground has moved.** The ticket says 4b5001ddf is still HEAD. origin/main is now 0092d8d9e, 20 commits and 118 files later. "Waiting 14" by position is now a close-out entry. The entry this piece settles is the `runFact` one at `docs/areas/runs-and-dispatch.md:89`, so find it by its text. Lessons is 5,195 bytes.

**The hard part is the mechanism, not the move.**
- `resolveFollowUpRoot` and `heldWakeHolderOf` are **async store methods** in `lib/dispatch-store.js` (3230, 3437) that do their own history reads. `heldWakeHolderOf` is not in `dispatch-leftover-hook.js`, which only calls it.
- `stageRuns`/`recentRuns` are pure and synchronous, and the tests feed them hand-built rows, so "callers hand the rows over" can't reach either helper.
- Both helpers walk **up**, from a follow-up to its root. A parked stage needs the terminal of its **descendants**.
- Calling them per row would add store reads to `codeRouteOf`, which every recommendation surface goes through.

**The store already answers this.** `deriveLineageFields`/`mergeLineageFeedback` merge a lineage's feedback by `rootItemId`. `listHistory`'s `withLineage` option returns each row's wire `outcome` through `wireStatusOf` (`dispatch-store.js:~2120`). `blocked` already maps to `WAITING_ON_A_PERSON`, which isn't live. So the fix may be that `runFact` prefers the lineage outcome. The deeper problem: `recent-runs` works out its own outcome per row beside the store's one wire word (LIN-2122). Two readers of one fact is what LIN-4447 exists to remove. Open question: does a held-wake holder share the stage's `rootItemId`? If not, that is the one case that really needs `heldWakeHolderOf`.

**"Pending" means two things.** In `runFact`, `r.status === 'pending'` is a **queue** row, which has no lineage. The ticket's `[pending]` is a park marker on a **taken** row (`derivePendingPark`). The witness must be a taken row with `[pending]` feedback, or it can pass for the wrong reason.

**Smaller traps:**
- Moving `isLiveRun` creates an import cycle: `formatRecentRuns` uses it, and `QUEUED`/`RUNNING` live in `recent-runs.js`.
- The importer list is wrong:
  - `recommendation-blind-read.js` imports `isLiveRun` from `recent-runs`, not the old module.
  - `recommendation-facts.js` and `recommendation-look-first.js` only name it in comments.
  - Three unlisted test files import the old path (lin-4370, lin-4392, lin-4437), and lin-4392:432 checks the import line with a regex.
- The census says "four names" but lists five, and importers must spell them, so it probably means the module path. Even then, `scripts/prompt-template-change-log.md:188` names the old path and is recorded changelog text you may not edit. Limit the census to `lib/`, `routes/`, `tests/` and `docs/areas/`.
- `docs/areas/llm-and-prompts.md:84-86` holds both the compare-and-set note and the LLM-side entry.

**What I'd do first** (after asking LIN-4448 again): write the failing witness from rows the store really writes. That is a taken stage parked `[pending]`, a ci-wake `custom` continuation and a held-wake holder, with real `rootItemId`/`followUpTo`/`heldWakeFor`. Then check whether `deriveLineageFields` already returns `skipped`/`blocked` for that stage. If it does, comment on LIN-4447 to change course to the lineage read. Do the mechanical move after that.

Nothing on LIN-4447 or LIN-4448.

No change to the LIN-4459 description (snapshots unchanged across this step).
