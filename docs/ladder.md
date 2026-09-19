# The ladder: how people come to trust AI agents with their work

*Descriptive, not normative. This document models where developers are and what Harbour owes them at each step. Agents may maintain it and revise it from evidence; the first paper on it is LIN-2925. The rule it implies lives in the north star, which only a human accepts.*

Drafted 19 September 2026 by a Claude session in conversation with John Kershaw, from his description of the ladder. His words are quoted where the rungs are defined. Grounded on the live workspace and the checked-out docs at that date.

## Why a ladder

Harbour exists to keep human intent in command of AI execution, so it has to model the human. People do not arrive at "feed tasks in and they land" in one step. They climb, and each step is gated by two things: **trust** (have I seen it be right enough times to let it do the next step without watching?) and **budget** (can I afford to let it run?). In John's words: *"it's more a single product, but we have to factor in how people will actually use it and how far along they'll go, and that's based on trust and budget and other factors like that."*

## The rungs

| Rung | The person | Harbour gives | Evidence at this rung | Gate to the next rung |
|---|---|---|---|---|
| 1 | Asks a question, copies the answer, carries on | Nothing yet | Their own eyes | Trust in one answer |
| 2 | Opens Claude Code and walks through the work by hand, meandering | Nothing yet | Their own eyes | Learns the sharp edges; learns to trust |
| 3 | Bundles repeatable steps into prompts and saves them | The grounded next prompt for a task | The tracker: the issue moved after the prompt was copied | "Run the next one for me?" |
| 4 | Lets Harbour run one task | Dispatch, a PR, CI, the review ledger, one approval click before merge | The PR and the ledger | Cost visible; a few clean landings |
| 5 | Ratifies a passage of several tasks | Legs, task budgets, a landing report, rulings | The landing report | Rulings at a rate they can sustain |
| 6 | Feeds tasks in | The always-on loop, a forecast, KPIs | Cost per verified task; the forecast scored against actuals | None; this is the top |

John's description of rungs 1 to 3, 19 September: *"First people will ask Claude a question, copy the answer, carry on with the day. Next people open Claude Code and essentially walk through their work, meandering left and right, and eventually arrive at a place, and this is where they learn the sharp edges of Claude, this is where they learn to trust Claude. Then people start bundling up tasks: if they know that they need to go through four or five steps and it's a repeatable process they'll start making prompts, they get really good results, they save their prompts in the hope that they can use them later. This is where the majority of developers today are."*

And of what Harbour does with that: *"Harbour's first parlour trick is essentially giving them those prompts. They log in, they get their prompt, off they go. That is the core of Harbour, and everything else nearby exists to accelerate that: that's the autopilot, that's the automatic dispatch system. All of those exist to remove the friction of copying and pasting and then triggering the next actions. Harbour then extends this beyond where most developers are to the next level, which is multiple tasks as part of a passage, and leads eventually to an enormous, constantly running Harbour where you simply feed in tasks and they are done: complete, quick, no fuss, all correct, and land."*

## What follows from the ladder

**The instruments are the handrail.** Verified-beats-claimed, the ledger, rulings and cost per verified task are what make each climb safe to attempt. Each belongs to one rung. A person sees their rung plus one: a rung-3 developer needs "was that prompt good", not cost per verified task.

**Rung-3 evidence is free.** Harbour reads the tracker, so it can see whether an issue moved after a prompt was copied without asking the user anything. That is the rung-3 form of external evidence over self-report.

**The big jump is 3 to 4.** Below it the person does the work themselves. At rung 4 something runs without them, and that is where trust breaks. So rung 4 has to be tiny: one task, one bounded run, the merge waits for their click, the transcript in view. Harbour already built this shape for the Flight Companion (LIN-2627: read-only, then supervised writes, then unattended). The same three steps are a user's rung-4 on-ramp.

**Budget lines up with rungs.** Rung 3 costs almost nothing to serve, because the handwritten prompt templates are deterministic. The AI recommendation is the first BYOK or free-tier step. Rung 4 is the first time a task costs money on someone's key.

**The runner is the rung-4 on-ramp for people who are not the operator.** A rung-4 user will not install simple-dispatcher on their own machine. Machines as account objects (LIN-2883) and cloud execution (LIN-1301) exist for that step, and belong after rung-3 entry and before anyone is asked to climb.

**Rungs 5 and 6 have one user today.** The operator uses them to build Harbour; that is dogfooding and it is valid. On 19 September 2026 roughly two-thirds of the open backlog was rung 5 and 6 work (the dispatcher-substrate, prompt-engine, cost-economy, proxy-api, rulings, operating-model, flight-companion and periodicals fronts). It is rationed to what raises verified tasks per week, not to new capability.

## What to measure

A funnel: people per rung, time on rung, and why they stop, trust or budget. LIN-1644 (time-to-trust instrumentation) is the ticket. The first number worth watching is prompts copied before the first dispatch: the rung-3 to rung-4 trust threshold, measured on a real person rather than assumed.

## Where the estimate of "where developers are" comes from

Today, from John's own reading of the developers he works with. LIN-2925 is the first paper on it: what published evidence says about developer adoption of AI coding tools, mapped onto these rungs, with the strongest disconfirming source named. Revise this document from that paper and its successors, never from the north star.

## Revision record

- v1, 2026-09-19: drafted from the planning conversation; not yet checked against a paper.
