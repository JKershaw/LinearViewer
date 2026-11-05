# Drift & Coherence Review — 2026-11-05, run 3 (trend vs the 2026-11-04 run 2)

**Ticket:** LIN-4250. **Previous edition:** `docs/reviews/drift-coherence-review-2026-11-04-run2.md` (LIN-4232, PR #2277, merge `476d9ad4`), called **11-04b** below. **Evidence:** `docs/reviews/_evidence-2026-11-05-drift/` (see the note on the folder name under Method).

**Review-only.** This edition adds only this report and its evidence folder. No code, config, guide, ticket intent or secret was changed in either repo, and the Survey branch `claude/cool-rubin-6acj5j` was only read.

**Grounding (HEADs measured).**
- LinearViewer (Harbour) `2eb73ae07fb7297fc0fa057a6198aa8cbe901558` (LIN-4143, #2285), the mint-time `origin/main`.
- simple-dispatcher (SD) `07c88f7a338b3e19a01070775e1f4d4cfc91f040` (LIN-4233, #328), the mint-time `origin/main`, and still SD's `origin/main` at this beat.
- 11-04b measured LinearViewer `d7ceb373444f9efbc027656132352d247535aa5e` and SD `d8d186c07113d6e61e3489e38f1210d0b0624cad`.
- After the window, Harbour `origin/main` gained two commits: `a569b61c` (Seams run 7, docs only) and `29f14bf6` (LIN-4248, the Survey stage templates, which touch prompt and preamble files under `lib/`). **They are outside this window and were not measured.** This report's branch is cut from `29f14bf6` only so that the PR merges cleanly.

**The window, and how small it was.**
- **LinearViewer `d7ceb373..2eb73ae0`: 11 commits.** Two are docs-only (`43dd0d64` Seams run 6, `476d9ad4` the 11-04b report). Nine touch production (`lib/`, `routes/`, `public/`, `server.js`): **44 files, +1,430 / −363**. Added: `lib/ruling-settled.js`, `lib/waiting-section.js`, `public/home-placement.js`. Nothing was deleted.
  - Per ticket: LIN-4226 (cost read loads through a `requestSource`), LIN-4234 (erasure inventory), LIN-4240 (park read past non-state entries), LIN-4241 (settled-ruling guard), LIN-4242 (live Waiting section), LIN-4243 (Home placement policy), LIN-4151 (/backlog ranking), LIN-4048 (finished task's run block) and LIN-4143 (live-run guard always on).
  - `scripts/code-shape/` (including the area guide), `lib/runner-kit/` and `docs/runner-prompt.md` have **0-line diffs and no commits** in the window.
- **SD `d8d186c..07c88f7`: 4 commits** (LIN-4218, 4239, 4240, 4233). Outside `test/`, **3 files, +271 / −265**: `hook.js`, `opencode-runner.js` and `docs/module-map.md`. Of the +23,607 whole-repo lines, 22,619 are one golden fixture (`test/fixtures/stop-relay-order.golden.json`).
- **What that does to confidence.** 84 of the 124 carried ledger rows name a file the window touched, mostly hubs (`server.js`, `render.js`, `routes/dispatch.js`); see `ledger-touch-map.txt`. Each such row was checked at its cited lines: the window's hunks there belong to the nine clusters above, and the cited decision did not move. The other 40 rows' files have 0-line diffs.
  - For the code, an "unchanged" is a **high-confidence** reading: the cited bytes are identical, or the hunk was read and is something else.
  - It carries **no information** about whether anyone will act on the row. A quiet file means nothing landed, not that the row matters less.

## Headline

A small window. One 11-04b row resolved, three improved, and the window's own features added four small new rows. The top of the ledger did not move.

1. **Resolved: `erasure-inventory-lockstep-gap`** (11-04b's LOW-MEDIUM, minted as LIN-4234). It closed about three hours after minting (`950113b1`). The fix reaches the cause: one collection-name source feeds both guards (`tests/helpers/collection-names.js`), and a census makes every non-literal `collection()` in `server.js` an imported constant.
2. **New, LOW-MEDIUM: `parked-wait-text-cross-repo`.** SD writes one park status for **4** wait kinds (`hook.js:1520-1537`, kinds at `heartbeat.js:258-264`), and Harbour reads **1** of them as parked (`PARKED_WAIT_HINT = /scheduled wakeup/i`, `lib/session-telemetry.js:325`).
   - The dependency is old (LIN-2244, 2026-08); this is the first time it has been ruled. The window improved the ordering (SD posts status last, LIN-4239) and the read (Harbour skips non-state entries, LIN-4240), and it added the first SD test that imports Harbour's real reader.
   - That test runs only in SD's system tier, which SD CI excludes. Neither contract table has a park row, and the 1-of-4 gap is unchanged.
   - Its home is LIN-2258 (Backlog since 2026-08-23). Not minted.
3. **New, LOW, from LIN-4241's settled-ruling guard.**
   - `ruling-settled-row-predicate-inline`: "settled = outcome ∈ {answered, dismissed}" on a task-decision row is now written inline at **5 sites in 3 route files**, up from 2 at `d7ceb373`. The loop side has one owner (`isDecisionSettledIn`). Census `G0217` left `mustRule` by a re-key, not a resolution, and is re-ruled real here.
   - `error-code-case-split`: `ruling-settled` is the only kebab-case HTTP error code; there are 42 UPPER_SNAKE codes in routes and 18 in lib. The neighbouring scan-retire refusal keeps `ALREADY_TERMINAL`.
   - The envelope itself is clean: every refusal goes through `jsonError` with one frozen constant, and `res.status(` is unchanged at 275.
4. **Improved:**
   - `live-anchor-old-home-alive`: the `liveGuard` flag is gone (LIN-4143), leaving one inline copy (`routes/proxy-rulings.js:246-249`, LIN-3843).
   - `home-next-answer-split`, partially: LIN-4151 put /backlog on Up next's ranking. It stays MEDIUM, because triage and the deck top are unchanged.
   - `usage-snapshot-prose-residue`: 1 of 9 files fixed. But LIN-4226 edited two of the files and left their stale lines, including the one user-visible string (`effort-readout.js:599`).
   - `coherence-loop-stalled`: the first movement in four editions, with LIN-4234 and LIN-4151 Done. 16 open, and the other 14 are unmoved with 0 new comments, so it stays MEDIUM.
5. **The top of the ledger is unchanged in code.**
   - `resume-model-effort-cross-repo` and `credential-decision-multiplicity` stay MEDIUM-HIGH.
   - `halt-poll-cold-cache-fail-open` stays MEDIUM (LIN-4210). That is John's ruling and is not chosen here.
   - `runner-contract-semantics-cross-repo` stays MEDIUM: 38 vs 34 rows, 0 usage rows. LIN-4218 made the usage flush formally first in SD's Stop order, and it is still in neither table.
6. **The instruments reproduce, and the window barely registers.**
   - Census under one guide: 566 / **105** / 309 / 1. 0 `mustRule` groups joined and 1 left (G0217, a re-key).
   - Import graph: 499 nodes, 2,051 edges, the same two SCCs, 0 upward edges and 53 route→route.

## Method and instrument

**Evidence folder name.** The LIN-4250 description names `docs/reviews/_evidence-2026-11-05/`. That name was free at beat 1. Seams run 7 (LIN-4249, `a569b61c`) then merged its own evidence there, with a README describing only Seams. So this edition's evidence is in **`_evidence-2026-11-05-drift/`**, following the `-run2` / `-run6` suffix precedent for same-day editions. No file name collided; the move only keeps the two reviews apart.

**Guide.** One area guide, fixed for every census run: `areas-2eb73ae0.json`, which is HEAD's `scripts/code-shape/areas.json` (`git show "${H}:scripts/code-shape/areas.json"`), sha256 **`e3194f52a76ed595a93ce3aa11b259dfce84114230f99596784243a7d994159f`**, git blob `642e9405`. It is byte-identical to 11-04b's `areas-d7ceb373.json`, because the guide did not change in the window, so the guide effect is zero by construction.

**Scope pattern** (11-04b's): `--include '^(server\.js$|(lib|routes|public)/.*\.[cm]?js$)'`.

| key | code window | command (repo root, `E=docs/reviews/_evidence-2026-11-05-drift`) | groups / mustRule / table / gone / unranked |
|---|---|---|---|
| R (reproduction) | `d7ceb373` vs `5334c81a` (11-04b's W1) | `node scripts/code-shape/census-review.mjs . d7ceb373… 5334c81a… --areas $E/areas-2eb73ae0.json --include …` | 566 / 106 / 307 / 1 / 0; **JSON equal to 11-04b W1** apart from the guide path |
| **W (this reading)** | **`2eb73ae0` vs `d7ceb373`** | `node scripts/code-shape/census-review.mjs . 2eb73ae07fb7297fc0fa057a6198aa8cbe901558 d7ceb373444f9efbc027656132352d247535aa5e --areas $E/areas-2eb73ae0.json --include …` | **566 / 105 / 309 / 1 / 0** |

**Census code effect (W statuses):** 562 unchanged, 1 new, 2 grown, 1 shrunk, 1 gone (`census-compare.txt`, produced by `census-compare.py`).
- **`mustRule` 106 → 105.** 105 are kept on (detector, decision, file set), with 55 identical sites and 50 shifted lines only. 0 joined.
- **Left: G0217 `outcome == 'dismissed'`** (11-04b: borderline). It is now table group G0292, shrunk to 3 files, because `routes/dashboard-rulings.js` lost its label ternary (`d7ceb373:318`). This is a **re-key, not a resolution**: the or-chain G0294 `{'answered','dismissed'}` grew to 4 files (+`routes/workspace-api-scan.js:389`). See `ruling-settled-row-predicate-inline`.
- Gone G0214 / new G0211: Home's script list grew from +8 to +9 names (`/home-placement.js`). The label changed; no copy was added.
- Grown G0231, the `[usage]` text-contract marker, is back in the table at 3 files. LIN-4240 added a real legacy reader: `_isNonStateEntry` tests `/^\s*\[usage\]/i` (`lib/session-telemetry.js:89`). See (f).

**Import walker.** `import-walker.mjs` is copied unchanged from 11-04b. It reproduces 11-04b at `d7ceb373` exactly.

| sha | nodes | static edges | dynamic | SCCs (members) | upward static / dynamic | route→route |
|---|---|---|---|---|---|---|
| `d7ceb373` | 497 | 2,042 | 2 | 2 (6, 6) | 0 / 0 | 53 |
| **`2eb73ae0`** | **499** | **2,051** | 2 (the same) | **2 (6, 6), same members** | **0 / 0** | **53** |

Edges (`import-graph-diff.txt`):
- −1: `render.js → question-card.js`.
- +10: the `waiting-section` wiring (render, server.js, and its three imports); `ruling-settled` imported by three routes; and `kpi-stats` / `model-routing-history` → `cost-read` (LIN-4226).
- No edge closes a cycle.

**`res.status(`.** 275 in routes plus `server.js`, 250 in routes only, and 12 `res.status(<var>).json`, all identical per file at both SHAs (`res-status-count.txt`).

**Other reads:**
- every production file in the window, by ticket cluster;
- the SD `hook.js` diff, read for the park text, the Stop table and the decision relay; `scanDecisionBlock`'s body is byte-identical at both SHAs;
- the two contract tables (row counts, `usage` grep);
- the error-code census (`code:` literals in `routes/` and `lib/`);
- the settled-outcome grep at both SHAs;
- the non-literal `collection(` calls against `INVENTORY`;
- the snapshot-prose grep;
- the Survey place-ledger (read-only) and the Seams run 7 report, for hand-offs.

**Not run:** any test suite in either repo (no code changed here), and SD's `test:system` tier, which holds the only cross-repo park test.

**Ledger carry.** `ledger-carry-11-04b.tsv` holds all 124 rows from 11-04b's compact trend ledger: row, stable name, severity, and 11-04b delta. Rows 25 and 30 carry an escaped `|` and were parsed by hand. `ledger-11-05.tsv` is this edition's ledger, built by `build-report-tables.py`.

## Findings (severity-ranked; delta vs 11-04b)

Citations are at `2eb73ae0` (Harbour) and `07c88f7` (SD).

| # | name | severity | delta vs 11-04b | one line |
|---|---|---|---|---|
| 1 | `resume-model-effort-cross-repo` | MEDIUM-HIGH | unchanged | `dispatch-factory.js`, `follow-up-dispatch.js` and SD `harnesses.js` have 0-line diffs. LIN-4156 Backlog, 0 comments. |
| 2 | `credential-decision-multiplicity` | MEDIUM-HIGH | unchanged (borderline) | `lib/workspace.js` and `lib/errors.js` have 0-line diffs. LIN-3822 Backlog. |
| 3 | `cross-repo-sentinel-decision-marker-vocabulary` | MEDIUM | unchanged | The kit has a 0-line diff. SD's status strings are unchanged (the diff on those lines is comments). The new SD `park-read` system test binds Harbour's terminal and wake readers one way, outside SD CI. |
| 4 | `halt-poll-cold-cache-fail-open` | MEDIUM (conditional) | unchanged | All cited files have 0-line diffs. LIN-4210 Backlog, 0 comments. **John's ruling (LIN-3024); not chosen.** |
| 5 | `runner-contract-semantics-cross-repo` | MEDIUM | unchanged | 38 vs 34 rows, both 0-line diff, 0 usage rows. LIN-4218 makes the usage flush the first slot in every SD posting outcome (`hook.js:441-468`), still in neither table. |
| 6 | `halt-word-map-copies` | MEDIUM | unchanged | All four map files have 0-line diffs. LIN-4157. |
| 7 | `run-page-identity-scrape` | MEDIUM | unchanged | The cited lines are unmoved. |
| 8 | `home-next-answer-split` | MEDIUM | **improved (partial)** | See (d). LIN-4158 Backlog. |
| 9 | `coherence-loop-stalled` | MEDIUM (process) | **improved** | LIN-4234 and LIN-4151 Done. 16 open; 14 unmoved, 0 new comments. |
| 10 | `parked-wait-text-cross-repo` | LOW-MEDIUM | **new** (first ruled) | See Cross-repo (a). |
| 11 | `live-anchor-old-home-alive` | LOW-MEDIUM | **improved** | See (d). |
| 12 | `decision-stamp-classifier-copies` | LOW-MEDIUM | unchanged (touched) | LIN-4240's `_isNonStateEntry` (`session-telemetry.js:85-91`) calls the inline copy `_isStampEntry` (`:60-63`), not the authority (`digest-feedback.js:78`). The Survey's builder q6 names the same "skip list apart from the kinds list" (`place-ledger.md:45`). |
| 13 | `task-page-state-outside-owner` | LOW-MEDIUM | unchanged (borderline) | `READY_TASK_STATE` is still `render-task-page.js:108`, and `public/task-page.js` has a 0-line diff. |
| 14 | `ruling-settled-row-predicate-inline` | LOW | **new** (the window's own) | See (c). The only candidate here with no existing ticket. |
| 15 | `error-code-case-split` | LOW | **new** | See (c). |
| 16 | `usage-snapshot-prose-residue` | LOW | **improved (1 of 9), sharper** | See (f). |
| 17 | `waiting-standing-comment-residue` | LOW | **new** (Seams hand-off) | See (d). |
| 18 | `vendor-script-list-restated` | LOW | unchanged | 27 `scripts: [` arrays and 7 purify render files at both SHAs. Home's list gained `/home-placement.js` (`render.js:383`). |
| — | `reply-effect-default-split` | borderline (not graded) | **new** | See (d). |
| — | `completeness-precedence-restated` | borderline | unchanged | `row-usage.js:116`, `cost-read.js:199`, `request-usage-fold.js:103`. |
| — | `erasure-inventory-lockstep-gap` | resolved (was LOW-MEDIUM) | **resolved** | See (e). |
| — | `usage-relay-flag-partial`, `lineage-identity-read-twins`, `cost-fold-partition-restated` | resolved | held | See (b) and (e). |
| — | everything else | as 11-04b | unchanged or held | Each row was checked by its own cited files (ledger). |

**Resolved:** 1. **Improved:** 4. **New:** 1 LOW-MEDIUM, 3 LOW, 1 borderline. **Worsened:** 0 among carried rows. The window's settled-check growth from 2 to 5 sites is filed as a new row because no earlier row named it.

### (c) LIN-4241, the settled-ruling guard

- **The envelope follows the canonical writer.**
  - One frozen constant, `RULING_SETTLED_REFUSAL = [409, 'This ruling was already answered or dismissed.', { code: 'ruling-settled' }]` (`lib/ruling-settled.js:10-14`).
  - Every refusal goes through `jsonError(res, ...RULING_SETTLED_REFUSAL)` or `{ fail: RULING_SETTLED_REFUSAL }`.
  - `res.status(` is unchanged, so `routes-error-envelope-fragmentation` is unchanged.
- **`ruling-settled-row-predicate-inline` (new, LOW).** On a task-decision row, "already settled" means the outcome is `answered` or `dismissed`. That test is written inline at:
  - `routes/dashboard-rulings.js:327`;
  - `routes/workspace-api-issue-write.js:162,168,646`;
  - `routes/workspace-api-scan.js:389`.

  At `d7ceb373` there were 2 such sites (`dashboard-rulings.js:317`, `workspace-api-issue-write.js:104`).
  - The store owns the closed set (`lib/task-decisions-store.js:88,101,328`) and gained `readOutcome` (`:506`), but there is no `isSettled`.
  - The loop side has one predicate: `isDecisionSettledIn` (`digest-feedback.js:116`) → `dispatch-store.js:3770`, plus the CAS at `:3841`.
  - **Home:** a predicate in `lib/task-decisions-store.js` beside `readOutcome`.
  - Survey `place-ledger.md:91` rates LIN-4241 "worse" for "the scan-row settled check goes from 2 copies to 5". That agrees.
- **`error-code-case-split` (new, LOW).**
  - `ruling-settled` replaced `ALREADY_TERMINAL` on the task-bound answer. The scan-retire route keeps `409 ALREADY_TERMINAL` for its neighbouring case (`workspace-api-scan.js:75,508`).
  - Every other error `code` is UPPER_SNAKE: 42 distinct in routes, 18 in lib.
  - The browser restates the code as a literal (`public/question-cards.js:248`) with no build step to import it. The client test keys on its own literal, so a server rename would not turn it red. That is the G0479 pattern (deliberate inlining, drift risk only). No client keyed on the old code, so nothing broke.
  - LIN-4244 (Backlog) will spread `ruling-settled` handling to `observation.js` and `scan.js`, so the casing gains readers. Survey `place-ledger.md:91` ("two 409 codes") agrees.
- **Observation (noise).** `isDecisionSettledIn` is the fifth `JSON.parse(entry.message)` → `decision_id` read of a decision stamp. All five are in the stamp owner, `digest-feedback.js` (`:121,145,197,222,310`), behind its own kind predicate. One file, one owner, so it is not a drift row. This is the Survey's "a third stamp parser".

### (d) Home and the task page (LIN-4048, 4143, 4242, 4243, 4151)

- **LIN-4048: consolidation.**
  - The no-run decision stays the server's `runOfferOf` (`lib/task-state.js:310`). The browser reads it through one predicate, `takesNoRun` (`public/prompt-section.js:691`), at six call sites across Home, the task page and Swipe.
  - "Finished but held" (Survey `place-ledger.md:95`: "decided in three places"): the third place is the running/queued test in `render-task-page.js:268-272`. That is census G0137 (real, home `lib/task-state.js`), touched here without consolidation. Its row and ruling are unchanged.
- **LIN-4143 → `live-anchor-old-home-alive` improved.**
  - The `liveGuard` parameter is gone, so `liveOnAnchor` is unconditional (`unanswered-decisions.js:982`).
  - The one inline copy left is `routes/proxy-rulings.js:246-249` (0-line diff), named by the owner's header (`lib/live-anchor.js:9`). LIN-3843 is Backlog.
- **`reply-effect-default-split` (new, borderline, not graded).** `question-cards.js` now defaults an absent effect to `record` (fail closed), while the shared reply helper keeps absent = `resume` (pinned by `reply-delivery-contract`). The commit documents this as deliberate. The Survey's builder q6 (`place-ledger.md:51`) adds that a new caller of the helper inherits fail-open.
- **LIN-4242, LIN-4243: consolidations.**
  - One reduction (`createWaitingStanding`, `home-row-states.js:82`) and one renderer (`renderWaitingSection`, `waiting-section.js`) serve page and fragment.
  - One keyed merge (`mergeWaitingCards`, `question-cards.js:496`) and one keep-if-typing check (`cardHoldsInput` / `keepsReaderPlace`, `:465-478`).
  - One placement policy (`public/home-placement.js`).
  - Home has two live-update idioms, a keyed merge for Waiting and a deferred whole-desk swap for Running and Up next. That is deliberate and documented (`home-placement.js:1-7`): noise.
  - Observation's own merge copy is LIN-4238 (Backlog): recorded, not graded.
- **`waiting-standing-comment-residue` (new, LOW).** Two comments the window wrote or left contradict the code beside them. Seams run 7 handed these to Drift; both were verified here.
  - `lib/home-row-states.js:121`: "the task page's read leaves it off". That has been untrue since LIN-4143; the same file's `:67` says "unconditional since LIN-4143".
  - `lib/waiting-section.js:5` names a reduction `readWaitingStanding`, which does not exist. The function is `createWaitingStanding` / `waitingStanding` (`home-row-states.js:82,85`).
- **`home-next-answer-split` improved (partial), still MEDIUM.**
  - LIN-4151: /backlog's lead roots use Up next's ranking (`rankKeysOf` / `compareRank`, `home-view.js:422,432`), with one split for page and fold (`home-rows.js:156-158`).
  - Unchanged: triage (`home-view.js:36`, `task-order.js:163`) and the deck's top task (`home-pipeline.js`, 0-line diff).
  - `orderIssuesForSwipe` (`task-board-view.js:91`) still ranks apart. That agrees with the Survey's builder q6 (`place-ledger.md:49`).

### (e) Erasure, costs and vocabulary

- **`erasure-inventory-lockstep-gap` → resolved** (LIN-4234, `950113b1`).
  - `usage-snapshot-intake` is in `INVENTORY` (`lib/account-erasure.js`, +5/−1).
  - Both guards read one name source (`tests/helpers/collection-names.js`: literals plus every exported `*_COLLECTION`), and the four hand-added names are deleted.
  - A census requires every non-literal `collection(<arg>)` in `server.js` to be an imported constant. At HEAD, every non-literal call in `lib/`, `routes/` and `server.js` is a constant or an `INVENTORY` row (grep).
  - Residual (noise): that census covers `server.js` only.
- `usage-record-vocabulary-two-readers`: unchanged (0-line diffs).
- Held resolved:
  - `cost-fold-partition-restated`: `countedRowsOf` is read at `cost-read.js:89,252,268`.
  - `lineage-identity-read-twins`: `findLineageIdentity` is at `dispatch-store.js:320`.
- **LIN-4226 (`requestSource`): consolidation, in the costs owner's scope.**
  - The hand-threaded `requestRows`, deferred by 11-04b, is gone: callers pass the loader, with `NO_REQUEST_RECORDS` for "none".
  - The old key throws at three entrances (`cost-read.js:143,540`, `run-view.js:384`). That is a migration tripwire: noise.
  - Seams N6 asks Drift to weigh `cost-read.js:34` "Pure: no store, clock or network". It is still true, because the source is injected: noise.

### (f) Unlisted, in remit

- **`usage-snapshot-prose-residue`: improved (1 of 9 files), and sharper.**
  - Fixed: `docs/architecture/source-map.md:192` (LIN-4226).
  - LIN-4226 edited `effort-readout.js` (+9/−6) and `model-routing-spend.js` (+8/−12) and left their stale lines: `effort-readout.js:599` (user-visible) and `model-routing-spend.js:6,58`.
  - Unchanged: `proxy-instructions.js:385-386`, `docs/proxy-integration.md:1239`, `request-usage-vocabulary.js:4`, SD `request-usage-flush.js:3-8` and SD `request-usage.js:163-164`.
- **The `[usage]` legacy reader grew by one.**
  - LIN-4240's `_isNonStateEntry` matches legacy untagged `[usage]` lines (`session-telemetry.js:89`).
  - The legacy deletion now has a ticket, **LIN-4235** (Backlog, filed 2026-11-04 19:46). That answers 11-04b's "no filed ticket".
  - LIN-4235 names `session-telemetry.js` (`withUsage`) but not the new skip, so the deletion has one more site to clear. Observation, not graded.
- **`vendor-script-list-restated`: unchanged in count.**

## Cross-repo contract verdicts

| contract | Harbour | kit | SD | verdict (11-05) | consequence |
|---|---|---|---|---|---|
| **(a) Park status text** | reader `PARKED_WAIT_HINT = /scheduled wakeup/i` (`session-telemetry.js:325`); the walk skips non-state entries (`:85-91`, LIN-4240) | never parks | writer `[working · verifying] Not done yet — ${what} still pending.` (`hook.js:1520-1537`) for 4 kinds (`heartbeat.js:258-264`); status last in every posting outcome (`:460-469`, LIN-4239) | **new row: two sides of one text format with no contract row; 1 of 4 kinds read.** Ordering improved on both sides. Binding: SD `test/system/park-read.test.js` imports Harbour's `parseParkedWait`, `findWakeEvent` and `deriveTerminalStatus`, but runs only in `test:system`, which SD CI excludes (`.github/workflows/ci.yml:5-7`). Its comment pins the narrow match as intended (`:30`) | `parked-wait-text-cross-repo` LOW-MEDIUM; home LIN-2258 |
| **(b) Stop-relay order** (LIN-4218) | — | — | one `STOP_OUTCOMES` table (`hook.js:471`) and one `runStopOutcome` executor (`:486`), slot legend `:441-468`, pinned by the 22,619-line golden; the decision relay is now one D slot (`relayDecisionAndWithdrawals`, `:538`), down from three call sites | **SD-internal consolidation.** Status strings unchanged | none; `decision-dialect-split` unchanged (the scanner is byte-identical) |
| (b) Runner contract table | `lib/runner-kit/contract.json` 38 rows, 0-line diff | — | `test/fixtures/runner-contract.json` 34 rows, 0-line diff | **unchanged**; 0 usage rows, now with the usage flush formally first in SD's Stop order | `runner-contract-semantics-cross-repo` MEDIUM |
| (b) Usage relay flag | — | — | the U slot → `flushRequestUsageSafely` → `request-usage-flush.js:114` (0-line diff) | **held resolved** | LIN-4214 still Backlog, 0 new comments |
| (b) Markers | `dispatch-terminal.js` | 0-line diff | status lines: comment-only diff | unchanged | `cross-repo-sentinel-decision-marker-vocabulary` MEDIUM |
| halt vocabulary, absent-on-poll | 0-line diffs | 0-line diff | 0-line diffs | unchanged | LIN-4210, John's ruling |
| consumer heartbeat, reap window, model/effort vocabulary | 0-line diffs | 0-line diff | 0-line diffs | unchanged | — |
| (c)–(f) | see Findings | | | | |

## Sibling hand-offs (recorded, not double-flagged)

- **Seams & Tangles run 7** (`seams-tangles-review-2026-11-05.md`, LIN-4249, merged `a569b61c` after this window). It owns the guide gap that put `lib/ruling-settled.js` and `lib/waiting-section.js` in the catch-all (its N1, 14 → 16), the browser-globals knot that LIN-4243 grew (F6), the rulings family split across six areas (N12), and `cost-read` as a hub (N6). Route→route stays 53, cross-linked. It handed Drift six items:
  - the `home-row-states.js:121` comment and the `waiting-section.js:5` name: verified, new row #17;
  - the `question-cards.js:248` code restatement: folded into #15;
  - the settled-check copies and "two 409 codes": #14 and #15;
  - "finished but held in three places": G0137, carried (d);
  - the N6 "Pure" wording: noise (e).
- **Code Quality** (`code-quality-review-2026-11-04.md`, LIN-4207). F-hidden-dup stays cross-linked to `mock-ai-builder-copies` (unchanged). Function size (`dispatch-store.js`, `server.js`, `app.js` +156) is theirs.
- **Stability** (`stability-review-2026-11-04.md`, LIN-4206) owns the halt fault path. `poll-halt.js` is untouched again; Drift keeps the duplication half (LIN-4210).
- **Costs** (LIN-4195, Done; LIN-4235 Backlog) own the legacy-fold deletion and LIN-4214's closure.
- **Documentation.** The prose rows (#16, #17) sit with Documentation by default. LIN-3484 (Backlog) covers `proxy-instructions.js:385-386`.
- **Test Coverage.** The cross-repo park test is outside SD CI by tier design. Whether one park case should run in SD's default tier is theirs to weigh; Drift records only the missing contract row.

**Survey place-ledger cross-links** (`docs/plans/survey/place-ledger.md` on `claude/cool-rubin-6acj5j` at `2b5b6af4`, read-only):
- `ruling-settled-row-predicate-inline` and `error-code-case-split` → the LIN-4241 row (`:46`, `:91`, "worse": 2 → 5 copies, two 409 codes). Agrees.
- `parked-wait-text-cross-repo` → the LIN-4239 and LIN-4240 rows (`:44-45`, `:90`, "mixed": "a park's readability has an owner on each side"). Agrees, and adds that the reader matches 1 of the writer's 4 kinds.
- `decision-stamp-classifier-copies` touched → the LIN-4240 row's builder q6 (`:45`). Agrees.
- `live-anchor-old-home-alive` improved, and `reply-effect-default-split` → the LIN-4143 row (`:51`). Agrees.
- `home-next-answer-split` partial → the LIN-4151 row (`:49`). Agrees.
- G0137 touched → the LIN-4048 row (`:95`, "neutral"). Agrees.
- `erasure-inventory-lockstep-gap` resolved → the LIN-4234 row (`:43`, `:89`, "better"). Agrees.
- `waiting-standing-comment-residue` → the LIN-4242 row (`:47`) does not name it.

## Classes and bounds (repeatable)

| class | 11-04b | 11-05 | how bounded |
|---|---|---|---|
| park kinds SD writes / Harbour reads as parked | (not measured) | **4 / 1** | `heartbeat.js:258-264` kinds; `PARKED_WAIT_HINT` |
| SD tests that `import()` a Harbour module | 0 | **1** (system tier, outside CI) | the test's own header, SD `test/system/park-read.test.js:4` ("the tests in this tier before it talk to Harbour over HTTP") |
| task-row settled-outcome inline sites | 2 | **5** (3 route files) | `git grep "outcome === '(answered\|dismissed)'" -- routes` at both SHAs |
| HTTP error-code casings | 1 (UPPER_SNAKE) | **2** (+ kebab `ruling-settled`) | `code:` literals in `routes/` and `lib/` |
| decision-stamp message parses in `digest-feedback.js` | 4 | 5 (one file) | `JSON.parse(entry.message)` |
| live-on-anchor inline copies outside the owner | 1 + a skippable flag | 1 | `liveGuard` = 0; `proxy-rulings.js:246-249` |
| "what's next" rankers | 3 | 2 (+ triage split) | `rankKeysOf` / `compareRank`, `orderIssuesForSwipe` |
| `[usage]` snapshot prose files | 9 | **8** | the 11-04b grep |
| legacy `[usage]` readers | 2 files | 3 files | census G0231 |
| collections opened vs erasure `INVENTORY` | 1 unlisted | **0** | non-literal `collection(` vs `INVENTORY` |
| contract rows (Harbour / SD / usage / park) | 38 / 34 / 0 / — | 38 / 34 / 0 / 0 | JSON row count, grep |
| census `mustRule` | 106 (34 / 30 / 42) | **105 (34 / 29 / 42)** | `census-review.mjs`, one guide |
| SCCs | 2 (6 + 6) | 2, same members | walker |
| `res.status(` | 275 | 275 | grep |
| open Drift follow-ups | 18 | **16** | the API, per ticket |

**Unbounded:**
- how often a monitor, background-task or sub-agent park occurs in production (the reach of the 1-of-4 gap);
- how many API clients key on `code`;
- everything 11-04b listed (relay-flag-off hosts, legacy `[usage]` volume, cold halt cache × store fault).

## Follow-ups

**Not minted in this beat.** Beat 4 decides, after the adversarial second-read. These are the candidates, each searched first (`linear-search-beat2.txt`, `linear-search-beat3.txt`).

**Candidates for minting (at most ~3; only where no ticket names the finding):**
1. **`ruling-settled-row-predicate-inline`** (LOW): one `isSettled` predicate in `lib/task-decisions-store.js`, read by the five route sites.
   - Searches: "ruling-settled", "settled ruling", "answered dismissed outcome", "isSettled", "task-decisions-store settled", "settled predicate", "RULING_SETTLED_CODE".
   - Hits: LIN-4244 (client handling), LIN-4245 (dedupe key), LIN-4142 and LIN-4241 (Done). None names the predicate. **The only candidate with no home.**
2. No other candidate clears "no existing ticket".

**Considered and not minted:**

| candidate | severity | search phrases | existing home | outcome |
|---|---|---|---|---|
| `parked-wait-text-cross-repo` | LOW-MEDIUM | "parseParkedWait", "scheduled wakeup", "park text contract" | **LIN-2258** (Backlog since 2026-08-23, "widen the parked-wait detector … three park phrasings") | not minted; candidate for a dated evidence comment in beat 4 |
| `error-code-case-split` | LOW | "error code case", "kebab code", "ruling-settled", "RULING_SETTLED_CODE" | LIN-4244 (spreads the code's readers) | not minted; report only |
| `waiting-standing-comment-residue` | LOW | "readWaitingStanding", "waiting-section", "stale comment" | none; a two-comment fix | below the bar; report only |
| `usage-snapshot-prose-residue` | LOW | (11-04b phrases) | LIN-3484 (proxy-instructions sweep) | report only |
| the legacy `[usage]` skip in `session-telemetry.js:89` | observation | "legacy fold", "2026-12-04", "usageStateOf", "usage-snapshot-intake", "delete legacy snapshot" | **LIN-4235** | candidate for a dated comment (one more site to clear) |
| contract rows (usage, park) | MEDIUM row | "usage contract row" | LIN-3624, LIN-3823 | existing homes |
| `live-anchor-old-home-alive` residual | LOW-MEDIUM | "proxy-rulings live" | LIN-3843 | existing home |

## For John (none blocks the report)

- **(a) Halt poll on a cold cache (LIN-4210, LIN-3024).** Unchanged from 11-04b; the ticket still reads "needs John's ruling". Not chosen here.
- **(b) LIN-4214** (relay flag residual). Still Backlog behind code that LIN-4203 fixed. Whether to close it against LIN-4203 is the costs owner's call, as 11-04b said. Carried unchanged.

## Ticket trend

States are from the workspace API at beat 1 (`ticket-states-beat1.txt`). Comment counts are since the 11-04b close (2026-11-04 ~20:00Z).

| ticket | 11-04b | now | delta |
|---|---|---|---|
| **LIN-4234** | minted, Backlog, parent 3449 | **Done** 2026-11-04 23:13 (`950113b1`) | closed ~3h after mint |
| **LIN-4151** | Backlog, unparented | **Done** 2026-11-05 03:45 (`13fe24a0`) | closed |
| LIN-4210 / 4156 / 4157 / 4158 / 4214 | Backlog, parent 3449 | same, 0 new comments | none |
| LIN-3822 / 3835 / 3836 / 1496 / 3736 / 3624 | Backlog, parent 3449 | same, 0 new comments | none |
| LIN-3823 / 3636 / 3649 / 3843 / 3979 | Backlog, unparented | same, 0 new comments | none |
| LIN-3449 | Todo, 44 children | Todo, 44 children, 0 new comments | none |
| LIN-2798 / 3484 / 4217 | Backlog | same | none |
| LIN-4195 / 4226 | In Progress | Done | costs rebuild finished |
| LIN-3948 | (not tracked) | Canceled | the snapshot path it proposed is gone |
| LIN-4235 / 4238 / 4244 / 4245 | — | Backlog (filed between 11-04 19:46 and 11-05 00:10) | new homes named in (c), (d), (f) |

**Open Drift follow-ups: 16** (was 18). These are LIN-4210, 4214, 4156, 4157, 4158, the six 10-23 tickets, and five unparented ones (3823, 3636, 3649, 3843, 3979).

| edition | minted | still Backlog and unmoved now |
|---|---|---|
| 10-23 | six | all six |
| 11-03 | LIN-4156, 4157, 4158 | all three |
| 11-04 | LIN-4210 (+ LIN-4214) | both |
| 11-04b | LIN-4234 | **Done** (the first Drift mint closed by the next edition) |
| 11-05 | (beat 4) | — |

## Adversarial Second-Read

Pending (beat 4).

## Census ruling table (the 105 `mustRule` groups, HEAD guide)

Counts: 34 real, 29 borderline, 42 noise. 11-04b: 34 / 30 / 42; the borderline G0217 left `mustRule` and is listed last, re-ruled. Rulings are joined on (detector, decision, file set) by `rulings-carry.py` and flagged when a site falls inside a window hunk. Three were flagged (G0137, G0166, G0168, all at `render-task-page.js:268-272`, LIN-4048), re-read, and hold. **The reasons are carried as written at 11-04b (their line numbers are 11-04b's)**; current sites are in the W census JSON.

| id (11-05) | 11-04b id | decision | a/f/s | ruling | one-line reason (home, when real) | basis |
|---|---|---|---|---|---|---|
| G0001 | G0001 | repeated comparison NODE_ENV == 'test' | 7/18/43 | **real** | Env read inline 43x; 10 identical limiter skip arrows re-derive test mode. Home: lib/should-mock-ai.js plus one skipInTest helper (10-23 named it; it never landed). | carried; lines shifted only, no site in a window hunk |
| G0002 | G0002 | repeated comparison kind == 'autopilot' | 4/19/31 | **real** | Anchor test repeated inline: run-view.js:340 copies findAnchorLoop's test (session-summary.js:53); dispatch-store 573/738 repeat run-root. Home: findAnchorLoop plus one run-root helper. | carried; lines shifted only, no site in a window hunk |
| G0003 | G0003 | repeated comparison authType == 'oauth' | 4/8/12 | **real** | lib/workspace.js getBindingCallScope | carried; lines shifted only, no site in a window hunk |
| G0004 | G0005 | record assembled from the same sources {deployInfo=getDeployInfo(), urlKey=ID.urlKey, openRouterSource=getOpen | 2/13/13 | **real** | 13 routes rebuild the same deployInfo/urlKey/openRouterSource/workspaces record with no shared builder. One chrome-options builder beside lib/components/page.js should own it. | carried; lines shifted only, no site in a window hunk |
| G0005 | G0004 | record assembled from the same sources {id=ID.id, identifier=ID.identifier, title=ID.title} | 7/10/15 | **noise** | Three-field projection of differently shaped objects; no rule inside. The mock-fixture cluster is covered by G0035 and G0158. | carried; sites identical |
| G0006 | G0006 | repeated comparison accessToken == 'test-token' | 6/8/15 | **real** | isTestMode predicate re-inlined; 11-04 adds `lib/key-state-holders.js:48` (`workspace.accessToken === MOCK_ACCESS_TOKEN`), the same mock rule restated in the key-state holder. Home unchanged: `isTestToken` in `routes/workspace-api-steps.js`, belongs in `lib/`. | carried; lines shifted only, no site in a window hunk |
| G0007 | G0007 | tiny rule copied as a helper slugifyForFilename() (also: githubSlug, stripMarkdown, slugifyPeriodicalTitle, pl | 4/9/11 | **borderline** | slugifyForFilename is copied identically in lib/prompt-formatters.js, public/app.js and public/prompt-section.js; the other members are different rules. Client-side sharing cost is unclear. | carried; lines shifted only, no site in a window hunk |
| G0008 | G0008 | repeated comparison kind == 'wake' | 2/10/23 | **real** | runner.mjs repeats the wake-claim test (kind wake, dispatchedBy null, followUpTo) at lines 122, 1012 and 1332; one helper in that file. Other wake sites are distinct filters. | carried; lines shifted only, no site in a window hunk |
| G0009 | G0009 | repeated comparison provider == 'jira' | 2/6/8 | **noise** | provider switch at the edge; each branch differs | carried; lines shifted only, no site in a window hunk |
| G0010 | G0010 | repeated comparison status == 'taken' | 1/9/16 | **borderline** | Status literal still 16 sites in 9 files; the 5 in `dispatch-lineage-status.js` remain beside `lineage-membership.js:39`, which already holds the joined predicate. One helper is cheap; benefit still unclear. | carried; lines shifted only, no site in a window hunk |
| G0011 | G0011 | repeated comparison type == 'started' | 5/7/11 | **real** | isInProgress (providers/state-map.js:59) and home-view isStarted exist, yet about 8 sites inline state.type==='started' (tree.js, openrouter, recommendation-facts, proxy.js). Route them through it. | carried; lines shifted only, no site in a window hunk |
| G0012 | G0012 | repeated comparison scope == 'current' | 3/10/16 | **real** | Find-by-(provider,scope) binding lookup is re-written at ~9 sites in 6 files; workspace.js already owns binding lookup (getBindingsForWorkspace). Label 'scope == current' is misleading. Home: lib/workspace.js. | carried; sites identical |
| G0013 | G0013 | repeated comparison NODE_ENV == 'production' | 3/5/7 | **noise** | Environment switch for secure cookies and https redirects; each site sets a different setting. Inert and not a domain decision. | carried; lines shifted only, no site in a window hunk |
| G0014 | G0014 | repeated comparison key == 'Escape' | 1/7/10 | **noise** | Each Escape handler closes its own component (queue, search, toggles, selectors, sheet); the literal is the platform key name, no shared rule is re-derived. | carried; lines shifted only, no site in a window hunk |
| G0015 | G0015 | repeated comparison key == 'Enter' | 1/8/12 | **borderline** | Enter/Space activation repeated in 4 handlers; app.js x2 and common.js carry a Spacebar alias. Other Enter sites are send-on-Enter with shift guards, distinct. No shared helper. | carried; lines shifted only, no site in a window hunk |
| G0016 | G0016 | repeated comparison stopAt == 'pr' | 4/10/15 | **real** | Inline stopAt==='pr' at 15 sites; readTaskRunFacts().stopAt is the home, but dispatch-entrance.js:1756 and dispatch-factory.js:444/1170 still re-derive it. | carried; sites identical |
| G0017 | G0017 | text contract marker: [blocked] | 3/7/15 | **borderline** | dispatch-terminal — the parse side is the authority; the emit side is the kit | carried; sites identical |
| G0018 | G0018 | repeated comparison provider == 'linear' | 2/4/7 | **borderline** | workspace-token-refresh defaultResolveExchange | carried; lines shifted only, no site in a window hunk |
| G0019 | G0019 | repeated comparison name == 'AbortError' | 4/6/10 | **noise** | standard fetch-abort check | carried; lines shifted only, no site in a window hunk |
| G0020 | G0020 | string set {'127.0.0.1', 'localhost'} as array [[...].includes, [...].some] | 4/4/8 | **real** | isLocalhostRequest in lib/public-origin.js is the home; server.js inlines the same host test 5x and workspace-api-issue-read.js once. dispatch-entrance.js:245 is an exact-host variant. | carried; lines shifted only, no site in a window hunk |
| G0021 | G0021 | string set {'github', 'github-projects', 'jira', 'linear', 'local'} as switch/array/or-chain [ID.provider, KNO | 3/4/4 | **borderline** | `REGISTRY_PROVIDERS` (`lib/workspace-store.js:4`) restates the provider registry (`providers/registry.js` `getAllProviders`); LOW | carried; lines shifted only, no site in a window hunk |
| G0022 | G0022 | string set {'Apr', 'Aug', 'Dec', 'Feb', 'Jan', 'Jul', +6} as array [months, MONTHS, FLOW_MONTHS] | 4/6/7 | **noise** | Inert month-abbreviation constants copied across lib and public; values cannot drift in meaning. Harmless duplication. | carried; lines shifted only, no site in a window hunk |
| G0023 | G0023 | text contract marker: [evidence] | 5/6/9 | **real** | session-telemetry EVIDENCE_PREFIX | carried; lines shifted only, no site in a window hunk |
| G0024 | G0024 | literal record repeated verbatim {Cache-Control="no-cache", Connection="keep-alive", Content-Type="text/event- | 2/5/7 | **real** | lib/http-keepalive.js | carried; sites identical |
| G0025 | G0025 | record assembled from the same sources {code=ID.code, category=ID.category, retryable=ID.retryable} | 4/7/8 | **real** | lib/errors.js — refusal envelope; `lib/errors.js` is the home | carried; sites identical |
| G0028 | G0029 | record assembled from the same sources {token=ID.token, expiresAt=ID.expiresAt, provider=ID.provider, scope=ID | 3/3/9 | **borderline** | server.js resolver — cache tuple; follows the credential row, no separate decision | carried; lines shifted only, no site in a window hunk |
| G0029 | G0028 | repeated comparison type == 'blocks' | 3/10/12 | **noise** | Linear relation literal at 12 sites, each reading a different field for a different purpose; one external enum meaning. | carried; sites identical |
| G0030 | G0030 | repeated comparison enabled == 'true' | 3/3/3 | **noise** | Same one-line boolean parse in a user-level session toggle (server.js) and a workspace-level settings route (routes/settings.js); different stores and rules. | carried; lines shifted only, no site in a window hunk |
| G0031 | G0032 | repeated comparison harness == 'claude-code' | 4/5/8 | **borderline** | harness == 'claude-code' special case repeats at 8 sites in 5 files (curated list, model mapping, catalog guard, label dedupe); each rule differs, so cost is unclear. | carried; lines shifted only, no site in a window hunk |
| G0032 | G0031 | repeated comparison kind == 'recent' | 3/3/3 | **noise** | 'recent' is a collective-characters doc kind at one site and a home-row kind at two others; different kind spaces, no shared rule re-derived. | carried; lines shifted only, no site in a window hunk |
| G0035 | G0035 | tiny rule copied as a helper (anonymous)(), 8 copies of 1-4 statements | 5/6/8 | **real** | Mock-issue comment shaping is identical in proxy-compute.js:116, task-chat.js:69 and workspace-api-mocks.js:218. Home: buildMockRecapContext in lib/workspace-api-mocks.js; provider shapes differ. | carried; sites identical |
| G0036 | G0036 | repeated comparison status == 'owner' | 4/8/8 | **borderline** | Seven consumers switch on the one answer from readOwnerSeamStatus in lib/workspace-owner.js. The home exists; only the literal is repeated. | carried; sites identical |
| G0037 | G0037 | repeated comparison recommendedAction == 'defer' | 3/4/6 | **borderline** | recommend-recurse | carried; sites identical |
| G0038 | G0038 | repeated comparison type == 'completed' | 5/8/10 | **noise** | Literal is deliberate in follow-on-ratio.js and ship-journey.js (documented as not isCompleted/isTerminalState); roadmap and tree sites are separate reads. | carried; lines shifted only, no site in a window hunk |
| G0039 | G0040 | repeated comparison status == 'ready' | 3/5/7 | **noise** | 'ready' names different enums: close-out status in task-page-loader, close-out.js and session.js versus prompt aiState. Unrelated meanings. | carried; lines shifted only, no site in a window hunk |
| G0040 | G0039 | repeated comparison code == 'OWNER_CHECK_UNAVAILABLE' | 3/5/5 | **borderline** | proxy-preamble — sentinel string shared by two modules; follows the credential row | carried; sites identical |
| G0048 | G0049 | string set {'effort', 'harness', 'model'} as table-keys/array [FIELD_WORDS, [...].filter, OPAQUE_FIELDS] | 4/5/5 | **real** | model/harness/effort restated at 5 sites; model-routing.js FIELDS.AGENT_SESSION already declares them. dispatch-validation OPAQUE_FIELDS adds terminal, a different rule. Home: lib/model-routing.js. | carried; lines shifted only, no site in a window hunk |
| G0049 | G0050 | tiny rule copied as a helper hashKey() (also: hashEmailRecipient, hashState, hashContext, inputHash), 11 copie | 4/9/11 | **noise** | hash helpers, identical by design; now also `account-erasure.js:231` | carried; lines shifted only, no site in a window hunk |
| G0050 | G0048 | tiny rule copied as a helper (anonymous)() (also: brief), 3 copies of 1-4 statements | 3/3/3 | **noise** | new only because LIN-3596 moved the mocks; same shape | carried; sites identical |
| G0064 | G0061 | text contract marker: [failed] | 3/4/17 | **borderline** | dispatch-terminal parses / kit emits | carried; sites identical |
| G0069 | G0068 | repeated comparison turnKind == 'user-initiated' | 4/5/25 | **borderline** | lib/agent-turn.js | carried; sites identical |
| G0070 | G0071 | string set {'pause', 'stop'} as table-keys/or-chain/array [HALT_BANNER_WORD, HALT_MODE_LABELS] | 3/4/4 | **borderline** | runner.mjs literal mirrors HALT_MODES under a contract test (by design). Two label maps (render 'paused', dispatch 'Pause') are the unguarded copies; cost low. | carried; sites identical |
| G0074 | G0075 | repeated comparison state == 'running' | 3/5/22 | **borderline** | 22 sites in 5 files mix stage, ledger-row and session state spaces; runner.mjs re-tests row 'running' ~10 times with no shared predicate. Only that ledger cluster is one rule. | carried; lines shifted only, no site in a window hunk |
| G0075 | G0074 | repeated comparison stateType == 'started' | 3/10/19 | **real** | Task-or-subtask in-progress test copied in render-roadmap.js:86, roadmap-digest-template.js:103 and roadmap-narrative-template.js:122. Home: lib/roadmap.js. | carried; sites identical |
| G0076 | G0076 | record assembled from the same sources {id=ID.id, body=ID.body, createdAt=ID.createdAt} | 4/5/7 | **noise** | comment record, three fields | carried; sites identical |
| G0078 | G0078 | text contract heading: changelog | 3/4/4 | **real** | `lib/workspace-api-mocks.js` `buildMockBrief` (headings as a contract) | carried; sites identical |
| G0079 | G0079 | text contract heading: constraints | 3/4/4 | **real** | as G0088 | carried; sites identical |
| G0080 | G0080 | text contract heading: open questions | 3/4/4 | **real** | as G0088 | carried; sites identical |
| G0081 | G0082 | repeated comparison agentState == 'error' | 3/4/5 | **noise** | Error reads map to different outputs (failed status in task-page-loader, summary text in dashboard-summaries). Not the same decision. | carried; lines shifted only, no site in a window hunk |
| G0088 | G0088 | repeated comparison state == 'done' | 3/4/5 | **noise** | Stage tone, ledger row, task-state settle and ticket markers are four different state machines that share the word; no shared rule is re-derived. | carried; lines shifted only, no site in a window hunk |
| G0091 | G0092 | string set {'merged', 'partial'} as or-chain/Set [ID.closeOut.status, MERGED_STATUSES, ID.status] | 3/4/5 | **real** | `lib/run-closeout-state.js` (owns `PARTIAL`/`MERGED`); export an `isMerged` predicate | carried; sites identical |
| G0095 | G0093 | string set {'assistant', 'user'} as or-chain/if-chain [ID.role] | 4/6/6 | **borderline** | lib/chat-transcript.js filterChatTurns (bypassed ×3) — role filter; `filterChatTurns` is bypassed three times (LIN-2430 residue) | carried; sites identical |
| G0096 | G0096 | repeated comparison type == 'text' | 3/3/5 | **noise** | Three sites are ADF node types, one a Claude content block, one a DOM input type; different type namespaces that share the literal. | carried; lines shifted only, no site in a window hunk |
| G0100 | G0099 | text contract marker: [done] | 3/3/5 | **borderline** | `[done]` marker: the parse side (`dispatch-terminal.js`) is the authority; the kit emits it. Newly mustRule by gaining a third file | carried; sites identical |
| G0101 | G0101 | repeated comparison state == 'waiting' | 3/4/8 | **borderline** | 'waiting' compared inline at 8 sites; UNENDED_STATES now lives in lib/task-state.js:28 (running, queued, waiting). Routing each read is modest cost. | carried; lines shifted only, no site in a window hunk |
| G0102 | G0103 | named constant MONTHS=[Apr,Aug,Dec,Feb,Jan,Jul,Jun,Mar,May,Nov,Oct,Sep] | 3/3/3 | **borderline** | Identical 12-entry month table in home-view, render and task-page-loader; lib/utils/time.js already holds date helpers. Drift unlikely; sharing is cheap but low value. | carried; lines shifted only, no site in a window hunk |
| G0110 | G0108 | repeated comparison provider == 'local' | 4/4/4 | **borderline** | Four different uses, but workspace-api-audit.js:36 re-inlines shouldMockAi's test-plus-local predicate despite its comment. Needs one home or a documented decision. | carried; sites identical |
| G0111 | G0109 | string set {'number', 'string'} as or-chain [typeofID] | 3/3/3 | **noise** | isScalar, the brief's date coercion and toEpochMs share a typeof idiom but answer different questions; no drifting rule. | carried; lines shifted only, no site in a window hunk |
| G0113 | G0115 | tiny rule copied as a helper escapeHtml() (also: escapeXml), 3 copies of 1-4 statements | 3/3/3 | **noise** | escape helpers per output format | carried; sites identical |
| G0116 | G0119 | repeated comparison kind == 'implementation' | 3/5/5 | **real** | dispatch-factory.js:812 re-inlines the kind and identifier clauses of isPilotEligible (lib/file-pointer.js), which its comment says store and recompute share. Route it through isPilotEligible. | carried; lines shifted only, no site in a window hunk |
| G0118 | G0116 | repeated comparison disposition == 'task-bound' | 3/3/7 | **borderline** | Server disposition enum; observation.js branches on it 5 times with different actions. Only the deliverRulingStampOnly pair (2868, 3295) is one duplicated rule; cost unclear. | carried; lines shifted only, no site in a window hunk |
| G0122 | G0123 | named constant UUID_REGEX=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i | 3/3/3 | **borderline** | lib/workspace.js; `UUID_REGEX` copies 6 → 3 | carried; sites identical |
| G0123 | G0122 | string set {'0', '1', '2', '3', '4'} as table-keys [PRIORITY_WORDS, FLOW_PRIO, pLabels] | 4/6/8 | **real** | Priority number-to-name map re-declared at 6+ sites (home-view, local provider, swim x2, swipe, roadmap template); render.js already exports PRIORITY_OPTION_LABELS. Home: lib/render.js. | carried; sites identical |
| G0124 | G0126 | repeated comparison kind == 'custom' | 3/3/3 | **noise** | Quota count (collective store), churn filter and label suppression on 'custom' answer three different questions over different row types. | carried; sites identical |
| G0133 | G0136 | tiny rule copied as a helper (anonymous)(), 9 copies of 1-4 statements | 3/9/9 | **noise** | Nine stream-event callbacks, each a distinct consumer; the shared body is one token append. Not one decision to home. | carried; lines shifted only, no site in a window hunk |
| G0134 | G0137 | repeated comparison state == 'failed' | 3/4/7 | **borderline** | `state == 'failed'` in task-state.js roll-ups and attention (`:144,:168,:275,:345`) and in home-view / task-board counts; `task-page-loader.js:648` (`plainRunState`, LIN-4106) is a run state with the same word. Two state domains share one literal; the decision that matters is `task-state.js:168`. Not a Drift finding. | carried; lines shifted only, no site in a window hunk |
| G0137 | G0140 | string set {'queued', 'running'} as or-chain [ID.state, ID.outcome] | 3/4/5 | **real** | running//queued test is inline at home-view:59, render-task-page:245/283, task-state:143 and recent-runs:82; task-state.js exports isOpenState/isUnendedState but not this set. Home: lib/task-state.js. | re-read: LIN-4048 moved the running/queued test above model.finished in renderNextLine (render-task-page.js:268); same inline literal, no helper used. Touched without consolidation; ruling holds. |
| G0141 | G0142 | repeated comparison status == 'done' | 3/3/5 | **noise** | done status literal; unrelated meanings | carried; lines shifted only, no site in a window hunk |
| G0142 | G0141 | named constant SWEEP_INSTANCE_PREFIX="sweep:v1:" | 3/3/3 | **real** | `lib/observer-sweep.js` (the writer; uses an inline literal at :449) | carried; sites identical |
| G0152 | G0153 | near-duplicate function buildMockRecapContext() (also: buildMockRecapContextFromFixtures, buildMockTaskContext | 3/3/3 | **real** | `lib/workspace-api-mocks.js` `buildMockRecapContext` | carried; sites identical |
| G0153 | G0156 | tiny rule copied as a helper (anonymous)(), 3 copies of 1-4 statements | 3/3/3 | **real** | Same mock child shaping in workspace-api-mocks.js:211, proxy-compute.js:122 and task-chat.js:75; home buildMockRecapContext in lib/workspace-api-mocks.js. Pairs with G0035. | carried; sites identical |
| G0155 | G0158 | repeated comparison category == 'auth' | 4/4/4 | **noise** | Three sites read a classification they already hold; isAuthError exists for bare errors. Trivial token comparison, no drift risk. | carried; lines shifted only, no site in a window hunk |
| G0157 | G0154 | repeated comparison phase == 'result' | 3/3/3 | **noise** | phase literal in one module | carried; sites identical |
| G0159 | G0159 | tiny rule copied as a helper stripCodeFence() (also: trimToNull, parseRecommendedAction, parseDeferTo, parseWh | 4/4/6 | **noise** | small parse helpers, coincidental similarity | carried; sites identical |
| G0166 | G0168 | repeated comparison state == 'needs-you' | 3/3/6 | **real** | needsAPerson(state) already exists in task-state.js, yet task-state.js:275 inlines 'needs-you // failed' instead of calling it. Other sites are per-state text or lists. Home: lib/task-state.js. | re-read: render-task-page.js:272 `state === 'needs-you' && model.waitingFor === 'ruling'` unchanged text, shifted +1 by LIN-4048; ruling holds. |
| G0167 | G0169 | repeated comparison state == 'queued' | 3/3/7 | **noise** | Queued checks are per-site labels, tones, selection and mapping; the shared in-flight test is G0148, so this is not a separate rule. | carried; lines shifted only, no site in a window hunk |
| G0168 | G0170 | repeated comparison waitingFor == 'ruling' | 3/3/7 | **borderline** | task-page-loader tests model.waitingFor==='ruling' at 938, 991, 1017, 1471 though 991 derives waitingOnRuling once; one local would own it. Low cost. | re-read: same line as G0166 (render-task-page.js:272), unchanged text; ruling holds. |
| G0169 | G0166 | tiny rule copied as a helper _issueRef() (also: refOf, projectNeighbor), 3 copies of 1-4 statements | 3/3/3 | **noise** | Three ref projections returning different fields under different names. Not one decision. | carried; sites identical |
| G0174 | G0176 | tiny rule copied as a helper normalizePrivateKey() (also: cleanClaim, stripCodeBlockFences), 3 copies of 1-4 s | 3/3/3 | **noise** | string cleanup helpers, coincidental | carried; sites identical |
| G0175 | G0173 | tiny rule copied as a helper constructor(), 5 copies of 1-4 statements | 3/5/5 | **noise** | store constructors — reused from 10-18 G0149 (lead matched G0359, a groupKey twin) | carried; sites identical |
| G0201 | G0186 | string set {'standard', 'stepper'} as array/ternary-chain [AUTOPILOT_VARIANTS, ID.variant] | 3/3/3 | **borderline** | `lib/prompts/autopilot-kickoff.js` `AUTOPILOT_VARIANTS` — `AUTOPILOT_VARIANTS` already exists; callers should import it | carried; sites identical |
| G0214 | G0210 | repeated comparison variant == 'stepper' | 3/3/3 | **noise** | Three local reads of a variant literal; the allowed-variant validator is elsewhere. Each read is local. | carried; sites identical |
| G0220 | G0221 | string set {'backlog', 'canceled', 'completed', 'duplicate', 'started', 'unstarted'} as ternary-chain/table-ke | 3/5/11 | **real** | `lib/providers/state-map.js` `getStateDisplay`/`getStateOrder` | carried; sites identical |
| G0221 | G0222 | repeated comparison state == 'parked' | 3/3/3 | **noise** | Three sites: a text line, a task-state switch to 'waiting', and one evidence check on the same field; per-site, no shared rule re-derived. | carried; lines shifted only, no site in a window hunk |
| G0230 | G0236 | repeated comparison outcome == 'self-resolved' | 3/4/7 | **noise** | Machine-stamped outcome with one producer (ticket-close-closer.js); readers apply the same bucket. Not a duplicated decision. | carried; lines shifted only, no site in a window hunk |
| G0238 | G0246 | text contract marker: [ticket-closer] | 3/4/4 | **borderline** | Tag hardcoded in three route catch logs while ticket-close-closer.js owns a LOG const. A console prefix, not a posted marker; cost unclear. | carried; lines shifted only, no site in a window hunk |
| G0242 | G0240 | named constant UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i | 3/3/3 | **noise** | (`lib/workspace.js` `UUID_REGEX` exists) | carried; sites identical |
| G0250 | G0253 | near-duplicate function find() (also: componentFind), ~9 statements, fuzzy | 3/4/4 | **noise** | union-find helper, generic | carried; lines shifted only, no site in a window hunk |
| G0265 | G0261 | string set {'backlog', 'started', 'unstarted'} as switch/array/table-keys [eligibleStates, STATUS_RANK] | 3/4/4 | **borderline** | `lib/providers/state-map.js` (`isTerminalState`, `getStateOrder`) — state rank sets; covered by state-type-label-rank-maps | carried; sites identical |
| G0270 | G0266 | repeated comparison kind == 'evidence' | 3/3/3 | **noise** | feedback kind literal | carried; sites identical |
| G0286 | G0288 | tiny rule copied as a helper (anonymous)() (also: loadLoops), 3 copies of 1-4 statements | 3/3/3 | **borderline** | The 13 calls already route through getLoopsForWorkspace; the duplicated part is the deps bundle plus lean:true in three fan-outs. Low-value consolidation. | carried; sites identical |
| G0313 | G0305 | repeated comparison harness == 'opencode' | 3/4/4 | **noise** | Four opencode checks are separate rules (option list, web-target refusal, model-id shape, running-total usage) that share a literal. | carried; sites identical |
| G0331 | G0333 | text contract marker: [close-out-merges] | 3/3/3 | **noise** | Log-prefix literal repeated in two route catches while lib/close-out-merges.js keeps its own LOG; inert console tag, no consumer or test depends on it. | carried; lines shifted only, no site in a window hunk |
| G0338 | G0332 | string set {'backlog', 'unstarted'} as array/or-chain [stateTypes, ID.state.type] | 3/3/3 | **real** | Ready set is queue-config stateTypes, re-inlined in recommendation-facts.js:201 and workspace-api-mocks.js:68. The isReadyState helper from 10-23 is gone; queue-config is the home. | carried; sites identical |
| G0360 | G0363 | repeated comparison verdict == 'credential_dead' | 3/3/3 | **real** | Server sites use exported CREDENTIAL_DEAD_VERDICT, but public/proxy.js:256 hardcodes 'credential_dead'. A rename would silently empty the browser filter. Home: lib/credential-state.js. | carried; sites identical |
| G0386 | G0385 | string set {'Deep Dive', 'Front Page', 'The Column', 'The Wire', 'Weather'} as array [VALID_SECTIONS, DESK_ORD | 3/4/4 | **real** | `lib/ship-biscuit.js` `DESKS` (exported) | carried; sites identical |
| G0387 | G0386 | named constant MS_PER_DAY=86400000 | 3/3/3 | **noise** | `MS_PER_DAY` constant, inert | carried; sites identical |
| G0403 | G0413 | repeated comparison setting == 'halt' | 3/3/6 | **real** | Owner-only halt undo gate repeats at render-settings-workspace:49 and :215 while the route enforces it via haltRefusal; one predicate in workspace-change-log.js would own it. Home: lib/workspace-change-log.js. | carried; sites identical |
| G0405 | G0403 | string set {'no-owner', 'not-owner', 'owner', 'unavailable'} as array/switch/or-chain/if-chain | 3/3/4 | **real** | owner/not-owner/no-owner/unavailable validated in workspace-owner, exported as RUNNER_SETUP_STATES in render-runner-setup, and re-mapped by an if-chain in routes/runner-setup.js:70. Home: lib/workspace-owner.js. | carried; sites identical |
| G0414 | G0425 | near-duplicate function stableStringify(), ~7 statements, same vocabulary (dialect copy or close variant) | 3/3/3 | **real** | one export of `stableStringify` in `lib/recap-cache.js` or a leaf module (LIN-3736 already proposes `lib/utils/`); 3 copies: `recap-cache.js:27`, `run-summary-cache.js:32`, `account-erasure.js:235` | carried; lines shifted only, no site in a window hunk |
| G0428 | G0426 | tiny rule copied as a helper cleanup(), 3 copies of 1-4 statements | 3/3/3 | **noise** | `cleanup()` per store | carried; sites identical |
| G0431 | G0431 | tiny rule copied as a helper constructor(), 5 copies of 1-4 statements | 3/5/5 | **noise** | Five cache and store constructors with different option sets and no shared base; a constructor signature is not a rule. | carried; sites identical |
| G0473 | G0469 | tiny rule copied as a helper stableById() (also: byWorkspaceId), 3 copies of 1-4 statements | 3/3/3 | **noise** | sort comparators | carried; sites identical |
| G0480 | G0479 | repeated comparison stateType == 'backlog' | 3/3/3 | **borderline** | keepCard backlog rule is copied into public/ship.js:166 from lib/ship-layout.js:353; ship.js header says the inlining is deliberate (no build step). Drift risk only. | carried; sites identical |
| G0512 | G0511 | string set {'E', 'N', 'NE', 'NW', 'S', 'SE', +2} as array/table-keys [ORIENTATION_BEARINGS, BEARING_TO_ANGLE, | 3/3/5 | **noise** | (`lib/ship-layout.js` `BEARINGS` exists) | carried; sites identical |
| (left) | G0217 | repeated comparison outcome == 'dismissed' | now G0292 table 2/3/4 | **real** (re-ruled) | Re-key, not a resolution: the ternary at dashboard-rulings.js:318 (d7ceb373) went, and the or-chain G0294 {answered, dismissed} grew to 4 files (workspace-api-scan.js:389, LIN-4241). The closed set is now the settled-ruling guard's decision, restated at dashboard-rulings.js:327, workspace-api-issue-write.js:162,168,646 and workspace-api-scan.js:389. Home: lib/task-decisions-store.js (owner of the closed set, :88/:101/:328), beside readOutcome (:506), mirroring the loop side's isDecisionSettledIn (digest-feedback.js:116). New row ruling-settled-row-predicate-inline (LOW). | left `mustRule` by a re-key |

## Census table groups (309; no ruling, per the method)

Status is against `d7ceb373` under the one HEAD guide.

| id | det | decision (truncated at 90) | a/f/s | status |
|---|---|---|---|---|
| G0026 | cmp | repeated comparison target == 'local' | 2/5/5 | unchanged |
| G0027 | set+discrim | string set {'aborted', 'done', 'failed', 'skipped'} as array/Set/or-chain/table-keys/if-ch | 2/8/10 | unchanged |
| G0033 | discrim | string set {'cancelled', 'expired'} as or-chain [ID.historyStatus, ID.status] | 1/4/4 | unchanged |
| G0034 | cmp | repeated comparison status == 'queued' | 2/5/6 | unchanged |
| G0041 | clone | tiny rule copied as a helper clear(), 5 copies of 1-4 statements | 2/5/5 | unchanged |
| G0042 | cmp | repeated comparison disposition == 'resumable' | 2/4/8 | unchanged |
| G0043 | contract | text contract marker: [db-indexes] | 2/2/9 | unchanged |
| G0044 | contract | text contract heading: what ci did not prove | 2/6/8 | unchanged |
| G0045 | cmp | repeated comparison marker == 'pending' | 1/4/7 | unchanged |
| G0046 | cmp | repeated comparison provider == 'github' | 2/2/3 | unchanged |
| G0047 | cmp | repeated comparison provider == 'github-projects' | 2/2/2 | unchanged |
| G0051 | record | record assembled from the same sources {id=ID.id, title=ID.title, labels=LogicalExpression | 2/3/3 | unchanged |
| G0052 | const | named constant TOKEN_REFRESH_BUFFER_MS=300000 | 2/2/2 | unchanged |
| G0053 | set | string set {'LINEAR_CLIENT_ID', 'LINEAR_CLIENT_SECRET', 'LINEAR_REDIRECT_URI'} as array [O | 2/2/2 | unchanged |
| G0054 | record | literal record repeated verbatim {effort=null, harness=null, model=null} | 2/2/2 | unchanged |
| G0055 | cmp | repeated comparison rawTeam == 'all' | 2/2/2 | unchanged |
| G0056 | contract | text contract marker: [ci-wake-sweep] | 2/2/5 | unchanged |
| G0057 | contract | text contract marker: [liveness-alarm-sweep] | 2/2/2 | unchanged |
| G0058 | cmp | repeated comparison kind == 'more-of-parent' | 2/2/3 | unchanged |
| G0059 | cmp | repeated comparison kind == 'search' | 2/2/2 | unchanged |
| G0060 | cmp | repeated comparison getAttribute() == 'true' | 1/4/7 | unchanged |
| G0061 | record | record assembled from the same sources {urlKey=ID.urlKey, workspaceId=ID.id, accountId=ID. | 2/2/2 | unchanged |
| G0062 | cmp | repeated comparison kind == 'capture' | 2/2/2 | unchanged |
| G0063 | cmp | repeated comparison urlKey == 'test-workspace' | 2/2/6 | unchanged |
| G0065 | record | record assembled from the same sources {githubEnabled=getProvider().entryCta.isConfigured( | 2/2/2 | unchanged |
| G0066 | cmp | repeated comparison via == 'proxy' | 2/2/3 | unchanged |
| G0067 | set+discrim | string set {'github', 'github-projects'} as Set/array/or-chain [REMINT_KINDS, INSTALLATION | 2/6/6 | unchanged |
| G0068 | clone | near-duplicate function clear() (also: clearHistory), ~7 statements, fuzzy | 1/4/4 | unchanged |
| G0071 | const | named constant CONTEXT_FETCH_TIMEOUT_MS=45000 | 2/2/2 | unchanged |
| G0072 | cmp | repeated comparison state == 'record' | 2/3/3 | unchanged |
| G0073 | contract | text contract marker: [dispatch] | 2/3/4 | unchanged |
| G0077 | cmp | repeated comparison target == 'web' | 2/4/5 | unchanged |
| G0082 | cmp | repeated comparison source == 'free' | 2/3/3 | unchanged |
| G0083 | set+discrim | string set {'decision-answer', 'decision-withdrawal-reversed', 'decision-withdrawn'} as or | 2/5/5 | unchanged |
| G0084 | cmp | repeated comparison mode == 'add-source' | 2/6/28 | unchanged |
| G0085 | const | named constant DANGEROUS_CHARS_REGEX=/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/ | 2/4/4 | unchanged |
| G0086 | const | named constant MAX_NAME_LENGTH=1000 | 2/4/4 | unchanged |
| G0087 | cmp | repeated comparison kind == 'decision' | 1/4/6 | unchanged |
| G0089 | clone | tiny rule copied as a helper onEvent() (also: (anonymous)), 5 copies of 1-4 statements | 2/4/5 | unchanged |
| G0090 | clone | tiny rule copied as a helper (anonymous)(), 3 copies of 1-4 statements | 2/3/3 | unchanged |
| G0092 | contract | text contract marker: [skipped] | 2/3/6 | unchanged |
| G0093 | clone | tiny rule copied as a helper buildPromptFilename(), 3 copies of 1-4 statements | 2/3/3 | unchanged |
| G0094 | cmp | repeated comparison readyState == 'loading' | 1/4/4 | unchanged |
| G0097 | clone | near-duplicate function clear(), ~7 statements, structurally identical | 2/8/8 | unchanged |
| G0098 | contract | text contract marker: [aborted] | 2/3/9 | unchanged |
| G0099 | clone | near-duplicate function (anonymous)() (also: relayDispatchRefusal), ~10 statements, same v | 2/2/2 | unchanged |
| G0103 | cmp | repeated comparison phase == 'proposed' | 2/4/5 | unchanged |
| G0104 | cmp | repeated comparison value == 'true' | 2/3/3 | unchanged |
| G0105 | clone | tiny rule copied as a helper (anonymous)(), 5 copies of 1-4 statements | 1/3/5 | unchanged |
| G0106 | cmp | repeated comparison tagName == 'SELECT' | 1/3/3 | unchanged |
| G0109 | cmp | repeated comparison id == '__periodicals__' | 2/4/5 | unchanged |
| G0112 | cmp | repeated comparison kind == 'recap' | 2/2/3 | unchanged |
| G0114 | cmp | repeated comparison name == 'list_pending_decisions' | 2/3/3 | unchanged |
| G0115 | set+discrim | string set {'done', 'failed'} as or-chain/table-keys [ID.terminalStatus, PILL_GLYPHS] | 2/3/3 | unchanged |
| G0117 | cmp | repeated comparison state == 'closed' | 2/5/5 | unchanged |
| G0119 | set | string set {'autopilot', 'blocked', 'breakdown', 'bug', 'close-out', 'context', +15} as ta | 2/3/3 | unchanged |
| G0120 | clone | tiny rule copied as a helper enqueueGuard() (also: haltRefusal), 3 copies of 1-4 statement | 1/3/3 | unchanged |
| G0125 | cmp | repeated comparison section == 'recent-activity' | 2/3/5 | unchanged |
| G0127 | discrim | string set {'1', 'true'} as or-chain [ID.query.cachedOnly, ID.query.noDescend, ID.query.di | 2/3/6 | unchanged |
| G0128 | clone | tiny rule copied as a helper header() (also: setupNoticeHtml), 3 copies of 1-4 statements | 1/3/3 | unchanged |
| G0129 | record | record assembled from the same sources {urlKey=ID.urlKey, identifier=ID.identifier, source | 1/3/3 | unchanged |
| G0130 | set | string set {'backlog', 'done', 'failed', 'in-progress', 'todo'} as table-keys [STATE_GLYPH | 2/3/3 | unchanged |
| G0131 | cmp | repeated comparison kind == 'bootstrap' | 2/3/9 | unchanged |
| G0132 | record | record assembled from the same sources {urlKey=ID.urlKey, workspaceId=ID.id, ownerAccountI | 2/3/3 | unchanged |
| G0135 | cmp | repeated comparison section == 'prompt' | 2/2/2 | unchanged |
| G0136 | cmp | repeated comparison section == 'reasoning' | 2/2/2 | unchanged |
| G0143 | cmp | repeated comparison toLowerCase() == 'bug' | 2/3/3 | unchanged |
| G0145 | cmp | repeated comparison finishReason == 'length' | 2/4/5 | unchanged |
| G0146 | clone | tiny rule copied as a helper ui(), 4 copies of 1-4 statements | 1/4/4 | unchanged |
| G0147 | cmp | repeated comparison agentState == 'queued' | 2/3/4 | unchanged |
| G0148 | contract | text contract heading: workflow | 1/3/14 | unchanged |
| G0151 | cmp | repeated comparison protocol == 'https:' | 2/2/2 | unchanged |
| G0154 | const | named constant HOUR_MS=3600000 | 2/4/4 | unchanged |
| G0156 | const | named constant COMPANION_INSTANCE_PREFIX="companion:v1:" | 2/3/3 | unchanged |
| G0158 | set+discrim | string set {'complete', 'error'} as Set/or-chain [LOOP_TERMINAL_AGENT_STATES, TERMINAL_AGE | 2/3/4 | unchanged |
| G0160 | const | named constant POLL_MS=5000 | 1/3/3 | unchanged |
| G0162 | cmp | repeated comparison phase == 'error' | 2/3/3 | unchanged |
| G0163 | clone | tiny rule copied as a helper constructor(), 6 copies of 1-4 statements | 2/6/6 | unchanged |
| G0164 | clone | tiny rule copied as a helper (anonymous)(), 6 copies of 1-4 statements | 1/4/6 | unchanged |
| G0170 | record | record assembled from the same sources {runs=ID.runs, priced=ID.priced, unpriced=ID.unpric | 2/2/2 | unchanged |
| G0171 | clone | tiny rule copied as a helper (anonymous)(), 5 copies of 1-4 statements | 1/3/5 | unchanged |
| G0176 | cmp | repeated comparison source == 'live' | 1/3/4 | unchanged |
| G0177 | clone | near-duplicate function relativeTime() (also: renderDeployInfo), ~22 statements, same voca | 2/2/2 | unchanged |
| G0181 | cmp | repeated comparison disposition == 'gone' | 2/2/5 | unchanged |
| G0182 | cmp | repeated comparison state == 'open' | 2/5/6 | unchanged |
| G0183 | set+discrim | string set {'http:', 'https:'} as array/or-chain [[...].includes, ID.protocol] | 2/4/4 | unchanged |
| G0184 | cmp | repeated comparison turnKind == 'boot' | 2/3/18 | unchanged |
| G0185 | clone | near-duplicate function computeFitZoom(), ~11 statements, same vocabulary (dialect copy or | 2/2/2 | unchanged |
| G0186 | clone | near-duplicate function firstPromptLine() (also: toStackHeadline), ~6 statements, fuzzy | 2/2/2 | unchanged |
| G0187 | set | string set {'canceled', 'completed', 'duplicate'} as array [TERMINAL_TYPES] | 2/2/2 | unchanged |
| G0188 | cmp | repeated comparison kind == 'brief' | 2/3/4 | unchanged |
| G0189 | clone | tiny rule copied as a helper msSince() (also: (anonymous)), 3 copies of 1-4 statements | 2/3/3 | unchanged |
| G0190 | clone | near-duplicate function (anonymous)(), ~7 statements, same vocabulary (dialect copy or clo | 2/2/2 | unchanged |
| G0191 | clone | near-duplicate function clampTimelineWindow() (also: clampWindow), ~12 statements, fuzzy | 2/2/2 | unchanged |
| G0192 | clone | near-duplicate function computeTimelineFit(), ~10 statements, same vocabulary (dialect cop | 2/2/2 | unchanged |
| G0193 | clone | near-duplicate function computeTimelineZoom(), ~15 statements, same vocabulary (dialect co | 2/2/2 | unchanged |
| G0194 | clone | near-duplicate function renderChip(), ~8 statements, fuzzy | 2/2/2 | unchanged |
| G0195 | clone | near-duplicate function renderSegmentBar(), ~17 statements, fuzzy | 2/2/2 | unchanged |
| G0196 | clone | near-duplicate function renderStatusPill(), ~18 statements, fuzzy | 2/2/2 | unchanged |
| G0197 | clone | near-duplicate function renderSurface(), ~11 statements, fuzzy | 2/2/2 | unchanged |
| G0198 | clone | near-duplicate function renderTag(), ~11 statements, fuzzy | 2/2/2 | unchanged |
| G0199 | cmp | repeated comparison state == 'unknown' | 2/3/5 | unchanged |
| G0200 | cmp | repeated comparison status == 'aborted' | 1/3/11 | unchanged |
| G0202 | cmp | repeated comparison status == 'skipped' | 2/3/3 | unchanged |
| G0203 | record | literal record repeated verbatim {label="__ai__", name=null, why="Generate the next prompt | 2/2/2 | unchanged |
| G0204 | clone | near-duplicate function groupLoopsByLineage() (also: runsByLineage), ~10 statements, struc | 2/2/2 | unchanged |
| G0205 | cmp | repeated comparison rung == 'run-task' | 2/2/2 | unchanged |
| G0206 | set | string set {'done', 'next-step', 'pr'} as array | 2/2/2 | unchanged |
| G0207 | discrim | string set {'done', 'pr'} as or-chain [ID.filledRung, ID()] | 2/2/3 | unchanged |
| G0208 | cmp | repeated comparison status == 'merged' | 2/3/4 | unchanged |
| G0209 | clone | tiny rule copied as a helper (anonymous)(), 3 copies of 1-4 statements | 1/3/3 | unchanged |
| G0215 | contract | text contract marker: [working] | 2/3/3 | unchanged |
| G0216 | record | record assembled from the same sources {remaining=ID.remaining, limit=ID.limit} | 2/2/3 | unchanged |
| G0219 | discrim | string set {'closed', 'multiple-prs', 'no-pr', 'not-ready'} as or-chain [ID.status] | 2/3/3 | unchanged |
| G0222 | set | string set {'cdn.linear.app', 'linear.app', 'uploads.linear.app'} as Set [LINEAR_IMAGE_HOS | 2/2/2 | unchanged |
| G0223 | set+discrim | string set {'home-up-next', 'in-progress', 'project', 'recent-activity'} as or-chain/array | 2/2/2 | unchanged |
| G0224 | cmp | repeated comparison singleUse == 'true' | 2/2/2 | unchanged |
| G0225 | set | string set {'High', 'Low', 'Medium', 'No priority', 'Urgent'} as array [PRIORITY_NAMES, PR | 2/2/2 | unchanged |
| G0226 | record | record assembled from the same sources {promptMeta=ID.promptMeta, defaultPromptKeys=ID.def | 2/2/2 | unchanged |
| G0227 | cmp | repeated comparison pageMode == 'backlog' | 2/2/2 | unchanged |
| G0228 | record | literal record repeated verbatim {lastCensusSnapshot=null, lastCensusStateHash=null, lastT | 2/2/2 | unchanged |
| G0231 | contract | text contract marker: [usage] | 1/3/4 | grown |
| G0232 | const | named constant MAX_IDENTIFIER_LENGTH=100 | 2/2/2 | unchanged |
| G0233 | cmp | repeated comparison built == 'unknown' | 2/2/2 | unchanged |
| G0234 | cmp | repeated comparison status == 'proposed' | 2/2/2 | unchanged |
| G0235 | cmp | repeated comparison tierOf() == 'deferred' | 2/2/3 | unchanged |
| G0236 | cmp | repeated comparison mergedBy == 'close-out' | 2/2/2 | unchanged |
| G0241 | cmp | repeated comparison reason == 'free-tier' | 2/2/3 | unchanged |
| G0243 | clone | tiny rule copied as a helper countFor() (also: lookupsFor), 3 copies of 1-4 statements | 2/3/3 | unchanged |
| G0244 | const | named constant ARCHIVE_PAGE_SIZE=30 | 2/2/2 | unchanged |
| G0245 | const | named constant STALE_AFTER_MS=86400000 | 2/2/2 | unchanged |
| G0247 | cmp | repeated comparison status == 'error' | 2/2/3 | unchanged |
| G0248 | cmp | repeated comparison view == 'sessions' | 2/2/2 | unchanged |
| G0253 | clone | near-duplicate function constructor(), ~5 statements, fuzzy | 1/3/3 | unchanged |
| G0255 | clone | tiny rule copied as a helper buildBriefMessages() (also: buildRoadmapGapMessages, buildRoa | 2/8/8 | unchanged |
| G0256 | clone | near-duplicate function (anonymous)(), ~6 statements, fuzzy | 2/2/2 | unchanged |
| G0257 | cmp | repeated comparison state == 'none' | 2/2/2 | unchanged |
| G0259 | cmp | repeated comparison status == 'priced' | 2/2/3 | unchanged |
| G0261 | cmp | repeated comparison state == 'dead' | 2/2/3 | unchanged |
| G0262 | cmp | repeated comparison turnKind == 'auto-wake' | 2/2/5 | unchanged |
| G0266 | clone | tiny rule copied as a helper isId() (also: shortString, (anonymous), isSafeSingleQuotedLit | 1/4/6 | unchanged |
| G0269 | discrim | string set {'gone', 'resumable', 'task-bound'} as or-chain | 2/2/2 | unchanged |
| G0271 | cmp | repeated comparison openRouterSource == 'free' | 2/3/3 | unchanged |
| G0274 | record | record assembled from the same sources {urlKey=ID.proxyUrlKey, createdBy=ID.proxyCreatedBy | 2/2/2 | unchanged |
| G0275 | cmp | repeated comparison kind == 'periodical' | 2/2/2 | unchanged |
| G0277 | clone | near-duplicate function deleteByConnection() (also: deleteUserPreferences, deleteWorkspace | 1/3/3 | unchanged |
| G0278 | cmp | repeated comparison by == 'close-out' | 2/2/2 | unchanged |
| G0281 | cmp | repeated comparison viewer == 'owner' | 2/2/3 | unchanged |
| G0284 | clone | near-duplicate function listForWorkspaces() (also: listUnansweredForWorkspaces), ~7 statem | 1/3/3 | unchanged |
| G0285 | cmp | repeated comparison mode == 'new' | 1/3/5 | unchanged |
| G0287 | cmp | repeated comparison category == 'upstream' | 2/2/2 | unchanged |
| G0288 | cmp | repeated comparison kind == 'backlog' | 2/2/2 | unchanged |
| G0289 | cmp | repeated comparison tier == 'not reported' | 2/2/2 | unchanged |
| G0292 | cmp | repeated comparison outcome == 'dismissed' | 2/3/4 | shrunk |
| G0293 | cmp | repeated comparison status == 'fulfilled' | 2/4/6 | unchanged |
| G0294 | discrim | string set {'answered', 'dismissed'} as or-chain [ID.outcome] | 2/4/7 | grown |
| G0295 | record | literal record repeated verbatim {effort="none", harness="none", model="none"} | 2/2/2 | unchanged |
| G0296 | clone | near-duplicate function cleanup(), ~8 statements, fuzzy | 1/3/3 | unchanged |
| G0297 | clone | tiny rule copied as a helper (anonymous)(), 4 copies of 1-4 statements | 2/3/4 | unchanged |
| G0299 | cmp | repeated comparison kind == 'close-out' | 2/2/2 | unchanged |
| G0302 | cmp | repeated comparison state == 'reached' | 2/2/2 | unchanged |
| G0303 | set | string set {'acting', 'deciding', 'orienting', 'reporting', 'watching'} as array [PROXY_PH | 2/2/2 | unchanged |
| G0304 | cmp | repeated comparison verdict == 'approve' | 1/3/3 | unchanged |
| G0305 | clone | tiny rule copied as a helper resolveCanonicalDegraded() (also: resolveCanonicalOrMiss, can | 1/3/3 | unchanged |
| G0308 | set | string set {'blocked', 'queued', 'resolved', 'silent', 'terminal', 'unknown', +1} as array | 2/3/3 | unchanged |
| G0312 | discrim | string set {'indeterminate', 'mid-turn'} as or-chain [ID.disposition] | 2/2/2 | unchanged |
| G0321 | set | string set {'dispatch', 'record', 'resume'} as Set/table-keys [ON_ANSWER_EFFECTS, EFFECT_C | 2/2/2 | unchanged |
| G0324 | clone | near-duplicate function get(), ~7 statements, fuzzy | 2/6/6 | unchanged |
| G0329 | set | string set {'fable', 'haiku', 'opus', 'sonnet'} as array [CLAUDE_MAPPABLE_MODEL_FAMILIES] | 2/2/3 | unchanged |
| G0330 | cmp | repeated comparison format == 'md' | 2/2/2 | unchanged |
| G0332 | record | literal record repeated verbatim {_id=0, createdAt=1, createdBy=1, urlKey=1, workspaceId=1 | 2/2/2 | unchanged |
| G0337 | cmp | repeated comparison role == 'owner' | 2/3/4 | unchanged |
| G0340 | cmp | repeated comparison kind == 'decision-withdrawn' | 2/2/2 | unchanged |
| G0341 | cmp | repeated comparison name == 'send_follow_up' | 2/2/3 | unchanged |
| G0344 | discrim | string set {'comment', 'description'} as ternary-chain/or-chain [ID.where] | 2/2/2 | unchanged |
| G0345 | cmp | repeated comparison haltMode == 'pause' | 2/2/2 | unchanged |
| G0346 | cmp | repeated comparison haltMode == 'stop' | 2/2/2 | unchanged |
| G0348 | cmp | repeated comparison view == 'digest' | 2/2/2 | unchanged |
| G0349 | cmp | repeated comparison role == 'user' | 2/3/6 | unchanged |
| G0351 | const | named constant DAY_MS=86400000 | 2/2/2 | unchanged |
| G0357 | cmp | repeated comparison message == 'reverseOutcome: row is not self-resolved' | 2/2/2 | unchanged |
| G0359 | clone | near-duplicate function _pruneToCapacity(), ~6 statements, fuzzy | 2/5/5 | unchanged |
| G0361 | clone | tiny rule copied as a helper clampText(), 3 copies of 1-4 statements | 2/3/3 | unchanged |
| G0366 | cmp | repeated comparison name == 'linear' | 2/2/2 | unchanged |
| G0367 | cmp | repeated comparison s == 'complete' | 2/2/2 | unchanged |
| G0368 | const | named constant MAX_REASON_LENGTH=500 | 2/2/2 | unchanged |
| G0369 | const | named constant TIMELINE_WINDOW_MS=86400000 | 2/2/2 | unchanged |
| G0374 | set | string set {'inside', 'outside', 'total', 'unknown'} as array/table-keys [[...].every, SCO | 2/2/2 | unchanged |
| G0376 | const | named constant LANE_KEYS=[blocked,queued,resolved,silent,terminal,unknown,working] | 2/2/2 | unchanged |
| G0379 | clone | near-duplicate function peakToolCount() (also: toolPeakOf), ~9 statements, fuzzy | 2/2/2 | unchanged |
| G0380 | cmp | repeated comparison variant == 'standard' | 2/2/2 | unchanged |
| G0384 | set | string set {'/common-actions.css', '/escalation-kpis.css', '/style.css'} as array [stylesh | 1/3/3 | unchanged |
| G0389 | cmp | repeated comparison code == 'ERR_FR_TOO_MANY_REDIRECTS' | 2/2/2 | unchanged |
| G0391 | cmp | repeated comparison message == 'unexpected redirect' | 2/2/2 | unchanged |
| G0392 | record | literal record repeated verbatim {_id=0, createdAt=1, createdBy=1, urlKey=1} | 2/2/2 | unchanged |
| G0398 | set | string set {'first go', 'firstGo'} as array | 2/2/2 | unchanged |
| G0399 | set | string set {'login', 'signed up'} as array | 2/2/2 | unchanged |
| G0400 | set | string set {'merge clicked', 'mergeClicked'} as array | 2/2/2 | unchanged |
| G0401 | set | string set {'pr opened', 'prOpened'} as array | 2/2/2 | unchanged |
| G0402 | clone | near-duplicate function briefUrl() (also: recapUrl, scanUrl), ~6 statements, fuzzy | 1/3/3 | unchanged |
| G0404 | discrim | string set {'fresh', 'stale'} as if-chain [ID.status] | 1/3/4 | unchanged |
| G0406 | clone | tiny rule copied as a helper getAccount() (also: getById, getWorkspace, getWorkspaceByUrlK | 2/3/4 | unchanged |
| G0407 | clone | tiny rule copied as a helper postBrief() (also: postRecap, postScan), 3 copies of 1-4 stat | 1/3/3 | unchanged |
| G0408 | const | named constant DEFAULT_HUMAN_NICK="John" | 2/2/2 | unchanged |
| G0410 | cmp | repeated comparison type == 'backlog' | 2/2/3 | unchanged |
| G0412 | clone | near-duplicate function delete(), ~7 statements, fuzzy | 2/5/5 | unchanged |
| G0413 | cmp | repeated comparison trim() == '---' | 1/5/5 | unchanged |
| G0415 | cmp | repeated comparison field == 'harness' | 2/3/3 | unchanged |
| G0416 | clone | near-duplicate function listEvents() (also: listTraces), ~9 statements, fuzzy | 2/2/2 | unchanged |
| G0418 | cmp | repeated comparison provider == 'email' | 2/2/2 | unchanged |
| G0420 | set+discrim | string set {'jira', 'linear'} as Set/or-chain [REFRESH_TOKEN_KINDS] | 2/2/2 | unchanged |
| G0421 | contract | text contract heading: adversarial second-read | 2/2/2 | unchanged |
| G0423 | record | record assembled from the same sources {urlKey=ID.urlKey, prUrl=ID.prUrl, headSha=ID.headS | 2/2/3 | unchanged |
| G0424 | cmp | repeated comparison type == 'heading' | 2/2/2 | unchanged |
| G0425 | set+discrim | string set {'dark', 'light'} as array/or-chain [VALID_THEMES, ID.session.theme] | 2/2/2 | unchanged |
| G0426 | contract | text contract heading: workspace api access (auto-appended) | 2/2/2 | unchanged |
| G0427 | contract | text contract marker: [credential-adopted] | 2/2/3 | unchanged |
| G0429 | clone | tiny rule copied as a helper fetchBriefStatus() (also: fetchContext, fetchRecapStatus), 3 | 1/3/3 | unchanged |
| G0430 | clone | near-duplicate function formatFossilThreshold() (also: formatStaleThreshold), ~10 statemen | 2/2/2 | unchanged |
| G0432 | clone | near-duplicate function list() (also: listByWorkspace), ~9 statements, fuzzy | 2/4/4 | unchanged |
| G0433 | clone | near-duplicate function orderByDependency(), ~59 statements, same vocabulary (dialect copy | 2/4/4 | unchanged |
| G0434 | clone | near-duplicate function (anonymous)() (also: graphql, request), ~15 statements, same vocab | 1/3/3 | unchanged |
| G0435 | cmp | repeated comparison completeness == 'complete' | 1/3/6 | unchanged |
| G0436 | contract | text contract marker: [string] | 2/3/4 | unchanged |
| G0438 | cmp | repeated comparison act == 'copy' | 2/2/3 | unchanged |
| G0440 | set | string set {'autopilot', 'save', 'triage'} as table-keys/Set [SENDING_STATUS, DONE_SUFFIX, | 2/2/3 | unchanged |
| G0441 | cmp | repeated comparison kind == 'plan' | 2/2/2 | unchanged |
| G0443 | cmp | repeated comparison scope == 'job' | 2/2/3 | unchanged |
| G0444 | cmp | repeated comparison source == 'model' | 2/2/2 | unchanged |
| G0445 | cmp | repeated comparison source == 'workspace' | 2/2/2 | unchanged |
| G0447 | clone | tiny rule copied as a helper (anonymous)(), 3 copies of 1-4 statements | 2/3/3 | unchanged |
| G0448 | clone | near-duplicate function generateBrief() (also: generateFeedbackTitle, generateRecap, gener | 2/5/5 | unchanged |
| G0449 | clone | near-duplicate function canonicalOf() (also: canonicalise), ~12 statements, structurally i | 2/2/2 | unchanged |
| G0450 | clone | near-duplicate function revokeByCreator() (also: revokeByOwner), ~9 statements, fuzzy | 2/2/2 | unchanged |
| G0451 | cmp | repeated comparison filter == 'set' | 2/2/2 | unchanged |
| G0452 | cmp | repeated comparison mode == 'resume' | 2/2/3 | unchanged |
| G0453 | clone | near-duplicate function clusterSiblingsInLane() (also: computeShipReachableIds, pullItemAn | 2/3/7 | unchanged |
| G0454 | cmp | repeated comparison stateType == 'completed' | 2/3/3 | unchanged |
| G0455 | clone | tiny rule copied as a helper (anonymous)() (also: isActive), 3 copies of 1-4 statements | 2/3/3 | unchanged |
| G0456 | clone | tiny rule copied as a helper _docsSorted() (also: _docsFor), 3 copies of 1-4 statements | 1/3/3 | unchanged |
| G0457 | clone | tiny rule copied as a helper union(), 3 copies of 1-4 statements | 2/3/3 | unchanged |
| G0461 | cmp | repeated comparison scope == 'default' | 2/2/2 | unchanged |
| G0462 | const | named constant DUPLICATE_KEY_CODE=11000 | 2/2/2 | unchanged |
| G0471 | clone | tiny rule copied as a helper get(), 5 copies of 1-4 statements | 2/5/5 | unchanged |
| G0472 | clone | tiny rule copied as a helper createDashboardDrilldownRoutes() (also: createDashboardEffort | 1/3/3 | unchanged |
| G0474 | record | record assembled from the same sources {id=ID._id, by=ID.by, prUrl=ID.prUrl, headSha=ID.he | 2/2/2 | unchanged |
| G0477 | clone | tiny rule copied as a helper deleteAll(), 4 copies of 1-4 statements | 2/4/4 | unchanged |
| G0478 | clone | near-duplicate function buildPassagePlannerKickoff() (also: buildPassageRunnerKickoff, bui | 1/3/3 | unchanged |
| G0479 | cmp | repeated comparison field == 'model' | 2/3/3 | unchanged |
| G0481 | const | named constant FORMER_MEMBER="former member" | 2/2/2 | unchanged |
| G0483 | const | named constant PROJECTION_RISK_TYPES=Set[overdue,unestimated-critical,velocity-declining] | 2/2/2 | unchanged |
| G0490 | set | string set {'overdue', 'unestimated-critical', 'velocity-declining'} as Set [PROJECTION_RI | 2/2/2 | unchanged |
| G0491 | set | string set {'preset-save', 'undo'} as array [[...].includes] | 2/2/3 | unchanged |
| G0492 | clone | near-duplicate function assignLanes(), ~32 statements, same vocabulary (dialect copy or cl | 2/2/2 | unchanged |
| G0493 | clone | near-duplicate function assignSegments(), ~21 statements, same vocabulary (dialect copy or | 2/2/2 | unchanged |
| G0494 | clone | near-duplicate function buildChainLabel(), ~10 statements, same vocabulary (dialect copy o | 2/2/2 | unchanged |
| G0495 | clone | near-duplicate function cohereSubtaskGroups(), ~39 statements, same vocabulary (dialect co | 2/2/2 | unchanged |
| G0496 | clone | near-duplicate function computeCrossLaneColumns(), ~108 statements, same vocabulary (diale | 2/2/2 | unchanged |
| G0497 | clone | near-duplicate function groupByAssignee() (also: groupByProject), ~10 statements, same voc | 2/2/4 | unchanged |
| G0498 | clone | near-duplicate function groupByStatus(), ~12 statements, same vocabulary (dialect copy or | 2/2/2 | unchanged |
| G0499 | clone | near-duplicate function mergeLabels(), ~6 statements, fuzzy | 2/2/2 | unchanged |
| G0500 | clone | near-duplicate function mergeLanes(), ~9 statements, same vocabulary (dialect copy or clos | 2/2/2 | unchanged |
| G0502 | cmp | repeated comparison grouping == 'dependency' | 2/2/4 | unchanged |
| G0503 | cmp | repeated comparison rawKey == 'duplicate' | 2/2/2 | unchanged |
| G0505 | set | string set {'/library.css', '/style.css'} as array [stylesheets] | 2/2/2 | unchanged |
| G0506 | discrim | string set {'assignee', 'dependency', 'project', 'status'} as switch | 2/2/2 | unchanged |
| G0507 | discrim | string set {'dependency', 'project'} as or-chain | 2/2/2 | unchanged |
| G0508 | set | string set {'halt', 'modelRoutingProxyWrites', 'periodicals'} as table-keys/array [SETTING | 2/2/2 | unchanged |
| G0509 | discrim | string set {'implicit', 'label', 'state'} as switch [ID.type] | 2/2/2 | unchanged |
| G0510 | set | string set {'none', 'pause', 'stop', 'unknown'} as table-keys [HALT_VALUE, HALT_WORDS] | 2/2/2 | unchanged |
| G0511 | cmp | repeated comparison tone == 'bad' | 1/3/3 | unchanged |
| G0513 | clone | tiny rule copied as a helper toRecord(), 3 copies of 1-4 statements | 2/3/3 | unchanged |
| G0514 | clone | near-duplicate function get(), ~9 statements, structurally identical | 2/4/4 | unchanged |
| G0515 | clone | tiny rule copied as a helper delete(), 4 copies of 1-4 statements | 2/4/4 | unchanged |
| G0516 | clone | tiny rule copied as a helper put(), 4 copies of 1-4 statements | 2/4/4 | unchanged |
| G0517 | clone | tiny rule copied as a helper put(), 4 copies of 1-4 statements | 2/4/4 | unchanged |
| G0519 | const | named constant REPO_RE=/^[A-Za-z0-9._-]{1,100}$/ | 2/2/2 | unchanged |
| G0521 | record | record assembled from the same sources {access_token=ID.access_token, refresh_token=ID.ref | 2/2/2 | unchanged |
| G0522 | cmp | repeated comparison error == 'invalid_grant' | 2/2/2 | unchanged |
| G0526 | set | string set {'digest', 'gap', 'northStarReading', 'product', 'technical', 'trajectory'} as | 2/2/5 | unchanged |
| G0528 | contract | text contract marker: [credential-rejected] | 2/2/2 | unchanged |
| G0529 | clone | tiny rule copied as a helper buildRoadmapDigestPrompt() (also: buildRoadmapGapPrompt, buil | 1/6/6 | unchanged |
| G0530 | record | literal record repeated verbatim {AFT="aft", DRIFT="drift", FORWARD="forward", PORT="port" | 2/2/2 | unchanged |
| G0532 | clone | near-duplicate function bearingToAngle(), ~8 statements, structurally identical | 2/2/2 | unchanged |
| G0533 | clone | near-duplicate function buildSegments(), ~59 statements, same vocabulary (dialect copy or | 2/2/2 | unchanged |
| G0534 | clone | near-duplicate function cardMatchesHeading(), ~13 statements, same vocabulary (dialect cop | 2/2/2 | unchanged |
| G0535 | clone | near-duplicate function clusterSubtaskSiblings(), ~35 statements, same vocabulary (dialect | 2/2/2 | unchanged |
| G0536 | clone | near-duplicate function computePosition(), ~11 statements, fuzzy | 2/2/2 | unchanged |
| G0538 | clone | near-duplicate function hash32(), ~11 statements, fuzzy | 2/2/2 | unchanged |
| G0539 | clone | near-duplicate function orientationLayout(), ~57 statements, same vocabulary (dialect copy | 2/2/2 | unchanged |
| G0540 | clone | near-duplicate function pickAngle(), ~10 statements, fuzzy | 2/2/2 | unchanged |
| G0541 | clone | near-duplicate function placeDriftBucket(), ~22 statements, fuzzy | 2/2/2 | unchanged |
| G0542 | clone | near-duplicate function placeSegmentBucket(), ~44 statements, same vocabulary (dialect cop | 2/2/2 | unchanged |
| G0543 | clone | near-duplicate function pushProjectSegments() (also: pushProjectSegs), ~8 statements, fuzz | 2/2/2 | unchanged |
| G0544 | record | record assembled from the same sources {label=ID[].name, projectName=ID[].name, cards=ID[] | 2/2/2 | unchanged |
| G0545 | cmp | repeated comparison kind == 'label' | 2/2/3 | unchanged |
| G0546 | cmp | repeated comparison kind == 'project' | 2/2/3 | unchanged |
| G0547 | cmp | repeated comparison orientation == 'vertical' | 2/2/6 | unchanged |
| G0548 | cmp | repeated comparison projectSector == 'port' | 2/2/2 | unchanged |
| G0549 | cmp | repeated comparison projectSector == 'starboard' | 2/2/2 | unchanged |
| G0550 | cmp | repeated comparison sector == 'drift' | 2/2/2 | unchanged |
| G0551 | cmp | repeated comparison sector == 'ship' | 2/2/2 | unchanged |
| G0553 | discrim | string set {'E', 'W'} as or-chain | 2/2/2 | unchanged |
| G0555 | const | named constant MAX_CUSTOM_PRESETS=20 | 2/2/2 | unchanged |
| G0556 | const | named constant MAX_PRESET_NAME_LENGTH=50 | 2/2/2 | unchanged |
| G0559 | clone | near-duplicate function list(), ~7 statements, structurally identical | 2/2/2 | unchanged |
| G0562 | cmp | repeated comparison stateType == 'unstarted' | 2/2/2 | unchanged |
| G0564 | clone | near-duplicate function (anonymous)(), ~7 statements, fuzzy | 2/2/2 | unchanged |
| G0565 | clone | near-duplicate function layoutIndex(), ~30 statements, same vocabulary (dialect copy or cl | 2/2/2 | unchanged |

## Compact trend ledger

Every 11-04b row keeps its stable name and order; none is re-keyed, dropped or retired. For the full history columns (06-25 through 11-04b), see the 11-04b ledger; this edition carries the severity, the 11-04b delta, this run's reading and the delta vs 11-04b. Rows with no named reading read "cited files 0-line diff" or "named files touched…", per `ledger-touch-map.txt`. Of the 124 carried rows: 102 unchanged, 17 held, 4 improved, 1 resolved. New: 5. Total 129 rows.

| # | finding | severity (11-05) | delta vs 11-04 (11-04b) | 11-05 (this run, `2eb73ae0` / `07c88f7`) | delta vs 11-04b |
|---|---|---|---|---|---|
| 1 | `lib-import-cycles` | low-medium | unchanged | 2 SCCs (6, 6), same members; 499 nodes / 2,051 static edges; no window edge closes a cycle (`import-graph-diff.txt`) | unchanged |
| 2 | `provider-auth-router-upward-imports` | resolved | held | 0 static / 0 dynamic `lib/`→`routes/`/`server.js` edges at both SHAs | held |
| 3 | `routes-error-envelope-fragmentation` | low-medium | unchanged | `res.status(` 275 / 250 / 12 at both SHAs, identical per file; LIN-4241's 409 goes through `jsonError` (#F-c) | unchanged |
| 4 | `production-to-test-fixture-imports` | resolved | held | held resolved; cited files 0-line diff | held |
| 5 | `periodical-report-filename-convention-split` | medium-low | unchanged | cited files 0-line diff in the window | unchanged |
| 6 | `dispatch-kind-vocabulary-cross-repo` | low | unchanged | named files touched (routes/dispatch.js); hunks belong to the window clusters read in beat 2; cited decision unmoved | unchanged |
| 7 | `provider-resolution-incantation` | low | unchanged | named files touched (lib/account-erasure.js); hunks belong to the window clusters read in beat 2; cited decision unmoved | unchanged |
| 8 | `ui-divergences-registry-staleness` | low | unchanged | named files touched (public/common.js); hunks belong to the window clusters read in beat 2; cited decision unmoved | unchanged |
| 9 | `simple-dispatcher-api-base-duplication` | low | unchanged | named files touched (server.js); hunks belong to the window clusters read in beat 2; cited decision unmoved | unchanged |
| 10 | `cross-repo-halt-vocabulary` | low-medium (sub-row) | held | cited files 0-line diff in the window | unchanged |
| 11 | `cross-repo-sentinel-decision-marker-vocabulary` | medium | unchanged | kit 0-line diff; SD hook status strings unchanged (comment-only diff). New SD system test binds Harbour's terminal and wake readers one way, outside SD CI (#3) | unchanged |
| 12 | `target-vocabulary` | low | unchanged | named files touched (lib/dispatch-store.js, routes/dispatch.js, server.js); hunks belong to the window clusters read in beat 2; cited decision unmoved | unchanged |
| 13 | `sse-frame-writer-duplication` | resolved | held | held resolved; named files touched, hunks in the window clusters, decision unmoved | held |
| 14 | `routes-proxy-decomposition` | — | unchanged | cited files 0-line diff in the window | unchanged |
| 15 | `cross-repo-repo-list` | low | unchanged | cited files 0-line diff in the window | unchanged |
| 16 | `ci-convention-split-across-repos` | informational | unchanged | cited files 0-line diff in the window | unchanged |
| 17 | `semicolon-style-split` | low | unchanged | named files touched (server.js); hunks belong to the window clusters read in beat 2; cited decision unmoved | unchanged |
| 18 | `client-escape-html-duplication` | — | unchanged | named files touched (public/common.js); hunks belong to the window clusters read in beat 2; cited decision unmoved | unchanged |
| 19 | `client-shared-helper-duplication` | — | unchanged | named files touched (server.js); hunks belong to the window clusters read in beat 2; cited decision unmoved | unchanged |
| 20 | `client-section-fetch-idiom-duplication` | — | unchanged | named files touched (public/question-cards.js); hunks belong to the window clusters read in beat 2; cited decision unmoved | unchanged |
| 21 | `linear-cli-parallel-graphql-surface` | — | held | named files touched (server.js); hunks belong to the window clusters read in beat 2; cited decision unmoved | unchanged |
| 22 | `store-module-uniformity` | — | unchanged | cited files 0-line diff in the window | unchanged |
| 23 | `server-side-escaping` | — | unchanged | named files touched (lib/render.js, server.js); hunks belong to the window clusters read in beat 2; cited decision unmoved | unchanged |
| 24 | `dispatch-payload-centralization` | — | unchanged | named files touched (public/app.js, public/common.js, public/prompt-section.js, routes/dispatch.js); hunks belong to the window clusters read in beat 2; cited decision unmoved | unchanged |
| 25 | `renderer-provider-abstraction` | — | unchanged (cited files 0-line diff in the window) | named files touched (lib/render.js); hunks belong to the window clusters read in beat 2; cited decision unmoved | unchanged |
| 26 | `cache-module-family` | low | worsened (+1; now graded LOW) | 8 `lib/*-cache.js`; no cache added in the window (new files: `ruling-settled`, `waiting-section`, `home-placement`) | unchanged |
| 27 | `lib-components-primitive-adoption` | — | unchanged | named files touched (lib/render-run-steps.js, lib/render.js); hunks belong to the window clusters read in beat 2; cited decision unmoved | unchanged |
| 28 | `state-store-write-seam` | — | unchanged | cited files 0-line diff in the window | unchanged |
| 29 | `phase-vocabulary-centralization` | low | unchanged | cited files 0-line diff in the window | unchanged |
| 30 | `target-harness-axis-orthogonality` | — | held (cited files 0-line diff in the window) | named files touched (routes/dispatch.js); hunks belong to the window clusters read in beat 2; cited decision unmoved | unchanged |
| 31 | `test-seam-separation` | — | unchanged | cited files 0-line diff in the window | unchanged |
| 32 | `css-token-layer` | — | unchanged | cited files 0-line diff in the window | unchanged |
| 33 | `runner-contract-semantics-cross-repo` | medium | unchanged (snapshot-bridge sub-item resolved) | 38 vs 34 rows, both 0-line diff, 0 usage rows. LIN-4218 puts the usage flush first in SD's Stop order (the U slot, `hook.js:441-468`), still in neither table | unchanged |
| 34 | `connection-binding-predicate-drift` | low-medium | unchanged | cited files 0-line diff in the window | unchanged |
| 35 | `run-page-identity-scrape` | medium | unchanged | cited files 0-line diff in the window | unchanged |
| 36 | `dispatch-entrance-field-duplication` | low | unchanged | named files touched (routes/dispatch.js, routes/proxy-compute.js, server.js); hunks belong to the window clusters read in beat 2; cited decision unmoved | unchanged |
| 37 | `owner-word-collision` | low | unchanged | named files touched (lib/run-view.js, routes/dashboard.js); hunks belong to the window clusters read in beat 2; cited decision unmoved | unchanged |
| 38 | `run-family-render-primitives` | low | unchanged | named files touched (lib/render-run-steps.js, lib/render.js); hunks belong to the window clusters read in beat 2; cited decision unmoved | unchanged |
| 39 | `persist-binding-sibling-seams` | low | unchanged | cited files 0-line diff in the window | unchanged |
| 40 | `server-formatter-duplication` | low | unchanged | named files touched (lib/effort-readout.js, lib/render.js, server.js); hunks belong to the window clusters read in beat 2; cited decision unmoved | unchanged |
| 41 | `wake-marker-regex-copies` | resolved | held | held resolved; named files touched, hunks in the window clusters, decision unmoved | held |
| 42 | `runner-liveness-assumption` | low | unchanged | cited files 0-line diff in the window | unchanged |
| 43 | `workspace-urlkey-consolidation` | — | unchanged | cited files 0-line diff in the window | unchanged |
| 44 | `credential-decision-multiplicity` | medium-high | unchanged (borderline) | named files touched (routes/settings.js); hunks belong to the window clusters read in beat 2; cited decision unmoved | unchanged |
| 45 | `keepalive-error-envelope-writer` | resolved | held | held resolved; named files touched, hunks in the window clusters, decision unmoved | held |
| 46 | `html-error-page-two-writers` | resolved | held | held resolved; named files touched, hunks in the window clusters, decision unmoved | held |
| 47 | `ai-availability-gate-duplication` | medium-low | unchanged | named files touched (routes/dashboard.js, routes/dispatch.js, routes/settings.js, routes/workspace-api-scan.js, server.js); hunks belong to the window clusters read in beat 2; cited decision unmoved | unchanged |
| 48 | `dispatch-refusal-relay-duplication` | resolved | held | held resolved; named files touched, hunks in the window clusters, decision unmoved | held |
| 49 | `tolerant-date-parse-date-twins` | resolved | held | held resolved; named files touched, hunks in the window clusters, decision unmoved | held |
| 50 | `timestamp-parse-consolidation` | — | unchanged | cited files 0-line diff in the window | unchanged |
| 51 | `loose-json-consolidation` | — | unchanged | cited files 0-line diff in the window | unchanged |
| 52 | `ai-mock-predicate-consolidation` | — | unchanged | cited files 0-line diff in the window | unchanged |
| 53 | `batch-guard-residue` | informational | unchanged | cited files 0-line diff in the window | unchanged |
| 54 | `decision-dialect-split` | medium (sub-row) | unchanged | SD decision relay: three call sites → one D slot `relayDecisionAndWithdrawals` (`hook.js:538`, LIN-4218); `scanDecisionBlock` body byte-identical (`:771`); kit DECISION prose 0-line diff | unchanged (SD relay consolidated internally) |
| 55 | `human-wait-derivation-split` | low-medium | unchanged | named files touched (lib/digest-feedback.js, lib/render-run-steps.js, lib/render-session.js, lib/render.js, lib/run-view.js, lib/task-page-loader.js, lib/unanswered-decisions.js, routes/dashboard.js, routes/dispatch.js); hunks belong to the window clusters read in beat 2; cited decision unmoved | unchanged |
| 56 | `decision-stamp-classifier-copies` | low-medium | unchanged | touched without consolidation: LIN-4240's `_isNonStateEntry` (`session-telemetry.js:85-91`) calls the inline `_isStampEntry` (`:60-63`), not `digest-feedback.js:78` | unchanged (touched) |
| 57 | `provider-write-field-contract` | low-medium | unchanged | cited files 0-line diff in the window | unchanged |
| 58 | `close-out-merged-refusal-split` | low-medium | unchanged | named files touched (lib/render.js, routes/dispatch.js); hunks belong to the window clusters read in beat 2; cited decision unmoved | unchanged |
| 59 | `periodic-loop-two-mechanisms` | informational | unchanged | named files touched (server.js); hunks belong to the window clusters read in beat 2; cited decision unmoved | unchanged |
| 60 | `consumer-liveness-signal-conflation` | resolved | held | held resolved; named files touched, hunks in the window clusters, decision unmoved | held |
| 61 | `consumer-heartbeat-wire-restated` | low-medium (sub-row of 60) | unchanged | named files touched (docs/dispatch-integration.md, routes/dispatch.js); hunks belong to the window clusters read in beat 2; cited decision unmoved | unchanged |
| 62 | `owner-answer-reader-copies` | low | unchanged | named files touched (lib/account-erasure.js); hunks belong to the window clusters read in beat 2; cited decision unmoved | unchanged |
| 63 | `mock-ai-builder-copies` | low-medium | unchanged | named files touched (routes/proxy-compute.js); hunks belong to the window clusters read in beat 2; cited decision unmoved | unchanged |
| 64 | `fresh-run-definition-copies` | low-medium | unchanged | named files touched (lib/dispatch-store.js, routes/dispatch.js); hunks belong to the window clusters read in beat 2; cited decision unmoved | unchanged |
| 65 | `terminal-loop-rule-copies` | low-medium | unchanged | named files touched (routes/dashboard.js, server.js); hunks belong to the window clusters read in beat 2; cited decision unmoved | unchanged |
| 66 | `state-type-label-rank-maps` | low-medium | unchanged | named files touched (public/common.js, server.js); hunks belong to the window clusters read in beat 2; cited decision unmoved | unchanged |
| 67 | `csp-decision-split` | resolved | held | held resolved; named files touched, hunks in the window clusters, decision unmoved | held |
| 68 | `priority-label-maps` | low | unchanged | named files touched (lib/home-view.js); hunks belong to the window clusters read in beat 2; cited decision unmoved | unchanged |
| 69 | `localhost-predicate-split` | low | unchanged | named files touched (routes/dispatch.js, server.js); hunks belong to the window clusters read in beat 2; cited decision unmoved | unchanged |
| 70 | `observer-instance-key-copies` | low | unchanged | cited files 0-line diff in the window | unchanged |
| 71 | `pilot-eligibility-copies` | low | unchanged | named files touched (lib/effort-readout.js, lib/render.js, routes/dispatch.js); hunks belong to the window clusters read in beat 2; cited decision unmoved | unchanged |
| 72 | `linear-image-host-allowlist` | low | unchanged | named files touched (lib/render.js); hunks belong to the window clusters read in beat 2; cited decision unmoved | unchanged |
| 73 | `page-chrome-options` | low | unchanged | named files touched (routes/dashboard.js); hunks belong to the window clusters read in beat 2; cited decision unmoved | unchanged |
| 74 | `ship-biscuit-desk-list` | low | unchanged | named files touched (lib/render.js); hunks belong to the window clusters read in beat 2; cited decision unmoved | unchanged |
| 75 | `free-tier-rule-copies` | resolved | held | held resolved; named files touched, hunks in the window clusters, decision unmoved | held |
| 76 | `sd-blocked-child-last-activity-split` | low | unchanged | cited files 0-line diff in the window | unchanged |
| 77 | `census-gone-overstates-resolution` | informational | held | cited files 0-line diff in the window | unchanged |
| 78 | `follow-up-target-rule-copies` | resolved | held | held resolved; named files touched, hunks in the window clusters, decision unmoved | held |
| 79 | `lineage-row-read-copies` | low | unchanged | cited files 0-line diff in the window | unchanged |
| 80 | `pr-url-regex-copies` | low | unchanged | cited files 0-line diff in the window | unchanged |
| 81 | `pause-marker-predicate-gap` | low | unchanged | named files touched (lib/dispatch-store.js, lib/task-page-loader.js, routes/dispatch.js); hunks belong to the window clusters read in beat 2; cited decision unmoved | unchanged |
| 82 | `review-on-record-readers` | low | unchanged | cited files 0-line diff in the window | unchanged |
| 83 | `credential-block-grammar-split` | low | unchanged | cited files 0-line diff in the window | unchanged |
| 84 | `review-loop-ceiling-restated` | low | unchanged | cited files 0-line diff in the window | unchanged |
| 85 | `sweep-as-library-imports` | low | unchanged | named files touched (public/app.js); hunks belong to the window clusters read in beat 2; cited decision unmoved | unchanged |
| 86 | `github-envelope-walker-split` | low | unchanged | named files touched (public/app.js); hunks belong to the window clusters read in beat 2; cited decision unmoved | unchanged |
| 87 | `binding-active-answer-copies` | low-medium (sub-row of 44) | unchanged | named files touched (lib/render.js, server.js); hunks belong to the window clusters read in beat 2; cited decision unmoved | unchanged |
| 88 | `auth-failure-answer-copies` | low-medium | unchanged | named files touched (routes/dispatch.js); hunks belong to the window clusters read in beat 2; cited decision unmoved | unchanged |
| 89 | `account-group-reader-copies` | low | unchanged | named files touched (lib/account-erasure.js); hunks belong to the window clusters read in beat 2; cited decision unmoved | unchanged |
| 90 | `stable-stringify-copies` | low | unchanged | named files touched (lib/account-erasure.js); hunks belong to the window clusters read in beat 2; cited decision unmoved | unchanged |
| 91 | `kpi-page-twin-copies` | low-medium | unchanged | named files touched (lib/render.js, lib/workspace-kpi-stats.js); hunks belong to the window clusters read in beat 2; cited decision unmoved | unchanged |
| 92 | `kit-terminal-status-copy` | low | unchanged | named files touched (routes/dispatch.js); hunks belong to the window clusters read in beat 2; cited decision unmoved | unchanged |
| 93 | `sd-parked-predicate-inline` | low | unchanged | cited files 0-line diff in the window | unchanged |
| 94 | `https-predicate-restated` | low | unchanged | named files touched (server.js); hunks belong to the window clusters read in beat 2; cited decision unmoved | unchanged |
| 95 | `harbour-token-format-restated` | — | held | cited files 0-line diff in the window | unchanged |
| 96 | `registry-providers-restated` | low (sub-row of 44) | unchanged | cited files 0-line diff in the window | unchanged |
| 97 | `sd-401-layers-three` | low | unchanged | cited files 0-line diff in the window | unchanged |
| 98 | `expire-ownerless-has-owner-copy` | low | unchanged | named files touched (routes/dispatch.js); hunks belong to the window clusters read in beat 2; cited decision unmoved | unchanged |
| 99 | `vendor-script-list-restated` | low | unchanged | 27 `scripts: [` arrays, 7 purify render files at both SHAs; Home's list +`/home-placement.js` (`render.js:383`); census G0214→G0211 is the label (+8→+9) | unchanged |
| 100 | `prune-to-capacity-clones` | low | unchanged | cited files 0-line diff in the window | unchanged |
| 101 | `resume-model-effort-cross-repo` | medium-high | unchanged | named files touched (routes/dispatch.js); hunks belong to the window clusters read in beat 2; cited decision unmoved | unchanged |
| 102 | `halt-word-map-copies` | medium | unchanged | named files touched (lib/render.js, routes/settings.js); hunks belong to the window clusters read in beat 2; cited decision unmoved | unchanged |
| 103 | `home-next-answer-split` | medium | unchanged | LIN-4151: /backlog lead roots on Up next's ranking (`rankKeysOf`/`compareRank`, `home-view.js:422,432`), one split for page and fold (`home-rows.js:156-158`). Triage (`home-view.js:36`, `task-order.js:163`) and the deck top (`home-pipeline.js` 0-line diff) unchanged; `orderIssuesForSwipe` (`task-board-view.js:91`) still ranks apart | **improved (partial)** |
| 104 | `coherence-loop-stalled` | medium (process) | unchanged | LIN-4234 Done ~3h after mint; LIN-4151 Done. 16 open Drift follow-ups (was 18); the other 14 unmoved, 0 new comments | **improved** (first movement) |
| 105 | `settings-run-setup-rebuilt` | low-medium | unchanged | named files touched (routes/settings.js); hunks belong to the window clusters read in beat 2; cited decision unmoved | unchanged |
| 106 | `settings-preset-systems` | low-medium | unchanged | named files touched (lib/render.js, routes/dispatch.js, routes/settings.js); hunks belong to the window clusters read in beat 2; cited decision unmoved | unchanged |
| 107 | `routes-as-library` | low-medium | unchanged | named files touched (routes/dashboard.js, routes/workspace-api-scan.js); hunks belong to the window clusters read in beat 2; cited decision unmoved | unchanged |
| 108 | `model-vocabulary-rule-copies` | low-medium | unchanged | named files touched (lib/render.js, public/common.js); hunks belong to the window clusters read in beat 2; cited decision unmoved | unchanged |
| 109 | `task-page-state-outside-owner` | low-medium | unchanged (borderline) | `READY_TASK_STATE` still `render-task-page.js:108`; `public/task-page.js` 0-line diff. LIN-4048 kept the no-run rule in `runOfferOf` (`task-state.js:310`), read via `takesNoRun` (`prompt-section.js:691`) | unchanged |
| 110 | `live-anchor-old-home-alive` | low-medium | unchanged | `liveGuard` flag gone; `liveOnAnchor` unconditional (`unanswered-decisions.js:982`). One inline copy left, `routes/proxy-rulings.js:246-249` (0-line diff), named at `live-anchor.js:9`; LIN-3843 Backlog | **improved** |
| 111 | `lineage-anchor-rules-three` | low-medium | improved (4 → 3) | named files touched (lib/dispatch-store.js, routes/dispatch.js); hunks belong to the window clusters read in beat 2; cited decision unmoved | unchanged |
| 112 | `model-constants-server-client-twins` | resolved | held | held resolved; named files touched, hunks in the window clusters, decision unmoved | held |
| 113 | `low-rows-unpromoted` | low | unchanged | named files touched (lib/render.js, lib/task-page-loader.js); hunks belong to the window clusters read in beat 2; cited decision unmoved | unchanged |
| 114 | `halt-poll-cold-cache-fail-open` | medium (conditional) | unchanged | `poll-halt.js`, `workspace-halt.js`, kit and SD `dispatcher.js` 0-line diff; LIN-4210 Backlog, 0 comments. John's ruling; not chosen | unchanged |
| 115 | `usage-relay-flag-partial` | resolved | resolved | LIN-4218's U slot calls `flushRequestUsageSafely` → `request-usage-flush.js:114` (0-line diff). LIN-4214 Backlog, 0 new comments | held |
| 116 | `usage-record-vocabulary-two-readers` | low-medium | improved | `request-usage-vocabulary.js`, `request-usage-intake.js` 0-line diff | unchanged |
| 117 | `lineage-identity-read-twins` | resolved | resolved | `findLineageIdentity` `dispatch-store.js:320`; LIN-4241's dispatch-store hunks are the settled check and CAS only | held |
| 118 | `reap-window-constant-cross-repo` | low-medium | unchanged | named files touched (lib/unanswered-decisions.js); hunks belong to the window clusters read in beat 2; cited decision unmoved | unchanged |
| 119 | `cost-fold-partition-restated` | resolved | resolved | `countedRowsOf` read at `cost-read.js:89,252,268` | held |
| 120 | `key-state-residue` | informational | held | held (informational) | held |
| 121 | `unit-census-convention-split` | informational | unchanged | cited files 0-line diff in the window | unchanged |
| 122 | `usage-snapshot-prose-residue` | low | new | 8 of 9 files left. Fixed: `source-map.md:192` (LIN-4226). Left in files LIN-4226 edited: `effort-readout.js:599` (user-visible), `model-routing-spend.js:6,58`. Unchanged: `proxy-instructions.js:385-386`, `proxy-integration.md:1239`, `request-usage-vocabulary.js:4`, SD `request-usage-flush.js:3-8`, `request-usage.js:163-164` | **improved** (1 of 9) |
| 123 | `completeness-precedence-restated` | borderline (not graded) | new | `row-usage.js:116`, `cost-read.js:199`, `request-usage-fold.js:103` | unchanged |
| 124 | `erasure-inventory-lockstep-gap` | resolved | new | `usage-snapshot-intake` in `INVENTORY` (LIN-4234, `950113b1`); one name source `tests/helpers/collection-names.js` for both guards; `server.js` non-literal `collection()` census. Residual (noise): that census covers `server.js` only | **resolved** |
| 125 | `parked-wait-text-cross-repo` | low-medium | — | SD writes one park status for 4 wait kinds (`hook.js:1520-1537`, `heartbeat.js:258-264`); Harbour reads 1 (`PARKED_WAIT_HINT`, `session-telemetry.js:325`). No contract row; the binding test is SD system-tier only, outside SD CI. Home: LIN-2258 | **new** (first ruled) |
| 126 | `error-code-case-split` | low | — | `ruling-settled` is the one kebab-case HTTP error `code` (routes: 42 UPPER_SNAKE codes, lib: 18); scan retire keeps `ALREADY_TERMINAL` (`workspace-api-scan.js:75,508`); browser restates the code (`question-cards.js:248`) | **new** |
| 127 | `ruling-settled-row-predicate-inline` | low | — | task-row "settled" = outcome ∈ {answered, dismissed} inline at 5 sites / 3 route files (`dashboard-rulings.js:327`, `workspace-api-issue-write.js:162,168,646`, `workspace-api-scan.js:389`); loop side has one owner (`isDecisionSettledIn`). Home: `lib/task-decisions-store.js`. Census G0217 re-ruled real | **new** |
| 128 | `waiting-standing-comment-residue` | low | — | two window comments contradict the code: `home-row-states.js:121` ("the task page's read leaves it off", untrue since LIN-4143) and `waiting-section.js:5` (names `readWaitingStanding`, which does not exist). Handed over by Seams run 7 | **new** |
| 129 | `reply-effect-default-split` | borderline (not graded) | — | `question-cards.js` defaults an absent effect to `record` (LIN-4143, fail closed) while the shared reply helper keeps absent = `resume` (pinned by `reply-delivery-contract`); deliberate and documented | **new** (borderline) |
