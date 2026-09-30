# Harbour steady base: proportional effort, measured

*(The anchor for the steady-base work. It was written on 30 September 2026, during the V1 passage (LIN-3099), after a day of research John commissioned. It records what we learned, what that implies, what we intend and how it fits V1. The tracker holds live state; this page holds the scope and the results. Revise it by rewriting; git keeps the history.)*

## Why this exists

John, 30 September: *"The ultimate measure is how good Harbour is at completing work correctly."* And: *"Ideally, simple tasks get simple processes, complex tasks scale up. And things are left better than they were when the task started."*

The prompt came mid-passage. John asked how large a task is these days, and whether the process is overcomplicated or the tasks legitimately take this long. An audit of three landed tickets gave the answer: an 8-line inert change took 41 dispatches and an hour, while the credential cutover's review caught about seven real bugs that CI missed. The fleet is careful where it matters and heavy everywhere else. The research that followed says why, and says it is not a matter of taste.

## What we learned

The evidence is in the documents listed at the end.

1. **The piece of work that changes the product has stayed the same size. Everything around it grew.**
   - Net product code has held at about 2,800 lines a week since the fleet started on 1 June: 24–41 production lines per finished ticket.
   - Over the same period:
     - test lines grew 10.6×, and one unit-suite pass takes 8× longer;
     - text pins grew 12.2×;
     - production comment lines grew 7.1×;
     - comment words per ticket went from about 1,600 to 6,000–7,500.
   - The fastest-growing code is the fleet's own machinery: Harbour's dispatch and fleet code grew 10×, and simple-dispatcher's hook and state machine 13×. (`growth-atlas.md`)
2. **A ticket's cost is mostly fixed overhead, not the change.**
   - **Dispatches doubled for the same work.** Median dispatches per ticket doubled at every size of change, from 8 in July to 17 in September, while working time stayed near 1.5 hours.
   - **Sessions mostly wait:** 72% of session time is waiting, up from 28% in July.
   - **Supervision grew; implementation shrank.** Across September, the supervision layers went from 28% to 45% of weighted tokens and implementation fell from 28% to 18%. Checking (plan-review, review and close-out) is about a quarter.
   - **Size barely moves cost.** A docs- or tests-only ticket costs about 90% of a median ticket, and effort tracks test lines more closely than production lines. (`where-the-effort-goes.md`)
3. **That is why earlier fixes did not bend the curve.** Cheaper implementers and fewer generated tasks both worked on their targets. But implementation is about a fifth of the tokens, and the cheap tier carries under 0.1% of weighted units. An unworked ticket in the backlog costs almost nothing. The cost sits in the fixed overhead per worked ticket.
4. **Effort does not follow risk.**
   - **Risk gets no extra effort.** At a fixed size, a credential, auth or migration change gets no more dispatches than any other change.
   - **Review's catches cluster.** Review stops an estimated 38–48% of the bugs that are visible at all, but its catches sit in a few tickets. Of 24 real bugs caught, 10 tickets held them all and one credential ticket held 8.
   - **More gates show no fewer escapes.** Tickets that passed more gates have no fewer escaped defects; this is observational and confounded by size. (`reliability-baseline.md`, `fleet-complexity-read.md`)
5. **Lessons accrue as prose and are rarely retired.**
   - **Gate rules are prose.** 8 of the 10 tickets in the close-out lineage changed no runtime code.
   - **Almost nothing shrinks:** 17 of 221 prompt-text commits left it smaller.
   - **The central gate is prose-only.** GitHub enforces green CI before merge, but "merge and Done need a recorded Approve and a discharged ledger" is enforced by prose alone.
   - **The text itself is cheap:** rule-bearing text is about 3% of the context a session carries. The cost is in what the rules make agents do: extra rounds, ledgers, long comments, and pins that must be bumped. (`steady-base.md` v2, `steady-base-check.md`)
6. **Reliability looks steady but is hard to read.**
   - **Main is quiet.** It is red on about 1% of pushes, and none of the three reverts this year was for a defect.
   - **Harbour's escaped-defect rate rose, partly from finding.** In LinearViewer it went from 5.4 to 13.7 per 100 merged PRs, but much of that is the fleet now finding and filing faults in older code.
   - **simple-dispatcher's rise is not explained that way.** It went from 12.2 to 43.6 per 100 PRs, and it is the one reliability signal to treat as real. (`reliability-baseline.md`)
7. **Harbour throws its own evidence away.** Dispatch history, prompt traces, the app-call log and local session transcripts are all kept for 30 days. No token series before September can be rebuilt.
8. **Single-session runs suit research, not changes to the system.** Six papers and checks landed on 29–30 September in about two hours, each as one bounded session, and none changed the product. Changes to Harbour itself are different. An agent that skipped Harbour's process once took a week to clean up after.

## What this implies

- **The large savings are structural, not textual.** They come from two places: proportional process, and moving the mechanical parts of supervision into deterministic code with model sessions kept for judgement. Trimming prompt text is hygiene worth a percent or two.
- **Altitude stays.** The supervision layers exist for context isolation and role clarity, and each can catch another's drift (`docs/autopilot-operating-manual.md`: *"Is this mine to act on, or am I about to leave my altitude?"*). A layer can keep its role while shedding the waiting, polling, re-dispatching and restating that a state machine can do.
- **Harbour changes itself through its own process,** measured against a baseline. A saving that cannot be measured is a guess, and a guess is how the process grew.
- **Doubling throughput is plausible, not proven.** In July the fleet did the same work per ticket with about half the dispatches it uses now. Returning to that alone would be close to 2×. The research to date cannot say what that would cost in reliability; the instrument below is what will.

## How we will measure it

The scorecard is defined in LIN-3152 (`measuring-throughput.md`, pending). One record per finished ticket, computed by code and trended weekly:

- **Correct:** merged on green, no escaped defect traced to it within N days, not reopened.
- **Complete:** it did what it said, and did not file its own unfinished scope as a follow-up.
- **Cost:** weighted tokens, dispatches, session time and elapsed time.
- **Human attention:** rulings, parks and interventions.
- **Proportional:** cost relative to size and risk class.
- **Left better:** process weight added or removed (prompt bytes, pins, plan-label comments, suite runtime).

**Throughput** is correct, complete work per unit of budget and per elapsed day. It is not tickets or PRs, which have both inflated. The baseline is today's numbers. A change counts as a saving only if throughput rises with correctness held.

## What we intend

**Short term: V1 first.**
- **V1 resumes on 1 October after the weekly reset,** exactly as it was parked (the resume notes are on LIN-3099). The structure doesn't change mid-passage.
- **John's rulings go in as standing context:** he is the sole user, so no legacy compatibility, flags or rollback scripts unless a ticket asks for them; and review rounds are fine while they converge.
- **John sets the transcript retention** on the runner machine: Claude Code's `cleanupPeriodDays`.

**Now: research into where the bloat lives** (30 September, research and docs only):
- LIN-3150, what the supervision layers actually do, and how much of it needs a model;
- LIN-3151, the test estate: which tests earn their keep and what the rest cost;
- LIN-3152, measuring throughput of correct work: the instrument and its baseline;
- LIN-3153, an independent check of the atlas, effort and reliability papers.

**Long term: the steady-base epic,** after V1's build or at a point John chooses. It is planned like any passage. Its contents need careful thought, and the effort-to-savings map below is the input for that. The candidate strands are:
1. **Instruments.** Keep evidence for the project's lifetime, like git history: dispatch history, traces, app calls and transcripts. Dispatch history expires per record, so a migration can rescue whatever still exists when the fix lands. Also the scorecard.
2. **Proportional process.** Size and risk classified by code from the paths a change touches, never by an agent's label. Simple work gets a simple path; complex work scales up. The full process stays for credentials, auth, data migration and security.
3. **Mechanical supervision into code,** keeping every altitude.
4. **Leave it better, by bloat type.** Tests, code comments and plan labels, prompts and the docs agents read, fleet machinery, and ticket conversation. Each gets its own safe removal method and its own safety check. New lessons land as code first, and prose only when judgement is needed.

## How it fits V1

V1 is one person, one task, one proven merge (`docs/v1.md`). A stranger's task runs through this same pipeline, so the overhead is part of the product they experience: for a small change today, about 17 dispatches and hours of waiting. `docs/v1.md` lists "what a run should cost" as an open hypothesis. The steady-base work is how Harbour answers it. The natural slot is between V1's dress rehearsal and the invited period: prove V1 works, then make it proportional before other people use it.

## Effort-to-savings map

*Pending LIN-3150–3153. For each candidate change, this section will give:*
- *the evidence;*
- *the estimated saving on the scorecard;*
- *the effort to build it;*
- *the reliability risk and its safety check.*

*This is the input for planning the epic.*

## Open questions

- **What is the right shape for Harbour's process,** not just a lighter version of today's? This needs John's thought as well as the data.
- **Is simple-dispatcher's rising escape rate a warning** about the machinery's growth?
- **Which lessons behind today's rules are still earning their keep?** The firing record for the review and close-out rules is proposed in `proposals.md`. Rasmussen's warning applies: a defence's value is invisible until it is removed.

## The evidence

| Document | What it contributes |
|---|---|
| [fleet-complexity-read](papers/harbour/fleet-complexity-read.md) | Three tickets audited: the heavy process on small work, and review's value on the credential cutover |
| [steady-base](papers/harbour/steady-base.md) (v2) and [check](papers/harbour/steady-base-check.md) | Growth of prompt text and gate rules; rules as prose; what enforces what |
| [paid-where-written](papers/harbour/paid-where-written.md) (v2) and [check](papers/harbour/paid-where-written-check.md) | The argument: every fix is paid where it is written, and where that argument is weak |
| [growth-atlas](papers/harbour/growth-atlas.md) | Everything that grew since January, drawn |
| [where-the-effort-goes](papers/harbour/where-the-effort-goes.md) | The anatomy of a ticket's effort; proportionality to size and risk |
| [reliability-baseline](papers/harbour/reliability-baseline.md) | Escaped defects, review catches and main-branch health, since January |
| Earlier: [ticket-record-and-quality](papers/harbour/ticket-record-and-quality.md), [review-loops](papers/harbour/review-loops.md), [what-the-reviews-checked](papers/harbour/what-the-reviews-checked.md), [cheap-implementer](papers/harbour/cheap-implementer.md), [tasks-generate-tasks](papers/harbour/tasks-generate-tasks.md) | The pieces that pointed this way first |

## Decisions

| Date | Decision |
|---|---|
| 29 Sep | Pause the V1 passage for the process review. |
| 30 Sep | Measure first; hold off on solutions until the lay of the land is known. |
| 30 Sep | Altitude is a requirement. No flattening of supervision layers; changes to Harbour go through Harbour's process. |
| 30 Sep | V1 resumes on 1 October as parked. The steady-base work is epic-shaped and planned with care, with ~2× throughput as the aim and measurement as the condition. |
| 30 Sep | Evidence is kept for the project's lifetime. |
