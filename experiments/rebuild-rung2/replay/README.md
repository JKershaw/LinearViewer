# roadmap render replay

This tool compares the behaviour of any two versions of Harbour's
`lib/render-roadmap.js` (`renderRoadmapPage(data, options)` → HTML). It renders
the same inputs through both versions and reports every place where the output
differs. It doesn't write to `/home/user/LinearViewer` and it never touches the
network.

```sh
node replay.mjs <oldRendererFile> <newRendererFile> [--n 3000] [--seed 1] [--out report.json]
     [--coverage] [--now 2026-10-14T12:00:00.000Z] [--norm collapse|between-tags]
     [--old-lib DIR] [--new-lib DIR] [--model-lib DIR] [--recapture] [--dump <inputId>] [--quiet]
node selfcheck.mjs [--n 3000]          # runs the self-checks below (about 80 s)
```

To get the pinned main version, run
`git -C /home/user/LinearViewer show c2bc9a65:lib/render-roadmap.js > old.js`.

Exit codes: `0` means every input gave the same output, `1` means at least one
difference, `2` means the tool itself failed. If you don't pass `--out`, the
report goes to `work/report.json`.

## What it does

1. **Loading the renderer.** Each version is copied to
   `work/copies/<old|new>-<sha>.mjs`. Every relative import (`./utils/html.js`,
   `./components/…`) is rewritten to an absolute `file://` URL under
   `--old-lib`/`--new-lib` (default `/home/user/LinearViewer/lib`, which is
   main). The rewrite keeps every line in place, so coverage line numbers match
   the original file. If a version imports a module that main doesn't have, the
   tool stops and asks for `--new-lib`.
2. **Side effects at import time.** The tool records new globals, active
   handles, process listeners, env changes and network attempts that appear
   while each copy is imported. Today there are none. What is known:
   - `lib/providers/*/index.js` calls `registerProvider()` when imported. Both
     copies share that registry unless their lib directories differ.
   - `lib/sample-data/mock-data.js` computes its `daysAgo()` dates when the
     module loads, so the tool imports it only after freezing the clock.
3. **Fixed environment.**
   - `TZ=UTC`, because the footer formats `deployInfo.createdAt` in local time.
   - `GITHUB_*`, `JIRA_*`, `EMAIL_*` and `RESEND_*` are cleared and `NODE_ENV`
     is set to `production`, because the navbar's provider and email
     availability checks read them.
   - The clock is frozen: `globalThis.Date` is replaced by a subclass whose
     no-argument constructor and `Date.now()` return `--now`. It is restored
     afterwards.
   - `Math.random` is reseeded before each render.
   - Every network API (`net`, `tls`, `dns`, `http(s)`, `fetch`) throws if
     called, and each attempt is counted.
4. **Inputs.** Each tier is listed separately in `totals.byTier`.
   - `test`: the exact `(data, options)` of all 19 `renderRoadmapPage` calls in
     the four test files: `roadmap-integration`, `roadmap-model-override`,
     `page-title-primitive` and `render-team-selector-threading`. They are
     captured by running the files, pinned from git, under the same frozen
     clock with a loader hook that swaps the renderer for a recording shim
     (`lib/capture-*.mjs`). The capture is cached in `work/captured-*.v8`; use
     `--recapture` to redo it.
   - `mock`: `testMockData` passed through `buildRoadmapModel`, with the
     options that `server.js` passes, in 4 variants.
   - `edge`: hand-written roadmap models such as `{}`, no `roadmapModel`, an
     empty Map or object for `criticalPaths`, and the model shapes from the
     summarize/chat tests. Each is rendered with AI on and off.
   - `target`: 42 named cases that hit specific boundaries:
     - "This week", "Last week" and "Earlier" buckets with 13–25 items, and
       buckets that span projects.
     - Ages of exactly 7, 14 and 90 days, and ±1 ms around each.
     - Completed items whose `stateName` is not "Done".
     - Blocking chains of length 2 and 4, a cycle, and a cross-project block.
     - A parent where only a child is started.
     - A project with no issues, and issues with no project ("Unassigned").
     - The characters `<>&"'` in every string.
     - Model pricing that isn't a number, teams that don't match
       `selectedTeamId`, a null `urlKey`, an empty org name, and `deployInfo`
       with and without `createdAt`.
   - `gen-a` (60% of `--n`): random seeded projects and issues in the shape the
     providers produce, run through main's real `buildRoadmapModel`. Options
     vary as well: `openRouterSource`, all `FEATURE_KEYS`, teams and
     `selectedTeamId`, workspaces, `availableModels` with and without pricing,
     `deployInfo`, and occasionally `null` options.
   - `gen-b` (40% of `--n`): roadmap models built directly in shapes
     `buildRoadmapModel` can't produce. Examples are a plain-object
     `criticalPaths`, missing totals or progress fields, unknown severities,
     risks for projects that don't exist, completed tasks still in the queue,
     path IDs that aren't in the execution queue, bad `completedAt` values,
     `rollup: null` with subtasks, and missing velocity fields. The mutations
     applied to each case are listed in `differing[].meta`.

   Every generated case has its own seed derived from `(seed, tier, index)`,
   so `gen-a:1234` comes out the same at any `--n`. Use `--dump gen-a:1234` to
   write that case's input and both HTML outputs to `work/dump/`.
5. **Comparison.**
   - With the default `--norm collapse`, each run of whitespace becomes one
     space, except inside `<pre>`, `<textarea>`, `<script>` and `<style>`. A
     space versus no space between tags still counts as a difference.
     `--norm between-tags` removes whitespace between tags entirely.
   - The `window.__ROADMAP_DATA__` script is taken out of the HTML, parsed and
     compared as data, so key order doesn't count.
   - An input is identical when both the HTML and the JSON match, or when both
     versions throw the same error.
   - For each difference the report gives a signature, before and after
     excerpts around the first difference (marked `⟦`), the context of the
     last difference, and the size of the changed span. The signature is the
     path of open elements (`tag#id.class`) plus where the change falls: tag
     name, `@attribute`, `#text`, `^<newElement>`, or `#script-content`. For
     the JSON it is a path such as `$.milestones[].name`. Differences are
     grouped by signature, and also more coarsely by the old-side context
     (`coarseGroups`). Errors thrown by either version are listed in `throws`.
6. **Coverage** (`--coverage`). The tool uses V8 precise coverage through
   `node:inspector`, so it needs no c8. It reports line coverage of each copy
   (blank and comment-only lines are excluded), counts of executed and
   never-executed blocks, and figures for three subsets: the existing tests
   plus mock data, all fixtures, and everything.

## Self-check results (n=3000, seed 1, 3,105 inputs)

All seven checks pass.

| check | result |
|---|---|
| old vs old | 0 differing |
| class `ship-bucket-heading` renamed | 2,463 differing, 1 group |
| `escapeHtml` removed on the ship-item title | 1,879 differing: gen-a 1,100, gen-b 777, target 2, **test 0** |
| JSON value change (`trend` default) | 340 differing, found through the JSON comparison |
| JSON keys reordered only | 0 differing, correctly ignored |
| indentation-only change | 0 differing, correctly ignored |
| space between tags removed | 3,067 differing |

**Coverage of the c2bc9a65 copy:**
- Lines: 375 of 375 (100%).
- Blocks: 160 of 162 executed. The two that never run are at L88
  (`item.projectName || ''`) and L89 (`item.completedAt ? … : ''`).
  `buildShipLog` always sets `projectName` and filters out items without
  `completedAt`, so neither can ever run.
- The existing tests plus mock data alone reach 98.4% of lines and 93 blocks.
  They never reach L129–134, the "Show N more" overflow.

## Limits

- Only the first difference in each output is described in detail. Later
  differences in the same input show up only as `lastDiffContext` and
  `changedSpan`.
- Signatures include class names, so one root cause can be split into a few
  groups, for example when classes like `hidden` vary with the data. Check
  `coarseGroups` as well.
- Line coverage counts a line as covered if any part of it ran. Block counts
  are the stricter measure.
- `buildRoadmapModel` always comes from main (`--model-lib`), so this tool
  tests the renderer only. Each input is built once and then deep-copied for
  each version.
- Navbar and footer output depend on the fixed environment above. Setups with
  GitHub, Jira or email configured aren't exercised.
- The only page script treated as data is `window.__ROADMAP_DATA__`. If a
  rewrite moves that payload elsewhere, the move shows up as a difference
  (`removed`/`added`).
