# What this stage really wrote

## Comment on LIN-4446 at 14:27:54

### Plan Review Verdict

**Verdict:** Request Changes. The cost chart on the workspace KPIs page reads `window.CostFormat` while its script first runs, so a deferred module shim breaks it, and none of the plan's witnesses would catch it.

Blocking findings: 1

**How the plan meets what was asked.** It covers "the reading of the rule … goes into the project's own notes" (step 1). It delivers "browser code that shares rather than restates … one shared piece at a time" with one shared formatter, retiring `public/cost-format.js` and its parity test. It follows "every change names what it retires" and "John has read the first slice's result before the next starts" (step 7). The only narrowing is that no view is reworked in this slice. That comes from John's recorded size ruling ("just the task"), not from the plan. Reviewed at HEAD `4b5001ddf`, which is still `origin/main`; nothing has landed since the plan was grounded.

**What I checked and found sound.**
- Serving: `lib/vendor-assets.js` is a frozen allow-list that runs `statSync` at boot, and the router is mounted immediately before `express.static('public')` in `server.js`.
- CSP: `lib/security-headers.js` uses `script-src 'self'` plus hashes. That admits a same-origin module, and only HTML responses get the CSP and `nosniff`.
- `lib/cost-format.js` has no imports, so it is a leaf module and passes the purity rule.
- `renderPage` emits `<script src>` for each string entry (`lib/components/page.js:204`). The `scripts.includes('/common.js')` check is unaffected by object entries.
- The golden has its own update path: `UPDATE_RENDER_TASK_PAGE_GOLDEN=1`.
- The area note's Lessons section is about 700 bytes, well under its cap.
- The serving boundary is right: an allow-list, not a directory route.
- Moving the parity file's server-side assertions instead of deleting them is right; deleting them would loosen a guard.

---

#### Blocking

**1. `public/workspace-kpis.js` reads the formatter while the page is still loading. The plan's premise and its timing witnesses both miss this.**

The plan says all four consumers "read it inside functions today … No change to them", and the constraint rests on that ("consumers never reading `window.CostFormat` eagerly"). For three consumers this is true:
- `flight-companion.js` reaches `formatCost` only from its `DOMContentLoaded` handler.
- `observation.js` reaches `formatDueScanCostEstimate` from `init`, which runs on `DOMContentLoaded` (`:4867`).
- `prompt-section.js` reads it after the `panelNumbers` fetch.

Module scripts run before `DOMContentLoaded`, so all three are safe.

`workspace-kpis.js` is different. Its IIFE calls `charts.draw('cost', …)` at top level, while the script first runs. `chart-helpers.js:112` then calls `new Chart(canvas, config)` synchronously. In Chart.js 4.5.1, the version installed, the constructor calls `this.update()` when the canvas is attached (`node_modules/chart.js/dist/chart.js:5696-5698`). That lays out the scales and calls the y-axis `ticks.callback`, which is `window.CostFormat.formatUsd(Number(v))` at `workspace-kpis.js:138`.

That page's script order is `chart → chart-helpers → [shim] → workspace-kpis → common → app`. A module shim runs only after parsing finishes, so on any workspace with priced cost the result is a `TypeError` at load and no cost chart.

No witness in the plan sees this:
- **vm ordering test:** `workspace-kpis.js` returns early when `typeof Chart === 'undefined'`, so loading it with the global absent proves nothing.
- **Playwright check:** `tests/e2e/workspace-kpis.spec.js:133-136` says priced lineages "cannot be created through the app's dispatch API". In e2e the cost canvas is always swapped for the empty note, so "no console errors" passes even when the chart would break.

The bug would ship unseen, on the one page whose cost figure is drawn by a library callback.

**What must change:**
- Name `workspace-kpis.js` as the one consumer that needs a change. The smallest fix is to run its IIFE body from a `DOMContentLoaded` listener, which fires after module scripts have run. That changes when the page draws, not what it draws. It is not a view rework.
- Restate the constraint as "never read during script execution, *including through a callback a library runs synchronously*".
- Make the ordering witness for this file real. Load it in `loadWorld` with a `Chart` stub that calls each scale's `ticks.callback` inside its constructor, as Chart.js does. Seed `__WORKSPACE_KPI_DATA__` with nonzero `cost.perDay` and leave `window.CostFormat` absent; loading must not throw. Then install the global, call `fireDOMContentLoaded` (from `tests/unit/helpers/client-world.js`), and assert the tick labels are formatted.
- With today's code, this test fails at load. Leave the Playwright check as it is, but don't count it as covering this.

---

#### Notes for the builder (not blocking)

1. **There are six renderers, not five.** `lib/render.js:384` lists `/cost-format.js` and `/prompt-section.js`. This is the Home, backlog and landing page, the busiest one. The plan's description ("renderers listing `/cost-format.js`") already covers it, and both its repeat search and the page-has-shim guard would flag it. Add it to step 3's list so nobody has to discover it.
2. **The guard must read both list shapes.** `lib/render-task-page.js:82` declares its list as a `const SCRIPTS = [...]`, not `scripts: [...]`. The page-has-shim guard must parse both, or it misses the task page.
3. **CLAUDE.md is full.** It is at 110 of 110 lines and 11,950 of 12,000 bytes, enforced by `tests/unit/claude-md-line-budget.test.js`. Step 1's "sentence or two" won't fit as an addition. Change the existing "Keep it minimal - no frameworks, no build step" line in place to a short reading plus a pointer to `docs/areas/front-end-browser.md`, and put the limits in the area note's Lessons. If even that goes over, trim elsewhere in the same commit and say what was cut.
4. **Stale comments in the consumers.** The plan says "No change to them", but their comments become false:
   - `public/flight-companion.js:419-426` says "restated here rather than imported … no module graph to lib/" and names `public/cost-format.js`.
   - `public/observation.js:3975-3976, 3989` says the same.
   - `public/prompt-section.js:1505` names `public/cost-format.js`.

   The repeat search will flag the filename mentions. Point them at the shim, and drop the "no module graph" reasoning where it now misleads. Count these edits as comments, not as removed logic.
5. **The purity guard must not trip on comments.** The new `lib/cost-format.js` header will mention the browser. Have the guard look for top-level `window|document|process|require` in code, not in comment text. Prove it with the synthetic bad module, as the plan says.
6. **404 for other `/shared/` paths.** Unknown `/shared/*` and `/lib/cost-format.js` fall through to `express.static('public')` and then the app's routes. Assert a real 404 through the full `server.js` app, not just the bare router, so a catch-all route can't turn it into a 200 HTML page.
7. **The fixture works across vm contexts.** `loadCostFormat(sandbox)` can stay synchronous: import `formatUsd` statically at the top of `tests/fixtures/browser-cost-format.js` and assign `sandbox.window.CostFormat = { formatUsd }`. The function returns plain strings, so the main context and the sandbox can share it safely. `COST_FORMAT_SRC` has no other importers, so it can go.
8. **`observation.js` comment counts.** Keep the plan's stated method (lines starting with `*`, `//` or `/*`, out of non-blank lines) in the Waiting entry. Say that the other survey's 1,006 used a different method, rather than presenting the two figures side by side.

Once finding 1 is folded in (the `workspace-kpis.js` deferral, the restated constraint and the realistic Chart-stub witness), the plan is ready to build. Everything else above can be handled during the build.

