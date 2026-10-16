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

Readiness, hubs, wrong-way imports and suggested areas are the reviewer's judgement and are not computed here. Function size and copied code (the earlier prototype's other output) and the dashboard datasets stay on the branch `claude/jolly-knuth-dgn3m1`.
