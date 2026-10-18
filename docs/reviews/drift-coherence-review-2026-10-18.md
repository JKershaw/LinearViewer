# Drift & Coherence Review — first census-driven edition, run of 2026-10-18 (trend vs 2026-10-12)

**Grounding.** Measured at `LinearViewer` `ea96357a78b295061549508d3d9b2c1e06504c6a` / `simple-dispatcher` `4c9fb76` (the previous edition measured `e24f8d12c47891eab16c25c2be3bd6d6e20624f9` / `3dc08b5b587b897fa83e4c76cbdb23cd6eec2e82`). Both repos were fetched from `origin/main` before measuring, and neither moved after this task was created (`git log --since=2026-10-18T16:13Z` is empty in both). After this report was written, LinearViewer `main` took one commit, LIN-3634 (#1939, `ff479045`). It changes finding 6 (see there); no other row's severity or delta moves. SD is unchanged. The comparison baseline is `docs/reviews/drift-coherence-review-2026-10-12.md` (LIN-3516, PR #1878, `ce5d4120`).

**Why this edition exists.** It is the first census-driven edition, and the gauge reading for **LIN-3449** (the coherence loop) and **LIN-3490** (places per decision) after the largest window this series has measured. LinearViewer `e24f8d12..ea96357a` is **59 commits**. Production (`lib/`, `routes/`, `server.js`, `public/`) changed in **99 files, +13,678 / −15,636**, mostly a design-first **rebuild round**. simple-dispatcher took **7 commits** (LIN-3585 cycle cost, LIN-3518 mutation anchors, LIN-3451 pins, LIN-1952 sender), so SD internals were re-audited this time; 10-12 did not because SD had not moved.

**Method.**
- **Census (required).** `scripts/code-shape/census-review.mjs` (LIN-3629), run at `ea96357a` against `e24f8d12` with one area guide for both runs (`scripts/code-shape/areas.json`):
  `node scripts/code-shape/census-review.mjs . ea96357a e24f8d12 --include '^(server\.js$|(lib|routes|public)/.*\.[cm]?js$)'`
  It needed `npm install` first (`acorn` was missing). Output: **468 groups, 89 `mustRule`, 261 `table`, 28 gone, 0 unranked.** The run was repeated for this report and reproduces those counts exactly. **simple-dispatcher has no census tool of its own**; SD was reviewed by reading, and its rows are marked as such.
- **Continuity practices kept.** The old command stays beside each shape count where one exists, and a row counts as resolved only when both agree. The scratch Tarjan walker over static imports of `lib/`, `routes/` and `server.js` was re-run outside the repo: 393 nodes / 1,476 edges / 0 SCCs at `e24f8d12` (reproduces 10-12 exactly), **402 / 1,487 / 0** at HEAD.
- **Re-grounded by shape, not line number**, because the rebuild round moved most citations. Claims are marked **V** (verified in source, or by a probe run at both SHAs) or **I** (inferred from code).
- **Measurement was split** across 8 fresh-context read-only sub-agents (runner contract and heartbeat; waiting-on-a-person and the two rebuilt loaders; dispatch entrance and close-out; rebuild round and AI gate; census rulings 1–45; rulings 46–89 and the gone groups; layering, credentials and the low rows; SD internals), and the load-bearing claims were re-checked at HEAD by the author.

**What was added to the scope, and why** (the listed scope was a starting point):
- the 12 files added under `lib/`, `routes/` and `public/` in the window (10 in `lib/`, `public/form-behaviours.js`, and the runner-kit `contract.json`) (`workspace-api-mocks.js`, `session-row-live.js`, `security-headers.js`, `unpriced-models.js`, `render-prompt-opts.js`, `consumer-heartbeat*.js`, `public/form-behaviours.js` and others), checked for loading alone and for what they import;
- the new cross-repo contract (consumer heartbeat, LIN-1952) and `lib/runner-kit/contract.json`;
- the 89 census `mustRule` groups, including every group spanning 3 or more areas, and the 28 groups the census reports as gone (classified by reading their sites at both SHAs);
- CLAUDE.md's four declared single homes, and the 7 inline `TODO|FIXME|XXX|HACK` hits;
- the open tickets that already name a split decision (searched before any follow-up was minted).

**File name.** No file existed for 2026-10-18, so the plain series name is used, following the `reviews/` entry of `docs/architecture/source-map.md`.

**Review-only.** No code, config, secret or under-review doc was changed. The deliverables are this report, its branch and PR, and the Linear updates. (`npm install` added only untracked `node_modules`.)

**Headline.**
- **A new top finding was born in the window.** The consumer heartbeat (LIN-1952, Harbour #1930 + SD #274) authenticates through the path that refreshes the token's `lastUsedAt`, which is exactly what Harbour reads as "a consumer is polling". A stalled SD cycle keeps reading as listening. `consumer-liveness-signal-conflation`, **MEDIUM-HIGH, NEW.**
- **The old top finding came down.** LIN-3451 (Done) aligned halt, target, repo and the cap; `runner-contract-semantics-cross-repo` goes **HIGH → MEDIUM**. But `contract.json` is a test-only table, the pin is one-way, and LIN-3624 describes the residue wrongly.
- **Waiting-on-a-person improved** (LIN-3602): one authority, 0 set copies, 0 inline checks. The dispatch entrance improved (LIN-3604 and friends). The AI gate improved by shape, with a corrected baseline (22 gates, not 19).
- **The rebuild round did not drop a shared import and re-derive it.** The pattern is *carried-and-named*: old local copies were kept and sometimes named locally, which lowers in-file counts without moving the decision to its home.
- **The census found 16 distinct decisions the eye had not**, 12 of them pre-existing. Of the 28 groups the census reports as gone, **only 9 left the code.**
- The credential row is unchanged (the writer repro was re-run at both SHAs and holds).

> *LIN-3490 reading, 18 Oct, after the rebuild round: 39 distinct decisions are held in more than one place (23 at 10-12, +16): 0 High, 2 Medium-High, 2 Medium, 15 Low-Medium/Medium-Low, 20 Low. 0 of the 23 resolved outright, 7 improved, 0 regressed. 4 of the 16 additions were born or grew in the window; the other 12 pre-existed and were first seen by the census. The jump from 23 is mostly **measurement**, not code, so the series is not comparable across this edition.* The full reading is under "LIN-3490 places per decision".

## Findings (severity-ranked; delta vs 2026-10-12)


### 1. `consumer-liveness-signal-conflation`, MEDIUM-HIGH, born in the window (LIN-1952, Harbour #1930 `e2cc2ef0` + SD #274)

The new consumer heartbeat **refreshes the same timestamp Harbour uses to decide "a consumer is polling"**. The chain is re-verified:

1. `POST /api/dispatch/heartbeat` (`routes/dispatch.js:1353`) is behind `authenticateDispatchToken`.
2. That calls `validateToken`, which bumps the token's `lastUsedAt` on every call (`lib/dispatch-tokens.js:~133-140`, "Update last used timestamp").
3. `lastUsedAt` is exactly what `getConsumerLastSeenAt` reads (`lib/consumer-poll-warning.js`).
4. `getConsumerLastSeenAt` in turn feeds:
   - Rule S `detectDispatcherSilent`: `lib/liveness-detectors.js:131-158`, via `liveness-alarm-sweep.js:27,66`
   - the enqueue "nobody listening" warnings: `dispatch-factory.js:988` (import at `:51`)
   - the runner kit's other-consumer deferral: `otherConsumerLastSeenAt`, `runner.mjs:307`
5. SD sends the beat on **its own timer, deliberately independent of the dispatcher cycle** (`simple-dispatcher/host-heartbeat-sender.js:3-6`: "a cycle can block for minutes… a stalled cycle is exactly when pacing data matters most").

So an SD process whose poll cycle has stalled keeps reading as "listening". The dispatcher-silent alarm cannot fire, the "nobody listening" warning is suppressed, and the kit keeps deferring to it.
- The mechanism is V. The runtime effect is I, but the sender's own comment states the stall scenario.
- The heartbeat body already carries the real signal, `lastPollOkAt` (`consumer-heartbeat.js:30,69`). Harbour never reads it, except to list it on `GET /api/proxy/heartbeats`.
- **On by default:** SD's `HOST_HEARTBEAT` is on unless `SD_HOST_HEARTBEAT` is explicitly falsy, with a 60000 ms default (`config.js:1293-1299`), so every SD deploy that takes #274 beats once a minute (V; found by the second-read).
- `docs/proxy-integration.md:598-602` also says the heartbeat store "adds to `otherConsumerLastSeenAt`… which only says when a consumer last polled", which implies the two are separate. They are not (Documentation hand-off).
- Docs still name LIN-1952 as "the real fix" for the A3 dilution (`proxy-integration.md:2672`, `lib/proxy-instructions.js:651`). LIN-1952 was re-scoped to pacing and closed, and its implementation now **adds** to that dilution.
- There are now three "is anyone there" signals: token `lastUsedAt`, the heartbeat store (stale or expired), and the per-session `[working]` heartbeat. The second feeds the first.
- No existing ticket: searches for `lastUsedAt`, "heartbeat poll" and "nobody listening" find only Done tickets (LIN-3258, LIN-2885, LIN-3503) and LIN-3581, which is unrelated (a listTokens throw). LIN-3636 is the kit *sending* a beat, which would extend the same problem to the runner token.

**The runner heartbeat route (the open question in the brief), verified at HEAD (V).** `POST /api/proxy/runner/heartbeat` (`routes/proxy-runner.js:120`) is behind `authenticateProxyToken, requireGrant('take')` (`:81`), not the dispatch-token middleware. `validateToken` in `lib/proxy-tokens.js` also bumps that proxy token's `lastUsedAt` on every non-single-use call (`:695-700`), and `getConsumerLastSeenAt` folds `take`-grant proxy tokens into the same maximum when the enqueue stamp passes `proxyTokenStore` (`consumer-poll-warning.js:25-47`). So the runner heartbeat reaches the enqueue "nobody listening" warning through the same touch, but **not** the runner poll's own `otherConsumerLastSeenAt` (it calls without `proxyTokenStore` on purpose, so it stays dispatch-token-only). Today the kit sends no beat (LIN-3636), so the runner side is latent; the conflation is live for SD only. The Rule S alarm reads the dispatch-token side, which is where the SD beat lands.

**Sub-row `consumer-heartbeat-wire-restated`, LOW-MEDIUM, new (V).** The wire is restated on both sides; it is not declared once.

| element | Harbour | SD |
|---|---|---|
| 18-field list | `lib/consumer-heartbeat.js:28-34` + `tests/unit/consumer-heartbeat.test.js:7-14` | `host-heartbeat.js:19-25` + `test/host-heartbeat.test.js:11-17` |
| schema `1` | `:36` | `host-heartbeat.js:16` |
| path | `routes/dispatch.js:1353` | `host-heartbeat-sender.js:10` |
| interval bounds 1000–3600000 | `:44-45` | `config.js:1296-1299` (literals) |
| stale = 3×interval | `:40,129` | — |
| TTL 15 min / 20 per workspace / 4 KB | store `:21-22`, ingest `:17` | — |

- The `contract.json:277` row is prose only.
- Docs restate the wire three more times: `dispatch-integration.md:244-277`, `proxy-integration.md`, `proxy-instructions.js`.
- **Both repos claim "a rename on either side fails a test"** (`consumer-heartbeat.js:25-26`, SD `host-heartbeat.js:5-6`). That is false: each repo pins its own literal copy.
- `dispatch-integration.md:279` says the kit sends the same body. It sends none (LIN-3636).
- Stale vs TTL: any `intervalMs ≥ 300000` (allowed up to 3600000) can never read `stale:true`; the entry just expires.

### 2. `credential-decision-multiplicity`, MEDIUM-HIGH, UNCHANGED (LIN-2150 Todo, LIN-2188 Backlog)

Every credential module has a 0-line diff in the window, except `credential-invariant-sweep.js` (+5, LIN-3506), `routes/auth.js` (+4, LIN-3642 `!state`) and `lib/github-install-flow.js` (+109/−36, LIN-3404: mint only for an installation in the user's `/user/installations`; the identical `listUserInstallationIds` lambda sits in `routes/github-auth.js:70` and `routes/github-projects-auth.js:74`). LIN-3404 is a new who-may-bind rule, found by the second-read; it adds a lambda copy, not a chooser.

| item | count | locations |
|---|---|---|
| durable/session credential copies | 6 | cache now `server.js:2433` |
| named choosers | 7 | `findActiveInstallationId` has 1 call; 10-12 counted a comment |
| token-equality choosers | 5 | |
| first-of-provider choosers | 4 | `workspace.js:372,422,593`, `workspace-token-resolver.js:61` |
| expiry ranking | 3 | |
| persist seams | 7 | |
| legacy never converts | — | `connection-credential.js:1280` |
| `legacyFallbackTarget` ≡ `selectIssueSourceBinding` | — | `connection-credential.js:493` / `workspace.js:1110` |
| sweep pairings | — | shifted +5 lines |

- **The writer repro was re-run at both SHAs (V).** With two jira bindings and the second one active, a refresh moves the call scope from `{site-B, B-OLD}` to `{site-A, NEW}`. `applyAccessTokenToWorkspace` (`lib/workspace.js:372`) still rotates the first binding. Its callers are `workspace-token-refresh.js:137`, `workspace-api.js:1757` and `server.js:1275,1738`.
- LIN-3421, LIN-3404 and LIN-3642 added no chooser or copy (0 added lines matching binding or credential names).
- Watch item: LIN-2188's scenario has still not been declared real.

### 3. `runner-contract-semantics-cross-repo`, HIGH → **MEDIUM, IMPROVED** (LIN-3451 Done; LIN-3624 Backlog)

**`lib/runner-kit/contract.json` is a test-only expected-outcomes table, not a declaration (V).**
- `contract.json:3` reads: "Test fixture only: the kit never loads this file. Byte-copied to simple-dispatcher test/fixtures/runner-contract.json".
- No production code on either side reads it. Each repo's tests drive its own code against it: Harbour `runner-kit-contract.test.js:37`, SD `test/runner-contract.test.js:25-29`.
- **The pin is one-way.** SD's sha256 pin (`:26`) fails only when *SD's* copy changes. The copy is byte-identical to HEAD today (sha `291d8943…`). If Harbour amends the table, SD stays green on a stale copy, and neither CI runs the other repo's test.
- The kit's heartbeat row is a tautology (`runner-kit-contract.test.js:102-103`).
- The SD header cites `1804aeb6`; the merge was `251ef022`.

**Halt (`cross-repo-halt-vocabulary`): high → LOW-MEDIUM, improved.** Of 10-12's four divergences, two are resolved and two remain, listed in the table:

| divergence | status at HEAD | where |
|---|---|---|
| abort under stop | **resolved** | `runner.mjs:217` |
| pause + follow-up with no live session | **resolved** | `runner.mjs:197-199,218-223` ≡ SD `followup.js:40` |
| unknown mode | remains, listed as deliberate | SD `dispatcher.js:1664-1668` fail-open vs kit `runner.mjs:216` fail-closed; `contract.json:107-118` |
| stop text | remains, listed as cosmetic | `dispatcher.js:606-612` vs `runner.mjs:295` |
| **stop + follow-up with no live session** (not in 10-12) | newly listed, open question | SD fails it (`pacing.js:113`), kit leaves it; `contract.json:93-105` |

- The parity claim in `runner-prompt.md:216-217` now reads "except the differences in contract.json", which is true by reference. However, `contract.json` is not served with the kit (`routes/runner-kit.js:4`).
- Stale test title: `runner-kit-helper.test.js:446`.

**Target, repo and cap: improved.**
- **Target.** The kit filters cli/web (`runner.mjs:83,312-313`), and a test pins it to `dispatch-targets.js:27`. Harbour's runner poll is still unfiltered (`proxy-runner.js:99` → `dispatch-store.js:924-925`), recorded as an open question.
- **Repo.** The kit validates (`runner.mjs:233-241`). Its resolution differs from SD's `admission.js:37`, and the table documents the difference (`:186-244`).
- **Cap.** The kit truncates status messages like SD (`runner.mjs:252-256`). For decisions, the kit throws and SD drops; this is listed in the table.

**Not covered by the table, and now with no open ticket since LIN-3451 is Done:**
- The row fields `queueIfBusy`, `force`, `waitForFollowUps` and `subscription` appear 0 times in the kit. SD reads them at `followup.js:62,108`, `abort.js:94` and `dispatcher.js:1297`. `proxy-integration.md:2307` says "the runner reads item.force".
- Harness: `runner.mjs:59,137-139`.
- Abort-route texts: `runner.mjs:373,377` vs `abort.js:86`.
- **Decision cap prefix window:** SD counts the 11-character `[decision] ` prefix (`hook.js:561,651`); the kit counts the raw JSON. A ruling of 1990–2000 characters is dropped by SD and posted by the kit.
- Recap chunking (SD `hook.js:32,195`) vs kit truncation (I).

**`decision-dialect-split`: MEDIUM, unchanged.**
- SD: `hook.js:491-499,561,621-660,784,828`
- Kit prose: `runner-prompt.md:170-174,178-180`
- Harbour `parseDecision`: `session-telemetry.js:672`. Its JSDoc (`:662-670`) describes only SD's form.

**`cross-repo-sentinel-decision-marker-vocabulary`: MEDIUM, unchanged. LIN-3624 does not match what is left (V).**
- All four markers it lists are still absent from the kit: `[pending]`, `decision-withdrawn`/`WITHDRAW`, `[evidence]` and `[working]`.
- **Its claim that they are listed UNPINNED rows in SD's contract test is false.** They are not rows in `contract.json` at all; SD's UNPINNED list is only `halt-text` and `cap:decision`.
- **It misses the resume marker `[working] Session resumed.`** (SD `hook.js:1117`). Harbour clears a derived `blocked` only on that text (`dispatch-terminal.js:143`), and the kit's continuation posts `[handoff]` (`runner.mjs:544`) instead. So a kit lineage that raised `[blocked]` reads blocked until its terminal marker (I).
- It also misses `[dispatcher] going down`, the row fields and harness, the decision-prefix window and the abort texts.
- It conflates the per-session `[working]` heartbeat with the consumer heartbeat, which is LIN-3636.

**Other cross-repo rows.**
- **SD wake regex:** `feedback.js:22` ≡ `dispatch-terminal.js:63`, but its comment at `:19` (and `test/feedback.test.js:542,565`) still cites `:53`.
- **Kit terminal regex:** `runner.mjs:84` ≡ `dispatch-terminal.js:36`.
- **API base:** SD 2 copies (`config.js:17`, `feedback.js:5`), unchanged. Harbour's inline `${req.protocol}://${req.get('host')}` went 30 → **23**.
- **CI:** LV Node 20, `ci-success` needs `[unit,e2e,secret-scan]` (`test.yml:136-139`). SD Node 22, one job, no aggregate; its system and mutation suites are not in CI.
- **`dispatch-kind-vocabulary-cross-repo`:** held.

### 4. `human-wait-derivation-split`, MEDIUM → **LOW-MEDIUM, IMPROVED** (LIN-3602 `ee9fcba9`; behaviour parked by the owner on 12 Oct)

**Order.** Both rebuilds landed before LIN-3602: LIN-3578 on 10-16 18:42, LIN-3590 on 10-17 00:04, LIN-3602 on 10-17 09:56. Both carried the old inline check over verbatim; LIN-3602 then routed it.

**Authority.**
- `dispatch-terminal.js:83` `WAITING_WAKE_MARKERS`, plus `isWaitingWakeMarker` at `:94-96`. The file is a leaf; it imports only `utils/time.js`.
- Set copies: 2 → **0**. The `observer-efficacy-signal` regex copy that 10-12 missed is also gone.
- Inline checks: 5 → **0**. There are 10 predicate callers.
- One divergent copy remains: `render-session.js:80` `/^\s*\[(blocked|pending)\]/i`, which drives the transcript highlight. LIN-3602 recorded it as D5 on LIN-3339.

**Channel split: unchanged.** I ran a probe at both SHAs and got identical output:

| input | banner | clock | wire |
|---|---|---|---|
| agent-status `blocked`, no marker | **true** | **false** | null |
| `[blocked]` then `[working] Session resumed.` | true | true | null |

- The agent-status mapping is now at `pipeline-loops.js:150`; `live-console.js:122` is unchanged.
- 2 union readers: `dashboard.js:347-356`, `observer-sweep.js:99`.
- 4 marker-only readers: clock `run-view.js:226-243`, per-run flag `render-run-steps.js:184-192`, `unanswered-decisions.js:71`, wire `dispatch-terminal.js:251-261`.
- The 3 staleness families are unchanged.
- Cost now: one predicate plus the channel rule. The behaviour ruling (does agent-status start a clock?) is still open, and the owner parked it on 12 Oct ("smells like something we don't need"; noted on LIN-3349).

### 5. `ai-availability-gate-duplication`, MEDIUM-LOW, IMPROVED by shape, with a corrected baseline

**"Not configured" gates total 22, not 19.** 13 go through `isAiUnavailable` and 9 do not.
- 10-12 listed 6 of the 9: `workspace-api-roadmap.js:285,798`, `flight-companion.js:728,888` and `dashboard.js:2791,2977`.
- **It missed 3** that were already present at `e24f8d12`. Each is `if (!mockAi && !apiKeyToUse)`, which is `isAiUnavailable` written inline (re-verified): `routes/next-run.js:180`, `ship-biscuit.js:132`, `task-chat.js:442`.

**Mock dialects: still 2.** `isTestMode` ×6 (one is `access.isTestMode` in `dispatch-entrance`) and `shouldMockAi(workspace)` ×6. The new `lib/workspace-api-mocks.js` adds none and unifies none.

**Data-mock predicate: 34 → 17 multi-line, 31 → 14 single-line.**
- The method reproduces 34 at both `15990905` and `e24f8d12`.
- The drop is LIN-3596 naming the predicate once **locally** (`workspace-api.js:150` `isTestToken`, 18 → 1) and the entrance rebuild (2 → 1). Nothing moved to a lib owner.
- 13 real inline copies remain, plus `workspace-api.js:888-890`, which is byte-identical to `shouldMockAi` while its comment says it is a separate decision.
- This is census **G0001/G0005, rank 1 and 5, ruled real** (see the census ruling table).

**Order restated.** `getOpenRouterSource` (`server.js:1030-1040`) and `isRecommendationEnabled` (1 caller, `workspace-api.js:1333`) restate the order.
- (I) With `freeTierEnabled` set and no key configured, Home and Swipe show AI as ready while the API returns 503.

**Other.**
- `run-paragraph-hook.js:30` still reads the key untrimmed.
- A third free-tier rule now sits at `workspace-api.js:153` (`sessionIsFreeTier`), beside `chat-request.js:55-60` and `server.js:1030-1040`.

### 6. `close-out-merged-refusal-split`, LOW-MEDIUM, HELD, plus one readiness input born in the window (LIN-3418)

- **Client order unchanged:** dispatch, then press record (`public/close-out.js:109` → `:121`; `public/session.js:821` → `:834`).
- **The refusal is still on the press only:** `workspace-api.js:3764-3765`. `guardCloseOut` checks `stopAt` only (`dispatch-factory.js:404-411`).
- **"Merged" still has two sources.** Live PR state (`run-evidence.js:84`, `run-closeout-state.js:271-285`), and the record (`close-out-events-store.js:261,281`), which `workspace-api.js:3577-3597` writes from live state.
- **New in the window:** LIN-3418's `reason:'head-moved', pressable:false` (`run-closeout-state.js:316-327`, re-verified) is enforced **only by not drawing the button**.
  - **Since the measured head:** LIN-3634 (`ff479045`) refuses a head-moved close-out on the session dispatch lane (409 `CLOSE_OUT_NOT_READY`, `lib/close-out-readiness.js` `closeOutNotReady` via a `lib/dispatch-entrance.js` session stage). The press route still does not re-check it, and the proxy, recommend and kickoff lanes are left to LIN-3417.
  - Neither the press route (`:3755-3790`) nor the dispatch re-checks it.
  - Both client copies repaint any not-ready result as "○ set up ›" (`close-out.js:90`, `session.js:772`).
- **Census G0129** (`{'merged','partial'}`) is ruled real: 5 places in 2 runtimes. It is the old G0144 under a new key.
- **LIN-3521 still open:** `applyCloseOutState` ×2. In the window, LIN-3426 (`61824e63`) had to edit both copies in lockstep.

### 7. `dispatch-entrance-field-duplication`, LOW-MEDIUM → **LOW, IMPROVED** (LIN-3604/3592/3580/3611; LIN-3608 Backlog)

The three entrance route files went from 4,553 to 2,360 lines. The 201 receipts are now one table, `RECEIPTS` (`dispatch-entrance.js:428-480`).

**Wire re-projection (`F: x.F` lines):**

| file | `e24f8d12` | HEAD |
|---|---|---|
| `proxy-dispatch.js` | 43 | 25 |
| `proxy-kickoff.js` | 4 | 0 |
| `dispatch.js` | 4 | 1 |
| `pipeline-loops.js` | 7 | 7 |

`pipeline-loops.js:414,427` still default to `null`, against `RUN_FIELDS` `'custom'`/`'cli'`.

**Residue:**
- **Budget predicate ×3, untouched:** `dispatch-factory.js:349` (accepts 1.5), `pipeline-loops.js:620`, `prompts/autopilot-kickoff.js:322`. None of them imports `isPositiveInteger` (`dispatch-fields.js:38`).
- **Variant:** one predicate, `isValidAutopilotVariant`, with two message texts (`dispatch-entrance.js:157` vs `:275`, re-verified).
- **Default `'cli'`:** server 23 → 19, client 13.
- **Two row-default tables:** `ROW_FIELDS` (`:350-397`) restates 15 `RUN_FIELDS` defaults. No live divergence.
- **The D1 "Dispatch is not available" 503 is hand-copied** at `proxy-compute.js:646-649,931-934`.
- **5 non-entrance enqueue sites** still decide row fields and the run gate themselves: `follow-up-dispatch.js:106`, `chat-tools.js:1942`, `collective.js:352`, `workspace-api.js:3026,3088`. All pre-existing.

**LIN-3608 check.** The title says eight; the body lists seven plus M3.
- All are present at HEAD.
- **Item 8 is misdescribed.** R already sends code/category/retryable (`proxy-graphql-errors.js:50-58`). The real difference is `stage` on 401, the source of `detail`, the provider name, the message and the status set.
- **Missed by the ticket:** R silently drops `maxTasks`/`presetId`/`stopAt`/`variant` (`:293,402`) but echoes `maxTasks:null`; the S/K variant message; the double read of the inherited stop-at (`entrance :1601-1606` vs `factory :907-916,1030`, I).

### 8. rebuild-round verdict (the window's largest risk)

**No rebuild dropped a shared import and re-derived it.** Import diffs and per-name lookups at both SHAs (V):
- `pipeline-loops`, `kpi-stats`, `render-roadmap`, `render-session` and `render-settings` have identical imports.
- `render.js` and `render-swipe.js` moved their prompt-template imports into the new `render-prompt-opts.js`; the default key list went 2 → 1.
- `workspace-api` moved 4 imports into `workspace-api-mocks.js`, which imports them from their owners.
- The Jira codec is one live file, `providers/jira/adf.js`. 7 archived copies under `experiments/` have no importer.

**The pattern is carried-and-named, not re-derived.** Old local copies were kept and sometimes named locally. That lowers in-file counts but moves no decision to its home:
- `isTestToken`, `sessionIsFreeTier`, `failureOf`, `openSse` (workspace-api)
- `FINISHED_STATE_TYPES` = {completed, canceled}, beside the imported `isTerminalState`, which includes `duplicate` (`task-page-loader.js:61`)
- `MERGED_STATUSES` (`:69`)
- `render-session.js:80`'s marker regex
- `kpi-stats.js:188` `median`, a twin of `wall-clock-summary.js:129`
- `render-roadmap.js:57,85,88` glyphs, vs `getStateDisplay`

**Two rebuilt modules, each with a copy the other could have adopted.**
- `issueCreateRefusal` (`workspace-api.js:535-549`) vs `proxy-writes.js:283-325`
- `LINEAR_IMAGE_HOSTS` ×4: `render.js:71` ("keep in sync"), `proxy-wire.js:106`, `proxy-reads.js:415`, `workspace-api.js:2875`. Three of the four are in rebuilt modules.

**Rebuilds reshape duplication past the census thresholds.** Of the 28 census "gone" groups:

| classification | groups |
|---|---|
| resolved by consolidation (6) | G0093, G0252, G0278 (LIN-3602); G0254, G0257 (LIN-3600); G0089 (`RECEIPTS`) |
| deleted code (3) | G0229, G0379 (`funnel-event-store`); G0291, partly |
| **removed by rebuild, still duplicated (11)** | G0066 `resolve*Input` (proxy.js:1201-1225) · G0087/G0123 scope vocabulary · G0126–G0129 mock brief/recap and cache protocol (`proxy-compute.js` vs `workspace-api-mocks.js`) · G0169 halt-set handler (now 503 vs 500 when the store is missing) · G0280 `applyCloseOutState` twin (now under the clone threshold) · G0346→G0310 · G0393→G0382 |
| removed by rebuild, was noise (1) | G0288 |
| not gone, only re-keyed (7) | G0079→G0199, G0144→G0129, G0219→G0208, G0263→G0070/264/265, G0347→G0318, G0401→G0384, G0470→G0466 |

- G0219 and G0470 had no code commits; they moved because LIN-3628/3629 changed the tool.
- **Gauge-validity note for LIN-3449/LIN-3490:** "gone" is not a resolution count. Only 9 of the 28 left the code.

### 9. decisions first seen by the census (pre-existing unless noted; new ledger rows)

Each row below comes from a census group ruled real; the groups are in the census ruling table below.

| new row | severity | census | what disagrees today | home |
|---|---|---|---|---|
| `owner-answer-reader-copies` | LOW-MEDIUM, **grew** (LIN-3421) | G0172 | 6 readers of the `{status:'owner'}` answer with 3 fail-closed styles (`owner-mint-refusals.js:126`, `proxy-tokens.js:404,602`, `workspace-removal-revocation.js:51`, `runner-setup.js:72`, `task-share.js:155`). `workspace-removal-revocation.js:47-56` `isOwner` is a verbatim copy of `proxy-tokens.js:597-606`. Its `accountIdsFor` (`:33-45`) differs from `resolveAccountGroup` (`account-group.js:24`, which includes merged accounts): (I) a token minted under a merged alias survives removal | `lib/workspace-owner.js` `isOwnerAnswer()` |
| `mock-ai-builder-copies` | LOW-MEDIUM | G0088–90, G0199, G0202 (+ gone G0126–129) | LIN-3596 created the lib home `workspace-api-mocks.js`, but `proxy-compute.js:110,151,191` and `task-chat.js:58` keep their own copies ("mirrors routes/workspace-api.js"). The two mock stage choosers rank differently (`workspace-api-mocks.js:53-75` blocked>bug>ready vs `proxy.js:1417-1440` bug>blocked>defer>started) | `lib/workspace-api-mocks.js` |
| `fresh-run-definition-copies` | LOW-MEDIUM | G0011 | "fresh run" is defined 3 ways (`dispatch-store` `isFreshRun` `:181`, entrance `:118`, factory `:182`) plus the Mongo `countFreshRunsSince` filter; a one-sided change silently miscounts the free tier (I) | `dispatch-store.js` `isFreshRun` |
| `terminal-loop-rule-copies` | LOW-MEDIUM | G0021, G0052 | terminal marker/agent-state sets in dispatch-terminal, dashboard, chat-tools (its comment says it copied only because of #977, which has landed), observer-sweep, kpi-stats, `public/observation.js` | `lib/dispatch-terminal.js` (LIN-1496) |
| `state-type-label-rank-maps` | LOW-MEDIUM | G0228, G0273, G0279, G0026, G0047 | ~11 label and rank maps; labels already differ ('Todo'/'Done' vs `getStateDisplay`'s 'To Do'/'Completed'); `task-page-loader.js:61`'s finished set omits `duplicate` | `lib/providers/state-map.js` (LIN-3612 adjacent) |
| `priority-label-maps` | LOW | G0102 | 7 word maps; `next-run.js:125` `3:'normal'` (re-verified) vs 'Medium' elsewhere | `lib/render.js` `PRIORITY_OPTION_LABELS` |
| `localhost-predicate-split` | LOW | G0013 | `startsWith` at `server.js:2080,3212,3302,3810`, `workspace-api.js:1978` and `next-run.js:143` vs an exact host at `dispatch-entrance.js:243` (re-verified): `localhost.evil.com` is offered the local option, then refused | `lib/dispatch-targets.js` |
| `observer-instance-key-copies` | LOW | G0156, G0166, G0168 | copied under a "restate, don't import" house rule; the tripwire comments already cite wrong lines | `observer-sweep.js` / `agent-turn.js` (LIN-2481) |
| `pilot-eligibility-copies` | LOW | G0179 | the store filter counts `issueIdentifier:''`, `isPilotEligible` does not | `lib/file-pointer.js` |
| `linear-image-host-allowlist` | LOW | — (by reading) | ×4, "keep in sync" | one lib constant |
| `page-chrome-options`, `ship-biscuit-desk-list`, `free-tier-rule-copies` | LOW | G0007, G0361, G0002 | 14 routes / 4 copies / 3 rules | `lib/components/page.js` / `lib/ship-biscuit.js` / `lib/chat-request.js` |
| `csp-decision-split` | LOW-MEDIUM, **born** (LIN-3420) | — | `security-headers.js:80` skips the app CSP when a route has set any CSP. The email confirm pages (`email-auth.js:97`, `frame-ancestors` only) therefore get no `script-src`; `routes/library.js:32-37` has its own | **owned by LIN-3627** (Backlog; deliberate). Record only; Security hand-off |
| SD `blocked-child-last-activity-split` | LOW, **born** (LIN-3585) | — (SD has no census tool) | `reapers.js:1095-1105` (parsed transcript time, 24 h) vs `:1194-1215` (file mtime, 7 d); the comment at `:1089-1091` says "the SAME notion" (re-verified) | `reapers.js` `lastActivity` |

### 10. Other rows re-measured (one line each)

**Layering and cycles (V).**
- Tarjan reproduces 10-12 exactly (393 nodes / 1,476 edges / 0 SCCs at `e24f8d12`). At HEAD it reads **402 / 1,487 / 0**.
- 0 upward static or dynamic edges (+56/−45). Production→tests: only the `routes/test.js` harness. the new `lib/` modules load alone.
- Seams & Tangles' F1 back edges and F3 upward edges persist (area-level; owned by that review).

**CLAUDE.md single homes.**
- All four hold: recommendation path, owner reader, email availability, prompt freeze.
- Residue:
  - The prompt-freeze numbers are copied stale in `docs/prompt-pipeline/stage-descriptions/plumbing.md:185` (568534 vs 342577) and `retro-audit.md:288`. Documentation hand-off.
  - `flight-companion-brief-size.test.js:10` is a second frozen prompt surface that CLAUDE.md does not name.
  - (I) LIN-3421's `/t/` revocation "by `ownerAccountId`" adds a third meaning of "owner" (owner-word-collision).

**Inline markers.** 7 raw hits at both SHAs; all are false positives (`LIN-XXXX` placeholders and `TODO_TIER_CAP`). Real markers: 0 → 0. SD: 0 → 0.

**Unchanged rows.**
- `provider-resolution-incantation`: 2 / 3
- `connection-binding-predicate-drift`
- `run-page-identity-scrape`: `public/session.js:740,742,859`
- `periodical-report-filename-convention-split`: 9 of 16 ids ≠ slug; mapping at `periodicals.js:1028-1050`
- `ui-divergences`: `confirm(` 10
- `owner-word-collision`: 3 by shape; 10-12's 4 is not reproduced
- `run-family-render-primitives`: 2/38
- `persist-binding-sibling-seams`: 7
- `periodic-loop-two-mechanisms`: hourly loop at `server.js:4539`

**Changed rows.**
- `server-formatter-duplication`: the USD formatter count is **×4** (`render-settings.js:309` `formatCost` existed at baseline and was uncounted).
- `routes-error-envelope-fragmentation`: LOW-MEDIUM, held. Counts (i)–(vi) are identical (0/7+1/9/8/1/0). By shape, upstream-failure envelope copies went 36 → 12. Limiter `message:{error}` bodies went 9 → 11 (LIN-1952, LIN-3635), never counted before.
- `target-vocabulary`: improved to LOW-MEDIUM (importers 9 → 7; the kit filters with a pinned copy).
- `cross-repo-repo-list`: medium-low → LOW (the kit validates).
- `dispatch-refusal-relay-duplication` residue: the writer is ×2 (`dispatch-entrance.js:540-546` has no `headersSent` guard; `proxy.js:841-854` has one).

**Held rows.** These held at HEAD:
- `store-module-uniformity`: 33
- `server-side-escaping`: 54
- `client-section-fetch`: 24
- `timestamp-parse`: 37
- `loose-json`: 8
- `ai-mock-predicate`: 1 definition
- `workspace-urlkey`: 0 diff
- `lib-components`: 36/38. The gauge cannot see that `lib/components/button.js` has 1 importer while about 22 `action-btn` buttons are hand-built in the rebuilt render-session and render-settings.
- `provider-write-field-contract`: 0-line diff

**LIN-3506 `session-row-live`.**
- 5 readers filter.
- Still unfiltered: `server.js:2646,2661` (LIN-3616 cites `:2632/:2647`, +14 stale), `workspace-token-refresh.js:588`, `kpi-stats.js:536-541` (its own stricter copy) and scripts.
- Not in LIN-3616: `scripts/revert-connection-backed.js:68` and `scripts/scan-mis-mirrored-workspaces-lin1981.js:154`.

**LIN-3610/3606/3600 moves.**
- No production copies remain.
- One `tree.js` re-export shim still has 3 callers (LIN-3612 owns them).
- `scripts/survey-hides-periodicals.mjs:66` restates the gate-marker format.

**SD internals (no census tool of its own).**
- **LIN-3585 parse cache:** a `sessions.json` cache in `state-store.js:91-152`. The read-only snapshot rule is enforced only in tests.
- **BLOCKED reap:** keys on `phase === BLOCKED` and does not re-derive the sentinel.
- **Cleanup order:** still one function.
- **Heartbeat sender:** reuses `API_BASE` and `fetchWithTimeout`.
- **Host-metric samplers:** 2 → 3. Informational.
- **Stale wording:** `phases.js:24-27` and `config.js:557`. Documentation.
- **`state-store-write-seam` and `phase-vocabulary-centralization`:** held.
- **LIN-3347:** 3 lines, unchanged.

## Adversarial Second-Read

**Tier used: Tier 2.** The reader was a fresh-context sub-agent with no memory of the report-writing turn. Tier 1, a separately dispatched session, was unavailable: this session's proxy token carries no `dispatch` grant (the `/instructions` grants line reads "(none)").

**Question asked:** "What is the largest item in this window that this report missed or misfiled?" The reader got the report path, both SHAs and the window bounds (`e24f8d12..ea96357a`, SD `3dc08b5b..4c9fb76`), and was told to check source rather than prose.

**Fields:** `Adversarial second-read verdict: AGREE` · `Differed from top finding: NO` · `Disposition: fixed in place`

**Reader's answer, condensed:** the top finding's mechanism holds at HEAD (route auth, `validateToken` touch, `getConsumerLastSeenAt` readers, SD's independent timer, `lastPollOkAt` read nowhere but the listing), and nothing in the window outranks it. Nothing larger was missed; items that make finding 1 larger or the report less exact:
- SD's heartbeat is on by default at 60 s (`config.js:1293-1299`). Added to finding 1.
- `docs/proxy-integration.md:598-602` contradicts the mechanism. Added to finding 1 and the Documentation hand-off.
- `lib/github-install-flow.js` changed +109/−36 (LIN-3404), so "0-line diff" for credential modules was false, and a `listUserInstallationIds` lambda is copied in two routes. Added to finding 2.
- Citation fixes: `dispatch-integration.md:279` (not 281), `dispatch-factory.js:988` (not the import line), 12 added files (not "10 new modules"), and the SD contract-test pin is `LV_COMMIT = 'e2cc2ef0'` (re-pinned by LIN-1952) beside the stale `1804aeb6` header.
- Checked and correct: window size and diff stats, entrance line counts (4,553 → 2,360), the Tarjan figures (393/1,476/0 and 402/1,487/0, independently), `WAITING_WAKE_MARKERS` and its 10 callers, the byte-identical contract table (sha `291d8943…`), the heartbeat wire elements and the false "rename fails a test" comment, the stale freeze numbers, the 77-row / 39-decision arithmetic, and the `isOwner` twin.

**Disposition: fixed in place.** I re-checked each item at HEAD before applying it (`git diff --numstat` for the install flow, `git diff --diff-filter=A` for the 12 files, and the cited lines). The top finding, the severity order and the follow-up set are unchanged.

## Census rulings (all 89 `mustRule` groups)

Tool: `scripts/code-shape/census-review.mjs` at `ea96357a` vs `e24f8d12`, one area guide for both runs, scope `server.js` and `lib/`, `routes/`, `public/` JS. **468 groups: 89 to rule on, 261 tabled, 28 gone, 0 unranked.** One ruling per group: **30 real, 26 borderline, 33 noise.** Each ruling is this review's finding, not a question. The 30 real groups reduce to about **19 distinct decisions** (G0001/G0005, G0021/G0052, G0026/G0047, G0088–90/G0199/G0202 and G0156/G0166/G0168 are each one decision). `status` is the census's own, against `e24f8d12`. `areas / files` are the group's area and file counts. For a `real` ruling, the home column names the one place the decision should live (or both claimants); for `borderline` and `noise`, it gives the reason.

| # | id | decision | status | areas / files | ruling | home, claimants or reason | ledger row / ticket |
|---|---|---|---|---|---|---|---|
| 1 | G0001 | repeated comparison NODE_ENV == 'test' | shrunk | 7 / 17 | real | lib/should-mock-ai.js (+ shared limiter skipInTest) | ai-availability-gate-duplication; LIN-2847 |
| 2 | G0002 | record assembled from the same sources {remaining=ID.remaining, lim... | shrunk | 4 / 10 | real | lib/chat-request.js freeTierRefusal | routes-error-envelope-fragmentation |
| 3 | G0003 | repeated comparison kind == 'autopilot' | shrunk | 4 / 13 | real (subset) | session-summary findAnchorLoop / task-run-facts | LIN-3349 |
| 4 | G0004 | record assembled from the same sources {id=ID.id, identifier=ID.ide... | shrunk | 7 / 10 | noise | projection of three fields; no rule inside | — |
| 5 | G0005 | repeated comparison accessToken == 'test-token' | shrunk | 5 / 7 | real | lib/should-mock-ai.js | ai-availability-gate-duplication; LIN-2847 |
| 6 | G0006 | repeated comparison authType == 'oauth' | unchanged | 4 / 8 | real | lib/workspace.js getBindingCallScope | credential-decision-multiplicity |
| 7 | G0007 | record assembled from the same sources {deployInfo=getDeployInfo(),... | unchanged | 2 / 13 | real (cheap) | lib/components/page.js — 14 routes pass the same chrome options; one object in `components/page.js` ends it | — |
| 8 | G0008 | repeated comparison stopAt == 'pr' | grown | 4 / 8 | real | task-run-facts; dispatch-entrance inheritedStopAt | dispatch-entrance-field-duplication; LIN-3608, LIN-3521 |
| 9 | G0009 | repeated comparison type == 'completed' | unchanged | 6 / 8 | noise | provider state-type test; the shared predicate set is ruled at G0026/G0047 | — |
| 10 | G0010 | repeated comparison provider == 'jira' | unchanged | 2 / 6 | noise | provider switch at the edge; each branch differs | — |
| 11 | G0011 | repeated comparison kind == 'wake' | grown | 2 / 9 | real | dispatch-store isFreshRun | dispatch-entrance-field-duplication |
| 12 | G0012 | repeated comparison type == 'started' | unchanged | 5 / 7 | borderline | state-map isInProgress | — |
| 13 | G0013 | string set {'127.0.0.1', 'localhost'} as array [[...].includes, [..... | unchanged | 3 / 4 | real | lib/dispatch-targets.js | target-vocabulary |
| 14 | G0014 | repeated comparison status == 'taken' | unchanged | 2 / 9 | borderline | liveness-detectors | — |
| 15 | G0015 | tiny rule copied as a helper slugifyForFilename() (also: githubSlug... | unchanged | 5 / 8 | borderline | prompt-formatters slugifyForFilename | — |
| 16 | G0016 | tiny rule copied as a helper (anonymous)(), 9 copies of 1-4 statements | unchanged | 3 / 9 | borderline | lib/openrouter.js | — |
| 17 | G0017 | text contract marker: [evidence] | shrunk | 5 / 6 | real | session-telemetry EVIDENCE_PREFIX | cross-repo-sentinel; LIN-3624 |
| 18 | G0018 | repeated comparison provider == 'linear' | unchanged | 2 / 4 | borderline | workspace-token-refresh defaultResolveExchange | credential-decision-multiplicity |
| 19 | G0019 | repeated comparison name == 'AbortError' | unchanged | 4 / 6 | noise | standard fetch-abort check | — |
| 20 | G0020 | repeated comparison NODE_ENV == 'production' | unchanged | 2 / 4 | noise | environment switch, not a domain decision | — |
| 21 | G0021 | string set {'aborted', 'done', 'failed', 'skipped'} as Set/or-chain... | unchanged | 4 / 5 | real | lib/dispatch-terminal.js | LIN-1496; human-wait |
| 22 | G0022 | text contract marker: [blocked] | shrunk | 3 / 7 | borderline | dispatch-terminal — the parse side is the authority; the emit side is the kit (row 11) | cross-repo-sentinel; LIN-3624 |
| 23 | G0023 | named constant UUID_REGEX=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-... | unchanged | 4 / 6 | borderline | lib/workspace.js | — |
| 24 | G0024 | repeated comparison type == 'blocks' | unchanged | 3 / 10 | noise | relation type literal; one meaning | — |
| 25 | G0025 | literal record repeated verbatim {Cache-Control="no-cache", Connect... | shrunk | 2 / 5 | real | lib/http-keepalive.js | sse-frame-writer-duplication; LIN-3475 |
| 26 | G0026 | string set {'canceled', 'completed'} as Set/or-chain [FINISHED_STAT... | unchanged | 4 / 4 | real (drift) | state-map isTerminalState | — |
| 27 | G0027 | record assembled from the same sources {token=ID.token, expiresAt=I... | unchanged | 3 / 3 | borderline | server.js resolver — cache tuple; follows the credential row, no separate decision | credential-decision-multiplicity |
| 28 | G0028 | repeated comparison provider == 'local' | unchanged | 4 / 4 | noise | provider switch at the edge | — |
| 29 | G0029 | record assembled from the same sources {code=ID.code, category=ID.c... | unchanged | 4 / 7 | real (cheap) | lib/errors.js — refusal envelope; `lib/errors.js` is the home | routes-error-envelope-fragmentation |
| 32 | G0032 | tiny rule copied as a helper (anonymous)(), 8 copies of 1-4 statements | unchanged | 5 / 6 | borderline | providers/linear | — |
| 34 | G0034 | string set {'Apr', 'Aug', 'Dec', 'Feb', 'Jan', 'Jul', +6} as array ... | unchanged | 3 / 5 | noise | month names for display; harmless | — |
| 35 | G0035 | repeated comparison recommendedAction == 'defer' | unchanged | 3 / 4 | borderline | recommend-recurse | — |
| 37 | G0037 | repeated comparison code == 'OWNER_CHECK_UNAVAILABLE' | unchanged | 3 / 5 | borderline | proxy-preamble — sentinel string shared by two modules; follows the credential row | credential |
| 39 | G0039 | tiny rule copied as a helper (anonymous)() (also: brief), 3 copies ... | new | 3 / 3 | noise (new only because mocks moved, LIN-3596) | new only because LIN-3596 moved the mocks; same shape | — |
| 43 | G0043 | repeated comparison category == 'auth' | unchanged | 4 / 4 | noise | error-category branch at the edge | — |
| 47 | G0047 | string set {'canceled', 'completed', 'duplicate'} as Set/array [TER... | unchanged | 3 / 6 | real | providers/models TERMINAL_TYPES | — |
| 48 | G0048 | repeated comparison outcome == 'self-resolved' | unchanged | 3 / 4 | noise | self-resolved flag, one producer | — |
| 52 | G0052 | string set {'complete', 'error'} as Set/or-chain [LOOP_TERMINAL_AGE... | unchanged | 3 / 3 | real | lib/dispatch-terminal.js | LIN-1496 |
| 56 | G0056 | repeated comparison outcome == 'dismissed' | unchanged | 3 / 4 | borderline | task-decisions-store | — |
| 61 | G0061 | repeated comparison status == 'ready' | unchanged | 3 / 5 | noise | ready status literal; unrelated meanings | — |
| 62 | G0062 | repeated comparison stateType == 'started' | shrunk | 3 / 11 | borderline | render-roadmap | — |
| 67 | G0067 | repeated comparison variant == 'stepper' | shrunk | 3 / 3 | noise | variant literal; the validator is G0150 | — |
| 68 | G0068 | text contract marker: [failed] | grown | 3 / 4 | borderline | dispatch-terminal parses / kit emits | runner-contract; LIN-3624 |
| 69 | G0069 | repeated comparison turnKind == 'user-initiated' | unchanged | 4 / 5 | borderline | lib/agent-turn.js | — |
| 71 | G0071 | repeated comparison agentState == 'error' | unchanged | 3 / 3 | noise | agent-state test; ruled at G0052 | — |
| 78 | G0078 | tiny rule copied as a helper _issueRef() (also: refOf, projectNeigh... | unchanged | 3 / 3 | noise | ref projections with different fields | — |
| 79 | G0079 | text contract marker: [ticket-closer] | shrunk | 3 / 3 | borderline | `lib/ticket-close-closer.js` (owns `LOG`) — a console tag, not a posted marker | not cross-repo-sentinel (a console tag, not a posted marker) |
| 80 | G0080 | string set {'fable', 'haiku', 'opus', 'sonnet'} as array [DISPATCH_... | unchanged | 3 / 3 | borderline | `lib/render-settings.js` ↔ `public/common.js` | — |
| 81 | G0081 | record assembled from the same sources {id=ID.id, body=ID.body, cre... | shrunk | 4 / 5 | noise | comment record, three fields | — |
| 82 | G0082 | near-duplicate function clear(), ~7 statements, structurally identical | unchanged | 3 / 8 | borderline | none (no base Mongo store exists) | — |
| 86 | G0086 | tiny rule copied as a helper (anonymous)() (also: loadLoops), 3 cop... | unchanged | 3 / 3 | borderline | `lib/pipeline-loops.js` (owns `getLoopsForWorkspace`) | — |
| 88 | G0088 | text contract heading: changelog | unchanged | 3 / 4 | real | `lib/workspace-api-mocks.js` `buildMockBrief` (headings as a contract) | mock-ai-builder-copies |
| 89 | G0089 | text contract heading: constraints | unchanged | 3 / 4 | real | as G0088 | mock-ai-builder-copies |
| 90 | G0090 | text contract heading: open questions | unchanged | 3 / 4 | real | as G0088 | mock-ai-builder-copies |
| 95 | G0095 | string set {'assistant', 'user'} as or-chain/if-chain [ID.role] | unchanged | 4 / 6 | borderline | lib/chat-transcript.js filterChatTurns (bypassed ×3) — role filter; `filterChatTurns` is bypassed three times (LIN-2430 residue) | LIN-2430 residue |
| 96 | G0096 | tiny rule copied as a helper hashEmailRecipient() (also: hashState,... | unchanged | 3 / 8 | noise | hash helper, identical by design | — |
| 102 | G0102 | string set {'0', '1', '2', '3', '4'} as table-keys [PRIORITY_LABELS... | unchanged | 4 / 7 | real | `lib/render.js` `PRIORITY_OPTION_LABELS`; the wire's priority label should use it | priority-label-maps |
| 117 | G0117 | tiny rule copied as a helper stripCodeFence() (also: trimToNull, pa... | unchanged | 4 / 4 | noise | small parse helpers, coincidental similarity | — |
| 123 | G0123 | tiny rule copied as a helper escapeHtml() (also: escapeXml), 3 copi... | unchanged | 3 / 3 | noise | escape helpers per output format | — |
| 129 | G0129 | string set {'merged', 'partial'} as or-chain/Set [ID.closeOut.statu... | new | 3 / 4 | real | `lib/run-closeout-state.js` (owns `PARTIAL`/`MERGED`); export an `isMerged` predicate | close-out-merged-refusal-split |
| 135 | G0135 | repeated comparison kind == 'bootstrap' | unchanged | 3 / 3 | noise | bootstrap kind literal, one meaning | — |
| 149 | G0149 | tiny rule copied as a helper constructor(), 5 copies of 1-4 statements | unchanged | 3 / 5 | noise | store constructors | — |
| 150 | G0150 | string set {'standard', 'stepper'} as array/ternary-chain [AUTOPILO... | unchanged | 3 / 3 | borderline | `lib/prompts/autopilot-kickoff.js` `AUTOPILOT_VARIANTS` — `AUTOPILOT_VARIANTS` already exists; callers should import it (row 36) | dispatch-entrance-field-duplication (variant) |
| 155 | G0155 | repeated comparison phase == 'result' | unchanged | 3 / 3 | noise | phase literal in one module | — |
| 156 | G0156 | string set {'blocked', 'queued', 'resolved', 'silent', 'terminal', ... | unchanged | 3 / 3 | real (copying is a house rule) | `lib/observer-sweep.js` (producer) | LIN-2481 (Backlog, stale instance-key roster) |
| 166 | G0166 | named constant SWEEP_INSTANCE_PREFIX="sweep:v1:" | unchanged | 3 / 3 | real | `lib/observer-sweep.js` (the writer; uses an inline literal at :449) | LIN-2481 |
| 168 | G0168 | named constant COMPANION_INSTANCE_PREFIX="companion:v1:" | unchanged | 3 / 3 | real | `lib/agent-turn.js` (writer) over `lib/flight-companion-*` (reader) | observer-instance-key-copies |
| 172 | G0172 | repeated comparison status == 'owner' | grown | 4 / 5 | real | `lib/workspace-owner.js` (produces the `{status}` answer); add `isOwnerAnswer()` | owner-answer-reader-copies |
| 179 | G0179 | repeated comparison kind == 'implementation' | grown | 3 / 4 | real (small) | `lib/file-pointer.js` `isPilotEligible` | LIN-3200 (Done) residue |
| 194 | G0194 | repeated comparison status == 'done' | unchanged | 3 / 3 | noise | done status literal; unrelated meanings | — |
| 195 | G0195 | tiny rule copied as a helper normalizePrivateKey() (also: cleanClai... | unchanged | 3 / 3 | noise | string cleanup helpers, coincidental | — |
| 199 | G0199 | near-duplicate function buildMockRecapContext() (also: buildMockRec... | new | 3 / 3 | real | `lib/workspace-api-mocks.js` `buildMockRecapContext` | as G0088 |
| 202 | G0202 | tiny rule copied as a helper (anonymous)(), 3 copies of 1-4 statements | shrunk | 3 / 3 | real | as G0199 | as G0088 |
| 223 | G0223 | repeated comparison kind == 'evidence' | shrunk | 3 / 3 | noise | feedback kind literal | — |
| 228 | G0228 | string set {'backlog', 'canceled', 'completed', 'duplicate', 'start... | unchanged | 3 / 5 | real | `lib/providers/state-map.js` `getStateDisplay`/`getStateOrder` | state-type-label-rank-maps; LIN-3612 adjacent |
| 231 | G0231 | repeated comparison state == 'waiting' | shrunk | 3 / 3 | borderline | `lib/task-page-loader.js` `UNENDED_STATES` — `UNENDED_STATES` in the loader; adjacent to row 55 | adjacent to human-wait-derivation-split |
| 257 | G0257 | named constant UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-... | unchanged | 3 / 3 | noise | (`lib/workspace.js` `UUID_REGEX` exists) | — |
| 261 | G0261 | near-duplicate function get(), ~7 statements, fuzzy | unchanged | 3 / 6 | borderline | as G0082 — store `get`; same as G0082 | — |
| 273 | G0273 | string set {'backlog', 'started', 'unstarted'} as switch/array/tabl... | unchanged | 3 / 4 | borderline | `lib/providers/state-map.js` (`isTerminalState`, `getStateOrder`) — state rank sets; covered by row 66 | LIN-3612 |
| 279 | G0279 | string set {'backlog', 'unstarted'} as array/or-chain [stateTypes, ... | shrunk | 4 / 4 | borderline | lib/providers/state-map.js (isReadyState) — ready = backlog or unstarted; covered by row 66 | LIN-3612 |
| 283 | G0283 | near-duplicate function find() (also: componentFind), ~9 statements... | unchanged | 3 / 4 | noise | union-find helper, generic | — |
| 289 | G0289 | near-duplicate function _pruneToCapacity(), ~6 statements, fuzzy | unchanged | 3 / 5 | borderline | as G0082 — `_pruneToCapacity` per cache; same as G0082 | — |
| 312 | G0312 | named constant MS_PER_DAY=86400000 | unchanged | 3 / 3 | noise | `MS_PER_DAY` constant, inert | — |
| 323 | G0323 | tiny rule copied as a helper clampText(), 3 copies of 1-4 statements | unchanged | 3 / 3 | noise | `clampText` copies differ in limit | — |
| 359 | G0359 | tiny rule copied as a helper constructor(), 5 copies of 1-4 statements | unchanged | 3 / 5 | noise | cache constructors | — |
| 361 | G0361 | string set {'Deep Dive', 'Front Page', 'The Column', 'The Wire', 'W... | unchanged | 4 / 4 | real (cheap) | `lib/ship-biscuit.js` `DESKS` (exported) | — |
| 369 | G0369 | tiny rule copied as a helper cleanup(), 3 copies of 1-4 statements | unchanged | 3 / 3 | noise | `cleanup()` per store | — |
| 389 | G0389 | tiny rule copied as a helper stableById() (also: byWorkspaceId), 3 ... | unchanged | 3 / 3 | noise | sort comparators | — |
| 414 | G0414 | string set {'E', 'N', 'NE', 'NW', 'S', 'SE', +2} as array/table-key... | unchanged | 3 / 3 | noise | (`lib/ship-layout.js` `BEARINGS` exists) | — |

**Mapping onto existing ledger rows** (so the ledger stays continuous): `ai-availability-gate-duplication` G0001, G0005; `routes-error-envelope-fragmentation` G0002, G0029; `credential-decision-multiplicity` G0006, G0018, G0027, G0037; `dispatch-entrance-field-duplication` G0008, G0011, G0150; `target-vocabulary` G0013; `cross-repo-sentinel-decision-marker-vocabulary` G0017, G0022, G0068; `human-wait-derivation-split` G0021, G0231; `sse-frame-writer-duplication` (LIN-3475) G0025; `close-out-merged-refusal-split` G0129. The other real groups are the new ledger rows in finding 9.

## Census table groups (261, no ruling)

By detector: cmp 96, clone 83, const 23, discrim 15, contract 14, set 14, record 11, set+discrim 5. By status: unchanged 234, new 11, shrunk 10, grown 6. No ruling is given and no prose is written for these; the changed rows are listed first, then the full table.

| status | groups |
|---|---|
| **new** | G0087 (`relayDispatchRefusal` copy; refusal-relay residue) · G0124 `kind=='recap'` · G0126 `action=='save'` · G0214 `MONTHS` (copied by LIN-3590) · G0239 prompt-opts record rebuilt in the browser · G0262 `isId` ×4 (LIN-1952 validators) · G0277 `{prompt,model,harness}` · G0310 `{queued,running,waiting}` `UNENDED_STATES` · G0322 scope vocabulary (re-key of G0087/G0123) · G0382 `isActive` (re-key of G0393) · G0385 `revokeByCreator`/`revokeByOwner` (LIN-3421) |
| **grown** | G0070 `source=='free'` (AI gate) · G0085 `kind=='decision'` (LIN-3451) · G0121 · G0208 (connection-binding) · G0332, G0388 (tool regrouping, no code change) |
| **shrunk** | G0045, G0046, G0125, G0205, G0209, G0215, G0302, G0342, G0355, G0466 |

| rank | id | detector | decision | status | areas / files |
|---|---|---|---|---|---|
| 30 | G0030 | contract | text contract heading: what ci did not prove | unchanged | 2 / 6 |
| 31 | G0031 | cmp | repeated comparison key == 'Escape' | unchanged | 1 / 5 |
| 33 | G0033 | cmp | repeated comparison key == 'Enter' | unchanged | 1 / 6 |
| 36 | G0036 | cmp | repeated comparison disposition == 'resumable' | unchanged | 2 / 4 |
| 38 | G0038 | set+discrim | string set {'decision-answer', 'decision-withdrawal-reversed', 'decis... | unchanged | 2 / 6 |
| 40 | G0040 | cmp | repeated comparison status == 'fulfilled' | unchanged | 2 / 3 |
| 41 | G0041 | clone | tiny rule copied as a helper clear(), 5 copies of 1-4 statements | unchanged | 2 / 5 |
| 42 | G0042 | discrim | string set {'answered', 'dismissed'} as or-chain [ID.outcome] | unchanged | 2 / 3 |
| 44 | G0044 | cmp | repeated comparison target == 'local' | unchanged | 2 / 4 |
| 45 | G0045 | record | record assembled from the same sources {id=ID.id, title=ID.title, lab... | shrunk | 2 / 3 |
| 46 | G0046 | cmp | repeated comparison getAttribute() == 'true' | shrunk | 1 / 5 |
| 49 | G0049 | cmp | repeated comparison provider == 'github' | unchanged | 2 / 2 |
| 50 | G0050 | cmp | repeated comparison provider == 'github-projects' | unchanged | 2 / 2 |
| 51 | G0051 | set | string set {'LINEAR_CLIENT_ID', 'LINEAR_CLIENT_SECRET', 'LINEAR_REDIR... | unchanged | 2 / 2 |
| 53 | G0053 | const | named constant TOKEN_REFRESH_BUFFER_MS=300000 | unchanged | 2 / 2 |
| 54 | G0054 | cmp | repeated comparison rawTeam == 'all' | unchanged | 2 / 2 |
| 55 | G0055 | record | literal record repeated verbatim {effort=null, harness=null, model=null} | unchanged | 2 / 2 |
| 57 | G0057 | const | named constant CONTEXT_FETCH_TIMEOUT_MS=45000 | unchanged | 2 / 2 |
| 58 | G0058 | cmp | repeated comparison enabled == 'true' | unchanged | 2 / 2 |
| 59 | G0059 | contract | text contract marker: [observer-pass] | unchanged | 2 / 2 |
| 60 | G0060 | contract | text contract marker: [liveness-alarm-sweep] | unchanged | 2 / 2 |
| 63 | G0063 | cmp | repeated comparison kind == 'capture' | unchanged | 2 / 2 |
| 64 | G0064 | cmp | repeated comparison urlKey == 'test-workspace' | unchanged | 2 / 2 |
| 65 | G0065 | discrim | string set {'github', 'github-projects', 'jira', 'linear'} as switch/... | unchanged | 2 / 2 |
| 66 | G0066 | clone | near-duplicate function clear() (also: clearHistory), ~7 statements, ... | unchanged | 1 / 4 |
| 70 | G0070 | cmp | repeated comparison source == 'free' | grown | 2 / 3 |
| 72 | G0072 | cmp | repeated comparison state == 'record' | unchanged | 2 / 3 |
| 73 | G0073 | contract | text contract marker: [dispatch] | unchanged | 2 / 3 |
| 74 | G0074 | cmp | repeated comparison mode == 'add-source' | unchanged | 2 / 6 |
| 75 | G0075 | cmp | repeated comparison status == 'queued' | unchanged | 2 / 4 |
| 76 | G0076 | cmp | repeated comparison status == 'merged' | unchanged | 2 / 3 |
| 77 | G0077 | cmp | repeated comparison agentState == 'queued' | unchanged | 2 / 3 |
| 83 | G0083 | const | named constant DANGEROUS_CHARS_REGEX=/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/ | unchanged | 2 / 4 |
| 84 | G0084 | const | named constant MAX_NAME_LENGTH=1000 | unchanged | 2 / 4 |
| 85 | G0085 | cmp | repeated comparison kind == 'decision' | grown | 1 / 4 |
| 87 | G0087 | clone | near-duplicate function (anonymous)() (also: relayDispatchRefusal), ~... | new | 2 / 2 |
| 91 | G0091 | discrim | string set {'cancelled', 'expired'} as or-chain [ID.historyStatus, ID... | unchanged | 1 / 3 |
| 94 | G0094 | clone | near-duplicate function countTokens() (also: countItems), ~7 statemen... | unchanged | 2 / 3 |
| 97 | G0097 | clone | tiny rule copied as a helper onEvent() (also: (anonymous)), 5 copies ... | unchanged | 2 / 4 |
| 98 | G0098 | cmp | repeated comparison marker == 'pending' | unchanged | 1 / 3 |
| 99 | G0099 | cmp | repeated comparison toLowerCase() == 'bug' | unchanged | 2 / 3 |
| 100 | G0100 | cmp | repeated comparison harness == 'claude-code' | unchanged | 2 / 3 |
| 101 | G0101 | set | string set {'cdn.linear.app', 'linear.app', 'uploads.linear.app'} as ... | unchanged | 2 / 2 |
| 103 | G0103 | set+discrim | string set {'done', 'failed'} as or-chain/table-keys [ID.terminalStat... | unchanged | 2 / 3 |
| 104 | G0104 | cmp | repeated comparison finishReason == 'length' | unchanged | 2 / 5 |
| 105 | G0105 | clone | tiny rule copied as a helper ui(), 5 copies of 1-4 statements | unchanged | 1 / 5 |
| 106 | G0106 | cmp | repeated comparison name == 'list_pending_decisions' | unchanged | 2 / 3 |
| 107 | G0107 | set+discrim | string set {'github', 'github-projects'} as Set/or-chain [REMINT_KIND... | unchanged | 1 / 4 |
| 108 | G0108 | const | named constant ARCHIVE_PAGE_SIZE=30 | unchanged | 2 / 2 |
| 109 | G0109 | const | named constant STALE_AFTER_MS=86400000 | unchanged | 2 / 2 |
| 110 | G0110 | cmp | repeated comparison disposition == 'task-bound' | unchanged | 2 / 2 |
| 111 | G0111 | cmp | repeated comparison status == 'error' | unchanged | 2 / 2 |
| 112 | G0112 | cmp | repeated comparison view == 'sessions' | unchanged | 2 / 2 |
| 113 | G0113 | cmp | repeated comparison name == 'linear' | unchanged | 2 / 2 |
| 114 | G0114 | contract | text contract marker: [skipped] | unchanged | 2 / 3 |
| 115 | G0115 | cmp | repeated comparison by == 'close-out' | unchanged | 2 / 2 |
| 116 | G0116 | clone | tiny rule copied as a helper buildPromptFilename(), 3 copies of 1-4 s... | unchanged | 2 / 3 |
| 118 | G0118 | cmp | repeated comparison code == 'ERR_FR_TOO_MANY_REDIRECTS' | unchanged | 2 / 2 |
| 119 | G0119 | cmp | repeated comparison message == 'reverseOutcome: row is not self-resol... | unchanged | 2 / 2 |
| 120 | G0120 | cmp | repeated comparison format == 'md' | unchanged | 2 / 2 |
| 121 | G0121 | clone | tiny rule copied as a helper (anonymous)(), 5 copies of 1-4 statements | grown | 2 / 4 |
| 122 | G0122 | contract | text contract marker: [credential-adopted] | unchanged | 2 / 2 |
| 124 | G0124 | cmp | repeated comparison kind == 'recap' | new | 2 / 2 |
| 125 | G0125 | record | record assembled from the same sources {urlKey=ID.urlKey, prUrl=ID.pr... | shrunk | 2 / 2 |
| 126 | G0126 | cmp | repeated comparison action == 'save' | new | 2 / 2 |
| 127 | G0127 | set | string set {'autopilot', 'save', 'triage'} as table-keys/Set [SENDING... | unchanged | 2 / 2 |
| 128 | G0128 | contract | text contract heading: workflow | unchanged | 1 / 3 |
| 130 | G0130 | cmp | repeated comparison code == 'RUN_LIMIT_UNVERIFIED' | unchanged | 2 / 2 |
| 131 | G0131 | cmp | repeated comparison agentState == 'waiting' | unchanged | 2 / 2 |
| 132 | G0132 | discrim | string set {'1', 'true'} as or-chain [ID.query.cachedOnly, ID.query.n... | unchanged | 2 / 2 |
| 133 | G0133 | clone | near-duplicate function peakToolCount() (also: toolPeakOf), ~9 statem... | unchanged | 2 / 2 |
| 134 | G0134 | cmp | repeated comparison kind == 'assistant-text' | unchanged | 2 / 2 |
| 136 | G0136 | set | string set {'backlog', 'done', 'failed', 'in-progress', 'todo'} as ta... | unchanged | 2 / 3 |
| 140 | G0140 | const | named constant POLL_MS=5000 | unchanged | 1 / 3 |
| 141 | G0141 | const | named constant DEFAULT_HARNESS="claude-code" | unchanged | 2 / 2 |
| 142 | G0142 | const | named constant DISPATCH_CLAUDE_MODEL_SUGGESTIONS=[fable,haiku,opus,so... | unchanged | 2 / 2 |
| 143 | G0143 | const | named constant DISPATCH_HARNESS_SUGGESTIONS=[claude-code,opencode] | unchanged | 2 / 2 |
| 144 | G0144 | const | named constant DISPATCH_MODEL_OTHER_VALUE="__other__" | unchanged | 2 / 2 |
| 145 | G0145 | const | named constant DISPATCH_MODEL_SUGGESTIONS=[anthropic/claude-fable-5,a... | unchanged | 2 / 2 |
| 146 | G0146 | clone | near-duplicate function readRunFacts() (also: readTaskRunFacts), ~30 ... | unchanged | 2 / 2 |
| 147 | G0147 | set | string set {'anthropic/claude-fable-5', 'anthropic/claude-haiku-4.5',... | unchanged | 2 / 2 |
| 148 | G0148 | set | string set {'claude-code', 'opencode'} as array [DISPATCH_HARNESS_SUG... | unchanged | 2 / 2 |
| 151 | G0151 | cmp | repeated comparison protocol == 'https:' | unchanged | 2 / 2 |
| 152 | G0152 | cmp | repeated comparison phase == 'error' | unchanged | 2 / 3 |
| 153 | G0153 | cmp | repeated comparison phase == 'proposed' | unchanged | 2 / 3 |
| 154 | G0154 | clone | tiny rule copied as a helper constructor(), 6 copies of 1-4 statements | unchanged | 2 / 6 |
| 157 | G0157 | contract | text contract marker: [working] | unchanged | 2 / 3 |
| 161 | G0161 | cmp | repeated comparison source == 'live' | unchanged | 1 / 3 |
| 163 | G0163 | cmp | repeated comparison section == 'prompt' | unchanged | 2 / 2 |
| 164 | G0164 | cmp | repeated comparison section == 'reasoning' | unchanged | 2 / 2 |
| 165 | G0165 | cmp | repeated comparison state == 'open' | unchanged | 2 / 5 |
| 167 | G0167 | clone | tiny rule copied as a helper header() (also: setupNoticeHtml), 3 copi... | unchanged | 1 / 3 |
| 169 | G0169 | cmp | repeated comparison section == 'recent-activity' | unchanged | 2 / 3 |
| 170 | G0170 | cmp | repeated comparison turnKind == 'boot' | unchanged | 2 / 3 |
| 173 | G0173 | cmp | repeated comparison value == 'true' | unchanged | 2 / 2 |
| 174 | G0174 | cmp | repeated comparison disposition == 'gone' | unchanged | 2 / 2 |
| 175 | G0175 | clone | tiny rule copied as a helper (anonymous)(), 3 copies of 1-4 statements | unchanged | 1 / 3 |
| 176 | G0176 | clone | near-duplicate function relativeTime() (also: renderDeployInfo), ~22 ... | unchanged | 2 / 2 |
| 178 | G0178 | contract | text contract marker: [aborted] | unchanged | 2 / 2 |
| 180 | G0180 | cmp | repeated comparison state == 'closed' | unchanged | 2 / 5 |
| 181 | G0181 | clone | near-duplicate function computeFitZoom(), ~11 statements, same vocabu... | unchanged | 2 / 2 |
| 182 | G0182 | cmp | repeated comparison kind == 'custom' | unchanged | 2 / 2 |
| 183 | G0183 | clone | near-duplicate function clampTimelineWindow() (also: clampWindow), ~1... | unchanged | 2 / 2 |
| 184 | G0184 | clone | near-duplicate function computeTimelineFit(), ~10 statements, same vo... | unchanged | 2 / 2 |
| 185 | G0185 | clone | near-duplicate function computeTimelineZoom(), ~15 statements, same v... | unchanged | 2 / 2 |
| 186 | G0186 | clone | near-duplicate function firstPromptLine() (also: toStackHeadline), ~6... | unchanged | 2 / 2 |
| 187 | G0187 | clone | near-duplicate function renderChip(), ~8 statements, fuzzy | unchanged | 2 / 2 |
| 188 | G0188 | clone | near-duplicate function renderStatusPill(), ~17 statements, fuzzy | unchanged | 2 / 2 |
| 189 | G0189 | clone | near-duplicate function renderSurface(), ~11 statements, fuzzy | unchanged | 2 / 2 |
| 190 | G0190 | clone | near-duplicate function renderTag(), ~11 statements, fuzzy | unchanged | 2 / 2 |
| 191 | G0191 | cmp | repeated comparison scope == 'readWrite' | unchanged | 2 / 2 |
| 192 | G0192 | set | string set {'autopilot', 'blocked', 'breakdown', 'bug', 'close-out', ... | unchanged | 2 / 2 |
| 193 | G0193 | discrim | string set {'indeterminate', 'mid-turn'} as or-chain [ID.disposition] | unchanged | 2 / 2 |
| 197 | G0197 | contract | text contract marker: [done] | unchanged | 2 / 2 |
| 198 | G0198 | clone | tiny rule copied as a helper buildBriefMessages() (also: buildNextRun... | unchanged | 2 / 9 |
| 200 | G0200 | cmp | repeated comparison readyState == 'loading' | unchanged | 1 / 3 |
| 201 | G0201 | discrim | string set {'closed', 'multiple-prs', 'no-pr', 'not-ready'} as or-cha... | unchanged | 2 / 3 |
| 205 | G0205 | cmp | repeated comparison state == 'done' | shrunk | 2 / 3 |
| 206 | G0206 | const | named constant MAX_IDENTIFIER_LENGTH=100 | unchanged | 2 / 2 |
| 207 | G0207 | clone | near-duplicate function groupLoopsByLineage() (also: runsByLineage), ... | unchanged | 2 / 2 |
| 208 | G0208 | clone | tiny rule copied as a helper (anonymous)(), 4 copies of 1-4 statements | grown | 1 / 3 |
| 209 | G0209 | cmp | repeated comparison state == 'running' | shrunk | 2 / 3 |
| 213 | G0213 | record | literal record repeated verbatim {lastCensusSnapshot=null, lastCensus... | unchanged | 2 / 2 |
| 214 | G0214 | const | named constant MONTHS=[Apr,Aug,Dec,Feb,Jan,Jul,Jun,Mar,May,Nov,Oct,Sep] | new | 2 / 2 |
| 215 | G0215 | clone | near-duplicate function (anonymous)(), ~6 statements, fuzzy | shrunk | 2 / 2 |
| 216 | G0216 | cmp | repeated comparison singleUse == 'true' | unchanged | 2 / 2 |
| 219 | G0219 | clone | near-duplicate function constructor(), ~5 statements, fuzzy | unchanged | 1 / 3 |
| 222 | G0222 | const | named constant HOUR_MS=3600000 | unchanged | 2 / 3 |
| 224 | G0224 | cmp | repeated comparison status == 'skipped' | unchanged | 2 / 3 |
| 225 | G0225 | clone | tiny rule copied as a helper asShare() (also: asRate), 3 copies of 1-... | unchanged | 2 / 3 |
| 226 | G0226 | cmp | repeated comparison reason == 'free-tier' | unchanged | 2 / 2 |
| 227 | G0227 | cmp | repeated comparison status == 'priced' | unchanged | 2 / 2 |
| 229 | G0229 | set+discrim | string set {'http:', 'https:'} as array/or-chain [[...].includes, ID.... | unchanged | 2 / 4 |
| 234 | G0234 | cmp | repeated comparison tier == 'not reported' | unchanged | 2 / 2 |
| 235 | G0235 | cmp | repeated comparison turnKind == 'auto-wake' | unchanged | 2 / 2 |
| 237 | G0237 | clone | near-duplicate function cleanup(), ~8 statements, fuzzy | unchanged | 1 / 3 |
| 238 | G0238 | clone | near-duplicate function listForWorkspaces() (also: listUnansweredForW... | unchanged | 1 / 3 |
| 239 | G0239 | record | record assembled from the same sources {promptMeta=ID.promptMeta, def... | new | 2 / 2 |
| 243 | G0243 | cmp | repeated comparison mode == 'new' | unchanged | 1 / 3 |
| 244 | G0244 | cmp | repeated comparison state == 'unknown' | unchanged | 2 / 3 |
| 245 | G0245 | discrim | string set {'gone', 'resumable', 'task-bound'} as or-chain | unchanged | 2 / 2 |
| 246 | G0246 | clone | near-duplicate function dispatchSessionFollowUp() (also: send_follow_... | unchanged | 2 / 2 |
| 249 | G0249 | clone | near-duplicate function deleteByConnection() (also: deleteUserPrefere... | unchanged | 1 / 3 |
| 251 | G0251 | contract | text contract marker: [usage] | unchanged | 1 / 3 |
| 256 | G0256 | set | string set {'dispatch', 'record', 'resume'} as Set/table-keys [ON_ANS... | unchanged | 2 / 2 |
| 258 | G0258 | clone | near-duplicate function listCalls() (also: listTraces, listEvents), ~... | unchanged | 2 / 3 |
| 262 | G0262 | clone | tiny rule copied as a helper isId() (also: shortString, (anonymous), ... | new | 2 / 4 |
| 263 | G0263 | cmp | repeated comparison status == 'no-owner' | unchanged | 2 / 3 |
| 272 | G0272 | clone | tiny rule copied as a helper resolveCanonicalDegraded() (also: resolv... | unchanged | 2 / 3 |
| 274 | G0274 | set | string set {'brief', 'flight-companion', 'next-run', 'recap', 'recomm... | unchanged | 2 / 2 |
| 275 | G0275 | cmp | repeated comparison stateType == 'backlog' | unchanged | 2 / 3 |
| 277 | G0277 | record | record assembled from the same sources {prompt=ID.prompt, model=ID.mo... | new | 2 / 2 |
| 278 | G0278 | cmp | repeated comparison mode == 'stop' | unchanged | 2 / 2 |
| 284 | G0284 | cmp | repeated comparison role == 'user' | unchanged | 2 / 3 |
| 285 | G0285 | cmp | repeated comparison kind == 'close-out' | unchanged | 2 / 2 |
| 290 | G0290 | const | named constant TIMELINE_WINDOW_MS=86400000 | unchanged | 2 / 2 |
| 292 | G0292 | cmp | repeated comparison name == 'send_follow_up' | unchanged | 2 / 2 |
| 301 | G0301 | cmp | repeated comparison s == 'complete' | unchanged | 2 / 2 |
| 302 | G0302 | set | string set {'/app.js', '/common.js'} as array [scripts] | shrunk | 1 / 3 |
| 303 | G0303 | const | named constant LANE_KEYS=[blocked,queued,resolved,silent,terminal,unk... | unchanged | 2 / 2 |
| 304 | G0304 | record | record assembled from the same sources {urlKey=ID.proxyUrlKey, create... | unchanged | 2 / 2 |
| 305 | G0305 | cmp | repeated comparison kind == 'periodical' | unchanged | 2 / 2 |
| 306 | G0306 | cmp | repeated comparison mergedBy == 'close-out' | unchanged | 2 / 2 |
| 307 | G0307 | cmp | repeated comparison state == 'queued' | unchanged | 2 / 2 |
| 308 | G0308 | cmp | repeated comparison status == 'not-owner' | unchanged | 2 / 2 |
| 310 | G0310 | set+discrim | string set {'queued', 'running', 'waiting'} as or-chain/Set [ID.state... | new | 2 / 2 |
| 311 | G0311 | contract | text contract marker: [string] | unchanged | 2 / 4 |
| 313 | G0313 | cmp | repeated comparison busy == 'true' | unchanged | 1 / 3 |
| 316 | G0316 | cmp | repeated comparison variant == 'standard' | unchanged | 2 / 2 |
| 317 | G0317 | discrim | string set {'comment', 'description'} as ternary-chain/or-chain [ID.w... | unchanged | 2 / 2 |
| 320 | G0320 | cmp | repeated comparison kind == 'decision-withdrawn' | unchanged | 2 / 2 |
| 321 | G0321 | cmp | repeated comparison stateType == 'unstarted' | unchanged | 2 / 2 |
| 322 | G0322 | set | string set {'inside', 'outside', 'total', 'unknown'} as array/table-k... | new | 2 / 2 |
| 327 | G0327 | cmp | repeated comparison harness == 'opencode' | unchanged | 2 / 2 |
| 328 | G0328 | cmp | repeated comparison view == 'digest' | unchanged | 2 / 2 |
| 332 | G0332 | clone | near-duplicate function (anonymous)(), ~12 statements, fuzzy | grown | 1 / 3 |
| 333 | G0333 | clone | near-duplicate function briefUrl() (also: recapUrl, scanUrl), ~6 stat... | unchanged | 1 / 3 |
| 334 | G0334 | discrim | string set {'fresh', 'stale'} as if-chain [ID.status] | unchanged | 1 / 3 |
| 337 | G0337 | cmp | repeated comparison type == 'canceled' | unchanged | 2 / 2 |
| 339 | G0339 | set | string set {'connected', 'firstGo', 'login', 'prOpened'} as array/tab... | unchanged | 2 / 2 |
| 341 | G0341 | contract | text contract heading: adversarial second-read | unchanged | 2 / 2 |
| 342 | G0342 | cmp | repeated comparison trim() == '---' | shrunk | 1 / 4 |
| 351 | G0351 | clone | tiny rule copied as a helper getAccount() (also: getById, getWorkspac... | unchanged | 2 / 3 |
| 353 | G0353 | record | record assembled from the same sources {urlKey=ID.urlKey, workspaceId... | unchanged | 2 / 2 |
| 355 | G0355 | cmp | repeated comparison type == 'heading' | shrunk | 2 / 2 |
| 357 | G0357 | contract | text contract heading: workspace api access (auto-appended) | unchanged | 2 / 2 |
| 358 | G0358 | clone | near-duplicate function delete(), ~7 statements, fuzzy | unchanged | 2 / 5 |
| 360 | G0360 | clone | near-duplicate function list() (also: listByWorkspace), ~9 statements... | unchanged | 2 / 4 |
| 363 | G0363 | const | named constant DEFAULT_HUMAN_NICK="John" | unchanged | 2 / 2 |
| 364 | G0364 | clone | near-duplicate function formatFossilThreshold() (also: formatStaleThr... | unchanged | 2 / 2 |
| 370 | G0370 | clone | near-duplicate function buildPassagePlannerKickoff() (also: buildPass... | unchanged | 1 / 3 |
| 371 | G0371 | clone | near-duplicate function graphql() (also: listUserInstallations, reque... | unchanged | 1 / 3 |
| 372 | G0372 | clone | tiny rule copied as a helper _docsSorted() (also: _docsFor), 3 copies... | unchanged | 2 / 3 |
| 373 | G0373 | clone | tiny rule copied as a helper fetchBriefStatus() (also: fetchContext, ... | unchanged | 1 / 3 |
| 379 | G0379 | cmp | repeated comparison verdict == 'credential_dead' | unchanged | 2 / 2 |
| 380 | G0380 | discrim | string set {'/kpis', '/logout', '/privacy', '/styleguide', '/template... | unchanged | 2 / 2 |
| 381 | G0381 | clone | tiny rule copied as a helper get(), 5 copies of 1-4 statements | unchanged | 2 / 5 |
| 382 | G0382 | clone | tiny rule copied as a helper (anonymous)() (also: isActive), 3 copies... | new | 2 / 3 |
| 385 | G0385 | clone | near-duplicate function revokeByCreator() (also: revokeByOwner), ~9 s... | new | 2 / 2 |
| 386 | G0386 | clone | tiny rule copied as a helper buildRoadmapDigestPrompt() (also: buildR... | unchanged | 1 / 6 |
| 387 | G0387 | clone | near-duplicate function orderByDependency(), ~59 statements, same voc... | unchanged | 2 / 4 |
| 388 | G0388 | clone | tiny rule copied as a helper union(), 4 copies of 1-4 statements | grown | 2 / 4 |
| 392 | G0392 | record | record assembled from the same sources {access_token=ID.access_token,... | unchanged | 2 / 2 |
| 394 | G0394 | cmp | repeated comparison error == 'invalid_grant' | unchanged | 2 / 2 |
| 395 | G0395 | cmp | repeated comparison kind == 'roadmap' | unchanged | 2 / 2 |
| 396 | G0396 | cmp | repeated comparison kind == 'session' | unchanged | 2 / 2 |
| 397 | G0397 | discrim | string set {'number', 'string'} as or-chain [typeofID] | unchanged | 2 / 2 |
| 398 | G0398 | const | named constant MAX_STUBS=20 | unchanged | 2 / 2 |
| 403 | G0403 | clone | near-duplicate function clusterSiblingsInLane() (also: computeShipRea... | unchanged | 2 / 3 |
| 404 | G0404 | clone | near-duplicate function get(), ~9 statements, structurally identical | unchanged | 2 / 4 |
| 405 | G0405 | clone | tiny rule copied as a helper delete(), 4 copies of 1-4 statements | unchanged | 2 / 4 |
| 406 | G0406 | clone | tiny rule copied as a helper deleteAll(), 4 copies of 1-4 statements | unchanged | 2 / 4 |
| 407 | G0407 | clone | tiny rule copied as a helper put(), 4 copies of 1-4 statements | unchanged | 2 / 4 |
| 408 | G0408 | clone | tiny rule copied as a helper put(), 4 copies of 1-4 statements | unchanged | 2 / 4 |
| 410 | G0410 | const | named constant PROJECTION_RISK_TYPES=Set[overdue,unestimated-critical... | unchanged | 2 / 2 |
| 411 | G0411 | const | named constant REPO_RE=/^[A-Za-z0-9._-]{1,100}$/ | unchanged | 2 / 2 |
| 412 | G0412 | set | string set {'digest', 'gap', 'northStarReading', 'product', 'technica... | unchanged | 2 / 2 |
| 413 | G0413 | set | string set {'overdue', 'unestimated-critical', 'velocity-declining'} ... | unchanged | 2 / 2 |
| 415 | G0415 | clone | tiny rule copied as a helper toRecord(), 3 copies of 1-4 statements | unchanged | 2 / 3 |
| 419 | G0419 | cmp | repeated comparison kind == 'plan' | unchanged | 2 / 2 |
| 423 | G0423 | discrim | string set {'implicit', 'label', 'state'} as switch [ID.type] | unchanged | 2 / 2 |
| 424 | G0424 | record | literal record repeated verbatim {AFT="aft", DRIFT="drift", FORWARD="... | unchanged | 2 / 2 |
| 425 | G0425 | clone | near-duplicate function bearingToAngle(), ~8 statements, structurally... | unchanged | 2 / 2 |
| 426 | G0426 | clone | near-duplicate function buildSegments(), ~59 statements, same vocabul... | unchanged | 2 / 2 |
| 427 | G0427 | clone | near-duplicate function cardMatchesHeading(), ~13 statements, same vo... | unchanged | 2 / 2 |
| 428 | G0428 | clone | near-duplicate function clusterSubtaskSiblings(), ~35 statements, sam... | unchanged | 2 / 2 |
| 429 | G0429 | clone | near-duplicate function computePosition(), ~11 statements, fuzzy | unchanged | 2 / 2 |
| 430 | G0430 | clone | near-duplicate function hash32(), ~11 statements, fuzzy | unchanged | 2 / 2 |
| 431 | G0431 | clone | near-duplicate function list(), ~7 statements, structurally identical | unchanged | 2 / 2 |
| 432 | G0432 | clone | near-duplicate function orientationLayout(), ~57 statements, same voc... | unchanged | 2 / 2 |
| 433 | G0433 | clone | near-duplicate function pickAngle(), ~10 statements, fuzzy | unchanged | 2 / 2 |
| 434 | G0434 | clone | near-duplicate function placeDriftBucket(), ~22 statements, fuzzy | unchanged | 2 / 2 |
| 435 | G0435 | clone | near-duplicate function placeSegmentBucket(), ~44 statements, same vo... | unchanged | 2 / 2 |
| 436 | G0436 | clone | near-duplicate function pushProjectSegments() (also: pushProjectSegs)... | unchanged | 2 / 2 |
| 437 | G0437 | clone | near-duplicate function stableStringify(), ~7 statements, structurall... | unchanged | 2 / 2 |
| 438 | G0438 | record | record assembled from the same sources {label=ID[].name, projectName=... | unchanged | 2 / 2 |
| 440 | G0440 | cmp | repeated comparison kind == 'label' | unchanged | 2 / 2 |
| 441 | G0441 | cmp | repeated comparison kind == 'project' | unchanged | 2 / 2 |
| 442 | G0442 | cmp | repeated comparison projectSector == 'port' | unchanged | 2 / 2 |
| 443 | G0443 | cmp | repeated comparison projectSector == 'starboard' | unchanged | 2 / 2 |
| 444 | G0444 | cmp | repeated comparison sector == 'drift' | unchanged | 2 / 2 |
| 445 | G0445 | cmp | repeated comparison sector == 'ship' | unchanged | 2 / 2 |
| 447 | G0447 | discrim | string set {'E', 'W'} as or-chain | unchanged | 2 / 2 |
| 448 | G0448 | const | named constant MAX_CUSTOM_PRESETS=20 | unchanged | 2 / 2 |
| 449 | G0449 | const | named constant MAX_PRESET_NAME_LENGTH=50 | unchanged | 2 / 2 |
| 450 | G0450 | clone | near-duplicate function assignLanes(), ~32 statements, same vocabular... | unchanged | 2 / 2 |
| 451 | G0451 | clone | near-duplicate function assignSegments(), ~21 statements, same vocabu... | unchanged | 2 / 2 |
| 452 | G0452 | clone | near-duplicate function buildChainLabel(), ~10 statements, same vocab... | unchanged | 2 / 2 |
| 453 | G0453 | clone | near-duplicate function cohereSubtaskGroups(), ~39 statements, same v... | unchanged | 2 / 2 |
| 454 | G0454 | clone | near-duplicate function computeCrossLaneColumns(), ~108 statements, s... | unchanged | 2 / 2 |
| 456 | G0456 | clone | near-duplicate function groupByAssignee() (also: groupByProject), ~10... | unchanged | 2 / 2 |
| 457 | G0457 | clone | near-duplicate function groupByStatus(), ~12 statements, same vocabul... | unchanged | 2 / 2 |
| 458 | G0458 | clone | near-duplicate function mergeLabels(), ~6 statements, fuzzy | unchanged | 2 / 2 |
| 459 | G0459 | clone | near-duplicate function mergeLanes(), ~9 statements, same vocabulary ... | unchanged | 2 / 2 |
| 460 | G0460 | cmp | repeated comparison grouping == 'dependency' | unchanged | 2 / 2 |
| 461 | G0461 | cmp | repeated comparison orientation == 'vertical' | unchanged | 2 / 2 |
| 462 | G0462 | cmp | repeated comparison rawKey == 'duplicate' | unchanged | 2 / 2 |
| 463 | G0463 | discrim | string set {'assignee', 'dependency', 'project', 'status'} as switch | unchanged | 2 / 2 |
| 465 | G0465 | discrim | string set {'dependency', 'project'} as or-chain | unchanged | 2 / 2 |
| 466 | G0466 | clone | near-duplicate function (anonymous)(), ~7 statements, fuzzy | shrunk | 2 / 2 |
| 467 | G0467 | clone | near-duplicate function layoutIndex(), ~30 statements, same vocabular... | unchanged | 2 / 2 |

## The 28 gone groups (gauge-validity note for LIN-3449 and LIN-3490)

"Gone" is not a resolution count. Read at both SHAs, the 28 classify as: **6 resolved by consolidation** (G0093, G0252, G0278 by LIN-3602; G0254, G0257 by LIN-3600; G0089 by `RECEIPTS`), **3 deleted code** (G0229, G0379 with `funnel-event-store`; G0291, partly), **11 removed by a rebuild but still duplicated** (G0066 `resolve*Input`; G0087/G0123 scope vocabulary; G0126–G0129 mock brief/recap and cache protocol between `proxy-compute.js` and `workspace-api-mocks.js`; G0169 halt-set handler, now 503 vs 500 when the store is missing; G0280 `applyCloseOutState` twin, now under the clone threshold; G0346→G0310; G0393→G0382), **1 removed by rebuild and was noise** (G0288), and **7 only re-keyed** (G0079→G0199, G0144→G0129, G0219→G0208, G0263→G0070/264/265, G0347→G0318, G0401→G0384, G0470→G0466). G0219 and G0470 had no code commits: they moved because LIN-3628/3629 changed the tool. **Only 9 of 28 left the code.** This is ledger row `census-gone-overstates-resolution`.

## Classes and their bounds


| class | how bounded | members |
|---|---|---|
| census `mustRule` groups | the tool's own rule (top 25 + ≥3 areas) | 89 (table above) |
| census gone groups | the tool's `gone` list, then classified by reading sites at both SHAs | 28: 6 consolidated, 3 deleted, 11 reshaped, 1 noise, 7 re-keyed |
| rebuilt modules (rebuild round) | ticket list in the description + `git show --stat` | LIN-3578, 3579 (4 files), 3590, 3591, 3596 (+mocks), 3569/3573 (3 files), 3566, 3556/3557/3565 |
| "consumer is listening" signals | grep `lastUsedAt`, `getConsumerLastSeenAt`, `NOBODY_LISTENING_MS`, heartbeat store readers | `lastUsedAt` (bumped by every `validateToken`, now including the heartbeat); heartbeat store (`GET /heartbeats` only); per-session `[working]` (`ACTIVE_FRESH_MS`); readers: Rule S, the `dispatch-factory` warning, the runner poll `otherConsumerLastSeenAt` |
| heartbeat wire elements | read both sides plus `contract.json` and docs | fields, schema, path, interval bounds, stale factor, TTL/cap/size (table under finding 1) |
| runner contract rows | `contract.json` rows + 10-12 rows + LIN-3624 list | halt ×5, target, repo, status cap, decision cap, heartbeat; untabled: 4 row fields, harness, abort texts, resume marker, `going down`, decision-prefix window, recap chunking, 4 markers |
| "waiting on a person" deciders | grep `'blocked'`/`"blocked"`/`WAITING_WAKE_MARKERS`/`isWaiting*`/`agentState`/`'waiting'`/`[blocked]` regex over lib, routes, server.js and public at both SHAs | 1 authority; 1 divergent regex; 10 callers; 2 agent-status mappings; 2 union and 4 marker-only readers; 3 staleness families |
| AI "not configured" gates | 10-12's 19 + the `!mockAi && !apiKey` and 503 shape | 22: 13 in, 9 out |
| entrance decisions outside `dispatch-entrance.js` | concept grep per owned decision | budget ×3, variant message ×2, default `'cli'` 19+13, D1 503 ×2, 5 non-entrance enqueue sites, `ROW_FIELDS`/`RUN_FIELDS` |
| close-out "merged/ready" answers | grep `merged`/`partial`/`headMoved`/`hasMergedEvent` | live PR state, record, head-moved readiness (render-only), client `applyCloseOutState` ×2 |
| CLAUDE.md single homes | the Invariants list | 4, all hold |
| SD internals | 7 window commits + earlier SD rows | above; no census tool in SD (**stated, not bounded by a tool**) |
| production rows with two same-provider bindings | **unbounded**: production data, not source | — |
| SD processes whose cycle stalls while the heartbeat timer fires | **unbounded**: runtime behaviour, not source | — |


## Cross-repo contract verdicts (Harbour · SD · runner kit · consumer heartbeat)

| contract | verdict | evidence |
|---|---|---|
| **Runner contract table** (`lib/runner-kit/contract.json`, byte-copied to SD `test/fixtures/runner-contract.json`) | **Declared in neither repo's production code; pinned one way.** Test fixture only (the kit never loads it). SD's sha256 pin fails only when SD's copy changes; if Harbour amends the table, SD stays green on a stale copy, and neither CI runs the other repo's test. | `contract.json:3`; Harbour `runner-kit-contract.test.js:37`; SD `test/runner-contract.test.js:25-29`. The copy is byte-identical today (sha `291d8943…`). The kit's heartbeat row is a tautology (`:102-103`). |
| **Halt** | 2 of 10-12's 4 divergences resolved (abort under stop; pause + follow-up with no live session). Unknown mode (deliberate) and stop text (cosmetic) are listed. Newly listed and open: stop + follow-up with no live session (SD fails it, `pacing.js:113`; kit leaves it). | finding 3 |
| **Target / repo / cap** | Aligned or listed. Harbour's runner poll is still unfiltered by target (open question). | finding 3 |
| **Markers and decision dialect** | **Not aligned.** The kit still lacks `[pending]`, withdrawal, `[evidence]`, `[working]`, and the resume marker; the decision-cap prefix window is un-tabled. LIN-3624 mis-states the residue. | finding 3 |
| **Consumer heartbeat** (LIN-1952) | **Restated on both sides, not declared once**, and the "a rename on either side fails a test" claim in both repos is false (each pins its own copy). The `contract.json:277` row is prose only. | finding 1 sub-row |
| **Wake regex / terminal regex** | Equal to the Harbour sources (`feedback.js:22` ≡ `dispatch-terminal.js:63`; `runner.mjs:84` ≡ `:36`); SD's comment citations are stale (Documentation). | finding 3 |
| **API base** | SD 2 copies (unchanged); Harbour inline `${req.protocol}://${req.get('host')}` 30 → 23. | row `simple-dispatcher-api-base-duplication` |
| **CI** | LV Node 20, `ci-success` needs `[unit,e2e,secret-scan]`. SD Node 22, one job, no aggregate; its system and mutation suites are not in CI. | `test.yml:136-139` |
| **`dispatch-kind-vocabulary-cross-repo`** | Held. | ledger |

## Sibling hand-offs (record, do not flag)

- **Documentation:**
  - `proxy-integration.md:2672` and `proxy-instructions.js:651` (LIN-1952 named as the fix)
  - `dispatch-integration.md:279` (says the kit sends a heartbeat)
  - `proxy-integration.md:2307` (`item.force`)
  - `plumbing.md:185` and `retro-audit.md:288` (stale freeze numbers)
  - `docs/proxy-integration.md:598-602` (heartbeat store "only says when a consumer last polled")
  - SD `phases.js:24-27`, `config.js:557`; SD `feedback.js:19` cites `:53`
  - SD contract-test header `1804aeb6`
  - `session-telemetry.js:662-670` JSDoc
  - `runner-kit-helper.test.js:446` title
  - LIN-3616 `server.js` lines +14; LIN-3608 item 8
- **Security:**
  - CSP replace-not-merge on the email confirm pages (LIN-3627 owns it)
  - `workspace-removal-revocation` account set vs `resolveAccountGroup` (I)
  - the kit's single-quoted decision JSON (carried)
- **Stability:**
  - `periodic-loop-two-mechanisms` (carried)
  - heartbeat stale-vs-TTL (`intervalMs ≥ 300000` never stale)
  - SD's read-only cache snapshot enforced only in tests
- **Test Coverage:**
  - the one-way contract pin, and the tautological kit heartbeat row
  - `batch-guard-residue` after LIN-3523
  - SD system and mutation suites not in CI
- **Seams & Tangles:** F1 and F3 knots persist (area-level).
- **API Quality:** limiter `message:{error}` bodies ×11; R vs K upstream-auth reply shapes (LIN-3608 item 8); `provider-write-field-contract`.
- **Code Quality:** in-file copies named by the rebuild (`isTestToken`, `sessionIsFreeTier`); the `kpi-stats` `median` twin.


## LIN-3490 places per decision

> *18 Oct, after the rebuild round. This is the first census-driven edition. Of the 23 distinct decisions held in more than one place at 10-12, **none resolved outright, 7 improved** (runner contract High → Medium, dispatch entrance, waiting-on-a-person Medium → Low-Medium, AI gate by shape, target, repo list, Harbour API base) **and 0 regressed**. The census and the reading added **16** more: 3 born in the window (the heartbeat's liveness conflation, the CSP split, SD's blocked-child activity), 1 that grew (owner-answer readers, LIN-3421), and 12 that pre-existed and were first seen by the census. That gives **39 distinct decisions: 0 High, 2 Medium-High, 2 Medium, 15 Low-Medium/Medium-Low and 20 Low.** The jump from 23 is mostly **measurement** (the census), not code, so the series is not comparable across this edition. Of the 28 census groups "gone" in the window, only 9 left the code; the rest were reshaped past the detector by rebuilds (11) or re-keyed (7).*

How the 39 is counted: ledger rows that are decisions, not sub-rows (`cross-repo-halt-vocabulary`, `decision-dialect-split`, `consumer-heartbeat-wire-restated`) and not the overlapping `cross-repo-sentinel-decision-marker-vocabulary`, with resolved rows, ungraded held rows and informational rows excluded. The 10-12 reading's rule is kept. The one Medium pair is `runner-contract-semantics-cross-repo` (with its sub-rows) and `run-page-identity-scrape`.

## Follow-ups (highest severity only)

Search was done before minting (`lastUsedAt` / heartbeat / "nobody listening" / owner check): no existing ticket names either finding. Both follow LIN-3449's child-ticket style: one decision, one plain-line behaviour choice, one PR, tests in the home module's own test file, no new guard, sweep, count pin or post-deploy check.

1. **LIN-3647 — MINTED: a consumer heartbeat is not a poll.** Behaviour choice: the heartbeat routes authenticate without refreshing `lastUsedAt`, so `NOBODY_LISTENING_MS` keeps reading poll/take recency only. No new "consumerAliveAt" signal (a second representation). Fixes finding 1.
2. **LIN-3648 — MINTED: one owner-answer reader.** Behaviour choice: every owner gate reads the `{status}` answer through `isOwnerAnswer()` in `lib/workspace-owner.js` and fails closed the same way; the `isOwner` twin is deleted. Fixes `owner-answer-reader-copies` (grew this window, security-adjacent). Same-size alternative not taken: `fresh-run-definition-copies`.

**Updated rather than minted** (each already names the decision): **LIN-3624** (correct the false UNPINNED claim; add the resume marker, `[dispatcher] going down`, the 4 row fields and the harness, the decision-prefix window, abort texts, recap chunking and the one-way pin; separate the per-session `[working]` heartbeat from LIN-3636), **LIN-3608** (item 8 is misdescribed; add R's silent drop, the variant message and the double stop-at read), **LIN-3616** (`server.js` refs +14; add two scripts), **LIN-3521** (LIN-3426 edited both `applyCloseOutState` copies in lockstep), **LIN-3339** (human-wait improved; the channel ruling is still parked), **LIN-3627** (cite as the owner of `csp-decision-split`), **LIN-3636** (note that sending the kit beat extends finding 1 to the runner token unless LIN-3647 lands first). **Re-checked, not updated** (no comment or edit from this run): **LIN-2150 / LIN-2188** (writer repro holds at `ea96357a`; no change). Not promoted: every other row, below the cut.

**Route and update decisions** are recorded here, not widened into code: the human-wait channel ruling stays parked with the owner (LIN-3339); the CSP split stays with LIN-3627.

## Ticket trend

- **LIN-3451** Done (kit matches SD on halt, target, repo and cap; contract table added). **LIN-3624** Backlog holds marker residue and is inaccurate (finding 3). **LIN-3602** and **LIN-3604/3592/3580/3611** Done. **LIN-3608**, **LIN-3616**, **LIN-3521**, **LIN-3612**, **LIN-3627**, **LIN-3636** Backlog. **LIN-2150** Todo, **LIN-2188** Backlog (scenario still not declared real).
- **Watch items from 10-12:** LIN-3451 unparked (**yes, Done**); LIN-2188's scenario declared real (**no**); agent-status starts a waiting clock (**still open, parked by the owner**).

## Compact trend ledger

`07-12` was never recovered (lost edition, task LIN-1231), so every 07-12 cell is `not recovered` and nothing is interpolated. Row names are stable. All 59 rows of the 10-12 ledger are carried in order, and their earlier cells are copied verbatim by script; the 18 new rows are appended (the 10-12 draft's combined `page-chrome-options / ship-biscuit-desk-list / free-tier-rule-copies` row is split into three). Severity is this run's grade; the `10-18` column is this run's reading at `ea96357a` / SD `4c9fb76`.

| finding | severity | 06-25 | 07-12 | 08-29 | 2026-09-26 | 2026-10-11 | 10-11 post-batch | 10-12 post-batch-3 | 10-18 (this run) | delta |
|---|---|---|---|---|---|---|---|---|---|---|
| `lib-import-cycles` | resolved | clean | not recovered | 3 elementary cycles / 3 modules / 5 edges (latent) | kpi 3 (unchanged) + **new 2-node `dispatch-store ↔ digest-feedback`** (latent) | 4 SCCs / 27 members: provider 15 + **6 (kpi + dispatch/digest merged via `milestone-funnel`)** + new `run-evidence↔run-closeout-state` + new 4-node routes cycle (latent, 27/27 load alone) | **0 SCCs / 0 members** (385 nodes / 1,435 edges); walker reproduces 10-11 baseline exactly at `6df0fbd5`; 0 dynamic upward imports | **0 SCCs** (393 nodes / 1,476 edges); walker reproduces 15990905 (385 / 1,435 / 0) and 6df0fbd5 (377 / 1,369 / 4) exactly; 0 static / 0 dynamic upward imports; 8/8 new modules load alone | 402 nodes / 1,487 edges / 0 SCCs; reproduces 393/1,476/0 at e24f8d12 | held |
| `provider-auth-router-upward-imports` | resolved | 2 edges, no cycle | not recovered | 4 edges, all inside static cycles; SCC 13 (re-measured by this run at `292ac962`; not stated in the 08-29 edition) | 4 edges; **SCC 13→15** (+`github-install-flow`, +`render-settings`) | SCC 15 (unchanged); edges **4→5** (+`render-swipe.js:23`→`routes/workspace.js`) | **0** `lib/`→`routes/`/`server.js` edges (static and dynamic); SCC 15 gone; one wiring table `routes/provider-auth-routers.js:21` | 0 static / 0 dynamic `lib/`→`routes/`/`server.js` edges | 0 static, 0 dynamic | held |
| `routes-error-envelope-fragmentation` | low-medium | 5 importers, ~53 residue | not recovered | 14 importers, 68 residue (routes-only); `dashboard.js` half-adopter | 26 importers but **adoption flat** (11 from the `proxy.js` split); residue **76 → 87** matched-SHA; `flight-companion.js` **0 → 8** | 35 importers (no split artifact; 8 born-adopters + 1 genuine); residue **87→93** (`task-chat` +4, `runner-kit` +2) | 10-11 command **0** (LIN-3460); 43 importers; shape: **74** `keepalive.send(4xx/5xx,{error})` (73 at `6df0fbd5`, never seen by the command) + 8 pre-built `{status,body}` + 8 `res.status(<var>).json(` | 10-11 command **0** (both SHAs); `res.status(<var>).json(` **8** in routes+server.js (same 8 sites; the probe's 10 adds 2 `lib/` lines and reads 10 at baseline too); **9** pre-built `{status, body}` producers (the 8 + `chargeFreeTierOrReject` `routes/proxy.js:1363-1370`, present at baseline) forwarded by 16 sites; `errorEnvelope` 1 caller; `lib/errors.js` importers 43→42 | (i)–(vi): 0 / 7(+1 lib) / 9 / 8 / 1 / 0. Shape: upstream-failure copies 36→12; limiter bodies 11 | held (improved by shape) |
| `production-to-test-fixture-imports` | resolved | — | not recovered | 7 sites | 7 sites | 7 sites | 7 sites | **0** static / 0 dynamic outside `routes/test.js` (7 + 1 → 0, LIN-3472); no second copy left in `tests/fixtures` | 0 | held |
| `periodical-report-filename-convention-split` | medium-low | — | not recovered | id↔filename join non-mechanical | same | same (`periodicals.js:881`) | same (`periodicals.js:881`); this edition adds a `-post-batch` suffix | same (`periodicals.js:881`, 0-line diff) | 9 of 16 ids ≠ slug; `periodicals.js:1028-1050` | unchanged |
| `dispatch-kind-vocabulary-cross-repo` | — | — | not recovered | 3 hardcoded keys | 3-key subset | `NO_BOOTSTRAP_KINDS` deleted (LIN-3199); bare `'wake'` literal only (18 lines / 10 files) | held resolved (SD 0 commits) | held (SD 0 commits) | SD `'wake'` 21 lines / 6 files, 0 in production | held |
| `provider-resolution-incantation` | low | 4 sites | not recovered | 16 sites | **17 sites** (18 raw incl. canonical helper body) | **18 sites** (21 raw lines); new `superseded-selection.js:53` written to evade the count pin | 09-26 command **2** raw lines (leaf + exempt referent) = 0 hand-rolled; **shape: 5** (`workspace-urlkey.js:196,240,256,258`, `live-console.js:58`); pin replaced by a name-keyed guard | old command **2** raw (leaf + exempt referent); shape **3**, all compound predicates in the key-deciding module (`workspace-urlkey.js:197,257,259`); plain lookups 0 (LIN-3474); finder importers 10→13 | old 2, shape 3 | unchanged |
| `ui-divergences-registry-staleness` | low | — | not recovered | registry 4 / actual 6 | registry 4 / actual **9** | native `confirm()` **9→10** (`proxy.js:389`) | native `confirm()` 10 | native `confirm(` **10** by the 10-11 method (comment lines excluded); loose grep 21 | `confirm(` 10 | unchanged |
| `simple-dispatcher-api-base-duplication` | low | — | not recovered | 2 | 2 | 2 (kit takes `baseUrl` from server) | 2 | SD 2 (`config.js:17`, `feedback.js:5`); Harbour inline `${req.protocol}://${req.get('host')}` 30 | SD 2; Harbour inline 30→23 | improved (Harbour) |
| `cross-repo-halt-vocabulary` | low-medium | — | not recovered | — | independently-defined `{pause,stop}` / `{mode,setAt,setBy}`; LIN-3074 | value single-authority; **meaning diverges 4 ways** SD↔kit; docs claim parity; LIN-3074 covers copy only | meaning diverges 4 ways (SD 0 commits, kit diff empty); `runner-prompt.md:219` parity claim stands | meaning diverges 4 ways (unknown mode SD fail-open `dispatcher.js:1654` / kit fail-closed `runner.mjs:214`; abort under stop; stop text `:605` vs `:253`; pause + follow-up `followup.js:40` vs `runner.mjs:209-212`); parity claim now `runner-prompt.md:216` | 2 of 4 resolved; unknown-mode (deliberate) and stop text (cosmetic) listed; stop + no-session follow-up newly listed | improved (high→low-medium) |
| `cross-repo-sentinel-decision-marker-vocabulary` | medium | — | not recovered | — | grammar split clean; word vocabulary duplicated | kit cannot emit `[pending]`/`[decision]`; wake regex ×3 un-imported; 1 cross-party pin | kit cannot emit `[pending]`/`[decision]`; wake regex authority `dispatch-terminal.js:63`, 3 copies; SD cite 10 lines stale | kit can now raise a ruling (LIN-3505) through a prose-only third producer form (see `decision-dialect-split`); `[pending]`/withdrawal still absent from kit; LV wake copies 0; SD restates the wake regex at `feedback.js:22` and still cites `:53` (now `:63`) | kit still lacks `[pending]`/withdraw/`[evidence]`/`[working]`; resume marker missing; LIN-3624 mis-states the residue | unchanged |
| `target-vocabulary` | low-medium | — | not recovered | — | 3 disagreeing LinearViewer lists + inline copies; SD owns runner set | LV 17 lines / 9 files (+`runner-owner-gate.js:22`); 3 lists persist; kit/Harbour poll unfiltered vs SD `cli`/`web` | 7 bracketed lists unchanged; 16 lines / 9 files (this run's method; 10-11's 17 not reproducible) | LV: one declaration `lib/dispatch-targets.js:17-27` (bracketed lists 7→3, all inside it; named lists 4→0; 9 importers). Default `'cli'` still restated ~18 server + ~10 client lines (`RUN_FIELDS.target` `dispatch-fields.js:53` does not import the declaration). SD `targets.js:15-18` {cli,web}; kit reads none; runner poll unfiltered (`proxy-runner.js:94`→`dispatch-store.js:924`) | 1 declaration, 7 importers; default `'cli'` server 19 / client 13; kit filters (pinned copy); poll unfiltered | improved |
| `sse-frame-writer-duplication` | resolved | — | not recovered | — | 2 byte-identical copies of canonical `lib/sse.js:23 sendSSE` | 2 copies; **LIN-2663** tracks (not minted) | 2 copies (LIN-2663) | `function sendSSE` **1** (`lib/sse.js:23`); hand-written frames outside it 2→0; 9 hand-written `text/event-stream` header preambles remain (LIN-3475, Backlog) | 1 writer; preambles 7 sites / 5 files (LIN-3475) | held |
| `routes-proxy-decomposition` | — | — | not recovered | — | `routes/proxy.js` 7,315→1,591 lines, 11 injected sub-routers | held (`proxy.js` 11 sub-routers); no new split this window | held | held | held | held |
| `cross-repo-repo-list` | low | — | not recovered | deliberate | deliberate; LIN-2974 Done | Harbour list **deleted** (LIN-3333); SD alone validates; kit ignores `item.repo`; LIN-3347 SD-side only | unchanged | unchanged (SD alone validates `dispatcher.js:159-187`; kit ignores `item.repo`; LIN-3347 Backlog) | kit validates (`runner.mjs:233-241`); resolution difference documented | improved |
| `ci-convention-split-across-repos` | informational | — | not recovered | Node 20 vs 22 | same; `ci-success` `needs:[unit,e2e,secret-scan]` | same (Node 20 vs 22; `ci-success` `needs:[unit,e2e,secret-scan]`) | same | same (LV Node 20, `ci-success` `needs:[unit,e2e,secret-scan]`; SD Node 22, no aggregate) | LV Node 20 + `ci-success`; SD Node 22, one job; SD system/mutation suites not in CI | unchanged |
| `semicolon-style-split` | low | unchanged | not recovered | unchanged | unchanged | unchanged (not re-measured; no style change observed) | not re-measured (new `routes/provider-auth-routers.js` omits semicolons) | not re-measured (#1873 added one missing `;` on a LIN-3487 import) | not re-measured | unchanged |
| `client-escape-html-duplication` | — | resolved | not recovered | held | held | held (1 definition) | held (not re-measured; `public/` diff touches only `common.js`/`observation.js`) | held (same count at both SHAs) | held | held |
| `client-shared-helper-duplication` | — | largely resolved | not recovered | resolved, held | held | held (`formatElapsed` pair noted under `server-formatter-duplication`) | held | held | held | held |
| `client-section-fetch-idiom-duplication` | — | resolved | not recovered | held (19 files) | held (**20 files**) | held (**23 files**) | held (24 files by `git grep -l window.api`, same at `6df0fbd5`) | held (24 files by `git grep -l window.api`, same at 15990905) | 24 | held |
| `linear-cli-parallel-graphql-surface` | — | resolved | not recovered | held | held | held (module absent) | held | held | held | held |
| `store-module-uniformity` | — | clean (10) | not recovered | clean (22) | clean (**24**) | **32/33** (33 stores); 1 naming outlier `pr-state-store` | 33 stores (no new store) | 33 stores (no new store) | 33 stores | held |
| `server-side-escaping` | — | clean (26) | not recovered | clean (45) | clean (**46**) | clean (**55**) | 55 importers | 54 importers (55 at 15990905; `routes/workspace.js` dropped with `htmlError`) | 54 importers | held |
| `dispatch-payload-centralization` | — | clean (5) | not recovered | clean (8) | clean (8) | clean (**5** by the 09-26 command; the 09-26 "8" was mis-stated) | held (not re-measured) | held (not re-measured) | 6 files / 5 callers | held |
| `renderer-provider-abstraction` | — | clean | not recovered | clean | clean | held (not re-measured beyond provider seam) | held (not re-measured) | held (not re-measured) | not re-measured | held |
| `cache-module-family` | — | — | not recovered | clean | clean (7) | clean (7, two families) | held (not re-measured) | held (not re-measured) | not re-measured | held |
| `lib-components-primitive-adoption` | — | not assessed | not recovered | clean (30/30) | clean (**31/31**) | **36/38** (2 fragment modules) | 36/38 | 36/38 | 36/38 by import (`button.js` 1 importer; ~22 hand-built `action-btn` the gauge can't see) | held |
| `state-store-write-seam` (SD) | — | not assessed | not recovered | clean | clean | clean (incl. 3 new SD modules) | held (SD 0 commits) | held (SD 0 commits) | write seam clean; new cached read path, read-only rule enforced only in tests | held, watch |
| `phase-vocabulary-centralization` (SD) | — | not assessed | not recovered | clean, exemplary | clean, exemplary | clean (incl. 3 new SD modules) | held (SD 0 commits) | held (SD 0 commits) | 0 raw phase strings; `phases.js:24-27` wording stale | held |
| `target-harness-axis-orthogonality` | — | not assessed | not recovered | clean | clean | clean | held | held | held | held |
| `test-seam-separation` | — | not assessed | not recovered | clean | clean | clean | held | held | not re-measured | held |
| `css-token-layer` | — | not assessed | not recovered | clean, 1 ratified outlier | does not reproduce (sibling-owned) | sibling-owned (Design & Interface) | sibling-owned | sibling-owned | sibling-owned | routed |
| `runner-contract-semantics-cross-repo` | medium | — | not recovered | — | — | **NEW: kit re-implements SD reactions; diverged on halt ×4, target, repo, markers** | unchanged on every row (LIN-3451, Backlog); corrections: `cascade`/`maxSessionsPerTask` never read by SD | halt ×4, target, repo, row fields (`queueIfBusy`/`force`/`waitForFollowUps`/`subscription`, 0 in kit), 2000-char cap ×3 behaviours, harness hard-code: all unchanged; kit `runner.mjs`/`broker.mjs` untouched by LIN-3505; LIN-3213 added `runner open` + wait debounce (capability gaps vs SD, not drift); decision now raisable in a third form | halt/target/repo/status cap aligned or listed; `contract.json` is test-only with a one-way pin; row fields ×4, harness, abort texts, decision-prefix window, recap chunking not covered and no ticket | improved (High→Medium) |
| `connection-binding-predicate-drift` | low-medium | — | not recovered | — | — | shared predicate + 3 inline copies lacking stale-marker guard; +1 copied selector | 3 copies → predicate (11 calls / 6 files); `legacyFallbackTarget` ≡ `selectIssueSourceBinding` remains | `legacyFallbackTarget` ≡ `selectIssueSourceBinding` remains (1 caller); predicate reference counts identical | `legacyFallbackTarget` remains | unchanged |
| `run-page-identity-scrape` | medium | — | not recovered | — | — | `session.js:738-742,866` task id from neighbouring widget; LIN-3349 | `session.js:740,868`; LIN-3349 | `public/session.js:740,742,868` (0-line diff); LIN-3349 Backlog | `public/session.js:740,742,859` (LIN-3349) | unchanged |
| `dispatch-entrance-field-duplication` | low | — | not recovered | — | — | `maxSessionsPerTask` ×5; fields re-serialised 6×/4× | cap field **deleted** (LIN-3461; 41-file PR); sibling `maxTasks` 116 lines / 15 files, validator ×5; other validators 15 lines / 5 files; store projections ×3 | 23 fields + 7 rules declared once (`lib/dispatch-fields.js:48-212`, 6 importers); store re-normalisation over the 23 names 93→**0**; `maxTasks` message 5→1 (+ trim's own `routes/dispatch.js:1381`); other validators 15/5→declaration; `maxTasks` 111 lines / 15 files. **Wire re-projection kept by design (LIN-3488 cancelled):** 34 lines in 6 `proxy-dispatch.js` blocks + `proxy-kickoff.js:489` + `pipeline-loops.js:757-796` (defaults `kind`/`target` → null vs declared `'custom'`/`'cli'`) | `RECEIPTS` one table; wire `F: x.F` 43/4/4→25/0/1; budget ×3; variant messages ×2; `ROW_FIELDS` beside `RUN_FIELDS`; 5 non-entrance enqueue sites; D1 503 ×2 | improved |
| `owner-word-collision` | low | — | not recovered | — | — | `viewerIsOwner:true` ×4 = "session member" | 4 sites | 4 sites | 3 by shape (10-12's 4 not reproduced) + LIN-3421 `/t/` "owner" = creator (I) | unchanged |
| `run-family-render-primitives` | low | — | not recovered | — | — | 2 fragment modules hand-build pills/buttons/details | 2/38 | 2/38 | 2/38 | unchanged |
| `persist-binding-sibling-seams` | low | — | not recovered | — | — | ×7 sibling seams | 7 seams; fallback bodies differ (feeds `credential-decision-multiplicity`) | 7 (`auth.js:303,430`, `jira-auth.js:328,700,798`, `account-merge.js:169`, `routes/test.js:77`) | 7 | unchanged |
| `server-formatter-duplication` | low | — | not recovered | — | — | `formatDuration`/`formatUsd`/`formatElapsed` copies | `formatDuration` ×3, `formatUsd`/`fmtUsd` ×3, `formatElapsed` ×2 | `formatDuration` ×3, `formatUsd`/`fmtUsd` ×3, `formatElapsed` ×2 | `formatDuration` ×3, USD ×4 (`render-settings.js:309`, uncounted before), `formatElapsed` ×2 | unchanged (recount) |
| `wake-marker-regex-copies` | resolved | — | not recovered | — | — | 3 new LV copies, none import `dispatch-terminal.js:61` | 3 (`run-view.js:136`, `liveness-detectors.js:130`, `task-page-loader.js:60`) | LV literal copies 3→**0**; all import `dispatch-terminal.js:63` (LIN-3468); `public/` 0; SD copy tracked in the cross-repo row | LV 0; SD copy cites `:53` (now `:63`) | held |
| `runner-liveness-assumption` | low | — | not recovered | — | — | `ACTIVE_FRESH_MS` assumes SD heartbeats; kit posts none (inferred) | `liveness-detectors.js:81`; kit posts no heartbeat | `liveness-detectors.js:79`; kit posts no heartbeat (its polls feed `NOBODY_LISTENING_MS`, not `ACTIVE_FRESH_MS`) | `liveness-detectors.js:79`; kit posts no `[working]` | unchanged (see 60) |
| `workspace-urlkey-consolidation` | — | — | not recovered | — | — | `deriveUrlKey` used by all 7 bind arms; per-arm derivations deleted (LIN-3382); Linear `org.urlKey`… (cell truncated in the 10-11 edition) | held (module untouched) | held (module untouched by LIN-3474) | 0-line diff | held |
| `credential-decision-multiplicity` | medium-high | — | not recovered | — | — | — | ≥6 credential copies, ≥7 binding choosers, E1/E2 token precedences; session-scan returns `{token:NEW, scope:OLD}` after headless refresh (function-level repro); sweep watches 3 pairings | E1/E2 retired (`getWorkspaceMirrorToken` 0); the 10-11 repro now gives `{token:NEW, scope:NEW}`. Unchanged: 6 credential copies, 7 binding choosers (reference counts identical), expiry ranking ×3, 7 persist seams, sweep 3 pairings, legacy never converts (`connection-credential.js:1280`). The refresh writer rotates the first binding of the provider (`lib/workspace.js:372`) while readers match by token; LIN-3464 put the headless lane on that writer | 6 / 7 / 5 / 4 / 3 / 7; writer repro `{site-B,B-OLD}`→`{site-A,NEW}` at both SHAs | unchanged |
| `keepalive-error-envelope-writer` | resolved | — | not recovered | — | — | — | 74 hand-built `keepalive.send(4xx/5xx,{error})` (73 at `6df0fbd5`) | old command 74→**0**; shape: 0 hand-built bodies; `keepaliveError` 75 sites; the 8 `keepalive.send(<var>, <var>)` sites forward pre-built bodies (counted under `routes-error-envelope-fragmentation`) | 0 hand-built; `keepaliveError` 48 (folded into workspace-api helpers) | held |
| `html-error-page-two-writers` | resolved | — | not recovered | — | — | — | `htmlError` 9 vs `renderErrorPage` 116 (+4 raw text), pages differ | `htmlError` 6→**0**, `.html(` 9→0, raw-text 4xx/5xx 4→0; `renderErrorPage` 116→124 external sites (+9 from LIN-3466 exactly, −1 via `renderServiceUnavailablePage`); themed `render-email-auth` family unchanged (Design) | held | held |
| `ai-availability-gate-duplication` | medium-low | — | not recovered | — | — | — | 2 OpenRouter key resolvers; 13 inline 503 gates, 2 mock dialects; data-mock predicate inline ×34 (38 at `6df0fbd5`) | key resolvers 2→**1** (`resolveChatCredential`, 36 calls; `resolveProxyLLM` comment-only); the 13 named gates→`isAiUnavailable` (`chat-request.js:74`). Remaining: the mock flag is a parameter still fed 2 dialects (`isTestMode` ×6, `shouldMockAi(workspace)` ×6); **6 more** not-configured gates outside it (`workspace-api-roadmap.js:285,798`, `flight-companion.js:728,888`, `dashboard.js:2798,2984`; present at baseline, so the true total was 19); `isRecommendationEnabled` (1 call) and `getOpenRouterSource` (`server.js:1017-1025`) restate the order; data-mock predicate ×34 | 22 gates (13 in / 9 out; 3 missed by 10-12); 2 mock dialects; data-mock 34→17 (named locally, no lib owner); census G0001/G0005 real | improved by shape; baseline corrected |
| `dispatch-refusal-relay-duplication` | resolved | — | not recovered | — | — | — | refusal→HTTP relay written twice (`routes/proxy.js:878-1010`, `routes/dispatch.js:880-918`); LIN-3461 mirrored a branch into both | HTTP relay 2→**1** (`lib/dispatch-refusal.js:39`, reached by `routes/dispatch.js:887` and `routes/proxy.js:842` + 4 injected callers); 1 non-HTTP mapping left (`workspace-api.js:3528-3536`, inline `'RUN_LIMIT_UNVERIFIED'`) | 1 mapping, writer ×2; `runLimitRefusal` `workspace-api.js:742-748` | held (low residue) |
| `tolerant-date-parse-date-twins` | resolved | — | not recovered | — | — | — | 3 private Date-returning parses (`liveness-alarm-store:287`, `pipeline-loops:264`, `session-telemetry:66`), junk semantics differ | `toDate`/`_toDate` 3→**0**; both inline closures use `toEpochMs` (36 importers); 3 small private normalisers remain (`proxy-alarms.js:86-91`, `consumer-poll-warning.js:107-108`, `task-page-loader.js:84-86`) | held; new loose `createdAtMs` `proxy-reads.js:60` | held |
| `timestamp-parse-consolidation` | — | — | not recovered | — | — | — | `toEpochMs` 30 importers; ticket grep 0 (LIN-3453) | `toEpochMs` 36 importers | 37 importers | held |
| `loose-json-consolidation` | — | — | not recovered | — | — | — | 1 owner, 8 importers; no brace-slice elsewhere (LIN-3114) | 1 owner, 8 importers | 8 | held |
| `ai-mock-predicate-consolidation` | — | — | not recovered | — | — | — | `shouldMockAi` 1 definition, 8 importers (LIN-3459) | `shouldMockAi` 1 definition | 1 definition | held |
| `batch-guard-residue` | informational | — | not recovered | — | — | — | 3 batch-1 source-scan guards (lin-2389, lin-3452, loose-json); batch 2 added none | batch 3 added **0** new guard files, but re-pinned 2 count pins instead of deleting them (`lin-3124-pr1-count-pins.test.js:175` 4→3, `lin-3124-pr2-credential-census.test.js:41` 13→12), re-keyed 2 scans, and added 1 `readFileSync` scan (`run-limit-gating.test.js:262`); outside the batch #1872 and #1852 added scans; the 3 batch-1 guards are unchanged | LIN-3523 (`1ef562ce`) deleted residue; not re-measured (Test Coverage) | routed |
| `decision-dialect-split` | medium | — | not recovered | — | — | — | — | kit `DECISION:` is a prose-only producer (`runner-prompt.md:170-181`: raw JSON, only before `BLOCKED:`, no prefix, validation, dedupe or withdrawal) beside SD's `hook.js:588-659` (`[decision] ` + re-serialised JSON, any sentinel, 2000-char gate incl. prefix, dedupe, `WITHDRAW:`); one tolerant reader `parseDecision` (`session-telemetry.js:669`) | 3 grammars; prefix-in-cap window untabled | unchanged |
| `human-wait-derivation-split` | low-medium | — | not recovered | — | — | — | — | "which marker means waiting on a person": exported `WAITING_WAKE_MARKERS` (`digest-feedback.js:56`) + 2 copies "keep in parity" (`render-run-steps.js:159`, `routes/dashboard.js:338`) + 5 inline `'blocked'` checks (`run-view.js:232`, `task-page-loader.js:148` (new, LIN-3504), `dispatch-terminal.js:225`, `unanswered-decisions.js:71`, `observer-sweep.js:97`) + agent-status mapping `pipeline-loops.js:312`; banner unions `agentState === 'waiting'` (`dashboard.js:356`), clock reads feedback only (`run-view.js:226-243`); 3 staleness rules | 1 authority, 0 copies, 0 inline (LIN-3602); `render-session.js:80` `[pending]` regex; channel split unchanged (probe); 3 staleness families | improved (Medium→Low-Medium) |
| `decision-stamp-classifier-copies` | low-medium | — | not recovered | — | — | — | — | `isDecisionLifecycleStampEntry` (`digest-feedback.js:86`) + 5 membership copies (`run-view.js:129`, `session-telemetry.js:60`, `wall-clock-summary.js:64`, `public/dispatch.js:1132`, `public/session.js:283`); parity test lists 4, not `run-view.js` | authority + 5 copies; drift test omits `run-view.js` | unchanged |
| `provider-write-field-contract` | low-medium | — | not recovered | — | — | — | — | GitHub inherits `ui.priority: true` (`providers/interface.js:250`) but `updateIssue` drops priority (`providers/github/index.js:834-854`); the proxy catalogue documents the drop | 0-line diff | unchanged |
| `close-out-merged-refusal-split` | low-medium | — | not recovered | — | — | — | — | "this PR is already merged" refuses the close-out *record* (`workspace-api.js:4631-4636`, LIN-3395) but the client enqueues first (`public/close-out.js:116` then `:128`); `closeOutRefusal` (`dispatch-factory.js:739`) does not check it; `run-evidence.js:102` decides "merged" from live PR state | order unchanged; merged ×2 sources; +head-moved readiness (LIN-3418): render-only at `ea96357a`; session lane refuses since LIN-3634 `ff479045`; press route and the other lanes still unchecked; `applyCloseOutState` ×2 edited in lockstep (LIN-3426) | held, +1 input |
| `periodic-loop-two-mechanisms` | informational | — | not recovered | — | — | — | — | leased `lib/scheduler.js` (5 jobs) beside the bare hourly `setInterval` (`server.js:4524`, `lib/hourly-cleanup.js`), which LIN-3424 made the only session sweeper | 5 jobs + hourly loop `server.js:4539` | unchanged |
| `consumer-liveness-signal-conflation` | medium-high | — | — | — | — | — | — | — | the heartbeat bumps `lastUsedAt`, which feeds Rule S, the warnings and the kit's deferral; `lastPollOkAt` unread | new (LIN-1952) |
| `consumer-heartbeat-wire-restated` | low-medium (sub-row of 60) | — | — | — | — | — | — | — | field list ×4, schema ×2, interval bounds ×2, docs ×3; false "fails on either side" claim | new (LIN-1952) |
| `owner-answer-reader-copies` | low-medium | — | — | — | — | — | — | — | G0172, 6 readers / 3 fail-closed styles; `isOwner` verbatim twin; account set vs `resolveAccountGroup` | new row (grew via LIN-3421) |
| `mock-ai-builder-copies` | low-medium | — | — | — | — | — | — | — | lib home exists, 2 routes bypass it; mock stage choosers rank differently | new row (pre-existing) |
| `fresh-run-definition-copies` | low-medium | — | — | — | — | — | — | — | 3 definitions + Mongo filter | new row (pre-existing) |
| `terminal-loop-rule-copies` | low-medium | — | — | — | — | — | — | — | G0021/G0052 across 6 files incl. `public/` | new row (pre-existing; LIN-1496) |
| `state-type-label-rank-maps` | low-medium | — | — | — | — | — | — | — | ~11 maps; labels differ; finished set omits `duplicate` | new row (pre-existing; LIN-3612 adjacent) |
| `csp-decision-split` | low-medium | — | — | — | — | — | — | — | route CSP replaces the app CSP; email confirm pages lack `script-src` | new row (born, LIN-3420; owned by LIN-3627) |
| `priority-label-maps` | low | — | — | — | — | — | — | — | 7 maps, `'normal'` vs `'Medium'` | new row |
| `localhost-predicate-split` | low | — | — | — | — | — | — | — | `startsWith` ×6 vs exact ×1 | new row |
| `observer-instance-key-copies` | low | — | — | — | — | — | — | — | house-rule copies with stale tripwires (LIN-2481) | new row |
| `pilot-eligibility-copies` | low | — | — | — | — | — | — | — | ×3, already differ | new row |
| `linear-image-host-allowlist` | low | — | — | — | — | — | — | — | ×4 "keep in sync" | new row |
| `page-chrome-options` | low | — | — | — | — | — | — | — | 14 routes pass the same options to `components/page.js` (G0007) | new row |
| `ship-biscuit-desk-list` | low | — | — | — | — | — | — | — | 4 copies of the desk list; `DESKS` exported (G0361) | new row |
| `free-tier-rule-copies` | low | — | — | — | — | — | — | — | 3 rules: `chat-request.js:55-60`, `server.js:1030-1040`, `workspace-api.js:153` (G0002) | new row |
| `sd-blocked-child-last-activity-split` | low | — | — | — | — | — | — | — | `reapers.js:1095-1105` vs `:1194-1215`; comment says "same" | new (born, LIN-3585) |
| `census-gone-overstates-resolution` | informational | — | — | — | — | — | — | — | 28 gone = 9 left the code + 11 reshaped + 7 re-keyed + 1 noise | new (gauge validity) |

*Measured at `LinearViewer` `ea96357a` / `simple-dispatcher` `4c9fb76`. Next run: re-ground every row against HEAD, not against this prose.*
- *Keep the census run (same command, same area guide) and the Tarjan walk; a single new SCC would be news.*
- *Keep both counts for `routes-error-envelope-fragmentation`, `provider-resolution-incantation` and the AI gate (named gates plus not-configured shape).*
- *Re-check LIN-3647 (the heartbeat no longer moves `lastUsedAt`) and LIN-3648 (one owner-answer reader) first.*
- *Watch items: whether LIN-2188's scenario is declared real; the ruling on whether agent-status starts a waiting clock (LIN-3339); whether LIN-3624 is corrected.*
