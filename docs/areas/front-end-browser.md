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
  namespace is live. Keep each export's name from the old seam, so a suite changes how it loads and not what it asserts.
  A suite reaches module state through the seam, never by a script-scope probe. (LIN-4463 piece 4.)

## Waiting

- `public/app.js`: Home's Running and Up next are refreshed by parsing a whole page with
  `DOMParser` (LIN-4243). Waiting on you is drawn as a server fragment by the page's own
  function (LIN-4242); doing the same for the other sections would mean the client never
  parses a whole page. (Survey tally: LIN-4243.) Not a module matter; outside LIN-4463 (plan table).
- `public/common.js`: `buildDispatchModelOptionDescriptors` repeats the merge rule of
  `buildModelOptions` (`lib/openrouter-catalog.js`). That module is not a leaf (it imports
  `lib/catalog-rate.js`), so it cannot be served as one shared file (LIN-4446).
  The lists are not copied (they come from `window.__HARNESS_MODELS__` and the catalog over
  the wire); only the rule is. The endpoint could send merged options instead. (LIN-4358.)
- `public/brief.js`: its `postBrief`/`errorText` block is identical to `postRecap`/`errorText`
  in `public/recap.js`, and the check for a `statusCode` inside a keepalive 200 body is now
  written four times (also `public/scan.js` and `public/observation.js`). One shared imported reader is possible only
  once `public/scan.js`, `public/recap.js` and `public/brief.js` are modules that can import it (LIN-4463 converts pages
  top down; `public/observation.js` became a module in piece 4); until then it would be a classic global in
  `public/common.js`. (Area reads CG/CH, 8 Nov, on LIN-4358.)
- `public/common.js`: exported globals, and the "client twins" of `lib/task-page-href.js`, `lib/timeline-zoom.js`,
  `lib/ship-layout.js` and `lib/prompt-formatters.js`. The first two are leaves of the same shape as cost-format, the
  next candidates; the last two import other modules, so serving a single file will not do for them. Its
  `TERMINAL_STATE_TYPES` mirror of `lib/providers/models.js` (no imports) is another leaf twin, and it retires when its
  last classic consumer converts (LIN-4471 corrected its comment to say so). (LIN-4446 plan and leftovers.)
- `public/ship.js` / `public/ship-biscuit.js`: still hand-synced copies ("mirror of lib/ship-layout.js", "kept in
  lockstep with lib/render-ship-biscuit.js"). Each lib side would first have to become an import-free leaf before it
  could join `SHARED_MODULES`. (LIN-4446 blind read.)
- `public/session.js`: its `formatElapsed` is a copy of `fmtDuration` (`lib/time-words.js`, LIN-4472). `fmtDuration`
  in `public/live-console.js` words seconds with no hour rung (`66m 40s` where the leaf says `1h 6m`), so the duration
  rule is spelled two ways. Both are classic scripts, so neither can import the leaf until its page is a module
  (session.js shares close-out.js with the task page). Each copy goes when its page converts; Live Console's wording is a
  choice to make then. (LIN-4472 leftovers. The copy in `public/observation.js` went with its conversion, LIN-4463 piece 4.)
- `public/observation.js`: about 5,000 lines. By the counting method of LIN-4446 (lines starting with `*`, `//` or `/*`)
  1,985 of its 4,679 non-blank lines are comments. Find out why it is this large before splitting it. An earlier survey
  used a different method, so its figure is not comparable. (LIN-4446 plan.) It is a native module now (LIN-4463
  piece 4); converting it did not change its size, and its suites still run most of its 105 seams.
- `public/llms.txt`: its H11 names the unscoped `/api/recommend/status`, which is now only a
  legacy redirect (`routes/legacy-redirects.js`), and its view list omits `projects` and
  `live-console` (`lib/components/view-nav.js`; live-console shows for an owner with a live runner key or queue token
  unless their `liveConsole` flag is stored `false`, not simply behind a flag). The browser guide is otherwise sound:
  its endpoints and selectors resolve. The view list and `nav-view-*` keys are written by hand and no test checks them
  against source, so a fix will drift again unless a conformance test comes with it. Not a module matter; outside
  LIN-4463 (plan table). (Documentation Review, 10 Nov.;
  `docs/reviews/documentation-review-2026-11-10.md`; LIN-4463 blind read.)
- `public/prompt-section.js`: on a server with no AI (`aiState: "unconfigured"`, a self-host with no
  OpenRouter key) the run control still offers Next step. Pressing it gets a 503 from the recommend
  stream, and "AI Recommend · generating…" / "Loading…" spin with no message, while Run to PR works
  beside it. Offer only what the server can do, or say why it can't. (Onboarding & Cold-Start
  Review, 11 Nov.; `docs/reviews/onboarding-cold-start-review-2026-11-11.md`.) Not a module matter; outside
  LIN-4463 (plan table).
- `public/feedback-widget.js`: on any non-ok response it keeps the draft and shows `data.error`; it never
  checks `code: 'PARTIAL_WRITE'` or `retryable: false` (LIN-4452). After a Jira ticket that landed without
  its seal, the user sees agent wording ("do not retry the create, read the issue instead") with no
  identifier and Save still active, so pressing Save again files a duplicate. Read the code, show the
  created key if the envelope carries one, and disable resubmit. Only reachable on a Jira-backed
  workspace whose property write fails; revisit with John's live evidence on LIN-4445. (LIN-4452 blind read.)
- `public/flight-companion.js`: whether the page has its core mounts (`thread`, `questionInput`, `sendBtn`) is one
  decision spread over eight `if (mounted) { }` blocks (the first declares the turn state; the rest wire listeners and
  restore the stored session). Module state such as `chatHistory`, `cadence`, `seenIdentifiers`, `PILL_GLYPHS`,
  `modelActiveIdx`, `resumeAnchorMs` and `keepStopped` is declared inside those blocks, and the hoisted functions read it
  unconditionally. A new top-level `var` or listener has to remember the wrapper, and nothing fails if it does not,
  except under the `omitMounts` test. Give the decision one owner: an `init()` entry point like `public/task-page.js`'s
  `init(doc)`, or state declared unconditionally with the wiring guarded in one place. Keep the missing-mount
  behaviour. Larger than a fix for a 2,200-line file; do it with the next change to this file. (LIN-4463 piece 3
  blind read.)
