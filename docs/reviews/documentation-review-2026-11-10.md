# Documentation Review, 10 Nov. 2026 (run 7, trend vs 21 Oct.)

Drift-first documentation periodical, run 7. Ticket LIN-4406. Covers both repositories: LinearViewer ("LV") and simple-dispatcher ("SD").
This is the first run to review the area notes as a documentation surface. It is review-only: no code, config or secrets changed. It edits three LV area notes (plus two one-line note fixes), and writes this report.

## Scope and HEADs

| Repo | HEAD reviewed | Window | Commits | Files in window |
|---|---|---|---|---|
| LinearViewer | `9cf51ef72` (origin/main when reviewed); the branch was rebased onto `008d38bb0` (origin/main at push, which includes LIN-4392, LIN-4398, LIN-4405 and the sibling LIN-4407 review, all outside this window's measured HEAD) | `821cf841..9cf51ef72` | 467 | 5,509 |
| simple-dispatcher | `5d8489e` (origin/main) | `bb1da78e..5d8489e` | 67 | 255 |

LV production files touched per area, executed through `docs/areas/areas.json` (first match wins), 13 areas. Unmapped: 5,076 (docs 4,006, tests 951, the rest scripts/experiments/root).

| Area | Files | Area | Files |
|---|---|---|---|
| runs-and-dispatch | 79 | reports-and-operator-tools | 13 |
| front-end-pages | 74 | providers | 11 |
| front-end-browser | 73 | platform-and-plumbing | 7 |
| llm-and-prompts | 55 | task-model | 2 |
| web-routes | 37 | wiring | 1 |
| auth-accounts-and-workspaces | 33 | other-features | 21 |
| agent-api | 27 | | |

The prior edition is `docs/reviews/documentation-review-2026-10-21.md` (LIN-3744). The 09-26 trend items were read.

Method: every claim was re-verified against source at HEAD, not against prior prose. Counts were executed (node scripts loading the modules, or parsing route registrations), not grep-counted. Linear states were read with GET only. Sub-workstreams were checked by fresh-context reads (agent-facing API; periodicals/seal/size/leftover; ledger, doc stores and entry points; area notes in both repos; simple-dispatcher docs). The results were then reconciled against each other.

The adversarial second read is in the final section, with the reader's full answer.

## 1. Summary

The window is large (467 LV commits), and most of the drift is in the agent-facing surfaces, which is where it hurts most. Four things matter most:

1. **Agents are not told about the look-first sequence or the leftover step.** On a fresh, unsized ticket, `recommend` and `recommend-and-dispatch` send survey-task, survey-place, then scoping (LIN-4370). The catalog says so; the guide's GET /recommend section does not, so an agent following the guide takes a Survey step as its task (D38, found by the second read). **Agents are also not told about the leftover step or the held DONE wake.** The served catalog and guide say a parent is woken on DONE. For an implementation build that wake is held until the build's leftover row ends. The catalog also describes the `kind` set as "template keys plus custom", but there are 23 dispatch kinds and two row-only kinds. This is the only finding that changes what an orchestrator does with a DONE status (D1).
2. **The periodical system is documented correctly in code but has three ungoverned seams:** the gate's two 409 codes are undocumented on every agent-facing surface (D5); Periodical prompts have no size ceiling (+18.8% in the window; D8); and a Periodical's SD note cannot satisfy its own instruction (D9).
3. **The simple-dispatcher README has three high-severity defects** that a user copying it would hit: the stop-cancelled follow-up rule is wrong (D2), copying the `.env` block silently breaks the rollback switches it teaches (D3), and `SD_STATE_DIR` in `.env` is ignored by the dispatcher but not by the hook (D4). D2–D4 come from code reads and a simulated `.env` load, not an end-to-end run.
4. **The area notes are healthy but drifting.** The guards passed before this change (LV 13 suites / 117 tests; SD 28 tests). About eight entries had format or accuracy defects. Two capped notes were at or near their caps on main, and both now sit under them: llm-and-prompts is 6,106 B (main 6,139 B) and runs-and-dispatch 5,974 B (main 6,144 B).

The window also left two ownerless residues: LIN-3745 (M1) is Done but its residue remains (D14), and the sealed `## As asked` block on LIN-4406 still says merge and Done above the superseding section (D30).

## 2. Findings, severity-ranked

Disposition: **Note** means an area-note entry was written in this change. **Report** means the item is owned by a live ticket, so it stays here only. **Closing** means the item has no area file to cite, so it goes to the person in the closing comment. "Ticket" gives the state read on 10 Nov.

| ID | Sev | Finding | Evidence (HEAD) | Owner (state) | Disposition |
|---|---|---|---|---|---|
| D1 | HIGH | The catalog never mentions the `leftover` row kind. It does not say an implementation build's DONE wake on its parent is held until the leftover row ends. Its `kind` contract says "prompt-template keys plus custom"; the executed set is 23 `DISPATCH_KINDS` plus `ROW_ONLY_KINDS` `wake` and `leftover`. | Catalog (rendered `readWrite`+`take`) has 0 `leftover` hits, `lib/proxy-instructions.js` DONE text, `lib/dispatch-leftover.js`, `lib/dispatch-fields.js` (`ROW_ONLY_KINDS`), `docs/architecture/dispatch-and-proxy.md:112-128` (documents the hold; catalog and guide do not). Research rated HIGH; two verifications rated MED. Kept HIGH: it is the only finding that changes an orchestrator's action. | none (LIN-4373, 4375, 4376 Done, cite no doc) | **Note**: agent-api, Waiting |
| D38 | HIGH | The guide omits the look-first sequence. On a fresh, unsized ticket, `recommend` and `recommend-and-dispatch` send survey-task, then survey-place, then scoping; a live step answers `prompt: null` with `liveWait`. The catalog documents this; the guide's GET /recommend section (`docs/proxy-integration.md` around :1835) describes only an AI-generated prompt, and its worked example (around :2934) takes `prompt` from it as the task. The 409 row mentions LIN-4370 only in passing. | `lib/recommendation-look-first.js` (sequence, `LOOK_FIRST_STEPS`); `lib/openrouter.js:2070,2086` (`liveWait`, `prompt: null`); `lib/proxy-instructions.js` (catalog text); guide 0 look-first hits outside the 409 row. Found by the second read; verified at source. | LIN-4370 (Done): **unowned**; LIN-4392 replaced its live wait | **Note**: agent-api, Waiting |
| D2 | HIGH | [SD] README:282-283 says a follow-up to a stop-cancelled session is held and resumed. The code rejects it terminally (no person-forced revive). | SD `followup.js:62-80`; SD `docs/session-lifecycle.md:247-250` is correct. Commits bd6d2cf (LIN-4079), cf6369d (LIN-4082). | LIN-4079, LIN-4082 (Done) | **Closing**: SD README, SD repo |
| D3 | HIGH | [SD] The `.env` block copies inline `#` comments into values, which `load-env.js` does not strip. A rollback switch written as `VAR=0  # note` stays on. `SD_PATH_PREPEND=` (empty) is the opt-out and disables the Homebrew prefix when copied. | SD README block (about lines 52–205); `config.js:428-431`. Simulated in a scratch copy of root JS (`SD_ASSISTANT_TEXT_RELAY`, `SD_TOOL_ACTIVITY_RELAY`, `SD_PATH_PREPEND`); not run end to end. | none; LIN-4165, LIN-4127 (Done) changed the defaults | **Closing**: SD README |
| D4 | HIGH | [SD] `SD_STATE_DIR` in `.env` relocates state for the hook but not the dispatcher: `config.js` requires `state-dir.js` before `loadEnv()`. | SD `config.js:8,16`; SD README:183. Simulated, with a test/dev caveat. Commit 4db66b3 (LIN-4077). | none | **Closing**: SD README |
| D5 | MED | The two periodical gate 409 codes are undocumented everywhere agents read: `PERIODICAL_REPORT_NOT_PERSISTED`, `PERIODICAL_ADVERSARIAL_READ_NOT_RECORDED`. An agent finishing a periodical task hits them with no guidance. | Emitted at `lib/periodical-report-gate.js:125,139`; returned by PATCH `routes/proxy-writes.js:459-478`. Zero hits in the catalog, guide, `public/llms.txt`, CLAUDE.md and `docs/architecture`. No code-list test pins them. | LIN-2390 (Backlog) | **Report** |
| D6 | MED | The guide is behind the catalog and nothing keeps them in step. The guide has no entry for eight canonical routes: seven `model-routing` routes and `POST runner/usage/:id`. The catalog lacks three: `GET issues/{id}/snapshots`, `.../snapshots/diff`, `.../prompt/{templateKey}`. The guide's error tables omit `SIZE_RECORD_SHAPE` (`docs/proxy-integration.md:2191-2193,2246`). No test reads the catalog's route list against the guide. | Executed: route registry walked with stubbed dependencies, 79 distinct paths. Strict method+path matches: catalog 65, guide 64, `llms.txt` 5. Of the ten routes added in the window, the guide misses eight; the catalog misses none. The runner kit's contract has no row for `runner/usage/:id` either. | none (LIN-4368, 4369 Done) | **Note**: agent-api, Waiting |
| D7 | MED | The verb-override lists are short. The server accepts all 19 `PROMPT_TEMPLATES`; the catalog lists 15 (missing `bug`, `plan-review`, `close-out`, `retrospective-audit`); the guide lists 13 and also drops `survey-task`, `survey-place`. | `lib/proxy-instructions.js` verb-override section; `docs/proxy-integration.md` around the Recommend and Dispatch table; `lib/dispatch-entrance.js:221-226`. | LIN-4302 (Backlog) for the catalog | **Report** (catalog); guide list folded into D6's note entry |
| D8 | MED | Periodical prompts have no size budget. Sixteen renders grew from 185,952 to 220,882 B (+18.8%) in the window; `FROZEN` covers the other prompts, but only a sha256 tripwire covers these. The Lesson "Prompt size is frozen" does not reach them. | Executed at 821cf841 and HEAD via `git archive`: `renderPeriodicalPrompt` at HEAD equals `generatePrompt` for all 16. Doc-review prompt 9,189→11,615 B (+26%). `tests/unit/lin-4313-periodical-prompt-bytes.test.js` pins hashes; `tests/unit/prompt-size-budget.test.js` has no periodical surface. | none | **Note**: llm-and-prompts, Waiting |
| D9 | MED | A Periodical's SD note cannot satisfy `areaNotes()`. The instruction asks for the report as the note's second cited path; the report lives in LV, SD's guard rejects a path that does not exist in SD, and a report that lives only in a Linear comment passes silently. (Refined from the research: `lib/periodicals.js:335` does not name LV. The defect is the guard, not the wording.) | `lib/periodicals.js:334-335`; SD `test/area-notes.test.js` check 2. Scratch run at SD 5d8489e: a note citing an LV report fails "cites …, which does not exist"; a note citing an SD report passes. | none | **Note**: llm-and-prompts, Waiting (the seam; SD side named) |
| D10 | MED | Carry-forward #2: the heartbeat contradiction. `docs/dispatch-integration.md` says the runner kit sends `POST /api/proxy/runner/heartbeat`; the contract says "not sent". The kit's only heartbeat is a local file. | `docs/dispatch-integration.md:283`; `lib/runner-kit/contract.json:289`; `lib/runner-kit/broker.mjs:130`. | LIN-3636 (Backlog) | **Report** |
| D11 | MED | Carry-forward #6: `docs/architecture/source-map.md` grew from 153,272 B at 821cf841 (the 21 Oct. baseline) to 193,379 B at minting and 194,508 B / 415 lines now. 99 window commits touched it; 46 changed two lines or fewer. The generate-or-pin decision is a human call. | `wc -c` / `wc -l`. The map says "14 LISTED_DOCS"; executed 15. | none; human decision | **Closing** (no code path owns the map) |
| D12 | MED | Rate-limit wording is wrong in three places. The catalog says "60/min per token", but the code keys on a proven credential and falls back to the client IP before auth. The guide's per-IP token-mint line omits the session-account bucket (60 per account). | `routes/proxy.js:236-262` and `:270-291`; catalog `lib/proxy-instructions.js` three occurrences; guide `docs/proxy-integration.md:3001` (stale token line). Guide `:17,3000` is correct. | LIN-4378 (Done) | **Note**: agent-api, existing rate-limit entry extended |
| D13 | MED | The runner poll returns a `halt` key, and `target: dash` items are never returned to a runner poll. Neither doc says so. | `routes/proxy-runner.js` (poll filters through `isRunnerTarget`, `SESSION_TARGETS` = cli, web); `lib/dispatch-targets.js` (`POLLED_TARGETS` includes dash); catalog `:912` and guide `:2495` accept `target: dash`. | LIN-3622 (Done) | **Note**: agent-api, Waiting |
| D14 | MED | M1 (LIN-3745) is Done, but the LIN-3300 residue is still live: the comment at `routes/workspace-api-feedback.js:121-123` names a deleted "meta-prompt" scorer; `lib/plan-review-round-trips.js:27` cites a deleted file (`lib/prompts/meta-prompt-template.js`). Fourteen live lines in `lib/`, `routes/`, `server.js`. | Grep and file reads at HEAD. Live: `routes/workspace-api-feedback.js:122,499`, `routes/proxy.js:1435`, `lib/openrouter.js:851`, `lib/prompt-templates.js:351`, `lib/recommendation-facts.js:280,327`, `lib/completion-signals.js:332`, `lib/plan-review-round-trips.js:27`, `docs/prompt-pipeline/stage-descriptions/retro-audit.md:9,135`. | LIN-3745 (Done): **ownerless** | **Closing**: the person reopens or re-mints (no follow-up ticket minted here) |
| D15 | MED | The sealed `## As asked` block on LIN-4406 still says "merge it" and "Move this task to Done", above a superseding section (LIN-4390). The gate checks only a GitHub URL and the three second-read fields. The rendered periodical template is fixed (32 of 32 renders say "neither merges nor moves the task to Done"). | LIN-4406 description (GET). Template `lib/periodicals.js:284`; gate `lib/periodical-report-gate.js:125-148`. | LIN-4390 (ruling `lin4390-stage2-end-owner`) | **Closing**: the person may amend the sealed block |
| D16 | MED | None of the three entry points (README, CLAUDE.md, `docs/agent-onboarding.md`) mentions `docs/areas/`. In LV the only route to the notes is the prompt pointer (`lib/prompt-formatters.js:596-604`), so an undispatched session or a human never finds them. CLAUDE.md is at its budget (110 lines / 11,976 B against 110 / 12,000). | `tests/unit/claude-md-line-budget.test.js:28-29`. SD's CLAUDE.md does mention its notes. | none | **Closing**: CLAUDE.md is out of scope for this PR |
| D17 | MED | Post-split citations to `routes/proxy.js` are stale. There are 77 mentions in 36 doc files, and 23 of the 27 line citations are stale (nine point past the end of the 1,656-line file). The header at `routes/proxy.js:1-12` still describes the pre-split file. | Executed: parsed the citations. Examples: `docs/pipeline-hierarchy.md:17`, `docs/autopilot-operating-manual-research.md:186` (the `foreman/playbook` route and `buildForemanPlaybook` no longer exist). | LIN-3116 (Backlog) | **Report** |
| D18 | MED | Hand-counted figures disagree with source. `docs/executive-summary.md:34,122` say 14 templates; `:151` says 19 (executed: 19). `docs/runner-prompt.md:13` says "~73 KB"; the kit is 102,912 B. `theseus-method-long.md` says "eleven" areas (13). `server.js:2505` says "16 non-meta" templates, of which 16 have a route and 19 exist. | Executed counts; `wc -c` on `lib/runner-kit/broker.mjs` plus `runner.mjs`. | LIN-3115 (Backlog) | **Report** |
| D19 | LOW-MED | CI twin: CLAUDE.md:104 and `docs/architecture/ci.md:48` say the jobs are "unit and e2e"; `.github/workflows/test.yml:165` has `needs: [unit, e2e, secret-scan]`. | Read at HEAD. | none | **Closing** (CLAUDE.md out of scope) |
| D20 | LOW-MED | The experimental view list is inconsistent: `EXPERIMENTAL_VIEWS` has 7 entries in code (9 at 821cf841), and `docs/view-tiers.md` lists 6, omitting `passagePlanner`. | Executed. | LIN-1856 is Duplicate of LIN-1979 (Backlog): **ownerless** | **Closing** |
| D21 | LOW-MED | `README.md:37` still reads "Static projects preview" (the CLAUDE.md copy was fixed by LIN-3980). The README also frames the product as a tree view, where CLAUDE.md calls it a control plane. | `README.md:3,37`; `CLAUDE.md:3-5,69`. | LIN-2391 (Backlog; its title is wider than this line) | **Report** |
| D22 | LOW-MED | `docs/executive-summary.md:107,137,198` frame the product around Linear OAuth and a monospace font, which is out of date. | Read at HEAD. | LIN-3510 (Backlog) | **Report** |
| D23 | LOW-MED | `docs/proxy-integration.md` and the catalog do not describe the SIZE_RECORD and AS_ASKED error codes the same way; the guide's 422 table is missing `SIZE_RECORD_SHAPE` (see D6). | Covered by D6. | — | Covered by D6 |
| D24 | LOW-MED | The catalog's `effort` body field is missing on POST /dispatch, though the server accepts it (`lib/dispatch-entrance.js:1438,1454`). The guide's POST /dispatch field table also lacks `model` and `harness`. | `lib/proxy-instructions.js` body; guide `:2483-2512`. | LIN-2656 (Backlog) | **Report** |
| D25 | LOW-MED | [SD] Telemetry header in the README omits three default-on flags: `SD_TICKET_MARKER_RELAY` (`config.js:1375`), `SD_LAUNCH_BREAKER_ENABLED` (`:831`), `SD_CLOSE_WINDOW_ON_DONE` (`:1275`). The README's auth-stop text omits credential-dead workspaces (`auth-stop.js:61-68`). | SD README:199-204, 332-346. | LIN-2423 (Done) for the marker lane; the README gap is unowned | **Closing** |
| D26 | LOW-MED | [SD] `CLAUDE.md:23-25`'s `loadState` pointer goes to `docs/substrate.md`, which has no `loadState` hit. The LIN-3585 cache is not documented there. | SD `docs/substrate.md`; `state-store.js:92,134`. | LIN-3585 (Done) | **Closing** |
| D27 | LOW-MED | [SD] Seven SD README claims are wrong or stale beyond the above, including the research's "the format here is the same as LinearViewer's" (the rule sets differ; see §5.4), `docs/areas/README.md:13` citing "module groups" in `docs/module-map.md` (the map is flat), and LIN-2465 cited for precedence (Backlog, a to-do). | SD README:31; SD `docs/areas/README.md:6-13`; `docs/module-map.md` (458 lines, one H2). | LIN-2465 (Backlog), LIN-2177 (Backlog) | **Closing** |
| D28 | LOW-MED | [SD] Undocumented environment variables: 53 names read by SD code are absent from README, CLAUDE.md and `docs/**` (26 are under the README's deliberate "left out" prefixes; 27 are not). LV has five runtime variables absent from every doc: `DEPLOY_COMMIT`, `HARBOUR_DISPATCH_TOKEN`, `HARBOUR_DISPATCH_ID`, `HARBOUR_DISPATCH_FEEDBACK_URL`, `NODE_EXTRA_CA_CERTS`. | Executed scans (names only in the scratch reports). The SD state-and-config note's Waiting entry owns the registry gap, not the doc gap. | none | **Closing** (LV has no environment doc and no area file) |
| D29 | LOW | `public/llms.txt`: H11 names the unscoped `/api/recommend/status`, now a legacy redirect (`routes/legacy-redirects.js:54`). Its view list omits `projects` and the flag-gated `live-console` (`lib/components/view-nav.js:67,80-81`). Everything else checked resolves. | Executed endpoint, selector and flag checks. | none | **Note**: front-end-browser, Waiting |
| D30 | LOW | `docs/runbooks/improvement-cycles.md` says "until LIN-3661 lands"; LIN-3661 is Done. | Read at HEAD. | LIN-3661 (Done) | **Closing** (runbook has no area file) |
| D31 | LOW | Periodical autopilot kickoff says a review "takes no tail: stop when it is done"; under LIN-4390 "done" is ambiguous between hand-off and Done. | `lib/prompts/autopilot-kickoff.js` around the periodical branch. | none | **Closing** (wording; prompt text owned by llm-and-prompts, low room) |
| D32 | LOW | Area-note format and accuracy defects (see §5.4 for the full list). Fixed in this change: four Seams citations outside their parentheses, two Periodical readings without a report path, one wrong `HALT_MODES` home, one wrong ticket on a Survey tally entry, one stale tally entry (the "aside" trigger, which no code or ticket names), the settled limiter entry, the agent-api broker entry's incomplete claim, the llm-and-prompts guard entry (147 vs 200 lines; `sh` is SD's), and the "four code places" count (it is 17 lines in 10 files). Not changed: `front-end-pages.md:12` (the select at `lib/render-proxy.js:51` is named by its label; the one at `:68` is not), and `platform-and-plumbing.md:14-15` (cites LIN-4167, which is Canceled). | Executed and read at HEAD. | — | **Report** for the two not changed; **Note** for the rest |
| D33 | LOW | Carry-forward #12: `docs/runbooks/improvement-cycles.md` line (see D30); `kpi-daily-rollup.md:3` "build is a separate ticket" is stale (built as d2da45a3, LIN-3724). | Read at HEAD. | LIN-3724 (Done) | **Closing** (runbook) |
| D34 | LOW | `docs/papers/README.md` indexes 102 of 102 `harbour/*.md` files but misses `harbour/model-choice-by-call.md`. | `docs/papers/README.md`. | none | **Closing** (no area file) |
| D35 | LOW | `experiments/` (22 MB, 590 files) has no README. | Count. | none | **Closing** (no area file) |
| D36 | LOW | `docs/reviews/` (88 MB, 109 top-level reports, 45 evidence directories, 3,562 files in evidence) has no index. Ten top-level names break the `<name>-<date>.md` convention. | Count. | none | **Note**: llm-and-prompts, Waiting (cited through `lib/periodicals.js`, which writes the reports) |
| D37 | LOW | Verified and holding (no action): no residue of the removed `sizePolicy` setting (LIN-4393); the per-credential rate limit and broker 429 policy are documented correctly in LV and SD; the periodical routes are correct in catalog and guide; `llms.txt` endpoints and selectors resolve; the M2 census tests (SD) pass. | §5.3, §5.5. | LIN-4393, LIN-4378, LIN-3746 (Done) | none |

Rows are ranked by severity; IDs are stable, so D38 sits after D1 in the table. Ticket-owned findings (D5, D7, D10, D17, D18, D21, D22, D24) stay in this report only, as the brief requires. D12 is not ticket-owned: LIN-4378 is Done, so its gap has a note entry.

## 3. Trend ledger against the 21 Oct. report

Eighteen rows, plus M1 and M2. "Held" means still true at HEAD.

| Item | 21 Oct. claim | Verdict at HEAD | Ticket (state) |
|---|---|---|---|
| M1 | LIN-3300 meta-prompt residue | **Partly fixed; residue live** (D14). Ownerless because the ticket is Done. | LIN-3745 (Done) |
| M2 | SD enumeration census guards | **Held**; the three named census tests and `claude-md-line-budget` pass (SD `node --test`: 28 of 28) | LIN-3746 (Done) |
| 2 | Heartbeat contradiction | **Held** (D10) | LIN-3636 (Backlog) |
| 3 | "static projects preview" in CLAUDE.md | **Fixed in CLAUDE.md** (LIN-3980); **held in README.md:37** (D21) | LIN-2391 (Backlog) |
| 5 | Gate codes absent; catalog gaps | **Held** (D5) | LIN-2390 (Backlog) |
| 6 | source-map.md growth | **Held and worse**: 194,508 B / 415 lines (D11) | Human decision |
| 7 | `effort` missing from POST /dispatch | **Held** (D24) | LIN-2656 (Backlog) |
| 8 | Post-split `routes/proxy.js` citations | **Held and worse**: 23 of 27 line cites stale (D17) | LIN-3116 (Backlog) |
| 9 | Env drift | **Held**: LV five undocumented runtime variables; SD 53 (D28) | none |
| 10 | auth.md omits register and reproof | **Held** (`architecture/auth.md:94-100`; routes at `routes/email-auth.js:417,432`) | none |
| 11 | Hand-counted figures | **Held and worse**: exec summary 14 vs 19; runner prompt 73 KB vs 103 KB; "eleven" vs 13 (D18) | LIN-3115 (Backlog) |
| 12 | Status lines (kpi-daily-rollup, improvement-cycles) | **Held** (D30, D33) | none (runbook) |
| 14 | CI twin ("unit and e2e") | **Held** (D19) | none |
| 15 | Stale inline comments | **Mixed**: `isOwnerAnswer` has 0 non-test callers (held); proxy-compute and task-chat wording fixed; `tests/e2e/templates.spec.js:17` fixed; `tests/e2e/prompts-page.spec.js:5` still says "15-template"; SD `feedback.js:19` cites a line that is now a comment (held) | none |
| 16 | H9–H12 | **H10, H11, H12 held** (H11 is D29); H9 not re-checked | none |
| 17 | Executive-summary framing | **Held** (D22) | LIN-3510 (Backlog) |
| 18 | SD (docs cleanup) | **Held** (D26, D27) | LIN-2177 (Backlog) |
| exec counts | EXPERIMENTAL_VIEWS and PROMPT_TEMPLATES counts | **Corrected**: `EXPERIMENTAL_VIEWS` 7 (not 9); `PROMPT_TEMPLATES` 19 (not 17) (D20) | LIN-1856 (Duplicate of LIN-1979, Backlog) |

## 4. Seed corrections

These are corrections to the premise the research and the Surveys started from. They are recorded so later runs do not repeat them.

1. **#3 is partly fixed.** `CLAUDE.md:69` matches `lib/render-landing.js` after LIN-3980. `README.md:37` still carries the old line. LIN-2391's title (Jira read-only, no-OAuth, proxy framing) is wider than that line, so it stays open.
2. **`public/llms.txt` is not a third copy of the API docs.** It is the browser and DOM guide. It names 5 of 79 proxy paths. The registry's `^public/` placement to front-end-browser is correct. The overlap is two surfaces (the catalog and the guide), not three.
3. **The Survey tally entries are in runs-and-dispatch**, not llm-and-prompts. There were six; one is pruned (the "aside" trigger), so five remain.
4. **`areas.json` has 13 areas**, not 12 (21 Oct.).
5. **`PROMPT_TEMPLATES` has 19 keys** (21 Oct. said 17; server.js said 16 non-meta).
6. **`EXPERIMENTAL_VIEWS` has 7 entries** (21 Oct. said 9).
7. **The catalog's "per token" rate-limit wording is imprecise**, not simply wrong: it holds after auth and fails before it.
8. **The LIN-4406 "As asked" block is generated text.** It is not the person's words. A periodical minted during the deploy gap carries the superseded finish line, and only text below the end line can correct it.

## 5. Surface assessments

### 5.1 Agent-facing API (catalog, guide, `public/llms.txt`)

Catalog (`lib/proxy-instructions.js`, rendered with `buildInstructions({baseUrl, scope:'readWrite', grants:[...]})`): 79 registered proxy paths, 65 covered (D6). Ten routes were added in the window and all are in the catalog. The kind contract is wrong (D1). The `readWrite`+`take` grants row is not mintable over HTTP (runner tokens are take+dispatch; `routes/proxy-tokens-admin.js:72-96`), though `mintGrantBootstrap` can mint a take-only token (`lib/proxy-tokens.js:383-385`), so this is a low-severity inaccuracy, not a dead row. The poll's `isRunnerTarget` restriction is undocumented (D13). The verb-override list is short (D7). "60/min per token" is imprecise (D12). Sampled 14 guide claims against their handlers: all hold.

Look-first (D38, from the second read): on a fresh, unsized ticket the served catalog tells an agent that `recommend` and `recommend-and-dispatch` send survey-task, survey-place and then scoping, and that a live step answers `prompt: null` with `liveWait`. The guide's GET /recommend section and its worked example do not describe it, so the guide's example takes a Survey step as the task. Verified at source; the live-wait name is `liveWait` at HEAD (LIN-4392 replaced the look-first-only wait).

Guide (`docs/proxy-integration.md`, 3,003 lines): covers 64 of 79 routes. Its error tables omit `SIZE_RECORD_SHAPE`. It omits the periodical gate codes (D5). Its grants row omits `POST /periodicals/{id}/mint`, a miss that LIN-4320 also records for CLAUDE.md:107.

No test keeps the guide's route list in step with the catalog. The twelve tests that read the guide each pin one phrase.

`public/llms.txt`: 845 lines, 57 endpoints named, all resolve; 314 selector tokens found in source. Two stale items: H11 and the view list (D29). It is the cleanest of the three surfaces.

Sources of truth that agents read and were checked against code: the periodical routes (landed LIN-4381, scope LIN-4382, mint LIN-4313) are correct in the catalog and the guide.

### 5.2 Periodicals, seal, size record, leftover step

- Finish line. The superseding text (LIN-4390) is rendered by every periodical template (32 of 32 renders). The gate checks only a GitHub URL and the three second-read fields. No agent-visible document says a builder merges or sets Done for a periodical; `docs/areas/llm-and-prompts.md` correctly gives that to close-out. The sealed block on LIN-4406 still conflicts (D15).
- Seal and size record. The `## As asked` and `## Size of the move` wording matches `lib/as-asked.js` and `lib/size-of-move.js`. No residue of the removed `sizePolicy` setting (LIN-4393). The guide omits `SIZE_RECORD_SHAPE` (D6).
- Leftover step. `ROW_ONLY_KINDS` is `['wake','leftover']` (executed). Describes: `lib/prompts/leftover-words.js`, `lib/dispatch-leftover.js`, `lib/prompt-template-defs.js:925,1064`, `docs/architecture/dispatch-and-proxy.md:112-128`. Silent: CLAUDE.md, README.md, `public/llms.txt`, `docs/agent-onboarding.md`, `docs/proxy-integration.md`, the catalog's parent-hold text, `docs/dispatch-protocol.md`, `docs/runner-prompt.md`, `lib/proxy-preamble.js`, and the autopilot prompts (D1).
- Periodical prompt budget (D8) and reports index (D36): see §6.

### 5.3 Rate limits and the broker 429 policy

Holds: `routes/proxy.js:232-262` (60/min per proven credential, else IP); `Retry-After` is set (express-rate-limit); feedback and heartbeat 100/min per IP (`routes/dispatch.js:92-112`); poll and take unlimited; flight-companion 30/h per token and 200/day per workspace (`routes/proxy-flight-companion.js:64-65`). Gaps: D12 (wording and the session-account mint bucket in the guide), and the broker's 60s wait is recorded on both sides in `lib/runner-kit/contract.json` but no test ties the limiter window to it (the existing agent-api entry, now corrected).

SD side: `module-map.md:137-143` matches the broker (`EXCHANGE_RETRIES=2`, `EXCHANGE_MAX_WAIT_SECONDS=60`, `exchangeRetryWait`, forwarded requests not retried). Holds.

### 5.4 Area notes (both repos)

Guards: LV `tests/unit/area-notes.test.js`, `tests/unit/lin-4377-area-notes-pointer-bytes.test.js`, `tests/unit/claude-md-line-budget.test.js` — the checks (slug, path exists, first path in the right area, 6,144 B cap) run, see §10. LV's runner also covers the 13 area, pointer and claude-md files: 117 of 117 pass at HEAD before this change. SD `test/area-notes.test.js` and the M2 census tests: 28 of 28 pass.

Per-note bytes (cap 6,144), before → after this change:

Sizes are on `origin/main` before this change (`008d38bb0`, which includes LIN-4392, LIN-4398, LIN-4405 and LIN-4407) and after it.

| Note | Main before | After | Lessons | Waiting | Notes |
|---|---|---|---|---|---|
| runs-and-dispatch | 6,144 | 5,916 | 11 | 16 | pipeline-churn entry removed (LIN-4405 filed it as LIN-4409, so it is ticket-owned); HALT_MODES home fixed; wake-shadow ticket corrected; 'aside' entry pruned; settled limiter entry pruned; contract.json report moved inside its parenthesis |
| llm-and-prompts | 6,139 | 6,106 | 12 | 14 | close-out Waiting folded into the Lesson; guard entry rewritten as the seam; two new entries; CUT pair merged; distilled |
| agent-api | 4,543 | 6,040 | 3 | 12 | three new entries; broker and rate-limit entries corrected; Seams citation moved; distilled |
| front-end-browser | 1,140 | 1,549 | — | 4 | one new entry (llms.txt) |
| other-features | 1,803 | 1,805 | 1 | 5 | Seams citation moved |

Other notes (front-end-pages 2,728; platform-and-plumbing 831; wiring 606; auth-accounts-and-workspaces 577; web-routes 970; reports-and-operator-tools 981) are unchanged and under 3,000 B.

Format defects found (all corrected in the three notes; the rest are listed for the owning area):

- Seams citations outside the parenthesis: `runs-and-dispatch.md` (contract.json), `agent-api.md` (two), `other-features.md` (as-asked-seal). All four fixed.
- Periodical readings without a report path: `runs-and-dispatch.md` (pipeline-churn) is no longer a note entry: LIN-4405 on main filed it as LIN-4409; `llm-and-prompts.md` (prompt-formatters guard) rewritten.
- Wrong home: `runs-and-dispatch.md` cited `HALT_MODES` in `lib/dispatch-targets.js`; it is in `lib/workspace-halt.js:34`. Fixed.
- Mis-sourced: `runs-and-dispatch.md` wake-shadow was tagged LIN-4166; the classifier is LIN-3257 (Done). Fixed.
- Stale trigger: `runs-and-dispatch.md` "on a second 'aside' case" — no code, ticket or test names an "aside" case. The mechanism is `subscription: 'none'` (`lib/dispatch-store.js:755`, LIN-4166). Pruned.
- Settled: `runs-and-dispatch.md` "feedback and heartbeat limiters stay 100/min per IP" (LIN-4378, Done). Pruned as a status fact.
- Guard entry in llm-and-prompts: the numbers were right but the subject was ambiguous. LV's guard is 147 lines with no `sh`; SD's is 200 lines with `sh`, and also checks root-module coverage. Rewritten as a cross-repo seam (D9).
- Count: `docs/areas/` is spelled in 17 lines across 10 code files (llm-and-prompts said "four code places"). Corrected.
- Not changed, for the owning area: `front-end-pages.md:12` (the proxy scope select at `lib/render-proxy.js:51` is named by its label; the one at `:68` is not); `platform-and-plumbing.md:14-15` (cites LIN-4167, Canceled).

Accuracy: sampled 40+ entries against code; the Lesson claims (RUN_FIELDS, `_archiveItem`, `_planWake`/`_deliverWake`, `claimHeldWake`, `ROW_ONLY_KINDS`, `releaseHeldWake`, `AS_ASKED_LEAD`/`BRIEF_HINT`, `applyDefaultDispatchHarness` importers, `truncationFailureOf` arms, `isHermeticTestToken`, `GATE_DUE_MARKER` in cost-replay goldens) hold.

Survey tally entries (runs-and-dispatch): all cited tickets are Done. cost-read (LIN-4201) and session-summary (LIN-4201) hold and are unowned; dispatch-feedback-validation (LIN-4240/4239/4233) is partly settled (`PARKED_WAIT_SKIPPED_KINDS` is still a second skip set beside `FEEDBACK_ENTRY_KINDS`), left as written; wake-shadow (LIN-3257) holds; runner.mjs fold (LIN-4203, 4195) holds on both sides.

Cross-repo: the SD verification found no backticked LV-only path in the SD area notes. The LV notes were not separately re-checked for backticked SD paths; the entries I wrote cite LV paths only.

### 5.5 simple-dispatcher docs (README, CLAUDE.md, module-map, env)

Not owned by this repo's notes; all SD-side. Full detail in the closing comment.

- README (415 lines / 35,244 B): 45 claims checked, 36 hold, 9 wrong or stale (D2, D3, D4, D25, D26, D27). Thirty env defaults checked against `config.js` in a clean load: 42 of 44 `NAME=VALUE` lines match in effect.
- The `.env` block (lines 52–205, 154 lines, 12,346 B) restates config.js comments. The block itself is wrong to copy (D3). `DISABLE_AUTOUPDATER=1` on every dispatched claude is undocumented (`executors.js:433`, LIN-2469). Cold resumes and stall re-fires use the session's recorded model and effort (`harnesses.js:604`, LIN-3830). Neither is in the README.
- CLAUDE.md (89 lines, 5,022 B) is within its budget (`test/claude-md-line-budget.test.js:12-13`).
- Env census (SD): about 115 unique names read; 53 undocumented (D28). The state-and-config Waiting entry owns the registry gap but not the doc gap.
- Structure: the five remote/cloud/fleet planning documents total about 95 KB and overlap; the README spends about 170 lines on env config before its architecture table at line 358. The README does not say where to start reading (CLAUDE.md has the "Where the detail lives" list).
- Window: the SD commits that changed behaviour without a doc change, in order of consequence: stop-cancelled follow-ups (D2, LIN-4079/4082); `SD_TICKET_MARKER_RELAY` and related default-on flags (D25); cold resume model (LIN-3830); unapplied effort is reported (LIN-3857, `dispatcher.js:1016-1017`); `DISABLE_AUTOUPDATER` (LIN-2469).

### 5.6 Runner kit and prompt text

- `lib/runner-kit/contract.json` has no row for `runner/usage` (D6).
- `docs/runner-prompt.md:13` says "~73 KB"; the kit is 102,912 B. That text is runtime prompt source (`lib/prompts/runner-kickoff.js:41`), so the number reaches agents (D18).
- The heartbeat contradiction (D10) is between the dispatch doc and the contract.
- No prompt text mentions the held DONE wake; the autopilot kickoff does not describe it (D1).

### 5.7 Doc stores

| Store | Size | Files | Index | Notes |
|---|---|---|---|---|
| `docs/reviews/` | 88,169,741 B (du 91M) | 109 top-level reports; 45 `_evidence*` directories (3,562 files, 80 MB); 5 other directories | none | 10 names break `<name>-<date>.md` (`-runN` suffixes and `lin-XXXX` replay reports). D36. |
| `docs/papers/` | 36,896,662 B | 1,433 files, 125 `.md` | `README.md` indexes 102 of 102 `harbour/*.md` but one is missing | D34 |
| `experiments/` | 22,248,016 B | 590 files | none | D35 |
| `docs/architecture/source-map.md` | 194,508 B | 415 lines; 43 lines over 1,000 characters; max 9,007 | n/a | 99 window commits touched it; 46 changed two lines or fewer. D11 |

### 5.8 Entry points and discoverability

- README.md: 225 lines, 12,133 B. Sections: Features, Authentication, Setup, Usage, Testing, Deployment, Tech Stack, Documentation, License. The documentation list (lines 216–222) links neither the agent onboarding doc nor the area notes.
- CLAUDE.md: 110 lines, 11,976 B. At the line cap, 24 bytes under the byte cap. Must remove as much as it adds. Not edited in this change (D16, D19).
- `docs/agent-onboarding.md`: 104 lines, 4,669 B. Lines 1–28 are design notes; the served guide follows the first `---`.
- None of the three mention `docs/areas/` (D16).

## 6. Note changes in this change

- `docs/areas/agent-api.md`: four new Waiting entries (held wake and `leftover`/kind contract; the look-first sequence the guide omits (D38); guide and catalog route gaps, with the runner-usage row and `SIZE_RECORD_SHAPE`; poll `halt` and dash exclusion). The rate-limit entry is shortened: its "per token" point stays, and the guide's session-account mint line is recorded only in D12. The rate-limit entry is extended (proven credential vs IP; the guide's session-account line). The broker entry is corrected: the contract records the 60s wait on both sides, but no test ties the limiter window to it. The `lib/proxy-preamble.js` Seams citation is moved inside its parenthesis. 4,543 → 6,040 (under the 6,144 cap).

Correction to the rebase account: the `routes/proxy-writes.js` entry's sentence on the look-first sequence (`lib/proxy-instructions.js` spells it by hand beside `LOOK_FIRST_STEPS`) was removed on `origin/main` by LIN-4407, before this branch was rebased. This change did not remove it, and it is not restored here: the duplication it describes is a decision-duplication item for the Drift & Coherence owner.
- `docs/areas/llm-and-prompts.md`: the close-out Waiting entry ("who merges is retyped") is folded into the close-out Lesson, keeping its rule; the Lesson names the five files. The guard entry is rewritten as the cross-repo seam (D9). New Waiting entries: Periodical prompt budget (D8) and the `docs/reviews/` index (D36). Distilled, with content kept: the `stage-intent` CUT and "narrowing" pair (merged), `call-budget` replay, the `areaNotes()` restatement (its duplicate "Waiting entries are context" mention dropped), and the Surveys Lesson (dropped "its record takes no fifth line"). LIN-4407 had distilled several of the same entries on main; the note was rebased onto its wording.
- `docs/areas/runs-and-dispatch.md`: the `lib/pipeline-churn.js` entry was removed on main (LIN-4405, filed as LIN-4409); `lib/dispatch-leftover.js` HALT_MODES home fixed; `lib/runner-kit/contract.json` Seams report moved inside its parenthesis; wake-shadow ticket corrected to LIN-3257; the "aside" entry pruned (no referent); the settled limiter entry pruned. The runner-usage gap is recorded in agent-api, where its route lives (`routes/proxy-runner.js`). 6,144 → 5,974.
- `docs/areas/front-end-browser.md`: one new Waiting entry (`public/llms.txt` H11 and view list, D29).
- `docs/areas/other-features.md`: Seams citation moved inside its parenthesis (as-asked-seal).
- Guard run after edits: see §10.

## 7. Cross-repository seam placement

- **S1, the Periodical SD note's report path (D9).** LV side, `llm-and-prompts.md`, cited through `lib/periodicals.js`, naming SD's side (no Periodical rules in the SD README; SD's guard rejects a report that lives only in LV). SD side: no SD change is made in this PR.
- **S2, "the SD format is the same as LinearViewer's" (SD README).** Recorded LV-side with S1. The rules differ: LV has the Periodical rules, a "who writes here" map and a code-shape pointer; SD adds "a rule in CLAUDE.md stays there", the no-LV-backticks rule, root-module coverage and a registry that includes `scripts/` and `deploy/`. The differences are intentional, except that SD's README undercounts its guard's checks.
- **SD-side defects (D2, D3, D4, D25, D26, D27).** SD README and SD `docs/` changes would start in the SD repo. SD's notes README forbids backticked LV paths, and SD's own notes all hold, so there is no SD note to edit. These go to the person in the closing comment. **No SD PR is opened by this review.**
- **SD notes.** All SD entries hold. No SD note edit is needed.

## 8. Larger tidies and handoffs (for the person)

Each item is also in the closing comment on LIN-4406.

Larger tidies (size of move, not built here):
- Generate or pin `docs/architecture/source-map.md` (D11). A human decision.
- An index, or archive by series, for `docs/reviews/` (D36), also recorded as a Waiting entry.
- A documentation ownership mapping that leaves the code-shape census alone (LIN-3829 caution). Doc findings stop leaking into the two busiest code notes.
- A guide-from-catalog generator, or a test that keeps the guide's route and verb lists in step with the catalog (D6, D7).

Items with no area file to cite:
- LV environment documentation (D28): five undocumented runtime variables.
- `experiments/` README (D35).
- `docs/papers/` index omission for `harbour/model-choice-by-call.md` (D34).
- CLAUDE.md entry-point pointer to `docs/areas/` (D16), and the CI twin (D19). CLAUDE.md is at its budget, and this review does not edit it.
- SD README items D2, D3, D4, D25, D26, D27 (SD repo).
- Runbook `docs/runbooks/improvement-cycles.md` "until LIN-3661" (D30) and `kpi-daily-rollup.md:3` (D33).
- The sealed `## As asked` block on LIN-4406 (D15), for the person to amend.
- M1 residue (D14, LIN-3745 Done, ownerless): reopen or re-mint.
- EXPERIMENTAL_VIEWS mismatch (D20, LIN-1856 Duplicate of LIN-1979 with no live owner).

## 9. Repeated close recommendations

Stated once, as the brief asks. Each has a closing recommendation, not a new ticket:
- **LIN-3074** (halt copy): 0 non-test hits now. Close.
- **LIN-2629** (rulings endpoints): now documented (`docs/proxy-integration.md:1595`). Close.
- **LIN-1233** (umbrella doc review): close is a human call.

## 10. Coverage limits

- **Guards run after the edits, at this commit.** `tests/unit/area-notes.test.js`, `tests/unit/lin-4377-area-notes-pointer-bytes.test.js` and `tests/unit/claude-md-line-budget.test.js`: 10 of 10 pass. `tests/unit/docs-architecture-anchor-resolver.test.js`: 125 of 125 pass. `npm run secret-scan`: 7,782 files, 0 secrets. The full LV unit suite was not run; before the edits, LV's runner had covered the 13 area, pointer and claude-md files (117 of 117).
- **Not run:** the full SD suite. Only the four SD files named in §5.4 were run (28 of 28 pass).
- **Guide.** Checked route by route and code by code (64 of 79 strict matches, plus the window's ten routes). Not checked line by line. Sampled 14 claims against handlers; all hold.
- **`public/llms.txt`.** Endpoints, selectors and flags checked; 314 selector tokens were a substring check against source, not a DOM check.
- **Rendered help copy.** `lib/render-*.js` help text was not reviewed.
- **Stale `routes/proxy.js` citations.** 77 mentions, 27 line citations; 23 stale. Classification used a ±6-line window plus a symbol match, hand-checked on the 27 line citations and about 15 file-level citations. The rest are not individually bounded.
- **SD environment census.** About 115 names read; 53 undocumented; regex-based, ±1. Comment lines excluded; `test/` excluded.
- **SD `.env` behaviour.** Simulated in a scratch copy of the root JS (inline comments, `SD_PATH_PREPEND`, `SD_STATE_DIR`); not run end to end. Treat D3 and D4 as strong evidence, not a reproduced failure.
- **Periodical gate behaviour.** Read from code; the route was not run against Linear.
- **Linear text.** Referenced ticket text was not audited as source; ticket states were read with GET only.
- **Window pairs.** Commit-by-commit pairing of code changes to doc changes; a doc update in a sibling commit of the same PR may not be credited.
- **Counts.** Executed where stated. The 467-commit window was counted at 9cf51ef72; LV `origin/main` had not moved during the review.

## 11. Adversarial Second-Read

- **Tier:** 2, a fresh-context sub-agent (general-purpose). Not a self re-read.
- **Question:** "What is the largest item in this window that this report missed or misfiled?"
- **Reader was given:** both repositories with their windows, and the path to this report. It was not given the research conclusions, the Linear planning comments, or the report's top finding.
- **Verdict:** DISAGREE
- **Differed from top finding:** YES. The reader's top item was the look-first sequence (D38); this report's top finding is D1.
- **Disposition:** fixed in place. D38 is added (HIGH, agent-api Waiting entry), and §1, §5.1 and §6 are updated.

Verification of the reader's answer, at source:
- Confirmed: the guide has no look-first sequence; its only look-first hit is the 409 row, which mentions LIN-4370 in passing. The catalog documents the sequence. LIN-4370 is Done, so the gap is unowned.
- Corrected: the reader names `lookFirstWait`. At HEAD the live step returns `liveWait` (`lib/openrouter.js:2070,2086`), since LIN-4392 replaced the look-first-only wait. The substance stands.
- Confirmed: the reader's point about the `routes/proxy-writes.js` look-first clause. It was removed on `origin/main` by LIN-4407 before this branch was rebased; the report's rebase account now says so (§6). It is not restored here.
- Not changed: the reader's remark that the report's second-read section was a placeholder; it is now this section.

The reader's full answer, verbatim:

> 1. TOP ITEM: The look-first route (LIN-4370) is missing from the report. On a fresh, unsized leaf ticket with an `## As asked` block, GET `/issues/{id}/recommend` and POST `/recommend-and-dispatch` no longer answer with the selector's stage. `lib/recommendation-look-first.js:1-20` says such a ticket goes survey-task, then survey-place, then scoping, with `LOOK_FIRST_STEPS` at line 77. `lib/openrouter.js:2069-2085` (`codeRoutedRecommendation`) returns that step's prompt, or during a live step returns `prompt: null` with `lookFirstWait`. `routes/proxy-compute.js:539` sets `kind` to null in that case. The served catalog documents this (`lib/proxy-instructions.js:282` for the null shape, `:923` for the 409, and `public/llms.txt:269-270`). The guide does not. Its GET /recommend section (`docs/proxy-integration.md:1835-1875`) describes only an AI-generated prompt, the guide has zero `lookFirst` hits, and its only look-first text is the 409 row at line 2893. The guide's worked example (lines 2934-2936) reads `prompt` from GET /recommend and does the work with it, so an agent following it on a fresh ticket would get a Survey step, or `null`, as its task. The report never mentions the sequence. Grep for LIN-4370, look-first, survey-task and LOOK_FIRST in `docs/reviews/documentation-review-2026-11-10.md` finds only D7 (line 54), which says the guide's verb list "drops survey-task, survey-place" and nothing about the sequence that sends them. The ownership is also off: `docs/areas/areas.json` places `recommend[^/]*` under llm-and-prompts, and no area note has a look-first entry. The report's own agent-api edit also removed the one pointer to the sequence. The 9cf51ef72 Drift entry says "`lib/proxy-instructions.js` also spells the look-first sequence by hand, though `lib/recommendation-look-first.js` holds `LOOK_FIRST_STEPS`", and the working-tree version drops that clause while the report says content was kept. It is larger than D1 because D1 affects how a DONE status is read on implementation builds that have a leftover row. Look-first changes the kind and prompt returned by both recommend verbs for every fresh unsized ticket, and adds a 409 that autopilots meet while a step runs.
>
> 2. RUNNER-UP: The report's section 11, which it says holds the adversarial second read, is still the placeholder "*Filled in after the second read; see below.*" (report lines 282-284). The report's claim that its three agent-API note edits kept their content is also contradicted by the dropped look-first clause.
>
> 3. VERDICT: DISAGREE. The window has an agent-facing behaviour change (LIN-4370) that the report never mentions, and the guide does not match the catalog on it, which changes the ranking and dispositions.

Reader's runner-up (the placeholder) is resolved by this section. Its ownership point is addressed by filing D38 under agent-api, the catalog and guide owner, with the look-first code cited by the agent-api entry's first path (`lib/proxy-instructions.js`), so the entry sits in the right area.
