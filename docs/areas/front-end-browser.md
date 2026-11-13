# Front end: browser code

Area notes for `front-end-browser` in the registry. Format and rules: README.md.

## Lessons

- A page script's second request keeps the poll's discipline: coalesce every reason into one fetch per window, and stop
  when the poll stops (hidden tab, 401, revoked link). `createTimelineRefresher` (`public/task-page.js`, LIN-4405)
  is the pattern; a running chip changes the poll's track about once a minute, so "fetch when it changes" alone repeats.
  Done reads once more first (`finish`): the poll that says done carries the last change, and stopping drops it.
- Task-page CSS is phone-first at `min-width: 600px` (only the listed breakpoints pass `tests/unit/ui-authorities.test.js`),
  with `--font-size-*` tokens and no new mono selector (`tests/unit/lin-4107-type-sizes.test.js`).

- The no-build-step rule (`CLAUDE.md`) allows browser sharing, not only forbids it (LIN-4446). The browser may import
  natively, and the restated copies came from reading the rule as "no sharing" (`docs/papers/harbour/the-second-copy.md`
  §9–10). Pages become ES modules that import what they share (LIN-4471), converted top down: a page module before the
  files it uses. A module runs after every classic script, so it reads any classic global safely; a leaf converted first
  would have classic consumers and need a bridge. A lib twin retires when its last classic consumer converts.
- Shared leaves: a shared module is a leaf (it imports nothing and names no browser or Node global,
  `tests/unit/shared-modules.test.js`), served only through the explicit `SHARED_MODULES` allow-list in
  `lib/vendor-assets.js`, one route per file under the served /lib/ namespace, never by directory (a lib file not on the
  list is a 404). A page imports one with a relative specifier that starts with ../lib/ (quoted in the code). That
  resolves to the same file in the browser and in Node only because `public/` is served at the URL root and stays flat,
  with no nested .js files (`tests/unit/front-end-import-layout.test.js`). Do not move `public/` under a prefix or add a
  subdirectory.
- One bridge, no new names: `public/cost-format-global.js` is the only module that writes a global for classic scripts.
  Its names, its one emitter and its classic readers are inventoried (`tests/unit/bridge-inventory.test.js`). A new name
  fails the check, and so does a registered reader that no longer reads, so the bridge only shrinks. A page that is a
  module imports the formatter directly and reads no bridge.
- A bridge reader reads the global only from a handler or callback that runs after DOMContentLoaded, never while its
  script executes: Chart.js calls scale tick callbacks synchronously. Its witness loads the reader first and installs the
  global after it (`loadCostFormat`, `tests/fixtures/browser-cost-format.js`), which is the order a page has.
- A `{ module }` entry's place in a renderer's script list means nothing: a module runs after every classic script,
  wherever it is listed. A bridge reader is safe because of when it reads the global, not where the shim sits.
- A converted page is tested by plain `import` over the fake DOM (`tests/unit/helpers/import-world.js`), not by `loadWorld`.
  Each import is a fresh module instance, and the world puts every global back when it is restored. The classic-loader
  census (`tests/unit/classic-loader-census.test.js`) is a ratchet on the suites that still load classic scripts: it may
  only fall.

## Waiting

- `public/app.js`: Home's Running and Up next are refreshed by parsing a whole page with
  `DOMParser` (LIN-4243). Waiting on you is drawn as a server fragment by the page's own
  function (LIN-4242); doing the same for the other sections would mean the client never
  parses a whole page. (Survey tally: LIN-4243.)
- `public/common.js`: `buildDispatchModelOptionDescriptors` repeats the merge rule of
  `buildModelOptions` (`lib/openrouter-catalog.js`). That module is not a leaf (it imports
  `lib/catalog-rate.js`), so it cannot be served as one shared file (LIN-4446).
  The lists are not copied (they come from `window.__HARNESS_MODELS__` and the catalog over
  the wire); only the rule is. The endpoint could send merged options instead. (LIN-4358.)
- `public/brief.js`: its `postBrief`/`errorText` block is identical to `postRecap`/`errorText`
  in `public/recap.js`, and the check for a `statusCode` inside a keepalive 200 body is now
  written four times (also `public/scan.js` and `public/observation.js`). One shared reader
  in `public/common.js`. (Area reads CG/CH, 8 Nov, on LIN-4358.)
- `public/common.js`: exported globals, and the "client twins" of `lib/task-page-href.js`, `lib/timeline-zoom.js`,
  `lib/ship-layout.js` and `lib/prompt-formatters.js`. The first two are leaves of the same shape as cost-format, the
  next candidates; the last two import other modules, so serving a single file will not do for them. Its
  `TERMINAL_STATE_TYPES` mirror of `lib/providers/models.js` (no imports) is another leaf twin, and it retires when its
  last classic consumer converts (LIN-4471 corrected its comment to say so). (LIN-4446 plan and leftovers.)
- `public/ship.js` / `public/ship-biscuit.js`: still hand-synced copies ("mirror of lib/ship-layout.js", "kept in
  lockstep with lib/render-ship-biscuit.js"). Each lib side would first have to become an import-free leaf before it
  could join `SHARED_MODULES`. (LIN-4446 blind read.)
- `public/prompt-section.js`: the browser files reach their suites through `tests/unit/helpers/client-world.js`, which
  loads them as classic scripts through `vm`. The premise that a module-capable client loader is needed before a view can
  become a module is shown wrong by `tests/unit/workspace-kpis-module.test.js` (LIN-4471): a page module is tested by plain
  `import` over `tests/unit/helpers/import-world.js`. The remaining classic suites are counted by
  `tests/unit/classic-loader-census.test.js`. (LIN-4446; LIN-4471.)
- `public/observation.js`: about 5,000 lines. By the counting method of LIN-4446 (lines starting with `*`, `//` or `/*`)
  1,985 of its 4,679 non-blank lines are comments. Find out why it is this large before splitting it. An earlier survey
  used a different method, so its figure is not comparable. (LIN-4446 plan.)
- `public/llms.txt`: its H11 names the unscoped `/api/recommend/status`, which is now only a
  legacy redirect (`routes/legacy-redirects.js`), and its view list omits `projects` and the
  flag-gated `live-console` (`lib/components/view-nav.js`). The browser guide is otherwise sound:
  its endpoints and selectors resolve. (Documentation Review, 10 Nov.;
  `docs/reviews/documentation-review-2026-11-10.md`.)
- `public/prompt-section.js`: on a server with no AI (`aiState: "unconfigured"`, a self-host with no
  OpenRouter key) the run control still offers Next step. Pressing it gets a 503 from the recommend
  stream, and "AI Recommend · generating…" / "Loading…" spin with no message, while Run to PR works
  beside it. Offer only what the server can do, or say why it can't. (Onboarding & Cold-Start
  Review, 11 Nov.; `docs/reviews/onboarding-cold-start-review-2026-11-11.md`.)
