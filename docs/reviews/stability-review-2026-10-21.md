# Stability Review — 2026-10-21 (second delta vs 2026-10-12; series origin 2026-06-25)

*Advisory, trend-aware, review-only. Periodical: **Stability Review**; review task: LIN-3743. Third run in the
series. Diffed against `stability-review-2026-10-12.md` (LIN-3547, LV `6be148a8` / SD `0d54b97`), with the
2026-06-25 baseline (LIN-673, LV `8de7da5`) as the origin. This report changes no code and **mints no follow-up
tasks**. It reads the project's *trajectory*: is the rate of change converging toward a settled state? The
decision is the maintainer's.*

**Examined:** LinearViewer (LV) `f25aa127` and simple-dispatcher (SD) `bb1da78`, both = `origin/main` at run
time (0 commits landed after the ticket was minted). **Span since last run: 9–10 days** (10-12 → 10-21), so this
is a short window. Two open questions are answered explicitly in the headline.

## Measurement decisions (read these before the numbers)

1. **Unit, buckets, windows and co-change are the 10-12 method** (first-parent landings via
   `git log --first-parent -m --numstat`; excluded paths `docs/reviews/**`, `_evidence-*`, `docs/papers/**`,
   `tests/screenshots/**`, `tests/fixtures/**`, `scripts/eval/**`, `package-lock.json`; tests and scripts
   bucketed separately; lift = P(A∩B)/(P(A)·P(B))). **Reproduction check:** the method reproduces W40 = 141,
   W41 = 104, the 810 → 890 `tests/unit` file counts, 175 → 188 `lin-*` tests, and `server.js`/`workspace-api.js`
   lift 2.47 prior-30 against 10-12's re-measured 2.4.
2. **Method delta 1 (stated): `experiments/` joins the research bucket.** It was born 10-16 (570 files, ≈521k
   lines) and the 10-12 filter does not name it, so left in "src" it would read as ≈533k lines in W42. It was
   empty before 10-16, so prior windows are unchanged.
3. **Windows.** *Baseline* 05-26..06-25 (322 landings; the end date is exclusive, committer date). *Prior-30* 09-12..10-12 (391).
   *Since-last-run* 10-12..HEAD (171 by date; **30 of them landed on 10-12 at or before `6be148a8`, the 10-12 report's own HEAD, so `6be148a8..HEAD` is 141**; every "since 10-12" figure here carries that ≈21% overlap and the rates use 9–10 days, not a re-cut). *Rolling-30* 09-21..HEAD (487). **Rolling-30 overlaps prior-30 by 21 days
   and overlaps the 10-12 report's own window**, so it cannot be read as an independent point. Weekly rows use ISO
   weeks by committer date; **W43 is ≈2.5 days and is partial.**
4. **"Src lines" = lines added in the src bucket**, unless a row says added+deleted. (The 10-12 report's
   "35.8k src lines/wk" is not exactly reproduced under either definition; this run's added-only 7-day blocks are 23.2k and 18.7k. Compare only within this report's own numbers.)
5. **Corrective classifier: the 10-12 method, applied as written (no method delta).** The 10-12 report's decision 4
   applies the broad classifier to "the PR title for merge landings, else the subject". The *landing form* differs
   by window: `Merge pull request … from <branch>` landings are 138/322 (43%) of the baseline, **287/391 (73%) of
   prior-30** and 1/171 since 10-12 (a further 25 prior-30 landings use `Merge PR #N: <title>`, which already
   carries the title). Every one of the 287 carries its PR title on body line 1
   (`git log -1 --format=%b <sha> | head -1`), so the classifier here reads that title, not the branch slug.
   Read on the raw subject instead, prior-30 would show 15 corrective landings rather than 21, a form artefact
   of 6 landings. See finding F8.
6. **SD** is measured in landings with the same method; SD has no stability baseline of its own before 10-12.
7. **Not re-run by this session (carried from the LIN-3743 research comment, marked "carried" where used):**
   open-ticket counts for the stagnation topics; the seed-42 sample labels; the 17-product-rebuild landing list
   (this run re-derived the list by title scan and got 23 matches since 10-01, of which 17 are product rebuilds
   LIN-3556..3706).

## Headline read

**The two questions the 10-12 run left open both have a provisional answer, and neither is a clean "settled".**

* **`decision-reversal`: burst, not (yet) rhythm, but the signal moved.** The file-lifetime query finds one
  short-lived pair since 10-12 (`lib/funnel-event-store.js` + test: born 10-03, deleted 10-18 by LIN-3500 (`cb470984`; LIN-3632 `dca50589` then dropped the collection and its references), 15 days,
  just outside the 14-day rule). No feature was reversed, flagged off or rolled back, and there are 0 true
  reverts. **But the file-deletion query is blind to the new form of reversal: rewrite-in-place.** In 6 days
  (10-15..10-20) 17 product modules were rebuilt "design-first", `lib/providers/jira/adf.js` was fully rewritten
  **three times in two days** (LIN-3556 +283/−485, LIN-3557 +529/−487, LIN-3565 +320/−325) and the dispatch
  entrance **three times on 10-17** (LIN-3592, 3604, 3611). Direction is still being changed after code lands; it
  now shows up as superseded rewrites, not deleted files. The window is 9 days and right-censored.
* **`project-velocity-trajectory` (LV): the volume amplitude is settling; the turnover is not.** Landings per
  ISO week: W40 141, W41 104, W42 98, W43 73 (partial: 10-19..10-21, ≈24/day against ≈14/day in W42). Src lines added per 7-day block: 23.2k (10-05..10-12) → 18.7k (10-12..10-19) → ≈20.0k/wk pace over 10-19..10-21. Net src growth is
  +5.5k in 9 days against +50k in the prior 30. **But lines *deleted* per week rose from 5.3k (prior-30) to
  15.2k, i.e. gross turnover (added + deleted) is ≈34k/wk against ≈22k/wk, with net ≈ 0.** The project stopped
  growing and started rewriting. Daily peaks: 10-19 = 45 (joint third-highest day; 08-23 = 52, 10-01 = 46).
  The mint lead that 10-19 was "the highest single day in the series" is **wrong**.
* **Where it is converging:** `proxy-churn-concentration`, `dispatch-entrance-churn` (`dispatch-store.js`
  14 → 1 touches/week), `prompt-cluster-coupling`, `file-growth-vs-rework`, SD (6/6/5/4 per week).
* **Where it is not:** CI wall time on main (5.3 → 6.9 min in 9 days), the research programme's data
  footprint (`experiments/`), the review layer's own rate, `runner-kit` (4/3/4/7 touches per week) and
  `kpi-stats.js` (3 → 11 touches in W43).

## Findings (severity-ranked, each a delta vs 2026-10-12)

### F1 — `rebuild-wave` (NEW) · Severity: Medium · trajectory unknown (one burst)

* 23 landings since 10-01 match a rebuild/design-first/clean-room/Theseus/experiment title scan. **17 are product
  rebuilds in 6 days (10-15..10-20)**: Jira ADF codec (LIN-3556/3557/3565), roadmap renderer (3566), Agent API
  read and write routes (3569/3573), `pipeline-loops.js` (3578), page-renderer cluster (3579), dispatch factory
  (3580), task-page loader (3590), dispatch entrance (3592 → 3604 → 3611), KPI collector (3591), workspace-API
  router (3596), `/kpis` page (3703), free-tier allowance (3706). The papers programme (Theseus, rebuild ladder,
  rebuild round, "consolidate, then rebuild") landed the same days.
* **Experiment arms landed on main.** `jira/adf.js`: three whole-file rewrites in two days (see headline).
  `lib/dispatch-entrance.js` was *created* at +1642 lines in LIN-3604 and then rewritten +1130/−1038 in LIN-3611
  the same day.
* **It is convergent in effect.** The hubs shrank: `routes/workspace-api.js` 4,673 → 3,782,
  `routes/proxy-dispatch.js` 1,911 → 750, `routes/dispatch.js` 2,041 → 1,462 (current `wc -l`). Rebuilt files show
  little later repair; the exceptions are `kpi-stats.js` and `task-page-loader.js` (F7).
* **Causal question (does research drive product change?): yes, in this window, directly.** The rebuild landings
  carry the papers' ticket chain and the papers pin product files as replay inputs. **Whether the research fed the
  10-02..10-12 reversals cannot be settled from history:** the reversal landings carry no reference to the papers.
* Why Medium: it is rewrite-shaped (gross turnover ≈ 1.5× the prior pace, net ≈ 0), lands experiment arms on
  main, and costs review and CI time. It is not instability: post-rebuild repair is low.

### F2 — `research-eval-programme` · Severity: Medium · **worsened (volume), and the mint reading was wrong**

* The mint lead read "collapsing" from `docs/papers` + `scripts/eval` alone (+29.3k lines since 10-12, against
  ≈195k added in prior-30). That is true of those two paths and misleading: **`experiments/` added +514k lines
  in 8 landings** (all in the 10-12..10-19 week), mostly JSON replay and report artefacts.
* Research landings (paths under `docs/papers`, `scripts/eval`, `experiments`) fell from 25.4/wk to 8.4/wk: fewer,
  far larger, data-heavy.
* The 10-12 second-read's point stands and is now sharper: the largest line-count movement in the repo is
  outside the measured buckets. `experiments/` is a new top-level directory; it needs an owner decision on whether
  it belongs in the product repo (that is a maintainer call, not made here).

### F3 — `test-suite-accretion` / CI · Severity: Low–Medium · **worsened (CI not converging)**

* **CI median wall time on main** (`gh run list --workflow test.yml`, successful runs, `updatedAt − startedAt`):
  10-11 5.3, 10-12 5.5, 10-16 5.8, 10-17 5.5, 10-18 6.5, 10-19 6.7, **10-20 6.9 min**; the 10-12 report had
  W38 4.1 → W42 5.7. Raw data: `_evidence-2026-10-20/stability-ci-main-runs-2026-10-21.json`.
  **The rise is a step on 10-18, not a drift, and the MongoDB incident (F14) did not cause it.** Splitting the
  successful runs (1 non-success in 300) at the incident boundaries: before 10-18 median **5.27** min (n = 193);
  10-18 up to the incident start (10-19 18:15Z) **6.52** (n = 68); inside the incident window (to 20:05Z, #1990)
  n = **2**; after the fix **6.94** (n = 36). The step predates the incident and persisted after it. Incident
  failures took about 12 s and are not successes, so they never enter these medians. Load does not explain it
  either: 10-11 and 10-12 had 34 and 29 runs at 5.3 and 5.5 min. **Cause not identified** (suite growth against a
  runner-image change); the evidence cannot separate those two.
* `tests/unit`: 810 → 890 files, 286,764 → 308,964 lines (**+7.7%**) while src JS grew +1.8% (≈180.0k → 183.2k
  by the 10-12 report's src count; this run's `*.js/*.mjs` outside tests/docs/experiments counts 219k at HEAD, a
  different file set, so the two src figures are not mixed).
* `lin-*` births slowed (175 → 188, 13 in 9 days against 92 in Oct 1–12), so ticket-named test accretion is
  decaying while the *total* keeps growing. Structure belongs to Code Quality (tests edition).

### F4 — `review-layer-rate` (NEW) · Severity: Low–Medium · rising

* Landings touching `docs/reviews/**`: 3.5/wk (prior-30) → **7.0/wk**. Governance-shaped landings (periodical
  reports, area-map moves, census/seams/code-shape kits, found by title + path): 4.9/wk (5%) → **15.4/wk (13%)**
  (baseline 7.7/wk, 9%). `docs/reviews` lines added: 16.3k/wk → 31.1k/wk.
* **Title-scan check (close-out).** The governance title scan was re-run reading merge landings by their body-line-1
  PR title instead of the subject (73% of prior-30 subjects are branch slugs). The prior-30 count moves by +2 of 391
  landings (a reconstructed scan reads 20 → 22, about 4.7 → 5.1/wk, against the 4.9/wk above); the since-10-12 count is
  unchanged. The rise is roughly threefold under either reading, so the delta stays **new / rising**.
* Five "area map" landings in two days (LIN-3708/3716/3720/3729/3730) followed the 10-20 Seams & Tangles run.
  Drift & Coherence has had editions on 10-11, post-batch, 10-12, 10-18 and 10-19.
* Reading: the governance layer is adding churn of its own and is not yet settling. Not a defect; a rate to watch.

### F5 — `project-velocity-trajectory` (LV and SD) · Severity: Low–Medium (LV) / none (SD)

* **LV:** see headline. Landings 141 / 104 / 98 / 73-in-2.5-days. Src files per landing 4.78 (prior-30) → 3.57.
  Gross turnover up, net growth down (+5.5k vs +50k). Delta vs 10-12: *amplitude partly settling, character changed
  from build-out to rewrite.* I rate this **unchanged-to-improved on volume, worsened on churn composition.**
* **SD:** 6 / 6 / 5 / 4 landings per week W40..W43 (9 since 10-12, 1 corrective by the broad classifier). Converging,
  confirmed. The 7 landings of 10-16..10-19 are the runner-contract re-pin (F9).

### F6 — `server-js-growth` (S2) · Severity: Low · slightly worse

* `server.js` 4,582 → 4,657 lines. It is still the most-touched src file: 22 landings since 10-12 (12.9% of
  landings, against 64/391 = 16.4% in prior-30), but **W43 alone has 14 touches in 73 landings (19%)**, up from 8/98
  in W42. `scheduler.register` calls in `server.js`: 14 matches at HEAD; the bare hourly `setInterval` is now at
  `server.js:4599` (`cleanupTimer`). Delta: share down, absolute W43 pace up. Structure is Code Quality's.

### F7 — Young-surface hotspots (NEW rows) · Severity: Low · judge: expected, watch two

Touches since 10-12 (landings), lines at HEAD:

| file | touches | lines | judgement |
|---|---|---|---|
| `lib/kpi-stats.js` | 14 (3/3/2/3/**11** by week W39..W43) | 1,372 | a feature burst *after* its rebuild (KPI daily rollup, trend charts, rate/total toggle, cost per task). Young-surface churn; watch W44. |
| `lib/task-page-loader.js` + `lib/render-task-page.js` | 11 + 8 | — | rebuilt 10-17 then touched again; not characterised further in this run. Should be settling. |
| `lib/runner-kit/runner.mjs` | 11 (4/3/4/**7**) | 1,382 | **rising**, see F9. |
| `lib/render-legal.js` | 7 | — | Terms/Privacy truth pass (LIN-3414/3390/3637/3423). Expected, one-off. |
| `lib/account-erasure.js` | new (LIN-3423) | — | new; not judged. |

### F8 — `corrective-vs-additive-ratio` · Severity: Low · **classifier has low recall, not a trend**

* Broad title classifier (10-12 method, run on PR titles: body line 1 for `Merge pull request` landings, decision 5):
  baseline **11.2%** (36/322), prior-30 **5.4%** (21/391), since **4.1%** (7/171). Re-run and reproduced at close-out.
* **The classifier cannot carry the trend, because of its recall.** Agent-written titles now state behaviour ("must
  not", "no longer", "instead of", "refuse …") instead of saying "fix". Precision since 10-12 is 6 of 7, but a
  hand-label of all 171 titles finds about 34 fault-correction landings (≈20%), so the classifier catches roughly a
  fifth of them. The fall from 11.2% to 4.1% is mostly title style, the same kind of artefact the 10-12 report found
  in the baseline's "0.4%". The mint lead "≈4% against ≈8.5% before" reads that fall as a trend.
* **Hand-labelled series (carried from the LIN-3743 research comment, not re-run here):** seed-42 samples of n = 60 per
  window under one rubric give baseline **≈17%**, prior-30 **≈18%**, since 10-12 **≈20%**: roughly flat. This is the
  comparable measure, and it is a sample.
* **Hand-labelled census of all 171 since-10-12 landings: 52 C = 30.4%** (`_evidence-2026-10-20/stability-hand-labels-2026-10-21.md`).
  This run's rule is **liberal** (it counts security gap-closes and runner/SD agreement fixes) and differs from the
  seed-42 rubric, so 30.4% is **not** comparable with the ≈17–20% series above. Single labeller, one pass. The ten-point
  gap between the two passes on the same window is the uncertainty on the corrective share. Read by behaviour, the
  share is of the order 20–30% in this window, not 4%.
* **SD:** 9 landings, 1 broad-corrective (11%), prior-30 4/34 (11.8%). Unchanged (SD is squash-only in the window, so
  its subjects are already titles).

### F9 — `runner-kit-convergence` (LV, NEW) and `lv-sd-contract-coupling` (NEW) · Severity: Low · watch

* `lib/runner-kit/runner.mjs`: 4 / 3 / 4 / 7 touches per week W40..W43 and mostly fault-shaped titles (LIN-3669 watchdog
  must not post `[failed]` for a finished run; 3675 recover/stop-halt consult settlement; 3667 `network` vs
  `credential`; 3622 poll/take serve session targets only). This is SD's "finishing" shape relocated: SD's
  `opencode-runner.js` has had **0 landings since 10-09/10-10** (last `da18738`, 10-10), so the work did not
  settle there and then stop; it moved to the LV kit. `runCommand` complexity belongs to Code Quality.
* **LV↔SD contract coupling:** 4 paired landings in 2 days (LV #1923 LIN-3451, #1930 LIN-1952, #1941 LIN-3630,
  #1969 LIN-3670 ↔ SD #273, #274, #275, #277, 10-18..10-19), on a contract table born 10-18; quiet since 10-19 (SD #278,
  #279 are SD-only). SD #274 carried "do not merge before Harbour #1930". The seam moves in lockstep by design
  at birth. Not enough points to call a rhythm.

### F10 — `route-boundary-coupling` (S3) · Severity: Low · mixed, n small

* Sizes: `workspace-api.js` 4,673 → 3,782, `proxy-dispatch.js` 1,911 → 750, `server.js` 4,582 → 4,657.
  `server.js` 22 touches, `workspace-api.js` 12 (A: 4 / 20 / 8 / 4 per week W40..43).
* Lifts (this run's count, prior-30 → since): `workspace-api`↔`server` **2.47 → 3.24** (n = 5 co-touches);
  `workspace-api`↔`proxy.js` 3.77 → 4.75 (n = 2); `proxy.js`↔`server` 2.62 → 3.89 (n = 3). **This run did not reproduce
  the 10-12 report's `workspace-api`↔`proxy` pair (2.6)** and the research comment reports a *fall* to 1.24 for
  it; the pair definitions differ. At n ≤ 5 none of these lifts is a judgement. The W41 sweep reads as convergent
  (hub files shrank), and the 10-17 rebuilds were cross-cutting programmes, kept separate from consolidation
  sweeps as 10-12 asked. Delta: **unchanged / not judgeable**.
* `lib/dispatch-entrance.js` (1,812 lines) is the emerging front door Seams & Tangles 10-20 names. Its 7 touches
  are 5 in W42 and 2 in W43: settling.

### F11 — `dispatch-entrance-churn` · IMPROVED · Severity: none

`routes/dispatch.js` 13 / 15 (W40/W41) → 5 / 5 (W42/W43 partial); `lib/dispatch-store.js` 11 / 14 → 1 / 1;
3,050 lines. The W40–W41 spike was the cost of the entrance consolidation; it has settled.

### F12 — `stagnation` · unchanged · Severity: Low

Re-run of the 10-12 query (src files with ≥ 4 landings in 04-01..06-25, present at HEAD, silent since 08-12):
**10 of 91** (10-12: 14 of 84). Members: `lib/harbour-spawn.js`, `lib/providers/registry.js`, `lib/render-custom-prompts.js`,
`lib/render-next-run.js`, `public/collective.js`, `public/custom-prompts.css`, `public/next-run.css`,
`public/next-run.js`, `public/prompts.css`, `public/roadmap.css`. Last touches 06-14..08-06; no landing touched
them in the window, and the five "recommend/roadmap/next-run/collective/harbour-spawn" areas were not closed or
parked by this review's evidence. Open-ticket counts (22/17/21/8/6) are carried from the research comment, not re-run.

### F13 — `true-reverts`, `file-growth-vs-rework`, `proxy-churn-concentration`, `prompt-cluster-coupling`

* `true-reverts`: **0** since 10-12 in LV and SD · improved. `file-growth-vs-rework`: delete/add src ratio 0.80
  (15.2k/19.1k per week) against 0.31 prior-30 · improved on consolidation, but see F1.
* `proxy-churn-concentration`: `proxy.js` 6 touches since 10-12 (42 in prior-30) · settled.
* `prompt-cluster-coupling`: no re-run beyond the research comment's 20 → 3 · settling (carried).

### F14 — CI incident, MongoDB 8.0 on kernel 6.19+ (NEW, found by the second-read) · Severity: Low–Medium · closed, latent

From 10-19 18:15Z the `mongo:8.0` service container refused to start on new-kernel runners, failing "Unit tests" in about
12 s and blocking `ci-success` on every PR until #1990 (10-19 20:05Z, pin `mongo:8.0.32` + `glibc.pthread.rseq=1`).
Record: `docs/incidents/2026-10-19-mongodb-kernel-ci.md` (#2021). Rate-altitude relevance: it does not explain the F3 CI rise
(the step predates it, see F3), and it is a reminder that CI-environment change is a source of churn independent of code. Production is unaffected on host
kernel 6.12.22; the latent risk (a host kernel moving into the range) is tracked under LIN-3698. Not otherwise judged here.
A related smaller change, `package.json` moving `node --test` to `scripts/run-unit-tests.mjs`, was not examined.

### Not moving / bookkeeping

`periodic-loop-two-mechanisms` (`scheduler.js` untouched; hourly `setInterval` unchanged) · NaN `toMs` in
`lib/ci-wake-sweep.js:226` (sort comparators at 253 and 298) and the heartbeat TTL rule: neither moved since 10-19 ·
SD read-only cache rule: not moved · `docs-index-churn`: `docs/architecture/source-map.md` 26 touches since 10-12 (48
in prior-30), test-enforced bookkeeping · **SD halt/auto-pause build-out (LIN-3041..3046, 09-25..09-26):** the
10-12 unranked gap is closed; no SD halt files moved in the window.

## Class completeness (bounds and members)

* **Rebuild-wave landings:** 23 title-scan matches since 10-01; 17 product rebuilds · **Trend rows:** the 19
  stable names plus `rebuild-wave`, `review-layer-rate`, `runner-kit-convergence`, `lv-sd-contract-coupling`, and
  the F7 hotspot rows · **Hub surfaces:** top-14 src files by landing count per window · **Top-level
  directories:** only `experiments/` is new · **Reversal episodes:** 1 near-miss (`funnel-event-store`, 15 days);
  3 rewrite-in-place triples (adf.js, dispatch-entrance ×2 surfaces) · **LV↔SD pairs:** 4 ·
  **Unbounded:** ticket-label classification, CI time before 10-02 (older runs were not pulled), and corrective
  share by behaviour for prior windows (only the carried seed-42 samples exist, not a census).

## Trend Ledger

Severity: none / low / low–med / med / high. Delta vs 2026-10-12: new / unchanged / improved / worsened / resolved.

| Signal (stable name) | Repo | Class | Severity | Reading | Trajectory | Delta vs 2026-10-12 |
|---|---|---|---|---|---|---|
| `decision-reversal` | LV (+SD) | rework / direction | low–med | 1 near-miss file (15 d); 0 true reverts; 3 rewrite-in-place triples in 6 days | burst did not repeat as deletions; shifted to rewrites; 9-day window | **improved (files), caveated** |
| `project-velocity-trajectory` | LV | overall shape | low–med | 141/104/98/73* landings; src added 23.2k→18.7k→≈20k/wk (7-day blocks); gross turnover ≈34k/wk, net ≈0 | amplitude settling, composition rewrite-shaped | **unchanged / mixed** |
| `project-velocity-trajectory` | SD | overall shape | none | 6/6/5/4 landings/wk | converging | unchanged (improving) |
| `route-boundary-coupling` (S3) | LV | change-coupling | low | W↔S 2.47→3.24 (n=5); hubs shrank | not judgeable at n≤5 | **unchanged** |
| `test-suite-accretion` | LV | growth shape | low–med | tests +7.7% vs src +1.8%; CI median 5.3→6.9 min in 9 d, a step on 10-18 (5.27→6.52, before the incident; 6.94 after); cause not identified | not converging | **worsened** |
| `research-eval-programme` | LV | excluded-path churn | **med** | `experiments/` +514k lines; papers+eval +29k; 8.4 research landings/wk | relocated and grew | **worsened (mint "collapsing" corrected)** |
| `true-reverts` | LV + SD | rework | none | 0 since 10-12 | clean | **improved** |
| `server-js-growth` (S2) | LV | surface rate | low | 12.9% of landings (16.4%); W43 14/73; 4,657 lines | share down, W43 pace up | **unchanged (slightly worse)** |
| `opencode-runner-convergence` | SD | surface rate | low | 1,886 lines; 0 landings since 10-10; `reapers.js` 3,895 (2 landings) | quiet; work moved to LV kit | **unchanged (moved)** |
| `dispatch-entrance-churn` | LV | surface rate | none | `dispatch.js` 13/15→5/5; `dispatch-store.js` 11/14→1/1 | settled | **improved** |
| `stagnation` | LV | silence | low | 10 of 91 silent (14 of 84) | parked-by-tier | unchanged |
| `proxy-churn-concentration` (S1) | LV | surface rate | none | `proxy.js` 6 touches since 10-12 (42) | settled | **improved** |
| `prompt-parity-coupling` (S4) | LV | change-coupling | none | resolved 10-12 | n/a | resolved (unchanged) |
| `prompt-cluster-coupling` | LV | change-coupling | none | 20→3 landings (carried) | settling | improved |
| `file-growth-vs-rework` | LV | growth shape | low | delete/add 0.80 vs 0.31; net +5.5k in 9 d | consolidation by in-place rewrite | **improved** |
| `corrective-vs-additive-ratio` | LV | rework | low | classifier 11.2→5.4→4.1% on PR titles, recall ≈20% so not a trend; hand-labelled ≈17–20% (sample) / 30% (census, liberal rule) | flat by hand-label | **unchanged** |
| `corrective-vs-additive-ratio` | SD | rework | none | 1/9 since; 4/34 prior-30 | finishing | unchanged |
| `docs-index-churn` | LV | bookkeeping | none | `source-map.md` 26 touches (48 prior-30) | settling | unchanged |
| `periodic-loop-two-mechanisms` | LV | surface rate | none | `setInterval` at `server.js:4599`; scheduler untouched | not moving | unchanged |
| `rebuild-wave` | LV | rework / direction | **med** | 17 product rebuilds in 6 days; adf.js ×3, dispatch-entrance ×3 | one burst, trajectory unknown | **new** |
| `review-layer-rate` | LV | governance churn | low–med | 4.9→15.4 gov landings/wk; reviews lines 16k→31k/wk | rising | **new** |
| `runner-kit-convergence` | LV | surface rate | low | `runner.mjs` 4/3/4/7 touches/wk, fault-shaped | rising | **new** |
| `lv-sd-contract-coupling` | LV+SD | change-coupling | low | 4 paired landings in 2 d, quiet since 10-19 | watch | **new** |
| `young-surface-hotspots` (`kpi-stats`, task-page) | LV | surface rate | low | `kpi-stats.js` 3→11 touches in W43 | feature burst | **new** |

\* W43 is ≈2.5 days. *Run at LV `f25aa127` / SD `bb1da78`. Next run: re-ground every row against HEAD; the
questions that carry are (1) does gross src turnover fall back toward the added-line rate, and (2) does CI wall time
stop rising, and what caused the 10-18 step (suite growth or a runner-image change).*

## Plain-language read for the maintainer

**Nothing is spiralling, and the burst of deleted features did not come back. But the project has stopped
growing and started rewriting, and a few of its costs are still going up.** Last time the worry was features built
and then taken out. In this window no feature was withdrawn. Instead, in six days, 17 product modules were rebuilt
from a design, some of them two and three times over (the Jira codec three times in two days, the dispatch
entrance three times in one day). The hubs got smaller, post-rebuild repair is low, and net code growth fell from
+50k lines to +5.5k. That is convergence in effect. It is also a lot of rewriting, and it was driven directly by the
research programme, which has moved its bulk into a new `experiments/` folder (+514k lines in a week).

Converging: the dispatch store and entrance, the proxy files, true reverts, SD (6 → 4 landings a week), and the
prompt cluster. Not converging: CI time on main (5.3 → 6.9 minutes in nine days, a step on 10-18 that the CI incident did not cause), the
amount of governance work (reviews and area maps are 13% of landings, up from 5%), the LV runner kit, and the KPI
code after its rebuild. The corrective share of work cannot be trended from git titles any more, because the titles
no longer say "fix"; read by behaviour it is roughly a fifth to a third of landings, not 4%, and a hand-labelled
sample puts it flat at about 17–20% across the three windows.

Options you might weigh (nothing is filed): decide whether `experiments/` belongs in the product repo at all;
time-box the rebuild programme to a target list and let the rebuilt areas settle before the next wave; slow the
governance cadence (one edition per review type per week) while the area map settles; put a CI wall-time budget
on main, or check whether the rise is load; and either close or explicitly park the
roadmap, next-run, collective and harbour-spawn areas. Your call.

**No follow-up tasks have been created.**

## Adversarial Second-Read

**Tier 2** (fresh-context sub-agent, no memory of the report-writing turn; given the report and both repos).
**Question:** "What is the largest item in this window that this report missed or misfiled?"

**Reader's answer, verbatim** (retrieved at close-out from the sub-agent's transcript; the reader worked from an earlier
draft of this report and a clone without the `_evidence-*` files):

> **(1) Largest item missed or misfiled: the 10-19..10-20 MongoDB 8.0 / Linux kernel 6.19+ CI incident, and F3 misfiles it as runner load.**
> - The incident is documented in `docs/incidents/2026-10-19-mongodb-kernel-ci.md`, landed as 6d3b5cfd (#2021, 10-20).
> - Evidence: from 10-19 18:12Z, `mongo:8.0` refused to start on new-kernel runners, failing unit tests in about 12s and blocking every Harbour PR. This is the "CI wall time" window the report charts.
> - Mitigation was #1990, merged 10-19 ~20:05Z. It pinned `mongo:8.0.32` plus `GLIBC_TUNABLES=glibc.pthread.rseq=1`, and changed `.github/workflows/test.yml` (+12 lines).
> - It carries a latent production risk: Railway production runs 8.0.32 and would refuse to start if its host kernel moved into the affected range. That risk is tracked as LIN-3698, with an operator production probe (LIN-3697) and a bounty-thread answer.
> - The report never mentions it. F3 blames "runner contention" for the run counts of 35/43/28 on 10-18/19/20 (and for the 6.7 and 6.9 min medians on 10-19 and 10-20). Re-runs and failed runs from the incident are a likelier cause, so the "load vs suite size" ambiguity is partly explained by something in git.
> - It is also the only P1/production-risk item in the window. The report's "Not moving" list and Class completeness table don't list it either.
> - A smaller miss in the same area: `package.json` swapped `node --test` for `scripts/run-unit-tests.mjs`, a CI runner change, which also goes unmentioned.
> - This is not a larger line-count item than `experiments/`. By operational significance, though, it is the biggest thing the report omits.
>
> **(2) Top finding: partly agree.**
> - The data supports F1 and F2 as the dominant movements. `experiments/` adds 513,993 lines across 570 files since 6be148a8. The top src landings are all "rebuild design-first": 603853c5 (4,973 lines), 1f8010a0 (4,941), 47d87055 (3,909), then 2e8cba6e, d2d7d818 and others.
> - Ranking F1 above F2 is a judgement call. F2 is the larger raw-volume movement and F1 is the larger behavioural shift, so the order is defensible.
> - I would add the CI incident as a Medium-severity finding of its own, because it is the only item with production exposure.
>
> **(3) Number spot-checks.**
> - Correct: weekly landings W40 141, W41 104, W42 98, W43 73. Total since 10-12 is 171 by `--since`.
> - Correct: `tests/unit` 810 → 890 files, 286,764 → 308,964 lines.
> - Correct: `experiments/` is 570 files and +513,993 lines (reported as +514k).
> - Correct: `funnel-event-store.js` was added 10-03 (df9b1aae) and deleted 10-18, so 15 days.
> - Wrong: "deleted 10-18 by LIN-3632". The deleting commit is cb470984, which is LIN-3500 (#1929). LIN-3632 (dca50589, #1989, 10-19) dropped the retired collection and its references. This also means the "1 near-miss, 15 days" attribution points at the wrong ticket.
> - Wrong or misleading: "Since-last-run 10-12..HEAD (171)". The 10-12 report's own HEAD was 6be148a8 at 10-12 16:10. `6be148a8..HEAD` is 141 first-parent landings, and the other 30 are the same-day 10-12 landings the prior run already counted. Every "since 10-12" figure has a window about 21% too big. Examples: the 52/171 = 30.4% hand-label denominator and 9-day rates.
> - Slightly off: `server.js` has 22 landings by date but 21 over `6be148a8..HEAD`. This is the same boundary overlap.
> - Not checkable: the evidence files `_evidence-2026-10-20/*` (CI json, hand-label sheet) are not in this clone, so the 52/171 labels and CI medians could not be verified.
> - Not checked: lines-deleted figures, lift values and the 17-rebuild list.

**Response (verified against git before accepting):** two of the reader's three points were confirmed and one part was
tested and **not** confirmed.

* **Confirmed:** the `funnel-event-store` deletion is `cb470984` (LIN-3500), corrected in the headline; the
  "since 10-12 = 171" count overlaps the 10-12 report's HEAD (`6be148a8..HEAD` = 141), disclosed in decision 3; the
  incident exists and is recorded as F14. The 52/171 hand-label census therefore includes 30 landings from before the
  10-12 report's HEAD.
* **Not confirmed:** the reader's claim that the incident's failed and re-run jobs are the likelier cause of the rising CI
  medians. Tested at close-out on the successful-run series (F3): median 5.27 min before 10-18 (n = 193), **6.52** from
  10-18 to the incident start (n = 68), n = 2 inside the incident, **6.94** after #1990 (n = 36). The step predates the
  incident and persisted after the fix, and incident failures (about 12 s, not successes) never enter the medians. The
  incident is a real finding (F14) but does not explain the F3 rise.
* F1 stays the top finding on behaviour, with F2 and F14 recorded as the reader's challenges.

Adversarial second-read verdict: DISAGREE
Differed from top finding: YES
Disposition: fixed in place
