# Lane Run Review — 2026-08-23

**Scope.** A close-out review of the 2026-08-23 lane run: fifteen long-lived autopilot sessions
(`W0`–`W14`), each handed an ordered ticket list and a file carve, flown concurrently across
`LinearViewer` and `simple-dispatcher` over roughly seven hours. It is a **run** review in the
sense of [`capacity-test-run-review-2026-08-14.md`](capacity-test-run-review-2026-08-14.md) — what
the day produced and what the operating model cost — but its subject is a *method* rather than a
capacity ceiling. The lane model was codified mid-run as [`docs/worker-lane-prompt.md`](../worker-lane-prompt.md)
(LIN-2242, merged `be89296`), immediately flown by six lanes, and caught failing in two specific
ways before the day ended. Those failures are the most useful thing here.

**Author and standing.** Written by the operator who composed and dispatched every lane in this
run. That is a conflict worth naming up front: the successes described below are my own
composition, and so are the two defects in §6 and both framing errors in §4. Where a lane
corrected me, the correction is recorded in its own words, not my paraphrase.

**Method and data sources.**

- **Board state.** Ticket states and comments read live from the Harbour proxy
  (`GET /api/proxy/issues/{id}`) at 22:05 BST, over the 62 tickets touched or considered by the
  run. Counts in §1 are that verified read, not a running tally kept during the day.
- **Merge evidence.** `git log origin/main` over the run window, cross-checked against the PR
  links and merge commits each lane cited in its own close-out comment. Where the two disagreed,
  the git record wins and the discrepancy is noted.
- **Lane telemetry.** Dispatch feedback rows (`GET /api/proxy/dispatch/{id}`) — heartbeats,
  `[evidence]` links, `[usage]` snapshots, terminal markers — for each of the fourteen tracked
  lane dispatches.
- **Budget.** Operator meter readings, reported by hand at seven points during the day. **These
  are plan-wide and include the operator's own non-fleet sessions**; they are not the `/kpis` burn
  gauge, which sees fleet telemetry only. §8 keeps the two apart deliberately — conflating them
  produced a false finding earlier in this same run (LIN-2118, superseded).
- **Data boundary.** No credential material, token values, or transcript content appears in this
  document. Lane behaviour is described from board comments and dispatch feedback only.

---

## 1. Headline outcomes

| | |
|---|---|
| Tickets moved to Done | **52** |
| PRs merged to `main` by lanes | **43** (14:48–21:35 BST; a 44th merge, `784cf1c` Archive document 4, was not lane work) |
| Lane dispatches | **15** (`W0`–`W14`); 12 ran their list to completion |
| Carve collisions | **0** |
| Faked closes detected | **0** |
| Refused or partial closes | **5**, all with cited reasoning |
| Repos touched | 2 |

Twelve lanes completed their full ticket lists. Three ended with real merged work but declined to
close their tickets (§4). The run was wound down deliberately at ~71% of a weekly budget with
three composed tickets consciously not dispatched, rather than run to a ceiling (§8).

**The count that matters least is 52.** Several tickets took more than one PR (LIN-2246 took two;
LIN-694 took two), and three tickets carry landed, CI-green, merged work while sitting open
because their acceptance was not fully met. Ticket count and shipped work are not the same
quantity, and this run separated them further than usual.

## 2. What a lane is

A **lane** is one long-lived session handed an ordered ticket list as a single continuous mandate.
It carries each ticket through claim → ground → plan → implement → review → CI green → merge →
verify the landed commit → Done → close-out, then moves to the next, **without pausing between
tickets to ask permission or hand back a plan**.

Three properties did the work:

1. **Composition is collision-avoidance.** Lanes are partitioned by *subsystem*, not priority,
   because subsystem is the only partition that lets you write a file carve. Every prompt named
   owned files and forbidden files, with an explicit instruction to stop and report rather than
   reach across. The forbidden half is the load-bearing half (§5).
2. **The refusal license.** *"A refused close is a good outcome; a fake one poisons the board."*
   It paid out five times (§4).
3. **Independent re-grounding.** Every lane was told the operator's framing may be wrong and must
   be re-derived at HEAD before acting. This caught two operator errors in this run, one of them
   a fix that would have shipped a regression (§4).

## 3. The fifteen lanes

| Lane | Subject | Result |
|---|---|---|
| `W0` | board truth-up | closed LIN-2231, LIN-2116; corrected three others; **refused** LIN-2010 |
| `W1` | credential observability | 8 tickets — LIN-2076, 1459, 2110, 2109, 2216, 1982, 1746, 1985 |
| `W2` | instrumentation | LIN-1959, 2118, 2147 — complete |
| `W3` | dispatcher | LIN-2229, 2137, 2136, 2119, 2135 — complete in 61 min |
| `W4` | escalation | 11 of 11 — the longest complete list of the run |
| `W5` | provider | LIN-2010 Phase 2, LIN-2239, LIN-1872 — complete |
| `W6` | observer harness | LIN-2132, 2133, 2142 — complete in 40 min; **deferred** LIN-2130 |
| `W7` | lane codification | LIN-2242, 2243, 2244 — complete |
| `W8` | advisory reviews | LIN-1918, 1920, 1922, 1924 — complete in 65 min; filed 8 tickets |
| `W9` | periodicals | report recovery, LIN-694, LIN-1967 — complete |
| `W10` | metric integrity | both tickets landed real work; **both closes refused** |
| `W11` | documentation truth | LIN-1853, 2248, 2250, 2249 — complete |
| `W12` | theme & responsive | LIN-2251, 2252, 2247 — complete |
| `W13` | route decomposition | 2 of 3 stages landed; **close refused** |
| `W14` | credential mirroring | scan landed; **ticket returned to Todo, not Done** |

`W0`–`W9` were flown from hand-written prompts. `W10`–`W14` were the first lanes flown from the
codified `docs/worker-lane-prompt.md`, whose own preamble noted it had been validated only
retrospectively. It has now been flown.

## 4. What the refusal license bought

Five refusals, none of which cost anything and two of which prevented a regression.

**LIN-2010 (`W0`).** I told the lane the ticket was "landed, never closed." It was not — a second
phase had been explicitly excluded from the earlier merge. The lane's own grounding caught it and
it refused the close. This became the evidence for the re-grounding mandate later codified as
Step 1 of the lane prompt.

**LIN-2254 (`W10`) — the most valuable refusal of the run.** I filed the ticket claiming
`lib/north-star-resolver.js` reads a hand-typed string with no link to the doc, and proposed
pointing it at `docs/north-star.md`. The lane re-grounded and found the claim imprecise:
`getWorkspaceNorthStar` is *"not a hand-typed bug, it's a legitimate generic multi-tenant
preference (confirmed against real fixture data with multiple unrelated workspace values)"* — and
my suggested fix *"would have silently broken every other tenant's own north star."* It shipped
additive infrastructure instead (`getNorthStarDocVersion()`, PR #1231, `7e40487`) and left the
ticket open.

An operator-authored ticket proposed a change that would have introduced a multi-tenant data
defect. The only thing between that proposal and `main` was a lane instructed to distrust it.

**LIN-1971 (`W3`).** Reverted to Backlog rather than fabricate a tmux witness it had no way to
produce, naming exactly what would unblock it.

**LIN-2130 (`W6`).** Deferred, citing the brief back at the operator.

**LIN-2246 (`W13`).** Landed 2 of 3 stages (PRs #1230 `e9dce96`, #1232 `80bd043`), then declined:
*"genuinely partial. Leaving In Progress, not Done — full acceptance was not met, and I'm not
fabricating otherwise."* It also wrote characterization tests **before** each move rather than
after, added a route-level test to an endpoint that had none, and caught that the ticket's cited
HEAD sha was stale while re-verifying every content claim against the real one.

**LIN-1981 (`W14`).** Landed a read-only operator scan (PR #1234, `3409820`) after three rounds of
fresh-context sub-agent review, then moved the ticket to **Todo** — the scan is diagnostic
infrastructure, not the fix.

## 5. The file carve

Fifteen concurrent lanes across two repos produced **zero collisions**. The mechanism was not
locking; it was prose. Each prompt named owned and forbidden paths and instructed the lane to stop
and report rather than widen its own scope.

The carve was validated empirically rather than by assumption. `W10` recorded observing `W13`
actively refactoring `routes/workspace-api.js` mid-session — *"direct, observed confirmation the
file carve's 'live' framing was accurate, not theoretical"* — and routed around it, leaving its
own ticket partially discharged rather than reaching across. Two lanes, one file, no collision,
because the forbidden half held under pressure.

**The cost is visible in §4.** Both of `W10`'s refusals and part of `W13`'s were caused by the
carve: the route layer that would have fully discharged those tickets was owned by a live sibling.
A carve that prevents collisions also prevents completions, and this run paid that price three
times. That is the correct trade at fifteen-way concurrency, but it is a trade, not a free win.

## 6. Where the model failed

### 6.1 The close-out ledger is missing from the codified template (LIN-2256)

The merged lane template's Step 3 defines close-out as *"cited evidence (PR link, merge commit, CI
result)."* This is precisely what `CLAUDE.md` says close-out must **not** be:

> green CI alone never discharges a ledger item (the item exists because CI cannot reach it) … a
> missing/unparseable ledger BLOCKS — it is never read as "empty" (the original LIN-735 collapse)

The template therefore reproduces the exact failure the LIN-550 → LIN-810 → LIN-823 → LIN-1365 →
LIN-1579 lineage was built to prevent. **All 52 closes in this run were made under it**, with no
`### What CI Did Not Prove` ledger anywhere.

The gap lands hardest where the run was most self-referential: LIN-2242, LIN-2243 and LIN-2244 are
prompt-text changes, the canonical "unprovable before merge" class, and all three closed on green
CI. An independent review dispatched specifically to check those three closes found none of them
*unsafe* and reverted nothing — so this is a discipline gap, not a correctness incident. It is
tracked as **LIN-2256**, which was raised independently rather than by me.

### 6.2 Two lanes split on the sentinel vocabulary

`W10` and `W14` hit the identical situation — waiting on a fresh-context review sub-agent they had
themselves dispatched — and chose opposite sentinels:

- `W10`: `PENDING-INTERNAL: Waiting on a fresh-context review sub-agent I dispatched` — correct.
- `W14`: `PENDING-EXTERNAL: waiting on the fresh-context review sub-agent …` — incorrect.

A sub-agent inside one's own session is internal. `W14`'s mislabel routed it to a holdable
`AWAITING_EXTERNAL` park, waiting for something external that was never going to arrive. It sat
silent for roughly ninety minutes before recovering.

This is a doctrine gap, not a lane error: Step 3 *mandates* a fresh-context review and names a
sub-agent as the way to get one, but the sentinel vocabulary never tells a lane that its own
sub-agent is internal. Two lanes flying the same document on the same night disagreed.

### 6.3 A completed lane still reads as running

`W14`'s last dispatch feedback is timestamped 19:11 UTC. It merged PR #1234 and posted its
close-out at 20:42 UTC. At 21:05 UTC its dispatch still read `taken`, unchanged at 12 feedback
rows.

**The board said the work was finished; the dispatch said the lane was still running.** An
observer watching the Observation feed would have seen a two-hour hang that had actually completed
eighty minutes earlier. The likely mechanism is §6.2's mislabel — the session parked, so the Stop
hook never posted terminal feedback even as the agent continued working and merged. This is
adjacent to LIN-2244 (parked-lane backstop), which shipped earlier the same evening.

## 7. Board corrections

Three tickets were misrepresenting their own state and were corrected during the run, each with
the reasoning recorded rather than silently edited.

- **LIN-2208 → Done.** PR #1195 merged at 15:23; the lane reviewed it, the PR merged the same
  minute, and it moved on without closing out, then ran two and a half more hours. Bookkeeping
  dropped, not work.
- **LIN-1727 → Done.** Items 1–2 shipped (PR #1213, `0e8a146`); item 3 was a parked ruling,
  resolved by the operator in favour of keeping parked sessions parked — recoverable untidiness
  beats an unrecoverable unattended abort.
- **LIN-1981 → Todo.** Four comments of full root-cause diagnosis, no PR anywhere, In Progress for
  five hours while the lane worked four other tickets. Later picked up and partially discharged by
  `W14`.

**A distinction learned during the run, the hard way.** An ownerless `In Progress` ticket is *not*
inherently a defect — work gets picked up again, and that is normal. What made LIN-2208 and
LIN-1981 defects was **silence**: one was factually wrong about its own completion, the other was
abandoned mid-flight by a lane that stayed alive and worked elsewhere. A documented partial, like
LIN-2246, is honest at any state. The operator initially over-applied the pattern and was
corrected.

## 8. Budget and burn

Seven hand-reported meter readings across the day:

| Time (UTC) | Reading |
|---|---|
| 13:20 | 60% |
| 14:16 | 62% |
| 15:10 | 63% |
| 15:33 | 64% |
| 17:05 | 67% |
| 17:29 | 68% |
| 18:41 | 70% |
| 19:25 | 71% |

Whole-span rate: **1.81 points/hour**, remarkably stable across a day whose concurrency ranged
from three to seven live lanes. Closing estimate after two tapering lanes: **72–73%**.

**These readings are plan-wide and include the operator's own non-fleet sessions**, including a
separate research run on a more expensive model. The `/kpis` burn gauge sees fleet telemetry only.
Earlier in this same run the operator compared the two directly and filed a false finding that the
gauge under-read the burn rate by several multiples; it was superseded on LIN-2118 once the
correct explanation — margin of error plus non-fleet personal use — was established. **Do not
compare the two series.**

**The run was wound down at ~71%, not run to a ceiling.** The reasoning: the budget week resets
Thursday 06:00Z, so at Sunday evening the run was ~3.5 days into a 7-day window having spent 70%,
leaving ~30% for the remaining three and a half days — less headroom than the single afternoon had
consumed. Three composed and carved tickets (LIN-2240, LIN-2241, LIN-2245) were consciously not
dispatched. Pre-committed trim triggers (80% → two lanes, 88% → finish in-flight only) were set at
60% and never reached.

## 9. Verdict and open threads

**The model works, and its failure modes are now known rather than suspected.** Fifteen concurrent
lanes, 43 merged PRs, zero collisions, zero faked closes, and five refusals that included one
prevented multi-tenant regression. The refusal license and the re-grounding mandate are the two
clauses carrying that result; both were validated against operator error, which is the only test
that counts.

**Three threads leave this run open:**

1. **LIN-2256** — the close-out ledger gap (§6.1). Its own acceptance requires a flown lane
   demonstrating the doctrine, which creates a recursion: that lane needs a ledger under a
   doctrine that does not yet exist. Whoever flies it should hand-author its own ledger rather
   than wait for the mechanism, or the close either self-certifies or deadlocks.
2. **LIN-1809** — no durable run record existed while this run was flying. The plan, the carve,
   the ordering and the wind-down reasoning lived only in an operator session. This document is a
   retrospective patch, not a substitute. Note that the Passage Planner and Runner both already
   ship: this is an **adoption** gap, not a capability gap, and improving the artifact will not
   fix it.
3. **LIN-2253 / LIN-2254** — both carry landed infrastructure and both need a route layer that was
   carve-locked. They are the highest-value resumable work on the board.

**One economic note for whoever plans the next run.** Sonnet 5 introductory pricing ends
2026-08-31. This run's cost per ticket is not the figure to plan against after that date.

---

## Appendix A — cross-checks

- **Ticket counts** are a live per-ticket state read over 62 identifiers at 22:05 BST, with HTTP
  status asserted on every response. This matters: two earlier sweeps during the run returned
  silent empty results that were actually a `400` (wrong query parameter name) and a rate-limit
  rejection (the proxy caps at 60 requests/minute). **A silent non-200 is indistinguishable from a
  genuine empty result** unless the status is checked, and in one case it nearly produced a
  duplicate ticket filed on a false premise.
- **Merge counts** come from `git log origin/main` over the window, not from lane self-reports.
  Where a lane cited a PR, the merge commit was confirmed present on `main`.
- **`W13`'s stale-sha finding** was independently verified: the ticket cited HEAD `0e8a146` while
  actual HEAD at claim time was `095b44d`. Every content-level claim in that ticket still held.

## Appendix B — provenance

Board reads and comment writes via the Harbour proxy API under an operator token. Lane dispatches
via `POST /api/proxy/dispatch`, target `cli`, harness `claude-code`, model `claude-sonnet-5`, each
stamped with a readable `sessionId` (`voyage-<subject>-2026-08-23`) — legal since LIN-1118 and
codified for lanes by LIN-2242. Fourteen dispatches used the convention; it is what groups this run
in Observation.

No credential material appears in this document or in any comment written during the run.
Diagnostic work on LIN-1981 used synthetic credential values throughout.

## Appendix C — what this document cannot tell you

- **Per-lane cost.** Lane workers largely sit outside the terminal-marked-task cost denominator —
  the defect this run itself caused and filed as LIN-2253, partially fixed by `fb8c023`. Any
  cost-per-ticket figure computed for this day before that fix is unreliable, and this document
  deliberately quotes none.
- **Whether the 52 closes were correct.** They were made without the ledger discipline described
  in §6.1. An independent review confirmed three of them and reverted none, but 49 remain
  unexamined against a standard that did not exist when they were made. That is the honest
  position, and no claim here should be read as stronger.
- **Intra-session behaviour.** Everything here is derived from board state and dispatch feedback.
  What happened *inside* a lane's turns is not visible at this altitude — the same blind spot
  [`intra-session-efficiency-review-2026-08-14.md`](intra-session-efficiency-review-2026-08-14.md)
  was written to address for a different day.
