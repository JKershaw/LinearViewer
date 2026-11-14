
## Findings (severity-ranked; delta vs run 7)

Citations are at `fb358dbda` (Harbour) and `7d5fe7d` (SD). Carried rows keep their run-7 names. The compact ledger holds all 158 carried rows and the nine new ones (159 to 167), each with a run-8 delta.

| # | name | severity | delta vs run 7 | one line |
|---|---|---|---|---|
| 1 | **159** `trail-pr-list-beside-landing` | LOW–MEDIUM | **new** (window claim, LIN-4458; the reader predates it) | `assembleTrailFacts` (`lib/recommendation-facts.js:466-471`) builds `prUrls` from every comment. It feeds the selector line (`:554`) and the look-first gate (`lib/recommendation-look-first.js:152`), beside the landing in `COMMENT_KINDS` (`lib/run-trail.js:134-145`), whose header (`:15-17`) says the prompt cannot disagree. Reproduced: a Survey report citing a PR turns look-first off with an empty landing. Note: `llm-and-prompts.md`. |
| 2 | **160** `relative-time-four-formatters-one-home-claim` | LOW–MEDIUM | **new** (window claim, LIN-4472; copies predate it) | `lib/time-words.js:2`, `tests/unit/lin-4472-time-words.test.js:2`, `docs/architecture/source-map.md:151` and `lib/components/time.js:4-5` claim one home. `formatRelativeTime` (`lib/render.js:122`), `window.relativeTime` (`public/common.js:576`) and `formatGeneratedAge` (`public/prompt-section.js:103`) word the same moment. Plus two byte-identical `formatDuration` copies. The guard keys on names. Note: `front-end-pages.md` (a size of move). |
| 3 | **149** `session-pr-pick-mirror-cross-repo` | LOW (was LOW–MEDIUM) | **improved** | Nine `report` rows now pin both sides (LIN-4475/4476), and the Waiting entry left. Unpinned: a message with no `DONE:` line, where Harbour takes the first PR (`lib/dispatch-wake.js`, its comment) and SD its tracked ranking (`links.js`). One report row pins a disagreement, not an agreement: an `http://` `DONE:` URL, which SD canonicalises and Harbour's `PR_URL_RE` (`lib/run-ledger.js:355`) does not read; a runs-and-dispatch entry holds it (second read). |
| 4 | **141** `session-lane-grant-from-client-text` | LOW–MEDIUM | **unchanged** | `lib/dispatch-entrance.js:1230` still passes `isAutopilotVariant(prompt)`. LIN-4318 Backlog. |
| 5 | **140** `working-beat-grammar-cross-repo` | LOW–MEDIUM | **unchanged** | SD writes the beat lines (`heartbeat.js`, `hook.js`); Harbour parses them itself (`lib/session-telemetry.js` `HEARTBEAT_HINT`, `TOOL_COUNT_RE`, `BREAKDOWN_RE`). The contract's heartbeat row covers the host heartbeat only. LIN-3828 Backlog. |
| 6 | **161** `stage-record-claims-and-catalogue-group` | LOW | **new** (window, LIN-4467) | `catalogue.group` (`lib/prompts/stage-kinds.js`) drives the generated Default/More split in `public/llms.txt`. `DEFAULT_PROMPT_KEYS` (`lib/render-prompt-opts.js:14`) drives the pages. They agree today, unlinked. `docs/architecture/source-map.md:185` says every per-kind table is a view, while about eight stay kind-keyed. Note: `llm-and-prompts.md`. |
| 7 | **162** `stage-write-default-and-allowance-unguarded` | LOW | **new** (window, LIN-4468) | "No stamp means work" ×3 modules; an unknown value throws in `lib/proxy-preamble.js` and reads `none` in `normalizeWritesStamp`. `ALLOWED_OPS` (`lib/stage-writes.js:78-83`) has no completeness test, so a new value answers 500. "One comment" is prompt-only. Note: `other-features.md` (`lib/stage-writes.js` falls to that area). |
| 8 | **163** `closeout-done-bound-split` | LOW | **new** (window, LIN-4460) | `lib/run-closeout-state.js:31-34` claims one place. `setDone` (`:269`) has no stop-at term; the route applies it (`routes/workspace-api-run-evidence.js:296-302`). The person-acted rule is spelled at `:261` and `:265`; `followsPerson`/`waitsOn` have no production reader. Note: `runs-and-dispatch.md`. |
| 9 | **164** `fold-empty-corner-leftover-unhomed` | LOW | **new** (window, cross-repo, LIN-4475/4476) | The contract's two fold corner rows record SD posting `""` raw. The timestamp row says "Named as a leftover for Simple Dispatcher, not fixed here". Harbour's intake rejects `at: ""` (`lib/request-usage-intake.js:91`), so the record is lost. Neither repo's notes held it. Note: SD `stop-hook-and-relay.md` (`request-usage.js`), companion PR. |
| 10 | **166** `jira-as-asked-end-line-looser` | LOW | **new** (window, LIN-4450) | `isEndNode` (`lib/providers/jira/as-asked-region.js:72`) matches plain text whatever its marks, and an edited block takes `ends[0]` (`:117`). A plain copy of the end sentence in the words cuts them short. The providers Lesson's safety argument covers filing only. Note: `providers.md`. |
| 11 | **167** `prompt-context-header-overclaims` | LOW | **new** (window, LIN-4470; found by the second read) | `lib/prompts/prompt-context.js:1-5` says every surface that renders a stage from a fetched context hands `generatePrompt` this projection. The routed and code-routed recommendation (`composeRoutedRecommendation`, `lib/openrouter.js:2056-2058`) passes `prepareRecommendationInput`'s hand-built superset (`lib/recommendation-input.js:35-42`). A test pins the superset, so a miss fails CI. Note: `llm-and-prompts.md`. |
| 12 | **165** `feedback-kinds-header-stale` | LOW | **new** (window, LIN-4455/4459) | `lib/dispatch-feedback-kinds.js:15-16, 48-49` describes a store re-export and import that do not exist (`lib/dispatch-store.js:76-79` says so). Note: `runs-and-dispatch.md`. |
| 13 | **136** `stage-kind-roster-tables` | LOW | **improved** | One record per kind, with the tables as views (LIN-4467). Census G0100 is gone. About eight kind-keyed tables remain, each listed with a reason by `tests/unit/stage-kind-tables.test.js`. The Waiting entry left. |
| 14 | **145** `area-notes-dir-outside-registry-path` (P3) | LOW | **improved** (one constant pair); count up by comments | `REGISTRY_PATH` derives from `NOTES_DIR` + `REGISTRY_FILE` (`lib/prompts/area-registry-path.js`). `docs/areas` is spelled in 28 lines / 14 files (26 / 11 at `e2d4659c4`; JavaScript only 18 / 9 → 19 / 12); the added lines are comments citing note files. The kept entry's first citation and count are corrected in this PR. |
| 15 | **56** `decision-stamp-classifier-copies` | LOW–MEDIUM → LOW | **improved** | One set (`DECISION_LIFECYCLE_STAMP_KINDS`, `lib/dispatch-feedback-kinds.js:88`), four readers. Two predicates over it remain (`_isStampEntry`, `isDecisionLifecycleStampEntry`). `public/dispatch.js:1062` and `public/session.js:128` restate it under a drift test. |
| 16 | **58** `close-out-merged-refusal-split` | LOW–MEDIUM → LOW | **improved** | One decision answers every surface (LIN-4460). The residue is 163. |
| 17 | **40** `server-formatter-duplication`, **19** `client-shared-helper-duplication` | LOW | **improved** | `fmtDuration`/`relativeAgo` have one leaf; the `public/task-page.js` `formatElapsed` copy is gone (G0264). The rest is 160 and a front-end-browser entry. |
| 18 | **47** `ai-availability-gate-duplication` | MEDIUM-LOW | **improved (partly)** | The test-token mode is `isHermeticTestToken` (12 importers; G0008 gone, G0002 43 → 31 sites). The not-configured gates outside `isAiUnavailable` are not in a hunk. |
| 19 | **134** `stage-writes-threading-per-entrance` | LOW | **unchanged in shape, stakes raised** | Still threaded by hand at four entrance sites. Since LIN-4468 the value gates proxy writes, and an unstamped token is unrestricted, so a missed thread fails open (162). |
| 20 | **157** `timeline-renderer-rederives-tick-style`, **156** `ruling-outcome-buckets-claim-home` | LOW | **unchanged** | Their entries stand. |
| 21 | **137**, **147**, **138**, **135**, **144** | LOW | **unchanged** | Cited lines as in run 7 (137 at `CLAUDE.md:107` and `lib/proxy-scopes.js:24-26`). LIN-4320 and LIN-4256 Backlog. |
| 22 | **143**, **148**, **152** | LOW | **improved** | `committedSearch` and `NOTES_PR` (143). `DECIDED_BY` read from `lib/size-of-move.js` (148; "a day" and "four lines" remain). Harbour's README points at the leaf (152; SD's wording kept as SD's own). |
| 23 | **139**, **146** | LOW (borderline) | **unchanged** | `public/live-console.js` dual export. The guards are copied by design and agree. |

**Resolved:** 142, 150, 151, 153, 154, 155, 158 (old copies deleted) and 131 (in code; LIN-4302 still Backlog). **Improved:** 11 (19, 40, 47, 56, 58, 136, 143, 145, 148, 149, 152). **Worsened:** 0. **New:** 9 (159 to 167). **Unchanged:** the remaining rows; each touched one is judged in the ledger.

**Report-only (no area file to cite, another review's, a designed duplicate, or below the bar):**
- **`isLiveRun` and `liveOnAnchor` are different rules, framed as one.** `lib/run-live-wait.js:43-45` calls them the same predicate over different inputs. But `liveOnAnchor` (`lib/live-anchor.js:20-23`) counts waiting and custom rows, and `isLiveRun` counts queued or running only, with a parked stage counted as ended once its lineage ends. The rulings feed and the run-fact path can disagree about such a stage. Pre-existing; the run-live-wait outcome-words entry is the nearest home. Below the bar.
- **A PR's head SHA is read in five places** (`headShaOf`, `statusHeadSha`, `lib/run-evidence.js` twice, `lib/ci-wake-sweep.js`), and head-moved in two. Pre-existing. The existing `lib/run-evidence.js` entry ("two answers to which PR is the task's") covers the side that bites.
- **The leftover step's resume takes SD's `force` path**, while the contract's running-session row "covers neither queueIfBusy nor force". The removed Waiting entry was settled for what it said (row 8 pins a follow-up to a finished, unhalted session); the forced race is narrower. Seams & Tangles carries this seam (§3.0b, `seam:leftover-resume-contract`).
- **Stale pointer, unchanged:** `lib/dispatch-terminal.js:677` still cites SD's `DONE_LINE_RE`, which SD keeps only in a history comment. The rule is `doneLineRest`, and the window added `sentinelLine` beside it.
- **Contract sameness is two pins, not one check** (Harbour `CONTRACT_SHA256`, SD `FIXTURE_SHA256`). Each repo checks its own copy; SD's comment says so. Harbour's header cites an SD verification commit (`f98e442`) that is not on SD main. Designed; report-only.
- **The cost formatter is reachable two ways** (imports, and the `window.CostFormat` shim with one reader, `public/prompt-section.js:1508`). It is inventoried and can only shrink. The "a page with no consumer takes no shim" check is hand-written in three render tests.
- **The `/lib/` allow-list is declared once** (`SHARED_MODULES`, `lib/vendor-assets.js`). Its purity rule is restated in prose in four places, and the two code checks disagree on whether `self` is a global (`tests/unit/shared-modules.test.js` against `tests/unit/helpers/bridge-inventory.js`). Below the bar.
- **Test loaders:** `tests/unit/helpers/import-world.js` joined `loadWorld`. It is recorded in `docs/areas/front-end-browser.md`, but `CLAUDE.md` names only `loadWorld` (row 133). For the Documentation review.
- **Small retypes:** `lib/render-run-evidence.js:87` types `'Blind read'` beside the record's label. `routes/workspace-api-feedback.js:256-259` hand-builds a partial context outside `promptContextOf`'s stated scope. `public/session.js` keeps a close-out mirror of its own.
- **From the second read, ruled below the bar:**
  - The removal of the web-routes `truncationFailureOf` entry (LIN-4460 leftovers) stands. Each router now has one arm over the shared helper: `summaryFailure` (`routes/dashboard-summaries.js:30`), `streamedFailureReply` (`routes/proxy-compute.js:117`) and `failureOf` (`routes/workspace-api-steps.js:25`). Each maps the helper's tuple into its own reply envelope. Borderline, not restored.
  - The create-field rule is split between the session lane (`routes/workspace-api-issue-write.js`, against `createFields()`) and the proxy lane (`routes/proxy-writes.js`, `apiWriteFields()`). It is already a `web-routes.md` entry (LIN-4451).
- **The run-outcome words split** (`QUEUED`/`RUNNING` in `lib/run-live-wait.js`, the rest in `lib/recent-runs.js`): already a `runs-and-dispatch.md` entry from LIN-4459's leftovers.

## Waiting counts (why they moved)

Bullets under `## Waiting` at `e2d4659c4` → `fb358dbda` (before this PR), from `waiting-moves-run8.txt`. The diff counts run 7's own entries, merged inside the window, as added.

| Area | Count | Removed | Added | Reading |
|---|---|---|---|---|
| llm-and-prompts | 21 → 12 | 15 | 6 | **Settled and moved.** LIN-4470's map: 7 settled, 2 routed to LIN-4416, 1 moved to Runs, 12 kept with an owner or blocker. Run 7's four entries (151, 154, 155, 152) left as their rows resolved. |
| agent-api | 13 → 11 | 4 | 2 | **Settled.** The token hash, the limiter-window entry (now pinned by exchange rows), the poll doc line, and the read-scope entry (re-filed narrower after LIN-4468). |
| runs-and-dispatch | 18 → 21 | 15 | 18 | **Mostly settled-and-recorded, some new drift.** Fifteen settled by LIN-4447's pieces (run 7's 149, R1, 158 and the three close-out entries among them). Eighteen added: two moves (the live-wait race, the dispatch record's `model`), stated limits John ruled on (the outside merge on the recommend path), and leftovers each piece wrote with a why. Three are drift the window introduced: the outcome words split, `mayCarryWake` disagreeing with `lastWakeEntry`, and the `readTrail` `#N` re-review hole. |
| front-end-browser | 5 → 12 | 0 | 7 | **Recorded, two caused.** Five record pre-existing copies newly in view (common.js twins, ship mirrors, `session.js` `formatElapsed`, observation size, the feedback widget). Two are drift the conversion caused (observation's bare globals, flight-companion's `if (mounted)` blocks). |
| providers | 0 → 4 | 0 | 4 | **New note, stated limits.** The Jira lanes' open items; all four hold at HEAD. |
| platform-and-plumbing | 4 → 7 | 0 | 3 | **Recorded.** The `vendor-assets` name now under-describes it; two `PartialWriteError` gaps. |
| front-end-pages | 13 → 14 | 4 | 5 | Run 7's 157, and four LIN-4451/4463 items; four design entries settled. |

## Cross-repo verdicts

- **Runner contract:** byte-identical (sha256 `871ca615…`), re-pinned in both repos by the window. Each repo checks its own copy; designed. Report-only.
- **Session vocabulary (LIN-4475/4476):**
  - `session` takes running, finished, stopped or none (`live` is gone from both repos).
  - No production code reads the contract. Each side's test retypes the vocabulary and throws on an unknown value, so a fifth value fails loudly on both sides.
  - The two transcript folds stay two (Harbour `lib/runner-kit/runner.mjs`, SD `request-usage.js`) and are pinned to each other by 14 `fold` rows. That is designed.
  - One named fold leftover has no home: 164.
- **Session-PR pick (149):** improved. Nine `report` rows pin it; the no-`DONE:` fallback is unpinned.
- **`[working]` beat (140):** unchanged in both repos.
- **Sentinel family (SD LIN-4474):** `columnProblems` is gone from SD code. The line rules are in `transcript.js` `sentinelLine`, and a guard keeps regexes out of `hook.js`. SD's own blind read recorded the prompt and router split as a Waiting entry; it holds.
- **Area notes:** the guards agree (155 resolved). SD's README still says an entry leaves when "a follow-up is filed for it"; Harbour's llm-and-prompts entry holds that as SD's own (152).
- **SD census:** 61 groups, 27 `mustRule`, 25 tabled, 0 gone, all unchanged against `af9b496`. Reproduction at `af9b496` against `5d8489e` is byte-identical to run 7's file (`66656f41`). No ruled site is in a window hunk, so all 27 run-7 rulings stand (2 real, 15 borderline, 10 noise; `census-SD-rulings-run8-carry.tsv`).

**Seams have no full home in the notes yet.** Each cross-area or cross-repo seam above is filed under the area a change would start from, naming the other side: 159 under LLM & prompts naming `lib/run-trail.js`; 164 under SD's relay naming Harbour's intake.

## Sibling hand-offs (received, ruled, recorded)

- **Seams & Tangles run 12, §3.0a `seam:landing-reader-agent-note`** (High in that report). **Ruling: answered, resolved at HEAD.** LIN-4458 replaced both readers with one table (`COMMENT_KINDS`, `lib/run-trail.js`). `landingPrUrls` is a view of it and `isLandingEvidence` is deleted. Agent notes join the landing, never count as landed work, and count as work after review only when they cite a new PR. The same family's last open reader is the selector's own PR list (159), which Seams did not name.
- **Seams run 12, the `lib/periodicals.js` content hand-off** (run 10 §11, kept assigned here). **Ruling: answered.**
  - `committedSearch` folds the four "search the repo for a committed tool" spellings (LIN-4469), and the notes-PR rule reads `NOTES_PR` from the leaf (143 improved).
  - The hand-off rule is still in three bullets, pinned by `tests/unit/lin-4390-periodical-hand-off.test.js`.
  - The per-template wording of the tooling policy is a Waiting entry from LIN-4469's own leftovers.
  - Nothing new is owed.
- **Seams run 12, `lib/run-ledger.js` importers (watch).** The kind readers moved to `lib/run-trail.js` (−263 lines in `run-ledger.js`; `run-trail.js` took 11 new importers). The coupling itself stays with Seams.
- **Seams run 12, §3.0b leftover-resume contract:** see the report-only bullet above; Seams' row.
- **Stability (`stability-review-2026-11-13.md`)** points "decisions held in several places" here and names no item. Nothing beyond this report is owed.
- **LIN-4447 and LIN-4448's own records.** Each claim of "retired" was checked against code, not prose:
  - LIN-4447 is Done, and its "20 original entries accounted for" holds. The four kept with a why (3, 5, 10, 12) are in the note.
  - LIN-4448 is In Progress. Its after-read did not meet its done-when on code, as its own comment says.
  - Of the pieces' "one home" claims, four outrun a caller (159, 160 is LIN-4472's, 161, 163); each is filed.
- **Code Quality (2026-11-04), Comprehension-Debt, Documentation (2026-11-10), Test Coverage Gap (2026-11-11), Integration & Surface Maturity, Onboarding (2026-11-11), Security (2026-11-10), Dependency & Supply-Chain (2026-11-10):** read for hand-offs. None hands this review an item it does not carry. Their entries are theirs and are not re-flagged.

## Method and instrument

- **Census:** `scripts/code-shape/census-review.mjs`, run in place. Scope `--include '^(server\.js$|(lib|routes|public)/.*\.[cm]?js$)'`, one guide passed explicitly with `--areas`. The tool and the walker are unchanged in the window (`git diff --stat e2d4659c4 fb358dbda -- scripts/code-shape` is empty).
  - **Reproduction first:** `census-review.mjs . e2d4659c4 b315e0e8f --areas <run 7's guide, blob d13fca20>` equals run 7's `census-HEAD-vs-b315e0e8f.json` in every field except `areaGuide`, the path label (`census-repro-run7-e2d4659c4-vs-b315e0e8f.json`). The instrument is unchanged.
  - **Guide-only check:** the same commits with the HEAD registry give 0 changed groups. The file is byte-identical to run 7's JSON (sha256 prefix `5c7a0f0f`). The registry edit is neutral at the baseline.
  - **HEAD against run 7's commit:** `census-review.mjs . fb358dbda e2d4659c4 --areas docs/areas/areas.json` gives 578 groups, 107 to rule on, 317 tabled, 11 gone (`census-HEAD-vs-e2d4659c4.json`, `d4ba6996`).
  - **SD:** the same tool from Harbour's root, `../simple-dispatcher` with SD's registry. Reproduction `af9b496` against `5d8489e` is byte-identical to run 7's (`66656f41`). HEAD `7d5fe7d` against `af9b496`: 61 / 27 / 25, 0 gone (`b30ee751`).
- **Rulings:** `rulings-carry-run8.py` (run 7's script, re-pointed) joins the 107 groups to run 7's rulings on (detector, decision, files), with a fallback on (detector, decision) at ≥ 50% file overlap.
  - 104 joined: 101 by key, 3 by the fallback (G0002 shrunk, G0018, G0142).
  - Three had no ruling and are ruled from their sites in `finish-rulings-run8.py`: G0025 (run 7's table group G0027), G0076 (G0049 re-keyed) and G0176 (run 7's table group G0338).
  - Nine groups have a site inside a window hunk (G0002, G0011, G0018, G0059, G0097, G0127, G0142, G0144, G0150). Each was re-read at HEAD, and the re-read is in the table's last column. Every carried ruling stands.
- **Import walker:** run in place from `docs/reviews/_evidence-2026-11-06-drift/import-walker.mjs`.
  - At `e2d4659c4` its output equals run 7's graph except the `sha` label (full against short).
  - At `fb358dbda`: **533 nodes, 2249 static edges, 2 dynamic**. SCCs 6 + 6 with the same members; upward 0 / 0; route to route 53; parse failures 0.
  - Edge delta and the importers of every new leaf: `import-graph-delta-e2d4659c4-to-fb358dbda.txt`.
- **Touch map:** `touch-map-run8.py` crosses each row's cited files, from the 11-05, run-4 and run-7 ledgers, with this window's numstat. It finds 83 rows citing a window-touched file (`ledger-touch-map-run8-window.txt`). Each was judged by hand against `git diff -U0 e2d4659c4 fb358dbda`. `build-ledger-run8.py` refuses to run if a touched row has no judgement. Output: `ledger-run8.tsv` (166 rows).
- **Window files no ledger row cites.** Run 6's and run 7's second reads each found the top item in such a file, so this run swept the window's new modules in four parallel reads by fresh-context sub-agents. Each was given its questions and the code, and no conclusions:
  1. Runs & dispatch pieces;
  2. LLM & prompts pieces;
  3. the browser modules and time and cost formatters;
  4. the contract, Jira and SD.
  Every claim used here was re-checked against the code at HEAD by the writer. 159's claim was reproduced with a script (`look-first-survey-pr-repro.mjs` and `.txt`, run from the repo root against HEAD modules).
- **Waiting moves:** `waiting-moves-run8.txt` diffs each note's Waiting bullets across the window by their opening text.
- **Carried tickets:** read from the tracker at writing (states above).
- **What was not done:**
  - The test suites were not run beyond the two notes guards, since no code changed.
  - Sibling reviews' own findings were not re-derived.
  - Production frequency for 159 (how often a survey-task report cites a PR) was not measured.

## Notes: changes and prunes

The README was re-read before writing. Only `## Lessons` is capped. Waiting entries are never shortened to make room. An entry leaves only when settled, untrue or sent to a ticket.

- **Added (eight in Harbour, one in SD):**
  - `llm-and-prompts.md`: `lib/recommendation-facts.js` (159), `lib/prompts/stage-kinds.js` (161) and `lib/prompts/prompt-context.js` (167, added after the second read).
  - `front-end-pages.md`: `lib/time-words.js` (160, worded as a size of move).
  - `runs-and-dispatch.md`: `lib/run-closeout-state.js` (163) and `lib/dispatch-feedback-kinds.js` (165).
  - `other-features.md`: `lib/stage-writes.js` (162; the file falls to that area by the registry).
  - `providers.md`: `lib/providers/jira/as-asked-region.js` (166).
  - SD `stop-hook-and-relay.md`: `request-usage.js` (164), naming this report in prose as SD's README requires.
- **Made true (three):**
  - The `llm-and-prompts.md` `docs/areas/` entry now cites `lib/prompt-template-defs.js` first. The file it cited, `lib/periodicals.js`, spells the directory nowhere. It also states which count its command gives (28 / 14, all files) against the JavaScript-only figure it gave (19 / 12).
  - The `agent-api.md` test-token entry: the 16 inline sites it counted are now calls to `isHermeticTestToken`, which 12 modules import. Its larger move (inject transports from tests) stands.
  - The `front-end-browser.md` `public/session.js` entry: its blocker named `public/close-out.js`, which the run page does not load.
- **Prunes: none beyond those.** The window's own pieces removed what they settled (39 entries across the notes). The entries this run re-checked at HEAD all hold:
  - runs-and-dispatch: the outcome-words split; `mayCarryWake`; the `#N` re-review hole; the run page's two PR lists; the outside-merge limit John accepted.
  - front-end-pages: 157 (timeline tick style).
  - reports-and-operator-tools: 156.
  - providers: the four new entries.
  - front-end-browser: the seven new entries (one corrected above).
- **Lessons:** unchanged. `llm-and-prompts.md` is at 6118 of 6144 bytes and `runs-and-dispatch.md` at 6019, so a new Lesson there would need a prune first; this run adds none.
- **Guard:** `node --test tests/unit/area-notes.test.js` passes (11 / 11), and SD's `test/area-notes.test.js` passes.

## For John

- **Larger tidy (a size of move, in `front-end-pages.md`):** one relative-time wording across Settings, Home, the KPI pages and the browser pages (160). Visible copy and goldens change, so it is more than a fix. The untrue "one home" claims are fix-sized meanwhile.
- **LIN-4302 can close:** the VERB OVERRIDE list is derived from the stage records (`lib/proxy-instructions.js:15`), so the defect it names is gone in code. The ticket is still Backlog.
- **The LIN-4448 after-read and this review disagree on LLM & prompts** (no detectable code difference there; better here). Both are reported above, with why they measure different things. Which one closes LIN-4448 is your call, not this review's.
- **No finding lacks an area file to cite**, and none is urgent breakage. No dependency manifest or lockfile finding.
