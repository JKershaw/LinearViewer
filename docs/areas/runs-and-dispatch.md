# Runs & dispatch

Area notes for `runs-and-dispatch` in the registry. Format and rules: README.md.

## Lessons

- A run-row field that is always present with a default is one entry in `RUN_FIELDS`
  (`lib/dispatch-fields.js`). A sparse field stays a conditional spread in `addItem` and
  `_archiveItem`, so other rows keep their key sets byte-identical. Six fields were once
  dropped on one hop of four.
- Every way a row leaves the queue except a take archives through `_archiveItem`
  (`lib/dispatch-store.js`): cancel and expiry work goes there, and a new exit archives
  through it too.
- The wake path is `_planWake` (decide) then `_deliverWake` (deliver) in
  `lib/dispatch-store.js`, shared by `addFeedback` and the held-wake release (LIN-4373). They
  hold guards from LIN-1059, 1165, 1357, 2297, 4080 and 4166, in an order that matters.
  Change them only as a whole and keep the existing wake suites passing unchanged. Two
  censuses pin the wake writer (`lin-3134-declared-mint-census`, `lin-4080-addItem-census`):
  moving the write means updating their pins.
- "This run's PR" is the session's own report: `prUrlOfFeedback` (`lib/dispatch-wake.js`)
  reads a PR on a report line (`reportLinesOf`, `lib/dispatch-terminal.js`) before the
  `[done]` `url`, which older runners filled by mention count (LIN-4375). `sessionPrs` in the
  runner uses the same order.
- Two `[done]` posts can reach a decide-then-enqueue at once, so a "no row yet" read is no
  guard: claim first, compare-and-set on the row (`claimHeldWake`, the `_mintWake` idiom).
  LIN-4373 relied on the read and could queue two leftover rows (LIN-4375).
- A claim whose holder skips is given back on every path out (`releaseHeldWakeClaim`).
  A skip's own wake may be withdrawn on a transient fault so the re-report retries; a stamp
  left in place once held that re-report forever (LIN-4375 review).
- Any session can park `[pending]` on CI and finish on a ci-wake `custom` row
  (`lib/ci-wake-sweep.js`). A rule keyed on the producing row's kind misses that ending:
  read the lineage (`heldWakeHolderOf`, `resolveFollowUpRoot`). LIN-4373 handled eligibility,
  not the held wake's terminals; review caught it.
- Row-only kinds stay out of `DISPATCH_KINDS` (`lib/prompt-templates.js`) and sit in
  `ROW_ONLY_KINDS` (`lib/dispatch-fields.js`); kind-keyed maps are tested against both
  (`leftover` once had no bucket). A new bucket can pull a kind into the round-trip walk;
  `OFF_SPINE_KINDS` keeps it out (LIN-4376).
- The store knows no leftovers (LIN-4383). It holds a parent wake by `heldWakeFor` (LIN-4373),
  released by the holder's terminal or by `_archiveItem` under the build's guard key, so it
  wakes once. A leftover's meaning and wording live in `lib/dispatch-leftover-hook.js`; a new
  held-wake feature brings a hook, not store branches (`lin-4377-store-knows-no-leftover`
  counts the word).
- Price a pulled extra like any piece: the cost read's own loader rode along with LIN-4201
  unpriced and landed alone as LIN-4226.

## Waiting

- `lib/pipeline-churn.js`: its own `ORCHESTRATION_KINDS` omits `periodical`, unlike
  `lib/run-view.js`'s; one set would move churn figures. (LIN-4376 leftovers.)
- `lib/dispatch-leftover-hook.js`: a claim with no row. If the server dies between
  `claimHeldWake` and the enqueue, or a release write fails, the build's wake stays held
  and nothing releases it. A lease never sees a re-report (the runner stops within 60 s);
  a sweep needs a history scan or an index over stamps never cleared; clearing stamps on
  success reopens the LIN-4375 double queue. (LIN-4375, LIN-4377.)
- `lib/dispatch-store.js`: `releaseHeldWake` still prepends `formatHeldWakeNote({status})`,
  so the store still picks leftover wording; the `lin-4377` test counts the spelling, not the dependency.
  (Operator, LIN-4377, 8 Nov.)
- `lib/dispatch-store.js`: `addFeedback` takes one `wakeHook`; a second held-wake feature
  first needs composable hooks. (Operator, LIN-4377, 8 Nov.)
- `lib/runner-kit/contract.json`: the row-shape rule is written twice, `checkRowShape`
  in its unit test and simple-dispatcher's `columnProblems`. `CONTRACT_SHA256` pins the
  bytes, not the rule, so they can drift unseen. (Operator, LIN-4377, 8 Nov.)
- `lib/runner-kit/contract.json`: no row pins a follow-up to a finished session with no halt
  (rows cover pause and stop only), though the leftover step resumes its build that way
  (`lib/dispatch-leftover.js`). Add the row or name the gap. (Seams & Tangles, 10 Nov.)
  `docs/reviews/seams-tangles-review-2026-11-10-run11.md`
- `lib/dispatch-factory.js`: tests `provider.name === 'linear'` beside
  `isHermeticTestToken` for a test-only transport. (John, 7 Nov, on LIN-4347.)
- `lib/effort-readout.js`: still outputs the deleted name `GATE_DUE_MARKER` (now
  `planReviewDueOf`, LIN-4360), pinned by cost-replay goldens. (John, 7 Nov.)
- `lib/cost-read.js`: split `readCalls` and `callsSurfaceOf` out, and settle once whether
  instance-wide reads sit beside workspace-keyed stores. (Survey tally: LIN-4201.)
- `lib/session-summary.js`: do stored run paragraphs keep pre-cutover (records-first)
  figures? (Survey tally: LIN-4201.)
- `lib/dispatch-feedback-validation.js`: feedback kinds lack one declaration with their
  role: `PARKED_WAIT_SKIPPED_KINDS` (`lib/session-telemetry.js`), `FEEDBACK_ENTRY_KINDS`,
  `findWakeEvent`'s skip rule. (Survey tally: LIN-4240, 4239, 4233.)
- `lib/wake-shadow.js`: one wake policy, by promoting the LIN-3257 classifier this
  shadow records. (Survey tally: LIN-4166.)
- `lib/follow-up-dispatch.js`: on a second "aside" case, name the aside follow-up for
  every lineage reader. (Survey tally: LIN-4166.)
- `lib/runner-kit/runner.mjs`: the per-message transcript fold is here and in
  simple-dispatcher; one shared fold would turn a transcript into requests.
  (Survey tally: LIN-4203, LIN-4195.)
- `routes/dispatch.js`: feedback and heartbeat limiters stay 100/min per IP. (LIN-4378.)
- `lib/dispatch-entrance.js`: only `POST /autopilot/kickoff` passes `periodicalReview` (no
  tail on a Periodical's review); the rest rely on the marker rule. (LIN-4382.)
