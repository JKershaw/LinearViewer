# C5: lessons and areas, wakes, the proxy surface, stores

*Routes A–D. Harbour main at commit 6f6c5d2. simple-dispatcher at its checkout HEAD cf6369d (wake delivery only). 18 Nov. Read by a census reader. Facts only. [checked] = I read the cited lines. [reported] = taken from a comment or doc, not followed into code.*

## A. Lessons and areas

**How it works today**
- The notes are Markdown files in `docs/areas/`, one per area slug, with `## Lessons` and `## Waiting` (docs/areas/README.md:30-44) [checked].
- `docs/areas/areas.json` lists 13 areas in order; first pattern match wins (README.md:10-14). 12 notes exist; `task-model` has none [checked: listing].
- No Harbour runtime code opens `areas.json` or a note; prompt text names the paths and the agent reads them in its checkout [checked: grep].
- Read: the "Area Notes" pointer (A06) goes to bug, plan, research, design, spike, review, implementation, scoping (stage-kinds.js:76-410); not blind read, surveys, triage (prompt-formatters.js:655-658) [checked].
- Written by agents through git on a PR branch: leftover step, close-out, audit, Periodical Stage 2 (README.md:74-84; A08-A15) [checked].
- Guarded by tests (A16-A18). At runtime, only the proxy's `Retires:` refusal (A09) [checked].
- Lessons now (my awk): runs-and-dispatch 6020, llm-and-prompts 6119 bytes, near the cap [checked: approximate].

**Sites**

| ID | Site | Role | What it does | Reached from |
|---|---|---|---|---|
| C5-A01 | docs/areas/README.md:1-114 | instructs | Format, writers (:74-84), guard checks (:93-114) | A06, A08, A12 |
| C5-A02 | docs/areas/areas.json | carries | 13 areas: name, slug, path regexes | A04 spells the path; A19, A20 load it |
| C5-A03 | docs/areas/<slug>.md (12 files) | carries | Lessons (rules) and Waiting (entries, each citing a file first) | Agents read and write them through git |
| C5-A04 | lib/prompts/area-registry-path.js:10-15 | carries | Spells `NOTES_DIR`, `REGISTRY_FILE`, `REGISTRY_PATH`. Opens no file | prompt-formatters.js:14; leftover-words.js:1; area-note-format.js:6; code-shape-lib.mjs:8 |
| C5-A05 | lib/prompts/area-note-format.js:1-30 | reads | One parse of a note's text: `NOT_NOTES`, `isCitedPath`, `parseNote`, `countWaiting`. It parses text it is handed | area-notes.test.js:20; scripts/stability-measures.mjs:33; dispatch-leftover-answer.js:28 |
| C5-A06 | lib/prompt-formatters.js:607-620 | instructs | Pointer: "Read docs/areas/README.md and the notes… Lessons bind how you work". Scoping gets its own variant (:617-620) | `GROUNDING_LISTS` :649 → `GROUNDING_BY_KIND` :661 → `appendGroundingSections` :682 → prompt-templates.js:283 |
| C5-A07 | lib/prompts/leftover-words.js:41,51,65 | instructs | `LEFTOVER_RULE` (where a leftover goes), `areaLookup`, `NOTES_PR`, `CONSEQUENCE_TEST` | A08, A10-A12, periodicals.js:6 |
| C5-A08 | lib/dispatch-leftover.js:132-155 | instructs | Leftover step: write notes, "add under `## Lessons`…" (:148), settle one waiting entry (:152) | B06 (server.js:1135) |
| C5-A09 | lib/dispatch-leftover-answer.js:102; routes/proxy-writes.js:414-425 | guards (proxy 422, not a test) | Refuses a `### Leftovers` comment with no valid `Retires:` line | Every proxy comment write |
| C5-A10 | lib/prompt-template-defs.js:730 | instructs | Review checks that the `Retires:` line names a waiting entry this diff removes | Review stage template |
| C5-A11 | lib/prompt-template-defs.js:814,833 | instructs | Close-out writes review's note entries into `docs/areas/<slug>.md` before the merge | Close-out template |
| C5-A12 | lib/prompt-template-defs.js:888,916 | instructs | Retrospective audit puts note-bound finds in one docs-only notes PR | Audit template |
| C5-A13 | lib/prompt-template-defs.js:1047-1078 | instructs | Blind read reads `areas.json` (:1074); not the notes (:1076, :1072) | :1014 |
| C5-A14 | lib/prompt-template-defs.js:486 | instructs | Scoping reads "the area notes below" | Scoping template |
| C5-A15 | lib/periodicals.js:124-135, 361-366 | instructs | Stage 2 writes Waiting or Lessons, mints no tickets (used :430…:998) | Periodical templates |
| C5-A16 | tests/unit/area-notes.test.js:23, 79-168 | guards | The five checks, plus one mutation each. Prints the Waiting counts | `npm run test:unit` |
| C5-A17 | tests/unit/lin-4377-area-notes-pointer-bytes.test.js:17-25 | guards | Pointer bytes, 386 | unit suite |
| C5-A18 | tests/unit/area-map-placement.test.js:108-114 | guards | Each registry reader imports the leaf (A04) | unit suite |
| C5-A19 | tests/unit/helpers/area-registry.js:1-8 | reads | Loads `areas.json` for the tests | A16, A18 |
| C5-A20 | scripts/code-shape/code-shape-lib.mjs:8-14 | reads | `DEFAULT_AREAS`: the code-shape kit loads the registry | scripts/code-shape/* |
| C5-A21 | scripts/stability-measures.mjs:33,47 | reads | Counts Waiting entries at two commits from git objects | Stability Periodical [reported] |

## B. Wakes

**How it works today**
- A wake is a follow-up dispatch row addressed to an item id (`followUpTo`). Nothing else exists. The address is always a session lineage, never an area or a lane name [checked: B02, B07, B10, B14].
- Up-chain: a child's feedback carrying `[done|complete|failed|aborted|blocked|pending]` (lib/dispatch-terminal.js:69) makes `buildWakeFollowUp` address the parent, `followUpTo: child.sessionId` (lib/dispatch-wake.js:228-237). A wake never makes another wake (:190) [checked].
- The effect is at `addFeedback` (B03): once per item by CAS, never to a stopped parent [checked].
- Same-session resumes: leftover step (B06), CI wake sweep (B07), both via `enqueueFollowUp` [checked].
- Scheduler: seven jobs are registered (server.js:902-1161). Only `ci-wake-sweep` enqueues work [checked: grep of observer-sweep, observer-pass and liveness-alarm-sweep. The other three get no dispatch store].
- Periodicals have no Harbour timer. `periodical-runs.js` "computes NO trigger and dispatches NOTHING" (:5-7) [checked].
- simple-dispatcher maps `followUpTo` to a session by `rootItemId`/`itemId` (followup.js:34-53), then signals a held session or `--resume`s (B15) [checked].

**Sites**

| ID | Site | Role | What it does | Reached from |
|---|---|---|---|---|
| C5-B01 | lib/dispatch-terminal.js:69, 642 | carries | Wake marker regex; `findWakeEvent` returns the last marker | B02, B03 |
| C5-B02 | lib/dispatch-wake.js:170-238 | wakes (pure) | Builds the parent-addressed descriptor. Abort rows (:183) and wake rows (:190) are skipped, as is an autopilot child's pending (:215) | dispatch-store.js:3796 |
| C5-B03 | lib/dispatch-store.js:4060, 3691, 3839-3860, 3290-3298 | wakes | addFeedback → plan → deliver (stopped-parent gate :3854) → mint (CAS on `terminalWakeItems`) | B04, B05 |
| C5-B04 | routes/dispatch.js:1603-1650 | wakes | `POST /api/dispatch/feedback/:itemId`: simple-dispatcher's markers, with the leftover wakeHook | simple-dispatcher feedback.js |
| C5-B05 | routes/proxy-runner.js:195-228 | wakes | `POST /api/proxy/runner/feedback/:id`, which needs the `take` grant (via `requireStageWrite('runnerFeedback')`) | Runner kit |
| C5-B06 | lib/dispatch-leftover-hook.js:83; server.js:1135; dispatch-store.js:3386, 3493 | wakes | Build `[done]` → `leftover` follow-up to its own session; parent wake held, then released | B03 wakeHook |
| C5-B07 | lib/ci-wake-sweep.js:1-30, 185; server.js:1098, 1104-1124 | wakes | Every 5 min: a parked worker whose PR checks settled gets one follow-up | scheduler |
| C5-B08 | lib/scheduler.js:90; server.js:902-1161 | carries | A leased job runner (CAS lock per job) | server boot |
| C5-B09 | lib/periodical-runs.js:1-10, 311; routes/proxy-compute.js:1012; routes/proxy-dispatch.js:310 | shows | Folds due state for `GET /api/proxy/periodicals`. The mint route is called by an agent holding the `dispatch` grant | Runner or agent [reported: runner.md] |
| C5-B10 | public/observation.js:3460-3470, 3523, 3682; public/common.js:1040, 1106 | wakes | Ruling reply: `resumable` → follow-up to `anchor.loopId`; `gone` → fresh dispatch or record | A person |
| C5-B11 | routes/dashboard-rulings.js:272-277 | ends | Task-bound answer route. Stamp only: "starts no run, and resumes nothing" | Rulings UI |
| C5-B12 | lib/shelved-rulings-store.js:11-16 | shows | When the shelf lapses, the decision is back in the next feed read. Nothing fires | `collectUnansweredDecisions` |
| C5-B13 | routes/flight-companion.js:823, 855; routes/dashboard.js:532, 569; lib/follow-up-dispatch.js | wakes | A person approves a follow-up or applies a proposal; this resumes that session | A person |
| C5-B14 | routes/proxy-dispatch.js:252, 281-286; lib/dispatch-factory.js:235, 1281 | wakes | A `dispatch`-grant token may send `followUpTo` = any item id; checks found: stopped run (:235), anchor read by `urlKey` (:1281) | Agent via proxy |
| C5-B15 | simple-dispatcher dispatcher.js:788, 870-910, 1000; followup.js:34; hook.js:963 | wakes | `queueIfBusy` leaves the item unclaimed. Signal writes the prompt into a session held at Stop (`AWAITING_FOLLOWUP`). Otherwise `--resume` | queue.js poll |

**Sideways or per-area wakes:** none built for it. The nearest is B14, where an agent addresses any item id in its workspace by hand. No code addresses a wake to an area [checked: grep, not exhaustive].

## C. The proxy surface

**How it works today**
- `createProxyRoutes` (routes/proxy.js:479) gets every store at server.js:3282 and mounts sub-routers `router.use(createXRoutes({deps}))` (:1298-1648) [checked].
- Token row: `urlKey`, `scope` read/readWrite, `kind` standard/bootstrap, `singleUse`, `createdBy`, `grants`, `parentTokenId`, `workspaceId`, `writes`, `writesTarget` (lib/proxy-tokens.js:7-24). Only the hash is stored [checked].
- Bootstrap tokens are single-use and work only for the exchange, which mints a working token (lib/proxy-tokens.js:31-36, 495). Lifetimes: worker 48h/48h, runner 1h/24h (lib/proxy-scopes.js:52-55) [checked].
- Grants are `take` and `dispatch` (proxy-scopes.js:25-28), enforced by `requireGrant` (lib/require-grant.js). Revoking a grant-bearing token deletes its root and children in the workspace (lib/proxy-tokens.js:903-935) [checked].
- Write gate: `requireWriteScope(op)` checks readWrite plus the stage allowance for an op in `STAGE_WRITE_OPS` (lib/stage-write-gate.js:47; lib/stage-writes.js:61-70). An unknown op throws at mount (stage-write-gate.js:20) [checked].
- Audit and rate limit: C08, C09 [checked].
- New endpoint: a factory in `routes/proxy-<x>.js` taking `{proxyLimiter, authenticateProxyToken, requireWriteScope, logEvent, <store>}`, mounted in routes/proxy.js, store passed from server.js:3282; a write op added to stage-writes.js; documented in lib/proxy-instructions.js and docs/proxy-integration.md (:498); tests per C13 [checked: headers].

**Sites**

| ID | Site | Role | What it does | Reached from |
|---|---|---|---|---|
| C5-C01 | routes/proxy.js:479; server.js:3282 | carries | Composer and its store injection | boot |
| C5-C02 | routes/proxy.js:529-612 | guards | Bearer → `validateToken` → `req.proxy*` (:592-604); 401 on reject | every consumer route |
| C5-C03 | lib/proxy-tokens.js:692-767 | reads | `validateToken`: consumes single-use tokens, refuses bootstraps, returns the caller fields | C02 |
| C5-C04 | lib/proxy-tokens.js:317, 395, 495, 935 | writes / ends | `createToken`, `mintGrantBootstrap`, `exchangeBootstrapToken`, `revokeToken` (lineage) | preamble, admin, exchange routes |
| C5-C05 | lib/proxy-scopes.js:16-55 | carries | Scopes, grants, lifetime profiles (a leaf) | C03, C04, require-grant.js |
| C5-C06 | lib/stage-write-gate.js:47, 56; lib/stage-writes.js:61-70, 143 | guards | Op-named write gate. Only a restricted stamp is written on a token (`stampMintOptions`) | write mounts |
| C5-C07 | lib/proxy-preamble.js:508-512, 681-693; lib/wake-credential.js:118; routes/dispatch.js:1533 | writes | Dispatch mints with a per-site label: `dispatch-bootstrap`, `wake-bootstrap`, `refire-broker` | dispatch entrance, wake, refire |
| C5-C08 | routes/proxy.js:897; lib/proxy-events.js:6-34 | writes | Audit row: urlKey, tokenId, tokenLabel, method, endpoint, status, note, stage | every handler |
| C5-C09 | routes/proxy.js:247-268 | guards | 60/min per proven credential, else per IP; off in test | most consumer routes |
| C5-C10 | routes/proxy.js:1318-1345; lib/proxy-instructions.js | instructs | `GET /api/proxy/instructions` from scope, grants, `writes` | agents |
| C5-C11 | routes/proxy-writes.js:134-151 | carries | `SPEC` table of ticket writes; `writeAuth(op)` per mount | C01 |
| C5-C12 | lib/dispatch-factory.js:433-444 | carries | `ownershipFilterOf`: a runner token owns the rows it took (`takenByTokenId`) | runner take/feedback |
| C5-C13 | tests/unit/proxy-endpoint-inventory-witness.test.js:1-40; proxy-di-witness.test.js:1-30; lin-4468-stage-write-allowance.test.js:423; proxy-instructions.test.js | guards | Route resolution, mount deps, write allowance, catalog text | unit suite |

## What a proxy request knows about its caller

- Workspace: `req.proxyUrlKey` always. `req.proxyWorkspaceId` only on grant-bearing tokens, else null (routes/proxy.js:593, 601; lib/proxy-tokens.js:760-765) [checked].
- Token: `req.proxyTokenId`, `req.proxyTokenLabel`, `req.proxyTokenScope`, `req.proxyTokenGrants` (routes/proxy.js:592-598) [checked].
- Person: `req.proxyCreatedBy`, the account that minted the token or owns the dispatch. Null on ownerless tokens (routes/proxy.js:596; lib/proxy-preamble.js:669-676) [checked].
- Stage: only through `req.proxyWrites`, and only for restricted stamps (none, one-comment, blind-comment, ticket-fields). A `work` stage (implementation, review, close-out…) carries null (lib/stage-writes.js:98-101, 143-146) [checked].
- Task: only `req.proxyWritesTarget`, on restricted stamps [checked, same lines].
- Dispatch id: not carried. No item id on the token row (lib/proxy-tokens.js:7-24); labels are per site (C07); no custom header read (grep: none). Runner routes take the item id in the URL (routes/proxy-runner.js:54-55) [checked].
- Lineage: `parentTokenId` links a working token to its bootstrap. It is not set on `req` (lib/proxy-tokens.js:17) [checked].

## D. Stores

**How it works today**
- `class XStore { constructor({ collection }) }`, given a `db.collection()` (lib/local-store.js:4-7, 60-67) [checked].
- `db` is MongoDB when `MONGODB_URI` is set, else MangoDB in `HARBOUR_DATA_DIR` or `./data` (server.js:317-322). Indexes are declared in lib/db-indexes.js:106 and built at boot (server.js:330) [checked].
- Local store: one collection, `local-issues`, with `kind` 'issue' or 'project', partitioned by `scope` = urlKey. Every write keys on `{_id, scope}` and uses `$set` only (lib/local-store.js:9-31) [checked].
- Each store is built once in server.js and passed down (e.g. server.js:449-450, 659-707). The proxy receives stores through C01 [checked].
- Tests: mock collections (tests/fixtures/mock-collection.js; inline `createMockCollection` in 61 files) or real MangoDB in a tmpdir (tests/fixtures/mango-tmpdir.js, 46 files; its :4-7 says doubles pass `$or`/`$exists` vacuously) [checked: grep counts].

| ID | Site | Role | What it does | Reached from |
|---|---|---|---|---|
| C5-D01 | lib/local-store.js:1-67 | carries | The `kind` + `scope` single-collection pattern | server.js:450; local provider |
| C5-D02 | server.js:317-330; lib/db-indexes.js:106 | carries | Client choice, db, boot indexes | boot |
| C5-D03 | server.js:449-450, 659-707 | writes | Store construction (local, task-decisions, shelved-rulings, run-proposals…) | boot |
| C5-D04 | lib/*-store.js (35) | carries | pr-state-store.js has no collection (module cache, :55-67); session-store.js is an express-session Store (:1-12) | — |
| C5-D05 | tests/fixtures/mock-collection.js; tests/fixtures/mango-tmpdir.js:1-30 | guards | Mock and real-engine test harnesses | unit tests |

## Corrections to the inventory

- **General: "35 stores … each its own collection".** The count of 35 holds. The rest is corrected: pr-state-store.js has no collection, and session-store.js is an express-session Store (D04) [checked].
- **General: local-store quote, versions.** Hold (lib/local-store.js:9-10; task-snapshot-store.js:2; model-routing-store.js:3) [checked]. Links: not opened.
- **E9.** Holds. The format is in README.md:30-44. The guard is area-notes.test.js. The pointer-bytes test is lin-4377 (:17-25). Add: the proxy's runtime `Retires:` refusal (A09). "Rules in code comments": [reported], not checked.
- **E13: "read by `area-registry-path.js:13`, the prompt templates and `cost-read-calls.js`".** Corrected. area-registry-path.js:13 only spells the file name (`REGISTRY_FILE`). cost-read-calls.js:13 is a comment. The templates only name the path for the agent (A06, A13). The code that loads the file is scripts/code-shape/code-shape-lib.mjs:14 and tests/unit/helpers/area-registry.js. Harbour itself never reads it at runtime. The settings-areas distinction holds (lib/settings-areas.js:2) [checked].
- **E14.** Up-chain push holds (B02-B03), and so does `ci-wake-sweep` (B07). Corrected: `periodicals.js` is not a scheduler job, and no Harbour timer dispatches periodicals (B09). "An answered ruling resumes its loop" holds for loop-backed rulings, but it is the browser's follow-up dispatch (B10); the server answer route resumes nothing (B11). The shelved re-surface is a feed filter, not a wake; nothing fires (B12). Missing from E14: the leftover step (B06), person follow-ups (B13), and agent `followUpTo` through the proxy (B14) [checked].

## Loose ends

- B14: whether `followUpTo` is checked against the caller's lineage beyond the two factory lines. Not followed through `createDispatchItem` in full.
- Not opened: the job bodies of credential-invariant, pricing-conformance and kpi-daily-rollup. I judged them from their injected deps only.
- simple-dispatcher keeps its own copy of the notes guard (area-notes.test.js:11). Not read.
- The retro template's "Lessons & suggestions" (prompt-template-defs.js:963) is a comment section, not the area notes.
