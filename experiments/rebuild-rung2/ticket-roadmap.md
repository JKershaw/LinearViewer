TITLE: Rebuild the roadmap page renderer (lib/render-roadmap.js) design-first: same page for users, cleaner code, checked by a replay against today's renderer

PARENT: LIN-3549 · PROJECT: Quality, Periodicals & Measurement · PRIORITY: High · STATE: Todo

**Goal.** Rebuild `lib/render-roadmap.js` as a whole, keeping its one export, `renderRoadmapPage(data, options)`. Users get the same roadmap page, and the code that builds it is cleaner. Merge as normal. Success is John's: "what we end up with matches the utility of what came before, but the code is _cleaner_ (cognitively simpler, less room for bugs, easy to maintain)."

**Why.** This is the second rung of John's rebuild experiments, a ladder of increasing size; the first was the Jira codec, `lib/providers/jira/adf.js`. The approach under test is to design first, before writing any code and without following the old structure, then check the rebuild against the old renderer's output. This ticket runs that on a new, larger module through Harbour. John's position on behaviour changes is "sure, we can fix bugs"; this ticket narrows it to class (a) below.

**Decision.**

* **Work design-first, in this order.**
  1. **Requirements.** Read the module's comments, its tests and what depends on its output. Write the recorded decisions (the comments, with their ticket references) into the PR description as a requirements list. What depends on the output:
     * `tests/unit/roadmap-integration.test.js`, `tests/unit/roadmap-model-override.test.js`, and the roadmap cases in `tests/unit/page-title-primitive.test.js` and `tests/unit/render-team-selector-threading.test.js`;
     * `tests/e2e/roadmap.spec.js`;
     * `public/roadmap.js`, which reads the embedded `window.__ROADMAP_DATA__`, and `public/roadmap.css`.

     `llms.txt` only references the `nav-view-roadmap` link.
  2. **Design.** Write the design into the PR description, from that requirements list and the tests: the simplest structure that produces the page, with its data flow, its functions and their single responsibilities. Don't name or follow the old file's functions or structure. If part of the current design is genuinely the simplest, say why, as the exception. Keep using the shared modules it imports today (`lib/components/*`, `escapeHtml` and the rest), and keep the same set of imports, so the import-boundary tests stay green.
  3. **Build.** Write the new module from the design, replacing the file as a whole. Don't copy functions or blocks from the old file. Keep the reasons a reader needs, with their ticket references, beside the code they govern; the history can go.
* **Check against today's renderer, outside the repository.**
  * Record your branch's base SHA. Copy that base's `lib/render-roadmap.js` into a temporary folder outside the repository as a `.mjs` file. Rewrite its relative imports to absolute paths into your checkout, so that the old and new renderers share the same component modules.
  * Write a throwaway replay script there. It renders the page with both renderers and compares them, with the same pinned conditions for both:
    * a fixed clock covering the renderer and `buildRoadmapModel` (for example, `mock.timers` from `node:test`, or a patched `Date`);
    * `TZ=UTC`;
    * the same environment variables.
  * **Inputs, with a recorded PRNG seed:**
    * The existing tests' calls. Capture them without editing the tests: run those test files under the frozen clock, with an `--import` loader hook outside the repository that swaps `lib/render-roadmap.js` for a shim calling both renderers.
    * At least 2,000 generated inputs built as `server.js` does: generated `projects` and `issues` through `buildRoadmapModel` (from `lib/roadmap.js`), then `renderRoadmapPage({ roadmapModel, organizationName }, options)`.
    * Generated `roadmapModel` objects passed directly, with shapes `buildRoadmapModel` doesn't produce but the renderer handles: `criticalPaths` as a plain object, missing optional fields, unknown risk severities, odd or missing dates.
  * **Coverage.** Generated cases must cover:
    * empty and large projects, every issue state, and issues with no project;
    * shipped work at ages 7, 14 and 90 days and either side, and a week bucket big enough to overflow;
    * blocking chains and a cycle;
    * HTML-special characters in every string;
    * narrative and chat present or absent, each feature flag, teams with and without a matching selected team, several workspaces, and models with and without numeric pricing.
  * **Comparison.** Collapse each run of whitespace to one space outside `<pre>`, `<textarea>` and `<script>`, then compare exactly. Don't delete whitespace between tags; a space against no space is a difference. Parse and deep-compare the embedded `__ROADMAP_DATA__` JSON.
* **Classify every difference,** by behaviour change, not input by input:
  * **(a) A fix:** today's page is wrong by its own comments or tests, or shows broken markup, and the new one isn't. Keep it and list it.
  * **(b) A regression:** any difference a user, script, stylesheet or test can observe. That covers visible text, element order, tag or nesting, a link or form target, any attribute (`id`, `class`, `data-*`, `aria-*`, `role`, `hidden`, `open`, `type` and so on), or the content of `__ROADMAP_DATA__`. Where you're unsure whether something observes it, it's (b). Fix it with the smallest change where the defect is.
  * **(c) Harmless:** only HTML comments, attribute order, JSON key order, or whitespace that collapses in rendering. State the reason for each.
  * **(d) Unclear:** raise a `DECISION:` and stop.
* **Tests.** Don't touch existing test files. Add new tests only in a new file, `tests/unit/roadmap-render-pins.test.js`: one per distinct class-(a) change or fixed regression, pinning the corrected output. The full unit suite, e2e and CI must be green.
* **Scope.** Change only `lib/render-roadmap.js` and that one new test file. The call in `server.js` keeps working unchanged. No new mechanism in the repository; the replay stays outside it.

**Done when.** The rebuilt renderer is merged as normal, with no second copy, and the PR records:

* the requirements list and the design;
* the replay:
  * the base SHA, the seed, and the input counts by source;
  * a table of behaviour changes, each with its class, the number of inputs that show it, and one example's before and after;
  * no (b) or (d) rows remaining at merge;
* each regression fixed, and its commit;
* line counts and the number of top-level functions before and after, as information, not as a gate.

**Out of scope.**

* `buildRoadmapModel` and anything else that computes the roadmap's data.
* The shared components.
* Other pages.
* The roadmap's routes and API.

**References.** `server.js` (the roadmap route that calls `renderRoadmapPage`, around line 3500). The parent, LIN-3549.
