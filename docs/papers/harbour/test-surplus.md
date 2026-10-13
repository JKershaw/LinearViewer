---
title: Have Harbour's tests taken on a life of their own?
kind: paper
version: 1
date: 2026-10-13
authors: [Claude (LIN-3551)]
model: "Frontier tier, claude-code; one research session (dispatch 46ad47d8, kind research) with in-session subagents for the CI pull, the git history, the session transcripts and the simple-dispatcher run. No plan, review or close-out legs, by the brief's design."
grounded_at: ebf93bd9 (LinearViewer, origin/main); 0d54b97 (simple-dispatcher, origin/main)
cites: [docs/papers/harbour/test-estate.md@ebf93bd9, docs/papers/harbour/survey-check-2.md@ebf93bd9, docs/papers/harbour/which-rules-pay.md@ebf93bd9:125-128, docs/papers/harbour/growth-atlas.md@ebf93bd9:117-123, docs/reviews/code-quality-review-2026-10-12-tests.md@ebf93bd9:33-39,184, docs/reviews/stability-review-2026-10-12.md@ebf93bd9:118-124, CLAUDE.md@ebf93bd9:110, lib/prompt-template-defs.js@ebf93bd9:174,895-900,977,997, routes/proxy.js@ebf93bd9:397, .github/workflows/test.yml@ebf93bd9, simple-dispatcher/CLAUDE.md@0d54b97:51,56-66, simple-dispatcher/test/system/mutation/run-mutations.js@0d54b97, LIN-3158, LIN-3517, LIN-3518, LIN-3523, LIN-3534, LIN-3547, LIN-3551 (2026-10-13)]
data: [test-surplus-mutants.json, test-surplus-sets.json, test-surplus-files.json, test-surplus-coverage.json, test-surplus-catches.json, test-surplus-history.json, test-surplus-scripts/]
---

# Have Harbour's tests taken on a life of their own?

Partly, but not the way the 90% guess supposes. Harbour's unit suite is not a thick blanket
in which most tests repeat each other. It is a thin, wide net. Most of the faults it catches
are caught by one test file only, usually the file named after the module. The smallest set
of files that keeps the suite's protection is therefore large: somewhere between a third and
three fifths of the 804 files, depending on the measure, and never fewer than 145. The best
tenth of the files, chosen with hindsight, keeps under half of the protection on faults it
was not chosen for. A set chosen on mutants also drops half of the real catches on record,
because the real catches lean on guards that mutants rarely touch.

So John's 90% does not hold. The surplus is real, but it is concentrated:

- **Ticket-named files** (`tests/unit/lin-NNNN-*`, 180 of them) are 22% of the files and 27%
  of per-file run time. They are the only catcher of a sampled fault 7% of the time, against
  17% for other files.
- **Census and count pins** catch almost none of the sampled faults. The 16 census-named
  files catch one between them, never alone, and they are the files the record shows being
  bumped.
- **377 files (47%) caught none of the 599 sampled faults.** Most of them guard code the
  sample did not hit, but 200 of them also execute no production line that another file does
  not.

Most of the cost is not surplus tests but the habit around them. Product PRs now bring about
twice their own lines in tests, two thirds of them must edit existing tests, and the unit job
is CI's slowest job and runs the suite twice. On the other side of the ledger:

- **In CI:** since 1 June the unit tests caught **no real product fault**, because agents run
  them before they push.
- **Inside sessions:** a hand reading of every candidate found **nine real catches in six
  weeks**. Four were load errors that any test importing the module would have caught.
- **The larger gap runs the other way:** **about half of the sampled one-line faults survive
  the whole suite.** Thin protection is a bigger problem than surplus.

## Findings

### The estate at HEAD, against test-estate's baseline

| | test-estate, 30 Sep (`c65b7dd8`) | HEAD, 12 Oct (`ebf93bd9`) |
|---|--:|--:|
| unit test files | 592 | 803, plus one eval test `test:unit` runs |
| unit test lines | 230,632 | 286,764 |
| unit tests | 12,451 | 15,322 |
| behavioural share | 93% | 92% (14,148, plus 136 unclassed) |
| pin-class tests (text pin, census, source scan) | 851 | 1,038 (538, 206, 294) |
| ticket-named files | 97 | 175 (180 counting `lin` without the hyphen) |
| whole unit suite, in parallel, operator's machine | 45 s | 33 s |

Test-estate's classifier (`scripts/survey-tests-shape.mjs`) was re-run unchanged. The suite
grew by a quarter in two weeks, yet it runs faster in parallel than on 30 September. The
reason is LIN-3158, which cleared the 25-second timer in `routes/proxy.js` that held four
files open (`routes/proxy.js:397`). The estate is still overwhelmingly behavioural. Its growth
since 30 September is behavioural tests, many of them LIN-3449's swap tests written into new
ticket-named files. Two commits have landed since `ebf93bd9`: LIN-3550 (#1887) adds one test file,
`scripts/code-shape/seams.test.mjs`, and edits `periodicals.test.js`, `lib/periodicals.js` and
`routes/proxy-compute.js`; LIN-3552 (#1888) is docs and evidence only. Neither changes a
finding.

### How much of the suite is needed?

**Most caught faults are caught by one file.**
- Two uniform samples of 300 one-line mutants were run, A and B (Method). The suite catches
  159 of A's 299 valid mutants and 145 of B's 300.
- Of the 304 caught, 178 (59%) are caught by exactly one test file. The median is one file,
  and nine in ten are caught by five files or fewer.
- Going down to single tests does not change this. Counting, in each killing file, only its
  deepest failing tests (so a describe block's own failure does not count beside the test
  inside it), the median caught mutant fails three tests, and 30% (91 of 304) fail exactly one.
- The redundancy that exists sits inside files, a few tests each re-checking the same thing.
  It is not spread across files.

**A small set chosen on one sample does not carry over to the next.** Greedy set cover, then
pruning, finds a set of files that catches everything the whole suite catches in a sample.
That set is then checked against the other sample:

| chosen on | files kept | share of 804 | catches of the other sample's caught mutants |
|---|--:|--:|--:|
| A | 99 | 12% | 80 of 145 (55%) |
| B | 88 | 11% | 84 of 159 (53%) |

Keeping files in greedy order (chosen on A), protection on B rises slowly:

| files kept | 10 | 20 | 40 | 80 (10%) | 99 |
|---|--:|--:|--:|--:|--:|
| catches, sample A (chosen on) | 30% | 45% | 63% | 88% | 100% |
| catches, sample B (held out) | 16% | 28% | 35% | 47% | 55% |

So the best 10% of files, picked with hindsight on 300 faults, keep 47% of the protection on
300 others. That is the direct test of the 90% hypothesis, and it fails. A random set is far
worse: 145 randomly chosen files catch a median of 31% of the pooled kills.

**The smallest sufficient set is a lower bound, and it keeps growing.** On random subsamples
of the 304 caught mutants, the cover needs:

| caught mutants in the subsample | 25 | 100 | 200 | 304 |
|---|--:|--:|--:|--:|
| files in the cover | 21 | 67 | 113 | 145 |

At 304 mutants it is still adding about one file for every three faults, and there are 21,020
mutant sites. Three estimates bound what the whole population of faults would need:

- **Files that are the only catcher of some fault.** 68 files are sole killers in A, 66 in B,
  and 17 in both. Capture–recapture (Chapman) puts the population at about 256 files, with a
  95% interval of roughly 170 to 340. Files that guard large modules are hit more often, which
  biases this estimate downward.
- **Files that catch anything:** 427 distinct files across the two samples, and still rising.
- **Line coverage.** Keeping every production line the suite executes needs 472 files (59%),
  and 448 files each execute a line no other file does. Coverage overstates what is needed
  where a file executes code without checking it. It understates it for browser code loaded
  into a `vm` sandbox, which coverage cannot see.

Read together, the protective core is between about 260 and 470 files, a third to three
fifths of the suite. It is not a tenth.

**simple-dispatcher shows the same shape, more sharply.**
- **Kills:** its unit suite kills 44 of the 50 curated mutants that target its own code, and
  35 of 42 fresh operator flips.
- **Exact minimum:** 13 files on the curated set, 15 on the fresh set, and 22 on both (14% of
  153 files).
- **Transfer:** a set chosen on one sample misses 23 of the other's 35 kills, or 27 of 44.
- **Growth:** the minimum is still growing by about 1.3 files per ten mutants.
- **Coverage:** line coverage needs 88 files (57%).
- **What it misses:** the six curated mutants its unit suite misses are the ones its system
  suite exists to catch.

**Test-estate's sample, re-drawn at HEAD, reproduces test-estate.** Its raw file is gone, so
the same rule was re-applied to today's lines (Method).
- **Logic:** 24 of 27 flips are caught (test-estate: 28 of 32). Behavioural tests catch 23
  (15 alone) and pin-class tests 9 (1 alone); test-estate had 27 (18 alone) and 11.
- **Survivors:** the same kind as test-estate's. Two `>` → `>=` flips on the length limits in
  `dispatch-validation.js`, and an `&&` → `||` in the kickoff's goal line.
- **Prose deletions:** 5 of 12 are caught (test-estate: 4 of 19), 4 by behavioural tests and
  2 by pins.

The set chosen on A keeps 18 of these 29 caught mutants, and the set chosen on B keeps 8.

### Checked against the real catches on record

Mutants are a model of faults. Every real unit-test catch on record whose code still exists
was therefore re-created at HEAD and run against all 804 files.

| catch on record | how it was caught | caught at HEAD by | kept by a 99/88/145-file set? |
|---|---|---|---|
| a `:root` token missing from the styleguide (PR #745) | CI | `render-styleguide.test.js` only | no |
| the privacy contact left empty (PR #1803) | CI | `render-legal.test.js` only | no |
| the runner prompt over its byte ceiling (PR #1870) | CI | `prompt-size-budget.test.js` only | no |
| wrong import path, module fails to load (`routes/flight-companion.js`) | session | 165 files | yes |
| backticks inside a template literal (`lib/proxy-instructions.js`) | session | 160 files | yes |
| an unescaped apostrophe (`lib/render-run-evidence.js`) | session | 187 files | yes |
| a Date-versus-number slip after a refactor (`lib/pipeline-loops.js`) | session | 3 files | yes |
| a result budget too small for its rows (`lib/chat-tools.js`) | session | `chat-tools.test.js` only | yes |
| a login subtitle leaking into the Projects picker (`lib/github-install-flow.js`) | session | `github-install-flow-golden.test.js` only | no |
| proxy mechanics leaking into a general prompt (`lib/periodicals.js`) | session | `periodicals.test.js` only | no |
| a raw `.credentials` read bypassing the accessor (`routes/account-merge.js`) | session | nothing: the census test that caught it was deleted on 12 October (LIN-3523) | — |

Every lean set chosen on mutants keeps 5 of the 10 catches still caught at HEAD, and loses
the other 5. Each lost one is caught by a single file that guards a property: a token census,
a merge-blocker, a byte budget, a golden HTML snapshot, a prompt-content rule. Random
one-line mutants seldom touch those properties. So the mutant measure undervalues guards. A
safe lean set is the mutant cover **plus** every guard that is the only check of its
property, and checking a cut against the real catches is not optional. A twelfth catch could
not be re-created: lazy SSE headers breaking an error path in `lib/flight-companion-turn.js`.

**The CI record shows no real product fault caught by a unit test since 1 June.**
- **What was read:** all 20 unit-job attempts the classifier marked as fixed in product code
  or prompt text, read by hand.
- **Guards or environment, seven events:** guards doing their job (the styleguide token
  census, the hermetic socket watcher, the merge-blocker, the runner-prompt byte budget) and
  the test environment (a 1 ms clock drift, an `unref` clash with the test runner).
- **Not catches, ten attempts.**
- **Test-estate's baseline:** its 13 unit "faults" hold up as no user-facing fault.
- **The browser specs:** e2e specs caught seven real faults on pull requests, and the unit job
  was green on the same commit each time.
- **Since 30 September:** unit-job reds have been pins, budgets and test updates. Flaky
  attempts fell from 66 to 2 after the flake work.

**Inside sessions: nine faults in six weeks.**
- **What was surveyed:** every retained session from 2 September to 13 October (15,306 test
  runs). Of the 128 candidate episodes where a unit test failed and a product edit followed,
  all were read.
- **Real catches:** 11, which are nine distinct faults:
  - four were load or syntax slips that any test importing the module catches;
  - three were behavioural;
  - one was a prompt-content pin;
  - one was a credential census.
- **The other 117:**
  - 54 were tests updated after an intended change;
  - 30 were tests written earlier in the same session;
  - 16 were probes;
  - the rest were noise.
- **The rate:** about one real catch for every 150 sessions that ran unit tests (1,399).

### What the rest is

145 files form the pooled cover. Of the 659 outside it, by kind (a file can fall into more
than one row):

| kind | files | lines | outside the cover | catch a sampled fault | only catcher of one | per-file run time |
|---|--:|--:|--:|--:|--:|--:|
| all | 804 | 286,278 | 659 | 427 | 117 | 100% |
| ticket-named | 180 | 44,766 | 161 | 88 | 12 | 27% |
| mostly pin-class tests | 47 | 12,575 | 45 | 11 | 2 | 9% |
| named as census, inventory or count pin | 16 | 4,179 | 16 | 1 | 0 | 6% |
| reads production source as text | 146 | 68,464 | 115 | 66 | 27 | 20% |
| loads browser code into a `vm` sandbox | 70 | 28,506 | 52 | 34 | 18 | 7% |
| tests of test helpers or fakes | 8 | 1,322 | 7 | 2 | 1 | 1% |
| executes no line another file does not | 356 | 85,191 | 324 | 156 | 24 | 44% |
| caught none of the 599 sampled faults | 377 | 85,497 | 377 | 0 | 0 | 44% |

Run time is each file run alone with coverage on, so it measures per-file overhead as well as
assertions.

- **Tests that repeat another file's check.** The commonest case. 324 files outside the cover
  execute no line that another file does not; most re-drive a seam another file already
  drives. The dashboard router, for example, is written out 46 times inside one file
  (`docs/reviews/code-quality-review-2026-10-12-tests.md:39`).
- **Ticket-named regressions.**
  - **Catch rate:** they catch a sampled fault about as often as other files (49% against
    54%), but are the only catcher less than half as often (7% against 17%). Each one re-drives a seam
    the home module's own file already covers.
  - **Where they matter:** the code-quality review found 18 production modules tested only by
    ticket-named files (`:184`), and those carry unique protection.
  - **Staleness:** none of 30 sampled is broken, but 28 of the 175 headers describe a moment
    that has passed. Six `lin-3124-pr3` checkpoint files say "dark until the write flip",
    though the flip landed the same day.
  - **Deletions:** only 15 have ever been deleted, all with a retired feature.
- **Pins of text, counts or source shape.**
  - **On mutants:** the 16 census-named files catch one sampled fault between them, never
    alone, and take 6% of per-file run time.
  - **On real catches:** two of the three CI catches re-created above are a token census and a
    byte budget, and only those files catch them.
  - **So pins are not surplus as a class.** A pin that is the only check of a property (every
    styleguide token, the prompt byte budget, a merge blocker) earns its place. A count of
    routes or credential sites that a behavioural test also exercises does not.
- **Tests of test helpers and fakes.** Eight small files (1,322 lines), such as
  `network-guard-sockets`, `test-server-listen-bind` and `liveness-fixture-integrity`. They
  guard the harness, not the product; the hermetic watcher they support made one of the CI
  catches.
- **Tests that check internals rather than behaviour at a seam.**
  - **Count:** 146 files read production source as text, 51 of them ticket-named. 66 catch a
    sampled fault and 27 are the only catcher, often because a source scan is the only thing
    that notices a deleted wiring line.
  - **Cost:** the cost of this class is rebuild cost, not run time. A scan fails when code
    moves, and the "fix" is to move the scan; test-estate found 6 of 12 source-scan "fixes"
    were exactly that.

### Why it accumulated

No single rule did it. The habit changed inside the ordinary pull request:

| | Jun | Jul | Aug | Sep | Oct 1–12 |
|---|--:|--:|--:|--:|--:|
| unit lines added per product line added | 0.59 | 1.15 | 1.68 | 1.98 | 1.71 |
| the same, median per PR | 0.56 | 1.19 | 1.89 | 2.09 | 2.00 |
| share of added test lines in ticket-named files | 0% | 0.3% | 13.9% | 20.7% | 30.9% |

- **Spread:** 1,204 tickets added unit-test lines since 1 June, and the top 20 account for
  only 17.6%.
- **Tests come with product changes:** only 3.5% of test lines came from test-only PRs.
- **Deletion is rare:** of 859 unit-test files ever created, 49 were deleted. 41 of those went
  in the two weeks from 28 September, every one with a retired feature.
- **No file has ever been deleted because another file already checked the same thing.** That
  is the "life of their own": every change adds tests, and no change removes them.

The candidate rules, with landing dates and what followed:

| rule | landed | what followed |
|---|---|---|
| implementation: "Write tests for new/changed behavior" (`lib/prompt-template-defs.js:895`) | 17 Jan | the baseline; the ratio was 0.25 |
| four rules in one week: simple-dispatcher's TDD rule (its CLAUDE.md, line 51), the bug template's acceptance witness (`:174`), characterization tests (`:900`), the close-out ledger (`:997`) | 16–29 Jun | the ratio doubled from 0.45 to 0.95 as the fleet started; the four cannot be told apart |
| none | Jul–Aug | the ratio kept climbing, 1.15 to 1.68, with no new rule: a habit compounding |
| "observe it fail" (`:898`) and the review's mutation check (`:977`) | 22–24 Aug | flat ratio (1.5–1.7) on doubled volume; "witness", "mutation" and "goes red" went from about 10% to 25–30% of new test text |
| simple-dispatcher's runtime-witness rule (its CLAUDE.md, lines 56–66) | 12 Sep | governs simple-dispatcher sessions only |
| the prompt-size freeze (CLAUDE.md:110, `a new lesson lands as code or a test first`) | 2 Oct | the ratio fell, 2.48 to 1.59; two test files name it |
| no rule: ticket-named files | first on 23 Jul | 0% to 31% of added test lines; the credential and grant migration (LIN-3124, 3125, 3130, 3134, 3136) wrote 57 of them |

The pieces fit together like this:
- **Test-first and witness habits** explain why each change brings tests.
- **The review's mutation check** explains some of the wording. It led 107 findings in 100
  tickets, 97 of them test or wording changes (`which-rules-pay.md:125-128`).
- **The prompt freeze** is not a driver.
- **The ticket-named convention**, which no rule asks for, explains where the tests go.

Harbour has no TDD rule and no runtime-witness rule of its own; those live in
simple-dispatcher's `CLAUDE.md`. Harbour sessions practise test-first anyway: 1,723
test-first reds across both repos' retained sessions.

### What the tests cost, set against what they caught

- **CI:**
  - **The unit job:** 0.38 minutes in early July, 5.18 in W41. It is now the slowest job,
    ahead of the slowest e2e shard (4.81).
  - **The double run:** the job runs the suite twice, the hermetic pass and the proxy-env
    pass. The workflow calls the second pass "~35s"; it now takes about 2.2 minutes.
  - **The whole run:** the median run went from 2.5–3.1 minutes in June and July to 5.3–5.6
    now. The step came in W33–W35, not in the last four weeks the stability review saw.
- **Edits forced on product changes:**
  - **Share of PRs:** since 1 September, 66% of product PRs modified existing test lines (49%
    since June), and the median product PR touched two existing test files.
  - **The most-edited files** are hubs (`dashboard-routes`, 26 tickets; `flight-companion-client`,
    25) and inventories (`proxy-endpoint-inventory-witness`, 22; `db-indexes`, 17;
    `proxy-di-witness`, 12).
  - **The pin tax:** `lin-3124-pr1-count-pins` was edited by four tickets in seven hours on 11
    October and by a fifth the next morning, every edit a decrement or a deletion.
- **Agent time:** in the retained window, Harbour sessions spent 41.6 hours waiting on test
  runs. That is 3% of active time overall and 14% in implementation sessions. Counting tests
  against product code, 43% of edit calls and 67% of the lines agents wrote went to tests.
- **Rebuild cost:**
  - **Harness copies:** 64 copies of an in-memory Mongo collection in 41 variants, and 156
    hand-rolled HTTP helpers, make a harness change a many-file edit
    (`code-quality-review-2026-10-12-tests.md:33`, `:35`).
  - **Fakes:** hand-written database fakes let tests pass while they are wrong (LIN-3534).
  - **Source scans:** 146 files read source as text, and each moves when the code does.
- **Against all that:**
  - nine real faults caught in sessions in six weeks, four of them load errors any importer
    would catch;
  - no real fault caught in CI since June;
  - 295 of 599 sampled one-line faults (49%) not caught at all.

  The suite's value is concentrated. 105 of the 117 sole catchers are files named after a module,
  not a ticket, and mostly behavioural, and a few guards are the only check of their property.

### What a lean suite would look like

The evidence supports trimming, not a 90% cut, and it supports changing the inflow more than
deleting the stock.

- **Keep the core.** That means every file that is the only catcher of a sampled fault or a
  real catch, and every module's own behavioural file. It also means the guards that are the
  only check of their property: the styleguide token census, the prompt byte budget, the merge
  blocker, the hermetic watcher, the golden snapshots. That is the 260–470-file core.
- **Fold ticket-named files into their home module's file**, keeping only cases the home file
  lacks. 168 of the 180 were never a sole catcher here.
  - **Safety:** fold one file at a time, and re-run the sample after each fold; nothing the
    suite caught may go uncaught.
  - **Stopping the inflow:** the code-quality review's open question, "tests go in the home
    module's own test file, created if missing" (`:184`), is the rule that would stop it.
- **Retire count pins that duplicate a behavioural check**, as LIN-3523 began. Keep a pin
  where it is the only check of an invariant. The raw-`.credentials` census LIN-3523 deleted
  had made a real catch two weeks earlier, so check each pin against the real catches before
  removing it.
- **Run the unit suite once in CI.** The second pass exists to exercise the proxy arm of the
  hermetic watcher. Either a single pass carrying both watcher arms, or a second pass limited
  to the files that open sockets, would save about two minutes a run.
- **Spend on the gap.**
  - **Overall:** half of sampled faults survive.
  - **Browser code is the thinnest:** 76% of `public/` mutants survive, against 34% in `lib/`.
  - **Server-side:** of the mutants on lines some test executes, a third (119 of 375) survive,
    executed but never checked.

The kill matrix in `test-surplus-mutants.json` and the real-catch mutants beside it are the
instrument for any of this. A deletion is safe when every fault the suite catches, and every
real catch, is still caught, re-checked on a fresh sample.

## Method

Everything ran at `ebf93bd9` in scratch worktrees outside this checkout. No test in the main
tree was edited, deleted or mutated. The scripts are in `test-surplus-scripts/`, and every
number above comes from the data files named in the front matter.

- **The protection measure is faults caught, read from mutants.**
  - **Definition:** a mutant counts as caught by a test file when the file fails on it and
    fails again on a confirming re-run.
  - **Why not coverage:** line coverage is reported alongside, but it is not the measure. A
    file can execute a line without checking anything about it. Coverage also cannot see the
    70 files that load browser code into a `vm` sandbox: 99 files cover no production line at
    all, yet 19 of them catch a mutant.
  - **Validating the measure:** mutants measure the outcome that matters, a fault going red.
    The real catches on record test whether the measure tracks real faults. It tracks the
    behavioural ones and misses the guards, so both are used.
- **Coverage.** `cover.mjs` runs each of the 804 unit-test files alone, six at a time, with
  `NODE_V8_COVERAGE`. That is the 803 in `tests/unit` plus `scripts/eval/eval-dense.test.mjs`,
  which `test:unit` also runs. It reduces V8's block ranges to covered lines of `lib/`,
  `routes/`, `public/` and `server.js`. Child processes inherit the variable, so spawned
  servers count.
- **Mutant sites.**
  - **Edits:** `sites.mjs` lists every line in those directories where one of three edits
    applies:
    - test-estate's operator flips: `===`↔`!==`, `>`↔`>=`, `&&`↔`||`, `return true`↔`false`
      and `??`→`||`;
    - deleting a single-line statement;
    - deleting one line of prompt prose inside a template literal (test-estate's prose rule).
  - **Population:** 21,020 sites in 429 files: 11,595 logic, 7,296 statement and 2,129 prose.
  - **Samples:** two samples of 300 were drawn uniformly with fixed seeds: A (3551) and B
    (1013, excluding A's sites). Mutants that fail `node --check` are dropped.
- **Test-estate's sample, re-drawn.**
  - **Why:** test-estate's raw mutant file was git-ignored and is gone.
  - **How:** `replica.mjs` re-draws the sample at HEAD by its own rule
    (`scripts/survey-tests-mutate.mjs`). That is eight evenly spaced operator flips in each of
    `dispatch-validation`, `credential-state`, `completion-signals` and the autopilot kickoff.
    It adds evenly spaced prose deletions in the autopilot kickoff, the runner kickoff and
    `prompt-template-defs.js`, where the template definitions now live.
  - **Caveat:** the lines differ from 30 September's; the rule is the same.
- **Running a mutant.**
  - **The run:** `mutate.mjs` applies one mutant, then runs every test file that could see
    it, each file alone, eight at a time. Each test has a 30-second timeout and each file a
    90-second budget; a file that hangs past its budget counts as a catch, as it would time
    out in CI.
  - **What "could see it" means:** the file covers the mutated line, or its source names the
    mutated file, or it scans production directories (29 files).
  - **Checking the shortcut:** twenty sample-A mutants were re-run against all 804 files. The
    confirmed catching files matched exactly, 20 of 20.
- **Confirmation.**
  - **The noise:** three unmutated runs of all 804 files, under the same load, showed up to
    two spurious file failures each (`http-keepalive`, `require-grant`, a `lin-3124`
    checkpoint file and `plan-review-round-trips-script`).
  - **The fix:** every catching file is re-run once more with the mutant applied, and only
    files that fail twice count.
  - **What it changed:** it removed spurious catches only in the 804-file runs, none in the
    targeted ones.
- **The smallest set.** `analyse.mjs` takes the confirmed kill matrix and does five things:
  - runs greedy set cover on one sample, then prunes any chosen file whose catches the rest
    still cover;
  - reports how much of the other sample that set catches;
  - plots the curve of protection against files kept;
  - computes the saturation curve: the size of the cover on random subsamples of the pooled
    catches;
  - estimates, with Chapman's form of Lincoln–Petersen, how many files are the only catcher of
    some fault, from the overlap of sole catchers between the two samples.

  It runs on the committed data: `node test-surplus-scripts/analyse.mjs
  test-surplus-mutants.json#A test-surplus-mutants.json#B` (add `--level test` for single
  tests, counting only each file's deepest failing tests). The kill matrix itself is not
  re-creatable from this page.

  `classify.mjs` joins each file's coverage, classifier output and catches.
- **Real catches.**
  - **CI:** the record was re-pulled with test-estate's own CI scripts. Every attempt fixed in
    product code or prompt text was read by hand.
  - **Sessions:** the record was re-surveyed with `survey-tests-local.mjs`, and all 128
    candidate unit-test episodes were read by hand.
  - **Re-creation:** each real catch whose code still exists at HEAD was re-created as a mutant
    (the fixing change reversed, or the same fault re-introduced) and run against all 804
    files.
- **History and cost.** Each source:
  - test growth, file births and deaths, the rules' landing dates and the edit cost per
    product PR: `git log` at first-parent (PR) level;
  - session waiting and edit shares: the retained transcripts, 2 September to 13 October;
  - CI times: the GitHub Actions API.

  Summaries are in `test-surplus-history.json`, and catch records in
  `test-surplus-catches.json`.
- **simple-dispatcher.** The same method, cheaply: its 50 curated mutants that target its own
  code, plus 42 operator flips across its six largest modules, against its unit suite, with an
  exact minimum cover.

## Limits

- **Mutants are a model of faults, not faults.** One-line flips and deletions are smaller than
  most real slips, and they rarely touch the properties guards check. The real-catch check
  shows both: the behavioural catches carry over, and the guard catches do not.
- **Each sample is 1.4% of the sites.** The smallest set is a lower bound that grows with the
  sample. That is why the saturation curve and the capture–recapture estimate are given, not
  just the cover.
- **Real catches are few.** Ten re-created catches, from six weeks of sessions and four months
  of CI, each judged by one reader with a spot check. 551 session episodes where the test
  never passed again were not read.
- **Kills are counted by file.** A file that crashes on import counts as a catch, and so does
  one whose single unrelated test fails. Going down to single tests was checked and does not
  change the answer.
- **The machine was shared and loaded.** Timings are shares, not absolute seconds. Spurious
  failures were removed by confirmation, not prevented.
- **"Never caught" is not "never matters."** A census that has never failed may guard an
  invariant nobody has broken yet. This paper sees catches, not deterrence.
- **A harness incident, corrected.** The first pass over sample A ran beside other mutant runs
  that wrote to the same report files, and 36 of its 300 outcomes were wrong. That pass was
  discarded and sample A re-run with per-process report files; every figure comes from the
  re-run.

## Next

These are questions this paper leaves open, not proposed work:

- **Which of the 168 non-sole ticket-named files are safe to fold?** Doing so needs the kill
  matrix at file level for those files specifically: a denser sample over the modules they
  re-drive.
- **What would a deliberate guard census look like?** It would list the properties only a
  pin checks (tokens, budgets, blockers, goldens), so that mutant-driven cuts never touch
  them.
- **Is the surviving half of faults a problem in practice?** That means following surviving
  mutant classes, such as browser code and executed-but-unchecked server lines, to real
  incidents.
