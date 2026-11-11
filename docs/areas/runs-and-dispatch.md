# Runs & dispatch

Area notes for `runs-and-dispatch` in the registry. Format and rules: README.md.

## Lessons

- A run-row field that is always present with a default is one entry in `RUN_FIELDS`
  (`lib/dispatch-fields.js`). A sparse field stays a conditional spread in `addItem` and
  `_archiveItem`, so other rows keep their key sets byte-identical. Six fields were once
  dropped on one hop of four.
- Every exit from the queue except a take archives through `_archiveItem` (`lib/dispatch-store.js`);
  a new exit must archive through it too.
- The wake path is `_planWake` (decide) then `_deliverWake` (deliver) in `lib/dispatch-store.js`,
  shared by `addFeedback` and the held-wake release (LIN-4373). Its guards (LIN-1059, 1165, 1357,
  2297, 4080, 4166) run in an order that matters: change the pair whole, keep the wake suites
  passing, and update the two census pins (`lin-3134-declared-mint-census`,
  `lin-4080-addItem-census`) if the write moves.
- "This run's PR" is the session's own report: `prUrlOfFeedback` (`lib/dispatch-wake.js`) takes a
  PR on a report line before the `[done]` `url`, which older runners filled by mention count
  (LIN-4375).
- Two `[done]` posts can reach a decide-then-enqueue at once, so "no row yet" is no guard: claim
  first, compare-and-set on the row (`claimHeldWake`). LIN-4373 relied on the read and queued two
  leftover rows (LIN-4375).
- A claim whose holder skips is released on every path out (`releaseHeldWakeClaim`). A stamp left
  by a skip held the re-report forever (LIN-4375 review).
- Any session can park `[pending]` on CI and finish on a ci-wake `custom` row (`lib/ci-wake-sweep.js`).
  A rule keyed on the producing kind misses that ending: read the lineage (`heldWakeHolderOf`,
  `resolveFollowUpRoot`). LIN-4373 covered eligibility, not the held wake's terminals.
- Row-only kinds stay out of `DISPATCH_KINDS` (`lib/prompt-templates.js`) and sit in `ROW_ONLY_KINDS`
  (`lib/dispatch-fields.js`); kind-keyed maps are tested against both. A new bucket can pull a kind
  into the round-trip walk, which `OFF_SPINE_KINDS` stops (LIN-4376).
- The store knows no leftovers (LIN-4383). It holds a parent wake by `heldWakeFor` (LIN-4373),
  released by the holder's terminal or `_archiveItem` under the build's guard key, so it wakes once.
  Leftover wording lives in `lib/dispatch-leftover-hook.js`; a new held-wake feature brings a hook
  (`lin-4377-store-knows-no-leftover` counts the word).
- Price a pulled extra like any piece: a cost read that rode along with LIN-4201 landed alone as
  LIN-4226.
- A task timeline lane is running from the page's open session ids (`isOpenState`), never the
  cost row; a lineage's own `incomplete`, not the shared `lineagesTruncated`, decides "not
  complete" (LIN-4405, `lib/task-timeline.js`).

## Waiting

- `lib/dispatch-wake.js`: `reportedPrUrlOf` and SD's `sessionPrs` pick a PR by one order, linked
  only by a comment; changing one moves a PR link. (Drift & Coherence Review, 10 Nov;
  `docs/reviews/drift-coherence-review-2026-11-10.md`.)
- `lib/dispatch-leftover.js`: restates the follow-up target, halt modes and `NEVER_RAN` (also in
  `_releaseIfHeld`) beside their homes (`lib/workspace-halt.js`, `HALT_MODES`); a new halt mode
  would not stop a leftover. (Drift & Coherence Review, 10 Nov; `docs/reviews/drift-coherence-review-2026-11-10.md`.)
- `lib/dispatch-leftover-hook.js`: a death between `claimHeldWake` and the enqueue, or a failed
  release write, leaves the wake held. No sweep: a lease sees no re-report, a sweep scans
  history, and clearing stamps reopens LIN-4375's double queue. (LIN-4377.)
- `lib/dispatch-store.js`: `releaseHeldWake` prepends `formatHeldWakeNote({status})`, so release
  picks leftover wording; `lin-4377` counts the spelling, not the dependency. (Operator, LIN-4377.)
- `lib/dispatch-store.js`: `addFeedback` takes one `wakeHook`; a second held-wake feature
  first needs composable hooks. (Operator, LIN-4377.)
- `lib/runner-kit/contract.json`: the row-shape rule is written twice (`checkRowShape`;
  SD's `columnProblems`); `CONTRACT_SHA256` pins the bytes, not the rule. (Operator, LIN-4377.)
- `lib/runner-kit/contract.json`: no row pins a follow-up to a finished, unhalted session
  (rows cover pause and stop), though the leftover step resumes its build that way
  (`lib/dispatch-leftover.js`). (Seams & Tangles, 10 Nov.;
  `docs/reviews/seams-tangles-review-2026-11-10-run11.md`.)
- `lib/dispatch-factory.js`: tests `provider.name === 'linear'` beside
  `isHermeticTestToken` for a test-only transport. (LIN-4347.)
- `lib/effort-readout.js`: outputs the deleted name `GATE_DUE_MARKER` (now
  `planReviewDueOf`), pinned by cost-replay goldens. (John, 7 Nov.)
- `lib/cost-read.js`: split out `readCalls` and `callsSurfaceOf`; settle whether
  instance-wide reads sit beside workspace-keyed stores. (Survey tally: LIN-4201.)
- `lib/session-summary.js`: do stored run paragraphs keep pre-cutover figures? (Survey
  tally: LIN-4201.)
- `lib/dispatch-feedback-validation.js`: feedback kinds lack one declaration with their
  role: `PARKED_WAIT_SKIPPED_KINDS` (`lib/session-telemetry.js`), `FEEDBACK_ENTRY_KINDS`,
  `findWakeEvent`'s skip rule. (Survey tally: LIN-4240, 4239, 4233.)
- `lib/wake-shadow.js`: one wake policy, from the LIN-3257 classifier this shadow records.
  (Survey tally: LIN-3257.)
- `lib/runner-kit/runner.mjs`: the per-message transcript fold is here and in SD; one shared
  fold would turn a transcript into requests. (Survey tally: LIN-4203, LIN-4195.)
- `lib/recent-runs.js`: `runFact` reads only the row's feedback: a stage parked `[pending]` whose
  lineage ends `[blocked]` or `[skipped]` reads `running` and holds the live-stage wait until
  aborted. (LIN-4392.)
