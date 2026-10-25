# Code shape

Measuring tool behind the Seams & Tangles periodical (LIN-3550).

- `seams.mjs <repoDir> <commit> [areaGuidePath]` reads one git commit straight from the object store (no checkout) and prints JSON, facts only:
  - **links**: imports from one area to another, counted as distinct importer→imported file pairs;
  - **knots**: pairs of areas that import each other both ways (with the crossing files), and the groups of areas that form a cycle;
  - **entry files**: for each area, the files other areas import, and from which areas.
  - Scope is `server.js`, `lib/`, `routes/` and `public/` (`.js`/`.mjs`, not `.min.js`). `scope` in the output lists parse failures, unresolved relative imports, non-literal dynamic imports and files no area claims, so nothing is dropped silently.
  - `public/` holds classic scripts with no import statements, so the browser-code area shows no edges: that means "not wired by imports", not "isolated".
- `cochange.mjs <repoDir> <commit> [--areas path] [--days 60]` reads **change coupling**: which areas keep landing in the same change, with no import needed between them. Local git history only, no `acorn`, JSON on stdout and a one-line summary on stderr, facts only:
  - **A change** is one entry of `git log --first-parent --diff-merges=first-parent --name-only --no-renames --format=@%H`, so a squash or rebase commit and a merge commit are each one landed change with its full file list, and a merged PR's branch commits are not split out. `--no-renames` makes a move count on both its old and new path. Needs git 2.31 or newer.
  - **The window** is the `--days` days (default 60) ending at the date of `<commit>`, commits reachable from `<commit>`, both ends inclusive. Run it at two commits with the same guide and the same `--days` for a comparable figure. If committer dates run out of order, an old change can be missed by the date filter.
  - **Areas** come from the `--areas` guide (first match wins, `areas.json` beside the tool if omitted; with no guide at all it exits 2). A file no area claims is **not** put under its top-level directory: it is ignored and counted in `unmappedFiles` (distinct paths across the window).
  - **Report**: the full `commit`, `windowStart`, `windowEnd`, `days`, `changes` read, `shallow` (a shallow clone has a short history), `changesTouchingMultipleAreas`, `unmappedFiles`, and `pairs`: every unordered pair of distinct areas changed in the same change, with the number of changes, most frequent first (ties by area name). A change inside one area gives no pair.
  - **Reports, never gates**: no score, no threshold, no per-file figure (that is the Stability Review's), and no exit code depends on a number. A pair that changes together often with no import link between the areas is a candidate seam, read by the reviewer beside `seams.mjs`'s links.
- `areas.json` is the area guide: areas in order, first match wins, each with regex patterns over repo-relative paths. It is a guide, not a rule. The review may propose edits, and nothing enforces it.

To compare two points in time, run the script at both commits **with the same guide** (pass the guide path as the third argument), so a map edit is not mistaken for code movement.

Readiness, hubs, wrong-way imports and suggested areas are the reviewer's judgement and are not computed here. Function size and copied code (the earlier prototype's other output) are measured by the tools below; only the dashboard datasets stay on the branch `claude/jolly-knuth-dgn3m1`.

## The Theseus kit (LIN-3628)

Six more tools beside `seams.mjs`, for the Theseus method (`docs/theseus-method-long.md`, section 13). They share its contract: they read **committed git objects only** (no checkout, so commit before measuring), print **JSON on stdout** and a short summary on stderr, take the area map as `--areas <path>` (a file in the `areas.json` format; the `areas.json` beside the tool if omitted; a missing or malformed explicit path exits 2), and name no repository path. They **report measurements and never gate**: no exit code depends on a number, and nothing here is a threshold or a ratchet. Exit 2 means a usage error or a missing `acorn`.

Each tool is a pure core (file contents in, data out) plus a thin CLI: `census-core.mjs` / `census.mjs`, `census-diff.mjs`, `census-review-core.mjs` / `census-review.mjs`, `shape-core.mjs` + `shape-report.mjs` / `shape.mjs`, `verbatim-core.mjs` / `verbatim.mjs`, `retention-core.mjs` / `retention.mjs`, `perturb-core.mjs` + `tap.mjs` / `probe.mjs`, with `code-shape-lib.mjs` for scope, area map, argv and git reads. The cores use `acorn` (a devDependency); each CLI loads its core with a dynamic `import()` and, if `acorn` is not installed, prints `run npm install` and exits 2. (`verbatim-core.mjs` parses nothing and needs no `acorn`.)

**Scope.** `--include <regex>` and `--exclude <regex>` act on repo-relative paths. Defaults: include `\.(js|mjs|cjs)$`; exclude `node_modules/`, `vendor/` and `vendored/` directories, `.min.js`, `tests/`, `test/` and `__tests__/` directories, and `*.test.*` / `*.spec.*` files. Each flag replaces only its own default, so `--exclude '^$'` brings tests back and `--include` does not drop the default exclude. Harbour's scope, as these tools were first run:

```
--include '^(server\.js$|(lib|routes|public)/.*\.[cm]?js$)'
```

**Area of a file** is the first area in the map whose pattern matches; a file no area claims (or no map) falls under its top-level directory.

### `census.mjs <repo> <commit>` — decisions held in many places

`[--out file.json] [--areas path] [--include rx] [--exclude rx] [--churn-days 90] [--redact rx]`

Finds groups of places that hold one decision: near-duplicate functions, repeated string sets and the switch or if-chains over them, record shapes, named constants, text contracts. Each group lists its sites, files, areas, and churn (commits touching its files in the window ending at the commit); groups are ranked by files × churn. `--redact` replaces matching text in every output string (to keep product names out of a published census). `runCensus` is the original script's body, wrapped; the detectors and thresholds are unchanged. Details and the reasoning for the thresholds: `experiments/consolidate-1-census/report.md`.

`census-diff.mjs <a.json> <b.json>` lists the groups gone and born between two census files. A group's key is its detector and decision text with the statement and copy counts removed, so a count that moved is not a group that went. `groupKey(group)` and `diffCensus(a, b)` are exported.

### `census-review.mjs <repo> <commit> [previousCommit]` — what the Drift & Coherence review rules on

`[--areas path] [--include rx] [--exclude rx] [--top 25] [--churn-days 90]` (LIN-3629)

Runs the census at the commit and at `previousCommit` with **one area guide, loaded once, for both runs**, so a map edit is not read as code moving. Without `previousCommit` this is the baseline: no statuses, nothing gone. Output is JSON on stdout, a one-line summary on stderr.

- **Rank**: places × change, the census's own `score` (files in the group × distinct commits in the 90 days before the commit's date that touch any of them); ties by more files, then decision text. Structure-only clones the census leaves unranked are counted (`counts.unranked`), not ranked.
- **Rule**: `mustRule` is true for the top `--top` groups and for every group spanning 3 or more areas; every other group with 3 or more files or 2 or more areas is `table`. Two files in one area is neither. No other score exists.
- **Own churn**: distinct commits in the same window that add or remove, in the group's files, a line matching a pattern built from the group's literals (`git log -G`): the string members for set and discrim groups, the constant's name for const, the marker or heading for contract, the quoted value for `cmp`. The pattern is printed beside the number. It is an **upper bound** for common words (`'test'` matches any quoted `test`; a constant name matches longer names that contain it). Clone and record groups have no literal, so their `ownChurn` is `null`, not `0`. Only `mustRule` and `table` groups are read.
- **Status** against `previousCommit`, matched with `groupKey`: `new`, `grown` or `shrunk` (by site count) or `unchanged`; groups only in the previous run are listed under `gone`. `groupKey` includes a set group's site kinds and label, so a group that gained a new kind of site, or a differently named one, can read as `gone` plus `new` instead of `grown`; the kit does not try to fix that.
- `sites` (file:line) are listed only on `mustRule` groups. Cost: about one `git log -G` per flagged group.

Like the other tools it reports and never gates: no exit code depends on a number.

### `shape.mjs <repo> <commit>` — size and complexity

`[--areas path] [--include rx] [--exclude rx] [--functions]`

Per file: lines (code, comment, blank), functions, longest function, maximum nesting, complexity, regex and string counts, imports. Then totals, and a rollup per area: files, lines, functions, functions over complexity 10 (`unitsOver10`, counting the module unit), decision points, the longest function by code lines, maximum nesting. Files that do not parse are listed under `scope.parseFailures`, files no area claims under `scope.unmappedFiles`. `--functions` adds per-function rows, top-level declarations and exported names to each file (large). The definitions are written into the output (`definitions`) and are `shape-core.mjs`, a copy of `experiments/rebuild-exp1/kit/lib/shape-core.mjs`.

### `verbatim.mjs <repo> <oldCommit> <newCommit>` — rebuilt or edited?

`[--old a.js,b.js] [--new a.js,b.js] [--areas path] [--include rx] [--exclude rx]`

How much of the new code's lines are found word for word in the old. By default both sides are the in-scope files that differ between the commits (a move counts as a delete and an add); `--old` / `--new` name files instead. Reports line counts, new-verbatim and old-surviving share, and the longest run of consecutive verbatim lines within one file (with file and line among the counted lines), raw and with one trailing `;` ignored on each line, plus a **per-region table**: the new file's area from `--areas`, else its top-level directory. New files are matched in sorted path order, so the split between regions is reproducible.

### `retention.mjs <repo> <baseCommit> <headCommit>` — which comment refs did a rebuild drop?

`[--include rx] [--exclude rx]` (LIN-3829)

Lists the `LIN-###` refs that the base commit's in-scope comments cite and the head commit's do not. Each drop gives the base files that cited it and `citedElsewhereAtHead`: the unchanged in-scope head files that still cite it in a comment. Refs come from comments only (acorn `onComment`, never text search), pooled across every changed file per commit, so a ref moved between files in the same commit is not a drop. `LIN-622/623` counts as two refs; the comma form is not read. A file that does not parse on either side is left out of both pools and listed under `parseFailures`. The report also carries `linRefs` and `commentLines` for both commits. The head tree is read only when something was dropped. Diffs use `--no-renames`, so a moved file is a delete plus an add and its refs stay pooled. Reports, never gates: exit 0 whatever the list holds.

### `probe.mjs <repo> <commit> --target <path> --test-cmd '<cmd>'` — does a test depend on text?

`[--rename-map map.json] [--perturb-module file.mjs] [--node-modules dir] [--timeout ms] [--keep]`

Extracts the commit into a temp directory (`git archive | tar -x`, so `tar` must be on `PATH`; `--node-modules` symlinks a dependency directory in), runs `--test-cmd` there as it stands, then once per rewrite of `--target`, and reports the failing tests each rewrite adds (`addedFailures`) and any that stop failing. The command must print TAP (for Node: `node --test --test-reporter=tap <files>`); failures are found at any depth, in `file :: name` form relative to the tree. Baseline failures are listed as data. The rewrites keep behaviour: `indent` (two spaces on every non-empty line; it changes the text of a multi-line template literal), `nocomment` (comments blanked, line numbers kept), and `rename` (identifiers renamed by the `--rename-map` JSON `{from: to}`; local names only, as every occurrence in code is renamed). `--perturb-module` adds more: a module whose default export is `{name: text => text}`. Each result says whether the AST is unchanged (`astEqual`). A rewrite that throws (say `nocomment` on a file `acorn` cannot parse) is reported as `{rewrite, error}` and the others still run. The temp tree is removed unless `--keep`.

**Blocking the network is the test command's job**, not the probe's; `experiments/rebuild-exp1/kit/lib/no-network.mjs` is a preload (`NODE_OPTIONS=--import=...`) that does it. The five other rewrites from the original probe anchor on one Harbour module and stay in `experiments/consolidate-4-entrance/4c/probe/`.

### Definitions the measures use

Copied from `docs/theseus-method-long.md`, section 13. The shape tool's own text is `definitions` in `shape-core.mjs`.

- **Complexity** of a function: 1, plus one for each `if`, `?:`, loop, `case` with a test, `catch`, `&&`, `||`, `??`, logical assignment (`&&=`, `||=`, `??=`) and default value (of a parameter or in destructuring); optional chaining (`?.`) does not count, and module-level code is its own unit. **Decision points** for a file: the sum of complexity over its units, less one per unit. These are Harbour's definitions, written into `experiments/rebuild-exp1/kit/lib/shape-core.mjs`; any tool will do if its definitions are written down and kept for the round.
- **Census detectors**, with Harbour's thresholds: structural clones with identifiers renamed (at least 5 statements and 40 syntax nodes); near clones (shingle overlap of 0.7 or more); browser ports of server code (overlap of property names, calls and strings of 0.6 or more, at least 8 names, sizes within twice each other); tiny rules (functions of 1 to 4 statements in 3 or more files); string sets, and switch or if-chains over them (sets merged at two-thirds overlap); records built the same way (3 or more derived keys); named constants (same name and value in 2 or more files); text contracts (headings or bracketed markers in literals in 2 or more files); repeated single comparisons, `cmp` (LIN-3629: one subject's last name compared with the same string literal, `===`, `!==`, `==`, `!=` or a `switch` `case`, in 2 or more files; `typeof` checks are dropped, a constant counts as its literal, and a comparison already inside a set or chain site that forms a group is not counted again). The trial's version of this found two of its six decisions. Details: `experiments/consolidate-1-census/report.md`.
- **Verbatim share**: the share of the new code's non-trivial lines found word for word in the old, matched as a multiset; lines trimmed; blank lines, punctuation-only lines, comments and imports excluded.

### What the tools cannot see

- **Census**: only what its detectors name. `cmp` keys on the subject's last name, so the same name on two different objects (`action == 'abort'` on two verdicts) is one group; that is why the review rules on it. A comparison against a non-literal, or a subject with no name (`a[i] === 'x'`), is not seen. Copies that were rewritten past the thresholds, decisions held in data or configuration rather than code, and behaviour shared over the network or a database are invisible. Churn counts commits that touch a group's files, not the decision itself. Groups are candidates for a human to rule on, not findings.
- **Retention**: refs, not reasons. A ref kept in a stale comment counts as retained; a reason comment with no `LIN-` ref is not counted; only `LIN-n` and slash refs are read.
- **Shape**: parses each file as an ES module, so a classic script that is not valid module code is listed under `parseFailures` and not measured. Function counts include callbacks and one-line arrows. It says nothing about whether a long or branching function is a problem.
- **Verbatim**: lines, not meaning. A rename, a reformat that moves line breaks, or a semicolon style change reads as new text (the normalised column covers only a trailing `;`). Matching is a multiset over all old files together, so a line common in the old can be matched by unrelated new code. A moved file counts as a whole rewrite unless both paths are given.
- **Probe**: shows that a test notices a text change, not why. A rewrite that breaks nothing proves only that these three rewrites do not matter to this command. TAP parsing is written against the Node test reporter's output and the probe says so when the unmodified run printed none.
- **All**: committed objects only, so uncommitted work is not measured; JavaScript only; the area map is a guide and is not checked against the code.
