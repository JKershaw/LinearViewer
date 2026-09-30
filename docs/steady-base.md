# Harbour steady base: proportional effort, measured

*(The anchor for the steady-base work. It was written on 30 September 2026, during the V1 passage (LIN-3099), after a day of research John commissioned. It records what we learned, what that implies, what we intend and how it fits V1. The tracker holds live state; this page holds the scope and the results. Revise it by rewriting; git keeps the history. This version includes the second wave of research and the independent check of the first: `survey-check.md` corrected several figures, and they are given here as corrected.)*

## Why this exists

John, 30 September: *"The ultimate measure is how good Harbour is at completing work correctly."* And: *"Ideally, simple tasks get simple processes, complex tasks scale up. And things are left better than they were when the task started."*

The prompt came mid-passage. John asked how large a task is these days, and whether the process is overcomplicated or the tasks legitimately take this long. An audit of three landed tickets gave the answer: an 8-line inert change took 41 dispatches and an hour, while the credential cutover's review caught about seven real bugs that CI missed. The fleet is careful where it matters and heavy everywhere else. The research that followed says why.

## What we learned

The evidence is in the documents listed at the end. Figures are as corrected by the independent checks.

1. **The part that changes the product stayed the same size, and everything around it grew.**
   - Net product code has held at about 2,800 lines a week since the fleet started on 1 June.
   - Since then, test lines grew 10.6×, production comment lines 7.1×, and comment words per ticket went from about 1,600 to 6,000–7,500.
   - One unit-suite pass in CI takes 8–10× longer.
   - The fastest-growing code is the fleet's own machinery: Harbour's dispatch and fleet code grew 10×, and simple-dispatcher's hook and state machine 13×.
   - Process outgrows product from every starting week and under every definition tried. (`growth-atlas.md` v2)
2. **Most of a ticket's cost is fixed overhead, and most of that overhead is supervision.**
   - The supervision layers take 35% of the fleet's weighted tokens: the passage Runner, its legs, steppers, a ticket's own autopilot, and wakes.
   - Their September rise from 28% to 45% is **entirely the new passage layer** (the Runner and its legs). Without that layer, supervision was flat at 26–28%.
   - Median dispatches per ticket rose from 12 to 17 between July and September, 1.2–1.8× by size. Almost all of the rise is warm beats into sessions held open.
   - A docs- or tests-only ticket still costs about 77% of the median ticket's tokens. (`where-the-effort-goes.md` v2)
3. **Three-quarters of supervision is bookkeeping.**
   - 77% of supervision tokens go to steps fully determined by observable state: taking delivery of a wake, reading a row, answering the runner's completion gate, noting progress. That is about **27% of the fleet's weighted tokens**.
   - Judgement is concentrated in judging a worker's report and writing the next beat, about a fifth of the bill.
   - **A third of wakes change nothing**, and they are 30% of the supervision bill. For the passage Runner it is 94% of its wakes.
   - Most of the answers are already held in deterministic code in one repo or the other. Prose asks the model to hold them again.
   - **Supervisor failures are mechanical, not judgement:** 24 of the 26 on record were in mechanical actions, and 21 of those were bugs in the plumbing. (`what-supervisors-do.md`)
4. **This is why earlier fixes did not bend the curve.** Cheaper implementers and fewer generated tasks both worked on their targets. But implementation is about a quarter of the tokens, and the cheap tier carries under 0.1% of weighted units. An unworked ticket in the backlog costs almost nothing. The cost sits in supervision and checking, which are paid per ticket, per session and per wake, not per line changed.
5. **Reliability has held.**
   - LinearViewer's escaped-defect rate rose on paper, but September without review residue (faults the fleet's own reviews found in older code) is 5.7 per 100 merged PRs, against 5.4 in June.
   - simple-dispatcher's September is 27.3 per 100 without residue, within noise of June.
   - Review stops an estimated 35–45% of the bugs that are visible at all, concentrated in a few tickets: 22 real bugs in 9 tickets, mostly credential work.
   - Tickets that passed through more gates show no gradient in escaped defects.
   - Main is red on about 1% of pushes, and none of this year's three reverts was for a defect. (`reliability-baseline.md` v2)
6. **Effort barely follows risk, as far as we can tell.** At a fixed size, the data cannot show risk changing effort in either direction (intervals −8 to +14 dispatches). That is itself the finding: nothing in the process reliably sizes effort to risk.
7. **The tests mostly earn their keep. Their costs are friction, flakes and idling.**
   - Behavioural tests are 93% of Harbour's unit tests and make nearly all the catches that matter.
   - Pin-class tests (text pins, census pins, source scans) take about 5% of run time and turned CI red only twice since June. They cost friction instead: in sessions a pin demanded a bump about as often as it preceded a fix, and 18 tickets since June exist mainly to bump one.
   - The larger costs are elsewhere:
     - flaky browser specs are the biggest cause of red CI;
     - 77% of the unit suite's serial time is spent outside any test;
     - **31% of it is four files idling about 25 seconds each on an open keepalive handle.**
   - simple-dispatcher's mutation gate has two stale mutants and does not run in CI. (`test-estate.md`)
8. **Lessons accrue as prose and are rarely retired.**
   - 8 of the 10 tickets in the close-out lineage changed no runtime code.
   - 17 of 221 prompt-text commits left the text smaller.
   - "Merge and Done need a recorded Approve and a discharged ledger" is enforced only by prose. GitHub does enforce green CI.
   - Rule-bearing text is only about 3% of the context a session carries. The cost is in what the rules make agents do. (`steady-base.md` v2, `steady-base-check.md`)
9. **Harbour throws its own evidence away.** Dispatch history, prompt traces, the app-call log and local session transcripts are kept for 30 days. No token series before September can be rebuilt.
10. **Single-session runs suit research, not changes to the system.**
    - Eleven papers and checks landed on 29–30 September, each as one bounded session, and none changed the product.
    - Changes to Harbour itself go through Harbour's process. An agent that once skipped it took a week to clean up after.

## What this implies

- **The largest saving is mechanical supervision, and it keeps every altitude.** About 27% of fleet tokens go to supervision steps that observable state fully decides. A supervisor keeps its role (context isolation, judgement of reports, the next beat) while code does the waiting, re-arming, polling, restating and gate-answering it does today in prose. The failure record points the same way: supervisors fail in the plumbing, not in judgement.
- **Proportionality is the second lever.** A docs-only ticket costs three-quarters of a median one, and nothing sizes effort to risk.
- **Reliability is steady, so the baseline is clean.** We are not fixing a quality problem. We are removing cost that quality does not depend on, and the scorecard will say if we are wrong.
- **Tests: fix the idling and the flakes first, loosen pins second.** The idling is pure waste. The flakes are the biggest cause of red CI. The pins are friction, not run time.
- **Harbour changes itself through its own process,** measured against the baseline below.

## How we will measure it

The instrument is `scripts/survey-scorecard.mjs`, defined in `measuring-throughput.md`.
- **A change** is a ticket whose work merged and reached Done.
- **Correct** means no escaped Bug and no named fix commit points at it within 30 days.
- **Complete** means it filed none of its own work as a follow-up.
- **Throughput** is correct, complete changes per week, per fleet dispatch and per working hour. Process weight added or removed is recorded per change.

**Baseline:**
- about **47 correct, complete changes a week since mid-July** (95 a week in June; why it halved is an open question);
- **26–49 dispatches and 2.7–4.4 working hours per correct change**;
- 11–16M weighted tokens each in September.

**What a doubling looks like:** it shows first as **halved cost per correct change**. The instrument detects a 1.4× shift in dispatches per change, or 1.3× in hours, within four weeks. The weekly count needs about eight weeks either side. A change counts as a saving only if cost per correct change falls and the correct rate holds.

## What we intend

**Short term: V1 first.**
- **V1 resumes on 1 October after the weekly reset,** exactly as it was parked (the resume notes are on LIN-3099). The structure doesn't change mid-passage.
- **John's rulings go in as standing context:** he is the sole user, so no legacy compatibility, flags or rollback scripts unless a ticket asks for them; and review rounds are fine while they converge.
- **John sets the transcript retention** on the runner machine: Claude Code's `cleanupPeriodDays`.

**Long term: the steady-base epic,** after V1's build or at a point John chooses. It is planned like any passage, with its contents chosen from the map below.

## Effort-to-savings map

This is the input for planning the epic. Savings are shares of the fleet's weighted tokens unless stated. They are estimates from the papers, to be confirmed by the scorecard, and they overlap rather than add. Effort: S is about one ticket, M a few, L an epic of its own.

| # | Change | Evidence | Est. saving | Effort | Reliability risk and safety check |
|---|---|---|---|---|---|
| 1 | **Stop waking parents for "still waiting".** The runner already knows when a parent's children are live; stop delivering progress wakes that change nothing, and stop prompts asking for polling on top of push wakes | A third of wakes change nothing, 30% of the supervision bill (`what-supervisors-do`) | ~10% | S–M | Missed or lost wakes are the most common supervisor failure (12 of 26). Wake-delivery tests; the scorecard's hours per change |
| 2 | **Put the passage layer's bookkeeping in code.** The Runner is 97% mechanical and re-arms on 94% of its wakes; it is invoked only on events that need judgement | The Runner and legs account for all of September's supervision rise (`survey-check`) | ~5–10% during passages | M | The Runner keeps its role and altitude; only its polling moves. Passage-level tests |
| 3 | **A deterministic conductor for the supervision cycle.** The completion gate, re-arming, restating and liveness clocks move into the runner and dispatch code that already hold the answers; model sessions keep judging reports and writing beats | 77% of supervision tokens mechanical; the answers are already in code (`what-supervisors-do`) | up to ~27% in total, including 1 and 2 | L | The largest change. Build in slices behind the scorecard; every altitude kept |
| 4 | **Fix the four idling test files** (the open keepalive handle) | 31% of serial unit time (`test-estate`) | Suite time, not tokens: up to about a third of serial unit time | S | None: the tests are unchanged |
| 5 | **Make the flaky browser specs and unit flakes robust** (never skip) | Flakes are the biggest cause of red CI (`test-estate`) | Fewer reruns and red-CI rounds | S–M | Positive: flakes hide real failures |
| 6 | **Retire census pins in favour of an import-graph check** | 18 bump-only tickets since June, 10 in September; no CI catch on record (`test-estate`, `fleet-complexity-read`) | ~2–3 tickets a week of bump work | S | Low. The import graph still guards drift |
| 7 | **Size the process to the change,** classified by code from the paths touched: docs- and tests-only work, then small low-risk changes, get a lighter path. Credentials, auth, migration and security keep the full process | A docs-only ticket costs ~77% of the median; nothing sizes effort to risk (`where-the-effort-goes`) | Large per light ticket; total depends on the mix | M | Medium: a mis-sized ticket skips a check. Code-based classification; the correct rate per path |
| 8 | **Stop review rounds that change nothing.** Close-out finishes wording and test-only items; text-only fixes don't re-trigger review | On LIN-3131: 43% of wall-clock, ~26% of tokens, no production change (`fleet-complexity-read`) | Per affected ticket, large | S | Low: CI still gates; the scorecard's correct rate |
| 9 | **Loosen text pins on prompt prose;** keep the pins on prompt branches | Prose pins caught 3 of 19 deleted lines; branch pins kill mutants (`test-estate`) | Friction on every prompt change | M | Low if branch pins stay |
| 10 | **Keep the evidence for the project's lifetime** | Every series stops at 30 days | Enables measurement | S | None |
| 11 | **Freeze prompt sizes;** new lessons land as code first | Growth is steady; text is ~3% of carried context (`steady-base`) | Small directly; stops the ratchet | S | None |
| 12 | **Hygiene in simple-dispatcher:** the stale mutation gate, the gate not in CI, the test that fails on the fleet's own machine | `test-estate` | Trust in the gates | S | Positive |

**Reading the map:**
- **Quick, reliability-neutral wins:** 4, 5, 6, 10 and 12. They can run as ordinary tickets whenever John chooses, and none changes how the fleet works.
- **The large, structural win:** 1–3. It is the heart of the epic, needs careful design, and keeps every altitude.
- **Proportionality:** 7 and 8. It comes next, once the scorecard is running.

## How it fits V1

V1 is one person, one task, one proven merge (`docs/v1.md`). A stranger's task runs through this same pipeline, so the overhead is part of the product they experience. `docs/v1.md` lists "what a run should cost" as an open hypothesis, and the steady-base work is how Harbour answers it. The natural slot is between V1's dress rehearsal and the invited period: prove V1 works, then make it proportional before other people use it. The quick wins above can land sooner as ordinary tickets without touching V1's structure.

## Open questions

- **What is the right shape for Harbour's process,** not just a lighter version of today's? This needs John's thought as well as the data.
- **Why did correct, complete changes fall from 95 a week in June to about 47 from mid-July?** Is June an early burst, a change in ticket size, or a real loss? (`measuring-throughput.md`)
- **Which lessons behind today's rules are still earning their keep?** The firing record for the review and close-out rules is proposed in `proposals.md`. Rasmussen's warning applies: a defence's value is invisible until it is removed.
- **The research papers themselves are unreviewed by a second document for this wave:** `what-supervisors-do`, `test-estate` and `measuring-throughput`. Their numbers should be checked before the epic is sized on them.

## The evidence

| Document | What it contributes |
|---|---|
| [fleet-complexity-read](papers/harbour/fleet-complexity-read.md) | Three tickets audited: the heavy process on small work, and review's value on the credential cutover |
| [steady-base](papers/harbour/steady-base.md) (v2) and [check](papers/harbour/steady-base-check.md) | Growth of prompt text and gate rules; rules as prose; what enforces what |
| [paid-where-written](papers/harbour/paid-where-written.md) (v2) and [check](papers/harbour/paid-where-written-check.md) | The argument: every fix is paid where it is written, and where that argument is weak |
| [growth-atlas](papers/harbour/growth-atlas.md) (v2) | Everything that grew since January, drawn |
| [where-the-effort-goes](papers/harbour/where-the-effort-goes.md) (v2) | The anatomy of a ticket's effort; proportionality to size and risk |
| [reliability-baseline](papers/harbour/reliability-baseline.md) (v2) | Escaped defects, review catches and main-branch health, since January |
| [survey-check](papers/harbour/survey-check.md) | The independent check of the three papers above, and every figure it changed |
| [what-supervisors-do](papers/harbour/what-supervisors-do.md) | The supervision bill by action class: mechanical against judgement |
| [test-estate](papers/harbour/test-estate.md) | Which tests earn their keep, and what the rest cost |
| [measuring-throughput](papers/harbour/measuring-throughput.md) | The scorecard, its baseline, and what it can detect |
| Earlier: [ticket-record-and-quality](papers/harbour/ticket-record-and-quality.md), [review-loops](papers/harbour/review-loops.md), [what-the-reviews-checked](papers/harbour/what-the-reviews-checked.md), [cheap-implementer](papers/harbour/cheap-implementer.md), [tasks-generate-tasks](papers/harbour/tasks-generate-tasks.md) | The pieces that pointed this way first |

## Decisions

| Date | Decision |
|---|---|
| 29 Sep | Pause the V1 passage for the process review. |
| 30 Sep | Measure first; hold off on solutions until the lay of the land is known. |
| 30 Sep | Altitude is a requirement. No flattening of supervision layers; changes to Harbour go through Harbour's process. |
| 30 Sep | V1 resumes on 1 October as parked. The steady-base work is epic-shaped and planned with care, with ~2× throughput as the aim and measurement as the condition. |
| 30 Sep | Evidence is kept for the project's lifetime. |
