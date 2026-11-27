# Sweep pass 2, check 1: sections A, B and C (27 Nov)

Checked against Harbour main `5c33e4415` (25 Nov), simple-dispatcher main `d692ac7` (25 Nov), the ticket JSONs fetched on 27 Nov, the 377 open project findings (`sweep/c2-proj-open.json`), and proxy fetches and searches made for this check (`sweep/c1/px/`). "main:" = Harbour, "SD:" = simple-dispatcher.

## A

- A1 — **tracked** — LIN-3449 Todo; the six 23 Oct follow-ups (LIN-3822, 3835, 3836, 3736, 3624, 1496) are its children, all still Backlog (LIN-3449 children list).
- A2 — **tracked** — the three follow-ups are LIN-4156, LIN-4157 and LIN-4158, all Backlog children of LIN-3449 (LIN-3449 comment 3 Nov 07:39).
- A3 — **open** — no ticket found (search "autopilot prerequisite": nothing on starting an autopilot before its blocker lands). Left alone, autopilots can still start before their prerequisite lands, wait for hours, and get killed by the stall failsafe, which wastes a run and looks like a failure.
- A4 — **done** — LIN-4159 Canceled 24 Nov, folded into LIN-4546 (Done); main: both pill tables now take their words from `STATE_WORDS` (`lib/render-task-page.js:103-125`, LIN-4552).
- A5 — **open** — `plainRunState` ("finished", "was cancelled") still sits beside `STAGE_STATE_WORD` ("done", "cancelled") (main: `lib/task-page-loader.js:566`, `lib/run-view.js:126`); no ticket or finding (search "plainRunState": none open). Left alone, the task page's "Last run" line and the stage list can describe the same run in different words, and the two can drift further apart.
- A6 — **tracked** — LIN-4160 Backlog, "prompt-section re-fires an identical run preview GET on every incomplete state re-read". Still true on main: `acceptStateRead` calls `refreshRunPreview()` on every read (`public/prompt-section.js:2824`).
- A7 — **open** — main still checks only that `subscription:'none'` has a `followUpTo` (`lib/dispatch-entrance.js:134-137`). Nothing checks that the target row is terminal, and no ticket covers it. Left alone, a quiet question sent to a worker its autopilot is parked on can silence that worker's real ending, so the autopilot never wakes.
- A8 — **tracked** — LIN-4174 Backlog.
- A9 — **open** — the detail read `formatDispatchWatch` still has no `subscription` field (main: `routes/proxy-dispatch.js:52-100`). No ticket (search "subscription read view"). Left alone, someone checking whether a follow-up went quiet can't see it from the dispatch read and has to infer it from whether a wake followed.
- A10 — **gone** — the relay was rebuilt. Text posts now go through a keyed outbox that keeps a post queued and retries it on 429 (SD: `assistant-text-outbox.js:28-31,364`, LIN-4557), and terminal feedback retries on 429 too (SD: `feedback.js:49-55`).
- A11 — **done** — LIN-4167 Canceled 3 Nov 19:57, with John's ruling quoted in the closing comment.
- A12 — **done** — the live re-clone check ran on 4 Nov 17:40: the session resumed after 1,457 min in a fresh clone at the same path, at that day's `main` (log.md:1398-1405).
- A13 — **tracked** — LIN-4175 Backlog, with its premise rewritten by LIN-4171's close-out.
- A14 — **open** — SD CI is still Linux-only (SD: `.github/workflows/ci.yml:28` `ubuntu-latest`), so the `cp -c` witnesses (`test/lin4171-*`, `test/clone-strategy.test.js`) still skip there. No ticket (search "macOS CI" finds only neighbours: LIN-4081, LIN-1710). Left alone, a green SD CI still says nothing about the macOS-only failure paths, and only a hand run on the host proves them.
- A15 — **done** — main's stage templates now make a post-deploy check close-out's own step: "After the deploy … a post-deploy step close-out does after the merge, never as a condition on the merge" (`lib/prompt-template-defs.js:745,788`; `lib/prompts/stage-kinds.js:444`).
- A16 — **gone** — overtaken by LIN-4202 (OpenCode posts per-request records) and LIN-4203 (snapshots removed). The flag now gates OpenCode's record posting (SD: `opencode-runner.js:590`).
- A17 — **open** — the suite now prints which Harbour it found (`Harbour: <dir> @ <sha>`), but says itself this is "informational only, not a version check" (SD: `test/system/harness/harbour-summary.js:1-6`). No ticket (search "system suite Harbour version"). Left alone, a system run against the wrong Harbour commit still passes or fails silently for the wrong reason, and nobody can tell whether it ran against the right version.
- A18 — **open** — the pure resolver is already separate from the fs probe (SD: `test/system/harness/harbour-locate.js:4-6`), but `REASON` is exported and used nowhere else (`:118`), and `test/system/README.md` has no sentence on relative paths. Trivial: left alone, the result is one dead export and a missing doc line.
- A19 — **tracked** — LIN-4184 Backlog asks for exactly this ruling (which member dates a lineage's day on S12).
- A20 — **done** — LIN-4186 Done, LIN-4185 Duplicate.
- A21 — **done** — LIN-4224 added `npm run test:baseline` (SD: `test/system/harness/baseline.js`), and LIN-4222 gave the suite OS-assigned ports (SD: `test/system/harbour-ports.test.js:1-11`).
- A22 — **open** — no record that the production tally, the cold `/kpis` timing or the signed-in browser check ever ran (LIN-4176 comments say "NOT RUN"; nothing later in the log); no ticket. Left alone, rebuild 1's figures stay unchecked against production. Rebuild 2's records-sum cutover has since made these checks less pressing.
- A23 — **tracked** — LIN-4191, 4192, 4193 and 4194 are all Backlog.
- A24 — **gone** — overtaken: builders' leftovers are now findings records, not filed tickets (LIN-4495 Done; main `docs/proxy-integration.md:2069`), so the bar line no longer has a question to answer.
- A25 — **done** — the browser now imports the one module: `lib/cost-format.js` is served at `/lib/cost-format.js` (LIN-4446, LIN-4471; `lib/cost-format.js:12`; imports in `public/prompt-section.js:16`, `public/workspace-kpis.js:15`, `public/flight-companion.js:47`).
- A26 — **open** — `hook.js` still has `async function main()` with no parameters, reading stdin itself (SD: `hook.js:1299`); no ticket (LIN-4190 only moves tests onto `driveStopHook`). Left alone, every new Stop-hook test still needs the heavy driver instead of a ten-line call.
- A27 — **done** — LIN-4196 Done, merged as SD `502901c`, after LIN-4186 (`harbour-halt`) was Done.
- A28 — **gone** — production now posts at a kill and at a reap: `flushRequestUsageDetached` at cancel (SD: `dispatcher.js:616,1175`) and in the reapers (`reapers.js:1978,4073`), per LIN-4199 and LIN-4203. So the premise "nothing posts at a kill or reap" no longer holds.
- A29 — **open** — still 10 inline terminal-phase writes (`dispatcher.js:434,471`; `opencode-runner.js:1516,1695,1793`; `reapers.js:862,2631,2871,3330,3344`), and no `transitionToTerminal` in `phases.js`. No ticket (search "terminal phase transition"). Left alone, a new terminal path can skip the request-records flush, or another side effect, without anything failing.
- A30 — **open** — LIN-4195's 4 Nov 05:35 summary lists these checks as "Also yours" for John (LIN-4198 `getIndexes()`, LIN-4199 doc count and abort check, LIN-4202's three live checks). No later record shows them run, and no ticket. Left alone, the production unique index, the abort flush and the OpenCode and runner-kit posts are proven only by CI, never on production.
- A31 — **tracked** — LIN-4341 Backlog (Settings › Costs) includes "the same figures for agents through the proxy". No `/api/proxy/costs` route exists on main yet (`docs/plans/costs.md:95-97` still plans it).
- A32 — **done** — LIN-4200, 4201, 4203 and 4195 are all Done (LIN-4195 close-out 4 Nov 19:47).
- A33 — **done** — ruling `lin4195-mixed-model-label` answered "keep cost-dominant" (LIN-4195 comment 4 Nov 20:52).
- A34 — **gone** — John's 4 Nov 16:00 correction: "not a fault, and not a design either"; hosting simply isn't integrated yet (log.md:1369). The remaining question is B14.

## B

- B1 — **done** — LIN-4195 comment 4 Nov 17:07: "Decided, no ruling needed: `no-usage` for a subagent with no readable transcript"; LIN-4203 Done.
- B2 — **tracked** — the owner tickets are LIN-3546 (prompt-section `init`), LIN-3544 (`runStallFailsafe`) and LIN-2398 (`dispatch-store`/`addFeedback`), all Backlog (proxy reads, 27 Nov).
- B3 — **gone** — LIN-4210 Canceled 20 Nov on John's word: every halt read fails open by design, and `tests/unit/dispatch-route-poll-halt.test.js:171` pins the cold-cache case.
- B4 — **tracked** — the Drift follow-ups are children of LIN-3449 (Todo) and mostly Backlog (see A1).
- B5 — **tracked** — open project findings finding-32ea19b7 (fold `/test/clear-*` into the key-state registry) and finding-ffc67059 (per-key state reset), both "Survey tally: LIN-4168". Drift still carries it as row 120, informational (`docs/reviews/drift-coherence-review-2026-11-14.md:811`).
- B6 — **can't tell** — D14 (the issue-attribution rule) appears on main only in log.md:1171. It is named in LIN-4195 and LIN-4203 as "not this task's". No open finding mentions it, and the open Costs children (LIN-4184, 4191-4194, 4341) don't name it. I couldn't confirm what the rule is today.
- B7 — **done** — LIN-4221 (after the residue was named) made COULDNT_RUN its own outcome, never a kill (SD: `test/system/mutation/run-mutations.js:802-806`). Only failures reported through that exit are excluded.
- B8 — **done** — LIN-4370's look-first code route sends a fresh unsized ticket its `survey-task`/`survey-place` steps where it is started (main: `lib/code-routes.js:81-87`, `lib/recommendation-look-first.js`).
- B9 — **open** — SD settings are still read once at require time (SD: `config.js:12-40`); this isn't among the tally rows imported as findings on 20 Nov, and there is no ticket. Left alone, settings stay scattered across `config.js` and can't be re-read without a restart, so each new flag repeats the pattern.
- B10 — **done** — the allowlist now gives each frozen group kill its reason: both unit tests exercise production group-kill behaviour (SD: `test/harness-kill-census.test.js:36-46`).
- B11 — **open** — under the records model a person's `decision` still "resumes the run that asked" (main `docs/proxy-integration.md:1514-1517`), so an answer that names a person as the doer still goes to the agent. No ticket. Left alone, when John answers "I'll run it", the agent is woken with an instruction it can't carry out, and the task stalls until someone notices.
- B12 — **tracked** — the read-only proxy route is in LIN-4341 Backlog (see A31). Whether a read-only Mongo user exists can't be checked from here.
- B13 — **tracked** — LIN-4205 Todo, "Rotate the production Mongo root password". On 27 Nov John accepted it as low priority ("the service isn't public, and Railway gives no simple rotation", log.md:5457), so the ticket is stale against that decision.
- B14 — **open** — John parked it "for later" (log.md:1369). No ticket found (search "Railway": only ops tickets such as LIN-4213 and LIN-3769). finding-7d107ec8 covers the narrower point that deploy ownership isn't in code. Left alone, agents keep discovering Railway by chance, as LIN-4200 did, and may ask John for access they already have.
- B15 — **open** — the witness happened (log.md:1398-1405), but LIN-4164's last comment is 3 Nov 20:53, so it was never recorded on the ticket. Left alone, the only record of LIN-4164's runtime witness is deleted with the log, and the ticket still reads "NOT RUN".
- B16 — **done** — `lib/usage-snapshot-intake.js` is now named in the runs-and-dispatch pattern (main `docs/areas/areas.json`).
- B17 — **tracked** — LIN-4214 Backlog. Its 4 Nov comment says the behaviour is met by LIN-4203's gate, so it is probably closeable.
- B18 — **open** — `lib/workspace-kpis-cache.js` is still a third keyed stale-while-revalidate cache beside `lib/sessions-feed-cache.js` and `lib/kpi-page.js`. Drift carries it as row 26 `cache-module-family` (low, unchanged at 2026-11-14), with no ticket or finding. Left alone, the fresh / serve-stale / refresh rule stays written three times and can diverge in one copy.
- B19 — **open** — Drift row 122 `usage-snapshot-prose-residue` reads 24 snapshot-wording sites, unchanged at 2026-11-14 (`docs/reviews/drift-coherence-review-2026-11-14.md:813`); no ticket. Left alone, docs and comments keep describing a `[usage]` snapshot that nothing posts, which misleads anyone reading them.
- B20 — **done** — checked live after piece 6: `/kpis` `unknownHarnessShare` 0.042, the same as before, "the drift that note 1 predicted has not happened" (LIN-4195 review, 4 Nov 19:43).
- B21 — **tracked** — the collection fakes are finding-5b1b7200, and the hand-pinned counts are part of finding-a8db8012. Not covered: the copied `bulkWriteWithRetry` (still in `lib/kpi-daily-rollup.js:171` and `lib/request-usage-store.js:102`; search "bulkWriteWithRetry": nothing open) and the test-only exports.
- B22 — **open** — the census still string-matches `'request-usage'` behind a 17-entry allow-list that keeps growing (main `tests/unit/lin-4198-request-usage-store.test.js:301-327`); no ticket. Left alone, every ticket that only needs to name the collection must argue its way onto the allow-list, and the guard looks stronger than it is.
- B23 — **open** — nothing shows the `erase-account.mjs` and `dry-run-urlkey-duplicates.mjs` dry runs on the real database (LIN-4234 comments end 4 Nov 23:16); no ticket. Left alone, nobody has confirmed that a real Full wipe removes `usage-snapshot-intake` rows.
- B24 — **open** — there are still two scans: `parseParkedWait` (main `lib/session-telemetry.js:404`) and `findWakeEvent` (`lib/dispatch-terminal.js:715`), though both now read the kinds table. finding-3c35d5a4 tracks a neighbouring pair (`findWakeEvent` vs `lastWakeEntry`), not this one. Left alone, park and wake reading can drift apart again when a new feedback kind is added.
- B25 — **tracked** — the collection half is finding-a8db8012 ("each collection should be declared once … opening an undeclared name should fail"). The feedback-kind half is done: one `FEEDBACK_KINDS` table with roles (LIN-4455 Done; main `lib/dispatch-feedback-kinds.js:1-30`).
- B26 — **can't tell** — the log never says the host caught up with `main` after 5 Nov (log.md:1861 is the last mention). The runner has been restarted many times since, and the host's state isn't visible from here.
- B27 — **open** — the 4 Nov 21:01 stop was never investigated, and no ticket records it. LIN-3118 (Todo) is the RCA of a similar stop on 26 Sep and doesn't mention this one. Left alone, a dispatcher that stops polling stays silent until someone sees "No consumer has polled", because by design nothing restarts it.
- B28 — **open** — still the design: a closed ticket's open questions end `withdrawn`, reason "ticket closed", and nothing picks them up (LIN-4538; main `lib/records/question-facts.js:110`, `lib/ticket-close-closer.js:6`). No ticket (search "question withdrawn ticket closed"). Left alone, an open scope question disappears when its ticket closes, and its work can lose its owner without anyone being told.
- B29 — **done** — LIN-4246 Done 5 Nov (PR #2293), with call-site witnesses on the shared vm layer.
- B30 — **open** — `lib/waiting-section.js` matches only the `other-features` catch-all (`^lib/`) in main `docs/areas/areas.json`; no finding names its placement. Left alone, the map keeps understating the Pages ↔ Other edges, and the next renderer will land in the same place.
- B31 — **tracked** — finding-1f9458ae (split `home-view.js`; eligibility vs ranking), finding-ae92ec36 (one "what's next" ranking) and finding-51394a09 (server fragments instead of `DOMParser`). The LIN-4143 shim and run-block rows weren't checked one by one.
- B32 — **tracked** — LIN-4026 Backlog.
- B33 — **tracked** — finding-51394a09 covers Home's `DOMParser` page read (still at main `public/app.js:724-733`).
- B34 — **tracked** — the second ranker is finding-ae92ec36 (`compareRank` beside `orderIssuesForSwipe`). LIN-4241's two-way route is gone: `answerAttemptId` no longer appears in lib/, routes/ or public/, and the ruling machinery was retired (LIN-4541).
- B35 — **gone** — LIN-4541 removed the card's `record` effect: "a reply is a comment and a resume … the old record and fresh-run effects went with the ruling machinery" (main `public/question-cards.js:164-165`).
- B36 — **done** — pulled as LIN-4252 (one shared fake DOM, `tests/unit/helpers/fake-dom.js`) and LIN-4255 (Done). The collection-fake half is finding-5b1b7200.
- B37 — **can't tell** — the map homes went back in: `survey-place` asks what the change would "leave without a home" (main `lib/prompt-template-defs.js:958`). The "table of cases" question is not in `survey-task` (`:927-944`), and I found no record of it being tried.
- B38 — **open** — parked by John until the write-up. The Surface Assessment is still in the research template (main `lib/prompt-template-defs.js:402-422`), beside the two Survey stages, and no ticket covers it. Left alone, a ticket's research step and its Surveys keep asking overlapping questions, at a cost.
- B39 — **done** — LIN-4253 declared each stage's traits once on its template, and LIN-4467 made one record per stage kind. The override list is now derived (`lib/proxy-instructions.js:13`).
- B40 — **can't tell** — the settled check now has one route (`lib/ruling-settled.js`, used by `lib/question-answers.js`). I didn't trace LIN-4048's "finished but held" copies or LIN-4242's card-merge copy of `observation.js`.
- B41 — **done** — tidy-first became practice: LIN-4253 "(tidy first, before LIN-4251)" and LIN-4252 before LIN-4246 (log.md:1971). The blind read is a stage, and the Surveys run as look-first steps.
- B42 — **open** — the `survey-place` template still names no repository (main `lib/prompt-template-defs.js:946-968`), and the preamble adds none; no ticket (search "survey place repository"). Left alone, a cross-repo ticket's place Survey can start in the wrong checkout and spend its budget finding the right one.
- B43 — **done** — LIN-4250 Done 5 Nov (PR #2288).
- B44 — **done** — the next choice was made: LIN-4252 → LIN-4246 (log.md:1971), and the C items show work resumed.

## C

- C1 — **open** — workflow formatters are still chosen by hand per template (`formatWorkflow` / `formatReadOnlyWorkflow` / `formatInformOnlyWorkflow`, main `lib/prompt-formatters.js:222,269,285`), not derived from `writes`; no finding or ticket. Left alone, a stage whose `writes` changes can keep its old workflow text, so it is told one thing and allowed another.
- C2 — **open** — a parked tally row, not among the tally findings imported on 20 Nov; no ticket. `/cost` labels stay cost-dominant per `lin4195-mixed-model-label`. Left alone, `/cost` lineage rows show no founder model, which makes it harder to see what model a chain started on.
- C3 — **done** — LIN-4275 Done 12 Nov (paper v2, PR #2403).
- C4 — **gone** — the scheduled start happened: LIN-4275 ran and is Done 12 Nov.
- C5 — **open** — `byDispatchOrder` now has one owner (main `lib/lineage-membership.js:60`), but the marker sort at `lib/dispatch-lineage.js:162` and the `at` sort at `lib/recent-runs.js:64` still don't use it; no ticket. Left alone, lineage markers and recent runs can order the same rows differently.
- C6 — **open** — the idea is written in the notebook ("Future controls: the same tasks on a tidy codebase and on a copy with planted duplication", `docs/plans/survey/notes-2026-11-05.md:186`) but not filed. Left alone, nobody runs the controlled test of whether duplication costs reliability more than money.
- C7 — **open** — byte-identity pins on hand-wrapped prose remain (e.g. main `tests/unit/proxy-preamble.test.js:80-91`); no rule or ticket. Left alone, every prompt-wording tidy fights a byte-frozen fixture and is tempted to copy rather than share text.
- C8 — **open** — `tests/fixtures/cost-replay/goldens.json` was last regenerated on 4 Nov (LIN-4178; one string edit 12 Nov), and its readers still compare whole objects; no ticket. Left alone, the next `/cost` change will again show thousands of spurious diffs, and its builder may chase figures that aren't theirs.
- C9 — **tracked** — LIN-4273 Backlog, "Models page, routing typicals and effort readout still read a follow-up's spend as the build's kind and model".
- C10 — **open** — `docs/prompt-pipeline/stage-descriptions/plumbing.md` still cites line numbers that have moved: `prompt-templates.js:248` is now :258, `:82` is now :80, `openrouter.js:1799` is now :2141 (lines 21-23); no ticket. Left alone, readers following these citations land on the wrong code.
- C11 — **open** — `updateClause` still returns an always-`'.'` `otherwise` (main `lib/proxy-preamble.js:265-266`). I didn't recount the endpoint-variant copies. No ticket. Left alone, a little dead structure and duplicated hint text stay in the preamble.
- C12 — **can't tell** — the blind read now judges the landing, open changes included, and writes findings records (main `docs/proxy-integration.md:2071,2683-2686`). Nothing shows its edges going back into the warm builder's session, which was the parked idea.
- C13 — **tracked** — LIN-4287 Backlog, "Standard `__autopilot__` entry is unreachable from the UI". Still true: only the stepper button is drawn (main `public/prompt-section.js:490`).
- C14 — **tracked** — LIN-3546 Backlog; its 5 Nov note names the Go/run lifecycle and question-slot keeping as the pieces still to move (file now 2,957 lines).
- C15 — **open** — LIN-4301 (Backlog) covers only stale status claims; nothing in the prompts or conventions addresses ticket-history comments (no match in `lib/prompt-template-defs.js`, `lib/prompts`, CLAUDE.md). Left alone, code comments keep filling with LIN-numbers and round history, and that prose drifts faster than the code shrinks.
- C16 — **tracked** — LIN-4297 Backlog (description and 5 Nov comments carry the residues: acorn walker, `LiveConsoleLane`, `replaceChildren`, `PROXY_PROMPT_BOX`, row 133).
- C17 — **tracked** — LIN-4301 Backlog.
- C18 — **tracked** — finding-efeab354 ("No registry pattern matches it, so it sits in this catch-all"); still true in main `docs/areas/areas.json`.
- C19 — **gone** — `focusInCard` is now a module import (main `public/prompt-section.js:19` from `./question-records.js`), so this read no longer goes through `window.QuestionCards`.
- C20 — **done** — main derives the list: `OVERRIDE_KINDS = Object.keys(STAGE_KINDS)` (`lib/proxy-instructions.js:13`, LIN-4467, 13 Nov). LIN-4302 is still Backlog and looks closeable.
- C21 — **tracked** — LIN-4256 Backlog. Still true: `liveNow` adds `status === 'waiting'` (main `public/prompt-section.js:714-716`).
- C22 — **tracked** — LIN-4102 Backlog, the same test ("the drawer sits at the right edge; Escape closes it…", `tests/e2e/lin-4010-home-opened-task.spec.js:177-189`).
- C23 — **open** — `clearRunItem(why)` still ignores `why` (main `public/prompt-section.js:2359-2361`). The residues aren't on LIN-3546 or LIN-4297. Left alone, readers keep seeing an argument that does nothing, plus a weaker render witness. Small.
- C24 — **open** — four `.focus`/`dispatchEvent` method-presence guards remain in public/, outside LIN-4304's census (`tests/unit/public-element-method-guards.test.js`), and no check catches a stale allow-list reason; no ticket. Left alone, the guard idiom stays half-retired, and stale reasons in allow-lists go unnoticed.
- C25 — **open** — `public/ship.js:1154` still calls `sel.remove(1)`, which the shared fake refuses (`tests/unit/helpers/fake-dom.js:206-209`); it isn't in LIN-4297 or any finding. Left alone, the first unit suite to drive that `ship.js` path will stop on the fake, with no ticket naming why.
- C26 — **tracked** — integration has gone ahead as the layer slices (LIN-4495, LIN-4529 Done; LIN-4578 "Slice 5: lessons as records" Todo). I didn't see where the notebook and operator state should live settled.
- C27 — **open** — the anchor resolver still denylists the whole `docs/plans/survey` directory (main `tests/unit/docs-architecture-anchor-resolver.test.js:94`); no ticket. Left alone, citations in the notebook's `notes-*.md` and prompt docs can go stale unchecked.
- C28 — **open** — there is still no derived list of enqueue mounts. LIN-4320 covers only the stale CLAUDE.md line. Left alone, each new enqueue entrance costs about ten hand edits, and the prose counts keep going stale.
- C29 — **tracked** — LIN-4320 Backlog.
- C30 — **tracked** — LIN-4318 Backlog.
- C31 — **open** — a parked lesson with no ticket or rule. Several open findings show the same shape, a frozen literal census (e.g. finding-7204f99b). Left alone, censuses that count spelling keep blocking folds that would read better, and keep passing when behaviour changes.
- C32 — **done** — run as the LIN-4447 and LIN-4448 tidy lanes, read blind before and after beside an untouched control area (log.md:3628-3647); both Done.
- C33 — **tracked** — LIN-4325, 4326, 4327 and 4328 are all Backlog.
- C34 — **tracked** — acted on as LIN-4344's children (log.md:2763-2770); LIN-4348 "Choose the contractor by the kind of work" is Backlog. The implementation override to Haiku was cleared to Opus on 6 Nov (log.md:2800).

## Counts

| verdict | A | B | C | total |
|---|---|---|---|---|
| done | 10 | 12 | 3 | 25 |
| tracked | 8 | 12 | 13 | 33 |
| gone | 5 | 2 | 2 | 9 |
| open | 11 | 14 | 15 | 40 |
| can't tell | 0 | 4 | 1 | 5 |
| **all** | 34 | 44 | 34 | 112 |

Tickets whose state looks behind the facts: LIN-4302 (fixed by LIN-4467), LIN-4214 (behaviour met by LIN-4203), and LIN-4205 (rotation accepted as low priority on 27 Nov).
