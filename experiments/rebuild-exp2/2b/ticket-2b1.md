TITLE: Make the Jira codec's tests a contract of what users see (lib/providers/jira/adf.js), and fix the links-with-brackets regression

PARENT: LIN-3549 · PROJECT: Quality, Periodicals & Measurement · PRIORITY: High · STATE: Todo

**Goal.** `tests/unit/jira-provider-adf-codec.test.js` becomes a balanced contract for what users of the Jira codec actually get:

* the Markdown Harbour **displays**;
* the ADF Harbour **writes** to Jira;
* the gate's **refuse or allow** decision.

This way the next clean-room rebuild can't quietly change any of it. Along the way, fix the one live regression the tests let through: links whose URL contains brackets.

**Why.** This is John's rebuild experiment 2b, part 1. He wanted the tests "reviewed in advance so that we know that the tests are well balanced and have correct coverage", before the next rebuild runs.

Two independent clean-room rebuilds produced the same regression, and it shipped in LIN-3557. Both followed the `HREF` comment in `adf.js` ("only an unescaped `)` ends it") rather than the old code.

* **Display.** For a Jira link to `https://en.wikipedia.org/wiki/Foo_(bar)`, today's `adfToMarkdown` emits `[wiki](https://en.wikipedia.org/wiki/Foo_(bar\))`. Through `marked`, which is how Harbour's browser renders descriptions (`public/common.js`, `app.js`, `swipe.js`), that shows a literal `[wiki](`, an automatic link to the wrong URL `…Foo_(bar%5C)`, then `)`. The code before LIN-3557 (`269a6189`) emitted `…Foo_\(bar\))`, which renders as the right link.
* **Write.** `markdownToAdf('[Foo](https://e.com/wiki/Foo_\(bar\))')` now stores the href `…Foo_\(bar)` in Jira. Before, it stored `…Foo_(bar)`.

Every test passed, because the tests check that a link survives the round trip, never what is shown or stored.

**Decision.**

* **Fix the brackets, in both directions.**
  * Hrefs escape *and* unescape both `(` and `)`, as `269a6189` did.
  * Rewrite the `HREF` comment so it says that.
  * Correct the escaping section's claim that rendered Markdown is unaffected, so it says what `marked` actually does.

  The next rebuild reads these comments as its spec.
* **Pin user-visible outputs only:**
  * `adfToMarkdown`'s Markdown, and, for links, emphasis, code and escaping, what `marked.parse(md)` renders from it with default options (`marked` is a dependency, the same v17 the browser uses);
  * `markdownToAdf`'s ADF;
  * `adfHasUnrenderableContent`'s boolean.

  No tests of internals, source shape, counts or private helpers. Test names describe behaviour, not row numbers or mutant ids.
* **The gap list is the scope.** Run `git fetch origin claude/jolly-knuth-dgn3m1`, then extract `experiments/rebuild-exp2/2b/` from `FETCH_HEAD` into a temporary folder. It holds `gap-list.md`, `gap-list.json` and `plant.mjs`:
  * `gap-list.md` has 46 one-line faults, planted at `e7f7bd57`, that today's tests miss but that change some output on a 8,916-input corpus. Each row has an id, its position, what changes and an example.
  * `gap-list.json` has the full example inputs. They are fuzzer output, so write the most natural input that shows the same thing.
  * `plant.mjs` re-plants any row exactly.

  Work against `e7f7bd57`'s `adf.js` for the planting, before or alongside the bracket fix. For each row, either:
  * **cover it:** a new test fails against the planted copy and passes against the real code (a hang under a `{ timeout }` counts as failing); or
  * **label it** `not pinned: <one-line reason>` (for example, no realistic input or an edge case not worth its test; John: "I'm happy to drop edge cases like that for the sake of simplicity"), or `deferred: LIN-3558` for the empty-fenced-block area.
* **Behaviour.** Fix only the brackets. If you notice other output that looks wrong, and `269a6189` behaves the same way (for example, Markdown-looking prose that `marked` renders as markup), neither fix nor pin it. List it in the PR as a follow-up.
* **Balance.**
  * Prefer one table-driven test per kind of behaviour over many near-duplicates.
  * Don't edit or delete existing tests, except to merge exact duplicates. Say which.
  * All new tests go in `tests/unit/jira-provider-adf-codec.test.js`.
* **No new mechanism:** no guards, census or source-shape checks.

**Done when.**

* Unit tests show both bracket cases are correct. For display, `marked.parse` renders the link with the right href. For writing, the stored href has no backslash. That's the evidence; no live Jira or browser check is needed.
* The PR has the 46-row table: id, then "covered by <test name>", "not pinned: <reason>" or "deferred: LIN-3558".
* The two comments are corrected.
* The full unit suite, e2e and CI are green, and the change merges as normal.

**Out of scope.**

* Rewriting the codec (that's part 2).
* LIN-3558.
* Other display quirks shared with `269a6189`.
* Other modules.

**References.**

* LIN-3557: its review (R1 and R2) judged the bracket change on the Jira round trip only.
* On the branch above:
  * `experiments/rebuild-exp2/results-2a.md`;
  * `experiments/rebuild-exp1/armB/classify.md`, which lists experiment 1's clean-room regressions and shows where the tests were thin;
  * `experiments/rebuild-exp2/2b/survivor-probe-e7f7bd57.json`, the raw data behind the gap list.
* The parent, LIN-3549.
