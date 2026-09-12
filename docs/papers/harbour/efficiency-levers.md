---
title: What levers to make a task faster or cheaper are already written down?
version: 2
date: 2026-09-12
authors: [Claude, John Kershaw]
model: claude-opus-5, claude-code, effort high (the study, LIN-2801); this edition rewritten by hand
grounded_at: d69fb510
cites: [docs/reviews/capacity-test-run-review-2026-08-14.md@d69fb510, docs/reviews/intra-session-efficiency-review-2026-08-14.md@d69fb510, docs/reviews/context-efficiency-ceiling-review-2026-08-15.md@d69fb510, docs/reviews/capacity-levers-map-2026-08-15.md@d69fb510, docs/reviews/lane-run-review-2026-08-23.md@d69fb510, docs/reviews/model-effort-routing-proposal-2026-09-11.md@d69fb510, docs/papers/harbour/review-loops.md, docs/archive/5.html@d69fb510, LIN-2801 (2026-09-12)]
---

# What levers to make a task faster or cheaper are already written down?

Thirty-seven, spread across reviews, tickets, both repos' `CLAUDE.md`, the dispatcher docs
and one essay. Grouped by where each acts in a ticket's life, they fall into five stages.
Most have been measured once, on one day or one run, and none has been measured past the
gate that judges its output. This is a map for choosing the next paper, not a ranking.

## The levers

Each row gives what the lever changes, where it is written down, what has been measured
(a number with its source, or "argued only"), and what a fair test would need. Where a lever
has been measured twice with different numbers, both are given.

| Stage | Lever | Changes | Documented | Measured | A test needs |
|---|---|---|---|---|---|
| Before dispatch | Per-kind model routing | Which model runs each leg kind | Model/effort routing proposal 2026-09-11; LIN-1627, LIN-1085 | Sonnet implementation: 84% first-pass review approval at $4.54 median. Opus: 56% at $18.72. Plan: Sonnet 12% at $1.74, Opus 15% at $9.48 | First-pass survival per kind at fixed effort, one kind changed at a time |
| Before dispatch | Per-kind effort level | How much the same model thinks | Same proposal; LIN-2567; `docs/dispatch-integration.md:426` | Argued only. Every stamped run in the window was `high`, so no in-house data | The effort read-out per kind, one step down, with approval rate held |
| Before dispatch | Cheapest tier first, escalate on failure | Which tier tries first | Ceiling review §8 | 12 of 17 probe runs stayed on Haiku 4.5; $12.51 against a $25 cap | The same ablation ladder with and without escalation, at equal outcomes |
| Before dispatch | Harness choice (`opencode`, Dash) | Which agent binary and price tier | `simple-dispatcher/README.md`; LIN-2687, LIN-1181; The Cheap Ships, lever three | Argued only. Published tier prices; no Harbour run on another harness priced | A per-harness meter plus a survived-the-gate rate per harness |
| Before dispatch | Pointer-first handoffs | Whether a leg is told where to look | LIN-2689; ceiling review §4.3 | Removing a 93-token pointer cost 2.2× in dollars and 2.8× in turns at the same outcome | Replay the probes with handoffs built from an index rather than by hand |
| Before dispatch | Prompt sizing to task scale | Prompt and output size on small tasks | `docs/lin-260-prompt-scaling-research.md`; LIN-260 | Argued only | The A/B harness in `docs/prompt-change-validation.md` §5 |
| Before dispatch | Declared run budget (`maxTasks`) | Whether a run can sprawl | LIN-1751; `docs/dispatch-integration.md:505`; LIN-375 | Argued only | Spend per run with and without the bound, counting what the bound stopped |
| Inside a session | Drop the bootstrap summarise turn | Removes the orientation turn | LIN-2116, LIN-2127 (landed); ceiling review §7.1 | Twice. Ceiling review: $76.79 over 148 legs, 5.5% of the day, 15% of a review leg. Lane review: $0.81 per session, 9% published, 20% corrected | Per-kind cost and outcome on bootstrap-free launches against the two-phase shape |
| Inside a session | Compact at a beat boundary | Re-seeds the next beat from a distillate | LIN-2117; ceiling review §7.1 | Beat 2 of one leg cost $2.76, 64% of the leg, carrying beat 1's full 160k context | A verifier at the re-seed boundary |
| Inside a session | Bound the long tail | Turn count on sessions past their kind's median | Intra-session review F7 | $436.13, 31.2% of the measured day, in 9 sessions running over twice their kind's median | Re-measure the distribution after checkpointing |
| Inside a session | Preamble diet | The turn-1 window every later turn carries | Intra-session review §5 | A 25% cut saves 3.2% of the day; 50% saves 6.4%. Arithmetic on measured windows | Re-derive turn-1 windows after the cut |
| Inside a session | Defer or scope the `CLAUDE.md` read | Whether repo conventions ride the whole leg | Intra-session review F2; ceiling review §4.4 | Twice. Estimate: $69.80, 5.0% of the day. Probe: removing it cut cost 23% and peak window 28% with the verifier still 43 of 43 | Repeat the drop across leg kinds and task shapes |
| Inside a session | Eliminate repeat reads | Re-reading a file already in context | Intra-session review F4 | Implementation legs read each file 1.77 times at the median, worst 3.22; review and close-out exactly 1.00. $15.31, 1.1% of the day | Repeat-read count per leg before and after |
| Inside a session | Shrink proxy-polling carry | Tool-result bytes that ride the window | Intra-session review F5 | 4,003 proxy calls, 32.8% of all tool calls, carrying $55.58, 4.0% of the day | Byte accounting per call after a batched or pushed read replaces the poll |
| Inside a session | Do not hold a large context while waiting | What a polling turn pays to find nothing changed | LIN-1591; ceiling review §9.2 | Six heartbeat-heavy sessions were $59.59, 15% of $409.47 over 73 sessions; the worst re-read a 208k context 119 times, $16.12 to sit still | The cache-read to cache-write ratio after the wait moves out of the session |
| Between sessions | Follow-up resume (`followUpTo`) | Whether a re-pass rebuilds context or resumes | `simple-dispatcher/CLAUDE.md`; `docs/autopilot-operating-manual.md`; `review-loops.md` | 108 re-passes cost 49 hours; the resumable prefix is 6 to 11 hours, about 1% of the window; 88% fall inside the hold | Matched re-passes fresh and resumed, comparing time to first edit |
| Between sessions | Warm hold (`waitForFollowUps`) | Whether a held session takes the next beat | `docs/autopilot-operating-manual.md`; LIN-789, LIN-845 | Argued only | Beat-2 cost on held sessions against a cold resume |
| Between sessions | Roll-on sessions | Continuing across a leg boundary | LIN-1150; ceiling review §7.3 | Argued only. The review prices both sides: derived state is 82 to 191× the stated task; a fresh leg re-pays the 2.2× above | Raw tail carried, against distillate carried, against fresh |
| Between sessions | Worker lanes | One session carries an ordered ticket list | `docs/worker-lane-prompt.md`; lane review | 52 tickets Done, 43 PRs merged, 0 collisions in one seven-hour run at 1.81 window points per hour against the capacity day's 4.3. The cold-start saving argued for was $0.81 per ticket | Throughput and cost per landed ticket, lane against dispatched steps |
| Between sessions | Per-ticket re-grounding in a lane | Fresh-context checking without a fresh session | `docs/worker-lane-prompt.md` step 1; lane review §4 | Caught two operator framing errors in one run, one a would-be regression. No cost figure | Send-back rate on lane tickets with and without the step |
| Between sessions | File carve | Whether concurrent sessions can collide | `docs/worker-lane-prompt.md`; lane review §5 | 0 collisions across 15 concurrent lanes and two repos | Collision count at higher lane counts |
| At a gate | Plan-review and its send-back loop | What reaches implementation and how often it goes round | `review-loops.md`; LIN-1883 | 83 of 94 plans sent back, 33 twice or more; loops are 31.2% of session time and 38.3% of dollars | A verdict reader that classes what each send-back asked for |
| At a gate | Mutation checks at review | Whether a green suite is evidence | Lane review addendum 2; LIN-2261, LIN-2274 | Run unprompted on four tickets: one found 13 of 14 reverts killed, another "27 of 27 green" after deleting the code | Survived-the-next-gate rate with and without the check |
| At a gate | Surface Assessment gate | Stops speculative refactors entering a plan | `CLAUDE.md` (LIN-192, LIN-397); `lib/prompt-template-defs.js` | Argued only. A sibling directive moved a breadth check from 0% to 43% on Haiku and 19% to 69% on Opus | The same A/B harness on this directive |
| At a gate | Retrospective audit of landed work | A verb for already-merged work | LIN-2261; lane review addenda 2 and 3 | 50 tickets audited for $210.59, $4.21 each; 8 Request Changes, 0 false dones | Findings per dollar against a review of the same change |
| At a gate | Harness-aware gate read-out | Bounds the judgement lane as cheap output grows | LIN-2690; capacity levers map, lever 8 | Argued only | First-pass survival split by producing harness |
| At a gate | The refusal licence | A refused close instead of a false one | `docs/worker-lane-prompt.md` step 4; lane review §4 | 5 refusals in one run, 0 faked closes, 2 prevented a regression | Closes that later reopen, with and without the licence |
| At a gate | Triage on close-out follow-ups | Whether filed debt is findable | Lane review addendum 3 | 19 remediation tickets produced 30 follow-ups; 17 landed with no priority | Time to pickup for follow-ups filed with and without priority |
| In the machinery | Hosted observer harness | Moves coordination off Claude Code sessions | LIN-2114; capacity levers map, lever 1; The Cheap Ships, lever one | The orchestrator tier was $245.96, 23% of the capacity day, in 14 sessions; an autopilot leg carries 1,047× its handed task | Cost per judgement on the new harness against the session tier |
| In the machinery | Deterministic census sweep | Classifies the fleet with no model call | `lib/observer-sweep.js` (LIN-2131) | Argued only; the no-model property is pinned by a test, not priced | Spend per tick and agreement against a model-classified census |
| In the machinery | Deterministic pre-call gate | Refuses an auto-wake before any model touch | `lib/flight-companion-gate.js` (LIN-2431) | Argued only | Refused turns against what an ungated cadence would have spent |
| In the machinery | Hash-keyed caches | Re-renders never re-spend | `lib/brief-cache.js`, `lib/recap-cache.js`, `lib/run-summary-cache.js` | Argued only | Hit rate per surface over a week |
| In the machinery | Push wakes instead of polling | Removes the poll loop that carries context | LIN-826 (landed), LIN-392, LIN-1324 | The shape it removes is the 15% above; its own saving is not measured | Wakes and spend per task before and after |
| In the machinery | Cold-start launch pacing | Sets the concurrency ceiling | `simple-dispatcher/pacing.js`; lane review; LIN-2277 | Peak 16 concurrent sessions, from an 11-minute median duration over a 61-second settle | The same curve on the kitty and tmux drivers |
| In the machinery | Per-session workspace clones | Lets legs run in parallel safely | LIN-558; `simple-dispatcher/clones.js` | Argued only | Collision rate at a given concurrency with and without isolation |
| In the machinery | Honest pricing table | Whether any of these numbers are right | LIN-2113 (merged); intra-session review F3 | 99.3% of the day's cache-write was one-hour ephemeral; the old table understated the day by $254.75, 18.2% | A rate table with an expiry field |
| In the machinery | Burn gauge and cost denominator | The ability to steer at all | LIN-2118; LIN-2253; headwinds review 2026-08-29 | Calibrated on one correlation, 27 window points against $1,070.58. Zero-lineage share fell from 70% to 1%; cost per ticket moved from $14.51 to $20.11 once honestly denominated | A second calibration point |

## Not written down

Five levers have no document of their own. The per-launch workspace fetch and clone is
bounded but never priced. The retention bounds that decide whether a resume is possible at
all exist only as config constants. Heartbeat cadence is tuned with no efficiency argument.
Sessions per delivered ticket, 3.8 measured once, has no owning lever. Nothing argues the
non-macOS terminal drivers as a throughput purchase.

## Method

Sources were the review reports in both repos, the archive essay, both `CLAUDE.md` files,
the dispatcher docs, and the tracker over the proxy searched for cost, effort, cache,
preamble, resume, lane, cadence and wake. Every number is copied from its source; none was
computed for this paper.

## Limits

Rows overlap. Most intra-session figures slice the same carried tokens and must never be
summed. Almost every figure comes from one day (2026-08-14), one run (2026-08-23) or one
thirty-day window, and several predate the pricing fix, so they are not commensurable.
Nothing here says a lever's saving survives its gate, and nothing is ranked.

## Next

The largest measured pools with no follow-up study are the long tail (31% of a day), the
orchestrator tier (23%), and holding context while waiting (15%). Each is one paper.
