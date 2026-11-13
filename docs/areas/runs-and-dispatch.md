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

## Waiting

- `lib/dispatch-wake.js`: `reportedPrUrlOf` and SD's `sessionPrs` pick a PR by one order, linked
  only by a comment; changing one moves a PR link. (Drift & Coherence Review, 10 Nov;
  `docs/reviews/drift-coherence-review-2026-11-10.md`.)
- `lib/dispatch-leftover-hook.js`: a death between `claimHeldWake` and the enqueue, or a failed
  release write, leaves the wake held. No sweep: a lease sees no re-report, a sweep scans
  history, and clearing stamps reopens LIN-4375's double queue. (LIN-4377.)
- `lib/dispatch-store.js`: `addFeedback` takes one `wakeHook`; a second held-wake feature
  first needs composable hooks. (Operator, LIN-4377.)
- `lib/runner-kit/contract.json`: the row-shape rule is written twice (`checkRowShape`;
  SD's `columnProblems`); `CONTRACT_SHA256` pins the bytes, not the rule. (Operator, LIN-4377.)
- `lib/runner-kit/contract.json`: no row pins a follow-up to a finished, unhalted session
  (rows cover pause and stop), though the leftover step resumes its build that way
  (`lib/dispatch-leftover.js`). (Seams & Tangles, 10 Nov.;
  `docs/reviews/seams-tangles-review-2026-11-10-run11.md`.)
- `lib/session-summary.js`: do stored run paragraphs keep pre-cutover figures? (Survey
  tally: LIN-4201.)
- `lib/wake-shadow.js`: one wake policy, from the LIN-3257 classifier this shadow records.
  (Survey tally: LIN-3257.)
- `lib/runner-kit/runner.mjs`: the per-message transcript fold is here and in SD; one shared
  fold would turn a transcript into requests. (Survey tally: LIN-4203, LIN-4195.)
- `lib/run-live-wait.js`: a read, not a claim: two different-kind calls racing on
  one ticket both pass; claim compare-and-set, like `claimHeldWake` (LIN-4392). (Moved from the LLM & prompts note by LIN-4459.)
- `lib/run-live-wait.js`: the run-outcome words have two homes. `QUEUED`/`RUNNING` live here (they moved
  with `isLiveRun` to avoid an import cycle), while `WAITING_ON_A_PERSON`, `'closed'` and `'aborted'` stay
  in `lib/recent-runs.js`, and `lib/recommendation-look-first.js` still imports them from there. One home
  (for example a leaf module of outcome words) touches importers in LLM & prompts, so it is larger than a
  fix. (LIN-4459 blind read.)
- `lib/recent-runs.js`: a parked stage whose lineage has ended is dated by its park time, not the lineage's
  end, because the `withLineage` wire row from `listHistory` (`lib/dispatch-store.js`) carries no end
  time. It sorts too early in the selector's five, and can land on the wrong side of a "since the latest
  review" cut, such as the ended-read count in `lib/recommendation-blind-read.js`. Fix: `listHistory`
  reports the lineage's end time, a store change that alters the Dispatch route's output. (LIN-4459 blind read.)
- `lib/run-trail.js`: a foreign PR cited by full URL before the first review (a research note, a plan)
  joins a first landing, so the blind read must name it (`tests/unit/lin-4438-blind-read-gate.test.js`
  row 15, kept as a stated limit): no caller holds the task's repository, so the landing cannot tell
  another repository's PR from this task's. A task-repository fact, or a kind stamped on a comment when
  it is posted, would let the landing drop it. (LIN-4438; why-not written by LIN-4458.)
- `lib/cost-read-calls.js`: `readCalls` states the figure rule (`totalUsd` only when everything is priced and
  complete; `pricedUsd` never counts a partial) in its own words, and the lineage figure in `lib/cost-read.js`
  states it again, so a change to the rule is made twice. One shared helper would make it one, but it reaches the
  lineage path and its goldens: larger than a fix. (LIN-4457 leftovers; Survey global on LIN-4457.)
- `lib/dispatch-feedback-kinds.js`: the table's `mayCarryWake` column is `true` on every row (unknown kinds
  pass too), so `findWakeEvent` (`lib/dispatch-terminal.js`) never skips a kind, while `lastWakeEntry`
  (`lib/run-view.js`) skips the decision-stamp kinds as "never a wake marker". Two wake scans disagree about
  stamps, and the column only records `findWakeEvent`'s behaviour. Removing the column or making it true to
  both readers means deciding whether `findWakeEvent` should skip stamps, which changes wake minting and
  every reader of stored rows. (LIN-4455 blind read.)
- `lib/dispatch-factory.js`: `refusesHermeticToken` skips access for a provider that declares `testTransport`
  (`LinearProvider`, `lib/providers/linear/index.js`), but nothing links that declaration to the transport
  swaps it describes (`routes/test.js` `installTestTokenLinearTransport`, `tests/fixtures/hermetic-linear.js`),
  so a new installer or a change to Linear's can drift from it silently. Closing it means deciding where test
  transports register (for example installers that declare which provider they cover, plus a census test),
  across providers, web routes and fixtures: larger than a fix. (LIN-4456 blind read, 13 Nov.)
- `lib/task-page-loader.js`: `fmtWhen` (the absolute UTC stamp, `8 Nov, 14:40 UTC`) stays in the loader, so
  `lib/components/time.js` and `lib/render-task-timeline.js` import a page-formatting helper from a
  runs-and-dispatch module, the tangle LIN-4472 removed for `relativeAgo`. Moving it into `lib/time-words.js` first
  needs a call on whether that leaf also owns absolute stamps; about five importers. (LIN-4472 blind read.)
- `lib/run-trail.js` `readTrail`: a re-review after a not-ready close-out that names the PR only as `#N` leaves the
  landing empty. The decision's gate (`closeOutWaitsOn`, `lib/run-closeout-state.js`) then opens with no blind read, and
  since LIN-4458 the box reads `no-pr`, the person's check sets no Done and the merge recorder records nothing
  (pinned in `tests/unit/lin-4458-landing-consumers.test.js`). The review prompt asks for the head, not the PR
  URL. Fix: fall back to the anchor close-out's PRs when nothing after the anchor cites one, or have the review
  prompt require the full URL (LLM & prompts' side). No live trail has this shape. (LIN-4458 review.)
- `lib/close-out-readiness.js` (the ladder lane) and `lib/recommendation-blind-read.js`: an outside merge on a
  ticket still In Progress is not seen, because neither reads a PR (the recommend path makes no GitHub read by
  contract, and the ladder reads none). The recommendation still routes a blind read, and the ladder still refuses
  on the gate. John accepted this on 13 Nov: "no new GitHub reads on the recommend path or ladder lane; add the fact
  later if a stuck case shows up." Pinned by `tests/unit/lin-4460-close-out-decision.test.js` (named for that ruling).
  Why not now: a PR read on the recommend path costs budget (`PR_STATE_READ_COST` against the 36/h anonymous limit in
  `lib/pr-state-store.js`), needs token resolution on a path that has none, and the process-wide PR cache is not
  workspace-scoped. Supplying a landing-merged fact later is one more input to `closeOutDecision`. (LIN-4460.)
- `lib/close-out-readiness.js` `readCloseOutChain`: every caller gets the derived box, but the merge recorder
  (`lib/close-out-merges.js`) wants only the reads, so it passes `actor: 'harbour'`, `runnerReady` and `owner` for a
  state it discards. A reads-only chain (trail, statuses, stop-at) with each surface calling `deriveCloseOutState`
  would drop those flags, at the cost of the check route, the guard and the tests that read `state` from the chain
  (`lin-4438-blind-read-gate`, `close-out-readiness-chain`): larger than a fix. (LIN-4460 leftovers; Survey global.)
- `lib/run-trail.js` `readTrail`: `closeOutOnTrail` (the decision's advice fact) and `closeOutAfterReview` (the
  selector's TRAIL FACTS line, `lib/recommendation-facts.js`) agree whenever a review is on record and differ only
  without one. Folding them to one fact changes `followsPerson` for a Done ticket with no review and touches the
  selector's facts on the LLM & prompts side. (LIN-4460 leftovers.)
- `lib/ci-wake-sweep.js` `prRefsFromPark` parses a runner's park message with its own `FULL_PR_URL_RE` (scheme
  optional, repo key case-folded) beside `prUrlsIn`/`prOf` (`lib/run-ledger.js`). Its comment-side read already
  goes through `extractPrUrls`. Moving it onto `prUrlsIn` changes which park messages wake (a scheme-less URL
  would stop matching), so it needs its own witness. (LIN-4458 review.)
- `lib/run-evidence.js`: the run page keeps two answers to "which PR is the task's". The close-out box counts `readTrail().landing` through `closeOutDecision` (LIN-4460 retired `deriveState`'s status decision: no reader outside the tests and the GET body reads it), but `deriveState` over `extractPrUrls` (every cited PR) still drives `state.pr`, `done`, `checked.now` and `resolveRunPrRef` (read by the `routes/dashboard.js` pr-state route), `state.prUrls` (`lib/pr-state-store.js`), and `lib/ci-wake-sweep.js` matches parks against every cited PR. Whether the page's PR and the CI-wake sweep follow the landing is a product decision touching several callers. Also, `readRunEvidence` reads the landing's sole PR and hands `buildRunEvidence` a bare `prStatus`, which `buildRunEvidence` re-pairs with the landing after reading the trail again: the same positional coupling the URL-keyed `Map` removed from the decision. Passing the status keyed by URL with the landing already read is a signature change for about 25 call sites (`tests/unit/run-evidence.test.js`, `routes/dashboard.js`), so larger than a fix. (LIN-4458 blind read; LIN-4460.)
- `lib/dispatch-entrance.js`: one follow-up mint gets its stage stamp two ways. `attach` carries
  `writes: stageWrites(resolvedKind)` with `attachIssue` as the ticket (via `attachProxyContext`,
  `lib/proxy-preamble.js`), and `stampForFollowUp` (`lib/item-stage-stamp.js`) gives the same `writes` with the parent
  row's `issueIdentifier`, spread beside it; which applies depends on whether `attach` is set. `lib/follow-up-dispatch.js`
  has only the second. Unifying them means deciding which ticket wins (the attach issue or the parent row) across
  `lib/proxy-preamble.js` and two entrances, so larger than a fix. (LIN-4468 blind read.)
