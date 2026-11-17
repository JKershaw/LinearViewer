# What this stage really wrote

## Comment on LIN-4446 at 14:36:13

### Plan Review Verdict

**Verdict:** Approve. The revision fixes the blocking finding at its cause (`workspace-kpis.js` now initialises on `DOMContentLoaded`, after the module shim has run), and nothing else in the plan would make the build go wrong.

**How the plan meets what was asked.** "The reading of the rule … goes into the project's own notes" → step 1. "Browser code that shares rather than restates … one shared piece at a time" → one shared formatter, retiring `public/cost-format.js` and `tests/unit/cost-format-parity.test.js`. "Every change names what it retires" and "John has read the first slice's result before the next starts" → step 8. The only narrowing is that no view is reworked. That comes from John's recorded size ruling ("just the task"), not from the plan. Reviewed at `4b5001ddf`, which is still `origin/main`. `git log --since=2026-11-13T12:08:10Z` returns nothing.

**Last verdict's points, and whether the answers hold.**
- **Blocking 1 (the KPI chart reads the formatter at load). Holds.** I re-read `public/workspace-kpis.js`: its only `CostFormat` reads are the tooltip and tick callbacks at lines 134 and 138, inside the `charts.draw('cost', …)` config. Wrapping the IIFE body in a `DOMContentLoaded` listener puts every one of those reads after deferred module scripts, imports included, have run. No unit test loads `public/workspace-kpis.js` today, so deferring it breaks no existing vm suite. `tests/unit/render-workspace-kpis.test.js:154` pins the script order, but `/cost-format.js` is not in that list, so swapping it for the shim leaves the test untouched. The restated rule ("never read during script execution, including through a callback a library runs synchronously") is the right one.
- **Notes 1–8.** All are folded in as written. I checked each against the source:
  - six renderers, with `const SCRIPTS` at `lib/render-task-page.js:82`;
  - `CLAUDE.md` at 110 lines and 11,950 bytes;
  - the stale consumer comments;
  - comment-stripped purity;
  - fixture `sandbox.window` (in `loadWorld`, `sandbox.window === sandbox`, and `flight-companion-client` passes its own `sandbox.window`, so assigning `sandbox.window.CostFormat` works for every caller);
  - the observation counting method.

**Also checked and sound.**
- Every browser call passes either no options or `{ fine: true }`, so the lib's destructured `{ fine = false } = {}` behaves exactly like the browser copy's `options && options.fine`. No call site passes `null`.
- `public/` is filed by `^public/` in `docs/areas/areas.json`, so the new shim needs no new area pattern.
- The acorn sweeps parse a file as a module first and fall back to a script (`public-element-method-guards`, `fake-dom-census`). A shim containing `import` passes both.
- The server mounts `createVendorAssetsRouter()` immediately before `express.static('public')` (`server.js:1227-1228`).

---

#### Notes for the builder (none blocking)

1. **The "full `server.js` app" 404 witness needs a real server.** `server.js` calls `app.listen` when it is imported (line 4674) and exports no `app`, so a unit test cannot import it. A hand-built router stack like the one in `vendor-assets.test.js:91` is not the full app. Two options:
   - Put the two 404 assertions (`/shared/nope.js`, `/lib/cost-format.js`) in the Playwright check, which already runs the real server.
   - Spawn `server.js` as `tests/unit/lin-619-session-secret.test.js:159` does.

   Either one gives the guarantee the plan asks for.
2. **Make the KPI Chart-stub test fail for the right reason.** `charts.draw` returns `null` before `new Chart` when there is no `#chart-cost` element (`public/chart-helpers.js:103-104`). That is the same trap as the `typeof Chart` guard. So:
   - Put a `<canvas id="chart-cost">` in the fake document.
   - Seed the whole `daily` shape the IIFE walks first: `days`, `dispatches`, `autopilotRuns`, `agentActions`, `done`, `doneTotal`, `runsByKind`.
   - Stub `getComputedStyle`, or `HarbourCharts`, because `chart-helpers.js:18` calls `getComputedStyle` at load.
   - When you check that the test fails on today's code, assert the error is the `CostFormat` `TypeError`, not a hole in the seed. The final "ticks are formatted" assertion already catches a missing canvas once the fix is in.
3. **State the real reason `prompt-section.js` is safe.** "After a fetch" is not a guarantee: a fetch started during parsing can resolve before a two-file module graph has loaded. The real guarantee is that every `PromptSection.init` caller runs at `DOMContentLoaded` or later:
   - `task-page.js:926` runs on `DOMContentLoaded`.
   - `app.js:2321` runs `init()` on `DOMContentLoaded`, and Home's prompt mounts happen after user-triggered fetches through `bindHomeFolds`.
   - `swipe.js:857` runs when the user opens the prompts section.

   Use that reason in the corrected comment at `prompt-section.js:1505`. Have that consumer's lighter test drive it through `init` and a resolved decision-panel fetch.
4. **`tests/unit/cost-format.test.js` does not exist yet.** Step 5 "moves" assertions into it, so create it. The parity file's `export const TABLE` has no importers, so deleting it strands nothing.
5. **One live hit is missing from the places list:** `docs/areas/other-features.md:14`, the Waiting entry saying `lib/cost-format.js` is still in the catch-all. It stays true, but once the file is served to the browser, a few words there ("also served as `/shared/cost-format.js`, so a leaf") stop the next reader from moving it without seeing that constraint. The repeat search will show it. The other new hits are server-side `import … from './cost-format.js'` lines in `lib/*`. They are not places and need no change.
6. **`CLAUDE.md` will need trimming.** It has 50 bytes spare. Any reading plus a pointer to `docs/areas/front-end-browser.md` will be longer than the 46 bytes of today's "Keep it minimal - no frameworks, no build step". Expect step 1's trim clause to apply, and name the cut text in the PR as planned.

Ready for `implementation` with these notes.

