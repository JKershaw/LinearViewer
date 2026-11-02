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

## 8. After LIN-4128: reading cases, not measuring them (2 Nov, afternoon)

This section is raw material, in no particular order. It is mostly readings of individual cases. Each item names its source so it can be checked.

### LIN-4128 itself
- **The run.** Research, then review, then close-out, in 22 minutes. Research wrote its own Done-when, and review checked against it.
- **Where the findings went.** They live only on the ticket. No document landed in the repo or the Library.
- **What it recommended.** That John hand-rate 24 tickets.
- **What it shows.** The run was finished to the spec but did not serve the purpose, which was information we can use.

### This investigation's own pattern
At each turn it swapped a judgement question for a measurement and executed the measurement rigorously:
- sentence survival
- coverage of asks
- rater agreement

The coverage check (§3) scored agents' good judgement as "narrowing". In LIN-2623 and LIN-2955, both below, agents followed John's intent over the spec's literal words.

### LIN-4085, re-read
- **The miss was direction, not size.** John's note has the agent configure Harbour "for whatever your situation is without the user needing to follow those steps". The shipped guide makes the agent a signpost: "ask the person to open…", "do not create it for them", "What only the person can do".
- **The intent survived scoping's own summary.** It says the agent "does the rest through the documented agent surfaces Harbour already has". The content list then delegated "the rest" to the Proxy page's Agent Prompt, which is a token and an API catalogue, not a setup walkthrough.
- **The frozen-size rule framed the guide.** It was meant for prompt text, and the guide was a new surface.
- **The fast session's guide** (`content/getting-started.md` at `2bebcc03`, about 3,700 words) has the configuring steps: situation, repository check, sources, AI keys, backlog, how work runs, first task and settings.
- **Correction to §6(a).** The OAuth assumption ("sequence the human's few clicks") is part of the story after all.
- **John's reading.** The right call was for an agent to ask him whether to go past the size rule for a new surface.

### Agents using judgement well
- **LIN-2623.** John's words: "choose the model (and set the default in settings), and see transparent pricing info".
  - The agent-written spec contradicted itself. It asked for the live catalogue in the picker, and also for a 400 on uncurated ids.
  - It also named an exemplar validator that silently degrades, which was the very bug the ticket existed to fix.
  - The builder caught both, deviated, documented why, and flagged it for review.
- **LIN-2955.** The spec says "a prompt is never refused". John's steer on the ticket was to fix the global hourly cap bug, which makes the hourly safety net refuse again. Agents followed the steer.

### The UI: a lesson learned twice
- **June and July.**
  - Theme S1–S3 was reverted, "built without the attached design spec" (`b6e7cf27b`, 28 Jun).
  - The redo, LIN-783, was scoped as "largely a visual migration" and shipped a re-skin.
  - LIN-873 then had to say "build to the mockup design (not the migration re-skin)… don't self-certify on the text subset".
- **October.**
  - John called the Models prototype "the benchmark for UI UX standard I want for Harbour". He also said code or screenshots given to a building agent "may be over specific" (LIN-3757 comment, 23 Oct 20:40).
  - The relaying agent wrote "So the prototype is not attached".
  - LIN-3892 made it a rule: "No prototypes, screenshots or design review pages go to builders. Tickets carry the design in words." No sign-off from John on that line was found.
  - `docs/reviews/ui-design-gap-review-2026-10-26/README.md` ("How the gap arose") records the result:
    - briefs were written from surveys of the old pages
    - reviews compared each build with its ticket
    - polish rounds tidied the wrong layout
- **LIN-4009, "ready is the brand".**
  - Implemented exactly (`a11e1f8d8`, `rowStateOf` tone): any row with a guessed next step became teal.
  - Four days later, round 3 (`docs/reviews/ui-feedback-round-3-2026-10-30/README.md`, item 8) said: "the colour that should say 'this one' says nothing". LIN-4103 removed guessed steps.
  - **Where the attention went.** LIN-4009 had five plan-reviews and about 86k chars of comments. "Blue" appears about 120 times, as reviewers hunted stray blue across 13 stylesheets. The ready rule appears five times, always restated as spec, and is never questioned.
- **The base font.**
  - `body` stayed monospace from the June mono/sans decision (LIN-785) until `a11e1f8d8` on 26 Oct.
  - About 88 local `font-family: var(--font-content)` overrides grew around it, and 90 remain on main.
  - A LIN-3968 code comment says "the body is monospace… without it the copy-first key note… leaked into mono".
- **More UI leads from a scout pass, not read in full:**
  - the feedback button patched five times, then deleted (LIN-641 → LIN-2298)
  - the run button going one, three, one, three (LIN-2944 → LIN-4111)
  - the Settings consolidation copied back out within a day (`ab481a49` → `dfeabc20`)
  - periodic design reviews whose findings don't land (`design-interface-review-2026-10-21.md` §1)

### Spirals
- **The pattern.** Rulings raised when plan-review hit its bound: `lin3601-plan-loop-bound`, `lin3827-bound-and-scope`, the `lin3833-planloop-*` series and the `lin-4009-plan-*` pair. Common shape:
  1. Plan-review asks whether a class is closed.
  2. The thing is scattered through the code, so each round finds another member.
  3. The plan swells. LIN-4009's became "40k, 13 sheets, 15 test files".
  4. John gets a ruling.
- **The odd one out.** `lin3611-a3-loop` went three rounds over the reading of one house rule, on a freshly rebuilt file.
- **Narrow tickets landed fast, even on the most tangled files.**
  - LIN-3494 ("Go shows the server's reason") and LIN-3763 (dark-theme controls) each took about half an hour, with no plan-review. Both are narrow, line-cited and highly prescriptive.
- **Broad clean-ups did not spiral:**
  - LIN-4015, shrink the CSS: 2 plan-reviews
  - LIN-3889, consolidate: 2
  - LIN-3579, rebuild the renderers: 2
  - LIN-3912, delete Next run: 0
- **Broad design asks did:** LIN-4009 and LIN-3833 hit 5 each.
- **Hunch.** A spiral needs tangled code, an ask that cuts across it, and a goal that is a judgement, not a closed check.

### Where shrinking comes from
- **The count.** Since 1 Sep, 965 non-merge commits touched `lib/`, `routes/`, `public/` and `server.js`. App code grew by about 78,900 lines net.
- **What shrinks it.** 100 commits shrink code. Nearly all come from tickets whose job is to retire, remove, consolidate or "rebuild design-first", e.g.:
  - LIN-3912
  - LIN-3300
  - the LIN-3325 revert
  - LIN-3578/3579/3596/3703
  - LIN-4015
- **Ordinary feature and fix tickets almost never shrink code.**
- **`public/prompt-section.js`** went from about 590 lines in mid-August to 2,839 at `4a0d90eea`.
  - **Where the growth came from:** LIN-2944's re-review rounds, and the 25–26 Oct UI rounds (about +670 lines).
  - **Reconciling tickets still added lines.** LIN-4016 ("the server decides, the browser follows") and LIN-4069–4071 are examples.

### Friction noticed and left alone
- **How often.** In roughly three-quarters of 256 tickets' comment threads, agents record friction they noticed and left: "pre-existing", "out of scope, note only". The search was loose and catches some noise.
- **The field for it.** "Surface Assessment: improvement noticed, not required" appears 158 times.
- **LIN-2802:** "widening here would be the scope creep the brief forbids. Recording as a finding for LIN-2149's owner to ticket, not filing it myself."

### John's framing (from conversation)
- **Three bodies, coupled:** how tasks are written, how they are interpreted (probably mostly right), and the code's complexity, which makes tickets land awkwardly.
- **Two layers:** "we want X, ah it's messy, let's tidy up first, then it lands clean", against linear tickets walking the stages.
- **The missing piece:** "tasks are tasks, and [?] is [?]".
- **Learning to refactor:** small, smart, isolated steps that each leave the code simpler.
- **The decision he is willing to reopen:** the ticket as the source of truth. It conflates the job's record with documentation, plans and the place's memory.
- **The working image:** agents act like contractors working from work orders on a house nobody lives in. Tasks are tasks, and the codebase is a place.
- **Kent Beck's line:** "make the change easy (warning: this may be hard), then make the easy change". Inside a ticket, Harbour does only the second half.
