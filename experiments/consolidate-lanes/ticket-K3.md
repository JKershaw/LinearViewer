TITLE: Seams: untie Other features ↔ Runs & dispatch by moving the periodical gate marker to its owner (builder, parser and slug: lib/periodical-report-gate.js → lib/periodicals.js)

PARENT: LIN-3549 · PROJECT: Quality, Periodicals & Measurement · PRIORITY: High · STATE: Todo

**Goal.** Untie the Other features ↔ Runs & dispatch knot by moving the periodical marker's format to the module that writes it and maps it back. The area map stays unchanged, and so does behaviour. Knots go down by one (18 → 17 at `47d87055`) with no new knot.

**Why.**
* **The rule.** Code belongs to the area that would have to change if its rule changed. When a single import holds a knot, find the decision that import carries. Then move that decision to its owner, or invert the dependency. Don't edit the map.
* **The knot, Other features ↔ Runs & dispatch, 1 / 2.** At `47d87055` (origin/main), `node scripts/code-shape/seams.mjs . origin/main scripts/code-shape/areas.json` shows this pair.
  * Other → Runs (1): `lib/periodicals.js:1` imports `buildPeriodicalGateMarker`, `extractPeriodicalGateId` and `slugifyPeriodicalTitle` from `lib/periodical-report-gate.js`. It is periodicals.js's only import.
  * Runs → Other (2): `lib/dispatch-entrance.js:52` and `lib/dispatch-validation.js:17` import from `lib/periodicals.js`. LIN-3604 (#1913) moved the first of these out of `routes/dispatch.js`.
* **Who writes the marker, and who reads its value.**
  * `lib/periodicals.js` writes the marker into every minted task's prompt (`:161-166`).
  * It maps the marker back to a registry id: `resolvePeriodicalIdFromGateMarker` (`:964-997`, LIN-2575) re-slugifies every template title to find the match. Its comment says `lib/periodicals.js` "stays the source of truth for the mapping" (`:985`).
  * The gate reads the marker only for presence (`checkPeriodicalReportGate`, `periodical-report-gate.js:160-162`). It echoes the id in its result, but no caller reads it: `routes/proxy-writes.js:364-378` uses only `applies`, `ok`, `message` and `code`. Its own comment on the slug says the gate "keys off marker PRESENCE, not the id's exact value" (`:41-47`). `routes/proxy-writes.js:365` also uses it only as a presence check.
* **Who would have to change.**
  * If the slug rule changed, the periodicals join would break and the gate would not notice.
  * If the marker format changed, the mint and the mapping would change, but the gate's own rule would not. That rule is the Done-transition evidence bar: a commit, PR or blob URL, and an adversarial second read (`:86-198`, LIN-694, LIN-2323).
  * So the format is the periodicals' decision. The gate keeps the Done rule and stays in Runs & dispatch, where the other completion and evidence modules are.
* **The counter-reading, and why it is rejected.** LIN-694 created the marker for the gate, so one could say the gate owns it. That would make the gate a periodicals file that the map put in Runs (`areas.json:24`), and the only fix would be to the map. It is rejected because the gate's real decision, the evidence bar, is a run-completion rule. Only the identity format is the periodicals'.
* **No cycle.** After the move `lib/periodicals.js` imports nothing, and the gate imports `lib/periodicals.js`.

**Decision.**
* **Move the marker.**
  * Cut `MARKER_ATTR`, `MARKER_RE` and the three functions with their doc comments (`periodical-report-gate.js:37-84`) out of the gate.
  * Paste them, unchanged, at the top of `lib/periodicals.js`, in place of its import line (`:1`). Leave no copy in the gate.
  * Add a short reason comment above them that cites this ticket and LIN-694.
* **The gate imports the parser.** Add `import { extractPeriodicalGateId } from './periodicals.js';` to the gate, for `checkPeriodicalReportGate` (`:161`).
* **The re-export is your call.**
  * The preferred route is to repoint the importers and add no re-export:
    * `routes/proxy-writes.js:46` splits into `checkPeriodicalReportGate` from the gate and `extractPeriodicalGateId` from `../lib/periodicals.js`;
    * the tests: `tests/unit/periodical-report-gate.test.js:3-10` (split the import), `periodicals.test.js:10`, `proxy-periodical-report-gate-route.test.js:19`, `dispatch-route-periodical-id.test.js:28` and `periodical-runs.test.js:56`.
  * If you keep a re-export instead, state your reason in the PR. Write it as a plain `import` plus `export { … }` in the gate, never `export … from`.
  * Both routes untie the knot. Their non-knot numbers differ, and both sets are listed below.
* **Comments that govern the moved code.**
  * `buildPeriodicalGateMarker`'s doc ends "before applying the report-persistence gate below" (`:62-63`). After the move it is not below, so name `lib/periodical-report-gate.js` instead.
  * `resolvePeriodicalIdFromGateMarker`'s doc cites "(`slugifyPeriodicalTitle`, lib/periodical-report-gate.js)" (`periodicals.js:975`). Correct that location.
  * `slugifyPeriodicalTitle`'s doc (`:41-47`) names `lib/periodicals.js` and says the slug is for logging only. After the move, refer to `PERIODICALS` below instead. Add that `resolvePeriodicalIdFromGateMarker` re-slugifies titles to map a marker back to its id (LIN-2575). Keep "the gate keys off marker PRESENCE".
  * Leave the older "routes/proxy.js" mentions alone: `periodical-report-gate.js:61`, which moves with that doc into `lib/periodicals.js`, and `periodicals.js:163`. The handler is now in `routes/proxy-writes.js`. That staleness predates this ticket and is out of scope.
* **What stays untouched.**
  * No edits to `scripts/code-shape/areas.json`.
  * The gate keeps `EVIDENCE_URL_RE`, `hasReportEvidenceComment`, `hasAdversarialReadEvidenceComment` and `checkPeriodicalReportGate`, all unchanged.
  * **Don't touch LIN-3604's files:** `lib/dispatch-entrance.js`, `routes/dispatch.js`, `routes/proxy-dispatch.js` and `routes/proxy-kickoff.js`. Don't touch `lib/dispatch-validation.js` either. Their imports from `lib/periodicals.js` stay as they are.
  * Don't touch the sibling seams tickets' files (`lib/tree.js`, `lib/providers/state-map.js`, `lib/graph-features.js`, `lib/linear.js`, `routes/proxy.js`, `routes/proxy-compute.js`, `lib/token-refresh.js`, `lib/providers/interface.js`, `lib/providers/jira/oauth.js`).
  * No doc names the marker's location (`docs/architecture/`, `llms.txt`).
* **Source-text tests.**
  * No test reads `lib/periodicals.js` or `lib/periodical-report-gate.js` as text (searched at `47d87055`).
  * `tests/unit/periodical-report-gate.test.js:34` asserts the marker's text shape. That is behaviour and is unaffected.
  * `scripts/survey-hides-*.mjs` name `lib/periodicals.js` as a file to survey and match the marker text. They are unaffected.
  * If you find a test that pins the moved code's location, convert it to a behaviour test, and show the replacement failing first.
* **No behaviour change.**
  * No function body changes.
  * Keep every ticket reference and reason comment beside the code it governs. They move with it.
  * **Existing tests.** Show behaviour is unchanged with these test files: `periodicals`, `periodical-report-gate`, `proxy-periodical-report-gate-route`, `dispatch-route-periodical-id`, `periodical-runs`, `proxy-periodicals-route`, `dispatch-payload-validation` and `lin-3136-m2-session-declared`.
  * **The replay.**
    * Load the old modules from an export of `origin/main` (`git archive origin/main`) and the new ones from your branch, in one scratch script.
    * Compare, on the same inputs, the result or the error class and message of:
      * `slugifyPeriodicalTitle` and `buildPeriodicalGateMarker`, on every live template title, empty, `undefined`, `null`, numbers, non-ASCII, punctuation-only and generated strings;
      * `extractPeriodicalGateId` and `resolvePeriodicalIdFromGateMarker`, on non-strings, plain prose, markers with odd case or spacing, a bad id, an empty id, a removed template, and every built marker inside a description;
      * `checkPeriodicalReportGate`, on those descriptions crossed with no comments, evidence only, and evidence plus a second read, and with completed, started and missing target states;
      * `getPeriodicals()` and `buildPeriodicalNodes()`, compared as JSON.
    * Don't commit the replay. Paste the script and its output into the PR.
* **Verify the untie.**
  * Commit first. `seams.mjs` reads the git object store, not your working tree.
  * Compare against the `origin/main` you branched from. Run `node scripts/code-shape/seams.mjs . origin/main scripts/code-shape/areas.json` and `node scripts/code-shape/seams.mjs . HEAD scripts/code-shape/areas.json`, both with the same `areas.json`.
  * Paste into the PR: the knot count before and after, the knot line before and its absence after, and the pair counts of every knot that changed.
  * **Expected knot changes.**
    * Other features ↔ Runs & dispatch, 1 / 2, disappears.
    * No other knot pair or group changes.
    * These numbers are at `47d87055`. Take your "before" from your own `origin/main` run. If a sibling seams ticket merged first, only two totals differ: the knot count and the link rows are each one lower per merged sibling. The expected result is then "knots N → N−1, link rows R → R−1", and cross-area imports go up by one on the preferred route or stay the same with a re-export. Every pair, link and entry-file count listed here is unaffected by the siblings, and must match exactly.
  * **Expected changes outside the knots, preferred route (no re-export).**
    * Three links change: Other → Runs 1 → gone, Runs → Other 2 → 3 (the gate → `lib/periodicals.js`), and Agent → Other 2 → 3 (`routes/proxy-writes.js` → `lib/periodicals.js`).
    * Area→area link rows go 62 → 61, and cross-area imports go 887 → 888.
    * Entry files change:
      * `lib/periodicals.js` goes from 6 importers to 8, with its importing areas unchanged.
      * `lib/periodical-report-gate.js` loses Other features as an importing area (2 importers → 1).
  * **With a re-export and no repointed importers** (`routes/proxy-writes.js` and the five tests unchanged), the numbers are the same except: Agent → Other stays at 2, cross-area imports stay at 887, and `lib/periodicals.js` goes from 6 importers to 7.
  * If any other knot pair or group changes, or a new knot pair appears, stop and say so in the PR rather than working around it.

**This is one PR. Don't split it into child tickets.**

Don't start parallel forks or background sub-agents; do the parts one at a time. While iterating, run the unit tests for the files you change; run the full unit suite once before opening the PR. Leave e2e to CI; run it locally only to reproduce a CI failure.

No live checks; no paid model calls.

**Done when.** Merged with `ci-success` green, and the PR showing the seams output before and after (this knot gone, no new knot) and the replay script and output.

**Out of scope.** Every other knot, including the sibling seams tickets. The stale "routes/proxy.js" mentions. Moving tests between test files. The area guide and `scripts/code-shape/areas.json`.
