# What this stage really wrote

## Added to LIN-4463 description by 15:57:15 (snapshot diff)

## Implementation Plan

*Read at* `c205190fd` */ main* `5dcf5bcda`*. The only commit since this ticket was filed is a merge (*`b708a9815`*) that changes none of the files named below (*`git log --since=2026-11-13T15:39:22Z --stat` *over* `public/`*,* `lib/vendor-assets.js`*,* `lib/components/page.js`*, the two renderers,* `docs/areas/` *and* `shared-modules.test.js` *shows no file). Facts below were read from source, not from the surveys; where they agree with John's two surveys that is said, and where they differ that is said too.*

### What this is for, and what done looks like

The browser code shares through globals, so a page cannot import what it shares, and the one bridge LIN-4446 added (`public/cost-format-global.js` → `window.CostFormat`) carries a timing rule that four files explain and no check covers. This ticket makes the next move: pages become native ES modules that import, the bridge becomes a ramp that only shrinks under a check, and the area's notes tell the truth.

Done, as the ticket's own Done-when reads it:

1. The slice-1 bridge is the only bridge, its names are listed in one place, and a check fails if a name is added, if a name has no classic consumer left (so it must be deleted), or if a new classic script starts reading a bridged name without the timing rule's witness.
2. Each of the ten Waiting entries is settled or says why not (table below).
3. A blind read of the area after this work finds it clearer than before. That is judged by the reader, not built; the plan's job is to leave the stale statements (the lesson that views stay classic, the bridge entry, the loader entry, the comment in `common.js` saying `public/` cannot import a lib leaf) corrected.

**Cuts to** `## As asked`**: none.** The ask says "one view at a time" and "whatever size is natural"; this ticket converts two views and names the rest in order. That is the ask's own grain, not a cut. If John reads it otherwise, the ruling is "should this ticket convert every view" and the answer would be follow-up tickets by the same recipe, not a different plan.

### Answers to the brief's open questions (engineering, so settled here)

* **Is one completed page the boundary, or its first slice?** The boundary is *two pieces*: the foundation with the smallest real consumer, then one real page. Reason: the first piece must prove the specifier scheme with a real page module and establish the check; the second proves the thing the area note said was impossible (a view converting, with its tests as plain imports) on the page John named.
* **Which page entry first?** `public/workspace-kpis.js` (piece 1), then `public/task-page.js` (piece 2). `app.js` is set aside: it is loaded by 11 renderers, each with its own classic page script after it; making it a module changes when it runs on all 11 at once. `task-page.js` is the last script of one renderer (`lib/render-task-page.js`), reads classic globals only by `typeof window.X` guards, and has no `window.CostFormat` read, so it converts without touching the bridge.
* **Which Waiting entries remain?** Table below: two settled, eight stay with a reason and what would unlock each.

### Direction and the alternatives set aside

**Convert top down (a page entry before the files it uses), serve allow-listed lib leaves at** `/lib/<name>.js`**, import them with relative specifiers (**`../lib/cost-format.js`**), keep** `public/` **flat, test converted views by plain** `import`**.** Each choice, with its reason:

* *Top down, not leaf first.* A leaf converted first has classic consumers; a module runs after every classic script, so each leaf needs a bridge. A page entry converted first runs after `common.js`, so it reads any classic global safely, and the leaves it imports lose their classic consumers one page at a time. Matches John's second survey; I read the same fact in `lib/components/page.js` (`{ module }` is emitted as `<script type="module">`, deferred) and in the consumers (`prompt-section.js` is read by the home, task and swipe pages).
* *Relative specifiers, not an import map.* The map needs an inline script and a CSP hash (`script-src 'self'` plus hashes, `lib/security-headers.js`) and a `package.json` `"imports"` twin for Node. `../lib/x.js` from `/x.js` resolves to `/lib/x.js` in the browser (the URL clamps at the root) and to `lib/x.js` from `public/x.js` in Node, with `"type": "module"` already set. Nothing else to maintain. This costs one rule: `public/` stays flat, so the same string resolves in both places. The rule is checked, not remembered.
* *Re-key* `SHARED_MODULES` *from* `/shared/…` *to* `/lib/…`*, same allow-list, same one-file-per-entry serving.* `/lib` collides with no route (`/library` is a different prefix). `/lib/` is a namespace, never a directory mount: a lib file not on the list stays a 404. The `/shared/` URL is retired in the same change, not kept as an alias.
* *No new bridge entries, one existing entry, deleted when its last classic consumer converts.* A second shared module is never bridged: its twin stays until its last classic consumer is a module. That removes the "one shim per module" question instead of answering it with a general shim. The file keeps its name until it is deleted; renaming a file that is going away touches six renderers for nothing.
* *Native Node import with the existing fake DOM, not a* `vm.SourceTextModule` *loader.* `package.json` is `"type": "module"`, so `import('../../public/x.js')` works once `globalThis.document` is the fake's. A module must not touch `document` at load beyond registering listeners (all the page scripts already work that way). The `vm` loader is flag-gated and exists only to keep script-scope probes (`world.run`) that module scope makes meaningless.
* *Do not relocate the* `common.js` *global pool.* Nothing in these two pieces extracts from `common.js`. A converted page reads classic globals as it does today; extraction happens when a view needs shared logic that has no import path (the timeline maths and `escapeHtml`/format first, per the survey), and only then. Pieces 1–2 therefore add no entry to the bridge.

### The behaviours, and a witness for each (each fails before and passes after)

| \# | Behaviour | Witness |
| -- | -- | -- |
| 1 | The server serves an allow-listed lib leaf at `/lib/<name>.js` with a JavaScript type and the file's exact bytes. | Update `tests/unit/shared-modules.test.js` (express stack and real-server blocks): `/lib/cost-format.js` → 200, bytes equal. Before: 404. |
| 2 | Nothing else under `/lib/` is served, and the retired URL is gone. | Same file, tries what the guard stops: `/lib/vendor-assets.js`, `/lib/render.js`, `/lib/../server.js`, `/lib/%2e%2e/server.js`, `/lib/` and the old `/shared/cost-format.js` are real 404s (not the app shell with 200). |
| 3 | A page module imports a lib leaf by relative specifier and runs under Node. | `public/workspace-kpis.js` becomes a module that imports `formatUsd`; a new test imports it by plain `import()` with the fake DOM, a `Chart` stub and `window.__WORKSPACE_KPI_DATA__`, and reads the tick and tooltip labels. No `window.CostFormat`, no `readyState` setup. Before: the file needs the global and a classic loader. |
| 4 | The same page works in a real browser: MIME, CSP, `/lib/` path, and module order. | The existing `tests/e2e/workspace-kpis.spec.js` cost-axis check (line \~209), rerun against the converted page; it already exists as the witness for module order. If Playwright cannot run in the building session, say so and let CI carry it; do not mark it passed. |
| 5 | `public/` is flat and every relative import in it resolves to a flat sibling or an allow-listed lib leaf. | New check (acorn is already a dependency in `package.json`, used by `shared-modules.test.js`): no `.js` file below `public/`'s top level; every `import` in a `public/*.js` is `./x.js` of an existing public file or `../lib/x.js` of a `SHARED_MODULES` value. With synthetic failures: a nested `.js`, an import of an un-listed lib file, a bare specifier, an absolute `/shared/…` specifier. |
| 6 | The bridge is one inventory and only shrinks. | New check (`tests/unit/bridge-inventory.test.js` or a block in `shared-modules.test.js`; builder's call): the set of `window.<Name> =` assignments made at the top level of any `public/*.js` that is emitted as a `{ module }` (found by the renderer-list reader already in `shared-modules.test.js`) must equal a declared `BRIDGED` list in the test, in both directions: a new name fails (growth), a declared name with no classic consumer fails (must be deleted), and an undeclared classic file that reads a bridged name fails with a message that states the timing rule (read only from a handler or callback that runs after DOMContentLoaded) and names the witness each consumer needs. Declared consumers are a table `file → witnessing test`; the check also asserts that each witnessing test exists and sets `document.readyState = 'loading'`. Replaces the hard-coded shim, `'window.CostFormat'` string and four-consumer list in the current test. Synthetic cases: add a name, remove the last consumer, add an unregistered consumer. |
| 7 | The served lib leaves have a front-end owner in `areas.json`. | `areas.json` gets a pattern for each `SHARED_MODULES` file (today `lib/cost-format.js` falls to the `^lib/` catch-all in Other features), pinned in `tests/unit/area-map-placement.test.js` (the LIN-3829 caution in `docs/areas/README.md`: moving a file moves census and co-change counts, so the builder reads that test's pins before editing). New check: every `SHARED_MODULES` value maps to a front-end area (`front-end-browser` or `front-end-pages`), with a synthetic omission failing. `lib/timeline-zoom.js`, `lib/task-page-href.js` already map to `front-end-pages`; `lib/providers/models.js` does not, which is fixed when it is first served, not now. |
| 8 | A converted view's tests are plain imports and simpler than before. | Piece 1: `tests/unit/workspace-kpis-cost-order.test.js` (vm + readyState dance + `loadCostFormat`) is replaced by witness 3; `tests/fixtures/browser-cost-format.js` loses one user. Piece 2: the suites that run `task-page.js` through `loadWorld(... module.exports)` (find them with `grep -ln "'task-page.js'" tests/unit/*.js` filtered to `loadWorld`; `task-page-client.test.js` is one) import its named exports instead. A census check, in the manner of `tests/unit/fake-dom-census.test.js`, counts suites that name a script in `loadWorld`'s `scripts` list; it records today's number and fails if it rises, so "tests get simpler" is a number, not a feeling. |
| 9 | The converted task page behaves as before. | The golden render test (`tests/unit/render-task-page-golden.test.js`, `tests/fixtures/render-task-page-golden.json`) is updated *only* for the one script tag changing from classic to module; any other diff is a bug. Existing `task-page-*` and `lin-4405` timeline suites pass, migrated to imports. |
| 10 | The old shapes are gone from what was converted. | `grep -n "module.exports\|typeof module" public/task-page.js public/workspace-kpis.js` returns nothing; no `/shared/` string remains in `lib/`, `public/`, `tests/`, `docs/areas/`, `CLAUDE.md`. |

### What each piece retires

**Piece 1 — the foundation and the smallest real consumer** (lands first, blocks piece 2)

* Retires: the `/shared/` URL; the hard-coded shim/consumer assertions in `tests/unit/shared-modules.test.js`; `public/workspace-kpis.js` as a `window.CostFormat` reader, with the DOMContentLoaded-for-the-global workaround and its comment; `workspace-kpis-cost-order.test.js`; the `/cost-format-global.js` entry in `lib/render-workspace-kpis.js` (the page no longer needs the bridge). The bridge keeps its three other consumers (`flight-companion.js`, `observation.js`, `prompt-section.js`), so the file stays, and its import becomes `'../lib/cost-format.js'`.
* Edits `docs/areas/front-end-browser.md`: rewrites the stale lesson ("Views and the `vm` test loaders stay classic until a module-capable client test loader exists" is false after this piece) into the rules above: top down; relative specifiers; `public/` flat; no new bridge entries; a lib twin retires when its last classic consumer converts; test converted views by import; and keeps the true parts (leaf purity, allow-list only, the timing rule while a bridge exists). The Lessons section must stay under the 6144-byte cap (it is 2,114 bytes now). Updates `CLAUDE.md` line 43 only if the wording points at the old loader limit.
* Fixes the comment in `public/common.js` ("`public/` cannot import it") for the `TERMINAL_TYPES` twin: a comment-only edit, so no behaviour moves.

**Piece 2 — one real page, top down** (lands second)

* Converts `public/task-page.js` to a module with named exports in place of its `module.exports` block; the renderer's `SCRIPTS` entry becomes `{ module: '/task-page.js' }` in `lib/render-task-page.js`. It is the last script in that list, so its DOMContentLoaded listener stays registered after `common.js`'s and the prompt run control's, as before.
* Retires: the `typeof module` test seam in `task-page.js`; the `loadWorld`-plus-`window.module.exports` pattern in the task-page suites; any helper `task-page.js` restates that `common.js` already exposes (the builder searches the converted file for function names that equal a `common.js` global or a lib export, and either reads the global or imports; nothing is added to the bridge to make this work).
* Adds the one test-support piece both pieces need if piece 1 has not already: a small import helper next to `tests/unit/helpers/client-world.js` that installs the fake DOM on `globalThis` and imports a public module fresh (a query-string cache-bust on the page module; the lib leaves stay cached, since they are pure). `loadWorld` is not touched, so the 64 classic suites keep running unchanged.
* Settles the Waiting entry about a module-capable loader by showing the premise wrong, with the converted suites as the proof.

### Everything the behaviour lives in, and how I know I found it

The behaviours are "a view imports what it shares" and "a bridge name has exactly one source and a declared set of readers". Places found, by search at HEAD:

* `window.CostFormat` readers: `public/{flight-companion,observation,prompt-section,workspace-kpis}.js` (`grep -n "window.CostFormat" public/*.js`; matches the current test's four). Renderers carrying `{ module: '/cost-format-global.js' }`: `lib/render.js`, `render-task-page.js`, `render-swipe.js`, `render-observation.js`, `render-flight-companion.js`, `render-workspace-kpis.js` (six; the current guard reads both list shapes, including the task page's `const SCRIPTS`).
* `/shared/` references: only the allow-list, the shim and the test (`grep -rn "/shared/" lib public tests docs CLAUDE.md`, builder reruns before finishing; any other hit is in scope).
* `module.exports` blocks in `public/`: eleven files; only `task-page.js` is touched here (piece 2). The other ten (`close-out.js`, `question-cards.js`, `home-placement.js`, `live-console.js`, `observation.js`, `ship.js`, `ship-biscuit.js`, `session.js`, `ship-journey.js`, `flight-companion.js`) each wait for their own view; `close-out.js` is shared by the task page and `session.js`, so it cannot convert with either alone. That is why it is named, not left out silently.
* **What will catch the rest:** witnesses 5 and 6 are the repeatable net. They fail on any nested public file, any import outside the allow-list, any new bridge name, and any unregistered bridge reader, so a place I have not found that matters to this change would trip a check rather than ship. Places that are not code (production data) do not exist here: the change is static files and tests.

### Likeliest ways it breaks

1. **Execution order.** A module runs after every classic script, wherever it sits in the list. `workspace-kpis.js` moves from *before* `common.js`/`app.js` to *after* them, so its `DOMContentLoaded` listener is registered later than theirs (`public/flight-companion.js` already documents that listener order against `common.js`'s auto-init matters). It reads only `window.__WORKSPACE_KPI_DATA__`, `window.HarbourCharts` and `Chart`, none of which `common.js` or `app.js` set, so I expect no change. Witness: 4 (browser) and the page test in 3 (both charts and sparklines drawn).
2. **Module semantics.** Modules are always strict, top-level `var` and function declarations are not globals, and `this` is undefined. `task-page.js` and `workspace-kpis.js` already say `'use strict'` and wrap everything in an IIFE; unwrapping it to export names is what could change a reference. Witness: the existing suites on the converted file, plus witness 9.
3. **The test seam changes under the builder.** A module evaluates once per URL, so a second `import` in the same process returns the first instance's timers and listeners; and `world.run` probes of script-scope `let`s cannot work on a module. Witness: the import helper's own test (two fresh imports do not share state), and the rule that a probe either becomes an export or goes. Piece 2's census (witness 8) shows the loader count falling.

### What stays out, and where each Waiting entry goes

None of these is made worse by this work, and none breaks anything, so by the leftover rule they stay `## Waiting` entries in `docs/areas/front-end-browser.md`, rewritten where this ticket changes what unlocks them (a rewritten entry still cites a file that maps to `front-end-browser`, which `tests/unit/area-notes.test.js` checks; the two settled entries are deleted, leaving eight).

| Waiting entry (first cited file) | Disposition |
| -- | -- |
| `public/app.js` DOMParser | Stays. Unrelated to modules; John's survey defers it. |
| `public/common.js` `buildDispatchModelOptionDescriptors` | Stays. `lib/openrouter-catalog.js` imports `lib/catalog-rate.js`, so it is not a leaf and cannot be served alone. |
| `public/brief.js` repeated `postBrief` / status check | Stays, entry rewritten: it can only be written once after `scan.js`, `recap.js`, `observation.js` and `brief.js` are modules that can import one reader; none converts in this ticket. |
| `public/common.js` twins | Stays, entry rewritten with the rule above: each twin retires when its last classic consumer converts. `timeline-zoom` and `task-page-href` are leaves (no imports, checked), so they go first once a consumer page exists. Comment fix lands in piece 1. |
| `public/cost-format-global.js` bridge | **Settled in piece 1**: the design call is one bridge, no new names, an inventory check; entry deleted. |
| `public/ship.js` / `ship-biscuit.js` copies | Stays. Their lib sides import other modules (`lib/ship-layout.js` and the prompt-formatters twin need their server-side dependencies made leaves first). |
| `public/prompt-section.js` module-capable loader | **Settled in piece 2**: not needed; native import and the fake DOM are the loader. Entry deleted. |
| `public/observation.js` size | Stays. Find out why first; making it a module does not answer that. |
| `public/llms.txt` drift | Stays. Documentation fix, not a module matter, breaks nothing. |
| `public/prompt-section.js` no-AI Next step | Stays. Product behaviour, not structure. |

After this ticket the next views, in order, each its own ticket by the same recipe, are: `flight-companion.js` then `observation.js` (each removes a bridge consumer; the check makes the shrink visible), then the `prompt-section.js` chain (`task-page.js` is already a module, `app.js` and `swipe.js` follow) which empties the bridge so the file is deleted and `tests/fixtures/browser-cost-format.js` goes with it. No view is retired.

### Size, order of landing, and review

* Order: piece 1, merged and verified alone, then piece 2. Piece 2 is blocked by piece 1 (it uses the specifier rule, the flat check, the import helper if introduced there, and the corrected lesson). Each piece names what it retired in its own description.
* needs multiple sessions
* Why a second reader: it takes more than one session and it moves a served-URL namespace (`/shared/` → `/lib/`) and a CSP-adjacent serving path; a mistake in the allow-list is a leak of server source, so witness 2 deserves a reader who is not the builder.
* plan-review due: yes
