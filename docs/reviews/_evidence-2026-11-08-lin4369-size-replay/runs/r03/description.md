## Size of the move

**Size:** consolidate the decision this task touches
**Decided by:** the standing policy

**What this ticket delivers.** Three surfaces get their figures from the one cost read *in production*, not only in the replay: the public cost per finished task (S11), the workspace cost per day (S12), and the run and session page's per-step figures and total (S13). The four old copies are deleted. The S12 and S13 display fixes are in. The note-1 choice is made and named.

**What done means.** The ticket's witnesses (W2 KPI part, W4 part, W5 part, W6, W9 part) pass on a replay that feeds each surface the row shapes production actually gives it. The founder-lookup timing on a seeded store is reported.

**Why this size.** I read the code. Wiring the read in the obvious way passes every gate while the live pages go wrong:

- **The read takes usage only from a row's full feedback list.** The KPI pages never get one. Production gives them the aggregated projection: a last usage entry, a terminal entry and ticket-marker entries, but no feedback. Wired as it is, every lineage on `/kpis` and the workspace KPIs would read as "no usage", and the incomplete rule would misfire. The approved plan said the read serves both row shapes, and piece 1 did not deliver that. This is the cause, and it sits in the read, not in an adapter.
- **The replay feeds shapes production never produces.** It gives the KPI surfaces raw rows with full feedback, because its fake store cannot aggregate. It gives the run page hand-made loops with a status and an anchor, which real loop records do not carry. So the goldens, W6 and W9 measure the wrong thing.
- **Two copies would be added.** The founder lookup would be written a second time for the raw collections. The join of outcome and membership would split in two once its current home is deleted.
- **Both $0 faults sit one layer below the renderers the ticket names.** S12's day zero is made in the data, and the chart also draws it. S13's formatter refuses any figure at or below zero, so a complete $0 cannot render through it.

The standing policy (err larger, set 2026-11-07) applies, and the look shows the larger move pays: without it, the ticket's own gates go green over a public page that prices nothing.

**Sizes weighed.**

- **Just the task:** the three surfaces are wired as written. The replay stays green while production S11/S12 price nothing and S13 shows every step as "not reported".
- **A small tidy:** this also makes the read take both row shapes, so production is priced. But the gates still measure raw rows and hand-made loops, so nothing would catch a regression, and the lookup and join copies remain.
- **Consolidate the decision this task touches (chosen):**
  - the read accepts every row shape the KPI path and the run page produce;
  - one founder lookup, shared by the store and the raw collections;
  - one join of outcome and membership;
  - the replay is driven by production shapes;
  - each $0 is fixed where the zero is made, and the chart is taught that a day can have no figure;
  - the misnamed spend module goes with its last function;
  - the renderers these three surfaces use take the one formatter;
  - the architecture inventory stops naming what is deleted.
- **Rebuild the area:** have the KPI aggregation emit the read's own shape, and retire every dollar formatter. This is bigger than this piece and overlaps piece 3.
- **Wrong work:** no. This is the right next piece, and it is not aimed at a symptom.

**The extra, done first.** Make the replay feed production shapes:

- the KPI surfaces get rows through the real aggregated projection;
- the run page gets loops as the real loop builder makes them.

Then confirm that the goldens still hold at the start commit on those shapes, and add the note-2 assertion in the same step. The note-2 assertion says the cost card's lineage set equals the outcome rate's lineages that have a `taken` member, with nothing in the cost set that is missing from the outcome set.

This step may stop, and say why, if the goldens do not hold on production shapes at the start commit. That would mean the recorded "before" is not what the live pages showed, and the baseline must be agreed again before anything is wired.

**Settled for the builder.**

- **Note 1: apply the incomplete rule on S11.**
  - Why: the parent's done-when says a figure that cannot be fully priced is never shown as complete, and exempting S11 would keep a silent partial on the public page. The ticket allows either choice, the reviewer recommends applying it, and the corpus has the case.
  - Movement: "(d) also reaches S11: a done opencode straddler's component is no longer priced".
- **How to read (b) on S11.** S11 publishes no identifiers, so a moved credit can only show up as the counts and shares it changes: the ticket count, the component union, the lane-landed reconciliation, the per-ticket flags and the priced share. These are (b), or (d) from note 1, and the replay names each one. Any movement that does not trace back to a moved credit or to note 1 is a defect.
- **S13 keeps its loops.** S13's per-step figure stays over the same loops it folds today. The read must not decide membership again on loop records, or steps would move beyond the $0 fix.
- **Corpus gaps to close:**
  - The S12 day axis starts later than the fetch horizon. Add a lineage that has members in that sliver, so S12's population cannot move without being seen.
  - If the follow-up-only restriction is taken for lookup speed, the corpus's follow-up rows must carry their predecessor link, as production rows do. They do not today, so W2 cannot prove that restriction.

**Cuts to the ask:** none. The line "nothing has moved since" is stale, because piece 1 has landed since, but it is information, not a deliverable.

**Open questions:** none. A local MongoDB server is installed on the build host, so the seeded-store timing can be run.

**Who decided:** the standing policy (err larger, set 2026-11-07). No person's size ruling is on the trail, and the parent has no size record.
