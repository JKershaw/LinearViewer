# Stability Review — 2026-10-12 (first delta vs the 2026-06-25 baseline)

*Advisory, trend-aware, review-only. Periodical: **Stability Review**; review task: LIN-3547. Second run in
the series; the baseline is `stability-review-2026-06-25.md` (LIN-673, HEAD `8de7da5`). This report changes
no code and **mints no follow-up tasks**. It reads the project's *trajectory*: is the rate of change
converging toward a settled state, or failing to settle? The decision is the maintainer's.*

**Examined:** LinearViewer (LV) `6be148a8` and simple-dispatcher (SD) `0d54b97`, both = `origin/main` at run
time. **Span since baseline: 15 weeks** (2026-06-25 → 2026-10-12). The series has two runs, so "trend" means
baseline vs now plus within-window slicing from `git log`; no more resolution is claimed.

## Measurement decisions (read these before the numbers)

1. **Unit = first-parent landings** (`git log --first-parent -m`: one landing per PR, merged or squashed).
   Raw commit counts stopped being comparable: non-merge commits per landing were 1.08 in mid-June but
   2.75–3.30 in late September, because multi-commit branches now land through merge commits. Raw counts
   would read W40 as a 4× spike; in landings it is **141, about the June peak** (W26 134, W27 136).
2. **The baseline series is re-expressed in landings.** The baseline's W26 "161" was a 4-day partial week
   counted in raw commits; full W26 is 224 raw commits = **134 landings**.
3. **Buckets.** Excluded from the core measurement: `docs/reviews/**`, `_evidence-*`, `docs/papers/**`,
   `tests/screenshots/**`, `tests/fixtures/**`, `scripts/eval/**`, `package-lock.json`. Reported separately:
   **test** (`tests/**`, SD `test/**`) and **script** (other `scripts/**`). **src** is everything else.
   `scripts/survey-*` alone was 182 files / 22k lines in W40 and would inflate "source" growth by ~38%.
4. **Corrective classifier.** Applied to the landing title (the PR title for merge landings, else the
   subject): `fix|fixes|fixed|repair|regress(ion)|revert|restore|re-point|hotfix|broken|bug|undo|rollback`.
   Hand-check precision ≈ 75% (false positives are mostly "fix" in feature prose). It was **re-applied to
   the baseline window**, where it reads **7–14%**. The baseline's "0.4%" came from a narrower `^fix:` grep
   and is not comparable; this report never compares across methods. Ticket-title/label classification was
   **sampled, not censused** (~1,000 tickets at 60 req/min).
5. **Windows.** Baseline 05-26..06-25; 06-25..07-26; 07-26..08-26; 08-26..09-12; **recent = last 30 days
   (09-12..10-13)**; **immediate = last 7 days (10-05..10-13)**. ISO weeks by committer date; W42 is one day.
6. **Co-change.** Share of landings touching both A and B, Jaccard, and **lift** = P(A∩B)/(P(A)·P(B)).
   Mean src files per landing (3.1 base → 4.0 recent) is the control for bigger landings.
7. **SD** has no stability baseline: its rows are **new / baseline**, with no delta invented.

## Headline read

**The project is not spiralling, but it has stopped looking like the baseline's calm expansion. The
volume is back at its June peak, and the new shape is *direction changing faster than the build*.** Rework
by the broad classifier is flat (~8%), the proxy concentration fell, the prompt-parity coupling was removed
at the root, and a first consolidation phase appeared. Against that, six build-then-remove episodes fell in
ten days (10-02..10-12), velocity is bursty with growing amplitude, and the three hub surfaces are
entangling faster than larger landings explain. SD is the opposite: converging (6 landings/wk, from 33–36).

## Findings (severity-ranked, each a delta vs 2026-06-25)

### F1 — `decision-reversal` (NEW) · Severity: Medium · watch

Short-lived code: src and test files born in a window and deleted within 14 days. **2.5% (5/204) base, 1.0%,
0.0%, 0.0%, then 9.7% (54/559) in the last 30 days**, all 54 born 2026-10-02..10-09. SD: 2.3% (1/43).

Six build-then-remove episodes, all in 10 days:

| # | Built | Removed | Gap |
|---|-------|---------|-----|
| 1 | Share links, LIN-3243/3244/3255/3073/3312/3313/3315 (10-02..10-05) | LIN-3325 `65068a26` (10-06), 16 commits, −7,987 lines | 4 days |
| 2 | Same-kind binding plumbing, LIN-3240 (10-02, plus 12 `lin-3126-*` tests) | LIN-3335 `bf58918b` (10-07) | 5 days |
| 3 | Brief writer "behind a switch", LIN-3293 (10-03) | LIN-3300 one-path `84599242` (10-05) | 2 days |
| 4 | Ticket-closed sweep, LIN-3366 `993c3923` (10-09) | LIN-3399 `5943c918` (10-09) | same day |
| 5 | ifParked H0 across both repos, LV LIN-3436 `8e407057` / SD LIN-3430 (10-09) | LIN-3438 `159b6822` (LV), `eb7e123`/`3dc08b5` (SD) (10-10) | 1 day |
| 6 | "Merged by you" notice, LIN-3248 `dedf98c6` (10-03) | LIN-3426 `61824e63` (10-12) | 9 days |

Bound: the short-lived-file query since 06-25 plus a revert/retire/rollback subject scan since 05-01.
Earlier whole-feature reverts `b6e7cf27` (06-28, Theme S1–S3) and `35dc0e14` (07-12, LIN-1270) are the same
kind but isolated. Excluded as benign: LIN-3383→3408 (same-day merge into one gate: consolidation) and
LIN-3333 (7-week pruning of `repo=` lines).

**Reading.** Every removal was clean and ticketed: no fix-on-fix, no regression chain. This is not code
thrash; features merged ahead of a settled decision and were withdrawn within days. All six sit in one
ten-day span, so it is either a one-off batch or a new rhythm. Only the next run can say; grade the
trajectory, not the count. It also feeds the `periodic-loop`/close-out seam below (episode 6).

### F1b — `research-eval-programme` (NEW, added after the second-read) · Severity: Low–Medium · watch

Excluded paths hold the largest churn in the window. In the last 30 days (first-parent, added lines)
`docs/papers/**` + `scripts/eval/**` total ≈193k lines (papers ≈127k, eval ≈67k), against ~36k product-src
lines/wk. By week `docs/papers` added 0.9k (W37), 3.0k (W38), 1.2k (W39), **92.9k (W40)**, 28.9k (W41);
`scripts/eval` 1.2k (W38), 23.5k (W39), **41.4k (W40)**. Largest landings: #1748 `3ad34935` (LIN-3309, 31.5k
lines, 30.2k eval), #1770 `4daba6c5` (27.7k, all papers). HEAD holds 211 paper files and 221 eval files.
It is excluded from the product measurement on purpose, but F1's reading is incomplete without it: the
research programme plausibly fed the decisions that were then reversed (LIN-3300 one-path, LIN-3309). That
causal link is **unverified**. `docs-index-churn` below remains the narrow bookkeeping reading only.

### F2 — `project-velocity-trajectory` · Severity: Low–Medium · WORSENED (bursty, growing amplitude)

Baseline read "rising, not asymptotic". Landings per ISO week (baseline era re-expressed):

| W23 | W24 | W25 | W26 | W27 | W28 | W29 | W30 | W31 | W32 | W33 | W34 | W35 | W36 | W37 | W38 | W39 | **W40** | **W41** |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 45 | 119 | 70 | 134 | 136 | 85 | 53 | 56 | 36 | 39 | 47 | 83 | 75 | 115 | 63 | 34 | 71 | **141** | **104** |

- **Shape:** June peak → lull (W31–W33, 36–47) → burst (W36, 115) → trough (W38, 34) → second burst
  (W40–W41). Oct 11 and Oct 12 ran 32 and 30 landings/day against a baseline-era daily peak of 36.
- **Landings are bigger.** Mean src files/landing 3.1 → 4.0; product-src lines/wk **35.8k in both W40 and
  W41** (about 1.6× the June peak 22.3k); src lines/ticket 344–376 against 150–200 at baseline. Test lines
  74.1k / 61.2k in W40/W41; script lines 22.2k in W40 (survey tooling) then 3.0k.
- Not converging: amplitude rises each cycle. W40 is not a one-off, since W41 matched its src volume.
- **SD (new/baseline):** 33–36 landings/wk (W27–W30) → 10–27 (W31–W36) → **6/wk (W40–W41)**, on ~21.7k JS.
  That is convergence in volume.

### F3 — `route-boundary-coupling` (S3) · Severity: Low–Medium · WORSENED (entangling)

| pair | base Jaccard / lift | recent Jaccard / lift |
|---|---|---|
| workspace-api ↔ proxy family | 12% / 1.5 | **23% / 2.9** |
| workspace-api ↔ server.js | 14% / 1.9 | **18% / 2.4** |
| proxy family ↔ server.js | 9% / 1.0 | **21% / 2.1** |

Landings are 30% bigger by src-file count but lift roughly doubled on all three pairs; proxy↔server went from
independent (1.0) to coupled. Drivers (47 two-of-three landings in 30 days) are cross-cutting programmes:
the connection/credential cutover (LIN-3124/3126/3240/3241/3335), runner and dispatch grants
(LIN-3130/3131/3136/3137/3383/3409), one-path (LIN-3300), share links and their removal, and free-tier runs
(LIN-3238/3239). The **W41 consolidation sweep** (LIN-3459/3460/3465/3469/3472, e.g. "route JSON error
replies through lib/errors.js (96 sites)") is also a driver, and is *convergent* work that reads as
coupling. Split the two when reading this row. Structure of the boundary is Drift & Coherence's.

### F4 — `test-suite-accretion` (NEW) · Severity: Low–Medium · rate only

Unit test lines 32,438 → 285,967 (**8.8×**) while src grew 2.8×. Test lines churned per product-src line
≈0.64 (W22–W26) → **1.9** (W40–W41). Ticket-named `tests/unit/lin-NNNN-*` files: 0 → **175**, births
1 / 28 / 68 / **92** (Jul / Aug / Sep / Oct 1–12). CI median wall time on main (`gh run list --workflow
test.yml`): W38 4.1 → W39 4.7 → W40 5.0 → W41 5.3 → **W42 5.7 min** (only W37+ is retrievable). Structure is
owned by Code Quality test-estate 2026-10-12 (LIN-3517, T-ticket-named); this row owns only the rate.

### F5 — `true-reverts` · Severity: Low–Medium · WORSENED

Baseline 0 in 30 days. Since baseline there are four whole-feature reverts (`b6e7cf27`, `35dc0e14`, share
links 10-06, ifParked 10-10). **Last 30 days: 3 across the two repos**: in LV one `This reverts commit` body (`159b6822`, ifParked) plus the LIN-3325
16-commit hand revert; in SD the ifParked revert (`eb7e123`/`3dc08b5`). LV alone is 2. (The second-read could not reproduce "two" LV `This reverts` bodies; corrected here.) All clean; see F1.

### F6 — `server-js-growth` (S2) · Severity: Low · unchanged to slightly worse

Share of landings 14% (base) → 20% / 15% / 14% → **16% recent, 19% immediate**; line share ≈2% throughout.
Size 2,088 (06-25) → 4,071 (09-14) → 4,096 (09-28) → 4,504 (10-05) → 4,582: flat for two weeks, then +408
in W40 (growth in batch steps). It grew 2.2× while src grew 2.8×, so its share of src fell 3.3% → 2.5%.
Size itself is Code Quality's (LIN-1249); not flagged here. Baseline "climbing" is now "batch-stepped".

### F7 — `opencode-runner-convergence` (SD, NEW) · Severity: Low

SD hotspots by landings across W23–W30 / W31–W37 / W38–W42:

| file | landings | corrective | size |
|---|---|---|---|
| `reapers.js` | 37 / 37 / **7** | 4 / 4 / **0** | 490 → 3,740 |
| `dispatcher.js` | 75 / 28 / 15 | 6 / 4 / 1 | converging |
| `hook.js` | 52 / 19 / 6 | 4 / 0 / 1 | converging |
| **`opencode-runner.js`** | 23 / 8 / **9** | 0 / 0 / **3** | 1,207 → **1,886 (+56% in 4 weeks)** |

`opencode-runner.js` is the one SD surface not converging: flat touches, rising repair share, growing.
Cross-cite Recent Headwinds 09-26 H6 (an OpenCode harness being finished, 5 open faults) and Drift 10-12
"unproven-watch". SD overall: corrective 10% (32/321), **24% (8/34) in the last 30 days on falling volume**,
the late-phase shape of a component being finished.

### F8 — `dispatch-entrance-churn` (NEW) · Severity: Low

`routes/dispatch.js` ran mostly 0–6 landings/wk (one 11 in W29), then **13 / 15 in W40–W41**;
`lib/dispatch-store.js` had 33 landings in 30 days. Both are the dispatch entrance Code Quality 10-12
(F-dispatch-entrance, LIN-3545) owns structurally; this row tracks only whether the rate settles.

### F9 — `stagnation` (new reading) · Severity: Low

Query: src files with ≥4 landings in 04-01..06-25, present at HEAD, no landing since 08-12: **14 of 84**.
Roadmap (`public/roadmap.css`, `lib/roadmap.js`, `lib/swim-lanes.js`), custom prompts
(`lib/render-custom-prompts.js`, `public/custom-prompts.css`), `lib/recommend-recurse.js`, next-run
(`public/next-run.js`/`.css`, `lib/render-next-run.js`), `public/collective.js`, `public/prompts.css`,
`lib/harbour-spawn.js`; `lib/linear.js` and `lib/providers/registry.js` are quiet because they are done.
Open tickets still pointing at them: roadmap 25, next-run 17, collective 22, recommend-recurse 9,
harbour-spawn 6. Roadmap is flagged power-user, next-run and collective experimental
(`docs/architecture/views.md:5`): parked by tier rather than abandoned, though the backlog keeps asking for
work there.

### F10 — `proxy-churn-concentration` (S1) · IMPROVED

| window | landings | proxy family land% / line% | `routes/proxy.js` land% / line% |
|---|---|---|---|
| base | 344 | 20% / 9.6% | 19% / 8.8% |
| 06-25..07-26 | 372 | 19% / 8.3% | 17% / 6.5% |
| 07-26..08-26 | 241 | 16% / 8.3% | 14% / 6.2% |
| 08-26..09-12 (LIN-679 split) | 202 | 21% / 34.7% | 16% / 15.8% |
| **recent** | 404 | **20% / 7.0%** | **10% / 0.9%** |
| immediate | 129 | 22% / 5.6% | 12% / 1.3% |

`routes/proxy.js` was 4,496 lines in one file; the family is now 9,643 lines across 15 `routes/proxy*.js`
files (`routes/proxy.js` itself 1,612), and `lib/proxy*.js` went 1,212 → 5,183. Family line share fell 8.9% →
8.2% of src (total src JS 63,930 → 179,993, 2.8×). The baseline's question ("does the rate fall once the
provider migration lands?") is answered: the single-file concentration is gone (LIN-679, Done 2026-09-05).
The W40–W41 bounce tracks overall volume. Local hotspot to watch: `routes/proxy-dispatch.js` (1,911 lines,
32 landings in 30 days) and `lib/proxy-instructions.js` (31).

### F11 — `prompt-parity-coupling` (S4) · RESOLVED

`lib/prompts/meta-prompt-template.js` was deleted 2026-10-04 by LIN-3300 (`19d7198a`, "one path for every
recommendation"); CLAUDE.md now states the one-path invariant, so the both-paths parity coupling no longer
exists (file confirmed absent at HEAD). Successor cluster `prompt-cluster-coupling` (NEW baseline, 8 days
old, not judged): `lib/prompt-template-defs.js` (1,233), `lib/prompt-templates.js` (458),
`lib/stage-router.js` (152), `tests/unit/prompt-templates.test.js` (4,420),
`scripts/prompt-template-change-log.md` (19 landings in 30 days), `public/prompt-section.js`. The
prompt-size freeze (`tests/unit/prompt-size-budget.test.js`) caps growth by construction.

### F12 — `file-growth-vs-rework` · IMPROVED (first consolidation phase)

Src files added/deleted: W40 **+70 / −0**, W41 **+52 / −17**. Deleted/added lines ran 0.1–0.3 most weeks;
W41 was **0.58**, the highest since W25. W41 is a "one X, retire N copies" wave (LIN-3459, 3460, 3464, 3465,
3466, 3468, 3469, 3473, 2389), the first convergent pruning phase in the series. Still expanding overall.

### F13 — `corrective-vs-additive-ratio` · LV unchanged; SD new

LV, broad classifier: 7–14% in the baseline window, 8–9% through July–August, 4–5% in W32–W34, a 20% spike
in W35 (a batch of 15 small `fix` tickets, LIN-2263..2384), **7% / 6% / 7%** in W40/W41/W42. Total since
05-18: 133/1,573 = **8.5%**, flat with no climb. The headline "baseline 0.4% → now 8%" is a method artefact,
not a worsening. SD: see F7.

### Not moving / watch (no severity)

- **`docs-index-churn`:** `docs/papers/**` born W37 (09-11), landings 17 / 16 / 7 / **48** / 8: a burst
  that collapsed (the W40 research programme, LIN-3188..3220). `docs/architecture/source-map.md` (born W38,
  6 / 3 / 16 / 23 landings) took over CLAUDE.md's role (CLAUDE.md 20 landings in W36 → 3 in W41) and is
  checked against source at test time: bookkeeping, not an unsettled boundary. Severity none.
- **`periodic-loop-two-mechanisms`** (Drift 10-12): `lib/scheduler.js` unchanged since `608230b7` (LIN-2128,
  08-16); the hourly loop moved to `lib/hourly-cleanup.js` in one commit (`596ad272`, LIN-3424, 10-12), too
  new to judge. Not moving. Severity none.
- **LIN-3395 close-out seam:** `lib/close-out-events-store.js` born 10-03 (LIN-3248); 3 landings in 9 days
  (LIN-3248 → LIN-3395 `e24f8d12` → LIN-3426 `61824e63`), one retiring part of the original build. Young
  surface, expected churn; feeds F1 episode 6. Watch.

## Class completeness (bounds and members)

- **Trend Ledger rows:** the baseline's 9 stable names plus `decision-reversal`, `test-suite-accretion`,
  `opencode-runner-convergence`, `dispatch-entrance-churn`, `prompt-cluster-coupling`, `docs-index-churn`,
  `periodic-loop-two-mechanisms`.
- **Build-then-remove episodes:** bounded by the short-lived-file query since 06-25 plus the
  revert/retire/rollback subject scan since 05-01; members are F1's six plus `b6e7cf27` and `35dc0e14`.
- **Hub surfaces:** bounded by the top-25 files by landings in the last 30 days: the proxy family (26 files),
  `server.js`, `routes/workspace-api.js`, `routes/dashboard.js` (35 landings), `routes/dispatch.js` (34),
  `lib/dispatch-store.js` (33), `public/common.js` (28), `public/prompt-section.js` (22).
- **SD hotspots:** top production files by size: `reapers.js`, `dispatcher.js`, `hook.js`,
  `opencode-runner.js` (`e2e-smoke.js` is a harness).
- **Stagnation candidates:** the 14-file query in F9.
- **Unbounded or sampled:** ticket-title/label corrective classification (rate-limited; sampled); CI timing
  before W37 (`gh` list limit). A surface whose churn is inside excluded paths but is product behaviour is the
  way this set could be wrong; `scripts/**` is the candidate and was bucketed separately rather than dropped.

## Trend Ledger

Severity: none / low / low–med / med / high. Delta vs 2026-06-25: new / unchanged / improved / worsened /
resolved. SD rows are baseline (no prior series).

| Signal (stable name) | Repo | Class | Severity | Reading | Trajectory | Delta vs 2026-06-25 |
|---|---|---|---|---|---|---|
| `decision-reversal` | LV (+SD 2.3%) | rework / direction | **med** | 9.7% of last-30 files short-lived; 6 episodes in 10 days | unknown (one burst) | **new** |
| `project-velocity-trajectory` | LV | overall shape | low–med | 141/104 landings W40/W41; 35.8k src lines/wk; 4.0 src files/landing | bursty, amplitude rising | **worsened** |
| `route-boundary-coupling` (S3) | LV | change-coupling | low–med | lifts 2.9 / 2.4 / 2.1 (base 1.5 / 1.9 / 1.0) | entangling | **worsened** |
| `test-suite-accretion` | LV | growth shape | low–med | tests 8.8× vs src 2.8×; CI 4.1 → 5.7 min | accelerating | **new** |
| `research-eval-programme` | LV | excluded-path churn | low–med | ≈193k papers+eval lines in 30d, W40 peak | collapsing after W40 | new |
| `true-reverts` | LV | rework | low–med | 3 in 30d (base 0) | up, clean reverts | **worsened** |
| `server-js-growth` (S2) | LV | surface rate | low | 16% of landings (base 14%); 4,582 lines | batch-stepped | unchanged (slightly worse) |
| `opencode-runner-convergence` | SD | surface rate | low | 9 landings, 3 corrective, +56% size | not converging | new / baseline |
| `dispatch-entrance-churn` | LV | surface rate | low | `dispatch.js` 13 / 15 landings W40–W41 | bursting | new |
| `stagnation` | LV | silence | low | 14 of 84 files silent; 25/17/22/9/6 open tickets | parked-by-tier | new reading |
| `proxy-churn-concentration` (S1) | LV | surface rate | none | family 20% / 7.0% lines; `proxy.js` 10% / 0.9% | settled into sub-routers | **improved** |
| `prompt-parity-coupling` (S4) | LV | change-coupling | none | rule and file deleted by LIN-3300 | n/a | **resolved** |
| `prompt-cluster-coupling` | LV | change-coupling | none | 8 days old | not judged | new / baseline |
| `file-growth-vs-rework` | LV | growth shape | none | +70 / +52 src files W40/W41; delete ratio 0.58 in W41 | expanding + first consolidation | **improved** |
| `corrective-vs-additive-ratio` | LV | rework | none | ~8.5% broad classifier, 6–7% W40–W42 | flat | unchanged (method re-based) |
| `corrective-vs-additive-ratio` | SD | rework | none | 10% overall, 24% last 30d on falling volume | finishing shape | new / baseline |
| `project-velocity-trajectory` | SD | overall shape | none | 33–36 → 6 landings/wk | converging | new / baseline |
| `docs-index-churn` | LV | bookkeeping | none | papers burst collapsed; source-map test-enforced | settling | new |
| `periodic-loop-two-mechanisms` | LV | surface rate | none | `scheduler.js` unchanged since 08-16 | not moving | new |

*Run at LV `6be148a8` / SD `0d54b97`. Next run: re-ground every row against HEAD, in landings. The rows that
carry the real question are `decision-reversal` (burst or rhythm?) and `project-velocity-trajectory` (does
amplitude settle?).*

## Plain-language read for the maintainer

**Nothing is spiralling, and the thing that worried the baseline, the proxy, has settled: it was split and
its churn moved into sub-routers as intended. But the project's rhythm has changed.** In June it was a
steady build-out with almost no rework. Now it moves in bursts, and in the latest one, in ten days, six
features were built and then taken out again, some within a day: share links, a feature switch for the brief
writer, the ticket-closed sweep, ifParked, "merged by you". The removals were clean and nothing broke, so
this is not thrash. It is decisions being made after the code lands rather than before. If it repeats it
will cost review and CI time (CI is up from 4.1 to 5.7 minutes in five weeks, with test code growing three
times faster than product code).

Convergent signs: rework is flat at about 8%; the one-path prompt system deleted a whole coupling rule; the
W41 sweep was the first real "retire N copies" wave; and simple-dispatcher has slowed from 35 landings a
week to 6 while finishing. The one place the three big route files are getting more tangled is
workspace-api / proxy / server.js, partly because cross-cutting programmes need all three and partly because
W41's consolidation sweeps touched them together.

Options you might weigh (nothing here is filed): decide before building for the big cross-cutting features
(a short hold before a W40-scale batch lands); slow the batch size if the six reversals read as a rhythm;
freeze or time-box the dispatch and proxy-dispatch hotspots until they settle; investigate why the OpenCode
runner is still growing while the rest of SD converges; and either close or explicitly park the roadmap,
next-run and collective tickets, since the backlog keeps pointing at code nobody touches. Your call.

**No follow-up tasks have been created.**

## Adversarial Second-Read

**Tier 2** (fresh-context sub-agent, no memory of the report-writing turn; given the report and both repos).
**Question:** "What is the largest item in this window that this report missed or misfiled?"

**Reader's answer (summarised faithfully):** The W39–W41 research and eval programme, filed as
`docs-index-churn` (severity none, "burst that collapsed"). Excluded paths took ~265k lines in 30 days
(`docs/papers` +126.9k, `scripts/eval` +66.7k, `docs/reviews` +71k), more than product src. Largest landings
#1748 (31.5k) and #1770 (27.7k). The report never links it to the F1 reversals. Smaller miss: SD's halt/auto-pause
build-out, 8 landings on 09-25/26 (LIN-3041–3046), not in F7. On the top finding: partly DISAGREE; F1's
episodes are real (confirmed `159b6822`, LIN-3325/3335/3426) but reversal is not the largest change. Numbers:
landings 403 vs 404 (window edge); tests/unit 286,764 vs 285,967 lines; `scripts/survey-*` 167 files / 19.6k
lines vs the report's 182 / 22k (deletions may explain; unverified); could not reproduce two LV `This reverts` bodies.

**Response:** F1b added; F5 corrected; F1 left as top *measured-trajectory* finding because it is the only
one that is a decision-quality signal, but the ranking is contestable and the maintainer should weigh F1b
alongside it. Survey-script figures stand as measured at mint and are marked unverified. SD halt/auto-pause
build-out noted here as an unranked miss.

Adversarial second-read verdict: DISAGREE
Differed from top finding: YES
Disposition: fixed in place
