# Recent Headwinds Review — 2026-08-23 (advisory, trend-framed vs 2026-08-03)

> **Provenance note (LIN-694).** This report was persisted retroactively on 2026-08-23. The
> review itself ran the same day, under session `voyage-advisory-reviews-2026-08-23`, but a
> conflicting operator instruction ("do NOT edit, create, or delete any file in either repo")
> prevented the file from being written at the time — the review instead posted its full
> report as a Linear comment on **LIN-1918**, exactly as its own text below anticipated
> ("A future lane should commit this comment verbatim to that path"). This file is that
> verbatim commit. Nothing below has been re-derived, re-judged, or edited for content.

*Advisory, review-only. Periodical LIN-542. No code, config or secrets changed; no fix-tasks minted.*

**Session:** `voyage-advisory-reviews-2026-08-23`, dispatch `b10e7590-611a-4de6-949d-b46205723aaf`.

**Grounding.** `LinearViewer` @ `0e8a1461` (= `origin/main`, 2026-08-23 17:42 BST) · `simple-dispatcher` @ `05751b28` (= `origin/main`). **HEAD moved under this run** — sibling lanes landed `#1211`–`#1214` between dispatch (17:05) and the read. Every figure below is at those two SHAs.

**Report location.** The series convention is `docs/reviews/recent-headwinds-review-YYYY-MM-DD.md`. This run was dispatched under a **hard no-file-write constraint** (six sibling lanes through this repo today, two live in it now), so per LIN-1918's own fallback — *"if no report location convention exists, put the full report in the closing comment"* — the report is **here, in full**, and the file is deliberately not written. **Unrun, and named as such:** landing `docs/reviews/recent-headwinds-review-2026-08-23.md`. A future lane should commit this comment verbatim to that path.

**Prior run read in full**, including its *Withdrawn claim* and *What this review could not measure*: `docs/reviews/recent-headwinds-review-2026-08-03.md` (237 lines, PR #1072, `838aa431`).

---

## Method and its limits, stated first

- **Delivery/composition**: `node scripts/delivery-composition.mjs --since 2026-05-25`, both repos, `--first-parent` mainline units as the merge-invariant substrate. The 08-03 A/B windows **reproduce exactly** at this HEAD (A tickets 115.25 vs 115.3; A mainline 135.5 vs 135.5; B mainline 85.25 vs 85.3) — the instrument is stable and the prior numbers were not stale.
- **Raw commit counts are still not comparable across 2026-06/07** and are not used for any trajectory call here.
- **The interval is 20 days**, two full weeks past the last complete window. Weekly aggregates are thin. Where a call rests on <3 weeks I say *too early to call* rather than manufacture a movement.
- **Bases are never mixed.** Every cross-window comparison is per-repo.
- **Not re-derived here**: convergence (Stability Review, LIN-453 owns it); structure (Code Quality / Drift & Coherence / Documentation / API Quality); the north star itself (consumed, never rewritten).
- **Could not measure**: agent effort before ~24 July (30-day telemetry TTL, unchanged since 08-03); the cost of tickets that produce no commit; whether anything is late (still **0 tasks with a due date** — every reading is flow health, never schedule health).

---

# Headwinds, severity-ranked

## H1 — The headline metric stopped counting most of what ships, and says its coverage is complete · **critical · new**

**What.** On 2026-08-23 the workspace switched to multi-ticket **worker lanes** (W0–W8; `LIN-2242: codify the worker-lane kickoff as a first-class prompt`, `be892965`). One dispatched session now delivers several tickets. The cost substrate was built for one-ticket-one-lineage and has not followed.

Measured over every ticket whose first citing mainline commit landed 2026-08-23 (n = 33):

| | |
|---|---|
| tickets landed | **33** |
| tickets with **zero** dispatch lineage | **23 (70%)** |
| total attributed spend | **$478.85** |
| $ / ticket landed | **$14.51** |
| $ / *dispatched anchor* ticket (n=10) | **$47.88** |
| $ / ticket, per-ticket-chain style (21 Aug, LIN-2179) | **$50.71** over 10 sessions |

All 23 zero-lineage tickets return, from `GET /api/proxy/cost/{id}`:

```
totalUsd: 0,  workerSessions: [],  unpriced: [],  noTelemetryCount: 0
```

`unpriced: []` **and** `noTelemetryCount: 0` is the instrument asserting *complete pricing coverage* for a ticket it has no telemetry for at all. Spot-checked: `GET /api/proxy/dispatch?issueIdentifier=LIN-2216` returns **zero rows**, yet LIN-2216 landed as `77698407` (#1211) today.

The `/kpis` card is affected differently and no less seriously. `lib/terminal-marked-task-cost.js:258` sets the denominator `const T = issues.size`, where `issues` is populated **only** from `lineage.issueIdentifier` (`:229`–`:235`). A ticket delivered inside another ticket's lane has no lineage, so it never enters `T`. The card is therefore **cost per dispatched-and-terminal-marked issue**, not cost per delivered task — and today those diverged by 3.3×.

**Why it matters.** The north star names *cost per verified task, visible and falling* as the metric by which routing, plan-review and re-grounding economy are judged **alone**. Adopting lanes makes that number fall ~3.3× with no efficiency change whatsoever, because the denominator shed 70% of delivery. The next cycle's forecast-vs-actual scoring will be run against a number that moved for a reason nobody chose. None of the three published disclosures catches it: `pricedLineageShare`, `attributableLineageShare` and `captureRateShare` (LIN-1959, landed today) all have **lineage** denominators — they measure lineages that ran without usage, never *tickets that shipped without a lineage*. This is the north star's own "silent failures and detection gaps outrank feature work" turned on the headline metric.

**What I would do.**
1. In `GET /api/proxy/cost/{id}`, distinguish *no lineage found* from *lineage found and priced at zero*. A ticket with no lineage must not return `noTelemetryCount: 0` — that field currently means "no lineage had missing telemetry", vacuously true over an empty set. One-line class of fix: set `noTelemetryCount` to 1 (or add `hasLineage: false`) when `workerSessions` is empty.
2. Publish a **ticket-level** coverage share beside the existing lineage-level ones: `issuesWithLineage ÷ issuesReachingCodeInWindow`. Today that reads 10/33 = 30%.
3. Decide and record whether lane-delivered tickets should attribute a share of their anchor's spend, or be excluded with the exclusion *published*. Either is defensible; silently reading 30% coverage as 100% is not.

**Confidence: verified at HEAD.** Reproduce: `for t in $(git log --first-parent --since='2026-08-22 23:00' --pretty=%s | grep -oE 'LIN-[0-9]+' | sort -u); do curl -s "$BASE/api/proxy/cost/$t"; done`; denominator at `lib/terminal-marked-task-cost.js:258`.

---

## H2 — Harbour is steering by a north star that was superseded 23 days ago · **critical · new**

**What.** `docs/north-star.md:1` at HEAD reads **"North star — v2, the self-funding loop"** (committed `619366bc`, LIN-1647, 2026-07-31). `GET /api/proxy/north-star` serves **v1**, and says so in its own first line.

The served text is not a paraphrase — it is missing **two entire clauses of eight** and material inside two more:

| v2 clause (`docs/north-star.md`) | served by the proxy |
|---|---|
| `:13` **"Gates buy evidence, never delay… not a calendar habit: shorten a gate by densifying evidence, never by waiving it."** | **absent entirely** |
| `:11` "No autonomous run starts without a declared task budget, enforced at the seam"; "**wakes** per verified task" as a tracked tax | absent |
| `:9` "in the money actually spent… **cash** the operator feels is the headline, API-equivalent keeps it honest"; "pricing is policy, never judgement" | absent |
| `:17` "the **free tier is a published line item**… payments land only behind the hardening gate" | absent |
| `:5` headline: "…**funds itself doing it** — and proves every word" | reads "…— and proves it" |

The cause is structural, not a stale cache: `lib/north-star-resolver.js:15-32` resolves the north star from `userPreferencesStore.getUserPreferences(creatorId).northStarByWorkspace[urlKey]` — a **hand-typed durable string per account**, written through `PUT /workspace/:urlKey/api/roadmap/north-star` (`routes/workspace-api.js:3640`). There is no link of any kind between that string and `docs/north-star.md`. When the operator revised the document, nothing re-pasted it, and nothing compares the two.

**Why it matters.** This review is required to *consume* the direction layer's alignment classification rather than re-derive it. That classification is computed against v1 — `GET /api/proxy/north-star` returns `reading.state: "fresh"`, and the reading enumerates v1's scorable phrases with no mention of self-funding, cash cost, task budgets or gate economics. So does `/next-run`'s alignment ranking (`routes/next-run.js:219-222`, which reads the same stored string). **Every alignment judgement made since 2026-07-31 scored work against a destination the operator had already replaced** — and the reading reports itself *fresh*, which is what makes this a detection gap rather than a known limitation.

The consequence is not abstract, and it is visible in this very review: the missing `:13` clause — *"not a calendar habit: shorten a gate by densifying evidence, never by waiving it"* — is precisely the standard that H4 below (a gate deferred by a **date marker** to 2026-08-25) would be measured against. The direction layer structurally cannot flag it, because that sentence is not in the north star Harbour serves.

**What I would do.** Either (a) resolve the north star from `docs/north-star.md` at HEAD with the stored string as an override, or — much cheaper, and enough to close the detection gap — (b) add a startup/periodic assertion that compares the stored string's first line against `docs/north-star.md:1` and raises a fault when the version tokens differ. (b) is the north star's own prescription: a halt the system didn't report costs more than the halt. Until either lands, the immediate one-line fix is to re-paste v2 through `PUT /workspace/:urlKey/api/roadmap/north-star` — which fixes today and does not stop it recurring at v3.

**Confidence: verified at HEAD.** `docs/north-star.md:1,5,9,11,13,17` vs `GET $BASE/api/proxy/north-star`; resolver at `lib/north-star-resolver.js:15-32`.

---

## H3 — `periodical-cadence` did not recover; the ledger measured a dispatch, not a review · **critical · unchanged in fact, worsened in confidence**

*Carried forward verbatim from 08-03, where it was `critical, new`.*

**What.** 08-03 recorded *"ten of fifteen periodicals read `never`"*. At HEAD, `GET /api/proxy/periodicals` returns **ten of fifteen still `never`** — `test-coverage-gap`, `security-review`, `api-quality`, `comprehension-debt`, `stability-review`, `dependency-supply-chain`, `performance-scale`, `data-fetch-architecture`, `integration-surface-maturity`, `onboarding-journey`. Identical count, identical membership class.

The five that are not `never` all read `lastDispatchedAt: 2026-08-07T22:32:55Z`, `daysSince: 15`, `state: due`. That timestamp is the run that **minted** LIN-1918/1920/1922/1924 (created `2026-08-07T22:25:08Z`) — and all four sat in `Todo` with **zero comments** for sixteen days, until this session claimed them. No review ran. No report landed: `docs/reviews/` has no entry after `2026-08-15`, and none in this series after `2026-08-03`.

So 08-03 was **a one-off restart, and even the restart only reached dispatch.** The open question that run left is now answered: cadence has not recovered.

**The ledger cannot tell the difference, by construction.** `lib/periodical-runs.js:228` accepts a history row as run-evidence when `row.status === 'taken'` — and `taken` means *a runner claimed it* (`lib/dispatch-store.js:803`, `_archiveItem(doc, 'taken'|'expired'|'cancelled')`). A dispatch that is claimed and then produces nothing resets the cadence clock for a full week. That is exactly what 2026-08-07 did to five templates.

**And this run will not register either.** `_resolveTemplateForRow` (`lib/periodical-runs.js:116-123`) matches on `periodicalId`, falling back to an exact title match (or `"<title> + Autopilot"`). This session's dispatch row carries `periodicalId: null` and `promptName: "W8 advisory reviews — overdue periodicals"`, which matches no template title. **After all four reviews in this batch complete, all four will still read `due` at `2026-08-07`.** The one run that actually produced reports is the one the ledger will not see.

**Why it matters.** The instrument that exists to detect the review layer going quiet reports *recent* for a dispatch that produced nothing, and *due* for a review that produced everything. Its signal is inverted at both ends. 08-03 rated cadence critical *"not because delivery fell, but because nothing noticed for 25 days"* — the same sentence holds today, with the added fact that the thing built to notice cannot.

**What I would do.**
1. Stamp `periodicalId` on batch/lane dispatches that run a periodical — or accept a `periodicalIds: []` array on one dispatch row. Without it, batching reviews makes them invisible to their own ledger.
2. Gate run-evidence on a **terminal `[done]` marker** (`deriveTerminalStatus`, `lib/dispatch-terminal.js:99` — already exists and is already used by `routes/dashboard.js:167`) rather than on `status === 'taken'`. One-line class of change at `lib/periodical-runs.js:228`.

**Confidence: verified at HEAD** for the counts, the timestamps, the ticket states and the two code paths. The claim that this run will not register is **a derivation from `_resolveTemplateForRow`, not an observation** — I have not watched it archive.

---

## H4 — `gate-falsification`: no longer "un-run". It is deferred, by a date · **high · movement to grade (was `unchanged`)**

08-03 recorded LIN-1661 as *"still Todo"* and asked whether it had been deferred rather than merely un-run. **It has been deferred, deliberately and on the record.** Its title is now `[not before 2026-08-25] Re-read the follow-on ratio one cycle after LIN-1600 lands`, and a ruling by John dated 2026-08-04 on the ticket confirms: *"The 25 Aug read still happens. Do not move the boundary earlier."* The stated reason is sound — the baseline is a half-open 30-day window (`2026-06-26 → 2026-07-26`) and a shorter after-window is not comparable.

Two things to grade, though, that the deferral itself surfaced:

1. **The deferral leaked into a change freeze that cost five tickets.** The same ruling records that an informal *"no prompt-template changes before 2026-08-25"* rule *"was never part of this ticket… a protective inference added 2026-08-03 alongside the `[not before 2026-08-25]` title marker, and it hardened into a constraint blocking five tickets (LIN-1694, LIN-1731, LIN-1717, LIN-1408, LIN-1455) through LIN-1871."* Those are **four of the five tickets 08-03 named as its H5 parked cohort.** 08-03 attributed that cohort to plan-review enumeration non-convergence. That attribution is now **partly superseded**: a substantial part of it was a self-imposed freeze inferred from a date marker, and it was lifted on 2026-08-04. Recorded as a supersession, not a silent correction — see the supersession block at the end.
2. **A date-gated gate is what v2 `:13` forbids** — *"not a calendar habit: shorten a gate by densifying evidence, never by waiving it."* This is not a contradiction of John's ruling, which protects window comparability (an evidence argument, not a calendar one). It is an observation that the *instrument* cannot check it, per H2.

**Status: the central open question of 08-03 remains open, now with a date on it — 2026-08-25, two days out.** Nothing here should be read as pressure to move it.

**Confidence: verified at HEAD** (LIN-1661 title + 2026-08-04 comment; LIN-1694 and LIN-1731 now `Done`, LIN-1717 and LIN-1408 still `Todo`).

---

## H5 — Throughput fell again, but the *intensity* of delivery has stopped falling · **high · improved (LinearViewer) / worsened (simple-dispatcher)**

08-03's headline was `delivery-throughput` **inverted**: 115.3 → 69.8 tickets/wk, 135.5 → 85.3 mainline/wk. Both reproduce exactly at this HEAD. The new window continues down, and the naive read is another −37%:

| substrate (LinearViewer + simple-dispatcher) | A 06-08→07-05 | B 07-06→08-02 | **C 08-03→08-16** (2 full weeks) |
|---|---|---|---|
| tickets reaching code / wk | 115.3 | 69.8 | **44.5** |
| mainline units / wk | 135.5 | 85.3 | **51.0** |
| production-code lines / wk | 26,243 | 12,186 | **9,594** |

**But that is not the same headwind continuing.** Decomposing mainline units into *calendar* and *intensity*, per repo, never mixed:

| LinearViewer | days | active days | units | **units / active day** |
|---|---|---|---|---|
| A 06-08→07-05 | 28 | 28 (100%) | 459 | **16.4** |
| B 07-06→08-02 | 28 | 27 (96%) | 230 | **8.5** |
| C 08-03→08-22 | 20 | 14 (**70%**) | 117 | **8.4** |

The July fall was an **intensity** fall at full calendar occupancy. The August fall is **entirely calendar** — intensity is flat (8.5 → 8.4) across six zero-delivery days (05, 11, 12, 17, 18, 19 August). Whatever the gates cost per unit of work, **that cost stopped growing after July.** This is the first genuinely improved trajectory in this series since 06-25, and it is invisible in the weekly aggregate.

`simple-dispatcher` is the opposite and must not be averaged in:

| simple-dispatcher | days | active days | units | units / active day |
|---|---|---|---|---|
| A | 28 | 20 (71%) | 83 | 4.2 |
| B | 28 | 23 (82%) | 111 | **4.8** ← rose |
| C | 20 | 9 (**45%**) | 22 | **2.4** ← halved |

The runner repo went quiet on both axes. It never fell in July at all — it *rose*. Its fall is new, and it is in August.

**Why it matters.** "Delivery is still falling" and "delivery per working day has stabilised and the operator worked fewer days" are different problems with different fixes, and the weekly series cannot distinguish them. Treating C as a continuation of B's headwind would put remediation effort on the gates, which the evidence says have stopped getting more expensive.

**What I would do.** Add active-day density (`units ÷ days with ≥1 first-parent commit`, per repo) as a fifth substrate in `scripts/delivery-composition.mjs`. It is the line that separates "the machine got slower" from "the machine ran fewer days", and it took four lines of Python to compute from data the script already reads.

**Confidence: verified at HEAD** for all figures. **Hypothesis, explicitly:** the *interpretation* that gate cost has plateaued rests on two windows, and window C is 20 days. Too early to call it settled; call it again next run.

---

## H6 — `output-composition`: flat-high, no longer worsening · **high · unchanged**

Test share of lines written, by week: `07-06 51% · 07-13 59% · 07-20 63% · 07-27 66% · 08-03 61% · 08-10 67%`. 08-03 reported the crossing of 50% and a climb to 66%. It has neither returned below 50% nor continued climbing — it is flat-high in the low-to-mid 60s. Production code/wk continued down (12,186 → 9,594) but in step with mainline units, so per-unit code size is roughly stable.

**Not re-flagged as worsening.** Two weeks is not a trend and the series is noisy at this width. Carried forward at the same grade.

---

## H7 — `parked-at-plan-review`: the cohort half-converted, and the mechanism was misattributed · **medium · improved**

Of 08-03's four named parked tickets: **LIN-1694 → Done**, **LIN-1731 → Done**, LIN-1717 still Todo, LIN-1408 still Todo. So the cohort **converted rather than rotated** — 50% of it, at least. Per H4, a documented part of the parking was the LIN-1871 change freeze, lifted 2026-08-04, not enumeration non-convergence.

Flow health at HEAD is genuinely good and I am reporting it as a clean result rather than hunting for a way to grade it: over 250 sampled team issues — **3 In Progress** (LIN-2243, LIN-2114, LIN-2089), 111 Done, 8 Canceled (3%), 2 Duplicate. Low WIP, low abandonment. No stale-in-progress finding.

---

## H8 — Credential/identity is a live defect cluster, and 08-03's "one-off, closed" no longer holds · **medium · new (supersedes 08-03 H4's `closed`)**

08-03 closed `external-injection-break` as *"a one-off external cost"* — correctly, for the July prompt-injection break. But the subsystem that break forced into existence has been generating **adjacent bugs** ever since, which is the defect-escape signal this remit names (same-area re-filing, not literal reopens).

Credential/token/account/identity work is **23 of 137 mainline units (16%)** since 2026-08-03. A board search returns ~25 tickets in the cluster, and they read as repair, not feature work: `LIN-2216` transient-401 vs dead credential · `LIN-1982` sentinel expiry wins forever · `LIN-2097` rejected credential's expiry re-stamped every ~63s · `LIN-2110` byte-identical refresh exchange · `LIN-1986` credential-selection hole · `LIN-1980` headless lane never invalidates a refused credential · `LIN-1981` *(In Progress, "Incident follow-up 3, open root-cause candidate")* linkProvider mirrors a foreign provider's credential onto a legacy workspace.

Still open in the same area: LIN-1746 (In Progress), LIN-1981 (In Progress), LIN-1985, LIN-1991, LIN-1745, LIN-2100, LIN-2058 (Backlog), LIN-1938, LIN-1658, LIN-1949, LIN-1408 (Todo). Two were **Canceled** mid-flight (LIN-1983, LIN-2003).

**Why it matters.** Per the standing discipline: this is a north-star-aligned subsystem, so fixing it is **rework, not forward delivery**. 16% of mainline output for three weeks is a real share of a falling budget, and the cluster has an open root-cause candidate — meaning the escapes are not yet bounded.

**Not double-flagged:** the *structure* of these modules belongs to Code Quality / Drift & Coherence. This entry counts only the delivery share and the escape pattern.

---

## H9 — `cost-per-verified-task`: unblocked and shipped · **resolved**

08-03 rated this `high — blocked on a definition, not on engineering`, with LIN-1625 In Progress and stale 7 days. **LIN-1625 is Done** (closed 2026-08-09), delivered as LIN-1957 (`02026827`, PR #1090) and LIN-1958 (`d1921ec8`, PR #1091), CI green on both. The 2026-08-03 ruling took option B — publish the strictest computable proxy, named honestly, with bias and coverage beside it — and the naming discipline is pinned by test. Live at ship: `$26.97`/30d, against 08-03's independent 13-ticket median of `$26.01`. The two agree.

**Retire the name.** Superseded by H1, which is about the metric's *denominator*, not its definition.

---

## Clean results — reported as findings in their own right

- **Rework / reverts**: 2 reverts in `LinearViewer` since 2026-06-01, **0 since 2026-08-03**. Fix-on-fix: 26 of 492 tickets have >1 mainline unit, and the top five (LIN-2197 ×5, LIN-1728 ×4, LIN-2087 ×3, LIN-2079 ×3, LIN-495 ×4) are all **declared phased delivery** ("Phase 1/2/3…", "beat n/5"), not repair. No rework headwind.
- **Flow / WIP**: 3 In Progress, 3% Canceled (see H7). No stale-in-progress finding.
- **Instrument stability**: `scripts/delivery-composition.mjs` reproduces 08-03's A/B windows to within right-censoring drift. No re-grounding needed.
- **Timeliness**: still 0 tasks with a due date. Unchanged, and still means every reading here is flow health only.

---

## Trend ledger — for mechanical comparison next run

| name | 08-03 | 08-23 | movement |
|---|---|---|---|
| `cost-metric-denominator` | — | 70% of delivered tickets outside `T` | **new, critical** |
| `north-star-version-drift` | — | proxy serves v1; HEAD doc is v2 (23 d) | **new, critical** |
| `periodical-cadence` | critical, new (10/15 `never`) | 10/15 `never`; ledger counts `taken` | **unchanged** |
| `gate-falsification` | critical, unchanged | deferred by ruling to 2026-08-25 | **movement — deferred, not un-run** |
| `delivery-throughput` | critical, inverted (−37%) | −40% again by week; **intensity flat 8.5→8.4** | **improved (LV) / worsened (SD)** |
| `output-composition` | high, new (66% test) | 61–67%, flat-high | **unchanged** |
| `verification-session-share` | high (23% impl) | not re-measured — see below | **unmeasured** |
| `external-injection-break` | closed | subsystem now a live defect cluster, 16% | **superseded → `credential-defect-cluster`** |
| `credential-defect-cluster` | — | 23/137 mainline units; open root cause | **new, medium** |
| `parked-at-plan-review` | high | 2 of 4 Done; freeze lifted 08-04 | **improved** |
| `cost-per-verified-task` | high, blocked on a ruling | LIN-1625 Done 08-09, $26.97 live | **resolved** |
| `backlog-conversion` | medium | not re-measured — see below | **unmeasured** |
| `untraceable-completions` | medium (369/1112) | not re-measured — see below | **unmeasured** |

---

## What this review did not measure, and why

- **`verification-session-share`, `backlog-conversion` and `untraceable-completions` were not re-measured.** All three need a bulk session/ticket-creation sample (08-03 used 68 tickets / 500 sessions and a 47-point id interpolation). Under H1's finding, the session substrate has just changed shape — lane sessions bundle tickets — so a sample taken today is not comparable to 08-03's, and re-running it would have produced three numbers that look like movement and are not. **Better unmeasured than falsely moved**; carried at 08-03's grade. This is the honest cost of H1 landing mid-run.
- **Agent effort before ~24 July**: unreachable, 30-day telemetry TTL. Unchanged since 08-03.
- **The cost of tickets that never reach code**: still invisible to every commit substrate — and now, per H1, so is the cost of tickets that *do*.
- **Whether the gates are worth their cost**: still LIN-1661's question, now dated 2026-08-25. Unchanged as the central open question, though H5 supplies a new input: gate cost per unit of work stopped growing after July.

---

## Supersession — correcting an earlier claim

**Superseding 2026-08-03 H5's causal attribution** (`docs/reviews/recent-headwinds-review-2026-08-03.md`, "Tickets that consume sessions and never reach code"). That section attributed the parked cohort LIN-1694/1731/1717/1408 to the plan-review enumeration-convergence mechanism the autopilot self-diagnosed on LIN-1408. That mechanism is real and the quotation is accurate. But a documented, distinct cause also applies to at least four of the five tickets in that cohort: an informal *"no prompt-template changes before 2026-08-25"* freeze — a protective inference drawn from LIN-1661's `[not before]` title marker, never part of that ticket — which hardened into a blocking constraint through LIN-1871 and was withdrawn by John's ruling of 2026-08-04 (recorded on LIN-1661). Half the cohort completed after the withdrawal.

**Not withdrawn, narrowed:** enumeration non-convergence remains a live mechanism; it was not the sole cause of the 08-03 cohort. This correction is posted, never silently applied — the 08-03 file is unedited.

**Also superseding 08-03's `external-injection-break: closed`** — see H8. The July break was correctly closed as a one-off; the subsystem it created was not, and the ledger name is replaced rather than reopened.

---

## For the human, in one paragraph

Delivery is still falling week-on-week, but for a different reason than in July: output per *working day* has been flat since early August, and the additional fall is six zero-delivery days. That is the first improved trajectory this series has recorded. Against it sit two new critical findings, both in the measurement layer rather than in delivery: today's switch to multi-ticket worker lanes has put 70% of shipped tickets outside the cost metric's denominator while the instrument reports complete coverage, and Harbour has been serving a superseded v1 north star to its own direction analyzer since 31 July — including the absence of the "gates buy evidence, never delay" clause that the one outstanding gate question would be judged by. Both are detection gaps, which the north star itself ranks above feature work. LIN-1661 reads on 25 August; nothing here argues for moving it.
