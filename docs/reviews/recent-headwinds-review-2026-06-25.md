# Recent Headwinds Review — 2026-06-25

*Advisory, review-only. Periodical: **Recent Headwinds** (LIN-542); review task: LIN-666. Sibling
of the Stability Review (LIN-453). This report mints no code changes and no follow-up fix-tasks — it
hands a maintainer a severity-ranked read of what has been dragging recent delivery toward the
[north star](../north-star.md), and leaves the decision to them.*

> **Trend run.** Prior run: `docs/reviews/recent-headwinds-review-2026-06-18.md` (the **baseline**).
> Every headwind below is framed as a delta against that run — new / unchanged / improved / worsened
> / resolved — using its **Trend Ledger** as the stable comparison surface. Stable names are carried
> verbatim so the next run can diff mechanically.

## North star, in one line

LinearViewer exists to *keep human intent in command of AI-accelerated execution* — to make **where
the work is** and **whether it is pointed somewhere worth going** legible faster than the work can
drift. Work is read as **forward** (sharpens drift-surfacing instruments / couples direction to
execution), **necessary maintenance** (keeps the workbench running without advancing
intent-legibility), or **drift** (capability without an intent-legibility purpose). The north star
(`docs/north-star.md`) is consumed verbatim and never re-derived here.

## Signals consumed (deterministic first)

- **Velocity / throughput / flow:** version-control history at HEAD (`git log`). As the baseline run
  established, the proxy `/issues` list is capped at 250 and carries no `createdAt`/`completedAt`, so
  `lib/roadmap.js` `calculateVelocity`/`analyzeRoadmap` cannot be fed a dated issue set through the
  proxy. Git merge cadence on `main` (squash-merge-per-PR) is the honest deterministic velocity
  substrate and is used as such here. Issue-level dates (createdAt/completedAt) for individual
  tickets were read via `GET /api/proxy/issues/{id}`, which *does* carry them.
- **Blockers / critical path / in-progress / backlog:** proxy `GET /api/proxy/stack?view=digest`
  plus the full issue set (`/issues?limit=250`, `hasNextPage=true` — the 250 most-recent slice).
- **Bugs / canceled / overdue / stale:** Linear issue state, labels, due dates via the proxy.
- **Direction drift:** the alignment classification is produced by the LLM narrative layer
  (`lib/prompts/roadmap-north-star-template.js`), **not** a deterministic proxy endpoint. Per the
  task's fallback allowance, direction is a **judgement read of recent merged work against the fixed
  north-star prose** — the north star is consumed verbatim, never re-derived.

Re-grounding: the files this task leans on (`lib/roadmap.js`,
`lib/prompts/roadmap-north-star-template.js`, `routes/proxy.js`, `docs/north-star.md`) show **no
commits since this ticket was created** (2026-06-25T11:07Z), so the task's description of the
codebase is current.

## Windows (relative to now, 2026-06-25)

- **Immediate** — last few days (Jun 22–25)
- **Recent** — last ~2 weeks (Jun 11–25)
- **Baseline** — ~last quarter (Mar 25 – Jun 25); repo born 2026-01-04, **1,407 commits total**.

---

## Headline read

**The trajectory remains healthy, and the previous run's two soft watch-points have moved in
opposite directions.** The deterministic core signals are still clean or positive:

- **Velocity is still at an all-time high and the immediate window is now strong, not light.**
  Commits/PR-merges per ISO week: W22 → W26 = 78 → 108 → 122 → 96 → **158 (partial, 4 days)**. Daily
  cadence over the last six days: 26 / 24 / 50 / 40 / 38 / 30. The prior run's H3 worry ("immediate
  window reads light") has **resolved** — there is no stall; if anything the immediate window is the
  busiest stretch in the repo's life. **98 PRs merged** in the last 16 days.
- **Zero true reverts / rollbacks** in the entire last quarter (6 `grep -i revert` hits are all false
  positives — body mentions of "reverted baselines" / "copy-revert behaviour" / a historical revert,
  none a `git revert` of recent work). The positive baseline `reverts = 0/quarter` holds.
- **Fix-on-fix thrash is low:** 5 conventional `fix:`-prefixed non-merge commits vs 258
  feature-prefixed in the last three weeks. The churn is additive, not corrective.
- **Flow is mostly clean:** **zero overdue**, **zero blocked** (`LIN-651/652` were blocked-by
  `LIN-649`, now Done → unblocked). WIP is 3 freshly-started slices plus one long-running task
  (see H6).
- **Direction is on-mission:** the dominant recent work is *necessary maintenance* plus a genuine
  *forward* delivery (the Suggested-Next-Run arc, LIN-603 — direction coupled to execution). Net-new
  "drift" capability is a small, gated minority.

Two things moved the wrong way and are worth a maintainer's eye, both **low-to-mild**:
**periodical-run cancellations spiked today** (H1, worsened) and a **defect cluster landed on the
newly-promoted Observation view** (H4, new). Neither is on fire. Severity is graded against the
project's own healthy baseline, not an absolute.

---

## Findings (severity-ranked)

### H1 — Periodical-run cancellations: a fresh 11-task batch was canceled today, one re-minted as this task · **Severity: Low–Medium · worsening** · *worsened vs prior (was Low, easing)*

*Taxonomy: distractions / scope drift. Stable name: `periodical-run-cancellations`.*

The single clearest delta since the baseline. Today (2026-06-25) an entire batch of **eleven
periodical review tasks** was minted within ~two minutes (LIN-653 at 10:39Z → LIN-663 at 10:41Z) and
**all canceled**:

- LIN-653 Documentation Review · LIN-654 Test Coverage Gap Review · LIN-655 Code Quality Review ·
  LIN-656 API Quality Review · LIN-657 Drift & Coherence Review · LIN-658 Stability Review ·
  LIN-659 Comprehension-Debt Review · LIN-660 Dependency & Supply-Chain Review · LIN-661 Security
  Review · **LIN-662 Recent Headwinds Review** · LIN-663 Design & Interface Review.

Then at 11:07Z **this task, LIN-666 (Recent Headwinds), was created** — i.e. LIN-662 was canceled and
the same periodical immediately re-minted under a new id. The baseline run rated this class **Low,
easing**, on the theory that the dispatch/dedupe fixes (LIN-345) had settled the duplicate-periodical
leak. A whole-batch mint-then-cancel-then-re-mint on a single day is that theory not holding for this
run.

This is most likely **scheduler/dispatch churn, not feature distraction** — the canceled rows are all
periodicals (zero feature work was canceled), so it does not represent abandoned product effort, and
re-minting a single review is cheap. But it is noise that (a) costs an autopilot dispatch cycle per
canceled row, and (b) erodes the cancellation signal itself: if batch cancel-and-re-mint is routine,
a future *genuine* abandonment of feature work will hide in the noise. The convergence/structural
question (is the periodical scheduler double-minting?) is a code concern owned by another review; the
*delivery* read is that the cancellation tail got thicker, not thinner.

**Remediation options (for a human to weigh):**
- Investigate whether the periodical scheduler / dedup (the LIN-345 lineage in `lib/periodicals.js` +
  dispatch dedupe) is minting whole batches that then need manual cancellation — if so, that is a
  small maintenance fix that removes a recurring per-cycle cost. *(Note only — this advisory review
  mints no task.)*
- Do nothing and re-check next run: if the batch-cancel pattern was a one-off operator action
  (manually clearing an auto-minted batch, re-dispatching selectively), it will not recur and the
  class returns to *easing*.

### H2 — Forward-vs-maintenance mix: still maintenance-heavy, but a genuine forward item shipped · **Severity: Low–Medium · steady (marginally improved)** · *unchanged vs prior*

*Taxonomy: direction drift (soft, on-purpose) / velocity composition. Stable name:
`forward-vs-maintenance-mix`.*

The recent fortnight's high output is still dominated by **necessary maintenance**, but the forward
share is healthier than the baseline read:

- **Necessary maintenance (large share):** the attachments/images arc (LIN-612 and slices
  LIN-649/650/651/652), the GitHub-provider arc (LIN-178/541 — foreign backend for the provider
  abstraction), proxy provider-selection (LIN-581), wire neutralization (LIN-579), Observation-view
  perf/bugfix wave (LIN-608–637), feedback widget (LIN-635/641).
- **Forward / aligned (smaller but real):** **the Suggested-Next-Run arc (LIN-603, 638–645)** — a
  view that generates grounded goal options for the next autopilot run, which is *direction coupled
  to execution* in the north-star sense; the task-snapshot archive (LIN-598, drift instrumentation);
  this very periodical-review system.

This is **not drift** — the maintenance is sanctioned workbench upkeep, and the convergence
programmes (provider unification, attachments) are bounded. The marginal improvement vs the baseline
is that LIN-603 is an unambiguous forward delivery, not just plumbing. The same standing judgement
applies: when the provider-unification / attachments epics close, deliberately seat the next *forward*
intent-legibility item at the top of the cycle so the forward share keeps rebounding rather than
extending maintenance indefinitely.

**Remediation options:** unchanged from baseline — let the bounded maintenance arcs finish, then
seat a forward item next cycle; or take no action and re-check the mix next run.

### H3 — `routes/proxy.js` churn concentration: still the busiest file, re-entry rate up · **Severity: Low · worsening-ish** · *worsened slightly vs prior*

*Taxonomy: rework & churn (cited as a drag only — the convergence verdict is the Stability Review's,
LIN-453). Stable name: `proxy-churn-concentration`.*

Over the last three weeks the most-touched source files are `routes/proxy.js` (**59** commits, up
from 48 at baseline), `server.js` (45), `routes/workspace-api.js` (36), and
`lib/prompts/meta-prompt-template.js` (33). The proxy absorbed another feature wave this fortnight
(attachment relay LIN-650, provider selection LIN-581, response-completeness LIN-589). Repeated
re-entry into one growing file is a mild rework signal.

As a *delivery* read it stays benign: the churn is additive feature work, not fix-on-fix thrash (5
conventional fixes in three weeks, zero reverts). **Whether this churn is converging is the Stability
Review's call, not this report's** — flagged here only as one drag among several.

**Remediation options:** defer to the Stability Review for the convergence verdict; if proxy
re-entry keeps climbing, a structural split is a *code-structure* judgement owned by the Drift &
Coherence / Comprehension reviews, not this one.

### H4 — Defect cluster on the newly-promoted Observation view · **Severity: Low · new (partly an instrumentation artifact)** · *new this run*

*Taxonomy: bugs / defect-escape. Stable name (new): `observation-defect-cluster`.*

The baseline run reported **zero** `bug`-labelled issues in the live set. This run sees **13** — but
the jump must be read carefully, because two things changed at once:

1. **Instrumentation changed.** LIN-548 ("Bug: Don't remove 'bug' tag", landed 2026-06-20) fixed
   prompts that were *stripping* the `bug` label on completion. Before that fix the live set
   genuinely showed zero bug-labelled issues partly because the tag was being removed. So the 0 → 13
   jump is **not** a clean defect surge; the measurement itself was repaired mid-window.
2. **There is nonetheless a real, concentrated defect cluster.** Seven `bug`-labelled issues —
   LIN-608, 609, 613, 617, 622, 623 (all created *and* fixed 2026-06-23) plus LIN-637 (06-24→06-25)
   — are all faults in the **Observation view**, which was promoted to first-class in LIN-595 the
   same week (cold-start latency, memory growth, "stuck on connecting", multi-subtask feedback). A
   newly-promoted, realtime, cross-workspace surface shipping a same-week bug wave is a genuine
   defect-escape signal.

Mitigating factors keep this **Low**: every one of the 13 is **completed/closed** (zero open
bug-labelled, zero reopened), most were fixed **same-day**, and the cluster is contained to one
just-promoted surface rather than spread across the tree. It reads as the expected shake-out cost of
promoting an experimental view to first-class under high velocity — not escaped defects rotting in
the backlog.

**Remediation options:**
- None required — the cluster is closed and contained. Recorded so the next run can tell a *new*
  defect surge from this one-time promotion shake-out.
- If a future promotion (experimental → first-class) produces a similar same-week bug cluster,
  consider a pre-promotion E2E/integration pass on the surface as a standing checklist item — the
  view-tier discipline (LIN-496) is the natural home for it. *(Note only — no task minted.)*

### H5 — Stale in-progress: one long-running task open 15 days · **Severity: Low** · *new this run (positive baseline regressed 0 → 1)*

*Taxonomy: timeliness / flow. Stable name (new): `stale-in-progress`.*

The baseline recorded `stale-in-progress = 0` (the only started item was that run's own review task).
This run has **LIN-379 "Run and validate each existing periodical once"** in **In Progress since
2026-06-10 — ~15 days**. The other three started items are fresh (LIN-652 today, LIN-612 06-23,
LIN-580 06-21) and are normal active WIP. LIN-379 is the genuine stale-in-progress item, and it is
notably the *periodical-validation* task — the same subsystem flagged in H1, suggesting the
periodical machinery is the current rough edge in both the flow and distraction columns.

`roadmap.js` `assessRisks` would raise a `stale-in-progress` flag for LIN-379 against the repo's
otherwise same-week cycle times. Severity is **Low** — it is one task, not a WIP pileup, and it is a
validation/ops task rather than blocked feature delivery.

**Remediation options:**
- Close out or explicitly park LIN-379 — either finish the periodical validation or move it back to
  backlog so it stops reading as stale WIP. *(Note only — no task minted.)*
- Do nothing if it is intentionally a slow background validation; re-check next run.

### Watch-item (not yet a headwind) — experimental & foreign-backend net-new surfaces

Carried from the baseline `experimental-net-new-surfaces` watch. The fortnight's net-new capability is
mostly the **GitHub-provider arc** (LIN-178/541) — a foreign backend for the provider abstraction. It
is closest to the north star's *drift* definition (capability that makes the tool *do more*), but it
rides the existing provider seam rather than adding an ungoverned surface, and the abstraction itself
is sanctioned workbench. The experimental views (Collective, Task Chat, Ship, Next-Run) remain
flag-gated under the view-tier discipline (LIN-496). Not a headwind today; watched so that net-new
capability accumulating without graduating or being retired would register next run.

---

## Trend Ledger

Stable names for mechanical comparison by the next run. Severity scale: none / low / low–med / med /
high. Delta vocabulary: new / unchanged / improved / worsened / resolved.

| # | Headwind (stable name) | Class | Severity | Immediate | Recent | Baseline | Delta vs 2026-06-18 |
|---|------------------------|-------|----------|-----------|--------|----------|---------------------|
| H1 | `periodical-run-cancellations` | distraction / scope drift | low–med | worsening | worsening | n/a | **worsened** (was low, easing) |
| H2 | `forward-vs-maintenance-mix` | direction / velocity composition | low–med | steady | steady | steady | unchanged (marginally improved) |
| H3 | `proxy-churn-concentration` | rework & churn (→ LIN-453) | low | steady | worsening-ish | worsening-ish* | worsened slightly (48→59) |
| H4 | `observation-defect-cluster` | bugs / defect-escape | low | easing | new | n/a | **new** |
| H5 | `stale-in-progress` | timeliness / flow | low | steady | steady | n/a | **new** (baseline 0→1) |
| — | `velocity-volatility` | velocity / throughput | none | strong | rising | volatile | **resolved/improved** (immediate now strong) |
| — | `experimental-net-new-surfaces` (watch) | direction drift (potential) | none/watch | steady | steady | n/a | unchanged |

\* H3's convergence trajectory is the Stability Review's (LIN-453) call, not this report's; the arrow
is a delivery-side impression only.

Positive baselines tracked for regression (a *rise*/regression in any is itself a headwind):

| Baseline | Prior (2026-06-18) | This run (2026-06-25) | Status |
|----------|--------------------|------------------------|--------|
| `reverts` (per quarter) | 0 | 0 (6 grep hits all false positives) | **held** |
| `bug-labelled` — **open** | 0 | 0 (13 total, all closed) | **held** (see H4 instrumentation note) |
| `overdue` | 0 | 0 | **held** |
| `blocked` | 0 | 0 (LIN-651/652 unblocked by LIN-649 Done) | **held** |
| `stale-in-progress` | 0 | **1** (LIN-379, ~15 days) | **regressed** → H5 |

---

## Plain-language read for the maintainer

Recent delivery is in good shape and pointed broadly the right way. Velocity is at an all-time high
*and* the last few days are the busiest stretch in the repo's history (the previous run's "immediate
window looks light" worry has resolved). Nothing is on fire: no real reverts, no open or reopened
bugs, nothing overdue or blocked, no WIP pileup. The work shipping is either workbench maintenance
(sanctioned — attachments, the GitHub provider, Observation hardening) or genuine forward work (the
Suggested-Next-Run view couples direction to execution).

Two things are worth your eye, both mild:

1. **The periodical machinery is the current rough edge.** An entire 11-task batch of periodical
   reviews was minted and canceled in two minutes this morning, and one (Recent Headwinds) was
   immediately re-minted as the task that produced *this* report — and the one long-running stale
   in-progress task (LIN-379) is also periodical-validation. None of this is abandoned *feature*
   work, so it is noise rather than drift, but it is recurring per-cycle noise. The one judgement
   call worth making is whether the periodical scheduler/dedup is double-minting batches that then
   need manual cancellation; if so, a small fix there removes a standing cost. (This advisory review
   deliberately mints no task for it.)

2. **The newly-promoted Observation view shipped a same-week bug cluster** (seven faults, all fixed,
   mostly same-day). That is the expected shake-out of promoting an experimental surface to
   first-class under high velocity — not escaped defects — but it is the kind of thing a
   pre-promotion E2E pass would catch next time.

Everything else (proxy churn, the maintenance-heavy mix, the foreign-backend watch) is low-severity
and recorded mainly so the next run has a baseline to diff against. **No follow-up tasks have been
created.** This is advisory; the decisions above are the maintainer's.
