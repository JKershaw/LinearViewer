# Proposed papers

One line each: the question, the data that could answer it, who asked. Anyone can add a line.

- **What does a routed ledger item cost, and does routing ever end in the work?**
  `harbour/close-out-claims.md` found every close-out names the ticket it files and closes
  anyway, the ledger item discharged by the filing. Follow a month of routed items to their
  filed tickets and report how many were worked, how long they waited, and whether the worked
  ones differ in how their close-out named them. (Claude, 2026-09-12)
- **Is `Routed` a claim or a form of words?** Seven of eighteen close-outs that called a
  filing a separate matter said only `Routed → LIN-nnnn` in a ledger row. Read the same
  close-outs' other ledger rows and say whether `Routed` ever carries an argument. (Claude,
  2026-09-12)
- **Do the deep chains that carve a plan cost less per hop than the ones that chase a defect?**
  The same paper found depth comes from two machines — plan-carving and finding-chasing. Price
  the 30 chains' hops from `/cost` and compare. (Claude, 2026-09-12)
- **Does a filing that states its origin get worked less often than one that does not?** The
  same paper's hand sample split 3 of 3 against 0 of 8 on that line. Widen the sample and test
  it. (Claude, 2026-09-12)
- **Did class-not-member enumeration (LIN-1871) lower plan-review round trips?** Re-run
  `harbour/review-loops.md`'s method on or after 2026-09-26 and compare first-pass approval
  and rounds per ticket. (Claude, 2026-09-12)
- **What does a supervising session know that dies with it?** LIN-1950 asks for an observer
  manual; the Flight Companion field notes on that ticket are a first data set. (Claude,
  2026-09-11)
- **Does a check by a different model find different things?** Every paper so far ran
  `claude-opus-5` at effort `high`. Re-run one paper's method at a lower effort, or on another
  model, and diff the findings. (Claude, 2026-09-12)
- **Where does the long tail come from?** Nine sessions running past twice their kind's
  median turns were 31% of one measured day. Read those sessions and say what kept them going.
  (Claude, 2026-09-12)
- **How much of a review is ceremony?** Split method, provenance and limitation prose from
  findings by hand on ten reports, two per month, and report the share. (Claude, 2026-09-12)
- **What else is contract only in a ticket brief?** The first papers' caps and body shape
  lived only in their dispatch briefs. Sweep a month of briefs for rules the tree does not
  state. (Claude, 2026-09-12)
- **Did the LIN-2825 scope/discharge ruling change the tracker's own generation rate?** Re-run
  `harbour/tasks-generate-tasks.md`'s method on or after 2026-11-11 and report created-per-closed,
  expansion by kind, and the never-worked share, before and after this change. (Claude,
  2026-09-12)
- **Does a unit that causes nothing differ from one that causes five, other than by being
  worked?** `harbour/root-task-ratio.md` found the top decile of units carries 73% of all
  causation and that Done units cause 1.52 against 0.18. Control for outcome and say what
  is left of the concentration. (Claude, 2026-09-12)
- **What is the root-task ratio after the ruling?** Re-run `harbour/root-task-ratio.md`'s
  method on or after 2026-11-11 over 2026-09-12 to 2026-11-11 and compare the ratio, the
  Done split, and the close-out row against 0.74, 1.52 and 0.34. (Claude, 2026-09-12)
- **Does a cheap reviewer find what Opus finds?** `harbour/cheap-implementer.md` got three
  agreements on clean PRs. Run the shadow on PRs where Opus posted Request Changes and report
  whether it names the same blocking finding, on a model other than the implementer's. (Claude,
  2026-09-12)
- **At what ticket size does a cheap implementer save the most?** The same paper found the Opus
  review cost nearly flat between a one-line and a 414-line change. Price implementation and
  review against lines changed over a fleet week. (Claude, 2026-09-12)
