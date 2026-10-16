TITLE: Jira codec: inline code containing a backslash, a backtick or edge spaces displays wrong in Harbour (lib/providers/jira/adf.js)

PARENT: LIN-3549 · PROJECT: Quality, Periodicals & Measurement · PRIORITY: High · STATE: Todo

**Goal.** In a Jira-backed workspace, inline code shows exactly its own text in Harbour, and a typed code span stores its content as CommonMark defines it (so `` ` a ` `` stores `a`, and `` `a\\b` `` stores `a\\b`).

**Why.** PR #1893 (LIN-3561) recommended one follow-up ticket for its F1 and F2. This ticket covers F1. F2, hand-typed links with balanced brackets, is deferred: it appears in none of the real texts sampled below.

`adfToMarkdown` escapes `\` and `` ` `` inside a code span. CommonMark processes no escapes inside code spans, so `marked`, which renders descriptions in Harbour's browser, shows the escapes literally (all checked against `marked` 17.0.1 at `bf6f7507`):

* Code `C:\dir` is emitted as `` `C:\\dir` `` and displays as `C:\\dir`.
* Code ``a`b`` is emitted as `` `a\`b` `` and displays as code `a\` followed by `` b` ``.
* Code ``x` `` is emitted as `` `x\`` `` and displays as no code at all.
* Code `" a "` displays as `a`, because CommonMark strips one space from each side.

The reader mirrors the writer, so `markdownToAdf` departs from CommonMark too. A typed `` `a\\b` `` stores `a\b`. A typed `` `dir\` `` stores the plain text `` `dir` ``, with no code mark and the backslash gone.

On a private sample of 1,037 real ticket texts (Linear descriptions, not in the repository), a Markdown → ADF → Markdown round trip makes inline code display extra backslashes in 137 (13%). The behaviour is older than LIN-3557; `269a6189` escaped code text the same way.

LIN-3561 added a sentence to the escaping comment calling this "a known, accepted display cost". No ruling is recorded for code spans specifically. This is part of John's rebuild experiments, and the comments in this file are the spec a later rebuild works from, so they must describe what the code does.

**Decision.**

* **Code spans follow CommonMark, in both directions.**
  * **Writer.** No escaping inside a code span. Fence the text with a backtick run one longer than the longest run of backticks inside it (length 1 if there is none). Pad with one space on each side when the text begins or ends with a backtick, or when it both begins and ends with a space and contains a non-space character. All-space text is fenced with no padding, because CommonMark strips nothing from it.
  * **Reader.**
    * An opening run is the whole run of N backticks, never a single backtick from within it. It closes at the next run of exactly N backticks, and nothing inside is unescaped.
    * One leading and one trailing space are stripped when both are present and the content isn't all spaces.
    * If no run of exactly N follows, the whole opening run is literal text, and scanning resumes after it.
    * Precedence against links and the other marks is unchanged. Spans never cross a line break, since lines are split first.
* **Adjacent code runs.** `[code 'a'][code 'b']` is written today as `` `a``b` ``, which reads back as two runs. Under CommonMark it is one run, ``a``b``. So adjacent code-marked text runs can no longer round-trip. The gate must refuse them: extend `hasAdjacentUnmarkedRuns` or add a sibling rule, add a fixture to `WRITER_UNSAFE_ADF`, and update that function's docstring ("Adjacent marked runs are fine"). Say so in the PR.
* **Comments.** Every comment in the file that says code text is escaped or unescaped must describe the new behaviour. That includes:
  * the `CODE_SPAN` paragraph;
  * the "known, accepted display cost" sentence;
  * "A code span and an href are unescaped with their own narrow set";
  * the opening lines about what the reader escapes;
  * `hasAdjacentUnmarkedRuns`'s docstring.

  Delete the `CODE_SPAN` escape context if it becomes unused.
* **Tests,** in `tests/unit/jira-provider-adf-codec.test.js`, in the style LIN-3561 added: table-driven, user-visible outputs only.
  * For each of these code texts, the Markdown emitted, what `marked.parse` (default options) displays, and the round trip: `C:\dir`, `dir\`, `a\\b`, ``a`b``, ``` `x```, ``x` ``, ``a``b``, a lone backtick, `" a "`, `" "`, `"  "`.
  * What these typed spans store: `` `a\\b` `` → code `a\\b`; `` `dir\` `` → code `dir\`; ``` `` a`b `` ``` → code ``a`b``; `` ` a ` `` → code `a`; `` `a`` `` → plain text.
  * Add these code texts to `ADVERSARIAL_TEXTS`, so the generated property test covers the code-mark slot.
  * Existing tests may be updated only where they pin the old escaping; name each one in the PR. The round-trip fixture `'ESCAPE — collisions inside marked runs'` should pass unchanged.
* **Scope.**
  * Change only code spans and the adjacent-code-runs gate rule. Don't touch hrefs, prose escaping or code blocks.
  * Prefer simplicity over rare edge cases. John, on an earlier edge case: "I'm happy to drop edge cases like that for the sake of simplicity." List any you drop.
* **No new options, tables or exports.** A small private function for code spans in each direction is expected.

**Done when.**

* The tests above pass.
* `grep -n 'accepted display cost' lib/providers/jira/adf.js` finds nothing, and no comment in the file says code text is escaped.
* `npm run test:unit` passes, e2e passes, `ci-success` is green on the PR, and it merges as normal.

**Out of scope.**

* Rewriting the codec.
* LIN-3558 (an empty fenced code block that doesn't survive the round trip).
* F2.
* Other modules.

**References.**

* LIN-3561 and PR #1893 ("Follow-ups noticed": F1).
* The parent, LIN-3549.
