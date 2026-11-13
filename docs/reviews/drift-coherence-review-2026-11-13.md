# Drift & Coherence Review — 2026-11-13, run 7 (trend vs the 2026-11-10 run 6)

**Ticket:** LIN-4443. **Previous edition:** `docs/reviews/drift-coherence-review-2026-11-10.md` (run 6, LIN-4403, PR #2385, merged `1e106e4e3`), called **run 6** below. **Evidence:** `docs/reviews/_evidence-2026-11-13-drift/`.

**Review-only.** This edition adds this report, its evidence folder and area-note edits under `docs/areas/` (`runs-and-dispatch.md`, `llm-and-prompts.md`, `front-end-pages.md`, `reports-and-operator-tools.md`). One companion docs-only PR in simple-dispatcher (SD) adds one Waiting entry to its `docs/areas/stop-hook-and-relay.md` (SD census group G0018, below). No code, config, guide, script, CI file or secret was changed in either repo.

The Harbour window is `b315e0e8f..e2d4659c4`: 35 first-parent commits, LIN-4402 (#2384) through LIN-4442 (#2417). It starts at run 6's measured commit, so there is no gap. SD is `5d8489e..af9b496`: 3 first-parent merges (#336 to #338), docs and tests only. `origin/main` was `e2d4659c4` in Harbour and `af9b496` in SD when the review was written, so the window was not extended.

## Better or worse, by area

**For the whole window: neutral.** The window made several homes real. The cost read is one module again (`lib/task-cost-read.js` only calls `readCost`). The live-stage wait is one predicate (`isLiveRun`). The leftover step renders `CONSEQUENCE_TEST` and the retirement words from the leaf. The blind read's verdict words and its PR-landing rule each have one home. A new test pins 17 stage-kind tables to the template roster. But two new modules restate a decision that already had a home: the per-dispatch model pick (150) and the blind read's kind and heading (151). The prose that lists the code-settled routes is now wrong in two places (154). All the costs are LOW to LOW–MEDIUM.

| Area | Verdict | Evidence (code at `e2d4659c4`, against `b315e0e8f`) |
|---|---|---|
| **Runs & dispatch** (`lib/task-timeline.js`, `lib/task-cost-read.js`, `lib/cost-read.js`, `lib/run-ledger.js`, `lib/close-out-readiness.js` and others) | **neutral** | **Better:** `lib/cost-read.js` was refactored inside the one home (`sessionOf`, `selectLineageRecords` and `requestSpanOf` were extracted there). `lib/task-cost-read.js` and `routes/proxy-compute.js` now only call `readCost`. Four ledger helpers moved from `lib/recommendation-facts.js` into `lib/run-ledger.js`, which removed census group G0282. "Is a stage live" is `isLiveRun` (`lib/recent-runs.js:34`) alone. **Worse:** `dispatchModelOf` (`lib/task-timeline.js:53-58`) picks a dispatch's model by a second rule (150, LOW–MEDIUM). The landing exclusions are listed twice (153, LOW, already a Waiting entry). |
| **LLM & prompts** (`lib/prompts/*`, `lib/prompt-template-defs.js`, `lib/periodicals.js`, `lib/openrouter.js`, `lib/recommendation-*.js`) | **neutral** | **Better:** `LEFTOVER_RULE`, `CONSEQUENCE_TEST`, `RETIRES_*` and `BLIND_READ_VERDICTS` are rendered from their leaves. The look-first sequence moved into the one wait cleanly, with no references left to the retired symbols. `tests/unit/stage-kind-tables.test.js` (new) pins 17 kind tables both ways (row 136, improved). `areaNotes` in `lib/periodicals.js` dropped most of its restatements (row 143, improved). **Worse:** the blind read's kind and heading are retyped (151). The code-settled route list is copied about nine times, and two copies are wrong (154). The retirement rule is restated per reader in the docs (152). `docs/areas/` is spelled in more places, and a second directory constant exists (145, worsened). |
| **Agent API (proxy)** (`routes/proxy-writes.js`, `lib/proxy-instructions.js`, `lib/proxy-preamble.js`, `lib/dispatch-leftover-answer.js`) | **neutral** | The blind-read shape check and the retirement check each read their leaf, and the catalogue renders `retiresExamples()`. The hand-typed look-first sequence left `lib/proxy-instructions.js` (row 148, partly improved). The enqueue route list is still stale in three places (137), and the VERB OVERRIDE list still omits four template keys (131). |
| **Front end, pages and browser** (`lib/render-task-timeline.js`, `public/task-page.js`, `public/llms.txt`) | **neutral** | The timeline renderer reads the model and keeps money out of attributes. It restates the model's tick rule once (157, LOW), and `public/llms.txt` has the blind read routed "by hand" (part of 154). |
| **Reports & operator tools** (`scripts/stability-measures*.mjs`, newly mapped in `docs/areas/areas.json`) | **neutral** | The scripts are clean readers: they import `parseBlindRead`, `landingPrUrls`, `prOf`, `BLIND_READ_VERDICTS`, `WAKE_FEEDBACK_REGEX`, `NOTES_DIR` and `countWaiting` from `lib/`, and read cost and tracker data through the proxy. One script's citation of its home is untrue for two outcome buckets (156, LOW). |
| **Web routes, wiring, platform** (`routes/task-page.js`, `routes/task-share.js`, `server.js`, Node ≥ 24, the unit-proxy CI job) | **neutral** | Wiring and the timeline fragment only. `res.status(` count in `routes/` and `server.js`: 275 at both ends. |

## Headline

1. **Neutral overall.** The window's main themes (blind read, retirement line, task-life cost and timeline, periodical hand-off) each landed a real home. Two of the new modules also wrote a second copy of a decision beside it.
2. **Top window finding: the per-dispatch model is chosen by a second rule (150, LOW–MEDIUM, new).** `dispatchModelOf` in `lib/task-timeline.js:53-58` re-sorts a dispatch's `byModel` by `costUsd` (null as −1), then by request count. The home, `foldRequestUsage` in `lib/request-usage-fold.js:107-121`, ranks by priced dollars and then latest use, and names the latest model when nothing is priced. `modelRowOf` (`lib/cost-read.js`) drops `pricedUsd` before the timeline sees the rows. So whenever a request is unpriced, the lane label (`session.model`, the fold's answer, `lib/task-timeline.js:350`) and the dispatch rows inside the lane (`:73`) can name different models. Changing the dominant-model rule would leave the timeline behind. The cause is in this window (LIN-4404/4405). Note: `runs-and-dispatch.md` (a Waiting entry and a Lesson).
3. **Second: the blind read's kind and heading are retyped (151, LOW–MEDIUM, new).** `lib/prompts/blind-read-words.js` says "none retypes them". But the kind `'blind-read'` is typed bare in the run predicate and the dispatched step (`lib/recommendation-blind-read.js:47, 65, 75-76`), `lib/pipeline-churn.js:233`, `lib/run-view.js:472` and `lib/run-closeout-state.js:116, 255`, and it has a second constant, `VIRTUAL_PROMPTS.BLIND_READ` (`lib/workflow-config.js:40`). `lib/completion-signals.js:254-262` types the heading three times and the verdict words once. Renaming the kind would leave the route dispatching an unknown kind, and the roster test checks only that each kind is present. Answer to the ticket's question: the **verdict words** have one home and every parser imports them. So does the **PR-landing rule** (`closeOutWaitsOn`, `lib/run-closeout-state.js:112-117`), and its prose copies agree today. The **heading** and the **kind** do not. Note: `llm-and-prompts.md`.
4. **Carried LOW–MEDIUM rows are unchanged in code:** 149 (the session-PR pick, cross-repo), 142 (R1, the leftover gate's three sets), 141 (the session-lane grant sniff) and 140 (the `[working]` grammar). None of their cited lines is in a window hunk. Their tickets (LIN-4318, LIN-3828) are Backlog.
5. **Two copies of the code-settled routes are already wrong (154, LOW, new).** `docs/architecture/prompt-system.md:7` says "Code settles four routes" and then restates three, without the blind read. `public/llms.txt:271` says the blind read is "Sent by hand", where its description says code sends it. The list of four is copied about nine times and no test reads any copy.
6. **Retirement line (LIN-4414).** The three forms' words are spelled once (`RETIRES_LABEL`, `RETIRES_NONE`) and checked once (`lib/dispatch-leftover-answer.js`). Which entry to settle, and the forms themselves, are restated by hand in both READMEs, `docs/proxy-integration.md` (with the refusal kinds) and `docs/architecture/dispatch-and-proxy.md`. SD's README words the third way out differently: an entry leaves when "a follow-up is filed for it" (152, LOW, new).
7. **Census.** Harbour has 108 `mustRule` groups: 104 unchanged, 4 grown, 0 new. Rulings: 34 real, 28 borderline, 46 noise; run 6 had 34 / 27 / 46, and the extra borderline is G0020, `[skipped]`, newly `mustRule`. Two groups are gone. G0106 (the stage-kind table keys) re-keyed as table group G0100 when `blind-read` was added. G0282 (the `firstLineOf` clone) went because the helpers moved into `lib/run-ledger.js`. **SD's first trend:** all 61 groups are unchanged, which follows from a window that touched no SD code. SD's 27 `mustRule` groups are ruled for the first time (2 real, 15 borderline, 10 noise).
8. **Import graph.** 522 nodes, 2178 static edges, 2 dynamic (+51 / −6 static against run 6's reproduced graph). SCCs are unchanged (6 + 6, the same members). Upward `lib/` → `routes/` edges: 0 / 0.
9. **Notes.** Seven Waiting entries were added and one was updated (the P3 count, recounted). One Lesson was added. Nothing was pruned: the entries in the touched notes that the window could have settled still hold (listed under "Notes: changes and prunes"). Every Lessons section is under the 6144-byte cap. The notes guard passes in both repos.
10. **Zero new tickets.** Carried tickets at writing: LIN-4320, 4318, 4302, 4256, 4303, 3828 and 4301 are Backlog; LIN-3449 is Todo with 22 comments. Row 114 (halt cold-cache) remains John's ruling.
11. **Second read:** pending.

## Grounding (HEADs measured)

- **LinearViewer: window end `e2d4659c4bf07ed266735f718e85232e5f2a6458`** (LIN-4442, #2417); window start `b315e0e8f3e1e5f3b5d6e634e53c5dc83b41d754`.
  - Production diff (`git diff --shortstat b315e0e8f e2d4659c4 -- lib routes public server.js`): **67 files, +3201 / −841**, matching the ticket.
  - All files: 1022 files, +171337 / −2481. Most of it is `docs/papers/harbour/task-size-and-cost-evidence/` (694 files) and earlier reviews' evidence folders. Without `docs/papers` and `docs/reviews/_evidence-*`: 225 files, +19823 / −2233. Without `docs/papers` and all of `docs/reviews`: 214 files, +13687 / −2233.
  - The ticket's "about 130 files, +10364 / −1341" was not reproduced under any of these cuts. The production figure, which is what this review reads, does match.
  - The new `scripts/stability-measures*.mjs` and `scripts/measure-ci-wall.mjs` are 6 files, +1446.
- **SD: window end `af9b496d57f042972b912a30eb8c4d1164bbab77`**, start `5d8489e7fd8434f0e69af7df11a3746790abbe64`: 3 files, +120 / −23. The three files are `docs/areas/README.md`, `docs/areas/loop-and-routing.md` (new) and `test/area-notes.test.js`.
- **Area registry (Harbour):** `docs/areas/areas.json`, git blob `d13fca20e50c37e859e82fbc820177acefd4e48d`, sha256 `97b30f40ff80ac1ef40c91ccd92a8b1e40953bb36b05460d47de3a9a8770c640`. Run 6 used blob `4011e82a` (kept here as `areas-run6-4011e82a.json`).
  - The window's registry edit adds `task-cost-read`, `task-timeline` and `session-roles` to Runs & dispatch, in place of `task-cost`, which matched no file. It also files `scripts/stability-measures*.mjs` under Reports & operator tools.
  - The guide-only check below shows the edit changes nothing at the baseline.
- **Area registry (SD):** blob `c977bd0c0a186c1314202673da22cf31b8a0da29`, sha256 `35c81c8f…b846`. Unchanged since run 6.
- **Runner contract:** `lib/runner-kit/contract.json` and SD's `test/fixtures/runner-contract.json` are byte-identical (sha256 `602ab014062857bf…`, as at run 6). `lib/runner-kit/` is untouched in the window. `EXCHANGE_MAX_WAIT_SECONDS = 60` in both repos (`lib/runner-kit/broker.mjs:97`; SD `harbour-token-mcp-server.js:56`).
- **TODO / FIXME markers added in the window:** none in Harbour (`lib`, `routes`, `public`, `server.js`, `scripts`, `tests`) and none in SD.
- **Ticket staleness check:** `git log --since=2026-11-13T07:28:14Z` is empty in both repos, so the ticket's description of the code holds at HEAD. Where it is inexact, that is said in place: the all-files figure above, and "26 kinds" (`PROMPT_TEMPLATES` has 20 keys; the census group lists 26 table keys).

## Findings (severity-ranked; delta vs run 6)

Citations are at `e2d4659c4` (Harbour) and `af9b496` (SD). Carried rows keep their run-6 names. The compact ledger holds all 149 carried rows and the eight new ones (150 to 157), each with a run-7 delta.

| # | name | severity | delta vs run 6 | one line |
|---|---|---|---|---|
| 1 | **150** `dispatch-model-pick-second-rule` | LOW–MEDIUM | **new** (window, LIN-4404/4405) | `lib/task-timeline.js:53-58` `dispatchModelOf` re-ranks `byModel` by `costUsd` (null as −1), then requests. The home, `lib/request-usage-fold.js:107-121`, ranks by `pricedUsd`, then `lastPos`, and falls back to the latest model. `modelRowOf` (`lib/cost-read.js`) strips `pricedUsd`. Case: model A has $5 priced plus one unpriced request, and model B has $1 fully priced. The fold names A (the lane), the timeline names B (the row). With nothing priced, the fold names the latest model and the timeline the busiest. Fix at the cause: `dispatchesOf` carries `fold.last.model`. Note: `runs-and-dispatch.md`. |
| 2 | **151** `blind-read-kind-and-heading-retyped` | LOW–MEDIUM | **new** (window, LIN-4437/4438) | `BLIND_READ_KIND` / `BLIND_READ_HEADING` (`lib/prompts/blind-read-words.js:18, 21`) are retyped: the kind bare at `lib/recommendation-blind-read.js:47, 65, 75-76`, `lib/pipeline-churn.js:233`, `lib/run-view.js:472`, `lib/run-closeout-state.js:116, 255`; a second constant at `lib/workflow-config.js:40`; the heading at `lib/completion-signals.js:254, 259, 262`, and the verdict words at `:257`. The roster test (`tests/unit/stage-kind-tables.test.js`) checks presence, not these literals. `COMPLETED` is also redeclared at `lib/recommendation-blind-read.js:43` (home `lib/providers/models.js:21`). Note: `llm-and-prompts.md`. |
| 3 | **149** `session-pr-pick-mirror-cross-repo` | LOW–MEDIUM | **unchanged** | `lib/dispatch-wake.js` and SD's `links.js` / `hook.js` are untouched in both windows. The rule is still joined only by the comment at `lib/dispatch-wake.js:275`. Note: `runs-and-dispatch.md` (run 6's entry, still true). |
| 4 | **142** `leftover-gate-restates-three-decisions` (R1) | LOW–MEDIUM | **unchanged in code** | `lib/dispatch-leftover.js:26` (`RESUMABLE_TARGETS`), `:29` (`NEVER_RAN`) and `:113` (the `pause` / `stop` test) are as in run 6. The window's ±18 in the file is the prompt, which now renders `CONSEQUENCE_TEST` and the retirement words from the leaf. Note: run 6's entry, still true. |
| 5 | **141** `session-lane-grant-from-client-text` | LOW–MEDIUM | **unchanged in code** | `lib/dispatch-entrance.js:1226` still passes `isAutopilotVariant(prompt)`. The window's ±22 in the file did not touch it. LIN-4318 Backlog. |
| 6 | **140** `working-beat-grammar-cross-repo` | LOW–MEDIUM | **unchanged** | No `[working]` line in any production hunk in either window. SD census G0003 rules it real (below). LIN-3828 Backlog. |
| 7 | **154** `code-settled-routes-list-copies` | LOW | **new** (window, LIN-4392/4437) | The four routes code settles are listed by hand in `CLAUDE.md:102`, `lib/stage-router.js:19-20`, `lib/openrouter.js:2065-2068`, `lib/recommendation-facts.js:468-471`, the headers of `lib/recommendation-live-wait.js`, `lib/recommendation-look-first.js` and `lib/recommendation-blind-read.js`, `docs/architecture/source-map.md:222-224` and `docs/architecture/prompt-system.md:7`. The last restates three, and says "four" in the same line. `public/llms.txt:271` says "Sent by hand"; the description (`lib/prompt-template-defs.js:1289`) says "Sent by code". Note: `llm-and-prompts.md`. |
| 8 | **152** `retirement-rule-restated-per-reader` | LOW | **new** (window, LIN-4414) | The words (`lib/prompts/leftover-words.js:57-68`) and the check (`lib/dispatch-leftover-answer.js`) have one home each. The selection rule and the forms are restated in `docs/areas/README.md:68-79`, SD's README `:72-82`, `docs/proxy-integration.md:2302-2307` (with the six refusal `kind`s by hand) and `docs/architecture/dispatch-and-proxy.md:127`. The verbatim guard (`tests/unit/lin-4374-review-leftover-read.test.js`) reads only `lib/` and `routes/`. SD's README says an entry leaves when "a follow-up is filed for it"; Harbour's says only when the consequence test sends it. Note: `llm-and-prompts.md` (the cross-repo seam starts at the leaf). |
| 9 | **153** `landing-exclusions-two-lists` | LOW | **new** (window, LIN-4437/4438) | What is not landing work (blind reads, Survey reports) is listed in `lib/run-ledger.js:567` (`landingPrUrls`) and again in `lib/recommendation-facts.js:86` (`isLandingEvidence`), which says in a comment that it agrees. A third rule, `auditAfterLandingCloseOut` (`:102-113`), picks the landing its own way. Already held by the existing `lib/run-ledger.js` Waiting entry in `runs-and-dispatch.md` ("one comment classifier and one landing reader"), so no new entry. |
| 10 | **145** `area-notes-dir-outside-registry-path` (P3) | LOW | **worsened** | `docs/areas` in `lib`, `routes`, `public`, `server.js` and `scripts`: 17 lines in 10 files at `b315e0e8f`, 26 lines in 11 files at `e2d4659c4`. A second directory constant, `NOTES_DIR` (`lib/prompts/area-note-format.js:8`, LIN-4420), sits beside `REGISTRY_PATH` (`lib/prompts/area-registry-path.js:6`), and neither derives from the other. Note: the existing `llm-and-prompts.md` entry, recounted. |
| 11 | **156** `ruling-outcome-buckets-claim-home` | LOW | **new** (window, LIN-4424) | `scripts/stability-measures-seat.mjs:9, 101` say the buckets are "as lib/escalation-kpis.js". But the script counts withdrawn as neither and a null outcome as unreadable (`:79-90`). The home (`lib/escalation-kpis.js:120-126`) counts every event that is not self-resolved or dismissed as answered. The inputs differ (proxy rulings against feedback events), so the split may be intended; the citation is untrue either way. Note: `reports-and-operator-tools.md`. |
| 12 | **157** `timeline-renderer-rederives-tick-style` | LOW | **new** (window, LIN-4405) | `lib/render-task-timeline.js:130` restates the model's tick rule (`lib/task-timeline.js:340`: wake, resumed or no records) to choose the bare style, and the legend (`:205`) restates it again. The renderer's header (`:4`) says it derives nothing. Note: `front-end-pages.md`. |
| 13 | **136** `stage-kind-roster-tables` | LOW | **improved (pinned)** | `tests/unit/stage-kind-tables.test.js` (new, LIN-4437) checks 17 kind-keyed tables against `PROMPT_TEMPLATES` both ways, with a reason for each kind a table leaves out. The blind read still touched 13 tables in 11 files; the census group re-keyed (G0106 → G0100). The text of a table entry is not pinned, which is how 154's `llms.txt` line got through. `survey-place` lines: 21 in 10 files → 22 in 12. The Waiting entry ("fold them into one definition") stands. |
| 14 | **137** `enqueue-route-list-restated` | LOW | **unchanged** | `lib/proxy-scopes.js:24-25`, `CLAUDE.md:107` and `docs/proxy-integration.md:102` still list three enqueue routes. The window edited `CLAUDE.md` and the doc and left these lines. `lib/proxy-scopes.js:8` says four. LIN-4320 Backlog. |
| 15 | **131** `override-kind-list-stale` | LOW | **unchanged in code** | The VERB OVERRIDE sentence (`lib/proxy-instructions.js:927`) gained `blind-read` and names 16 of the 20 `PROMPT_TEMPLATES` keys. `bug`, `plan-review`, `close-out` and `retrospective-audit` are still missing. LIN-4302 Backlog. |
| 16 | **143** `periodical-notes-bullet-restates-leftover-rule` (P1) | LOW | **improved** | `areaNotes` (`lib/periodicals.js:350`) no longer restates the byte cap, the distil step, Waiting against Lesson, the cite order or the merge authority. Three short restatements remain, each consistent with its home today: the prune sentence, the source format, and "a ticketed finding stays in the report only". |
| 17 | **146** `area-notes-guard-copied-and-diverged` (P4) | LOW | **improved** | Both guards now have the same 12 extensions (sh included), the same five checks and the Lessons-only cap. SD's README gained the Periodical-entry rule. The guards are still copied by design and held together by comments. Harbour's guard now reads the entry parse from `lib/prompts/area-note-format.js`; SD's keeps its own. The README wording divergence is 152. |
| 18 | **144** `context-not-scope-three-homes` (P2) | LOW | **unchanged** | `lib/prompt-formatters.js:612`, `docs/areas/README.md:66`, SD's README `:70`. `lib/dispatch-leftover.js:124` now names the rule as the one its retirement step is the exception to. |
| 19 | **138**, **135** | LOW | **unchanged** | No cited file touched. LIN-4303 and LIN-4256 Backlog. |
| 20 | **148** `agent-api-literals-restate-homes` (A2) | LOW (borderline) | **improved (partly)** | The hand-typed look-first sequence left `lib/proxy-instructions.js` (LIN-4407). "a day" (`lib/proxy-instructions.js:485`), "four lines" (`routes/proxy-writes.js:362`) and the `DECIDED_BY` values (`lib/completion-signals.js:121`) remain. |
| 21 | **155** `cited-path-rule-three-spellings` | LOW (borderline) | **new** (window, LIN-4414) | What a cited path is lives in the guard (`tests/unit/area-notes.test.js:28-30`, a listed extension), in `lib/dispatch-leftover-answer.js:41-42` (any extension of one to six characters, called "the area-notes guard's rule") and in SD's guard. `lib/prompts/area-note-format.js`, the new single reading of an entry, does not hold it. Note: `llm-and-prompts.md`. |
| 22 | **147** (A1), **139** | LOW (borderline) | **unchanged** | `AS_ASKED_LEAD` (`routes/proxy-writes.js:78`) and `BRIEF_HINT` (`lib/as-asked.js:294`); `public/live-console.js` dual export. |

**Resolved:** none new; run 6's resolved rows hold. **Improved:** 4 (136, 143, 146, 148). **Worsened:** 1 (145). **New:** 8 (150 to 157). **Unchanged:** the remaining 127 rows; the touched ones are judged one by one in the ledger.

**Report-only (no area file to cite, a designed duplicate, or below the bar):**
- **Stale pointer, unchanged:** `lib/dispatch-terminal.js:665` still cites SD's `DONE_LINE_RE`, which exists in SD only as a comment naming the old regex. The rule is `doneLineRest`.
- **Broker 429 policy:** a designed duplicate, held by the contract's `exchange` rows (see above).
- **Two readings, not a duplicate:** `lib/pipeline-churn.js:233` and `lib/recommendation-blind-read.js:46-48` both count blind reads since the latest review, keyed on review run rows against the review comment's time. The first is a churn measure, the second the attempt bound.
- **Timeline seams, below the bar:**
  - `gapWords` (`lib/task-timeline.js:160`) is a second duration formatter beside `fmtDuration` (`lib/render-run-steps.js:258`), with a different shape on the same page ("2d 4h" against "52h").
  - `TIMELINE_CACHE_MS` (30 s) must stay below `TIMELINE_WINDOW_MS` (60 s, `public/task-page.js:53`); only a comment joins them.
  - The timeline's total leaves out Harbour calls, while `/cost`'s includes them. That is the same word for two values, but not a duplicated rule.
  - A waiting session drawn as "running" on the timeline is deliberate (the `runs-and-dispatch.md` Lesson on `isOpenState`).
- **Verdict words in prose:** "better, the same or worse" appears in `STAGE_LEADS` (a deliberate verbatim copy of the piloted prompt), the description, `lib/llm-jobs.js:46` and `public/llms.txt`. The vocabulary is closed ("There is no fourth"), so this bites only if it grows.
- **Scripts, below the bar:**
  - `ownTicket` (`scripts/stability-measures-core.mjs:184`) and `scripts/steady-base-provenance.mjs:26-27` (pre-existing) both read a landing's ticket. `scripts/delivery-composition.mjs` now imports `ownTicket`.
  - `'test.yml'` is typed at `scripts/stability-measures.mjs:103, 248` beside `WORKFLOW` (`scripts/measure-ci-wall.mjs:52`).
- **Catalog reasoning split** (`isReasoningModel`, `canReason`, `resolveReasoningBudget`): unchanged and already noted in `llm-and-prompts.md`.

## Cross-repo verdicts

- **Runner contract:** byte-identical (sha256 `602ab014…`), untouched in both windows. Harbour's `CONTRACT_SHA256` tripwire is one-way. Report-only.
- **Broker 429 policy:** unchanged; two copies held by contract cases.
- **Session-PR pick (149):** unchanged; still no contract row or one-way check.
- **`[working]` beat (140):** unchanged in both repos. SD census G0003 is the same row seen from SD (real; home LIN-3828).
- **Area notes:** the README and guard are copied by design (146, improved), and the README wording on how an entry leaves has diverged (152, new). The seam starts at Harbour's `lib/prompts/leftover-words.js`. No SD edit is made for it; SD's README is SD's to change.
- **Blind read:** SD carries no blind-read terms, verdict words or kind literals (checked). The runner sees only the stage kind on the wire, which the contract does not enumerate.
- **SD census, first trend:** 61 groups, 27 `mustRule`, 25 tabled, 0 gone, all unchanged against `5d8489e`. The flat result follows from a window with no SD code. SD's `mustRule` groups are ruled below for the first time. The one real group not already a Harbour row (G0018, the evidence scope derived in two relays) gets an SD Waiting entry in the companion PR.

## Sibling hand-offs (received, ruled, recorded)

- **Seams & Tangles run 11, `hub:periodicals.js` and its hand-off to this review** (`docs/reviews/seams-tangles-review-2026-11-10-run11.md`, the `hub:periodicals.js` entry and its sibling hand-off section). **Ruling: answered, closed from this side.**
  - The file's content holds no real duplicated decision at HEAD.
  - P1 improved (row 143).
  - The hand-off / merge / Done rule is spelled three times in one rendered prompt: `handOffBullet` (`lib/periodicals.js:296`), `adversarialRead` (`:398`) and the tail of `areaNotes` (`:350`). `tests/unit/lin-4390-periodical-hand-off.test.js` pins all three, so a change cannot drift silently. Borderline, report-only.
  - The second-read gate lines are typed in the prompt (`:398`) and parsed by regex in `lib/periodical-report-gate.js:72-74` with no shared constant. Pre-existing (LIN-2323); only the tests link them. Borderline, report-only.
  - Where a live secret goes (the closing comment against `CONSEQUENCE_TEST`'s ticket) is already a Waiting entry in `llm-and-prompts.md` that needs John's ruling. So is the notes-PR rule worded in two places.
  - Coupling structure stays with Seams.
- **Stability run 6** (`docs/reviews/stability-review-2026-11-13.md`) points "decisions held in several places" at this review. It names no specific item, so nothing beyond this report is owed.
- **Stability measures scripts: does this remit reach them?** **Yes, for the duplicated-decision question only.**
  - They read `lib/` decisions (they import them), and the window's registry edit files them in an area.
  - The census scope is not widened to `scripts/`, so the trend against run 6 stays comparable.
  - Result: clean readers, one LOW finding (156), and two report-only spellings.
- **Documentation run 7, Integration & Surface Maturity run 5, Onboarding run 4, Test Coverage Gap, Security, Dependency & Supply-Chain:** read for hand-offs. None hands this review an item it does not already carry. Their note entries are theirs and are not re-flagged. Code Quality (2026-11-04) and Comprehension-Debt (2026-11-05) are unchanged since run 6.

## Method and instrument

- **Census:** `scripts/code-shape/census-review.mjs` run in place, scope `--include '^(server\.js$|(lib|routes|public)/.*\.[cm]?js$)'`, one guide passed explicitly with `--areas`. The tool's only window change is a test (`scripts/code-shape/wrappers.test.mjs`, LIN-4441).
  - **Reproduction first:** `census-review.mjs . b315e0e8f 5c63aa26 --areas <run 6's guide, blob 4011e82a>` equals run 6's `census-HEAD-vs-5c63aa26.json` in every field except `areaGuide`, the path label (`census-repro-run6-b315e0e8f-vs-5c63aa26.json`, sha prefix `7ecc66c7`). The instrument is unchanged.
  - **Guide-only check:** the same commits with the HEAD registry give 0 area-label, `mustRule` or rank changes. The file is byte-identical to run 6's JSON (`88597e12`). The registry edit is neutral at the baseline.
  - **HEAD against run 6's commit:** `census-review.mjs . e2d4659c4 b315e0e8f --areas docs/areas/areas.json` gives 579 groups, 108 to rule on, 320 tabled, 2 gone (`census-HEAD-vs-b315e0e8f.json`, `5c7a0f0f`).
  - **SD:** the same tool on SD with SD's registry. Reproduction at `5d8489e` against `07c88f7a` equals run 6's baseline except the guide label (`d83be2d5`). HEAD `af9b496` against `5d8489e`: 61 / 27 / 25, 0 gone (`66656f41`).
- **Rulings:** `rulings-carry-run7.py` joins the 108 groups to run 6's rulings (`census-rulings-run6.tsv`) on (detector, decision, files), with a fallback on (detector, decision) at ≥ 50% file overlap.
  - 105 joined by key and 2 by the fallback (G0007, G0051, both grown). One, G0020, joined run 6's table group G0085, which had no ruling, and was ruled from its sites.
  - Five groups have a site inside a window hunk (G0007, G0012, G0020, G0051, G0147). Each was re-read at HEAD, and the re-read is recorded in the table's reason column. Every carried ruling stands.
  - `build-tables-run7.py` writes the two tables.
- **Import walker:** run in place from `docs/reviews/_evidence-2026-11-06-drift/import-walker.mjs`.
  - At `b315e0e8f` its output equals run 6's graph except the `sha` label (full against short; `3f5d7a00`).
  - At `e2d4659c4`: **522 nodes, 2178 static edges, 2 dynamic** (`3721403f`). SCCs 6 + 6 with the same members; upward 0 / 0; route to route 53; parse failures 0. Edge delta: `import-graph-delta-b315e0e8f-to-e2d4659c4.txt`.
  - The largest new fan-ins are `lib/prompts/blind-read-words.js` (6 importers) and `lib/run-ledger.js` (5 new importers).
  - `lib/prompts/area-note-format.js` has no importer under `lib/` or `routes/`. It is read by `scripts/stability-measures.mjs` and the notes guard.
- **Touch map:** `touch-map-run5.py` run in place over run 5's citation ledgers and this window's numstat (`window-numstat-all-run7.tsv`). It finds 35 rows citing a window-touched file (`ledger-touch-map-run7-window.txt`). Each was judged by hand against `git diff -U0 b315e0e8f e2d4659c4`, and the judgement is its ledger delta. Rows 136 to 149 are not in those citation ledgers and were judged from their run-6 text and the code.
- **Window files no ledger row cites:** run 6's second read found its top item in such a file. This run swept the window's new modules by hand for the duplicated-decision classes, in four parallel reads by fresh-context sub-agents, each given one question set and no conclusions. The reads covered `lib/task-cost-read.js`, `lib/task-timeline.js`, `lib/render-task-timeline.js`, `lib/session-roles.js`, `lib/recommendation-blind-read.js`, `lib/prompts/blind-read-words.js`, `lib/dispatch-leftover-answer.js`, `lib/recommendation-live-wait.js`, `lib/prompts/area-note-format.js`, `lib/periodicals.js` and `scripts/stability-measures*.mjs`. Every claim used here was re-checked against the code at HEAD by the writer.
- **Ledger:** `build-ledger-run7.py` carries `ledger-run6.tsv` (149 rows) under its names and adds a `run7_delta` column. It refuses to run if a touched row has no hand judgement. Output: `ledger-run7.tsv` (157 rows).
- **Carried tickets:** read from the tracker at writing (states above).
- **What was not done:** the test suites were not run beyond the two notes guards, since no code changed. Sibling reviews' own findings were not re-derived. SD's census rulings are a first reading from the sites and a spot read of `hook.js` and `opencode-runner.js`, not a full SD audit.

## Notes: changes and prunes

The README was re-read before writing (LIN-4414 rules). Only `## Lessons` is capped. Waiting entries are never shortened to make room. An entry leaves only when settled, untrue or sent to a ticket.

- **`runs-and-dispatch.md`:** one Lesson added (a per-dispatch figure is the fold's answer; a reader never re-ranks `byModel`) and one Waiting entry (`lib/task-timeline.js`, row 150). Lessons are now about 4.2 KB of 6144.
- **`llm-and-prompts.md`:**
  - **Updated:** the `lib/periodicals.js` `docs/areas/` entry, recounted (17 lines in 10 files → 26 in 11) and naming the second directory constant. The old count was no longer true, so the entry is made true, not shortened.
  - **Added** four Waiting entries: `lib/prompts/blind-read-words.js` (151), `lib/openrouter.js` (154), `lib/prompts/leftover-words.js` (152, naming SD's side in prose) and `lib/prompts/area-note-format.js` (155, borderline).
  - Lessons unchanged.
- **`front-end-pages.md`:** one Waiting entry (`lib/render-task-timeline.js`, 157).
- **`reports-and-operator-tools.md`:** one Waiting entry (`scripts/stability-measures-seat.mjs`, 156).
- **SD `docs/areas/stop-hook-and-relay.md`** (companion PR): one Waiting entry (`hook.js`, SD census G0018), naming this report in prose as SD's README requires.
- **Prunes: none.** These are the entries in the touched notes that the window could have settled, re-checked at HEAD and all still true:
  - runs-and-dispatch: the 149 and R1 entries; `lib/cost-read.js` (`readCalls` and `callsSurfaceOf` are still in that file, at `:780` and `:840`); `releaseHeldWake` / `formatHeldWakeNote`; the `provider.name === 'linear'` test (`lib/dispatch-factory.js:948`); the `lib/run-ledger.js` landing-reader entry, which now also holds 153.
  - llm-and-prompts: `canReason` (still test callers only); the live-wait race (`lib/recommendation-live-wait.js:27` still calls it accepted); the stage-kind tables entry (still true; now pinned, row 136); the live-secret and notes-PR wording entries (still true; the Seams hand-off above).
  - No still-true entry was cut.
- **Seams have no full home in the notes yet.** Each cross-area or cross-repo seam above is filed under the area a change would start from, naming the other side.

## Census rulings (the 108 `mustRule` groups, run-7 reading)

Every `mustRule` group has one ruling, carried by key from run 6 unless the basis says otherwise. A group with a site inside a window hunk was re-read at HEAD, and the re-read is appended to its reason. Ids are run-7 ids, with run-6 ids beside them. Machine copy: `census-rulings-run7.tsv`.

| rank | id (run 7) | id (run 6) | decision | areas/files/sites | status vs run 6 | window hunk | ruling | reason |
|---|---|---|---|---|---|---|---|---|
| 1 | G0001 | G0001 | repeated comparison NODE_ENV == 'test' | 7/17/43 | unchanged | — | real | Env read inline 43x; 10 identical limiter skip arrows re-derive test mode. Home: lib/should-mock-ai.js plus one skipInTest helper (10-23 named it; it… |
| 2 | G0002 | G0002 | repeated comparison kind == 'autopilot' | 4/19/31 | unchanged | — | real | Anchor test repeated inline: run-view.js:340 copies findAnchorLoop's test (session-summary.js:53); dispatch-store 573/738 repeat run-root. Home: find… |
| 3 | G0003 | G0003 | record assembled from the same sources {id=ID.id, title=ID.title} | 7/11/17 | unchanged | — | noise | A new shared home for two mocks (record {id,title} re-keyed from the gone {id,identifier,title}); lib/sample-data/fixture-parent.js is the first home. |
| 4 | G0004 | G0006 | tiny rule copied as a helper slugifyForFilename() (also: githubSlug, … | 5/10/12 | unchanged | — | noise | periodical-runs.js:193 is the first home for repo spelling (no exported repo normaliser); the copies are not a shared decision yet. |
| 5 | G0005 | G0004 | record assembled from the same sources {deployInfo=getDeployInfo(), u… | 2/13/13 | unchanged | — | real | 13 routes rebuild the same deployInfo/urlKey/openRouterSource/workspaces record with no shared builder. One chrome-options builder beside lib/compone… |
| 6 | G0006 | G0005 | repeated comparison authType == 'oauth' | 4/8/12 | unchanged | — | real | lib/workspace.js getBindingCallScope |
| 7 | G0007 | G0007 | repeated comparison kind == 'wake' | 2/11/24 | grown | yes | real | runner.mjs repeats the wake-claim test (kind wake, dispatchedBy null, followUpTo) at lines 122, 1012 and 1332; one helper in that file. Other wake si… |
| 8 | G0008 | G0008 | repeated comparison accessToken == 'test-token' | 4/6/13 | unchanged | — | real | isTestMode predicate re-inlined; 11-04 adds `lib/key-state-holders.js:48` (`workspace.accessToken === MOCK_ACCESS_TOKEN`), the same mock rule restate… |
| 9 | G0009 | G0010 | repeated comparison status == 'taken' | 1/9/16 | unchanged | — | borderline | Status literal still 16 sites in 9 files; the 5 in `dispatch-lineage-status.js` remain beside `lineage-membership.js:39`, which already holds the joi… |
| 10 | G0010 | G0009 | repeated comparison provider == 'jira' | 2/6/8 | unchanged | — | noise | provider switch at the edge; each branch differs |
| 11 | G0011 | G0011 | repeated comparison type == 'started' | 5/7/11 | unchanged | — | real | isInProgress (providers/state-map.js:59) and home-view isStarted exist, yet about 8 sites inline state.type==='started' (tree.js, openrouter, recomme… |
| 12 | G0012 | G0012 | repeated comparison stopAt == 'pr' | 4/10/15 | unchanged | yes | real | Inline stopAt==='pr' at 15 sites; readTaskRunFacts().stopAt is the home, but dispatch-entrance.js:1756 and dispatch-factory.js:444/1170 still re-deri… |
| 13 | G0013 | G0014 | text contract marker: [blocked] | 3/7/15 | unchanged | — | borderline | dispatch-terminal — the parse side is the authority; the emit side is the kit |
| 14 | G0014 | G0013 | repeated comparison scope == 'current' | 3/10/16 | unchanged | — | real | Find-by-(provider,scope) binding lookup is re-written at ~9 sites in 6 files; workspace.js already owns binding lookup (getBindingsForWorkspace). Lab… |
| 15 | G0015 | G0015 | repeated comparison key == 'Escape' | 1/7/10 | unchanged | — | noise | Each Escape handler closes its own component (queue, search, toggles, selectors, sheet); the literal is the platform key name, no shared rule is re-d… |
| 16 | G0016 | G0016 | repeated comparison key == 'Enter' | 1/8/12 | unchanged | — | borderline | Enter/Space activation repeated in 4 handlers; app.js x2 and common.js carry a Spacebar alias. Other Enter sites are send-on-Enter with shift guards,… |
| 17 | G0017 | G0017 | repeated comparison NODE_ENV == 'production' | 3/5/7 | unchanged | — | noise | Environment switch for secure cookies and https redirects; each site sets a different setting. Inert and not a domain decision. |
| 18 | G0018 | G0018 | repeated comparison name == 'AbortError' | 4/6/9 | unchanged | — | noise | standard fetch-abort check |
| 19 | G0019 | G0019 | string set {'127.0.0.1', 'localhost'} as array [[...].includes, [...]… | 4/4/8 | unchanged | — | real | isLocalhostRequest in lib/public-origin.js is the home; server.js inlines the same host test 5x and workspace-api-issue-read.js once. dispatch-entran… |
| 20 | G0020 | G0085 | text contract marker: [skipped] | 3/5/8 | grown | yes | borderline | Grown from table to mustRule by two blind-read prompt sites (completion-signals.js:260, prompt-template-defs.js:1310) that ask an agent to end [skipp… |
| 21 | G0021 | G0020 | repeated comparison provider == 'linear' | 2/4/7 | unchanged | — | borderline | workspace-token-refresh defaultResolveExchange |
| 22 | G0022 | G0021 | string set {'cancelled', 'expired'} as Set/or-chain [NEVER_RAN, ID.hi… | 1/5/6 | unchanged | — | real | Window-introduced: dispatch-leftover.js:29 NEVER_RAN restates the store status set at dispatch-store.js:1906. Home: export the set from the store; th… |
| 23 | G0023 | G0022 | record assembled from the same sources {code=ID.code, category=ID.cat… | 4/7/8 | unchanged | — | real | lib/errors.js — refusal envelope; `lib/errors.js` is the home |
| 24 | G0024 | G0024 | text contract marker: [evidence] | 5/6/9 | unchanged | — | real | session-telemetry EVIDENCE_PREFIX |
| 25 | G0025 | G0023 | string set {'Apr', 'Aug', 'Dec', 'Feb', 'Jan', 'Jul', +6} as array [m… | 4/6/7 | unchanged | — | noise | Inert month-abbreviation constants copied across lib and public; values cannot drift in meaning. Harmless duplication. |
| 26 | G0026 | G0025 | string set {'github', 'github-projects', 'jira', 'linear', 'local'} a… | 3/4/4 | unchanged | — | borderline | `REGISTRY_PROVIDERS` (`lib/workspace-store.js:4`) restates the provider registry (`providers/registry.js` `getAllProviders`); LOW |
| 30 | G0030 | G0029 | tiny rule copied as a helper (anonymous)(), 8 copies of 1-4 statements | 5/6/8 | unchanged | — | real | Mock-issue comment shaping is identical in proxy-compute.js:116, task-chat.js:69 and workspace-api-mocks.js:218. Home: buildMockRecapContext in lib/w… |
| 33 | G0033 | G0031 | repeated comparison harness == 'claude-code' | 4/5/8 | unchanged | — | borderline | harness == 'claude-code' special case repeats at 8 sites in 5 files (curated list, model mapping, catalog guard, label dedupe); each rule differs, so… |
| 34 | G0034 | G0035 | repeated comparison status == 'owner' | 4/8/8 | unchanged | — | borderline | Seven consumers switch on the one answer from readOwnerSeamStatus in lib/workspace-owner.js. The home exists; only the literal is repeated. |
| 35 | G0035 | G0032 | repeated comparison type == 'blocks' | 3/10/12 | unchanged | — | noise | Linear relation literal at 12 sites, each reading a different field for a different purpose; one external enum meaning. |
| 36 | G0036 | G0033 | record assembled from the same sources {token=ID.token, expiresAt=ID.… | 3/3/9 | unchanged | — | borderline | server.js resolver — cache tuple; follows the credential row, no separate decision |
| 37 | G0037 | G0034 | repeated comparison enabled == 'true' | 3/3/3 | unchanged | — | noise | Same one-line boolean parse in a user-level session toggle (server.js) and a workspace-level settings route (routes/settings.js); different stores an… |
| 39 | G0039 | G0039 | text contract marker: [done] | 4/5/7 | unchanged | — | noise | Grown (was run-5 G0099, borderline). New sites are the parse authority REPORT_LINE_RE (dispatch-terminal.js:663) and prose at dispatch-wake.js:356. R… |
| 40 | G0040 | G0036 | repeated comparison recommendedAction == 'defer' | 3/4/6 | unchanged | — | borderline | recommend-recurse |
| 41 | G0041 | G0038 | repeated comparison kind == 'recent' | 3/3/3 | unchanged | — | noise | 'recent' is a collective-characters doc kind at one site and a home-row kind at two others; different kind spaces, no shared rule re-derived. |
| 42 | G0042 | G0040 | repeated comparison status == 'ready' | 3/5/7 | unchanged | — | noise | 'ready' names different enums: close-out status in task-page-loader, close-out.js and session.js versus prompt aiState. Unrelated meanings. |
| 43 | G0043 | G0041 | repeated comparison code == 'OWNER_CHECK_UNAVAILABLE' | 3/5/5 | unchanged | — | borderline | proxy-preamble — sentinel string shared by two modules; follows the credential row |
| 44 | G0044 | G0044 | repeated comparison type == 'completed' | 5/8/10 | unchanged | — | noise | Literal is deliberate in follow-on-ratio.js and ship-journey.js (documented as not isCompleted/isTerminalState); roadmap and tree sites are separate … |
| 45 | G0045 | G0043 | repeated comparison kind == 'custom' | 3/4/5 | unchanged | — | noise | Grown by a store site. Codebase idiom: the custom-kind guard answers a different question at each site (dispatch-store.js:3453). |
| 46 | G0046 | G0046 | string set {'effort', 'harness', 'model'} as table-keys/array [FIELD_… | 4/5/5 | unchanged | — | real | model/harness/effort restated at 5 sites; model-routing.js FIELDS.AGENT_SESSION already declares them. dispatch-validation OPAQUE_FIELDS adds termina… |
| 48 | G0048 | G0049 | text contract marker: [failed] | 3/4/17 | unchanged | — | borderline | dispatch-terminal parses / kit emits |
| 49 | G0049 | G0047 | string set {'pause', 'stop'} as or-chain/table-keys/array [ID.mode, H… | 3/5/5 | unchanged | — | real | Window-introduced: dispatch-leftover.js:113 restates the halt modes beside HALT_MODES (lib/workspace-halt.js:34). Home: HALT_MODES (R1(b)). |
| 51 | G0051 | G0076 | repeated comparison state == 'running' | 3/6/25 | grown | yes | borderline | 22 sites in 5 files mix stage, ledger-row and session state spaces; runner.mjs re-tests row 'running' ~10 times with no shared predicate. Only that l… |
| 52 | G0052 | G0050 | tiny rule copied as a helper hashKey() (also: hashEmailRecipient, has… | 4/9/11 | unchanged | — | noise | hash helpers, identical by design; now also `account-erasure.js:231` |
| 55 | G0055 | G0052 | tiny rule copied as a helper (anonymous)() (also: brief), 3 copies of… | 3/3/3 | unchanged | — | noise | new only because LIN-3596 moved the mocks; same shape |
| 57 | G0057 | G0057 | record assembled from the same sources {id=ID.id, body=ID.body, creat… | 4/5/7 | unchanged | — | noise | comment record, three fields |
| 60 | G0060 | G0062 | repeated comparison turnKind == 'user-initiated' | 4/5/25 | unchanged | — | borderline | lib/agent-turn.js |
| 81 | G0081 | G0082 | repeated comparison agentState == 'error' | 3/4/5 | unchanged | — | noise | Error reads map to different outputs (failed status in task-page-loader, summary text in dashboard-summaries). Not the same decision. |
| 83 | G0083 | G0080 | repeated comparison stateType == 'started' | 3/10/19 | unchanged | — | real | Task-or-subtask in-progress test copied in render-roadmap.js:86, roadmap-digest-template.js:103 and roadmap-narrative-template.js:122. Home: lib/road… |
| 84 | G0084 | G0093 | repeated comparison kind == 'implementation' | 3/6/7 | unchanged | — | noise | Grown by dispatch-leftover.js:61, which is the body of isStageBuild, a new predicate of its own, not a second copy of an existing one. |
| 92 | G0092 | G0092 | repeated comparison state == 'done' | 3/4/5 | unchanged | — | noise | Stage tone, ledger row, task-state settle and ticket markers are four different state machines that share the word; no shared rule is re-derived. |
| 93 | G0093 | G0095 | string set {'merged', 'partial'} as or-chain/Set [ID.closeOut.status,… | 3/4/5 | unchanged | — | real | `lib/run-closeout-state.js` (owns `PARTIAL`/`MERGED`); export an `isMerged` predicate |
| 96 | G0096 | G0102 | text contract heading: changelog | 3/3/3 | unchanged | — | real | `lib/workspace-api-mocks.js` `buildMockBrief` (headings as a contract) |
| 97 | G0097 | G0103 | text contract heading: constraints | 3/3/3 | unchanged | — | real | as G0088 |
| 98 | G0098 | G0104 | text contract heading: open questions | 3/3/3 | unchanged | — | real | as G0088 |
| 101 | G0101 | G0097 | string set {'assistant', 'user'} as or-chain/if-chain [ID.role] | 4/6/6 | unchanged | — | borderline | lib/chat-transcript.js filterChatTurns (bypassed ×3) — role filter; `filterChatTurns` is bypassed three times (LIN-2430 residue) |
| 102 | G0102 | G0098 | repeated comparison type == 'text' | 3/3/5 | unchanged | — | noise | Three sites are ADF node types, one a Claude content block, one a DOM input type; different type namespaces that share the literal. |
| 107 | G0107 | G0110 | repeated comparison state == 'waiting' | 3/4/8 | unchanged | — | borderline | 'waiting' compared inline at 8 sites; UNENDED_STATES now lives in lib/task-state.js:28 (running, queued, waiting). Routing each read is modest cost. |
| 111 | G0111 | G0111 | named constant MONTHS=[Apr,Aug,Dec,Feb,Jan,Jul,Jun,Mar,May,Nov,Oct,Se… | 3/3/3 | unchanged | — | borderline | Identical 12-entry month table in home-view, render and task-page-loader; lib/utils/time.js already holds date helpers. Drift unlikely; sharing is ch… |
| 112 | G0112 | G0108 | string set {'number', 'string'} as or-chain [typeofID] | 3/3/3 | unchanged | — | noise | isScalar, the brief's date coercion and toEpochMs share a typeof idiom but answer different questions; no drifting rule. |
| 115 | G0115 | G0114 | repeated comparison status == 'error' | 3/3/5 | unchanged | — | noise | Grown by dispatch-factory.js:1074-1075, a local settleWithin shape; no shared home for a write status check. |
| 122 | G0122 | G0125 | tiny rule copied as a helper (anonymous)(), 9 copies of 1-4 statements | 3/9/9 | unchanged | — | noise | Nine stream-event callbacks, each a distinct consumer; the shared body is one token append. Not one decision to home. |
| 129 | G0129 | G0127 | tiny rule copied as a helper escapeHtml() (also: escapeXml), 3 copies… | 3/3/3 | unchanged | — | noise | escape helpers per output format |
| 131 | G0131 | G0134 | near-duplicate function buildMockRecapContext() (also: buildMockRecap… | 3/3/3 | unchanged | — | real | `lib/workspace-api-mocks.js` `buildMockRecapContext` |
| 132 | G0132 | G0133 | repeated comparison disposition == 'task-bound' | 3/3/7 | unchanged | — | borderline | Server disposition enum; observation.js branches on it 5 times with different actions. Only the deliverRulingStampOnly pair (2868, 3295) is one dupli… |
| 133 | G0133 | G0135 | tiny rule copied as a helper (anonymous)(), 3 copies of 1-4 statements | 3/3/3 | unchanged | — | real | Same mock child shaping in workspace-api-mocks.js:211, proxy-compute.js:122 and task-chat.js:75; home buildMockRecapContext in lib/workspace-api-mock… |
| 137 | G0137 | G0129 | repeated comparison provider == 'local' | 4/4/4 | unchanged | — | borderline | Four different uses, but workspace-api-audit.js:36 re-inlines shouldMockAi's test-plus-local predicate despite its comment. Needs one home or a docum… |
| 138 | G0138 | G0142 | string set {'queued', 'running'} as or-chain [ID.state, ID.outcome] | 3/4/5 | unchanged | — | real | running//queued test is inline at home-view:59, render-task-page:245/283, task-state:143 and recent-runs:82; task-state.js exports isOpenState/isUnen… |
| 141 | G0141 | G0144 | repeated comparison state == 'failed' | 3/4/7 | unchanged | — | borderline | `state == 'failed'` in task-state.js roll-ups and attention (`:144,:168,:275,:345`) and in home-view / task-board counts; `task-page-loader.js:648` (… |
| 146 | G0146 | G0140 | named constant UUID_REGEX=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a… | 3/3/3 | unchanged | — | borderline | lib/workspace.js; `UUID_REGEX` copies 6 → 3 |
| 147 | G0147 | G0153 | repeated comparison status == 'done' | 3/3/6 | grown | yes | noise | done status literal; unrelated meanings Re-read: the new site public/task-page.js:848 repeats the page's own :64/:73 reads of the server status; ruli… |
| 152 | G0152 | G0152 | named constant SWEEP_INSTANCE_PREFIX="sweep:v1:" | 3/3/3 | unchanged | — | real | `lib/observer-sweep.js` (the writer; uses an inline literal at :449) |
| 156 | G0156 | G0155 | repeated comparison phase == 'result' | 3/3/3 | unchanged | — | noise | phase literal in one module |
| 157 | G0157 | G0145 | string set {'0', '1', '2', '3', '4'} as table-keys [PRIORITY_WORDS, F… | 4/6/8 | unchanged | — | real | Priority number-to-name map re-declared at 6+ sites (home-view, local provider, swim x2, swipe, roadmap template); render.js already exports PRIORITY… |
| 158 | G0158 | G0175 | tiny rule copied as a helper stripCodeFence() (also: trimToNull, pars… | 4/4/6 | unchanged | — | noise | small parse helpers, coincidental similarity |
| 166 | G0166 | G0168 | repeated comparison state == 'needs-you' | 3/3/6 | unchanged | — | real | needsAPerson(state) already exists in task-state.js, yet task-state.js:275 inlines 'needs-you // failed' instead of calling it. Other sites are per-s… |
| 167 | G0167 | G0169 | repeated comparison state == 'queued' | 3/3/7 | unchanged | — | noise | Queued checks are per-site labels, tones, selection and mapping; the shared in-flight test is G0148, so this is not a separate rule. |
| 168 | G0168 | G0170 | repeated comparison waitingFor == 'ruling' | 3/3/7 | unchanged | — | borderline | task-page-loader tests model.waitingFor==='ruling' at 938, 991, 1017, 1471 though 991 derives waitingOnRuling once; one local would own it. Low cost. |
| 171 | G0171 | G0167 | repeated comparison name == 'linear' | 3/3/3 | unchanged | — | borderline | Grown; the test-only transport (dispatch-factory.js:948) is already a runs-and-dispatch Waiting entry (John, 7 Nov). |
| 172 | G0172 | G0188 | string set {'standard', 'stepper'} as array/ternary-chain [AUTOPILOT_… | 3/3/3 | unchanged | — | borderline | `lib/prompts/autopilot-kickoff.js` `AUTOPILOT_VARIANTS` — `AUTOPILOT_VARIANTS` already exists; callers should import it |
| 175 | G0175 | G0166 | repeated comparison category == 'auth' | 4/4/4 | unchanged | — | noise | Three sites read a classification they already hold; isAuthError exists for bare errors. Trivial token comparison, no drift risk. |
| 177 | G0177 | G0192 | repeated comparison variant == 'stepper' | 3/3/3 | unchanged | — | noise | Three local reads of a variant literal; the allowed-variant validator is elsewhere. Each read is local. |
| 182 | G0182 | G0180 | tiny rule copied as a helper _issueRef() (also: refOf, projectNeighbo… | 3/3/3 | unchanged | — | noise | Three ref projections returning different fields under different names. Not one decision. |
| 191 | G0191 | G0196 | tiny rule copied as a helper normalizePrivateKey() (also: cleanClaim,… | 3/3/3 | unchanged | — | noise | string cleanup helpers, coincidental |
| 192 | G0192 | G0185 | tiny rule copied as a helper constructor(), 5 copies of 1-4 statements | 3/5/5 | unchanged | — | noise | store constructors — reused from 10-18 G0149 (lead matched G0359, a groupKey twin) |
| 196 | G0196 | G0221 | text contract marker: [ticket-closer] | 3/4/4 | unchanged | — | borderline | Tag hardcoded in three route catch logs while ticket-close-closer.js owns a LOG const. A console prefix, not a posted marker; cost unclear. |
| 230 | G0230 | G0234 | repeated comparison state == 'parked' | 3/3/3 | unchanged | — | noise | Three sites: a text line, a task-state switch to 'waiting', and one evidence check on the same field; per-site, no shared rule re-derived. |
| 236 | G0236 | G0233 | string set {'backlog', 'canceled', 'completed', 'duplicate', 'started… | 3/5/11 | unchanged | — | real | `lib/providers/state-map.js` `getStateDisplay`/`getStateOrder` |
| 244 | G0244 | G0245 | repeated comparison outcome == 'self-resolved' | 3/4/7 | unchanged | — | noise | Machine-stamped outcome with one producer (ticket-close-closer.js); readers apply the same bucket. Not a duplicated decision. |
| 245 | G0245 | G0252 | string set {'backlog', 'started', 'unstarted'} as switch/array/table-… | 3/4/4 | unchanged | — | borderline | `lib/providers/state-map.js` (`isTerminalState`, `getStateOrder`) — state rank sets; covered by state-type-label-rank-maps |
| 271 | G0271 | G0267 | named constant UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]… | 3/3/3 | unchanged | — | noise | (`lib/workspace.js` `UUID_REGEX` exists) |
| 272 | G0272 | G0308 | string set {'backlog', 'unstarted'} as array/or-chain [stateTypes, ID… | 3/3/3 | unchanged | — | real | Ready set is queue-config stateTypes, re-inlined in recommendation-facts.js:201 and workspace-api-mocks.js:68. The isReadyState helper from 10-23 is … |
| 273 | G0273 | G0262 | near-duplicate function find() (also: componentFind), ~9 statements, … | 3/4/4 | unchanged | — | noise | union-find helper, generic |
| 290 | G0290 | G0302 | text contract marker: [close-out-merges] | 3/3/3 | unchanged | — | noise | Log-prefix literal repeated in two route catches while lib/close-out-merges.js keeps its own LOG; inert console tag, no consumer or test depends on i… |
| 291 | G0291 | G0281 | tiny rule copied as a helper (anonymous)() (also: loadLoops), 3 copie… | 3/3/3 | unchanged | — | borderline | The 13 calls already route through getLoopsForWorkspace; the duplicated part is the deps bundle plus lean:true in three fan-outs. Low-value consolida… |
| 305 | G0305 | G0297 | repeated comparison kind == 'evidence' | 3/3/3 | unchanged | — | noise | feedback kind literal |
| 316 | G0316 | G0315 | repeated comparison harness == 'opencode' | 3/4/4 | unchanged | — | noise | Four opencode checks are separate rules (option list, web-target refusal, model-id shape, running-total usage) that share a literal. |
| 353 | G0353 | G0352 | repeated comparison verdict == 'credential_dead' | 3/3/3 | unchanged | — | real | Server sites use exported CREDENTIAL_DEAD_VERDICT, but public/proxy.js:256 hardcodes 'credential_dead'. A rename would silently empty the browser fil… |
| 382 | G0382 | G0379 | repeated comparison setting == 'halt' | 3/3/4 | unchanged | — | real | Owner-only halt undo gate repeats at render-settings-workspace:49 and :215 while the route enforces it via haltRefusal; one predicate in workspace-ch… |
| 390 | G0390 | G0390 | tiny rule copied as a helper constructor(), 5 copies of 1-4 statements | 3/5/5 | unchanged | — | noise | Five cache and store constructors with different option sets and no shared base; a constructor signature is not a rule. |
| 391 | G0391 | G0391 | string set {'Deep Dive', 'Front Page', 'The Column', 'The Wire', 'Wea… | 3/4/4 | unchanged | — | real | `lib/ship-biscuit.js` `DESKS` (exported) |
| 396 | G0396 | G0397 | near-duplicate function stableStringify(), ~7 statements, same vocabu… | 3/3/3 | unchanged | — | real | one export of `stableStringify` in `lib/recap-cache.js` or a leaf module (LIN-3736 already proposes `lib/utils/`); 3 copies: `recap-cache.js:27`, `ru… |
| 414 | G0414 | G0413 | string set {'no-owner', 'not-owner', 'owner', 'unavailable'} as array… | 3/3/4 | unchanged | — | real | owner/not-owner/no-owner/unavailable validated in workspace-owner, exported as RUNNER_SETUP_STATES in render-runner-setup, and re-mapped by an if-cha… |
| 426 | G0426 | G0425 | named constant MS_PER_DAY=86400000 | 3/3/3 | unchanged | — | noise | `MS_PER_DAY` constant, inert |
| 446 | G0446 | G0444 | tiny rule copied as a helper cleanup(), 3 copies of 1-4 statements | 3/3/3 | unchanged | — | noise | `cleanup()` per store |
| 495 | G0495 | G0486 | tiny rule copied as a helper stableById() (also: byWorkspaceId), 3 co… | 3/3/3 | unchanged | — | noise | sort comparators |
| 526 | G0526 | G0495 | repeated comparison stateType == 'backlog' | 3/3/3 | unchanged | — | borderline | keepCard backlog rule is copied into public/ship.js:166 from lib/ship-layout.js:353; ship.js header says the inlining is deliberate (no build step). … |
| 536 | G0536 | G0524 | string set {'E', 'N', 'NE', 'NW', 'S', 'SE', +2} as array/table-keys … | 3/3/5 | unchanged | — | noise | (`lib/ship-layout.js` `BEARINGS` exists) |

**Summary.** 34 real, 28 borderline, 46 noise; run 6 had 34 / 27 / 46. The one movement is G0020 (`[skipped]`), which grew from a table group into `mustRule` through the blind read's prompt sites. It is ruled borderline, like the other marker groups: `dispatch-terminal` is the parse authority. No real group is new. Two of the window's real duplications (150, 151) are below the census's grouping bar: one is a ranking rule and one a single literal family. They are findings from the hand sweep, not census groups.

**SD's 27 `mustRule` groups, first ruling.** 2 real, 15 borderline, 10 noise. Machine copy: `census-SD-rulings-run7.tsv`.

| rank | id | decision | a/f/s | ruling | reason |
|---|---|---|---|---|---|
| 1 | G0001 | text contract marker: [failed] | 6/10/39 | borderline | The terminal marker each emitter writes; the grammar is the runner contract's (held byte-identical with Harbour's), so the copies are emit sites of one contract, not a second rule. |
| 2 | G0002 | string set {'ignore', 'pipe'} as array [stdio] | 5/10/15 | noise | Node spawn stdio options; a platform idiom, each site configures its own child. |
| 3 | G0003 | text contract marker: [working] | 4/6/12 | real | The heartbeat grammar is spelled at both ends with no named home: Harbour ledger row 140 (LIN-3828, Backlog). heartbeat.js should own it. |
| 4 | G0004 | tiny rule copied as a helper onAttemptFailed(), 4 copies of 1-4 statements | 4/4/4 | noise | One-line oplog callbacks per terminal-post caller; each logs its own event. |
| 5 | G0005 | text contract marker: [done] | 5/5/8 | borderline | Emit sites of the contract's report line; parse authority is Harbour's dispatch-terminal; held by the contract's report rows. |
| 6 | G0006 | repeated comparison phase == 'AWAITING_FOLLOWUP' | 3/5/8 | borderline | Phase literal read in hook, liveness and heartbeat; a phase constant would name it, but each site asks a different question of the phase. |
| 7 | G0007 | text contract marker: [blocked] | 4/4/4 | borderline | As [done]: emit sites (hook, opencode-runner) plus a test and a report script; the contract holds the grammar. |
| 8 | G0008 | text contract marker: [pending] | 4/4/5 | borderline | As [blocked]. |
| 9 | G0009 | repeated comparison phase == 'CANCELLED' | 2/2/5 | noise | Phase checks in the dispatcher and the hook's own cancel path; one state machine read locally. |
| 10 | G0010 | repeated comparison code == 'ENOENT' | 3/3/3 | noise | Standard missing-file errno check. |
| 11 | G0011 | repeated comparison harness == 'opencode' | 2/3/16 | borderline | Harness switch at 16 sites, mostly reapers.js; each branch differs, but no harness table owns the per-harness facts. |
| 12 | G0012 | text contract marker: [evidence] | 2/3/4 | borderline | Emit sites of the evidence prefix in both harness relays and links.js; the prefix is a contract row. |
| 13 | G0013 | repeated comparison livenessSignal == 'transcript-hook' | 2/2/7 | borderline | Liveness-signal literal in dispatcher and reapers; one enum without a constant, read for different decisions. |
| 14 | G0014 | repeated comparison type == 'text' | 3/4/10 | noise | Claude/opencode content-block type; an external enum. |
| 15 | G0015 | repeated comparison kind == 'pending' | 2/2/2 | noise | Two different kind spaces (a sentinel kind in hook.js, an outstanding-work kind in reapers.js). |
| 16 | G0016 | repeated comparison role == 'assistant' | 3/4/6 | noise | Transcript message role; an external enum. |
| 17 | G0017 | named constant LINK_CAP=8 | 2/2/2 | borderline | Deliberately local per opencode-runner.js's own comment (plan decision 5); two relays, one number, joined by that comment only. |
| 18 | G0018 | near-duplicate function deriveEvidenceScope() (also: resolveScope) | 2/2/2 | real | The evidence scope (GitHub owner, Linear org) is derived twice: hook.js resolveScope and opencode-runner.js deriveEvidenceScope, each over links.js's parsers; one helper in links.js would hold it. |
| 19 | G0019 | repeated comparison kind == 'blocked' | 2/2/3 | borderline | The sentinel parse is shared (parseCompletionSentinel, imported by opencode-runner.js); the per-kind actions differ by harness. |
| 20 | G0020 | repeated comparison kind == 'failed' | 2/2/2 | borderline | As G0019. |
| 21 | G0021 | repeated comparison kind == 'pending-external' | 2/2/3 | borderline | As G0019. |
| 22 | G0022 | repeated comparison kind == 'pending-internal' | 2/2/2 | borderline | As G0019. |
| 23 | G0023 | repeated comparison mode == 'stop' | 1/2/6 | borderline | Halt mode literal in dispatcher and halt.js; halt.js is the home and the dispatcher re-reads the literal (Harbour row 10, cross-repo halt vocabulary). |
| 24 | G0024 | repeated comparison action == 'reject' | 1/2/4 | noise | A local action enum in the dispatcher and the follow-up path; one module family. |
| 25 | G0025 | text contract marker: [aborted] | 2/2/3 | borderline | Emit and report-read of one marker; a contract row would hold it. |
| 42 | G0042 | repeated comparison type == 'tool_use' | 3/3/6 | noise | Transcript content-block type; external enum. |
| 43 | G0043 | tiny rule copied as a helper readJson() (also: readMarkerFile, readRecordedIdentity) | 3/4/5 | noise | Small JSON-read helpers in test probes and stores; coincidental. |

## Census table groups (320; no ruling, per the method)

All 320 `table` groups at `e2d4659c4`, with no ruling. Machine copy: `census-table-groups-run7.tsv`. 308 are unchanged, 8 new and 4 grown. Of the 12 that moved:
- seven come from the blind read (G0100, G0113, G0121, G0363, G0367, G0401, G0450);
- three from the timeline (G0473, G0576, G0577);
- one from the cost read (G0400);
- G0529 is the redeclared `COMPLETED` (151).

Of those, only G0529 (151) is discussed in prose, and G0363 under 151, since its heading is the one `lib/completion-signals.js` retypes. The rest are ruled through the findings above or are noise.

<details><summary>The 320 table groups</summary>

| rank | id | detector | decision | a/f/s | status |
|---|---|---|---|---|---|
| 27 | G0027 | cmp | repeated comparison target == 'local' | 2/5/5 | unchanged |
| 28 | G0028 | record | literal record repeated verbatim {Cache-Control="no-cache", Connection="keep-al… | 2/5/7 | unchanged |
| 29 | G0029 | set+discrim | string set {'aborted', 'done', 'failed', 'skipped'} as array/Set/or-chain/table… | 2/8/10 | unchanged |
| 31 | G0031 | cmp | repeated comparison status == 'queued' | 2/5/6 | unchanged |
| 32 | G0032 | contract | text contract heading: what ci did not prove | 2/6/8 | unchanged |
| 38 | G0038 | cmp | repeated comparison marker == 'pending' | 1/5/11 | unchanged |
| 47 | G0047 | clone | tiny rule copied as a helper clear(), 5 copies of 1-4 statements | 2/5/5 | unchanged |
| 50 | G0050 | cmp | repeated comparison disposition == 'resumable' | 2/4/8 | unchanged |
| 53 | G0053 | record | record assembled from the same sources {id=ID.id, title=ID.title, labels=Logica… | 2/3/3 | unchanged |
| 54 | G0054 | contract | text contract marker: [db-indexes] | 2/2/9 | unchanged |
| 56 | G0056 | clone | near-duplicate function clear() (also: clearHistory), ~7 statements, fuzzy | 1/4/4 | unchanged |
| 58 | G0058 | cmp | repeated comparison provider == 'github' | 2/2/3 | unchanged |
| 59 | G0059 | cmp | repeated comparison provider == 'github-projects' | 2/2/2 | unchanged |
| 61 | G0061 | cmp | repeated comparison state == 'record' | 2/3/3 | unchanged |
| 62 | G0062 | contract | text contract marker: [dispatch] | 2/3/4 | unchanged |
| 63 | G0063 | record | literal record repeated verbatim {effort=null, harness=null, model=null} | 2/2/2 | unchanged |
| 64 | G0064 | const | named constant TOKEN_REFRESH_BUFFER_MS=300000 | 2/2/2 | unchanged |
| 65 | G0065 | cmp | repeated comparison rawTeam == 'all' | 2/2/2 | unchanged |
| 66 | G0066 | set | string set {'LINEAR_CLIENT_ID', 'LINEAR_CLIENT_SECRET', 'LINEAR_REDIRECT_URI'} … | 2/2/2 | unchanged |
| 67 | G0067 | cmp | repeated comparison getAttribute() == 'true' | 1/4/7 | unchanged |
| 68 | G0068 | contract | text contract marker: [ci-wake-sweep] | 2/2/5 | unchanged |
| 69 | G0069 | contract | text contract marker: [liveness-alarm-sweep] | 2/2/2 | unchanged |
| 70 | G0070 | cmp | repeated comparison kind == 'more-of-parent' | 2/2/3 | unchanged |
| 71 | G0071 | cmp | repeated comparison kind == 'search' | 2/2/2 | unchanged |
| 72 | G0072 | record | record assembled from the same sources {urlKey=ID.urlKey, workspaceId=ID.id, ac… | 2/2/2 | unchanged |
| 73 | G0073 | cmp | repeated comparison kind == 'capture' | 2/2/2 | unchanged |
| 74 | G0074 | cmp | repeated comparison urlKey == 'test-workspace' | 2/2/6 | unchanged |
| 75 | G0075 | record | record assembled from the same sources {githubEnabled=getProvider().entryCta.is… | 2/2/2 | unchanged |
| 76 | G0076 | cmp | repeated comparison via == 'proxy' | 2/2/3 | unchanged |
| 77 | G0077 | cmp | repeated comparison finishReason == 'length' | 2/5/7 | unchanged |
| 78 | G0078 | set+discrim | string set {'decision-answer', 'decision-withdrawal-reversed', 'decision-withdr… | 2/5/5 | unchanged |
| 79 | G0079 | cmp | repeated comparison target == 'web' | 2/4/5 | unchanged |
| 80 | G0080 | set+discrim | string set {'github', 'github-projects'} as Set/array/or-chain [REMINT_KINDS, I… | 2/6/6 | unchanged |
| 82 | G0082 | const | named constant CONTEXT_FETCH_TIMEOUT_MS=45000 | 2/2/2 | unchanged |
| 85 | G0085 | cmp | repeated comparison subscription == 'none' | 1/3/3 | unchanged |
| 86 | G0086 | clone | tiny rule copied as a helper bump() (also: touchAndEvict, noteCredential), 3 co… | 2/3/3 | unchanged |
| 87 | G0087 | contract | text contract marker: [aborted] | 2/3/9 | unchanged |
| 88 | G0088 | cmp | repeated comparison source == 'free' | 2/3/3 | unchanged |
| 89 | G0089 | cmp | repeated comparison kind == 'decision' | 1/4/6 | unchanged |
| 90 | G0090 | const | named constant DANGEROUS_CHARS_REGEX=/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/ | 2/4/4 | unchanged |
| 91 | G0091 | const | named constant MAX_NAME_LENGTH=1000 | 2/4/4 | unchanged |
| 94 | G0094 | cmp | repeated comparison mode == 'add-source' | 2/6/28 | unchanged |
| 95 | G0095 | clone | tiny rule copied as a helper onEvent() (also: (anonymous)), 5 copies of 1-4 sta… | 2/4/5 | unchanged |
| 99 | G0099 | clone | tiny rule copied as a helper buildPromptFilename(), 3 copies of 1-4 statements | 2/3/3 | unchanged |
| 100 | G0100 | set | string set {'autopilot', 'blind-read', 'blocked', 'breakdown', 'bug', 'close-ou… | 2/3/3 | new |
| 103 | G0103 | clone | near-duplicate function (anonymous)() (also: relayDispatchRefusal), ~10 stateme… | 2/2/2 | unchanged |
| 104 | G0104 | clone | tiny rule copied as a helper (anonymous)(), 3 copies of 1-4 statements | 2/3/3 | unchanged |
| 105 | G0105 | clone | near-duplicate function clear(), ~7 statements, structurally identical | 2/8/8 | unchanged |
| 106 | G0106 | cmp | repeated comparison readyState == 'loading' | 1/4/4 | unchanged |
| 108 | G0108 | cmp | repeated comparison toLowerCase() == 'bug' | 2/3/3 | unchanged |
| 109 | G0109 | clone | tiny rule copied as a helper (anonymous)(), 5 copies of 1-4 statements | 1/3/5 | unchanged |
| 110 | G0110 | cmp | repeated comparison phase == 'proposed' | 2/4/5 | unchanged |
| 113 | G0113 | contract | text contract heading: workflow | 1/3/15 | grown |
| 114 | G0114 | discrim | string set {'1', 'true'} as or-chain [ID.query.cachedOnly, ID.query.noDescend, … | 2/3/6 | unchanged |
| 117 | G0117 | cmp | repeated comparison name == 'list_pending_decisions' | 2/3/3 | unchanged |
| 120 | G0120 | cmp | repeated comparison tagName == 'SELECT' | 1/3/3 | unchanged |
| 121 | G0121 | cmp | repeated comparison kind == 'close-out' | 2/4/4 | grown |
| 123 | G0123 | set+discrim | string set {'done', 'failed'} as or-chain/table-keys [ID.terminalStatus, PILL_G… | 2/3/3 | unchanged |
| 124 | G0124 | cmp | repeated comparison kind == 'periodical' | 2/3/3 | unchanged |
| 125 | G0125 | cmp | repeated comparison value == 'true' | 2/3/3 | unchanged |
| 126 | G0126 | cmp | repeated comparison state == 'closed' | 2/5/5 | unchanged |
| 127 | G0127 | cmp | repeated comparison id == '__periodicals__' | 2/4/5 | unchanged |
| 128 | G0128 | clone | tiny rule copied as a helper enqueueGuard() (also: haltRefusal), 3 copies of 1-… | 1/3/3 | unchanged |
| 130 | G0130 | cmp | repeated comparison kind == 'recap' | 2/2/3 | unchanged |
| 135 | G0135 | record | record assembled from the same sources {urlKey=ID.urlKey, identifier=ID.identif… | 1/3/3 | unchanged |
| 136 | G0136 | clone | tiny rule copied as a helper header() (also: setupNoticeHtml), 3 copies of 1-4 … | 1/3/3 | unchanged |
| 139 | G0139 | cmp | repeated comparison section == 'prompt' | 2/2/2 | unchanged |
| 140 | G0140 | cmp | repeated comparison section == 'reasoning' | 2/2/2 | unchanged |
| 143 | G0143 | contract | text contract marker: [pending] | 2/2/4 | unchanged |
| 144 | G0144 | set | string set {'backlog', 'done', 'failed', 'in-progress', 'todo'} as table-keys [… | 2/3/3 | unchanged |
| 145 | G0145 | cmp | repeated comparison section == 'recent-activity' | 2/3/5 | unchanged |
| 148 | G0148 | record | record assembled from the same sources {urlKey=ID.urlKey, workspaceId=ID.id, ow… | 2/3/3 | unchanged |
| 149 | G0149 | cmp | repeated comparison agentState == 'queued' | 2/3/4 | unchanged |
| 153 | G0153 | cmp | repeated comparison kind == 'bootstrap' | 2/3/9 | unchanged |
| 154 | G0154 | const | named constant HOUR_MS=3600000 | 2/4/4 | unchanged |
| 160 | G0160 | const | named constant COMPANION_INSTANCE_PREFIX="companion:v1:" | 2/3/3 | unchanged |
| 161 | G0161 | cmp | repeated comparison phase == 'error' | 2/3/3 | unchanged |
| 162 | G0162 | cmp | repeated comparison state == 'open' | 2/5/6 | unchanged |
| 163 | G0163 | set+discrim | string set {'complete', 'error'} as Set/or-chain [LOOP_TERMINAL_AGENT_STATES, T… | 2/3/4 | unchanged |
| 165 | G0165 | cmp | repeated comparison protocol == 'https:' | 2/2/2 | unchanged |
| 169 | G0169 | clone | tiny rule copied as a helper (anonymous)(), 5 copies of 1-4 statements | 1/3/5 | unchanged |
| 176 | G0176 | clone | tiny rule copied as a helper constructor(), 6 copies of 1-4 statements | 2/6/6 | unchanged |
| 178 | G0178 | clone | tiny rule copied as a helper msSince() (also: (anonymous)), 3 copies of 1-4 sta… | 2/3/3 | unchanged |
| 179 | G0179 | record | record assembled from the same sources {runs=ID.runs, priced=ID.priced, unprice… | 2/2/2 | unchanged |
| 181 | G0181 | clone | tiny rule copied as a helper (anonymous)(), 6 copies of 1-4 statements | 1/4/6 | unchanged |
| 183 | G0183 | set+discrim | string set {'http:', 'https:'} as array/or-chain [[...].includes, ID.protocol] | 2/4/4 | unchanged |
| 184 | G0184 | const | named constant POLL_MS=5000 | 1/3/3 | unchanged |
| 185 | G0185 | contract | text contract marker: [working] | 2/3/3 | unchanged |
| 187 | G0187 | cmp | repeated comparison kind == 'brief' | 2/3/4 | unchanged |
| 188 | G0188 | cmp | repeated comparison source == 'live' | 1/3/4 | unchanged |
| 189 | G0189 | cmp | repeated comparison status == 'aborted' | 1/3/11 | unchanged |
| 190 | G0190 | cmp | repeated comparison turnKind == 'boot' | 2/3/18 | unchanged |
| 193 | G0193 | cmp | repeated comparison code == 'OUTPUT_TRUNCATED' | 2/3/3 | unchanged |
| 197 | G0197 | clone | near-duplicate function relativeTime() (also: renderDeployInfo), ~22 statements… | 2/2/2 | unchanged |
| 198 | G0198 | cmp | repeated comparison disposition == 'gone' | 2/2/5 | unchanged |
| 199 | G0199 | cmp | repeated comparison state == 'unknown' | 2/3/5 | unchanged |
| 200 | G0200 | cmp | repeated comparison status == 'merged' | 2/3/4 | unchanged |
| 201 | G0201 | clone | near-duplicate function groupLoopsByLineage() (also: runsByLineage), ~10 statem… | 2/2/2 | unchanged |
| 202 | G0202 | record | record assembled from the same sources {urlKey=ID.proxyUrlKey, createdBy=ID.pro… | 2/2/2 | unchanged |
| 203 | G0203 | record | literal record repeated verbatim {label="__ai__", name=null, why="Generate the … | 2/2/2 | unchanged |
| 204 | G0204 | clone | near-duplicate function firstPromptLine() (also: toStackHeadline), ~6 statement… | 2/2/2 | unchanged |
| 205 | G0205 | cmp | repeated comparison rung == 'run-task' | 2/2/2 | unchanged |
| 206 | G0206 | set | string set {'done', 'next-step', 'pr'} as array | 2/2/2 | unchanged |
| 207 | G0207 | discrim | string set {'done', 'pr'} as or-chain [ID.filledRung, ID()] | 2/2/3 | unchanged |
| 208 | G0208 | set | string set {'canceled', 'completed', 'duplicate'} as array [TERMINAL_TYPES] | 2/2/2 | unchanged |
| 209 | G0209 | clone | near-duplicate function computeFitZoom(), ~11 statements, same vocabulary (dial… | 2/2/2 | unchanged |
| 212 | G0212 | clone | near-duplicate function (anonymous)(), ~7 statements, same vocabulary (dialect … | 2/2/2 | unchanged |
| 213 | G0213 | clone | near-duplicate function clampTimelineWindow() (also: clampWindow), ~12 statemen… | 2/2/2 | unchanged |
| 214 | G0214 | clone | near-duplicate function computeTimelineFit(), ~10 statements, same vocabulary (… | 2/2/2 | unchanged |
| 215 | G0215 | clone | near-duplicate function computeTimelineZoom(), ~15 statements, same vocabulary … | 2/2/2 | unchanged |
| 216 | G0216 | clone | near-duplicate function renderChip(), ~8 statements, fuzzy | 2/2/2 | unchanged |
| 217 | G0217 | clone | near-duplicate function renderSegmentBar(), ~17 statements, fuzzy | 2/2/2 | unchanged |
| 218 | G0218 | clone | near-duplicate function renderStatusPill(), ~18 statements, fuzzy | 2/2/2 | unchanged |
| 219 | G0219 | clone | near-duplicate function renderSurface(), ~11 statements, fuzzy | 2/2/2 | unchanged |
| 220 | G0220 | clone | near-duplicate function renderTag(), ~11 statements, fuzzy | 2/2/2 | unchanged |
| 221 | G0221 | clone | tiny rule copied as a helper (anonymous)(), 3 copies of 1-4 statements | 1/3/3 | unchanged |
| 222 | G0222 | record | record assembled from the same sources {remaining=ID.remaining, limit=ID.limit} | 2/2/3 | unchanged |
| 224 | G0224 | clone | tiny rule copied as a helper ui(), 4 copies of 1-4 statements | 1/4/4 | unchanged |
| 225 | G0225 | cmp | repeated comparison status == 'skipped' | 2/3/3 | unchanged |
| 226 | G0226 | discrim | string set {'closed', 'multiple-prs', 'no-pr', 'not-ready'} as or-chain [ID.sta… | 2/3/3 | unchanged |
| 229 | G0229 | clone | tiny rule copied as a helper buildBriefMessages() (also: buildRoadmapGapMessage… | 2/8/8 | unchanged |
| 234 | G0234 | set | string set {'cli', 'web'} as Set/array [RESUMABLE_TARGETS] | 1/3/3 | unchanged |
| 235 | G0235 | contract | text contract marker: [usage] | 1/3/4 | unchanged |
| 237 | G0237 | const | named constant MAX_IDENTIFIER_LENGTH=100 | 2/2/2 | unchanged |
| 238 | G0238 | cmp | repeated comparison mergedBy == 'close-out' | 2/2/2 | unchanged |
| 239 | G0239 | cmp | repeated comparison built == 'unknown' | 2/2/2 | unchanged |
| 241 | G0241 | cmp | repeated comparison reason == 'free-tier' | 2/2/3 | unchanged |
| 242 | G0242 | cmp | repeated comparison status == 'proposed' | 2/2/2 | unchanged |
| 243 | G0243 | cmp | repeated comparison tierOf() == 'deferred' | 2/2/3 | unchanged |
| 247 | G0247 | set | string set {'cdn.linear.app', 'linear.app', 'uploads.linear.app'} as Set [LINEA… | 2/2/2 | unchanged |
| 248 | G0248 | set+discrim | string set {'home-up-next', 'in-progress', 'project', 'recent-activity'} as or-… | 2/2/2 | unchanged |
| 249 | G0249 | set | string set {'High', 'Low', 'Medium', 'No priority', 'Urgent'} as array [PRIORIT… | 2/2/2 | unchanged |
| 250 | G0250 | clone | tiny rule copied as a helper (anonymous)(), 4 copies of 1-4 statements | 2/3/4 | unchanged |
| 251 | G0251 | cmp | repeated comparison pageMode == 'backlog' | 2/2/2 | unchanged |
| 252 | G0252 | cmp | repeated comparison singleUse == 'true' | 2/2/2 | unchanged |
| 253 | G0253 | clone | tiny rule copied as a helper countFor() (also: lookupsFor), 3 copies of 1-4 sta… | 2/3/3 | unchanged |
| 254 | G0254 | const | named constant ARCHIVE_PAGE_SIZE=30 | 2/2/2 | unchanged |
| 255 | G0255 | const | named constant STALE_AFTER_MS=86400000 | 2/2/2 | unchanged |
| 256 | G0256 | clone | near-duplicate function (anonymous)(), ~6 statements, fuzzy | 2/2/2 | unchanged |
| 257 | G0257 | record | record assembled from the same sources {promptMeta=ID.promptMeta, defaultPrompt… | 2/2/2 | unchanged |
| 258 | G0258 | cmp | repeated comparison status == 'priced' | 2/2/3 | unchanged |
| 259 | G0259 | cmp | repeated comparison view == 'sessions' | 2/2/2 | unchanged |
| 261 | G0261 | record | literal record repeated verbatim {lastCensusSnapshot=null, lastCensusStateHash=… | 2/2/2 | unchanged |
| 263 | G0263 | cmp | repeated comparison openRouterSource == 'free' | 2/3/3 | unchanged |
| 265 | G0265 | cmp | repeated comparison format == 'md' | 2/2/2 | unchanged |
| 266 | G0266 | cmp | repeated comparison turnKind == 'auto-wake' | 2/2/5 | unchanged |
| 269 | G0269 | cmp | repeated comparison by == 'close-out' | 2/2/2 | unchanged |
| 274 | G0274 | clone | tiny rule copied as a helper isId() (also: shortString, (anonymous), isSafeSing… | 1/4/6 | unchanged |
| 277 | G0277 | cmp | repeated comparison view == 'digest' | 2/2/2 | unchanged |
| 281 | G0281 | discrim | string set {'gone', 'resumable', 'task-bound'} as or-chain | 2/2/2 | unchanged |
| 282 | G0282 | cmp | repeated comparison verdict == 'approve' | 1/3/3 | unchanged |
| 283 | G0283 | record | literal record repeated verbatim {effort="none", harness="none", model="none"} | 2/2/2 | unchanged |
| 285 | G0285 | cmp | repeated comparison category == 'upstream' | 2/2/2 | unchanged |
| 286 | G0286 | cmp | repeated comparison state == 'none' | 2/2/2 | unchanged |
| 287 | G0287 | cmp | repeated comparison viewer == 'owner' | 2/2/3 | unchanged |
| 288 | G0288 | discrim | string set {'comment', 'description'} as ternary-chain/or-chain [ID.where] | 2/2/2 | unchanged |
| 289 | G0289 | clone | near-duplicate function deleteByConnection() (also: deleteUserPreferences, dele… | 1/3/3 | unchanged |
| 293 | G0293 | cmp | repeated comparison state == 'dead' | 2/2/3 | unchanged |
| 296 | G0296 | clone | near-duplicate function listForWorkspaces() (also: listUnansweredForWorkspaces)… | 1/3/3 | unchanged |
| 297 | G0297 | discrim | string set {'answered', 'dismissed'} as or-chain [ID.outcome] | 2/4/7 | unchanged |
| 300 | G0300 | cmp | repeated comparison tier == 'not reported' | 2/2/2 | unchanged |
| 301 | G0301 | cmp | repeated comparison outcome == 'dismissed' | 2/3/4 | unchanged |
| 306 | G0306 | cmp | repeated comparison mode == 'new' | 1/3/5 | unchanged |
| 307 | G0307 | cmp | repeated comparison status == 'fulfilled' | 2/4/6 | unchanged |
| 308 | G0308 | clone | near-duplicate function cleanup(), ~8 statements, fuzzy | 1/3/3 | unchanged |
| 309 | G0309 | cmp | repeated comparison deriveTerminalStatus() == 'done' | 1/3/3 | unchanged |
| 311 | G0311 | cmp | repeated comparison kind == 'backlog' | 2/2/2 | unchanged |
| 313 | G0313 | contract | text contract marker: [as-asked] | 2/2/10 | unchanged |
| 314 | G0314 | clone | near-duplicate function constructor(), ~5 statements, fuzzy | 1/3/3 | unchanged |
| 315 | G0315 | clone | tiny rule copied as a helper resolveCanonicalDegraded() (also: resolveCanonical… | 1/3/3 | unchanged |
| 324 | G0324 | cmp | repeated comparison state == 'reached' | 2/2/2 | unchanged |
| 327 | G0327 | set | string set {'acting', 'deciding', 'orienting', 'reporting', 'watching'} as arra… | 2/2/2 | unchanged |
| 329 | G0329 | set | string set {'blocked', 'queued', 'resolved', 'silent', 'terminal', 'unknown', +… | 2/3/3 | unchanged |
| 334 | G0334 | set | string set {'dispatch', 'record', 'resume'} as Set/table-keys [ON_ANSWER_EFFECT… | 2/2/2 | unchanged |
| 335 | G0335 | discrim | string set {'indeterminate', 'mid-turn'} as or-chain [ID.disposition] | 2/2/2 | unchanged |
| 338 | G0338 | cmp | repeated comparison kind == 'decision-withdrawn' | 2/2/2 | unchanged |
| 339 | G0339 | set | string set {'fable', 'haiku', 'opus', 'sonnet'} as array [CLAUDE_MAPPABLE_MODEL… | 2/2/3 | unchanged |
| 340 | G0340 | clone | near-duplicate function get(), ~7 statements, fuzzy | 2/6/6 | unchanged |
| 342 | G0342 | cmp | repeated comparison haltMode == 'pause' | 2/2/2 | unchanged |
| 343 | G0343 | cmp | repeated comparison haltMode == 'stop' | 2/2/2 | unchanged |
| 344 | G0344 | record | literal record repeated verbatim {_id=0, createdAt=1, createdBy=1, urlKey=1, wo… | 2/2/2 | unchanged |
| 349 | G0349 | cmp | repeated comparison name == 'send_follow_up' | 2/2/3 | unchanged |
| 351 | G0351 | contract | text contract heading: adversarial second-read | 2/2/2 | unchanged |
| 352 | G0352 | cmp | repeated comparison role == 'owner' | 2/3/4 | unchanged |
| 356 | G0356 | cmp | repeated comparison role == 'user' | 2/3/6 | unchanged |
| 358 | G0358 | cmp | repeated comparison kind == 'review' | 2/2/2 | unchanged |
| 360 | G0360 | cmp | repeated comparison kind == 'plan' | 2/3/3 | unchanged |
| 363 | G0363 | contract | text contract heading: blind read | 2/2/4 | new |
| 364 | G0364 | const | named constant DAY_MS=86400000 | 2/2/2 | unchanged |
| 365 | G0365 | const | named constant MAX_REASON_LENGTH=500 | 2/2/2 | unchanged |
| 367 | G0367 | cmp | repeated comparison kind == 'blind-read' | 2/2/2 | new |
| 368 | G0368 | cmp | repeated comparison message == 'reverseOutcome: row is not self-resolved' | 2/2/2 | unchanged |
| 371 | G0371 | cmp | repeated comparison variant == 'standard' | 2/2/2 | unchanged |
| 372 | G0372 | set | string set {'inside', 'outside', 'total', 'unknown'} as array/table-keys [[...]… | 2/2/2 | unchanged |
| 374 | G0374 | clone | near-duplicate function _pruneToCapacity(), ~6 statements, fuzzy | 2/5/5 | unchanged |
| 375 | G0375 | clone | tiny rule copied as a helper clampText(), 3 copies of 1-4 statements | 2/3/3 | unchanged |
| 381 | G0381 | contract | text contract heading: workspace api access (auto-appended) | 2/2/2 | unchanged |
| 387 | G0387 | cmp | repeated comparison code == 'ERR_FR_TOO_MANY_REDIRECTS' | 2/2/2 | unchanged |
| 388 | G0388 | cmp | repeated comparison message == 'unexpected redirect' | 2/2/2 | unchanged |
| 389 | G0389 | clone | near-duplicate function generateBrief() (also: generateFeedbackTitle, generateR… | 2/5/5 | unchanged |
| 392 | G0392 | const | named constant LANE_KEYS=[blocked,queued,resolved,silent,terminal,unknown,worki… | 2/2/2 | unchanged |
| 393 | G0393 | clone | near-duplicate function peakToolCount() (also: toolPeakOf), ~9 statements, fuzzy | 2/2/2 | unchanged |
| 397 | G0397 | set | string set {'/common-actions.css', '/escalation-kpis.css', '/style.css'} as arr… | 1/3/3 | unchanged |
| 399 | G0399 | clone | near-duplicate function listEvents() (also: listTraces), ~9 statements, fuzzy | 2/2/2 | unchanged |
| 400 | G0400 | cmp | repeated comparison completeness == 'complete' | 1/3/7 | grown |
| 401 | G0401 | cmp | repeated comparison kind == 'leftover' | 1/3/3 | grown |
| 405 | G0405 | cmp | repeated comparison s == 'complete' | 2/2/2 | unchanged |
| 407 | G0407 | record | literal record repeated verbatim {_id=0, createdAt=1, createdBy=1, urlKey=1} | 2/2/2 | unchanged |
| 408 | G0408 | const | named constant TIMELINE_WINDOW_MS=86400000 | 2/2/2 | unchanged |
| 410 | G0410 | record | record assembled from the same sources {urlKey=ID.urlKey, prUrl=ID.prUrl, headS… | 2/2/3 | unchanged |
| 411 | G0411 | set | string set {'autopilot', 'save', 'triage'} as table-keys/Set [SENDING_STATUS, D… | 2/2/3 | unchanged |
| 413 | G0413 | set+discrim | string set {'dark', 'light'} as array/or-chain [VALID_THEMES, ID.session.theme] | 2/2/2 | unchanged |
| 415 | G0415 | clone | tiny rule copied as a helper getAccount() (also: getById, getWorkspace, getWork… | 2/3/4 | unchanged |
| 416 | G0416 | const | named constant DEFAULT_HUMAN_NICK="John" | 2/2/2 | unchanged |
| 418 | G0418 | cmp | repeated comparison type == 'backlog' | 2/2/3 | unchanged |
| 419 | G0419 | set | string set {'first go', 'firstGo'} as array | 2/2/2 | unchanged |
| 420 | G0420 | set | string set {'login', 'signed up'} as array | 2/2/2 | unchanged |
| 421 | G0421 | set | string set {'merge clicked', 'mergeClicked'} as array | 2/2/2 | unchanged |
| 422 | G0422 | set | string set {'pr opened', 'prOpened'} as array | 2/2/2 | unchanged |
| 423 | G0423 | clone | near-duplicate function delete(), ~7 statements, fuzzy | 2/5/5 | unchanged |
| 424 | G0424 | cmp | repeated comparison trim() == '---' | 1/5/5 | unchanged |
| 425 | G0425 | clone | tiny rule copied as a helper get(), 5 copies of 1-4 statements | 2/5/5 | unchanged |
| 427 | G0427 | clone | near-duplicate function briefUrl() (also: recapUrl, scanUrl), ~6 statements, fu… | 1/3/3 | unchanged |
| 428 | G0428 | cmp | repeated comparison field == 'harness' | 2/3/3 | unchanged |
| 429 | G0429 | discrim | string set {'fresh', 'stale'} as if-chain [ID.status] | 1/3/4 | unchanged |
| 434 | G0434 | cmp | repeated comparison provider == 'email' | 2/2/2 | unchanged |
| 436 | G0436 | set+discrim | string set {'jira', 'linear'} as Set/or-chain [REFRESH_TOKEN_KINDS] | 2/2/2 | unchanged |
| 437 | G0437 | contract | text contract marker: [credential-adopted] | 2/2/3 | unchanged |
| 442 | G0442 | cmp | repeated comparison source == 'model' | 2/2/2 | unchanged |
| 443 | G0443 | cmp | repeated comparison source == 'workspace' | 2/2/2 | unchanged |
| 444 | G0444 | cmp | repeated comparison type == 'heading' | 2/2/2 | unchanged |
| 445 | G0445 | clone | tiny rule copied as a helper (anonymous)(), 3 copies of 1-4 statements | 2/3/3 | unchanged |
| 447 | G0447 | clone | near-duplicate function formatFossilThreshold() (also: formatStaleThreshold), ~… | 2/2/2 | unchanged |
| 448 | G0448 | cmp | repeated comparison filter == 'set' | 2/2/2 | unchanged |
| 449 | G0449 | cmp | repeated comparison mode == 'resume' | 2/2/3 | unchanged |
| 450 | G0450 | cmp | repeated comparison stage == 'blind-read' | 2/2/2 | new |
| 452 | G0452 | clone | near-duplicate function list() (also: listByWorkspace), ~9 statements, fuzzy | 2/4/4 | unchanged |
| 453 | G0453 | contract | text contract marker: [string] | 2/3/4 | unchanged |
| 454 | G0454 | clone | tiny rule copied as a helper fetchBriefStatus() (also: fetchContext, fetchRecap… | 1/3/3 | unchanged |
| 455 | G0455 | cmp | repeated comparison act == 'copy' | 2/2/3 | unchanged |
| 458 | G0458 | cmp | repeated comparison scope == 'job' | 2/2/3 | unchanged |
| 463 | G0463 | clone | near-duplicate function get(), ~9 statements, structurally identical | 2/4/4 | unchanged |
| 464 | G0464 | clone | near-duplicate function orderByDependency(), ~59 statements, same vocabulary (d… | 2/4/4 | unchanged |
| 465 | G0465 | clone | tiny rule copied as a helper delete(), 4 copies of 1-4 statements | 2/4/4 | unchanged |
| 466 | G0466 | clone | tiny rule copied as a helper put(), 4 copies of 1-4 statements | 2/4/4 | unchanged |
| 467 | G0467 | clone | tiny rule copied as a helper put(), 4 copies of 1-4 statements | 2/4/4 | unchanged |
| 468 | G0468 | clone | near-duplicate function canonicalOf() (also: canonicalise), ~12 statements, str… | 2/2/2 | unchanged |
| 469 | G0469 | clone | near-duplicate function revokeByCreator() (also: revokeByOwner), ~9 statements,… | 2/2/2 | unchanged |
| 470 | G0470 | clone | near-duplicate function (anonymous)() (also: graphql, request), ~15 statements,… | 1/3/3 | unchanged |
| 471 | G0471 | clone | tiny rule copied as a helper (anonymous)() (also: isActive), 3 copies of 1-4 st… | 2/3/3 | unchanged |
| 472 | G0472 | clone | tiny rule copied as a helper _docsSorted() (also: _docsFor), 3 copies of 1-4 st… | 1/3/3 | unchanged |
| 473 | G0473 | clone | tiny rule copied as a helper sweepStale() (also: sweep, pruneTombstones), 3 cop… | 2/3/3 | new |
| 476 | G0476 | record | record assembled from the same sources {id=ID._id, by=ID.by, prUrl=ID.prUrl, he… | 2/2/2 | unchanged |
| 478 | G0478 | cmp | repeated comparison scope == 'default' | 2/2/2 | unchanged |
| 480 | G0480 | set | string set {'preset-save', 'undo'} as array [[...].includes] | 2/2/3 | unchanged |
| 481 | G0481 | const | named constant DUPLICATE_KEY_CODE=11000 | 2/2/2 | unchanged |
| 482 | G0482 | const | named constant FORMER_MEMBER="former member" | 2/2/2 | unchanged |
| 485 | G0485 | clone | near-duplicate function clusterSiblingsInLane() (also: computeShipReachableIds,… | 2/3/7 | unchanged |
| 486 | G0486 | cmp | repeated comparison field == 'model' | 2/3/3 | unchanged |
| 487 | G0487 | cmp | repeated comparison stateType == 'completed' | 2/3/3 | unchanged |
| 488 | G0488 | clone | tiny rule copied as a helper createDashboardDrilldownRoutes() (also: createDash… | 1/3/3 | unchanged |
| 489 | G0489 | clone | tiny rule copied as a helper union(), 3 copies of 1-4 statements | 2/3/3 | unchanged |
| 491 | G0491 | set | string set {'halt', 'modelRoutingProxyWrites', 'periodicals'} as table-keys/arr… | 2/2/2 | unchanged |
| 492 | G0492 | set | string set {'none', 'pause', 'stop', 'unknown'} as table-keys [HALT_VALUE, HALT… | 2/2/2 | unchanged |
| 493 | G0493 | clone | tiny rule copied as a helper deleteAll(), 4 copies of 1-4 statements | 2/4/4 | unchanged |
| 494 | G0494 | clone | near-duplicate function buildPassagePlannerKickoff() (also: buildPassageRunnerK… | 1/3/3 | unchanged |
| 498 | G0498 | const | named constant PROJECTION_RISK_TYPES=Set[overdue,unestimated-critical,velocity-… | 2/2/2 | unchanged |
| 502 | G0502 | set | string set {'overdue', 'unestimated-critical', 'velocity-declining'} as Set [PR… | 2/2/2 | unchanged |
| 503 | G0503 | contract | text contract marker: [credential-rejected] | 2/2/2 | unchanged |
| 504 | G0504 | const | named constant REPO_RE=/^[A-Za-z0-9._-]{1,100}$/ | 2/2/2 | unchanged |
| 505 | G0505 | clone | near-duplicate function assignLanes(), ~32 statements, same vocabulary (dialect… | 2/2/2 | unchanged |
| 506 | G0506 | clone | near-duplicate function assignSegments(), ~21 statements, same vocabulary (dial… | 2/2/2 | unchanged |
| 507 | G0507 | clone | near-duplicate function buildChainLabel(), ~10 statements, same vocabulary (dia… | 2/2/2 | unchanged |
| 508 | G0508 | clone | near-duplicate function cohereSubtaskGroups(), ~39 statements, same vocabulary … | 2/2/2 | unchanged |
| 509 | G0509 | clone | near-duplicate function computeCrossLaneColumns(), ~108 statements, same vocabu… | 2/2/2 | unchanged |
| 510 | G0510 | clone | near-duplicate function groupByAssignee() (also: groupByProject), ~10 statement… | 2/2/4 | unchanged |
| 511 | G0511 | clone | near-duplicate function groupByStatus(), ~12 statements, same vocabulary (diale… | 2/2/2 | unchanged |
| 513 | G0513 | clone | near-duplicate function mergeLabels(), ~6 statements, fuzzy | 2/2/2 | unchanged |
| 514 | G0514 | clone | near-duplicate function mergeLanes(), ~9 statements, same vocabulary (dialect c… | 2/2/2 | unchanged |
| 518 | G0518 | cmp | repeated comparison grouping == 'dependency' | 2/2/4 | unchanged |
| 519 | G0519 | cmp | repeated comparison rawKey == 'duplicate' | 2/2/2 | unchanged |
| 522 | G0522 | set | string set {'/library.css', '/style.css'} as array [stylesheets] | 2/2/2 | unchanged |
| 523 | G0523 | discrim | string set {'assignee', 'dependency', 'project', 'status'} as switch | 2/2/2 | unchanged |
| 524 | G0524 | discrim | string set {'dependency', 'project'} as or-chain | 2/2/2 | unchanged |
| 525 | G0525 | discrim | string set {'implicit', 'label', 'state'} as switch [ID.type] | 2/2/2 | unchanged |
| 527 | G0527 | cmp | repeated comparison tone == 'bad' | 1/3/3 | unchanged |
| 528 | G0528 | clone | tiny rule copied as a helper toRecord(), 3 copies of 1-4 statements | 2/3/3 | unchanged |
| 529 | G0529 | const | named constant COMPLETED="completed" | 2/2/2 | new |
| 534 | G0534 | set | string set {'digest', 'gap', 'northStarReading', 'product', 'technical', 'traje… | 2/2/5 | unchanged |
| 541 | G0541 | cmp | repeated comparison orientation == 'vertical' | 2/2/6 | unchanged |
| 545 | G0545 | record | literal record repeated verbatim {AFT="aft", DRIFT="drift", FORWARD="forward", … | 2/2/2 | unchanged |
| 546 | G0546 | const | named constant MAX_CUSTOM_PRESETS=20 | 2/2/2 | unchanged |
| 547 | G0547 | const | named constant MAX_PRESET_NAME_LENGTH=50 | 2/2/2 | unchanged |
| 549 | G0549 | clone | near-duplicate function (anonymous)(), ~7 statements, fuzzy | 2/2/2 | unchanged |
| 550 | G0550 | clone | near-duplicate function bearingToAngle(), ~8 statements, structurally identical | 2/2/2 | unchanged |
| 551 | G0551 | clone | near-duplicate function buildSegments(), ~59 statements, same vocabulary (diale… | 2/2/2 | unchanged |
| 552 | G0552 | clone | near-duplicate function cardMatchesHeading(), ~13 statements, same vocabulary (… | 2/2/2 | unchanged |
| 553 | G0553 | clone | near-duplicate function clusterSubtaskSiblings(), ~35 statements, same vocabula… | 2/2/2 | unchanged |
| 554 | G0554 | clone | near-duplicate function computePosition(), ~11 statements, fuzzy | 2/2/2 | unchanged |
| 555 | G0555 | clone | near-duplicate function hash32(), ~11 statements, fuzzy | 2/2/2 | unchanged |
| 556 | G0556 | clone | near-duplicate function layoutIndex(), ~30 statements, same vocabulary (dialect… | 2/2/2 | unchanged |
| 557 | G0557 | clone | near-duplicate function list(), ~7 statements, structurally identical | 2/2/2 | unchanged |
| 558 | G0558 | clone | near-duplicate function orientationLayout(), ~57 statements, same vocabulary (d… | 2/2/2 | unchanged |
| 559 | G0559 | clone | near-duplicate function pickAngle(), ~10 statements, fuzzy | 2/2/2 | unchanged |
| 560 | G0560 | clone | near-duplicate function placeDriftBucket(), ~22 statements, fuzzy | 2/2/2 | unchanged |
| 561 | G0561 | clone | near-duplicate function placeSegmentBucket(), ~44 statements, same vocabulary (… | 2/2/2 | unchanged |
| 562 | G0562 | clone | near-duplicate function pushProjectSegments() (also: pushProjectSegs), ~8 state… | 2/2/2 | unchanged |
| 564 | G0564 | record | record assembled from the same sources {label=ID[].name, projectName=ID[].name,… | 2/2/2 | unchanged |
| 566 | G0566 | cmp | repeated comparison kind == 'label' | 2/2/3 | unchanged |
| 567 | G0567 | cmp | repeated comparison kind == 'project' | 2/2/3 | unchanged |
| 568 | G0568 | cmp | repeated comparison projectSector == 'port' | 2/2/2 | unchanged |
| 569 | G0569 | cmp | repeated comparison projectSector == 'starboard' | 2/2/2 | unchanged |
| 570 | G0570 | cmp | repeated comparison sector == 'drift' | 2/2/2 | unchanged |
| 571 | G0571 | cmp | repeated comparison sector == 'ship' | 2/2/2 | unchanged |
| 572 | G0572 | cmp | repeated comparison stateType == 'unstarted' | 2/2/2 | unchanged |
| 575 | G0575 | discrim | string set {'E', 'W'} as or-chain | 2/2/2 | unchanged |
| 576 | G0576 | set | string set {'orchestration', 'resumed', 'wake', 'work'} as table-keys/array [DI… | 2/2/2 | new |
| 577 | G0577 | discrim | string set {'resumed', 'wake'} as or-chain [ID.role] | 2/2/2 | new |
| 578 | G0578 | record | record assembled from the same sources {access_token=ID.access_token, refresh_t… | 2/2/2 | unchanged |
| 579 | G0579 | cmp | repeated comparison error == 'invalid_grant' | 2/2/2 | unchanged |

</details>

## Compact trend ledger

Every carried row (149, under its run-6 name) and the eight new rows (150 to 157), each with its severity and run-7 delta. "Noted in" names the area note holding the row's entry; `—` means report-only or held by a ticket. Machine copy: `ledger-run7.tsv`.

| row | finding | severity | run-7 delta | noted in |
|---|---|---|---|---|
| 1 | `lib-import-cycles` | low-medium | unchanged (no cited file touched in b315e0e8f..e2d4659c4) | — |
| 2 | `provider-auth-router-upward-imports` | resolved | resolved (held; touched: server.js wiring only; 0 upward lib->routes edges at e2d4659c4) | — |
| 3 | `routes-error-envelope-fragmentation` | low-medium | unchanged (no cited file touched in b315e0e8f..e2d4659c4) | — |
| 4 | `production-to-test-fixture-imports` | resolved | resolved (held; no cited file touched in the window) | — |
| 5 | `periodical-report-filename-convention-split` | medium-low | unchanged (no cited file touched in b315e0e8f..e2d4659c4) | — |
| 6 | `dispatch-kind-vocabulary-cross-repo` | low | unchanged (no cited file touched in b315e0e8f..e2d4659c4) | — |
| 7 | `provider-resolution-incantation` | low | unchanged (no cited file touched in b315e0e8f..e2d4659c4) | — |
| 8 | `ui-divergences-registry-staleness` | low | unchanged (no cited file touched in b315e0e8f..e2d4659c4) | — |
| 9 | `simple-dispatcher-api-base-duplication` | low | unchanged (false hit: server.js matched by basename only) | — |
| 10 | `cross-repo-halt-vocabulary` | low-medium (sub-row) | unchanged (no cited file touched in b315e0e8f..e2d4659c4) | — |
| 11 | `cross-repo-sentinel-decision-marker-vocabulary` | medium | unchanged (no cited file touched in b315e0e8f..e2d4659c4) | — |
| 12 | `target-vocabulary` | low | unchanged (touched: lib/dispatch-store.js, server.js; its one hunk is a comment at the founder projection; cited decision not in a window hunk) | — |
| 13 | `sse-frame-writer-duplication` | resolved | resolved (held; no cited file touched in the window) | — |
| 14 | `routes-proxy-decomposition` | — | unchanged (no cited file touched in b315e0e8f..e2d4659c4) | — |
| 15 | `cross-repo-repo-list` | low | unchanged (no cited file touched in b315e0e8f..e2d4659c4) | — |
| 16 | `ci-convention-split-across-repos` | informational | unchanged (no cited file touched in b315e0e8f..e2d4659c4) | — |
| 17 | `semicolon-style-split` | low | unchanged (touched: server.js; its hunks are the task-timeline import and wiring only; cited decision not in a window hunk) | — |
| 18 | `client-escape-html-duplication` | — | unchanged (no cited file touched in b315e0e8f..e2d4659c4) | — |
| 19 | `client-shared-helper-duplication` | — | unchanged (touched: server.js; its hunks are the task-timeline import and wiring only; cited decision not in a window hunk) | — |
| 20 | `client-section-fetch-idiom-duplication` | — | unchanged (no cited file touched in b315e0e8f..e2d4659c4) | — |
| 21 | `linear-cli-parallel-graphql-surface` | — | unchanged (touched: server.js; its hunks are the task-timeline import and wiring only; cited decision not in a window hunk) | — |
| 22 | `store-module-uniformity` | — | unchanged (no cited file touched in b315e0e8f..e2d4659c4) | — |
| 23 | `server-side-escaping` | — | unchanged (touched: server.js; its hunks are the task-timeline import and wiring only; cited decision not in a window hunk) | — |
| 24 | `dispatch-payload-centralization` | — | unchanged (no cited file touched in b315e0e8f..e2d4659c4) | — |
| 25 | `renderer-provider-abstraction` | — | unchanged (no cited file touched in b315e0e8f..e2d4659c4) | — |
| 26 | `cache-module-family` | low | unchanged (no cited file touched in b315e0e8f..e2d4659c4) | — |
| 27 | `lib-components-primitive-adoption` | — | unchanged (no cited file touched in b315e0e8f..e2d4659c4) | — |
| 28 | `state-store-write-seam` | — | unchanged (no cited file touched in b315e0e8f..e2d4659c4) | — |
| 29 | `phase-vocabulary-centralization` | low | unchanged (no cited file touched in b315e0e8f..e2d4659c4) | — |
| 30 | `target-harness-axis-orthogonality` | — | unchanged (no cited file touched in b315e0e8f..e2d4659c4) | — |
| 31 | `test-seam-separation` | — | unchanged (no cited file touched in b315e0e8f..e2d4659c4) | — |
| 32 | `css-token-layer` | — | unchanged (no cited file touched in b315e0e8f..e2d4659c4) | — |
| 33 | `runner-contract-semantics-cross-repo` | medium | unchanged (no cited file touched in b315e0e8f..e2d4659c4) | — |
| 34 | `connection-binding-predicate-drift` | low-medium | unchanged (no cited file touched in b315e0e8f..e2d4659c4) | — |
| 35 | `run-page-identity-scrape` | medium | unchanged (no cited file touched in b315e0e8f..e2d4659c4) | — |
| 36 | `dispatch-entrance-field-duplication` | low | unchanged (touched: routes/proxy-compute.js, whose /cost read moved to readTaskCost, and server.js wiring; the field duplication is not in a hunk) | — |
| 37 | `owner-word-collision` | low | unchanged (touched: lib/run-view.js SPINE, STAGE_LABELS and the next-step line for the blind read; the owner word is not in a hunk) | — |
| 38 | `run-family-render-primitives` | low | unchanged (no cited file touched in b315e0e8f..e2d4659c4) | — |
| 39 | `persist-binding-sibling-seams` | low | unchanged (no cited file touched in b315e0e8f..e2d4659c4) | — |
| 40 | `server-formatter-duplication` | low | unchanged (touched: lib/effort-readout.js, a comment and a pinned string naming planReviewDueOf; server.js wiring) | — |
| 41 | `wake-marker-regex-copies` | resolved | resolved (held; no cited file touched in the window) | — |
| 42 | `runner-liveness-assumption` | low | unchanged (no cited file touched in b315e0e8f..e2d4659c4) | — |
| 43 | `workspace-urlkey-consolidation` | — | unchanged (no cited file touched in b315e0e8f..e2d4659c4) | — |
| 44 | `credential-decision-multiplicity` | medium-high | unchanged (no cited file touched in b315e0e8f..e2d4659c4) | — |
| 45 | `keepalive-error-envelope-writer` | resolved | resolved (held; no cited file touched in the window) | — |
| 46 | `html-error-page-two-writers` | resolved | resolved (held; no cited file touched in the window) | — |
| 47 | `ai-availability-gate-duplication` | medium-low | unchanged (touched: server.js; its hunks are the task-timeline import and wiring only; cited decision not in a window hunk) | — |
| 48 | `dispatch-refusal-relay-duplication` | resolved | resolved (held; no cited file touched in the window) | — |
| 49 | `tolerant-date-parse-date-twins` | resolved | resolved (held; no cited file touched in the window) | — |
| 50 | `timestamp-parse-consolidation` | — | unchanged (no cited file touched in b315e0e8f..e2d4659c4) | — |
| 51 | `loose-json-consolidation` | — | unchanged (no cited file touched in b315e0e8f..e2d4659c4) | — |
| 52 | `ai-mock-predicate-consolidation` | — | unchanged (no cited file touched in b315e0e8f..e2d4659c4) | — |
| 53 | `batch-guard-residue` | informational | unchanged (no cited file touched in b315e0e8f..e2d4659c4) | — |
| 54 | `decision-dialect-split` | medium (sub-row) | unchanged (no cited file touched in b315e0e8f..e2d4659c4) | — |
| 55 | `human-wait-derivation-split` | low-medium | unchanged (touched: lib/run-view.js SPINE/labels and lib/task-page-loader.js timeline threading; the derivation split is not in a hunk) | — |
| 56 | `decision-stamp-classifier-copies` | low-medium | unchanged (no cited file touched in b315e0e8f..e2d4659c4) | — |
| 57 | `provider-write-field-contract` | low-medium | unchanged (no cited file touched in b315e0e8f..e2d4659c4) | — |
| 58 | `close-out-merged-refusal-split` | low-medium | unchanged (no cited file touched in b315e0e8f..e2d4659c4) | — |
| 59 | `periodic-loop-two-mechanisms` | informational | unchanged (touched: server.js; its hunks are the task-timeline import and wiring only; cited decision not in a window hunk) | — |
| 60 | `consumer-liveness-signal-conflation` | resolved | resolved (held; no cited file touched in the window) | — |
| 61 | `consumer-heartbeat-wire-restated` | low-medium (sub-row of 60) | unchanged (no cited file touched in b315e0e8f..e2d4659c4) | — |
| 62 | `owner-answer-reader-copies` | low | unchanged (no cited file touched in b315e0e8f..e2d4659c4) | — |
| 63 | `mock-ai-builder-copies` | low-medium | unchanged (touched: routes/proxy-compute.js /cost now calls readTaskCost; the mock-AI builder is not in a hunk) | — |
| 64 | `fresh-run-definition-copies` | low-medium | unchanged (touched: lib/dispatch-store.js; its one hunk is a comment at the founder projection; cited decision not in a window hunk) | — |
| 65 | `terminal-loop-rule-copies` | low-medium | unchanged (touched: server.js; its hunks are the task-timeline import and wiring only; cited decision not in a window hunk) | — |
| 66 | `state-type-label-rank-maps` | low-medium | unchanged (touched: server.js; its hunks are the task-timeline import and wiring only; cited decision not in a window hunk) | — |
| 67 | `csp-decision-split` | resolved | resolved (held; no cited file touched in the window) | — |
| 68 | `priority-label-maps` | low | unchanged (no cited file touched in b315e0e8f..e2d4659c4) | — |
| 69 | `localhost-predicate-split` | low | unchanged (touched: server.js; its hunks are the task-timeline import and wiring only; cited decision not in a window hunk) | — |
| 70 | `observer-instance-key-copies` | low | unchanged (no cited file touched in b315e0e8f..e2d4659c4) | — |
| 71 | `pilot-eligibility-copies` | low | unchanged (touched: lib/effort-readout.js, a comment and a pinned string only) | — |
| 72 | `linear-image-host-allowlist` | low | unchanged (no cited file touched in b315e0e8f..e2d4659c4) | — |
| 73 | `page-chrome-options` | low | unchanged (no cited file touched in b315e0e8f..e2d4659c4) | — |
| 74 | `ship-biscuit-desk-list` | low | unchanged (no cited file touched in b315e0e8f..e2d4659c4) | — |
| 75 | `free-tier-rule-copies` | resolved | resolved (held; no cited file touched in the window) | — |
| 76 | `sd-blocked-child-last-activity-split` | low | unchanged (no cited file touched in b315e0e8f..e2d4659c4) | — |
| 77 | `census-gone-overstates-resolution` | informational | unchanged (no cited file touched in b315e0e8f..e2d4659c4) | — |
| 78 | `follow-up-target-rule-copies` | resolved | resolved (held; no cited file touched in the window) | — |
| 79 | `lineage-row-read-copies` | low | unchanged (no cited file touched in b315e0e8f..e2d4659c4) | — |
| 80 | `pr-url-regex-copies` | low | unchanged (no cited file touched in b315e0e8f..e2d4659c4) | — |
| 81 | `pause-marker-predicate-gap` | low | unchanged (touched: lib/dispatch-store.js comment, lib/task-page-loader.js timeline threading; no marker-keyed pending predicate added) | — |
| 82 | `review-on-record-readers` | low | unchanged (no cited file touched in b315e0e8f..e2d4659c4) | — |
| 83 | `credential-block-grammar-split` | low | unchanged (no cited file touched in b315e0e8f..e2d4659c4) | — |
| 84 | `review-loop-ceiling-restated` | low | unchanged (no cited file touched in b315e0e8f..e2d4659c4) | — |
| 85 | `sweep-as-library-imports` | low | unchanged (no cited file touched in b315e0e8f..e2d4659c4) | — |
| 86 | `github-envelope-walker-split` | low | unchanged (no cited file touched in b315e0e8f..e2d4659c4) | — |
| 87 | `binding-active-answer-copies` | low-medium (sub-row of 44) | unchanged (touched: server.js; its hunks are the task-timeline import and wiring only; cited decision not in a window hunk) | — |
| 88 | `auth-failure-answer-copies` | low-medium | unchanged (no cited file touched in b315e0e8f..e2d4659c4) | — |
| 89 | `account-group-reader-copies` | low | unchanged (no cited file touched in b315e0e8f..e2d4659c4) | — |
| 90 | `stable-stringify-copies` | low | unchanged (no cited file touched in b315e0e8f..e2d4659c4) | — |
| 91 | `kpi-page-twin-copies` | low-medium | unchanged (no cited file touched in b315e0e8f..e2d4659c4) | — |
| 92 | `kit-terminal-status-copy` | low | unchanged (no cited file touched in b315e0e8f..e2d4659c4) | — |
| 93 | `sd-parked-predicate-inline` | low | unchanged (no cited file touched in b315e0e8f..e2d4659c4) | — |
| 94 | `https-predicate-restated` | low | unchanged (touched: server.js; its hunks are the task-timeline import and wiring only; cited decision not in a window hunk) | — |
| 95 | `harbour-token-format-restated` | — | unchanged (no cited file touched in b315e0e8f..e2d4659c4) | — |
| 96 | `registry-providers-restated` | low (sub-row of 44) | unchanged (no cited file touched in b315e0e8f..e2d4659c4) | — |
| 97 | `sd-401-layers-three` | low | unchanged (no cited file touched in b315e0e8f..e2d4659c4) | — |
| 98 | `expire-ownerless-has-owner-copy` | low | unchanged (no cited file touched in b315e0e8f..e2d4659c4) | — |
| 99 | `vendor-script-list-restated` | low | unchanged (no cited file touched in b315e0e8f..e2d4659c4) | — |
| 100 | `prune-to-capacity-clones` | low | unchanged (no cited file touched in b315e0e8f..e2d4659c4) | — |
| 101 | `resume-model-effort-cross-repo` | medium-high | unchanged (no cited file touched in b315e0e8f..e2d4659c4) | — |
| 102 | `halt-word-map-copies` | medium | unchanged (no cited file touched in b315e0e8f..e2d4659c4) | — |
| 103 | `home-next-answer-split` | medium | unchanged (no cited file touched in b315e0e8f..e2d4659c4) | — |
| 104 | `coherence-loop-stalled` | medium (process) | unchanged: process row; LIN-3449 still Todo (22 comments); this run mints no child | — |
| 105 | `settings-run-setup-rebuilt` | low-medium | unchanged (no cited file touched in b315e0e8f..e2d4659c4) | — |
| 106 | `settings-preset-systems` | low-medium | unchanged (no cited file touched in b315e0e8f..e2d4659c4) | — |
| 107 | `routes-as-library` | low-medium | unchanged (no cited file touched in b315e0e8f..e2d4659c4) | — |
| 108 | `model-vocabulary-rule-copies` | low-medium | unchanged (no cited file touched in b315e0e8f..e2d4659c4) | — |
| 109 | `task-page-state-outside-owner` | low-medium | unchanged (touched: public/task-page.js timeline poll and lib/render-task-page.js; the new status read at public/task-page.js:848 repeats the existing :64/:73 reads; cited decision not in a hunk) | — |
| 110 | `live-anchor-old-home-alive` | low-medium | unchanged (no cited file touched in b315e0e8f..e2d4659c4) | agent-api |
| 111 | `lineage-anchor-rules-three` | low-medium | unchanged (touched: lib/dispatch-store.js; its one hunk is a comment at the founder projection; cited decision not in a window hunk) | — |
| 112 | `model-constants-server-client-twins` | resolved | resolved (held; no cited file touched in the window) | — |
| 113 | `low-rows-unpromoted` | low | unchanged (touched: lib/task-page-loader.js timeline threading; cited decision not in a hunk) | — |
| 114 | `halt-poll-cold-cache-fail-open` | medium (conditional) | unchanged: John's ruling, not chosen here | — |
| 115 | `usage-relay-flag-partial` | resolved | resolved (held; no cited file touched in the window) | — |
| 116 | `usage-record-vocabulary-two-readers` | low-medium | unchanged (no cited file touched in b315e0e8f..e2d4659c4) | — |
| 117 | `lineage-identity-read-twins` | resolved | resolved (held; touched: lib/dispatch-store.js comment only) | — |
| 118 | `reap-window-constant-cross-repo` | low-medium | unchanged (no cited file touched in b315e0e8f..e2d4659c4) | — |
| 119 | `cost-fold-partition-restated` | resolved | resolved (held: lib/cost-read.js was refactored inside the one home, sessionOf/selectLineageRecords/requestSpanOf extracted; lib/task-cost-read.js only calls readCost; the per-dispatch model pick is a new, separate row, 150) | — |
| 120 | `key-state-residue` | informational | unchanged (no cited file touched in b315e0e8f..e2d4659c4) | — |
| 121 | `unit-census-convention-split` | informational | unchanged (no cited file touched in b315e0e8f..e2d4659c4) | — |
| 122 | `usage-snapshot-prose-residue` | low | unchanged (touched: docs/architecture/source-map.md, docs/proxy-integration.md, lib/effort-readout.js, lib/proxy-instructions.js; prose sites outside hunks) | — |
| 123 | `completeness-precedence-restated` | borderline (not graded) | unchanged (lib/cost-read.js reads the fold's completeness at one more site, 4 -> 5 in that file; the precedence ladder stays in lib/row-usage.js, not in a hunk) | — |
| 124 | `erasure-inventory-lockstep-gap` | resolved | resolved (held; touched: server.js wiring only) | — |
| 125 | `parked-wait-text-cross-repo` | low-medium | unchanged (no cited file touched in b315e0e8f..e2d4659c4) | — |
| 126 | `error-code-case-split` | low | unchanged (no cited file touched in b315e0e8f..e2d4659c4) | — |
| 127 | `ruling-settled-row-predicate-inline` | low | unchanged (no cited file touched in b315e0e8f..e2d4659c4) | — |
| 128 | `waiting-standing-comment-residue` | low | unchanged (no cited file touched in b315e0e8f..e2d4659c4) | — |
| 129 | `request-source-guard-copies` | low | unchanged (the three inline loader-shape checks remain: lib/cost-read.js:160, lib/run-view.js:399, lib/kpi-stats.js:1067; line drift only) | — |
| 130 | `reply-effect-default-split` | borderline (not graded) | unchanged (no cited file touched in b315e0e8f..e2d4659c4) | — |
| 131 | `override-kind-list-stale` | low | unchanged in code: the VERB OVERRIDE sentence gained blind-read and names 16 of the 20 PROMPT_TEMPLATES keys (bug, plan-review, close-out, retrospective-audit still missing); LIN-4302 Backlog | — |
| 132 | `path-class-predicate-copies` | low | unchanged (touched: scripts/delivery-composition.mjs now imports ownTicket from scripts/stability-measures-core.mjs; the isTest/isDoc copies are unmoved) | — |
| 133 | `world-helper-convention-half-guarded` | low | unchanged (touched: CLAUDE.md, CI job names and the invariant sentence; the world-helper rule is not in a hunk) | — |
| 134 | `stage-writes-threading-per-entrance` | low | unchanged (touched: lib/proxy-preamble.js adds WRITES.BLIND_COMMENT to the endpoint hint; the per-entrance threading of writes is unchanged) | — |
| 135 | `in-progress-predicate-server-client-split` | low | unchanged (no cited file touched in b315e0e8f..e2d4659c4) | — |
| 136 | `stage-kind-roster-tables` | low | improved (pinned): tests/unit/stage-kind-tables.test.js (new, LIN-4437) checks 17 kind-keyed tables against PROMPT_TEMPLATES both ways; the blind read still had to touch 13 tables in 11 files and the copy of its text (public/llms.txt) is unpinned (row 154); survey-place 21 lines in 10 files -> 22 in 12 | — |
| 137 | `enqueue-route-list-restated` | low | unchanged: lib/proxy-scopes.js:24-25, CLAUDE.md:107 and docs/proxy-integration.md:102 still list three enqueue routes (the window edited CLAUDE.md and the doc and left them); lib/proxy-scopes.js:8 says four; LIN-4320 Backlog | — |
| 138 | `element-method-guard-idiom-beyond-scan` | low | unchanged (no cited file touched in b315e0e8f..e2d4659c4) | — |
| 139 | `client-dual-export-split` | low (borderline) | unchanged (no cited file touched in b315e0e8f..e2d4659c4) | — |
| 141 | `session-lane-grant-from-client-text` | low-medium | unchanged in code: lib/dispatch-entrance.js:1226 still passes isAutopilotVariant(prompt) to declaresPeriodicalGrant; the window's ±22 in the file did not touch it; LIN-4318 Backlog | — |
| 140 | `working-beat-grammar-cross-repo` | low-medium | unchanged: no [working] line in any window hunk under lib, routes, public or server.js, nor in SD's window; LIN-3828 Backlog | — |
| 142 | `leftover-gate-restates-three-decisions (R1)` | LOW–MEDIUM | unchanged in code: lib/dispatch-leftover.js:26, :29, :113 keep RESUMABLE_TARGETS, NEVER_RAN and the pause/stop test; the window's hunks there are the prompt (it now renders CONSEQUENCE_TEST and the retirement words from the leaf) | runs-and-dispatch |
| 143 | `periodical-notes-bullet-restates-leftover-rule (P1)` | LOW | improved: areaNotes (lib/periodicals.js:350) no longer restates the byte cap, the distil step, Waiting vs Lesson, the cite order or the merge authority; three short restatements remain (the prune sentence, the source format, "a ticketed finding stays in the report only"), each consistent with its home today | llm-and-prompts |
| 144 | `context-not-scope-three-homes (P2)` | LOW | unchanged: "Waiting entries are context, not scope" in lib/prompt-formatters.js:612 and both READMEs (Harbour :66, SD :70); lib/dispatch-leftover.js:124 now names it as the rule its retirement step is the exception to | llm-and-prompts |
| 145 | `area-notes-dir-outside-registry-path (P3)` | LOW | worsened: docs/areas spelled in 17 lines / 10 files (lib, routes, public, server.js, scripts) at b315e0e8f -> 26 lines / 11 files at e2d4659c4; a second directory constant, NOTES_DIR (lib/prompts/area-note-format.js:8), now sits beside REGISTRY_PATH and neither derives from the other | llm-and-prompts |
| 146 | `area-notes-guard-copied-and-diverged (P4)` | LOW | improved: the guards converged (both list the same 12 extensions incl. sh, the same five checks, the Lessons-only cap; SD's README gained the Periodical-entry rule); still copied by design and held by comments only; SD's README words the third way out differently (row 152) | llm-and-prompts |
| 147 | `as-asked-rule-sentence-two-homes (A1)` | LOW (borderline) | unchanged: "no step may change them" in AS_ASKED_LEAD (routes/proxy-writes.js:78) and BRIEF_HINT (lib/as-asked.js:294) | agent-api |
| 148 | `agent-api-literals-restate-homes (A2)` | LOW (borderline) | improved (partly): the hand-typed look-first sequence left lib/proxy-instructions.js (LIN-4407); "a day" (lib/proxy-instructions.js:485), "four lines" (routes/proxy-writes.js:362) and the DECIDED_BY values (lib/completion-signals.js:121) remain | agent-api |
| 149 | `session-pr-pick-mirror-cross-repo` | LOW–MEDIUM | unchanged: lib/dispatch-wake.js and SD links.js / hook.js untouched in both windows; joined by the comment at lib/dispatch-wake.js:275 only | runs-and-dispatch |
| 150 | `dispatch-model-pick-second-rule` | LOW–MEDIUM | new (window, LIN-4404/4405): lib/task-timeline.js:53-58 dispatchModelOf re-ranks byModel by costUsd then requests; the home, lib/request-usage-fold.js:107-121, ranks by priced dollars then latest use; a lane can name two models | runs-and-dispatch |
| 151 | `blind-read-kind-and-heading-retyped` | LOW–MEDIUM | new (window, LIN-4437/4438): BLIND_READ_KIND and BLIND_READ_HEADING (lib/prompts/blind-read-words.js) are retyped: the kind as bare literals in lib/recommendation-blind-read.js:47,65,75-76, lib/pipeline-churn.js:233, lib/run-view.js:472, lib/run-closeout-state.js:116,255 and a second constant VIRTUAL_PROMPTS.BLIND_READ (lib/workflow-config.js:40); the heading and verdict words typed in lib/completion-signals.js:254-262 | llm-and-prompts |
| 152 | `retirement-rule-restated-per-reader` | LOW | new (window, LIN-4414): the three-form words have one home and one checker, but the selection rule and the forms are restated by hand in docs/areas/README.md, SD's README, docs/proxy-integration.md (with the refusal kinds), docs/architecture/dispatch-and-proxy.md and the prompt; SD's README says an entry leaves when "a follow-up is filed", not when the consequence test sends it; no test reads the doc copies | llm-and-prompts |
| 153 | `landing-exclusions-two-lists` | LOW | new (window, LIN-4437/4438): what is not landing work (blind reads, Survey reports) is listed in lib/run-ledger.js:567 landingPrUrls and again in lib/recommendation-facts.js:86 isLandingEvidence, joined by a comment; already covered by the existing lib/run-ledger.js Waiting entry (one comment classifier, one landing reader) | runs-and-dispatch (existing entry) |
| 154 | `code-settled-routes-list-copies` | LOW | new (window, LIN-4392/4437): the four code-settled routes are listed in about nine places; docs/architecture/prompt-system.md:7 says "four routes" and restates three (no blind read); public/llms.txt:271 says the blind read is "Sent by hand" | llm-and-prompts |
| 155 | `cited-path-rule-three-spellings` | LOW (borderline) | new (window, LIN-4414): what a cited path is lives in the notes guard (tests/unit/area-notes.test.js), in lib/dispatch-leftover-answer.js:41-42 (any 1-6 character extension) and in SD's guard; lib/prompts/area-note-format.js, the new one reading of a Waiting entry, does not hold it | llm-and-prompts |
| 156 | `ruling-outcome-buckets-claim-home` | LOW | new (window, LIN-4424): scripts/stability-measures-seat.mjs says its buckets are "as lib/escalation-kpis.js", but counts withdrawn as neither and a null outcome as unreadable, where the home (lib/escalation-kpis.js:120-126) counts both as answered | reports-and-operator-tools |
| 157 | `timeline-renderer-rederives-tick-style` | LOW | new (window, LIN-4405): lib/render-task-timeline.js:130 restates the model's tick rule (lib/task-timeline.js:340: wake, resumed or no records) to pick the bare style, and the legend (:205) restates it again; the renderer's header says it derives nothing | front-end-pages |

## Follow-ups

- **No tickets minted.** Each new finding is a Waiting entry in its area note (150, 151, 152, 154, 155, 156, 157), already held by an existing entry (153), or report-only.
- **Existing tickets not changed.** LIN-4320 (row 137) should still be widened, as runs 5 and 6 said. LIN-4302 (row 131) now reads "16 of the 20".
- **The gate comment and the closing comment** are posted on LIN-4443.

## For John

- **Larger tidies, not tickets:**
  - **Commit the import walker** into `scripts/code-shape/` as a tool. Still open: runs 5, 6 and 7 all ran it from an evidence folder.
  - **Cap eviction: settled by LIN-4414.** Only Lessons are capped, and Waiting entries leave only when settled, untrue or sent to a ticket, so the last writer no longer decides what stays. This tidy is retired.
  - **Ledger retirement, reshaped.** The ledger has 157 rows, and more than half are "unchanged, no cited file touched". Rows held by a Waiting entry or a ticket could be carried as one-line pointers, leaving the ledger as the trend for rows with no other home. Unchanged since run 6 except the count.
- **Findings with no area file to cite:** none new. Row 137's stale copies are in `CLAUDE.md` and `docs/`, and LIN-4320 holds them. The two stale route-list copies in `docs/architecture/prompt-system.md` and `public/llms.txt` are filed under `lib/openrouter.js` in `llm-and-prompts.md`.
- **Row 114 (halt cold-cache) is John's ruling** and is unchanged.

## Adversarial Second-Read

_Pending: the second read runs after this report is written._
