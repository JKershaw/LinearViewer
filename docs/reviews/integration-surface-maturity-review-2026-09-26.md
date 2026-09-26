# Integration & Surface Maturity Review — 2026-09-26

*Advisory, review-only. Periodical: **Integration & Surface Maturity** (LIN-1336). This is the
periodical's **third** run — a trend delta against
[`docs/reviews/integration-surface-maturity-review-2026-08-29.md`](./integration-surface-maturity-review-2026-08-29.md)
(run 2, LIN-2383, merged as `ea53ffc8`); the baseline is
[`docs/reviews/integration-surface-maturity-review-2026-07-17.md`](./integration-surface-maturity-review-2026-07-17.md)
(HEAD `ae00c61b7`). This report mints no code changes and no follow-up fix-tasks; it hands a maintainer
a triageable maturity read framed as a **trend**, not a snapshot, and leaves the decision to them.*

**Re-grounding (staleness check; B6).** `git fetch` was run in **both** repos before any comparison.

```
LinearViewer:      git fetch origin  →  HEAD = origin/main = b5c528c4807acc2222f4afd6fe2b87ded41fdf89
simple-dispatcher: git fetch origin  →  HEAD = origin/main = 3b1e734b5496941ef5a7ecfb9497741f275d67fa
LinearViewer:      git log --oneline b5c528c4..origin/main       →  (empty)
simple-dispatcher: git log --oneline 3b1e734..origin/main       →  (empty)
```

**First finding — drift re-check: zero hits.** Both repos' `origin/main` still equals the plan's pinned
HEADs (`b5c528c4` / `3b1e734`); there are **no commits** past either pin, so **0 included-class hits and
0 excluded-class hits**. The approved plan's class/bound/member tables therefore map to the current tree
without change. `docs/reviews/` was re-listed immediately before scoring (see Scope); it found no registry
sibling edition landed since run 2. Two landed after scoring — see the revision note in *Scope*. Ladder context: **630 commits** landed on LinearViewer `main`
since `ea53ffc8`, **278** of them touching `lib/`, `routes/` or `server.js`; simple-dispatcher had
**112** commits in the same review window (`git rev-list --count 7064955..3b1e734` = 112, where `7064955` is
run 2's cited consumer HEAD; 111 from the alternative boundary `05681975`). **Careful distinction** — the
drift check above is `3b1e734..origin/main` and is correctly empty, but the *review window since run 2* is
**not** empty: the consumer half of the decisions/WITHDRAW lane and the halt lane both landed there.

---

## Scope & method

This review remains a **portfolio/meta layer**, not a sixteenth ground-up inspection. It inventories the
system using the **MOD / API / FLOW / META** taxonomy, carries every run-2 id forward verbatim (an id is
forever — retired, never deleted; none retired this run), scores each surface's **core/happy-path** and
**configuration** dimensions first-party, aggregates the other ten dimensions from sibling reviews with a
confidence mark, frames everything as a **delta** against run 2, and **mints no follow-up work**.

**Sibling re-list (authoritative source for a landed edition).** Immediately before scoring, `docs/reviews/`
was re-listed and found no registry sibling landed since 2026-08-29. **Revision note (2026-09-26):**
`origin/main` has since moved past the scoring pin `b5c528c4` by exactly two commits — `08257bd3` and
`90193471` — each adding only its own `docs/reviews/*-2026-09-26.md` registry edition
(`drift-coherence-review-2026-09-26` `08257bd3`, #1591; `onboarding-cold-start-review-2026-09-26`
`90193471`, #1592). That is not a hit in any class the drift check reconciles (not `lib/`, `routes/`,
`server.js`, `public/`, or non-review `docs/*.md`), so the first finding stands. Neither new sibling owns a
dimension this review aggregates, so no score moves. PR #1594 (documentation, LIN-3102) was still **open and
unmerged** at revision time (checked `2026-09-26T21:34:22Z`). The newest registry editions at scoring were
all 2026-08-29 (`documentation-review` `8cac8e79`, `code-quality-review` `96dca752`, `drift-coherence-review`
`cb2fbb5a`, `recent-headwinds-review` `8c9c3b08`, `design-interface-review` `c343449f`,
`onboarding-cold-start-review` `b78c4499`). The newest files in the directory are non-registry:
`proposal-red-team-2026-09-18` `4919ec0a`, `pre-ramp-harness-run-2026-09-14` `778f87b1`,
`cheap-implementer-bakeoff-2026-09-13` `2f73fed4`, `model-effort-routing-proposal-2026-09-11` `4fa4bc50`.
`GET /api/proxy/periodicals` reports **dispatch** recency, not report freshness, and was not read as
freshness. R6 therefore **worsens** for the five stale 2026-06-25 owners (see Findings).

**Behavior-based added-file sweep.** `git diff --diff-filter=A --name-only ea53ffc8..b5c528c4 -- lib routes`
→ **35 files (24 lib / 11 routes), 0 renamed, 0 deleted**. The 11 proxy sub-routers fold into
`api-workspace-proxy`; three open new seams (halt, Flight Companion turn, rulings). Ten lib files
are registered under the four new ids; the other 14 lib files fold into existing ids (full table in
*Surface registration*).

---

## Consumer-repository decision, made explicit

`simple-dispatcher` (the polling consumer: `dispatcher.js`, `hook.js`, `reapers.js`, `state-store.js`,
`halt.js`, `launch-breaker.js`, `opencode-liveness.js`) is again **in this run's discovery scope, out of its
scored ledger**. The run-2 rationale is re-taken at HEAD and **partly refreshed**:

- `integration-surface-maturity` still carries `scope: 'repo'` in the registry, but `template.scope` is
  consumed by **zero** runtime code; every per-repo lane keys on the dispatch row's own `repo` field
  (`lib/periodical-runs.js:147-148`, `_laneKey` / `return row.repo || null`). The repo-inventory seam
  `lib/workspace-repos.js` **now has production importers** (`lib/dispatch-repo-guard.js:25`,
  `lib/chat-tools.js:119`) — a change from run 2, which recorded zero.
- **LIN-1933** ("target-repo selection at dispatch") is still `Todo` (re-fetched), so the per-repo lane
  that would feed `template.scope` still has not landed.
- The stale run-2 reason "simple-dispatcher has no `docs/reviews/`" is **retired as a rationale**: run 2's
  durable reason was the id-forever contract, and `simple-dispatcher/docs/reports/floor-report-2026-07-04.md`
  now exists. There is still no `docs/reviews/` there, so an id minted under it still could not be refreshed
  by a default-lane run — the id-forever argument survives on its own.

Because FLOW is this review's exclusive remit and a FLOW crossing a repo boundary is exactly what it exists
to catch, the consumer half is used as **cited evidence about the Harbour-side FLOW surfaces that cross it**
(worked examples: `simple-dispatcher/halt.js:219` `resolveEffectiveHalt` under `flow-dispatch-halt`, below;
`simple-dispatcher/reapers.js`'s watchdog under R2) — never as a place to mint surfaces. **Revisit only if
LIN-1933 lands.**

---

## Headline read

Run 2's single sharpest finding — **R7**, the Done gate enforced on one of two issue-write paths — is
**unmoved through a full cycle**. `routes/proxy-writes.js:309` is still the only production caller of
`checkPeriodicalReportGate`; `routes/workspace-api.js`'s `PATCH` handler (now `:4111`) still imports and runs
no gate. **LIN-2576 is still `Todo`.** This run's own first-party remit again surfaces the report's most
consequential gap, and it is again uncomfortably close to home: the gate this very report is subject to is
bypassed by the product's normal edit page.

Three threads carry forward, and two are new this run:

1. **The proxy-router decomposition landed and is citation-shift-only.** `routes/proxy.js` is now ~1,591
   lines that *mount* eleven sub-routers (`proxy-reads`, `proxy-writes`, `proxy-dispatch`, `proxy-kickoff`,
   `proxy-rulings`, `proxy-halt`, `proxy-flight-companion`, `proxy-agent-status`, `proxy-compute`,
   `proxy-token-exchange`, `proxy-tokens-admin`). `api-workspace-proxy` keeps its ceiling of 4/4: the
   boundary's behaviour is unchanged, only its source layout moved. Every run-2 citation into
   `routes/proxy.js` is re-pointed in this report.
2. **The unbuilt sibling reviews are still unbuilt (R3, unchanged).** Reliability ([LIN-1040]) and
   Observability ([LIN-1041]) are both still `Backlog`; five of this review's twelve dimensions remain
   unowned.
3. **A new scoring-model gap in the same shape as R5.** **LIN-2473** (Done, filed 2026-09-02) documents
   provider-lane 503/401 `LINEAR_AUTH` flapping on `flow-account-connection-workspace-credential` — a surface
   run 2 rated **4/High**. A real finding landing on a surface rated done is exactly the R5/R7-shaped
   self-audit datum this review exists to surface; the credential lane is re-scored down this run (R13).
4. **A second new instance of stalled contract text.** The consumer now honours a halt (**LIN-2995 is
   `Done`**), but Harbour's operator-facing text still says "the runner does not yet honor it (pending
   LIN-2995)" in fourteen files. This is the **halt-copy stale-contract class**, owned by **LIN-3074**
   (`Backlog`), and it is now contract *drift*, not just stale wording (R10, §Halt-copy class).

Reliability ([LIN-1040]) and Observability ([LIN-1041]) reviews still do not exist; **no** registry sibling
that owns an aggregated dimension has refreshed since 2026-08-29 (two non-owning siblings landed 2026-09-26 —
see Scope), and the five 2026-06-25 reports (security, API quality, test coverage,
dependency/supply-chain, stability) are now ~13 weeks stale (R6, worsened).

[LIN-1040]: https://linear.app/linearviewer/issue/LIN-1040
[LIN-1041]: https://linear.app/linearviewer/issue/LIN-1041

---

## Findings (priority-ranked)

Advisory — **no task is minted for any of these**. R1–R9 carry forward under their original ids (R4 stays
recorded as closed); new findings start at **R10**. Ranked by impact × inverse effort.

### R7 — `routes/workspace-api.js:4111` sets issue state with the LIN-694/LIN-2323 Done gate never invoked · **Impact: H · Effort: L · carried, unchanged**

*Surface: FLOW (`flow-periodicals-two-stage`) · Dimension: configuration/enforcement completeness
(first-party) · Confidence: High*

Exactly two routes can set a state on an issue: `routes/proxy-writes.js:341` (`provider.updateIssue(`, the
gated main state-setting PATCH — old citation `routes/proxy.js:3487`) and
`routes/workspace-api.js:4111` (`router.patch('/workspace/:urlKey/api/issues/:issueId'`), enumerated
exhaustively. `checkPeriodicalReportGate` / `extractPeriodicalGateId` are imported and invoked at exactly one
of them — `routes/proxy-writes.js:22` (import) and `:300-341` (invoke block; `extractPeriodicalGateId` `:300`,
`checkPeriodicalReportGate` `:309`). `routes/workspace-api.js` does not import the gate module at all; its
write reaches `provider.updateIssue` at `:4180` with the `stateId` set at `:4173`.

This is not latent: `public/task-edit.js:91` PATCHes exactly this route, and `public/llms.txt:97` (the
`issue-edit-link` line — **still `:97`**, see B2) documents the page as the product's own edit affordance; a
human can move a periodical review task to a Done-type state with the gate never executing. The route already
holds the gate's exact two inputs at the call site (`provider.issueWriteGuard` at
`routes/workspace-api.js:4164`, returning `description` and `comments`) — only the conditional is absent.

**Why it happened, cited:** the route landed 2026-07-24 (`2cbaa29c`); the gate landed 2026-08-23 (`18843e64`,
LIN-694) and was extended 2026-08-26 (`a94d3c7b`, LIN-2323) onto one of two then-existing paths. The module
header acknowledges a direct provider-side/Linear-UI transition as an un-closable third bypass; it does not
acknowledge this in-product one. **Owner: LIN-2576 (`Todo`).**

**Action (for a human to weigh):** import `checkPeriodicalReportGate` into `routes/workspace-api.js`'s
update-issue handler and run the identical check `routes/proxy-writes.js` already runs.

### R1 — `flow-periodicals-two-stage`: Stage-2 completion — incremental progress, still held below a clean close · **Impact: H · Effort: M · carried, improved**

*Surface: FLOW · Dimensions: core/happy-path, configuration (both first-party) · Confidence: High ·
Run 2: CHP 3, CFG 2 → this run: CHP 3, CFG **3***

Since run 2, four pieces of the Stage-2 contract landed: **LIN-2385** (`d4db6615`, gate periodical
run-evidence on terminal delivery), **LIN-2396** (`3ff81245`, give the report-PR merge an owner in the shared
prompt), **LIN-2575** (`5b1901ae`, derive `periodicalId` from the issue gate marker at the dispatch seam — the
write-side stamp R9 named as half-fixed), and **LIN-3022 §5** (`c74d0439`, idempotency guidance). This is real
configuration/enforcement progress (CFG 2→3). Still open: **LIN-2846** (`Backlog`, two seams still stamp
`periodicalId` caller-supplied only), **LIN-1629** (`Todo`, change-gated due-ness), **LIN-2328** (`Todo`) and
**LIN-1933** (`Todo`). The two held gaps remain **(b) the gate covers one of two write paths** — R7 — and
**(c) the `periodicalId` join key is unverifiable in practice** — R9. CHP stays at 3 by those two gaps.

**Action (for a human to weigh):** none of (a)/(b)/(c) needs a new mechanism; (b) is R7's two-line import,
(c) is R9's allow-list add.

### R5 — `flow-free-tier-rate-limit`: still Critical, still unmoved · **Impact: H · Effort: — (Test Coverage Gap's to confirm) · carried, sibling-owned, worsened by non-movement**

*Surface: FLOW (`lib/free-tier-store.js`) · Dimension: testing (sibling-owned) · Confidence: High ·
Run 2: CHP 2 → this run: CHP 2 (unchanged)*

`lib/free-tier-store.js` has **zero commits since `ea53ffc8`** — a third review cycle unmoved. The live
production path `tryUse()` reads `_id: "global:<hour>"` (`:148-149`) but writes `_id: "global:global:<hour>"`
(`:197-199`) — the global hourly cap is never enforced. The correctly-keyed writer, `recordUsage()`, is
reachable only from `routes/test.js:988`. What *did* change is the caller landscape: the free-tier gate call
**consolidated** into `lib/chat-request.js` (`checkFreeTierGate` `:80`, `resolveChatCredential` `:54`; LIN-2970
`ede3a6d4` / LIN-2978 `51103548`), adopted at `routes/ship-biscuit.js:194` and
`routes/workspace-api-roadmap.js:828`; `routes/workspace-api-roadmap.js:338` (roadmap *generate*) is
deliberately still direct, per `chat-request.js`'s own header comment. The counter file itself is unchanged.
Testing remains Test Coverage Gap's (2026-06-25, ~13 weeks stale). **LIN-2955** (free tier → runs/day) is the
LIN-3099 anchor; pointer posted there in close-out, not here.

**Action (for a human to weigh):** fix the double-prefixed key at `free-tier-store.js:148-149,197-198`, or
delete the dead `recordUsage()` writer if `tryUse()`'s behaviour is judged intentional.

### R2 — `flow-dispatch-lifecycle`: a claimed-but-never-fed-back dispatch item still has no timeout · **Impact: M · Effort: M · carried, unchanged, sharper evidence**

*Surface: FLOW · Dimension: core/happy-path (first-party) · Confidence: High · CHP 3 (unchanged)*

Still open at the Harbour layer: no age-since-take reaper exists (`cleanup()`, now `lib/dispatch-store.js:843-871`,
still gates only on `expiresAt` — expired-items query `:849`, final `deleteMany` `:869`). **LIN-2079**'s
`listHistory({ silentSince })` capability still has zero production callers. **LIN-2120** is still `Backlog`.
Mitigating context, re-confirmed: the consumer has a full watchdog layer (`simple-dispatcher/reapers.js` —
`stuck-launch`, `stalled-verify`/`-executing`/`-bootstrap`/`-pending`, `expired-hold`, `runStallFailsafe`),
and — new this run — `lib/consumer-poll-warning.js` (LIN-2885, imported by `routes/proxy-kickoff.js`,
`routes/dispatch.js`, `routes/proxy-dispatch.js`, `lib/dispatch-factory.js`) and consumer-side
`launch-breaker.js` / `opencode-liveness.js` change the picture by adding **visibility**, not eviction.

**Action (for a human to weigh):** wire LIN-2120's lineage-aware selection to an eviction path using the
existing `listHistory({ silentSince })` capability, or surface a "stuck" state on the Observation feed.

### R9 — `periodicalId`/`repo` at the dispatch response allow-list: partial fix, the read side still drops `periodicalId` · **Impact: M · Effort: L-M · carried (new in run 2), moved (partial)**

*Surface: FLOW (`flow-periodicals-two-stage`) · Dimension: configuration/data-integrity (first-party) ·
Confidence: High · Delta: read-side `repo` restored (LIN-2975), `periodicalId` still dropped*

The write path for `periodicalId` **is** wired end-to-end — `lib/render.js:505,524` →
`data-periodical-id` → `routes/dispatch.js:277` (destructure) / `:615` (echo into the created payload) →
`lib/dispatch-store.js:1740` and `:2563` (both list formatters) — and **LIN-2575** now derives `periodicalId`
from the issue gate marker at the dispatch seam (write-side stamp). But the field is still dropped at the
public route response allow-list: `formatDispatchWatch` (`routes/proxy-dispatch.js:56-133`) now **does** carry
`repo` (`:90`, restored per LIN-2975) but **not `periodicalId`**. Nothing records that omission as deliberate;
its one such comment (`:92-97`, old `routes/proxy.js:600-605`) is about `dispatchedBy` (LIN-1948).
`PERIODICAL_PROJECTION`'s own comments (`lib/dispatch-store.js:134-142`) record `followUpTo`, `abort`, and
`repo` each having been silently dropped and restored once already — `periodicalId` is a **fourth** instance,
one layer up, still open and itself undocumented. Whether live rows actually carry `periodicalId` remains
**unresolvable from any first-party API surface available to this review** (Low confidence, unverifiable from
HEAD source); this report does not assert either way.

**Action (for a human to weigh):** add `periodicalId` to the response allow-list(s) that currently drop it.

### R10 — `flow-dispatch-halt`: Harbour's halt contract text now contradicts shipped behaviour · **Impact: M · Effort: L · new**

*Surface: FLOW (`flow-dispatch-halt`, new this run) · Dimension: Documentation (sibling-owned) ·
Confidence: High · Owner: LIN-3074 (`Backlog`)*

The consumer now **honours** a halt: `simple-dispatcher/dispatcher.js:31,1470-1503` wires
`resolveEffectiveHalt` (`simple-dispatcher/halt.js:219`) into `runOnce`, and **LIN-2995 is `Done`**. Harbour's
operator-facing text still asserts the opposite — "the runner does not yet honor it (pending LIN-2995)" — in
fourteen files (full query and count in the *Halt-copy stale-contract class* section below). This was stale
wording at run 2; with LIN-2995 shipped it is now **contract drift**, and it is operator-visible
(`public/dispatch.js:757,788`, `routes/proxy-halt.js:9,104`, `lib/proxy-instructions.js:624,845`).

**Action (for a human to weigh):** have LIN-3074 update the halt contract text to match the shipped consumer
behaviour.

### R3 — Reliability and Observability reviews still don't exist · **Impact: H (portfolio-wide) · Effort: — (not this review's to mint) · carried, unchanged**

*Surface: META / portfolio · Confidence: High*

**LIN-1040** (Reliability) and **LIN-1041** (Observability) are both still `Backlog`; neither appears in the
registry. Five of this review's twelve dimensions — error handling, resilience, rate limits & pagination,
idempotency & consistency (Reliability's remit) and observability (Observability's remit) — remain unowned by
any systematic review, ~13 weeks on from baseline. This review names the gap; it does not build them.

### R11 — `mod-scheduler`: the registered-job roster is not the full recurring-work set · **Impact: L · Effort: L · new**

*Surface: MOD (`mod-scheduler`) · Dimension: Configuration (first-party) · Confidence: High*

The scheduler now registers **four** jobs (`server.js:633/700/730/757`: observer-sweep, observer-pass,
credential-invariant-sweep, pricing-conformance-sweep). Two recurring tasks remain **bare `setInterval`s
outside** `scheduler.register`: `server.js:3954` (dispatch cleanup) and `lib/http-keepalive.js:29`
(heartbeat) — exactly two, confirmed exhaustive. These are invisible to the leader-safe CAS-lease substrate
and to any roster the scheduler could report.

**Action (for a human to weigh):** move both onto `scheduler.register`, or record them explicitly as
intentionally outside the leader-lease model.

### R8 — A recurring shape: work landed, tested, and consumed by nothing — mixed this run · **Impact: M · Effort: — · carried (new in run 2), moved (mixed)**

*Surface: META / portfolio · Confidence: High*

The behavioral sweep is re-run. Movement:
- **Resolved:** `lib/workspace-repos.js` (LIN-1935) **now has production importers** —
  `lib/dispatch-repo-guard.js:25` and `lib/chat-tools.js:119` (run 2 recorded zero).
- **Now reachable:** `lib/plan-review-round-trips.js` is imported by `lib/effort-readout.js` (which is
  consumed by `routes/dashboard.js`), giving `lib/follow-on-ratio.js` a transitive path to production.
- **Still dead:** `lib/observer-efficacy-signal.js` (LIN-2133, Done) still has **zero production importers**.
- **Checked, not dead:** consumer-side `simple-dispatcher/opencode-liveness.js` (LIN-2736) **is** consumed —
  `simple-dispatcher/reapers.js:38` requires its `statExitSentinel`/`readOpenCodeLiveness` seam — so it is
  *not* an R8 instance (a research-pass claim corrected here by re-reading the consumer at HEAD).
- `listHistory({ silentSince })` (R2) and the `periodicalId`/`repo` drop (R9) remain in the class.

No sibling review owns this class (each module is tested; it is visible only portfolio-wide).

### R6 — Sibling evidence: no owning registry refresh since 2026-08-29 · **Impact: M (portfolio-wide legibility) · Effort: — (scheduling call) · carried, worsened**

*Surface: META / portfolio · Confidence: High*

Run 2 recorded five current and five 2026-06-25 siblings. This run recorded **zero** new registry editions at
scoring; **two landed on 2026-09-26 after scoring** (`drift-coherence-review-2026-09-26` `08257bd3`,
`onboarding-cold-start-review-2026-09-26` `90193471`), but neither owns a dimension this review aggregates.
The five 2026-06-25 reports — `security-review`, `api-quality-review`, `test-coverage-gap`,
`dependency-supply-chain-review`, `stability-review` — remain the stale owners and are now ~13 weeks stale;
`comprehension-debt-review` is 2026-07-01. **Security** is the most consequential: two new credential/auth
surfaces (`api-jira-rest`, `flow-account-connection-workspace-credential`) have no fresh sibling read. Five
LIN-3099 siblings are being re-run in this same passage; two landed after this report's scoring HEAD.

**Action (for a human to weigh):** refresh the five still-stale correctives, prioritizing Security and Test
Coverage Gap (owns R5).

### R13 — `flow-account-connection-workspace-credential`: a Done incident landed on a surface rated 4/High · **Impact: H · Effort: — (Security Review's remit) · new**

*Surface: FLOW (`flow-account-connection-workspace-credential`) · Dimension: core/happy-path (first-party) ·
Confidence: High · Delta: CHP 4 → **3***

**LIN-2473** (Done, filed 2026-09-02) documents provider-lane 503/401 `LINEAR_AUTH` flapping under the
2026-09-02 Big Run against this surface, which run 2 rated **4/High**. Additionally `credential-health`
"can look healthy while wrong" (LIN-2493) and the credential follow-ups **LIN-2287 / LIN-2493 / LIN-1900 /
LIN-2609** remain open. This is the R5/R7-shaped scoring-model gap the self-audit exists to catch: run 2's
High-confidence 4 did not survive contact with a real incident. Deep auth/credential assessment remains
**Security Review's** remit — this review names the down-score and the owner; it does not absorb the work.

### R4 — Security H1 (stored XSS): resolved · **Impact: — (closed) · Effort: — · carried, RESOLVED**

*Surface: MOD (feedback-widget image handling) · Dimension: security (sibling-owned) · Confidence: High*

`87f6c9f6` (LIN-682) landed 2026-06-26, adding `sniffRasterType()` byte-sniffing, a raster allowlist and
`nosniff` — now at `routes/workspace-api.js:3437,3443` (old `:2724-2740`). Re-confirmed fixed at HEAD. Stays
closed/resolved.

### R12 — Stale-contract-text class beyond halt · **Impact: L-M · Effort: L · new**

*Surface: META / portfolio · Dimension: Documentation (sibling-owned) · Confidence: Medium*

The halt-copy class (R10) has siblings: text asserting a ticket is pending after it shipped. Found at HEAD:
`lib/effort-readout.js:597` (LIN-2567 Done), `lib/workspace.js:89` (LIN-2018 Done), `lib/agent-turn.js:536`
(LIN-2622 Done), `lib/account-workspace-store.js:27` (LIN-1329 Done), `lib/pipeline-loops.js:808` (LIN-2187
Done). Each should be checked and retired by whoever owns the module; the class, not each instance, is the
finding.

---

## Surface registration — new ids, folds, and roll-ups

**Registered as new ids (4), each with cited production evidence:**

| id | Type | Members | Evidence | Proposed CHP / CFG / Conf |
|---|---|---|---|---|
| `flow-flight-companion-turn` | FLOW | `lib/agent-turn.js`, `lib/chat-transcript.js`, `lib/flight-companion-gate.js`, `lib/prompts/flight-companion-brief.js`, `lib/sse.js` (+ `routes/proxy-flight-companion.js`) | `agent-turn.js` ← `routes/task-chat.js`, `routes/proxy-flight-companion.js`, `routes/flight-companion.js`; `sse.js` ← same three; `chat-transcript.js` ← same three + `lib/saved-chat-store.js`; `flight-companion-gate.js` ← `routes/flight-companion.js`, `lib/agent-turn.js` (LIN-2631/2968) | 4 / N/A* / Medium |
| `flow-dispatch-halt` | FLOW | `lib/workspace-halt.js` (+ `routes/proxy-halt.js`) | `workspace-halt.js` ← `routes/dispatch.js`, `routes/proxy-halt.js`, `server.js`; consumer `simple-dispatcher/halt.js:219` `resolveEffectiveHalt` wired at `dispatcher.js:31,1470-1503` (LIN-2995 Done, LIN-3023/3026) | 3 / N/A* / Medium |
| `mod-effort-readout` | MOD | `lib/effort-readout.js`, `lib/render-effort-readout.js` | both ← `routes/dashboard.js:48,49`; routes `GET /workspace/:urlKey/effort-readout` (`:2134`) and `/api/effort-readout` (`:2160`) (LIN-2641) | 4 / N/A* / Medium |
| `mod-secret-scan` | MOD | `lib/secret-scan.js`, `lib/scan-public-pages.js` | `secret-scan.js` ← `lib/scan-public-pages.js` + `scripts/secret-scan.mjs` (npm `secret-scan`); `scan-public-pages.js` ← `scripts/scan-public-pages.mjs` (npm `scan:public-pages`); CI `.github/workflows/secret-scan-scheduled.yml` (LIN-2573) | 3 / N/A* / Low-Medium |

**Folded into existing ids (24 lib files, 14 dispositions; the 11 routes fold as below):**

- `lib/chat-request.js` (LIN-2970 `ede3a6d4`, LIN-2978 `51103548`) — **dual evidence, not Flight-Companion-only**:
  8 production importers (`ship-biscuit`, `workspace-api-roadmap`, `next-run`, `task-chat`,
  `proxy-flight-companion`, `flight-companion`, `dashboard`, `workspace-api`); holds `resolveChatCredential`
  (`:54`) and `checkFreeTierGate` (`:80`). Folds into **R5**/`flow-free-tier-rate-limit` and the credential lane.
- `lib/scan-fingerprint.js` → `flow-operator-decisions` (importers `lib/harbour-comments-store.js`,
  `routes/workspace-api.js`; LIN-2241 due-basis fingerprinting — **not** `mod-secret-scan`).
- `lib/scan-public-pages.js` + `lib/secret-scan.js` → `mod-secret-scan` (new id above).
- `lib/consumer-poll-warning.js` → `mod-scheduler` / `api-dispatch` (importers `routes/proxy-kickoff.js`,
  `routes/dispatch.js`, `routes/proxy-dispatch.js`, `lib/dispatch-factory.js`; LIN-2885).
- `lib/digest-feedback.js` → `mod-dispatch-queue` (importers `lib/pipeline-loops.js`, `lib/dispatch-store.js`).
- `lib/dismissal-suggestions-store.js` → `flow-operator-decisions` (importers `routes/proxy-rulings.js`,
  `routes/dashboard.js`, `server.js`).
- `lib/dispatch-repo-guard.js` → `api-workspace-proxy` (importers `routes/proxy-reads.js`,
  `routes/proxy-dispatch.js`; LIN-2886).
- `lib/github-install-flow.js` → `api-github-app` (importers `routes/github-auth.js`,
  `routes/github-projects-auth.js`; LIN-2397, a pure move).
- `lib/harbour-comments-store.js` → `flow-operator-decisions` (importer `server.js`; LIN-2648).
- `lib/observer-pass.js` → `mod-observer-lane` (+ `mod-scheduler` job) (importers `server.js`, `routes/flight-companion.js`).
- `lib/pricing-conformance-sweep.js` → `mod-scheduler` + `flow-cost-telemetry` (importer `server.js`; LIN-2384).
- `lib/providers/jira/adf.js` → `api-jira-rest`.
- `lib/proxy-graphql-errors.js` → `api-workspace-proxy` (importers `proxy-kickoff`, `proxy`, `proxy-compute`,
  `proxy-writes`, `proxy-reads`, `proxy-dispatch`).
- `lib/proxy-instructions.js` → `api-workspace-proxy` (importer `routes/proxy.js`).
- `lib/suspect-credential-refresh.js` → `flow-account-connection-workspace-credential` (importers
  `routes/workspace-api.js`, `server.js`; LIN-2473).

**Modified-not-added seams the added-file diff cannot see.** The added-file sweep is necessary but not
sufficient: the window's largest **modified** surface is the decisions/withdrawal (WITHDRAW) subsystem, which
stretches across files that already existed at `ea53ffc8` (`lib/unanswered-decisions.js`,
`lib/pipeline-loops.js`, `routes/dashboard.js`, `routes/proxy-rulings.js`, `lib/prompt-template-defs.js`) and
so is invisible to `--diff-filter=A`. It is folded into `flow-operator-decisions` (ledger row above) with the
consumer half in `simple-dispatcher` (LIN-3039/3040): a new `decision-withdrawn` terminal state
(`lib/unanswered-decisions.js:264` `isDecisionWithdrawn`), a persisted `answeredDecisions` set and a
`withdrawal` digest field (`lib/pipeline-loops.js:63-136`, `BUILDER_VERSION` 12→16), the public
`/rulings?includeResolved=true` contract (`routes/proxy-rulings.js:103,163,248`), a session-auth-only
`reverse-withdrawal` route (`routes/dashboard.js:1673`), and multi-`WITHDRAW:` emission on the consumer
side. Other modified-not-added seams in the window: `routes/workspace-api.js` (+898, **R7 still ungated**),
`routes/flight-companion.js` (+950), `routes/task-chat.js`, `routes/dispatch.js` (halt routes + consumer-poll
warning), `lib/chat-tools.js` (now imports `knownWorkspaceRepos`), `lib/dispatch-store.js`,
`lib/observer-sweep.js`, `lib/terminal-marked-task-cost.js`.

**The 11 proxy routes** fold into `api-workspace-proxy` (mounts in `routes/proxy.js:20-30`); three are
dual-tagged as FLOW seams: `proxy-halt.js`→`flow-dispatch-halt`, `proxy-flight-companion.js`→
`flow-flight-companion-turn`, `proxy-rulings.js`→`flow-operator-decisions` (existing id). Full 35-file table:

| # | file | disposition | citation |
|---|---|---|---|
| 1 | `routes/proxy-agent-status.js` | fold → `api-workspace-proxy` | mounted `routes/proxy.js:1549` |
| 2 | `routes/proxy-compute.js` | fold → `api-workspace-proxy` | mounted `routes/proxy.js:1544` |
| 3 | `routes/proxy-dispatch.js` | fold → `api-workspace-proxy` (+ R9 read side) | mounted `routes/proxy.js:1574`; `formatDispatchWatch` `:56-133` |
| 4 | `routes/proxy-flight-companion.js` | fold + seam → `flow-flight-companion-turn` | mounted `routes/proxy.js:1578` |
| 5 | `routes/proxy-halt.js` | fold + seam → `flow-dispatch-halt` | mounted `routes/proxy.js:1553`; `:9,104` |
| 6 | `routes/proxy-kickoff.js` | fold → `api-workspace-proxy` | mounted `routes/proxy.js:1570`; imports `consumer-poll-warning` |
| 7 | `routes/proxy-reads.js` | fold → `api-workspace-proxy` | mounted `routes/proxy.js:1328`; imports `dispatch-repo-guard` |
| 8 | `routes/proxy-rulings.js` | fold + seam → `flow-operator-decisions` | mounted `routes/proxy.js:1566`; imports `dismissal-suggestions-store` |
| 9 | `routes/proxy-token-exchange.js` | fold → `api-workspace-proxy` (flow-bootstrap-token-exchange) | mounted `routes/proxy.js:1324` |
| 10 | `routes/proxy-tokens-admin.js` | fold → `api-workspace-proxy` | mounted `routes/proxy.js:1272` |
| 11 | `routes/proxy-writes.js` | fold → `api-workspace-proxy` (R7 gate caller) | mounted `routes/proxy.js:1332`; gate `:22,300-341` |
| 12 | `lib/agent-turn.js` | new id `flow-flight-companion-turn` | 3 production importers |
| 13 | `lib/chat-transcript.js` | new id `flow-flight-companion-turn` | 4 production importers |
| 14 | `lib/flight-companion-gate.js` | new id `flow-flight-companion-turn` | 2 production importers |
| 15 | `lib/prompts/flight-companion-brief.js` | new id `flow-flight-companion-turn` | imported by `lib/agent-turn.js` |
| 16 | `lib/sse.js` | new id `flow-flight-companion-turn` | 3 production importers |
| 17 | `lib/workspace-halt.js` | new id `flow-dispatch-halt` | 3 production importers |
| 18 | `lib/effort-readout.js` | new id `mod-effort-readout` | `routes/dashboard.js:48` |
| 19 | `lib/render-effort-readout.js` | new id `mod-effort-readout` | `routes/dashboard.js:49` |
| 20 | `lib/secret-scan.js` | new id `mod-secret-scan` | `scripts/secret-scan.mjs`; `lib/scan-public-pages.js` |
| 21 | `lib/scan-public-pages.js` | new id `mod-secret-scan` | `scripts/scan-public-pages.mjs` |
| 22 | `lib/consumer-poll-warning.js` | fold → `mod-scheduler`/`api-dispatch` | 4 importers |
| 23 | `lib/digest-feedback.js` | fold → `mod-dispatch-queue` | `pipeline-loops`, `dispatch-store` |
| 24 | `lib/dismissal-suggestions-store.js` | fold → `flow-operator-decisions` | 3 importers |
| 25 | `lib/dispatch-repo-guard.js` | fold → `api-workspace-proxy` | `proxy-reads`, `proxy-dispatch` |
| 26 | `lib/github-install-flow.js` | fold → `api-github-app` | `github-auth`, `github-projects-auth` |
| 27 | `lib/harbour-comments-store.js` | fold → `flow-operator-decisions` | `server.js` |
| 28 | `lib/observer-pass.js` | fold → `mod-observer-lane` (+ `mod-scheduler` job) | `server.js`, `flight-companion` |
| 29 | `lib/pricing-conformance-sweep.js` | fold → `mod-scheduler`/`flow-cost-telemetry` | `server.js` |
| 30 | `lib/providers/jira/adf.js` | fold → `api-jira-rest` | Jira provider |
| 31 | `lib/proxy-graphql-errors.js` | fold → `api-workspace-proxy` | 6 importers |
| 32 | `lib/proxy-instructions.js` | fold → `api-workspace-proxy` | `routes/proxy.js` |
| 33 | `lib/scan-fingerprint.js` | fold → `flow-operator-decisions` | `harbour-comments-store`, `workspace-api` |
| 34 | `lib/suspect-credential-refresh.js` | fold → `flow-account-connection-workspace-credential` | `workspace-api`, `server` |
| 35 | `lib/chat-request.js` | fold → `flow-free-tier-rate-limit` + credential lane | 8 importers; `:54`,`:80` |

**Sum check:** 11 (routes) + 10 (new-id lib) + 14 (existing-fold lib) = **35**. Folds + new ids + exclusions
(0) sum exactly; nothing is silent.

---

## Surface inventory

**40 scored surfaces this run — 36 carried verbatim from run 2 (15 MOD / 9 API / 12 FLOW) plus 4 new
(2 MOD + 2 FLOW) — plus 1 META.**

**MOD (17: 15 carried + 2 new — `mod-effort-readout`, `mod-secret-scan`)** — the carried fifteen are
unchanged except `mod-observer-lane`, which rises CHP 2→3 because a newly-added lane module
(`lib/observer-pass.js`) **is** consumed by `routes/flight-companion.js` and `server.js`, though
`lib/observer-efficacy-signal.js` remains unconsumed (R8). `mod-scheduler` keeps CHP 4 with four registered
jobs but carries the R11 roster note. `mod-dispatch-queue` keeps 4/4 (dispatch-presets, halt-route evidence
is citation-only).

**API (9: all carried + `api-jira-rest`)** — every carried surface unchanged; `api-workspace-proxy` keeps 4/4
through the router decomposition (citation shift only, 47→55 routes, differentiated rate limiting, 320
`logEvent` sites) and gains CFG evidence (`dispatch-repo-guard.js`, `proxy-graphql-errors.js`,
`proxy-instructions.js`). `api-jira-rest` stays 4/4.

**FLOW (14: 12 carried + 2 new — `flow-flight-companion-turn`, `flow-dispatch-halt`)** — this review's home
turf. `flow-periodicals-two-stage` improves CFG 2→3 (R1); `flow-account-connection-workspace-credential`
drops CHP 4→3 (R13); `flow-dispatch-lifecycle` unchanged (R2); `flow-free-tier-rate-limit` unchanged (R5);
`flow-oauth` unchanged at CHP 3 (Jira leg still self-disclosed "not runtime-verified",
`lib/providers/jira/oauth.js:28-36`); the rest unchanged.

**META** — see Self-Audit.

---

## Scorecard over the twelve dimensions

Per-surface CHP/CFG are in the Trend Ledger (first-party remit). The other ten dimensions are aggregated,
portfolio-level, with the owning review named. This is the full twelve-dimension read for this run:

| # | Dimension | This run (portfolio) | Owning review | Confidence | Delta vs run 2 |
|---|---|---|---|---|---|
| 1 | Core/happy path | ≈89% (see Completeness) | **this review (first-party)** | High | mixed — R13 down, new surfaces added |
| 2 | Error handling & failure modes | unowned | **Reliability — LIN-1040 (not built)** | — | unchanged |
| 3 | Resilience | unowned | **Reliability — LIN-1040 (not built)** | — | unchanged |
| 4 | Rate limits & pagination | unowned | **Reliability — LIN-1040 (not built)** | — | unchanged |
| 5 | Auth & credentials | stale sibling (2026-06-25) | **Security Review** | Low | worsened — LIN-2473 incident |
| 6 | Idempotency & consistency | unowned | **Reliability — LIN-1040 (not built)** | — | unchanged |
| 7 | Input & schema validation | stale sibling (2026-06-25) | **API Quality Review** | Low | unchanged |
| 8 | Observability | unowned | **Observability — LIN-1041 (not built)** | — | unchanged |
| 9 | Security | stale sibling (2026-06-25); H1 re-verified fixed | **Security Review** | Medium | unchanged (R4 closed) |
| 10 | Testing | stale sibling (2026-06-25) | **Test Coverage Gap Review** | Low | unchanged (R5 unconfirmed) |
| 11 | Documentation | sibling fresh 2026-08-29, but halt/text drift | **Documentation Review** | Medium | worsened — halt-copy drift (R10/R12) |
| 12 | Configuration | first-party + sibling-owned mix | **this review + siblings** | Medium | changed — R1 CFG up, scheduler roster note (R11) |

---

## Sibling-owned dimension coverage

Per-dimension, not per-surface. The owning reviews are named as the home for deeper follow-up; this review
does not re-derive their findings.

| Dimension | Owning review | Status | Confidence | What's known this run |
|---|---|---|---|---|
| Auth & credentials | **Security Review** | 2026-06-25, ~13wk stale | Low | LIN-2473 provider-lane 401/503 flapping (Done) on `flow-account-connection-workspace-credential`; credential follow-ups LIN-2287/2493/1900/2609 open. No fresh sibling read |
| Security | **Security Review** | 2026-06-25, ~13wk stale | Medium | H1 stored-XSS re-verified fixed (R4); M2/M3 status unknown |
| Input & schema validation | **API Quality Review** | 2026-06-25, ~13wk stale | Low | Unrefreshed; `lib/issue-write-validation.js` shared seam (R7) is incidental first-party evidence, not a substitute |
| Testing | **Test Coverage Gap Review** | 2026-06-25, ~13wk stale | Low | R5's Critical defect unconfirmed fixed or unfixed; zero commits to the affected file rules out an accidental fix |
| Documentation | **Documentation Review** | **2026-08-29 — fresh (registry)**, but ~4wk old | Medium | Halt contract text now contradicts shipped behaviour (R10) and a broader stale-contract-text class exists (R12) |
| Error handling | **Reliability — LIN-1040 (not built)** | no report exists | — | Unowned; R2/R9 incidental |
| Resilience | **Reliability — LIN-1040 (not built)** | no report exists | — | Unowned |
| Rate limits & pagination | **Reliability — LIN-1040 (not built)** | no report exists | — | Unowned |
| Idempotency & consistency | **Reliability — LIN-1040 (not built)** | no report exists | — | Unowned |
| Observability | **Observability — LIN-1041 (not built)** | no report exists | — | Unowned; credential lane's `credential-invariant-sweep.js` remains the strongest instance |

**Reliability** ([LIN-1040]) and **Observability** ([LIN-1041]) remain the natural home for the five
unowned rows; this report mints nothing into that territory.

---

## Self-Audit — META surface

*Surface: META (`meta-integration-surface-maturity-review`) · core/happy-path: **4** (unchanged) ·
configuration: **N/A\*** (unchanged — a review methodology has no environment-configuration surface)*

Required self-checks this run:

- **How many surfaces are stuck at Low confidence, and why?** Two carried: `mod-roadmap-trajectory`
  (Medium/Low, unchanged) and `mod-task-create` (Low/Medium, unchanged). New this run: `mod-secret-scan`
  (Low-Medium — a CLI/CI-consumed module with no server-route read to deepen). Portfolio-wide, six of ten
  aggregated dimensions remain Low because their owning sibling is ~13 weeks stale (R6), not a first-party
  weakness. Read-side `periodicalId` presence remains unverifiable from source (R9).
- **Did a real finding elsewhere land on a surface this review had rated as done?** **Yes — twice.** (1)
  **LIN-2473** (Done) hit `flow-account-connection-workspace-credential`, which run 2 rated 4/High — the
  R5/R7-shaped scoring-model gap; corrected down to 3 this run (R13). (2) **LIN-2993** (Done, 2026-09-22)
  db-backed reads hanging hit `mod-dispatch-queue`/`api-workspace-proxy`/`flow-operator-decisions`/
  `mod-live-console` — surfaces scored 4/High; it is closed, so it is recorded as a coverage caveat rather
  than a re-score, but it confirms the class recurs.
- **Is any dimension consistently N/A (dead weight) or consistently 0 (unmeasurable)?** Configuration is
  `N/A*` for a large share of surfaces. New this run, the four new ids add **4** more `N/A*` entries
  (`flow-flight-companion-turn`, `flow-dispatch-halt`, `mod-effort-readout`, `mod-secret-scan`), each
  justified. **No carried `N/A*` flips this run.** No dimension scores 0 anywhere.
- **Are past top recommendations actually being acted on?** Directly against R1–R9: **R7 — no, unmoved**
  (LIN-2576 Todo; sole gate caller unchanged). **R1 — yes, incremental** (LIN-2385/2396/2575/3022 Done;
  LIN-2846/1629/2328/1933 open). **R5 — no, unmoved** (zero commits; third cycle). **R2 — no** (LIN-2120
  Backlog; selection half still unconsumed). **R9 — partial** (write-side stamped via LIN-2575; read side
  still drops `periodicalId`). **R3 — no** (both tracking tickets Backlog). **R8 — mixed** (`workspace-repos`
  resolved, `observer-efficacy-signal` still dead; `opencode-liveness.js` checked and found consumed, so not an
  instance). **R6 — worsened** (no owning registry refresh since 2026-08-29; two non-owning siblings landed 2026-09-26). **R4 — closed** and stays closed.
- **What did this review itself miss?** The Tier 2 adversarial second-read caught that this run's own coverage
  model — the `--diff-filter=A` added-file sweep — is necessary but **not sufficient**: the window's largest
  **modified** surface, the decisions/WITHDRAW subsystem (~36 LinearViewer + 7 simple-dispatcher commits), is
  invisible to that sweep and was initially filed as `flow-operator-decisions` "unchanged". Corrected in place
  (see *Adversarial Second-Read*), and the window accounting (simple-dispatcher's 112 in-window commits, not 0)
  was fixed. Recorded here so the next run explicitly weights modified-not-added seams.

**Score holds at 4:** the run found a second live scoring-model gap in its own rated-done set (R13, plus the
LIN-2993 caveat), caught the halt contract drift from a shipped ticket (R10), and answered the R1–R9 uptake
question with the same honest mixed result — the review is doing its stated job. As before, the secondary
Completeness % does not improve as a measurement.

---

## Completeness % (secondary, noisy — read with care)

Portfolio core/happy-path average across all **40** non-META surfaces this run: **≈89%** (raw CHP points sum
to ≈142.75 of 160 possible, using each split MOD score's midpoint per run 2's convention). **Do not read this
as improvement.** The named movements behind the delta:

- `flow-account-connection-workspace-credential` **-1** (4→3, R13) — a corrected scoring-model gap, not a code
  regression.
- `mod-observer-lane` **+1** (2→3) — a newly-consumed lane module.
- Four new surfaces added to the denominator at CHP 4/3/4/3 — being simply *added* mechanically dilutes the
  still-open Critical defect (R5), the same "unweighted average hides a live gap" distortion run 2 warned of.
  The per-surface Trend Ledger is the primary signal; this number is not.

---

## Trend Ledger

Stable ids are carried forward **verbatim**; none retired. Scores are core/happy-path (CHP) and
configuration (CFG) on a 0-4 scale, `N/A*` = frozen, justified not-applicable. Confidence is this run's own
honesty check, not a maturity score. Delta is against run 2 (`ea53ffc8`) for carried ids, `new` for this
run's registrations. **Every changed score carries a citation and a confidence tag in its row.**

### MOD surfaces

| id | What it is | CHP | CFG | Confidence | Delta (citation) |
|---|---|---|---|---|---|
| `mod-provider-abstraction` | Name→instance registry decoupling provider specifics | 4 | N/A* | High | unchanged |
| `mod-periodicals` | Registry of recurring review templates | 3 | 3 | High | unchanged (registry stable; `scope` still unconsumed) |
| `mod-prompt-template-system` | Deterministic + AI prompt system | 4 | N/A* | High | unchanged |
| `mod-roadmap-trajectory` | Velocity/execution-order/milestone layer | 3 | 3 | Medium/Low | unchanged |
| `mod-render-layer` | ~20+ server-side page renderers, tiered | 4 / 2-3 | N/A* | Medium | unchanged |
| `mod-dispatch-queue` | Queue storage + wake propagation, TTL, loop guards | 4 | 4 | High | unchanged; `digest-feedback.js` folds as evidence |
| `mod-observation-materializer` | Durable read-model store + materializer | 3 | N/A* | Medium | unchanged |
| `mod-kpi-audit` | Public KPI aggregation + workspace audit | 4 / 3 | N/A* | Medium | unchanged |
| `mod-live-console` | Ambient cross-workspace activity feed | 4 | N/A* | Medium | unchanged |
| `mod-scheduler` | Leader-safe CAS-lease job substrate (4 jobs) | 4 | N/A* | Medium | unchanged score; R11 roster note (`server.js:3954`, `lib/http-keepalive.js:29` bare intervals) |
| `mod-observer-lane` | Observer signal modules | **3** | N/A* | Medium | **2→3**, Medium — `lib/observer-pass.js` consumed by `routes/flight-companion.js`+`server.js`; `observer-efficacy-signal.js` still dead (R8) |
| `mod-ship-journey` | Waypoint-trail derivation + playback view | 4 | N/A* | Medium | unchanged |
| `mod-passage-planner` | Kickoff-prompt copy view | 4 | N/A* | Medium | unchanged |
| `mod-task-edit` | Dedicated task-edit drill-down | 4 | N/A* | Medium | unchanged |
| `mod-task-create` | Dedicated task-create drill-down | 4 | N/A* | Low/Medium | unchanged |
| `mod-effort-readout` | Per-kind effort × cost × duration read-out (route + renderer) | 4 | N/A* | Medium | new (LIN-2641) |
| `mod-secret-scan` | Repo + served-public-page secret scan (CLI + CI) | 3 | N/A* | Low/Medium | new (LIN-2573) |

### API surfaces

| id | What it is | CHP | CFG | Confidence | Delta (citation) |
|---|---|---|---|---|---|
| `api-linear-graphql` | Linear GraphQL client + retry/timeout | 4 | 3 | High | unchanged |
| `api-github-app` | GitHub App install→callback→link flow | 3 | 4 | Medium/High | unchanged; `github-install-flow.js` fold |
| `api-openrouter` | LLM client + live model catalog | 4 | 4 | High | unchanged |
| `api-mongodb-storage` | Session/data storage, dual backend | 4 | 4 | High | unchanged |
| `api-yap-chat-client` | HTTP client for the experimental chat server | 3 | 4 | Medium/High | unchanged |
| `api-egress-proxy-fetch` | Outbound HTTP proxy wrapper | 3 | 4 | Medium/High | unchanged |
| `api-workspace-proxy` | Harbour's exposed source-neutral consumer API | 4 | 4 | High | unchanged — router decomposition is citation-shift-only (`routes/proxy.js:20-30` mounts 11 sub-routers); new CFG evidence `dispatch-repo-guard.js`, `proxy-graphql-errors.js`, `proxy-instructions.js` |
| `api-dispatch` | Harbour's exposed Dispatch API | 4 | 4 | High | unchanged; `consumer-poll-warning.js` fold |
| `api-jira-rest` | Jira Cloud provider — read-only MVP | 4 | 4 | High | unchanged; `providers/jira/adf.js` fold |

### FLOW surfaces

| id | What it is | CHP | CFG | Confidence | Delta (citation) |
|---|---|---|---|---|---|
| `flow-dispatch-lifecycle` | queue → take → feedback → terminal-marker | 3 | N/A* | High | unchanged — R2 (`cleanup()` `lib/dispatch-store.js:843-871`; `silentSince` no prod caller) |
| `flow-followup-resume` | `followUpTo` resume; consumer owns liveness | 4 | N/A* | High | unchanged |
| `flow-autopilot-wake` | subscription + `waitForFollowUps` up-chain wake | 4 | 3 | Medium | unchanged |
| `flow-oauth` | Linear, GitHub App, OpenRouter PKCE, Jira | 3 | 4 | High | unchanged — Jira leg still self-disclosed unproven (`lib/providers/jira/oauth.js:28-36`) |
| `flow-bootstrap-token-exchange` | Single-use bootstrap → working-token exchange | 4 | N/A* | High | unchanged |
| `flow-recap-brief-cache` | Hash-based staleness invalidation | 4 | 3 | High | unchanged |
| `flow-free-tier-rate-limit` | Quota check → use → footer → 429 | 2 | 4 | High | unchanged — R5; 0 commits to `lib/free-tier-store.js`; read `:148-149` vs write `:197-199`; call-site consolidation via `lib/chat-request.js:80` |
| `flow-periodicals-two-stage` | Stage-1 mint → Stage-2 self-conclude contract | 3 | **3** | High | **CFG 2→3**, High — LIN-2385 `d4db6615`, LIN-2396 `3ff81245`, LIN-2575 `5b1901ae`, LIN-3022 §5 `c74d0439`; CHP held at 3 by R7/R9 |
| `flow-account-connection-workspace-credential` | owner-credential-store → refresh → cache → gate | **3** | N/A* | High | **4→3**, High — LIN-2473 (Done, 2026-09-02) provider-lane 401/503 flapping; `credential-health` LLHW (LIN-2493); R13 |
| `flow-cost-telemetry` | task-cost/model-pricing/weekly-budget/plan-fee lane | 3 | 3 | Medium | unchanged; `pricing-conformance-sweep.js` fold |
| `flow-operator-decisions` | scan → task-decisions → unanswered → shelved → supersede | 4 | N/A* | High | score unchanged (at ceiling); **large in-window WITHDRAW delta** — `isDecisionWithdrawn` `lib/unanswered-decisions.js:264`, `answeredDecisions`/`withdrawal` digest `lib/pipeline-loops.js:63-136`, `includeResolved` contract `routes/proxy-rulings.js:103,163,248`, `reverse-withdrawal` `routes/dashboard.js:1673`, published no-re-raise contract `lib/prompt-template-defs.js:1043,1202` (LIN-2891/3034/3035/3036/3038/3022), consumer half `simple-dispatcher` LIN-3039/3040 (multi-`WITHDRAW:`); plus `dismissal-suggestions-store.js`, `scan-fingerprint.js`, `harbour-comments-store.js` folds |
| `flow-account-merge` | identity-conflict resolution lane | 4 | N/A* | High | unchanged |
| `flow-flight-companion-turn` | agent turn core → gate → transcripts → SSE stream | 4 | N/A* | Medium | new (LIN-2631/2968) |
| `flow-dispatch-halt` | operator halt request → store → consumer honouring | 3 | N/A* | Medium | new — Doc drift R10; LIN-3074 owner |

### META surface

| id | What it is | CHP | CFG | Confidence | Delta (citation) |
|---|---|---|---|---|---|
| `meta-integration-surface-maturity-review` | This review's own methodology | 4 | N/A* | High | unchanged — see Self-Audit |

**N/A justifications.** Carried `N/A*`s re-verified in place, none flipped. New `N/A*`s this run (4):
`flow-flight-companion-turn` (application-logic FLOW, no env-config knob identified), `flow-dispatch-halt`
(application-logic FLOW, no env-config knob identified), `mod-effort-readout` (read-only render/data module
with no environment surface), `mod-secret-scan` (CLI/CI scanner configured by args, not env). A future run
flipping any of these to a numeric score is itself a reportable delta, never a silent denominator change.

---

## Halt-copy stale-contract class (B5)

**Fix owner: LIN-3074** (`Backlog`). **Query at LinearViewer HEAD `b5c528c4807acc2222f4afd6fe2b87ded41fdf89`:**

```
grep -rn "LIN-2995\|yet honor" --include='*.js' --include='*.md' .
```

**Counting rule and result.** The raw grep returns **35 hits across 15 files**. Dropping the one false
positive — `docs/incidents/2026-09-22-harbour-db-reads-hang.md:148`, a status-table row
(`| LIN-2995 | Backlog | … |`), not contract prose — gives **34 hits across 14 files**. A count of **27** is
only reached by counting a line **range** (or a sentence continuation) as one hit; the run-2 plan's "27" is
that artefact, not a different real set.

**Why it is drift now, not just stale wording:** LIN-2995 is **`Done`** — the consumer honours a halt
(`simple-dispatcher/dispatcher.js:31,1470-1503`, `halt.js:219` `resolveEffectiveHalt`) — while Harbour's own
operator-facing text still says the runner does not. See R10.

**The 3 stale lines LIN-3074 omits (all present in the grep above):**
`tests/unit/render-dispatch-exec-controls.test.js:43`, `tests/e2e/dispatch-halt.spec.js:124`,
`docs/runbooks/harbour-degraded.md:60` ("once LIN-2995 lands, `stop` flows abort → error").

**Sentence continuations** (not separate findings): `docs/runbooks/harbour-degraded.md:7` and
`docs/dispatch-integration.md:130` continue sentences already on the list.

Per-file raw tally: `docs/architecture/dispatch-and-proxy.md` 4; `docs/dispatch-integration.md` 2;
`docs/executive-summary.md` 1; `docs/incidents/2026-09-22-harbour-db-reads-hang.md` 1 (FP);
`docs/proxy-integration.md` 2; `docs/runbooks/harbour-degraded.md` 8; `lib/proxy-instructions.js` 2;
`lib/render-dispatch.js` 1; `public/dispatch.js` 2; `routes/dispatch.js` 2; `routes/proxy-halt.js` 3;
`tests/e2e/dispatch-halt.spec.js` 2; `tests/unit/dispatch-route-halt.test.js` 2;
`tests/unit/proxy-halt.test.js` 1; `tests/unit/render-dispatch-exec-controls.test.js` 2.

---

## Citation re-points (every carried run-2 citation into a changed file, B1–B4)

Extraction command:
`grep -noE '[A-Za-z0-9_./-]+\.(js|md|mjs|txt|json):[0-9]+(-[0-9]+)?(,[0-9]+(-[0-9]+)?)*'` on run 2 →
**35 raw matches / 26 unique groups**; the widened rule (B1) adds 3 bare-`` `:NNN` `` groups → **29 rows**.
Every row was content-verified (B4): the cited text at `ea53ffc8` was compared with the new line at HEAD.
**29/29 PASS, 0 fail.**

| Old citation (run 2) | Status | New location (content-verified) |
|---|---|---|
| `routes/workspace-api.js:3450` (R7, 5×) | drifted | `router.patch` `:4111`; `issueWriteGuard` `:4164`; `stateId` `:4173`; `updateIssue` `:4180` — **B3** |
| `routes/proxy.js:3487` (3×) | drifted | `routes/proxy-writes.js:341` |
| `routes/proxy.js:58,3446-3465` | drifted | `routes/proxy-writes.js:22` (import), `:300-341` (gate; `checkPeriodicalReportGate` `:309`) |
| `public/task-edit.js:91` | unchanged | same line |
| `public/llms.txt:97` | **not moved** | `:97` is the `issue-edit-link` line, `:96` is create-task — **B2** |
| `workspace-api.js:3434` (no `routes/` prefix) | drifted | same target as R7 row — `issueWriteGuard` `:4164` |
| `routes/ship-biscuit.js:196` (R5) | drifted | `:194` — now `checkFreeTierGate` (`tryUse` inside `lib/chat-request.js:82`) |
| `routes/workspace-api-roadmap.js:310,795` (R5) | drifted | `:338` (still direct `tryUse`), `:828` (`checkFreeTierGate`) |
| `routes/test.js:882` (R5) | drifted | `:988` (`recordUsage`) |
| `free-tier-store.js:148-149,197-198` (R5) | unchanged | same lines (`global:` read vs `global:global:` write) |
| `lib/dispatch-store.js:746-778` (R2) | drifted | `cleanup()` `:843-871` (expired query `:849`, `deleteMany` `:869`) |
| `lib/live-console.js:78-85` (R2) | **unchanged** | same lines — **B3** |
| `lib/render.js:499,518` (R9) | drifted | `:505,524` |
| `routes/dispatch.js:292,548` (R9) | drifted | destructure `:277`; validation `:340-341`; echo `:615` |
| `lib/dispatch-store.js:343,840` (R9) | drifted | `_formatHistoryItem` `:1740`; `_formatItem` `:2563` |
| `routes/proxy.js:569-632` (R9) | drifted | `routes/proxy-dispatch.js:56-133` (`repo` `:90`, no `periodicalId`) |
| `lib/dispatch-store.js:75-89` (R9) | drifted | `PERIODICAL_PROJECTION` `:134-142` |
| `CLAUDE.md:126` | moved | content relocated to `docs/architecture/source-map.md:108` (`CLAUDE.md` now 106 lines, text absent) |
| `routes/workspace-api.js:2724-2740` (R4) | drifted | `:3434-3443` (`sniffRasterType` `:3437`, `nosniff` `:3443`) |
| `routes/dispatch.js:1115-1205` (presets) | drifted | `:1312-1406` (GET `:1315` … delete `:1406`) |
| `routes/dashboard.js:1567-1587` (decisions join) | drifted | `:1916-1983` (`collectUnansweredDecisions` `:1916`, `computeEscalationKpis` `:1981-1983`) |
| `lib/providers/jira/oauth.js:28-36` | unchanged | same lines |
| `lib/dispatch-store.js:153` (self-audit TTL) | drifted | `:226` (`this.ttl = options.ttl \|\| 86400`) |
| `proxy.js:58` (no `routes/` prefix) | drifted | `routes/proxy-writes.js:22` |
| `routes/proxy.js:3556` (R7 appendix) | drifted | `routes/proxy-writes.js:410` (description-only, correctly ungated) |
| `lib/periodical-runs.js:142` | drifted | `:147-148` (`_laneKey`, `return row.repo \|\| null`) — **B2** |
| `routes/proxy.js:600-605` (B1) | drifted | `routes/proxy-dispatch.js:92-97` (`dispatchedBy` comment) |
| `routes/dashboard.js:1429` (B1) | drifted | `:1551` (`shelvedRulingsStore`) |
| `routes/dashboard.js:1514` (B1) | drifted | `:1801` (`shelvedRulingsStore.shelve`) |

No citation was found un-re-pointable; every changed-file citation has a confirmed new location or an
explicit "moved to" pointer.

---

## Ranked recommendations (machine-readable state)

Uncapped; R1–R9 keep their ids (R4 stays closed); new ones start at R10. All within the 5–10 headline cap.

| id | surface | dimension | impact | effort | priority | status |
|---|---|---|---|---|---|---|
| R7 | `flow-periodicals-two-stage` | configuration/enforcement | H | L | 1 | open, carried (unchanged) |
| R1 | `flow-periodicals-two-stage` | core/happy-path, configuration | H | M | 2 | open, carried (improved, CFG +1) |
| R13 | `flow-account-connection-workspace-credential` | core/happy-path | H | — (Security's) | 3 | open, new (scoring-model gap) |
| R5 | `flow-free-tier-rate-limit` | testing (sibling-owned) | H | — | 4 | open, carried (unmoved, third cycle) |
| R2 | `flow-dispatch-lifecycle` | core/happy-path | M | M | 5 | open, carried (unchanged) |
| R9 | `flow-periodicals-two-stage` | configuration/data-integrity | M | L-M | 6 | open, carried (partial: `repo` fixed, `periodicalId` not) |
| R10 | `flow-dispatch-halt` | documentation (sibling-owned) | M | L | 7 | open, new (halt contract drift; LIN-3074) |
| R3 | portfolio/META | error handling, resilience, rate limits, idempotency, observability | H | — | 8 | open, carried (unchanged) |
| R8 | portfolio/META | cross-surface (landed-but-unconsumed) | M | — | 9 | open, carried (mixed) |
| R6 | portfolio/META | sibling review cadence | M | — | 10 | open, carried (worsened) |
| R11 | `mod-scheduler` | configuration | L | L | 11 | open, new |
| R12 | portfolio/META | documentation (sibling-owned) | L-M | L | 12 | open, new |
| R4 | MOD (feedback-widget image handling) | security (sibling-owned) | — | — | 13 | **closed/resolved**, carried |

---

## Plain-language read for the maintainer

The short version: the biggest recommendation from two runs ago is **still not fixed** — the very gate that
stops this report from being marked done without evidence still only guards one of the two doors a person can
walk an issue's state through, and the unguarded one is the product's own edit page. That is now a
three-cycle-old, two-line fix.

Two things are genuinely new. First, a shipped incident — the provider-lane 401/503 flapping (LIN-2473) —
landed squarely on a surface the last report had rated 4/High. That is the review catching its own optimistic
scoring, and the credential lane is marked down accordingly. Second, the halt kill-switch the consumer now
actually honours still says in fourteen files that it isn't honoured — that's not just stale wording any more,
it's documentation contradicting shipped behaviour, and LIN-3074 owns the cleanup.

Otherwise the picture is steady: the proxy router split is a tidy refactor that changed citations, not
behaviour; the free-tier global cap is still broken (third cycle); the dispatch "taken but never fed back"
timeout still doesn't exist; and no sibling review has refreshed since August, so the security, API-quality
and test-coverage reads this review leans on are now about three months old.

**If you act on one thing:** close R7. **If you act on two:** progress R5.

**No follow-up tasks have been created.** This is advisory; the decisions above are the maintainer's.

---

## Adversarial Second-Read

**Tier used:** **Tier 2 — a fresh-context sub-agent**, dispatched from within the report-writing session
carrying no memory of the report-writing turn. It was given only: the report path and repo roots, the review
window (`ea53ffc8..b5c528c4`; simple-dispatcher run-2 date → `3b1e734`), the one-line remit, and the question
below — no dossier, no findings, no summary. It independently inspected the live tree and the Linear tickets
rather than trusting the report's own citations.

**Question posed, verbatim:** *"What is the largest item in this window that this report missed or
misfiled?"*

**Reader's full answer, verbatim:**

> **## 1. The one largest item**
>
> **The withdrawal/decision-lifecycle (WITHDRAW) subsystem — the window's largest cross-repo contract change — is absent from the report, which scores its home surface `flow-operator-decisions` "unchanged."**
>
> **## 2. Cited evidence**
>
> **The report is silent.** `docs/reviews/integration-surface-maturity-review-2026-09-26.md:592` carries `flow-operator-decisions` as `4 / N/A* / High — unchanged`; the report contains **zero** occurrences of `withdraw`, `WITHDRAW`, `answeredDecision`, `includeResolved`, or `decision-withdrawn`.
>
> **LinearViewer commits in-window** (`git log --oneline ea53ffc8..b5c528c4`, all ancestry-verified): LIN-3034: `3eecd728`, `b627d9b7`, `d8236ee2`; LIN-3035: `c0dc4496`, `fa37864d`; LIN-3036: `a4255697`, `78a8973a`, `46caba41`; LIN-3038: `184553ba`, `5d8b5a89`; LIN-2891 F1: `4834be19`; LIN-2775: `67ce988c`, `d72f0470`, `27203a70`; LIN-3022: `3a77f291`, `2455178a`, `88fe7773`.
>
> **simple-dispatcher commits in-window** (run-2 HEAD `7064955` → `3b1e734`): `3c5fa3c`, `9c75ca2`, `f27e2e0` (LIN-3039), `cc51763` (LIN-3040), `63e0171`, `a43a9c3` (LIN-2891 F2).
>
> **Live at HEAD** (`b5c528c4`): `lib/unanswered-decisions.js:264` `isDecisionWithdrawn`; `lib/pipeline-loops.js:63-136` (`withdrawal` + `answeredDecisions` digest, BUILDER_VERSION 12→16); `routes/proxy-rulings.js:103,163,248` `includeResolved`; `routes/dashboard.js:16,1673` `POST …/rulings/reverse-withdrawal`; `lib/prompt-template-defs.js:1043,1202` (published `/rulings?includeResolved=true` no-re-raise contract). ~36 LV commits + 7 SD commits, several thousand lines across the rulings/decisions modules (e.g. `public/observation.js` +2612, `lib/pipeline-loops.js` +866, `lib/unanswered-decisions.js` +540, `routes/dashboard.js` +662, `routes/proxy-rulings.js` +482).
>
> **The enabling error:** the report (`:24-26`) states "simple-dispatcher had **0** commits in the same window." Run 2's cited consumer HEAD was `simple-dispatcher@7064955` (run-2 report `:228`); `git rev-list --count 7064955..3b1e734` = **112** (84 touching `*.js`), which is where the WITHDRAW consumer half and its `dispatcher.js` wiring landed. The report's own R10 (`:229-230`) cites consumer changes at `dispatcher.js:31,1470-1503` and `halt.js:219`, contradicting its own "0 commits."
>
> **## 3. Classification**
>
> **Coverage gap — with a misfiling.** The subsystem is a material delta on an existing registered FLOW (new `decision-withdrawn` terminal state, new persisted `answeredDecisions` set, changed public `/rulings` contract), yet `flow-operator-decisions` is filed "unchanged." The `0`-vs-`112` consumer count is a compounding **factual error**.
>
> **## 4. Confidence**
>
> **High** on the WITHDRAW omission (commit/file evidence is direct and the report is verifiably silent). **High** on the simple-dispatcher count being wrong.
>
> **NOT the headline (secondary note):** the single cleanest *factual* error is the window accounting itself — the report says simple-dispatcher had 0 commits since run 2; it had 112. If the grader's target is that count rather than a surface, this is the same root defect viewed as metadata rather than as a missed flow.

**Verification by this report's author (B4-style, content-checked).** The reader's citations were reproduced
independently: `git rev-list --count 7064955..3b1e734` = **112** (and 111 from `05681975`); every cited
LinearViewer commit is `git merge-base --is-ancestor`-confirmed inside `ea53ffc8..b5c528c4`; the live lines
exist at HEAD (`lib/unanswered-decisions.js:264` `isDecisionWithdrawn`, `routes/proxy-rulings.js:103`/`:248`
`includeResolved`, `routes/dashboard.js:1673` `reverse-withdrawal`, `lib/pipeline-loops.js:63-136`
`withdrawal`/`answeredDecisions`); and the report was indeed silent (no `withdraw` citation). The finding is
accepted as accurate.

**Adversarial second-read verdict: AGREE.** The report's ranked findings (R7, R1, R5, R2, R9, R13, R3, R8,
R6, R10) and their citations were not challenged; the disagreement is a **coverage/fact gap**, and the report
was corrected in place.

**Differed from top finding: YES.** The reader's answer (the missed WITHDRAW subsystem, plus the
simple-dispatcher window-accounting error) differs from the report's own #1-ranked finding (R7, the Done-gate
bypass), which the reader did not dispute.

**Disposition: fixed in place.** Three in-place corrections, no new recommendation minted (the finding is a
coverage/accounting gap, not a new code defect, and this review mints no fix-work):
1. **Window accounting corrected** — the Scope section now states simple-dispatcher's **112** in-window
   commits (and distinguishes the empty post-pin drift check from the non-empty run-2 review window), fixing
   the factual `0` that also contradicted R10.
2. **`flow-operator-decisions` ledger row** now records the WITHDRAW subsystem as cited in-window delta
   evidence (score stays 4/`N/A*` — already at ceiling — so the id does not move; the row was previously
   "unchanged" with only fold evidence, which the reader correctly flagged as a misfiling of a large delta).
3. **Surface registration** gains a "modified-not-added seams" note naming the WITHDRAW subsystem and the
   other modified-in-window seams the `--diff-filter=A` sweep cannot see, since that sweep alone understates
   the window.

No scores or ids changed, so the beat-2 id-diff and 35-file self-checks are unaffected (re-run: 37→41 ids
with exactly the 4 new; 35/35 dispositions). The report's coverage-model gap — relying on the added-file diff
alone — is recorded in the Self-Audit above as this run's own META datum.

---

*Surface Assessment: lands cleanly — this is a review-only advisory report; producing it required no
structural change to the codebase, and no code, configuration, or secrets under review were modified.*
