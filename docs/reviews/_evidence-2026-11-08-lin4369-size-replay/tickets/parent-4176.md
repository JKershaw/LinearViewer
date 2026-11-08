# LIN-4176: Costs rebuild 1: one cost read that every surface asks

State: In Progress

## Description (as at 2026-11-03T21:48:31Z)

**Goal.** Every model call's tokens and cost are tracked simply and reliably, in code that is easy to maintain (LIN-3936). This step makes every place that shows a cost agree, because they all ask the same read.

**Context.**

* `docs/plans/costs.md`: decisions 3 (pricing) and 4 (one read model, every reader), and step 3 of the order of work.
* The LIN-4126 review, `docs/reviews/cost-tracking-review-2026-11-02.md`: §1.3 (readers), §1.4 (where usage is read differently), and §3.1 items 2 and 3.
* The notes after tidies 3, 4 and 5 on LIN-3936, especially "What still differs" after tidy 5.

**This step, and why now.** Tidies 1 to 5 gave the pieces one owner each: which entry is a row's usage, how a lineage's rows are folded, which rows belong to a lineage, and pricing at read. But each surface that shows a cost still puts those pieces together its own way: `/cost`, the KPI pages, Settings › Health and › Models, the run and session pages, the effort readout, Ship's Biscuit, and any others. So their figures can still disagree. This step makes that one read, which every surface asks, with the copies deleted. It is next because the per-request ledger (the next rebuild) should change one reader, not many.

Not here: changing what producers post (the ledger), and the Costs page.

**Done when.**

* Every surface that shows a cost or token figure gets it from the one read, and nothing else computes one.
* For the same issue or period, every surface shows the same figure, and a test that compares them would fail if one drifted.
* A figure that can't be fully priced shows as such everywhere, and is never silently zero.
* Figures before and after, compared on the same recorded inputs, differ only where the change list says why.
* No issue loses a figure it had before unless that is named and explained.

**Permission.** It may remove things, including tests that pin implementation, and leave bugs for now if it names them. LIN-4148 (the fetch limit can move a lineage's issue) lives in this read; fix it or name it.

**Report back**, under these headings:

* **What changed**
* **What was left, and why**
* **What still looks fuzzy across the area**
* **Follow-ups**: listed, not filed.

## How to go about it (from a Survey before work began)

A Survey looked at the ground first. Its advice on what to do before any code, which we're taking:

* **Take an inventory of the readers first.** For each surface that shows a cost, write down the question it answers, the rows it counts, its window, the shape of its input, and how it treats an unpriced figure. Then **capture each surface's output on one fixed set of stored rows** as the "before". That shows whether "one read" is really one read with a few parameters, it makes the agreement test writable, and it gives the before/after comparison inputs that don't depend on live data.
* **Settle these at the start, not the end:**
  * **What "in a period" means:** a row's dispatch time, a lineage's start, or a call's timestamp.
  * **How LIN-4148 is handled** in the shared read.
  * **The baseline for "no issue loses a figure":** the state after tidy 5.
* `/kpis` **keeps what it counts today.** Changing that is out of scope (`docs/plans/costs.md`, "Not in scope"). It asks the one read for its own population.
* **Two PRs are fine** if the size calls for it: for example, worker cost first, then Harbour's call-log readers and how unpriced figures are shown.

---

## Research findings (3 Nov, grounded at Harbour `main` `9e397e6b`)

Full notes, including a brief for each layer with its sources, are in the research comment. This is the summary the plan builds on.

**Re-ground.** No commit has touched any cost file since tidy 5 (`46b43b3b`, tests-only `caa478a5`). `git log --since=<ticket created>` is empty on `main`. The review's reader list (§1.3) has moved since tidies 3 to 5: R13 is deleted; R1, R10/R11 and R15 now share `foldLineageUsage` (`lib/row-usage.js:68`); R1 and R10 share `groupLineageMembership` (`lib/lineage-membership.js:70`). The census below is the current one.

### The surfaces (class 1), and what each asks

Bound: grep over `lib/ routes/ public/ server.js` for `costUsd|totalUsd|pricedUsd|spendUsd|totalCost|formatUsd|Usd\b`, plus every caller of `buildTaskCost`, `joinCostLineages`, `windowedSpend`, `computeTerminalMarkedTaskCost`, `agentSpendByJob`, `harbourSpendByJob`, `typicalByModel`, `summarize`, `summarizeByIssue`, `summarizeByFeature`, `listInHorizon` and `buildRunView`. Each hit was classed. The runner repo only produces usage (`hook.js`, `opencode-runner.js`) and reads none.

| \# | Surface | Question | Rows | Window today | Unpriced today |
| -- | -- | -- | -- | -- | -- |
| S1 | `/api/proxy/cost/:id` | this issue's cost | own rows by issue; siblings by anchor, newest-resolved 2000; issue-tagged calls | rows `dispatchedAt` ≥ 30d; queued unbounded | `totalUsd` null if anything is missing; `pricedUsd` partial |
| S2 | Settings › Health, Harbour's AI calls | workspace calls total | call log | `timestamp` ≥ 30d | **null counted as $0** (`lib/llm-call-log.js:124`) |
| S3 | Ship's Biscuit, Weather line | the same | the same `summarize` | always 30d, whatever the edition's window | **null as $0** |
| S4 | Observation, scan estimate | typical scan call | call log, `scan` | 30d | mean of priced; unknown if none |
| S5 | Settings › Models, agent spend per job | job spend | `readModelsHistory`: 30d, newest-resolved 2000, `buildTaskCost` with no issue | rows ≥ 30d; a straddling lineage takes its earliest in-window row's kind | partial + counts |
| S6 | Settings › Models, typical per model | the same, by model | the same | the same | the same |
| S7 | Settings › Models, Harbour spend per job | job spend | `listInHorizon` | 30d | partial + counts |
| S8 | Models sidebar | spend by effective model | S5 + S7 | — | priced only |
| S9 | Home decision panel | one job's spend and typical | the same rows as S5 | the same | partial + counts |
| S10 | Effort readout | per kind and per harness/model/effort | live + **newest 200 history rows, no time bound** | row cap | partial + "N of M priced" |
| S11 | Public `/kpis`, cost per finished task | per `[done]` ticket | Mongo projection (`usageEntry`) of rows ≥ 30d, `joinCostLineages` | lineage `start` in 30d | **whole component dropped** if any lineage is unpriced; floor |
| S12 | Workspace KPIs, cost per day | per start day | the same projection | lineage `start` in 30d | priced only + "priced N of M"; **an all-unpriced day shows $0.00** (`lib/render-workspace-kpis.js:150`) |
| S13 | Run and session page | per lineage in a session, and its total | the session's loops, grouped `rootItemId ?? loopId` | unbounded | fold; **a complete $0 shows "not reported"** (`lib/run-view.js:257`); total only if all priced |

**Named as outside the read, and why.**

* Flight Companion's per-turn cost and tab total (`public/flight-companion.js:447`, `:1907`; `lib/agent-turn.js:85` `sumUsage`) come from the live response, not stored rows. That is producer-side, the next rebuild.
* The run paragraph (`lib/run-paragraph.js:42`) excludes cost by design.
* `GET /api/proxy/costs` and the Costs page do not exist yet. They are a destination not yet in the tree, so they are unbounded by construction and out of scope here.
* Research scripts (`scripts/survey-*`) are not product surfaces.

### Is "one read" one read with parameters? Yes.

Every surface asks a question of two populations:

* **worker lineages:** membership, the issue it counts under, start, base kind, the fold, labels, status and ticket walk;
* **Harbour calls:** feature, issue tag, timestamp, cost.

Each question is a selection plus a grouping:

* by issue (S1);
* by job, kind or model (S5–S10);
* by start day (S12);
* by `[done]` ticket component (S11);
* by a session's lineages (S13);
* the workspace total (S2/S3);
* per-feature typical (S4 is S7's `typicalUsd` for `scan`).

Two things are not parameters. They are copies:

1. **Each surface fetches its own rows,** with its own bounds (S1's 2000 newest-resolved siblings, S5's 2000, S10's 200, the KPI horizon). The bounds decide which members of a lineage are seen.
2. **Each surface decides alone how to show a figure that is partly unknown** (five treatments: null→$0, priced-only, partial + counts, all-or-nothing, $0→"not reported").

The read must own both, or the figures can still disagree.

### LIN-4148 lives here, and is wider than filed

A lineage's **issue** (founder) and **start** are lineage-level facts. Every reader derives them from whichever members its fetch returned. A spike on HEAD (`buildTaskCost`, lineage P founded on LIN-42, a cross-issue follow-up on LIN-99, then more LIN-42 work):

* full fetch: LIN-42 $0.032, LIN-99 no lineage ✔
* **sibling cap drops the founder:** LIN-42 $0.032 **and** LIN-99 $0.032. That is a double count, not a move, because the founder still arrives as an LIN-42 own row.
* **30-day horizon drops the founder:** LIN-42 no lineage, LIN-99 $0.032. The lineage moves issue. This needs no 2000-row lineage, only a lineage older than 30 days with an in-window cross-issue follow-up.

The same horizon effect moves `start` for S11 and S12. A lineage started 35 days ago with a member 10 days ago is dated 10 days ago, and counted in-window with its whole running total.

**Recommended fix, in the read:** one identity-bounded find per read, `{urlKey, rootItemId: {$in: anchors}}`. It has a scalar-only projection (`_id, rootItemId, dispatchedAt, issueIdentifier, kind, status, abort`), no `since` and no limit. `assertBoundedHistoryRead` already accepts it (`lib/dispatch-store.js:288-292`), and it is indexed (`lib/db-indexes.js:240`). It gives every in-scope lineage its true founder, start and member count. A lineage whose fetched members are fewer than its count is marked **incomplete**, so it is shown as unpriced and never as a silent partial. It uses no aggregation, so it works on both backends.

### Decisions to settle at the start (recommendations)

1. **"In a period":**
   * a worker lineage is in a period when its **start** (earliest member's `dispatchedAt`, read whole as above) is in it;
   * a Harbour call is in a period by its `timestamp`.

   Why: a running total cannot be split in time. S11 and S12 already date by start. It matches membership. The ledger rebuild moves workers to per-request timestamps later, and that becomes that step's named change.

   Named consequence: S1, S5, S9 and S10 stop counting a lineage that started before their window. Today they count it with a moved founder.
2. **LIN-4148:** fixed in the read, as above. Truncation marks the lineage incomplete; it never re-attributes.
3. **Baseline for "no issue loses a figure":** HEAD `9e397e6b` (tidy 5 deployed). A live `/cost` sweep of LIN-3950..LIN-4176 taken during this research is in the comment, as the reference. The gate is the fixture replay, not the live data.
4. **One rule for a partly unknown figure:**
   * a figure is the priced sum **plus** its coverage (priced, unpriced, no usage, unreadable, incomplete);
   * a surface shows the sum only when coverage is complete; otherwise it shows the sum as "N of M priced", or no figure;
   * never $0 for unknown, and never "not reported" for a known $0.

   The deliberate exceptions stay as visible parameters: S11's whole-component rule and floor (`/kpis` keeps its population), and S1's published `totalUsd`/`pricedUsd` contract.
5. **Split:**
   * PR 1: the worker-lineage read (loader with the founder query, lineage records, the figure rule) and S1, S5, S6, S8, S9, S10, S11, S12 and S13 on it.
   * PR 2: the Harbour-call half (S2, S3, S4, S7, and S1's app calls) and one USD formatter for all surfaces (today there are six: `lib/render-kpis.js:132`, `lib/render-workspace-kpis.js:46`, `lib/render-effort-readout.js:20`, `lib/render-settings.js:88`, `lib/components/decision-panel.js:33`, `lib/render-run-steps.js:270`, plus client copies).

   The reader contract (the figure shape) lands in PR 1, so PR 2 only adds a population.

### Proof the builder can run

There is no committed cost replay. The tidies' replays were ad hoc, and the proxy's dispatch rows carry no `rootItemId` and only the wire status (checked: `GET /api/proxy/dispatch/:id`), so stored rows cannot be rebuilt from the proxy. Recommended:

* a checked-in fixture corpus: dispatch rows in both shapes, and call-log docs, with one case per behaviour in the class lists below;
* a script that runs every surface's current function on it at the base commit (the "before"), and the new read on it (the "after"), diffing per surface;
* every difference must be on the change list.

Plus an agreement test: for one fixture period and issue, every surface's figure is equal.

Live re-sweeps are a post-deploy check, not a gate.

### Classes

| Class | Bound | Members |
| -- | -- | -- |
| Cost-showing surfaces | the grep and caller walk above | S1–S13; outside, with a reason: Flight Companion live, run paragraph, `/api/proxy/costs` and Costs page (not in tree), survey scripts |
| Row fetches feeding cost | callers of `listHistory`/`listHistoryWithBodies`/`listItems`/`loadDispatchHistory` whose rows reach a cost function | S1 own and siblings (`routes/proxy-compute.js:676-701`), `readModelsHistory` (`lib/model-routing-history.js:15-17`, S5/S6/S9), effort (`routes/dashboard-effort.js:37`, S10), `loadDispatchHistory` (`lib/kpi-stats.js:488`, S11/S12; workspace call at `lib/workspace-kpi-stats.js:147`), session loops (`routes/dashboard.js:691`, S13) |
| Unknown-figure treatments | readers of `costUsd`/`cost` and their renderers | null→$0 (S2, S3, `sumUsage`); priced-only (S8, S12 per day); partial + counts (S5–S7, S9, S10, S12); all-or-nothing (S1 `totalUsd`, S11 per component, S13 header); $0→"not reported" (S13) |
| Lineage facts derived from a fetch | readers of `groupLineageMembership` | `issueIdentifier`, `start`, base `kind` (S1, S5, S9, S10 through `buildTaskCost`; S11, S12 through `joinCostLineages`). S13 groups by `rootItemId ?? loopId` itself (`lib/pipeline-loops.js:360`), which is the same anchor; its members are the session's loops |
| USD formatters | grep `toFixed` near `$` in `lib/render-*`, `lib/components`, `public/` | the six above, plus `public/observation.js:3990`, `public/prompt-section.js:1426`, `public/flight-companion.js:425`, `lib/ship-biscuit.js:525` |
| **Not bounded:** production rows that hit the cap or the horizon | production data | the effect is measured by the post-deploy re-sweep, not here |

**Surface Assessment: \[lands cleanly\]**

This task *is* the consolidation: one read that owns the cost row fetch (with the founder query), the lineage and call records, and the figure rule. No preparatory refactor has to land first.

The one condition is that the copies are deleted **in the same change**. These are `buildTaskCost`'s loop, `reduceLineageCost`/`windowedSpend`, `run-view`'s `lineageCost`, `summarize`'s cost fold, and the per-surface fetch bounds. A read added beside them would be a second representation of lineage cost, and that would flip this verdict.

*Improvements noticed, not required (land inline or leave):*

* `lib/weekly-budget.js` is misnamed (it holds only `windowedSpend`, which this work absorbs).
* `lib/row-usage.js` and `lib/lineage-membership.js` sit in the code-shape catch-all ("Other features"). The new module should be named into an area pattern (Theseus §7).

## Implementation Plan

**Revised 3 Nov after the plan-review verdict (Request Changes).** B1 is accepted and fixed: change (d), "S11/S12 count a lineage by its true start", is dropped, and one period rule now covers every worker surface. Builder notes 1 to 5 are each answered below (marked **\[N1\]** to **\[N5\]**). Everything else is carried over from the plan as reviewed, which the verdict found sound. Nothing in the description above this heading changed.

### What this is for, and what done looks like

Every place that shows a cost or token figure assembles the same four decisions (which entry is a row's usage, how a lineage's rows add up, which rows belong to a lineage, pricing at read) its own way, over its own fetch. So the figures can disagree, and one of them has a real defect: a lineage's issue and base kind are read off whatever rows a surface happened to fetch (LIN-4148). The per-request ledger (next rebuild) should change one reader, not a dozen.

**Done, as the ticket states it** (kept as written): every surface gets its figure from the one read and nothing else computes one; for the same issue or period every surface shows the same figure, and a test fails if one drifts; a figure that cannot be fully priced shows as such everywhere and is never silently zero; before and after differ only where the change list says why; no issue loses a figure unless named and explained. Not here: what producers post, the daily read model, the Costs page.

No drift between what the ticket asks and what it is for.

### Re-ground (done at HEAD, again for this revision)

Harbour `origin/main` is `9e397e6b` and `git log --since=2026-11-03T21:06:38Z origin/main` is empty; no cost file has changed since tidy 5 (`46b43b3b`). Runner is at `5379817`. I re-read the source behind the review's facts at that commit instead of taking the verdict's word:

* `/kpis` fetches only rows with `dispatchedAt ≥ horizon` (`lib/kpi-stats.js:450`, `loadDispatchHistory` `:488`), so every lineage `computeTerminalMarkedTaskCost` sees has a fetched `start` inside the window, and its test `lineage.start < windowStart` (`lib/terminal-marked-task-cost.js:187`) never excludes anything on the cost path. Today `/kpis` counts any done, non-skipped lineage **with a member in the last 30 days**.
* The outcome rate dates a lineage by the same fetched `earliest` (`lib/kpi-stats.js:824`), and `windowedSpend` (`lib/weekly-budget.js`) buckets by `lineage.start` the same way. All three agree today only because they share the fetched start.
* The fold counts the last running total plus every delta wherever it sits (`lib/row-usage.js:68-101`).

**Where I disagree with the research** (each changes the plan):

1. *Incomplete = "fewer fetched members than the count" would drop figures.* Every lineage with a member older than the window would go incomplete and `/cost` would go null for it. A claude-code lineage is exact from its newest row (see the incomplete rule). Incompleteness is narrower.
2. *"In a period" is not the lineage's true start, for any surface.* The figure is the lineage's cumulative total, and the true start would drop every straddler from `/kpis` (the review's B1). One rule instead: **activity in the window**.
3. *S10 does not move to a 30-day window.* Its rows also feed the survival and duration columns. Its fetch stays its own parameter; only its cost goes through the read.
4. *The public* `/kpis` *founder lookup needs per-workspace batches.* `{urlKey, rootItemId}` is the index; an `{$in}` without `urlKey` scans.

### The change

One new module, `lib/cost-read.js`, with three owned jobs and a formatter beside it (`lib/cost-format.js`, plus one public file for the browser).

**Lineage identity (fixes LIN-4148).** A lineage's issue (founder), base kind and true member count are read from a **founder lookup**: one scalar-only read of `{urlKey, rootItemId: {$in: anchors}}` over history and queue (the same two-collection shape as `lineageEndedIds`, `lib/dispatch-store.js:351`), with no `since` and no `limit`, projecting only `_id, rootItemId, status, abort, kind, issueIdentifier, dispatchedAt`. `groupLineageMembership` still decides what a member is and who founds; it runs over these rows. The usage fetch keeps its own bounds and only supplies usage. Two adapters feed the one function: the dispatch store (S1, S5, S9, S10) and the raw collections (S11, S12, batched per `urlKey`).

* The record does **not** expose a re-dated start. Nothing in this ticket dates a lineage by its true start, and leaving it out keeps a later change from doing so quietly.
* Alternative set aside: widening each caller's fetch (no `since`, no cap). It reads whole feedback bodies for a lifetime of rows; the cause is identity, not usage.

**Lineage records.** Per lineage: anchor, issue, base kind, last activity, members (fetched, in order), outcome status and ticket walk (from `groupDispatchLineages`, as `joinCostLineages` does today), and one fold (`foldLineageUsage` over `readUsageEntry(usageOf(row))`, which serves both row shapes). `joinCostLineages` and `reduceLineageCost` are deleted. The three decisions stay where they are (`row-usage`, `lineage-membership`, `session-telemetry`); the module composes them and restates none.

**One period rule, for every worker surface \[B1\].** A lineage is counted in a surface's selection when **it has a member in that selection** (the surface's window, or for S10 its 200-row corpus). Its issue, base kind and member count are the true ones from the founder lookup; its figure is its whole cumulative total, as today. Calls are in a period by their `timestamp`.

* S1, S5/S6/S8/S9, S10: as above. S1's own rows are found by issue **identity** (no `since`), and kept only if the lineage has activity in the window. That is what lets a lineage older than the window show under its true issue when only a follow-up on another issue is in the window.
* **S11 keeps exactly today's population** (done, not skipped, a member in the window). The only difference is the issue it credits, which is now the true founder's (change (b)). The outcome rate and the cost card keep selecting the same lineage set.
* **S12 keeps today's day bucket**: the day of the lineage's earliest *in-window* member. This is a display rule for the ledger to replace with per-request timestamps; it is named, not fixed, here.
* Nothing in the read derives a period from a re-read start. If a later ticket wants true-start dating for `/kpis`, that is a question for John first, and is not a heads-up.

**Incomplete (the narrow rule) \[N1\].** A lineage is *incomplete*, and so never fully priced, only when a true member that was not fetched could change its figure: some true member is missing from the fetched rows **and** (the fold counts an `opencode` delta, or the fold is `no-usage`/`unreadable`, or a missing member was dispatched after the counted running total). A claude-code lineage whose missing members are all older than its counted total stays exactly as priced as today.

The rule leans on one assumption the founder projection cannot see: that **one** `rootItemId` **is one harness**. I checked it against the runner instead of assuming:

* A `followUpTo` item routes to SIGNAL, RESUME or REJECT (`dispatcher.js:873-900`). RESUME takes the harness from the *original session*, "never re-resolved from the follow-up item" (`dispatcher.js:936`). REJECT posts a failure with no usage. A fresh launch, which does resolve a harness from the item (`dispatcher.js:1209`), is only for non-follow-ups, and those mint their own `rootItemId`; only a follow-up inherits one (`lib/dispatch-factory.js:719-720`).
* So the runner cannot put a different harness into an existing lineage, and the review's worry (an older opencode delta dropped under a fetched claude-code total) cannot arise from rows it produced. `foldLineageUsage`'s header still says "a mixed lineage is additive", so stored mixed lineages cannot be ruled out from the code alone.

So the rule stays narrow and the unverifiable part is made visible instead of assumed: the replay and the post-deploy sweep **count lineages whose fetched rows mix an opencode delta with a running total**. If that count is not zero on production, the rule tightens to "incomplete whenever any true member is missing". W3 pins both sides.

**The figure rule.** One shape for any sum over lineages or calls: the priced sum, plus counts of priced, not priced, no usage, unreadable and incomplete inputs, and a derived `complete`. Rules: complete is priced end to end, and a complete 0 is a real `$0.00`; not complete shows the priced part with its gap named ("$12.40, 3 not priced"), or "not priced" when none priced; no inputs is "no data", distinct from zero. `/cost` keeps its published keys and order: `totalUsd` = complete ? sum : null, `pricedUsd` = the sum, counts unchanged.

**Calls.** Cost arithmetic leaves `lib/llm-call-log.js`: the store only returns docs (`listInHorizon` gains `issueIdentifier`/`feature` filters; the existing indexes serve them), and the read sums them with the figure rule. `summarize`, `summarizeByIssue` and `summarizeByFeature` lose their cost folds; latency and token parts of `summarize` stay as pure functions over docs. S4's scan estimate becomes S7's `typicalUsd` for `scan`.

**One formatter.** `formatUsd(value, {fine})`: cents by default, a nonzero amount under half a cent reads `<$0.01`, `fine` gives four decimals under $1 (per-call surfaces: Health, Biscuit, the scan estimate, as parameters, not defaults), null or unknown is the caller's word, never `$0.00`. The six server copies, `lib/ship-biscuit.js:525` and the browser copies (`public/observation.js:3990`, `public/prompt-section.js:1426`, `public/flight-companion.js:425`) are replaced; browser and server share one source file, or a parity test runs one input table through both (the `ship-biscuit-parity` pattern exists).

**Surface exceptions kept, as parameters:** S11's component rule, public count floor and 2dp stay in `terminal-marked-task-cost`/`kpi-stats` (population logic, not cost arithmetic) and call the read's fold; S1's response contract; S13 groups loops itself (a display decision fenced by tidy 5) and takes only the per-group figure from the read; S10's 200-row corpus; Biscuit's fixed 30 days; S12's day bucket.

### What changes for readers (the change list; replay must show exactly these)

* (a) **Double count removed (LIN-4148, cap variant):** a lineage whose founder was truncated no longer also counts under the follow-up's issue.
* (b) **Moved lineage returns home (LIN-4148, horizon variant):** a lineage older than 30 days with an in-window follow-up on another issue counts under its true issue, and only there. This reaches S1, S5, S9, S10 and also **S11/S12**: the lineage set is identical, but a straddler's ticket is credited to its founder's issue instead of the follow-up's. The replay lists every lineage whose issue moves on the public path; the lineage set itself must equal the golden's.
* (c) **Base kind is the true base kind** (S5, S6, S9, S10) for straddlers.
* (d) **Unknown figures:** S2/S3 stop counting a null call cost as $0 (they show the unpriced count); S12 stops showing `$0.00` for a day whose started tasks are all unpriced; S13 shows a complete `$0.00` as `$0.00`, not "not reported" (an unpriced or unreadable lineage still withholds); incomplete lineages show as such everywhere.
* (e) Nothing else. In particular S8 stays priced-only (a projection over S5+S7, now said so), and no surface changes which lineages it selects.

### Where the behaviour lives, and how we know it is all found

The behaviour is "a cost figure is computed from rows". Searches anyone can repeat (the builder runs them and puts the result in the PR): importers of `foldLineageUsage`, `groupLineageMembership`, `readUsageEntry`, `readRowUsage`, `lastUsageEntry`, `usageOf`; callers of `buildTaskCost`, `joinCostLineages`, `windowedSpend`, `reduceLineageCost`, `summarize*`, `listInHorizon`; `toFixed` next to `$` under `lib/ routes/ public/`. The research's census (S1 to S13) was cross-checked against these at HEAD and matches; the reviewer re-checked the `buildTaskCost` callers and `durationMs`. Out, with reasons: Flight Companion's live figure and `lib/agent-turn.js` `sumUsage` (producer-side; its formatter is in), `run-paragraph` (excludes cost), the Mongo `$last` in `kpi-stats.js:460` and the digest's `kpiUsageEntry` (a query cannot call JS; they stay as the named copy, pinned by a parity test against `lastUsageEntry`), `effort-readout`'s status-side `anchorFor` (outcome side, not cost). **What catches the rest:** a census test (like `key-state-census`) that fails when any file outside the allow-list imports those functions or formats `$` + `toFixed`, so a surface added later cannot quietly compute its own.

### Order of landing: three pieces, each verified on its own

This needs more than one pass: about 13 surfaces, three fetch shapes, a public-page population, a published contract, a new fixture corpus and a replay. Three landings, in order, each deleting the copies it displaces (no piece adds the read "beside" a live copy of what it moved):

1. **Baseline, read core,** `buildTaskCost` **callers.** Fixture corpus (both row shapes plus call-log docs; one case per class: founder outside cap, founder outside horizon, wake, cross-issue follow-up, opencode deltas, a mixed-harness lineage, unreadable, unpriced Haiku, complete $0, all-unpriced day, unpriced calls, issue-less lineage, lane tickets, **and a corpus larger than S5's 2000-row cap \[N2\]**) and a **replay script that captures every surface's current output at** `9e397e6b` **as committed goldens before any change**. Then `cost-read` (founder lookup, records, incomplete rule, figure rule), S1, S5/S6/S8/S9, S10. Delete `buildTaskCost`'s loop (move S10's duration into `effort-readout`, its only consumer of `durationMs`) and the models/effort fetch-derived facts. `cost-format` lands with the first surface that needs it.
2. **KPI path and run page.** S11, S12, S13 on the read; delete `joinCostLineages`, `reduceLineageCost`, `windowedSpend`'s reduce, `run-view`'s `lineageCost`; fix the S12/S13 display. **The founder lookup stays on the KPI path \[N3\]**: it is still needed there, for the issue (not the start). Time it on a seeded store here.
3. **Calls, formatters, agreement, docs.** S2/S3/S4/S7 on the calls read; remove the call-log cost folds; replace the remaining formatters; census test; agreement test; update `docs/architecture/source-map.md`, `docs/proxy-integration.md` and `lib/proxy-instructions.js` prose where a figure's wording changes; close LIN-4148.

### Witnesses (each fails before, passes after, unless marked guard)

* **W1 LIN-4148, cap:** lineage P (founder LIN-42, follow-up LIN-99, follow-up LIN-42), founder dropped from the sibling fetch. Before: counted under both. After: under LIN-42 once, none under LIN-99; the sum over issues equals the lineage total once.
* **W2 horizon:** founder older than the window, in-window follow-up on LIN-99. After: under LIN-42 only, in S1, S5 and S9. **S11/S12 select the same lineage set as the golden, the lineage's ticket is credited to LIN-42, and S12 puts it in the golden's day bucket** \[B1\].
* **W3 incomplete, both ways:** (guard) a claude-code lineage with members older than the window prices exactly as before, so `totalUsd` does not go null; an `opencode` lineage with a dropped member is incomplete, not a silent partial; a `no-usage` fold with a dropped member is incomplete, not "no telemetry". **Mixed harness \[N1\]:** a fixture lineage mixing a fetched opencode delta and a running total prices additively and is counted by the mixed-lineage tally; a fixture where the opencode member is dropped is documented as the residual (priced, by the one-harness invariant) and is what the tally exists to catch.
* **W4 agreement:** on the fixture, per issue and period: S1 = the sum of S5's lineages for that issue **when S5 is not truncated** \[N2\] (in the over-cap fixture S5 must show its truncation, as `routes/settings.js:326` does, and S1 still sees the lineage); S5's 30-day total = S12's 30-day sum over the lineages both count \[N5\] (the replay lists any lineage one counts and the other does not, with its stated reason, such as skipped); S1 = S13's group figures; S12's period sum = S11's per-lineage costs over the same lineages; S2 = the sum of S7 across features, priced and unpriced counts both; S1's calls are a subset of S2.
* **W5 no silent zero (the guard being loosened for S13, tried):** an unpriced lineage and an unreadable lineage still show "not reported"; a complete 0 shows `$0.00`; `formatUsd(null)` and `formatUsd(undefined)` never return a dollar figure; an all-unpriced S12 day is not `$0.00`; a null call cost is never added as 0.
* **W6** `/kpis` **unchanged \[B1, N4\]:** replay of `computeTerminalMarkedTaskCost` and the public block on the fixture is identical to the golden **except credited issues on a horizon straddler (change (b))**; the lineage set is equal. **The outcome rate's lineage set and the cost card's in-window lineage set are the same set**, asserted directly, so a later period change cannot split them quietly. The privacy assertion (no identifier crosses `kpi-stats.js`) and `kpi-stats-pins` stay green.
* **W7 contract:** `/cost` JSON on the fixture is byte-identical to the golden (keys, order) except named changes; `proxy-issue-cost-route` tests pass.
* **W8 census** (above) and the `$last` ↔ `lastUsageEntry` parity test.
* **W9 replay:** after the change every difference from the goldens is on the change list above; a test fails on any other.

### Likeliest ways this breaks

1. **The founder lookup on** `/kpis`**.** Instance-wide, thousands of anchors, 60s cache, and the aggregation has timed out before (LIN-3002). Batch per `urlKey`, scalar projection, and time it in piece 2 on a seeded store. If too slow, the builder may restrict it to anchors whose earliest fetched member has a `followUpTo` (a root row has none), proven by W2 \[N3\]. Never fall back to the fetched window for the issue.
2. **An issue loses a figure through the incomplete rule or the activity rule.** Guarded by W3 and the replay; the post-deploy re-sweep of the research's table is a check, not a gate. The mixed-harness tally is the tripwire for the one assumption the code could not settle.
3. **The** `/cost` **bytes or the public numbers move by accident.** W6/W7. The one intended public movement is (b)'s ticket credit; anything beyond it is a bug.

### Left, and why (for the report-back)

The cumulative-versus-window mismatch (a lineage's whole total lands in whichever window it is active in, and S12 buckets it on its first in-window day) stays; the ledger fixes it. Whether `/kpis` should date by true start is a product ruling nobody has made; not taken here. Ship's Biscuit's fixed 30 days (review F6) is a product call on edition windows. S13 on a lean build still reads "not reported" (the tidy 2 trap; only `run-paragraph` sees it and it excludes cost). The call log's issue tag remains a second attribution rule until the ledger carries one per call. `digestFeedback` still prices at write and discards it. Three copies of "which entry is a row's usage" drop to two named ones (the Mongo `$last` and the digest's `kpiUsageEntry`), now pinned. Follow-ups, not filed: rename or absorb `lib/weekly-budget.js`; name the new modules into a code-shape area.

### Review verdict, answered

| Finding | Answer |
| -- | -- |
| B1 | **Fixed.** One period rule (activity in the window) for every worker surface; true identity from the founder lookup; (d) dropped; W2 reworded; S11's population and S12's bucket are the golden's. Verified against `kpi-stats.js:450,488,824` and `terminal-marked-task-cost.js:187`. |
| N1 | **Checked, rule kept narrow.** The runner cannot mix harnesses within a `rootItemId` (`dispatcher.js:873-900,936,1209`; `dispatch-factory.js:719-720`). Stored mixed lineages cannot be ruled out, so a mixed-lineage tally is the tripwire and W3 has the case. |
| N2 | **Taken.** Over-cap fixture; W4 states S1 = ΣS5 only when S5 is not truncated, and that S5 shows its truncation. |
| N3 | **Taken.** Founder lookup stays on the KPI path for the issue; the follow-up-anchor fallback is kept. |
| N4 | **Taken.** Added to W6. |
| N5 | **Taken.** Change list is (a) to (e); the changelog line closes on one rule. W4 gained S5 = S12. |

Why a second reader: it spans more than one session, touches the published `/cost` contract and the public `/kpis` population, and softens one display guard (W5 tries it). On this revision the reader should check only that B1 is closed: that no surface dates a lineage by a re-read start, and that S11's lineage set is the golden's.

Session fit: needs multiple sessions

plan-review due: yes
