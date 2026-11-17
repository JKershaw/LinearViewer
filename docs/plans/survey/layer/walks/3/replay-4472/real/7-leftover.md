# What this stage really wrote

## Comment on LIN-4472 at 18:01:32

### Leftovers
- tidied: the old import paths. Every server caller of `fmtDuration`/`relativeAgo` now imports `lib/time-words.js`, and the re-exports in `lib/render-run-steps.js` and `lib/task-page-loader.js` are gone. The identity test is now a guard: no `lib/`, `routes/` or `server.js` module except the leaf defines or re-exports either name. I re-added one re-export as a mutation and the guard failed.
- tidied: comments the change made untrue. `lib/time-words.js` header and `docs/architecture/source-map.md` (render-run-steps exports, time-words entry) no longer say the server re-exports.
- noted, `docs/areas/front-end-browser.md` Waiting: copies left beside the new owner. `public/session.js` `formatElapsed` and `public/observation.js` `formatRuntime` restate `fmtDuration`, and `public/live-console.js` `fmtDuration(s)` spells the rule a second way (no hour rung). All three are classic, so each goes when its page converts.
- lesson added, `docs/areas/front-end-browser.md`: `importWorld` installs only what it is given. Test pure exports by a static import, and drive a page's init through `tests/unit/helpers/task-page-world.js`.
Retires: `docs/areas/front-end-pages.md` "`lib/render-task-page.js`: the layout test's desktop check that both quiet offers…". `tests/e2e/task-page.spec.js` now polls the offers' offset (`expect.poll`) instead of reading it once; 5/5 passes locally with retries off.

PR: https://github.com/JKershaw/LinearViewer/pull/2436, head `ffa70b7821e9859a403e043e1ea55d588b67ac73`. CI is green on that head: CI success, both unit jobs, E2E shards 1–4, secret scan.

