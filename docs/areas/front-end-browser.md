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
  §9–10). Limits: a shared module is a leaf (no imports, no Node built-ins, no DOM or global read at load), served only
  through the explicit `SHARED_MODULES` allow-list in `lib/vendor-assets.js`, never by directory. Views and the `vm` test
  loaders stay classic until a module-capable client test loader exists. A consumer reads a shared global only from a
  handler or a callback that runs after DOMContentLoaded, never during script execution: Chart.js calls scale tick
  callbacks synchronously, which is why `public/workspace-kpis.js` builds on DOMContentLoaded. A slice retires the
  restated copy and its parity check in the same change, not later.

## Waiting

- `public/app.js`: Home's Running and Up next are refreshed by parsing a whole page with
  `DOMParser` (LIN-4243). Waiting on you is drawn as a server fragment by the page's own
  function (LIN-4242); doing the same for the other sections would mean the client never
  parses a whole page. (Survey tally: LIN-4243.)
- `public/common.js`: `buildDispatchModelOptionDescriptors` repeats the merge rule of
  `buildModelOptions` (`lib/openrouter-catalog.js`), since the browser has no build step.
  The lists are not copied (they come from `window.__HARNESS_MODELS__` and the catalog over
  the wire); only the rule is. The endpoint could send merged options instead. (LIN-4358.)
- `public/brief.js`: its `postBrief`/`errorText` block is identical to `postRecap`/`errorText`
  in `public/recap.js`, and the check for a `statusCode` inside a keepalive 200 body is now
  written four times (also `public/scan.js` and `public/observation.js`). One shared reader
  in `public/common.js`. (Area reads CG/CH, 8 Nov, on LIN-4358.)
- `public/common.js`: exported globals, and the "client twins" of `lib/task-page-href.js`, `lib/timeline-zoom.js`,
  `lib/ship-layout.js` and `lib/prompt-formatters.js`. The first two are leaves of the same shape as cost-format, the
  next candidates; the last two import other modules, so serving a single file will not do for them. (LIN-4446 plan.)
- `public/prompt-section.js`: the browser files reach their suites through `tests/unit/helpers/client-world.js`, which
  loads them as classic scripts through `vm`. A module-capable client test loader is needed before any view becomes a
  module, since `lib/components/page.js` emits classic tags. (LIN-4446.)
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
