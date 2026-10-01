---
title: Do the prototype-concepts and what-hides-between-sessions papers hold up?
kind: paper
version: 1
date: 2026-10-01
authors: [Claude (LIN-3190)]
model: "Frontier tier, Claude Code CLI dispatched by simple-dispatcher (dispatch 8f8f47ec, kind custom, LIN-3190); effort not recorded in the dispatch item. One bounded session, with no research, plan, review or close-out legs, by the brief's design. Four in-session subagents of the same tier worked in parallel: one re-ran what-hides-between-sessions' scripts; one hand-checked a systematic sample of its detectors' alarms and register against the transcripts and the runner's oplog; one re-ran prototype-concepts' cost scripts and priced each population by price row; one read the prototypes at their pinned commits and blind-recoded a sample of the checks coding. This session reconciled both papers against the three earlier papers, settled every figure below and wrote the check. It is not the author of either paper, which came from dispatches 89a0d16c (prototype-concepts) and ac67a21a (what-hides-between-sessions)."
grounded_at: "066232d6 (LinearViewer, origin/main when the check began, for the anchor's line numbers; docs/steady-base.md, wake-inventory.md, held-or-fresh.md and what-supervisors-do.md are unchanged from d88e2216); both papers' data re-run from the authors' snapshots at d88e2216; simple-dispatcher 3366748; JKershaw/lighthouse@7828bb8b and the other prototype repositories at the shas in prototype-concepts-matrix.json; transcripts and the runner's oplog read on this machine on 1 October 2026, 11:20–13:00Z"
cites:
  - "docs/papers/harbour/prototype-concepts.md@066232d6 (version 1, LIN-3187), prototype-concepts-matrix.json, prototype-concepts-checks.json, and its scripts survey-protoconcepts-{lighthouse,harbour,dollars,figures}.mjs and survey-costmix-{tokens,classes}.mjs, each re-run"
  - "docs/papers/harbour/what-hides-between-sessions.md@066232d6 (version 1, LIN-3188), its register, detector-eval and prompt-rules JSON, and its scripts survey-hides-*.mjs and survey-wake-extract.mjs, each re-run"
  - "docs/papers/harbour/wake-inventory.md@066232d6:207-231 and wake-inventory-failures.json (v2; the 25 failures, 15 lost wakes, 11 on the runner's side)"
  - "docs/papers/harbour/what-supervisors-do.md@066232d6:137-155 (v2; the 25 failures and the six set aside)"
  - "docs/papers/harbour/held-or-fresh.md@066232d6:192-207 and :330 (v2; 11 failures that would not exist under a relay; option A's class route)"
  - "scripts/survey-check-7-held.mjs@066232d6:66-70 (the class route takes failsafe re-confirms and silence re-fires)"
  - "docs/papers/harbour/where-judgement-happens.md@066232d6:200-204 and starting-context.md@066232d6:224-228 (v2; options cited by prototype-concepts)"
  - "JKershaw/lighthouse@7828bb8b: harbour/prices.json, AGENTS.md:18, studies/LH016/LH016.md:16-87, studies/LH016/data/tally.txt:77, amendments.md:10, releases.md:6-16, notes/closeout-2026-09-27-improvement-round.md:34"
  - "JKershaw/tag-two@51476740:docs/experiments.md:1169-1188; tangle@535b96a2:PROGRESS.md:170-191; CodeWiki@154aa877:docs/wiki-quality-analysis-2025-12-09.md:11-33; pith@d52c0151:docs/benchmark-results/2026-01-03-self-test.md, docs/BENCHMARKING.md:137-143,298; Browser-agent@68d7f4c2:BUILD_LOG.md:821-832,1112-1143,1241-1281; harbour-evals@3e6c230f:docs/cheap-model-benchmark-report-2026-07-21.md:34-58, docs/benchmark-report.md:11-17,97-128"
  - "simple-dispatcher/hook.js@3366748:2058-2065, simple-dispatcher/feedback.js@3366748:41-70, simple-dispatcher/config.js@3366748:50"
  - "docs/steady-base.md@066232d6 (the lines listed below)"
  - "LIN-3190's description and brief, read over the workspace proxy 2026-10-01"
  - "scripts/survey-check-10-rows.mjs and scripts/survey-check-10-rows-analyse.cjs (this check); survey-check-10-alarm-codes.json (this check's alarm codes)"
---

# Do the prototype-concepts and what-hides-between-sessions papers hold up?

Their scripts do, and their direction does; several of their figures and readings do not. Every
committed script in both papers re-runs from the authors' snapshots, and every table reproduces:
what-hides-between-sessions' byte for byte, prototype-concepts' with five medians moving by under
half a percent. Both headline answers stand. What fails is in what each figure is taken to mean.

**prototype-concepts.** Its prototype figures are read correctly at the pinned commits, but four
readings go further than their sources, and its cost comparison is not like for like in a way the
paper misreads:
- **The per-piece costs differ by price row, not by the shape of the work.** The fleet moved from
  the older frontier price row to the newer, cheaper one in the week of 22 September. The
  one-session papers and checks ran 90–100% on the newer row, the pipeline papers 77% on the
  older one, and the code changes half their list price on it. The paper's "a multi-session paper
  costs 1.7 times as much per weighted token", and the Next item and proposal built on it, are
  that switch. Within one row a paper, a check and a code change cost the same per weighted
  token to within 3%.
- **As ratios**, a Lighthouse study is 1.35× a one-session Harbour paper at list prices and about
  1.0× in weighted tokens; 0.76× and about 0.57× a paper with its share of the check. A code change
  is 2.61× a paper at list prices, 1.70× in weighted tokens, and 1.97× priced wholly on one row.
  The Lighthouse rise from early to late studies is 3.7×, but the reader review itself is a small
  part of it, so option E's "3.7× after adding it" does not hold.
- **The tag-two 51% against 29%** is a contrast its own repository calls "not established".
  CodeWiki "did not improve" rather than "got worse"; tangle's token premium is a median 1.44×,
  not 2–5×; harbour-evals' review and research failures are put down to fragile fixtures by its
  own report.
- **Lighthouse.** Its secondary frame adds 21 post-release changes, not 29. "Not from its second
  agent" is contradicted: review agents made 15 of the 35 post-release corrections, in rounds the
  keeper opened. Its bound on subagent spend was exceeded four times, not three.
- **The checks coding** counts every claim a check found wanting as "load-bearing". By the checks'
  own word, about 20 of 24 documents had a load-bearing claim corrected, not 23. One check ran
  before merge.

**what-hides-between-sessions.** Its register, its scoring and its nine hits all hold: each hit is
the incident, and each lead time recomputes within 0.1 hours. Six claims do not hold:
- **"About 90 real alarms nobody recorded"** counts alarms real by class. A systematic hand check
  of 33 found 20 real, 7 harmless blips and 6 false, which puts the distinct real faults at about
  40 (25–50). D1's unrecorded bursts were nearly all errors that healed in minutes.
- **"About half" of the incidents on record** is 9 of the 19 the windows scored. Counting the five
  credential incidents in D1f's own window it is 9 of 24. Option A's two rules caught 7 of 19,
  0–9.3 hours early, not "9 of 19, 0–21 h".
- **The 108 hours of lost-wake idle.** 66 of them are waiters the runner had already completed,
  mostly after their ticket was Done. 42 hours are sessions still waiting.
- **The failsafe re-fires' 1.6% "outside P4"** double-counts map row 1 by 0.9 points. The quiet
  re-fires into supervisors are in held-or-fresh's class route.
- **Option B's "23 lost wakes"** are 23 failed completion posts. At least 4 of their parents were
  woken anyway, and four failed because their items no longer existed.
- **The 23 September autopilot** that "sat 23.7 hours" sat because the dispatcher was down for a
  day. That outage is on no ticket.

The median of 16 hours to discovery reproduces, but it is driven by onsets known only to the day.
Where the record gives the onset's time, the median is 3 hours.

**Reconciled** against the three earlier papers, the lost-wake record agrees: 11 of 15 in the
runner. The detectors do not double-count rows 1–3 in tokens once the re-fires are moved. They do
overlap row 3 in mechanism, since row 3 moves the liveness clocks into code. Both papers are at
version 2 in this PR, with this check's author added. Ten lines of `docs/steady-base.md` would
change and three rows be added; they are listed below. This check does not edit the anchor.

## Findings

**Every script re-runs, and every printed number reproduces.**
- **what-hides-between-sessions.** Re-run from the author's snapshot, the analysis, detector and
  wait-coding outputs and both figures are byte-identical. The runner detector, which reads the
  live oplog, moves only two bookkeeping counts by one or two lines. A fresh extraction from the
  transcripts, cut to sessions whose first turn came before 10:14Z, gives the paper's 2,076
  sessions and every figure but two. September's tokens rise 0.1%, because four long sessions are
  still running into October. The failsafe count rises by one, because the runner script dates the
  newest run log's fires at its start.
- **prototype-concepts.** The Lighthouse, Harbour and figure scripts give the author's JSON and
  byte-identical charts. The token and dollar censuses re-run with `--until` give the same 2,004
  sessions and totals. The classes script reads origin/main as it stands, so at today's head it
  adds this wave's own three papers to the one-session population: 33 at 0.97 of the median.
  Pinned to d88e2216 it reproduces.

| Figure | Version 1 | Checked | Verdict |
|---|---|---|---|
| **prototype-concepts** | | | |
| Pith: 236 against 286 rubric points, 0 wins in 15; "lost on 14 of 15" | | 0 wins, 14 losses, 1 tie; the judge takes the exploring agent's answer as ground truth; about 14 runs, nearly all lost | holds |
| CodeWiki: 6 of 15 accurate to 4 as pages grew; "got worse" | | 6, 3, 4 of 15 in one run, which the project blames partly on parsing bugs | corrected to "did not improve" |
| Browser-agent 3/20 → 19/20 → 20/20; 29/40 → 39/40; tuned on a 0.6B model | | reproduce; 20 trials an arm, after-arm repeated; the title tool carried over to a 1.7B model | holds |
| "No prototype produced better than a single-run controlled comparison" | | not literally true of Browser-agent or of the pointer probe's three runs | corrected |
| tag-two: 24 of 47 with the record against 4 of 14 without (51% against 29%) | | 11 graphs against 3, another commit, a model check that varies by a node a graph; the source calls the contrast "not established" | corrected: about half, with the record |
| tangle: 14 of 18 found more, "often at 2–5 times the tokens" | | 14 of 18 hold; on those 14 a median 1.44×, 5 at 2.7–5.4×, 2 at fewer | corrected |
| harbour-evals: review and research "failed for every model" | | they did; its report calls them fixture fragility, and the review fixture has no filename to cite | corrected |
| Strength codes | | Lighthouse's staged review (2) and harbour-evals on research cost (2) are generous at 1; the Limits' proposal to lower Pith and tangle misreads the scale | Limits corrected |
| 12 relevant + 6 not + 2 empty = 20 repositories; 14 concepts; the five pins unchanged | | reproduce | holds |
| Lighthouse study medians, early (7) and late (6), and over all 13 | | reproduce exactly | holds |
| "LH011–LH017 (reader review added)" | | four of the six (LH012, LH014, LH015, LH017) | corrected |
| One-session paper n30; check n11; pipeline n8; code change n202 | | reproduce | holds |
| Check "covers 2–3 papers" | | three cover one each | corrected |
| Paper with its check share, n22 | | 21 papers and an essay; two checks have no ticket. Median 0.1% lower, IQR ends ±0.4% | corrected |
| LinearViewer and simple-dispatcher code medians; size bands | | four medians move 0.03–0.3% | corrected |
| A check is a third of a checked paper (33%); option D's "about a third" | | reproduce (2.95M weighted a paper) | holds |
| The step from paper to checked paper | "its share of the check" | the checked papers' own median is 1.20× all 30 papers', before any check | qualified |
| "All 16 dispatches with token records re-price to the cent" | | true, but the same formula re-applied; 3 of 16 belong to a costed study | qualified |
| "Studies after 26 September carry only transcribed figures" | | only LH002 of the 13 has token records | corrected |
| Lighthouse's bound on subagent spend a session exceeded three times | | subagent spend at 1.5× the bound (the improvement round, whose quoted figure included its driving session), 1.8× (LH015, against a raised bound) and 1.9× (LH016, omitted), plus a driving session at 2.2× that the bound does not count | corrected: four |
| Option E: "3.7× after adding" the reader review | | medians rose 1.3× in research, 3.9× in review, 8.7× in driving sessions (partly a change in how they were measured); subagent spend 2.1×; the reader pass itself 0.2–0.8× a Harbour check | corrected |
| "Top-priced tier at 2.5 times the frontier tier's list rates" | | 2.5× on input and output, 1.25× on cache reads; three review dispatches cost 2.2–2.3× the same tokens at the frontier row | corrected |
| One-session against pipeline paper: 2.3× at list prices, 1.3× weighted; list price per million weighted tokens 1.7× as high for the pipeline paper | | reproduce (1.73× by medians); the cause is the price row, not cache structure: 1.50× on the newer row, 1.23× on the older | corrected; Next and proposal replaced |
| LH016: 66 changes, 42 before and 24 after release; evidence review 23; reader review 17; recheck 10; 15 of 17 in passed passages; replays 5, 7, 4 of 16 | | reproduce | holds |
| LH016: "plus 29 more after release in its secondary frame" | | 21: amendment 1 counts 8 of the 29 in the primary frame only (`tally.txt:77`, 45 = 24 + 21) | corrected |
| "Not from its second agent" | | review agents made 15 of the 35 post-release corrections, in keeper-opened rounds (`LH016.md:69`) | corrected |
| "2 carry correction notices and 5 later-evidence notices (13 notices in all)" | | 3 notices on 2 articles and 10 on 5 | corrected |
| 23 of 24 checked documents had a load-bearing claim corrected; 95 in all; about 9 figures at the median | | 23 had a claim corrected; by the checks' own word "load-bearing", about 20 (growth-atlas, why-legs-repeat and learning-while-the-tools-change drop out); 95 counts every failed claim; the median is 4 claims and 9 figures. A blind recode of 8 pairs agreed on the answer in 7 | corrected |
| "Harbour's checks run after a paper merges" | | 23 of 24; the check of what-should-an-agent-leave-behind read the draft and found nothing | corrected |
| Headline held in 20, changed in 4; 23 of 24 at version 2 or later; 44 faults in 18 of 100; escapes 5.7 and 27.3 per 100 | | reproduce | holds |
| **what-hides-between-sessions** | | | |
| 107 incidents "of nine patterns"; 92 invisible; finders 28/26/19/13/9/3; repos 54/44/9; every pattern row | | reproduce; 6 of the 107 are in none of the nine | corrected |
| Median 15.8 h to discovery (headline "16"; option A "10–15"; Next "about 15") | | reproduces; 3.0 h where the onset is timed, 19.0 h where it is a date; 47 of 64 onsets are dates, not 65 | qualified |
| 9 hits; leads 0.8, 8.8, 9.0, 9.3, 4.9, 5.1, 21, 0, 5 min; median 5.1 h | | each alarm is the incident; leads recompute within 0.1 h | holds |
| "About half" caught: 9 of 19 | | 9 of 19 scored; 9 of 24 with D1f's own window; D5x's window holds seven July–August lost wakes never scored | corrected |
| Option A (D1 and D2): "9 of 19 incidents 0–21 h sooner" | | D1 and D2 caught 7 of 19, 0–9.3 h; the 21 h is D5x's | corrected |
| D1: "20" unrecorded; "19 more `LINEAR_AUTH`"; "21 bursts" in 2–25 September | | 20 = 17 auth + 3 transient; 21 auth bursts in the month, 14 in 2–25 September. LIN-2993 is scored as a hit in the file and a miss in the text; as a miss D1 has 23 | corrected |
| "About 90 real alarms" (20 + 43 + 3 + 22 + 5 = 93) | real by class | a sample of 33: 20 real, 7 blips, 6 false; about 40 distinct real faults (25–50) | corrected |
| False alarms: D1 16, D2 2, D5 0, D5x 0, D7 2 | | under the scripts' rules 16/42, 2/57, 0/4, 0/23, 2/7; D5 and D5x set to 0 in code. In the sample: D1 1 of 7, D2 3 of 11, D5x 2 of 7, D7 0 of 5 | qualified |
| "Of September's 27 lost wakes, 5 were rescued by nothing" | | 2; three were woken within a minute | corrected |
| D5: the 23 September autopilot "never woken", 23.7 h | | it sat; the dispatcher was down 06:53Z 23 September to 06:35Z the 24th, on no ticket and not in the register | corrected |
| D7: duplicates on LIN-3125, LIN-2667, LIN-2718 | | all real; two more on LIN-2560 | holds |
| D5x: 22 of 23 still wrote `hook.done_posted`; no retry | | reproduces at `hook.js@3366748:2058-2065` and `feedback.js:41-70` | holds |
| Option B: "23 lost wakes since July, about 8 a month" | | 23 failed terminal posts, 8 in September; at least 4 parents woken anyway; four on 26 July failed because the items were gone | corrected |
| P2 in September: "1 cycle and 2 recorded orphaned waits" | | the script counts 3 recorded (LIN-2559, LIN-2630, LIN-2932) and the cycle is 1 October's | corrected |
| P5: 14 woken "24–50 min late" | | 13 at 24–47 min, one 5.3 h | corrected |
| P5: 108 h of lost-wake idle | | reproduces; median 5.4 h, 10 at the 6 h cap; 66 h in waiters the runner had completed | qualified |
| P6a: 219 fires on 149 sessions; 165 h; 130 of 142 re-fires worked | | 206 stall-failsafe and 13 watchdog fires, one misdated from 1 October; 165 h is logged silence over the 80 fires from execution; "worked" means at any later time | qualified |
| P6a: 54.8M of re-fires (1.57%) "outside P4" | | 30.4M of it is quiet re-fires into supervisors, inside P4 and map row 1; 0.70% outside | corrected |
| The periodicals: 42 reports, 13 of 15 templates, 67 runs, 109 follow-ups, one first find, 9 of 12; 112M (3.2%) | | reproduce; the 26 September batch alone is 109M (3.1%) | qualified |
| "About 40 seconds of CPU" | | 35 s without the wake extract the runner detector reads, 55 s with it | corrected |
| 2,076 sessions; transcripts to 10:14Z; oplog to 10:06Z | | the snapshot runs to 10:36Z (2,077) and 10:33Z; 2,076 is the sessions begun before 10:14Z | corrected |

**The cost comparison is like for like on the frontier row only for Lighthouse against Harbour's
papers and checks.** Lighthouse prices every dispatch from its own `prices.json`. Prototype-concepts
priced Harbour's transcripts from the same table, each message at its own model's row. Three things
differ between the pieces:
- **The rows.** The table has two frontier rows. At list prices a weighted token on the newer costs
  0.53–0.55 of one on the older, because the newer is cheaper on every token and charges a cache
  read at a twentieth of input where the older charges a tenth. The weighted unit charges both at
  1. September's fleet ran 65–72% on the older row each week until 22 September and 77–98% on the
  newer one after. Lighthouse ran wholly on the newer row, plus its top tier for review.
- **The tiers.** Lighthouse reviews on its top tier. That costs 2.2–2.3× the same tokens at the
  newer frontier row on its three review dispatches with records, and about 2.7× per weighted
  token, because the weighted unit counts the top tier at 1. Harbour's checks ran wholly on the
  newer frontier row.
- **What a piece includes.** A Lighthouse study includes its driving session (self-reported, and
  measured at commit time before 28 September), research, writing, review, its post-release rounds
  and LH016's replays. It leaves out the keeper's relayed review, the improvement round and a
  website build. A one-session Harbour paper is its one session and its subagents, with no
  supervisor. A code change is every session entered on its ticket, about a quarter of its cost in
  the ticket's own autopilot and stepper, and none of its epic's supervision.

Read on one row, the ratios are: a Lighthouse study about 1.0× a one-session paper in weighted
tokens, with its premium in the top-tier review; a code change 1.97× a paper. Lighthouse estimates
output tokens as characters over four. On Harbour's own transcripts that gives about a third of the
recorded output, which would put Lighthouse's studies about a quarter low. This was not measured on
Lighthouse's transcripts.

**The prototypes are read fairly against their own repositories, with four overreaches.** Every
clone's head is the sha the matrix pins, and the five pins the earlier register used are unchanged.
The overreaches are in the table: tag-two's contrast, CodeWiki's direction, tangle's premium and
harbour-evals' failures. Two codes on the paper's own 0–3 scale are generous: Lighthouse's staged
review is a tally of who changed what, with no comparison process, and harbour-evals measures
nothing about research cost. Browser-agent's 2 is if anything harsh.

**"Load-bearing" in the checks coding means "failed".** `prototype-concepts-checks.json` counts
every claim a check found did not hold. Where the checks draw their own line, the count drops:
- `survey-check.md` names four load-bearing failures across three papers, none of them
  growth-atlas's, but the coding gives that check 13;
- `survey-check-6.md` calls why-legs-repeat's five failures secondary;
- the check of learning-while-the-tools-change ran in the session that filed the essay and found
  failures "of reach and of position, not of fact".

A blind recode of every third pair (8) agreed on the headline answer in 7. It agreed on the
load-bearing count within one in 5.

**The detectors' hits are real; most of their unrecorded alarms are not distinct real faults.**
Before reading any alarm, "real" was fixed as a fault that idled a waiting session 15 minutes or
more, lost or duplicated work, failed an action a retry did not recover, or needed a person or the
failsafe to recover. A harmless blip is a fault that healed itself in about 15 minutes, with
nothing parked or lost. The sample was every k-th unrecorded alarm by time, and all of D5's and
D7's (`survey-check-10-alarm-codes.json`):

| Detector | Unrecorded | Sampled | Real | Blip | False | Estimated real |
|---|---:|---:|---:|---:|---:|---|
| D1 shared-error burst | 20 | 7 | 0 | 6 | 1 | about 1 (0–7) |
| D2 stopped or circular wait | 43 | 11 | 8 (2 usage limits) | 0 | 3 | about 31 (19–39) |
| D5 lost wake | 3 | 3 | 3 | 0 | 0 | 3, none distinct |
| D5x lost terminal post | 22 | 7 | 4 | 1 | 2 | about 14 (7–17) |
| D7 duplicate launch | 5 | 5 | 5 | 0 | 0 | 5 |

That is about 54 before duplicates are removed. Duplicates are the same event caught by two rules,
such as a lost `[done]` that D2 and D5x both see. Without them, about 40 distinct real faults
remain (25–50), of which about 8 are usage-limit stops. D2's false alarms share one mechanism: when
a wake lands within three minutes of the waiter declaring its wait, the rule's three-minute burst
merge swallows the wake and counts a lost wake up to the cap. D5x's join to a parent missed real
parents three times, so its "no parent" rows are not harmless either.

The register's counts all recount exactly. A second reading of 15 rows, taken systematically,
agreed on filing time and repo in all 15. It would recode two finders (LIN-800 and LIN-2232 were
found by review) and two onsets (LIN-1113, LIN-1815), and argue five pattern and three invisibility
calls. Three incidents are missing from the register:
- the dispatcher's day-long stop on 23–24 September;
- the 22–23 September dead-credential night, on record in LIN-2933's comments and LIN-3018;
- the periodicals' four-week outage, which the paper treats as their only first find.

These change no headline. The version 2 paper states them in its Limits rather than recoding the
author's register.

**Reconciled against the three earlier papers, the records agree; the token savings overlapped.**
- **`wake-inventory.md` v2** puts 15 of the 25 supervisor failures on record as lost wakes, 11 on
  the runner's side. The register codes the same 15 as runner 7, both 4 and Harbour 4, and two of
  them (LIN-881, LIN-2932) as circular or orphaned waits, not lost wakes. "Runner or both" is 11,
  so the paper's "11 of 15 in the runner" agrees. The register's 20 lost wakes are 14 of the 25
  plus six others. One of those six, LIN-2468, is a case `what-supervisors-do.md` v2 set aside as
  latent, with no incident.
- **`what-supervisors-do.md` v2's 25 failures** are all in the register. Two of the nine detector
  hits are among them (LIN-2511, LIN-2932).
- **`held-or-fresh.md` v2's 11 failures that would not exist under a relay** are 11 of the
  register's 107: ten lost wakes and LIN-881. One detector hit (LIN-2511) and one miss (LIN-2720,
  an opencode session with no transcript) are among them. A relay and the detectors therefore
  claim the same incident once in nine hits.
- **Do the detectors' savings double-count map rows 1–3?** In tokens, partly. The paper puts
  failsafe re-fires at 54.8M, 1.57%, "outside P4". But 270 re-fire deliveries make that figure. The
  quiet ones into supervisors, 96 deliveries and 30.4M, are inside held-or-fresh's 3,233 quiet
  wakes, and its class route sends failsafe re-confirms and silence re-fires to code
  (`survey-check-7-held.mjs:68`). That is map row 1's −5.7%. Outside P4 the re-fires are 0.70%,
  and the tokens outside quiet wakes are about 1.6%, not under 3%. Flood tokens are inside P4, as
  the paper says. In hours there is no double count, because the anchor sizes rows 1–3 in tokens
  only. In mechanism, option A and option B overlap row 3, which moves "the completion gate,
  re-arming, restating and liveness clocks" into code (`steady-base.md:172`). The paper's "it does
  not overlap map rows 1–3" holds only for tokens.

**The options' sizes, after correction, and where they overlap.** No option is added here.

| Paper and option | Size as corrected | Overlaps |
|---|---|---|
| prototype-concepts A, a short pointer | ~1.5–2% (as row 14) | it is anchor row 14 and starting-context B |
| B, code holds the sequence | up to ~27% with rows 1–2 | it is anchor row 3; the same lever as what-hides A and B from the other end |
| C, a done-and-answered list | inside −9% to −19%; tag-two supports "about half repeated with the record", not the contrast | inside anchor row 16 |
| D, check before merge | about cost-neutral, 2.95M weighted a paper; the one pre-merge check found nothing | no anchor row |
| E, a reader pass | the pass itself 0.2–0.8× a Harbour check, not 3.7× a study | no anchor row; costs what D saves in waiting |
| F, a repeated fixture eval | enables where-judgement-happens option 3 (2–5% of ticket cost); the 7–14 spread was across harness revisions | no anchor row |
| G, graph investigation (not recommended) | more coverage at a median 1.4× the tokens | none |
| what-hides A, live D1 and D2 | 7 of 19 on record, 0–9.3 h sooner; up to 42 h a month of supervisors waiting; under 1% of tokens; D1 needs a harm or duration threshold | row 3's liveness clocks in mechanism; prototype B |
| B, a truthful completion post | 23 failed posts since July, 8 in September; at least 4 woken anyway | row 1's wake-delivery safety check; row 3 |
| C, periodicals read the alarm log | up to 3.1% a batch | none |
| D, retire vigilance text | a few KB of 36 KB | anchor row 11 (freeze prompt sizes; lessons land as code) |
| E, a duplicate-launch alarm | 0.15% of tokens, 5 pairs a month | where-judgement-happens option 4's duplicate guard |

Prototype B and what-hides A and B are one lever: code holds the waits and says when one breaks.
Built with row 3 they would be counted once.

### The lines of `docs/steady-base.md` that change

The lines are at `066232d6`. The anchor cites neither paper yet, beyond its open question and its
decision on the sixth wave, so these are the lines a fold-in of the two version 2 papers would
change. This check did not edit the anchor.

| Line | Now | Should read |
|---|---|---|
| 3 | "…`survey-check-9.md` checked `cost-mix.md` and `how-process-changes-land.md`. Each is now at version 2, and its figures are given here as corrected.)" | …The sixth wave's `prototype-concepts.md` and `what-hides-between-sessions.md` were checked by `survey-check-10.md`, and each is now at version 2.) |
| 96 | "18 of the 25 supervisor failures on record are on a wake path, and 11 of the 15 lost wakes were lost in the runner's delivery, not in Harbour's minting." | The line stands; add: the record is a fraction of what happens. The wait graph found 27 lost wakes in September alone, 2 rescued by nothing, and the runner logs a failed `[done]` post as posted (22 of 23 since July) (`what-hides-between-sessions.md` v2) |
| 151 | "…about 8% less at list-price ratios, because the September mid tier is weighted at 0.6 of the frontier tier and listed at 0.4…" | …and the weighted unit charges both frontier price rows at 1, though per weighted token the newer row, the fleet's from the week of 22 September, lists at about 0.55 of the older; a list-price series falls there where the weighted one does not (`survey-check-10.md`). The rest stands |
| 170 | Row 1's risk: "Missed or lost wakes are the most common supervisor failure (15 of 25)…" | …(15 of 25 on record, and under-recorded: 27 lost in September by the wait graph, and failed `[done]` posts logged as posted, `what-hides-between-sessions.md` v2)… The rest stands |
| 172 | Row 3's evidence: "77% of supervision tokens mechanical…" | Add: code detecting broken waits caught 7 of 19 incidents on record a median 5 hours before they were filed (D1 and D2, `what-hides-between-sessions.md` v2); a narrow model call inside code-held steps went from 3/20 to 19/20 on a small model (`prototype-concepts.md` v2). The liveness clocks and a live detector are one piece of work |
| 183 | Row 14's evidence: "…one pointer probe, 51 → 18 turns (LIN-2115)" | …; John's prototypes agree and add no size: Pith's code map lost 14 of 15 to exploration, and a maintained wiki did not improve as it grew (`prototype-concepts.md` v2) |
| 185 | Row 16's risk: "The handoff must carry verdicts, plan text and code…" | …verdicts, plan text, code, and a list of what is done and answered: a planner given only a durable record re-proposed done work for about half its nodes (tag-two, `prototype-concepts.md` v2)… The rest stands |
| 190 | "**From the fifth wave:** 13–16. … The six papers' Options sections hold more candidates…" | …The fifth and sixth waves' Options sections hold more candidates, and some overlap: prototype-concepts' A–C are rows 14, 3 and 16, and what-hides-between-sessions' A and B sit with row 3 (`survey-check-10.md`); the synthesis menu will merge them and count overlapping savings once |
| 207 | "**Failures that no single session can see** (a dead credential healed every 30 seconds for 11 hours, LIN-3181; a circular wait that idled a passage leg for 35 minutes, 1 October) suggest a principle: code detects, the model decides. The sixth wave sizes it." | …The sixth wave sized it: 107 incidents on record since June, 92 invisible to one session, a median 16 hours to discovery (3 where the onset is timed); six rules over held data caught 9 of 19 scored (two rules 7), a median 5 hours early, and raised alarms on about 40 real faults that are on no ticket. The cost is hours, not tokens: under 2% of tokens outside quiet wakes, and 42 hours of supervisors waiting on lost wakes in September (`what-hides-between-sessions.md` v2). Option A is the principle at its smallest |
| 208 | "**Every paper cited here has been checked by a second document.** `survey-check-9.md`, `survey-check-8.md` and `survey-check-7.md` checked the fifth wave's six papers." | …`survey-check-10.md` checked the sixth wave's `prototype-concepts.md` and `what-hides-between-sessions.md` |
| 245 | (the last evidence row, `survey-check-9`) | add three rows: `prototype-concepts` (v2), John's prototype concepts against the levers, and what a Lighthouse study costs and catches beside a Harbour ticket; `what-hides-between-sessions` (v2), the failures no single session sees, and what detectors over held data would have caught; `survey-check-10`, the independent check of the two papers above, and every figure it changed |

Unchanged and confirmed:
- Line 207's "for 11 hours" is the dead credential's life until it was cleared. The paper's "10
  hours" is from onset to filing. Both are right. Its "35 minutes" is the register's figure for
  the cycle's idle; the wait coding gives 62 minutes from the waiter's last turn. The two measure
  from different starts, and this check does not settle which the anchor should carry.
- Line 261's "a dead Linear credential re-selected every 30 seconds and reported as transient"
  matches LIN-3181's root-cause comment.
- Line 117's "the survey papers 10%" is what option D of prototype-concepts cites, correctly.

## Method

Both papers' scripts were re-run unchanged from the repository root of this branch. Each paper
had its author's `data/` snapshot copied in from the session workspace that made it, and the
outputs were diffed against those snapshots. Nothing was written to the authors' copies.

```sh
# what-hides-between-sessions, from the author's snapshot (data/survey-hides)
node scripts/survey-hides-analyse.mjs --dir data/survey-hides [--near]
node scripts/survey-hides-detect-sessions.mjs --in data/survey-hides
node scripts/survey-hides-code-waits.mjs --in data/survey-hides
node scripts/survey-hides-detect-runner.mjs --wake data/survey-hides/wake --out <dir>
node scripts/survey-hides-figures.mjs --in data/survey-hides/analysis.json --out <scratch>
# and fresh, into data/survey-hides-rerun: transcripts --since 2026-08-29, runner,
# survey-wake-extract.mjs --since 2026-08-29 --out <dir>/wake, detect-runner, detect-sessions,
# code-waits, analyse; then the same with sessions cut to a first turn before 2026-10-01T10:14Z
# prototype-concepts, from the author's snapshot (data/survey-protoconcepts)
node scripts/survey-protoconcepts-lighthouse.mjs
node scripts/survey-protoconcepts-harbour.mjs
node scripts/survey-protoconcepts-figures.mjs --out <scratch>
node scripts/survey-costmix-tokens.mjs --since 2026-09-01 --until 2026-10-01T10:00:00Z --out <dir>/tokens.json
node scripts/survey-protoconcepts-dollars.mjs --out <dir>/dollars.json
# this check: price rows (the dollars census, each message also tallied by row, session and week)
node scripts/survey-check-10-rows.mjs --out data/survey-check-10/mix.json
node scripts/survey-check-10-rows-analyse.cjs data/survey-check-10
```

- **Weighted tokens for Lighthouse** are estimates. Each study's frontier-row spend is divided by
  the median per weighted token of its 9 frontier dispatches with token records, and its top-tier
  review spend by that of its 3 review records.
- **The prototypes** were read with `git show <sha>:<path>` at the matrix's pins, so no checkout
  state matters.
- **The checks coding.** Every third (check, document) pair, 8 in all, was coded from the check's
  own text before the JSON was opened. The rest were read where a check draws its own line between
  load-bearing and secondary.
- **The alarm sample.** The definitions were written before any alarm was read. Each sampled alarm
  was read in the transcripts of the sessions it names and in the runner's oplog around it. The
  codes, with evidence lines, are in `survey-check-10-alarm-codes.json`.
- **The overlap with row 1** joins the 270 re-fire deliveries of `data/survey-hides/wake` to the
  layer of the session each entered. A quiet one is an outcome of none or read, and a supervisor is
  an autopilot, leg, stepper or Runner session.
- **Proxy.** Reads of the ticket and its brief, and nothing else. The only writes are this
  ticket's comment and status.

## Limits

- **Every reader shares a tier with the authors.** The re-runs and readings are independent of the
  authors' sessions, not of their model tier.
- **The data are the authors' snapshots.** A re-run proves that the scripts are deterministic over
  them, not that the snapshots were complete. The fresh extractions say the transcript and oplog
  snapshots were; the tracker snapshot was not re-taken.
- **The alarm sample is 33 of 93, coded by one reader with fixed definitions.** The interval on
  "about 40" is wide, 25–50, and the line between a real fault and a harmless blip is a judgement.
  *Bias:* a reader looking for faults may code a blip real, which runs the count **high**. Usage-limit
  stops count as real here; without them it is about 33.
- **"Load-bearing" by the checks' own word** depends on how carefully each check chose its words.
  The coding's count and this one bound the truth, at 23 and about 20.
- **The price rows are Lighthouse's table as read on 26 September.** List prices that changed
  within September would move the per-row figures. The finding that a population's price per
  weighted token follows its row, not its shape, holds at any prices.
- **Lighthouse's output estimate** is sized on Harbour's transcripts, not its own.
- **The anchor may move.** The lines are listed at `066232d6`; a later edit shifts them.

## Next

- **Does the scorecard's weighted unit hide September's change of frontier price row?** The weighted
  unit charges both frontier rows at 1, but per weighted token the newer row lists at about 0.55 of
  the older, and the fleet moved to it in the week of 22 September. Re-price September's cost per
  correct change by week at each session's own row, and say how much of any fall after 22 September
  the weighted series would credit to the process when it was the price. This goes into
  `proposals.md`.
- **Would D1 and D2 run live be worth reading?** The detector proposal already in `proposals.md`
  now carries this check's figures: D1 needs a duration or harm threshold, since its unrecorded
  bursts were nearly all harmless, and D2 needs its three-minute merge fixed and its completed
  waiters set apart before a shadow run's alarms are counted.
