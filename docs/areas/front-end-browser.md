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
  list is a 404). A page imports one with a relative specifier that starts with ../lib/ (quoted in the code). The
  second is `lib/time-words.js` (LIN-4472): the duration and relative-time words, which the server and the task page both
  import; the page's own copies were removed, not kept under a parity test. That
  resolves to the same file in the browser and in Node only because `public/` is served at the URL root and stays flat,
  with no nested .js files (`tests/unit/front-end-import-layout.test.js`). Do not move `public/` under a prefix or add a
  subdirectory.
- One bridge, no new names: `public/cost-format-global.js` is the only module that writes a global for classic scripts.
  Its names, its one emitter and its classic readers are inventoried (`tests/unit/bridge-inventory.test.js`). A new name
  fails the check, and so does a registered reader that no longer reads, so the bridge only shrinks. A page that is a
  module imports the formatter directly and reads no bridge.
- A bridge reader reads the global only from a handler or callback that runs after DOMContentLoaded, never while its
  script executes: Chart.js calls scale tick callbacks synchronously. Its witness loads the reader first and installs the
  global after it (`loadCostFormat`, `tests/fixtures/browser-cost-format.js`), which is the order a page has. The inventory
  reads each witness's calls and fails a witness whose first `loadCostFormat(` comes before it loads the reader.
- A `{ module }` entry's place in a renderer's script list means nothing: a module runs after every classic script,
  wherever it is listed. A bridge reader is safe because of when it reads the global, not where the shim sits.
- A converted page is tested by plain `import` over the fake DOM (`tests/unit/helpers/import-world.js`), not by `loadWorld`.
  Each import is a fresh module instance, and the world puts every global back when it is restored. The classic-loader
  census (`tests/unit/classic-loader-census.test.js`) is a ratchet on the suites that still load classic scripts: it may
  only fall. `importWorld` installs only what it is given, unlike `loadWorld`: no stub `fetch`, `setInterval` or
  clipboard, and real timers unless `timers` is passed, so a page's init would reach the network or leave a poll
  running. Test pure exports by a static import; drive an init through one shared world with inert defaults
  (`tests/unit/helpers/task-page-world.js`, LIN-4472), made before the import so the page's DOMContentLoaded listener
  lands on the fake document. A suite that runs a classic file through `runClassic` counts, except `public/chart-helpers.js` and `public/close-out.js`,
  the two IIFE siblings a module page may read.

- A page module runs while `document.readyState` is already `'interactive'`, before DOMContentLoaded, so a module page
  that starts on DOMContentLoaded registers that listener unconditionally: its old `readyState === 'loading'` branch is
  false under a module and would start the page early. A top-level early return becomes `var mounted = ...` with the
  statements after it in `if (mounted) { }`: `var` stays module-scoped, and function declarations stay top-level and
  hoisted, as they were in the IIFE. (LIN-4463 piece 3, flight-companion.js.)

- A module's exports are its test seams, and a namespace is read-only. A classic getter/setter pair on the export object
  becomes a named function (`getOpenLoopIds`/`setOpenLoopIds` in `public/observation.js`); a `let` read through the
  namespace is live. Keep each export's name from the old seam where it can stay a function (`lastRulingsRef`); an accessor named after its own state gains a verb (`openLoopIds` → `getOpenLoopIds`), so a suite changes how it loads and not what it asserts.
  A suite reaches module state through the seam, never by a script-scope probe. (LIN-4463 piece 4.)
