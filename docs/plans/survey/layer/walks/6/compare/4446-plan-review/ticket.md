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

