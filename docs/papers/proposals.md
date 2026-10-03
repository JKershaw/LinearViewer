# Proposed papers

One line each: the question, the data that could answer it, who asked. Anyone can add a line.
A line can become a paper or an essay; `standard.md` says which shape fits.

- **Does the engine's rewrite of a template change what review catches?** `harbour/prompt-kinds.md` found that the
  recommender writes each worker prompt itself, its own text 25–68% of the handwritten template's. The code-appended gates
  survive, but the review template's regression step (`git log` over the changed files) is in about 1% of written reviews,
  and the instruction to write or read the `### Plan Review Verdict` header the tree routes on is in 70% of written
  plan-reviews and 36% of written plans, against every template (`survey-check-13.md`). A per-step fixture eval answers it:
  the same frozen tickets run with the written body and with the template body, three runs per arm (the menu's M33),
  scored on faults found, verdict headers written and weighted tokens. (Claude, 2026-10-01; narrowed by survey-check-13)
- **Do the steady-base menu's cost factors overlap as its stack arithmetic assumes?**
  `harbour/steady-base-menu.md` multiplied savings across four factors (mechanical supervision, legs that need not run,
  tokens per session, which changes get the full process) on the assumption that each later factor's share is spread
  evenly over what the earlier one leaves. `harbour/survey-check-12.md` measured the tracker part by session kind: 58%
  of the fleet's tracker tokens sit in supervisor sessions, which are 37% of the budget, and version 2's stacks
  (×1.57–2.38 for the whole menu) assume the conductor removes chores in proportion to the supervisor tokens it removes.
  What remains is the step-level split: on the September transcripts, mark each mechanical supervision step with the
  bootstrap, tracker and orientation tokens it carried, and report what share of `starting-context.md`'s orientation
  and `replay-small-work.md`'s chores sits inside `what-supervisors-do.md`'s 27%, and how far lighter legs and the
  bootstrap overlap. (Claude, 2026-10-01; narrowed by survey-check-12)
- **Is a lean lane on small, low-risk tickets as correct as the full process when nobody has written the answer
  into the description?** `harbour/survey-check-11.md` found that two of the three faults the lean replay shared with the
  full process were prescribed or named in the final descriptions it read, and that four tickets replayed from the
  pre-implementation text moved two blind verdicts from better to worse. A forward trial answers it: route new M3-light
  tickets, by a path check in code, to one implementer, one review and one close-out in the fleet's own harness, from the
  description as filed, with PR, CI and tracker chores included; count escapes and named fixes at 30 days against the
  light group's 2.0 in 100, and weighted tokens per correct change (about 400 changes to see a doubling). (Claude, 2026-10-01)
- **What were September's 19 other Linear-auth bursts that reached three or more sessions within an
  hour — LIN-3181's dead credential re-selected earlier, or other faults?** `harbour/what-hides-between-sessions.md`
  found 21 such `LINEAR_AUTH` bursts in September's transcripts, two of them on record (LIN-2473, LIN-3181), the
  largest 62 sessions over 7.6 hours on 24–25 September, most of their errors healed by a retry inside the
  session that saw them. Join
  each burst to the server's credential-selection and provider-lane records, now kept for the project's
  lifetime (LIN-3157), and say for each which credential was selected and why it was rejected. (Claude, 2026-10-01)
- **If a shared-error and wait-graph detector ran live for four weeks, outside the dispatcher, how many of its
  alarms would a person or Flight Companion act on, and would the median time from onset to discovery fall from
  about 15 hours?** The same paper ran both rules over September after the fact: 7 of 19 incidents on record
  caught a median 5 hours early, 63 alarms on no ticket, of which a hand-checked sample found about half real
  (`survey-check-10.md`). A shadow run that only logs alarms,
  read weekly against the tracker, measures agreement and lead without changing any session.
  (Claude, 2026-10-01)
- **What found the faults that both the full process and a lean replay shipped, and could any check before
  merge have found them?** `harbour/replay-small-work.md` replayed thirteen small tickets lean. On three
  known faults (LIN-2355's preamble hints, LIN-2414's dropped follow-up, LIN-2980's stream-aborting
  dereference), the replay's review approved the same fault the full process had shipped. For each, trace
  the escape or fix back to what found it (a test, a sweep, a reviewer prompt, use) and say whether any
  check that runs before merge would have caught it, and at what cost. (Claude, 2026-10-01)
- **Does the scorecard's weighted unit hide September's change of frontier price row?** `harbour/survey-check-10.md`
  found that the weighted unit charges both frontier price rows at 1, while per weighted token the newer row costs about
  0.55 of the older one at list rates, and the fleet moved to it in the week of 22 September; the gap
  `harbour/prototype-concepts.md` v1 read as fresh sessions costing more per weighted token was this change. Re-price
  September's cost per correct change by week at each session's own row, and say how much of any fall after 22 September
  the weighted series credits to the process when it was the price. (Claude, 2026-10-01)
- **Does a check run before a Harbour paper merges find what the post-merge checks found?** `harbour/prototype-concepts.md`
  found that 23 of 24 checked documents had a claim corrected after merge (about 20 a load-bearing one, by the checks'
  own word; `survey-check-10.md`), while Lighthouse checks before release. Run the next wave's checks on the paper's branch and compare what they find, and how long a wrong figure
  stood in the anchor, with the post-merge record. (Claude, 2026-10-01)
- **Why do two censuses of the same runner logs give 47.1 and 33.6 dispatches per correct change for
  code changes merged 14–28 September, by the child named?** `harbour/survey-check-9.md` found that
  `what-doubled-the-dispatches.md` v2 gives 47.1 by the child named and 36.3 by the session entered
  (a 30% gap), and `how-process-changes-land.md`'s census 33.6 and 29.2 (15%), from the same runner
  logs. The anchor's open question on the charging rule needs one census before it needs one rule.
  Join the two censuses item by item for that fortnight and name every item one counts and the
  other does not, by code-change definition, session-ticket rule and window edge. (Claude, 2026-10-01)
- **Did LIN-2323's adversarial second read of periodical reports ever disagree with a report, and should its
  own sunset have retired it?** `harbour/how-process-changes-land.md` found it the only added process step since
  June that was given a retirement condition ("if after ~1 month of operation the disagreement rate is near zero
  … this step should be retired"), due about 26 September, with no read on record. Count the second reads since
  26 August, how many disagreed and what each disagreement changed, and say whether the condition was met.
  (Claude, 2026-10-01)
- **When a child of an approved plan runs its own plan, what does that plan change?**
  `harbour/step-overlap.md` found that 32 of 65 implemented children of a parent with its own plan or
  breakdown ran their own plan session and 23 their own plan review, 3.9% of all tokens on disk, and that
  none of 24 sampled children carried the breakdown's inherited "plan-review due: no" line. For each,
  set the child's plan against the parent's slice and say whether it changed substance, and whether its
  plan review found something real. (Claude, 2026-10-01)
- **What does plan review's re-verification find that a re-run of the plan's own query would not?**
  `harbour/step-overlap.md` found that 27–35% of plan-review units re-establish a fact the plan or research
  already stated, while none of the 30 real finds of repeat plan-review rounds was in the research. For the re-verified
  units, say how often the re-derivation turned up a finding and how often it confirmed the claim and
  found nothing. (Claude, 2026-10-01)
- **Does a first-round plan review find what the research did not?** `harbour/survey-check-8.md` found that
  step-overlap's 30 plan-review finds, none of which the research had named, all came from repeat rounds (round 2 or
  later) and were selected as new against the earlier rounds. Code a systematic sample of first-round plan-review
  finds against the research and plan written before them, with step-overlap's value rubric unchanged, and say how
  many the research had already named. That tests whether plan review's re-derivation duplicates research on the pass
  where the two overlap most. (Claude, 2026-10-01)
- **How many steps does a fresh session take to reach the decision a held supervisor's wake made?**
  `harbour/held-or-fresh.md` re-priced September's acted wakes as fresh sessions on the assumption that
  a fresh step takes the steps the held wake took; the relay's result turns on that and on the handoff
  (break-even at 21k tokens if the step orients as fresh starts do today, 100k if it reads only the
  handoff; version 2). Replay a sample of acted wakes as fresh sessions in a sandbox, from the record and a short
  handoff, and report steps, tokens and whether the decision matches the held one. (Claude, 2026-10-01)
- **Does a session handed the plan's named paths reach its first edit with fewer tokens, at the same correctness?**
  `harbour/starting-context.md` found implementation orients for 1–18% of its tokens (24 calls to the first edit at the median) and
  that the plan's named paths, resolved to files, find half of what the implementer edits at 55% precision (53% at 61% on a first round). Over a week, put the
  resolved paths at the top of every second implementation prompt; compare tokens and calls to first edit, tokens per correct change
  and the review's findings with the other half. LIN-2115's single-task probe (93 tokens, 18 turns against 51) is the only direct
  test so far. (Claude, 2026-10-01)
- **When a code review re-reads what the implementer read, is it checking independently or just re-finding?**
  `harbour/starting-context.md` found 82% of a code review's orientation reads repeat an earlier session's on the ticket (67% of the repo files it opens). Code a
  sample of review orientation spans for whether the reviewer looked beyond the implementer's files and whether that found
  anything, so a pointer hand-over can be judged against the independence it might cost. (Claude, 2026-10-01)
- **Which deliveries into a held supervisor can code tell are quiet before a model reads them?**
  `harbour/survey-check-7.md` found that routing by delivery class (pause wakes, failsafe re-confirms,
  silence re-fires, the Runner's deliveries) reaches 2,295 of September's 3,233 quiet wakes, 11.7% of
  fleet tokens, and holds back 219 that acted; the other 938 quiet wakes, 4.5% of tokens, are terminal
  and unlabelled deliveries indistinguishable by class from the ones that act. Read a sample of each
  group's delivered text and the state code could see at that moment (the child's outcome line, the
  parent's live children, the item's kind), and say which fields would have separated them, and at what
  error. (Claude, 2026-10-01)
- **Which leg kinds share a name length, and which published counts did the length decode misread?**
  `harbour/survey-check-6.md` found that the bootstrap-length decode reads breakdown (and look-into)
  sessions as close-outs and custom, design and triage sessions as reviews: in September's transcript
  headers, 16 of 81 decoded close-outs and 17 of 146 decoded reviews were other kinds. List every kind
  the dispatcher has sent since June with its length, set each decoded leg in the censuses of
  `what-doubled-the-dispatches.md`, `survey-check-4.md` and `why-legs-repeat.md` against the kinds that
  share it, and report which published counts move and by how much. (Claude, 2026-09-30)
- **Does a second plan-review round find what the first missed, or what the revision introduced?**
  `harbour/why-legs-repeat.md` found that 37 of 41 sampled plan-review repeats raised a finding no
  earlier round had, and 30 of those were real (version 2). For each, read revision 1 against the finding and say
  whether it was already there to be seen or came in with the change the first round asked for, by
  ticket size, so a missed finding can be told from one the loop itself created. (Claude, 2026-09-30)
- **With size and area held fixed, do mid-tier changes fail more often than frontier ones?**
  `harbour/why-throughput-halved.md` found that, from 13 July, changes written mainly at the mid tier
  were 67% correct and complete against 78% for the frontier tier, with 14 of 365 against none of 171
  escaping once rows naming the finder are set aside (version 2), at the same dispatches and working
  hours per change. `harbour/model-choice.md` held size and area fixed and the gap stayed. Match
  later-block changes on ticket kind as well, and report whether the gap survives or belongs to the tickets each tier was
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

- **Can the lead rule of a review finding be coded reliably?** `harbour/survey-check-3.md` found that
  two blind readers named `harbour/which-rules-pay.md`'s lead rule for 59–66% of its production changes
  and each other's for 78%, while agreeing on the counts. The class check and reviewer judgement trade
  places most. Write decision rules that separate "a rule pointed the reviewer here" from "the reviewer
  saw it", for example that the review text uses the rule's own words. Recode the paper's 28 production
  tickets under them with two blind readers and report κ. (Claude, 2026-09-30)
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
- **What does an escaped defect cost the operator, by implementer tier?** `harbour/model-choice.md`
  found that mid-tier changes escape more often than frontier ones (11 of 187 against none of 85),
  but that the rework adds only 0.2–0.3 working hours to a correct change's whole-life cost of 3.25–3.5 hours for either
  tier. Hours leave out the person who finds, triages and re-dispatches each escape. Join
  `reliability-baseline-defects.json`'s finder to the tracker's comment and state history, and
  say how much operator attention each escape took, by the tier that wrote the change.
  (Claude, 2026-09-30)
- **Once the 25 September switch to cheap implementers has had 30 days, what does a correct change
  cost over its whole life?** `harbour/model-choice.md` could not price the cheap tier, because its
  changes are younger than the 30-day window. Re-run `scripts/survey-model-analyse.mjs` in late
  October and report the cheap tier's whole-life hours, escapes and afterlife curve beside the two
  tiers measured here. (Claude, 2026-09-30)
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
  in late September. `harbour/survey-check-5.md` found every failure read an empty `animationName`,
  which is what a detached element reports, so the feed poll may be replacing the node before the
  read. Run it alone at origin/main, repeated, with and without tracing and with and without the feed
  poll, and report which condition makes the first attempt fail. It is the one test
  where retries could be hiding a real reduced-motion fault. (Claude, 2026-09-30)
- **How many of the wakes a worker event sends up the stack change what any supervisor does?**
  `harbour/what-doubled-the-dispatches.md` found wakes are most of the rise in dispatches per correct
  change since July, that each worker session or beat sent 0.8–0.9 wakes up in July and August and
  1.4 after the passage layer went live (`harbour/survey-check-4.md`: 2.2 counted by the child each wake names),
  and that PENDING-EXTERNAL pauses track wakes one for one.
  For September's wakes, trace each one to the layer it woke (stepper, ticket autopilot, leg, Runner)
  and say, per layer, how often the woken session's next action differs from what it would have done
  had the wake gone only to the lowest layer. (Claude, 2026-09-30)
- **After the same reading, how many of the heavy group's scorecard failures survive?**
  `harbour/proportional-process-backtest.md` read every scorecard failure in its light groups: 11 of M3's
  became 5, and 24 of M4's became 12. It could not read the heavy group's 89 to 100. Read them against the
  same finder-row and blames/unclear/mention rubric, so a light group's failure rate can be set against the
  heavy group's on the same footing, with intervals. (Claude, 2026-09-30)
- **Should a change's cost include the wakes into the epics and the Runner above it?**
  `harbour/survey-check-4.md` found that from 13 September a wake names the child that triggered it
  (LIN-2121), so a count by the log's `Issue:` line charges wakes into epics' autopilots and the Runner
  to the child change: late September is 47 dispatches per correct change that way and 36 charged to
  the session each wake entered, while the fleet-wide count reached 82 in the week of 21 September.
  Trace September's wakes into epics' and the Runner's sessions to the child that triggered each, and
  report what share of each change's supervision sits above it, by ticket kind, so the scorecard and
  the steady-base map can use one rule. (Claude, 2026-09-30)
- **Which wake edges were declared `everything` because a layer wanted progress, and which inherited
  it?** `harbour/wake-inventory.md` found that the relayed re-arms on the coordinator→child autopilot and
  Runner→leg edges are 92–95% quiet (version 2), and that both edges carry the stepper's `everything` level. Read the
  commits and tickets that introduced each prompt line setting it (`lib/prompts/autopilot-kickoff.js`,
  `docs/autopilot-operating-manual.md`, `docs/passage-runner-prompt.md`) and say, per edge, what the
  stated reason was. A question for John as much as for the record. (Claude, 2026-09-30)
- **How many browser specs hold a route whose URL has since changed?** `harbour/survey-check-5.md`
  found `prompts.spec.js` holding `**/api/recommend/<id>/stream` while the client has fetched
  `…/stream?source=…` since LIN-1910 (13 August), so the hold never engages and the test passes only
  when the real stream is slow; its three CI-red flakes began ten days later. List every `page.route`
  glob in `tests/e2e/` and match it against the URLs the client builds at origin/main; report the
  holds that never engage and whether each spec has flaked or retried in green runs. (Claude, 2026-09-30)
- **Can a signal visible before review tell the fleet-machinery changes whose review catches a real
  fault from those whose review catches nothing?** `harbour/cost-mix.md` found that fleet machinery
  (proxy, dispatch, prompts, wakes) took a quarter of September's weighted tokens and carries about
  half of review's real catches and half of the named escapes, so how cheap it can safely be sets
  the bound on correct work per budget. Take every fleet-machinery change in `which-rules-pay-codes.json`
  and the 1-in-8 blockers sample, mark which had a real fault caught, and test size, paths touched,
  a new endpoint or wake path, and a cross-repo contract as predictors, with intervals.
  (Claude, 2026-10-01)
- **How many weighted tokens is one point of the weekly meter today?** `harbour/cost-mix.md`
  converted with the single calibration of 14 August (`lib/weekly-budget.js`), which puts September's
  fleet at 0.89–1.06 weekly allowances a week, or 0.82–0.97 with the mid tier at its list ratio
  (`harbour/survey-check-9.md`); the range is the pricing-table correction alone. Two
  dated meter readings a few hours apart, set against the transcripts' weighted tokens for the same
  span, would pin the constant and show whether the meter counts cache reads as list prices do.
  (Claude, 2026-10-01)
- **Would a mid- or cheap-tier close-out make the same holds and filings as a frontier one?**
  `harbour/where-judgement-happens.md` found 17 of close-out's 23 consequential decisions on 36
  sampled September changes were calls a stated rule or a cheaper step could have made (holding on an
  undischarged ledger item, filing an out-of-scope item), against 6 that needed context; cheap-tier
  close-outs already made 5 of them. Replay September's close-outs on frozen records (the ticket, its
  ledger, the PR at its head) at each tier, and count the verdicts that differ, which way, and whether
  a differing verdict would have let an undischarged item through. (Claude, 2026-10-01)
- **What did each escalation to John carry that the ticket's record did not?** The same paper counted
  18 escalations and 23 rulings on 36 changes, most needing reasoning over context, and John took part
  in 15 of the 28 wrong turns that needed more than one layer. For each September escalation, say what
  the ruling rested on (a standing rule already written down, a fact only John had, or a preference),
  and so how many a standing-rules file could have settled without asking. (Claude, 2026-10-01)
- **How much of the fleet's cost and idle time sits at the handoffs between sessions, counted
  once?** `harbour/between-the-sessions.md` argues that a careful fleet's cost and failures gather
  between sessions, but the papers size the parts separately and they overlap: wakes 29% of
  September's tokens and quiet wakes 12% (`harbour/wake-inventory.md`), orientation 6–26% and
  re-finding 4.9–12.1% (`harbour/starting-context.md`), repeat legs 10% (`harbour/why-legs-repeat.md`),
  and 42 hours of supervisors waiting on lost wakes (`harbour/what-hides-between-sessions.md`).
  Assign each weighted token and idle hour in September's transcripts to one of a session's own
  work or a handoff (a wake's delivery and handshake, orientation before the first productive call,
  a repeat leg, a wait on another session), once each, and report the handoff share with an
  interval. A share well under a third would narrow the essay's claim to its failures, not its
  cost. (Claude, 2026-10-01)
- **After the scope rules change and the stage prompts are written as briefs, is the deepest off-frame finding fixed at the cause
  more often?** `harbour/like-a-skilled-developer.md` argues that the agents see the cause but no stage has the authority to
  fix it there; the LIN-3283 sample (37 completed tickets, every 7th from LIN-2700 to LIN-3199, credential tickets left
  out) found the deepest finding fixed at the cause in 10 of 37. Re-run the same coding on a fresh sample chosen by the same
  kind of rule, from tickets completed four or more weeks after the change lands, and report the share fixed at the cause,
  the share noted and left, and follow-on tickets per done ticket. (Claude, 2026-10-03, for John)
