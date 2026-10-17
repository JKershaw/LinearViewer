# #4c independent replay: the dispatch-entrance authority, old against new

This is #4b's replay (`../b/replay/`, see its README), copied unchanged into `replay/` and re-checked on the new base.
Two things changed:
* the self-check's mutants now target `47d87055`;
* there is a new direct-call class for the authority's exports.

It drives the four entrances over HTTP (S `POST /workspace/:urlKey/api/dispatch`, P `POST /api/proxy/dispatch`, R
`POST /api/proxy/recommend-and-dispatch`, K `POST /api/proxy/autopilot/kickoff`) plus every other route of the three
routers. Each side loads its own `lib/`, so a rebuilt `lib/dispatch-entrance.js`, a new `lib/dispatch-entrance-*.js`
helper, or a touched `lib/dispatch-validation.js` is replayed with its own side.

It compares, per request:
* status;
* the parsed body, and the body bytes with key order included;
* headers, including the etag and content-length derived from the body;
* every store operation, with the queue judged as the persisted doc;
* the token stores' `createToken` and `mintGrantBootstrap` arguments;
* dependency calls in order;
* `logEvent`;
* console;
* fs and tty;
* errors and unhandled rejections;
* what happened after a hang-up.

It never writes to `/home/user/LinearViewer`. It blocks and counts non-loopback sockets (0 seen), makes no model call,
and mints no real token.

## What changed for #4c

* **`replay/selfcheck.mjs` mutants re-targeted at `47d87055`.** #4b's mutants anchored on the `15191460` route files,
  where the code no longer is. The same planted changes now anchor on `lib/dispatch-entrance.js`; the two grant
  mutants still anchor on the route registrations. Three are new:
  * `m-declare`: K's M1 launch mints without the grant declaration.
  * `gate-to-prompt`: lin-3134's text-only "mutation 1", the follow-up gate rewritten to `if (prompt)`.
  * `eq-fields-row`: an EQUIVALENT rewrite, `fields: row` in place of the inline 22-key literal.

  `replay/check-anchors.mjs <tree>` prints each anchor's count in a tree; every count must be 1.
* **`replay/direct.mjs`, the direct-call class.** No HTTP request reaches `enterSessionDispatch` without the route's
  owner gate, so the HTTP tiers cannot see whether the authority fails closed. `direct.mjs` imports each side's
  `lib/dispatch-entrance.js` (its own module instance, through the same side-tagging hook) and calls
  `enterSessionDispatch` 600 times. Each call uses one of nine gate shapes:
  * absent, `null`, `true`, a string or an object;
  * a gate that refuses, one that passes, one that throws, one that rejects;
  * crossed with seeded bodies: shape failures before the gate, failures after it, cascades, issue-naming bodies,
    follow-ups and a `null` body.

  Per case it compares whether the call threw (and the message), every dependency call in order with its arguments,
  each gate call and the target it got, headers, console output and what was answered. It also compares the module's
  export surface (names, `typeof`, arity), and checks fail-closed on each side on its own: a non-function gate must
  throw with nothing read, written or answered. `replay/direct-selfcheck.sh <tree>` plants four mutants (the
  fail-closed check removed, the gate moved after the body checks, the gate's target default dropped, the gate's
  verdict ignored).
* **Test tier re-captured at `47d87055`** (`replay/pinned/test-calls.json`, 1,501 calls from 112 test files; the
  `15191460` capture is kept as `test-calls-15191460.json`). `flight-companion-kickoff.test.js` still exits non-zero
  under capture and contributes nothing, as at `15191460`.

## Self-check on the new base (all pass)

`replay/reports/selfcheck-47d87055.log` / `.json`: 8 min 9 s, 3 jobs. Base `pin/47d87055`; twin `pin/47d87055-b`, an
independent `pin-side.mjs` pin of the same SHA. `pin-side.mjs` refused to re-pin `pin/47d87055-b` under `15191460`
(exit 2), as designed.

| Check | Result |
|---|---|
| identity, seed 1 (all tiers) | 21,077 requests (gen 16,430, edge 3,158, test 1,489), **0 differing**, exports identical |
| identity, seed 7 | 21,077 requests, **0 differing** |
| identity, seed 1, test tier re-captured at `47d87055` (`reports/identity-47d87055-seed1-tests47d.log`) | 21,089 requests (test 1,501): S 4,020, P 3,547, R 3,819, K 3,450; **0 differing**; 125 s |
| `s-gate`: the owner-gate call removed | caught on S only (depCalls ×1,481, status ×180, store writes, token stores) |
| `s-reply`, `s-store-arg`, `s-mint-label` | caught on S only: body + bytes ×869; queue store ×24; proxy token store ×200 |
| `p-gate`, `p-reply` | caught on P only: depCalls ×320, status ×14; body + bytes ×559 |
| `p-log`: the shared cascade expansion audits 201 as 200 | caught on P only (×47). S shares the method but has no audit log |
| `r-gate`, `r-reply` | caught on R only: depCalls ×1,253; body + bytes ×296 |
| `shared-relay`: the shared attach-failed 503 → 502 | caught on **P (×76), R (×68) and K (×70)**, nowhere else. At #4b it reached only P and R; K now shares the branch |
| `k-gate`, `k-reply`, `k-order` | caught on K only: status ×35; body + bytes ×345; first-failure order ×3 |
| `k-keyorder`: K's 201 `id`/`sessionId` swapped | caught **only** as bytes + etag ×345; parsed `body` did not differ |
| `r-grant`, `k-grant`: `requireGrant('dispatch')` dropped | caught on R only (queue store ×35) and K only (×29) |
| `m-declare` (new) | caught on K only: proxy token store ×582 |
| `eq-dispatchedAt`, `eq-fields-row` (new): equivalent rewrites | 0 differences, as expected. `fields: row` is behaviour-neutral, so lin-3134's inline-`fields` rule (constraints A3) is a text pin |
| `gate-to-prompt` (new, `reports/selfcheck-gate-to-prompt.log`) | caught on **K (token store ×582, queue ×553, status ×246) and S (token store ×151, status ×59)**. Lin-3134's census records this mutation as invisible to behaviour (`lin-3134-declared-mint-census.test.js:693-699`). With one shared `finalizePrompt` it now reaches the declared launches, so constraints A1/A2 have a behaviour witness |
| direct class, identity seeds 1 and 7 (`reports/direct-identity-seed{1,7}.json`) | 600 cases each, **0 differing**, exports identical, fail-closed holds on both sides |
| direct mutants (`reports/direct-selfcheck.log`) | `fail-open` 332 differing, and fail-closed reported FAILS on the new side; `gate-late` 70; `gate-target` 26; `gate-ignored` 39. All four caught |

Entrance-unit line coverage on both seeds is **99.47% (941/946)**. Uncovered:
* `lib/dispatch-entrance.js:970-971`: the fail-closed throw. No HTTP request can reach it; the direct class covers it.
* `:1284-1286`: the override arm's `!generated` 500, unreachable over HTTP as at #4b, because `hasPrompt(kind)` 400s
  first.

Whole-file coverage: `routes/dispatch.js` 99.23%, `routes/proxy-dispatch.js` 100%, `routes/proxy-kickoff.js` 100%,
`lib/dispatch-entrance.js` 99.43%.

## How to score the merged #4c PR

Old is the merge's **first parent**; new is the merge.

```sh
R=<scratch>/dl4/c
cd $R/replay
unset $(env | grep -o '^OPENROUTER[A-Z_]*')          # the replay deletes them too; capture-tests passes env through
M=<merge sha>; P=$(git -C /home/user/LinearViewer rev-parse $M^1)
git -C /home/user/LinearViewer fetch -q origin main

# 1. pin both sides into FRESH folders (pin-side refuses a folder pinned under another SHA)
node pin-side.mjs /home/user/LinearViewer $P $R/pin/${P:0:8}
node pin-side.mjs /home/user/LinearViewer $M $R/pin/${M:0:8}

# 2. if the parent is not 47d87055, check the self-check anchors still hold there, and re-capture the test tier
node check-anchors.mjs $R/pin/${P:0:8}          # each must print 1; adapt an anchor that moved
node capture-tests.mjs --repo $R/pin/${P:0:8} --jobs 3

# 3. the HTTP replay, two seeds, with coverage (exit 0 = identical, 1 = differences or an export change, 2 = tool failure)
node replay.mjs --old $R/pin/${P:0:8} --new $R/pin/${M:0:8} --coverage --seed 1 --out reports/score-seed1.json
node replay.mjs --old $R/pin/${P:0:8} --new $R/pin/${M:0:8} --coverage --seed 7 --out reports/score-seed7.json

# 4. the direct-call class, two seeds (exit 0 = identical and fail-closed holds on the new side)
node direct.mjs --old $R/pin/${P:0:8} --new $R/pin/${M:0:8} --seed 1 --out reports/score-direct-seed1.json
node direct.mjs --old $R/pin/${P:0:8} --new $R/pin/${M:0:8} --seed 7 --out reports/score-direct-seed7.json
```

Expected: 0 differing on every tier and in the direct class, exports identical, and entrance-unit coverage at
least 99%. Entrance-unit coverage spans every line of `lib/dispatch-entrance*.js` (so a new helper is included) plus
the four POST registrations. If the PR adds an export, `direct.mjs` reports `exports DIFFER`; the ticket keeps the
eight, so that is a finding.

A difference: look at the earliest id in its group (one real difference can cascade through the duplicate-guard
memory). Then classify it by the ticket's classes. If it is listed in the PR, patch it into the old side and re-run
to show it is the only one (rung 5c's `fix-a.patch` method).

## Limits

* The deps are models, as in #4b: the proxy closures transcribe `routes/proxy.js` at `1f8010a0`, unchanged through
  `47d87055`. A PR that changes what `routes/proxy.js` or `server.js` passes, or the factory signatures, is not
  replayed. The ticket forbids both.
* The store projection uses the old tree's `DispatchQueueStore.addItem`; `lib/dispatch-store.js` is out of the
  ticket's scope.
* The direct class calls only `enterSessionDispatch`. The other three `enter*` exports are reachable only through
  the proxy forwarders, which the HTTP tiers drive. `firstFailure`, `opaqueFieldError`, `refuseWithoutStore` and
  `rejectAudited` are compared by surface only, and exercised through the routes.
* Sequential requests; the unit-test tier replays request shapes into a clean world, not the tests' own assertions.
