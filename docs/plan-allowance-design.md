# Plan and allowance: one seam (LIN-3706)

Status: design note, first commit of the PR; the same text tops the PR description.
Merge base: `331683f33b9c1cbe3a7386d79e32c870c82e96be` (origin/main). Every `path:line` below is at that base.

## Why

Who is Free, and what Free gets, has five homes that agree by habit: the who-is-Free predicates (three in `lib/chat-request.js`, a fourth in `server.js`, a fifth in `lib/run-paragraph-hook.js`), the numbers and env reads (`server.js:456,460`, `lib/free-tier-store.js:31,51`), the day, hour and remaining arithmetic (six lines in the store), the refusal bodies and reason strings (`lib/dispatch-factory.js:297-312`, `lib/chat-request.js:118`, store `:137,169,207`), and the code-to-status map (`lib/dispatch-refusal.js:53`, `routes/workspace-api.js:741`). LIN-3663 (the test flag that counts as Free in some places) is a symptom: nothing says which predicate each caller wants.

The change makes a later plan a row, not a branch at call sites. It changes neither the free number (10 runs a UTC day, 50 prompts a UTC hour) nor any paid tier (undecided, `docs/v1.md:96`, `:117`), and nothing a client or a log can see.

## 1(a) The seam: file and why

`lib/plan-allowance.js`, a leaf. It imports nothing from this repo, so nothing it imports can import it back (`tests/unit/plan-allowance-leaf.test.js` fails on any non-`node:` import). It is plain functions: no database, no network. It reads no env except `readAllowanceEnv` and no clock except `wallClock`.

Why a new file and not `lib/free-tier-store.js` or `lib/chat-request.js`: the store imports from the seam (it would be the seam's first dependent and a cycle if the seam lived there); `chat-request.js` imports `openrouter.js` and `account-group.js`, so a seam in it is not a leaf. The seam holds data and arithmetic; the store keeps the collection reads and writes, `chat-request.js` keeps the env reads and the gate calls.

Relation to `lib/plan-fee-config.js`: unrelated. That file reads `PLAN_FEE_MONTHLY_USD`, a cash figure for a KPI. They share the word "plan" and no import. The seam holds allowances; a paid plan's price would be a field on a row in a later change, not today's concern.

## 1(b) API, a line per function, and what each does with off-path input

| Export | What it is | Off-path input (today's behaviour, kept) |
| -- | -- | -- |
| `FREE_FOR` | frozen table, four rows (`keyed`, `label`, `flagged`, `offered`), each `{id, requires, anyOf, reason}` | n/a (data) |
| `isFreeFor(rowId, facts, table = FREE_FOR)` | a predicate computed from a row | unknown row: `false` |
| `PLANS`, `FREE_PLAN` | frozen rows `{id, appliesTo, runsPerDay, promptsPerHour, clampsModel, promptsUnlimited}`; production has `free` (10; 50) | n/a |
| `planOf(facts, plans = PLANS)` | first row whose `appliesTo` is true, else `null` | no match: `null` |
| `modelClampOf(plan, resolve)` | `resolve(plan)` when the plan clamps, else `null`; the clamp value stays in `lib/openrouter.js` | `null` plan: `null` |
| `readAllowanceEnv(env = process.env)` | the one env place: the two raw strings | unset: `undefined` |
| `allowanceOf(plan, envLimits)` | `parseInt(raw, 10) \|\| plan number` for each of the two limits | `0`, junk, blank: the plan's number; negative kept; `'3.9'` is 3; `'1e2'` is 1; `' 7 '` is 7 |
| `wallClock()` | `new Date()`, `Date` resolved at call time | n/a |
| `dayWindow(now)`, `hourWindow(now)` | `{key, start, resetsAt}`; the same expressions the store used (`toISOString().slice`, `setUTCDate` then `setUTCHours`), not arithmetic | invalid `now`: `key` throws as before; `start` and `resetsAt` are lazy getters so asking for `key` alone throws no sooner than it did |
| `remainingOf(limit, used)` | `used == null ? 0 : Math.max(0, limit - used)` | `null`/`undefined` used: 0; `NaN` stays `NaN`; negative limit: 0 |
| `USAGE_DENIAL_REASONS`, `hourlyDenial(reason, limit, resetsAt)` | the three `tryUse` reason strings and the denial record `{allowed, reason, remaining: 0, limit, resetsAt}` | n/a |
| `promptRefusalBlock(denial)` | verbatim move of `freeTierRefusalBlock`: four keys, never `runsUsed` | null denial throws (reads `denial.remaining`), as today |
| `secondsUntil(resetsAt, nowMs)` | moved from `dispatch-factory.js:187` | unparseable `resetsAt`: `NaN` passes through |
| `RUN_LIMIT_CODE`, `RUN_LIMIT_UNVERIFIED_CODE` | moved from `dispatch-factory.js:116,119`; the factory re-exports them | n/a |
| `runLimitStatus(code)` | `code === RUN_LIMIT_UNVERIFIED_CODE ? 503 : 429` | **every other code, `undefined` included, is 429** (an equality, not a lookup table: a table answers `undefined` and `retryAfter` would be dropped, `dispatch-refusal.js:54`) |
| `isRetryableRunLimit(code)` | strict equality on `RUN_LIMIT_UNVERIFIED_CODE` | `'X'`, `undefined`, `'run_limit_unverified'`: `false` |
| `runRefusal(gate, nowMs)` | `{status, body}` for 429 and 503, key order as `dispatch-factory.js:297-312` | `gate?.reason === 'limit'` is 429; null, throwing-and-swallowed or any other gate is 503 with `gate?.limit ?? null`, `gate?.resetsAt ?? null`, `retryAfter` 1 when no `resetsAt` |
| `quotaAnswer(plan, usage)` | the five-key `limited:false` body **only when the plan is absent**; with a plan, `{limited: true, runsUsed, limit, remaining, resetsAt}` read from `usage` | **no guard on `usage`**: a null or throwing `getRunUsage` answer throws inside the route's `try` and is the existing 500 plus log, never a 200 |

`FREE_FOR` rows, one per distinct predicate (read off the code, not off the ticket's candidate list); each carries a reason in the table itself:

| Row | requires | anyOf | Purposes that share it |
| -- | -- | -- | -- |
| `keyed` | no session key, no paid env key | free key | prompt gate; run gate; quota; model clamp (`forceDefault: isFreeTier`); AI available; proxy lane; `PLANS.free.appliesTo`; precompute fallback |
| `label` | no session key, no paid env key | free key, test flag | source label; recommendation enabled; prompt-options flag; footer, settings and observation copy |
| `flagged` | no session key, no paid env key | test flag | AI-mock charge; test-token data mock |
| `offered` | nothing | free key | landing copy |

Four rows, about nine purposes. The ticket's candidate "landing copy and precompute" is two things: landing copy is `offered` (a free key is configured, regardless of a paid key); the precompute fallback is `keyed` with `hasSessionKey:false`.

## 1(c) Every call site, and what it becomes

Census at base (the ticket's `git grep`): 274 lines in 34 files (the ticket and the first plan said 36; re-run at this base gives 34). 20 lines match `forceDefault: isFreeTier` (the ticket said 19).

### Becomes a front over the seam (signature and file unchanged)

| Site | Becomes |
| -- | -- |
| `lib/chat-request.js:46-48` `hasNoOwnCredential` | deleted; its half of the rule is the `requires` of `FREE_FOR` |
| `lib/chat-request.js:60-63` `getFreeTierKey` | stays (env read + trim, LIN-3664) |
| `lib/chat-request.js:86-91` `resolveOpenRouterSource` | `isFreeFor('label', readPlanFacts(...))` |
| `lib/chat-request.js:104-106` `isFlagFreeTier` | `isFreeFor('flagged', ...)` |
| `lib/chat-request.js:117-119` `freeTierRefusalBlock` | `promptRefusalBlock` |
| `lib/chat-request.js:138-143` `resolveChatCredential` | `isFreeTier = isFreeFor('keyed', readPlanFacts(...))`; `apiKey` chain, `available`, result key order untouched. No `plan` field is added (the result is `deepEqual`-pinned) |
| new, `lib/chat-request.js` | `readPlanFacts({sessionApiKey, sessionFreeTierFlag})` (the four facts, read at call time) and `isFreeTierOffered(env)` (`offered`) |
| `lib/free-tier-store.js:31` `DEFAULT_RUN_LIMIT` | `= FREE_PLAN.runsPerDay`, still exported |
| `lib/free-tier-store.js:51` | `options.hourlyLimit \|\| FREE_PLAN.promptsPerHour` (the `\|\|` kept: `0`, `null`, `undefined` give the default, `'5'` stays a string, a negative stays) |
| `lib/free-tier-store.js:62-72,93-110,117-119` key, start, reset helpers | one-line calls to `dayWindow(wallClock())` / `hourWindow(wallClock())`, one `wallClock()` per old `new Date()` |
| `lib/free-tier-store.js:137,169,171,207` denial records | `hourlyDenial(USAGE_DENIAL_REASONS.x, ...)` |
| `lib/free-tier-store.js:200,298,319` remaining | `remainingOf` |
| `lib/dispatch-factory.js:116,119` codes | re-exported from the seam |
| `lib/dispatch-factory.js:187` `secondsUntil` | deleted (moved) |
| `lib/dispatch-factory.js:283-313` `guardRunLimit` | keeps `readOrNull(() => runGate())`, the `clockMs(now)` read after it, the `allowed === true` early return, then `const {status, body} = runRefusal(gate, nowMs); throw refuse(body.error, 'runLimit', body, status)` |
| `lib/dispatch-refusal.js:53` | `runLimitStatus(refusal.code)`; `retryAfter: status === 429 ? ... : null` stays as written; the header sentence "the single table" (`:9-10`, LIN-3470) is reworded where it sits to name the one exception |
| `routes/dispatch.js:544-563` quota | see 1(d) |
| `routes/workspace-api.js:741` | `retryable: isRetryableRunLimit(limit.code)` |
| `server.js:454-461` store build | `allowanceOf(FREE_PLAN, readAllowanceEnv())` once |
| `server.js:1769,2151` landing copy | `isFreeTierOffered()` |
| `lib/run-paragraph-hook.js:35` `resolvePrecomputeApiKey` | `paid \|\| (isFreeFor('keyed', {...}) ? free : null)`; env-param signature unchanged |
| `public/prompt-section.js:239-243,345-349` | one in-file helper `runQuotaView(state)`; rendered bytes unchanged |

### Stays, calls an unchanged front

Callers of `resolveChatCredential`, `checkFreeTierGate`, `buildRunGate`, `isAiUnavailable`, `getOpenRouterSource` and `freeTierStore.tryUse` share one row: they call a function whose signature and result do not change, so they are not edited. By file (line counts from the census): `routes/workspace-api.js` 57, `routes/proxy-compute.js` 34, `routes/workspace-api-roadmap.js` 20, `routes/flight-companion.js` 17, `server.js` 15 (one delegate, `getOpenRouterSource`), `lib/dispatch-entrance.js` 15, `routes/dashboard.js` 12, `lib/workspace-preferences.js` 9, `routes/ship-biscuit.js` 7, `routes/proxy.js` 7, `routes/next-run.js` 7, `lib/render-observation.js` 7, `routes/task-chat.js` 6, `routes/proxy-flight-companion.js` 6, `lib/agent-turn.js` 6, `routes/dispatch.js` 3, `lib/render-flight-companion.js` 3, and 17 files with 1 or 2 lines each.

Additions the census does not catch, each a stay:
* `lib/dispatch-entrance.js:881-888` (`gateByTier`, `gateByKey`) and `:1480-1504` (`meterDescent`): call the unchanged `buildRunGate`, `resolveChatCredential`, `isAiUnavailable`; the gate calls do not move (LIN-3598).
* `lib/openrouter.js:317` `resolveFreeTierModel`, applied at `lib/workspace-preferences.js:177-178,232-233`: the clamp value stays here; the Free row says `clampsModel: true`.
* The three direct `tryUse` charge copies (`routes/proxy.js:1362`, `routes/workspace-api-roadmap.js:313`, `routes/workspace-api.js:838`): out of scope by the ticket. They are the charge, not the predicate.
* `lib/free-tier-store.js` `cleanup()` (`expiresAt: { $lt: new Date() }`): a TTL sweep, not a window; stays.
* Browser copies of the quota-known test (`public/prompt-section.js:1402-1404`, `public/app.js:1827-1828`): browser files cannot import the seam, and the ticket does not ask for them to be collapsed. Stay.
* `public/app.js:1829,1831`: UI sentences. Stay (see 4 below).

### Copies and where each goes (C1-C6)

| Copy | Before | After (outside the seam) |
| -- | -- | -- |
| C1 numbers and env names | 4 lines, 2 files | 0 |
| C2 refusal block and run-limit sentences | 5 lines, 2 files | 0 |
| C3 remaining and reset arithmetic | 6 lines, 1 file | 0 |
| C4 UI sentences | 5 lines, 2 files | 4 lines, 2 files (the duplicate title in `prompt-section.js` collapses; `app.js` and the quota span are different sentences; browser files cannot import the seam) |
| C5 quota answer shape | 2 lines, 1 file | 0 |
| C6 day and hour key arithmetic | `store:62-72,117-119` | `dayWindow`, `hourWindow` |
| C6 `tryUse` denial records and reasons | `store:137,169,171,207` | `hourlyDenial`, `USAGE_DENIAL_REASONS` |
| C6 code-to-status map | `dispatch-refusal.js:53`; bare string `workspace-api.js:741` | `runLimitStatus`, `isRetryableRunLimit` (equality-based, defaults kept) |
| C6 client `quota.remaining <= 0` | `prompt-section.js:242,348` | one helper in the same file |
| C6 the 10 and 50 defaults | `server.js:456,460`, store constructor | `FREE_PLAN` |

## 1(d) Entry points: reads in order, reply, logs, where the store call sits

The seam adds no store call, no catch and no log. Placement of every store call relative to its `try` is unchanged; a throwing or null store answer still hangs some callers and answers 500 on others (LIN-3598).

* **Prompt gate** (every chat route): reads facts (session key, paid env, free key) via `resolveChatCredential`; then `checkFreeTierGate` calls `freeTierStore.tryUse(urlKey)` (no catch of its own). Denial: the caller's own 429 with `freeTierRefusalBlock(check)` (`freeTier: {used, remaining, limit, resetsAt}`), its own transport and logs. Unchanged.
* **Run gate** (`createDispatchItem`): `guardRunLimit` reads `runGate()` (swallows a throw to `null`), then the clock, then answers. 429 `{error, code, freeTier: {used, remaining, limit, resetsAt, runsUsed}, retryAfter}`; any other gate answer is 503 `{error, code, freeTier: {used, remaining, limit, resetsAt, runsUsed: null}, retryAfter}`. Key order is the wire order today. The thrown tag is `runLimit`; `mapDispatchRefusal` and `workspace-api.js:741` read the code.
* **Quota** (`GET /workspace/:urlKey/api/dispatch/quota`, `routes/dispatch.js:544-563`), inside one `try`: (1) `accountId` from the session; (2) facts (one env read), `plan = planOf(...)`; (3) `!plan || !accountId` returns `quotaAnswer(null)`, the same five-key `limited:false` bytes; (4) `resolveAccountGroup`; (5) `getRunUsage`; (6) `quotaAnswer(plan, usage)`. `getRunUsage` resolving `null` throws on `usage.runsUsed` inside the `try`: 500 `{error: 'Failed to read dispatch quota'}` and the log `Read dispatch quota error: <message>`. The seam does not turn that into a 200.
* **Store**: `tryUse` reads `wallClock()` for `now`, again for the hour key, again after the first await for the day key, and once per `resetsAt`; none is merged. `getRunUsage` reads the day start before the count and `resetsAt` after; `checkRun` reads `resetsAt` after the count.
* **Landing, precompute**: `server.js:1769,2151` and `resolvePrecomputeApiKey` read env at call time through `getFreeTierKey`; no change in when.

## 1(e) Plain `isFreeTier` boolean sites that remain, and what a later plan changes

* `forceDefault: isFreeTier` on 20 call lines (`routes/workspace-api.js`, `routes/proxy-compute.js`, `routes/flight-companion.js`, `routes/dashboard.js`, `routes/next-run.js`, `routes/ship-biscuit.js`, `routes/proxy.js`, `lib/agent-turn.js`, and others): a plain boolean from `resolveChatCredential`. Stays because it is the pinned clamp wiring (`free-tier-model-clamp-wiring`), the 20 sites are the cause of nothing today, and a boolean is exactly the Free row's `clampsModel: true`. A later plan changes each to `forceDefault: credential.clamps` (a row field read through `modelClampOf`). `clampsModel` and `promptsUnlimited` have no production reader in this PR.
* `resolveRoadmapModelOverride(requested, workspaceModel, isFreeTier)` (`routes/workspace-api-roadmap.js:50`, call `:302`): a clamp-purpose boolean outside the 20 lines. Stays. A later plan passes the clamp, not a boolean.
* Footer, settings, observation and prompt-options copy (`lib/components/footer.js:67,85`, `lib/render-settings.js:428`, `lib/render-observation.js:98`, `lib/render-prompt-opts.js:41`): `openRouterSource === 'free'` strings. Stay: they read the `label` result. A later plan adds a source or a label.
* `if (isFreeTier && freeTierStore)` (`routes/dashboard.js:2802,2988`), `if (!mockAi && isFreeTier)` (`routes/next-run.js:184`) and the `workspace-api.js` mock-path conditions: caller conditions over a cell (test mode, mock AI, store present). Stay. They are listed under LIN-3663 below.
* `lib/dispatch-entrance.js` `gateByTier(run, isFreeTier)`: stays, forwards the boolean to `buildRunGate`.

A new plan still changes these plain-boolean sites; the seam makes the plan, allowance, windows, bodies and status a row, which is what this ticket promised.

## 1(f) Test conversions: the move probe

Method: the planned fronts were applied to a scratch copy outside the repo and the full unit suite run (`npm run test:unit`: 18560 pass, 0 fail on old; on the probe, the failures below, then 0 after the fix).

Prediction, from reading: none of the five candidates (`interactive-openrouter-chain-byte-identity`, `chat-request-free-tier-rule:105-110`, `task-chat-route:72-78`, `free-tier-model-clamp-wiring`, `run-limit-gating:234-270`) is in the way, because the design leaves the gate calls, the `resolveChatCredential(` counts, the 20 `forceDefault` lines and `err.runLimit` where they are. **The probe confirmed that and found one thing the prediction missed:** four tests evaluate real `server.js` source (`handleWorkspaceRemoval`'s landing render) in a sandbox that declares every free identifier that source references. A new identifier in the landing call (`isFreeTierOffered`) is a `ReferenceError` there, several tests in four files (the probe run reported 8 subtests and 5 enclosing tests failing).

| Test | What failed | Conversion | Why it is not a loosened pin |
| -- | -- | -- | -- |
| `lin-1503-github-family-401-remint-behaviour`, `lin-1885-jira-401-workspace-preservation`, `lin-2110-ensure-valid-token-refresh-gate`, `lin-1887-refresh-strategy-dispatch` | `isFreeTierOffered is not defined` | add `isFreeTierOffered: () => false` beside the existing `getFreeTierKey: () => null` in each sandbox | declaration only: no assertion changes, the landing renderer is stubbed in all four, and the line is inert on old code. Lands in its own commit before any production line moves |

No other test is converted. The five ticket candidates stay unedited and are in the final suite run. The scratch mutation for each conversion is "none": the line pins nothing, it declares a name.

## 1(g) Commit order

1. This note (only this file).
2. Sandbox declarations (the four lines above); suite green on unchanged production.
3. New tests, shown failing on unchanged production: `tests/unit/free-tier-allowance-fronts.test.js` (characterization through public APIs; green at base, its scratch mutations shown failing), `tests/unit/plan-allowance.test.js` (red at base: module absent), `tests/unit/plan-allowance-leaf.test.js` (with a positive control).
4. Production: `lib/plan-allowance.js`, the fronts, `scripts/code-shape/areas.json`, then docs.

## LIN-3663: the question, the recommendation, the exact edits

Question: should the test-only session flag `session.freeTierEnabled` count as Free outside the AI-mock paths? Today it counts for `label` and `flagged`, not for `keyed`. So with the flag and no key, the footer says free, and on a workspace that is not mocked the API answers 503 and the quota says `limited:false` (`routes/dispatch.js:547-549`).

This PR takes neither option; today's answers are kept and the disagreement is now a visible difference between two cells.

What the table covers: everything that is a function of the four facts. What it does not cover, because it is a caller condition: `!isTestMode`, `!mockAi`, `!isTestToken` (`routes/workspace-api.js:1362,2158,2249,2404,2596`, `routes/task-chat.js:447`, `routes/next-run.js:184`, `routes/proxy-compute.js:422,1117,1223,1401,1506`), the account being present (`buildRunGate`, quota), the store being present (`routes/dashboard.js:2802,2988`), `makesModelCall` (`routes/proxy-compute.js:422`). `surfaceFreeTier` (`workspace-api.js:1362,1482`) picks `flagged` or `keyed` by `mockAi`: a caller condition over two cells.

* **Option A: make the flag agree everywhere.** Table edit: `FREE_FOR.keyed.anyOf: ['hasFreeKey']` becomes `['hasFreeKey', 'hasTestFlag']`; plus threading `sessionFreeTierFlag` into every `readPlanFacts` call (about 30). Rejected as the recommendation: `keyed` would be true with `apiKey` null, a Free state with no key to spend, and it changes test-session charging the e2e suite relies on (LIN-405).
* **Option B: drop the flag from the source label.** Table edit: `FREE_FOR.label.anyOf: ['hasFreeKey', 'hasTestFlag']` becomes `['hasFreeKey']`; delete `sessionFreeTierFlag` from `resolveOpenRouterSource` and `getOpenRouterSource`. **Recommended:** production predicates stop reading a test flag; the flag keeps its one honest job (`flagged`, charging the AI mock). Cost: the e2e `free-tier.spec.js` footer expectations need a free key or a mocked-source fixture; that is its own ticket and not run here (e2e is left to CI).

Follow-up ticket: none identified yet; this note is the record.

## Behaviour differences

Expected: none. The operator's replay and my own are the witnesses. The PR lists any that appear; the note carries none. Two accepted notes on the way the code is written, neither observable:

* `dayWindow`/`hourWindow` compute `start` and `resetsAt` lazily, so a caller that wants only `key` throws no sooner on an invalid `Date` than before.
* `resolvePrecomputeApiKey` reads the free key before testing the paid one; it is a side-effect-free env read.

## Open questions (today's behaviour kept)

* LIN-3663, above.
* Whether `clampsModel` and `promptsUnlimited` get a production reader: no reader in this PR; the second-plan unit test is the only reader.
* One module or two for the refusal builders (LIN-3658 judged no: different record, different home): both shapes stay two (`promptRefusalBlock` has four keys, the run body has `runsUsed`) in one module. Reads fine; say if it reads worse.
