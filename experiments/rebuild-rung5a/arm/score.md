# Rung 5a score: dispatch factory + validation rebuild (LIN-3580, PR #1904, merged b3bdccaf)

## Baseline check
- `git log f4749b91..b3bdccaf -- lib/dispatch-factory.js lib/dispatch-validation.js` = b3bdccaf only.
  1f8010a0 (the PR's base) did not touch them: the replay's f4749b91 pins are the true "old".
- Shared lib: the replay loads every non-target module from the checkout (f4749b91) for BOTH sides.
  None of the modules changed on main since (pipeline-loops, render*, home-swipe-prompt-opts,
  playwright configs) is in the factory's 51-file import graph (`graph.txt`), and imports are
  identical old vs new, so both sides see a lib identical to b3bdccaf's for everything they reach.

## 1. Replay (seeds 1 and 7, n=3000, all tiers incl. test-captured)
| | seed 1 | seed 7 |
|---|---|---|
| inputs (edge 339, gen-v 3000, gen-vx 1500, gen-f 3000, test 6354) | 14,193 | 14,193 |
| differing | 271 | 293 |
| factory (edge + gen-f) | 126 | 120 |
| validation (edge + gen-v) | 145 | 173 |
| gen-vx (small exports, regex statefulness) | 0 | 0 |
| test tier: 84 files, 6,354 calls (936 createDispatchItem), 2,159 TAP outcomes, exit codes | 0 | 0 |
| exports diff / key-order info / import census / network (6 blocked fetches each side) | 0 / 0 / same / same | same |
| old coverage: factory 545/545 lines, validation 182/182 | 100% | 100% |

**Mechanical classification.** `oldfix/` = the f4749b91 factory plus exactly the four fixes the PR
lists (7 one-line patches: `.then(() => read())` on the two `getItemStatus` reads, presets `get`
and the count; `result == null`; `existing.dispatchedAt != null`; the consumer-stamp wrapper).
- **new vs old+fixes: 0 factory differences on both seeds** (and 0 gen-vx). Every factory
  difference is therefore one of the four fixes.
- old vs old+fixes reproduces the factory rows exactly (126 / 120). Single-fix sides (`fix1..4/`)
  each explain a subset; their union = all 126 / 120 inputs, none unexplained.

| # | group | s1 | s7 | example (before -> after) | class | reason |
|---|---|---|---|---|---|---|
| F1 | sync throw / plain return at run read, anchor read, presets `get`, count acts as rejection / value | 43 | 52 | `edge:preset-sync-value-typeerror`: `TypeError ...get(...).catch is not a function` -> preset applies, enqueued. `gen-f:1197` (maxTasks, count throws sync): raw `Error: sync count` (500) -> 409 `BUDGET_EXHAUSTED`, `count: null` | (a) | ticket pre-decides this exact option; no read changes direction; PR fix 1 |
| F2 | count resolving `undefined` = unreadable | 19 | 17 | `edge:budget-count-undefined`: `TypeError ... 'taskDispatches'` -> 409 `BUDGET_EXHAUSTED` (maxTasks) / admitted (no maxTasks) | (a) | `dispatch-factory.test.js:1381` "does not throw on a null dereference"; PR fix 2 |
| F3 | duplicate prior with `dispatchedAt: null` admits | 22 | 14 | `edge:dup-null-date-epoch`: 409 `DUPLICATE_DISPATCH`, `retryAfter: 1` (1970) -> admitted, `addItem` called | (a) | the guard's own comment ("can't be read as a real instant ... does not refuse"); `0` and real instants still refuse; PR fix 3 |
| F4 | consumer stamp read failure stamps `null` | 42 | 37 | `edge:consumer-sync-array-typeerror`: rejects AFTER `finalizePrompt` minted -> `addItem({... consumerLastSeenAt: null})`, store's own item returned | (a) | `docs/proxy-integration.md:2286` "does not refuse the dispatch"; PR fix 4 (cause LIN-3581) |
| V1 | `validateDispatchPayload` body property READ order/count (new destructures, then re-reads via tables) | 118 | 149 | `edge:proxy-reads`: `prompt,promptName,...,ifParked` -> `effort,issueId,...,prompt,promptName,issueIdentifier,...` | (c)3 | only Proxy/getter bodies (all 267 are `$proxyReads`); same key set, same verdict, first error and warn; callers pass JSON `req.body` |
| V2 | `null` body TypeError wording | 27 | 24 | `Cannot destructure property 'prompt' of 'body'` -> `... 'effort' of 'body'` | (c)1 | same class (TypeError), same settle; garbage input no caller relays; all 51 are this one message |

Raw groups inside F1-F4 (settle, returned-identity, pilot env-read, later-step errors, `[file-pointer]`
log) all follow from a guard now admitting. **(b) regressions: 0. (d): 0.**

### The points you flagged
- **Refusal code/status/retryAfter/tags:** identical to old+fixes everywhere. Only fix-driven
  changes: F3 removes the 1970 duplicate refusal; F1/F2 turn a sync-throw/`undefined` count under
  `maxTasks` into the 409 `BUDGET_EXHAUSTED` `count: null` refusal (closed stays closed; no
  maxTasks stays open).
- **Item written via `addItem`:** keys, values and key order identical to old+fixes (0 key-order
  info rows); test tier 0 differences across 936 captured `createDispatchItem` calls.
- **Store-failure handling:** `findRecentFreshDispatch` open, `runGate` closed, preferences
  propagate, `finalizePrompt` errors propagate: unchanged. Only F1/F2/F4 move, as listed.
- **Anchor (composed-run) cache:** module singleton (inputs that omit it, two-call sequences) and
  injected caches: 0 differences.
- **Token minting:** `finalizePrompt` calls (count, args, position) identical to old+fixes. F4
  removes old's mint-then-reject (a minted bootstrap token with no row); F1-F3 add exactly one mint
  where old rejected before minting.

## 2. Shape (kit `shape.mjs`, acorn)
| | old (f4749b91) | new (b3bdccaf) |
|---|---|---|
| factory code lines / total | 545 / 1,245 | 490 / 1,047 |
| factory decision points / cyclomatic total | 208 / 233 | 169 / 211 |
| worst function | `createDispatchItem` 181 (451 code lines, 913 span) | `createDispatchItem` 49 (132 code, 193 span; 19 of its 48 DPs are param defaults) |
| next worst | `defaultFetchPilotPrFiles` 10 | `pilotPrompt` 21, `inheritFromAnchor` 19, `resolveRouting` 16, `guardRunLimit` 12 |
| functions (incl. arrows) / max nesting | 24 / 6 | 41 / 5 |
| validation code lines / DPs / worst | 182 / 77 / `validateDispatchPayload` 42 | 146 / 57 / `validateDispatchPayload` 20 |
| **combined code lines / DPs** | **727 / 285** | **636 (-12.5%) / 226 (-20.7%)** |

PR says `createDispatchItem` has "about 25" DPs; the kit says 48 (29 without param defaults).

## 3. Run facts
- Files: exactly 3 (`lib/dispatch-factory.js`, `lib/dispatch-validation.js`, new
  `tests/unit/dispatch-factory-pins.test.js`). No helper module. No existing test edited
  (`git diff --name-status 1f8010a0 b3bdccaf -- tests/` = one `A`).
- Fixes listed: 4, all (a). Dead code dropped as the ticket suggested (`valueWithin` `settled`, etc.).
- Pins test: 25/25 at b3bdccaf; against the f4749b91 files 16 fail / 9 pass (matches the PR claim).
- Census at b3bdccaf (temp worktree, repo node_modules symlinked), all pass:
  lin-3124-pr3-checkpoint-c2 9/9, passage-runner-contract-drift 11/11, lin-3134-declared-mint-census
  39/39, lin-3384-redaction-census 11/11, lin-3383-runner-enqueue-census 27/27,
  lin-3130-create-dispatch-item-proxy-token-store-pin 1/1, lin-3382-urlkey-class-guard 12/12,
  urlkey-holders 12/12; also dispatch-factory 151/151, -run-gate 14/14, dispatch-validation 16/16.
- LIN refs in comments: 40 unique before, 40 after; **39 kept**, 1 dropped (LIN-1094, the
  "pre-LIN-1094 null passthrough" docblock note on `workspacePreferencesStore`), 1 added
  (LIN-3581). Factory 28/29 kept, validation 15/15.
- PR's own replay: base 1f8010a0, one seed (20261016), 1,500 factory + 6,000 validation generated,
  371 captured validation calls; captured `createDispatchItem` replay **not done** (ours covers it:
  936 calls, 0 diffs). Same "old+fixes third side" method; its (a) counts per 1,500 differ from
  ours only by generator (theirs: 57/19/4/61 of 1,500).
- CI green (unit, e2e 4/4, secret scan). Commit trailer: `Co-authored-by: Claude Sonnet 5.5`.
- Timeline: launch ~17:20Z, worker died ~18:25Z, paused 18:58Z, relaunched 20:27Z, PR opened
  21:32:57Z, merged 21:48:08Z, Done 21:56Z (90 min after relaunch; 4h36m wall).

## 4. Prediction (prediction-dispatch-factory.md) line by line
| line | prediction | outcome | verdict |
|---|---|---|---|
| 9 | not split, ~75% | one PR, no children | hit |
| 10 | merges ~75% | merged | hit |
| 10 | done without a ruling ~40% | no DECISION in the PR; plan "approved on the ticket (revision 2)". Ruling history not visible from here | unknown (likely hit) |
| 11 | 60-150 min | relaunch->Done 90; first attempt ~65 min lost to the reboot; wall 276 | hit on the run that finished; miss on wall clock |
| 14 | combined 560-700 code lines (4-23% cut) | 636 (-12.5%) | hit |
| 14 | guards distinct, little code shared | one refusal builder + one fail-open read shared; guards stay separate | partial |
| 15 | worst < 60, ~75% | 49 | hit |
| 15 | worst < 30, ~40% | 49 | miss |
| 15 | `createDispatchItem` a pipeline of named guards | yes (5 `guard*` functions, straight sequence) | hit |
| 16 | DPs down 10-30% | -20.7% (factory -18.8%, validation -26.0%) | hit |
| 17 | no regression ~65% | 0 (b) on 2 seeds x 14,193 inputs | hit |
| 17 | if one ships: store failures or anchor cache | none shipped; the store-failure path is where all four FIXES landed | n/a (direction right) |
| 18 | >=1 class-(a) fix, ~60%, store-failure consistency / null `dispatchedAt` | 4 fixes, including both named | hit |

## For John
- Clean result: 0 regressions; all factory differences are the four listed fixes (proved by
  new == old+4 patches), validation differences are Proxy-body read order and a null-body
  TypeError wording.
- F1 also loosens beyond "consistency": a run read that throws synchronously now skips
  `maxTasks`, close-out and `stopAt` inheritance (as a rejection always did). Unreachable with the
  real async stores; the PR says so.
- F4 nulls the whole consumer stamp when one token store fails, so the response can say "never
  polled" while the other store has tokens; LIN-3581 is filed for the real cause.
- Files here: `report-*.json`, `only/`, `census-b3.txt`, `refs.json`, `shape-summary.txt`, `*-shape-*.json`.
