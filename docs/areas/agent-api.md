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
  goes in `codeRouteOf` (`lib/openrouter.js`), which GET /recommend (`routes/proxy-compute.js`)
  and the task page also reach; a descent-arm check (`lib/dispatch-entrance.js`) covers one
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

## Waiting

- `routes/proxy-compute.js`: the recap/brief GET and POST handlers repeat one error-mapping chain
  and match provider errors by an "OpenRouter" substring; one helper beside `failureOf`, keyed on
  an error code, would hold "whole or loud". (Review, 8 Nov, on LIN-4358; area reads CG/CH.)
- `routes/proxy.js`: `hashCredential` (proxyLimiter's key) is a second sha256-of-a-token helper
  beside `ProxyTokenStore._hashToken`. One exported token hash. (Area reads CE/CF, LIN-4378.)
- `lib/proxy-instructions.js`: the rate-limit rule (60/min per token; on a 429 wait `Retry-After`)
  is restated in ~eight places (quote one); it keys on the proven credential, else the IP
  (`routes/proxy.js`), so "per token" is wrong before auth. (Area reads
  CE/CF, LIN-4378; Documentation Review, 10 Nov.; `docs/reviews/documentation-review-2026-11-10.md`.)
- `routes/proxy-reads.js`: GET /issues returns no `createdAt`, so the stability measure's
  tickets-minted row bisects single-issue reads for it (`scripts/stability-measures-tracker.mjs`
  `idSpanSearch`: 22 probes on the 8 Nov window, with 404, trashed and bracket edge cases). A
  `createdAt` on the list, or a created-before filter, would replace them with one read.
  (LIN-4421 leftovers; Survey global.)
- `routes/proxy.js`: the `proxyLimiter` window (60 seconds) and the broker's wait cap (`EXCHANGE_MAX_WAIT_SECONDS`, `lib/runner-kit/broker.mjs`) match by comment only: the contract records 60s on both sides, but no test reads `windowMs` against it, so either can break the retry budget. (Seams & Tangles, 8 Nov.; `docs/reviews/seams-tangles-review-2026-11-08-run10.md`.)
- `routes/proxy-writes.js`: "no step may change them" (the `## As asked` words) is written twice,
  in `AS_ASKED_LEAD` and in `BRIEF_HINT` (`lib/as-asked.js`); the census pins the markers, not this
  rule; `lib/proxy-instructions.js` spells "a day" beside `LANDED_MIN_GAP_MS`. Borderline, LOW.
  (Drift & Coherence Review, 10 Nov; `docs/reviews/drift-coherence-review-2026-11-10.md`.)
- `routes/proxy.js`: recommend-and-dispatch's `skipLiveWait` exempts any `followUpTo`, so a
  follow-up into an *ended* session of another stage proceeds while one is live. Requiring
  `followUpTo` in the live row's lineage needs a lineage read per hop (`lib/dispatch-entrance.js`
  sets it; wait and race: `lib/recommendation-live-wait.js`). (LIN-4392 review.)
- `lib/proxy-instructions.js`: the catalog omits the `leftover` row kind and the hold on a
  build's DONE wake until its leftover row ends (`lib/dispatch-leftover.js`; the architecture doc
  has it). Its `kind` contract, "prompt-template keys plus custom", misses 23
  `DISPATCH_KINDS` and the `ROW_ONLY_KINDS` (`lib/dispatch-fields.js`). (Documentation Review,
  10 Nov.; `docs/reviews/documentation-review-2026-11-10.md`.)
- `lib/proxy-instructions.js`: the guide (`docs/proxy-integration.md`) lacks eight routes the code
  serves (seven `model-routing`, `POST runner/usage/:id`, which the kit's contract also has no row
  for); the catalog lacks three snapshot and prompt routes; the verb-override lists (15 and 13 of 19)
  fall short, and no test keeps either in step. Generate or test them from the catalog: a size of
  move. (Documentation Review, 10 Nov.; `docs/reviews/documentation-review-2026-11-10.md`.)
- `lib/proxy-instructions.js`: the runner poll returns a `halt` key and never a `target: dash`
  item (`routes/proxy-runner.js` filters on runner targets, `lib/dispatch-targets.js`). Neither
  doc says so. (LIN-3622, Done; Documentation Review, 10 Nov.;
  `docs/reviews/documentation-review-2026-11-10.md`.)
- `lib/proxy-instructions.js`: `recommend` and `recommend-and-dispatch` give a fresh, unsized ticket survey-task, survey-place, then scoping (`lib/recommendation-look-first.js`), and a live step `prompt: null` with `liveWait`. The guide's GET /recommend omits this (the catalog has it), so an agent takes a Survey step as its task. (LIN-4370, Done; Documentation Review, 10 Nov.; `docs/reviews/documentation-review-2026-11-10.md`.)
- `routes/proxy-model-routing.js`: with `modelRoutingProxyWrites` on (any member), every readWrite
  key, leaf workers' included, can set any harness or model workspace-wide; a non-`claude-code`
  harness puts later bootstraps inline. No runnable check; `urlKey` filters untested. (Security Review, 10 Nov.; `docs/reviews/security-review-2026-11-10.md`.)
- `routes/proxy.js`: a dispatch token can still GET ticket context (`/brief/`, `/issues/`, relations), because the proxy
  does not know which stage a token was minted for. The blind read (LIN-4437) is blind by its prompt and preamble only: a
  reader that ignores them can read the ask and the plan. Holding it needs the stage on the token and a read guard per
  stage. By the consequence test it breaks nothing today, blocks no work and touches no safety. (LIN-4396 plan, witness 2.)
