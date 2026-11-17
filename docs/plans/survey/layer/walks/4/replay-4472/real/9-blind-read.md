# What this stage really wrote

## Comment on LIN-4472 at 18:10:45

## Blind read
Verdict: better. It gives the duration and relative-time words one owner, `lib/time-words.js`. That deletes the copies in `public/task-page.js` (`formatElapsed`, `relativeWords`) and the source-slicing `vm` parity tests around them, unhooks the renderers from `lib/render-run-steps.js` and `lib/components/time.js` from the loader for these words, and makes `public/task-page.js` a real module whose suites import its exports. On the worse side, it claims the words now exist "once", but `public/session.js` and `public/observation.js` still carry the same duration algorithm, and the new guard can't see them because it only scans server files. A comment in `public/task-page.js` is also wrong.

Read: https://github.com/JKershaw/LinearViewer/pull/2436 at `ffa70b782` against `5cf4f6aa2`.

### Inside the area, fix-sized
- `public/task-page.js` (front-end-browser): the comment on the export block (lines 903–904) says the page "starts from DOMContentLoaded, below", but that listener is above it. It also says "nothing here reads or writes a global", but `init` reads `window.api`, `window.BriefSection`, `window.CloseOut`, `window.PromptSection`, `window.initLocalTimes` and others. Fix: say "above", and "the module writes no global".
- `lib/time-words.js` (front-end-pages): the header (lines 10–11) and its `docs/architecture/source-map.md` entry say the words exist "once" and that "a second copy has nowhere to hide". The guard in `tests/unit/lin-4472-time-words.test.js` only walks `lib/`, `routes/` and `server.js`, so copies under `public/` (see below) pass it. Fix: narrow both texts to "every server caller", or add `public/` to the walk and list the known copies as exceptions.
- `tests/unit/lin-3975-summary-and-time.test.js` (unmapped; concerns `public/task-page.js`, front-end-browser): the "share list's words are the server's relativeAgo words" test now compares `shareTime`'s text with `relativeAgo`, which `shareTime` itself calls. It no longer checks two copies against each other, and `tests/unit/lin-4472-time-words.test.js` already has the same `shareTime` test. Fix: drop one of the two, or retitle it as a wiring check.

### Inside the area, larger
- `public/session.js` (front-end-browser): `formatElapsed` (line 257) and `formatRuntime` in `public/observation.js` (line 517) still copy `fmtDuration`'s algorithm line for line, so the run page and the observation cards can drift from the task page. This is larger than a fix because `public/session.js` is a classic IIFE with a `module.exports` test seam. Adopting the leaf means converting it to a module, as this change did for `public/task-page.js`, and moving its classic-loader suites with it. That changes how the run page loads.
- `lib/task-page-loader.js` (runs-and-dispatch): `fmtWhen`, the third moment formatter, stays in the loader. So `lib/components/time.js` and `lib/render-task-timeline.js` still import a page-formatting helper from a runs-and-dispatch module, the same tangle this change removed for `relativeAgo`. Moving it into `lib/time-words.js` is a decision about whether that leaf also owns absolute UTC stamps, and it touches about five importers.

### Outside the area
None.

