# Recent Headwinds Review — 2026-09-26 (advisory, trend-framed vs 2026-08-29)

*Advisory, review-only. Periodical LIN-542 (this run: LIN-3104). No code, config or secrets changed; no fix-tasks minted.*

**Grounding.** `LinearViewer` @ `b5c528c4` (`main`, 2026-09-26 20:17 BST) · `simple-dispatcher` @ `3b1e734` (`main`, 2026-09-26 10:29 BST). The prior run was 2026-08-29; **the interval is about 4 weeks, not 1**, and no comparison below treats this window's 28-day rate as if it were 08-29's 7-day rate. Every figure is re-derived against these two SHAs or the live `/api/proxy` instruments at write time; nothing is carried from prior prose without a live re-check (the one deliberate exception is the `/cost`-based session-kind figures, flagged in place).

**Prior runs read in full**: `docs/reviews/recent-headwinds-review-2026-08-29.md` (LIN-2364, 278 lines), including its trend ledger, *Clean results*, *Signals that would produce a false reading*, *What this review did not measure* and *Adversarial Second-Read*. Earlier runs (08-23, 08-03, 07-09, 07-02, 06-25, 06-18) consulted for the standing method traps; the series convention (`recent-headwinds-review-YYYY-MM-DD.md`, branch + PR to `LinearViewer` `main`) is unchanged.

---

## Method and its limits, stated first

- **Git windows use explicit `'YYYY-MM-DD 00:00'` bounds, everywhere.** A bare `--since=DATE` resolves to the current time-of-day and silently drops ~15% of a window. Every figure below was re-run at write time with the explicit form.
- **Delivery/composition substrate**: `git log --first-parent`, both repos, mainline-unit counting — the merge-invariant substrate the series has used throughout. `scripts/delivery-composition.mjs` exists and is stable, but **still lacks active-day density** (`grep -n active scripts/delivery-composition.mjs` — no match, unchanged from 08-23/08-29); density is computed inline here from `git log`.
- **Bases are never mixed.** Every cross-window figure is per-repo; `LinearViewer` and `simple-dispatcher` are reported side by side, **never summed or averaged**. Throughput is a full git census; cost/verification figures are a ticket sample — the two are labelled as such and not compared against each other.
- **v2 → v3 north star, 2026-09-19.** The served direction layer now reads **v3, `fresh`, 7 days old** (`reportGeneratedAt` 2026-09-19, `docVersion.drift: false`), i.e. the alignment call this review is required to consume is computed against v3. 08-29 had no alignment reading at all, so **direction-drift is a new baseline against v3, not a delta**.
- **Mapper session-kind figures are carried, not re-derived this run.** The `/cost` sweep behind the `wake`-kind and sessions-per-ticket figures costs ~100 calls / ~29 minutes against an unchanged HEAD; 08-29's own method note defends a targeted re-check rather than a wholesale second sweep, and that discipline is applied here. Their provenance is the research record for this task; they are marked as such wherever quoted.
- **Not re-derived here**: churn-convergence (Stability Review, LIN-453 — still `never` dispatched; no sibling verdict exists, only the fact of its absence); structure (Code Quality / Drift & Coherence / Documentation / Design & Interface / API Quality — read for seams only); the north star itself (consumed via the direction layer, never rewritten).
- **Could not measure, and why** (§11): `lib/escalation-kpis.js` false-escalation output (session-auth route only, unreachable via `/api/proxy`); `lib/roadmap.js` velocity outputs (no proxy route); `lib/follow-on-ratio.js` (reachable only via a ~1,562-call script); true in-progress age (`lib/roadmap.js:659` computes staleness from `createdAt`, and there is no state-history endpoint, so time-in-progress is unreachable); a reproducible periodical dispatch census (`/dispatch` caps at 100 items with no cursor or date filter).

---

# Headwinds, severity-ranked

Ranking is strictly by stated severity — **high** before **medium** — then, within a severity band, by a stated tie-break: the headwind's own window-cohort footprint (`LIN ≥ 2384` ticket count of its named class or program — a `front:` label count for a labelled program, the repair-class count for H5, the title-scan count for H4, the enumerated member count for H6), larger first. Headwinds whose evidence is a single ticket or a flow observation (H7, H8) rank after the counted classes within their band. Aggregate-before-rank still holds: a concentration of small, closed items outranks any single ticket.

## H1 — `periodical-cadence`: the instrument is fixed, but the measured layer stayed silent ~4 weeks — then resumed with today's batch · **high · instrument fixed / measured-layer worsened-then-emitted**

**What.** Two previously-conflated findings are separated here.

1. **The instrument is fixed.** `LIN-2385` (Done 2026-08-30, PR #1304) moved run-evidence gating onto a terminal `[done]` marker. 08-29's H2 prediction ("real reviews with real merged reports do not register") was the thing `LIN-2385` exists to close.
2. **The measured layer stayed silent for ~4 weeks.** Between 2026-08-30 and 2026-09-26 19:00 there were **0 periodical dispatches** — the fix landed and the thing it measures stopped. `GET /api/proxy/periodicals` at write time: **8 of 15 templates are `never`** (`test-coverage-gap`, `security-review`, `api-quality`, `comprehension-debt`, `stability-review`, `dependency-supply-chain`, `performance-scale`, `data-fetch-architecture`), and the other **7 were last dispatched 2026-09-26 (six at ~19:00Z; `documentation-review` later that evening, as its own run re-dispatched per beat)`** — today's batch, which includes this review. `stability-review` is still `never`.
3. **The silence evidence is indirect and must be read as such.** The registry snapshot is a state read, and the `/dispatch` history caps at 100 items with no cursor or date filter, so it is *not* a reproducible census of the gap. What is directly observable is the snapshot's shape: everything before today's batch is `08-29 or never`. Until a backward-paginated dispatch history exists (or the instrument gates on a terminal marker as `LIN-2385` intended), the 4-week gap is a strong inference from a snapshot, not a counted census.

**Why it matters.** The north star's "a halt the system didn't report costs more than the halt" is exactly this: the review layer that exists to notice a silent layer was itself silent for a month, and the only reason it is visible at all is a registry snapshot. That today's 19:00 batch fired is a genuine improvement to record (below), but 8 templates still `never` — including the Stability Review that owns the churn-convergence seam this review is told not to duplicate.

**Trajectory:** immediate — emitted (today's batch); recent — silent through 09-12→09-26 19:00; baseline — instrument fixed 08-30, layer silent thereafter. Net: **instrument fixed, measured layer worsened through the window, then resumed today**. **Confidence: verified at HEAD** (live `GET /api/proxy/periodicals`; `LIN-2385` and `LIN-2323` both Done); the gap's *length* is inferred, not censused.

**What I would do (options).** (a) Confirm with the operator whether the 19:00 batch is the intended resumption or a one-off; if intended, the cadence headwind downgrades to "watch". (b) The two standing watch tickets remain open — `LIN-2328` (watch the first real periodical run after `LIN-2323`, Todo, last comment 08-29) and `LIN-1629` (change-gated due-ness probe, Todo, last comment 08-08) — a human could either action one or retire it. (c) If the layer is expected to fire weekly, a missing-batch alarm on the periodicals registry would convert a snapshot inference into a reported halt (this is the same shape as 08-29's H1 fix options and `LIN-2999`'s early-warning ask).

---

## H2 — `flight-companion-build-concentration`: the largest single-epic program (`LIN-751`; second-largest `front:` label after `front:dispatcher-substrate`), with a real fix/polish string · **medium · new / unproven-watch**

**What.** The Flight Companion / companion-observer build (`front:flight-companion`) is the **largest single-epic program** in the window: **84** tickets at `LIN ≥ 2384` (51 Done, 27 Backlog, 5 Todo, 1 Canceled), of which **51 have `LIN-751` as immediate parent** and that epic carries **53 children** (51 in-window; `GET /issues/LIN-751`'s `children` field returns exactly 50 — a projection cap — so the count is taken by census over `parent.identifier`). It is **not** the window's largest labelled program: `front:dispatcher-substrate` carries **123** window tickets (46 Done / 64 Backlog / 12 Todo / 1 Canceled), and `front:rulings` **83** (H3), so "largest program" is label-basis-dependent and is qualified here. `front:dispatcher-substrate` is not ranked as a headwind in its own right because it is a cross-cutting label whose window members are the deliberate LIN-679 decomposition plus the halt, OpenCode and rulings work already netted into H5/H6/H3 — ranking it would double-count them. Churn: `routes/flight-companion.js` **21 first-parent / 21 all-commit** touches since 2026-08-29; `public/flight-companion.js` 17 / 20; `lib/chat-tools.js` 17 / 20; **25** first-parent `LinearViewer` commits mention companion/observer/passage/lighthouse. That is larger than the OpenCode harness this report ranks (H6, `opencode-runner.js` 9 fp) and comparable to the SD runner's total `reapers.js` churn (22 fp, of which **9** are repair-only — H5).

**What it is not.** This is predominantly **forward capability** (the A.2–A.11 build, Phase B, the v1 parity passage `LIN-2636`), which is why it is *not* graded as repair-on-itself — but it is not clean either: it carries a visible fix/polish string (`LIN-2661`/`LIN-2685` malformed-attention-row throws, `LIN-2715`–`LIN-2718` UI/persistence fixes, `LIN-2734`, `LIN-2770` reorient self-undo, `LIN-2849`, `LIN-2857`, `LIN-2871`), and its epic `LIN-751` is simultaneously **held** on a budget ruling while carrying the largest single-epic build in flight. That is the live tension with the north star's *"finish transitions before starting capabilities"*: a 53-child epic carrying the window's biggest build, held. The drag is **unproven** — 51 of its window tickets are Done — so it is graded on the boundary (finishing + fix string), not as a defect chain.

**Provenance (correction).** The initial draft of this report omitted this program entirely and filed `LIN-751` only under Timeliness/flow as a "stale, held" epic. The required adversarial second-read caught the omission; it is folded in here per the 08-29 correction convention, and H5's earlier "largest single-subsystem concentration" wording was corrected to a repair-scoped claim as a result.

**Trajectory:** immediate — active (the 09-04/05 burst included many companion commits); recent — steady-high; baseline — new program (107 all-time, 84 in-window). **Confidence: verified at HEAD** (census/labels live, recount returns 84; churn re-run; `LIN-751`'s 53 children by census — the detail endpoint caps its `children` array at 50).

**What I would do (options).** (a) A human decision on `LIN-751`: the held epic owns the largest single-epic program, so the hold needs either a stated read date or a funded bounded run — "In Progress, held" is the state that ages invisibly under `createdAt`. (b) Triage the 27 Backlog companion tickets for whether they are the next intended slice or have drifted; the fix/polish items (`LIN-2734`, `LIN-2770`, `LIN-2849`, `LIN-2857`, `LIN-2871`) are the checkable drag surface. (c) Decide whether the companion/observer surface should be measured by this series going forward — it is now too large to sit only in prior-art.

---

## H3 — `rulings-substrate-churn`: a deliberate build with an explicit fix-on-fix string · **medium · new / unproven-watch**

**What.** Sized on the same basis as H2: `front:rulings` carries **83** window tickets at `LIN ≥ 2384` (43 Done, 36 Backlog, 3 Todo, 1 Duplicate) — one fewer than H2's `front:flight-companion` (84) — making it the **third-largest `front:` label** (after `front:dispatcher-substrate` 123 and H2's 84) and the second-ranked program in the medium band. A rulings/decision feed was built inside the window (`LIN-2754`–`LIN-2780` Done), followed by a traceable-answers/withdrawal program (`LIN-2809` steps 1–7 = `LIN-2889`–`LIN-2895`; `LIN-2891` sub-tasks A–F = `LIN-3034`–`LIN-3040`), with program bugs `LIN-2990` (Backlog), `LIN-2991` (Done), `LIN-3005` (Canceled), plus the explicit regression `LIN-2766` *"LIN-2756 regression"* (Backlog). Churn matches the research counts exactly: `routes/proxy-rulings.js` 11 all-commit, `lib/unanswered-decisions.js` 13.

**Why it matters.** This is a deliberate build whose own later fixes are visible as such — `LIN-2991` fixed the same finding being re-raised at every stage, and `LIN-2766` is a regression of a specific prior fix. It is the deliberate-build case in the whack-a-mole taxonomy (H5), but the presence of a *named regression* means it cannot be graded "clean substrate finish" either. `LIN-2766` and the other 0–1-comment Backlog residue are the watch surface.

**Trajectory:** immediate — active (withdrawal program closing); recent — steady; baseline — new substrate. **Confidence: verified at HEAD** (states live; churn counts re-run; the regression's title and state confirmed).

**What I would do (options).** (a) A human triage of `LIN-2766` — a named regression with **1 comment (09-11) and no activity since**, on a just-built feed, is the single most checkable item here. (b) Confirm whether the withdrawal program's remaining Backlog steps (`LIN-2990`, `LIN-2991`-adjacent, `LIN-3029`/`3031`/`3083`/`3088`/`3091` residue) are intended to land or are being carried indefinitely.

---

## H4 — `credential-defect-cluster`: still active, reframed as a deliberate re-architecture with an unclosed defect family · **medium · still active (unproven-watch)**

**What.** Live at HEAD: `LIN-1981` is **Todo, 8 comments** (last 2026-09-19). Per the 08-29 H4 lesson, the state is read *with* the comment trail, not instead of it:

- The 08-23 close-out (comment) recorded PR #1234 merged (`3409820`) with a read-only diagnostic tool, run against the local dev store (zero flags), "ready for an operator with production access to run." The remaining blocker is production database access, not ownership or neglect.
- The **new 2026-09-19 comment** changes the ticket's sequencing: it *"no longer blocks LIN-2149 and is related to it instead"*, concerning the operator's own legacy workspaces, **sequenced after the v1 dress rehearsal (`LIN-2953`)**. So the ticket is not stalled — it has been deliberately re-sequenced behind a milestone.

The wider family is active, not resolved: new adjacent credential/identity bugs filed in/around the window are `LIN-2640` (owner-session rows not filtered by provider), `LIN-2642` (Jira OAuth pick drops the refresh token, leaves the pending account), `LIN-2639` (GitHub mint accepts a no-token response), `LIN-2530` (Jira multi-site CSRF nonce stays live), `LIN-2394` (proxy-token `expiresAt` ~7h ahead of the actual 401) — **all Backlog, all 0–1 comments**. The deliberate re-architecture is `LIN-2883` (machines as account objects, Backlog), `LIN-2884` (dispatch scope on proxy tokens, Todo), `LIN-3059` (one agent credential, Todo — deferred here from `LIN-3080` on 2026-09-26). A broad title scan (`credential|token|identity`) returns **47** credential/token/identity tickets at `LIN ≥ 2384` (25 Backlog, 14 Done, 6 Todo, 2 Canceled; re-derived this pass — the earlier draft said 49).

**Why it matters.** This is not the 08-29 draft's "worsened, unowned" frame — the reframed program is deliberate and one candidate is re-sequenced, not abandoned. But the family keeps producing new Backlog defects, and the one root-cause candidate is gated on an access/operational ask that has now slipped behind `LIN-2953`. The north star's "oldest open compat lane" clause is served by the re-architecture tickets, so this is transition-incompleteness with a real residual, not diffuse drift.

**Trajectory:** immediate — active (new Backlog family items; `LIN-3059` filed/deferred 09-26); recent — steady (new bugs, no closes); baseline — the program ran and closed its `LIN-2231` incident arm in the prior window. **Confidence: verified at HEAD** (all states and comment trails live-queried; `LIN-1981`'s 09-19 comment read in full).

**What I would do (options).** (a) The one concrete, actionable gap is unchanged from 08-29: grant a session/operator with production DB access the ability to run `scripts/scan-mis-mirrored-workspaces-lin1981.js` — an access ask, not a code change, and the ticket's own next step. (b) A human triage pass on the five 0-comment Backlog family items (`LIN-2640/2642/2639/2530/2394`) to grade each or close it as not-a-bug. (c) Confirm the `LIN-1981` re-sequencing behind `LIN-2953` is intentional and re-record the reason where the next reader will find it.

---

## H5 — `simple-dispatcher-repair-concentration`: a large share of SD's window output is repair on the runner substrate — elevated under the ticket-title rule, flat under the commit-subject rule; 08-29's whack-a-mole chain continued by one carried-gap link, then settled into residual/adjacent follow-ups · **medium · new (carried name); residue unproven-watch**

**What.** The runner-substrate repair class is **23 tickets** in the window cohort (`LIN ≥ 2384`): **12 Done, 11 open** (10 Backlog, 1 Todo). The bounding rule is *wake/resume/reaper/refire/follow-up-hold* titles on the runner substrate — research's 20-member keyword list (§2 of comment `5ffe2188`), unioned with the three repair tickets that carry the repair-only `reapers.js` touches but were not in that list (`LIN-2338`, `LIN-2339`, `LIN-2515`). Members: `LIN-2338`, `LIN-2339`, `LIN-2414`, `LIN-2468`, `LIN-2474`, `LIN-2476`, `LIN-2510`, `LIN-2511`, `LIN-2515`, `LIN-2517`, `LIN-2532`, `LIN-2542`, `LIN-2549`, `LIN-2556`, `LIN-2559`, `LIN-2560`, `LIN-2563`, `LIN-2564`, `LIN-2644`, `LIN-2652`, `LIN-2657`, `LIN-2668`, `LIN-2679`. This is **not** the whole `Simple Dispatcher` project — that project has **77** window tickets (30 Done / 39 Backlog / 8 Todo), kept here only as context; the halt program (`LIN-2995` + children), the OpenCode harness (H6) and the rulings/decision substrate (H3) are explicitly netted out so no ticket is counted under two headwinds. The first-parent units that landed include a large share of repair on the runner substrate rather than forward delivery (elevated under one stated rule, flat under the other — the fork is set out in full below). The sharpest instance is the wake/resume fix-induced chain: `LIN-2331` (Done, `f49d0a75`) is itself titled *"Within-class terminal-wake collisions survive LIN-2297"* — the fix, by name, did not bound its class — and the single carried-gap link it admitted (`LIN-2414`) is now closed, with the chain's residue filed as follow-up tickets rather than as new in-window breaks.

**`reapers.js` touches, split by purpose.** `git log origin/main --first-parent -m --since='2026-08-29 00:00' -- reapers.js` returns **22** first-parent touches, but only **9** are wake/stall/resume/refire repair (`LIN-2338`, `2414`, `2339`, `2468`, `2510`, `2511`, `2517`, `2515`, `2563`). The other 13 belong elsewhere and are netted so none is counted twice: terminal-driver/launch **4** (`LIN-2446`, `2452`, `2457`, `2509`), lane markers **1** (`LIN-2423`), effort-axis feature **1** (`LIN-2567`), **OpenCode-liveness 5** (`LIN-2720`×2, `LIN-2737`, `LIN-2738`, `LIN-2736` → H6), spring-clean **1** (`LIN-1220`), and **rulings withdrawal 1** (`LIN-2891` → H3). The repair-only churn footprint is therefore **9 of 22**, not 22.

**The causal spine, link by link.** The five `simple-dispatcher` commits resolve at `3b1e734`; note that `f49d0a75` is a **`LinearViewer`** commit (the spine's root mechanism, `lib/dispatch-store.js`, lives in `LinearViewer`; `LIN-2331` and `LIN-2414` are team-LinearViewer tickets), so the spine spans both repos: 

| link | grade | evidence (live) |
|---|---|---|
| `LIN-2297` → `LIN-2331` → `LIN-2414` | **incomplete-fix (carried gap)** | `LIN-2331` (Done 2026-08-30, `f49d0a75` in **`LinearViewer`**, tests-only — `lib/dispatch-store.js` untouched) explicitly leaves within-class collisions; its S1 ruling assigns the sole reachable production carrier to `LIN-2414` *"carrying LIN-2331's Gap 1"*. |
| `LIN-2414` → `LIN-2468` | **adjacent-independent** | `LIN-2414` (Done 2026-09-02, `0b0732f`, PR #209) re-parks a lapsed `BLOCKED` hold; `LIN-2468` (Done 2026-09-04, `2ef854b`, PR #215) is *"latent, not a regression; independent of LIN-2414's chosen fix"*, drafted by 2414's own research. |
| `LIN-2414` → `LIN-2474`, `LIN-2476` | **ledger follow-up (not new defects)** | `LIN-2474` (Backlog) owns 2414's review-ledger item 3; `LIN-2476` (Backlog) owns close-out items 2+4 (system-suite coverage). |
| `LIN-2511` → `LIN-2532` | **ledger follow-up** | `LIN-2511` (Done 2026-09-04, `1da7a31`, PR #213) force-FAILed a healthy resumed session 27 ms after its wake; the post-merge runtime witness it could not discharge is `LIN-2532` (Todo). |
| `LIN-2517` → `LIN-2564` | **ledger follow-up** | `LIN-2517` (Done 2026-09-04, `f5e10ae`, PR #216) owns the bounded pendingFollowUp skip; its residual evidence ledger is `LIN-2564` (Backlog). |
| `LIN-2517` → `LIN-2563` | **adjacent-independent** | `LIN-2563` (Done 2026-09-05, `ce0a8e5`, PR #223) defers the opencode turn-notification `[done]` while a follow-up wake is pending — a sibling defect on the same substrate. |

**Correction to the research record (provenance).** The research record for this task (LIN-3104 comment `5ffe2188`) graded the `LIN-2414` → `LIN-2468` link as caused-by-prior-fix. This report corrects that to **adjacent-independent**, on `LIN-2468`'s own Origin text — *"Latent, not a regression; independent of LIN-2414's chosen fix"* — quoted in the table above. Likewise, research's `48/63/64` repair-share figures are superseded by the re-derived fork below.

**What the spine is not.** The boundary 08-29 drew is re-applied here, because conflating the cases would be the same error the series has twice had to correct:

- **Rulings/decision substrate — deliberate build with a fix-on-fix string, not a defect chain.** The rulings feed was built inside this window (`LIN-2754`–`LIN-2780`, all Done; `routes/proxy-rulings.js` 11 all-commit touches, `lib/unanswered-decisions.js` 13 — exactly the research counts), followed by the withdrawal program (`LIN-2809` steps, `LIN-2889`–`LIN-2895`, `LIN-3034`–`LIN-3040`) and a real regression filed against its own output: `LIN-2766` *"LIN-2756 regression"* (Backlog). `LIN-2991` (Done) fixed the same finding being re-raised at every stage. This is substrate being finished and then hardening — the deliberate-build case, ranked in its own right as H3 (above the SD repair class, H5, on window footprint).
- **`LinearViewer` proxy/server churn — deliberate LIN-679 decomposition.** `routes/proxy.js` (37 all-commit touches), `server.js` (38), `lib/proxy-instructions.js` (33) and `CLAUDE.md` (39) are high, but **9 first-parent commits are LIN-679 sub-router stages** (PR-0 plus Stages 2–6). High touch count here is a planned decomposition, not fix-on-fix; it is not ranked as a headwind.
- **opencode harness — substrate being finished *and* generating fixes.** Ranked separately (H6) precisely because it is both.
- **Incident/halt program — deliberate incident response, now closed.** The 2026-09-22 database-reads incident (`docs/incidents/2026-09-22-harbour-db-reads-hang.md`) produced the halt/auto-pause program: `LIN-2995` (Done 2026-09-26) and children `LIN-3041`–`LIN-3046`, `LIN-3055` (all Done), `LIN-3047` (Backlog), on top of `LIN-2994`/`LIN-2996`/`LIN-3000` (Done). The program's one self-fix is `LIN-3055` (`LIN-2995` S6: auto-pause could never hold a fresh launch when workspaces ≤ threshold) — created 09-25, resolved on a recorded John decision and Done 09-26. That is a disciplined response to a real production fault, not churn.

**Why it matters.** The north star makes `follow-on tasks and wakes per verified task` a tracked tax and `finish transitions before starting capabilities` a sequencing rule. A runner substrate whose window output carries an elevated share of repair-on-itself under the ticket-title rule (49.2% vs 34.5% baseline; linked-only 50.8% vs 42.3%) but a flat share under the commit-subject rule (26.9% vs 27.9% pre-window), with one root-cause fix that explicitly did not bound its class, is a real **repair** drag. On the corrected evidence it is **medium, not high and not first**: the repair class is **23 tickets** (12 closed, 11 open) and **9 repair-only `reapers.js` touches** — far short of the 77-project / 22-touch framing it replaces — and the 28-day share is elevated under **one** rule only (recent/immediate legs rule-dependent). It remains the clearest *repair* drag this review surfaces and ranks within its severity band on its window footprint (23), behind the larger window classes H2 (84), H3 (83) and H4 (47). It is **not** the largest program in the window by raw ticket count — that is the `front:dispatcher-substrate` label (123), and the largest single-epic program is the Flight Companion build (84 window tickets, parent `LIN-751`, H2); the second-read surfaced that the initial draft omitted it, and H5's earlier "largest single-subsystem concentration" wording was corrected to this repair-scoped claim as a result.

**Repair share is re-derived under two rules, each with a consistent basis.** Research recorded `48% baseline → 63% recent / 64% immediate`, but that classification rule is not specified and **is not mechanically reproducible**. The independent review showed the prior two-rule fork was itself inconsistent: rule A matched branch slugs in some windows and full descriptive subjects in others — every `simple-dispatcher` mainline unit from 09-12 on is a merge unit (21 of 22 and 14 of 14 carry a `Merge pull request … from <branch>` subject, the 22nd is `Merge PR #236`), against 148/261 in the baseline — so its apparent rise was an artefact of subject form, not of repair. Re-derived at this HEAD under two rules whose basis is held constant:

**(A) commit-subject keywords, merge units only.** The keyword set is applied to the first-parent merge/PR-merge subject (which carries the branch slug and, when GitHub writes it, the PR title), and the denominator is those merge units **only**, so the same subject form is compared in every window; the direct-commit descriptive subjects are excluded rather than mixed in. Case-insensitive, matched anywhere in the subject:

```
fix|harden|prevent|stop|bound|correct|rework|repair|regress|revert|\brace\b|leak|stall|refire|reaper|failsafe|fail-safe|honest|wedge|phantom|heal|recover|shadow|wrong|false|mislabel|guard|no longer|never|drop|remove|refactor|tidy|split|extract|consolidate|pin|tighten|decouple|fallback|fall back|clamp|\bcap\b|watchdog|circuit breaker|retry|backoff|throttle|dedupe|sanitize|validate|phased|Phase [A-Z]|cleanup|clean up|deprecat
```

**(B) linked-ticket-title keywords, the eight deliberate-work keywords dropped.** The keyword set is applied to the linked ticket's title (linked via a case-insensitive `lin-<n>` match anywhere in the subject, including the branch slug). A mainline unit with no linked ticket is counted as **not-repair** — the conservative default that keeps the whole mainline in the denominator — and the linked-only denominator is shown alongside. The eight keywords `halt|abort|pause|withdraw|decision|permission|refusal|warn` are **dropped** from the earlier rule B: the report's own boundary above grades the rulings/decision substrate as a deliberate build (H3) and the incident/halt program as deliberate incident response (the halt-program note above), not churn, so counting those programs as repair contradicted the report's own classification. Case-insensitive, matched anywhere in the title:

```
fix|harden|prevent|stop|bound|correct|rework|repair|regress|revert|race|leak|stall|refire|reaper|failsafe|fail-safe|honest outcome|wedge|phantom|heal|recover|shadow|wrong|false|mislabel|guard|no longer|never|refactor|split|extract|pin|tighten|decouple|fallback|clamp|watchdog|circuit breaker|retry|backoff|throttle|dedupe|sanitize|validate|cleanup|stalled
```

— the `simple-dispatcher` shares are:

| window | units (merge units) | rule A (merge-subject, merge-only denom.) | rule B (ticket title; unlinked = not-repair) | rule B linked-only |
|---|---|---|---|---|
| baseline 06-26→ | 261 (148 merge) | 41 / 148 = **27.7%** | 90 / 261 = **34.5%** | 90 / 213 = **42.3%** |
| interval28 08-29→ | 61 (26 merge) | 7 / 26 = **26.9%** | 30 / 61 = **49.2%** | 30 / 59 = **50.8%** |
| recent 09-12→ | 22 (22 merge) | 7 / 22 = **31.8%** | 10 / 22 = **45.5%** | 10 / 22 = **45.5%** |
| immediate 09-22→ | 14 (14 merge) | 2 / 14 = **14.3%** | 6 / 14 = **42.9%** | 6 / 14 = **42.9%** |

(The pre-window leg for rule A, 06-26→08-29, is 34 / 122 = **27.9%** — the cleaner like-for-like baseline for the 28-day window.)

**What survives is narrower than the old headline.** Only one quantitative claim survives: the 28-day share is **elevated under rule B only** (49.2% vs 34.5% baseline; linked-only 50.8% vs 42.3%), while under rule A, once the subject form is held constant to merge subjects, the 28-day share is **flat** (26.9% vs 27.9% pre-window). No recent/immediate escalation survives either rule: under B the recent/immediate shares (45.5%, 42.9%) sit at or below the 28-day level, and under A they are 31.8% and 14.3%. The whole apparent rule-A rise came from **35 direct commits between 08-29 and 09-12** (21 keyword hits), not from the merge units that carry the recent window. **Research's `48/63/64` figures and the earlier "exceeds baseline under both rules" claim are superseded by this re-derivation** — stated rather than published as a settled trend, per the 08-03 "withdrawn claim" precedent.

**Trajectory (immediate / recent / baseline):** the 28-day window is **elevated vs baseline under rule B only, flat under rule A**; recent/immediate are **unproven/watch (rule-dependent)** — never "worsening" or "easing" as a settled call, because the rules disagree on sign. The underlying concentration (23 repair tickets; 9 repair-only `reapers.js` touches) is steady at a moderate level. **Confidence: verified at HEAD** for the unit counts, churn and every causal-link SHA; **confidence: re-derived, rule-stated** for the share (both rules and both denominators printed above).

**What I would do (options).** (a) Sequence the open repair-class subset (`LIN-2474`, `LIN-2476`, `LIN-2532`, `LIN-2542`, `LIN-2549`, `LIN-2564`, `LIN-2644`, `LIN-2652`, `LIN-2657`, `LIN-2668`, `LIN-2679` — 10 Backlog + 1 Todo, all in the 23-member class above) ahead of new runner capability. (b) A human ruling on whether the wake/resume class is now *bounded* or merely *rested* — the one carried-gap link and its adjacent repairs closed on green CI, but neither "resolved" nor "worsened" is right while `LIN-2474`/`LIN-2476`/`LIN-2532`/`LIN-2564` carry the residual evidence (residue unproven-watch). (c) Adopt one stated repair-share rule (A or B) as the series instrument so next run can compare mechanically rather than re-litigating the rule.

---

## H6 — `opencode-harness-churn`: a new substrate being finished *and* generating a fix string · **medium · new / unproven-watch**

**What.** The OpenCode harness is new in this window. Its enumerated window-cohort footprint is **14 tickets** (`LIN-2835`, `2836`, `2837`, `2839`, `2872`, `2873`, `2874`, `2875`, `2876`, `2877`, `2878`, `2900`, `2901`, `3076`; 7 Done / 6 Backlog / 1 Todo) — the smallest of the counted classes, which places it last among them in the medium band. Its churn: `opencode-runner.js` 9 first-parent / 14 all-commit touches, `opencode-liveness.js` 3 / 4. The pre-ramp harness run (`docs/reviews/pre-ramp-harness-run-2026-09-14.md`) enumerated six faults (`LIN-2876`–`LIN-2881`), and the fix string is only partly closed: `LIN-2876` (headless workers wedge on an unanswered permission prompt) **Done**; `LIN-2877` (log reaped with the record), `LIN-2878` (per-interval vs cumulative heartbeat), `LIN-2879` (feedback POST lost to a 502 burst), `LIN-2880` (DECISION blocks not reaching `/api/proxy/rulings`), `LIN-2881` (all-zero usage row) — **all still Backlog**. On the same substrate, `LIN-2839`/`LIN-2872`/`LIN-2873` are Done and `LIN-2875` (the six-ticket pre-ramp fix run) is Done.

**Why it matters.** This is the boundary case the remit names: substrate genuinely being *finished* (a new harness being completed) versus fix-on-fix churn. The evidence is mixed in a specific way — the highest-severity fault (the permission-prompt wedge) is closed, but nine days later five lower-severity faults remain open with no owner. That is "finishing", with an unproven stability floor. It is graded **unproven-watch**, not "worsened", because every closed item closed cleanly and the open ones are small.

**Trajectory:** immediate — active (`LIN-2873`/`LIN-2876` closed 09-17; five Backlog remain); recent — steady; baseline — new substrate. **Confidence: verified at HEAD** (states live; churn counts re-run).

**What I would do (options).** (a) A human pass on the five open Backlog harness faults to confirm they are genuinely low-severity or to rank them — five 0-comment items on a new substrate are the shape that compounds quietly. (b) Decide whether OpenCode is now the default runner or still experimental; the north star's routing clause wants the cheap tier *after* it passes the verifier, and a harness with an unproven floor is not yet that.

---

## H7 — `unpriced-model-gap`: premium model rows are unpriced, so their sessions read `totalUsd: null` · **medium · new**

**What.** `lib/model-pricing.js` at HEAD has rows for `anthropic/claude-opus-5` and `anthropic/claude-fable-5`, but **not** `claude-opus-5-5` or Fable 5.1 — the live premium models. Sessions on those ids carry `totalUsd: null` (`LIN-3080`, `LIN-3078` close-outs; tracked as `LIN-3094`, **Backlog, 0 comments**). Because the north star's headline metric is cost per verified task *in the money actually spent*, every unpriced session understates or voids that metric silently.

**Why it matters.** This is structurally the 08-29 H6 (Sonnet-5 pricing cliff) class — a metric quietly computed on an incomplete basis, reporting confidence — relocated from a *dated* expiry to a *missing row*. The dated half is resolved (`LIN-2384` Done; no `expire`/`validUntil` field remains in the pricing table), but the missing-row half is new and open.

**Trajectory:** immediate — open; recent — open; baseline — did not exist. **Confidence: verified at HEAD** (`lib/model-pricing.js` read directly: `claude-opus-5`/`claude-fable-5` present, `-5-5`/`Fable 5.1` absent; `LIN-3094` Backlog).

**What I would do (options).** (a) A human ruling on whether to price the new rows from live OpenRouter rates or to tag unpriced sessions explicitly so a `null` reads as a signal rather than a silent zero. (b) If `LIN-3094` is the chosen owner, triage it from Backlog; it is a small, checkable change.

---

## H8 — Timeliness / flow: two long-open in-progress epics, and the roadmap instrument that still flags a third that has closed · **medium · mixed**

**What.** `LIN-751` (`Realtime chat interface for work in flight`) is **In Progress, created 2026-06-27 (90 days)**, held since a 2026-09-06 budget ruling — note it is not idle, it is the parent of the largest single-epic program (H2); what is held is the epic, not the build. `LIN-2114` (`Move observation-type sessions out of Claude Code into a simpler cloud harness`) is **In Progress, created 2026-08-15 (41 days)**. Together they are the two standing "finish transitions before starting capabilities" candidates the north star names as priorities.

**The instrument is stale.** The served roadmap digest (`GET /api/proxy/north-star`, generated 2026-09-19) still lists **three** long-stale in-progress epics — `LIN-751` (84d), `LIN-1675` (53d), `LIN-2114` (35d). **`LIN-1675` is Done** (closed 2026-09-21 on John's instruction; all 16 children terminal). The digest is a report generated on 09-19, so the flag was correct *then* and is stale *now* — but the review must quote live state, not the digest, and the discrepancy is itself a finding about the instrument: `lib/roadmap.js:659` computes "stale in progress" from `createdAt`, so the digest's staleness signal lags a real close. `LIN-1675`'s close also removed the roadmap's named "sideways pull", which was one of the digest's own flags.

**Why it matters.** A served digest that names a closed epic as stale is the same class as 08-29's H1 (the direction layer reporting a superseded fact confidently). It does not change the two genuine epics, but it does mean the digest cannot be quoted without a live ticket-state re-check — which this run performed.

**Trajectory:** immediate — `LIN-1675` resolved; recent — `LIN-751`/`LIN-2114` steady (both re-touched 09-21 for bookkeeping, not delivery); baseline — multi-month. **Confidence: verified at HEAD** (`LIN-751`/`LIN-2114`/`LIN-1675` states and dates live; roadmap narrative live; `lib/roadmap.js:659` read).

**What I would do (options).** (a) A human decision on `LIN-751` and `LIN-2114`: either fund a bounded run to finish, or explicitly defer them with a stated read date — the current "In Progress, held" state is the one that ages invisibly under `createdAt`. (b) Feed the live ticket state into the roadmap staleness flag (or re-generate the digest more often) so it stops flagging closed epics.

---

## Direction drift — new baseline against north-star v3

The served alignment reading is **`fresh`, 7 days, `docVersion.drift: false` against v3** (`reportGeneratedAt` 2026-09-19). 08-29's critical `north-star-version-drift` is therefore **resolved** (`LIN-2254` Done 2026-08-30), and the reading is consumable for the first time in this series. Because the north star itself moved v2→v3 on 2026-09-19 and 08-29 had no alignment reading, **this is a new baseline, not a delta**.

Consuming v3's own signals (never re-deriving them): the reading finds Simple Dispatcher work directly serving *"silent failures and detection gaps outrank feature work"* (`LIN-2872`/`LIN-2876`/`LIN-2839`/`LIN-2835`) and flags `LIN-751`/`LIN-2114` as in tension with *"finish transitions before starting capabilities"*, plus `LIN-2175` (since Done) as a budget-guard gap and `LIN-1645`/`LIN-1626` as unsatisfied clauses. Applying the remit's rule — **alignment is not forward progress** — the credential fixes in H4 and the wake/resume repairs in H5 are **rework on north-star-aligned mechanisms, not forward delivery**, and are not credited as progress here despite pointing the right way.

---

# Genuine improvements — recorded as findings in their own right

- **`north-star-version-drift`: resolved.** `LIN-2254` Done 2026-08-30; live reading `fresh`, `drift: false` vs v3. (Freshness *across* the window is not directly provable — there is no history endpoint; the live read and the 09-19 `reportGeneratedAt` are the evidence.)
- **`Sonnet-5 pricing cliff`: resolved (cliff cancelled).** The 2026-08-31 expiry did not fire as a cliff (`LIN-2384` Done 2026-08-30); no `expire`/`validUntil` field remains in `lib/model-pricing.js`. Superseded by the *missing-row* risk in H7, which is a different mechanism.
- **`cost-metric-denominator`: substantially fixed.** `LIN-2253` Done (lane-denominated); the capture-rate share was published. Residual: `LIN-1960`, `LIN-2477`, and the unpriced gap (H7).
- **`parked-at-plan-review`: improved — root mechanism closed, convergence unproven/watch.** `LIN-1871` Done 2026-09-12 (PR #1459); plan-review now derives enumeration rather than hand-listing it. The close is not proof of convergence: research's 15-task sample has median 0–1 plan-review rounds, with `LIN-2802` at 2 and `LIN-3049` at 3 (both re-checked live — 2 and 3 plan-review verdicts respectively), so the root mechanism is closed but the convergence it was meant to deliver remains watch.
- **`gate-falsification`: resolved-by-supersession.** `LIN-1661` **Canceled** 2026-09-12 — superseded by John's `LIN-1871` ruling: the follow-on-ratio read no longer gates plan-completeness; it becomes a `docs/papers/review-loops.md` query re-run as a second paper. `LIN-1873` Done 2026-09-04. The question was dropped, not answered — recorded as such.
- **Periodical layer emitted today.** The 2026-09-26 batch (7 templates, six at ~19:00Z) ends the ~4-week silence, even though 8 templates remain `never` (H1).
- **The 2026-09-22 incident was handled well.** A real production fault (degraded EU↔US-East DB link) was diagnosed, structurally fixed (`LIN-3000` Done — Mongo moved to the app's region), and turned into a deliberate halt/auto-pause program (`LIN-2995` Done 2026-09-26). The program's one self-fix, `LIN-3055` (auto-pause could never hold a fresh launch below threshold), was filed and closed 09-25→09-26. This is incident response working, not a headwind.

---

# Clean results

- **Rework / reverts:** no revert-driven rework finding in the window; the fix-on-fix that exists is concentrated in the SD runner (H5) and the rulings build (H3), both named above rather than double-counted here.
- **Distractions / scope drift:** re-derived full census — **16 of 728** window-cohort issues (`LIN ≥ 2384`) are Canceled or Duplicate (**2.2%**; 14 Canceled, 2 Duplicate), spread thinly across `front:` labels (the most in one is `front:public-path` with 3, then `front:maintenance` 2, `front:cost-economy` 2, and one each in `front:dispatcher-substrate`/`surfaces`/`rulings`/`flight-companion`). No concentration; the one named cancellation is `LIN-1661` (gate-falsification). **Clean.**
- **`external-injection-break`:** retired (stays retired).
- **`cost-per-verified-task`:** stays retired, superseded into `cost-metric-denominator`; the new distinct risk is the unpriced-model gap (H7), not a resurrection.
- **`verification-session-share`:** live session `kind` now exists; the research sweep reads implementation **20.8% incl. `wake` / 24.0% excl.** and verification 45–52% of sessions (vs 08-29's 22% impl / 54% verification). Basis changed with the new `wake` kind, so this is reported as **flat with a muddied basis**, not a movement (see false-reading signals).
- **`output-composition`:** testShare 56–70% via the instrument (research sweep at this HEAD); unchanged.
- **`backlog-conversion`:** window cohort 723 created → 43% Done / 53% Backlog-Todo (vs 08-29's 45% Done) — **flat, right-censored**; net backlog delta remains unmeasurable (no 08-29 census).
- **`untraceable-completions`:** 48/314 = 15% by subject citation; the method over-counts papers/research/ops/subtask cells, so it is a **new baseline**, not a movement.

---

# Signals that would produce a false reading — named, not published as trends

- **The SD repair-share number (H5).** Not usable as a single figure, and not usable as a "direction" either: on a consistent basis the 28-day share is **elevated under the ticket-title rule only** (34.5→49.2; linked-only 42.3→50.8) and **flat under the commit-subject rule** (27.9→26.9 pre-window), and the recent/immediate legs move in **opposite directions** between them (rule A 31.8%/14.3%, rule B 45.5%/42.9%). The earlier "28-day share exceeds baseline under both rules" reading is superseded. Research's `48/63/64` and the earlier rule-A subject basis are not mechanically reproducible and are withdrawn.
- **The `wake` session kind.** A new `kind` (13.3% of sessions in the research sweep) changes the denominator: sessions-per-ticket is **8.0 incl. `wake` vs 6.9 excl.** (vs 08-29's 3.8), and implementation share is **20.8% incl. vs 24.0% excl.** Any sessions-per-ticket or impl-share trend must state which basis; the two are not comparable to 08-29's single-basis figure.
- **Unpriced `claude-opus-5-5` / Fable 5.1 sessions** read `totalUsd: null` (H7), so any `$/ticket` drawn from this window silently excludes them.
- **Census vs sample.** Throughput is a full git census; cost/verification figures are a ticket sample. The two bases are never compared against each other.
- **`LIN-2309` label-practice change (2026-08-25).** Bug-label and marker rates remain not trend-usable; the apparent spike is substantially a labelling-practice change, not a defect-rate change.
- **The periodical silence (H1).** Inferred from a registry snapshot, not a counted census (`/dispatch` 100-item cap); the gap's length is an inference.
- **Roadmap digest staleness (H8).** The served digest still names closed `LIN-1675` as a stale in-progress epic; the digest is generated (09-19), not live, so it must be re-checked against ticket state before quoting.

---

# Delivery throughput — per-window fork

Counted with `git log --first-parent` per repo under explicit `'YYYY-MM-DD 00:00'` bounds and `--until='2026-09-27 00:00'`; `LinearViewer` and `simple-dispatcher` are reported side by side and **never summed or averaged**. The prior run was 7 days and this one ~4 weeks, so absolute counts are not compared across runs — only the per-active-day density within this run. Active days are days carrying ≥1 first-parent unit in the window.

| window | `LinearViewer` units / active days / per day | `simple-dispatcher` units / active days / per day |
|---|---|---|
| baseline 06-26→ | 921 / 81 / **11.37** | 261 / 60 / **4.35** |
| interval28 08-29→ | 307 / 24 / **12.79** (excl. the 09-04+05 spike: 228 / 22 / **10.36**) | 61 / 15 / **4.07** (excl. the same days: 47 / 13 / **3.62**) |
| recent 09-12→ | 134 / 13 / **10.31** | 22 / 8 / **2.75** |
| immediate 09-22→ | 51 / 5 / **10.20** | 14 / 4 / **3.50** |

**Trajectory.** `LinearViewer` is **steady** at ~10 first-parent units/active-day across recent and immediate; the 28-day raw 12.79 is inflated by a single lane-run spike (09-04/05) and settles to 10.36 against an 11.37 baseline once that spike is excluded. `simple-dispatcher` is **steady-low, below its own baseline** (4.35 baseline → 4.07 28-day → 2.75 recent → 3.50 immediate): the recent dip did not worsen into the immediate window. Neither repo is worsening; the fork is "LinearViewer steady, simple-dispatcher below baseline".

---

# Timeliness / flow

Still **0 of 3,054 issues carry a `dueDate`** (full-census re-page at this pass; 3,051 at the second-read, 3,049 at research, as new issues land). Every reading in this section is therefore **flow health, never schedule health**, as in every prior run. The two long-open in-progress epics are `LIN-751` (90d — parent of the largest single-epic program, see H2) and `LIN-2114` (41d); `LIN-1675` closed 09-21 (H8). True time-in-progress is not measurable: `lib/roadmap.js:659` computes staleness from `createdAt`, and there is no state-history endpoint, so a ticket re-touched for bookkeeping (both were, 09-21) can read as fresh without delivering.

---

# What this review widened into, beyond the task's named checklist

Per the remit's instruction to widen discovery without inflating output, four in-remit, un-listed prior-art surfaces were folded in as load-bearing rather than re-derived:

- `docs/reviews/cheap-implementer-bakeoff-2026-09-13.md` and `docs/reviews/model-effort-routing-proposal-2026-09-11.md` — the routing/cost substrate behind the north star's "work-shaped legs run on the cheapest tier that passes the verifier" clause; the decision cycle is unfinished (`LIN-2832`/`LIN-2833`/`LIN-2834` all Todo), which is a direction-drift seam, not a new headwind this run.
- `docs/reviews/pre-ramp-harness-run-2026-09-14.md` — source of H6's fault set (`LIN-2876`–`LIN-2881`).
- `docs/incidents/2026-09-22-harbour-db-reads-hang.md` — source of the deliberate-incident-response contrast in H5 and the halt-program assessment.
- The periodical registry itself (`/api/proxy/periodicals`), read as an instrument rather than only as a due-ness list — which is what surfaces the instrument-fixed / layer-silent split in H1.

Two surfaces this remit names as in-scope could not be reached and are recorded under §11 rather than silently dropped: `lib/escalation-kpis.js` (false-escalation rate, a v3 headline KPI) and `lib/follow-on-ratio.js` / `lib/roadmap.js` velocity outputs.

**Named churn files from the review, examined and dispositioned (no new headwind).** All five were re-counted at this HEAD; each maps onto an existing headwind or onto substrate-finishing, so none is ranked in its own right and none changes the ordered list:

- `LinearViewer` `public/observation.js` (**19 fp / 26 all**) and `routes/dashboard.js` (**19 fp / 20 all**): the rulings/decision feed build and the scan-due surface (`LIN-2754`–`LIN-2780`, `LIN-2444`, `LIN-2666`/`2700`/`2706`/`2707`) — **folded into H3**; the residue (chat-request sweep, effort read-out) is substrate finishing.
- `simple-dispatcher` `dispatcher.js` (**19 fp / 23 all**): the halt program (`LIN-3042`–`3046`, netted), the H5 repair class (`LIN-2510`/`2511`/`2515`), terminal-driver/launch work (`LIN-2446`/`2452`/`2457`/`2509`, not repair — netted as in the `reapers.js` split above), held-queue-head routing (`LIN-2456`), rootItemId threading (`LIN-2333`/`2366`), clone-root trust (`LIN-2361`), the docs split (`LIN-2897`) and the effort axis (`LIN-2567`) — **split across the halt program and H5; the rest is substrate finishing**.
- `simple-dispatcher` `hook.js` (**11 fp / 16 all**): the rulings on-answer path (`LIN-2774`, `LIN-2891`, `LIN-2991`) and the repair class (`LIN-2556`/`2560`/`2339`) — **split across H3 and H5**.
- `simple-dispatcher` `config.js` (**13 fp / 15 all**): the halt wiring (`LIN-3045`/`3046`, netted), OpenCode work (`LIN-2839`, `LIN-2736`, `LIN-2837`) and the H5 repair class (`LIN-2510`/`2515`); the remainder (`LIN-2446`/`2458`/`2509` launch and breaker, `LIN-2423` lane markers, `LIN-2361`/`2393` clone-root) is substrate finishing — **split across the halt program, H6 and H5**.

**A widening the second-read forced, not one this run planned.** The initial draft omitted the Flight Companion / companion-observer program entirely (the window's largest single-epic program); the required adversarial second-read surfaced it and it is now H2. See the `## Adversarial Second-Read` section for the provenance.

---

# For the human, in one paragraph

The top headwind this cycle is the review layer's own cadence (H1, high): the periodical instrument is fixed (`LIN-2385`) but the measured layer stayed silent ~4 weeks and only resumed with today's 19:00 batch — 8 templates, including the Stability Review, are still `never`, and the gap is inferred from a snapshot rather than censused. The largest single *program* is the Flight Companion / companion-observer build the initial draft missed and the required second-read caught (H2, medium): 84 window tickets under the held `LIN-751` (53 children), mostly forward capability with a live fix/polish string, and the second-largest `front:` label after `front:dispatcher-substrate` (123). On the same sizing basis the rulings substrate is 83 window tickets (H3, medium), and the SD runner repair class (H5, medium) is a real but smaller drag than the draft claimed: re-derived at **23 tickets** and **9 repair-only `reapers.js` touches** — not 77 and 22 — with the 28-day share elevated under the ticket-title rule (34.5→49.2%) but flat under the commit-subject rule (27.9→26.9%); research's `48/63/64` and the prior both-rules claim are withdrawn as unreproducible or superseded. Its sharpest instance is the wake/resume fix-induced chain: the one carried-gap link in this window (`LIN-2331`→`LIN-2414`, where the prior fix's own title admits it did not bound its class) closed on 09-02, and the rest of the chain is adjacent-independent repairs and ledger follow-ups — so this is "residue unproven-watch", not an ongoing whack-a-mole. The credential/identity family (H4, medium) is still active but is a deliberate re-architecture, not neglect: `LIN-1981` is re-sequenced behind the v1 dress rehearsal and needs only production DB access, while five new Backlog family items await a triage pass. Two new watch items sit alongside: an OpenCode harness being finished but with five open faults (H6), and the rulings feed's named regression (`LIN-2766`, H3) still open. A real production incident on 2026-09-22 was handled well and converted into a halt program, now closed. On the ledger's other side: the north-star drift is resolved (reading fresh against v3 — the first consumable reading in this series), the Sonnet-5 cliff is cancelled, the cost-metric denominator and parked-at-plan-review are fixed (the latter: root mechanism closed, convergence watch), and direction-drift is a new baseline rather than a delta. The most compounding items if left untouched are the open SD runner residue, the `LIN-2766` regression, and the five 0-comment credential and harness Backlog items — none of which is escalated beyond what the ledger already marks, and none of which this advisory review turns into a task.

---

# Trend ledger — for mechanical comparison next run

| name | 08-29 | 2026-09-26 | movement |
|---|---|---|---|
| `north-star-version-drift` | still v1 vs v2; reading `stale`, empty | `LIN-2254` Done 08-30; reading `fresh` 7d, `drift:false` vs **v3** | **resolved** |
| `periodical-cadence` | 10/15 `never`; landed reviews still read `due` at 21d | instrument fixed (`LIN-2385`); 8/15 `never`; layer silent 08-30→09-26 19:00, then today's batch (7 templates) | **instrument fixed / measured-layer worsened-then-emitted** |
| `gate-falsification` | LIN-1661 deferral expired, unactioned | `LIN-1661` **Canceled** 09-12 (superseded by `LIN-1871` ruling); `LIN-1873` Done 09-04 | **resolved-by-supersession** |
| `credential-defect-cluster` | corrected: closed `LIN-2231` incident program + one infra-blocked loose end | still active: `LIN-1981` Todo re-sequenced behind `LIN-2953`; five new Backlog family items; deliberate re-arch `LIN-2883/2884/3059` | **still active (unproven-watch)** |
| wake/resume fix-induced chain | `LIN-2297` Done → `LIN-2331` Backlog | `LIN-2331` Done 08-30 → `LIN-2414` Done 09-02 (the one carried-gap link) → `LIN-2468` Done, `LIN-2474/2476` Backlog; `LIN-2511`/`2517` Done → `LIN-2532` Todo / `LIN-2564` Backlog / `LIN-2563` Done | **continued by one carried-gap link, then settled into residual/adjacent follow-ups; residue unproven-watch** |
| Sonnet-5 pricing cliff | expires 08-31, 36.2% of window spend | cliff **cancelled** (`LIN-2384` Done); no expiry field remains | **resolved** |
| *(new)* `simple-dispatcher-repair-concentration` | — | repair class **23** tickets (`LIN≥2384`; 12 Done / 11 open) + **9 repair-only** `reapers.js` touches (of 22); share elevated under ticket-title rule (34.5→49.2%; linked-only 42.3→50.8%) but flat under merge-subject rule (27.9→26.9%); recent/immediate rule-dependent | **new, medium (re-graded from high); share rule-dependent** |
| *(new)* `flight-companion-build-concentration` | — | 84 window tickets (`front:flight-companion`) — largest single-epic program (`LIN-751`, 53 children, 51 in-window), but second-largest `front:` label after `front:dispatcher-substrate` (123); `routes/flight-companion.js` 21 fp touches; mostly forward capability + a fix/polish string | **new, medium / unproven-watch — added after second-read** |
| *(new)* `rulings-substrate-churn` | — | `front:rulings` 83 window tickets; feed build `LIN-2754–2780` Done; regression `LIN-2766` Backlog; `routes/proxy-rulings.js` 11 / `lib/unanswered-decisions.js` 13 | **new, medium / unproven-watch** |
| *(new)* `opencode-harness-churn` | — | 14 enumerated window members; `LIN-2876` Done; `LIN-2877–2881` Backlog; runner 9 fp / 14 all touches | **new, medium / unproven-watch** |
| *(new)* `unpriced-model-gap` | — | `claude-opus-5-5` / Fable 5.1 absent from `lib/model-pricing.js`; `LIN-3094` Backlog | **new, medium** |
| `delivery-throughput` | fork: LV +66% incl. 08-23 lane day / −10% excl.; SD flat-low | fork, per window — LV steady ~10/active-day (28d 12.79 incl. 09-04+05 spike; 10.36 excl.), SD 4.35 baseline → 4.07 → 2.75 → 3.50, below baseline (see *Delivery throughput — per-window fork*) | **fork, not settled (carried)** |
| `cost-metric-denominator` | 1% zero-lineage (n=92); coverage share unpublished | substantially fixed + published; residual `LIN-1960`/`LIN-2477` + unpriced gap | **substantially fixed** |
| `verification-session-share` | 22% impl, flat; 3.8 sessions/ticket | 20.8% impl incl. `wake` / 24.0% excl.; 8.0 incl. / 6.9 excl. sessions/ticket — basis muddied by the new kind | **flat, basis changed** |
| `parked-at-plan-review` | 3 of 5 Done; LIN-1871 root mechanism Todo | `LIN-1871` Done 09-12 (PR #1459) | **improved (root mechanism closed; convergence unproven/watch)** |
| `output-composition` | not re-measured (08-23: flat-high 61–67%) | testShare 56–70% (research sweep) | **unchanged vs 08-23 (08-29 did not measure)** |
| `backlog-conversion` | 134 created / 60 Done (45%) / 62 Backlog | 723 created → 43% Done / 53% Backlog-Todo | **flat, right-censored** |
| `untraceable-completions` | 4/61 = 7% (window cohort) | 48/314 = 15% (subject-citation, over-counts) | **new baseline** |
| `external-injection-break` | retired | — | retired, stays retired |
| `cost-per-verified-task` | retired | — | retired, stays retired (new distinct risk = unpriced-model gap) |
| `proxy/provider-abstraction cluster` (LIN-2350–2363) | reframed transition-incompleteness, not ranked | folded into the LIN-679 decomposition note (H5) | **not ranked as a headwind** |

---

# What this review did not measure, and why

- **`lib/escalation-kpis.js` output** (false-escalation rate, a v3 headline KPI): served only at `GET /workspace/:urlKey/api/escalation-kpis` (session-auth, not reachable via `/api/proxy`); `LIN-2691` still Backlog. Fallback used: tracker states + git. Not measured.
- **`lib/roadmap.js` velocity outputs**: pure functions exist; no `/api/proxy` route surfaces them, and the proxy shows only the digest narrative. Not measured.
- **`lib/follow-on-ratio.js`** (the LIN-1661 instrument): reachable but self-reports ~1,562 calls / ~29 minutes; the question it answers was superseded by the `LIN-1661` cancellation. Not run.
- **True in-progress age**: `lib/roadmap.js:659` computes staleness from `createdAt`; no state-history endpoint exists, so time-in-progress (as opposed to ticket age) is unreachable.
- **A reproducible periodical dispatch census**: `/dispatch` caps at 100 items with no cursor/date filter; the ~4-week gap is inferred from the registry snapshot (H1).
- **`/cost`-derived session-kind figures**: carried from this task's research record at the unchanged HEAD (provenance stated in §Method); not re-swept this run for the cost reason 08-29's method note defends.
- **Net backlog delta**: no 08-29 backlog census exists to diff against; the window-cohort figures are the closest substitute and are not a delta.
- **Agent effort before ~2026-07-30**: unreachable, 30-day telemetry TTL, unchanged since every prior run.
- **The Stability Review seam (pure churn convergence)**: out of scope — `stability-review` is still `never` dispatched, so there is no sibling verdict to cite and the seam is **unowned this cycle**; churn is cited as one drag among several above and the convergence analysis is not run here.

---

## Corrections after independent review

The independent review of PR #1590 (comment `390473f0`, Request Changes, 8 must-fix M1–M8 and 7 non-gating N1–N7) prompted this corrective pass. The must-fixes, all applied in place against live data: **M1** periodical wording corrected (six at ~19:00Z; `documentation-review` later); **M2** the SD repair share re-derived under a consistent basis (rule A held to the merge-subject form — **flat**; rule B with the eight deliberate-work keywords dropped and both unlinked-unit bases stated — **elevated only**), superseding the prior both-rules claim and research's `48/63/64`; **M3** H1's evidence re-counted to a **23-ticket repair class** and **9-of-22 repair-only `reapers.js` touches**, with the halt/OpenCode/rulings work netted so nothing is double-counted; **M4** headwinds reordered strictly by severity with a stated footprint tie-break, H6 sized on `front:rulings` (83) like H2 (84), H2 requalified against `front:dispatcher-substrate` (123), and all H-labels renumbered; **M5** `LIN-751` children corrected to **53** by `parent.identifier` census (the detail endpoint caps its `children` array at 50); **M6** the 08-29 ledger name `wake/resume fix-induced chain` restored verbatim (stale `(new)` dropped); **M7** per-window per-repo delivery throughput added; **M8** `parked-at-plan-review` re-graded **improved (root mechanism closed; convergence unproven/watch)**. Non-gating **N1** (spine link regraded `incomplete-fix (carried gap)`), **N2** (five named churn files dispositioned), **N3** (distractions Clean-results bullet), **N4** (`LIN-2766` comment count), **N5** (`LIN-3055` recorded as the halt program's self-fix) and **N7** (second-read answer sourcing stated) are applied too.

**The ranking changed.** The top finding is now `periodical-cadence` (**H1**, high), and the SD repair concentration is re-graded **medium (H5)** — no longer high and no longer first — on the corrected evidence. The three second-read fields below are **unchanged from the posted comment `c760a606`**, and "Differed from top finding: **YES**" still holds against this new top finding: the reader's answer named the Flight Companion program, which differs from `periodical-cadence` (that program is now ranked H2); the field records disagreement with the top finding, which remains true.

## Adversarial Second-Read

**Tier: Tier 2** — a fresh-context sub-agent spawned with no memory of this report's drafting turns, given only the report path (`docs/reviews/recent-headwinds-review-2026-09-26.md`, PR #1590), read access to both repos at HEAD (`LinearViewer b5c528c4`, `simple-dispatcher 3b1e734`) and the live `/api/proxy` workspace API, and told to spot-check independently rather than trust the report's citations. Not Tier 3: the reader never saw this session's reasoning or chat history, and this session's own writer did not act as the reader.

**Question asked, verbatim:**

> "What is the largest item in this window that this report missed or misfiled?"

**Reader's answer (reproduced from the second-read return; the sub-agent's full transcript was not retained, so this is the fullest recoverable wording — the posted verdict comment `c760a606` carries only a one-line summary):**

> The largest item in the window is the Flight Companion / companion-observer build (epic `LIN-751`) — 84 window tickets, the single largest program in the window, which the report omits entirely and whose parent epic it misfiles in H7 as merely a "stale, held" In Progress item. The report's H1 claim to be "the largest single-subsystem concentration in the window" is false.
>
> Evidence (all re-derived, `LIN ≥ 2384` = the window cohort; full census = 3,051 tickets): `front:flight-companion` = **84** window tickets; `front:dispatcher-substrate` = 123; Autopilot project = 127; Product = 103; Simple Dispatcher = 77. Recursive window-descendant count (largest of any epic): `LIN-751` = 54. Churn: `routes/flight-companion.js` = **21 first-parent / 21 all-commit** touches since 2026-08-29; **25** first-parent `LinearViewer` commits mention companion/observer/passage/lighthouse — compare the report's ranked H4 (`opencode-runner.js` 9 fp/14 all). The report contains **zero** occurrences of "Flight Companion", "Companion", "observer", "Passage", "Lighthouse", "Autopilot", or any `front:` label; the north-star roadmap narrative it consumes itself names Flight Companion.
>
> Overall ranking: **DISAGREE** — H1's line "77 SD tickets and `reapers.js` 22 first-parent touches are the largest single-subsystem concentration in the window" is contradicted by the census. Differed from top finding: **YES** (my answer is `LIN-751`/Flight Companion, not H1).
>
> Checkable factual errors: (1) **Repo misattribution of the spine SHA** — report says "all SHAs resolve in `simple-dispatcher`", but `f49d0a75` (`LIN-2331`) is a **LinearViewer** commit; `git cat-file -t f49d0a75` in SD fails. (2) **"Largest single-subsystem concentration"** — ≥5 measures exceed 77. (3) **Rule A baseline not reproducible** — applying the report's printed regex gives 105/261 = 40.2%, not the printed 98/261 = 37.5%. (4) **Rule B is not actually stated** — the printed keyword set is truncated with `…`, so its shares are not reproducible. (5) **Periodical timestamp** — `documentation-review` is not `19:00Z` but later that evening. (6) **Census** — live is 3,051, not 3,050. Verified correct: 77 SD-project tickets, `reapers.js` 22 fp, unit counts 261/61/22/14, all causal-spine states, north-star fresh/drift:false v3, the resolved/improved ticket states, 8/15 periodicals `never`, H4/H5 churn counts, model-pricing absence, 0 `dueDate`.

*Label note: the quoted answer was written against the pre-revision labels. This revision reorders the headwinds strictly by severity and reissues labels, so the SD repair headwind the answer calls "H1" is now **H5**, the timeliness card it calls "H7" is **H8**, the periodical-cadence headwind is now **H1**, the rulings substrate **H3**, and the OpenCode harness **H6** (H2, H4, H7 are unchanged). The quote is reproduced verbatim; the re-verification bullets below use the current labels.*

**This session's re-verification of each point (command/API + result):**

- **Spine SHA repo (1): confirmed.** `git cat-file -t f49d0a75` → `commit` in `LinearViewer`, `fatal: Not a valid object name` in `simple-dispatcher`; `LIN-2331`/`LIN-2414` are team-LinearViewer, project none. **Report corrected** — the table intro now says the spine spans both repos and row 1 marks `f49d0a75` as `LinearViewer`.
- **"Largest concentration" (2): confirmed too broad.** Window counts re-derived: Simple Dispatcher 77, `front:flight-companion` 84, Product 103, Autopilot 127, `front:dispatcher-substrate` 123. **Report corrected** — the SD headwind's claim is now scoped to the runner-substrate repair class (23 tickets) and re-graded medium (H5), and the largest single-epic program (H2) is ranked.
- **Missed program (the answer): confirmed.** `front:flight-companion` window count re-derived = 84 (51 Done / 27 Backlog / 5 Todo / 1 Canceled); `LIN-751` has **53 children** and is the immediate parent of **51** of them; `routes/flight-companion.js` = 21 first-parent / 21 all-commit touches; `public/flight-companion.js` 17/20; `lib/chat-tools.js` 17/20; 25 fp commits matching companion/observer/passage/lighthouse. **Folded in as H2** (`flight-companion-build-concentration`), graded medium/unproven-watch (mostly forward capability with a real fix/polish string), with `LIN-751`'s H8 card corrected from "stale" to "held parent of the largest single-epic program".
- **Rule A reproducibility (3): partially confirmed, then superseded.** Re-ran the printed regex the old figures came from → **98/261 = 37.5%** (and 28/61, 7/22, 2/14), so those *figures* reproduced; but the independent review's M2 then showed that rule's basis was inconsistent (branch slugs in some windows, full descriptive subjects in others), so rule A is now defined **merge-subject-only** and gives **27.7% baseline / 26.9% interval28 (flat)** and 31.8%/14.3% recent/immediate, not the old 37.5→45.9.
- **Rule B not stated (4): confirmed, then revised.** The old full keyword set is now printed only as the pre-drop comparator; rule B now drops the eight deliberate-work keywords and gives 34.5/49.2/45.5/42.9 with unlinked-as-not-repair, and 42.3/50.8/45.5/42.9 linked-only.
- **Periodical timestamp (5): confirmed.** Live `/api/proxy/periodicals`: 8 `never`; six of the seven `recent` are `2026-09-26T19:00:16–29Z`, and `documentation-review` has since re-run (`20:15:22Z`, was `19:48Z`, then `20:02Z` during the read). **Report corrected** — "the other 7 … 2026-09-26 (six at ~19:00Z; `documentation-review` later that evening)".
- **Census (6): confirmed.** Full re-page at write time → **3,051** issues, **0** `dueDate`. **Report corrected** to 3,051, noting it grew from 3,049/3,050 as issues land.

**Not verified / not corrected:** H1's "0 periodical dispatches 08-30→09-26 19:00" remains a snapshot inference (the `/dispatch` 100-item cap the report already names); the carried `/cost` session-kind figures were not re-swept; the exact churn-count method for `routes/proxy.js` (37 all vs 36 fp) is immaterial.

**Verdict, as required (three fields):**

Adversarial second-read verdict: DISAGREE
Differed from top finding: YES
Disposition: fixed in place

The reader's own answer names `LIN-751`/Flight Companion, not the SD repair headwind (then H1, now H5). The over-broad superlative (a checkable factual error) and the omitted program are both corrected in place above with provenance, per the 08-29 correction convention. After the independent review's M3/M4 re-count and re-rank, the SD repair headwind is **re-graded medium and fifth (H5)**: the largest single-epic program (H2) and the cadence headwind (H1) now rank ahead of it.
