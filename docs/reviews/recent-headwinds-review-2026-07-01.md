# Recent Headwinds Review — 2026-07-01

*Advisory, review-only. Periodical: **Recent Headwinds** (LIN-542); review task: LIN-896. Sibling
of the Stability Review (LIN-453). This report mints no code changes and no follow-up fix-tasks — it
hands a maintainer a severity-ranked read of what has been dragging recent delivery toward the
[north star](../north-star.md), and leaves the decision to them.*

> **Trend run.** Prior run: `docs/reviews/recent-headwinds-review-2026-06-25.md` (LIN-666), itself
> built on the `2026-06-18` baseline (LIN-543). Every headwind below is framed as a delta against the
> 06-25 run, using its **Trend Ledger** as the stable comparison surface. Stable names are carried
> verbatim; a name is retired only where the underlying condition has genuinely resolved.

## North star, in one line

LinearViewer exists to *keep human intent in command of AI-accelerated execution* — to make **where
the work is** and **whether it is pointed somewhere worth going** legible faster than the work can
drift. Work is read as **forward** (sharpens drift-surfacing instruments / couples direction to
execution), **necessary maintenance** (keeps the workbench running without advancing
intent-legibility), or **drift** (capability without an intent-legibility purpose). The north star
(`docs/north-star.md`) is consumed verbatim and never re-derived here.

## Signals consumed (deterministic first)

- **Velocity / throughput / flow:** version-control history at HEAD (`git log`). As both prior runs
  established, the proxy `/issues` list is capped at 250 and carries no `createdAt`/`completedAt` for
  a dated bulk set, so `lib/roadmap.js` `calculateVelocity`/`analyzeRoadmap` cannot be fed a dated
  issue set through the proxy; git merge cadence on `main` remains the honest deterministic velocity
  substrate. Issue-level dates for individual tickets were read via `GET /api/proxy/issues/{id}`,
  which does carry them.
- **Blockers / critical path / in-progress / backlog:** proxy `GET /api/proxy/stack?view=digest`
  (deterministic in-set ranking, `heldBy`) plus `GET /api/proxy/issues?limit=250` (state, labels,
  priority, dates).
- **Bugs / canceled / overdue / stale:** Linear issue state, labels, and dates via the proxy, cross-
  checked issue-by-issue for the specific deltas the task context flagged (LIN-379, LIN-891, the
  Theme revert).
- **Direction drift:** produced by the LLM narrative layer (`lib/prompts/roadmap-north-star-template.js`),
  not a deterministic endpoint. Per the fallback allowance, direction is a judgement read of recent
  merged work against the fixed north-star prose; the north star is consumed verbatim, never re-derived.

**Re-grounding (staleness check):** the files this task leans on (`lib/roadmap.js`,
`lib/prompts/roadmap-north-star-template.js`, `routes/proxy.js`, `docs/north-star.md`) show no
commits since this ticket was created (2026-07-01T22:25Z) other than one unrelated `routes/proxy.js`
touch already captured in the churn count below (LIN-891, merged 22:26Z, one minute after ticket
creation) — the task's description of the codebase is current.

## Windows (relative to now, 2026-07-01)

- **Immediate** — last few days (Jun 28 – Jul 1)
- **Recent** — last ~2 weeks (Jun 17 – Jul 1)
- **Baseline** — ~last quarter (Apr 1 – Jul 1); repo born 2026-01-04, **1,554 commits total** (up
  from 1,407 at the 06-25 run — **147 commits in 6 days**).

---

## Headline read

**The trajectory keeps improving, and both of the prior run's two live headwinds have resolved
outright.** Two new, narrow items surfaced in their place — both positive-baseline regressions,
both already contained.

- **Velocity is at a new all-time high.** Commits per ISO week: W23 → W27 = 108 → 122 → 96 → 158 →
  **224** → 81 (partial, 3 days). W26 (224) is the busiest week in the repo's life, nearly double the
  previous record. Daily cadence Jun 23 – Jul 1: 40 / 38 / 55 / 20 / 11 / 10 / 18 / 19 / **44**. The
  06-27/06-28 dip is a normal weekend lull (Sat/Sun), not a stall — Monday–Wednesday ramped straight
  back to 18/19/44.
- **`stale-in-progress` (H5) has resolved.** LIN-379, the 06-25 run's 15-day-stale item, completed
  the same afternoon that report shipped (`2026-06-25T13:51Z`). The live set today has exactly **two**
  In Progress items — this review task (LIN-896, just started) and LIN-871 (started 2026-07-01T07:41,
  ~16h old) — both fresh, neither stale. Positive baseline **regressed → held** (1 → 0).
- **`periodical-run-cancellations` (H1) has resolved, and turns out to have been a false alarm.**
  Reading LIN-379's own comment thread resolves the 06-25 mystery completely: the 11-task
  cancel-and-re-mint batch was a **self-caught process deviation, not scheduler churn**. The
  autopilot's first LIN-379 dispatch attempt minted the 11 review tasks (LIN-653–663) via in-process
  subagents — an off-path route that skipped the real dispatch flow and didn't pin Opus. It
  self-detected this and paused; a human then had it re-run all 11 through the proper
  `POST /api/proxy/dispatch` flow (LIN-664–674), the off-path batch was retired as Canceled, and a
  side-by-side comparison (documented in the same thread) confirmed the proper-flow batch was
  measurably better (concrete grounding vs hedges, correct periodical bodies — the off-path run had
  literally minted the wrong periodical into one slot). **No batch mint-then-cancel event has
  recurred since** — the individual cancellations in this window (LIN-694, 729, 747, 762–764, 809,
  844) are spread across six separate days, each a normal single-item replan (e.g. LIN-762–764 were
  superseded by the cleaner LIN-889/890/891 attachments phases), matching the healthy pattern the
  06-18 baseline described. Retiring this name.
- **`observation-defect-cluster` (H4) has eased further, nearly to resolved.** The seven-bug product
  cluster from 06-25 is fully closed and has aged out of the 250-issue recency window. The only
  Observation-adjacent fault this window is LIN-799 (`Flaky: observation.spec.js`, test-only, created
  and fixed same day 06-29) — a single, same-day-closed flaky-test fix, not a product defect wave.
  Keeping the name at **near-zero severity** rather than retiring outright, since a newly-promoted
  view is still the kind of surface worth a glance next run.
- **Two new, narrow positive-baseline regressions, both contained:**
  - **`reverts` moved 0 → 1 for the quarter** — confirming the task context's flag. `b6e7cf2` (06-28)
    reverted three merged PRs (LIN-756/757/758, "Theme S1–S3") because they were "built without the
    attached design spec" — ~1,000 lines removed within 15 hours of the first of the three landing.
    The work was then redone properly two days later (LIN-785/786 onward, 06-30 → 07-01) and has since
    shipped cleanly across a dozen-plus page migrations (Ship, Roadmap, Dispatch, Proxy, Audit, KPIs,
    Observation, Swim, Swipe, tree rows, login CTA — LIN-850 through LIN-861). Read as a fast,
    self-caught process correction, not thrash.
  - **`bug-labelled (open)` moved 0 → 1** — LIN-753 ("'Pending' returned by sential when the thing
    that's pending is outside the scope of the task"), created 2026-06-27, still open ~4 days. A
    single narrow-scope bug, not a cluster.
- **Flow otherwise stays clean:** zero overdue, zero blocked (`heldBy` empty across the live stack
  digest).

---

## Findings (severity-ranked)

### F1 — `reverts` baseline regression: Theme S1–S3 built and shipped without its design spec, caught same night · **Severity: Low** · *new this run (positive baseline 0 → 1)*

*Taxonomy: rework & churn / positive-baseline regression. Stable name (new): `reverts-baseline`.*

The 06-25 report's `reverts = 0/quarter` baseline no longer holds. `b6e7cf2` (2026-06-28 07:27) is a
genuine `git revert` of three merged PRs — LIN-756 (Theme S1 foundation, merged 16:08 the prior day),
LIN-757 (Theme S2, 21:58), LIN-758 (Theme S3, 22:41) — removing ~1,000 lines across 20 files. The
revert commit message states the reason plainly: "built without the attached design spec."

This reads as **contained, not systemic**: the gap between the first merge and the revert is under 15
hours (same overnight window), so the mis-scoped work did not compound across further PRs before
being caught. The redo (LIN-785 Theme S1, LIN-786 Theme S2, 06-30/07-01) restarted from the correct
spec and has since shipped across a long, clean run of page migrations through this run's immediate
window (Ship, Roadmap, Dispatch, Proxy, Audit, KPIs, Observation, Swim, Swipe, tree status pills,
login CTA) with no further reverts. One genuine revert in 1,554 commits is a low rate in absolute
terms, but it is a real change from the prior two runs' clean `0`.

**Remediation options (for a human to weigh):**
- None required — the miss was self-corrected within the same day and the redo has since landed
  cleanly and extensively. Recorded so the next run can tell a genuine revert-recurrence from this
  one-off.
- If "built without the attached design spec" reflects a recurring gap (a design asset not being
  attached/read before implementation starts), a standing pre-flight check (confirm the spec artifact
  is present before an implementation prompt is dispatched) would catch it earlier next time — a
  process note, not a code change. *(Note only — this advisory review mints no task.)*

### F2 — `bug-labelled (open)` baseline regression: one narrow, unresolved bug · **Severity: Low** · *new this run (positive baseline 0 → 1)*

*Taxonomy: bugs / defect-escape / positive-baseline regression. Stable name (new): `open-bug-regression`.*

Both prior runs held `bug-labelled (open) = 0`. This run has exactly one: **LIN-753** — "'Pending'
returned by sential when the thing that's pending is outside the scope of the task" — created
2026-06-27, still Todo (~4 days old, not yet picked up). It is a single, narrowly scoped item, not a
cluster, and carries no priority/urgency signal of its own (`priority: 0`, unset).

**Remediation options:**
- None required at this severity — one open bug after 4 days is not a backlog-rot signal on its own.
  Worth a look if it is still open at the next run (that would indicate genuine neglect rather than
  normal queue depth).

### H2 — Forward-vs-maintenance mix: still maintenance-heavy, with one clean anti-drift signal · **Severity: Low–Medium · steady** · *unchanged vs prior*

*Taxonomy: direction drift (soft, on-purpose) / velocity composition. Stable name: `forward-vs-maintenance-mix`.*

The dominant share of this fortnight's very high output is still **necessary maintenance**:

- **Theme convergence (largest share):** the S1–S3 revert-and-redo (F1 above) followed by a long,
  disciplined wave of page migrations onto the shared token/primitive layer — Ship, Pipeline, Login,
  KPIs, Audit, Dispatch, Roadmap, Proxy, Swim, Observation, Swipe, tree-row status pills (LIN-857,
  856, 861, 860, 859, 858, 855, 854, 853, 852, 851, 850, 786, 785, 783). This is workbench convergence,
  same class as the provider-unification / attachments programmes cited in prior runs.
- **Attachments arc closing out:** LIN-889/890/891 ("Attachments phase 1/2/3") completed the agent
  attachment-viewing/upload capability this run — necessary execution-substrate work (agents can now
  read and write attachments), not itself a north-star instrument.
- **Forward / aligned (smaller but real):** the child-autopilot / stepper-coordinator work (LIN-813,
  885, 836, 881) strengthens the autopilot's own orchestration — a direction-coupled-to-execution
  improvement in the same vein as the Suggested-Next-Run arc the 06-25 run called out. **LIN-877
  (deletion of the Pipeline view + its feature flag + tests + docs)** is a genuine anti-drift signal:
  it is exactly the "graduate or retire" discipline the standing `experimental-net-new-surfaces` watch
  wants to see, and is worth crediting explicitly (see watch-item note below).

Net read: unchanged from the prior two runs — sanctioned, bounded maintenance dominates, with a
real (if smaller) forward slice. The standing judgement call is the same: once the Theme convergence
programme closes out, seat a forward intent-legibility item at the top of the next cycle.

**Remediation options:** unchanged from prior runs — let the bounded Theme convergence finish, then
seat a forward item next cycle; or take no action and re-check the mix next run.

### H3 — `routes/proxy.js` churn concentration: rolling-window count essentially flat · **Severity: Low · steady (no longer worsening)** · *improved vs prior (worsening-ish → steady)*

*Taxonomy: rework & churn (cited as a drag only — the convergence verdict is the Stability Review's,
LIN-453). Stable name: `proxy-churn-concentration`.*

Over the trailing three weeks, `routes/proxy.js` remains the busiest file (**60** commits) but the
rolling-window count is essentially flat vs the prior run's **59** (48 → 59 → 60 across the three
runs) — the growth rate has slowed to +1 after two runs of double-digit increases. `server.js` (50),
`public/style.css` (35, the Theme wave), and `docs/proxy-integration.md` (33) round out the busiest
files; the attachments arc (LIN-889–891, 20 of the 60 proxy.js commits landed since the 06-25 report
alone) is this window's proxy contribution. Fix-on-fix thrash stays low (21 commits containing "fix"
as a whole word out of 345 non-merge commits in the window — ~6%, comparable to prior runs), and
`reverts` aside (F1), the churn remains additive feature work.

**Remediation options:** defer to the Stability Review for the convergence verdict, as before; no
action indicated by the delivery read.

---

## Resolved this run

**`periodical-run-cancellations` (H1, 06-25) — resolved.** See the headline read above: the 06-25
batch cancellation was a self-caught off-path dispatch mistake, not a scheduler bug, and has not
recurred in the six days since. Retiring the stable name; a genuinely new batch-cancellation event in
a future run would be a fresh finding, not a re-opening of this one.

**`stale-in-progress` (H5, 06-25) — resolved.** LIN-379 (the flagged item) completed the same day the
06-25 report shipped. The live in-progress set (2 items) is entirely fresh. Positive baseline holds
at 0 again.

**`observation-defect-cluster` (H4, 06-25) — nearly resolved.** The bug cluster is fully closed and
aged out of the recency window; only a single same-day-fixed flaky test remains this cycle. Kept at
minimal severity rather than fully retired, since the surface is still young.

**`velocity-volatility` (06-18 baseline) — remains resolved/improved,** now further reinforced by the
all-time-high W26.

---

## Watch-item (not yet a headwind) — experimental & foreign-backend net-new surfaces

Carried from both prior runs. The standing worry was net-new capability (Collective, Task Chat, Ship,
Next-Run, the GitHub-provider arc) accumulating without graduating or being retired. This run
provides the first concrete counter-example: **LIN-877 removed the Pipeline view outright** — feature
flag, page files, tests, and docs references all deleted in one clean three-beat PR. That is exactly
the "graduate or retire" discipline the watch wants to see, and is a mild positive signal against
accretion. The remaining experimental views stay flag-gated under the view-tier discipline (LIN-496).
Not a headwind; recorded so the next run can tell whether this was a one-off cleanup or the start of a
pattern.

---

## Trend Ledger

Stable names for mechanical comparison by the next run. Severity scale: none / low / low–med / med /
high. Delta vocabulary: new / unchanged / improved / worsened / resolved.

| # | Headwind (stable name) | Class | Severity | Immediate | Recent | Baseline | Delta vs 2026-06-25 |
|---|------------------------|-------|----------|-----------|--------|----------|---------------------|
| F1 | `reverts-baseline` | rework & churn / baseline regression | low | resolved (redo shipped) | contained | n/a | **new** (0→1) |
| F2 | `open-bug-regression` | bugs / defect-escape / baseline regression | low | steady (still open) | new | n/a | **new** (0→1) |
| H2 | `forward-vs-maintenance-mix` | direction / velocity composition | low–med | steady | steady | steady | unchanged |
| H3 | `proxy-churn-concentration` | rework & churn (→ LIN-453) | low | steady | steady | steady | **improved** (worsening-ish → steady; 59→60) |
| H1 | `periodical-run-cancellations` | distraction / scope drift | none | n/a | n/a | n/a | **resolved** (was low–med, worsening) |
| H4 | `observation-defect-cluster` | bugs / defect-escape | low (near-none) | easing | easing | n/a | **improved** (cluster closed, one flaky test only) |
| H5 | `stale-in-progress` | timeliness / flow | none | n/a | n/a | n/a | **resolved** (baseline 1→0) |
| — | `velocity-volatility` | velocity / throughput | none | strong | strongest-ever (W26) | volatile | unchanged (still resolved/improved) |
| — | `experimental-net-new-surfaces` (watch) | direction drift (potential) | none/watch | improving | improving | n/a | **improved** (Pipeline view retired, LIN-877) |

Positive baselines tracked for regression (a *rise*/regression in any is itself a headwind):

| Baseline | Prior (2026-06-25) | This run (2026-07-01) | Status |
|----------|--------------------|------------------------|--------|
| `reverts` (per quarter) | 0 | **1** (b6e7cf2, Theme S1–S3, redo shipped clean) | **regressed** → F1 |
| `bug-labelled` — **open** | 0 | **1** (LIN-753, ~4 days open) | **regressed** → F2 |
| `overdue` | 0 | 0 | **held** |
| `blocked` | 0 | 0 | **held** |
| `stale-in-progress` | 1 (LIN-379) | 0 | **improved / held again** |

---

## Plain-language read for the maintainer

Delivery keeps getting healthier, not worse. Velocity hit a new all-time high this window (W26 was
the busiest week the repo has ever had), and both of the two things the last report flagged for your
attention have resolved: the periodical-cancellation scare turned out to be the autopilot catching its
own process mistake and fixing it cleanly, not scheduler churn, and it hasn't recurred; the one stale
in-progress task closed the same afternoon the last report shipped, and everything currently open is
fresh.

Two small, narrow things are new and worth a passing glance, neither urgent:

1. **A design-spec miss led to a genuine revert** — three Theme PRs were built without their attached
   design spec, caught within 15 hours, and redone properly two days later (the redo has since shipped
   cleanly across a dozen-plus pages). This is the first real revert in the tracked history; it was
   fast and self-corrected, but it's worth knowing the "zero reverts" streak ended, and worth asking
   whether attaching/confirming the design spec before implementation starts should become a standing
   check.
2. **One narrow bug has been open for about 4 days** (LIN-753) — not a cluster, just worth not letting
   it age further.

Everything else — the proxy churn (now flat rather than climbing), the maintenance-heavy mix (with a
genuine positive: the Pipeline view was cleanly retired rather than left to linger), and the
Observation view's now-trivial defect trail — is low-severity and recorded for the next run's diff.
**No follow-up tasks have been created.** This is advisory; the decisions above are the maintainer's.
