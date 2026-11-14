# Drift & Coherence Review — 2026-11-14, run 8 (trend vs the 2026-11-13 run 7)

**Ticket:** LIN-4481. **Previous edition:** `docs/reviews/drift-coherence-review-2026-11-13.md` (run 7, LIN-4443, PR #2418, merged `0072d1b78`), called **run 7** below. **Evidence:** `docs/reviews/_evidence-2026-11-14-drift/`.

**Review-only.** This edition adds this report, its evidence folder and area-note edits under `docs/areas/` (`llm-and-prompts.md`, `runs-and-dispatch.md`, `front-end-pages.md`, `front-end-browser.md`, `agent-api.md`, `other-features.md`, `providers.md`). A companion docs-only PR in simple-dispatcher (SD) adds one Waiting entry to its `docs/areas/stop-hook-and-relay.md` (row 164). No code, config, guide, script, CI file or secret was changed in either repo.

The Harbour window is `e2d4659c4..fb358dbda`: 32 first-parent commits, run 7's own report (#2418) through LIN-4470 (#2450). It starts at run 7's measured commit, so there is no gap. SD is `af9b496..7d5fe7d`: 3 first-parent merges (#339 run 7's note, #340 LIN-4474, #341 LIN-4476). `origin/main` was `fb358dbda` in Harbour and `7d5fe7d` in SD when this was written, so the window was not extended.

## Better or worse, by area

**For the whole window: better.** This is the first window aimed squarely at run 7's findings, and the loop bent the curve. Seven of run 7's open rows are resolved at HEAD with their old copies deleted (142, 150, 151, 153, 154, 155, 158), and 131 is resolved in code. Eleven rows improved and none worsened. The census lost three real groups and gained none. The nine new rows are all LOW or LOW–MEDIUM. Most are one shape: a new home's header or doc claims every caller now reads it, while one reader still keeps its own rule (159, 160, 161, 163, 167). The window settled nearly as many Waiting entries as it recorded. Most of the growth is leftovers the pieces wrote down with a stated why, not new drift (see "Waiting counts" below).

| Area | Verdict | Evidence (code at `fb358dbda`, against `e2d4659c4`) |
|---|---|---|
| **Runs & dispatch** (`lib/run-trail.js`, `lib/run-closeout-state.js`, `lib/close-out-readiness.js`, `lib/run-live-wait.js`, `lib/cost-read*.js`, `lib/dispatch-feedback-kinds.js`, `lib/dispatch-leftover.js`, `lib/item-stage-stamp.js`) | **better** | **Better:** one close-out decision (`closeOutDecision`) answers the box, the guard, the check route and `blindReadStep`. `closeOutSetsDone`, `byPersonCheck`, `REFUSED_REASONS` and `readGateTrail` are gone (158 and 153 resolved; 58 improved). One comment classifier, `COMMENT_KINDS` (`lib/run-trail.js`): `landingPrUrls` is a view of it, `isLandingEvidence` is deleted, and the readers agree on agent notes (Seams run 12 §3.0a answered). `dispatchModelOf` is gone and the timeline reads the fold's model (150 resolved). The leftover gate reads `NEVER_RAN`, `HALT_MODES` and `followUpTarget` from their owners (142 resolved; census G0022, G0049, G0234 gone). The stamp kinds have one table (56 improved; G0078, G0345 gone). The calls cost read moved whole into `lib/cost-read-calls.js`. **Worse:** the Done bound is still split between the decision and the check route, and the decision's header says it is in one place (163, LOW). A leaf header is stale (165, LOW). |
| **LLM & prompts** (`lib/code-routes.js`, `lib/prompts/stage-kinds.js`, `lib/prompts/stage-catalogue.js`, `lib/prompts/prompt-context.js`, `lib/prompts/area-note-format.js`, `lib/recommendation-*.js`, `lib/periodicals.js`) | **better** | **Better:** `CODE_ROUTES` is the one list and every prose copy points at it; the `public/llms.txt` catalogue is generated and pinned byte for byte (154 resolved). One record per stage kind, with the old per-kind tables as views (136 improved, census G0100 gone; the VERB OVERRIDE list is derived, so 131 is resolved in code). The blind read's kind and heading come from the leaf, under an AST scan (151 resolved). One cited-path predicate, `isCitedPath` (155 resolved). `REGISTRY_PATH` derives from `NOTES_DIR` (145 improved). One prompt-context builder (`promptContextOf`) for four surfaces; its header also claims the routed recommendation, which keeps a pinned hand-built superset (167, LOW, found by the second read). `committedSearch` folds four spellings (143 improved). **Worse:** the selector's PR list and the look-first gate read every cited PR, beside the one landing; reproduced, a Survey report that cites a PR switches look-first off (159, LOW–MEDIUM). `catalogue.group` is a second home for the default-prompt split, and the source map overstates what became a view (161, LOW). |
| **Agent API (proxy)** (`lib/stage-write-gate.js`, `routes/proxy*.js`, `lib/proxy-instructions.js`) | **better** | The proxy now refuses writes outside a stage's allowance, from one table keyed by value (`ALLOWED_OPS`, `lib/stage-writes.js`). Every write mount names a classified operation, checked at mount. The VERB OVERRIDE list renders `Object.keys(STAGE_KINDS)`. The test-token check is one helper with 12 importers (G0008 gone). **Not yet:** "no stamp means work" is written in three modules, and the allowance table has no completeness check (162, LOW, filed under `lib/stage-writes.js`'s area, Other features). The enqueue list (137) is unchanged. |
| **Front end: browser** (`public/flight-companion.js`, `public/observation.js`, `public/task-page.js`, `public/cost-format-global.js`) | **neutral** | The three pages became modules with no globals written and no dual export (the old `public/live-console.js` one stays, row 139). One cost formatter (`lib/cost-format.js`), with the global shim inventoried and shrinking only. `public/task-page.js` dropped its `formatElapsed` copy (row 19 improved, G0264 gone). Seven Waiting entries were recorded. Two describe drift the conversion itself caused (`observation.js` reads `common.js` globals bare; `flight-companion.js`'s eight `if (mounted)` blocks); five record pre-existing copies. |
| **Front end: server-rendered pages** (`lib/time-words.js`, `lib/render*.js`, `lib/components/*`) | **neutral** | `fmtDuration` and `relativeAgo` got one leaf, served to the browser at `/lib/time-words.js` (row 40 improved). But the leaf, its test, the source map and `lib/components/time.js` claim it is the one home for relative time, while `formatRelativeTime` (`lib/render.js`), `window.relativeTime` (`public/common.js`) and `formatGeneratedAge` word the same moment differently (160, LOW–MEDIUM). Run 7's 157 (the timeline's tick style) is unchanged. |
| **Providers** (`lib/providers/jira/*`) | **neutral** | The Jira seal and create lanes import the As-asked markers and retype none. The region reader's end-line rule is looser than `splitAsAsked`, and the Lesson that calls it safe covers filing only (166, LOW). The four new Waiting entries hold at HEAD. |
| **Cross-repo (runner contract, SD)** | **better** | Both contract copies are byte-identical (sha256 `871ca615f627a026…`). The new `report` rows pin the session-PR pick on both sides (149 improved), and the `fold` rows pin the two transcript folds to each other. One named fold leftover has no home in either repo (164, LOW; SD note in the companion PR). SD's census is unchanged. |
| **Web routes, wiring, platform** (`server.js`, `lib/vendor-assets.js`, `routes/*`) | **neutral** | Wiring, the `/lib/` serving mount, and the write gate per operation. `res.status(` in `routes/` and `server.js`: 275 at both ends. |

**LIN-3449's gauge question: across the two programmes, did the readings move toward one place per decision, and where did a consolidation add a second home?**
- **Yes, toward one place.** Every targeted run-7 row moved, and in seven the old copies are deleted, so a caller cannot reach the old rule. That is LIN-3449's own done-when: "one place makes the decision, every caller uses it, old copies deleted in the same work". The census agrees: three real groups gone (G0008 test-token, G0022 `NEVER_RAN`, G0049 the leftover's halt test, which re-keyed as G0076), plus five table groups and G0171 shrunk to a table.
- **Where a consolidation left or added a second home:**
  - **LIN-4458 (one trail pass):** `assembleTrailFacts` still builds its own PR list from every comment, though the new leaf's header says the selector's facts are a view of it (159). This is the window's top finding.
  - **LIN-4467 (stage records):** `catalogue.group` beside `DEFAULT_PROMPT_KEYS` is a new second home (161).
  - **LIN-4468 (write allowance):** added a third copy of "no stamp means work" (162).
  - **LIN-4472 (time words):** declared one home beside three existing formatters (160).
  - **LIN-4460 (one close-out decision):** left the stop-at bound in the route, while claiming it is in one place (163).
  - **LIN-4459 (live wait):** split the run-outcome words between `lib/run-live-wait.js` and `lib/recent-runs.js` to avoid an import cycle. Its own leftover step recorded this as a Waiting entry, so it is not re-filed here.
- **A move is not always a removal.** The LIN-4448 after-read (`docs/plans/survey/area-read-reports/`) measured no detectable code difference for LLM & prompts (D = −0.3, inside the ±0.5 band) while this review reads the area as better. The two instruments measure different things: the area read scores a 14-file sample that leaves out most of the moved files, and this review follows each duplicated decision to its callers. Both are reported. Neither overrides the other.

## Headline

1. **Better overall.** Seven run-7 rows are resolved with their old copies deleted (142, 150, 151, 153, 154, 155, 158), and 131 is resolved in code. Eleven improved (19, 40, 47, 56, 58, 136, 143, 145, 148, 149, 152). None worsened. Nine new (eight from this reading, one from the second read), none above LOW–MEDIUM.
2. **Top window finding: the selector and the look-first gate read every cited PR beside the one landing (159, LOW–MEDIUM, new; reproduced).**
   - `assembleTrailFacts` (`lib/recommendation-facts.js:466-471`) collects `prUrls` from every comment, with no kind filter.
   - That list feeds the selector line `- PRs linked on the trail:` (`:554`) and the look-first gate `if (facts.prUrls.length) return 'has a PR'` (`lib/recommendation-look-first.js:152`).
   - The one landing (`readTrail().landing`, `lib/run-trail.js`) gives blind reads, Survey reports and area reads no landing (`COMMENT_KINDS`, `:134-145`). Yet `lib/run-trail.js:15-17` says the selector's `assembleTrailFacts` is a view of the trail, "so the box, the guard, the route and the prompt cannot disagree about which PRs are the task's".
   - Reproduced (`look-first-survey-pr-repro.mjs`): a `## Survey open-0` report that cites a related PR makes `lookFirstOff` return `"has a PR"`, so survey-place and scoping are skipped, while `readTrail().landing` is `[]`. The same report without the link sends survey-place next.
   - The reader predates the window. The claim, and the table it contradicts, are LIN-4458's.
   - Production frequency is not measured: it depends on how often a survey-task report cites a PR. Note: `llm-and-prompts.md`, naming `lib/run-trail.js` on the other side.
3. **Second: relative time has four homes, and the window's new leaf claims to be the one (160, LOW–MEDIUM, new).**
   - `lib/time-words.js:2` says it is "one home for the server and the task page". So do `tests/unit/lin-4472-time-words.test.js:2`, `docs/architecture/source-map.md:151` and `lib/components/time.js:4-5`.
   - Three more formatters word the same moment:
     - `formatRelativeTime` (`lib/render.js:122`, "25m ago", then "yesterday"; Settings, Home, KPIs);
     - `window.relativeTime` (`public/common.js:576`, read bare by the Observation module);
     - `formatGeneratedAge` (`public/prompt-section.js:103`, which rounds).
   - The task page says "5 minutes ago" where Observation says "5m ago".
   - The guard keys on two names, so it sees none of these. Byte-identical `formatDuration` copies also sit in `lib/render-escalation-kpis.js:21` and `lib/render-effort-readout.js:21`.
   - Note: `front-end-pages.md`, worded as a size of move.
4. **The new homes' claims outrun their callers in three more places, each LOW:**
   - **161:** `catalogue.group` (`lib/prompts/stage-kinds.js`) and `DEFAULT_PROMPT_KEYS` (`lib/render-prompt-opts.js:14`) are two unlinked homes of the default-prompt split. The source map says every per-kind table is a view, while about eight stay kind-keyed.
   - **163:** `lib/run-closeout-state.js:31-34` says the Done rule is "bounded here, in one place". But `setDone` (`:269`) has no stop-at term, and the route applies it (`routes/workspace-api-run-evidence.js:296-302`). The person-acted rule is also spelled twice inside the decision (`:261`, `:265`).
   - **165:** `lib/dispatch-feedback-kinds.js:15-16, 48-49` describes a store re-export that no longer exists.
5. **The write allowance (LIN-4468) added a third copy of a default (162, LOW, new).**
   - "No stamp means work" is in `lib/item-stage-stamp.js:22, 67`, `lib/proxy-preamble.js:246-248` and `lib/stage-writes.js:98-101, 114`.
   - An unknown value throws in one and reads `none` in another.
   - `ALLOWED_OPS` has no completeness check, so a new value would answer 500, not 403.
   - "One comment" is enforced by the prompt only: the gate allows the operation any number of times.
6. **Cross-repo.** The contract copies are byte-identical, and each repo pins its own copy's sha256. That is two pins, not one check, as before.
   - The session-PR pick is now pinned by nine `report` rows on both sides (149 improved). Only the no-`DONE:` fallback is unpinned.
   - The contract names SD's raw `""` model and `""` timestamp as "a leftover for Simple Dispatcher, not fixed here", and neither repo's notes held it. Harbour's intake rejects `at: ""` (`lib/request-usage-intake.js:91`), so such a request record is lost (164, LOW; SD note).
   - The `[working]` grammar (140) is unchanged.
7. **Jira (166, LOW, new).** For a block edited in Jira, the region reader takes the first end paragraph, matched as plain text. A plain copy of the end sentence inside the words cuts them short. The providers Lesson's safety argument covers filing, not a later edit.
8. **Census.** Harbour has 107 `mustRule` groups (102 unchanged, 2 grown, 2 shrunk, 1 new). Rulings: 32 real, 29 borderline, 46 noise (run 7: 34 / 28 / 46).
   - Three real groups are gone (G0008, G0022, G0049).
   - G0049 re-keyed as G0076 (real) when the leftover gate took `HALT_MODES`.
   - G0171 (`name === 'linear'`, borderline) dropped to a table group when LIN-4456 removed the provider-name test.
   - G0025 and G0176 are ruled for the first time (both borderline).
   - Eleven groups are gone in all, eight of them table groups.
   - **SD:** 61 groups, 27 `mustRule`, all unchanged; no ruled site is in a window hunk.
9. **Import graph.** 533 nodes, 2249 static edges, 2 dynamic (+104 / −33 static against run 7's reproduced graph). SCCs are unchanged (6 + 6, the same members). Upward `lib/` → `routes/` edges: 0 / 0. The largest new fan-ins are `lib/run-trail.js` (11), `lib/prompts/blind-read-words.js` and `lib/prompts/stage-kinds.js` (8 each), and `lib/dispatch-feedback-kinds.js` (7). `lib/prompts/stage-catalogue.js` has no importer under `lib/` or `routes/`; only `scripts/gen-llms-catalogue.mjs` and its test read it.
10. **Notes.** Nine Waiting entries were added, one per new row: eight in Harbour (159, 160, 161, 162, 163, 165, 166, 167) and one in SD (164). Three existing entries were made true: the `docs/areas/` count and its first citation, the test-token recount, and the `session.js` blocker. Nothing else was pruned, because the window's own pieces already removed what they settled (39 removals). Every Lessons section is under the 6144-byte cap. The notes guard passes in both repos.
11. **Zero new tickets.** Carried tickets at writing: LIN-4320, 4318, 4302, 4256, 4303, 3828, 4301 and 4416 are Backlog; LIN-3449 is Todo with 22 comments and 45 children. LIN-4302's defect (131) is gone in code while the ticket is still Backlog; that is for the person, below.
12. **Second read: AGREE** (Tier 2, a fresh-context sub-agent). The reader confirmed 159 as the largest item and found nothing larger. Its largest miss was one more overclaiming header, `lib/prompts/prompt-context.js` (now row 167, LOW, with a note entry). It also sharpened 149's delta. Disposition: fixed in place.

## Grounding (HEADs measured)

- **LinearViewer: window end `fb358dbda7f26ab44b3f58acb15886b21ac20950`** (LIN-4470, #2450); window start `e2d4659c4bf07ed266735f718e85232e5f2a6458`.
  - Production plus scripts (`git diff --shortstat e2d4659c4 fb358dbda -- lib routes public server.js scripts`): **142 files, +8221 / −6257**, matching the ticket. Without `scripts`: 137 files, +8151 / −6254. All files: 442, +122776 / −9276. Without `docs/papers` and `docs/reviews`: 355, +22498 / −9276.
  - Window file list and numstat: `window-commits-run8.txt`, `window-numstat-all-run8.tsv`.
- **SD: window end `7d5fe7d9473232152365e6837ececcd6f2876987`**, start `af9b496d57f042972b912a30eb8c4d1164bbab77`: 7 files, +737 / −86. The code files are `hook.js`, `transcript.js`, `test/fixtures/runner-contract.json`, `test/runner-contract.test.js` and `test/lin-4474-sentinel-family.test.js`.
- **Area registry (Harbour):** `docs/areas/areas.json`, git blob `a4f33893e57fd7e936b05879f515c1edd4115078`, sha256 `3dcdfb1a711e6974…`. Run 7 used blob `d13fca20` (kept here as `areas-run7-d13fca20.json`). The window's edit files `cost-format`, `time-words`, `stage-write-gate`, `item-stage-stamp`, `usage-snapshot-intake`, `cost-read-calls` and `code-routes`. The guide-only check below shows the edit changes nothing at the baseline.
- **Area registry (SD):** blob `c977bd0c0a186c1314202673da22cf31b8a0da29`, unchanged since run 6.
- **Runner contract:** `lib/runner-kit/contract.json` and SD's `test/fixtures/runner-contract.json` are byte-identical (sha256 `871ca615f627a026…`; it was `602ab014…` at run 7, so the window re-pinned both sides). `EXCHANGE_MAX_WAIT_SECONDS = 60` in both repos, now pinned by exchange rows at 60 and 61 on each side.
- **TODO / FIXME markers added in the window:** none in Harbour (`lib`, `routes`, `public`, `server.js`, `scripts`, `tests`; one Jira test fixture names a variable `TODO`) and none in SD.
- **Ticket staleness check:** `git log --since=2026-11-14T10:01:39.508Z` is empty in both repos, so the ticket's description of the code holds at HEAD. Where it is inexact, that is said in place: the Waiting counts it quotes are bullets at `fb358dbda`, before this PR.


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


## Census rulings (the 107 `mustRule` groups, run-8 reading)

Carried by key from run 7 unless the basis says otherwise; `hunk` marks a site inside a window hunk, re-read at HEAD (last column).

| rank | id (run 7) | decision | a/f/s | status | basis | hunk | ruling | reason | re-read |
|---|---|---|---|---|---|---|---|---|---|
| 1 | G0001 (G0002) | repeated comparison kind == 'autopilot' | 4/19/31 | unchanged | carried-by-key | — | real | Anchor test repeated inline: run-view.js:340 copies findAnchorLoop's test (session-summary.js:53); dispatch-store 573/738 repeat run-root. Home: findAnchorLoop plus one run-root helper. |  |
| 2 | G0002 (G0001) | repeated comparison NODE_ENV == 'test' | 7/14/31 | shrunk | carried-by-decision+overlap | yes | real | Env read inline 43x; 10 identical limiter skip arrows re-derive test mode. Home: lib/should-mock-ai.js plus one skipInTest helper (10-23 named it; it never landed). | Re-read: shrunk 43 -> 31 sites; the test-token half moved into isHermeticTestToken (LIN-4456/4450, G0008 gone). The bare NODE_ENV reads and the limiter skips stand. Ruling stands. |
| 3 | G0003 (G0003) | record assembled from the same sources {id=ID.id, title=ID.title} | 7/11/17 | unchanged | carried-by-key | — | noise | A new shared home for two mocks (record {id,title} re-keyed from the gone {id,identifier,title}); lib/sample-data/fixture-parent.js is the first home. |  |
| 4 | G0004 (G0004) | tiny rule copied as a helper slugifyForFilename() (also: githubSlug, stripMarkdown, _repoSpelling, slugifyPeriodicalTitle), 12 copies of 1-4 statements | 5/10/12 | unchanged | carried-by-key | — | noise | periodical-runs.js:193 is the first home for repo spelling (no exported repo normaliser); the copies are not a shared decision yet. |  |
| 5 | G0005 (G0005) | record assembled from the same sources {deployInfo=getDeployInfo(), urlKey=ID.urlKey, openRouterSource=getOpenRouterSource(), workspaces=ID.session.workspaces} | 2/13/13 | unchanged | carried-by-key | — | real | 13 routes rebuild the same deployInfo/urlKey/openRouterSource/workspaces record with no shared builder. One chrome-options builder beside lib/components/page.js should own it. |  |
| 6 | G0006 (G0006) | repeated comparison authType == 'oauth' | 4/8/12 | unchanged | carried-by-key | — | real | lib/workspace.js getBindingCallScope |  |
| 7 | G0007 (G0007) | repeated comparison kind == 'wake' | 2/11/24 | unchanged | carried-by-key | — | real | runner.mjs repeats the wake-claim test (kind wake, dispatchedBy null, followUpTo) at lines 122, 1012 and 1332; one helper in that file. Other wake sites are distinct filters. |  |
| 8 | G0008 (G0009) | repeated comparison status == 'taken' | 1/9/16 | unchanged | carried-by-key | — | borderline | Status literal still 16 sites in 9 files; the 5 in `dispatch-lineage-status.js` remain beside `lineage-membership.js:39`, which already holds the joined predicate. One helper is cheap; benefit still unclear. |  |
| 9 | G0009 (G0010) | repeated comparison provider == 'jira' | 2/6/8 | unchanged | carried-by-key | — | noise | provider switch at the edge; each branch differs |  |
| 10 | G0010 (G0011) | repeated comparison type == 'started' | 5/7/11 | unchanged | carried-by-key | — | real | isInProgress (providers/state-map.js:59) and home-view isStarted exist, yet about 8 sites inline state.type==='started' (tree.js, openrouter, recommendation-facts, proxy.js). Route them through it. |  |
| 11 | G0011 (G0012) | repeated comparison stopAt == 'pr' | 4/10/15 | unchanged | carried-by-key | yes | real | Inline stopAt==='pr' at 15 sites; readTaskRunFacts().stopAt is the home, but dispatch-entrance.js:1756 and dispatch-factory.js:444/1170 still re-derive it. | Re-read: the site in lib/run-closeout-state.js moved inside closeOutDecision (LIN-4460). readTaskRunFacts().stopAt is still the home and the re-derivations stand. Ruling stands. |
| 12 | G0012 (G0013) | text contract marker: [blocked] | 3/7/15 | unchanged | carried-by-key | — | borderline | dispatch-terminal — the parse side is the authority; the emit side is the kit |  |
| 13 | G0013 (G0014) | repeated comparison scope == 'current' | 3/10/16 | unchanged | carried-by-key | — | real | Find-by-(provider,scope) binding lookup is re-written at ~9 sites in 6 files; workspace.js already owns binding lookup (getBindingsForWorkspace). Label 'scope == current' is misleading. Home: lib/workspace.js. |  |
| 14 | G0014 (G0016) | repeated comparison key == 'Enter' | 1/8/12 | unchanged | carried-by-key | — | borderline | Enter/Space activation repeated in 4 handlers; app.js x2 and common.js carry a Spacebar alias. Other Enter sites are send-on-Enter with shift guards, distinct. No shared helper. |  |
| 15 | G0015 (G0015) | repeated comparison key == 'Escape' | 1/7/10 | unchanged | carried-by-key | — | noise | Each Escape handler closes its own component (queue, search, toggles, selectors, sheet); the literal is the platform key name, no shared rule is re-derived. |  |
| 16 | G0016 (G0017) | repeated comparison NODE_ENV == 'production' | 3/5/7 | unchanged | carried-by-key | — | noise | Environment switch for secure cookies and https redirects; each site sets a different setting. Inert and not a domain decision. |  |
| 17 | G0017 (G0018) | repeated comparison name == 'AbortError' | 4/6/9 | unchanged | carried-by-key | — | noise | standard fetch-abort check |  |
| 18 | G0018 (G0020) | text contract marker: [skipped] | 3/5/8 | unchanged | carried-by-decision+overlap | yes | borderline | Grown from table to mustRule by two blind-read prompt sites (completion-signals.js:260, prompt-template-defs.js:1310) that ask an agent to end [skipped]; the parse authority is dispatch-terminal, as for [blocked]/[failed] (borderline). | Re-read: the blind-read prompt site moved into its record (lib/prompts/stage-kinds.js:586, LIN-4467). The parse authority is still dispatch-terminal. Ruling stands. |
| 19 | G0019 (G0019) | string set {'127.0.0.1', 'localhost'} as array [[...].includes, [...].some] | 4/4/8 | unchanged | carried-by-key | — | real | isLocalhostRequest in lib/public-origin.js is the home; server.js inlines the same host test 5x and workspace-api-issue-read.js once. dispatch-entrance.js:245 is an exact-host variant. |  |
| 20 | G0020 (G0021) | repeated comparison provider == 'linear' | 2/4/7 | unchanged | carried-by-key | — | borderline | workspace-token-refresh defaultResolveExchange |  |
| 21 | G0021 (G0023) | record assembled from the same sources {code=ID.code, category=ID.category, retryable=ID.retryable} | 4/7/8 | unchanged | carried-by-key | — | real | lib/errors.js — refusal envelope; `lib/errors.js` is the home |  |
| 22 | G0022 (G0025) | string set {'Apr', 'Aug', 'Dec', 'Feb', 'Jan', 'Jul', +6} as array [months, MONTHS, FLOW_MONTHS] | 4/6/7 | unchanged | carried-by-key | — | noise | Inert month-abbreviation constants copied across lib and public; values cannot drift in meaning. Harmless duplication. |  |
| 23 | G0023 (G0024) | text contract marker: [evidence] | 5/6/9 | unchanged | carried-by-key | — | real | session-telemetry EVIDENCE_PREFIX |  |
| 24 | G0024 (G0026) | string set {'github', 'github-projects', 'jira', 'linear', 'local'} as switch/array/or-chain [ID.provider, KNOWN_SOURCES, REGISTRY_PROVIDERS] | 3/4/4 | unchanged | carried-by-key | — | borderline | `REGISTRY_PROVIDERS` (`lib/workspace-store.js:4`) restates the provider registry (`providers/registry.js` `getAllProviders`); LOW |  |
| 25 | G0025 (G0027) | repeated comparison target == 'local' | 2/5/5 | unchanged | ruled from sites | — | borderline | First ruling (run 7's G0027 was a table group). Two decisions share the literal: 'local' shown as 'harbour' is mapped twice in classic browser code (public/common.js:441, whose comment says it is the shared helper, and public/dispatch.js:1147), and the localhost-only rule is written in lib/dispatch-entrance.js:262 and again in offeredTargetsFor (lib/dispatch-targets.js:84). Low cost; the target home is lib/dispatch-targets.js. |  |
| 28 | G0028 (G0030) | tiny rule copied as a helper (anonymous)(), 8 copies of 1-4 statements | 5/6/8 | unchanged | carried-by-key | — | real | Mock-issue comment shaping is identical in proxy-compute.js:116, task-chat.js:69 and workspace-api-mocks.js:218. Home: buildMockRecapContext in lib/workspace-api-mocks.js; provider shapes differ. |  |
| 30 | G0030 (G0034) | repeated comparison status == 'owner' | 4/8/8 | unchanged | carried-by-key | — | borderline | Seven consumers switch on the one answer from readOwnerSeamStatus in lib/workspace-owner.js. The home exists; only the literal is repeated. |  |
| 31 | G0031 (G0039) | text contract marker: [done] | 4/5/7 | unchanged | carried-by-key | — | noise | Grown (was run-5 G0099, borderline). New sites are the parse authority REPORT_LINE_RE (dispatch-terminal.js:663) and prose at dispatch-wake.js:356. Re-ruled noise. |  |
| 32 | G0032 (G0033) | repeated comparison harness == 'claude-code' | 4/5/8 | unchanged | carried-by-key | — | borderline | harness == 'claude-code' special case repeats at 8 sites in 5 files (curated list, model mapping, catalog guard, label dedupe); each rule differs, so cost is unclear. |  |
| 34 | G0034 (G0035) | repeated comparison type == 'blocks' | 3/10/12 | unchanged | carried-by-key | — | noise | Linear relation literal at 12 sites, each reading a different field for a different purpose; one external enum meaning. |  |
| 35 | G0035 (G0036) | record assembled from the same sources {token=ID.token, expiresAt=ID.expiresAt, provider=ID.provider, scope=ID.scope} | 3/3/9 | unchanged | carried-by-key | — | borderline | server.js resolver — cache tuple; follows the credential row, no separate decision |  |
| 36 | G0036 (G0037) | repeated comparison enabled == 'true' | 3/3/3 | unchanged | carried-by-key | — | noise | Same one-line boolean parse in a user-level session toggle (server.js) and a workspace-level settings route (routes/settings.js); different stores and rules. |  |
| 37 | G0037 (G0040) | repeated comparison recommendedAction == 'defer' | 3/4/6 | unchanged | carried-by-key | — | borderline | recommend-recurse |  |
| 38 | G0038 (G0041) | repeated comparison kind == 'recent' | 3/3/3 | unchanged | carried-by-key | — | noise | 'recent' is a collective-characters doc kind at one site and a home-row kind at two others; different kind spaces, no shared rule re-derived. |  |
| 39 | G0039 (G0044) | repeated comparison type == 'completed' | 5/8/10 | unchanged | carried-by-key | — | noise | Literal is deliberate in follow-on-ratio.js and ship-journey.js (documented as not isCompleted/isTerminalState); roadmap and tree sites are separate reads. |  |
| 40 | G0040 (G0042) | repeated comparison status == 'ready' | 3/5/7 | unchanged | carried-by-key | — | noise | 'ready' names different enums: close-out status in task-page-loader, close-out.js and session.js versus prompt aiState. Unrelated meanings. |  |
| 41 | G0041 (G0043) | repeated comparison code == 'OWNER_CHECK_UNAVAILABLE' | 3/5/5 | unchanged | carried-by-key | — | borderline | proxy-preamble — sentinel string shared by two modules; follows the credential row |  |
| 42 | G0042 (G0045) | repeated comparison kind == 'custom' | 3/4/5 | unchanged | carried-by-key | — | noise | Grown by a store site. Codebase idiom: the custom-kind guard answers a different question at each site (dispatch-store.js:3453). |  |
| 45 | G0045 (G0046) | string set {'effort', 'harness', 'model'} as table-keys/array [FIELD_WORDS, [...].filter, OPAQUE_FIELDS] | 4/5/5 | unchanged | carried-by-key | — | real | model/harness/effort restated at 5 sites; model-routing.js FIELDS.AGENT_SESSION already declares them. dispatch-validation OPAQUE_FIELDS adds terminal, a different rule. Home: lib/model-routing.js. |  |
| 46 | G0046 (G0048) | text contract marker: [failed] | 3/4/17 | unchanged | carried-by-key | — | borderline | dispatch-terminal parses / kit emits |  |
| 47 | G0047 (G0051) | repeated comparison state == 'running' | 3/6/25 | unchanged | carried-by-key | — | borderline | 22 sites in 5 files mix stage, ledger-row and session state spaces; runner.mjs re-tests row 'running' ~10 times with no shared predicate. Only that ledger cluster is one rule. |  |
| 50 | G0050 (G0052) | tiny rule copied as a helper hashKey() (also: hashEmailRecipient, hashState, hashContext, inputHash), 11 copies of 1-4 statements | 4/9/11 | unchanged | carried-by-key | — | noise | hash helpers, identical by design; now also `account-erasure.js:231` |  |
| 51 | G0051 (G0057) | record assembled from the same sources {id=ID.id, body=ID.body, createdAt=ID.createdAt} | 4/5/7 | unchanged | carried-by-key | — | noise | comment record, three fields |  |
| 52 | G0052 (G0055) | tiny rule copied as a helper (anonymous)() (also: brief), 3 copies of 1-4 statements | 3/3/3 | unchanged | carried-by-key | — | noise | new only because LIN-3596 moved the mocks; same shape |  |
| 59 | G0059 (G0060) | repeated comparison turnKind == 'user-initiated' | 4/5/25 | unchanged | carried-by-key | yes | borderline | lib/agent-turn.js | Re-read: public/flight-companion.js sites moved with the module conversion (LIN-4463); same comparisons. Ruling stands. |
| 75 | G0075 (G0081) | repeated comparison agentState == 'error' | 3/4/5 | unchanged | carried-by-key | — | noise | Error reads map to different outputs (failed status in task-page-loader, summary text in dashboard-summaries). Not the same decision. |  |
| 76 | G0076 (-) | string set {'pause', 'stop'} as table-keys/or-chain/array [HALT_BANNER_WORD, HALT_MODE_LABELS] | 3/4/4 | new | ruled from sites | — | real | G0049 re-keyed: lib/dispatch-leftover.js left the group when it took HALT_MODES (row 142, resolved). The mode-to-word maps remain, HALT_BANNER_WORD (lib/render.js:223, keyed off HALT_MODES by comment only) and HALT_MODE_LABELS (public/dispatch.js:797); runner.mjs is the kit's designed mirror. Home: lib/workspace-halt.js HALT_MODES. Row 102. |  |
| 79 | G0079 (G0084) | repeated comparison kind == 'implementation' | 3/6/7 | unchanged | carried-by-key | — | noise | Grown by dispatch-leftover.js:61, which is the body of isStageBuild, a new predicate of its own, not a second copy of an existing one. |  |
| 83 | G0083 (G0083) | repeated comparison stateType == 'started' | 3/10/19 | unchanged | carried-by-key | — | real | Task-or-subtask in-progress test copied in render-roadmap.js:86, roadmap-digest-template.js:103 and roadmap-narrative-template.js:122. Home: lib/roadmap.js. |  |
| 89 | G0089 (G0092) | repeated comparison state == 'done' | 3/4/5 | unchanged | carried-by-key | — | noise | Stage tone, ledger row, task-state settle and ticket markers are four different state machines that share the word; no shared rule is re-derived. |  |
| 90 | G0090 (G0093) | string set {'merged', 'partial'} as or-chain/Set [ID.closeOut.status, MERGED_STATUSES, ID.status] | 3/4/5 | unchanged | carried-by-key | — | real | `lib/run-closeout-state.js` (owns `PARTIAL`/`MERGED`); export an `isMerged` predicate |  |
| 91 | G0091 (G0096) | text contract heading: changelog | 3/3/3 | unchanged | carried-by-key | — | real | `lib/workspace-api-mocks.js` `buildMockBrief` (headings as a contract) |  |
| 92 | G0092 (G0097) | text contract heading: constraints | 3/3/3 | unchanged | carried-by-key | — | real | as G0088 |  |
| 93 | G0093 (G0098) | text contract heading: open questions | 3/3/3 | unchanged | carried-by-key | — | real | as G0088 |  |
| 97 | G0097 (G0101) | string set {'assistant', 'user'} as or-chain/if-chain [ID.role] | 4/6/6 | unchanged | carried-by-key | yes | borderline | lib/chat-transcript.js filterChatTurns (bypassed ×3) — role filter; `filterChatTurns` is bypassed three times (LIN-2430 residue) | Re-read: public/flight-companion.js site moved with the module conversion. Ruling stands. |
| 98 | G0098 (G0102) | repeated comparison type == 'text' | 3/3/5 | unchanged | carried-by-key | — | noise | Three sites are ADF node types, one a Claude content block, one a DOM input type; different type namespaces that share the literal. |  |
| 100 | G0100 (G0107) | repeated comparison state == 'waiting' | 3/4/8 | unchanged | carried-by-key | — | borderline | 'waiting' compared inline at 8 sites; UNENDED_STATES now lives in lib/task-state.js:28 (running, queued, waiting). Routing each read is modest cost. |  |
| 104 | G0104 (G0112) | string set {'number', 'string'} as or-chain [typeofID] | 3/3/3 | unchanged | carried-by-key | — | noise | isScalar, the brief's date coercion and toEpochMs share a typeof idiom but answer different questions; no drifting rule. |  |
| 105 | G0105 (G0111) | named constant MONTHS=[Apr,Aug,Dec,Feb,Jan,Jul,Jun,Mar,May,Nov,Oct,Sep] | 3/3/3 | unchanged | carried-by-key | — | borderline | Identical 12-entry month table in home-view, render and task-page-loader; lib/utils/time.js already holds date helpers. Drift unlikely; sharing is cheap but low value. |  |
| 112 | G0112 (G0115) | repeated comparison status == 'error' | 3/3/5 | unchanged | carried-by-key | — | noise | Grown by dispatch-factory.js:1074-1075, a local settleWithin shape; no shared home for a write status check. |  |
| 119 | G0119 (G0131) | near-duplicate function buildMockRecapContext() (also: buildMockRecapContextFromFixtures, buildMockTaskContext), ~8 statements, same vocabulary (dialect copy or close variant) | 3/3/3 | unchanged | carried-by-key | — | real | `lib/workspace-api-mocks.js` `buildMockRecapContext` |  |
| 121 | G0121 (G0133) | tiny rule copied as a helper (anonymous)(), 3 copies of 1-4 statements | 3/3/3 | shrunk | carried-by-key | — | real | Same mock child shaping in workspace-api-mocks.js:211, proxy-compute.js:122 and task-chat.js:75; home buildMockRecapContext in lib/workspace-api-mocks.js. Pairs with G0035. |  |
| 123 | G0123 (G0122) | tiny rule copied as a helper (anonymous)(), 9 copies of 1-4 statements | 3/9/9 | grown | carried-by-key | — | noise | Nine stream-event callbacks, each a distinct consumer; the shared body is one token append. Not one decision to home. |  |
| 127 | G0127 (G0137) | repeated comparison provider == 'local' | 4/4/4 | unchanged | carried-by-key | yes | borderline | Four different uses, but workspace-api-audit.js:36 re-inlines shouldMockAi's test-plus-local predicate despite its comment. Needs one home or a documented decision. | Re-read: routes/workspace-api-audit.js now calls isHermeticTestToken but still inlines the NODE_ENV-and-local half beside shouldMockAi, by its own comment's choice (a data-mock carve-out). Ruling stands. |
| 128 | G0128 (G0132) | repeated comparison disposition == 'task-bound' | 3/3/7 | unchanged | carried-by-key | — | borderline | Server disposition enum; observation.js branches on it 5 times with different actions. Only the deliverRulingStampOnly pair (2868, 3295) is one duplicated rule; cost unclear. |  |
| 130 | G0130 (G0129) | tiny rule copied as a helper escapeHtml() (also: escapeXml), 3 copies of 1-4 statements | 3/3/3 | unchanged | carried-by-key | — | noise | escape helpers per output format |  |
| 137 | G0137 (G0141) | repeated comparison state == 'failed' | 3/4/7 | unchanged | carried-by-key | — | borderline | `state == 'failed'` in task-state.js roll-ups and attention (`:144,:168,:275,:345`) and in home-view / task-board counts; `task-page-loader.js:648` (`plainRunState`, LIN-4106) is a run state with the same word. Two state domains share one literal; the decision that matters is `task-state.js:168`. Not a Drift finding. |  |
| 142 | G0142 (G0138) | string set {'queued', 'running'} as or-chain [ID.state, ID.outcome] | 3/4/5 | unchanged | carried-by-decision+overlap | yes | real | running//queued test is inline at home-view:59, render-task-page:245/283, task-state:143 and recent-runs:82; task-state.js exports isOpenState/isUnendedState but not this set. Home: lib/task-state.js. | Re-read: the site moved with isLiveRun to lib/run-live-wait.js (LIN-4459); the inline running/queued tests elsewhere stand. Ruling stands. |
| 143 | G0143 (G0146) | named constant UUID_REGEX=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i | 3/3/3 | unchanged | carried-by-key | — | borderline | lib/workspace.js; `UUID_REGEX` copies 6 → 3 |  |
| 144 | G0144 (G0147) | repeated comparison status == 'done' | 3/3/6 | unchanged | carried-by-key | yes | noise | done status literal; unrelated meanings | Re-read: public/task-page.js sites moved with the module conversion (LIN-4472). Ruling stands. |
| 150 | G0150 (G0156) | repeated comparison phase == 'result' | 3/3/3 | unchanged | carried-by-key | yes | noise | phase literal in one module | Re-read: public/flight-companion.js site moved with the module conversion. Ruling stands. |
| 151 | G0151 (G0152) | named constant SWEEP_INSTANCE_PREFIX="sweep:v1:" | 3/3/3 | unchanged | carried-by-key | — | real | `lib/observer-sweep.js` (the writer; uses an inline literal at :449) |  |
| 153 | G0153 (G0175) | repeated comparison category == 'auth' | 4/4/4 | unchanged | carried-by-key | — | noise | Three sites read a classification they already hold; isAuthError exists for bare errors. Trivial token comparison, no drift risk. |  |
| 154 | G0154 (G0196) | text contract marker: [ticket-closer] | 3/4/4 | unchanged | carried-by-key | — | borderline | Tag hardcoded in three route catch logs while ticket-close-closer.js owns a LOG const. A console prefix, not a posted marker; cost unclear. |  |
| 155 | G0155 (G0158) | tiny rule copied as a helper stripCodeFence() (also: trimToNull, parseRecommendedAction, parseDeferTo, parseWhyNow), 6 copies of 1-4 statements | 4/4/6 | unchanged | carried-by-key | — | noise | small parse helpers, coincidental similarity |  |
| 157 | G0157 (G0166) | repeated comparison state == 'needs-you' | 3/3/6 | unchanged | carried-by-key | — | real | needsAPerson(state) already exists in task-state.js, yet task-state.js:275 inlines 'needs-you // failed' instead of calling it. Other sites are per-state text or lists. Home: lib/task-state.js. |  |
| 158 | G0158 (G0167) | repeated comparison state == 'queued' | 3/3/7 | unchanged | carried-by-key | — | noise | Queued checks are per-site labels, tones, selection and mapping; the shared in-flight test is G0148, so this is not a separate rule. |  |
| 159 | G0159 (G0168) | repeated comparison waitingFor == 'ruling' | 3/3/7 | unchanged | carried-by-key | — | borderline | task-page-loader tests model.waitingFor==='ruling' at 938, 991, 1017, 1471 though 991 derives waitingOnRuling once; one local would own it. Low cost. |  |
| 163 | G0163 (G0157) | string set {'0', '1', '2', '3', '4'} as table-keys [PRIORITY_WORDS, FLOW_PRIO, pLabels] | 4/6/8 | unchanged | carried-by-key | — | real | Priority number-to-name map re-declared at 6+ sites (home-view, local provider, swim x2, swipe, roadmap template); render.js already exports PRIORITY_OPTION_LABELS. Home: lib/render.js. |  |
| 164 | G0164 (G0177) | repeated comparison variant == 'stepper' | 3/3/3 | unchanged | carried-by-key | — | noise | Three local reads of a variant literal; the allowed-variant validator is elsewhere. Each read is local. |  |
| 165 | G0165 (G0172) | string set {'standard', 'stepper'} as array/ternary-chain [AUTOPILOT_VARIANTS, ID.variant] | 3/3/3 | unchanged | carried-by-key | — | borderline | `lib/prompts/autopilot-kickoff.js` `AUTOPILOT_VARIANTS` — `AUTOPILOT_VARIANTS` already exists; callers should import it |  |
| 172 | G0172 (G0182) | tiny rule copied as a helper _issueRef() (also: refOf, projectNeighbor), 3 copies of 1-4 statements | 3/3/3 | unchanged | carried-by-key | — | noise | Three ref projections returning different fields under different names. Not one decision. |  |
| 176 | G0176 (G0338) | repeated comparison kind == 'decision-withdrawn' | 3/3/3 | grown | ruled from sites | — | borderline | First ruling (grown from table). digest-feedback.js:219 parses a withdrawal and proxy-runner.js:244 clears a cache on one: single-kind checks, fine. public/dispatch.js:1062 restates the three-kind stamp set whose home is DECISION_LIFECYCLE_STAMP_KINDS (lib/dispatch-feedback-kinds.js); it is a classic script under a drift test (row 56). |  |
| 190 | G0190 (G0191) | tiny rule copied as a helper normalizePrivateKey() (also: cleanClaim, stripCodeBlockFences), 3 copies of 1-4 statements | 3/3/3 | unchanged | carried-by-key | — | noise | string cleanup helpers, coincidental |  |
| 198 | G0198 (G0192) | tiny rule copied as a helper constructor(), 5 copies of 1-4 statements | 3/5/5 | unchanged | carried-by-key | — | noise | store constructors — reused from 10-18 G0149 (lead matched G0359, a groupKey twin) |  |
| 205 | G0205 (G0230) | repeated comparison state == 'parked' | 3/3/3 | unchanged | carried-by-key | — | noise | Three sites: a text line, a task-state switch to 'waiting', and one evidence check on the same field; per-site, no shared rule re-derived. |  |
| 235 | G0235 (G0236) | string set {'backlog', 'canceled', 'completed', 'duplicate', 'started', 'unstarted'} as ternary-chain/table-keys/switch/array [SEGMENT_RANK, m, SEG] | 3/5/11 | unchanged | carried-by-key | — | real | `lib/providers/state-map.js` `getStateDisplay`/`getStateOrder` |  |
| 236 | G0236 (G0272) | string set {'backlog', 'unstarted'} as array/or-chain [stateTypes, ID.state.type] | 3/3/3 | unchanged | carried-by-key | — | real | Ready set is queue-config stateTypes, re-inlined in recommendation-facts.js:201 and workspace-api-mocks.js:68. The isReadyState helper from 10-23 is gone; queue-config is the home. |  |
| 238 | G0238 (G0245) | string set {'backlog', 'started', 'unstarted'} as switch/array/table-keys [eligibleStates, STATUS_RANK] | 3/4/4 | unchanged | carried-by-key | — | borderline | `lib/providers/state-map.js` (`isTerminalState`, `getStateOrder`) — state rank sets; covered by state-type-label-rank-maps |  |
| 243 | G0243 (G0290) | text contract marker: [close-out-merges] | 3/3/3 | unchanged | carried-by-key | — | noise | Log-prefix literal repeated in two route catches while lib/close-out-merges.js keeps its own LOG; inert console tag, no consumer or test depends on it. |  |
| 246 | G0246 (G0244) | repeated comparison outcome == 'self-resolved' | 3/4/7 | unchanged | carried-by-key | — | noise | Machine-stamped outcome with one producer (ticket-close-closer.js); readers apply the same bucket. Not a duplicated decision. |  |
| 269 | G0269 (G0271) | named constant UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i | 3/3/3 | unchanged | carried-by-key | — | noise | (`lib/workspace.js` `UUID_REGEX` exists) |  |
| 274 | G0274 (G0273) | near-duplicate function find() (also: componentFind), ~9 statements, fuzzy | 3/4/4 | unchanged | carried-by-key | — | noise | union-find helper, generic |  |
| 285 | G0285 (G0291) | tiny rule copied as a helper (anonymous)() (also: loadLoops), 3 copies of 1-4 statements | 3/3/3 | unchanged | carried-by-key | — | borderline | The 13 calls already route through getLoopsForWorkspace; the duplicated part is the deps bundle plus lean:true in three fan-outs. Low-value consolidation. |  |
| 307 | G0307 (G0305) | repeated comparison kind == 'evidence' | 3/3/3 | unchanged | carried-by-key | — | noise | feedback kind literal |  |
| 317 | G0317 (G0316) | repeated comparison harness == 'opencode' | 3/4/4 | unchanged | carried-by-key | — | noise | Four opencode checks are separate rules (option list, web-target refusal, model-id shape, running-total usage) that share a literal. |  |
| 345 | G0345 (G0353) | repeated comparison verdict == 'credential_dead' | 3/3/3 | unchanged | carried-by-key | — | real | Server sites use exported CREDENTIAL_DEAD_VERDICT, but public/proxy.js:256 hardcodes 'credential_dead'. A rename would silently empty the browser filter. Home: lib/credential-state.js. |  |
| 380 | G0380 (G0382) | repeated comparison setting == 'halt' | 3/3/4 | unchanged | carried-by-key | — | real | Owner-only halt undo gate repeats at render-settings-workspace:49 and :215 while the route enforces it via haltRefusal; one predicate in workspace-change-log.js would own it. Home: lib/workspace-change-log.js. |  |
| 382 | G0382 (G0391) | string set {'Deep Dive', 'Front Page', 'The Column', 'The Wire', 'Weather'} as array [VALID_SECTIONS, DESK_ORDER, DESKS] | 3/4/4 | unchanged | carried-by-key | — | real | `lib/ship-biscuit.js` `DESKS` (exported) |  |
| 389 | G0389 (G0426) | named constant MS_PER_DAY=86400000 | 3/3/3 | unchanged | carried-by-key | — | noise | `MS_PER_DAY` constant, inert |  |
| 398 | G0398 (G0390) | tiny rule copied as a helper constructor(), 5 copies of 1-4 statements | 3/5/5 | unchanged | carried-by-key | — | noise | Five cache and store constructors with different option sets and no shared base; a constructor signature is not a rule. |  |
| 405 | G0405 (G0396) | near-duplicate function stableStringify(), ~7 statements, same vocabulary (dialect copy or close variant) | 3/3/3 | unchanged | carried-by-key | — | real | one export of `stableStringify` in `lib/recap-cache.js` or a leaf module (LIN-3736 already proposes `lib/utils/`); 3 copies: `recap-cache.js:27`, `run-summary-cache.js:32`, `account-erasure.js:235` |  |
| 419 | G0419 (G0414) | string set {'no-owner', 'not-owner', 'owner', 'unavailable'} as array/switch/or-chain/if-chain | 3/3/4 | unchanged | carried-by-key | — | real | owner/not-owner/no-owner/unavailable validated in workspace-owner, exported as RUNNER_SETUP_STATES in render-runner-setup, and re-mapped by an if-chain in routes/runner-setup.js:70. Home: lib/workspace-owner.js. |  |
| 432 | G0432 (G0446) | tiny rule copied as a helper cleanup(), 3 copies of 1-4 statements | 3/3/3 | unchanged | carried-by-key | — | noise | `cleanup()` per store |  |
| 494 | G0494 (G0495) | tiny rule copied as a helper stableById() (also: byWorkspaceId), 3 copies of 1-4 statements | 3/3/3 | unchanged | carried-by-key | — | noise | sort comparators |  |
| 526 | G0526 (G0526) | repeated comparison stateType == 'backlog' | 3/3/3 | unchanged | carried-by-key | — | borderline | keepCard backlog rule is copied into public/ship.js:166 from lib/ship-layout.js:353; ship.js header says the inlining is deliberate (no build step). Drift risk only. |  |
| 538 | G0538 (G0536) | string set {'E', 'N', 'NE', 'NW', 'S', 'SE', +2} as array/table-keys [ORIENTATION_BEARINGS, BEARING_TO_ANGLE, BEARINGS] | 3/3/5 | unchanged | carried-by-key | — | noise | (`lib/ship-layout.js` `BEARINGS` exists) |  |


## Census table groups (317; no ruling, per the method)

| rank | id | detector | decision | a/f/s | status |
|---|---|---|---|---|---|
| 26 | G0026 | record | literal record repeated verbatim {Cache-Control="no-cache", Connection="keep-alive", Content-Type="text/event-stream"} | 2/5/7 | unchanged |
| 27 | G0027 | set+discrim | string set {'aborted', 'done', 'failed', 'skipped'} as array/Set/or-chain/table-keys/if-chain [LOOP_TERMINAL_MARKERS, MARKER_TO_AGENT_STATE, TERMINAL_MARKER_TO_STATUS] | 2/8/10 | unchanged |
| 29 | G0029 | cmp | repeated comparison status == 'queued' | 2/5/6 | unchanged |
| 33 | G0033 | cmp | repeated comparison marker == 'pending' | 1/5/11 | unchanged |
| 43 | G0043 | contract | text contract heading: what ci did not prove | 2/5/8 | unchanged |
| 44 | G0044 | clone | tiny rule copied as a helper clear(), 5 copies of 1-4 statements | 2/5/5 | unchanged |
| 48 | G0048 | cmp | repeated comparison disposition == 'resumable' | 2/4/8 | unchanged |
| 49 | G0049 | record | record assembled from the same sources {id=ID.id, title=ID.title, labels=LogicalExpression.map()} | 2/3/3 | unchanged |
| 53 | G0053 | contract | text contract marker: [db-indexes] | 2/2/9 | unchanged |
| 54 | G0054 | clone | near-duplicate function clear() (also: clearHistory), ~7 statements, fuzzy | 1/4/4 | unchanged |
| 55 | G0055 | cmp | repeated comparison state == 'record' | 2/3/3 | unchanged |
| 56 | G0056 | contract | text contract marker: [dispatch] | 2/3/4 | unchanged |
| 57 | G0057 | cmp | repeated comparison provider == 'github' | 2/2/3 | unchanged |
| 58 | G0058 | cmp | repeated comparison provider == 'github-projects' | 2/2/2 | unchanged |
| 60 | G0060 | record | literal record repeated verbatim {effort=null, harness=null, model=null} | 2/2/2 | unchanged |
| 61 | G0061 | const | named constant TOKEN_REFRESH_BUFFER_MS=300000 | 2/2/2 | unchanged |
| 62 | G0062 | cmp | repeated comparison rawTeam == 'all' | 2/2/2 | unchanged |
| 63 | G0063 | set | string set {'LINEAR_CLIENT_ID', 'LINEAR_CLIENT_SECRET', 'LINEAR_REDIRECT_URI'} as array [OAUTH_ENV_VARS, oauthEnvVars] | 2/2/2 | unchanged |
| 64 | G0064 | cmp | repeated comparison getAttribute() == 'true' | 1/4/7 | unchanged |
| 65 | G0065 | contract | text contract marker: [ci-wake-sweep] | 2/2/5 | unchanged |
| 66 | G0066 | contract | text contract marker: [liveness-alarm-sweep] | 2/2/2 | unchanged |
| 67 | G0067 | cmp | repeated comparison kind == 'more-of-parent' | 2/2/3 | unchanged |
| 68 | G0068 | cmp | repeated comparison kind == 'search' | 2/2/2 | unchanged |
| 69 | G0069 | record | record assembled from the same sources {urlKey=ID.urlKey, workspaceId=ID.id, accountId=ID.session.accountId} | 2/2/2 | unchanged |
| 70 | G0070 | cmp | repeated comparison kind == 'capture' | 2/2/2 | unchanged |
| 71 | G0071 | cmp | repeated comparison urlKey == 'test-workspace' | 2/2/6 | unchanged |
| 72 | G0072 | record | record assembled from the same sources {githubEnabled=getProvider().entryCta.isConfigured(), jiraEnabled=getProvider().entryCta.isConfigured(), emailEnabled=isEmailSignInAvailable(), freeTierEnabled=isFreeTierOffered()} | 2/2/2 | unchanged |
| 73 | G0073 | cmp | repeated comparison via == 'proxy' | 2/2/3 | unchanged |
| 74 | G0074 | cmp | repeated comparison finishReason == 'length' | 2/5/7 | unchanged |
| 77 | G0077 | cmp | repeated comparison target == 'web' | 2/4/5 | unchanged |
| 78 | G0078 | const | named constant CONTEXT_FETCH_TIMEOUT_MS=45000 | 2/2/2 | unchanged |
| 80 | G0080 | set+discrim | string set {'github', 'github-projects'} as Set/array/or-chain [REMINT_KINDS, INSTALLATION_KEYED_PROVIDERS, ID.provider] | 2/6/6 | unchanged |
| 81 | G0081 | cmp | repeated comparison subscription == 'none' | 1/3/3 | unchanged |
| 82 | G0082 | contract | text contract marker: [aborted] | 2/3/9 | unchanged |
| 84 | G0084 | clone | tiny rule copied as a helper bump() (also: touchAndEvict, noteCredential), 3 copies of 1-4 statements | 2/3/3 | unchanged |
| 85 | G0085 | cmp | repeated comparison source == 'free' | 2/3/3 | unchanged |
| 86 | G0086 | const | named constant DANGEROUS_CHARS_REGEX=/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/ | 2/4/4 | unchanged |
| 87 | G0087 | const | named constant MAX_NAME_LENGTH=1000 | 2/4/4 | unchanged |
| 88 | G0088 | cmp | repeated comparison kind == 'decision' | 1/4/6 | unchanged |
| 94 | G0094 | cmp | repeated comparison mode == 'add-source' | 2/6/28 | unchanged |
| 95 | G0095 | clone | tiny rule copied as a helper onEvent() (also: (anonymous)), 5 copies of 1-4 statements | 2/4/5 | unchanged |
| 96 | G0096 | clone | tiny rule copied as a helper buildPromptFilename(), 3 copies of 1-4 statements | 2/3/3 | unchanged |
| 99 | G0099 | clone | near-duplicate function (anonymous)() (also: relayDispatchRefusal), ~10 statements, same vocabulary (dialect copy or close variant) | 2/2/2 | unchanged |
| 102 | G0102 | clone | tiny rule copied as a helper (anonymous)(), 3 copies of 1-4 statements | 2/3/3 | unchanged |
| 103 | G0103 | cmp | repeated comparison toLowerCase() == 'bug' | 2/3/3 | unchanged |
| 106 | G0106 | contract | text contract heading: workflow | 1/3/15 | unchanged |
| 107 | G0107 | clone | near-duplicate function clear(), ~7 statements, structurally identical | 2/8/8 | unchanged |
| 108 | G0108 | cmp | repeated comparison phase == 'proposed' | 2/4/5 | unchanged |
| 109 | G0109 | clone | tiny rule copied as a helper (anonymous)(), 5 copies of 1-4 statements | 1/3/5 | unchanged |
| 110 | G0110 | discrim | string set {'1', 'true'} as or-chain [ID.query.cachedOnly, ID.query.noDescend, ID.query.diff] | 2/3/6 | unchanged |
| 113 | G0113 | cmp | repeated comparison kind == 'close-out' | 2/4/4 | unchanged |
| 114 | G0114 | cmp | repeated comparison kind == 'periodical' | 2/3/3 | unchanged |
| 115 | G0115 | cmp | repeated comparison name == 'list_pending_decisions' | 2/3/3 | unchanged |
| 118 | G0118 | cmp | repeated comparison state == 'closed' | 2/5/5 | unchanged |
| 120 | G0120 | set+discrim | string set {'done', 'failed'} as or-chain/table-keys [ID.terminalStatus, PILL_GLYPHS] | 2/3/3 | unchanged |
| 122 | G0122 | cmp | repeated comparison tagName == 'SELECT' | 1/3/3 | unchanged |
| 124 | G0124 | clone | tiny rule copied as a helper enqueueGuard() (also: haltRefusal), 3 copies of 1-4 statements | 1/3/3 | unchanged |
| 125 | G0125 | cmp | repeated comparison kind == 'recap' | 2/2/3 | unchanged |
| 126 | G0126 | cmp | repeated comparison id == '__periodicals__' | 2/4/5 | unchanged |
| 129 | G0129 | cmp | repeated comparison value == 'true' | 2/3/3 | unchanged |
| 132 | G0132 | cmp | repeated comparison section == 'prompt' | 2/2/2 | unchanged |
| 133 | G0133 | cmp | repeated comparison section == 'reasoning' | 2/2/2 | unchanged |
| 134 | G0134 | contract | text contract marker: [pending] | 2/2/4 | unchanged |
| 135 | G0135 | record | record assembled from the same sources {urlKey=ID.urlKey, identifier=ID.identifier, source=ID.source} | 1/3/3 | unchanged |
| 136 | G0136 | clone | tiny rule copied as a helper header() (also: setupNoticeHtml), 3 copies of 1-4 statements | 1/3/3 | unchanged |
| 139 | G0139 | set | string set {'backlog', 'done', 'failed', 'in-progress', 'todo'} as table-keys [STATE_GLYPHS, STATUS_PILL_GLYPHS] | 2/3/3 | unchanged |
| 140 | G0140 | cmp | repeated comparison section == 'recent-activity' | 2/3/5 | unchanged |
| 141 | G0141 | cmp | repeated comparison agentState == 'queued' | 2/3/4 | unchanged |
| 148 | G0148 | cmp | repeated comparison kind == 'bootstrap' | 2/3/9 | unchanged |
| 149 | G0149 | record | record assembled from the same sources {urlKey=ID.urlKey, workspaceId=ID.id, ownerAccountId=ID.session.accountId} | 2/3/3 | unchanged |
| 152 | G0152 | const | named constant HOUR_MS=3600000 | 2/4/4 | unchanged |
| 160 | G0160 | cmp | repeated comparison phase == 'error' | 2/3/3 | unchanged |
| 161 | G0161 | set+discrim | string set {'complete', 'error'} as Set/or-chain [LOOP_TERMINAL_AGENT_STATES, TERMINAL_AGENT_STATES, ID.agentState] | 2/3/4 | unchanged |
| 166 | G0166 | const | named constant COMPANION_INSTANCE_PREFIX="companion:v1:" | 2/3/3 | unchanged |
| 167 | G0167 | clone | tiny rule copied as a helper msSince() (also: (anonymous)), 3 copies of 1-4 statements | 2/3/3 | unchanged |
| 168 | G0168 | cmp | repeated comparison protocol == 'https:' | 2/2/2 | unchanged |
| 170 | G0170 | clone | tiny rule copied as a helper (anonymous)(), 5 copies of 1-4 statements | 1/3/5 | unchanged |
| 174 | G0174 | record | record assembled from the same sources {runs=ID.runs, priced=ID.priced, unpriced=ID.unpriced, noTelemetry=ID.noTelemetry, spendUsd=ID.spendUsd, +1} | 2/2/2 | unchanged |
| 177 | G0177 | set+discrim | string set {'http:', 'https:'} as array/or-chain [[...].includes, ID.protocol] | 2/4/4 | unchanged |
| 178 | G0178 | clone | tiny rule copied as a helper constructor(), 6 copies of 1-4 statements | 2/6/6 | unchanged |
| 179 | G0179 | const | named constant POLL_MS=5000 | 1/3/3 | unchanged |
| 180 | G0180 | cmp | repeated comparison kind == 'brief' | 2/3/4 | unchanged |
| 182 | G0182 | clone | tiny rule copied as a helper (anonymous)(), 6 copies of 1-4 statements | 1/4/6 | unchanged |
| 183 | G0183 | clone | tiny rule copied as a helper ui(), 4 copies of 1-4 statements | 1/4/4 | unchanged |
| 184 | G0184 | record | record assembled from the same sources {urlKey=ID.proxyUrlKey, createdBy=ID.proxyCreatedBy, clientSignal=ID.signal} | 2/2/2 | unchanged |
| 185 | G0185 | cmp | repeated comparison code == 'OUTPUT_TRUNCATED' | 2/3/3 | unchanged |
| 186 | G0186 | cmp | repeated comparison status == 'aborted' | 1/3/11 | unchanged |
| 187 | G0187 | cmp | repeated comparison turnKind == 'boot' | 2/3/18 | unchanged |
| 188 | G0188 | contract | text contract marker: [working] | 2/3/3 | unchanged |
| 189 | G0189 | cmp | repeated comparison source == 'live' | 1/3/4 | unchanged |
| 191 | G0191 | clone | near-duplicate function groupLoopsByLineage() (also: runsByLineage), ~10 statements, structurally identical | 2/2/2 | unchanged |
| 192 | G0192 | cmp | repeated comparison state == 'unknown' | 2/3/5 | unchanged |
| 195 | G0195 | cmp | repeated comparison disposition == 'gone' | 2/2/5 | unchanged |
| 196 | G0196 | clone | near-duplicate function relativeTime() (also: renderDeployInfo), ~22 statements, same vocabulary (dialect copy or close variant) | 2/2/2 | unchanged |
| 197 | G0197 | cmp | repeated comparison kind == 'decision-answer' | 2/3/3 | grown |
| 199 | G0199 | record | literal record repeated verbatim {label="__ai__", name=null, why="Generate the next prompt for this task"} | 2/2/2 | unchanged |
| 200 | G0200 | clone | near-duplicate function firstPromptLine() (also: toStackHeadline), ~6 statements, same vocabulary (dialect copy or close variant) | 2/2/2 | unchanged |
| 201 | G0201 | cmp | repeated comparison rung == 'run-task' | 2/2/2 | unchanged |
| 202 | G0202 | set | string set {'done', 'next-step', 'pr'} as array | 2/2/2 | unchanged |
| 203 | G0203 | discrim | string set {'done', 'pr'} as or-chain [ID.filledRung, ID()] | 2/2/3 | unchanged |
| 204 | G0204 | set | string set {'canceled', 'completed', 'duplicate'} as array [TERMINAL_TYPES] | 2/2/2 | unchanged |
| 206 | G0206 | clone | tiny rule copied as a helper (anonymous)(), 3 copies of 1-4 statements | 1/3/3 | unchanged |
| 208 | G0208 | clone | near-duplicate function computeFitZoom(), ~11 statements, same vocabulary (dialect copy or close variant) | 2/2/2 | unchanged |
| 212 | G0212 | clone | near-duplicate function (anonymous)(), ~7 statements, same vocabulary (dialect copy or close variant) | 2/2/2 | unchanged |
| 213 | G0213 | clone | near-duplicate function clampTimelineWindow() (also: clampWindow), ~12 statements, fuzzy | 2/2/2 | unchanged |
| 214 | G0214 | clone | near-duplicate function computeTimelineFit(), ~10 statements, same vocabulary (dialect copy or close variant) | 2/2/2 | unchanged |
| 215 | G0215 | clone | near-duplicate function computeTimelineZoom(), ~15 statements, same vocabulary (dialect copy or close variant) | 2/2/2 | unchanged |
| 216 | G0216 | clone | near-duplicate function renderChip(), ~8 statements, fuzzy | 2/2/2 | unchanged |
| 217 | G0217 | clone | near-duplicate function renderSegmentBar(), ~17 statements, fuzzy | 2/2/2 | unchanged |
| 218 | G0218 | clone | near-duplicate function renderStatusPill(), ~18 statements, fuzzy | 2/2/2 | unchanged |
| 219 | G0219 | clone | near-duplicate function renderSurface(), ~11 statements, fuzzy | 2/2/2 | unchanged |
| 220 | G0220 | clone | near-duplicate function renderTag(), ~11 statements, fuzzy | 2/2/2 | unchanged |
| 221 | G0221 | record | record assembled from the same sources {remaining=ID.remaining, limit=ID.limit} | 2/2/3 | unchanged |
| 223 | G0223 | clone | tiny rule copied as a helper (anonymous)(), 4 copies of 1-4 statements | 2/3/4 | unchanged |
| 224 | G0224 | cmp | repeated comparison status == 'skipped' | 2/3/3 | unchanged |
| 225 | G0225 | discrim | string set {'closed', 'multiple-prs', 'no-pr', 'not-ready'} as or-chain [ID.status] | 2/3/3 | unchanged |
| 226 | G0226 | clone | tiny rule copied as a helper buildBriefMessages() (also: buildRoadmapGapMessages, buildRoadmapProductMessages, buildEditorMessages, buildRecapMessages), 8 copies of 1-4 statements | 2/8/8 | unchanged |
| 228 | G0228 | cmp | repeated comparison mergedBy == 'close-out' | 2/2/2 | unchanged |
| 230 | G0230 | contract | text contract marker: [usage] | 1/3/4 | unchanged |
| 231 | G0231 | const | named constant MAX_IDENTIFIER_LENGTH=100 | 2/2/2 | unchanged |
| 232 | G0232 | cmp | repeated comparison readyState == 'loading' | 1/3/3 | shrunk |
| 233 | G0233 | cmp | repeated comparison state == 'open' | 2/4/5 | shrunk |
| 239 | G0239 | cmp | repeated comparison status == 'priced' | 2/2/3 | unchanged |
| 240 | G0240 | cmp | repeated comparison status == 'proposed' | 2/2/2 | unchanged |
| 241 | G0241 | set | string set {'cdn.linear.app', 'linear.app', 'uploads.linear.app'} as Set [LINEAR_IMAGE_HOSTS, allowedHosts] | 2/2/2 | unchanged |
| 242 | G0242 | set+discrim | string set {'home-up-next', 'in-progress', 'project', 'recent-activity'} as or-chain/array [KNOWN_SECTIONS] | 2/2/2 | unchanged |
| 244 | G0244 | cmp | repeated comparison reason == 'free-tier' | 2/2/3 | unchanged |
| 245 | G0245 | discrim | string set {'comment', 'description'} as ternary-chain/or-chain [ID.where] | 2/2/2 | unchanged |
| 247 | G0247 | discrim | string set {'answered', 'dismissed'} as or-chain [ID.outcome] | 2/4/7 | unchanged |
| 248 | G0248 | cmp | repeated comparison built == 'unknown' | 2/2/2 | unchanged |
| 249 | G0249 | cmp | repeated comparison format == 'md' | 2/2/2 | unchanged |
| 250 | G0250 | cmp | repeated comparison tierOf() == 'deferred' | 2/2/3 | unchanged |
| 251 | G0251 | set | string set {'High', 'Low', 'Medium', 'No priority', 'Urgent'} as array [PRIORITY_NAMES, PRIORITY_OPTION_LABELS] | 2/2/2 | unchanged |
| 252 | G0252 | const | named constant ARCHIVE_PAGE_SIZE=30 | 2/2/2 | unchanged |
| 253 | G0253 | const | named constant STALE_AFTER_MS=86400000 | 2/2/2 | unchanged |
| 254 | G0254 | clone | near-duplicate function (anonymous)(), ~6 statements, fuzzy | 2/2/2 | unchanged |
| 255 | G0255 | cmp | repeated comparison by == 'close-out' | 2/2/2 | unchanged |
| 256 | G0256 | cmp | repeated comparison pageMode == 'backlog' | 2/2/2 | unchanged |
| 257 | G0257 | cmp | repeated comparison view == 'sessions' | 2/2/2 | unchanged |
| 259 | G0259 | cmp | repeated comparison openRouterSource == 'free' | 2/3/3 | unchanged |
| 260 | G0260 | record | record assembled from the same sources {promptMeta=ID.promptMeta, defaultPromptKeys=ID.defaultPromptKeys, morePromptKeys=ID.morePromptKeys, customPrompts=ID.customPrompts, hasAI=ID.hasAI, +5} | 2/2/2 | unchanged |
| 261 | G0261 | cmp | repeated comparison singleUse == 'true' | 2/2/2 | unchanged |
| 262 | G0262 | clone | tiny rule copied as a helper countFor() (also: lookupsFor), 3 copies of 1-4 statements | 2/3/3 | unchanged |
| 263 | G0263 | cmp | repeated comparison view == 'digest' | 2/2/2 | unchanged |
| 266 | G0266 | record | literal record repeated verbatim {lastCensusSnapshot=null, lastCensusStateHash=null, lastTurnAt=null, notes="", reservationId=null, turnReservedUntil=n...} | 2/2/2 | unchanged |
| 267 | G0267 | cmp | repeated comparison turnKind == 'auto-wake' | 2/2/5 | unchanged |
| 275 | G0275 | clone | tiny rule copied as a helper isId() (also: shortString, (anonymous), isSafeSingleQuotedLiteral, isSafeDoubleQuotedLiteral), 6 copies of 1-4 statements | 1/4/6 | unchanged |
| 279 | G0279 | cmp | repeated comparison viewer == 'owner' | 2/2/3 | unchanged |
| 280 | G0280 | cmp | repeated comparison verdict == 'approve' | 1/3/3 | unchanged |
| 281 | G0281 | record | literal record repeated verbatim {effort="none", harness="none", model="none"} | 2/2/2 | unchanged |
| 282 | G0282 | cmp | repeated comparison category == 'upstream' | 2/2/2 | unchanged |
| 283 | G0283 | discrim | string set {'gone', 'resumable', 'task-bound'} as or-chain | 2/2/2 | unchanged |
| 284 | G0284 | clone | near-duplicate function constructor(), ~5 statements, fuzzy | 1/3/3 | unchanged |
| 287 | G0287 | cmp | repeated comparison state == 'none' | 2/2/2 | unchanged |
| 288 | G0288 | clone | near-duplicate function deleteByConnection() (also: deleteUserPreferences, deleteWorkspacePreferences), ~8 statements, structurally identical | 1/3/3 | unchanged |
| 289 | G0289 | cmp | repeated comparison state == 'dead' | 2/2/3 | unchanged |
| 292 | G0292 | cmp | repeated comparison tier == 'not reported' | 2/2/2 | unchanged |
| 295 | G0295 | clone | near-duplicate function listForWorkspaces() (also: listUnansweredForWorkspaces), ~7 statements, fuzzy | 1/3/3 | unchanged |
| 296 | G0296 | cmp | repeated comparison deriveTerminalStatus() == 'done' | 1/3/3 | unchanged |
| 297 | G0297 | cmp | repeated comparison outcome == 'dismissed' | 2/3/4 | unchanged |
| 300 | G0300 | cmp | repeated comparison kind == 'decision-withdrawal-reversed' | 2/2/2 | new |
| 308 | G0308 | cmp | repeated comparison mode == 'new' | 1/3/5 | unchanged |
| 309 | G0309 | contract | text contract marker: [as-asked] | 2/2/10 | unchanged |
| 310 | G0310 | cmp | repeated comparison status == 'fulfilled' | 2/4/6 | unchanged |
| 312 | G0312 | cmp | repeated comparison kind == 'backlog' | 2/2/2 | unchanged |
| 314 | G0314 | clone | near-duplicate function cleanup(), ~8 statements, fuzzy | 1/3/3 | unchanged |
| 315 | G0315 | set | string set {'blocked', 'queued', 'resolved', 'silent', 'terminal', 'unknown', +1} as array [CENSUS_LANE_KEYS, LANE_KEYS] | 2/3/3 | unchanged |
| 316 | G0316 | clone | tiny rule copied as a helper resolveCanonicalDegraded() (also: resolveCanonicalOrMiss, canonical), 3 copies of 1-4 statements | 1/3/3 | unchanged |
| 327 | G0327 | cmp | repeated comparison state == 'reached' | 2/2/2 | unchanged |
| 329 | G0329 | set | string set {'acting', 'deciding', 'orienting', 'reporting', 'watching'} as array [PROXY_PHASES, PHASE_NAMES] | 2/2/2 | unchanged |
| 330 | G0330 | set | string set {'dispatch', 'record', 'resume'} as Set/table-keys [ON_ANSWER_EFFECTS, EFFECT_CAPTIONS] | 2/2/2 | unchanged |
| 334 | G0334 | discrim | string set {'indeterminate', 'mid-turn'} as or-chain [ID.disposition] | 2/2/2 | unchanged |
| 337 | G0337 | set | string set {'fable', 'haiku', 'opus', 'sonnet'} as array [CLAUDE_MAPPABLE_MODEL_FAMILIES] | 2/2/3 | unchanged |
| 338 | G0338 | contract | text contract heading: adversarial second-read | 2/2/2 | unchanged |
| 339 | G0339 | clone | near-duplicate function get(), ~7 statements, fuzzy | 2/6/6 | unchanged |
| 340 | G0340 | record | literal record repeated verbatim {_id=0, createdAt=1, createdBy=1, urlKey=1, workspaceId=1} | 2/2/2 | unchanged |
| 342 | G0342 | cmp | repeated comparison haltMode == 'pause' | 2/2/2 | unchanged |
| 343 | G0343 | cmp | repeated comparison haltMode == 'stop' | 2/2/2 | unchanged |
| 348 | G0348 | cmp | repeated comparison kind == 'review' | 2/2/2 | unchanged |
| 349 | G0349 | cmp | repeated comparison name == 'linear' | 2/2/2 | shrunk |
| 350 | G0350 | cmp | repeated comparison name == 'send_follow_up' | 2/2/3 | unchanged |
| 353 | G0353 | cmp | repeated comparison role == 'owner' | 2/3/4 | unchanged |
| 355 | G0355 | cmp | repeated comparison variant == 'standard' | 2/2/2 | unchanged |
| 356 | G0356 | cmp | repeated comparison kind == 'plan' | 2/3/3 | unchanged |
| 357 | G0357 | cmp | repeated comparison role == 'user' | 2/3/6 | unchanged |
| 358 | G0358 | cmp | repeated comparison type == 'heading' | 2/3/3 | grown |
| 360 | G0360 | cmp | repeated comparison kind == 'blind-read' | 2/2/2 | unchanged |
| 362 | G0362 | clone | tiny rule copied as a helper clampText(), 3 copies of 1-4 statements | 2/3/3 | unchanged |
| 364 | G0364 | const | named constant MAX_REASON_LENGTH=500 | 2/2/2 | unchanged |
| 370 | G0370 | contract | text contract heading: workspace api access (auto-appended) | 2/2/2 | unchanged |
| 371 | G0371 | const | named constant DAY_MS=86400000 | 2/2/2 | unchanged |
| 374 | G0374 | cmp | repeated comparison message == 'reverseOutcome: row is not self-resolved' | 2/2/2 | unchanged |
| 377 | G0377 | set | string set {'inside', 'outside', 'total', 'unknown'} as array/table-keys [[...].every, SCOPE_MARK] | 2/2/2 | unchanged |
| 378 | G0378 | clone | near-duplicate function _pruneToCapacity(), ~6 statements, fuzzy | 2/5/5 | unchanged |
| 379 | G0379 | cmp | repeated comparison kind == 'leftover' | 1/3/3 | unchanged |
| 381 | G0381 | set | string set {'/common-actions.css', '/escalation-kpis.css', '/style.css'} as array [stylesheets] | 1/3/3 | unchanged |
| 386 | G0386 | cmp | repeated comparison code == 'ERR_FR_TOO_MANY_REDIRECTS' | 2/2/2 | unchanged |
| 388 | G0388 | cmp | repeated comparison message == 'unexpected redirect' | 2/2/2 | unchanged |
| 390 | G0390 | cmp | repeated comparison completeness == 'complete' | 1/3/7 | unchanged |
| 392 | G0392 | const | named constant LANE_KEYS=[blocked,queued,resolved,silent,terminal,unknown,working] | 2/2/2 | unchanged |
| 394 | G0394 | clone | near-duplicate function peakToolCount() (also: toolPeakOf), ~9 statements, fuzzy | 2/2/2 | unchanged |
| 395 | G0395 | set | string set {'autopilot', 'save', 'triage'} as table-keys/Set [SENDING_STATUS, DONE_SUFFIX, FEEDBACK_ACTIONS] | 2/2/3 | unchanged |
| 396 | G0396 | contract | text contract marker: [credential-adopted] | 2/2/3 | unchanged |
| 397 | G0397 | clone | near-duplicate function generateBrief() (also: generateFeedbackTitle, generateRecap, generateRunSummary, generateSessionSummary), ~7 statements, fuzzy | 2/5/5 | unchanged |
| 399 | G0399 | clone | near-duplicate function listEvents() (also: listTraces), ~9 statements, fuzzy | 2/2/2 | unchanged |
| 400 | G0400 | record | record assembled from the same sources {urlKey=ID.urlKey, prUrl=ID.prUrl, headSha=ID.headSha, by=ID.by} | 2/2/3 | unchanged |
| 403 | G0403 | cmp | repeated comparison stage == 'blind-read' | 2/2/2 | unchanged |
| 407 | G0407 | cmp | repeated comparison s == 'complete' | 2/2/2 | unchanged |
| 409 | G0409 | record | literal record repeated verbatim {_id=0, createdAt=1, createdBy=1, urlKey=1} | 2/2/2 | unchanged |
| 414 | G0414 | set+discrim | string set {'dark', 'light'} as array/or-chain [VALID_THEMES, ID.session.theme] | 2/2/2 | unchanged |
| 415 | G0415 | cmp | repeated comparison trim() == '---' | 1/5/5 | unchanged |
| 416 | G0416 | const | named constant TIMELINE_WINDOW_MS=86400000 | 2/2/2 | unchanged |
| 420 | G0420 | clone | tiny rule copied as a helper getAccount() (also: getById, getWorkspace, getWorkspaceByUrlKey), 4 copies of 1-4 statements | 2/3/4 | unchanged |
| 421 | G0421 | const | named constant DEFAULT_HUMAN_NICK="John" | 2/2/2 | unchanged |
| 422 | G0422 | cmp | repeated comparison type == 'backlog' | 2/2/3 | unchanged |
| 423 | G0423 | set | string set {'first go', 'firstGo'} as array | 2/2/2 | unchanged |
| 424 | G0424 | set | string set {'login', 'signed up'} as array | 2/2/2 | unchanged |
| 425 | G0425 | set | string set {'merge clicked', 'mergeClicked'} as array | 2/2/2 | unchanged |
| 426 | G0426 | set | string set {'pr opened', 'prOpened'} as array | 2/2/2 | unchanged |
| 427 | G0427 | clone | near-duplicate function delete(), ~7 statements, fuzzy | 2/5/5 | unchanged |
| 428 | G0428 | clone | tiny rule copied as a helper get(), 5 copies of 1-4 statements | 2/5/5 | unchanged |
| 429 | G0429 | clone | near-duplicate function briefUrl() (also: recapUrl, scanUrl), ~6 statements, fuzzy | 1/3/3 | unchanged |
| 430 | G0430 | cmp | repeated comparison field == 'harness' | 2/3/3 | unchanged |
| 431 | G0431 | discrim | string set {'fresh', 'stale'} as if-chain [ID.status] | 1/3/4 | unchanged |
| 439 | G0439 | cmp | repeated comparison provider == 'email' | 2/2/2 | unchanged |
| 440 | G0440 | cmp | repeated comparison source == 'model' | 2/2/2 | unchanged |
| 441 | G0441 | cmp | repeated comparison source == 'workspace' | 2/2/2 | unchanged |
| 443 | G0443 | set+discrim | string set {'jira', 'linear'} as Set/or-chain [REFRESH_TOKEN_KINDS] | 2/2/2 | unchanged |
| 445 | G0445 | cmp | repeated comparison filter == 'set' | 2/2/2 | unchanged |
| 446 | G0446 | cmp | repeated comparison mode == 'resume' | 2/2/3 | unchanged |
| 449 | G0449 | clone | tiny rule copied as a helper (anonymous)(), 3 copies of 1-4 statements | 2/3/3 | unchanged |
| 450 | G0450 | clone | near-duplicate function formatFossilThreshold() (also: formatStaleThreshold), ~10 statements, structurally identical | 2/2/2 | unchanged |
| 452 | G0452 | clone | near-duplicate function list() (also: listByWorkspace), ~9 statements, fuzzy | 2/4/4 | unchanged |
| 453 | G0453 | contract | text contract marker: [string] | 2/3/4 | unchanged |
| 454 | G0454 | clone | tiny rule copied as a helper fetchBriefStatus() (also: fetchContext, fetchRecapStatus), 3 copies of 1-4 statements | 1/3/3 | unchanged |
| 455 | G0455 | record | record assembled from the same sources {id=ID._id, by=ID.by, prUrl=ID.prUrl, headSha=ID.headSha} | 2/2/2 | unchanged |
| 456 | G0456 | cmp | repeated comparison act == 'copy' | 2/2/3 | unchanged |
| 458 | G0458 | cmp | repeated comparison scope == 'job' | 2/2/3 | unchanged |
| 460 | G0460 | clone | near-duplicate function revokeByCreator() (also: revokeByOwner), ~9 statements, fuzzy | 2/2/2 | unchanged |
| 463 | G0463 | cmp | repeated comparison stateType == 'completed' | 2/3/3 | unchanged |
| 464 | G0464 | clone | tiny rule copied as a helper sweepStale() (also: sweep, pruneTombstones), 3 copies of 1-4 statements | 2/3/3 | unchanged |
| 465 | G0465 | clone | near-duplicate function get(), ~9 statements, structurally identical | 2/4/4 | unchanged |
| 466 | G0466 | clone | near-duplicate function orderByDependency(), ~59 statements, same vocabulary (dialect copy or close variant) | 2/4/4 | unchanged |
| 467 | G0467 | clone | tiny rule copied as a helper delete(), 4 copies of 1-4 statements | 2/4/4 | unchanged |
| 468 | G0468 | clone | tiny rule copied as a helper put(), 4 copies of 1-4 statements | 2/4/4 | unchanged |
| 469 | G0469 | clone | tiny rule copied as a helper put(), 4 copies of 1-4 statements | 2/4/4 | unchanged |
| 470 | G0470 | clone | near-duplicate function canonicalOf() (also: canonicalise), ~12 statements, structurally identical | 2/2/2 | unchanged |
| 471 | G0471 | record | record assembled from the same sources {id=ID.id, name=ID.name, key=ID.key} | 2/2/2 | new |
| 475 | G0475 | clone | near-duplicate function (anonymous)() (also: graphql, request), ~15 statements, same vocabulary (dialect copy or close variant) | 1/3/3 | unchanged |
| 476 | G0476 | clone | tiny rule copied as a helper (anonymous)() (also: isActive), 3 copies of 1-4 statements | 2/3/3 | unchanged |
| 477 | G0477 | clone | tiny rule copied as a helper _docsSorted() (also: _docsFor), 3 copies of 1-4 statements | 1/3/3 | unchanged |
| 481 | G0481 | cmp | repeated comparison scope == 'default' | 2/2/2 | unchanged |
| 482 | G0482 | set | string set {'preset-save', 'undo'} as array [[...].includes] | 2/2/3 | unchanged |
| 483 | G0483 | const | named constant DUPLICATE_KEY_CODE=11000 | 2/2/2 | unchanged |
| 484 | G0484 | const | named constant FORMER_MEMBER="former member" | 2/2/2 | unchanged |
| 485 | G0485 | clone | near-duplicate function clusterSiblingsInLane() (also: computeShipReachableIds, pullItemAndDescendants, promoteDependencyBlockers), ~33 statements, same vocabulary (dialect copy or close variant) | 2/3/7 | unchanged |
| 486 | G0486 | cmp | repeated comparison field == 'model' | 2/3/3 | unchanged |
| 487 | G0487 | clone | tiny rule copied as a helper createDashboardDrilldownRoutes() (also: createDashboardEffortRoutes, createDashboardKpisRoutes), 3 copies of 1-4 statements | 1/3/3 | unchanged |
| 488 | G0488 | clone | tiny rule copied as a helper union(), 3 copies of 1-4 statements | 2/3/3 | unchanged |
| 490 | G0490 | set | string set {'halt', 'modelRoutingProxyWrites', 'periodicals'} as table-keys/array [SETTING_NAME, SETTINGS] | 2/2/2 | unchanged |
| 491 | G0491 | set | string set {'none', 'pause', 'stop', 'unknown'} as table-keys [HALT_VALUE, HALT_WORDS] | 2/2/2 | unchanged |
| 492 | G0492 | clone | tiny rule copied as a helper deleteAll(), 4 copies of 1-4 statements | 2/4/4 | unchanged |
| 493 | G0493 | clone | near-duplicate function buildPassagePlannerKickoff() (also: buildPassageRunnerKickoff, buildWorkerLaneKickoff), ~11 statements, structurally identical | 1/3/3 | unchanged |
| 497 | G0497 | const | named constant PROJECTION_RISK_TYPES=Set[overdue,unestimated-critical,velocity-declining] | 2/2/2 | unchanged |
| 501 | G0501 | set | string set {'overdue', 'unestimated-critical', 'velocity-declining'} as Set [PROJECTION_RISK_TYPES] | 2/2/2 | unchanged |
| 502 | G0502 | contract | text contract marker: [credential-rejected] | 2/2/2 | unchanged |
| 503 | G0503 | const | named constant REPO_RE=/^[A-Za-z0-9._-]{1,100}$/ | 2/2/2 | unchanged |
| 504 | G0504 | clone | near-duplicate function assignLanes(), ~32 statements, same vocabulary (dialect copy or close variant) | 2/2/2 | unchanged |
| 505 | G0505 | clone | near-duplicate function assignSegments(), ~21 statements, same vocabulary (dialect copy or close variant) | 2/2/2 | unchanged |
| 506 | G0506 | clone | near-duplicate function buildChainLabel(), ~10 statements, same vocabulary (dialect copy or close variant) | 2/2/2 | unchanged |
| 507 | G0507 | clone | near-duplicate function cohereSubtaskGroups(), ~39 statements, same vocabulary (dialect copy or close variant) | 2/2/2 | unchanged |
| 508 | G0508 | clone | near-duplicate function computeCrossLaneColumns(), ~108 statements, same vocabulary (dialect copy or close variant) | 2/2/2 | unchanged |
| 509 | G0509 | clone | near-duplicate function groupByAssignee() (also: groupByProject), ~10 statements, same vocabulary (dialect copy or close variant) | 2/2/4 | unchanged |
| 510 | G0510 | clone | near-duplicate function groupByStatus(), ~12 statements, same vocabulary (dialect copy or close variant) | 2/2/2 | unchanged |
| 512 | G0512 | clone | near-duplicate function mergeLabels(), ~6 statements, fuzzy | 2/2/2 | unchanged |
| 513 | G0513 | clone | near-duplicate function mergeLanes(), ~9 statements, same vocabulary (dialect copy or close variant) | 2/2/2 | unchanged |
| 517 | G0517 | cmp | repeated comparison grouping == 'dependency' | 2/2/4 | unchanged |
| 518 | G0518 | cmp | repeated comparison op == 'updateIssue' | 2/2/2 | new |
| 519 | G0519 | cmp | repeated comparison rawKey == 'duplicate' | 2/2/2 | unchanged |
| 522 | G0522 | set | string set {'/library.css', '/style.css'} as array [stylesheets] | 2/2/2 | unchanged |
| 523 | G0523 | discrim | string set {'assignee', 'dependency', 'project', 'status'} as switch | 2/2/2 | unchanged |
| 524 | G0524 | discrim | string set {'dependency', 'project'} as or-chain | 2/2/2 | unchanged |
| 525 | G0525 | discrim | string set {'implicit', 'label', 'state'} as switch [ID.type] | 2/2/2 | unchanged |
| 527 | G0527 | cmp | repeated comparison tone == 'bad' | 1/3/3 | unchanged |
| 528 | G0528 | clone | tiny rule copied as a helper toRecord(), 3 copies of 1-4 statements | 2/3/3 | unchanged |
| 535 | G0535 | set | string set {'digest', 'gap', 'northStarReading', 'product', 'technical', 'trajectory'} as array/table-keys [NARRATIVE_LAYERS, collected, NARRATIVE_FIELD_TO_LAYER] | 2/2/5 | unchanged |
| 537 | G0537 | discrim | string set {'resumed', 'wake'} as or-chain [ID.role] | 2/2/2 | unchanged |
| 543 | G0543 | cmp | repeated comparison orientation == 'vertical' | 2/2/6 | unchanged |
| 547 | G0547 | set | string set {'orchestration', 'resumed', 'wake', 'work'} as table-keys/array [DISPATCH_ROLE_WORD] | 2/2/2 | unchanged |
| 548 | G0548 | record | literal record repeated verbatim {AFT="aft", DRIFT="drift", FORWARD="forward", PORT="port", SHIP="ship", STARBOARD="starboard"} | 2/2/2 | unchanged |
| 549 | G0549 | const | named constant MAX_CUSTOM_PRESETS=20 | 2/2/2 | unchanged |
| 550 | G0550 | const | named constant MAX_PRESET_NAME_LENGTH=50 | 2/2/2 | unchanged |
| 551 | G0551 | clone | near-duplicate function (anonymous)(), ~7 statements, fuzzy | 2/2/2 | unchanged |
| 552 | G0552 | clone | near-duplicate function bearingToAngle(), ~8 statements, structurally identical | 2/2/2 | unchanged |
| 553 | G0553 | clone | near-duplicate function buildSegments(), ~59 statements, same vocabulary (dialect copy or close variant) | 2/2/2 | unchanged |
| 554 | G0554 | clone | near-duplicate function cardMatchesHeading(), ~13 statements, same vocabulary (dialect copy or close variant) | 2/2/2 | unchanged |
| 555 | G0555 | clone | near-duplicate function clusterSubtaskSiblings(), ~35 statements, same vocabulary (dialect copy or close variant) | 2/2/2 | unchanged |
| 556 | G0556 | clone | near-duplicate function computePosition(), ~11 statements, fuzzy | 2/2/2 | unchanged |
| 557 | G0557 | clone | near-duplicate function hash32(), ~11 statements, fuzzy | 2/2/2 | unchanged |
| 558 | G0558 | clone | near-duplicate function layoutIndex(), ~30 statements, same vocabulary (dialect copy or close variant) | 2/2/2 | unchanged |
| 559 | G0559 | clone | near-duplicate function list(), ~7 statements, structurally identical | 2/2/2 | unchanged |
| 560 | G0560 | clone | near-duplicate function orientationLayout(), ~57 statements, same vocabulary (dialect copy or close variant) | 2/2/2 | unchanged |
| 561 | G0561 | clone | near-duplicate function pickAngle(), ~10 statements, fuzzy | 2/2/2 | unchanged |
| 562 | G0562 | clone | near-duplicate function placeDriftBucket(), ~22 statements, fuzzy | 2/2/2 | unchanged |
| 563 | G0563 | clone | near-duplicate function placeSegmentBucket(), ~44 statements, same vocabulary (dialect copy or close variant) | 2/2/2 | unchanged |
| 564 | G0564 | clone | near-duplicate function pushProjectSegments() (also: pushProjectSegs), ~8 statements, fuzzy | 2/2/2 | unchanged |
| 566 | G0566 | record | record assembled from the same sources {label=ID[].name, projectName=ID[].name, cards=ID[].group} | 2/2/2 | unchanged |
| 568 | G0568 | cmp | repeated comparison kind == 'label' | 2/2/3 | unchanged |
| 569 | G0569 | cmp | repeated comparison kind == 'project' | 2/2/3 | unchanged |
| 570 | G0570 | cmp | repeated comparison projectSector == 'port' | 2/2/2 | unchanged |
| 571 | G0571 | cmp | repeated comparison projectSector == 'starboard' | 2/2/2 | unchanged |
| 572 | G0572 | cmp | repeated comparison sector == 'drift' | 2/2/2 | unchanged |
| 573 | G0573 | cmp | repeated comparison sector == 'ship' | 2/2/2 | unchanged |
| 574 | G0574 | cmp | repeated comparison stateType == 'unstarted' | 2/2/2 | unchanged |
| 576 | G0576 | discrim | string set {'E', 'W'} as or-chain | 2/2/2 | unchanged |
| 577 | G0577 | record | record assembled from the same sources {access_token=ID.access_token, refresh_token=ID.refresh_token, expires_in=ID.expires_in} | 2/2/2 | unchanged |
| 578 | G0578 | cmp | repeated comparison error == 'invalid_grant' | 2/2/2 | unchanged |


## Compact trend ledger

All 167 rows under their stable names (`ledger-run8.tsv`; the next run compares mechanically).

| row | finding | severity | run-8 delta | noted in |
|---|---|---|---|---|
| 1 | `lib-import-cycles` | low-medium | unchanged (SCCs 6 + 6 with the same members at fb358dbda; 533 nodes, 2249 static edges; the stage-writes.js hit is a basename match on old citation text) | — |
| 2 | `provider-auth-router-upward-imports` | resolved | resolved (held; 0 upward lib->routes edges at fb358dbda) | — |
| 3 | `routes-error-envelope-fragmentation` | low-medium | unchanged (no cited file touched in e2d4659c4..fb358dbda) | — |
| 4 | `production-to-test-fixture-imports` | resolved | resolved (held; no cited file touched in the window) | — |
| 5 | `periodical-report-filename-convention-split` | medium-low | unchanged (no cited file touched in e2d4659c4..fb358dbda) | — |
| 6 | `dispatch-kind-vocabulary-cross-repo` | low | unchanged (touched: routes/dispatch.js; its hunks are the LIN-4468 mint stamp and NEVER_RAN; cited decision not in a hunk) | — |
| 7 | `provider-resolution-incantation` | low | unchanged (no cited file touched in e2d4659c4..fb358dbda) | — |
| 8 | `ui-divergences-registry-staleness` | low | unchanged (touched: public/common.js, a comment naming the classic twin LIN-4471 will retire; cited decision not in a hunk) | — |
| 9 | `simple-dispatcher-api-base-duplication` | low | unchanged (false hit: server.js matched by basename only) | — |
| 10 | `cross-repo-halt-vocabulary` | low-medium (sub-row) | unchanged (no cited file touched in e2d4659c4..fb358dbda) | — |
| 11 | `cross-repo-sentinel-decision-marker-vocabulary` | medium | unchanged (no cited file touched in e2d4659c4..fb358dbda) | — |
| 12 | `target-vocabulary` | low | unchanged (touched files: lib/dispatch-store.js, routes/dispatch.js, server.js; no hunk reaches the cited decision) | — |
| 13 | `sse-frame-writer-duplication` | resolved | resolved (held; no cited file touched in the window) | — |
| 14 | `routes-proxy-decomposition` | — | unchanged (no cited file touched in e2d4659c4..fb358dbda) | — |
| 15 | `cross-repo-repo-list` | low | unchanged (no cited file touched in e2d4659c4..fb358dbda) | — |
| 16 | `ci-convention-split-across-repos` | informational | unchanged (no cited file touched in e2d4659c4..fb358dbda) | — |
| 17 | `semicolon-style-split` | low | unchanged (touched: server.js; its hunks are isHermeticTestToken at three test-mode sites, the held-wake provisioner factory and the /lib/ serving comment; cited decision not in a hunk) | — |
| 18 | `client-escape-html-duplication` | — | unchanged (touched: public/common.js, a comment naming the classic twin LIN-4471 will retire; cited decision not in a hunk) | — |
| 19 | `client-shared-helper-duplication` | — | improved: the formatElapsed pair lost its public/task-page.js half (census G0264 gone; the task page imports fmtDuration from lib/time-words.js, LIN-4472); public/session.js keeps its copy, a front-end-browser Waiting entry | — |
| 20 | `client-section-fetch-idiom-duplication` | — | unchanged (no cited file touched in e2d4659c4..fb358dbda) | — |
| 21 | `linear-cli-parallel-graphql-surface` | — | unchanged (touched: server.js; its hunks are isHermeticTestToken at three test-mode sites, the held-wake provisioner factory and the /lib/ serving comment; cited decision not in a hunk) | — |
| 22 | `store-module-uniformity` | — | unchanged (no cited file touched in e2d4659c4..fb358dbda) | — |
| 23 | `server-side-escaping` | — | unchanged (touched files: lib/render.js, server.js; no hunk reaches the cited decision) | — |
| 24 | `dispatch-payload-centralization` | — | unchanged (touched files: public/common.js, public/prompt-section.js (a comment naming window.CostFormat), routes/dispatch.js; no hunk reaches the cited decision) | — |
| 25 | `renderer-provider-abstraction` | — | unchanged (touched: lib/render.js, Home's script list now loads { module: /cost-format-global.js }; cited decision not in a hunk) | — |
| 26 | `cache-module-family` | low | unchanged (no cited file touched in e2d4659c4..fb358dbda) | — |
| 27 | `lib-components-primitive-adoption` | — | unchanged (touched files: lib/render-run-steps.js (fmtDuration moved to lib/time-words.js), lib/render.js; no hunk reaches the cited decision) | — |
| 28 | `state-store-write-seam` | — | unchanged (no cited file touched in e2d4659c4..fb358dbda) | — |
| 29 | `phase-vocabulary-centralization` | low | unchanged (no cited file touched in e2d4659c4..fb358dbda) | — |
| 30 | `target-harness-axis-orthogonality` | — | unchanged (touched: routes/dispatch.js; its hunks are the LIN-4468 mint stamp and NEVER_RAN; cited decision not in a hunk) | — |
| 31 | `test-seam-separation` | — | unchanged (no cited file touched in e2d4659c4..fb358dbda) | — |
| 32 | `css-token-layer` | — | unchanged (no cited file touched in e2d4659c4..fb358dbda) | — |
| 33 | `runner-contract-semantics-cross-repo` | medium | unchanged (no cited file touched in e2d4659c4..fb358dbda) | — |
| 34 | `connection-binding-predicate-drift` | low-medium | unchanged (no cited file touched in e2d4659c4..fb358dbda) | — |
| 35 | `run-page-identity-scrape` | medium | unchanged (no cited file touched in e2d4659c4..fb358dbda) | — |
| 36 | `dispatch-entrance-field-duplication` | low | unchanged (touched: routes/proxy-compute.js, now promptContextOf (LIN-4470) and isHermeticTestToken; the entrance field re-projection is not in a hunk) | — |
| 37 | `owner-word-collision` | low | unchanged (touched: lib/run-view.js, stamp kinds from lib/dispatch-feedback-kinds.js and BLIND_READ_KIND; the owner word is not in a hunk) | — |
| 38 | `run-family-render-primitives` | low | unchanged (touched files: lib/render-run-steps.js (fmtDuration moved to lib/time-words.js), lib/render.js; no hunk reaches the cited decision) | — |
| 39 | `persist-binding-sibling-seams` | low | unchanged (no cited file touched in e2d4659c4..fb358dbda) | — |
| 40 | `server-formatter-duplication` | low | improved: fmtDuration and relativeAgo have one leaf (lib/time-words.js, LIN-4472) and the public/task-page.js formatElapsed copy is gone; byte-identical formatDuration copies stay in lib/render-escalation-kpis.js and lib/render-effort-readout.js, and relative time is still worded four ways (row 160) | — |
| 41 | `wake-marker-regex-copies` | resolved | resolved (held; no cited file touched in the window) | — |
| 42 | `runner-liveness-assumption` | low | unchanged (no cited file touched in e2d4659c4..fb358dbda) | — |
| 43 | `workspace-urlkey-consolidation` | — | unchanged (no cited file touched in e2d4659c4..fb358dbda) | — |
| 44 | `credential-decision-multiplicity` | medium-high | unchanged (touched: routes/settings.js, callsSurfaceOf now imported from lib/cost-read-calls.js; cited decision not in a hunk) | — |
| 45 | `keepalive-error-envelope-writer` | resolved | resolved (held; no cited file touched in the window) | — |
| 46 | `html-error-page-two-writers` | resolved | resolved (held; no cited file touched in the window) | — |
| 47 | `ai-availability-gate-duplication` | medium-low | improved (partly): the inline NODE_ENV-and-test-token test mode is now isHermeticTestToken (lib/should-mock-ai.js, 12 importers in lib/routes/server.js; census G0008 gone, G0002 43 -> 31 sites); the not-configured gates outside isAiUnavailable are not in a hunk | — |
| 48 | `dispatch-refusal-relay-duplication` | resolved | resolved (held; no cited file touched in the window) | — |
| 49 | `tolerant-date-parse-date-twins` | resolved | resolved (held; no cited file touched in the window) | — |
| 50 | `timestamp-parse-consolidation` | — | unchanged (no cited file touched in e2d4659c4..fb358dbda) | — |
| 51 | `loose-json-consolidation` | — | unchanged (no cited file touched in e2d4659c4..fb358dbda) | — |
| 52 | `ai-mock-predicate-consolidation` | — | unchanged (no cited file touched in e2d4659c4..fb358dbda) | — |
| 53 | `batch-guard-residue` | informational | unchanged (no cited file touched in e2d4659c4..fb358dbda) | — |
| 54 | `decision-dialect-split` | medium (sub-row) | unchanged (no cited file touched in e2d4659c4..fb358dbda) | — |
| 55 | `human-wait-derivation-split` | low-medium | unchanged (touched files: lib/digest-feedback.js (stamp kinds from the table), lib/render-run-steps.js, lib/render-session.js, lib/render.js, lib/run-view.js, lib/task-page-loader.js, routes/dispatch.js; no hunk reaches the cited decision) | — |
| 56 | `decision-stamp-classifier-copies` | low-medium | improved: the decision-stamp set has one home (DECISION_LIFECYCLE_STAMP_KINDS, lib/dispatch-feedback-kinds.js, LIN-4455), read by digest-feedback, session-telemetry, run-view and wall-clock-summary; two predicates over it remain (_isStampEntry in lib/session-telemetry.js, isDecisionLifecycleStampEntry in lib/digest-feedback.js), and the classic public/dispatch.js and public/session.js restate the set under a drift test | — |
| 57 | `provider-write-field-contract` | low-medium | unchanged (no cited file touched in e2d4659c4..fb358dbda) | — |
| 58 | `close-out-merged-refusal-split` | low-medium | improved: one close-out decision (closeOutDecision, lib/run-closeout-state.js, LIN-4460) answers every surface; closeOutSetsDone, byPersonCheck, REFUSED_REASONS and readGateTrail are gone; the Done bound is still split with the check route (row 163) | — |
| 59 | `periodic-loop-two-mechanisms` | informational | unchanged (touched: server.js; its hunks are isHermeticTestToken at three test-mode sites, the held-wake provisioner factory and the /lib/ serving comment; cited decision not in a hunk) | — |
| 60 | `consumer-liveness-signal-conflation` | resolved | resolved (held; no cited file touched in the window) | — |
| 61 | `consumer-heartbeat-wire-restated` | low-medium (sub-row of 60) | unchanged (touched: routes/dispatch.js; its hunks are the LIN-4468 mint stamp and NEVER_RAN; cited decision not in a hunk) | — |
| 62 | `owner-answer-reader-copies` | low | unchanged (no cited file touched in e2d4659c4..fb358dbda) | — |
| 63 | `mock-ai-builder-copies` | low-medium | unchanged (touched: routes/proxy-compute.js; census G0121 still has the three mock child-shaping copies, workspace-api-mocks.js, proxy-compute.js, task-chat.js) | — |
| 64 | `fresh-run-definition-copies` | low-medium | unchanged (touched: lib/dispatch-store.js; its hunks move FEEDBACK_ENTRY_KINDS to lib/dispatch-feedback-kinds.js, use NEVER_RAN and bind the held-wake release wording late; cited decision not in a hunk) | — |
| 65 | `terminal-loop-rule-copies` | low-medium | unchanged (touched: server.js; its hunks are isHermeticTestToken at three test-mode sites, the held-wake provisioner factory and the /lib/ serving comment; cited decision not in a hunk) | — |
| 66 | `state-type-label-rank-maps` | low-medium | unchanged (touched files: public/common.js, server.js; no hunk reaches the cited decision) | — |
| 67 | `csp-decision-split` | resolved | resolved (held; no cited file touched in the window) | — |
| 68 | `priority-label-maps` | low | unchanged (no cited file touched in e2d4659c4..fb358dbda) | — |
| 69 | `localhost-predicate-split` | low | unchanged (touched files: routes/dispatch.js, server.js; no hunk reaches the cited decision) | — |
| 70 | `observer-instance-key-copies` | low | unchanged (no cited file touched in e2d4659c4..fb358dbda) | — |
| 71 | `pilot-eligibility-copies` | low | unchanged (touched files: lib/render.js, routes/dispatch.js; no hunk reaches the cited decision) | — |
| 72 | `linear-image-host-allowlist` | low | unchanged (touched: lib/render.js, Home's script list now loads { module: /cost-format-global.js }; cited decision not in a hunk) | — |
| 73 | `page-chrome-options` | low | unchanged (no cited file touched in e2d4659c4..fb358dbda) | — |
| 74 | `ship-biscuit-desk-list` | low | unchanged (touched: lib/render.js, Home's script list now loads { module: /cost-format-global.js }; cited decision not in a hunk) | — |
| 75 | `free-tier-rule-copies` | resolved | resolved (held; no cited file touched in the window) | — |
| 76 | `sd-blocked-child-last-activity-split` | low | unchanged (no cited file touched in e2d4659c4..fb358dbda) | — |
| 77 | `census-gone-overstates-resolution` | informational | unchanged (no cited file touched in e2d4659c4..fb358dbda) | — |
| 78 | `follow-up-target-rule-copies` | resolved | resolved (held; no cited file touched in the window) | — |
| 79 | `lineage-row-read-copies` | low | unchanged (touched: lib/pipeline-churn.js, the blind-read literal now BLIND_READ_KIND; cited decision not in a hunk) | — |
| 80 | `pr-url-regex-copies` | low | unchanged (no cited file touched in e2d4659c4..fb358dbda) | — |
| 81 | `pause-marker-predicate-gap` | low | unchanged (touched files: lib/dispatch-store.js, lib/task-page-loader.js, routes/dispatch.js; no hunk reaches the cited decision) | — |
| 82 | `review-on-record-readers` | low | unchanged (no cited file touched in e2d4659c4..fb358dbda) | — |
| 83 | `credential-block-grammar-split` | low | unchanged (no cited file touched in e2d4659c4..fb358dbda) | — |
| 84 | `review-loop-ceiling-restated` | low | unchanged (no cited file touched in e2d4659c4..fb358dbda) | — |
| 85 | `sweep-as-library-imports` | low | unchanged (no cited file touched in e2d4659c4..fb358dbda) | — |
| 86 | `github-envelope-walker-split` | low | unchanged (no cited file touched in e2d4659c4..fb358dbda) | — |
| 87 | `binding-active-answer-copies` | low-medium (sub-row of 44) | unchanged (touched files: lib/render.js, server.js; no hunk reaches the cited decision) | — |
| 88 | `auth-failure-answer-copies` | low-medium | unchanged (touched: routes/dispatch.js; its hunks are the LIN-4468 mint stamp and NEVER_RAN; cited decision not in a hunk) | — |
| 89 | `account-group-reader-copies` | low | unchanged (no cited file touched in e2d4659c4..fb358dbda) | — |
| 90 | `stable-stringify-copies` | low | unchanged (no cited file touched in e2d4659c4..fb358dbda) | — |
| 91 | `kpi-page-twin-copies` | low-medium | unchanged (touched: lib/render.js, Home's script list now loads { module: /cost-format-global.js }; cited decision not in a hunk) | — |
| 92 | `kit-terminal-status-copy` | low | unchanged (touched: routes/dispatch.js; its hunks are the LIN-4468 mint stamp and NEVER_RAN; cited decision not in a hunk) | — |
| 93 | `sd-parked-predicate-inline` | low | unchanged (no cited file touched in e2d4659c4..fb358dbda) | — |
| 94 | `https-predicate-restated` | low | unchanged (touched: server.js; its hunks are isHermeticTestToken at three test-mode sites, the held-wake provisioner factory and the /lib/ serving comment; cited decision not in a hunk) | — |
| 95 | `harbour-token-format-restated` | — | unchanged (no cited file touched in e2d4659c4..fb358dbda) | — |
| 96 | `registry-providers-restated` | low (sub-row of 44) | unchanged (no cited file touched in e2d4659c4..fb358dbda) | — |
| 97 | `sd-401-layers-three` | low | unchanged (no cited file touched in e2d4659c4..fb358dbda) | — |
| 98 | `expire-ownerless-has-owner-copy` | low | unchanged (touched: routes/dispatch.js; its hunks are the LIN-4468 mint stamp and NEVER_RAN; cited decision not in a hunk) | — |
| 99 | `vendor-script-list-restated` | low | unchanged: still one hand-written scripts list per renderer; Home, Swipe and the task page each repeat { module: /cost-format-global.js }, /prompt-section.js (census G0233 left by a re-key, not a fold) | — |
| 100 | `prune-to-capacity-clones` | low | unchanged (no cited file touched in e2d4659c4..fb358dbda) | — |
| 101 | `resume-model-effort-cross-repo` | medium-high | unchanged (touched: routes/dispatch.js; its hunks are the LIN-4468 mint stamp and NEVER_RAN; cited decision not in a hunk) | — |
| 102 | `halt-word-map-copies` | medium | unchanged: the mode-to-word maps stay (HALT_BANNER_WORD lib/render.js, HALT_MODE_LABELS public/dispatch.js); census G0049 re-keyed as G0076 when lib/dispatch-leftover.js took HALT_MODES (row 142) | — |
| 103 | `home-next-answer-split` | medium | unchanged (no cited file touched in e2d4659c4..fb358dbda) | — |
| 104 | `coherence-loop-stalled` | medium (process) | unchanged (no cited file touched in e2d4659c4..fb358dbda) | — |
| 105 | `settings-run-setup-rebuilt` | low-medium | unchanged (touched: routes/settings.js, callsSurfaceOf now imported from lib/cost-read-calls.js; cited decision not in a hunk) | — |
| 106 | `settings-preset-systems` | low-medium | unchanged (touched files: lib/render.js, routes/dispatch.js, routes/settings.js; no hunk reaches the cited decision) | — |
| 107 | `routes-as-library` | low-medium | unchanged (no cited file touched in e2d4659c4..fb358dbda) | — |
| 108 | `model-vocabulary-rule-copies` | low-medium | unchanged (touched files: lib/render.js, public/common.js; no hunk reaches the cited decision) | — |
| 109 | `task-page-state-outside-owner` | low-medium | unchanged: READY_TASK_STATE still lib/render-task-page.js:116; public/task-page.js became a module (LIN-4472) and its status reads moved with it | — |
| 110 | `live-anchor-old-home-alive` | low-medium | unchanged (touched: routes/proxy-rulings.js, the write gate per op; the inline live-anchor copy is not in a hunk) | agent-api |
| 111 | `lineage-anchor-rules-three` | low-medium | unchanged (touched: lib/dispatch-store.js; its hunks move FEEDBACK_ENTRY_KINDS to lib/dispatch-feedback-kinds.js, use NEVER_RAN and bind the held-wake release wording late; cited decision not in a hunk) | — |
| 112 | `model-constants-server-client-twins` | resolved | resolved (held; no cited file touched in the window) | — |
| 113 | `low-rows-unpromoted` | low | unchanged (touched files: lib/render.js, lib/task-page-loader.js (relativeAgo moved out, NEVER_RAN, latestReviewComment from run-trail); no hunk reaches the cited decision) | — |
| 114 | `halt-poll-cold-cache-fail-open` | medium (conditional) | unchanged (no cited file touched in e2d4659c4..fb358dbda) | — |
| 115 | `usage-relay-flag-partial` | resolved | resolved (held; no cited file touched in the window) | — |
| 116 | `usage-record-vocabulary-two-readers` | low-medium | unchanged (no cited file touched in e2d4659c4..fb358dbda) | — |
| 117 | `lineage-identity-read-twins` | resolved | resolved (held; touched: lib/dispatch-store.js, not the identity read) | — |
| 118 | `reap-window-constant-cross-repo` | low-medium | unchanged (no cited file touched in e2d4659c4..fb358dbda) | — |
| 119 | `cost-fold-partition-restated` | resolved | resolved (held: lib/cost-read.js lost readCalls/callsSurfaceOf to lib/cost-read-calls.js, LIN-4457; the partition read is unmoved) | — |
| 120 | `key-state-residue` | informational | unchanged (no cited file touched in e2d4659c4..fb358dbda) | — |
| 121 | `unit-census-convention-split` | informational | unchanged (touched: tests/unit/fake-dom-census.test.js, one line) | — |
| 122 | `usage-snapshot-prose-residue` | low | unchanged: the snapshot wording count in the cited files is 24 at both ends; lib/model-routing-spend.js changed only its import path | — |
| 123 | `completeness-precedence-restated` | borderline (not graded) | unchanged (lib/cost-read.js -97 lines are the calls move; the precedence ladder stays in lib/row-usage.js) | — |
| 124 | `erasure-inventory-lockstep-gap` | resolved | resolved (held; touched: server.js wiring only) | — |
| 125 | `parked-wait-text-cross-repo` | low-medium | unchanged (touched: lib/session-telemetry.js, PARKED_WAIT_SKIPPED_KINDS now from the kinds table; PARKED_WAIT_HINT still reads one of SD's four wait kinds) | — |
| 126 | `error-code-case-split` | low | unchanged (no cited file touched in e2d4659c4..fb358dbda) | — |
| 127 | `ruling-settled-row-predicate-inline` | low | unchanged: answered-or-dismissed is still inline at routes/dashboard-rulings.js:327, routes/workspace-api-issue-write.js:165,171,636 and routes/workspace-api-scan.js:389 | — |
| 128 | `waiting-standing-comment-residue` | low | unchanged (no cited file touched in e2d4659c4..fb358dbda) | — |
| 129 | `request-source-guard-copies` | low | unchanged: the three inline loader-shape checks remain (lib/cost-read.js:157, lib/run-view.js:374, lib/kpi-stats.js:1067) | — |
| 130 | `reply-effect-default-split` | borderline (not graded) | unchanged (no cited file touched in e2d4659c4..fb358dbda) | — |
| 131 | `override-kind-list-stale` | low | resolved in code: the VERB OVERRIDE list is OVERRIDE_KINDS = Object.keys(STAGE_KINDS) (lib/proxy-instructions.js:15, LIN-4467), so it names every template key; LIN-4302 is still Backlog | — |
| 132 | `path-class-predicate-copies` | low | unchanged (no cited file touched in e2d4659c4..fb358dbda) | — |
| 133 | `world-helper-convention-half-guarded` | low | unchanged in rule: a module loader (tests/unit/helpers/import-world.js, importWorld) joined loadWorld, recorded in docs/areas/front-end-browser.md but not in CLAUDE.md, which names only loadWorld | — |
| 134 | `stage-writes-threading-per-entrance` | low | unchanged in shape, stakes raised: writes is still threaded by hand at the four entrance sites (lib/dispatch-entrance.js x2, routes/workspace-api-feedback.js x2); refire and wake mints now share lib/item-stage-stamp.js; since LIN-4468 the value gates proxy writes and an unstamped token is unrestricted, so a missed thread fails open (row 162) | — |
| 135 | `in-progress-predicate-server-client-split` | low | unchanged (touched files: lib/task-state.js (an import path), public/prompt-section.js (a comment); no hunk reaches the cited decision) | — |
| 136 | `stage-kind-roster-tables` | low | improved: one record per stage kind (lib/prompts/stage-kinds.js, LIN-4467); STAGE_LEADS, PROMPT_TEMPLATES, COMPLETION_SIGNALS, STAGE_INTENT, STAGE_LABELS and the VERB OVERRIDE list are views; census G0100 gone; about eight kind-keyed tables remain (GENERATE, BUCKET_OF_KIND, FIRST_PASS_KINDS/OFF_SPINE_KINDS, JOBS, SPINE/STEP_KIND_WORDS, SURVEY_HEADINGS, TEMPLATES_RENDERED_CEILINGS), each listed by tests/unit/stage-kind-tables.test.js; the Waiting entry left (settled by LIN-4467/4470); the claim that every table is a view is row 161 | — |
| 137 | `enqueue-route-list-restated` | low | unchanged: CLAUDE.md:107 and lib/proxy-scopes.js:24-26 still list three enqueue routes; LIN-4320 Backlog | — |
| 138 | `element-method-guard-idiom-beyond-scan` | low | unchanged (no cited file touched in e2d4659c4..fb358dbda) | — |
| 139 | `client-dual-export-split` | low (borderline) | unchanged: public/live-console.js keeps its dual export; the three converted pages kept none | — |
| 141 | `session-lane-grant-from-client-text` | low-medium | unchanged: lib/dispatch-entrance.js:1230 still passes isAutopilotVariant(prompt) to declaresPeriodicalGrant; LIN-4318 Backlog | — |
| 140 | `working-beat-grammar-cross-repo` | low-medium | unchanged: no [working] line in any window hunk in either repo; Harbour still parses the beat grammar itself (lib/session-telemetry.js HEARTBEAT_HINT) and the contract's heartbeat row covers the host heartbeat only; LIN-3828 Backlog | — |
| 142 | `leftover-gate-restates-three-decisions (R1)` | resolved | resolved: lib/dispatch-leftover.js imports NEVER_RAN (lib/dispatch-terminal.js), HALT_MODES (lib/workspace-halt.js) and followUpTarget (lib/dispatch-targets.js) and keeps none of its own (LIN-4455 beat 3); census G0022, G0049 and G0234 left; the Waiting entry left with it | runs-and-dispatch |
| 143 | `periodical-notes-bullet-restates-leftover-rule (P1)` | LOW | improved: the four "search the repo for a committed tool" spellings are one helper, committedSearch (lib/periodicals.js, LIN-4469), and the notes-PR rule reads NOTES_PR from the leaf; the hand-off rule is still spelled in three bullets, pinned by tests/unit/lin-4390-periodical-hand-off.test.js | llm-and-prompts |
| 144 | `context-not-scope-three-homes (P2)` | LOW | unchanged: "Waiting entries are context, not scope" in lib/prompt-formatters.js:614 and both READMEs | llm-and-prompts |
| 145 | `area-notes-dir-outside-registry-path (P3)` | LOW | improved (one constant pair), count up by comments: REGISTRY_PATH now derives from NOTES_DIR and REGISTRY_FILE (lib/prompts/area-registry-path.js, LIN-4470); docs/areas spelled in 28 lines / 14 files at fb358dbda (26 / 11 at e2d4659c4; JavaScript only 18 / 9 -> 19 / 12), the added lines comments citing note files; the kept entry cites lib/periodicals.js, which spells it 0 times, and gives the JS-only count beside the all-files command (recounted in this PR) | llm-and-prompts |
| 146 | `area-notes-guard-copied-and-diverged (P4)` | LOW | unchanged: the guards stay copied by design; Harbour's reads isCitedPath, SD's keeps its own spelling, which agrees (same path span, same extensions) | llm-and-prompts |
| 147 | `as-asked-rule-sentence-two-homes (A1)` | LOW (borderline) | unchanged: "no step may change them" in AS_ASKED_LEAD (routes/proxy-writes.js:80) and BRIEF_HINT (lib/as-asked.js:298) | agent-api |
| 148 | `agent-api-literals-restate-homes (A2)` | LOW (borderline) | improved (partly): DECIDED_BY is read from lib/size-of-move.js by the stage records; "a day" (lib/proxy-instructions.js:501) and "four lines" (routes/proxy-writes.js:405) remain | agent-api |
| 149 | `session-pr-pick-mirror-cross-repo` | LOW–MEDIUM | improved: nine report rows in the contract now pin the session-PR pick on both sides (LIN-4475/4476) and the Waiting entry left; still unpinned: a message with no DONE: line, where Harbour takes the first PR and SD its tracked ranking; one report row pins a disagreement (an http DONE: URL: SD canonical https, Harbour none, PR_URL_RE in lib/run-ledger.js), held by a runs-and-dispatch entry (second read) | runs-and-dispatch |
| 150 | `dispatch-model-pick-second-rule` | resolved | resolved: dispatchModelOf is gone; dispatchesOf carries fold.last.model from foldRequestUsage (lib/cost-read.js) and the timeline reads dispatch.model (LIN-4454); the Waiting entry and Lesson's cause left | runs-and-dispatch |
| 151 | `blind-read-kind-and-heading-retyped` | resolved | resolved (code): the kind and heading come from lib/prompts/blind-read-words.js in every runtime reader, VIRTUAL_PROMPTS is gone and an AST scan enforces it (LIN-4466); the template registry is exempt (goal('blind-read')) and lib/render-run-evidence.js:87 hand-types the label 'Blind read' | llm-and-prompts |
| 152 | `retirement-rule-restated-per-reader` | LOW | improved: Harbour's README now points at the leaf for the forms; docs/proxy-integration.md still lists the refusal kinds by hand; SD's README keeps "a follow-up is filed for it", held as SD's own in the llm-and-prompts entry | llm-and-prompts |
| 153 | `landing-exclusions-two-lists` | resolved | resolved: one comment classifier, COMMENT_KINDS (lib/run-trail.js, LIN-4458); landingPrUrls is a view of it and isLandingEvidence/isSurveyReport are deleted; the landing readers agree on agent notes (Seams run 12 section 3.0a answered); the selector's own PR list is row 159 | runs-and-dispatch (existing entry) |
| 154 | `code-settled-routes-list-copies` | resolved | resolved: CODE_ROUTES (lib/code-routes.js, LIN-4465) is the one list, codeRouteOf iterates it, and every prose copy points at it; public/llms.txt's catalogue is generated (scripts/gen-llms-catalogue.mjs) and pinned byte for byte; the order line in docs/architecture/prompt-system.md is pinned | llm-and-prompts |
| 155 | `cited-path-rule-three-spellings` | resolved | resolved: one predicate, isCitedPath (lib/prompts/area-note-format.js, LIN-4470), read by the guard and lib/dispatch-leftover-answer.js; SD's guard is a third spelling that agrees, kept as SD's own | llm-and-prompts |
| 156 | `ruling-outcome-buckets-claim-home` | LOW | unchanged (no cited file touched; the reports-and-operator-tools entry stands) | reports-and-operator-tools |
| 157 | `timeline-renderer-rederives-tick-style` | LOW | unchanged: lib/render-task-timeline.js still restates the tick rule (its one window hunk is an import path); the front-end-pages entry stands | front-end-pages |
| 158 | `close-out-gate-precedence-split` | resolved | resolved: closeOutSetsDone is gone; one decision, closeOutDecision (lib/run-closeout-state.js, LIN-4460), answers the box, the guard, the check route and blindReadStep; a merged landing is followed (John's R1 ruling, 13 Nov); the stop-at bound is still applied in the route (row 163) | runs-and-dispatch |
| 159 | `trail-pr-list-beside-landing` | LOW–MEDIUM | new (window claim, LIN-4458; the reader predates it): assembleTrailFacts builds prUrls from every comment with no kind filter (lib/recommendation-facts.js:466-471), feeding the selector line "PRs linked on the trail" (:554) and the look-first gate (lib/recommendation-look-first.js:152), while lib/run-trail.js:15-17 says the prompt is a view of the one trail pass and cannot disagree; reproduced: a survey-task report citing a PR turns look-first off ("has a PR"), skipping survey-place and scoping, with an empty landing (evidence look-first-survey-pr-repro.txt) | llm-and-prompts |
| 160 | `relative-time-four-formatters-one-home-claim` | LOW–MEDIUM | new (window claim, LIN-4472; the copies predate it): lib/time-words.js says it is the one home for relative-time words on the server and the task page, as do tests/unit/lin-4472-time-words.test.js, docs/architecture/source-map.md and lib/components/time.js; but formatRelativeTime (lib/render.js, Settings/Home/KPIs, "25m ago"), window.relativeTime (public/common.js, read by the Observation module), formatGeneratedAge (public/prompt-section.js, rounds) word the same moment; byte-identical formatDuration in lib/render-escalation-kpis.js and lib/render-effort-readout.js; the guard keys on two names | front-end-pages |
| 161 | `stage-record-claims-and-catalogue-group` | LOW | new (window, LIN-4467): the record's catalogue.group (lib/prompts/stage-kinds.js) drives the generated Default/More split in public/llms.txt, while the UI split is DEFAULT_PROMPT_KEYS (lib/render-prompt-opts.js); they agree today and no test links them; docs/architecture/source-map.md says every per-kind table is a view of the record, while about eight kind-keyed tables remain (row 136); catalogue lines retype the display name | llm-and-prompts |
| 162 | `stage-write-default-and-allowance-unguarded` | LOW | new (window, LIN-4468): "no stamp means work" is restated in lib/item-stage-stamp.js (x2), lib/proxy-preamble.js resolveWrites and lib/stage-writes.js (isRestrictedStamp, stageWriteAllows); an unknown value throws in the preamble and reads none in normalizeWritesStamp; ALLOWED_OPS has no completeness test against WRITES_VALUES (a new value 500s, not 403s); the mandates say "one comment", the gate allows the createComment op any number of times | other-features |
| 163 | `closeout-done-bound-split` | LOW | new (window, LIN-4460): lib/run-closeout-state.js says the Done rule is bounded there in one place, but setDone has no stop-at term and the stop-at-PR bound is applied in routes/workspace-api-run-evidence.js; inside closeOutDecision the person-acted rule is spelled twice (doneWithoutHarbour, and routesRead's inline variant), and followsPerson/waitsOn have no production reader | runs-and-dispatch |
| 164 | `fold-empty-corner-leftover-unhomed` | LOW | new (window, cross-repo, LIN-4475/4476): the contract's fold corner rows name SD's raw "" model and "" timestamp as a leftover for SD (lib/runner-kit/contract.json); Harbour's intake rejects at "" (lib/request-usage-intake.js), so such a request record is lost; neither repo's notes held it | SD stop-hook-and-relay |
| 165 | `feedback-kinds-header-stale` | LOW | new (window, LIN-4455/4459): lib/dispatch-feedback-kinds.js says the runner prompt renders the kinds through the store's re-export and that the store imports it; the store does neither (its comment says so) and lib/prompts/runner-kickoff.js imports the leaf | runs-and-dispatch |
| 167 | `prompt-context-header-overclaims` | LOW | new (window, LIN-4470; found by the second read): lib/prompts/prompt-context.js says every prompt surface that renders a stage from a fetched context hands generatePrompt its one projection, but the routed and code-routed recommendation (composeRoutedRecommendation, lib/openrouter.js) passes prepareRecommendationInput's hand-built superset (lib/recommendation-input.js, adding focusedChild, runs, allRuns); a test pins that every projected field reaches it, so a miss fails CI rather than drifting | llm-and-prompts |
| 166 | `jira-as-asked-end-line-looser` | LOW | new (window, LIN-4450): the Jira region reader accepts an end line whatever its marks and, for a block edited in Jira, takes the first end paragraph (lib/providers/jira/as-asked-region.js), looser than splitAsAsked; the providers Lesson calls it safe because filing refuses such a block, which does not cover an edit made in Jira later | providers |


## Follow-ups

None minted. Every finding is in this report and, where it binds a builder or waits in an area, in that area's note.


## Adversarial Second-Read

- **Tier:** 2 — a fresh-context sub-agent with no memory of the report-writing turn. It was given the two repositories, their windows and the finished report, and none of the writer's notes.
- **Question:** "What is the largest item in this window that this report missed or misfiled?"

**Reader's answer (in full, lightly condensed for line length; every citation re-checked at `fb358dbda` by the writer):**

> I agree that row 159 is the window's largest item. Everything I found is LOW. The biggest miss is one more false "one home" header, of the same kind as rows 159, 160, 161 and 163, sitting in a module the report lists as an improvement.
>
> **1. Largest missed item: `promptContextOf`'s header is untrue for the busiest prompt surface.**
> - **What the header claims.** `lib/prompts/prompt-context.js:1-5`, added in this window by LIN-4470, says every prompt surface that renders a stage from a fetched context hands `generatePrompt` this one projection, "so a field added to the context reaches all of them from here".
> - **What the code does.** The routed and code-routed recommendation renders the stage prompt through `composeRoutedRecommendation` (`lib/openrouter.js:2056-2058`), called from `:1293`, `:2087` and `:2212`. It passes `generatePrompt` the object from `prepareRecommendationInput` (`lib/recommendation-input.js:35-42`), not `promptContextOf`. That is a second hand-written field list, which also carries `focusedChild`, `runs` and `allRuns`. This is the prompt recommend-and-dispatch actually sends, and the code routes (blind read, look-first) use it too.
> - **The window's own test admits it.** `tests/unit/lin-4470-prompt-context.test.js:1-8` says the fifth context "stays hand-built: it is pinned by a test, not derived".
> - **What the report says.** It lists "One prompt-context builder (`promptContextOf`)" as an improvement, noting only `routes/workspace-api-feedback.js:256` as an exception.
> - **Cost.** A new field must be added in two places, but the test catches a miss, so CI fails rather than output drifting. A template that ever read `context.runs` or `focusedChild` would render differently on recommend than on the pinned and override paths; no template reads them today.
> - **Severity:** LOW. Caused in this window.
>
> **2. Against row 159: AGREE.** I checked `lib/recommendation-facts.js:466-471` and `:554`, `lib/recommendation-look-first.js:152`, `COMMENT_KINDS` at `lib/run-trail.js:134-145` and the header at `:15-17`. The repro output matches the code (`## Survey open-0` is the survey-task heading, `lib/prompts/survey-words.js:8`). Nothing I found is larger or changes behaviour more.
>
> **3. Other items.**
> 1. **Row 149 is described too kindly.** One of the nine `report` rows (`lib/runner-kit/contract.json`, LIN-4475) pins the sides *disagreeing*. For `DONE: http://…`, SD returns the canonical https URL and Harbour returns null, because `PR_URL_RE` (`lib/run-ledger.js:355`) reads https only. `prUrlOfFeedback` partly recovers through its structured-`url` fallback (`lib/dispatch-wake.js:300-315`). A Waiting entry added in the window holds it. LOW.
> 2. **A Waiting entry was removed as settled while three copies remain.** `8aad24e35` removed the web-routes entry asking for one owner for mapping a cut-off to its reply. Three routers still each map a `truncationFailureOf` result their own way: `routes/dashboard-summaries.js:30-34`, `routes/proxy-compute.js:118-122` and `routes/workspace-api-steps.js:28-30`. LOW, borderline.
> 3. **The create-field rule is split between the in-app session create** (`routes/workspace-api-issue-write.js:259-276`, against `createFields()`) **and the proxy create** (`routes/proxy-writes.js:473-505`, `apiWriteFields()`). It is already a `docs/areas/web-routes.md` entry (LIN-4451), so it is held.
>
> **4. What the report got right:**
> - Rows 160, 163, 164 and 165 at their cited lines.
> - Rows 142, 153 and 158 resolved, and 131 derived.
> - Every write mount names a classified operation.
> - `res.status(` is 275 at both ends; the cost shim has one reader; only the two allow-listed leaves are served from `/lib/`.
> - SD's `sentinelLine` is the only sentinel-regex home.

**Disposition, item by item:**
1. Confirmed at HEAD and added as **row 167** (LOW), with a Waiting entry in `llm-and-prompts.md`. The LLM & prompts verdict line is qualified.
2. 149's delta now names the pinned http disagreement.
3. Re-read and ruled **borderline, not restored.** Each router now has one arm over the shared helper (`summaryFailure`, `streamedFailureReply`, `failureOf`), each mapping the helper's tuple into its own reply envelope. That is what the removed entry asked for within each file. Recorded under report-only.
4. Already held in `web-routes.md`; recorded under report-only.

The top finding is unchanged.

Adversarial second-read verdict: AGREE
Differed from top finding: NO
Disposition: fixed in place
