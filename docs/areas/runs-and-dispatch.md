# Runs & dispatch

Area notes for `runs-and-dispatch` in the registry. Format and rules: README.md.

## Lessons

- A run-row field that is always present with a default is one entry in `RUN_FIELDS`
  (`lib/dispatch-fields.js`). A sparse field stays a conditional spread in `addItem`, `_archiveItem` and both
  projections (`_formatItem`, `_formatHistoryItem`, as `runRecordId` is, LIN-4492), so other rows keep their key sets byte-identical. Six fields were once
  dropped on one hop of four.
- Every exit from the queue except a take archives through `_archiveItem` (`lib/dispatch-store.js`);
  a new exit must archive through it too.
- The wake path is `_planWake` (decide) then `_deliverWake` (deliver) in `lib/dispatch-store.js`,
  shared by `addFeedback` and the held-wake release (LIN-4373). Its guards (LIN-1059, 1165, 1357,
  2297, 4080, 4166) run in an order that matters: change the pair whole, keep the wake suites
  passing, and update the two census pins (`lin-3134-declared-mint-census`,
  `lin-4080-addItem-census`) if the write moves.
- "This run's PR": `prUrlOfFeedback` takes a report line's PR before the `[done]` `url` (LIN-4375). Only a done
  implementation row owns it, via `terminalPrUrlOfFeedback` (LIN-4497): other rows name siblings; detail reads merge follow-ups.
- Two `[done]` posts can reach a decide-then-enqueue at once, so "no row yet" is no guard: claim
  first, compare-and-set on the row (`claimHeldWake`). LIN-4373 relied on the read and queued two
  leftover rows (LIN-4375).
- A claim whose holder skips is released on every path out (`releaseHeldWakeClaim`). A stamp left
  by a skip held the re-report forever (LIN-4375 review).
- Any session can park `[pending]` on CI and finish on a ci-wake `custom` row (`lib/ci-wake-sweep.js`).
  A rule keyed on the producing kind misses that ending: read the lineage (`heldWakeHolderOf`,
  `resolveFollowUpRoot`). LIN-4373 covered eligibility, not the held wake's terminals. Over a
  ticket's runs, read it batched: `listHistory`'s `withLineage`, never a walk per row (`runFact`,
  `lib/recent-runs.js`, LIN-4459: the walks go up, a parked stage's ending is below it).
- Row-only kinds stay out of `DISPATCH_KINDS` (`lib/prompt-templates.js`) and sit in `ROW_ONLY_KINDS`
  (`lib/dispatch-fields.js`); kind-keyed maps are tested against both. A new bucket can pull a kind
  into the round-trip walk, which `OFF_SPINE_KINDS` stops (LIN-4376).
- The store knows no leftovers (LIN-4383). It holds a parent wake by `heldWakeFor` (LIN-4373),
  released by the holder's terminal or `_archiveItem` under the build's guard key, so it wakes once.
  Leftover wording lives in `lib/dispatch-leftover-hook.js`, bound into the store late
  (`setHeldWakeReleaseNote`) because most releases have no request; a new held-wake feature brings a
  hook (`lin-4377-store-knows-no-leftover` counts the word and forbids the `formatHeldWakeNote` import).
- A feedback-entry kind is one row in `FEEDBACK_KINDS` (`lib/dispatch-feedback-kinds.js`) that declares
  every role; readers filter the table, and its row order is the runner prompt's bytes. A shared
  constant is imported from its owner (`HALT_MODES`, `followUpTarget`, `NEVER_RAN` in
  `lib/dispatch-terminal.js`). The decision-stamp set had four copies in `lib/`; the LIN-4455
  censuses (`lin-4455-feedback-kinds-table`, `lin-4455-constants-owners`) fail on a new one.
- Price a pulled extra like any piece: a cost read that rode along with LIN-4201 landed alone as
  LIN-4226.
- A task timeline lane is running from the page's open session ids (`isOpenState`), never the
  cost row; a lineage's own `incomplete`, not the shared `lineagesTruncated`, decides "not
  complete" (LIN-4405, `lib/task-timeline.js`).
- A test that dispatches a close-out passes a `closeOut` seam (`resolveProvider`): the readiness
  guard reads comments for every close-out since LIN-4438, and without the seam it reaches the real
  provider and fails open, a pass the hermetic watcher catches only in CI.
- Close-out readiness is one decision, `closeOutDecision` (`lib/run-closeout-state.js`, LIN-4460): every surface
  renders or enforces its answer. A new reason is a row of `CLOSE_OUT_REASONS` plus a row in
  `lin-4438-blind-read-gate` and `lin-4460-close-out-decision`, whose census reads code, not comments.
- When a person acts, Harbour follows (LIN-4447, John): a landing whose every PR reads merged stands the gate aside;
  a Done ticket with no close-out on its landing stands only the recommendation's read aside. Harbour never sets Done.
- What a comment is, and which PRs are the task's, are read once in `lib/run-trail.js`: a comment kind
  is a row of `COMMENT_KINDS` (`lin-4458-comment-kind-census` fails on a kind test elsewhere), and the
  box, the guard, the owner's check and the merge take their PRs from `readTrail().landing`, statuses
  keyed by PR URL: the cited list (newest first) and the landing (oldest first) order PRs differently,
  so a shared index points at the wrong PR (LIN-4458).
- A reader that classifies by kind routes `custom` before `bucketOf`: `BUCKET_OF_KIND` maps
  `custom` to orchestration, and `bucketOf` falls back to orchestration silently, so check membership
  (`lib/wall-clock-summary.js`). `dispatchesOf` turns a missing kind into `custom` (`lib/cost-read.js`):
  confirm a custom kind from its own row before trusting it (LIN-4426).
- A full PR URL's repository and number come from `prOf` beside `prUrlsIn` (`lib/run-ledger.js`),
  for the task page and measure 1 alike; compare repositories case-blind, as GitHub does (LIN-4439).
- A per-dispatch figure (its model, cost or completeness) is the fold's answer, carried through
  `lib/cost-read.js`; a reader never re-ranks `byModel` itself. (Drift & Coherence Review, 13 Nov.; `docs/reviews/drift-coherence-review-2026-11-13.md`.)
- The Harbour calls read is `lib/cost-read-calls.js` (LIN-4457): `readCalls`, `appCallsOf` and
  `callsSurfaceOf` are pure over docs their caller keys to one workspace (`listInHorizon(urlKey)`). The
  instance-wide boundary is the `urlKey` / `instanceWide` guard on `lineageRecords` and `readCost`
  (LIN-4226), not these readers. A new calls shape goes beside them, and `appCallsOf([])` is the one empty shape.
