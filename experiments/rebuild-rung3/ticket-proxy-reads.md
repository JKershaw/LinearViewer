TITLE: Rebuild the Agent API's read routes (routes/proxy-reads.js) design-first: same responses for agents, cleaner code, checked by a replay against today's router

PARENT: LIN-3549 · PROJECT: Quality, Periodicals & Measurement · PRIORITY: High · STATE: Todo

**Goal.** Rebuild `routes/proxy-reads.js` as a whole, keeping its one export, `createReadRoutes(deps)`, and the dependencies it takes. Every endpoint answers agents as today, apart from the class-(a) fixes and class-(c) fuzz listed in the PR, and the code that does it is cleaner. Merge as normal. Success is John's: "what we end up with matches the utility of what came before, but the code is _cleaner_ (cognitively simpler, less room for bugs, easy to maintain)."

**Why.** This is the third rung of John's rebuild experiments, a ladder of increasing size. The first rung was the Jira codec, the second the roadmap page renderer (LIN-3566), which was rebuilt the same way: design first, then a replay against the old output. This rung moves to an HTTP boundary, one sub-router of the Agent API. John on behaviour changes: "sure, we can fix bugs". John's note for the experiments: "no need to be so strict on edge cases as we experiment. Bugs should be fixed, but we want it to improve,so there's going to be fuzz." Class (c) below is the bounded form of that for a live agent API. It does not reach success paths, security decisions or logging.

**Decision.**

* **Work design-first, in this order.**
  1. **Requirements.** Write the endpoints' contract into the PR description as a requirements list: for each route, its path and aliases, auth, query parameters, provider calls, response shape, error statuses and logged events. Take it from:
     * the handlers themselves (the file's header comment is stale and omits `/credential-trail`);
     * `routes/proxy.js`, which mounts the router and builds its dependencies;
     * the read-route sections of `docs/proxy-integration.md`;
     * the `/api/proxy/instructions` catalog (`lib/proxy-instructions.js`);
     * the tests that call or read the file.

     Several tests read `routes/proxy-reads.js` as source text and pin literals. Treat those pins as requirements:
     * `proxy-provider-error-attribution`;
     * `proxy-relations-query`;
     * `trashed-signal`;
     * `workspace-accesstoken-linear-egress-census`;
     * the two witness tests below.
  2. **Design.** Write the design into the PR description, from that list: the simplest structure that serves the routes, with its data flow, its functions and their single responsibilities. Look for what the handlers share and say it once. Don't name or follow the old file's functions or structure; if part of the current design is genuinely the simplest, say why. Keep using the same `lib/` modules and the same dependency object.
  3. **Build.** Write the new router from the design, replacing the file as a whole. Don't copy handlers or blocks from the old file. Keep the reasons a reader needs, with their ticket references, beside the code they govern.
* **Check against today's router, outside the repository.** Record your branch's base SHA. Copy that base's `routes/proxy-reads.js` into a temporary folder outside the repository as a `.mjs` file, with its relative imports rewritten to absolute paths into your checkout. Write a throwaway replay. Before mounting, call `installAsyncErrorForwarding()` (`lib/async-errors.js`) and add `server.js`'s final four-argument error handler, as production does. Model the fakes on `tests/unit/lib/proxy-fake-deps.js`. Stub global `fetch`, and record every outbound attachment fetch: URL, method, headers and redirect option. The replay:
  * mounts the old and new routers on two Express apps bound to `127.0.0.1`, with identical fake dependencies modelled on the real ones in `routes/proxy.js`. The fakes vary the authenticated token, return seeded provider data, sometimes throw provider, GraphQL, not-found and team-membership errors, and record every provider call, `logEvent` call and event-store call;
  * sends the same seeded sequence of at least 2,000 requests to both, across every route and alias: valid, invalid and malformed ids; every query parameter each handler reads, with edge values; empty, large, trashed and odd provider data; and each error shape. Record the seed;
  * compares, per request: the status; the JSON body (key order ignored); the headers the handler sets itself (`Content-Type`, `Content-Disposition`, `X-Content-Type-Options`, `Cache-Control`; ignore `ETag`, `Content-Length` and `Date`); and the recorded provider calls, logged events, event-store calls and outbound fetches.
* **Classify each difference,** by behaviour change, not request by request:
  * **(a) A fix:** today's behaviour is wrong by its own comments, by `docs/proxy-integration.md` or by a test, or it 500s where the other read routes return a mapped status, and the new one isn't. Keep it, and list it. One known example: on `/api/proxy/attachments/:id`, both the `att:` and `md:` branches call `resolveProviderAccess` outside any `try`. When it rejects, `server.js`'s global handler sends a generic 500 with no `logEvent` call and no mapped status, unlike every other read route.
  * **(b) A regression:** an agent gets a different status, body, or provider effect for a request it could really make. Fix it.
  * **(c) Accepted fuzz.** Only these qualify. List each with a one-line reason; no need to stop.
    1. An error message's wording, with the same status, code and logged status.
    2. Input no documented use produces (a repeated or wrong-typed query parameter, an id that fails the route's own validator, a malformed attachment handle), where old and new return the same status and make the same provider, event-store and outbound-fetch calls.

    **These are never (c), whatever the input:**
    * a 2xx status or body;
    * which provider or event-store method is called, or its arguments;
    * the endpoint string and status passed to `logEvent` (agents see them through `/credential-trail`);
    * the attachment relay's host allow or deny decisions, its outbound `Authorization` header, its safe-download headers, and its size cap;
    * team scoping and `TEAM_NOT_FOUND`;
    * trashed signalling.

    Where unsure, it's (b).
  * **(d) Unclear and material:** raise a `DECISION:` and stop.
* **Tests.** Don't touch existing test files. Add new tests only in a new file, `tests/unit/proxy-reads-pins.test.js`, one per class-(a) fix. The full unit suite, the hermetic run, e2e and CI must be green. `tests/unit/proxy-endpoint-inventory-witness.test.js` and `tests/unit/proxy-di-witness.test.js` must stay green. They read source text, so keep the single-line destructured `export function createReadRoutes({ … })` with the same 8 names, and keep one literal `router.get(` per route, with the two aliases as array-literal paths. A route table or a loop registrar will fail them. If a source-text pin blocks the simplest design, raise a `DECISION:` rather than editing the test.
* **Scope.** Change only `routes/proxy-reads.js` and that one new test file. `routes/proxy.js` keeps calling `createReadRoutes` unchanged. No new mechanism in the repository; the replay stays outside it.
* **No live checks.** Don't call a deployed instance; the evidence is the replay and the tests.

**Done when.** The rebuilt router is merged as normal, with no second copy, and the PR records:

* the requirements list and the design;
* the replay: the base SHA, the seed, request counts per route, and a table of behaviour changes, each with its class, its count and one example's before and after;
* no class-(b) or class-(d) rows remaining at merge;
* line counts and the number of functions (counting those inside `createReadRoutes`) before and after, as information only.

**Out of scope.**

* The other proxy route files.
* `routes/proxy.js`.
* The providers.
* Changing the dependency object.

**References.**

* `routes/proxy.js`.
* `docs/proxy-integration.md`.
* LIN-3566 (rung 2, the same method).
* The parent, LIN-3549.
