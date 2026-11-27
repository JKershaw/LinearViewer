# Sweep pass 2, check 2: sections D and E (27 Nov)

Checked read-only against Harbour main `5c33e4415` (`main:`) and simple-dispatcher main `d692ac7` (`sd:`), the fetched tickets (`tix/`), one fresh ticket read (LIN-4366), and all 377 open project findings (`GET /api/proxy/records?to=project&state=open`, read 27 Nov). The seven Security Review task records come from the scratchpad copies read on 27 Nov 11:01. "Imported" means a Waiting entry that LIN-4505 brought in as a project finding on 20 Nov. The area notes now hold only `## Lessons`.

## D

- D1 — **tracked** — LIN-4341 Backlog, LIN-4343 Backlog (LIN-4342 Done 25 Nov).
- D2 — **done** — LIN-4316 Done 8 Nov; its closing comment says LIN-4347 decided and applied it (area notes on main, PR #2357).
- D3 — **gone** — `lib/brief.js` was deleted by LIN-4537 (`463363e69`, "the model-written brief and recap … are gone"). The brief is now built from records (`main:lib/records/brief.js`).
- D4 — **tracked** — LIN-4348 Backlog. Both traps are written on the ticket: the runner kit can't map `fable` (Survey global, 7 Nov), and a cold resume sends no `--model` (Survey open-0).
- D5 — **tracked** — LIN-4350 Backlog. Its comments of 7–8 Nov hold the restated-rules fold, the ceiling-comment log, process history in comments and the +6.5 KB.
- D6 — **gone** — LIN-4355 is still Backlog, but LIN-4502 retired the As-asked seal, guard and Jira region (`f98a10de5`; log.md:4846). The ticket could be closed.
- D7 — **tracked** — LIN-4356 Backlog.
- D8 — **gone** — the close-out prune was retired by LIN-4502 (`9f3588d3b`, "retire the prune, description/below and task snapshots").
- D9 — **tracked** — LIN-4345's close-out filed it as LIN-4366 ("Does the prompt-size freeze cover a product guide served as a prompt?"), which is Backlog (read 27 Nov).
- D10 — **tracked** — finding-5b5c6285 is open (imported from llm-and-prompts, owner John). Caveat: the replay it names, `scripts/replay-brief.mjs`, was deleted by LIN-4502, and the brief it would replay was deleted by LIN-4537, so the condition needs rewording before anyone uses it.
- D11 — **open** — `main:lib/openrouter.js:371-390`: Luna is not on `FREE_TIER_MODEL_IDS`, and the comment says it joins "only once every free-tier job has come back whole on it". No ticket or finding covers running those live calls. *If left alone, the free tier stays on gpt-5.4-mini, which is 7–9x dearer and scores lower, because nothing prompts anyone to run the evidence.*
- D12 — **open** — no picker shows benchmark data (no `intelligence`/benchmark fields in `main:lib`, `routes` or `public`). LIN-4342 closed without it, and LIN-4343's text doesn't name it. *If left alone, a person choosing a model in Settings sees no quality signal, only names and prices.*
- D13 — **done** — the crawl was one close-out session's own script, not product code. What made it starve the fleet was the shared per-IP limiter. LIN-4378 (Done) changed the limit to per credential (`main:routes/proxy.js:247-251`, `proxyLimiterKey`), so a crawl like that now only throttles its own token.
- D14 — **open** — questions are records now, and the card offers each option as a click, with the recommended one marked (`main:lib/prompts/handoff-words.js:30`). Nothing asks the writer to flag an option that needs a person's hand action, or one that claims the person has acted, and no ticket covers it. *If left alone, John can approve a recommended option that changes nothing, or that claims he did something, and the run then carries on as if it had happened.*
- D15 — **open** — partly addressed. A run is told to check the task's open questions and answers before asking (`main:lib/prompts/handoff-words.js:33`, `QUESTION_CHECK`), so one task stops asking the same question twice. But the check is scoped to `in=<this ticket>`, and nothing joins the same question raised by several tasks about one shared event (log.md:3036, "no notion of a shared blocker"). *If left alone, when one event such as a failed deploy blocks several tasks, John is asked the same question once per task.*
- D16 — **gone** — that ruling was settled on 8 Nov during the Railway build outage. Nothing on main says deploys are manual (grep over `lib`, `docs/architecture`, `docs/*.md`, CLAUDE.md, README), and the close-out template says to wait for the deploy to land (`main:lib/prompt-template-defs.js:823`).
- D17 — **open** — read from the code, not run. `GET /api/proxy/issues/:id/recommend?format=md` ends with `res.end(rec.prompt || '')` (`main:routes/proxy-compute.js:427-433`), so a live wait (prompt null) answers 200 with an empty body. The JSON form carries `liveWait` (:452), and the docs (`docs/proxy-integration.md:1634`) don't mention the wait case. *If left alone, a script that downloads the prompt as markdown gets an empty file while a stage runs, with nothing to say why.*
- D18 — **gone** — `lookFirstWait` and `lookFirstRoute` are not in `main:lib`, `routes` or `public`. Code and docs both say `lookFirstStep` (`main:lib/recommendation-look-first.js:179`). The size guard and `size-of-move.js` were retired by LIN-4542. Scoping's description now describes its size job (`main:lib/prompts/stage-kinds.js:231`).
- D19 — **open** — `notes: true` is still set twice in each corrective Periodical builder (`main:lib/periodicals.js:419/429, 442/455, 470/480 …`, 26 occurrences). No finding covers it. The far-apart self-exclusion writers were not checked. *If left alone, a new Periodical can set one flag and forget the other: a small trap for whoever edits the file.*
- D20 — **tracked** — LIN-4350 Backlog (its 7 Nov comment, "process history" in comments).
- D21 — **tracked** — LIN-4388 Backlog.
- D22 — **tracked** — LIN-4389 Todo.
- D23 — **done** — A7 was filed as LIN-4445 and A8 as LIN-4446 (log.md:3599, 3628). A9 was held (log.md:3603), then overtaken by the 22 Nov ruling that size stays fuzzy under err larger (log.md:5228).
- D24 — **gone** — this is A9 (`asks.md` A9). Overtaken on 22 Nov: scoping settles size under err larger and asks only to cut, with settings left for later discussion (log.md:5228; 0-ledger #83).
- D25 — **gone** — slice 4 rebuilt rulings as question records with one dismiss. By design, a dismissal resumes the run with its `if-unanswered` (`main:lib/proxy-instructions.js`, Questions; log.md:5226), so "a dismiss that doesn't wake the agent" was decided the other way.
- D26 — **open** — both Surveys still run on every code task (`main:lib/recommendation-look-first.js:100`, `LOOK_FIRST_STEPS`). The conditional one-look was parked by John ("we did find benefits from two", log.md:3235), and nothing tracks it. *If left alone, every task keeps paying for two Surveys, which is John's own choice for now. It is only a cost idea that could be lost.*
- D27 — **done** — at the gate John returned to defaults ("happy to use the models we found met the bar", log.md:3604), and the lanes ran on default models (log.md:3608, 3629). He later moved builds to Opus deliberately (log.md:5269, 5275).
- D28 — **tracked** — Jira `createIssue` was added by LIN-4451 (`main:lib/providers/jira/index.js:12`). The rest is open on tickets: LIN-2805 Backlog (walk knows only `LIN-`), LIN-2094 Backlog, LIN-2026 Todo, LIN-2170 Backlog (real-tenant checks), LIN-2008 Todo (boards and sprints), LIN-4445 and LIN-4452 In Progress (set aside by John 21 Nov, log.md:5041). LIN-4355 is gone (see D6).
- D29 — **done** — the front end was left better by LIN-4446 Done and LIN-4463 Done (pages as modules, no build step). The two Theseus lanes were LIN-4447 Done (Runs & dispatch, `dispatch-store.js`) and LIN-4448 Done. The remaining target, LIN-4350, is Backlog (D5).
- D30 — **gone** — the 9 Nov chunked sort never ran as such. It was overtaken by "no big backlog sort" (log.md:4196), by John narrowing LIN-4416 with the rest left in the backlog (log.md:5285), and by the project-findings pile being set aside to fold into planned work (journey.md:356).
- D31 — **tracked** — finding-2e6b37aa is open (imported). It names "an index or series archive for `docs/reviews/` (109 top-level reports, 88 MB)" as a size of move.
- D32 — **done** — Drift run 7 (LIN-4443) and Seams run 12 (LIN-4444) were minted at the switch and merged 13 Nov (log.md:3577-3583).
- D33 — **done** — north star v4 was merged as `4b5001ddf` (PR #2420; `main:docs/north-star-v4-proposal.md` "Status: applied"). The stretches became the tag `stretch:open-the-door` at John's ask (log.md:3630). The survey-record PR was overtaken on 19 Nov: the record stays on its branch, cited by commit (log.md:4398).
- D34 — **gone** — "no Plotting the Course refresh for now" (log.md:3619).
- D35 — **done** — paper v2 (LIN-4275) Done 12 Nov, with all three pieces merged (log.md:3484).
- D36 — **done** — scored on 13 Nov: A2 "Right" (log.md:3574), and A1 partly bore it out (log.md:3411).
- D37 — **done** — LIN-4396 Done.
- D38 — **gone** — John retired LIN-4397 before it was planned (Canceled 13 Nov; comment 07:25). The missed wake it described is followed in E26.
- D39 — **done** — LIN-4399 Done.
- D40 — **done** — LIN-4401 Done.
- D41 — **done** — LIN-4414 Done. Its Waiting conveyor was later retired with the Waiting lists (LIN-4495).
- D42 — **done** — LIN-4416 Done 24 Nov. John narrowed it to the verdict-authority theme and left the rest of the 134 in the backlog (log.md:5285, 5293). LIN-2576 is still Todo.
- D43 — **tracked** — task-53e1786b is open, under task-309c83df ("every Security Review entry … is settled"). It names `routes/proxy-model-routing.js` and "`urlKey` filters untested". No model-routing store test has changed since the report (`main:tests/unit/model-routing-store.test.js`, last touched by LIN-4537).
- D44 — **done** — John decided all three at the gate (log.md:3611). Stale docs and vacuous tests are mess, not broken. The Duplicate pass goes to the light lane (see E30). Resurfacing is covered by A12.
- D45 — **open** — `main:scripts/code-shape/seams.mjs:27-41` collects only ESM import/export and literal `import()`, with no `require()`. The file is unchanged since 8 Nov, and no ticket or finding covers it. *If left alone, every Seams & Tangles run reports simple-dispatcher as having no internal structure, so its tangles are never measured.*
- D46 — **tracked** — LIN-4408 Backlog.
- D47 — **tracked** — LIN-4409 Backlog. The stale copy is still at `main:lib/pipeline-churn.js:67` (no `periodical`) beside `main:lib/run-view.js:112`.
- D48 — **tracked** — LIN-4410 Backlog.
- D49 — **can't tell** — Harbour's limiter answers "Too many proxy requests" with standard headers (`main:routes/proxy.js:252,265`). No "rate limited" string exists in Harbour's routes or lib, so the 429 may have come from the cloud session's egress, but that is unconfirmed. It lasted about 30 minutes, and the log records no recurrence.
- D50 — **can't tell** — the log doesn't say which `llms.txt` line was stale. The stage lines in `main:public/llms.txt:252-268` are now generated from the stage records (`scripts/gen-llms-catalogue.mjs`, per finding-6ef77ded). Other llms.txt staleness is tracked as finding-9e24d1fe.
- D51 — **open** — partly done. The disagreeing main-model rule is gone: LIN-4454 (`c205190fd`) retired `dispatchModelOf`, and the timeline carries the cost fold's model (`main:lib/task-timeline.js:53`). The hand-rolled TTL cache is still there (`main:lib/task-timeline.js:443-486`, one of about 10 `ttlMs` caches in `lib/`). The duration formatter was not checked. No finding covers it. *If left alone, there is one more small cache to keep in step: a tidy, not a fault.*
- D52 — **tracked** — LIN-4449 Backlog (workspace sharing, John's reframing of R4-11, log.md:3601). The same fact is also in finding-a5ec401e.
- D53 — **tracked** — finding-465c6225 (Jira API-token path only in Settings; the rail's add menu still uses `workspaceAddProviders`, `main:lib/components/frame.js:118`) and finding-908c9c38 (Simple Dispatcher never introduced), both open.
- D54 — **tracked** — finding-051af113 is open (imported; Onboarding R4-2).
- D55 — **done** — LIN-2386 Done 12 Nov (PR #2408). Its leftovers, such as the hand-written cache-path list, were noted only in its summary comment.
- D56 — **tracked** — LIN-4417 Backlog.
- D57 — **done** — LIN-4419 Done.
- D58 — **tracked** — LIN-690 Todo. LIN-4416 (Done) did not take it.
- D59 — **done** — John looked at it the next morning ("rulings close themselves when tasks close", log.md:3372). The gate review of rulings that closed unanswered counted `lin4418-reopen-690` as handled (log.md:3612-3617). Rulings are now question records (slice 4).
- D60 — **done** — LIN-4392's reads were CQ and CR, both better (log.md:3327, 3333). LIN-4415's were CW and CX, both better (log.md:3373).

## E

- E1 — **gone** — the leftover answer and its `Retires:` refusal were retired by LIN-4495 (`main:docs/proxy-integration.md:2069`).
- E2 — **tracked** — both copies remain (`main:tests/unit/area-notes.test.js:27`, `sd:test/area-notes.test.js:67`). `parseNote` now returns headings only (`main:lib/prompts/area-note-format.js:38`). LIN-4578 (Todo, slice 5) retires the notes, "their size cap and its test", in both repos.
- E3 — **gone** — `lib/dispatch-leftover-answer.js` was deleted by LIN-4495 (`81b590183`).
- E4 — **gone** — same file, deleted by LIN-4495.
- E5 — **tracked** — the rule is gone from Harbour (only a historical comment remains, `main:lib/prompts/leftover-words.js:13`). But `sd:docs/areas/README.md:72-82` still describes the retired retirement line and the proxy refusal, so it is now stale, not merely restated. LIN-4578 (Todo) retires simple-dispatcher's notes.
- E6 — **gone** — the leftover-answer route was retired by LIN-4495.
- E7 — **tracked** — the audit's notes-PR path still exists (`main:lib/records/standing.js:119-124`; audit template step 3 at `main:lib/prompt-template-defs.js:846`), but LIN-4578 (Todo) removes "the audit's notes-PR path", which makes the witness moot.
- E8 — **gone** — the A6 rule (outside finds to notes, a ticket if it breaks, blocks or touches safety) was retired by LIN-4495. The notes README now points to the code and restates nothing (`main:docs/areas/README.md:41-47`). `CONSEQUENCE_TEST` is now one constant about wording (`main:lib/prompts/leftover-words.js:40`).
- E9 — **gone** — the rule the guard protected is retired (see E8), and the doc paraphrases it found are gone.
- E10 — **tracked** — "filed follow-up" is still in `sd:docs/areas/README.md:60,81`, along with the rest of the retired Waiting conveyor. LIN-4578 (Todo) retires simple-dispatcher's notes.
- E11 — **tracked** — finding-d6d438ea is open (imported: a Periodical's live secret goes to the closing comment while `CONSEQUENCE_TEST` …).
- E12 — **gone** — an audit is now found by its run's stage (`main:lib/records/standing.js:121`, `AUDIT_STAGE`), not by heading text (slice 3).
- E13 — **gone** — the notes PR is now the change records that the audit run wrote (`main:lib/records/standing.js:119-124`), not the first link in a comment.
- E14 — **tracked** — the audit template still has its notes-PR step (`main:lib/prompt-template-defs.js:846-847`). LIN-4578 (Todo) removes that path.
- E15 — **tracked** — partly. LIN-4350 (Backlog) names rules "each held by its own regex pin" (comment, 7 Nov), and its Done asks that "the tests that pin behaviour still pass". No finding names wording pins in general.
- E16 — **tracked** — finding-e0ba3fe2 is open (imported: GET /issues has no `createdAt`, 22 probes).
- E17 — **tracked** — finding-a4aa7e70 is open (imported: `lib/library.js` summaries by position).
- E18 — **tracked** — LIN-690 Todo, LIN-2576 Todo, LIN-4215 Backlog, LIN-4155 Backlog. LIN-4416 is Done but was narrowed, and took none of them.
- E19 — **tracked** — the seat measure is finding-191df368, open (imported). The stale `WAKE_FEEDBACK_REGEX` comment was fixed on 12 Nov by LIN-4437's leftovers (`185305dba`; `main:lib/dispatch-terminal.js:50-62`).
- E20 — **open** — the read's finds were never homed (it sorted none outside). One is still true: the unit suite reads `docs/reviews/` (`main:tests/unit/stability-measures.test.js:997`). The `readOn` header claim and the test-only fallback were not checked. *If left alone, moving or pruning the review folder breaks the unit suite: a small trap.*
- E21 — **can't tell** — this is about Harbour OS's Railway service (repo `JKershaw/harbour-cat`), which can't be seen from here. It is recorded only in LIN-4419's comments (Done, 12 Nov, "nothing is broken today").
- E22 — **gone** — the skew entry concerned comment-classified landings (`isLandingEvidence`; added `351146acf`, edited `ba943a227`). Slice 3 retired the comment-trail paths (log.md:5217), and the landing now comes from one records function (`main:lib/records/landing.js`, `readLanding`).
- E23 — **open** — the gate still exists (`main:lib/run-closeout-state.js:70-81,333-346`). Its hold on close-out was seen live on LIN-4531 (log.md:5243). But no record shows the 409 on an early close-out, or the stop-at-PR kickoff, witnessed live, and nothing tracks it. *If left alone, two gate paths carry a runtime claim that no run has shown working, against the project's own witness rule.*
- E24 — **done** — LIN-4441 Done (0-ledger #4).
- E25 — **tracked** — finding-0760a9f7 (committed-tool wording per template) and finding-49b61248 (the declaration contract checked from two files), both open.
- E26 — **tracked** — the missed delivery recurred and was traced as the resume race (LIN-4569 Backlog, findings). Its fix is LIN-4572, Todo ("if a delivery is lost anyway, it is noticed within minutes"). Round 1's own stall was never traced.
- E27 — **done** — LIN-4465 made one `CODE_ROUTES` (`main:lib/code-routes.js:30`). The wrong line ("blind-read: Sent by hand", llms.txt:271 at `5e09b5643`) now reads "Code sends it after an approving review" (`main:public/llms.txt:268`).
- E28 — **tracked** — LIN-4341 Backlog. A9 is gone (D24).
- E29 — **done** — the review after real work happened on 14 Nov (log.md:3847-3870), and the notes review on 25–26 Nov (log.md:5315, 5368-5377; `notes-review.md`).
- E30 — **open** — no record of the pass after log.md:3806 ("waits until after the reset"). It is not in the 0-ledger or the spikes, and no ticket covers it. *If left alone, 51 tickets marked Duplicate, including LIN-1808 (Urgent), are never checked, so a real problem filed under the wrong state stays hidden.*
- E31 — **tracked** — LIN-4449 Backlog, LIN-3836 Backlog, LIN-4215 Backlog.
- E32 — **gone** — on 19 Nov John agreed that the full record stays on the branch, tickets cite it by commit, and only the design pages go to main (log.md:4398). The design pages are on main under `docs/plans/survey/integration` and `layer`.
- E33 — **open** — both still true. `main:lib/observer-efficacy-signal.js` is imported by no production module (only comments name it), so the shadow log stays write-only. The store still imports `live-console` through `main:lib/dispatch-store.js:56` → `main:lib/digest-feedback.js:47`. No finding covers either (finding-81729b6a treats the signal as live). *If left alone, dead code and an inverted dependency stay in the busiest area, and readers keep assuming the shadow log is used.*
- E34 — **open** — `main:lib/openrouter.js` is still 2,258 lines, with four separate chat-request call sites (:1189, :1472, :1747, :2177). LIN-4448 worked on stage kinds and routes, not these. finding-fbdf339f covers only the call-budget split. *If left alone, any change to how Harbour calls OpenRouter has to be made in four places, and they keep drifting.*
- E35 — **open** — workspace teardown is still written twice (`main:routes/workspace.js:122-136` and `:147-156`). The mock-AI recognition is partly tracked (finding-ef1ecf8a). The page-chrome bag was not re-checked after LIN-4342's `renderFrame`. *If left alone, a new step in workspace removal (a revocation, say) must be added in two places, and missing one leaves credentials alive.*
- E36 — **tracked** — the ship copies are finding-0ca051b9, open. The bridge (and its timing-guard entry) was deleted by LIN-4463 piece 5 (`23681d50a`, "the bridge is deleted").
- E37 — **tracked** — LIN-4343 Backlog (LIN-4342 Done 25 Nov).
- E38 — **done** — the paper was LIN-4480 (`main:docs/papers/harbour/lanes-across-the-seam.md`), and the essay LIN-4484 *Notes across the border* (`main:docs/papers/harbour/notes-across-the-border.md`; log.md:4058-4069).
- E39 — **open** — partly done. The `slugifyForFilename` copy is gone from `public/`, and pages are modules (LIN-4463 Done). The status-pill glyphs are still mirrored (`main:public/common.js:263`, `flight-companion.js:704`, `task-chat.js:94`, `proxy.js:197`), and "cannot import" comments remain (for example `main:public/prompt-section.js:203`, now a module). No finding covers them. *If left alone, a glyph change needs edits in four browser files, and the comments mislead the next reader.*
- E40 — **tracked** — imported as open findings: test-transport drift is finding-ceb18902 (with finding-ef1ecf8a), and LIN-4455's feedback-kinds table is finding-3c35d5a4. Matched by content.
- E41 — **tracked** — LIN-4445 and LIN-4452 In Progress. John set them aside on 21 Nov, to come back to later (log.md:5041).
- E42 — **done** — John answered in words on 23 Nov ("No figure, and no paired read against a control area…", decision-7ceddf62, log.md:5261). LIN-4463 Done 24 Nov.
- E43 — **gone** — the lanes' after-reads ran (LIN-4462 Done, LIN-4470 Done). The front end's paired read was dropped by John's 23 Nov answer (decision-7ceddf62), and the 15 Nov pause replaced this review method.
- E44 — **tracked** — LIN-3417 Backlog, LIN-1273 Todo, LIN-1372 Todo, LIN-1395 Backlog, LIN-1408 Todo. LIN-4416 (Done) took none of them.
- E45 — **open** — partly done: a question must give the result of each answer and its `if-unanswered` (`main:lib/prompts/handoff-words.js:30`). But the cut rule still covers every clause of the task's `asked`, whoever wrote it, and ends the run `BLOCKED:` (`main:lib/prompts/stage-kinds.js:27`). The ask was never filed, and 0-ledger #47–48 (build on while a ruling waits; engineering questions raised as rulings) are also open. *If left alone, any narrowing, even of text an agent wrote, stops the run and waits for John.*
- E46 — **gone** — look-first no longer reads a size record: the sequence comes from the runs alone (`main:lib/recommendation-look-first.js:104`), and the size section was retired by LIN-4542.
- E47 — **gone** — there is no suggest route in `main:routes`, `lib` or the proxy docs. The rulings routes went with slice 4 (`/api/proxy/rulings` 404, log.md:5281).
- E48 — **done** — John answered cut (log.md:3905). LIN-4470 Done.
- E49 — **done** — John answered accept (log.md:3905). LIN-4447 Done (log.md:3927).
- E50 — **tracked** — the Waiting half was done by LIN-4495, which retired the Waiting lists. Retiring the notes into lesson records is LIN-4578, Todo.
- E51 — **done** — applied to both lanes: accept on `lin4447-area-read-inconclusive` and cut on `lin4470-five-files-lesson` (log.md:3905). Both lanes closed Done without the gate or the sample. The general "narrow agent-written text" part is E45.

## Counts

- done: 27
- tracked: 41
- gone: 23
- open: 17
- can't tell: 3

Total 111 (D1–D60, E1–E51).
