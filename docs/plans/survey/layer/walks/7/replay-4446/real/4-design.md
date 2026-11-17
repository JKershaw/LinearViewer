# What this stage really wrote

## Added to LIN-4446 description by 14:24 (diff between the snapshots of 13:22:43 and 14:24:00; the session's last request was 13:25:44)

## Implementation Plan

**Plan status.** Re-grounded at HEAD `4b5001ddf`: `git log --since=2026-11-13T12:08:10Z` over every path named below is empty, so the two surveys (open-0, global) still describe the code. Area notes read: `docs/areas/README.md`, `docs/areas/front-end-browser.md` (its Lessons are 815 bytes of a 6144 cap; its Waiting entries are context, and the ones this slice touches are named in step 6).

### What this is for, and what done looks like

The ask: browser code that shares rather than restates, no build step, taken in small slices, the reading of the rule written into the project's notes, then a pause for John. John ruled the size: just the task, one cost formatter shared, no cuts (the size record above). Done is the ticket's own Done-when, restated as checks:

1. The reading of "no build step" (the browser may import natively, with its limits) is in `CLAUDE.md` and `docs/areas/front-end-browser.md`.
2. `lib/cost-format.js` is the only implementation of `formatUsd`: the browser runs those same bytes. `public/cost-format.js` and `tests/unit/cost-format-parity.test.js` are gone, and the PR names them as retired.
3. The PR says, in numbers, what got lighter (restated logic: the 34-line IIFE gone, replaced by a shim of a few lines) and does not count comments as lightening. It also says plainly that total repo lines may not fall, because the new guards are tests.
4. The builder then **stops**. No second slice starts before John has read the result.

Cuts to the `## As asked` block: **none**. Reworking a view "after finding out why it got so large" is not delivered here; that is John's size ruling (this slice touches no view), not a cut by this plan, and it goes to the area note as Waiting.

### Which way, and why

* **Serve the shared module through the existing allow-list in** `lib/vendor-assets.js`, as a second frozen map (`SHARED_MODULES`: URL → repo file; first entry `/shared/cost-format.js` → `lib/cost-format.js`), validated with `statSync` at boot like `VENDOR_ASSETS`. Set aside: a second `express.static('lib')` (would publish all server source); moving the file into `public/` (server `lib/render-*.js` would import from the web root, and the file would no longer sit with the code that owns it). `VENDOR_ASSETS` stays untouched because `tests/unit/vendor-assets.test.js` pins exactly its three URLs; sharing one router factory is fine, sharing one map is not.
* **Bridge to the classic scripts with a deferred module shim**, `public/cost-format-global.js`: imports `formatUsd` from `/shared/cost-format.js` and sets `window.CostFormat = { formatUsd }`. No view becomes a module, `common.js` and the `vm` loaders are untouched. Set aside: converting a consumer to a module (needs a module-capable client test loader, its own slice, per surveys); keeping `public/cost-format.js` as a thin wrapper (keeps a file whose name claims to be the formatter).
* `lib/components/page.js` **learns one thing: a** `scripts` **entry may be** `{ module: '/x.js' }`, emitted as `<script type="module" src>`; plain strings stay classic. Explicit beats sniffing a filename. The shim goes where `/cost-format.js` was in each list, so the read order of the lists is kept (a module still runs deferred wherever it sits).
* **Retirement is integral:** the restated formatter and its parity test go in the same PR as the sharing (the failed-consolidation pattern in `docs/papers/harbour/the-second-copy.md` §9–10).
* Fits the constraints already ruled: leaf modules only (no imports, no Node built-ins, no DOM at load); no wholesale `lib/` exposure.

### Where the behaviour lives (every place, in scope)

"The browser has its own formatUsd" lives in these places. How I know I have them all: `grep -rIn "cost-format\|CostFormat" . --exclude-dir=node_modules --exclude-dir=.git` outside `docs/reviews|papers|plans` (dated records, left as written) — repeat it after building; it must return only the intended new names.

* **Renderers listing** `/cost-format.js` **— five, not the two the brief names:** `lib/render-flight-companion.js`, `lib/render-observation.js`, `lib/render-swipe.js`, `lib/render-task-page.js`, `lib/render-workspace-kpis.js`. (The brief missed swipe, task-page and workspace-kpis; swipe and task-page load `prompt-section.js`, which reads `window.CostFormat`.) Left unfixed, those pages would 404 the script and throw `TypeError` on the first cost.
* **Consumers (read** `window.CostFormat` **— all four read it inside functions today):** `public/flight-companion.js:428`, `public/observation.js:3992`, `public/prompt-section.js:1506`, `public/workspace-kpis.js:134,138`. No change to them.
* **Golden:** `tests/fixtures/render-task-page-golden.json` embeds the script tags: regenerate it by the repo's own golden-update path, and read the diff to see only the script-tag change.
* **Test seams:** `tests/fixtures/browser-cost-format.js` (reads `public/cost-format.js`; used by `lin-3833-run-control` and `flight-companion-client`) — keep the name and `loadCostFormat(sandbox)` signature but make it set `sandbox.window.CostFormat` from the real `lib/cost-format.js` import, so those two suites do not change. `tests/unit/observation-scan-due.test.js:59` lists `'cost-format.js'` in `loadWorld` scripts — switch it to `loadCostFormat`. `tests/unit/cost-read.test.js` imports only the lib file; confirm it needs nothing (the brief lists it).
* **Census:** `tests/unit/cost-read-census.test.js` `FORMAT_ALLOW` drop `public/cost-format.js`, and the header comment and the failure-message text that name it. Silent-staleness note: nothing fails on an extra entry, so check by eye.
* **Comments and docs that name the twin:** `lib/cost-format.js` header ("The browser twin is…"), replaced by one line saying it is also served to the browser at `/shared/cost-format.js` and so must stay a leaf; `docs/architecture/source-map.md` (its `cost-format.js` line, and the `lib/vendor-assets.js` line if there is one, gain the shared route; run `tests/unit/docs-architecture-anchor-resolver.test.js`).
* **Not places:** `tests/unit/cost-format-parity.test.js`'s server-side assertions are not restating; see step 4.

### Steps, in order

1. **Docs first.** `CLAUDE.md` "no frameworks, no build step": add the reading and limits in a sentence or two (browser may import natively; shared modules are leaf modules served by allow-list, never by directory; classic-script views and `vm` loaders stay until a module-capable client test loader exists). Add the same as a Lessons entry in `docs/areas/front-end-browser.md`, with its reason (the copies came from reading the rule as "no sharing"). Keep Lessons under 6144 bytes. Check whether a CLAUDE.md census test pins its text.
2. **Serve it.** `SHARED_MODULES` + router mount in `lib/vendor-assets.js` (a `rootDir` option beside `nodeModulesDir` so a test can point it at a bad directory); `server.js` mount stays immediately before `express.static('public')`, as `vendor-assets.test.js` requires. Module scripts need a JavaScript MIME type: `sendFile` provides it for `.js`; the test asserts it.
3. **Shim and page emission.** `public/cost-format-global.js`; `page.js` module entries; change the five renderer lists; regenerate the golden.
4. **Retire.** Delete `public/cost-format.js` and `tests/unit/cost-format-parity.test.js`. The parity file also holds the only direct tests of `lib/cost-format.js`'s rules (the input table, "unknown never a dollar figure", "complete zero is $0.00", all of `sumWords`). Deleting them would loosen a guard, so move the server-side half unchanged into `tests/unit/cost-format.test.js` and drop only the comparison against the browser copy.
5. **Tests that make the new shape safe** (witnesses below), then update the census, fixture and `observation-scan-due`.
6. **Area note Waiting entries** (each starts with a `public/` or `lib/` path, no line numbers): (a) `public/common.js` — the globals it exports, and its self-declared "client twins" of `lib/task-page-href.js`, `lib/timeline-zoom.js`, `lib/ship-layout.js`, `lib/prompt-formatters.js` (the first two are leaf, same-shape next slices; the last two import other modules, so single-file serving will not do); (b) `tests/helpers/client-world`-style module-capable loader — cite `lib/components/page.js`'s classic-script emission and `tests/unit/helpers/client-world.js`: needed before any view becomes a module; (c) `public/observation.js` — find out why it is \~5,000 lines; count logic and comment separately. The two surveys disagree on its comment lines (open-0: \~1,985; global: 1,006); I reproduce 1,985 of 4,679 non-blank lines counting `*`, `//` and `/*` lines, so state the counting method in the entry. Existing entries on keepalive `statusCode` readers and `buildDispatchModelOptionDescriptors` are untouched.
7. **Report and stop.** PR text lists what is shared, what is retired (file and line counts), the lightening numbers with comments counted apart, and says the next slice waits for John.

### Witnesses (each fails before, passes after)

* **Shape of what is served:** a request to `/shared/cost-format.js` returns 200, a JavaScript content type, and exactly the bytes of `lib/cost-format.js`; `/shared/` anything else, and `/lib/cost-format.js`, return 404. Fails before: route absent.
* **Boot fails on a missing file:** the router built over an empty root throws, like the vendor one.
* **Purity rule (a test that tries what the guard is for):** every file in `SHARED_MODULES` has no `import` statement, no `node:` or bare-specifier reference, and no top-level `window|document|process|require`. Include a synthetic bad module that must be named, as `cost-read-census.test.js` does for its rules.
* **Ordering guarantee:** each of the four consumer scripts loads in the `vm` world with `window.CostFormat` *absent* and does not throw at load; then the global is set and the cost paths run and produce the same strings as before. Fails if a consumer ever reads the global eagerly.
* **Every page that needs the shim has it:** a test over `lib/` for each `public/*.js` file that mentions `window.CostFormat`, any `lib/` file whose scripts list names that file must also list the module shim, as `{ module: … }`. This catches a sixth page added later, and today's three the brief missed.
* **Page emission:** `renderPage` emits `<script type="module" src>` for a module entry and `<script src>` for a string; the task-page golden shows it.
* **Real browser (a** `vm` **cannot prove module order, MIME or CSP):** one Playwright check, on the cheapest existing spec whose page carries the shim (workspace KPIs or flight companion), asserting `window.CostFormat.formatUsd(0.004)` is `<$0.01`, with no console errors and no CSP violations. This also covers the hash-based CSP (`lib/security-headers.js`): `script-src 'self'` should admit a same-origin module, and the check is what confirms it.
* **The retirement itself:** `public/cost-format.js` and `cost-format-parity.test.js` absent; `FORMAT_ALLOW` has no `public/` entry; the existing census cases still fail a hand-made `$…toFixed` in a new `public/` file (the guard the parity file stood next to).
* Run the unit suites named (`lin-3833-run-control`, `flight-companion-client`, `observation-scan-due`, `cost-read`, `cost-read-census`, `vendor-assets`, `render-pages`, the docs anchor resolver) and the full unit run.

### Likeliest ways this breaks

1. **A page without the shim, or a consumer that reads the global at load.** The page works until the first cost shows, then throws in a handler. Covered by the page-has-shim test and the ordering test; the browser check confirms real timing.
2. **The module script is refused** (wrong MIME type, a CSP surprise, or the import URL not on the allow-list), so `window.CostFormat` never exists and nothing loud happens until a cost is drawn. Covered by the MIME/404 test and the real-browser check.
3. **A silent loosening:** deleting the parity file drops the server-side "never `$0.00` for an unknown" assertions. Covered by step 4's move and the retirement witness. A smaller one: the golden or `FORMAT_ALLOW` goes stale without failing.

### Session fit and review

`fits one session`. It is one shared piece, a handful of files and one real-browser check; I can name nothing one session would lose track of.
plan-review due: yes
Reason: it touches a guard-like surface (what the server publishes to the web, and a census that guards cost formatting), and sets a pattern (`SHARED_MODULES`, module script entries, the shim) that the next slices will copy. A second reader should check the purity rule and that no consumer reads the global at load before anything is built.

### Revision note

First plan for this ticket; no plan-review verdict in the comments.
