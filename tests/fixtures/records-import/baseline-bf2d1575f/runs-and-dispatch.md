# Waiting fixture

Copied from docs/areas/runs-and-dispatch.md at bf2d1575f (LIN-4494): the ## Waiting section only, for the importer test on a shallow checkout.

## Waiting
- `lib/dispatch-leftover-hook.js`: a death between `claimHeldWake` and the enqueue, or a failed
  release write, leaves the wake held. No sweep: a lease sees no re-report, a sweep scans
  history, and clearing stamps reopens LIN-4375's double queue. (LIN-4377.)
- `lib/dispatch-store.js`: `addFeedback` takes one `wakeHook`; a second held-wake feature
  first needs composable hooks. (Operator, LIN-4377.)
- `lib/run-paragraph-hook.js`: stored run paragraphs are retained as written, and the cutover to request records
  does not regenerate them. The gate key (`inputHash`, `gateFacts` in `lib/run-paragraph.js`) covers the title and
  the ended loops only, so cost, usage and tier cannot move it: a stored `final` paragraph stays a cache hit when only
  those change, and a newly ended loop still regenerates it. Nothing is labelled pre-cutover, because a stored
  paragraph carries no figure: the hook writes its text, the model that wrote it, the gate key and `final`, and the
  prompt forbids a price or a model id. The witness is `tests/unit/run-paragraph-hook.test.js` (the W-6 cases,
  LIN-4475). (Survey tally: LIN-4201; answered in LIN-4475.)
- `lib/wake-shadow.js`: one wake policy, from the LIN-3257 classifier this shadow records.
  (Survey tally: LIN-3257.)
- `lib/run-live-wait.js`: a read, not a claim: two different-kind calls racing on
  one ticket both pass; claim compare-and-set, like `claimHeldWake` (LIN-4392). (Moved from the LLM & prompts note by LIN-4459.)
- `lib/run-live-wait.js`: the run-outcome words have two homes. `QUEUED`/`RUNNING` live here (they moved
  with `isLiveRun` to avoid an import cycle), while `WAITING_ON_A_PERSON` and `'closed'` stay
  in `lib/recent-runs.js` (`'aborted'` is in `LINEAGE_TERMINAL_STATUSES`, `lib/dispatch-lineage-status.js`), and
  `lib/recommendation-look-first.js` still imports `WAITING_ON_A_PERSON` from there. One home
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
- `lib/run-view.js` (the display words: `STAGE_LABELS` is defined here, built from each record's `label` in llm-and-prompts' `lib/prompts/stage-kinds.js`): `STEP_KIND_WORDS`
  copies six labels from `STAGE_LABELS` through a hand-typed kind list, so `stageLabel('look-into')`
  is "Look into" and `stepKindWord('look-into')` is "Look-into", and a new kind has to be added to
  that list by hand. One display word per kind changes visible labels on the run page and settings
  (`lib/render-session.js`, `lib/render-settings.js`), so it is a product call. (LIN-4469 blind
  read.)
- `lib/run-ledger.js`: Harbour's `PR_URL_RE` in this file, which feeds every run's PR attribution (`prUrlsIn` and
  `extractPrUrls`), reads an `https://github.com/<owner>/<repo>/pull/<n>` URL only, while simple-dispatcher's
  `sessionPrs`, which reads the session's `DONE:` line in the other repository, also reads an `http://` one and returns
  the canonical https URL. So a run whose `DONE:` line carries an http PR link reports its PR in SD and none in
  Harbour. Harbour already has a second reader that disagrees with `PR_URL_RE` about http: `isPullRequestUrl` in
  `lib/milestone-funnel.js` accepts `http://` (pinned in `tests/unit/milestone-funnel.test.js`) and feeds the "PR opened"
  step of the per-person milestone funnel, reading the `url` of a run's `[evidence]` feedback entries, not its `DONE:`
  line. The runner-kit contract (`lib/runner-kit/contract.json`, area `report`, the case "a DONE: line with an http URL
  and a #x fragment") records the SD/Harbour split as a declared difference and decides neither side. Which reader is
  right, and whether Harbour's PR reading should widen to http, is a design call: widening `PR_URL_RE` changes which PRs
  a task owns, and narrowing SD changes the other repository. The divergence was found by reading the contract row and
  the readers, not from a recorded run; it was not checked against recorded runs, so how often an http PR link occurs
  is not known. When it is decided, change the reader and the row's cells together, then re-copy the contract into SD.
  (LIN-4475 blind read.)
- `lib/dispatch-factory.js`: the record's `model` (`routing.model`) names the routed id ("anthropic/claude-opus-4.8" for
  the `opus` route), but the claude-code harness runs a Claude id by its family token (`isModelRunnableOn` and
  `CLAUDE_MAPPABLE_MODEL_FAMILIES`, `lib/model-routing-harnesses.js`), and on blind-read dispatches d9bdf6d8, cced07ee and
  0399b2e2 it ran `claude-opus-5-5`, so a record can misname the model that ran. Cost is already priced from the model the
  worker reports. Waiting: make the record carry the model the worker reports, or update the routed id. (LIN-4396 review;
  moved here from LLM & prompts by LIN-4470, as agreed on LIN-4447.)
- `lib/run-view.js`: `STAGE_LABELS` spreads the labels from `STAGE_KINDS` and `STEP_KIND_WORDS` hand-lists six
  kinds to read back from it, so the run page's display words now live on the prompt record and Runs depends on
  LLM & prompts; `lib/run-closeout-state.js` and `lib/pipeline-churn.js` also import
  `lib/prompts/blind-read-words.js`. Waiting on a design choice: whether display labels belong on the stage
  record or in Runs. Not scheduled; no ticket takes it. (LIN-4448 blind read.)
- `lib/run-closeout-state.js`: its header says the Done rule is bounded here, in one place, but `setDone` in
  `closeOutDecision` has no stop-at term: the stop-at-PR bound is applied by the check route
  (`routes/workspace-api-run-evidence.js`), so the route's JSON can carry `setDone: true` for a task nothing set Done
  (no client reads it today). Inside the decision the person-acted rule is spelled twice: `doneWithoutHarbour` feeds
  `followsPerson`, and `routesRead` writes its own variant inline. `followsPerson` and `waitsOn` have no production
  reader; `blindReadStep` reads `routesRead` alone. A change to the rule in one expression leaves the published fact
  disagreeing with the read routed. (Drift & Coherence Review, 14 Nov.; `docs/reviews/drift-coherence-review-2026-11-14.md`.)
- `lib/dispatch-feedback-kinds.js`: its header says the runner prompt renders the kinds through the store's re-export and
  that the store imports the table. The store does neither (its own comment says so) and `lib/prompts/runner-kickoff.js`
  imports the leaf. A header fix. (Drift & Coherence Review, 14 Nov.; `docs/reviews/drift-coherence-review-2026-11-14.md`.)
