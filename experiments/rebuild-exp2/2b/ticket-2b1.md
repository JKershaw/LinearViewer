TITLE: Make the Jira codec's tests a contract of what users see (lib/providers/jira/adf.js), and fix the link-with-brackets display regression

PARENT: LIN-3549 · PROJECT: Quality, Periodicals & Measurement · PRIORITY: High · STATE: Todo

**Goal.** `tests/unit/jira-provider-adf-codec.test.js` becomes a complete, balanced contract for what users of the Jira codec actually get:

* the Markdown Harbour **displays** (rendered as the browser renders it);
* the ADF Harbour **writes** to Jira;
* the gate's **refuse or allow** decision.

Done this way, the next clean-room rebuild can't regress any of it without a test failing. Along the way, fix the one live regression the tests let through: a link whose URL contains brackets.

**Why.** This is John's rebuild experiment 2b, part 1. He wanted the tests "reviewed in advance so that we know that the tests are well balanced and have correct coverage", before the next rebuild runs.

Two independent clean-room rebuilds produced the same regression, and it shipped in LIN-3557. In both, a Jira link like `https://en.wikipedia.org/wiki/Foo_(bar)` renders in Harbour as broken raw text. Today's `adfToMarkdown` emits `[wiki](https://en.wikipedia.org/wiki/Foo_(bar\))`. `marked`, which Harbour's browser uses (`public/common.js`), can't parse that as a link. The previous code emitted `…Foo_\(bar\))`, which renders correctly.

Every test passed, because the tests check that a link survives the round trip, never what Harbour shows. John on edge cases: "I'm happy to drop edge cases like that for the sake of simplicity."

**Decision.**

* **What gets pinned: user-visible outputs only.** Assert on:
  * `adfToMarkdown`'s Markdown, and, for links, emphasis, code and escapes, what `marked` renders from it (`marked` is already a dependency);
  * `markdownToAdf`'s ADF;
  * `adfHasUnrenderableContent`'s boolean.

  No tests of internals, source shape, counts or private helpers.
* **Sources of missing tests, in this order:**
  1. **Links whose URL contains `(` or `)`.** Each must render as a working link with the right href. Fix `adf.js` with the smallest change that makes that true; the old code escaped both brackets in hrefs.
  2. **Each output-changing gap in the gap list.** The list is computed, not judged: `experiments/rebuild-exp2/2b/gap-list.md` on branch `claude/jolly-knuth-dgn3m1`. It has 46 planted one-line faults that today's 138 tests miss, each with the outputs it changes and the smallest example input. For each row, either:
     * add a test that would fail with that fault, pinning today's correct output; or
     * mark the row "equivalent" (no realistic input shows it) or "edge case dropped" (simplicity wins), with one line of reason.
  3. **Each decision recorded in `adf.js`'s comments** that has no test on its user-visible output.
* **Behaviour.** Where today's output is wrong for a user, fix it with the smallest change, as with the brackets: it contradicts a recorded decision, or gives broken display or invalid ADF. Otherwise pin today's behaviour. Don't pin known bugs or edge cases that would cost simplicity. LIN-3558 (empty fenced block) stays out of scope.
* **Balance.**
  * Prefer one table-driven test over many near-duplicates.
  * Don't edit or delete existing tests, except to merge exact duplicates. Say which.
  * All new tests go in `tests/unit/jira-provider-adf-codec.test.js`.
* **No new mechanism:** no guards, census or source-shape checks.

**Done when.**

* Links with brackets display correctly in Harbour.
* Every one of the 46 gap-list rows is either covered by a test or marked "equivalent" or "edge case dropped" with a reason, and the PR has that table.
* The full unit suite, e2e and CI are green, and the change merges as normal.

**Out of scope.**

* Rewriting the codec (that's part 2).
* LIN-3558.
* Other modules.

**References.**

* LIN-3557 and its review (R1 and R2), where the bracket change was judged on the Jira round trip only.
* `experiments/rebuild-exp2/results-2a.md` and `experiments/rebuild-exp1/armB/classify.md` on the branch above. `classify.md` lists experiment 1's clean-room regressions and fixes, which show where the tests were thin.
* The parent, LIN-3549.
