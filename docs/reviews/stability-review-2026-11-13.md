# Stability Review — 2026-11-13 (run 6, delta vs 2026-11-08)

*Advisory, trend-aware, review-only. Periodical: **Stability Review**; review task: LIN-4442 (run 6). Diffed against
`stability-review-2026-11-08.md` (LIN-4394, run 5), with `2026-11-04`, `2026-10-21`, `2026-10-12` and the `2026-06-25`
baseline as history. This report changes no code, config or docs beyond itself and its evidence folder, and **mints no
follow-up tasks**. It reads the project's trajectory: is the rate of change converging toward a settled state, or failing
to settle? The decision is the maintainer's.*

**Examined.** LV `163efc069` (LinearViewer `9574d537..163efc069`, **35 first-parent landings**, 2026-11-08 17:10Z to
2026-11-12 23:17Z, ≈4.26 days). SD `af9b496` (simple-dispatcher `5d8489e..af9b496`, **3 landings**). The base is run 5's
head pin, as `docs/reviews/stability-measures/README.md` fixes it; `reading.json` → `window.head` is
`163efc0698934c3e8a5f3c30e48dc15b51ac3a24`. Evidence and every command: `docs/reviews/_evidence-2026-11-13-stability/`.

## The declared measures (opening)

This is the first report to open with the repository's declared measures (LIN-4399; `docs/reviews/stability-measures/README.md`,
written by LIN-4423). The table is `table.txt` from **one full run** of the committed tool, exactly as declared, from the LV root
with SD beside it at `af9b496` and `HARBOUR_LOCAL_BASE` set (13 min 21 s; 662 proxy calls, one 429 retry):

```
node scripts/stability-measures.mjs . 9574d537 HEAD --runner ../simple-dispatcher \
  --reference docs/reviews/stability-measures/reference-2026-11-08.json > reading.json 2> table.txt
```

Each row is followed by its 8 Nov reference (`5334c81a..9574d537`, 114 landings), summarised by the same rule. The rows are
printed as the tool wrote them, endpoint totals included:

```
stability measures 9574d5371..163efc069 (2026-11-08T17:10:36Z → 2026-11-12T23:17:49Z), 35 landings
1. No new mess
   blind            2 of 35 landings read blind before merge (better 1, same 1, worse 0); unread: no ticket 0, not an ordinary landing 11, landed before the gate 20, no read on record 2
                    8 Nov: not measured: no 8 Nov reading; the first reading sets it
2. The curve
   lines            net +2,293 (code +1,233, comment-only +934, blank +126); +65.5 per landing; totals 206,784 → 209,077; comment-only share 39.73% → 39.74%
                    8 Nov: net +6,558 (code +3,034, comment-only +3,185, blank +339); +57.5 per landing; totals 200,226 → 206,784; comment-only share 39.44% → 39.73%
   churn            3,277 added, 984 deleted over 35 landings; 93.6 added and 28.1 deleted per landing; 0.3 deleted per added
                    8 Nov: 10,235 added, 3,677 deleted over 114 landings; 89.8 added and 32.3 deleted per landing; 0.36 deleted per added
   ci               median 9.07 min over 35 runs (35 of 35 landings)
                    8 Nov: median 8.59 min over 114 runs (114 of 114 landings)
   waiting.harbour  56 → 98 (+42, +1.2 per landing)
                    8 Nov: 0 → 56 (+56, +0.49 per landing)
   waiting.runner   10 → 12 (+2, +0.06 per landing); main 5d8489e7f..af9b496d5
                    8 Nov: 0 → 10 (+10, +0.09 per landing); main 9478e1c53..5d8489e7f
   waiting.total    66 → 110 (+44, +1.26 per landing)
                    8 Nov: 0 → 66 (+66, +0.58 per landing)
   minted           48 over LIN-4394 → LIN-4442, 1.37 per landing (ID-span estimate; 14 probes)
                    8 Nov: 190 over LIN-4204 → LIN-4394, 1.67 per landing (ID-span estimate; 22 probes)
3. Speed
   tasks            33 finished (1 landed before base); of 34 tickets landed here, 1 not done and 1 done outside the window; 0 landing(s) own no ticket; lookback 3 days
                    8 Nov: 106 finished (1 landed before base); of 106 tickets landed here, 0 not done and 1 done outside the window; 0 landing(s) own no ticket; lookback 3 days
   speed            median 86.5 min (mean 114.8) first dispatch → last landing; median 7 sessions (mean 7.18); 33 of 33 tasks
                    8 Nov: median 56.3 min (mean 124.6) first dispatch → last landing; median 5 sessions (mean 5.61); 106 of 106 tasks
4. The person's seat
   rulings          loop rulings only: 16 raised over 33 finished tasks, 0.48 per task (distinct decisions); answered 100% of answered + dismissed (answered 12, dismissed 0, withdrawn 4, open 0); not read: answered task-bound rulings (anchor.taskDecisionId): no proxy read returns them; rulings anchored on a parent or another unfinished ticket are not counted against a finished task (4 on a finished task's parent)
                    8 Nov: not measured: no 8 Nov reading; the first reading sets it
   origin           not measured: dispatchedBy is the workspace account for autopilot and person alike
                    8 Nov: not measured: no 8 Nov reading; the first reading sets it
   operator-free    upper bound: 66.7% (22 of 33 tasks) with no loop ruling, no [blocked] marker in any lineage member's feedback, no dispatch row closed with closedReason 'operator'; failing: ruling 11, blocked 4, operator-closed 0; missing condition: no person-started dispatch (not measured: dispatchedBy is the workspace account for autopilot and person alike); closedReason 'operator' is a catch-all and may push the share down
                    8 Nov: not measured: no 8 Nov reading; the first reading sets it
5. Cost per finished task
   cost             median $16.7 (mean $18.34) over 33 of 33 tasks; unpriced 0, noTelemetryCount 0, unreadableCount 0, noLineage 0
                    8 Nov: median $9.53 (mean $14.29) over 106 of 106 tasks; unpriced 0, noTelemetryCount 0, unreadableCount 0, noLineage 0
```

**Read as declared** (the declaration's notes, not findings):

- **`blind` reads almost entirely "landed before the gate" (20 of 35), as declared.** The gate is PR #2413 (`eb14b7fff`,
  12 Nov 21:06Z; `GATE_LANDING` in `scripts/stability-measures-blind.mjs`). Four ordinary landings follow it: two were read
  (LIN-4424 *same*, LIN-4439 *better*) and two were not (LIN-4441 `e3a3268a1`, merged 16 minutes after the gate with no read
  naming #2414; LIN-4396's close-out PR #2416, which is not on that ticket's landing). n = 4 is a first reading, not a rate.
- **`waiting.*` and its 8 Nov reference measure different things.** The area notes were created inside the reference window
  (LIN-4371 onward), so its `0 → 56` is the notes being written, not a rate of accumulation. +1.26 per landing here against
  +0.58 there is not a like-for-like rise; F3 reads the stock against its own sub-windows instead.
- **`ci` crosses a structural break** (LIN-4441, PR #2414). The declared median is printed as the tool reads it; F7 splits it.
- **The tracker rows are the tracker as read on 2026-11-13.** A later wake can move `tasks`, `speed`, `rulings`,
  `operator-free` and `cost` (declaration, "Re-running it").
- **The instrument changed inside the window.** Ten of the 35 landings are the measuring and gating programme itself
  (LIN-4420–4424, 4436–4439 and the LIN-4396 close-out). They supply 47% of the production lines `churn` counts (F2). The
  reference file itself was edited once by LIN-4439, to drop the retired `sample` row; no reference value changed.
- **LIN-4399's acceptance items (f) and 4** ask for a blind sample of ≤8 tickets and a `signs.json` re-run with `--blind`. LIN-4439
  (`aebe61081`, merged before this run) retired both, and the tool at HEAD has no `--blind` flag and no signs file (declaration,
  "The blind read"). There is nothing to produce for (f) and 4; producing it would contradict the declaration at HEAD.

**Closed as superseded** by this opening, as the declaration's "What this retires" says: the two per-day rows
`project-velocity-trajectory` (LV) and `project-velocity-trajectory` (SD). `ticket-mint-vs-landing` is also closed as
superseded, by the declared `minted` row, which reads the same ratio on one repository's landings (see the ledger).

## Measurement decisions (read these before the trajectory)

1. **Pins.** LV and SD heads were re-fetched at execution: `origin/main` was `163efc069` and `af9b496`, the same pins research
   read. The mint-time count of 34 LV landings is superseded by 35 (the LIN-4396 close-out, #2416, merged after mint).
2. **No measuring scripts.** The declaration retires them. Everything below comes from the committed tool (the full reading and
   four sub-windows run with `HARBOUR_LOCAL_BASE` unset, so the git and `gh` rows read and the tracker rows print
   `not measured`), from single-line `git`/`gh`/proxy commands, and from `jq` over `reading.json`. All are printed with their
   output in `oneliners.txt`. Run 5's scripts were read for their path lists only.
3. **Sub-windows.** `9574d537..eb14b7fff` (31 landings) and `eb14b7fff..163efc069` (4) split the CI series at #2414.
   `9574d537..b349c219b` (18) and `b349c219b..163efc069` (17) split the Waiting series at LIN-4414's retirement rule.
4. **Two CI definitions, kept apart.** `ci` is `ciRow`'s (successful runs, `updatedAt − startedAt`).
   `scripts/measure-ci-wall.mjs` (`createdAt`, queue included) is not used. Per-job durations come from
   `gh run view --json jobs` and are used only to name the critical path.
5. **Small n, right-censored.** 35 landings over 4.26 days, the last day open at 23:17Z. Every trajectory claim is read against
   run 5 and the sub-windows, never from this window alone. Day split (UTC): **1 / 0 / 12 / 3 / 19** (11-08 to 11-12).
6. **Relative, not absolute.** Rates are given per landing, per finished task, or as a share of the thing measured. Per-day rates
   are given beside them only where run 5 used per-day and the comparison needs it.

## Headline read

**The product is settling; the process around it is costing more.** Measured per landing, the product's change looks calmer than in
run 5: fewer deletions per line added, the former dispatch and proxy hotspots nearly silent, the Home cluster quiet, test-suite
growth down to a quarter of its run-5 pace, and no reverts. But 28 of the 35 landings (80%) are governance, measurement,
periodical reviews or research. Most of the window's change sits in the layer those landings build (the area notes, the loop's stages,
the blind read and the measures this report opens with). Its newest parts were rebuilt within hours, though its overall touch
rate is flat against the end of run 5. The clearest measured consequence is the cost of a finished task: up 75%, because
the loop now runs more sessions per task and each session costs more.

- **Rate.** 35 landings in 4.26 days (8.2/day, against run 5's 25.6). The fall is **absent supply, not slowdown**: no LV PR
  was created between #2382 (11-08 17:58Z) and #2383 (11-10 08:03Z), about 38 hours, or between #2394 (11-10 14:33Z) and #2395
  (11-11 21:50Z), about 31 hours. The 11-09 silence and the 11-11 dip are those two gaps. Per-landing rows are unaffected by design.
- **Shape.** Production churn per landing is flat (93.6 added against 89.8), net growth per landing slightly up (+65.5 against
  +57.5), deleted per added down (0.30 against 0.36). The comment-only share did not fall (39.73% → 39.74%), so the signal the
  declaration watches is quiet.
- **Converging, by the same measures:** test-suite growth (F7); `docs/reviews` weight (F4); the dispatch, proxy, Home and
  runner-kit hotspots (carried rows); the bookkeeping indexes; rewrite-in-place on code; true reverts (still 0).
- **Not converging:** cost and sessions per finished task (F1); the Waiting stock, which
  still grows on every landing though at half its earlier pace (F3); prompt-contract growth per landing (F5); and a shorter
  build-then-retire cycle, inside the measurement layer (F6). The process layer's mix (F2) is a first reading: no trend yet.

## Findings (severity-ranked; each a delta against 2026-11-08)

Ranking reason, stated once: **F1 ranks first** because it is the largest relative move on any declared measure (+75% cost
per finished task), with a code-set floor under it. **F2 ranks second** because it is the shape every other row in this window
sits inside, though as a first reading it shows no trend of its own. F3 ranks third because its stock is still rising after
the rule meant to drain it. (The second read moved F2 down from first; see the appendix.)

### F1 — `per-task-expense` (new) · Severity: Medium · **new: cost per finished task +75%, on a structural break in the loop**

| | 8 Nov reference (106 tasks) | this window (33 tasks) | change |
|---|---|---|---|
| median cost (`cost`) | $9.53 | **$16.70** | +75% |
| median sessions (`speed`) | 5 | **7** | +40% |
| median minutes, first dispatch → last landing | 56.3 | **86.5** | +54% |
| median cost per session (`jq` over each reading's `perTask`) | $1.72 | **$2.31** | +34% |
| tasks with ≤4 sessions | 50 (47%) | **1 (3%)** | |
| tasks with ≥6 sessions | 43 (41%) | **31 (94%)** | |

- **Both factors moved.** Sessions per task rose by about 40% and cost per session by about a third; 1.40 × 1.34 ≈ 1.88,
  against the 1.75 observed in the medians. So the rise is neither "more sessions" nor "dearer sessions" alone.
- **The session floor is set by code, and it moved at the window's edge.** LIN-4370 ("code runs the look-first sequence
  (Surveys, then scoping) at both recommendation seams", merged `f0388614c` 11-08 14:30Z) landed **2.7 hours before run 5's
  pin**. Almost every reference task predates it, and every task here postdates it. A lineage now opens with `survey-task`,
  `survey-place` and `scoping` before implementation (LIN-4420's `/cost`: survey-task, survey-place, scoping, implementation,
  review, close-out). The reference's modal task had 4 sessions (36 of 106); here it has 6 (14 of 33). Close-out sessions per task did not
  rise (0.95 → 0.91), and the blind-read stage (from 19:22Z on 11-12) reached only 4 tasks.
- **Not a mix effect.** The 9 periodical tasks have a median of $17.08 and the 24 others $16.70.
- **Cost by stage kind**, per finished task. This comes from each task's `/cost` `workerSessions`, read live on 2026-11-13
  for both task sets with a recorded `curl | jq` one-liner (`oneliners.txt`). These are means over the summed session costs
  ($14.15 and $18.09 a task), not the declared medians:

  | stage kind | 8 Nov tasks: sessions / $ per task | this window: sessions / $ per task | change in $ per task |
  |---|---|---|---|
  | look-first prefix (`survey-task` + `survey-place` + `scoping`) | 0.66 / $0.65 | **2.64 / $2.84** | **+$2.19** |
  | `implementation` | 1.04 / $5.78 | 1.00 / $7.06 | +$1.28 |
  | `research` | 0.18 / $1.32 | 0.27 / $2.26 | +$0.94 |
  | `review` | 1.08 / $1.63 | 0.97 / $1.59 | −$0.04 |
  | `close-out` | 0.95 / $1.28 | 0.91 / $1.45 | +$0.17 |
  | `blind-read` (new) | — | 0.12 / $0.14 | +$0.14 |
  | everything else (autopilot, plan, plan-review, custom, bug, …) | — | — | −$0.74 net |

  The look-first prefix explains about **55%** of the mean rise of $3.94 a task. Dearer implementation sessions ($5.57 → $7.06
  each) explain about a third, and more research about a quarter, offset by fewer `custom` and `bug` sessions.
  The prefix's +2 sessions a task match the +2 in the median.
- **Reading.** Like `ci`, the `cost` and `speed` series break structurally at the window's start, so the +75% is a step,
  not yet a trend. It is real cost all the same: every finished task now pays for a fixed look-first prefix, and the
  declaration says cost is "measured, not optimised for now". **Whether it converges is next run's question:** with the
  break behind it, a flat median would mean a new level; a still-rising one would mean the per-session cost or the stage count
  is growing. LIN-4349 (531 min, 12 sessions, $35.77) and LIN-4421 (424 min) are the long tails; the mean minutes fell
  (124.6 → 114.8), so the tail is shorter while the middle is longer.

### F2 — `change-composition-inward` (new) · Severity: Low–Medium · **new: four landings in five are process, not product; the process layer's newest parts were rebuilt within hours**

Every one of the 35 landings is classified, with no remainder (subjects and PR titles in `oneliners.txt`):

| class | landings | share | members |
|---|---|---|---|
| Measuring and gating programme | 10 | 29% | LIN-4420, 4421, 4422, 4423, 4424, 4436, 4437, 4438, 4439; LIN-4396 close-out |
| Periodical reports | 9 | 26% | LIN-4394, 4402, 4403, 4407, 4406, 4412, 4411, 4413, 4418 |
| Periodicals and loop process | 4 | 11% | LIN-4390 (hand-off), 4398 (no Surveys for gated reviews), 4415, 4414 (one retirement per build) |
| Papers | 3 | 9% | LIN-4426, 4427, 4428 |
| Outside-find and audit governance | 2 | 6% | LIN-4431 (consequence gate), 4432 (audit notes PR) |
| **Product and infrastructure** | **7** | **20%** | LIN-4404 ×2, 4392, 4405, 4419, 2386, 4441 |

- **Product-facing change is about 1.6 landings a day.** Run 5 did not classify landings this way, so this is a new row, not
  a measured fall. The product landings are small and spread out: one UI feature (LIN-4405, "Sessions on one clock", 1,115
  production lines, 34% of the window's production churn), one cost read (LIN-4404), one recommendation-path wait (LIN-4392),
  and four infrastructure changes.
- **The process layer supplies about half the production churn.** Of the 3,277 production lines `churn` counts, about 1,550
  (47%) come from the measuring, gating and loop landings (`e3829b9f9` blind-read stage 612, `eb14b7fff` gate 358, `b349c219b`
  LIN-4414 212, and nine smaller). The rest is product (1,719 lines, chiefly LIN-4405 and LIN-4404) plus 11 lines from paper landings. Paper landings also
  *deleted* 150 production lines: LIN-4426 (`94893cc35`) removed `listSessions` from `lib/agent-status-store.js` (138 lines).
- **Outside production scope, the process layer is the busiest surface, at a flat rate.** `docs/areas/` was touched by
  **28 of 35** landings (80%), and its bytes nearly doubled (33,916 → 65,654). Like for like, that rate is **flat**. The notes
  were created at `526bca66c` (LIN-4371, 11-08 02:29Z), 26 landings before run 5's pin, and 20 of those 26 touched them (77%).
  Lines added per landing fell from 26.8 (698 / 26) to 21.5 (754 / 35). Run 5's "20 of 114" counted landings from before the
  notes existed. The touches are the rule working (F3). The stability tool and its test took
  **+2,957 / −324 lines in 5 landings over about 14 hours** (LIN-4420, 4421, 4422, 4423, 4439). `scripts/` was touched by 17 landings, mostly that tool.
  The prompt ceiling grew mainly from the blind read (F5).
- **The measurement layer iterated within hours.** The blind read went from pilot (LIN-4436, 17:41Z) to stage (LIN-4437, 19:22Z)
  to close-out gate (LIN-4438, 21:06Z) to the measure reading its ledger (LIN-4439, 22:46Z) in about five hours. Along the way
  LIN-4439 retired LIN-4422's five-hour-old blind sample (F6). This review's own instrument changed shape four times on the day
  it was declared.
- **Reading.** Run 5 found the product growing faster. In this window the product's per-landing shape calmed, and most of
  what changed was the machinery that builds, gates and measures the product. **Whether that mix is new is not measured**: run 5
  did not classify its landings, and its window also carried many reviews, papers and loop changes. So this row is a first
  reading, not a shift. Two things in it are measured. The area-notes touch rate is flat like for like (77% → 80%). The
  newest parts, the blind read and the measures, were rebuilt within hours (F6). That is early churn in a layer days old,
  not runaway instability. **The discriminator for the next run is the same classification on its own landings, and whether
  the blind read and the measures stop changing.** The altitude split leaves this seam to this review: no other Periodical
  owns the measurement and gating layer.

### F3 — `waiting-stock-vs-minting` (new) · Severity: Low–Medium · **new: the Waiting stock still grows on every landing, at half its earlier pace**

| window | landings | `waiting.harbour` per landing | `waiting.total` per landing | stock (total) |
|---|---|---|---|---|
| `9574d537..b349c219b` (before LIN-4414) | 18 | **+1.50** | +1.61 | 66 → 95 |
| `b349c219b..163efc069` (after LIN-4414) | 17 | **+0.88** | +0.88 | 95 → 110 |
| whole window (declared) | 35 | +1.2 | +1.26 | 66 → 110 (+67%) |

- **Touches are bookkeeping; the stock is the signal.** The area-note touch rate (80% of landings) is mandated: LIN-4414
  (`b349c219b`) makes every stage build settle one fix-sized Waiting entry, LIN-4431's consequence test sends every outside find
  that does not break, block or touch safety to a Waiting entry rather than a ticket, and leftover and close-out steps write
  notes too (`docs/areas/README.md`; `lib/prompts/leftover-words.js`). A touch is the rule working, not instability.
- **The stock is not draining.** After LIN-4414 the per-landing addition halved but stayed positive: each build retires one
  entry and the rest of the loop adds about two. SD's notes are flat (12 → 12) after LIN-4414.
- **Read with `minted`, as one pair.** Tickets minted per landing fell from 1.67 to 1.37 while Waiting entries added per landing
  were +1.26. The work surfaced per landing did not fall; part of it moved from tickets into notes, which is what LIN-4431
  intends. Neither row alone is an improvement or a decay.
- **Reading.** A new standing rate, by design, and the design's drain (one retirement per build) is not yet keeping up. The
  trajectory to watch is the post-LIN-4414 rate: +0.88 per landing on 17 landings is too few to call a trend.

### F4 — `review-evidence-weight` · Severity: Low–Medium · **changed: reviews slowed; one paper data snapshot carries 71% of the window's blob growth**

| tree | at `9574d537` | at `163efc069` | change | per day (run 5) |
|---|---|---|---|---|
| `docs/reviews` | 84.4 MB | 89.1 MB | +4.7 MB | **1.1 MB/day** (6.5) |
| `docs/papers` | 36.9 MB | 50.6 MB | +13.7 MB | **3.2 MB/day** (4.1) |
| repository (all blobs) | 219.7 MB | 238.8 MB | +19.1 MB (+8.7%) | 4.5 MB/day (11.5; +30%) |

- **One landing is most of it.** LIN-4427 (`f57cc7e99`, "size–cost fits, 12 Nov freeze") is the window's largest landing:
  682 files, +35,372 lines, **13.65 MB** of new blobs, about **71% of the repository's 19.1 MB growth** and essentially all of
  `docs/papers`' +13.7 MB. It adds 674 files under a dated snapshot, `task-size-and-cost-evidence/2026-11-12/`, beside the
  earlier snapshot, which is kept. That tree is now 17.17 MB in 901 files. Each frozen snapshot is a full copy of the paper's
  raw data, and this one is several times larger than the one before it.
- **So the per-day rates are a step, not a trend.** Reviews did slow (+4.7 MB, 1.1 MB/day against 6.5). Papers' 3.2 MB/day
  against run 5's 4.1 is one snapshot divided by 4.26 days. The next freeze, if it copies the data again, will be larger still.
  The pre-mint observation that papers "worsened" and a reading that it "improved" are both artefacts of per-day division.
- **The share is flat-high.** The two trees took 18.4 of 19.1 MB of blob growth (96%; run 5: 93%). Run 5's review landings
  carried 625k added lines; this window's 11 carry 112,614.
- **Reading.** Reviews are settling. Papers grow in snapshot-sized steps, each larger than the last, and that is the shape to
  watch, not the per-day rate. The driver is still evidence, not product code. The Documentation Review's
  Waiting entry on the `docs/reviews/` archive (`docs/areas/llm-and-prompts.md`) already holds the size question; this row only
  tracks the rate.

### F5 — `prompt-contract-text-rate` · Severity: Low–Medium · **mixed: share up, per-day rate down, prompt bytes per landing up; every ceiling raise carries its reason**

| window | landings | touching the set | share | per day | lines added in set | `FROZEN_TOTAL_BYTES` |
|---|---|---|---|---|---|---|
| run 5 delta | 114 | 32 | 28.1% | 7.19 | 1,299 | 332,910 → 357,949 (+7.5%; +220 per landing) |
| **this window** | **35** | **12** | **34.3%** | **2.82** | **500** | **357,949 → 378,915 (+5.9%; +599 per landing)** |

- **The ceiling test was touched in 7 of 35** landings (20%; run 5: 19 of 114, 16.7%). **Run 5's open question is answered:** every
  raised ceiling in those 7 diffs carries an inline `// LIN-NNNN: +N (old -> new): reason` comment, as the invariant requires.
  None was found without one (read by hand; `oneliners.txt`).
- **The growth is the gating layer.** Of the +20,966 frozen bytes, the blind read accounts for 14,079 (67%: LIN-4437 +13,182,
  LIN-4438 +897) and LIN-4401's consequence gate and audit notes for 5,425 (26%). LIN-4441 added 1,002 and moved two full-suite
  instructions into one local-testing rule.
- **Hot files** (touches): `lib/proxy-instructions.js` 7 (1,312 → 1,325), `scripts/prompt-template-change-log.md` 7 (560 → 605),
  `lib/prompt-template-defs.js` 6 (1,271 → 1,372, +8%), `lib/proxy-preamble.js` (931 → 950).
- **Reading.** Run 5 read its rise as one programme's burst. This window's rise is another programme (the blind read). Two
  consecutive bursts from two programmes look like a standing rate: the prompt contract grows with each new loop stage.
  Severity stays Low–Medium because a test and a log bound it, and both are being honoured.

### F6 — `decision-reversal` · Severity: Low · **worsened on time-scale: a new build-then-retire, in 5.2 hours, inside the measurement layer**

- **New instance.** LIN-4422 (`96fa23c24`, 11-12 17:35Z) built the blind-read sample and tally (`scripts/stability-measures-blind.mjs`,
  128 lines, with a signs file). LIN-4439 (`aebe61081`, 22:46Z) retired the sample and the hand-run pass, rewriting 102 of
  the module's 128 lines so that measure 1 reads the pre-merge ledger. That is **5.2 hours**, against run 5's 15.4 (the
  size-of-the-move setting). LIN-4438 also retired review's "edges read" in favour of the blind read.
- **Not a product reversal.** Both instances are in the loop and measurement layer, and the retirement replaced the sample with a
  better-placed read (the declaration explains why). The pattern sits under F2.
- **True reverts: 0** in LV (35) and SD (3), by subject search.

### F7 — `test-suite-accretion` · Severity: Low (from Medium) · **improved: the driver slowed to a quarter of its pace; the CI series is broken at #2414**

| series | run 5 | this window |
|---|---|---|
| runtime unit tests (`ℹ tests` in unit-job logs) | 22,757 → 24,772 (+8.9% in 4 days) | 24,772 → **25,350 (+2.3% in 4.26 days)** |
| unit test files | +6.8% (run 5's own counting rule) | 1,227 → 1,247 (**+1.6%**; `*.test.js` under `tests/unit` by `git ls-tree`) |
| `ci` median, whole window (declared) | 8.59 (114 runs; reference) | 9.07 (35 runs) |
| `ci` median, `9574d537..eb14b7fff` (sequential unit arms) | — | **9.28** (31 runs) |
| `ci` median, `eb14b7fff..163efc069` (parallel arms, #2414 on) | — | **5.78** (4 runs) |

- **The driver, the comparable quantity, slowed sharply.** Runtime test count grew 2.3% here, against 8.9% in run 5 and
  monotonic rises before that.
- **Inside the pre-break series, wall time tracks the runner, not the suite.** The unit job took 5.93 min at `9574d537` and 9.51 at
  `3b1b57b15` with the same 24,772 tests. Daily medians were 9.68 (11-10), 9.28 (11-11) and 8.18 (11-12, which includes the four
  post-break runs).
- **After #2414 the series cannot be compared with run 5's.** Wall time is now the slowest job, not the unit arms' sum
  (`docs/architecture/ci.md`). The post-break median (5.78, n = 4) is a new level, not a convergence of the old series.
- **Reading.** The trajectory run 5 ranked first has turned: its driver slowed and LIN-4441 cut the wall time. That LIN-4441
  "acted on" run 5's CI option shows in the numbers, though n = 4 is not yet a series.

### F8 — `ci-critical-path-floor` (new) · Severity: Low · **new: wall time on main now has an E2E floor near 5.8 minutes**

- In **all 4 post-break runs, E2E shard 2/4 is the critical path**: 5.30, 5.45, 5.88 and 5.78 min, against `Unit tests` 4.18–4.51
  and `Unit tests (proxy, clock +400d)` 4.25–4.46 (`gh run view --json jobs`).
- E2E 2/4 held at **5.2–5.8 min across the whole window** (5.68 at `9574d537`, 5.70 `b315e0e8f`, 5.20 `3b1b57b15`, 5.81
  `30a019289`, 5.83 `4f48068eb`, 5.81 `eb14b7fff`), so it was the floor under the old series too, hidden by the longer unit job.
- **Consequence for the next run:** unit-suite growth no longer shows in `ci` until a unit arm passes about 5.8 min. Runtime test
  count stays the comparable measure of suite growth (F7), but it no longer drives wall time.
- The weekly `node-lts-scheduled.yml` (LIN-4419) is a separate workflow; `test.yml` was not changed by it, and it does not enter
  the `ci` series.

### F9 — SD: settled or stagnant? (`opencode-runner-convergence`, carried SD rows) · Severity: Low · **changed: code-silent since 11-08, within SD's own episodic range**

- **Three landings**, all area-notes governance shared with LV (LIN-4413, 4414, 4431): `docs/areas/` plus one test,
  `test/area-notes.test.js` (+56 / −10, LIN-4414). **No SD landing has touched `lib|routes|public` or a top-level `.js` since
  `5d8489e` (11-08 12:43Z)**, about 4.4 days.
- **Against SD's own history this is not stagnation.** Since 1 September SD has landed 134 times on only 34 distinct days; weeks
  W40–W42 had 6, 6 and 5 landings. W45 (run 5's window) had 34, a burst; W46 so far has 3. The run-5 question, whether the
  hardening sweep ends, has an answer on this evidence: it ended, and SD returned to its low, episodic base. Whether that base is
  settled or under-supplied is not visible in git: SD PRs, like LV's, were simply not created (none between #335, 11-08 12:29Z,
  and #336, 11-11 21:51Z).
- `opencode-runner.js`, `dispatcher.js` and `reapers.js`: 0 touches; `opencode-runner.js` stays at 1,836 lines.

### Carried rows, re-grounded at HEAD

| row | this window | run 5 | delta |
|---|---|---|---|
| `dispatch-entrance-churn` | `lib/dispatch-store.js` 1 touch (0.23/day), 4,530 → 4,530 | 11 touches, 2.46/day, +14% | **improved** (quiet) |
| `proxy-churn-concentration` | `routes/proxy.js` 2 touches (0.47/day), 1,676 → 1,659 | 7, 1.57/day | **improved** |
| `young-surface-hotspots` | Home / task-page cluster: 2 of 35 landings (5.7%); `prompt-section.js` 2,967 → 2,967; `task-page-loader.js` +34 | 14 of 114 (12%) | **improved** |
| `server-js-growth` | 1 of 35 (2.9%); 4,757 → 4,769 | 7 of 114 (6.1%) | **improved** |
| `runner-kit-convergence` | `lib/runner-kit/runner.mjs` 0 touches | 1 | **improved** (settled) |
| `stagnation` | the three silent files (`lib/harbour-spawn.js` 228, `lib/providers/registry.js` 90, `lib/render-custom-prompts.js` 133 lines): 0 touches, unchanged | 3 silent | **unchanged** |
| `periodic-loop-two-mechanisms` | bare intervals at `server.js:1035` and `:4708` (run 5: 1034, 4696); same mechanisms | — | **unchanged** |
| `rebuild-wave` | a one-line filter (≥50% of prior lines deleted in one landing, JSON and `_evidence` excluded) finds 1 code-path event (the F6 rewrite) and 5 in docs (2 area notes, 2 paper files, 1 plan); 0 whole-file deletions anywhere | 3 events (`rewrites.py`) | **improved** on code (the rule is approximate; counts are not strictly comparable) |
| `file-growth-vs-rework` | `churn` 0.30 deleted per added | 0.36 (reference) / 0.35 (run 5 `src`) | **changed** (less rewriting) |
| `review-layer-rate` | 11 of 35 touch `docs/reviews/` (31%); periodical report landings 9 (2.1/day) | 20 of 114 (17.5%); 4.5/day | **changed** (share up, rate down) |
| `docs-index-churn` | `source-map.md` 10 touches (2.35/day); `llms.txt` 4 (0.94/day) | 6.5/day; 2.0/day | **improved** (bookkeeping) |
| `lv-sd-contract-coupling` | 3 shared IDs (LIN-4413, 4414, 4431), all the area-notes rule applied to both repos | 3 | **unchanged** count; the coupling is now governance, not runtime contract |
| `research-eval-programme` | `experiments/` 0 lines; research output is in `docs/papers` (F4) | +42 authored | **unchanged** (quiet) |
| `cancelled-session-invariant` | keyword search (`cancel`, `halt`, `stop`, the four IDs) finds no landing on the rule in either repo | none | **unchanged** |
| `true-reverts` | 0 (LV 35, SD 3) | 0 | **unchanged** |

### Scope audit: in-remit surfaces beyond the ticket's list

| surface | window | reading |
|---|---|---|
| `.github/` | 2 landings: LIN-4419 (`node-lts-scheduled.yml`, weekly `lts/*`; 3 runs so far, all green) and LIN-4441 (parallel unit arm) | The CI topology changed once (F7, F8); the weekly workflow is outside the `ci` series |
| `scripts/` | 17 landings, +1,832 / −268 | Mostly the stability tool (F2). LIN-4425 (Backlog) holds whether overlapping survey/steady-base scripts retire: pending, not this review's |
| `tests/unit/` | 22 landings, +6,490 / −703; 1,227 → 1,247 files | Growth slowed (F7) |
| `tests/e2e/` | 3 landings; one new spec (`task-timeline.spec.js`, +147, LIN-4405) | E2E sets the CI floor (F8) |
| `tests/fixtures/` | 10 landings, +1,607 / −524; largest `cost-replay/goldens-lin4197.json` +714 | No large golden this window (run 5: 40,197 lines in one) |
| `docs/plans/` | 5 landings, +82 / −63 | Down from 9 landings, +4,040 |
| `experiments/` | 0 | Quiet |
| `docs/areas/` | 28 landings, +754 / −429; bytes 33,916 → 65,654 | Bookkeeping by rule; the stock is F3 |
| `lib/periodicals.js` (Periodicals machinery) | 4 touches (0.94/day), 1,353 → 1,416 (+4.7%) | Run 5: 7 touches, 1.57/day, +18%. Cooling |
| Paper-script tests (`docs/papers/harbour/**/*.test.mjs`) | `freeze.test.mjs` edited by LIN-4422 and LIN-4439 | Not run in CI (LIN-4435, Backlog); noted, not re-flagged |
| SD | 3 landings | F9 |
| Inline `TODO`/`FIXME` in the hot files | 0 (`git grep` over the area notes, prompt-contract files, `run-evidence.js`, `recommendation-look-first.js`, the stability tool, `periodicals.js`) | — |

### Run 5's maintainer options, checked against git

1. **CI wall-time budget.** LIN-4441 (#2414) acted on CI time: 9.28 → 5.78 median (n = 4), now E2E-bound (F7, F8).
2. **Evidence weight.** Reviews slower; papers grew by one 13.65 MB data snapshot (F4).
3. **Prompt-contract ceiling raises.** Each raise names its reason (F5). The rate did not slow per landing.
4. **Periodical cadence.** 9 report landings in 4.26 days (2.1/day, against 4.5). LIN-4415 stopped finished tasks starting a
   Periodical by default; LIN-4398 skips Surveys for gated reviews.
5. **SD's hardening tail.** Ended; SD is code-silent within its episodic range (F9).
6. **`lib/dispatch-store.js`.** One touch, no net change (carried rows).
7. **The three silent files.** Unchanged.

### Altitude split (cross-links, not findings)

Area coupling and import knots: Seams & Tangles (`seams-tangles-review-2026-11-10-run11.md`). Decisions held in several
places: Drift & Coherence (`drift-coherence-review-2026-11-10.md`). Function size × churn: Code Quality
(`code-quality-review-2026-11-04.md`). UI: Design & Interface (`design-interface-review-2026-11-08.md`). Delivery drag: Recent
Headwinds (`recent-headwinds-review-2026-10-21.md`). Test gaps, including LIN-4435: Test Coverage Gap (`test-coverage-gap-2026-11-11.md`).
LIN-4389's stale "minting" wording in the advisory lead-in is that ticket's; this run minted nothing.

## Class completeness (bounds and members)

| class | bound | members / count |
|---|---|---|
| Landings | first-parent, pins above | LV 35 (all classified, F2: 10 + 9 + 4 + 3 + 2 + 7); SD 3 |
| Declared rows | the declaration's 14, in order | 14 printed; 13 measured, `origin` not measured with its declared reason |
| Run-5 ledger rows | 28 names | all 28 accounted for: 3 superseded, 1 retired (unchanged), 1 resolved (unchanged), 3 not re-measured, 20 re-measured |
| New rows | — | 4: `change-composition-inward`, `per-task-expense`, `waiting-stock-vs-minting`, `ci-critical-path-floor` |
| Post-break CI runs | `test.yml` on `main`, head sha a window landing after `eb14b7fff` | 4 of 4 read job by job |
| Sub-windows | the two structural breaks named in the ask and the research | 4 readings, saved |
| Unbounded | — | person-origin of dispatches (`origin`); answered task-bound rulings; runner assignment; the reason PR supply stopped on 11-09 and 11-11 |

## Trend ledger

Severity: none / low / low–med / med / high. Delta vs 2026-11-08 (run 5): new / unchanged / improved / worsened / changed /
resolved / superseded / not re-measured. All 28 of run 5's names are accounted for; four rows are new.

| Signal (stable name) | Repo | Class | Severity | Reading (this window) | Delta vs 2026-11-08 |
|---|---|---|---|---|---|
| `per-task-expense` (**new**) | tracker | speed / cost | **med** | `cost` median $9.53 → $16.70; sessions 5 → 7; $/session 1.72 → 2.31; 94% of tasks ≥6 sessions; look-first (LIN-4370) break at base | **new** (structural step) |
| `change-composition-inward` (**new**) | LV | growth shape / process layer | low–med | 28 of 35 landings governance, measurement, reviews or research; product 7; process layer ≈47% of production churn; `docs/areas` touch rate flat like for like (77% → 80%) | **new** (first reading; no trend) |
| `waiting-stock-vs-minting` (**new**) | LV+SD | backlog shape | low–med | Waiting 66 → 110; +1.61/landing before LIN-4414, +0.88 after; `minted` 1.67 → 1.37 | **new** |
| `review-evidence-weight` | LV | evidence volume | low–med | `docs/reviews` +4.7 MB (1.1/day; run 5 6.5); `docs/papers` +13.7 MB, 13.65 MB of it one data snapshot (LIN-4427, 71% of repo blob growth); trees 96% of blob growth | **changed** (reviews improved; papers grow by snapshot) |
| `prompt-contract-text-rate` | LV | rework / contract | low–med | 12 of 35 (34.3%); 2.82/day; frozen bytes +5.9% (+599/landing; run 5 +220); every raise reasoned | **changed** (share and bytes/landing up, per day down) |
| `decision-reversal` | LV | rework / direction | low | LIN-4422 blind sample retired by LIN-4439 in 5.2 h (run 5: 15.4 h) | **worsened** (time-scale; measurement layer) |
| `test-suite-accretion` (CI) | LV | growth shape / CI | low | runtime tests +2.3% (run 5 +8.9%); `ci` 9.07 declared; 9.28 pre-#2414, 5.78 post (n = 4) | **improved** (med → low; series broken) |
| `ci-critical-path-floor` (**new**) | LV | CI topology | low | E2E 2/4 critical in 4 of 4 post-break runs, 5.2–5.9 min all window | **new** |
| `opencode-runner-convergence` | SD | surface rate | low | 0 touches; 1,836 lines; SD code-silent since 11-08 within its episodic range | **changed** (settled; sweep ended) |
| `dispatch-entrance-churn` | LV | surface rate | low | `dispatch-store.js` 1 touch, 0 net lines | **improved** |
| `proxy-churn-concentration` | LV | surface rate | low | `routes/proxy.js` 2 touches, −17 lines | **improved** |
| `young-surface-hotspots` (Home / task page) | LV | surface rate | low | 2 of 35 (5.7%) | **improved** |
| `review-layer-rate` | LV | governance churn | low | 11 of 35 (31%); 9 report landings, 2.1/day (run 5 4.5) | **changed** (share up, rate down) |
| `rebuild-wave` | LV | rework / direction | low | 1 code-path rewrite (F6), 5 in docs; 0 whole-file deletions (approximate rule) | **improved** (code) |
| `runner-kit-convergence` | LV | surface rate | low | `runner.mjs` 0 touches | **improved** |
| `lv-sd-contract-coupling` | LV+SD | change-coupling | low | 3 shared IDs, all area-notes governance | **unchanged** |
| `research-eval-programme` | LV | excluded-path churn | low | `experiments/` 0; research lands in `docs/papers` | **unchanged** |
| `server-js-growth` (S2) | LV | surface rate | low | 1 of 35 (2.9%); +12 lines | **improved** |
| `route-boundary-coupling` (S3) | LV | change-coupling | low | not re-measured | **not re-measured** (carried) |
| `periodic-loop-two-mechanisms` | LV | surface rate | low | `server.js:1035`, `:4708`; same mechanisms | **unchanged** |
| `stagnation` | LV | silence | low | the 3 silent files unchanged | **unchanged** |
| `true-reverts` | LV + SD | rework | none | 0 / 0 | **unchanged** |
| `file-growth-vs-rework` | LV | growth shape | low | `churn` 0.30 deleted per added (reference 0.36) | **changed** (less rewriting) |
| `docs-index-churn` | LV | bookkeeping | none | `source-map.md` 2.35/day; `llms.txt` 0.94/day | **improved** |
| `cancelled-session-invariant` | SD + LV | rework | low | no landing on the rule by keyword search | **unchanged** |
| `prompt-cluster-coupling` | LV | change-coupling | — | retired in run 4 | **retired** (unchanged) |
| `prompt-parity-coupling` | LV | change-coupling | none | resolved 10-12 | resolved (unchanged) |
| `corrective-vs-additive-ratio` | LV | rework | — | not re-measured (classifier recall ≈20%) | **not re-measured** |
| `corrective-vs-additive-ratio` | SD | rework | — | not re-measured | **not re-measured** |
| `project-velocity-trajectory` | LV | overall shape | — | per-day row retired by the declaration | **superseded** by the opening measures |
| `project-velocity-trajectory` | SD | overall shape | — | per-day row retired by the declaration | **superseded** by the opening measures |
| `ticket-mint-vs-landing` | tracker | proxy | — | same ratio as the declared `minted` (1.37 per landing) | **superseded** by `minted` |

## Plain-language read for the maintainer

**The product is calming down, and the machinery around it is where the churn has gone.** Run 5 found the project growing
faster on every axis. In this window the product side looks steadier per landing. Fewer lines are deleted per line added. The
old hotspots (the dispatch store, the proxy routes, the Home page) have gone quiet. The test suite grew a quarter as fast,
CI got faster, and nothing was reverted. Fewer landings a day is mostly two stretches with no PRs created, not a slowdown in
the work itself.

But four landings in five were about how work is done, checked and measured, not about the product. That layer (area notes,
new loop stages, the blind read, these measures) is days old and changed shape several times in one afternoon. Its
cost now shows. A finished task costs about 75% more than it did a week ago, because every task now starts with a fixed run of
Surveys and scoping and each session costs more. The list of waiting work in the area notes still grows with each landing,
at half the earlier pace, while fewer tickets are filed.

**Options a maintainer might weigh (nothing is filed; the decision is yours):**

1. **Let the process layer settle.** The blind read, the measures and the loop stages each changed several times in the window.
   A pause on new process stages until one review cycle has run on the current ones would make the next reading comparable.
2. **Decide whether the look-first prefix is worth its cost on every task.** It sets a floor of about six sessions. Options: keep
   it everywhere; skip it for small or follow-on tasks, as LIN-4398 already does for gated Periodicals; or measure one more
   window first.
3. **Watch the Waiting stock against minting together.** One retirement per build halved the growth but did not stop it. Options:
   accept a growing list as the cost of filing fewer tickets, raise the retirement rate, or review the stock by hand.
4. **Prompt contract.** Each new stage adds prompt bytes, and each raise is recorded. Decide whether the frozen total needs a ceiling
   of its own, or only the per-stage reasons it has now.
5. **CI.** Wall time is now set by one E2E shard (2/4). Rebalancing the shards would lower the floor; unit-suite growth will not
   show in wall time until a unit arm passes about 5.8 minutes.
6. **Evidence weight.** Reviews slowed. Papers grow by whole frozen snapshots of their raw data (LIN-4427's was 13.65 MB, 71% of
   the window's repository growth). Options: keep each snapshot, keep only the latest, or store the raw data outside git. The
   review-archive question already waits in the area notes.
7. **SD and the three silent files.** SD's code has been quiet since 11-08, within its usual pattern. The three silent files are
   still untouched.

**No follow-up tasks have been created.**

## Adversarial Second-Read

**Tier:** Tier 2. The reader was a fresh-context general-purpose sub-agent with no memory of the research, the plan or the
report-writing turn. It was given only the report and evidence paths, both checkouts, the window pins and the question. It
worked read-only with `git` and `gh`.

**Question:** "What is the largest item in this window that this report missed or misfiled?"

**Reader's answer (in full, as returned):**

> **Verdict: DISAGREE.** Most of the report's numbers reproduce. But the one figure F1 uses to say the process layer is "not
> settling" and "still accelerating" is a baseline artifact. Measured like for like, that activity is flat.
>
> **What reproduces (checked myself):**
> - 35 landings and the 1/0/12/3/19 day split.
> - Production churn 3,277 added / 984 deleted, using the tool's own `SCOPE_INCLUDE` filter. The split also holds: about 1,547
>   lines from the process landings, 1,719 product, 11 papers.
> - CI median 9.07 overall, 9.28 before #2414 (n=31) and 5.78 after (n=4), from `gh run list` and `updatedAt − startedAt`.
> - `docs/reviews` 84.4→89.1 MB, `docs/papers` 36.9→50.6 MB, all blobs 219.7→238.8 MB.
> - `FROZEN_TOTAL_BYTES` 357,949→378,915, and every ceiling raise carries its reason.
> - Unit test files 1,227→1,247; `docs/areas` touched by 28 of 35 landings, 33,916→65,654 bytes; `scripts/` +1,832/−268
>   across 17 landings.
> - No PRs were closed unmerged and there were no failures on main. The two supply gaps are real: the loop's first autopilot
>   dispatch after the 11-08 pause was 11-10 07:36Z.
>
> **Largest misfiling: F1's "rising" evidence does not hold up**
> - F1 says the area-notes touch rate "rose against run 5 (area notes 17.5% → 80% of landings)". It ranks F1 first because the
>   process layer is "the one surface still accelerating".
> - The area notes did not exist for most of run 5's window. They were created at `526bca66c` (LIN-4371, 11-08 02:29Z), only 26
>   landings before run 5's head pin. Before that commit, `git ls-tree 526bca66c^1 -- docs/areas` returns 0 files.
> - Counting from that commit to run 5's pin, 20 of 26 landings touched `docs/areas` (77%). This window is 28 of 35 (80%), so
>   the touch rate is flat.
> - Lines added per landing went down, from 698/26 = 26.8 to 754/35 = 21.5 (`git log --numstat -- docs/areas` over each range).
> - The report already flags the same artifact for `waiting.*` ("the notes being written, not a rate"), but not here. F3 also
>   calls these touches "the rule working, not instability", which contradicts using them as F1's evidence.
> - F1's title claims the change "has moved" from product to process, yet the report says run 5 had no such classification. A
>   rough keyword pass over run 5's 114 landing titles is not a proper classification. It found about 20 reviews, 11 papers, 24
>   fake-DOM test moves and only about 12 product-UI landings, with most of the rest loop or infrastructure work. That suggests
>   the inward-heavy mix was already there. The same split is "new, not measured" and also proof the layer is accelerating, and
>   it cannot be both.
> - What does stand: the 80% composition, and the blind read and measures being rebuilt within hours (F6).
>
> **Runner-up: F4 misreads the window's largest landing**
> - `f57cc7e99` (LIN-4427) is the biggest landing in the window: 682 files, +35,372 lines, 13.65 MB of added blobs.
> - That is about 71% of the repository's 19.1 MB growth and essentially all of `docs/papers`' 13.7 MB. It adds 674 of the
>   window's 847 new files (8,571 → 9,418).
> - It is a second full snapshot of the task-size-and-cost paper's raw data. The earlier snapshot (11-05: 227 files, 3.63 MB)
>   was kept. The new one (11-12: 674 files, 13.54 MB) re-includes all 48 of the earlier tasks, and 135 of the 223 shared paths
>   are identical blobs.
> - F4 turns this one-off jump into a per-day rate (3.2 vs 4.1 MB/day) and calls it "Improving", without naming the landing. Each
>   re-snapshot so far has been bigger than the last (3.7× here).
>
> **Minor:** LIN-4426, a paper ticket, deleted 138 lines of production code (`listSessions` in `lib/agent-status-store.js`). The
> report counts only the 11 lines that paper landings added.
>
> Verdict: DISAGREE
> Your largest missed/misfiled item (one sentence): F1's main evidence that the process layer is speeding up ("area notes 17.5% →
> 80% of landings") is a baseline artifact, because the notes only began 26 landings before run 5's pin; like for like it is 77%
> → 80% with fewer lines added per landing, so F1's "moved" and "still accelerating" claims are not measured and its Medium,
> top-ranked severity rests on a figure that does not reproduce.
> Does it differ from the report's top-ranked finding (F1)? NO

(The reader's "F1" is the draft's numbering. In this final report that finding is F2, `change-composition-inward`.)

**Response (each claim re-run against git before it was accepted; commands and outputs at the end of `oneliners.txt`):**

- **Area-notes baseline: confirmed and fixed in place.** `docs/areas/README.md` first appears at `526bca66c` (11-08 02:29Z), and
  `526bca66c^1` has no `docs/areas`. 20 of the 26 landings from there to `9574d537` touched the notes (+698 lines), against
  28 of 35 here (+754). The touch rate is flat, and the finding no longer claims a rise or acceleration. It is now a first
  reading at Low–Medium, and it moved from first to second. `per-task-expense`, the largest relative move on a declared
  measure, now ranks first. The headline, ranking reason, ledger and plain-language read were changed to match.
- **The paper snapshot: confirmed and fixed in place.** `f57cc7e99`: 682 files, +35,372 lines, 13.65 MB of new blobs, and 674
  of its added files under `task-size-and-cost-evidence/2026-11-12/`. That tree is now 17.17 MB in 901 files. F4 now names
  the landing, drops "improving" for papers, and reads papers as growing by snapshot. The ledger row and maintainer option 6
  changed with it. The reader's 11-05 snapshot figures (227 files, 3.63 MB; 135 identical blobs) were not re-run here,
  so the report states only the totals above.
- **LIN-4426's production deletion: confirmed and fixed in place.** `94893cc35` removes 138 lines from `lib/agent-status-store.js`.
  F2 now states the paper landings' deletions.
- **Not adopted:** the reader's keyword pass over run 5's titles. It says itself that it is not a classification, so the report
  says only that whether the mix is new is not measured.

**Fields (the engine reads the same three in one body on the task comment):**

Adversarial second-read verdict: DISAGREE
Differed from top finding: NO
Disposition: fixed in place
