LIN-4178 scoped as **a small tidy**: the task, with one extra piece done first. The size record is in output/description.md. The status change (Todo to In Progress) is in output/tracker-actions.md. I posted no comment, as the prompt says.

**Is the ticket still accurate?** Yes. The only commit since the ticket was written is piece 1 itself (10b2c82f, LIN-4177). Every line the ticket cites still matches the code at HEAD.

**The finding that sets the size (I checked both Surveys' claims in the code)**
- **S11/S12 would price nothing on the live site.** The new cost read (lib/cost-read.js:71,129) only reads usage from a row's full `feedback` list. The live /kpis and workspace KPI rows come from the database projection (lib/kpi-stats.js:449-460), which carries `usageEntry` and no `feedback`. The code piece 2 deletes reads both shapes through `usageOf` (lib/dispatch-lineage.js:47), and the approved plan says the read should do the same. Piece 1 never did.
- **The tests would not catch it.** The replay's fake collection has no `aggregate` (tests/fixtures/cost-replay/harness.js:209), so the goldens were built from full-feedback rows. W2 and W6 would pass while the live page shows no priced figures.
- **S13 has the same problem.** The replay's `sessionLoops` (harness.js:244) makes up `status`. Real loop records (lib/pipeline-loops.js:409) have no `status` and no `rootItemId`, so the read's membership test (status must be `taken`) would drop every real loop.
- **The extra piece, done first:** the read takes a row's usage in either shape, and the replay runs S11/S12 on projected rows and S13 on real loop records. Then confirm the goldens still hold at HEAD and run the note-2 assertion. If the goldens do not hold, stop there.
- **How the size was decided.** No person's size comment is on the trail, and the parent has no size record. The standing "err larger" policy weighed "a small tidy" against "consolidate". Consolidating, for example making the KPI query emit the shape the read expects, is worth doing but nothing in the ask depends on it, so I left it in the Surveys.

**Root causes that belong to the task itself (no change to its size)**
- **The S12 zero comes from the data, not the renderer.** `perDay` uses `|| 0` (lib/workspace-kpi-stats.js:98), and the browser chart reads the same numbers (public/workspace-kpis.js:127-130). Fixing only the renderer would still draw a $0.00 bar.
- **S13's formatter hides a real $0.** `fmtUsd` returns null for any amount of zero or less (lib/render-run-steps.js:270).
- **The deleted join needs one successor.** S11 and S12 both still need the outcome status and ticket walk that `joinCostLineages` supplies. One shared successor stops the join being copied into two files.

**Cuts:** none. Every clause of the ask is delivered.

**Risk the builder should watch**
- **Moving a straddler to its founder's issue may move more than credits.** The `/kpis` fold also publishes per-ticket shares, the ticket count T and the attributable share. If these move in the replay, they need to be named as consequences of change (b) in the comment the ticket already asks for on LIN-4176. Otherwise W9 will flag them.
- **Note-1 decision:** I recommend applying the incomplete rule to S11, as the reviewer did. The ticket leaves this choice to the builder.

**Not a blocker:** the lookup timing on a seeded store can be run, because `mongod` is installed locally.

**Missing input:** the Approve verdict comment (6645f289) was not in the run directory. I worked from the plan's answers to the review notes instead.

The repo is unchanged.

DONE: LIN-4178 sized as a small tidy: fix the cost read for KPI rows, test S11-S13 on real row shapes, then wire them; no cuts; status set to In Progress.
