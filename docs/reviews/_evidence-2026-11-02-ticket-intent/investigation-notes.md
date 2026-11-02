# Investigation notes: where does a request lose its intent? (2026-11-02)

These are working notes from an in-session investigation that followed the LIN-4085 A/B run and its essay (`docs/papers/harbour/one-feature-twice.md`). They are notes, not conclusions. Several early conclusions were wrong and are marked as such below. All figures come from read-only API reads and judging by LLM subagents. No Harbour task was run to produce them.

## 1. How the question moved

1. **Starting question.** Did the LIN-4085 request lose fidelity as it passed through the stages? Is the prompt generator over-summarising?
   - The prompt generator is not the cause. Stage prompts carry no copy of the task; they point the agent at the live description.
   - The request text stayed verbatim at the top of the description in all 9 LIN-4085 snapshots.
2. **First mechanism story, from one ticket only.** Scoping narrowed "a full guide on how to properly configure Harbour for whatever your situation is" into "a way in, plus links".
   - The narrowing came from design calls: "link, don't re-describe" and "self-hosters get a pointer, not a walkthrough".
   - No ruling was asked for.
   - The review prompt ("Start by reading the plan"; "adding new ones is not review's job") then checked against the narrower version.
3. **The sweep showed LIN-4085's route is rare.** Its triage → scoping path is unusual (§2). So the mechanism story could not be generalised from it.
4. **A coverage check across 254 tickets** found Harbour delivers about 95% of a ticket's asks as written (§3).
5. **That check measured fidelity to the ticket's words, not to intent.** It cannot see a ticket that already over-settled what the person wanted. That led to the current question: are tickets themselves settling intent too early?

## 2. Corpus figures (corrected)

**A fault in the first pass.** The first sweep hit the proxy's rate limit (60 requests a minute) and dropped about 1,240 responses silently. The figures below come from a full re-fetch.

**Dispatches:**
- **Coverage:** 902 tickets have Harbour dispatches. History starts 2026-08-31, and 11 tickets have more than 100 dispatches, which the list endpoint truncates.
- **Scoping:** 4 tickets went through scoping (LIN-2516, LIN-3491, LIN-4033, LIN-4085), and 23 started at triage.
- **First stage:** implementation 303, research 263, plan 170.

**Does the request text survive?** For 611 of 653 tickets (94%) with a snapshot from before their first stage, at least 95% of the request's sentences survive verbatim in the final description. Deletion is rare.

**How much of the description is the request?** At the description's largest, the request's share has a median of 44% and a 10th percentile of 8%. LIN-4085 is at 5.5%.

**Tickets are specs from birth.** Earliest snapshot of 831 dispatched tickets:

| Measure | Median | 75th percentile |
|---|---|---|
| Length | 3,850 chars | 6,700 chars |
| Backticked identifiers | 32 | 67 |
| File paths named | 6 | 14 |
| List items | 13 | 26 |
| "must / exactly / never / only" | 5 | 11 |

- Only 75 of 831 (9%) start as a short paragraph (under 1,200 chars).
- 594 (71%) name three or more files.

**Feedback widget.** 140 tickets carry the widget's origin note, and only 4 ran through Harbour. The widget itself appends "work out what is actually being asked … and scope it before any research or implementation" (`routes/workspace-api-feedback.js`, LIN-947).

**Prompt wording history:**
- **Scoping (2026-10-04, LIN-3299).** Changed from "authority to *propose* what's in and out of scope, but open questions should be flagged for stakeholder resolution" to "What is in and out of scope is *yours to decide* … flag for the human only product or intent questions".
- **The Brief** (`lib/brief.js`), since 2026-05-31: "Supersede stale original wording rather than layering on top of it — write it as if framed fresh today."
- **The brief cache keeps one brief per ticket**, overwritten on regeneration. Past briefs cannot be recovered.

## 3. Coverage check: does the delivered work match the ticket's asks?

**Population:** 624 Done tickets that were dispatched by Harbour and have a snapshot from before their first stage. **Judged:** 254 of them, the 134 whose data loaded first plus a seeded random 120 of the remaining 490.

**Phase 1 (blind to the outcome).** A judge listed each request's asks (1,856 in total) and classed the request as `concrete` or `open`.

**Phase 2.** A judge labelled each ask against the delivery evidence: rulings, commits naming the ticket, the final description and the comments.

| Label | Share of asks |
|---|---|
| delivered | 94.7% |
| reduced on an agent's own written reason, with no human decision and no follow-up ticket | 1.7% |
| reduced by a human ruling or recorded owner decision | 1.5% |
| narrowed with no recorded reason | 0.8% |
| moved to a named follow-up ticket | 0.6% |
| unclear | 0.6% |
| dropped | 0.1% |

**Tickets with any reduction that had no human decision:**
- **Scope and deliverable asks:** about 11%, which is 29 of 254.
- **Including evidence and process asks** (after-numbers, pasted outputs, replay sizes): about 15%, which is 39 of 254.
- **Open against concrete requests:** 14% against 11%, with only 28 open tickets. No detectable difference.
- **Review flags:** reviews flagged 7 of the 16 narrowings that had no recorded reason. Where an agent had written a reason, reviews generally treated the reduction as settled.

**What most reductions look like.** Most are small, and many are prescribed methods that didn't fit the work:
- a unit test where a Playwright test was asked for
- a replay half the size asked
- a fixed commit order not followed

**Product-scope reductions on an agent's own reasoning:**
- LIN-2623 (picker curated-only)
- LIN-2955 ("never refuse a prompt", while the hourly cap still refuses)
- LIN-3833 (state words only on In Progress rows)
- LIN-2952 (time-to-trust measure dropped)
- LIN-2597 (rescoped after research)
- LIN-3808 (owner questions left as a note, not put to the owner)
- LIN-4085

**LIN-4085 in this check.** On full evidence, its "full guide" ask read as a recorded scope decision, because scoping's out-of-scope notes give a reason. In Harbour's own records, the narrowing looks legitimate.

**Second rater.** An independent judge re-scored 20 tickets (142 asks):
- exact label agreement: 96.5%
- reductions found: 10 by the first rater, 11 by the second, 8 in common

So the rate is stable, but individual calls are noisy. Read the figures to about ±50%, not to a decimal place.

**What this check cannot show:**
- **Intent.** It scores the work against the ticket's own words. For most tickets those words are an agent-written spec.
- **A ticket that over-settled from the start.** That ticket would score as fully "delivered".
- **Which stage made each reduction.**
- **Whether John would object to any of them.**

## 4. LIN-4085 replay of the review stage (earlier this week)

The review stage was re-run against the original review-time snapshot, in a sealed repo.

| Arm | Runs | Surfaced the guide narrowing |
|---|---|---|
| The exact review prompt | 3 (opus) | 0 of 3 |
| The same prompt plus one paragraph telling the judge to check against the request as filed | 4 (2 opus, 1 sonnet, 1 haiku) | 3 of 4 |

- In the 4-run arm, the sonnet run paraphrased the request and lost the part that mattered.
- Every judge that surfaced the narrowing recommended accepting it.
- One ticket, and the paragraph was written knowing the answer.

## 5. Model mix (a confound the essay omits)

- **The fast session** ran on opus at its highest effort.
- **Harbour's LIN-4085 stages:**
  - implementation on haiku
  - scoping, plan-review and review on opus
  - plan, triage, close-out and autopilot on sonnet
- "The fast session built the better product" is therefore partly a comparison of builder models.

## 6. Corrections owed to the essay and its record (not yet made)

- **(a) The quoted narrowing is misquoted.** The essay quotes "the guide's job is to sequence the human's few clicks" as the narrowing. In the scope it is an assumption about OAuth. The narrowing was the scope's design calls (§1).
- **(b) The budget came from scoping.** The guide's size budget was set by scoping, not the plan, and the ceilings were set at the measured size, not as a preset 4.5 KB box.
- **(c) The model mix is missing.** The fast session's cost estimate is likely too high, because it was calibrated on opus calls.

## 7. Open questions

1. **Intent, not text.** Do the most prescriptive tickets get the most rework afterwards? Possible signals:
   - corrective follow-up tickets
   - reverts
   - John's corrections after merge
2. **Who writes tickets, and from what?** Does John's original wording survive anywhere? Which ticket-writing surfaces produce the most prescriptive tickets?
3. **The Brief and Recap.** Do they loosen a spec back towards intent, or restate its prescriptions?
4. **The direct test.** Can John rate a small blind sample: "is this what I meant?"
