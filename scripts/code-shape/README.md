# Code shape

Measuring tool behind the Seams & Tangles periodical (LIN-3550).

- `seams.mjs <repoDir> <commit> [areaGuidePath]` reads one git commit straight from the object store (no checkout) and prints JSON, facts only:
  - **links**: imports from one area to another, counted as distinct importer→imported file pairs;
  - **knots**: pairs of areas that import each other both ways (with the crossing files), and the groups of areas that form a cycle;
  - **entry files**: for each area, the files other areas import, and from which areas.
  - Scope is `server.js`, `lib/`, `routes/` and `public/` (`.js`/`.mjs`, not `.min.js`). `scope` in the output lists parse failures, unresolved relative imports, non-literal dynamic imports and files no area claims, so nothing is dropped silently.
  - `public/` holds classic scripts with no import statements, so the browser-code area shows no edges: that means "not wired by imports", not "isolated".
- `areas.json` is the area guide: areas in order, first match wins, each with regex patterns over repo-relative paths. It is a guide, not a rule. The review may propose edits, and nothing enforces it.

To compare two points in time, run the script at both commits **with the same guide** (pass the guide path as the third argument), so a map edit is not mistaken for code movement.

Readiness, hubs, wrong-way imports and suggested areas are the reviewer's judgement and are not computed here. Function size and copied code (the earlier prototype's other output) are measured by the tools below; only the dashboard datasets stay on the branch `claude/jolly-knuth-dgn3m1`.

## The Theseus kit (LIN-3628)

Four more tools beside `seams.mjs`, for the Theseus method (`docs/theseus-method-long.md`, section 13). They share its contract: they read **committed git objects only** (no checkout, so commit before measuring), print **JSON on stdout** and a short summary on stderr, take the area map as `--areas <path>` (a file in the `areas.json` format; the `areas.json` beside the tool if omitted; a missing or malformed explicit path exits 2), and name no repository path. They **report measurements and never gate**: no exit code depends on a number, and nothing here is a threshold or a ratchet. Exit 2 means a usage error or a missing `acorn`.

Each tool is a pure core (file contents in, data out) plus a thin CLI: `census-core.mjs` / `census.mjs`, `census-diff.mjs`, `shape-core.mjs` + `shape-report.mjs` / `shape.mjs`, `verbatim-core.mjs` / `verbatim.mjs`, `perturb-core.mjs` + `tap.mjs` / `probe.mjs`, with `code-shape-lib.mjs` for scope, area map, argv and git reads. The cores use `acorn` (a devDependency); each CLI loads its core with a dynamic `import()` and, if `acorn` is not installed, prints `run npm install` and exits 2. (`verbatim-core.mjs` parses nothing and needs no `acorn`.)

**Scope.** `--include <regex>` and `--exclude <regex>` act on repo-relative paths. Defaults: include `\.(js|mjs|cjs)$`; exclude `node_modules/`, `vendor/` and `vendored/` directories, `.min.js`, `tests/`, `test/` and `__tests__/` directories, and `*.test.*` / `*.spec.*` files. Each flag replaces only its own default, so `--exclude '^$'` brings tests back and `--include` does not drop the default exclude. Harbour's scope, as these tools were first run:

```
--include '^(server\.js$|(lib|routes|public)/.*\.[cm]?js$)'
```

**Area of a file** is the first area in the map whose pattern matches; a file no area claims (or no map) falls under its top-level directory.

### `census.mjs <repo> <commit>` — decisions held in many places

`[--out file.json] [--areas path] [--include rx] [--exclude rx] [--churn-days 90] [--redact rx]`

Finds groups of places that hold one decision: near-duplicate functions, repeated string sets and the switch or if-chains over them, record shapes, named constants, text contracts. Each group lists its sites, files, areas, and churn (commits touching its files in the window ending at the commit); groups are ranked by files × churn. `--redact` replaces matching text in every output string (to keep product names out of a published census). `runCensus` is the original script's body, wrapped; the detectors and thresholds are unchanged. Details and the reasoning for the thresholds: `experiments/consolidate-1-census/report.md`.

`census-diff.mjs <a.json> <b.json>` lists the groups gone and born between two census files. A group's key is its detector and decision text with the statement and copy counts removed, so a count that moved is not a group that went. `groupKey(group)` and `diffCensus(a, b)` are exported.

### `shape.mjs <repo> <commit>` — size and complexity

`[--areas path] [--include rx] [--exclude rx] [--functions]`

Per file: lines (code, comment, blank), functions, longest function, maximum nesting, complexity, regex and string counts, imports. Then totals, and a rollup per area: files, lines, functions, functions over complexity 10 (`unitsOver10`, counting the module unit), decision points, the longest function by code lines, maximum nesting. Files that do not parse are listed under `scope.parseFailures`, files no area claims under `scope.unmappedFiles`. `--functions` adds per-function rows, top-level declarations and exported names to each file (large). The definitions are written into the output (`definitions`) and are `shape-core.mjs`, a copy of `experiments/rebuild-exp1/kit/lib/shape-core.mjs`.

### `verbatim.mjs <repo> <oldCommit> <newCommit>` — rebuilt or edited?

`[--old a.js,b.js] [--new a.js,b.js] [--areas path] [--include rx] [--exclude rx]`

How much of the new code's lines are found word for word in the old. By default both sides are the in-scope files that differ between the commits (a move counts as a delete and an add); `--old` / `--new` name files instead. Reports line counts, new-verbatim and old-surviving share, and the longest run of consecutive verbatim lines within one file (with file and line among the counted lines), raw and with one trailing `;` ignored on each line, plus a **per-region table**: the new file's area from `--areas`, else its top-level directory. New files are matched in sorted path order, so the split between regions is reproducible.

### `probe.mjs <repo> <commit> --target <path> --test-cmd '<cmd>'` — does a test depend on text?

`[--rename-map map.json] [--perturb-module file.mjs] [--node-modules dir] [--timeout ms] [--keep]`

Extracts the commit into a temp directory (`git archive | tar -x`, so `tar` must be on `PATH`; `--node-modules` symlinks a dependency directory in), runs `--test-cmd` there as it stands, then once per rewrite of `--target`, and reports the failing tests each rewrite adds (`addedFailures`) and any that stop failing. The command must print TAP (for Node: `node --test --test-reporter=tap <files>`); failures are found at any depth, in `file :: name` form relative to the tree. Baseline failures are listed as data. The rewrites keep behaviour: `indent` (two spaces on every non-empty line; it changes the text of a multi-line template literal), `nocomment` (comments blanked, line numbers kept), and `rename` (identifiers renamed by the `--rename-map` JSON `{from: to}`; local names only, as every occurrence in code is renamed). `--perturb-module` adds more: a module whose default export is `{name: text => text}`. Each result says whether the AST is unchanged (`astEqual`). The temp tree is removed unless `--keep`.

**Blocking the network is the test command's job**, not the probe's; `experiments/rebuild-exp1/kit/lib/no-network.mjs` is a preload (`NODE_OPTIONS=--import=...`) that does it. The five other rewrites from the original probe anchor on one Harbour module and stay in `experiments/consolidate-4-entrance/4c/probe/`.

### Definitions the measures use

Copied from `docs/theseus-method-long.md`, section 13. The shape tool's own text is `definitions` in `shape-core.mjs`.

- **Complexity** of a function: 1, plus one for each `if`, `?:`, loop, `case` with a test, `catch`, `&&`, `||`, `??`, logical assignment (`&&=`, `||=`, `??=`) and default value (of a parameter or in destructuring); optional chaining (`?.`) does not count, and module-level code is its own unit. **Decision points** for a file: the sum of complexity over its units, less one per unit. These are Harbour's definitions, written into `experiments/rebuild-exp1/kit/lib/shape-core.mjs`; any tool will do if its definitions are written down and kept for the round.
- **Census detectors**, with Harbour's thresholds: structural clones with identifiers renamed (at least 5 statements and 40 syntax nodes); near clones (shingle overlap of 0.7 or more); browser ports of server code (overlap of property names, calls and strings of 0.6 or more, at least 8 names, sizes within twice each other); tiny rules (functions of 1 to 4 statements in 3 or more files); string sets, and switch or if-chains over them (sets merged at two-thirds overlap); records built the same way (3 or more derived keys); named constants (same name and value in 2 or more files); text contracts (headings or bracketed markers in literals in 2 or more files). The trial added single comparisons (one subject compared with the same literal across files), which found two of its six decisions. Details: `experiments/consolidate-1-census/report.md`.
- **Verbatim share**: the share of the new code's non-trivial lines found word for word in the old, matched as a multiset; lines trimmed; blank lines, punctuation-only lines, comments and imports excluded.

### What the tools cannot see

- **Census**: only what its detectors name. Single comparisons (one subject compared with the same literal across files) are not detected yet. Copies that were rewritten past the thresholds, decisions held in data or configuration rather than code, and behaviour shared over the network or a database are invisible. Churn counts commits that touch a group's files, not the decision itself. Groups are candidates for a human to rule on, not findings.
- **Shape**: parses each file as an ES module, so a classic script that is not valid module code is listed under `parseFailures` and not measured. Function counts include callbacks and one-line arrows. It says nothing about whether a long or branching function is a problem.
- **Verbatim**: lines, not meaning. A rename, a reformat that moves line breaks, or a semicolon style change reads as new text (the normalised column covers only a trailing `;`). Matching is a multiset over all old files together, so a line common in the old can be matched by unrelated new code. A moved file counts as a whole rewrite unless both paths are given.
- **Probe**: shows that a test notices a text change, not why. A rewrite that breaks nothing proves only that these three rewrites do not matter to this command. TAP parsing is written against the Node test reporter's output and the probe says so when the unmodified run printed none.
- **All**: committed objects only, so uncommitted work is not measured; JavaScript only; the area map is a guide and is not checked against the code.
