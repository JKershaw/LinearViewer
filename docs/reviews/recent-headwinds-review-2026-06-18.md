# Recent Headwinds Review — 2026-06-18

*Advisory, review-only. Periodical: **Recent Headwinds** (LIN-542); review task: LIN-543. Sibling
of the Stability Review (LIN-453). This report mints no code changes and no follow-up fix-tasks — it
hands a maintainer a severity-ranked read of what has been dragging recent delivery toward the
[north star](../north-star.md), and leaves the decision to them.*

> **Baseline run.** No prior `docs/reviews/recent-headwinds-review-*.md` exists in the live
> `docs/reviews/` directory (siblings present: `drift-coherence-review-2026-06-10.md`,
> `drift-coherence-review-2026-06-11.md`, `comprehension-debt-review-2026-06-12.md`). Every finding
> below is therefore tagged **new (baseline)** — there is nothing yet to compute a delta against.
> This report is the baseline the next Recent Headwinds run measures against; use the **Trend
> Ledger** at the foot as the stable comparison surface.

## North star, in one line

LinearViewer exists to *keep human intent in command of AI-accelerated execution* — to make **where
the work is** and **whether it is pointed somewhere worth going** legible faster than the work can
drift. Work is read as **forward** (sharpens drift-surfacing instruments / couples direction to
execution), **necessary maintenance** (keeps the workbench running without advancing
intent-legibility), or **drift** (capability without an intent-legibility purpose).

## Signals consumed (deterministic first)

- **Velocity / throughput / flow:** version-control history at HEAD (`git log`), since the proxy
  `/issues` list is capped at 250 and carries no `createdAt`/`completedAt`, so the `lib/roadmap.js`
  `calculateVelocity`/`analyzeRoadmap` layer cannot be fed a dated issue set through the proxy. Git
  merge cadence on `main` (squash-merge-per-PR) is the honest deterministic substitute and is used
  as the velocity substrate here.
- **Blockers / critical path / in-progress / backlog:** proxy `GET /api/proxy/stack?view=digest`
  (deterministic in-set ranking) plus the full issue set (`/issues?limit=250`).
- **Bugs / canceled / overdue / stale:** Linear issue state, labels, and due dates via the proxy.
- **Direction drift:** the alignment classification (`aligned` / `necessary maintenance` / `drift`
  / `archive candidate`) is produced by the LLM narrative layer
  (`lib/prompts/roadmap-north-star-template.js`) and is **not** exposed as a deterministic proxy
  endpoint. Per the task's fallback allowance, direction is therefore a **judgement read of recent
  merged work against the fixed north-star prose** — the north star itself is consumed verbatim and
  never re-derived.

Re-grounding: the files this task leans on (`lib/roadmap.js`,
`lib/prompts/roadmap-north-star-template.js`, `routes/proxy.js`, `docs/north-star.md`) show **no
commits since the ticket was created** (2026-06-18T21:06Z), so the task's description of the codebase
is current.

## Windows (relative to now, 2026-06-18)

- **Immediate** — last few days (Jun 15–18)
- **Recent** — last ~2 weeks (Jun 4–18)
- **Baseline** — ~last quarter (Mar 18 – Jun 18); repo born 2026-01-04, 1,194 commits total.

---

## Headline read

**The trajectory is healthy.** This is not a hedge: across the full taxonomy the deterministic
signals are clean or positive.

- **Velocity is rising sharply.** Commits/PR-merges per ISO week: W21 → W25 = 22 → 78 → 108 → 122 →
  41(partial). The recent fortnight is the most productive stretch in the repo's life.
- **Zero reverts / rollbacks** in the entire last quarter.
- **No escaped or reopened defects:** zero `bug`-labelled issues in the live set.
- **Flow is clean:** exactly **one** issue is In Progress (LIN-543, this task), **zero** overdue,
  **zero** blocked (no `heldBy` in the stack digest). There is no stale-in-progress / WIP pileup.
- **Direction is on-mission:** the dominant recent work is *aligned* drift-defense instrumentation
  and *necessary maintenance*; net-new "drift" capability is a small, gated minority.

The headwinds below are real but **mild** — they are the things a maintainer might *watch*, not
things on fire. Severity is graded against the project's own healthy baseline, not against an
absolute.

---

## Findings (severity-ranked)

### H1 — Forward-vs-maintenance mix: most recent throughput is workbench upkeep, not intent-legibility gains · **Severity: Low–Medium** · *new (baseline)*

*Taxonomy: direction drift (the soft, on-purpose kind) / velocity composition.*

The recent fortnight's high output is dominated by **necessary maintenance** rather than **forward**
work in the north-star sense. Bucketing recent merges:

- **Necessary maintenance (large share):** the Providers & API Unification arc (LIN-306→311,
  LIN-330–356), the component/CSS convergence programme (Phase A/B: LIN-455–481, styleguide), client
  `fetch()`→`window.api()` migrations (LIN-495 waves A–F), resilient Linear fetch / error pages
  (LIN-508–511), free-tier wiring (LIN-512), E2E-onto-local-provider migrations.
- **Forward / aligned (healthy but smaller share):** the periodical review system and its run
  governors (LIN-341–354, LIN-369–371, LIN-453, **LIN-542** — this very periodical), recommendation
  grounding & routing (LIN-313, LIN-353, LIN-431, LIN-435, LIN-448), the autopilot dashboard
  (LIN-509), the roadmap narrative lede (LIN-416).

This is **not drift** — refactors that keep the workbench running are explicitly sanctioned by the
north star, and a convergence programme is finite by design. But a maintainer should be aware that
recent velocity is buying mostly *plumbing*, and the share of effort that directly sharpens
"intent-legibility" instruments is the minority. If this mix persists for several more cycles after
the convergence programme should have finished, it tips from maintenance into stall.

**Remediation options (for a human to weigh):**
- Do nothing — the convergence programmes (provider unification, component Phase B) are bounded and
  near completion; let them finish and the mix self-corrects.
- After the current convergence epics close, deliberately seat one *forward* intent-legibility item
  (e.g. Ship-view north-star orientation, direction-layer sharpening) at the top of the next cycle
  so the forward share rebounds.
- Add nothing new — just note the expected completion of the maintenance arc and re-check the mix at
  the next Recent Headwinds run.

### H2 — `routes/proxy.js` is a concentrated churn hotspot · **Severity: Low** · *new (baseline)*

*Taxonomy: rework & churn (cited as a drag only — convergence-trajectory analysis belongs to the
Stability Review, LIN-453).*

Over the last three weeks the most-touched source files are `routes/proxy.js` (48 commits),
`routes/workspace-api.js` (36), and `server.js` (30). The proxy in particular has absorbed a long
sequence of features (token auth, write endpoints, splice edits, dedupe, trashed-ghost handling,
free-tier metering, alias routes) and is the single busiest file in the tree. Repeated re-entry into
one file is a mild rework signal — each change re-reads and re-touches a growing surface.

**Whether this churn is *converging* (settling) or not is the Stability Review's call, not this
report's** — flagged here only as one drag among several. As a *delivery* read it is benign: the
churn is additive feature work, not fix-on-fix thrash (fix/bug-tagged commits are ~10% of the last
three weeks, with zero reverts).

**Remediation options:**
- Defer to the Stability Review for the convergence verdict; take no action here.
- If proxy re-entry continues at this rate, consider whether `routes/proxy.js` wants a structural
  split — but that is a *code-structure* judgement owned by the Drift & Coherence / Comprehension
  reviews, not this one.

### H3 — Velocity volatility: a near-zero mid-May lull preceded the June ramp; immediate window is light · **Severity: Low** · *new (baseline)*

*Taxonomy: velocity / throughput (volatility, not decline).*

Weekly cadence is **volatile**, not declining: ISO weeks W18–W19 had ~0 commits and W20 had 3,
followed by the W21–W24 ramp (22 → 78 → 108 → 122). The **immediate** window also reads light —
Jun 17 had 3 commits and Jun 18 (today, partial) 8 — but this is an artifact of a truncated current
week plus two quiet days against an exceptionally high recent baseline, not a downturn. `roadmap.js`'
`assessRisks` would not raise `velocity-declining` here; the two-week trend is firmly up.

**Remediation options:**
- None required — volatility around a rising mean is normal for a single-maintainer + autopilot
  cadence. Recorded so the next run can tell a genuine deceleration from this baseline's noise.
- If the *immediate* window stays light into the next run (sustained low daily cadence over a full
  week, not a partial one), re-examine for a real stall.

### H4 — Periodical-run cancellations: a tail of review/periodical tasks was canceled or deduped · **Severity: Low (easing)** · *new (baseline)*

*Taxonomy: distractions / scope drift — assessed and largely cleared.*

The canceled/duplicate set contains a cluster of **review-periodical runs** (LIN-359, LIN-360,
LIN-361, LIN-372, LIN-374, LIN-380/381, LIN-485) and a few routing/research spikes (LIN-296, LIN-383,
LIN-384, LIN-291/292/293). On its face a run of canceled tasks looks like scope churn. On inspection
it is mostly **deliberate hygiene**: duplicate periodical rows being closed (the duplicate-group leak
was fixed in LIN-345), superseded review runs, and research spikes that correctly concluded without
minting work — exactly the "don't auto-mint follow-ups" discipline this very review is built to
protect. This is the *system working*, not distraction. Trajectory: **easing** (the dispatch/dedupe
fixes that caused most of these cancellations have already landed).

**Remediation options:**
- None — this is healthy pruning. Recorded only so a future *spike* in cancellations (especially of
  non-periodical feature work) would stand out against this baseline as a genuine distraction signal.

### Watch-item (not yet a headwind) — experimental net-new surfaces

A small share of recent effort went to **net-new capability** surfaces — Collective (LIN-450), Task
Chat, and the Ship radial view (LIN-301, LIN-535). These are the recent items closest to the north
star's **drift** definition (capability that makes the tool *do more*). They are currently *gated
experiments* (per-user flags, low ongoing cost) and several carry plausible intent-legibility intent
(Ship orients by north-star alignment). Not flagged as a headwind today, but worth watching: if
experimental surfaces accumulate without graduating or being retired, they become drift by
accretion. The view-tier discipline (LIN-496) is the existing guardrail.

---

## Trend Ledger

Stable names for mechanical comparison by the next run. Severity scale: none / low / low–med / med /
high. Delta vocabulary: new / unchanged / improved / worsened / resolved.

| # | Headwind (stable name) | Class | Severity | Immediate | Recent | Baseline | Delta vs prev |
|---|------------------------|-------|----------|-----------|--------|----------|---------------|
| H1 | `forward-vs-maintenance-mix` | direction / velocity composition | low–med | steady | steady | steady | **new (baseline)** |
| H2 | `proxy-churn-concentration` | rework & churn (→ LIN-453) | low | steady | steady | worsening-ish* | **new (baseline)** |
| H3 | `velocity-volatility` | velocity / throughput | low | light (partial wk) | rising | volatile | **new (baseline)** |
| H4 | `periodical-run-cancellations` | distraction / scope drift | low | easing | easing | n/a | **new (baseline)** |
| — | `experimental-net-new-surfaces` (watch) | direction drift (potential) | none/watch | steady | steady | n/a | **new (baseline)** |

\* H2's convergence trajectory is the Stability Review's (LIN-453) call, not this report's; the
arrow is a delivery-side impression only.

Positive baselines worth tracking for regression (a *rise* in any of these would be the headwind):
`reverts` = 0/quarter · `bug-labelled-issues` = 0 · `overdue` = 0 · `blocked` = 0 ·
`stale-in-progress` = 0 (1 started = this task).

---

## Plain-language read for the maintainer

Recent delivery is in good shape and pointed broadly the right way. Velocity is at an all-time high,
nothing is on fire (no reverts, no escaped bugs, no overdue or blocked work, no WIP pileup), and the
work that's shipping is either drift-defense instrumentation (on-mission) or workbench refactors
(sanctioned). There is no severe headwind to act on.

The one thing genuinely worth a maintainer's attention is **H1**: a lot of the recent high output is
*plumbing* — provider unification and the component/CSS convergence programme — rather than new
intent-legibility capability. That is fine and expected while those bounded programmes finish. The
judgement call is simply *when* they should be considered done, so that the next cycle can put a
forward, north-star-advancing item back at the top instead of extending maintenance indefinitely.
Everything else (proxy churn, velocity volatility, the canceled-task tail) is low-severity noise
recorded so the next run has a baseline to compare against.

No follow-up tasks have been created. This is advisory; the decisions above are the maintainer's.
