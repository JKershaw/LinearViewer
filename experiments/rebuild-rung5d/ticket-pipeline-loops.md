TITLE: Rebuild the Loop and Session reconstruction library (lib/pipeline-loops.js) design-first: same results for its callers, cleaner code, checked by a replay against today's module

PARENT: LIN-3549 · PROJECT: Quality, Periodicals & Measurement · PRIORITY: High · STATE: Todo

**Goal.** Rebuild `lib/pipeline-loops.js` as a whole, in one change, keeping its file name, its exports and the modules it imports from (`dispatch-terminal`, `session-telemetry`, `digest-feedback`, `read-horizon`, `dispatch-targets`, `utils/time`), plus the optional helper below and no other new import.
* Public: `getLoopsForIssue`, `getLoopsForWorkspace`, `getSessionsForWorkspace`, `getSessionsForIssues`, `redigestHistoryRows`, `deriveIssueGraph`, `firstRaisedAt`, and the re-exports `isDecisionAnswerEntry`, `isDecisionLifecycleStampEntry` and `resolvedDecisionEvents`, which must stay the same function objects as `lib/digest-feedback.js`'s.
* `__internal`, which 11 test files use: its 14 members, by name, including `LOOKBACK_MS`.

Every export gives its callers the same results as today, apart from the class-(a) fixes and class-(c) fuzz listed in the PR, and the code is cleaner. Merge as normal. Success is John's: "what we end up with matches the utility of what came before, but the code is _cleaner_ (cognitively simpler, less room for bugs, easy to maintain)."

**Why.** This is the next rung of John's rebuild experiments, a ladder in which each rung is a little larger, as John proposed. `docs/papers/harbour/rebuild-ladder.md` records a pause before the next rung; John resumed the ladder on 16 October. Rungs 2–4 (LIN-3566, the roadmap renderer; LIN-3569, the Agent API read routes; LIN-3573, the Agent API write and rulings routes) were rebuilt this way, design first and then a replay against the old behaviour, and all merged. This rung is the first on a library, whose callers are other modules rather than agents.

What John has said that applies:
* On behaviour changes: "sure, we can fix bugs".
* On a rebuild that turns out to have dropped something: "No harm in retrospectivly finding missing functionality and either improving tests and trying again, or some other solution."
* On whether everything is needed: "Worth nothing also if it's all behaviour we actually need."
* His note for the experiments: "no need to be so strict on edge cases as we experiment. Bugs should be fixed, but we want it to improve,so there's going to be fuzz."

Class (c) below is this ticket's bounded form of that note for a library many modules depend on. The classes, and the source-text rule below, are the ticket's own, not John's.

**Decision.**

**This is one PR. Don't split it into child tickets.**

* **Work design-first, in this order.**
  1. **Requirements.** Write the module's contract into the PR description as one requirements list. For each export and `__internal` member, give its signature with defaults, inputs, outputs (for `_buildLoops` and `_buildSessions`, the Loop and Session keys and their order), errors thrown or rejected, and side effects: store calls with arguments, console output, module state, and clock and env reads. Take it from:
     * the file's docblocks and comments;
     * its callers in `lib/`, `routes/`, `server.js` and `scripts/`;
     * the 25 unit-test files that import it, and the e2e specs that rely on it;
     * its entry in `docs/architecture/source-map.md`.

     Decide each of these edges explicitly: keep it, or list it as a class-(a) fix with its reason.
     * An identifier-less autopilot loop is bucketed as `__anchor__:<loopId>`, so a real issue whose identifier starts with `__anchor__:` is treated as an anchor.
     * Agent-status ties. The exact-`dispatchId` match replaces a best entry that has no timestamp (so all-null entries pick the last) and keeps the first of equal timestamps; the window match skips entries with no timestamp and keeps the first of equal ones.
     * `horizon: 'all'` with a numeric `0` `dispatchedAt`: the row is kept, but `dispatchedAt || null` reports it as `null` (a string or `Date(0)` is reported as given).
     * `now` types: `_buildLoops` needs a `Date`; a string or number throws a `TypeError`.
     * The invalid-`dispatchedAt` warning fires on every call; the other dropped-row warnings fire once per cause.
     * Non-lean, a returned loop's `feedback` is the input row's own array (lean gets a fresh `[]`), and Sessions hold the Loop objects they were given.
  2. **Design.** Write the design into the PR description, from that list: the simplest structure that serves every export, with its data flow, its functions and their single responsibilities. Where code paths share logic (the live and history row checks, the lean and non-lean fact paths, the session stitching passes), say it once. Don't follow the old functions' structure, except where an `__internal` name or the census below pins it. If part of the current design is genuinely the simplest, say why.
  3. **Build.** Write the new module from the design, replacing the file as a whole. Don't copy functions or blocks from the old file. Keep the reasons a reader needs, with their ticket references (LIN-2232, LIN-3328, LIN-3011, LIN-1393, LIN-623 and others), beside the code they govern.
* **Source-text tests.** None is convertible here; satisfy them as written.
  * **`lin-3384-redaction-census`** is a safety check on every read that can reach a live bootstrap token, so it is never converted. It scans `lib/` and `routes/` for store reads (`.listItems(`, `.listHistory(`, `.getItemStatus(` and others) and raw `historyCollection.find(` reads, skipping comment lines. It keys each site by the nearest line at or above the read's own line that looks like a function header (a `function` declaration, `const name = (`, a two-space-indented `name(…) {`), not by the function that really encloses it. Its table allows exactly two keys in this file:
    * `lib/pipeline-loops.js :: timed`, 2 calls. Today these are the `listItems` and `listHistory` reads in `_fetchWorkspaceData`, just below `const timed = (p) => {`.
    * `lib/pipeline-loops.js :: redigestHistoryRows`, 1 call: the raw `historyCollection.find`.

    So keep a `timed` header (`const timed = (` or `function timed(`) as the nearest one above both reads, keep the one raw re-read inside `redigestHistoryRows` with no other header between that function's own header and the read, and add no other site. Don't start a read's own line with `const x = (`, because the census would file it under `x`. `listStatus` and `updateOne` are not counted. A site in a helper module would be an unlisted row, so the reads stay in this file.
  * **Callers' import lists.** `observer-sweep`, `observer-efficacy-signal` and `liveness-contract-and-capability` assert that their modules import `./pipeline-loops.js`. Keep the file name.
  * **The scanners over all of `lib/`, including:** `lin-3383-runner-enqueue-census`, `lin-3382-urlkey-class-guard`, `lin-3134-declared-mint-census`, `lin-3130-create-dispatch-item-proxy-token-store-pin`, `proxy-tokens-private-mint-source-pin`, `interactive-openrouter-chain-byte-identity`, `lin-688-undici-not-a-dependency`, `email-import-boundary`, `docs-architecture-anchor-resolver`, `lin-3136-copy-surface-census`, `urlkey-holders` and `task-page-links`. They must still pass with the new file and any helper.
* **An optional helper module** goes in `lib/`, only if the design needs one, imported only by `lib/pipeline-loops.js`. No test requires a new `lib/` file to be registered. `scripts/code-shape/areas.json` is a guide no test enforces. Leave it and `docs/architecture/source-map.md` unchanged.
* **Check against today's module, outside the repository.** Record your branch's base SHA. Copy that base's `lib/pipeline-loops.js` into a temporary folder outside the repository as a `.mjs` file, with relative imports rewritten to absolute paths into your checkout. Do the same for the new file, with the helper copied beside it. Write a throwaway replay:
  * **Setup.** Set `TZ=UTC`. Freeze the clock, so `Date.now()` and `new Date()` return one instant, with `instanceof Date` still true. Clear the env and set `OBSERVATION_FEED_TIMING` per input. Load a fresh module instance per input on each side (for example with a unique query string), so `_warnedMalformedCauses` and any state the rebuild adds start empty. A query string reloads only the main file, so either load the helper with the same query string or keep module state in `lib/pipeline-loops.js`. Block outbound network; there should be none.
  * **Fakes.** Model the stores on `lib/dispatch-store.js` and `lib/agent-status-store.js`: the issue filter, `since`, the lean projection, `_id $in`, and the `feedbackVersion`-guarded `updateOne`. Some runs use doubles that ignore options, as most test doubles do. Inject failures: sync values and throws, rejections, non-array or `null` results, `find` rejecting or dropping a row, and `updateOne` failing.
  * **Inputs.** Feed at least 3,000 seeded generated inputs, plus the calls captured from the existing unit tests. Capture them under a preload that records each call into the module, with its arguments and store responses, and check that the old side reproduces what each test saw. Replay each test file's captured calls in order, in one instance, because warn-once state carries over between the tests in a file. Cover:
    * every export and `__internal` member, lean and non-lean;
    * cyclic issue graphs, and autopilot runs with and without an issue;
    * stamped, legacy, dangling and cyclic follow-up chains;
    * aborts, wake rows and live rows;
    * rows at and past the 30-day cutoff, duplicate ids and malformed rows;
    * timestamps as strings, `Date`s, numbers or garbage;
    * digests that are fresh, stale, legacy or missing;
    * repeated calls in one instance.

    Record the seed and the per-export counts.
  * **Comparison, per input:** the outcome (return, throw, resolve or reject); the error class and message; the return value, deep, with key order ignored and `undefined`-valued keys distinct from absent ones; every console call; every store call with its arguments; any mutation of the inputs or of store results; and unhandled rejections. Report key order and shared objects as information. Review any new sharing, because callers may mutate shared arrays.
* **Classify each difference,** by behaviour change:
  * **(a) A fix:** today's behaviour is wrong by its own comments, by `docs/` or by a test, and the new one isn't. Lean and non-lean disagreeing where the comments say they agree also counts. A lean/non-lean difference in console output is (a) only if a comment, doc or test says the two should match. Keep each fix and list it.
  * A fix that fails an existing test is not (a): keep today's behaviour and list it as looking wrong.
  * **(b) A regression:** a caller gets a different return value, error, store call or warning for input it could really produce. Fix it.
  * **(c) Accepted fuzz.** Only these qualify. List each with a one-line reason.
    1. An error message's wording, with the same error class.
    2. Console-log wording.
    3. Input no caller produces, where old and new have the same outcome and make the same store calls.

    **These are never (c):**
    * any returned field's value or presence, for input callers produce;
    * loop and session grouping and ordering;
    * status and terminal classification (`agentState`, `stage`, `terminalStatus`, a Session's `completedAt`);
    * timestamps;
    * store calls and their arguments, including the self-heal write-back;
    * the warn-once behaviour, pinned by the LIN-2232 tests in `tests/unit/pipeline-loops.test.js`: once per cause per process, and none for `wake` rows;
    * input mutation.

    Where unsure, it's (b).
  * **(d) Unclear and material:** raise a `DECISION:` and stop.
* **Tests.** If there is at least one class-(a) fix, add tests for them in a new file, `tests/unit/pipeline-loops-pins.test.js`, one per fix. Any server it starts binds `127.0.0.1` (LIN-2023). Don't edit existing test files. The full unit suite, the hermetic run (`test:hermetic`), e2e and CI must be green.
* **Scope.** Change only `lib/pipeline-loops.js`, the optional helper module and the new test file. Every caller stays unchanged. No new mechanism in the repository; the replay stays outside it.
* **No live checks, no paid model calls.** Don't call a deployed instance, a production or shared database, OpenRouter or any other model API. The local test databases the suite starts are fine. The evidence is the replay and the tests.

**Done when.** The rebuilt module is merged as normal, with no second copy, and the PR records:

* the requirements list, with each edge above decided, and the design;
* the replay: the base SHA, the seed, per-export input counts (generated and captured), and a table of behaviour changes, each with its class, its count and one example's before and after;
* no class-(b) or class-(d) rows remaining at merge;
* a short list of behaviours that looked unneeded or dead, reported and not removed;
* line counts and the number of functions before and after, as information only.

**Out of scope.**

* The callers in `lib/`, `routes/`, `server.js` and `scripts/`.
* The imported modules, especially `lib/digest-feedback.js` and `lib/session-telemetry.js`.
* The stores.
* Changing the export or `__internal` surface.

**References.**

* LIN-3573 (rung 4), LIN-3569 (rung 3) and LIN-3566 (rung 2), the same method.
* `tests/unit/pipeline-loops.test.js`, `tests/unit/pipeline-sessions.test.js` and `tests/unit/lin-3384-redaction-census.test.js`.
* The parent, LIN-3549.
