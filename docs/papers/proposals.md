# Proposed papers

One line each: the question, the data that could answer it, who asked. Anyone can add a line.
A line can become a paper or an essay; `standard.md` says which shape fits.

- **With size and area held fixed, do mid-tier changes fail more often than frontier ones?**
  `harbour/why-throughput-halved.md` found that, from 13 July, changes written mainly at the mid tier
  were 67% correct and complete against 78% for the frontier tier, with 9.6% against 2.4% escaping, at
  the same dispatches and working hours per change. Match later-block changes on production size,
  area and ticket kind, and report whether the gap survives or belongs to the tickets each tier was
  given. (Claude, 2026-09-30)
- **Does per-change cost keep its sensitivity out of sample?** `harbour/measuring-throughput.md` found the
  weekly count of correct, complete changes needs about eight weeks each side to see a doubling (four-week
  detectable ratio ×2.4). `harbour/survey-check-2.md` found cost per change is not the ×1.4 the paper
  printed, because changes in one week are not independent: on the observed spread of weekly means it
  sees ×2.8 in dispatches and ×2.0 in hours over four weeks. Re-run `scripts/survey-scorecard.mjs` weekly
  for eight weeks and report whether those detectable ratios hold on new weeks, and whether the weekly
  count and per-change cost ever move in opposite directions. (Claude, 2026-09-30, corrected 2026-09-30)
- **When were the faults that later reviews find actually written?** `harbour/reliability-baseline.md`
  counted 49 escaped Bugs filed as `kind:review-residue`, a later review finding a fault in older
  code, and `harbour/survey-check.md` found at least 21 more with no residue label. In
  LinearViewer they are all of its August–September rise. For each, `git blame` the lines its fix
  changed and date the introducing commit: before the fleet started on 4 June, in its first
  months, or recent. That separates faults the fleet is finding from faults it is making.
  (Claude, 2026-09-30, widened 2026-09-30)
- **What does a follow-up beat buy?** `harbour/growth-atlas.md` found fresh fleet sessions flat at
  about 450–530 a week since mid-July, while follow-up beats into held sessions doubled after
  31 August, from about 800 a week to about 1,600. Sample beats from simple-dispatcher's run logs and
  oplog, and trace each to what it changed: a commit, a ticket state, a comment, or nothing.
  (Claude, 2026-09-30)
- **Why does Harbour's unit suite slow faster than it grows?** `harbour/growth-atlas.md` found one
  CI pass of the unit suite took 8–10× longer from late June to late September while test lines
  grew 4.2×. Time every test file under `node --test` at each month-end commit and report whether a
  few files or the whole suite carry the time. (Claude, 2026-09-30)
- **What does the added supervision buy?** `harbour/where-the-effort-goes.md` found the supervision
  layers rose from 28% to 45% of weighted tokens across September, and `harbour/survey-check.md`
  found the whole rise is the passage Runner and its legs, while dispatches per same-sized ticket
  rose 1.2–1.8×, almost all of it warm beats, and working time held flat. Compare tickets flown
  under a Runner and its legs with tickets run by a lone autopilot, at a fixed size and risk
  class: first-pass review approval, review rounds and later-found defects. (Claude, 2026-09-30)
- **Does effort follow risk at all?** The same paper found no detectable difference between a
  credential or auth change and any other change of its size, on intervals wide enough to hide a
  difference of half either way. Is a risk class ever an input when a ticket's process is chosen,
  and do high-risk tickets' reviews find more? (Claude, 2026-09-30)
- **Can a ticket's effort be compared month on month in one unit?** `harbour/survey-check.md`
  found that a dispatch changed meaning over the summer (mostly fresh sessions in July, mostly
  warm beats into held sessions in September), that the two working-time instruments disagree
  2.5× on the same tickets, and that transcripts and dispatch history age out after 30 days, so
  tokens exist only from 31 August. From simple-dispatcher's oplog and run logs, which reach back
  to 12 July, find a measure that means the same in July as in September, such as executing time
  outside CI and Monitor polls, and redo the size-held-fixed table in it. (Claude, 2026-09-30)

- **Do the tests the mutation check forces ever catch anything?** `harbour/which-rules-pay.md` found
  the mutation check led 107 of 483 review findings in the last 100 reviewed Done tickets, 97 of which
  changed only tests, and about 36 of the 88 extra legs those tickets ran. Follow every test file those
  97 changes touched forward through CI on main and later PRs, and count how often one goes red on a
  real regression before a reviewer or a Bug finds it. (Claude, 2026-09-30)
- **What does reviewer judgement catch that no rule names?** The same paper found that the largest
  single source of production changes from review, 29 changes and 16 real faults, was a reviewer
  reading the code with no specific rule behind the finding. Read those findings for a common kind
  of reading, and ask whether the named rules describe how faults are actually found. (Claude, 2026-09-30)
- **What do the orchestrator's stepper beats keep of the rules?** `harbour/steady-base-check.md`
  found that 41 of 112 sampled worker prompts were beats the frontier-tier orchestrator wrote
  itself, and at least 18 of them wrap an engine brief. For every beat since the stepper shipped,
  diff the beat's text against the engine brief it wraps, if any, and against the rules in
  `harbour/steady-base-rules.json`. Record which rules reach the worker, which are dropped, and
  which the orchestrator adds that no template holds. That says whether the meta-prompt or the
  kickoff is where a rule actually lives. (Claude, 2026-09-30)
- **Does a prompt budget move the growth next door?** `harbour/paid-where-written.md` argues that a
  budget cuts what it caps and moves cost to what it does not count, as the `CLAUDE.md` cap did
  (its text moved into `docs/architecture/`, which grew 21 KB, about a third of it in changes
  that also edited `CLAUDE.md`). The NAO found only that Britain's regulatory target did not see
  what it did not count (`harbour/paid-where-written-check.md`). If `steady-base.md`'s step 1,
  a byte budget on every template and the meta-prompt, is adopted, measure for eight weeks either side the size of every document an agent
  is told to read and the comment lines added to production code. Faster growth after the freeze
  means the budget moved the cost without cutting it. (Claude, 2026-09-30)
- **When Harbour removed a rule, did the incident it was written for come back?**
  `harbour/paid-where-written-check.md` found the essay mentions Chesterton's fence but does not
  answer it: a rule obeyed silently leaves no signature, so a firing record cannot tell an idle
  rule from one that is why an incident stopped. `harbour/steady-base.md` lists eight removals,
  three deliberate cuts and one retirement on firing evidence. For each, find the ticket that
  introduced the removed text and the incident class it named, then search the tracker for that
  class in the eight weeks either side of the removal. (Claude, 2026-09-30)
- **Does calibration transfer between domains?** `harbour/learning-while-the-tools-change.md`
  argues in section 7 that the scarce capability is calibrated distrust, learned from
  consequence and bound to a domain, and its Next names this as what would refute it. Harbour's operators review agent work in more than one
  repository; compare the share of an agent's later-found mistakes their reviews caught in a
  repository they know well against one they know less. (Claude, 2026-09-22)
- **Should `docs/ladder.md` take the essay's three clocks and its step classification?** A
  question for John, not a study. `harbour/learning-while-the-tools-change-check.md` found the
  two documents making the same cohort argument independently, two days apart, without citing
  each other. Version 2 of the essay now starts from the ladder's cohort paragraph; the open
  half is whether the ladder gains the identification argument (why no single survey can
  measure the distribution) and the classification of a skipped step by function. (Claude,
  2026-09-21, narrowed 2026-09-22)
- **Does prior assistant fluency lower an operator's retention on bounded runs inside
  Harbour?** The Microsoft CLI-agent rollout found prior IDE-assistant use raised the odds of
  trying an agent by 49–83% and lowered 14-day retention by 12–15% — a sign a ladder of
  accumulating practices does not predict, which the authors read as substitution (a familiar
  fallback) rather than lost skill. Harbour has first-run and repeat-run records per operator;
  test whether the sign reproduces, and whether operators with a fallback tool to hand show it
  more. (Claude, 2026-09-21, corrected 2026-09-22)
- **Do later entrants reach an accepted outcome with fewer preparatory steps, and does that
  survive maintenance?** `harbour/learning-while-the-tools-change.md` separates engineering
  experience from AI experience from calendar time and says a snapshot cannot tell them apart.
  Harbour records the preparatory steps directly — research, plan and plan-review rounds per
  ticket, already counted by `lib/plan-review-round-trips.js` — so take the tickets worked by
  each operator, compare steps-to-accepted-outcome, then return to the same tickets and count
  later Bugs naming them, the instrument `harbour/what-the-reviews-checked.md` already built.
  (Claude, 2026-09-21)
- **Which kinds of prior knowledge predict lower repair effort?** The same essay argues that
  years of practice say what someone had the chance to learn, not what transfers. Split the
  repair record — later Bugs, review send-backs, close-out corrections — by whether the
  original author knew the product area, the implementation technique, or neither, and report
  which split moves. (Claude, 2026-09-21)
- **Does a practice spread faster through a shared task than through written instructions?**
  The essay's reciprocal-learning claim (section 5, from Barley) is a proposed practice with no
  evidence behind it in Harbour. The prompt templates are the written-instruction arm and are
  dated; a co-worked session is the other. Compare how quickly a rule added to a template
  shows up in sessions against one demonstrated in a shared session. (Claude, 2026-09-21)

- **Which retained artifact reduces the total cost of later work at comparable quality?**
  `harbour/what-should-an-agent-leave-behind.md` and its checking paper separate retained
  material, visible consumption and downstream benefit. Use existing LIN-2689 to compare
  the same caller with source tools, with a deterministic index, and with index plus
  generated explanations on unseen tasks; count construction, retrieval, verification,
  failed attempts and upkeep. Freeze acceptance criteria before construction; have a
  separate checker adjudicate outcomes without seeing the experimental arm, and report
  disagreements and human intervention separately. (Codex and Codex reviewer, from
  John Kershaw's research question, LIN-2961, 2026-09-20)

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
  expansion by kind, and the never-worked share, before and after this change. **Extended by
  LIN-3006** (the kind-not-list amendment): pair the count with (a) a hand-classified same-kind
  share, defined against the source ticket's own recorded class bounds; (b) explicit drops per
  close-out, with sampled drop reasons checked against the materiality bar; (c) the share of
  filings that cite no source ticket. `scripts/follow-on-ratio.mjs` is fine for a change-log
  row's direction column only — it undercounts by design and is not this re-read's instrument.
  (Claude, 2026-09-12; extended 2026-09-24)
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
- **What does a close-out write that nothing later cites?** `harbour/review-consumption.md` found
  close-outs consume 48% of a review's sentences and only a quarter of its check narration. Run the
  mirror: read ten close-outs against every later comment, ticket and paper that mentions them, and
  report the share nothing reads. (Claude, 2026-09-18)
- **Is the check narration free to drop?** The same paper found method and check narration is 45% of
  a review's sentences and 65% of the part no consumer reads. Cut reviews to ledger, findings, verdict
  and a one-line CI statement for a fortnight, then re-run `harbour/ticket-record-and-quality.md`'s
  method and compare first-pass approval and the later-found miss rate. (Claude, 2026-09-18)
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
- **Should the standard require a disconfirming section of every paper?**
  `harbour/developer-adoption-ladder.md` carries a mandatory "strongest disconfirming source" section
  because its ticket demanded one, which makes it the only paper with six body parts against
  `standard.md`'s five. Read the fifteen earlier papers and say which of them had a disconfirming
  source available that the author did not reach for; if the answer is most of them, the standard
  should change rather than the ticket. (Claude, 2026-09-19)
- **Where is rung 3, and can anyone measure it?** The same paper found no dated survey with a
  denominator asking whether developers save or reuse their prompts — the one rung `docs/ladder.md`
  puts the majority on, and the one `docs/north-star.md` positions the product at. Edition 2 should
  read arXiv 2406.17325 in full (read at abstract only in edition 1), and either find the
  measurement or design the question Harbour asks its own users. (Claude, 2026-09-19)
- **Which rung does a new Harbour user's first successful action land on?** `harbour/where-harbour-joins.md`
  found the ceiling frontier has stood at rung 4 since September 2025 while rung 3 — where the product
  is positioned — has no population figure at any of four dated snapshots, across three papers and
  roughly forty searches. Read tracker movement and the date of a new user's first evidence-verified
  merge against `docs/ladder.md`'s rung table, and report the entry-rung distribution against the
  paper's cohort-skipping reading. (Claude, 2026-09-19)
- **Does permission mode change how much a developer supervises, once Harbour can measure it?**
  `harbour/what-lowers-the-verification-cost.md` found no published study shows a verified
  artifact changes supervision, and that Harbour cannot run its own version of that measurement:
  permission mode is a hardcoded constant with zero variance or storage, and supervision time is
  not recorded (only `humanContinued`, a boolean per session). Build a `permissionMode` field
  (stored and forwarded, the same shape as `harness`/`effort`) and a real supervision-time record,
  then regress the two once permission mode actually varies. (Claude, 2026-09-19)
- **Can a hosted managed-agent sandbox push a branch, open a PR and read CI?** `harbour/runner-for-strangers.md`
  found a third execution path the runner milestone never listed — `simple-dispatcher/docs/remote-execution-epic.md`,
  ticketed only as LIN-1590 — whose own §2.1 says this capability check belongs ahead of any executor code and
  has never been run against a vendor. It is the single piece of evidence that would most change that paper's
  recommendation, and it is a day of research rather than a build. (Claude, 2026-09-19)
- **Does a human reader of a finished run behave like `review-consumption.md`'s machine reader?**
  `harbour/what-a-run-must-show.md` found the only reader of a Harbour evidence artifact ever
  measured is a machine, reading 97% of the ledger and 25% of the narration around it. Apply the
  same method to the first invited runs of a finished-run page: record which sections a real
  person opens, how long they stay, and whether they reach the ledger before clicking merge, and
  report the share nothing reads. (Claude, 2026-09-19)
- **Which of a supervisor's gate replies and quiet wakes could the runner already have answered?**
  `harbour/what-supervisors-do.md` found 24% of September's supervision tokens go to answering the
  completion gate (20% to PENDING-EXTERNAL replies), and 31% of wakes change nothing — while the runner
  holds each parent's live subscribed children (`reapers.js:1009`) only to exempt it from reaping. Replay the September gate replies
  and quiet wake cycles against the runner's own state at that moment, and count how many a reader of
  that state would have written identically. (Claude, 2026-09-30)
- **Which of Harbour's pin-class tests have never failed, for any reason, since they were written?**
  `harbour/test-estate.md` found the 851 text pins, census pins and source scans failed a PR's CI
  twice in four months, while inside sessions census and text pins demanded a bump at least as often
  as they caught a fault, on one or two catches a class (`harbour/survey-check-2.md`). Join each pin's age to every CI and session failure record to separate
  the pins that bump often from the ones that never fire, and say how much of the pin family each
  group is. (Claude, 2026-09-30)
- **Which of the scorecard's named fixes are fixes, and which follow-ups are the change's own?**
  `harbour/survey-check-2.md` found `scripts/survey-scorecard.mjs`'s correct and complete tests rest on text
  matches: 69 of its 78 named fixes are a mention of the change anywhere in a later ticket's description,
  35 of 66 escapes name the ticket whose review found the fault, and 116 mature changes are named as origin
  in filings the scorecard ignores. Read the 78 fixes and the 116 filings blind, against a written rubric,
  and report the correct and complete rates as estimates with intervals rather than bounds.
  (Claude, 2026-09-30)
- **Is the reduced-motion livebar test's first-attempt failure the product or the harness?**
  `harbour/browser-flakes.md` found `observation.spec.js:401` failing its first attempt in 71% of
  sampled green runs and passing on the traced retry, a rate that fell from about 90% in July to 44%
  in late September. Run it alone at origin/main, repeated, with and without tracing and with a wait
  on the computed style, and report which condition makes the first attempt fail. It is the one test
  where retries could be hiding a real reduced-motion fault. (Claude, 2026-09-30)
