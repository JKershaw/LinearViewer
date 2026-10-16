TITLE: Rebuild the page renderer cluster (lib/render.js, lib/render-session.js, lib/render-swipe.js, lib/render-settings.js) design-first: same pages for users, cleaner code, checked by a replay against today's renderers

PARENT: LIN-3549 · PROJECT: Quality, Periodicals & Measurement · PRIORITY: High · STATE: Todo

**Goal.** Rebuild the four page renderers in one change: `lib/render.js` (Home), `lib/render-session.js` (the run page), `lib/render-swipe.js` (Swipe and its ordering pipeline) and `lib/render-settings.js` (Settings). Keep the file names and every export:
* `render.js`: `renderPage`, `renderDetailsContent`, `renderDisplayLabels`, `formatRelativeTime`, `priorityOptionsHtml`, `PRIORITY_OPTION_LABELS`, and the re-exports of `lib/render-pages.js`'s `renderLoginPage`, `renderErrorPage`, `renderUpstreamAwareErrorPage`, `renderWorkspaceNotFoundPage` and `renderOpenRouterConsentPage`, which stay the same function objects.
* `render-session.js`: `renderSessionPage` and `renderPrLine`.
* `render-swipe.js`: `renderSwipePage`, `orderIssuesForSwipe`, `flattenTrees`, `isBoostableBug`, `sortIssuesForSwipe`, `computeOffPageBlockers`, `buildWhy`, `applyBlockingOrder`, `clusterByParent`, `buildFilterGroups`, and the re-export `computeGraphFeatures` (the same function object as `lib/graph-features.js`'s).
* `render-settings.js`: `renderSettingsPage`, `OPENROUTER_CONSENT_BLAST_RADIUS_COPY` (the same string; `render-pages.js` imports it) and `AI_OPERATION_LABELS` (one entry per `AI_OPERATION_KINDS` element).

Import only from modules each file imports today (dropping one is fine, except `render-settings.js`'s provider barrel), plus the optional helpers below. `render-settings.js` keeps importing `getAllProviders` from the barrel `./providers/index.js`, whose import order is the Settings "add source" row order (linear, github, github-projects, jira; never local; LIN-2010), so don't sort the registry.

Every export gives its callers the same pages and results as today, apart from the class-(a) fixes and class-(c) fuzz listed in the PR, and the code is cleaner. Merge as normal. Success is John's: "what we end up with matches the utility of what came before, but the code is _cleaner_ (cognitively simpler, less room for bugs, easy to maintain)."

**Why.** This is the next rung of John's rebuild experiments, a ladder in which each rung is a little larger, as John proposed. `docs/papers/harbour/rebuild-ladder.md` records a pause before the next rung; John resumed the ladder on 16 October. The paper names the dispatch core as the next rung; this round takes the dispatch factory, this renderer cluster and pipeline-loops first, from a later scan of every module. Rungs 2–4 (LIN-3566, the roadmap renderer; LIN-3569, the Agent API read routes; LIN-3573, the Agent API write and rulings routes) were rebuilt this way, design first and then a replay against the old behaviour, and all merged. This is the largest rung so far: four files and about 2,300 code lines (comments and blanks excluded), about 2.5× rung 4.

What John has said that applies:
* On behaviour changes: "sure, we can fix bugs".
* On a rebuild that turns out to have dropped something: "No harm in retrospectivly finding missing functionality and either improving tests and trying again, or some other solution."
* On whether everything is needed: "Worth nothing also if it's all behaviour we actually need."
* His note for the experiments: "no need to be so strict on edge cases as we experiment. Bugs should be fixed, but we want it to improve,so there's going to be fuzz."

Class (c) below is this ticket's bounded form of that note for pages that users, client scripts and tests read. The classes, the page contract and the source-text rule below are the ticket's own, not John's.

**Decision.**

**This is one PR. Don't split it into child tickets.**

If the PR description would pass GitHub's 65,536-character limit, continue the requirements list and design in PR comments, linked from the description.

* **Work design-first, in this order.**
  1. **Requirements.** Write the cluster's contract into the PR description as one list. For each export, give its signature with defaults, the options it reads, its output (for the swipe pipeline, the card keys and their order), errors thrown, and hidden inputs: the clock, local time, env vars read through shared components, feature flags and input mutation. Take it from:
     * the files' docblocks and comments, and their callers in `server.js`, `routes/` and `lib/`;
     * what reads the output: `public/*.js`, `public/*.css` and `public/llms.txt`;
     * the unit tests that reach these modules, `tests/helpers.js`'s `SELECTORS`, and the e2e specs;
     * their entries in `docs/architecture/source-map.md`.

     Decide each of these edges explicitly: keep it, or list it as a class-(a) fix with its reason.
     * **Raw values.** These are interpolated unescaped today: `issue.id` in `data-id`, `data-parent`, `data-details-for` and `data-desc-id`; `project.id` in `data-project-id`, `data-completed-for`, `data-parent` and `data-desc-id` (the project wrapper's `data-id` is escaped); `project.url` and `issue.url` in `href`; `project.linkText` and `issue.linkText`; `heroHtml`; `render.js`'s `createHref` (the inline "+ Add task" link); and Settings form actions and the `promptsUrl`, `customPromptsUrl` and `auditUrl` links, built with `encodeURIComponent` only. Escaping one is (a) only with a comment, doc or test as the reason, and only if real ids and URLs render byte-identical.
     * `sortIssuesForSwipe` sorts its argument in place and returns it. `lib/task-stack.js`, `lib/roadmap.js` and `lib/render-swim.js` ignore the return, so this stays.
     * `clusterByParent` returns its input array when no card has a parent link, else a new one. `applyBlockingOrder` returns a new array of the same cards. `orderIssuesForSwipe` and `renderSwipePage` stamp fields (`why`, `isSeed` and others) only on cards they build, never on the trees, which `server.js` then passes to `renderPage`.
     * The cards' key order, which is the key order of the embedded `window.__SWIPE_DATA__`.
     * The top-task mark (`data-top-task`, `data-why`) goes once, on the first matching row in page order.
     * `formatDate` (used by `formatRelativeTime` from 7 days on) and the footer format dates in local time.
  2. **Design.** Write the design into the PR description, from that list: the simplest structure that serves every export, with its data flow, its functions and their single responsibilities. Where pages share logic (issue rows and details, shell options, Settings rows), say it once. Don't follow the old functions' structure, except where an export or source-text pin fixes it. If part of the current design is genuinely the simplest, say why.
  3. **Build.** Write the new modules from the design, replacing each file as a whole. Don't copy functions or control flow; markup text may be carried over where byte-identity (the run page, the source-text pins) needs it. Keep the reasons a reader needs, with their ticket references, beside the code they govern.
* **The page contract.** Every `data-*` attribute, `data-testid`, `id` and class token the four renderers emit that `public/*.js`, `public/*.css`, `public/llms.txt` or `tests/` refers to stays on the same elements with the same values. That is about 420 tokens: about 80 `data-*` names, 100 testids, 240 classes and the ids `swipe-card`, `swipe-counter` and `dispatch-presets`. A token counts when its literal (class, testid, id, `data-*` name or its camelCase `dataset` key) appears in those files. About 420 is a guide; report your own count. Only the (c) items are fuzz, so any other attribute, class or id difference is (a) or (b), contract or not. The contract also covers:
  * the nesting `llms.txt` documents (`.node > .line`, `.node > .details`, `.node > .children > .node`, and `role="button" tabindex="0" aria-expanded` on expandable rows);
  * the embedded `window.__SWIPE_DATA__` and `window.__HOME_PROMPT_OPTS__`, the JSON in `data-feedback` and `data-model-catalog`, and the base64 `data-raw-desc`;
  * the form field names the server parses.

  `CLAUDE.md` asks for `llms.txt` to be updated when the DOM changes; this contract doesn't, so `llms.txt` stays as it is.
* **Source-text tests.** None is convertible here; satisfy them as written.
  * **`render.test.js`** (LIN-1973 F2, around line 517) requires in `lib/render.js`, verbatim: a two-space-indented `} else if (isRealProject && ui.write) {`, then exactly the line ``    addTaskLink = `<div class="add-task-link"><a href="${createTaskProvider.getCreateTaskUrl(urlKey, project.id)}" target="_blank" class="detail-link" data-action="create-task">+ Add task</a></div>` ``, with no trailing semicolon, then a line that starts with exactly two spaces and `}` (the regex pins nothing after that `}`).
  * **`lin-3136-copy-surface-census`** scans the non-comment lines (a comment line starts with `//`, `*` or `/*`) of `lib/*.js` and `public/*.js` for `data-proxy-force="true"`, `data-proxy-force="runner"` and `proxyForce: true`. `data-proxy-force="runner"` is listed only in `public/prompt-section.js`, so any such non-comment line in `lib/` must be in `lib/render.js` and contain one of two snippets, each of which must appear: `const proxyForceAttr = proxyForce ? ' data-proxy-force="true"' : ''` and `proxyForce: true` (the periodical "+ Autopilot" container).
  * **`task-page-links`** greps `lib/render.js`, `lib/render-*.js`, `lib/components/*.js` and `public/*.js`. `render.js` and `render-session.js` must each mention `identifier`, `issueIdentifier`, `seedIssue` or `issueTitle`. An `href="…"` naming `identifier`, `issueIdentifier` or `seedIssue` must use `taskPageHref` or be allow-listed, and each entry must still match: here, `render-session.js`'s run-chat link, a line containing `task-chat?task=` whose href names `seedIssue`. The `task-chat?task=` allow-list is for `render-session.js` only. In `render.js`, keep any href that names `identifier` on `taskPageHref` (the `taskPageHref(` call on the same line). A second scan allows `/task/${` only on a `render.js` line containing `/edit` (the task-edit link), which must exist.
  * **`no-page-wide-label-listener`** (around line 235) takes the first array literal of single-quoted `'/….js'` strings in `render-session.js` that lists `'/session.js'`, and requires `'/common.js'` before it.
  * **`render-session-golden`** requires 24 run pages to match `tests/fixtures/render-session-golden.json` byte for byte, and requires `renderPrLine` to reproduce the `sess-pr-state` line of 7 of those entries (open, merged, unknown, none, two 'checking' rows and `pr-line-hostile-ids`). So the run page's bytes, whitespace included, are never (c). Don't regenerate the fixture.
  * **`email-import-boundary`**, over `lib/`, `routes/` and `server.js`: a module in an import cycle imports no email module but `lib/email-availability.js`; only `email-availability.js` and `email-transport.js` may name `EMAIL_TRANSPORT`, `EMAIL_PROMPT_STEP`, `RESEND_API_KEY`, `EMAIL_FROM` or `EMAIL_LINK_ORIGIN`, comments included; and `routes/auth.js` must import `lib/render.js`.
  * **`lin-3125-held-entry`** and **`lin-3124-pr1-count-pins`** (`held-marker-emitters`): exactly four `withHeldMarker(` call sites, one in `render-settings.js` (the "as a new workspace" link), and no `heldConnection=1` literal outside `lib/held-connection-entry.js`.
  * **The scanners over all of `lib/`** must still pass with the new files and any helper: `lin-3382-urlkey-class-guard`, `lin-3383-runner-enqueue-census`, `lin-3384-redaction-census`, `lin-3134-declared-mint-census`, `lin-3130-create-dispatch-item-proxy-token-store-pin`, `proxy-tokens-private-mint-source-pin`, `interactive-openrouter-chain-byte-identity`, `lin-688-undici-not-a-dependency` and `urlkey-holders`.
* **Optional helper modules** go in `lib/`, only if the design needs them, imported only by the four files. The allow-lists above are keyed by file, so the `proxyForce` lines, the run-chat link, the `/edit` link and the `withHeldMarker(` call stay where they are. A helper named `lib/render-*.js` falls inside the `task-page-links` grep. A helper must not name the email env vars or import an email module but `email-availability.js`. No test requires a new `lib/` file to be registered. Leave `scripts/code-shape/areas.json` (a guide no test enforces) and `docs/architecture/source-map.md` unchanged.
* **Check against today's renderers, outside the repository.** Record your branch's base SHA. Copy that base's four files into a temporary folder outside the repository as `.mjs` files, with relative imports rewritten to absolute paths into your checkout, so both sides share the components and the provider registry. Do the same for the new files and any helper. Write a throwaway replay:
  * **Setup.** Set `TZ=UTC`: dates format in local time, and no test sets `TZ`, so the tests assume the UTC CI runs in. Freeze the clock, so `Date.now()` and `new Date()` return one instant, with `instanceof Date` still true (the run page falls back to `Date.now()` without `options.now`). Clear the env and set per input the GitHub, Jira and email vars that the navbar and Settings' Account row read through shared modules. Block outbound network.
  * **Inputs.** Record the seed. Feed:
    * at least 3,000 seeded generated inputs for each heavy export (`renderPage`, `renderDetailsContent`, `renderSwipePage`, the swipe pipeline, `renderSessionPage`, `renderSettingsPage`), fewer for the small ones, with trees built through `lib/tree.js` as `server.js` does;
    * the calls the existing unit tests make, captured without editing them by a loader hook outside the repository;
    * the repository's sample data: `content/landing.md` through the landing pipeline (`renderPage`, `renderSwipePage` and each issue's details, with `isLanding`), and `lib/sample-data/mock-data.js`'s `testMockData` through `server.js`'s tree pipeline.

    Cover every issue state, source and provider kind; nesting, blocking and cycles; each length cut and `formatRelativeTime` threshold, either side; HTML-special characters in every string; every feature flag and `openRouterSource`; run pages in every state; and every Settings option.
  * **Comparison, per input:** the exact HTML; a parsed DOM (tree, attributes, text), with embedded and attribute JSON deep-compared; the contract tokens, reported on their own; for data exports, the return value, order-aware, and whether it aliases an argument; the arguments after the call; and throws, with class and message. Report whitespace-only differences separately, and attribute order as information. Parse with Playwright's Chromium or a parser installed in the temp folder; add nothing to package.json.
* **Classify each difference,** by behaviour change:
  * **(a) A fix:** today's output is wrong by its own comments, by `docs/` or by a test, or is broken markup, and the new one isn't. Keep each fix and list it.
  * A fix that fails an existing test is not (a): keep today's behaviour and list it as looking wrong.
  * **(b) A regression:** a user, client script, stylesheet, caller or test sees a different page or result, for input it could really produce. Fix it.
  * **(c) Accepted fuzz.** Only these qualify. List each with a one-line reason.
    1. Whitespace between tags, outside the run page, where rendering doesn't change. A space appearing or vanishing between inline elements is visible, so it isn't.
    2. Attribute order within a tag.
    3. An error message's wording, with the same error class.
    4. Console wording (the four files log nothing today).
    5. Input no caller produces, where both sides still return a page (or both throw the same class).

    **These are never (c):**
    * any page-contract token or its value;
    * text users see, apart from item 1's whitespace;
    * link and form targets;
    * escaping; any that guards against injection must never get weaker;
    * scripts, stylesheets and their order;
    * embedded JSON and JSON attributes;
    * the run page's bytes;
    * input mutation or returned-array identity that a caller relies on.

    Where unsure, it's (b).
  * **(d) Unclear and material:** raise a `DECISION:` and stop.
* **Tests.** If there is at least one class-(a) fix, add tests for them in a new file, `tests/unit/renderers-pins.test.js`, one per fix. Any server it starts binds `127.0.0.1` (LIN-2023). Don't edit existing test files or fixtures. The full unit suite, the hermetic run (`test:hermetic`), e2e and CI must be green.
* **Scope.** Change only the four files, the optional helpers and the new test file. Every caller, `public/`, the CSS and `llms.txt` stay unchanged. No new mechanism in the repository; the replay stays outside it.
* **No live checks, no paid model calls.** Don't call a deployed instance, a production or shared database, OpenRouter or any other model API. The local test databases the suite starts are fine. The evidence is the replay and the tests.

**Done when.** The rebuilt renderers are merged as normal, with no second copy, and the PR records:

* the requirements list, with each edge above decided, and the design;
* the replay: the base SHA, the seed, per-export input counts by source, and a table of behaviour changes, each with its class, its count and one example's before and after;
* no page-contract differences, and no class-(b) or class-(d) rows, remaining at merge;
* a short list of behaviours that looked unneeded or dead, reported and not removed;
* per-file line counts and the number of functions before and after, as information only.

**Out of scope.**

* The callers in `lib/`, `routes/` and `server.js`.
* The four files' imports, such as `lib/components/*` and `lib/render-pages.js`.
* Changing the export surface or the page contract.

**References.**

* LIN-3573, LIN-3569 and LIN-3566 (rungs 4, 3 and 2), the same method.
* The parent, LIN-3549.
