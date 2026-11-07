## Review — LIN-1596

Reviewed head `8963dd0`, the squash of PR #1018 (PR head `63ea33ff`) on top of `f556102a`.

CI: green. Run 30210714098 on `63ea33ff` passed Unit, E2E shards 1–4/4 and `ci-success`, as the ticket's comment records. I re-ran `tests/unit/kpi-stats.test.js` and `tests/unit/render-kpis.test.js` locally: 52/52 pass.

### Scope against the plan

- **Matches the plan.** The diff touches exactly the 7 surfaces in the plan's in-scope table: `lib/kpi-stats.js`, `lib/render-kpis.js`, `public/kpis.js`, `public/kpis.css` and the three test files. Nothing outside that list changed.
- **Shared seam left unchanged.** `lib/dispatch-terminal.js` and the card/section primitives were not modified.
- **Ordering matches the plan.** The code harvests aborts at row level, attaches them, drops the abort rows, groups by `rootItemId`, keeps the last terminal per lineage by timestamp, then applies the window and buckets on the earliest dispatch.
- **One stale plan item.** The plan said `tests/visual/pages-screenshots.spec.js` would need re-baselining. It needs nothing: `capture()` only writes screenshots and compares them against nothing, and no `kpis` baseline is committed. Close-out has no action here.
- **Staleness.** `git log --since=2026-07-26T15:36:33Z f556102a` over every referenced path returns nothing. The plan's code facts still hold at base.

### Regression check

I ran `git log --oneline -30` over all 7 files.

- **`ea7abb5` (/kpis timeout fix) is intact.** `$project` never lists `feedback`. The marker is reduced inside the DB to at most one `{message, timestamp}`. The silent `catch` now logs a `console.warn`.
- **The LIN-1540 commits (`86cf230`, `ca0fc04`) only touched tests and comments, and they are unaffected.** Their review lesson applies here, though: a guard can sit on the emit step but not on the projection. See F2.
- No reverts touch these files.

### Gap analysis against success criteria

| # | Criterion | Status |
|---|---|---|
| 1 | Headline above the cards, with slices | Met. Verified in a browser (below). |
| 2 | Coverage sub-label | Met. `N of M dispatches resolved · 30d`. |
| 3 | Weekly trend | Met. 4 buckets. The 28-day trend vs 30-day headline gap is documented at both constants. |
| 4 | Number links to its evidence | Met. Unit test pins the `href` and that the id sits on the wrapper, not the canvas. The browser click is discharged by my manual run (ledger). |
| 5 | Per lineage, abort rows dropped but honoured, `[skipped]` excluded | Met. Mutation-checked (below). |
| 6 | No raw `feedback[]` read; stays within the timeout | The code complies. **No standing test witnesses it** (F1/F2). Production MongoDB version and latency are in the ledger. |
| 7 | No `urlKey` or marker text emitted | Met. The privacy test was extended with the marker tail. |
| 8 | Unit coverage on both paths, including abort and lineage cases | The find path is covered. **The aggregate-path tests pass just as well through the `find` fallback** (F1). |

### Mutation checks (LIN-2274)

I reverted every edit. `git status` is clean apart from the linked `node_modules`.

**Caught (tests go red):**
- Keep abort rows: 5 red.
- Skip the harvested-abort attach: 3 red.
- Key lineages per row: 5 red.
- Earliest marker wins: 4 red.
- Count `[skipped]` in `total`: 2 red.
- Drop the 30-day lower bound: 1 red.
- Bucket on the latest dispatch: 1 red.
- Remove the anchor `attrs`: 1 red.
- Always render the anchor: 1 red.

**Survived (tests stay green), each one a finding:**
- **M1: add `feedback: 1` to the production `$project`** (the exact `ea7abb5` regression). 0 red. The "projection returns no raw feedback array" test runs a hand-copied pipeline, not `loadDispatchHistory`'s. The parity test can't see it either, because `terminalFeedbackOf` happily reads a raw array.
- **M2: break the production pipeline (`$regexMatch` → `$regexMatchBOGUS`).** 0 red. `loadDispatchHistory` falls back to `find({})`, and on MangoDB that returns identical outcomes. So "derives the outcome slices in-DB" and "parity" both pass without the aggregate path running at all. The only symptom is the new `console.warn`, which no test checks.
- **M8: `$last` → `$first` in the production pipeline.** 0 red. No seed row has two terminal markers in one `feedback` array, so last-marker-wins inside a row is never compared across the two paths.

**The fix is proven.** I wrote a temporary test using the wrapper described in F1/F2 and ran it once per mutation. It goes red on M1 (projection assert), M2 (`find fallback hit`) and M8 (`failed` vs `done`), and passes on the shipped code. I deleted it afterwards.

### Manual verification

**Real MongoDB.** The CI `kpi-stats` suite only runs against MangoDB. The `mongo:8.0` service container in CI only runs `mongo-smoke`, which never touches `kpi-stats`. So I ran `collectKpiStats` against a local `mongod` 8.2.4:
- The aggregate path was taken: 0 `dispatchHistory.find` calls, no warn.
- `dispatchOutcomes` matched the find-only path exactly (`deepStrictEqual`).
- The seed stored timestamps as `Date` (as `addFeedback` does) and included a row with `[failed]`→`[done]`, an abort row with its target, `[skipped]`, `[ended·unconfirmed]`, a row with no feedback, and a two-row lineage.

**Browser.** I booted `server.js` against that MongoDB, seeded 9 done, 1 failed, 1 abort plus target, and 1 unresolved:
- Headline at 390×800: `82% / of dispatched work landed · 30d / done 9 · failed 1 · aborted 1 / 11 of 12 dispatches resolved · 30d`. The abort row is correctly absent from `M`.
- Clicking the value goes to `#kpi-outcome-evidence`; the box lands at top 16px, in the viewport. It holds a live canvas with bars at 100/100/100/60, which matches `weeklyRate`. The tooltip reads `60% landed / n = 5 resolved`.
- The empty state (`—`, no anchor) is covered by the unit test and by the implementer's visual check.

### Isolated, or one of a class?

- **Terminal-marker consumers that must honour abort attribution.** `routes/proxy.js` and `lib/pipeline-loops.js` both use `harvestAbortedTargets`. `routes/dashboard.js:157` takes `loop.terminalStatus` from pipeline-loops. `kpi-stats` now joins them through the same seam. **No unhandled sibling.**
- **A silent aggregation fallback to a broad raw read.** This change added a warn to `loadDispatchHistory` only. `loadProxyBins` (`lib/kpi-stats.js:216`) still has a silent `catch {}` that falls back to a projected `find({})` over `proxyEvents`, the highest-volume log. **Outside**: that pipeline is unchanged and is not this ticket's metric or its cause. Close-out files it as O1.
- **Aggregate-path tests that pass through the `find` fallback.**
  - The new LIN-1596 aggregate tests: **inside** (criteria 6 and 8; this ticket's own claim). Fixed by F1/F2.
  - The older proxy-bin and `feedbackCount` aggregate tests have the same weakness: **outside**, folded into O1.

### Fixes for close-out

**F1 (required, `tests/unit/kpi-stats.test.js`, the aggregation suite):** make the three LIN-1596 aggregate-path tests fail if the fallback runs.
- Applies to "derives the outcome slices in-DB…", "parity…" (the aggregated side) and the projection test.
- After `realCollections(...)`, replace `collections.dispatchHistory` with a wrapper:
  - `aggregate` delegates to the real collection.
  - `find` throws `new Error('find fallback hit: aggregation path did not run')`.

**F2 (required, same file):** rewrite the projection test against the production pipeline.
- Delete the hand-copied `aggregate([...])` pipeline.
- Wrap `aggregate` so it records the docs it returns: `aggregate: p => { const cur = hist.aggregate(p); return { toArray: async () => { const d = await cur.toArray(); captured.push(...d); return d; } }; }`.
- Call `collectKpiStats` and assert three things about `captured`:
  - no doc has a `feedback` key;
  - `JSON.stringify(captured)` does not contain `BULKY-HEARTBEAT-PAYLOAD`;
  - `terminalEntry` keys are exactly `['message', 'timestamp']`.
- Add one history row to that seed (or to `outcomeSeed()`) whose single `feedback` array holds `[failed]` then a later `[done]`. Assert it counts as `done`. This pins in-row last-marker-wins across both paths.
- **Distinguishing condition:** with F1/F2 in place, M1, M2 and M8 above each turn red. On the shipped code they all pass.

**Non-blocking note (no action required):** `lib/kpi-stats.js` is the first production module to import another module's `__internal` (`TERMINAL_INTERNAL.TERMINAL_FEEDBACK_REGEX`). Everywhere else that namespace is test-only. Reading the regex off the seam is the right call; a named export would be the tidier route if the seam is touched again.

### What CI Did Not Prove

- **The dispatch-history pipeline running on production MongoDB.** **Inside** (criterion 6; the plan's named fallback risk).
  - What I verified: MongoDB 8.2.4 runs it, takes the aggregate path and matches the find path.
  - What remains: the production server version. The array form of `$last` needs MongoDB ≥ 4.4, and `$regexMatch` needs ≥ 4.2.
  - **Before the merge:** run `db.version()` against the production `MONGODB_URI`. ≥ 4.4 is right. Anything lower means the pipeline throws on every refill and drops back to the unbounded `find({})`, which is the `ea7abb5` timeout.
  - **Monitor:** after deploy, the server log must never contain `kpi-stats: dispatch-history aggregation failed, falling back to a raw read:`. Only production data and a production server can prove the pipeline never throws there.
  - **Rollback:** revert `8963dd0`. It is a read-side change with nothing persisted in a new shape.
- **Cold-refill latency at production size.** **Inside** (criterion 6).
  - The pipeline now runs `$map`/`$filter`/`$regexMatch` over every `feedback` entry of every history doc. Before, it ran only `$size`. CI has no production-sized collection.
  - **After the deploy:** read the first `KPI stats collected in Nms` / `KPI stats collection slow: Nms` line from `refreshKpiStats` (`server.js`) after deploy and compare it with a line from before deploy. Right means no slow warning (under 5000 ms), and far under the 30 s router timeout.
  - **Monitor:** the existing `KPI stats collection slow` warn.
  - **Rollback:** revert `8963dd0`.
- **Standing tests don't witness the aggregate path** (M1, M2 and M8 survive). **Inside** (criteria 6 and 8).
  - **Before the merge:** close-out applies F1/F2 and confirms each of M1, M2 and M8 turns the suite red, then reverts the mutations.
- **Headline click → evidence box in a real browser.** **Inside** (criterion 4).
  - The e2e click branch only runs when the shared e2e DB happens to hold a resolved lineage inside the 60 s cache window. The implementer's local run took the null branch.
  - **Discharged:** in my manual run against seeded MongoDB, clicking landed on `#kpi-outcome-evidence` in the viewport with a live chart whose values match.
- **Unresolved share on live data.** **Outside**: `[ended·unconfirmed]` is invisible to the shared `TERMINAL_FEEDBACK_REGEX`, a property of that regex, which scoping accepted for v1.
  - **After the deploy:** record the live `N of M dispatches resolved · 30d` from `/kpis`. If the unresolved share is large, that is the plan's named trigger for close-out to file the `[ended·unconfirmed]` ticket on its own terms.

### Outside follow-ups (close-out files these after a duplicate check)

- **O1.** `loadProxyBins`'s silent `catch {}` (`lib/kpi-stats.js:216`) needs the same `console.warn` that `loadDispatchHistory` now has. Separately, the older proxy-bin and `feedbackCount` aggregate tests pass through the `find` fallback and should get the F1 wrapper.
- The three split-outs from scoping, **subject to the decision below**:
  - zero-touch merge rate → `research`;
  - evidence links on the 11 volume cards;
  - per-workspace rates, optional, authenticated surface only.

### Verdict

**Needs Discussion.**

**What landed against what was asked.** The ask was "what fraction of dispatches end [done] vs [failed]/[aborted]" with "trend up" and "link each headline number to the evidence behind it". The outcome-rate headline, its weekly trend and its evidence link are delivered and verified.

**What was not delivered.** "what fraction of merges were zero-touch" is missing. The only number with a link is the new headline. Both narrowings were decided by the scoping stage, and no comment from you or answered ruling agrees to them.

**Zero-touch is outside.** Harbour has no merge signal and no human-touch signal, so this is a new data source rather than this ticket's problem. Filing it as its own ticket is a valid route.

**Evidence links on the 11 volume cards are inside** if "each headline number" means every stat card: they are the same idiom as the exemplar this ticket ships. Under that reading the only options are to do them here or drop them with a reason. 8 of the 11 (workspaces, users, active sessions, feedback notes, AI summaries, roadmap reports, custom prompts, agent tokens) have no chart on the page to link to. If "headline numbers" means the numbers put at the top, this part is already met.

DECISION: Do you accept LIN-1596 shipping as the dispatch-outcome headline only? That means (a) the zero-touch merge rate leaves this ticket and close-out files it as a `research` ticket, and (b) evidence links on the 11 volume cards are dropped from this ticket, with the reason "8 of 11 have no evidence surface yet; linking them needs new evidence targets designed first". Or should either be done here? **Recommendation: accept both.**

If you accept, the verdict becomes `Approve — conditional on close-out discharging the ledger`. That means F1/F2 and the production MongoDB version check before the merge, plus the warn-line monitor and latency read after deploy. If either part should be done here, it goes back to `implementation` (for (b), via `plan` first, since the evidence targets need designing).
