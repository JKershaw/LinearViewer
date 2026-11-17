# What this stage really wrote

## Comment on LIN-4446 at 15:11:29

## Review — LIN-4446

Reviewed PR [#2423](https://github.com/JKershaw/LinearViewer/pull/2423) at head `1de016f523f46a006c20a4e89717157422b3207b` (two commits: `24de9abc9` the slice, `1de016f52` the leftovers), against `origin/main` `cfd152fa4`.

CI: green on `1de016f` (Unit tests, Unit tests (proxy, clock +400d), E2E shards 1–4, Secret scan, CI success).

**Staleness.** `git log --since=2026-11-13T12:08:10Z origin/main -- <every file in the diff>` is empty. The one commit on main since the plan's base (`cfd152fa4`, LIN-4453) is docs-only and touches no file here. PR is MERGEABLE.

**Scope vs plan.** The diff matches the plan's places one for one: six renderer lists, `page.js` `{ module }` entries, the `SHARED_MODULES` allow-list with `rootDir`, the shim, the `workspace-kpis.js` DOMContentLoaded wrap (6 logic lines with `-w`), retirement of `public/cost-format.js` and the parity test with its server-side half moved to `tests/unit/cost-format.test.js` (table, unknown→null, zero→$0.00, all of `sumWords`: checked line by line), the census `FORMAT_ALLOW`, fixture, `observation-scan-due` updates, and the consumer comment edits. It also covers plan-review note 5 (`docs/areas/other-features.md`). There is one addition beyond the plan: the swipe viewport fix (`lib/render-swipe.js` drops `user-scalable=no`, plus a test in `tests/unit/render-swipe.test.js`). That fix is the builder's leftover-step retirement, which `docs/areas/README.md` "One home for each leftover" (LIN-4414) requires. The `Retires:` line names the `docs/areas/front-end-pages.md` Waiting entry, and the diff removes it. That answers the brief's open question: it is a sanctioned retirement, not an overrun, and needs no ruling. The PR body does not mention it, though (fix 1 below).

**Regression check.** `git log -6` on `public/workspace-kpis.js`, `lib/render-swipe.js`, `lib/vendor-assets.js`, `lib/components/page.js` and `public/cost-format.js` shows no reverted or re-fixed behaviour. LIN-4179 (#2263) created the formatter, its census and parity test. Its guarantees (one formatter, unknown never `$0.00`, no hand-made `$…toFixed`) are intact: the census still runs with `lib/cost-format.js` as its only formatter file. LIN-3787's vendor router keeps `VENDOR_ASSETS` unchanged (pinned by `tests/unit/shared-modules.test.js` and `vendor-assets.test.js`), and it is still mounted just before `express.static('public')`.

**Tests I ran myself (at `1de016f`).** 13 focused suites: `workspace-kpis-cost-order`, `shared-modules`, `cost-format`, `cost-format-consumers`, `lin-3833-run-control`, `flight-companion-client`, `observation-scan-due`, `cost-read`, `cost-read-census`, `vendor-assets`, `render-swipe`, `claude-md-line-budget`, `render-workspace-kpis`. 461/461 pass. I did not re-run the full 25,300 suite; CI ran it on this head.

**Mutation checks (LIN-2274).** Each one was reverted afterwards, and the tree is clean.
- M1: `public/workspace-kpis.js` reverted to main (no DOMContentLoaded wrap). `workspace-kpis-cost-order` goes red, 0/2, at the tick callback `window.CostFormat.formatUsd`.
- M2: shim dropped from `lib/render-task-page.js`'s `const SCRIPTS`. The shim guard goes red: "lists a consumer without the module shim".
- M3: shim listed as a classic string in `lib/render.js`. The shim guard goes red.
- M4: `observation.js` reads `window.CostFormat` at top level. `observation-scan-due` goes red, 51/51.
- M5: `prompt-section.js` reads it at the top of its IIFE. `lin-3833-run-control` goes red, 45/46.
- M6: `flight-companion.js` reads it at the top of its IIFE. `cost-format-consumers` goes red, 2/2.
- M7: `import fs from 'node:fs'` added to `lib/cost-format.js`. The purity test goes red.
- M8: `app.use('/lib', express.static('lib'))` added to `server.js`. The real-server test goes red: "/lib/cost-format.js should be a real 404, got 200". This also settles the PR's "serving tests not run against HEAD" gap: the spawned-server witness distinguishes right from wrong.

**Real browser, the one claim CI could not reach.** The e2e workspace cannot create priced lineages, so CI never draws the cost chart. I rendered `renderWorkspaceKpisPage` with priced `cost.perDay` (`pricedCount: 2`) and served it behind the real `securityHeaders()` CSP, the vendor/shared router and `public/` static. I loaded it in Playwright Chromium with real Chart.js 4.5.1.
- Head: `window.CostFormat` is an object, and `Chart.getChart(#chart-cost).scales.y.ticks` are `$0.00 … $1.40`. No page errors, no console errors, no CSP refusal.
- Same page with main's `workspace-kpis.js` swapped in: `pageerror: Cannot read properties of undefined (reading 'formatUsd')`, and every tick label is null.

So the ordering fix works in a real browser with the real library and CSP, and the old code fails there. Script: `kpi-browser-check.mjs` in the reviewer's scratchpad. It can be re-run with `node kpi-browser-check.mjs [alt-workspace-kpis.js]` from the repo root.

**Test level.** Right for the change. The page emission and serving guards are unit tests with a real spawned server. Ordering has a vm witness with a synchronous Chart stub, plus the browser check above. Module/MIME/CSP has one e2e test (`tests/e2e/workspace-kpis.spec.js`). The e2e asserts only the global, not the chart, and the PR says so.

**Isolated, or one of a class?** The class is "browser file restates server logic because the rule was read as no sharing". Siblings exist: the `public/common.js` client twins of `lib/task-page-href.js`, `lib/timeline-zoom.js`, `lib/ship-layout.js` and `lib/prompt-formatters.js`; the `TERMINAL_TYPES` mirror; `buildDispatchModelOptionDescriptors`; the keepalive `statusCode` reader. All are **outside** this ticket's bounded class. John's size ruling bounds it to "one cost formatter shared", and the As-asked block makes the next slice wait for John's read. None of this deliverable depends on them. Their home is already written as Waiting entries in `docs/areas/front-end-browser.md` (LIN-4446 plan and leftovers), so nothing more needs filing. A repeat `grep cost-format|CostFormat` (excluding dated records) shows only the shim, the four consumers, tests, notes, and server-side `import … from './cost-format.js'` lines. No `/cost-format.js` script entry and no reference to the retired file remains. No other `user-scalable`/`maximum-scale` viewport exists in `lib/`, `public/`, `routes/` or `server.js`.

**Checklist.** No security exposure. `lib/` is served file by file through a frozen allow-list, and a missing or non-file entry fails boot. A spawned-server test proves `/lib/*` and unknown `/shared/*` return 404, and same-origin modules pass CSP. Error handling: `renderPage` throws on a malformed script entry. Style matches the codebase. Performance: one extra small module request per page with `max-age=0`+ETag, as for the vendor files. `CLAUDE.md` is 110 lines / 11,916 bytes, and the trimmed text is named in the PR.

### Fixes for close-out (on the PR branch / PR body, before merge)
1. **PR body is stale after `1de016f52`.** Under "What changed", add: "Leftover-step retirement (LIN-4414): the swipe page now takes the shared default viewport (`lib/render-swipe.js` drops `user-scalable=no`; witness `tests/unit/render-swipe.test.js`), retiring the `docs/areas/front-end-pages.md` Waiting entry `lib/render-swipe.js`: the viewport meta is `user-scalable=no`." Update "Total: 30 files, +747 / −280" to the figures `gh pr view 2423 --json additions,deletions,changedFiles` gives on the merged head (35 files at `1de016f`). In "Not covered", replace "The serving tests were not run against `HEAD`" with "Reviewer's mutation (serving `lib/` as a directory) turns the spawned-server 404 witness red."

### What CI Did Not Prove
- **inside**: the cost chart's DOMContentLoaded deferral works with real Chart.js, the module shim and CSP on a priced workspace (the claim this change depends on; e2e cannot price a lineage). **Discharged before merge** by the reviewer's real-browser check above. Head draws `$` ticks with no errors; main's `workspace-kpis.js` throws the `formatUsd` TypeError.
- **inside**: "John has read the first slice's result before the next starts" (Done-when, human only). **Settled after the deploy / before the ticket closes:** close-out asks John to read the PR's result (the comment on this ticket plus #2423's body). It records his read as a comment on LIN-4446 before marking Done. No next slice is dispatched until then. This is not a merge condition: merging is what "the first slice has landed" asks for.
- **inside**: the shim and formatter behave the same in non-Chromium browsers (Safari, Firefox). Only Chromium ran, in CI e2e and in my check, and module scripts plus a same-origin import are baseline in both. **Named rollback:** revert the PR's merge commit on main. That is fully reversible: no data shape, migration or third-party consumer changes, and `public/cost-format.js` comes back with the revert.

### Verdict
Approve — conditional on close-out discharging the ledger

How the work meets what was asked, sentence by sentence:
- "Browser code that shares rather than restates": `lib/cost-format.js` is the only `formatUsd`. The browser imports those same bytes from `/shared/cost-format.js`, and the restated IIFE is deleted.
- "There's still no build step and no framework … read as allowing the browser to import … and that reading goes into the project's own notes": no build step, no framework, native `<script type="module">`. The reading is in `CLAUDE.md:43` and the Lessons section of `docs/areas/front-end-browser.md`.
- "Taken in small slices, one view or one shared piece at a time": exactly one shared piece.
- "Each view is reworked only after finding out why it got so large, and comes out lighter": no view is reworked. That is a narrowing agreed by John's recorded size ruling ("just the task"), not by the plan. The `observation.js` size question is a Waiting entry.
- "Anything bigger that a slice spots is left out of it and goes into the area's note": common.js twins, a module-capable test loader, observation.js size and the vendor-assets name are all Waiting entries, none built.
- "The side rail and the visual refresh come after": untouched.
- "No view is retired unless John rules it": no view is retired.
- "Every change names what it retires": the PR names `public/cost-format.js` (34 lines) and `tests/unit/cost-format-parity.test.js` (74 lines). The leftover commit names the swipe Waiting entry; fix 1 puts it in the PR body.
- "Done when … the reading is in the notes" is met. "The first slice has landed, sharing rather than restating, lighter than before and naming what it retired" is met at merge: the 34-line IIFE becomes a 12-line shim (3 lines of code), and total lines rise only through tests, as declared. "John has read the first slice's result before the next starts" is ledger item 2.

