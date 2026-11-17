# What this stage really wrote

## Comment on LIN-4472 at 17:25:51

## Survey open-0: LIN-4472 @ 17faa83f4

Piece 1 (#2431) is merged: `import-world.js`, the census (102) and the rewritten Waiting entry exist. The conversion itself is easy. The difficulty is in four places.

**1. Tests that read the source as text depend on the IIFE's indentation.** Unwrapping it moves every line out two spaces. These tests slice the source at strings that include the indent:
- `lin-3975-task-run-control:588` (`'  function init(doc) {'`)
- `lin-3975-summary-and-time:59/162/263`
- `lin-3975-chat-fold:142`

Two more suites run the file and aren't in the brief's list:
- `lin-3975-proposal-refresh:232` (`loadWorld` + `module.exports`)
- `lin-3975-task-run-links:213`, which calls `vm.runInNewContext` on the raw source. It will throw a SyntaxError on the first `export`.

**2. The duplicate-helper search finds nothing, but there are two real duplicates.** No function name in `task-page.js` equals a `common.js` global or a lib export. The real duplicates are:
- `relativeWords` (`:366`), which is `relativeAgo` (`lib/task-page-loader.js:614`) line for line;
- `formatElapsed` (`:302`), which a parity test pins to `fmtDuration` (`lib/render-run-steps.js:258`).

Neither lib file is a leaf (22 and 4 imports). Importing either means extracting a leaf, adding a `SHARED_MODULES` entry and an `areas.json` owner. That is a serving change, and "Session fit" rules serving changes out. Decide this up front and record it on LIN-4463. I'd export both, turn the parity tests into plain imports, and name the extraction as the next piece.

**3. `importWorld` sets up less than `loadWorld`, and that works against "shorter".** `loadWorld` provides a stub `fetch`, a sync `requestAnimationFrame`, `navigator.clipboard` and unref'd timers. `importWorld` uses Node's real global:
- without `timers`, a poller's `setTimeout` is real;
- `navigator` is Node 25's own, with no clipboard (share copy, `:397`);
- every page test needs `restore()`.

The way to keep suites short: most exports are pure (`pollDelay`, `cadenceStatus`, `createOpenMemory`, `formatElapsed`, `proposalsUrlOf`…). Keep the `typeof document` guard and a **static** import needs no world at all. That removes `exportsOf()` (`task-page-client:28`, `task-timeline-client:26`). Only the DOMContentLoaded suites need `importWorld`.

**4. No real browser exercises this page.** The golden diff (7 tags) and Node imports can't show MIME, CSP or execution order. Run `tests/e2e/task-page.spec.js` and `task-timeline.spec.js`, or say CI carries them.

Minor: the regex at `no-page-wide-label-listener:247` already tolerates `{ module }` entries. Piece 1 already marked the Waiting entry's premise wrong, so deleting it is just tidying.

**First moves:**
1. Add named exports beside the IIFE.
2. Move the five executing suites and the two parity tests to imports, green while the seam still exists.
3. Remove the IIFE and the seam in a whitespace-only commit, re-anchoring the text slicers on names.
4. Then `SCRIPTS`, the golden file, and the census, which should fall by 5–7 depending on whether `task-page-question` still loads `question-cards.js` classically.

