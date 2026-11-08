# Front end: browser code

Area notes for `front-end-browser` in the registry. Format and rules: README.md.

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
