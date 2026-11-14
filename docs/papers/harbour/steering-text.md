---
title: Why does the text that steers Harbour's agents keep growing, and what has ever made it shrink?
kind: paper
version: 1
date: 2026-11-14
authors: [the LIN-4478 session (dispatch f46de243), for John]
model: Claude Opus 5.5 (claude-opus-5-5), Claude Code CLI; effort not recorded in the dispatch
grounded_at: a886fb506
cites: [LIN-4478 (As asked, 14 Nov), tests/unit/prompt-size-budget.test.js@a886fb506:1-23, tests/unit/prompt-size-budget.test.js@a886fb506:146, CLAUDE.md@a886fb506:110, docs/areas/README.md@a886fb506:41, docs/areas/README.md@a886fb506:63-77, lib/periodical-report-gate.js@a886fb506:69, public/style.css@a886fb506:4161, lib/render-landing.js@a886fb506:58, lib/db-indexes.js@a886fb506:687, scripts/steady-base-growth.mjs@a886fb506:14, LIN-3203 (PR #1708, 2 Oct), LIN-3633 (description and comments, 18 Oct; PR #1935), LIN-3614 (via LIN-3633's description), LIN-3300 (description, 4 Oct; PRs #1751 and #1752, 5 Oct), LIN-3326 (description, 6 Oct; PR #1760), LIN-4021 (description, 29 Oct; PR #2178), LIN-2896 (PR, 18 Sep), LIN-4414 (PR #2399, 12 Nov), LIN-4217 (Backlog), LIN-4015 (Done), LIN-3952 (Done), LIN-3745 (Done), LIN-3800 (Backlog), LIN-2323 (Done), commit 1403655cf (LIN-462, 14 Jun), commit 31fcf36ba (LIN-1850, 3 Aug), docs/papers/harbour/how-process-changes-land.md@a886fb506, docs/papers/harbour/steady-base.md@a886fb506, docs/papers/harbour/paid-where-written-check.md@a886fb506, docs/papers/harbour/flow-and-convergence.md@a886fb506, docs/papers/harbour/the-second-copy.md@a886fb506, docs/papers/harbour/which-rules-pay.md@a886fb506, docs/papers/harbour/ticket-record-and-quality.md@a886fb506, Adams et al. 2021 doi:10.1038/s41586-021-03380-y, Lehman 1980 doi:10.1109/PROC.1980.11805, Schulz 1998 doi:10.2307/2393618, Ramanathan et al. 2020 doi:10.1145/3377813.3381350 and https://www.uber.com/blog/piranha/, Jaroslawicz et al. 2025 arXiv:2507.11538, https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents, Collins, Brown and Newman 1989 (Knowing, Learning, and Instruction, ed. Resnick, pp. 453–494)]
---

# Why does the text that steers Harbour's agents keep growing, and what has ever made it shrink?

The text grows because every lesson enters it as a sentence at the point where something went
wrong, and nothing in the system ever asks a sentence to leave. Of 2,501 first-parent commits,
831 grew the steering text and 59 shrank it. 3.4 MB went in and 0.54 MB came out, and since
June the text has stayed at about a quarter of product code's size. Even cutting writes text:
75 of the 98 commits whose titles say they cut, remove, simplify, fold or retire left the text
larger. Carried text is what a session takes in on every run (the stage prompts, the runner
contract and kickoffs, the API instructions and preamble, CLAUDE.md and the area notes). Only
two things have ever made it shrink:

- deleting the thing a passage described, as when LIN-3300 removed the second prompt path
  (about three quarters of the real shrinkage);
- one author rewriting a whole surface from its purpose against a stated outcome, as LIN-4021,
  LIN-3326 and LIN-462 did (the remaining quarter).

Trimming single rules has never moved the total by as much as a kilobyte. A cap holds what it
counts, and the growth moves next door. Every shrink has started growing back within weeks:
carried text was 817 KB before the October cuts, 663 KB after them, and 823 KB on 14 November.
Temporary structure stays for three reasons. Nothing notices that its job is done, nobody owns
removing it, and sometimes nothing could remove it even if asked. Groundhog Day is that loop:
a failure, a sentence, a cut campaign that writes more text, then regrowth. The way out the
record points to is to change where lessons land, not to cut the stock again.

## Findings

**1. The text grows with the code, at about a quarter of its size, and six bytes go in for
every one that comes out.** Steering text means the stage prompts, the runner contract and
kickoffs, the agent API text, CLAUDE.md, the area notes, the architecture docs and the other
standing docs. It was 24 KB in the first week of January, 559 KB in the week of 1 June and
2,865 KB on 14 November. Its ratio to product code was between 0.24 and 0.32 in every week from
June on. The carried subset was 224 KB in the week of 1 June, 817 KB in the week of 7 September
and 823 KB on 14 November. Ticket text grew the same
way. The median sampled Done ticket held 12.8k characters of description and comments if
created in June, 33k to 38k in August and September, 24k in October and 28k in November. New
fixed structure keeps arriving in tickets: "Done when" sections were in 3–7% of tickets created
from June to September and in 37% and 33% of October's and November's. 28% of the tickets
created in November also carry an "As asked" block, median 2,952 characters. Across all 893 commits that
touched steering text, the bytes added were 6.3 times the bytes removed. The same six-to-one
ratio appeared in `how-process-changes-land.md` for process changes in general.

**2. A lesson enters as text where the failure showed, and the record of why it is there grows
faster than the text it explains.** Harbour's prompt budget records a reason beside every
raise. That ledger is the comments in `tests/unit/prompt-size-budget.test.js`. It grew from
11,659 bytes at the freeze to 30,076 bytes today, with a peak of 50,359 on 7 November. Over the
same span the total it caps fell from 568,534 to 396,064 bytes. The reasons grew 2.6 times while
the capped text fell 30%. 12 of the 35 ceiling comments give the same reason for a raise: the
lesson is judgement or wording that no code can hold, so it has to be prose. Most of the rest
record a move or a cut. Rules are also restated by design. LIN-3633
asked for the new budget rule to be written in CLAUDE.md, `prompt-system.md` and
`plumbing.md` "in the same words". A new stage adds text in several places at once, as these
November examples show:

| New in November | Text added |
|---|---|
| Survey templates (LIN-4248) | 9.2 KB of budgeted prompt |
| Blind read (LIN-4437) | 13.2 KB of budgeted prompt |
| Agent onboarding guide (LIN-4085) | 8.9 KB of budgeted prompt |
| Area notes (from 8 November) | from nothing to 89 KB in six days |

Each of these stages also posts a comment on every ticket it runs on. The median Done ticket
went back up from 5 comments in October to 7 in November.

Cutting writes text too. 98 commits whose titles say they cut, remove, simplify, fold or retire
touched steering text, and 75 of them grew it, by 120 KB net. Even on the carried layers alone,
42 of 63 grew it. A cut explains itself, pins its new wording in a test and restates the result
in a doc.

**3. The text shrinks when what it describes is deleted, or when one author rewrites a whole
surface from its purpose. Trimming rules one by one has never registered.** 22 commits shrank
the carried text by 1 KB or more. Classed by what each removed:

| Class | Commits | Carried KB removed | Examples |
|---|---|---|---|
| The thing described was deleted | 12 | 157 | LIN-3300's one path (−113: the meta-prompt, the brief writer and the second path); the phase-label system; LIN-3461's budget replaced by one constant; LIN-580's CLI; LIN-3333, LIN-3848, LIN-1270, LIN-286 |
| One author rewrote a whole surface from its purpose | 8 | 55 | LIN-3326 close-out (−12); LIN-1850 passage planner (−10); LIN-4021 plan and plan-review (−9); two January rewrites by hand (−11); LIN-462 kickoff (−7); LIN-3299; LIN-4277 |
| Moved somewhere else | 2 | 143 | LIN-2896, CLAUDE.md into `docs/architecture/` (−141 here, +144 there) |
| A single rule trimmed | 0 | 0 | — |

Leave out the move, and deletion gave 74% of the real shrinkage while rewrites gave 26%. Both
classes started from a purpose stated above the rules, and the purpose came from John:

- LIN-3300: "This should come out shorter, and it ends the rule that every prompt change must
  be made on two paths."
- LIN-3326: close-out should finish "the way a skilled developer finishes their own work". It
  replaced a risk-lane ledger of rules with that purpose.
- LIN-4021, quoting John on 29 October: "asking them to follow precise steps undermines their
  ability to reason."
- LIN-462 measured the old kickoff at 43% cautionary prose before cutting it.

Three things set these changes apart from ordinary edits. A deletion leaves the text nothing
to describe. A rewrite was done by someone holding the whole surface, who kept a map of where
each old lesson went; LIN-4021 carried such a table. And each was checked against an outcome:
LIN-3300 "ships only with no more wrong routes", LIN-1850 landed a validated draft, and LIN-462
was based on real runs.

**4. A cap holds what it counts, and the growth moves next door.** CLAUDE.md's cap (LIN-2896)
moved 141 KB into `docs/architecture/` in a single commit. CLAUDE.md has been 9–12 KB since,
and the architecture docs grew from 148 KB to 400 KB. The prompt budget shows both halves.
From 2 to 18 October a raise had to be paid for with a cut elsewhere (the net-zero rule). In
that window the total fell 40%, but all of the fall came from three structural changes:
LIN-3300's two PRs and LIN-3326. LIN-3304 raised it by 6,990 bytes when it brought the router's
own source under the budget, and every other change moved it by 22 bytes or less. The
margin was expensive. On LIN-3614, two of four plan-review rounds and two rulings went on
finding room for three sentences (LIN-3633's description). John relaxed the rule on 18 October:
"If it's justified, an increase is fine." In the 26 days after, 29 changes raised the total and
6 lowered it, and the total went from 342,577 to 396,064 bytes (+15.6%). 18 KB of that rise is
LIN-4467 moving text in from files the budget did not cover.

Over the six weeks since the freeze, the budgeted runner prompt stayed at 17.5 KB. In the same
period the text the budget does not count grew:

| Unbudgeted text | Since the freeze |
|---|---|
| Preamble added to every dispatch (`lib/proxy-preamble.js`) | 44.0 to 54.7 KB (+24%) |
| API instructions (`lib/proxy-instructions.js`) | 114 to 140 KB (+23%) |
| Area notes | 0 to 89 KB |
| Architecture docs | 212 to 400 KB |

This window cannot show that the budget caused that growth. It does show what the
`proposals.md` line "Does a prompt budget move the growth next door?" predicted.

**5. Every shrink on record has started to grow back within weeks.** Stage prompts went from
196 KB in the week of 26 October to 236 KB on 14 November (+20%). Carried text fell from 817 KB
in the week of 7 September to 663 KB in the week of 5 October, held flat for three weeks, then
reached 823 KB by 14 November. In the 15 days after LIN-4021's rewrite, the rendered stage prompts it touched
grew again:

| Rendered prompt | After LIN-4021 (bytes) | 14 November (bytes) | Change |
|---|---|---|---|
| Plan | 9,679 | 10,428 | +8% |
| Review | 15,154 | 16,376 | +8% |
| Implementation | 7,798 | 8,866 | +14% |
| Close-out | 11,803 | 13,800 | +17% |

Ticket text dipped in October and rose again in November as comments per ticket went back up.
A cut removes the existing text but leaves untouched the process that keeps adding to it.

**6. Temporary structure stays because nothing notices it is done, nobody owns removing it, and
sometimes nothing can remove it.** `how-process-changes-land.md` found that none of 27 process
changes named a retirement condition. The one sunset ever written into a process step (LIN-2323)
was never read, and its comment is still at `lib/periodical-report-gate.js@a886fb506:69`. Two
markers wait on tickets that are already Done:

- `public/style.css@a886fb506:4161` keeps a name "until LIN-4015 retires the tone names".
- `lib/render-landing.js@a886fb506:58` keeps a fallback "until LIN-3952 owns one display name".

`lib/db-indexes.js@a886fb506:687` keeps an index "until LIN-4217 retires it". LIN-4217 is in
Backlog because `ensureIndexes` has no way to drop an index, so no session could remove it even
if asked.

Removal leaves residue because the text about one thing is spread across many files.
`the-second-copy.md` describes the same pattern for decisions. LIN-3300 deleted the
meta-prompt on 5 October. Thirteen production files named it that day and eleven still do, after
one clean-up ticket (LIN-3745) and with another in Backlog (LIN-3800).

The newest temporary store grows by design. Area notes' Waiting entries have no size limit and
are "never cut or shortened to make room" (`docs/areas/README.md@a886fb506:41`). LIN-4414 added
a rule that each stage build retires one entry. Since that rule landed on 12 November, Waiting
went from 83 entries to 118 and Lessons from 10.7 KB to 31.7 KB.

**7. Outside Harbour the pattern is well known. Removal works where staleness can be checked
mechanically and the deletion is automated.**

- People overlook subtraction. In Adams et al. (2021), participants solving problems
  defaulted to adding. They found removals more often when cued or given more chances to try,
  and less often under cognitive load.
- Lehman's second law of software evolution says complexity grows unless work is done to
  reduce it (Lehman 1980).
- In organisations, Schulz (1998) found that rule births slow as the rule stock grows. The
  stock slows its own growth, but it does not shrink.
- Uber's Piranha is the clearest removal that works (Ramanathan et al. 2020). It defines a
  stale flag mechanically (rolled out to 100%), writes the deletion diff itself and sends it to
  the flag's author. Uber reports about 2,000 flags removed. Harbour's markers have conditions
  written in prose that nothing reads.
- Anthropic's context-engineering guidance has both halves of Harbour's problem. It advises
  starting from a minimal prompt and adding instructions for the failures seen in testing,
  which is the accretion recipe. It also warns against prompts that list edge cases, and asks
  for instructions at "the right altitude".
- Instruction-following accuracy falls as the number of instructions grows. The best model in
  IFScale reached 68% at 500 instructions (Jaroslawicz et al. 2025).
- In teaching, scaffolding comes paired with fading: support is withdrawn as the learner shows
  competence (Collins, Brown and Newman 1989). That is removal planned from the start and tied
  to an observation.
- Sunset clauses are weaker evidence. `paid-where-written-check.md` found that Texas's sunset
  reviews mostly continue what they review.

**8. The shrinks suggest what removable scaffolding needs: a tie to what it compensates for, a
mechanical staleness test, a removal tool, one home, and an owner of the purpose.** This finding
is inferred from Findings 3, 6 and 7 and has not been tested. Deletion gave three quarters of
real shrinkage, so scaffolding written next to the mechanism it compensates for leaves when the
mechanism does. LIN-3300's text went with its code, while its comments in eleven other files did
not. The LIN-4015 and LIN-3952 markers stayed because their conditions are prose, where Piranha's
condition is a check that code runs. LIN-4217 shows that a removal tool has to exist before the
scaffold it will remove. Rewrites gave the other quarter, and each came from someone holding the
purpose who rewrote from it with a map of where each lesson went. This matches John's
distinction: "a drift would be adding a rule, where the correct fix is going back to the bigger
picture."

## Method

**Git.** The repository is LinearViewer at `a886fb506`, first-parent history from 4 January to
14 November 2026 (2,501 commits). `steering-text-scripts/layers.mjs` assigns each path to a
layer by pattern. The layers, with the carried ones first:

- stage prompts: the template sources, the stage-kind records, the router, the stage intent,
  the deleted meta-prompt and brief writer, and the words modules;
- runner contract and kickoffs: `docs/runner-prompt.md`, the lane and passage prompts, the
  operating manual, and every `lib/prompts/*kickoff*.js` and autopilot module;
- agent API text: `lib/proxy-instructions.js` and `lib/proxy-preamble.js`;
- `CLAUDE.md`;
- area notes;
- architecture docs;
- other docs: `docs/**/*.md`, leaving out papers, periodical reports (`docs/reviews/`), plans and
  the archive, which are records rather than steering.

The script sums blob sizes at the last commit of each ISO week (`steering-text-data/layers.json`).
`commits.mjs` takes each first-parent commit's per-file byte change against its first parent.
`summarize.mjs` turns that into the totals, the cut-worded split and the list of shrinks of
1 KB or more (`summary.txt`, `steering-commits.csv`). "Cut-worded" is a regex over the commit
subject; for merges it uses the PR title. I classed the 22 carried shrinks by reading each
commit and its ticket. `ceilings.sh` reads `FROZEN_TOTAL_BYTES` and the budget file's size at
every first-parent commit that touched the file (`ceilings.txt`). `area-notes.sh` counts Waiting
bullets and Lessons bytes at every commit that touched `docs/areas/` (`area-notes.txt`).

**Tracker.** I took a proxy snapshot on 14 November. It holds all 4,418 visible issues from
`/issues` and the creation date of every LIN number divisible by 60, which dates each issue by
interpolation. It also holds full records, comments included, for two seeded random samples of
Done tickets: 279 tickets, 37 to 43 a month from June. `tickets.py` produces both tables in
`tickets.txt`. The sample's months come from each ticket's own `createdAt`. Rulings were not
counted, because the store's history starts in October.

**Re-run.** From the repository root, run `node docs/papers/harbour/steering-text-scripts/layers.mjs
a886fb506`, then `commits.mjs`, `summarize.mjs`, `ceilings.sh` and `area-notes.sh`. For the
tracker tables, run `python3 -I tickets.py <snapshot>` on a fresh snapshot taken as its header
describes.

## Limits

- **Bytes measure size, not reading load.** A session reads only part of the docs, and the
  rendered prompts differ from the source files. The carried subset is the nearer measure of
  load, and it still overstates any one session's reading.
- **Layers are assigned by path.** Before September the API instructions lived in route files,
  which this script counts as product code. Agent API text before September is therefore
  understated, and early growth is understated with it. "Other docs" mixes reference docs with
  research notes.
- **The cut-word regex both over-catches and under-catches.** "drop" also matches field drops,
  and silent cuts are missed. The direction of the finding (most cut-titled commits grow the
  text) holds at any reasonable threshold, but the count of 75 of 98 is regex-dependent.
- **Shrinks were classed by one reader, unchecked.** The deletion and rewrite classes have a
  fuzzy border: LIN-3326 deleted rules and rewrote the stage around a purpose.
- **Ticket text is read as it stands today.** Descriptions have been pruned since dispatch, so
  older tickets' sizes are understated. Every comment is posted under one account, so John's
  words cannot be separated from the agents'. Monthly samples of about 40 give wide intervals.
  The October dip is large relative to its interquartile range, but it rests on one sample.
- **This paper describes growth and does not judge its value.** `which-rules-pay.md` and
  `ticket-record-and-quality.md` address whether the text pays for itself. Nothing here shows
  that the growth caused worse work.
- **The post-freeze window is six weeks, with many concurrent changes.** It cannot isolate the
  budget's effect.

## Next

- **Does a scaffold registered with a check that code runs get removed when the check passes?**
  Register each temporary structure (marker, switch, rule, index) with a condition code can
  evaluate: the ticket is Done, the flag is unread, the path is unused. Add a sweep that opens
  the deletion PR. Then count removals over eight weeks against the markers written in prose.
  (In `proposals.md`.)
- **Does a lesson written as a change to a stage's purpose hold the carried text flat at the
  same escape rate?** For the next ten lessons on one stage, have its owner rewrite the stage's
  purpose section instead of adding a rule, with a map of where each lesson went. Compare bytes,
  send-backs and escapes with the stage's previous ten lessons. (In `proposals.md`.)
- **Split the weekly carried-text series by flow.** Divide bytes in by cause (new stage, lesson,
  moved in) and bytes out by class (deleted subject, rewrite, trim, moved out), so the next
  regrowth is visible while it happens. (In `proposals.md`.)
