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
- **Does a cheap reviewer find what Opus finds?** `harbour/cheap-implementer.md` got two
  cold agreements, one on a second-order finding, and one cold miss on the hardest finding. Run the shadow on PRs where Opus posted Request Changes and report
  whether it names the same blocking finding, on a model other than the implementer's. (Claude,
  2026-09-12)
- **At what ticket size does a cheap implementer save the most?** The same paper found the Opus
  review cost nearly flat between a one-line and a 414-line change. Price implementation and
  review against lines changed over a fleet week. (Claude, 2026-09-12)
- **Are tickets written by close-outs and reviews easier to implement first time?** Seven of
  thirteen bake-off tickets, all filed by earlier close-outs or reviews, passed Opus first
  time with the verb pinned to implementation and no plan round, against 11 of 94 first-time
  plan approvals in `harbour/review-loops.md`. Split a month of implementations by who filed
  the ticket. (Claude, 2026-09-13)
- **Where does a cheap implementer stop being approved?** `harbour/capability-ledger.md`
  edition 1 covers only grounded small tickets. Give DeepSeek V4.1 Flash one page, one thin
  ticket and one ticket over an hour, each named as an experiment on its ticket, and write
  edition 2 from the verdicts. (Claude, 2026-09-13)
- **Can close-out leave Opus when the ledger is empty?** `harbour/cheap-implementer.md` v4
  has one Flash close-out on an empty ledger that merged correctly for $0.001 against an Opus
  control at $3.44. Nine of the bake-off's thirteen ledgers were empty. Run five more with a
  human reading each ledger first, and count merges, Done states and follow-ups filed against
  the review's outside list. (Claude, 2026-09-13)
- **Does a cheap plan ever clear plan-review, and what does the second round cost?**
  `harbour/capability-ledger.md` edition 2 has two Flash plans sent back twice each on the
  class bound, six of seven checks passing on round two, one thread confounded by HEAD moving.
  Run three Flash plans on tickets bounded by one query with nothing landing under them, and
  count rounds against the 88%-once, 35%-twice population. (Claude, 2026-09-13)
- **Does a stepped run let a cheaper model carry a shape it fails single-shot?**
  `harbour/capability-ledger-method.md` treats the stepper as a second axis with no entries.
  Run the same shapes stepped on a model that failed them and record the beats. (Claude,
  2026-09-13)
- **Can the task shape be stamped at dispatch time?** The ledger's shapes are a reading.
  Compute grounding, surface, size and verification shape from the issue and stamp them on
  the dispatch item, so an edition can be built from a query. (Claude, 2026-09-13)
- **Can a reader use a Harbour comment?** `harbour/plain-language.md` measured the shape by
  regex and by one author's hand-read. Run the standard's own test: hand a fresh session one
  comment, ask what happened, who wrote it and what the reader must do, and score it against the
  ticket; the `scripts/eval-*.mjs` harnesses have the shape. (Claude, 2026-09-13)
- **Who is speaking?** Every comment in the tracker carries the operator's name. Sweep a month of
  comments for first-line stage markers ("Close-out", "Ruling from John", "[close-out]") and report
  how many comments a reader could attribute without opening the dispatch. (Claude, 2026-09-13)
- **Does a smaller `CLAUDE.md` actually lower cost per leg?** `harbour/efficiency-levers.md` estimated
  deferring/scoping the `CLAUDE.md` read at $69.80, 5.0% of the capacity day, with one probe cutting a
  leg's cost 23% and its peak window 28%. LIN-2887 shrank both repos' files for real: LinearViewer
  (LIN-2896) 623 → 106 lines, 153,845 → 9,174 bytes; simple-dispatcher (LIN-2897) 698 → 85 lines,
  59,586 → 4,579 bytes. Re-run the same cost-per-leg-kind method now that turn one actually carries the
  smaller file, and compare against the estimate. (Claude, 2026-09-18)
- **Does a lane lose quality against the gated pipeline on the same work?**
  `harbour/ticket-record-and-quality.md` found lane tickets (two comments, ~560 words) with the same
  later-found miss rate as review-gated tickets (7,000+ words), but lanes select small work. Dispatch
  twenty matched small tickets both ways and count later-found misses at thirty days. (Claude,
  2026-09-18)
- **Is the machinery's narration free to drop?** The same paper found autopilot and runner comments
  are 345 of 1,557 comments and 11% of all words on Done tickets, with beat-completion notes another
  10%. Suppress them for a fortnight and re-run the method: if first-pass approval and the miss rate
  hold, they were ceremony. (Claude, 2026-09-18)
- **Which sentences of a review does the close-out consume?** Reviews are 27% of all words, a median
  1,700 each. Read ten against their close-outs and mark the sentences the close-out cites, discharges
  or acts on; the remainder is the review's ceremony share, which `harbour/writing-length.md`'s Next
  asked for across reports. (Claude, 2026-09-18)
- **Why do 46 of 184 Done tickets have no description snapshot?** The archive is written by the
  `brief?noRefresh=1` call at close-out. Read those 46 and say whether the description was never
  rewritten, the close-out skipped the archive step, or the capture failed silently. (Claude,
  2026-09-18)
- **Does a review naming a fault make it more likely to be fixed?** `harbour/what-the-reviews-checked.md`
  found six of thirteen later-found misses were filed by the review that found them, labelled
  `kind:review-residue` or `kind:follow-up`, and four of those are still open a fortnight on. Sweep
  every such Bug in the cohort and compare open rate and waiting time against faults found by a user.
  (Claude, 2026-09-18)
- **Do close-out claims that carry their evidence inline still need a reader?** LIN-2922 already
  targets the existing `retrospective-audit` at close-outs with a non-empty ledger; the broad "dispatch
  a reader over every close-out" form was rejected as ~300× the repair it would prevent
  (`docs/reviews/proposal-red-team-2026-09-18.md`, proposal 6). The untested residual is that review's
  other reformulation: `harbour/what-the-reviews-checked.md`'s two false record claims (LIN-2773,
  LIN-2775) would have shown their own `?teamId=` fault in the evidence had the claim carried the
  literal request and response inline, as the template already does for CI. Require inline literal-call
  evidence on one close-out field for a fortnight, then re-run LIN-2922's audit over both arms and
  compare the false-claim rate. (Claude, 2026-09-18)
- **Does a decision model catch the refusals the regex mislabels in the field?** `harbour/jev-decision-model.md`
  got 7 of 7 on the regex's own fixtures where the regex gets 5. Run Jev as a shadow beside `classifyRefusal`
  in simple-dispatcher's `hook.js` for a fortnight, log both verdicts on every terminal turn, and read every
  disagreement. (Claude, 2026-09-19)
- **Can a yes/no gate lower the false-escalation rate without hiding an answered ruling?** The same paper's
  operator question scored the two contested fixtures 0.90 and 0.66 and the rest under 0.21, with no gold.
  Build the label set the tracker holds, rulings answered against dismissed, ask the question over each task
  as it stood when raised, and report the rate at each threshold. (Claude, 2026-09-19)
- **Is a confident wrong routing answer detectable?** The same paper's two shared misses, LIN-510 and LIN-813,
  came at confidence 0.82 and 0.80 from Jev and as unanimous answers from GPT-5.4-mini. Re-run the routing
  question with the harness's leaf vocabulary and iterated criteria, and test whether the operator question or
  disagreement between the two models flags them. (Claude, 2026-09-19)
