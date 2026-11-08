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
