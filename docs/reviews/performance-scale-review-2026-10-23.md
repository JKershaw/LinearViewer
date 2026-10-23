# Performance / Scale Review — 2026-10-23 (baseline)

**Task:** LIN-3814 (periodical `performance-scale`, remit `generatePerformanceScalePrompt` in
`lib/periodicals.js`). **Type:** review-only. No code, config, secrets or docs were changed apart from
this report.
**Pinned HEADs:** LinearViewer `ec9eed17` (`origin/main` at report time; the research stage measured at
`5cd87143`, and the 11 commits between are error-handling only per LIN-3805, touching no measured path);
simple-dispatcher `1798790` (read-only).

**Baseline.** First run of this series. `performance-scale` was `never` in `/api/proxy/periodicals`,
there is no earlier `docs/reviews/performance-*` file, and Linear has no earlier run. Every ledger row is
`new (baseline)`; prior figures from LIN-1038 / LIN-1030 are cited where they exist.

## Provenance of the numbers (read this first)

Two sources, kept separate on purpose:

- **[M] Measured in this report-writing session** at `ec9eed17`: node 25.9.0, darwin arm64, direct
  `node` import of `lib/graph-features.js` and `lib/tree.js`, synthetic input. Shapes are stated.
- **[R] Carried from the LIN-3814 research stage** (research comment, HEAD `5cd87143`): prod proxy
  samples and local Playwright/curl runs. I did **not** re-run these. They are cited as the research
  stage's figures, not as fresh measurements.
- **Not measured at all:** prod session-auth pages (dashboard, swipe, swim, roadmap, task page, run
  page, dispatch-history XHR time/bytes) and the Settings LLM latency read-out (LIN-2605). They need
  the owner's browser session; none was available. They are recorded as **open**, not estimated.

## Method

Pure-module costing by `node` import against synthetic input at 1k/5k/10k/20k nodes [M]; research-stage
prod `curl -w` samples of `/api/proxy/*` and local seeded-workspace page timings [R]. No new profiling
tooling was added. Ceiling framing below.

## Ceiling

- **30 s is the design budget** (LIN-2997). The runbook's "30 s Railway edge cap"
  (`docs/runbooks/harbour-degraded.md:170`) was read off a p99 graph, not a measured cut-off.
- **900 s is Railway's documented hard limit.**
- [R] A 45 s prod long-poll (`/api/proxy/dispatch/:id?wait=45`, server `waitedMs` 45433) returned HTTP 200
  through the edge. A 30 s **total-duration** cap is therefore refuted. A 30 s **first-byte** cap is
  untested (keepalive and the buffering local proxy mask it). Evidence to be added to LIN-1758.
- The Heroku H12/H15 framing in `lib/http-keepalive.js` is stale; it is not used here.
- Surfaces held open only by `armKeepalive` (23 sites) count as near the ceiling; report completion
  time, not time to first byte.

## Findings (severity-ranked)

### 1. `stack-provider-fetch-linear-in-issues` — HIGH
- [R] prod `/api/proxy/stack` **7.06–9.36 s, median 8.33 s** (12 samples) at **3,755 issues**: 16 serial
  250-issue Linear pages × about 0.54 s.
- Linear in issue count: about 30 s at about 13k issues (**extrapolation**, not measured), roughly a year
  out at the observed growth.
- Ceiling: 30 s design budget. Headroom today about 3.6×.
- Structural floor: a shared read-through snapshot of the workspace issue set (not a per-route fetch).
- Owner: Data & Fetch H3 / **LIN-446**. Add the number there; do not mint.

### 2. `dispatch-history-lifetime-payload` — HIGH
- [R] the dispatch page XHR sends no `limit` (`public/dispatch.js:1138` → `routes/dispatch.js:583`):
  **5.9 MB / 58.6 MB / 176 MB at history depth H = 1k / 10k / 30k** (local). Prod H not measured.
- Ceiling: a bytes problem before a seconds problem (browser memory / transfer). Open: prod H.
- Structural floor: bounded read with a window/limit default.
- Owner: Data & Fetch H2 / **LIN-3812**, LIN-2120. Add the number there; do not mint.

### 3. `task-page-history-superlinear` — MED (not promoted)
- [R] task page **0.13 s → 2.34 s → 17.8 s at H = 1k / 10k / 30k** (local, ~H^1.75; partly a MangoDB
  artifact since it has no query planner). The real component is serial per-session lookups
  (`lib/task-run-facts.js:82`) plus `horizon:'all'`.
- Promotion rule from the research: only on a prod task-page number. **None was obtained**, so it stays
  unpromoted.
- Owner: Data & Fetch H1/H2 (LIN-3811 / LIN-3812).

### 4. `graph-features-superlinear` — MED (latent)
- [M] `computeGraphFeatures` (`lib/graph-features.js:80`), node 25.9.0 arm64, one run each:

  | N | forward-DAG, ~2 edges/node, long-range (reach sets grow) | single chain |
  | -- | -- | -- |
  | 1,000 | 37.8 ms | 32.2 ms |
  | 5,000 | 1,254 ms | 1,135 ms |
  | 10,000 | 7,279 ms | 6,917 ms |
  | 20,000 | 46,889 ms | not run |

  Roughly N^2.5–2.7 between 5k and 20k.
- Shape caveat: my DAG ("`i` blocks `i+1+(7i mod 50)` and `i+1+(13i mod 200)`") differs from the research
  stage's sparse generator, which measured [R] 4.3 ms / 436 ms / 2.86 s at 1k / 10k / 20k. The cost is
  dominated by reach-bitset size, so it depends heavily on edge locality. Both are real; neither is prod.
  Chain at 10k agrees with the research ([R] 7.3 s).
- Prior: LIN-1038 (2026-07-05, `8aa4a2b`) 6.5 ms @1k, 745 ms @10k: same class, same super-linear lineage.
  This is **not** a regression claim; the generators differ.
- Consumers: `task-stack.js:150`, `render-swipe.js:496`, `recommendation-facts.js:168` (reached via
  `/stack`, `get_stack`, dashboard/swipe ordering, recommend recursion, which repeats it per hop).
- Prod relation density (which curve prod is on) is **unknown**; at today's 3.7k issues with realistic
  sparse density the research estimated 0.05–0.8 s. Promotion rule: only if prod puts it above about 1 s
  at today's N. **Not met / not measurable here**, so it is recorded as latent, and the follow-up
  decision is below.
- Event-loop note: the computation is fully synchronous (BigInt reach-bitsets on the main thread), so a
  slow run blocks every request on the process, not just its own. 46.9 s at 20k is over the 30 s budget
  (synthetic, not prod).
- Structural floor: one memoised graph-feature pass per workspace snapshot shared by stack, swipe and
  recommend.

### 5. `sessions-feed-cold-rebuild` — MED
- [R] cold `/api/dashboard/sessions` with an empty read-model: **22.2 s** at H = 10k (local, 1 run).
  Within the 30 s budget but with the **thinnest headroom of any finding (about 1.35×)**; one local run
  only, so it is not promoted. Second-read flagged it as under-ranked: it is the first thing the next run
  should re-measure (several runs, and on prod if the owner's browser is available). Class C6.
- Owner: the `observation-sessions` materializer (Data & Fetch territory). No existing ticket found by
  the research stage.

### 6. `ship-layout-client-quadratic` — LOW
- [R] client `layout` 1.33 s per call at 5k, called twice; about 0.7 s per call at prod N (extrapolated).
  Browser main thread; not a ceiling issue.

## Clean results (do not promote)

- `buildForest` — [M] **1.5 ms / 7.0 ms / 32.6 ms at 1k / 10k / 50k**, linear. Confirms LIN-1038 and
  [R] 18 ms @10k.
- [R] KPI aggregates: linear, 1.1 s at 100k rows; prod `/kpis` 0.05–0.82 s.
- [R] roadmap, next-run, journey, swim, recommendation-input: no concern.
- [R] every Mongo-backed prod proxy read 0.04–0.86 s. This is the post-EU-West baseline. **Topology
  delta, not a code delta:** MongoDB moved to EU West on 2026-10-23 (LIN-2993 incident correction); no
  code change explains the improvement over the incident figures.
- [R] LIN-1030 bounded `listHistory`: prod `dispatch?limit=50` 0.17–0.86 s, versus the 30 s H12 that
  LIN-1038 recorded. LIN-1030 holds.

## Widened scope (classes)

C1 whole-workspace provider-read consumers (stack, get_stack, dashboard, swipe, swim, ship, roadmap,
`/api/context/:id`, next-run suggest, 401 retry, ship-journey and session-context 30 s memos); C2
`computeGraphFeatures` consumers (3 call sites); C3 dispatch-history readers on page loads and polls; C4
client pollers (queue badge 1 s, rulings/observation/collective 5 s, dispatch list 3 s, task state
10/45 s, run PR 60 s, Flight Companion auto-wake 30–180 s LLM POST); C5 the 23 `armKeepalive` sites (none
near 20 s locally; LLM ones not timed); C6 whole-workspace rebuilds to find one session
(`dashboard.js:1700`, `:2823`, `:2947`, `:1781`; `task-chat.js:487,501`; `follow-up-dispatch.js:147`;
`chat-tools.js:1616`). **Seam notes:** a load symptom in the failure/visibility seams (LIN-2993 class,
slow dependency holding requests for minutes) stays here as a measured symptom; Reliability (LIN-1040)
and Observability (LIN-1041) are unregistered; fix homes are LIN-2997/2998/2999. `MULTI_REQUEST_TIMEOUT_MS`
is 50 s, above the 30 s budget (comment on LIN-2997).

## Over-engineering check

No micro-optimisation is proposed. `buildForest`, KPIs and the bounded history reads are linear and cheap
at the N this project reaches and should be left alone.

## Open (unmeasured) items

- Prod timings of session-auth pages and the dispatch-history XHR (time and bytes).
- Prod issue-relation density, prod lifetime history depth, prod LLM latencies (LIN-2605 read-out).
- Jira ≥2,000-issue path; the file-storage session V8 string-length ceiling.
- Whether Railway enforces a 30 s first-byte ceiling.

## Follow-ups

- Add the measured numbers as comments on LIN-446 (#1), LIN-3812 (#2), LIN-1758 (45 s witness) and
  LIN-2997 (50 s `MULTI_REQUEST_TIMEOUT_MS`).
- No new ticket is minted by this run: #4 lacks the prod-density evidence its promotion rule requires,
  and #3 lacks a prod task-page number. The next run should measure prod relation density first; if it
  puts `computeGraphFeatures` above about 1 s, mint the memoised-snapshot task then.

## Trend ledger

Evidence tier: **[prod]** measured on production, **[local]** local seeded workspace, **[synthetic]**
direct module import. Severity labels on [local]/[synthetic] rows are provisional until a prod number
exists (#2 is HIGH on a local H; #1 is the only HIGH backed by a prod sample).

| name | severity | number observed this run (N, env) | delta vs previous run |
| -- | -- | -- | -- |
| stack-provider-fetch-linear-in-issues | HIGH | 8.33 s median, 7.06–9.36 s (3,755 issues, prod) [R] | new (baseline) |
| dispatch-history-lifetime-payload | HIGH | 5.9 / 58.6 / 176 MB (H=1k/10k/30k, local) [R] | new (baseline) |
| task-page-history-superlinear | MED | 0.13 / 2.34 / 17.8 s (H=1k/10k/30k, local) [R] | new (baseline) |
| graph-features-superlinear | MED (latent) | 37.8 ms / 1.25 s / 7.28 s / 46.9 s (N=1k/5k/10k/20k, forward DAG, node 25.9 arm64) [M] | new (baseline); prior LIN-1038 6.5 ms @1k, 745 ms @10k (different generator) |
| sessions-feed-cold-rebuild | MED | 22.2 s (H=10k, local, 1 run) [R] | new (baseline) |
| ship-layout-client-quadratic | LOW | 1.33 s/call (5k, browser) [R] | new (baseline) |
| build-forest (clean) | none | 1.5 / 7.0 / 32.6 ms (N=1k/10k/50k) [M] | new (baseline); prior LIN-1038 linear/cheap |
| dispatch-list-limit-50 (clean) | none | 0.17–0.86 s (prod) [R] | new (baseline); prior LIN-1038 H12 @30 s (pre-LIN-1030, pre-EU-West) |
| mongo-backed-proxy-reads (clean) | none | 0.04–0.86 s (prod) [R] | new (baseline); topology delta (EU West 2026-10-23) |

## Adversarial Second-Read

- **Tier:** 2 (fresh-context sub-agent, no memory of the report-writing turn).
- **Question:** "What is the largest item in this window that this report missed or misfiled?"
- **Reader's full answer (condensed only by removing headings):** The largest misfile is
  `sessions-feed-cold-rebuild` (#5): 22.2 s against the 30 s budget is about 1.35x headroom versus about
  3.6x for the top finding #1, it is a C6 whole-workspace rebuild, and it has no ticket or promotion path
  (single local run). Related: `computeGraphFeatures` is synchronous, so a slow run blocks the event loop
  for all users, and the report framed it only as seconds against a budget; 46.9 s at 20k is already over
  budget. #1 is the right top finding (only HIGH with a prod number; 30 s-at-13k is labelled an
  extrapolation). Provenance: the same HIGH label covers prod (#1) and local-only (#2) evidence; #5 is a
  single run; the ledger did not separate prod from local. The reader did not run measurements or open
  the sessions-feed code.
- **Adversarial second-read verdict: AGREE** (report overall, with reservations)
- **Differed from top finding: YES** (the reader's largest miss, #5, is not the report's top-ranked #1; the
  reader's own "NO" meant it accepted #1 as the top finding, but the field asks whether the answer differed)
- **Disposition: fixed in place** (headroom and re-measure priority added to #5; event-loop note added to
  #4; evidence-tier legend added to the ledger). #5 is not promoted or minted: one local run does not meet
  the "real measured bottleneck" bar.
