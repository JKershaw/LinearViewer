# Stability Review — 2026-11-08 (run 5, delta vs 2026-11-04)

*Advisory, trend-aware, review-only. Periodical: **Stability Review**; review task: LIN-4394 (run 5). Diffed against
`stability-review-2026-11-04.md` (LIN-4206, run 4), with `2026-10-21`, `2026-10-12` and the `2026-06-25` baseline as history.
This report changes no code, config or docs beyond itself and its evidence, and **mints no follow-up tasks**. It reads the
project's trajectory: is the rate of change converging toward a settled state, or failing to settle? The decision is the
maintainer's.*

**Examined.** LinearViewer (LV) `5334c81a..9574d537`: the **delta window**, run 4's pin to this run's pin, **114 first-parent
landings** over ≈4.45 days (2026-11-04 05:24Z to 2026-11-08 16:08Z). Rolling window `f25aa127..9574d537`: **357 landings** over
≈18.7 days, overlapping run 4. simple-dispatcher (SD) `67ff5c3b..5d8489e7`: **20 landings** (delta); `bb1da78..5d8489e7`: 55 (rolling).
Every table names its window. Evidence and regeneration commands: `docs/reviews/_evidence-2026-11-08-stability/README.md`.

## Measurement decisions (read these before the numbers)

1. **Pins.** LV `9574d537` and SD `5d8489e7` are the `origin/main` heads when measured, and match the research pins. The
   mint-time count of 112 LV landings is superseded by 114. The delta is run 4's pin to this pin. The rolling window is
   `f25aa127..pin`, so the trajectory stays comparable with run 4 on a window that overlaps it. Neither window is trusted alone at n≈114.
2. **Method: run 4's, unchanged** (first-parent `--numstat --no-renames`, run 4's excluded paths, ISO weeks, bucket rules), with
   two additions. (a) Generated output under `experiments/**/replay/work/` is its own bucket (method 12, extended). (b) SD's test
   share is read by top-level directory: `test/` against `lib|routes|public` and top-level `.js`.
   (c) `docs/papers/` and the `tests/fixtures/cost-replay` golden are reported as separate evidence trees, since run 4's
   exclusions hide them. Added after the second read.
3. **Reproduction of run 4 (passed for most rows, with three exceptions).** Reproduced: 243 LV landings `f25aa127..5334c81a`;
   35 SD landings `bb1da78..67ff5c3b`; **38 rewrite events** (28 whole-file, 10 in place, 0 repeats); closed-window CI medians
   5.22 / 6.59 / 7.07 / 7.87; static test call sites 1,194 → 1,624; SD test share 83% (12,634 test against 2,527 src `.js` lines);
   runtime tests 19,596 on 10-23; the 10 silent stagnation files at `f25aa127`; the 3 silent files at HEAD. **Not reproduced:**
   - **Stagnation denominator.** Measured here: 110 candidates, 95 present at `f25aa127`. Published: 106 and 91. The silent
     set matches. Unresolved; this run reports 10 of **95**. The timezone and first-parent-history explanations were not
     confirmed, so the difference is disclosed rather than explained.
   - **Unit test files.** 1,149 at `5334c81a` (published 1,163); 882 at `f25aa127` (published 890). The counting rule was not
     recovered. Growth in this run is measured on one rule at both ends (+6.8%, delta).
   - **CI medians for windows open at run 4** (11-02..04, 10-21..11-04) move because main runs after run 4's pin are now in the
     series: 8.32 (published 8.23) and 7.22 (published 7.17). This is a sample-set difference, not a method change.
4. **Right-censoring and small n.** The delta is 4.45 days. Its last day is partial (pin at 16:08Z). Landings per day, 11-04
   through 11-08: **13 / 42 / 21 / 11 / 27**. No slowdown is claimed from 114 landings; each row is read against the rolling window.
5. **CI runtime test counts.** `measure_ci_logs.py` sampled 70 successful main runs (two per day from 10-01). 29 carry an
   `ℹ tests` line, all from 10-23 on. Per-test time is read by the runner's `Region:`. From 11-05 the sample includes regions
   not seen earlier in the series (`us-west-2`, `westcentralus`, `westus`), so **per-region medians are not a clean control after 11-05.**
6. **Tracker signals are limited.** The proxy's issue list carries no timestamps, so task age and cycle time are **not
   measured**. The one tracker signal used is ID minting, read from two tickets' mint times as a proxy, not a rate.
7. **Not available, disclosed:** runner assignment; the actor behind review-ticket minting; production dispatch and session
   counts; corrective share by behaviour.

## Headline read

**Not converging yet. The rate of change went up in this window, and the trajectory that tracks it most directly (CI wall
time, driven by suite growth) is still climbing.** Nothing here is spiralling in the sense of a feature built and then
reversed at scale, and rewriting has eased. But the project is growing faster than it was in run 4.

- **Rate.** Delta: **25.6 landings/day** (114 / 4.45), against run 4's 17.1/day. Rolling: 19.1/day. Net source growth in the
  delta is **+1.56k lines/day** (run 4: +1.09k/day). Delete/add on `src` fell to **0.35** (run 4: 0.63). The project is
  growing faster and rewriting less.
- **CI.** Medians by closed window: 5.22 → 6.59 → 7.07 → 7.87 → 8.32 (11-02..04) → **8.55 (11-05..08, n=101)**. The 11-06/07
  dip (daily medians 7.40 and 6.48) is the first since 11-01, but it coincides with a fast runner pool (centralus, 6.3 ms per
  test), and runtime test counts rose through it. Reading: a pool effect, not a convergence signal.
- **Suite.** Runtime tests **19,596 (10-23) → 22,757 (11-04) → 24,772 (11-08)**: +8.9% in the four days from 11-04.
  Static test call sites grew less in the delta (1,624 → 1,662, +2.3%). The two counts diverge and their cause was not found.
- **Evidence weight.** `docs/reviews` grew from **27.5 MB (`f25aa127`) to 55.2 MB (`5334c81a`) to 84.4 MB (pin)**. In the
  delta that is **6.5 MB/day**, against 1.95 MB/day in run 4's window. It is now **38%** of repository blob bytes. Adding
  `docs/papers` (18.8 → 36.9 MB in the delta), the two evidence trees hold **55%** of repository blob bytes and took **93%** of the
  delta's blob growth (47.2 of 51.0 MB).
- **Prompt contract.** **28%** of delta landings touch the prompt-contract path set (run 4: 13%; run 3's window: 8.5%).
  `tests/unit/prompt-size-budget.test.js`, the ceiling, was edited in **19 of 114** delta landings.
- **Home / task page.** Its intensity fell. **14 landings** (12% of the delta) touched the cluster: **3.1/day**, against 6.0/day
  in run 4's burst and 3.4/day in its tail. `public/prompt-section.js` grew +3.5% in the delta (run 4: +94% across its window).
  Settling in size; settling in touches is not yet shown.
- **SD.** 20 landings: 13 on 11-04, 7 on 11-08, **none on 11-05, 11-06 or 11-07.** Verified: no PR was created on those three
  days, and the last merge before the gap is 11-04 23:46Z. The gap is absent supply, not a measured slowdown. **98%** of the
  SD added src+test lines are tests (run 4: 83%). This is hardening, not a rebuild.

**Converging, by the same measures:** rewrite-in-place (3 events in the delta, 0.67/day, against 2.7/day in run 4; 0 repeats);
the server landing share (6%, against 20%); `lib/runner-kit/runner.mjs` (1 touch); the `opencode-runner.js` size in SD (1,966 → 1,836).
**Not converging:** CI wall time (the clearest); suite growth; the evidence weight of `docs/reviews`; prompt-contract churn;
the LV landing rate; `lib/dispatch-store.js` (touch rate 1.13 → 2.46 per day); and `routes/proxy.js` (0.92 → 1.57 per day).

## Findings (severity-ranked; each a delta against 2026-11-04)

Ranking reason, stated once: **F1 ranks first** because it is the only signal monotonic across every closed CI window and its
driver is still rising. **F2** ranks second because the prompt-contract rate has jumped to a level this series has not seen
before. **F3** ranks third because its weight is large and standing, but its driver is governance output, not product churn.

### F1 — `test-suite-accretion` (CI on main) · Severity: Medium · **worsened (monotonic; driver still rising)**

| window (started-at dates) | successful runs | median wall time (min) |
|---|---|---|
| Sep (partial; list starts 09-04) | 293 | 4.83 |
| 10-01..10-17 | 249 | 5.22 |
| 10-18..10-20 | 106 | 6.59 |
| 10-21..10-25 | 131 | 7.07 |
| 10-26..11-01 | 63 | 7.87 |
| 11-02..11-04 | 54 | 8.32 |
| **11-05..11-08 (partial day)** | **101** | **8.55** |

* **Failures.** 3 in the 1,000-run list, the last on 10-25 18:15Z. None since. (Run 4 counted 6 back to 08-24; the list now starts 09-04, so the counts are not comparable.)
* **Driver: runtime test count.** 19,596 (10-23) → 22,757 (11-04) → 24,772 (11-08). In the 29 sampled logs, wall time tracks the
  runtime count within a runner pool.
* **Per-test time by region** (first arm, `measure_ci_logs.py`):

  | region | logs | median ms per test |
  |---|---|---|
  | centralus | 7 | **6.28** |
  | westus3 | 6 | 8.04 |
  | westcentralus | 2 | 9.28 |
  | eastus | 9 | 10.02 |
  | westus | 2 | 10.69 |
  | eastus2, northcentralus, us-west-2 | 1 each | 10.27, 10.03, 6.91 |

  In eastus the per-test time stayed in a 9.1–10.5 ms band across the whole sample, matching run 4's reading.
* **The 11-06/07 dip.** Daily medians 7.40 (11-06) and 6.48 (11-07) follow 11-05's 8.57. The 11-07 runs were on centralus and
  westcentralus; 11-06 on westus and westus3. Centralus is the fast pool. The test count rose across both days (23,912 → 24,234).
  The dip is the pool, not fewer tests. The research's runner-image explanation for the dip was **not checked** (image not sampled).
* **Why still Medium.** Suite growth is a standing cost on every PR and merge. It rose across every closed window and across the
  delta. It is the only signal whose trend is not burst-shaped.

### F2 — `prompt-contract-text-rate` (new) · Severity: Low–Medium · **worsened (new row; sharp late rise)**

Path set (research's list, reproducible in `measure_extra.py`): `lib/prompt-template-defs.js`, `scripts/prompt-template-change-log.md`,
`lib/proxy-instructions.js`, `lib/proxy-preamble.js`, `docs/proxy-integration.md`, `lib/prompts/`, `lib/prompt-formatters.js`,
`lib/prompt-templates.js`, `tests/unit/prompt-size-budget.test.js`.

| window | landings | touching the set | share | landings/day | lines added in set |
|---|---|---|---|---|---|
| run 3 (`6be148a8..f25aa127`) | 141 | 12 | 8.5% | 1.45 | 204 |
| run 4 (`f25aa127..5334c81a`) | 243 | 32 | 13.2% | 2.25 | 510 |
| **run 5 delta (`5334c81a..pin`)** | **114** | **32** | **28.1%** | **7.19** | **1,299** |
| run 5 rolling (`f25aa127..pin`) | 357 | 64 | 17.9% | 3.42 | 1,809 |

* **Hot files in the delta** (touches): `scripts/prompt-template-change-log.md` 20 (560 lines at pin, 350 at run 4's pin),
  `lib/proxy-instructions.js` 15 (1,243 → 1,312), `lib/prompt-template-defs.js` 15 (1,160 → 1,271), `lib/proxy-preamble.js` 7
  (829 → 931). Four of the five most-touched files in the delta sit in the path set.
* **The size ceiling is moving.** `tests/unit/prompt-size-budget.test.js` was touched in **19 of 114** delta landings (one in six),
  and in 24 of 357 across the rolling window. Several edits are small (2–5 lines); some are large (LIN-4367: 37 added, 64
  deleted; LIN-4373: 17 added). The invariant is that prompt text grows only with its reason recorded beside the ceiling. I
  read the diffs' sizes, **not each reason**, so whether every raise is recorded beside it is not verified here.
* **Reading.** Prompt-contract churn is the most concentrated rate in the window. Whether it is settling depends on whether the
  late rise is one programme. Ten of the 32 delta landings in the set are a single programme on 11-07 and 11-08 (LIN-4345, 4352/4353,
  4360/4362, 4367–4369 and 4393), which the subjects show. A finished programme would not repeat the rate, so the rise is a burst, not a standing rate; git does not show whether more is queued. Severity is Low–Medium because the rate is
  bounded by a test and by a log, not because the rate is low.

### F3 — `review-evidence-weight` (new) · Severity: Low–Medium · **worsened (weight), flat (landing share)**

| window | blob bytes in `docs/reviews` | share of repo blob bytes | review landings (share) | lines added per review landing |
|---|---|---|---|---|
| `f25aa127` | 27.5 MB (943 files) | 20.8% | — | — |
| `5334c81a` | 55.2 MB (2,077 files) | 32.7% | — | — |
| run 4 window | +27.7 MB, **1.95 MB/day** | — | 44 of 243 (18%) | 4,750 |
| **pin (run 5)** | **84.4 MB (3,648 files)** | **38.4%** | — | — |
| **delta** | **+29.1 MB, 6.5 MB/day** | — | **20 of 114 (17.5%)** | **31,271** |
| `docs/papers`, delta | **+18.1 MB** (18.8 → 36.9 MB; 12 landings, 45,212 added lines, ≈36.5k of it JSON evidence) | 16.8% at pin | — | — |

* **Rate of landings is flat; weight is not.** The landing share is 17.5% (run 4: 18%). Review landings run at 4.5/day in the delta,
  against 3.1/day in run 4's window and 2.7/day in its tail. Lines added under `docs/reviews` in the delta are 625k, against 209k in run 4.
* **Papers are the second evidence tree.** `docs/papers` (LIN-4334 `ea3523068` 20.8k lines; LIN-4315 `5c63aa261` 14.9k; LIN-4257 `e4fa8d34a`
  6.9k; plus the essay series) carries 18.1 MB of the delta's growth, and the report's first draft omitted it. Its evidence is research
  output, which the `research-eval-programme` row (`experiments/` only) does not measure.
* **Driver: periodical evidence.** Of the 20 delta review landings, 15 are periodical reports or their evidence (LIN-4206 through
  LIN-4208, 4209 and 4232, 4231, 4249, 4250, 4298–4300, 4323–4324, 4387, 4391). Their evidence directories carry about 96% of the
  added lines. Five are product landings; the replay directories for LIN-4345 and LIN-4369 total **14,961 lines (2.4%)**. Report
  files themselves total 8,503 lines (1.4%).
* **Campaign attribution.** The spike sits in the 11-04..11-08 periodical evidence. That matches the research's account of a
  concentrated review campaign. The research's further claims, that paired tickets predate LIN-4381 and that the landed lane
  excludes Periodical landings, were **not verified** here.
* **Stability signal or bookkeeping?** Both, and the verdict depends on the question. As a *rate*, it is standing and rising
  (6.5 MB/day; repo blob bytes 132 → 220 MB since `f25aa127`), and it is growing faster than the product's source. As a *driver of
  instability*, it is not: the evidence does not feed the code it reviews. It carries a real cost in clone size and reading cost
  and is kept as a separate row, not netted into F1 or F4.

### F4 — `project-velocity-trajectory` (LV) · Severity: Low–Medium · **worsened on rate; improved on rewrite**

* **Landings.** 114 in 4.45 days = 25.6/day, against 17.1/day in run 4 (+50%). Rolling: 19.1/day.
* **Src lines.** Delta: added 10,635, deleted 3,697. Gross 3.2k lines/day; net **+1.56k/day** (run 4: gross 4.9k/day, net +1.09k/day).
  Delete/add **0.35** (run 4: 0.63). Rolling: added 52,802, deleted 30,373; delete/add 0.58.
* **Tests** (bucket, excluding fixtures and screenshots): +29,203 lines in the delta. `tests/fixtures/` added a further **44,245 lines in
  23 landings** (method-excluded, but it is growth; not decomposed).
* **Reading.** Growth is the mode, and it is faster. Rewriting is quieter. The two readings point the same way: more of the
  same work, not a converging shape.

### F5 — `project-velocity-trajectory` (SD) · Severity: Low–Medium · **changed: hardening, test-heavy; a three-day gap**

* **Landings.** Delta 20: 13 (11-04), 7 (11-08), none 11-05..11-07. Rolling 55.
* **Gap.** `gh pr list` (last 60 PRs) shows zero PRs *created* on 11-05, 11-06 or 11-07, and the last merge before the gap is 11-04
  23:46Z. The first merge after it is 11-08 02:53Z. Reading: absent supply of work, not a measured slowdown. Whether supply was
  withheld by decision is not visible from the repository.
* **Shape.** `test/` added **32,071 lines** in the delta; `lib|routes|public` and top-level `.js` added **556**. Test share **98%**
  (run 4: 83%). `test/` grew from 289 files (`67ff5c3b`) to 334 (pin).
* **Hot SD files.** `dispatcher.js` and `reapers.js`: **0 touches** in the delta (run 4: 13 and 9). `opencode-runner.js`: 2 touches,
  **1,966 → 1,836** lines, shrinking.
* **Reading.** Not a rebuild, and not converging in shape either: the tail is test hardening after a backlog sweep. Ask the
  maintainer whether the sweep is finished (run 4's question, still open).

### F6 — `dispatch-entrance-churn` (`lib/dispatch-store.js`) · Severity: Low · **worsened (rate doubled; size +14%)**

* `lib/dispatch-store.js`: **11 touches** in the delta, **2.46/day**, against 16 in run 4's 14.2 days (1.13/day). Lines 3,967 →
  4,530 (+14%). `lib/dispatch-entrance.js`: 12 touches (1,940 → 2,057). `routes/proxy-compute.js`: 14 (1,617 → 1,682) in the
  delta's hot-file list.
* Run 4 read the store as "feature accretion". This window's touches are not analysed one by one. The rate is the finding:
  the store is the growth point of the dispatch surface, and its touch rate is rising.

### F7 — `young-surface-hotspots` (Home / task page) · Severity: Low · **improved in intensity; size growth slowed**

* **Cluster landings** (unique, across the 11 surface files and the four `home-*` files): **14 of 114 (12%)** in the delta, against
  48 of 243 (20%) in run 4. Per active day: **3.1/day**, against 6.0 in run 4's burst and 3.4 in its tail.
* **Sizes.** `public/prompt-section.js` 2,867 → 2,967 (+3.5%; run 4: +94%). `lib/task-page-loader.js` 1,535 → 1,544 (+0.6%; run 4: +55%).
  `lib/render.js` touched 5 times, 1,151 → 1,123 lines (down 2%).
* **Reading.** The cluster's intensity has fallen across three windows. It is no longer the dominant surface. Whether the round
  is over is still the maintainer's decision.

### F8 — `rebuild-wave` · Severity: Low · **improved: 3 rewrite events, 0 repeats**

* **Delta:** 3 events (0.67/day, against 2.7/day in run 4): 2 whole-file deletions (`lib/founder-lookup.js`, 61 lines;
  `scripts/code-shape/areas.json`, 86 lines, a bookkeeping file) and 1 in place (`lib/pricing-conformance-sweep.js`, 253 → 194 lines
  deleted). Repeats: 0. **Rolling:** 41 events (30 whole-file, 11 in place), 0 repeats.

### F9 — `decision-reversal`, `true-reverts`, `cancelled-session-invariant` · Severity: Low · **one new withdrawal; no true reverts; no further fix-of-fix found**

* **Partly withdrawn (new instance).** The "size of the move" setting was built as LIN-4368 (`eeda7e448`, 2026-11-08 00:12Z) and
  retired by LIN-4393 (`393c7686b`, 15:34Z), about **15.4 hours** later. Only the setting was withdrawn. At the pin,
  `lib/size-of-move.js` (8 hits), the size-record guard in `routes/proxy-writes.js` and the stored `sizePolicy` rows (with a retirement
  note in `lib/workspace-preferences.js`) all remain. The arc started earlier (LIN-4367 `9c2a378a0`, "size of the move 1/4") and was
  split across LIN-4368/4369/4393. The time-scale matches run 4's Settings scaffolds, but the withdrawal is partial, not a feature removed whole.
* **True reverts: 0** in both repos (subject search for "revert", 114 LV and 20 SD landings).
* **`cancelled-session-invariant`** (run 4 F17): the four run-4 landings are unchanged (SD `bd6d2cf` LIN-4079 11-01 14:41Z; SD `cf6369d`
  LIN-4082 11-01 17:08Z; LV `e1f75fe7` LIN-4080 11-01 16:23Z; SD `67ff5c3` LIN-4185/4186 11-04 07:41Z). Keyword search (`cancel`, `stop`,
  `halt`, and the four IDs) found no third landing on the rule in either repo since run 4. Keyword-only: a hand reading could still
  find one.

### F10 — `ticket-mint-vs-landing` (proxy) · Severity: Low · **changed: both rates up; ratio narrowed**

* **IDs minted.** LIN-4206 (2026-11-04 07:45:30Z) to LIN-4394 (2026-11-08 16:20:57.831Z): 188 IDs in 4.36 days = **43.1/day**,
  against 32.3/day in run 4's span (+34%).
* **Landings.** LV 114 + SD 20 = 134 in 4.45 days = **30.1/day**, against 19.6/day in run 4.
* **Ratio** minting : landing = **1.43**, against 1.65 in run 4. Narrower, but both rates are higher. The ID span includes
  cancelled, duplicate and periodical tickets across two repos, so this is a proxy, not a rate.

### F11 — `server-js-growth`, `periodic-loop-two-mechanisms`, `proxy-churn-concentration` · Severity: Low · **mixed**

* `server.js`: **7 of 114 landings (6.1%)**, against 20.2% in run 4. Size 4,668 → 4,757 (+1.9%). **Improved on share.**
* Bare intervals (carried, same mechanisms): catalog refresh at `server.js:1034` (run 4: 1022) and hourly cleanup at `server.js:4696`
  (run 4: 4607). The line numbers moved with growth; the mechanisms did not change.
* `routes/proxy.js`: **7 touches** in the delta (1.57/day), against 13 in run 4 (0.92/day). Size 1,668 → 1,676. **Worsened on rate.**

### F12 — `runner-kit-convergence`, `lv-sd-contract-coupling`, `opencode-runner-convergence` · Severity: Low · **improved (runner); unchanged (contract)**

* `lib/runner-kit/runner.mjs`: **1 touch** in the delta (0.22/day; run 4: 5 in 14.2 days). Settled on touch count.
* Shared LIN IDs in both repos' delta subjects: **3** (LIN-4203, LIN-4240, LIN-4375). Run 4 had 6 in a wider window; not comparable.
* `opencode-runner.js` (SD): 2 touches, 1,966 → 1,836 lines (see F5).

### Scope audit: in-remit surfaces not in run 4's scope (checked for rate-shaped findings)

| surface | delta | rolling | reading |
|---|---|---|---|
| `docs/areas/` (area notes, LIN-4371 onward) | **20 landings, +698 lines** | 20 landings | A new standing surface: roughly one landing in six. Bookkeeping; tracks the surface rate. Advisory templates do not feed it (brief). |
| `docs/plans/` | 9 landings, **+4,040 lines** | 18 landings, +5,592 | Plan documents accompanying landings. Not decomposed further. |
| `public/` | 20 landings, +857 lines | 89 landings, +11,017 | The Home cluster (F7) and `public/llms.txt` bookkeeping (9 touches). |
| `.github/` | 0 landings | 3 landings, +21 lines | Not a CI-series driver. Workflow changes not examined in detail. |
| `tests/unit/` | 85 landings | — | Growth in F1. |
| `docs/papers/` | 12 landings, **+45,212 lines**, blob +18.1 MB | — | Research output: paper and essay drafts with JSON evidence (LIN-4334, 4315, 4257, 4330/4335/4338/4340). Excluded from churn by method, but it is the largest single growth surface in the delta by bytes. |
| `tests/fixtures/` | 23 landings, +44,245 lines | 75 landings | One commit, `6ff38cf5c` (LIN-4263), adds **40,197 lines** to `tests/fixtures/cost-replay/goldens-lin4197.json`: 91% of the fixture churn. A recorded baseline, the same class as the `replay/work` bucket; excluded from src. |
| `lib/periodicals.js` (Periodicals machinery) | 7 touches, 1,151 → 1,353 (+18%), 1.57/day | — | Research cites 1.79/day for a wider file set; not reconstructed. |
| `docs/architecture/source-map.md` | 29 touches (6.5/day) | 89 | Test-checked bookkeeping. Run 4: 60 in 14.2 days (4.2/day). Rate up. |
| `public/llms.txt` | 9 touches (2.0/day) | 49 | Bookkeeping. Run 4: 40 in 14.2 days (2.8/day). Rate down. |

### Carried rows (not re-measured this run)

* `route-boundary-coupling`: lifts from research at n ≤ 14; not re-measured.
* `corrective-vs-additive-ratio` (LV and SD): not re-measured. The title classifier's recall (about 20%, run 3) still makes it unfit for trend use.

## Class completeness (bounds and members)

| class | bound | members / count |
|---|---|---|
| Landings in window | pin ranges as above | LV 114 delta / 357 rolling; SD 20 delta / 55 rolling |
| Hot src+scripts files | ≥6 touches in the delta | 16 files; top: `prompt-template-change-log.md` 20, `proxy-instructions.js` 15, `prompt-template-defs.js` 15 |
| Rewrite-in-place events | ≥50% of prior lines in one landing | delta 3 (2 whole, 1 in place); rolling 41 (30 whole, 11 in place); repeats 0 |
| Stagnant src files | ≥4 landings 04-01..06-25, present at `f25aa127` | 95 (run 4: 91); silent since 08-12: 10 at `f25aa127`, 3 at pin |
| CI measured | main runs, successful, `updatedAt − startedAt` | 1,000 listed (997 success, 3 failure, back to 09-04); 29 unit logs with test counts (10-23 on) |
| Unbounded | — | runner assignment; review-ticket minting actor; production dispatch and session counts; task age and cycle time (no timestamps in the issue list); corrective share by behaviour |

## Trend ledger

Severity: none / low / low–med / med / high. Delta vs 2026-11-04 (run 4): new / unchanged / improved / worsened / changed /
resolved / not re-measured. Stable names are run 4's, and all 26 of run 4's names are accounted for. Two rows are new this run
(`prompt-contract-text-rate`, `review-evidence-weight`); one name is retired (`prompt-cluster-coupling`, from run 4).

| Signal (stable name) | Repo | Class | Severity | Reading (delta / rolling) | Delta vs 2026-11-04 |
|---|---|---|---|---|---|
| `test-suite-accretion` (CI) | LV | growth shape / CI | **med** | medians 5.22 → 6.59 → 7.07 → 7.87 → 8.32 → 8.55; runtime tests 22,757 → 24,772 in 4 days | **worsened** (med, unchanged; driver rising) |
| `young-surface-hotspots` (Home / task page) | LV | surface rate | low | 14 landings (12%), 3.1/day (run 4: 6.0 burst / 3.4 tail); `prompt-section.js` +3.5% | **improved** (intensity) |
| `review-layer-rate` | LV | governance churn | low–med | 20 of 114 (17.5%); 4.5/day (run 4 window 3.1; tail 2.7) | **worsened** (rate), share flat |
| `project-velocity-trajectory` | SD | overall shape | low–med | 20 landings; 0 on 11-05..07 (no PRs created); 98% of added src+test lines are tests | **changed** (hardening; gap verified) |
| `rebuild-wave` | LV | rework / direction | low | 3 events (0.67/day, run 4 2.7/day); 0 repeats | **improved** |
| `project-velocity-trajectory` | LV | overall shape | low–med | 25.6/day (run 4 17.1); net +1.56k/day (run 4 +1.09k); delete/add 0.35 (run 4 0.63) | **worsened** (rate); rewrite improved |
| `dispatch-entrance-churn` | LV | surface rate | low | `dispatch-store.js` 11 touches, 2.46/day (run 4 1.13); 3,967 → 4,530 (+14%) | **worsened** |
| `opencode-runner-convergence` | SD | surface rate | low | 2 touches; 1,966 → 1,836 lines | **changed** (shrinking) |
| `proxy-churn-concentration` | LV | surface rate | low | `routes/proxy.js` 7 touches, 1.57/day (run 4 0.92) | **worsened** (rate) |
| `runner-kit-convergence` | LV | surface rate | low | `runner.mjs` 1 touch in the delta (run 4: 5 in 14.2 d) | **improved** |
| `lv-sd-contract-coupling` | LV+SD | change-coupling | low | 3 shared IDs in delta (run 4: 6 in a wider window; not comparable) | **unchanged** |
| `research-eval-programme` | LV | excluded-path churn | low | `experiments/` authored +42 lines in the delta; generated replay 0 in the delta; rolling authored +2,421, generated 33,486 (LIN-3880). Research output also lands in `docs/papers/` (+45.2k lines, delta; not measured in this row) | **unchanged**; owner question still open |
| `server-js-growth` (S2) | LV | surface rate | low | 7 of 114 landings (6.1%; run 4 20.2%); 4,668 → 4,757 | **improved** (share) |
| `route-boundary-coupling` (S3) | LV | change-coupling | low | not re-measured | **not re-measured** (carried) |
| `periodic-loop-two-mechanisms` | LV | surface rate | low | bare intervals at `server.js:1034` and `:4696` (run 4: 1022, 4607); same mechanisms | **unchanged** (lines moved) |
| `stagnation` | LV | silence | low | 10 of 95 silent at `f25aa127` (run 4: 10 of 91; denominator unresolved); 3 at pin | **unchanged** |
| `decision-reversal` | LV (+SD) | rework / direction | low | `size of the move` setting: LIN-4368 (00:12Z) retired by LIN-4393 (15:34Z) ≈ 15.4 h; guard and rows remain | **worsened** (new instance; partial withdrawal) |
| `true-reverts` | LV + SD | rework | none | 0 in LV (114) and SD (20) | **unchanged** |
| `file-growth-vs-rework` | LV | growth shape | low | delete/add 0.35 (run 4 0.63) | **changed** (more growth, less rewriting) |
| `docs-index-churn` | LV | bookkeeping | none | `source-map.md` 29 touches (6.5/day; run 4 4.2/day); `llms.txt` 9 (2.0/day; run 4 2.8/day) | **changed** (bookkeeping; tracks surface rate) |
| `prompt-cluster-coupling` | LV | change-coupling | — | retired in run 4; not re-measured | **retired** (unchanged) |
| `prompt-parity-coupling` | LV | change-coupling | none | resolved 10-12 | resolved (unchanged) |
| `corrective-vs-additive-ratio` | LV | rework | — | not re-measured (classifier recall ≈20%) | **not re-measured** |
| `corrective-vs-additive-ratio` | SD | rework | — | not re-measured | **not re-measured** |
| `cancelled-session-invariant` | SD + LV | rework | low | the four run-4 landings unchanged; no third landing by keyword search | **unchanged** (no further fix-of-fix found) |
| `ticket-mint-vs-landing` | tracker | proxy | low | 43.1/day (run 4 32.3); landings 30.1/day (run 4 19.6); ratio 1.43 (run 4 1.65) | **changed** (ratio narrowed; both rates up) |
| `prompt-contract-text-rate` (**new**) | LV | rework / contract | low–med | share 8.5% → 13.2% → **28.1%** (delta); 1.45 → 2.25 → **7.19** landings/day; ceiling test in 19 of 114 | **new** (worsened) |
| `review-evidence-weight` (**new**) | LV | evidence volume | low–med | `docs/reviews` 27.5 → 55.2 → 84.4 MB; 6.5 MB/day (run 4 window 1.95); 38% of repo blob bytes; with `docs/papers`, 55% and 93% of delta blob growth | **new** (worsened) |

## Plain-language read for the maintainer

**The project is not converging, and it went the wrong way this window on rate.** Landings are up about half, and net source growth
is up with them. The CI wall-time series is still climbing and its driver, the test suite, grew about 9% in four days. The
evidence trees (`docs/reviews` and `docs/papers`) took 93% of the repository's blob growth in the delta (47.2 of 51.0 MB). The rewrite pattern has eased, and the Home cluster
is touched far less often than before. Those are the good signs. Nothing here is a feature built and taken out at scale, and
there are no true reverts.

**Options a maintainer might weigh (nothing is filed; the decision is yours):**

1. **CI time is still the clearest trajectory.** Decide a wall-time budget on main, or which suite growth is worth its cost.
   Judge by runtime test counts and per-region medians, not by a single day's dip (the 11-06/07 dip is pool-driven).
2. **Evidence weight in `docs/reviews`.** Decide whether periodical evidence should keep its full size, be compressed, or be
   capped per run. `docs/reviews` is growing at 6.5 MB/day and holds 38% of repo blob bytes; `docs/papers` adds 18.1 MB more in the delta.
3. **Prompt contract.** The ceiling test moved in one landing in six. Options: slow prompt-text changes, or confirm that each ceiling
   raise names its reason in the same landing, as the invariant already requires. The diffs were not read for that here.
4. **Periodical cadence.** Run 4 asked whether the review cadence should slow. It is 4.5 review landings a day in this delta, against
   3.1 in run 4's window. Still open.
5. **SD.** Decide whether the backlog sweep and test hardening end. The tail is 98% tests, and three days had no PRs created.
6. **`lib/dispatch-store.js`.** The store's touch rate doubled (2.46/day). It is the growth point of the dispatch surface. Options: split it, or freeze it pending a decision.
7. **The three silent files** (`lib/harbour-spawn.js`, `lib/providers/registry.js`, `lib/render-custom-prompts.js`) are unchanged. Silent by
   neglect, not by decision.

**No follow-up tasks have been created.**

## Measurement evidence

Everything above is reproducible from `docs/reviews/_evidence-2026-11-08-stability/` (its README gives the exact commands):

| file | what |
|---|---|
| `measure_lv.py` → `lv-measure.json` | run-4 reproduction (landings, weeks, stagnation); delta and rolling windows; buckets; hot files; short-lived files; review layer. Note: the key `window_f25aa127_HEAD_landings` holds the **delta** count (114). |
| `lv-window-landings.tsv` | the 114 delta landings (sha, committer date, subject) |
| `rewrites.py` → `rewrites-run4-window.json`, `rewrites-delta.json`, `rewrites-rolling.json` | method-8 rewrite events; the run-4 file reproduces 38 (28 whole, 10 in place) |
| `measure_extra.py` → `extra-measures-2026-11-08.json` | prompt-contract share; review weight and blob bytes; SD windows |
| `surfaces.sh` → `surfaces-2026-11-08.txt` | in-remit surfaces; Periodicals, dispatch-store, server.js, prompt file line counts; test-file and static test-call counts; cluster, docs/areas, fixtures, budget test, proxy, runner, source-map, llms |
| `ci-main-runs-2026-11-08.json` | 1,000 main `test.yml` runs (`gh run list`) |
| `measure_ci.py` | daily and window medians (successful runs, `updatedAt − startedAt`) |
| `measure_ci_logs.py` → `ci-unit-log-sample-2026-11-08.tsv` | unit-job logs: runner region, runtime test count and duration per arm (70 sampled runs; 29 with counts) |

The SD numbers (landings, test share, PR gap) come from `git log --first-parent -m --numstat --no-renames` over
`67ff5c3b..5d8489e7` and `bb1da78..5d8489e7`, and from `gh pr list -R JKershaw/simple-dispatcher --state all --limit 60` (the
PR-creation gap). Their commands are in the README.

## Adversarial Second-Read

**Tier:** Tier 2, a fresh-context general-purpose sub-agent with no memory of the report-writing turn. It was given the report,
both repositories and the evidence directory, and the question only.

**Question:** "What is the largest item in this window that this report missed or misfiled?"

**Reader's answer (summarised; full reply in the LIN-4394 comment):**

* **Largest miss: `docs/papers/`.** Not mentioned in the report. +45,212 lines in 12 landings; blob +18.1 MB (18.8 → 36.9 MB). With
  `docs/reviews` (+29.1 MB), the two evidence trees account for 47.2 of 51.0 MB of repository blob growth (93%).
* **Misfiled: one fixture.** `6ff38cf5c` (LIN-4263) adds 40,197 lines to `tests/fixtures/cost-replay/goldens-lin4197.json`, 91% of the
  report's fixture churn, called "not decomposed". It is a recorded baseline, excluded from src.
* **F3 magnitude understated.** Docs-only shares (38% and 57%) omit `docs/papers`. Combined: 55% of repo blob bytes at the pin,
  93% of delta blob growth.
* **F9 overstated.** The setting was retired, but `lib/size-of-move.js`, the proxy size-record guard and the stored `sizePolicy` rows remain at the pin.
* **F2 partly misread.** Ten of the 32 delta prompt-contract landings are one programme on 11-07 and 11-08.
* **Verified:** 114 / 20 landings and their day split; 20 docs/reviews landings (+625,411 lines); prompt set 32 of 114 and the ceiling test in 19;
  CI medians and the 11-06/07 dip; per-region ms per test; SD test share 98.3%; 0 true reverts.

**Response (checked against git before accepting):** the papers figures, the 40,197-line golden file, and the surviving size-of-move
guard were each re-run and confirmed. Fixed in place: the docs/papers row and the fixture decomposition (scope audit); the F3 evidence
share (headline, F3 table, F3 bullets, ledger, plain-language read and option 2); the F9 partial-withdrawal wording and its ledger
row; the F2 programme note; and measurement decision 2(c). The reader's ranking differs from ours: it names the papers miss, and our F1
(CI wall time) stays top because it is the only signal monotonic across every closed CI window. The reader agrees with the headline.

**Fields (the engine reads the same three in one body on the task comment):**

Adversarial second-read verdict: AGREE
Differed from top finding: YES
Disposition: fixed in place
