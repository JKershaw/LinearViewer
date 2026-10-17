---
title: Does consolidating scattered decisions before a rebuild improve a codebase, reliably and cheaply?
kind: paper
version: 1
date: 2026-10-17
authors: [Claude, for John Kershaw]
model: "Frontier tier, claude-code, effort not recorded; one interactive cloud session with John Kershaw (the Flight Companion), not dispatched through Harbour (no dispatch id). The consolidations, unties and the rebuild ran as Harbour tickets, whose stage models the dispatch lineage reports. The census, independent replays, ticket drafts, fresh-reader checks and scores were built by in-session subagents and read by the main session; this draft was written by one from those records."
grounded_at: 2e8cba6e (LinearViewer, origin/main)
cites: [experiments/consolidate-exp3/NOTES.md@5c5d47b1:341 (and the additions in this PR), experiments/consolidate-exp3/periodicals.md (this PR), experiments/consolidate-1-census/report.md@5c5d47b1:63, experiments/consolidate-1-census/census.mjs@5c5d47b1, experiments/consolidate-3-untie/knots.md@5c5d47b1:147, experiments/consolidate-3-untie/arm/score.md@5c5d47b1, experiments/consolidate-2-waiting/arm/score.md@5c5d47b1, experiments/consolidate-4-entrance/inventory.md@5c5d47b1, experiments/consolidate-4-entrance/arm-4a/score.md@5c5d47b1, experiments/consolidate-4-entrance/4b/decisions.md@5c5d47b1, experiments/consolidate-4-entrance/arm-4b/score.md@5c5d47b1, experiments/consolidate-4-entrance/4c/constraints.md@5c5d47b1, experiments/consolidate-4-entrance/arm-4c/score.md@5c5d47b1, experiments/consolidate-lanes/knots-check.md@5c5d47b1, experiments/consolidate-lanes/arm-knots/score.md@5c5d47b1, experiments/periodicals-before-after/fnshape.mjs@5c5d47b1, docs/papers/harbour/rebuild-round.md@2e8cba6e, docs/papers/harbour/rebuild-ladder.md@2e8cba6e, docs/papers/harbour/the-second-copy.md@2e8cba6e:57, docs/papers/harbour/coherence-as-it-grows.md@2e8cba6e:191, docs/papers/harbour/one-job-many-paths.md@2e8cba6e:26, docs/papers/harbour/theseus.md@2e8cba6e:25, docs/papers/harbour/drawing-the-ship.md@2e8cba6e:138, docs/papers/harbour/flow-and-convergence.md@2e8cba6e:50, docs/papers/harbour/paid-where-written.md@2e8cba6e:35, scripts/code-shape/seams.mjs@2e8cba6e, scripts/code-shape/areas.json@2e8cba6e, docs/papers/harbour/coherence-as-it-grows-scripts/known-decisions.sh@2e8cba6e, lib/dispatch-entrance.js@2e8cba6e, lib/dispatch-terminal.js@2e8cba6e, PR #1906 (2026-10-16), PR #1910 (2026-10-17), PR #1911 (2026-10-17), PR #1912 (2026-10-17), PR #1913 (2026-10-17), PR #1914 (2026-10-17), PR #1915 (2026-10-17), PR #1916 (2026-10-17), PR #1917 (2026-10-17), simple-dispatcher PR #272 (2026-10-17), LIN-3592, LIN-3600, LIN-3601, LIN-3602, LIN-3604, LIN-3605, LIN-3606, LIN-3610, LIN-3611, LIN-3339, LIN-3603, LIN-3607, LIN-3608]
---

# Does consolidating scattered decisions before a rebuild improve a codebase, reliably and cheaply?

Yes, on every target tried, and cheaply in John's time: two presses on ruling cards for the whole day. On 17 October
eight Harbour tickets ran: seven steps of the sequence and one fix to make room for more concurrent runs. All eight
merged, each in 16 minutes to 2 h 34 min, and every production change replayed with zero behaviour differences against
the old code on an independent replay. On the hardest target, the dispatch entrance, the sequence went further than
the earlier rebuild of the same files. That rebuild (5c, a day before) took the worst function from 122 to 63 decision
points and kept 86% of the four files' lines verbatim. Freeing the seam, consolidating and then rebuilding took it
from 63 to 29 to 13; the four files came out 62.9% verbatim against 5c's output, and the rebuilt authority file alone
45.7% against the version before it. Two-way area tangles (knots) went from 20 to 16. The Periodicals' own tools
register less of this than the code shows: the clearest consolidation numbers are hand counts that no Periodical takes
(sites per decision 95 → 26 at the entrance), and a census of copies moved by 3 sites. One run per target is not a
rate, and the real test is still to come: whether later changes in these areas land smaller and cleaner.

## The question

After `rebuild-round.md`, John read its results as two pieces:

> "It feels like there's really two pieces; the Theseus metamorphosis of chunks (which the evidence says is pretty damn good), and getting the code into neat seams and bubbles (which is where our previous work, IE the Theseus view) is doing the lifting."

> "I like your idea; "rebuild" but it's not a lump of code, it's a tangle spread out across multiple areas. It's conceptually for me essentially compact (or consolidated) versus diffuse, dispersed or fragmented. The latter gets targeted first, sets up the seams, then invites the rebuild."

His test of success was the Periodicals, not his reading of the code: "if we're right, Harbour will simply improve by
the periodical measures, and changes will land cleaner, easier." And the method had to stay generic: "I want this
approach to be universal, rather than Harbour specific, and so things like the CI check could simply move to reviews.
But! How we specifically _make_ Harbour do these is a task for later, once we've checked if the idea lands well."

The essays behind it argue that location is what to move (`the-second-copy.md`, `one-job-many-paths.md`, `theseus.md`,
`drawing-the-ship.md`, `flow-and-convergence.md`, `paid-where-written.md`).

## Findings

**Every ticket merged, every independent replay found zero differences, and John pressed two rulings.**

| Ticket (PR) | Step | What moved | Sites, knots, shape | Independent replay | Kickoff to merge | Presses |
| --- | --- | --- | --- | --- | --- | --- |
| LIN-3600 (#1910) | Untie two knots | GitHub's check vocabulary to `github-pr-status.js`; a helper renamed into the pages area | Knots 20 → 18; census unchanged | 0 differences, 13,907 inputs; 3 of 3 mutants caught | 16 min | 0 |
| LIN-3602 (#1911) | Consolidate one decision | "Waiting on a person" marker: one set and predicate in `dispatch-terminal.js`; 3 set definitions deleted (2 copies and the old export), 7 inline checks routed | Deciders 10 → 1; census 310 / 1,026 → 309 / 1,022; knots unchanged | 0 over 51,046 inputs, two seeds; 14 of 14 mutants | 35 min | 0 |
| LIN-3601 (#1912) | Free the seam (tests only) | 63 location pins judged; 139 behaviour tests added first, then pins loosened | Move probe: 37 failing tests → 0; production byte-identical | 13 security mutations all caught | 2 h 34 (54 min waiting on John) | 1 |
| LIN-3604 (#1913) | Consolidate the entrance | 24 shared entrance decisions to one authority each in `lib/dispatch-entrance.js` | Sites 95 → 26 (route files 0); worst function 63 → 29; production −317 lines | 0 over 21,077 requests, two seeds; 15 of 15 mutants | 1 h 36 | 0 |
| LIN-3605 (#1914) | Room for lanes | Local unit suite capped at half the CPUs | — | Not replayed; full suite 17,446 pass | ~31 min | 0 |
| LIN-3606 (#1915) | Untie a knot (K1) | `isBlocked` to `lib/providers/state-map.js` | Knots 18 → 17 | 0 over 70,272 inputs | ~25 min | 0 |
| LIN-3610 (#1916) | Untie a knot (K3) | The periodical gate marker to `lib/periodicals.js` | Knots 17 → 16 | 0 over 62,321 cases | ~22 min | 0 |
| LIN-3611 (#1917) | Rebuild the authority | Design-first rebuild of `lib/dispatch-entrance.js` | Worst function 29 → 13; decision points 268 → 238; code lines 878 → 937 | 0 over 21,089 requests, two seeds, plus 600 direct calls; 23 of 23 mutants | 2 h 20 | 1 |

Moved code was byte-identical in every untie. The area guide's blob is the same at every commit; the tickets forbade
editing it, so the measure could not be moved by relabelling. LIN-3611's worker replay once showed one keepalive
difference, put down to socket timing; it did not recur in 50 later runs. K2 (moving `TokenRefreshError` to the
provider interface) was dropped before launch: the fresh reader found Auth also throws it and defines its codes. Both
rulings came from plan review's loop bound, on two of the three heavy-lane tickets: LIN-3601 after three rounds on a
63-pin plan, LIN-3611 after three rounds on one test conversion; each card was pre-filled with one more round.
LIN-3604, the largest by diff, was approved on its third round. Its ticket listed what the plan must contain, which
may be why (inference, one sample), but LIN-3611's had the same list. Predictions were mostly right on the measures
and wrong on effort: two tickets ran well under their predicted time, and LIN-3602 added 8 production lines where it
was predicted to remove 10 to 25, because the reasons once beside each copy were gathered beside the one authority.

**On the dispatch entrance, the sequence went further than the earlier rebuild.** The four entrance files
(`routes/dispatch.js`, `routes/proxy-dispatch.js`, `routes/proxy-kickoff.js`, `lib/dispatch-entrance.js`):

| Commit | Code lines | Decision points | Worst entrance function | Verbatim |
| --- | --- | --- | --- | --- |
| Before 5c (`16e7ae77`) | 2,450 | 708 | 122 | — |
| After 5c (LIN-3592, `d2d7d818`) | 2,158 | 649 | 63 | 86.1% (the four files, against before 5c) |
| After consolidation (LIN-3604) | 2,056 | 585 | 29 | 42.0% (the authority file, against the files it replaced) |
| After the rebuild (LIN-3611, `2e8cba6e`) | 2,115 | 555 | 13 | 62.9% (the four files, against 5c's output); 45.7% (the authority file, against LIN-3604's) |

The four files are identical at `d2d7d818` and `15191460` (LIN-3601 changed tests only). Like for like, the four files
kept 86.1% of their text through 5c and 62.9% of 5c's through the sequence; 25.2% of the rebuilt authority is verbatim
from 5c's output. The consolidation alone took the worst function further (63 → 29) than 5c's rebuild had (122 → 63).
Inference: consolidating first made the difference; no arm rebuilt 5c's output without it, so that is untested. 5c cut
lines; the sequence cut complexity, and the rebuild bought small units with lines (in the authority, functions 106 →
163, longest function 256 → 74 code lines). Its first head was 72.7% verbatim, and review sent it back under the
Done-when line from `rebuild-round.md`. The reason 5c's helper gave for keeping each entrance's own reads, gates and
replies, "because the source-text censuses pin them by the route they sit in", is gone: the route files hold none of
the shared decisions by the ticket's counting rule, though the proxy lanes' `requireGrant('dispatch')` gate stays on
their registration lines by design.

**The Periodicals moved, but less than the code did.** The same tools at `d349e78c` (round start) and `2e8cba6e`
(after LIN-3611), with one area guide (`experiments/consolidate-exp3/periodicals.md`):

| Measure | Before | After |
| --- | --- | --- |
| Seams & Tangles: knots / knot groups | 20 / one of 9 areas | 16 / one of 9 |
| Seams & Tangles: link rows / cross-area imports | 64 / 902 | 60 / 888 |
| Functions at cyclomatic ≥ 50 / ≥ 100 / > 10 (`server.js`, `lib/`, `routes/`) | 10 / 1 / 572 | 9 / 1 / 568 |
| Code lines in the same scope | 73,425 | 73,394 |
| Census of copies (a candidate, not yet a Periodical's tool): groups / sites | 310 / 1,026 | 310 / 1,023 |
| Known decisions, files per decision (11 named) | 5, 0, 0, 5, 8, 6, 4, 2, 6, 15, 19 | identical |
| Comments admitting a second copy / sync-pinning tests | 121 / 34 | 120 / 34 |

Four knots were untied and none tied. The two entrance handlers left the ≥ 50 list, but `createDispatchItem` joined it
(49 → 51) through LIN-3604's factory change, so the count fell by one. The census lost two groups and gained two: one
a field list echoing `OPAQUE_FIELDS`, one a near-copy of `relayDispatchRefusal` in `routes/proxy.js`. No change
touched the eleven known decisions' signatures (K1 moved `isBlocked`, which sits beside the terminal-states set but is
not it). Inference: the Periodicals' tools see knots well, function size partly, and consolidation barely, because the
targets were picked by hand counts the tools don't take.

**The census is a candidate Periodicals improvement, and it sees what the knots don't.** John asked of the census
experiment: "Isn't 1 just the Periodicals? If we're finding info outside of those, that's a candidate for an
improvement." So it was judged by what it adds to the Drift & Coherence Review, which owns decisions held in several
places. It is generic (acorn over git objects, seven detectors, about 3 s a commit). It found all 9 non-zero known
decisions (one partly), 8 real decisions no review row names (a free-tier refusal body in 13 places; a second "is this
issue closed" set that omits `duplicate`), and 15 `public/` mirror pairs the review can't see. It cannot see behaviour
or ordering bugs, meaning across repositories, single-literal checks or dependency direction, most of the review's
High and Medium rows; at the entrance it saw 1 of 24 shared decisions, because those copies are procedures. LIN-3600,
K1 and K3 moved knots and not the census; LIN-3602 moved the census and not the knots. Inference: the two are
complementary.

**Are tests part of the seam? John's question, for later.** John: "So, if we consider tests part of the "seam", then
it makes sense they are tidied up to be corrected as part of this process? One for the notes and later discussion. I
think currently the assumption is the tests are all correct (and necessary), which isn't really true." The method had
treated the suite as a fixed oracle. What the round recorded:
- **63 location pins in 35 files** guarded the entrance by where code sat, and failed 37 tests when it moved. Four
  behaviour sweeps added by LIN-3601 now check the same security properties across every route.
- **A perturbation probe** (nine behaviour-preserving rewrites of the authority, each run against the full suite)
  failed no behaviour test, but 7 text or location pins and 10 vocabulary and sink rules, and found 4 stale entries.
- **A text pin survived inside the freed unit:** three tests required one exact two-line passage, indentation
  included. LIN-3604 kept it; LIN-3611 converted it, behaviour test first.
- **A worker created location pins.** K1's first commit proved its move with tests that read source text; review
  replaced them. Inference, one sample: "it's in the new file" is the natural witness for "this moved".
- **Plan review guarded a text pin as if it were the property.** LIN-3611's ruling came from three reviews rejecting
  one conversion the ticket allowed. Inference, one sample: reviewers need the conversion rule the worker gets.

The safeguard that let tests change was LIN-3601's order of work: each replacement lands and is shown catching the
removed guard (67 recorded mutation runs) before the old test goes. Inference, for the discussion: a seam has a test
side, and an independent replay is what lets it change, since it judges behaviour without trusting the suite.

**Scattered data may consolidate mechanically, while scattered rules need a decision first (inference, one case).**
The Periodical-named target for LIN-3602 was "which marker means waiting on a person" (LIN-3339): 8 files, 3 areas,
146 commits in 90 days. Every copy held the same set, `{'blocked'}`. What had drifted was what surrounds it: which
channel counts, what ends a wait, when a question goes stale. Unifying the set was safe and quick; the composition
questions need rulings, so the ticket kept today's behaviour, the replay confirmed it byte for byte, and the PR posted
two open questions to LIN-3339 instead of raising a ruling for John. The entrance's drafting found the same mix at
scale: of about 43 classified divergences, 7 were wrong copies (all stale comments), about 20 deliberate variations
kept as named parameters, 9 unreachable or harmless, and 7 unclear and kept as today; the PR carried 8 open questions,
now on LIN-3607 and LIN-3608.

**The fresh-reader check and the replay caught what workers and drafts missed, as designed.** John: "I'm not sure
that's even a caveat; we have multiple steps specifically to catch these things." Fresh readers checked nine drafts:
four had must-fix items and a fifth, K2, was dropped. In LIN-3601's, two items would by the notebook's judgement have
weakened a guard without failing any test, and replacing a mixed pin in place would have dropped a guard on 7 sites
outside the entrance. LIN-3602's would have blocked on John by asking for a ruling, from a stale baseline. LIN-3611's
did not name its repository. After launch, review sent back LIN-3611's 72.7% head and K1's location pins, and caught
LIN-3605's first build in the wrong repository (simple-dispatcher #272, closed unmerged). The scorers found half of
LIN-3601's grant sweep passing without reaching its target on two routes (LIN-3604 closed it), and a key-order change
in a stored argument on two LIN-3604 lanes, which the replay's sorted comparison missed; the saved row was
byte-identical.

**Cost, in John's currency: two presses and a day of wall clock.** It is counted in his attention and wall clock
first, then laptop load, then agent hours. On freeing the seam costing more than the move it enables: "agreed, but
that's kind of what I expected. It's also very cheap, from my perspective."
- **Attention:** two ruling presses, about 54 minutes and 4 minutes after each was raised. Beyond that, the framing,
  the constraints, approving more lanes, and "Don't update the work in progress. We can always redo this part with an
  improved process."
- **Wall clock:** 07:50Z to 16:44Z for all eight merges; kickoff-to-merge times sum to about 8 h 40 min across up to
  three lanes. Agent hours were not measured separately.
- **Lanes and laptop load.** John: "I wonder, can we open up additional lanes (being mindful not to overload the
  dashboard - fine for most sessions which aren't running heavy node scripts)." After LIN-3605, one heavy and two
  light lanes ran at once; the 10-CPU laptop's load average was 3.5 to 6.5, with no swap. Spotlight (42% CPU) was the
  largest consumer, and finished round-2 sessions still held `claude` processes.

## Method

Each step names a generic instrument; Harbour's instance is in brackets.
1. **Find diffuse decisions** with a standing coherence review that lists decisions held in several places (the
   Drift & Coherence Review) and an import map over a hand-made area guide that counts two-way area pairs
   (`seams.mjs` over `areas.json`); a census of copies can add what the review misses (`census.mjs`, a candidate).
   Rank by sites × churn: a scattered decision costs only when it changes.
2. **Make the ownership call before launch,** by a written rule: a decision belongs to the area that would have to
   change if its rule changed; a catch-all area owns nothing; where only the map is wrong, leave the code
   (`knots.md`). A fresh reader checks the call against every use, throw and catch site.
3. **Free the seam.** A move probe (move the code in a scratch copy and run the suite; each failure pins location) and
   a perturbation probe (behaviour-preserving rewrites; each failure pins how code is written). Land each behaviour
   replacement, show it failing with the guard removed, then loosen the old pin.
4. **Consolidate.** Sites per decision, by a counting rule or a grep of the sites that should remain, written into the
   ticket; one authority per decision, losing sites deleted in the same change, deliberate variations kept as named
   parameters, unclear ones kept as today and written up for a later ruling.
5. **Rebuild** the authority design-first, measured by shape (decision points, worst function) and by the share of its
   lines verbatim from the files it replaces, with a threshold in the definition of done.

Around each step: a prediction committed before filing, a fresh reader of the ticket, the ticket run through the
codebase's own pipeline (Harbour's autopilot, with a human ruling when a bounded review loop runs out), and scoring
after merge outside it. Behaviour was judged by differential replays, old against new, built outside the pipeline: for
the consolidations and the rebuild before launch, self-checked old against old and on planted mutants, then two seeds
after merge; for the unties, one input set before launch and two seeds after. The tests-only step was judged by the
move probe and mutation runs; the concurrency cap was not replayed. Records: `experiments/consolidate-*` and
`experiments/consolidate-exp3/NOTES.md`.

## Limits

- **One run per target.** Every figure is one sample. The entrance result is one decision cluster in one codebase.
- **The delayed outcome is untested.** Smaller later changes and fewer send-backs in touched areas
  (`coherence-as-it-grows.md`) are the real test of consolidation; none has had time to show.
- **The census's blind spots:** procedures, behaviour, single-literal checks, direction; about 1 in 4 of its top 25
  groups were borderline or noise. The sites-per-decision counts are hand or grep counts, checked by the scorers.
- **The replay's key-order blind spot.** It compared stored writes with keys sorted; the one key-order change was
  found by a rerun built for it.
- **Plan-loop rulings.** Two of three heavy-lane tickets hit the plan-review loop bound. LIN-3604 and LIN-3611 both
  listed what the plan must contain and only one converged, so the list alone does not explain it.
- **The wrong-repository slip** happened once in this round and, John says, before: "This wrong- repo issue has come
  up a few times. I suspect there's a fix, and a better solution. Might not be one for now." Parked; naming the
  repository in the ticket is a stopgap.
- **No independent author.** One session chose targets, wrote tickets and replays, and scored; predictions were
  committed first. Some PR bodies were unreadable to the scorers, so a few lines went unscored.
- **Gaming.** Renaming dodges regex signatures and relabelling the map moves knots; only the tickets forbade it.

## Next

These are options for John to choose from, not decisions.
- **Fold the census into the Drift & Coherence Review:** commit it beside `seams.mjs` with the same contract, have the
  review run it at the current and the previous edition's commit, and rule on every group with 3 or more files or 2 or
  more areas. A proposed next detector, repeated single comparisons, is meant to catch inline `=== 'blocked'` checks.
- **Give plan reviewers the conversion rule** the worker gets: a text pin may go once a behaviour check of the same
  property lands first. And tell untie workers the witness is behaviour and the seams output, not location.
- **The three single-import knots left:** Auth ↔ Providers needs a fresh ownership call now that K2's failed.
  Other ↔ Platform is the area guide's error, so its fix is a map edit, which this round's tickets forbade.
  LLM ↔ Providers is medium risk and needs a replay.
- **Census-only consolidations:** the free-tier refusal body (13 sites) and the loopback-host rule (7). The two "is
  this issue closed" sets need a ruling on `duplicate` first.
- **Open questions the round left:** on LIN-3339, `[pending]` in the transcript highlight and `[blocked]` checked
  before the closed row; LIN-3607 and LIN-3608 for the entrance's eight; LIN-3603, likely a duplicate of LIN-3604.
- **Kit fixes:** an order-aware comparison in the replay; a per-region verbatim table; `acorn` in the runner's
  checkout. And the wrong-repository fix when John wants it, Spotlight exclusions, and reaping finished sessions.
- **Whether Harbour should run the sequence routinely.** John put how Harbour does this for later, after checking the
  idea lands. A delayed re-measure of the touched areas, proposed in `proposals.md`, would be that check.
