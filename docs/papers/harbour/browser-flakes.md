---
title: Which browser specs flake, why, and what do they cost?
kind: paper
version: 2
date: 2026-09-30
authors: [Claude (LIN-3168), Claude (LIN-3173)]
model: "Frontier tier, claude-code. Version 1: one bounded research session (dispatch 8278406b, kind custom) with in-session subagents for the transcript scan and the blind second coding, and no plan, review or close-out legs, by the brief's design. Version 2: the independent check survey-check-5.md (dispatch 803de3ea, kind custom, LIN-3173), one bounded session whose in-session subagents re-ran the scripts, re-read the spec source and blind-coded a fresh sample."
grounded_at: fe541ee9 (LinearViewer, origin/main); 3b1e734 (simple-dispatcher, origin/main); version 2 re-read at 04dc586d
cites: [docs/papers/harbour/test-estate.md@fe541ee9, docs/papers/harbour/reliability-baseline.md@fe541ee9, docs/papers/harbour/survey-check-5.md, playwright.config.js@fe541ee9:7-16, .github/workflows/test.yml@fe541ee9:100-111, CLAUDE.md@fe541ee9:54, tests/e2e/observation.spec.js@fe541ee9:401-424, tests/e2e/dispatch-presets.spec.js@fe541ee9:231-238, public/settings.js@fe541ee9:152, tests/e2e/prompts.spec.js@fe541ee9:669-693, public/app.js@fe541ee9:1790-1797, tests/e2e/opened-task-first-screen.spec.js@fe541ee9:120-124, tests/e2e/session-page.spec.js@fe541ee9:350-362, tests/e2e/proxy-local.spec.js@fe541ee9:37, simple-dispatcher/.github/workflows/ci.yml@3b1e734:47-53, c37d07c0 (LIN-629, 2026-06-24), 5af7c3cc (LIN-799), 70308736 (LIN-800), 13c6ea8c (LIN-801), a7687fd9 (LIN-802), a00ee5ed (LIN-1910, 2026-08-13), 0e8a1461 (LIN-1727, 2026-08-23), d4a05f2e (LIN-2797, 2026-09-12), PR #1451, PRs #1209, #1211, #1212, LIN-625, LIN-3159]
---

# Which browser specs flake, why, and what do they cost?

A few specs, mostly one test each. Since 1 June, LinearViewer's CI has had 138 attempts with a
red browser (Playwright E2E) shard. At least 64 of them were flakes, 42 were real faults, 3 were
count pins, 4 were the environment, and 25 cannot be placed; one of those 25 is in effect a
livebar flake. Every CI-red flake whose failing test is known sits in one of seven specs, and
three of them (`observation`, `observation-rulings`, `dispatch-presets`) carry two-thirds. Read
from the spec source, the known-spec flakes have three causes, but not the three version 1
named: waits and route holds that do not hold (15 of 39), state left in a worker's own
partition by earlier specs (11), and a read racing a re-render of the element (10); 3 are
undetermined. Only June's burst was state shared *between* the two parallel workers. The red
flakes cost 38 red pull-request runs and 54 re-runs; the red attempts and their re-runs took
about 7½ hours end to end, and about 3 runner-hours went to the re-runs. The larger cost is
hidden: Playwright retries every failing test twice in CI, and 80% of sampled green runs
contained a test that failed and then passed on retry. One reduced-motion test in
`observation.spec.js` did so in 71% of all green runs. simple-dispatcher's CI runs no browser,
so every CI number here is LinearViewer's.

![Specs ranked by CI-red flakes, with retried-away flakes and wall-clock](figures/browser-flakes/specs-ranked.svg)

## Findings

**Flakes are a burst after a change, then a few repeat offenders.** `test-estate.md` found
browser flakes to be the largest single cause of red CI. Split by period, they are not a steady
background:

| Period (LinearViewer) | CI runs | E2E-red flakes | per 100 runs |
|---|--:|--:|--:|
| 1–23 June, one Playwright worker | 526 | 0 | 0.0 |
| 24–30 June, two workers | 253 | 25 | 9.9 |
| July | 790 | 7 | 0.9 |
| August | 713 | 25 | 3.5 |
| September | 956 | 7 | 0.7 |

On 24 June LIN-629 raised CI to two Playwright workers (`playwright.config.js:12`; four
locally). It merged at 17:08 UTC, so the second row starts with a few one-worker runs. 1–23
June had only six E2E-red attempts; none passed on a re-run except one that failed at
"Initialize containers" before any test ran, which is an environment red. The week after had
25 flakes in 22 runs, and four tickets named for flakes killed them within six days. Three
were seed ids colliding across worker scopes (LIN-800, LIN-801, LIN-802). The fourth, a feed
cache not cleared on test reset (LIN-799), reproduced with one worker, so it is not a
two-worker cause. August's 25 are the second burst. Five come from `next-run`, all on one
day, and eight from `observation-rulings`, which was new on 22 August. The LIN-1727 PR
(0e8a1461) fixed `next-run` and six of the eight, naming rows other specs left in the same
worker's partition and store; `observation-rulings` flaked twice more, on 25 and 27 August, in
a different test. June's logs have expired, so June's flakes are counted from the same commit
passing on a re-run (24) or an empty re-trigger (1), not from a failing test. Every flake with
a readable log failed exactly one test (39 of 39).

**Concentration: seven specs, one test in six of them.** Ranked by CI-red flakes, with each
spec's other failures:

| Spec | Flakes | Real faults | Other | First–last flake | The flaky test |
|---|--:|--:|--:|---|---|
| `observation` | 10 | 0 | 1 | 5 Jul – 5 Sep | reduced-motion livebar renders a static fill |
| `observation-rulings` | 8 | 4 | 0 | 23 Aug – 27 Aug | a mid-turn ruling unaffected (6); a non-page workspace ruling (2) |
| `dispatch-presets` | 8 | 2 | 0 | 18 Jul – 28 Aug | clearing a blend preset's per-kind override |
| `next-run` | 5 | 4 | 0 | 23 Aug (one day) | clicking a target dispatches inline |
| `session-page` | 4 | 5 | 5 | 28 Jul – 29 Aug | a finished session with a lingering blocked worker |
| `prompts` | 3 | 0 | 0 | 23 Aug – 24 Sep | suggest button shows the recommendation container |
| `ship` | 1 | 1 | 0 | 30 Sep | layout is deterministic across reloads |

Those 39 flakes are every CI-red flake with a known spec. The other 25 are June's, with no log.
`observation`'s "other" is a red the census could not place because main moved before a
re-run; it failed the livebar test with the livebar's error, so it is in effect an eleventh
livebar flake. Since July, the other 85 specs have never turned CI red on a flake. `header-nav`
is the mirror image: its 5 reds were all real faults. Trend: `observation`'s red flakes run
steadily from July to September. `dispatch-presets` last went red on 28 August and `next-run`
stops with the LIN-1727 fix. `prompts` has two of its three in September, which is too few to
call a trend.

**Most flakiness never turns CI red: the retries absorb it.** CI retries each failing test twice
(`playwright.config.js:7`), so CI goes red only when a test fails three times running. A
systematic sample of 288 green runs (every 8th of the 2,302 since 3 July, when logs start) read
each E2E shard's "flaky" summary:

- **Any retry:** 229 of the 288 green runs (80%) passed only after at least one test had failed
  and been retried; 289 flaky tests in all.
- **The livebar test:** `observation.spec.js`'s reduced-motion livebar test (`:401`) accounts
  for 204 of the 289, in 71% of green runs. Its share fell from about 90% of runs in July to
  44% in the second half of September.
- **Everything else:** a green run hid some other retried test in 11% of runs in July, 46% in
  August and 22% in September. That covers `session-page` (28), `dispatch` (28; never CI-red),
  `dispatch-presets` (22), `ship` (5), `ship-biscuit` (1) and `session-decision-layout` (1).

![Browser-test reds by month, and how often a green run hid a retry](figures/browser-flakes/by-month.svg)

**Causes: waits that do not hold, leftover state and a re-rendered element.** Reading each flaky
test's source at `fe541ee9` and its errors:

| Cause | Flakes | Specs and evidence |
|---|--:|---|
| A wait or route hold that does not hold | 15 | `dispatch-presets` (8): saving calls `window.location.reload()` in the app (`public/settings.js:152`), and the test's `networkidle` wait and its own `page.reload()` (`:231-238`) race it; 7 of the 8 died on `net::ERR_ABORTED`, "frame was detached". `prompts` (3): the test holds `**/api/recommend/<id>/stream` (`:669`), but since LIN-1910 (a00ee5ed, 13 August) the client fetches `…/stream?source=…` (`public/app.js:1795`), which that glob does not match. The hold never engages, and the test passes only if its `toBeHidden` (`:693`) runs before the real stream ends; another spec's comment notes the query suffix (`opened-task-first-screen.spec.js:120-121`). The first flake came ten days after that change. `session-page` (4): the test reads the sessions feed once, straight after seeding, and `terminal` comes back false (`:357-360`) |
| State left in the worker's own partition by earlier specs | 11 | `next-run` (5) and `observation-rulings`'s mid-turn test (6): other specs' rows in the same worker's queue and store, per 0e8a1461. Both specs already use the per-worker key |
| A read racing a re-render | 10 | `observation`'s livebar test reads `getComputedStyle(el, '::after')` once (`:413-418`). Every failure read an `animationName` of `""`. In Chromium an element whose rule has not applied reports the animation's name, and an element no longer in the document reports `""`, so the failures fit the feed poll replacing the node between the locator and the read, not a rule applied late |
| Undetermined | 3 | `observation-rulings`'s non-page workspace ruling (2), on commits that already had the LIN-1727 fix; `ship` (1), the test LIN-801 fixed in June, with 14 positions differing |

State shared *between* the two workers explains June's burst, as the three seed-collision fixes
show, and it is the partition problem LIN-625 names. It does not explain the known-spec flakes
since July. Version 1 read "sixteen specs still name the fixed key" as a live risk. At
`fe541ee9` most of those matches are in comments or sit beside a per-worker key. In running
code only `proxy-local` uses a fixed key (`:37`), a case the config's own comment calls safe.
Counting every per-worker variant, 75 of the 92 specs use a per-worker key. CLAUDE.md:54
does still say `workers > 1` "is **not** enabled yet", while CI has run two workers in each of
four shards since 24 June. Fixed sleeps (`waitForTimeout`) appear in 10 specs, including
`observation-rulings` and `session-page`; no failure traces to one. An ordering gap in
`ship-biscuit` that the blind coder of version 1 noted is a real-fault row, not the `ship`
flake.

**Cost.** The following are from LinearViewer CI unless marked:

- **Red PR runs:** 105 PR attempts had a red E2E shard. 44 of them, in 38 runs, were flakes,
  against 41 real faults and 3 count pins. Flakes are 42% of E2E-red PR attempts, and 38 of the
  1,944 PR runs in the snapshot (2.0%).
- **Re-runs:** 54 of the 82 re-run attempts LinearViewer made since June re-ran a flaky E2E
  shard. The median re-run started about a minute after the red run finished. Another 10
  flakes cleared by an empty re-trigger (2) or the next merge (8).
- **Time:** the red flaky attempts took 252 minutes end to end, and their re-runs 192 minutes
  more: about 7½ hours of elapsed time. In runner time, the E2E jobs inside the red attempts
  used about 631 job-minutes, and the re-run jobs 184 job-minutes, about 3 runner-hours. That
  re-run time is what a flake adds. A typical flake costs the session waiting on it one extra
  attempt, a median of about 3½ minutes.
- **Retries inside green runs:** these are not timed here. Each hidden retry reruns one test,
  with tracing on (`playwright.config.js:16`, `on-first-retry`).
- **Inside agent sessions** (both repos' transcripts, 29 August – 30 September):
  - **Who saw a red E2E shard:** of about 2,020 sessions, about 1,240 looked at CI, 37 saw it red
    and 15 saw a red E2E shard. All 15 were LinearViewer sessions, and one was a deliberate
    mutation probe. Six of the 15 were the livebar test.
  - **Diagnosis before acting:** every session that acted read the CI log first, and none re-ran
    blind.
  - **What the reds cost:** three read the log, called it a flake and re-ran, for a median of
    about 4 active minutes each. Four waited for a new push (62 active minutes in all, some of it
    other work). Four edited code, and three never saw green in the session.
  - **Flakes misread as real:** the rule for a session that diagnosed a flake as real and fixed
    it flagged one episode. On a hand reading that was PR #1451, LIN-2797's real race, where the
    session wrote "Not flaky. Deterministic". So none was found, but on 14 episodes that is thin.

**Masking: the bias runs both ways.**

- **A flake the PR caused.** On PR #1451, two bulk-agree tests in `observation-rulings` began
  failing about half the time. The PR's own A/B check found them passing 10 of 10 before its
  change: removing a 5-second cache grace window exposed a latent race in
  `public/observation.js`, where a rebuild could discard a settled row's feedback. LIN-2797
  (d4a05f2e, 12 September) root-caused it from CI and fixed it in product code. The census
  counts it as a real fault, which it was. By the paper's own rule it would have been a flake if
  a re-run had passed.
- **A test that fails first nearly every time.** The livebar test failed its first attempt in
  71% of green runs, and all year the retry has passed it. A fault that makes it fail only
  sometimes would look exactly like today's behaviour. Nothing in CI would tell the two apart.
- **Real faults on specs already known to flake.** Seven red attempts, in six runs, on
  `dispatch-presets`, `next-run` and `observation-rulings`, were resolved by a change to product
  code or the spec after that spec had already flaked. None was waved through: each was fixed
  before its branch went green. The blind coder of version 1 read two of the seven as flaky
  specs fixed in the PR.
- **Reds on main after a flake in the PR.** Pushes to main were E2E-red 33 times: 20 flakes, 1
  real fault, 2 environment and 10 unverified from June. Three of the main reds, all on
  23 August, followed a red on the same spec in the merged PR's own runs: #1209 and #1212 on
  `next-run`, #1211 on `observation-rulings`. Each PR red was a flake, re-run to green before
  the merge, and the LIN-1727 fix landed the same afternoon. So flakes did reach main, but no
  real fault was found that way. One push red, on 20 July, has no PR to check.
- **The count the other way.** Eleven flake attempts, in eight runs (10 on PRs, 1 on main), came
  on a diff that touched the flaky spec or code named like it, and a re-run cleared them. They
  are on three specs: `observation`, `dispatch-presets` and `observation-rulings`. That is where
  a real, intermittent fault could have passed as a flake. Of the three, only
  `observation-rulings` later needed a product fix (LIN-2797, above), in different tests.

So the census's flake count is a floor for failures that were not the diff's fault. A fresh
blind recode of 32 other attempts (in `survey-check-5.md`) agreed on 29, never swapped a flake
and a real fault, and placed three of the census's unplaceable rows: one flake and two real
faults.

## Method

- **Population.** `scripts/survey-tests-ci-runs.mjs` (LIN-3151) snapshots every run of
  LinearViewer's `test.yml` (3,238 runs) and simple-dispatcher's `ci.yml` (280) from 1 June to
  30 September. A re-fetch on 30 September finds three more green June runs; no rate moves.
  simple-dispatcher's CI installs with `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD` and runs only
  `npm test` (`ci.yml:47-53`), so it has no browser failures to census. Its 84 full-system
  tests are not in CI (`test-estate.md`).
- **Fetch.** `scripts/survey-flakes-ci-fetch.mjs` pulls every attempt of every failed or re-run
  run: job and step timings, and each red E2E shard's log parsed for Playwright's failure blocks,
  retry markers and summary. Logs expire after about 90 days, and the uploaded Playwright
  reports after 7 (`test.yml:111`). So test names exist from 3 July; 51 of the 138 attempts have
  none. A re-run of only the failed jobs copies the other jobs into the new attempt with their
  old timings; job-minutes here count each job once.
- **Resolution.** `scripts/survey-tests-ci-classify.mjs` (LIN-3151) finds the next green run on
  the branch and classifies what changed.
- **Census.** `scripts/survey-flakes-analyse.mjs` keeps attempts with a red E2E shard and
  records the spec and test, the shard, the sha, whether that sha later passed, and whether the
  run was re-run. It also computes the branch's own diff at the failing sha, walking first
  parents back to main's first-parent chain. From that diff it asks whether the change could
  plausibly have caused the failure:
  - `direct`: the diff touched the spec, a fixture or the config;
  - `name`: production code named like the spec;
  - `prod`: other production code;
  - `none`.

  Then it classifies, first match wins:
  1. **Environment:** the failing step was not the E2E test step, or the log shows the server
     or browser never started.
  2. **Flake:** the same sha passed later, or an empty re-trigger passed. On a push to main, the
     next merge did not touch the spec's surface.
  3. **Count pin:** an integer total (expected 2 to 99, so not an HTTP status) or an "all N"
     title, changed by the next green in the test, or by main.
  4. **Real fault:** product or test code changed before green. On main, only if the next merge
     touched the spec's surface.
  5. **Main moved:** a push to main whose next merge touched the spec's surface without a
     fix (2).
  6. **Unverified:** June push reds and literal-only test fixes with no failing test known (14).
  7. **Unresolved:** the branch never went green (9).
- **Blind second coding.** `--sample-blind 32 --seed 3168` drew every second attempt from the 89
  with a log or an environment class, and shuffled them. A separate subagent coded them from the
  errors, the diffs and git, without the labels (`blind-codes.json`).
  - **Agreement:** 21 of 32 on the rule as first run. The disagreements showed the count-pin
    rule firing on `toHaveCount(0)` and on HTTP status codes; with that fixed, 23 of 32. The
    second figure is not independent of the second coder.
  - **Where they still disagree:** four "unresolved" the second coder called real faults
    (abandoned branches); three real faults it called flakes (two flaky specs fixed in the PR,
    one ordering gap in a sibling run); one real fault it called a count pin; one environment
    against unverified. It never disagreed with a flake.
  - **A second, fresh sample** of 32 of the remaining 57, drawn by the check, agreed on 29.
- **Green-run sample.** `scripts/survey-flakes-green-sample.mjs --every 8` reads every 8th
  green run since 3 July (288 runs, 1,152 shard logs) for the "N flaky" summary.
- **Spec source.** `scripts/survey-flakes-spec-source.mjs` counts risk markers in each spec at
  origin/main: fixed sleeps, fixed workspace keys, per-worker keys, network waits, streams,
  animation, clocks and seeding. Its patterns match comments, count `setTimeout` promises as
  sleeps and miss per-worker keys under other names, so version 2 reads the flaky tests' source
  by hand instead.
- **Sessions.** `scripts/survey-flakes-sessions.mjs` reads the dispatched-session transcripts
  still on the machine. It finds each point where a session saw its own CI red on an E2E shard,
  then what it did before the next green: re-ran, diagnosed, edited, or never cleared it.
- **Snapshots and figures.** Snapshots live in the git-ignored `data/survey-flakes/`.
  `scripts/survey-flakes-figures.mjs` draws both figures. Re-run by the check, the analysis,
  classification, spec census and both figures reproduce byte for byte.

## Limits

- **June has no test names.** Its 25 flakes and 14 unverified reds cannot be put on a spec. The
  concentration table therefore covers July to September only, and under-states whichever specs
  flaked in the June burst.
- **"Flake" is a floor.** A flaky spec that the PR fixed in its own branch counts as a real
  fault. So does a failure whose branch changed before anyone re-ran it. The real-fault count
  is correspondingly high.
- **"Same commit passed" is also a ceiling on innocence.** A real intermittent fault passes a
  re-run too. Some flakes here may be product races.
- **The push-to-main rule is inferred.** "The next merge did not touch the spec" calls 8 main
  reds flakes without a re-run to prove it.
- **Count pins are few and the rule is rough.** It was tightened after the blind coding, and the
  blind coder still adds one. Two of the three here, `audit.spec`'s template count, are also in
  `test-estate.md`'s three.
- **The green sample is one run in eight, and only since 3 July.** The 80% and 71% are sample
  shares, with a 95% interval of about ±5 points at n = 288; the monthly shares are ±6 to ±10.
  Retry time inside green runs is not measured, so the hidden cost is under-stated.
- **Time is the runner's.** Neither figure is the operator's or the session's waiting time,
  which includes the time to notice and re-run: about a minute here.
- **Session transcripts are kept about 30 days,** so session costs cover September only. That
  misses August's burst. Sessions that never polled CI, and subagents, are invisible. All of this
  under-states the cost in sessions, and 14 episodes support no rates. Their counts drift by a
  few as transcripts are written and expire.
- **Causes are read, not reproduced.** No spec was re-run. Each cause is the one the error and
  source support, or that a fixing commit states. The livebar reading rests on how Chromium
  reports a detached element, checked outside CI.

## Next

- **Is the livebar test's first-attempt failure the feed replacing the node?** It fails first in
  most green runs and passes on the traced retry, and its failures read a detached element.
  Running it alone, repeated, with and without the feed poll, at origin/main would say which. It
  is the one test that could be hiding a real reduced-motion fault.
- **How many browser specs hold a route whose URL has since changed?** `prompts` has held a
  stream URL that stopped matching in August. A census of every `page.route` glob against the
  URLs the client now builds would say how many other holds no longer engage.
- **What do the retries inside green runs cost in minutes?** Playwright's JSON reporter records
  each attempt's duration. One week of it would put a number on the hidden 80%.
