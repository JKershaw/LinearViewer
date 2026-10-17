TITLE: Dispatch entrance: turn the source-text pins on routes/dispatch.js, routes/proxy-dispatch.js and routes/proxy-kickoff.js into behaviour tests, so the three entrances can share one authority (tests only)

PARENT: LIN-3549 · PROJECT: Quality, Periodicals & Measurement · PRIORITY: High · STATE: Todo

**Goal.** No unit test fails because entrance code moves between `routes/dispatch.js`, `routes/proxy-dispatch.js`, `routes/proxy-kickoff.js` and `lib/dispatch-entrance.js`, called together **E** below. Every property those tests guard stays guarded, by tests that call the routes. No production behaviour changes.

**Why.**
* LIN-3592 (PR #1906) rebuilt the three routers design-first. 86% of its new lines were verbatim old lines (`docs/papers/harbour/rebuild-round.md:88-93`).
* The reason is in the code. `lib/dispatch-entrance.js:10-12` says each entrance keeps its own "reads, enqueue calls, credential mints, gates and replies, because the source-text censuses pin them by the route they sit in."
* LIN-3592's ticket called none of those pins convertible (`experiments/rebuild-rung5c/ticket-dispatch-entrance.md:38`). They are keyed by file and by the nearest `router.<verb>(` line, often on exact text and indentation. Examples:
  * `lin-3383-runner-enqueue-census.test.js:87-153` keys each runner-state write to its registration;
  * `lin-3134-declared-mint-census.test.js:460-485` keys each credential mint to `file | construct [kind] | arm | fn`;
  * `passage-runner-contract-drift.test.js:95-131` slices `routes/proxy-dispatch.js` between anchor strings.
* A read-only check at d349e78c found:
  * 35 unit-test files read E as text;
  * 63 pins in 18 of them key on its location;
  * the move probe (described below) fails 37 tests in 11 files.
* Rung 4 (LIN-3573, PR #1899) converted 4 such pins into behaviour tests, each shown failing with its guard removed (`experiments/rebuild-exp2/NOTES.md:399`).
* This ticket does the same for the entrance. The next ticket can then consolidate the three entrances into one authority that all three call, with no per-route copies.

**Decision.**

**This is one PR. Don't split it into child tickets.**

**Order, for every security pin, no exceptions.**
1. Land the replacement (behaviour test or sweep) while the old pin is still unchanged and green.
2. In a scratch copy outside the repository, remove or negate the guard. Show that the replacement fails, then restore it and show that it passes. Paste both runs into the PR.
3. Only then, in a later commit of the same PR, loosen, re-target or delete the old pin.

Any commit that turns a count inside E into "at least one", or deletes a census row, comes after the commit that adds the sweep replacing that count. The PR shows that sweep failing on an unlisted route planted in a scratch copy of the router:
* an ungated runner-state write, for the session-owner sweep;
* a POST without `requireGrant('dispatch')` that calls `createDispatchItem`, for the proxy-grant sweep;
* a read route that returns a raw row, for the canary sweep.

If a replacement can't be shown failing, the old pin stays exactly as it is. The PR records this order, commit by commit.

* **Starting list.** Verify it; don't trust it. Test line numbers are at d349e78c. Record any pin you add, drop or reclassify, with the reason.
  * **(A), 26:**
    * `lin-3383-runner-enqueue-census` :355, :360, :437, :455
    * `lin-3384-redaction-census` :223
    * `lin-3134-declared-mint-census` :549, :558, :564, :569, :575, :580, :586, :595, :726, :730, :735, :740, :746
    * `lin-3136-enqueue-census` :59, :63
    * `proxy-credential-fingerprint-stamping` :214 (E part only)
    * `passage-runner-contract-drift` :95, :123
    * `lin-3134-default-path-characterization` :556
    * `lin-3137-dispatch-token-preservation` :130
    * `lin-3124-pr3-checkpoint-c2` :100
  * **(B), 20:**
    * `lin-3384-redaction-census` :166, :175, :196
    * `lin-3383-runner-enqueue-census` :333
    * `lin-3134-declared-mint-census` :105, :110, :115, :131, :530, :609, :613, :635, :751, :793
    * `lin-3130-create-dispatch-item-proxy-token-store-pin` :145 (E part)
    * `run-limit-gating` :234 (E part)
    * `proxy-credential-fingerprint-stamping` :103, :117 (E part)
    * `proxy-scopes-source-pin` :59 (the `routes/dispatch.js` row)
    * `lin-2534-tokens-admin-extraction` :112
  * **(C), 17:**
    * `lin-3384` :170, :186
    * `lin-3383` :499
    * `lin-3134` :141, :790, :829
    * `lin-3136-dispatch-gate` :168 (×3), :180
    * `proxy-tokens-private-mint-source-pin` :127
    * `proxy-credential-fingerprint-stamping` :221
    * `proxy-endpoint-inventory-witness` :608
    * `proxy-di-witness` :146, :222
    * `lin-2533-agent-status-extraction` :97, :101
  * **Whole-tree scans, left alone:** `connection-access-guard`, `docs-architecture-anchor-resolver`, `email-import-boundary`, `interactive-openrouter-chain-byte-identity`, `lin-3124-pr1-count-pins`, `lin-3124-pr2-credential-census`, `lin-3124-selector-body-hashes`, the four `lin-3125-*` readers (`held-entry`, `persist-held`, `phase0-complete-installation`, `phase1-held-entry`), `lin-3136-copy-surface-census`, `lin-3382-urlkey-class-guard`, `lin-688-undici-not-a-dependency`, `secret-scan`, `urlkey-holders`, `task-page-links`. `import-graph.test.js` reads only inline fixtures, so it is not a pin.
  * **Re-derive the reader set.** Use an `--import` preload that logs test-side `readFileSync`/`readFile`/`readdir` calls on the four E paths during one full unit run. Normalise paths first: `run-limit-gating.test.js:231-236` reads `routes//dispatch.js`.
* **Classes.**
  * **(A) Convert.**
    * The replacement calls the route with fakes and spies, through one of:
      * `createDispatchRoutes` from `routes/dispatch.js` (session);
      * `createDispatchRoutes` from `routes/proxy-dispatch.js` (proxy);
      * `createKickoffRoutes`;
      * the composer via `buildApp` in `tests/unit/lib/proxy-fake-deps.js`.

      It asserts the property: status, body, and which store or minter calls happened or never happened.
    * Where the replacement goes:
      * A replacement for a single route goes in place, under the old test name.
      * A sweep may live in a new file. The old test then becomes a one-line pointer to it, or is removed.
      * Where an existing behaviour test already covers the property, show that test failing under the old pin's mutation, then remove the pin and leave a comment naming the covering test. Examples: `lin-3383-owner-only-entries.test.js:87`, `lin-3398-session-runner-gates.test.js:96-195`, `lin-3134-followup-sites.test.js:487-590`, `lin-3135-broker-refire-declared.test.js:306-620`.
      * List every removed or pointed test name in the PR.
  * **(B) Loosen.**
    * Keep the census, but treat E as one unit, so a call may sit in any of the four files.
    * Inside E, assert at least one call of each kind, not an exact number, so the census doesn't fix 5c's structure. The only exception is the declared-writer allow-list (`declaredGrants: ['dispatch'],` at `routes/proxy-kickoff.js:378` and `routes/dispatch.js:832`): E holds exactly 2.
    * A loosened census still fails on an unlisted sink or reader **kind** in E.
    * Keep every location-free shape check on every E call:
      * `proxyTokenStore` as a direct key;
      * inline, spread-free `fields`;
      * follow-ups mint only through `provisionResumeCredential`;
      * no `mintGrantBootstrap(`, `grantDeclaration`, `grantRefusal` or `.addItem(`.
  * **Mixed pins, for (A) and (B).** Some tests pin E and non-E sites together:
    * `proxy-credential-fingerprint-stamping` :117 and :214;
    * `lin-3130…` :145;
    * `run-limit-gating` :234;
    * `lin-3136-enqueue-census` :59 and :69.

    Convert or loosen only the E part. Every non-E assertion stays byte for byte in the same test, exactly as strong as today. That includes the 7 `routes/proxy-compute.js` sites, the 0 in `routes/proxy.js`, the 5 non-E `createDispatchItem` calls and `routes/workspace-api.js`.
  * **(C) Keep.**
    * Whole-tree absence scans, and the registration-level pins. Examples of the latter: `lin-3136-dispatch-gate.test.js:165-187` on the lines at `routes/proxy-dispatch.js:411, :766` and `routes/proxy-kickoff.js:206`; `proxy-endpoint-inventory-witness.test.js:608`; `proxy-di-witness.test.js:146, :222`.
    * List in the PR what these require of the next ticket: registrations, middleware chains, factory signatures and module-scope limiters stay in the three route files.
* **Exhaustiveness moves to sweeps.** The censuses' counts were what caught a new, unaudited site inside E. Replace that with three route sweeps.
  * **Enumeration rules (LIN-2505, which moved tests off `router.stack` introspection):**
    * Use `router.stack` (express 4.22.1) only to list routes, never to pull a handler. Drive every request over HTTP.
    * Descend into nested routers (`layer.handle.stack`). The proxy composer mounts each group with `router.use(createXRoutes(…))` (`routes/proxy.js:1275-1609`).
    * Fail on any layer the sweep cannot classify.
    * Each sweep asserts how many routes it enumerated: 26, 6 and 4 for the three routers at d349e78c, and for the composer the count `proxy-endpoint-inventory-witness` derives. Enumerating fewer fails the sweep.
  * **Redaction canary (LIN-3384).**
    * Build the canary at runtime as an HB-prefixed 43-character string. Never write a token-shaped literal in a test: the `harbour-bootstrap-token` rule (`lib/secret-scan.js:233-236`) is part of `secret-scan`, which `ci-success` needs (`.github/workflows/test.yml:139`).
    * Store it as each fake row's `bootstrapToken`, and embed it in the prompt as `Authorization: Bearer <canary>`, the shape `maskBootstrapTokens` masks.
    * Drive every read as a non-owner session and as another account's proxy token. The `bootstrapToken` field must be null or absent on every session read, owner included (`lib/dispatch-session-redaction.js:56`).
    * The canary must appear in no non-owner session response and no other-account proxy response. The exceptions are `GET /api/dispatch/poll` and `POST /api/dispatch/take/:itemId` (`routes/dispatch.js:1634`, `:1866`), which must carry it.
    * Today the owner's own prompt comes back unmasked (`lib/dispatch-session-redaction.js:63-65`): in the session list and history, and from `GET /api/proxy/dispatch/:id/prompt` with the dispatcher's own token (`lin-3384-bootstrap-token-redaction.test.js:158`, `:266`). The sweep lists these as explicit exceptions; they are not failures.
    * The sweep must pass on today's code. In a scratch copy, show it failing with the mask removed: `maskBootstrapTokens` skipped in `redactSessionItem`, or `redactSessionItems` dropped at `routes/dispatch.js:1088`.
  * **Proxy grant (LIN-3136).** Call every write route of the composer with a `readWrite` token lacking `dispatch`, and with a `read` token. None reaches `addItem` or `expandCascadeAborts`. The three enqueue mounts answer 403 `DISPATCH_GRANT_REQUIRED` to the `readWrite` token.
  * **Session owner (LIN-3383, LIN-3398, LIN-3408).** Call every session route as a non-owner, on a runner target. It reaches no runner-state write, except where the sweep's own table marks the route member-reachable. The table has one row per enumerated route, each with a reason; an enumerated route without a row fails. Verdicts:
    * owner-gated;
    * member-reachable (the dash and local rows, `lin-3398-session-runner-gates.test.js:146-152`);
    * dispatch-token;
    * feedback-token;
    * read-only.

  The two-lane split is why the per-file verdicts in `lin-3383` and `lin-3384` must move into behaviour: after consolidation one sink serves both a gated session lane and a token-scoped proxy lane.
* **Shown failing, recorded in the PR.**
  * For each A conversion: in a scratch copy outside the repository, delete or negate the guarded production line(s). Run the replacement and see it fail; restore and see it pass. Paste the command and the failing assertion line into the PR.
  * For each B loosening: plant the violation in `lib/dispatch-entrance.js` text inside the scanner's synthetic copy, and show it fails.
  * Mutations of the old pins' witnesses must fail their replacements too. Example: `lin-3383-runner-enqueue-census.test.js:355` negates the gate at `routes/dispatch.js:510`.
  * Count-drift witnesses that plant inside E (`lin-3384` :196, `lin-3134` :740) can't be met by behaviour. `lin-3383` :407 and :494 plant into `routes/collective.js` and `routes/proxy-halt.js`, outside E, so they stay as they are. Re-target each witness inside E to two plants:
    * an unlisted route in E, which must fail the matching sweep;
    * a new reader or sink kind in E, which must fail the B census.

    List each re-targeted witness in the PR, with the plant used.
  * A replacement that stays green with its guard removed is a mis-targeted test. Fix it.
* **Never weaken a security guard.** These are:
  * runner-owner gates (`routes/dispatch.js:406, :510, :1290, :1313, :1345, :1393, :1502`);
  * the dispatch grant (LIN-3136);
  * declared and resume mints, and the refire broker (`routes/dispatch.js:767-833, :1708-1859`; LIN-3134, LIN-3135);
  * the owner-only dispatch-token mint (`routes/dispatch.js:1425-1472`; LIN-3137);
  * token redaction (LIN-3384);
  * the scope constant (`routes/dispatch.js:46, :1844`; LIN-3129);
  * the session-scoped credential read (`routes/dispatch.js:742`; LIN-3124 D16);
  * the `!accessToken` guard (`routes/proxy-kickoff.js:246`, `routes/proxy-dispatch.js:866`; LIN-1980).

  Each must end up guarded at least as strongly: the replacement fails on every mutation the old pin's witnesses used, apart from the re-targeted count-drift witnesses above. Where behaviour can't express the property, keep it as B, never drop it. `'readWrite'` and `READ_WRITE` are the same value, so the scope-constant pin stays B.
* **Gaps to close while converting** (no behaviour test covers these today):
  * **The mint chain's order.** A non-owner never reaches `dispatchTokenStore.createToken`, and the limiter runs before `workspaceFromUrl`.
    * The limiter's `skip` is read per request (`routes/dispatch.js:120`), but `tokenCreationLimiter` is module-scope (`:113`), so its memory store is shared across the test process.
    * Run the limiter case in its own test file, from fresh process state, with exactly five prior POSTs and `NODE_ENV=production` for those requests. Restore `NODE_ENV` in a `finally`.
  * **No token.** Kickoff and both recommend-and-dispatch arms answer 503 and call nothing further when `resolveProviderAccess` returns no token.
  * **List key set.** The exact key set of `GET /api/proxy/dispatch` items (`routes/proxy-dispatch.js:1524`), using a row that also carries `bootstrapToken`, `prompt`, `grantDeclaration`, `grantRefusal` and an unknown key.
  * **Watch key set.** `formatDispatchWatch` (`:197`) spreads `closedProjection(item.bookkeeping)` (`:243`) and adds `feedback` conditionally, so its key set depends on the row. Pin the exact key set for one fixed queued fixture row as a literal, and assert that `sessionId` is present and none of those fields leak.
* **`tests/unit/lin-3134-default-path-characterization.test.js`.** Its header (:1-33) says the file stays unedited through the rest of T2-i and T2-ii, and that it is additive only. That was for LIN-3134 T2-i and T2-ii (LIN-3138, LIN-3139), both merged. This ticket allows replacing its :556 source assertion only. Add one header line naming this ticket's ID and saying that only the :556 source assertion was replaced. Leave every golden literal unchanged.
* **No production behaviour change.** `git diff --stat` against the base touches only `tests/` and `docs/architecture/dispatch-and-proxy.md`.
  * In that doc, update exactly lines 30-31. They say the runner-enqueue census "fails on any unlisted sink"; after this ticket the census fails on an unlisted sink kind, and the session-owner sweep catches an unlisted route.
  * If a route seems untestable without a production edit, raise a `DECISION:` and stop. Don't add a seam.
* **Keep the reasons.** In every edited test, keep every ticket reference and reason comment beside the assertion it explains, and move them with the assertion. Drop one only if its assertion is gone, and list those in the PR.
* **Check the result with the move probe.** The probe is text-only, built in a scratch copy outside the repository.
  * An `--import` preload intercepts test-side `readFileSync`/`readFile` calls on the four E paths, after normalising them (`routes//dispatch.js` included). It serves a moved text instead; module imports keep loading the real code.
  * In the moved text, each of the three routers keeps only:
    * its import declarations;
    * its module-scope `rateLimit` declarations;
    * its factory signature, opened with `const router = Router();`;
    * every `router.<verb>(` registration with its path and middleware, the handler replaced by `async (req, res) => { return entrance.handle(req, res); }`;
    * `return router;`.
  * Every other line is appended to `lib/dispatch-entrance.js`'s text, with `router.<verb>(` renamed `handlers.<verb>(` and the factories renamed so nothing is exported twice.
  * Run the 35 reader files under the preload. Show that no A or B pin fails, and list any C pin that does.
* **Tests.**
  * Any server binds `127.0.0.1` (LIN-2023).
  * Before opening the PR, run `npm run test:hermetic` once and `npm run secret-scan` once. The hermetic run is the full unit suite plus the socket check, so it is the one full run.
* Don't start parallel forks or background sub-agents; do the parts one at a time. While iterating, run the unit tests for the files you change; run the full unit suite once before opening the PR. Leave e2e to CI; run it locally only to reproduce a CI failure.
* No live checks; no paid model calls.

**Done when.** Merged as normal. The PR lists each pin with its class, and gives the failing-then-passing evidence for each conversion.

**Out of scope.**
* Changing the routes' code or structure (that's the next ticket).
* Root `lib/` (helpers under `tests/unit/lib/` may change), `server.js`, `routes/proxy.js`.
* e2e specs.
* Any doc other than `docs/architecture/dispatch-and-proxy.md:30-31`, including `docs/architecture/source-map.md`; and `scripts/code-shape/areas.json`.

**References.**
* LIN-3592 (the rebuild whose pins this frees);
* LIN-3573 (rung 4's four conversions);
* LIN-2505 (HTTP over `router.stack` introspection);
* the guarded tickets: LIN-3383, LIN-3384, LIN-3398, LIN-3408, LIN-3409, LIN-3134, LIN-3135, LIN-3136, LIN-3137, LIN-3138, LIN-3139, LIN-3129, LIN-3130, LIN-3124, LIN-1980, LIN-2044, LIN-3238, LIN-1870, LIN-2975, LIN-2534;
* the parent, LIN-3549.
