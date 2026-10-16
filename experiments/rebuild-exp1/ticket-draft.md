TITLE: Rebuild the Jira ADF↔Markdown codec (lib/providers/jira/adf.js) as a whole behind its three exports: same behaviour, cleaner code

PARENT: LIN-3549 · PROJECT: Quality, Periodicals & Measurement · PRIORITY: High · STATE: Todo

**Goal.** Rebuild `lib/providers/jira/adf.js` as a whole, in place. Its three exports keep doing what they do today, and the code that does it is cleaner. John defines cleaner as "cognitively simpler, less room for bugs, easy to maintain".

**Why.** This is John's first rebuild experiment. In his words (15 Oct): "we find a single module that's well tested and with clean seams; we try rebuilding it (through Harbour, via a ticket), and see how it goes." He wants to find out "if the rebuild idea has legs, and how to actually perform it in practice." What counts as success: "what we end up with matches the utility of what came before, but the code is _cleaner_ (cognitively simpler, less room for bugs, easy to maintain)."

This module goes first because:

* it is pure;
* it imports nothing;
* its one caller, `lib/providers/jira/index.js`, imports exactly its three functions;
* it has its own test file.

**Decision.**

* **What stays the same.** The same file, the same three exports (`adfToMarkdown`, `markdownToAdf`, `adfHasUnrenderableContent`), and the same arguments.
* **Same output for any input the tests or the recorded decisions cover. Change nothing else on purpose.** The tests are the evidence of equivalence; don't build a comparison harness. If something looks like a bug, keep today's behaviour and note it in the PR. Don't file tickets for it.
* **Rewrite the file as a whole, and keep any piece that is already as simple as you would write it.** The decisions recorded in its comments are behaviour and stay. For example:
  * escaping is unconditional;
  * unknown nodes fall back to their text;
  * the gate is derived from what the writer can rebuild, with its four named exceptions.

  Keep the reasons a reader needs, with their ticket or ruling references, beside the code they govern. The history of how the code got there can go.
* **Existing tests are the yardstick.** Don't edit or delete any existing test, anywhere. If one seems wrong, or would have to change, raise a `DECISION:` on this ticket and stop.
* **New tests are optional.** If you add any:
  * put them in `tests/unit/jira-provider-adf-codec.test.js`;
  * add and run them *before* rewriting, so each one is shown to pass against today's `adf.js`.

  They pin today's behaviour; they don't add new behaviour.
* **Change nothing outside `adf.js`,** apart from any added tests. The 422 message in `index.js` names the gate's common causes. Since behaviour stays the same, it stays correct.
* **No new mechanism:** no guards, census or source-shape checks.
* **For review:** a whole-file diff is expected. Review it against the tests and the recorded decisions.

**Done when.**

* The rebuilt `adf.js` replaces the old one, with no second copy left.
* Every existing test passes unchanged, the full unit suite, e2e and CI are green, and the change merges as normal.

**Out of scope.**

* Changing behaviour.
* Renaming or adding exports.
* The rest of the Jira provider.
* Other modules.

**References.**

* `lib/providers/jira/adf.js`: its header and each export's documentation record the decisions.
* The tickets behind those decisions:
  * LIN-2399, the extraction into its own file;
  * LIN-1886, escaping and the gate, including John's ruling `d38d3755` on the ordered-list identity value;
  * LIN-2019 and LIN-1939, the gate's other named exceptions.
* Tests that exercise the module:
  * `tests/unit/jira-provider-adf-codec.test.js`;
  * `tests/unit/jira-provider.test.js`;
  * `tests/unit/proxy-jira-write-routes.test.js`;
  * `tests/e2e/jira-provider.spec.js`.
* The parent, LIN-3549.
