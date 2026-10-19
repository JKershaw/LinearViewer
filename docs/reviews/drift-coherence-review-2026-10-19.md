# Drift & Coherence Review — verification edition, run of 2026-10-19 (trend vs 2026-10-18)

**Grounding.** Measured at `LinearViewer` `777042761d9229e1a6c4249e17ddcecfb699b147` / `simple-dispatcher` `b43fdcaa1e43dbaa4c6d55678aa5ecdb2fabd1f9` (the previous edition measured `ea96357a78b295061549508d3d9b2c1e06504c6a` / `4c9fb7655af11c7de4ebb44d1c09c892100c4dbf`). Both repos were fetched from `origin/main` first. The window is **28 commits**: the 27 the ticket names plus LIN-3414 (`77704276`, Terms/Privacy text only), which landed one minute after the ticket was created. Production (`lib/`, `routes/`, `server.js`, `public/`) changed in **73 files, +2,503 / −806**. SD took **1 commit** (LIN-3630, #275). The ticket's probes cite `35031d6d`; every probe here was re-run at `77704276`, and `main` had not moved when this report was written. The comparison baseline is `docs/reviews/drift-coherence-review-2026-10-18.md` (LIN-3646, PR #1940, `f62837a4`).

**Why this edition exists.** It is the first verification edition after the census-driven baseline. Both of 10-18's follow-ups landed in this window (LIN-3647, #1944 `a9186957`; LIN-3648, #1943 `9b3b6673`), and several other commits each claim to settle a ledger row (LIN-3658 free tier; LIN-3612/3656/3659 terminal state; LIN-3657/3634 head-moved close-out; LIN-3630 unknown halt mode). It is also the gauge reading for **LIN-3449** (coherence loop) and the **LIN-3490** places-per-decision reading, and the first **like-for-like** census comparison.

**Method.**
- **Census (required).** `scripts/code-shape/census-review.mjs`, run at `77704276` against `ea96357a` with the **same** `--include` scope and the same area guide (`scripts/code-shape/areas.json`) as 10-18:
  `node scripts/code-shape/census-review.mjs . 77704276 ea96357a --include '^(server\.js$|(lib|routes|public)/.*\.[cm]?js$)'`
  It needed `npm install` first (`acorn`). Output: **475 groups, 90 `mustRule`, 262 `table`, 7 gone, 0 unranked.** The 10-18 command (`ea96357a e24f8d12`) reproduces **468 / 89 / 261 / 28 exactly**, and `git diff --stat ea96357a 77704276 -- scripts/code-shape` is empty, so the tool, detectors, `groupKey` and area guide are byte-identical. **This edition is like-for-like with 10-18: a movement in the numbers is code movement, not measurement.** SD has no census tool of its own; SD was reviewed by reading.
- **Continuity practices kept.** The old command stays verbatim beside each shape count, and a row counts as resolved only when both agree. The scratch Tarjan walker over static imports of `lib/`, `routes/` and `server.js` (kept outside the repo) reproduces **393 / 1,476 / 0** at `e24f8d12` and **402 / 1,487 / 0** at `ea96357a` exactly; HEAD reads **406 nodes / 1,523 edges / 0 SCCs**, with 0 static and 0 dynamic `lib/` → `routes/`/`server.js` edges (+47 / −11 edges; 9 of them are the LIN-3612 move from `tree.js` to `state-map.js`).
- **Measurement split** across 6 fresh-context read-only sub-agents (cross-repo contract and heartbeat; owner answer and credentials; free tier, terminal state and the AI gate; close-out, CI-wake sweep, human wait and question cards; census rulings, gone and table groups; remaining ledger rows, invariants, markers, doc hand-offs and new files). The load-bearing claims were re-checked at HEAD by the author. **V** = verified in source or by a probe at both SHAs; **I** = inferred.

**What was added to the scope, and why** (the listed scope was a starting point):
- the 5 production files added in the window (`lib/ci-wake-sweep.js`, `lib/close-out-readiness.js`, `lib/providers/github/installation-pages.js`, `lib/question-card.js`, `public/question-cards.js`), each checked for loading alone and for what it imports;
- the CI-wake sweep's re-derivations, which became the window's largest new drift source;
- the `duplicate` state glyph, which the terminal-state work made visible;
- the pause-marker (`'pending'`) predicate gap, LIN-3497's "review on record" readers and LIN-3651's ceiling text;
- LIN-3496's credential-block grammar (a Harbour↔kit seam), the two cross-layer imports and `timestamp-parse` (a private `toMs` regressed it);
- the 10-18 Documentation hand-offs, checked for which landed, and the open tickets that name a split decision.

**File name.** `ls docs/reviews/drift-coherence-review-2026-10-19*` was empty, so the plain series name is used (`reviews/` entry of `docs/architecture/source-map.md`).

**Review-only.** No code, config, secret or under-review doc was changed. The deliverables are this report, its branch and PR, and the Linear updates. `feat/lin-3657-press-head-moved-refusal` (`bcbb4ddd`) is already contained in `main` (`git diff 1ba54841 bcbb4ddd` is empty) and does not matter to any row.

**Headline.**
- **The old top finding is resolved.** LIN-3647 holds: both heartbeat doors authenticate with `touch:false` through one `tokenValidationOptions`, and no second "consumer alive" representation was added. `consumer-liveness-signal-conflation`: MEDIUM-HIGH → **resolved**.
- **Three claimed consolidations hold when re-measured:** free tier (LIN-3658, refusal blocks 11 → 1), CSP (LIN-3627) and the owner-answer reader (LIN-3648, 0 raw readers outside the home; the residue is 7 per-gate try wrappers).
- **Two claims only partly hold:** terminal state (server copies 9 → 0, but 4 browser copies remain and a `duplicate` is drawn three ways) and close-out head-moved (one predicate, two callers; "merged" still has two sources).
- **The window's new drift sits almost entirely in one new module, `lib/ci-wake-sweep.js` (LIN-3661).** It imports the shared authorities but re-derives the follow-up target rule, the lineage-row read, a 5th PR-URL regex and a timestamp parser.
- **The new top finding is the credential row** (`credential-decision-multiplicity`, MEDIUM-HIGH): unchanged in its core (6 / 7 / 5 / 4 / 3 / 7, writer repro holds at both SHAs), widened by LIN-3285.
- **Census:** 26 real / 29 borderline / 35 noise (10-18: 30 / 26 / 33). Only **2 of the 7 gone groups** left the code.

> *LIN-3490 reading, 19 Oct: 43 distinct decisions are held in more than one place (39 at 10-18): 0 High, 1 Medium-High, 2 Medium, 13 Low-Medium/Medium-Low, 27 Low. 3 resolved outright, 4 improved, 2 worsened (both from LIN-3661), 7 added. The movement is code, not measurement.* The full reading is under "LIN-3490 places per decision".

## Findings (severity-ranked; delta vs 2026-10-18)

| # | finding | severity | delta vs 10-18 | one line |
|---|---|---|---|---|
| 1 | `credential-decision-multiplicity` | MEDIUM-HIGH | unchanged core, widened | 6 / 7 / 5 / 4 / 3 / 7 at both SHAs; LIN-3285 adds an owner→installation lane, a token cache, a 5th `{github, github-projects}` list and a credential-core → network import. LIN-2150 / LIN-2188: updated, not minted |
| 2 | `runner-contract-semantics-cross-repo` | MEDIUM | unchanged | `contract.json` (24 rows) re-synced to SD by hand 8 minutes after it changed; the pin is still one-way; "follow-up under an unknown mode" is untabled; LIN-3624 still uncorrected |
| 3 | the CI-wake sweep cluster (`follow-up-target-rule-copies`, `lineage-row-read-copies`, `pr-url-regex-copies`, `sweep-as-library-imports`; worsens `target-vocabulary` and `timestamp-parse-consolidation`) | LOW-MEDIUM as a cluster | **new** (LIN-3661) | the window's main source of new drift. Promoted: LIN-3672 |
| 4 | `close-out-merged-refusal-split` | LOW-MEDIUM | improved on head-moved, held on merged | one predicate + one 409 body, 2 callers; proxy/recommend/kickoff lanes unchecked (LIN-3417); "merged" ×2 sources; LIN-3379 adds a merged-only reader |
| 5 | `state-type-label-rank-maps` | LOW-MEDIUM | mixed | terminal predicate: server copies 9 → 0, `tree.js` production importers 10 → 0; but 4 browser copies, and a `duplicate` drawn ✓ / ✕ / ○. Promoted: LIN-3674 |
| 6 | `human-wait-derivation-split` | LOW-MEDIUM | unchanged | question cards read the authority; new row `pause-marker-predicate-gap` (inline `'pending'` 8 → 9) |
| 7 | `owner-answer-reader-copies` | LOW-MEDIUM → LOW | **improved** (LIN-3648) | 0 raw readers outside the home; 7 gates fail closed uniformly; residue 7 try wrappers. Promoted: LIN-3673 |
| 8 | resolved: `consumer-liveness-signal-conflation`, `free-tier-rule-copies`, `csp-decision-split` | — | **resolved** | both counts agree for each |
| 9 | everything else | — | unchanged or held | one line each in the ledger |

**Surface Assessment: lands cleanly.** The deliverable is docs-only. The three promoted follow-ups each reuse an existing home and add no second representation.

## Evidence by layer (each claim cited; V = verified, I = inferred)

### L1. Consumer liveness (LIN-3647): RESOLVED (V, re-verified).
- **One decision point.** `tokenValidationOptions` / `isHeartbeatRequest` (`lib/consumer-heartbeat-ingest.js:21-44`) is used by both auth middlewares: `routes/dispatch.js:288` and `routes/proxy.js:546`.
  - These are the only two `validateToken(` call sites in production (`git grep` at `77704276`).
  - Both validators take `{ touch }`: `dispatch-tokens.js:110,137-147` and `proxy-tokens.js:656,699-710`.
- **Dispatch door:** `routes/dispatch.js:1357` runs heartbeatLimiter → `authenticateDispatchToken` with touch false → ingest. The ingest writes only to `consumer-heartbeats` and `logEvent`.
- **Runner door:** the path-scoped `router.use('/api/proxy/runner', proxyLimiter, authenticateProxyToken, requireGrant('take'))` at `proxy-runner.js:81`, then the ingest at `:124`. `requireGrant` writes nothing.
- **Readers of `getConsumerLastSeenAt`.** All 6 call sites read `lastUsedAt` only:
  - Rule S, `liveness-alarm-sweep.js:64,123`
  - the enqueue stamp, `dispatch-factory.js:988`
  - read-time warnings, `routes/dispatch.js:511` and `proxy-dispatch.js:499,611`
  - the runner poll's `otherConsumerLastSeenAt`, `proxy-runner.js:107` (dispatch tokens only), which the kit reads at `runner.mjs:309`
- **No second representation:** the diff adds no field or store. `lastPollOkAt` is still only validated (`consumer-heartbeat.js:30,69`) and listed by `GET /api/proxy/heartbeats`.
- **LIN-3647's Done-when clauses all hold:**
  - one place decides it, and both doors use it;
  - `proxy-integration.md:2672` and `proxy-instructions.js:651` are corrected;
  - the tests went into the home modules' own test files.
- **Residue, which the plan should not re-open:**
  1. `authenticateDispatchToken` still touches on `broker-token` (`:1198`) and on feedback posts. A stalled SD cycle with live sessions posting `[working]` therefore still reads as listening (I). The code routes this to LIN-2883 (`ingest.js` comment), which is a machine-pairing ticket, so it is a weak owner. The comments at `consumer-poll-warning.js:8-9,58` still say "poll/take".
  2. The path predicate compares against constants (`ingest.js:21-22`) that the routers do not import (`dispatch.js:1357,1359` and `proxy-runner.js:48` use their own literals). Heartbeat path code literals went 3 → 5 (re-verified). A route rename would silently go back to touching; the route test would catch it.
  3. `dispatch-integration.md:280`, "The runner kit sends the same body", is still false: the kit has 0 heartbeat calls.
- **Sub-row `consumer-heartbeat-wire-restated`: unchanged.**
  - The 18-field list is ×4: `consumer-heartbeat.js:28-34`, its test `:7-13`, SD `host-heartbeat.js:19-25` and SD `test/host-heartbeat.test.js:11-17`. By shape it is ×5, because the parser's `OPTIONAL` map (`:65-79`) is a fifth copy. `HEARTBEAT_FIELDS` has 0 production readers.
  - Schema ×2. Interval bounds ×2 by the old method, ×3 by shape (`ingest.js:69` restates them in its error string).
  - The false "a rename on either side fails a test" claim is now in **4** places: both modules and both tests.
  - Stale vs TTL: an interval of 300000 or more still never reads stale (`store:63`).
- **LIN-3636** no longer extends the conflation, so its 10-18 comment is stale. Update it: a kit beat should carry `lastPollOkAt`, and close-out should fix `dispatch-integration.md:280`, the contract row's kit cell and the tautological test `runner-kit-contract.test.js:102-103`.

### L2. Owner answer (LIN-3648 / 3654 / 3655): reader RESOLVED; wrapper residue LOW (V; probed at both SHAs with 11 answer kinds).
- LIN-3648's own raw-read grep finds 6 lines at `ea96357a` and **0 at HEAD**. The home is `lib/workspace-owner.js:98-113`.
- **7 gates** read it (6 at baseline; the 7th is new with LIN-3285):
  1. `owner-mint-refusals.js:111-136`, which has 4 callers
  2. `proxy-tokens.js:390-411` `mintGrantBootstrap`
  3. `proxy-tokens.js:601-611` `#ownerStillOwns`
  4. `workspace-removal-revocation.js:48-57` `isOwner`
  5. `routes/runner-setup.js:63-79`
  6. `routes/task-share.js:150-158`
  7. `connection-credential.js:1435-1438` `ownerInstallationIds` (LIN-3285)
- At HEAD every non-owner answer is denied at every gate, with no escape and no hang.
  - At `ea96357a` there were real escapes: a function carrying `status:'owner'` was ALLOWed by the grant-mint refusal; a throwing `status` getter gave an uncoded escape in `mintGrantBootstrap` and hung the share page; a thrown `null` hung the runner page.
  - LIN-3654 and LIN-3655 fixed those two.
- **Did 3654/3655 add per-site shapes? No.** They moved reads inside try blocks that already existed. But `readOwnerStatus` deliberately lets a throwing getter propagate (`workspace-owner.js:91-93`), so **try placement is each caller's job, and 7 hand-written wrappers remain**. Each has its own unwired-seam check, and two have none and rely on a TypeError being caught.
- **Census G0208** (`status=='owner'`, 6 → 4) moves from **real → borderline**.
  - The status→refusal-code map is written twice: `proxy-tokens.js:400-411` and `owner-mint-refusals.js:128-131`. It is parity-tested.
  - G0207 (`'no-owner'`, 3 → 4) and G0252 (`'not-owner'`, 2 → 3) **grew because the new home itself (`workspace-owner.js:101`) adds a third area**. A consolidation raised the rank of the groups it consolidated, which is a gauge-validity note.
- **`isOwner` twin:** its raw read is gone, but the wrapper survives. It has the same guard / try / `isOwnerAnswer` / catch / `false` shape as `#ownerStillOwns`.
- **Security hand-off, still open:** `accountIdsFor` (`workspace-removal-revocation.js:35-46`) still differs from `resolveAccountGroup` (`account-group.js:24-35`, which includes merged accounts). LIN-3414's new Privacy text says removal revokes the tokens "that you made". So a token minted under a merged alias would contradict the published text (I).

### L3. Credentials (LIN-3285 / 3626): MEDIUM-HIGH, core unchanged, widened (V).
- **Counts 6 / 7 / 5 / 4 / 3 / 7** at both SHAs:
  - choosers by call count 11 / 2 / 2 / 3 / 1 / 2 / 1;
  - token-equality choosers at `connection-credential.js:511`, `workspace-token-resolver.js:60`, `workspace.js:935,968,1115`;
  - first-of-provider choosers at `workspace.js:372,422,593` and `workspace-token-resolver.js:61`;
  - persist seams at `account-merge.js:169`, `auth.js:307,434`, `jira-auth.js:328,700,798` and `routes/test.js:77`.
- **Writer repro, re-run at both SHAs on `git archive` extractions, identical:** `{site-B,B-OLD} → {site-A,NEW}`. `applyAccessTokenToWorkspace` (`workspace.js:342-380`) has a 0-line diff.
- **LIN-3285 added no chooser and no durable copy**, but it widened the row:
  - a **third installation source**, `ownerInstallationIds` (`connection-credential.js:1435-1450`). It has its own unit-id fallback (`credentials.installationId ?? unitId`, `:1445`) instead of `unitIdForBinding` (`connection-binding.js:115`);
  - a second in-process token cache (`:1430`), beside the 30 s cache at `server.js:2434`;
  - **`INSTALLATION_KEYED_PROVIDERS`** (`:1385`), a fifth `{github, github-projects}` list (census G0071, new, 5 files; ruled **real, low**). The file already imports `isRemintKind` (`:41`);
  - a credential-core → network import: `connection-credential.js:51-52` now imports `providers/github/app-auth.js` and `github-pr-status.js`. Its header (`:29-32`) was amended to call this "the one exception".
- **Improvement:** the PR-read token rule was inlined at 5 sites and is now 1 `resolvePrReadToken` (`github-pr-status.js:117`).
- **LIN-3626:** the `listUserInstallationIds` lambda is still copied at `routes/github-auth.js:70` and `routes/github-projects-auth.js:74`. Its body is now one call to `installationIdsOf`, so the logic has one home. Partly improved.
- G0363 `{jira, linear}` is noise: `REFRESH_TOKEN_KINDS` and `readsPrViaOwnerInstallation` are different decisions. G0369 (the graphql clone) is a re-key, borderline-noise.
- LIN-2150 (Todo) and LIN-2188 (Backlog) are untouched in the window.

### L4. Free tier (LIN-3658): RESOLVED by consolidation (V).
- The ticket greps find 3 / 3 / 11 outside the home at `ea96357a` and **0 / 0 / 0** at HEAD.
- The 3 rules are now named rules in one home, sharing `hasNoOwnCredential` (`chat-request.js:46`): `resolveChatCredential` (`:125`), `resolveOpenRouterSource` (`:71-75`) and `isFlagFreeTier` (`:90-92`). They were kept apart on purpose (neither is a superset), with the open questions in LIN-3663 / 3664 / 3665 / 3598.
- **The refusal block went 11 → 1:** `freeTierRefusalBlock` (`:102-104`), with 12 calls across 8 route files.
- Census G0002 is **gone, consolidated**. The 3 leftover sites re-key as **G0079** `{remaining, limit}`: the home, the `/api/dispatch/quota` wire (`routes/dispatch.js:553`) and its browser reader (`prompt-section.js:1404`). G0079 is **noise**: it is a wire projection with no rule in it.
- **`chargeFreeTierOrReject`** (`routes/proxy.js:1354-1372`) was not moved. It is still a pre-built `{status, body}` producer with 7 callers, and its body now spreads `...freeTierRefusalBlock(check)`.
- **Residue that LIN-3658's counting rule missed** (LOW):
  - `workspace-api.js:1325`: `isRecommendationEnabled(k) || source === 'free'`, which equals `resolveOpenRouterSource(...) !== null` restated outside the home;
  - `surfaceFreeTier` is a byte-identical line twice (`workspace-api.js:1361,1481`).
- `public/` does not re-derive the rule.

### L5. Terminal-state predicate (LIN-3612 / 3656 / 3659): IMPROVED; browser copies remain (V).
- Production imports of the state predicates via `tree.js` / via `state-map.js`: **10 / 10 → 0 / 22**.
- **`tree.js` still re-exports** (`:183-184`), as LIN-3612 specified, but only `scripts/eval/fetch-proxy-tasks.mjs:34` and `tests/unit/tree.test.js:8` import it. Production has one import path.
- Terminal-set restatements went **9 → 4**, all in the browser: `public/common.js:1155`, `ship.js:13`, `swim.js:21`, `swipe.js:10` (census G0072, table).
  - `ship.js`, `swim.js` and `swipe.js` already load `/common.js` first (`render-ship.js:106`, `render-swim.js:106`, `render-swipe.js:601`), so the 4 browser copies could be 1.
  - Copies that omit `duplicate` went 5 → 0.
- **Gone groups:**
  - G0026 `{canceled, completed}`: consolidated. It is a deliberate behaviour change: `duplicate` now counts as finished.
  - G0047: partly consolidated; it re-keys as G0072.
  - G0337 `type=='canceled'`: reshaped. `render-task-page.js:442` is now `canceled || duplicate`.
- **A new contradiction surfaced (re-verified).** A `duplicate` gets three different glyphs:
  - ✓ from `getStateDisplay` and `swipe.js:183-186`;
  - **✕** from `public/context.js:39-40`;
  - **○**, the todo glyph, from `render-task-page.js:100-104`, which is used for the reference list at `:547`.

  Since LIN-3656, the task page heads a duplicate task "Cancelled" but paints a duplicate relative as ○.
- **`state-type-label-rank-maps`:** 12 maps outside the home, every one with a 0-line diff. The `'Todo'`/`'Done'` vs `'To Do'`/`'Completed'` labels still differ. The finished-set clause is fixed (LIN-3656). The delta is mixed.

### L6. Close-out (LIN-3634 / 3657 / 3379): head-moved IMPROVED; "merged" HELD, plus one reader (V).
- **One rule, one refusal body, two callers.**
  - The rule: `deriveCloseOutState` returns `reason:'head-moved'` (`run-closeout-state.js:316-327`), reached via `closeOutNotReady` → `readCloseOutChain` (`close-out-readiness.js:125-145,74-101`).
  - The 409 body is built once, in `closeOutNotReadyRefusal` (`:108-113`).
  - Caller 1, the session lane: a `SESSION_STAGES` stage (`dispatch-entrance.js:1167-1194`). This is the same lane as LIN-3634's "dispatch lane", via `routes/dispatch.js:436` → `enterSessionDispatch`.
  - Caller 2, the press: `workspace-api.js:3727-3742`.
- **Unchecked lanes:** `PROXY_STAGES` (`:1249`), `RECOMMEND_STAGES` (`:1350`) and `KICKOFF_STAGES` (`:1650`). LIN-3417 is Backlog.
- **"Merged" still has two sources:**
  - live PR state, `run-evidence.js:84` and `run-closeout-state.js:103`;
  - the record, `close-out-events-store.js:265,281`.

  `CLOSE_OUT_ALREADY_MERGED` is refused on the press only, as a literal (`workspace-api.js:3724-3725`).
- **Client order is unchanged:** dispatch first, then the press record (`close-out.js:110`→`:122`, `session.js:534`→`:547`). So a merged-on-record press still enqueues the dispatch before the 409.
- **Both client copies repaint a head-moved state as "○ set up ›"** (`close-out.js:90-91`, `session.js:484-485`), which discards the refusal's reason.
- **LIN-3379 added a reader with a second meaning of "merged."** `render-task-page.js:432` `settling = … status === 'merged'` excludes `partial`, while `atMerge` (`render-run-evidence.js:157`) means merged-or-partial. Census G0073 grew by this exact site. G0110 (the old G0129, `{merged, partial}`) is unchanged: 5 sites, real.
- **First seen this edition, pre-existing:** `headMoved` is computed twice with the same formula, at `run-evidence.js:106` and `run-closeout-state.js:107`. The new site `close-out-readiness.js:128` is a consumer of the stop-at home (census G0007, 10 → 11), not a copy.
- **LIN-3521** still holds two `applyCloseOutState` copies: `close-out.js:83-95` and `session.js:477-489`.

### L7. CI-wake sweep (LIN-3661, `lib/ci-wake-sweep.js`): NEW, LOW-MEDIUM as a cluster (V, re-verified).
- **Uses the shared authorities correctly:**
  - `summarizeChecks`, `readPrStatuses`, `derivePendingPark` and `mergeLineageFeedback`;
  - `enqueueFollowUp`, which keeps the owner gate and the credential finalize;
  - `isLiveParkedWaiter`, which is newly extracted, and `liveness-alarm-sweep.js:175` now calls it. That part is a consolidation.
- **Re-derives anyway:**

| decision | sweep | home that exists | ruling |
|---|---|---|---|
| follow-up target (web→web; dash/local refused; else cli) | `:52` local `NON_SESSION_TARGETS = new Set(['dash','local'])`, which shadows the export; applied at `:309` | `dispatch-targets.js:33` exports `NON_SESSION_TARGETS`; `chat-tools.js:1245-1249` `deriveFollowUpDispatch` applies the same rule | real, LOW. `target-vocabulary` **worsened** (named lists outside the declaration 0 → 1) |
| lineage rows (live + history, dedupe, sort) | `readLineageRows` `:240-255`, `:277-283` (its own comment cites "the `sweepD2` read") | `liveness-alarm-sweep.js:161-171,194-200` | real, LOW |
| PR-URL regex | `FULL_PR_URL_RE` `:54`, any scheme; it also imports `extractPrUrls` | `run-ledger.js:415` exports `PR_URL_RE`; others at `run-evidence.js:22`, `github-pr-files.js:36`, `milestone-funnel.js:58` | real, LOW. PR-URL regexes go **4 → 5** |
| timestamp parse | private `toMs` `:227`, which returns NaN into the sort comparators at `:254,299` | `toEpochMs` (37 importers) | LIN-3453's own command gives **0 → 1**: `timestamp-parse-consolidation` **worsened** |
| tick-time owner access → `{provider, callScope}` | `createTickWorkspaceResolver` `:124-165`, gated on `reason==='ok'` | `task-share-access.js:30-39`, gated on a truthy token | borderline; hand-off to the credential row |

- **Layering (file-level, this review's remit):**
  - `followUpForLoop` comes from `chat-tools.js` (2,109 lines). Its `force` value comes from the `isLoopTerminal` copy at `chat-tools.js:1198-1200`, the copy whose comment says it exists only until #977 lands. The sweep is a **new consumer of a `terminal-loop-rule-copies` copy** (LIN-1496).
  - `resolveWorkspaceIdMapFromSessions` comes from another sweep's internals (`credential-invariant-sweep.js`). The sweep is its 2nd importer, after `openrouter-key-resolver.js:1`.
  - Both follow existing patterns. Area-level knots are Seams & Tangles' to measure.
- **Non-wire error producer:** `:404` synthesises `{status:500, body}`. It is read internally only, so it is not counted under `routes-error-envelope-fragmentation`.
- **Its own wake marker,** `ci-wake: <sha7> <verdict>` (`:90-92`), is born and read in this file only.
- **G0063 `[ci-wake-sweep]`** is a log tag: noise.
- **Stability hand-off:** `scheduler.register` jobs went 5 → 6 (`server.js:967-972`). The bare hourly `setInterval` is now at `server.js:4586`.
- The sweep's `baseUrl` is `resolveEmailLinkOrigin` (`server.js:963`). That is an API-base reuse, noted for the cross-repo api-base row (I).

### L8. Waiting on a person and question cards (LIN-3499 / 3513 / 3498 / 3497): human-wait UNCHANGED; one predicate gap (V).
- **The authority is unchanged:** `WAITING_WAKE_MARKERS` + `isWaitingWakeMarker` (`dispatch-terminal.js:83,94-96`).
  - 0 set copies, 0 inline checks, 10 predicate callers in the same files.
  - The divergent regex has moved to `render-session.js:81`.
  - 2 agent-status mappings; 2 union and 4 marker-only readers. The banner and clock files have a 0-line diff, so the channel-split probe holds.
- **Question cards are a carve-out, not a browser port.** `lib/question-card.js` renders the markup; `public/question-cards.js` binds behaviour from the server's `data-*`.
  - The card is gated on `deriveHeader`'s `status==='waiting'` (`task-page-loader.js:725`), which comes from the union reader `dashboard.js:347-356`.
  - Census G0093 (`status=='waiting'`, new) is **noise**: its 5 sites read one derived value.
  - G0183 (`restoreButton`) is noise: it is a move.
  - G0214 (`state=='waiting'`) is borderline (held).
- **Gap first seen this edition:** the **pause** marker has no predicate. Inline `marker === 'pending'` checks went **8 → 9** (census G0066, table, grown; ruled real, LOW):
  - `dispatch-store:2462`
  - `dispatch-wake:80,201,342,347`
  - `liveness-detectors:462,513`
  - `dispatch-terminal:290,312` (new with LIN-3661)
  - `task-page-loader:178` (new with LIN-3513)

  Home: an `isPauseWakeMarker` beside `WAITING_WAKE_MARKERS`.
- **Resume-marker dependency widened:** `derivePendingPark` (`dispatch-terminal.js:303-315`) also clears on SD's `[working] Session resumed.`, which the kit never posts. Two Harbour derivations now depend on that SD-only text.
- **LIN-3498 consolidates:** the `takenAt || dispatchedAt` fallback went 3 → 1 (`attemptStartedAt`, `task-page-loader.js:321`).
- **LIN-3497 is borderline, new:** "review on record" is built inline twice, at `close-out-readiness.js:86-87` and `run-evidence.js:149-150`. Meanwhile `readRunLedger` (`run-ledger.js:411`) keeps the old semantics for its one caller.

### L9. Runner contract, halt and the kit (LIN-3630 / 3495 / 3496 / 3624): MEDIUM, UNCHANGED; the one-way-pin verdict stands (V).
- **`contract.json` is still a test fixture** (`:3`), now 24 rows. Harbour amended it in `d947d2dc`, and SD re-copied it by hand 8 minutes later (`b43fdcaa`). Both are sha `efe6658f…`, byte-identical.
  - The pin is still one-way, and no mechanism forced the sync.
  - SD's `LV_COMMIT='d947d2dc'` is now correct (`test/runner-contract.test.js:25`), but the header at `:14` still says `1804aeb6`.
  - The heartbeat-row tautology is still at `runner-kit-contract.test.js:102-103`.
- **Halt: improved, with one new untabled case.**
  - SD now reads an unknown mode as pause (`halt.js:258-264` `normaliseHarbourHalt`), so the fresh-item row agrees.
  - The new abort-under-unknown row is listed. Stop text is listed (`dispatcher.js:612-616` vs `runner.mjs:297`). Stop + follow-up with no session is still open.
  - **Untabled:** a follow-up under an unknown mode. SD applies pause rules; the kit leaves it (`runner.mjs:218`).
  - Pause/stop literals: one declaration each in Harbour (`workspace-halt.js:28`), SD (`halt.js:262`, moved from `dispatcher.js:1664`, not copied) and the kit (`:218`).
- **LIN-3495:** one `describeConnectFailure` (`broker.mjs:274-280`, 4 callers). It is a consolidation inside the kit, with no contract impact.
- **LIN-3496:** `parseCredentialBlock` (`runner.mjs:580-616`) now relies on two layout facts of the Harbour producer `public/runner-setup.js:33-46`. Its test pins a hand copy of the served block (`runner-kit-credential-block.test.js:17-27`), not the producer. New row `credential-block-grammar-split`, LOW.
- **LIN-3624's description is NOT corrected.** It still says the four markers are "listed as unpinned in the SD contract test"; the correction exists only as the 10-18 comment. Every residue item is still present at HEAD:
  - the 4 markers and the resume marker;
  - `[dispatcher] going down` (`shutdown.js:149`);
  - the 4 row fields (0 in the kit);
  - the harness (`runner.mjs:138-140`);
  - the decision-prefix window;
  - the abort texts (`runner.mjs:373,379` vs `abort.js:86`);
  - recap chunking;
  - the one-way pin.
- **Carried and unchanged:** `decision-dialect-split` (0-line diff), the wake regex (`feedback.js:22` ≡ `dispatch-terminal.js:63`; the SD comment still cites `:53`), the kit terminal regex, API base (SD 2, Harbour inline 23), CI, `dispatch-kind`, `cross-repo-repo-list` and `runner-liveness-assumption`.
- **LIN-3074 looks obsolete.** The "does not yet honor / pending LIN-2995" copy has 0 production hits, and `dispatch-integration.md:136` is already corrected. It is a candidate to close.
- **SD internals:** `b43fdcaa` touches no phase literal or state write. `reapers.js` (`sd-blocked-child-last-activity-split`) has a 0-line diff. SD has no census tool, so SD was reviewed by reading. The commit subject says "(do not merge)" but it is on main.

### L10. Dispatch entrance and AI gate: UNCHANGED (V).
- **Entrance:**
  - budget predicate ×3 (`dispatch-factory.js:349`, `pipeline-loops.js:620`, `autopilot-kickoff.js:322`; 0-line diff);
  - variant messages ×2 (`dispatch-entrance.js:158` vs `:276`);
  - `ROW_FIELDS` at `:351`;
  - the D1 503 ×2 (`proxy-compute.js:648,933`);
  - 5 non-entrance enqueue sites.
- **Default `'cli'`:** client 13 → 13 (reproduces). Server is 18 at `ea96357a` by my method, one short of 10-18's 19, so that count was not reproduced; HEAD is 19 (+`ci-wake-sweep.js:309`).
- **The wire `F: x.F` count was not reproduced** (a strict regex gives 18/0/10/5 at both SHAs), but the projecting files have a 0-line diff.
- **LIN-3494 removed a client-side restatement:** Go now shows the server's `error`/`message`.
- **New, borderline:** the close-out entrance stage restates the factory's `inheritFromAnchor` issue rule (`dispatch-entrance.js:1171-1178` vs `dispatch-factory.js:579-592`). The press route has a third variant (`workspace-api.js:3733-3736`).
- **AI gate:**
  - 13 gates through `isAiUnavailable`, 9 not;
  - mock dialects 6 / 6;
  - the data-mock predicate 14 / 16 by probe (delta 0);
  - order restatements outside the home went **2 → 1**: `getOpenRouterSource` (`server.js:1085-1086`) now wraps the home.

  `run-paragraph-hook.js:30` still reads the key untrimmed.
- **`fresh-run-definition-copies`:** unchanged. There are 3 definitions plus the Mongo filter, and the factory gate re-spells the 5 clauses inline (`dispatch-factory.js:284-288`).

### L11. Plan-review ceiling (LIN-3651): one named constant, plus one literal (V).
- `REVIEW_LOOP_CEILING = 5` (`recommendation-facts.js:266`), decided once at `:298`. `prompt-system.md:7` names the constant.
- **Restatement:** `openrouter.js:1833` hard-codes "ceiling of 5 reviews" in user-visible text, although it imports `reviewLoopStop`. New row `review-loop-ceiling-restated`, LOW.
- **Prompt freeze:** `FROZEN_TOTAL_BYTES` went 342577 → 342592 (LIN-3612, an import path) → 342957 (LIN-3651). Each raise is recorded with its reason beside it, so the invariant holds.

### L12. Layering, invariants and markers (V).
- **Tarjan:** 0 SCCs, 0 upward edges. The wrong-way edges at file level are the two sweep imports (L7) and `connection-credential → providers/github/app-auth` (L3). Production → tests: only `routes/test.js`.
- **CLAUDE.md single homes: all hold**, now counted as 6 because the Invariants list carries more than 10-18 counted:
  - one recommendation path;
  - owner read (`getWorkspaceOwnerAccountId` is used by the new LIN-3285 reader);
  - email availability;
  - the prompt freeze (above);
  - the scheduler roster (`source-map.md:176` says "Six jobs", and the census test passes);
  - runner copies owner-only.
- **Inline markers:** 7 raw / 0 real at both SHAs in Harbour; 0 / 0 in SD.

## Adversarial Second-Read

**Tier used: Tier 2.** The reader was a fresh-context sub-agent with no memory of the report-writing turn. Tier 1 (a separately dispatched session) was unavailable: this session's proxy token carries no `dispatch` grant (the `/instructions` grants line reads "(none)").

**Question asked:** "What is the largest item in this window that this report missed or misfiled?" The reader got the report path, both SHA pairs and the window bounds (`ea96357a..77704276`, SD `4c9fb76..b43fdcaa`), and was told to check source rather than prose and to look at decisions restated inside unchanged files.

**Fields:** `Adversarial second-read verdict: AGREE` · `Differed from top finding: YES` · `Disposition: fixed in place`

**Reader's answer, condensed:** nothing larger than the report's #1 (`credential-decision-multiplicity`) was missed, but one row was. LIN-3626 added `walkInstallationPages` (`lib/providers/github/installation-pages.js:29-65`) beside the unchanged `walkRepoPages` (`lib/providers/github/client.js:84-98`). The two now decide differently how a GitHub envelope walk ends: `walkRepoPages` defaults an absent `total_count` to `out.length`, which kills its short-page rule and stops after one full page of 100; the new walker treats an absent `total_count` as unknown. `walkRepoPages` still serves `listRepos` (`:119`) and `listUserInstallationRepos` (`:156`). The reader's own answer differs from the report's top finding (hence `Differed: YES`), but it did not outrank it. Independently re-checked and correct: both heartbeat doors use `tokenValidationOptions` (`routes/dispatch.js:288`, `routes/proxy.js:546`), the private `NON_SESSION_TARGETS` at `ci-wake-sweep.js:52` (same value as the export, so a restatement not a contradiction), the `duplicate` glyph split (`public/context.js:39-40` ✕; `render-task-page.js:100-104` has no `duplicate` case so it falls through to ○), 0 raw owner-status reads outside `workspace-owner.js`, and the credential lines. No citation errors.

**Disposition: fixed in place.** I re-read both files at HEAD: the finding is real, and `installation-pages.js:6-10` documents the divergence as deliberate ("Deliberately NOT `walkRepoPages`"), so it is latent (GitHub normally sends `total_count`) and a known, commented split rather than silent drift. Added as ledger row `github-envelope-walker-split` (LOW, new). It is counted in the ledger but, like the layering row, **excluded from the LIN-3490 tally of 43** because it is a documented deliberate split, not an accident of copying. The severity order and the follow-up set are unchanged; not promoted (the cap is better spent on the three promoted rows). Candidate for a later edition: make `walkRepoPages` use the unknown-`total_count` rule.

## Census rulings (all 90 `mustRule` groups)

Tool and command as in part 1, at `77704276` vs `ea96357a`, with one area guide. **One ruling per group: 26 real, 29 borderline, 35 noise** (10-18: 30 / 26 / 33).
- **Reused vs re-ruled.** 83 rulings are reused unchanged from 10-18. 7 are re-ruled: G0007, G0079, G0093, G0207, G0208, G0214 and G0252.
- **Matching to 10-18 ids.** Group ids are re-assigned every run, so HEAD groups were matched to 10-18 by the tool's `groupKey`. Clone groups named "tiny rule (anonymous)" collide on that key, so they were matched by file overlap: G0015→10-18 G0016, G0030→G0032, G0180→G0202, G0091→G0082, G0150→G0149.
- **Nothing fell out of mustRule, and nothing crossed in by rank.** The 89 groups that were mustRule at 10-18 are 86 matched at HEAD plus 3 gone.
  - Two groups crossed **in** by gaining a third area: G0207 and G0252. In both, the third area is LIN-3648's new home (`workspace-owner.js:101`).
- **Real groups and distinct decisions.** The 26 real groups reduce to **18 distinct decisions**, using 10-18's five stated merges (AI gate; terminal loop; mock-ai; observer; state set).
  - **Baseline correction:** the same five merges applied to 10-18's 30 groups give **21**, not "~19". The like-for-like census series is **21 → 18**.
  - The 3 decisions that left: free tier (G0002), the finished set (G0026 with G0047's server copy), and the owner reader (G0172 real → G0208 borderline).

| HEAD rank | HEAD id | decision (short) | status | areas/files | ruling | home or reason | ledger row / ticket | reused or re-ruled |
|---|---|---|---|---|---|---|---|---|
| 1 | G0001 | NODE_ENV == 'test' | unchanged | 7/17 | real | lib/should-mock-ai.js (+ shared limiter skipInTest) | ai-availability-gate-duplication; LIN-2847 | reused (10-18 G0001) |
| 2 | G0002 | kind == 'autopilot' | unchanged | 4/13 | real (subset) | session-summary findAnchorLoop / task-run-facts | LIN-3349 (no own row) | reused (10-18 G0003) |
| 3 | G0003 | rec {id=ID.id, identifier=ID.identifier, title=ID.title} | unchanged | 7/10 | noise | projection of three fields; no rule inside | — | reused (10-18 G0004) |
| 4 | G0004 | accessToken == 'test-token' | unchanged | 5/7 | real | lib/should-mock-ai.js | ai-availability-gate-duplication; LIN-2847 | reused (10-18 G0005) |
| 5 | G0005 | authType == 'oauth' | unchanged | 4/8 | real | lib/workspace.js getBindingCallScope | credential-decision-multiplicity | reused (10-18 G0006) |
| 6 | G0006 | rec {deployInfo=getDeployInfo(), urlKey=ID.urlKey, openRouterS | unchanged | 2/13 | real (cheap) | lib/components/page.js — 14 routes pass the same chrome options; one object in `components/page.js` ends it | page-chrome-options | reused (10-18 G0007) |
| 7 | G0007 | stopAt == 'pr' | grown 10→11 | 5/9 | real | `lib/task-run-facts.js` `readTaskRunFacts().stopAt` (claimant 2: `dispatch-entrance.js:1647` inheritedStopAt / `dispatch-factory.js:1030`). +1 site `close-out-readiness.js:128` (LIN-3634) reads the home's answer — a consumer, not a copy; `routes/dashboard.js:1760` still restates `task-run-facts.js:49` verbatim | dispatch-entrance-field-duplication; LIN-3608, LIN-3521 | re-ruled (grown 10→11) |
| 8 | G0008 | type == 'completed' | unchanged | 6/8 | noise | provider state-type test; the shared finished set (10-18 G0026/G0047) is now `isTerminalState` server-side (gone groups) | — | reused (10-18 G0009) |
| 9 | G0009 | provider == 'jira' | unchanged | 2/6 | noise | provider switch at the edge; each branch differs | — | reused (10-18 G0010) |
| 10 | G0010 | kind == 'wake' | unchanged | 2/9 | real | dispatch-store isFreshRun | fresh-run-definition-copies (10-18 also listed under dispatch-entrance-field-duplication) | reused (10-18 G0011) |
| 11 | G0011 | type == 'started' | unchanged | 5/7 | borderline | state-map isInProgress | — | reused (10-18 G0012) |
| 12 | G0012 | set {'127.0.0.1', 'localhost'} as array [[...].includes, [...] | unchanged | 3/4 | real | lib/dispatch-targets.js | localhost-predicate-split / target-vocabulary | reused (10-18 G0013) |
| 13 | G0013 | status == 'taken' | unchanged | 2/9 | borderline | liveness-detectors | — | reused (10-18 G0014) |
| 14 | G0014 | tiny slugifyForFilename() (also: githubSlug, stripMarkdown, sl | unchanged | 5/8 | borderline | prompt-formatters slugifyForFilename | — | reused (10-18 G0015) |
| 15 | G0015 | tiny (anonymous)(), 9 copies of 1-4 statements | unchanged | 3/9 | borderline | `lib/openrouter.js` (reused from 10-18 G0016; lead's G0208 match was a groupKey collision — file overlap 9/9 with 10-18 G0016) | — | reused (re-matched) |
| 16 | G0016 | marker: [evidence] | unchanged | 5/6 | real | session-telemetry EVIDENCE_PREFIX | cross-repo-sentinel; LIN-3624 | reused (10-18 G0017) |
| 17 | G0017 | provider == 'linear' | unchanged | 2/4 | borderline | workspace-token-refresh defaultResolveExchange | credential-decision-multiplicity | reused (10-18 G0018) |
| 18 | G0018 | name == 'AbortError' | unchanged | 4/6 | noise | standard fetch-abort check | — | reused (10-18 G0019) |
| 19 | G0019 | NODE_ENV == 'production' | unchanged | 2/4 | noise | environment switch, not a domain decision | — | reused (10-18 G0020) |
| 20 | G0020 | marker: [blocked] | unchanged | 3/7 | borderline | dispatch-terminal — the parse side is the authority; the emit side is the kit | cross-repo-sentinel; LIN-3624 | reused (10-18 G0022) |
| 21 | G0021 | const UUID_REGEX=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f | unchanged | 4/6 | borderline | lib/workspace.js | — | reused (10-18 G0023) |
| 22 | G0022 | type == 'blocks' | unchanged | 3/10 | noise | relation type literal; one meaning | — | reused (10-18 G0024) |
| 23 | G0023 | lit-rec {Cache-Control="no-cache", Connection="keep-alive", Co | unchanged | 2/5 | real | lib/http-keepalive.js | sse-frame-writer-duplication; LIN-3475 | reused (10-18 G0025) |
| 24 | G0024 | set {'aborted', 'done', 'failed', 'skipped'} as Set/or-chain/t | unchanged | 4/5 | real | lib/dispatch-terminal.js | terminal-loop-rule-copies; LIN-1496 | reused (10-18 G0021) |
| 25 | G0025 | rec {token=ID.token, expiresAt=ID.expiresAt, provider=ID.provi | unchanged | 3/3 | borderline | server.js resolver — cache tuple; follows the credential row, no separate decision | credential-decision-multiplicity | reused (10-18 G0027) |
| 27 | G0027 | rec {code=ID.code, category=ID.category, retryable=ID.retryabl | unchanged | 4/7 | real (cheap) | lib/errors.js — refusal envelope; `lib/errors.js` is the home | routes-error-envelope-fragmentation | reused (10-18 G0029) |
| 28 | G0028 | provider == 'local' | unchanged | 4/4 | noise | provider switch at the edge | — | reused (10-18 G0028) |
| 30 | G0030 | tiny (anonymous)(), 8 copies of 1-4 statements | unchanged | 5/6 | borderline | `providers/linear` (reused from 10-18 G0032; file overlap 6/6) | — | reused (re-matched) |
| 31 | G0031 | set {'Apr', 'Aug', 'Dec', 'Feb', 'Jan', 'Jul', +6} as array [m | unchanged | 3/5 | noise | month names for display; harmless | — | reused (10-18 G0034) |
| 33 | G0033 | recommendedAction == 'defer' | unchanged | 3/4 | borderline | recommend-recurse | — | reused (10-18 G0035) |
| 34 | G0034 | code == 'OWNER_CHECK_UNAVAILABLE' | unchanged | 3/5 | borderline | proxy-preamble — sentinel string shared by two modules; follows the credential row | credential | reused (10-18 G0037) |
| 36 | G0036 | category == 'auth' | unchanged | 4/4 | noise | error-category branch at the edge | — | reused (10-18 G0043) |
| 38 | G0038 | tiny (anonymous)() (also: brief), 3 copies of 1-4 statements | unchanged | 3/3 | noise (new only because mocks moved, LIN-3596) | new only because LIN-3596 moved the mocks; same shape | — | reused (10-18 G0039) |
| 45 | G0045 | status == 'ready' | unchanged | 3/5 | noise | ready status literal; unrelated meanings | — | reused (10-18 G0061) |
| 46 | G0046 | outcome == 'self-resolved' | unchanged | 3/4 | noise | self-resolved flag, one producer | — | reused (10-18 G0048) |
| 55 | G0055 | stateType == 'started' | unchanged | 3/11 | borderline | render-roadmap | — | reused (10-18 G0062) |
| 56 | G0056 | set {'complete', 'error'} as Set/or-chain [LOOP_TERMINAL_AGENT | unchanged | 3/3 | real | lib/dispatch-terminal.js | terminal-loop-rule-copies; LIN-1496 | reused (10-18 G0052) |
| 59 | G0059 | variant == 'stepper' | unchanged | 3/3 | noise | variant literal; the validator is G0151 (10-18 G0150) | — | reused (10-18 G0067) |
| 64 | G0064 | outcome == 'dismissed' | unchanged | 3/4 | borderline | task-decisions-store | — | reused (10-18 G0056) |
| 65 | G0065 | marker: [failed] | unchanged | 3/4 | borderline | dispatch-terminal parses / kit emits | runner-contract; LIN-3624 | reused (10-18 G0068) |
| 67 | G0067 | turnKind == 'user-initiated' | unchanged | 4/5 | borderline | lib/agent-turn.js | — | reused (10-18 G0069) |
| 70 | G0070 | agentState == 'error' | unchanged | 3/3 | noise | agent-state test; ruled at G0056 (10-18 G0052) | — | reused (10-18 G0071) |
| 79 | G0079 | rec {remaining=ID.remaining, limit=ID.limit} | new | 3/3 | noise | after LIN-3658 the 3 sites are the home builder (`chat-request.js:103`), the quota endpoint projecting store usage (`routes/dispatch.js:553`) and the browser reading that endpoint (`public/prompt-section.js:1404`): a wire projection, no rule. Residue of gone 10-18 G0002 (re-keyed: `resetsAt` dropped from the shared key) | free-tier-rule-copies (resolved) | re-ruled (new) |
| 80 | G0080 | tiny _issueRef() (also: refOf, projectNeighbor), 3 copies of 1 | unchanged | 3/3 | noise | ref projections with different fields | — | reused (10-18 G0078) |
| 81 | G0081 | marker: [ticket-closer] | unchanged | 3/3 | borderline | `lib/ticket-close-closer.js` (owns `LOG`) — a console tag, not a posted marker | not cross-repo-sentinel (a console tag, not a posted marker) | reused (10-18 G0079) |
| 82 | G0082 | set {'fable', 'haiku', 'opus', 'sonnet'} as array [DISPATCH_CL | unchanged | 3/3 | borderline | `lib/render-settings.js` ↔ `public/common.js` | — | reused (10-18 G0080) |
| 83 | G0083 | rec {id=ID.id, body=ID.body, createdAt=ID.createdAt} | unchanged | 4/5 | noise | comment record, three fields | — | reused (10-18 G0081) |
| 88 | G0088 | heading: changelog | unchanged | 3/4 | real | `lib/workspace-api-mocks.js` `buildMockBrief` (headings as a contract) | mock-ai-builder-copies | reused (10-18 G0088) |
| 89 | G0089 | heading: constraints | unchanged | 3/4 | real | as G0088 | mock-ai-builder-copies | reused (10-18 G0089) |
| 90 | G0090 | heading: open questions | unchanged | 3/4 | real | as G0088 | mock-ai-builder-copies | reused (10-18 G0090) |
| 91 | G0091 | clone clear(), ~7 statements, structurally identical | unchanged | 3/8 | borderline | none (no base Mongo store exists) — reused from 10-18 **G0082**, which was mustRule (rank 82, 8 sites). "2→8" was a groupKey collision with the 2-file G0335 (now G0347) | — | reused (re-matched) |
| 92 | G0092 | tiny hashEmailRecipient() (also: hashState, hashContext, input | unchanged | 3/8 | noise | hash helper, identical by design | — | reused (10-18 G0096) |
| 93 | G0093 | status == 'waiting' | new | 3/4 | noise | born LIN-3499: all 5 sites read the one task `status` produced by `task-page-loader.js` (`question` built only when waiting, `:725`); renderer re-gate `:630`, client reload gate `task-page.js:574-577` and Go suppression `prompt-section.js:1001` (reads the same state endpoint) are consumers | adjacent human-wait-derivation-split | re-ruled (new) |
| 95 | G0095 | tiny (anonymous)() (also: loadLoops), 3 copies of 1-4 statemen | unchanged | 3/3 | borderline | `lib/pipeline-loops.js` (owns `getLoopsForWorkspace`) | — | reused (10-18 G0086) |
| 96 | G0096 | set {'assistant', 'user'} as or-chain/if-chain [ID.role] | unchanged | 4/6 | borderline | lib/chat-transcript.js filterChatTurns (bypassed ×3) — role filter; `filterChatTurns` is bypassed three times (LIN-2430 residue) | LIN-2430 residue | reused (10-18 G0095) |
| 104 | G0104 | set {'0', '1', '2', '3', '4'} as table-keys [PRIORITY_LABELS,  | unchanged | 4/7 | real | `lib/render.js` `PRIORITY_OPTION_LABELS`; the wire's priority label should use it | priority-label-maps | reused (10-18 G0102) |
| 110 | G0110 | set {'merged', 'partial'} as or-chain/Set [ID.closeOut.status, | unchanged | 3/4 | real | `lib/run-closeout-state.js` (owns `PARTIAL`/`MERGED`); export an `isMerged` predicate | close-out-merged-refusal-split | reused (10-18 G0129) |
| 122 | G0122 | tiny stripCodeFence() (also: trimToNull, parseRecommendedActio | unchanged | 4/4 | noise | small parse helpers, coincidental similarity | — | reused (10-18 G0117) |
| 130 | G0130 | tiny escapeHtml() (also: escapeXml), 3 copies of 1-4 statement | unchanged | 3/3 | noise | escape helpers per output format | — | reused (10-18 G0123) |
| 132 | G0132 | kind == 'bootstrap' | unchanged | 3/3 | noise | bootstrap kind literal, one meaning | — | reused (10-18 G0135) |
| 150 | G0150 | tiny constructor(), 5 copies of 1-4 statements | unchanged | 3/5 | noise | store constructors — reused from 10-18 G0149 (lead matched G0359, a groupKey twin) | — | reused (re-matched) |
| 151 | G0151 | set {'standard', 'stepper'} as array/ternary-chain [AUTOPILOT_ | unchanged | 3/3 | borderline | `lib/prompts/autopilot-kickoff.js` `AUTOPILOT_VARIANTS` — `AUTOPILOT_VARIANTS` already exists; callers should import it | dispatch-entrance-field-duplication (variant) | reused (10-18 G0150) |
| 152 | G0152 | set {'blocked', 'queued', 'resolved', 'silent', 'terminal', 'u | unchanged | 3/3 | real (copying is a house rule) | `lib/observer-sweep.js` (producer) | observer-instance-key-copies; LIN-2481 (Backlog) | reused (10-18 G0156) |
| 156 | G0156 | phase == 'result' | unchanged | 3/3 | noise | phase literal in one module | — | reused (10-18 G0155) |
| 161 | G0161 | const SWEEP_INSTANCE_PREFIX="sweep:v1:" | unchanged | 3/3 | real | `lib/observer-sweep.js` (the writer; uses an inline literal at :449) | observer-instance-key-copies; LIN-2481 | reused (10-18 G0166) |
| 167 | G0167 | const COMPANION_INSTANCE_PREFIX="companion:v1:" | unchanged | 3/3 | real | `lib/agent-turn.js` (writer) over `lib/flight-companion-*` (reader) | observer-instance-key-copies; LIN-2481 | reused (10-18 G0168) |
| 177 | G0177 | clone buildMockRecapContext() (also: buildMockRecapContextFrom | unchanged | 3/3 | real | `lib/workspace-api-mocks.js` `buildMockRecapContext` | mock-ai-builder-copies | reused (10-18 G0199) |
| 180 | G0180 | tiny (anonymous)(), 3 copies of 1-4 statements | unchanged | 3/3 | real | as G0177 — `lib/workspace-api-mocks.js` (reused from 10-18 G0202; file overlap 3/3, 3 sites both runs) | mock-ai-builder-copies | reused (re-matched) |
| 184 | G0184 | tiny normalizePrivateKey() (also: cleanClaim, stripCodeBlockFe | unchanged | 3/3 | noise | string cleanup helpers, coincidental | — | reused (10-18 G0195) |
| 185 | G0185 | kind == 'implementation' | unchanged | 3/4 | real (small) | `lib/file-pointer.js` `isPilotEligible` | pilot-eligibility-copies; LIN-3200 (Done) residue | reused (10-18 G0179) |
| 187 | G0187 | status == 'done' | unchanged | 3/3 | noise | done status literal; unrelated meanings | — | reused (10-18 G0194) |
| 207 | G0207 | status == 'no-owner' | grown 3→4 | 3/4 | borderline | same decision as G0208: switch over `readOwnerStatus()`'s enum. Crossed table→mustRule (10-18 G0263, 2 areas) because LIN-3648's home `workspace-owner.js:101` added a site in a 3rd area | owner-answer-reader-copies (LIN-3648) | re-ruled (grown 3→4) |
| 208 | G0208 | status == 'owner' | shrunk 6→4 | 3/4 | borderline | was real (10-18 G0172). LIN-3648/3654/3655: every reader goes through `readOwnerStatus`/`isOwnerAnswer` (`workspace-owner.js:98-113`); the `isOwner` twins now call it. Residue: status→refusal-code mapping written twice (`owner-mint-refusals.js:128-131` vs `proxy-tokens.js:400-412`), parity-tested, both fail closed; `runner-setup.js:75-79` maps to page states (different output) | owner-answer-reader-copies (LIN-3648 Done) | re-ruled (shrunk 6→4, files changed) |
| 214 | G0214 | state == 'waiting' | grown 3→4 | 3/3 | borderline | `lib/task-page-loader.js` `UNENDED_STATES` (10-18 G0231). +1 site `task-page-loader.js:178` is an in-function sibling (stale `[pending]`, LIN-3513); `public/proxy.js:437` is a different `state` (token exchange) — name collision | adjacent to human-wait-derivation-split | re-ruled (grown 3→4) |
| 228 | G0228 | set {'backlog', 'canceled', 'completed', 'duplicate', 'started | unchanged | 3/5 | real | `lib/providers/state-map.js` `getStateDisplay`/`getStateOrder` | state-type-label-rank-maps; LIN-3612 adj. | reused (10-18 G0228) |
| 230 | G0230 | kind == 'evidence' | unchanged | 3/3 | noise | feedback kind literal | — | reused (10-18 G0223) |
| 250 | G0250 | const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4 | unchanged | 3/3 | noise | (`lib/workspace.js` `UUID_REGEX` exists) | — | reused (10-18 G0257) |
| 252 | G0252 | status == 'not-owner' | grown 2→3 | 3/3 | borderline | same decision as G0208. Crossed table→mustRule (10-18 G0308, 2 areas/2 files) via the home `workspace-owner.js:101` (3rd area) | owner-answer-reader-copies (LIN-3648) | re-ruled (grown 2→3) |
| 261 | G0261 | set {'backlog', 'started', 'unstarted'} as switch/array/table- | unchanged | 3/4 | borderline | `lib/providers/state-map.js` (`isTerminalState`, `getStateOrder`) — state rank sets; covered by state-type-label-rank-maps | LIN-3612 | reused (10-18 G0273) |
| 262 | G0262 | set {'backlog', 'unstarted'} as array/or-chain [stateTypes, ID | unchanged | 4/4 | borderline | lib/providers/state-map.js (isReadyState) — ready = backlog or unstarted; covered by state-type-label-rank-maps | LIN-3612 | reused (10-18 G0279) |
| 274 | G0274 | clone get(), ~7 statements, fuzzy | unchanged | 3/6 | borderline | as G0091 (10-18 G0082) — store `get` | — | reused (10-18 G0261) |
| 286 | G0286 | clone find() (also: componentFind), ~9 statements, fuzzy | unchanged | 3/4 | noise | union-find helper, generic | — | reused (10-18 G0283) |
| 303 | G0303 | clone _pruneToCapacity(), ~6 statements, fuzzy | unchanged | 3/5 | borderline | as G0091 (10-18 G0082) — `_pruneToCapacity` per cache | — | reused (10-18 G0289) |
| 327 | G0327 | const MS_PER_DAY=86400000 | unchanged | 3/3 | noise | `MS_PER_DAY` constant, inert | — | reused (10-18 G0312) |
| 337 | G0337 | tiny clampText(), 3 copies of 1-4 statements | unchanged | 3/3 | noise | `clampText` copies differ in limit | — | reused (10-18 G0323) |
| 366 | G0366 | tiny constructor(), 5 copies of 1-4 statements | unchanged | 3/5 | noise | cache constructors | — | reused (10-18 G0359) |
| 368 | G0368 | set {'Deep Dive', 'Front Page', 'The Column', 'The Wire', 'Wea | unchanged | 4/4 | real (cheap) | `lib/ship-biscuit.js` `DESKS` (exported) | ship-biscuit-desk-list | reused (10-18 G0361) |
| 377 | G0377 | tiny cleanup(), 3 copies of 1-4 statements | unchanged | 3/3 | noise | `cleanup()` per store | — | reused (10-18 G0369) |
| 394 | G0394 | tiny stableById() (also: byWorkspaceId), 3 copies of 1-4 state | unchanged | 3/3 | noise | sort comparators | — | reused (10-18 G0389) |
| 411 | G0411 | set {'E', 'N', 'NE', 'NW', 'S', 'SE', +2} as array/table-keys  | unchanged | 3/3 | noise | (`lib/ship-layout.js` `BEARINGS` exists) | — | reused (10-18 G0414) |

## Census table groups (262, no ruling)

By detector: cmp 94, clone 83, const 23, contract 15, discrim 15, set 15, record 11, set+discrim 6 (10-18: cmp 96, clone 83, const 23, contract 14, discrim 15, set 14, record 11, set+discrim 5). By status: unchanged 250, new 8, grown 4 (10-18: unchanged 234, new 11, shrunk 10, grown 6). No ruling is given and no prose is written for these; the changed rows are listed first, then the full table regenerated with the same command.

| status | groups |
|---|---|
| **new** | G0063 `[ci-wake-sweep]` (a log tag) · G0071 `{github, github-projects}` (re-key of REMINT_KINDS, plus the new `INSTALLATION_KEYED_PROVIDERS`) · G0072 terminal set (4 browser copies plus `models.js`) · G0183 `restoreButton` (moved by LIN-3499) · G0220 `target=='web'` (question-cards move, plus `ci-wake-sweep.js:309`) · G0363 `{jira, linear}` (LIN-3285; same members, different decision) · G0369 graphql clone (re-key) · G0473 ship-biscuit render/client clone (no code change; tool regrouping, same as 10-18 G0466) |
| **grown** | G0066 `marker=='pending'` (LIN-3513, LIN-3661; see the pause-marker row) · G0073 `status=='merged'` (LIN-3379) · G0178 `state=='running'` (LIN-3513) · G0336 route-handler clone in next-run, passage-planner and ship-biscuit (LIN-3658 converged two handlers onto `freeTierRefusalBlock`; not drift) |

| rank | id | detector | decision | status | areas / files |
|---|---|---|---|---|---|
| 26 | G0026 | cmp | repeated comparison key == 'Enter' | unchanged | 1 / 7 |
| 29 | G0029 | contract | text contract heading: what ci did not prove | unchanged | 2 / 6 |
| 32 | G0032 | cmp | repeated comparison key == 'Escape' | unchanged | 1 / 5 |
| 35 | G0035 | set+discrim | string set {'decision-answer', 'decision-withdrawal-reversed', 'decision-withdrawn'} as or-chain/Set [ID.kind, DECISION_STAMP_KINDS, DECISION_LIFECYCLE_STAMP_KINDS] | unchanged | 2 / 6 |
| 37 | G0037 | cmp | repeated comparison status == 'fulfilled' | unchanged | 2 / 3 |
| 39 | G0039 | discrim | string set {'answered', 'dismissed'} as or-chain [ID.outcome] | unchanged | 2 / 3 |
| 40 | G0040 | clone | tiny rule copied as a helper clear(), 5 copies of 1-4 statements | unchanged | 2 / 5 |
| 41 | G0041 | cmp | repeated comparison target == 'local' | unchanged | 2 / 4 |
| 42 | G0042 | record | record assembled from the same sources {id=ID.id, title=ID.title, labels=LogicalExpression.map()} | unchanged | 2 / 3 |
| 43 | G0043 | cmp | repeated comparison getAttribute() == 'true' | unchanged | 1 / 5 |
| 44 | G0044 | cmp | repeated comparison disposition == 'resumable' | unchanged | 2 / 4 |
| 47 | G0047 | cmp | repeated comparison provider == 'github' | unchanged | 2 / 2 |
| 48 | G0048 | cmp | repeated comparison provider == 'github-projects' | unchanged | 2 / 2 |
| 49 | G0049 | set | string set {'LINEAR_CLIENT_ID', 'LINEAR_CLIENT_SECRET', 'LINEAR_REDIRECT_URI'} as array [OAUTH_ENV_VARS, oauthEnvVars] | unchanged | 2 / 2 |
| 50 | G0050 | const | named constant TOKEN_REFRESH_BUFFER_MS=300000 | unchanged | 2 / 2 |
| 51 | G0051 | cmp | repeated comparison rawTeam == 'all' | unchanged | 2 / 2 |
| 52 | G0052 | record | literal record repeated verbatim {effort=null, harness=null, model=null} | unchanged | 2 / 2 |
| 53 | G0053 | cmp | repeated comparison enabled == 'true' | unchanged | 2 / 2 |
| 54 | G0054 | contract | text contract marker: [observer-pass] | unchanged | 2 / 2 |
| 57 | G0057 | contract | text contract marker: [liveness-alarm-sweep] | unchanged | 2 / 2 |
| 58 | G0058 | const | named constant CONTEXT_FETCH_TIMEOUT_MS=45000 | unchanged | 2 / 2 |
| 60 | G0060 | cmp | repeated comparison kind == 'capture' | unchanged | 2 / 2 |
| 61 | G0061 | cmp | repeated comparison urlKey == 'test-workspace' | unchanged | 2 / 2 |
| 62 | G0062 | discrim | string set {'github', 'github-projects', 'jira', 'linear'} as switch/or-chain [ID.provider] | unchanged | 2 / 2 |
| 63 | G0063 | contract | text contract marker: [ci-wake-sweep] | new | 2 / 2 |
| 66 | G0066 | cmp | repeated comparison marker == 'pending' | grown | 1 / 4 |
| 68 | G0068 | clone | near-duplicate function clear() (also: clearHistory), ~7 statements, fuzzy | unchanged | 1 / 4 |
| 69 | G0069 | cmp | repeated comparison source == 'free' | unchanged | 2 / 3 |
| 71 | G0071 | set+discrim | string set {'github', 'github-projects'} as Set/array/or-chain [REMINT_KINDS, INSTALLATION_KEYED_PROVIDERS, ID.provider] | new | 1 / 5 |
| 72 | G0072 | set | string set {'canceled', 'completed', 'duplicate'} as array [TERMINAL_TYPES, RECORD_TARGET_TERMINAL_TYPES, TERMINAL_STATES] | new | 2 / 5 |
| 73 | G0073 | cmp | repeated comparison status == 'merged' | grown | 2 / 3 |
| 74 | G0074 | cmp | repeated comparison state == 'record' | unchanged | 2 / 3 |
| 75 | G0075 | contract | text contract marker: [dispatch] | unchanged | 2 / 3 |
| 76 | G0076 | cmp | repeated comparison mode == 'add-source' | unchanged | 2 / 6 |
| 77 | G0077 | cmp | repeated comparison status == 'queued' | unchanged | 2 / 4 |
| 78 | G0078 | cmp | repeated comparison agentState == 'queued' | unchanged | 2 / 3 |
| 84 | G0084 | const | named constant DANGEROUS_CHARS_REGEX=/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/ | unchanged | 2 / 4 |
| 85 | G0085 | const | named constant MAX_NAME_LENGTH=1000 | unchanged | 2 / 4 |
| 86 | G0086 | discrim | string set {'cancelled', 'expired'} as or-chain [ID.historyStatus, ID.status] | unchanged | 1 / 3 |
| 87 | G0087 | cmp | repeated comparison kind == 'decision' | unchanged | 1 / 4 |
| 94 | G0094 | clone | near-duplicate function (anonymous)() (also: relayDispatchRefusal), ~10 statements, same vocabulary (dialect copy or close variant) | unchanged | 2 / 2 |
| 97 | G0097 | clone | tiny rule copied as a helper onEvent() (also: (anonymous)), 5 copies of 1-4 statements | unchanged | 2 / 4 |
| 98 | G0098 | clone | near-duplicate function countTokens() (also: countItems), ~7 statements, fuzzy | unchanged | 2 / 3 |
| 101 | G0101 | cmp | repeated comparison harness == 'claude-code' | unchanged | 2 / 3 |
| 102 | G0102 | set | string set {'cdn.linear.app', 'linear.app', 'uploads.linear.app'} as Set [LINEAR_IMAGE_HOSTS, allowedHosts] | unchanged | 2 / 2 |
| 103 | G0103 | cmp | repeated comparison toLowerCase() == 'bug' | unchanged | 2 / 3 |
| 105 | G0105 | cmp | repeated comparison finishReason == 'length' | unchanged | 2 / 5 |
| 106 | G0106 | clone | tiny rule copied as a helper ui(), 5 copies of 1-4 statements | unchanged | 1 / 5 |
| 107 | G0107 | set+discrim | string set {'done', 'failed'} as or-chain/table-keys [ID.terminalStatus, PILL_GLYPHS] | unchanged | 2 / 3 |
| 108 | G0108 | cmp | repeated comparison by == 'close-out' | unchanged | 2 / 2 |
| 109 | G0109 | contract | text contract marker: [skipped] | unchanged | 2 / 3 |
| 111 | G0111 | cmp | repeated comparison name == 'list_pending_decisions' | unchanged | 2 / 3 |
| 112 | G0112 | cmp | repeated comparison name == 'linear' | unchanged | 2 / 2 |
| 113 | G0113 | const | named constant ARCHIVE_PAGE_SIZE=30 | unchanged | 2 / 2 |
| 114 | G0114 | const | named constant STALE_AFTER_MS=86400000 | unchanged | 2 / 2 |
| 115 | G0115 | cmp | repeated comparison disposition == 'task-bound' | unchanged | 2 / 2 |
| 116 | G0116 | cmp | repeated comparison status == 'error' | unchanged | 2 / 2 |
| 117 | G0117 | cmp | repeated comparison view == 'sessions' | unchanged | 2 / 2 |
| 118 | G0118 | cmp | repeated comparison code == 'ERR_FR_TOO_MANY_REDIRECTS' | unchanged | 2 / 2 |
| 119 | G0119 | cmp | repeated comparison message == 'reverseOutcome: row is not self-resolved' | unchanged | 2 / 2 |
| 120 | G0120 | clone | tiny rule copied as a helper buildPromptFilename(), 3 copies of 1-4 statements | unchanged | 2 / 3 |
| 121 | G0121 | cmp | repeated comparison format == 'md' | unchanged | 2 / 2 |
| 123 | G0123 | contract | text contract marker: [credential-adopted] | unchanged | 2 / 2 |
| 124 | G0124 | cmp | repeated comparison kind == 'recap' | unchanged | 2 / 2 |
| 125 | G0125 | clone | tiny rule copied as a helper (anonymous)(), 5 copies of 1-4 statements | unchanged | 2 / 4 |
| 126 | G0126 | record | record assembled from the same sources {urlKey=ID.urlKey, prUrl=ID.prUrl, headSha=ID.headSha, by=ID.by} | unchanged | 2 / 2 |
| 127 | G0127 | cmp | repeated comparison action == 'save' | unchanged | 2 / 2 |
| 128 | G0128 | set | string set {'autopilot', 'save', 'triage'} as table-keys/Set [SENDING_STATUS, DONE_SUFFIX, FEEDBACK_ACTIONS] | unchanged | 2 / 2 |
| 129 | G0129 | cmp | repeated comparison code == 'RUN_LIMIT_UNVERIFIED' | unchanged | 2 / 2 |
| 131 | G0131 | contract | text contract heading: workflow | unchanged | 1 / 3 |
| 133 | G0133 | cmp | repeated comparison agentState == 'waiting' | unchanged | 2 / 2 |
| 134 | G0134 | discrim | string set {'1', 'true'} as or-chain [ID.query.cachedOnly, ID.query.noDescend, ID.query.diff] | unchanged | 2 / 2 |
| 135 | G0135 | clone | near-duplicate function peakToolCount() (also: toolPeakOf), ~9 statements, fuzzy | unchanged | 2 / 2 |
| 136 | G0136 | cmp | repeated comparison kind == 'assistant-text' | unchanged | 2 / 2 |
| 137 | G0137 | set | string set {'backlog', 'done', 'failed', 'in-progress', 'todo'} as table-keys [STATE_GLYPHS, STATUS_PILL_GLYPHS] | unchanged | 2 / 3 |
| 138 | G0138 | const | named constant POLL_MS=5000 | unchanged | 1 / 3 |
| 142 | G0142 | const | named constant DEFAULT_HARNESS="claude-code" | unchanged | 2 / 2 |
| 143 | G0143 | const | named constant DISPATCH_CLAUDE_MODEL_SUGGESTIONS=[fable,haiku,opus,sonnet] | unchanged | 2 / 2 |
| 144 | G0144 | const | named constant DISPATCH_HARNESS_SUGGESTIONS=[claude-code,opencode] | unchanged | 2 / 2 |
| 145 | G0145 | const | named constant DISPATCH_MODEL_OTHER_VALUE="__other__" | unchanged | 2 / 2 |
| 146 | G0146 | const | named constant DISPATCH_MODEL_SUGGESTIONS=[anthropic/claude-fable-5,anthropic/claude-haiku-4.5,anthropic/claude-opus-4.8,a... | unchanged | 2 / 2 |
| 147 | G0147 | set | string set {'anthropic/claude-fable-5', 'anthropic/claude-haiku-4.5', 'anthropic/claude-opus-4.8', 'anthropic/claude-opus-5', 'anthropic/claude-sonnet-4.6', 'anthropic/claude-sonnet-5', +4} as array [DISPATCH_MODEL_SUGGESTIONS] | unchanged | 2 / 2 |
| 148 | G0148 | set | string set {'claude-code', 'opencode'} as array [DISPATCH_HARNESS_SUGGESTIONS] | unchanged | 2 / 2 |
| 149 | G0149 | clone | near-duplicate function readRunFacts() (also: readTaskRunFacts), ~30 statements, same vocabulary (dialect copy or close variant) | unchanged | 2 / 2 |
| 153 | G0153 | cmp | repeated comparison protocol == 'https:' | unchanged | 2 / 2 |
| 154 | G0154 | cmp | repeated comparison phase == 'error' | unchanged | 2 / 3 |
| 155 | G0155 | cmp | repeated comparison phase == 'proposed' | unchanged | 2 / 3 |
| 157 | G0157 | cmp | repeated comparison state == 'open' | unchanged | 2 / 5 |
| 158 | G0158 | clone | tiny rule copied as a helper constructor(), 6 copies of 1-4 statements | unchanged | 2 / 6 |
| 159 | G0159 | cmp | repeated comparison source == 'live' | unchanged | 1 / 3 |
| 162 | G0162 | cmp | repeated comparison section == 'prompt' | unchanged | 2 / 2 |
| 163 | G0163 | cmp | repeated comparison section == 'reasoning' | unchanged | 2 / 2 |
| 164 | G0164 | contract | text contract marker: [working] | unchanged | 2 / 3 |
| 166 | G0166 | cmp | repeated comparison state == 'closed' | unchanged | 2 / 5 |
| 168 | G0168 | clone | tiny rule copied as a helper header() (also: setupNoticeHtml), 3 copies of 1-4 statements | unchanged | 1 / 3 |
| 169 | G0169 | cmp | repeated comparison section == 'recent-activity' | unchanged | 2 / 3 |
| 170 | G0170 | cmp | repeated comparison turnKind == 'boot' | unchanged | 2 / 3 |
| 171 | G0171 | cmp | repeated comparison state == 'done' | unchanged | 2 / 3 |
| 173 | G0173 | contract | text contract marker: [aborted] | unchanged | 2 / 2 |
| 174 | G0174 | cmp | repeated comparison disposition == 'gone' | unchanged | 2 / 2 |
| 176 | G0176 | cmp | repeated comparison value == 'true' | unchanged | 2 / 2 |
| 178 | G0178 | cmp | repeated comparison state == 'running' | grown | 2 / 3 |
| 179 | G0179 | discrim | string set {'closed', 'multiple-prs', 'no-pr', 'not-ready'} as or-chain [ID.status] | unchanged | 2 / 3 |
| 181 | G0181 | clone | tiny rule copied as a helper (anonymous)(), 3 copies of 1-4 statements | unchanged | 1 / 3 |
| 182 | G0182 | clone | near-duplicate function relativeTime() (also: renderDeployInfo), ~22 statements, same vocabulary (dialect copy or close variant) | unchanged | 2 / 2 |
| 183 | G0183 | clone | tiny rule copied as a helper (anonymous)() (also: restoreButton), 6 copies of 1-4 statements | new | 1 / 3 |
| 186 | G0186 | clone | near-duplicate function computeFitZoom(), ~11 statements, same vocabulary (dialect copy or close variant) | unchanged | 2 / 2 |
| 190 | G0190 | cmp | repeated comparison kind == 'custom' | unchanged | 2 / 2 |
| 191 | G0191 | cmp | repeated comparison scope == 'readWrite' | unchanged | 2 / 2 |
| 192 | G0192 | clone | near-duplicate function clampTimelineWindow() (also: clampWindow), ~12 statements, fuzzy | unchanged | 2 / 2 |
| 193 | G0193 | clone | near-duplicate function computeTimelineFit(), ~10 statements, same vocabulary (dialect copy or close variant) | unchanged | 2 / 2 |
| 194 | G0194 | clone | near-duplicate function computeTimelineZoom(), ~15 statements, same vocabulary (dialect copy or close variant) | unchanged | 2 / 2 |
| 195 | G0195 | clone | near-duplicate function firstPromptLine() (also: toStackHeadline), ~6 statements, fuzzy | unchanged | 2 / 2 |
| 196 | G0196 | clone | near-duplicate function renderChip(), ~8 statements, fuzzy | unchanged | 2 / 2 |
| 197 | G0197 | clone | near-duplicate function renderStatusPill(), ~17 statements, fuzzy | unchanged | 2 / 2 |
| 198 | G0198 | clone | near-duplicate function renderSurface(), ~11 statements, fuzzy | unchanged | 2 / 2 |
| 199 | G0199 | clone | near-duplicate function renderTag(), ~11 statements, fuzzy | unchanged | 2 / 2 |
| 200 | G0200 | set | string set {'autopilot', 'blocked', 'breakdown', 'bug', 'close-out', 'context', +15} as table-keys [STAGE_LEADS, BUCKET_OF_KIND] | unchanged | 2 / 2 |
| 202 | G0202 | contract | text contract marker: [done] | unchanged | 2 / 2 |
| 204 | G0204 | clone | tiny rule copied as a helper buildBriefMessages() (also: buildNextRunMessages, buildRoadmapGapMessages, buildRoadmapProductMessages, buildEditorMessages), 9 copies of 1-4 statements | unchanged | 2 / 9 |
| 205 | G0205 | cmp | repeated comparison readyState == 'loading' | unchanged | 1 / 3 |
| 209 | G0209 | const | named constant MAX_IDENTIFIER_LENGTH=100 | unchanged | 2 / 2 |
| 210 | G0210 | clone | near-duplicate function groupLoopsByLineage() (also: runsByLineage), ~10 statements, structurally identical | unchanged | 2 / 2 |
| 211 | G0211 | const | named constant MONTHS=[Apr,Aug,Dec,Feb,Jan,Jul,Jun,Mar,May,Nov,Oct,Sep] | unchanged | 2 / 2 |
| 212 | G0212 | clone | tiny rule copied as a helper (anonymous)(), 4 copies of 1-4 statements | unchanged | 1 / 3 |
| 218 | G0218 | set+discrim | string set {'http:', 'https:'} as array/or-chain [[...].includes, ID.protocol] | unchanged | 2 / 4 |
| 219 | G0219 | clone | near-duplicate function constructor(), ~5 statements, fuzzy | unchanged | 1 / 3 |
| 220 | G0220 | cmp | repeated comparison target == 'web' | new | 2 / 3 |
| 221 | G0221 | record | literal record repeated verbatim {lastCensusSnapshot=null, lastCensusStateHash=null, lastTurnAt=null, notes="", reservationId=null, turnReservedUntil=n...} | unchanged | 2 / 2 |
| 222 | G0222 | clone | near-duplicate function (anonymous)(), ~6 statements, fuzzy | unchanged | 2 / 2 |
| 225 | G0225 | cmp | repeated comparison singleUse == 'true' | unchanged | 2 / 2 |
| 227 | G0227 | cmp | repeated comparison reason == 'free-tier' | unchanged | 2 / 2 |
| 229 | G0229 | const | named constant HOUR_MS=3600000 | unchanged | 2 / 3 |
| 231 | G0231 | cmp | repeated comparison state == 'unknown' | unchanged | 2 / 3 |
| 232 | G0232 | cmp | repeated comparison status == 'skipped' | unchanged | 2 / 3 |
| 233 | G0233 | clone | tiny rule copied as a helper asShare() (also: asRate), 3 copies of 1-4 statements | unchanged | 2 / 3 |
| 236 | G0236 | cmp | repeated comparison turnKind == 'auto-wake' | unchanged | 2 / 2 |
| 239 | G0239 | cmp | repeated comparison status == 'priced' | unchanged | 2 / 2 |
| 240 | G0240 | record | record assembled from the same sources {promptMeta=ID.promptMeta, defaultPromptKeys=ID.defaultPromptKeys, morePromptKeys=ID.morePromptKeys, customPrompts=ID.customPrompts, hasAI=ID.hasAI, +7} | unchanged | 2 / 2 |
| 245 | G0245 | clone | near-duplicate function cleanup(), ~8 statements, fuzzy | unchanged | 1 / 3 |
| 246 | G0246 | clone | near-duplicate function listForWorkspaces() (also: listUnansweredForWorkspaces), ~7 statements, fuzzy | unchanged | 1 / 3 |
| 247 | G0247 | contract | text contract marker: [usage] | unchanged | 1 / 3 |
| 249 | G0249 | cmp | repeated comparison tier == 'not reported' | unchanged | 2 / 2 |
| 251 | G0251 | cmp | repeated comparison mode == 'new' | unchanged | 1 / 3 |
| 253 | G0253 | discrim | string set {'gone', 'resumable', 'task-bound'} as or-chain | unchanged | 2 / 2 |
| 255 | G0255 | clone | near-duplicate function deleteByConnection() (also: deleteUserPreferences, deleteWorkspacePreferences), ~8 statements, structurally identical | unchanged | 1 / 3 |
| 271 | G0271 | clone | near-duplicate function listCalls() (also: listTraces, listEvents), ~9 statements, fuzzy | unchanged | 2 / 3 |
| 272 | G0272 | set | string set {'dispatch', 'record', 'resume'} as Set/table-keys [ON_ANSWER_EFFECTS, EFFECT_CAPTIONS] | unchanged | 2 / 2 |
| 275 | G0275 | clone | tiny rule copied as a helper isId() (also: shortString, (anonymous), isSafeSingleQuotedLiteral, isSafeDoubleQuotedLiteral), 6 copies of 1-4 statements | unchanged | 2 / 4 |
| 276 | G0276 | clone | tiny rule copied as a helper resolveCanonicalDegraded() (also: resolveCanonicalOrMiss, canonical), 3 copies of 1-4 statements | unchanged | 2 / 3 |
| 277 | G0277 | cmp | repeated comparison mode == 'stop' | unchanged | 2 / 2 |
| 281 | G0281 | cmp | repeated comparison stateType == 'backlog' | unchanged | 2 / 3 |
| 283 | G0283 | set | string set {'brief', 'flight-companion', 'next-run', 'recap', 'recommend', 'run-summary', +4} as table-keys/array [AI_OPERATION_LABELS, AI_OPERATION_KINDS] | unchanged | 2 / 2 |
| 285 | G0285 | record | record assembled from the same sources {prompt=ID.prompt, model=ID.model, harness=ID.harness} | unchanged | 2 / 2 |
| 291 | G0291 | cmp | repeated comparison mergedBy == 'close-out' | unchanged | 2 / 2 |
| 292 | G0292 | cmp | repeated comparison state == 'queued' | unchanged | 2 / 2 |
| 294 | G0294 | set+discrim | string set {'queued', 'running', 'waiting'} as or-chain/Set [ID.state, UNENDED_STATES] | unchanged | 2 / 2 |
| 295 | G0295 | cmp | repeated comparison role == 'user' | unchanged | 2 / 3 |
| 297 | G0297 | cmp | repeated comparison kind == 'close-out' | unchanged | 2 / 2 |
| 298 | G0298 | discrim | string set {'indeterminate', 'mid-turn'} as or-chain [ID.disposition] | unchanged | 2 / 2 |
| 300 | G0300 | cmp | repeated comparison name == 'send_follow_up' | unchanged | 2 / 2 |
| 305 | G0305 | const | named constant TIMELINE_WINDOW_MS=86400000 | unchanged | 2 / 2 |
| 307 | G0307 | record | record assembled from the same sources {urlKey=ID.proxyUrlKey, createdBy=ID.proxyCreatedBy, clientSignal=ID.signal} | unchanged | 2 / 2 |
| 308 | G0308 | cmp | repeated comparison kind == 'periodical' | unchanged | 2 / 2 |
| 315 | G0315 | cmp | repeated comparison s == 'complete' | unchanged | 2 / 2 |
| 316 | G0316 | discrim | string set {'comment', 'description'} as ternary-chain/or-chain [ID.where] | unchanged | 2 / 2 |
| 317 | G0317 | set | string set {'/app.js', '/common.js'} as array [scripts] | unchanged | 1 / 3 |
| 318 | G0318 | const | named constant LANE_KEYS=[blocked,queued,resolved,silent,terminal,unknown,working] | unchanged | 2 / 2 |
| 322 | G0322 | cmp | repeated comparison variant == 'standard' | unchanged | 2 / 2 |
| 326 | G0326 | contract | text contract marker: [string] | unchanged | 2 / 4 |
| 328 | G0328 | cmp | repeated comparison busy == 'true' | unchanged | 1 / 3 |
| 331 | G0331 | cmp | repeated comparison stateType == 'unstarted' | unchanged | 2 / 2 |
| 334 | G0334 | set | string set {'inside', 'outside', 'total', 'unknown'} as array/table-keys [[...].every, SCOPE_MARK] | unchanged | 2 / 2 |
| 335 | G0335 | cmp | repeated comparison kind == 'decision-withdrawn' | unchanged | 2 / 2 |
| 336 | G0336 | clone | near-duplicate function (anonymous)(), ~12 statements, fuzzy | grown | 1 / 3 |
| 339 | G0339 | cmp | repeated comparison harness == 'opencode' | unchanged | 2 / 2 |
| 341 | G0341 | cmp | repeated comparison view == 'digest' | unchanged | 2 / 2 |
| 344 | G0344 | clone | near-duplicate function briefUrl() (also: recapUrl, scanUrl), ~6 statements, fuzzy | unchanged | 1 / 3 |
| 345 | G0345 | discrim | string set {'fresh', 'stale'} as if-chain [ID.status] | unchanged | 1 / 3 |
| 349 | G0349 | record | record assembled from the same sources {urlKey=ID.urlKey, workspaceId=ID.id, ownerAccountId=ID.session.accountId} | unchanged | 2 / 2 |
| 352 | G0352 | set | string set {'connected', 'firstGo', 'login', 'prOpened'} as array/table-keys [stepLabels, stepKeys] | unchanged | 2 / 2 |
| 353 | G0353 | contract | text contract heading: adversarial second-read | unchanged | 2 / 2 |
| 354 | G0354 | cmp | repeated comparison trim() == '---' | unchanged | 1 / 4 |
| 360 | G0360 | clone | tiny rule copied as a helper getAccount() (also: getById, getWorkspace, getWorkspaceByUrlKey), 4 copies of 1-4 statements | unchanged | 2 / 3 |
| 361 | G0361 | cmp | repeated comparison type == 'heading' | unchanged | 2 / 2 |
| 363 | G0363 | set+discrim | string set {'jira', 'linear'} as Set/or-chain [REFRESH_TOKEN_KINDS] | new | 2 / 2 |
| 364 | G0364 | contract | text contract heading: workspace api access (auto-appended) | unchanged | 2 / 2 |
| 365 | G0365 | clone | near-duplicate function delete(), ~7 statements, fuzzy | unchanged | 2 / 5 |
| 367 | G0367 | clone | near-duplicate function list() (also: listByWorkspace), ~9 statements, fuzzy | unchanged | 2 / 4 |
| 369 | G0369 | clone | near-duplicate function (anonymous)() (also: graphql, request), ~15 statements, same vocabulary (dialect copy or close variant) | new | 1 / 3 |
| 373 | G0373 | const | named constant DEFAULT_HUMAN_NICK="John" | unchanged | 2 / 2 |
| 374 | G0374 | clone | near-duplicate function formatFossilThreshold() (also: formatStaleThreshold), ~10 statements, structurally identical | unchanged | 2 / 2 |
| 378 | G0378 | clone | near-duplicate function buildPassagePlannerKickoff() (also: buildPassageRunnerKickoff, buildWorkerLaneKickoff), ~11 statements, structurally identical | unchanged | 1 / 3 |
| 379 | G0379 | clone | tiny rule copied as a helper _docsSorted() (also: _docsFor), 3 copies of 1-4 statements | unchanged | 2 / 3 |
| 380 | G0380 | clone | tiny rule copied as a helper fetchBriefStatus() (also: fetchContext, fetchRecapStatus), 3 copies of 1-4 statements | unchanged | 1 / 3 |
| 382 | G0382 | clone | near-duplicate function orderByDependency(), ~59 statements, same vocabulary (dialect copy or close variant) | unchanged | 2 / 4 |
| 383 | G0383 | clone | tiny rule copied as a helper union(), 4 copies of 1-4 statements | unchanged | 2 / 4 |
| 385 | G0385 | clone | near-duplicate function revokeByCreator() (also: revokeByOwner), ~9 statements, fuzzy | unchanged | 2 / 2 |
| 390 | G0390 | cmp | repeated comparison verdict == 'credential_dead' | unchanged | 2 / 2 |
| 391 | G0391 | discrim | string set {'/kpis', '/logout', '/privacy', '/styleguide', '/templates', '/terms'} as or-chain [ID.path] | unchanged | 2 / 2 |
| 392 | G0392 | clone | tiny rule copied as a helper get(), 5 copies of 1-4 statements | unchanged | 2 / 5 |
| 393 | G0393 | clone | tiny rule copied as a helper (anonymous)() (also: isActive), 3 copies of 1-4 statements | unchanged | 2 / 3 |
| 397 | G0397 | clone | tiny rule copied as a helper buildRoadmapDigestPrompt() (also: buildRoadmapGapPrompt, buildRoadmapNarrativePrompt, buildRoadmapNorthStarPrompt, buildRoadmapProductPrompt), 6 copies of 1-4 statements | unchanged | 1 / 6 |
| 398 | G0398 | clone | near-duplicate function clusterSiblingsInLane() (also: computeShipReachableIds, pullItemAndDescendants, promoteDependencyBlockers), ~33 statements, same vocabulary (dialect copy or close variant) | unchanged | 2 / 3 |
| 400 | G0400 | record | record assembled from the same sources {access_token=ID.access_token, refresh_token=ID.refresh_token, expires_in=ID.expires_in} | unchanged | 2 / 2 |
| 402 | G0402 | cmp | repeated comparison error == 'invalid_grant' | unchanged | 2 / 2 |
| 403 | G0403 | cmp | repeated comparison kind == 'roadmap' | unchanged | 2 / 2 |
| 404 | G0404 | cmp | repeated comparison kind == 'session' | unchanged | 2 / 2 |
| 405 | G0405 | discrim | string set {'number', 'string'} as or-chain [typeofID] | unchanged | 2 / 2 |
| 406 | G0406 | const | named constant MAX_STUBS=20 | unchanged | 2 / 2 |
| 412 | G0412 | clone | near-duplicate function get(), ~9 statements, structurally identical | unchanged | 2 / 4 |
| 413 | G0413 | clone | tiny rule copied as a helper delete(), 4 copies of 1-4 statements | unchanged | 2 / 4 |
| 414 | G0414 | clone | tiny rule copied as a helper deleteAll(), 4 copies of 1-4 statements | unchanged | 2 / 4 |
| 415 | G0415 | clone | tiny rule copied as a helper put(), 4 copies of 1-4 statements | unchanged | 2 / 4 |
| 416 | G0416 | clone | tiny rule copied as a helper put(), 4 copies of 1-4 statements | unchanged | 2 / 4 |
| 418 | G0418 | const | named constant PROJECTION_RISK_TYPES=Set[overdue,unestimated-critical,velocity-declining] | unchanged | 2 / 2 |
| 419 | G0419 | const | named constant REPO_RE=/^[A-Za-z0-9._-]{1,100}$/ | unchanged | 2 / 2 |
| 420 | G0420 | set | string set {'digest', 'gap', 'northStarReading', 'product', 'technical', 'trajectory'} as array/table-keys [NARRATIVE_LAYERS, collected, NARRATIVE_FIELD_TO_LAYER] | unchanged | 2 / 2 |
| 421 | G0421 | discrim | string set {'implicit', 'label', 'state'} as switch [ID.type] | unchanged | 2 / 2 |
| 422 | G0422 | set | string set {'overdue', 'unestimated-critical', 'velocity-declining'} as Set [PROJECTION_RISK_TYPES] | unchanged | 2 / 2 |
| 423 | G0423 | clone | tiny rule copied as a helper toRecord(), 3 copies of 1-4 statements | unchanged | 2 / 3 |
| 424 | G0424 | record | literal record repeated verbatim {AFT="aft", DRIFT="drift", FORWARD="forward", PORT="port", SHIP="ship", STARBOARD="starboard"} | unchanged | 2 / 2 |
| 425 | G0425 | clone | near-duplicate function bearingToAngle(), ~8 statements, structurally identical | unchanged | 2 / 2 |
| 426 | G0426 | clone | near-duplicate function buildSegments(), ~59 statements, same vocabulary (dialect copy or close variant) | unchanged | 2 / 2 |
| 427 | G0427 | clone | near-duplicate function cardMatchesHeading(), ~13 statements, same vocabulary (dialect copy or close variant) | unchanged | 2 / 2 |
| 428 | G0428 | clone | near-duplicate function clusterSubtaskSiblings(), ~35 statements, same vocabulary (dialect copy or close variant) | unchanged | 2 / 2 |
| 429 | G0429 | clone | near-duplicate function computePosition(), ~11 statements, fuzzy | unchanged | 2 / 2 |
| 432 | G0432 | clone | near-duplicate function hash32(), ~11 statements, fuzzy | unchanged | 2 / 2 |
| 433 | G0433 | clone | near-duplicate function orientationLayout(), ~57 statements, same vocabulary (dialect copy or close variant) | unchanged | 2 / 2 |
| 435 | G0435 | clone | near-duplicate function pickAngle(), ~10 statements, fuzzy | unchanged | 2 / 2 |
| 436 | G0436 | clone | near-duplicate function placeDriftBucket(), ~22 statements, fuzzy | unchanged | 2 / 2 |
| 437 | G0437 | clone | near-duplicate function placeSegmentBucket(), ~44 statements, same vocabulary (dialect copy or close variant) | unchanged | 2 / 2 |
| 438 | G0438 | clone | near-duplicate function pushProjectSegments() (also: pushProjectSegs), ~8 statements, fuzzy | unchanged | 2 / 2 |
| 439 | G0439 | record | record assembled from the same sources {label=ID[].name, projectName=ID[].name, cards=ID[].group} | unchanged | 2 / 2 |
| 440 | G0440 | cmp | repeated comparison kind == 'label' | unchanged | 2 / 2 |
| 441 | G0441 | cmp | repeated comparison kind == 'plan' | unchanged | 2 / 2 |
| 442 | G0442 | cmp | repeated comparison kind == 'project' | unchanged | 2 / 2 |
| 443 | G0443 | cmp | repeated comparison projectSector == 'port' | unchanged | 2 / 2 |
| 444 | G0444 | cmp | repeated comparison projectSector == 'starboard' | unchanged | 2 / 2 |
| 445 | G0445 | cmp | repeated comparison sector == 'drift' | unchanged | 2 / 2 |
| 446 | G0446 | cmp | repeated comparison sector == 'ship' | unchanged | 2 / 2 |
| 447 | G0447 | discrim | string set {'E', 'W'} as or-chain | unchanged | 2 / 2 |
| 451 | G0451 | clone | near-duplicate function assignLanes(), ~32 statements, same vocabulary (dialect copy or close variant) | unchanged | 2 / 2 |
| 452 | G0452 | clone | near-duplicate function assignSegments(), ~21 statements, same vocabulary (dialect copy or close variant) | unchanged | 2 / 2 |
| 453 | G0453 | clone | near-duplicate function buildChainLabel(), ~10 statements, same vocabulary (dialect copy or close variant) | unchanged | 2 / 2 |
| 454 | G0454 | clone | near-duplicate function cohereSubtaskGroups(), ~39 statements, same vocabulary (dialect copy or close variant) | unchanged | 2 / 2 |
| 455 | G0455 | clone | near-duplicate function computeCrossLaneColumns(), ~108 statements, same vocabulary (dialect copy or close variant) | unchanged | 2 / 2 |
| 456 | G0456 | clone | near-duplicate function groupByAssignee() (also: groupByProject), ~10 statements, same vocabulary (dialect copy or close variant) | unchanged | 2 / 2 |
| 457 | G0457 | clone | near-duplicate function groupByStatus(), ~12 statements, same vocabulary (dialect copy or close variant) | unchanged | 2 / 2 |
| 458 | G0458 | clone | near-duplicate function list(), ~7 statements, structurally identical | unchanged | 2 / 2 |
| 459 | G0459 | clone | near-duplicate function mergeLabels(), ~6 statements, fuzzy | unchanged | 2 / 2 |
| 460 | G0460 | clone | near-duplicate function mergeLanes(), ~9 statements, same vocabulary (dialect copy or close variant) | unchanged | 2 / 2 |
| 461 | G0461 | clone | near-duplicate function stableStringify(), ~7 statements, structurally identical | unchanged | 2 / 2 |
| 463 | G0463 | cmp | repeated comparison grouping == 'dependency' | unchanged | 2 / 2 |
| 464 | G0464 | cmp | repeated comparison rawKey == 'duplicate' | unchanged | 2 / 2 |
| 466 | G0466 | discrim | string set {'assignee', 'dependency', 'project', 'status'} as switch | unchanged | 2 / 2 |
| 468 | G0468 | discrim | string set {'dependency', 'project'} as or-chain | unchanged | 2 / 2 |
| 469 | G0469 | const | named constant MAX_CUSTOM_PRESETS=20 | unchanged | 2 / 2 |
| 470 | G0470 | const | named constant MAX_PRESET_NAME_LENGTH=50 | unchanged | 2 / 2 |
| 472 | G0472 | cmp | repeated comparison orientation == 'vertical' | unchanged | 2 / 2 |
| 473 | G0473 | clone | near-duplicate function (anonymous)(), ~7 statements, fuzzy | new | 2 / 2 |
| 474 | G0474 | clone | near-duplicate function layoutIndex(), ~30 statements, same vocabulary (dialect copy or close variant) | unchanged | 2 / 2 |

## The 7 gone groups (gauge-validity note for LIN-3449 and LIN-3490)

| 10-18 id | what it was | classification |
|---|---|---|
| G0002 | free-tier record (10 files) | **consolidated** (LIN-3658; 11 copies → `freeTierRefusalBlock`). The 3 leftover sites re-key as G0079 (noise) |
| G0026 | `FINISHED_STATE_TYPES` (4 files) | **consolidated** onto `isTerminalState` (LIN-3656, 3659) |
| G0047 | `TERMINAL_*` (6 files) | **re-keyed → G0072.** One copy, `context-graph`, removed; 4 browser copies plus `models.js` remain |
| G0107 | `REMINT_KINDS` | **re-keyed → G0071, and grew** (`INSTALLATION_KEYED_PROVIDERS`, LIN-3285) |
| G0246 | `dispatchSessionFollowUp` / `send_follow_up` clone | **reshaped past the detector, still duplicated.** LIN-3661 split it into `enqueueFollowUp`; `follow-up-dispatch.js:150` still says "Byte-for-byte mirror of send_follow_up's own finalizePrompt" (re-verified) |
| G0337 | `type=='canceled'` | **reshaped; was noise** (`render-task-page.js:442` is now canceled∪duplicate) |
| G0371 | graphql / `listUserInstallations` clone | **re-keyed → G0369** (same 3 files) |

**Only 2 of the 7 left the code** (G0002 and G0026), plus 1 of G0047's 6 copies. 10-18 read 9 of 28. This is row `census-gone-overstates-resolution`, which holds.

## Classes and their bounds

| class | how bounded | members |
|---|---|---|
| census `mustRule` groups | the tool's rule (top 25, or ≥3 areas) | 90 (ruling table above) |
| census gone groups | the tool's `gone` list, read at both SHAs | 7: 2 consolidated, 3 re-keyed, 1 reshaped and still duplicated, 1 reshaped noise |
| "consumer is listening" signals and their writers | grep `validateToken(`, `lastUsedAt`, `getConsumerLastSeenAt`, the heartbeat store | 2 validators, each behind 1 auth middleware; 6 readers (Rule S, the enqueue stamp, 3 read-time warnings, the runner poll); writers that still touch: polls, takes, `broker-token`, feedback (LIN-2883); no second representation |
| owner-answer gates | LIN-3648's raw-read grep + `readOwnerStatus` / `isOwnerAnswer` callers | 7 gates (listed in part 1, L2), 0 raw readers outside the home |
| free-tier deciders and blocks | LIN-3658's three ticket greps + the G0002 sites | 3 named rules in `chat-request.js`; block ×1 (12 calls / 8 routes); residue 2 lines in `workspace-api.js`; `chargeFreeTierOrReject` ×1 |
| terminal-state restatements | grep of type/state comparisons and terminal sets over lib, routes, server.js and public at both SHAs | 9 → 4 (browser only); inline cmp completed / canceled / cancelled / duplicate 19 / 5 / 1 / 9; `tree.js` production importers 0 |
| close-out refusal lanes | `*_STAGES` tables + the press route | session ✓, press ✓; proxy, recommend and kickoff unchecked |
| "merged" readers | grep `'merged'`, `'partial'`, `isMerged`, `atMerge`, `settling` | 2 sources (live, record); G0110 5 sites; `settling` merged-only ×1 |
| CI-wake sweep re-derivations | read all 407 lines against each import's home | target rule, lineage read, PR-URL regex, `toMs`, tick resolver (borderline), 1 non-wire 500 producer |
| runner contract rows | `contract.json` (24) + 10-18 rows + LIN-3624's list | halt ×6 rows plus 1 untabled; target, repo, status cap, decision cap, heartbeat; untabled: 4 row fields, harness, abort texts, resume marker, `going down`, decision-prefix window, recap chunking, 4 markers |
| heartbeat wire elements | both sides + `contract.json` + docs | fields ×4 (×5 by shape), schema ×2, path literals 5 + SD 1, bounds ×2 (×3), stale factor, TTL / cap / size, docs ×3, false claim ×4 |
| pause-marker checks | grep `=== 'pending'` on wake markers | 9 (listed in part 1, L8) |
| CLAUDE.md single homes | the Invariants list | 6 checked, all hold |
| SD internals | 1 window commit + earlier SD rows | read; **SD has no census tool (stated, not bounded by a tool)** |
| production rows with two same-provider bindings | **unbounded**: production data, not source | — |
| SD processes whose cycle stalls while their sessions still post feedback | **unbounded**: runtime behaviour, not source | — |

**Closing the set.**
- **Search that would surface a missed sibling of the heartbeat fix:** `git grep 'validateToken('` over lib, routes and server.js gives 2 call sites; `getConsumerLastSeenAt` gives 6 readers.
- **For the owner reader:** LIN-3648's grep gives 0 raw reads, and the `readOwnerStatus` / `isOwnerAnswer` callers give 7.
- **For the CI-wake sweep:** every named export it shadows was checked by name (`NON_SESSION_TARGETS`, `PR_URL_RE`, `toEpochMs`, the `sweepD2` read).
- **For new files:** `git diff --diff-filter=AR` gives 5 production files, all read.
- **What would make the set wrong:** a decision restated **inside an unchanged file** that the window's moves made inconsistent. The `duplicate` glyph is one such case, found only by reading `isTerminalState`'s consumers; others like it are possible. The census cannot see those, so the second-read should be pointed at them.

## Cross-repo contract verdicts (Harbour · SD · runner kit · consumer heartbeat)

| contract | verdict | evidence |
|---|---|---|
| **Runner contract table** (`lib/runner-kit/contract.json`, byte-copied to SD `test/fixtures/runner-contract.json`) | **Unchanged: declared in neither repo's production code; pinned one way.** Now 24 rows. Harbour amended it in `d947d2dc` and SD re-copied it by hand 8 minutes later (`b43fdcaa`); both are sha `efe6658f…`. No mechanism forced the sync, so the one-way-pin verdict (LIN-3630) stands. | `contract.json:3`; SD `test/runner-contract.test.js:25` (`LV_COMMIT='d947d2dc'` correct, header `:14` still cites `1804aeb6`). |
| **Halt** | **Improved.** SD now reads an unknown mode as pause (`halt.js:258-264` `normaliseHarbourHalt`), so the fresh-item row agrees; the abort-under-unknown row and stop text are listed. Stop + follow-up with no session is still open. **New untabled case: a follow-up under an unknown mode** (SD applies pause rules; the kit leaves it, `runner.mjs:218`). Pause/stop literals: one declaration each (`workspace-halt.js:28`, SD `halt.js:262`, kit `:218`). | L9 |
| **Target / repo / cap** | Aligned or listed. The Harbour runner poll is still unfiltered by target (LIN-3622). The CI-wake sweep adds a private target set on the Harbour side only (finding 3). | L7, L9 |
| **Markers and decision dialect** | **Not aligned (unchanged).** The kit still lacks the 4 markers and the resume marker; Harbour's resume-marker readers went 1 → 2 (`derivePendingPark` also clears on SD's `[working] Session resumed.`). LIN-3624's description is still not corrected (the correction exists only as the 10-18 comment). | L8, L9 |
| **Consumer heartbeat** (LIN-1952 / LIN-3647) | **Conflation resolved; wire still restated on both sides.** 18-field list ×4 (×5 by shape), schema ×2, path literals 3 → 5, bounds ×2 (×3 by shape); the false "a rename on either side fails a test" claim is now in **4** places; `dispatch-integration.md:280` ("the kit sends the same body") is still false (the kit has 0 heartbeat calls); an interval of 300000 or more never reads stale (Stability). | L1 |
| **Runner kit (LIN-3495 / LIN-3496)** | LIN-3495 is a consolidation inside the kit (`describeConnectFailure`, 4 callers). LIN-3496's `parseCredentialBlock` relies on two layout facts of the Harbour producer `public/runner-setup.js:33-46`; its test pins a hand copy of the block, not the producer (new row `credential-block-grammar-split`). | L9 |
| **Wake regex / terminal regex** | Equal to the Harbour sources (`feedback.js:22` ≡ `dispatch-terminal.js:63`); the SD comment still cites `:53` (Documentation). | ledger |
| **API base** | SD 2 copies; Harbour inline 23; unchanged (the sweep's `baseUrl` reuses `resolveEmailLinkOrigin`, `server.js:963`). | ledger |
| **CI** | `.github` has a 0-line diff in both repos. LV: `ci-success` needs `[unit,e2e,secret-scan]`. SD: one job; its system and mutation suites are not in CI. | ledger |
| **`dispatch-kind-vocabulary-cross-repo`** | Held (SD `'wake'` 21 / 6 at both SHAs). | ledger |

## Sibling hand-offs (record, do not flag)

- **Documentation.**
  - 10-18 items that landed: `proxy-integration.md:2672` and `proxy-instructions.js:651` (LIN-3647), and `dispatch-integration.md:236` improved.
  - Still open:
    - `dispatch-integration.md:280` (says the kit sends a heartbeat)
    - `proxy-integration.md:2307` (`item.force`)
    - `plumbing.md:185` and `retro-audit.md:288` (stale freeze numbers; live values are 342957 and 4427)
    - SD `phases.js:24-27`, `config.js:557`; SD `feedback.js:19` still cites `:53`
    - SD contract-test header `:14` still cites `1804aeb6`
    - `session-telemetry.js:662-670` JSDoc
    - `runner-kit-helper.test.js:446` title
    - LIN-3616's description refs (now +61 lines stale)
    - LIN-3475's title (says 9; it is 7)
  - New: `installation-pages.js` is missing from `source-map.md`; the consumer-poll-warning comments still say "poll/take".
- **Security** (`security-review-2026-10-18.md`):
  - `accountIdsFor` vs `resolveAccountGroup`, now beside LIN-3414's Privacy text (I);
  - the installation resolver's egress, `globalThis.fetch` (`server.js:713`) vs `createProxyFetch` (`github-pr-status.js:376`) (I);
  - the kit's single-quoted decision JSON (carried).
- **Stability:**
  - `periodic-loop-two-mechanisms`: 6 jobs + `server.js:4586`;
  - heartbeat stale-vs-TTL (interval ≥ 300000 never stale);
  - SD's read-only cache rule enforced only in tests;
  - the NaN `toMs` in the sweep's sort comparators.
- **Test Coverage / Code Quality (tests):**
  - the one-way contract pin, and the tautological kit heartbeat row;
  - the false "rename fails a test" claim ×4;
  - the credential-block test pins a hand copy;
  - `batch-guard-residue`;
  - SD's system and mutation suites are not in CI.
- **Seams & Tangles** (latest 2026-10-13): area-level knots from the two sweep imports and the credential-core → providers import.
- **API Quality:**
  - limiter bodies ×11;
  - R vs K upstream-auth reply shapes (LIN-3608 item 8);
  - `provider-write-field-contract`;
  - `CLOSE_OUT_ALREADY_MERGED` is a literal code string.
- **Code Quality:**
  - `surfaceFreeTier` ×2;
  - `formatElapsed` twin;
  - the `isOwner` / `#ownerStillOwns` wrapper twin, if not promoted.

## LIN-3490 places per decision

> *19 Oct, a small window dense with one-place moves, and the first like-for-like census comparison (same tool, command and area guide; the kit has a 0-line diff and the 10-18 run reproduces exactly). Of the 39 distinct decisions held in more than one place at 10-18, **3 resolved outright**: the heartbeat's liveness conflation (LIN-3647), the free-tier rule (LIN-3658) and the CSP split (LIN-3627). **4 improved**: the owner-answer reader (Low-Medium → Low), close-out head-moved, the terminal-state predicate (server side) and halt. **2 rows worsened**, both from one new module (LIN-3661's CI-wake sweep): target vocabulary, and timestamp-parse (an ungraded consolidated row); the same module also became a new consumer of a terminal-loop copy. This edition adds **7 decisions**: 4 born in the window (the follow-up target rule and the lineage-row read, both in the sweep; review-on-record, LIN-3497; the review-loop ceiling text, LIN-3651), 1 deepened (the runner-kit credential-block grammar, LIN-3496) and 2 pre-existing, first seen by reading this window (PR-URL regexes, now 5; the pause-marker predicate gap, which grew 8 → 9). That gives **43 distinct decisions: 0 High, 1 Medium-High, 2 Medium, 13 Low-Medium/Medium-Low and 27 Low.** Unlike 10-18's jump, this movement is mostly **code**: 3 resolved and 4 born or deepened in the window. The census's own real-decision count, re-based on 10-18's stated merges, went **21 → 18**. Of the 7 census groups "gone" in the window, only 2 left the code.*

How it is counted: the same rule as 10-18. Sub-rows, the overlapping sentinel row, resolved rows, ungraded held rows, informational rows and the layering row 85 and `github-envelope-walker-split` (documented split) are excluded.
- **Medium-High (1):** `credential-decision-multiplicity`.
- **Medium (2):** `runner-contract-semantics-cross-repo`, `run-page-identity-scrape`.
- **Arithmetic:** 39 − 3 resolved + 7 new = 43. Two decisions moved band: `owner-answer-reader-copies` went to Low, and `csp-decision-split` left the Low-Medium band when it resolved.
- **Band tally re-checked by script against the ledger below:** 27 Low + 13 Low-Medium/Medium-Low + 2 Medium + 1 Medium-High + 0 High = 43.

## Follow-ups (highest severity only)

Search was done before minting (`NON_SESSION_TARGETS`, "follow-up target", "ci-wake", `readOwnerStatus`, "owner check", "duplicate glyph", `stateGlyph`, "duplicate state"): no open ticket names any of the three findings (LIN-3661, 3648, 3654, 3655 and 3656 are Done). All follow LIN-3449's child-ticket style: one decision, one plain-line behaviour choice, one PR, tests in the home module's own test file, no new guard, sweep, count pin or post-deploy check.

1. **LIN-3672 — MINTED: one follow-up target rule.** Behaviour choice: the rule stays as `deriveFollowUpDispatch` states it; the sweep keeps skipping where `chat-tools` throws. Done when one exported helper decides the target for both callers and the sweep's private `NON_SESSION_TARGETS` is deleted. Fixes `follow-up-target-rule-copies` and the worsening of `target-vocabulary`.
2. **LIN-3673 — MINTED: the owner check never throws.** Behaviour choice: a seam throw and a getter throw both read `'unavailable'`, which every gate already refuses. Done when `readOwnerStatus` is total, the 7 try wrappers and the second verdict→code map are deleted. Fixes the residue of `owner-answer-reader-copies` (security-adjacent; 2 of 6 placements were wrong and took 3 commits in a day).
3. **LIN-3674 — MINTED: a duplicate task looks the same everywhere.** Behaviour choice: a duplicate is drawn ✕, like canceled (LIN-276/3656/3659 made "duplicate reads as cancelled" the house rule); the owner confirms in review. Done when the glyph comes from `getStateDisplay` and `render-task-page.js` `stateGlyph` is deleted. Fixes the ✓ / ✕ / ○ contradiction in `state-type-label-rank-maps`.

**Updated rather than minted** (each already names the decision; one comment each, from this run): **LIN-2150 / LIN-2188** (writer repro holds for the third edition running; add LIN-3285's owner-installation lane and `INSTALLATION_KEYED_PROVIDERS`), **LIN-3624** (correct the description itself; add the untabled follow-up-under-unknown-mode case and the widened resume-marker dependency), **LIN-3636** (LIN-3647 is Done, so a kit beat no longer extends the conflation; ask it to carry `lastPollOkAt`, fix `dispatch-integration.md:280`, the contract row's kit cell and the tautological test), **LIN-3521** (the repaint also drops the head-moved reason), **LIN-3417** (`PROXY_STAGES` / `RECOMMEND_STAGES` / `KICKOFF_STAGES` still have no close-out stage), **LIN-1496** (the CI-wake sweep is a new consumer of the `chat-tools` terminal-loop copy), **LIN-3616** (refs +61 lines stale; filtering readers 5 → 6), **LIN-3475** (title says 9, it is 7), **LIN-2883** (name the remaining non-poll touches: `broker-token`, feedback). **LIN-3074** looks obsolete (the "does not yet honor / pending LIN-2995" copy has 0 production hits; `dispatch-integration.md:136` is corrected): a recommendation to close, not closed by this run.

**Same-size alternatives, not promoted:** `pause-marker-predicate-gap` (one `isPauseWakeMarker`, 9 → 1), `fresh-run-definition-copies` (re-weighed: not grown, still sound, no longer the top in its area), the browser terminal array (G0072, 4 → 1 in `public/common.js`), `lineage-row-read-copies`.

## Ticket trend

- **Done in the window:** LIN-3647, 3648, 3654, 3655, 3612, 3656, 3659, 3627, 3657, 3634, 3658, 3661, 3499. **In Progress:** LIN-3449, 3490, 3339. **Todo:** LIN-2150. **Backlog:** LIN-3608, 3616, 3521, 3297, 3475, 3640, 3349, 2188, 3624, 3636, 3074, 3347, 3417, 2481, 2883, 1496, 2847, and the three minted today (LIN-3672/3673/3674).
- **Watch items from 10-18:** LIN-2188's scenario declared real (**no**); agent-status starts a waiting clock, LIN-3339 (**still parked**); LIN-3624 corrected (**no**, comment only).

## Compact trend ledger

`07-12` was never recovered (lost edition, task LIN-1231), so every 07-12 cell is `not recovered` and nothing is interpolated. Row names are stable. All 77 rows of the 10-18 ledger are carried in order, their earlier cells copied verbatim by script; the 9 new rows are appended (8 from the review, 1 from the second-read). Severity is this run's grade; the `10-19` column is this run's reading at `77704276` / SD `b43fdcaa`. "held" means a row that was already resolved or ungraded and stays that way.

| finding | severity | 06-25 | 07-12 | 08-29 | 2026-09-26 | 2026-10-11 | 10-11 post-batch | 10-12 post-batch-3 | 10-18 | 10-19 (this run) | delta |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `lib-import-cycles` | resolved | clean | not recovered | 3 elementary cycles / 3 modules / 5 edges (latent) | kpi 3 (unchanged) + **new 2-node `dispatch-store ↔ digest-feedback`** (latent) | 4 SCCs / 27 members: provider 15 + **6 (kpi + dispatch/digest merged via `milestone-funnel`)** + new `run-evidence↔run-closeout-state` + new 4-node routes cycle (latent, 27/27 load alone) | **0 SCCs / 0 members** (385 nodes / 1,435 edges); walker reproduces 10-11 baseline exactly at `6df0fbd5`; 0 dynamic upward imports | **0 SCCs** (393 nodes / 1,476 edges); walker reproduces 15990905 (385 / 1,435 / 0) and 6df0fbd5 (377 / 1,369 / 4) exactly; 0 static / 0 dynamic upward imports; 8/8 new modules load alone | 402 nodes / 1,487 edges / 0 SCCs; reproduces 393/1,476/0 at e24f8d12 | 406 / 1,523 / 0; walker reproduces 402 / 1,487 / 0 and 393 / 1,476 / 0 | held |
| `provider-auth-router-upward-imports` | resolved | 2 edges, no cycle | not recovered | 4 edges, all inside static cycles; SCC 13 (re-measured by this run at `292ac962`; not stated in the 08-29 edition) | 4 edges; **SCC 13→15** (+`github-install-flow`, +`render-settings`) | SCC 15 (unchanged); edges **4→5** (+`render-swipe.js:23`→`routes/workspace.js`) | **0** `lib/`→`routes/`/`server.js` edges (static and dynamic); SCC 15 gone; one wiring table `routes/provider-auth-routers.js:21` | 0 static / 0 dynamic `lib/`→`routes/`/`server.js` edges | 0 static, 0 dynamic | 0 static, 0 dynamic | held |
| `routes-error-envelope-fragmentation` | low-medium | 5 importers, ~53 residue | not recovered | 14 importers, 68 residue (routes-only); `dashboard.js` half-adopter | 26 importers but **adoption flat** (11 from the `proxy.js` split); residue **76 → 87** matched-SHA; `flight-companion.js` **0 → 8** | 35 importers (no split artifact; 8 born-adopters + 1 genuine); residue **87→93** (`task-chat` +4, `runner-kit` +2) | 10-11 command **0** (LIN-3460); 43 importers; shape: **74** `keepalive.send(4xx/5xx,{error})` (73 at `6df0fbd5`, never seen by the command) + 8 pre-built `{status,body}` + 8 `res.status(<var>).json(` | 10-11 command **0** (both SHAs); `res.status(<var>).json(` **8** in routes+server.js (same 8 sites; the probe's 10 adds 2 `lib/` lines and reads 10 at baseline too); **9** pre-built `{status, body}` producers (the 8 + `chargeFreeTierOrReject` `routes/proxy.js:1363-1370`, present at baseline) forwarded by 16 sites; `errorEnvelope` 1 caller; `lib/errors.js` importers 43→42 | (i)–(vi): 0 / 7(+1 lib) / 9 / 8 / 1 / 0. Shape: upstream-failure copies 36→12; limiter bodies 11 | (i)–(vi) 0 / 7(+1) / 9 / 8 / 1 / 0 at both SHAs; upstream 12; limiter 11; +1 non-wire producer `ci-wake-sweep.js:404`; `chargeFreeTierOrReject` kept, now spreading `freeTierRefusalBlock` | held |
| `production-to-test-fixture-imports` | resolved | — | not recovered | 7 sites | 7 sites | 7 sites | 7 sites | **0** static / 0 dynamic outside `routes/test.js` (7 + 1 → 0, LIN-3472); no second copy left in `tests/fixtures` | 0 | 0 | held |
| `periodical-report-filename-convention-split` | medium-low | — | not recovered | id↔filename join non-mechanical | same | same (`periodicals.js:881`) | same (`periodicals.js:881`); this edition adds a `-post-batch` suffix | same (`periodicals.js:881`, 0-line diff) | 9 of 16 ids ≠ slug; `periodicals.js:1028-1050` | 9 of 16 ≠ slug; `periodicals.js` 0-line diff (`:1047-1051`) | unchanged |
| `dispatch-kind-vocabulary-cross-repo` | — | — | not recovered | 3 hardcoded keys | 3-key subset | `NO_BOOTSTRAP_KINDS` deleted (LIN-3199); bare `'wake'` literal only (18 lines / 10 files) | held resolved (SD 0 commits) | held (SD 0 commits) | SD `'wake'` 21 lines / 6 files, 0 in production | SD `'wake'` 21 / 6 at both | held |
| `provider-resolution-incantation` | low | 4 sites | not recovered | 16 sites | **17 sites** (18 raw incl. canonical helper body) | **18 sites** (21 raw lines); new `superseded-selection.js:53` written to evade the count pin | 09-26 command **2** raw lines (leaf + exempt referent) = 0 hand-rolled; **shape: 5** (`workspace-urlkey.js:196,240,256,258`, `live-console.js:58`); pin replaced by a name-keyed guard | old command **2** raw (leaf + exempt referent); shape **3**, all compound predicates in the key-deciding module (`workspace-urlkey.js:197,257,259`); plain lookups 0 (LIN-3474); finder importers 10→13 | old 2, shape 3 | old command 2 → 3 (the new hit, `ci-wake-sweep.js:287`, is a false positive); shape 3 | unchanged |
| `ui-divergences-registry-staleness` | low | — | not recovered | registry 4 / actual 6 | registry 4 / actual **9** | native `confirm()` **9→10** (`proxy.js:389`) | native `confirm()` 10 | native `confirm(` **10** by the 10-11 method (comment lines excluded); loose grep 21 | `confirm(` 10 | `confirm(` 10 | unchanged |
| `simple-dispatcher-api-base-duplication` | low | — | not recovered | 2 | 2 | 2 (kit takes `baseUrl` from server) | 2 | SD 2 (`config.js:17`, `feedback.js:5`); Harbour inline `${req.protocol}://${req.get('host')}` 30 | SD 2; Harbour inline 30→23 | SD 2; Harbour inline 23 at both | unchanged |
| `cross-repo-halt-vocabulary` | low-medium (sub-row) | — | not recovered | — | independently-defined `{pause,stop}` / `{mode,setAt,setBy}`; LIN-3074 | value single-authority; **meaning diverges 4 ways** SD↔kit; docs claim parity; LIN-3074 covers copy only | meaning diverges 4 ways (SD 0 commits, kit diff empty); `runner-prompt.md:219` parity claim stands | meaning diverges 4 ways (unknown mode SD fail-open `dispatcher.js:1654` / kit fail-closed `runner.mjs:214`; abort under stop; stop text `:605` vs `:253`; pause + follow-up `followup.js:40` vs `runner.mjs:209-212`); parity claim now `runner-prompt.md:216` | 2 of 4 resolved; unknown-mode (deliberate) and stop text (cosmetic) listed; stop + no-session follow-up newly listed | SD reads an unknown mode as pause (`halt.js:258-264`); fresh-item and abort-under-unknown rows listed; stop + no-session follow-up still open; **new untabled case: follow-up under an unknown mode** | improved, +1 untabled case |
| `cross-repo-sentinel-decision-marker-vocabulary` | medium | — | not recovered | — | grammar split clean; word vocabulary duplicated | kit cannot emit `[pending]`/`[decision]`; wake regex ×3 un-imported; 1 cross-party pin | kit cannot emit `[pending]`/`[decision]`; wake regex authority `dispatch-terminal.js:63`, 3 copies; SD cite 10 lines stale | kit can now raise a ruling (LIN-3505) through a prose-only third producer form (see `decision-dialect-split`); `[pending]`/withdrawal still absent from kit; LV wake copies 0; SD restates the wake regex at `feedback.js:22` and still cites `:53` (now `:63`) | kit still lacks `[pending]`/withdraw/`[evidence]`/`[working]`; resume marker missing; LIN-3624 mis-states the residue | kit still lacks the 4 markers and the resume marker; Harbour resume-marker readers 1 → 2 (`derivePendingPark`); LIN-3624 description still not corrected | unchanged (dependency wider) |
| `target-vocabulary` | low-medium | — | not recovered | — | 3 disagreeing LinearViewer lists + inline copies; SD owns runner set | LV 17 lines / 9 files (+`runner-owner-gate.js:22`); 3 lists persist; kit/Harbour poll unfiltered vs SD `cli`/`web` | 7 bracketed lists unchanged; 16 lines / 9 files (this run's method; 10-11's 17 not reproducible) | LV: one declaration `lib/dispatch-targets.js:17-27` (bracketed lists 7→3, all inside it; named lists 4→0; 9 importers). Default `'cli'` still restated ~18 server + ~10 client lines (`RUN_FIELDS.target` `dispatch-fields.js:53` does not import the declaration). SD `targets.js:15-18` {cli,web}; kit reads none; runner poll unfiltered (`proxy-runner.js:94`→`dispatch-store.js:924`) | 1 declaration, 7 importers; default `'cli'` server 19 / client 13; kit filters (pinned copy); poll unfiltered | 8 importers; default `'cli'` server 19 / client 13; **private `NON_SESSION_TARGETS` at `ci-wake-sweep.js:52` shadows `dispatch-targets.js:33`**; runner poll still unfiltered | **worsened** (named lists outside the declaration 0 → 1) |
| `sse-frame-writer-duplication` | resolved | — | not recovered | — | 2 byte-identical copies of canonical `lib/sse.js:23 sendSSE` | 2 copies; **LIN-2663** tracks (not minted) | 2 copies (LIN-2663) | `function sendSSE` **1** (`lib/sse.js:23`); hand-written frames outside it 2→0; 9 hand-written `text/event-stream` header preambles remain (LIN-3475, Backlog) | 1 writer; preambles 7 sites / 5 files (LIN-3475) | 1 writer; preambles 7 / 5 (LIN-3475's title says 9) | held |
| `routes-proxy-decomposition` | — | — | not recovered | — | `routes/proxy.js` 7,315→1,591 lines, 11 injected sub-routers | held (`proxy.js` 11 sub-routers); no new split this window | held | held | held | 14 sub-routers; 1,613 lines | held |
| `cross-repo-repo-list` | low | — | not recovered | deliberate | deliberate; LIN-2974 Done | Harbour list **deleted** (LIN-3333); SD alone validates; kit ignores `item.repo`; LIN-3347 SD-side only | unchanged | unchanged (SD alone validates `dispatcher.js:159-187`; kit ignores `item.repo`; LIN-3347 Backlog) | kit validates (`runner.mjs:233-241`); resolution difference documented | kit validates (`runner.mjs:235-243`) | unchanged |
| `ci-convention-split-across-repos` | informational | — | not recovered | Node 20 vs 22 | same; `ci-success` `needs:[unit,e2e,secret-scan]` | same (Node 20 vs 22; `ci-success` `needs:[unit,e2e,secret-scan]`) | same | same (LV Node 20, `ci-success` `needs:[unit,e2e,secret-scan]`; SD Node 22, no aggregate) | LV Node 20 + `ci-success`; SD Node 22, one job; SD system/mutation suites not in CI | 0-line diff in `.github` | unchanged |
| `semicolon-style-split` | low | unchanged | not recovered | unchanged | unchanged | unchanged (not re-measured; no style change observed) | not re-measured (new `routes/provider-auth-routers.js` omits semicolons) | not re-measured (#1873 added one missing `;` on a LIN-3487 import) | not re-measured | not re-measured | unchanged |
| `client-escape-html-duplication` | — | resolved | not recovered | held | held | held (1 definition) | held (not re-measured; `public/` diff touches only `common.js`/`observation.js`) | held (same count at both SHAs) | held | held | held |
| `client-shared-helper-duplication` | — | largely resolved | not recovered | resolved, held | held | held (`formatElapsed` pair noted under `server-formatter-duplication`) | held | held | held | the `formatElapsed` pair only | held |
| `client-section-fetch-idiom-duplication` | — | resolved | not recovered | held (19 files) | held (**20 files**) | held (**23 files**) | held (24 files by `git grep -l window.api`, same at `6df0fbd5`) | held (24 files by `git grep -l window.api`, same at 15990905) | 24 | 25 (+`question-cards.js`, moved from `session.js`) | held |
| `linear-cli-parallel-graphql-surface` | — | resolved | not recovered | held | held | held (module absent) | held | held | held | module absent | held |
| `store-module-uniformity` | — | clean (10) | not recovered | clean (22) | clean (**24**) | **32/33** (33 stores); 1 naming outlier `pr-state-store` | 33 stores (no new store) | 33 stores (no new store) | 33 stores | 33 stores | held |
| `server-side-escaping` | — | clean (26) | not recovered | clean (45) | clean (**46**) | clean (**55**) | 55 importers | 54 importers (55 at 15990905; `routes/workspace.js` dropped with `htmlError`) | 54 importers | 55 importers (+`question-card.js`) | held |
| `dispatch-payload-centralization` | — | clean (5) | not recovered | clean (8) | clean (8) | clean (**5** by the 09-26 command; the 09-26 "8" was mis-stated) | held (not re-measured) | held (not re-measured) | 6 files / 5 callers | 10-18's 6 / 5 not reproduced; `dispatchPrompt({` 8 calls / 7 files at both SHAs | held |
| `renderer-provider-abstraction` | — | clean | not recovered | clean | clean | held (not re-measured beyond provider seam) | held (not re-measured) | held (not re-measured) | not re-measured | not re-measured | held |
| `cache-module-family` | — | — | not recovered | clean | clean (7) | clean (7, two families) | held (not re-measured) | held (not re-measured) | not re-measured | not re-measured; +1 in-process installation-token cache (`connection-credential.js:1430`) | held, note |
| `lib-components-primitive-adoption` | — | not assessed | not recovered | clean (30/30) | clean (**31/31**) | **36/38** (2 fragment modules) | 36/38 | 36/38 | 36/38 by import (`button.js` 1 importer; ~22 hand-built `action-btn` the gauge can't see) | 36 / 39 `render*.js` (the same 3 non-importers at both SHAs); `button.js` 1 importer; `action-btn` 21 → 20 | held |
| `state-store-write-seam` (SD) | — | not assessed | not recovered | clean | clean | clean (incl. 3 new SD modules) | held (SD 0 commits) | held (SD 0 commits) | write seam clean; new cached read path, read-only rule enforced only in tests | `b43fdcaa` writes no state | held |
| `phase-vocabulary-centralization` (SD) | — | not assessed | not recovered | clean, exemplary | clean, exemplary | clean (incl. 3 new SD modules) | held (SD 0 commits) | held (SD 0 commits) | 0 raw phase strings; `phases.js:24-27` wording stale | 0 phase literals touched | held |
| `target-harness-axis-orthogonality` | — | not assessed | not recovered | clean | clean | clean | held | held | held | not re-measured | held |
| `test-seam-separation` | — | not assessed | not recovered | clean | clean | clean | held | held | not re-measured | not re-measured | held |
| `css-token-layer` | — | not assessed | not recovered | clean, 1 ratified outlier | does not reproduce (sibling-owned) | sibling-owned (Design & Interface) | sibling-owned | sibling-owned | sibling-owned | sibling-owned | routed |
| `runner-contract-semantics-cross-repo` | medium | — | not recovered | — | — | **NEW: kit re-implements SD reactions; diverged on halt ×4, target, repo, markers** | unchanged on every row (LIN-3451, Backlog); corrections: `cascade`/`maxSessionsPerTask` never read by SD | halt ×4, target, repo, row fields (`queueIfBusy`/`force`/`waitForFollowUps`/`subscription`, 0 in kit), 2000-char cap ×3 behaviours, harness hard-code: all unchanged; kit `runner.mjs`/`broker.mjs` untouched by LIN-3505; LIN-3213 added `runner open` + wait debounce (capability gaps vs SD, not drift); decision now raisable in a third form | halt/target/repo/status cap aligned or listed; `contract.json` is test-only with a one-way pin; row fields ×4, harness, abort texts, decision-prefix window, recap chunking not covered and no ticket | 24 rows; SD re-copied by hand 8 minutes after Harbour (sha `efe6658f…` on both); pin still one-way; header `:14` still cites `1804aeb6`; same uncovered items | unchanged |
| `connection-binding-predicate-drift` | low-medium | — | not recovered | — | — | shared predicate + 3 inline copies lacking stale-marker guard; +1 copied selector | 3 copies → predicate (11 calls / 6 files); `legacyFallbackTarget` ≡ `selectIssueSourceBinding` remains | `legacyFallbackTarget` ≡ `selectIssueSourceBinding` remains (1 caller); predicate reference counts identical | `legacyFallbackTarget` remains | `legacyFallbackTarget` remains (1 caller) | unchanged |
| `run-page-identity-scrape` | medium | — | not recovered | — | — | `session.js:738-742,866` task id from neighbouring widget; LIN-3349 | `session.js:740,868`; LIN-3349 | `public/session.js:740,742,868` (0-line diff); LIN-3349 Backlog | `public/session.js:740,742,859` (LIN-3349) | `public/session.js:453,455,576` (moved by LIN-3499); LIN-3349 | unchanged |
| `dispatch-entrance-field-duplication` | low | — | not recovered | — | — | `maxSessionsPerTask` ×5; fields re-serialised 6×/4× | cap field **deleted** (LIN-3461; 41-file PR); sibling `maxTasks` 116 lines / 15 files, validator ×5; other validators 15 lines / 5 files; store projections ×3 | 23 fields + 7 rules declared once (`lib/dispatch-fields.js:48-212`, 6 importers); store re-normalisation over the 23 names 93→**0**; `maxTasks` message 5→1 (+ trim's own `routes/dispatch.js:1381`); other validators 15/5→declaration; `maxTasks` 111 lines / 15 files. **Wire re-projection kept by design (LIN-3488 cancelled):** 34 lines in 6 `proxy-dispatch.js` blocks + `proxy-kickoff.js:489` + `pipeline-loops.js:757-796` (defaults `kind`/`target` → null vs declared `'custom'`/`'cli'`) | `RECEIPTS` one table; wire `F: x.F` 43/4/4→25/0/1; budget ×3; variant messages ×2; `ROW_FIELDS` beside `RUN_FIELDS`; 5 non-entrance enqueue sites; D1 503 ×2 | budget ×3; variant messages ×2; `ROW_FIELDS`; D1 503 ×2; 5 non-entrance enqueue sites; `'cli'` server +1 (sweep); LIN-3494 removed the client's own refusal wording; the close-out stage restates `inheritFromAnchor` (borderline, plus a press variant) | unchanged |
| `owner-word-collision` | low | — | not recovered | — | — | `viewerIsOwner:true` ×4 = "session member" | 4 sites | 4 sites | 3 by shape (10-12's 4 not reproduced) + LIN-3421 `/t/` "owner" = creator (I) | 3 by shape + `/t/` | unchanged |
| `run-family-render-primitives` | low | — | not recovered | — | — | 2 fragment modules hand-build pills/buttons/details | 2/38 | 2/38 | 2/38 | 2 / 38 | unchanged |
| `persist-binding-sibling-seams` | low | — | not recovered | — | — | ×7 sibling seams | 7 seams; fallback bodies differ (feeds `credential-decision-multiplicity`) | 7 (`auth.js:303,430`, `jira-auth.js:328,700,798`, `account-merge.js:169`, `routes/test.js:77`) | 7 | 7 | unchanged |
| `server-formatter-duplication` | low | — | not recovered | — | — | `formatDuration`/`formatUsd`/`formatElapsed` copies | `formatDuration` ×3, `formatUsd`/`fmtUsd` ×3, `formatElapsed` ×2 | `formatDuration` ×3, `formatUsd`/`fmtUsd` ×3, `formatElapsed` ×2 | `formatDuration` ×3, USD ×4 (`render-settings.js:309`, uncounted before), `formatElapsed` ×2 | `formatDuration` ×3, USD ×4, `formatElapsed` ×2 | unchanged |
| `wake-marker-regex-copies` | resolved | — | not recovered | — | — | 3 new LV copies, none import `dispatch-terminal.js:61` | 3 (`run-view.js:136`, `liveness-detectors.js:130`, `task-page-loader.js:60`) | LV literal copies 3→**0**; all import `dispatch-terminal.js:63` (LIN-3468); `public/` 0; SD copy tracked in the cross-repo row | LV 0; SD copy cites `:53` (now `:63`) | LV 0; `WAKE_FEEDBACK_REGEX` 6 importers; SD comment still cites `:53` | held |
| `runner-liveness-assumption` | low | — | not recovered | — | — | `ACTIVE_FRESH_MS` assumes SD heartbeats; kit posts none (inferred) | `liveness-detectors.js:81`; kit posts no heartbeat | `liveness-detectors.js:79`; kit posts no heartbeat (its polls feed `NOBODY_LISTENING_MS`, not `ACTIVE_FRESH_MS`) | `liveness-detectors.js:79`; kit posts no `[working]` | kit posts no `[working]` | unchanged |
| `workspace-urlkey-consolidation` | — | — | not recovered | — | — | `deriveUrlKey` used by all 7 bind arms; per-arm derivations deleted (LIN-3382); Linear `org.urlKey`… (cell truncated in the 10-11 edition) | held (module untouched) | held (module untouched by LIN-3474) | 0-line diff | 0-line diff | held |
| `credential-decision-multiplicity` | medium-high | — | not recovered | — | — | — | ≥6 credential copies, ≥7 binding choosers, E1/E2 token precedences; session-scan returns `{token:NEW, scope:OLD}` after headless refresh (function-level repro); sweep watches 3 pairings | E1/E2 retired (`getWorkspaceMirrorToken` 0); the 10-11 repro now gives `{token:NEW, scope:NEW}`. Unchanged: 6 credential copies, 7 binding choosers (reference counts identical), expiry ranking ×3, 7 persist seams, sweep 3 pairings, legacy never converts (`connection-credential.js:1280`). The refresh writer rotates the first binding of the provider (`lib/workspace.js:372`) while readers match by token; LIN-3464 put the headless lane on that writer | 6 / 7 / 5 / 4 / 3 / 7; writer repro `{site-B,B-OLD}`→`{site-A,NEW}` at both SHAs | 6 / 7 / 5 / 4 / 3 / 7 at both SHAs; repro `{site-B,B-OLD}`→`{site-A,NEW}` at both; LIN-3285 adds an owner→installation lane (own unit-id fallback), an installation-token cache, `INSTALLATION_KEYED_PROVIDERS` (G0071 real) and a core→network import; PR-read token 5 inline → 1 | unchanged core, widened |
| `keepalive-error-envelope-writer` | resolved | — | not recovered | — | — | — | 74 hand-built `keepalive.send(4xx/5xx,{error})` (73 at `6df0fbd5`) | old command 74→**0**; shape: 0 hand-built bodies; `keepaliveError` 75 sites; the 8 `keepalive.send(<var>, <var>)` sites forward pre-built bodies (counted under `routes-error-envelope-fragmentation`) | 0 hand-built; `keepaliveError` 48 (folded into workspace-api helpers) | 0 hand-built; `keepaliveError` 48 | held |
| `html-error-page-two-writers` | resolved | — | not recovered | — | — | — | `htmlError` 9 vs `renderErrorPage` 116 (+4 raw text), pages differ | `htmlError` 6→**0**, `.html(` 9→0, raw-text 4xx/5xx 4→0; `renderErrorPage` 116→124 external sites (+9 from LIN-3466 exactly, −1 via `renderServiceUnavailablePage`); themed `render-email-auth` family unchanged (Design) | held | `renderErrorPage` 132 → 133 | held |
| `ai-availability-gate-duplication` | medium-low | — | not recovered | — | — | — | 2 OpenRouter key resolvers; 13 inline 503 gates, 2 mock dialects; data-mock predicate inline ×34 (38 at `6df0fbd5`) | key resolvers 2→**1** (`resolveChatCredential`, 36 calls; `resolveProxyLLM` comment-only); the 13 named gates→`isAiUnavailable` (`chat-request.js:74`). Remaining: the mock flag is a parameter still fed 2 dialects (`isTestMode` ×6, `shouldMockAi(workspace)` ×6); **6 more** not-configured gates outside it (`workspace-api-roadmap.js:285,798`, `flight-companion.js:728,888`, `dashboard.js:2798,2984`; present at baseline, so the true total was 19); `isRecommendationEnabled` (1 call) and `getOpenRouterSource` (`server.js:1017-1025`) restate the order; data-mock predicate ×34 | 22 gates (13 in / 9 out; 3 missed by 10-12); 2 mock dialects; data-mock 34→17 (named locally, no lib owner); census G0001/G0005 real | 13 / 9; dialects 6 / 6; data-mock 14 / 16 (probe; delta 0); order restatements outside the home 2 → 1 | held (marginal improvement) |
| `dispatch-refusal-relay-duplication` | resolved | — | not recovered | — | — | — | refusal→HTTP relay written twice (`routes/proxy.js:878-1010`, `routes/dispatch.js:880-918`); LIN-3461 mirrored a branch into both | HTTP relay 2→**1** (`lib/dispatch-refusal.js:39`, reached by `routes/dispatch.js:887` and `routes/proxy.js:842` + 4 injected callers); 1 non-HTTP mapping left (`workspace-api.js:3528-3536`, inline `'RUN_LIMIT_UNVERIFIED'`) | 1 mapping, writer ×2; `runLimitRefusal` `workspace-api.js:742-748` | 1 mapping, writer ×2; `runLimitRefusal` `workspace-api.js:734` | held |
| `tolerant-date-parse-date-twins` | resolved | — | not recovered | — | — | — | 3 private Date-returning parses (`liveness-alarm-store:287`, `pipeline-loops:264`, `session-telemetry:66`), junk semantics differ | `toDate`/`_toDate` 3→**0**; both inline closures use `toEpochMs` (36 importers); 3 small private normalisers remain (`proxy-alarms.js:86-91`, `consumer-poll-warning.js:107-108`, `task-page-loader.js:84-86`) | held; new loose `createdAtMs` `proxy-reads.js:60` | `toDate` 0; 3 private normalisers | held |
| `timestamp-parse-consolidation` | — | — | not recovered | — | — | — | `toEpochMs` 30 importers; ticket grep 0 (LIN-3453) | `toEpochMs` 36 importers | 37 importers | `toEpochMs` 37; LIN-3453's command 0 → **1** (`ci-wake-sweep.js:227` `toMs`; NaN reaches comparators `:254,299`) | **worsened** |
| `loose-json-consolidation` | — | — | not recovered | — | — | — | 1 owner, 8 importers; no brace-slice elsewhere (LIN-3114) | 1 owner, 8 importers | 8 | 8 | held |
| `ai-mock-predicate-consolidation` | — | — | not recovered | — | — | — | `shouldMockAi` 1 definition, 8 importers (LIN-3459) | `shouldMockAi` 1 definition | 1 definition | 1 definition | held |
| `batch-guard-residue` | informational | — | not recovered | — | — | — | 3 batch-1 source-scan guards (lin-2389, lin-3452, loose-json); batch 2 added none | batch 3 added **0** new guard files, but re-pinned 2 count pins instead of deleting them (`lin-3124-pr1-count-pins.test.js:175` 4→3, `lin-3124-pr2-credential-census.test.js:41` 13→12), re-keyed 2 scans, and added 1 `readFileSync` scan (`run-limit-gating.test.js:262`); outside the batch #1872 and #1852 added scans; the 3 batch-1 guards are unchanged | LIN-3523 (`1ef562ce`) deleted residue; not re-measured (Test Coverage) | not re-measured (Test Coverage) | routed |
| `decision-dialect-split` | medium (sub-row) | — | not recovered | — | — | — | — | kit `DECISION:` is a prose-only producer (`runner-prompt.md:170-181`: raw JSON, only before `BLOCKED:`, no prefix, validation, dedupe or withdrawal) beside SD's `hook.js:588-659` (`[decision] ` + re-serialised JSON, any sentinel, 2000-char gate incl. prefix, dedupe, `WITHDRAW:`); one tolerant reader `parseDecision` (`session-telemetry.js:669`) | 3 grammars; prefix-in-cap window untabled | 0-line diff on the three producers and reader | unchanged |
| `human-wait-derivation-split` | low-medium | — | not recovered | — | — | — | — | "which marker means waiting on a person": exported `WAITING_WAKE_MARKERS` (`digest-feedback.js:56`) + 2 copies "keep in parity" (`render-run-steps.js:159`, `routes/dashboard.js:338`) + 5 inline `'blocked'` checks (`run-view.js:232`, `task-page-loader.js:148` (new, LIN-3504), `dispatch-terminal.js:225`, `unanswered-decisions.js:71`, `observer-sweep.js:97`) + agent-status mapping `pipeline-loops.js:312`; banner unions `agentState === 'waiting'` (`dashboard.js:356`), clock reads feedback only (`run-view.js:226-243`); 3 staleness rules | 1 authority, 0 copies, 0 inline (LIN-3602); `render-session.js:80` `[pending]` regex; channel split unchanged (probe); 3 staleness families | 1 authority / 0 copies / 0 inline / 10 callers; divergent regex `render-session.js:81`; channel split holds (banner and clock 0-line diff); question cards read the authority | unchanged |
| `decision-stamp-classifier-copies` | low-medium | — | not recovered | — | — | — | — | `isDecisionLifecycleStampEntry` (`digest-feedback.js:86`) + 5 membership copies (`run-view.js:129`, `session-telemetry.js:60`, `wall-clock-summary.js:64`, `public/dispatch.js:1132`, `public/session.js:283`); parity test lists 4, not `run-view.js` | authority + 5 copies; drift test omits `run-view.js` | authority `digest-feedback.js:76` (10-18 cited `:86`) + 5 copies; drift test omits `run-view.js` | unchanged |
| `provider-write-field-contract` | low-medium | — | not recovered | — | — | — | — | GitHub inherits `ui.priority: true` (`providers/interface.js:250`) but `updateIssue` drops priority (`providers/github/index.js:834-854`); the proxy catalogue documents the drop | 0-line diff | `updateIssue` untouched (LIN-3626's `github/index.js` diff is `listUserInstallations` only) | unchanged |
| `close-out-merged-refusal-split` | low-medium | — | not recovered | — | — | — | — | "this PR is already merged" refuses the close-out *record* (`workspace-api.js:4631-4636`, LIN-3395) but the client enqueues first (`public/close-out.js:116` then `:128`); `closeOutRefusal` (`dispatch-factory.js:739`) does not check it; `run-evidence.js:102` decides "merged" from live PR state | order unchanged; merged ×2 sources; +head-moved readiness (LIN-3418): render-only at `ea96357a`; session lane refuses since LIN-3634 `ff479045`; press route and the other lanes still unchecked; `applyCloseOutState` ×2 edited in lockstep (LIN-3426) | head-moved: one predicate, one 409 body, 2 callers (session lane, press); proxy/recommend/kickoff unchecked (LIN-3417); merged ×2 sources; already-merged refused on the press only; **LIN-3379 merged-only reader vs merged∪partial `atMerge`**; repaint drops the reason; `applyCloseOutState` ×2; `headMoved` formula ×2 | improved (head-moved), held (merged), +1 reader |
| `periodic-loop-two-mechanisms` | informational | — | not recovered | — | — | — | — | leased `lib/scheduler.js` (5 jobs) beside the bare hourly `setInterval` (`server.js:4524`, `lib/hourly-cleanup.js`), which LIN-3424 made the only session sweeper | 5 jobs + hourly loop `server.js:4539` | 6 jobs (+`ci-wake-sweep`, `server.js:967`) + hourly `server.js:4586` | grew (+1 job); Stability |
| `consumer-liveness-signal-conflation` | resolved | — | — | — | — | — | — | — | the heartbeat bumps `lastUsedAt`, which feeds Rule S, the warnings and the kit's deferral; `lastPollOkAt` unread | both doors `touch:false` via one `tokenValidationOptions`; 2 `validateToken` sites; no second representation; residue: broker-token and feedback still touch (LIN-2883); `dispatch-integration.md:280` | **resolved** (LIN-3647) |
| `consumer-heartbeat-wire-restated` | low-medium (sub-row of 60) | — | — | — | — | — | — | — | field list ×4, schema ×2, interval bounds ×2, docs ×3; false "fails on either side" claim | field list ×4 (shape ×5; `HEARTBEAT_FIELDS` 0 production readers); schema ×2; path literals 3 → 5; bounds ×2 (shape ×3); false claim sites 2 → 4 | unchanged (path slightly worse) |
| `owner-answer-reader-copies` | low | — | — | — | — | — | — | — | G0172, 6 readers / 3 fail-closed styles; `isOwner` verbatim twin; account set vs `resolveAccountGroup` | 0 raw readers outside the home; 7 gates (+1 from LIN-3285); uniform fail-closed across 11 answer kinds; residue: 7 per-gate try wrappers, verdict→code map ×2, `accountIdsFor` vs `resolveAccountGroup` | **improved** (low-medium → low) |
| `mock-ai-builder-copies` | low-medium | — | — | — | — | — | — | — | lib home exists, 2 routes bypass it; mock stage choosers rank differently | `workspace-api-mocks.js` has 1 importer; copies at `proxy-compute.js:108,188` and `task-chat.js:56`; choosers still rank differently | unchanged |
| `fresh-run-definition-copies` | low-medium | — | — | — | — | — | — | — | 3 definitions + Mongo filter | 3 definitions + the Mongo filter + the factory gate's inline 5 clauses (`dispatch-factory.js:284-288`) | unchanged |
| `terminal-loop-rule-copies` | low-medium | — | — | — | — | — | — | — | G0021/G0052 across 6 files incl. `public/` | G0024 / G0056 unchanged; +1 consumer (the sweep, via `followUpForLoop` → the `chat-tools` copy) | unchanged |
| `state-type-label-rank-maps` | low-medium | — | — | — | — | — | — | — | ~11 maps; labels differ; finished set omits `duplicate` | 12 maps (0-line diff); finished set fixed (LIN-3656); terminal restatements 9 → 4 (browser only, G0072); **`duplicate` drawn ✓ / ✕ / ○** | mixed (1 clause resolved, 1 contradiction surfaced) |
| `csp-decision-split` | resolved | — | — | — | — | — | — | — | route CSP replaces the app CSP; email confirm pages lack `script-src` | LIN-3627 `e204e258`: email pages send `APP_CSP` (`email-auth.js:103`); skip-when-set documented as deliberate (`security-headers.js:88`), Library only | **resolved** |
| `priority-label-maps` | low | — | — | — | — | — | — | — | 7 maps, `'normal'` vs `'Medium'` | 7; `next-run.js:125` `'normal'` | unchanged |
| `localhost-predicate-split` | low | — | — | — | — | — | — | — | `startsWith` ×6 vs exact ×1 | `startsWith` ×6 vs exact ×1 | unchanged |
| `observer-instance-key-copies` | low | — | — | — | — | — | — | — | house-rule copies with stale tripwires (LIN-2481) | tripwires still wrong (`observer-pass.js:57`, `flight-companion-gate.js:10`) | unchanged |
| `pilot-eligibility-copies` | low | — | — | — | — | — | — | — | ×3, already differ | 0-line diff | unchanged |
| `linear-image-host-allowlist` | low | — | — | — | — | — | — | — | ×4 "keep in sync" | ×4 | unchanged |
| `page-chrome-options` | low | — | — | — | — | — | — | — | 14 routes pass the same options to `components/page.js` (G0007) | 14 sites / 13 files | unchanged |
| `ship-biscuit-desk-list` | low | — | — | — | — | — | — | — | 4 copies of the desk list; `DESKS` exported (G0361) | 4 | unchanged |
| `free-tier-rule-copies` | resolved | — | — | — | — | — | — | — | 3 rules: `chat-request.js:55-60`, `server.js:1030-1040`, `workspace-api.js:153` (G0002) | 3 named rules in one home; refusal block 11 → 1; G0002 gone (consolidated); residue `workspace-api.js:1325` and `surfaceFreeTier` ×2 | **resolved by consolidation** (low residue) |
| `sd-blocked-child-last-activity-split` | low | — | — | — | — | — | — | — | `reapers.js:1095-1105` vs `:1194-1215`; comment says "same" | `reapers.js` 0-line diff | unchanged |
| `census-gone-overstates-resolution` | informational | — | — | — | — | — | — | — | 28 gone = 9 left the code + 11 reshaped + 7 re-keyed + 1 noise | 7 gone = 2 left the code + 3 re-keyed + 1 reshaped and still duplicated + 1 reshaped noise | held |
| `follow-up-target-rule-copies` | low | — | not recovered | — | — | — | — | — | — | `ci-wake-sweep.js:52,309` vs `chat-tools.js:1245-1249`; private set shadows `dispatch-targets.js:33` | **new** (born, LIN-3661) |
| `lineage-row-read-copies` | low | — | not recovered | — | — | — | — | — | — | `ci-wake-sweep.js:240-255,277-283` vs `liveness-alarm-sweep.js:161-171,194-200` | **new** (born, LIN-3661) |
| `pr-url-regex-copies` | low | — | not recovered | — | — | — | — | — | — | 5: `github-pr-files.js:36`, `milestone-funnel.js:58`, `run-evidence.js:22`, `run-ledger.js:415` (exports `PR_URL_RE`), `ci-wake-sweep.js:54` | **new row** (4 pre-existing +1) |
| `pause-marker-predicate-gap` | low | — | not recovered | — | — | — | — | — | — | inline `marker === 'pending'` ×9 (8 at `ea96357a`), G0066; no `isPauseWakeMarker` | **new row** (pre-existing, grew via LIN-3513 / 3661) |
| `review-on-record-readers` | low | — | not recovered | — | — | — | — | — | — | `close-out-readiness.js:86-87` and `run-evidence.js:149-150` inline; `readRunLedger` keeps the old semantics | **new** (born, LIN-3497; borderline) |
| `credential-block-grammar-split` | low | — | not recovered | — | — | — | — | — | — | producer `public/runner-setup.js:33-46`; parser `runner.mjs:580-616`; tests pin a hand copy | **new** (deepened, LIN-3496) |
| `review-loop-ceiling-restated` | low | — | not recovered | — | — | — | — | — | — | `REVIEW_LOOP_CEILING` (`recommendation-facts.js:266`) + literal "ceiling of 5" (`openrouter.js:1833`) | **new** (born, LIN-3651) |
| `sweep-as-library-imports` | low (layering) | — | not recovered | — | — | — | — | — | — | `ci-wake-sweep → chat-tools` (`followUpForLoop`), `→ credential-invariant-sweep` (`resolveWorkspaceIdMapFromSessions`, 2nd importer); `connection-credential → providers/github/app-auth` | **new** (born; not a decision, so excluded from LIN-3490) |
| `github-envelope-walker-split` | low | — | not recovered | — | — | — | — | — | — | `walkInstallationPages` (`installation-pages.js:29-65`, LIN-3626) beside unchanged `walkRepoPages` (`client.js:84-98`); different end-of-list rule for an absent `total_count`; the divergence is commented as deliberate (`installation-pages.js:6-10`); found by the second-read | **new** (born, LIN-3626; excluded from LIN-3490 as a documented split) |

*Measured at `LinearViewer` `77704276` / `simple-dispatcher` `b43fdcaa`. Next run: re-ground every row against HEAD, not against this prose.*
- *Keep the census run (same command, same area guide) and the Tarjan walk; a single new SCC would be news.*
- *Re-check LIN-3672, LIN-3673 and LIN-3674 first, then the credential row and the CI-wake sweep.*
- *Watch items: LIN-2188's scenario declared real; the LIN-3339 channel ruling; whether LIN-3624 is corrected.*
