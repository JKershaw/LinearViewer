# Where a task's test runs come from, and what each one buys — 2026-11-02

**For:** John. **Ticket:** LIN-4125. **Repo state:** `main` at `d35e8b6e`. Research only: no code changed, no tickets filed.

**Evidence base.**
- **Dispatch records.** Every non-wake dispatch item for the six LIN-4040 pieces: their prompts and feedback trails through `GET /api/proxy/dispatch/{id}` and `/prompt`.
- **Comments.** The ticket comments on those pieces.
- **PR bodies.** #2224 to #2229.
- **CI history.** Through `gh` and the Actions API: all 1,547 `test.yml` runs from 2026-10-03 to 11-02, with E2E logs from every fifth green run.
- **Source.** The stage templates, the runner, the autopilot prompts and the E2E specs, read at HEAD.

No full suite was run for this report; the laptop runner was busy.

**The six pieces.**

| Piece | PR | Slice |
|---|---|---|
| LIN-4103 | #2224 | S1 |
| LIN-4104 | #2225 | S2 |
| LIN-4115 | #2226 | S3d |
| LIN-4117 | #2227 | S3a-0 |
| LIN-4118 | #2228 | S3a-1 |
| LIN-4119 | #2229 | S3a-2 |

---

## The answer, short

1. **No stage template says which tests to run before a push.** "Everything still works" is defined as CI's `ci-success`.
   - The implementation template says only "**Test**: Run tests to verify implementation" (`lib/prompts/revision-brief.js:44`).
   - Review and close-out read CI, and never re-run suites while CI exists (`lib/prompt-formatters.js:366-377`, `lib/prompt-template-defs.js:951,986`).
   - The scope of each local run came from **the beat prompt the autopilot wrote for that task**. Those prompts drew on the plan's witnesses, and their scope differed piece by piece (§2). John's guess is right: it is the agents' safe default, and Harbour doesn't say one way or the other.
2. **The final local full E2E run took 40–120 minutes and caught no product defects.** Across the four pieces that ran it, in the final beat:
   - It caught specs that still asserted the old behaviour, which CI catches in about 8 minutes.
   - It cost one blocked beat (LIN-4118).
   - The piece that skipped it (LIN-4104) spent 13 minutes on its last beat. Its CI was green on the first run.
3. **The product defects in these six pieces were caught by screenshots and by review**, not by any suite, local or CI:
   - LIN-4103's box listed one subtask of two.
   - LIN-4104's run control did not draw all three buttons.
   - LIN-4119's Periodicals arrow stopped toggling.
4. **CI sends work back on 12% of PRs (58 of 479), and 7.6% of PR runs fail (80 of 1,058).** Almost all of it is real signal rather than noise:
   - Specs not updated for an intended change: 35 runs.
   - Product defects: 15.
   - Pins: 10.
   - Arms that only run in CI: 9.
   - Breakage from main or a sibling PR: 9.
   - Infra: 2.
   - **A flake turned a PR run red 0 times.** Flakes are real but hidden: Playwright's `retries: 2` absorbs them in 29% of green runs.
5. **The local-only E2E failures are a test-harness problem, not load or noise.**
   - Four of the five named specs inherit state another spec left behind on the same worker or server. The fifth sits in a timing window that LIN-4070's re-read loop opened.
   - Concurrent sessions on the laptop share ports 3001–3003, and the local Playwright config reuses whatever server holds them. One session's specs can therefore run against **another checkout's code**: LIN-4117 got a false all-clear on the four Home specs that CI then failed.
   - CI never failed on these five specs in the window, apart from two real defects each in `header-nav` and `look-alike-controls`, and three in `lin-3987`.
6. **Recommendation:**
   - Before a push, run the unit suite, the witness specs and the E2E specs the change touches. Then let CI be the full proof.
   - Write that rule into the implementation template once, so it stops being re-decided per task.
   - Separately, fix the shared-port reuse and the state leaks, so a local E2E result means something when an agent does run one (§7).

---

## 1. Re-ground: the ticket's figures

- **Where the breakdown came from.** The ticket's timing breakdown is not in the repo or on any ticket I could find, so I rebuilt it from dispatch timestamps.
- **Implementation share.** Implementation, from the first implementation dispatch to review, plus fix rounds, is **579 of 755 min (77%)**. The ticket says 68%. Its denominator probably includes planning on the parent tickets (LIN-4040, LIN-4112), which mine does not.
- **The last implementation stretch** (verify, push, PR, CI):

  | Piece | Minutes | Beats |
  |---|---|---|
  | LIN-4103 | 62 | b4 |
  | LIN-4104 | 13 | b5 |
  | LIN-4115 | 60 | b4 |
  | LIN-4117 | 42 | b4 |
  | LIN-4118 | 77 | b4 45 + b5 32 |
  | LIN-4119 | 122 | b3 96 + b4 26 |

  The earlier beats took 1–21 min. This matches the ticket's "40–96 min", except for LIN-4104.
- **Models.** Implementation beats ran on `claude-haiku-5-5`, review on Opus, close-out on Sonnet (the dispatch `model` field).
- **Drift.** Nothing has landed on main since the ticket was filed (`git log --since=2026-11-02T08:33Z origin/main` is empty).

## 2. Where each test run comes from

| Run | Who asks for it | Source |
|---|---|---|
| Witness fails first, then passes | Template | `lib/prompt-template-defs.js:825` (LIN-2219). Scoped to the agent's own new tests. |
| "Run tests", before the push | Template, scope unstated | `lib/prompts/revision-brief.js:44`. Also "Verify all tests pass" at `prompt-template-defs.js:823`. |
| Full suite on the branch **and** on base, diffing failure names | Template, **only when CI is absent** | `lib/prompt-formatters.js:376` |
| CI green on the head | Template, all of implementation, review and close-out | `revision-brief.js:47`, `prompt-template-defs.js:951,986,1019` |
| Per-beat unit and E2E scope | **The autopilot's own beat prompt**, written fresh for each task | Dispatch prompts; examples below |
| "Every existing E2E passes unedited" | **The plan** (LIN-4118's guard) | LIN-4118 description |
| "Run tests, and CI too" at session end | Runner self-check, scope unstated | `simple-dispatcher/hook.js:473` |
| The commands themselves (`npm test`, `test:unit`, Playwright) | `CLAUDE.md` only, as a command list with no "run before pushing" | `CLAUDE.md:22-26`. `CLAUDE.md:104` makes `ci-success` the merge gate. |
| Review's mutation and targeted re-runs | Template | `prompt-template-defs.js:898-905` (LIN-258, LIN-2274) |
| Flake triage ("whether they also fail on `main`") | Autopilot, for its own sub-agent only | `lib/prompts/autopilot-kickoff.js:535` |

**What the autopilot actually asked for in the last beat of each piece** (each beat prompt's own words):

| Piece | Final-beat test instruction | Local scope actually run |
|---|---|---|
| LIN-4103 | "Run the full test suite, plus the E2E checks" | Full unit; full E2E ×2; two `main` baselines; three screenshot runs |
| LIN-4104 | "Run the relevant unit suites (full unit suite if cheap) and e2e specs touching the run box" (beats 1–4); beat 5 had no local E2E | Full unit; run-box E2E set (134–140 tests) on one worker |
| LIN-4115 | "the E2E command the repo's CI runs" | Full unit (both CI arms); full E2E ×5 (branch and `main`), excluding the 12 specs that hard-code ports 3001–3003 |
| LIN-4117 | "Run the full unit suite once more" | Full unit only. "E2E impact (not run locally)" |
| LIN-4118 | "every existing E2E test must pass UNEDITED" (from the plan's guard) | Full E2E ×4 (branch 33 and 11 failures, `main` 1 and 13) |
| LIN-4119 | Beat 3: measure with Home rendering no sections, run unit and E2E. Beat 4: "run that spec alone… and then the full E2E suite on both, and diff the failing test NAMES" | Full E2E several times on both trees |

So the scope ran from "unit only" to "full E2E five times", and nothing in Harbour chose between them. The autopilot's beat judge asks "real tests, not asserted ones?" (`autopilot-kickoff.js:161`). That pushes each beat to show test output, and the cheapest output that reads as thorough is "the full suite".

## 3. What each run bought on the six pieces

| Piece | Local final-beat E2E | CI, first run | Who found the real defects |
|---|---|---|---|
| LIN-4103 | Found specs asserting removed wording. The PR retargets `lin-3968`, `lin-4009`, `lin-3833` and `lin-3987`. Also 10 `header-nav` failures that also fail on `main` | Green (PR #2224) | **Screenshots** in beat 4: "the box rendered only the first subtask under '2 subtasks need you'", plus a queue record read as running. **Review**: badge-scope mutation M5 survived; close-out added the witness. |
| LIN-4104 | Run-box set only, one worker | Green | **Review**: Request Changes. Not all three buttons drawn in every filled state, and the confirm's re-read had no witness (mutation stayed green). One 24-min fix round. |
| LIN-4115 | 12 failures, all pre-existing (`header-nav`, `look-alike-controls` …) | Green | **Review**: mutation M5 showed the source-scan regex accepts any `halt:` value. The E2E covered it. |
| LIN-4117 | Not run before the push. A default-config local shard-1 run during the CI wait gave "480 pass and 10 fail… None of the four Home specs that failed in CI failed here" | **Red** (run 41382273465): 12 tests in 6 specs asserted the old top-task placement. The plan had said "no E2E file edited". Fixed in `d3589ba0`; green 37 min after the PR opened. | **CI**, the one real send-back in the six pieces |
| LIN-4118 | Not clean on either tree; the beat **blocked** on ruling `lin4118-e2e-gate`. The autopilot then ruled: "the authoritative clean-environment gate is CI". Name diff: 0 failures unique to the branch. | Green | **Review**: mutant M6 survived; close-out added the test. **Close-out CI** on the merge with LIN-4117. |
| LIN-4119 | Beat-3 measurement found 94 E2E failures in 21 files to retarget (valuable). Full runs: `look-alike-controls`, also on `main` | Green | **Review** reproduced a regression that **both** the local full E2E and CI missed: the Periodicals header arrow no longer toggles (`renderPeriodicalProject`, `lib/render.js:582`). |

What each kind of run bought:

- **Witness and targeted runs, every beat.** These earn their place: they are how each beat proves its own claim, in minutes. The LIN-4104 beats ran only these, and its CI was green on the first push.
- **The full unit suite before a push.** Cheap insurance against pin and source-scan tests, which are 10 of the 80 CI failures in §4. No piece's dispatch record gives its local wall time, so I can't price it locally. In CI the unit job's median is 5.9 min.
- **The final full local E2E.** In LIN-4103 it caught stale spec expectations a CI run would have caught. In LIN-4115, 4118 and 4119 it caught nothing belonging to the change. In LIN-4118 it produced a blocked beat. Where it mattered most (LIN-4117), the contended local run would have **passed** the specs CI failed (§5). It is the most expensive run in a task's life and bought the least.
- **The LIN-4119 measurement run.** A targeted use of the full suite: make the next slice's change temporarily, run the suites, and see which files fail. It answers a question CI can't, namely which slice a failing spec belongs to. That is a planned experiment, not a default.
- **CI.** Clean environment, about 8 min, and the only run that every piece had to pass. It sent one piece back for a real reason (LIN-4117).
- **Review's mutation checks.** Found a product defect or an unpinned claim in all six pieces (LIN-4103, 4104, 4115, 4118, 4119 above; LIN-4117's review found a manual-repro gap and stale comments). Review took 3–6 min a time.
- **Close-out's CI on the new head, and main's push run.** Needed. LIN-4118's green PR run predated LIN-4117 landing, and only the close-out run covered the merged result.

## 4. How often CI sends work back, and why

These figures are from the Actions API, paged by week, so they cover the whole window; `gh run list` caps at 500 runs. Run IDs are under `https://github.com/JKershaw/LinearViewer/actions/runs/<id>`.

**Volume.**
- 1,058 PR runs over 479 PR branches, about 2.2 runs each. Each run matches one pushed head SHA, and no run was cancelled or superseded.
- 80 PR runs failed (7.6%). 58 PRs (12%) had at least one.

**Failures by job** (failed attempts): Unit 41; E2E shards 1–4: 28, 24, 14, 20; secret scan 0.

**Failures by cause**, judged from what the next commit changed:

| Cause | Runs | Examples |
|---|---|---|
| Specs not updated for an intended change (E2E evidently not run locally) | 35 | #2090 ×4, #2165 ×4, #2179 ×3, #2227 |
| Product defects | 15 | Server failed to boot (37863191389, 40108144752); prompt over its byte budget (38182874921); 320 px overflow (39957933192); #2219's stray `GET …/dispatch/preview` (41322406766) |
| Pins: CLAUDE.md anchors, catalogs, allow-lists | 10 | 37740323351, 40339475740 |
| CI-only arms: socket watcher, proxy env, locale, clock shift | 9 | 40221965074, 39181780498, 41138312615 |
| Broken by main or a sibling PR | 9 | A date-pinned `settings-keys` test from 10-25 (fixed in #2150); test-order state from #2134 (fixed in #2158) |
| Infra (the mongo container) | 2 | 39300594100 |
| Flake turned a PR run red | 0 | — |

**Tangle or noise?** By John's test ("a send-back from CI is a useful smell of a tangle"), most send-backs are signal:
- The 35 stale-spec runs are an intended change that the plan or author didn't trace to every spec asserting the old behaviour. LIN-4117's plan said "no E2E file edited" and was wrong about six specs.
- The 9 main/sibling breaks show coupling between PRs.

**Hidden flakes.**
- In a 290-run sample of green runs, **83 (29%) had a test pass only on retry**.
- The rate is falling: 34% (10-03 to 10-16), 29% (10-17 to 10-25), 17% (10-26 to 11-02).
- The worst offender is `dispatch.spec.js` "GET /api/dispatch lists queue items" (25 of the sampled runs).
- None of the five specs named in the ticket appears among them.

**Main.** Of 489 push runs, main ended red twice:
- 39313979414: the mongo image on a 6.19 kernel.
- 40220361851: the #2134 test-order leak.

Six more push runs needed a re-run.

**CI timing.**
- Whole run, successful first attempts: median 6.1 min across the window, 7.9 min since 10-26.
- The LIN-4040 PRs took 8.2–8.6 min.
- **Unit is the critical path:** its median is 5.9 min across the window, up from 5.0 to 7.7 min. The E2E shards are flat at 3.3–4.8 min.

## 5. Why those E2E specs fail locally on main, and whether CI sees it

**A cause none of the five specs shows on its own: concurrent sessions share the E2E servers.**
- Each dispatched session has its own checkout under `simple-dispatcher-workspaces/<session>/`.
- The E2E servers use fixed ports 3001–3003, and locally `reuseExistingServer: !process.env.CI` (`playwright.config.js:92,102,117`). A second session's Playwright run therefore **reuses the first session's server**, which serves the first session's code and data.
- Evidence from 2 Nov, 03:28, while LIN-4117 and LIN-4118 ran side by side:
  - LIN-4117's CI-config run "did not start. Port 3001 is held by another session's Playwright run (from workspace `9fe754ec-…`)". `9fe754ec` is LIN-4118's session.
  - Its default-config run started and reported none of the Home failures CI found. A run that reuses a server says nothing about the checkout it was started from.
  - LIN-4118's runs in the same window swung between 33 and 11 failures on the branch and 1 and 13 on `main`.
  - LIN-4115 dodged the problem by excluding the 12 spec files that hard-code those ports (PR #2226 body), and LIN-4117 by writing a temporary config on 3101–3103.

**The five specs.** The `file:line` references are at HEAD. The failure snapshots come from a saved run in `simple-dispatcher-workspaces/e9bec43c-…/LinearViewer/test-results/beat4-full-e2e/`.

| Spec | Cause | Status | In CI over the window |
|---|---|---|---|
| `header-nav` "Pinned header clearance" (10 tests, `tests/e2e/header-nav.spec.js:833-877`) | The failure is always "no focusable control with room to scroll" (`Received: null`, :872), not clearance.<br><br>The setup at :803 calls `/test/set-session` with no `runnerKey`, which leaves an earlier spec's runner key in place (`routes/test.js:352-365`). A live key turns run controls on, which hides the copy-first card (`server.js:3496`). That card is the only control that qualifies. | Cause **confirmed**; key-leak trigger a **strong hypothesis**. LIN-4109's diagnosis ("before fonts and layout settle") doesn't fit. | Never failed (added 10-30) |
| `ship-biscuit` "quiet window" | Its setup never clears report history or task snapshots. `roadmap.spec.js:906-909` saves reports for the same `test-workspace-wN` and sorts just before it, so on one worker the "quiet" edition leads with "The roadmap, re-read: 1 item crossed the wire" (saved snapshot). Latent since `40799ca7` (July). | **Confirmed** from the snapshot | Never |
| `look-alike-controls` (`:151`, `:209`) | LIN-4070 (`f0ac579c`, 11-01) added `rereadUntilComplete` (`public/prompt-section.js:2711-2728`). While the cached task facts are incomplete, it re-reads every 1 s, and each re-read sends `GET …/api/dispatch/preview` inside the spec's 500 ms click window. The cache lives per server process, with no test reset (`lib/task-facts-holder.js:21-25`; `createTestRoutes` isn't given `taskFacts`). | **Strong hypothesis** (LIN-4110) | Failed twice, both real defects (40084503168, 41323197563) |
| `lin-4024-home-seeded` (`:92`) | The opened task shows its history but not the question. That is exactly what `/state` returns while the facts are incomplete (`routes/task-page.js:229-235`). Same cache as the row above. | Incomplete reply **confirmed**; why it was incomplete is a hypothesis | Never |
| `lin-3987-decision-panel` (`:115`) | "no runs in 30 days" instead of "priced": no step was offered, either from the same incomplete state or because the top task moved (LIN-4117). | **Hypothesis** | Failed 3×, all real defects |

**Why CI stays green.** CI splits the files across 4 shards with 2 workers each, so the files that leak state rarely share a worker with the files that inherit it, and `retries: 2` absorbs the rest. That is inferred, not measured. CI also never runs two checkouts against one server.

**Docs mislead here.** `CLAUDE.md:54` says "Parallel execution itself (`workers > 1`) is **not** enabled yet", but `playwright.config.js` runs 4 local workers. Nothing in the repo lists the known local failures or how to tell "fails on main" from "mine".

## 6. Classes found, and how each was bounded

- **Prompt text that instructs test runs.** Bounded by a grep over `lib/`, `docs/`, `routes/` and `content/` in both repos, by concept (suite, e2e, playwright, `npm test`, CI, green, baseline, flak), then reading each hit.
  - Members are listed in §2.
  - Dead text: `formatSuccessCriteria` (`lib/prompt-formatters.js:392`) is imported but never called.
  - `docs/prompt-pipeline/stage-descriptions/*` is superseded and not served.
- **The six pieces' test runs.** Bounded by every non-wake dispatch item on LIN-4103, 4104, 4115, 4117, 4118 and 4119: 52 items, all fetched.
- **CI failures.** Bounded by all 1,547 `test.yml` runs from 10-03 to 11-02. Hidden flakes come from a 1-in-5 sample of green runs.
- **Locally failing specs.** The five named in the ticket, plus the others recurring in the saved runs: `lin-4010-home-opened-task` (LIN-4102), `lin-4115-home-halt-banner`, `lin-4119-backlog-page`, `live-console`. Those others were **not** diagnosed. Because this population lives in local, uncommitted runs, it can't be bounded from source.

## 7. Recommendations

In order of value for cost. None is filed as a ticket, as asked.

1. **Write the pre-push rule into the implementation template once,** at step 5 of `lib/prompts/revision-brief.js:44`. Suggested rule:
   - Before pushing, run the full unit suite, your witness specs, and the E2E specs that exercise the surfaces you changed. Find them by grepping `tests/e2e` for the routes, test IDs and words you changed.
   - Don't run the full E2E suite locally to prove nothing else broke: CI does that in about 8 minutes, in a clean environment.
   - If CI goes red on a spec you didn't run, retarget or fix it in this PR.

   This is a prompt-size change, so its reason has to be recorded beside the ceiling (CLAUDE.md invariant; `tests/unit/prompt-size-budget.test.js`). The autopilot kickoff should carry the matching line, so its beat prompts stop choosing their own scope. **Evidence:**
   - LIN-4104 ran this scope and was green on the first push, with a 13-min final beat.
   - The other final beats took 42–122 min.
   - 35 of 80 CI send-backs are exactly the stale-spec case. Fixing one costs one CI cycle, about 8 min, against roughly 30–90 min of local full runs that can be wrong (§5).
2. **Plans should say which E2E specs an intended change will break, by grepping, not by guessing.** LIN-4117's "no E2E file edited" was the one real send-back here. LIN-4119's measurement run is the strong form of this, worth reusing when a slice moves something other slices assert on.
3. **Stop concurrent sessions sharing E2E servers.** Either set `reuseExistingServer: false`, or give each checkout its own port base (e.g. from an env var), with the 12 spec files that hard-code 3001–3003 reading it too. Until then, any local E2E result taken while another session runs is unreliable, in both directions.
4. **Fix the two confirmed state leaks:**
   - `header-nav`: pass `runnerKey=0` in its setup at :803.
   - `ship-biscuit`: clear report history and task snapshots in its setup.

   Also add a test-route reset for the task-facts cache, so a spec doesn't inherit another spec's incomplete set. That reset is the likely common cause of the `look-alike-controls`, `lin-4024` and `lin-3987` failures. Correct LIN-4109's diagnosis and CLAUDE.md:54 while there.
5. **Make hidden flakes visible.** Count Playwright's `flaky` results in CI (a summary line or a soft check). `retries: 2` hides a retry-only pass in 29% of green runs, and `dispatch.spec.js` "lists queue items" is the top one.
6. **Keep:** witness-first runs, review's mutation checks, close-out's CI on the new head, and main's push run. Each one caught something in these six pieces that nothing earlier did.
7. **If CI time becomes the bottleneck, look at the unit job first.** It is the critical path, and its median rose from 5.0 to 7.7 min this month.

## 8. What I could not find out

- **The original timing breakdown** (68%, "about a third waiting on tests"). Not in the repo or on any ticket I searched. My own figures (§1) use dispatch timestamps. I could not measure "waiting on tests" exactly: the feedback trails show monitor waits but not each run's start and end. My rough estimate is that local E2E and screenshot runs took about 45 of LIN-4103's 62-min final beat and about 47 of LIN-4115's 60.
- **Local unit-suite wall time.** No dispatch record states it.
- **Which of LIN-4103's "seven stable failures" were its own.** The trail says it ran main baselines to decide, then reran "with the fixes". The PR lists four retargeted E2E specs. The exact mapping isn't recorded.
- **Whether a given past send-back was "not run locally" or "run and missed".** No record of local runs exists outside these six pieces.
- **The cause-of-failure classification in §4 is a judgement** from the next commit's diff and message. A few runs are mixed (40035590291, 40084958390, 37777425111).
- **Which earlier spec left the runner key behind for `header-nav`,** and which cache condition (refused write, dropped entry, attempt floor) leaves the task-facts set incomplete. Both need a local run on free ports to settle. The experiments are named in §5.
- **Whether a reused stale server or leftover `test-results/main-e2e-data` adds failures beyond the concurrent-session case.** The specs pass alone, which suggests not much.
