TITLE: Rebuild the KPI statistics collector (lib/kpi-stats.js) design-first: same results, same privacy boundary, cleaner code, checked by a replay against today's module

PARENT: LIN-3549 · PROJECT: Quality, Periodicals & Measurement · PRIORITY: High · STATE: Todo

**Goal.** Rebuild `lib/kpi-stats.js` as a whole, in one change, keeping its file name, its 9 exports and the modules it imports from (`dispatch-terminal`, `terminal-marked-task-cost`, `weekly-budget`, `session-telemetry`, `dispatch-lineage`, `report-history-store`, `read-horizon`, `milestone-funnel`, `utils/time`), plus the optional helper below and no other new import.
* Constants: `ACTIVITY_WINDOW_DAYS` (30), `HOURLY_WINDOW_HOURS` (24), `FREE_TIER_WINDOW_DAYS` (7), `OUTCOME_WINDOW_WEEKS` (4) and `PROXY_PHASES` (the same five, in order).
* Functions: `categorizeProxyEvent`, `loadDispatchHistory`, `collectKpiStats`.
* `__internal = { FRESH_DIGEST }`, deep-equal to today's expression.

Every export gives its callers the same results as today, apart from the class-(a) fixes and class-(c) fuzz listed in the PR, and the code is cleaner. Merge as normal. Success is John's: "what we end up with matches the utility of what came before, but the code is _cleaner_ (cognitively simpler, less room for bugs, easy to maintain)."

**Why.** This is the next rung of John's rebuild experiments, a ladder in which each rung is a little larger, as John proposed. John asked to complete the current list of targets. Rungs 2–5 (LIN-3566, LIN-3569, LIN-3573, LIN-3578 and LIN-3579) were rebuilt this way, design first and then a replay against the old behaviour, and all merged. This module is the privacy boundary of the public `/kpis` page; per CLAUDE.md it returns only counts and app-defined labels, never workspace keys or content.

What John has said that applies:
* On behaviour changes: "sure, we can fix bugs".
* On a rebuild that turns out to have dropped something: "No harm in retrospectivly finding missing functionality and either improving tests and trying again, or some other solution."
* On whether everything is needed: "Worth nothing also if it's all behaviour we actually need."
* His note for the experiments: "no need to be so strict on edge cases as we experiment. Bugs should be fixed, but we want it to improve,so there's going to be fuzz."

Class (c) below is this ticket's bounded form of that note for a public page's data. The classes, the canary check and the source-text rule below are the ticket's own, not John's.

**Decision.**

**This is one PR. Don't split it into child tickets.**

* **Work design-first, in this order.**
  1. **Requirements.** Write the module's contract into the PR description as one requirements list. For each export, give its signature with defaults, inputs, outputs (for `collectKpiStats`, every block with its keys, windows, rounding and list order), errors thrown or rejected, and side effects: store calls with arguments, console output, and clock reads. Take it from:
     * the file's docblocks and comments;
     * `server.js` (`refreshKpiStats`), `scripts/lin3014/capture-kpis.mjs` and the renderer `lib/render-kpis.js`;
     * the unit tests that use it (`kpi-stats`, `digest-feedback`, `lin3014-capture-kpis`, `lifetime-retention-contract-drift`, `mongo-smoke`) and the e2e spec `kpis`;
     * its entry in `docs/architecture/source-map.md`.

     Decide each of these edges explicitly: keep it, or list it as a class-(a) fix with its reason.
     * An aggregation failure logs, then rethrows (LIN-3002): `console.error` for proxy events, `console.warn` for dispatch history.
     * `categorizeProxyEvent` matches untrimmed prefixes (`/api/proxy/dispatchx` is dispatch) and reads a non-string method as `GET`; top endpoints are trimmed.
     * A blank kind is skipped in `dispatchKinds` but counted as `other` in `dispatchByDay`, where a real top-5 kind named `other` can sit beside the overflow `other` series.
     * `readsPerWrite` counts every proxy bin in the read horizon, not only the day window; `busiestDay` keeps the first maximum; the queue→take median skips rows taken before dispatch.
     * Two 30-day windows: the `· 30d` cutoff is midnight UTC of the first activity day (LIN-1846); the outcome window is rolling `now − 30 d`.
     * `stepOutcomes` uses `Object.hasOwn` (`'constructor'` and `'other'` go to `other`); proxy status goes through `Number()` (`'200'` is ok, `'abc'` skipped).
     * On the aggregate path a non-array `feedback` or a string `timestamp` makes Mongo and MangoDB throw, so the collect rejects; the find path tolerates both.
     * `loadProxyBins`' no-`since` arms and `$group`-result defaults are unreachable with a Mongo-faithful store; dropping them changes no behaviour (list what you drop). `loadDispatchHistory` without `since` is unbounded; `digest-feedback` and `mongo-smoke` call it so.
  2. **Design.** Write the design into the PR description, from that list: the simplest structure that serves every export, with its data flow, its functions and their single responsibilities. Where code paths share logic (day and hour bucketing, top-list ranking, the derived `$project` fields), say it once. Don't follow the old functions' structure. If part of the current design is genuinely the simplest, say why.
  3. **Build.** Write the new module from the design, replacing the file as a whole. Don't copy functions or code blocks from the old file; reason comments stay (below).
* **Store calls stay as today.** The same calls on the `collections` handles (one each, two on `localIssues`), in one `Promise.all`; the milestone funnel reads only through `milestoneFunnelDeps`. Build pipelines, filters and projections however is simplest, but they must deep-equal today's (`kpi-stats.test.js` checks them). Read each `aggregate` result with `.toArray()`; e2e `kpis` injects its failure there (`/test/kpis-fail-next-aggregate`) and expects the rejection to reach `server.js`.
* **Source-text tests.** Satisfy them as written:
  * **`lifetime-retention-contract-drift`** reads the file as text, comments included: it must match `/activity in the 30-day read window/` (the `workspacesBasis` string) and not `/≤30d-TTL|30-day history retention|with retained activity/`.
  * **`lin3014-capture-kpis`** keeps the last read per collection name and needs `dispatchHistory` by `aggregate` with a `$project` whose `feedbackCount.$cond` is an array, `proxyEvents` by `aggregate` and `reportHistory` by `find({})`.
  * **The scanners over all of `lib/`** must still pass with the new file and any helper. Name no receiver `historyCollection`, `dispatchStore` or `dispatchQueueStore`; `lin-3384-redaction-census` counts those.
* **An optional helper module** goes in `lib/`, only if the design needs one, imported only by `lib/kpi-stats.js`. Leave `scripts/code-shape/areas.json` (a guide no test enforces) and `docs/architecture/source-map.md` unchanged.
* **Check against today's module, outside the repository.** Record your branch's base SHA. Copy that base's `lib/kpi-stats.js` into a temporary folder outside the repository as a `.mjs` file, with relative imports rewritten to absolute paths into your checkout. Do the same for the new file, with the helper copied beside it. Write a throwaway replay:
  * **Setup.** Set `TZ=UTC`. Freeze the clock, so `Date.now()` and `new Date()` return one instant, with `instanceof Date` still true, and also pass explicit `now` values. The module reads no env and keeps no state; add none. Block outbound network; there should be none.
  * **Stores.** Use `@jkershaw/mangodb` collections in a temporary folder, so the pipelines really run, and a copy of `kpi-stats.test.js`'s `createMockCollection` (no `aggregate()`) for the find path. Inject failures on each read: rejections at `toArray`, sync throws, a rejecting milestone-funnel dep.
  * **Privacy canaries.** Put a unique canary in every non-label input string: urlKeys, `_id`s, account and other ids, emails, tokens, prompt, title, summary, report and feedback text (beside any marker it needs), issue identifiers, usage `model` and `harness`. Labels (`kind`, `endpoint`, `method`, `dbBackend`, the milestone funnel's `rung` and `surfaces`), statuses, dates and numbers carry none. For every `collectKpiStats` result, on both sides, record a finding when any output key or value contains a canary, or an output string that is not a label, a date or the module's own word (phase or bucket name) equals an input string (for captured test calls, any string a store returned). The replay fails on any new-side finding.
  * **Inputs.** Feed about 1,000 seeded generated inputs to each of `collectKpiStats` and `loadDispatchHistory`, a few hundred to `categorizeProxyEvent`, plus the calls captured from the existing unit tests. Capture them under a preload that records each call into the module, with its arguments and store responses, and check that the old side reproduces what each test saw. Cover window edges (midnight ±1 ms, `now − 30 d`, week starts), abort harvest and `[skipped]` lineages, fresh, stale, legacy and missing digests, proxy status classes, top-list ties and cuts past 8 and 5, mixed timestamp types, session and free-tier edges, and an empty instance. Record the seed and the per-export counts.
  * **Comparison, per input:** the outcome (return, throw, resolve or reject); the error class and message; the return value, deep, with key order ignored and `undefined`-valued keys distinct from absent ones; every console call; every store call with its arguments; any mutation of inputs or store results; unhandled rejections; and privacy findings. Key order is information.
* **Classify each difference,** by behaviour change:
  * **(a) A fix:** today's behaviour is wrong by its own comments, by `docs/` or by a test, and the new one isn't. Keep each fix and list it.
  * A fix that fails an existing test is not (a): keep today's behaviour and list it as looking wrong.
  * **(b) A regression:** a caller gets a different return value, error, store call or log for input it could really produce. Fix it.
  * **(c) Accepted fuzz.** Only these qualify. List each with a one-line reason.
    1. An error message's wording, with the same error class.
    2. Console-log wording, with the same console method.
    3. Input no caller produces, where old and new have the same outcome and make the same store calls.

    **These are never (c):**
    * any output carrying a non-label input string, as key or value (the privacy boundary): a new finding is (b) on any input;
    * any returned field's value or presence, for input callers produce;
    * counts, ratios and their rounding, window boundaries, day and hour keys, and top-list order and tie-breaks;
    * store calls and their arguments;
    * errors propagating, and which console method fires before a rethrow;
    * input and store-result mutation.

    Where unsure whether a difference is (c), it's (b). Use (d) only when no comment, doc or test settles the right behaviour.
  * **(d) Unclear and material:** raise a `DECISION:` and stop.
* **Tests.** If there is at least one class-(a) fix, add tests for them in a new file, `tests/unit/kpi-stats-pins.test.js`, one per fix. Any server it starts binds `127.0.0.1` (LIN-2023). Keep any canaries plain words so the CI secret scan (LIN-2573) passes. Don't edit existing test files. CI (unit, including `mongo-smoke` on a real `mongod`, which skips locally, and e2e) must be green.
* **Scope.** Change only `lib/kpi-stats.js`, the optional helper module and the new test file. Every caller stays unchanged. No new mechanism in the repository; the replay stays outside it. Never pass a `repo` override when dispatching workers.
* **Keep the operator's laptop usable.** Don't start parallel forks or background sub-agents; do the parts one at a time (a reboot loses forks and the failsafe can't revive them). While iterating, run the unit tests for the files you change; run the full unit suite once before opening the PR. Leave e2e to CI; run it locally only to reproduce a CI failure. Your replay: about 1,000 seeded inputs per heavy export plus the test-captured calls, one seed, no coverage; a separate independent replay checks the merged result.
* **Keep the reasons.** Keep every existing ticket reference and every reason comment beside the code it governs; drop one only if its code is gone, and list those in the PR.
* **No live checks, no paid model calls.** Don't call a deployed instance, a production or shared database, OpenRouter or any other model API. The local test databases the suite starts are fine. The evidence is the replay and the tests.

**Done when.** The rebuilt module is merged as normal, with no second copy, and the PR records:

* the requirements list, with each edge above decided, and the design;
* the replay: the base SHA, the seed, per-export input counts (generated and captured), the canary count and zero new-side privacy findings, and a table of behaviour changes, each with its class, its count and one example's before and after;
* no class-(b) or class-(d) rows remaining at merge;
* a short list of behaviours that looked unneeded or dead, reported and not removed;
* line counts and the number of functions before and after, as information only.

**Out of scope.**

* The callers: `server.js`, `lib/render-kpis.js`, `scripts/lin3014/`.
* The imported modules.
* The collections and stores.
* Changing the export surface.

**References.**

* LIN-3578, LIN-3579 and the earlier rungs above, the same method.
* `tests/unit/kpi-stats.test.js` (its privacy tests) and `tests/unit/lifetime-retention-contract-drift.test.js`.
* The parent, LIN-3549.
