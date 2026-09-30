# Harbour steady base: proportional effort, measured

*(The anchor for the steady-base work. It was written on 30 September 2026, during the V1 passage (LIN-3099), after a day of research John commissioned. It records what we learned, what that implies, what we intend and how it fits V1. The tracker holds live state; this page holds the scope and the results. Revise it by rewriting; git keeps the history. This version includes the third wave of research and the independent checks of the first two: `survey-check.md` and `survey-check-2.md` corrected several figures, and they are given here as corrected. The later papers are checked too: `survey-check-3.md` checked `why-throughput-halved.md` (now v3) and `which-rules-pay.md` (now v2), and `model-choice.md` re-derived the tier claim independently. `survey-check-4.md` then checked `model-choice.md`, `what-doubled-the-dispatches.md` and `proportional-process-backtest.md`; each is now at version 2.)*

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
   - Their September rise from 28% to 45% is **entirely the new passage layer** (the Runner and its legs). Without that layer, supervision was flat to falling (28%, 24%, 15% and 26% by week).
   - Median dispatches per ticket rose from 12 to 17 between July and September, 1.2–1.8× by size. Almost all of the rise is warm beats into sessions held open.
   - A docs- or tests-only ticket still costs about 77% of the median ticket's tokens. (`where-the-effort-goes.md` v2). On the backtest's census it used 64% of the median change's dispatches and 69% of its hours, and, held to its diff size, about the same dispatches as a production change.
3. **Three-quarters of supervision is bookkeeping.**
   - 77% of supervision tokens go to steps fully determined by observable state: taking delivery of a wake, reading a row, answering the runner's completion gate, noting progress. That is about **27% of the fleet's weighted tokens**. A fresh blind recode puts the share higher, at 86% (81–91%), though the share rests on the codebook calling gate replies and fetches mechanical.
   - Judgement is concentrated in judging a worker's report and writing the next beat, about a fifth of the bill.
   - **Nearly a third of wakes (31%) change nothing**, and they are 25% of the supervision bill. For the passage Runner, 94% of its wakes change nothing.
   - Much of the answering is already held in deterministic code (the completion gate, wake delivery, stall handling), and part of the Done gate is in code; how much is unmeasured.
   - **Supervisor failures are mechanical, not judgement:** 22 of the 25 on record were in mechanical actions, on a reading of each ticket, and 21 were bugs in code. (`what-supervisors-do.md` v2)
4. **This is why earlier fixes did not bend the curve.** Cheaper implementers and fewer generated tasks both worked on their targets. But implementation is about a quarter of the tokens, and the cheap tier carries under 0.1% of weighted units. An unworked ticket in the backlog costs almost nothing. The cost sits in supervision and checking, which are paid per ticket, per session and per wake, not per line changed.
5. **Reliability has held.**
   - LinearViewer's escaped-defect rate rose on paper, but September without review residue (faults the fleet's own reviews found in older code) is 5.7 per 100 merged PRs, against 5.4 in June.
   - simple-dispatcher's September is 27.3 per 100 without residue, within noise of June.
   - Review stops an estimated 35–45% of the bugs that are visible at all, concentrated in a few tickets: 22 real bugs in 9 tickets, mostly credential work.
   - Tickets that passed through more gates show no gradient in escaped defects.
   - Main is red on about 1% of pushes, and none of this year's three reverts was for a defect. (`reliability-baseline.md` v2)
6. **Effort barely follows risk, as far as we can tell.** At a fixed size, the data cannot show risk changing effort in either direction (intervals −8 to +14 dispatches). That is itself the finding: nothing in the process reliably sizes effort to risk.
7. **The tests mostly earn their keep. Their costs are friction, flakes and idling.**
   - Behavioural tests are 93% of Harbour's unit tests. On their own they kill most sampled logic mutants.
   - Pin-class tests (text pins, census pins, source scans) take about 5% of run time. As unit tests they turned CI red only twice since June; count pins inside browser specs did so three more times. They cost friction instead: pins demand bumps at least as often as they catch anything, on one or two catches a class, and about 18 tickets since June exist mainly to repair or bump a pin (about five are pure bumps).
   - The larger costs are elsewhere:
     - flaky browser specs are the biggest cause of red CI (unit-suite reds split evenly, 13 flakes and 13 real faults of 42);
     - 77% of the unit suite's serial time is spent outside any test;
     - **31% of it was four files idling about 25 seconds each on a timeout timer in `routes/proxy.js` that was never cleared**, costing 20–30 s of parallel wall-clock too. Fixed on 30 September (LIN-3158): the serial suite fell from 266 s to 175 s.
   - simple-dispatcher's mutation gate has two stale mutants and does not run in CI. (`test-estate.md` v2)
8. **Lessons accrue as prose and are rarely retired.**
   - 8 of the 10 tickets in the close-out lineage changed no runtime code.
   - 17 of 221 prompt-text commits left the text smaller.
   - "Merge and Done need a recorded Approve and a discharged ledger" is enforced only by prose. GitHub does enforce green CI.
   - Rule-bearing text is only about 3% of the context a session carries. The cost is in what the rules make agents do. (`steady-base.md` v2, `steady-base-check.md`)
9. **Harbour throws its own evidence away.** Dispatch history, prompt traces, the app-call log and local session transcripts are kept for 30 days. No token series before September can be rebuilt.
10. **Single-session runs suit research, not changes to the system.**
    - Eleven papers and checks landed on 29–30 September, each as one bounded session, and none changed the product.
    - Changes to Harbour itself go through Harbour's process. An agent that once skipped it took a week to clean up after.
11. **June was a different regime, not a lost level.** *(`why-throughput-halved.md` v3)*
    - A correct change kept its size: 70 production lines at the median in June, 67 later. Every size band halved.
    - Most of the fall is fewer merged tickets (113 to 65 a week), and the rest a lower correct, complete share (84% to 72%): four-fifths and a fifth on the weeks of 8 June to 5 July, two-thirds and a third on the three weeks wholly in June. More than half of the escape rise is finder rows (faults the fleet's own reviews found in older code).
    - It is almost all Harbour's (86 to 39 a week), and a third to two-fifths of it is UI work (27 to 7 a week). Product lines fell by a third while test lines rose, so a correct change now carries 2.5× the test lines.
    - The step lines up with 12 July (LIN-1285), when each dispatch began choosing its tier; frontier-written changes fell from 84 a week to 12. The tier switch is the only change dated to the step: the plan-review leg arrived two weeks later (26 July), and test lines and prompts ramped up through July rather than stepping.
    - The "four times the escapes" claim did not survive re-derivation; see point 13.
12. **A few rules and reviewer judgement do the catching.** *(`which-rules-pay.md` v2)*
    - In the last 100 reviewed Done tickets (11–29 September), 483 review and close-out findings led to 78 production-code changes in 28 tickets; 44 fixed real faults, in 18 tickets, and 24 of those were in three tickets.
    - Reviewer judgement that no rule names led the most (29 changes, 16 faults), then the class check (19, 12), verifying against the requirements (10, 7) and looking at the running result (6, 3). The counts stand, but which rule led each change is the soft call: a blind recode names the same lead rule 59–66% of the time, and the class check's 19 may be high by about a third. Only the class check and requirements clearly separate from the zero rules.
    - 16 of 24 rules led no production change, and 12 never appeared on one even as support. About a third of those are gates, where a gate that works leaves no change behind. For most of the rest (record-keeping, filing, tests) zero is the design, and three rules existed for only the last six days.
    - The mutation check led 107 findings, 97 of which changed only tests or wording, and about 36 of the 88 extra legs.
    - Tickets touching only simple-dispatcher got no production change from review.
13. **Model tier is not what raised the cost.** *(`model-choice.md` v2)*
    - Until 12 July every session ran at the frontier tier, whatever the dispatch asked. Seven routing changes since are dated from the runner's logs, and implementation also ran at frontier on 23–27 July.
    - For changes merged 13 July–30 August, a correct, complete change cost about the same whole-life working hours whether a frontier session implemented it (2.9–3.0 h) or a mid-tier one (3.2–3.3 h), within noise (ratio 0.91, 95% 0.70–1.21). The implementer is read from the runner's sessions, not commit trailers, and the hours include the rework each change caused.
    - Mid-tier changes do escape more often: 13 of 302 against none of 60 in those weeks (p = 0.09), and 16 of 517 against none of 129 to 21 September (p = 0.03). But rework adds only 0.1–0.3 hours per change, because an escape's fix costs a fraction of the process around the original ticket. A quarter (frontier) to three-fifths (mid) of it lands in the first week, and a fifth to a quarter after day 30.
    - **What moved cost per change was the process, not the tier.** At the 12 July step, dispatches per correct change rose about two-and-a-half-fold at both tiers (frontier 7.9 to 18.6, mid 8.1 to 21.0), with every follow-up charged to the session it entered. In September's provisional weeks they are 52 (frontier), 32 (mid) and 37 (cheap).
    - The cheap tier and all of September are provisional until their 30-day windows close.
14. **What raised the dispatches: wakes into held autopilots.** *(`what-doubled-the-dispatches.md` v2)*
    - Counting every dispatch, a correct code change took 7.6 dispatches in the fortnight before 12 July and 20.0 in the fortnight after, in both repos.
    - Between 5 and 12 July fresh sessions rose, with no mechanism found, and follow-ups rose as cold resumes of finished sessions, which is what LIN-1219 does (a finished session is closed and a follow-up resumes it cold). Follow-ups per held session rose from 16 July, lining up with LIN-1357 (a wake for every stepper beat).
    - Since August, fresh sessions have been flat at about 11 per correct change. **The growth is wakes:** 8, then 10, 16 and 18 per change, each wake charged to the session it entered (29 if charged to the child the log names). The late-September rise sits on the tickets a passage flew (41 wakes per correct change against 14 on the rest), and wakes per worker event rose from 1.19 to 1.40.
    - September's dispatches per correct change against the map, by the session entered: quiet wakes 7%, the passage layer 8%, supervision that acted 38% (a ceiling), review rounds after the first plus test and CI beats at most 10%, and **36% in no candidate row** (by the log's line: 10%, 15%, 34%, 9% and 32%). The remainder is planning, review and close-out legs (a fifth of them repeats; repeat plan-reviews outnumber first ones), stepper beats inside plan and implementation sessions, and cheap-tier sessions whose kind cannot be read.
15. **A lighter path for small work saves less than it looked.** *(`proportional-process-backtest.md` v2)*
    - Six size-and-risk rules were committed before any outcome was read, then run over 1,282 Done changes since June in both repos.
    - The docs-and-tests-only rule routes 11% of changes light, and none of its 89 mature light changes went wrong afterwards. The small-and-low-risk rule routes 26% light; 5 of its 249 went wrong (2 in 100).
    - The price: before merge, review caught real faults on 5 docs-only changes (parent tickets whose code shipped under children, a runbook, served prompt text) and 8 small low-risk ones, 13 of 17 on the merge-time groups at plan review.
    - A rule that reads only the ticket's text routes large, faulty changes light: 36 real faults were caught in its light group. Classification has to use the paths actually touched.
    - **Light work costs about half of heavy work because it is smaller;** held to the same diff size it takes about the same dispatches, so the process is not lighter on it today. The most a lighter process could save is what the light groups cost now: 13–18% of working hours and 21–30% of dispatches. The 77% was a per-ticket ratio, not a saving.
16. **Browser flakes are a few specs with three causes.** *(`browser-flakes.md`, unchecked)*
    - There were no flakes before CI went to two Playwright workers on 24 June. Since then at least 64 of 138 red E2E attempts were flakes.
    - Seven specs carry every flake with a known test; `observation`, `observation-rulings` and `dispatch-presets` carry two-thirds.
    - The causes are server-side state shared between workers (the `urlKey` isolation LIN-625 owns), waits that do not wait for what they check, and a computed style read too early.
    - They cost 38 red PR runs, 54 re-runs and about 7½ runner-hours. Retries hide more: 80% of sampled green runs passed a test only on an in-job retry.
17. **Every wake is minted in one place, and a third of them are relayed re-arms.** *(`wake-inventory.md`, unchecked)*
    - Harbour creates every wake at one point (`addFeedback`, when a child's feedback begins `[done]`, `[failed]`, `[blocked]` or `[pending]`). simple-dispatcher delivers it warm into a held Stop hook or by a cold resume, and adds its own completion gate and stall re-fires. CI and PR results reach a session only through its own polls.
    - In September, terminal wakes led to an action 94% of the time; pause wakes changed nothing 80% of the time. **1,749 wakes (38%) were a supervisor's own PENDING-EXTERNAL re-arm relayed to its parent, and 94% of those were quiet.**
    - So one worker event sends 1.6 wakes up the chain under a ticket autopilot and 3.0 inside a passage: 18.9 Harbour wakes per correct code change, 5.8 of them changing nothing. Wakes took 29% of tokens, quiet wakes 11%.
    - 18 of the 25 supervisor failures on record are on a wake path, and 9 of the 14 lost wakes were lost in the runner's delivery, not in Harbour's minting.

## What this implies

- **The largest saving is mechanical supervision, and it keeps every altitude.** About 27% of fleet tokens go to supervision steps that observable state fully decides. A supervisor keeps its role (context isolation, judgement of reports, the next beat) while code does the waiting, re-arming, polling, restating and gate-answering it does today in prose. The failure record points the same way: supervisors fail in the plumbing, not in judgement.
- **The wake plumbing is where the growth is.** Fresh sessions per change have been flat since August; wakes per change more than doubled (8 to 18 per correct change). Every wake is minted in one place, and 38% of them are a supervisor relaying its own "still waiting" upward, almost all quiet. How often supervisors are woken, and how far up each wake travels, is a narrower and more mechanical target than "the process".
- **Proportionality is a real but smaller lever.** Sized by the paths touched, a lighter path could save 13–18% of working hours (21–30% of dispatches) at a price of about 2 escapes in 100 light changes and some faults review now catches before merge. It must classify on code, not ticket text.
- **Reliability is steady, so the baseline is clean.** We are not fixing a quality problem. We are removing cost that quality does not depend on, and the scorecard will say if we are wrong.
- **Tests: fix the idling and the flakes first, loosen pins second.** The idling is fixed. The flakes are the biggest cause of red CI. The pins are friction, not run time.
- **Choosing cheaper models is not the lever.** Whole-life cost per change is about the same at frontier and mid tier; what raised dispatches per change about two-and-a-half-fold at the 12 July step, for every tier, was the process around the change. That is the process, which is where the map below aims.
- **Review's value is concentrated.** A few rules and reviewer judgement make the production catches, mostly on a few risky tickets. That supports sizing the process to the change, and it says which checks a lighter path must keep. The mutation check's test-only rounds are the clearest candidate cost.
- **Harbour changes itself through its own process,** measured against the baseline below.

## How we will measure it

The instrument is `scripts/survey-scorecard.mjs`, defined in `measuring-throughput.md`.
- **A change** is a ticket whose work merged and reached Done.
- **Correct** means no escaped Bug and no named fix commit points at it within 30 days.
- **Complete** means it filed none of its own work as a follow-up.
- **Throughput** is correct, complete changes per week, per fleet dispatch and per working hour. Process weight added or removed is recorded per change.

**Baseline:**
- about **47 correct, complete changes a week since mid-July** (95 a week in the weeks of 8 to 29 June, 86 in the three weeks wholly in June, 69 in June's calendar weeks; June was a different regime, see point 11);
- **26–49 dispatches and 2.7–3.7 working hours per correct change** (July's 4.4 counted other workspaces' sessions);
- 11–16M weighted tokens each in September.

**What a doubling looks like:** it shows first as **halved cost per correct change**. Over four weeks the instrument detects a 2.8× shift in dispatches per change or 2.0× in hours, so hours per change sees a doubling at about four weeks. The weekly count needs about eight weeks either side. A change counts as a saving only if cost per correct change falls and the correct rate holds.

## What we intend

**Short term: V1 first.**
- **V1 resumes on 1 October after the weekly reset,** exactly as it was parked (the resume notes are on LIN-3099). The structure doesn't change mid-passage.
- **John's rulings go in as standing context:** he is the sole user, so no legacy compatibility, flags or rollback scripts unless a ticket asks for them; and review rounds are fine while they converge.
- **Transcript retention:** done. John set Claude Code's `cleanupPeriodDays` to 36500 on the runner machine on 30 September.

**Long term: the steady-base epic,** after V1's build or at a point John chooses. It is planned like any passage, with its contents chosen from the map below.

## Effort-to-savings map

This is the input for planning the epic. Savings are shares of the fleet's weighted tokens unless stated. They are estimates from the papers, to be confirmed by the scorecard, and they overlap rather than add. Effort: S is about one ticket, M a few, L an epic of its own.

| # | Change | Evidence | Est. saving | Effort | Reliability risk and safety check |
|---|---|---|---|---|---|
| 1 | **Stop waking parents for "still waiting".** The runner already knows when a parent's children are live; stop delivering progress wakes that change nothing | 31% of wakes change nothing, 25% of the supervision bill (`what-supervisors-do` v2); 38% of wakes are relayed PENDING-EXTERNAL re-arms, 94% quiet; quiet wakes 11% of tokens (`wake-inventory`) | ~9–11%; quiet wakes are 7–10% of September's dispatches per change, by how a wake is charged (`what-doubled-the-dispatches` v2) | S–M | Missed or lost wakes are the most common supervisor failure (15 of 25); 18 of 25 failures are on a wake path, and 9 of 14 lost wakes were lost in the runner's delivery (`wake-inventory`). Wake-delivery tests; the scorecard's hours per change |
| 2 | **Put the passage layer's bookkeeping in code.** The Runner is 97% mechanical and 94% of its wakes change nothing; it is invoked only on events that need judgement | The Runner and legs account for all of September's supervision rise (`survey-check`); late September's wake rise is on the tickets a passage flew; one worker event sends 3.0 wakes up inside a passage against 1.6 under a ticket autopilot (`wake-inventory`); the passage layer is 8–15% of September's dispatches per change, by how a wake is charged (`what-doubled-the-dispatches` v2) | ~5–15% during passages | M | The Runner keeps its role and altitude; only its polling moves. Passage-level tests |
| 3 | **A deterministic conductor for the supervision cycle.** The completion gate, re-arming, restating and liveness clocks move into the runner and dispatch code that already hold the answers; model sessions keep judging reports and writing beats | 77% of supervision tokens mechanical (86% on a blind recode); much of the answering is already in code, how much unmeasured (`what-supervisors-do` v2, `survey-check-2`) | up to ~27% in total, including 1 and 2 | L | The largest change. Build in slices behind the scorecard; every altitude kept |
| 4 | **Fix the four idling test files** (the uncleared `withTimeout` timer). **Done, LIN-3158** | 31% of serial unit time (`test-estate` v2) | Serial unit suite 266 s → 175 s, plus 20–30 s of parallel wall-clock | S | None: the tests are unchanged |
| 5 | **Make the flaky browser specs and unit flakes robust** (never skip). Unit flakes done, LIN-3159 (a fixture clock race in `tree.test.js`); browser flakes next | Flakes are the biggest cause of red CI (`test-estate` v2); seven specs, three causes, none before two workers (`browser-flakes`) | Fewer reruns and red-CI rounds | S–M | Positive: flakes hide real failures |
| 6 | **Retire census pins in favour of an import-graph check** | About 18 tickets since June exist to repair or bump a pin, about five pure bumps; bumps at least match catches (`test-estate` v2, `fleet-complexity-read`) | Friction on every census change; the weekly rate is uncertain | S | Low. The import graph still guards drift |
| 7 | **Size the process to the change,** classified by code from the paths touched: docs- and tests-only work, then small low-risk changes, get a lighter path. Credentials, auth, migration and security keep the full process | A docs-only ticket costs ~77% of the median; nothing sizes effort to risk (`where-the-effort-goes`); production catches concentrate in a few risky tickets (`which-rules-pay`). Backtest: 11–26% of changes route light (`proportional-process-backtest`) | 13–18% of working hours and 21–30% of dispatches, at most. Light work is not already cheaper for its size | M | Medium: about 2 escapes in 100 light changes, and some pre-merge catches lost. Classify on paths touched, never ticket text; the correct rate per path |
| 8 | **Stop review rounds that change nothing.** Close-out finishes wording and test-only items; text-only fixes don't re-trigger review | On LIN-3131: 43% of wall-clock, ~26% of tokens, no production change (`fleet-complexity-read`). Across 100 tickets the mutation check led 97 test-or-wording changes and ~36 of 88 extra legs (`which-rules-pay` v2) | Per affected ticket, large | S | Low: CI still gates; the scorecard's correct rate |
| 9 | **Loosen text pins on prompt prose;** keep the pins on prompt branches | Prose pins caught 3 of 19 deleted lines; branch pins kill mutants (`test-estate`) | Friction on every prompt change | M | Low if branch pins stay |
| 10 | **Keep the evidence for the project's lifetime.** In progress, LIN-3157 (third of four phases) | Every series stops at 30 days | Enables measurement | S | None |
| 11 | **Freeze prompt sizes;** new lessons land as code first | Growth is steady; text is ~3% of carried context (`steady-base`) | Small directly; stops the ratchet | S | None |
| 12 | **Hygiene in simple-dispatcher:** the stale mutation gate, the gate not in CI, the test that fails on the fleet's own machine. **Done, LIN-3160** (three stale mutants re-anchored, 47/47; the AppleScript test needs iTerm2 running; the gate stays out of CI, as it needs a second checkout) | `test-estate` | Trust in the gates | S | Positive |

**Reading the map:**
- **Quick, reliability-neutral wins:** 4, 5, 6, 10 and 12. They run as ordinary tickets, and none changes how the fleet works. On 30 September John started 4, 5's unit flakes, 10 and 12; all but 10 are done.
- **The large, structural win:** 1–3. It is the heart of the epic, needs careful design, and keeps every altitude.
- **Proportionality:** 7 and 8. A real but smaller lever than first thought (13–18% of hours at most), best taken after the wake plumbing.
- **Unexplained:** 32–36% of September's dispatches per change sits in no row: planning, review and close-out legs (a fifth of them repeats), stepper beats inside plan and implementation sessions, and cheap-tier sessions whose kind cannot be read. Repeat legs are a candidate row of their own.

## How it fits V1

V1 is one person, one task, one proven merge (`docs/v1.md`). A stranger's task runs through this same pipeline, so the overhead is part of the product they experience. `docs/v1.md` lists "what a run should cost" as an open hypothesis, and the steady-base work is how Harbour answers it. The natural slot is between V1's dress rehearsal and the invited period: prove V1 works, then make it proportional before other people use it. The quick wins above can land sooner as ordinary tickets without touching V1's structure.

## Open questions

- **What is the right shape for Harbour's process,** not just a lighter version of today's? This needs John's thought as well as the data.
- **Should a change's cost include the wakes into the epics and Runner above it?** The answer moves September's figures by about a third (`survey-check-4.md`), so the scorecard needs one rule before the epic is measured.
- **Why do repeat plan-reviews outnumber first ones?** They are the largest named part of the unexplained remainder.
- **Which lessons behind today's rules are still earning their keep?** `which-rules-pay.md` gives the first firing record: 8 of 24 rules have led a production change. Rasmussen's warning applies: a defence's value is invisible until it is removed, and about a third of the zero rules are gates; for most of the rest, zero is the design.
- **Two papers are not yet checked by a second document:** `browser-flakes` and `wake-inventory`. The wake inventory should be checked before rows 1–3 are designed against it.

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
| [what-supervisors-do](papers/harbour/what-supervisors-do.md) (v2) | The supervision bill by action class: mechanical against judgement |
| [test-estate](papers/harbour/test-estate.md) (v2) | Which tests earn their keep, and what the rest cost |
| [measuring-throughput](papers/harbour/measuring-throughput.md) (v2) | The scorecard, its baseline, and what it can detect |
| [survey-check-2](papers/harbour/survey-check-2.md) | The independent check of the three papers above, and every figure it changed |
| [why-throughput-halved](papers/harbour/why-throughput-halved.md) (v3) | Why correct changes a week halved from June to July |
| [which-rules-pay](papers/harbour/which-rules-pay.md) (v2) | Which review and close-out rules have ever changed production code |
| [survey-check-3](papers/harbour/survey-check-3.md) | The independent check of the two papers above, and every figure it changed |
| [model-choice](papers/harbour/model-choice.md) (v2) | Who did the work at which tier since January, and each tier's whole-life cost per correct change |
| [what-doubled-the-dispatches](papers/harbour/what-doubled-the-dispatches.md) (v2) | What doubled dispatches per correct change at 12 July, and what kept them climbing |
| [proportional-process-backtest](papers/harbour/proportional-process-backtest.md) (v2) | How much past work a size-and-risk rule would have routed light, and what it would have let through |
| [survey-check-4](papers/harbour/survey-check-4.md) | The independent check of the three papers above, and every figure it changed |
| [browser-flakes](papers/harbour/browser-flakes.md) (unchecked) | Which browser specs flake, why, and what they cost |
| [wake-inventory](papers/harbour/wake-inventory.md) (unchecked) | Every path that wakes a supervisor, and what each wake leads to |
| Earlier: [ticket-record-and-quality](papers/harbour/ticket-record-and-quality.md), [review-loops](papers/harbour/review-loops.md), [what-the-reviews-checked](papers/harbour/what-the-reviews-checked.md), [cheap-implementer](papers/harbour/cheap-implementer.md), [tasks-generate-tasks](papers/harbour/tasks-generate-tasks.md) | The pieces that pointed this way first |

## Decisions

| Date | Decision |
|---|---|
| 29 Sep | Pause the V1 passage for the process review. |
| 30 Sep | Measure first; hold off on solutions until the lay of the land is known. |
| 30 Sep | Altitude is a requirement. No flattening of supervision layers; changes to Harbour go through Harbour's process. |
| 30 Sep | V1 resumes on 1 October as parked. The steady-base work is epic-shaped and planned with care, with ~2× throughput as the aim and measurement as the condition. |
| 30 Sep | Evidence is kept for the project's lifetime. |
| 30 Sep | Quick wins 4, 5 (unit flakes), 10 and 12 run tonight through Harbour's process. John approved LIN-3157's production retention pass, and delegated the index-drop yes to the Flight Companion after it reads the dry run. |
