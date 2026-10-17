# Experiment 4a score: LIN-3601, PR #1912

* old = `ee9fcba9`, the first parent of the merge. new = `15191460`, merged 10:43:32Z.
* PR branch: `feat/lin-3601-entrance-behaviour-tests`, tip `913ac608`. Fetched with git, and its tree is identical to the merge.
* The PR body is not reachable with git alone, and the brief allowed no other network. So the worker's own pin classification, its mutation-evidence table and any probe it pasted could not be read. Lines that depend on them are marked **unscored**. Everything else below was re-run here.
* Trees exported with `git archive`, with `node_modules` (which includes acorn) symlinked from `/home/user/LinearViewer`.
* Scripts are in `score/tools/`:
  * `mkprobe.mjs` and `probe-preload.mjs`: the move probe, rebuilt.
  * `realmove.mjs`: the real move.
  * `mutate.mjs` and `runmut.sh`: the mutation runs.
* Logs are in `score/mut/logs/`, plus `score/*.tap` and `score/*.fails`.

## 1. Production unchanged

`git diff --stat old new`: 22 files, +2267 / −339.

| What changed | Files |
|---|---|
| New test files | 7 |
| New helper (`tests/unit/lib/entrance-route-sweep.js`) | 1 |
| Edited test files | 13 |
| Docs | `docs/architecture/dispatch-and-proxy.md`, one line (31) rewritten inside the allowed 30-31 |

* No other non-test file changed.
* `diff -r` of `routes/` and `lib/` between the two exported trees is empty.
* **No finding.**

## 2. Move probe

### Text-only probe

I rebuilt it independently:
* `mkprobe.mjs` uses acorn. It keeps imports, the module-scope `rateLimit` declarations, the factory signature, `const router = Router()`, the 26/6/4 registrations with their middleware (handler replaced by `return entrance.handle(req, res)`) and `return router`.
* Everything else is appended to `lib/dispatch-entrance.js`, with `router.` renamed `handlers.`, factories renamed and exports stripped.
* The preload serves those texts only to readers whose first non-preload stack frame is under `tests/`, after path normalisation.
* I ran the whole unit suite under it. A logging variant confirmed the substitution actually happened: 149 reads on old, 156 on new.

| Tree | Suite fails | Of which env-only* | Probe-caused |
|---|---|---|---|
| old | 43 | 6 | **37 tests in 11 files**: the same file:line set as the pre-launch `probe/newly-failing.txt` |
| new | 6 | 6 | **0** |

\* The six env-only failures are `task-page-links`, which needs `git grep` and so fails in any exported tree. They appear identically in both plain runs.

The prediction was "old 37/11, new 0". **Both hold.**

### Real move (the stronger test)

I really moved `POST /api/proxy/recommend-and-dispatch`'s handler (617 lines) out of `routes/proxy-dispatch.js` into `lib/dispatch-entrance.js`:
* It becomes `export function proxyRecommendAndDispatchHandler({22 closure names})`, with 33 imports re-pointed.
* The route keeps its registration and middleware chain.

Results on new:

| How the registration calls the moved handler | Full unit suite |
|---|---|
| `requireGrant('dispatch'), proxyRecommendAndDispatchHandler({...}))`, a handler built by the factory | 1 new failure: `lin-3136-dispatch-gate.test.js:168` (a C pin) |
| `async (req, res) => recommendAndDispatch(req, res))`, an expression-bodied forwarder | Same 1 failure |
| `async (req, res) => {\n return recommendAndDispatch(req, res);\n })`, a block-bodied forwarder | **0 new failures** (17420/17426 pass, the same 6 env-only failures) |

The same moved production files (block-bodied form) dropped into **old** fail **10 tests in 4 files**:
* `lin-3134` :530, :549, :609, :613, :793;
* `lin-3136-enqueue` :59;
* `lin-3383` :333, :499;
* fingerprint :117, :214.

So the "freed" claim holds for a real move, with one constraint: C pin 3136:168 requires the literal registration text `..., requireGrant('dispatch'), async (req, res) => {`. In other words, 4b must keep a block-bodied inline arrow at each of the three enqueue registrations, not just "registrations and middleware".

## 3. Security spot-check

The PR's evidence rows were not readable. I picked the properties from the tests' own headers.

Each mutation was applied to a copy of new. Each named test was run three times: passing before the mutation, failing with it, passing again once restored. All 13 behaved that way.

| # | Property | Mutation | Replacement result |
|---|---|---|---|
| M1 | Owner gate, LIN-3383 | `if (enqueueRefusal) return …` deleted (`dispatch.js:516`) | session-owner sweep: POST row fails, 201 !== 403 |
| M2 | Dispatch grant, LIN-3136 | `requireGrant('dispatch')` dropped from recommend-and-dispatch | proxy-grant sweep: the 403 DISPATCH_GRANT_REQUIRED test fails (404 "Issue not found") |
| M2b | Dispatch grant, LIN-3136 | same, on kickoff | same test, for kickoff, fails |
| M3 | Redaction canary, LIN-3384 | `maskBootstrapTokens` skipped in `redactSessionItem` | canary sweep: 5 fail (list, history, trim leak) |
| M3b | Redaction canary, LIN-3384 | `redactSessionItems` dropped on `/history` | canary sweep: 2 fail |
| M4 | Mint sweep, refire B1 | `refuse('owner-mismatch')` removed | mint sweep: B1 test fails |
| M5 | Owner-only mint, LIN-3137 | `if (ownerRefusal) {…}` block removed | 3 fail: limiter-order, mint-sweep LIN-3137 test, session-owner tokens row |
| M6 | Limiter order | `workspaceFromUrl, tokenCreationLimiter` swapped | limiter-order test fails ("limiter answers before workspaceFromUrl", 6 !== 5) |
| M7 | No token, LIN-1980 | `!accessToken` negated in kickoff | no-token test (kickoff) fails |
| M7b | No token, LIN-1980 | same, in recommend-and-dispatch | both rad arms fail |
| P1 | Planted route | an ungated proxy POST calling `createDispatchItem` | proxy-grant sink sweep fails |
| P2 | Planted route | an ungated session runner-write route | session-owner count/table test fails |
| P3 | Planted route | a raw-row read route | canary sweep fails 3 (count and leak) |

**Weakness found.** Two of the proxy-grant sweep's three enqueue mounts never reach a sink:
* With the sweep's fixtures, recommend-and-dispatch and kickoff stop at issue lookup (404). Only `/api/proxy/dispatch` has a positive control.
* So for M2 and M2b, the "no write route reaches addItem" tests pass vacuously.
* The gate is caught only by the explicit 403 DISPATCH_GRANT_REQUIRED assertions.
* It is not a weakened guard, but half the sweep is blind on those two mounts.

**Order.** On the branch, the first 4 commits (`f6d87b0d`, `37df3209`, `7af9cfb0`, `022d6558`) add only the 7 new files and the helper; the old pins are untouched (verified with `git diff --stat`). The 14 commits after them loosen or retarget the old pins (one each, sometimes two), in that order.

However, all 18 commits fall in 09:55-10:25Z, after about 1h45m of work. The order is recorded, but whether each replacement was shown failing before its pin was loosened, in real time, cannot be checked here.

## 4. Suite on new

`node --test tests/unit/*.test.js scripts/eval/eval-dense.test.mjs scripts/code-shape/seams.test.mjs`:

| Tree | Tests | Pass | Fail | Wall time |
|---|---|---|---|---|
| new | 17426 | 17420 | 6 (env-only `task-page-links`, the same 6 as old) | 156 s |
| old | 17276 | 17270 | 6 | 142 s |

* With acorn present, `seams.test.mjs` passes 8/8. The PR's note that it couldn't import acorn reflects the runner's checkout, not the code.
* `npm run secret-scan` on the new tree passes: 3846 files, 0 found.

## 5. Size and cost

* 22 files, +2267 / −339.
* 7 new test files plus 1 helper; 13 edited test files; 1 doc line.
* New test cases:

  | New file | Tests |
  |---|---|
  | redaction canary sweep | 57 |
  | mint sweep | 35 |
  | session-owner sweep | 28 |
  | proxy-grant sweep | 10 |
  | proxy key sets | 5 |
  | no-token | 3 |
  | limiter-order | 1 |
  | **Total** | **139** |

  The edited files add 11 net. The suite grew by 150.
* Added serial test time is about 13 s: 5.0 s from the new files, plus about 8 s in edited files, mostly `lin-3134-declared-mint-census` going from 7.0 s to 12.1 s.
* Kickoff 08:09Z to merge 10:43:32Z: **2 h 34 m**.
* Branch commits ran 09:55-10:25Z: 18 commits, squash-merged.
* One ruling (the plan-review loop bound), pressed at about 09:44Z.

## 6. Prediction, line by line

| Prediction | Outcome | Score |
|---|---|---|
| Classification within ±6 per class; finds or drops a pin 60% | PR body not readable | unscored |
| 5-8 behaviour groups (N1-N7) | 7 (owner, grant, canary, mint, limiter, no-token, key sets) | hit |
| 30-70 new test cases | 139 in new files (+150 in the suite) | **miss** (about 2x) |
| 1-3 new test files | 7 (+1 helper) | **miss** |
| 12-16 existing test files edited | 13 | hit |
| A sweep enumerates `router.stack`: 75% | yes, list-only, HTTP for every call | hit |
| All sweeps descend and assert 26/6/4 + composer: 55% | Descent yes; 26 asserted in three sweeps; the composer total is matched to a count derived from source. 6 and 4 are not enumerated separately (only a 10-row table that must all be registered). | partial / miss |
| All three sweeps present: 50% (session-owner likeliest dropped) | All present; session-owner has a full 26-row table | hit |
| Production lines 0: 95% | 0 | hit |
| Doc 30-31 updated: 70% | yes | hit |
| Any other non-test file: 5% | no | hit (favoured side) |
| Evidence for every A: 60%; for every security A: 75% | PR body not readable. My 13 re-runs all behaved correctly. | unscored (supported) |
| No security guard weaker: 85% | none weaker in 13 mutations; the grant sweep's sink half is vacuous on 2 of 3 mounts | hit (with caveat) |
| Commit order replacement → loosen: 55% | yes, 4 additive commits then the loosenings; but a 30-minute burst | hit |
| Mixed pins' non-E parts byte for byte: 80% | Strength kept (compute 7, proxy 0, outside 5, `workspace-api` relay), but not byte for byte. `run-limit-gating` and `lin-3130` bodies were rewritten, and the fingerprint partition sum (E+non-E) was dropped. | partial (miss on the letter) |
| Canary passes secret-scan first try: 70% | passes now; first try unknown | hit (first try unverified) |
| At least one security pin stays B (`READ_WRITE`): 90% | yes, `proxy-scopes` judged over the unit | hit |
| An E count beyond the allow-list kept: 40% | none found; only the F3 "E holds exactly 2" | favoured side (no) |
| PR shows a probe re-run with 0 A/B fails: 45% | PR body not readable. My re-run gives 0. | unscored |
| One PR: 80% | yes | hit |
| Merged: 75% | yes | hit |
| Done without a `DECISION:`: 60% | one ruling was pressed (plan-review loop bound) | miss (if a ruling counts) |
| Ruling topic (ordering, lin-3134 header, census counts) | loop bound, which none of these named | **miss** |
| Wall 3-5.5 h, median 4 h | 2 h 34 m | **miss** (faster) |
| Suite time rises < 5 s | about 13 s serial, +14 s wall in one run | **miss** |
| Surprise: a vacuous conversion, 25%, likeliest the limiter | Limiter is not vacuous (M5 and M6 fail it). The proxy-grant sink tests are vacuous for rad and kickoff, though the 403 tests cover them. | partial |
| Surprise: a route file changed, 5% | no | hit |

## Surprises

* The real move is green only if the forwarder is block-bodied, because of `lin-3136-dispatch-gate:168`'s literal match. That is a constraint on 4b, beyond "keep the registrations".
* The proxy-grant sink sweep is blind on recommend-and-dispatch and kickoff, which stop at a 404 issue lookup.
* `lin-3134` census runtime is up about 70% (7.0 s to 12.1 s).
* The fingerprint test at :214 still says "each of the 9 direct sites" but now checks 7.
* Much faster than predicted (2 h 34 m), and more tests than predicted, mostly from route-by-route sweeps.
