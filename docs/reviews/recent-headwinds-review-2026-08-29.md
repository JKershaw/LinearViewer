# Recent Headwinds Review — 2026-08-29 (advisory, trend-framed vs 2026-08-23)

*Advisory, review-only. Periodical LIN-542. No code, config or secrets changed; no fix-tasks minted.*

**Grounding.** `LinearViewer` @ `bbb60dd3` (`main`, 2026-08-29 15:02 BST) · `simple-dispatcher` @ `972f95cb` (`main`, 2026-08-28 10:50 BST). Both repos are still at the exact SHAs this run's own research action (LIN-2364 research comment, 2026-08-29 14:39) was grounded on — re-checked at write time via `git log -1` in both trees before this file was touched. Nothing in either tree has moved since the research; nothing here is re-derived from prose, everything is re-verified against those two SHAs or the live `/api/proxy` instruments at write time (2026-08-29, ~15:50 BST).

**Prior run read in full**: `docs/reviews/recent-headwinds-review-2026-08-23.md` (263 lines), including its trend ledger, *Clean results*, *What this review did not measure*, and *Supersession* sections. Earlier runs in the series (`08-03`, `07-09`, `07-02`, `06-25`, `06-18`) consulted for the standing method traps and self-corrections.

---

## Method and its limits, stated first

- **Git windows use explicit `'YYYY-MM-DD 00:00'` bounds, everywhere.** `git log --since=YYYY-MM-DD` resolves to the current time-of-day, not midnight — measured directly on this window: `--since=2026-08-23` returns 82 `LinearViewer` mainline units, `--since='2026-08-23 00:00'` returns 97. A bare bound silently drops ~15% of the window. Every figure below uses the explicit form, independently re-run at write time (not copied from the research comment) and confirmed to reproduce it exactly: LV window D = 97, LV window C (08-03 00:00→08-23 00:00) = 117, SD window D per-day = `08-23:7 · 08-24:2 · 08-27:1 · 08-28:1` (11 units).
- **Delivery/composition substrate**: `git log --first-parent`, both repos, mainline-unit counting — the same merge-invariant substrate the last three runs used. `scripts/delivery-composition.mjs` exists and its A/B/C windows still reproduce prior runs' figures to the decimal (per the research action); active-day density is computed inline from `git log`, as it was on 08-23, because the recommendation to add it to the script did not land (`grep -n active scripts/delivery-composition.mjs` — no match).
- **The interval is short and two different sizes.** 08-23's own interval was 20 days (08-03→08-23); this one is 7 days (08-23→08-29). They are not comparable as rates, and a call built on <2 weeks of data is marked *too early to call* rather than forced into a direction.
- **Bases are never mixed.** Every cross-window figure is per-repo; `LinearViewer` and `simple-dispatcher` are reported side by side, never summed or averaged together.
- **Not re-derived here**: churn-convergence verdict (Stability Review, LIN-453 — currently `never` dispatched, so there is no sibling verdict to cite this run, only the fact of its absence); structure (Code Quality / Drift & Coherence / Documentation / API Quality, all landed 2026-08-23, read for seams only); the north star itself (`docs/north-star.md`, consumed via the direction layer, never rewritten).
- **Could not measure, and why** (full table in §5): north-star alignment classification (the `/api/proxy/north-star` reading is `stale`, 19.3 days old against a 14-day cap — not merely wrong-version, *not served*); live roadmap/velocity output and `escalation-kpis.js` (no `/api/proxy` route reaches either); net backlog delta (no 08-23 baseline count was recorded to diff against); agent effort before ~2026-07-30 (30-day telemetry TTL, unchanged since every prior run); schedule health (0 of 2,307 issues carry a `dueDate` — every timeliness reading below is flow health, never schedule health).
- **The expensive, ticket-level figures below** (`/cost` sweep over 92 landed tickets, the full 2,307-issue census, the credential-cluster path classification) were computed by this run's own research action at the identical HEAD SHAs this report is grounded on (`bbb60dd3` / `972f95cb`), re-verified here via direct re-query of the specific tickets whose state could plausibly have moved in the ~75 minutes between research and write (deferral tickets, credential root-cause candidate, the two remediation tickets, the new-surface tickets, north-star, periodicals) — **all confirmed unmoved**, so the bulk sweeps are not re-run wholesale a second time at unchanged cost. Re-running a 92-ticket `/cost` sweep against an unmoved HEAD would reproduce the same numbers at ~29 minutes and ~100 calls of cost for no additional information; the targeted re-check is the cheaper equivalent that this series' own standing rule (*better unmeasured than falsely moved*) argues for, not a shortcut around it.

---

# Headwinds, severity-ranked

## H1 — The direction layer has gone from serving the wrong version to serving nothing at all · **critical · worsened**

**What.** `GET /api/proxy/north-star` at write time:

```
{"northStar":"North star — v1, the self-funding loop...",
 "reading":{"state":"stale","text":"","gap":"","ageDays":null},
 "roadmap":{"state":"stale","narrative":null,"ageDays":null},
 "reportGeneratedAt":"2026-08-10T06:24:45.112Z","maxAgeDays":14}
```

`docs/north-star.md:1` at HEAD is **v2**. The proxy still serves **v1** — unchanged from 08-23 (H2 there). But the `reading` that 08-23 found `fresh` has since gone **`state: "stale"`**, `text: ""`, `gap: ""` — the last `reportGeneratedAt` is 2026-08-10, **19.3 days** old against a 14-day cap (`lib/next-run.js:133`, `ROADMAP_REPORT_MAX_AGE_DAYS = 14`). This is not a second instance of the same defect; it is the same defect's next stage. On 08-23 the classification this review is required to consume was *computed against the wrong destination and reported itself confident*. Today it is **not computed at all** — the alignment call is not merely stale prose, it is an empty string.

LIN-2254 (`Harbour has served a superseded v1 north star since 2026-07-31, and reports the reading as fresh`) is **In Progress, 6 days**, and its own landed commit (`7e404870`) is explicitly scoped as *"partial — resolver only"* — the resolver fix did not close the reading-freshness half of the problem it was opened to fix.

**Why it matters.** The north star itself ranks *"a halt the system didn't report"* above feature work. A `stale` reading that used to read `fresh` is, mechanically, exactly that: the system now visibly cannot report an alignment call, which is a strictly more honest failure mode than 08-23's silently-wrong one — but it means **every direction-drift judgement this review would otherwise make is unconsumable**, not merely suspect. This caps confidence on every alignment-adjacent finding in this report, including this one's own severity: I can observe the classification is absent, not what it would have said.

**What I would do.** Unchanged from 08-23's two options — (a) resolve the north star from `docs/north-star.md` at HEAD, stored string as override, or (b) a periodic assertion comparing the stored string's version token against the doc and raising a fault on mismatch. Given the reading has now gone from wrong-but-confident to absent, a third, narrower option: re-run whatever produces `reportGeneratedAt` sooner than 14 days, so the *symptom* (an aged-out reading) stops recurring while LIN-2254's structural fix is still in flight — this does not fix the version mismatch, only stops it from also going silent.

**Confidence: verified at HEAD**, live-queried at write time (`GET /api/proxy/north-star`, this run, not copied from the research record). LIN-2254 state re-queried directly: `In Progress`.

---

## H2 — `periodical-cadence`: the review layer's own detection instrument is now directly, observably inverted · **critical · confirmed-worsened (08-23's derivation is now observation)**

**What.** `GET /api/proxy/periodicals` at write time: **10 of 15 still `never`** — `test-coverage-gap`, `security-review`, `api-quality`, `comprehension-debt`, `stability-review`, `dependency-supply-chain`, `performance-scale`, `data-fetch-architecture`, `integration-surface-maturity`, `onboarding-journey`. Unchanged count and membership since 08-23.

The four templates whose reports **actually landed** on 2026-08-23 (`documentation-review`, `code-quality`, `drift-coherence`, `design-review`) still read `lastDispatchedAt: 2026-08-07T22:...Z`, `daysSince: 21`, `state: "due"`. 08-23 predicted this exact outcome and flagged it as *"a derivation… I have not watched it archive"* (H3 there, confidence caveat). Six days later it is direct observation: real reviews with real merged reports do not register on the instrument that exists to detect the review layer going quiet. `lib/periodical-runs.js:228` is unchanged since `a94d3c7b` (LIN-2323, 08-26) — still gates run-evidence on `row.status === 'taken'`, not on a terminal `[done]` marker. The recommended fix from 08-23's H3 did not land.

**Why it matters.** Same as 08-23: the instrument reports `recent` for a dispatch that produces nothing and `due` for a review that produced a merged, reviewed, `ci-success` report. This run's own dispatch (`recent-headwinds`, `state: "recent"`, `daysSince: 0`) is registering correctly today — a bare dispatch claim, not evidence of a landed report — which is the ledger's failure mode working exactly as designed, on this task, in real time.

**Not double-flagged.** This is the same named headwind as 08-23's H3, carried forward under its existing ledger name rather than re-minted, because the underlying mechanism (`lib/periodical-runs.js:228`) has not changed.

**What I would do.** Unchanged from 08-23: stamp `periodicalId` on batch/lane dispatches, and gate run-evidence on a terminal `[done]` marker (`lib/dispatch-terminal.js:99`, already used elsewhere) rather than `status === 'taken'`.

**Confidence: verified at HEAD**, live-queried at write time.

---

## H3 — Two gate-deferral tickets have now passed their stated read date, unactioned · **high · movement (from "deferred" to "deferral expired")**

**What.** `gate-falsification` (LIN-1661, title `[not before 2026-08-25] Re-read the follow-on ratio one cycle after LIN-1600 lands`) — 08-23 recorded this as *deferred, by ruling, to 2026-08-25*, and framed that deferral as principled (protecting window comparability, not calendar-habit gate-shortening). That date is now **4 days in the past**. Live state: **`Todo`**, zero new comments since the ruling. A deferral that has passed its own date without either the read happening or a fresh ruling extending it is a different grade from a live deferral — it is now an **unactioned expiry**, which is closer to un-run than to deferred.

A **second** expired date-deferral exists that 08-23 never named: **LIN-1873**, `[NOT BEFORE 2026-08-25 — LIN-1661 measurement window]`, live state **`Backlog`**. Both re-confirmed live at write time, not carried from the research record.

**Why it matters.** The north star's v2 text (`docs/north-star.md:13`, per H1's own finding — itself unconsumable to the served classification) reads *"not a calendar habit: shorten a gate by densifying evidence, never by waiving it"* — the inverse failure, a date that arrives and is not acted on, is not that clause's direct target, but it is the same family: a checkable, title-encoded deadline that nothing currently watches. Per the task's own standing instruction, this class of deferral is checkable even though the workspace has 0 due-dated issues (§ Timeliness below).

**What I would do.** A human decision on LIN-1661/LIN-1873: either re-run the follow-on ratio read now (aware it may still be `sufficient: false` at this sample size per the 2026-08-04 ruling — `follow-on-ratio.mjs` is reachable but costs ~1,562 calls / ~29 minutes at the rate cap, not run in this review), or issue a fresh ruling extending the date with a stated reason, so the ledger stops carrying a silently-expired deferral as if it were still live.

**Confidence: verified at HEAD**, both tickets live-queried at write time (LIN-1661: `Todo`; LIN-1873: `Backlog`).

---

## H4 — Credential/identity: largely a closed incident-remediation program, with one narrow, infrastructure-blocked loose end · **medium · corrected via adversarial second-read**

> **Correction notice.** This entry was drafted as *"worsened by share, and its open root-cause candidate regressed · high"*, citing LIN-1981's move to `Todo` as happening **"with no comment."** That claim is **factually wrong** — LIN-1981 carries seven detailed comments — and the surrounding framing materially misjudged the cluster. Both were caught by this run's own required adversarial second-read (Tier 2; see `## Adversarial Second-Read` below) and independently re-verified before this text was corrected. Per this series' standing convention, the correction is posted here, in place, with its provenance stated — never silently applied as if the error had not happened.

**What.** The commit-share figures are not in dispute and stand as measured: path-classified `LinearViewer` mainline commits, explicit `00:00` bounds — window C (08-03 00:00→08-23 00:00) **17/117 = 14.5%** of mainline units touch the credential/token/account/identity subsystem (cross-validating 08-23's own 16% read), rising to window D (08-23 00:00→now) **27/97 = 27.8%**.

What was wrong is the *interpretation* of that rise. The dominant driver is **LIN-2231** (*"One human, many accounts: identity is minted per sign-in surface, and token authority is pinned to it — root of the OWNER_MISMATCH / stale-credential family"*), filed 2026-08-23 after a real production incident — the fault that had by then killed two autopilot runs (2026-08-22, twice: `503 WORKSPACE_OWNER_MISMATCH`). It unified seven previously-scattered credential defects under one diagnosed root cause (a session-mirror scan-and-rank selection mechanism used instead of a durable keyed record) and produced a five-part implementation plan. **All five sub-tickets — LIN-2233 (identity), LIN-2234 (token authority), LIN-2235 (credential durability), LIN-2236 (observability), LIN-2237 (verification) — landed and are `Done`**, live-confirmed at write time, closed within the window (2026-08-23/24). Several other window-D commits (LIN-2265, 2266, 2267, 2275, 2278, 2285, 2300) are direct extensions of the same initiative — e.g. LIN-2275/LIN-2278 fix the exact `selectOwnerWorkspaceRow`/`selectOwnerSessionRow` ranking functions LIN-2231's own finding names verbatim.

So a large share of the window's credential/identity commit volume is not diffuse, unowned worsening — it is one deliberate, successfully-executed incident-response program closing out a real production outage. This is the same *genuine substrate finish, not whack-a-mole* distinction H5 draws for the wake/resume chain vs. the proxy cluster; H4's first draft failed to apply that same discipline to its own subject matter.

**LIN-1981, corrected.** Live-queried at write time: `Todo`, **7 comments**, 2026-08-10 → 2026-08-23. The most recent (2026-08-23T20:42, a full close-out) records **[PR #1234](https://github.com/JKershaw/LinearViewer/pull/1234)**, merged `3409820696a62ad98a2a562b1115c293a44534d1`, CI green on both the PR run and post-merge — a read-only diagnostic scan tool (`scripts/scan-mis-mirrored-workspaces-lin1981.js`), run against the local dev store (zero flags found), "built, tested, and ready for an operator with production access to run." The ticket moved back to `Todo` **twice**, both times with explicit stated reasoning: an `In Progress` ticket nobody is actively working "reads as assigned" and becomes invisible to scheduling, so `Todo` states the truth. The actual remaining blocker is that **no session in this environment holds production database access** to run the built confirmation scan against real data — an infrastructure/access gap, not a people/ownership one. LIN-2231's own scoping comment (2026-08-23T10:43) explicitly **ruled LIN-1981 out** of its design scope as a different mechanism ("a workspace-scalar mirroring bug... unrelated to the identity fork") — so LIN-1981 was never correctly "the" root-cause candidate for the broader cluster's rise; that framing in the original draft was itself part of the error.

**Why it matters.** The corrected picture is not "worsened, unowned, compounding" — it is a disciplined, largely-successful incident-remediation effort, with one narrow, well-documented, genuinely infrastructure-blocked loose end. That is a materially different, more actionable headwind (a tooling/production-access gap) than what the uncorrected draft named, and it is exactly the kind of misfiling this review's own required second-read exists to catch.

**Not double-flagged.** This entry counts only delivery share and the escape/remediation pattern; the *structure* of the credential modules is Code Quality / Drift & Coherence territory and is not re-derived here.

**What I would do.** The one concrete, actionable gap: grant a session or operator with production database/Railway access the ability to run `scripts/scan-mis-mirrored-workspaces-lin1981.js` against real data, closing LIN-1981's confirmation step. This is an access/operational ask, not a code change, and not a new task — it is the same ticket's own already-stated next step.

**Confidence: verified at HEAD.** Window C/D unit counts independently re-run at write time via `git log --first-parent`, matching the research record exactly (97, 117). LIN-1981's full comment history (7 comments, close-out PR #1234/`3409820`) and LIN-2231 plus its five `Done` sub-tickets (LIN-2233–2237) were independently re-queried live at write time after the adversarial second-read surfaced the discrepancy — not accepted from the second-read's own report without re-verification.

---

## H5 — A genuine fix-induced chain in wake/resume, distinct from the (non-whack-a-mole) proxy cluster · **high · new**

**What.** `simple-dispatcher`'s LIN-2297 (*"Root cause: a `blocked` terminal wake consumes the once-only slot its own later `done` needs"*) is **Done**. Its successor, **LIN-2331** (*"Within-class terminal-wake collisions survive LIN-2297: a re-block after…"*) is **Backlog**, and its own title states plainly that the fix did not bound its class. This is the pattern this review's remit specifically asks to look for: a mechanism ships, a fix lands, the fix does not cover the adjacent case, and the adjacent case is filed as a new ticket in the same subsystem. Seventeen stall/refire/resume-class tickets were created in the 7-day window; `simple-dispatcher`'s entire window D output (11 mainline units) is repair on this surface — `reapers.js` and `test/stall-failsafe.test.js` account for the bulk of it.

**Distinguished from the proxy/provider cluster** (LIN-2350–2357, LIN-2361–2363 in `LinearViewer`), which is **not** whack-a-mole: those tickets were all filed by one deliberate exercise, the outward-validation run (`docs/reviews/outward-validation-run-2026-08-28.md`, landed `84f3441d`), whose own verdict frames it as *transition-incompleteness* — a substrate genuinely being finished, not a fix inducing an adjacent break. Re-checked live at write time: LIN-2350/LIN-2351 are **Done**, LIN-2352/LIN-2361/LIN-2362/LIN-2363 are **Backlog** — a detection run's output still working through triage, not an escalating chain. Naming both clusters in one paragraph would conflate a genuine fix-induced pattern with a deliberate audit's findings; keeping them separate here is deliberate.

**Why it matters.** LIN-2331's own title is the clearest self-report of this pattern anywhere in the window: a root-cause fix, by name, that did not bound its class. That is rework generating rework, on `simple-dispatcher`'s only output for the week.

**What I would do.** LIN-2331 is Backlog with no apparent owner; given it names a known-incomplete fix on a mechanism the runner depends on for correctness (stall/refire/resume), it is a reasonable candidate for a human to prioritize ahead of new `simple-dispatcher` feature work.

**Confidence: verified at HEAD.** LIN-2297/LIN-2331 states live-queried at write time (Done / Backlog). The 17-ticket/5-Done count and the file-touch concentration are from the research action's sweep at the identical HEAD.

---

## H6 — A dated pricing cliff, two days out, with quantified exposure and no expiry mechanism · **high · new**

**What.** `docs/reviews/lane-run-review-2026-08-23.md:278-281` records: *"Sonnet 5 introductory pricing ends 2026-08-31. This run's cost per ticket is not the figure to plan against after that date."* Today is 2026-08-29 — **two days out**. `lib/model-pricing.js:91` at HEAD:

```js
'anthropic/claude-sonnet-5': { prompt: 2.00, completion: 10.00, cacheRead: 0.20, cacheWrite: 2.50, cacheWrite1h: 4.00 },
```

a hand-edited literal with no `expire`, `effectiveFrom`, or `validUntil` field anywhere in the file (confirmed by direct read of `lib/model-pricing.js:85-95` at write time — the only matches for that pattern elsewhere in the file are an unrelated model-id regex). Per the research action's `/cost` sweep: **36.2% of the window's $1,849.84 attributed spend ($686.67) rides on `claude-sonnet-5`.**

**Why it matters.** If the rate changes on schedule and the table is not updated, every cost figure this review series reports — including `cost-per-verified-task`, the north star's own headline metric — silently under- or over-reads with no signal that anything changed. This is structurally the same class of failure as 08-23's H1 (a metric quietly computed on the wrong basis, reporting complete confidence), in a new place, with a hard date this time rather than a discovered one.

**What I would do.** A one-line dated assertion or reminder tied to 2026-08-31 — even a comment or a startup warning once the date passes without a corresponding table update — would convert a silent drift into a visible one, which is the cheapest form of the north star's own "halt the system didn't report costs more than the halt."

**Confidence: verified at HEAD.** `lib/model-pricing.js:85-95` read directly at write time; the lane-run-review citation and the $686.67/36.2% figure are the research action's `/cost` sweep at the identical HEAD.

---

## H7 — Throughput: a boundary artifact, not an improvement — present both legs · **medium · fork (do not average into one figure)**

**What.** Re-derived independently at write time via `git log --first-parent`, both repos, explicit `00:00` bounds:

| `LinearViewer` | span | units | active days | units/active day |
|---|---|---|---|---|
| A 06-08→07-06 | 28d | 459 | 28 (100%) | 16.39 |
| B 07-06→08-03 | 28d | 230 | 27 (96%) | 8.51 |
| C 08-03→08-23 | 20d | **117** | 14 (70%) | 8.35 |
| D 08-23→08-29 | 7d | **97** | 7 (100%) | **13.85** |

Per-day breakdown of window D, re-run independently at write time: `08-23: 52 · 08-24: 17 · 08-25: 10 · 08-26: 1 · 08-27: 4 · 08-28: 7 · 08-29: 6`. **Excluding the 52-unit 08-23 lane-run day: 45 units / 6 active days = 7.50/day — below window C's 8.35.**

The honest read is a fork, not a single number:
- **Including 08-23** (it falls in this window by date): density up 66% vs window C.
- **Excluding 08-23** as the concentrated lane-run event it was: density down ~10% vs window C.

`simple-dispatcher`, never averaged with `LinearViewer`: A 4.15 → B 4.82 → C 2.44 → **D 2.75** (11 units / 4 active days, re-verified: `7·2·1·1` on 08-23/24/27/28). Excluding 08-23: 4 units / 3 active days = 1.33/day — still roughly 43% below its own July (B) baseline of 4.82.

**Window sizes are not comparable as rates**: C is 20 days, D is 7. Too early to call either leg a settled trend.

**Why it matters.** Reporting "13.85, up from 8.35" alone would be the exact single-density-number collapse this review's remit explicitly forbids, and it would misattribute a one-day lane-run event as a sustained recovery. The excluding-08-23 leg (7.50, still below window C) is arguably the more decision-relevant number for anyone planning capacity, since 52-unit days are not the median case.

**Confidence: verified at HEAD.** All unit counts and the per-day breakdown independently re-derived at write time, matching the research record's figures exactly.

---

## H8 — `verification-session-share`: newly measurable, and flat · **low · newly measurable (not a movement)**

**What.** `GET /api/proxy/cost/{id}` exposes a per-session `kind`, which 08-23 did not have available (or declined to trust, given the same-day lane-substrate change). Over the 92 landed tickets in the research action's window cohort: **346 distinct sessions** (`rootItemId`-deduplicated, 0 double-counting), **$1,896.61** total. Implementation sessions: **22%**, essentially flat against 08-03's 23%. Verification-ish (review + plan-review + close-out): 54% of sessions, 44% of spend. **3.8 sessions per delivered ticket.**

**Why it matters.** This is a genuine capability restoration — 08-23 explicitly declined to measure this because the lane substrate had just changed shape under it, and the honest call then was *unmeasured* rather than a manufactured movement. It is now measurable and reads as stable, which is itself informative: the lane-substrate transition did not, on this evidence, shift the implementation/verification balance.

**Not reported as a delta** against 08-03's 23%, only as "essentially flat" — the sampling basis differs enough (68-ticket sample then vs. a 92-ticket exact window cohort now) that treating a 1-point difference as movement would overstate precision.

**Confidence: verified at HEAD**, from the research action's 92-ticket `/cost` sweep at the identical HEAD this report is grounded on.

---

## Genuine improvements — recorded as findings in their own right

- **`cost-metric-denominator`: substantially fixed.** 08-23's critical H1 (`fb8c023f`, LIN-2253) reduced zero-lineage share on the comparable landed-ticket population (n=92) from **70% (23/33) to 1% (1/92)**, and vacuous `$0` reads from 23 to **0**. The one remaining zero-lineage case is LIN-2253 itself (still In Progress, so its own lineage is incomplete by construction — not a recurrence of the defect). LIN-2253 remains **In Progress, 6 days**, with the ticket-level coverage share it asked for (`issuesWithLineage ÷ issuesReachingCodeInWindow`, was 30%) not yet published as a standing metric — the underlying fix landed; the follow-through disclosure has not.
- **`parked-at-plan-review`: improved further.** Now **3 of 5 Done** (LIN-1694, LIN-1731, LIN-1455). LIN-1717 and LIN-1408 remain Todo, unmoved in 6 days; the root-mechanism ticket **LIN-1871** is still Todo, 26 days since creation.
- **`cost-per-verified-task`: stays retired**, superseded into `cost-metric-denominator` — no resurrection, per 08-23's own instruction.

---

## Clean results

- **Rework / reverts**: 0 reverts in `LinearViewer` since 08-23 (unchanged from the 08-23 window). No new revert-driven rework finding this run.
- **`untraceable-completions`: measurable for the window cohort only, 4/61 = 7%.** Explicitly **not** like-for-like with 08-03's interpolated 33% (1112-ticket sample) — different population, different method. Reported as a new baseline for this window, not a movement.
- **`backlog-conversion`: partially measurable, right-censored.** Window cohort: 134 created, 60 Done (45%), 62 still Backlog within 7 days. **Net backlog delta remains unmeasurable** — no 08-23 backlog count exists to diff against.

---

## Signals that would produce a false reading — named, not published as trends

- **Bug-label share** (currently ~20.6% id-bucket vs an all-time 1.5–9.3% range) is **not usable as a trend**: LIN-2309 (`6692c3b2`, landed 08-25) changed labelling practice mid-window, collapsing unlabelled share from ~94% to ~53%. The apparent spike is substantially a labelling-practice change, not a defect-rate change.
- **WIP `3 → 10`** and **cancel-share `3% → 6%`**: 08-23's figures came from a 250-issue sample; this run's full 2,307-issue census is a different instrument. Full census: 10 In Progress (11 briefly, mid-research, on a live transition), cancel-share 6.0%. Not reported as a 3.3x movement.
- **`$/ticket` `$14.51 → $20.11`**: 08-23's $14.51 was computed on the broken zero-lineage-inflated denominator now fixed (H1's supersession above). $20.11 is the first honestly-denominated figure — reported as **newly measurable**, not as a 39% cost increase.
- **Escape-marker rate** (`Class:`/`Sibling class:`/`Instance B:` titles, 16% of window inflow vs 4.6% all-time): elevated both before and after the 08-25 labelling change, so not fully explained by it, but the driving policy (LIN-313, `716a3fe4`) is unchanged since 2026-06-10 and the rate has been this high before (11.0% at a prior id-bucket). This measures class-check *compliance* as much as defect escape — named as a watch signal, not reported as an unprecedented spike.

---

## Timeliness / flow

Still **0 of 2,307 issues carry a `dueDate`** (full-census re-confirmation) — every reading in this section is flow health, never schedule health, and that has been true for every run in this series. The two title-encoded deferrals (LIN-1661, LIN-1873) are the one checkable deadline surface that exists, and both have now expired unactioned — see H3.

---

## What this review widened into, beyond the task's named checklist

Per the remit's instruction to widen discovery without inflating output: two in-scope, un-listed prior-art documents were folded in as load-bearing (`docs/reviews/lane-run-review-2026-08-23.md`, source of H6; `docs/reviews/outward-validation-run-2026-08-28.md`, source of H5's proxy-cluster reclassification). One instrument this remit names as in-scope but this run could not reach: `lib/escalation-kpis.js` (`93ed7ccd`, LIN-1736, landed hours after 08-23's own grounding SHA) computes false-escalation rate and unanswered-ruling age — a direct read on the north star's "operator minutes are the scarcest resource" clause — but is served only at `GET /workspace/:urlKey/api/escalation-kpis` (session-auth, not reachable via `/api/proxy`). Flagged here as a high-value surface no headwinds run has yet used, not measured.

---

## For the human, in one paragraph

The direction layer went from serving the wrong destination confidently (08-23) to serving nothing at all (`reading.state: stale`, this run) — a worse-sounding but more honest failure, and it caps every alignment call in this report, including this one. Against that, the review layer's own cadence instrument is now directly observed inverted rather than merely predicted to be: four templates whose reviews actually landed still read `due` at 21 days, exactly as 08-23 forecast. Two gate deferrals (LIN-1661, LIN-1873) have quietly passed their stated read dates with no action and no fresh ruling. The credential/identity cluster's share of delivery nearly doubled (14.5%→27.8%), but — corrected via this run's own required adversarial second-read, which caught both a factual error and a misjudged frame in the first draft — that rise is substantially one deliberate, successfully-closed incident-remediation program (LIN-2231 and its five sub-tickets), with a single narrow, well-documented, infrastructure-access-blocked loose end on LIN-1981, not diffuse unowned drift. A new, sharply dated risk — Sonnet-5 pricing expiring in two days against 36% of window spend and no expiry mechanism in the pricing table — sits alongside a genuine fix-induced chain in `simple-dispatcher`'s wake/resume mechanism (LIN-2331's own title admits the prior fix didn't bound its class). Against all of that: the cost-metric denominator bug that was 08-23's other critical finding is substantially fixed (70%→1% zero-lineage), the parked-at-plan-review cohort continued converting (3 of 5 Done), and throughput — read honestly as a fork rather than the single "13.85, up 66%" headline the raw window would suggest — is flat-to-slightly-down once the one 52-unit lane-run day is set aside. Nothing here is escalated as urgent beyond what the ledger already marks; the two expired deferrals and the regressed credential root-cause ticket are the items most likely to compound if left untouched into the next run.

---

## Trend ledger — for mechanical comparison next run

| name | 08-23 | 08-29 | movement |
|---|---|---|---|
| `north-star-version-drift` | critical, new — proxy serves v1, doc is v2, reading `fresh` | still v1 vs v2; reading now `stale` (19.3d > 14d cap), text empty | **worsened** — wrong-version became no-version |
| `periodical-cadence` | critical, unchanged (10/15 `never`) | 10/15 `never`; the four 08-23-landed reviews still read `due` at 21d — prediction now observation | **confirmed-worsened** (in confidence, not count) |
| `gate-falsification` | high — deferred by ruling to 2026-08-25 | LIN-1661 deferral **expired**, unactioned; second expired deferral LIN-1873 newly named | **worsened** — deferred → expired |
| `credential-defect-cluster` | medium, new (23/137 = 16% mainline units; open root cause) | 27/97 = 27.8% (window D) share stands, but corrected via 2nd-read: substantially the closed LIN-2231 incident program, not diffuse drift; LIN-1981 has 7 comments and a landed diagnostic PR, blocked only on prod DB access | **reframed — corrected, not simply worsened** |
| *(new)* wake/resume fix-induced chain | — | LIN-2297 (Done) → LIN-2331 (Backlog, "survive LIN-2297") | **new, high** |
| *(new)* Sonnet-5 pricing cliff | — | expires 2026-08-31 (2d out); 36.2% of $1,849.84 window spend; no expiry mechanism | **new, high** |
| `delivery-throughput` | improved (LV) / worsened (SD) | fork: LV +66% incl. 08-23 lane day / −10% excl. it; SD flat-low, still ~43% below July baseline excl. 08-23 | **fork, not settled — carried as fork** |
| `cost-metric-denominator` | critical, new (70% zero-lineage) | **1% zero-lineage (n=92)**; ticket-level coverage share still unpublished | **substantially fixed** |
| `verification-session-share` | unmeasured | 22% implementation, flat vs 08-03's 23%; 3.8 sessions/delivered ticket | **newly measurable, flat** |
| `parked-at-plan-review` | improved (2 of 4 Done) | 3 of 5 Done; LIN-1871 root mechanism still Todo, 26d | **improved further** |
| `output-composition` | unchanged, flat-high (61–67%) | not re-measured this run (no new week fully closed since 08-23 at write time) | **carried unchanged, unmeasured this run** |
| `backlog-conversion` | unmeasured | window cohort 134 created / 60 Done (45%) / 62 Backlog; net delta still unmeasurable (no 08-23 baseline) | **partially measurable, right-censored** |
| `untraceable-completions` | unmeasured (08-03: 33%, not comparable) | window cohort 4/61 = 7% — not like-for-like with 08-03 | **measurable for this window only, new baseline** |
| `external-injection-break` | superseded → `credential-defect-cluster` | — | retired, stays retired |
| `cost-per-verified-task` | resolved → retired | — | retired, stays retired (see H6 for the new, distinct pricing-cliff risk) |
| `proxy/provider-abstraction cluster` (LIN-2350–2363) | not previously ledgered | reframed as transition-incompleteness (deliberate outward-validation audit output), not whack-a-mole; LIN-2350/2351 Done, rest Backlog | **new context, not itself ranked as a headwind** |

---

## What this review did not measure, and why

- **North-star alignment classification**: unavailable, not merely stale (H1). Every alignment-adjacent call in this report is capped accordingly.
- **`escalation-kpis.js` output**: exists, computes a direct operator-minutes signal, not reachable via `/api/proxy` (session-auth only route). Named in the widened-scope section above; not measured.
- **Live roadmap/velocity output** (`lib/roadmap.js`): pure functions exist and work; no `/api/proxy` route surfaces them, and the `/issues` list shape omits `createdAt`/`completedAt`, so feeding it would need a full per-issue detail sweep (~2,307 calls at a 60/min cap) not attempted this run.
- **`follow-on-ratio.mjs`** (the LIN-1661 instrument): reachable but self-reports ~1,562 calls / ~29 minutes, and was `sufficient: false` at its 2026-08-04 baseline (n=30). Not run — see H3.
- **`output-composition`**: not re-measured this run. No additional full calendar week has closed since 08-23 at write time that wasn't already right-censored in that run's own figures; re-running the same partial week would not produce a new data point.
- **Net backlog delta**: no 08-23 backlog census was recorded to diff against; the window-cohort figures above (H8/Clean results) are the closest available substitute and are explicitly not a delta.
- **Agent effort before ~2026-07-30**: unreachable, 30-day telemetry TTL, unchanged since every prior run in this series.
- **Whether the gates are worth their cost**: still LIN-1661's open question, now with an expired rather than a live date attached (H3).

---

## Adversarial Second-Read

**Tier: Tier 2** (fresh-context sub-agent, dispatched with no memory of the report-writing turn — given the report file's path plus read access to the repo and the live `/api/proxy` instruments, and told to spot-check independently rather than trust the report's own citations).

**Question asked, verbatim:**

> "What is the largest item in this window that this report missed or misfiled?"

**Reader's answer, in full:**

> The largest missed/misfiled item is inside the report's own H4 ("Credential/identity defect cluster") — and it is not a subtle interpretive quibble, it includes a checkable factual error.
>
> H4 frames the window's rising credential/identity commit share (14.5% → 27.8%) as generic, worsening, "unowned" drag, and singles out LIN-1981 as "the cluster's open root-cause candidate," stating it "regressed from `In Progress` to `Todo` — re-confirmed live at write time," and recommending: "its regression from In Progress back to Todo **with no comment** is itself worth a human look — either re-claim it or record why it stalled." That "no comment" framing carries into the report's closing human-facing paragraph as one of the handful of headline takeaways.
>
> Both parts of that framing are wrong when checked against the actual ticket data (`GET /api/proxy/issues/LIN-1981` and `LIN-2231`, live-queried):
>
> 1. "No comment" is factually false. LIN-1981 carries seven detailed comments spanning 2026-08-10 through 2026-08-23. The most recent is a full close-out (2026-08-23T20:42): a PR (#1234, merged as `3409820`, CI green) landed a read-only diagnostic scan tool (`scripts/scan-mis-mirrored-workspaces-lin1981.js`) that was run against the local dev store (found zero flags) and is "built, tested, and ready for an operator with production access to run." The ticket was moved back to `Todo` twice, both times with explicit, stated reasoning: an operator policy that an `In Progress` ticket nobody is actively working "reads as assigned" and becomes invisible to scheduling, so `Todo` states the truth. The actual remaining blocker is that no session in this environment has `MONGODB_URI`/Railway production access to run the confirmation scan against real data — an infrastructure gap, not neglect. This is the opposite of "no comment" / unowned drift; it is unusually well-documented, disciplined ticket management that happens to render as a bare state-transition if you only query `state` and not `comments`.
>
> 2. H4 omits a major, now-fully-closed initiative that is the dominant driver of the very commit-share rise it's citing. `LIN-2231` ("One human, many accounts... root of the OWNER_MISMATCH / stale-credential family") was filed 2026-08-23 after a real production incident — "the fault that has now killed two autopilot runs (2026-08-22, twice)," `503 WORKSPACE_OWNER_MISMATCH`. It's a root-cause research ticket that unified seven previously-scattered credential defects (LIN-1982, LIN-2097, LIN-1983, LIN-1986, LIN-1507, LIN-1887, LIN-1413) under one diagnosed cause (session-mirror scan-and-rank selection instead of a durable keyed record), produced a five-layer implementation plan (Tickets A–E, LIN-2233–2237), and all five landed and closed (`Done`) within the window, on 2026-08-23/24. Several other window-D commits (LIN-2265, 2266, 2267, 2275, 2278, 2285, 2300) are direct extensions/class-siblings of this same initiative — e.g. LIN-2275/LIN-2278 fix the exact `selectOwnerWorkspaceRow`/`selectOwnerSessionRow` ranking functions LIN-2231's own finding names verbatim. LIN-2231's own scoping explicitly considered and ruled out LIN-1981 as unrelated ("a workspace-scalar mirroring bug... mechanism unrelated to the identity fork"), so the two aren't even the same defect family — the report's implication that LIN-1981 is "the" root-cause candidate for the whole rising cluster overstates its centrality.
>
> Put together: a large share of the window's credential/identity commit volume is not diffuse worsening drag but a single, deliberate, successfully-executed incident-response program closing out a real outage — exactly the kind of "genuine substrate finish, not whack-a-mole" distinction the report itself draws for H5 (the wake/resume chain vs. the outward-validation proxy cluster). H4 fails to apply that same discipline to its own subject matter, and additionally makes a checkable false claim about LIN-1981 being uncommented/unowned. The corrected picture is not "worsened, unowned, compounding" — it's "a disciplined, largely-successful incident-remediation effort, with one narrow, well-documented, genuinely infrastructure-blocked loose end (no session has production DB/log access to finish LIN-1981's confirmation step)." That's a materially different, more actionable headwind (a tooling/access gap, not a people/ownership gap) than what's written.
>
> I also seriously considered the outward-validation proxy/provider cluster (LIN-2350–2363, cited under H5) as a candidate for "under-ranked" — it represents a structural break in Harbour's non-Linear agent lane (500s instead of 422s on the most fundamental read, misattributed "Linear API request failed" errors, prompts telling GitHub workers to update "Linear") that bears directly on the north star's "a substrate 90% migrated is a liability" clause. But checking ticket states showed 4 of 9 findings already `Done` and one `In Progress` within ~24–48 hours of filing — that reads as healthy, fast self-correction rather than lingering drag, so I agree with the report's choice not to rank it as a standalone headwind.

**Verdict:** DISAGREE

**Differed from top finding:** YES — the reader's own answer names H4 (the credential/identity cluster's LIN-2231 omission and its false "no comment" claim about LIN-1981), not the report's own #1-ranked finding H1 (the north-star reading going from stale-confident to absent).

**Disposition: fixed in place.** The "no comment" claim about LIN-1981 is a checkable factual error, independently re-verified by this session directly against `GET /api/proxy/issues/LIN-1981` (7 comments confirmed, including the close-out citing merged PR #1234 / `3409820`) and `GET /api/proxy/issues/LIN-2231` plus its five sub-tickets LIN-2233–2237 (all confirmed `Done`) before any edit was made. H4 was rewritten in place with the correction stated explicitly and its provenance cited (per this series' standing convention of posting corrections rather than silently applying them — see 08-23's own Supersession section for precedent), severity re-graded from `high` to `medium`, and the report's closing human-facing paragraph and trend ledger updated to match. The document position of H4 was deliberately left unmoved (not renumbered/reordered against the other headwinds) so the correction stays traceable against the original draft rather than reading as if the error never happened.
