# Score: K1 (LIN-3606, #1915) and K3 (LIN-3610, #1916)

Repo `/home/user/LinearViewer`, read only. `git fetch -q origin main` gave origin/main = `ab85eb9e`, which is the K3 merge.

- **K1:** old = `675c0d33` (LIN-3605), new = `6ae4c0e4`.
- **K3:** old = `6ae4c0e4`, new = `ab85eb9e`.
- **Branch bases:** K3's PR branch (`2a5899c2`) was cut from `675c0d33`, in parallel with K1, whose PR branch started from `47d87055`. K3 merged on top of K1 cleanly: `git patch-id` of the merge's diff equals the branch commit's.
- **Between the prediction tree and K1's old commit:** `47d87055` → `675c0d33` changes nothing in seams (identical totals and pairs).
- **Exports:** the trees are under `t-<sha>/` in this folder (`git archive`).
- **areas.json:** `scripts/code-shape/areas.json` has the same blob hash (`da83747…`) at `47d87055`, `675c0d33`, `6ae4c0e4` and `ab85eb9e`, so it is unchanged. `seams.mjs` is unchanged across them too.

## Knots on origin/main now: **16**

`47d87055` → `ab85eb9e`: knots 18 → 16, link rows 62 → 60, cross-area imports 887 → 888. Files stay at 432, unresolved / unmapped at 4 / 0, and there is one knot group of the same 9 areas.

Auth ↔ Providers 9/1 is still present, because K2 was dropped.

Files: `seams-*.out`, `cmp-*.txt`, `tools/cmp-seams.mjs`.

## K1: isBlocked → lib/providers/state-map.js

### (1) Seams, 675c0d33 → 6ae4c0e4

- Knots 18 → **17**; link rows 62 → 61; cross-area imports 887 → 887. Files, unresolved and unmapped are unchanged, and so are the groups.
- KNOT GONE: Agent API (proxy) ↔ Front end: server-rendered pages, 2/1.
- KNOT CHANGED: Agent ↔ Providers, 17/6 → 19/6. This is the only other pair change, and it was expected.
- No new knot.
- Links: Agent → pages 2 → 0; Agent → Providers 17 → 19.
- Entry files:
  - `lib/tree.js` 15 → 13, losing Agent API;
  - `lib/providers/state-map.js` 6 → 8, gaining Agent API.
- Area sizes and internal import counts are unchanged.
- pages → Agent stays a one-way link of 1.
- **Matches the ticket's expected list exactly.**

### (2) Diff: 8 files, +65 / −34

- **Code:**
  - The `isBlocked` body is byte-identical. The function text is the same as the old `tree.js` copy (extracted-text diff, and `Function#toString` equal).
  - It is inserted after `isCompleted`, and the rest of `state-map.js` is unchanged.
  - The copy in `tree.js` is gone. No other definition of `isBlocked` exists, apart from `experiments/.../pinned/` snapshots, which are frozen copies.
- **Re-export:** `tree.js` uses the plain import plus `export { isTerminalState, isCompleted, isBlocked }`, with no `export … from`.
  - The proxy routes changed the import specifier only (`proxy-compute.js:20`, `proxy.js:79`).
  - `recommendation-facts`, `workspace-api-mocks` and the `tree` / `linear` tests still import from `tree.js`.
- **Comments, all as the ticket asked:**
  - The moved doc comment keeps LIN-330 and LIN-357, and names LIN-3606, the new home and the state-semantics reason. One line was left unwrapped, at 115 columns (`state-map.js:38`), which is cosmetic.
  - The LIN-174 note in `tree.js` is extended.
  - `graph-features.js`: the cycle reason is withdrawn, the parameter is kept, the reason is given (signature and callers), and the `@param` example now names `state-map.js`.
  - `linear.js`: the `isBlocked` / `selectFocusSubtask` homes are corrected, as a comment-only change.
- **Not in the ticket's list:**
  - `lib/recommendation-facts.js:21`: a header comment edit ("owned by providers/state-map.js, re-exported from tree.js"). The ticket said this comment "stays true and needs no edit". The edit is harmless.
  - **A new test, `tests/unit/lin-3606-isblocked-owner.test.js` (+22).** It checks object identity across `tree.js` and `state-map`, plus five behaviour cases.
- **Review round:** the first PR commit (`badbf34d`) had:
  - `readFileSync` source-text location pins in that test;
  - the `graph-features` and `linear.js` comments not yet fixed.
  
  Review findings 1-4 removed the pins and fixed the comments (`242ac206`). The final tree has no source-text pin.
- **Shim:** only the `tree.js` re-export, which the ticket allowed. Areas, the `render-runner-setup` / `proxy-scopes` files, `context-graph` and the sibling files are untouched.

### (3) Independent replay (`tools/replay-k1.mjs` → `replay-k1.txt`)

- **Inputs: 70,272.**
  - 62,272 enumerated:
    - 26 container shapes, including null, non-array, array-like, a throwing getter, a throwing `type` getter and a sparse array;
    - 248 single relations: 11 relation types × 22 issue/state variants, plus odd entries;
    - every ordered pair of those (61,504).
  - 4,000 random inputs under each of two seeds (1 and 20261017).
- **Result:**
  - old (`tree.js` @`675c0d33`) vs new (`state-map.js` @`6ae4c0e4`): **0 differences**, including identical error class and message on every throw (1,360 TypeErrors, plus the RangeError and SyntaxError getters);
  - new vs main (`ab85eb9e`): 0.
- **Self-checks:**
  - old vs old, on a distinct module instance: 0;
  - mutant with the terminal check dropped (`mut-k1/`): **1,516** differences, so it was caught.
- **Identity:** at `6ae4c0e4`, `tree.isBlocked`, `recommendation-facts.isBlocked` and both `isTerminalState` re-exports are the same object as state-map's. `tree.isBlocked` is also the same object at `ab85eb9e`.

### (4) Census, 675c0d33 → 6ae4c0e4

309 groups / 1,021 sites → 309 / 1,021, with identical per-detector totals. No group was born, lost or changed.

### (5) Prediction (prediction-K1.md)

**Hits:**
- The move, body byte-identical, after `isCompleted`.
- The `tree.js` import and plain re-export.
- Both route specifiers.
- All four comment fixes, in the final tree.
- `areas.json` untouched.
- Every seams row:
  - 432; 4 / 0; 62 → 61; 887 → 887; 18 → 17; one group of 9;
  - the pair gone, and Agent ↔ Providers 19/6;
  - both link changes;
  - both entry-file changes;
  - area sizes the same;
  - two new crossings, no new knot;
  - pages → Agent still a one-way 1.
- No behaviour change: the replay found 0 differences.
- None of the falsifiers fired.

**Misses:**
- **"No test changes":** a new test file was added.
- **Diff size:** "6 files, +39 / −35" was predicted; the actual is **8 files, +65 / −34**.
  - The two extra files are `recommendation-facts.js` (comment) and the new test.
  - On the six predicted files the actual is +43 / −33:
    - `state-map.js` +24 / 0 (predicted +25 / 0);
    - `tree.js` +7 / −25 (predicted +5 / −27);
    - `graph-features.js` +6 / −4 (predicted +5 / −4);
    - `linear.js` +3 / −2 (predicted +2 / −2);
    - the routes exact.
  - These are comment-wording deltas. The code lines are exact.

**Not checkable here:**
- **The "under 45 min" run time.** The dispatch time is not recorded. The first commit was at 15:04, the review fix at 15:20, and the merge at 15:27; the prediction file is dated 14:01.
- **`ci-success`.** That would need the API.
- I did not re-run the unit tests.

## K3: the periodical marker → lib/periodicals.js

### (1) Seams, 6ae4c0e4 → ab85eb9e

- Knots 17 → **16**; link rows 61 → 60; cross-area imports 887 → **888**.
  - This is the ticket's "sibling merged first" form: N → N−1, R → R−1, cross +1 on the preferred route.
  - Files, unresolved and unmapped are unchanged, and so are the groups.
- KNOT GONE: Other features ↔ Runs & dispatch, 1/2.
- No other pair changed, and there is no new knot.
- Links: Other → Runs 1 → 0; Runs → Other 2 → 3; Agent → Other 2 → 3.
- Entry files:
  - `lib/periodicals.js` 6 → 8, with the same importing areas;
  - `lib/periodical-report-gate.js` 2 → 1, losing Other features.
- Area sizes are unchanged.
- **Matches the ticket's preferred-route list exactly.**

### (2) Diff: 9 files, +68 / −62

- **Route:** the preferred route, with no re-export. The gate exports none of the three moved symbols.
- **Moved code:** `MARKER_ATTR`, `MARKER_RE` and the three functions are byte-identical to the gate's old copies (extracted-text diff).
  - They replace `periodicals.js`'s only import line.
  - The reason comment cites LIN-3610 and LIN-694.
  - No copy is left in the gate, and no other definition exists.
- **Gate:**
  - +1 line: `import { extractPeriodicalGateId } from './periodicals.js'`;
  - −48 lines, all of them moved;
  - the evidence bar is untouched.
- **No cycle:** `periodicals.js` now has no static import and no dynamic import.
- **Repointed importers:**
  - `routes/proxy-writes.js` split its import, as the ticket said;
  - the five named tests were repointed;
  - `periodicals.test` and `periodical-runs.test` merged the moved name into their existing `periodicals.js` import, hence −2 rather than −1.
- **Comments:**
  - "gate below" now names `(lib/periodical-report-gate.js)`.
  - The resolve doc now says "(`slugifyPeriodicalTitle`, above)".
  - The slug doc refers to `PERIODICALS[].id` "below", adds the LIN-2575 re-slugify join, and keeps "PRESENCE". It also dropped the old "for logging/diagnostics" clause, which is consistent with the ticket's reasoning.
  - The stale `routes/proxy.js` mentions were left alone, as the ticket said.
- **Not in the ticket's list:**
  - **`experiments/rebuild-rung5c/replay/replay.mjs`** (+1 / −2). Its `loadVocabulary` imported `gate.buildPeriodicalGateMarker`, which would break on the no-re-export route, so it now uses `per.buildPeriodicalGateMarker`. The edit is necessary. One side effect: running that tool with `--lib` pointed at a checkout from before LIN-3610 would now fail.
  - **A stale comment was left** at `tests/unit/proxy-periodical-report-gate-route.test.js:6`, which still says the marker is at "(lib/periodical-report-gate.js, …)". It is minor and not in the ticket's comment list.
- **Untouched, as required:** `dispatch-entrance`, `dispatch-validation`, LIN-3604's files, the K1 files and `areas.json`.

### (3) Independent replay (`tools/replay-k3.mjs` → `replay-k3.txt`)

- **Cases: 62,321.**
  - **Slug and build:** 6,046 titles × 2:
    - 16 live titles;
    - 30 edge values: `''`, undefined, null, numbers, NaN, Infinity, booleans, arrays, an object with `toString`, non-ASCII, CJK, emoji, punctuation-only, tab and newline, 500 characters, and a Symbol, which throws identically;
    - 3,000 generated titles under each of seeds 7 and 20261017.
  - **Extract and resolve:** 6,104 descriptions × 2:
    - non-strings and prose;
    - markers with odd case or spacing, a bad id, an empty id, a missing id, a removed template, and a registry-id-not-slug id;
    - every live marker in prose, upper-cased, spaced and compacted;
    - 3,000 generated descriptions under each of seeds 11 and 20261017.
  - **Gate:** 38,018 cases:
    - 704 descriptions × 9 comment sets (none, null, path-only, evidence, adversarial read only, both, both in one body, with a null entry) × 6 target states (completed, started, canceled, undefined, null, `'Completed'`);
    - plus no-argument and null calls.
  - **Registry:** `getPeriodicals()`, `buildPeriodicalNodes()` and `PERIODICALS`, compared as JSON with the function sources, plus every template's `generatePrompt()`.
- **Result:** old (marker in the gate @`6ae4c0e4`) vs new (@`ab85eb9e`): **0 differences**. 2,277 descriptions resolve to a live id.
- **Self-checks:**
  - old vs old, on a distinct instance: 0;
  - mutant with `_` as the slug joiner (`mut-k3/`): **14,122** differences, caught;
  - mutant with the marker regex missing `/i` (`mut-k3b/`): **6,617** differences, caught.

### (4) Census, 6ae4c0e4 → ab85eb9e

- 309 groups / 1,021 sites → 309 / 1,021, with identical per-detector totals. No group was born or lost.
- One group was relabelled: the tiny-slug clone group (`slugifyForFilename` and others).
  - Its member file changed from `lib/periodical-report-gate.js` to `lib/periodicals.js`.
  - Its areas changed from Runs & dispatch to Other features, with the area count still 5.
  - Its churn went from 101 to 111, so its score went from 808 to 888.

### (5) Prediction (prediction-K3.md)

**Hits:**
- The move to the top of `periodicals.js`, replacing the import, with a reason comment.
- The gate imports the parser.
- The preferred route: `proxy-writes` split and five tests repointed.
- The three comment fixes.
- `areas.json` untouched, and no body changed.
- The code lines are byte-identical.
- No cycle: `periodicals.js` has no import.
- Every seams row on the preferred route, after the sibling adjustment:
  - 432; 4 / 0; rows −1; cross +1; knots −1; the same group;
  - the pair gone, and Runs → Other a one-way 3;
  - all three links;
  - both entry-file changes;
  - area sizes the same;
  - no new knot.
- No behaviour change: the replay found 0 differences.
- None of the falsifiers fired.

**Misses:**
- **Diff size:** "8 files, +65 / −58" was predicted; the actual is **9 files, +68 / −62**.
  - The extra file is the `experiments/` replay script.
  - `periodicals.test` and `periodical-runs.test` are +1 / −2, not +1 / −1, because the imports were merged.
  - `periodicals.js` is +55 / −2, against a predicted +53 / −2, which the prediction anticipated as "a line or two".
  - The gate (+1 / −48), `proxy-writes` (+2 / −1), the gate test (+5 / −3) and the two other tests (+1 / −1) are exact.

**Not checkable here:**
- **The run time.** The branch commit was at 15:12 and the merge at 15:30; the dispatch time is not recorded.
- **`ci-success`.**
- I did not re-run the unit tests.

## Surprises

1. **K1's first commit missed things the ticket required.** It added source-text location pins, which the ticket's spirit forbids, and it missed two of the required comment fixes. The PR review caught both before merge.
2. **K1 shipped files the prediction didn't foresee.** It added a permanent new test, which was predicted as no test change, and edited a comment the ticket said needed none (`recommendation-facts.js`).
3. **K3's preferred route had one more importer than the ticket found.** That importer, `experiments/rebuild-rung5c/replay/replay.mjs`, was outside the search, and the worker repointed it. One stale location comment remains at `tests/unit/proxy-periodical-report-gate-route.test.js:6`.
4. **Census totals did not move for either ticket**, as expected for a move. K3 only relabelled one clone group's area.
