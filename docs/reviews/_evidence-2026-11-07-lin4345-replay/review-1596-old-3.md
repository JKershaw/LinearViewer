## Review — LIN-1596

Reviewed head `8963dd0` (squash of PR #1018 commit `63ea33ff`). 7 files, +707/−14.

CI: green on PR #1018 at `63ea33ff` (run 30210714098: Unit ✅, E2E shards 1–4 ✅, `ci-success` ✅), as recorded on the ticket. I also re-ran `tests/unit/kpi-stats.test.js` + `tests/unit/render-kpis.test.js` (52/52 pass) and `tests/e2e/kpis.spec.js` on a clean `CI=1` server (8/8 pass).

### Scope vs plan
The change matches the plan's surface list: `lib/kpi-stats.js`, `lib/render-kpis.js`, `public/kpis.{js,css}` and the three test files. Nothing overran. Two choices the plan left open were made and documented:
- The headline sits outside `.kpi-cards`, so the e2e count stays at 11 and only the chart-box count moves (9 → 10).
- The headline window is 30 days but the trend spans 28 days (4 × 7). A lineage aged 28–30 days counts toward the rate but lands in no weekly bucket. This is documented at both constants.

`terminalFeedbackOf` / `computeDispatchOutcomes` do the steps in the planned order: harvest per row → attach → drop abort rows → group by `rootItemId` → last terminal by timestamp → window → bucket on earliest dispatch. They call the shared `harvestAbortedTargets` / `feedbackWithHarvestedAbort` / `findTerminalFeedback` without changing them. The regex comes from the shared seam (`__internal.TERMINAL_FEEDBACK_REGEX`) rather than being retyped.

### Regression check
`git log -30` over the 7 files shows `ea7abb5` (/kpis timeout fix), `ca0fc04`/`86cf230` (LIN-1540 note privacy) and `6ac845f` (LIN-859 card primitives).
- **`ea7abb5`:** still intact. The production `$project` never lists `feedback`. The `$map`→`$filter`→`$last` derivation runs in the DB and returns at most one `{message,timestamp}` per row.
- **LIN-1540:** the proxy-event privacy code is untouched.
- **LIN-859:** the headline uses the shared `renderCard`, and `renderSection`'s `attrs` carries the anchor id.

Nothing reverted is re-applied.

**Caveat (finding 2 below):** the `ea7abb5` guard holds today, but no test pins it.

### Mutation checks (each reverted; `git status` clean afterwards)
Each mutation below went red, as it should:

| Mutation in `lib/kpi-stats.js` / `lib/render-kpis.js` | Result |
|---|---|
| Harvested abort not attached (`abortedTargets.get(...)` → `undefined`) | 3 fail ✅ |
| Abort rows kept (`if (row.abort === true) continue;` removed) | 5 fail ✅ |
| Group by `_id` instead of `rootItemId` | 5 fail ✅ |
| `[skipped]` exclusion removed | 3 fail ✅ |
| First terminal wins instead of last (`>` → `<` on `statusMs`) | 4 fail ✅ |
| Lineage keeps latest instead of earliest `dispatchedAt` | 1 fail ✅ |
| 30-day window lower bound removed | 1 fail ✅ |
| Anchor `attrs` removed from `renderChartBox` | 1 fail ✅ |
| Anchor rendered on a null rate | 1 fail ✅ |

Three mutations stayed green, and each is a finding:

1. **Breaking the in-DB derivation does not fail any test.** Mutation: `$regexMatch` → `$regexMatchBOGUS` in `loadDispatchHistory`. Result: **38/38 still pass.** `loadDispatchHistory`'s `catch` falls back to `dispatchHistory.find({})`. That returns raw `feedback[]`, which `terminalFeedbackOf` reads just as happily. So "derives the outcome slices in-DB" and the **parity** test both pass with the aggregation path dead; the only sign is a `console.warn` that no test checks.
   - The plan's stated mitigation was "keep the derivation in the same `$project` stage so any operator problem surfaces in CI against real MangoDB". That is not true as built.
   - Unmutated, I confirmed the warning is printed 0 times, so the aggregation path does run and agree with the find path today. Re-seeding with production-shaped `Date` timestamps (rather than the tests' ISO strings) also passed with no fallback.
   - So the behaviour is right today; what is missing is the proof that it stays right.
2. **Re-adding raw `feedback[]` to the projection does not fail any test.** Mutation: add `feedback: 1` to the production `$project`. Result: **38/38 still pass.** "Projection returns no raw feedback array" runs a hand-copied pipeline against MangoDB, not the one `collectKpiStats` sends. The "standing guard" for success criterion 6 / `ea7abb5` therefore guards nothing.
3. **The e2e click-through never runs on a clean server.** Mutation: headline `href` → `#nowhere`. Result: `the headline number links to the evidence behind it` **still passes**. On a fresh e2e server `dispatchOutcomes.rate` is `null`: `kpis.spec.js` seeds nothing, and `/kpis` is cached for 60s. The test takes its `rate === null` early return, so the click → `toBeInViewport` part has not been exercised in CI.
   - The unit test does catch the same mutation (it pins `href="#kpi-outcome-evidence"` and the wrapper `id`), so the link markup is covered.
   - Only the real-browser jump is unexercised. The implementation note's "8 passed, including a click-headline → chart-box-in-viewport assertion" overstates what ran.

The `abortTo` `String()` coercion also survives mutation, but harmlessly: seeded ids are strings, and production ids are UUID strings.

### Gap analysis against success criteria
1. **Headline above the volume cards, with done/failed/aborted beneath it:** ✅ (render tests).
2. **Coverage sub-label (`N of M dispatches resolved · 30d`):** ✅
3. **Weekly trend inside the window:** ✅ 4 buckets, not 5. `weeklyResolved` appears in the tooltip footer.
4. **Number links to its evidence:** ✅ for markup. The browser jump is unverified (finding 3).
5. **Per lineage, abort rows ignored but their aborts honoured, `[skipped]` excluded:** ✅ and mutation-verified.
6. **No raw `feedback[]` read reintroduced; renders within the router timeout:** holds at HEAD but is unpinned (finding 2). Timing on production-sized data is not provable in CI (ledger).
7. **No `urlKey`, prompt or marker text exposed:** ✅ The privacy test includes a marker free-text tail.
8. **Unit coverage on both load paths:** the cases are present, but the aggregate-path cases cannot tell the aggregate path from the fallback (finding 1).

The plan's cross-cutting concerns (ordering, F1 guard, skipped × harvest, earliest-dispatch bucketing, one-pass coverage, empty-state anchor, queue rows unresolved, pre-LIN-1468 fallback) each have a matching test, and the ordering ones are mutation-verified above.

**Plan follow-up that turns out to be moot:** "re-baseline `tests/visual/pages-screenshots.spec.js` `kpis`" has nothing to re-baseline. That spec only *captures* screenshots (`page.screenshot({ path })`, line 52). It has no `toHaveScreenshot` comparison, so this change makes nothing stale.

### Isolated, or one of a class?
The class is "an outcome derived from terminal markers that must attribute an abort row's `[aborted]` to its target". Other consumers of `lib/dispatch-terminal.js`:
- `routes/proxy.js` and `lib/pipeline-loops.js` harvest aborts.
- `routes/dashboard.js` reads `loop.terminalStatus` from `pipeline-loops`, so it inherits the harvest.
- `lib/session-telemetry.js` and `lib/wall-clock-summary.js` use the marker for per-row timing, not outcome attribution.

On `/kpis` itself, no other figure reads terminal markers. `funnel` and `stepOutcomes` are a different signal and an explicit non-goal. **Isolated: no unhandled sibling.**

### Non-blocking note (no change required)
`lib/kpi-stats.js` is now the only production importer of `dispatch-terminal.js`'s `__internal`, which reads like a test hook. A named export of the regex would be cleaner. This is not a condition of the verdict.

### What CI Did Not Prove
- **Inside (success criterion 8 / the plan's "parity" claim and its named mitigation): the aggregation path is not proven by its own tests.**
  - **Fix for close-out**, in `tests/unit/kpi-stats.test.js`, describe `collectKpiStats (aggregation path, real MangoDB)`: in `derives the outcome slices in-DB, matching the find path exactly` and `parity: one seed yields identical dispatchOutcomes on both load paths`, make the fallback impossible. After `realCollections(...)`, replace `collections.dispatchHistory.find` with a function that throws (`() => { throw new Error('fallback read used'); }`). Also mock `console.warn` (`t.mock.method(console, 'warn')`) and assert `callCount() === 0`.
  - **Settled before merge:** re-apply `$regexMatch` → `$regexMatchBOGUS` in `loadDispatchHistory`. Both tests must go red; revert.
- **Inside (success criterion 6 / the `ea7abb5` constraint): no test pins "no raw `feedback[]` on the production path".**
  - **Fix for close-out**, same file: rewrite `projection returns no raw feedback array, only the single derived entry` to exercise the production pipeline, not a copy.
    - Wrap `collections.dispatchHistory.aggregate` so it records the docs returned to `collectKpiStats` (call the original and keep the result of `.toArray()`), then call `collectKpiStats(collections, { now: NOW })`.
    - Assert that every recorded doc lacks a `feedback` key, that `Object.keys(terminalEntry)` is exactly `['message','timestamp']`, and that `BULKY-HEARTBEAT-PAYLOAD` is absent.
    - Delete the hand-copied pipeline literal.
  - **Settled before merge:** re-apply `feedback: 1` in the production `$project`. The test must go red; revert.
- **Inside (success criterion 4): the click → evidence jump has not run in a real browser in CI** (finding 3).
  - **Settled after the deploy:** on `https://harbour.cat/kpis`, where `window.__KPI_DATA__.dispatchOutcomes.rate !== null` is the distinguishing precondition, click the headline percentage. Confirm the URL hash becomes `#kpi-outcome-evidence` and the `work landed · weekly` box is in view, on desktop and at phone width.
  - If the rate is `null` in production, the anchor is correctly absent. That is not a pass of this check; report it instead.
- **Inside (success criterion 6 / the production MongoDB contract): production timing and operator support.** The in-DB derivation needs `$regexMatch` (MongoDB 4.2+) and the array form of `$last` (4.4+). On an older or otherwise incompatible server the pipeline throws and silently degrades to the unbounded raw read `ea7abb5` removed.
  - **Monitor:** after deploy, the server log must show no `kpi-stats: dispatch-history aggregation failed, falling back to a raw read` line, and no `KPI stats collection slow:` warning (> 5000 ms) on cold-cache fills.
  - Why only production can show it: CI runs MangoDB, not the production MongoDB version or data volume.
  - **Settled after the deploy:** check the logs from the first cold-cache fill after the deploy, then leave the warning in place as the standing monitor.
- **Rollback (covers the three items above):** revert squash commit `8963dd0`. It is fully reversible: no stored field, migration or write-path change, and `/kpis` is a read-only public page.
- **Discharged:** the visual-baseline follow-up named by the plan and the implementation. `tests/visual/pages-screenshots.spec.js` only captures screenshots and has no comparison baseline, so nothing goes stale.

### Verdict
`Needs Discussion`

**What was asked versus what shipped.** The block asks for "what fraction of dispatches end [done] vs [failed]/[aborted], **and what fraction of merges were zero-touch**", headlined at the top with a trend, and to "**link each headline number** to the evidence behind it". The change delivers the done/failed/aborted rate as the top headline, with a 4-week trend and an evidence link on that one number. It is mutation-verified on lineage, abort and skipped handling.

**The narrowing has not been agreed by the person.** Two parts were dropped at the scoping stage and split out, and no comment or answered ruling from the person records agreement:
- the zero-touch merge rate (no data source exists: Harbour reads no PRs, and `humanContinued` never leaves Simple Dispatcher);
- evidence links on the other 11 stat cards.

Note too that the shipped headline reads "of dispatched work landed". It does not claim "without human touch": a lineage that needed follow-ups still counts as landed.

**Question for the human:** do you accept LIN-1596 closing with the done/failed/aborted outcome headline (plus trend and its own evidence link), with the zero-touch merge rate split to a `research` ticket and evidence links on the remaining 11 cards split to a `plan` ticket?

**Recommendation: yes.** Zero-touch has no data source on either half of the phrase, and the link pass has no dependency on this metric, so neither should hold back a shippable, verified headline.

**If the answer is yes:** this becomes `Approve — conditional on close-out discharging the ledger`. Close-out makes the two named test fixes and confirms each mutation goes red. It then merges, runs the post-deploy click check and the log monitor, and files the two splits. Per-workspace rates are optional and belong on an authenticated surface only.

**If the answer is no:** this goes back to `scoping` for the zero-touch definition (merge-based vs intervention-based).
