# What this stage really wrote

## Comment on LIN-4446 at 13:18:12

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

