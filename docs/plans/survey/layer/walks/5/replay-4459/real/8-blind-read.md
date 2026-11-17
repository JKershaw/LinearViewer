# What this stage really wrote

## Comment on LIN-4459 at 2026-11-13T17:04:26.892Z (16376a3c)

## Blind read
Verdict: better. It gives two things one home: `FEEDBACK_ENTRY_KINDS` now comes only from `lib/dispatch-feedback-kinds.js`, because the `lib/dispatch-store.js` re-export is gone and every importer moved. The live-wait predicate moved into `lib/run-live-wait.js`, with no import cycle and a census test to guard it. A parked stage whose lineage has ended no longer holds its ticket, and real-store tests in `tests/unit/lin-4392-live-stage-wait.test.js` prove it. On the worse side, the run-outcome words are now split between `lib/run-live-wait.js` (QUEUED/RUNNING) and `lib/recent-runs.js` (waiting on a person, closed, aborted).

Read: https://github.com/JKershaw/LinearViewer/pull/2432 at `7424cfb8f` against `0092d8d9e`.

### Inside the area, fix-sized
- `tests/unit/session-run-transcript-entries.test.js` (runs-and-dispatch, concerns `lib/dispatch-feedback-kinds.js`): the edited header comment now reads "(lib/dispatch-feedback-kinds.js; then —", which is garbled. The same sentence still points to "lib/dispatch-store.js:95" for why `decision-answer` is excluded, but that explanation now lives in `lib/dispatch-feedback-kinds.js`. Fix: reword the parenthesis and point the citation at `lib/dispatch-feedback-kinds.js`, with no line number.
- `lib/recent-runs.js` (runs-and-dispatch): `runFact` now translates the wire word `blocked` into `WAITING_ON_A_PERSON` in two places: the own-row branch and the new parked-lineage branch (`r.outcome === 'blocked' ? WAITING_ON_A_PERSON : r.outcome`). Fix: one small local mapping that both branches use.

### Inside the area, larger
- `lib/run-live-wait.js` / `lib/recent-runs.js` (runs-and-dispatch): the outcomes come from `recent-runs.js` (`runFact`), but to avoid a cycle it now imports `QUEUED`/`RUNNING` from the module that reads them. Meanwhile `WAITING_ON_A_PERSON`, `'closed'` and `'aborted'` stay in `recent-runs.js`, and `lib/recommendation-look-first.js` still imports from there. So the outcome words have two homes. Giving them one home (for example a leaf module of outcome words) means deciding where that home is, and it touches importers in llm-and-prompts, so it is larger than a fix.
- `lib/recent-runs.js` (runs-and-dispatch): a parked stage whose lineage ended is dated by the park's timestamp, not the lineage's end, because the `withLineage` wire row carries no end time (the comment admits this). It therefore sorts too early in the selector's five. It can also land on the wrong side of a "since the latest review" cut, such as `lib/recommendation-blind-read.js`'s count of ended reads. The fix is for `listHistory` in `lib/dispatch-store.js` to report the lineage's end time. That is a store change, so it is larger.

### Outside the area
None.

Nothing on LIN-4447 or LIN-4448.

No change to the LIN-4459 description (snapshots unchanged across this step).
