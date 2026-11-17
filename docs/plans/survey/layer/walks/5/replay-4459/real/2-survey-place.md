# What this stage really wrote

## Comment on LIN-4459 at 2026-11-13T16:29:16.466Z (1999d0b1)

## Survey global: LIN-4459 @ 0092d8d9e

Read at `0092d8d9e`. That is 20 commits past the grounding `4b5001ddf`. None of them touch `lib/recent-runs.js` or `lib/recommendation-live-wait.js`. Both area notes did change: the `runFact` Waiting entry is now the 9th bullet, not the 14th, so settle it by its text, not its number.

**Where it lands.** `lib/recommendation-live-wait.js` is small, at 80 lines, and its docblock is good. Its only import is `isLiveRun` from `lib/recent-runs.js`, a 141-line pure module. The move itself is clean. The behaviour change is where the risk sits.

**The obvious way gives lineage a third reading.** The ticket says to resolve the terminal with `resolveFollowUpRoot` and `heldWakeHolderOf`. Both are async store methods that walk one row at a time. `heldWakeHolderOf` lives on `DispatchStore` (`lib/dispatch-store.js:3437`); the leftover hook only calls it. `recentRuns(rows)` is synchronous, and nothing in production calls it. Wiring those walks into `loadRecentRuns` adds N+1 reads and a new definition of "what ended". The codebase already has a lineage definition, in two places:

- `deriveLineageFields` (`lib/dispatch-lineage-status.js:91`) calls itself "the one derivation of lineage status". It merges sibling feedback by `rootItemId`. The Dispatch page, the proxy list (`wireStatusOf`) and the duplicate guard (`lineageEndedIds`, `dispatch-store.js:405`) all read it. `_readHistory` already offers `withLineage`, which gives each row its lineage `outcome` in one batched `_lineageOf` read.
- `lib/lineage-closure.js` stamps `closed`, which `runFact` already treats as not live. It does this when the lineage ends `done`, `failed` or `aborted`. `isLineageClosingTerminal` leaves out `skipped`, and `[blocked]` is a pause. That is why exactly those two outcomes hold the wait.

Asking `listHistory` for `withLineage: true` would let `runFact` read the lineage outcome instead of the row's own. The wait, the duplicate guard and the Dispatch page would then agree on one word, with no new walk. Lineage `blocked` maps to `waiting on a person`, exactly as the row's own `blocked` does today. Check first that a ci-wake `custom` continuation carries the holder's `rootItemId`; the factory's inheritance suggests it does. The new failing test should pin that case before relying on it. If the plan's walk is kept anyway, say on LIN-4447 why the shared derivation could not serve.

**Things the move must update, and what notices if it doesn't:**
- `isLiveRun` is also used by `formatRecentRuns` (`recent-runs.js:139`) and by `recommendation-blind-read.js:47`, which imports it from `recent-runs.js`, not from the old module. If the predicate moves, `recent-runs.js` imports `run-live-wait.js` while `run-live-wait.js` imports `QUEUED`/`RUNNING` from `recent-runs.js`: an import cycle. Either `QUEUED`/`RUNNING` move with it, or `isLiveRun` stays.
- Two of the listed importers, `recommendation-facts.js` and `recommendation-look-first.js`, only mention the old module in comments. Three tests import it: `lin-4392`, `lin-4370` and `lin-4437`. `lin-4392:432` pins the literal import string in `proxy-instructions.js`. Tests and the import fail loudly. Prose fails silently: `docs/architecture/source-map.md:225`, `prompt-system.md`, `agent-api.md:52`, `llm-and-prompts.md:84-86,154`, and the docblocks in `openrouter.js:2066` and `dispatch-entrance.js:1726`. Leave `scripts/prompt-template-change-log.md` as it is, because recorded changelog text is never edited.
- The census as written can't pass. Importers have to spell the names they import, and the ticket lists five names, not four. A useful census instead checks that each name is *defined* only in `run-live-wait.js` and that `recommendation-live-wait` appears nowhere in code or tests.

**Better, and within this task's reach:** read lineage through `deriveLineageFields` and retire `runFact`'s row-only read for good. **Better still, not this task's:** `isLiveRun` (run facts) and `liveOnAnchor` (`lib/live-anchor.js`, enriched loops) are two "live" predicates. So are the wait's read and the duplicate guard's 5-minute check. Settling both pairs into one rule is the claim compare-and-set already noted in Waiting. That work belongs to Runs, later.

Nothing on LIN-4447 or LIN-4448.

No change to the LIN-4459 description (snapshots unchanged across this step).
