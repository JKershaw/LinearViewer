# What this stage really wrote

## Comment on LIN-4472 at 17:29:11

## Survey global: LIN-4472 @ 904719353

Read in LinearViewer at `904719353`. Piece 1 (LIN-4471) is merged there: `/lib/` serving, `import-world.js`, the classic-loader census (baseline 102), and `workspace-kpis.js` as a module.

**Where it lands.** `public/task-page.js` (959 lines) is one IIFE. Its 24-name `module.exports` seam is at `:931`, and its only load-time effect is the `DOMContentLoaded` listener at `:925`. Every cross-file read is `window.X` at call time, and it assigns no globals, so the conversion is mechanical. The area is improving: LIN-4292 and LIN-4304 removed guards and settled one spelling, and LIN-4471 left a working path to follow. Moving the last script in `SCRIPTS` to a module only changes timing in a way that doesn't matter here: a module runs after the classic scripts and before `DOMContentLoaded`. The golden diff is 7 identical tag lines, one per case.

**What the ticket's map misses.** Seven suites execute `task-page.js`, not three. The ticket's grep catches two of the extra four, but nothing points at either one:
- `lin-3975-proposal-refresh.test.js:232`: `loadWorld` plus `module.exports.proposalsUrlOf`.
- `lin-3975-task-run-links.test.js:213`: `vm.runInNewContext` over the whole file. This throws a SyntaxError once the file has `export`.
- `lin-3975-summary-and-time.test.js:59` and `lin-3975-task-run-control.test.js:587`: these cut source text using two-space-indented markers (`'  function relativeWords(value) {'`, `'  function init(doc) {'`, `'    function toggle(row) {'`). Taking out the IIFE and dedenting breaks them by giving `indexOf` a -1. "Rerun them" is not enough; they need rewriting. `relativeWords` should become an export that the test imports, not text it slices.

**Census forecast.** Expect a drop of about 2, not about 7. `task-page-client` and `task-timeline-client` can leave the list (`close-out.js` is an exempt `runClassic` sibling). `task-page-question` (`:311`, `question-cards.js`), `proposal-refresh` (`:161`, `task-chat.js`), `task-run-links` and `summary-and-time` (`common.js` slices) all still load other classic files, so they stay listed.

**The duplicates are there, but a name search won't find them.** Searching for function names that equal a `common.js` global or a lib export finds nothing real (`init` is a coincidence). The actual restatements have different names and are pinned as twins by tests:
- `formatElapsed` (`:302`) is `fmtDuration` (`lib/render-run-steps.js:258`), pinned by `task-run-links:211`.
- `relativeWords` (`:366`) is `relativeAgo` (`lib/task-page-loader.js:614`), pinned by `summary-and-time:57`.

Neither lib home is a leaf. Importing either one means pulling it out into a pure leaf and adding it to `SHARED_MODULES`, which is a serving change the ticket rules out. Say in the PR that they were found and left alone, and add a Waiting line next to the `ship.js` "lib side must become a leaf" entry. Don't report "no duplicates".

**Docs.** LIN-4471 already rewrote the Waiting entry (`front-end-browser.md:65`) to say the premise is wrong, so deleting it now finishes that job. `source-map.md` describes the routes and renderer, not `public/task-page.js`, so it probably needs no edit.

**Better, at this task's cost:**
- Migrate all six executing suites, not only the named three.
- Replace the indentation-keyed slices with export-based checks.
- Export `relativeWords` so its twin test imports it.

**Better still, not this task's:**
- One pure duration/relative-time leaf in `lib/`, served, so both client twins and their twin tests go away.
- Splitting `task-page-question` so the `question-cards.js` press test lives with its own script.

