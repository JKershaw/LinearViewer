# Agent API (proxy)

Area notes for `agent-api` in the registry. Format and rules: README.md.

## Lessons

- `proxyLimiter` runs before `authenticateProxyToken` on purpose, so its key may trust a
  bearer only after auth has proved it (`provenCredentials` in `routes/proxy.js`). A key
  built from an unverified bearer gives every junk bearer a fresh bucket and lets floods
  reach the token store (LIN-4378). The limiters skip under `NODE_ENV=test`, so a limiter
  test drives the real route chain with it flipped off, as
  `tests/unit/lin-4378-proxy-limiter-per-credential.test.js` does.
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
- `routes/proxy-compute.js`: the recap/brief GET and POST handlers each repeat the same
  error-mapping chain (not found, the `truncationFailureOf` arm, OpenRouter, fallback), and
  match provider errors by an "OpenRouter" substring in the message. "Whole or loud" has no
  one owner at the edges: one helper beside `failureOf`, keyed on an error code, would hold
  it. (Review, 8 Nov, on LIN-4358; area reads CG/CH, 8 Nov.)
- `routes/proxy.js`: `hashCredential` (proxyLimiter's key) is a second sha256-of-a-token
  helper beside `ProxyTokenStore._hashToken`, itself one of three copies (dispatch and
  feedback tokens too). One exported token hash. (Area reads CE/CF, LIN-4378.)
- `lib/proxy-instructions.js`: the rate-limit rule (60/min per token; on a 429 wait
  `Retry-After`) is restated in about eight places: here three times, both kickoff prompts,
  and three docs. One sentence, quoted from one place. (Area reads CE/CF, LIN-4378.)
- `routes/proxy.js`: the `proxyLimiter` window (60 seconds) and the runner broker's wait cap
  (`EXCHANGE_MAX_WAIT_SECONDS` in `lib/runner-kit/broker.mjs`) are matched by a comment only.
  No test pins one against the other, so a change to either can silently break the broker's
  retry budget. A test that reads the limiter's `windowMs` beside the contract's exchange cap row (`lib/runner-kit/contract.json`) would move the match out of comments. (Seams &
  Tangles, 8 Nov.) `docs/reviews/seams-tangles-review-2026-11-08-run10.md`
- `lib/proxy-preamble.js`: `applyDefaultDispatchHarness` (the default harness policy) is imported by LLM's
  `lib/model-routing.js` and `lib/model-routing-harnesses.js`, so routing policy sits in an Agent API file and LLM
  depends on it. Its home is the routing side, or a shared leaf both can import. (Seams & Tangles, 10 Nov.)
  `docs/reviews/seams-tangles-review-2026-11-10-run11.md`
- `routes/proxy-writes.js`: "no step may change them" (the `## As asked` words) is written twice,
  in `AS_ASKED_LEAD` and in `BRIEF_HINT` (`lib/as-asked.js`); the census pins the markers, not this
  rule. `lib/proxy-instructions.js` also spells the look-first sequence by hand, though
  `lib/recommendation-look-first.js` holds `LOOK_FIRST_STEPS`, and "a day" beside
  `LANDED_MIN_GAP_MS`. Borderline, LOW. (Drift & Coherence Review, 10 Nov;
  `docs/reviews/drift-coherence-review-2026-11-10.md`.)
