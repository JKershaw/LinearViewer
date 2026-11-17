# Close-out notes (task-60, LIN-4450)

**Written / revised / ended**
- change-84 revised (head → 26299c9b0), then ended `merged` (squash 2bf788b6d, deployed, rollback).
- finding-101, -106, -107, -108 (to close-out) ended `done` with the fix in 26299c9b0.
- finding-91 revised: `to` close-out → task-61 (left open).
- finding-92 (to task-61, "blocked by PR #2421") ended `done`: merged.
- finding-110 added, to task-62: deployed, so check-90/102/103 can run now.
- task-60 ended `done`. run-111 added and ended `done`.

**Looked up:** `show --task task-60` (what is open); finding-91/-75/-99 (source-map history); check-90/-102/-103 and task-62 (the three not-run ledger items were already carried there, so I added none); finding-79 (the bulk-read split, already waiting in area-1, left alone); task-61 and finding-92 (what the merge unblocks); `--text source-map`.

**Refusals:** none.

**Relied on beyond brief/queries:** the commit SHAs 26299c9b0/2bf788b6d, the harbour.cat footer check, CI on the final head, the 25,319 local count, the archived description, the `workspace-api.js` caller and the source-map line-42 citation. All came from the stage's own work, not the store. The decision that the bulk-read split needs no ticket rested on `docs/areas/providers.md`, which the store does not show.

**Brief carried but unneeded:** the full plan-54 text, decisions 63/82/85–89, all lessons, area counts, and most of verdict-105.

**Couldn't place:** finding-91. The output never says whether source-map.md :82/:216 got the region-module mention. I passed it to task-61 rather than closing it.
