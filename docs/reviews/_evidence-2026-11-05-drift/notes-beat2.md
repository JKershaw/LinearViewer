# Beat 2 notes: seams, rulings, unlisted scope (LIN-4250, 2026-11-05)

Working notes, not the report. Citations are at LinearViewer `2eb73ae0` and SD `07c88f7` unless marked. Where a note and the report differ, the report is the corrected reading.

## Item verdicts (delta vs 11-04 run 2)

### (a) Parked-wait marker: two sides of one text format, not one contract. NEW row `parked-wait-text-cross-repo`, LOW-MEDIUM

- **Writer (SD).** `hook.js:1520-1537` builds one status, `[working · verifying] Not done yet — ${what} still pending.`, for every outstanding wait kind. The kinds are `background task`, `monitor`, `sub-agent` and `scheduled wakeup` (`heartbeat.js:258-264`).
- **Reader (Harbour).** `PARKED_WAIT_HINT = /scheduled wakeup/i` (`lib/session-telemetry.js:325`). So 1 of the 4 park kinds reads as parked; the others read as working.
- **What the window did.**
  - Harbour LIN-4240 (`279dcb0a`): the walk skips non-state entries (`_isNonStateEntry`, `session-telemetry.js:85-91`).
  - SD LIN-4239 (`796bc9d`): status last in every posting outcome (`hook.js:460-469` rule, `STOP_OUTCOMES` `:471`). LIN-4240 and LIN-4233 (`580a5ea`, `07c88f7`) rewrote SD's pointers in the present tense (`hook.js:388-406`, `docs/module-map.md:316-321`).
  - Each side now guards against the same failure (a trailing relay hiding a park), and each documents the other's half.
- **Who owns the text.** Nobody, formally. Neither `lib/runner-kit/contract.json` (38 rows) nor SD's `test/fixtures/runner-contract.json` (34 rows) has a park row; both have a 0-line diff. The kit never parks.
- **Binding.**
  - New: SD `test/system/park-read.test.js` (LIN-4239) imports Harbour's real `parseParkedWait`, `findWakeEvent` and `deriveTerminalStatus` and feeds them the hook's real posts. This is the first system test to import a Harbour module.
  - It runs only in `npm run test:system`, which SD CI excludes on purpose (`.github/workflows/ci.yml:5-7`).
  - Harbour's tests copy the literal (`tests/unit/session-telemetry.test.js:228-245`).
  - The test's own comment pins the narrow match as intended: "that is the only defer parseParkedWait matches" (`park-read.test.js:30`).
- **Delta.** The dependency is old (LIN-2244, 2026-08) and first ruled here. In the window it improved in ordering and binding, while the 1-of-4 detector gap is unchanged.
- **Existing home:** LIN-2258 (Backlog since 2026-08-23), "widen the parked-wait detector … SD's hook emits three park phrasings". Not a Drift ticket, and not minted.
- **Severity LOW-MEDIUM:** a monitor, background-task or sub-agent park shows as working on Harbour surfaces. This is one decision ("what is a park") held by a writer and a reader that disagree, 4 vs 1.

### (b) LIN-4218 Stop-relay outcome table: SD-internal consolidation; contract rows unchanged

- `STOP_OUTCOMES` and `runStopOutcome` (`hook.js:471`, `:486`; slot legend `:441-468`) are one table and one executor, pinned by `test/fixtures/stop-relay-order.golden.json` (22,619 lines) and `test/stop-relay-table.test.js`.
- The status strings are unchanged: the hook.js diff on `[done]`/`[failed]`/`[blocked]`/`[pending]`/`[working…]` lines is comments only.
- `runner-contract-semantics-cross-repo` (MEDIUM): **unchanged.** 38 vs 34 rows, both 0-line diff, and `grep -c usage` = 0 in both. LIN-4218 makes the usage flush the U slot, first in every posting outcome (`hook.js:446-448`). So the usage call is now formally first in SD's Stop order, but it is still in neither contract table.
- `usage-relay-flag-partial` (resolved): **held.** The U slot calls `flushRequestUsageSafely` → `request-usage-flush.js:114`, which has a 0-line diff. LIN-4214 is still Backlog with 0 new comments.
- Markers (`cross-repo-sentinel-decision-marker-vocabulary`, MEDIUM): **unchanged** on the kit side (`lib/runner-kit/` 0-line diff). The new SD system test binds Harbour's terminal and wake readers one way, outside CI. Recorded under (a).
- `opencode-runner.js` +5/-5 is comment re-pointing only (line refs → slot names).

### (c) LIN-4241 `409 ruling-settled`

- **Envelope: follows the canonical writer.** Every refusal goes through `jsonError(res, ...RULING_SETTLED_REFUSAL)` or `{ fail: RULING_SETTLED_REFUSAL }`, with one frozen constant (`lib/ruling-settled.js:10-14`).
  - `res.status(` stays 275 / 250 / 12, identical per file.
  - `routes-error-envelope-fragmentation`: **unchanged** (LOW-MEDIUM).
- **NEW row `error-code-case-split`, LOW.** `ruling-settled` is the only lowercase-kebab HTTP error `code`; the routes carry 42 distinct UPPER_SNAKE codes and lib 18.
  - It replaced `ALREADY_TERMINAL` on the task-bound answer (`dashboard-rulings.js` answerSpec, d7ceb373 `:317-318`).
  - The scan retire route keeps `409 ALREADY_TERMINAL` for a neighbouring "ruling changed" case (`workspace-api-scan.js:75,508`).
  - No client keyed on the old code (0 hits in `public/` at d7ceb373), so nothing broke.
  - Cost: a client keying on `code` learns two casings. LIN-4244 (Backlog, filed 2026-11-05 00:10) will spread `ruling-settled` handling to `observation.js` and `scan.js`.
- **NEW row `ruling-settled-row-predicate-inline`, LOW. G0217 re-ruled real.**
  - The loop side has one owner: `isDecisionSettledIn` (`digest-feedback.js:116`) → `dispatch-store.js:3770` and the CAS at `:3841`.
  - The task-row side restates "settled = outcome ∈ {answered, dismissed}" inline in 3 route files and 5 sites: `dashboard-rulings.js:327`, `workspace-api-issue-write.js:162,168,646` and `workspace-api-scan.js:389`.
  - The store owns the closed set (`task-decisions-store.js:88,101,328`) and gained `readOutcome` (`:506`), but no `isSettled`.
  - Census: G0217 (`outcome == 'dismissed'`, borderline) left `mustRule` by a re-key; G0292 shrank and G0294 (the or-chain) grew to 4 files.
  - **Home:** `lib/task-decisions-store.js`, a predicate beside `readOutcome`, mirroring the loop side.
  - Search: no existing ticket names it (LIN-4244 and LIN-4245 are client handling and dedupe, not the predicate).

### (d) Home and task-page parity (LIN-4048 / 4143 / 4242 / 4243)

- **LIN-4048: consolidation.** The no-run decision is the server's `runOfferOf` (`lib/task-state.js:310`) and is read in the browser through one predicate, `takesNoRun` (`public/prompt-section.js:691`), now used at 6 call sites across Home, the task page and Swipe. No new copy. The `render-task-page.js` hunks are the run block (`:264-272`, `:811-823`).
- **`task-page-state-outside-owner` (LOW-MEDIUM): unchanged.** `READY_TASK_STATE` is still at `render-task-page.js:108`; `public/task-page.js` has a 0-line diff.
- **LIN-4143: `live-anchor-old-home-alive` (LOW-MEDIUM) improved.**
  - The `liveGuard` flag is gone, so every ruling-standing reader reads through `liveOnAnchor` unconditionally (`unanswered-decisions.js:982`, `ruling-standing.js`, `home-row-states.js`).
  - `routes/proxy-rulings.js:246-249` (0-line diff) is now the one remaining inline copy, and the owner's header names it as left alone (`lib/live-anchor.js:9`). LIN-3843 is still Backlog.
- **LIN-4143 side note, borderline (not graded):** `question-cards.js` now defaults an absent effect to `record` (fail closed), while the shared helper's contract keeps absent = `resume` (pinned by `reply-delivery-contract`). The opposite default is deliberate and documented in the commit.
- **LIN-4242: consolidation.**
  - One reduction, `createWaitingStanding` (`home-row-states.js`), for the page and the fragment, with a byte-equality conformance test.
  - One `rulingKeyOf` and one `cardHoldsInput` (`question-cards.js:465-478`), injected into `home-placement.js:49`.
  - `mergeWaitingCards` (`question-cards.js:496`) is the shared keyed merge.
- **LIN-4243:** a policy module (`public/home-placement.js`) for when the desk may swap.
  - Two live-update idioms now sit on Home: a keyed merge for Waiting, and a deferred whole-desk swap for Running and Up next. That is deliberate and documented (`home-placement.js:1-7`). Noise.
  - The outlier is Observation's own copy (`observation.js` `rulingRowHoldsInput` / `mustReuse`), already ticketed as LIN-4238 (Backlog, filed 2026-11-04 22:32). Recorded, not graded.
- **`home-next-answer-split` (MEDIUM): improved (partial).**
  - LIN-4151 (Done) puts /backlog's lead roots on Up next's ranking (`rankKeysOf` + `compareRank`) with one split for page and fold (`view.projectSplits`, `home-rows.js:156-158`).
  - Unchanged: triage (`home-view.js:36`, `task-order.js:163`) and the deck top task vs Up next (`home-pipeline.js` 0-line diff).
  - Still MEDIUM; LIN-4158 is Backlog.

### (e) Erasure, costs and vocabulary

- **`erasure-inventory-lockstep-gap` (LOW-MEDIUM): resolved by LIN-4234 (`950113b1`).**
  - `usage-snapshot-intake` is in `INVENTORY` (`lib/account-erasure.js`, +5/-1).
  - The blind spot is fixed at its cause: one collection-name source for both guards (`tests/helpers/collection-names.js`, literals plus every exported `*_COLLECTION`), and a census that every non-literal `collection(<arg>)` in `server.js` is an imported `*_COLLECTION` constant.
  - At HEAD every non-literal call in lib, routes and server.js is a constant or an INVENTORY row (grep). Residual (noise): the non-literal census covers `server.js` only.
- `usage-record-vocabulary-two-readers` (LOW-MEDIUM): **unchanged.** `request-usage-vocabulary.js` and `request-usage-intake.js` have 0-line diffs.
- `cost-fold-partition-restated` (resolved): **held.** `countedRowsOf` is read at `cost-read.js:89,252,268`.
- `lineage-identity-read-twins` (resolved): **held.** `findLineageIdentity` is at `dispatch-store.js:320`; LIN-4241's `dispatch-store` hunks are the settled check and CAS only.
- `completeness-precedence-restated` (borderline): **unchanged.** `row-usage.js:116`, `cost-read.js:199`, `request-usage-fold.js:103`.

### (f) Unlisted, in-remit

- **LIN-4226 `requestSource`: consolidation, in the costs owner's scope.**
  - The hand-threaded `requestRows` (deferred by 11-04b) is gone. Callers pass the loader (`request-usage-loader.js`), with the named `NO_REQUEST_RECORDS` for "none", and the old key throws at three entrances (`cost-read.js:143,540`, `run-view.js:384`). The tripwire is written three times: noise, as a migration guard.
  - No new reader of `request-usage`.
- **`usage-snapshot-prose-residue` (LOW): improved (1 of 9 files), and sharper.**
  - Fixed: `docs/architecture/source-map.md:192` (run-view signature and cost, LIN-4226).
  - LIN-4226 edited `effort-readout.js` (+9/-6) and `model-routing-spend.js` (+8/-12) and left their stale lines: `effort-readout.js:599` (user-visible) and `model-routing-spend.js:6,58`.
  - Unchanged: `proxy-instructions.js:385-386`, `docs/proxy-integration.md:1239`, `request-usage-vocabulary.js:4`, SD `request-usage-flush.js:3-8`, SD `request-usage.js:163-164`.
- **`vendor-script-list-restated` (LOW): unchanged in count** (27 `scripts: [` arrays, 7 purify render files at both SHAs). Home's list gained `/home-placement.js` (`render.js:383`). Census G0214 → G0211 is the set label's size changing (+8 → +9), not a new copy.
- **The `[usage]` text-contract group G0231 grew to 3 files.** LIN-4240 added a real legacy reader, not only comments: `_isNonStateEntry` tests `/^\s*\[usage\]/` (`session-telemetry.js:89`).
  - The legacy deletion now has a ticket: **LIN-4235** (Backlog, filed 2026-11-04 19:46). This answers 11-04b's observation "no filed ticket".
  - LIN-4235 names `session-telemetry.js` (`withUsage`) but not the new skip, so the deletion has one more site to clear. Recorded as an observation, not graded.
- **`decision-stamp-classifier-copies` (LOW-MEDIUM): unchanged, touched without consolidation.** LIN-4240's `_isNonStateEntry` calls the inline copy's `_isStampEntry` (`session-telemetry.js:60-63`), not the authority (`digest-feedback.js:78`). The drift test now follows it one level down.
- **`coherence-loop-stalled` (MEDIUM, process): improved (first movement).** LIN-4234 closed about 3h after minting (under LIN-3449), and LIN-4151 (unparented) is Done. Open Drift-family tickets: 16, down from 18. The other 14 from 10-23, 11-03 and 11-04 are unmoved with 0 new comments, so it stays MEDIUM.

## Confidence in the "unchanged" verdicts

The window is 9 production commits (44 files) in Harbour and 3 non-test files in SD.

- 84 of the 124 ledger rows name a file the window touched, mostly hubs (`server.js`, `render.js`, `routes/dispatch.js`). See `ledger-touch-map.txt`.
- Each row above was checked at the cited lines, and every other row's cited lines sit outside the window's hunks, or in hubs whose hunks belong to the clusters read above.
- For the code itself, confidence is high: the cited bytes are unchanged.
- It carries no information about whether anyone will act on a row.

## Census rulings (105 `mustRule` groups, one guide)

`rulings-11-05.tsv`, made with `rulings-carry.py` (joined on detector, decision and file set; a site inside a `git diff -U0` hunk is flagged).

- **34 real / 29 borderline / 42 noise** (11-04b: 34 / 30 / 42; the borderline G0217 left `mustRule`).
- 55 have identical sites, and 50 only shifted lines.
- 3 were flagged and re-read (G0137, G0166, G0168, all at `render-task-page.js:268-272`, LIN-4048); every ruling holds. G0137 (running/queued inline, real, home `lib/task-state.js`) is touched without consolidation.
- The departed G0217 is re-ruled **real** under `ruling-settled-row-predicate-inline` (appended row in the TSV).
