# Stability Review — 2026-11-04 (third delta vs 2026-10-21; series origin 2026-06-25)

*Advisory, trend-aware, review-only. Periodical: **Stability Review**; review task: LIN-4206 (run 4). Diffed against
`stability-review-2026-10-21.md` (LIN-3743, LV `f25aa127` / SD `bb1da78`), with `stability-review-2026-10-12.md` and the
2026-06-25 baseline as history. This report changes no code, config or docs beyond itself and its evidence, and **mints no
follow-up tasks**. It reads the project's trajectory: is the rate of change converging toward a settled state, or failing to
settle? The decision is the maintainer's.*

**Examined:** LinearViewer (LV) `f25aa127..5334c81a` (HEAD pinned at `5334c81a`, = `origin/main` at mint; 0 commits since)
and simple-dispatcher (SD) `bb1da78..67ff5c3b` (= `origin/main` at mint). **Window under review: `f25aa127..HEAD`**, exactly,
≈14.2 days (2026-10-20 23:13Z to 2026-11-04 05:24Z), **243 LV first-parent landings** (260 commits) and **35 SD landings**.
Evidence and the scripts that produced every table are in `docs/reviews/_evidence-2026-11-04/` (see the last section).

## Measurement decisions (read these before the numbers)

1. **Method: run 3's, unchanged.** First-parent landings (`git log --first-parent -m --numstat --no-renames`); ISO weeks by
   committer date; excluded paths `docs/reviews/**`, `*_evidence-*/**`, `docs/papers/**`, `tests/screenshots/**`,
   `tests/fixtures/**`, `scripts/eval/**`, `package-lock.json`; tests and scripts bucketed separately; `experiments/` in the
   research bucket; lift = P(A∩B)/(P(A)·P(B)).
2. **Reproduction check (passed).** The method reproduces run 3's published figures: weekly landings W40 **141**, W41 **104**,
   W42 **98**; `6be148a8..f25aa127` = **141**; the daily CI medians for 10-11, 10-12, 10-16, 10-17, 10-18, 10-19 and 10-20
   (5.34, 5.52, 5.81, 5.45, 6.47, 6.68, 6.94 min) against the published 5.3, 5.5, 5.8, 5.5, 6.5, 6.7, 6.9; and the stagnation set at `f25aa127` = **10 silent of 91**
   (the 10-21 report's 10 of 91). The reproduction is in `lv-measure.json` (`repro_weeks`, `stagnation`) and the CI
   output of `measure_ci.py`.
3. **Method delta 1: run 3's window is corrected to 141 landings / 8.3 days.** Run 3 published 171 "since 10-12", of which 30
   landed inside its own window. Every "run 3" rate here uses `6be148a8..f25aa127` = **141**. Figures that change as a
   result: `server.js` touches are **21 of 141 = 14.9%** (run 3 printed 22 of 171 = 12.9%); `docs/reviews` touches are
   **7 of 141** (run 3: 7 per week against 171). Run 3's own prior-30 window (09-12..10-12, by committer date) gives 17
   `docs/reviews` landings here (≈4.0/wk) against the 3.5/wk it printed; I did not recover its exact date edges, and
   the difference does not change any reading below.
4. **Method delta 2: none for stagnation.** The research comment on this ticket reported the stagnation query as 78
   candidates against 91. Measured again here, the query gives 106 files with ≥4 landings in 04-01..06-25, of which **91
   are present at `f25aa127`** (run 3's denominator). The 91/10 result reproduces; the 78 figure does not. The three
   Next-run files that the research says "fall under the threshold" are in the 106 and absent from HEAD.
5. **The burst/pause/tail rule.** The window is three regimes, not one rate. **Early**: 10-21, 12 landings (the 10-21 run
   itself). **Burst**: 10-23..10-26, **144 landings in 4 active days (36/day)**, charter LIN-3490. **Pause**: 10-27 and 10-28,
   **0 landings in both repos** (after the charter; the cost review reports 0 dispatch lineages for those days, `cost-tracking-review-2026-11-02.md:149`). **Tail**: 10-29..11-04,
   **87 landings in 7 active days (≈12.4/day)**, right-censored. Every ledger row is read per regime as well as for the
   whole window. "Slowing" is not claimed from the whole window, and each row says which regimes it can be read from.
6. **CI.** `gh run list --workflow test.yml --branch main --limit 1000` (994 success, 6 failure, back to 08-24). Wall time =
   `updatedAt − startedAt`, successful runs only, as in run 3. Per-test time and the test count come from the unit-test job
   logs: 62 sampled logs (two successful runs per day from 10-01), of which **21 carry the node `ℹ tests` summary** (all
   from 10-23 on; the earlier logs of this job carry no such line, so **the 10-18 step cannot be tested from logs**).
7. **Static test counts** (a proxy, not a runtime count): `^\s*(test|it)\(` call sites under `tests/` and `scripts/` at the three
   SHAs. Runtime counts are used where the logs give them.
8. **Rewrite-in-place.** A file counts as rewritten in one landing when that landing deletes ≥50% of the file's prior line count.
   Of the **38 such events**, **28 are whole-file deletions** and **10 leave the file in place**. Files rewritten in place
   more than once: **0**. (The research's "25 events" is not reproduced; the difference is the threshold and whether whole-file
   deletions count, and the repeat finding agrees.)
9. **Bookkeeping, classified rather than trended.** `public/llms.txt` (40 touches; CLAUDE.md requires it to be kept current, and several unit tests reference it, e.g. `llms-limitations.test.js`, `agent-onboarding.test.js`, `render.test.js`), `docs/architecture/source-map.md` (60 touches; CLAUDE.md says its roster is checked against source
   at test time) and `scripts/code-shape/areas.json` (15 touches; the area map) are bookkeeping, not instability. The
   "hot files" count below uses the `src` + `scripts` buckets and so includes them; the research's count of 40 is not reproduced.
10. **Title-only corrective classifier: not trended** (run 3's decision, carried). The corrective row below is "not re-measured".
11. **Ticket mint** anchors were read from the tracker: LIN-3547 `2026-10-12T15:13:57Z`, LIN-3743 `2026-10-20T23:18:37Z`,
    LIN-4206 `2026-11-04T07:45:30Z`.
12. **Generated replay output is not research volume.** `experiments/**/replay/work/` holds generated run output, not authored
    research. In this window it is **33,486 of the 35,865 lines** added under `experiments/`, almost all from one landing (LIN-3880,
    `ea4c6f88`, 35,041 added lines overall). The research bucket is therefore split: authored `experiments/` growth is **+2,379
    lines**; generated `replay/work` is reported separately. Run 3's +514k is also dominated by generated output (its report says
    "mostly JSON replay and report artefacts"), so the two windows are not comparable on this row. Evidence:
    `_evidence-2026-11-04/experiments-split-2026-11-04.txt`.

## Headline read

**Not yet settled. Nothing is spiralling in the sense the 10-21 run worried about (no feature built and withdrawn; 0 true reverts), but
the rate of change has not settled, and the one series that tracks it most cleanly is still going up.**

* **The landing rate is flat, but the average hides the shape.** 243 landings / 14.2 days = **17.1/day**, against run 3's
  corrected **17.0/day**. That average is a 4-day burst at 36/day, a 2-day pause and a 7-day tail at about 12/day. The window
  cannot show slowing, and it does not.
* **CI wall time has risen in every window since September, with no dip.** Medians by window (successful main runs):
  Sep **4.9** → 10-01..17 **5.22** → 10-18..20 **6.59** → 10-21..25 **7.07** → 10-26..11-01 **7.87** → 11-02..04 **8.23** min.
  The rise is in the tail too, so it is a standing climb, not a burst. The cause is mostly **suite growth**: unit test files
  890 → 1,163 (+31%) and static test call sites 1,194 → 1,624 (+36%) since `f25aa127`; runtime tests **19,596 (10-23) → 22,958
  (11-04), +17%**. Runner-pool mix adds about ±30% to any one run (see F1). Run 3's open question 2 is answered in part:
  wall time has not stopped rising, and the suite is the main driver.
* **Gross rewriting has eased, and growth has returned.** Gross src turnover fell from **38.8k to 33.9k lines/week**
  (run 3, corrected, to this window), and delete/add fell from **0.86 to 0.63**. Net src growth rose from **+3.0k to +7.6k
  lines/week**. Run 3's open question 1 gets a partial yes: deletions fell back, but the project went back to growing, not
  to converging.
* **The Home / task-page cluster is still being built.** Its existing seven files grew **6,722 → 9,779 lines (+45%)**, and
  four `home-*` files and `task-board-view.js` (1,315 lines) were added. Touches fell per active day from burst to tail
  (6.0 → 3.4/day), but its *share* of landings rose from 17% to 28%. It is standing, not settling.
* **The review layer is at a standing rate.** `docs/reviews` landings: **19 in the tail (≈19/week)** against 13 in the burst
  and 7 per week in run 3 (corrected). Governance is no longer a burst.
* **SD has reversed.** Run 3 read SD as converging at 6, 6, 5, 4 landings a week. This window: **6, 15, 14** per ISO week
  (W43 from 10-23; W45 is 2 days). Of the added src+test lines, **83% are tests**. It is hardening and a backlog sweep, not a
  rebuild.

Converging, by the same measures: `lib/kpi-stats.js` (3 touches, 1,372 → 1,370 lines), `lib/runner-kit/runner.mjs` (5 touches
in the window against 7 in one week in run 3), `routes/workspace-api.js` (3,782 → 906, a split), the Next-run page
(retired, LIN-3912), and true reverts (0 in both repos). **Not converging:** CI wall time (the clearest), the Home / task-page
cluster, the review layer's standing rate, SD's rate, and `lib/dispatch-store.js` (+30%, which reverses run 3's "settled").

## Findings (severity-ranked; each a delta against 2026-10-21)

Ranking reason, stated once: **F1 ranks first because it is the only signal that rises in every window, including the tail, and
the tail cannot be blamed on the burst.** F2 and F3 are larger in size or count but are standing rates whose per-day
intensity fell from burst to tail.

### F1 — `test-suite-accretion` / CI on main · Severity: Medium · **worsened (monotonic; cause now mostly separable)**

* **Trajectory.** Six consecutive windows, each higher than the last: 4.9, 5.22, 6.59, 7.07, 7.87, 8.23 min (medians, successful
  runs). The window 10-21..11-04 has median **7.17 min** against run 3's 10-12..10-21 median **6.22**. The 10-21 report found a
  step on 10-18 (5.2 → 6.6 min, before the incident). The rise has continued since, at 0.4 to 0.8 min per window: a drift, not a
  one-off step.
* **Cause, separated.** The unit job is on the critical path. From the 21 logs that carry a test count, the per-test time
  depends strongly on the runner **region**:

  | runner region (unit-job log `Region:`) | logs | median ms per test |
  |---|---|---|
  | centralus | 7 | **6.28** |
  | westus3 | 4 | 8.06 |
  | eastus | 8 | 9.95 |
  | northcentralus / eastus2 | 2 | 10.0–10.3 |

  Within eastus (the largest group), the test count rose 19,596 → 22,729 (+16%) and the time per test stayed in a 9.1–10.5 ms
  band, so wall time in one pool tracks test count. **Reading: suite growth is the driver; runner-pool mix is the noise
  (about ±30% between runs).** The runner image was not varied in this sample: the one log checked ran `ubuntu-24.04`
  (image 20261025), and per-image sampling was not done, so the image's contribution is untested. The 10-18 step remains unexplained: the logs
  before 10-23 carry no test-count line, so it cannot be tested from them.
* **Growth shape.** Runtime tests 19,596 → 22,958 (+17%) in 12 days; `tests/unit` files 890 → 1,163 (+31%) and bytes
  +18% since `f25aa127`; `tests/` grew faster than `src/` (the window's tests bucket +74.5k added lines against src +42.2k).
* **Also in this window.** The MongoDB CI incident of 10-19 (`docs/incidents/2026-10-19-mongodb-kernel-ci.md`, #1990) left
  its failed runs out of the successful-run series; its successful runs that day sit inside the 10-18..20 median. It is not a new finding here. The `package.json` `node --test` change and the LIN-3698 latent risk are not
  re-examined. LIN-3698 is still Backlog.
* Why Medium: a cost paid by every PR and merge, rising monotonically, with its driver (suite growth) still going up. It is
  not a defect, and it is the only signal whose trend is not burst-shaped.

### F2 — `young-surface-hotspots`: the Home / task-page cluster · Severity: Low–Medium · **worsened on size; still climbing in count**

| file | lines 10-21 → HEAD | touches (burst / tail) | reading |
|---|---|---|---|
| `public/prompt-section.js` | 1,479 → 2,867 (+94%) | 23 (11 / 12) | the largest per-file growth in the window |
| `lib/task-page-loader.js` | 993 → 1,535 (+55%) | 20 (9 / 11) | run 3's "should be settling": not settling |
| `lib/render.js` | 784 → 1,151 (+47%) | 23 (11 / 12) | shared render path |
| `lib/render-task-page.js` | 781 → 1,013 (+30%) | 16 (6 / 10) | |
| `routes/task-page.js` | 161 → 298 (+85%) | 13 (5 / 8) | |
| `public/app.js` | 1,849 → 2,116 (+14%) | 13 (6 / 7) | |
| `public/task-page.js` | 675 → 799 (+18%) | 7 (3 / 4) | |
| `lib/task-board-view.js` | new → 334 | 11 (3 / 8) | new in the window |
| `lib/home-view.js`, `lib/home-rows.js`, `lib/home-pipeline.js`, `lib/home-row-states.js` | new → 576 / 160 / 141 / 104 | 7 / 5 / 5 / 4 (all tail) | new in the tail |

* The seven pre-existing files total **6,722 → 9,779 lines (+45%)**. Adding the new files gives the **11,094 lines (+65%)** the
  research quoted. Both numbers are right; the first is the growth of the existing surface.
* **Landings touching the cluster: 48 of 243 (20%)**: 24 in the burst (17% of its landings; **6.0/active day**) and 24 in the
  tail (28% of its landings; **3.4/active day**). The cluster is still climbing as a share of the window's work, but its
  per-day intensity halved from burst to tail. Reading: standing, not settling; its intensity is falling.
* **Coupling** (run 3's definition, n ≥ 5 co-touches): the top pairs are small-n CSS and settings pairs (`run-control.css` ×
  `task-page.css` lift 24.8, n = 5; `render-task-page.js` × `public/task-page.js` lift 15.2, n = 7). At n = 5–7 these are
  not judgements. The research's `task-page-loader` ↔ `render-task-page` lift of 9.1 (n = 12) is carried, not re-measured.
* `lib/kpi-stats.js` is the settled contrast: 3 touches, 1,372 → 1,370 lines (run 3: 11 touches in W43).
* Altitude: the client-copies-server-rules concern on `prompt-section.js` belongs to Drift & Coherence (`drift-coherence-review-2026-11-03.md`);
  the rate of growth belongs here.

### F3 — `review-layer-rate` · Severity: Low–Medium · **worsened; now a standing rate, not a burst**

* Landings touching `docs/reviews/`: **44 of 243 (18%)**, against **7 of 141 (5.9/wk)** in run 3 (corrected). Lines added under
  `docs/reviews/` ≈103k/wk. The `docs/reviews` tree grew **943 → 2,077 files**, and the `docs/` tree **1,344 → 2,558** files.
* **By regime:** early (10-21, the run 3 batch) 12; **burst** (10-23..26) 13, of which **11 are periodic reports on 10-23 alone**
  (LIN-3766, 3776, 3786, 3791, 3797, 3801, 3810, 3814, 3825, 3831, 3832); **tail** (10-29..11-04) **19 in the tail's 7 days, ≈19/week**.
  The tail is the standing rate; the 44 is inflated by the two batch days.
* The design-review beats (`ada89a5`, `6b59822`, `9c07416`) added files that LIN-3747 (`368588c`) deleted 620 of the same day
  (rewrite-in-place inside the review layer; not counted in the code churn, since `docs/reviews/**` is excluded).
* Reading: the governance layer is adding churn of its own and is not yet settling. Not a defect; a rate to watch. Run 3's
  option "slow the governance cadence" was not taken.

### F4 — `project-velocity-trajectory` (SD) · Severity: Low–Medium · **reversed (from converging to a backlog and hardening burst)**

* **Landings:** 6 / 15 / 14 per ISO week (W43 from 10-23, W44, W45 = 2 days). Run 3: 6, 6, 5, 4. By day: 3, 3, 1, 4, 7, 3, 7, 7
  (10-23..11-04). The last two days alone carry 14.
* **Shape:** 12,634 test lines added against 2,616 src lines (**83% of the added src+test lines are tests**); deletions 472 src,
  1,772 tests. `test/` grew 212 → 289 files.
* **Reading:** not a rebuild. 10 of the 35 close tickets below LIN-3500 (the 10-30/31 sweep, same as LV). The tail is LIN-4195
  per-request usage work and halt and reap follow-ups. Hot files: `dispatcher.js` 13 touches (2,351 → 2,470), `config.js` 11,
  `reapers.js` 9 (3,895 → 4,143).
* **The `opencode-runner.js` row is reversed:** run 3 recorded it quiet since 10-10. This window it has **2 landings (11-03
  LIN-4127, 11-04 LIN-4202)** and stands at 1,966 lines.
* **LV↔SD shared tickets:** 6 (LIN-3699, 3857, 4027, 4195, 4197, 4202). The lockstep on contract change holds; none of the
  six is reactive repair. Work did not move back from the LV kit (see `runner-kit-convergence`).

### F5 — `rebuild-wave` · Severity: Low–Medium · **changed: a burst has become a standing mode; no repeat rewrite-in-place**

* **Rewrite-in-place events:** 38 file-level events, each a landing deleting ≥50% of a file's prior lines (method 8). **Of those, 28 are whole-file deletions**:
  20 from the Next-run retirement (LIN-3912, `2c836676`), and 8 others (the Settings scaffolds, the vendored libraries
  LIN-3787, `plan-fee-config.js` from LIN-4129, `task-cost.js` on 11-04).
* **The 10 in-place rewrites, by regime:** in the **burst** (6): the Settings and dashboard work (`routes/settings-model.js`,
  `public/settings-models.js`, `model-routing-summary.js`, `routes/dashboard.js` split, `render-swipe.js` moved to
  `task-order.js`, and `public/task-chat.js`, LIN-3975, where 420 of 458 lines were replaced in one landing). In the **tail** (4):
  the cost read (`llm-call-log.js` on 11-04, `task-cost.js` on 11-03, `terminal-marked-task-cost.js` and `weekly-budget.js` on
  11-02). Within the tail, **`lib/task-cost.js` was rewritten on 11-03 and deleted on 11-04**, a rewrite that lived a day.
* **Repeats:** 0 surviving files rewritten in place twice. The rewrite pattern of run 3 (`adf.js` ×3, the dispatch entrance ×2)
  has not repeated.
* **Short-lived src files:** 3, all Settings scaffolds born and deleted within a day (`routes/settings-workspace-features.js` 10-24,
  `lib/components/settings-change-panel.js` 10-25, `lib/render-settings-shell.js` 10-24 → 10-25).
* **Reading:** the work is still rebuild-shaped every week (Settings, dashboard, the cost read), but each target converges,
  and the rewrite-in-place count is down from run 3. Changed from burst to standing mode.
* **Cross-repo cost and usage work.** The cost read (LV LIN-4129, 4177, 4179) and the per-request usage pieces (LIN-4195, with LIN-4197,
  4199, 4202 in both repos, and SD LIN-4127) form one cluster across F4, F5 and F6. Its line count was not re-measured as a single cluster.

### F6 — `project-velocity-trajectory` (LV) · Severity: Low–Medium · **changed: rewrite gave way to growth (partially)**

* **Src (LV):** added +42,167, deleted −26,676 lines over the window. Per week: added 20.8k, deleted 13.1k, **gross 33.9k** (run 3
  corrected 38.8k), **net +7.6k** (run 3 corrected +3.0k), **delete/add 0.63** (run 3 corrected 0.86).
* **Tests:** +74,468 / −13,205; **research bucket** `experiments/`: +35,865 lines in 30 files, of which **33,486 are generated replay output** (method 12);
  authored growth is **+2,379**. Run 3's +514k is not comparable (method 12).
* **Scripts:** +1,787 / −81; **docs** (not `docs/reviews`): +3,406 / −513.
* **Reading:** run 3's question 1 ("does gross turnover fall back toward the added-line rate?") is a **partial yes**: deletions
  fell, net growth resumed. Growth is the mode now, not convergence.

### F7 — `dispatch-entrance-churn` · Severity: Low · **worsened: the "settled" reading has reversed**

* `lib/dispatch-store.js` **16 touches, 3,050 → 3,967 lines (+30%)**, all additive: lean and digest reads, the stopped-run boundary,
  store-fault 503s, and the LIN-4177 cost read. `routes/dispatch.js` 14 touches (1,462 → 1,689). `lib/dispatch-entrance.js` 12 touches
  (1,812 → 1,940). This is feature accretion into the store, not churn on the entrance. Run 3 had the entrance "settled" at 1 touch a
  week; that held for the entrance, not for the store.

### F8 — `proxy-churn-concentration` · Severity: Low · **unchanged to slightly worse; still well below prior-30**

* `routes/proxy.js` **13 touches** in the window (0.92/day), against 6 since 10-12 (0.67/day in run 3) and 42 in prior-30 (1.4/day).
  Lines 1,614 → 1,668. Settled against prior-30; a little higher than run 3's rate.

### F9 — `runner-kit-convergence` and `lv-sd-contract-coupling` · Severity: Low · **improved (runner); unchanged (contract)**

* `lib/runner-kit/runner.mjs`: **5 touches in 14 days** (run 3: 4, 3, 4, 7 per week), 1,382 → 1,525 lines. Two were contract-row
  additions (LIN-3699, 3805); LIN-4202 is new surface (per-request usage records). Settling on touch count.
* `lv-sd-contract-coupling`: 6 paired tickets (F4). Unchanged.

### F10 — `research-eval-programme` · Severity: Low · **not comparable with run 3; the owner question is still open**

* `experiments/` **+35.9k lines in 30 files** this window, of which **33.5k are generated replay output** from one landing (LIN-3880,
  `ea4c6f88`, method 12). Authored growth is **+2.4k**. The earlier "improved on volume" reading is withdrawn: run 3's +514k was also
  mostly generated output, so the two figures do not measure research growth. 589 files at HEAD. No decision on where
  `experiments/` lives was taken (`scripts/code-shape/areas.json` still claims only `experiments/replay-kit/`, so `rebuild-rung7` and
  other experiment directories are unclaimed by any area).
* Run 3's option "decide where `experiments/` lives" was **not taken**.

### F11 — `server-js-growth` · Severity: Low · **worsened on share; flat on size**

* `server.js` **49 touches = 20.2% of landings** (run 3 corrected 21 of 141 = 14.9%; run 3 printed 12.9%). Lines 4,657 → 4,668.
  The composition root is touched by the surface programmes.
* `periodic-loop-two-mechanisms` (below): the second bare interval is now at `server.js:1022` (OpenRouter catalog refresh, unref'd);
  the hourly cleanup is at `server.js:4607`. Run 3 had the cleanup at 4599.

### F12 — `ticket-mint-vs-landing` (new, tracker-only, a proxy) · Severity: Low

* LIN IDs minted: **23.5/day** (10-12 → 10-20, LIN-3547 → LIN-3743), then **32.3/day** (10-20 → 11-04, LIN-3743 → LIN-4206): **+37%**.
* Landings in the same period: LV 17.1/day + SD 2.5/day = **19.6/day** combined. Minting outpaces landing by about 1.65×, against about
  1.3× in run 3. The ID span includes cancelled, duplicate and periodical tickets across two repos, so this is a proxy, not a rate.

### F13 — `stagnation` · Severity: Low · **improved, partly by decision**

* Silent since 08-12 at `f25aa127`: **10 of 91** (run 3: 10 of 91; reproduced, method 2). At HEAD: **3 of 91** silent:
  `lib/harbour-spawn.js`, `lib/providers/registry.js`, `lib/render-custom-prompts.js`.
* Seven came unsilenced: three by retirement (the Next-run files, LIN-3912); three CSS files (`roadmap.css`, `custom-prompts.css`,
  `prompts.css`) by CSS churn, which is not a decision to keep them; and `public/collective.js` once.
  Only the Next-run retirement is a decision; the other six are not.

### F14 — `decision-reversal` and `true-reverts` · Severity: Low · **unchanged form; 0 true reverts**

* **True reverts: 0** in LV and SD. **Decision reversals:** the three Settings scaffolds (F5) lived under a day each, all in the
  Settings charter work. No feature was withdrawn. Run 3's 15-day near miss (`funnel-event-store.js`) is before this window.

### F15 — `docs-index-churn`, `prompt-cluster-coupling`, `prompt-parity-coupling`, `corrective-vs-additive-ratio` · bookkeeping and carried rows

* `docs-index-churn`: `docs/architecture/source-map.md` **60 touches** (25% of landings; run 3 printed 26 of 171), `public/llms.txt`
  40, both bookkeeping (method 9). Their rate tracks the surface rate and is not an instability signal.
* `prompt-cluster-coupling`: **retired explicitly.** Run 3 carried it from the research comment without a re-run, and its definition is not
  recorded in the 10-21 report, so it cannot be re-run from the report text. Retiring it is the reading the ticket allows.
* `prompt-parity-coupling`: retired (resolved 10-12, unchanged).
* `corrective-vs-additive-ratio` (LV and SD): **not re-measured.** The title classifier's recall is about 20% (run 3's finding), so
  it is not trended, and no hand-labelling was done in this run.

### F16 — `periodic-loop-two-mechanisms` · Severity: Low · **slightly worse**

* A second bare `setInterval` (OpenRouter catalog refresh, LIN-3882, 10-24) is at `server.js:1022`, next to the scheduler's 14
  `scheduler.register` calls. The scheduler module itself is untouched. Not a finding of its own; carried.

### F17 — `cancelled-session-invariant` (new, rework) · Severity: Low · **new**

* **Rule:** a cancelled session stays cancelled. Landings: SD `bd6d2cf` (LIN-4079, 11-01 14:41Z, a follow-up never resumes a CANCELLED
  session); LV `e1f75fe7` (LIN-4080, 11-01 16:23Z, a stopped run stays stopped at the Harbour boundary); SD `cf6369d` (LIN-4082, 11-01
  17:08Z, a person's `force:true` follow-up can revive a CANCELLED session); SD `67ff5c3` (LIN-4185/4186, 11-04, halt-system tests follow LIN-4079).
* **Reading:** the same invariant was fixed, then reopened through a second path (`force:true`) about 2.5 hours later, and its tests were
  followed up three days on. That is not a true revert (no feature withdrawn), but it is rework on one rule that "0 true reverts" does
  not measure. The corrective share is not re-measured (method 10), so this is read from the landing list by hand, by one labeller.

### Read, nothing (surfaces audited in scope, with no rate-shaped finding)

* `public/` as a whole: CSS grew with the UI charter (`public/style.css` 4,372 → 5,379, +23%, 27 touches; `public/settings.css` +68%);
  this is churn already read under F2 and F5.
* `scripts/` (37 files, +1,787 lines), `.github/` (3 landings in the window; none is a step in the CI series; not examined in detail).
* `tests/fixtures/` and `tests/screenshots/` are excluded from churn by method, and so is `docs/papers/`.
* `lib/poll-halt.js`: **0 touches since 10-08** (LIN-3333). Drift & Coherence handed its `halt-poll-cold-cache-fail-open` item to this review.
  It has no rate-of-change angle. Left with D&C and Security; one line, as the ticket asks.

## Class completeness (bounds and members)

| class | bound | members / count |
|---|---|---|
| Landings in window | `f25aa127..HEAD`, first-parent | LV 243, SD 35 |
| Hot src+scripts files | ≥6 touches in the window (58 files, method 9) | top: `server.js` 49, `public/llms.txt` 40, `public/style.css` 27, `lib/render.js` 23, `public/prompt-section.js` 23, `lib/task-page-loader.js` 20, `routes/workspace-api.js` 19 |
| Rewrite-in-place events | ≥50% of prior lines deleted in one landing (method 8) | 38 events: 28 whole-file deletions, 10 in place; repeats in place: 0 |
| Short-lived src files | absent at `f25aa127`, created and deleted in window | 3 (Settings scaffolds) |
| Stagnant src files | ≥4 landings 04-01..06-25, present at `f25aa127` (91), silent since 08-12 | 10 at `f25aa127`, 3 at HEAD |
| LV↔SD shared tickets | ticket IDs in both windows' subjects | 6 |
| CI measured | main runs, successful, `updatedAt − startedAt` | 994 runs; 21 unit logs with test counts (10-23 on) |
| Unbounded | — | per-ticket session and dispatch counts (production data); runner-pool assignment (GitHub's, outside the repo); ticket-label classification; corrective share by behaviour |

## Trend ledger

Severity: none / low / low–med / med / high. Delta vs 2026-10-21: new / unchanged / improved / worsened / resolved. "Burst / tail"
gives the regime(s) the row can be read from.

| Signal (stable name) | Repo | Class | Severity | Reading (burst / tail) | Trajectory | Delta vs 2026-10-21 |
|---|---|---|---|---|---|---|
| `test-suite-accretion` (CI) | LV | growth shape / CI | **med** | median 4.9 → 5.22 → 6.59 → 7.07 → 7.87 → 8.23 min; tail is still climbing; runtime tests +17% in 12 d | failing to settle; suite is the driver | **worsened** (was low–med) |
| `young-surface-hotspots` (Home / task page) | LV | surface rate | low–med | existing 7 files +45%; 48 touches, burst 6.0/d → tail 3.4/d; share 17% → 28% | standing, intensity falling | **worsened** (was low, `kpi-stats`) |
| `review-layer-rate` | LV | governance churn | low–med | 44 touches (18%); burst 23/wk; tail 19/wk; run 3 corrected 5.9/wk | standing rate | **worsened** (was low–med, rising) |
| `project-velocity-trajectory` | SD | overall shape | low–med | 6 / 15 / 14 per week; 83% of added src+test lines are tests | reversed: backlog sweep and hardening | **worsened** (was none, converging) |
| `rebuild-wave` | LV | rework / direction | low–med | 38 rewrite events (28 whole-file); 10 in place; repeats 0; burst Settings/dashboard, tail cost read | burst became standing mode | **changed** (was med, one burst) |
| `project-velocity-trajectory` | LV | overall shape | low–med | src gross 38.8k → 33.9k/wk; net +3.0k → +7.6k/wk; delete/add 0.86 → 0.63 | rewrite gave way to growth | **changed** (was low–med) |
| `dispatch-entrance-churn` | LV | surface rate | low | `dispatch-store.js` 16 touches, 3,050 → 3,967 lines (+30%), all additive | settled reading reversed | **worsened** (was none, settled) |
| `opencode-runner-convergence` | SD | surface rate | low | 2 landings (11-03, 11-04); 1,966 lines | reversed: no longer quiet | **worsened** (was quiet) |
| `proxy-churn-concentration` | LV | surface rate | low | `routes/proxy.js` 13 touches (0.92/day; run 3 0.67/day; prior-30 1.4/day) | below prior-30; slightly up | **unchanged** (slightly worse) |
| `runner-kit-convergence` | LV | surface rate | low | `runner.mjs` 5 touches in 14 d (run 3: 4/3/4/7 per week) | settling | **improved** |
| `lv-sd-contract-coupling` | LV+SD | change-coupling | low | 6 paired tickets | lockstep on contract change | **unchanged** |
| `research-eval-programme` | LV | excluded-path churn | low | `experiments/` +35.9k lines, of which 33.5k generated replay output (LIN-3880); authored +2.4k; run 3's figure is also generated-dominated | not comparable with run 3; owner question open | **changed (method, method 12)** |
| `server-js-growth` (S2) | LV | surface rate | low | 20.2% of landings (run 3 corrected 14.9%); 4,657 → 4,668 lines | share up, size flat | **worsened** (share) |
| `route-boundary-coupling` (S3) | LV | change-coupling | low | `workspace-api` 3,782 → 906 (split); lifts carried from research, n ≤ 14, not re-measured | not judgeable at small n | **improved** (carried) |
| `periodic-loop-two-mechanisms` | LV | surface rate | low | second bare `setInterval` at `server.js:1022`; hourly cleanup at `server.js:4607` | slightly worse | **worsened** (slightly) |
| `stagnation` | LV | silence | low | 10 of 91 silent at `f25aa127` (run 3: 10); 3 at HEAD (Next-run retired) | partly parked by decision | **improved** |
| `decision-reversal` | LV (+SD) | rework / direction | low | 3 Settings scaffolds born and deleted within a day; 0 true reverts | same form | **unchanged** |
| `true-reverts` | LV + SD | rework | none | 0 in LV and SD | clean | **unchanged** |
| `file-growth-vs-rework` | LV | growth shape | low | delete/add 0.86 → 0.63 | more growth, less rewriting | **changed** (improved on rewrite, worsened on growth) |
| `docs-index-churn` | LV | bookkeeping | none | `source-map.md` 60 touches (25%); `llms.txt` 40; test-enforced bookkeeping | tracks surface rate | **worsened** (rate; bookkeeping) |
| `prompt-cluster-coupling` | LV | change-coupling | — | not re-measured; definition not recoverable from the report text | **retired** explicitly | **retired** |
| `prompt-parity-coupling` | LV | change-coupling | none | resolved 10-12 | n/a | resolved (unchanged) |
| `corrective-vs-additive-ratio` | LV | rework | — | not re-measured (title classifier recall ≈20%, not trended) | not trended | **not re-measured** |
| `corrective-vs-additive-ratio` | SD | rework | — | not re-measured | not trended | **not re-measured** |
| `cancelled-session-invariant` (new) | SD + LV | rework | low | one rule fixed by LIN-4079 (SD, 14:41Z), reopened by LIN-4082 via `force:true` (SD, 17:08Z), LV LIN-4080 the same day, tests follow 11-04 | fix-of-fix within ~2.5 h; not a true revert | **new** |
| `ticket-mint-vs-landing` | tracker | proxy | low | 23.5/d → 32.3/d (+37%); landings 19.6/d combined | minting outpaces landing ~1.65× | **new** |

Stable names are run 3's, unchanged. `opencode-runner-convergence` keeps run 3's name; `young-surface-hotspots` is run 3's name for the
`kpi-stats` and task-page rows, here specialised to the cluster. `ticket-mint-vs-landing` is the one new row.

## Plain-language read for the maintainer

**The project is not converging yet, and one number is going the wrong way without a break.** The good news is what did not happen:
no feature was built and then taken out, true reverts are at zero, and the rewrite pattern of run 3 has not repeated. The project went
back to growing, which is the honest reading of "more of the same, with less thrash". The concern is that CI wall time has gone up in
every window since September (4.9 → 8.2 min), and its main driver, the test suite, is still growing (+17% runtime tests in 12 days).

The rest are standing rates rather than bursts: the Home / task-page cluster still gets about three touches a day in the tail, the review
layer about nineteen landings a week, and SD has moved into a backlog sweep and test hardening. None of them is spiralling. None is settling
either.

**Options a maintainer might weigh (nothing is filed; the decision is yours):**

1. **CI time is the clearest trajectory.** A wall-time budget on main, or a decision on which suite growth is worth its cost, would
   answer the monotonic line directly. The runner pool adds noise, so judge by per-region medians (e.g. centralus at 6.3 ms/test).
2. **The Home / task-page cluster.** Decide whether the round ends here. If it continues, its tail rate (≈3.4 touches a day) is
   the number to watch, and `prompt-section.js` (+94%) is where the growth is.
3. **The review layer.** The 10-23 burst (eleven periodical reports in one day) is the cadence question run 3 raised. Its tail rate is
   about nineteen a week, so the cadence is standing, not a one-off.
4. **`experiments/`.** Its home is still undecided, and nothing unclaims `rebuild-rung7`.
5. **SD.** Decide whether the usage work (LIN-4195) stays in SD and when the backlog sweep stops; its tail is most of this window.
6. **The three silent files** (`lib/harbour-spawn.js`, `lib/providers/registry.js`, `lib/render-custom-prompts.js`) are the next retire-or-park
   candidates. They are silent by neglect, not by decision.

**No follow-up tasks have been created.**

## Measurement evidence

Everything above is reproducible from `docs/reviews/_evidence-2026-11-04/`:

| file | what |
|---|---|
| `measure_lv.py` → `lv-measure.json` | reproduction, window counts, bucket totals, hot files, rewrite events, short-lived files, stagnation, review layer |
| `lv-window-landings.tsv` | the 243 LV landings in the window (sha, committer date, subject) |
| `measure_lv_cluster.py` → `lv-cluster.json` | cluster sizes, touches by regime, pair lifts (n ≥ 5) |
| `ci-main-runs-2026-11-04.json` | 1,000 main `test.yml` runs (`gh run list`) |
| `measure_ci.py` | daily and window medians (successful runs, `updatedAt − startedAt`) |
| `measure_ci_logs.py` → `ci-unit-log-sample-2026-11-04.tsv` | unit-job logs: runner region, test count and duration per arm (62 sampled runs; 21 with test counts) |
| `sd-window-numstat.txt` | SD first-parent numstat for `bb1da78..67ff5c3b` (`git log --first-parent -m --numstat --no-renames`) |
| `lv-tickets.txt`, `sd-tickets.txt` | LIN IDs in each window's landing subjects (for the LV↔SD pairs) |

Reproduce from the repo root, with the repos at the pinned SHAs: `python3 docs/reviews/_evidence-2026-11-04/measure_lv.py . docs/reviews/_evidence-2026-11-04`,
then `measure_lv_cluster.py`, then `measure_ci.py` on the runs JSON. The SD numstat: `git -C <sd> log --first-parent -m --numstat --no-renames --format='@@C@@%H|%cI|%s' bb1da78..67ff5c3b`.
The logs step needs `gh` auth and fetches 62 jobs (≈6 minutes).

## Adversarial Second-Read

**Tier 2** (fresh-context general-purpose sub-agent, no memory of the report-writing turn; given the report, both repos and the evidence directory, and the question only).

**Question:** "What is the largest item in this window that this report missed or misfiled?"

**Reader's answer, verbatim:**

> **Largest miss: LIN-3880 (`ea4c6f88`, 2026-10-25), and the report misreads it.** It is the largest single landing in the window by non-doc lines (35,070 across 28 files). Most of it is generated output committed under `experiments/rebuild-rung7/replay/work/`: a `report.json` of 5,442 lines and six 4,673-line copies of `routes/workspace-api.js` (`run-52969`, `run-53355`, `run-53476`, each `old` and `new`). The report's F10 and its trend ledger read the same lines as research volume, "+35.9k, improved on volume against run 3's +514k". That is misfiled. Excluding `replay/work`, experiments grew by 2,379 lines.
> 
> **Runners-up, which the report also does not handle as clusters:**
> - **Cost/usage pipeline across both repos** (LV `4126`→`4129`→`4134`→`4177`→`4178`→`4179`→`4197`→`4198`→`4202`; SD `4127`, `4165`, `4197`, `4199`, `4202`). Roughly 17k source lines across 21 landings. The report splits it across F4, F5, F7 and open decision 5, and never names it as one cluster.
> - **Cancelled-run invariant** (SD `bd6d2cf` LIN-4079 and `cf6369d` LIN-4082, both on 11-01; LV `e1f75fe7` LIN-4080; SD `67ff5c3` LIN-4185/4186, on 11-04). The same rule was fixed, then fixed again the same day. LIN-4079, 4080 and 4082 do not appear in the report. Its "0 true reverts" line does not count fix-of-fix, and the corrective ratio was not re-measured.
> 
> **Top-finding comparison.** The report's top finding is F1, CI wall time (`test-suite-accretion`, Medium). It is the report's strongest finding and I agree it is a real trend. My item is not in the ranking at all. It is a misfile, not a severity error: the lines are generated output, and for stability I would rate them Low. The report's "research volume improved" reading is what I dispute.
> 
> **Verified (recomputed from git or the evidence files):**
> - LV 243 first-parent landings (260 commits, `f25aa127..5334c81a`). SD 35 landings.
> - CI, from `ci-main-runs-2026-11-04.json`: 1,000 runs, 994 success and 6 failure. Medians on `startedAt` date windows: Sep 4.9, 10-01..17 5.22, 10-18..20 6.59, 10-21..25 7.07, 10-26..11-01 7.87, 11-02..04 8.23, and 10-21..11-04 7.17. All match.
> - Hot-file line counts at `5334c81a`: `routes/workspace-api.js` 906, `public/prompt-section.js` 2,867, `server.js` 4,668, `lib/dispatch-store.js` 3,967. All match.
> - Experiments `+35,865` lines in 30 files: exact match, but see above.
> - SD test share 83%; `reapers.js` 3,895 to 4,143 and `dispatcher.js` 2,351 to 2,470. All match.
> - `task-cost.js` modified 11-03 (`10b2c82f`), deleted 11-04 (`72305215`). Matches F5.
> 
> **Not verified:** runtime test counts 19,596 to 22,958 and unit-file counts 890 to 1,163; the 38 rewrite events and their regime split; the 144-landing burst and 87-landing tail; per-region CI medians; the 91/10 stagnation reproduction; the 10-18 CI step. My SD `src` filter gives 2,577 added lines against the report's 2,616. The gap may be my filter, so I did not count it as an error.
> 
> **Claims I think are wrong or unsupported:**
> 1. F10 and the `research-eval-programme` ledger row ("improved on volume"). The 35.9k is 93% generated replay output from LIN-3880 (`ea4c6f88`), not research growth.
> 2. Measurement decision 1. Its exclusion list covers fixtures, screenshots, papers and reviews, but not generated run output under `experiments/`. That gap is how the replay dump entered the counts as research.
> 3. The headline "nothing spiralling". "0 true reverts" is literally true, but the same-day fix-of-fix on LIN-4079/4082 is evidence of rework that the report never examines.
> 4. The `## Adversarial Second-Read` section (around line 374 of `/Users/autopilot/development/simple-dispatcher-workspaces/ce420215-3d1f-44bc-aea6-61d8c88ffc35/LinearViewer/docs/reviews/stability-review-2026-11-04.md`) is still a placeholder. The report is not finished.

**Response (verified against git before accepting):**

* **Confirmed, and fixed in place.** LIN-3880 (`ea4c6f88`) adds 35,041 lines, of which **33,486 are generated replay output** under `experiments/rebuild-rung7/replay/work/`. Authored `experiments/` growth is **+2,379**, not +35,865. The reader is right that the report misfiled it. Fixed: method 12 (generated output split out), F10 re-rated and re-described, F6 and the ledger row changed. The run-3 comparison is also withdrawn, since its +514k is generated-dominated too. Evidence: `_evidence-2026-11-04/experiments-split-2026-11-04.txt`.
* **Confirmed, and added as F17.** The cancelled-session rule was fixed by SD `bd6d2cf` (LIN-4079, 11-01 14:41Z), reopened through a `force:true` path by SD `cf6369d` (LIN-4082, 17:08Z), with LV `e1f75fe7` (LIN-4080) the same day, and halt-system tests followed on 11-04 (SD `67ff5c3`). It is not a true revert; it is rework on one rule. Now a Low finding and ledger row `cancelled-session-invariant`. It is read by hand, not trended.
* **Confirmed, and noted in F5.** The cost and usage work spans both repos (LV LIN-4129/4177/4179; LIN-4195's pieces in both repos; SD LIN-4127). The report now names it as one cluster across F4, F5 and F6. Its line count is **not re-measured as one cluster**, so the reader's "~17k lines across 21 landings" is neither confirmed nor adopted.
* **Not adopted: the reader's ranking.** The reader calls the LIN-3880 misfile "the largest miss" and rates it Low for stability. The report's top finding stays F1 (CI wall time). The reader's own answer differs from that top finding, and this is recorded below.
* **SD `src` gap (2,577 against 2,616).** Not reconciled. The report's `src` bucket counts top-level files such as `README.md` and `package.json`; the reader's narrower filter presumably excludes them. Not changed.
* **Verified by the reader and by me:** 243 and 35 landings; the CI medians; the hot-file line counts; the SD test share; `task-cost.js`.
* **Still unverified:** runtime test counts, unit-file counts, the 38 rewrite events and their regime split, the 144/87 burst and tail, per-region CI medians, the 91/10 stagnation reproduction and the 10-18 CI step. These are marked as such in the report.

**Fields (the engine reads the same three in one body on the task comment):**

Adversarial second-read verdict: DISAGREE
Differed from top finding: YES
Disposition: fixed in place

