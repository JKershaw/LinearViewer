# Recheck of draft 3 against the revised layer

*19 Nov. A fresh read-only reader was given `layer/design.md` and `integration/design.md` (with the census and placement to cite), and asked where the integration still assumes or contradicts the current layer. Nine finds; I checked the factual ones (`approve-conditional` on main at `lib/run-closeout-state.js:108` and the review prompt; `walks/8/results.md:36`'s wording) [checked]. All nine were taken into draft 3 the same day.*

| # | Find | Fix in `design.md` |
|---|---|---|
| 1 | Slice 1's witness replays walk 8, whose stores hold `check` records and `approve-with-notes`, both since removed | Seeds ported to the current kinds (§10, slice 1) |
| 2 | Slice 3's witness replays walk 7 (areas, paths, `blind`, checks) | Uses slice 1's ported walk 8 stores (§10, slice 3) |
| 3 | Today's "Approve — conditional" had no mapping | `approve` plus one finding `to: close-out` per condition (§4) |
| 4 | "Lessons on the task page", though a lesson is the project's | Project page (§8) |
| 5 | "Only a ticket with no parent gets `asked`" contradicts the layer and §7 | A task made from a ticket gets its words; from slice 2 a breakdown's children have none (§2) |
| 6 | "`harbour` is never a `to`", an unflagged rule | Removed (§1) |
| 7 | Brief size against walk 7's, no longer comparable | Against today's brief and walk 8's (§3) |
| 8 | "18 added and 7 ended" misquoted | "7 ended or handed on" (§6) |
| 9 | What `project` means in Harbour was unsaid | `project` is the workspace (§1) |

**Checked and held** (reader's list, short): no removed concept used as current; plan addressing matches part 2; the blind read is Harbour's; findings with `how`; slice 5's witness; `areas.json` kept for tooling only; the pilot's removal leaves no dangling importer; `project` records wake nothing; round 9 model has 52 cases; §11.3 flags `on-answer`, the actor list and the ninth part.
