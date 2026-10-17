TITLE: Rebuild the dispatch factory and validation (lib/dispatch-factory.js, lib/dispatch-validation.js) design-first: same results for callers, cleaner code, checked by a replay against today's modules

PARENT: LIN-3549 · PROJECT: Quality, Periodicals & Measurement · PRIORITY: High · STATE: Todo

**Goal.** Rebuild `lib/dispatch-factory.js` and `lib/dispatch-validation.js` together, in one change, keeping their file names, their exports with today's values, and the modules they import from, plus the optional helper below and no other new import.
* Factory: `createDispatchItem`, `isFilePointerPilotEnabled`, `FILE_POINTER_PILOT_ENV`, `DUPLICATE_DISPATCH_WINDOW_MS`, `MAX_FRESH_SESSIONS_PER_TASK` and the seven `*_CODE` constants.
* Validation: `validateOpaqueDispatchField`, `validateSessionId`, `validateDispatchPayload`, the eight entrance helpers (`abortFollowUpError` to `followUpToError`), the five `MAX_*` lengths, three non-global regexes, `RESERVED_SESSION_ID` and `DISPATCH_EFFORT_LEVELS`.

Every export gives its callers the same results as today, apart from the class-(a) fixes and class-(c) fuzz listed in the PR, and the code is cleaner. Merge as normal. Success is John's: "what we end up with matches the utility of what came before, but the code is _cleaner_ (cognitively simpler, less room for bugs, easy to maintain)."

**Why.** This is the next rung of John's rebuild experiments, a ladder in which each rung is a little larger, as John proposed. `docs/papers/harbour/rebuild-ladder.md` records a pause before the next rung; John resumed the ladder on 16 October. Rungs 2–4 (LIN-3566, the roadmap renderer; LIN-3569, the Agent API read routes; LIN-3573, the Agent API write and rulings routes) were rebuilt this way, design first and then a replay against the old behaviour, and all merged. This rung takes the factory and validation, not the dispatch-core routes the paper names as rung 5; the round was chosen from a later scan of every module.

What John has said that applies:
* On behaviour changes: "sure, we can fix bugs".
* On a rebuild that turns out to have dropped something: "No harm in retrospectivly finding missing functionality and either improving tests and trying again, or some other solution."
* On whether everything is needed: "Worth nothing also if it's all behaviour we actually need."
* His note for the experiments: "no need to be so strict on edge cases as we experiment. Bugs should be fixed, but we want it to improve,so there's going to be fuzz."

Class (c) below is this ticket's bounded form of that note for the dispatch path. The classes, and the source-text rule below, are the ticket's own, not John's.

**Decision.**

**This is one PR. Don't split it into child tickets.**

* **Work design-first, in this order.**
  1. **Requirements.** Write both modules' contract into the PR description as one requirements list: each export's signature with defaults (`createDispatchItem` has 28 parameters), inputs, outputs, errors with tags and `status`, and side effects (store and closure calls with arguments and order, console output, module state, clock and env reads), plus `createDispatchItem`'s step order and `addItem` keys and `validateDispatchPayload`'s first-error order. Take it from:
     * the files' docblocks and comments;
     * their callers in `lib/`, `routes/` and `server.js`, and `lib/dispatch-refusal.js`;
     * the 16 unit-test files that import them, the route tests and the e2e specs;
     * `docs/proxy-integration.md`.

     Decide each of these edges explicitly: keep it, or list it as a class-(a) fix with its reason. For store failures both choices are pre-decided: keep today's split, or make a sync throw act as a rejection and a plain return as its value at every read, listed as (a). Never change a read's direction (open, closed, 409 or 503).
     * Store failures: `findRecentFreshDispatch` fails open on a sync throw or rejection; the `getItemStatus` reads, `countDistinctTasksForSession` and `dispatchPresetsStore.get` null a rejection but reject on a sync throw, the last two also on a plain return (`TypeError`); the workspace-preferences read (`resolveDispatchDefaults`, in `lib/workspace-preferences.js`) propagates a rejection or sync throw from `getWorkspacePreferences` and throws a `TypeError` on a `null` result, each a 500 at the routes; `runGate` fails closed. `listTokens` (read through `getConsumerLastSeenAt` in `lib/consumer-poll-warning.js`, out of scope; only the factory's handling of a throw from `getConsumerLastSeenAt` may change) counts a rejection as no tokens, but a sync throw or plain return (`TypeError`) rejects `createDispatchItem`, after the mint.
     * The duplicate guard refuses on any prior whose `dispatchedAt` parses, with no window check of its own: `null` (1970) refuses with `retryAfter: 1`, though the comment says an unreadable instant does not refuse.
     * The composed-run guard's 60s cache is process-wide, keyed `urlKey::issueIdentifier`, unless one is injected.
     * The returned item is the store's own object, given `budgetPosition` under a declared budget (a `TypeError` if frozen or `null`).
     * The `[file-pointer]` log times its gap with the real `Date.now`, not `now`.
     * A `limit` result without `limit` says `N of undefined today`; without a valid `resetsAt`, `retryAfter` is `NaN`.
     * A function in an autopilot preset's config makes `structuredClone` throw `DataCloneError`.
     * `validateDispatchPayload` calls `console.warn` on an unknown `effort`.
  2. **Design.** Write the design into the PR description, from that list: the simplest structure that serves every export, with its data flow, its functions and their single responsibilities. Where code paths share logic (guard gates, refusals, routing passes, field checks), say it once. Don't follow the old functions' structure, except where the census below pins it. If part of the current design is genuinely the simplest, say why. Design rule: module state (the composed-run cache) stays in the factory file, never the helper.
  3. **Build.** Write the new modules from the design, replacing both files as a whole. Don't copy functions or blocks from the old files. Keep the reasons a reader needs, with their ticket references (LIN-1656, LIN-3138 and others), beside the code they govern.
* **Source-text tests.** None is convertible here; satisfy them as written.
  * **`lin-3384-redaction-census`** is a safety check on every read that can reach a live bootstrap token, so it is never converted. It scans `lib/` and `routes/` for store reads, skipping comment lines. It keys each site by the nearest line at or above the read's own line that looks like a function header (a `function` declaration, `const name = (`, a two-space-indented `name(…) {`), not by the function that really encloses it. Its table allows exactly three keys in the factory: `run`, 1 call, and `anchor`, 1 (the `getItemStatus` reads under `const run = (` and `const anchor = (`), and `defaultFetchPilotPrFiles`, 2 (`listHistory`, `listItems`). Keep those headers nearest above their reads and add no site; a shared read function or a helper's read is an unlisted row.
  * **`lin-3134-declared-mint-census`** masks comments and strings, then requires exactly one `.addItem(` in the factory, keyed `createDispatchItem` (no function declaration or indented `name(…) {` line between that header and the call), and one other `addItem` reference (the `typeof` guard). It confines `grantDeclaration`, `grantRefusal` and `declaredGrants` to five modules, the factory among them, comments included.
  * **`lin-3130-create-dispatch-item-proxy-token-store-pin`** blanks comments but not strings, skips text preceded by `function`, and counts exactly 10 `createDispatchItem(` calls across `lib/` and `routes/`, all in seven caller files (3 in `routes/proxy-dispatch.js`). So keep `export async function createDispatchItem({`, write no other `createDispatchItem(` outside comments, even in a string, and leave the callers unchanged.
  * **`lin-3383-runner-enqueue-census`** exempts the factory by name, not a helper: a non-comment `createDispatchItem(`, `.addItem(` or other sink there is unlisted.
  * **`lin-3124-pr3-checkpoint-c2`:** the factory never contains `req.session`. **`passage-runner-contract-drift`:** for `DUPLICATE_DISPATCH_CODE = 'DUPLICATE_DISPATCH'`, define it, single-quoted, in the factory file itself, not re-exported from the helper; every quoted `'DUPLICATE…'` literal there equals it.
  * **The other scanners over all of `lib/`** (`lin-3382-urlkey-class-guard`, `urlkey-holders` and others) must still pass with the new files and any helper.
* **An optional helper module** goes in `lib/`, only if the design needs one, imported only by the two files. For the helper and `dispatch-validation.js`: no store-read or sink name followed by `(`, and no `addItem`, even in a string or trailing comment; no grant token anywhere. No test requires registering it; leave `scripts/code-shape/areas.json` and `docs/architecture/source-map.md` unchanged.
* **Check against today's modules, outside the repository.** Record your branch's base SHA. Copy that base's two files into one subfolder of a temporary folder outside the repository as `.mjs` files, with relative imports rewritten to absolute paths into your checkout; do the same for the new files and any helper in a second subfolder. In each side's own subfolder, point the factory's validation import and any helper import at the sibling `.mjs` copy. Write a throwaway replay:
  * **Setup.** Freeze `Date.now()` (the pilot log's too) and `new Date()` at one instant, keeping `instanceof Date` true. Clear the env and set `HARBOUR_FILE_POINTER_PILOT` and `HARBOUR_FILE_POINTER_GITHUB_OWNERS` per input. Empty the composed-run cache per input with a fresh module instance per side, or model it (a query string reloads only the main file). Call `clearPrFilesCache()` per input. Stub global `fetch` and block other network; there should be none.
  * **Fakes.** Fake every store and closure the factory takes, recording each call. Inject failures: sync throws and returns, rejections, `null` or malformed results, hangs past short `filePointerTimeouts`, late settles and a frozen or `null` `addItem` result.
  * **Inputs.** Feed at least 3,000 seeded generated inputs each to `createDispatchItem` and `validateDispatchPayload`, plus calls captured from the existing unit tests by a preload that records each call into either module, from any caller, with its arguments and store responses; check the old side reproduces what each test saw. Replay each captured call against fakes that return the recorded store and closure results; never re-invoke a captured closure, store or minter. Cover:
    * every export; each guard admitting, refusing, failing open and closed, and skipped by each gate negative; window and budget bounds; runaway counts 29 and 30; repeated calls; inheritance, routing tiers, presets, grant fields in `fields`; each pilot arm;
    * every cap at and past its bound, each first-error pair, non-strings, symbols, odd bodies, every effort level.

    Record the seed and the per-export counts.
  * **Comparison, per input:** the outcome (return, throw, resolve or reject); the error class, message and own properties; the return value, deep, key order ignored, `undefined`-valued keys distinct from absent; whether the item is the store's own; console calls; store and closure calls with arguments and order; env reads; mutation of inputs or store results; unhandled rejections and leftover timers. Report key order as information.
* **Classify each difference,** by behaviour change:
  * **(a) A fix:** today's behaviour is wrong by its own comments, by `docs/` or by a test, and the new one isn't. Keep each fix and list it.
  * A fix that fails an existing test is not (a): keep today's behaviour and list it as looking wrong.
  * **(b) A regression:** a caller gets a different return value, refusal, error, store call or warning for input it could really produce. Fix it.
  * **(c) Accepted fuzz.** Only these qualify. List each with a one-line reason.
    1. The wording of an error no caller relays (argument errors, a `TypeError` on garbage), with the same class. Refusal and validation messages reach clients, so they aren't.
    2. Console-log wording, except the unknown-effort warning and the `[file-pointer]` JSON, which tests read.
    3. Input no caller produces, where old and new have the same outcome and make the same store calls.

    **These are never (c):**
    * a refusal decision (run and budget gating included), its code, `status`, `retryAfter` and the tags callers branch on;
    * whether `addItem` is called, and its argument's keys and values;
    * any store call and its arguments;
    * validation verdicts, the first error, and the values the factory resolves;
    * minting: `finalizePrompt` once, with the resolved harness, after every guard; the token-store reads;
    * input mutation.

    Where unsure whether a difference is (c), it's (b). Use (d) only when no comment, doc or test settles the right behaviour.
  * **(d) Unclear and material:** raise a `DECISION:` and stop.
* **Tests.** If there is at least one class-(a) fix, add tests for them in a new file, `tests/unit/dispatch-factory-pins.test.js`, one per fix. Any server it starts binds `127.0.0.1` (LIN-2023). Don't edit existing test files. The full unit suite, the hermetic run (`test:hermetic`), e2e and CI must be green.
* **Scope.** Change only the two files, the optional helper module and the new test file. Every caller stays unchanged. No new mechanism in the repository; the replay stays outside it.
* **No live checks, no paid model calls.** Don't call a deployed instance, a production or shared database, OpenRouter or any other model API. The local test databases the suite starts are fine. Run e2e locally only with `MONGODB_URI` set empty (`server.js` loads `.env` even under `NODE_ENV=test`, filling an unset one) and no server already on ports 3001–3003 (Playwright reuses one outside CI), or leave e2e to CI. Never start the app on your own `.env` or enqueue through a running server. The evidence is the replay and the tests.

**Done when.** The rebuilt modules are merged as normal, with no second copy, and the PR records:

* the requirements list, with each edge above decided, and the design;
* the replay: the base SHA, the seed, per-export input counts (generated and captured), and a table of behaviour changes, each with its class, its count and one example's before and after;
* no class-(b) or class-(d) rows remaining at merge;
* a short list of behaviours that looked unneeded or dead, reported and not removed unless the design drops them with identical behaviour (e.g. `valueWithin`'s timer `settled` check, the non-function `fetchPilotPrFiles` branch, the grant strip on inherited issue fields);
* line counts and the number of functions before and after, as information only.

**Out of scope.**

* The callers and `lib/dispatch-refusal.js`.
* The imported modules and the stores.
* Changing the exports.

**References.**

* LIN-3566, LIN-3569 and LIN-3573 (rungs 2–4), and LIN-3578 (in flight, the same method).
* `tests/unit/dispatch-factory.test.js` and `tests/unit/lin-3384-redaction-census.test.js`.
* The parent, LIN-3549.
