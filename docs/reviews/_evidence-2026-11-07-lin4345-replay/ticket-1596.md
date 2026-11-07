# LIN-1596: Feedback: On the KPIs page: The gap I notice: this page counts activit

State: In Progress
Labels: Improvement, scoping

## Description

## As asked

On the KPIs page: The gap I notice: this page counts activity, not outcomes. Everything here is a volume metric — actions, dispatches, notes. The number that would prove yesterday's thesis is missing: what fraction of dispatches end [done] vs [failed]/[aborted], and what fraction of merges were zero-touch. The work-funnel and step-outcomes charts presumably hold this, but it's not headlined. "76,623 agent actions" is impressive; "X% of dispatched work landed without human touch, trend up" is the KPI the whole product exists to move. That's the one I'd put at the top — and, in the spirit of the recursion from last time, link each headline number to the evidence behind it.

---

* **Page:** `https://harbour.cat/workspace/linearviewer/`
* **Browser:** `Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Mobile Safari/537.36`

*End of what was asked. Steps write below this line; nothing above it changes.*

**Origin — raw feedback (triage first):** this ticket was filed directly from the in-app feedback widget, so it is an unfiltered user report, not a triaged or scoped task. Its natural next step is **triage**: work out what is actually being asked, confirm the real priority, and scope it before any research or implementation.

---

# Scope (scoping pass)

**Staleness re-check.** Re-verified at HEAD `a02ec683`. `git log --since="2026-07-26T15:36:33.413Z"` over `lib/kpi-stats.js`, `lib/render-kpis.js`, `public/kpis.js`, `lib/dispatch-terminal.js`, `lib/dispatch-store.js` returns nothing. The triage comment's observations all still hold at HEAD; everything below is additional and code-verified.

## In scope

1. **A dispatch-outcome rate as the page's headline KPI** — instance-wide, 30-day, derived from the terminal-marker seam (`lib/dispatch-terminal.js`), not from the existing funnel.
2. **A trend for that rate** — weekly buckets *inside* the 30-day window (see the retention constraint below; a "vs. previous 30d" comparison is not possible).
3. **An evidence link on that one new headline number**, pointing at the chart/section that substantiates it. This ships as the *exemplar* for the general "link each headline number to its evidence" ask.

## Out of scope — split out

| Split | Why | Next action |
| -- | -- | -- |
| **Zero-touch merge rate** | No data source exists in Harbour, on either half of the phrase (see "Zero-touch" below). Needs a feasibility pass before it can be planned at all. | New ticket, `research` |
| **Evidence links on the other 11 stat cards** | Self-contained UI work with no data dependency. Generalises the exemplar this ticket ships; blocking a shippable metric behind a page-wide link pass buys nothing. | New ticket, `plan` |
| **Per-workspace outcome rates** | `lib/kpi-stats.js` is the documented privacy boundary for a public, unauthenticated page: counts, day buckets, and app-defined labels only, never `urlKey`s. A per-workspace success rate is exactly the per-workspace performance disclosure that boundary exists to prevent. If wanted, it belongs on an authenticated surface (Observation). | New ticket if wanted; not blocking |

Also out of scope: changing the existing funnel or step-outcomes charts, re-labelling existing cards, and any layout/theme work.

## Metric definition — settled

**Headline:** `done ÷ (done + failed + aborted)` over resolved dispatch lineages in the last 30 days.

* **Unit of count is the *lineage*, not the dispatch row.** One piece of work is frequently several rows (an original plus its follow-ups). Counting rows would make a task that needed four follow-ups contribute four dispatches and up to four `[done]`s — inflating the success rate precisely on the work that needed the most human help. Group by `rootItemId` (the per-runner-session lineage anchor, LIN-1468, inherited only through `followUpTo`) and take the **last** terminal marker in the lineage. Not `sessionGroupId`: it also folds an autopilot's sibling workers together via `sessionId`, collapsing genuinely distinct pieces of work.
* `[aborted]` **counts in the denominator, as its own slice** — not folded into `failed`, not excluded. The headline claim is "X% of dispatched work landed"; aborted work did not land. Excluding it would let the number improve whenever operators cancel more work, which is the wrong incentive for the metric the product exists to move. Publish three slices — `done` / `failed` / `aborted` — so the cancellation rate stays legible rather than hidden inside a failure bucket.
* `[skipped]` **is excluded entirely.** Per `lib/dispatch-terminal.js`, `[skipped]` means the runner *refused* a cascade abort because a human was still in that session. It is terminal-benign: nothing ended, so it is not an outcome of the work.
* `abort: true` **rows are excluded from both numerator and denominator, and their** `[aborted]` **marker is attributed to the target row.** This is required, not cosmetic. An abort is its own dispatch row carrying no prompt, and Simple Dispatcher posts `[aborted]` to *that* row, never to the target's stored feedback. An abort row also mints its own `rootItemId` (the anchor inherits through `followUpTo`, and an abort carries `abortTo` instead), so a naive count records **two** lineages for one cancelled task: an `[aborted]` one that was never real work, and a target one with no terminal marker at all. Use the existing shared pair `harvestAbortedTargets` + `feedbackWithHarvestedAbort` (LIN-1257/LIN-1261) — this is the case they were written for. Do not re-derive the rule in `kpi-stats.js`.
* **Denominator is *resolved* lineages** — those with a derived terminal marker. A queued or still-running dispatch has no outcome yet; including it would make the headline a measure of queue latency rather than of outcomes. To keep that honest, render a coverage sub-label alongside the number (`N of M dispatches resolved · 30d`) so the rate cannot be read as covering all dispatched work. The existing funnel chart remains the place where silence and expiry are told in full.

## Verified constraints the plan must respect

* **The requested ratio is not the funnel's** `completed`**.** `funnel.completed` (`lib/kpi-stats.js:443`) counts dispatch ids with a linked *agent-status step* reporting `completed`, correlated by `dispatchId` — a different signal with a different producer. `lib/kpi-stats.js` currently has **zero imports**; this work gives it its first, on `lib/dispatch-terminal.js`. It is a wiring job, not a re-label.
* **Feedback lives only on** `dispatch-history`**, only on** `status: 'taken'` **rows.** `addFeedback` writes exclusively to the history collection (`lib/dispatch-store.js:1178`, `findOneAndUpdate({_id, urlKey, status:'taken', takenByTokenLabel})`), and `_archiveItem` does not copy a feedback array. Queue rows therefore never carry a terminal marker: outcome derivation is history-only, even though the page's `dispatchDocs` volume counts merge history + queue.
* **Do not widen** `loadDispatchHistory`**'s projection.** It deliberately replaces `feedback[]` with `$size` because that array is the fattest field in the collection and reading it whole is what pushed `/kpis` past the 30s router timeout. The marker derivation must happen *inside* the aggregation (e.g. `$filter` + `$regexMatch` reduced to the last matching marker), never by projecting the raw array. The no-`aggregate()` fallback path keeps raw `feedback` and can call `deriveTerminalStatus` directly — the two paths must agree, mirroring the existing dual-shape `feedbackLen` pattern.
* **Retention caps the trend at \~30 days.** `historyTtl` defaults to 30 days (`lib/dispatch-store.js:104`), so rows age out and a "this 30d vs previous 30d" delta is not computable. Use weekly buckets within the window; four is the safe maximum. (Note in passing: the existing `dispatchByWeek` chart reads five weekly windows = 35 days, so its oldest bucket is systematically under-filled. Not this ticket's job to fix, but do not copy the 5-week span.)
* `[ended·unconfirmed]` **is invisible to the terminal regex.** Simple Dispatcher emits it (`hook.js:951`) when a session ends without a completion sentinel; `TERMINAL_FEEDBACK_REGEX` matches only `done|complete|failed|aborted|skipped`. Such lineages derive `null` and fall out of the denominator rather than counting as failures. This is v1-acceptable — inventing a new marker mapping inside `kpi-stats.js` would fork the shared seam — but it is why the coverage sub-label is mandatory rather than nice-to-have.
* **Evidence links need no primitive change.** `renderCard`'s `body` slot is raw HTML by contract, so `renderStatCard` can wrap its value in an anchor without touching the shared card component.

## Zero-touch — why it is split out, not deferred out of laziness

Both halves of "% of merges that were zero-touch" are missing, independently:

* **No merge data at all.** Harbour never reads pull requests. The GitHub provider explicitly filters them out (`lib/providers/github/client.js:108,125` — `.filter(i => !i.pull_request)`), and the PR URLs that reach Harbour arrive only as opaque strings on `[evidence]` feedback entries, carrying no merge state. "PR merged" appears in Harbour only as prose inside a prompt template (`lib/completion-signals.js:175`), never as a measured fact.
* **No human-touch signal.** The truest one, `humanContinued`, is written by Simple Dispatcher's Stop hook into its local `state/sessions.json` (`hook.js:1249`) and is never reported over the feedback API — `humanContinued` appears **nowhere** in Harbour. The plausible substitute does not work either: `dispatchedBy` is populated on *both* the session-auth path (`req.session.accountId`) and the proxy/agent path (`req.proxyCreatedBy` — the account that created the *token*, not a human acting in the moment), so it cannot distinguish a human-initiated dispatch from an agent-initiated one.

The research ticket's first question is therefore which framing is actually wanted, because they cost very differently:

* *Merge-based* ("the PR merged with no human commits/reviews") needs a new GitHub read path Harbour has never had.
* *Intervention-based* ("the lineage finished with no human-initiated follow-up") is much cheaper and may satisfy the ask — it needs only a small additive origin/surface field stamped on the dispatch row at creation, entirely within Harbour, with no Simple Dispatcher change. Only the narrower "a human typed directly into the terminal session" case requires Simple Dispatcher to start reporting `humanContinued`.

## Success criteria

1. A visitor to `/kpis` sees, above the existing volume cards, a headline percentage answering "what fraction of dispatched work landed" for the last 30 days, with `done`/`failed`/`aborted` legible beneath it.
2. That number carries a coverage sub-label naming how many dispatches it is computed over (`N of M resolved · 30d`), so it cannot be misread as covering all dispatched work.
3. A weekly trend within the 30-day window is visible alongside it, so "trend up" is answerable.
4. The number is clickable and lands on the chart/section that substantiates it.
5. The rate is computed per lineage, ignores `abort` rows while honouring the aborts they represent, and excludes `[skipped]`.
6. `/kpis` still renders inside the router timeout on a production-sized `dispatch-history` — no raw `feedback[]` read is reintroduced.
7. `lib/kpi-stats.js` still exposes no `urlKey`, prompt text, or issue content.
8. Unit coverage in `tests/unit/kpi-stats.test.js` and `tests/unit/render-kpis.test.js`, both aggregate and non-aggregate paths, including the abort-row and follow-up-lineage cases.

## Non-goals

* Any change to the funnel or step-outcomes charts.
* A per-workspace or per-user outcome rate on the public page.
* Reading PR/merge state from GitHub.
* Any Simple Dispatcher change (this ticket needs none).
* Backfilling pre-LIN-1468 rows that lack `rootItemId` — they degrade to per-row counting, which is acceptable given the 30-day retention window (LIN-1468 landed well before it).

## Assumptions

* The headline is public-page-safe as an instance-wide aggregate: it is a ratio of counts, within the existing privacy boundary.
* Publishing an `aborted` slice on a public page is acceptable; the alternative (hiding cancellations inside `failed`) was rejected as less honest. Cheap to reverse if the product view differs.

## Open questions

1. Does "zero-touch" have to mean *merged without human involvement*, or is *finished without a human-initiated follow-up* an acceptable proxy? This determines whether the split ticket is a new GitHub integration or a small additive field. **Owner: the research ticket.**
2. Is a per-workspace outcome rate wanted on the authenticated Observation surface? Not blocking this ticket.

# Implementation Plan (planning pass)

**Staleness re-check.** Re-verified at HEAD `f556102a` (the scoping pass ran at `a02ec683`; two commits have landed since, LIN-1518 and LIN-1582, both on the token/credential path). `git log --since="2026-07-26T15:36:33.413Z"` over `lib/kpi-stats.js`, `lib/render-kpis.js`, `public/kpis.js`, `lib/dispatch-terminal.js`, `lib/dispatch-store.js`, `public/kpis.css`, `lib/components/card.js` and both named unit-test files returns **nothing**. Every scoped fact below was re-read at HEAD, not carried over from the description.

**Re-confirmed at HEAD:** `lib/kpi-stats.js` still has zero imports; `renderCard`'s `body` slot is raw HTML (and it also accepts `attrs`); `loadDispatchHistory` still replaces `feedback[]` with `$size`; `_archiveItem` (`lib/dispatch-store.js:743-776`) persists `rootItemId`, `followUpTo`, `abort` and `abortTo` into history, so every field this metric needs is already on the row.

## Feasibility probe — the central technical risk is retired

The one thing that could have forced a redesign is whether the terminal-marker derivation can run *inside* the aggregation on both backends. It can. I ran the candidate pipeline against a real MangoDB instance (the same engine `tests/unit/kpi-stats.test.js`'s aggregation suite uses) over a seed containing a `[done]`, a `[failed]`, a `[skipped]`, an empty-feedback row, an `abort:true` row, a two-row follow-up lineage and an `[ended·unconfirmed]` row:

* `$filter` + `$regexMatch` + `$map` + `$last` + `$ifNull` are all implemented by `@jkershaw/mangodb@0.1.2` (`dist/aggregation/operators/`), and are MongoDB 4.4+ standard.
* The pipeline returned exactly one `{message, timestamp}` object per row, **no raw** `feedback` **array on any projected doc** (asserted).
* `[ended·unconfirmed]` derived to missing, confirming the description's prediction rather than assuming it.
* `[skipped]` derived as a marker (so it must be excluded in JS — the regex cannot express the exclusion).

This means the metric needs no new stored field, no backfill, and no widening of the projection to raw feedback.

## Strategy framing

**Strategy A — extend the existing seams (chosen).** Give `lib/kpi-stats.js` its first import (`lib/dispatch-terminal.js`), widen `loadDispatchHistory`'s `$project` with four scalars plus one *derived* single terminal entry, normalise both load paths to one shape, and feed the shared abort/terminal helpers unchanged.

*Cost-of-doing:* ~375 LOC across 7 files, all inside one subsystem. Blast radius is genuinely confined — `collectKpiStats` has exactly one consumer (`server.js:1221`) and `renderKpisPage` one (`server.js:1266`). The high-churn file is `lib/kpi-stats.js` (6 commits, most recent `ea7abb56` "Fix /kpis timeout"), and the discipline that commit encodes is precisely the constraint this plan obeys.

*Cost-of-not-doing:* none. This is the direct route; no workaround tax, no duplicated parsing, no per-backend branching.

**Strategy B — reuse** `lib/pipeline-loops.js` **loop reconstruction.** It already groups lineages, harvests aborts and derives terminals. Rejected: it is per-workspace, reads raw `feedback[]`, and is the heavyweight Observation path. Running it instance-wide would reintroduce exactly the read `ea7abb56` removed.

**Strategy C — denormalise a** `terminalStatus` **field onto the history row at** `addFeedback` **time.** Would make /kpis a trivial group-by and could serve future consumers. Rejected for this ticket: it is a *second representation of already-modelled data* (the marker is already in `feedback[]`), it needs a 30-day backfill this repo has no migration framework for (`lib/db-indexes.js`), and it puts a write-path change on the hottest dispatch write for one read-side consumer. Named here as the natural escalation **if and only if** a second consumer ever needs it.

**Contract gap routed around by the cheaper strategy: none identified.** Strategy A consumes the shared terminal seam rather than forking it. The one known limit — `[ended·unconfirmed]` being invisible to `TERMINAL_FEEDBACK_REGEX` — is a pre-existing property of the *shared* seam, not a gap this plan creates or dodges; the response is the mandatory coverage sub-label, not a private marker mapping inside `kpi-stats.js` (that would be the dialect island). No ticket identifier exists for it today; if the shipped coverage label shows a large unresolved share, that measurement is the trigger to file one.

## Surface list

Discovered by searching for the *concepts*, not only the symbols the ticket cited.

### In scope — modified

| Surface | Change | Why |
| -- | -- | -- |
| `lib/kpi-stats.js` — `loadDispatchHistory` | Add `rootItemId`, `followUpTo`, `abort`, `abortTo` to `$project`; add derived `terminalEntry` (`$last` of a `$filter`+`$regexMatch` over a `$map`-narrowed `{message,timestamp}` list) | The lineage/abort fields are scalars; the terminal entry is derived in-DB so the raw array never crosses the wire |
| `lib/kpi-stats.js` — new `terminalFeedbackOf(doc)` | Returns an at-most-one-entry array from either shape | The dual-shape bridge, exact sibling of the existing `feedbackLen` |
| `lib/kpi-stats.js` — new `computeDispatchOutcomes(...)` | Harvest → attach → drop abort rows → group by lineage → window → bucket | The metric itself |
| `lib/kpi-stats.js` — import + return | First import (`./dispatch-terminal.js`); new `dispatchOutcomes` block | Wiring |
| `lib/kpi-stats.js` — new `OUTCOME_WINDOW_WEEKS = 4` export | Deliberately **not** `WEEKLY_WINDOW_WEEKS` (5 = 35 days vs a 30-day TTL) | The description's explicit "do not copy the span" |
| `lib/render-kpis.js` — new `renderHeadlineCard()` | Percentage + slice line + coverage sub-label, value wrapped in an `<a>` | `renderStatCard` hard-codes `formatNumber`, which is wrong for a ratio |
| `lib/render-kpis.js` — `renderChartBox()` | New optional `anchorId` → `attrs: id="…"` on the section wrapper | The link target |
| `lib/render-kpis.js` — `renderKpisPage()` | Emit the headline above `.kpi-cards`; add the trend chart box | Success criteria 1, 3, 4 |
| `public/kpis.js` | One new chart from `data.dispatchOutcomes` | Success criterion 3 |
| `public/kpis.css` | `.kpi-headline*` rules + `scroll-margin-top` on the anchored box | New markup has no styling |
| `tests/unit/kpi-stats.test.js` | Mock (find) + real-MangoDB (aggregate) cases, incl. a parity test | Success criterion 8 |
| `tests/unit/render-kpis.test.js` | Headline value/coverage/anchor assertions | Success criterion 8 |
| `tests/e2e/kpis.spec.js` | **Two hard-coded counts break**: `.kpi-cards .kpi-card` `toHaveCount(11)` (:15) and `.kpi-chart-box` `toHaveCount(9)` (:44) | Both are CI gates (`.github/workflows/test.yml` runs sharded `npx playwright test`) |

### In scope — read, not modified

`lib/dispatch-terminal.js` (`harvestAbortedTargets`, `feedbackWithHarvestedAbort`, `deriveTerminalStatus`) — consumed **unchanged**. `lib/components/card.js` / `section.js` — both already accept everything needed (`body` raw HTML, `attrs`), so no primitive change, confirming the description.

### Out of scope — discovered and deliberately excluded

| Surface | Why excluded |
| -- | -- |
| `lib/dispatch-terminal.js` — `mergeLineageFeedback` | Different unit of work: it merges sibling feedback for a **per-row** view and entry-filters on `f.rootItemId`, which the narrowed projection does not carry. This metric computes **one outcome per lineage** and does its own grouping, so the function is not applicable — recorded so a reviewer sees it was considered, not missed |
| `lib/pipeline-loops.js` (`_buildLoops`, `harvestAbortedTargets` call site) | Strategy B above |
| `routes/proxy.js:5275-5304` | The other harvest consumer; read as the reference implementation, unchanged |
| `lib/kpi-stats.js` — `funnel`, `stepOutcomes` | Explicit non-goal; `funnel.completed` is a different signal from a different producer |
| `lib/kpi-stats.js` — `dispatchByWeek` 5-week span | Known under-filled oldest bucket; explicitly not this ticket's fix |
| `lib/dispatch-store.js` — `addFeedback`, `_archiveItem` | Strategy C; no write-path change is needed |
| The other 11 stat cards | Split out to its own `plan` ticket |
| `tests/visual/pages-screenshots.spec.js` (`kpis`, :88) | Baseline will shift. **Not** in `npm test` (separate `playwright.visual.config.js`) and not in CI, so it is a follow-up refresh, not a gate — but it *will* need re-baselining and is named here so it is not a surprise |
| Simple Dispatcher | Explicit non-goal; needs no change |

## Data flow

Inside `collectKpiStats`, after `historyDocs`/`queueDocs` are loaded:

1. **Normalise.** `terminalFeedbackOf(doc)` → `Array.isArray(doc.feedback) ? doc.feedback : (doc.terminalEntry ? [doc.terminalEntry] : [])`. One helper, both paths, exactly mirroring `feedbackLen`.
2. **Harvest (row-level, before grouping).** `harvestAbortedTargets(rows.map(r => ({...r, feedback: terminalFeedbackOf(r)})))` → `Map<abortTo, entry>`. Keyed on a dispatch **id**, so it must run before grouping.
3. **Attach + drop.** For each non-abort row: `feedbackWithHarvestedAbort(terminalFeedbackOf(row), harvested.get(String(row._id)))` → `deriveTerminalStatus(...)`. Then discard every `abort === true` row.
4. **Group.** Key = `String(row.rootItemId || row._id)`, over history **and** queue rows. Per lineage keep: the earliest `dispatchedAt` (the anchor's) and the terminal status of the **latest** terminal entry by timestamp.
5. **Window + exclude.** Keep lineages whose earliest `dispatchedAt` is within 30 days. Drop `skipped` lineages entirely (numerator *and* denominator). `null` (no marker, incl. `[ended·unconfirmed]`) stays in `total`, not in `resolved`.
6. **Bucket.** Four 7-day windows ending at `now`, keyed on the lineage's earliest `dispatchedAt` so one lineage lands in exactly one bucket.

Emitted shape:

```
dispatchOutcomes: {
  windowDays: 30,
  total: M,            // lineages dispatched in window (resolved or not)
  resolved: N,         // of those, with a derived terminal marker
  done, failed, aborted,
  rate: N > 0 ? done / N : null,     // null-when-empty, the existing `readsPerWrite` idiom
  weeks: ['YYYY-MM-DD' x4],
  weeklyRate: [.. | null],           // null for an empty bucket
  weeklyResolved: [.. ]              // sample size, so a thin bucket is legible
}
```

## Rendering / client behaviour

* **Headline**, above `.kpi-cards`: `renderCard({className: 'kpi-headline', body})` where body is `<a class="kpi-headline-value" href="#kpi-outcome-evidence">87%</a>` + `<span class="kpi-headline-label">of dispatched work landed · 30d</span>` + a slice line `done 41 · failed 4 · aborted 2` + the coverage sub-label `47 of 63 dispatches resolved · 30d`.
* **Empty state:** `rate === null` renders `—` with the label intact and **no** anchor (a link to an empty chart is a dead end).
* **Link target:** `renderChartBox('chart-outcome-trend', 'work landed · weekly', { anchorId: 'kpi-outcome-evidence' })`. The id goes on the **section wrapper via** `attrs`**, never on the canvas** — `emptyUnless()` (`public/kpis.js:42-52`) calls `canvas.replaceWith(note)`, which would destroy a canvas-borne id on exactly the empty instance where the link still renders. This is the concrete answer to the brief's first open question.
* **Chart:** a bar/line of `weeklyRate` (0–100%), `y.max = 100`, `y.beginAtZero`, gated by the existing `emptyUnless('chart-outcome-trend', sum(weeklyResolved))`. Tooltip footer shows `n = weeklyResolved[i]` so a 100% week off two samples reads honestly.
* No new JS beyond the chart — a plain in-page anchor needs no script.

## Aggregate / non-aggregate consistency

The only shape difference is `feedback[]` vs `terminalEntry`, and it is absorbed at exactly one place (`terminalFeedbackOf`). Everything downstream — harvest, guarded append, status derivation, grouping, bucketing — runs on the identical normalised value. Pinned by a **parity test** that runs one seed through the mock (find) path and the real-MangoDB (aggregate) path and `deepStrictEqual`s the two `dispatchOutcomes` blocks.

**Risk worth naming:** `loadDispatchHistory`'s `try/catch` silently falls through to `dispatchHistory.find({})` — the unbounded raw read that caused the original timeout. A new pipeline that throws on production MongoDB would therefore degrade straight into the failure mode `ea7abb56` fixed, silently. Mitigation: keep the derivation in the *same* `$project` stage (so any operator problem surfaces in CI against real MangoDB, not first in production), and add a `console.warn` on the catch so the fallback is observable rather than silent.

## Privacy boundary

`dispatchOutcomes` emits only integers, four `YYYY-MM-DD` bucket keys and a ratio. No `urlKey`, no prompt, no issue content, no per-workspace or per-user split. The four new projected fields (`rootItemId`, `followUpTo`, `abort`, `abortTo`) are opaque ids that are **reduced to counts and never emitted** — the same posture as the already-projected `urlKey`, which the existing privacy test confirms is projected yet only ever counted. `terminalEntry.message` is runner-authored marker text and is read for its prefix only, never emitted; the existing `JSON.stringify(stats)` leak test (`tests/unit/kpi-stats.test.js:599`) is extended with an assertion that a marker's free-text tail (`[done] <tail>`) does not appear in the serialized stats.

## No raw `feedback[]` on the production path

`$project` never lists `feedback`. The `$map` narrows each entry to `{message, timestamp}` *inside* the DB and `$last`+`$filter` reduce it to at most one object per row before anything is returned. Proven by the probe's `raw feedback leaked? false` assertion, which becomes a standing unit test.

## Cross-cutting concerns

Scoped requirements that share a code path, state or data source — and their expected interactions:

1. **Abort handling × lineage grouping — the most error-prone ordering in the change.** The harvest map is keyed on `abortTo`, a dispatch **id**; lineages are keyed on `rootItemId`. An abort row also mints its *own* `rootItemId`. Harvesting therefore must happen at row level **before** grouping, and abort rows must be dropped **after** their marker is attached. Reverse either order and one cancelled task yields two wrong lineages — the exact bug the scoping pass identified.
2. **Abort handling × outcome derivation.** `feedbackWithHarvestedAbort`'s F1 guard (LIN-1261) only lets a *strictly later* abort override an existing terminal. Reusing the seam inherits that guard free; re-deriving would lose it.
3. `[skipped]` **× harvest.** Two distinct exclusions, both needed. `harvestAbortedTargets` already refuses to harvest a `[skipped]` abort row (it requires `status === 'aborted'`), but a **non-abort** row whose own terminal is `[skipped]` is not the harvest seam's business and must be dropped by `computeDispatchOutcomes`.
4. **Lineage grouping × weekly buckets.** A lineage spans rows with different `dispatchedAt`. Bucketing on the *earliest* keeps one lineage in exactly one bucket; bucketing per row would double-count follow-up-heavy work across buckets — the same overcounting the lineage rule exists to prevent.
5. **Coverage labelling × window.** `total` and `resolved` must be computed over the same lineage set with the same window key, or `N of M` is incoherent. One pass, one key.
6. **Trend key choice.** Buckets are keyed on dispatch time, not completion time, so the coverage label and the trend share one key. The newest bucket is under-*resolved* (recent work has not finished), but because unresolved lineages are excluded from numerator *and* denominator this yields a **smaller sample, not a biased rate** — hence `weeklyResolved` is published alongside so a thin bucket is visible rather than misleading.
7. **Evidence link × empty state.** Covered above: anchor on the section wrapper; no anchor when `rate === null`.
8. **Queue rows × resolution.** Queue rows never carry feedback (`addFeedback` writes only to history, `status:'taken'`), so they contribute unresolved lineages. A lineage holding both a resolved history row and a newer queued follow-up counts as **resolved** under last-marker-wins. Accepted v1 simplification, recorded rather than silently absorbed: it slightly over-states resolution for work that is mid-follow-up, and the coverage label does not reveal it. Cheap to revisit if the number looks wrong in practice.
9. **Pre-LIN-1468 rows.** No `rootItemId` → `String(row._id)` fallback → per-row counting, as the description's non-goal already accepts. Within a 30-day TTL these are effectively extinct.

## Test coverage by file

`tests/unit/kpi-stats.test.js` — mock/find path *and* real-MangoDB/aggregate path:

* the three slices and the ratio, from a mixed seed;
* `[skipped]` excluded from numerator **and** denominator;
* `[ended·unconfirmed]` and empty-feedback rows land in `total` but not `resolved`;
* an `abort:true` row's `[aborted]` attributed to its `abortTo` target, and the abort row itself absent from both counts (the LIN-1257 case);
* a two-row follow-up lineage counts **once**, taking the later marker (the anti-inflation rule);
* pre-LIN-1468 row with no `rootItemId` degrades to per-row without throwing;
* `rate === null` on an empty instance;
* weekly buckets: four of them, one lineage in one bucket, `weeklyResolved` alongside;
* **parity**: identical `dispatchOutcomes` from both paths on one seed;
* **projection**: the aggregate path returns no raw `feedback` array;
* **privacy**: extend the existing leak test with a marker free-text tail.

`tests/unit/render-kpis.test.js` — headline percentage and slice line; coverage sub-label text; anchor `href` matching the chart box's `id`; the anchored `id` present on the section wrapper and not on the canvas; `—` with no anchor when `rate === null`.

`tests/e2e/kpis.spec.js` — update the two counts (11→12 cards *or* keep 11 if the headline sits outside `.kpi-cards`, whichever the implementation chooses — the assertion must match; 9→10 chart boxes), and add a click-the-headline → chart-box-in-view assertion for success criterion 4.

**Follow-up, not a gate:** re-baseline `tests/visual/pages-screenshots.spec.js`'s `kpis` snapshot.

## Scope Assessment

`fits one session`**.**

Roughly 375 LOC across 7 files, confined to one subsystem with two single-consumer entry points. The metric definition is already settled by the scoping pass, so implementation carries no open design decisions. The one genuine technical risk — in-aggregation marker derivation on both backends — has been retired by the probe above rather than left for the implementer to discover. No dependency arrows to enumerate, and no `blocked-by` relations are needed.

**Recommended next action:** `implementation`**.**

**Second open question, answered:** unresolved lineages are surfaced via the coverage sub-label **only**. Success criterion 2 requires exactly that, and any additional page-wide explanatory treatment belongs to the split-out evidence-links ticket rather than to this metric.

## Comments (oldest first)

### 2026-07-26T15:42:19.224Z — None

## Triage

**Metadata applied**

| Field | Change |
|---|---|
| State | Backlog → In Progress (this triage pass) |
| Project | none → **Quality, Periodicals & Measurement** |
| Labels | + `Improvement`, + `scoping` |
| Priority | **unchanged at High** |
| Assignee | left unassigned |

**Project fit — confirmed.** The ask is about *what the instance measures and can prove*, not how the page looks. Nearest precedent in the same project is LIN-894 (add token-spend chart). The other KPI-page tickets (LIN-859 in Product, LIN-469 in DevOps & Tooling) were cross-cutting theme/component migrations that happened to touch `/kpis`, not metric-content work, so they are not the model here.

Priority stayed High because it was submitter-set, not a widget default (`normalizeFeedbackPriority` in `routes/workspace-api.js` falls back to *No priority*), and the request targets the product's headline success metric. Assignee left alone: 1 of the last 40 issues in this workspace carries one, so assigning would be noise.

**Observations** (recorded only — no scoping or implementation done this pass)

- The report is accurate on its face: all 11 headline stat cards (`lib/render-kpis.js:74-84`) are volume counts — workspaces, users, agent actions, autopilot runs, dispatches, feedback notes, and so on. No ratio, no trend.
- "% of dispatches ending `[done]` vs `[failed]`/`[aborted]`" is **not** what the existing funnel measures. `lib/kpi-stats.js` has **zero imports** — it never touches `lib/dispatch-terminal.js`, the shared terminal-marker parser (`deriveTerminalStatus`) that `routes/proxy.js` and `routes/dashboard.js` both use. The funnel's `completed` (`lib/kpi-stats.js:443`) is a different signal: dispatch ids with a linked agent-status step whose status is `completed`, correlated by `dispatchId`. So the requested ratio is reachable from existing data, but as a wiring job onto the terminal-marker seam — not a re-labelling of the funnel chart.
- "% of merges that were zero-touch" has **no data source in Harbour today**. The nearest signal, `humanContinued`, is written by simple-dispatcher's Stop hook into its local `state/sessions.json` (`hook.js:1249`) and is never reported back over the dispatch/feedback API. This half of the request likely needs a new reported signal before it can be a KPI at all.
- "Link each headline number to the evidence behind it" is unimplemented: `renderStatCard` (`lib/render-kpis.js:30`) emits a value/label pair inside the shared card primitive, with no link target.

**Staleness check.** Ticket created 2026-07-26T15:36Z; `git log --since` over `lib/kpi-stats.js`, `lib/render-kpis.js`, `public/kpis.js`, `lib/dispatch-terminal.js` returns nothing (HEAD is `a02ec683`, 15:28Z). The description is current against the code.

**Remaining ambiguity** (for the scoping pass to settle)

1. **What counts as zero-touch** — no follow-up dispatch on the session? no human turn (`humanContinued`)? merged with no human commit? Each implies a different signal, and at least one does not exist yet.
2. **Denominator treatment of `[aborted]`** — a failure, or excluded as deliberate cancellation?
3. **Scope of the headline** — `/kpis` is public and `lib/kpi-stats.js` is the stated privacy boundary (counts and app-defined labels only), so an instance-wide 30d rate is in bounds while a per-workspace outcome rate probably is not.

**Recommended next action: `scoping`.** One pass to settle the three definitions above and to rule on whether the two asks — an outcome-rate headline, and evidence links on headline numbers — are independently shippable. The evidence-link half looks self-contained; the zero-touch half may fan out into a separate simple-dispatcher ticket to report the signal in the first place. Not ready for implementation until that split is decided.

### 2026-07-26T15:50:34.308Z — None

## Scoping

Full scope, success criteria, non-goals and open questions are now in the description. Summary of the decisions and what changed against triage.

**The ask splits three ways, and only one of the three is this ticket.**

| Part | Verdict |
|---|---|
| Dispatch outcome rate as the headline KPI (+ trend, + its own evidence link) | **This ticket.** Ready to plan. |
| Evidence links on the other 11 stat cards | **Split out.** Self-contained UI work, no data dependency — no reason to block a shippable metric behind a page-wide link pass. This ticket ships one card as the exemplar. |
| Zero-touch merge rate | **Split out, needs `research` first.** No data source exists for either half of the phrase. |

**Definitions settled.** Headline is `done ÷ (done + failed + aborted)`, instance-wide, 30d, derived from the terminal-marker seam (`lib/dispatch-terminal.js`) — not from `funnel.completed`, which counts a different signal from a different producer.

- **Unit is the lineage (`rootItemId`), not the dispatch row.** This is the correction I'd most want carried into the plan. Row-counting would let a task that needed four follow-ups contribute four dispatches and up to four `[done]`s — inflating the success rate exactly on the work that needed the most human help. Not `sessionGroupId`, which folds an autopilot's sibling workers together.
- **`[aborted]` counts in the denominator as its own slice**, not folded into `failed`. Aborted work did not land, and excluding it would let the number improve whenever operators cancel more — the wrong incentive for the metric the product exists to move.
- **`[skipped]` is excluded entirely** — it means the runner refused a cascade abort because a human was still in the session. Nothing ended.
- **Denominator is *resolved* lineages**, with a mandatory coverage sub-label (`N of M resolved · 30d`) so the rate can't be read as covering all dispatched work.

**Three findings beyond triage, all code-verified at `a02ec683`:**

1. **`abort: true` rows must be excluded and their marker harvested onto the target.** An abort is its own dispatch row, Simple Dispatcher posts `[aborted]` to *that* row, and it mints its own `rootItemId` (the anchor inherits through `followUpTo`; an abort carries `abortTo`). A naive count therefore records two lineages for one cancelled task — an `[aborted]` one that was never real work, and a target one with no terminal marker at all. `harvestAbortedTargets` + `feedbackWithHarvestedAbort` (LIN-1257/LIN-1261) already encode the rule; `kpi-stats.js` must call them rather than re-derive.
2. **The 30-day `historyTtl` caps the trend.** A "this 30d vs previous 30d" delta isn't computable — the rows are gone. Trend has to be weekly buckets inside the window. (Aside: the existing `dispatchByWeek` chart spans 5 weeks = 35 days against that same TTL, so its oldest bucket is systematically under-filled. Not this ticket's fix, but don't copy the span.)
3. **`loadDispatchHistory`'s `$size` projection is load-bearing** and must not be widened — reading raw `feedback[]` is what pushed `/kpis` past the router timeout. The marker derivation belongs inside the aggregation, with the no-`aggregate()` fallback path kept in agreement (the existing dual-shape `feedbackLen` pattern).

**On zero-touch**, triage's read is confirmed and sharpened: *both* halves are missing. Harbour reads no pull requests at all (`lib/providers/github/client.js` explicitly filters them out; PR URLs arrive only as opaque strings on `[evidence]` entries with no merge state), and the human-touch signal is absent too — `humanContinued` never leaves Simple Dispatcher, and `dispatchedBy` can't substitute because the proxy path populates it from `req.proxyCreatedBy` (the token's creator, not a human acting in the moment). The research ticket's first question is which framing is wanted: merge-based needs a GitHub read path Harbour has never had, whereas intervention-based ("finished with no human-initiated follow-up") may satisfy the ask via a small additive origin field, entirely within Harbour, with no Simple Dispatcher change.

**Recommended next action: `plan`** — for this ticket as now scoped. The two splits should be filed as their own tickets: the evidence-link generalisation goes straight to `plan`, the zero-touch metric to `research`.


### 2026-07-26T16:00:56.136Z — None

## Plan

Full implementation plan, surface list, cross-cutting analysis and testing strategy are now in the description. Summary of what this pass decided and what it found beyond scoping.

**Session fit: `fits one session`. Recommended next action: `implementation`.** ~375 LOC across 7 files, one subsystem, two single-consumer entry points (`collectKpiStats` ← `server.js:1221`, `renderKpisPage` ← `server.js:1266`). The metric definition was already settled, so implementation carries no open design decisions. No dependency arrows, no `blocked-by` relations needed.

**Strategy: extend the existing seams.** `lib/kpi-stats.js` gains its first import (`lib/dispatch-terminal.js`), `loadDispatchHistory`'s `$project` gains four scalars (`rootItemId`/`followUpTo`/`abort`/`abortTo`) plus one *derived* terminal entry, and both load paths normalise through a single `terminalFeedbackOf(doc)` helper — the exact sibling of the existing `feedbackLen`. The shared `harvestAbortedTargets` / `feedbackWithHarvestedAbort` / `deriveTerminalStatus` are consumed **unchanged**. Rejected: reusing `pipeline-loops.js` (per-workspace, reads raw `feedback[]` — reinstates the timeout), and denormalising a `terminalStatus` field at `addFeedback` time (a second representation of already-modelled data, needs a backfill this repo has no migration framework for). **Contract gap routed around: none identified.**

**The central risk is retired, not deferred.** Whether the marker derivation can run *inside* the aggregation was the one thing that could have forced a redesign, so I ran the candidate pipeline against a real MangoDB instance over a seed containing `[done]`, `[failed]`, `[skipped]`, empty feedback, an `abort:true` row, a two-row follow-up lineage and an `[ended·unconfirmed]` row. `$filter`/`$regexMatch`/`$map`/`$last` are all implemented by `@jkershaw/mangodb@0.1.2` and are MongoDB 4.4+ standard; the pipeline returned one `{message, timestamp}` per row with **no raw `feedback` array on any projected doc**. `[ended·unconfirmed]` derived to missing, confirming the description's prediction rather than assuming it. No new stored field, no backfill.

**Four findings beyond scoping, all code-verified at `f556102a`:**

1. **Two hard-coded e2e counts will break and are CI gates.** `tests/e2e/kpis.spec.js` asserts `.kpi-cards .kpi-card` `toHaveCount(11)` (:15) and `.kpi-chart-box` `toHaveCount(9)` (:44). `.github/workflows/test.yml` runs sharded `npx playwright test`, so these fail the merge gate, not just a local run. Neither triage nor scoping caught them.
2. **The evidence-link anchor must live on the section wrapper, never the canvas.** `emptyUnless()` (`public/kpis.js:42-52`) calls `canvas.replaceWith(note)`, which would destroy a canvas-borne `id` on exactly the empty instance where the link still renders. `renderSection` already accepts `attrs`, so `renderChartBox` just needs an `anchorId` passthrough — this is the concrete answer to the brief's first open question, and it confirms the description's "no primitive change" claim.
3. **The `try/catch` in `loadDispatchHistory` makes a pipeline bug a silent production timeout.** It falls through to the unbounded `find({})` — the exact read `ea7abb56` removed. Mitigation in the plan: keep the derivation in the same `$project` stage so any operator problem surfaces in CI against real MangoDB first, and `console.warn` on the catch so the fallback stops being silent.
4. **Ordering is the most error-prone part of the change.** The harvest map is keyed on `abortTo` (a dispatch *id*) while lineages are keyed on `rootItemId`, and an abort row mints its own `rootItemId`. So: harvest at row level → attach → *then* drop abort rows → *then* group. Reverse either step and one cancelled task yields two wrong lineages — precisely the bug scoping identified.

**Trend key.** Weekly buckets are keyed on the lineage's *earliest* `dispatchedAt`, so the coverage label and the trend share one key and a lineage lands in exactly one bucket. The newest bucket is under-resolved, but since unresolved lineages are excluded from numerator *and* denominator that is a **smaller sample, not a biased rate** — so `weeklyResolved` is published alongside `weeklyRate` and shown in the tooltip, making a 100%-off-two-samples week read honestly.

**Second open question, answered:** unresolved lineages surface via the coverage sub-label **only**. Success criterion 2 requires exactly that; any broader explanatory treatment belongs to the split-out evidence-links ticket.

**One accepted simplification, recorded not absorbed:** a lineage holding both a resolved history row and a newer *queued* follow-up counts as resolved under last-marker-wins, slightly over-stating resolution for work that is mid-follow-up. Cheap to revisit once the real number is visible.

Left the `scoping` label alone rather than guessing at the taxonomy — worth swapping for the implementation pass if that label tracks next-action rather than origin.


### 2026-07-26T16:34:36.268Z — None

## Implementation

PR: https://github.com/JKershaw/LinearViewer/pull/1018 · commit `63ea33ff` · branch `lin-1596-dispatch-outcome-kpi`

**Staleness re-check.** Re-verified at HEAD `f556102a`. `git log --since="2026-07-26T15:36:33.413Z"` over `lib/kpi-stats.js`, `lib/render-kpis.js`, `public/kpis.js`, `lib/dispatch-terminal.js`, `lib/dispatch-store.js` and `tests/e2e/kpis.spec.js` returns nothing — the plan held at HEAD and needed no reconciliation. Every plan claim I depended on was re-read in source: `kpi-stats.js` had zero imports, `renderCard`'s `body` is raw HTML and `renderSection` accepts `attrs`, `loadDispatchHistory` still replaced `feedback[]` with `$size`, and `_archiveItem` persists all four of `rootItemId`/`followUpTo`/`abort`/`abortTo`.

### What shipped

Strategy A as planned, ~7 files. `lib/kpi-stats.js` gains its first import (`lib/dispatch-terminal.js`) and a `dispatchOutcomes` block; the shared `harvestAbortedTargets` / `feedbackWithHarvestedAbort` / `findTerminalFeedback` are consumed **unchanged**.

The headline renders as `87% / of dispatched work landed · 30d` over the slice line `done 41 · failed 4 · aborted 2` and the coverage sub-label `47 of 63 dispatches resolved · 30d`, with the percentage linking to a new `work landed · weekly` chart box.

### Plan decisions carried through exactly

- **Ordering** (the flagged error-prone part): harvest at row level → attach → drop `abort:true` rows → group by lineage → last-terminal-wins by timestamp.
- **Anchor on the section wrapper, never the canvas** — with a test asserting the id is on `.kpi-chart-box` and *not* on a `<canvas>`, since `emptyUnless()` replaces the canvas.
- **4 weekly buckets, not 5** (`OUTCOME_WINDOW_WEEKS`), deliberately not reusing `WEEKLY_WINDOW_WEEKS`.
- **No raw `feedback[]` on the production path**: `$map` → `$filter` → `$last` derives at most one `{message,timestamp}` per row in-DB. A standing test asserts the projection carries no `feedback` array and that a non-terminal entry's bulky payload does not escape.
- The silent `try/catch` → unbounded `find({})` fallback now `console.warn`s, per the plan's named risk.

### Two implementation choices worth naming

1. **The headline sits outside `.kpi-cards`.** The plan left this open ("11→12 cards *or* keep 11"). It is a ratio, not a volume count, so mixing it into the card grid would have undone the point — the e2e `toHaveCount(11)` therefore stands unchanged and only the chart-box gate moved (9 → 10). A test pins that the headline renders above the grid and is not inside it.
2. **The 30-day headline window vs the 28-day trend span.** `OUTCOME_WINDOW_DAYS = 30` and `OUTCOME_WINDOW_WEEKS = 4` do not cover the same span: a lineage aged 28–30 days counts toward the rate and coverage label but lands in no weekly bucket. That follows the plan's two constraints literally (full retained history for the headline; four whole weeks for the trend) and is documented at both constants.

### Tests / CI

- `npm run test:unit` — **5202 passed, 0 failed**
- `npx playwright test tests/e2e/kpis.spec.js` — **8 passed**, including a click-headline → chart-box-in-viewport assertion (success criterion 4)
- Full `npx playwright test` — **1056 passed**. A later repeat run flaked 4 unrelated session-teardown specs (`auth`, `error-handling`, `free-tier` logout paths); all 30 pass in isolation and none touch `/kpis`.
- New unit coverage on **both** load paths, per the plan's list: three slices + ratio, `[skipped]` excluded from numerator *and* denominator, `[ended·unconfirmed]`/empty-feedback unresolved, abort-row attribution (LIN-1257), the F1 guard (LIN-1261), follow-up lineage counted once with the later marker, pre-LIN-1468 degradation, weekly bucketing on earliest dispatch, out-of-window exclusion, `rate === null` empty state, queue rows as unresolved lineages, **parity** across mock/aggregate on one seed, **projection**, and a **privacy** case pinning that a marker's free-text tail never reaches the serialized stats.

Verified visually in both states: the populated headline, and the empty state on my local instance (which genuinely has 0 terminal markers across 35 in-window lineages, so it renders `—` with `0 of 35 dispatches resolved · 30d` and no anchor).

### Follow-ups

- **Visual baseline** (named in the plan, not a gate): `tests/visual/pages-screenshots.spec.js`'s `kpis` snapshot will shift. It runs under the separate `playwright.visual.config.js`, so it is not in `npm test` or CI.
- The three split-outs remain unfiled here as agreed: zero-touch merge rate (`research`), evidence links on the other 11 cards (`plan`), per-workspace rates (optional, authenticated surface only).
- If the shipped coverage label shows a large unresolved share in production, that is the measurement the plan named as the trigger to file a ticket for `[ended·unconfirmed]` being invisible to the shared terminal regex.

Not merged and not marked Done — that waits for `review` and `close-out`.

### 2026-07-26T16:37:25.031Z — None

**CI green** on [PR #1018](https://github.com/JKershaw/LinearViewer/pull/1018) at `63ea33ff` — [run 30210714098](https://github.com/JKershaw/LinearViewer/actions/runs/30210714098): Unit tests ✅, E2E shards 1–4/4 ✅, and the aggregate `ci-success` check ✅. First run, no re-pushes.

Still awaiting `review` and `close-out` — not merged, not Done.
