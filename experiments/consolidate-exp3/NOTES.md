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
