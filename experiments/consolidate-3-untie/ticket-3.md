TITLE: Seams: untie two knots by moving code to its owner (summarizeChecks → lib/github-pr-status.js; lib/home-swipe-prompt-opts.js → the pages area)

PARENT: LIN-3549 · PROJECT: Quality, Periodicals & Measurement · PRIORITY: High · STATE: Todo

**Goal.** Untie two Seams & Tangles knots by moving code to the area that owns its decision. The area map stays unchanged, and so does behaviour. Knots go 20 → 18 with no new knot.

**Why.**
* **The rule.** Code belongs to the area that would have to change if its rule changed. When a single import holds a knot, find the decision that import carries. Then move that decision to its owner, or invert the dependency. Don't edit the map.
* **Knot (b), Providers ↔ Runs & dispatch, 1 / 7.** At `d349e78c`, `node scripts/code-shape/seams.mjs /home/user/LinearViewer d349e78c scripts/code-shape/areas.json` shows this pair.
  * The one Providers → Runs import is `lib/pr-state-store.js:19` → `lib/run-evidence.js`, for `summarizeChecks`.
  * `summarizeChecks` (`lib/run-evidence.js:31-44`) reads GitHub's check-run conclusions and commit-status states through two vocabulary sets (`:24-25`).
  * `lib/github-pr-status.js:202-209` builds that same checks list from GitHub's API.
  * The rule that would change if GitHub's vocabulary changed sits in the run-evidence builder, not with the GitHub reader. So it is in the wrong area.
* **Knot (a), Front end: server-rendered pages ↔ Other features, 2 / 1.**
  * `lib/render.js:31` and `lib/render-swipe.js:24` import `buildPromptOpts` from `lib/home-swipe-prompt-opts.js`.
  * LIN-3579 (#1903) extracted that module so the computation "lives here once" (`:1-4`). No pattern in `scripts/code-shape/areas.json` names it, so it fell into the catch-all *Other features* area (`areas.json:64-66`, `^lib/`) and tied the knot. `experiments/periodicals-before-after/seams-before-after.md` records this.
  * The module decides what the pages' shared PromptSection widget shows (`:14`, `:32`, `:38-46`), and its only importers are those two pages. Its owner is the pages area.
  * The other direction, `lib/ship-journey.js:13` → `lib/ship-layout.js`, points from a user to the owner of the canvas-angle convention, so it stays.
* `docs/papers/harbour/theseus.md:25-26` describes this kind of knot: "A consolidation puts its one place in some area, and if that area is the wrong one it ties a knot."

**Decision.**
* **(b) Move the GitHub vocabulary to the GitHub module.**
  * Cut `summarizeChecks`, with its doc comment (`run-evidence.js:31-44`), and the two sets (`:24-25`) out of `run-evidence.js`.
  * Paste them unchanged into `lib/github-pr-status.js`, with the sets above the function. Leave no copy in `run-evidence.js`.
  * `lib/run-evidence.js` keeps using `summarizeChecks` (`:116`) through its existing import of that module (`:17`).
  * `lib/pr-state-store.js` imports it from `lib/github-pr-status.js`.
  * **The re-export is your call.** The preferred route is to point `tests/unit/run-evidence.test.js:13`, the only test that imports `summarizeChecks`, at `lib/github-pr-status.js` and add no re-export.
  * If you keep a re-export instead, state your reason in the PR. Write it as a plain `import` plus `export { summarizeChecks }`. Either form adds no new seams edge, because `run-evidence.js` already imports `github-pr-status.js` at `:17`. The plain form just keeps one import line.
* **(a) Move the prompt-options module into the pages area.**
  * Move `lib/home-swipe-prompt-opts.js`, whole, to a path the pages area already owns. `lib/render-prompt-opts.js` fits `areas.json:12` (`render[^/]*`).
  * If you find a name that reads better, it is fine as long as it matches an existing pages pattern. Check that seams agrees.
  * Use `git mv`, update the two importers, and leave no shim at the old path.
* **What stays untouched.**
  * No edits to `scripts/code-shape/areas.json`.
  * Don't touch `lib/ship-journey.js` or `lib/ship-layout.js`.
  * Leave every historical mention of the old path alone (`docs/papers/` and `experiments/`).
  * No doc or census lists the module, so `docs/architecture/source-map.md` and `llms.txt` need no edit.
* **No behaviour change.**
  * No function body changes.
  * Keep every ticket reference and reason comment beside the code it governs. They move with it.
  * **Existing tests.** Show behaviour is unchanged with the tests that import the changed modules: `run-evidence`, `run-evidence-seams`, `pr-state-store`, `github-pr-status`, `authenticated-pr-reads`, `task-page-loader`, `task-page-finished-story`, `render`, `render-swipe` and `home-top-task-parity`.
  * **The replay.**
    * Take the old sets and function text from `git show origin/main:lib/run-evidence.js` (lines 24-25 and 31-44) into a scratch script.
    * Import the new `summarizeChecks` from `lib/github-pr-status.js`, and compare the outputs on the same inputs. Include GitHub's conclusion and status values, mixed lists, empty input and non-arrays.
    * Don't commit the replay. Paste the script and its output into the PR.
* **Verify the untie.**
  * Commit first. `seams.mjs` reads the git object store, not your working tree.
  * Run `node scripts/code-shape/seams.mjs . origin/main scripts/code-shape/areas.json` and `node scripts/code-shape/seams.mjs . HEAD scripts/code-shape/areas.json`, both with the same `areas.json`.
  * Paste into the PR: the knot count before and after, the two knot lines before and their absence after, and the pair counts of every knot that changed.
  * **Expected knot changes.** pages ↔ LLM & prompts goes 14 / 7 → 15 / 7, LLM & prompts ↔ Other features goes 2 / 3 → 2 / 2, the two knots disappear, and no other knot pair or group changes. These numbers are at `d349e78c`; if `origin/main` has moved, the same deltas apply.
  * **Expected changes outside the knots.**
    * Four `links` change: pages → LLM 14 → 15, pages → Other 2 → gone, Other → LLM 3 → 2, and Providers → Runs 1 → gone.
    * Area sizes change: pages goes from 68 files / 219 internal imports to 69 / 221, and Other features from 10 files to 9.
    * Entry files change:
      * `lib/home-swipe-prompt-opts.js` leaves Other features' entry files.
      * `lib/run-evidence.js` loses Providers as an importing area (4 importers → 3).
      * `lib/prompt-templates.js` loses Other features as an importing area.
  * If any other knot pair or group changes, or a new knot pair appears, stop and say so in the PR rather than working around it.

**This is one PR. Don't split it into child tickets.**

Don't start parallel forks or background sub-agents; do the parts one at a time. While iterating, run the unit tests for the files you change; run the full unit suite once before opening the PR. Leave e2e to CI; run it locally only to reproduce a CI failure.

No live checks; no paid model calls.

**Done when.** Merged with `ci-success` green, and the PR showing the seams output before and after: both knots gone and no new knot.

**Out of scope.** The other five knots that hang on a single import, and every other knot. The area guide, `scripts/code-shape/areas.json`.
