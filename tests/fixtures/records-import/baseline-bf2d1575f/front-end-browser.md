# Waiting fixture

Copied from docs/areas/front-end-browser.md at bf2d1575f (LIN-4494): the ## Waiting section only, for the importer test on a shallow checkout.

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
  rule is spelled two ways. Both are classic scripts, so neither can import the leaf until its page is a module (the run
  page does not load `public/close-out.js`, so that file is no blocker; corrected, Drift & Coherence Review, 14 Nov.,
  `docs/reviews/drift-coherence-review-2026-11-14.md`). Each copy goes when its page converts; Live Console's wording is a
  choice to make then. (LIN-4472 leftovers. The copy in `public/observation.js` went with its conversion, LIN-4463 piece 4.)
- `public/observation.js`: about 5,000 lines. By the counting method of LIN-4446 (lines starting with `*`, `//` or `/*`)
  1,985 of its 4,679 non-blank lines are comments. Find out why it is this large before splitting it. An earlier survey
  used a different method, so its figure is not comparable. (LIN-4446 plan.) It is a native module now (LIN-4463
  piece 4); converting it did not change its size, and its suites still run most of its 105 seams.
- `public/observation.js`: it is a module but still reads `public/common.js` globals bare (`escapeHtml`,
  `relativeTime`, `window.api`, `taskPageHref`/`sourceQuery`, `ReplyDelivery`, `ScanSection`), and each of its module
  suites (`tests/unit/observation-module.test.js`, `tests/unit/task-page-link-client-surfaces.test.js`,
  `tests/unit/observation-ruling-delivery.test.js`) rebuilds that contract by hand, differently: one stubs `escapeHtml`
  and `relativeTime`, one passes the real lib leaves, and the ruling-delivery suite runs `public/common.js` into the
  process global with `vm.runInThisContext` and an `importWorld({})` baseline it never restores (that keeps it in the
  classic-loader census). Two ways out, and the choice is a design call spanning several suites: one shared
  observation-world helper for the suites, or move the page's `public/common.js` reads to imports (which needs those
  names extracted from `public/common.js` as leaves). Settle it with the next change to `public/observation.js`.
  (LIN-4463 piece 4 blind read.)
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
