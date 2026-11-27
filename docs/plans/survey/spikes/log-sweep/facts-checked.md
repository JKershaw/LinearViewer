# Fact check: log-sweep `[fact]` items against current main

Checked 27 Nov 2026. Harbour = LinearViewer `origin/main` 5c33e4415 (H:). simple-dispatcher = `origin/main` d692ac7 (SD:). Both were detached checkouts in the scratchpad worktrees. Paths are relative to each repo root. "Docs" says whether the repo's own docs already hold the fact.

## A

- **A1** Quiet follow-up (`subscription:'none'`). **partly**. These hold: `none` with `followUpTo` mints no wake (H:lib/dispatch-store.js:3699-3707), and without `followUpTo` it is refused (H:lib/dispatch-entrance.js:130-138). The gotcha is still documented and not guarded: "Never use it on a follow-up to your own workers" (H:lib/proxy-instructions.js:782), and no guard turned up in entrance or store. This has changed: the read view can't show `subscription: null` any more, because every hop normalises `src.subscription || 'terminal-only'` (H:lib/dispatch-fields.js:162). The "Missing" note is out of date too. Docs: H:docs/proxy-integration.md:164-170 now lists `"none"` and its `followUpTo` rule.
- **A2** Resume after LIN-4164. **true**. The record window is 7 d and the clone window 24 h, as two separate passes (SD:config.js:590-608, SD:reapers.js:3444-3458). `dispatchedPrompt` is deleted at clone reap (SD:reapers.js:3568). A resume re-clones a missing folder at the recorded path (SD:executors.js:521-535, LIN-4171). FAILED is set when the driver's `launchCli` returns `success:false` (SD:dispatcher.js:458-476). The `~/.claude/projects` and `claude --resume` behaviour is the CLI's own and can't be checked here. Docs: the reap split is only in code comments.
- **A3** Harbour feedback limits. **true**. 100/min per IP on the feedback route (H:routes/dispatch.js:99-109). Only a terminal post is retried, and only when the caller opts in (SD:feedback.js:19-21, 144). The message cap is 2,000 characters (H:lib/dispatch-feedback-validation.js:24, 85-87). An unknown `kind` is silently dropped (same file, lines 70-75). New since then: retired decision kinds get a 422 instead of being dropped (lines 66-68, LIN-4541). The Harbour OS feedback token is single-use through `validateAndConsume` (H:lib/harbour-feedback-tokens.js:85-107). Usage batches deliberately use the multi-use dispatch token (H:routes/dispatch.js:1758-1772). Docs: H:docs/architecture/dispatch-and-proxy.md is cited for the usage route; no doc gathers the limits in one place.
- **A4** SD gotchas. **partly**. Holds: `config.js` runs `loadEnv()` when it is imported (SD:config.js:15-16). Docs record this at SD:docs/module-map.md:426-430. Changed: the four watch-restart fixtures now copy `instance-guard.js` *and* `env-flag.js` (SD:test/watch-restart.test.js:33-34, watch-restart-stop:38-39, -process:48-49, -signal:27-28). The hazard is the same (a new require breaks them). Not done: there is no `transitionToTerminal`. Terminal phases are still written inline, now about 10 times: SD:dispatcher.js:434, 471; reapers.js:862, 2631, 2871, 3330, 3344; opencode-runner.js:1516, 1695, 1793. Only the sets live in SD:phases.js:84.
- **A5** A follow-up's completion queues a wake unless it is quiet. **true**. Terminals always bubble, and there is deliberately no `followUpTo` guard (H:lib/dispatch-wake.js:166-207). The prompt says "A child session reached a terminal outcome — resume your cross-check." (H:lib/dispatch-wake.js:95). The quiet gate runs before edge resolution (H:lib/dispatch-store.js:3705). Docs: H:docs/proxy-integration.md:164-170 (subscription).

## B

- **B1** `place-change.mjs`. **true**. It exists with that usage and wraps `scripts/code-shape/seams.mjs`. It reports cross-area imports, new files with no home, and knot pairs and groups (H:experiments/place-change/place-change.mjs:1-30). The rule "take the guide from the compared commits" is written nowhere. The tool reads one guide file from disk for both commits (line 16). Its only caller points at a guide that no longer exists, `scripts/code-shape/areas.json` (H:docs/papers/harbour/task-size-and-cost-scripts/size-place-change.mjs:16); the guide is now `docs/areas/areas.json`. Docs: only an evidence README mentions it (H:docs/papers/harbour/task-size-and-cost-evidence/2026-11-05/README.md:12).
- **B2** Reply after the 24 h clone window resumes in a fresh clone at today's main, at the same path. **true**. The clone pass runs at 24 h and the record stays to 7 d (SD:config.js:599-608). A resume re-runs fresh prep when the folder is gone (SD:executors.js:521-535). Fresh prep does `git fetch` plus `reset --hard origin/<default>` (SD:executors.js:213-215), so uncommitted work is gone. The live witness itself is history.
- **B3** `node --test` turns `exit(N)` into 1; SD harness pieces. **true**. The collapse is recorded in SD:test/system/harness/exit-codes.js:10-13, which uses a preload `exitCode`, and "couldn't run" is now 75, not 78. These exist: `test:baseline` (SD:package.json:13), `ports.js` (SD:test/system/harness/ports.js:1-20), the exit table (exit-codes.js) and `stop-group.js`. Docs: SD:docs/testing-and-ci.md:23, 64, 69, 109, 117, 150.
- **B4** Adding a stage kind (LIN-4248). **changed**.
  - The per-kind tables are now one record, `STAGE_KINDS`, and the others are views of it, checked by a test (H:lib/prompts/stage-kinds.js:1-15).
  - `GROUNDING_BY_KIND` is derived from it, and the Surveys get `none` (H:lib/prompt-formatters.js:603-612). An unknown kind still falls back to every note (line 632).
  - "Never offered" has one source: `route: null`, with `EXCLUDED_FROM_AI_RECOMMENDATION` derived from it (H:lib/prompt-templates.js:424-430).
  - Reading stages carry a READING intent, not DECIDE (H:lib/prompts/stage-kinds.js:29-35, 538).
  - Surveys are now sent by the look-first code route (H:lib/code-routes.js:82) or by the kind override (H:lib/proxy-instructions.js:804).
  - Still true: "survey" is a crowded name: 170 files under `scripts/`, 222 outside `docs/plans/survey`.
  - Can't tell: "server doesn't know main's head".
- **B5** Step-back and after-questions q1–q7 never moved into Harbour. **partly**. q6 ("what did your change leave behind") is now product code: the `leftover` step (H:lib/dispatch-leftover.js:1-19, 133-160, LIN-4373). No step-back question or other after-question turned up in lib/ or routes/.
- **B6** "No consumer has polled this workspace since …". **true**. The text is at H:lib/consumer-poll-warning.js:117. Docs: H:docs/proxy-integration.md:1781. The "check the follower came back after a host restart" advice is in no doc. SD:docs/deployment.md:5-44 covers only the no-relaunch ruling.
- **B7** Production DB access via the LIN-4200 path. **partly**. The tunnel form appears only in script headers (H:scripts/lin-4200-d13-volume-timing.mjs:27). The current route (`railway ssh`, one quoted command, never print env) is recorded in H:docs/operator-execution.md:20-45. A read-only Mongo user is not in the repo: the planned user is `readWrite@linear-viewer` (same file:41, docs/runbooks/mongodb-app-user.md). The leak isn't recorded. Whether the CLI is logged in can't be checked.

## C

- **C1** Research-branch handling. **true**. `claude/cool-rubin-6acj5j` (e3b2393e) is 1,131 commits ahead of its merge-base with main. It still carries 24 non-survey files of unmerged code (getting-started feature, `server.js`, `routes/library.js`, tests…). The path-limited sync procedure is in no doc. H:docs/plans/survey/integration/design.md:212 says only that the record lives on the branch.
- **C2** GitHub gotchas (conflicted PR starts no CI run; a "rejected" push may have landed). **not checkable in code** (GitHub behaviour).
- **C3** The docs anchor resolver excludes `docs/plans/survey` (LIN-4314). **true**. H:tests/unit/docs-architecture-anchor-resolver.test.js:92-94 (`DENYLIST_DIRS`). Docs: only that test's comment.

## D

- **D1** Railpack fetches mise unauthenticated. **not checkable in code** (Railway/Railpack).
- **D2** Linear canonicalises markdown and records agent writes under John. **not checkable in code** (Linear).
- **D3** Jira readiness. **partly**.
  - Changed: `createIssue` is now built (LIN-4451) (H:lib/providers/jira/index.js:12, 1178-1232).
  - Still true: each "Continue with Jira" makes its own `jira:<accountId>` workspace (H:routes/jira-auth.js:773).
  - Still true: no boards or sprints in the Jira provider (no match in lib/providers/jira/index.js).
  - Still true: `[ticket]` marker parsing is LIN-only (H:lib/session-telemetry.js:286, SD:transcript.js:445).
  - Not checkable: the ticket states (LIN-2094/2026/2170/2008).
- **D4** First outside test team, milestones, `model/gate.js`. **can't tell**. `model/gate.js` isn't in either repo or in their git histories. No doc names the Jira team or the two milestones. H:docs/v1.md:31-33 has an older "dress rehearsal, then invited testers" framing. The artifact URLs can't be checked.
- **D5** `seams.mjs` reads 0 of SD's CommonJS files. **true**. Its scope is only `server.js|lib|routes|public` (H:scripts/code-shape/seams.mjs:11-13), and it reads only `import`/`import()`, not `require` (lines 28-40). SD now has 54 non-test root `.js` files (it was 52). The literal-require reader wasn't looked for.
- **D6** Raw evidence in git: `docs/reviews/` was 77 MB of a 210 MB tree, with 41 `_evidence` dirs. **changed**. At 5c33e4415, `docs/reviews/` is 152.1 MB of a 308.7 MB tree (49%), with 56 `_evidence` dirs (`git ls-tree -r -l`). Periodical line counts weren't re-measured.
- **D7** John's allowance resets Thursday 07:00. **not checkable in code** (John's budget reset).

## E

- **E1** Jira live check: the account, runbook `f495ca4b`, and the three needs. **can't tell** (John's account). The runbook and the need for John's Jira credentials and a dispatch-grant token are recorded in H:docs/papers/harbour/lanes-across-the-seam-evidence/issues/LIN-4445.json:130 and LIN-4452.json:102, 118.
- **E2** Rulings that closed unanswered; four small product calls shipped. **partly**. These are seen standing: the `/kpis` small-count floor (H:lib/kpi-stats.js:1196, LIN-3703); "No job" settable by any member (H:lib/components/dispatch-no-job.js:10-12); Observation's default filter is Autopilot (H:lib/render-observation.js:44-49). Not confirmed: "searchable" recent rows on Home (LIN-4113 is in lib/home-view.js:18-30, but no search found). Not checkable: the ruling history.
- **E3** A kickoff goal didn't reach child autopilots. **can't tell**. A kickoff takes `goal` only from its own body, and nothing inherits a parent's goal through `sessionId` (H:lib/dispatch-entrance.js:1902-1907). Model precedence is explicit > preset > anchor preset > workspace default (H:lib/dispatch-factory.js:499-530). Whether parents now pass it is agent behaviour.
- **E4** The proxy can't create Linear projects or labels. **true**. Only `GET /api/proxy/projects` and `GET /api/proxy/labels` exist (H:routes/proxy-reads.js:182, 269), plus adding or removing an existing label (H:routes/proxy-writes.js:861, 872). No create route.
- **E5** Node support (LIN-4419). **true**. `engines` is `>=24`, and `devEngines.runtime` is 24 with `onFail: ignore` (H:package.json:5-14). `.nvmrc` is `24`. `node-lts-scheduled.yml` runs weekly (`0 7 * * 1`) on `lts/*`, greps for `EBADENGINE|EBADDEVENGINES`, and runs `test:hermetic` (H:.github/workflows/node-lts-scheduled.yml:6, 16, 33, 44, 55). Not checkable: Railpack's precedence and the `harbour-os` Node 22 service. Docs: not in docs/architecture; only reviews (H:docs/reviews/stability-review-2026-11-13.md).

## F

- **F1** Ticket coding (κ 0.88, 0.65 new items per landing, etc.). **can't tell**. These are measurements from scratchpad scripts (`gen/`) that aren't in either repo.
- **F2** Cost findings (2.9×, 23%, $1,785 for 56 landings). **can't tell**. The figures aren't in code. The stale line is confirmed: "$2,800 bought about 88 landings, at $32" is at `docs/plans/survey/course-2026-11-14.md:8`, on the research branch only (not on main).
- **F3** `docs/v1.md`. **true** for the parts the repo holds. The title is "one person, one task, one proven merge" (H:docs/v1.md:1). It is done at the fresh-account dress rehearsal (lines 31, 130). It was accepted 19 Sep (line 141). Step 1 is log in with email (line 43). Can't tell: that the rehearsal never ran, or the 10 Oct run; no doc records either.
- **F4** Gaps on the new-user path. **partly**.
  - Still true: README says "cross-device restore is follow-up work" (H:README.md:116).
  - Still true: the GitHub App flow ends by writing a GitHub tracker binding (H:routes/github-auth.js:1-14).
  - Changed: LIN-shaped regexes are now in three Harbour files (H:lib/liveness-detectors.js:122, lib/dispatch-wake.js:448, lib/session-telemetry.js:286). SD's moved to SD:transcript.js:445 (it was :333).
  - Can't tell: Phases B/D/E are named in H:lib/account-workspace-store.js:3-21, but whether they're finished isn't stated.
  - Can't tell: an end-to-end walk, the private-repo PR check, and Linear being the only proven path.
- **F5** Provider-sync facts. **partly**.
  - Still true: nothing in lib/ or routes/ mentions webhooks.
  - Still true: GitHub Issues has no subtasks, estimates or relations, and state is open/closed only (H:lib/providers/github/index.js:7-10, 53).
  - Still true: the code-host side still imports the GitHub provider dir (H:lib/github-pr-status.js:24, lib/github-install-flow.js:28, lib/connection-credential.js:52, all from `providers/github/app-auth.js`).
  - Changed: the trackers are now Jira 3,866, GitHub 2,138 and Projects 923 lines (6,927 total).
  - Changed: 107 of 153 e2e specs use the Local harness (it was 98/142).
  - Changed: there are 49 distinct literal `.collection('…')` names (it was "about 35"; the method may differ).
  - Not verified: the Local provider's "full surface".
- **F6** System Map snapshot at `6f6c5d2e2`. **partly**. 13 areas confirmed at that commit (`docs/areas/areas.json`). Counting `server.js|lib|routes|public` JS there gives 577 files and 210,586 lines; the log says 585 and 212,226, so the method differs. Current main has 14 areas, 618 files and 204,849 lines. The system-map scripts exist only on the research branch (`docs/plans/survey/working-2026-11-15/system-map/`). The artifact URLs and link counts can't be checked.
- **F7** Paper index conflicts. **true**. Both index files exist (`docs/papers/README.md`, `tests/fixtures/library-doc-summaries.json`). The count pins are in H:tests/unit/library.test.js:48, 71, 146-150 (e.g. "nineteen essays…"). Docs: not recorded.
- **F8** Sub-agent readings cost 131k–254k tokens. **can't tell** (session telemetry, not code).

## G

- **G1** Filed ticket numbers. Skipped: under "State as of 27 Nov".
- **G2** Admin done 27 Nov. Skipped: under "State as of 27 Nov".
- **G3** Tokens. Skipped: under "State as of 27 Nov".
- **G4** Freeze diagnosis. Skipped: under "The laptop freezes and the runner host".
- **G5** Laptop changes. Skipped: under "The laptop freezes and the runner host".
- **G6** Mac accounts. Skipped: under "The laptop freezes and the runner host".
- **G7** Mongo not rotated. Skipped: under "Key rotation outcome".
- **G8** The halt has two modes, plus cascade-abort behaviour. **partly**. Still true:
  - The modes are `['pause','stop']` (H:lib/workspace-halt.js:34).
  - Pause holds only fresh launches, and follow-up resumes are held only under `stop` (SD:dispatcher.js:1879-1900).
  - Stop gates wake minting (H:lib/dispatch-store.js:645-661).
  - A cascade emits one abort per discovered session (H:lib/proxy-instructions.js:775).

  Can't tell: that a queued implementation outlives the cascade, and that a fresh kickoff skips Done pieces. Docs: H:docs/runner-prompt.md:218 ("follow-ups, wakes and aborts flow" under pause) and H:docs/runbooks/harbour-degraded.md:26.
- **G9** The proxy's dispatch list caps at 100 rows and carries no feedback. **true**. Default 20, max 100, no paging params (H:routes/proxy-dispatch.js:336). It is metadata-only, with no `prompt` or `feedback[]` (line 365).

## Counts

| Verdict | n | Facts |
|---|---|---|
| true | 15 | A2 A3 A5 B1 B2 B3 B6 C1 C3 D5 E4 E5 F3 F7 G9 |
| partly | 10 | A1 A4 B5 B7 D3 E2 F4 F5 F6 G8 |
| changed | 2 | B4 D6 |
| can't tell | 6 | D4 E1 E3 F1 F2 F8 |
| not checkable in code | 4 | C2 D1 D2 D7 |
| skipped (out of scope) | 7 | G1–G7 |
| **total** | **44** | |
