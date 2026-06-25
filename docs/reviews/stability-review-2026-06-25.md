# Stability Review — 2026-06-25 (BASELINE)

*Advisory, trend-aware, review-only. Periodical: **Stability Review** (LIN-453); review task: LIN-673.
Sibling of the Recent Headwinds review (LIN-542). This report changes no code and **mints no follow-up
tasks** — it reads the project's *trajectory* (is the rate of change converging toward a settled state,
or spiralling?) and hands a maintainer a decision.*

> **Baseline run.** A search of `docs/reviews/` for `stability-*` at HEAD returns nothing — this is the
> **first** Stability Review. There is no prior run to diff against, so every signal below is recorded
> as a *baseline reading* under a stable name. The next run frames each as new / unchanged / improved /
> worsened / resolved against this report's **Trend Ledger**.

## What this review is (and is not)

This works at the **project-trajectory / rate-of-change** altitude: is the *whole project* converging
over time? It is deliberately distinct from its siblings, and does **not** re-flag their territory:

- A single complex module → **Code Quality Review**.
- A single duplication / convention split / dependency-direction issue → **Drift & Coherence Review**.
- Recent *delivery* drag / velocity composition → **Recent Headwinds Review**.

My finding is only ever a *pattern in the rate of change over time*. Where a signal is genuinely shared
(the proxy), I frame it at the trajectory altitude — *is its churn rate converging?* — not as a
structural defect. The Recent Headwinds run of 2026-06-25 (LIN-666) explicitly parked its
`proxy-churn-concentration` signal as *"the Stability Review's (LIN-453) call, not this report's"*; this
report picks that up (see S1).

## Grounding caveat (carried into every judgement)

The trajectory literature (relative churn predicting instability, code-decay indices, reliability-growth
convergence, Lehman's laws) is built on **human-team, long-lived, slow-change** systems. This is an
**agent-driven, very-high-churn** project. So no absolute threshold is imported; only the *shape* of the
idea is used — relative change, trend over windows, convergence toward a settled state — calibrated
against **this project's own history**. The discriminator throughout is the **trajectory of the relative
rate**, and **corrective (rework) vs. additive (growth)** change, never a raw count.

## Signals consumed (all built-in `git`, no new tooling)

- **Change history** = `git log` at HEAD (`8de7da5`, 2026-06-25). Repo born 2026-01-04;
  **1,410 commits total**, **556 in the trailing 30 days** — confirming the agent-driven high-churn
  profile the ticket described (re-measured, not imported).
- **Churn hotspots**: `git log --name-only | sort | uniq -c`, then weighted by lines-changed-per-touch
  (`--numstat`) and by file size (`wc -l`) — a raw touch count is not the signal; churn *relative to the
  size and age of what it touches* is.
- **Trend**: history sliced into ISO-week windows and compared.
- **Change-coupling**: files recurring in the same commit.
- **Corrective vs additive**: `fix:`/`Revert` prefixes vs `feat`/`LIN-`; file adds vs deletes.

## Windows

- **Immediate** — last 4 days (Jun 22–25; W26 is partial — 4 days, not 7).
- **Recent** — last ~5 weeks (W22–W26, the post-2026-05-20 high-velocity era).
- **Baseline-of-record** — full history (2026-01-04 → 2026-06-25, 1,410 commits).

---

## Headline read

**The project is in a healthy, very-high-velocity 0→1 *expansion*, and on the trajectory dimension that
distinguishes convergence from a spiral, it is converging — not thrashing.** The case:

- **Change is additive, not corrective.** In the last 30 days: **282** feature/`LIN-` non-merge commits,
  **1** conventional `fix:` commit, and **0** true `git revert`s. Rework is a rounding error against
  growth. Spirals are made of corrective churn; this history has almost none.
- **The codebase is growing, not churning in place.** Net **+80 source files** in 30 days (88 added, 8
  deleted under `lib/ routes/ public/`). High commit volume that *adds surface* is the signature of the
  0→1 phase the ticket calls out as healthy, not of an unsettled area being rewritten.
- **Velocity is rising, not volatile-high.** Commits/ISO-week W22→W26: **78 → 108 → 122 → 96 → 161**
  (W26 partial, 4 days; daily cadence Jun 20–25: 26/24/50/40/38/33). This is a still-climbing curve, not
  an asymptote — but for an agent-driven project mid-expansion, *climbing additive volume with
  near-zero rework* is convergence in the only sense that matters here (the project is settling its
  *way of working*, not its *volume*).

**One area is genuinely worth a maintainer's eye on the convergence question: `routes/proxy.js` (S1).**
Its churn rate is **flat-high and not settling**, it is the largest source file in the repo, and it is
the most-touched. But the diagnosis matters: it is a **hub surface** every feature routes through, not a
module being reworked — so its non-convergence is *expected in-flight programme churn*, not a spiral.
Severity is graded against this project's own healthy baseline.

---

## Findings (severity-ranked)

### S1 — `proxy-churn-concentration`: the proxy surface is flat-high and not settling, but the shape is hub-accretion, not thrash · **Severity: Low–Medium · watch**

*Altitude: rate-of-change of one surface over time. Picks up the signal Recent Headwinds (LIN-666)
parked for this review.*

`routes/proxy.js` is, on every raw axis, the standout:

- **Most-touched recent file**: 69 commits in 30 days (next: server.js 48, workspace-api.js 43).
- **Largest source file**: **4,496 lines** (next: workspace-api.js 3,019; app.js 2,132; server.js 2,088).
- **Heaviest churn-per-touch**: **~76 lines changed per commit** over the window (3,727 added / 1,613
  deleted) — vs server.js ~25 and meta-prompt-template.js ~9. So it is not just touched often; each
  touch moves a lot.
- **Trajectory is flat-high, not settling.** Weekly touches W21→W26: 1 / 9 / 18 / 13 / 19 / 12 (W26
  partial). There is no downslope; if anything the rate is sustained at its peak.

**Why this is `watch`, not `high`.** The discriminators all point to *expected* churn:

1. **It is hub-accretion, not rework.** The 30-day churn is spread across **~15 distinct tickets**
   (LIN-650, 615, 598, 591, 589, 584, 583, 581, 580, 579, 573, 569, 556, 537, 319…), each a *different*
   feature passing through the proxy — provider-layer migration (LIN-306/308/309/581 lineage), attachment
   relay (LIN-650), wire neutralization (LIN-579), response completeness (LIN-589). That is a file
   *every feature must touch*, not one feature being re-litigated. Hub churn ≠ instability churn.
2. **The churn is disciplined.** Its dominant change-coupling partners are its **own test and contract
   doc**: `tests/e2e/proxy.spec.js` (32 co-commits) and `docs/proxy-integration.md` (32). The proxy
   almost never changes without its test and its consumer contract moving with it. A thrashing surface
   sheds its tests; this one drags them along.
3. **It is mid-programme, with the boundary explicitly sequenced.** CLAUDE.md records the provider
   migration as in-flight with remaining work deliberately sequenced (e.g. `<source>:` namespace
   acceptance parked as LIN-544). A surface still being built to a known plan is *expected* to churn.

**The trajectory verdict (the call Recent Headwinds deferred):** the proxy's churn rate is **not
converging yet, and should not be expected to until the provider-unification programme closes.** It is
not spiralling — it is a large hub absorbing additive, well-tested, distinct features. The thing that
will *not* fix itself is the structural fact underneath: a 4,496-line file on the critical path of every
feature means churn stays concentrated there indefinitely. **Whether to split that surface is a
structural decision (Code Quality / Drift & Coherence altitude), not a trajectory finding** — I name it
so a maintainer can decide, and so the next Stability run can tell *settling* (rate falls as the
migration lands) from *runaway* (rate stays peak-high after the programme should have closed).

**Options a maintainer might weigh (no task minted):**
- Do nothing and re-check next run — if W27+ shows the rate falling as LIN-306-lineage work closes, this
  is healthy stabilisation and the row improves.
- If the rate stays flat-high after the migration lands, treat the file's *size/hub* nature as the root
  cause and refer a structural split to the Code Quality / Drift reviews — not to this one.

### S2 — `server-js-growth`: second hub, churn climbing · **Severity: Low · watch**

*Altitude: rate-of-change trend of one surface.*

`server.js` (2,088 lines) is the second-most-touched file (48 commits/30d) and its weekly trajectory is
**climbing**: W22→W26 = 7 / 5 / 13 / 11 / 17 (W26 partial). Churn-per-touch is moderate (~25 lines), and
it is the main entry point / dashboard-route host, so like the proxy it is a *hub* — many features add a
route or wiring here. Same shape as S1 at lower intensity: additive hub-accretion, not rework. Recorded
as a baseline watch because a climbing rate on a 2k-line entry-point file is the kind of thing that, left
unwatched, becomes the next proxy. Not a finding in its own right this run — no rework, no coupling
pathology. The next run should check whether the climb continues or flattens.

### S3 — `route-boundary-coupling`: proxy.js ↔ workspace-api.js change together · **Severity: Low · baseline**

*Altitude: change-coupling — areas whose boundary has not settled.*

`routes/proxy.js` and `routes/workspace-api.js` co-commit **12** times in 30 days — the only
*route-to-route* coupling of note (its other partners are the proxy's own test/doc). Two large route
files repeatedly changing together is a mild signal their boundary is still moving (both are consumer
API surfaces; features that touch one often touch the other). Low severity: 12 of ~70 proxy commits, and
both files are in the same active programme, so shared movement is expected. Recorded as a baseline so the
next run can see whether the two surfaces are *integrating* (coupling falls as the boundary settles) or
*entangling* (coupling rises). If it rises, the boundary itself is the Drift & Coherence review's call.

### S4 — `prompt-parity-coupling`: the both-paths prompt cluster moves together — **by design** · **Severity: None (clean) · baseline**

*Altitude: change-coupling. Recorded explicitly so it is NEVER mis-read as drift.*

`lib/prompts/meta-prompt-template.js` co-commits tightly with `tests/unit/prompt-templates.test.js` (20),
`lib/prompt-template-defs.js` (13), `lib/prompt-formatters.js` (13), `lib/prompt-templates.js` (10), and
`lib/openrouter.js` (8). On a naïve coupling scan this is a dense cluster that "won't settle." **It is
not a finding.** This is the CLAUDE.md-mandated *two-paths-plus-parity* discipline: every prompt-behaviour
change must update the handwritten path, the meta path, and the parity tests *in the same commit*. The
coupling is the rule working as designed — and the small churn-per-touch on the meta template (~9 lines)
confirms these are surgical, not structural, edits. Logged so a future run does not "discover" sanctioned
coupling and flag it. This row is healthy by construction.

### Clean baselines (re-checked; recorded for regression)

These are positive readings; a *rise* in any is itself a future finding:

- **`corrective-vs-additive-ratio` — clean.** 1 `fix:` / 282 feature / 0 reverts in 30 days. Rework is
  ~0.4% of change. This is the single strongest convergence signal in the repo.
- **`true-reverts` — clean.** 0 `git revert`s in 30 days (consistent with Recent Headwinds' 0/quarter).
- **`file-growth-vs-rework` — clean (expansion).** +80 net source files / 30 days → the project is in
  active 0→1 surface growth, the ticket's "healthy early churn" case, not in-place thrash.
- **`stagnation` — none observed.** No previously-active area has gone unexpectedly silent; the quiet
  files are quiet because they are *done*, not abandoned. (Hard to fully assess on a baseline with no
  prior run; flagged as a thing the next run can measure as a delta.)

---

## Trend Ledger

Stable names for mechanical comparison by the next run. Severity: none / low / low–med / med / high.
Delta vocabulary (for next run): new / unchanged / improved / worsened / resolved. All rows are
**baseline** this run.

| # | Signal (stable name) | Altitude / class | Severity | Reading this run | Trajectory | Baseline delta |
|---|----------------------|------------------|----------|------------------|------------|----------------|
| S1 | `proxy-churn-concentration` | surface rate-of-change | low–med | most-touched, largest, heaviest/touch; hub-accretion not rework | flat-high, **not settling** | baseline |
| S2 | `server-js-growth` | surface rate-of-change | low | 2nd hub; 48 commits/30d | **climbing** | baseline |
| S3 | `route-boundary-coupling` | change-coupling | low | proxy.js↔workspace-api.js ×12 | steady | baseline |
| S4 | `prompt-parity-coupling` | change-coupling | none (clean) | dense cluster — sanctioned by both-paths rule | steady by design | baseline |
| — | `corrective-vs-additive-ratio` | rework | none (clean) | 1 fix / 282 feat / 0 reverts | additive | baseline |
| — | `true-reverts` | rework | none (clean) | 0 / 30d | flat | baseline |
| — | `file-growth-vs-rework` | growth shape | none (clean) | +80 net files / 30d | expanding | baseline |
| — | `project-velocity-trajectory` | overall convergence shape | none (watch) | W22→W26 78→108→122→96→161 | rising (not asymptotic) | baseline |
| — | `stagnation` | silence-where-evolution-expected | none observed | none found | n/a on baseline | baseline |

*Run at HEAD `8de7da5`. Next run: re-ground every row against HEAD; mark unchanged / improved / worsened /
resolved / new. The two rows that carry the real question are **S1** (does the proxy rate fall once the
provider migration lands?) and **`project-velocity-trajectory`** (does the climbing volume flatten, or
keep rising?).*

---

## Plain-language read for the maintainer

**The project is not spiralling. It is in a fast, healthy build-out and converging on the dimension that
matters.** The clearest evidence is what's *absent*: across the last month of 282 feature commits there
was exactly one bugfix-prefixed commit and zero reverts. A spiral is made of rework — code thrashing as
fixes break other things — and there is essentially none here. The project is *adding* surface (+80 files
in a month), not rewriting the same surface over and over. That is the 0→1 expansion phase doing exactly
what it should.

The one place to keep an eye on is **the proxy** (`routes/proxy.js`). It is the busiest and by far the
largest file in the codebase, and its rate of change is flat-high with no sign of settling. The reassuring
part is *why*: nearly every feature has to pass through the proxy, and each change drags its tests and its
consumer-contract doc along with it — so this is a well-disciplined hub absorbing lots of distinct,
additive work, not an unstable module being re-litigated. It is *expected* to keep churning until the
provider-migration programme it's hosting finishes. The judgement call that is genuinely yours: that file
is ~4,500 lines on the critical path of everything, so even after the migration lands its churn will stay
concentrated there. If the next run shows the rate *still* peaked after the programme should have closed,
that's your cue to weigh splitting the surface — a structural decision, not something this brake should
auto-spawn work for. `server.js` is the same story one size down, and worth the same passive watch.

Everything else is either clean (rework ratio, reverts, no stagnation) or sanctioned by design (the dense
prompt-template coupling is the both-paths parity rule working, not drift).

**No follow-up tasks have been created.** This review is the governor, not the throttle: its job is to
tell you the project is converging and to point at the one surface whose convergence is worth watching —
the decision is yours.
