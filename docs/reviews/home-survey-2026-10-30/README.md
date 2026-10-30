# Home survey after LIN-4010 and LIN-4024

Read from `origin/main` at `c343ba37` (LIN-4024, 30 Oct). LIN-4010 is `c5245296` (29 Oct). The local checkout sits at `c5245296`, so every line number below comes from `git show origin/main:<file>`. Nothing in the repo was changed.

**How each claim was checked.** Most findings come from reading the code. Three are marked **[ran]**: for those I loaded the `origin/main` modules into memory and ran them on small inputs. The section at the end lists what I did not check.

## Sizes at a glance

| File | Before LIN-4010 | Now | Change |
|---|---:|---:|---:|
| `public/prompt-section.js` | 2,369 | 2,587 | +218 |
| `public/app.js` | 1,873 | 2,063 | +190 |
| `public/style.css` | 4,995 | 5,345 | +350 |
| `lib/task-page-loader.js` | 1,351 | 1,464 | +113 |
| `lib/render.js` | 930 | 1,014 | +84 |
| `server.js` | 4,526 | 4,608 | +82 |
| `lib/task-state.js`, `home-view.js`, `home-rows.js` (new) | 0 | 104 / 176 / 147 | +427 |
| All `public/*.css` (css-measures) | 20,380 | 20,741 | +361 |

## 1. Scattered decisions

### A. What state a task is in: two ladders, not one

The header of `lib/task-state.js:4` says Home's rows, count line, opened task and `/state` all read their state from there. In fact only the rows do.

| Ladder | Where | Who reads it |
|---|---|---|
| `taskStateOf` (needs you > failed > running > queued > parked > tracker word > next) | `lib/task-state.js:35`, called only from `rowStateOf` `lib/task-page-loader.js:1093,1125` | rows, count line, `buildHomeView` |
| `deriveHeader` (done > waiting > running/queued > ready > failed > idle) | `lib/task-page-loader.js:706` (rungs at 555, 565, 649, 547, 664) | the opened task's state line and the task page, through `/state` (`routes/task-page.js:187-202`) |
| Remapping the pill into Home's words | `STATUS_PILL` `lib/render-task-page.js:101`; `renderHomeStatus` `:211-226` turns "waiting" into "needs you" or "parked" | Home's opened task |

Session state is worded in three more vocabularies:
- `STAGE_STATE_WORD` at `lib/render-task-page.js:250`: a waiting session reads "waiting for an answer".
- `HOME_STATE_WORDS` at `public/sessions.js:50`, added by LIN-4024: any waiting session reads "waiting on you", **parked or not**. The row and the state line call the same session "parked". (By reading.)
- `STATE_INDICATORS` at `public/sessions.js:19`.

A running stage is worded three ways:
- the row: "Build running · 6m" (`task-page-loader.js:1113`)
- the header: "Build running for 6 minutes." (`:654`)
- the running box: "Running now · Build · started 6m ago" (`prompt-section.js:1204`)

### B. Running, queued and busy: 11 places

- **State sets.** `OPEN_STATES` (`task-page-loader.js:69`), `LIVE_STATES` (`:77`) and `UNENDED_STATES` (`:79`).
- **Same expression written twice.** "Running, or queued but not behind a ruling" appears in `sessionSummaryOf` (`:1000`) and again in `rowStateOf` (`:1111`).
- **Busy.** The unended-session test is repeated in `nextStepOf` (`:436`), `sessionSummaryOf.busy` (`:1010`), `containerFocusOf` (`:1063`) and `toStage` (`:491`).
- **`model.live`.** It uses `LIVE_STATES` (`:955`) and counts a queued session even when it sits behind a ruling. The two expressions above leave that session out.
- **`liveRung`.** It reports a queued session as status `running` (`:657`).
- **Browser.** `stageBusy` (`prompt-section.js:640`) re-derives busy as `busy || running`. `renderAfterRun` splits running from queued again (`:1168`, `:1208`).
- **Home state line.** `renderHomeStatus` blanks the line whenever status is `running`, which includes queued (`render-task-page.js:212`).

### C. What "needs you" means: 9 places, and they disagree on failed

| Place | Counts a failed task? |
|---|---|
| `task-state.js:40` `needsYouNow` (ruling, task-scan or child) | no |
| `task-state.js:90` `needsYou` | **yes** |
| `home-view.js:28` `needsYou \|\| state === 'failed'` (the OR adds nothing) | yes |
| `render.js:612` `state === 'needs-you'` (decides whether the row can expand) | no |
| `task-page-loader.js:1088-1090` `childNeedsYou` | no |
| `task-board-view.js:180` `subtaskNeedingYouOf` uses `.needsYou` | **yes** |
| `task-board-view.js:298` count line "N waiting on you" = `rulingCount` (the badge's rows, not the row states) | no |
| `render-task-page.js:216` ("needs you" unless the wait is a park) | no |
| `prompt-section.js:949-952` (hides the idle line next to "A subtask needs you") | n/a |

**[ran]** Take a parent with a started child whose Build failed:
- the child row says "Build failed" (state `failed`)
- the parent row says "Build failed"
- the count line counts it as failed
- the parent's opened task says **"A subtask needs you: C-9"**, because `subtaskNeedingYouByNodeKey` uses the `needsYou` flag, which includes failed.

**Assembled twice.** The ruling reading (`rulingStandingOf` plus three stores) is put together in `server.js:3481-3487` (whole workspace) and again in `task-page-loader.js:1266-1280`. The loader keeps only loops in the 30-day window and only this task's decisions. One more, by reading: the count line's `rulingCount` comes from every loop in the workspace, while the rows follow the page's team and assignee filter, so a filtered Home may count rulings it does not show. Not checked by running.

### D. What runs next: 8 sources

1. `nextStepOf` at `task-page-loader.js:434`. This is the step on offer. It holds the "why" words at `:439` and `:444`.
2. `sessionSummaryOf.next = guesses[0]` at `:1003`. It feeds "Next: X, once Y finishes" (`prompt-section.js:1169,1202`).
3. `rowStateOf` at `:1121`. For a container, the row's "X next" is **the chosen child's** next step. Otherwise it is `guesses[0]`, not `nextStepOf`.
4. `renderNextLine` at `render-task-page.js:235-243`. This is the task page's own wording of the why.
5. `renderStepLine` at `prompt-section.js:1147-1161`. The browser's why, with its own fallbacks: "the next step for this task" (the same string as `:444`) and "chosen for this run".
6. `runStepOfState` at `prompt-section.js:634`. The browser picks a step chosen for this run, or the offered one, or none for a container.
7. `COPY_STEPS` at `prompt-section.js:529`. A copy-first next step decided only in the browser, from the tracker state (Todo gives Plan, Backlog gives Scoping). `COPY_STATE_WORDS` (`:535`) restates the tracker's words.
8. `stepFits` with `FINISHED_STATE_TYPES` at `prompt-section.js:1219-1225`. Decides which steps "Another step" lists.

**[ran]** Take a started parent P-1 that has a finished Research session and one Todo child:
- the row says **"Research next"** (the child's step)
- `/state` for P-1 offers **Plan** (`nextStepOf`), and `sessions.next` is also Plan.

### E. Which subtask a parent's run goes to, and whether a row is a container

- **Is it a container?** The server decides with `containerNodeKeysOf` (`task-board-view.js:270`). It counts children **in the trimmed view** (`server.js:2027, 3550, 3643`). The browser reads that list at `app.js:351` and in `runStepOfState`. The row-state code (`containerFocusOf`, `task-page-loader.js:1060`) counts children **in the full tree**.
  - **[ran]** A started parent whose open children are all Todo has those children folded into "N more". The view gives it 0 children, so `containerNodeKeysOf` leaves it out. The opened task then treats it as a single task and offers its own step. Meanwhile the row names the child's step and sets `focus` to the child.
- **Which child?** `selectFocusSubtask` (`recommendation-facts.js:161`, 48 lines) is the one picker. It is called at 8 sites, each with different inputs:
  - the providers' `focusedChild`: `linear/index.js:1210`, `local/index.js:328`, `jira/index.js:911`
  - `prompt-formatters.js:93`
  - `recommendation-facts.js:223`
  - `recommend-recurse.js:196`, when the model defers to a finished child
  - `task-page-loader.js:1066`. This one runs only over children that are not busy, and only behind LIN-4010's extra narrowing (`LANDED_KINDS` `:1042`, `BUSY_ROW_STATES` `:1071`). That narrowing is a hand-written guess at when the selector would defer.
- **Three answers for a parent today.** The row names the picker's child. Run on a container is "Run to PR" (autopilot on the parent, John's 29 Oct correction). ✦ write prompt goes down to whichever child the model's `deferTo` names. Nothing ties the three together.

### F. Other copied rules (most were named by LIN-4016 and are still there)

- **Finished-state list.** Written three times: `prompt-section.js:1219`, `public/common.js:17` and `lib/providers/models.js` `TERMINAL_TYPES` (through `state-map.js:17`).
- **"Web needs Claude Code".** Lives only in the browser: `prompt-section.js:1276` (`fallBackTarget`) and `:1336-1340`. A text search of `lib/`, `routes/` and `server.js` found no server check.
- **Labels parsed back out of server HTML.** `prompt-section.js:1262-1272` (`unescapeText`, `optionWords`). The server already has the words: `routingWords` in `lib/components/decision-panel.js:125-129`.
- **Polled targets.** `POLLED_RUN_TARGETS` (`prompt-section.js:649`) copies `POLLED_TARGETS` (`lib/dispatch-targets.js:26`).
- **Home's page assembly in three places in `server.js`.** Top task, `homeRowStates`, `buildHomeView`, `subtaskNeedsYouById` and `containerNodeKeys` are built at `2005-2027` (re-render after a 401), `3535-3550` (Home) and `3626-3643` (`/api/home-rows`). Every fold click re-runs the whole fetch and all row states.

## 2. Dead code the two Home tickets left

- **`focusSubtaskByNodeKey`** (`task-board-view.js:230-259`, 30 lines). LIN-4024 stopped calling it. Its only caller now is `tests/unit/lin-4010-home-opened-task.test.js:208`.
- **`taskStateOf` outputs with no reader in production:**
  - `runOn` (`task-state.js:43,101`)
  - `needsYouTasks` (`:83,102`)
  - `focus` (`:95-100`), read only by the dead function above.
  - The docs still describe all three: `task-page-loader.js:1082,1116` and `task-state.js:27,33`.
- **`containerFocusOf` and the `selectFocusSubtask` import** (`task-page-loader.js:1040-1068`). These no longer choose where Home's Run goes. They survive only to produce the row's "X next" words (see D.3) and the dead `focus`.
- **`runSubject`** (`prompt-section.js:811`). It is always `{ issue, issueId }`, left over from LIN-4010's run-on-subtask. Its comments at `:1188` and `:1798-1799` still talk about a subtask.
- **The `subject` parameter of `fetchPrompt`** (`:1800-1802`). No caller passes it (`:1664`, `:1668`, `:2210`).
- **`opened.headerHtml` fallback** (`prompt-section.js:952`). `/state` always sends `homeStatusHtml` as a string, so `??` never falls back to it.
- **CSS made dead:** `.opened-task-on` and `.opened-task-on-open` (`style.css:1388-1398`). LIN-4010 added them. LIN-4024 removed the "On <subtask>" line that used them. These are the only classes the two tickets left with no emitter (token check over all JS, which can miss class names built at runtime).
- **Dead code from before these tickets, seen on the way:**
  - `buildInProgressCountLine` (`task-board-view.js:305`): only tests call it.
  - `hasStoredState` and `findExpanded` (`app.js:554,583`).
  - The dead CSS LIN-4015's review listed (`.model-select`, `.model-form`, `.runner-credential-*`, `.settings-group-subtitle`, `.feature-note`, …): all still there.

## 3. Tangles

| Function | Lines | Rough complexity* |
|---|---:|---:|
| `prompt-section.js` IIFE | 2,576 | ~826 |
| └ `init` (`:804`) | 1,763 (1,324 code lines; the review measured 1,117) | ~659 |
| └ `handleRunAction` `:1586` / `handleStreamingResponse` `:1898` / `handleClick` `:2184` | 125 / 119 / 108 | 42 / 36 / 30 |
| `app.js` `init` `:815` / `initSearch` `:1769` | 325 / 229 | 63 / 32 |
| `task-page-loader.js` `createTaskPageLoader` `:1228` | 237 | 39 |
| `task-page-loader.js` `rowStateOf` `:1085` | 53 | **36**, the densest in Home |
| `render.js` `renderPage` `:225` / `renderNodeHtml` `:600` / `renderDetailsContent` `:911` | 111 / 107 / 104 | 28 / 50 / 29 |
| `server.js` `fetchAndPrepareProjects` `:1651` | 225 | 24 |

\* Paths are counted as branches plus `&&`, `||` and `?:` using acorn. Use them to compare, not as exact figures.

**Home's state code.** It sits in `task-page-loader.js`, which `scripts/code-shape/areas.json` puts in the dispatch/run area. `rowStateOf` builds a full `buildTaskPageModel` for every task in every project tree, including Backlog and Done tasks (`server.js:3462-3493`). It then throws most of them away in `buildHomeView`.

**The path a parent's next prompt takes when it steps down into a subtask** (✦ write prompt on a parent):

1. `prompt-section.js:1664` → `fetchPrompt('__ai__')` `:1800` → `GET /api/recommend/:id/stream` (`:1833`).
2. `routes/workspace-api.js:526` → `streamRecommendation` `:229`, which fetches the context once (`:260`). If the task has children → `streamDescent` `:299` (65 lines).
3. → `resolveRecommendation` `lib/recommend-recurse.js:107` (117 lines, cc~21). It guards against depth, timeout, cycles, unresolved ids, ids that are not children, and finished children.
4. Each step down calls `computeOne` (`workspace-api.js:321`), which **fetches the start node's context again** (`:326`, by reading) → `provider.fetchRecommendationContext` (`linear/index.js:1195`, which calls `selectFocusSubtask` and then `fetchFocusedChild` `:1148`, one more query).
5. → `getRecommendationStream` `lib/openrouter.js:1092` (235 lines, cc~47). Its context formatters (`formatSelectorView` `:899`, which adds "SUGGESTED NEXT (defer candidate)" at `:922`; `formatIssueContext` `:741-870`; `formatSubtaskSummary` `prompt-formatters.js:77`) each name the picker's child.
6. → `parseRouteDecision` `stage-router.js:125`. It pulls `deferTo` out of the model's reasoning text (`:133`).
7. → back in the resolver, the child is checked and possibly re-picked (`:182-205`). Each step emits a breadcrumb (`workspace-api.js:319`), and the final `done` event carries `deferredVia` (`:358`).
8. → the browser strips those breadcrumbs again with a regex (`ROUTING_BREADCRUMB` `prompt-section.js:570`) and words the target ("This prompt is for X, a subtask of Y", `targetSentence` `:577`).

The same resolver is wrapped three more times: `workspace-api.js:468` (buffered GET), `routes/proxy-compute.js:487`, and `lib/dispatch-entrance.js:1581` (`descentArm`, 127 lines). `routes/proxy.js:1436` has a mock that always defers. The picker runs at 8 sites (see E). The model's choice can differ from the picker's. Home's row runs a third, narrowed copy of "would it defer". That spread, across about 9 files, is what makes it complicated.

## 4. Tests that read source as text

There are three kinds. Only the first and second pin layout.

- **Pins on server.js text.**
  - `lin-2006-refresh-truncation`, `lin-2550-assignee-label-tracks-applied-filter` and `lin-3774-handle-unauthorized-secondary-binding` cut `renderDashboardAfterRefresh` out of `server.js` by its exact signature and the docstring after it, then run it with a hand-made list of globals. LIN-4024 had to add `containerNodeKeysOf: () => []` to all three (for example `lin-2006…:83,196`).
  - So any merge of the three Home assembly blocks (F) breaks them, even when behaviour is unchanged.
  - Related ones: `lin-2521-resolve-team-selection-wiring` (11 text asserts), `lin-3774-fetch-and-prepare-projects-secondary-binding`, and `task-page-route.test.js:300` (mount order by `indexOf`).
- **Pins on app.js text.**
  - `lin-4024-home-description.test.js:69-78`: the exact signature of `renderDescriptionMarkdown`, "called exactly 3 times", and a 400-character window after a string literal.
  - `lin-3833-home-mount-needs-you` and `lin-4024-look` cut out `function mountHomePromptSections(` and `mergeHomeRowOpts` up to `\n}\n` and run them. That is behaviour, but it is tied to the function names and to their being top-level.
- **Pins on CSS text** (would hold back LIN-4015).
  - `lin-4024-type-floor` matches `.opened-task-change-summary,\n.opened-task-change-note` and an `@media` block down to its indentation (`:64,68`), plus 12px floors by selector in `run-control.css`.
  - Also: `lin-4009-page-header` (it even `doesNotMatch` a bare `header {` rule), `theme` (23 asserts), `library:422`, `styleguide-settings-samples`, `plain-layout-lin3958`, `lin-3956-plain-guards`.
  - 13 unit files read `public/*.css`.
- **One pin on render.js text.** `render.test.js:516` pins a branch of `renderProject` word for word.
- **Not pins, but coupled to fixtures.** The 14 `prompt-section*` and `lin-3833/3968/4010` client tests run the whole file in a `vm` through `PromptSection.init` (106 calls). They test behaviour. But they assert words the browser composes today ("Run to PR" appears in 6 test files, "usually next after" in 5). They feed fake `/state` bodies, so moving a rule to the server changes their inputs.
  - `run-limit-gating` (8 text asserts) and `lin-3975-task-run-control` (4) mix in source regexes.
  - `/state`'s key set is pinned (`routes/task-page.js:212`, per its comment).

## 5. The two existing tickets

**LIN-4016 (run rules to the server).** Every specific it names is still there, at new lines:
- `FINISHED_STATE_TYPES` (`:1219`)
- the web rule (`:1276`, `:1336`)
- HTML parsing (`:1262`)
- a second wording of the why (`:1147` against `render-task-page.js:235`)

What has changed:
- the file is **2,587** lines (it says 2,302)
- `init` is 1,324 code lines (it says 1,117)
- LIN-4010 moved the main "why" to the server (`nextStepOf.reason`), but the browser keeps two fallbacks

It would need to add:
- **one state per task.** The `taskStateOf` versus `deriveHeader` split in A, the 11 busy sites in B, and the failed-means-needs-you split in C (a real visible disagreement, [ran]).
- **one "next" and one container rule.** D and E: what the row says, what the box offers, and where the descent goes, three answers for a parent ([ran]). That needs a product sentence from John on what a parent row should say now that it runs on itself.
- **the client-only copy-first step** (`COPY_STEPS`) and `POLLED_RUN_TARGETS`.
- **the dead pieces** (section 2), as a first deletion.
- **freeing the pins first** (section 4, the server.js extraction tests in particular). Its "test that fails if a copy returns" is a pin by design and should be a behaviour test.
- **a scope split.** The descent path (section 3) is server-side and wider than `prompt-section.js`. It probably wants its own ticket.

LIN-3546 (splitting `init`) was not checked.

**LIN-4015 (shrink the CSS).**
- Its baseline has moved. CSS was 19,920 lines at the review and is **20,741** now. Literal spacing went 903 → **926**, token spacing 718 → 719. Duplicate blocks are still **29**.
- `.decision-panel-field` against `.settings-field` is still byte-identical (`style.css:1628` / `settings.css:772`).
- The session-list duplicates in `style.css`/`swipe.css` are still there (`style.css:5131,5149,5182,5225`), and Home still loads `swipe.css` (`render.js:313`).
- Home's opened-task CSS is now split across two sheets: 80 rules in `style.css` (37 before LIN-4010) and 42 in `run-control.css`.
- Add `.opened-task-on*` to its dead list.
- Its "with no visible change" and "visual replay shows no unintended difference" conflict with John's correction. It should be judged by behaviour tests (type floors and layout behaviour checked in the browser, not by matching selector text).
- It must free the CSS pins in section 4 first.

## What I did not check

- I did not run the scheduled measures (census, seams, shape) or the replay. Complexity figures are my own acorn count.
- I did not run the unit or E2E suites. The three [ran] findings come from loading `origin/main` modules in memory, not from tests.
- The double context fetch (section 3, step 4) and the filtered-count mismatch (C) are by reading only.
- The dead-CSS count is a token heuristic. Class names built at runtime (`state-*`, `toast-*`) show up as false positives across the wider sheets; only `.opened-task-on*` was confirmed against the commits.
- I did not read Linear, so I did not check the status of LIN-3546 or of the parent "UI finish" ticket.
- I did not review Swipe or the task page beyond the code they share with Home.
