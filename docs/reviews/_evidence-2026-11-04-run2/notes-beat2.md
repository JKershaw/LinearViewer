# LIN-4232 beat 2: seams and unlisted scope (notes, uncommitted)

All citations were read at LinearViewer `d7ceb373` and SD `d8d186c`, which are unmoved since beat 1. These are notes, not report prose. Deltas are against the 11-04 edition.

## 1. `usage-relay-flag-partial` and LIN-4214: **resolved in code**

**The gate.** `request-usage-flush.js:114` reads `if (!WORKER_USAGE_RELAY) return NOTHING;`. It is the first statement of `flushRequestUsage` (`:98`) and runs before any read or post. The flag is imported at `:28`, from `config.js:1345` (`envFlag('SD_WORKER_USAGE_RELAY', true)`).

**The five seams.** `dispatcher.js` and `reapers.js` are unchanged in the window (0-line diff). Each seam now reaches the gate through `flushRequestUsageDetached` (`:281`) → `flushRequestUsageSafely` (`:270`) → `flushRequestUsage`:

| seam | call site | path |
|---|---|---|
| fail | `dispatcher.js:478` | `flushRequestUsageDetached(… reason:'fail')` |
| abort-cancel | `dispatcher.js:651`, through the injected default at `:616` (`flushUsage = flushRequestUsageDetached`) | same |
| forced-resume cancel | `dispatcher.js:1175` | same |
| stall | `reapers.js:2834`, default at `:1894` | same |
| reap | `reapers.js:3999`, default at `:3989` | same |
| Stop | `hook.js:1827` (`flushRequestUsageSafely`) | same function |

**Paths that skip the check.** I searched every non-test SD file for the endpoint, the posters and the old snapshot names (`dispatch/usage`, `postRecordsWithLedger`, `flushOpencodeRequestRecords`, `relayRequestRecords`, `flushRequestUsage*`, `postUsage*`, `kind:'usage'`).
- The URL is built in one place: `request-usage-flush.js:171`, inside `postRecordsWithLedger` (`:141`).
- `postRecordsWithLedger` has two callers:
  - `flushRequestUsage` (`:128`, gated);
  - `flushOpencodeRequestRecords` (`:256`), which has no gate of its own. Its only caller is the opencode `postRequestRecordsFn` default (`opencode-runner.js:802`, `:1097`), and that is reached only through `relayRequestRecords`. `relayRequestRecords` returns at `:591` when `!workerUsageRelay`, and `workerUsageRelay` defaults to the same constant (`:801`, `:1095`). Its five call sites (`:929`, `:1292`, `:1596`→hold, `:1723`, `:1751`) all pass `workerUsageRelay`.
- **No path posts a record without passing a flag check.**
- **Residual exposure.** `postRecordsWithLedger` and `flushOpencodeRequestRecords` are exported ungated (`:285`). A future caller would bypass the switch, and no census pins that.

**LIN-4214 acceptance:**
- (1) "With the flag off, the fail, abort-cancel, forced-resume-cancel, stall and reap seams post no `POST`". **Met by construction**, since all five reach the one gate. "One test drives each seam with the flag off … fails if a seam's gate is removed": **not met as written**.
  - The landed tests are `test/worker-usage-relay.test.js:85` ("flag OFF: a reap-seam flush posts no request record"), which calls `flushRequestUsage` directly with `reason:'reap'`, and `test/worker-usage-default.test.js:54` (Stop with the flag at 0).
  - No test drives `dispatcher.js`'s fail or cancel seams or the `reapers.js` stall seam with the flag off.
  - With one chokepoint there is no per-seam gate to remove. The LIN-4203 mutation check deleted the chokepoint line and two tests went red, so the spirit holds for the chokepoint. A seam re-pointed at an ungated export would not be caught.
- (2) Flag-on behaviour unchanged: **met.** I ran `test/worker-usage-relay`, `worker-usage-default`, `request-usage-terminal`, `request-usage-wiring` and `lin-4202-opencode-records`: 54 pass, 0 fail.
- (3) The comments at `config.js:1338-1344` and `hook.js:1859` are true as written: **met**, rewritten by `44ab30e` (`config.js:1335-1344`, `hook.js:1823-1825`). Small leftover: the `request-usage-flush.js:3-8` header still says "Three callers" (Stop, reap, cancel) and omits fail and stall. That text predates the window and is still inaccurate.
- **Ticket state:** Backlog, 0 comments, unchanged. Neither the LIN-4203 nor the LIN-4195 close-out names it. I did not alter it.

**LIN-4195's "L1 (relay flag off) is closed".**
- The description is unedited. Its evidence is the default (`config.js:1345` `envFlag(…, true)`, LIN-4127). That was about the flag defaulting on, not about what "off" does, which is why the 11-04 reading found it false.
- At HEAD, "off" now posts nothing from any seam, so the statement **matches source**. But it matches because piece 6 landed, not for the reason the description gives.
- The 17:07 comment is the accurate record: "now gates every record flush at one chokepoint (`flushRequestUsage`). Previously the fail, cancel and reap seams flushed records with the flag off (the drift review's `usage-relay-flag-partial`) … a kill switch, not a rollback to snapshots".
- So the description and the comment agree on the end state, and the comment admits the gap was real when the description was written.

**Verdict: resolved** (LOW-MEDIUM → resolved). The code matches its docs. Two residuals are carried into the report as text, not new rows: LIN-4214 is open with acceptance (1) only partly met, and the posters are exported ungated.

## 2. `runner-contract-semantics-cross-repo`: **unchanged (MEDIUM)**

- **Row counts:** `lib/runner-kit/contract.json` has **38 rows** and SD `test/fixtures/runner-contract.json` has **34**. Both have 0-line diffs in the window. **Neither has a usage row** (JSON-parsed; no row mentions usage). The four `store` rows are still unpinned (files unchanged).
- **The two usage endpoints** still have no row: `routes/dispatch.js:1668` (`POST /api/dispatch/usage/:itemId`, `feedbackLimiter, authenticateDispatchToken`) and the kit's `runnerUsage` at `runner.mjs:901` (`POST /api/proxy/runner/usage/:id`).
- **The `[usage]` snapshot post is gone from the kit.**
  - `runner.mjs:1269-1272` posts records only. `sumTranscriptUsage` and `usageMessage` are deleted.
  - `docs/runner-prompt.md:180-183, :191` describe records only. The `[usage]` example line and "`[usage]` is `kind: usage`" are removed.
  - The SD side refers to the snapshot only in the past tense: `config.js:1337`, `docs/module-map.md:93,149-150`, README `:202`.
  - So item 5 of the 11-04 wire list (two vocabularies on the wire, a deliberate bridge) is now resolved.
- **The 404 divergence is unchanged.** SD claude-code resends (`postRecordsWithLedger` with `stopOnNotTaken = false`, `request-usage-flush.js:154,196`); opencode stops (`:260`); the kit stops (`runner.mjs:679`).
- **Caps.** The cap is restated three times, now with pins I confirmed:
  - kit `USAGE_RECORDS_PER_CALL` (`runner.mjs:656`) = intake `USAGE_MAX_RECORDS_PER_CALL` (`request-usage-intake.js:36`), pinned by `tests/unit/lin-4202-runner-kit-records.test.js:162`;
  - SD `MAX_RECORDS_PER_POST` (`request-usage.js:22`) is pinned to a literal 100 by `test/request-usage-ledger.test.js:18-19`;
  - no cross-repo pin. The 11-04 edition left this "unconfirmed"; it is now confirmed, and the code is unchanged.
- **Record fields:** the kit still sends `effort: null` (`runner.mjs:717`) and no `lane`. SD claude-code sends `lane` (`request-usage.js:154`). This is now less consequential, because nothing on Harbour reads a record's `lane` (item 3).
- **Behaviour shift (documented):** with no readable transcript the kit now posts nothing, where it used to post a harness-only snapshot. The item reads "no reported usage", not "unpriced" (`runner-prompt.md:182-183`). Documented, so noise.
- **Verdict: unchanged (MEDIUM).** One sub-item resolved (snapshot bridge); the gaps that made the row MEDIUM (no rows, 404 split, unpinned store rows) are untouched.

## 3. `usage-record-vocabulary-two-readers`: **improved**

- **Token fields have one Harbour home:** `lib/request-usage-vocabulary.js:15-21` (`USAGE_TOKEN_FIELDS`).
  - Importers: `request-usage-store.js:53` (which re-exports to `request-usage-intake.js:29`), `row-usage.js:1`, `session-telemetry.js:49` (`USAGE_NUMBER_FIELDS = USAGE_TOKEN_FIELDS`, at `:391`), and `scripts/lin-4200-measure-records-vs-snapshots.mjs:44`.
  - The kit keeps a standalone copy, `TRANSCRIPT_TOKEN_FIELDS` (`runner.mjs:567`), pinned equal by `tests/unit/request-usage-vocabulary.test.js`.
  - The census agrees: the old token-set group `G0153` (store, row-usage, kit, session-telemetry) is gone, and the new `G0339` spans only `request-usage-vocabulary.js` and `runner.mjs`.
- **The lane list is declared once:** `USAGE_LANES` (`request-usage-vocabulary.js:28`). The closed set is used only by the snapshot parser (`session-telemetry.js:434`). The record intake keeps lane open (`request-usage-intake.js:41` takes any string ≤ 200 characters).
  - The split is now **documented as deliberate in the owner module** (`request-usage-vocabulary.js:23-27`: "Only the closed set is shared"), so it is no longer an undocumented two-reader split.
  - **Nothing reads a record's `lane`.** It is stored (`request-usage-store.js:139`) and has no consumer in `lib/`, `routes/` or `public/`. The only lane consumer is the snapshot parse into `observation-sessions-store` telemetry, so new runs carry `lane: null` there. The open set has no reader to diverge from. This is latent, not a drift cost today.
- **`usage-snapshot-intake.js` is a deliberate bridge, not a second reader.** It counts legacy posts per workspace per UTC day (`:27-34`) and parses no fields. It is called from `dispatch-store.js:3732-3738`, best-effort.
  - Sunset: the legacy *fold* it serves is marked "Delete 30 days after LIN-4203 deploys (not before 2026-12-04)" (`row-usage.js:24-26,89-91`, `cost-read.js:108-110`).
  - The counter itself has no removal line. I found no ticket for the dated deletion among LIN-4195's children; I did not search the whole workspace.
- **SD against Harbour, cross-repo.**
  - Names match: SD `TOKEN_FIELDS` (`request-usage.js:13-19`) has the same five names. opencode's `OPENCODE_RECORD_TOKEN_FIELDS` (`opencode-request-records.js:22`) is a four-name subset, documented (no 1h tier).
  - Lane values from SD are `api`/`subscription` (claude-code) and `openrouter` (opencode, `:46`), all inside `USAGE_LANES`.
  - Nothing pins SD's copies to Harbour's list.
- **Verdict: improved.** Token-field restatements went from 3 per repo plus the kit to Harbour 1 + kit (pinned) + SD 2 (unpinned). Lane is declared once and the split is documented. What remains is the cross-repo copy with no pin, part of the contract row.

## 4. `lineage-identity-read-twins`: **resolved**

- `lib/founder-lookup.js` was deleted in `2ee4e600` (LIN-4201, "scope item 3").
- Its batch-by-urlKey loop now lives in `dispatch-store.js:330-356` (`lineageIdentityOfRows`). The query itself is **one implementation**, `findLineageIdentity` (`dispatch-store.js:311-318`), and it carries the bounded-read guard (`assertBoundedHistoryRead`, `:312`).
- Both entrances route through it:
  - the store method `lineageIdentityRows` (`:2017-2039`), which maps faults to `DispatchStoreFault`;
  - `lineageIdentityOfRows` (`:351`), used by `server.js` (`lineageIdentity:` injection) and `workspace-kpi-stats.js`.
- The fault-mapping difference stays, and it is now deliberate and documented (`:303-305`, "the KPI path lets them reach its caller as they did before").
- The import graph agrees: the 4 `founder-lookup` edges are gone, replaced by `workspace-kpi-stats → dispatch-store` and the server wiring.
- **Verdict: resolved**, by consolidation into the store, not by moving a copy elsewhere.
- Knock-on: `lineage-anchor-rules-three`. 11-04 counted 4 (three anchor rules plus the founder read). The founder read is now the store's own query, so it is **back to 3** (`anchorOf` `lineage-membership.js:27`, `anchorFor` `dispatch-lineage-status.js:69`, `groupAnchorFor` `dispatch-store.js:367`). Improved against 11-04, unchanged against 11-03.

## 5. Other 11-04 rows

- **`cost-fold-partition-restated`: resolved.**
  - The partition is stated once, in `countedRowsOf` (`row-usage.js:80-101`, doc at `:80-84`: "The ONE statement … neither restates it (LIN-4201)").
  - `cost-read.js:88` calls it (`missingCanChangeFigure`, `:80-100`), and `:225,241` use it for `deltaSummed`. The fold census `cost-read-census.test.js` names `countedRowsOf`'s permitted importers.
  - Related borderline: the **completeness precedence** (unreadable > unpriced > complete) is written in `row-usage.js:116-118`, `cost-read.js:171-174` (`combineFolds`) and `request-usage-fold.js:103` (no unreadable state there). This is census table group `completeness == 'complete'`, which grew to 3 files. Each fold has its own state set and `combineFolds` composes two, so I rule it **borderline**, not graded.
- **`reap-window-constant-cross-repo`: unchanged.** SD `config.js` window hunks are at `:1333`/`:1341` only; `:586-598` is unchanged. `lib/unanswered-decisions.js` has a 0-line diff.
- **`task-page-state-outside-owner`: unchanged.** `render-task-page.js` and `public/task-page.js` have 0-line diffs.
- **`vendor-script-list-restated`: unchanged.** `vendor-assets.js` has a 0-line diff, and no `scripts:` line changed in any `lib/render*.js`.
- **`key-state-residue`: held (informational).**
  - The new cache joined the holder registry: `key-state-holders.js` registers `workspace-kpis-cache` with clear and probe, and `tests/fixtures/key-state-census.json` was updated.
  - `routes/test.js:686,700` add `clearWorkspaceKpis(urlKey)`, but only on the two *rollup-write* seams (`/test/seed-kpi-rollup`, `/test/clear-kpi-rollup`). That is cache invalidation after a data write, not a side reset that duplicates `resetKey`. Not residue.
- **`unit-census-convention-split`: unchanged (informational).** The window extended existing censuses (`cost-read-census`, `key-state-census.json`, `lin-3384-redaction-census`, `area-map-placement`) and added one equality pin (`request-usage-vocabulary.test.js`). No new allowlist shape.
- **`routes-error-envelope-fragmentation`: unchanged** (275; per-file identical; beat 1).
- **`cache-module-family`: worsened (+1; row ungraded "—").**
  - **8** `lib/*-cache.js` at HEAD against 7 at `5334c81a`; the addition is `workspace-kpis-cache.js`.
  - It is a **second keyed stale-while-revalidate + single-flight cache**: `workspace-kpis-cache.js:28-60` beside `sessions-feed-cache.js:35-95` (keyed, SWR, single background refresh).
  - It names `lib/kpi-page.js:26-47` (the global, unkeyed SWR) as its model ("the same as lib/kpi-page.js", `:10`) and imports only `KPI_CACHE_MS`.
  - So the SWR rule (fresh / stale-serve-and-refresh / cold-await / keep-last-good) is now written three times.
  - Cost: a change to that rule, such as the LIN-3703 death-spiral fix that kpi-page carries, must be made in each copy.
  - It follows the family's convention (factory function, clock injection, `clear({urlKey})`) and the key-state registration, so it forks the logic rather than the shape.
  - Candidate: **LOW**, as a graded sub-row or just the row's delta. To decide in beat 3.

## 6. Headline rows by diff

The cited files all have 0-line diffs in the window (beat-1 `stale-ground.txt`), so the cited lines are byte-identical and say what 11-04 said. Confidence in these "unchanged" readings is **high for the code** (identical bytes) and says nothing about runtime frequency.

| row | files | state | reading |
|---|---|---|---|
| `resume-model-effort-cross-repo` MEDIUM-HIGH | `dispatch-factory.js`, `follow-up-dispatch.js`, SD `harnesses.js` | untouched | `:635-646` / `:1181` / `harnesses.js:598-605` as 11-04; LIN-4156 Backlog, 0 comments |
| `credential-decision-multiplicity` MEDIUM-HIGH (borderline) | `errors.js`, `workspace.js` | untouched | anchors `workspace.js:372`, `errors.js:374` as 11-04; LIN-3822 Backlog |
| `halt-poll-cold-cache-fail-open` MEDIUM (conditional) | `poll-halt.js`, `workspace-halt.js`, SD `dispatcher.js`; kit `runner.mjs` touched | untouched on the cited lines | kit `haltAction` still `runner.mjs:223-226` (the window diff is usage-only: `:18,:31,:563-769,:1266-1272`); LIN-4210 Backlog; ruling John's (LIN-3024), not chosen |
| `halt-word-map-copies` MEDIUM | `render.js`, `render-settings-workspace.js`, `settings-areas.js`, `workspace-change-log.js` | untouched | ×4 as 11-04; LIN-4157 |
| `home-next-answer-split` MEDIUM | `home-view.js`, `task-order.js`, `providers/state-map.js` | untouched | `home-view.js:33`, `task-order.js:163`; LIN-4158 |
| `run-page-identity-scrape` MEDIUM | `public/session.js` | untouched | `:453,455,576` |
| `coherence-loop-stalled` MEDIUM (process) | (process) | unchanged, with one new datum | no Drift follow-up moved. **LIN-4214's finding was fixed by its owner's ticket (LIN-4203) without the loop ticket being touched**: the loop ticket is now stale *behind* the code. That is the opposite failure to "unmoved" and the same cause: the loop's tickets are not where owners look. |

## 7. Unlisted in-remit scope

**SD heavy-tier test harness** (LIN-4219 to 4224, 4187): **one-owner consolidations, each with a census guard; record as held/improved, no Drift row.**
- `childEnv(mode)`, `test/child-env.js:91`, guarded by `child-env-census.test.js` (six tracked names, owners listed).
- `stopGroup` / `stopGroupSync`, both in `test/system/harness/stop-group.js:61,76` (one owner, a sync twin for `reap.js` in the same file, shared constants), guarded by `harness-kill-census.test.js`. Its 5 allowlist entries are reasoned: the two `process.kill(-…)` unit tests test production group kills.
- Ports in `test/system/harness/ports.js` (OS-assigned, `FIXED_PORTS = {}`), guarded by `ports-registry.test.js`.
- Exit codes in one `exit-codes.js`; `npm run test:baseline` (`package.json:13`).
- `system-contract-census` (LIN-4187): 27 of 27 system scenarios carry a Harbour-contract note.
- No decision held in two places found.

**Guide edit** (`areas.json`, LIN-4201): census effect −2 table and 0 mustRule (beat 1).
- `lib/usage-snapshot-intake.js`, added later by LIN-4203, **has no home**. It falls to the catch-all "Other features" (checked by resolving the HEAD guide).
- `task-cost|` is still in the "Runs & dispatch" pattern (`areas.json:24`), matching nothing.
- Both are map hygiene → **Seams hand-off**, not Drift.

**Runner kit** (`runner.mjs`): the usage path only (diff hunks listed above). No halt, marker, heartbeat or vocabulary change. Seams N8's stale `lib/task-cost.js` comment at `runner.mjs:768` was **removed** by LIN-4203.

**Prose that still describes the retired snapshot as live.** Candidate new row, **LOW**: `usage-snapshot-prose-residue`.
- **User-visible:** `lib/effort-readout.js:596`, the effort page's `harnessModelRows` disclosure: "the values the run itself stamped on its [usage] telemetry". New runs post no `[usage]`; the values now come from the record fold's labels (`cost-read.js:183`).
- **Agent-facing:** `lib/proxy-instructions.js:385-387` (the proxy catalog): "cumulative worker usage snapshots would otherwise be multiply-counted".
- **Docs:** `docs/proxy-integration.md:1238-1240`: "reports a *cumulative* usage snapshot on every Stop". The file was touched by `d7ceb373` at `:1196` and this line left.
- **Comments:**
  - `effort-readout.js:58-59`, `model-routing-spend.js:5-6,58` ("posted no [usage]"), `request-usage-vocabulary.js:4` ("the per-lineage snapshot a runner posts"), SD `request-usage-flush.js:3-8` ("Three callers").
  - All the Harbour ones are in files LIN-4201 touched.
  - The Seams N8 `lib/task-cost.js` comment residue went from 3 to 2: `model-routing-spend.js:5` and `wall-clock-summary.js:97` remain.
- `docs/runner-prompt.md`, SD `docs/module-map.md`, README and `config.js` are **clean**.
- Comment hygiene was handed to Drift by Seams run 5; the docs and catalog lines sit with Documentation by default. Cost: an operator reading the effort disclosure, or an agent reading the catalog, is told how a retired path works.

**Window file coverage.**

LinearViewer, 33 production files:
- **Records-first cutover cluster** (29). Rows: `usage-record-vocabulary-two-readers`, `cost-fold-partition-restated`, `lineage-identity-read-twins`, `cache-module-family`, `usage-snapshot-prose-residue`; otherwise plumbing.
  - Cost core: `cost-read`, `request-usage-{fold,intake,loader,store,vocabulary}`, `row-usage`, `session-telemetry`, `terminal-marked-task-cost`, `usage-snapshot-intake`.
  - Readers threading `requestRows`: `effort-readout`, `kpi-stats`, `model-routing-{history,spend}`, `render-session`, `run-paragraph-hook`, `run-view`, `workspace-kpi-stats`, and routes `dashboard-effort`, `dashboard`, `dispatch`, `proxy-compute`, `proxy`, `settings`, `workspace-kpis`.
  - Wiring: `server.js`, `db-indexes.js`. `founder-lookup.js` was deleted.
  - Plumbing reads: the routes and readers only thread `requestRows` / `requestUsageLoader` next to the existing `identityRows`. Not drift: one loader (`request-usage-loader.js:1-11`, "nothing else reads the request-usage collection for a figure"), and LIN-4226 (In Progress, "loading becomes part of the read") is already changing the hand-threading.
  - `db-indexes.js` keeps an unread `{urlKey, rootItemId}` index with a named retirement ticket (LIN-4217): held.
  - `REQUEST_ROWS_BATCH_SIZE = 500` (`request-usage-loader.js:28`) restates `LINEAGE_IDENTITY_BATCH_SIZE` (`dispatch-store.js:298`) by comment rather than import: noise (two independent query bounds).
- **Test-state** (2): `key-state-holders`, `routes/test.js` → `key-state-residue` (held).
- **Kit** (1): `runner.mjs` → contract row (snapshot gone).
- **Wiring** (1): `server.js`, included above.

SD, 12 non-test files:
- `config.js`, `hook.js`, `opencode-runner.js`, `transcript.js`, `request-usage-flush.js`, `request-usage.js`, `opencode-request-records.js`, `README.md`, `docs/module-map.md` → relay flag (resolved) and snapshot removal (contract row). `transcript.js` −111 removed `walkUsage`, with no remaining non-test caller.
- `docs/testing-and-ci.md`, `docs/full-system-test-plan.md`, `package.json` → heavy-tier harness (held). The docs were read at section level only.

LIN-4200's two measurement scripts (`scripts/`, outside the production scope) import the vocabulary and the cost read. `lin-4200-d13-volume-timing.mjs` names token fields twice. These are one-off measurement scripts: noise.

**Searches that would surface a miss**, and were run:
- every file in `git diff --name-only` for both windows, by cluster (above);
- census at both commits under one guide (0 mustRule moves);
- the import graph (no new SCC, no upward edge);
- `git grep` for the snapshot vocabulary in both repos (above);
- `git grep` for the deleted symbols (`founder-lookup`, `lookupFounderRows`, `sumTranscriptUsage`, `usageMessage`, `postUsageSnapshot`, `walkUsage`, `postUsageFeedback`, `usageDelta`, `fetchSessionRollup`): only the explanatory comment at `dispatch-store.js:302` remains;
- the record poster search (item 1);
- the lane-reader search (item 3).

Layer set: complete for the window's production change. The SD docs were read at section level only.

## 8. Survey place-ledger cross-links (`origin/claude/cool-rubin-6acj5j` `2cc0d1fd`, read-only via `git show`)

- `usage-relay-flag-partial` resolved → the LIN-4203 row ("the flag gates every record flush (Drift #9 carried)"). Agrees. This review adds that LIN-4214 is still open behind it.
- `lineage-identity-read-twins` resolved → the LIN-4201 row ("`founder-lookup.js` deleted (the twin is gone)"). Agrees.
- `cost-fold-partition-restated` resolved → the LIN-4201 row ("the restated partition … to confirm with the builder"). **Confirmed resolved** at `cost-read.js:88`.
- `usage-record-vocabulary-two-readers` improved → the LIN-4201 row ("one vocabulary module"). Agrees; the cross-repo copy remains.
- `cache-module-family` worsened → the LIN-4201 row's "+ (mixed)" balance does not count `workspace-kpis-cache.js` as a second keyed SWR cache.
- `usage-snapshot-intake.js` homeless → the LIN-4203 row ("one new file without a home"). Agrees (Seams).
- SD heavy-tier harness → the LIN-4219 to 4224 rows. Agree. Their "partial" note on LIN-4223's two allowlisted kills reads as reasoned allowlisting (production group kills under test), not residue.
- `usage-snapshot-prose-residue` → no place row.

## Candidate findings (delta vs 11-04), by severity

There is no new item above LOW. The carried top of the ledger is unchanged in code: `resume-model-effort-cross-repo` and `credential-decision-multiplicity` MEDIUM-HIGH; `halt-poll-cold-cache-fail-open`, `runner-contract-semantics-cross-repo`, `halt-word-map-copies`, `home-next-answer-split`, `run-page-identity-scrape` MEDIUM; `coherence-loop-stalled` MEDIUM (process).

Movement:
1. `usage-relay-flag-partial`: **resolved** (residual: LIN-4214 open with acceptance partly met; ungated exports).
2. `lineage-identity-read-twins`: **resolved**.
3. `cost-fold-partition-restated`: **resolved**.
4. `usage-record-vocabulary-two-readers`: **improved**.
5. `lineage-anchor-rules-three`: **improved** (4 → 3).
6. `runner-contract-semantics-cross-repo`: **unchanged** (snapshot-bridge sub-item resolved; rows, 404 and store rows untouched).
7. `cache-module-family`: **worsened (+1)**, a second keyed SWR cache. Candidate LOW.
8. `usage-snapshot-prose-residue`: **new, LOW**. 1 user-visible string, 1 agent catalog line, 1 doc line, about 5 comments; task-cost comments 3 → 2.
9. `coherence-loop-stalled`: unchanged, with the new LIN-4214 datum (a loop ticket left stale behind fixed code).
10. Borderline, not graded: completeness precedence ×3.

Not Drift: the homeless `usage-snapshot-intake.js` and the `task-cost|` pattern (Seams); the kit's no-transcript behaviour (documented); `REQUEST_ROWS_BATCH_SIZE` (noise).

## Could not verify

- Whether any production host runs with `SD_WORKER_USAGE_RELAY=0` (frequency of the old gap). Live data, not read.
- Whether a ticket exists anywhere for the dated legacy-fold deletion ("not before 2026-12-04"). Only LIN-4195's children were checked; none names it.
- SD `docs/testing-and-ci.md` and `docs/full-system-test-plan.md`: read at section level, not line by line against the harness.
- Runtime reach of the effort-page disclosure string: not rendered, only read in source.
