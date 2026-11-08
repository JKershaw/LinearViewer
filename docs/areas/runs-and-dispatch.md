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
- The wake path is `_planWake` (decide) then `_deliverWake` (deliver) in
  `lib/dispatch-store.js`, shared by `addFeedback` and the held-wake release (LIN-4373). They
  hold guards from LIN-1059, 1165, 1357, 2297, 4080 and 4166, in an order that matters.
  Change them only as a whole and keep the existing wake suites passing unchanged. Two
  censuses pin the function that writes a wake (`lin-3134-declared-mint-census`,
  `lin-4080-addItem-census`); moving the write means updating their pins.
- A parent wake can be held (LIN-4373): a `leftover` row's `heldWakeFor` is the whole hold
  record, released by its own terminal or by `_archiveItem` on cancel or expiry. A new way
  for a held wake to end must release it under the build's guard key, so it stays once.
- "This run's PR" is what the session reported: `prUrlOfFeedback` (`lib/dispatch-wake.js`)
  reads a PR on a report line (`reportLinesOf`, `lib/dispatch-terminal.js`) before the
  `[done]` entry's `url`, which older runners filled by mention count (LIN-4375). The
  runner's `sessionPrs` uses the same order: newest line, then first PR on it.
- Two `[done]` posts can reach a decide-then-enqueue at once, so a "no row yet" read is
  not a guard: claim first with a compare-and-set on the row (`claimLeftoverFor` in
  `lib/dispatch-store.js`, the `_mintWake` idiom). LIN-4373 relied on the read and could
  queue two leftover rows (LIN-4375).
- A claim whose holder skips is given back on every path out (`releaseLeftoverClaim`).
  The skip's own wake can be withdrawn on a transient fault for the re-report to retry,
  and a stamp left in place made that re-report hold forever (LIN-4375 review).
- Any session can park `[pending]` on CI and finish on a ci-wake `custom` row
  (`lib/ci-wake-sweep.js`). A rule keyed on the producing row's kind misses that ending:
  read the lineage instead (`_heldLeftoverOf`, `resolveFollowUpRoot`). LIN-4373 handled it
  for eligibility but not for the held wake's terminals, and review caught it.
- Row-only kinds stay out of `DISPATCH_KINDS` (`lib/prompt-templates.js`) and are listed in
  `ROW_ONLY_KINDS` (`lib/dispatch-fields.js`); kind-keyed maps are tested against both, as
  `leftover` once had no bucket. A new bucket can pull a kind into the round-trip walk;
  `OFF_SPINE_KINDS` keeps it out (LIN-4376).
- The leftover methods stay in `lib/dispatch-store.js`: no move takes `release` out of
  `_deliverWake` (three of its guards read it), and a module handed the store only exposes
  its privates (LIN-4376).
- Price a pulled extra like any other piece. Making the cost read load its own inputs
  rode along with LIN-4201 and did not land there; it landed as its own piece, LIN-4226.

## Waiting

- `lib/pipeline-churn.js`: its own `ORCHESTRATION_KINDS` omits `periodical`, unlike
  `lib/run-view.js`'s; one set would move churn figures. (LIN-4376 leftovers.)
- `lib/dispatch-leftover-hook.js`: a claim with no row. If the server dies between
  `claimLeftoverFor` and the enqueue, or a release write fails, the build's wake stays
  held and nothing releases it: no `leftover` row exists to cancel or expire. A sweep
  that releases a claim older than the queue TTL with no `leftover` row would close it.
  (LIN-4375, from LIN-4347's review.)
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
