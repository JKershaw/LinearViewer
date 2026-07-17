# Integration & Surface Maturity Review — 2026-07-17

*Advisory, review-only. Periodical: **Integration & Surface Maturity** (LIN-1336; Stage 1 landed
`ae00c61` / PR #920). This is the periodical's **first run** — there is no prior report to diff
against, so this is the **baseline** the next run measures a delta from. Sibling of the Stability
Review (LIN-453) and Recent Headwinds (LIN-542) — the third advisory, portfolio-level periodical.
This report mints no code changes and no follow-up fix-tasks; it hands a maintainer a triageable
maturity read and leaves the decision to them.*

> **Baseline run.** No prior `integration-surface-maturity-review-*.md` exists. Every score below is
> a first observation, not a delta. The **Trend Ledger** near the end of this report is written so the
> *next* run can diff against it mechanically — surface ids are stable and will be carried forward
> (a retired surface is marked retired, never deleted).

**Re-grounding (staleness check).** HEAD at run time is `ae00c61b7` (2026-07-17 09:42:21+01:00) —
the exact merge commit that landed the Stage-1 template (`lib/periodicals.js`,
`tests/unit/periodicals.test.js`, 249/249 passing at HEAD). The ticket's own re-grounding note (its
2026-07-15 plan) already confirmed no drift between its research snapshot and `7495ce9`; nothing in
`lib/periodicals.js` / `tests/unit/periodicals.test.js` has changed since, so Stage 1 is intact and
unmodified by this run, as required.

---

## Scope & method

This review is a **portfolio/meta layer**, not a fourteenth ground-up inspection. Per its own prompt
contract (`lib/periodicals.js:628-653`), it:

- inventories the system using a **MOD / API / FLOW / META** taxonomy;
- scores each surface against **12 maturity dimensions** — core/happy path, error handling,
  resilience, rate limits & pagination, auth & credentials, idempotency & consistency, input & schema
  validation, observability, security, testing, documentation, configuration;
- **prefers existing evidence** (the 11 corrective sibling reviews, prior audits, related tickets)
  over re-deriving findings, and does bounded first-party inspection only where that evidence is
  missing, stale, or shallow — marking confidence **High/Medium/Low** explicitly either way;
- **never re-homes a fix** into a sibling review's territory — it names the owner and stops; and
- treats its own methodology as a **META** surface, self-audited every run.

Its unique first-party remit — the part no sibling review owns — is the **FLOW** surface type
(end-to-end wiring), **core/happy-path completeness**, **configuration**, and the **portfolio/meta
scorecard itself**. Everything else here is aggregation over sibling evidence, clearly marked as such.

**Evidence freshness, up front.** Of the 11 corrective siblings, the five most relevant to this
run's non-first-party dimensions (Security, API Quality, Documentation, Test Coverage Gap,
Dependency & Supply-Chain) are all dated **2026-06-25 — 22 days and 313 commits old** against the
exact `lib/`/`routes/` directories they reviewed, and none has been refreshed since. That staleness
is the single biggest driver of the Medium/Low confidence marks below — it is a property of the
portfolio's review cadence, not of this run's method, and it is itself a finding (see R6).

---

## Headline read

The system's **structural** maturity is genuinely strong: every FLOW this review traced end-to-end
resolves cleanly except one, every MOD/API surface scores 3-4 on core/happy-path, and configuration
discipline is consistently good (documented env vars, safe fail-closed defaults, capability gates).
But the review's own first-party remit — the seams nothing else owns — surfaced the two sharpest
findings in the whole report, and neither would show up in any sibling review because neither is a
single module's problem:

1. **The periodical mechanism that produced this very report has no closed loop.** Stage 2 completion
   (`lastRunAt`, `cadence`) is carried in the data model but written by no code anywhere in the repo
   (`lib/periodicals.js:49`) — a periodical can be minted and never run, forever, with nothing to
   detect it. LIN-1336 itself is the concrete proof: Stage 1 merged, and Stage 2 sat unexecuted until
   a human noticed the ticket was still open. This is a **FLOW** finding about the review family
   itself, which only a portfolio/meta review is positioned to catch.
2. **A dispatched item that is claimed but never fed back has no timeout anywhere.** The queue-side
   24h expiry only covers un-taken items; once `taken`, an item leaves that gated collection and has
   no stuck-session detection at the Harbour layer (the consumer-side reliability bugs Recent
   Headwinds already tracks are a different, downstream layer).

Beyond those two, this run also caught a live example of exactly the failure mode its own **self-audit**
dimension exists to watch for: this review's first-party read of the free-tier rate-limit flow is
"wired end-to-end," while the (stale) Test Coverage Gap review separately found a Critical, still-open
defect in the same code that breaks it functionally. Both are true at once — "wired" is not "correct" —
and that tension is itself the finding (R5).

No Reliability or Observability review exists in the registry yet, so ten of this report's twelve
dimensions have, at best, thin or stale sibling coverage across the whole portfolio. That gap is
named here, as the prompt requires, rather than absorbed or silently scored around.

---

## Findings (priority-ranked)

Ranked by impact × inverse effort, highest first. Impact/Effort are H/M/L. This is advisory — **no
task is minted for any of these**; each is a pointer for a human to triage.

### R1 — `flow-periodicals-two-stage`: Stage-2 completion is entirely unenforced · **Impact: H · Effort: M · named, not new**

*Surface: FLOW · Dimensions: core/happy-path, configuration (both first-party) · Confidence: High*

`lastRunAt` and `cadence` exist on every one of the 14 registry entries (`lib/periodicals.js:702-812`)
but are, by the module's own comment, "carried but not yet consumed (autopilot scheduling remains
deferred)" (`lib/periodicals.js:49`) and "Autopilot is not yet wired to dispatch periodicals" (`:31`).
A repo-wide search finds no writer for `lastRunAt` anywhere outside `lib/periodicals.js` and its own
unit test. Concretely: **Stage 1** (mint a review task) is real, tested code; **Stage 2** (the actual
review + self-conclude) is pure prose inside the minted task's description, with zero code checking it
ever happened. A periodical can be minted, ignored indefinitely, and nothing in the system will surface
that as stale or overdue.

**[LIN-373](https://linear.app/linearviewer/issue/LIN-373)** already owns this exact gap —
"Periodicals cadence: consume cadence/lastRunAt, surface due-state in kickoff": persist `lastRunAt` on
Stage-1 mint, compute due-state against `cadence`, and expose it where the orchestrator already looks,
explicitly with **no new scheduler process** ("the autopilot run *is* the scheduler," per
`docs/autopilot.md:131-135`). LIN-373 also carries a gate: it stays blocked until each periodical has
been run once and its output verified — this Stage-2 run is one of those verifying runs, so the honest
read is not "nobody owns this," it's "LIN-373 owns this, is gated on runs like this one, and that gate
is a loop this report is itself evidence for."

LIN-1336 is the literal proof of the underlying gap: Stage 1 merged 2026-07-15/16, and this Stage-2 run
only happened because a human re-opened the ticket and noticed it was still owed — exactly the failure
mode a closed loop would have caught automatically.

**Action (for a human to weigh):** progress LIN-373 rather than opening a parallel mechanism — its
settled design (no new durable store; due-state computed into the existing kickoff snapshot) is not
something this review has grounds to re-open. The Stage-2 conclude step (or the dispatcher that runs
it) should persist the `lastRunAt` write LIN-373 specifies, and surface overdue periodicals via the
kickoff path it names, not a bespoke renderer signal.

### R2 — `flow-dispatch-lifecycle`: a claimed-but-never-fed-back dispatch item has no timeout · **Impact: M · Effort: M · new (baseline)**

*Surface: FLOW · Dimension: core/happy-path (first-party) · Confidence: High*

Queue-side 24h expiry is real and enforced — `cleanup()` runs hourly from `server.js:2438-2446` and
correctly archives/deletes items past `expiresAt` (`lib/dispatch-store.js:512-540`). But `takeItem`
atomically removes an item from that gated collection the moment a consumer claims it
(`dispatch-store.js:462-493`), and no code anywhere (checked `pipeline-loops.js`,
`observation-sessions-materializer.js`, `session-telemetry.js`) detects a `taken` item that never
posts feedback. Once claimed, an item can sit "running" forever with nothing to reap it — the
consumer-side reliability bugs Recent Headwinds already tracks (LIN-924/946/1059/1165) are a
downstream layer of the same general problem, but this specific Harbour-side gap is distinct and
un-owned by that review.

**Action:** add an age-since-take reaper (mirroring `simple-dispatcher`'s own launch-watchdog
pattern, which exists to solve exactly this class of problem in the sibling project) or surface a
"stuck" state on the Observation feed for a taken item with no feedback past a threshold.

### R3 — Reliability and Observability reviews still don't exist · **Impact: H (portfolio-wide) · Effort: — (not this review's to mint) · named, not new**

*Surface: META / portfolio · Confidence: High*

`lib/periodicals.js` names both **Reliability** and **Observability** as the owning reviews for
error handling, resilience, rate limits/pagination, idempotency/consistency (Reliability) and
whether a gap is visible or observable (Observability) at six locations
(`:538-539, :561, :618, :643, :677-678, :691`), and `tests/unit/periodicals.test.js:794-801,906-907`
pins those names into the prompt text. Neither exists in the 14-entry registry, and no
`docs/reviews/reliability-*` or `observability-*` report has ever been produced. That leaves **five of
this review's twelve dimensions** — error handling, resilience, rate limits & pagination, and
idempotency & consistency (Reliability's remit), plus observability (Observability's remit) — with no
dedicated, systematic owner anywhere in the portfolio. The other five dimensions this pair of missing
reviews would otherwise touch (auth & credentials, security, input & schema validation, testing,
documentation) *do* have dedicated owners — Security, API Quality, Test Coverage Gap, Documentation —
so their evidence isn't incidental, only 22 days stale (see R6). Combined, that's the headline above:
ten of twelve dimensions have, at best, thin or stale sibling coverage — five genuinely unowned, five
owned but stale. This review does not build the missing two (out of remit, and explicitly not this
review's job per its own contract) — it names the gap, as instructed, so it stops being silently
absorbed or forgotten.

### R4 — Security H1 (stored XSS in the feedback-widget image proxy) is 22 days stale with no confirmed fix · **Impact: M · Effort: — (Security Review's to re-run) · sibling-owned, cited only**

*Surface: MOD (feedback-widget image handling, `routes/workspace-api.js:210-244,1989`) ·
Dimension: security (sibling-owned — Security Review, LIN-453's sibling series) · Confidence:
Medium (report is sound but unrefreshed)*

The 2026-06-25 Security Review's highest-severity live finding — a same-origin image-proxy path that
allows stored XSS via a crafted SVG upload — has not been re-verified against the 313 commits that
have since touched `lib/`/`routes/`. This review does not re-derive that finding (altitude
discipline); it flags that the sibling report itself is old enough that its fix status is unknown,
and recommends a refresh before the next Integration & Surface Maturity run.

### R5 — A live example of the self-audit's own reason to exist: `flow-free-tier-rate-limit` scores 4/4 structurally, but a Critical defect makes it wrong functionally · **Impact: M · Effort: — (Test Coverage Gap's to confirm) · sibling-owned, cited only**

*Surface: FLOW (`lib/free-tier-store.js`) · Dimension: testing (sibling-owned — Test Coverage Gap
Review) · Confidence: Medium*

This review's own first-party trace of the free-tier flow (quota check → atomic increment → footer
display → 429 response) found every stage genuinely wired (`lib/free-tier-store.js:165-194`, 10+
call sites in `routes/workspace-api.js`, footer rendering in `lib/components/footer.js:81-82`) and
scored its core/happy-path a clean 4. Independently, the (stale, unrefreshed) Test Coverage Gap
review found a **Critical, still-open** defect in the same file — a double-prefixed Mongo key at
`free-tier-store.js:148-149,197-198` that leaves the **global hourly** cap unenforced, with 0% test
coverage on that exact path. Both reads are correct at their own altitude: the flow is structurally
complete, and it is functionally broken. This is precisely the scoring-model gap this review's
self-audit bullet asks it to watch for (see META below) — flagged here as its first live instance,
not re-derived as a fresh testing finding (that stays Test Coverage Gap's territory).

### R6 — Most sibling evidence this portfolio leans on is uniformly ~3 weeks stale, and none has been refreshed · **Impact: M (portfolio-wide legibility) · Effort: — (scheduling call) · named, not new**

*Surface: META / portfolio · Confidence: High*

Security, API Quality, Documentation, Test Coverage Gap, and Dependency & Supply-Chain are all dated
2026-06-25, 22 days and 313 `lib/`/`routes/` commits behind HEAD, with zero refreshes since. Nearly
every Medium/Low confidence mark in this report traces to that staleness rather than to a genuine
absence of maturity — including one already-observed miss (API Quality's H3 finding cited a CLI file
that was deleted six days after that report shipped, per the Documentation review). Recommending a
refresh of the five stale correctives before the next Integration & Surface Maturity run would let
that *second* run show a real trend instead of re-reporting "confidence: stale" across most of the
portfolio.

---

## Surface inventory

25 surfaces catalogued this run (8 MOD, 8 API, 8 FLOW, 1 META). Full scores are in the **Trend
Ledger** below; this section gives the narrative read per category.

**MOD** — structural modules score consistently well on core/happy-path (3-4 across all eight): the
provider abstraction, prompt-template system, dispatch queue/wake, and KPI/audit layers are all
High-confidence 4s with concrete capability-gate/fail-closed/dedicated-test evidence. The two softer
spots are `mod-roadmap-trajectory` (Medium/Low confidence — a footer-gated power-user surface that
got a lighter first-party pass) and `mod-observation-materializer`, whose own documentation names an
explicit graceful-degrade ("a failure here must never affect the dispatch/status write it rode in
on") with a live-rebuild fallback as the correctness backstop — a documented, deliberate design, not
a gap.

**API** — every integration and every surface Harbour itself exposes (the Workspace API Proxy, the
Dispatch API) scores 4/4 on core/happy-path with High confidence: retry/timeout discipline
(`lib/linear-fetch.js`), fail-closed model clamps (`lib/openrouter.js`), a single shared missing-
config gate for the GitHub App flow, and rate-limiting that matches its own documentation exactly.
Configuration discipline is the strongest-scoring dimension in this whole report — nearly every
surface that has a configuration surface at all scores 4, with documented env vars and safe
unset-defaults.

**FLOW** — this review's home turf, and where the real findings are (R1, R2). Six of eight flows
traced end-to-end resolve cleanly at 4/4: follow-up/resume, the OAuth trio, bootstrap-token exchange,
recap/brief cache invalidation, and (structurally) free-tier rate-limiting. `flow-dispatch-lifecycle`
lands at 3/4 for the taken-item gap (R2), and `flow-periodicals-two-stage` is the one genuine low
score in the report — 1/4 core, 0/4 configuration (R1).

**META** — see Self-Audit below.

---

## Sibling-owned dimension coverage

Per-dimension, not per-surface: this review does not fabricate a score for every surface × dimension
cell where no sibling evidence exists. Where a specific finding maps to a surface in this inventory
it's cited; where it doesn't, that's stated plainly rather than guessed.

| Dimension | Owning review | Status | Confidence | What's known this run |
|---|---|---|---|---|
| Auth & credentials | Security Review | 2026-06-25, 22d stale | Medium | Tenant/workspace isolation clean; M1 GitHub OAuth over-scoped (`providers/github/index.js:345`); carried `SESSION_SECRET` fail-open default (LIN-619, still live) |
| Security | Security Review | 2026-06-25, 22d stale | Medium | H1 stored-XSS unconfirmed fixed (R4); M2 SSRF allowlist has no DNS-rebind guard; M3 feedback endpoint unrate-limited |
| Input & schema validation | API Quality Review | 2026-06-25, 22d stale | Medium | Rated clean on trust boundaries at the time; one finding (H3) already known-stale (file deleted 6 days later) |
| Testing | Test Coverage Gap Review | 2026-06-25, 22d stale, BASELINE | Low-Medium | 82.80% line coverage; **Critical**, still-open free-tier defect (R5); High: `dispatch-tokens.js` (auth boundary) 0% covered |
| Documentation | Documentation Review | 2026-06-25, 22d stale | Medium | GitHub-auth surface was undocumented at the time (since closed per CLAUDE.md's current GitHub App section — spot-checked as part of this run and now present); periodicals.js stale-count prose (LIN-687) since fixed inline in the same PR that landed this review |
| Error handling | **Reliability — not yet built** | no report exists | — | Only incidental coverage via API Quality (M1/M2/M4 error-envelope/status-code findings) — no systematic pass |
| Resilience | **Reliability — not yet built** | no report exists | — | No dedicated review; this run's own FLOW traces found real retry/backoff/fail-closed patterns (`lib/linear-fetch.js`, `lib/openrouter-catalog.js`) but that was incidental to core/happy-path scoring, not a resilience-dimension pass |
| Rate limits & pagination | **Reliability — not yet built** | no report exists | — | API Quality's L4 (proxy `/search` ignores `limit`) is the only known finding; no systematic pass |
| Idempotency & consistency | **Reliability — not yet built** | no report exists | — | API Quality's M3 (dispatch `take` not retry-safe) is the only known finding; no systematic pass |
| Observability | **Observability — not yet built** | no report exists | — | No dedicated review anywhere in the portfolio |

Named explicitly per the contract: **Reliability** and **Observability** are the natural home for
deeper follow-up on the five dimension-rows above with no owning review — this report mints nothing
into that territory.

---

## Self-Audit — META surface

*Surface: META (`meta-integration-surface-maturity-review`) · Dimensions: core/happy-path = **3**
(produced a real, evidence-cited baseline inventory with honest confidence marking; did not — by
design — force a score into every sibling-owned cell) · configuration = **N/A** (a review
methodology has no environment-configuration surface; frozen, justified)*

Required self-checks this run:

- **How many surfaces are stuck at Low confidence, and why?** One surface scored outright Low
  (`mod-roadmap-trajectory`, configuration) and roughly six others carry Medium confidence with the
  research pass explicitly disclosing "skimmed, not deeply read" rather than defaulting to High. That
  is the confidence-marking discipline behaving as designed, not a failure — but it does mean this
  baseline's structural-maturity read is more solid than its resilience/observability read, which
  rests almost entirely on 22-day-old sibling evidence (see R6).
- **Did a real finding elsewhere hit a surface this review had rated as done?** Yes — R5. This
  review's own first-party core/happy-path score for `flow-free-tier-rate-limit` was a clean 4
  (structurally correct), while the Test Coverage Gap review independently found a live Critical
  defect in the exact same code. Recorded as a scoring-model gap: "wired end-to-end" and "functionally
  correct" are different claims, and this report should be read as making the first claim, not the
  second, wherever a sibling dimension hasn't independently confirmed the latter.
- **Is any dimension consistently N/A (dead weight) or consistently 0 (unmeasurable)?** Configuration
  is N/A for 9 of 25 surfaces (pure-compute modules, pure in-process flows, and the review's own
  methodology, all with no environment surface — `mod-provider-abstraction`,
  `mod-prompt-template-system`, `mod-render-layer`, `mod-kpi-audit`, `mod-observation-materializer`,
  `flow-dispatch-lifecycle`, `flow-followup-resume`, `flow-bootstrap-token-exchange`,
  `meta-integration-surface-maturity-review`) — checked and it's a legitimate architectural pattern
  (deterministic modules genuinely have no env surface to score), not dead weight to prune. No
  dimension scored 0 across more than one surface; the single 0 (`flow-periodicals-two-stage`
  configuration) is isolated, not systemic.
- **Are past top recommendations getting acted on?** Not applicable — this is the baseline run; there
  is no prior recommendation set to check. The next run should answer this question directly against
  R1-R6 above.

---

## Completeness % (secondary, noisy — read with care)

Portfolio core/happy-path average across all 24 non-META surfaces: **≈88%** (raw scores sum to
84.75/96 possible points: the 22 unsplit rows sum to 78, plus the midpoint of each split MOD score —
`mod-render-layer`'s 4 / (2-3) → 3.25, `mod-kpi-audit`'s 4 / 3 → 3.5). **This number is
explicitly noisy and is reported only as a secondary signal, never as the outcome:** it is an
unweighted average that treats `flow-periodicals-two-stage`'s 1/4 identically to
`api-workspace-proxy`'s 4/4, so a single severe FLOW gap barely moves it. The primary signal for this
run is the per-surface ledger below and the six named findings above — not this percentage. No
delta is reported (baseline run); the next run's Completeness % must be read against which specific
surfaces moved, per the measurement-discipline bullet, never as a bare number.

---

## Trend Ledger

Baseline run — every row's delta is **n/a (baseline)**. Stable ids below are carried forward
verbatim by the next run; a retired surface is marked retired here, never deleted. Scores are
core/happy-path (CHP) and configuration (CFG) on a 0-4 scale, `N/A*` = frozen, justified not-applicable.
Confidence is this run's own honesty check, not a maturity score.

### MOD surfaces

| id | What it is | CHP | CFG | Confidence | Delta |
|---|---|---|---|---|---|
| `mod-provider-abstraction` | Name→instance registry decoupling Linear specifics from render/route surfaces | 4 | N/A* (pure in-memory registry) | High | n/a (baseline) |
| `mod-periodicals` | Registry of 14 recurring review templates; two-stage mint/self-conclude contract | 3 | 3 | High | n/a (baseline) |
| `mod-prompt-template-system` | Deterministic + AI-generated prompt system, shared grounding post-pass | 4 | N/A* (pure compute/template) | High | n/a (baseline) |
| `mod-roadmap-trajectory` | Deterministic velocity/execution-order/milestone layer + narrative pipeline | 3 | 3 | Medium/Low | n/a (baseline) |
| `mod-render-layer` | ~20 server-side page renderers, tiered first-class/experimental/power-user | 4 / 2-3 (experimental) | N/A* (pure templating) | Medium | n/a (baseline) |
| `mod-dispatch-queue` | Queue storage + wake propagation, documented schema, TTL, loop guards | 4 | 4 | High | n/a (baseline) |
| `mod-observation-materializer` | Durable read-model store + materializer; documented best-effort/live-fallback | 3 | N/A* (internal read-model, no env) | Medium | n/a (baseline) |
| `mod-kpi-audit` | Public KPI aggregation (privacy-boundary'd) + workspace audit report | 4 / 3 (audit) | N/A* (pure aggregation) | Medium | n/a (baseline) |

### API surfaces

| id | What it is | CHP | CFG | Confidence | Delta |
|---|---|---|---|---|---|
| `api-linear-graphql` | Linear GraphQL client + retry/timeout resilience wrapper | 4 | 3 | High | n/a (baseline) |
| `api-github-app` | GitHub App install→callback→link flow | 3 | 4 | Medium/High | n/a (baseline) |
| `api-openrouter` | LLM client + live model catalog, fail-closed clamps | 4 | 4 | High | n/a (baseline) |
| `api-mongodb-storage` | Session/data storage, dual MongoDB/MangoDB backend | 4 | 4 | High | n/a (baseline) |
| `api-yap-chat-client` | HTTP client for the experimental Collective's chat server | 3 | 4 | Medium/High | n/a (baseline) |
| `api-egress-proxy-fetch` | Outbound HTTP proxy wrapper for corporate proxy environments | 3 | 4 | Medium/High | n/a (baseline) |
| `api-workspace-proxy` | Harbour's exposed source-neutral consumer API (`routes/proxy.js`) | 4 | 4 | High | n/a (baseline) |
| `api-dispatch` | Harbour's exposed Dispatch API (`routes/dispatch.js`) | 4 | 4 | High | n/a (baseline) |

### FLOW surfaces

| id | What it is | CHP | CFG | Confidence | Delta |
|---|---|---|---|---|---|
| `flow-dispatch-lifecycle` | queue → take → feedback → terminal-marker detection | 3 (R2: taken-item timeout gap) | N/A* (TTL is a code constant) | High | n/a (baseline) |
| `flow-followup-resume` | `followUpTo` resume; consumer owns liveness by design | 4 | N/A* | High | n/a (baseline) |
| `flow-autopilot-wake` | subscription (`terminal-only`/`everything`) + `waitForFollowUps` up-chain wake | 4 | 3 | Medium | n/a (baseline) |
| `flow-oauth` | Linear OAuth, GitHub App install, OpenRouter PKCE — all three traced end-to-end | 4 | 4 | High | n/a (baseline) |
| `flow-bootstrap-token-exchange` | Single-use bootstrap → working-token exchange | 4 | N/A* (TTL is a code constant) | High | n/a (baseline) |
| `flow-recap-brief-cache` | Hash-based staleness invalidation for AI recap/brief | 4 | 3 | High | n/a (baseline) |
| `flow-free-tier-rate-limit` | Quota check → use → footer display → 429; see R5 caveat | 4 (structural; see R5) | 4 | High | n/a (baseline) |
| `flow-periodicals-two-stage` | Stage 1 mint-task → Stage 2 run-task self-conclude contract | **1** (R1) | **0** (R1) | High | n/a (baseline) |

### META surface

| id | What it is | CHP | CFG | Confidence | Delta |
|---|---|---|---|---|---|
| `meta-integration-surface-maturity-review` | This review's own methodology, self-audited every run | 3 | N/A* (a methodology has no env surface) | High | n/a (baseline) |

**N/A justifications (frozen this run):** every `N/A*` above is a pure-compute module, an internal
read-model, a design-time TTL constant, or a methodology — none has an environment-configuration
surface to score. A future run flipping any of these to a numeric score (e.g. if a TTL becomes
env-configurable) is itself a reportable delta, not a silent denominator change.

---

## Plain-language read for the maintainer

The short version: the plumbing is in good shape, but the two places this review is uniquely
positioned to check — the seams nothing else owns — are exactly where the real findings are.

The system's individual pieces are solid. Every integration this review traced (Linear, GitHub,
OpenRouter, the two storage backends, the chat client, the outbound proxy) works end-to-end with
sensible defaults and fails closed rather than open. Configuration is a genuine strength across the
board — environment variables are documented, unset ones degrade safely, and nothing needs an
operator to get a setting exactly right just to boot. Most of the cross-module flows this review
checked — sign-in, resuming a paused agent session, exchanging a one-time credential for a working
one, keeping a cached AI summary fresh — are all wired correctly from one end to the other.

Two things aren't, and they're both in this review's own backyard. First: the mechanism that runs
**this very review** has no way of knowing whether it ran. The two fields meant to track "when did
this periodical last execute" exist in the data model and are never written by any code — so a
periodical can be minted and simply never get around to, forever, with nothing anywhere flagging it
as overdue. This report only exists because a human happened to notice the ticket for it was still
open. Second: once an AI agent picks up a piece of dispatched work, there's no timeout if it never
reports back — the 24-hour queue expiry only protects work that's still *waiting* to be picked up, not
work that's already been claimed.

One more thing worth flagging, because it's a good example of why a portfolio-level check like this
one is useful: this review found the free-tier usage limiter to be correctly wired end-to-end, while
a separate, older review found a live bug in the exact same code that breaks the site-wide hourly
cap. Both are true — the plumbing is connected, and it's still broken — and that's a useful reminder
not to read "wired" as "working" anywhere in this report either.

Finally, two review types this codebase clearly wants — one for reliability (timeouts, retries,
handling failure gracefully) and one for observability (can you tell when something's wrong) — have
been named as future work for over three weeks but still don't exist. Ten of this review's twelve
scoring categories lean on those two, so until they're built, this portfolio's read on "does it fail
gracefully" and "can you see when it doesn't" will stay thin no matter how many times this review
runs.

**If you act on one thing:** close the loop on the periodical mechanism itself (Stage 2 completion
tracking) — it's this review's own reliability, and the fix is small. **If you act on two:** the five
stale sibling reviews (Security, API Quality, Documentation, Test Coverage Gap, Dependency &
Supply-Chain) are all three weeks old against 313 commits of change; refreshing them before the next
run of this review would let it show a real trend instead of re-reporting "stale" across most of the
portfolio.

**No follow-up tasks have been created.** This is advisory; the decisions above are the maintainer's.

---

*Surface Assessment: lands cleanly — this is a review-only advisory report; producing it required no
structural change to the codebase, and `buildPeriodicalScaffold`/`periodicalBullet.*` were read but
not modified.*
