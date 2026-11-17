# What this stage really wrote

## Comment on LIN-4463 at 16:02:45

### Plan Review Verdict

**Verdict:** Approve. The plan's premises check out against main, and it meets the ask; the notes below are corrections the builder can make without changing what the plan decides.

**How it meets what was asked.** The ask says: "the slice 1 bridge is gone, or the only one left and shrinking under a check". The plan takes the second branch. `cost-format-global.js` stays the only bridge, with a bridge-inventory check, and drops from four consumers to three in piece 1. "One view at a time … whatever size is natural": the plan converts two views and lists the next ones in order. That is the ask's own grain, not a narrowing. "Waiting entries are settled, or say why not": all ten have a disposition. The brief's open question about Survey global ("retire cost-format-global.js at this task's cost") does not need John. The bridge has four classic consumers across six renderers, so converting one page entry cannot retire it, and the Done-when explicitly allows the "only one left and shrinking" outcome. The survey is advice, not a ruling.

**What I checked, at `5dcf5bcda`.** No file the plan touches has changed since the ticket was filed: `git log --since` over `public/ lib/ tests/ docs/ CLAUDE.md` shows only the merge `b708a9815`, which touches none of them.
- `SHARED_MODULES` is a one-route-per-file allow-list (`lib/vendor-assets.js`). There is no SPA fallback after `express.static`, so an unlisted `/lib/x.js` is a real 404. There is no `<base>` tag. CSP is `script-src 'self'` plus hashes. `public/` has no subdirectory `.js` files, so the flat rule holds today and `../lib/x.js` resolves the same way in the browser and in Node.
- `{ module }` emits `<script type="module">` (`lib/components/page.js:207`). `cost-format-global.js` is the only ESM file in `public/`.
- `workspace-kpis.js` reads only `__WORKSPACE_KPI_DATA__`, `HarbourCharts`, `Chart` and `CostFormat`. `common.js` and `app.js` set none of them, so running after them is safe.
- `task-page.js` reads classic globals only behind `typeof`/truthiness guards and assigns no `window.*`. It is the last entry in `SCRIPTS`, and its only load-time effect is one `DOMContentLoaded` listener (`:925`). So it converts without adding to the bridge, and its listener order is unchanged.
- The four `window.CostFormat` readers and six renderers match. There are ten Waiting entries; Lessons is 2,122 bytes. `CLAUDE.md:43` and `common.js:14` are as described. Node is v25 and `package.json` is `"type": "module"`, so a native `import()` with a `?v=` cache-bust works. `node --test` isolates each file in its own process, so globals a helper installs cannot leak between suites.

**Blocking findings:** none.

**Notes for the builder** (most important first)

1. **Witness 4 does not exist as described: rewrite it, don't just rerun it.** `tests/e2e/workspace-kpis.spec.js:211-227` asserts `window.CostFormat.formatUsd(0.004)` on the KPI page, and never looks at the cost axis. Piece 1 removes the bridge from that page, so the test as written fails with a TypeError. Replace it with a check that actually proves the new mechanism. It should assert all of these:
   - `/lib/cost-format.js` loads with 200 and a JavaScript MIME type (`page.waitForResponse`);
   - there is no `pageerror` and no CSP refusal;
   - the cost chart's y-axis formats with the shared formatter, e.g. `Chart.getChart(document.getElementById('chart-cost')).options.scales.y.ticks.callback(0.004) === '<$0.01'`.

   This is the only real-browser proof of a page module importing `../lib/`. If Playwright can't run in the session, write it anyway and say CI carries it.

2. **The import helper needs more than "fake DOM on globalThis"; build it in piece 1.** `task-page.js` uses bare `setTimeout`/`clearTimeout`/`setInterval`/`document`, and `window.api`. The suites the plan migrates depend on `loadWorld`'s `timers` collector and its window stubs:
   - `task-page-question.test.js:223` (`makePage`);
   - `task-timeline-client.test.js:207`;
   - `task-page-client.test.js:358/422/554`.

   `task-page-client.test.js:423` also runs the real classic `close-out.js` in the same world. Piece 1 has the same need: witness 3 needs `window.HarbourCharts`, which the current test gets by running the real classic `chart-helpers.js`.

   So the helper should take loadWorld's own `{ window, timers, globals }` options and install them on `globalThis`, with `window === globalThis` as loadWorld does. It should give one supported way to run a named classic sibling in that same realm (`vm.runInThisContext`), restore everything it replaced, and then import the page fresh. Its own test should cover both "two fresh imports share no state" and "globals are restored".

   The `loadWorld` census (witness 8) can't see complexity moved into this helper. Keep the helper small enough that each migrated suite reads shorter than before, and say so in the piece's description.

3. **Witness 6's timing predicate is wrong for two of the three consumers.** `observation.js` and `prompt-section.js` never branch on `readyState`. Their registered witnesses (`observation-scan-due.test.js`, `lin-3833-run-control.test.js`) prove the timing rule by loading the script first and installing the global afterwards; they never set `document.readyState = 'loading'`. Only `cost-format-consumers.test.js` (flight-companion) does. Use a predicate all three meet: the witness file loads the consumer and only then calls `loadCostFormat` from `tests/fixtures/browser-cost-format.js`.

4. **Keep the renderer-coverage half of the current shim guard.** `shared-modules.test.js:179-194` asserts that every script list naming a consumer also lists the bridge as a module. The new inventory check replaces the hard-coded strings, not this assertion. Piece 1 legitimately removes the bridge from `render-workspace-kpis.js`; this is the assertion that would catch an accidental removal from `render.js` and the others.

5. **Bridge discovery: scan the whole module, not just its top level, and match bare reads.** A `window.X =` inside a function in a converted module is just as much a bridge. On readers: `window` is the global object, so a classic file can read bare `CostFormat` as well as `window.CostFormat`.

6. **Witness 7 conflicts with a Waiting entry in another note.** `docs/areas/other-features.md`'s first Waiting entry has `lib/cost-format.js` as its first cited path, so `area-notes.test.js` check 3 fails once the file moves to a front-end area. Moving it settles that entry ("still in the catch-all"), so delete it and name it in what piece 1 retires. Read the `area-map-placement.test.js` pins first, as the plan says.

7. **`/shared/` references reach further than the plan lists.** Besides the allow-list, the bridge and its test, there are:
   - the comment in `lib/cost-format.js:12`;
   - `tests/unit/cost-read-census.test.js:15` and `cost-format.test.js:3`;
   - `tests/fixtures/browser-cost-format.js:3`;
   - `docs/areas/other-features.md:17` and `docs/areas/platform-and-plumbing.md:18`;
   - `docs/architecture/source-map.md:151,347`.

   The last one is outside witness 10's grep scope, so widen that scope from `docs/areas/` to `docs/`. Also update the source-map lines for `workspace-kpis.js`/`task-page.js` if they call them classic.

8. **Pins that will move.** `render-workspace-kpis.test.js:154` pins `/workspace-kpis.js` before `/common.js` by index. If the entry moves, update the pin to say what is true: a module's position in the list does not matter. `shared-modules.test.js:238` (`/lib/cost-format.js` is 404) flips to the 200 case. In piece 2, `lin-3975-task-run-control.test.js:586` and `no-page-wide-label-listener.test.js:247` read `task-page.js` source or the renderer's `SCRIPTS` as text; rerun them after removing the IIFE.

