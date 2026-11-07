## Review — LIN-1596

Reviewed head `8963dd02` (the squash of PR #1018, branch commit `63ea33ff`). It touches 7 files: `lib/kpi-stats.js`, `lib/render-kpis.js`, `public/kpis.js`, `public/kpis.css`, `tests/unit/kpi-stats.test.js`, `tests/unit/render-kpis.test.js` and `tests/e2e/kpis.spec.js`.

CI: green at `63ea33ff` ([run 30210714098](https://github.com/JKershaw/LinearViewer/actions/runs/30210714098): unit, E2E 1–4/4, `ci-success`), as the ticket records. The unit job's real `mongo:8.0` service backs only `tests/unit/mongo-smoke.test.js`, so CI runs the new aggregation pipeline against MangoDB only.

### Scope vs plan

The work matches the plan. The diff stays inside the plan's seven surfaces, and nothing outside them changed. The plan's Strategy A is implemented as written:
- `lib/kpi-stats.js` now imports `./dispatch-terminal.js`.
- `harvestAbortedTargets`, `feedbackWithHarvestedAbort` and `findTerminalFeedback` are used unchanged.
- The regex comes from `__internal.TERMINAL_FEEDBACK_REGEX.source` rather than being typed out a second time.
- Both load paths go through `terminalFeedbackOf`. The steps run in the planned order: harvest, attach, drop abort rows, group, then window and bucket.
- `OUTCOME_WINDOW_WEEKS = 4`.
- The fallback now calls `console.warn`.
- The anchor sits on the section wrapper.
- With no rate there is no anchor.

The plan left one choice open: whether the headline goes inside or outside `.kpi-cards`. Implementation put it outside, so the card count stays 11 and the chart-box count goes from 9 to 10.

One stale plan claim: there is no visual baseline to refresh. `tests/visual/pages-screenshots.spec.js` writes captures, but no snapshot files are committed, so that follow-up has nothing to do.

### Regression check

I ran `git log -- <the 7 files>`. Two commits are relevant, and both fixes are intact:
- **`ea7abb5` "Fix /kpis timeout":** `$project` still never includes `feedback`, and the derivation reduces each row to at most one `{message,timestamp}` inside the database.
- **`ca0fc04` / `86cf230` (LIN-1540, note privacy):** untouched. The emit-side guard still holds, and the new privacy case extends it.

No reverts apply.

### Verified directly

- **Unit tests:** `node --test tests/unit/kpi-stats.test.js tests/unit/render-kpis.test.js` gives 52/52.
- **Real MongoDB:** I ran the new pipeline on a local `mongod` 8.2.4 through `collectKpiStats` with the same outcome seed as the tests. There was no fallback (no warning), and the result matched the find path exactly (`total 6 / resolved 4 / 2·1·1 / rate 0.5`). It held with feedback timestamps stored as `Date` (the shape `addFeedback` actually writes; the tests only seed ISO strings), and with `message: null` or a missing `message`. Non-string messages cannot occur: every feedback route checks `typeof message === 'string'`.
- **Browser, populated state:** I ran a throwaway Playwright spec on the e2e server. It seeded taken dispatches with `[done]`/`[done]`/`[failed]` feedback, plus one with no feedback, through the real dispatch/take/feedback API, at a 390px viewport. Result:
  - The headline read `67% / of dispatched work landed · 30d / done 2 · failed 1 · aborted 0 / 3 of 4 dispatches resolved · 30d`, above the 11 cards.
  - Clicking it scrolled `#kpi-outcome-evidence` into view.
  - The `work landed · weekly` chart showed the bar at about 67% once its animation settled.
  - No horizontal overflow (`scrollWidth` 390).
- **Cleanup:** I reverted every temporary edit and removed every generated file. `git status` is clean.

### Test quality and mutation checks

I removed or broke each code path the new tests claim to cover and re-ran the suite. Results:

| Mutation | Result |
|---|---|
| Delete the `[skipped]` exclusion | red (3) |
| Group by `_id` instead of `rootItemId` | red (5) |
| Skip `feedbackWithHarvestedAbort` (no abort attribution) | red (3) |
| Keep `abort:true` rows | red (5) |
| Pick the first marker instead of the last | red (4) |
| Anchor id removed from the section wrapper | red |
| Anchor rendered even when the rate is null | red |
| Coverage sub-label removed | red (2) |
| **Rename `$regexMatch` to an unknown operator, so the pipeline throws** | **green, 38/38.** Every "aggregation path" outcome test, including "derives in-DB" and "parity", passes on the raw `find({})` fallback. The warning prints, but nothing asserts on it. |
| **Add `feedback: 1` to the production `$project`, re-reading the raw array** | **green, 38/38.** The "projection returns no raw feedback array" test aggregates a hand-copied pipeline, not `loadDispatchHistory`'s own. |
| Stop updating `lineage.earliest` from later rows | green. Every seed lists the root row before its follow-up. |

The two bold rows are a real finding, not a nit:
- **Success criterion 6** (no raw `feedback[]` on the production path) has no test of the code it is about.
- **The plan's stated defence fails.** It was to keep the derivation in the same `$project` so that "any operator problem surfaces in CI against real MangoDB". That does not happen: a broken pipeline falls back to the unbounded read `ea7abb5` removed, and CI stays green.
- **The implementation comment overstates it.** It says "a standing test asserts the projection carries no `feedback` array". The test makes that assertion about a copy of the pipeline, not the shipped one.

Fixes F1 and F4 below close these gaps. I checked the F1 shape on this checkout: it goes red under both mutations and stays green as shipped.

**The e2e click test (success criterion 4) never runs its click in CI.** The test reads `window.__KPI_DATA__.dispatchOutcomes.rate` and returns early when it is `null`. A fresh e2e server has no terminal markers, and no other e2e file loads `/kpis`. I ran `npx playwright test tests/e2e/kpis.spec.js` and logged the branch: `rate` was `null`. So both the click → in-viewport assertion and the populated `chart-outcome-trend` render in `public/kpis.js` are untested in CI. "8 passed, including a click-headline → chart-box-in-viewport assertion" was the null branch. My manual run above shows the behaviour works at this head. F2 makes CI pin it.

The test levels are otherwise right: unit tests for the pure metric and the renderer, plus an e2e test for the in-page link. The issue is that the e2e test is vacuous.

### Isolated, or one of a class?

The class is **"an aggregation failure silently falls back to the full-collection read `ea7abb5` removed"**.

- **`loadDispatchHistory`:** handled. It now warns.
- **`loadProxyBins` (`lib/kpi-stats.js`, `catch { // fall through to the projected find path }`):** the same idiom, still silent. Its fallback reads every `proxyEvents` row, which was the other heavy read `ea7abb5` aggregated away. This is **inside**: the plan bounded this exact idiom (a pipeline failure degrading to the unbounded read, made observable with `console.warn`), and the plan's list is evidence of the class, not its edge. Fix F3 below.
- **The test-side twin:** the existing aggregation-suite tests (for example "work funnel and feedback notes survive the feedback[] → count projection", and the proxy-bin cases, as `ca0fc04` itself notes) also pass via the fallback. This is **outside**: pre-existing coverage of other metrics, not something this ticket claims. Close-out can file it ("kpi-stats aggregation-suite tests do not assert the aggregate branch ran").

Abort attribution, terminal derivation and lineage grouping all go through the shared seam, so they need no sibling handling.

### Non-blocking observations

- **"dispatches" counts lineages.** The coverage label says `N of M dispatches resolved`, but N and M are lineages. So once follow-ups exist, M will be lower than the "prompts dispatched · 30d" card. This follows the scoped wording exactly (`N of M dispatches resolved · 30d`), so it is not a defect. Worth knowing if someone asks why the two numbers differ.
- **Lineages aged 28–30 days** count toward the headline but fall in no weekly bucket. This is documented at both constants and follows the plan.

### What CI Did Not Prove

- **The pipeline on production MongoDB.** *Inside* (criterion 6; the change depends on it). CI exercises it on MangoDB only. I ran it locally on MongoDB 8.2.4 with no fallback and exact parity. The production server version is unknown: `$last` on arrays needs 4.4 or later, and `$regexMatch` needs 4.2 or later.
  - **After deploy:** on the first cold `/kpis` load, the server log must show `KPI stats collected in <N>ms` and must **not** show `kpi-stats: dispatch-history aggregation failed`.
  - **Monitor:** that warning line, which now fires on every fallback. Only production shows which server version is running.
  - **Rollback:** revert squash commit `8963dd02`. No data is persisted in a new shape, so the revert is clean.
- **Timing on a production-sized `dispatch-history`.** *Inside* (criterion 6). `$map`/`$filter` now walk every feedback entry on the server, where before there was only `$size`. Requests block on that only on a cold cache, because `server.js` serves stale data while it refreshes.
  - **After deploy:** that same `KPI stats collected in <N>ms` line on a cold boot must stay well under 30 s.
  - **Rollback:** as above, `8963dd02`.
- **Populated headline, click-through and populated trend chart in a real browser.** *Inside* (criteria 1, 3, 4). Discharged by my manual run at this head (see "Verified directly"). F2 turns this into a standing CI check.
- **F1–F4 below.** *Inside*, all four.
  - **Before merge:** close-out applies them and re-runs `node --test tests/unit/kpi-stats.test.js` and `npx playwright test tests/e2e/kpis.spec.js`.
  - The deciding check: with F1 applied, temporarily renaming `$regexMatch` in `lib/kpi-stats.js` must turn the suite red.
- **Split-outs (unfiled).** *Outside*. They depend on the answer to the question below.
  - On a yes, close-out files the zero-touch rate (`research`) and evidence links on the other 11 cards (`plan`).
  - The per-workspace rate is optional and belongs on an authenticated surface only.
  - Also outside: the aggregation-suite test-side twin named above.
  - The `[ended·unconfirmed]` share: the plan's trigger stands. If the live coverage label shows a large unresolved share, file a ticket against the shared terminal regex.

**Fixes for close-out:**

- **F1, `tests/unit/kpi-stats.test.js`, aggregation suite, LIN-1596 block.**
  - In "derives the outcome slices in-DB…" and in "parity…", right after `realCollections(...)` builds the aggregate-side collections, set `collections.dispatchHistory.find = () => { throw new Error('aggregation fell back to raw find'); }`.
  - Rewrite "projection returns no raw feedback array…" to stop typing the pipeline out again. Instead:
    - Wrap the seeded collection's real `aggregate` so it records what `loadDispatchHistory` receives: `const orig = col.aggregate.bind(col); let seen; col.aggregate = p => { const c = orig(p); return { toArray: async () => (seen = await c.toArray()) }; };`, with `find` stubbed to throw as above.
    - Run `collectKpiStats`.
    - Assert that every `seen` doc lacks `feedback`, that the terminal row's `terminalEntry` keys are exactly `['message','timestamp']`, and that `BULKY-HEARTBEAT-PAYLOAD` is absent from `JSON.stringify(seen)`.
- **F2, `tests/e2e/kpis.spec.js`.**
  - Add a `test.beforeAll` at the top of the `describe` that seeds one taken dispatch with `[done]` feedback before anything loads `/kpis`. That ordering matters: the first load fills the 60 s `kpiCache` in `server.js`. Use the `setupTakenItem` pattern from `tests/e2e/dispatch.spec.js:1759`: `/test/create-dispatch-token`, `/test/set-session`, `POST /workspace/<key>/api/dispatch`, `POST /api/dispatch/take/:id`, `POST /api/dispatch/feedback/:id` with `{message: '[done] …'}`.
  - In "the headline number links to the evidence behind it", replace the `rate === null` early return with unconditional assertions: `a.kpi-headline-value` has count 1 and `href="#kpi-outcome-evidence"`; clicking it makes `#kpi-outcome-evidence` `toBeInViewport()`; `#kpi-outcome-evidence canvas#chart-outcome-trend` has count 1 (a live chart, not the empty-state note).
  - Keep the null/no-anchor case covered in `tests/unit/render-kpis.test.js`, as it already is.
- **F3, `lib/kpi-stats.js`, `loadProxyBins`.** Change `catch {` to `catch (err) {` and add `console.warn('kpi-stats: proxy-events aggregation failed, falling back to a projected read:', err?.message || err);`, mirroring `loadDispatchHistory`.
- **F4, `tests/unit/kpi-stats.test.js`, "buckets each lineage into exactly one week, keyed on its EARLIEST dispatch".** List the `w-oldfu` row before `w-old`, so the "update `earliest` from a later row" branch is pinned. Checked: red when `lineage.earliest = dispatched` is removed, green as shipped.

### Verdict

Each sentence of "As asked", in order:

1. "this page counts activity, not outcomes": **met**. A headline outcome rate now sits above the volume cards.
2. "Everything here is a volume metric — actions, dispatches, notes": **met**. The page now carries a ratio, not only counts.
3. "what fraction of dispatches end [done] vs [failed]/[aborted], **and what fraction of merges were zero-touch**": **met in part**. The done/failed/aborted rate ships, per lineage, with the three slices legible. Zero-touch does not: scoping split it out because Harbour has no merge or human-touch data.
4. "The work-funnel and step-outcomes charts presumably hold this, but it's not headlined": **met**. The rate is headlined from the terminal-marker seam. It is correctly not taken from `funnel.completed`, which is a different signal.
5. "'X% of dispatched work landed **without human touch**, trend up' is the KPI…": **met in part**. "X% landed" and a weekly trend ship. "Without human touch" is part of the zero-touch split.
6. "That's the one I'd put at the top": **met**.
7. "link each headline number to the evidence behind it": **met in part**. One headline links to its evidence. The other 11 cards were split to a separate `plan` ticket.

Sentences 3, 5 and 7 were narrowed by the scoping stage, not by the requester. No comment or ruling in the thread agrees to that narrowing, so I can't approve it on a stage's say-so.

**Question for the requester:** Do you accept LIN-1596 closing as "the dispatch-outcome headline, its weekly trend, and an evidence link on that one number"? The zero-touch merge rate would go to a new `research` ticket (Harbour holds no PR/merge state and no human-touch signal today), and evidence links on the other 11 cards to a new `plan` ticket. **My recommendation: yes.** The shipped metric is correct, works end to end, and does not depend on either split. Holding it for a feasibility pass and a page-wide link pass gains nothing.

On a yes, this becomes **Approve — conditional on close-out discharging the ledger**: F1–F4 applied, the two post-deploy log checks, and both split tickets filed. On a no, it goes back to `plan` for whichever split you want kept here.

Needs Discussion
