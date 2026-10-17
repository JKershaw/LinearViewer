# Consolidate, then rebuild: lab notebook (round 3)

A running record kept by the Flight Companion, continuing `../rebuild-exp2/NOTES.md`. John asked on 17 Oct: "Ensure you keep your notes updated as we progress as this is all valuable for the write up." Entries are newest last. Facts are separated from inference, and inference is labelled.

## 17 Oct, morning: the framing

After `rebuild-round.md` (#1909) John read the results this way:

> "It feels like there's really two pieces; the Theseus metamorphosis of chunks (which the evidence says is pretty damn good), and getting the code into neat seams and bubbles (which is where our previous work, IE the Theseus view) is doing the lifting."

> "I like your idea; "rebuild" but it's not a lump of code, it's a tangle spread out across multiple areas. It's conceptually for me essentially compact (or consolidated) versus diffuse, dispersed or fragmented. The latter gets targeted first, sets up the seams, then invites the rebuild."

He relaxed the call for him to read the rebuilt code: "if we're right, Harbour will simply improve by the periodical measures, and changes will land cleaner, easier."

**My take, given to John (inference):**
- Two operations with different risks. A rebuild reshapes inside a fixed boundary with behaviour held; a consolidation moves a decision across boundaries and unifies behaviour. The copies may have drifted, so each difference is either a bug in one copy or a deliberate local variation; the replay has to be per caller.
- Evidence the order matters: 5c (LIN-3592) rebuilt a diffuse area and came out 86% verbatim; rebuilds kept decision location by construction; the one helper extracted into no named area tied the round's only new knot (`theseus.md`'s mechanism).
- Rank targets by sites × churn: a scattered decision costs only when it changes.
- With the Periodicals as judge, guard against gaming: regex signatures can be dodged by renaming, the area map by relabelling. Tickets forbid `areas.json` edits. The delayed outcome (smaller later changes, fewer send-backs and escapes in touched areas, per `coherence-as-it-grows.md`) is the real test.

**John's constraints for the round:**
- "I'm keen to avoid things like that CI idea, not because I disagree, but to force us where possible to stay fairly generic. I want this approach to be universal, rather than Harbour specific, and so things like the CI check could simply move to reviews. But! How we specifically _make_ Harbour do these is a task for later, once we've checked if the idea lands well."
- "I think those experiments work, and will give us a good sense of possibilities. Good to go in another write up once complete!"

**The experiments:**

| # | Experiment | Tests |
|---|---|---|
| 1 | Census of scattered decisions | Can the Periodicals pick consolidation targets? |
| 2 | One decision to one authority, losers deleted, per-caller replay | Consolidation on its own |
| 3 | Untie single-import knots by moving code to its owner | Whether knots untie cheaply |
| 4a/b/c | Dispatch entrance: free the seam (source-text pins → behaviour tests), consolidate, rebuild | The full sequence; 5c is the control |

## 17 Oct: #1 reframed as a Periodicals improvement

John: "Isn't 1 just the Periodicals? If we're finding info outside of those, that's a candidate for an improvement."

**Fact.** The Drift & Coherence Review (`lib/periodicals.js`, id `drift-coherence`) owns "decisions held in several places"; its reports are `docs/reviews/drift-coherence-review-*.md`. `known-decisions.sh` counts only 11 decisions named in advance. The census sub-agent was redirected: targets from the review first; the census judged by what it adds.

## 17 Oct: #1 results (`../consolidate-1-census/`)

**Facts.**
- `census.mjs`: generic (acorn over git objects, no repo-specific patterns), seven detectors, constants resolved before comparing so a rename can't hide a set. About 3 s per commit.
- Recall: 9 of 9 non-zero known decisions. sessionClass partial (the one-line predicate is too small).
- fenceParse and tsParse at 0 are real consolidations, not renames: LIN-3114 (#1824) took 7 copies to `lib/loose-json.js`; LIN-3454/3455/3473 (#1826, #1827, #1840) took 19 copies to `toEpochMs`.
- Groups / sites: 325 / 1,116 before the fence fix; 318 / 1,069 at baseline `2a07f3ea`; 310 / 1,026 at `d349e78c`. The rebuild rounds removed 14 groups and created 10 (e.g. a fifth `MONTHS` in #1905).
- Every multi-site row in the 2026-10-12 Drift & Coherence Review still holds. Its "waiting on a person" copies survived two rebuilds.
- Adds 8 real decisions no review row names (free-tier refusal body ×13; a second "is this issue closed" set omitting `duplicate`), and the `public/` mirrors the review says it can't see (15 pairs).
- Can't see behaviour or ordering bugs, cross-repo meaning, single-literal checks or dependency direction: most of the review's High and Medium rows.

**Inference.** The census is an instrument for the review to run and read, not a replacement. Generic improvement: commit it beside `seams.mjs` with the same contract, and have the review rule on every group with ≥3 files or ≥2 areas. Wiring into Harbour is later, per John.

**Target for #2:** "which marker means waiting on a person", named by the review (LIN-3339): 8 files, 3 areas, 146 commits in 90 days.

## 17 Oct: #3 filed as LIN-3600 (`../consolidate-3-untie/`)

**Facts.**
- Seven knots hang on a single import at `d349e78c` (`theseus.md` counted six of 19; the seventh is the one LIN-3579 tied).
- Ownership rule used (generic): code belongs to the area that would have to change if its rule changed. Verdicts per knot in `knots.md`. One knot (Other ↔ Platform) is the map's error, not the code's: no code fix.
- First draft untied only our own knot by renaming the helper into the pages area. I widened it (inference: a rename alone mostly tests that the measure moves with a path) to add a real move: `summarizeChecks` and GitHub's check vocabulary from `run-evidence.js` to `github-pr-status.js`.
- Verified on an exported copy: knots 20 → 18, no new knot; old and new `summarizeChecks` agree on 512 inputs; 251 targeted tests pass.
- Fresh-reader check: 0 high, 3 medium, 8 low, all applied (the medium ones: seams reads committed objects, so commit first; list every expected non-knot change so the worker doesn't stop for nothing; how to run the old function for the replay).
- Prediction committed before launch (`5b896ac7`). Filed LIN-3600, autopilot kicked off 07:50Z.

## 17 Oct: #4a drafted (`../consolidate-4-entrance/`)

**Facts.**
- The entrance is `routes/dispatch.js`, `routes/proxy-dispatch.js` (holds recommend-and-dispatch), `routes/proxy-kickoff.js` and `lib/dispatch-entrance.js`.
- 63 test-level pins in 35 files, not "17 + 6" as round 2 recorded: A convert 26, B loosen 20, C keep 17; plus 17 whole-tree scans that need no change.
- Move probe on a copy: every router body moved into `lib/dispatch-entrance.js`, registrations left in place. 37 tests in 11 files fail, exactly the A and B pins.
- Heavily security-weighted (owner gates, credential mints, the dispatch grant LIN-3136, owner-only mint LIN-3137, session-scoped credential read LIN-3124). Two coverage gaps found: no test covers the no-credential 503 on kickoff and recommend-and-dispatch, or the token mint's order with a real limiter.
- Predicted 2.5–5 h, 0 production lines; about 10× rung 4's four conversions.

**Inference.** Freeing a seam can cost more than the consolidation it enables. John: "agreed, but that's kind of what I expected. It's also very cheap, from my perspective." So cost in the write-up is measured as his attention and wall clock first, then laptop load, and agent hours last.

## 17 Oct: #4a fresh-reader check (not yet filed)

**Facts.** About 30 inventory rows and every cited production line checked at `d349e78c`: 4 must-fix, 5 medium, 11 low, 1 info.
- Nothing required a replacement to land, and be shown catching the removed guard, before its old pin was loosened. A worker could have turned the security counts into "at least one" first and added the sweeps last, or never.
- Some pins guard entrance and non-entrance sites together. Replacing one in place would have silently dropped the LIN-1980 guard on 7 `routes/proxy-compute.js` sites.
- The drafted redaction canary would fail on today's code (owners see their own prompt unmasked; the mask matches one token shape), and a token-shaped literal in a test trips the secret scan.
- Six wrong line citations in the inventory.
- Also: the route sweeps must walk nested routers (and the repo moved off `router.stack` on purpose, LIN-2505); one architecture doc line goes stale once the census is loosened.

**Inference.** The fresh-reader step is worth most on security-weighted tickets: two of the four must-fix items would have weakened a guard without failing any test. Applied: a bold order-of-work rule, mixed pins change only their entrance part, the canary designed to pass today and fail with the mask removed, and the one stale doc line allowed.

## 17 Oct, 08:06Z: LIN-3600 merged (#1910); 4a filed as LIN-3601

**Facts.**
- LIN-3600: kickoff 07:50:53Z, PR #1910 opened 07:53:50Z, merged 08:06:50Z as `f885f44c`. 16 minutes kickoff to merge; no rulings; nothing asked of John. Scoring is running.
- LIN-3601 (4a) filed after the fresh-reader fixes (ticket, inventory and prediction committed before launch); autopilot kicked off 08:09Z. One stray line was removed from the draft before filing (an operating rule of mine about dispatch, meaningless to the worker).

## 17 Oct: #2 drafted (`../consolidate-2-waiting/`)

**Facts.**
- Decision: which wake marker means "waiting on a person". Source: LIN-3339 (one job, many paths), whose 12 Oct re-check (Drift & Coherence, LIN-3516) found it holding and growing (LIN-3504 added an inline copy in `task-page-loader.js`).
- Sites at `d349e78c`: the authority `WAITING_WAKE_MARKERS` (`lib/digest-feedback.js:56`), 2 set copies, 7 inline checks. Two inline checks were missing from the review and the census list (`observer-efficacy-signal.js:110`, a private `[blocked]` regex; `dispatch-wake.js:343`). Two listed sites are a different vocabulary (agent-status words) and one already reaches the decision. The census's group id was wrong in my brief (G0040, not G0038).
- **Every copy holds the same set, `{'blocked'}`.** The copies differ in what surrounds it: which channel counts, what ends a wait, and when a question goes stale. Classified: (a) stale "keep in parity" comments; (b) deliberate wire-only resume rule (LIN-2123/LIN-2268) and the census lane's "answered out of band" rule; (c) a run-view clock edge that can't arise in production; (d) the channel, the console vocabulary, `[pending]` in the transcript highlight, closed-row ordering.
- Home: `lib/dispatch-terminal.js` (Runs & dispatch), which owns the wake-marker regex and `findWakeEvent`. Shape: the set plus an exact-match predicate.
- On a hand-made consolidated copy: knots 20 → 20, nothing new; census 310 / 1,026 → 309 / 1,022; 2,619 relevant tests pass.
- Per-caller replay: 16 callers, 3,046 captured + 3,000 generated inputs each, two seeds. Old vs old 0; 14 of 14 per-site mutants caught on exactly the expected callers; coverage of touched functions 100%; old vs the consolidated copy 0 differences over 51,046 inputs.

**Inference.** The decision the Periodical named is really several. The membership is already unanimous; what has drifted is the composition around it, and that is invisible to a text census. A membership-only consolidation is safe and cheap but moves little (4 sites). The composition questions are the real consolidation and need rulings first, which is why this ticket leaves them out. This may be the general shape: scattered *data* consolidates mechanically; scattered *rules* need a decision first.

## 17 Oct: #3 scored (`../consolidate-3-untie/arm/score.md`)

**Facts.**
- Knots 20 → 18, both targets gone, no new knot, one knot group of the same 9 areas. `scripts/code-shape/` untouched. Links 64 → 62, cross-area imports 902 → 899. The after-JSON matches the pre-launch copy run field for field.
- 7 files, +24/−24; the 16 moved lines byte-identical; no re-export (the test repointed); no shim; no leftover copy; no ticket reference or comment dropped.
- Independent replay: 0 differences on 10,864 `summarizeChecks` inputs (two seeds plus every value and ordered pair) and on 3,086 `buildPromptOpts` inputs; old vs old 0; 3 of 3 mutants caught.
- Census unchanged (310 / 1,026): the moved sets were never in a group. A knot can untie without the census moving.
- Prediction: 36 of 43 lines hit; the misses were line counts off by one or two.
- PR #1910 pasted the seams before/after and its replay as asked, and reports the full unit suite 17,268/17,268. The scorer had inferred from the timeline that the full suite couldn't have run before the PR opened; the PR body says it ran (probably during review). Recorded as resolved.
- Cost to John: nothing. 16 minutes wall clock, one run slot.

**Inference.** Untying a single-import knot by moving code to its owner is close to free when the ownership call is clear, and the Periodical moves exactly as predicted. The hard part was the judgement (which side owns the decision), done before launch; `knots.md` has that call for all seven single-import knots, so five more are ready to ticket.

## 17 Oct: #2 fresh-reader check, then filed

**Facts.** 5 must-fix, 7 should-fix, 4 nits; all code claims held at `f885f44c`. The must-fix items: the seams baseline was stale (LIN-3600 had merged: 18 pairs now); "raise a DECISION" for the unclear items would have blocked the run waiting on John (a `DECISION:` line pairs with `BLOCKED:` in the runner contract); LIN-3339 not framed as the source; a census step the worker couldn't run (the tool isn't in the repo); an unclear out-of-scope list. Applied: compare with the origin/main the worker branches from (prediction revised to 18 → 18 before launch); unclear items keep today's behaviour and are written up in the PR and one LIN-3339 comment; a tested `git grep` lists the sites that should remain, so "copies deleted" is checkable.

**Inference.** Two lessons for the method. A ticket that waits on the base moving needs its baseline taken from the branch point, not from the drafting commit. And "raise a DECISION" in a ticket costs John attention; where the safe default (keep today's behaviour) exists, the ticket should say so and send the question to the standing ticket instead.
- Filed LIN-3602, autopilot kicked off 08:21Z. Both Harbour slots are now in use (LIN-3601 since 08:09Z: plan done 08:10Z, plan review running at 08:13Z).

## 17 Oct, 08:50Z: LIN-3601 (4a) blocked on the plan-review loop bound

**Facts.** Plan 08:10Z, then three plan-review rounds requested changes (08:27, 08:37, and one more), each narrower than the last; the loop hit its bound and raised ruling `lin3601-plan-loop-bound` (options: one more review of revision 4; build on it unreviewed; re-scope). Pre-filled "one more review" for John to press. LIN-3602 (#2) meanwhile went plan → plan review → implementation (08:29Z) → review (08:41Z) → close-out (08:49Z), with close-out asking for an upper-case `[BLOCKED]` test.

**Inference.** The first ruling of the round came from the largest, most security-weighted ticket: a 63-pin plan takes more review rounds than the loop allows. That is a cost of freeing the seam in John's currency (one press), not agent hours.

## 17 Oct, 08:56Z: LIN-3602 (#2) merged (#1911)

**Facts (from the PR; independent scoring running).**
- Kickoff 08:21Z, PR opened 08:34Z, merged 08:56:25Z: 35 minutes, no rulings, nothing asked of John. 16 files, +146/−68.
- One authority: `WAITING_WAKE_MARKERS` plus `isWaitingWakeMarker` (exact, null-safe) in `lib/dispatch-terminal.js`. Three set definitions deleted; inline checks in six modules and the efficacy signal's private regex routed to it.
- Sites by the ticket's grep: 23 → 14 (the one definition plus the 13 expected stays). Seams 18 → 18, no new knot; `areas.json` untouched.
- Divergences: D3, D8 kept as deliberate variations; D4 bounded fuzz; D9 fixed (stale parity comments, including ones that described `[pending]` as waiting); D5 (`[pending]` in the transcript highlight) and D7 (`[blocked]` checked before closed-row in `resolveDisposition`) kept and written up on LIN-3339 as open questions with recommendations; D1/D2/D6 out of scope.
- The worker's replay: 0 differences over 13 callers at 1,000 inputs; a sensitivity check (adding `pending` to the set) made every caller but one differ, so it would have caught a change in who waits.
