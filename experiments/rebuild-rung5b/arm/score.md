# Rung 5b score: page renderer cluster rebuild (LIN-3579, PR #1903, merge 1f8010a0)

Old = `f4749b91`. `git log f4749b91..1f8010a0 -- lib/render*.js lib/render-pages.js` lists only 1f8010a0, and
`git diff f4749b91 44528462` (the merge's first parent) is empty for those files, so old = f4749b91 = first parent
for the cluster. New = `git show 1f8010a0:lib/{render,render-session,render-swipe,render-settings,home-swipe-prompt-opts}.js`
in `arm/new/lib/`. The replay ran from `rung5b/replay` against `pinned/origin-main`, with n=3000 and `--coverage`, and
picked up the helper as a side-helper (render.js and render-swipe.js both import it).

## 1. Independent replay (seeds 1 and 7)

Reports: `arm/replay-seed1.json` / `.log`, `arm/replay-seed7.json` / `.log`. Each run had 19,856 inputs.

| | seed 1 | seed 7 |
|---|---|---|
| differing inputs | 3,740 | 3,718 |
| DOM-CONTRACT differences | **0** | **0** |
| throws (old/new) | 0 / 0 | 0 / 0 |
| export surface changes | 0 | 0 |
| env reads only-old / only-new | none / none | none / none |
| import side effects, network attempts | none, 0 | none, 0 |
| run page (`renderSessionPage` 2,913, `renderPrLine` 235) | 0 diffs | 0 diffs |
| swipe pure exports, small render exports, consent/error pages, constants | 0 diffs | 0 diffs |

Coverage of the new side (seed 1 and seed 7 are identical): `render.js` 465/465 lines, `render-session.js` 423/423,
`render-swipe.js` 335/335, `render-settings.js` 785/786 (99.87%; the uncovered line is the unreachable
`addProvider.blockedBy` reason, which is also the old side's only gap), helper 24/24.

### Difference groups

| # | group | seed 1 | seed 7 | before → after (one example) | class | reason |
|---|---|---|---|---|---|---|
| G1 | `renderDetailsContent` `span.detail-meta` #text | 324 | 325 | assignee `Eve <b>&"x'</b>`: old text `ENG-1606 · Eve` plus a live `<b>` element; new shows the literal `Eve <b>&"x'</b>` | **(a)** | PR fix 2: the meta line now escapes identifier, assignee and estimate. Pinned in `renderers-pins.test.js` (fails on base, passes on new). Real values are byte-identical |
| G2 | `renderPage` `span.detail-meta` #text (landing inline details; 5 signature groups by section) | 138 | 155 | `HAR-3043 · Eve` + `<b>` element → `HAR-3043 · Eve <b>&"x'</b> · 5 pts · due Jul 27` | **(a)** | Same root cause as G1, in landing-mode inline details |
| G3 | `orderIssuesForSwipe` data `$.value[].assignee` | 3 | 3 | sample `mock:periodicals*`: card at index k was a Periodicals row (`assignee null`) → is now a real issue (`"Alice"`) | **(a)** | PR fix 1: Periodicals rows are left out of Home's ordering, so the top task is marked again and the seed-only hint shows. Pinned (2 tests, both fail on base). Home's caller (server.js:1757, :3202) really passes Periodicals |
| G4 | `renderSwipePage` filter `<option>` #text (also `@value` and a removed Periodicals option) | 186 | 146 | `All (27)` / `Periodicals (16)` → `All (11)` / option gone | **(c)5** | Same change as G3, reached through the deck. server.js's swipe route calls `fetchAndPrepareProjects(workspace, teamId)` with no `urlKey`, and Periodicals are injected only `if (urlKey)` (server.js:1579). The landing deck uses `landingTrees`. So no caller produces this input; both sides return a page. The PR lists it as row 1c, (c)5 |
| G5 | `renderSettingsPage` whitespace-only:presence (5 signature groups, one site) | 3,089 | 3,089 | inside `details.dispatch-preset-kind-overrides`: `</div></div>` → `</div> </div>` | **(c)1** | Every Settings page is affected. A dumped page shows exactly 2 presence sites, both between two closing `</div>`s (block/block), so rendering doesn't change. Indentation runs differ as well. The PR lists this as row 3 |

Totals by class (seed 1 / seed 7):
- (a): 465 / 483
- (c): 3,275 / 3,235, of which (c)1 is 3,089 / 3,089 and (c)5 is 186 / 146
- **(b): 0 / 0**
- page-contract token changes: **0 / 0**

PR row 4 (error wording on malformed fuzz input, (c)3) did not occur: the replay's inputs produce no throws on either side.

## 2. Real-text display check (private corpus)

The replay ran in `--descriptions` mode on the 1,037-string private corpus, old vs new. Three render paths per
string make 3,111 renders. The input was streamed through a pipe and the report piped straight into
`arm/desc-count.mjs`, which emits counts only. No corpus text or rendered excerpt was written to disk or printed.
The result, in `arm/descriptions-counts.json`:

- **0 of 1,037 strings render differently** (0 of 3,111 renders), with 0 contract differences and 0 throws.
- The difference-kind breakdown is empty, since every render was equal.

## 3. Shape (kit `experiments/rebuild-exp1/kit/shape.mjs`; new: `arm/shape-new/*.json`; old: `arm/old-shape.json`)

| file | code lines | decision points | default-value DPs | functions | max nesting | worst functions (cyclomatic) |
|---|---|---|---|---|---|---|
| render.js | 579 → 465 (−19.7%) | 311 → 209 | 115 → 43 | 38 → 42 | 5 → 3 | renderDetailsContent 75, renderNode 56, renderPage 45 → renderPage 45, renderNodeHtml 45, renderDetailsContent 33 |
| render-session.js | 435 → 423 (−2.8%) | 228 → 202 | 40 → 41 | 34 → 41 | 2 → 2 | renderSessionPage 75, renderDecisionCard 23 → renderSessionPage 42, renderHeaderBody 30, renderDecisionCard 23 |
| render-swipe.js | 420 → 335 (−20.2%) | 184 → 128 | 23 → 23 | 47 → 60 | 5 → 3 | renderSwipePage 41, orderIssuesForSwipe 24, clusterByParent 21 → renderSwipePage 29, issueToCard 13, clusterByParent 11 |
| render-settings.js | 879 → 786 (−10.6%) | 194 → 145 | 54 → 34 | 51 → 74 | 1 → 1 | renderSettingsPage 39, renderDispatchDefaultRow 17 → renderSettingsPage 28, dispatchRow 14 |
| home-swipe-prompt-opts.js (new) | 0 → 24 | 0 → 9 | 0 → 5 | 0 → 3 | – → 1 | buildPromptOpts 10 |
| **total** | **2,313 → 2,057 (−11.1%)**; the four files alone 2,033 (−12.1%) | **917 → 693 (−24.4%)** | 232 → 146 | 170 → 220 | | functions ≥40: 4 → 3 |

- 86 of the 224-point decision-point drop (38%) is removed default parameter values, from render.js's single per-render
  `ctx` replacing threaded options. Without defaults, decision points fall 685 → 547 (−20.1%).
- Bytes went 217,845 → 169,763, and comment lines 1,516 → 1,040.

## 4. Run facts (PR #1903 and git)

- **Files changed: 6.**
  - The four renderers.
  - One helper, `lib/home-swipe-prompt-opts.js` (52 lines). It is imported only by `render.js` and `render-swipe.js`, and imports only `prompt-templates.js`.
  - One new test, `tests/unit/renderers-pins.test.js` (114 lines, 4 tests across 2 describes).
  - No existing test, fixture, caller, `public/` or CSS file was edited. **`public/llms.txt` is unchanged.**
  - `git diff --name-status 44528462 1f8010a0 -- tests` shows only `A renderers-pins.test.js`.
- **Pins fail on base:** with the f4749b91 renderers swapped into a temp worktree, 3 of 4 new tests fail (both Periodicals tests and the escape test). The real-values-identical test passes, as the PR says.
- **Source-text pins and golden at 1f8010a0:** run in a temp worktree with the repo's `node_modules` symlinked. 21 files, 540 tests, all pass, 0 fail. The 21 files:
  - `render.test`, `lin-3136-copy-surface-census`, `task-page-links`, `no-page-wide-label-listener`, `render-session-golden`, `email-import-boundary`, `lin-3125-held-entry`, `lin-3124-pr1-count-pins`
  - the 9 `lib/` scanners the ticket names
  - `renderers-pins`, `render-session`, `render-swipe`, `render-settings`
- **CI:** all 7 check runs succeeded on head `6c955960`: CI success, unit tests, E2E 1–4/4, secret scan.
- **Fixes listed in the PR:**
  - (a)1 Periodicals out of Home ordering; 1b is the onboarding hint, from the same fix.
  - (a)2 the meta-line escape.
  - Fuzz: (c)5 swipe with Periodicals (row 1c), (c)1 Settings whitespace (row 3), (c)3/(c)5 TypeError wording on malformed fuzz (row 4).
  - During its replay the PR also found and fixed one (b), the `buildWhy` destructuring.
  - Follow-ups filed: LIN-3586 and LIN-3587.
- **Replay fidelity:** every group my replay found is listed in the PR with the matching class. There are no unlisted differences.
- **PR inaccuracies:**
  - The PR names its base as `4ee0a2c7`, but the GitHub base is `44528462`. The renderer files are identical, so this is harmless.
  - The PR's own replay was lighter than the ticket asked: 1,000 inputs per heavy export, one seed, no DOM-parse tier, no coverage gate. The PR says this openly. This 2-seed n=3000 replay with coverage closes that gap.
- **Timeline:**
  - First launch 17:09Z, blocked by a wrong-checkout worker, aborted; relaunched 17:53Z.
  - A reboot around 18:25Z killed the worker's 3 background forks.
  - A forced follow-up at 19:50Z.
  - Commits at 19:50:30Z and 20:02:10Z, PR opened 20:03:32Z, merged 20:26:22Z.
  - Elapsed: 2h33m from relaunch, 3h17m from first launch.

## 5. Prediction vs result (`wt-branch/experiments/rebuild-rung5b/prediction-renderers.md`)

| prediction | result | verdict |
|---|---|---|
| Harbour doesn't split it (~65%) | One PR, 2 commits on one branch, no child tickets | **hit** |
| Merges (~65%) | Merged 20:26Z | **hit** |
| Done without a ruling (~35%) | No `DECISION:` was raised, but a human-forced follow-up (19:50Z) was needed to finish sequentially with a lighter replay | **hit** if "ruling" means a DECISION; **miss** if any human steer counts. I score it as a partial |
| 2–5 hours | 2h33m from relaunch (3h17m from first launch) | **hit** |
| Combined 1,750–2,150 code lines (7–24% cut) | 2,057 with the helper, 2,033 without (−11.1% / −12.1%) | **hit** |
| Settings is mostly copy/markup and doesn't shrink much | Settings −10.6%, against render −19.7% and swipe −20.2%; but the run page shrank least (−2.8%) | **partial**: the direction is right, but the least-shrunk file was the byte-pinned run page |
| Decision points down 15–30% | −24.4% (−20.1% excluding default values) | **hit** |
| The two worst functions both below 40 (~55%) | renderDetailsContent 75 → 33, but renderSessionPage 75 → 42; renderPage stays 45 and renderNodeHtml is 45 | **miss** |
| A shared helper module is added (~60%) | Yes, `home-swipe-prompt-opts.js`, but it shares the prompt vocabulary, not the predicted escaping, badges or row markup | **hit** (on the event; the predicted content was wrong) |
| The replay finds no page-contract change (~70%; coverage ≥99.9% per file) | 0 contract differences on both seeds. Coverage was 100% on three files and 99.87% on settings (the one unreachable line, so just under 99.9%) | **hit** (coverage bar is a near-miss only because of the unreachable line) |
| Some whitespace-only differences outside the run page (~50%) | 3,089 Settings pages, block-level only | **hit** |
| A visible regression ships (~25%, likeliest in raw values, local dates or in-place sort) | No (b) found. Raw values, `formatRelativeTime`/local dates and the in-place `sortIssuesForSwipe` all replay identically | **didn't happen** (the 75% side) |

## Notes for John

- The result is clean: 0 contract changes, 0 regressions, 0 of 1,037 real descriptions changed, and the run page is
  byte-identical. Every difference is one of the PR's two listed fixes or listed fuzz.
- Fix 1 is a **visible behaviour change on Home** for workspaces with Periodicals on: a top-task mark or onboarding
  hint now appears where none did. It is correct by the docblock ("cannot drift" from the deck), but users will see it.
- The Periodicals exclusion lives inside `orderIssuesForSwipe`, so the deck would also drop Periodicals if the swipe
  route ever started passing `urlKey` to `fetchAndPrepareProjects`. Today that input is unreachable (G4, (c)5).
- The complexity win is real but uneven. render.js's "one ctx" accounts for a large part of the decision-point drop
  (default values). The Home row and page functions (renderPage 45, renderNodeHtml 45) and the run page's
  orchestrator (42) are still the cluster's hot spots.
