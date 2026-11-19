# Waiting fixture

Copied from docs/areas/reports-and-operator-tools.md at bf2d1575f (LIN-4494): the ## Waiting section only, for the importer test on a shallow checkout.

## Waiting
- `scripts/stability-measures-tracker.mjs`: `createProxyClient` is the one proxy client in
  `scripts/` that paces from the start and honours 429 `Retry-After`. The other 47 scripts that
  read the proxy pace by fixed sleeps (`scripts/pipeline-churn.mjs` sleeps 1.1 s, and 5 s × attempt
  on a 429; the `steady-base-*` and `survey-*` scripts likewise), so the rate rule is spelled two
  ways. One shared client under `scripts/lib/` would retire the copies. (LIN-4421 leftovers; Survey global.)
- `scripts/stability-measures-seat.mjs`: the person's seat reads loop rulings only and cannot
  read person origin, so its operator-free share is an upper bound. Two proxy reads would
  make it whole: an origin field on the dispatch read (the server records it as press
  events in `lib/task-mode-store.js` and `personOriginated` in `lib/dispatch-wake.js`), and
  a read of resolved task-bound rulings (or of `computeEscalationKpis` itself, which already
  reads both halves). Whether a parent's rulings count against its pieces is LIN-4399's
  call. (LIN-4422; LIN-4399 plan review note 1; Survey open-0.)
- `scripts/stability-measures-tracker.mjs`: `readSeat` reads every lineage member's detail,
  one call each: 1,576 members for the 106 finished tasks of the 8 Nov window, about half
  an hour at 50 a minute. A dispatch-detail read by issue or by lineage that returns each
  member's own feedback would cut that to one call per task. (LIN-4422; Survey global.)
- `lib/account-erasure.js`: each collection should be declared once with all its facts
  (name, store module, erasure row, urlKey class, dry-run shape), and opening an
  undeclared name should fail. LIN-4234 gave both guards one source of collection names;
  the other facts still sit in separate tables. Route counts are also pinned by hand in
  several tests. (Survey tally: LIN-4168, LIN-4179, LIN-4198, LIN-4234.)
- `lib/pricing-conformance-sweep.js`: the name says "conformance", but since LIN-4358 there
  is no rate table to conform; the sweep checks that the catalog's prices parse, that models
  in use are priced and that the choice lists name listed models. Renaming moves the
  scheduler job name (its `scheduler-locks` doc), the server.js registration, the
  scheduler census and `docs/architecture/source-map.md`. (LIN-4358 leftovers.)
- `scripts/stability-measures.mjs`: its declaration's contract
  (`docs/reviews/stability-measures/README.md`) is checked from two files. The `DECLARATION`
  block in `tests/unit/stability-measures.test.js` checks that it names every row the tool emits;
  a LIN-4424 test in `tests/unit/periodicals.test.js` reads the same README again to check it
  carries each element the shared Stability prompt asks a declaration for (including the literal
  `node scripts/stability-measures.mjs`), so a prompt-template test depends on one repo's docs
  file. Moving that check into `tests/unit/stability-measures.test.js`, beside the rest of the
  contract, with the prompt's element list exported for it, would give the contract one home.
  (LIN-4424 blind read.)
- `scripts/stability-measures-core.mjs`: `landingPr` reads which PR a landing merged, but the
  survey scripts tell a squash landing by their own trailing-`(#N)` test
  (`scripts/survey-growth-git.mjs`, `scripts/survey-halving-git.mjs`,
  `scripts/survey-tests-friction-git.mjs`), so the rule is spelled four ways. Importing
  `landingPr` would make it one, at the cost of re-checking their frozen survey counts. (LIN-4439 leftovers.)
- `scripts/stability-measures-blind.mjs`: `GATE_LANDING` hard-codes the gate's merge commit, PR
  and time as measure 1's cut-off, and `repoSlugOf` is another GitHub-URL parser beside `prOf`
  (`lib/run-ledger.js`). Taking the cut-off from data needs a decision about where the gate's start
  is recorded; the parser could fold in with it. (Blind read on LIN-4396.)
- `scripts/stability-measures-seat.mjs`: says its ruling outcome buckets are "as
  lib/escalation-kpis.js", but counts a withdrawn ruling as neither and a null outcome as
  unreadable, where the home (`lib/escalation-kpis.js`, over `lib/digest-feedback.js`) counts every
  resolved event that is not dismissed or self-resolved as answered. The inputs differ (proxy rulings
  against feedback events), so the split may be meant; the citation should then say how they differ.
  (Drift & Coherence Review, 13 Nov.; `docs/reviews/drift-coherence-review-2026-11-13.md`.)
