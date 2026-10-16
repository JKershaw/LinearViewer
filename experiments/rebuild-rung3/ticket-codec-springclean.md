TITLE: Jira codec: support nested lists and *single-asterisk* italics, two common Markdown features that a Jira round trip loses (lib/providers/jira/adf.js)

PARENT: LIN-3549 · PROJECT: Quality, Periodicals & Measurement · PRIORITY: High · STATE: Todo

**Goal.** In a Jira-backed workspace, a description written with nested lists or `*single-asterisk*` italics keeps its structure and emphasis through a Harbour edit and save, and Jira descriptions with nested lists display as nested lists in Harbour.

**Why.** John's rebuild experiments replay the Jira codec over a private sample of 1,037 real ticket descriptions (Linear Markdown, not in the repository). The experiments found two common features the codec doesn't support:

* **Nested lists** appear in 483 of the 1,037 texts (47%). Today the writer stores `- a` / `  - b` / `- c` as one flat list, and `1. a` / `   - sub` / `2. b` as a single paragraph showing the list markers as text. The gate refuses a nested list stored in Jira (a `listItem` may hold only one paragraph), so such a description can't be edited from Harbour. The reader flattens it for display.
* **`*single-asterisk*` italics** appear in 287 (28%). Today `text with *star* em` is stored as literal asterisks.

John on the experiments: "Part of the reason for the rebuild idea is to give everything a sort of spring clean. No harm in retrospectivly finding missing functionality and either improving tests and trying again, or some other solution." This ticket is the "other solution" for two gaps found that way. John's note for the experiments: "no need to be so strict on edge cases as we experiment. Bugs should be fixed, but we want it to improve,so there's going to be fuzz."

**Decision.**

* **Nested lists, both directions.**
  * **Writer** (`markdownToAdf`): a list item's indented continuation lines that form a list become a nested `bulletList` or `orderedList` inside that `listItem`, after its paragraph, to any depth. An item's content column is its marker width: 2 for `- `, 3 for `1. `, 4 for `10. `, plus any extra spaces after the marker, up to 4. Lines indented to at least that column belong to the item: strip that indent and parse the rest as blocks, recursively. A marker line indented less is a sibling, not a child.
  * **Reader** (`adfToMarkdown`): a nested list inside a `listItem` renders indented by the parent's marker width (including the 10th and later ordered items), so `marked` displays it nested.
  * **Gate:** a `listItem` holding one paragraph followed by zero or more `bulletList` or `orderedList` children is permitted. Nothing else new is. Extend the property-test corpus with nested shapes.
  * **Out of scope:** non-list continuation lines inside an item, and blank-line-separated (loose) nested lists. The split on blank lines is unchanged, and both keep today's behaviour.
* **`*single-asterisk*` italics, writer only.** `*text*` reads as `em` when the opening `*` isn't followed by whitespace, the closing `*` isn't preceded by whitespace, the content isn't empty, and no unescaped `*` is inside it. This matches the existing inline scan. It simplifies CommonMark's flanking rules; list any punctuation-adjacent difference from `marked` (for example ``a*"b"*c``) as accepted. `**strong**` is unchanged. The reader keeps writing emphasis as `_text_`, and keeps escaping a literal `*` in prose, so round trips are unaffected.
* **Comments** describing lists and emphasis are updated to match. The file's comments are the spec later rebuilds work from.
* **Existing tests that pin nested lists as refused** are flipped:
  * the nested-`bulletList` fixture and the `localId` test in `jira-provider-adf-codec.test.js` (the `localId` test keeps a different structural refusal);
  * the ENG-16 fixture and its 422 test in `proxy-jira-write-routes.test.js`, which should now succeed.

  Move nested fixtures from the refused table to the round-trip table. Update the one-line 422 message and the design note in `lib/providers/jira/index.js` that list "a nested list" as refused. That's the only change allowed outside `adf.js` and the tests.
* **New tests,** in `tests/unit/jira-provider-adf-codec.test.js`, table-driven. For each case, check what's stored, what `marked.parse` displays after a round trip, and that the display matches `marked.parse` of the typed Markdown:
  * a two-level bullet list;
  * a three-level mixed list;
  * bullets under a numbered item;
  * `*` bullets nested;
  * a nested list under the 10th ordered item;
  * `*italic*` in prose, inside a list item, and next to `**bold**`;
  * a literal `2 * 3 * 4` that must stay text;
  * `2*3*4` and `**bold *it* x**`: say which behaviour is intended, and accept differences from `marked` there.
* **Edge cases.** Simplicity wins. Accept and list differences on unusual indentation (tabs, 1-space indents, mixed markers); don't chase them.
* **No new mechanism.**

**Done when.**

* The tests above pass.
* The full unit suite, e2e and CI are green, and the change merges as normal.
* No live check is needed.

**Out of scope.**

* Tables, task lists and other Markdown features.
* Reader-side changes beyond nested lists.
* Other modules.

**References.**

* LIN-3565, the latest rebuild of this codec.
* LIN-3561 and LIN-3564, for the test style.
* The parent, LIN-3549.
