# Waiting fixture

Copied from docs/areas/agent-api.md at bf2d1575f (LIN-4494): the ## Waiting section only, for the importer test on a shallow checkout.

## Waiting
- `routes/proxy-compute.js`: the recap/brief GET and POST handlers share one error mapping now
  (`streamedFailureReply`, LIN-4460 leftovers), but it still matches provider errors by "OpenRouter" and
  "not found" substrings; keying it on an error code would hold "whole or loud". (Review, 8 Nov, on
  LIN-4358; area reads CG/CH.) (Corrected by Seams & Tangles, 14 Nov.; `docs/reviews/seams-tangles-review-2026-11-14-run13.md`.)
- `lib/proxy-instructions.js`: the rate-limit rule (60/min per token; on a 429 wait `Retry-After`)
  is restated in ~eight places (quote one); it keys on the proven credential, else the IP
  (`routes/proxy.js`), so "per token" is wrong before auth. (Area reads
  CE/CF, LIN-4378; Documentation Review, 10 Nov.; `docs/reviews/documentation-review-2026-11-10.md`.)
- `routes/proxy-reads.js`: GET /issues returns no `createdAt`, so the stability measure's
  tickets-minted row bisects single-issue reads for it (`scripts/stability-measures-tracker.mjs`
  `idSpanSearch`: 22 probes on the 8 Nov window, with 404, trashed and bracket edge cases). A
  `createdAt` on the list, or a created-before filter, would replace them with one read.
  (LIN-4421 leftovers; Survey global.)
- `routes/proxy-writes.js`: "no step may change them" (the `## As asked` words) is written twice,
  in `AS_ASKED_LEAD` and in `BRIEF_HINT` (`lib/as-asked.js`); the census pins the markers, not this
  rule; `lib/proxy-instructions.js` spells "a day" beside `LANDED_MIN_GAP_MS`. Borderline, LOW.
  (Drift & Coherence Review, 10 Nov; `docs/reviews/drift-coherence-review-2026-11-10.md`.)
- `routes/proxy.js`: recommend-and-dispatch's `skipLiveWait` exempts any `followUpTo`, so a
  follow-up into an *ended* session of another stage proceeds while one is live. Requiring
  `followUpTo` in the live row's lineage needs a lineage read per hop (`lib/dispatch-entrance.js`
  sets it; wait and race: `lib/run-live-wait.js`). (LIN-4392 review.)
- `lib/proxy-instructions.js`: the catalog omits the `leftover` row kind and the hold on a
  build's DONE wake until its leftover row ends (`lib/dispatch-leftover.js`; the architecture doc
  has it). Its `kind` contract, "prompt-template keys plus custom", misses
  the three `DISPATCH_KINDS` that are neither (`autopilot`, `defer`, `periodical`; 24 kinds in all) and the `ROW_ONLY_KINDS` (`lib/dispatch-fields.js`). (Documentation Review,
  10 Nov.; `docs/reviews/documentation-review-2026-11-10.md`.)
- `lib/proxy-instructions.js`: the guide (`docs/proxy-integration.md`) lacks eight routes the code
  serves (seven `model-routing`, `POST runner/usage/:id`, which the kit's contract also has no row
  for); the catalog lacks three snapshot and prompt routes. Generate or test them from the catalog: a size of
  move. (The verb-override list is derived from the stage-kind records since LIN-4467.) (Documentation Review, 10 Nov.; `docs/reviews/documentation-review-2026-11-10.md`.)
- `lib/proxy-instructions.js`: `recommend` and `recommend-and-dispatch` give a fresh, unsized ticket survey-task, survey-place, then scoping (`lib/recommendation-look-first.js`), and a live step `prompt: null` with `liveWait`. The guide's GET /recommend omits this (the catalog has it), so an agent takes a Survey step as its task. (LIN-4370, Done; Documentation Review, 10 Nov.; `docs/reviews/documentation-review-2026-11-10.md`.)
- `routes/proxy-model-routing.js`: with `modelRoutingProxyWrites` on (any member), every readWrite
  key whose stage may write (unstamped, or stamped `work`; since LIN-4468 the chain is
  `requireWriteScope('modelRouting')`, so reading stages get a 403), leaf workers' included, can set any harness or model workspace-wide; a non-`claude-code`
  harness puts later bootstraps inline. No runnable check; `urlKey` filters untested. (Security Review, 10 Nov.; `docs/reviews/security-review-2026-11-10.md`.)
- `routes/proxy.js`: a stage's token now carries its stage's write allowance and its one ticket (LIN-4468), so the proxy
  holds a reading stage to its writes. It does not yet hold its reads: a dispatch token can still GET ticket context
  (`/brief/`, `/issues/`, relations), and the blind read (LIN-4437) is blind by its prompt and preamble only, so a reader that
  ignores them can read the ask and the plan. Holding that needs a read guard per stage on the stamped token; the table in
  `lib/stage-writes.js` has no read column yet. By the consequence test it breaks nothing today, blocks no work and touches
  no safety. (LIN-4396 plan, witness 2; LIN-4468.)
- `routes/proxy-compute.js`: production code recognises the hermetic `'test-token'`: eleven production modules
  (this file, `server.js`, six workspace-API routes and others) call the one helper (`isHermeticTestToken`,
  `lib/should-mock-ai.js`), and one inline comparison is left (`routes/test.js`, the transport installer).
  Each is gated on `NODE_ENV=test`, so production behaviour is right today; injecting transports from tests,
  instead of production code recognising the token, would remove these checks and the `testTransport`
  declaration (`lib/dispatch-factory.js`). It spans several areas. (LIN-4456 review and Survey global, 13 Nov.)
  (Corrected by Seams & Tangles, 14 Nov.; `docs/reviews/seams-tangles-review-2026-11-14-run13.md`.)
- `routes/proxy-writes.js`: the `updateIssue` handler destructures nine body fields and `ISSUE_PATCH_FIELDS`
  (`lib/stage-writes.js`) lists the same nine; only a comment and a source test keep them in step. One list would
  mean reshaping the handler's field-by-field conversion. Not scheduled; no ticket takes it. (LIN-4448 blind read.)
