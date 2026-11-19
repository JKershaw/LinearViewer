# Ticket draft: trail facts read quotes as the ticket's own

*Drafted 19 Nov from the LIN-4493 finding (`checks/lin-4493-skip.md`) and its RCA (`checks/lin-4493-rca.md`). A standalone task, not under LIN-4490; launched on its own.*

**Title:** A ticket's trail facts count only what its own comments report, not what they quote

**Repository:** JKershaw/LinearViewer (Harbour).

**What this is for.** On 19 Nov, LIN-4493 (a fresh piece of the layer slice) went straight to implementation, skipping its two surveys and scoping. An hour earlier, its sibling LIN-4492's close-out had left a note on LIN-4493 that quoted LIN-4492's PR link. Harbour reads any PR link in any comment as the ticket having its own PR, so the look-first steps stood aside and the selector picked implementation. The same note was also read as LIN-4493's own close-out, because its heading contains "close-out".

The rule came in two halves. Collecting every comment's PR links began on 5 Oct (LIN-3300) as a line for the selector's model to weigh. On 8 Nov, LIN-4370 made it a code gate for look-first without asking whose PR a link is. The same facts also feed the selector, the landing PRs (blind read, close-out guard, run page) and "work after review", so a quoted link misleads those too.

**What we want.** Facts that steer Harbour's routing come from what this ticket's own comments report as their own work, never from what they mention or quote: another ticket's PR link, or a heading that names a stage. A note from a sibling or parent stays readable context; it just doesn't count as this ticket's history. The RCA lists four more readings of the same kind (a comment opening "Plan…", a quoted ruling, an unheaded agent note read as a person's, a cross-ticket review heading); check each and settle those that share the cause.

**Done when**
- a fresh ticket with a note quoting another ticket's PR still gets its surveys and scoping, with the 19 Nov case (LIN-4493's 13:37 comment) as a test;
- that note is not read as the ticket's own close-out, and its PR is not one of the ticket's landing PRs;
- a ticket's own PR, review and close-out read exactly as today.

**Where to read:** `docs/plans/survey/integration/checks/lin-4493-skip.md` and `lin-4493-rca.md` on branch `claude/cool-rubin-6acj5j` (commit below).

**Every change names what it retires. Questions:** settle engineering questions yourself; only John's calls (product, money, authority, what to retire) go to him as rulings.
