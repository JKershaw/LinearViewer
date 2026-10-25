---
title: When a plan keeps failing review, does unwedging beat breakdown?
kind: paper
version: 1
date: 2026-10-25
authors: [Claude]
model: claude-haiku-5-5, claude-code; effort is not recorded in the brief this session ran from
grounded_at: ea4c6f88
cites: [lib/recommendation-facts.js@ea4c6f88:373-439, docs/papers/harbour/root-task-ratio.md@ea4c6f88:71-77, docs/papers/harbour/tasks-generate-tasks.md@ea4c6f88:83-84, docs/papers/standard.md@ea4c6f88, LIN-3932 (2026-10-25, description and research comment e570a743), LIN-2720 (comments 2026-09-10 17:46 to 2026-09-11 08:19), LIN-2735 (2026-09-10 21:01), LIN-2631 (2026-09-05 08:27), LIN-3833 (2026-10-25), LIN-3886 (2026-10-24), LIN-1603 (commit 7f1efdb8, 2026-07-26), LIN-3300 (commit 0dd3c99e, 2026-10-05), LIN-3651 (commit 69991b3e, 2026-10-18), simple-dispatcher PR #230 (2026-09-11)]
---

# When a plan keeps failing review, does unwedging beat breakdown?

The record cannot tell, and not because unwedging never happens. A census of 2,429 tickets
(LIN-1500 to LIN-3932) finds one clean unwedge. LIN-2720's plan went round plan-review twice
and stopped; John ruled that a refactor should land first; LIN-2735 was filed as its blocker,
finished, and LIN-2720 was re-planned on top of it and built. That is one case, and its blocker
was the refactor its research had already called for, so it is as much a refactor-required
prerequisite filed late as a new practice (Findings). Breakdown has
68 units and 424 children to be weighed against it, and no comparison of cost or correctness
between the two can be drawn from one. The research spike's expectation of zero was wrong on
the record as it now reads, but the answer is still not there: a 20-case trial, measured on
the same terms as breakdown, is what would settle it (Next). Version 1 is unchecked.

## Findings

**The plan loop stops more often than the rulings record shows.** Replaying the router's own
verdict counter over every ticket, under the loop rule in force on each verdict's date, gives
116 stops from 26 July on: 94 under the one-cycle rule, 14 under the bound of three, and 8 under
the ceiling of five. The rulings store starts on 25 September and so holds only the 41 stops
since then. The replay recovers 22 of the research spike's 24 tickets and adds 19 more; the
other two (LIN-3102 and LIN-3142) have verdict comments the counter does not read as verdicts
(6 of 682 verdict-headed comments, 0.9%). Rule-coded, the next moves after the 116 stops are:
64 built with no ruling, 16 built after a ruling, 21 breakdown, 6 child filed that is not a
carve, 6 stalled, 2 cancelled, and 1 unwedge (LIN-2720). Of the research's 24 codes, 22 agree.

**Breakdown's record is large and mixed.** 68 units are breakdown cases: 23 with a breakdown
session in /cost, 57 with a parent whose child carries the carve rule of root-task-ratio.md,
and 12 with both. Their 424 children reached 307 Done, 26 Cancelled, 3 Duplicate and 87 never worked
(63 Backlog and 24 Todo); one child, LIN-675, lies below the census range and was not read. Six umbrella tickets are Cancelled, 42 carry a
close-out comment, and 17 have a child never worked. Session cost is known for 37 of the 68
units, mostly from LIN-2750 on: their median is 20 sessions excluding wake and autopilot, with
a median of 5 children. The earlier papers cover this ratio and the never-worked pile; this
paper cites them and does not recount them.

**Unwedging: one strict case, and a loose upper bound of eight.** The strict reading (the
blocker is filed between the blocked task's first plan and its first implementation, and is
Done before that implementation starts) finds one pair, LIN-2720 blocked by LIN-2735. LIN-2720
was planned at 17:46 on 10 September, sent back by plan-review at 17:59 and again at 20:19,
which is the one-cycle stop. John's ruling, which the ticket records as "Worth a refactoring in
advance.", was applied at 21:02, and LIN-2735 was filed at 21:01. LIN-2735 was Done at 03:02 on
11 September. LIN-2720's Revision 3 was planned on the landed seam, approved at 06:54, and built
from simple-dispatcher PR #230 at 07:13 on 11 September. The size of that build is not
measured here: its PR is in another repository (Limits).

**Refactor-required prerequisites (LIN-397) are a neighbour, not the same thing.** The census
finds 11 tickets with LIN-397-style refactor-required titles (6 of the research's 8 seeds match
by title). Such a ticket is filed by the plan stage from a research verdict, before any
plan-review; an unwedge is filed after plan-review stops, from its findings. LIN-2720 sits on the
border: its blocker is the refactor that its research had already called for, as the ruling
comment says ("The refactor research named as `Surface Assessment: refactor required` ... is
done FIRST, as its own ticket that blocks this one"), executed only after the loop stopped, by
ruling. So the one strict case is as much a refactor-required prerequisite filed late as a new
practice.

The loose reading, which takes the
first PR link posted after the plan as the start of implementation, finds eight pairs over six
blocked tasks. Seven of them are the Flight Companion cluster of 5 September, in which
LIN-2631 (whose opening reads "Filed 2026-09-05 as a blocking subtask from plan-review findings"), LIN-2632
and LIN-2661 block LIN-2620 to LIN-2625. That cluster is the shape the ticket describes, but
its dates come from close-out and PR-open comments, which post after implementation starts, so
the window is too wide, and one of its pairs (LIN-2625) is dated from a mention of another
ticket's PR. It is a candidate, not a case. The pre-plan prerequisite class is common by
comparison: 61 pairs over 40 blocked tasks, 49 of them with the blocker outside the blocked
task's parent. Sibling pairs created within ten minutes of each other, 307 over 232 tasks, are
breakdown ordering and are excluded.

**Plan-review bound and ceiling cases.** Under the bound of three (5 to 17 October), 14 stops
followed: 10 built (3 after a ruling), 3 breakdown, and 1 child filed. The 10 builds took a
median of 11 sessions (range 10 to 17), and the stops brought 55 follow-on tickets, one of them
titled as a fault. Under the ceiling of five (from 18 October), 8 stops followed: all 8 built, 6
after a ruling and 2 after an Approve (LIN-3285 and LIN-3423). Those builds took a median of 14
sessions (range 10 to 18), with 7 follow-ons and none titled as a fault. Breakdown took three of
the bound-era stops: LIN-2954 and LIN-3332 completed, and LIN-3519 was Cancelled. The loop ceiling
sent no stop to breakdown.

**LIN-3833, the live case, has not unwedged.** Its replayed stop is at 09:19 on 25 October
(ceiling era, count three, not converging). It built under ruling `8a63520f` at 10:32, with no
PR at this read. Its only blocker is LIN-3886, finished at 08:32 that morning and filed before
its first plan, so it is a pre-plan prerequisite and not an unwedge. At the live re-read (about
12:45 UTC on 25 October) it was still In Progress, with 30 comments, and it had gained no
blocks relation; it had since had a review (12:16) and a second implementation session (12:44).
It has not unwedged.

**The comparator cannot tell.** A same-size, same-month control for the 37 cost-known breakdown
units would need built single tickets with telemetry in the same change-size band. Those pools
hold 0 to 14 tickets per unit, and the one month with a pool of fourteen (October) has a median
of 12.5 sessions against the units' 20. The units are groups of tickets and the pool is single
tickets, so even that gap is not a comparison. The table is printed for transparency
(`unwedge-or-breakdown-results/03-comparator.txt`), not as a measurement.

## Method

**Population.** Every ticket number from LIN-1500 to LIN-3932: 2,433 numbers, of which 2,429
resolve. Four return "Could not find referenced Issue" (LIN-2173, LIN-2174, LIN-3652, LIN-3653).
The range starts at LIN-1500 because the first loop rule (one-cycle, 26 July) applies from
there, and the ticket asks for the record since then.

**Reading.** `unwedge-or-breakdown-scripts/fetch.py` makes two read-only GETs per number against
the Workspace API Proxy: `/issues/{id}` and `/cost/{id}`. It is paced at 1.12 seconds per call
under the proxy's 60-a-minute limit, and writes a per-ticket cache outside the repository
(not committed). About 4,850 calls were made, all on 25 October. The
data written into the repository is the derived table `unwedge-or-breakdown-data/census.json`,
built by `census.mjs` from the cache.

**Loop rule, replayed.** `classify.mjs` (`eraOf`, `replayFirstStop`) checks the rule at each
verdict against the verdicts so far, using `assemblePlanReviewFacts` and `reviewLoopStop` from
`lib/recommendation-facts.js`, so the count equals the router's by construction. The eras
start at the commits that introduced them: 26 July (`7f1efdb8`, LIN-1603, a second
Request Changes escalates, which was prose in the operating manual, not code), 5 October
(`0dd3c99e`, LIN-3300, a bound of three in code), and 18 October (`69991b3e`, LIN-3651, a
converging plan gets up to a ceiling of five). The first stop is the first verdict that meets
the rule of its era. A ticket with no verdicts has no stop.

**Breakdown.** B1 is a `/cost` session of kind `breakdown`. B2 is a parent with at least one
child that passes the carve rule of `root-task-ratio.md` (`carveChild`): a parent link and an
opening within the first 400 characters that announces the carve.

**Unwedge.** A candidate is an inverse `blocks` relation: Y blocks X. Relations carry no
timestamp, so Y's `createdAt` is the filing date. X's first plan is the first `plan` session in
`/cost`, or otherwise the earliest comment with a Plan heading, a plan-review verdict or a plan
note. X's first implementation is the first `implementation` or `breakdown` session, or
otherwise the first comment that says "implemented" and links a PR (strict reading). The loose
reading takes the first PR link posted after the plan. `classifyBlocker` checks, in order:
own child, same-parent sibling created within ten minutes, before the first plan (P), after the
first implementation, not Done before it, and otherwise U. Each class is tested against
fixtures in `tests/unit/unwedge-census-classify.test.js` (17 tests). The positive control, a
blocker filed and finished between plan and implementation, must return U. Breaking that return
makes the control fail; restoring it returns all 17 to passing.

**Next moves.** `code-next-moves.mjs` codes each stop by rule, in precedence: breakdown (a
breakdown session, or a carve child filed after the stop), child filed, cancelled, built (a PR
link or implementation session, with "after ruling" if a ruling follows), stalled (still open),
closed unbuilt. One move the rule cannot see is hand-coded in the same file with its basis: LIN-2720
(a ruling-directed blocker, finished before the build).

**Sizes and sessions.** `sizebands.mjs` sums insertions and deletions from `git log --shortstat`
over every commit that names a ticket, the same as `--grep` per ticket, in one pass. Bands are
those of `how-a-task-is-composed.md`: small up to 200 lines, mid to 612, large above. Sessions
exclude `wake` and `autopilot`, the kinds the cost endpoint records for the stepper and not for
the work.

**Breakdown children.** A child's state type gives its outcome: `completed` is Done, `canceled`
is Cancelled, and `backlog`, `unstarted` or `triage` is never worked. Follow-ons use the
generator rule of `tasks-generate-tasks.md`: the parent, else the first `LIN-nnnn` in the
opening 400 characters. A fault is a follow-on whose title contains fix, bug, regression or
fault.

**Scripts and outputs.** `docs/papers/harbour/unwedge-or-breakdown-scripts/`: `fetch.py`,
`classify.mjs`, `census.mjs`, `stop-features.mjs`, `code-next-moves.mjs`, `sizebands.mjs`,
`analyse.mjs`. Derived data: `unwedge-or-breakdown-data/` (`census.json`, `sizes.json`,
`next-moves.json`). Tables that the text reads from: `unwedge-or-breakdown-results/`, one file
per table. Re-running them against the session's cache reproduces every table byte for byte (checked at
review); a fresh fetch has not been re-run, and live tickets may have moved since 25 October. The
cache itself is not committed.

## Limits

- **Session telemetry is recent.** `/cost` has sessions for 590 tickets, mostly from about
  LIN-2750 on, and marks 1,839 as having no lineage. Session counts and cost therefore exist for
  37 of 68 breakdown units. Older units are measured by their comments, and their session counts
  are missing rather than zero.
- **Relations have no timestamps.** Y's `createdAt` stands in for the filing date. A blocker
  created as a stub and developed later would be dated early.
- **Comment dates are posting times.** The comment reading brackets the implementation start
  from above (PR-open and close-out comments post late), so the loose reading over-counts U,
  and the strict reading, which needs an "implemented" comment, under-counts it. Neither is a
  measurement of when work started.
- **The counter misses some verdicts.** Six of 682 verdict-headed comments are read as zero
  verdicts, including two on LIN-3102 and LIN-3142, so the replay has no stop for either. The
  router misses them too, so the replay is faithful to the router, and the research's rulings
  record is the other reading.
- **The one-cycle rule was prose.** The replay treats a second Request Changes as the stop. Whether
  the team escalated is what the next-move code reads, not what the replay assumes.
- **Next moves are rule-coded.** "Built" includes built after an Approve (LIN-3285 and LIN-3423
  each have one before their build). "Child filed" can hide breakdown children whose openings
  miss the carve patterns, which under-counts breakdown.
- **The carve patterns are a transcription.** They are the list in `root-task-ratio.md`, with its
  `S1…` pattern matched as a bare `S` and a digit, so it is looser than the rest.
- **Sizes come from this repository only.** LIN-2720's PR is in `simple-dispatcher`, so its size
  is unmeasured. LIN-3833 has no merged commit yet. A unit's size is the sum of its tickets'
  commits, and a commit naming two tickets counts for both.
- **Follow-ons are blind to unnamed faults.** A fault filed without naming its parent in the
  opening is not counted, which under-counts both breakdown and build arms.
- **The dispatch list is not used for counts.** It is capped at 100 rows per ticket with no paging,
  so counts come from `/cost`, which joins lineages.

## Next

Settle the question with a trial, and keep unwedging beside breakdown rather than replacing it
until the trial is in. The stage would need a trigger, a bound, and a rule for choosing the small
task:

- **Trigger:** a plan-loop stop as `reviewLoopStop` returns it today (`'not-converging'` at three
  without narrowing, or `'ceiling'` at five) whose blocking findings all name one seam, as in LIN-3833's last two
  rounds. Session fit, not the loop, is still breakdown's trigger.
- **Bound:** one or two small tasks, then one re-plan on the landed seam, then the existing
  bounds apply again.
- **Choice:** the seam the blocking findings name. The plan-review findings 2620-F2, 2620-F6, 2622-F1 and
  2625-F1 all needed one refactor (the opening of LIN-2631), so the Flight Companion turn core
  is the first candidate for a trial of this rule.

Measure it on the next 20 single-seam stops against same-band stops that built after a ruling
(the control): sessions to Done, review and plan-review rounds, follow-ons, and faults found later
by the rule in `tasks-generate-tasks.md`. Record each small task's PR and Done time, so that the
strict reading of its unwedge can be checked, not inferred. Run the same census on the trial's
tickets and report the strict and loose readings side by side.

