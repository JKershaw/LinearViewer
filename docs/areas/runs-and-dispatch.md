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
- Close-out readiness has five lanes: the route (`codeRouteOf`), the stop-at state, the task page's
  box (`buildRunEvidence`) and both guard lanes (`closeOutNotReady`). A readiness rule goes in
  `closeOutWaitsOn` (`lib/run-closeout-state.js`) and gets a row in the shared-trail table
  (`lin-4438-blind-read-gate`); gating one lane let the page offer a press the guard refused (LIN-4438).
- A reader that classifies by kind routes `custom` before `bucketOf`: `BUCKET_OF_KIND` maps
  `custom` to orchestration, and `bucketOf` falls back to orchestration silently, so check membership
  (`lib/wall-clock-summary.js`). `dispatchesOf` turns a missing kind into `custom` (`lib/cost-read.js`):
  confirm a custom kind from its own row before trusting it (LIN-4426).
- A full PR URL's repository and number come from `prOf` beside `prUrlsIn` (`lib/run-ledger.js`),
  for the task page and measure 1 alike; compare repositories case-blind, as GitHub does (LIN-4439).
- A per-dispatch figure (its model, cost or completeness) is the fold's answer, carried through
  `lib/cost-read.js`; a reader never re-ranks `byModel` itself. (Drift & Coherence Review, 13 Nov.; `docs/reviews/drift-coherence-review-2026-11-13.md`.)

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
- `lib/dispatch-factory.js`: tests `provider.name === 'linear'` beside
  `isHermeticTestToken` for a test-only transport. (LIN-4347.)
- `lib/cost-read.js`: split out `readCalls` and `callsSurfaceOf`; settle whether
  instance-wide reads sit beside workspace-keyed stores. (Survey tally: LIN-4201.)
- `lib/session-summary.js`: do stored run paragraphs keep pre-cutover figures? (Survey
  tally: LIN-4201.)
- `lib/wake-shadow.js`: one wake policy, from the LIN-3257 classifier this shadow records.
  (Survey tally: LIN-3257.)
- `lib/runner-kit/runner.mjs`: the per-message transcript fold is here and in SD; one shared
  fold would turn a transcript into requests. (Survey tally: LIN-4203, LIN-4195.)
- `lib/recent-runs.js`: `runFact` reads only the row's feedback: a stage parked `[pending]` whose
  lineage ends `[blocked]` or `[skipped]` reads `running` and holds the live-stage wait until
  aborted. (LIN-4392.)
- `lib/run-ledger.js`: `landingPrUrls` counts every full PR URL after its anchor, so it disagrees with
  the other landing readers in two cases the shared-trail table pins as chosen, not designed
  (`tests/unit/lin-4438-blind-read-gate.test.js` rows 14 and 15): an audit report that re-cites a
  merged landing PR puts it in the notes PR's landing (`auditAfterLandingCloseOut` in
  `lib/recommendation-facts.js` treats only the new PR as the notes PR), and a foreign PR cited
  before the first review joins a first landing. Each costs a read that must name an extra PR. One
  comment classifier and one landing reader would make both follow from one rule. A third case is not pinned: an agent's own note (first line
  `autopilot`, `plan posted`, `plan revised`, or `revision N`) that cites a new PR after review joins
  `landingPrUrls` but not `isLandingEvidence` (`lib/recommendation-facts.js`), so `blindReadStep`
  offers a blind read naming a PR the approved review never covered, where a plain note sends it
  back to review (reproduced at
  e2d4659c4; Seams & Tangles, 13 Nov.; `docs/reviews/seams-tangles-review-2026-11-13-run12.md`, §3.0a).
  (LIN-4438; Survey global on LIN-4438.)
- `lib/run-ledger.js`: `landingPrUrls` skips only blind reads and survey reports, so a comment headed
  `## Area read` that names a full PR URL would join the ticket's landing. Only the prose rule in
  `docs/plans/survey/area-read.md` (cite `path@sha`, never a PR URL) keeps the LIN-4447 area reads
  out today. An area-read kind in the one comment classifier (LIN-4458, piece 2) would make that rule code. (Leftover
  of LIN-4453; Survey global on LIN-4453.)
- `lib/run-closeout-state.js`: `deriveCloseOutState` works from two PR lists: `prs` (`extractPrUrls`,
  every PR ever cited) drives the PR-shape reasons (multiple-prs, partial, merged) and `landingPrs`
  (`landingPrUrls`) drives the blind-read gate, so the box can count PRs the gate ignores and the
  other way round (pinned in `tests/unit/lin-4438-blind-read-gate.test.js` rows 14 and 15). Which
  reader answers "this task's PRs" spans the box, the guard and the route. (Blind read on LIN-4439.)
- `lib/close-out-readiness.js`: in the stop-at lane `deriveCloseOutState` lets merged and partial
  outrank the gate, then `closeOutNotReady` asks `closeOutWaitsOn` again to override it, so the box
  state is not the guard's whole answer and the precedence lives in two files. Carrying the gate's
  answer in the state changes the box model the renderers read. (Blind read on LIN-4439.) `ladderNotReady`
  asks the gate a third time, so the box and the guard order the same reasons two ways and the next
  close-out reason must be placed in both; one order is a decision about what the box shows versus
  what the guard refuses. (Blind read on LIN-4396.)
- `lib/run-closeout-state.js`: the close-out reasons are bare string literals: `'blind-read-missing'`
  is spelled here and again in `REFUSED_REASONS` (`lib/close-out-readiness.js`, beside `'head-moved'`),
  and `closeOutNotReadyRefusal` builds its error by capitalising `state.message`. A reasons constant
  (like `CLOSE_OUT_STATUS`) covering every reason, used by the box, the guard and the render, would
  give them one vocabulary. (Blind read on LIN-4396.)
- `lib/run-closeout-state.js`: `closeOutSetsDone` never asks `closeOutWaitsOn`, so the owner's check
  (`routes/workspace-api-run-evidence.js`) sets a stop-at-PR task Done when its landing PR is merged
  and approved with no blind read, while the close-out guard (`lib/close-out-readiness.js`) refuses
  the same trail as `blind-read-missing`, and `blindReadStep` (`lib/recommendation-blind-read.js`)
  then routes a read to the Done ticket (it stands aside on a completed ticket only after a
  close-out). The entries above name the box/guard precedence split; this is its Done path. Whether
  a person's own check may pass the gate is a decision; the shared-trail test runs with
  `byPersonCheck: false`, so it never reaches this path. (Drift & Coherence Review, 13 Nov., second read; `docs/reviews/drift-coherence-review-2026-11-13.md`.)
