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

## 17 Oct: #2 scored (`../consolidate-2-waiting/arm/score.md`)

**Facts.**
- Merge `ee9fcba9` (squash, parent `f885f44c`). Ticket grep 23 → 14 hits: the authority, the 10 expected stays, 3 comment lines. No copy of the set or inline check left elsewhere.
- Seams: 18 pairs and one group of 9 before and after; knot and link tables byte-identical (one more import inside Runs & dispatch).
- Census: 310 / 1,026 → 309 / 1,022. The marker-set group disappears (one definition is not a group); the `[blocked]` text group 15 → 14.
- Independent replay: 0 differences over 51,046 inputs, two seeds; old vs old 0; 14 of 14 planted mutants caught; widening the set to `pending` caught on 13 callers; a mutant of the new case-fold caught (731 differences). The cross-caller divergence probe is byte-identical before and after: composition unchanged, as the ticket required.
- The PR body carries the open questions (D5, D7) with recommendations and links the LIN-3339 comment.
- Misses: production lines +73/−65 (net +8; predicted −10 to −25) because of an 18-line comment beside the authority gathering every ticket reference and reason (code alone +24/−22); tests +70 net; 35 minutes, not 1.5–3 hours.
- Unasked: the PR fixed 6 more stale comments that described `[pending]` as waiting.

**Inference.**
- A consolidation can add lines. The reasons that were scattered beside each copy were gathered beside the one authority: line count is the wrong measure for it; sites per decision and the census are right.
- The census sees this consolidation (one group gone); the knots don't (the decision moved within its area). The two instruments are complementary: #3 moved knots and not the census, #2 the reverse.
- 09:45Z: John pressed the LIN-3601 ruling ("Ruling applied"): one more plan review of revision 4.

## 17 Oct, 10:43Z: LIN-3601 (#4a) merged (#1912)

**Facts (from the PR; independent scoring running).**
- Kickoff 08:09Z; three plan-review rounds hit the loop bound (08:50Z ruling); John pressed "one more review" at about 09:44Z; PR opened 10:26Z, merged 10:43:32Z. About 2 h 34 min, of which about 54 min waited on the ruling. One press from John.
- 22 files, +2,267/−339, 18 commits; tests only plus `docs/architecture/dispatch-and-proxy.md` line 31.
- The worker's move probe: on main 37 tests in 11 files fail (the ticket's figure reproduced); on the branch 0.
- 139 new tests in 7 files: a session-owner sweep (26 routes over HTTP), a proxy-grant sweep (nested routers descended, route count asserted), a redaction canary sweep (runtime-built canary, no token literal), a mint sweep (real token store spied), plus the two coverage gaps the inventory found (mint-chain order with a real limiter; the no-token 503).
- Order of work followed: replacements first, 67 failing-then-passing mutation runs recorded, then each old pin removed or loosened commit by commit.
- Pins: A 25 handled plus 1 corrected; B 20 judged with the entrance as one unit; C 17 untouched. One reclassification (lin-3134 :586, which plants outside the entrance).
- The PR states its residual risk (what the sweeps' fixtures can't reach).
- Environment note: the runner's checkout lacked `acorn` in `node_modules`, so `scripts/code-shape/seams.test.mjs` failed identically on main; CI runs `npm ci` and is the real check. A small runner fix, not this ticket's.

**Inference.** Freeing a seam was the most expensive step of the round in agent time and the only one that needed John, and it still cost him one press. The output is more than permission to move code: the sweeps check the security properties by behaviour across every route, which the location pins never did.

## 17 Oct: #4a scored (`../consolidate-4-entrance/arm-4a/score.md`)

**Facts.**
- `routes/` and `lib/` byte-identical before and after; only `tests/` and one doc line changed.
- Independent text probe: old fails 37 tests in 11 files (same file:line set as before launch), new fails 0.
- **A real move:** recommend-and-dispatch's 617-line handler moved into `lib/dispatch-entrance.js`. On the new tree the full suite stays green; on the old tree the same move fails 10 tests in 4 files. One C pin (`lin-3136-dispatch-gate.test.js:168`) needs the registration to keep a block-bodied `async (req, res) => { … }` forwarder.
- Security spot-checks: six properties plus no-token and three planted routes, 13 runs, all fail with the guard removed and pass restored. One weakness: the proxy-grant sweep's "reaches no sink" checks pass vacuously for recommend-and-dispatch and kickoff (fixtures stop at a 404 issue lookup); the explicit 403 checks still catch a dropped gate.
- Commit order: 4 test-adding commits first, then 14 loosening ones (the worker's evidence table records 67 mutation runs).
- Suite on new: 17,420 of 17,426 pass; the 6 failures need a git checkout and fail identically on old. `seams.test.mjs` passes with `acorn` present.
- Prediction misses: 139 tests (predicted 30–70), 7 new files (1–3), faster (2 h 34 min vs 3–5.5 h), a ruling on an unpredicted topic (the plan-review loop bound). Cost to the unit suite: about 13 s.

**Inference.** The seam is genuinely free: a real move now passes. Both constraints (the forwarder form; the vacuous sink checks) go into #4b's ticket.

## 17 Oct: #4b drafted (`../consolidate-4-entrance/4b/`)

**Facts.**
- 28 steps across the four POST handlers in the three entrance files. 24 are made by two or more entrances, at 96 sites: 13 plain copies and 11 the same decision with a per-entrance input. 4 belong to one lane only (session owner gate vs proxy grant, session spawn and task-mode record, proxy audit logging, recommend-and-dispatch's keepalive).
- Divergences: (a) 7, all stale comments; (b) about 20, kept as named parameters; (c) 9; (d) 7, e.g. proxy dispatch silently ignoring `presetId`/`stopAt`/`variant`, and kickoff answering a transient owner-check failure with the token-rate-limit 503 (pinned by a test).
- Home: `lib/dispatch-entrance.js` (Runs & dispatch), already treated as part of the entrance unit by every census; one `createDispatchItem` call with the follow-up gate and launch mint inside it. Route files keep registrations, factory signatures, limiters and the block-bodied forwarder form one C pin needs.
- Knots modelled: 18 → 18, no new link.
- Independent replay over HTTP: 21,077 requests per seed (≥3,000 generated per entrance, 3,158 edges, 1,489 captured); old vs old 0 on two seeds; 16 of 16 mutants caught on exactly their entrances, including a key-order-only swap; dropping `requireGrant('dispatch')` on recommend-and-dispatch or kickoff is caught (the gap #4a's sweeps left); coverage 99.67%.
- Census: 12 groups touch the entrance files, but of the 24 shared decisions it sees one (the 201 receipt).

**Inference.** The census is nearly blind here: the entrance copies are procedures (read, gate, build, mint, enqueue, reply), not data or small helpers. Sites-per-decision by hand (the decision map) is the measure for this kind of consolidation.

## 17 Oct: #4b fresh-reader check

**Facts.** 5 must-fix, 5 should-fix, 10 minor; code claims held at `15191460`.
- The ticket contradicted itself on the #4a sweeps (unmodified vs strengthen the fixture). Fixed: additions only, in their own commit first, green on unchanged code, with dropped-grant mutants shown failing.
- A source-text anchor survived #4a: three mint-census tests need one exact two-line text in the entrance, indentation included, and the gate check recognises only a bare `isFollowUp`/`followUpTo`. #4a had classified this pin as B (loosened to the entrance as one unit), so a text constraint survived *inside* the unit. The prediction's "0 test edits" was revised before launch.
- Gate placement in the authority was ambiguous for the session owner gate; now fail-closed wording.
- No statement of what the plan must contain (the plan review needs something to converge on, after #4a's loop-bound ruling); six required items added.
- Per-decision site counts weren't checkable (one decision read as 5 sites in the ticket and 14 in the map); a count column and counting rule added.

**Inference.** "Freed" has degrees: #4a freed the seam for moving code between files, but not for rewriting a line's text. Where a test pins text inside the unit, the consolidation can still be held to the old shape.
- Filed LIN-3604 (#4b); autopilot kicked off 11:42Z.

## 17 Oct: tests are part of the seam (for later discussion)

John asked why #4b's ticket preferred keeping the three tests that require one exact two-line passage, indentation included. My answer: it isn't better. The preference came from keeping test edits minimal so a green suite is clean evidence of no behaviour change; but the mint sweep already covers the property, the pin holds the authority to the old shape (the 5c failure), and #4a proved the conversion method. The distinction that matters: a behaviour test stays unchanged through a consolidation; a text pin is converted when it constrains the design.

John: "So, if we consider tests part of the "seam", then it makes sense they are tidied up to be corrected as part of this process? One for the notes and later discussion. I think currently the assumption is the tests are all correct (and necessary), which isn't really true."

**For the discussion (inference).** The method so far treats the suite as the fixed oracle: rebuild and consolidation tickets say "keep tests green, change them only with a reason". This round shows the suite is itself diffuse in the same way the code is:
- #4a: 63 location pins in 35 files guarded properties that 4 behaviour sweeps now guard across every route.
- #4a's sweeps had a vacuous case (two routes' "reaches no sink" checks stopped at a 404), and a test still says "9 sites" while checking 7.
- #4b: a text pin survived inside the freed unit.
- #2: an import-allowlist pin had to grow by one line to let a module reach its authority.
A seam therefore has a code side and a test side. Freeing it means correcting the tests that guard *where* or *how* instead of *what*, and finding ones that are vacuous, stale or redundant. The safeguard is the one #4a used: a replacement lands and is shown catching the removed guard before the old test goes. The independent replay is what lets tests change at all, because it judges behaviour without trusting the suite.
- John: "Don't update the work in progress. We can always redo this part with an improved process." LIN-3604 runs on its ticket as filed; how it handles the text pin is part of what it shows.
- 12:54Z check: LIN-3604's plan went through three plan-review rounds (11:50, 12:02, 12:11Z) and was approved on the third, without hitting the loop bound (#4a needed a ruling at the same point). Implementation running since 12:14Z. No rulings. (Inference: the "what the plan must contain" section, added at the fresh-reader step, may be why; one sample.)

## 17 Oct, ~13:10Z: three lanes

John, on the fresh-reader and replay catching workers' slips: "I'm not sure that's even a caveat; we have multiple steps specifically to catch these things." Then: "I wonder, can we open up additional lanes (being mindful not to overload the dashboard - fine for most sessions which aren't running heavy node scripts)." On the proposal (one heavy lane for rebuilds and consolidations, two light lanes for bounded tickets, the `node --test` concurrency cap first, then three single-import knots with ownership calls already made): "Feels like a good idea to me."

Light-lane queue: the concurrency cap; knot Agent API ↔ pages (terminal-state checks from `tree.js` → `providers/state-map.js`); knot Auth ↔ Providers (`TokenRefreshError` → `providers/interface.js`); knot Other ↔ Runs (periodical marker → `periodicals.js`). Held: the "is this issue closed" sets (needs a ruling on `duplicate`), the map-error knot (Other ↔ Platform), the medium-risk LLM ↔ Providers knot. Census-only small consolidations (free-tier refusal body ×13, loopback-host rule ×7) are candidates after these.

## 17 Oct, 13:17Z: LIN-3604 (#4b) merged (#1913)

**Facts (from the PR; independent scoring running).**
- Kickoff 11:42Z; three plan-review rounds, approved on the third; implementation from 12:14Z; PR 13:02Z; merged 13:17:38Z. 1 h 36 min; no rulings; nothing asked of John.
- 16 files, +2,965/−2,113. Route files 1,963 → 1,436, 1,773 → 750, 569 → 149 lines; `lib/dispatch-entrance.js` 45 → 1,677 (about half moved ticket/reason comments). Exports `enterSessionDispatch`, `enterProxyDispatch`, `enterRecommendDispatch`, `enterKickoff`; each lane lists its check steps in its own order as data.
- **Sites per decision 95 → 26** by the ticket's counting rule (route files 0); the worker corrected one "before" count (96 → 95).
- Sweep additions first, in their own commit, green on unchanged code and shown failing with the grant dropped from R and K. One new test: the owner gate fails closed when called directly. No other test changed; `POST_DISPATCH_GATE` kept as is (no census converted).
- A small factory change (`createDispatchItem` drops caller fields left `undefined`) reaches five out-of-scope callers; the PR reasons each saved row is unchanged.
- The worker's replay: 0 differences on 2,455 requests (every single fault, every ordered pair of check steps, triples; 574 multi-fault pairs, 0 vacuous on the old tree). Seams 18 → 18; counts inside pairs moved with the code.
- 8 open questions in the PR, all kept. One needs a human: the proxy and recommend launch arms stay undeclared (M3), and the ticket the docs cite for M3 (LIN-3099) is unrelated, so nothing tracks it. The PR also flags LIN-3603 (Backlog) as a likely duplicate of LIN-3604.
- 13:33Z: light lane 1: LIN-3605 (node --test concurrency cap) filed and kicked off after the fresh-reader check (3 medium, 6 low, applied).

## 17 Oct: #4b scored (`../consolidate-4-entrance/arm-4b/score.md`)

**Facts.**
- Independent replay old `15191460` vs new `47d87055`: 0 differences on two seeds (21,077 requests each). Twins 0. 15 of 15 mutants planted on the new tree caught on exactly their entrances, including a dropped `requireGrant('dispatch')` on recommend-and-dispatch (35 requests) and kickoff (29). Coverage 99.47%.
- `addItem` argument key order changed on two lanes (the replay sorts keys, so it didn't see it; an order-aware copy did); key set, values and persisted row bytes identical.
- The factory change: 0 differences in persisted row, returned item or errors over 374 captured + 5,000 generated inputs.
- Sites per decision 95 → 26, verified by hand; 0 entrance sites in the route files.
- Seams 18 → 18; Agent API → Runs & dispatch imports 46 → 34.
- Census 309 / 1,022 → 309 / 1,021: the 201-receipt group dissolved; one new group (a field list repeating part of `OPAQUE_FIELDS`).
- Shape: worst function 63 (the session handler) → 29 (`enterRecommendDispatch`). Production −317 lines, −92 code lines. `lib/dispatch-entrance.js` is now the most complex of the four files (268 decision points) — expected, since it holds all of them.
- Suite 17,436 / 17,436 from a git checkout. The hermetic check in this container is red at both commits from the same 3 `openrouter.ai` sockets (the known container-proxy effect; CI is the real check).
- Prediction: 23 hits, 5 misses, 1 partial.

**Inference.**
- The consolidation alone took the worst function from 63 to 29 — further than 5c's whole rebuild got it (122 → 63). Moving decisions to one place simplified the code before any rebuild.
- The authority is now the natural rebuild target: one file holding every entrance decision, 268 decision points, no location pins in the way.
- The replay sorting `addItem` keys is a blind spot worth fixing in the kit (it would miss a key-order change in a stored row built by spread).

## 17 Oct: K1–K3 fresh-reader check; K2 dropped

**Facts.** No high-severity findings; all three merge cleanly in any order (18 → 15) and the full suite passes on the combined branch. K1: two comments the move makes false now get rewritten. K3: baseline wording only. **K2 is dropped:** the fresh reader found that Auth also throws `TokenRefreshError` and defines what its codes mean (including one code only Auth uses), and only one provider throws it; the premise of the move (that it belongs to every provider refresher) is false. `knots.md` had flagged K2 as a judgement call.

**Inference.** The ownership rule held, but applying it needs every throw and catch site, not just the import that ties the knot. The fresh-reader step overturned a pre-launch ownership call before it cost a run.
- 14:02Z: light lane 2: LIN-3606 (K1) filed and kicked off. K3 queued for the next free light lane.

## 17 Oct, 14:06Z: LIN-3605 (concurrency cap) merged (#1914); K3 filed as LIN-3610

**Facts.**
- LIN-3605: kicked off ~13:35Z, merged 14:05:58Z; 4 files, +170/−4; no rulings. `scripts/run-unit-tests.mjs` caps local `node --test` at half the CPUs (override `UNIT_TEST_CONCURRENCY`; any non-empty `CI` = no flag). CLAUDE.md lines 22–23 edited in place (110 lines, 10,720 bytes). Local full suite: 17,446 tests, 0 fail, 57.8 s wall at concurrency 5 of 10 CPUs; hermetic PASS. CI workflow untouched.
- **The first implementation landed in the wrong repo:** the worker built it as simple-dispatcher#272; review caught it and the design was ported into LinearViewer. The PR says simple-dispatcher#272 should be closed unmerged. (Inference: the two-repo default workspace makes "which repo" a real step for a worker; a ticket naming its repo in the title helps but did not prevent it. Left for John.)
- LIN-3606 (K1) PR #1915 opened 14:06Z.
- K3 filed as LIN-3610 and kicked off 14:08Z in light lane 1.
