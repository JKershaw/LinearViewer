# Spike 2b: the parked-run guard (should a parked run hold its ticket?)

27 Nov. Read-only. Code at main `5c33e4415`; simple-dispatcher (SD) at `d692ac7`.
Tickets read through the proxy (GET only), saved in the scratchpad `parked/`.
Marks: **shown** (with a citation) or **unknown**.

## The answer in brief

- The guard was built to stop two *different* stages running on one ticket at once.
  Holding a *parked* run was one sentence in that plan, written with CI parks in mind.
- Nobody designed for a stage parked on *another stage*. The blind-read exception patched one case.
- Plain removal is safe enough. The "resume" half isn't needed: hand-offs are records now.
- One small leftover: the old parked session lingers. Better to have a hand-back end its run.

## 1. Why the guard exists

- **Origin: LIN-4392, commit `7ac075daf` (10 Nov).** Shown. The selector could start, say,
  implementation while plan or review was still live. The duplicate guard only catches the same
  kind within 5 minutes (`lib/dispatch-factory.js:79`, `:257-287`).
  The harm it named: "burn a whole run" and "conflicting PRs or verdicts" (LIN-4392 As asked).
- **No incident.** Shown. The ticket says the class "has not been seen to cause harm".
  It was preventive, priority medium, because autopilot volume made a repeat likely.
- **Why parked counts as live.** Shown, LIN-4392 plan, "Likeliest ways this breaks" 1:
  "A run that parks `[pending]` reads `running` and holds the ticket while CI runs, which is
  correct: the ci-wake resumes that same session." In code it fell out of `runFact`: a row with
  no terminal marker reads `running` (`lib/recent-runs.js:81-94`).
- **LIN-4459 (`e9a3cb324`, 13 Nov)** kept that and only ended the hold when the park's lineage ends.
- **So, for question 1:** the guard protects a CI park, where the parked run *is* the one
  that will act next. It was never meant for a run parked on another stage. Shown (plan text).

## 2. The blind-read exception (#2492) and why it stopped short

- **LIN-4499, 20 Nov.** Shown (log.md 4928). Close-out opened a fix PR before the blind read, then
  held the ticket. The engine wouldn't send the read; close-out couldn't merge without it.
- **#2492 (`9a4f3c795`, 22 Nov, LIN-4518 step 3)** skips a live close-out *when the close-out
  gate says it waits on the blind read* (`lib/code-routes.js:38-44`, `lib/run-live-wait.js:64-67`).
- **It was scoped, not a choice against removal.** Shown. LIN-4518's ask: "A parked close-out
  allows the review and any owed blind read to proceed." Its review counted both halves met.
  No reading discusses plain removal. **Unknown** whether anyone considered it.
- **The review half only works when there is no blind read on record.** Shown.
  The exception keys on `closeOutWaitsOn` (`lib/run-closeout-state.js:168-173`), which returns
  `blind-read` only when some landing PR lacks a read. The review-half witness has no read on its
  trail (`tests/unit/lin-4518-step3-consumers.test.js:86-97`).
  This week's case had a read on record (it stands across re-reviews, LIN-4544, #2499, 23 Nov).
  So the wait holds, and the re-review route (`code-routes.js:59`, LIN-4521) is never reached.
- **The exception doesn't check that close-out is parked at all.** Shown (`run-live-wait.js:66`).
  A blind read can already run beside an *active* close-out. No harm recorded from that.

## 3. Which risks still apply

| Risk the guard covers | Still real now? | For a *parked* run? |
|---|---|---|
| Two stages' work conflicts | Mostly gone: verdicts pin to a change version; a moved head forces re-review (LIN-4521); close-out merges with `--match-head-commit` (`prompt-template-defs.js:823`) | A parked run is idle. It can't conflict until resumed |
| A wasted run | Yes, but small | Only if the parked run will act next (a CI park) |
| Selector ignores live runs | Yes; it sees them as a hint only (`run-live-wait.js` header) | Removal applies to idle parks only, so this stays covered |

- Each SD session works in its own clone (`sd-main/clones.js:3`, LIN-558). Shown.
  So two runs never share a worktree. They can share a PR branch.

## 4. Risks of plain removal

1. **Fresh close-out instead of resuming the parked one.** Likely: it's the normal path.
   After the re-review approves, the selector picks close-out again. The duplicate guard lets it
   through (old row is older than 5 min). The fresh one reads its brief from records. Low harm.
2. **The old parked session lingers, then wakes.** Likely. SD re-asks a silent park after
   `STALL_FAILSAFE_MS` (60 min), up to a re-fire cap, then fails it (`sd-main/reapers.js:969-997`).
   On re-ask it could act on a stale picture: post a second summary, try to merge.
   A merge is pinned to the approved head, so it can't land unreviewed work. Low to medium harm:
   noise and a wasted turn. It also holds a terminal and a clone meanwhile (notes-review C12).
3. **Two runs push to one branch.** Unlikely: needs a resumed parked run plus a fresh one of
   a pushing kind (implementation or close-out). Git refuses a stale push; merges are pinned.
4. **A CI park stops holding.** Frequency **unknown** (runs mostly wait on CI in-session now,
   notes-review C14). Review could start before CI ends. If CI fails, the fix push stales the
   approval and the re-review route sends review again. One wasted review.
   **Unknown:** whether a ci-wake follow-up (a `custom` row, not counted) shows as live while it works.
5. **Racing calls.** Unchanged: the wait is a read, not a claim (`run-live-wait.js:28-31`).
- **Evidence it's already safe in practice.** Shown in spike 4 §7: 12 reviews and 2 blind reads
  ran beside parked close-outs this week by `kind` override. No harm recorded (**unknown** if any).
- **Side benefit.** A parent with a parked stage no longer stops descent into its children
  (LIN-4392 survey ecaeac7f, "Parents"). Whether that happens now: **unknown**.

## 5. Removal alone vs removal plus resume

- **Removal alone fixes this week's loop.** Close-out parks; re-review route sends review;
  review approves; close-out runs fresh. Shown by route order (`code-routes.js:32-63`).
- **Resume adds code:** find the parked lineage, turn the dispatch into a `followUpTo`.
  It can't apply to judging stages (`JUDGING_RUN_NOT_FRESH`, `proxy-instructions.js:802`).
  It meets the runner's resume race: 20 of 65 resumes lost since 24 Nov (LIN-4569).
  The resumed session's clone may sit on an old head.
- **What resume buys:** the session's memory, and no lingering session. The memory isn't needed:
  close-out's hand-back writes a finding `to: review`, and the next brief carries it.
- **The lingering session has a cheaper answer:** a hand-back ends the run, it doesn't park.
  Close-out's step is finished when it names review next (`prompt-template-defs.js:805`).
  **Unknown** why it says PENDING-EXTERNAL rather than DONE; likely the runner's "not done" word.

## 6. Recommendation

1. **Remove the hold for parked runs.** A `[pending]` park with no follow-up live is not live.
   Delete the blind-read exception with it (`code-routes.js:38-44`, `run-live-wait.js:56-66`).
   Show parked runs to the selector as parked, not running.
2. **Don't build resume.** Records carry the hand-off. Revisit only if fresh close-outs lose
   something a record should have held.
3. **Have a hand-back end its run** instead of parking, by judgement in the existing words,
   not a new rule. If that proves hard, SD's failsafe still bounds the lingering session.
- **Witness:** a unit test with a parked close-out, a blind read on record and a moved head
  recommends review (fails today). Live: the next hand-back goes review → close-out with no override.
- **Watch:** wasted reviews after CI parks, and duplicate close-out summaries.
