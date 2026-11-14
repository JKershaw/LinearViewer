# Stability Review — 2026-11-14 (run 7, delta vs 2026-11-13)

*Advisory, trend-aware, review-only. Periodical: **Stability Review**; review task: LIN-4483 (run 7). Diffed against
`stability-review-2026-11-13.md` (LIN-4442, run 6), with `2026-11-08`, `2026-11-04`, `2026-10-21`, `2026-10-12` and the `2026-06-25`
baseline as history. This report changes no code, config or docs beyond itself and its evidence folder, and **mints no
follow-up tasks**. It reads the project's trajectory: is the rate of change converging toward a settled state, or failing to settle?
The decision is the maintainer's.*

**Examined.** LV `fb358dbda` (LinearViewer `163efc069..fb358dbda`, **33 first-parent landings**, 2026-11-12 23:17Z to 2026-11-14 09:49Z,
≈1.4 days). SD `7d5fe7d` (simple-dispatcher `af9b496..7d5fe7d`, **3 landings**). The base is run 6's head pin, as
`docs/reviews/stability-measures/README.md` fixes it; `reading.json` → `window.head` is `163efc0698934c3e8a5f3c30e48dc15b51ac3a24`
and `window.head` for the new reading is `fb358dbda7f26ab44b3f58acb15886b21ac20950`. Evidence and every command:
`docs/reviews/_evidence-2026-11-14-stability/` (see its `README.md` and `analysis-notes.md`).

## The declared measures (opening)

This is `table.txt` from **one full run** of the committed tool, exactly as declared, from the LV root with SD beside it at `7d5fe7d` and
`HARBOUR_LOCAL_BASE` set (about 12 min; 2026-11-14 10:16–10:28Z):

```
node scripts/stability-measures.mjs . 163efc069 fb358dbda --runner ../simple-dispatcher \
  --reference docs/reviews/stability-measures/reference-2026-11-08.json > reading.json 2> table.txt
```

Each row is followed by its 8 Nov reference (`5334c81a..9574d537`, 114 landings), summarised by the same rule. The rows are printed as
the tool wrote them, endpoint totals included:

```
stability measures 163efc069..fb358dbda (2026-11-12T23:17:49Z → 2026-11-14T09:49:26Z), 33 landings
1. No new mess
   blind            22 of 33 landings read blind before merge (better 20, same 2, worse 0); unread: no ticket 1, not an ordinary landing 10, landed before the gate 0, no read on record 0
                    8 Nov: not measured: no 8 Nov reading; the first reading sets it
2. The curve
   lines            net +1,511 (code +570, comment-only +836, blank +105); +45.8 per landing; totals 209,077 → 210,588; comment-only share 39.74% → 39.86%
                    8 Nov: net +6,558 (code +3,034, comment-only +3,185, blank +339); +57.5 per landing; totals 200,226 → 206,784; comment-only share 39.44% → 39.73%
   churn            8,237 added, 6,726 deleted over 33 landings; 249.6 added and 203.8 deleted per landing; 0.82 deleted per added
                    8 Nov: 10,235 added, 3,677 deleted over 114 landings; 89.8 added and 32.3 deleted per landing; 0.36 deleted per added
   ci               median 5.72 min over 32 runs (32 of 33 landings) [partial: 1 unreadable — 1 landing(s) have no successful run]
                    8 Nov: median 8.59 min over 114 runs (114 of 114 landings)
   waiting.harbour  98 → 108 (+10, +0.3 per landing)
                    8 Nov: 0 → 56 (+56, +0.49 per landing)
   waiting.runner   12 → 12 (0, 0 per landing); main af9b496d5..7d5fe7d94
                    8 Nov: 0 → 10 (+10, +0.09 per landing); main 9478e1c53..5d8489e7f
   waiting.total    110 → 120 (+10, +0.3 per landing)
                    8 Nov: 0 → 66 (+66, +0.58 per landing)
   minted           37 over LIN-4442 → LIN-4479, 1.12 per landing (ID-span estimate; 20 probes)
                    8 Nov: 190 over LIN-4204 → LIN-4394, 1.67 per landing (ID-span estimate; 22 probes)
3. Speed
   tasks            25 finished (1 landed before base); of 27 tickets landed here, 2 not done and 1 done outside the window; 1 landing(s) own no ticket; lookback 3 days
                    8 Nov: 106 finished (1 landed before base); of 106 tickets landed here, 0 not done and 1 done outside the window; 0 landing(s) own no ticket; lookback 3 days
   speed            median 69.5 min (mean 93.7) first dispatch → last landing; median 8 sessions (mean 8.04); 25 of 25 tasks
                    8 Nov: median 56.3 min (mean 124.6) first dispatch → last landing; median 5 sessions (mean 5.61); 106 of 106 tasks
4. The person's seat
   rulings          loop rulings only: 7 raised over 25 finished tasks, 0.28 per task (distinct decisions); answered 100% of answered + dismissed (answered 6, dismissed 0, withdrawn 1, open 0); not read: answered task-bound rulings (anchor.taskDecisionId): no proxy read returns them; rulings anchored on a parent or another unfinished ticket are not counted against a finished task (10 on a finished task's parent)
                    8 Nov: not measured: no 8 Nov reading; the first reading sets it
   origin           not measured: dispatchedBy is the workspace account for autopilot and person alike
                    8 Nov: not measured: no 8 Nov reading; the first reading sets it
   operator-free    upper bound: 72% (18 of 25 tasks) with no loop ruling, no [blocked] marker in any lineage member's feedback, no dispatch row closed with closedReason 'operator'; failing: ruling 7, blocked 3, operator-closed 0; missing condition: no person-started dispatch (not measured: dispatchedBy is the workspace account for autopilot and person alike); closedReason 'operator' is a catch-all and may push the share down
                    8 Nov: not measured: no 8 Nov reading; the first reading sets it
5. Cost per finished task
   cost             median $15.25 (mean $17.17) over 25 of 25 tasks; unpriced 0, noTelemetryCount 0, unreadableCount 0, noLineage 0
                    8 Nov: median $9.53 (mean $14.29) over 106 of 106 tasks; unpriced 0, noTelemetryCount 0, unreadableCount 0, noLineage 0
```

**Read as declared** (the declaration's notes, not findings):

- **`blind` is a first full reading with its gate in place.** 22 of 33 landings are ordinary and every one of them has a read on record
  (`unread: no read on record 0`). The 10 not-ordinary landings are docs-only; the one *no ticket* landing is the north star (`4b5001ddf`).
  The verdicts are written by the loop's own blind-read stage on each ticket, so *better 20* is a self-report, not an independent judgement.
- **`ci` is partial (32 of 33) because of a listing defect, not a missing run.** The missing landing is `c205190fd` (LIN-4454). Its run
  `43454782230` is `conclusion: success` in `gh run view`, and the tool's listing omits it (see F10 and the evidence `analysis-notes.md` §8).
  The row is printed as the tool wrote it.
- **`minted` probes include this ticket's own bracket.** `LIN-4483` was created at 10:03Z, after head's commit time, so it is outside the span
  (`headAtBracket: false`). The span is an estimate by declaration.
- **`tasks` shows two landed tickets still In Progress** (LIN-4452, LIN-4463) and one ticket done just after the window (LIN-4470, completed 09:57Z).
  Read as declared.
- **`waiting.*` and `ci` sit inside the declaration's own sub-windows** (see the split below); the tool's reference values come only from the committed 8 Nov file.
- **`origin` is not measured**, with its declared reason.

**Closed as superseded** by the opening, as in run 6: none this run. The two per-day rows and `ticket-mint-vs-landing` were closed in run 6.

## Measurement decisions (read these before the trajectory)

1. **Pins.** LV `origin/main` was `fb358dbda` and SD `origin/main` was `7d5fe7d` when re-fetched at execution (the same pins the research read, with
   `origin/main` unchanged since mint). The window is 33 LV landings, the same as the research count. The tool's `window.head` is `fb358dbda7f26ab44b3f58acb15886b21ac20950`.
2. **The committed tool only.** The full reading is `reading.json` and `table.txt`. The sub-window readings (`subwindow-pre-v4.*`, `subwindow-post-v4.*`) were run
   with `HARBOUR_LOCAL_BASE` unset, so their tracker rows print `not measured` and their git and `gh` rows are real. No measuring script was written.
   Extra reads are one-liners or ad hoc analysis, recorded in `analysis-notes.md` with their outputs. They are not evidence of a new measure.
3. **Split at North star v4.** `4b5001ddf` (13 Nov 12:01Z) splits the window into 4 landings before it and 29 after. Production churn is almost entirely
   after the split. The split is the ticket's own framing and the declared tool reads both sides.
4. **Two churn definitions, kept apart.** The tool's `churn` is the per-landing sum of first-parent numstat in the code-shape scope (8,237 / 6,726).
   A whitespace-ignored sum over the same scope (`git log -w`) is 4,448 / 2,937. Whitespace-only lines are 46% of additions and 56% of deletions.
   An endpoint diff (`git diff 163efc069 fb358dbda`) gives different totals because intermediate churn inside the window is counted once.
5. **Relative, not absolute.** Added lines are also read against the code base at base: 8,237 / 209,077 = 3.94% for this window, 3,277 / 206,784 = 1.58% for run 6.
   Per landing, that is 0.119% against 0.045% (plain); whitespace-ignored, 0.065% against 0.045% (4,448 / 33 / 209,077 against 3,243 / 35 / 206,784). Per-day rates are given only where run 6 used them.
6. **Small n, right-censored.** 33 landings in 1.4 days. The tail (the three 14 Nov landings and open PRs #2451 and #2452) is not yet observable. Every trajectory claim
   is read against run 6 and the 8 Nov reference. Where a change is a step, it is called a step.
7. **Tracker rows are as read on 2026-11-14 at about 10:16Z.** A later wake can move `tasks`, `speed`, `rulings`, `operator-free` and `cost`.

## Headline read

**The tidy wave is converging on the things it aimed at, and churning hard to get there.** On the measures that a settled project should show,
three moved the right way: the Waiting stock stopped growing across the 29 landings after the North star v4 commit (the sub-window reads 120 → 120,
after +10 in the four landings before it), tickets minted per landing fell from 1.37 to 1.12, and the CI wall-time level held at about 5.7 minutes.
Cost per finished task fell 9% against run 6 on a changed population ($16.70 → $15.25), and the look-first prefix that run 6 flagged is flat (about $2.9 a task).

Two things moved the wrong way or did not settle. The **rate of production change rose** per landing against run 6: added lines ×2.7 (×1.45 whitespace-ignored) and deleted lines ×7.3 (×3.3 whitespace-ignored),
so deletions now make up a larger share of additions (0.30 → 0.82; 0.66 without whitespace), which this report reads as replacement churn (F1). Net production growth per landing fell (65.5 → 45.8), but the
declared comment-only share rose slightly (39.74% → 39.86%). And the test suite re-accelerated per landing
(runtime tests 16.5 → 20.8 per landing; test files 0.57 → 1.06 per landing), mostly in ticket-named witness and census suites written for the module moves.
Sessions per finished task rose (median 5 → 7 → 8), but neither step is counted as moving the wrong way: the 5 → 7 step came with the look-first prefix, and the 7 → 8 step is the blind-read stage, which every one of the 25 finished tasks now runs once; without it the median is 7, as in run 6 (see F2).

So the answer to "converging or failing to settle?" is **converging on the stock and the wall time, not yet on the churn**. The wave's churn is the wave's job, and the
trajectory after it is unobserved. The next run is the first that can see whether the tidied areas go quiet.

- **Rate.** 33 landings in 1.4 days, against run 6's 8.2 a day, as supply: 25 PRs created in about eight hours on 13 Nov, median 36 minutes to merge
  (`gh pr list`, n = 25). That is parallel programmes, not a queue flush. Per-landing rows stand; per-day rates would mislead.
- **Shape.** Production churn per landing rose ×2.7 added and ×7.3 deleted; deleted per added rose 0.30 → 0.82. Tidy programmes net +781 production lines; the Jira feature nets +730.
- **Converging, by the same measures.** Waiting stock (flat over the wave), minted per landing (down 18%), CI wall time (5.78 → 5.72), review-report landings (31% → 9% of landings), `docs/reviews` bytes per landing (0.13 → 0.12 MB), SD runner-quiet files, `lib/periodicals.js` touches (4 → 2). The blind read ran on 22 of 22 ordinary landings, and its verdicts are 20 better, 2 same, 0 worse (self-reported, see F10.3).
- **Not converging.** Churn relative to size; test-suite growth per landing; `source-map.md` co-change with structural moves (11 of 11); the proxy write-gate and dispatch-store surfaces.

## Paired area reads, checked against git

The survey's paired area reads (`docs/plans/survey/area-read-reports/`, LIN-4462) each make a before/after convergence claim for one area. They are a
witness, not a verdict. Each claim is set beside git for the same 14 sampled files and for the whole area (`analysis-notes.md` §12.1, inputs in
`_evidence-2026-11-14-stability/revision-r1/`). Git windows run from each read's own base commit to the head of `main`, `fb358dbda`.

| Area (read pair) | The read's convergence claim | Git, the same 14 sampled files | Git, whole area | Agree / disagree |
|---|---|---|---|---|
| **Runs & dispatch** (`4b5001ddf` → `302edafc3`, LIN-4447) | "No detectable difference" in code (D = +0.25, inside ±0.5). Note 11,540 → 18,045 bytes; Waiting 20 → 21. The read says its sample missed the work: 3 of 14 files changed, 35 of 121 area files differ, none of the six new homes sampled. | 3 landings touch the sample, the same 3 files the read saw change (`cost-read.js`, `digest-feedback.js`, `wall-clock-summary.js`); +20/−112, net −92. Quiet after `302edafc3`: 0 landings to head. | 14 landings to `302edafc3`: +1,959/−1,352, **net +607**. After the read, one more landing (LIN-4470, `fb358dbda`) cut −117 from the area (`lib/completion-signals.js` −111). | **Agree** on the sample's facts and on the Waiting count (git 20 → 21). **Disagree** that the sample shows anything about convergence: it is 14 of 121 files and none of the new files that carry the net growth. The area grew net during the wave and was touched after the read. No convergence is witnessed. |
| **LLM & prompts** (`e8e92d50a` → `49776653d`, LIN-4448 / LIN-4470 piece 6) | Code score fell 3.3 → 3.0 in both passes (D = −0.3 against the control, no detectable difference), so the area does not beat its control on code. Note 3.25 → 4.0. Waiting 25 → 12. | 6 of 14 files changed in 7 landings: +1,536/−1,202, net +334, most of it the new `lib/prompts/stage-kinds.js` (594 lines). The sample is byte-identical on `fb358dbda`, the squash of the same piece (#2450). | 9 landings to `49776653d`: +1,896/−1,516, **net +380**. | **Agree** on the note: `docs/areas/llm-and-prompts.md` lost 102 of 175 lines in `fb358dbda` ("Waiting entries settled"), and a plain count of its Waiting bullets is 26 → 12 (the read counted 25 → 12). **Git cannot test the code score**: the churn is consistent with a fall but does not show one. **Disagree** with any reading that the area has settled: its quiet tail is zero days, so the convergence claim is right-censored. |
| **Front end: server-rendered pages**, the control (`4b5001ddf` → `302edafc3`) | The kit calls it untouched, but the read flags verdict 4: the control moved. 4 of 14 sampled files changed. Code 3.40 → 3.30 (Δ −0.10), note 3.00 → 3.50. | 4 of 14 files changed in 5 landings: +13/−12, net +1. Quiet after `302edafc3`: 0 landings to head. | 8 landings: +91/−45, **net +46**, from the pieces of LIN-4446, 4451, 4457, 4460, 4463, 4471 and 4472. Last touch 13 Nov 22:01Z (LIN-4463). | **Agree** the control was not untouched. The four sampled files moved by small amounts in both sources. The control's changes come from the tidy programmes themselves, so the control carries part of the wave, and the direction of D's bias is unknown. **Disagree** with the LLM pair's control count: that read says 4 of 14 sampled files changed between `e8e92d50a` and `49776653d`; git shows 3 (`lib/render-swipe.js` changed before `e8e92d50a`, not in that window). |

What the three reads show together: none witnesses convergence on code. Each sample is 14 files, and the quiet period after the last piece is zero to one day,
so every read is right-censored (Measurement decision 6). Where the reads and git can both see something, they agree: the LLM note was settled, the Runs note gained one
Waiting entry, and the control moved. The next read should come after a quiet period and should sample the new homes, which is where Runs' net growth sits.

## Findings (severity-ranked; each a delta against run 6, 2026-11-13)

Ranking reason, stated once: **F1 ranks first** because the rate of production change, relative to the code base, is the largest relative move on any measure this run
(added lines ×2.7 per landing plain, ×1.45 whitespace-ignored), and it is the measure most directly about "toward settled". **F2 ranks second** because per-task cost is the declared row with the largest move
in run 6, and this run's first like-for-like reading is inconclusive. F3 and F4 follow because each is a rise in a stated concern (test growth, runtime contract coupling).

### F1 — `production-churn-rate` (new) · Severity: Medium · **worsened on the size-normalised rate and on the deletion ratio (0.30 → 0.82, replacement churn)**

| | run 6 window (35 landings) | this window (33 landings) | change |
|---|---|---|---|
| production added per landing (`churn`) | 93.6 | **249.6** | ×2.7 |
| production deleted per landing (`churn`) | 28.1 | **203.8** | ×7.3 |
| deleted per added (`churn`) | 0.30 | **0.82** | worse (more replacement) |
| deleted per added, whitespace ignored (`git log -w`, same scope) | — | 0.66 | |
| churn as share of code base at base (window total) | 1.58% (3,277 / 206,784) | **3.94%** (8,237 / 209,077) | ×2.5 |
| added lines per landing, share of base | 0.045% | **0.119%** | ×2.6 (8 Nov reference: 0.045%) |
| added lines per landing, share of base, whitespace ignored | 0.045% (3,243 / 35 / 206,784) | **0.065%** (4,448 / 33 / 209,077) | ×1.44 |
| deleted lines per landing, whitespace ignored | 27.1 | **89.0** | ×3.3 (plain ×7.3) |
| net production lines per landing (`lines`) | +65.5 | +45.8 | −30% |
| comment-only share of production lines (`lines`) | 39.73% → 39.74% | 39.74% → **39.86%** | rose (the declared signal moved the wrong way) |

- **Where the churn is.** Whitespace-only lines are 3,789 of the 8,237 added (46%) and 3,789 of the 6,726 deleted (56%). Most of it is re-indentation from
  three whole-file conversions: `public/flight-companion.js` (+1,974 / −1,964 plain, +45 / −35 with `-w`), `public/task-page.js` (+900 / −913 vs +92 / −105) and
  `public/workspace-kpis.js`. A curve bent only by re-indentation is not a bent curve; both readings belong in the record. Plain, the ratio is 0.82; whitespace-ignored, 0.66; run 6's plain figure was 0.30. The whitespace-ignored run 6 comparison is computed here (`analysis-notes.md` §2), not assumed.
- **Genuine deletion is real and concentrated.** `lib/completion-signals.js` 367 → 29 (−338, LIN-4467 and LIN-4470), `lib/run-ledger.js` 728 → 489 (−239),
  `lib/prompt-template-defs.js` 1,372 → 1,114 (−258, data moved out), `lib/cost-read.js` −85, `lib/recommendation-facts.js` −75.
- **Growth is also real.** Twelve new production files (plus one rename) add about 1,724 lines (largest `lib/prompts/stage-kinds.js`, 594). `lib/dispatch-store.js`
  grows 4,530 → 4,571 (+41) over three landings, although LIN-4447 names it as the area's weight. The Jira feature adds +730 net.
- **Comment lines.** In the production diff, 2,762 added lines are comment-like, 488 of them citing a `LIN-` ticket (59 of those in `public/flight-companion.js`).
  Comment-only share is a declared signal; the rise is small (+0.12 points) but in the wrong direction.
- **Reading.** Run 6 read the lower deletion-per-added as "less rewriting". With a window that adds 2.7× as much code per landing and deletes 7.3× as much,
  the ratio alone no longer means that. This report reads the higher ratio as **replacement churn, not improved consolidation**, and uses that reading in the heading, the table and the ledger. Real consolidation is present
  (`lib/completion-signals.js` −338 net; `lib/run-ledger.js` −239 net), but deletions rose in step with additions rather than instead of them: the move
  of code into twelve new files adds about 1,724 lines, and 56% of the deleted lines are whitespace-only. The one consolidation signal is net growth per landing, which fell (65.5 → 45.8), and it is paired with a comment-only share that rose.
  Per landing and against the code base the rate of change rose (added lines ×2.6 as a share of the base, ×1.44 whitespace-ignored, against run 6); the tidy wave is a step, and
  whether the curve settles after it is the next run's question. Severity is Medium because the step is large and it is the first run with a tidy-wave window, not because
  the code is unstable: deletions and conversions are real and the wave has a stated end.
- **Altitude.** The function-size × churn question for the large files belongs to Code Quality (`docs/reviews/code-quality-review-2026-11-04.md`, due). Not re-flagged here.

### F2 — `per-task-expense` · Severity: Medium (unchanged) · **inconclusive: cost level down; the session step is the new blind-read stage; the look-first prefix flat at a new level**

| | 8 Nov reference (106 tasks) | run 6 (33 tasks) | this window (25 tasks) |
|---|---|---|---|
| median cost (`cost`, declared) | $9.53 | $16.70 | **$15.25** (ex-periodicals, n = 22: $14.82) |
| median sessions (`speed`) | 5 | 7 | **8** |
| median minutes, first dispatch → last landing | 56.3 | 86.5 | **69.5** |
| look-first prefix, sessions and $ per task | 0.66 / $0.65 | 2.64 / $2.84 | **2.48 / $2.88** |
| implementation $ per task | $5.78 | $7.06 | **$4.77** |
| blind-read stage, sessions and $ per task | — | 0.12 / $0.14 | **1.00 / $1.02** |
| research $ per task | $1.32 | $2.26 | **$0.99** |
| close-out $ per task | $1.28 | $1.45 | **$1.04** |

(Per-kind figures are from `workerSessions[].costUsd` over the 25 tasks, `cost-per-task-raw.json`. The declared row uses `totalUsd` and differs by about $0.15–0.20.
Run 6's breakdown was over 33 tasks including nine Periodicals; the populations differ.)

- **The look-first prefix is a level, not a climb.** Its sessions per task (2.64 → 2.48) and dollars per task ($2.84 → $2.88) are flat; 23 of 25 tasks have at least one prefix session.
  Run 6's question was whether a new level or a still-rising curve. On this evidence it is a new level.
- **The fixed floor has moved to a different stage.** Blind read now runs on every task (1.00 sessions, $1.02), where run 6 saw it on 4 tasks. Survey, scoping, blind read
  and close-out together are about $4.9 a task, against about $4.4 in run 6. Implementation and research fell by more than that.
- **The session step has two causes, one per step.** The median went 5 → 7 → 8 over the three readings. The **5 → 7 step (8 Nov to run 6)** came with the look-first prefix: that prefix went from 0.66 to 2.64 sessions per task in the table above, while the blind-read stage ran on 4 of 33 tasks in run 6 (0.12 sessions a task). The **7 → 8 step (run 6 to this run)** is the blind-read stage: it runs once on every one of the 25 finished tasks (`cost-per-task-raw.json`, `kind == 'blind-read'`: 25 of 25 tasks with exactly one session), and its LIN-4437 to LIN-4439 build landed on 12 Nov, just before the window. Excluding the blind-read session, the median is 7 (mean 7.04), the same as run 6's median. This run's increase is not attributed to the look-first prefix, which is flat at 2.48 to 2.64 sessions a task across the two runs.
- **Outlier.** LIN-4396 ($32.24, 14 sessions, 468 minutes) is the long tail the mean reflects; without it the mean is $16.55.
- **Reading.** Not diverging. The cost level is roughly flat against run 6 on a changed population, and the rest of the session count (excluding blind read) is flat at 7. Run 6's option 2 (the look-first prefix's worth) and the blind-read floor are the decisions this measure now carries; the blind-read stage is the one new fixed cost to judge.

### F3 — `test-suite-accretion` · Severity: Low–Medium (from Low) · **worsened per landing: the suite re-accelerated, mostly in witness and census suites**

| series | run 6 (35 landings) | this window (33 landings) |
|---|---|---|
| runtime `ℹ tests` (unit-job logs, base `163efc069` 25,350 → head `fb358dbda` 26,038) | +578 (+2.3%); 16.5 per landing | **+688 (+2.7%)**; **20.8 per landing** (+26%) |
| `ℹ suites` | — | 4,645 → 4,764 (+119, +2.6%) |
| `*.test.js` under `tests/unit` (`git ls-tree`) | 1,227 → 1,247 (+1.6%); 0.57 files per landing | 1,247 → **1,282 (+2.8%)**; **1.06 files per landing** |

- **Shape of the new files.** Thirty-eight unit test files were added. They hold 386 static `test(`/`it(` calls. Thirteen of the files, with 132 calls (34%), are census,
  characterization, witness, inventory, module, import, layout or owner suites (for example `classic-loader-census`, `bridge-inventory`, `shared-modules`,
  `lin-4458-comment-kind-census`). The rest are behaviour suites named for their tickets. The 386 static calls in new files are about 56% of the net runtime growth of 688; the remainder is growth in existing files.
- **Reading.** The rise is the module conversions writing their own census and witness tests, which is the test layer doing what the tidy waves ask of it. It is also
  the first run in which per-landing suite growth went *up*. Whether census suites are retired when a conversion settles is the question for the next run.
  Carried from run 6: the CI wall-time series is at the E2E floor (F9 below), so suite growth does not yet show in `ci`.
- **Altitude.** Test gaps belong to Test Coverage Gap (`docs/reviews/test-coverage-gap-2026-11-11.md`). Not re-flagged here.

### F4 — `lv-sd-contract-coupling` · Severity: Low–Medium (from Low) · **changed to a runtime contract: both repos moved the same contract in one window**

- LV `302edafc3` (#2448, LIN-4475, "contract session vocabulary … kit fold") changes `lib/runner-kit/contract.json` (+398) and `lib/runner-kit/runner.mjs` (+55).
- SD `7d5fe7d` (#341, LIN-4476, "merged contract session fold") changes `test/fixtures/runner-contract.json` (+398) and `test/runner-contract.test.js` (+136).
- Run 6 counted three shared IDs and read them as governance only. This window's pair is a runtime contract, changed in both repos within hours of each other.
  The two landings are the halves of one fold, as the ticket titles say, so this is one coupling event, not drift. The row's delta is a change of kind, not a count.
- **Reading.** The contract fold is a deliberate shared change. The watch is whether the next contract change again lands in both repos in the same window. Cross-repository
  contract drift belongs to Drift & Coherence (`drift-coherence-review-2026-11-13.md`). Not re-flagged here beyond the coupling count.

### F5 — `docs-index-churn` · Severity: Low · **worsened: `source-map.md` co-changes with every structural move**

| | run 6 (35 landings) | this window (33 landings) |
|---|---|---|
| `docs/architecture/source-map.md` touches | 10 (0.29 per landing) | **19 (0.58 per landing)** |
| landings adding or deleting a production file that also touch `source-map.md` | — | **11 of 11** |

- Every structural landing in the window updates `source-map.md`. That is the declared rule working (the map is checked against source at test time), so the touch count is the
  cost of each move, not drift. It scales with the number of structural moves, which this wave supplied.
- `llms.txt`: 0 touches this window (run 6: 4). `docs/architecture/prompt-system.md`: 5 touches.
- **Altitude.** The import and area-coupling reading belongs to Seams & Tangles (`seams-tangles-review-2026-11-13-run12.md`). Not re-flagged here.

### F6 — `waiting-stock-vs-minting` · Severity: Low (from Low–Medium) · **improved: the stock stopped growing across the 29 landings after the North star v4 commit**

| window | landings | `waiting.total` change | per landing | stock |
|---|---|---|---|---|
| run 6, before LIN-4414 | 18 | +1.61 per landing | | 66 → 95 |
| run 6, after LIN-4414 | 17 | +0.88 per landing | | 95 → 110 |
| this window, before v4 (`163efc069..4b5001ddf`) | 4 | +10 (+2.5 per landing) | | 110 → 120 |
| **this window, after v4 (`4b5001ddf..fb358dbda`)** | **29** | **0 (+0.03 per landing on harbour, −1 on runner)** | | **120 → 120** |
| `minted` (run 6 → this run) | | 1.37 → **1.12** per landing | | |

- **Reading.** The settling programmes (LIN-4470 "settle the Waiting entries", the piece-level settling in LIN-4447 and LIN-4448) are matching filing over the wave.
  The four pre-v4 landings include the two Periodical reports, which file Waiting entries by design; they are the only net growth in the window.
  The trajectory is converging. It is right-censored: 29 landings and 1.2 days, and a net zero can be settling and filing at the same rate. The next read should check that it holds.
- **Also.** `minted` fell from 1.37 to 1.12 per landing, consistent with run 6's "work moved from tickets into notes". Neither row alone is an improvement.

### F7 — `runs-and-dispatch` and `proxy` surfaces: `dispatch-entrance-churn` and `proxy-churn-concentration` · Severity: Low · **worsened**

| surface | run 6 | this window |
|---|---|---|
| `lib/dispatch-store.js` | 1 touch, 0 net lines (quiet) | **3 touches, +41 lines** (4,530 → 4,571) |
| `routes/proxy.js` | 2 touches | 3 touches |
| `routes/proxy-compute.js` | — | **5 touches** |
| `routes/proxy-writes.js`, `routes/workspace-api-issue-write.js` | — | 4 touches each (LIN-4468 write gate) |
| `lib/proxy-instructions.js` | 7 touches | 7 touches (1,325 → 1,346) |

- The proxy write gate (LIN-4468, "the proxy refuses writes outside the stage's allowance") is a single programme piece and a new enforcement point; the proxy write and issue-write routes it sits beside each have four touches.
  Its notes PR #2446 is still open at run time. The dispatch store is the Runs & dispatch programme's own area, and its three touches are the programme's pieces.
- **Reading.** Concentration on the proxy and dispatch surfaces came back after run 6's quiet, through programme work. Single-programme, single-window; watch whether it recurs.
- **Altitude.** Structural coupling of these routes belongs to Seams & Tangles.

### F8 — `change-composition-inward` · Severity: Low (first trend read) · **the mix flipped toward product code, by design, in one burst**

| class | run 6 (35) | this window (33) |
|---|---|---|
| Measuring and gating programme | 10 | **0** |
| Periodical reports | 9 | **3** |
| Periodicals and loop process | 4 | 0 |
| Papers | 3 | 0 (two open, #2451 and #2452) |
| Outside-find and audit governance | 2 | 0 |
| Product and infrastructure | 7 | — |
| Tidy programmes, code landings | — | **19** (of 25 tidy landings) |
| Tidy programmes, docs-only landings | — | 6 |
| Jira feature (LIN-4445) | — | 4 |
| Governance, reviews, north star | — | 4 |

- Twenty-five of the 33 landings are pieces of four parent programmes: LIN-4447 (12, Done), LIN-4448 (7, In Progress with all seven pieces Done), LIN-4463 (5, In Progress), LIN-4446 (1, Done). Of those 25, 19 change production code and 6 are docs-only.
  The measuring and gating programme had no landings this window, the loop's process layer one (LIN-4468's write allowance, which is a product gate).
- **Reading.** Run 6 asked whether the change in mix was the north-star change working or one burst. It is one burst by parent programme, and it is the wave the north star asked for.
  The test is what follows; the tail (three landings on 14 Nov, the open paper PRs, and the Periodical cadence that fell to 3) is too short to read. Periodical cadence is also down, which F9 notes.
- **Altitude.** UI belongs to Design & Interface; delivery drag to Recent Headwinds.

### F9 — `ci-critical-path-floor` and `review-layer-rate` · Severity: Low · **CI settled at the E2E floor; review-report landings fell**

- **CI.** The declared `ci` median is 5.72 min over 32 runs (run 6: 5.78 over 4 post-break runs). The post-break level has held across 32 runs, so it is a level now, not a series of four.
  The critical path was re-measured this run, over the eight most recent successful `test.yml` runs on `main` (`b8e2a0aad`…`fb358dbda`; `gh run view <id> --json jobs`, longest job by wall clock; `analysis-notes.md` §12.4). **E2E shard 2/4 is the longest job in 6 of 8 runs (320–359 s).** The unit job is the longest in 2 of 8: `a886fb506` at 330 s (E2E 2/4 at 308 s) and `8fea3869f` at 313 s (E2E 2/4 at 304 s). The wall time is therefore set by E2E 2/4 in most runs and by the unit job in the rest, so it is not one shard alone. Run 6's statement that one shard sets it holds for most runs, not all.
- **Review layer.** Landings touching `docs/reviews`: 3 of 33 (run 6: 11 of 35). Periodical report landings: 3 (run 6: 9). Their bytes per landing went 0.13 → 0.12 MB.
  Periodical cadence fell with the tidy wave. The stability run 6 report, the Drift run 7 and the Seams run 12 are the only reports in the window, and the north star is the only other governance landing.
- **Reading.** A fall in the review layer's share is not, by itself, a settling. It is one reason the next readings will be thinner than run 6's. Run 6's option 4 (periodical cadence) is the decision this carries.

### F10 — `measurement-layer-defects` (new) · Severity: Low · **three things in the instrument, none a trajectory finding**

1. **`ci` listing omits a successful run (32 of 33).** `gh run list --workflow test.yml --branch main --status success` omits run `43454782230` for `c205190fd`. Reproduced with
   `--status success --limit 200` (200 rows, none for that head) and with `--created 2026-11-13` (29 rows, none). The same run appears with no `--status`, and `gh run view` reports `conclusion: success`.
   The tool's `readCiRuns` (`scripts/stability-measures.mjs`) reads the filtered listing, so the row under-counts. The row is printed as written; the cause is recorded here; nothing is repaired (review-only).
   The sub-window (`4b5001ddf..fb358dbda`) median is 5.7 on 28 runs with the same omission.
2. **The declaration cites a moved function.** `docs/reviews/stability-measures/README.md` says `landingPrUrls` lives in `lib/run-ledger.js` ("the gate's own reader"). It is now defined in
   `lib/run-trail.js` (line 420) after LIN-4458's "one trail pass", and `scripts/stability-measures-blind.mjs` imports it from there. The declaration says the code is right, so the code is followed.
   The same stale citation remains in `docs/areas/reports-and-operator-tools.md`, `docs/architecture/source-map.md`, `docs/architecture/prompt-system.md` and `docs/proxy-integration.md`.
   Cross-link: Drift & Coherence owns rules held in several places.
3. **`blind` verdicts are self-written.** The `better / same / worse` values come from each ticket's own `## Blind read` comment, which the loop writes. The row is accurate as a count of what the loop recorded;
   as a measure of new mess it is a self-assessment. This is a limit of the declaration, not a defect, and it is noted here so the 20 "better" verdicts are not read as an independent result.

### F11 — `sd-surface` (`opencode-runner-convergence`, carried SD rows) · Severity: Low · **changed: SD's code moved again, within its episodic range**

- Three SD landings. `1616b19` (#339) is docs (+6). `47fb6af` (#340, LIN-4474, "retire columnproblems") changes `hook.js` (23 lines), `transcript.js` (+31), a new 122-line test and docs.
  `7d5fe7d` (#341, LIN-4476) is the runtime contract fixture (+398) and its test (+136). Two of three landings are runtime, against none in run 6.
- `opencode-runner.js`, `dispatcher.js` and `reapers.js` have 0 touches (run 6: 0). `hook.js` and `transcript.js` have one touch each.
- **Reading.** Run 6 found SD code-silent and read that as settling within its episodic base. This window's runtime change came from the same contract fold as F4. The base is still low, and the change is not a sweep.
  SD `waiting.runner` 12 → 12.

### F12 — `ci` and `young-surface-hotspots` are carried, and `stagnation` is unchanged

- `server.js` 5 landings (run 6: 1 of 35), net +2 lines (4,769 → 4,771): touches up, net flat. `server-js-growth` changed in kind.
- Home / task-page cluster: `public/task-page.js` 1 touch (a module conversion), `public/prompt-section.js` 1 touch. Quiet by count; the conversion is in F1's whitespace figures.
- Silent files: `lib/harbour-spawn.js` 228, `lib/providers/registry.js` 90, `lib/render-custom-prompts.js` 133 lines, all unchanged, 0 touches. `stagnation` unchanged.
- Periodic timers: `server.js:1035` (catalog refresh) and `server.js:4710` (hourly cleanup); run 6 had `:4708`. Same mechanisms: `periodic-loop-two-mechanisms` unchanged.

## Trend ledger

Severity: none / low / low–med / med / high. Delta vs 2026-11-13 (run 6): new / unchanged / improved / worsened / changed / resolved / superseded / not re-measured.
All 32 of run 6's names are accounted for below; none is retired this run. Two names are new (`production-churn-rate`, `measurement-layer-defects`); `rebuild-wave` is an existing name, re-read this run.

| Signal (stable name) | Repo | Class | Severity | Reading (this window) | Delta vs 2026-11-13 |
|---|---|---|---|---|---|
| `production-churn-rate` (**new**, F1) | LV | rework / rate | med | 249.6 added, 203.8 deleted per landing (×2.7 and ×7.3; ×1.45 and ×3.3 whitespace-ignored); added lines 3.94% of base; deleted per added 0.82 (0.66 `-w`); net +45.8 per landing | **new** (worsened on rate; deletion ratio worse than run 6's 0.30) |
| `per-task-expense` (F2) | tracker | speed / cost | med | cost median $15.25 (ex-periodicals $14.82); sessions 5 → 7 → 8, of which the 7 → 8 step is the blind-read stage on every task (median 7 without it); look-first prefix flat $2.88 | **changed** (cost level −9% on changed population; sessions unchanged excluding the new stage) |
| `change-composition-inward` (F8) | LV | growth shape / process | low | 25 of 33 tidy programme landings (19 code, 6 docs-only); 4 Jira feature; 4 governance; 0 measuring-programme landings | **changed** (first trend read; the mix moved to product code in one burst) |
| `waiting-stock-vs-minting` (F6) | LV+SD | backlog shape | low | Waiting 110 → 120 total, 0 net over the 29 post-v4 landings; `minted` 1.37 → 1.12 | **improved** |
| `review-evidence-weight` | LV | evidence volume | low | `docs/reviews` +3.94 MB (0.12 MB per landing; run 6 0.13); `docs/papers` 0 touches; `docs/plans` +175 KB (survey) | **improved** (flat per landing; no papers this window) |
| `prompt-contract-text-rate` | LV | rework / contract | low–med | `FROZEN_TOTAL_BYTES` 378,915 → 396,064 (+4.5%), of which LIN-4467's +17,969 is re-budgeting of text moved in from unbudgeted files; LIN-4469 −465 and −355; share of landings touching the ceiling test not re-counted | **changed** (net mostly re-budget; not a rise in new text) |
| `decision-reversal` | LV | rework / direction | low | 0 reverts (LV, SD); build-then-retire not found beyond programme pieces (LIN-4454 retires `dispatchModelOf`) | **unchanged** |
| `test-suite-accretion` (F3) | LV | growth shape / CI | low–med | runtime +2.7% (+688), 20.8 per landing (run 6 16.5); unit files 1.06 per landing (run 6 0.57); 34% of new files census or witness | **worsened** (per landing; medium-low) |
| `ci-critical-path-floor` (F9) | LV | CI topology | low | `ci` 5.72 over 32 runs, a level since the #2414 break; critical path re-measured: E2E 2/4 longest in 6 of 8 main runs (320–359 s), unit job in 2 of 8 (313–330 s) | **unchanged** (settled level; the critical path is mostly one shard, sometimes the unit job) |
| `opencode-runner-convergence` (F11) | SD | surface rate | low | 2 of 3 SD landings runtime (hook.js, transcript.js, contract fixture); 0 touches on opencode-runner, dispatcher, reapers | **changed** (episodic runtime change, not a sweep) |
| `dispatch-entrance-churn` (F7) | LV | surface rate | low | `dispatch-store.js` 3 touches, +41 lines | **worsened** |
| `proxy-churn-concentration` (F7) | LV | surface rate | low | `routes/proxy-compute.js` 5, `proxy-writes.js` 4, `workspace-api-issue-write.js` 4, `proxy.js` 3, `proxy-instructions.js` 7 | **worsened** (write-gate programme) |
| `young-surface-hotspots` | LV | surface rate | low | Home/task-page cluster: `task-page.js` 1 (module conversion), `prompt-section.js` 1 | **unchanged** (quiet by count) |
| `review-layer-rate` (F9) | LV | governance churn | low | 3 of 33 landings (9%); Periodical report landings 3 (run 6 9) | **improved** (share and count down) |
| `rebuild-wave` (see Rebuild filter section) | LV | rework / direction | low | rule finds 15 events (run 6: 1 code, 5 docs); classified: 7 moves, 4 whitespace conversions, 4 real deletions or rewrites, 1 docs | **changed** (more events, mostly moves; real deletions in `completion-signals.js`) |
| `runner-kit-convergence` | LV | surface rate | low | `lib/runner-kit/runner.mjs` 1 touch (+55, contract fold, LIN-4475) | **changed** (touched once, with the contract fold) |
| `lv-sd-contract-coupling` (F4) | LV+SD | change-coupling | low–med | 2 shared runtime contract changes (`contract.json` and `runner-contract.json`, +398 each) | **changed** (from governance-only to runtime) |
| `research-eval-programme` | LV | excluded-path churn | low | `experiments/` 0 touches (590 files, 22.2 MB unchanged); papers 0 | **unchanged** (quiet; two paper PRs open) |
| `server-js-growth` (S2) (F12) | LV | surface rate | low | `server.js` 5 landings (run 6 1); net +2 lines | **changed** (touches up, net flat) |
| `route-boundary-coupling` (S3) | LV | change-coupling | low | not re-measured this run | **not re-measured** (carried) |
| `periodic-loop-two-mechanisms` | LV | surface rate | low | `server.js:1035`, `:4710`; same mechanisms | **unchanged** |
| `stagnation` | LV | silence | low | the three silent files unchanged, 0 touches | **unchanged** |
| `true-reverts` | LV + SD | rework | none | 0 / 0 | **unchanged** |
| `file-growth-vs-rework` | LV | growth shape | med (under `production-churn-rate`) | `churn` 0.82 deleted per added (run 6 0.30; reference 0.36); 0.66 `-w` | **worsened** (reported under F1) |
| `docs-index-churn` (F5) | LV | bookkeeping | low | `source-map.md` 19 touches (0.58 per landing; run 6 0.29); 11 of 11 structural landings co-touch | **worsened** (bookkeeping scaled with moves) |
| `cancelled-session-invariant` | SD + LV | rework | low | keyword search not repeated this run | **not re-measured** |
| `prompt-cluster-coupling` | LV | change-coupling | — | retired in run 4 | **retired** (unchanged) |
| `prompt-parity-coupling` | LV | change-coupling | none | resolved 10-12 | **resolved** (unchanged) |
| `corrective-vs-additive-ratio` | LV | rework | — | not re-measured (classifier recall ≈20%) | **not re-measured** |
| `corrective-vs-additive-ratio` | SD | rework | — | not re-measured | **not re-measured** |
| `project-velocity-trajectory` | LV | overall shape | — | per-day row retired by the declaration | **superseded** by the opening measures (run 6) |
| `project-velocity-trajectory` | SD | overall shape | — | per-day row retired by the declaration | **superseded** by the opening measures (run 6) |
| `ticket-mint-vs-landing` | tracker | proxy | — | same ratio as declared `minted` (1.12 per landing this run) | **superseded** by `minted` (run 6) |
| `measurement-layer-defects` (**new**, F10) | LV | measurement | low | `ci` listing omits a green run (32 of 33); declaration cites moved `landingPrUrls`; `blind` verdicts self-written | **new** |

## Rebuild filter (run 6's rule, both ways)

The rule is: one landing deletes ≥50% of a file's prior lines, `d ≥ 20`, JSON and `_evidence` excluded. Plain: 15 events. With `-w`: 10 events.
The ones that drop out under `-w` are the whitespace conversions. Classified by hand (`analysis-notes.md` §6):

- **Moves or removals (7):** `public/cost-format.js` and `tests/unit/cost-format-parity.test.js` (`92676b1fe`), `lib/recommendation-live-wait.js` (`c174185f6`, renamed to `run-live-wait.js`),
  `tests/unit/workspace-kpis-cost-order.test.js` (`17faa83f4`), `tests/unit/cost-format-consumers.test.js` (`b8e2a0aad`), `lib/prompt-template-defs.js` (`8fea3869f`).
- **Whitespace conversions (4, drop out under `-w`):** `public/workspace-kpis.js` (two landings), `public/task-page.js` (`0cf05ce8f`), `public/flight-companion.js` (`b8e2a0aad`).
- **Real deletions or rewrites (4):** `lib/completion-signals.js` (`8fea3869f` and `fb358dbda`), `lib/run-closeout-state.js` (`d52c676fa`, 307 out / 258 in), `lib/prompts/stage-intent.js` (`8fea3869f`, 39 of 60).
- **Docs (1):** `docs/areas/llm-and-prompts.md` (`fb358dbda`, 102 of 175 deleted: Waiting entries settled).

Run 6's rule was approximate and its counts are not strictly comparable. The `--no-renames` numstat counts a rename as a deletion, so the moves appear here as events.

## Scope audit: in-remit surfaces beyond the ticket's list

| surface | window | reading |
|---|---|---|
| `.github/` | unchanged (`git diff --stat 163efc069 fb358dbda -- .github` empty) | CI topology unchanged; the `ci` series is one workflow |
| `scripts/` | the stability tool's own files: 1 landing touches them in the window | the measuring layer is nearly quiet; LIN-4425 (Backlog, ruling pending) read below |
| `tests/unit/` | 38 files added, 35 net; 1,247 → 1,282 | F3 |
| `tests/fixtures/` | `lin-4467-witness.json` (869 lines), `runner-contract.json` (+398, SD) | witness fixtures for the conversion and the contract fold |
| `tests/e2e/` | not counted by line; the E2E job's critical path was measured this run | F9 (eight main runs) |
| `docs/plans/` | 19 → 38 files, 0.66 → 0.83 MB | `docs/plans/survey/` (area-read reports and the reader prompt) |
| `docs/papers` | 0 touches; 50.56 MB at both pins | two paper PRs open (#2451, #2452), right-censored |
| `docs/areas/` | 29 of 33 landings (88%); 65,654 → 97,835 bytes (+49%; run 6 +94%) | classified as a standing rate below |
| `experiments/` | 0 touches | quiet |
| `lib/periodicals.js` | 2 touches (run 6 4); 1,416 lines | cooling |
| open PRs | #2446 (LIN-4468 notes, open since 13 Nov 22:37Z), #2451, #2452 (papers), nine older PRs unchanged | the notes PR is a split of the write-gate programme |
| parent-programme pattern | LIN-4447 Done (12 landings); LIN-4448 In Progress with 7 of 7 children Done; LIN-4463 In Progress (2 of 2 children Done); LIN-4446 Done; LIN-4445 In Progress | tracker parents lag their children; read as declared |
| SD | 3 landings | F11 |

### `docs/areas` churn: classified as a standing rate

The question run 6 left open was whether area-note churn is bookkeeping for a burst or a standing rate. Its share of landings was 77% (20 of 26 in
`526bca66c^..9574d537`, the window the 8 Nov reference closes), 80% (28 of 35, run 6's window) and 88% (29 of 33, this run). Its volume per landing did not rise: 26.8 → 21.5 → 21.2 added lines per
landing. Bytes per landing are 907 in run 6 and 975 now (+7%); the +49% this window is a share of a shorter window, not more writing per landing.
The share rose because more of the landings are programme pieces that write or settle notes (the 88% includes six docs-only tidy landings).

**Classification: a standing rate, with bookkeeping at its core.** The share was already 77% before the wave, and the volume per landing is flat, so the
note-writing is the process's ordinary rate, not a burst of bookkeeping for the wave. The one way it would turn into a problem, volume per landing rising, is not
present. The next run should read volume per landing, not the share.

### Known-issue surfaces read this run

Each item below was read this run through the proxy or on disk, and its bearing on the trajectory is stated, or the reason it has none.

| Surface (state at the run) | What was read | Bearing on the trajectory |
|---|---|---|
| **LIN-4441**, CI wall time (In Progress; PR #2414 merged `e3a3268a1`, 12 Nov 21:22Z, ticket held open) | The `ci` series steps from 8.59 min (8 Nov) to 5.72 min after #2414. The close-out (12 Nov 21:23Z) records that the deploy could not be evidenced from its session, so the post-merge sample is still open. | **Direct.** It is the change behind the `ci` row. F9's "settled level" is read from 32 post-merge runs, but the ticket's own post-merge sample and deploy evidence are not on record. |
| **LIN-4425**, retire overlapping measuring scripts (Backlog, John's ruling pending) | `scripts/survey-growth-git.mjs`, `scripts/survey-growth-ci.mjs` and `scripts/steady-base-check.mjs` all still exist beside `scripts/stability-measures.mjs`. | Measuring layer, not the product. It decides which instrument the next run reads. F10 records the instrument defects. Not this review's to decide. |
| **LIN-4435**, paper-script tests in CI (Backlog) | Still in none of the CI globs. Papers: 0 touches in the window; #2451 and #2452 open. | **Latent.** The papers' numbers can change with no CI signal. It bears on the trajectory once #2451 or #2452 lands. |
| **LIN-4389**, stale Periodical prompt text (Todo) | The three stale strings are still in `lib/periodicals.js` (lines 327, 409, 625). | **Low.** Documentation drift in the advisory prompts, not a rate of change. Its only bearing is on the review layer (F9), since those prompts still describe minting. |
| **TODO / FIXME markers** in every file touched in the window | None in process code at `fb358dbda`, none at `163efc069`. The grep hits are identifiers (`TODO_TIER_CAP`), a test constant, `LIN-XXXX` placeholders, fixture JSON, and the counting pattern in `scripts/survey-landing-halfdone.mjs`. | None. |

## Class completeness (bounds and members)

| class | bound | members / count |
|---|---|---|
| LV landings | first-parent, `163efc069..fb358dbda` | 33 (all classified: 25 tidy + 4 Jira + 4 governance/reviews/north star) |
| SD landings | first-parent, `af9b496..7d5fe7d` | 3: #339, #340, #341 |
| Declared rows | the declaration's 14, in order | 14 printed; 13 measured, `origin` not measured with its declared reason |
| Run-6 ledger rows | 32 names | all 32 accounted for above (none retired this run; delta stated on each) |
| New rows | — | 2: `production-churn-rate`, `measurement-layer-defects`. The rebuild-wave reclassification re-reads an existing name (changed), so it is not a new name |
| Tidy programmes | parent of each landing's ticket | LIN-4447 (12), LIN-4448 (7), LIN-4463 (5), LIN-4446 (1); 6 docs-only |
| Post-break CI runs | `test.yml` on `main`, head sha a window landing after `eb14b7fff` | 32 of 33 by the tool; 33 of 33 exist with `conclusion: success` |
| Sub-windows | the v4 split | 2 readings (`subwindow-pre-v4`, `subwindow-post-v4`), git and `gh` rows only |
| Cost per task | 25 finished tasks | per-stage sums from `GET /issues/{id}/cost` (raw saved) |
| Unbounded | — | person-origin of dispatches (`origin`); answered task-bound rulings; the reason PR supply came in a burst on 13 Nov |

## Plain-language read for the maintainer

**The tidy wave is doing what it says on the tin, and the curve is only partly showing it.** Measured per landing, the stock of Waiting work has stopped growing, the tickets
filed per landing fell, the CI wall time sits at a settled level, and a finished task costs about what it did in run 6 (on a different sample) rather than more. Those are the
things a settled project shows.

But the wave churns hard to get there. Normalised to the code base, added lines per landing are ×2.6 what they were in run 6 and in the 8 Nov reference, plain (×1.44 whitespace-ignored), and the test
suite grew faster per landing. Half the added lines are re-indentation, and the other half includes real deletions (`completion-signals.js` went from 367 lines to 29) and a
new Jira feature. Net production growth per landing fell, but the comment share rose. Sessions per finished task rose to a median of 8, and that step is the blind-read stage, which every finished task now runs once (7 without it, as in run 6).

**Options a maintainer might weigh (nothing is filed; the decision is yours):**

1. **Let the wave finish and then pause it.** Run one more window after the last piece, and read whether the tidied areas go quiet. The next run is the first that can see it.
2. **Decide whether the look-first prefix and the blind-read stage are worth their floor on every task** (F2). They now cost about $4.9 a task together. The blind read is the new floor: one session on every task, about $1.02.
3. **Ask for the census tests to retire when their conversion settles** (F3). The test layer is accreting for the moves, not for behaviour.
4. **Confirm that LV and SD contract changes stay paired in one window** (F4), or decide that a shared contract needs a single owner.
5. **Fix the `ci` listing** (F10.1) before the next run, so the wall-time row reads 33 of 33. Re-point the declaration's `landingPrUrls` citation (F10.2) in the same change, or leave it to Drift & Coherence.
6. **Watch the review layer.** Periodical report landings fell to three in this window. If the next run also shows few reports, the stability and drift readings will be thinner.

**No follow-up tasks have been created.**

## Adversarial Second-Read

**Tier:** Tier 2. The reader was a fresh-context general-purpose sub-agent with no memory of the research, the plan or the report-writing turn. It was given only the report and evidence paths, both checkouts, the window pins and the question. It worked read-only (`git`, `gh` read commands, python over the evidence). It was not given the report's ranking or its top finding.

**Question:** "What is the largest item in this window that this report missed or misfiled?"

**Reader's answer (in full, as returned):**

> **Verdict: DISAGREE**
>
> **Largest missed or misfiled item:** The report's trajectory read that "sessions per finished task are still climbing (median 5 → 7 → 8)" is not supported by its own data. The 7 → 8 step is one new stage, the blind read. Every one of the 25 finished tasks has exactly one `blind-read` worker session (`cost-per-task-raw.json`, run through python: `kind == 'blind-read'` counts are all 1). Removing that one session per task gives a median of 7 and a mean of 7.04, which matches run 6's median of 7. The blind-read gate came in with LIN-4437/4438/4439 (`eb14b7fff`, `aebe61081`, 12 Nov, just before the window opens). Run 6 had the stage on only 4 of 33 tasks, so the step is by design, not a climb. The report notes the blind-read floor in F2 but still lists sessions as one of "three things [that] moved the wrong way" and makes them "the thing to watch" for the trajectory. The per-kind table in F2 and `analysis-notes.md` §9 also show prefix (2.64 → 2.48) and implementation (1.00 → 0.88) flat or down, so nothing else is climbing. One caveat: run 6's per-kind figures cover a different population (9 Periodical tasks), so I compared only the median and the blind-read counts.
>
> **Runner-up items:**
> - F1's headline "×2.6" is a plain-count, added-side figure. Whitespace-ignored (`git log -w`, tool scope) it is 4,448 / 33 = 134.8 added per landing, about 1.44× run 6's plain 93.6. The report never computes run 6 with `-w`, so the true like-for-like ratio is at least 1.44× and not pinned. The deletion signal survives (`-w` 2,937 / 33 = 89.0 deleted per landing against 28.1, at least 3.2×). The report still ranks F1 first on the 2.6× figure while calling the whitespace-ignored ratio "the honest one".
> - The declared measure 1 ("No new mess") reading (22 of 33 read, better 20 / same 2 / worse 0) is absent from the headline and from the trend ledger. It appears only as a "Read as declared" note and in F10.3 as a self-assessment.
> - The F1 normalisation to base uses added lines only (8,237 / 209,077 and 93.6 / 206,784 reproduce to 3.94% and 1.58%). The report labels this "churn as share of code base" without saying deletions are excluded.
>
> **Claims you checked and found to reproduce:** 33 first-parent landings; tool-scope churn 8,237 / 6,726 and `-w` 4,448 / 2,937; the 0.119% vs 0.045% arithmetic and the run 6 figures; cost median $15.25 / mean $17.17 over 25, $14.82 over 22 ex-Periodical, median sessions 8 / mean 8.04; tidy-programme counts 12 + 7 + 5 + 1 = 25 with 6 docs-only; Waiting 98 / 107 / 108 at the three pins and the sub-window totals 110 → 120 and 120 → 120; the CI omission (`gh run view 43454782230` shows success; the `--status success --limit 200` listing omits it).
>
> **Claims found NOT to reproduce:** none of the figures rechecked failed to reproduce. The gap is interpretive. Not checked: the blind-read "better 20" verdicts (tracker) and the `minted` span.

**Response (each claim re-run against git and the evidence before it was accepted; commands and outputs in `analysis-notes.md` §2 and §9):**

- **Blind-read session step: confirmed and fixed in place.** `cost-per-task-raw.json`: 25 of 25 finished tasks have exactly one `blind-read` session. Median sessions excluding blind read is 7 (mean 7.04), the same as run 6's median. The headline, F2, the ledger row, the plain-language read and maintainer option 2 no longer present sessions as climbing. The step is the blind-read stage arriving by design, and sessions excluding it are flat.
- **Whitespace-ignored comparison: confirmed and fixed in place.** Run 6's `-w` figures were not computed by the report. They are now: run 6 (`9574d537..163efc069`, 35 landings) 3,243 added / 950 deleted, 92.7 and 27.1 per landing; this window 4,448 / 2,937, 134.8 and 89.0 per landing. So added per landing is ×2.7 plain and ×1.45 whitespace-ignored, and deleted per landing is ×7.3 plain and ×3.3 whitespace-ignored. The headline, F1 and the ledger state both readings, and "×2.6" is no longer presented as the single figure. F1 stays first: the rate of production change still rose on both readings, and the deletion signal is larger than the addition signal.
- **Added-only normalisation: confirmed and labelled.** The base-share figures are now "added lines as share of base", with the whitespace-ignored share (0.065% against 0.045%) beside them.
- **Measure 1 absent from the headline: confirmed and fixed in place.** The converging list now states that the blind read ran on 22 of 22 ordinary landings, with 20 better, 2 same, 0 worse, and marks the verdicts as self-reported (F10.3).

**Fields (the engine reads the same three in one body on the task comment):**

Adversarial second-read verdict: DISAGREE
Differed from top finding: YES
Disposition: fixed in place

(The reader's largest item is the session step in F2, not F1 `production-churn-rate`, the report's top-ranked finding. The reader's verdict is DISAGREE; the three corrections above were made in place, and the report's ranking is unchanged.)

**Revision after the LIN-4483 review (`4dea5be07`).** The review requested changes. The fixes that followed are: the paired-area witness section, the `docs/areas` classification, the known-issue reads, the re-measured CI critical path, and the ten review corrections (F1 heading and reading, F2 attribution, the ×2.6 and ×1.44 figures, the headline and "not converging" list, F8 severity, the new-row count, and the F9 wording). **This second read did not review those changes.** Its verdict and fields above stand for the report as it was read. The revision is for the next reader, and the review that follows it.

## Evidence

`docs/reviews/_evidence-2026-11-14-stability/`:

- `reading.json`, `table.txt` — the full committed-tool reading at `fb358dbda`.
- `subwindow-pre-v4.json`, `subwindow-pre-v4.txt`, `subwindow-post-v4.json`, `subwindow-post-v4.txt` — git and `gh` rows only, split at `4b5001ddf`.
- `landings-churn.tsv` — per-landing production and docs churn, programme attribution, areas touched.
- `cost-per-task-raw.json` — `GET /issues/{id}/cost` for the 25 finished tasks.
- `analysis-notes.md` — every ad hoc read behind this report, with its commands and outputs, and the sections the tables above cite.
- `README.md` — the folder's index.
- `revision-r1/` — the inputs and scripts for the revision round (§12 of `analysis-notes.md`): the three area-sample lists and `ci-main-runs-last8.json`.
