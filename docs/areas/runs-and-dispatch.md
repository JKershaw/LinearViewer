# Runs & dispatch

Area notes for `runs-and-dispatch` in the registry. Format and rules: README.md.

## Lessons

- A run-row field that is always present with a default is one entry in `RUN_FIELDS`
  (`lib/dispatch-fields.js`). A sparse field stays a conditional spread in `addItem` and
  `_archiveItem`, so other rows keep their key sets byte-identical. Six fields were once
  dropped on one hop of four.
- Every way a row leaves the queue, other than a take, archives through `_archiveItem` in
  `lib/dispatch-store.js`. Something that must happen when a row is cancelled or expires
  belongs there; a new exit must archive through it too.
- `addFeedback`'s wake block holds guards from LIN-1059, 1165, 1357, 2297, 4080 and 4166,
  in an order that matters. Move it only as a whole and keep the existing wake suites
  passing unchanged.
- Row-only kinds such as `wake` stay out of `DISPATCH_KINDS` (`lib/prompt-templates.js`),
  so no `/dispatch` caller can create one.
- Price a pulled extra like any other piece. Making the cost read load its own inputs
  rode along with LIN-4201 and did not land there; it landed as its own piece, LIN-4226.

## Waiting

- `lib/dispatch-factory.js`: tests `provider.name === 'linear'` beside
  `isHermeticTestToken`, because of a test-only transport. (John, 7 Nov, on LIN-4347.)
- `lib/effort-readout.js`: still outputs the deleted name `GATE_DUE_MARKER` (replaced by
  `planReviewDueOf`, LIN-4360), pinned by the goldens in `tests/fixtures/cost-replay/`.
  (John, 7 Nov.)
- `lib/cost-read.js`: retire the snapshot fold (`foldLineageUsage`'s snapshot branch,
  `isRunningTotal`, `usageStateOf`, `missingCanChangeFigure`, also in `lib/row-usage.js`).
  Due about 30 days after LIN-4203, once no snapshot-only lineage is left. (Survey tally:
  LIN-4195, LIN-4201, LIN-4203.)
- `lib/cost-read.js`: split `readCalls` and `callsSurfaceOf` out of the cost read.
  (Survey tally: LIN-4201.)
- `lib/cost-read.js`: instance-wide reads beside stores keyed by workspace is unsettled;
  settle it once, before it comes up again. (Survey tally: LIN-4201.)
- `lib/session-summary.js`: check whether stored run paragraphs keep figures from before
  the records-first cutover. (Survey tally: LIN-4201.)
- `lib/dispatch-feedback-validation.js`: feedback kinds are not declared once with their
  role. `PARKED_WAIT_SKIPPED_KINDS` in `lib/session-telemetry.js` is kept apart from
  `FEEDBACK_ENTRY_KINDS`, nothing ties them, and `findWakeEvent` has its own skip rule.
  (Survey tally: LIN-4240, LIN-4239, LIN-4233.)
- `lib/wake-shadow.js`: one wake policy, by promoting the LIN-3257 classifier this
  shadow records. (Survey tally: LIN-4166.)
- `lib/follow-up-dispatch.js`: name the "aside" follow-up (work against aside) for every
  lineage reader, if a second aside case appears. (Survey tally: LIN-4166.)
- `lib/unanswered-decisions.js`: how long a finished session stays resumable is a
  cross-repo contract. Harbour's copy is one exported constant, `REAP_INACTIVITY_MS`
  (LIN-4173); nothing checks it against simple-dispatcher's. (Survey tally: LIN-4164.)
- `lib/runner-kit/runner.mjs`: the per-message transcript fold exists once here and once
  in simple-dispatcher; one shared fold would be the one place a transcript becomes
  requests. (Survey tally: LIN-4203, LIN-4195.)
