# Ticket The front end, left better than we found it: browser code that shares rather than restates, in small slices

(as Harbour captured it at the start of this stage)

## Description

## As asked

**Repository:** JKershaw/LinearViewer (Harbour).

**What this is for.** John: "Side rail and other UI improvements are important purely because the current ones are just mostly the original ones and are due a bit of a sprinkling. But! The front end code is messy." And his gut: "the UI issues trace back to one of my very first rules: no build step… it's the biggest target of the Theseus method… We don't need to tidy it all, but it's a perfect example where we can leave it better than we found it. Likely this will take a fair amount of hand holding."

On main (9 Nov), no browser file can import another, nine browser files restate logic the server already has, and the largest browser file is 5,019 lines.

On the views, John: "Lots of light little views is ideal, but the cost of them has to be balanced… I'd be sad to get rid, but happy to tidy."

**What we want.**

* Browser code that shares rather than restates. There's still no build step and no framework: the rule stays, read as allowing the browser to import, as browsers do natively, and that reading goes into the project's own notes.
* Taken in small slices, one view or one shared piece at a time. Each view is reworked only after finding out why it got so large, and comes out lighter.
* Anything bigger that a slice spots is left out of it and goes into the area's note.
* The side rail and the visual refresh come after, built on the cleaner code.
* No view is retired unless John rules it.

John expects agents to reach for big moves here: "very likely to get agents trying really hard to do big things when we want small." So the size is John's call, and for this work it's small.

**Done when** the reading of the rule is in the project's notes; the first slice has landed, sharing rather than restating, lighter than before and naming what it retired; and John has read the first slice's result before the next starts.

**Every change names what it retires. Questions:** settle engineering questions yourself; only John's calls (product, money, authority, what to retire) go to him as rulings.

*End of what was asked. Steps write below this line; nothing above it changes.*

## Size of the move

**Size:** just the task
**Why:** The rule's reading goes into the notes and one cost formatter is shared with the browser, retiring its restated copy and parity check, then a pause for John; John ruled small, and no Survey finding must come first.
**Cuts:** none
**Decided by:** a ruling

## Implementation Plan

**Plan status.** Revised after the Plan Review Verdict (Request Changes, 1 blocking finding, 8 builder notes) at HEAD `4b5001ddf`, which is still `origin/main`. Re-grounded: `git log --since=2026-11-13T12:08:10Z` over every path named below is empty. I re-read the review's blocking claim in the source: `public/workspace-kpis.js` calls `charts.draw('cost', …)` at the top of its IIFE, `public/chart-helpers.js` `draw` does `new Chart(canvas, …)` synchronously, and the y-axis `ticks.callback` is `window.CostFormat.formatUsd(Number(v))` (`public/workspace-kpis.js:138`). The finding is correct. Area notes read: `docs/areas/README.md`, `docs/areas/front-end-browser.md` (2,734 bytes in all; Lessons well under the 6,144 cap).

### What this is for, and what done looks like

The ask: browser code that shares rather than restates, no build step, taken in small slices, the reading of the rule written into the project's notes, then a pause for John. John ruled the size: just the task, one cost formatter shared, no cuts (the size record above). Done is the ticket's Done-when:

1. The reading of "no build step" (the browser may import natively, with its limits) is in `CLAUDE.md` and `docs/areas/front-end-browser.md`.
2. `lib/cost-format.js` is the only implementation of `formatUsd`; the browser runs those same bytes. `public/cost-format.js` and `tests/unit/cost-format-parity.test.js` are gone and the PR names them as retired.
3. The PR says in numbers what got lighter (the 34-line browser IIFE replaced by a shim of a few lines), counts comment edits apart from logic, and says plainly that total repo lines may rise because the new guards are tests.
4. The builder then **stops**. No second slice starts before John has read the result.

Cuts to the `## As asked` block: **none**. Reworking a view "after finding out why it got so large" is not delivered here; that is John's size ruling (this slice touches no view's structure), not a cut by this plan. It goes to the area note as Waiting.

### Which way, and why

* **Serve the shared module through the existing allow-list**: in `lib/vendor-assets.js`, a second frozen map `SHARED_MODULES` (URL → repo file; first entry `/shared/cost-format.js` → `lib/cost-format.js`), validated with `statSync` at boot, with a `rootDir` option beside `nodeModulesDir` so a test can point it at an empty directory. The router factory may be shared; `VENDOR_ASSETS` stays a separate, unchanged map because `tests/unit/vendor-assets.test.js` pins exactly its three URLs. The mount stays immediately before `express.static('public')`. Set aside: a second `express.static('lib')` (publishes all server source); moving the file into `public/` (server renderers would import from the web root).
* **Bridge to classic scripts with a deferred module shim**, `public/cost-format-global.js`: imports `formatUsd` from `/shared/cost-format.js`, sets `window.CostFormat = { formatUsd }`. No view becomes a module; `common.js` and the `vm` loaders are untouched. Set aside: converting a consumer to a module (needs a module-capable client test loader, its own slice); keeping `public/cost-format.js` as a wrapper (a file whose name claims to be the formatter).
* `lib/components/page.js` learns one thing: a `scripts` entry may be `{ module: '/x.js' }`, emitted as `<script type="module" src>`; strings stay classic. Explicit beats sniffing a filename. The shim takes the place of `/cost-format.js` in each list.
* **The ordering rule, restated (this answers the blocking finding):** a module shim runs after parsing, so **no consumer may read** `window.CostFormat` **during script execution, including through a callback a library runs synchronously.** Three consumers satisfy this as they are (`public/flight-companion.js` reaches the formatter from its `DOMContentLoaded` handler; `public/observation.js` from `init` on `DOMContentLoaded`; `public/prompt-section.js` after a fetch). `public/workspace-kpis.js` does not: Chart.js's constructor lays out the scales and calls `ticks.callback` while the script first runs. **Fix at the cause:** run that file's IIFE body from a `DOMContentLoaded` listener (module scripts run before it). This changes when the page draws, not what it draws, and is not a view rework. Set aside: making the callbacks tolerate an absent formatter (would draw wrong ticks, silently), and making the shim a classic script (impossible: the import is the point).
* **Retirement is integral:** the restated formatter and its parity test go in the same PR as the sharing (the failed-consolidation pattern in `docs/papers/harbour/the-second-copy.md` §9–10).
* Shared modules are **leaves**: no imports, no Node built-ins, no DOM at load.

### Where the behaviour lives (every place, in scope)

"The browser has its own formatUsd, and pages load it as `/cost-format.js`" lives here. How I know I have them all: `grep -rIn "cost-format\|CostFormat" . --exclude-dir=node_modules --exclude-dir=.git`, ignoring dated records under `docs/reviews|papers|plans`; run again after building and read every hit. Checked at HEAD, the list below is every hit.

* **Six renderers list** `/cost-format.js` (the brief named two): `lib/render.js:384`, `lib/render-flight-companion.js:400`, `lib/render-observation.js:366`, `lib/render-swipe.js:149`, `lib/render-task-page.js:82` (declared as `const SCRIPTS`, not `scripts: [...]`), `lib/render-workspace-kpis.js:226`. All six get the shim entry.
* **Consumers of** `window.CostFormat`**:** `public/flight-companion.js:428`, `public/observation.js:3992`, `public/prompt-section.js:1506`, `public/workspace-kpis.js:134,138`. Only `workspace-kpis.js` changes in behaviour (above). The other three change **comments only**: `flight-companion.js:419-426` and `observation.js:3975-3976,3989` say "restated here / no module graph to lib/" and name `public/cost-format.js`; `prompt-section.js:1505` names it. Point them at the shim and drop the misleading reasoning; count these as comment edits.
* **Golden:** `tests/fixtures/render-task-page-golden.json` embeds the script tags. Regenerate with `UPDATE_RENDER_TASK_PAGE_GOLDEN=1`; read the diff, which must be only the script-tag change.
* **Test seams:** `tests/fixtures/browser-cost-format.js` keeps `loadCostFormat(sandbox)` (synchronous) but statically imports `formatUsd` from `lib/cost-format.js` and assigns `sandbox.window.CostFormat = { formatUsd }` (plain strings cross the vm boundary safely); drop `COST_FORMAT_SRC` (no other importer). `lin-3833-run-control` and `flight-companion-client` then need no change. `tests/unit/observation-scan-due.test.js:59` lists `'cost-format.js'` in `loadWorld` scripts: switch to `loadCostFormat`. `tests/unit/cost-read.test.js` imports only the lib file: confirm it needs nothing.
* **Census:** `tests/unit/cost-read-census.test.js` `FORMAT_ALLOW` (line 85), its header (lines 14-15) and the failure-message text name `public/cost-format.js`; remove them. Nothing fails on a stale extra entry, so check by eye.
* **Comments and docs naming the twin:** `lib/cost-format.js:12` ("The browser twin is…") becomes one line saying it is also served at `/shared/cost-format.js` and so must stay a leaf; `docs/architecture/source-map.md:149` and its `lib/vendor-assets.js` line gain the shared route (run `tests/unit/docs-architecture-anchor-resolver.test.js`).
* **Not places:** `tests/unit/cost-format-parity.test.js`'s server-side assertions are not restating (step 5).
* **Cannot be found by reading the code:** a page added later that reads `window.CostFormat`. The page-has-shim guard below catches it.

### Steps, in order

1. **Docs first.** `CLAUDE.md` is at 110/110 lines and 11,950/12,000 bytes (`tests/unit/claude-md-line-budget.test.js`). Rewrite line 43, "Keep it minimal - no frameworks, no build step", in place to a short reading (the browser may import natively; shared modules are leaves served by allow-list) plus a pointer to `docs/areas/front-end-browser.md` for the limits. If it goes over 12,000 bytes, trim elsewhere in the same commit and say in the PR which text went. Put the limits and the reason in a new Lessons entry in the area note: leaf modules only; served by allow-list, never by directory; classic-script views and `vm` loaders stay until a module-capable client test loader exists; consumers never read a shared global during script execution; the copies came from reading the rule as "no sharing". Keep Lessons under 6,144 bytes.
2. **Serve it.** `SHARED_MODULES`, `rootDir`, mount (see Which way). The route sends `.js` with a JavaScript MIME type; the test asserts it.
3. **Shim and page emission.** `public/cost-format-global.js`; `page.js` module entries; the six renderer lists; the golden.
4. **Fix workspace-KPI initialization.** Wrap the IIFE body of `public/workspace-kpis.js` so it runs on `DOMContentLoaded`; keep its early-return guards inside. Update its header comment to say why.
5. **Retire.** Delete `public/cost-format.js` and `tests/unit/cost-format-parity.test.js`. Move the parity file's server-side half unchanged (input table, "unknown never a dollar figure", "complete zero is $0.00", all of `sumWords`) into `tests/unit/cost-format.test.js`; drop only the comparison against the browser copy. Deleting those would loosen a guard.
6. **Tests that make the new shape safe** (witnesses below), then the fixture, census and `observation-scan-due` updates, the consumer comment edits, and the doc/comment updates above.
7. **Area note Waiting entries** (each starts with a `public/`, `lib/` or `tests/` path, no line numbers): (a) `public/common.js`: the globals it exports and its self-declared "client twins" of `lib/task-page-href.js`, `lib/timeline-zoom.js`, `lib/ship-layout.js`, `lib/prompt-formatters.js` (the first two are leaf, same-shape next slices; the last two import other modules, so single-file serving will not do); (b) `tests/unit/helpers/client-world.js`: a module-capable client-test loader is needed before any view becomes a module (cite `lib/components/page.js`'s classic emission); (c) `public/observation.js`: find out why it is about 5,000 lines. State the counting method: lines starting with `*`, `//` or `/*`, which gives 1,985 comment lines among 4,679 non-blank lines (I reproduced this). Say the global survey's 1,006 used a different method; do not set the two figures side by side. Existing keepalive `statusCode` and `buildDispatchModelOptionDescriptors` entries stay untouched.
8. **Report and stop.** The PR names the retirements (files and line counts), reports the 34-line IIFE against the shim, counts comment edits separately, says total lines may rise, notes any CLAUDE.md text trimmed, and says the next slice waits for John.

### Witnesses (each fails before, passes after)

* **Shape served:** `/shared/cost-format.js` returns 200, a JavaScript content type and exactly the bytes of `lib/cost-format.js`. Unknown `/shared/*` and `/lib/cost-format.js` return a real 404 **through the full** `server.js` **app**, not just the router, so a catch-all cannot turn them into a 200 HTML page. Fails before: route absent.
* **Boot fails on a missing file:** a router built with `rootDir` over an empty directory throws.
* **Purity (tries what the guard is for):** every file in `SHARED_MODULES` has no `import`, no `node:` or bare-specifier reference, and no top-level `window|document|process|require`, checked against code with comments stripped, not comment text (the new header mentions the browser). A synthetic bad module must be named, as `cost-read-census.test.js` does for its rules.
* **Ordering, the real one (fails at load today):** load `public/workspace-kpis.js` in `loadWorld` with `window.CostFormat` absent, `window.__WORKSPACE_KPI_DATA__` seeded with nonzero `cost.perDay`, and a `Chart` stub whose constructor synchronously calls each scale's `ticks.callback` (as Chart.js does). Loading must not throw. Then install the formatter, call `fireDOMContentLoaded` (`tests/unit/helpers/client-world.js:58`) and assert the tick labels are formatted. Note the file returns early when `typeof Chart === 'undefined'`, so a test without the stub proves nothing. The three other consumers get the lighter version: load with the global absent, no throw, then set it and run the cost path for the same strings as before.
* **Every page that needs the shim has it:** for each `public/*.js` that mentions `window.CostFormat`, every `lib/` file whose script list names it must also list the shim as `{ module: … }`. The parser handles both `scripts: [...]` and `const SCRIPTS = [...]`. It catches today's six and a seventh added later.
* **Page emission:** `renderPage` emits `<script type="module" src>` for a module entry and `<script src>` for a string; the task-page golden shows it.
* **Retirement:** `public/cost-format.js` and the parity test are absent; `FORMAT_ALLOW` has no `public/` entry; the census cases still reject a hand-made `$…toFixed` in a synthetic new `public/` file.
* **Real browser (a** `vm` **cannot prove module order, MIME or CSP):** one Playwright check on the cheapest existing spec whose page carries the shim, asserting `window.CostFormat.formatUsd(0.004)` is `<$0.01` with no console errors and no CSP violations (`lib/security-headers.js` `script-src 'self'` should admit a same-origin module; this confirms it). **It does not cover the Chart.js ordering fix:** `tests/e2e/workspace-kpis.spec.js:133-136` says priced lineages cannot be created through the app's API, so the cost canvas is always swapped for the empty note. The unit test above is the witness for that.
* Run `lin-3833-run-control`, `flight-companion-client`, `observation-scan-due`, `cost-read`, `cost-read-census`, `vendor-assets`, `render-pages`, `claude-md-line-budget`, the docs anchor resolver, the new tests, and the full unit run.

### Likeliest ways this breaks

1. **A page without the shim, or a read of the global during script execution.** Works until the first cost, then throws. Covered by the page-has-shim guard and the ordering tests (the Chart-stub test for the one known case).
2. **The module script is refused or never runs** (MIME, CSP, import URL off the allow-list), so `window.CostFormat` never exists and nothing is loud until a cost is drawn. Covered by the MIME/404 tests and the real-browser check.
3. **A silent loosening or stale guard:** the parity file's server-side assertions dropped; the golden, `FORMAT_ALLOW` or `CLAUDE.md` budget going stale or over. Covered by step 5's move, the retirement witness, the golden diff read and the budget test.

### Session fit and review

`fits one session`: one shared piece, a handful of files, one wrapped initializer and one real-browser check; I can name nothing one session would lose track of.
plan-review due: no
Reason: the plan was already reviewed once; that review found the pattern (allow-list serving, purity rule, shim) sound and said the plan is ready to build once the workspace-KPI deferral, the restated ordering rule and the Chart-stub witness were folded in, which they now are.

### Revision note

Revised in answer to the Plan Review Verdict (Request Changes). Finding 1 (blocking, `workspace-kpis.js` reads the formatter during load): agreed, verified in source; fixed by the `DOMContentLoaded` deferral (step 4), the restated ordering rule, and the Chart-stub witness; the Playwright check is explicitly not counted as covering it. Builder notes: 1 (sixth renderer `lib/render.js`) in the list and step 3; 2 (`const SCRIPTS`) in the guard; 3 (CLAUDE.md budget) in step 1, edit in place with limits in the area note; 4 (stale consumer comments) in the places list, counted as comments; 5 (purity guard ignores comments) in the purity witness; 6 (404 through the full app) in the shape witness; 7 (fixture imports statically) in test seams; 8 (observation counting method) in step 7. The review's other points (serving boundary, CSP, moving not deleting the parity assertions) are accepted as written. The `plan-review due` line moves from yes to no for the reason given.

## Comments

### Comment 2026-11-13T13:14:03.194Z

## Survey open-0: LIN-4446 @ 4b5001ddf

**Why this will be hard**

1. **"Allow the browser to import" doesn't turn imports on.** `server.js:1228` serves only `public/`, so the server modules a browser file restates (`lib/cost-format.js` etc.) have no URL. Sharing needs a served place for pure modules that both `lib/` and the browser import, plus a rule for it (no Node built-ins, no DOM at load). Without the rule, someone will import a module that pulls in `node:fs`. CSP `script-src 'self'` already allows module scripts loaded from a file.

2. **Every page is classic scripts talking through globals.** `lib/components/page.js` writes ordered `<script src>` tags, and files read `window.X` and top-level bindings from `common.js` (3,309 lines, on 29 pages). A classic script can't use static `import`. Making a view `type="module"` makes it deferred, strict and module-scoped, so its globals vanish for later scripts. "One view at a time" is blocked until what views read from `common.js` is reachable another way.

3. **The test harness assumes classic scripts.** 130 unit test files load `public/*.js` through `vm` (`tests/unit/helpers/client-world.js`, plus `runInNewContext` in the parity tests). None use `vm.SourceTextModule`. A browser file that gains an `import` line breaks all of them. That cost isn't in the ticket.

4. **"Lighter" is easy to fake.** About 1,985 of `observation.js`'s 5,019 lines are comments (ticket history, retuning stories), and 1,456 of `common.js`'s 3,309. Cutting comments passes a line count without sharing anything. The why-so-large check (68 commits on `observation.js`) should count logic and commentary separately.

5. **The ticket is a symptom, and the repo already says so.** `docs/papers/harbour/the-second-copy.md` §9–10 traces the copies to the no-build-step rule read as "no sharing". It shows that parity tests and helpers nobody was required to adopt kept the copies alive, and that only deleting the old copy ever finished a consolidation. A slice that adds a shared module and keeps the old copy or its parity test repeats that pattern.

**What I'd do first**

Write the reading of the rule into `CLAUDE.md:43` and `docs/areas/front-end-browser.md`, then take **cost-format** as the first slice:
- `lib/cost-format.js` (46 lines, no imports) becomes the one served shared module and stays importable by `lib/render-*.js`.
- **Retire** `public/cost-format.js` (a self-declared "restatement") and `tests/unit/cost-format-parity.test.js`.
- Its 4 consumers (`flight-companion`, `prompt-section`, `observation`, `workspace-kpis`) call `window.CostFormat` only inside handlers and render functions, never at load. A small module shim that sets `window.CostFormat` therefore runs early enough (module scripts run before `DOMContentLoaded`), and no view has to become a module yet.
- Update `cost-read-census.test.js:85` and the vm suites that name `cost-format.js`.

This settles where shared modules are served, the purity rule and the test path on a pure function before any view is touched. View size and `common.js`'s globals stay out of the slice and go into the area note. John's read of the first slice should be scheduled as a real pause.


### Comment 2026-11-13T13:18:12.132Z

## Survey global: LIN-4446 @ 4b5001ddf

**Where it lands.** `public/`: 79 files, 35,264 lines of JS, all classic scripts that share through `window.*` globals in the order `scripts: [...]` lists them in each `lib/render-*.js`. `common.js` (3,309 lines, 56 `window.` assignments) is the shared layer, and it already calls itself the "client twin" of `lib/task-page-href.js`, `lib/timeline-zoom.js`, `lib/ship-layout.js` and `lib/prompt-formatters.js`. `swim.js` copies `lib/swim-lanes.js`. Growth: 15.4k lines (1 Jul) → 29.1k (1 Oct) → 35.1k (9 Nov). That was about 1,200 lines a week in October and about 300 since 1 Nov. `observation.js` has held at about 5,000 since mid-October, with 1,006 comment lines out of 4,679 non-blank: mostly logic. The place has stopped getting worse but isn't getting better yet.

**The weight sits in the tests.** 126 unit suites run `public/` scripts through `vm` (`tests/unit/helpers/client-world.js`, `loadWorld`). A file that becomes a module with static `import` no longer runs in them, so the test harness enforces "no imports" as much as the browser does. Converting a view to a module drags its whole suite family along. That is the big move John is warning about.

**Done the obvious way** (cost-format as slice one):
- *Serving.* A second `express.static('lib')` would expose all server source. The codebase already has the right home: `lib/vendor-assets.js` is a frozen URL→file allow-list that runs `statSync` at boot so a missing file fails the boot. Extend it for shared modules and there stays one way to serve files from outside `public/`.
- *Transitive imports.* `lib/cost-format.js`, `task-page-href.js` and `timeline-zoom.js` have zero imports. `ship-layout`/`swim-lanes` import `providers/state-map.js`, and `prompt-formatters` imports six modules. Serving single files works only for leaf modules. Say so in the rule's note.
- *What would have to learn about it:* `cost-read-census.test.js` `FORMAT_ALLOW` names `public/cost-format.js` (stale silently: nothing fails on an extra entry). The two renderers that list `/cost-format.js` (`render-flight-companion.js:400` and `render-observation.js:366`) need it too. So do the `vm` suites that load it (`flight-companion-client`, `lin-3833-run-control`, `observation-scan-due`, `cost-read`) and the doc comment in `lib/cost-format.js` that names its "browser twin". The CSP already admits same-origin modules.
- *Ordering.* A module shim that sets `window.CostFormat` runs deferred, after the classic scripts. That is safe only while every consumer reads the global inside a handler, never at load. Pin that with a test, or a future eager read will break with no warning.

**Better, at a cost this task can carry:** the rule's reading goes in `CLAUDE.md` *with* its limits: leaf modules only; served by allow-list, not by directory; `vm` loaders stay as they are until a view is converted. Then cost-format, retiring `public/cost-format.js` and `cost-format-parity.test.js` together. `task-page-href`/`timeline-zoom` are the next leaf twins of the same shape.

**Better still, not this task's:** a module-capable client-test loader (`vm.SourceTextModule` or an equivalent) is what has to exist before any view becomes a module, and it is its own slice. After that come breaking up `common.js`'s globals and finding out why `observation.js` is as large as it is. The keepalive `statusCode` readers and `buildDispatchModelOptionDescriptors`, already in the area note, belong to that work.


### Comment 2026-11-13T14:27:54.348Z

### Plan Review Verdict

**Verdict:** Request Changes. The cost chart on the workspace KPIs page reads `window.CostFormat` while its script first runs, so a deferred module shim breaks it, and none of the plan's witnesses would catch it.

Blocking findings: 1

**How the plan meets what was asked.** It covers "the reading of the rule … goes into the project's own notes" (step 1). It delivers "browser code that shares rather than restates … one shared piece at a time" with one shared formatter, retiring `public/cost-format.js` and its parity test. It follows "every change names what it retires" and "John has read the first slice's result before the next starts" (step 7). The only narrowing is that no view is reworked in this slice. That comes from John's recorded size ruling ("just the task"), not from the plan. Reviewed at HEAD `4b5001ddf`, which is still `origin/main`; nothing has landed since the plan was grounded.

**What I checked and found sound.**
- Serving: `lib/vendor-assets.js` is a frozen allow-list that runs `statSync` at boot, and the router is mounted immediately before `express.static('public')` in `server.js`.
- CSP: `lib/security-headers.js` uses `script-src 'self'` plus hashes. That admits a same-origin module, and only HTML responses get the CSP and `nosniff`.
- `lib/cost-format.js` has no imports, so it is a leaf module and passes the purity rule.
- `renderPage` emits `<script src>` for each string entry (`lib/components/page.js:204`). The `scripts.includes('/common.js')` check is unaffected by object entries.
- The golden has its own update path: `UPDATE_RENDER_TASK_PAGE_GOLDEN=1`.
- The area note's Lessons section is about 700 bytes, well under its cap.
- The serving boundary is right: an allow-list, not a directory route.
- Moving the parity file's server-side assertions instead of deleting them is right; deleting them would loosen a guard.

---

#### Blocking

**1. `public/workspace-kpis.js` reads the formatter while the page is still loading. The plan's premise and its timing witnesses both miss this.**

The plan says all four consumers "read it inside functions today … No change to them", and the constraint rests on that ("consumers never reading `window.CostFormat` eagerly"). For three consumers this is true:
- `flight-companion.js` reaches `formatCost` only from its `DOMContentLoaded` handler.
- `observation.js` reaches `formatDueScanCostEstimate` from `init`, which runs on `DOMContentLoaded` (`:4867`).
- `prompt-section.js` reads it after the `panelNumbers` fetch.

Module scripts run before `DOMContentLoaded`, so all three are safe.

`workspace-kpis.js` is different. Its IIFE calls `charts.draw('cost', …)` at top level, while the script first runs. `chart-helpers.js:112` then calls `new Chart(canvas, config)` synchronously. In Chart.js 4.5.1, the version installed, the constructor calls `this.update()` when the canvas is attached (`node_modules/chart.js/dist/chart.js:5696-5698`). That lays out the scales and calls the y-axis `ticks.callback`, which is `window.CostFormat.formatUsd(Number(v))` at `workspace-kpis.js:138`.

That page's script order is `chart → chart-helpers → [shim] → workspace-kpis → common → app`. A module shim runs only after parsing finishes, so on any workspace with priced cost the result is a `TypeError` at load and no cost chart.

No witness in the plan sees this:
- **vm ordering test:** `workspace-kpis.js` returns early when `typeof Chart === 'undefined'`, so loading it with the global absent proves nothing.
- **Playwright check:** `tests/e2e/workspace-kpis.spec.js:133-136` says priced lineages "cannot be created through the app's dispatch API". In e2e the cost canvas is always swapped for the empty note, so "no console errors" passes even when the chart would break.

The bug would ship unseen, on the one page whose cost figure is drawn by a library callback.

**What must change:**
- Name `workspace-kpis.js` as the one consumer that needs a change. The smallest fix is to run its IIFE body from a `DOMContentLoaded` listener, which fires after module scripts have run. That changes when the page draws, not what it draws. It is not a view rework.
- Restate the constraint as "never read during script execution, *including through a callback a library runs synchronously*".
- Make the ordering witness for this file real. Load it in `loadWorld` with a `Chart` stub that calls each scale's `ticks.callback` inside its constructor, as Chart.js does. Seed `__WORKSPACE_KPI_DATA__` with nonzero `cost.perDay` and leave `window.CostFormat` absent; loading must not throw. Then install the global, call `fireDOMContentLoaded` (from `tests/unit/helpers/client-world.js`), and assert the tick labels are formatted.
- With today's code, this test fails at load. Leave the Playwright check as it is, but don't count it as covering this.

---

#### Notes for the builder (not blocking)

1. **There are six renderers, not five.** `lib/render.js:384` lists `/cost-format.js` and `/prompt-section.js`. This is the Home, backlog and landing page, the busiest one. The plan's description ("renderers listing `/cost-format.js`") already covers it, and both its repeat search and the page-has-shim guard would flag it. Add it to step 3's list so nobody has to discover it.
2. **The guard must read both list shapes.** `lib/render-task-page.js:82` declares its list as a `const SCRIPTS = [...]`, not `scripts: [...]`. The page-has-shim guard must parse both, or it misses the task page.
3. **CLAUDE.md is full.** It is at 110 of 110 lines and 11,950 of 12,000 bytes, enforced by `tests/unit/claude-md-line-budget.test.js`. Step 1's "sentence or two" won't fit as an addition. Change the existing "Keep it minimal - no frameworks, no build step" line in place to a short reading plus a pointer to `docs/areas/front-end-browser.md`, and put the limits in the area note's Lessons. If even that goes over, trim elsewhere in the same commit and say what was cut.
4. **Stale comments in the consumers.** The plan says "No change to them", but their comments become false:
   - `public/flight-companion.js:419-426` says "restated here rather than imported … no module graph to lib/" and names `public/cost-format.js`.
   - `public/observation.js:3975-3976, 3989` says the same.
   - `public/prompt-section.js:1505` names `public/cost-format.js`.

   The repeat search will flag the filename mentions. Point them at the shim, and drop the "no module graph" reasoning where it now misleads. Count these edits as comments, not as removed logic.
5. **The purity guard must not trip on comments.** The new `lib/cost-format.js` header will mention the browser. Have the guard look for top-level `window|document|process|require` in code, not in comment text. Prove it with the synthetic bad module, as the plan says.
6. **404 for other `/shared/` paths.** Unknown `/shared/*` and `/lib/cost-format.js` fall through to `express.static('public')` and then the app's routes. Assert a real 404 through the full `server.js` app, not just the bare router, so a catch-all route can't turn it into a 200 HTML page.
7. **The fixture works across vm contexts.** `loadCostFormat(sandbox)` can stay synchronous: import `formatUsd` statically at the top of `tests/fixtures/browser-cost-format.js` and assign `sandbox.window.CostFormat = { formatUsd }`. The function returns plain strings, so the main context and the sandbox can share it safely. `COST_FORMAT_SRC` has no other importers, so it can go.
8. **`observation.js` comment counts.** Keep the plan's stated method (lines starting with `*`, `//` or `/*`, out of non-blank lines) in the Waiting entry. Say that the other survey's 1,006 used a different method, rather than presenting the two figures side by side.

Once finding 1 is folded in (the `workspace-kpis.js` deferral, the restated constraint and the realistic Chart-stub witness), the plan is ready to build. Everything else above can be handled during the build.


### Comment 2026-11-13T14:36:13.975Z

### Plan Review Verdict

**Verdict:** Approve. The revision fixes the blocking finding at its cause (`workspace-kpis.js` now initialises on `DOMContentLoaded`, after the module shim has run), and nothing else in the plan would make the build go wrong.

**How the plan meets what was asked.** "The reading of the rule … goes into the project's own notes" → step 1. "Browser code that shares rather than restates … one shared piece at a time" → one shared formatter, retiring `public/cost-format.js` and `tests/unit/cost-format-parity.test.js`. "Every change names what it retires" and "John has read the first slice's result before the next starts" → step 8. The only narrowing is that no view is reworked. That comes from John's recorded size ruling ("just the task"), not from the plan. Reviewed at `4b5001ddf`, which is still `origin/main`. `git log --since=2026-11-13T12:08:10Z` returns nothing.

**Last verdict's points, and whether the answers hold.**
- **Blocking 1 (the KPI chart reads the formatter at load). Holds.** I re-read `public/workspace-kpis.js`: its only `CostFormat` reads are the tooltip and tick callbacks at lines 134 and 138, inside the `charts.draw('cost', …)` config. Wrapping the IIFE body in a `DOMContentLoaded` listener puts every one of those reads after deferred module scripts, imports included, have run. No unit test loads `public/workspace-kpis.js` today, so deferring it breaks no existing vm suite. `tests/unit/render-workspace-kpis.test.js:154` pins the script order, but `/cost-format.js` is not in that list, so swapping it for the shim leaves the test untouched. The restated rule ("never read during script execution, including through a callback a library runs synchronously") is the right one.
- **Notes 1–8.** All are folded in as written. I checked each against the source:
  - six renderers, with `const SCRIPTS` at `lib/render-task-page.js:82`;
  - `CLAUDE.md` at 110 lines and 11,950 bytes;
  - the stale consumer comments;
  - comment-stripped purity;
  - fixture `sandbox.window` (in `loadWorld`, `sandbox.window === sandbox`, and `flight-companion-client` passes its own `sandbox.window`, so assigning `sandbox.window.CostFormat` works for every caller);
  - the observation counting method.

**Also checked and sound.**
- Every browser call passes either no options or `{ fine: true }`, so the lib's destructured `{ fine = false } = {}` behaves exactly like the browser copy's `options && options.fine`. No call site passes `null`.
- `public/` is filed by `^public/` in `docs/areas/areas.json`, so the new shim needs no new area pattern.
- The acorn sweeps parse a file as a module first and fall back to a script (`public-element-method-guards`, `fake-dom-census`). A shim containing `import` passes both.
- The server mounts `createVendorAssetsRouter()` immediately before `express.static('public')` (`server.js:1227-1228`).

---

#### Notes for the builder (none blocking)

1. **The "full `server.js` app" 404 witness needs a real server.** `server.js` calls `app.listen` when it is imported (line 4674) and exports no `app`, so a unit test cannot import it. A hand-built router stack like the one in `vendor-assets.test.js:91` is not the full app. Two options:
   - Put the two 404 assertions (`/shared/nope.js`, `/lib/cost-format.js`) in the Playwright check, which already runs the real server.
   - Spawn `server.js` as `tests/unit/lin-619-session-secret.test.js:159` does.

   Either one gives the guarantee the plan asks for.
2. **Make the KPI Chart-stub test fail for the right reason.** `charts.draw` returns `null` before `new Chart` when there is no `#chart-cost` element (`public/chart-helpers.js:103-104`). That is the same trap as the `typeof Chart` guard. So:
   - Put a `<canvas id="chart-cost">` in the fake document.
   - Seed the whole `daily` shape the IIFE walks first: `days`, `dispatches`, `autopilotRuns`, `agentActions`, `done`, `doneTotal`, `runsByKind`.
   - Stub `getComputedStyle`, or `HarbourCharts`, because `chart-helpers.js:18` calls `getComputedStyle` at load.
   - When you check that the test fails on today's code, assert the error is the `CostFormat` `TypeError`, not a hole in the seed. The final "ticks are formatted" assertion already catches a missing canvas once the fix is in.
3. **State the real reason `prompt-section.js` is safe.** "After a fetch" is not a guarantee: a fetch started during parsing can resolve before a two-file module graph has loaded. The real guarantee is that every `PromptSection.init` caller runs at `DOMContentLoaded` or later:
   - `task-page.js:926` runs on `DOMContentLoaded`.
   - `app.js:2321` runs `init()` on `DOMContentLoaded`, and Home's prompt mounts happen after user-triggered fetches through `bindHomeFolds`.
   - `swipe.js:857` runs when the user opens the prompts section.

   Use that reason in the corrected comment at `prompt-section.js:1505`. Have that consumer's lighter test drive it through `init` and a resolved decision-panel fetch.
4. **`tests/unit/cost-format.test.js` does not exist yet.** Step 5 "moves" assertions into it, so create it. The parity file's `export const TABLE` has no importers, so deleting it strands nothing.
5. **One live hit is missing from the places list:** `docs/areas/other-features.md:14`, the Waiting entry saying `lib/cost-format.js` is still in the catch-all. It stays true, but once the file is served to the browser, a few words there ("also served as `/shared/cost-format.js`, so a leaf") stop the next reader from moving it without seeing that constraint. The repeat search will show it. The other new hits are server-side `import … from './cost-format.js'` lines in `lib/*`. They are not places and need no change.
6. **`CLAUDE.md` will need trimming.** It has 50 bytes spare. Any reading plus a pointer to `docs/areas/front-end-browser.md` will be longer than the 46 bytes of today's "Keep it minimal - no frameworks, no build step". Expect step 1's trim clause to apply, and name the cut text in the PR as planned.

Ready for `implementation` with these notes.


### Comment 2026-11-13T14:56:08.795Z

## Implementation: LIN-4446, slice 1 (cost formatter), PR ready for review

PR: https://github.com/JKershaw/LinearViewer/pull/2423 (branch `feat/lin-4446-shared-cost-format`, commit `24de9abc9`)

- The reading of the no-build-step rule is in `CLAUDE.md` and the front-end-browser area note (Lessons).
- `lib/cost-format.js` is the one formatter, served as `/shared/cost-format.js`. `public/cost-format.js` (34 lines) and its parity test are retired; the browser copy is now a 12-line module shim.
- `public/workspace-kpis.js` builds on DOMContentLoaded so the chart's tick callback never reads the formatter during script load.
- Evidence: the KPI ordering witness fails on the old code with the formatter TypeError; mutation checks, a real-browser check and the real-server 404s pass. Full unit suite 25,300 tests, 0 failures. CI green (unit, proxy, E2E shards, secret scan).
- No view is reworked or retired. Per the plan, the next slice waits for John's read of this one.

Raised for John: the PR describes what was cut (nothing) and the gaps (serving tests not run against HEAD; chart ordering not covered by e2e).

### Comment 2026-11-13T15:06:53.880Z

### Leftovers
- tidied: test comments that said the formatter loads before the page script (`tests/unit/lin-3833-run-control.test.js`, `tests/unit/flight-companion-client.test.js`) now say what each seam does; `loadChatUI` drops a formatter install chat.js never reads.
- tidied: `server.js`'s mount comment now names the `/shared/*` modules as well as the vendor libraries.
- tidied: the shim guard in `tests/unit/shared-modules.test.js` no longer asserts list position (a module runs after every classic script wherever it is listed).
- tidied: the purity rule is now spelled one way, as the guard enforces it (imports nothing, names no browser or Node global), in `lib/vendor-assets.js`, `lib/cost-format.js`, and the front-end-browser and other-features notes.
- tidied: the front-end-browser Waiting entry on `buildDispatchModelOptionDescriptors` gave "no build step" as its reason; now it says `lib/openrouter-catalog.js` is not a leaf.
- noted, front-end-browser: the `TERMINAL_TYPES` mirror in `public/common.js` of `lib/providers/models.js` (a leaf) still says `public/` cannot import it; folded into the `public/common.js` twins entry.
- noted, platform-and-plumbing: `lib/vendor-assets.js` and `createVendorAssetsRouter` are now named for less than they serve; a rename touches the mount string `tests/unit/vendor-assets.test.js` pins.
- Lesson added (front-end-browser): a `{ module }` entry's list position means nothing; test the order in a `vm` seam with `readyState = 'loading'`.
Retires: `docs/areas/front-end-pages.md` "`lib/render-swipe.js`: the viewport meta is `user-scalable=no`" (the swipe page now takes the shared viewport, with a test that failed before the fix)

PR: https://github.com/JKershaw/LinearViewer/pull/2423, head `1de016f523f46a006c20a4e89717157422b3207b`, CI green.

### Comment 2026-11-13T15:11:29.505Z

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


### Comment 2026-11-13T15:14:31.812Z

## Blind read
Verdict: better. Better: the USD formatter has one owner again. `lib/cost-format.js` is served as-is at `/shared/cost-format.js` through a separate, file-by-file `SHARED_MODULES` allow-list in `lib/vendor-assets.js`, so the hand-copied `public/cost-format.js` and its parity test are deleted, with guards for leaf purity, boot failure and the 404s. Worse: `public/cost-format-global.js` turns the formatter back into a global, which brings in a timing rule that nothing checks generally: each classic consumer may read `window.CostFormat` only after DOMContentLoaded. Four files now explain that rule in comments, and `public/workspace-kpis.js` had to move its whole build into a listener.

Read: https://github.com/JKershaw/LinearViewer/pull/2423 at `1de016f52` against `4b5001ddf`.

### Inside the area, fix-sized
- `tests/unit/cost-format-consumers.test.js` (front-end-browser, concerns `public/flight-companion.js`): the test title ("formatCost gives the browser copy's words") and its comment ("The browser copy's fine mode") name the browser copy this change deleted. Reword them to "the shared formatter's words".
- `tests/unit/cost-format.test.js` (other-features, concerns `lib/cost-format.js`): this is a new file, but its header says "The browser-copy parity comparison it used to carry is retired". It never carried that comparison. It also keeps `export const TABLE`, which nothing imports; the export is left over from the deleted parity test. Drop the sentence and the `export`.

### Inside the area, larger
- `public/cost-format-global.js` (front-end-browser): the module-to-global bridge is specific to this one module. The guard in `tests/unit/shared-modules.test.js` hard-codes the `SHIM` constant, the `'window.CostFormat'` string and the list of four consumers. The DOMContentLoaded-only rule is restated in `public/flight-companion.js`, `public/observation.js`, `public/prompt-section.js` and `public/workspace-kpis.js`, and per-consumer tests witness it, but no check covers a new consumer. A fifth consumer trips only the hard-coded list, with no hint about the timing rule. A second shared module would need a second shim and a second guard. This is larger than a fix because it needs a design decision on how classic pages take shared modules: one shim per module, a general shim, or turning consumers into modules.
- `public/ship.js` / `public/ship-biscuit.js` (front-end-browser): the change built a way to share code, but other browser copies in its area are still synced by hand, each with a comment saying so: `public/ship.js` ("mirror of lib/ship-layout.js") and `public/ship-biscuit.js` ("Kept in lockstep with lib/render-ship-biscuit.js"). This is larger because each lib side would first have to become an import-free leaf before it could join `SHARED_MODULES`.

### Outside the area
None.



# Facts computed from the task records at this moment

(open items with who must act, judgements and decisions with whether they still rest on the current version, areas and their open counts, and an index of other open records)

## 3. Addressed to it
finding-14 finding [open] v1 by survey-task to review in task-9
  says: "Lighter" is easy to fake: about 1,985 of `public/observation.js`'s 5,019 lines are comments (ticket history, retuning stories), and 1,456 of `public/common.js`'s 3,309. Cutting comments passes a line count without sharing anything. Judge "lighter" and the why-so-large check (68 commits on `observation.js`) on logic and commentary counted separately. (Survey @ 4b5001ddf.)
finding-20 finding [open] v1 by survey-place to review in task-9
  says: The comment count in finding-14 does not match mine: I count 1,006 comment lines out of 4,679 non-blank in `public/observation.js` (mostly logic), against finding-14's ~1,985 of 5,019. Before judging "lighter" on logic and commentary counted separately, settle one counting method (blank lines, block vs line comments, JSDoc) and state it in the verdict. (Survey place @ 4b5001ddf.)
  about → finding-14
finding-31 finding [open] v2 by design to review in task-9
  says: On the observation.js comment count: I reproduce finding-14's ~1,985, as 1,985 comment lines of 4,679 non-blank, counting every line that starts with `*`, `//` or `/*`. finding-20's 1,006 counts some other way. Use that method, or name another, when judging "lighter"; the area note's Waiting entry for observation.js states it.
  about → finding-14, finding-20
finding-47 finding [open] v1 by plan-review to implementation in task-9
  says: Correction to why prompt-section.js is safe (finding-34 and plan-28 (d) say after a fetch): a fetch started during parsing can resolve before a two-file module graph loads, so that is no guarantee. The real one: every PromptSection.init caller runs at DOMContentLoaded or later: task-page.js:926 on DOMContentLoaded; app.js:2321 init() on DOMContentLoaded, Home prompt mounts after user-triggered fetches via bindHomeFolds; swipe.js:857 when the user opens the prompts section. Use that reason in the corrected comment at prompt-section.js:1505, and drive that consumer witness through init and a resolved decision-panel fetch.
  about → plan-28
  on → plan-28@13, finding-34@2, finding-38@2
finding-48 finding [open] v1 by plan-review to implementation in task-9
  says: tests/unit/cost-format.test.js does not exist yet: step 5 moves the parity file server-side assertions into it, so create it. The parity file export const TABLE has no importers, so deleting the file strands nothing.
  about → plan-28
  on → plan-28@13, finding-29@2
finding-50 finding [open] v1 by plan-review to implementation in task-9
  says: CLAUDE.md will need trimming: 50 bytes spare, and any reading plus a pointer to docs/areas/front-end-browser.md is longer than the 46 bytes of today Keep it minimal - no frameworks, no build step. Expect step 1 trim clause to apply, and name the cut text in the PR as planned.
  about → plan-28
  on → plan-28@13, finding-37@2
finding-61 finding [open] v1 by review to close-out in task-9
  says: Before merge, PR #2423's body is stale after 1de016f52. Under 'What changed' add: 'Leftover-step retirement (LIN-4414): the swipe page now takes the shared default viewport (lib/render-swipe.js drops user-scalable=no; witness tests/unit/render-swipe.test.js), retiring the docs/areas/front-end-pages.md Waiting entry lib/render-swipe.js: the viewport meta is user-scalable=no.' Replace 'Total: 30 files, +747 / -280' with what gh pr view 2423 --json additions,deletions,changedFiles gives on the merged head (35 files at 1de016f). In 'Not covered', replace 'The serving tests were not run against HEAD' with 'Reviewer's mutation (serving lib/ as a directory) turns the spawned-server 404 witness red.'
  on → change-53@2
  about → change-53, verdict-60
finding-64 finding [open] v1 by blind-read to close-out in task-9
  says: tests/unit/cost-format-consumers.test.js (concerns public/flight-companion.js): the test title "formatCost gives the browser copy's words" and its comment "The browser copy's fine mode" name the browser copy PR #2423 deleted. Reword them to "the shared formatter's words". Fix-sized, before merge.
  about → change-53
finding-65 finding [open] v1 by blind-read to close-out in task-9
  says: tests/unit/cost-format.test.js (concerns lib/cost-format.js): a new file, but its header says "The browser-copy parity comparison it used to carry is retired"; it never carried that comparison. It also keeps export const TABLE, which nothing imports, left over from the deleted parity test. Drop the sentence and the export. Fix-sized, before merge.
  about → change-53, finding-48

## 4. What stands about this task
decision-26 decision [stands] v3 by scoping in task-9
  scope: task-9
  answer: Size: just the task. The rule's reading goes into the notes and one cost formatter is shared with the browser, retiring its restated copy (public/cost-format.js) and its parity check, then a pause for John. Cuts: none.
  why: Decided by a ruling: John ruled small in the ask ("the size is John's call, and for this work it's small"). No Survey finding must come first; common.js globals and view size are already kept out to the area (finding-12).
  on → finding-16@3, finding-12@1
  about → task-9
verdict-35 verdict [stands] v1 by plan-review in task-9
  of: plan-review
  outcome: request-changes
  reasoning: One blocker: finding-34 (workspace-kpis.js reads window.CostFormat at load through Chart.js tick callbacks; no plan witness sees it). Once it is folded in (deferral, restated constraint, Chart-stub witness) the plan is ready to build; the builder notes can be handled during the build. Meets the ask: rule reading in the notes (step 1), one shared piece retiring public/cost-format.js and its parity test, names what it retires, stops for John (step 7). The only narrowing, no view reworked, is John’s size ruling (decision-26), not the plan. Checked sound at 4b5001ddf (= origin/main): vendor-assets.js is a frozen allow-list with statSync at boot, mounted just before express.static(public); CSP script-src self plus hashes admits a same-origin module, CSP and nosniff only on HTML; lib/cost-format.js has no imports (leaf, passes purity); renderPage emits <script src> per string entry (page.js:204) and the scripts.includes("/common.js") check ignores object entries; golden updates via UPDATE_RENDER_TASK_PAGE_GOLDEN=1; area-note Lessons ~700 bytes, room; allow-list not directory is right; moving the parity file server-side half is right.
  on → plan-28@12, finding-34@1
  about → plan-28
  STALE: on plan-28@12, now @13
verdict-44 verdict [stands] v1 by plan-review in task-9
  of: plan-review
  outcome: approve-with-notes
  reasoning: Approve plan-28@13; ready for implementation. The blocker (finding-34) is fixed at its cause: workspace-kpis.js initialises on DOMContentLoaded, after the module shim. Its only CostFormat reads are the tooltip and tick callbacks (workspace-kpis.js:134,138) inside the charts.draw(cost) config; no unit test loads workspace-kpis.js today, and render-workspace-kpis.test.js:154 pins a script order that does not include /cost-format.js, so neither breaks. The restated rule (never read during script execution, including via a callback a library runs synchronously) is right. Builder notes finding-36 to 42 are folded in as written, each checked in source. Also sound: every browser call passes no options or {fine:true}, so the lib destructuring matches the browser copy; public/ is filed by ^public/ in docs/areas/areas.json, so the shim needs no area pattern; the acorn sweeps parse as module first, so a shim with import passes; server.js:1227-1228 mounts the vendor router just before express.static(public). Meets the ask: rule reading in the notes (step 1), one shared piece retiring public/cost-format.js and its parity test, names what it retires and stops for John (step 8); the only narrowing, no view reworked, is John size ruling (decision-26). Grounded at 4b5001ddf = origin/main, no commits since 12:08. Six non-blocking builder notes follow as findings to implementation.
  on → plan-28@13, finding-34@2, decision-26@3
  about → plan-28
verdict-60 verdict [stands] v1 by review in task-9
  of: review
  outcome: approve-with-notes
  reasoning: Approve PR #2423 at 1de016f52, conditional on close-out discharging the ledger (PR-body fix, John's read). Staleness: git log since 12:08:10 on every diff file is empty; the one main commit since the base (cfd152fa4, LIN-4453) is docs-only; MERGEABLE; CI green (unit, proxy/clock, e2e 1-4, secret scan, ci-success). Scope: matches plan-28's places one for one, plus plan-review note 5 (docs/areas/other-features.md); the swipe viewport fix is the leftover step's sanctioned retirement (docs/areas/README.md 'One home for each leftover', LIN-4414), Retires: names the front-end-pages Waiting entry and the diff removes it; no ruling needed. Regression: git log -6 on the touched files shows nothing reverted; LIN-4179's guarantees (one formatter, unknown never $0.00, no hand-made $...toFixed) hold; VENDOR_ASSETS unchanged and still mounted just before express.static(public). Witnesses: 13 focused suites 461/461 at 1de016f; 8 mutations each red then reverted (kpis wrap removed; shim dropped from render-task-page SCRIPTS; shim as classic string; top-level CostFormat reads in observation, prompt-section, flight-companion; node:fs import in lib/cost-format.js; express.static('lib') -> '/lib/cost-format.js should be a real 404, got 200'). Real browser (the one claim CI cannot reach, e2e cannot price a lineage): priced renderWorkspaceKpisPage behind real securityHeaders CSP and the shared router, Chromium + Chart.js 4.5.1: head ticks $0.00...$1.40, no page/console/CSP errors; main's workspace-kpis.js throws 'Cannot read properties of undefined (reading formatUsd)', ticks null. Test level right. Class: sibling restatements (common.js twins of task-page-href, timeline-zoom, ship-layout, prompt-formatters; TERMINAL_TYPES; buildDispatchModelOptionDescriptors; keepalive statusCode) are outside John's size ruling and already Waiting in the area note. Meets the ask sentence by sentence: lib/cost-format.js is the only formatUsd; no build step, native module, reading in CLAUDE.md:43 and the area Lessons; one shared piece; no view reworked (John's ruling, decision-26), none retired; retirements named (public/cost-format.js 34 lines, cost-format-parity.test.js 74); lighter: the 34-line IIFE becomes a 12-line shim (3 lines of code), totals rise only through tests. Non-Chromium untested; rollback is reverting the merge commit.
  on → change-53@2, plan-28@13, decision-26@3
  about → change-53, finding-55
verdict-63 verdict [stands] v1 by blind-read in task-9
  of: blind-read
  outcome: better
  reasoning: Read PR #2423 at 1de016f52 against 4b5001ddf. Better: the USD formatter has one owner again. lib/cost-format.js is served as-is at /shared/cost-format.js through a separate, file-by-file SHARED_MODULES allow-list in lib/vendor-assets.js, so the hand-copied public/cost-format.js and its parity test are deleted, with guards for leaf purity, boot failure and the 404s. Worse: public/cost-format-global.js turns the formatter back into a global, which brings in a timing rule nothing checks generally: each classic consumer may read window.CostFormat only after DOMContentLoaded. Four files now explain that rule in comments, and public/workspace-kpis.js had to move its whole build into a listener.
  on → change-53@2
  about → change-53

## 5. Its areas
area-1 Front end: browser code: 11 open addressed to it

## 6. Open runs sharing its paths
(none)

## 7. Index of what else is known
lesson-2 lesson → -: A page script's second request keeps the poll's discipline: coalesce every reason into one fetch per window, and stop when the poll stops (hidden tab, 401, revoked link). `createTimelineRefresher` (`public/task-page.js`, LIN-4405) is the pattern; a running chip changes the poll's track about once a minute, so "fetch when it changes" alone repeats. Done reads once more first (`finish`): the poll that says done carries the last change, and stopping drops it.
finding-12 finding → area-1: Every page is classic scripts talking through globals: `lib/components/page.js` writes ordered `<script src>` tags, and files read `window.X` and top-level bindings from `public/common.js` (3,309 lines, on 29 pages). A classic script cannot use static `import`; making a view `type="module"` makes it deferred, strict and module-scoped, so its globals vanish for later scripts. "One view at a time" is blocked until what views read from `common.js` is reachable another way. Bigger than a slice: kept out of LIN-4446's first slice, as is view size. (Survey @ 4b5001ddf.)
check-17 check → John: Read the first slice's result (the rule's reading in the notes, and the cost-format slice with what it retired) before the next slice starts.
change-53 change → -: PR #2423 (JKershaw/LinearViewer, branch feat/lin-4446-shared-cost-format): LIN-4446 slice 1. Shares lib/cost-format.js with the browser as /shared/cost-format.js through a 12-line module shim; retires public/cost-format.js (34 lines) and tests/unit/cost-format-parity.test.js; public/workspace-kpis.js now builds on DOMContentLoaded; rule reading in CLAUDE.md and docs/areas/front-end-browser.md Lessons. No view reworked or retired.
lesson-54 lesson → -: No build step, no framework, still; the browser may import as browsers do natively. Limits: shared modules are leaves (imports nothing, names no browser or Node global, as the purity guard enforces); served one file at a time through the lib/vendor-assets.js allow-list, never a directory; classic views and the vm test loaders stay until a module-capable client test loader exists; a deferred module shim sets its global after classic scripts run, so no script may read a shared global during script execution, including through a callback a library runs synchronously (Chart.js ticks). The copies came from reading the rule as no sharing. (In docs/areas/front-end-browser.md Lessons, PR #2423.)
lesson-57 lesson → -: A { module } entry in a lib/components/page.js scripts list runs after every classic script wherever it is listed, so its list position means nothing; do not assert position in a guard. Test the order in a vm seam with document.readyState = "loading" (tests/unit/helpers/client-world.js) instead.

