# Experiment 2 prediction: one authority for "which wake marker means waiting on a person"

Grounded at LinearViewer `d349e78c`, re-verified at `f885f44c`, which is origin/main after LIN-3600 merged. LIN-3600 touched none of the cited files, so every file:line still holds. **Revised after LIN-3600 merged and before launch:** the seams baseline is now 18 pairs (§3), the (d) handling changed, and the census step was dropped from the ticket.
Source of the decision: Drift & Coherence Review 2026-10-12, finding 3 `human-wait-derivation-split`
(`docs/reviews/drift-coherence-review-2026-10-12.md:140-155`, ledger row `:517`), candidate 2 of
LIN-3339, the standing ticket this serves. This PR does not finish LIN-3339. The review lists LIN-3339
as "In Progress" (`:392`) and says it was updated (`:155`, `:375`); its state today is not known from
the repo. The review says the channel ruling ("does agent-status start a waiting clock?", `:155`, `:526`)
comes first. That ruling is out of scope here, and the consolidation below does not need it.

## 1. Sites verified at d349e78c

**Scope of the decision.** The decision is which wake marker means "paused waiting on a person".
Every copy answers `{'blocked'}`. None of them disagree on that set. Every disagreement is in the
*composition around it*: which channel counts, what ends a wait, and when a question goes stale. §2
lists those disagreements.

| # | site | what it decides | literal | same decision? |
|---|---|---|---|---|
| A | `lib/digest-feedback.js:56` (used `:346`) | authority today: `waitingMessage` only for a waiting marker | `export const WAITING_WAKE_MARKERS = new Set(['blocked'])` | authority (LIN-3008 moved it here from pipeline-loops) |
| S1 | `lib/render-run-steps.js:159` (used `:198`, `runIsWaiting` `:191-199`) | per-run "◐ waiting for input" flag (`:398-400`) | private `new Set(['blocked'])`, "keep in parity" `:155-156` | same |
| S2 | `routes/dashboard.js:338` (used `:362`, `loopIsWaiting` `:354-363`) | session banner / feed `waiting` (`deriveSessionWaiting` `:396-416`) | private `new Set(['blocked'])`, "keep in parity" `:333-337` | same set, plus the agent-status channel `:356` |
| I1 | `lib/run-view.js:232` (`waitingClock` `:226-243`) | run-page waiting clock + "next: your answer" (`:342-345`) | `wake.marker !== 'blocked'` | same set; skips decision stamps (`lastWakeEntry` `:146-155`) |
| I2 | `lib/task-page-loader.js:175` (`sessionMessage` `:173-180`) | task page: the `[blocked]` line is stale once the session is not `waiting` | `wake.marker === 'blocked'` | same set (LIN-3504; `state` comes from `deriveSessionWaiting`, `:222-230`) |
| I3 | `lib/dispatch-terminal.js:225` (`deriveBlockedStatus` `:219-228`) | wire status `blocked` (proxy list/detail, recent runs, efficacy) | `match[1].toLowerCase() === 'blocked'` | same set, plus the resume-marker rule `:223` |
| I4 | `lib/unanswered-decisions.js:71` (`resolveDisposition` `:70-82`) | reply disposition `resumable` | `loop.wakeMarker === 'blocked'` | same set |
| I5 | `lib/observer-sweep.js:97` (`classifyLoop` `:93`) | census lane `blocked` | `wakeMarker === 'blocked' \|\| agentState === 'waiting'` | same set, plus the agent-status channel |
| I6* | `lib/observer-efficacy-signal.js:110` (used `:295`) | first `[blocked]` for the time-to-respond signal | `/^\s*\[blocked\]/i` | same set (comment `:104-109` says it mirrors WAKE_FEEDBACK_REGEX's `blocked`) |
| I7* | `lib/dispatch-wake.js:343` (`classifyWake` `:340`) | wake-debounce shadow tally reason `blocked` vs `terminal` | `marker === 'blocked'` | same set |
| R1 | `lib/recent-runs.js:39` | selector label "waiting on a person" | `status === 'blocked'` on `deriveWireStatus` | reads I3's output, so it already reaches the decision; keep |
| M1 | `lib/pipeline-loops.js:150` (`_deriveAgentState` `:144-152`) | agent-status word → `agentState: 'waiting'` | `agentStatus === 'blocked'` (exact case) | different vocabulary (agent-status channel): channel ruling |
| M2 | `lib/live-console.js:122` (`statusToKind` `:118-125`) | console event kind `blocked` | normalised `blocked\|pending\|waiting` | different vocabulary, display kind: (d) |
| T1* | `lib/render-session.js:80` (used `:98`) | transcript highlight of a "paused on human input" entry | `/^\s*\[(blocked\|pending)\]/i` | **diverges**: includes `[pending]` |

`*` = found by this check, missing from the census site list and from the review. Census groups: the
set copies are census-HEAD **G0040** (`named constant WAITING_WAKE_MARKERS=Set[blocked]`, 3 sites).
**G0038** in `dl1/census-HEAD.json` is `MAX_NAME_LENGTH`, so the brief's group id is off by two.
**G0010** (`[blocked]` text contract, 15 sites) is mostly emitters and docs (`dispatch-factory.js:375`,
`observer-shadow-log.js:101,105`, `proxy-instructions.js:670,921`, `runner-kit/runner.mjs:88,396`,
`recommendation-facts.js:405`, `flight-companion-kickoff.js:96`). Its only decider is I6
(`observer-efficacy-signal.js:110`).

## 2. Divergences and classes

| id | divergence | evidence | class |
|---|---|---|---|
| D0 | Stale parity comments point at copies that moved or no longer exist: `digest-feedback.js:50-55` ("Mirror any change here in routes/dashboard.js"); `render-run-steps.js:155-156,187` and `dashboard.js:333,337` cite pipeline-loops; `observer-sweep.js:60,62` cites `dashboard.js:273` and `pipeline-loops.js:47`; `dashboard.js:345` says `[pending]` counts | text vs code | (a) fixed by deleting the copies |
| D1 | **Channel** (stays with LIN-3339): the banner (`dashboard.js:356`) and the census lane (`observer-sweep.js:97`) count agent-status `blocked` (`agentState 'waiting'`). The run flag, waiting clock, disposition and wire read the marker only | review `:144-148` | out of scope (the channel question); keep each caller's composition |
| D2 | **What ends a wait** (stays with LIN-3339): history cancelled/expired becomes agentState complete/error (`pipeline-loops.js:146-147`). The banner reads that, and treats agent-status completed/failed as ended too (`dashboard.js:226,244`). The lane treats cancelled/expired as `resolved` (`observer-sweep.js:106-108`). The flag, clock and wire read the feedback terminal markers and the closed stamp (`render-run-steps.js:193`, `run-view.js:229`, `dispatch-terminal.js:256`); the flag and clock also skip superseded runs. Reachable: `observer-sweep.js:102-105` says such a row can carry a stale `blocked` | probe below | out of scope: stays with LIN-3339 |
| D3 | **Resume marker**: only the wire clears `blocked` on `[working] Session resumed.` (`dispatch-terminal.js:110,223`; LIN-2123/LIN-2268, "consumed ONLY by deriveLifecycleStatus" `:101-108`). Pages rely on supersession instead | probe | (b) keep, wire-only by design; whether pages adopt it is (d) |
| D4 | **Decision stamps**: the clock skips `decision-*` stamps (`run-view.js:126-131,150`, LIN-3037); `findWakeEvent` does not. Stamp messages are JSON (`dispatch-store.js:2770-2772,2844-2846`), so never wake-prefixed | probe shows it on synthetic stamps only | (c) bounded fuzz, unreachable in production |
| D5 | **`[pending]` in the transcript highlight** (`render-session.js:76-80`, "a run paused on human input") vs LIN-1025's exclusion (`render-run-steps.js:156-158`, `dashboard.js:335-337`) | code | (d): rename it to a "pause" highlight (b) or drop `[pending]` (a) |
| D6 | **Agent-status vocabulary** (stays with LIN-3339): `pipeline-loops.js:150` is exact `'blocked'`; the console (`live-console.js:122`) folds case and counts `pending`/`waiting` too, since LIN-1436's first version (5fb198a3), with no recorded reason | git log | out of scope: stays with LIN-3339 |
| D7 | **Closed rows**: `resolveDisposition` checks `[blocked]` (`:71`) before `isRowClosed` (`:74`), so a closed row with a stale `[blocked]` is always `resumable`. Every waiting reader excludes closed rows (`render-run-steps.js:193`, `run-view.js:229`, `dashboard.js:244`, `dispatch-terminal.js:256`) | code | (d), low: SD never reaps a blocked session (`unanswered-decisions.js:52-53`) |
| D8 | **Answered out of band**: only the lane clears `blocked` on a lineage-answered decision (comment `observer-sweep.js:69-76`, code `:143-155`, LIN-2671/LIN-2991) | code | (b) keep; it is part of the review's "3 staleness rules" |
| D9 | **Case**: every site compares an already lower-cased marker (`findWakeEvent` `dispatch-terminal.js:508`, baked `pipeline-loops.js:432`). A hand-built `'Blocked'` reads not-waiting everywhere | replay | none; the predicate must stay exact-match (no lower-casing) to keep outputs identical |

**Cross-caller probe** (`replay/divergence-probe.mjs`, 3,000 production-shaped loops, seed 1;
`replay/divergence-probe-d349e78c.txt`): banner vs run flag disagree on 693 loops (history cancelled
or expired 255, agent-status completed or failed 162, channel only 74). Clock vs wire disagree on 231
(resume after `[blocked]` 72+, synthetic stamps 26). The run flag and the disposition never disagree
with each other. The probe output is byte-identical on the consolidated preview, so the consolidation
neither fixes nor adds any of these divergences.

## 3. Home and shape

- **Home: `lib/dispatch-terminal.js`** (area "Runs & dispatch"). The rule changes only if the runner's
  wake-marker contract changes, and that file owns the vocabulary: `WAKE_FEEDBACK_REGEX` `:63`,
  `findWakeEvent` `:503`, `deriveBlockedStatus` `:219`. It imports only `./utils/time.js` (`:27`).
  Every caller module already imports it except `observer-sweep.js`, which needs a same-area import
  and an update to its pinned import list (`tests/unit/observer-sweep.test.js:1734`). `digest-feedback.js`
  imports dispatch-terminal (`:39`), so the set moves down the import graph.
- **Shape:** `export const WAITING_WAKE_MARKERS = new Set(['blocked'])` plus
  `export function isWaitingWakeMarker(marker)` (exact `Set.has`, null-safe). Callers use the
  predicate. The wire still returns the word `'blocked'`. The LIN-3258 pin
  (`tests/unit/liveness-contract-and-capability.test.js:21,47-50`) imports the set from the new home.
- **Knots** (`seams.mjs`). Revised after LIN-3600 merged, before launch. The worker compares HEAD
  against the origin/main it branches from. At `f885f44c` that is **18** pairs and 1 group of 9;
  LIN-3600 removed *Providers ↔ Runs & dispatch* and *Front end ↔ Other features*.
  **Prediction: 18 → 18, no new pair, the group stays at 9.** Evidence: on d349e78c the hand-made
  consolidated copy (`tree/`) gave 20 → 20 with a byte-identical `links` table, so the change adds no
  cross-area edge. LIN-3600 touched none of the edited files, so this carries over to `f885f44c`.

## 4. Sites before → after (predicted)

- **By hand:** 10 membership deciders (A + S1, S2 + I1–I7) become **1** (`dispatch-terminal.js`).
  The 2 set copies go to 0 and the 7 inline checks go to 0. All 10 call sites reach the authority.
  R1 reaches it through I3. M1, M2 and T1 stay as separately named decisions pending rulings
  (D5, D6, channel).
- **By grep** (the ticket's check): 23 hits at `f885f44c` → **14** on the preview. That is the authority
  in `dispatch-terminal.js`, the 10 expected sites listed in the ticket, and 3 comment-only lines in
  `observer-sweep.js`.
- **By census** (the reviewer's measure after merge, not in the ticket; `dl1/census.mjs` on the copy,
  base vs preview): groups 310 → **309**, sites
  1026 → **1022**. The `WAITING_WAKE_MARKERS` constant group (3 sites) dissolves. The `[blocked]`
  text-contract group goes 15 → **14** (I6's regex). Group ids are run-dependent: G0040 here was G0072.
- **Lines** (preview): production +30/−47 in 10 files, tests +2/−2. Predicted PR: net −10 to −25
  production lines, plus +20 to +60 test lines (a behaviour test for the predicate, and source-pin
  conversions if any). Deleted comment blocks must keep their reasons and tickets (LIN-1005, LIN-1025,
  LIN-843, LIN-3008, LIN-3258) beside the authority.

## 5. Replay (independent, outside Harbour): `replay/`

- **Callers (16 exports):** `deriveLoopFacingFacts`, `renderStepFace`, `deriveSessionWaiting`,
  `buildRunView`, `sessionMessage`, `deriveBlockedStatus`, `deriveLifecycleStatus`,
  `deriveWireStatus`, `resolveDisposition`, `classifyLoop`, `recentRuns`,
  `__internal._deriveAgentState`, `statusToKind`, `computeIncumbentSignal`, `classifyWake`,
  `renderSessionPage`.
- **Inputs:** 3,046 deduped argument lists captured from 72 unit-test files (2,574 tests pass under
  capture), plus 3,000 seeded generated inputs per caller (48,000). The generated inputs cover all 6
  wake markers in 3 cases, 8 non-wake and 6 unknown markers, mid-sentence mentions, the resume marker,
  stamps, every agentState, agent-status word, history status, closed stamp and task-page state, and
  malformed feedback. Clock frozen at 2026-10-15T12:00Z, TZ=UTC, `Math.random` seeded, network blocked
  (0 attempts).
- **Self-check** (`selfcheck-run2/`, n=1000): identity on 2 seeds (2 fresh pins of d349e78c) gives
  0 differences. 14/14 planted per-site mutants are caught on exactly the expected callers, one per
  site (adding or dropping a marker, case, channel removed). Mutant M15, the new authority widened to
  `pending`, is caught on 13 callers. 2/2 equivalent mutants show 0 differences.
- **Coverage** (V8, lines of the functions holding a site): 100% for all 19 touched functions.
- **Preview: old vs hand-made consolidated, 51,046 inputs: 0 differences** (`report-preview.json`).
  That is the expected result for a membership-only consolidation. None of D1–D8 appears as a
  difference, because the PR must not change any composition. If the merged PR shows differences,
  each one is a behaviour change that needs its class from §2.
- **Run later on the merge:**
  `node replay/pin-side.mjs <repo> <merge^1> <fresh dir>` and the same for `<merge>`, then
  `node replay/replay.mjs --old <parentDir> --new <mergeDir> --n 3000 --seed 1 --coverage --out r.json`.
  Exit 0 = same, 1 = differences or a missing caller. Add `replay/selfcheck.mjs <oldA> <oldB> <new> <fresh dir>`
  for the mutants. A pinned folder recorded under another SHA is refused, never overwritten.
- **Run time:** replay about 7 s (51k inputs), capture about 15 s, self-check about 45 s, seams about 3 s each.

## 6. Expected rulings and Periodical after

- No ruling is needed before launch. The PR changes membership only and keeps every composition.
  For each (d) the worker keeps today's behaviour and writes it up in the PR body under "Open
  questions", plus one comment on LIN-3339. That is expected for D3 (do pages honour the resume
  marker?), D5 (is `[pending]` a pause highlight or a waiting one?) and D7 (closed-row disposition).
  There is no DECISION line and no BLOCKED end. D1, D2 and D6 are out of scope and stay with LIN-3339.
- **Drift & Coherence row `human-wait-derivation-split` after:** "1 authority, 0 set copies, 0 inline
  checks". It keeps the agent-status mapping, the console mapping, the transcript pause regex, the
  2 channel rules and the 3 staleness rules, all as named decisions. Severity drops from Medium to
  Low-Medium, and the row stays open on the channel ruling. Seams & Tangles stays at 18 knots (the post-LIN-3600 baseline).
- **Worker effort:** about 1.5–3 h in one session. Most of the time goes on the DECISION write-ups
  and the comment moves, not the code.
