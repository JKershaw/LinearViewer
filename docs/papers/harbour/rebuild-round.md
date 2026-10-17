---
title: Is a design-first rebuild a viable, cheap way to improve Harbour's code, and what does it improve?
kind: paper
version: 1
date: 2026-10-17
authors: [Claude, for John Kershaw]
model: "Frontier tier, claude-code, effort not recorded; one interactive cloud session with John Kershaw (the Flight Companion), not dispatched through Harbour (no dispatch id). The rebuilds themselves ran as Harbour tickets, whose stage models the dispatch lineage reports. The independent replays, ticket drafts, fresh-reader checks and scores were built by in-session subagents and read by the main session; this draft was written by one from those records."
grounded_at: 603853c5 (LinearViewer, origin/main)
cites: [experiments/rebuild-exp2/NOTES.md@0fb4793a:451 (and the additions in this PR), experiments/rebuild-rung5d/@0fb4793a, experiments/rebuild-rung5b/@0fb4793a, experiments/rebuild-rung5a/@0fb4793a, experiments/rebuild-rung6a/@0fb4793a, experiments/rebuild-rung5c/@0fb4793a, experiments/rebuild-rung6b/@0fb4793a, experiments/rebuild-rung7/@0fb4793a, experiments/replay-kit/@0fb4793a, experiments/verbatim/@0fb4793a, experiments/periodicals-before-after/ (this PR), experiments/rebuild-exp1/kit/@0fb4793a, docs/papers/harbour/rebuild-ladder.md@0fb4793a, docs/papers/harbour/the-second-copy.md@603853c5:57, docs/papers/harbour/coherence-as-it-grows.md@603853c5:191, docs/papers/harbour/one-job-many-paths.md@603853c5:26, docs/papers/harbour/theseus.md@603853c5:25, docs/papers/harbour/flow-and-convergence.md@603853c5:50, docs/papers/harbour/drawing-the-ship.md@603853c5:138, docs/papers/harbour/paid-where-written.md@603853c5:35, scripts/code-shape/seams.mjs@603853c5, scripts/code-shape/areas.json@603853c5:36, docs/papers/harbour/coherence-as-it-grows-scripts/known-decisions.sh@603853c5, docs/papers/harbour/coherence-as-it-grows-scripts/coherence-census.mjs@603853c5, lib/dispatch-entrance.js@603853c5:11, PR #1901 (2026-10-16), PR #1902 (2026-10-16), PR #1903 (2026-10-16), PR #1904 (2026-10-16), PR #1905 (2026-10-16), PR #1906 (2026-10-16), PR #1907 (2026-10-17), PR #1908 (2026-10-17), simple-dispatcher PR #271 (2026-10-16), LIN-3578, LIN-3579, LIN-3580, LIN-3590, LIN-3591, LIN-3592, LIN-3596, LIN-3583, LIN-3585, LIN-3581, LIN-3586, LIN-3587]
---

# Is a design-first rebuild a viable, cheap way to improve Harbour's code, and what does it improve?

Yes, viable and fairly cheap, and what it improves is the inside of the files it touches. Seven more design-first
rebuilds ran through ordinary Harbour tickets on 16–17 October, from 441 to 2,816 code lines, the largest three times
the size `rebuild-ladder.md` had tried. All seven merged, and an independent replay of each found no regression that
matters. They fixed 12 bugs on the way; the only other changes were fuzz on edge inputs and harmless reorderings of
JSON keys. Each took 50 minutes to about 2.5 hours of run time; the two longest stretched to 3.3 and 4.6 hours of wall
clock through infrastructure faults, not the method. The worst function fell in every rung, by 40–88%, and over both
rounds of the ladder the codebase's count of functions at 50 or more cyclomatic complexity halved, from 21 to 10. But
the rebuilds did not move where decisions live, which their tickets never asked of them. Tangles between areas went
from 19 to 20, and every named decision is held in as many files as before. Three of the seven also drifted toward
editing the old file: review sent two back, and the third merged as an edit. So a rebuild simplifies; it doesn't
consolidate. The proposal at the end: aim the next ones at a decision's location, not a file's complexity.

## Findings

**Seven rebuilds, all merged, none with a regression that matters.**

| Rung | Chunk (ticket, PR) | Code lines | Decision points | Worst function | Verbatim | Fixes | Run (wall) | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 5d | `pipeline-loops.js` (LIN-3578, #1901) | 800 → 634 | 388 → 300 | 113 → 29 | 48% | 1 | 67 min | Comment lines 967 → 409 |
| 5b | 4 page renderers (LIN-3579, #1903) | 2,313 → 2,057 | 917 → 693 | 75 → 45 | 55% | 2 | 2 h 33 (3 h 17) | Wrong checkout, reboot; 0 of 1,037 real texts changed |
| 5a | Dispatch factory and validation (LIN-3580, #1904) | 727 → 636 | 285 → 226 | 181 → 49 | 46% | 4 | 90 min (4 h 36) | Reboot, paused for the two-run cap |
| 6a | `task-page-loader.js` (LIN-3590, #1905) | 441 → 488 | 287 → 257 | 77 → 13 | 53% | 1 | 96 min | First push an in-place edit; review sent it back |
| 5c | 3 dispatch entrance routers (LIN-3592, #1906) | 2,450 → 2,158 | 708 → 649 | 122 → 63 | 86% | 1 | 106 min | 17 pinned tests; an edit by this measure; key order |
| 6b | `kpi-stats.js`, the `/kpis` boundary (LIN-3591, #1907) | 598 → 463 | 152 → 99 | 77 → 9 | 39% | 1 | ~50 min | No function over 10 left |
| 7 | `workspace-api.js` (LIN-3596, #1908) | 2,816 → 2,223 | 769 → 589 | 57 → 31 | 51% | 2 | ~2 h 07 | First head 79% verbatim, sent back; key order |

Code lines exclude comments and blanks, and include any helper module the rebuild added (three did). Decision points
are cyclomatic complexity minus one per unit (each function and the module), from
`experiments/rebuild-exp1/kit/shape.mjs`. Worst function is the highest per function in the chunk. Verbatim is the
share of the new non-trivial lines found verbatim in the old (finding 3). Run is kickoff, or the relaunch that
finished, to merge or Done as the score records it; wall clock from first launch in brackets where it differs.

Each replay ran two seeds of 3,193 to 19,856 inputs: calls captured from the tests, targeted edges and seeded
generated cases; where measured, line coverage was 99–100%. In four rungs, patching the listed fixes (and, for 5c and
7, the key order) into the old copy left zero differences. In the other three, what remained was fuzz: error wording
on malformed input (5d, 5a), property-read order on getter bodies (5a), and in 5b whitespace between two closing tags
and a Periodicals case no caller produces.

| Fix | Where | Reach |
| --- | --- | --- |
| A non-numeric stored count was concatenated as text into the public `freeTier.counts` | `/kpis` stats (6b) | A privacy leak in form; unreachable with real data, since the store only increments |
| Identifier, assignee and estimate rendered unescaped in the details line | Renderers (5b) | An assignee of `<b>` became a live element |
| Periodicals rows counted in Home's ordering, hiding the top-task mark | Renderers (5b) | Workspaces with Periodicals on |
| Store reads that threw synchronously or returned `undefined`, a failed consumer stamp, and a duplicate with a null `dispatchedAt` | Dispatch factory (5a) | A TypeError or raw 500, a rejection after a token was minted, or a spurious 409 |
| A throwing credential adoption on comment POST escaped as a bare 500; a repeated `?url=` on `/image` was a TypeError 500 | Workspace API (7) | Both tighten security-area errors: now classified, and a 400 |
| A lean abort never reached a digest-less target, so its session window stayed open | Pipeline loops (5d) | Lean callers' session grouping; stored sessions keep the old grouping until rebuilt |
| A null close-out event made a "never throws" read reject the whole task page | Task page loader (6a) | The page failed to load |
| `recommend-and-dispatch` with a `kind` dropped `waitForFollowUps` | Dispatch entrance (5c) | Override dispatches |

The two "harmless" changes are JSON key order: every non-cascade 201 from `POST /api/proxy/dispatch` (5c), and three
scan routes' 200s (7). Same values, so only a weak ETag changes, on a POST. 5c's ticket allowed no fuzz on a success
body, so it counts as a regression there, and rung 7's is scored the same way.

**Cheap: under two hours of run time for most rungs, and the delays were infrastructure.** Five of seven ran kickoff
to merge or Done in 50–106 minutes; the largest file took about 2 hours. Not one was split, since every ticket said
"This is one PR. Don't split it into child tickets." Only 5b is recorded as raising rulings (two, at close-out; 5a's
history is not visible). The long wall clocks came from three things outside the method: a worker that reported the
wrong repository's checkout, a laptop reboot that killed one worker and another's background forks, and a cap of two
concurrent runs. The round surfaced three infrastructure fixes, of which two merged during it:
- **LIN-3583** (PR #1902): local e2e loaded `.env`, so it could have reached a configured database. Its database URI
  is now pinned empty, with its data directory isolated.
- **LIN-3585** (simple-dispatcher PR #271): the dispatcher re-parsed its state file about 11 times a cycle. Its CPU
  went from about 12.5% of a core idle before the fix to about 3.4% with three sessions running after it.
- **Spotlight indexing** of the dispatcher's workspaces, left to John to exclude on the laptop.

**The design-first instruction alone doesn't stop an agent editing the old file; a measured Done-when line, enforced
by review, did in the one run that carried it.**

| Method | Tickets | New lines found verbatim in the old |
| --- | --- | --- |
| Clean room | LIN-3557, LIN-3565 | 13–19% |
| Design-first, first ladder | LIN-3566, LIN-3569, LIN-3573 | 37–41% |
| Design-first, this round | LIN-3578, 3579, 3580, 3590, 3591, 3596 | 39–55% |
| Informed rewrite | LIN-3556 | 82% |
| Design-first on paper | LIN-3592 | 86% (longest verbatim run 151 lines) |

Small idiomatic lines recur in any faithful rewrite, so a rebuild lands in a band, not at zero. Two runs left it:
- **LIN-3592**, the most pinned ticket: 17 source-text tests, many requiring exact lines, plus 6 whole-tree scans.
  Outside the pinned blocks it was still 83%. Its own helper's header says each entrance keeps its own reads,
  enqueues, mints, gates and replies "because the source-text censuses pin them by the route they sit in".
- **LIN-3590**, the first ticket launched with the lighter efficiency wording. Its first push was the old file edited
  in place; code review sent it back, and the rebuild came in at 53%.

Rung 7's ticket then carried a new Done-when line: report the share, and above about 60% outside pinned text, explain
or redo the design. Its first head was 79% verbatim, review sent it back citing that line, and the redo merged at 51%.
The PR says the design step was still done with the old file open. The measure is formatting-sensitive: the trailing
semicolons rung 7 added are worth about 6 points (57.6% without them); earlier rungs' figures are not normalised.

**The Periodicals show complexity falling and decision location unchanged.** The same tools were run at the
commit before the first rebuild of the ladder (`2a07f3ea`, 15 October) and at `603853c5` (after rung 7), so this
covers both rounds: 18 rebuilt files and the 3 helper modules they added.

| Measure (`server.js`, `lib/`, `routes/`) | Before | After |
| --- | --- | --- |
| Functions at cyclomatic ≥ 50 / ≥ 100 | 21 / 4 | 10 / 1 |
| Functions over 10 | 597 | 572 |
| Rebuilt files: code lines / decision points | 12,219 / 4,139 | 10,341 (−15.4%) / 3,332 (−19.5%) |
| Whole tree: code lines | 75,301 | 73,425 (−2.5%) |
| Seams & Tangles: two-way area pairs (knots) / knot groups | 19 / one of 9 areas | 20 / one of 9 |
| Known decisions, files per decision (11 named) | 5, 0, 0, 5, 8, 6, 4, 2, 6, 15, 19 | identical |
| Production comments admitting a second copy / sync-pinning tests | 123 / 34 | 121 / 34 |

The rebuilt files account for all of the tree's change, to within two lines. At `91fca7dd`, before rung 7, the
figures were 21 → 11 functions at 50 or more, and −13.7% code and −18.6% decision points in the files rebuilt by
then. The first ladder (to `350242d5`) moved no area-level number at all. The one new knot came from LIN-3579's
helper `lib/home-swipe-prompt-opts.js`, which its header says exists "so the computation lives here once"; no
pattern in the area guide names it, so it fell into the catch-all area and tied it to the pages. Rung 7's helper
`lib/workspace-api-mocks.js` matched the guide's `workspace-*` pattern and landed in the auth area, thickening two
existing knots. LIN-3592's helper added two imports from the Agent API into Runs. No knot was untied. The wrong-way
imports the Seams & Tangles baseline review named all remain, including ones to and from the rebuilt
`render-swipe.js` and `task-page-loader.js`, and none of its three promoted follow-ups landed. The admissions
census's net loss is rewordings it no longer matches (read line by line at `91fca7dd`); no declared twin was retired.

So a rebuild simplifies inside the files it is given, and leaves where decisions live as it found them, by every
measure the Periodicals have. That was built in: each ticket kept its files' exports and imports and put other files
out of scope, and only `proxy-rulings.js` among them holds any of the 11 named decisions.

**A proposal: choose and judge rebuilds by decision location.** Harbour's papers and essays already argue that
location is the thing to move. A decision held in more places than one change reaches is paid for when it changes, so
the remedy is one place to change and deletion as part of done (`the-second-copy.md`). A change can count as finished
when the decision it touched has one authority again, with sites per touched decision as the measure
(`coherence-as-it-grows.md`). The unit of consolidation is the decision, one authority reached by every caller, not
the file or the endpoint (`one-job-many-paths.md`). A consolidation that puts its one place in the wrong area ties a
knot (`theseus.md`), which this round reproduced. What is counted but not limited grows (`flow-and-convergence.md`).
`drawing-the-ship.md` names the change wanted: specks, the scattered sites of one decision, becoming an ingot. And a
fix written as a rule is paid on every run, where one written into code is paid once (`paid-where-written.md`); this
round's prose "don't copy" rule slipped in three of seven runs, and only rung 7's review had a measured share to cite.
Proposed, untested:
1. **Choose targets by where a decision lives,** from the census and the knots, not by the worst function.
2. **Write the ticket around one authority per decision:** name the decision, its sites and the area its one place
   belongs in, and make deleting the losing sites part of Done-when.
3. **Measure with the Periodicals,** before and after: sites per decision, knots tied and untied, the worst
   function, and the verbatim share.

**Two independent replays caught more than either alone.** Each rebuild was judged by the worker's own replay and
by one built outside Harbour before launch. Mine caught both key-order changes, which the workers' replays did not
report: rung 7's compared JSON with key order ignored, and 5c's said it compared the bytes sent and missed it. The
worker's caught the `/kpis` leak, which mine missed: my generator only ever made numeric counts, so its privacy scan
read "clean" on the old side too. A canary probe afterwards found the old code leaking on 52 of 196 inputs.

## Method

The method is `rebuild-ladder.md`'s design-first one: an independent replay built before launch, a prediction
committed before launch, a ticket ordered requirements, design, build, then the worker's own replay, a fresh-reader
check of the ticket, launch through Harbour's autopilot, and scoring after merge on two seeds against the
prediction. John's success definition still applies: "what we end up with matches the utility of what came before,
but the code is _cleaner_ (cognitively simpler, less room for bugs, easy to maintain)." Targets came from a shape scan
of all 392 `lib/` and `routes/` modules. What changed this round:
- **Sub-agent steering.** Subagents built the replays, drafted the tickets, ran the fresh-reader checks and scored;
  the main session read short summaries (`NOTES.md`, 16 October ~18:10Z).
- **A shared replay kit,** `experiments/replay-kit/`, first used for rung 6a, then 6b and 7 (with router support).
- **Efficiency rules,** from the 5a relaunch on: no parallel forks or background agents, targeted tests while
  iterating, e2e left to CI, and a lighter worker replay, since the independent one checks the merge.
- **Comment retention:** keep every ticket reference and reason comment by its code (after 5d dropped 17 of 51).
- **The verbatim-share Done-when line** (rung 7). Shares here are `experiments/verbatim/verbatim.mjs`'s: trimmed
  non-trivial lines, comments and imports excluded, multiset match against the merge's first parent.

The Periodicals were read with their own tools: `scripts/code-shape/seams.mjs` (Seams & Tangles) with one area guide
at every commit; `known-decisions.sh` and `coherence-census.mjs admissions` (Drift & Coherence's scriptable siblings).
Code Quality has no committed tool, so the rebuild kit's function measure stands in for it, applied to every file.
The before-and-after scripts and their outputs are in `experiments/periodicals-before-after/`. Every arm, prediction, ticket, replay and score is under `experiments/`.

## Limits

- **One run per module.** Each rung is one sample, so none of the figures is a rate; the fixes depend on the module.
- **Proxy measures.** Decision points reward splitting: 6a's code grew 11% as its worst function fell 83%. The
  verbatim share moves with formatting. No person has judged the rebuilt code cleaner in John's sense.
- **No independent author.** The same session chose the targets, wrote the tickets and replays, and scored them.
  Every prediction was committed before its ticket was filed, which limits but doesn't remove that.
- **Shared blind spots.** A replay sees only what its generator makes; 6b's missed a whole class of input.
- **Lost context.** 5d cut comment lines by 58% and dropped 17 ticket references before the retention rule; rung 7
  dropped one reference (LIN-772/773) whose code remains, despite the rule and the PR's claim that none was dropped.
- **Mixed models.** Harbour's stage models varied by stage and were not held fixed.
- **The CPU figures** are two point samples by read-only research dispatches, idle before the fix and with three
  sessions after it, so they are not like for like; the drop is if anything understated.
- **Location was out of scope.** No ticket asked for a decision to move, and the 11 named decisions barely touch the
  rebuilt files, so "unchanged" was expected; neither census sees consolidation inside a file.

## Next

- **A decision-location rebuild,** written to the proposal above, on one decision the census holds in many files,
  scored on sites per decision and knots as well as shape. One line goes into `proposals.md`.
- **A person's reading** of two or three rebuilt files against John's definition, beside the count.
- **Kit and measure fixes:** canaries in numeric fields; trailing semicolons normalised in the verbatim share;
  an area for every new helper module named in the guide before merge.
- **Small follow-ups the scores left:** `BUILDER_VERSION` for 5d's regrouped sessions; LIN-3581, the consumer stamp's
  cause; LIN-3586 and LIN-3587 from 5b.
