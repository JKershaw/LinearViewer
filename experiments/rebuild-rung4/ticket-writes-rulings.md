TITLE: Rebuild the Agent API's write and rulings routes (routes/proxy-writes.js, routes/proxy-rulings.js) design-first: same behaviour for agents, cleaner code, checked by a replay against today's routers

PARENT: LIN-3549 · PROJECT: Quality, Periodicals & Measurement · PRIORITY: High · STATE: Todo

**Goal.** Rebuild `routes/proxy-writes.js` and `routes/proxy-rulings.js` as a whole, in one change, keeping their exports (`createProxyWriteRoutes(deps)`, 20 dependencies, and `createRulingsRoutes(deps)`, 10) and the dependencies they take.
* `proxy-writes.js` has 12 route registrations and 13 URL forms. The one alias is `POST /api/proxy/issues/:issueId/comments` = `/api/proxy/comments/:issueId`.
* `proxy-rulings.js` has 3: `GET /api/proxy/rulings`, `POST …/suggest-dismissal` and `POST …/suggest-answer`.

Every endpoint behaves for agents as today, apart from the class-(a) fixes and class-(c) fuzz listed in the PR, and the code is cleaner. Merge as normal. Success is John's: "what we end up with matches the utility of what came before, but the code is _cleaner_ (cognitively simpler, less room for bugs, easy to maintain)."

**Why.** This is the fourth rung of John's rebuild experiments, a ladder of increasing size that John asked to be driven up to large sizes. Rung 2 (LIN-3566, the roadmap renderer) and rung 3 (LIN-3569, the Agent API read routes) were rebuilt this way: design first, then a replay against the old behaviour. This rung is the first to rebuild two files in one change, and the first on a writes-heavy boundary.

What John has said that applies:
* On behaviour changes: "sure, we can fix bugs".
* On a rebuild that turns out to have dropped something: "No harm in retrospectivly finding missing functionality and either improving tests and trying again, or some other solution."
* On whether everything is needed: "Worth nothing also if it's all behaviour we actually need."
* His note for the experiments: "no need to be so strict on edge cases as we experiment. Bugs should be fixed, but we want it to improve,so there's going to be fuzz."

Class (c) below is this ticket's bounded form of that note for a live agent API. The classes, and the source-text rule below, are the ticket's own, not John's.

**Decision.**

* **Work design-first, in this order.**
  1. **Requirements.** Write both routers' contract into the PR description as one requirements list: for each route, its method, path and alias, middleware and its order, body and query parameters, the provider writes and store operations it makes (with arguments), its response shape, error statuses, and logged events. Take it from:
     * the handlers;
     * `routes/proxy.js`, which mounts writes at about line 1335 and rulings at about line 1572 and builds their dependencies;
     * `docs/proxy-integration.md`;
     * the `/api/proxy/instructions` catalog (`lib/proxy-instructions.js`);
     * the tests that call or read the files.
  2. **Design.** Write the design into the PR description, from that list: the simplest structure that serves both routers, with its data flow, its functions and their single responsibilities. Look for what handlers share and say it once. If the two files share nothing worth a shared module, say so and keep them separate; don't invent one. Don't name or follow the old files' functions or structure, except where a source-text test below pins a name. If part of the current design is genuinely the simplest, say why. Keep the same dependency objects, `lib/` modules, and `proxy-rulings.js`'s imports of `enrichLoop` and `isTerminalLoop` from `./dashboard.js`.
  3. **Build.** Write the new routers from the design, replacing both files as a whole. Don't copy handlers or blocks from the old files. Keep the reasons a reader needs, with their ticket references, beside the code they govern.
* **Source-text tests.** Several tests read these files, or every `routes/proxy-*.js`, as text. This ticket deliberately differs from rung 3, which said to raise a `DECISION:` instead: a few pins only lock in the old structure, and those may be converted.
  * **Convertible (only these):** the three write assertions in `tests/unit/trashed-signal.test.js` (a `refuseIfTrashed` function, at least 3 `await refuseIfTrashed(` calls, and at least 3 inline `isTrashed(issue)` blocks), and the DELETE-relation assertion in `tests/unit/proxy-relations-query.test.js`.
    * Converting means editing that one assertion in place, keeping its test name.
    * The replacement is behavioural. For `trashed-signal`, it exercises every route that refuses a trashed target today and asserts 409 and zero provider write calls. For `proxy-relations-query`, it asserts the same validation, capability check and provider call. Drive writes through `buildApp` in `tests/unit/lib/proxy-fake-deps.js`.
    * Show the replacement failing against the new routers with the guard removed, and paste that output into the PR.
    * Never delete, skip or loosen an assertion.
  * **Not convertible; satisfy them as written:**
    * `proxy-endpoint-inventory-witness`: route registration counts. Keep one `router.<verb>(` per route, with the alias as an array literal.
    * `proxy-di-witness`: the `export function create<Name>Routes({` text, and every declared dependency appearing in `routes/proxy.js`'s mount.
    * `rulings-resolution-contract-drift`: keep the `includeResolved` docblock paragraph verbatim, and John's ruling quote in the module docblock.
    * The absence scan in `proxy-rulings-routes.test.js`.
    * `proxy-credential-fingerprint-stamping`: every `resolveProviderAccess(` call passes `req` as its third argument.
    * `lin-3136-enqueue-census` and `lin-2533-agent-status-extraction`.
* **The agents-can't-answer-rulings boundary (LIN-1728).** `routes/proxy-rulings.js` and anything it imports must not import `dispatch-store.js`, call `markDecisionAnswered`, write a `decision-answer` stamp, or touch `agreed`, `agreedAt` or `acceptedAt`. Keep `sessionsFeedCache.keyFor([{ urlKey }], 'proxy-rulings')` and the `sessionsFeedCache.clear(urlKey)` after each propose write (LIN-2755).
* **An optional helper module** goes in `routes/` with a filename that does not start with `proxy-`. The proxy test censuses glob `routes/proxy-*.js` and throw on a file with no factory. Leave `docs/architecture/source-map.md` unchanged unless a test requires it.
* **Check against today's routers, outside the repository.** Record your branch's base SHA. Copy that base's two files into a temporary folder outside the repository as `.mjs` files, with relative imports rewritten to absolute paths into your checkout. Write a throwaway replay:
  * **Setup.** Call `installAsyncErrorForwarding()` (`lib/async-errors.js`), mount `express.json({ limit: '250kb' })` as `server.js` does, and add `server.js`'s final four-argument error handler. Mount the old and new routers on two Express apps bound to `127.0.0.1`.
  * **Fakes.** Give both apps identical recording fakes:
    * model the closures (`graphqlErrorStatus`, `writeRejected`, `refResolutionFailed`, `partialWriteFailed`, `denyIfUnsupported`, the `resolve*Input` functions) on the real ones in `routes/proxy.js`;
    * give each app its own `createDedupeCache()` and `createGenerationTracker()` (`lib/proxy-dedupe.js`). They're singletons in `routes/proxy.js`, and sharing them corrupts the comparison;
    * model rulings stores and loops on `tests/unit/proxy-rulings-routes.test.js`;
    * vary the scope (read, readWrite) and creator in `authenticateProxyToken` and `requireWriteScope`;
    * freeze the clock, or normalise `generatedAt`;
    * stub `fetch` to catch any outbound call; there should be none.
  * **Requests.** Send the same seeded sequence of at least 3,000 requests to both: at least 100 per URL form, with each reachable status and `logEvent` status pair per route hit at least 5 times. Cover:
    * bodies that are valid, invalid, missing fields, wrong types, malformed JSON, over 250kb, or contain unicode, and a few large non-JSON attachment bodies;
    * provider success and each error shape (status errors, not-found, `RefResolutionError`, `PartialWriteError`);
    * repeated comments;
    * rulings with and without loop ids, shelved, dismissed and withdrawn, with `includeResolved` and `issueIdentifier`.

    Record the seed and the per-route counts.
  * **Comparison, per request:** the status; the JSON body (key order ignored); the headers the handler sets itself; and every provider call with its arguments, store and cache operation, `logEvent` call with all its arguments including `skipWitness`, event-store call, `harbourCommentsStore.record` call, and `onTicketWrite` call. `onTicketWrite` fires after the response, so flush a tick before comparing.
* **Classify each difference,** by behaviour change:
  * **(a) A fix:** today's behaviour is wrong by its own comments, by `docs/proxy-integration.md` or by a test, and the new one isn't. For status codes and response bodies, inconsistency with the other routes in the same family also counts. For logging, dedupe or `skipWitness` changes it doesn't: those need a comment, doc or test. Keep each fix and list it.
  * **(b) A regression:** an agent gets a different status, body, write or store effect for a request it could really make. Fix it.
  * **(c) Accepted fuzz.** Only these qualify. List each with a one-line reason.
    1. An error message's wording, with the same status, code and logged status.
    2. Server console-log wording.
    3. Input no documented use produces, where old and new return the same status and make the same provider, store and outbound calls.

    **These are never (c):**
    * a 2xx status or body;
    * any provider write, or its arguments;
    * any store or cache operation;
    * the endpoint string and status passed to `logEvent`;
    * scope decisions and middleware order;
    * comment dedupe;
    * trashed signalling;
    * the `includeResolved` and `issueIdentifier` handling, and the `resolution` shape (`outcome` answered, dismissed or withdrawn; `reason`);
    * the agents-can't-answer-rulings boundary.

    Where unsure, it's (b).
  * **(d) Unclear and material:** raise a `DECISION:` and stop.
* **Tests.** If there is at least one class-(a) fix, add tests for them in a new file, `tests/unit/proxy-writes-rulings-pins.test.js`, one per fix. Bind `127.0.0.1` (LIN-2023). The only edits allowed to existing test files are the conversions above. The full unit suite, the hermetic run, e2e and CI must be green.
* **Scope.** Change only the two route files, the optional helper module, the new test file, and the converted assertions. `routes/proxy.js` keeps calling both factories unchanged. No new mechanism in the repository; the replay stays outside it.
* **No live checks.** Don't call a deployed instance; the evidence is the replay and the tests.

**Done when.** The rebuilt routers are merged as normal, with no second copy, and the PR records:

* the requirements list and the design;
* the replay: the base SHA, the seed, per-route request counts, and a table of behaviour changes, each with its class, its count and one example's before and after;
* each converted assertion: old and new, and the failing output with the guard removed;
* no class-(b) or class-(d) rows remaining at merge;
* a short list of behaviours that looked unneeded or dead, reported and not removed;
* line counts and the number of functions before and after, as information only.

**Out of scope.**

* The other proxy route files.
* `routes/proxy.js`.
* `routes/proxy-tokens-admin.js`, which is security-sensitive and left for its own rung.
* The providers and stores.
* Changing the dependency objects.

**References.**

* LIN-3569 (rung 3) and LIN-3566 (rung 2), the same method.
* `routes/proxy.js`.
* `docs/proxy-integration.md`.
* `tests/unit/proxy-rulings-routes.test.js`.
* The parent, LIN-3549.
