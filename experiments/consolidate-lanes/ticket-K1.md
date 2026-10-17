TITLE: Seams: untie Agent API ↔ pages by moving isBlocked to its owner (lib/tree.js → lib/providers/state-map.js; the proxy routes import both state predicates from there)

PARENT: LIN-3549 · PROJECT: Quality, Periodicals & Measurement · PRIORITY: High · STATE: Todo

**Goal.** Untie the Agent API (proxy) ↔ Front end: server-rendered pages knot. The proxy routes should import the two issue-state predicates they use from the module that owns them. The area map stays unchanged, and so does behaviour. Knots go down by one (18 → 17 at `47d87055`) with no new knot.

**Why.**
* **The rule.** Code belongs to the area that would have to change if its rule changed. When a single import holds a knot, find the decision that import carries. Then move that decision to its owner, or invert the dependency. Don't edit the map.
* **The knot, Agent API (proxy) ↔ Front end: server-rendered pages, 2 / 1.** At `47d87055` (origin/main), `node scripts/code-shape/seams.mjs . origin/main scripts/code-shape/areas.json` shows this pair.
  * Agent → pages (2): `routes/proxy-compute.js:20` imports `isTerminalState` from `lib/tree.js`. `routes/proxy.js:79` imports `isBlocked` from `lib/tree.js`, for the test-mode recommendation at `:1421`.
  * pages → Agent (1): `lib/render-runner-setup.js` → `lib/proxy-scopes.js`, for the runner copy's two lifetimes. A page shows a value the API owns, so the import points from the user to the owner. It stays.
* **`isTerminalState` already has an owner.** It is defined in `lib/providers/state-map.js:17-19`. `lib/tree.js` only re-exports it (`:5`, `:179`), and its comment at `:170-178` says that state semantics live in state-map (LIN-174 Phase 1). The proxy route goes through a page module to reach it.
* **`isBlocked` is in the wrong file.** It is defined in `lib/tree.js:181-202`. An issue counts as blocked when an inverse `'blocks'` relation comes from a non-terminal issue. The function calls `isTerminalState` and nothing from the tree.
  * If the blocked rule changed, the change would be to what makes a blocker live: a `'blocks'` relation whose issue is not terminal. That is state-map's terminal predicate applied to relations, not tree layout.
  * The providers decide what counts as a blocker when they normalise `blockedBy` (`lib/providers/linear/index.js:924-930`, `lib/providers/local/index.js:266-271`). The rule is about relations and their states, not tree layout.
  * `isBlocked` reads inverse `'blocks'` relations only, while the local provider also counts outgoing `'blocked-by'` (`:266-268`). That divergence predates this ticket and is out of scope; the move doesn't change it.
  * So its owner is state-map, beside `isTerminalState`.
* **Its LIN-330 comment** (`tree.js:186-189`) gives the old reason: the function is about the issue's relations, not Linear's transport. That half stays true. The other half, "so it belongs with the canonical tree helpers", is the part this ticket changes.

**Decision.**
* **Move `isBlocked` to state-map.**
  * Cut `isBlocked` and its doc comment (`tree.js:181-202`) out of `lib/tree.js`.
  * Paste them into `lib/providers/state-map.js` after `isCompleted` (`:26-28`). The function body stays byte-identical. Leave no copy in `tree.js`.
* **`lib/tree.js` re-exports it.**
  * Add `isBlocked` to tree.js's existing import from state-map (`:5`), and to its existing plain re-export (`:179`).
  * Keep that form: a plain `import` plus `export { … }`, never `export … from`.
  * `tree.js` still calls `isBlocked` itself (`:277-278`, `:310`).
  * These importers keep importing from `tree.js` unchanged: `lib/recommendation-facts.js:26-31` (re-exported at `:115`), `lib/workspace-api-mocks.js:12`, `tests/unit/tree.test.js:8` and `tests/unit/linear.test.js:10`.
  * This adds no seams edge, because `tree.js` already imports state-map.
* **The two proxy routes import from the owner.**
  * `routes/proxy-compute.js:20` and `routes/proxy.js:79` import from `'../lib/providers/state-map.js'`.
  * Change the specifier only.
* **Comments.**
  * Keep the LIN-330 and LIN-357 references on the moved doc comment. Replace the "tree shape … so it belongs with the canonical tree helpers" clause with one sentence naming this ticket, the new home and the reason. If the moved doc comment says why it is in state-map, give the reason above: it is state-map's terminal predicate applied to relations.
  * Extend the LIN-174 note at `tree.js:174-176` to say that `isBlocked` now lives in state-map too.
  * `lib/graph-features.js:149-151` says `isBlocked` "lives in tree.js" and gives a tree.js ⇄ graph-features cycle as the reason for injecting it. After the move both are untrue, because graph-features already imports state-map (`:15`).
    * Rewrite the comment to name the new home. Say the parameter is kept so the signature and its callers (`tree.js:278`, `tests/unit/tree.test.js:751-772`) stay unchanged. Dropping it is out of scope.
    * Update the `@param` example at `:154` ("e.g. tree.js isBlocked") to state-map's `isBlocked`.
    * The signature doesn't change.
  * `lib/linear.js:5-7` says `isBlocked` and `selectFocusSubtask` "now live with the tree helpers (lib/tree.js)". Say instead that `isBlocked` now lives in `lib/providers/state-map.js` and `selectFocusSubtask` in `lib/tree.js`, which re-exports both. Comment only: `tests/unit/providers.test.js:220-224` checks that the shim exports only the 9 fetchers, and a comment edit keeps it passing.
* **What stays untouched.**
  * No edits to `scripts/code-shape/areas.json`.
  * Don't touch `lib/render-runner-setup.js` or `lib/proxy-scopes.js`.
  * Leave `lib/context-graph.js:204`, which computes blocked-ness its own way. It is a separate twin and out of scope.
  * These comments stay true and need no edit: the header of `lib/recommendation-facts.js` (`:18-21`, "re-exported from tree.js") and the history note in `tests/unit/linear.test.js:8` ("relocated to lib/tree.js (LIN-330)").
  * No doc names the location (`docs/architecture/`, `llms.txt`), so neither needs an edit.
  * Don't touch the files of the sibling seams tickets (`lib/token-refresh.js`, `lib/providers/interface.js`, `lib/providers/jira/oauth.js`, `lib/periodicals.js`, `lib/periodical-report-gate.js`, `routes/proxy-writes.js`, and the five periodical test files the marker ticket repoints: `periodical-report-gate`, `periodicals`, `proxy-periodical-report-gate-route`, `dispatch-route-periodical-id` and `periodical-runs`) or LIN-3604's files (`routes/dispatch.js`, `routes/proxy-dispatch.js`, `routes/proxy-kickoff.js`, `lib/dispatch-entrance.js`). This ticket needs none of them.
* **Source-text tests.** No test reads `lib/tree.js`, `lib/providers/state-map.js`, `routes/proxy.js` or `routes/proxy-compute.js` as text to pin where these predicates live or where they are imported from (searched at `47d87055`). The tests import the functions by module, and the re-export keeps that working. If you do find a test that pins the location, convert it to a behaviour test, and show the replacement failing first.
* **No behaviour change.**
  * No function body changes.
  * Keep every ticket reference and reason comment beside the code it governs. They move with it.
  * **Existing tests.** Show behaviour is unchanged with these test files: `tree`, `linear`, `state-map`, `recommendation-facts`, `recommend-recurse`, `providers`, `proxy-compute-keepalive`, `proxy-recommend-kind-override` and `stage-selector`.
  * **The replay.**
    * Take the old function text from `git show origin/main:lib/tree.js` (lines 194-202) into a scratch script. The old text calls `isTerminalState`. Import it from `lib/providers/state-map.js`, which this ticket doesn't change. An export of `origin/main` works too.
    * Import the new `isBlocked` from `lib/providers/state-map.js`, and compare the outputs on the same inputs, or the error class and message when it throws. Cover:
      * missing, null, non-array and empty `inverseRelations.nodes`;
      * every relation type (`blocks`, `related`, `duplicate`, a different case, missing) crossed with every state type plus missing issue or state;
      * null relation entries, which throw identically;
      * pairs of relations.
    * Also assert that the `isBlocked` exported by `tree.js` and by `recommendation-facts.js` is the same function object as state-map's.
    * Don't commit the replay. Paste the script and its output into the PR.
* **Verify the untie.**
  * Commit first. `seams.mjs` reads the git object store, not your working tree.
  * Compare against the `origin/main` you branched from. Run `node scripts/code-shape/seams.mjs . origin/main scripts/code-shape/areas.json` and `node scripts/code-shape/seams.mjs . HEAD scripts/code-shape/areas.json`, both with the same `areas.json`.
  * Paste into the PR: the knot count before and after, the knot line before and its absence after, and the pair counts of every knot that changed.
  * **Expected knot changes.**
    * Agent API (proxy) ↔ Front end: server-rendered pages, 2 / 1, disappears.
    * Agent API (proxy) ↔ Providers goes 17 / 6 → 19 / 6.
    * No other knot pair or group changes.
    * These numbers are at `47d87055`. Take your "before" from your own `origin/main` run. If a sibling seams ticket merged first, only three totals differ: the knot count and the link rows are each one lower per merged sibling, and cross-area imports are one higher if the periodical-marker ticket merged. The expected result is then "knots N → N−1, link rows R → R−1". Every pair, link and entry-file count listed here is unaffected by the siblings, and must match exactly.
  * **Expected changes outside the knots.**
    * Two links change: Agent → pages 2 → gone, and Agent → Providers 17 → 19. Area→area link rows go 62 → 61, and cross-area imports stay at 887.
    * Entry files change:
      * `lib/tree.js` loses Agent API as an importing area (15 importers → 13).
      * `lib/providers/state-map.js` gains Agent API as an importing area (6 importers → 8).
    * pages → Agent stays a one-way link of 1. Files in scope (432), area sizes and unresolved imports (4) don't change.
  * If any other knot pair or group changes, or a new knot pair appears, stop and say so in the PR rather than working around it.

**This is one PR. Don't split it into child tickets.**

Don't start parallel forks or background sub-agents; do the parts one at a time. While iterating, run the unit tests for the files you change; run the full unit suite once before opening the PR. Leave e2e to CI; run it locally only to reproduce a CI failure.

No live checks; no paid model calls.

**Done when.** Merged with `ci-success` green, and the PR showing the seams output before and after (this knot gone, no new knot) and the replay script and output.

**Out of scope.** Every other knot, including the sibling seams tickets. The blocked-ness twin in `lib/context-graph.js`, and the local provider's `'blocked-by'` reading. Dropping the injected `isBlockedFn` parameter. The area guide and `scripts/code-shape/areas.json`.
