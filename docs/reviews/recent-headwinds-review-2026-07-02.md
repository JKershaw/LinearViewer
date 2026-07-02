# Recent Headwinds Review — 2026-07-02

*Advisory, review-only. Periodical: **Recent Headwinds** (LIN-542); review task: LIN-896. Sibling
of the Stability Review (LIN-453). This report mints no code changes and no follow-up fix-tasks — it
hands a maintainer a severity-ranked read of what has been dragging recent delivery toward the
[north star](../north-star.md), and leaves the decision to them.*

> **Correction run — supersedes the unmerged 2026-07-01 draft (PR #726).** A first pass of this
> review was written on 2026-07-01 and initially closed. On maintainer re-read it was re-opened
> because it **missed the largest headwind of the window**: a multi-day, fix-induced autopilot
> session-liveness defect cluster, which the first draft folded into "forward" capability work (H2)
> rather than flagging as a reliability headwind. This report re-grounds that cluster from scratch,
> ranks it as the top headwind, and corrects the H2 mis-categorisation. Everything else in the
> 07-01 draft that re-grounded cleanly is carried forward. The 07-01-dated file is retired in favour
> of this one.

> **Trend run.** Prior *merged* run: `docs/reviews/recent-headwinds-review-2026-06-25.md` (LIN-666),
> itself built on the `2026-06-18` baseline (LIN-543). Every headwind below is framed as a delta
> against the 06-25 run, using its **Trend Ledger** as the stable comparison surface. Stable names
> are carried verbatim; a name is retired only where the underlying condition has genuinely resolved.

## North star, in one line

LinearViewer/Harbour exists to *keep human intent in command of AI-accelerated execution* — to make
**where the work is** and **whether it is pointed somewhere worth going** legible faster than the work
can drift. Work is read as **forward** (sharpens drift-surfacing instruments / couples direction to
execution), **necessary maintenance** (keeps the workbench running without advancing
intent-legibility), or **drift** (capability without an intent-legibility purpose). The north star
(`docs/north-star.md`) is consumed verbatim and never re-derived here.

## Signals consumed (deterministic first)

- **Velocity / throughput / flow:** version-control history at HEAD (`git log`). As every prior run
  established, the proxy `/issues` list is capped at 250 and carries no `createdAt`/`completedAt` for
  a dated bulk set, so `lib/roadmap.js` `calculateVelocity`/`analyzeRoadmap` cannot be fed a dated
  issue set through the proxy; git merge cadence on `main` remains the honest deterministic velocity
  substrate. Issue-level dates for individual tickets were read via `GET /api/proxy/issues/{id}`,
  which does carry them.
- **Blockers / critical path / in-progress / backlog:** proxy `GET /api/proxy/stack?view=digest`
  plus `GET /api/proxy/issues?limit=250` (state, labels, priority, dates), read live at run time.
- **Bugs / defect cluster / canceled / overdue / stale:** Linear issue state, labels, and per-issue
  `createdAt`/`completedAt` via the proxy, read issue-by-issue for the cluster in H1 and for the
  specific deltas the task context flagged.
- **Direction drift:** produced by the LLM narrative layer (`lib/prompts/roadmap-north-star-template.js`),
  not a deterministic endpoint — a judgement read of recent merged work against the fixed north-star
  prose; the north star is consumed verbatim, never re-derived.

**Re-grounding (staleness check).** The files this task leans on — `lib/roadmap.js`,
`lib/prompts/roadmap-north-star-template.js`, `routes/proxy.js`, `docs/north-star.md` — show no
behaviour-changing commits since this ticket was created (2026-07-01T22:25Z) other than churn already
captured below. The cluster in H1 was re-grounded directly against the merge history at HEAD
(`lib/dispatch-terminal.js`, `lib/dispatch-wake.js`, `lib/dispatch-store.js`,
`lib/prompts/autopilot-kickoff.js`) and against each cited issue's live state — not against the 07-01
draft's prose.

## Windows (relative to now, 2026-07-02)

- **Immediate** — last few days (Jun 29 – Jul 2)
- **Recent** — last ~2 weeks (Jun 18 – Jul 2)
- **Baseline** — ~last quarter (Apr 2 – Jul 2); repo born 2026-01-04, **1,555 commits total** (up
  from 1,407 at the 06-25 run — **148 commits in ~7 days**).

---

## Headline read

**One real headwind this window that the first draft missed: an autopilot session-liveness defect
cluster with a fix-induced-adjacent-bug ("whack-a-mole") signature — the largest drag of the window,
and unresolved (its fix is too fresh to have proven the mechanism stable).** Around it the picture is
otherwise healthy and improving: velocity at an all-time high, two of the prior run's live headwinds
resolved, flow clean.

- **H1 (new, top-ranked): autopilot session-liveness / warm-drip cluster — five High-priority
  `Bug`-labelled issues in ~4 days, all in one subsystem, with a fix-induced-adjacent-bug pattern.**
  This is the headwind the 07-01 draft under-read. Detailed in F/H1 below.
- **Velocity is at a new all-time high.** Commits per ISO week: W23 → W27 = 108 → 122 → 96 → **224**
  → 82 (W27 partial, through Jul 2). W26 (224) is the busiest week in the repo's life, nearly double
  the prior record. Daily cadence Jun 26 – Jul 2: 20 / 11 / 10 / 18 / 19 / **44** / 1 (Jul 2 partial,
  morning only). The 06-27/06-28 dip is a weekend lull, not a stall — Mon–Wed ramped straight back to
  18/19/44.
- **`stale-in-progress` (H5) resolved.** LIN-379 (the 06-25 run's 15-day-stale item) completed the
  same afternoon that report shipped. The live In Progress set today is exactly **two** — this review
  task (LIN-896) and LIN-898 (Review/close-out ledger tuning, started today) — both fresh, neither
  stale. Positive baseline **held again at 0**.
- **`periodical-run-cancellations` (H1, 06-25) resolved — confirmed a false alarm.** The 06-25 batch
  cancellation was a self-caught off-path dispatch mistake (subagent-minted review tasks that skipped
  the real dispatch flow), re-run cleanly through the proper flow, with a documented side-by-side
  showing the proper run was better. No batch mint-then-cancel event has recurred in the week since.
  Retiring the name.
- **`observation-defect-cluster` (H4) eased, near-resolved.** The seven-bug Observation cluster from
  06-25 is fully closed and aged out of the recency window; the only Observation-adjacent fault this
  window is a single same-day-fixed flaky test (LIN-799, 06-29). Kept at near-zero severity, not
  retired, since the surface is still young. **Note:** the *pattern* it warned about — bug clusters on
  young, high-velocity surfaces — is exactly what recurred in H1, just on a different surface.
- **Two narrow positive-baseline regressions, both contained:** `reverts` 0 → 1 (Theme S1–S3 revert,
  redo shipped clean — F2); `bug-labelled (open)` 0 → 1 (LIN-753, now ~5 days open — F3).
- **Flow otherwise clean:** zero overdue, zero blocked (`heldBy` empty across the live stack digest).

---

## Findings (severity-ranked)

### H1 — Autopilot session-liveness cluster: five High bugs in ~4 days in the warm-drip / stepper subsystem, with a fix-induced-adjacent-bug signature · **Severity: Medium · worsening → unproven** · *new this run (the 07-01 draft mis-filed this as forward work)*

*Taxonomy: bugs / defect-escape **and** rework & churn (fix-on-fix). Stable name (new):
`autopilot-reliability-cluster`.*

**This is the largest headwind of the window and the one the first draft missed.** Five
`Bug`-labelled, **priority-2 (High)** issues were opened and closed in ~4 days (Jun 28 – Jul 1), all
in one subsystem: the autopilot's own **session-liveness / follow-up / warm-drip / stepper-coordinator
orchestration** — the machinery that dispatches agent sessions, holds them for follow-ups, and wakes
them across beats. This is the core "AI-accelerated execution" substrate the north star is about; a
drag here is a drag on everything the autopilot ships.

| Issue | Pri | Opened → Closed | What broke | Where fixed |
|-------|-----|-----------------|------------|-------------|
| LIN-768 | High | 06-28 → 06-28 (~7h) | Autopilot cross-check named the wrong feedback field ("feedback text fields are null") | Harbour (`ee4f168`, autopilot-kickoff cross-check) |
| LIN-778 | High | 06-28 → 06-28 (~3h) | Dispatched `review` session never reached a natural COMPLETED (agent idle, 0 tool calls, no sentinel) | runner (simple-dispatcher) |
| LIN-790 | High | 06-28 → 06-29 (~16h) | `claude --resume` unreliable — transcript written lazily, only on clean exit; killed sessions never flush | runner (clean-shutdown flush) |
| LIN-831 | High | 06-30 → 07-01 (~23h) | Session **wedges**: held at `AWAITING_FOLLOWUP` while waiting on its OWN async work — cannot be woken by its own completion | warm-drip HOLD semantics |
| LIN-881 | High | 07-01 → 07-01 (~2h) | Stepper beats carry the HOLD (`waitForFollowUps`) but not the WAKE (`subscribe`/`sessionId`) → `PENDING` wakes nothing → **deadlock at every beat boundary** | Harbour (`ed758ae`, default the WAKE half server-side) |

**Why this is a headwind and not "forward work" (the correction).** The 07-01 draft placed LIN-813 /
LIN-885 / LIN-836 / LIN-881 together in H2 as "forward / aligned — strengthens the autopilot's own
orchestration." That conflates two different things:

- **Capability delivery (genuinely forward):** LIN-826 (push-based inter-session comms), LIN-843
  (PENDING up-chain wake + stepper on push rails), LIN-845 (stepper beats hold via `waitForFollowUps`),
  LIN-813 (a coordinator can dispatch child autopilots), LIN-885 (child-dispatch variant policy),
  LIN-836 (stepper UI button). These build the warm-drip / coordinator mechanism.
- **Reliability fixes to that just-built mechanism (a headwind):** LIN-831 and LIN-881 are **defects
  in what was built days earlier**, not new capability. LIN-881's own description states the
  two-halves (HOLD + WAKE) model was "established in **LIN-845**" — i.e. LIN-881 is a gap *inside the
  LIN-845 mechanism*, surfaced one day after it landed. LIN-831 is the HOLD wedging a session against
  its own async work.

The build burst and the defect burst are the same subsystem, one day apart:

```
06-30  build:  LIN-826 (subscribe/wake foundation) → LIN-843 (PENDING wake + push rails)
               → LIN-845 (beats HOLD via waitForFollowUps)
06-30  defect: LIN-831 opened — the HOLD wedges a session on its own async work
07-01  defect: LIN-881 opened — beats got the HOLD but not the WAKE → deadlock at EVERY beat boundary
07-01  fix:    ed758ae — default the WAKE half server-side, don't rely on the agent
```

That is a **whack-a-mole / fix-induced-adjacent-bug signature**: stabilising one half of the warm-drip
mechanism keeps exposing the adjacent half. It is materially different from the 06-25 Observation
cluster, which was a one-time shake-out of a newly-promoted view with all bugs closed and no
fix-on-fix chain. Here the cluster is **in the orchestration engine itself**, spans **two repos**
(Harbour for the wake/hold wiring and kickoff prompts; the `simple-dispatcher` runner for
session-completion detection and `--resume` transcript flushing), and each increment revealed the next
missing piece. Corroborating churn signal: `lib/prompts/autopilot-kickoff.js` is a **top-10 most-churned
file** this window (20 commits/3wk), tracking exactly this stabilisation.

**Unresolved, by the honest read.** All five issues are individually **closed**, so nothing is
currently broken. But the mechanism is **new and its stabilisation is unproven**: LIN-881's fix
(`ed758ae`) merged only ~11 hours before the first draft was written, and as of this run (~1 day
later) the only subsystem-adjacent commit since is LIN-885 (a *policy/doc* change, not a bug fix) —
no *new* wedge/deadlock bug, but also far too short a window to call a mechanism stable that produced
a fresh High bug at nearly every increment over the preceding four days. Trajectory: **worsening**
through the window, now **watch/unproven** — not yet easing.

**Severity: Medium**, graded against this repo's own baseline (bug clusters are rare here and normally
same-day, single-surface, no fix-on-fix). It ranks above every other item this run because it is (a)
the only multi-day, self-reinforcing cluster; (b) in the core execution substrate; and (c) of unproven
stability. It is *not* graded High because every instance was caught fast and closed, and the subsystem
is being hardened deliberately rather than neglected.

**Remediation options (for a human to weigh):**
- **Do nothing structural; watch the next run.** If the immediate window to the next review passes with
  no further warm-drip/stepper reliability bug, the mechanism has likely stabilised and this name can
  ease → resolve. This is the lowest-cost option and may well be correct.
- **Add a characterisation/integration test around the two warm-drip halves** (HOLD without WAKE; WAKE
  without HOLD; a session waiting on its own async work) so the *next* adjacent gap fails a test rather
  than a live autopilot run. The whack-a-mole pattern is the classic signal that the mechanism's
  invariants are under-tested. *(Note only — this advisory review mints no task.)*
- **Treat "mechanism stabilisation" as an explicit, tracked state** rather than folding
  reliability-fix work into forward capability reporting — which is precisely the mis-read this
  correction fixes. Naming it keeps the next run honest about whether it eased.

### F2 — `reverts` baseline regression: Theme S1–S3 built and shipped without its design spec, caught same night · **Severity: Low** · *new this run (positive baseline 0 → 1)*

*Taxonomy: rework & churn / positive-baseline regression. Stable name (new): `reverts-baseline`.*

`b6e7cf2` (2026-06-28 07:27) is a genuine `git revert` of three merged PRs — LIN-756 (Theme S1
foundation), LIN-757 (Theme S2), LIN-758 (Theme S3) — removing ~1,000 lines across 20 files, reason
stated plainly: "built without the attached design spec." Contained, not systemic: the gap between
first merge and revert is under 15 hours (same overnight window), so the mis-scoped work did not
compound. The redo (LIN-785/786, 06-30/07-01) restarted from the correct spec and has since shipped
cleanly across a dozen-plus page migrations with no further reverts. One genuine revert in 1,555
commits is a low absolute rate, but it is a real change from the prior runs' clean `0`. (A second
revert exists in history — `f3e3b1a`, 2026-01-20, "Revert 'Add code review for direct commits to
main'" — but it predates the baseline quarter window and is a CI-config revert, not a delivery
revert; excluded from the count.)

**Remediation options:**
- None required — self-corrected within the same day; redo has landed cleanly and extensively.
- If "built without the attached design spec" reflects a recurring gap, a standing pre-flight check
  (confirm the design artifact is present/read before an implementation prompt is dispatched) would
  catch it earlier. Notably this is the *same class* of miss as H1's "mechanism built before its
  invariants were nailed down" — both are grounding-before-building gaps. *(Note only.)*

### F3 — `bug-labelled (open)` baseline regression: one narrow, unresolved bug · **Severity: Low** · *new this run (positive baseline 0 → 1)*

*Taxonomy: bugs / defect-escape / positive-baseline regression. Stable name (new): `open-bug-regression`.*

Exactly one open `Bug` this run: **LIN-753** — "'Pending' returned by sentinel when the thing that's
pending is outside the scope of the task" — created 2026-06-27, still Todo (~5 days old, `priority: 0`,
unpicked). A single narrowly-scoped item, not a cluster. Worth noting it is *thematically adjacent* to
H1 (both concern `PENDING`/sentinel semantics in the dispatch lifecycle), though it is a separate,
lower-severity issue.

**Remediation options:**
- None required at this severity. Worth a look if still open at the next run (that would indicate
  neglect rather than normal queue depth).

### H2 — Forward-vs-maintenance mix: still maintenance-heavy, one clean anti-drift signal · **Severity: Low–Medium · steady** · *unchanged vs prior (corrected: reliability-fix work removed from the "forward" slice)*

*Taxonomy: direction drift (soft, on-purpose) / velocity composition. Stable name: `forward-vs-maintenance-mix`.*

The dominant share of this fortnight's very high output is **necessary maintenance**:

- **Theme convergence (largest share):** the S1–S3 revert-and-redo (F2) followed by a long,
  disciplined wave of page migrations onto the shared token/primitive layer (Ship, Login, KPIs, Audit,
  Dispatch, Roadmap, Proxy, Swim, Observation, Swipe, tree-row status pills — LIN-850…861, 785/786).
  Workbench convergence, same class as the provider-unification / attachments programmes prior runs cited.
- **Attachments arc closing out:** LIN-889/890/891 completed agent attachment view/upload — execution
  substrate, not itself a north-star instrument.
- **Autopilot orchestration (mixed — this is the correction):** the warm-drip / coordinator *capability*
  (LIN-826/843/845/813/885/836) is genuinely forward — direction coupled to execution. But the
  reliability fixes to that mechanism (LIN-831, LIN-881) are **not** forward work; they are re-classified
  into H1. The first draft counted the whole autopilot arc as forward, which flattered the mix.
- **Forward / anti-drift (real):** **LIN-877 removed the Pipeline view outright** — flag, files, tests,
  docs, all deleted in one clean three-beat PR. Exactly the "graduate or retire" discipline the standing
  `experimental-net-new-surfaces` watch wants to see.

Net read: unchanged from prior runs — sanctioned, bounded maintenance dominates, with a real (if
smaller) forward slice, once the reliability-fix work is honestly moved out of it. Standing judgement
call is the same: once Theme convergence closes out, seat a forward intent-legibility item at the top
of the next cycle.

**Remediation options:** unchanged — let bounded Theme convergence finish, then seat a forward item
next cycle; or take no action and re-check the mix next run.

### H3 — `routes/proxy.js` churn concentration: rolling-window count essentially flat · **Severity: Low · steady (no longer worsening)** · *improved vs prior*

*Taxonomy: rework & churn (cited as a drag only — the convergence verdict is the Stability Review's,
LIN-453). Stable name: `proxy-churn-concentration`.*

Over the trailing three weeks `routes/proxy.js` remains the busiest file (**60** commits) but the
count is essentially flat vs the prior run's **59** (48 → 59 → 60 across the three runs) — growth has
slowed to +1 after two double-digit runs. `server.js` (50), `public/style.css` (35, the Theme wave),
`docs/proxy-integration.md` (33), and `CLAUDE.md` (30) round out the busiest files;
`lib/prompts/autopilot-kickoff.js` (20) is new to the top-10 and is the churn footprint of the H1
cluster. Fix-on-fix stays low overall (15 "fix"-word commits of 237 non-merge in the fortnight, ~6%,
comparable to prior runs) — the notable exception being the concentrated fix-on-fix *within* the H1
subsystem, which H1 owns.

**Remediation options:** defer to the Stability Review for the convergence verdict; no action indicated
by the delivery read.

---

## Resolved this run

- **`periodical-run-cancellations` (H1, 06-25) — resolved.** Self-caught off-path dispatch mistake,
  not scheduler churn; no batch cancellation recurred in the week since. Retiring the name.
- **`stale-in-progress` (H5, 06-25) — resolved.** LIN-379 closed the day the 06-25 report shipped; the
  live in-progress set is entirely fresh. Positive baseline holds at 0.
- **`observation-defect-cluster` (H4, 06-25) — near-resolved.** Cluster fully closed and aged out; one
  same-day flaky test only. Kept at minimal severity, not retired (young surface). Its *warning* —
  clusters on young high-velocity surfaces — recurred as H1 on a different surface.
- **`velocity-volatility` (06-18 baseline) — remains resolved/improved,** reinforced by the
  all-time-high W26.

---

## Watch-item (not yet a headwind) — experimental & foreign-backend net-new surfaces

Carried from both prior runs. The standing worry was net-new capability accumulating without
graduating or being retired. This run provides the first concrete counter-example: **LIN-877 removed
the Pipeline view outright.** That is the "graduate or retire" discipline the watch wants to see — a
mild positive against accretion. Remaining experimental views stay flag-gated under the view-tier
discipline (LIN-496). Recorded so the next run can tell whether this was a one-off or a pattern.

---

## Trend Ledger

Stable names for mechanical comparison by the next run. Severity: none / low / low–med / med / high.
Delta vocabulary: new / unchanged / improved / worsened / resolved.

| # | Headwind (stable name) | Class | Severity | Immediate | Recent | Baseline | Delta vs 2026-06-25 |
|---|------------------------|-------|----------|-----------|--------|----------|---------------------|
| H1 | `autopilot-reliability-cluster` | bugs / defect-escape + fix-on-fix | **med** | worsening → unproven | worsening | n/a | **new** (missed by 07-01 draft) |
| F2 | `reverts-baseline` | rework & churn / baseline regression | low | resolved (redo shipped) | contained | n/a | **new** (0→1) |
| F3 | `open-bug-regression` | bugs / defect-escape / baseline regression | low | steady (still open) | new | n/a | **new** (0→1) |
| H2 | `forward-vs-maintenance-mix` | direction / velocity composition | low–med | steady | steady | steady | unchanged (mix corrected) |
| H3 | `proxy-churn-concentration` | rework & churn (→ LIN-453) | low | steady | steady | steady | **improved** (59→60, flat) |
| — | `periodical-run-cancellations` | distraction / scope drift | none | n/a | n/a | n/a | **resolved** (was low–med, worsening) |
| — | `observation-defect-cluster` | bugs / defect-escape | low (near-none) | easing | easing | n/a | **improved** (cluster closed) |
| — | `stale-in-progress` | timeliness / flow | none | n/a | n/a | n/a | **resolved** (baseline 1→0) |
| — | `velocity-volatility` | velocity / throughput | none | strong | strongest-ever (W26) | volatile | unchanged (resolved/improved) |
| — | `experimental-net-new-surfaces` (watch) | direction drift (potential) | none/watch | improving | improving | n/a | **improved** (Pipeline view retired) |

Positive baselines tracked for regression (a *rise*/regression in any is itself a headwind):

| Baseline | Prior (2026-06-25) | This run (2026-07-02) | Status |
|----------|--------------------|------------------------|--------|
| `reverts` (per quarter) | 0 | **1** (b6e7cf2, Theme S1–S3, redo shipped clean) | **regressed** → F2 |
| `bug-labelled` — **open** | 0 | **1** (LIN-753, ~5 days open) | **regressed** → F3 |
| `bug-labelled` — **recent cluster** | 0 (Observation cluster closed) | **5 closed in 4 days** (autopilot subsystem) | **regressed** → H1 |
| `overdue` | 0 | 0 | **held** |
| `blocked` | 0 | 0 | **held** |
| `stale-in-progress` | 1 (LIN-379) | 0 | **improved / held again** |

---

## Plain-language read for the maintainer

The one thing that genuinely wants your attention this window is **the autopilot's own reliability**.
In four days at the end of June, five separate High-priority bugs were filed and fixed, all in the same
part of the system: the machinery that keeps dispatched agent sessions alive, holds them for follow-ups,
and wakes them between steps (the "warm-drip" / stepper / coordinator work). What makes this a headwind
rather than just "some bugs" is the *shape*: the mechanism was built on the 30th, and on the 30th and
1st defects surfaced **inside what had just been built** — most tellingly LIN-881, a deadlock at every
step boundary caused because the new "hold" half was wired without its matching "wake" half. That is
whack-a-mole: fixing one half keeps exposing the adjacent half. It sits in the core execution engine,
and it spans both the Harbour repo and the dispatcher runner.

All five bugs are closed, so nothing is broken right now — but the last fix landed only about a day ago,
which is far too soon to say the mechanism is stable given how reliably each change surfaced the next
bug. So the honest status is **open / unproven, not resolved.** The first draft of this report missed
this entirely — it counted the reliability fixes as "forward progress" alongside the genuine new
capability. They are not the same thing, and separating them is the main correction here.

The realistic options are: (1) do nothing structural and simply watch the next run — if a week passes
with no new warm-drip/stepper bug, it has stabilised; (2) add a small test around the hold/wake
invariants so the *next* adjacent gap fails a test instead of a live run; or (3) at minimum keep
tracking "mechanism stabilisation" as its own state so it doesn't quietly get folded back into
capability reporting.

Everything else is genuinely healthy. Velocity hit an all-time high (W26 was the busiest week the repo
has ever had). Two things the last report flagged have resolved — the periodical-cancellation scare was
the autopilot catching its own mistake, and the stale task closed. Two small new items are worth a
passing glance, neither urgent: the first-ever revert (three Theme PRs built without their design spec,
caught in 15 hours and redone cleanly), and one narrow bug open ~5 days (LIN-753). Proxy churn has gone
flat rather than climbing, and the Pipeline view was cleanly retired — a real anti-drift positive.

**No follow-up tasks have been created.** This is advisory; the decisions above are the maintainer's.
