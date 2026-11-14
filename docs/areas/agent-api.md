# Agent API (proxy)

Area notes for `agent-api` in the registry. Format and rules: README.md.

## Lessons

- `proxyLimiter` runs before `authenticateProxyToken` on purpose, so its key may trust a
  bearer only after auth has proved it (`provenCredentials` in `routes/proxy.js`); a key
  from an unverified bearer gives each junk bearer a fresh bucket and floods reach the
  token store (LIN-4378). The limiters skip under `NODE_ENV=test`, so a limiter
  test drives the real chain with it flipped off, as
  `tests/unit/lin-4378-proxy-limiter-per-credential.test.js` does.
- A recommend surface must not offer what the verb refuses: a rule for recommend-and-dispatch
  goes in `CODE_ROUTES` (`lib/code-routes.js`, iterated by `codeRouteOf` in `lib/openrouter.js`),
  which GET /recommend (`routes/proxy-compute.js`) and the task page also reach; a descent-arm check (`lib/dispatch-entrance.js`) covers one
  surface, without run facts. A caller's bypass rides the call options (`skipLiveWait`),
  never the recommendation context (LIN-4392).
- `/cost/:identifier` (`routes/proxy-compute.js`) is pinned by frozen baselines. A change to its window or shape
  moves `tests/fixtures/cost-replay/expected-changes.json` (W9 checks paths, not values, so pin moved values in
  `tests/unit/cost-read.test.js`), `tests/fixtures/cost-replay/goldens-lin4197.json` (amend its header with the
  reason; record with `tests/fixtures/cost-replay/record-lin4197.mjs`) and the `docs/passage-runner-prompt.md` drift
  guard. `tests/fixtures/cost-replay/goldens.json` stays the baseline: re-recording it erases the change list (LIN-4404).
- A check on comment bodies keys on the comment's opening line, never on any line: reviewers write
  the same `### Leftovers` heading mid-comment, so matching any heading line would refuse the verdict
  that gates merge (`routes/proxy-writes.js` `refusedByLeftoverAnswer`; caught at LIN-4414's plan
  review). Test it against real comments, review verdicts included (`tests/unit/dispatch-leftover-answer.test.js`).
- A format check on an optional create or PATCH field refuses (400); it is never the field's
  `present` gate. As a `present` gate it skipped the value, and the write succeeded without it: a
  Jira key or a Linear identifier in `parentId` vanished. Check presence first, then the writable
  contract, then the format (`routes/proxy-writes.js`, LIN-4451 create, LIN-4452 PATCH).
- A typed error a provider method gains reaches a caller only if every route calling that method
  maps it: `refs`/`partial` in the proxy write `SPEC`, and each session or feedback catch by hand.
  Provider tests passed while all three create lanes answered a bare 500 for a landed create. Pin
  it at the route boundary (`routes/proxy-writes.js`; `tests/unit/lin-4452-create-lane-envelope.test.js`).
- Every proxy write mount names its operation: `requireWriteScope('<op>')` for a readWrite route,
  `requireStageWrite('<op>')` for a grant-gated one, with `<op>` in `STAGE_WRITE_OPS`
  (`lib/stage-writes.js`; the gate is `lib/stage-write-gate.js`). A stamped token is refused any
  operation its allowance does not list, so a route nobody named would be refused to a reading
  stage without a word, and an unnamed name throws at mount. A new write route adds its operation
  to that list and a row to `CENSUS` in `tests/unit/lin-4468-stage-write-allowance.test.js`, or the
  census fails (LIN-4468).
- A token minted for a stage carries its `writes` and ticket, or has a reason not to. Pass both into
  the mint helpers (`lib/proxy-preamble.js`), or read them from the row (`lib/item-stage-stamp.js`).
  A wake, immediate or held, takes the stamp of the session it resumes, the parent, not the row that
  reported (`stampForWakeParent`; a held release gets the producing build's id from the store). A mint
  with neither is unrestricted, which is right only for a person's or a `custom` mint, listed with its
  reason in `tests/unit/dispatch-entrance-mint-sweep.test.js`. The refire broker minted unrestricted
  tokens for read-only rows because its mint was a bare `createToken`, which no helper-name search
  finds (LIN-4468).

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
  `DISPATCH_KINDS` that are neither (24 kinds now; `autopilot`, `defer` and `periodical` among them) and the `ROW_ONLY_KINDS` (`lib/dispatch-fields.js`). (Documentation Review,
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
