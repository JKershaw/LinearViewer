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

## Waiting

- `routes/proxy-rulings.js`: its own live-run predicate (`liveDispatchOnAnchor` over
  `isTerminalLoop`) instead of `liveOnAnchor` (`lib/live-anchor.js`); its comment names an
  incident from that class. One predicate. (Survey tally: LIN-4143.)
- `routes/proxy-compute.js`: the recap/brief GET and POST handlers repeat one error-mapping chain
  and match provider errors by an "OpenRouter" substring; one helper beside `failureOf`, keyed on
  an error code, would hold "whole or loud". (Review, 8 Nov, on LIN-4358; area reads CG/CH.)
- `routes/proxy.js`: `hashCredential` (proxyLimiter's key) is a second sha256-of-a-token helper
  beside `ProxyTokenStore._hashToken`. One exported token hash. (Area reads CE/CF, LIN-4378.)
- `lib/proxy-instructions.js`: the rate-limit rule (60/min per token; on a 429 wait `Retry-After`)
  is restated in ~eight places (quote one); it keys on the proven credential, else the IP
  (`routes/proxy.js`), so "per token" is wrong before auth. (Area reads
  CE/CF, LIN-4378; Documentation Review, 10 Nov.; `docs/reviews/documentation-review-2026-11-10.md`.)
- `routes/proxy.js`: the `proxyLimiter` window (60 seconds) and the broker's wait cap (`EXCHANGE_MAX_WAIT_SECONDS`, `lib/runner-kit/broker.mjs`) match by comment only: the contract records 60s on both sides, but no test reads `windowMs` against it, so either can break the retry budget. (Seams & Tangles, 8 Nov.; `docs/reviews/seams-tangles-review-2026-11-08-run10.md`.)
- `lib/proxy-preamble.js`: `applyDefaultDispatchHarness` (harness policy) is imported by LLM's
  `lib/model-routing.js` and `lib/model-routing-harnesses.js`: routing policy in an Agent API file.
  Move it to the routing side or a shared leaf. (Seams & Tangles, 10 Nov.;
  `docs/reviews/seams-tangles-review-2026-11-10-run11.md`.)
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
