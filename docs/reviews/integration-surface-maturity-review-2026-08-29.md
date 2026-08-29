# Integration & Surface Maturity Review — 2026-08-29

*Advisory, review-only. Periodical: **Integration & Surface Maturity** (LIN-1336). This is the
periodical's **second** run — the first real delta against
[`docs/reviews/integration-surface-maturity-review-2026-07-17.md`](./integration-surface-maturity-review-2026-07-17.md)
(the **baseline**, HEAD `ae00c61b7`). Sibling of the Stability Review (LIN-453) and Recent Headwinds
(LIN-542) — the third advisory, portfolio-level periodical. This report mints no code changes and no
follow-up fix-tasks; it hands a maintainer a triageable maturity read framed as a **trend**, not a
snapshot, and leaves the decision to them.*

**Re-grounding (staleness check).** HEAD at research and write time is `292ac962` (2026-08-29
20:22:13+01:00). `git merge-base --is-ancestor ae00c61b7 HEAD` → true: **468 commits** landed since
the baseline, **337** touching `lib/`+`routes/`. This ticket was minted at `2026-08-29T19:18:00.654Z`;
exactly one commit (`292ac962` itself) landed on `main` since, touching no report-critical file
(`lib/periodicals.js`, `lib/periodical-runs.js`, `lib/periodical-report-gate.js`,
`lib/free-tier-store.js`, the baseline report). Two research passes and a plan-review cycle
independently re-confirmed this HEAD and re-verified their own citations against it rather than
trusting prior notes — see the Adversarial Second-Read section for the final fresh-context check.
No re-grounding drift found; this report's own citations below were spot-checked against the live
tree at the same HEAD before writing.

---

## Scope & method

This review is a **portfolio/meta layer**, not a fifteenth ground-up inspection. Per its own prompt
contract (`lib/periodicals.js`), it:

- inventories the system using a **MOD / API / FLOW / META** taxonomy, carrying every baseline id
  forward verbatim (an id is forever — retired, never deleted; none retired this run);
- scores each surface's **core/happy-path** and **configuration** dimensions first-party (this
  review's exclusive remit, alongside FLOW and the portfolio scorecard itself), and **aggregates**
  the other ten dimensions from sibling reviews, confidence-marked **High/Medium/Low**;
- treats every score as a **delta** against the baseline — new, unchanged, improved, worsened, or
  resolved — never a point-in-time read; and
- mints **no** follow-up work, even for a high-severity finding on a sibling-owned dimension — it
  names the owning review and stops.

**Scope was widened, not narrowed, this run**, per the ticket's own "discover, don't shrink" instruction.
Discovery covered: the four consumer-side FLOWs' `simple-dispatcher` half (decided below); ~468 commits
of new surfaces (Jira, the credential lane, Live Console, Ship Journey, Passage Planner, cost/budget
telemetry, the observer lane, the scheduler, the decisions/rulings lane, account-merge); and a
behavior-based sweep (not name-based) for modules landed-but-consumed-by-nothing. The **output** stays
bounded: 24 baseline ids carried forward, 12 new ids registered with cited evidence, several candidates
explicitly folded into existing ids rather than minted, and the findings list stays uncapped but
severity-ranked rather than padded.

**Consumer-repository decision, made explicit.** `simple-dispatcher` (the polling consumer:
`dispatcher.js`, `hook.js`, `reapers.js`, `state-store.js`, `harbour-token-mcp-server.js`) is **in this
run's discovery scope, out of its scored ledger**. `integration-surface-maturity` carries
`scope: 'repo'` in the registry, but `template.scope` is consumed by **zero** runtime code — every
per-repo lane keys on the dispatch row's own `repo` field (`lib/periodical-runs.js:142`), and all 100
of the most recent dispatch rows carry `repo: null`. The repo-inventory seam that would feed a real
per-repo lane, `lib/workspace-repos.js` (LIN-1935), has zero production importers; its consumer,
**LIN-1933** ("target-repo selection at dispatch"), is still **In Progress**. `simple-dispatcher` also
has no `docs/reviews/` directory, so an id minted under it could never be refreshed by a default-lane
run — violating the "an id is forever, ledger stays diffable" contract this very report depends on.
Because FLOW is this review's one exclusive remit, and a FLOW crossing a repo boundary is exactly what
it exists to catch, the consumer half is used as **cited evidence about the four Harbour-side FLOW
surfaces that cross it** (worked example: `simple-dispatcher/reapers.js`'s watchdog layer, cited under
R2 below) — never as a place to mint surfaces. Revisit when LIN-1933 lands.

---

## Headline read

The system's **structural** maturity keeps improving where this run's own top recommendation
(R1, `flow-periodicals-two-stage`) landed real machinery — a run ledger, a code-enforced Done gate,
deletion of dead model fields — and this is the first run able to answer "are past recommendations
being acted on?" at all. But this run's own first-party remit again surfaced the sharpest finding in
the report, and it is uncomfortably close to home: **the Done gate that is supposed to stop this very
report from being marked complete without evidence is enforced on only one of the two write paths that
can set an issue's state.** `routes/workspace-api.js:3450` — the product's own task-edit page's save
button — performs the identical write `routes/proxy.js:3487` performs, with no gate check at all. Both
routes already read the exact two inputs (`description`, `comments`) the gate needs; only the check is
missing. This is not a latent risk — it is the standing edit affordance a human uses today (R7).

Three other threads run through this report:

1. **The baseline itself was wrong about one of its six findings, and this run caught it.** R4 (a
   stored-XSS finding cited from a stale Security review) was **already fixed 21 days before the
   baseline ran** — the baseline deferred to sibling evidence old enough that a single grep at its own
   HEAD would have shown the finding closed. This is the *inverse* failure mode of R5 (a review reading
   too optimistically), and it is exactly the kind of self-correction the META self-audit exists to
   surface (see below).
2. **A recurring shape — work landed, tested, and consumed by nothing — keeps showing up.** The
   baseline named it once (`lastRunAt`). This run finds it recurring in four new modules plus two
   pre-baseline ones a name-based sweep couldn't have caught, and finds the *inverse* shape too: a
   guard module (`lib/dispatch-referent-guard.js`) that was deliberately extracted to stop exactly this
   kind of divergence, which this report calls out as the honest counterweight (R8).
3. **A field the ledger depends on is invisible at the layer that would prove it.** `periodicalId` —
   minted specifically to replace a fragile title-matching join — is written correctly end-to-end and
   then dropped at the public route response allow-list — the fourth instance of a drop pattern
   `PERIODICAL_PROJECTION` documents three prior cases of, this one a layer up and itself undocumented
   (R9). Whether live rows actually carry it is **unresolvable from any
   API surface available to this review**, and this report does not assert either way.

Reliability ([LIN-1040](https://linear.app/linearviewer/issue/LIN-1040)) and Observability
([LIN-1041](https://linear.app/linearviewer/issue/LIN-1041)) reviews still do not exist (R3, unchanged
since baseline) — five of this review's twelve dimensions remain fully unowned. Of the five correctives
the baseline named as stale, **one has since refreshed** (documentation) and four have not (security,
API quality, test coverage, dependency/supply-chain); four further siblings outside that five have also
refreshed (code-quality, design, headwinds, drift-coherence), while stability — a fifth 2026-06-25
report the baseline's list omitted — has not. Five sibling reports current, five still at 2026-06-25
(R6, now genuinely mixed rather than uniformly stale).

---

## Findings (priority-ranked)

Ranked by impact × inverse effort, highest first. This is advisory — **no task is minted for any of
these**; each is a pointer for a human to triage. R1–R6 carry forward under their baseline ids per the
ticket's own rule ("an unresolved recommendation carries forward under its original id"); R7–R9 are new
this run.

### R7 — `routes/workspace-api.js:3450` sets issue state with the LIN-694/LIN-2323 Done gate never invoked · **Impact: H · Effort: L · new**

*Surface: FLOW (`flow-periodicals-two-stage`) · Dimension: configuration/enforcement completeness
(first-party) · Confidence: High*

Exactly two routes can set a state on an issue: `routes/proxy.js:3487` and
`routes/workspace-api.js:3450` (`provider.updateIssue(`, enumerated exhaustively). `checkPeriodicalReportGate`
/ `extractPeriodicalGateId` (`lib/periodical-report-gate.js`) are imported and invoked at exactly one of
them — `routes/proxy.js:58,3446-3465`. `routes/workspace-api.js` does not import the gate module at all.
This is not latent: `public/task-edit.js:91` PATCHes exactly this route, and `public/llms.txt:97`
documents the page as the product's own edit affordance — a human on
`/workspace/{urlKey}/task/{issueId}/edit` can move a periodical review task to a Done-type state with
the gate never executing. The route already holds the gate's exact two inputs at the call site
(`workspace-api.js:3434`, `provider.issueWriteGuard` returning `description` and `comments(last: 20)`)
— only the conditional is absent.

**Sharpening evidence, per the plan-review's required correction:** the two write paths are not
independent code that merely diverged — they already share a validation seam.
`lib/issue-write-validation.js` (155 lines) is imported by **both** `routes/proxy.js` and
`routes/workspace-api.js`, extracted in the very commit (`2cbaa29c`, 2026-07-24, LIN-1552) this
finding's ordering claim cites, "so the new session-auth workspace API routes consume the SAME
definition and cannot drift." The Done gate's absence from one of two paths that already share a field
validation contract is a gap in an existing shared seam, not two routes that happened to grow apart —
which makes the two-line fix (import the gate, run the existing check) cheaper to justify, not harder.

**Why it happened, cited:** the route landed 2026-07-24 (`2cbaa29c`); the gate landed 2026-08-23
(`18843e64`, LIN-694) and was extended 2026-08-26 (`a94d3c7b`, LIN-2323) — a month later, onto one of
two then-existing paths. The module header acknowledges a direct provider-side/Linear-UI transition as
an un-closable third bypass; it does not acknowledge this in-product one.

**Action (for a human to weigh):** import `checkPeriodicalReportGate` into `routes/workspace-api.js`'s
update-issue handler and run the identical check `routes/proxy.js` already runs — the guard read and
its two required fields are already in hand at the call site.

### R1 — `flow-periodicals-two-stage`: Stage-2 completion — substantially acted on, not closed · **Impact: H · Effort: M · carried, improved**

*Surface: FLOW · Dimensions: core/happy-path, configuration (both first-party) · Confidence: High ·
Baseline: CHP 1, CFG 0 → this run: CHP 3, CFG 2*

The baseline's own top recommendation, **LIN-373**, is **Done**. Since baseline: `lib/periodical-runs.js`
(`foldPeriodicalRuns`, LIN-1827) computes per-template due-state; `GET /api/proxy/periodicals`
republishes it (LIN-1829); `lib/periodical-report-gate.js` (LIN-694) is a code-enforced Done-transition
gate, extended by LIN-2323's adversarial-read requirement (the same gate this task is itself subject
to); the dead `lastRunAt` field was deleted repo-wide (LIN-1831, zero occurrences remain). This is the
first run able to answer "is the baseline's top recommendation being acted on?" at all, and the answer
is genuinely yes for the mechanism as a whole — but three verified gaps hold it below a clean close:

- **(a) The ledger measures dispatch, not review.** `recent`/`never` are computed from
  `lastDispatchedAt` against cadence — the module's own header calls `never` a *bounded* claim ("no
  evidence in the full window the store can still hold"), never "never ran." Cross-tabbed against
  `docs/reviews/` at this report's stated HEAD (`292ac962`): **8 of 15** live ledger states misdescribe
  report-production status, in *both* directions — `drift-coherence` and `onboarding-journey` read
  `recent` with a 65-day-old report and no report at all respectively, while
  `security-review`/`api-quality-review`/`test-coverage-gap`/
  `stability-review`/`dependency-supply-chain-review`/`comprehension-debt-review` all read `never`
  despite having reports on disk. **At merge time the figure is 7 of 15**: `drift-coherence` dropped out
  of the mismatch set when `drift-coherence-review-2026-08-29` landed on `main` in `cb2fbb5a`, 33
  minutes before this PR's own final commit (see R6). The remaining seven are unchanged, and the
  direction of the finding is unaffected. Nothing in the tree reads `docs/reviews/` at runtime — the
  Stage-2 measurement gap is total, not partial.
- **(b) The gate covers one of two write paths** — see R7.
- **(c) The `periodicalId` join key is unverifiable in practice** — see R9.

LIN-1629 (a change-gated due-ness probe) is still `Todo`. A leader-safe scheduler substrate now exists
(`lib/scheduler.js`, LIN-2128, two registered jobs) — periodicals is not one of them, which is worth
noting against the baseline's "no new scheduler process" framing, now factually superseded by
infrastructure that could carry it.

**Action (for a human to weigh):** none of (a)/(b)/(c) needs a new mechanism — (b) is a two-line
import-and-check at an existing call site (R7); (a) needs the ledger's `recent`/`never` republication to
carry an explicit "dispatch, not review" caveat rather than a bare token; (c) needs `periodicalId`
(and `repo`) added to the response allow-lists that currently drop them (R9). LIN-1629 remains the
tracked owner for the due-ness probe itself.

### R5 — `flow-free-tier-rate-limit`: still Critical, still unmoved · **Impact: H · Effort: — (Test Coverage Gap's to confirm) · carried, sibling-owned, worsened by non-movement**

*Surface: FLOW (`lib/free-tier-store.js`) · Dimension: testing (sibling-owned) · Confidence: High ·
Baseline: CHP 4 (structural) → this run: CHP 2*

`lib/free-tier-store.js` has **zero commits since baseline**. The live production path `tryUse()`
(callers: `routes/ship-biscuit.js:196`, `routes/workspace-api-roadmap.js:310,795`) reads
`_id: "global:<hour>"` (`:148-149`) but writes `_id: "global:global:<hour>"` (`:197-199`) — the global
hourly cap is never enforced. The correctly-keyed writer, `recordUsage()`, is reachable only from
`routes/test.js:882`. **This report corrects its own core/happy-path score rather than restate the
baseline's "structural 4" a second time.** Scoring a flow 4 on the strength of "every stage is wired"
while a Critical, still-open defect makes the wiring wrong is precisely the scoring-model gap this
review's own META self-audit exists to catch (see below) — restating it unchanged after two runs would
be the failure, not a defensible caution. Auth & credentials/security dimensions remain Security
Review's; testing remains Test Coverage Gap's, whose 2026-06-25 report is the sibling-owned source of
the defect and has not been refreshed to confirm or deny a fix.

**Action (for a human to weigh):** fix the double-prefixed key at `free-tier-store.js:148-149,197-198`
(swap `tryUse()`'s write onto the correctly-keyed path `recordUsage()` already uses), or delete the
dead `recordUsage()` writer if `tryUse()`'s behavior is judged intentional — either way this is a
one-file, low-effort fix that has now gone two full review cycles unaddressed.

### R2 — `flow-dispatch-lifecycle`: a claimed-but-never-fed-back dispatch item still has no timeout · **Impact: M · Effort: M · carried, unchanged, sharper evidence**

*Surface: FLOW · Dimension: core/happy-path (first-party) · Confidence: High · CHP 3 (unchanged)*

Still open at the Harbour layer: no age-since-take reaper exists (`cleanup()`, `lib/dispatch-store.js:746-778`,
still gates only on `expiresAt`; `takeItem` still atomically removes the item from that gated collection).
What *did* land, and is new cited evidence for **no** score movement rather than an absence of evidence:
**LIN-2079** (`bee00e69`, Done) added `listHistory({ silentSince })` — the read-side capability to
*select* a stranded `taken` row by activity age. Its own commit message and docblock are explicit about
the bound: *"the predicate SELECTS, it never evicts"* — no stored field, no index, no migration, no
eviction path. **And nothing consumes it** — `silentSince` appears only in tests and one index-rationale
comment. So the corrected read is: the selection half of a reaper landed and shipped, the eviction half
was explicitly deferred (to **LIN-2120**, still `Backlog`), and the landed half has zero production
callers — not "nothing changed." Separately, `lib/live-console.js:78-85` added *visibility* (a stale
lane drops off the live feed after 1h of no activity), not reaping. Mitigating context, re-confirmed at
`simple-dispatcher@7064955`: the consumer *does* have a full watchdog layer (`reapers.js` —
`stuck-launch`, `stalled-verify`/`-executing`/`-bootstrap`/`-pending`, `expired-hold`,
`runStallFailsafe`), so a live runner self-reports; the residual Harbour-side gap is a runner that dies
before posting anything.

**Action (for a human to weigh):** wire `LIN-2120`'s lineage-aware selection to an actual eviction path
using the `listHistory({ silentSince })` capability that already exists, or surface a "stuck" state on
the Observation feed for a `taken` item with no feedback past a threshold.

### R9 — `periodicalId`/`repo` are dropped at the dispatch response allow-list, the fourth instance of the same silent-drop pattern · **Impact: M · Effort: L-M · new**

*Surface: FLOW (`flow-periodicals-two-stage`) · Dimension: configuration/data-integrity (first-party) ·
Confidence: High*

The write path for `periodicalId` **is** wired end-to-end — `lib/render.js:499,518` →
`data-periodical-id` → `public/app.js`/`public/common.js` → `routes/dispatch.js:292,548` →
`lib/dispatch-store.js:343,840` → both list formatters. But the field is **dropped again at the public
route response allow-list**: `formatDispatchWatch` (`routes/proxy.js:569-632`) is an explicit allow-list
that does not carry `periodicalId` or `repo`, and nothing in that function records the omission as
deliberate — its one such comment (`:600-605`) is about `dispatchedBy` (LIN-1948) and the *list/poll*
re-projection, not these two fields. `PERIODICAL_PROJECTION`'s own comments
(`lib/dispatch-store.js:75-89`) record `followUpTo`, `abort`, and `repo` each having been silently
dropped and restored once already — `periodicalId` is a **fourth** instance of that documented class,
one layer up, still open and itself undocumented. The correction this report
makes to the baseline's first-pass read: whether live rows actually carry `periodicalId` cannot be
determined from any first-party API surface available to this review (a detail read on a periodical row
returns 22 keys, neither `periodicalId` nor `repo` among them) — this report does not assert either
way, and neither should any reader of the live ledger.

**Action (for a human to weigh):** add `periodicalId` and `repo` to the response allow-list(s) that
currently drop them, so the ledger's join key (and per-repo lane key, LIN-1932) is operator-verifiable
rather than resting on an unresolvable assumption.

### R3 — Reliability and Observability reviews still don't exist · **Impact: H (portfolio-wide) · Effort: — (not this review's to mint) · carried, unchanged**

*Surface: META / portfolio · Confidence: High*

**[LIN-1040](https://linear.app/linearviewer/issue/LIN-1040)** (Reliability) and
**[LIN-1041](https://linear.app/linearviewer/issue/LIN-1041)** (Observability) are both still
`Backlog`; neither appears in the now-15-entry registry. Five of this review's twelve dimensions — error
handling, resilience, rate limits & pagination, idempotency & consistency (Reliability's remit) and
observability (Observability's remit) — remain unowned by any systematic review, six weeks on from
baseline. This review does not build them (out of remit); it names the gap so it stays visible rather
than silently absorbed.

### R8 — A recurring shape: work landed, tested, and consumed by nothing — now with a counterweight instance · **Impact: M · Effort: — (each instance has a named or obvious owner) · new**

*Surface: META / portfolio · Confidence: High*

The baseline named this shape once (`lastRunAt` — carried in the data model, written by no code). A
behavior-based sweep (not name-based — enumerating every file added since baseline, then every file in
`lib/` regardless of add-date, then checking production importers) finds it recurring across at least
**2026-04-12 → 2026-08-29**, in three distinct sub-shapes:

| Shape | Instance | Status |
|---|---|---|
| No production importer | `lib/bash-tool.js` (HAR-208, 2026-04-12) | Tested; documented in `CLAUDE.md` with **no "not wired" disclosure**, unlike the deliberate cases below |
| No production importer | `lib/workspace-repos.js` (LIN-1935, Done) | Consumer LIN-1933 **In Progress** |
| No production importer | `lib/observer-efficacy-signal.js` (LIN-2133, Done) | Consumer not landed — see `mod-observer-lane` below |
| No production importer | `lib/plan-review-round-trips.js` | Tests exercise `scripts/*.mjs`, not the module; `lib/follow-on-ratio.js` is consumed only by this module, so it belongs in the same class |
| No production importer, deliberate | `lib/prompts/worker-lane-kickoff.js` (LIN-2242) | `CLAUDE.md:126` states "not yet wired to a route/page" — disclosed, not a gap |
| Imported but the wired instance stays inert | `lib/workspace-store.js` (LIN-1328 Phase B, predates baseline) | Header: *"stays INERT — deliberately passed to NO route factory"*; its own Phase D unblocker (LIN-1330) is Done, yet it stayed inert |
| Capability inside a live module, unconsumed | `listHistory({ silentSince })` (LIN-2079, Done) | See R2 |
| Field dropped at a layer boundary | `periodicalId`/`repo` on dispatch reads | See R9 — 4th recurrence the code itself names 3× |

No sibling review owns this class: each individual module is correct and tested (not a code-quality
finding), and it is not a single module's problem (not a MOD finding) — it is visible only
portfolio-wide, which is this review's own remit. **The honest counterweight, which this report records
explicitly rather than let the pattern read as uniformly negative:** most instances have a named owner
and `CLAUDE.md` documents the state truthfully. And the *inverse* shape exists too —
`lib/dispatch-referent-guard.js` (LIN-1948) was extracted specifically to stop a two-lane divergence
risk (`routes/dispatch.js` and `routes/proxy.js` both minting dispatches on separate credential lanes)
from being solved once and silently drifting on the second lane; it is imported by both routes and its
own header explains why a copy-per-router was the failure mode being closed. One class recurring, one
instance of the opposite discipline landing in the same window — both are true, and a portfolio read
should carry both.

### R6 — Sibling evidence: uniformly stale at baseline, now genuinely mixed · **Impact: M (portfolio-wide legibility) · Effort: — (scheduling call) · carried, improved**

*Surface: META / portfolio · Confidence: High*

At baseline, R6 named five correctives as uniformly ~22 days stale: Security, API Quality,
Documentation, Test Coverage Gap, and Dependency & Supply-Chain. Of those five, **one has refreshed**
(`documentation-review-2026-08-23`) and **four have not**. Four *further* siblings outside the
baseline's five have also refreshed since — `code-quality-review-2026-08-23`,
`design-interface-review-2026-08-23`, `recent-headwinds-review-2026-08-23`/`-2026-08-29`, and
`drift-coherence-review-2026-08-29` (landed on `main` in `cb2fbb5a`, after this report's own stated HEAD
of `292ac962`; see the note below) — so **five sibling reports in total are now current**. **Still
2026-06-25** (~9 weeks, 337 `lib/`+`routes/` commits behind) — `security-review`, `api-quality-review`,
`test-coverage-gap`, `dependency-supply-chain-review`, and `stability-review`: five, of which the first
four are the baseline's own unrefreshed correctives and `stability-review` is a fifth 2026-06-25 report
the baseline's list did not name. `comprehension-debt-review` is 2026-07-01. **Never written** — `performance-scale`,
`data-fetch-architecture`, `onboarding-journey`. Several non-registry reports have also landed since
baseline and carry usable evidence: `lane-run-review-2026-08-23`, `outward-validation-run-2026-08-28`,
`capacity-test-run-review-2026-08-14`, `capacity-levers-map-2026-08-15`,
`context-efficiency-ceiling-review-2026-08-15`, `intra-session-efficiency-review-2026-08-14`.

**Action (for a human to weigh):** refresh the five still-stale correctives, prioritizing Security
(auth & credentials feeds the new `api-jira-rest` and `flow-account-connection-workspace-credential`
surfaces below) and Test Coverage Gap (owns confirming/fixing R5).

### R4 — Security H1 (stored XSS): resolved — and already resolved at the baseline's own HEAD · **Impact: — (closed) · Effort: — · carried, RESOLVED, baseline retro-correction**

*Surface: MOD (feedback-widget image handling, `routes/workspace-api.js:2724-2740`) · Dimension:
security (sibling-owned) · Confidence: High (fix independently re-verified at HEAD, not deferred to a
stale sibling)*

`87f6c9f6` (LIN-682, PR #654) landed **2026-06-26** — 21 days *before* the baseline ran — adding
`sniffRasterType()` byte-sniffing, a raster allowlist, and `nosniff`. `git merge-base --is-ancestor
87f6c9f6 ae00c61b7` → true. The baseline reported this as "22 days stale, no confirmed fix" when a
single grep at its own HEAD would have shown it already closed. **This is the single most useful META
datum this run produced**: not a code finding, but a finding about how the review itself reads sibling
evidence — see the Self-Audit below.

---

## Surface registration — new ids, folds, and roll-ups

Every candidate the plan-review verdict required a disposition for is resolved explicitly below, per
this review's own "register, fold, or exclude — never silently absorb" discipline.

**Registered as new ids (12), each with cited production evidence:**

| id | Type | Evidence |
|---|---|---|
| `api-jira-rest` | API | Jira Cloud provider, read-only MVP (LIN-1885/2011/2018), parallel to `api-github-app` |
| `flow-account-connection-workspace-credential` | FLOW | `owner-credential-store` → `workspace-token-refresh` → `workspace-token-cache` → `refresh-strategy` → `refresh-on-resolve-gate`; observability evidence includes the credential-observability pair below |
| `flow-cost-telemetry` | FLOW | `task-cost.js`→`routes/proxy.js`; `terminal-marked-task-cost.js`→`kpi-stats.js`/`weekly-budget.js`; `model-pricing.js`→`openrouter.js`/`session-telemetry.js`; `plan-fee-config.js`→`server.js` |
| `mod-live-console` | MOD | `lib/live-console.js` + `lib/render-live-console.js` (LIN-1436 and successors) |
| `mod-scheduler` | MOD | `lib/scheduler.js`, leader-safe CAS lease (LIN-2128), 2 registered jobs |
| `mod-observer-lane` | MOD | `lib/observer-*.js` — partially unconsumed, see below |
| `mod-ship-journey` | MOD | `lib/ship-journey.js` (LIN-1684, `9ad101e1`, 2026-08-01) + `routes/ship-journey.js`/`public/ship-journey.js` (LIN-1685, `025aa9b8`, 2026-08-09) |
| `mod-passage-planner` | MOD | `lib/render-passage-planner.js` + `routes/passage-planner.js` + client + kickoff prompts (LIN-1849) |
| `mod-task-edit` | MOD | `routes/task-edit.js` + `lib/render-task-edit.js` (LIN-1565, `65ae5249`, 2026-07-25) |
| `mod-task-create` | MOD | `routes/task-create.js` + `lib/render-task-create.js` (LIN-1973, `44e91e58`, 2026-08-09) |
| `flow-operator-decisions` | FLOW | producer → store → operator-queue chain, see corrected wiring below |
| `flow-account-merge` | FLOW | `lib/account-conflict.js`, `lib/account-merge-log.js`, `routes/account-merge.js` |

**`flow-oauth` re-scored, not minted new:** now four legs (Linear, GitHub App, OpenRouter PKCE, Jira),
sharing one declared refresh contract (`lib/refresh-strategy.js`). Not carried at baseline's 4/4
unexamined — see Trend Ledger.

**`mod-task-edit`/`mod-task-create` disposition note:** the plan-review verdict flagged these as
needing an explicit disposition consistent with the Ship Journey / Passage Planner precedent (register
or roll up, but not silently absorb). Both are route+renderer+client drill-down pages, explicitly
**outside** `mod-render-layer`'s tiered view model per their own file headers, structurally identical in
shape to Ship Journey/Passage Planner — so for consistency with that precedent, both are registered
here as their own MOD ids rather than rolled into `mod-render-layer`.

**`lib/dispatch-referent-guard.js` disposition:** folded as new **CFG evidence** on the two existing
ids it is actually imported by — `api-dispatch` (`routes/dispatch.js`) and `api-workspace-proxy`
(`routes/proxy.js`) — mirroring the `ownerless-token-policy.js` fold below, per the plan-review's
expected disposition. It is one dispatch-contract safety policy (a documented FAILS-OPEN-ALWAYS guard)
shared by two already-registered API boundaries, not a cross-module FLOW with no single owner.

**Folded into existing ids as CFG/observability evidence, not new registrations:**

- `lib/ownerless-token-policy.js` (`DISPATCH_OWNERLESS_BROKER_COMPAT`) — CFG evidence on `api-dispatch`
  (`lib/proxy-tokens.js`, `routes/dispatch.js`) and `api-workspace-proxy` (`lib/proxy-preamble.js`,
  `routes/proxy.js`). One env-gated safety switch shared by two boundaries, fails safe.
- Credential-observability pair (`lib/proxy-credential-trail.js`, `lib/credential-lifecycle-events.js`)
  — folded into `flow-account-connection-workspace-credential`'s observability evidence, alongside
  `lib/credential-invariant-sweep.js` (the lane's scheduled self-check, registered on `mod-scheduler`).

**Roll-up lines (no new id, cited as delta evidence on an existing surface, one line each):**
`lib/dispatch-presets-store.js` (LIN-1390/1391/1400 — a fully production-wired preset CRUD store +
REST surface `GET/POST/PATCH/DELETE /workspace/:urlKey/api/dispatch/presets`, imported by `server.js`,
`routes/dispatch.js`, `routes/proxy.js`, `lib/dispatch-factory.js`, and `lib/render-settings.js`, with
explicit routing-precedence resolution — incoming > selected preset > inherited anchor `presetConfig` >
workspace defaults — added as CFG evidence to **both** `api-dispatch` and `mod-dispatch-queue`. The
split is not decorative: the four preset routes are registered in `routes/dispatch.js:1115-1205`, which
is exactly what `api-dispatch` is defined as, so the exposed REST surface belongs on that row while the
store and its precedence rule belong on `mod-dispatch-queue`. This module was missed by the report's original
discovery sweep and its own R8-style "unconsumed module" check did not catch it because it *is*
consumed; the required adversarial second-read below caught the gap, added here per its "fixed in
place" disposition, not scored separately since it doesn't move either surface off its existing
ceiling); `lib/render-templates.js` (a new public, unauthenticated `/templates` page, LIN-1889 — rolls into
`mod-render-layer`); `lib/partial-write-error.js` (a shared write-error classifier imported by
`routes/proxy.js`/`routes/workspace-api.js`/the Jira provider — rolls into `api-workspace-proxy`'s
error-handling evidence, sibling-owned); `lib/credential-state.js` (per-session credential display
state, LIN-1588 — rolls into `flow-account-connection-workspace-credential`'s observability evidence,
alongside the pair above); `lib/timeline-zoom.js` (Live Console's zoom/pan primitives, LIN-1743/1742 —
rolls into `mod-live-console`); `lib/deploy-info.js` (footer deploy metadata — unchanged infrastructure,
no surface of its own). `lib/follow-on-ratio.js` moves into the R8 unconsumed-module class (its only
importer, `lib/plan-review-round-trips.js`, itself has zero production importers).

**Corrected `flow-operator-decisions` wiring** (the plan-review's required citation fix — the original
draft evidence for this FLOW had three importer claims that did not hold at HEAD):

- `lib/scan.js` (LIN-2197 Phase 4) is imported by `routes/workspace-api.js` (the scan GET/POST/dismiss
  routes).
- `lib/task-decisions-store.js` (LIN-2197 Phase 2) is imported by `lib/scan.js`, `server.js`, and
  `routes/workspace-api.js` — **not** `lib/pipeline-loops.js`, which only names it in a doc comment.
- `lib/unanswered-decisions.js` (LIN-1728/2197 Phase 3) is imported by `routes/dashboard.js` only.
  **`lib/escalation-kpis.js` does not import it** — `escalation-kpis.js` imports exactly one thing
  (`median`) and *receives* `unansweredRows` as a parameter. The real joiner is
  `routes/dashboard.js:1567-1587`: it calls `collectUnansweredDecisions`, maps the rows into
  `unansweredRows`, then passes them into `computeEscalationKpis`. The cross-cutting relationship
  between the decisions lane and `mod-kpi-audit` is real; the mechanism is this route-level join, not a
  direct module import.
- `lib/shelved-rulings-store.js` (LIN-1727) is imported by `server.js`; `routes/dashboard.js` consumes
  it via injection (`deps.shelvedRulingsStore`, used at `:1429`/`:1514`), not a static import.
- `lib/loop-supersede.js` (LIN-1478) completes the chain: producer (`scan.js`) → store
  (`task-decisions-store.js`) → operator queue (`unanswered-decisions.js`, joined at
  `routes/dashboard.js`) → dismiss/shelve (`shelved-rulings-store.js`) → supersede (`loop-supersede.js`)
  — five modules, no single owner, this review's own FLOW definition.

---

## Surface inventory

**36 scored surfaces this run — 24 carried from baseline (8 MOD + 8 API + 8 FLOW) plus 12 new
(7 MOD + 1 API + 4 FLOW) — plus 1 META.** Full scores are in the Trend Ledger; this section gives the
narrative read per category.

**MOD (15: 8 carried + 7 new — `mod-live-console`, `mod-scheduler`, `mod-observer-lane`,
`mod-ship-journey`, `mod-passage-planner`, `mod-task-edit`, `mod-task-create`)** — the carried eight are
unchanged in score; several carry
new delta evidence (`mod-periodicals`'s registry grew 14→15 with an unconsumed `scope` field;
`mod-dispatch-queue` absorbed real hardening — LIN-1656 duplicate-dispatch guard, LIN-1948
dangling-referent refusal, LIN-1751/2147 `maxTasks` trim, LIN-2297 wake guard — while staying at its
existing ceiling of 4; `mod-kpi-audit` gained a cross-cutting consumer via the new decisions lane). Of
the new MOD surfaces, five score a clean 4 on core/happy-path with Medium confidence (bounded
first-party import-sweep passes, not deep reads): Live Console, the scheduler, Ship Journey, Passage
Planner, and both task drill-down pages. **One new MOD surface scores lower**: `mod-observer-lane`
(CHP 2) — `lib/observer-efficacy-signal.js` (LIN-2133, Done) has zero production importers, the same
unconsumed-module shape R8 names portfolio-wide, landed inside a module this run had to score directly.

**API (9: 8 carried + `api-jira-rest`)** — every carried surface is unchanged in score;
`api-workspace-proxy` and `api-dispatch` both gained new CFG evidence this run
(`ownerless-token-policy.js`, `dispatch-referent-guard.js`) without moving off their existing ceiling
of 4. `api-jira-rest` enters at 4/4, High confidence — a disciplined, config-gated integration whose own
code explicitly discloses its one real limitation (see `flow-oauth` below).

**FLOW (12: 8 carried + 4 new — `flow-account-connection-workspace-credential`,
`flow-cost-telemetry`, `flow-operator-decisions`, `flow-account-merge`)** — this review's home turf,
and where every sharp finding in this report lives (R1, R2, R5, R7,
R9). Six of the eight carried flows are unchanged; `flow-oauth` is re-scored down one point on
core/happy-path (not a regression in the three pre-existing legs — the new fourth leg's own code
discloses its runtime behavior is unproven: `lib/providers/jira/oauth.js:28-36` states plainly that
*"No live Atlassian app exists yet... none of it is proven"*); `flow-free-tier-rate-limit` is
corrected down two points (R5); `flow-periodicals-two-stage` moves up on both dimensions but stays
short of a clean score (R1/R7/R9). The four new FLOW registrations are High confidence, first-party:
the credential lane is unusually mature (single-flight + CAS + a scheduled self-check that never
auto-remediates but is fully instrumented) but that maturity sits mostly in Reliability's remit, not
this review's; the decisions lane and account-merge lane are both genuine cross-module chains with no
single owner, confirmed production-wired after the citation correction above; cost telemetry is
Medium-confidence (fully consumed, honestly self-documented calibration limits, no deep first-party
pass needed).

**META** — see Self-Audit below.

---

## Sibling-owned dimension coverage

Per-dimension, not per-surface — this review does not fabricate a score for every surface × dimension
cell where no sibling evidence exists.

| Dimension | Owning review | Status | Confidence | What's known this run |
|---|---|---|---|---|
| Auth & credentials | Security Review | 2026-06-25, ~9wk stale | Low | Unrefreshed since baseline; the new `api-jira-rest` and `flow-account-connection-workspace-credential` surfaces have no sibling-confirmed auth/credential read at all — this review's own bounded pass (R2 above, Trend Ledger) is the only current evidence |
| Security | Security Review | 2026-06-25, ~9wk stale | Medium (H1 independently re-verified fixed this run — R4) | H1 stored-XSS confirmed fixed (R4, retro-correction); M2/M3 (SSRF DNS-rebind guard, unrated feedback endpoint) status unknown, unrefreshed |
| Input & schema validation | API Quality Review | 2026-06-25, ~9wk stale | Low | Unrefreshed; `lib/issue-write-validation.js` (shared seam, R7) is new first-party evidence this review can cite but not a substitute for a refresh |
| Testing | Test Coverage Gap Review | 2026-06-25, ~9wk stale | Low | R5's Critical defect unconfirmed fixed or unfixed; zero commits to the affected file rules out an accidental fix |
| Documentation | Documentation Review | **2026-08-23 — fresh** | High | Refreshed since baseline; no known open finding blocking this review's own surfaces |
| Error handling | **Reliability — not yet built (LIN-1040)** | no report exists | — | Unowned; R2/R9 are incidental first-party findings, not a systematic pass |
| Resilience | **Reliability — not yet built (LIN-1040)** | no report exists | — | Unowned; the credential lane's single-flight/CAS/converge-on-stored pattern (this run's own FLOW trace) is real evidence but incidental to core/happy-path scoring |
| Rate limits & pagination | **Reliability — not yet built (LIN-1040)** | no report exists | — | Unowned; `api-workspace-proxy`'s differentiated rate limiting (`proxyLimiter`, `proxyTokenCreationLimiter`) noted incidentally |
| Idempotency & consistency | **Reliability — not yet built (LIN-1040)** | no report exists | — | Unowned |
| Observability | **Observability — not yet built (LIN-1041)** | no report exists | — | Unowned; the credential lane's `credential-invariant-sweep.js` is this tree's strongest observability instance anywhere, and it still has no systematic owner to assess it against a standard |

Named explicitly per the contract: **Reliability** ([LIN-1040](https://linear.app/linearviewer/issue/LIN-1040))
and **Observability** ([LIN-1041](https://linear.app/linearviewer/issue/LIN-1041)) remain the natural
home for deeper follow-up on the five dimension-rows above with no owning review — this report mints
nothing into that territory.

---

## Self-Audit — META surface

*Surface: META (`meta-integration-surface-maturity-review`) · core/happy-path: **3 → 4** ·
configuration: **N/A*** (unchanged — a review methodology has no environment-configuration surface)*

Required self-checks this run:

- **How many surfaces are stuck at Low confidence, and why?** Two: `mod-roadmap-trajectory`
  (Medium/Low, carried unchanged — a footer-gated power-user surface that got a lighter first-party
  pass at baseline and was not re-deepened this run) and `mod-task-create` (Low/Medium — this run's
  disposition of it as a new MOD id rests on an existence/import check, not the deeper read
  `mod-task-edit` got; disclosed honestly rather than defaulted to High). Beyond surface-level marks,
  six of ten aggregated *dimensions* are Low-confidence portfolio-wide because their owning sibling is
  ~9 weeks stale (see the dimension table above) — that is a portfolio-cadence problem (R6), not a
  first-party scoring weakness.
- **Did a real finding elsewhere land on a surface this review had rated as done?** Yes, and this run
  adds a **second, sharper instance in the same shape as the baseline's own R5**: this review's first
  research pass initially read `flow-periodicals-two-stage`'s Done-gate machinery as landed and
  effective; first-party re-inspection (R7) found the gate itself is enforced on only one of two
  possible write paths — the exact mechanism this very task's own conclusion is gated by. A scoring
  model that stopped at "the gate exists" would have missed it, same as the baseline's original R5.
  `mod-observer-lane`'s `observer-efficacy-signal.js` is a milder third instance: landed and tested,
  assumed live by naming convention, actually unconsumed.
- **Is any dimension consistently N/A (dead weight) or consistently 0 (unmeasurable)?** Configuration
  is `N/A*` for 19 of 37 surfaces this run — roughly double the baseline's 9-of-25 — but every added
  `N/A*` belongs to a newly-registered surface with a stated reason (a pure feature-flag-gated render
  module, or a pure application-logic FLOW with no environment-configuration knob identified), and **no
  baseline `N/A*` flipped** this run (`flow-dispatch-lifecycle`'s TTL-is-a-code-constant justification
  was independently re-verified against `lib/dispatch-store.js:153`, not silently carried). The growth
  is a real portfolio shape worth naming — as this codebase adds more self-contained, flag-gated view
  modules, a growing share of its surface area genuinely has no env-config dimension to score — not a
  scoring-discipline lapse. No dimension scored 0 anywhere this run (`flow-periodicals-two-stage`'s
  baseline 0 moved to 2).
- **Are past top recommendations actually being acted on?** Answerable for the first time, directly
  against R1–R6: **R1 — yes, substantially** (LIN-373 Done; ledger, gate, and dead-field deletion all
  landed; held short of closed by R7/R9, both newly-discovered by this run, not carried baseline gaps).
  **R2 — partially, asymmetrically** (LIN-2079 delivered the selection half and shipped Done; the
  eviction half was explicitly deferred and the selection half has zero consumers). **R3 — no** (both
  tracking tickets unchanged in `Backlog`). **R4 — was already resolved at the time the baseline ran**,
  and the baseline's own report was the thing that hadn't caught up — a predecessor-error catch, not a
  recommendation-uptake question. **R5 — no, unmoved** (zero commits to the affected file). **R6 —
  mixed** (four of ten siblings refreshed; six did not).

**Argument for moving core/happy-path 3→4:** this is the first run that can answer the "are
recommendations acted on" question at all, and it did so with a mixed, honest answer rather than a
uniform one; it independently caught its own predecessor's factual error (R4); and it found a second
live instance, inside its own governing mechanism, of the exact scoring-model gap (R5-shape) the
self-audit exists to watch for (R7). **Argument against, carried from baseline:** the Completeness %
below remains an unweighted average and does not itself improve as a measurement. The self-audit
answers weigh more than the metric here — this run genuinely executed the review's stated purpose
(catching what nothing else owns, including catching itself) — hence 4.

---

## Completeness % (secondary, noisy — read with care)

Portfolio core/happy-path average across all 36 non-META surfaces this run: **≈89%** (raw CHP points
sum to ≈128.75 of 144 possible, using each split MOD score's midpoint per the baseline's own
convention). **Do not read this as "improvement."** Per the measurement-discipline rule, every point of
this delta is attributable to *named* surfaces, not a portfolio-wide trend:

- `flow-periodicals-two-stage` moved **+2** (1→3, R1) — real, cited improvement.
- `flow-free-tier-rate-limit` moved **-2** (4→2, R5) — a corrected scoring-model gap, not a regression
  in the underlying code (the code did not change).
- `flow-oauth` moved **-1** (4→3) — a re-scope over a new fourth leg, not a regression in the three
  pre-existing legs.
- The twelve newly-registered surfaces average 3.75/4 and, being simply *added* to the denominator
  rather than moved, mechanically pull the average up relative to baseline regardless of any change in
  quality — this is the exact "single severe gap barely moves an unweighted average" distortion the
  baseline itself warned about, now visible in the opposite direction (healthy new surfaces diluting a
  real, still-open Critical defect). The per-surface Trend Ledger below is the primary signal; this
  number is not.

---

## Trend Ledger

Stable ids are carried forward verbatim; no baseline surface is retired (all still exist at HEAD).
Scores are core/happy-path (CHP) and configuration (CFG) on a 0-4 scale, `N/A*` = frozen, justified
not-applicable. Confidence is this run's own honesty check, not a maturity score. Delta is against the
2026-07-17 baseline for carried ids, `new` for this run's registrations.

### MOD surfaces

| id | What it is | CHP | CFG | Confidence | Delta |
|---|---|---|---|---|---|
| `mod-provider-abstraction` | Name→instance registry decoupling provider specifics from render/route surfaces | 4 | N/A* | High | unchanged (Jira is now a 5th registered provider; `lib/providers/index.js` registration barrel, LIN-2010, added — architecture unchanged) |
| `mod-periodicals` | Registry of recurring review templates; two-stage mint/self-conclude contract | 3 | 3 | High | unchanged (registry 14→15 templates, `onboarding-journey` added; `scope` field added, unconsumed by any runtime code — delta line, not a score move) |
| `mod-prompt-template-system` | Deterministic + AI-generated prompt system, shared grounding post-pass | 4 | N/A* | High | unchanged |
| `mod-roadmap-trajectory` | Deterministic velocity/execution-order/milestone layer + narrative pipeline | 3 | 3 | Medium/Low | unchanged (`lib/north-star-resolver.js` rolls in — delta line, not a score move) |
| `mod-render-layer` | ~20+ server-side page renderers, tiered first-class/experimental/power-user | 4 / 2-3 (experimental) | N/A* | Medium | unchanged (`lib/render-templates.js` new public `/templates` page rolls in — delta line; Ship Journey/Passage Planner/task-edit/task-create explicitly registered separately, outside this tier, not double-counted here) |
| `mod-dispatch-queue` | Queue storage + wake propagation, documented schema, TTL, loop guards | 4 | 4 | High | unchanged, cited evidence for no movement — real hardening landed (LIN-1656 duplicate-dispatch guard, LIN-1948 dangling-referent refusal, LIN-1751/2147 `maxTasks` trim, LIN-2297 wake guard); `lib/dispatch-presets-store.js` (LIN-1390/1391) rolls in as new CFG evidence, added after the adversarial second-read caught its omission — see Surface registration section |
| `mod-observation-materializer` | Durable read-model store + materializer; documented best-effort/live-fallback | 3 | N/A* | Medium | unchanged |
| `mod-kpi-audit` | Public KPI aggregation (privacy-boundary'd) + workspace audit report | 4 / 3 (audit) | N/A* | Medium | unchanged (`lib/escalation-kpis.js` rolls in as a new cross-cutting consumer of the decisions lane via `routes/dashboard.js`'s join — delta line, not a score move) |
| `mod-live-console` | Ambient cross-workspace activity feed (status stream + lean loops + timeline/zoom) | 4 | N/A* | Medium | new |
| `mod-scheduler` | Leader-safe CAS-lease job substrate (2 registered jobs: observer-sweep, credential-invariant-sweep) | 4 | N/A* | Medium | new |
| `mod-observer-lane` | Observer signal modules | **2** | N/A* | Medium | new — `lib/observer-efficacy-signal.js` has zero production importers (R8) |
| `mod-ship-journey` | Waypoint-trail derivation + playback view over report history | 4 | N/A* | Medium | new |
| `mod-passage-planner` | Kickoff-prompt copy view (Flight Companion parity) | 4 | N/A* | Medium | new |
| `mod-task-edit` | Dedicated task-edit drill-down (route + renderer + client) | 4 | N/A* | Medium | new |
| `mod-task-create` | Dedicated task-create drill-down (route + renderer + client) | 4 | N/A* | Low/Medium | new |

### API surfaces

| id | What it is | CHP | CFG | Confidence | Delta |
|---|---|---|---|---|---|
| `api-linear-graphql` | Linear GraphQL client + retry/timeout resilience wrapper | 4 | 3 | High | unchanged |
| `api-github-app` | GitHub App install→callback→link flow | 3 | 4 | Medium/High | unchanged |
| `api-openrouter` | LLM client + live model catalog, fail-closed clamps | 4 | 4 | High | unchanged |
| `api-mongodb-storage` | Session/data storage, dual MongoDB/MangoDB backend | 4 | 4 | High | unchanged |
| `api-yap-chat-client` | HTTP client for the experimental Collective's chat server | 3 | 4 | Medium/High | unchanged |
| `api-egress-proxy-fetch` | Outbound HTTP proxy wrapper for corporate proxy environments | 3 | 4 | Medium/High | unchanged |
| `api-workspace-proxy` | Harbour's exposed source-neutral consumer API (`routes/proxy.js`) | 4 | 4 | High | unchanged, cited evidence for no movement — 47→55 routes, differentiated rate limiting, 320 `logEvent` sites, `lib/dispatch-validation.js`; new CFG evidence: `lib/ownerless-token-policy.js`, `lib/dispatch-referent-guard.js` |
| `api-dispatch` | Harbour's exposed Dispatch API (`routes/dispatch.js`) | 4 | 4 | High | unchanged; same new CFG evidence as above, plus the dispatch-presets REST surface (`routes/dispatch.js:1115-1205`, `lib/dispatch-presets-store.js`, LIN-1390/1391/1400) as new CFG evidence, and dispatch-hardening evidence under `mod-dispatch-queue` |
| `api-jira-rest` | Jira Cloud provider — read-only issue/project MVP (LIN-1885/2011/2018) | 4 | 4 | High | new |

### FLOW surfaces

| id | What it is | CHP | CFG | Confidence | Delta |
|---|---|---|---|---|---|
| `flow-dispatch-lifecycle` | queue → take → feedback → terminal-marker detection | 3 | N/A* | High | unchanged — R2, sharper cited evidence (LIN-2079's selection half landed, zero consumers); TTL-is-a-code-constant `N/A*` independently re-verified, not silently carried |
| `flow-followup-resume` | `followUpTo` resume; consumer owns liveness by design | 4 | N/A* | High | unchanged |
| `flow-autopilot-wake` | subscription (`terminal-only`/`everything`) + `waitForFollowUps` up-chain wake | 4 | 3 | Medium | unchanged |
| `flow-oauth` | Linear OAuth, GitHub App install, OpenRouter PKCE, **Jira** — four legs, re-scored | **3** (was 4) | 4 | High | re-scored — 4th leg added; capped by the module's own disclosed "not runtime-verified" caveat (`lib/providers/jira/oauth.js:28-36`), not a regression in the three pre-existing legs |
| `flow-bootstrap-token-exchange` | Single-use bootstrap → working-token exchange | 4 | N/A* | High | unchanged |
| `flow-recap-brief-cache` | Hash-based staleness invalidation for AI recap/brief | 4 | 3 | High | unchanged |
| `flow-free-tier-rate-limit` | Quota check → use → footer display → 429; see R5 | **2** (was 4) | 4 | High | corrected — scoring-model gap (baseline scored structural completeness, not correctness); live defect zero commits since baseline |
| `flow-periodicals-two-stage` | Stage 1 mint-task → Stage 2 run-task self-conclude contract | **3** (was 1) | **2** (was 0) | High | improved — R1; held below 4 by R7 (one-of-two-paths gate) and R9 (unverifiable join key) |
| `flow-account-connection-workspace-credential` | owner-credential-store → refresh → cache → gate; self-checked by `credential-invariant-sweep` | 4 | N/A* | High | new |
| `flow-cost-telemetry` | task-cost/model-pricing/weekly-budget/plan-fee-config lane | 3 | 3 | Medium | new |
| `flow-operator-decisions` | scan → task-decisions-store → unanswered-decisions (joined at `routes/dashboard.js`) → shelved-rulings-store → loop-supersede | 4 | N/A* | High | new |
| `flow-account-merge` | account-conflict → account-merge-log identity-conflict resolution lane, distinct from `flow-oauth` | 4 | N/A* | High | new |

### META surface

| id | What it is | CHP | CFG | Confidence | Delta |
|---|---|---|---|---|---|
| `meta-integration-surface-maturity-review` | This review's own methodology, self-audited every run | **4** (was 3) | N/A* | High | improved — see Self-Audit above |

**N/A justifications.** Carried `N/A*`s (9, unchanged from baseline): pure-compute modules, internal
read-models, design-time TTL constants, and this review's own methodology — none has an environment
surface, and none flipped this run (each independently re-verified, not silently carried). New `N/A*`s
(10, this run): seven are pure feature-flag-gated render/data modules with no environment-configuration
surface (`mod-live-console`, `mod-scheduler`, `mod-observer-lane`, `mod-ship-journey`,
`mod-passage-planner`, `mod-task-edit`, `mod-task-create`); three are pure-application-logic FLOWs with
no environment-config knob identified (`flow-account-connection-workspace-credential`,
`flow-operator-decisions`, `flow-account-merge`). `flow-cost-telemetry` is the one new FLOW that is
**not** `N/A*` — it scores CFG 3, since it has real env-var recalibration seams
(`WEEKLY_BUDGET_CHECKPOINT_PERCENT`/`_AT`, `PLAN_FEE_MONTHLY_USD`). A future run flipping any of these
to a numeric score (e.g. if a currently-constant threshold becomes env-configurable) is itself a
reportable delta, never a silent denominator change.

---

## Ranked recommendations (machine-readable state)

Full set — nine findings, all within the 5-10 headline cap, so nothing is held back in a separate store.

| id | surface | dimension | impact | effort | priority | status |
|---|---|---|---|---|---|---|
| R7 | `flow-periodicals-two-stage` | configuration/enforcement | H | L | 1 | open, new |
| R1 | `flow-periodicals-two-stage` | core/happy-path, configuration | H | M | 2 | open, carried (improved) |
| R5 | `flow-free-tier-rate-limit` | testing (sibling-owned) | H | — | 3 | open, carried (unmoved, corrected score) |
| R2 | `flow-dispatch-lifecycle` | core/happy-path | M | M | 4 | open, carried (unchanged, sharper evidence) |
| R9 | `flow-periodicals-two-stage` | configuration/data-integrity | M | L-M | 5 | open, new |
| R3 | portfolio/META | error handling, resilience, rate limits, idempotency, observability | H | — | 6 | open, carried (unchanged) |
| R8 | portfolio/META | (cross-surface pattern) | M | — | 7 | open, new (trajectory finding) |
| R6 | portfolio/META | (sibling review cadence) | M | — | 8 | open, carried (improved) |
| R4 | MOD (feedback-widget image handling) | security (sibling-owned) | — | — | 9 | **closed/resolved**, carried (retro-correction) |

---

## Plain-language read for the maintainer

The short version: the mechanism this review's own top recommendation was about is now real
machinery — a ledger, a gate, a deleted dead field — and for the first time this review can say whether
its own past advice got taken (mostly yes, on the biggest one). But the review's own backyard is still
where the sharpest finding lives: the very gate meant to stop this task from closing without evidence
only checks one of the two doors a person can walk an issue's state through, and the other one is the
product's normal edit page. That's not a hypothetical — it's the button a human actually clicks.

Two other things worth carrying forward. First, this review caught its own predecessor being wrong: a
security finding it inherited from a stale sibling report had already been fixed three weeks *before*
the first Integration & Surface Maturity review even ran, and nobody had checked. That's the review
doing exactly what it's for — catching a gap nothing else would notice — just aimed at itself instead of
the code this time. Second, a pattern the baseline caught once (a feature landing tested-but-unwired)
turns out to recur — four times in new work, twice more in older code a name-based search couldn't have
found — but it's not one-sided: one of the newer modules exists specifically because someone deliberately
closed a version of this exact risk before it could bite. Worth remembering that both things are true at
once in a codebase this size: some seams get left half-wired, and some team members are actively hunting
for and closing that exact class of gap.

Reliability and Observability reviews still don't exist, six weeks on. Of the five sibling reviews the
baseline flagged as stale, only one (documentation) has been refreshed since. Four other siblings have
been refreshed in the same window, so five of the portfolio's reports are current — but five (security,
API quality, test coverage, dependency/supply-chain, stability) are still sitting at 2026-06-25, and
security is the most consequential of those given two brand-new credential/auth surfaces this run had
to score with no fresh sibling evidence at all.

**If you act on one thing:** close R7 — it's a two-line fix at an existing call site, and it's the gate
this very review is itself subject to. **If you act on two:** progress R5 — `lib/free-tier-store.js` has
now sat with a Critical, unenforced global rate-limit cap through two full review cycles with zero code
changes.

**No follow-up tasks have been created.** This is advisory; the decisions above are the maintainer's.

---

## Adversarial Second-Read

*Filled in after the report draft above was complete, per LIN-2323's structural gate — see the
required Linear comment for the summary the engine reads.*

**Tier used:** Tier 2 — a fresh-context sub-agent, dispatched from within the report-writing session,
carrying no memory of the report-writing turn (a `general-purpose` agent given only the report path,
the baseline path, and the repo location, with instructions to independently inspect the live tree
rather than trust the report's own citations).

**Question posed, verbatim:** *"What is the largest item in this window that this report missed or
misfiled?"*

**Reader's full answer, verbatim:**

> I read both reports, skimmed `CLAUDE.md`, and independently spot-checked the live tree at HEAD
> (`b07c8774`, one commit past the report's stated `292ac962`, which is the report-commit itself —
> consistent with the branch description).
>
> **Verification of the report's own headline claims.** I did not rubber-stamp — I re-derived the
> evidence myself:
>
> - **R7 (Done-gate bypass, `routes/workspace-api.js:3450`).** I grepped every `provider.updateIssue(`
>   call site across `routes/*.js`. There are exactly three: `routes/proxy.js:3487` (gated, confirmed —
>   `checkPeriodicalReportGate`/`extractPeriodicalGateId` imported at `proxy.js:58` and invoked at
>   `:3446-3465`), `routes/proxy.js:3556` (a description-only rewrite inside `applyDescriptionEdit`, no
>   `stateId`, correctly excluded), and `routes/workspace-api.js:3450` (no gate import anywhere in that
>   file, confirmed by grep). The claim "exactly two routes can set a state on an issue... enumerated
>   exhaustively" holds up exactly as written. This is a real, serious, cheap-to-fix finding.
> - **R5 (free-tier double-prefixed key).** I read `lib/free-tier-store.js` directly. `tryUse()` (the
>   only production caller) computes `hourKey = \`global:${this._getHourKey()}\`` then writes to
>   `globalId = \`global:${hourKey}\`` — literally `global:global:<hour>`. The read checks
>   `global:<hour>` (single-prefixed). The correctly-keyed writer, `recordUsage()`, is called only from
>   `routes/test.js:882`. This is exactly what the report claims, verified byte-for-byte — the global
>   hourly cap is genuinely, currently unenforced in production.
> - **R9** (`periodicalId`/`repo` dropped at `formatDispatchWatch`) and **R2** (`listHistory({silentSince})`
>   unconsumed) both checked out against the live tree as described.
>
> Given all four of the report's most load-bearing citations survive independent re-derivation, the
> report is factually careful, not just internally consistent.
>
> **What I found that the report missed.** Diffing `lib/`+`routes/` files added between the baseline
> (`ae00c61b7`) and this run's HEAD (`292ac962`) against everything the report's inventory, folds, and
> rollups account for, one substantial addition is entirely absent from the report:
> **`lib/dispatch-presets-store.js` and its wiring** — "Dispatch Presets," LIN-1390/1391 (5 commits:
> `1cd5e1d5` S1 store, `b64c7ba8` S3 factory routing precedence, `a13880b4` S6+S8 entry
> points/wiring, `935536d4` LIN-1391 authoring/selection UI, `7aa7d9d7` LIN-1400 `byKind` UI). This is
> not a stub — it's a fully production-wired, tested, user-facing feature: a Mongo/Mango-backed CRUD
> store (`list`/`get`/`createCustom`/`update`/`delete`), a full REST surface
> (`GET/POST/PATCH/DELETE /workspace/:urlKey/api/dispatch/presets`), factory-level routing-precedence
> resolution in `lib/dispatch-factory.js` (explicit incoming > selected preset > inherited anchor
> `presetConfig` > workspace defaults), and a client authoring UI. It is imported by `server.js`,
> `routes/dispatch.js`, `routes/proxy.js`, `lib/dispatch-factory.js`, and `lib/render-settings.js`, and
> covered by 6+ unit tests plus an E2E spec.
>
> I grepped the report text for "preset" and for "1390"/"1391" — zero hits. It isn't registered as a
> new id, isn't folded as CFG evidence into `api-dispatch`/`mod-dispatch-queue` (the way the report does
> fold the smaller `lib/ownerless-token-policy.js` and `lib/dispatch-referent-guard.js` into those exact
> two surfaces' CFG evidence this run), isn't in the "~468 commits of new surfaces" discovery list, and
> isn't in the surface-registration disposition table. It is, by any reasonable reading, a
> **configuration mechanism** — the review's own stated exclusive first-party remit — landed squarely
> on the dispatch surface this review already scores. It would not have been caught by the report's own
> R8-style "landed but consumed by nothing" sweep either, since it *is* consumed — it needed the
> complementary check ("is there a new production surface this run hasn't registered yet"), which is
> exactly what the discovery mandate asked for and didn't happen here.
>
> I read the store and factory code closely looking for a functional bug in the same shape as R5's
> double-prefix defect (a plausible place for a second "wired but wrong" instance, since it's new and
> unaudited) — I didn't find one; the code is clean, validated, and tested. So this is a
> coverage/completeness gap in the report, not a live functional defect the maintainer needs to act on
> urgently.
>
> **Secondary, minor note (not the headline miss):** `routes/task-create.js` submits to
> `POST /workspace/:urlKey/api/issues` (create, not update), which is a third code path that can, in
> principle, set an issue's initial `stateId` at creation time with no gate check — if someone crafted a
> create request carrying a Done-type state plus a pre-formed periodical-gate marker in the description,
> it would bypass R7's gate entirely via a different door. This is real but far more theoretical than
> R7 (periodical tasks aren't normally minted through this human-facing form), so I don't think it rises
> to "the largest miss" — I mention it only because the report's own R7 language ("exactly two routes...
> enumerated exhaustively") is true for *updates* but slightly overstates completeness for *state-setting*
> in the broadest sense.

**Adversarial second-read verdict: DISAGREE.** The report's individual findings (R1–R9) are accurate
and well-cited wherever the reader checked. But its explicit completeness claims — "scope was widened,
not narrowed," "12 new ids registered with cited evidence," a "behavior-based sweep... for modules
landed-but-consumed-by-nothing" — were undercut by a real, multi-commit, fully-wired configuration
feature on the review's own home-turf surface (dispatch) that did not appear anywhere in the original
draft.

**Differed from top finding: YES.** The reader's answer (the missing `dispatch-presets-store`
coverage) names something different from the report's own #1-ranked finding (R7, the Done-gate bypass).
The reader independently re-verified R7 and found it accurate and correctly ranked given the checks run
— the disagreement is about a coverage gap elsewhere, not about R7's own validity or priority.

**Disposition: fixed in place.** `lib/dispatch-presets-store.js` (LIN-1390/1391/1400) has been added as
new CFG evidence on `api-dispatch` and `mod-dispatch-queue` in the Surface registration section and in
both surfaces' Trend Ledger delta columns, per the reader's own recommendation (a
citation-completeness fix, not a rescoring — it doesn't move either surface off its existing ceiling of
4). The secondary note on `routes/task-create.js` as a theoretical third state-setting path is recorded
here for the record; it is not folded into R7's own text, since the reader itself judged it
"far more theoretical" and not the largest miss, and this report does not mint a tenth finding for a
theoretical path with no cited exploit and no maintainer action implied beyond what R7 already
recommends.

---

*Surface Assessment: lands cleanly — this is a review-only advisory report; producing it required no
structural change to the codebase, and no code, configuration, or secrets under review were modified.*
