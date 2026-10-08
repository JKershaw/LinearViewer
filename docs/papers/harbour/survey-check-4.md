---
title: Do the model-choice, doubling and proportional-backtest papers hold up?
kind: check
version: 1
date: 2026-09-30
authors: [Claude (LIN-3171)]
model: "Frontier tier, Claude Code CLI dispatched by simple-dispatcher (dispatch 2d541647, kind custom, LIN-3171); effort not recorded in the dispatch item. One bounded session, with no research, plan, review or close-out legs, by the brief's design. Three in-session subagents of the same tier each re-ran one paper, tested its claims and drafted its version 2; this session read their reports, re-ran the tier analysis, read the LIN-2121 diff that the largest correction rests on, sent one correction back (September's wakes) and wrote this check. It is not the author of any of the three papers, which came from dispatches e86a0765, 9712e6ce and 70d38765."
grounded_at: 25421c7c (LinearViewer, origin/main when the check began), e308b871 (origin/main when it was written, for the anchor's line numbers); 3366748 (simple-dispatcher, origin/main); the papers measured at f38acdf7, af372aba and c65b7dd8, and simple-dispatcher 3b1e734b
cites:
  - "docs/papers/harbour/model-choice.md@25421c7c (version 1, LIN-3165), its scripts survey-model-git.mjs, -runner.mjs, -analyse.mjs, -figures.mjs, each re-run"
  - "docs/papers/harbour/what-doubled-the-dispatches.md@25421c7c (version 1, LIN-3170), its scripts survey-doubling-runner.mjs, -transcripts.mjs, -git.mjs, -analyse.mjs, -figures.mjs, each re-run"
  - "docs/papers/harbour/proportional-process-backtest.md@25421c7c (version 1, LIN-3166) and proportional-process-backtest-codes.json, its scripts survey-proportional-classifiers.mjs, -tokens.mjs, -backtest.mjs, -digests.mjs, -codes.mjs, -chart.mjs, each re-run"
  - "scripts/survey-proportional-classifiers.mjs@bff7e149 (the six rules) and the LIN-3166 session transcript (the order of commit and first outcome join)"
  - "LinearViewer 8372d336 (LIN-2121, 2026-09-13): lib/dispatch-wake.js buildWakeFollowUp stamps a wake with the triggering child's issueIdentifier"
  - "simple-dispatcher ac55263 (LIN-1219, 2026-07-10), adc256c (LIN-1260, 2026-07-11); LinearViewer 170fa88f (LIN-1357, 2026-07-16), 6ec69970 (LIN-1343, 2026-07-15), 1850aa91 (LIN-1059, 2026-07-05), 3d883c97 (LIN-1206, 2026-07-10)"
  - "docs/steady-base.md@e308b871 (points 13 to 15, the map rows 1, 2 and 7, open questions and evidence table)"
  - "docs/papers/harbour/survey-check-2.md@25421c7c:301-316 (finder rows), survey-check-3.md@25421c7c (the house check form)"
  - "scripts/survey-check-4-model.mjs, survey-check-4-doubling.mjs, survey-check-4-proportional.mjs (this check)"
  - "LIN-3171 description and brief, read over the workspace proxy 2026-09-30"
---

# Do the model-choice, doubling and proportional-backtest papers hold up?

Their conclusions mostly survive. Most of their load-bearing figures do not, and one explanation
does not. Every committed script re-runs, and every printed number reproduces from the authors'
caches. The errors are in what the scripts count.

**Model choice.** Frontier and mid still cost about the same per correct change. But the tier of
every change in the key weeks came from commit trailers, and a trailer names whoever wrote the
last commit. Half of the "frontier-implemented" changes the runner can read were implemented by
mid-tier sessions and finished by a frontier review, close-out or autopilot. Read from the
runner's own implementation launches, whole-life cost is 2.9–3.0 hours frontier and 3.2–3.3 mid,
not 3.4–3.5 and 3.25–3.4. The escape gap becomes 13 of 302 against none of 60, which on its own
weeks is not significant. Counted in full, dispatches per correct change rose about
two-and-a-half-fold at the step at both tiers (frontier 7.9 to 18.6), not two-fold from 5.3.

**What doubled the dispatches.** The step and the flat fresh sessions hold. The late-September
wake figure does not. From 13 September a wake carries the issue id of the child that triggered
it (LIN-2121), and the paper charged a follow-up to that line when it had one. So wakes into
epics' and the Runner's sessions landed on child changes only after 13 September. Counted one way
throughout, wakes went 8, 10, 16 and **18**, not 29. Wakes per worker event went 1.19 to 1.40, so
the passage layer did not double them; the rise sits on the tickets a passage flew. LIN-1219 does
not make new sessions. It sends a follow-up to a finished session through a cold resume, and it
lines up with the first rise in follow-ups, not in fresh sessions. The 32% in no map row is
mostly planning, review and close-out legs (a fifth of them repeats), the stepper beats inside
plan and implementation sessions, and cheap-tier sessions whose kind cannot be read.

**Proportional backtest.** The six rules were committed before any outcome was read, and every
count reproduces. "Light work already costs about half of heavy work" is a size effect. Held to
the same diff size, a docs- or tests-only change took 0.96 of a production change's dispatches,
so today's process is not lighter on light work. The ceiling on savings still stands as
arithmetic, at 13–18% of working hours, and is 21–30% of dispatches.

Each paper has a version 2 in this PR, with this check's author added. Twenty-five lines of
`docs/steady-base.md` change; they are listed below. This check does not edit the anchor.

## Findings

### Model choice

**Every script re-runs, and every number matches when the inputs are pinned.** The commit census
is byte-identical at the author's heads (f38acdf7 and 3b1e734b); at today's `origin/main` it
picks up newer merges. Cut to the author's 16:54Z, the runner snapshot holds the same 20,849
dispatches, tiers and hours; 151 dates differ by seconds, in the one log file still growing when
the author read it. `report.txt` and all three figures are byte-identical. The cost lineage
(`cost.json`, about 55 minutes of proxy calls) and the scorecard were not re-fetched.

**Tier attribution is the main error.** From 13 July to 30 August no change has a cost lineage, so
all 272 tiered changes took the trailer majority, and 109 had no tier. The runner's own
implementation launches can be read from 16 July. Their kind comes from a transcript or from the
bootstrap prompt's length, as `what-doubled-the-dispatches.md` decodes it, and they agree with the
lineage where both exist 165 times in 182. Against the trailer:

| Trailer says | Runner's implementation sessions say |
|---|---|
| frontier (69 readable) | frontier 36, mid 32, cheap or mixed 1 |
| mid (144 readable) | mid 143, frontier 1 |
| not stated (91 readable) | mid 84, frontier 7 |

Ties between frontier and mid commits went to frontier: 9 of 85 changes. By hand, LIN-1751's
implementation launched at mid and its squash commit carries only a frontier trailer; LIN-1160's
carries both, and the match takes frontier first. The paper's Limits line, that frontier-implemented
changes "came from autopilot, research, custom or hand sessions", describes this mislabelling.

**Selection: the misattributed changes were the costly ones.** Of the 85 changes the paper calls
frontier-implemented, 36 were implemented at frontier, 34 of them in the week of 20 July, when
routing itself ran implementation at frontier (64 of 67 launches, 23–27 July). 32 were mid-implemented, 1 cheap, 1 mixed, 8 had
no readable implementation launch, and 7 no fresh session under the ticket. Only 2 were rescues
of a failed lower-tier implementation, 3 were parent tickets and 2 read like papers. The 49 that
were not frontier-implemented cost 4.75–4.90 whole-life hours and 35.6 dispatches per correct
change. The 36 that were cost 2.21–2.26 hours and 15.3. So the trailer rule moved heavily
supervised mid-tier work into the frontier row, and raised frontier's cost.

**Missing wake ids understate dispatches badly, and hours barely.** From 12 July to 30 August,
43% of fleet dispatches carry their own `Issue:` line and 84% reach a ticket through the root of
their `followUpTo` chain. A warm follow-up carries no session id in the log, so it never took a
share of hours. 90% of those weeks' hours already reached a ticket, 94% through the root. Own
hours per correct change rise 3–5%, dispatches 60–90%. Neither changes the comparison between
tiers.

**Corrected, 13 July–30 August** (lineage, else the runner's implementation tier, else the
trailer; every follow-up charged to the session it entered):

| Figure | Version 1 | Checked | Verdict |
|---|---|---|---|
| Changes, frontier / mid / not stated | 85 / 187 / 109 | 60 / 302 / 18 | corrected |
| Whole-life hours per correct change, frontier | 3.36–3.46 | 2.93–3.01 | corrected |
| Whole-life hours per correct change, mid | 3.25–3.37 | 3.21–3.33 | holds |
| Frontier ÷ mid | about 1 | 0.91 (bootstrap 95% 0.70–1.21) | "about equal" holds, within noise |
| Rework hours per change | 0.20–0.27 and 0.21–0.29 | 0.12–0.18 and 0.22–0.29 | corrected |
| Strict escapes | 11 of 187 against 0 of 85 | 13 of 302 against 0 of 60, one-sided p = 0.09 | corrected |
| Strict escapes, 13 July–21 September | 14 of 365 against 0 of 171, p = 0.004 | reproduces by trailer; 16 of 517 against 0 of 129, p = 0.03 by implementer | holds, weaker |
| Lower bound on the escape ratio | about 1.7 | about 1.5 (1.55 two-sided) | corrected |
| Dispatches per correct change | 13.9 / 13.1 | 21.1 / 22.3 | corrected |
| The step, frontier | 5.3 → 10.4 | 7.9 → 18.6 | corrected: about 2.5-fold |
| The step, mid | 7.1 → 12.9 | 8.1 → 21.0 | corrected: about 2.5-fold |
| September, frontier / mid / cheap | 37 / 27 / 48 | 52 / 32 / 37 | corrected |
| Rework in the first week, frontier / mid | 42% / 33% | 27% / 57% | corrected |
| Rework after day 30 | a fifth to a third | 27% / 20% | corrected |
| Rework by day 60, frontier / mid | 0.36 / 0.43 | 0.26 / 0.54 | corrected |

On the paper's own assignment the ratio is 1.02 (0.75–1.30). Restricted to changes the runner shows
implemented at one tier, frontier is cheaper (2.78–2.83 against 3.51–3.62, 44 and 259 changes).
Within the merge weeks of 20 July to 2 August it is 0.64 (0.41–1.07), with the plan-review leg
arriving mid-fortnight. No reading shows frontier dearer. None separates the tiers with
confidence.

September's figure moved twice. The full count by the log's `Issue:` line gave 60, 35 and 48, but
from 13 September that line names the child that woke a supervisor, not the session it entered
(below). Charged to the session entered, as in every other period, it is 52, 32 and 37. Before
13 September the two counts differ on 5 follow-ups.

**What holds.** Fleet hour shares (frontier 65% of 943 hours, then 58% of 643), the lineage role
counts, $101, $53 and $31 per correct change, the 84-to-12 fall in frontier-written changes,
Fisher's 0.0043 on the trailer basis, and every routing commit's sha and date. Two timeline rows
were missing: implementation at frontier on 23–27 July, and plan moving to mid on 28 July. Mid-tier
close-out launches continue to 20 July, not 17.

### What doubled the dispatches

**Every script re-runs, and the analysis reproduces byte for byte.** Given the author's snapshots,
`survey-doubling-analyse.mjs` prints the same report and the figures script redraws all four
SVGs unchanged. Rebuilt fresh, the snapshots differ by 25 items logged after the author's 18:35Z,
3 transcripts and one held-window row; no period figure moves. The scorecard is the author's.

**The step and the flat fresh sessions hold.** 7.6 → 20.0 dispatches per correct change, +3.0
fresh and +9.4 follow-ups, 8.0 wakes; fresh sessions at 10.6–11.5 since August; 544 of 595 beats
(91%) stepper beats; the size-band ratios at the step; 5,520 September dispatches over 140
correct changes; the compaction count. Every citation lands.

**LIN-2121 moved wakes onto child changes, and the late-September figures carried it.** In
`8372d336`, `buildWakeFollowUp` sets the wake's `issueIdentifier` to `child.issueIdentifier`: the
dispatch whose boundary triggered it, not the session it enters. The paper charged a follow-up to
its own `Issue:` line when it had one, else to its chain's root. So from 13 September, wakes into
epics' autopilots and the Runner were charged to the child change: 828 in 14–28 September, 12.5
per correct change, against 0 in August and 2 in early September. Counted one way throughout:

| 14–28 September | Version 1 | One way throughout |
|---|--:|--:|
| Dispatches per correct change | 47.1 | 36.3 |
| Follow-ups (median per ticket) | 35.7 (17) | 24.8 (14) |
| Wakes | 28.8 | 18.0 |
| Wakes per worker event | 2.24 | 1.40 |
| Follow-ups per autopilot session | 22.8 | 14.3 |
| PENDING-EXTERNAL pauses | 28.7 | 19.2 |
| LinearViewer / simple-dispatcher | 49.5 / 41.4 | 38.8 / 40.0 |
| Size bands 1–49 / 50–299 / 300+ | 26.5 / 41.7 / 74.2 | 20.6 / 32.3 / 56.5 |

The paper found this artefact in `model-choice.md`'s count and then carried it itself.

**The passage layer did not double the wakes; the rise sits on the tickets it flew.** The 12 changes
with any dispatch in a Runner's or leg's lineage (9 correct) took 81.8 dispatches, 41.2 wakes and
1.62 wakes per worker event. The other 73 (57 correct) took 29.1, 14.4 and 1.32; their wakes fell
from early September's 16.1. By the paper's own count the other tickets also rose, to 1.70, and
that rise is the attribution change.

**LIN-1219 makes cold resumes, not sessions.** In `ac55263` (10 July 15:44) a DONE session is
finalized and its window closed, and a follow-up to it "rides the now-reliable resume path on a
separate item". Follow-ups into an already-finished session went from 3 of 321 (1–5 July) to 67
of 222 (12–15 July), and cold resumes from 0.2 to 2.6 per correct change, while warm follow-ups
stayed at 2.2–2.4. So LIN-1219 lines up with the whole first rise in follow-ups (2.4 → 5.0).
LIN-1260 (`adc256c`), which the paper credits with it, accounts for 5 of 222. The fresh-session
rise (4.5 → 7.9) has no mechanism found. The candidates in 6–12 July, among them parallel child
fan-out (LIN-874), the opencode harness (LIN-1077) and LIN-1206, cannot be separated, because no
kind can be read before 16 July.

**LIN-1357 does what the paper says, on 16 July.** `170fa88f` (16 July 11:42) with `6ec69970`
(LIN-1343, 15 July 23:47) re-keys the terminal-wake witness from one flag per subscription edge to
one per beat item, so every distinct beat's terminal wakes the parent. The per-edge flag dates
from LIN-1059 (`1850aa91`, 5 July). Follow-ups per held session went 4.8, 4.7, 7.4 and then 8.4 in
August, so that part holds. The held share's rise, 20% to 33%, fell back to 18.5% in August, so it
does not.

**The cohorts are not fully observed.** Besides 6–11 July, the run logs miss 13 July 15:23 to
14 July 16:50; the oplog shows 103 items in 12–14 July that no run log holds. There is also no run
log for 4 July 16:24 to 5 July 15:43. The 12–15 July cohort's 12.9 is a floor. Survivorship is not
a problem: every ticket in the first two cohorts, and 94 of 103 in the third, went from first
dispatch to merge in under a day.

**`model-choice.md`'s count missed 29% before the step, and 40–47% after.** The paper said 40–47%
"from July". Recomputed from that paper's own per-change counts: 28.7%, 42.3%, 40.4% and 46.7%.

**September against the map depends on how a wake is charged, and on the bucket order.**

| Bucket | By the log's `Issue:` line (5,520) | By the session entered (4,803) |
|---|--:|--:|
| 2. Passage layer | 15% | 8% |
| 1. Quiet wakes | 10% | 7% |
| 3. Supervision that acted (a ceiling) | 34% | 38% |
| 8. Review rounds after the first (a ceiling) | 6% | 7% |
| Test or CI beats | 3% | 3% |
| In no row | 32% | 36% |

Order moves shares only among rows 1–3, whose total holds. Of the passage bucket, 826 of 846
dispatches are wakes, 56% of them quiet. Taken first, quiet wakes are 18% and the passage layer
7%. Taken last, the passage layer is 0.1% and row 3 is 41%. Against the anchor, whose shares are
of weighted tokens:
- **Row 1**: 33% of all September wakes read had no outward action, which matches the anchor's 31%.
  Outside the passage layer it is 25% by the log's line and 18% by the session.
- **Row 2**: the anchor's "the Runner and legs account for all of September's supervision rise"
  agrees with the session count, where the rise sits on passage tickets. "Doubled the wakes each
  unit sends up" does not.
- **Row 7**: small low-risk changes ran 20.7 dispatches per correct change against 34.3 (23.8
  against 39.4 by the log's line).

**What the share in no row holds.** By the log's line, 1,787 dispatches, 12.8 per correct change;
two-thirds fresh sessions, one-third follow-ups. It is the same in each half of September.
- *Legs, 979.* Close-out 199, first review 197, plan 191, implementation before review 160,
  plan-review 153, research 79. 215 are a second or later session of the same kind on the
  ticket: 84 plans, 84 plan-reviews, 40 close-outs. Repeat plan-reviews outnumber first ones,
  84 to 69.
- *Beats, 430.* Into plan sessions 152, implementation before review 136, research 73,
  plan-review 54. Mostly numbered middle and last stepper beats. By title: planning 130,
  verification or adversarial review 76, building 28, and 65 that name none of these.
- *Kind unread and other, 378.* About 280 are cheap-tier sessions on the opencode harness and
  the follow-ups into them, which leave no Claude Code transcript and whose prompt length does
  not decode. The rest are custom 39, blocked 18, triage 9 and a few others.

### Proportional backtest

**The rules came first.** `bff7e149` was committed at 17:35:56Z. It is an ancestor of
`origin/main`, and `git diff bff7e149 25421c7c -- scripts/survey-proportional-classifiers.mjs` is
empty. The author's session transcript orders it: the classifier file written 17:35:31Z and
committed 17:35:56Z, the first classifier run 17:36:00Z (it prints only light counts), the first
backtest, which is the first join to any outcome, 17:39:57Z. The subagent reading the prior papers
reported at 17:35:53Z, after the rules were written. File times agree but are weak evidence; the
transcript is the evidence.

**Every script re-runs, and every number matches.** The backtest's JSON and text output are
byte-identical. The codes file regenerates unchanged (25 named fixes, 72 tickets, 369 findings,
50 real faults), the 72 digests rebuild, and both SVGs are byte-identical. The classifier differs
on one row: git reads a bare `--since=2026-06-01` at the current time of day, so a run after 19:08
drops a 1 June merge of LIN-295, which is heavy under every rule. Transcripts written since move
two token rows and add five, none in the Done population. The comment fetch was not re-run.

**The light shares, escapes and catches hold.** 10.9%, 10.5%, 25.6%, 36.5%, 1.2% and 13.3% light.
Escapes after reading 0 of 89, 0 of 85, 5 of 249, 12 of 360 and 3 of 116; the printed intervals
are Wilson's and match. This check agrees with all six of M3's removals, but two of the three
named fixes were coded *unclear*, not mentions. Catches on 5, 8, 10, 1 and 13 changes, with 12,
15, 17, 2 and 36 findings; 369 findings split 170, 76, 37, 84 and 2 that changed nothing. A
systematic read of every fifth real fault (10 of 50) and four named ones found each in a
send-back comment. Three are generous calls, so the catch counts lean slightly high.

**Light work is cheaper because it is smaller.** The light groups' median diff, docs and tests
included, is 98–155 lines; the heavy groups' is 300–432. Within bands of total lines changed
(1–49, 50–149, 150–499, 500+), weighted by the light group's mix:

| Light ÷ heavy, median per change | Dispatches | Hours | Tokens |
|---|--:|--:|--:|
| M1, raw | 0.58 | 0.66 | 0.34 |
| M1, size held fixed | 0.96 | 0.78 | 0.54 |
| M3, raw | 0.54 | 0.57 | 0.38 |
| M3, size held fixed | 0.85 | 0.80 | 0.79 |
| M4, size held fixed | 0.98 | 0.84 | 0.61 |
| Small changes, M3 light against heavy only for their paths | 1.00 | 1.04 | 1.14 |

In the 1–49-line band, docs- or tests-only changes took more dispatches than production changes
(7 against 4). So "light work already costs about half" is a size effect. The bound on savings
still holds, because a lane cannot save more than its group costs. What does not follow is that
the process already treats light work lightly.

**The ceiling, on every measure.** 7% (M1) to 18% (M4) of working hours, 13% for M3, as printed.
Costing the changes before 12 July at their group's covered mean moves it by at most a point
(6.2%, 12.9%, 17.8%). June is not richer in docs-only changes (12% against 11%). On dispatches the
ceiling is 12–30%, 21% for M3; on tokens 8–17%.

**The 77% was never offered as a saving.** `docs/steady-base.md:25` states a per-ticket ratio, and
the map's row 7 already says the total depends on the mix. On the backtest's census a docs- or
tests-only change used 64% of the median change's dispatches and 69% of its hours, close to
77%, and 38% of its tokens.

**Smaller slips, each corrected in version 2.**
- "A third to a tenth as often": M1 and M2 fail a tenth as often as their heavy groups, M3 a
  third, M4 about half and P2 three-quarters.
- "Almost all at plan review": on the merge-time groups, 13 of 17 findings under M4. Across every
  rule's light group, plan review 26, code review 21, close-out 3.
- "Fixed before merge": 47 of the 50 faults. Three (LIN-2511 and two on LIN-2872) were kept off
  main by descoping the faulty part to its own ticket.
- The 72 read changes were selected on plan-review and code-review verdicts; close-out holds on
  them were read, but close-out alone did not select.
- LIN-2934 has 22 production changes here, not 18. Without plan review it has 10 faults and 15
  changes, exactly `which-rules-pay.md`'s.
- The codes file said four subagents coded the review catches. It was ten.

### The lines of `docs/steady-base.md` that change

The anchor moved while the check ran: `b6e20a07` folded in points 14 and 15 from both unchecked
papers. The lines are at `e308b871`. This check did not edit the anchor.

| Line | Now | Should read |
|---|---|---|
| 3 | "…and `model-choice.md` re-derived the tier claim independently." | Add: `survey-check-4.md` checked `model-choice.md`, `what-doubled-the-dispatches.md` and `proportional-process-backtest.md`; each is now at version 2 |
| 25 | "A docs- or tests-only ticket still costs about 77% of the median ticket's tokens." | Add: on the backtest's census it used 64% of the median change's dispatches and 69% of its hours, and held to its diff size about the same dispatches as a production change |
| 69 | "*(`model-choice.md`)*" | *(`model-choice.md` v2)* |
| 70 | "Seven routing changes since are dated from the runner's logs." | Add: implementation also ran at frontier on 23–27 July |
| 71 | "(3.4–3.5 h) or a mid-tier one (3.25–3.4 h)" | (2.9–3.0 h) or a mid-tier one (3.2–3.3 h), within noise (0.91, 95% 0.70–1.21), with the implementer read from the runner's sessions rather than commit trailers |
| 72 | "11 of 187 against none of 85 … 0.2–0.3 hours … A third to two-fifths … a fifth to a third after day 30" | 13 of 302 against none of 60 (p = 0.09 in those weeks; 16 of 517 against none of 129 to 21 September, p = 0.03) … 0.1–0.3 hours … A quarter (frontier) to three-fifths (mid) of it lands in the first week, and a fifth to a quarter after day 30 |
| 73 | "doubled for frontier-implemented changes too (5.3 to 10.4) … 37 (frontier), 27 (mid) and 48 (cheap …). Part of that climb is a counting gap …" | rose about two-and-a-half-fold for frontier-implemented changes too (7.9 to 18.6; mid 8.1 to 21.0), every follow-up charged to the session it entered … 52 (frontier), 32 (mid) and 37 (cheap). Drop the counting-gap sentence: the figures now count every dispatch |
| 75 | "*(`what-doubled-the-dispatches.md`, unchecked)*" | *(`what-doubled-the-dispatches.md` v2)* |
| 77 | "Fresh sessions per change rose on 10–12 July, lining up with LIN-1219 (finished sessions no longer held) …" | Between 5 and 12 July fresh sessions rose, with no mechanism found, and follow-ups rose as cold resumes of finished sessions, which is what LIN-1219 does (a finished session is closed and a follow-up resumes it cold). Follow-ups per held session rose from 16 July, lining up with LIN-1357 |
| 78 | "8, then 10, 16 and 29 per change … the passage layer … doubled the wakes each unit of work sends up" | 8, then 10, 16 and 18 per change, each wake charged to the session it entered. The late-September rise sits on the tickets a passage flew (41 wakes per correct change against 14 on the rest); wakes per worker event rose from 1.19 to 1.40. Charged to the child the log names, late September is 29 |
| 79 | "quiet wakes 10%, the passage layer 15%, supervision that acted 34% … **32% sits in no candidate row.**" | Give both counts: by the session entered, quiet wakes 7%, passage 8%, acted 38%, review and CI at most 10%, **36% in no row**; by the log's line, 10%, 15%, 34%, 9% and 32%. Rows 1–3 trade shares with the bucket order |
| 80 | "*(`proportional-process-backtest.md`, unchecked)*" | *(`proportional-process-backtest.md` v2)* |
| 85 | "**Light work already costs about half of heavy work,** so the most a lighter process could save is 13–18% of working hours …" | **Light work costs about half of heavy work because it is smaller;** held to the same diff size it takes about the same dispatches, so the process is not lighter on it today. The most a lighter process could save is still what the light groups cost now: 13–18% of working hours, 21–30% of dispatches. The 77% was a per-ticket ratio, not a saving |
| 95 | "wakes per change more than tripled" | wakes per change more than doubled (8 to 18 per correct change; 29 counted by the child the log names) |
| 96 | "could save 13–18% of working hours" | Add: (21–30% of dispatches) |
| 99 | "what doubled cost per change at the 12 July step, for every tier" | what raised dispatches per change about two-and-a-half-fold at the 12 July step, for every tier |
| 133 | Row 1: "quiet wakes are 10% of September's dispatches per change" | 7–10% of September's dispatches per change, by how a wake is charged; 18% if taken before the passage layer |
| 134 | Row 2: "the passage layer doubled the wakes each unit sends up, 15% of September's dispatches per change" | late September's wake rise is on the tickets a passage flew; the passage layer is 8–15% of September's dispatches per change, by how a wake is charged |
| 139 | Row 7: "13–18% of working hours at most" | 13–18% of working hours, 21–30% of dispatches, at most. Light work is not already cheaper for its size |
| 150 | "32% of September's dispatches per change sits in no row" | 32–36% sits in no row: planning, review and close-out legs (a fifth of them repeats), stepper beats inside plan and implementation sessions, and cheap-tier sessions whose kind cannot be read |
| 159 | "What is the 32% … that no candidate row explains?" | Characterised in `what-doubled-the-dispatches.md` v2 (as line 150). What remains open is whether a change's cost should include the wakes into the epics and Runner above it |
| 161 | "Four papers are not yet checked …" | One paper is not yet checked: `browser-flakes`. `survey-check-4.md` checked the other three |
| 181–183 | "(unchecked)" on three rows | (v2) on each, and a row for `survey-check-4` |

Unchanged and confirmed:
- Line 74: the cheap tier and September are provisional.
- Line 76: 7.6 → 20.0.
- Lines 81–84: the rules came first; 11% and 26% light; 0 of 89 and 5 of 249; the catches on 5
  and 8 changes, on the merge-time groups mostly at plan review; the plan-time rule's 36 faults.
- Line 133's "31% of wakes change nothing": 33% of September's wakes read had no outward action.
- Line 149: 13–18% of hours at most.

## Method

Each paper's own commands were re-run unchanged in a separate worktree at `origin/main`, over
copies of its author's snapshots from the session workspace that made them. Snapshots that could
be rebuilt without the proxy were rebuilt and compared: the commit censuses, the runner snapshots
(cut to each author's time), the transcripts, the classifier features and the tokens. The
scorecard, the tracker snapshot, the cost lineage and the comment fetch were used as copied.
Figures were first redrawn into scratch directories and compared.

```sh
# model-choice (in a worktree holding the author's data/survey-model, data/survey and data/survey-doubling)
node scripts/survey-model-git.mjs; node scripts/survey-model-runner.mjs <state cut to 16:54Z>
node scripts/survey-model-analyse.mjs; node scripts/survey-model-figures.mjs <scratch>
node scripts/survey-check-4-model.mjs all          # counts, tier attribution, selection, arithmetic
node scripts/survey-check-4-model.mjs variant <dir> --rule root   # corrected inputs for the author's scripts
# what-doubled-the-dispatches
node scripts/survey-doubling-runner.mjs; node scripts/survey-doubling-transcripts.mjs
node scripts/survey-model-git.mjs --since 2026-05-01 --out data/survey-doubling/git.json
node scripts/survey-doubling-git.mjs; node scripts/survey-doubling-analyse.mjs; node scripts/survey-doubling-figures.mjs
node scripts/survey-check-4-doubling.mjs <verify|missed|cohorts|routes|passage|lineage|rootrule|order|unexplained|testci|rekey> --cut 2026-09-30T18:35:38Z
# proportional-process-backtest
node scripts/survey-proportional-classifiers.mjs; node scripts/survey-proportional-tokens.mjs
node scripts/survey-proportional-backtest.mjs; node scripts/survey-proportional-digests.mjs
node scripts/survey-proportional-codes.mjs; node scripts/survey-proportional-backtest.mjs
node scripts/survey-proportional-chart.mjs <scratch>
node scripts/survey-check-4-proportional.mjs <shares|escapes|catches|size|months|sample>
```

- **Implementer tier from the runner.** The payload tier of the ticket's fresh implementation
  sessions. Their kind is read from a transcript from 29 August, and before that decoded from the
  bootstrap prompt's logged length, with `what-doubled-the-dispatches.md`'s decoder. Nothing can
  be read before 16 July. A change takes its lineage tier, else a single runner implementation
  tier, else its trailer majority.
- **One way to charge a follow-up.** A fresh session belongs to the ticket on its own `Issue:`
  line. A follow-up belongs to the ticket of the session it enters, the root of its `followUpTo`
  chain, in every period. Both corrected papers use it and give the log's reading beside it where
  they differ.
- **Code and commits.** Every commit the doubling paper's change table relies on was dated with
  `git log --first-parent` in both repos. The LIN-1219, LIN-1357, LIN-1343, LIN-1059 and LIN-2121
  diffs were read. The rest were read by subject and date only.
- **Pre-registration.** `git merge-base --is-ancestor`, `git log` and `git diff` on the classifier
  script, and the author's session transcript for the order of events.
- **Size held fixed.** Bands of total lines changed, noise excluded; each band's ratio of medians
  weighted by the light group's count in it.
- **Hand reads.** Six model-choice changes against the run logs and their commits; the six M3
  removals; every fifth real-fault catch and four named ones.
- **Proxy.** A few reads for the brief and the ticket. No proxy call re-fetched any data. The only
  writes are this ticket's comment and status.

## Limits

- **Every reader shares a tier with the authors.** The re-runs and readings are independent of
  the authors' sessions, not of their model tier.
- **The implementer tier is decoded before 29 August.** Prompt length agrees with the lineage 91%
  of the time, and nothing is readable before 16 July, so the step's before-fortnight still uses
  trailers. *Bias:* direction unknown. The frontier row rests on 60 changes, 44 of them from one
  routing week.
- **The scorecard, the cost lineage and the comment fetch were copied, not rebuilt.** `survey-check-2.md`
  found the scorecard's finder rows push escapes up, mostly for mid. *Bias:* mid's escape rate is,
  if anything, still high; September's dollars are unverified.
- **Charging a wake to the session it entered leaves out the supervision above a change** in every
  period: the epics' autopilots and the Runner. *Bias:* each change's full cost is understated,
  the trend is not. The log's reading overstates the late-September rise.
- **The passage split rests on 9 correct changes, and the first stage of the step on 18.**
- **Size is held fixed only roughly.** Four bands are coarse, and the token bands hold 2 to 11
  docs- or tests-only changes each. *Bias:* within a band light changes are still smaller, so
  the size-held ratios near 1 are, if anything, low.
- **Hand reads are samples.** Six of the 32 misattributed changes, ten of the 50 catches. The
  catch reading leans generous, the same way the coders' did.
- **The anchor moved while the check ran.** The table lists lines at `e308b871`. A later edit
  shifts them.

## Next

- **Should a change's cost include the wakes into the epics and the Runner above it?** Counted by
  the session each wake entered, a correct change took 36 dispatches in late September. Counted by
  the child the log names, it took 47. The fleet-wide count per correct change reached 82 in the
  week of 21 September. The scorecard and the steady-base map need one rule. Take September's
  wakes into epics' and the Runner's sessions, trace each to the child that triggered it, and
  report what share of each change's supervision sits above it, by ticket kind. This goes into
  `proposals.md`.
- **What raised fresh sessions per correct change between 5 and 12 July?** 4.5 to 7.9, with no
  mechanism found, and no kind readable before 16 July. Read Harbour's dispatch records for
  those days, if any survive, against the parallel fan-out and harness changes of that week.
- **Does the frontier-against-mid comparison hold on the week of 20 July?** Implementation ran at
  frontier on 23–27 July. Match those tickets to mid-tier tickets of the neighbouring weeks on
  size, area and kind.
- Each paper's own Next stands, with its figures as corrected in version 2.
