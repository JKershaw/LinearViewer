# Runs & dispatch

Area notes for `runs-and-dispatch` in the registry. Format and rules: README.md.

## Lessons

- A run-row field that is always present with a default is one entry in `RUN_FIELDS`
  (`lib/dispatch-fields.js`). A sparse field stays a conditional spread in `addItem` and
  `_archiveItem`, so other rows keep their key sets byte-identical. Six fields were once
  dropped on one hop of four.
- Every way a row leaves the queue except a take archives through `_archiveItem`
  (`lib/dispatch-store.js`): what must happen on cancel or expiry goes there, and a new
  exit must archive through it too.
- The wake path is `_planWake` (decide) then `_deliverWake` (deliver) in
  `lib/dispatch-store.js`, shared by `addFeedback` and the held-wake release (LIN-4373). They
  hold guards from LIN-1059, 1165, 1357, 2297, 4080 and 4166, in an order that matters.
  Change them only as a whole and keep the existing wake suites passing unchanged. Two
  censuses pin the function that writes a wake (`lin-3134-declared-mint-census`,
  `lin-4080-addItem-census`); moving the write means updating their pins.
- "This run's PR" is what the session reported: `prUrlOfFeedback` (`lib/dispatch-wake.js`)
  reads a PR on a report line (`reportLinesOf`, `lib/dispatch-terminal.js`) before the
  `[done]` entry's `url`, which older runners filled by mention count (LIN-4375). The
  runner's `sessionPrs` uses the same order: newest line, then first PR on it.
- Two `[done]` posts can reach a decide-then-enqueue at once, so a "no row yet" read is
  not a guard: claim first with a compare-and-set on the row (`claimHeldWake` in
  `lib/dispatch-store.js`, the `_mintWake` idiom). LIN-4373 relied on the read and could
  queue two leftover rows (LIN-4375).
- A claim whose holder skips is given back on every path out (`releaseHeldWakeClaim`).
  The skip's own wake can be withdrawn on a transient fault for the re-report to retry,
  and a stamp left in place made that re-report hold forever (LIN-4375 review).
- Any session can park `[pending]` on CI and finish on a ci-wake `custom` row
  (`lib/ci-wake-sweep.js`). A rule keyed on the producing row's kind misses that ending:
  read the lineage instead (`heldWakeHolderOf`, `resolveFollowUpRoot`). LIN-4373 handled it
  for eligibility but not for the held wake's terminals, and review caught it.
- Row-only kinds stay out of `DISPATCH_KINDS` (`lib/prompt-templates.js`) and are listed in
  `ROW_ONLY_KINDS` (`lib/dispatch-fields.js`); kind-keyed maps are tested against both, as
  `leftover` once had no bucket. A new bucket can pull a kind into the round-trip walk;
  `OFF_SPINE_KINDS` keeps it out (LIN-4376).
- The store knows no leftovers (LIN-4383). It holds a parent wake by `heldWakeFor`, the
  whole hold record (LIN-4373), released by the holder's terminal or by `_archiveItem` under
  the build's guard key, so it wakes once. What a leftover is and what its wake says live
  in the hook, `lib/dispatch-leftover-hook.js`; a new held-wake feature brings a hook, not
  store branches (`lin-4377-store-knows-no-leftover` counts the word).
- Price a pulled extra like any other piece: the cost read loading its own inputs rode
  along with LIN-4201, did not land, and landed alone as LIN-4226.

## Waiting

- `lib/pipeline-churn.js`: its own `ORCHESTRATION_KINDS` omits `periodical`, unlike
  `lib/run-view.js`'s; one set would move churn figures. (LIN-4376 leftovers.)
- `lib/dispatch-leftover-hook.js`: a claim with no row. If the server dies between
  `claimHeldWake` and the enqueue, or a release write fails, the build's wake stays held
  and nothing releases it. It stays here: a lease never sees a re-report (the runner
  stops retrying within 60 s); a sweep needs a history scan or a new index over stamps
  never cleared; clearing stamps on success reopens the LIN-4375 double queue. (LIN-4375,
  LIN-4377.)
- `lib/dispatch-factory.js`: tests `provider.name === 'linear'` beside
  `isHermeticTestToken`, for a test-only transport. (John, 7 Nov, on LIN-4347.)
- `lib/effort-readout.js`: still outputs the deleted name `GATE_DUE_MARKER` (now
  `planReviewDueOf`, LIN-4360), pinned by `tests/fixtures/cost-replay/` goldens.
  (John, 7 Nov.)
- `lib/cost-read.js`: split `readCalls` and `callsSurfaceOf` out of the cost read, and
  settle once whether instance-wide reads sit beside stores keyed by workspace. (Survey
  tally: LIN-4201.)
- `lib/session-summary.js`: do stored run paragraphs keep pre-cutover (records-first)
  figures? (Survey tally: LIN-4201.)
- `lib/dispatch-feedback-validation.js`: feedback kinds are not declared once with their
  role: `PARKED_WAIT_SKIPPED_KINDS` (`lib/session-telemetry.js`), `FEEDBACK_ENTRY_KINDS`
  and `findWakeEvent`'s skip rule are untied. (Survey tally: LIN-4240, 4239, 4233.)
- `lib/wake-shadow.js`: one wake policy, by promoting the LIN-3257 classifier this
  shadow records. (Survey tally: LIN-4166.)
- `lib/follow-up-dispatch.js`: if a second "aside" case appears, name the aside follow-up
  for every lineage reader. (Survey tally: LIN-4166.)
- `lib/runner-kit/runner.mjs`: the per-message transcript fold is here and in
  simple-dispatcher; one shared fold would be where a transcript becomes requests.
  (Survey tally: LIN-4203, LIN-4195.)
