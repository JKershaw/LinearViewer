TITLE: Rebuild the task page loader (lib/task-page-loader.js) design-first: same results for its callers, cleaner code, checked by a replay against today's module

PARENT: LIN-3549 · PROJECT: Quality, Periodicals & Measurement · PRIORITY: High · STATE: Todo

**Goal.** Rebuild `lib/task-page-loader.js` as a whole, in one change, keeping its file name, its 11 exports and the modules it imports from (`pipeline-loops`, `loop-supersede`, `dispatch-terminal`, `run-view`, `render-run-steps`, `task-run-facts`, `run-evidence`, `github-pr-status`, `run-ledger`, `effort-readout`, `brief-cache`, `providers/state-map`), plus the optional helper below and no other new import.
* Pure: `stageLabel`, `fmtWhen`, `isNotFoundError`, `sessionMessage`, `guessStages`, `briefCurrentSection`, `buildTaskStages`, `deriveReadyHeader`, `deriveHeader`, `buildTaskPageModel`. `lib/render-task-page.js` imports `fmtWhen` and `stageLabel`.
* `createTaskPageLoader(deps)`, which returns `{ loadTaskPage, loadTaskState }`. `server.js` builds it once and hands it to `routes/task-page.js` (the owner page and its state endpoint) and `routes/task-share.js` (the guest page).

Every export gives its callers the same results as today, apart from the class-(a) fixes and class-(c) fuzz listed in the PR, and the code is cleaner. Merge as normal. Success is John's: "what we end up with matches the utility of what came before, but the code is _cleaner_ (cognitively simpler, less room for bugs, easy to maintain)."

**Why.** This is the next rung of John's rebuild experiments, a ladder in which each rung is a little larger, as John proposed. John asked to complete the current list of targets. Rungs 2–5 (LIN-3566, LIN-3569, LIN-3573, LIN-3578 and LIN-3579) were rebuilt this way, design first and then a replay against the old behaviour, and all merged. Like LIN-3578 it is a library; its dependencies are injected.

What John has said that applies:
* On behaviour changes: "sure, we can fix bugs".
* On a rebuild that turns out to have dropped something: "No harm in retrospectivly finding missing functionality and either improving tests and trying again, or some other solution."
* On whether everything is needed: "Worth nothing also if it's all behaviour we actually need."
* His note for the experiments: "no need to be so strict on edge cases as we experiment. Bugs should be fixed, but we want it to improve,so there's going to be fuzz."

Class (c) below is this ticket's bounded form of that note for a module two pages depend on. The classes, and the source-text rule below, are the ticket's own, not John's.

**Decision.**

**This is one PR. Don't split it into child tickets.**

* **Work design-first, in this order.**
  1. **Requirements.** Write the module's contract into the PR description as one requirements list. For each export, and for `loadTaskPage` and `loadTaskState`, give its signature with defaults, inputs, outputs (for `buildTaskPageModel`, the model's keys and the session and stage shapes), errors thrown or rejected, and side effects: dependency calls with arguments and order, console output, and clock reads. Take it from:
     * the file's docblocks and comments;
     * its callers: `server.js`, `routes/task-page.js`, `routes/task-share.js`, `lib/render-task-page.js`;
     * the unit tests that use it (`task-page-loader`, `render-task-page-golden`, `task-page-finished-story`, `task-page-route`, `task-share-route`, `authenticated-pr-reads`, `closed-row-readers`) and the e2e specs `task-page` and `task-share`;
     * its entry in `docs/architecture/source-map.md`.

     Decide each of these edges explicitly: keep it, or list it as a class-(a) fix with its reason.
     * `stageLabel` is a plain-object lookup: kind `'constructor'` gives the `Object` function and `'__proto__'` gives `Object.prototype`, and both flow into `sessions[].label` and `stages[].label`; a truthy non-string kind (`5`) throws in `stepKindWord`, so `buildTaskPageModel` throws.
     * `deriveReadyHeader` accepts PR number `0` and the string `'41'` (`!= null`); `fmtWhen(0)` is `null`; `isNotFoundError` on a bare string is `false`; `guessStages` on a non-array gives all five stages.
     * The header sentence is the first non-empty line; over 160 characters it becomes the first 159, `trimEnd()`ed, plus `…`.
     * `loadTaskPage` rejects, instead of returning `{ unavailable: true }`, when `getLoopsForIssue` or `readTaskRunFacts` rejects, and when `hashContext(ctx)` throws (for example a truthy non-array `ctx.children` while an issue id is known).
     * A superseded session still `queued` stays `queued`, never `continued`; `continued` ends at the first follow-up's `dispatchedAt`.
     * The cache check (LIN-3373): with every child terminal, a doc shows only when its `inputHash` matches, else `'stale'`; otherwise a finished task withholds it as `'unverifiable'` and an open one shows it unchecked (the residual the comment names).
     * `readPrStatus` is passed only with a `prStateStore`, and the workspace token only when `urlKey` is truthy and `prReadToken` matches the repo (LIN-3443).
  2. **Design.** Write the design into the PR description, from that list: the simplest structure that serves every export, with its data flow, its functions and their single responsibilities. Where code paths share logic (the session state ladder and the header ladder, the two loaders' loop reads and issue-id fallback, the brief and recap checks), say it once. Don't follow the old functions' structure. If part of the current design is genuinely the simplest, say why.
  3. **Build.** Write the new module from the design, replacing the file as a whole. Don't copy functions or code blocks from the old file; reason comments stay (below).
* **Source-text tests.** No test reads `lib/task-page-loader.js` as text. Satisfy these as written:
  * **`render-task-page-golden`** compares rendered pages with `tests/fixtures/render-task-page-golden.json`. It must pass unchanged; never regenerate it with `UPDATE_RENDER_TASK_PAGE_GOLDEN=1`.
  * **`task-page-links`** fails on any `` `/task/${` `` template literal under `lib/` outside `lib/task-page-href.js` and its allow-list. Add none.
  * **The scanners over all of `lib/`, including** `lin-3384-redaction-census` (this file has no dispatch-store read; loops come through `getLoopsForIssue`, so add none), `lin-3382-urlkey-class-guard`, `email-import-boundary`, `lin-3383-runner-enqueue-census`, `lin-3136-copy-surface-census` and `docs-architecture-anchor-resolver`. They must still pass with the new file and any helper.
* **An optional helper module** goes in `lib/`, only if the design needs one, imported only by `lib/task-page-loader.js`. No test requires registering it. Leave `scripts/code-shape/areas.json` (a guide no test enforces) and `docs/architecture/source-map.md` unchanged.
* **Check against today's module, outside the repository.** Record your branch's base SHA. Copy that base's `lib/task-page-loader.js` into a temporary folder outside the repository as a `.mjs` file, with relative imports rewritten to absolute paths into your checkout. Do the same for the new file, with the helper copied beside it. Write a throwaway replay:
  * **Setup.** Set `TZ=UTC`. Freeze the clock, so `Date.now()` and `new Date()` return one instant, with `instanceof Date` still true. The module reads no env and keeps no state; add none. Block outbound network; there should be none.
  * **Fakes.** Use the real `enrichLoop` and `deriveSessionWaiting` from `routes/dashboard.js`. Make every other dependency a recording fake; in some runs use the real `readRunEvidence`, `getLoopsForIssue` and `readTaskRunFacts` over fake stores. Inject failures: not-found and other tracker throws, a null `ctx` or one without an issue, and rejections from the caches, evidence, close-out events, loops and run facts.
  * **Inputs.** Feed about 1,000 seeded generated inputs to each of `buildTaskPageModel`, `loadTaskPage` and `loadTaskState`, a few hundred to the small exports, plus the calls captured from the existing unit tests. Capture them under a preload that records each call into the module, with its arguments and dependency responses, and check that the old side reproduces what each test saw. Cover:
    * every session end (marker, closed row, cancelled, expired, agent complete or error, continued, waiting, queued) and follow-up chains;
    * the header ladder, ready headers and stage folding, including tasks with only orchestration rows;
    * tracker shapes (UUID opens, parents, children, blockers, Linear, GitHub and Jira comment authors);
    * every `loadTaskPage` branch, `mergedBy` by PR URL and by number, and timestamps as strings, `Date`s, numbers or garbage.

    Record the seed and the per-export counts.
  * **Comparison, per input:** the outcome (return, throw, resolve or reject); the error class and message; the return value, deep, with key order ignored and `undefined`-valued keys distinct from absent ones; every console call; every dependency call with its arguments, in order (order among parallel calls is information); any mutation of the inputs or of dependency results; and unhandled rejections. Report key order and shared objects (`sessions[].loop`, `stages[].sessions`, `evidence`) as information. Review any new sharing, because `routes/task-share.js` caches the model.
* **Classify each difference,** by behaviour change:
  * **(a) A fix:** today's behaviour is wrong by its own comments, by `docs/` or by a test, and the new one isn't. Keep each fix and list it.
  * A fix that fails an existing test is not (a): keep today's behaviour and list it as looking wrong.
  * **(b) A regression:** a caller gets a different return value, error, dependency call or log for input it could really produce. Fix it.
  * **(c) Accepted fuzz.** Only these qualify. List each with a one-line reason.
    1. An error message's wording, with the same error class.
    2. Console-log wording, with the same console method.
    3. Input no caller produces, where old and new have the same outcome and make the same dependency calls.

    **These are never (c):**
    * any model field's value or presence, and the loader's outcome (`{ model }`, `{ notFound }`, `{ unavailable }` or a rejection), for input callers produce;
    * session and stage grouping, order, state and label; the header's status and sentence; `readyHeader`, `live` and `finished`;
    * timestamps, including `endedAt`, `durationMs` and `fmtWhen`'s text;
    * dependency calls and their arguments: the one tracker read with `{ noDescend: true }`, cache `get` only (never `put`), `readTaskRunFacts` before the evidence read, and the `readPrStatus` token rule;
    * which cached brief or recap is shown, and the `contextMiss` reason;
    * which console method fires, and when;
    * input mutation.

    Where unsure whether a difference is (c), it's (b). Use (d) only when no comment, doc or test settles the right behaviour.
  * **(d) Unclear and material:** raise a `DECISION:` and stop.
* **Tests.** If there is at least one class-(a) fix, add tests for them in a new file, `tests/unit/task-page-loader-pins.test.js`, one per fix. Any server it starts binds `127.0.0.1` (LIN-2023). Don't edit existing test files or fixtures. CI (the unit suite under `test:hermetic`, and e2e) must be green.
* **Scope.** Change only `lib/task-page-loader.js`, the optional helper module and the new test file. Every caller stays unchanged. No new mechanism in the repository; the replay stays outside it. Never pass a `repo` override when dispatching workers.
* **Keep the operator's laptop usable.** Don't start parallel forks or background sub-agents; do the parts one at a time (a reboot loses forks and the failsafe can't revive them). While iterating, run the unit tests for the files you change; run the full unit suite once before opening the PR. Leave e2e to CI; run it locally only to reproduce a CI failure. Your replay: about 1,000 seeded inputs per heavy export plus the test-captured calls, one seed, no coverage; a separate independent replay checks the merged result.
* **Keep the reasons.** Keep every existing ticket reference and every reason comment beside the code it governs; drop one only if its code is gone, and list those in the PR.
* **No live checks, no paid model calls.** Don't call a deployed instance, a production or shared database, OpenRouter or any other model API. The local test databases the suite starts are fine. The evidence is the replay and the tests.

**Done when.** The rebuilt module is merged as normal, with no second copy, and the PR records:

* the requirements list, with each edge above decided, and the design;
* the replay: the base SHA, the seed, per-export input counts (generated and captured), and a table of behaviour changes, each with its class, its count and one example's before and after;
* no class-(b) or class-(d) rows remaining at merge;
* a short list of behaviours that looked unneeded or dead, reported and not removed;
* line counts and the number of functions before and after, as information only.

**Out of scope.**

* The callers: `server.js`, `routes/task-page.js`, `routes/task-share.js`, `lib/render-task-page.js`.
* `routes/dashboard.js` and the imported modules, especially `pipeline-loops` and `run-evidence`.
* The stores.
* Changing the export surface.

**References.**

* LIN-3578, LIN-3579 and the earlier rungs above, the same method.
* `tests/unit/task-page-loader.test.js`, `tests/unit/render-task-page-golden.test.js` and `tests/unit/task-page-finished-story.test.js`.
* The parent, LIN-3549.
