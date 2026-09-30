---
title: Do the throughput-halving and rules-that-pay papers hold up?
kind: paper
version: 1
date: 2026-09-30
authors: [Claude (LIN-3167)]
model: "Frontier tier, claude-code. One bounded session (dispatch 121ae7b6, kind custom, LIN-3167), no plan, review or close-out legs, by the brief's design. Four in-session subagents of the same tier made up two blind readers, each split across two sessions, and recoded a fresh sample of which-rules-pay's tickets. This session re-ran both papers' scripts, drew the samples, scored the codings, ran the other analyses, read every cited line and wrote the version 2 corrections. It is not the author of either paper, which came from dispatches 4e21fb08 and 5635a671."
grounded_at: fd6b1352 (LinearViewer, where both papers measured), fe541ee9 (origin/main when checked); 3b1e734 (simple-dispatcher)
cites:
  - "docs/papers/harbour/why-throughput-halved.md@fe541ee9 (version 1, LIN-3155)"
  - "docs/papers/harbour/which-rules-pay.md@fe541ee9 (version 1, LIN-3156), which-rules-pay-codes.json, which-rules-pay-second-read.json, which-rules-pay-nearmiss.json"
  - "scripts/survey-halving-git.mjs, survey-halving.mjs, survey-halving-chart.mjs, survey-growth-git.mjs, survey-rules-census.mjs, survey-rules-timeline.mjs, survey-rules-codes.mjs, survey-rules-analyse.mjs @fe541ee9, each re-run"
  - "docs/papers/harbour/survey-check-2.md@fe541ee9:300-351 (finder rows; the June weeks), survey-check.md@fe541ee9 (the house check form)"
  - "every line why-throughput-halved.md cites: measuring-throughput.md@fd6b1352:19, :98, :238; growth-atlas.md@fd6b1352:80, :178, :189-190; steady-base.md@fd6b1352:49-56, :188-189; reliability-baseline.md@fd6b1352:47-50, :64-65; where-the-effort-goes.md@fd6b1352:20, :279-282; what-supervisors-do.md@fd6b1352:218; tasks-generate-tasks.md@fd6b1352:24; writing-length.md@fd6b1352:31"
  - "LinearViewer a88c2cf7 and 7f1efdb8 (LIN-1602, LIN-1603, PR #1019 and #1024, 2026-07-26), 88dba96e (LIN-1282); simple-dispatcher b39648b (LIN-1285), ec0471d (#50)"
  - "docs/papers/harbour/reliability-baseline-defects.json@fe541ee9 (the escape verdicts and their reasons)"
  - "docs/steady-base.md@fe541ee9"
  - "docs/papers/harbour/survey-check-3-codes.json and scripts/survey-check-3.mjs (this check's recode, earlier-month sample and analyses)"
  - "LIN-3167 description and brief; 42 earlier Done tickets listed in survey-check-3-codes.json: read over the workspace proxy 2026-09-30"
---

# Do the throughput-halving and rules-that-pay papers hold up?

On their headlines, yes. On timing and attribution, not fully. Every committed script re-runs, and
every printed number in both papers reproduces from the authors' caches.

**Throughput.** The measurement, size, band and Harbour-not-simple-dispatcher findings hold. The
four-fifths and one-fifth split holds on the paper's June weeks, but those weeks end on 5 July. On
the three weeks wholly in June the split is two-thirds and one-third, the later level is 0.54 of
June's rather than 0.49, and UI is a third of the loss. The plan-review leg did not arrive at the
step. It landed on 26 July, two weeks later, and left no step of its own. Test lines per change
and prompt size ramped through the summer rather than stepping, so the tier switch is the only
candidate dated to the step. Thirty-three of the later escape rows are finder rows. Without them
the escape share rose from 1.1% to 3.1%, not 7.1%.

**Rules.** A fresh blind recode by two new readers reproduces the production-change and fault
counts on the same tickets: 29, 29 and 27 changes, with 20 faults in every read. It reproduces the
lead rule for only 59–66% of changes. The class check's lead count looks high by about a third, and
reviewer judgement's is not overstated. "The top four clear the zero rules' bound" is true of two.
Only four or five of the twelve rules that never touched a production change are gates. Six govern
the record, so for most of them zero is the design. Three rules existed for only the last six days
of the window. September's review looks like July's and August's, not June's.

Each paper's version 2 corrects its statements. `docs/steady-base.md` at fe541ee9 cites neither
paper and has no points 11 or 12. The lines it would change are listed below.

## Findings

### Why throughput halved

**Every script re-runs byte for byte, and every number matches.** A fresh commit census at
fe541ee9 holds the author's 1,638 rows unchanged, plus five commits that landed after the window.
The growth snapshots, the analysis and both figures are identical to the author's. Only the head
sha in the header line differs. The scorecard and tracker snapshots were the author's, copied from
the session workspace that made them, and were not re-fetched.

**The measurement, size and band findings hold.** The ticket-naming share, the production lines
inside ticket-naming commits, merged-but-not-Done, the naive PR counts, the medians of 70 and 67,
the three bands (×0.46, ×0.49, ×0.44), churn and net lines per change, and the 13,700 and 19,200 net
lines all match. Two additions go into version 2. Changes with no production lines fell only
×0.67. On the three weeks wholly in June the bands fell ×0.55, ×0.57 and ×0.43, still about half.

**June's block ends on 5 July, and the split turns on that week.** `survey-check-2.md` found that
the 95 a week covers the weeks beginning 8 to 29 June, and that June's calendar weeks give 69. The
week of 29 June runs to 5 July and is the busiest on record, at 121. It is also the week the SDK
runner left and the first mid-tier changes appeared.

| June taken as the weeks of | Correct a week | Later ÷ June | Fewer merged : lower share | UI share of the loss | Harbour | simple-dispatcher |
|---|--:|--:|--:|--:|--:|--:|
| 8–29 June (the paper) | 94.8 | ×0.49 | 78 : 22 | 40% | ×0.46 | ×0.88 |
| 8–22 June (wholly in June) | 86.0 | ×0.54 | 67 : 33 | 33% | ×0.48 | ×1.58 |
| 1–22 June (calendar) | 69.3 | ×0.67 | 48 : 52 | 40% | ×0.60 | ×2.11 |

The calendar row is the weakest. Only 39% of the first-parent commits in the week of 1 June named
a ticket, so its 19 is low. The three weeks wholly in June are the cleanest June, and on them the fall is still about
half. What changes is the split, the UI share and simple-dispatcher's direction. simple-dispatcher
rose from 5 to 8 a week, so "9 to 8" leans on the week of 29 June. The fall is still Harbour's.

**More than half of the escape rise is finder rows.** The paper's correct share inherits the
scorecard's `introducedBy` join. `survey-check.md` and `survey-check-2.md` found that it often
names the ticket whose review found an older fault. In the later weeks, 33 of the 58 escape rows
say in their own reason that the fault predates the change they name ("pre-existing",
"predates", "left out of scope"), or carry the residue label. Twenty-nine changes escaped only
through such rows.

| Later weeks (13 July – 21 September) | With finder rows | Without |
|---|--:|--:|
| Merged changes with a named escape | 7.1% | 3.1% |
| Correct, complete a week | 46.5 | 48.1 |
| Correct share's part of the fall, paper's weeks | 22% | 18% |

June has none. The correctness part of the fall is therefore a fifth or less on the paper's weeks,
and the escape rise is about 1.1% to 3%. Version 2 says so. The reading is a text match on the
verdicts' reasons, one reader, not blind.

**The plan-review leg came two weeks after the step.** The paper lists it among the measures that
"rose across 6–13 July", and its answer says June came "before the plan-review leg ... arrived".
The leg's template and gate landed on 26 July: LIN-1602 and LIN-1603, PRs #1019 and #1024. No
earlier plan-review mechanism appears in either repo's history. The weeks of 13 and 20 July ran at
48.5 correct changes a week before it, and the eight weeks after at 46.0. The count had already
fallen, and the leg left no step of its own.

**Process weight ramped. Only the tier switch is dated to the step.** By week:
- **Test lines.** The median correct change carried 71 test lines in the week of 29 June, then 112,
  142 and 219 through July, and mostly 200–260 in August. The ×2.5 between the blocks is a ramp,
  not a step.
- **Reading.** What agents are told to read grew 110 KB in the week of 29 June, one of its two
  largest weekly rises before late August, in the busiest week on record. The prompt source files
  (`lib/prompt-*.js`, `lib/prompts/`) grew 27% in the week of 29 June, 7% in the week of 6 July
  and 1% in the week of 13 July.
- **Month-end prompt sizes.** The close-out (4,374 → 8,110 bytes) and kickoff (39 KB → 56 KB)
  figures are month ends (`steady-base.md@fd6b1352:49-56`). They cannot place a rise within July.
- **Dispatches per change.** "Then 12 to 15" holds for the weeks of 13 July to 10 August. After
  that the weekly median ranged from 2 to 29.

The tier switch (LIN-1285 and LIN-1282, both on 12 July) is the one change dated to the step. The
UI slowdown and the dispatch jump fall in the same fortnight. So "June looks like an early burst on
a lighter process" holds as a description of the blocks. As a timing claim it holds only for the
tier. Version 2 rewrites the process finding and the answer to say this.

**The UI finding holds, and "only in Harbour" is by definition.** `survey-halving-git.mjs` counts
every simple-dispatcher path as runner, so UI can only be Harbour's. The paths classified as server
do not hide UI work in either period. Their largest files by churn are `routes/proxy.js`, the
workspace API, the providers, `server.js` and `lib/chat-tools.js`, with `routes/dashboard.js` the
only page route. UI is two-fifths of the loss on the paper's weeks and a third on the weeks wholly
in June.

**The citations land, with three qualifications.**
- **`writing-length.md:31`.** It is cited "also" for 1,702 → 8,180 comment words, but it gives a
  different measure (1,201 → 4,332, June to August). It supports the direction only.
- **`growth-atlas.md:178`.** It gives the Done rates. The open-pile sentence is on `:179`.
- **`where-the-effort-goes.md:280-281`.** It says the runner's logs start on 20 June, which is where
  "no record of 8–19 June" comes from.

The other cited lines say what the paper says. The dated commits are right: `b39648b` and
`88dba96e` on 12 July, and #50 on 2 July.

**Smaller slips, each corrected in version 2.** Leaving out review residue, the ratio is ×0.41,
not ×0.40.

**Seen, not re-measured: the tier claim.** LIN-3165 is re-deriving it. Three things for that
paper:
- Its 9.6% and 2.4% escaping rest on the same `introducedBy` field, finder rows included.
- Mid-tier changes appear from the week of 29 June, before LIN-1285.
- The frontier tier still wrote 33 correct changes in the week of 20 July, so the switch was not a
  clean cut.

### Which rules pay

**Every script re-runs byte for byte, and every number matches.** Over a copy of the author's
ticket cache, the census, the timeline (identical but for its build time), the digests and the
analysis all reproduce. The codes merge rewrites `which-rules-pay-codes.json` unchanged, and
both figures are byte-identical. The printed report matches the author's final one line for
line. The 40-minute fetch was not re-run.

**The table's arithmetic holds.**
- The lead counts sum to 78 changes and 44 faults.
- Eight rules have a lead production change, and twelve of the other sixteen are zero even as
  support.
- The 88 extra legs are 71 review rounds after the first plus 17 close-out holds.
- The Poisson intervals match exact ones to one decimal.
- The mutation check led 107 findings: 96 changed tests, 1 wording, 3 production code and 7 nothing.

**The blind recode holds the counts and not the attribution.** Sixteen tickets were drawn outside
both of the paper's second-read samples. They are every second ticket with a production change
(10 of 20) and every eighth of the rest (6 of 48), by ticket number. They hold 29 of the paper's
78 production changes and 20 of its 44 faults. Two readers coded them blind from the paper's own
digests, rubric and rule list. Neither saw the paper, its codes or the other reader.

| | Paper | Reader A | Reader B |
|---|--:|--:|--:|
| Findings | 109 | 102 | 100 |
| Production changes | 29 | 29 | 27 |
| Real faults | 20 | 20 | 20 |
| Lead: class check | 10 | 7 | 7 |
| Lead: reviewer judgement | 9 | 9 | 10 |
| Lead: direct verification | 3 | 3 | 5 |
| Lead: requirements | 2 | 3 | 2 |
| Lead: ledger or ledger discharge | 2 | 4 | 0 |
| Lead: scope drift, regression history | 1, 0 | 0, 1 | 0, 1 |
| Ledger as any rule, on faults | 9 | 6 | 3 |

Every read changed production code in the same ten tickets. The production count per ticket
matched in 15 or 16 of 16 tickets and the fault count in 13 or 14. The lead rule is where the reads
part. A reader named the paper's lead rule for 19 of 29 production changes (A, 66%) and 16 of 27
(B, 59%), and the two readers agreed with each other on 21 of 27 (78%).

The swaps are between neighbours. In LIN-2934, "general anchors share one null bucket" is the
class check to the paper and judgement to reader B. A merge-conflict version collision is scope
drift to the paper and regression history to both readers.

This bears on three of the paper's claims:
- **Reviewer judgement's 29.** A fresh reader does not shrink it. The paper's second read moved
  judgement to the ledger, but these two readers never named the ledger as support on a
  judgement-led change, where the paper did on 5 of 9.
- **The class check's 19.** It may be high by about a third.
- **The "8 of 24" count.** It holds, but its membership is soft at the margin. Scope drift's one
  change and regression history's zero each moved on a re-read.

**Two of the top four clear the zero rules' bound, not four.** The paper says the top four's
intervals "clear the zero rules' upper bound of 3.7". The class check's (11.4–29.7) and the
requirements rule's (4.8–18.4) do. Direct verification's (2.2–13.1) and the quality checklist's
(1.1–10.2) do not. They are the first and second places in the ranking.

**The zero group: gates are a third, and for most of the rest zero is the design.** The lede says
"most of the zero rules are gates", and Limits lists the gates as cannot-close, CI green on the
exact commit, authorization, role separation and ledger discharge. Ledger discharge is not a zero
rule: it led two fault fixes and supports twelve production changes. CI green on the exact commit
supports one. Of the twelve rules that never touch a production change:
- **Four are gates:** authorization, role separation, cannot-close and verify on the landed commit.
- **The verdict** is the form a review ends in.
- **Six govern the record and the tracker:** the summary comment, archive and prune, follow-up
  filing, search before filing, the rulings check and risk lanes.
- **Test adequacy** asks for tests, and it led 12 test-only changes.

None of them is written to change production code.

Within the method the gates were treated fairly. The rubric names ledger discharge, CI green and
the trivial-edit bound, and readers credited them. Cannot-close appears on five findings. But the
unit is a finding, and a gate rarely raises one. Authorization, role separation and the verdict
led nothing, because they do not find things. The paper says a gate's value shows only on removal.
It also says the bottom sixteen are "ordered only by how little they cost". Both are fair. The
unfair part is the lede's "most are gates". Version 2 says about a third, and that for most of the
rest zero is the design.

**Three rules existed for only the last six days of the window.** Search before filing and the
rulings check date from 24 September (LIN-2991) and the trivial-edit bound from 25 September
(LIN-3033). Their origins are the first commit naming the rule's earliest cited ticket. Forty-six
of the 100 tickets completed from 24 September, and 34 from 25 September. Two things follow:
- **Bounds.** Their zeros bound at about 8 and 11 production changes per 100 tickets, not 3.7.
- **Exercise counts.** Their signatures matched 3, 5 and 10 tickets completed before the rules
  existed, so Exercised overstates them.

The mutation check (24 August) and follow-up filing (25 August) cover the whole window. The same
signature problem shows in the earlier sample below: the mutation check's phrases matched 36% of
July's reviewed tickets, a month before the rule existed.

**The September population stands for July and August, not June.** A systematic sample of 14
merged code changes a month was read over the proxy and run through the paper's own timeline
script (`survey-check-3.mjs earlier` and `months`).

| | Went through code review | Sent back | Held at close-out | Review rounds | Review words | Median production lines |
|---|--:|--:|--:|--:|--:|--:|
| September (the paper's 100) | all, by selection | 32% | 15% | 1.71 | 2,776 | 96 |
| August (14) | 10 | 40% | 0% | 2.00 | 4,059 | 123 |
| July (14) | 11 | 36% | 18% | 1.82 | 2,952 | 65 |
| June (14) | 7 | 0% | 0% | 0.86 | 563 | 61 |

July and August reviewed the way September does, at the same rate of send-backs and rounds. June
did not. Half its changes had no code review by the timeline's heading rule, and none was sent back.
The rule set moved too. Ten of the 24 rules arrived after June, among them the mutation check and
follow-up filing, and five more (the ledger and its discharge, the summary, CI on the exact commit,
authorization) on 29 June. So the population speaks for review since July. For the rules that
arrived in late August or September, it speaks only for the weeks they existed. The samples are
small: 10 and 11 reviewed tickets a month bound these rates to about ±30 points.

**Smaller slips, each corrected in version 2.**
- **Both repos.** The lede says "the two that touched both repos got seven fixes". Seven tickets
  touched both repos. Two of them (LIN-2837 six, LIN-2974 one) hold the seven fault fixes.
- **Mutation-check findings.** "97 changed only tests" is 96 tests and one wording.
- **Follow-ups.** "A quarter of the filed follow-ups" is 12 of 54, 22%.
- **The trivial-edit bound's 366k** is quoted in the sentence about the twelve zero rules, but the
  bound is not one of them.

### The lines of `docs/steady-base.md` that change

The brief says the anchor already cites both papers, as points 11 and 12. At fe541ee9 it has ten
points and cites neither paper. No branch or local checkout on the runner machine holds a version
with points 11 or 12. This check did not edit the anchor. Five lines change because of these two
papers, alongside the rows `survey-check-2.md` already gave for lines 75, 121 and 123:

| Line | Now | Should read |
|---|---|---|
| 75 | "(95 a week in June; why it halved is an open question)" | 95 a week in the weeks of 8 June to 5 July, 86 in the three weeks wholly in June; `why-throughput-halved` (v2) answers most of why |
| 121 | "Why did correct, complete changes fall …? Is June an early burst, a change in ticket size, or a real loss?" | Answered in part (`why-throughput-halved` v2). Not ticket size, not measurement. Fewer merged tickets are two-thirds to four-fifths of the fall, and the lower correct share a fifth to a third, less without finder rows. It is Harbour's, and UI is a third to two-fifths of it. The tier switch is the only change dated to the step, and the plan-review leg came two weeks later. June's capacity is unmeasured |
| 122 | "Which lessons behind today's rules are still earning their keep? The firing record … is proposed in `proposals.md`." | `which-rules-pay` (v2): in 100 September tickets, 8 of 24 rules led a production change. The class check, requirements and reviewer judgement lead. For most of the rest, zero is by design (gates, record-keeping), and three rules were measured over six days. Rasmussen's warning stands |
| 123 | "The research papers themselves are unreviewed by a second document for this wave" | Both papers of this wave are checked by `survey-check-3.md`, and each has a version 2 |
| 136–139 | the evidence table | rows for `why-throughput-halved` (v2), `which-rules-pay` (v2), `survey-check-2` and `survey-check-3` |

The pending points 11 and 12 may quote either paper. If so, these version 1 figures change:
- **The split.** "Four-fifths fewer merged tickets, one-fifth correct share" becomes two-thirds to
  four-fifths and a fifth to a third, depending on the week of 29 June.
- **UI.** "Two-fifths UI" becomes a third to two-fifths.
- **Plan review.** "Before the plan-review leg arrived" becomes: the plan-review leg arrived two
  weeks after the step.
- **Escapes.** "Escapes 1.1% to 7.1%" becomes 1.1% to about 3%, without finder rows.
- **Separability.** "The top four rules are separable from zero" becomes two of them.
- **Gates.** "Most zero rules are gates" becomes a third; most of the rest govern the record.

Unchanged and confirmed:
- 70 → 67 lines, and every band about half.
- The fall is Harbour's.
- 8 of 24 rules, 78 changes, 44 faults and 29 (16) for judgement, as counts.
- The mutation check's 107 findings and 97 test-or-wording changes, and about 36 of 88 extra legs.

## Method

Each paper's own commands were re-run unchanged. Outputs went to the git-ignored `data/`, and
figures went to scratch directories. No committed figure was redrawn.

```sh
# why-throughput-halved: fresh commit census and growth snapshots, over the author's scorecard snapshot
node scripts/survey-halving-git.mjs
node scripts/survey-growth-git.mjs lv . origin/main --json > data/survey-halving/growth-lv.json
node scripts/survey-growth-git.mjs sd ../simple-dispatcher origin/main --json > data/survey-halving/growth-sd.json
node scripts/survey-halving.mjs
node scripts/survey-halving-chart.mjs --svg <scratch>
# which-rules-pay: over a copy of the author's ticket cache and coding batches
node scripts/survey-rules-census.mjs
node scripts/survey-rules-timeline.mjs --sd ../simple-dispatcher
node scripts/survey-rules-codes.mjs
node scripts/survey-rules-analyse.mjs --sd ../simple-dispatcher --figures <scratch>
# this check
node scripts/survey-check-3.mjs blocks          # the June blocks and the weeks either side of plan review
node scripts/survey-check-3.mjs finder          # finder rows by block
node scripts/survey-check-3.mjs sample <dir>    # the recode sample and the readers' packet
node scripts/survey-check-3.mjs agree           # the recode against the paper
node scripts/survey-check-3.mjs earlier         # 42 earlier tickets over the proxy, one call per 4.5 s
node scripts/survey-rules-timeline.mjs data/survey/rules-tickets-earlier.json --out <t> --digests <d> --n 1000
node scripts/survey-check-3.mjs months <t>
```

**Caches.** Both authors' caches survived in their session workspaces on this machine and were
copied, not trusted. The commit census, growth snapshots and rules timeline were rebuilt fresh and
compared. The scorecard, tracker and ticket-detail snapshots were used as they were.

**The recode.** The sampling rule is in `survey-check-3.mjs sample`. Each reader got only the
digests, the paper's rubric (its one path reference pointed at the packet) and the rule list, and
was told not to open the paper, its codes, the data directory or the other reader's output. Reader B
read in reverse order. Each reader ran as two in-session subagents of 8 tickets. Agreement is
counted per ticket, and per production change as the overlap of lead-rule counts within a ticket.
Findings are not paired one to one. Both readings are in `survey-check-3-codes.json`.

**Code, commits and citations.** Every line the halving paper cites was read with `git show
fd6b1352:<path>`. Commits and dates were read with `git log` in both repos. The plan-review leg was
dated by `--grep` and pickaxe searches for `plan-review`, `planReview` and "plan review" in both repos. Prompt
source size is the bytes of `lib/prompt-*.js` and `lib/prompts/` at each week's last first-parent
commit. Rule
origins were dated by the first commit naming each rule's earliest cited ticket. The UI path rule
was tested by listing the largest server-classified files by churn in each block.

**Proxy.** A few reads for the brief and the tickets, and 42 for the earlier sample, at one per
4.5 seconds. The only writes are this ticket's comment and status.

## Limits

- **Every reader shares a tier with the authors.** The re-runs, the recode and the readings are
  independent of the authors' sessions, not of their model tier. The recode uses the paper's own
  rubric, so it tests the coding, not the rubric.
- **The recode is small.** Sixteen tickets and 27–29 production changes put about ±18 points on
  each agreement rate. LIN-2934 alone holds 15 of the 29 changes. The readers marked 17 and 11
  findings low confidence, against the paper's 3, mostly where a digest truncated a comment.
- **The finder-row reading is a text match, one reader, not blind.** It counts a row whose reason
  says the fault predates the change, or which carries the residue label. `survey-check-2.md`'s
  hand reading found 35 of 66 over all weeks, which is the same order. A row the pattern misses
  keeps the escape share high, and a false match lowers it.
- **The earlier sample sees only what the timeline script can see.** It reads leg headings,
  verdicts, holds, rounds and signature matches, not consequences. No finding in an earlier month
  was coded, so it cannot say whether review changed production code as often then. Before July
  the heading rule may miss reviews that were not headed as reviews, which would bias June's
  reviewed share down.
- **Rule origins are dated by commits.** A rule's text may have landed before or after the first
  commit naming its earliest cited ticket.
- **The ticket cache was not re-fetched.** The population is the author's. A ticket below LIN-2619
  that completed after 11 September would still be missing, as the paper says.
- **The anchor's points 11 and 12 were not seen.** The table above lists lines at fe541ee9. The
  figure list is for whatever cites the papers.

## Next

- **Can the lead rule be coded reliably?** Two blind readers named `which-rules-pay.md`'s lead rule
  for 59–66% of production changes, and each other's for 78%. The class check and reviewer
  judgement trade places most. Write decision rules that separate "a rule pointed the reviewer
  here" from "the reviewer saw it", for example that the review text uses the rule's own words.
  Recode the paper's 28 production tickets under them with two blind readers and report κ. This
  goes into `proposals.md`.
- **What shipped in the week of 29 June?** It is the busiest week on record, at 121 correct changes,
  and it moves the halving paper's split from two-thirds to four-fifths. Read which tickets merged
  that week, from which branches and engines, and whether they were June's work landing late.
- Each paper's own Next stands. The halving paper's first Next, the tier comparison, is LIN-3165's.
  It should take its escapes without finder rows.
