# Front end: browser code

Area notes for `front-end-browser` in the registry. Format and rules: README.md.

## Lessons

- A page script's second request keeps the poll's discipline: coalesce every reason into one fetch per window, and stop
  when the poll stops (hidden tab, 401, revoked link). `createTimelineRefresher` (`public/task-page.js`, LIN-4405)
  is the pattern; a running chip changes the poll's track about once a minute, so "fetch when it changes" alone repeats.
  Done reads once more first (`finish`): the poll that says done carries the last change, and stopping drops it.
- Rows painted in two hosts (the waiting block, the Rulings tab) share one keyed node map: a rebuilt row detaches its old
  node from whichever host holds it, or the stale one stays painted there (`public/observation.js`, LIN-4541).
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
- The bridge is at zero (LIN-4463 piece 5): no module writes a global for classic scripts. A module may write one only
  as a declared e2e hook (`window.refreshWaitingOnYou`), which no classic script reads; `tests/unit/bridge-inventory.test.js`
  fails on any other write. When a classic script still reads a function a converting file declares, move the function to
  `public/common.js` (as `updateQueueBadge` moved) or convert the reader first; never bridge it back.
- A module's place in a renderer's script list means nothing: it runs after every classic script, so on a page where a
  classic page script follows it, that script now runs first and its DOMContentLoaded listener registers first. Check each
  such page reads nothing the module sets up, and witness it in a browser (`tests/e2e/lin-4463-app-module-pages.spec.js`).
- A module that page modules import (`public/prompt-section.js`) touches no global at load: it reads common.js helpers when
  called, so a suite can import a page for its pure exports in Node.
- A converted page is tested by plain `import` over the fake DOM (`tests/unit/helpers/import-world.js`), not by `loadWorld`.
  Each import is a fresh module instance, and the world puts every global back when it is restored. The classic-loader
  census (`tests/unit/classic-loader-census.test.js`) is a ratchet on the suites that still load classic scripts: it may
  only fall. `importWorld` installs only what it is given, unlike `loadWorld`: no stub `fetch`, `setInterval` or
  clipboard, and real timers unless `timers` is passed, so a page's init would reach the network or leave a poll
  running. Test pure exports by a static import; drive an init through one shared world with inert defaults
  (`tests/unit/helpers/task-page-world.js`, LIN-4472), made before the import so the page's DOMContentLoaded listener
  lands on the fake document. A suite that runs a classic file through `runClassic` counts, except the IIFE siblings a
  module page may read (`public/chart-helpers.js`, `public/close-out.js`, `public/question-cards.js`). The world is the
  real `globalThis`, page and test alike: a suite that collects `timers` flushes with `setImmediate`.

- A page module runs while `document.readyState` is already `'interactive'`, before DOMContentLoaded, so a module page
  that starts on DOMContentLoaded registers that listener unconditionally: its old `readyState === 'loading'` branch is
  false under a module and would start the page early. A top-level early return becomes `var mounted = ...` with the
  statements after it in `if (mounted) { }`: `var` stays module-scoped, and function declarations stay top-level and
  hoisted, as they were in the IIFE. (LIN-4463 piece 3, flight-companion.js.)

- A module's exports are its test seams, and a namespace is read-only. A classic getter/setter pair on the export object
  becomes a named function (`getOpenLoopIds`/`setOpenLoopIds` in `public/observation.js`); a `let` read through the
  namespace is live. Keep each export's name from the old seam where it can stay a function (`lastRulingsRef`); an accessor named after its own state gains a verb (`openLoopIds` → `getOpenLoopIds`), so a suite changes how it loads and not what it asserts.
  A suite reaches module state through the seam, never by a script-scope probe. (LIN-4463 piece 4.)
- Home's waiting cards are question record cards (`question-record-card`, LIN-4538), and one answered here stays, settled.
  A selector that reads the Waiting set (keys, count, keep-typed, copies) names that card and skips `[data-settled]`;
  one naming only `session-question-card` matches nothing on Home and fails silently (LIN-4538's four fixes).
