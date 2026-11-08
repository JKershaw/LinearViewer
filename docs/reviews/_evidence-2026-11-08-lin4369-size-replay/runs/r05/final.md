I've written the scope for LIN-4178. The recommended size is "consolidate the decision this task touches", set by the standing policy. Three cuts to the ask still need your ruling, so the ticket is blocked on that.

**What the code shows** (I ran it on the fixture corpus; the clone is unchanged):
- **The cost read prices nothing on the rows the KPI pages actually get.** The shared cost read added in piece 1 only looks for usage in a row's full feedback list. The KPI rows carry just the last usage entry and no feedback list, so all 18 hand-built lineages read "no usage". The parent plan said the read would accept both row shapes; piece 1 didn't do that. Done now includes fixing that in the read itself.
- **The saved "before" for the public cost card (S11) is not today's `/kpis`.** It was recorded over the whole corpus with no 30-day fetch, so it leaves out every lineage that started more than 30 days ago (the true-start counting the plan rejected). Today's production fetch gives 11 priced tickets, $79.88 and an unknown-harness share of 0.824; the saved before says 9, $74.28 and 0.857. Done now means recording S11's before again at the baseline commit through the production fetch. Matching the old one would quietly drop those lineages from `/kpis`.
- **Crediting the straddler to its founder's issue (change b) doesn't move any published S11 number on the corpus.** So the credit has to be proven by a test-side list of the lineages whose issue moves.
- **The run page (S13) won't work as wired.** Real loop records have no dispatch status, so the read would find no members in them. Its formatter also blanks any figure of $0 or less.
- **The workspace KPIs' $0.00 for an all-unpriced day (S12) is made in the data, not the renderer.** It feeds the chart too, so a renderer-only fix still draws a zero bar.
- **The review's note-2 check holds today.** The cost card and the outcome rate count the same lineages.
- **The founder-lookup timing can be done.** `mongod` is installed on this machine.

**Settled in the scope:**
- S11 and S12 keep today's population rules exactly. S12 still buckets by the earliest fetched member's day; fixture lineage P shows why that matters (another reading would add $7 to today's bar).
- Note 1 is applied: the incomplete rule now covers S11, and the move is named as a (d) change on S11.
- The extra piece, done first: one founder-identity read and one outcome join, shared by both paths. It may stop and leave the store path alone if sharing would move any piece-1 replay line.

**Cuts that need your ruling:**
- **"S1 = S13's group figures"** would hold only for lineages both pages read in full. In the opencode-straddler fixture, the issue cost page (S1) shows the lineage as incomplete while the run page prices it at $1.10 from all its loops.
- **S11's "equals the golden" (W2/W6)** would be judged against the re-recorded before, not the committed one.
- **Change (b)** would also allow the priced-ticket count, the per-ticket shares and lane-landed tickets to move, as long as each is listed and comes only from the moved issue.

Files are in `/Users/autopilot/development/simple-dispatcher-workspaces/2e356360-bd5f-4ab6-aa6b-8c241216f56e/scratch-replay/runs/r05/output/`:
- `description.md`
- `comment.md`
- `tracker-actions.md` (status to In Progress, and a comment for the parent LIN-4176)
- `final.md`

DECISION: {"decision_id":"lin4178-scope-cuts","question":"LIN-4178 needs three cuts to the ask: (1) 'S1 = S13 group figures' holds only for lineages both pages read in full, and the opencode straddler is listed with its reason; (2) S11's 'equals the golden' is judged against S11's before, recorded again at 9e397e6b through the production 30-day fetch, because the committed golden left out every straddler; (3) change (b) also allows the priced-ticket count, per-ticket shares and lane-landed tickets to move, when each is listed and comes only from the moved issue. Agree?","options":[{"id":"agree_all","label":"Agree all three cuts"},{"id":"agree_1_2_keep_b_literal","label":"Agree 1 and 2; (b) stays credits-only, and the builder stops if any other public figure moves"},{"id":"discuss","label":"Hold: discuss before building"}],"recommended":"agree_all"}
BLOCKED: need a ruling on the three cuts to LIN-4178's ask (W4 S1=S13 qualified, S11's before recorded again through the production fetch, (b) widened to listed consequences of the issue move)
