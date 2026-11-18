# What this stage really wrote

## Comment on LIN-4446 at 15:14:31

## Blind read
Verdict: better. Better: the USD formatter has one owner again. `lib/cost-format.js` is served as-is at `/shared/cost-format.js` through a separate, file-by-file `SHARED_MODULES` allow-list in `lib/vendor-assets.js`, so the hand-copied `public/cost-format.js` and its parity test are deleted, with guards for leaf purity, boot failure and the 404s. Worse: `public/cost-format-global.js` turns the formatter back into a global, which brings in a timing rule that nothing checks generally: each classic consumer may read `window.CostFormat` only after DOMContentLoaded. Four files now explain that rule in comments, and `public/workspace-kpis.js` had to move its whole build into a listener.

Read: https://github.com/JKershaw/LinearViewer/pull/2423 at `1de016f52` against `4b5001ddf`.

### Inside the area, fix-sized
- `tests/unit/cost-format-consumers.test.js` (front-end-browser, concerns `public/flight-companion.js`): the test title ("formatCost gives the browser copy's words") and its comment ("The browser copy's fine mode") name the browser copy this change deleted. Reword them to "the shared formatter's words".
- `tests/unit/cost-format.test.js` (other-features, concerns `lib/cost-format.js`): this is a new file, but its header says "The browser-copy parity comparison it used to carry is retired". It never carried that comparison. It also keeps `export const TABLE`, which nothing imports; the export is left over from the deleted parity test. Drop the sentence and the `export`.

### Inside the area, larger
- `public/cost-format-global.js` (front-end-browser): the module-to-global bridge is specific to this one module. The guard in `tests/unit/shared-modules.test.js` hard-codes the `SHIM` constant, the `'window.CostFormat'` string and the list of four consumers. The DOMContentLoaded-only rule is restated in `public/flight-companion.js`, `public/observation.js`, `public/prompt-section.js` and `public/workspace-kpis.js`, and per-consumer tests witness it, but no check covers a new consumer. A fifth consumer trips only the hard-coded list, with no hint about the timing rule. A second shared module would need a second shim and a second guard. This is larger than a fix because it needs a design decision on how classic pages take shared modules: one shim per module, a general shim, or turning consumers into modules.
- `public/ship.js` / `public/ship-biscuit.js` (front-end-browser): the change built a way to share code, but other browser copies in its area are still synced by hand, each with a comment saying so: `public/ship.js` ("mirror of lib/ship-layout.js") and `public/ship-biscuit.js` ("Kept in lockstep with lib/render-ship-biscuit.js"). This is larger because each lib side would first have to become an import-free leaf before it could join `SHARED_MODULES`.

### Outside the area
None.

