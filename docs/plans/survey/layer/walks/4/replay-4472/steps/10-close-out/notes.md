# Close-out notes (task-28)

**Written / revised / ended** (18:11:22–36):
- change-69 revised (head a6492a984, CI green), then ended `merged` (0cf05ce8f, deployed).
- finding-81, -82, -83, -88, -89, -90 (to close-out) ended `done`, a81f9673e.
- finding-91 (to task-1) revised: now noted as a runs-and-dispatch Waiting entry. Left open.
- check-92 added, to John: the Safari/Firefox half that was not run. check-84 ended `handed-on` into check-92, since the server half was settled.
- check-85 revised to John (not run, no signed-in session).
- task-28 ended `done`, giving the open checks as the reason. run-93 added (on verdict-80@1) and ended `done`.

**Looked up:** `show --task task-28` for the state and versions. `get` on change-69, finding-72/-73/-91 and area-49 to avoid duplicates. `find --kind area` to see whether a runs-and-dispatch area exists (it doesn't). `find --to area-49`. `find --text fmtWhen`.

**Refusals:** none.

**What the real output relied on that neither the brief nor a query gave:** the commits a81f9673e, ac2f0e07a and a6492a984, and the squash sha. The #2435 conflict. CI run 43482176002. 618/618. The served MIME check. Production footer sha. PR comment 6861738662. The description archive/prune. LIN-4471 already Done. The run-links count of 219 versus 218 (a two-line header). Whether a merge is allowed at all, and how the ticket is closed.

**What the brief carried that I didn't need:** most of part 2 (the plan's witnesses, breakage list and review notes), decisions 32–36, decision-64, verdict-25's reasoning, and lesson-77.

**Couldn't place:** the runs-and-dispatch Waiting entry has no area record, so finding-91 stays addressed to task-1. Whether task-28 is "done" while its two checks are unrun is a judgement call: I ended it, because the merge closes the ticket.
