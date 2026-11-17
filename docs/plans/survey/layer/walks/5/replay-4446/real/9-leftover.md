# What this stage really wrote

## Comment on LIN-4446 at 15:06:53

### Leftovers
- tidied: test comments that said the formatter loads before the page script (`tests/unit/lin-3833-run-control.test.js`, `tests/unit/flight-companion-client.test.js`) now say what each seam does; `loadChatUI` drops a formatter install chat.js never reads.
- tidied: `server.js`'s mount comment now names the `/shared/*` modules as well as the vendor libraries.
- tidied: the shim guard in `tests/unit/shared-modules.test.js` no longer asserts list position (a module runs after every classic script wherever it is listed).
- tidied: the purity rule is now spelled one way, as the guard enforces it (imports nothing, names no browser or Node global), in `lib/vendor-assets.js`, `lib/cost-format.js`, and the front-end-browser and other-features notes.
- tidied: the front-end-browser Waiting entry on `buildDispatchModelOptionDescriptors` gave "no build step" as its reason; now it says `lib/openrouter-catalog.js` is not a leaf.
- noted, front-end-browser: the `TERMINAL_TYPES` mirror in `public/common.js` of `lib/providers/models.js` (a leaf) still says `public/` cannot import it; folded into the `public/common.js` twins entry.
- noted, platform-and-plumbing: `lib/vendor-assets.js` and `createVendorAssetsRouter` are now named for less than they serve; a rename touches the mount string `tests/unit/vendor-assets.test.js` pins.
- Lesson added (front-end-browser): a `{ module }` entry's list position means nothing; test the order in a `vm` seam with `readyState = 'loading'`.
Retires: `docs/areas/front-end-pages.md` "`lib/render-swipe.js`: the viewport meta is `user-scalable=no`" (the swipe page now takes the shared viewport, with a test that failed before the fix)

PR: https://github.com/JKershaw/LinearViewer/pull/2423, head `1de016f523f46a006c20a4e89717157422b3207b`, CI green.
