# Agent API (proxy)

Area notes for `agent-api` in the registry. Format and rules: README.md.

## Lessons

- `proxyLimiter` runs before `authenticateProxyToken` on purpose, so its key may trust a
  bearer only after auth has proved it (`provenCredentials` in `routes/proxy.js`). A key
  built from an unverified bearer gives every junk bearer a fresh bucket and lets floods
  reach the token store (LIN-4378). The limiters skip under `NODE_ENV=test`, so a limiter
  test drives the real route chain with it flipped off, as
  `tests/unit/lin-4378-proxy-limiter-per-credential.test.js` does.

## Waiting

- `routes/proxy-rulings.js`: writes its own live-run predicate (`liveDispatchOnAnchor`
  over `isTerminalLoop`) instead of `liveOnAnchor` from `lib/live-anchor.js`, and its own
  comment names an earlier incident from that class. One live-run predicate. (Survey
  tally: LIN-4143.)
- `routes/proxy-compute.js`: the recap/brief GET and POST handlers each repeat the same
  error-mapping chain (not found, `OUTPUT_TRUNCATED`, OpenRouter, fallback). One helper
  beside `failureOf` would hold it. (Review, 8 Nov, on LIN-4358.)
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
