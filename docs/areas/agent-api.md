# Agent API (proxy)

Area notes for `agent-api` in the registry. Format and rules: README.md.

## Lessons

- `proxyLimiter` runs before `authenticateProxyToken` on purpose, so its key may trust a
  bearer only after auth has proved it (`provenCredentials` in `routes/proxy.js`). A key
  built from an unverified bearer gives every junk bearer a fresh bucket and lets floods
  reach the token store (LIN-4378). The limiters skip under `NODE_ENV=test`, so a limiter
  test drives the real route chain with it flipped off, as
  `tests/unit/lin-4378-proxy-limiter-per-credential.test.js` does.
- A recommend surface must not offer what the verb refuses. A rule for recommend-and-dispatch
  goes in `lib/openrouter.js` `codeRouteOf`, which GET /recommend (`routes/proxy-compute.js`)
  and the task page reach too; a check in the descent arm (`lib/dispatch-entrance.js`) covers
  one surface and has no run facts. A caller's bypass rides the call options (`skipLiveWait`),
  never the recommendation context (LIN-4392).
- `/cost/:identifier` (`routes/proxy-compute.js`) is pinned by frozen baselines. A change to its window or shape
  moves `tests/fixtures/cost-replay/expected-changes.json` (W9 checks paths, not values, so pin moved values in
  `tests/unit/cost-read.test.js`), `tests/fixtures/cost-replay/goldens-lin4197.json` (amend its header with the
  reason; record with `tests/fixtures/cost-replay/record-lin4197.mjs`) and the `docs/passage-runner-prompt.md` drift
  guard. `tests/fixtures/cost-replay/goldens.json` stays the baseline: re-recording it erases the change list (LIN-4404).

## Waiting

- `routes/proxy-rulings.js`: writes its own live-run predicate (`liveDispatchOnAnchor`
  over `isTerminalLoop`) instead of `liveOnAnchor` from `lib/live-anchor.js`, and its own
  comment names an earlier incident from that class. One live-run predicate. (Survey
  tally: LIN-4143.)
- `routes/proxy-compute.js`: the recap/brief GET and POST handlers repeat one error-mapping chain,
  and match provider errors by an "OpenRouter" substring. One helper beside `failureOf`, keyed on
  an error code, would hold "whole or loud". (Review, 8 Nov, on LIN-4358; area reads CG/CH.)
- `routes/proxy.js`: `hashCredential` (proxyLimiter's key) is a second sha256-of-a-token helper
  beside `ProxyTokenStore._hashToken`. One exported token hash. (Area reads CE/CF, LIN-4378.)
- `lib/proxy-instructions.js`: the rate-limit rule (60/min per token; on a 429 wait
  `Retry-After`) is restated in about eight places: here three times, both kickoff prompts,
  and three docs. One sentence, quoted from one place. The key is the proven credential, else
  the client IP (`routes/proxy.js`), so "per token" is wrong before auth, and the guide's
  per-IP token-mint line omits the session-account bucket. (Area reads CE/CF, LIN-4378;
  Documentation Review, 10 Nov.; `docs/reviews/documentation-review-2026-11-10.md`.)
- `routes/proxy.js`: the `proxyLimiter` window (60 seconds) and the runner broker's wait cap
  (`EXCHANGE_MAX_WAIT_SECONDS` in `lib/runner-kit/broker.mjs`) are matched by a comment only.
  The contract records a 60s wait on each side (`lib/runner-kit/contract.json`), but no test
  reads the limiter's `windowMs` against it, so a change to either can silently break the
  broker's retry budget. A test that reads `windowMs` beside that row would move the match out
  of comments. (Seams & Tangles, 8 Nov.; `docs/reviews/seams-tangles-review-2026-11-08-run10.md`.)
- `lib/proxy-preamble.js`: `applyDefaultDispatchHarness` (the default harness policy) is imported by LLM's
  `lib/model-routing.js` and `lib/model-routing-harnesses.js`, so routing policy sits in an Agent API file and LLM
  depends on it. Its home is the routing side, or a shared leaf both can import. (Seams & Tangles, 10 Nov.;
  `docs/reviews/seams-tangles-review-2026-11-10-run11.md`.)
- `routes/proxy-writes.js`: "no step may change them" (the `## As asked` words) is written twice,
  in `AS_ASKED_LEAD` and in `BRIEF_HINT` (`lib/as-asked.js`); the census pins the markers, not this
  rule. `lib/proxy-instructions.js` also spells "a day" beside `LANDED_MIN_GAP_MS`. Borderline, LOW.
  (Drift & Coherence Review, 10 Nov; `docs/reviews/drift-coherence-review-2026-11-10.md`.)
- `routes/proxy.js`: recommend-and-dispatch's `skipLiveWait` exempts any `followUpTo`, so a
  follow-up into an *ended* session of a different stage proceeds while another stage is live.
  Tightening to "followUpTo is in the live row's lineage" needs a lineage read per hop
  (`lib/dispatch-entrance.js` sets it; the wait and its race entry are in
  `lib/recommendation-live-wait.js`). (LIN-4392 review.)
- `lib/proxy-instructions.js`: the catalog omits the `leftover` row kind, and the hold on an
  implementation build's DONE wake until its leftover row ends (`lib/dispatch-leftover.js`; the
  architecture doc has it). Its `kind` contract, "prompt-template keys plus custom", misses 23
  `DISPATCH_KINDS` and the `ROW_ONLY_KINDS` (`lib/dispatch-fields.js`). (Documentation Review,
  10 Nov.; `docs/reviews/documentation-review-2026-11-10.md`.)
- `lib/proxy-instructions.js`: the guide (`docs/proxy-integration.md`) lacks eight routes the code
  serves (seven `model-routing`, `POST runner/usage/:id`, which the kit's contract also has no row
  for); the catalog lacks three snapshot and prompt routes; the verb-override lists (15 and 13 of 19)
  fall short. No test keeps either list in step. Generate or test them from the catalog: a size of
  move. (Documentation Review, 10 Nov.; `docs/reviews/documentation-review-2026-11-10.md`.)
- `lib/proxy-instructions.js`: the runner poll returns a `halt` key, and never a `target: dash`
  item (`routes/proxy-runner.js` filters on runner targets, `lib/dispatch-targets.js`). Neither
  doc says so. (LIN-3622, Done; Documentation Review, 10 Nov.;
  `docs/reviews/documentation-review-2026-11-10.md`.)
