## Review — LIN-1596

Reviewed head `8963dd0` (squash of PR #1018 / branch commit `63ea33ff`) against base `f556102`.

CI: green on PR #1018 at `63ea33ff` (run 30210714098: unit, E2E shards 1–4, `ci-success`), as the implementation comment records. I also ran `tests/unit/kpi-stats.test.js` + `tests/unit/render-kpis.test.js` locally: 52/52 pass. `tests/e2e/kpis.spec.js` gives 8/8.

### Scope vs. plan

The change touches exactly the planned surfaces: `lib/kpi-stats.js`, `lib/render-kpis.js`, `public/kpis.js`, `public/kpis.css`, the two unit files and `tests/e2e/kpis.spec.js`. `lib/dispatch-terminal.js` is consumed without changes, and `card.js`/`section.js` are not touched. Implementation chose one of the plan's two options: the headline sits outside `.kpi-cards`, so the 11-card count stays and the box count goes 9 → 10. The 30d headline vs 28d trend span is documented at both constants. It follows the plan's two constraints, so this is not an overrun.

**Staleness / regression.** `git log` over the touched files shows nothing after the ticket's creation before this commit. Two earlier fixes still hold:
- `ea7abb5` (the /kpis timeout fix). `$project` still never lists `feedback`. On real MongoDB the projected docs carry no `feedback` key and no non-terminal payload (my run is below).
- LIN-1540's emit-only privacy posture. The new block emits only integers, day keys and ratios, and the new privacy test covers a marker's free-text tail.

No reverts in range.

### What I verified directly

- **Metric logic: the find path is well pinned.** I mutated each rule and every mutation turned at least one test red:
  - skipped not excluded: 2 red
  - grouping by `_id` instead of `rootItemId`: 5 red
  - no harvest attach: 3 red
  - abort rows kept: 5 red
  - first marker wins instead of last: 4 red
  - bucketing on latest dispatch instead of earliest: 1 red
  - blind append bypassing the F1 guard: 1 red
- **Render: pinned.** Mutations that dropped the anchor `id`, always linked when `rate === null`, or dropped the coverage label each went red.
- **Real MongoDB (8.2.4, local `mongod`).** I ran `collectKpiStats` with a real `MongoClient` over a seed using `Date` timestamps, which is how `addFeedback` stores them. The seed covered a row with two markers (`[failed]` then `[done]`), an entry with no `message`, upper-case `[DONE]` with leading whitespace, `[ended·unconfirmed]`, abort plus target, skipped, and a follow-up lineage. Results:
  - The pipeline ran without falling back.
  - `$last` picked `[done] second`.
  - `[ended·unconfirmed]` came back with no `terminalEntry` key.
  - No raw `feedback` crossed the wire.
  - `dispatchOutcomes` was identical to the find path's.
- **Manual, populated state.** I ran the real server on `MONGODB_URI` with 21 seeded history rows and loaded `/kpis` at 412px with the reporter's Android Chrome UA. The headline read `70% | of dispatched work landed · 30d | done 14 · failed 4 · aborted 2 | 20 of 21 dispatches resolved · 30d`. The evidence box was out of the viewport before the click and in it after (`#kpi-outcome-evidence`). The trend canvas rendered, there was no horizontal overflow and no console errors.
- **Zero-touch has no data source** (confirms scoping). `humanContinued` appears nowhere in `lib`, `routes`, `server.js` or `public`. `lib/providers/github/client.js:108,125` still filters out `pull_request`.

### Findings

**F1: the aggregate-path tests stay green when the production pipeline is broken.**
I renamed `$regexMatch` to `$regexMatchBOGUS` in `loadDispatchHistory`. All 38 tests in `kpi-stats.test.js` stayed green, including "derives the outcome slices in-DB" and "parity". The aggregation throws, the `catch` falls through to `find({})`, and the find path produces the same numbers. The plan's stated mitigation was: "keep the derivation in the same `$project` stage so any operator problem surfaces in CI against real MangoDB". That does not hold. A pipeline that fails on the production backend reaches production as the unbounded raw read that `ea7abb5` removed, and only the new `console.warn` would show it.

Inside scope: success criteria 6 and 8, and the plan's named risk. Fix for close-out, in `tests/unit/kpi-stats.test.js`, suite `collectKpiStats (aggregation path, real MangoDB)`:
- In "derives the outcome slices in-DB…" and "parity: …", after `realCollections(...)`, add `collections.dispatchHistory.find = () => { throw new Error('aggregation fell back to raw find'); };`. In the parity test, build the find-path side from its own `createMockCollection(seed)` as it already does.
- In the same suite, add one test seeding `{ _id: 'two', rootItemId: 'two', status: 'taken', dispatchedAt: daysAgo(4), feedback: [marker('[failed] first', 4), marker('[done] second', 3)] }` with `find` stubbed to throw. Assert `dispatchOutcomes.done === 1 && failed === 0`. Today `$last` → `$first` stays green because no seed row has two markers.
- Re-check: the `$regexMatchBOGUS` mutation and the `$last` → `$first` mutation must each go red.

**F2: the "no raw feedback" projection test checks a copy of the pipeline, not the production one.**
"projection returns no raw feedback array…" calls `aggregate()` with a hand-typed copy of the pipeline. I added `feedback: 1` to the production `$project`, which reintroduces the exact read `ea7abb5` removed: 38/38 still green. The implementation comment says "A standing test asserts the projection carries no `feedback` array", and that is true only of the copy.

Inside scope: success criterion 6, and the plan's "becomes a standing unit test". Fix for close-out, in the same test:
- Drop the inline pipeline.
- Seed the same doc, then wrap the production call: `const orig = collections.dispatchHistory.aggregate.bind(collections.dispatchHistory); let projected; collections.dispatchHistory.aggregate = (p, ...r) => { const c = orig(p, ...r); return { toArray: async () => (projected = await c.toArray()) }; };`, then call `collectKpiStats(collections, { now: NOW })`.
- Keep the existing assertions, but run them against `projected`: no `feedback` key, `feedbackCount === 2`, `terminalEntry` keys `['message','timestamp']`, no `BULKY-HEARTBEAT-PAYLOAD`.
- Also stub `find` to throw, as in F1.
- Re-check: the `feedback: 1` mutation must go red.

**F3: the e2e click assertion for success criterion 4 is conditional and does not run on a fresh server.**
"the headline number links to the evidence behind it" returns early when `rate === null`. I ran `kpis.spec.js` on a fresh server: rate was `null`, so the click → `toBeInViewport` branch was skipped and the test still passed. In CI it runs only if another spec in the same shard happened to post a terminal marker before `/kpis` was first cached (60s cache). So the implementation's "including a click-headline → chart-box-in-viewport assertion" is not a reliable witness.

The behaviour itself is **discharged** by my manual repro above. Making the e2e deterministic needs a test-only seeding route plus a way to clear the KPI cache. That is test infrastructure (outside), not this ticket's behaviour; see follow-ups.

**Nit, no change required.** Production code imports `__internal as TERMINAL_INTERNAL` to read `TERMINAL_FEEDBACK_REGEX.source`. This keeps one regex definition, which is the right goal, but `__internal` is otherwise test-only.

### Isolated, or one of a class?

Class: **aggregation `try/catch` that silently degrades to a find path.** `loadDispatchHistory` (this ticket) now warns, but its tests do not catch the fallback (F1, inside). The sibling is `loadProxyBins` (`lib/kpi-stats.js:216`): bare `catch {}`, no warn. It falls back to a projected `find`, not the raw `feedback[]` read, so the timeout risk is lower. It is pre-existing and no bounded class of this ticket covers it: **outside**, and close-out files it.

The outcome metric itself is isolated: it is the only per-lineage consumer on `/kpis`. Funnel and step-outcomes are explicit non-goals.

### What CI Did Not Prove

- **The pipeline is supported by the production MongoDB server version** (`$last` as an array operator needs ≥4.4, `$regexMatch` ≥4.2). **Inside**: success criterion 6 depends on it. CI's `mongo:8.0` service runs only `mongo-smoke.test.js`, never this pipeline. I proved it on 8.2.4 locally, not on production.
  - Before merge, if close-out can reach production: `db.version()` ≥ 4.4.
  - After deploy: load `/kpis` once and confirm the server log shows `KPI stats collected in …ms` and **no** `kpi-stats: dispatch-history aggregation failed` line.
  - Monitor: that warn line, which fires on any fallback.
  - Rollback: revert `8963dd0`. It is reversible: no migration, nothing persisted in a new shape.
- **`/kpis` stays inside the router timeout on production-sized `dispatch-history`** with the in-DB `$map`/`$filter` added per row. **Inside**: success criterion 6. Only production data volume can show this.
  - After deploy: the same `/kpis` load; the logged ms should sit well under 30s.
  - Monitor: the existing `KPI stats collection slow: ${ms}ms` warn (`server.js:1240`, >5000ms) plus the fallback warn.
  - Rollback: revert `8963dd0`.
- **F1: aggregate-path tests must fail when the pipeline falls back.** **Inside**: success criteria 6 and 8. Before merge: close-out makes the F1 fix, then confirms the `$regexMatchBOGUS` and `$last`→`$first` mutations go red.
- **F2: the projection guard must exercise the production pipeline.** **Inside**: success criterion 6. Before merge: close-out makes the F2 fix, then confirms the `feedback: 1` mutation goes red.
- **Clicking the populated headline lands on the evidence chart.** **Inside**: success criterion 4. **Discharged** by my manual repro on real MongoDB 8.2.4 at 412px with the reporter's UA (out of viewport before the click, in viewport after, hash `#kpi-outcome-evidence`).
- **The headline reads as a link on mobile.** **Inside**: success criterion 4. The value has the body text colour and no underline except on `:hover`, which touch devices never trigger. This is subjective UX that I could not judge. Settle before merge: a human looks at `/kpis` on a phone and either accepts it or asks for a resting underline on `a.kpi-headline-value`.

### Follow-ups for close-out to file (outside)

- The three scoping split-outs, still unfiled:
  - zero-touch merge rate (`research`)
  - evidence links on the other 11 stat cards (`plan`)
  - per-workspace outcome rate on an authenticated surface (optional)
- Re-baseline `tests/visual/pages-screenshots.spec.js` `kpis`. It is not in CI.
- `loadProxyBins` silent `catch {}` (class sibling above).
- A deterministic e2e for the populated `/kpis` headline (needs a test seeding route and a KPI-cache clear), so F3's branch always runs.
- `dispatchByWeek`'s 5-week span against the 30-day TTL (noted by scoping, not this ticket's fix).

### Verdict

The "As asked" block, sentence by sentence:

1. "this page counts activity, not outcomes": **met**. An outcome ratio now headlines the page above the volume cards.
2. "Everything here is a volume metric…": **met**. That is the problem statement, and sentence 1's change answers it.
3. "what fraction of dispatches end [done] vs [failed]/[aborted], and what fraction of merges were zero-touch": **met in part**. done / failed / aborted is shipped, per lineage, with abort attribution and skipped excluded. The zero-touch half is not delivered: scoping split it out, and I confirmed no data source exists.
4. "The work-funnel and step-outcomes charts presumably hold this, but it's not headlined": **met**. It is now headlined and derived from the terminal-marker seam (correctly, since `funnel.completed` is a different signal).
5. "'X% of dispatched work landed without human touch, trend up' is the KPI…": **met in part**. "X% landed" and a weekly trend are shipped. "Without human touch" is not, because it depends on the zero-touch split.
6. "put at the top — and … link each headline number to the evidence behind it": **met in part**. It is at the top, and the one new headline number is linked. The other 11 headline numbers are not; scoping split them out.

Sentences 3, 5 and 6 are narrowed by the scoping stage. No comment from the person and no answered ruling agrees to that narrowing; the thread holds only stage comments. Under the rules that prevents an Approve, even though the shipped part is sound once F1 and F2 land.

**DECISION (for the human):** Do you accept shipping LIN-1596 as the "% of dispatched work landed" headline with its one evidence link? Zero-touch would move to a new `research` ticket and links on the other 11 cards to a new `plan` ticket. **Recommendation: yes.** Zero-touch has no data source on either half (no PR reads, `humanContinued` never reaches Harbour), so holding this ticket for it ships nothing. The links on the other cards are independent UI work, and this change provides the pattern for them.

On "yes", the verdict becomes `Approve — conditional on close-out discharging the ledger`. Close-out makes the F1 and F2 test fixes, runs the post-deploy checks and monitors above, and files the outside follow-ups. On "no", it goes back to `plan` to scope the missing halves into this ticket.

Needs Discussion
