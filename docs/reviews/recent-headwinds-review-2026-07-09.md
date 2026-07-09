# Recent Headwinds Review — 2026-07-09

*Advisory, review-only. Periodical: **Recent Headwinds** (LIN-542); review task: LIN-1166. Sibling
of the Stability Review (LIN-453). This report mints no code changes and no follow-up fix-tasks — it
hands a maintainer a severity-ranked read of what has been dragging recent delivery toward the
[north star](../north-star.md), and leaves the decision to them.*

> **Trend run.** Prior run: `docs/reviews/recent-headwinds-review-2026-07-02.md` (LIN-896), itself a
> correction of an unmerged 07-01 draft, built on `2026-06-25` (LIN-666) → `2026-06-18` baseline
> (LIN-543). Every headwind below is framed as a delta against the **07-02** run, using its **Trend
> Ledger** as the stable comparison surface. Stable names are carried verbatim; a name is retired only
> where the underlying condition has genuinely resolved. Nothing below is trusted from prior prose —
> every claim is re-grounded against live history at HEAD (`bcc0ed4`, 2026-07-09 13:34).

## North star, in one line

Harbour exists to *keep human intent in command of AI-accelerated execution* — to make **where the
work is** and **whether it is pointed somewhere worth going** legible faster than the work can drift.
Work is read as **forward** (sharpens drift-surfacing instruments / couples direction to execution),
**necessary maintenance** (keeps the workbench running without advancing intent-legibility), or
**drift** (capability without an intent-legibility purpose). The north star (`docs/north-star.md`) is
consumed verbatim and never re-derived here. **Alignment is not forward progress:** a reliability fix
to a north-star-aligned subsystem is *rework*, not forward delivery — the discipline the 07-02 run had
to install, applied again here.

## Signals consumed (deterministic first)

- **Velocity / throughput / flow:** version-control history at HEAD (`git log`). As every prior run
  established, the proxy `/issues` list is capped at 250 and carries no bulk `createdAt`/`completedAt`,
  so `lib/roadmap.js` `calculateVelocity`/`analyzeRoadmap` cannot be fed a dated bulk set through the
  proxy; **git merge cadence on `main` is the honest deterministic velocity substrate.** Per-issue
  dates were read via `GET /api/proxy/issues/{id}`, which does carry them. Each signal below names its
  substrate explicitly.
- **Blockers / critical path / in-progress / backlog:** proxy `GET /api/proxy/stack?view=digest`
  (`heldBy` empty across the live top-20; stack total 274) + `GET /api/proxy/issues?limit=250` (state,
  labels, priority), read live at run time.
- **Bugs / defect cluster / canceled / stale:** Linear issue state, labels, and per-issue dates via the
  proxy, read issue-by-issue for both clusters. The dispatch/session subsystem was re-grounded directly
  against merge history at HEAD (`lib/dispatch-wake.js`, `lib/dispatch-store.js`,
  `lib/dispatch-terminal.js`, `lib/prompts/autopilot-kickoff.js`) and each cited issue's live state.
- **Direction drift:** the LLM narrative layer (`lib/prompts/roadmap-north-star-template.js`) — a
  judgement read of recent merged work against the fixed north-star prose; the north star is consumed
  verbatim, never re-derived.

**Re-grounding (staleness check).** The trajectory-tooling files this task leans on — `lib/roadmap.js`,
`lib/prompts/roadmap-north-star-template.js`, `routes/proxy.js`, `docs/north-star.md` — show **no
commits since this ticket was created (2026-07-09T11:48Z)**. LIN-1165 merged after ticket creation
(13:34) but touched only `lib/dispatch-store.js` / `lib/dispatch-wake.js`, which this review reads as
*evidence*, not as tooling. Staleness check clean.

**Which signal tracks which outcome (honesty gate).** Git merge cadence tracks *throughput*, not
*forward delivery* — so velocity is reported separately from the forward/maintenance mix, and a rising
commit count is never read as rising forward progress. Issue `state`/`label` tracks *defect presence*,
not *severity of drag* — so the clusters are graded by pattern (fix-on-fix, concentration, open-vs-
closed), not by raw count. The `bug-labelled (open)` baseline counts label-bearing open issues; because
Linear's `Bug` label is applied loosely here (two of the open cluster items read closer to
refactor/enhancement — see H2), each cluster item is classified by reading its description, not by
trusting the label.

## Windows (relative to now, 2026-07-09)

- **Immediate** — last few days (Jul 6 – Jul 9)
- **Recent** — last ~2 weeks (Jun 25 – Jul 9)
- **Baseline** — ~last quarter (Apr 9 – Jul 9); repo born 2026-01-04, **1,770 commits total** (up from
  1,555 at the 07-02 run — **215 commits in 7 days**).

---

## Headline read

**The load-bearing call this run was whether `autopilot-reliability-cluster` proved out, eased, or
worsened. It did not ease — it persisted.** The 07-02 run set an explicit test: *if the window to the
next review passes with no further warm-drip / session-liveness reliability bug, the mechanism has
stabilised.* **That window did not pass clean.** Four more High-priority session-liveness / wake / close
bugs were filed *and* closed since 07-02 (LIN-924, LIN-946, LIN-1059, LIN-1165) — the last of them,
LIN-1165, filed and closed **today, the day of this review** — plus a tail of runner-side launch/resume
bugs. The fix-on-fix signature is now *provable in the same functions*: LIN-901 (07-02) added a
`kind:'wake'` self-loop guard; LIN-1165 (07-09) exists because that guard "was defeated by
`_resolveEdgeDoc`," and its fix commit also re-touches LIN-1059's selectivity. The mechanism is **still
unproven**, and the honest verdict is that it did **not** stabilise over the test window.

Around that, a **second, distinct concentration emerged that did not exist last run**: an *open* cluster
of High-priority bugs on the **dispatch-envelope / model-harness / feedback-widget** surface
(LIN-1132/1134/1135/1101/1083), riding directly behind the just-shipped per-task model+harness dispatch
feature. Its sharpest item, LIN-1134, is **externally induced**: a Claude Code prompt-injection defense
upgrade now trips on Harbour's own prompt-injection dispatch mechanism ("the same prompts as last week
don't work this week"). This is the un-forecasted headwind a diff-first method would have missed.

Everything else is healthy and improving: **velocity hit a new all-time high** (W27 = 237 commits, above
W26's prior-record 224); flow is clean (zero blocked, zero stale-in-progress, In Progress set all ≤4
days old); no new revert (the lone quarter revert is aging out); and there is a **genuine forward slice**
this window (two new periodical review-instruments, session-page legibility, task-chat grounding tools)
larger than 07-02's.

- **H1 (carried, top-ranked, DID NOT EASE): `autopilot-reliability-cluster`** — the session-liveness /
  wake / close / launch subsystem shed ≥4 more High bugs across the full window, one today, with
  provable same-function fix-on-fix. **Severity: Medium · still worsening → unproven.**
- **H2 (new, new baseline): `dispatch-envelope-cluster`** — 4 High + 1 Medium *open* Bug-labelled items
  on the just-shipped model/harness dispatch surface, incl. the externally-induced LIN-1134. **Severity:
  Low–Medium · worsening (accumulating).**
- **`open-bug-regression` (carried name) regressed hard: 1 → 8 open Bug-labelled.** LIN-753 (the 07-02
  single open bug) is now *Canceled/resolved*, but the open-bug population rose to eight, six of them in
  the dispatch/session surface — the name now points at H2, not at one stray ticket.
- **H3 `forward-vs-maintenance-mix` — steady.** A UI glow-up / navigation-redesign wave
  (LIN-1058/1042/1116/1131/1088) succeeds the closed-out Theme wave as the dominant maintenance slice;
  the forward slice (new periodicals, session legibility, task-chat tools) is real and a touch larger
  than last run.
- **H4 `proxy-churn-concentration` — steady/flat.** `routes/proxy.js` still busiest (59, was 60) but
  `server.js` (55) has nearly caught it.
- **New minor theme — `data-at-scale` (H12 / storage ceilings):** LIN-1021/1022/1030 (closed) and
  LIN-1101 (open, V8 string-length ceiling) — the workbench meeting real-usage scale limits. Low.
- **Resolved / held:** `stale-in-progress` held at 0; `periodical-run-cancellations` and
  `observation-defect-cluster` remain resolved/eased; `reverts` held at 1 (no new one, aging out);
  `blocked` held at 0.

---

## Findings (severity-ranked)

### H1 — `autopilot-reliability-cluster`: the session-liveness / wake / close / launch subsystem shed ≥4 more High bugs this window, one today, with provable same-function fix-on-fix · **Severity: Medium · worsening → still unproven (did NOT ease)** · *carried from 07-02; its named stability test failed*

*Taxonomy: bugs / defect-escape **and** rework & churn (fix-on-fix) **and** direction (rework on a
just-built mechanism). Stable name: `autopilot-reliability-cluster`.*

**This was the review's load-bearing question and the answer is no — the mechanism did not stabilise.**
The 07-02 run graded this cluster *unproven — too fresh to call stable* and named the honest test
verbatim: a clean window to the next review means it eased; adjacent bugs still surfacing means it
worsened. The window ran 07-02 → 07-09 and was **not** clean. Re-grounded from scratch against HEAD,
the same subsystem — the autopilot's session dispatch / hold / wake / close / up-chain-wake wiring plus
the runner's session launch/resume — produced a fresh run of High-priority reliability bugs:

| Issue | Pri | Opened → Closed | What broke | Layer |
|-------|-----|-----------------|------------|-------|
| LIN-924 | High | 07-02 → 07-03 | Session launch failures + slow starts under burst load (iTerm osascript window contention) | runner |
| LIN-946 | High | 07-03 → 07-03 | Autopilot sessions don't close their sessions once complete | Harbour close/cascade (`748f8dd`, `ca0d908`) |
| LIN-1059 | High | 07-05 → 07-05 | Up-chain wake edge severed by follow-up itemId repoint: subscribed stepper child terminal never wakes parent | `lib/dispatch-wake.js` (`5ef99be`) |
| LIN-1165 | High | **07-09 → 07-09** | Up-chain wake **self-loops** back into the producing session (the `kind:'wake'` guard defeated by `_resolveEdgeDoc`) | `lib/dispatch-store.js` (`7c15a7f`) |

Runner-side / launch-environment bugs in the same execution substrate this window reinforce it:
LIN-969 (Urgent — AppleScript syntax error in `launch.scpt`), LIN-951 (runner honor human-continued
skip), LIN-1147 (`copyHomeDotFiles` denylist too narrow → ENOSPC on large HOME), LIN-1098 (Urgent —
update the "Summarise this project" line for Claude Code), LIN-1124 (stepper beat-prompt path). Plus a
follow-on to LIN-946: LIN-1071 (07-05) *inverted the autopilot's session-closing default to
close-on-done* — a behavioural correction to the close mechanism LIN-946 had just built.

**Why this is the same headwind, not N healthy fast fixes — the fix-on-fix is now provable in one
function's history.** The up-chain-wake mechanism's own commit lineage on `lib/dispatch-wake.js`:

```
06-30  LIN-826  push-based inter-session comms (wake foundation)
06-30  LIN-843  PENDING fires an up-chain wake + stepper on push rails
07-01  LIN-813  child-autopilot dispatch
07-02  LIN-901  subscription enum + §5 bubbling matrix + kind:'wake' LOOP GUARD   ← guard added here
07-05  LIN-1059 route up-chain wake from the root subscribed dispatch (repoint bug)
07-09  LIN-1165 stop wake SELF-LOOPING — the LIN-901 loop guard "defeated by _resolveEdgeDoc"
                (fix commit also re-touches "LIN-1059 selectivity")
```

LIN-901 built a guard against exactly the self-loop that LIN-1165 then had to fix — the guard was
defeated, and the fix reaches back into LIN-1059's four-days-earlier code. That is the textbook
**fix-induced-adjacent-bug (whack-a-mole)** signature: stabilising one wake edge keeps exposing the
next. In a fix-forward project defects escape as adjacent re-filings rather than literal reopens, and
this is precisely that — same subsystem, same functions, successive High bugs. Corroborating churn:
`lib/dispatch-store.js` (21 commits/3wk) and `lib/prompts/autopilot-kickoff.js` (21) are both top-of-
churn this window, tracking exactly this stabilisation.

**Trajectory.** *Immediate* (Jul 6–9): **worsening** — LIN-1165 filed and closed today, on the very day
the test was to be graded. *Recent* (Jun 25–Jul 9): **worsening / unproven** — the cluster now spans
~11 days (06-28 → 07-09) and ~9 High bugs across two repos with no clean window yet. *Baseline*: n/a
(mechanism younger than the quarter). **It did not ease.** Do not read "everything is currently closed"
as "resolved": an unproven/watch item stays unproven until a clean window proves it, and this window was
not clean.

**Severity: Medium**, graded against this repo's own baseline (bug clusters here are normally same-day,
single-surface, no fix-on-fix). Held at Medium rather than raised to High because every instance was
still caught and closed fast, the subsystem is being hardened deliberately (not neglected), and nothing
is broken at HEAD. But it is unambiguously the top headwind: the only multi-day, self-reinforcing,
same-function cluster, in the core execution substrate, and — now with a second consecutive review
finding it unproven — a mechanism whose invariants remain under-tested.

**Remediation options (for a human to weigh):**
- **Add a characterisation / integration test around the wake+hold+close invariants** (self-loop; wake
  edge across a follow-up repoint; hold-without-wake; session waiting on its own async work; close-on-
  done). Two consecutive reviews have now found the *only* thing missing is that the next adjacent gap
  fails a live autopilot run instead of a test. This is the option the pattern most directly argues for.
  *(Note only — this advisory review mints no task.)*
- **Freeze the wake/close wiring surface for one clean window** — no new capability on
  `dispatch-wake.js` / `dispatch-store.js` until a review-to-review window passes with zero new
  reliability bug — to distinguish "stabilised" from "quiet because untouched."
- **Do nothing structural and re-test next run.** Lowest cost, but note this is the *same* option the
  07-02 run chose, and it did not produce a clean window — a third consecutive "just watch" would be
  choosing not to test the invariants that keep failing.

### H2 — `dispatch-envelope-cluster` (new): an *open* concentration of High bugs on the just-shipped model/harness dispatch surface, one of them externally induced · **Severity: Low–Medium · worsening (accumulating)** · *new this run — no prior row (new baseline)*

*Taxonomy: bugs / defect-escape (young-surface cluster) + necessary-maintenance rework, on a
just-built feature. Stable name (new): `dispatch-envelope-cluster`.*

The 07-02 ticket flagged the **dispatch / harness-model / feedback-widget** surface as a candidate new
concentration and asked whether it is a genuine emerging cluster or ordinary queue depth. Re-grounded
independently against HEAD: **it is a genuine emerging concentration.** Five High/Medium Bug-labelled
items, all *open*, all filed in a tight 07-06 → 07-08 window, all on the dispatch envelope / model-
harness / session-storage surface — and all riding directly behind a burst of just-shipped feature work
on that exact surface (LIN-438 07-03 "dispatch to specific models," LIN-1084 07-06 "harness + per-task
model dispatch," LIN-1138/1145/1159 07-08/09 model/harness overrides):

| Issue | Pri | State | What it is |
|-------|-----|-------|------------|
| LIN-1134 | High | In Progress | **Externally induced** — Claude Code's new prompt-injection defense trips on Harbour's bootstrap-token dispatch mechanism; last week's prompts no longer authenticate. Blocks the trust handshake the whole `cli`/`web` dispatch path depends on. |
| LIN-1135 | High | In Progress | Model/harness inheritance bug (kickoff endpoint stores `model`/`harness` as `null` → workers silently revert to consumer default), expanded into a dispatch-pipeline DRY cleanup |
| LIN-1132 | High | Todo | Feedback-widget dispatch doesn't carry harness/model options |
| LIN-1101 | High | Backlog | Session storage unreadable at scale — MangoDB collection hit the V8 string-length ceiling (also a `data-at-scale` item, below) |
| LIN-1083 | Medium | Todo | Claude Code sessions force-resume without checking the session is in use; web-controlled resume drops its flag (session-liveness adjacent — overlaps H1) |

**Signature differs from H1 — and that difference is the point.** H1 is *closed* fix-on-fix (defects
caught and patched fast, each exposing the next). H2 is *open accumulation*: a young feature shedding
defects faster than they are being cleared, so they queue. Neither is worse in the abstract, but H2 is
the one that will *become* an H1-style whack-a-mole if the fixes start landing on each other — worth
naming now, before the next review, precisely because it has no prior row. Two items (LIN-1135,
LIN-1134's "full cleanup") read closer to refactor/enhancement than defect despite the `Bug` label, so
this is graded Low–Medium, not Medium — but the *concentration* (six of eight open bugs sit on the
dispatch/session surface) is the headwind, not any single ticket.

**LIN-1134 deserves a maintainer's eye on its own merits.** It is not a self-inflicted defect and not
drift — it is an *environmental* headwind: an upstream Claude Code safety change now partially blocks the
core dispatch mechanism every autopilot run depends on. It cannot be closed by more prose in the prompt
(the ticket notes that is exactly what has stopped working); it needs a real proof-of-authority channel
(the ticket explores an MCP-injected credential). This is the single open item most able to drag *all*
delivery if it hardens, because it sits on the critical path of every dispatched session.

**Trajectory.** *Immediate*: **worsening** — the newest items (LIN-1132/1135, 07-07/08) are the
freshest and still open. *Recent*: **new** — did not exist at 07-02. *Baseline*: n/a. New baseline row.

**Remediation options:**
- **Prioritise LIN-1134 as an unblock, not a queue item** — an external dependency change on the
  critical path is different in kind from ordinary bug depth; a stalled dispatch handshake stalls every
  autopilot run. *(Note only.)*
- **Land the model/harness inheritance seam (LIN-1135) as one DRY fix rather than per-surface patches**
  — the surface is shedding the *same* "model/harness defaults not threaded" defect on kickoff, feedback
  widget, and workers (LIN-1132/1135); a single resolution seam pre-empts the whack-a-mole H1 became.
- **Re-check at the next run whether this cluster closed or hardened into fix-on-fix** — the delta that
  distinguishes "young-feature shake-out" (benign) from "H1 forming on a second surface" (not).

### H3 — `forward-vs-maintenance-mix`: still maintenance-heavy, now a UI-redesign wave; forward slice real and slightly larger · **Severity: Low–Medium · steady** · *unchanged vs 07-02*

*Taxonomy: direction (soft, on-purpose) / velocity composition. Stable name: `forward-vs-maintenance-mix`.*

The dominant share of this window's very high output is again **necessary maintenance**, with the wave
having rotated:

- **UI glow-up / navigation redesign (largest share, new wave):** LIN-1058 (Confident-CLI tab-strip nav
  redesign), LIN-1042 (page-level visual redesign, In Progress), LIN-1116/919 (`.cat` wordmark),
  LIN-1131 (rename Projects → Tasks + nav reorder), LIN-1088 (Projects as a nav item), LIN-1046
  (theme-aware shadows), LIN-984 (sticky shared header). This *succeeds* the closed-out Theme-convergence
  wave as the workbench-polish slice — same class as prior runs' Theme / provider-unification / attach-
  ments programmes.
- **Dispatch/session reliability + model/harness (rework + execution substrate):** H1 and H2 above.
  Per the alignment-is-not-forward rule, the reliability-fix portion is **rework, not forward**, and the
  model/harness capability is execution substrate (necessary maintenance), not an intent-legibility
  instrument.
- **Forward / anti-drift (real, and larger than 07-02):** two **new periodical review-instruments** —
  LIN-1038 (Performance / Scale periodical) and LIN-1039 (Data & Fetch Architecture periodical) — are
  net-new *drift-surfacing* instruments, dead-centre of the north star. Session-page legibility
  (LIN-1003/1004/1019/1024/1133 — per-run transcript, inline reply, `open ↗` link) makes autopilot runs
  legible. Task-chat grounding tools (LIN-1065/1066/1067/1073/1026 — get_comments / get_children_status
  / timestamps / read-model tools) couple direction to execution at the task altitude. This is a
  genuine forward slice, arguably a touch larger than last run's (which leaned on the single Pipeline
  retirement).

Net read: unchanged from prior runs — sanctioned, bounded maintenance dominates the volume, with a real
forward slice once rework is honestly moved out. No **drift** (capability without intent-legibility
purpose) detected: the UI redesign serves legibility of *where the work is*, and the model/harness work
is substrate. Standing judgement call is the same: once the UI-redesign wave closes out, seat a forward
intent-legibility item at the top of the next cycle.

**Remediation options:** unchanged — let the bounded UI-redesign wave finish, then seat a forward item
next cycle; or take no action and re-check the mix next run.

### H4 — `proxy-churn-concentration`: rolling-window count flat; `server.js` nearly caught up · **Severity: Low · steady** · *unchanged vs 07-02 (still improved on the worsening trajectory it had before)*

*Taxonomy: rework & churn (cited as a drag only — the convergence verdict is the Stability Review's,
LIN-453). Stable name: `proxy-churn-concentration`.*

Over the trailing three weeks `routes/proxy.js` remains the busiest file (**59** commits, essentially
flat vs the prior run's 60; the 48 → 59 → 60 → 59 sequence has plateaued). What is new is that
`server.js` (**55**) has nearly caught it, and the session/observation surface shows up strongly —
`routes/workspace-api.js` (27), `routes/dashboard.js` (24), `public/observation.css` (22),
`lib/render-settings.js` (22) — tracking the session-page and settings work. Fix-word commits stay low
overall (12 of 149 non-merge commits in the window, ~8%, comparable to prior runs); the concentrated
fix-on-fix within the H1 subsystem is owned by H1, not double-counted here.

**Remediation options:** defer to the Stability Review for the convergence verdict; no action indicated
by the delivery read. Worth a glance next run whether `server.js` takes the churn crown.

### F5 — `data-at-scale` (new minor theme): the workbench is meeting real-usage storage/timeout ceilings · **Severity: Low · steady** · *new this run — no prior row*

*Taxonomy: bugs / defect-escape (infrastructure-limit class). Stable name (new): `data-at-scale`.*

A small, mostly-closed cluster of infrastructure-ceiling bugs surfaced as accumulated dispatch/session
data grew: LIN-1030 (bound the dispatch-history read — live `/api/proxy/dispatch` H12 timeout), LIN-1021
(H12 on the per-session Observation page), LIN-1022 (H12 timeout *class* — issue-scope the sibling
reconstruct-by-id handlers) — all closed — plus **LIN-1101 (open, Backlog): session storage unreadable
at scale, MangoDB collection hit the V8 string-length ceiling.** This is largely a *healthy* signal —
these limits are hit because the system is carrying real usage — but it is a genuine, un-forecasted
theme worth naming so the next run can tell whether LIN-1101 (the one open item, a hard V8 ceiling that
does not resolve by waiting) got picked up or neglected.

**Remediation options:** none required at this severity; watch LIN-1101 specifically — a string-length
ceiling is a wall, not a slowdown, and will not improve on its own.

---

## Resolved / eased / held this run

- **`open-bug-regression` original item (LIN-753) — resolved.** The single open bug the 07-02 run
  tracked ("'Pending' returned by sentinel when the pending thing is out of task scope") is now
  **Canceled**. The *name* survives but now points at the H2 cluster, because the open-bug *population*
  regressed 1 → 8 (see baselines).
- **`observation-defect-cluster` — remains resolved/eased.** No new Observation *defect* cluster this
  window; the Observation-adjacent faults are the H12 *performance* fixes (F5), not a defect cluster.
  Kept retired-but-watched.
- **`periodical-run-cancellations` — remains resolved.** No batch mint-then-cancel recurrence.
- **`stale-in-progress` — held at 0.** The live In Progress set is five items (LIN-1166 this review,
  LIN-1137 dispatch-UI simplify, LIN-1135 + LIN-1134 the H2 bugs, LIN-1042 UI redesign), all created
  Jul 5–8 — the oldest is 4 days. None stale.
- **`reverts-baseline` — held at 1, aging out (improving).** No new revert since 07-02; the lone quarter
  revert (`b6e7cf2`, Theme S1–S3) is now ~11 days old and drifting toward the edge of the baseline
  window. Redo has shipped clean.
- **`velocity-volatility` — remains resolved/improved.** W27 = **237** commits is a new all-time-high
  week, above W26's prior-record 224; daily cadence Jul 3–9 (28/55/35/8/20/21/11) shows no stall (the
  Jul 6 dip to 8 is a Monday lull, recovered next day). Throughput is strong — reported separately from
  the mix (H3) so a rising commit count is not misread as rising forward delivery.
- **`experimental-net-new-surfaces` (watch) — steady/neutral.** No net-new experimental view accreted
  and none retired this window; the nav changes (LIN-1131 Projects→Tasks, LIN-1088) are consolidation,
  not accretion. Neutral.

---

## Trend Ledger

Stable names for mechanical comparison by the next run. Severity: none / low / low–med / med / high.
Delta vocabulary: new / unchanged / improved / worsened / resolved.

| # | Headwind (stable name) | Class | Severity | Immediate | Recent | Baseline | Delta vs 2026-07-02 |
|---|------------------------|-------|----------|-----------|--------|----------|---------------------|
| H1 | `autopilot-reliability-cluster` | bugs / defect-escape + fix-on-fix | **med** | worsening | worsening → unproven | n/a | **worsened** (test window not clean; did NOT ease) |
| H2 | `dispatch-envelope-cluster` | bugs / defect-escape (young surface) | low–med | worsening | new | n/a | **new** (candidate confirmed) |
| — | `open-bug-regression` | bugs / baseline regression | low–med | worsening | worsened | n/a | **worsened** (1→8; LIN-753 itself resolved) |
| H3 | `forward-vs-maintenance-mix` | direction / velocity composition | low–med | steady | steady | steady | unchanged (wave rotated to UI redesign; forward slice ↑) |
| H4 | `proxy-churn-concentration` | rework & churn (→ LIN-453) | low | steady | steady | steady | unchanged/flat (60→59) |
| F5 | `data-at-scale` | bugs / infra-limit | low | steady | new | n/a | **new** (H12/V8 ceilings) |
| — | `reverts-baseline` | rework & churn / baseline | low→none | easing | easing | n/a | **improved** (no new revert, aging out) |
| — | `observation-defect-cluster` | bugs / defect-escape | none | n/a | n/a | n/a | **resolved/held** |
| — | `periodical-run-cancellations` | distraction / scope drift | none | n/a | n/a | n/a | **resolved/held** |
| — | `stale-in-progress` | timeliness / flow | none | n/a | n/a | n/a | **held at 0** |
| — | `velocity-volatility` | velocity / throughput | none | strongest-ever (W27) | strong | volatile | **improved/held** |
| — | `experimental-net-new-surfaces` (watch) | direction drift (potential) | none/watch | steady | steady | n/a | unchanged (neutral) |

Positive baselines tracked for regression (a *rise*/regression in any is itself a headwind):

| Baseline | Prior (2026-07-02) | This run (2026-07-09) | Status |
|----------|--------------------|------------------------|--------|
| `reverts` (per quarter) | 1 | 1 (no new; aging out) | **held** (improving) |
| `bug-labelled` — **open** | 1 (LIN-753) | **8** (6 on dispatch/session surface) | **regressed** → H2 / `open-bug-regression` |
| `bug-labelled` — **recent cluster** | 5 closed in 4 days (autopilot) | autopilot cluster *continued* (≥4 more High, 1 today) **+** new open dispatch cluster | **regressed / persisted** → H1 + H2 |
| `overdue` | 0 | 0 (none surfaced) | **held** |
| `blocked` | 0 | 0 (`heldBy` empty across live stack) | **held** |
| `stale-in-progress` | 0 | 0 (In Progress set ≤4 days old) | **held** |

---

## Adversarial closure pass — what might this review have missed?

- **A non-dispatch defect cluster.** *Check run:* censused all closed Bug-labelled issues in the live
  `limit=250` set and grouped by subsystem. *Result:* outside the dispatch/session substrate, closed
  bugs are scattered and isolated (LIN-1023 task-chat rendering, LIN-1158 JSON 400/500, LIN-1088 nav CI)
  — no second concentration. The H12/storage items *do* form the small F5 theme, surfaced above. No
  hidden cluster found.
- **Is H2 real or just queue depth?** *Check run:* read each candidate's description (not the label) and
  cross-referenced filing dates against the model/harness feature merges. *Result:* genuine — five items
  in a 3-day window, all on one just-shipped surface, six of eight total open bugs concentrated there.
  Confirmed cluster, not noise. Two items are refactor-ish → graded Low–Medium, not Medium.
- **Did I default H1 to "eased" because nothing is broken at HEAD?** *Check run:* re-grounded
  `dispatch-wake.js` / `dispatch-store.js` commit lineage and each cited issue's live dates. *Result:*
  no — LIN-1165 closed *today* and its fix re-touches LIN-901's guard and LIN-1059's selectivity;
  explicitly graded did-not-ease.
- **Did I miss a stale/blocked/overdue item by trusting a cached digest?** *Check run:* live
  `stack?view=digest` (`heldBy` empty, total 274) + per-issue `createdAt` on all five In Progress items.
  *Result:* flow clean; oldest In Progress is 4 days.
- **Substrate honesty.** Velocity/cadence and all churn/revert/fix-on-fix figures are **version-control
  history at HEAD** (the proxy cannot supply a dated bulk set); issue states/labels/dates are the
  **live proxy**; direction is a **judgement read** against the fixed north star. Each is labelled at
  its use site. The one gap I cannot close deterministically is `overdue` (no dated bulk set through the
  proxy) — reported as "0 / none surfaced," not asserted as a hard 0.

---

## Plain-language read for the maintainer

The one thing that genuinely wants your attention, for the **second review running**, is the
**autopilot's own reliability** — specifically the machinery that keeps dispatched agent sessions alive,
wakes them between steps, and closes them when done. Last review flagged this and set a simple test:
if the next stretch passed with no new bug in that area, it had stabilised. It didn't pass. Four more
High-priority bugs landed in that exact machinery over the week — and the last one landed **today**, the
day this report was written. More tellingly, the fix for today's bug reaches back into code written five
days ago, and undoes a guard that was added a week ago to prevent this very failure. That is the
"whack-a-mole" shape: each fix keeps exposing the next gap in the same place. Nothing is broken right
now (every bug was closed fast), but "quiet because just-patched" is not the same as "stable," and this
is now two reviews in a row saying so. The honest status is **still open / unproven** — and the pattern
is pointing hard at one missing thing: a test around these session wake/hold/close rules, so the *next*
gap fails a test instead of a live run.

A **new** thing appeared this window that last review didn't have: a cluster of open bugs around the
freshly-built "pick a model / harness per task" dispatch feature. Five of them, all filed in three days,
still open. Most of these are ordinary young-feature shake-out. But **one is different and worth your
eye**: an upstream Claude Code safety upgrade now blocks Harbour's own way of handing prompts to agents
— "the same prompts as last week don't work this week." That sits on the critical path of every
dispatched run, and it can't be fixed with more reassuring prose in the prompt (that's what stopped
working); it needs a real proof-of-identity channel. It's not a mistake anyone made — it's the world
changing under the tool — but it's the open item most able to slow *everything* down if it lingers.

Everything else is genuinely healthy. Throughput hit a new all-time high (this was the busiest week the
repo has ever had). Flow is clean — nothing blocked, nothing stale, no new reverts. And there's real
*forward* progress this time, not just polish: two brand-new review instruments (this family of reports
is growing), and work to make autopilot runs and task history legible — which is exactly what the
product is *for*. The big visual redesign wave is polish, not drift; it's sanctioned and bounded.

If you act on one thing: **put a test around the session wake/hold/close rules** (H1) — the pattern has
now asked for it twice. If you act on two: **treat the Claude-injection block (LIN-1134) as an unblock,
not a queue item** (H2), because it's on the critical path of every run.

**No follow-up tasks have been created.** This is advisory; the decisions above are the maintainer's.

---

*Surface Assessment: lands cleanly — this is a review-only advisory report; producing it required no
structural change to the codebase.*
