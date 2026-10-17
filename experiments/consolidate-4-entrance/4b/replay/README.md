# Dispatch entrance replay (#4b)

This replay drives Harbour's four dispatch entrances over HTTP and compares two versions of them. It is independent of Harbour's own tests, and it is the witness for the consolidation ticket (`../ticket-4b.md`). It is adapted from the rung 5c router replay (`experiments/rebuild-rung5c/replay/`): the fakes, scenario generators and edge tier are reused.

The four entrances:
* **S**: `POST /workspace/:urlKey/api/dispatch` (`routes/dispatch.js`)
* **P**: `POST /api/proxy/dispatch` (`routes/proxy-dispatch.js`)
* **R**: `POST /api/proxy/recommend-and-dispatch` (`routes/proxy-dispatch.js`)
* **K**: `POST /api/proxy/autopilot/kickoff` (`routes/proxy-kickoff.js`)

Every other route of the three routers is replayed too. Those routes live in the same files, which the PR will edit.

It never writes to `/home/user/LinearViewer`, opens no non-loopback socket (0 attempts recorded), makes no model call, and never mints a real token or enqueues a real dispatch.

## What changed from the rung 5c tool

* **A side is a full tree, not three route files.** `--old` and `--new` each take a folder holding `routes/`, `lib/` and `server.js`, pinned from one commit by `pin-side.mjs`. Each side loads its **own** `lib/`, as a private instance tagged `?side=old` or `?side=new` (`lib/hooks.mjs`). So a new or changed `lib/dispatch-entrance.js`, or any other lib file the PR touches, is replayed with its own side. There is no shared `--lib`.
* **Body bytes, key order included** (kind `bodyBytes`). A deep-equal JSON body in a different key order differs here, and in `header-derived:etag`, and nowhere else.
* **Store writes are judged as persisted.** Every `dispatchQueueStore.addItem` argument is also run through the OLD tree's real `DispatchQueueStore.addItem`, with `_id` fixed and the insert captured, and the persisted doc is compared (`lib/common.mjs`, `lib/compare.mjs`).
  * An explicit `key: undefined` or `null` that the store normalises away is therefore not a difference. It is reported as the info group `info:addItem-rawArgs`.
  * Any change to the persisted row is a difference.
  * Unit tests that `deepEqual` the raw item would still see a key-set change, so the ticket asks the worker to keep each verb's argument key set.
* **Explicit-undefined properties.** In dependency and store arguments, a property whose value is `undefined` counts as absent: `{source: undefined}` ≡ `{}`. The raw difference is reported as info. `--strict-undefined` turns this off.
* **At least N generated requests per entrance** (`--entrance-n`, default 3000), on top of `--n` spread over all 37 URL forms (`lib/gen.mjs` `schedule` floors).
* **Entrance-unit coverage.** This is V8 line coverage of the four POST handlers' own lines (their registration spans, found by marker in `lib/prepare.mjs`) plus every line of `lib/dispatch-entrance*.js`. Whole-file coverage is reported as well.
* **Nothing is deleted.** Work trees and reports are kept.

## Run

```sh
# pin each commit into a FRESH folder. pin-side refuses a non-empty folder recorded
# under another SHA, which fixes the replay-kit pin.mjs bug.
node pin-side.mjs /home/user/LinearViewer <base-sha>  ../pin/<base>
node pin-side.mjs /home/user/LinearViewer <merge-sha> ../pin/<merge>

node replay.mjs --old ../pin/<base> --new ../pin/<merge> [--n 6000] [--entrance-n 3000] [--seed 1] \
                [--coverage] [--tiers gen,edge,test] [--only gen:123] [--out reports/x.json] [--quiet]
#   exit 0 = identical, 1 = differences (or an export-surface change), 2 = tool failure

node selfcheck.mjs --base ../pin/<base> --twin ../pin/<base>-b [--seeds 1,7] [--jobs 3]
node capture-tests.mjs --repo ../pin/<base>     # re-record pinned/test-calls.json from that tree's unit tests
```

For the merged #4b PR:
1. Pin the merge's first parent and the merge into fresh folders.
2. Run `replay.mjs --old <parent> --new <merge> --coverage` on seeds 1 and 7.
3. Optionally run `selfcheck.mjs --base <parent> --twin <parent pinned twice>` again.

Re-run `capture-tests.mjs` against the parent first if tests were added since `15191460`. A difference listed in the PR as a fix appears as a group; patch the old side with that fix and re-run to show it is the only one (rung 5c's `fix-a.patch` method).

## Inputs (seed 1, defaults)

| Tier | Requests | What |
|---|---|---|
| `gen` | 16,430 | Seeded, stratified over the 37 URL forms (rung 5c's generator, `lib/gen.mjs`). **Each entrance gets ≥3,000**: S 3,000, P 3,008, R 3,000, K 3,000. Enqueue forms are 60% clean bodies and 40% free-random ones: wrong types, control characters, over-length values, malformed JSON / null / array / text / form / >250 kb bodies, bad ids. They cover every body field; session shapes and the owner verdict; the proxy token, its scope and the `dispatch` grant (`[]`, missing, `take`, a string); every target; abort / cascade / followUpTo shapes; every factory refusal; mint outcomes and coded refusals; presets; the recommend descent outcomes; keepalive timing; limiter blocks |
| `edge` | 3,158 | About 330 targeted cases (rung 5c): every validation 400 in order, every gate on every form, aborts, cascades, follow-up attach/pbt/declared, M1/M2 declared launches and each coded refusal, Harbour OS spawn, the file-pointer pilot, long-poll paths, keepalive-flushed refusals, free-tier and paid LLM arms |
| `test` | 1,489 | Every request the 112 unit-test files that exercise these routers send at `15191460`, captured by `capture-tests.mjs` into `pinned/test-calls.json`: S 295, P 205, R 213, K 138. One file, `flight-companion-kickoff.test.js`, exits non-zero under capture and contributes nothing |

Environment: the clock is frozen and virtual (`lib/vclock.mjs`); TZ=UTC; the managed env (`NODE_ENV`, OpenRouter keys, the ownerless-broker and file-pointer flags) is set per request and scrubbed between requests; `Math.random` and `crypto.randomUUID` are seeded per request; proxy env vars are removed; non-loopback connects are blocked and counted; `fetch` is recorded and refused.

## Compared per request

* Status.
* Body as parsed JSON, deep-compared (`body`).
* Body bytes (`bodyBytes`).
* Every header except date/connection (`header:*`; `header-derived:etag`/`content-length`).
* Store operations, per store and in order (`store:<name>`): queue (as the persisted doc), dispatch tokens, **proxy tokens (`createToken` / `mintGrantBootstrap` arguments)**, presets, prefs, halt, task mode, free tier, accounts, and the audit event store.
* Dependency calls in order (`depCalls`): the owner seam, `resolveProviderAccess`, `getWorkspaceOpenRouterKey`, **provider methods**, `resolvePromptIssueContext`, `computeRecommendation`, `denyIfUnsupported`, the refusal relay, hang-ups.
* `logEvent` (`logEvent`, `credentialRegistry`).
* Console lines.
* fs and tty (the Harbour OS staging file and the OSC payload).
* Unhandled rejections and errors reaching the final error handler.
* What the server attempted after a client hang-up.

## Self-check (`reports/selfcheck.log`, `reports/selfcheck.json`, 8 min, 3 jobs)

| Check | Result |
|---|---|
| identity, seed 1 (`pin/15191460` vs `pin/15191460-b`, all tiers) | 21,077 requests, **0 differing**, exports identical, 155 s |
| identity, seed 7 | 21,077 requests, **0 differing** |
| `s-gate`: S drops the LIN-3383 owner gate | caught on S only: status ×180, body, store writes, token stores, … |
| `s-reply`: S 201 `item` drops `kind` | caught on S only: body + bodyBytes ×869 |
| `s-store-arg`: S stamps `queueIfBusy: false` | caught: store:dispatchQueueStore ×24 |
| `s-mint-label`: S launch attach label changed | caught: store:proxyTokenStore ×144 |
| `p-gate`: P drops the dangling-referent guard | caught on P only: depCalls ×320, status ×14, … |
| `p-reply`: P 201 drops `cascade` | caught: body + bodyBytes ×559 |
| `p-log`: P cascade audit 201 → 200 | caught: logEvent + proxyEventStore ×47 |
| `r-gate`: R drops the `fetchRecommendationContext` gate | caught on R only: depCalls ×1,253, status ×10, … |
| `r-reply`: override arm drops `override: true` | caught: body + bodyBytes ×296 |
| `shared-relay`: the shared relay's 503 → 502 | caught on **both** P (×76) and R (×68), nowhere else |
| `k-gate`: K drops the store-missing 503 | caught on K only: status ×35, … |
| `k-reply`: K 201 drops `mode` | caught: body + bodyBytes ×345 |
| `k-keyorder`: K 201 `id`/`sessionId` swapped (deep-equal JSON) | caught **only** as bodyBytes + etag ×345; `body` did not differ |
| `k-order`: K checks target before goal | caught: body ×3 (first-failure order) |
| `eq-dispatchedAt`: equivalent rewrite (same bytes) | 0 differences, as expected |
| `r-grant`, `k-grant`: `requireGrant('dispatch')` dropped from the R / K registration (`reports/selfcheck-grant.log`, run with `--skip-identity --mutants r-grant,k-grant`) | caught on R only (store:dispatchQueueStore ×35) and on K only (×29): a token lacking `dispatch`, with a valid issue, reaches `addItem`. The #4a proxy-grant sweep's "reaches no sink" checks cannot show this for R and K (their fixtures 404 first) |

Entrance-unit line coverage on both seeds is **99.67% (913/916)**. The 3 uncovered lines are `routes/proxy-dispatch.js:935-937`, the override arm's `!generated` 500. It cannot be reached over HTTP: `hasPrompt(kind)` 400s earlier for any kind `generatePrompt` cannot render (rung 5c records the same). Whole-file coverage: `routes/dispatch.js` 99.43%, `routes/proxy-dispatch.js` 99.65%, `routes/proxy-kickoff.js` 100%, `lib/dispatch-entrance.js` 100%.

## Limits

* **The deps are models.** The proxy closures are transcriptions of `routes/proxy.js` at `1f8010a0`, unchanged since (`git log 1f8010a0..15191460 -- routes/proxy.js server.js` is empty). A PR that changes what `proxy.js` or `server.js` passes, or the factory signatures, is not replayed. The C pins forbid both.
* **Sequential requests only.** One real difference can cascade through the per-app duplicate-guard memory, so look at the earliest id in a group.
* **The store projection uses the old tree's `addItem`.** A PR that changes `lib/dispatch-store.js` itself is judged by the old store's rules (out of scope for #4b).
* **The unit-test tier replays request shapes into a clean world.** It is not the tests' own assertions; run the unit suite for those.
