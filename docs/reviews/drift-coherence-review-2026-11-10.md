# Drift & Coherence Review — 2026-11-10, run 6 (trend vs the 2026-11-06 run 5)

**Ticket:** LIN-4403. **Previous edition:** `docs/reviews/drift-coherence-review-2026-11-06.md` (run 5, LIN-4324, PR #2334, merged `b9fc60abc`), called **run 5** below. **Evidence:** `docs/reviews/_evidence-2026-11-10-drift/`.

**Review-only.** This edition adds this report, its evidence folder and the area-note edits under `docs/areas/` (`runs-and-dispatch.md`, `llm-and-prompts.md`, `agent-api.md`). No code, config, guide, script, CI file or secret was changed. The Harbour window is pinned to `aec9e16be..b315e0e8f` (39 first-parent commits, LIN-4340 #2343 through LIN-4394 #2382). The gap `5c63aa26..aec9e16be` (13 commits, 4 production files, +161 / −58) is labelled "outside the window" wherever it appears and is used for no finding. Simple Dispatcher (SD) is pinned to `07c88f7a..5d8489e` (7 first-parent merges, #329 through #335; 20 files, +1875 / −116). `origin/main` is `b315e0e8f` at writing, so there is no addendum.

## Better or worse, by area

**One line for the whole window: better in one area, neutral in the rest.** The window moved three decisions to one home (the `## As asked` block, the leftover rule, model facts from the catalog). It also added one new decision module that restates three decisions that already have homes (R1), and some note-routing wording that restates itself (P1–P4). Both costs are LOW to LOW–MEDIUM.

| Area | Verdict | Evidence (code at `b315e0e8f`, measured against `aec9e16be`) |
|---|---|---|
| **LLM & prompts** (32 production files, +2512 / −718) | **better** | The `## As asked` words have one owner, `lib/as-asked.js` (LIN-4362). The leftover rule has one text, `LEFTOVER_RULE` in `lib/prompts/leftover-words.js`, which the leftover step, review and close-out render (LIN-4376). Model facts come from the OpenRouter catalog and the hand price card is gone (LIN-4358). **Cost:** P1–P4, four LOW restatements of note-routing words in `lib/periodicals.js` (`areaNotes`), `lib/prompt-formatters.js`, both area READMEs and four code spellings of `docs/areas/`. |
| **Runs & dispatch** (25 production files, +2046 / −457) | **neutral** | Better in the store: it holds a parent wake by `heldWakeFor` and knows no leftovers (LIN-4383); the leftover wording lives in `lib/dispatch-leftover-hook.js`. **Cost:** `lib/dispatch-wake.js` (`reportedPrUrlOf`) mirrors SD's `sessionPrs` by comment only (row 149). `lib/dispatch-leftover.js` (new, LIN-4373 to 4377) restates the follow-up target rule, the halt modes and the never-ran statuses, each of which has a home (R1). The store still spells the never-ran pair in `_releaseIfHeld` (the same R1 finding). |
| **Agent API (proxy)** (17 production files, +360 / −132) | **neutral** | The per-credential limiter (LIN-4378) keys on a credential only after auth. The enqueue route list is still stale in four prose copies (row 137), and `lib/proxy-scopes.js` now says "four" at `:8` and "three" at `:23-25` in one file. Two borderline literal restatements (A1, A2). |
| **Web routes** (9 files, +108 / −51) | **neutral** | Read through the census and the touch map only; no finding in this run is located there. |
| **Providers, front end (pages and browser), auth & accounts, other features, platform, reports & operator tools, wiring** (about 20 files) | **neutral** | Read through the census and the touch map; the groups they touch are ruled noise or carried unchanged. |

## Headline

1. **Better in the LLM & prompts area; neutral overall.** Three shared homes landed or held. The new cost is wording that restates note-routing rules (P1–P4, LOW).
2. **Top window finding: the session-PR pick is mirrored across repos, joined only by a comment (149, LOW–MEDIUM, new).** Harbour's `reportedPrUrlOf` and `prUrlOfFeedback` (`lib/dispatch-wake.js`) implement the same rule as SD's `sessionPrs` (`links.js`), and the only link is a comment. Each side has its own test, and no contract row pins the rule. The two read different surfaces and fall back in different orders, so a change to one side moves a user-visible PR link alone. This finding was missed by the first draft and found by the second read (see that section); it is ranked first.
3. **Second: R1, `leftover-gate-restates-three-decisions` (LOW–MEDIUM, new).** `lib/dispatch-leftover.js` restates the follow-up target set (`RESUMABLE_TARGETS` against `SESSION_TARGETS` in `lib/dispatch-targets.js`), the halt modes (`pause` and `stop`, against `HALT_MODES` in `lib/workspace-halt.js`) and the never-ran statuses (`NEVER_RAN`, which `_releaseIfHeld` in `lib/dispatch-store.js` also spells). A halt mode the gate does not list would not stop a leftover. Waiting entry in `runs-and-dispatch.md`.
4. **Carried rows 141 and 140 (LOW–MEDIUM) are unchanged in code.** Row 141: the session lane still reads prompt text for the grant (`lib/dispatch-entrance.js:1226`, `isAutopilotVariant`), inside a function the window touched; home LIN-4318 (Backlog). Row 140: no `[working]` hunk in the window in either repo; home LIN-3828 (Backlog).
5. **Row 136 worsened (LOW).** `survey-place` occurrences in `lib/`, `routes/` and `public/` went from 13 in 9 files to 21 in 10 files inside the window. The kind tables are still joined by string keys.
6. **The cross-repo contract mismatch from run 5 is resolved.** `lib/runner-kit/contract.json` and SD's `test/fixtures/runner-contract.json` both have 66 rows and are byte-identical (sha256 `602ab014…`). The broker's 429 policy (`EXCHANGE_MAX_WAIT_SECONDS = 60` in both repos, and SD's `exchangeRetryWait`) stays duplicated by design, held by contract cases; report-only.
7. **Census.** 107 `mustRule` groups: 92 unchanged, 5 grown, 6 shrunk, 4 new. Rulings: 34 real, 27 borderline, 46 noise. Two new groups (ranks 21 and 47) are R1's two homes. Twelve groups are gone against run 5; eleven of them fall in the window, and one (`paint()` / `paintCloseOut`, the clone in `public/close-out.js` and `public/session.js`) fell in the gap. The gap group is labelled outside the window.
8. **Notes.** Both notes at the cap were handled. `runs-and-dispatch.md` is at 6143 bytes (cap 6144); `llm-and-prompts.md` is at 6048; `agent-api.md` is at 3245. Three entries were removed because they are settled or no longer true, and several long entries were distilled without changing their meaning. Every change is listed under "Notes: pruned and distilled" below. The notes guard passes.
9. **Zero new tickets.** Carried tickets rechecked at writing: LIN-4320, 4318, 4302, 4256, 4303, 3828 and 4301 are Backlog; LIN-3449 is Todo. Row 114 (halt cold-cache) is John's ruling and is not chosen here.
10. **Second read:** **DISAGREE** (Tier 2, a fresh-context sub-agent). The reader's largest item was the session-PR pick mirrored across repos (149), which the first draft did not file. The report is revised in place: 149 is added and ranked first, R1 is second. The reader confirmed R1, row 141 and row 140 at HEAD. Disposition: fixed in place.

## Grounding (HEADs measured)

- **LinearViewer, window end: `b315e0e8f3e1e5f3b5d6e634e53c5dc83b41d754`** (LIN-4394, #2382). `origin/main` is the same commit at writing. Window production diff (`git diff --shortstat aec9e16be b315e0e8f -- lib routes public server.js`): **103 files, +5806 / −1597**, matching the ticket. The gap production diff: 4 files, +161 / −58.
- **SD: `5d8489e7fd8434f0e69af7df11a3746790abbe64`** (#335). Window `07c88f7a..5d8489e`: 20 files, +1875 / −116, 7 first-parent merges. Of those, the contract and broker changes (#330 to #334) are the cross-repo items below. SD's contract fixture and Harbour's contract are byte-identical.
- **Area registry:** `docs/areas/areas.json`, git blob `4011e82a2ed29f8bfe3e11a15b7d757d7924ff32`, sha256 `7482979363aa5d97864d279e35f1b32e9e5c101ecf2b693536b86d8f61807f1d`. One guide serves every reading in this run (below).
- **`res.status(` count** in `routes/` and `server.js`: 275 at `aec9e16be` and 275 at `b315e0e8f`.
- **TODO / FIXME markers added in the window:** none in Harbour (`lib`, `routes`, `public`, `server.js`, `scripts`, `tests`) and none in SD.
- **Ticket staleness check:** `git log --since=2026-11-10T07:39:53Z` is empty for every path the ticket names; the ticket's figures hold.

**What the window's size does to confidence.** Most of the window is consolidation and test-side moves. It built three homes that now have one reader each, and it is the largest window this series has read. The touch map is mechanical (basename matching), so each touched row was judged by hand against the window's hunks, not sampled. The judgement for each row is in its ledger line.

## Findings (severity-ranked; delta vs run 5)

Citations are at `b315e0e8f` (Harbour) and `5d8489e` (SD). "Carried" rows keep their run-5 names. The compact ledger holds all 141 carried rows and the eight new ones (142 to 149) with their deltas.

| # | name | severity | delta vs run 5 | one line |
|---|---|---|---|---|
| 1 | **149** `session-pr-pick-mirror-cross-repo` | LOW–MEDIUM | **new** (window, LIN-4375; found by the second read) | `lib/dispatch-wake.js` `reportedPrUrlOf` (`:275-288`) and `prUrlOfFeedback` (`:290-305`) pick the session's PR by a rule SD's `sessionPrs` (`links.js:296`, consumed by `hook.js:607`) also implements. The only link is the comment at `dispatch-wake.js:275`. Each side has its own test (SD `test/lin-4375-session-pr.test.js`; Harbour `tests/unit/lin-4375-session-pr-wins.test.js`), and no contract row pins it. The surfaces differ: SD reads reported lines from assistant text only and falls back to `gh pr create` results; Harbour reads report lines from any feedback entry and falls back to the entry's `url`, then its message. Whether the difference is intended is not confirmed. Note: `runs-and-dispatch.md`. |
| 2 | **142** `leftover-gate-restates-three-decisions` (R1) | LOW–MEDIUM | **new** (window, LIN-4373 to 4377) | `lib/dispatch-leftover.js` restates the follow-up target set (`:26`, cf. `SESSION_TARGETS`, `lib/dispatch-targets.js:29`), the halt modes (`:113`, cf. `HALT_MODES`, `lib/workspace-halt.js:34`) and `NEVER_RAN` (`:29`; `_releaseIfHeld` at `lib/dispatch-store.js:1906` spells the same pair). A halt mode the gate does not list would not stop a leftover. Census groups 21 and 47. Home: `HALT_MODES`; the follow-up rule; one exported status set. Note: `runs-and-dispatch.md`. |
| 3 | **141** `session-lane-grant-from-client-text` | LOW–MEDIUM | **unchanged in code** | `lib/dispatch-entrance.js:1226` still calls `isAutopilotVariant(prompt)` for the session lane's grant. The window edited the enclosing `declaresDispatchGrant` (`:1228`) and left the sniff. The owner check at the mint remains the authority. Home LIN-4318 (Backlog, 1 comment). |
| 4 | **140** `working-beat-grammar-cross-repo` | LOW–MEDIUM | **unchanged** | No `[working]` line in any window hunk under `lib`, `routes`, `public` or `server.js`, and none in SD's window. The four `[working]` lines the window adds are test-only, in `tests/unit/lin-4370-look-first-route.test.js`. Home LIN-3828 (Backlog, 1 comment). |
| 5 | **136** `stage-kind-roster-tables` | LOW | **worsened** | `survey-place` occurrences in `lib/`, `routes/`, `public/`: 13 in 9 files at `aec9e16be` and 21 in 10 files at `b315e0e8f`. The window added eight occurrences (e.g. in `lib/recommendation-look-first.js` and `lib/wall-clock-summary.js`). Still joined by string keys; no ticket names the roster. |
| 6 | **137** `enqueue-route-list-restated` | LOW | **unchanged** (four stale copies remain) | `CLAUDE.md` names three enqueue routes (its `dispatch` line lists `/dispatch`, `/recommend-and-dispatch`, `/autopilot/kickoff`, without the periodical mint); `lib/proxy-scopes.js:23-25` lists three; `docs/proxy-integration.md` lists three in the dispatch row. `lib/proxy-scopes.js:8` now says "the four enqueue mounts", so one file contradicts itself. `docs/architecture/auth.md:236` says four (current). Home: LIN-4320 (Backlog, 1 comment), which should be widened. |
| 7 | **P1** `periodical-notes-bullet-restates-leftover-rule` | LOW | **new** (window, LIN-4379) | `lib/periodicals.js:313` (`areaNotes`) says to follow the area notes' own rules, then restates them (one home, Waiting vs Lesson, file before report). Renders into the Periodical templates. `tests/unit/lin-4374-review-leftover-read.test.js` catches verbatim copies only. Note: `llm-and-prompts.md`. |
| 8 | **P2** `context-not-scope-three-homes` | LOW | **new** | "Waiting entries are context, not scope" is spelled in `lib/prompt-formatters.js:604`, `docs/areas/README.md:60` and SD's `docs/areas/README.md:60`. Not in `LEFTOVER_RULE`. A cross-repo seam: the rule is written in both READMEs. Note: `llm-and-prompts.md`, named in the P1 entry. |
| 9 | **P3** `area-notes-dir-outside-registry-path` | LOW | **new** | `lib/prompts/area-registry-path.js` spells the registry path once, but `docs/areas/` is spelled independently in `lib/prompt-formatters.js:600`, `lib/dispatch-leftover.js:141`, `lib/prompts/leftover-words.js:24` and `lib/prompt-template-defs.js:1039`. Note: `llm-and-prompts.md`, named in the P1 entry. |
| 10 | **P4** `area-notes-guard-copied-and-diverged` | LOW | **new** (cross-repo) | The notes guard is copied: Harbour `tests/unit/area-notes.test.js` (147 lines) and SD's `test/area-notes.test.js` (200 lines). SD adds the `sh` extension and three checks; SD's README lacks the Periodical-entry rules. Only comments hold the copies together. The seam starts in `lib/prompt-formatters.js`, where the notes' wording lives; SD's side is SD's and no SD edit is made in this review. Note: `llm-and-prompts.md`. |
| 11 | **138** `element-method-guard-idiom-beyond-scan` | LOW | **unchanged** | The `typeof X.m === 'function'` and presence-test idiom on `focus`, `setSelectionRange`, `dispatchEvent` remains at `public/prompt-section.js:1055, 1223, 1856` and `public/question-cards.js:241` (line drift only). Home: LIN-4303 (Backlog, 1 comment), re-scope. |
| 12 | **135** `in-progress-predicate-server-client-split` | LOW | **unchanged** | The client still reads the waiting status beside `live` in `public/prompt-section.js`; the server's `live` still excludes waiting. Home LIN-4256 (Backlog). |
| 13 | **131** `override-kind-list-stale` | LOW | **unchanged in code** (the VERB OVERRIDE sentence was reworded for LIN-4370 and still lists 15 of 19 keys) | `lib/proxy-instructions.js` VERB OVERRIDE list. Home LIN-4302 (Backlog, 0 comments). |
| 14 | **139** `client-dual-export-split` | LOW (borderline) | **unchanged** | `public/live-console.js:1361-1367` still publishes two disjoint surfaces (`module.exports` and `window.LiveConsoleLane`). Report-only: a convention outlier. |
| 15 | **A1** `as-asked-rule-sentence-two-homes` | LOW (borderline) | **new** (window, LIN-4362) | "no step may change them" is written in `AS_ASKED_LEAD` (`routes/proxy-writes.js:70`) and in `BRIEF_HINT` (`lib/as-asked.js:296`). The census pins the markers, not this rule. A sweep found no copy in SD or elsewhere in `docs/`. Note: `agent-api.md`. |
| 16 | **A2** `agent-api-literals-restate-homes` | LOW (borderline) | **new** | Literals restate homes in four places: the look-first sequence by hand in `lib/proxy-instructions.js` (`LOOK_FIRST_STEPS` lives in `lib/recommendation-look-first.js:77`), "a day" beside `LANDED_MIN_GAP_MS` (`lib/periodical-runs.js:98`, `DAY_MS`), `lib/completion-signals.js` `DECIDED_BY` values by hand, and "four lines" in `routes/proxy-writes.js:354` beside `RECORD_LINES` (`lib/size-of-move.js:22`). Note: `agent-api.md`. |

**Resolved:** none new this run (the run-5 "resolved" rows hold; no cited file moved). **Improved:** none new. **Worsened:** 1 (row 136). **New:** 8 (rows 142 to 149: R1, P1 to P4, A1, A2, and the session-PR pick mirror, 149). **Unchanged in code, with a ticket or a ruling:** the rest of the touched rows, judged in the ledger.

**Report-only (no area file to cite, or a designed duplicate):**
- **Broker 429 policy, held by contract.** `EXCHANGE_MAX_WAIT_SECONDS = 60` in `lib/runner-kit/broker.mjs:97` and in SD's `harbour-token-mcp-server.js:56`, with `exchangeRetryWait` duplicated in SD (`:66`). SD's comment (`:48-52`) says the two are held in line by the contract's `exchange` rows. Designed duplicate, one-way check.
- **The rate-limit sentence** ("60/min per token; on a 429 wait `Retry-After`") is restated in about eight places (`agent-api.md`'s Waiting entry, already noted). Unproven credentials are limited per IP, not per token, so "per token" is inexact for them. Draft-6 `RateLimit-*` header names are unpinned.
- **Stale pointer, report-only.** The comment at `lib/dispatch-terminal.js:660` (LIN-4376) cites simple-dispatcher's `DONE_LINE_RE`. That name exists in SD only inside a comment (`links.js:256`) that calls it the old multiline regex; the rule is `doneLineRest` (LIN-4385). No note mentions it. A comment fix, not a finding for a ticket.
- **Catalog reasoning split, noted not filed.** `isReasoningModel` (`lib/openrouter.js:91`), `canReason` (`lib/call-budget.js:81`, test callers only) and `resolveReasoningBudget` (`lib/openrouter.js:116`) split the reasoning rule. `llm-and-prompts.md` already names the split, so no new entry.
- **The `paint()` clone** (census group 311 in run 5) disappeared in the gap `5c63aa26..aec9e16be`; labelled outside the window.
- **SD clone, new in the SD baseline.** `toolResultText` (SD `links.js:272`) and `userEntryText` (SD `transcript.js:103`) are structurally similar. SD's census is a baseline (see Method), so this is not ruled; borderline, report-only.
- **Size-policy compatibility** in `lib/workspace-change-log.js:158` and `lib/workspace-preferences.js:37` keeps old change-log rows readable. Historical, not drift.

## Cross-repo verdicts

- **Runner contract (run 5's mismatch, resolved).** Run 5 measured 38 contract rows in Harbour and 34 in SD's fixture. Both `contract.json` files now have 66 rows and are byte-identical (sha256 `602ab014062857bf…`). Harbour's `CONTRACT_SHA256` tripwire fails on a Harbour edit; nothing on SD reads Harbour, so the check runs one way. Report-only.
- **Broker 429 policy.** Held by contract cases in both repos (see report-only above). Not shared code; two copies, one-way check.
- **Terminal signal triple** (`DONE:` and `[done]`, the report and sentinel rows): designed duplicate, held by the contract's seven report rows and seven sentinel rows.
- **`[working]` beat (row 140).** Unchanged in both repos in the window.
- **Model-family mirror** (CD run 5, R4): unchanged; zero "update both" hits in the window; home LIN-4301 (Backlog).
- **Session-PR pick (row 149).** Harbour's `reportedPrUrlOf` and SD's `sessionPrs` implement the same first-PR-on-newest-report-line rule, joined only by the comment at `lib/dispatch-wake.js:275`. The two readings differ in surface (assistant text only, in SD; any feedback entry, in Harbour) and in fallback order (SD: `gh pr create` results; Harbour: the entry's `url`, then its message). Changing one side moves a user-visible PR link alone. Designed or not is not confirmed. Unlike the broker's 429 duplicate, this one has no contract row or one-way check.
- **Notes guard** (P4): copied, diverged. Starts from Harbour's `lib/prompt-formatters.js`; SD's side is SD's.
- **SD census.** A baseline, not a trend: 61 groups, 27 `mustRule`, 25 tabled, 0 gone (`census-SD-5d8489e-vs-07c88f7a.json`). Not ruled; see report-only.

## Sibling hand-offs (received, ruled, recorded)

- **Seams & Tangles run 10** (`docs/reviews/seams-tangles-review-2026-11-08-run10.md`): `seam:runner-contract` is covered by the cross-repo verdicts above; the limiter-window / broker-cap pair is already a Waiting entry in `agent-api.md`. Not re-flagged.
- **Comprehension-Debt run 5**, R6 (the `[working]` beat, row 140) and R4 (model-family mirror): both checked; unchanged.
- **Stability run 5, Design & Interface run 10, Code Quality**: not re-flagged here; per-module quality belongs to Code Quality and coupling structure to Seams, as the ticket says.

## Method and instrument

- **Census.** `scripts/code-shape/census-review.mjs` in place, scope `--include '^(server\.js$|(lib|routes|public)/.*\.[cm]?js$)'`, one guide passed explicitly with `--areas`.
  - **Reproduction, first.** `census-review.mjs . 5c63aa26 af55cb73 --areas docs/reviews/_evidence-2026-11-06-drift/areas-run5.json` (run 5's guide, blob `642e9405`): equal to run 5's JSON in every field except `areaGuide`, the path label (`census-repro-run5-5c63aa26-vs-af55cb73.json`, sha prefix `1172e9e3`). The instrument is unchanged.
  - **Guide-only check** (old guide against HEAD registry, same baseline): 0 area-label changes and 0 rank changes (`census-guide-only-5c63aa26-vs-af55cb73.json`, `004bc1b3`). The map move is neutral.
  - **HEAD against run 5's commit:** `census-review.mjs . b315e0e8f 5c63aa26 --areas docs/areas/areas.json`: 572 groups, 107 to rule on, 314 tabled, 12 gone (`census-HEAD-vs-5c63aa26.json`, `88597e12`).
  - **HEAD against the window start:** `census-review.mjs . b315e0e8f aec9e16be --areas docs/areas/areas.json`: 572 / 107 / 314, 11 gone (`census-HEAD-vs-window-start.json`, `b0635c31`). The one difference is the gap group.
- **Import walker**, run in place from `docs/reviews/_evidence-2026-11-06-drift/import-walker.mjs` (not copied). At `5c63aa26`, its output is byte-equal to run 5's graph (`67506a83`). At `aec9e16be`: 500 nodes, 2054 static edges (`4df7c047`). At `b315e0e8f`: **512 nodes, 2133 static edges, 2 dynamic** (`49ff7f4d`). SCCs unchanged (6 + 6, the same members), upward 0 / 0, route to route 53, parse failures 0. The biggest new fan-in is `lib/as-asked.js`.
- **SD census.** `census-review.mjs` (the Harbour tool, run on SD) with SD's own registry `docs/areas/areas.json`: 61 groups, 27 `mustRule`, 25 tabled (`census-SD-5d8489e-vs-07c88f7a.json`, `4d792e0c`). SD had no census in run 5, so this is a baseline, not a trend.
- **Rulings.** `rulings-carry-run5.py` (run in place) joins the 107 `mustRule` groups to run 5's rulings on (detector, decision, file set). 93 joined by key; 5 shrunk groups carried by decision text and file overlap (run 5's G0001, G0006, G0078–G0080, mapped in `census-rulings-run6.tsv`); 9 new or grown groups ruled from the sites at `b315e0e8f` (see that table's `basis` column). Joined rulings with a site inside a window hunk were re-read at HEAD, not carried blind (`G0001`, `G0007`, `G0036`, `G0129`, `G0142`, `G0002`); their rulings stand.
- **Touch map.** `touch-map-run5.py` (run in place) over the run-5 citation ledgers (`_evidence-2026-11-05-drift/ledger-11-05.tsv`, `_evidence-2026-11-05-drift-run4/ledger-run4.tsv`), with the window's numstat (`window-numstat-all-run6.tsv`) and the gap's (`gap-numstat-all-run6.tsv`). The map reproduces run 5's touch list exactly when fed run 5's numstat. Run 6: 48 rows (window), 2 rows (gap), with 122 and 131 in both. Rows 136–141 (added in run 5) are not in the citation ledgers, so they were judged from their run-5 text and the code. A row-by-row judgement of the touched rows was made against the window's hunks (`git diff -U0 aec9e16be b315e0e8f`); the result is in `ledger-deltas-run6-touched.tsv`.
- **Ledger.** `ledger-run5.tsv` carries the 141 run-5 rows under their names. Run 6 adds a delta column (`run-6 delta`), a severity column, and a `noted in <slug>.md` column. Mutually exclusive touch counts: **49 rows cite a window-touched file** (47 window-only, 2 also gap-touched), **0 rows cite a gap-only file**, **92 rows cite no touched file**. Run 5's "51 + 3 + 90" double-counted the 2 rows that touch both gap and window; these are the corrected counts.
- **Touch-map scope.** The touch map follows the citations in the ledger, so a window file that no ledger row cites is not checked by it. The second read found one: `lib/dispatch-wake.js` (+126 in the window), which carries row 149. A sweep of the window's files against the decisions the report does not cite was made by hand for the duplicated-decision classes, not mechanically.
- **Carried tickets.** Recheck (Linear, at writing): LIN-4320, 4318, 4302, 4256, 4303, 3828, 4301 are Backlog; LIN-3449 is Todo with 22 comments.
- **Hand-written checks** (at `b315e0e8f`, each cited in its row): `lib/dispatch-leftover.js:26, 29, 46, 105, 113, 141`; `lib/dispatch-targets.js:11-13, 29, 42-47`; `lib/workspace-halt.js:34`; `lib/dispatch-store.js:1906, 3510`; `lib/render.js:223-235` (`HALT_MODES` use); `lib/prompt-formatters.js:600, 604`; `lib/periodicals.js:313`; `lib/prompts/leftover-words.js:24`; `lib/dispatch-entrance.js:1226`; `lib/as-asked.js:296`; `routes/proxy-writes.js:70, 354`; `lib/recommendation-look-first.js:77`; `lib/periodical-runs.js:98`; `lib/size-of-move.js:22`; `public/question-cards.js:241`; `public/prompt-section.js:1055, 1223, 1856`; `public/live-console.js:1361-1367`.
- **What was not done.** The test suites were not run (no code changed). The two sibling reviews' own findings were not re-derived. The gap was read only for the census group and the import edges it changes.

## Notes: pruned and distilled

Every change is listed here with its reason. Nothing was evicted for space that is still true and unticketed.

- **`llm-and-prompts.md` (6073 → 6048 bytes, after the additions below).**
  - *Removed, settled:* "the ceiling history moved into `scripts/prompt-template-change-log.md`". The move is done: that file has a "Ceiling history" section and `tests/unit/prompt-size-budget.test.js` cites it.
  - *Removed, no longer true:* `lib/size-of-move.js` "what counts as code-shaped how is written twice". The proxy's refusal line now reads `SIZE_RECORD_CODES.how` (`lib/proxy-instructions.js`), not a copy of the patterns.
  - *Removed, no longer true:* `lib/prompts/stage-intent.js` "`docs/architecture/prompt-system.md` names the eight deciding stages". The doc no longer names them.
  - *Corrected, untrue clause:* `lib/should-mock-ai.js` said "nothing uses it yet". `dispatch-entrance` and `dispatch-factory` now call `isHermeticTestToken`. The rest of the entry is kept.
  - *Distilled without changing meaning:* the `lib/call-budget.js` replay entry (same procedure, same pass rule); the "prompt words that ban a kind of how" lesson (same claim, shorter).
  - *Added:* P1 (`lib/periodicals.js`, one entry covering P1 to P3) and P4 (`lib/prompt-formatters.js`).
- **`runs-and-dispatch.md` (main's version 6143 bytes → 6143 bytes, cap 6144).** This note was rebased onto main (LIN-4402 had edited it). Added two Waiting entries: the R1 leftover-gate entry and the session-PR pick entry (row 149), plus the `'leftover'` literal in the `pipeline-churn.js` entry. To fit them, distilled eight bullets without changing meaning or dropping a ticket reference: the `_planWake` lesson (the guard list and the census pins kept), "This run's PR" (the `reportLinesOf` and `sessionPrs` cross-references moved into the row-149 entry), the two-`[done]`-posts lesson (the compare-and-set and LIN-4375 kept), the claim-that-skips lesson (the stamp-left-in-place failure kept; the withdrawal detail dropped), the `[pending]` lesson (the LIN-4373 gap kept; "review caught it" dropped), the row-only kinds lesson (the `OFF_SPINE_KINDS` line kept), the store-knows-no-leftovers lesson (the `heldWakeFor` and hook roles kept), the leftover-hook entry (the "no sweep" reasons kept; the "index" and "60 s" detail dropped), and the `releaseHeldWake`, `contract.json`, `cost-read.js`, `GATE_DUE_MARKER` and `dispatch-factory.js` Waiting entries (small wording trims; each ticket reference kept except "(LIN-4360)" on the `GATE_DUE_MARKER` entry, which was dropped). No entry was removed.
- **Rebase note.** The first rebase of this branch onto main conflicted in `runs-and-dispatch.md` and `agent-api.md`, because main's Seams run 11 and other operators edited the same bullets. Both notes were resolved from main's version with this review's entries reapplied, not by line-merge. The `llm-and-prompts.md` merge was clean.
- **`agent-api.md` (2746 → 3245 bytes).** One entry added (A1 and A2) to main's version. No removals; the existing entries were checked and still hold.

## Census rulings (the 107 `mustRule` groups, run-6 reading)

Every `mustRule` group has one ruling. Each row cites the run-5 ruling it carries (or "research" for a group ruled from the sites this run), with its status against run 5 and whether any site falls in a window hunk. Ids are run-6 ids; run-5 ids are beside them.

| rank | id (run 6) | id (run 5) | decision | areas/files/sites | status | window hunk | ruling | reason |
|---|---|---|---|---|---|---|---|---|
| 1 | G0001 | G0001 | repeated comparison NODE_ENV == 'test' | 7/17/43 | unchanged | yes | real | Env read inline 43x; 10 identical limiter skip arrows re-derive test mode. Home: lib/should-mock-ai.js plus one skipInT… |
| 2 | G0002 | G0002 | repeated comparison kind == 'autopilot' | 4/19/31 | unchanged | — | real | Anchor test repeated inline: run-view.js:340 copies findAnchorLoop's test (session-summary.js:53); dispatch-store 573/7… |
| 3 | G0003 | - | record assembled from the same sources {id=ID.id, title=ID.title} | 7/11/17 | new | yes | noise | A new shared home for two mocks (record {id,title} re-keyed from the gone {id,identifier,title}); lib/sample-data/fixtu… |
| 4 | G0004 | G0006 | record assembled from the same sources {deployInfo=getDeployInfo(), u… | 2/13/13 | unchanged | — | real | 13 routes rebuild the same deployInfo/urlKey/openRouterSource/workspaces record with no shared builder. One chrome-opti… |
| 5 | G0005 | G0005 | repeated comparison authType == 'oauth' | 4/8/12 | unchanged | — | real | lib/workspace.js getBindingCallScope |
| 6 | G0006 | - | tiny rule copied as a helper slugifyForFilename() (also: githubSlug, … | 5/10/12 | new | yes | noise | periodical-runs.js:193 is the first home for repo spelling (no exported repo normaliser); the copies are not a shared d… |
| 7 | G0007 | G0008 | repeated comparison kind == 'wake' | 2/10/23 | unchanged | yes | real | runner.mjs repeats the wake-claim test (kind wake, dispatchedBy null, followUpTo) at lines 122, 1012 and 1332; one help… |
| 8 | G0008 | G0006 | repeated comparison accessToken == 'test-token' | 4/6/13 | shrunk | — | real | isTestMode predicate re-inlined; 11-04 adds `lib/key-state-holders.js:48` (`workspace.accessToken === MOCK_ACCESS_TOKEN… |
| 9 | G0009 | G0009 | repeated comparison provider == 'jira' | 2/6/8 | unchanged | — | noise | provider switch at the edge; each branch differs |
| 10 | G0010 | G0010 | repeated comparison status == 'taken' | 1/9/16 | unchanged | — | borderline | Status literal still 16 sites in 9 files; the 5 in `dispatch-lineage-status.js` remain beside `lineage-membership.js:39… |
| 11 | G0011 | G0011 | repeated comparison type == 'started' | 5/7/11 | unchanged | — | real | isInProgress (providers/state-map.js:59) and home-view isStarted exist, yet about 8 sites inline state.type==='started'… |
| 12 | G0012 | G0016 | repeated comparison stopAt == 'pr' | 4/10/15 | unchanged | — | real | Inline stopAt==='pr' at 15 sites; readTaskRunFacts().stopAt is the home, but dispatch-entrance.js:1756 and dispatch-fac… |
| 13 | G0013 | G0012 | repeated comparison scope == 'current' | 3/10/16 | unchanged | — | real | Find-by-(provider,scope) binding lookup is re-written at ~9 sites in 6 files; workspace.js already owns binding lookup … |
| 14 | G0014 | G0017 | text contract marker: [blocked] | 3/7/15 | unchanged | — | borderline | dispatch-terminal — the parse side is the authority; the emit side is the kit |
| 15 | G0015 | G0014 | repeated comparison key == 'Escape' | 1/7/10 | unchanged | — | noise | Each Escape handler closes its own component (queue, search, toggles, selectors, sheet); the literal is the platform ke… |
| 16 | G0016 | G0015 | repeated comparison key == 'Enter' | 1/8/12 | unchanged | — | borderline | Enter/Space activation repeated in 4 handlers; app.js x2 and common.js carry a Spacebar alias. Other Enter sites are se… |
| 17 | G0017 | G0013 | repeated comparison NODE_ENV == 'production' | 3/5/7 | unchanged | — | noise | Environment switch for secure cookies and https redirects; each site sets a different setting. Inert and not a domain d… |
| 18 | G0018 | G0018 | repeated comparison name == 'AbortError' | 4/6/9 | shrunk | — | noise | standard fetch-abort check |
| 19 | G0019 | G0019 | string set {'127.0.0.1', 'localhost'} as array [[...].includes, [...]… | 4/4/8 | unchanged | — | real | isLocalhostRequest in lib/public-origin.js is the home; server.js inlines the same host test 5x and workspace-api-issue… |
| 20 | G0020 | G0020 | repeated comparison provider == 'linear' | 2/4/7 | unchanged | — | borderline | workspace-token-refresh defaultResolveExchange |
| 21 | G0021 | - | string set {'cancelled', 'expired'} as Set/or-chain [NEVER_RAN, ID.hi… | 1/5/6 | new | yes | real | Window-introduced: dispatch-leftover.js:29 NEVER_RAN restates the store status set at dispatch-store.js:1906. Home: exp… |
| 22 | G0022 | G0025 | record assembled from the same sources {code=ID.code, category=ID.cat… | 4/7/8 | unchanged | — | real | lib/errors.js — refusal envelope; `lib/errors.js` is the home |
| 23 | G0023 | G0022 | string set {'Apr', 'Aug', 'Dec', 'Feb', 'Jan', 'Jul', +6} as array [m… | 4/6/7 | unchanged | — | noise | Inert month-abbreviation constants copied across lib and public; values cannot drift in meaning. Harmless duplication. |
| 24 | G0024 | G0023 | text contract marker: [evidence] | 5/6/9 | unchanged | — | real | session-telemetry EVIDENCE_PREFIX |
| 25 | G0025 | G0021 | string set {'github', 'github-projects', 'jira', 'linear', 'local'} a… | 3/4/4 | unchanged | — | borderline | `REGISTRY_PROVIDERS` (`lib/workspace-store.js:4`) restates the provider registry (`providers/registry.js` `getAllProvid… |
| 29 | G0029 | G0035 | tiny rule copied as a helper (anonymous)(), 8 copies of 1-4 statements | 5/6/8 | unchanged | — | real | Mock-issue comment shaping is identical in proxy-compute.js:116, task-chat.js:69 and workspace-api-mocks.js:218. Home: … |
| 31 | G0031 | G0029 | repeated comparison harness == 'claude-code' | 4/5/8 | unchanged | — | borderline | harness == 'claude-code' special case repeats at 8 sites in 5 files (curated list, model mapping, catalog guard, label … |
| 32 | G0032 | G0028 | repeated comparison type == 'blocks' | 3/10/12 | unchanged | — | noise | Linear relation literal at 12 sites, each reading a different field for a different purpose; one external enum meaning. |
| 33 | G0033 | G0030 | record assembled from the same sources {token=ID.token, expiresAt=ID.… | 3/3/9 | unchanged | — | borderline | server.js resolver — cache tuple; follows the credential row, no separate decision |
| 34 | G0034 | G0031 | repeated comparison enabled == 'true' | 3/3/3 | unchanged | — | noise | Same one-line boolean parse in a user-level session toggle (server.js) and a workspace-level settings route (routes/set… |
| 35 | G0035 | G0036 | repeated comparison status == 'owner' | 4/8/8 | unchanged | — | borderline | Seven consumers switch on the one answer from readOwnerSeamStatus in lib/workspace-owner.js. The home exists; only the … |
| 36 | G0036 | G0037 | repeated comparison recommendedAction == 'defer' | 3/4/6 | unchanged | yes | borderline | recommend-recurse |
| 38 | G0038 | G0032 | repeated comparison kind == 'recent' | 3/3/3 | unchanged | — | noise | 'recent' is a collective-characters doc kind at one site and a home-row kind at two others; different kind spaces, no s… |
| 39 | G0039 | - | text contract marker: [done] | 4/5/7 | grown | yes | noise | Grown (was run-5 G0099, borderline). New sites are the parse authority REPORT_LINE_RE (dispatch-terminal.js:663) and pr… |
| 40 | G0040 | G0038 | repeated comparison status == 'ready' | 3/5/7 | unchanged | — | noise | 'ready' names different enums: close-out status in task-page-loader, close-out.js and session.js versus prompt aiState.… |
| 41 | G0041 | G0039 | repeated comparison code == 'OWNER_CHECK_UNAVAILABLE' | 3/5/5 | unchanged | — | borderline | proxy-preamble — sentinel string shared by two modules; follows the credential row |
| 43 | G0043 | - | repeated comparison kind == 'custom' | 3/4/5 | grown | yes | noise | Grown by a store site. Codebase idiom: the custom-kind guard answers a different question at each site (dispatch-store.… |
| 44 | G0044 | G0040 | repeated comparison type == 'completed' | 5/8/10 | unchanged | — | noise | Literal is deliberate in follow-on-ratio.js and ship-journey.js (documented as not isCompleted/isTerminalState); roadma… |
| 46 | G0046 | G0041 | string set {'effort', 'harness', 'model'} as table-keys/array [FIELD_… | 4/5/5 | unchanged | — | real | model/harness/effort restated at 5 sites; model-routing.js FIELDS.AGENT_SESSION already declares them. dispatch-validat… |
| 47 | G0047 | - | string set {'pause', 'stop'} as or-chain/table-keys/array [ID.mode, H… | 3/5/5 | new | yes | real | Window-introduced: dispatch-leftover.js:113 restates the halt modes beside HALT_MODES (lib/workspace-halt.js:34). Home:… |
| 49 | G0049 | G0051 | text contract marker: [failed] | 3/4/17 | unchanged | — | borderline | dispatch-terminal parses / kit emits |
| 50 | G0050 | G0049 | tiny rule copied as a helper hashKey() (also: hashEmailRecipient, has… | 4/9/11 | unchanged | — | noise | hash helpers, identical by design; now also `account-erasure.js:231` |
| 52 | G0052 | G0050 | tiny rule copied as a helper (anonymous)() (also: brief), 3 copies of… | 3/3/3 | unchanged | — | noise | new only because LIN-3596 moved the mocks; same shape |
| 57 | G0057 | G0076 | record assembled from the same sources {id=ID.id, body=ID.body, creat… | 4/5/7 | unchanged | — | noise | comment record, three fields |
| 62 | G0062 | G0068 | repeated comparison turnKind == 'user-initiated' | 4/5/25 | unchanged | — | borderline | lib/agent-turn.js |
| 76 | G0076 | G0075 | repeated comparison state == 'running' | 3/5/22 | unchanged | — | borderline | 22 sites in 5 files mix stage, ledger-row and session state spaces; runner.mjs re-tests row 'running' ~10 times with no… |
| 80 | G0080 | G0077 | repeated comparison stateType == 'started' | 3/10/19 | unchanged | — | real | Task-or-subtask in-progress test copied in render-roadmap.js:86, roadmap-digest-template.js:103 and roadmap-narrative-t… |
| 82 | G0082 | G0082 | repeated comparison agentState == 'error' | 3/4/5 | unchanged | — | noise | Error reads map to different outputs (failed status in task-page-loader, summary text in dashboard-summaries). Not the … |
| 92 | G0092 | G0088 | repeated comparison state == 'done' | 3/4/5 | unchanged | — | noise | Stage tone, ledger row, task-state settle and ticket markers are four different state machines that share the word; no … |
| 93 | G0093 | - | repeated comparison kind == 'implementation' | 3/6/7 | grown | yes | noise | Grown by dispatch-leftover.js:61, which is the body of isStageBuild, a new predicate of its own, not a second copy of a… |
| 95 | G0095 | G0092 | string set {'merged', 'partial'} as or-chain/Set [ID.closeOut.status,… | 3/4/5 | unchanged | — | real | `lib/run-closeout-state.js` (owns `PARTIAL`/`MERGED`); export an `isMerged` predicate |
| 97 | G0097 | G0095 | string set {'assistant', 'user'} as or-chain/if-chain [ID.role] | 4/6/6 | unchanged | — | borderline | lib/chat-transcript.js filterChatTurns (bypassed ×3) — role filter; `filterChatTurns` is bypassed three times (LIN-2430… |
| 98 | G0098 | G0093 | repeated comparison type == 'text' | 3/3/5 | unchanged | — | noise | Three sites are ADF node types, one a Claude content block, one a DOM input type; different type namespaces that share … |
| 102 | G0102 | G0078 | text contract heading: changelog | 3/3/3 | shrunk | — | real | `lib/workspace-api-mocks.js` `buildMockBrief` (headings as a contract) |
| 103 | G0103 | G0079 | text contract heading: constraints | 3/3/3 | shrunk | — | real | as G0088 |
| 104 | G0104 | G0080 | text contract heading: open questions | 3/3/3 | shrunk | — | real | as G0088 |
| 108 | G0108 | G0106 | string set {'number', 'string'} as or-chain [typeofID] | 3/3/3 | unchanged | — | noise | isScalar, the brief's date coercion and toEpochMs share a typeof idiom but answer different questions; no drifting rule. |
| 110 | G0110 | G0103 | repeated comparison state == 'waiting' | 3/4/8 | unchanged | — | borderline | 'waiting' compared inline at 8 sites; UNENDED_STATES now lives in lib/task-state.js:28 (running, queued, waiting). Rout… |
| 111 | G0111 | G0102 | named constant MONTHS=[Apr,Aug,Dec,Feb,Jan,Jul,Jun,Mar,May,Nov,Oct,Se… | 3/3/3 | unchanged | — | borderline | Identical 12-entry month table in home-view, render and task-page-loader; lib/utils/time.js already holds date helpers.… |
| 114 | G0114 | - | repeated comparison status == 'error' | 3/3/5 | grown | yes | noise | Grown by dispatch-factory.js:1074-1075, a local settleWithin shape; no shared home for a write status check. |
| 125 | G0125 | G0135 | tiny rule copied as a helper (anonymous)(), 9 copies of 1-4 statements | 3/9/9 | unchanged | — | noise | Nine stream-event callbacks, each a distinct consumer; the shared body is one token append. Not one decision to home. |
| 127 | G0127 | G0116 | tiny rule copied as a helper escapeHtml() (also: escapeXml), 3 copies… | 3/3/3 | unchanged | — | noise | escape helpers per output format |
| 129 | G0129 | G0115 | repeated comparison provider == 'local' | 4/4/4 | unchanged | yes | borderline | Four different uses, but workspace-api-audit.js:36 re-inlines shouldMockAi's test-plus-local predicate despite its comm… |
| 133 | G0133 | G0123 | repeated comparison disposition == 'task-bound' | 3/3/7 | unchanged | — | borderline | Server disposition enum; observation.js branches on it 5 times with different actions. Only the deliverRulingStampOnly … |
| 134 | G0134 | G0151 | near-duplicate function buildMockRecapContext() (also: buildMockRecap… | 3/3/3 | unchanged | — | real | `lib/workspace-api-mocks.js` `buildMockRecapContext` |
| 135 | G0135 | G0152 | tiny rule copied as a helper (anonymous)(), 3 copies of 1-4 statements | 3/3/3 | unchanged | — | real | Same mock child shaping in workspace-api-mocks.js:211, proxy-compute.js:122 and task-chat.js:75; home buildMockRecapCon… |
| 140 | G0140 | G0126 | named constant UUID_REGEX=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a… | 3/3/3 | unchanged | — | borderline | lib/workspace.js; `UUID_REGEX` copies 6 → 3 |
| 142 | G0142 | G0139 | string set {'queued', 'running'} as or-chain [ID.state, ID.outcome] | 3/4/5 | unchanged | yes | real | running//queued test is inline at home-view:59, render-task-page:245/283, task-state:143 and recent-runs:82; task-state… |
| 144 | G0144 | G0136 | repeated comparison state == 'failed' | 3/4/7 | unchanged | — | borderline | `state == 'failed'` in task-state.js roll-ups and attention (`:144,:168,:275,:345`) and in home-view / task-board count… |
| 145 | G0145 | G0125 | string set {'0', '1', '2', '3', '4'} as table-keys [PRIORITY_WORDS, F… | 4/6/8 | unchanged | — | real | Priority number-to-name map re-declared at 6+ sites (home-view, local provider, swim x2, swipe, roadmap template); rend… |
| 152 | G0152 | G0146 | named constant SWEEP_INSTANCE_PREFIX="sweep:v1:" | 3/3/3 | unchanged | — | real | `lib/observer-sweep.js` (the writer; uses an inline literal at :449) |
| 153 | G0153 | G0140 | repeated comparison status == 'done' | 3/3/5 | unchanged | — | noise | done status literal; unrelated meanings |
| 155 | G0155 | G0154 | repeated comparison phase == 'result' | 3/3/3 | unchanged | — | noise | phase literal in one module |
| 166 | G0166 | G0157 | repeated comparison category == 'auth' | 4/4/4 | unchanged | — | noise | Three sites read a classification they already hold; isAuthError exists for bare errors. Trivial token comparison, no d… |
| 167 | G0167 | - | repeated comparison name == 'linear' | 3/3/3 | grown | yes | borderline | Grown; the test-only transport (dispatch-factory.js:948) is already a runs-and-dispatch Waiting entry (John, 7 Nov). |
| 168 | G0168 | G0168 | repeated comparison state == 'needs-you' | 3/3/6 | unchanged | — | real | needsAPerson(state) already exists in task-state.js, yet task-state.js:275 inlines 'needs-you // failed' instead of cal… |
| 169 | G0169 | G0169 | repeated comparison state == 'queued' | 3/3/7 | unchanged | — | noise | Queued checks are per-site labels, tones, selection and mapping; the shared in-flight test is G0148, so this is not a s… |
| 170 | G0170 | G0170 | repeated comparison waitingFor == 'ruling' | 3/3/7 | unchanged | — | borderline | task-page-loader tests model.waitingFor==='ruling' at 938, 991, 1017, 1471 though 991 derives waitingOnRuling once; one… |
| 175 | G0175 | G0166 | tiny rule copied as a helper stripCodeFence() (also: trimToNull, pars… | 4/4/6 | unchanged | — | noise | small parse helpers, coincidental similarity |
| 180 | G0180 | G0171 | tiny rule copied as a helper _issueRef() (also: refOf, projectNeighbo… | 3/3/3 | unchanged | — | noise | Three ref projections returning different fields under different names. Not one decision. |
| 185 | G0185 | G0177 | tiny rule copied as a helper constructor(), 5 copies of 1-4 statements | 3/5/5 | unchanged | — | noise | store constructors — reused from 10-18 G0149 (lead matched G0359, a groupKey twin) |
| 188 | G0188 | G0198 | string set {'standard', 'stepper'} as array/ternary-chain [AUTOPILOT_… | 3/3/3 | unchanged | — | borderline | `lib/prompts/autopilot-kickoff.js` `AUTOPILOT_VARIANTS` — `AUTOPILOT_VARIANTS` already exists; callers should import it |
| 192 | G0192 | G0216 | repeated comparison variant == 'stepper' | 3/3/3 | unchanged | — | noise | Three local reads of a variant literal; the allowed-variant validator is elsewhere. Each read is local. |
| 196 | G0196 | G0183 | tiny rule copied as a helper normalizePrivateKey() (also: cleanClaim,… | 3/3/3 | unchanged | — | noise | string cleanup helpers, coincidental |
| 221 | G0221 | G0239 | text contract marker: [ticket-closer] | 3/4/4 | unchanged | — | borderline | Tag hardcoded in three route catch logs while ticket-close-closer.js owns a LOG const. A console prefix, not a posted m… |
| 233 | G0233 | G0220 | string set {'backlog', 'canceled', 'completed', 'duplicate', 'started… | 3/5/11 | unchanged | — | real | `lib/providers/state-map.js` `getStateDisplay`/`getStateOrder` |
| 234 | G0234 | G0221 | repeated comparison state == 'parked' | 3/3/3 | unchanged | — | noise | Three sites: a text line, a task-state switch to 'waiting', and one evidence check on the same field; per-site, no shar… |
| 245 | G0245 | G0230 | repeated comparison outcome == 'self-resolved' | 3/4/7 | unchanged | — | noise | Machine-stamped outcome with one producer (ticket-close-closer.js); readers apply the same bucket. Not a duplicated dec… |
| 252 | G0252 | G0250 | string set {'backlog', 'started', 'unstarted'} as switch/array/table-… | 3/4/4 | unchanged | — | borderline | `lib/providers/state-map.js` (`isTerminalState`, `getStateOrder`) — state rank sets; covered by state-type-label-rank-m… |
| 262 | G0262 | G0249 | near-duplicate function find() (also: componentFind), ~9 statements, … | 3/4/4 | unchanged | — | noise | union-find helper, generic |
| 267 | G0267 | G0251 | named constant UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]… | 3/3/3 | unchanged | — | noise | (`lib/workspace.js` `UUID_REGEX` exists) |
| 281 | G0281 | G0286 | tiny rule copied as a helper (anonymous)() (also: loadLoops), 3 copie… | 3/3/3 | unchanged | — | borderline | The 13 calls already route through getLoopsForWorkspace; the duplicated part is the deps bundle plus lean:true in three… |
| 297 | G0297 | G0277 | repeated comparison kind == 'evidence' | 3/3/3 | unchanged | — | noise | feedback kind literal |
| 302 | G0302 | G0331 | text contract marker: [close-out-merges] | 3/3/3 | unchanged | — | noise | Log-prefix literal repeated in two route catches while lib/close-out-merges.js keeps its own LOG; inert console tag, no… |
| 308 | G0308 | G0339 | string set {'backlog', 'unstarted'} as array/or-chain [stateTypes, ID… | 3/3/3 | unchanged | — | real | Ready set is queue-config stateTypes, re-inlined in recommendation-facts.js:201 and workspace-api-mocks.js:68. The isRe… |
| 315 | G0315 | G0320 | repeated comparison harness == 'opencode' | 3/4/4 | unchanged | — | noise | Four opencode checks are separate rules (option list, web-target refusal, model-id shape, running-total usage) that sha… |
| 352 | G0352 | G0361 | repeated comparison verdict == 'credential_dead' | 3/3/3 | unchanged | — | real | Server sites use exported CREDENTIAL_DEAD_VERDICT, but public/proxy.js:256 hardcodes 'credential_dead'. A rename would … |
| 379 | G0379 | G0403 | repeated comparison setting == 'halt' | 3/3/4 | shrunk | — | real | Owner-only halt undo gate repeats at render-settings-workspace:49 and :215 while the route enforces it via haltRefusal;… |
| 390 | G0390 | G0433 | tiny rule copied as a helper constructor(), 5 copies of 1-4 statements | 3/5/5 | unchanged | — | noise | Five cache and store constructors with different option sets and no shared base; a constructor signature is not a rule. |
| 391 | G0391 | G0376 | string set {'Deep Dive', 'Front Page', 'The Column', 'The Wire', 'Wea… | 3/4/4 | unchanged | — | real | `lib/ship-biscuit.js` `DESKS` (exported) |
| 397 | G0397 | G0416 | near-duplicate function stableStringify(), ~7 statements, same vocabu… | 3/3/3 | unchanged | — | real | one export of `stableStringify` in `lib/recap-cache.js` or a leaf module (LIN-3736 already proposes `lib/utils/`); 3 co… |
| 413 | G0413 | G0405 | string set {'no-owner', 'not-owner', 'owner', 'unavailable'} as array… | 3/3/4 | unchanged | — | real | owner/not-owner/no-owner/unavailable validated in workspace-owner, exported as RUNNER_SETUP_STATES in render-runner-set… |
| 425 | G0425 | G0387 | named constant MS_PER_DAY=86400000 | 3/3/3 | unchanged | — | noise | `MS_PER_DAY` constant, inert |
| 444 | G0444 | G0429 | tiny rule copied as a helper cleanup(), 3 copies of 1-4 statements | 3/3/3 | unchanged | — | noise | `cleanup()` per store |
| 486 | G0486 | G0473 | tiny rule copied as a helper stableById() (also: byWorkspaceId), 3 co… | 3/3/3 | unchanged | — | noise | sort comparators |
| 495 | G0495 | G0479 | repeated comparison stateType == 'backlog' | 3/3/3 | unchanged | — | borderline | keepCard backlog rule is copied into public/ship.js:166 from lib/ship-layout.js:353; ship.js header says the inlining i… |
| 524 | G0524 | G0512 | string set {'E', 'N', 'NE', 'NW', 'S', 'SE', +2} as array/table-keys … | 3/3/5 | unchanged | — | noise | (`lib/ship-layout.js` `BEARINGS` exists) |

**Summary.** 34 real, 27 borderline, 46 noise. Run 5 had 34 / 29 / 42. The movement comes from the 14 groups that are new, grown, shrunk or re-keyed: the two new real groups (21, 47) are offset by the real groups that shrank and were carried, the grown `[done]` marker (run 5's borderline G0099) became noise on its parse-side site, and the new record, slug and `status == 'error'` groups are noise. The counts above are recounted from the table.

## Census table groups (314; no ruling, per the method)

The 314 table groups are listed with their detector, decision, `areas/files/sites` and status in `docs/reviews/_evidence-2026-11-10-drift/census-table-groups-run6.tsv`, following run 5's pattern of keeping the list as evidence. By method they carry no ruling. Nothing in them is discussed in prose, because none is a finding in this run.

## Compact trend ledger

Every carried row (141, with its run-5 name) and the eight new rows (142 to 149). Severity is run 5's unless the row is new or changed. "Noted in" names the area note that holds the row's entry, if one exists; `—` means the row is report-only or ticket-held.

| row | finding | severity | run-6 delta | noted in |
|---|---|---|---|---|
| 1 | `lib-import-cycles` | low-medium | unchanged (no cited file touched in aec9e16be..b315e0e8f) | — |
| 2 | `provider-auth-router-upward-imports` | resolved | unchanged (touched: server.js; cited decision not in a window hunk) | — |
| 3 | `routes-error-envelope-fragmentation` | low-medium | unchanged (no cited file touched in aec9e16be..b315e0e8f) | — |
| 4 | `production-to-test-fixture-imports` | resolved | resolved (held; no cited file touched in the window) | — |
| 5 | `periodical-report-filename-convention-split` | medium-low | unchanged (no cited file touched in aec9e16be..b315e0e8f) | — |
| 6 | `dispatch-kind-vocabulary-cross-repo` | low | changed: new row-only kind list ROW_ONLY_KINDS (lib/dispatch-fields.js:188) adds 'leftover' beside 'wake' | — |
| 7 | `provider-resolution-incantation` | low | unchanged (no cited file touched in aec9e16be..b315e0e8f) | — |
| 8 | `ui-divergences-registry-staleness` | low | unchanged (no cited file touched in aec9e16be..b315e0e8f) | — |
| 9 | `simple-dispatcher-api-base-duplication` | low | unchanged (false hit: server.js matched by basename only) | — |
| 10 | `cross-repo-halt-vocabulary` | low-medium (sub-row) | unchanged (no cited file touched in aec9e16be..b315e0e8f) | — |
| 11 | `cross-repo-sentinel-decision-marker-vocabulary` | medium | unchanged (no cited file touched in aec9e16be..b315e0e8f) | — |
| 12 | `target-vocabulary` | low | unchanged (touched: lib/dispatch-store.js, routes/dispatch.js, server.js; cited decision not in a window hunk) | — |
| 13 | `sse-frame-writer-duplication` | resolved | resolved (held; no cited file touched in the window) | — |
| 14 | `routes-proxy-decomposition` | — | unchanged (no cited file touched in aec9e16be..b315e0e8f) | — |
| 15 | `cross-repo-repo-list` | low | unchanged (no cited file touched in aec9e16be..b315e0e8f) | — |
| 16 | `ci-convention-split-across-repos` | informational | unchanged (no cited file touched in aec9e16be..b315e0e8f) | — |
| 17 | `semicolon-style-split` | low | unchanged (touched: server.js, public/flight-companion.js; cited decision not in a window hunk) | — |
| 18 | `client-escape-html-duplication` | — | unchanged (no cited file touched in aec9e16be..b315e0e8f) | — |
| 19 | `client-shared-helper-duplication` | — | unchanged (false hit: server.js matched by basename only) | — |
| 20 | `client-section-fetch-idiom-duplication` | — | unchanged (no cited file touched in aec9e16be..b315e0e8f) | — |
| 21 | `linear-cli-parallel-graphql-surface` | — | unchanged (touched: server.js; cited decision not in a window hunk) | — |
| 22 | `store-module-uniformity` | — | unchanged (no cited file touched in aec9e16be..b315e0e8f) | — |
| 23 | `server-side-escaping` | — | unchanged (touched: server.js; cited decision not in a window hunk) | — |
| 24 | `dispatch-payload-centralization` | — | unchanged (touched: routes/dispatch.js; cited decision not in a window hunk) | — |
| 25 | `renderer-provider-abstraction` | — | unchanged (no cited file touched in aec9e16be..b315e0e8f) | — |
| 26 | `cache-module-family` | low | unchanged (no cited file touched in aec9e16be..b315e0e8f) | — |
| 27 | `lib-components-primitive-adoption` | — | unchanged (no cited file touched in aec9e16be..b315e0e8f) | — |
| 28 | `state-store-write-seam` | — | unchanged (no cited file touched in aec9e16be..b315e0e8f) | — |
| 29 | `phase-vocabulary-centralization` | low | unchanged (no cited file touched in aec9e16be..b315e0e8f) | — |
| 30 | `target-harness-axis-orthogonality` | — | unchanged (touched: routes/dispatch.js; cited decision not in a window hunk) | — |
| 31 | `test-seam-separation` | — | unchanged (no cited file touched in aec9e16be..b315e0e8f) | — |
| 32 | `css-token-layer` | — | unchanged (no cited file touched in aec9e16be..b315e0e8f) | — |
| 33 | `runner-contract-semantics-cross-repo` | medium | unchanged (no cited file touched in aec9e16be..b315e0e8f) | — |
| 34 | `connection-binding-predicate-drift` | low-medium | unchanged (no cited file touched in aec9e16be..b315e0e8f) | — |
| 35 | `run-page-identity-scrape` | medium | unchanged (no cited file touched in aec9e16be..b315e0e8f) | — |
| 36 | `dispatch-entrance-field-duplication` | low | unchanged (touched: routes/dispatch.js, routes/proxy-compute.js, server.js; cited decision not in a window hunk) | — |
| 37 | `owner-word-collision` | low | unchanged (touched: lib/run-view.js; cited decision not in a window hunk) | — |
| 38 | `run-family-render-primitives` | low | unchanged (no cited file touched in aec9e16be..b315e0e8f) | — |
| 39 | `persist-binding-sibling-seams` | low | unchanged (no cited file touched in aec9e16be..b315e0e8f) | — |
| 40 | `server-formatter-duplication` | low | unchanged (touched: lib/effort-readout.js, server.js; cited decision not in a window hunk) | — |
| 41 | `wake-marker-regex-copies` | resolved | resolved (held; no cited file touched in the window) | — |
| 42 | `runner-liveness-assumption` | low | unchanged (no cited file touched in aec9e16be..b315e0e8f) | — |
| 43 | `workspace-urlkey-consolidation` | — | unchanged (no cited file touched in aec9e16be..b315e0e8f) | — |
| 44 | `credential-decision-multiplicity` | medium-high | unchanged (touched: routes/settings.js; cited decision not in a window hunk) | — |
| 45 | `keepalive-error-envelope-writer` | resolved | resolved (held; no cited file touched in the window) | — |
| 46 | `html-error-page-two-writers` | resolved | resolved (held; no cited file touched in the window) | — |
| 47 | `ai-availability-gate-duplication` | medium-low | improved: one fewer inline test-token literal (plain count in lib, routes, public: 27 at aec9e16be, 26 at b315e0e8f); one site now calls isHermeticTestToken (lib/should-mock-ai.js:28). The agent census-pattern count was 34 to 33. | — |
| 48 | `dispatch-refusal-relay-duplication` | resolved | resolved (held; no cited file touched in the window) | — |
| 49 | `tolerant-date-parse-date-twins` | resolved | resolved (held; no cited file touched in the window) | — |
| 50 | `timestamp-parse-consolidation` | — | unchanged (no cited file touched in aec9e16be..b315e0e8f) | — |
| 51 | `loose-json-consolidation` | — | unchanged (no cited file touched in aec9e16be..b315e0e8f) | — |
| 52 | `ai-mock-predicate-consolidation` | — | unchanged (no cited file touched in aec9e16be..b315e0e8f) | — |
| 53 | `batch-guard-residue` | informational | unchanged (no cited file touched in aec9e16be..b315e0e8f) | — |
| 54 | `decision-dialect-split` | medium (sub-row) | unchanged (no cited file touched in aec9e16be..b315e0e8f) | — |
| 55 | `human-wait-derivation-split` | low-medium | unchanged (touched: lib/run-view.js, lib/task-page-loader.js, routes/dispatch.js; cited decision not in a window hunk) | — |
| 56 | `decision-stamp-classifier-copies` | low-medium | unchanged (touched: lib/session-telemetry.js; cited decision not in a window hunk) | — |
| 57 | `provider-write-field-contract` | low-medium | unchanged (no cited file touched in aec9e16be..b315e0e8f) | — |
| 58 | `close-out-merged-refusal-split` | low-medium | unchanged (touched: routes/dispatch.js; cited decision not in a window hunk) | — |
| 59 | `periodic-loop-two-mechanisms` | informational | unchanged (touched: server.js; cited decision not in a window hunk) | — |
| 60 | `consumer-liveness-signal-conflation` | resolved | resolved (held; no cited file touched in the window) | — |
| 61 | `consumer-heartbeat-wire-restated` | low-medium (sub-row of 60) | unchanged (touched: routes/dispatch.js; cited decision not in a window hunk) | — |
| 62 | `owner-answer-reader-copies` | low | unchanged (no cited file touched in aec9e16be..b315e0e8f) | — |
| 63 | `mock-ai-builder-copies` | low-medium | improved: buildMockBriefFromContext removed (its 36-line copy gone); both route calls use shared buildMockBrief (routes/proxy-compute.js:1488, :1616; lib/workspace-api-mocks.js) | — |
| 64 | `fresh-run-definition-copies` | low-medium | worsened: one more run-existence predicate hasDispatchForIssue (lib/dispatch-store.js:2315), beside findRecentFreshDispatch and isFreshDispatch; no shared home | — |
| 65 | `terminal-loop-rule-copies` | low-medium | unchanged (touched: server.js; cited decision not in a window hunk) | — |
| 66 | `state-type-label-rank-maps` | low-medium | unchanged (touched: server.js; cited decision not in a window hunk) | — |
| 67 | `csp-decision-split` | resolved | resolved (held; no cited file touched in the window) | — |
| 68 | `priority-label-maps` | low | unchanged (no cited file touched in aec9e16be..b315e0e8f) | — |
| 69 | `localhost-predicate-split` | low | unchanged (touched: routes/dispatch.js, server.js; cited decision not in a window hunk) | — |
| 70 | `observer-instance-key-copies` | low | unchanged (no cited file touched in aec9e16be..b315e0e8f) | — |
| 71 | `pilot-eligibility-copies` | low | unchanged (touched: lib/effort-readout.js, routes/dispatch.js; cited decision not in a window hunk) | — |
| 72 | `linear-image-host-allowlist` | low | unchanged (no cited file touched in aec9e16be..b315e0e8f) | — |
| 73 | `page-chrome-options` | low | unchanged (no cited file touched in aec9e16be..b315e0e8f) | — |
| 74 | `ship-biscuit-desk-list` | low | unchanged (no cited file touched in aec9e16be..b315e0e8f) | — |
| 75 | `free-tier-rule-copies` | resolved | resolved (held; no cited file touched in the window) | — |
| 76 | `sd-blocked-child-last-activity-split` | low | unchanged (no cited file touched in aec9e16be..b315e0e8f) | — |
| 77 | `census-gone-overstates-resolution` | informational | unchanged (no cited file touched in aec9e16be..b315e0e8f) | — |
| 78 | `follow-up-target-rule-copies` | resolved | resolved (held; no cited file touched in the window) | — |
| 79 | `lineage-row-read-copies` | low | unchanged (no cited file touched in aec9e16be..b315e0e8f) | — |
| 80 | `pr-url-regex-copies` | low | unchanged (no cited file touched in aec9e16be..b315e0e8f) | — |
| 81 | `pause-marker-predicate-gap` | low | worsened: inline marker-keyed pending predicates 7 to 11 in lib, routes, server.js; new sites lib/dispatch-leftover-hook.js:125,130,160 and lib/dispatch-store.js:3504 | — |
| 82 | `review-on-record-readers` | low | unchanged (no cited file touched in aec9e16be..b315e0e8f) | — |
| 83 | `credential-block-grammar-split` | low | unchanged (no cited file touched in aec9e16be..b315e0e8f) | — |
| 84 | `review-loop-ceiling-restated` | low | unchanged (no cited file touched in aec9e16be..b315e0e8f) | — |
| 85 | `sweep-as-library-imports` | low | unchanged (no cited file touched in aec9e16be..b315e0e8f) | — |
| 86 | `github-envelope-walker-split` | low | unchanged (no cited file touched in aec9e16be..b315e0e8f) | — |
| 87 | `binding-active-answer-copies` | low-medium (sub-row of 44) | unchanged (touched: server.js; cited decision not in a window hunk) | — |
| 88 | `auth-failure-answer-copies` | low-medium | unchanged (touched: routes/dispatch.js; cited decision not in a window hunk) | — |
| 89 | `account-group-reader-copies` | low | unchanged (no cited file touched in aec9e16be..b315e0e8f) | — |
| 90 | `stable-stringify-copies` | low | unchanged (no cited file touched in aec9e16be..b315e0e8f) | — |
| 91 | `kpi-page-twin-copies` | low-medium | unchanged (no cited file touched in aec9e16be..b315e0e8f) | — |
| 92 | `kit-terminal-status-copy` | low | unchanged (touched: routes/dispatch.js; cited decision not in a window hunk) | — |
| 93 | `sd-parked-predicate-inline` | low | unchanged (no cited file touched in aec9e16be..b315e0e8f) | — |
| 94 | `https-predicate-restated` | low | unchanged (touched: server.js; cited decision not in a window hunk) | — |
| 95 | `harbour-token-format-restated` | — | unchanged (no cited file touched in aec9e16be..b315e0e8f) | — |
| 96 | `registry-providers-restated` | low (sub-row of 44) | unchanged (no cited file touched in aec9e16be..b315e0e8f) | — |
| 97 | `sd-401-layers-three` | low | unchanged (no cited file touched in aec9e16be..b315e0e8f) | — |
| 98 | `expire-ownerless-has-owner-copy` | low | unchanged (touched: routes/dispatch.js; cited decision not in a window hunk) | — |
| 99 | `vendor-script-list-restated` | low | unchanged (no cited file touched in aec9e16be..b315e0e8f) | — |
| 100 | `prune-to-capacity-clones` | low | unchanged (no cited file touched in aec9e16be..b315e0e8f) | — |
| 101 | `resume-model-effort-cross-repo` | medium-high | unchanged (touched: routes/dispatch.js, lib/dispatch-factory.js, lib/follow-up-dispatch.js; cited decision not in a window hunk) | — |
| 102 | `halt-word-map-copies` | medium | unchanged (touched: lib/workspace-change-log.js; cited decision not in a window hunk) | — |
| 103 | `home-next-answer-split` | medium | unchanged (no cited file touched in aec9e16be..b315e0e8f) | — |
| 104 | `coherence-loop-stalled` | medium (process) | unchanged: process row; LIN-3449 still Todo (22 comments); this run mints no child | — |
| 105 | `settings-run-setup-rebuilt` | low-medium | unchanged (touched: routes/settings.js; cited decision not in a window hunk) | — |
| 106 | `settings-preset-systems` | low-medium | unchanged (touched: routes/dispatch.js, routes/settings.js; cited decision not in a window hunk) | — |
| 107 | `routes-as-library` | low-medium | unchanged (no cited file touched in aec9e16be..b315e0e8f) | — |
| 108 | `model-vocabulary-rule-copies` | low-medium | unchanged (no cited file touched in aec9e16be..b315e0e8f) | — |
| 109 | `task-page-state-outside-owner` | low-medium | unchanged (no cited file touched in aec9e16be..b315e0e8f) | — |
| 110 | `live-anchor-old-home-alive` | low-medium | unchanged (touched: routes/proxy-rulings.js; cited decision not in a window hunk) | agent-api |
| 111 | `lineage-anchor-rules-three` | low-medium | unchanged (touched: lib/dispatch-store.js, routes/dispatch.js; cited decision not in a window hunk) | — |
| 112 | `model-constants-server-client-twins` | resolved | resolved (held; no cited file touched in the window) | — |
| 113 | `low-rows-unpromoted` | low | unchanged (touched: lib/task-page-loader.js; cited decision not in a window hunk) | — |
| 114 | `halt-poll-cold-cache-fail-open` | medium (conditional) | unchanged: John's ruling, not chosen here | — |
| 115 | `usage-relay-flag-partial` | resolved | resolved (held; no cited file touched in the window) | — |
| 116 | `usage-record-vocabulary-two-readers` | low-medium | unchanged (no cited file touched in aec9e16be..b315e0e8f) | — |
| 117 | `lineage-identity-read-twins` | resolved | unchanged (touched: lib/dispatch-store.js; cited decision not in a window hunk) | — |
| 118 | `reap-window-constant-cross-repo` | low-medium | unchanged (no cited file touched in aec9e16be..b315e0e8f) | — |
| 119 | `cost-fold-partition-restated` | resolved | resolved (held; no cited file touched in the window) | — |
| 120 | `key-state-residue` | informational | unchanged (no cited file touched in aec9e16be..b315e0e8f) | — |
| 121 | `unit-census-convention-split` | informational | unchanged (no cited file touched in aec9e16be..b315e0e8f) | — |
| 122 | `usage-snapshot-prose-residue` | low | unchanged (touched: docs/architecture/source-map.md, lib/proxy-instructions.js, docs/proxy-integration.md, lib/effort-readout.js; prose sites outside hunks) | — |
| 123 | `completeness-precedence-restated` | borderline (not graded) | unchanged (no cited file touched in aec9e16be..b315e0e8f) | — |
| 124 | `erasure-inventory-lockstep-gap` | resolved | unchanged (touched: server.js; cited decision not in a window hunk) | — |
| 125 | `parked-wait-text-cross-repo` | low-medium | unchanged (touched: lib/session-telemetry.js; cited decision not in a window hunk) | — |
| 126 | `error-code-case-split` | low | unchanged (no cited file touched in aec9e16be..b315e0e8f) | — |
| 127 | `ruling-settled-row-predicate-inline` | low | unchanged (touched: routes/workspace-api-issue-write.js; cited decision not in a window hunk) | — |
| 128 | `waiting-standing-comment-residue` | low | unchanged (no cited file touched in aec9e16be..b315e0e8f) | — |
| 129 | `request-source-guard-copies` | low | unchanged (touched: lib/run-view.js; cited decision not in a window hunk) | — |
| 130 | `reply-effect-default-split` | borderline (not graded) | unchanged (no cited file touched in aec9e16be..b315e0e8f) | — |
| 131 | `override-kind-list-stale` | low | unchanged (touched: lib/proxy-instructions.js, routes/proxy-compute.js; VERB OVERRIDE sentence is in a hunk, same 15 keys) | — |
| 132 | `path-class-predicate-copies` | low | unchanged (no cited file touched in aec9e16be..b315e0e8f) | — |
| 133 | `world-helper-convention-half-guarded` | low | unchanged (touched: CLAUDE.md; cited decision not in a window hunk) | — |
| 134 | `stage-writes-threading-per-entrance` | low | unchanged (touched: lib/dispatch-entrance.js, routes/workspace-api-feedback.js, lib/proxy-preamble.js, tests/unit/lin-3134-declared-mint-census.test.js; cited decision not in a window hunk) | — |
| 135 | `in-progress-predicate-server-client-split` | low | unchanged (no cited file touched in aec9e16be..b315e0e8f) | — |
| 136 | `stage-kind-roster-tables` | low | worsened: `survey-place` occurrences 13 in 9 files → 21 in 10 files inside the window; still joined by string keys | — |
| 137 | `enqueue-route-list-restated` | low | unchanged: four stale copies remain (CLAUDE.md enqueue line, lib/proxy-scopes.js:23-25, docs/proxy-integration.md dispatch row); lib/proxy-scopes.js:8 now says four | — |
| 138 | `element-method-guard-idiom-beyond-scan` | low | unchanged: presence/typeof guards remain at public/prompt-section.js:1055, 1223, 1856 and public/question-cards.js:241 (line drift only) | — |
| 139 | `client-dual-export-split` | low (borderline) | unchanged: public/live-console.js:1361-1367 still exports two surfaces | — |
| 141 | `session-lane-grant-from-client-text` | low-medium | unchanged in code: the prompt sniff remains at lib/dispatch-entrance.js:1226 (isAutopilotVariant) inside the window-edited declaresDispatchGrant; LIN-4318 Backlog | — |
| 140 | `working-beat-grammar-cross-repo` | low-medium | unchanged: no `[working]` line in any window hunk under lib, routes, public or server.js, nor in SD's window; the four added lines are test-only (tests/unit/lin-4370-look-first-route.test.js); LIN-3828 Backlog | — |
| 142 | `leftover-gate-restates-three-decisions (R1)` | LOW–MEDIUM | new (window): lib/dispatch-leftover.js restates the follow-up target set, the halt modes and NEVER_RAN; homes exist (census groups 21, 47) | runs-and-dispatch |
| 143 | `periodical-notes-bullet-restates-leftover-rule (P1)` | LOW | new (window): lib/periodicals.js:313 areaNotes() says follow the notes' rules, then restates them | llm-and-prompts |
| 144 | `context-not-scope-three-homes (P2)` | LOW | new: "Waiting entries are context, not scope" in prompt-formatters.js:604 and both READMEs | llm-and-prompts |
| 145 | `area-notes-dir-outside-registry-path (P3)` | LOW | new: docs/areas/ spelled in four code places beside the registry-path constant | llm-and-prompts |
| 146 | `area-notes-guard-copied-and-diverged (P4)` | LOW | new, cross-repo: the notes guard copied to SD and diverged (200 vs 147 lines, sh extension, README rules) | llm-and-prompts |
| 147 | `as-asked-rule-sentence-two-homes (A1)` | LOW (borderline) | new (window): "no step may change them" in AS_ASKED_LEAD and BRIEF_HINT | agent-api |
| 148 | `agent-api-literals-restate-homes (A2)` | LOW (borderline) | new: look-first sequence, "a day", DECIDED_BY values and "four lines" restated beside their constants | agent-api |
| 149 | `session-pr-pick-mirror-cross-repo` | LOW–MEDIUM | new (window, LIN-4375; found by the second read): the PR pick is one rule in two repos, joined by a comment only | runs-and-dispatch |

## Follow-ups

- **No tickets minted.** Each new finding is either a Waiting entry in its area note (142, 143–146, 147, 148) or report-only (the rest). Carried rows with tickets stay report-only.
- **Existing tickets not changed.** LIN-4320 (row 137) should be widened, as run 5 said; that is not done here because the ticket is not in this review's remit to edit. LIN-4303 (row 138) re-scope: unchanged.
- **Gate comment and closing comment** are posted on LIN-4403 (see the Adversarial Second-Read section for the gate lines).

## For John

- **Larger tidies, not tickets** (listed here for the person; none is a Waiting entry, because each is a move bigger than a change should take on in passing):
  - Commit the import walker into `scripts/code-shape/` as a tool (run 5 and this run both ran it from the evidence folder).
  - An eviction rule for the 6144-byte notes cap in `docs/areas/README.md`. `runs-and-dispatch.md` is now within 1 byte of the cap; the last writer currently decides what stays.
  - The ledger only grows (rows retire only explicitly). Open rows could move into their notes, which is the note-based design the window started.
- **Findings with no area file to cite:** none this run. Row 137's copies are in `CLAUDE.md` and `docs/`, which no area file covers; the row has a ticket (LIN-4320) and is report-only.
- **Row 114 (halt cold-cache) is John's ruling** and is unchanged.

## Adversarial Second-Read

**Tier:** 2, a fresh-context sub-agent with no memory of the report-writing turn. It received the two repositories and their window, and this finished report. It did not receive the research or the plan's conclusions.

**Question:** "What is the largest item in this window that this report missed or misfiled?"

**The reader's full answer:**

> 1. **Largest item missed: the cross-repo "session's own PR" pick (LIN-4375).** Harbour `lib/dispatch-wake.js:275-305` (`reportedPrUrlOf`, `prUrlOfFeedback`) reimplements the rule in SD `links.js:256-330` (`sessionPrs`, `selectCanonical`) and `hook.js:605`. The only seam is a comment (`dispatch-wake.js:275`, "the same order simple-dispatcher's `sessionPrs` uses"). Each side has its own test (SD `test/lin-4375-session-pr.test.js`, Harbour `tests/unit/lin-4375-session-pr-wins.test.js`), and no shared contract row pins it. Cost: changing which PR a `[done]` names (the tie-break, or the set of lines read) needs a coordinated edit in two repos, and nothing fails if only one side moves. The sides also read different surfaces: Harbour takes `DONE:` and `[done]` lines from any feedback entry (`dispatch-terminal.js:661`), while SD takes `DONE:` lines from assistant text only. That may be intended; I did not confirm it. The report does not cover it. The cross-repo verdicts and report-only list omit it, and the touch map misses the file: `lib/dispatch-wake.js` (+126 in the window) appears nowhere in `ledger-touch-map-run6-window.txt`, because no ledger row cites it. Row 80 (`pr-url-regex-copies`, "no cited file touched") is a regex row and does not describe this decision. The report's own broker-429 treatment (report-only, designed duplicate) is the precedent it should have applied.
>
>    Smaller items:
>    - `lib/dispatch-terminal.js:660` (added in the window by LIN-4376) cites "simple-dispatcher's `DONE_LINE_RE`". That symbol does not exist in SD at HEAD or at baseline `07c88f7a`. LIN-4385 replaced it with `doneLineRest` (`transcript.js:320-323`). This is a stale pointer the notes do not mention.
>    - The catalog reasoning rule is split: `lib/openrouter.js:91` `isReasoningModel` (mandatory or default_enabled), `lib/call-budget.js:81` `canReason` (test-only, `reasoning != null`), and `resolveReasoningBudget` (`openrouter.js:116`) beside `planCallBudget`. The HEAD note `docs/areas/llm-and-prompts.md` names the split, so it is noted but not filed as a finding.
>
>    Report checks that hold: R1 citations (`dispatch-leftover.js:26, 29, 113`; `dispatch-targets.js:29`; `workspace-halt.js:34`; `dispatch-store.js:1906`), row 141 (`dispatch-entrance.js:1226`), and row 140 (the four window `[working]` lines are all in `tests/unit/lin-4370-look-first-route.test.js`).
>
> 2. No. R1 restates three sets inside one repo's leftover path, where homes already exist. The PR-pick mirror is cross-repo, has no shared pin, and changes a user-visible PR link, and the report does not file it at all.
> 3. Adversarial second-read verdict: DISAGREE
> 4. Differed from top finding: YES

**Checks made on the reader's answer (at HEAD):** the PR-pick rule and its comment are at `lib/dispatch-wake.js:275-305`; SD's `sessionPrs` is at `links.js:296` and is consumed at `hook.js:607`; the two sides read the surfaces and fall back in the orders the reader gives (SD's `sessionPrs` walks assistant text blocks, then `gh pr create` results; Harbour's `prUrlOfFeedback` walks feedback entries, then each entry's `url` and message). The `DONE_LINE_RE` pointer is stale: the only SD occurrence is a comment at `links.js:256` calling it the old regex. The reader's `[working]` claim is confirmed: the window adds four `[working]` lines, all in `tests/unit/lin-4370-look-first-route.test.js`, and none under `lib`, `routes`, `public` or `server.js`. Row 140 is stated with that scope.

**Revision in place.** The reader's item is row 149 (`session-pr-pick-mirror-cross-repo`, LOW–MEDIUM), ranked first. Its Harbour side has a Waiting entry in `runs-and-dispatch.md`. The SD side is not edited in this review (SD's README and the one-way check are SD's to decide, and no SD-local defect was found), so no companion SD PR is opened. R1 is kept as second. The reader's catalog-split note is recorded above and not filed. The reader's `DONE_LINE_RE` pointer is recorded as report-only.

**Verdict and disposition** (the gate comment repeats these three lines):

- Adversarial second-read verdict: DISAGREE
- Differed from top finding: YES
- Disposition: fixed in place

