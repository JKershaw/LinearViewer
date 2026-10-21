# Recent Headwinds Review — 2026-10-21 (advisory, trend-framed vs 2026-09-26)

*Advisory, review-only. Periodical LIN-542 (this run: LIN-3764). No code, config or secrets changed; no follow-up tasks minted.*

**Grounding.** `LinearViewer` @ `437dbfe7` (`main`, 2026-10-21) · `simple-dispatcher` @ `bb1da78` (`main`, last commit 2026-10-19). The prior run was 2026-09-26 (`recent-headwinds-review-2026-09-26.md`, LIN-3104, read in full including its ledger, method, *could not measure* list and second-read). **The interval is 25 days, not 7.** The `recent-headwinds` template was last dispatched 2026-09-26; no comparison below sets this window's counts against a 7-day window. Only per-active-day densities are compared.

**Series convention** is unchanged and was confirmed: `docs/reviews/recent-headwinds-review-YYYY-MM-DD.md` on a branch, PR to `LinearViewer` `main`, squash-merged as `LIN-NNNN: Recent Headwinds review — DATE (advisory) (#PR)`.

**What was re-derived and what was carried.** Re-derived live at write time: git census (both repos), tracker census (15 pages, 3,705 issues), `/north-star`, `/periodicals`, state of every ticket named as load-bearing, file-touch counts, line-growth counts, `lib/model-pricing.js`, `lib/periodical-runs.js`. Carried from the research record (LIN-3764 comment `8cc6899a`, 2026-10-21 10:02Z) and **not** re-fetched: the public `/kpis` payload (it is served by the app, not by the local `/api/proxy`; the local base returns 404 for it), the `/cost` session-kind sample, quoted ticket-comment text, and hand-classification of the 26 SD units. Each is marked where it appears.

---

## Method and its limits, stated first

- **Git windows use explicit `'YYYY-MM-DD 00:00'` bounds**, with `--until='2026-10-22 00:00'`. Substrate is `git log --first-parent` per repo. `LinearViewer` and `simple-dispatcher` are **never summed or averaged**.
- **Windows (relative to 2026-10-21):** *immediate* 10-18→ (4 days), *recent* 10-07→ (about 2 weeks), *baseline* 07-23→ (about a quarter). The interval 09-26→10-21 is 25 days. "Pre-window" is 06-26→09-26, the basis 09-26 used.
- **Density** is computed inline (`scripts/delivery-composition.mjs` still has no active-day density: `grep -c active` → 0). Active day = a day with at least one first-parent unit.
- **Cohort.** Window cohort = `LIN ≥ 3105` (first ticket after the 09-26 mint) = **658** tickets of 3,705 (full census, 0 `dueDate`). States: 412 Done, 150 Backlog, 45 Canceled, 33 Todo, 15 In Progress, 3 Duplicate.
- **`front:` labels are not a valid sizing basis any more.** Only **85 of 658** carry one; the cohort is labelled `kind:follow-up` 136, `Improvement` 83, `Bug` 69. 09-26's `front:` counts are **not comparable** with anything below.
- **Replacement tie-break basis: subsystem keyword buckets**, ordered first-match on the ticket title (case-insensitive), printed so the next run can reproduce them:
  1. *runner-kit / SD substrate*: `runner[- ]kit|runner\.mjs|wait-?loop|\bSD\b|simple[- ]dispatcher|dispatcher|opencode|reaper|pid|sigterm|heartbeat|watch-restart|wake|pending-external|beat\b`
  2. *code shape / coherence*: `code[- ]shape|coherence|drift|seam|tangle|refactor|dead code|duplicate|convergen|rebuild|consolidat|extract|rename|relabel`
  3. *auth / owner / token / privacy*: `auth|owner|token|credential|session expiry|csrf|login|privacy|identity|secret|permission|401|403`
  4. *research / papers*: `essay|paper|research|experiment|study|bakeoff|debrief|eval|survey|test[- ]plan`
  5. *task / run / share UI*: `ui|page|share|panel|button|dashboard|view|modal|css|layout|mobile|library|kpi|chart|lighthouse|contrast`
  6. *prompts / LLM / Flight Companion*: `prompt|llm|model|companion|observer|chat|claude|agent|flight`

  | bucket | tickets | bug-signal (label `Bug` or title `fix|bug|fail|broken|defect|throws|crash`) |
  |---|---|---|
  | runner-kit / SD substrate | 92 | **29** (highest) |
  | auth / owner / token / privacy | 82 | 20 |
  | code shape / coherence | 79 | 8 |
  | task / run / share UI | 97 | 18 |
  | research / papers | 51 | 6 |
  | prompts / LLM / companion | 48 | 7 |
  | unmatched | 209 | 31 |

  The rules are coarse (a third of titles match none, and a first-match order misfiles some). They size a cluster; they do not prove it. They give 92 for the runner-kit/SD bucket where the research record's different rule set gave about 107; the ordering of buckets by bug-signal is the same.
- **Root epic shown alongside, and it undercounts** (352 of 658 have no parent): LIN-3613 "Cycles" 65 (66 with the epic), LIN-2935 v1 62, LIN-3449 coherence loop 42, LIN-3549 code shape 40, LIN-751 23, LIN-3289 12, LIN-3535 9, no parent **352**.
- **Review-originated rule** (printed, and it over-matches): label `kind:follow-up` or `kind:review-residue`, or a description that cites `docs/reviews/*.md`. Result: 143 + 59 overlap-removed = **191 of 658 (29.0%)**. Add the periodical run tickets themselves and the two periodical-spawned programmes (LIN-3449, LIN-3549) and the research record's figure is about 250 (38%). Report the range 29–38%.
- **Not re-derived**: churn convergence (Stability Review LIN-453 owns it; cited, not re-run), the north-star alignment call (consumed; it is stale), the structure reviews (read for seams only).

---

# Headwinds, severity-ranked

Ranking is by stated severity (high, then medium-high, medium, low), then within a band by window-cohort footprint from the bucket table or by the enumerated member count. Aggregate-before-rank applies. **Presentation choice for the runner-kit / SD cluster:** it is **two headwinds, not one**. They share an unparented ticket cluster across two repos, but the mechanisms differ: the LV runner kit is fix-induced whack-a-mole in a just-built loop, while SD is a repair backlog that has stopped moving. Members are netted so no ticket is counted twice (SD tickets 3270/3343/3122/3118/3234/3758/3759 are SD-only; LIN-3495/3667/3685/3707/3669/3675/3676/3511/3741 are runner-kit-only).

## H1 — `review-layer-load`: the review layer is now a source of drag, the reverse of 09-26's "silent layer" · **high · new (worsening)**

- **Cohort share.** 191 of 658 cohort tickets (29.0%, rule above) are review-originated; 38% with run tickets and periodical-spawned programmes. In the research record, 46 of 84 ticket-review follow-ups are Backlog (carried, not re-fetched). Of the 191 matched here: 86 Backlog, 81 Done, 15 Canceled, 5 Todo, 3 In Progress, 1 Duplicate. **Backlog is the largest state for review-originated work.**
- **Line mass (corrected after the second-read).** Since `'2026-09-26 00:00'`, first-parent: `docs/reviews/` **+255,556 / −1,452** lines, but **246,300 (96%) are under `_evidence-*` directories** (captures, Lighthouse and data dumps, chiefly the Design Review beats `6b598226`, `9c07416a`). Review prose is **+9,256** lines against `lib`+`routes`+`public` **+77,925 / −39,801**, about 0.12 times. **Line mass is not evidence of drag and is not used for ranking**; the ticket share and the 10-21 mainline share carry H1.
- **Immediate window.** On 10-21 the first-parent log has 12 units; 11 are review work (`0b4bd287`, `821cf841`, `f25aa127`, `368588c7`, `437dbfe7`, and the Design Review beat chain `ada89a5b`, `7e8d175d`, `b3a9328d`, `6b598226`, `4404b7fa`, `9c07416a`, `6da7da1e`). Four of these (`7e8d175d`, `b3a9328d`, `4404b7fa`, `6da7da1e`) fix the Design Review's own beat output.
- **Cadence.** `drift-coherence` has five reports 10-11→10-19 (`drift-coherence-review-2026-10-11`, `-10-11-post-batch`, `-10-12`, `-10-18`, `-10-19`); at least two are gauge runs for the LIN-3449 loop, which is by design. Stability 10-21 F4 rates `review-layer-rate` as rising (cited, not re-run).
- **Counter-evidence.** Loops that own their findings convert well (Drift & Coherence 11 of 13 Done, Security 5 of 5 Done, carried from research). The drag sits in the loops whose findings land in Backlog un-owned.
- **Windows.** Baseline: layer silent then resuming (09-26 H1). Recent: heavy. Immediate: 11 of 12 mainline units. Trajectory: **worsening**.
- **Remediation options.** (a) Give un-owned review findings a convert-or-cancel date. (b) Cap beats per review per day, or require a review's own fixes to merge in one unit. (c) Do nothing: accept that the layer is the product while the project is in a charter of quality (LIN-3490). The maintainer's call.

## H2 — `runner-kit-waitloop-churn`: fix-induced whack-a-mole in a mechanism born 09-29 · **medium-high · new (worsening)**

- `lib/runner-kit/runner.mjs`: **18** first-parent touches since 09-26, **9 since 10-18**. First commits `00b304d1`/`b86e623f` (09-29).
- **Chain (quoted from tickets in the research record; states re-read live):** LIN-3495 → LIN-3667 ("Found in review of LIN-3495") → LIN-3685 ("Outside follow-up from LIN-3667") → **LIN-3707 Backlog** ("explicitly left out of LIN-3685's scope"; same failure shape). Separately LIN-3669 → LIN-3675/3676 (the one *fix-caused* link: "Since LIN-3669… the deferral never ends"). LIN-3741 (Backlog): "Six behavioural defects were filed against this loop."
- **Corrections to the task's orientation:** LIN-3416 (SD OpenCode) and LIN-3654 (`routes/runner-setup.js`) are **not** members of this chain.
- This is a recently built mechanism: the fixes are rework, **not** forward delivery, even though the runner kit is north-star-aligned. Stability F9 `runner-kit-convergence` rates it rising (cited).
- **Windows.** Baseline: did not exist. Recent: 18 touches. Immediate: 9 touches in 4 days. **Worsening.**
- **Remediation options.** (a) One owner ticket for LIN-3707/3741 that fixes the loop's escape paths together, not one defect at a time. (b) Add a property/soak test over the wait loop's exits before more point fixes. (c) Leave as is: the open items are Backlog and quiet.

## H3 — `simple-dispatcher-repair-concentration`: SD is stuck behind open repairs, not finished and quiet · **medium · worsened**

- **Throughput (SD, first-parent):** 26 units over 11 active days = **2.36/day** (recent 15/7 = 2.14; immediate 7/2 = 3.50), against pre-window **256/59 = 4.34**. The 26 units are hand-classified in the research record as 13 repair, 1 rework, 3 maintenance and 9 forward (5 of the forward units fall on 09-26 itself); **since 10-07, 11 of 15 are repair or rework**. The classification is carried, not re-derived.
- **Open repairs.** LIN-3270 (window-close SIGTERM on a reused pid group can take down the fleet) is **In Progress with its last comment on 2026-10-10**; the research record says its own live check failed that day with an uncaught `write EPIPE` and no follow-up exists. LIN-3343 (same class in `watch-restart.sh`) Backlog; LIN-3122 and LIN-3118 Todo; LIN-3234 Backlog; LIN-3758 and LIN-3759 filed today. 09-26's eleven residue items (LIN-2474/2476/2532/2542/2549/2564/2644/2652/2657/2668/2679) are unchanged per the research record.
- **Fork.** "SD is finished" is not supported: the SD forward runner work moved to the LV kit (H2) and SD tickets say the operator merges between runs, which throttles merges. "SD is stuck behind open repairs" is supported by LIN-3270's age and failed witness. The window cannot distinguish how much of the density drop is the merge throttle.
- **Remediation options.** (a) Decide LIN-3270: finish, re-witness, or close with the failed check named. (b) Sequence the pid-reuse class (3270/3343/3122) as one repair. (c) Accept the lower SD rate as a deliberate move of forward work to LV.

## H4 — `close-out-owner-gate-refiling`: the same predicate re-filed across three chains · **medium · new**

- Owner gate: LIN-3648 (10-18) → 3654/3655 → 3673 (10-19) → **LIN-3681 Backlog** (last comment 10-19): five tickets in two days.
- Close-out on a moved PR head: LIN-3418 → 3634 ("LIN-3418 step 2 was dropped"; Security 10-18 L10/55: "shipped only half its title") → 3657.
- PENDING-EXTERNAL wakes: 3661 → 3666 → 3671 → **LIN-3759 Todo** (filed 10-21, "deadlock seen 21 Oct").
- Open: LIN-3280, 3281, 3369, 3598. The 10-20 Railway incident is adjacent, not a link (the incident doc calls the parked LIN-3732 close-out "the right state"; LIN-3732 is Done 10-20).
- **Windows.** Baseline: not seen. Recent: three chains. Immediate: one filed today. **Worsening / watch.**
- **Remediation options.** (a) One close-out state-machine review before the next point fix. (b) Treat the chains as a deliberate hardening of a just-built gate and wait for a quiet window to judge it.

## H5 — `rebuild-wave-displacement`: the design-first rebuild displaced about three days of forward work · **medium · new**

- 10-13 and 10-14 were a budget hold (3 and 0 merges per the research record). **10-15→10-17: 30 LV first-parent units** (5, 10, 15, re-derived), classified in the research record as 22 rebuild/experiments, 6 consolidation and **0 forward** (classification carried). The charter's held forward batch landed 10-18→10-20 (`cb470984`, `0441adfb`, `15c3b42c`, `acadeeab`, per research).
- `experiments/` grew **+513,995** lines in the window (research: 8 merges; `d349e78c` +311.7k, `f4749b91` +158.9k, `509ed3fc` +41.4k). These are papers with data records: a displacement of attention, not of forward code, and line volume is not a drag measure.
- Convergence (Stability F1 "not instability", F2 "needs an owner decision") is **owned there and not re-run here**; this review owns only the displacement.
- **Windows.** Immediate: the forward batch has landed (**easing**). Recent: displaced. Baseline: no comparable wave. **Easing, unproven.**
- **Remediation options.** (a) Name an owner and a date for `experiments/` per Stability F2. (b) Keep forward work flowing in a separate lane during rebuilds.

## H6 — `north-star-reading-staleness`: the direction substrate is unavailable · **medium · new (regresses the 09-26 "confirm it stayed fresh" instruction)**

- Live `/api/proxy/north-star`: `reading.state` **stale**, `roadmap.state` **stale**, text/gap/narrative empty, `reportGeneratedAt` **2026-09-19** (32 days against `maxAgeDays` 14). `docVersion.drift` is `false` (current hash equals stamped hash, v3).
- **Different mechanism from `north-star-version-drift`**, which stays **resolved**. Research record: the reading regenerates only when someone saves a roadmap report through the session-auth `POST` (`routes/workspace-api-roadmap.js:179,597`); `lib/scheduler.js` has no roadmap job.
- **No alignment call is made or rewritten here.** The proxy below is a labelled fork, not an alignment reading: tickets under the V1 passage chain (LIN-2935/3099/3490) are **9.6%** (63) by parent chain; **31.6%** (208) adding tickets named in 3099/3490 and the LIN-3449 loop; **41.6%** (274) adding LIN-3613 (which cites `docs/v1.md`). Alignment is not forward progress: LIN-3613 is about 20 forward, 24 repair and 21 code-shape/relabel by its own account (its 10-20 note: "most of the drop is the map becoming true"); LIN-3449 and LIN-3549 are rework by design.
- **Remediation options.** (a) A scheduled refresh job for the reading. (b) A staleness alarm on the periodical gate. (c) Regenerate by hand now and accept the reading is manual.

## H7 — Timeliness / flow hygiene · **medium · worsened**

- 17 tickets In Progress besides this one (census: 18 including LIN-3764): LIN-751, 1687, 2114, 3144, 3195, 3196, 3270, 3279, 3339, 3352, 3353, 3355, 3357, 3441, 3449, 3490, 3549. Research: 15 of 17 have no comment in over 7 days.
- Four read In Progress though their work already merged: LIN-3144, 3195, 3196 (essays/checks, merged 09-29/10-01) and LIN-3355 (code merged 10-08, unverified because "there is no live turn to observe"). LIN-3441 stopped on a ruling 10 days ago (last comment 10-11). LIN-1687 is the oldest at 84 days without a comment.
- **0 of 3,705 issues carry a `dueDate`**, so this is flow health, never schedule health. True time-in-progress is not measurable (no state-history endpoint).
- **Remediation options.** (a) A sweep closing the four merged-work tickets. (b) A staleness rule on In Progress.

## H8 — `periodical-cadence`: uneven rather than silent, and the registry misses hand-filed runs · **medium · changed (silent → uneven)**

- Live `/periodicals`: 16 templates; **7 `never`** (`test-coverage-gap`, `security-review`, `api-quality`, `comprehension-debt`, `dependency-supply-chain`, `performance-scale`, `data-fetch-architecture`); 2 `due` (`integration-surface-maturity`, `onboarding-journey`); 7 `recent`.
- **Instrument defect.** `security-review` reads `never` although `docs/reviews/security-review-2026-10-18.md` landed. `lib/periodical-runs.js:111-120` credits a row only by `periodicalId` or an exact `promptName` match; LIN-3419 was hand-filed without the gate marker. The registry therefore **misses out-of-template runs**, and "never" overstates silence.
- Cadence flipped from silent to uneven, not to over-firing: siblings fired often, three templates did not. LIN-2328 and LIN-1629 remain Todo.
- **Remediation options.** (a) Credit hand-filed runs by report filename. (b) Dispatch the 7 `never` templates, or retire those not wanted.

---

## Lower-severity items

- **`credential-defect-cluster` · low-medium · still active (unproven/watch).** LIN-1981's blocker LIN-2953 has been Done since 10-10, but LIN-1981 is still Todo, last comment 2026-09-19. LIN-3421/3424/3506 Done; LIN-3572, 3411, 3348 Backlog. New and high but Done: the LIN-3642 login CSRF (Security 10-18). Auth bucket: 82 tickets, 20 bug-signal.
- **`ci-platform-incidents` · low-medium · new.** `docs/incidents/2026-10-19-mongodb-kernel-ci.md` (CI degraded about 2h, mitigated by #1990). **LIN-3698 (latent production risk) is Backlog**, no comment. LIN-3739 flake is Done, but `retries: 2` means green does not prove it fixed. CI wall time 5.27 → 6.94 min (Stability F3/F14 own it).
- **Distractions · low · worsened but concentrated.** 48 of 658 Canceled or Duplicate (**7.3%**; 09-26 read 2.2% on its cohort). Research: 12 of 48 are two test-plan trees that spiralled (LIN-3519 with 8, LIN-3201 with 4). Research/papers/essays: 65 cohort tickets in the research record's rule; 51 in this report's title bucket.
- **`jira-adf-rebuild-residue` · low · new, not whack-a-mole.** `lib/providers/jira/adf.js` has 6 first-parent touches, 0 since 10-18. The three rewrites were planned experiments under LIN-3549. One fix-caused link (3557 → LIN-3561, fixed about 3h later) and one control gap, LIN-3559. LIN-3558/3562/3563/3568 Backlog; LIN-3562 appears to duplicate Done LIN-3564. This **corrects the orientation's "fix-induced chain" framing.**
- **LIN-3613 "Cycles"** (66 tickets, the largest root epic, 41 of the immediate window's 118 LV units per research, the orientation never named it) is not a headwind in itself; its mix is about 20 forward, 24 repair, 21 code-shape.

# Improvements and resolutions

- `unpriced-model-gap` **resolved**: `lib/model-pricing.js` prices `anthropic/claude-fable-5.1` (line 133) and the opus-5.5 and sonnet-5.5 rows; LIN-3094 Done 10-18.
- `opencode-harness-churn` **easing**, not worsening: LIN-3354 Done; LIN-3355's code merged 10-08 and the ticket is one stalled verification. Only the fix-caused link is LIN-2837's flat 60-min bound found by LIN-3352's RCA.
- `rulings-substrate-churn` **easing**: `routes/proxy-rulings.js` 2 first-parent touches (was 11), `lib/unanswered-decisions.js` 7 (was 13). LIN-3441 is stopped on a ruling.
- `flight-companion-build-concentration` **easing**: `routes/flight-companion.js` 17 first-parent touches, 5 since 10-18; only 23 cohort tickets descend from LIN-751 (18 Done per research).

# Delivery throughput — per-window fork

First-parent, per repo, never summed. Active days carry at least one unit.

| window | `LinearViewer` units / days / per day | `simple-dispatcher` units / days / per day |
|---|---|---|
| pre-window 06-26→09-26 | 913 / 80 / **11.41** | 256 / 59 / **4.34** |
| baseline 07-23→ | 1,028 / 79 / **13.01** | 150 / 45 / **3.33** |
| interval 09-26→ | 447 / 25 / **17.88** | 26 / 11 / **2.36** |
| recent 10-07→ | 270 / 14 / **19.29** | 15 / 7 / **2.14** |
| immediate 10-18→ | 118 / 4 / **29.50** | 7 / 2 / **3.50** |

LV daily units 10-18→10-21: 34, 45, 27, 12. **Fork, not one figure:** LV density is up, SD is down. The LV immediate window is a **burst** (41 of its 118 units descend from LIN-3613 per research), and Stability 10-21 records net source growth of about 0, so LV's rise is volume and rework, not forward growth. Two active days in SD's immediate window make that density unreliable. Public `/kpis` (instance-wide, 12 workspaces, dispatch lineages finished `done`, not tracker Done and not per-repo; carried from research, not re-fetched) is a labelled cross-check only.

# Signals that would produce a false reading — named, not published as trends

- **`front:` labels** (85 of 658): not comparable with 09-26; bucket sizes here are a different instrument.
- **Bucket rules are coarse**: 209 titles match none; first-match order misfiles some.
- **Review-originated rule over-matches**; report 29–38%, never one figure.
- **Right-censored Done share**: 62.6% Done (412/658) against 43% last run is a different-length, right-censored window, not a trend.
- **`/kpis`** is instance-wide: not this project's velocity.
- **Periodical registry** misses hand-filed runs (H8): `never` is not silence.
- **SD density on 2 active days** (immediate) and **LV burst** (118 units in 4 days).
- **`/cost` session-kind sample** (carried: 12 tickets, 92 sessions, 7.67/ticket incl. `wake`; `close-out` now the largest kind at 18.5%): new kinds make `verification-session-share` not comparable with 09-26.
- **Hand classification** of the 26 SD units, the 148 LV merges since 10-14, and the 10-15→10-17 composition are carried from research and not machine-reproducible.

# What this review widened into, beyond the task's named checklist

The subsystem-bucket cross-check over the 352 unparented tickets (titles only here; a descriptions cross-check was not run); the review layer as a drag source (H1); the periodical registry as an instrument (H8); the `docs/incidents/` set; and `docs/reviews/v1-passage-debrief-2026-10-10/the-hand-on-the-helm.md` (about 324 steering moves; after the prompt turn John's cuts rose from 9% to 15% and corrections of the agent from 4 to 21: "more of his steering went into trimming what I added", carried from research).

# For the human, in one paragraph

The biggest drag this cycle is the review layer itself (H1, high): it is now about 29–38% of the new tickets, mostly parked in Backlog, with 11 of today's 12 mainline units being review work. Next is a just-built mechanism generating its own bugs, the LV runner-kit wait loop (H2). SD is not finished and quiet: it is stuck behind open repairs, led by LIN-3270 (failed witness 10-10, no follow-up). Close-out and owner-gate predicates are being re-filed (H4); the rebuild wave cost about three days of forward work and has since eased (H5). The direction substrate is stale 32 days, so no alignment call can be made (H6). Flow hygiene is poor: four In Progress tickets are already merged (H7). Unpriced models are fixed. Every remediation option is for a maintainer to weigh; nothing was filed.

# Trend ledger — for mechanical comparison next run

| name | 09-26 | 2026-10-21 | movement |
|---|---|---|---|
| `north-star-version-drift` | resolved | `drift:false` vs v3 | **resolved (stays)** |
| `north-star-reading-staleness` | — | reading and roadmap stale; `reportGeneratedAt` 09-19; no scheduler job | **new, medium** |
| `periodical-cadence` | high; instrument fixed, layer silent then resumed | 7 `never`, 2 `due`, 7 `recent`; registry misses hand-filed runs (`security-review` reads `never`) | **changed: uneven, instrument defect; medium** |
| `review-layer-load` | — | 29% (rule) to 38% of cohort; evidence-heavy line growth (96% `_evidence-*`); 46 ticket-review follow-ups in Backlog (carried) | **new, high, worsening** |
| `runner-kit-waitloop-churn` | — | 18 touches (9 since 10-18); 3495→3667→3685→3707; 3741 | **new, medium-high, worsening** |
| `simple-dispatcher-repair-concentration` | medium | 2.36/day vs 4.34; 3270 failed witness 10-10; 7 open SD repairs | **worsened, medium** |
| `close-out-owner-gate-refiling` | — | chains 3648→3681; 3418→3657; 3661→3759 | **new, medium** |
| `rebuild-wave-displacement` | — | 10-15→17: 30 units, 0 forward (carried); `experiments/` +514k | **new, medium, easing** |
| timeliness / flow | medium | 17 In Progress, 4 already merged, 0 `dueDate` | **worsened, medium** |
| `credential-defect-cluster` | medium, still active | LIN-1981 Todo, gate cleared 10-10, idle since 09-19 | **unproven/watch, low-medium** |
| `ci-platform-incidents` | — | mongo-kernel 10-19; LIN-3698 Backlog; CI 5.27→6.94 min | **new, low-medium** |
| distractions | clean | 7.3% Canceled/Duplicate (2.2% before), concentrated | **worsened, low** |
| `jira-adf-rebuild-residue` | — | 6 touches, 0 since 10-18; planned rebuild | **new, low, not whack-a-mole** |
| `opencode-harness-churn` | medium | one stalled verification (LIN-3355) | **easing** |
| `rulings-substrate-churn` | medium | touches down (2 vs 11; 7 vs 13) | **easing** |
| `flight-companion-build-concentration` | medium | 17 touches, ~5 features; LIN-751 In Progress | **easing** |
| `unpriced-model-gap` | medium | priced; LIN-3094 Done | **resolved** |
| `delivery-throughput` | fork | LV 17.88 vs 11.41 (burst, net growth about 0); SD 2.36 vs 4.34 | **fork, sharper** |
| `verification-session-share` | flat, basis changed | basis changed again | **not comparable** |
| `backlog-conversion` | 43% Done | 62.6% Done, right-censored | **not comparable** |
| `cost-metric-denominator`, `output-composition`, `parked-at-plan-review`, `untraceable-completions`, `external-injection-break`, `cost-per-verified-task`, `gate-falsification`, proxy cluster | various | not re-measured | **carried unchanged / not measured** |

# What this review did not measure, and why

- **`lib/escalation-kpis.js`** (false-escalation rate): session-auth route only; LIN-2691 Backlog.
- **`lib/roadmap.js` velocity outputs** and the workspace `/kpis` page: no proxy route / session-auth.
- **True time-in-progress**: no state-history endpoint.
- **A reproducible periodical dispatch census**: `/dispatch` caps at 100 items.
- **`scripts/follow-on-ratio.mjs`**: about 1,562 calls; the question it answered was superseded. Not run.
- **Public `/kpis`** was not re-fetched at write time (not served by the local proxy).
- **Net backlog delta**: no 09-26 backlog snapshot to diff.
- **Descriptions-level bucket cross-check** of the 352 unparented tickets: titles only.
- **Agent effort before the 30-day telemetry TTL**.
- **LIN-3758 and LIN-3759** were filed today. LIN-3759 is an SD repair; LIN-3758 is an RCA of a pipeline stall (Design Review child runs held after about 03:43Z on 10-21, periodical runner stopped by the operator at 05:15Z), which bears on H1 rather than only on SD.
- **UI-overhaul / Design Review findings** (open High: LIN-3761 library tables clipped at 390px, LIN-3762 muted-text contrast 2.94:1, LIN-3754/3755/3757) are review output awaiting conversion, counted inside H1, not ranked as a separate headwind.

## Adversarial Second-Read

**Tier: Tier 2.** A fresh-context sub-agent with no memory of the drafting turn, given only the report path, read access to both repos and the GET tracker API, and told to spot-check independently.

**Question, verbatim:** "What is the largest item in this window that this report missed or misfiled?"

**Reader's answer (condensed):** The report misfiled its headline line-mass metric. `docs/reviews/` +255,556 is right, but 246,300 (96%) is `_evidence-*` data; prose is about 9,256 lines against 77,925 product lines (about 0.12x, not 3.3x). Secondary: LIN-3758 is a pipeline-stall RCA, not only an SD repair; the Design Review / UI-overhaul findings (LIN-3761, 3762, 3754, 3755, 3757) are unranked; the `experiments/` +514k is papers with data, not displaced forward work. Counts matching: 447 LV / 26 SD units, 3,705 issues, 658 cohort, product-code lines. Not checked by the reader: bucket tables, densities, live state claims, the 29–38% ticket share.

**Re-verification here:** `numstat` split of `docs/reviews` gives evidence 246,300 / other 9,256 (confirmed); LIN-3758 title confirms a pipeline-stall RCA (confirmed). All three corrections applied in place above (H1 line mass, H5, did-not-measure).

Adversarial second-read verdict: DISAGREE
Differed from top finding: NO
Disposition: fixed in place

