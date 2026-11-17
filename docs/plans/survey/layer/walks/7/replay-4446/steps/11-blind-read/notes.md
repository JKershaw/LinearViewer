# 11-blind-read notes

**Written**
- verdict-69 (of blind-read, outcome better), `on` change-57@3, in task-9.
- finding-70 to close-out: consumers-test title/comment still name "the browser copy".
- finding-71 to close-out: cost-format.test.js header claims a retired parity comparison; dead `export const TABLE`.
- finding-72 in/to area-1: one-module shim, hard-coded guard, timing rule unchecked for new consumers; about decision-29, decision-46, finding-25, change-57.
- finding-30 revised (v3): added `public/ship.js` and `public/ship-biscuit.js` to its hand-synced copies, not a new finding.
- run-73 added, ended done. Nothing closed: no open record was addressed to blind-read.

**Looked up**: change-57 (version to pin); `find --to blind-read`; areas (only area-1); area-1 open records and text searches (ship-layout, shim, CostFormat, TABLE…) for duplicates, which turned up finding-30.

**Refusal**: `{"error":"outcome better is not in the set for PR #2423 at 1de016f52 against 4b5001ddf"}`. `of` picks the outcome set, so it must be the stage name. Re-sent with `of:"blind-read"` and moved the PR/base into reasoning.

**Relied on, not in brief or store**: the PR diff at 1de016f52 itself: test titles, the `TABLE` export, the `SHIM` constant and consumer list in shared-modules.test.js, and the ship.js/ship-biscuit.js comments. The "other-features" area (docs/areas/other-features.md) is not an area in the store.

**Brief carried, not needed**: the review's full account (run-68), which includes its "Approve" verdict. That is a leak to a blind actor, because only verdict records are filtered. Also lesson-2, check-63, finding-66, finding-67, check-16 and decision-26.

**Couldn't place**: the fix-sized items' owner. I chose close-out (next on the branch) rather than leftover, which has already run.
