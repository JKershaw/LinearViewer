# Arm B vs the original `adf.js`: the 340 difference groups, sorted

Original: `tree/lib/providers/jira/adf.js`. Rebuild: `arms/B/adf.js`. Source data: `arms/B/diff.json` (338 public groups, 3,477 cells) and `baseline/private/diff-B.json` (2 private groups, 2 cells).

## Classes

| Class | Groups | Cells | Test and real-text cells among them |
|---|---:|---:|---|
| 1. Malformed-only | 79 | 900 | tests-adf 3 (shrinker drift, see Caveats) |
| 2. Original bug fixed by B | 237 | 1,339 | tests-md 16, tests-adf 13, **real-md 2** |
| 3. Regression in B | 18 | 1,217 | tests-adf 7, tests-md 14 |
| 4. Harmless | 5 | 22 | none |
| 5. Unclear (John's call) | 1 | 1 | tests-adf 1 |
| **Total** | **340** | **3,479** | 54 test cells, 2 real-text cells |

In plain terms, the cell counts above come from just 16 behaviour changes. Nine of them are reachable only from malformed input:

| Behaviour change (old → B) | Class | Groups | Cells (sum of group counts) | Cells whose *full* input needs this change |
|---|---|---:|---:|---:|
| Link href: B escapes `\` and `)` but no longer `(`; its writer unescapes only `\)` | 3 (1 group: 4) | 5 | 1,103 | 1,412 |
| Fence: B reads the language from the opening line even when the block does not end in a closing fence | 2 (#7, #8: 3; #30: 1) | 13 + 2 private | 880 | 1,122 |
| Writer: an empty inline run (`# `, `- `, `> `) becomes `content: []`, not `{text: ''}` | 2 | 166 | 453 | 931 |
| `blockCard` ends with a blank line, so the next block is separate | 2 (4 groups: 4) | 61 | 126 | 420 |
| Writer: `----` (any run of 3 or more dashes) is a rule | 2 | 2 | 11 | 0 (drift) |
| Reader: only an exact `^-{3,}$` line is escaped (old: `^\s*-{3,}\s*$`) | 3 | 12 | 20 | 31 |
| Mention without `id` or `text`: `@` (old `@user`) | 1 | 2 | 356 | 824 |
| No throw on string `content`, `marks: [null]`, null list items | 1 | 29 | 318 | 547 |
| Gate throws in old (`attrs: null`, string content) | 1 | 3 | 6 | 5 (outside the flags) |
| A numeric `text` renders as `''` (old: `String(n)`) | 1 | 2 | 90 | 263 |
| A list child that is not a `listItem` is rendered as a node | 1 | 32 | 105 | 0 (drift) |
| A list with no items is closed by a blank line | 1 | 5 | 5 | 65 |
| Gate: a `null` or primitive node is refused (old: permitted) | 1 | 2 | 2 | 2 |
| Gate: a marked text run inside a `codeBlock` is refused | 1 | 1 | 1 | 1 |
| Gate: a code language containing `\n` is permitted (old: refused) | 1 | 2 | 2 | 2 |
| Gate: a list item or quote whose paragraph holds an empty text run is refused | 5 | 1 | 1 | 1 |

Cell-level view (public cells, by the causes their full input needs): 1,239 differ only through fixes, 870 only through regressions, 388 only through malformed-input handling, and 1 is the class-5 cell. The other 979 mix causes. Many href cells hold only a lone `(`, which renders the same either way; 3a gives the measured display impact.

### How the groups were sorted

- **Regrouping.** I recomputed all 3,477 public cells and re-shrank and regrouped them with the kit's own `shrink`/`signatureFor`. This gave the same 338 signatures and counts, with full membership (`regroup.mjs`).
- **Cause attribution.** I made a copy of the original with each of the 23 code-level differences behind a flag (`hybrids/FLAGGED.mjs`). With every flag off it equals the original, apart from throw messages. With every flag on it equals B on 3,472 of the 3,477 cells. The other 5 are malformed gate inputs that throw in the original.
  - Every group's minimal example is explained by exactly one change (`patches.mjs`, `regroup.mjs`).
  - Leave-one-out on the full inputs gives each cell's set of causes (`loo.mjs`).
- **Display.** I rendered the a2m and rt_md outputs of both versions through marked 17.0.1, the version vendored as `public/marked.min.js`.
- **Realism.** I used the gen-adf profile tags (`wild` = malformed) to judge how realistic each group's members are (`enrich.mjs`).
- **The rule.** A group is classed by the behaviour its minimal example shows. Class 1 means a behaviour that only malformed input can reach.

## Class 2: original bugs fixed by B (237 groups, 1,339 cells)

### 2a. A fenced block keeps its language when the block does not end in a clean closing fence (10 public groups, 751 cells; plus both private groups)

**What changed.** Old reads the language only through a regex that needs ```` ``` ```` at the very end of the block; otherwise a fallback drops it. B always takes the info string from the opening line, and closes the fence on a last line that is exactly ```` ``` ```` after trimming.

**When it matters.**

- A fenced block containing a blank line. The writer splits blocks on blank lines first; this is a documented limitation.
- An unclosed fence.
- A closing fence with trailing spaces.
- A closing fence followed by more lines with no blank line between.

**Why B is right.** The original's own comment says the language is stamped "ONLY when the fence carries one", and here it does. Under CommonMark the info string belongs to the opening line whatever follows.

**Example (tests-md#772, `"```js\na\n\nb\n```"`).** Old writes a code block `a` with no language. B writes the same block with `language: "js"`. Both then leak `b` and the closing fence into a paragraph; that is a shared limitation.

**Private corpus.** The only real-text difference (1 of 1,037 texts, m2a plus rt_md) is a long ticket comment. It holds a language-tagged fenced block whose closing fence is followed, on the next line and with no blank line, by a line of HTML markup. Old drops the language; B keeps it. Both keep the closing fence and that markup line inside the code body, which is a shared bug.

**Write path.** The rt_adf groups (#4, #28, #314) are stored code blocks with a language and an empty or blank-line body. The gate refuses those (422), so they never reach the write path.

| # | fn | cells | sources | minimal input | old | B |
|---|---|---|---|---|---|---|
| 2 | m2a | 253 | tests-md 3, gen-md 250 | ```` "```s" ```` | `[{"type":"codeBlock","content":[]}]` | `[{"type":"codeBlock","attrs":{"language":"s"},"content":[]}]` |
| 3 | rt_md | 233 | tests-md 3, gen-md 230 | ```` "```s" ```` | ```` "```\n\n```" ```` | ```` "```s\n\n```" ```` |
| 4 | rt_adf | 201 | gen-adf 198, tests-adf 3 | `{"type":"doc","content":[{"type":"codeBlock","attrs":{"language":"A"}}]}` | `[{"type":"codeBlock","content":[]},{"type":"codeBlock","content":[]}]` | `[{"type":"codeBlock","attrs":{"language":"A"},"content":[]},{"type":"codeBlock","content":[]}]` |
| 22 | m2a | 20 | gen-md 20 | ```` "```}" ```` | `[{"type":"codeBlock","content":[]}]` | `[{"type":"codeBlock","attrs":{"language":"}"},"content":[]}]` |
| 24 | rt_md | 19 | gen-md 19 | ```` "```}" ```` | ```` "```\n\n```" ```` | ```` "```}\n\n```" ```` |
| 28 | rt_adf | 15 | gen-adf 15 | `{"type":"doc","content":[{"type":"codeBlock","attrs":{"language":"+"}}]}` | `[{"type":"codeBlock","content":[]},{"type":"codeBlock","content":[]}]` | `[{"type":"codeBlock","attrs":{"language":"+"},"content":[]},{"type":"codeBlock","content":[]}]` |
| 65 | m2a | 4 | gen-md 4 | ```` "```." ```` | `[{"type":"codeBlock","content":[]}]` | `[{"type":"codeBlock","attrs":{"language":"."},"content":[]}]` |
| 66 | rt_md | 4 | gen-md 4 | ```` "```." ```` | ```` "```\n\n```" ```` | ```` "```.\n\n```" ```` |
| 155 | m2a | 1 | gen-md 1 | ```` "```_" ```` | `[{"type":"codeBlock","content":[]}]` | `[{"type":"codeBlock","attrs":{"language":"_"},"content":[]}]` |
| 314 | rt_adf | 1 | gen-adf 1 | `{"content":[{"type":"codeBlock","attrs":{"language":"n"}}]}` | `[{"type":"codeBlock","content":[]},{"type":"codeBlock","content":[]}]` | `[{"type":"codeBlock","attrs":{"language":"n"},"content":[]},{"type":"codeBlock","content":[]}]` |

### 2b. An empty inline run is written as `content: []` (166 groups, 453 cells)

**What changed.** Old's `parseInline` returns `[{type: 'text', text: ''}]` for an empty run, and B returns `[]`. This reaches:

- an empty heading `# `;
- an empty bullet `- ` or numbered item `4. `;
- a blank quoted line `> ` inside a quote;
- a doubled hardBreak in a quote.

**Why B is right.**

- The ADF schema requires a text node to be non-empty.
- Jira stores its own empty paragraphs as `content: []`.
- The original's gate comment calls an empty list-item paragraph "the perfectly rebuildable `- ` line" and promises that whatever is permitted deep-equals after a round trip. In old that is false: a stored `listItem(paragraph(content: []))` is permitted, but comes back as `[{text: ''}]`. With B it comes back exactly.

**Examples.**

- tests-md#568 `"- \n- plain"`: old writes item 1 as `[{"type":"text","text":""}]`, B as `[]`.
- tests-md#42 `"> one\n> \n> two"`: old writes `[one, hardBreak, '', hardBreak, two]`, B writes `[one, hardBreak, hardBreak, two]`.

**Why 166 groups.** Each carrier (heading, list, quote, in various positions) gets its own signature. Many minimal carriers are malformed ADF, such as a heading with no level or a quote with no content, but the difference itself is the writer's, and it is reachable from ordinary Markdown.

See class 5 for the one consequence that needs a decision.

| # | fn | cells | sources | minimal input | old | B |
|---|---|---|---|---|---|---|
| 15 | m2a | 37 | gen-md 34, tests-md 3 | `"# "` | `[{"type":"heading","attrs":{"level":1},"content":[{"type":"text","text":""}]}]` | `[{"type":"heading","attrs":{"level":1},"content":[]}]` |
| 16 | rt_adf | 32 | tests-adf 2, gen-adf 30 | `{"type":"doc","content":[{"type":"blockquote","content":[{"type":"text","text":"a\n\nb"}]}]}` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"a"},{"type":"hardBreak…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"a"},{"type":"hardBreak…` |
| 17 | rt_adf | 30 | gen-adf 30 | `{"type":"doc","content":[{"type":"blockquote","content":[{"type":"codeBlock"}]}]}` | ```` [{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"```"},{"type":"hardBre… ```` | ```` [{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"```"},{"type":"hardBre… ```` |
| 21 | m2a | 20 | tests-md 3, gen-md 17 | `"> "` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":""}]}]}]` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[]}]}]` |
| 26 | m2a | 17 | gen-md 13, tests-md 4 | `"- "` | `[{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text",…` | `[{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[]}]}]}]` |
| 27 | m2a | 16 | gen-md 16 | `"4. "` | `[{"type":"orderedList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text"…` | `[{"type":"orderedList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[]}]}]}]` |
| 29 | rt_adf | 15 | gen-adf 15 | `{"type":"doc","content":[{"type":"heading"},{"type":"text","text":"a"}]}` | `[{"type":"heading","attrs":{"level":1},"content":[{"type":"text","text":""}]},{"type":"paragraph","content":[…` | `[{"type":"heading","attrs":{"level":1},"content":[]},{"type":"paragraph","content":[{"type":"text","text":"a"…` |
| 31 | rt_adf | 13 | gen-adf 13 | `{"type":"doc","content":[{"type":"heading"},{"type":"heading"}]}` | `[{"type":"heading","attrs":{"level":1},"content":[{"type":"text","text":""}]},{"type":"paragraph","content":[…` | `[{"type":"heading","attrs":{"level":1},"content":[]},{"type":"paragraph","content":[{"type":"text","text":"#"…` |
| 37 | rt_adf | 9 | gen-adf 9 | `{"type":"doc","content":[{"type":"blockquote","content":[{"type":"text","text":"2\n\na"}]}]}` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"2"},{"type":"hardBreak…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"2"},{"type":"hardBreak…` |
| 39 | rt_adf | 8 | gen-adf 8 | `{"type":"doc","content":[{"type":"blockquote","content":[{"type":"text","text":"r\n\n\u00e9"}]}]}` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"r"},{"type":"hardBreak…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"r"},{"type":"hardBreak…` |
| 43 | rt_adf | 7 | gen-adf 7 | `{"type":"doc","content":[{"type":"heading"},{"type":"rule"}]}` | `[{"type":"heading","attrs":{"level":1},"content":[{"type":"text","text":""}]},{"type":"rule"}]` | `[{"type":"heading","attrs":{"level":1},"content":[]},{"type":"rule"}]` |
| 47 | rt_adf | 7 | tests-adf 3, gen-adf 4 | `{"type":"doc","content":[{"type":"heading"},{"type":"bulletList","content":[{"type":"listItem"}]}]}` | `[{"type":"heading","attrs":{"level":1},"content":[{"type":"text","text":""}]},{"type":"paragraph","content":[…` | `[{"type":"heading","attrs":{"level":1},"content":[]},{"type":"paragraph","content":[{"type":"text","text":"-"…` |
| 48 | rt_adf | 7 | gen-adf 7 | `{"type":"doc","content":[{"type":"blockquote"},{"type":"text","text":"o"}]}` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":""}]}]},{"type":"paragr…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[]}]},{"type":"paragraph","content":[{"type":"…` |
| 49 | rt_adf | 6 | tests-adf 2, gen-adf 4 | `{"type":"doc","content":[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"e"}]},{"…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"e"},{"type":"hardBreak…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"e"},{"type":"hardBreak…` |
| 50 | rt_adf | 6 | gen-adf 6 | `{"type":"doc","content":[{"type":"heading"},{"type":"text","text":"\u00e9"}]}` | `[{"type":"heading","attrs":{"level":1},"content":[{"type":"text","text":""}]},{"type":"paragraph","content":[…` | `[{"type":"heading","attrs":{"level":1},"content":[]},{"type":"paragraph","content":[{"type":"text","text":"\u…` |
| 52 | rt_adf | 6 | gen-adf 6 | `{"type":"doc","content":[{"type":"heading"},{"type":"blockquote"}]}` | `[{"type":"heading","attrs":{"level":1},"content":[{"type":"text","text":""}]},{"type":"paragraph","content":[…` | `[{"type":"heading","attrs":{"level":1},"content":[]},{"type":"paragraph","content":[{"type":"text","text":">"…` |
| 53 | rt_adf | 6 | gen-adf 6 | `{"type":"doc","content":[{"type":"panel","content":[{"type":"heading"},{"type":"text","text":"g"}]}]}` | `[{"type":"heading","attrs":{"level":1},"content":[{"type":"text","text":""}]},{"type":"paragraph","content":[…` | `[{"type":"heading","attrs":{"level":1},"content":[]},{"type":"paragraph","content":[{"type":"text","text":"g"…` |
| 54 | rt_adf | 6 | gen-adf 6 | `{"type":"doc","content":[{"type":"blockquote","content":[{"type":"text","text":"E\n\n2"}]}]}` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"E"},{"type":"hardBreak…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"E"},{"type":"hardBreak…` |
| 57 | rt_adf | 5 | tests-adf 3, gen-adf 2 | `{"type":"doc","content":[{"type":"bulletList","content":[{"type":"listItem"}]},{"type":"blockquote"}]}` | `[{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text",…` | `[{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[]}]}]},{"type":…` |
| 58 | rt_adf | 5 | gen-adf 5 | `{"type":"doc","content":[{"type":"bulletList","content":[{"type":"listItem"}]},{"type":"text","text":"r"}]}` | `[{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text",…` | `[{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[]}]}]},{"type":…` |
| 59 | rt_adf | 5 | gen-adf 5 | `{"type":"doc","content":[{"type":"panel","content":[{"type":"heading"},{"type":"heading"}]}]}` | `[{"type":"heading","attrs":{"level":1},"content":[{"type":"text","text":""}]},{"type":"paragraph","content":[…` | `[{"type":"heading","attrs":{"level":1},"content":[]},{"type":"paragraph","content":[{"type":"text","text":"#"…` |
| 60 | rt_adf | 5 | gen-adf 5 | `{"type":"doc","content":[{"type":"heading"},{"type":"codeBlock"}]}` | `[{"type":"heading","attrs":{"level":1},"content":[{"type":"text","text":""}]},{"type":"codeBlock","content":[…` | `[{"type":"heading","attrs":{"level":1},"content":[]},{"type":"codeBlock","content":[]},{"type":"codeBlock","c…` |
| 64 | rt_adf | 4 | gen-adf 4 | `{"type":"doc","content":[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"e"},{"ty…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"e"},{"type":"hardBreak…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"e"},{"type":"hardBreak…` |
| 70 | rt_adf | 4 | gen-adf 4 | `{"type":"doc","content":[{"type":"blockquote","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"r"},{"type":"hardBreak…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"r"},{"type":"hardBreak…` |
| 72 | rt_adf | 4 | gen-adf 4 | `{"type":"doc","content":[{"type":"blockquote","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"a"},{"type":"hardBreak…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"a"},{"type":"hardBreak…` |
| 86 | rt_adf | 3 | gen-adf 3 | `{"type":"doc","content":[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"r"}]},{"…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"r"},{"type":"hardBreak…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"r"},{"type":"hardBreak…` |
| 87 | rt_adf | 3 | gen-adf 3 | `{"type":"doc","content":[{"type":"blockquote"},{"type":"orderedList","content":[{"type":"listItem"}]}]}` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":""}]}]},{"type":"paragr…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[]}]},{"type":"paragraph","content":[{"type":"…` |
| 88 | rt_adf | 3 | gen-adf 3 | `{"type":"doc","content":[{"type":"heading"},{"type":"orderedList","content":[{"type":"listItem"}]}]}` | `[{"type":"heading","attrs":{"level":1},"content":[{"type":"text","text":""}]},{"type":"paragraph","content":[…` | `[{"type":"heading","attrs":{"level":1},"content":[]},{"type":"paragraph","content":[{"type":"text","text":"1.…` |
| 94 | m2a | 2 | gen-md 2 | `"#\u00a0"` | `[{"type":"heading","attrs":{"level":1},"content":[{"type":"text","text":""}]}]` | `[{"type":"heading","attrs":{"level":1},"content":[]}]` |
| 95 | m2a | 2 | gen-md 2 | `"#\t"` | `[{"type":"heading","attrs":{"level":1},"content":[{"type":"text","text":""}]}]` | `[{"type":"heading","attrs":{"level":1},"content":[]}]` |
| 99 | rt_adf | 2 | gen-adf 2 | `{"type":"doc","content":[{"type":"blockquote","content":[{"type":"text","text":"*\n\na"}]}]}` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"*"},{"type":"hardBreak…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"*"},{"type":"hardBreak…` |
| 101 | rt_adf | 2 | gen-adf 2 | `{"type":"doc","content":[{"type":"blockquote","content":[{"type":"orderedList","content":[{"type":"listItem"}]},{"type"…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"1. "},{"type":"hardBre…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"1. "},{"type":"hardBre…` |
| 102 | rt_adf | 2 | gen-adf 2 | `{"type":"doc","content":[{"type":"blockquote","content":[{"type":"text","text":"\u00e9\n\ni"}]}]}` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"\u00e9"},{"type":"hard…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"\u00e9"},{"type":"hard…` |
| 104 | rt_adf | 2 | gen-adf 2 | `{"type":"doc","content":[{"type":"orderedList","content":[{"type":"listItem"}]},{"type":"codeBlock"}]}` | `[{"type":"orderedList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text"…` | `[{"type":"orderedList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[]}]}]},{"type"…` |
| 105 | rt_adf | 2 | gen-adf 2 | `{"type":"doc","content":[{"type":"blockquote"},{"type":"codeBlock"}]}` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":""}]}]},{"type":"codeBl…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[]}]},{"type":"codeBlock","content":[]},{"type…` |
| 108 | rt_adf | 2 | gen-adf 2 | `{"type":"doc","content":[{"type":"table","content":[{"type":"heading"},{"type":"heading"}]}]}` | `[{"type":"heading","attrs":{"level":1},"content":[{"type":"text","text":""}]},{"type":"paragraph","content":[…` | `[{"type":"heading","attrs":{"level":1},"content":[]},{"type":"paragraph","content":[{"type":"text","text":"#"…` |
| 109 | rt_adf | 2 | gen-adf 2 | `{"type":"doc","content":[{"type":"blockquote","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"a"},{"type":"hardBreak…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"a"},{"type":"hardBreak…` |
| 110 | rt_adf | 2 | gen-adf 2 | `{"type":"doc","content":[{"type":"orderedList","content":[{"type":"listItem"}]},{"type":"blockquote"}]}` | `[{"type":"orderedList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text"…` | `[{"type":"orderedList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[]}]}]},{"type"…` |
| 112 | rt_adf | 2 | gen-adf 2 | `{"type":"doc","content":[{"type":"heading"},{"type":"inlineCard","attrs":{"url":")"}}]}` | `[{"type":"heading","attrs":{"level":1},"content":[{"type":"text","text":""}]},{"type":"paragraph","content":[…` | `[{"type":"heading","attrs":{"level":1},"content":[]},{"type":"paragraph","content":[{"type":"text","text":")"…` |
| 114 | rt_adf | 2 | gen-adf 2 | `{"type":"doc","content":[{"type":"blockquote","content":[{"type":"text","text":"\n\n","marks":[{"type":"strong"}]}]}]}` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"**"},{"type":"hardBrea…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"**"},{"type":"hardBrea…` |
| 115 | rt_adf | 2 | gen-adf 2 | `{"type":"doc","content":[{"type":"panel","content":[{"type":"heading"},{"type":"bulletList","content":[{"type":"listIte…` | `[{"type":"heading","attrs":{"level":1},"content":[{"type":"text","text":""}]},{"type":"paragraph","content":[…` | `[{"type":"heading","attrs":{"level":1},"content":[]},{"type":"paragraph","content":[{"type":"text","text":"-"…` |
| 116 | rt_adf | 2 | gen-adf 2 | `{"type":"doc","content":[{"type":"orderedList","content":[{"type":"listItem"}]},{"type":"text","text":"s"}]}` | `[{"type":"orderedList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text"…` | `[{"type":"orderedList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[]}]}]},{"type"…` |
| 117 | rt_adf | 2 | gen-adf 2 | `{"type":"doc","content":[{"type":"blockquote","content":[{"type":"text","text":"-\n\ne"}]}]}` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"-"},{"type":"hardBreak…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"-"},{"type":"hardBreak…` |
| 118 | rt_adf | 2 | gen-adf 2 | `{"type":"doc","content":[{"type":"blockquote","content":[{"type":"text","text":")\n\na"}]}]}` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":")"},{"type":"hardBreak…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":")"},{"type":"hardBreak…` |
| 120 | rt_adf | 2 | gen-adf 2 | `{"type":"doc","content":[{"type":"table","content":[{"type":"heading"},{"type":"orderedList","content":[{"type":"listIt…` | `[{"type":"heading","attrs":{"level":1},"content":[{"type":"text","text":""}]},{"type":"paragraph","content":[…` | `[{"type":"heading","attrs":{"level":1},"content":[]},{"type":"paragraph","content":[{"type":"text","text":"1.…` |
| 122 | rt_adf | 2 | gen-adf 2 | `{"type":"doc","content":[{"type":"listItem","content":[{"type":"orderedList","content":[{"type":"listItem"}]},{"type":"…` | `[{"type":"orderedList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text"…` | `[{"type":"orderedList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[]}]}]},{"type"…` |
| 123 | rt_adf | 2 | gen-adf 2 | `{"type":"doc","content":[{"type":"heading"},{"type":"text","text":")"}]}` | `[{"type":"heading","attrs":{"level":1},"content":[{"type":"text","text":""}]},{"type":"paragraph","content":[…` | `[{"type":"heading","attrs":{"level":1},"content":[]},{"type":"paragraph","content":[{"type":"text","text":")"…` |
| 124 | rt_adf | 2 | gen-adf 2 | `{"type":"doc","content":[{"type":"tableRow","content":[{"type":"heading"},{"type":"text","text":"r"}]}]}` | `[{"type":"heading","attrs":{"level":1},"content":[{"type":"text","text":""}]},{"type":"paragraph","content":[…` | `[{"type":"heading","attrs":{"level":1},"content":[]},{"type":"paragraph","content":[{"type":"text","text":"r"…` |
| 125 | rt_adf | 2 | gen-adf 2 | `{"type":"doc","content":[{"type":"listItem","content":[{"type":"orderedList","content":[{"type":"listItem"}]},{"type":"…` | `[{"type":"orderedList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text"…` | `[{"type":"orderedList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[]}]}]},{"type"…` |
| 127 | rt_adf | 2 | gen-adf 2 | `{"type":"doc","content":[{"type":"blockquote"},{"type":"bulletList","content":[{"type":"listItem"}]}]}` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":""}]}]},{"type":"paragr…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[]}]},{"type":"paragraph","content":[{"type":"…` |
| 129 | rt_adf | 2 | gen-adf 2 | `{"type":"doc","content":[{"type":"tableCell","content":[{"type":"heading"},{"type":"text","text":"o"}]}]}` | `[{"type":"heading","attrs":{"level":1},"content":[{"type":"text","text":""}]},{"type":"paragraph","content":[…` | `[{"type":"heading","attrs":{"level":1},"content":[]},{"type":"paragraph","content":[{"type":"text","text":"o"…` |
| 133 | rt_adf | 2 | gen-adf 2 | `{"type":"doc","content":[{"type":"tableRow","content":[{"type":"heading"},{"type":"bulletList","content":[{"type":"list…` | `[{"type":"heading","attrs":{"level":1},"content":[{"type":"text","text":""}]},{"type":"paragraph","content":[…` | `[{"type":"heading","attrs":{"level":1},"content":[]},{"type":"paragraph","content":[{"type":"text","text":"-"…` |
| 134 | rt_adf | 2 | gen-adf 2 | `{"type":"doc","content":[{"type":"blockquote","content":[{"type":"text","text":"t\n\n#"}]}]}` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"t"},{"type":"hardBreak…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"t"},{"type":"hardBreak…` |
| 136 | rt_adf | 2 | gen-adf 2 | `{"type":"doc","content":[{"type":"blockquote","content":[{"type":"text","text":"#\n\nv"}]}]}` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"#"},{"type":"hardBreak…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"#"},{"type":"hardBreak…` |
| 148 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"heading","content":[{"type":"text","text":"\n\nx"}]}]}` | `[{"type":"heading","attrs":{"level":1},"content":[{"type":"text","text":""}]},{"type":"paragraph","content":[…` | `[{"type":"heading","attrs":{"level":1},"content":[]},{"type":"paragraph","content":[{"type":"text","text":"x"…` |
| 151 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"blockquote","content":[{"type":"text","text":"\udffd\n\n\u00e9"}]}]}` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"\udffd"},{"type":"hard…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"\udffd"},{"type":"hard…` |
| 152 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"blockquote","content":[{"type":"text","text":")\n\n2"}]}]}` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":")"},{"type":"hardBreak…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":")"},{"type":"hardBreak…` |
| 153 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"\u00e9"}…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"\u00e9"},{"type":"hard…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"\u00e9"},{"type":"hard…` |
| 157 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"blockquote","content":[{"type":"text","text":")\n\n-"}]}]}` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":")"},{"type":"hardBreak…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":")"},{"type":"hardBreak…` |
| 158 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"panel","content":[{"type":"bulletList","content":[{"type":"listItem"}]},{"type":"head…` | `[{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text",…` | `[{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[]}]}]},{"type":…` |
| 159 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"blockquote","content":[{"type":"text","text":"2\n\n-"}]}]}` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"2"},{"type":"hardBreak…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"2"},{"type":"hardBreak…` |
| 160 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"\udffd"}…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"\udffd"},{"type":"hard…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"\udffd"},{"type":"hard…` |
| 161 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"orderedList","content":[{"type":"listItem"}]},{"type":"heading"}]}` | `[{"type":"orderedList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text"…` | `[{"type":"orderedList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[]}]}]},{"type"…` |
| 162 | rt_adf | 1 | gen-adf 1 | `` {"type":"doc","content":[{"type":"expand","content":[{"type":"heading"},{"type":"text","text":"`"}]}]} `` | `[{"type":"heading","attrs":{"level":1},"content":[{"type":"text","text":""}]},{"type":"paragraph","content":[…` | `` [{"type":"heading","attrs":{"level":1},"content":[]},{"type":"paragraph","content":[{"type":"text","text":"`"… `` |
| 163 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"blockquote","content":[{"type":"bulletList","content":[{"type":"listItem"}]},{"type":…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"- "},{"type":"hardBrea…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"- "},{"type":"hardBrea…` |
| 167 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"blockquote","content":[{"type":"text","text":"d\n\n."}]}]}` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"d"},{"type":"hardBreak…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"d"},{"type":"hardBreak…` |
| 168 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"blockquote","content":[{"type":"text","text":"\\\n\n]"}]}]}` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"\\"},{"type":"hardBrea…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"\\"},{"type":"hardBrea…` |
| 170 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"heading"},{"type":"text","text":"}"}]}` | `[{"type":"heading","attrs":{"level":1},"content":[{"type":"text","text":""}]},{"type":"paragraph","content":[…` | `[{"type":"heading","attrs":{"level":1},"content":[]},{"type":"paragraph","content":[{"type":"text","text":"}"…` |
| 171 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"blockquote","content":[{"type":"text","text":">\n\n\u00e9"}]}]}` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":">"},{"type":"hardBreak…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":">"},{"type":"hardBreak…` |
| 172 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"r"}]},{"…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"r"},{"type":"hardBreak…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"r"},{"type":"hardBreak…` |
| 175 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"bulletList","content":[{"type":"listItem"}]},{"type":"text","text":"\\"}]}` | `[{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text",…` | `[{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[]}]}]},{"type":…` |
| 176 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"heading"},{"type":"text","text":"~"}]}` | `[{"type":"heading","attrs":{"level":1},"content":[{"type":"text","text":""}]},{"type":"paragraph","content":[…` | `[{"type":"heading","attrs":{"level":1},"content":[]},{"type":"paragraph","content":[{"type":"text","text":"~"…` |
| 177 | rt_adf | 1 | gen-adf 1 | `` {"type":"doc","content":[{"type":"blockquote","content":[{"type":"text","text":"r\n\n`"}]}]} `` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"r"},{"type":"hardBreak…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"r"},{"type":"hardBreak…` |
| 179 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"blockquote","content":[{"type":"text","text":"\u00e9\n\n="}]}]}` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"\u00e9"},{"type":"hard…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"\u00e9"},{"type":"hard…` |
| 182 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"panel","content":[{"type":"heading"},{"type":"orderedList","content":[{"type":"listIt…` | `[{"type":"heading","attrs":{"level":1},"content":[{"type":"text","text":""}]},{"type":"paragraph","content":[…` | `[{"type":"heading","attrs":{"level":1},"content":[]},{"type":"paragraph","content":[{"type":"text","text":"1.…` |
| 184 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"blockquote","content":[{"type":"orderedList","content":[{"type":"listItem"}]},{"type"…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"1. "},{"type":"hardBre…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"1. "},{"type":"hardBre…` |
| 187 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"]"}]},{"…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"]"},{"type":"hardBreak…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"]"},{"type":"hardBreak…` |
| 190 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"decisionList","content":[{"type":"heading"},{"type":"text","text":"E"}]}]}` | `[{"type":"heading","attrs":{"level":1},"content":[{"type":"text","text":""}]},{"type":"paragraph","content":[…` | `[{"type":"heading","attrs":{"level":1},"content":[]},{"type":"paragraph","content":[{"type":"text","text":"E"…` |
| 194 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"blockquote","content":[{"type":"orderedList","content":[{"type":"listItem"}]},{"type"…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"1. "},{"type":"hardBre…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"1. "},{"type":"hardBre…` |
| 195 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"blockquote","content":[{"type":"text","text":"e\n\n>"}]}]}` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"e"},{"type":"hardBreak…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"e"},{"type":"hardBreak…` |
| 197 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"blockquote"},{"type":"text","text":"\""}]}` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":""}]}]},{"type":"paragr…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[]}]},{"type":"paragraph","content":[{"type":"…` |
| 198 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"blockquote","content":[{"type":"text","text":"\n\n","marks":[{"type":"link"}]}]}]}` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"["},{"type":"hardBreak…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"["},{"type":"hardBreak…` |
| 200 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"bulletList","content":[{"type":"listItem"}]},{"type":"blockCard","attrs":{"url":"r"}}…` | `[{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text",…` | `[{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[]}]}]},{"type":…` |
| 201 | rt_adf | 1 | gen-adf 1 | `{"content":[{"type":"blockquote","content":[{"type":"codeBlock"}]}]}` | ```` [{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"```"},{"type":"hardBre… ```` | ```` [{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"```"},{"type":"hardBre… ```` |
| 203 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"_"},{"ty…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"_"},{"type":"hardBreak…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"_"},{"type":"hardBreak…` |
| 204 | rt_adf | 1 | gen-adf 1 | `` {"type":"doc","content":[{"type":"bulletList","content":[{"type":"listItem"}]},{"type":"text","text":"`"}]} `` | `[{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text",…` | `[{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[]}]}]},{"type":…` |
| 208 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"blockquote","content":[{"type":"text","text":"$\n\nO"}]}]}` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"$"},{"type":"hardBreak…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"$"},{"type":"hardBreak…` |
| 210 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"blockquote","content":[{"type":"text","text":"a\n\n_"}]}]}` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"a"},{"type":"hardBreak…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"a"},{"type":"hardBreak…` |
| 211 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"heading"},{"type":"text","text":"2"}]}` | `[{"type":"heading","attrs":{"level":1},"content":[{"type":"text","text":""}]},{"type":"paragraph","content":[…` | `[{"type":"heading","attrs":{"level":1},"content":[]},{"type":"paragraph","content":[{"type":"text","text":"2"…` |
| 213 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"bulletList","content":[{"type":"listItem"}]},{"type":"heading"}]}` | `[{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text",…` | `[{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[]}]}]},{"type":…` |
| 214 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"expand","content":[{"type":"heading"},{"type":"inlineCard","attrs":{"url":"d"}}]}]}` | `[{"type":"heading","attrs":{"level":1},"content":[{"type":"text","text":""}]},{"type":"paragraph","content":[…` | `[{"type":"heading","attrs":{"level":1},"content":[]},{"type":"paragraph","content":[{"type":"text","text":"d"…` |
| 215 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"r"},{"ty…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"r"},{"type":"hardBreak…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"r"},{"type":"hardBreak…` |
| 216 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"blockquote","content":[{"type":"text","text":"-\n\n2"}]}]}` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"-"},{"type":"hardBreak…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"-"},{"type":"hardBreak…` |
| 217 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"blockquote","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"e"},{"type":"hardBreak…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"e"},{"type":"hardBreak…` |
| 218 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"blockquote","content":[{"type":"orderedList","content":[{"type":"listItem"}]},{"type"…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"1. "},{"type":"hardBre…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"1. "},{"type":"hardBre…` |
| 220 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"blockquote","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"e"},{"type":"hardBreak…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"e"},{"type":"hardBreak…` |
| 221 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"blockquote","content":[{"type":"text","text":":\n\ne"}]}]}` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":":"},{"type":"hardBreak…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":":"},{"type":"hardBreak…` |
| 222 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"blockquote","content":[{"type":"text","text":"+\n\na"}]}]}` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"+"},{"type":"hardBreak…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"+"},{"type":"hardBreak…` |
| 223 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"blockquote","content":[{"type":"text","text":"e\n\n="}]}]}` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"e"},{"type":"hardBreak…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"e"},{"type":"hardBreak…` |
| 224 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"x"}]},{"…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"x"},{"type":"hardBreak…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"x"},{"type":"hardBreak…` |
| 225 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"tableRow","content":[{"type":"blockquote"},{"type":"text","text":"("}]}]}` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":""}]}]},{"type":"paragr…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[]}]},{"type":"paragraph","content":[{"type":"…` |
| 228 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"blockquote","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"\u00e9"},{"type":"hard…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"\u00e9"},{"type":"hard…` |
| 230 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"blockquote","content":[{"type":"text","text":"_\n\nA"}]}]}` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"_"},{"type":"hardBreak…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"_"},{"type":"hardBreak…` |
| 231 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"blockquote","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"-"},{"type":"hardBreak…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"-"},{"type":"hardBreak…` |
| 232 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"blockquote"},{"type":"text","text":"%"}]}` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":""}]}]},{"type":"paragr…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[]}]},{"type":"paragraph","content":[{"type":"…` |
| 234 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"table","content":[{"type":"heading"},{"type":"text","text":"#"}]}]}` | `[{"type":"heading","attrs":{"level":1},"content":[{"type":"text","text":""}]},{"type":"paragraph","content":[…` | `[{"type":"heading","attrs":{"level":1},"content":[]},{"type":"paragraph","content":[{"type":"text","text":"#"…` |
| 235 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"heading"},{"type":"text","text":"%"}]}` | `[{"type":"heading","attrs":{"level":1},"content":[{"type":"text","text":""}]},{"type":"paragraph","content":[…` | `[{"type":"heading","attrs":{"level":1},"content":[]},{"type":"paragraph","content":[{"type":"text","text":"%"…` |
| 236 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"blockquote","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"+"},{"type":"hardBreak…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"+"},{"type":"hardBreak…` |
| 237 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"\\"},{"t…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"\\"},{"type":"hardBrea…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"\\"},{"type":"hardBrea…` |
| 238 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"blockquote","content":[{"type":"text","text":")\n\n#"}]}]}` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":")"},{"type":"hardBreak…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":")"},{"type":"hardBreak…` |
| 239 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"blockquote","content":[{"type":"text","text":"#\n\n/"}]}]}` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"#"},{"type":"hardBreak…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"#"},{"type":"hardBreak…` |
| 241 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"~"},{"ty…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"~"},{"type":"hardBreak…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"~"},{"type":"hardBreak…` |
| 242 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"s"},{"ty…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"s"},{"type":"hardBreak…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"s"},{"type":"hardBreak…` |
| 245 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"blockquote","content":[{"type":"text","text":"2\n\n2"}]}]}` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"2"},{"type":"hardBreak…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"2"},{"type":"hardBreak…` |
| 246 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"listItem","content":[{"type":"bulletList","content":[{"type":"listItem"}]},{"type":"t…` | `[{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text",…` | `[{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[]}]}]},{"type":…` |
| 247 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"blockquote"},{"type":"blockquote"}]}` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":""}]}]},{"type":"paragr…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[]}]},{"type":"paragraph","content":[{"type":"…` |
| 249 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"blockquote","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"+"},{"type":"hardBreak…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"+"},{"type":"hardBreak…` |
| 250 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"blockquote","content":[{"type":"text","text":"\n\n","marks":[{"type":"strike"}]}]}]}` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"~~"},{"type":"hardBrea…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"~~"},{"type":"hardBrea…` |
| 251 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"blockquote","content":[{"type":"text","text":"(\n\na"}]}]}` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"("},{"type":"hardBreak…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"("},{"type":"hardBreak…` |
| 252 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"a"}]},{"…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"a"},{"type":"hardBreak…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"a"},{"type":"hardBreak…` |
| 253 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"+"},{"ty…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"+"},{"type":"hardBreak…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"+"},{"type":"hardBreak…` |
| 254 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"blockquote"},{"type":"rule"}]}` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":""}]}]},{"type":"rule"}]` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[]}]},{"type":"rule"}]` |
| 256 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"heading"},{"type":"text","text":"^"}]}` | `[{"type":"heading","attrs":{"level":1},"content":[{"type":"text","text":""}]},{"type":"paragraph","content":[…` | `[{"type":"heading","attrs":{"level":1},"content":[]},{"type":"paragraph","content":[{"type":"text","text":"^"…` |
| 257 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"tableHeader","content":[{"type":"heading"},{"type":"blockquote"}]}]}` | `[{"type":"heading","attrs":{"level":1},"content":[{"type":"text","text":""}]},{"type":"paragraph","content":[…` | `[{"type":"heading","attrs":{"level":1},"content":[]},{"type":"paragraph","content":[{"type":"text","text":">"…` |
| 258 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"tableHeader","content":[{"type":"heading"},{"type":"rule"}]}]}` | `[{"type":"heading","attrs":{"level":1},"content":[{"type":"text","text":""}]},{"type":"rule"}]` | `[{"type":"heading","attrs":{"level":1},"content":[]},{"type":"rule"}]` |
| 259 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"expand","content":[{"type":"heading"},{"type":"text","text":"{"}]}]}` | `[{"type":"heading","attrs":{"level":1},"content":[{"type":"text","text":""}]},{"type":"paragraph","content":[…` | `[{"type":"heading","attrs":{"level":1},"content":[]},{"type":"paragraph","content":[{"type":"text","text":"{"…` |
| 260 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"x"},{"ty…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"x"},{"type":"hardBreak…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"x"},{"type":"hardBreak…` |
| 261 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"blockquote","content":[{"type":"text","text":"a\n\n\|"}]}]}` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"a"},{"type":"hardBreak…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"a"},{"type":"hardBreak…` |
| 262 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"tableRow","content":[{"type":"heading"},{"type":"codeBlock"}]}]}` | `[{"type":"heading","attrs":{"level":1},"content":[{"type":"text","text":""}]},{"type":"codeBlock","content":[…` | `[{"type":"heading","attrs":{"level":1},"content":[]},{"type":"codeBlock","content":[]},{"type":"codeBlock","c…` |
| 263 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"tableCell","content":[{"type":"heading"},{"type":"text","text":"2"}]}]}` | `[{"type":"heading","attrs":{"level":1},"content":[{"type":"text","text":""}]},{"type":"paragraph","content":[…` | `[{"type":"heading","attrs":{"level":1},"content":[]},{"type":"paragraph","content":[{"type":"text","text":"2"…` |
| 264 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"blockquote","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"a"},{"type":"hardBreak…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"a"},{"type":"hardBreak…` |
| 265 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"blockquote","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":":"},{"type":"hardBreak…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":":"},{"type":"hardBreak…` |
| 266 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"blockquote","content":[{"type":"text","text":">\n\n:"}]}]}` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":">"},{"type":"hardBreak…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":">"},{"type":"hardBreak…` |
| 267 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"blockquote","content":[{"type":"text","text":"e\n\n-"}]}]}` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"e"},{"type":"hardBreak…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"e"},{"type":"hardBreak…` |
| 268 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"blockquote","content":[{"type":"bulletList","content":[{"type":"listItem"}]},{"type":…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"- "},{"type":"hardBrea…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"- "},{"type":"hardBrea…` |
| 273 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"tableRow","content":[{"type":"blockquote"},{"type":"emoji","attrs":{"text":"\u2714"}}…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":""}]}]},{"type":"paragr…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[]}]},{"type":"paragraph","content":[{"type":"…` |
| 274 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"blockquote","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"s"},{"type":"hardBreak…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"s"},{"type":"hardBreak…` |
| 276 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"bulletList","content":[{"type":"listItem"}]},{"type":"orderedList","content":[{"type"…` | `[{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text",…` | `[{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[]}]}]},{"type":…` |
| 279 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"tableRow","content":[{"type":"heading"},{"type":"text","text":"("}]}]}` | `[{"type":"heading","attrs":{"level":1},"content":[{"type":"text","text":""}]},{"type":"paragraph","content":[…` | `[{"type":"heading","attrs":{"level":1},"content":[]},{"type":"paragraph","content":[{"type":"text","text":"("…` |
| 281 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"table","content":[{"type":"heading"},{"type":"text","text":"o"}]}]}` | `[{"type":"heading","attrs":{"level":1},"content":[{"type":"text","text":""}]},{"type":"paragraph","content":[…` | `[{"type":"heading","attrs":{"level":1},"content":[]},{"type":"paragraph","content":[{"type":"text","text":"o"…` |
| 283 | rt_adf | 1 | gen-adf 1 | `` {"type":"doc","content":[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"`"},{"ty… `` | `` [{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"`"},{"type":"hardBreak… `` | `` [{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"`"},{"type":"hardBreak… `` |
| 287 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"tableCell","content":[{"type":"heading"},{"type":"heading"}]}]}` | `[{"type":"heading","attrs":{"level":1},"content":[{"type":"text","text":""}]},{"type":"paragraph","content":[…` | `[{"type":"heading","attrs":{"level":1},"content":[]},{"type":"paragraph","content":[{"type":"text","text":"#"…` |
| 289 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"tableCell","content":[{"type":"heading"},{"type":"bulletList","content":[{"type":"lis…` | `[{"type":"heading","attrs":{"level":1},"content":[{"type":"text","text":""}]},{"type":"paragraph","content":[…` | `[{"type":"heading","attrs":{"level":1},"content":[]},{"type":"paragraph","content":[{"type":"text","text":"-"…` |
| 291 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"tableRow","content":[{"type":"heading"},{"type":"blockquote"}]}]}` | `[{"type":"heading","attrs":{"level":1},"content":[{"type":"text","text":""}]},{"type":"paragraph","content":[…` | `[{"type":"heading","attrs":{"level":1},"content":[]},{"type":"paragraph","content":[{"type":"text","text":">"…` |
| 292 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"table","content":[{"type":"bulletList","content":[{"type":"listItem"}]},{"type":"text…` | `[{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text",…` | `[{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[]}]}]},{"type":…` |
| 293 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"blockquote","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"2"},{"type":"hardBreak…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"2"},{"type":"hardBreak…` |
| 296 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"blockquote","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"-"},{"type":"hardBreak…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"-"},{"type":"hardBreak…` |
| 297 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"heading"},{"type":"emoji","attrs":{"text":"\u2714"}}]}` | `[{"type":"heading","attrs":{"level":1},"content":[{"type":"text","text":""}]},{"type":"paragraph","content":[…` | `[{"type":"heading","attrs":{"level":1},"content":[]},{"type":"paragraph","content":[{"type":"text","text":"\u…` |
| 298 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"blockquote"},{"type":"heading"}]}` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":""}]}]},{"type":"paragr…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[]}]},{"type":"paragraph","content":[{"type":"…` |
| 299 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"blockquote","content":[{"type":"text","text":"=\n\ns"}]}]}` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"="},{"type":"hardBreak…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"="},{"type":"hardBreak…` |
| 302 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"blockquote","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"r"},{"type":"hardBreak…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"r"},{"type":"hardBreak…` |
| 303 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"listItem","content":[{"type":"bulletList","content":[{"type":"listItem"}]},{"type":"c…` | `[{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text",…` | `[{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[]}]}]},{"type":…` |
| 306 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"~"}]},{"…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"~"},{"type":"hardBreak…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"~"},{"type":"hardBreak…` |
| 307 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"blockquote","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"E"},{"type":"hardBreak…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"E"},{"type":"hardBreak…` |
| 311 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"blockquote","content":[{"type":"text","text":"a\n\n;"}]}]}` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"a"},{"type":"hardBreak…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"a"},{"type":"hardBreak…` |
| 312 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"heading"},{"type":"text","text":">"}]}` | `[{"type":"heading","attrs":{"level":1},"content":[{"type":"text","text":""}]},{"type":"paragraph","content":[…` | `[{"type":"heading","attrs":{"level":1},"content":[]},{"type":"paragraph","content":[{"type":"text","text":">"…` |
| 315 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"tableRow","content":[{"type":"heading"},{"type":"heading"}]}]}` | `[{"type":"heading","attrs":{"level":1},"content":[{"type":"text","text":""}]},{"type":"paragraph","content":[…` | `[{"type":"heading","attrs":{"level":1},"content":[]},{"type":"paragraph","content":[{"type":"text","text":"#"…` |
| 316 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"blockquote","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"*"},{"type":"hardBreak…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"*"},{"type":"hardBreak…` |
| 317 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"blockquote","content":[{"type":"text","text":"!\n\ng"}]}]}` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"!"},{"type":"hardBreak…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"!"},{"type":"hardBreak…` |
| 321 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"emoji","attrs":{"short…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":":"},{"type":"hardBreak…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":":"},{"type":"hardBreak…` |
| 323 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"heading"},{"type":"text","text":"#"}]}` | `[{"type":"heading","attrs":{"level":1},"content":[{"type":"text","text":""}]},{"type":"paragraph","content":[…` | `[{"type":"heading","attrs":{"level":1},"content":[]},{"type":"paragraph","content":[{"type":"text","text":"#"…` |
| 328 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"_"}]},{"…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"_"},{"type":"hardBreak…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"_"},{"type":"hardBreak…` |
| 330 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"tableRow","content":[{"type":"heading"},{"type":"text","text":"*"}]}]}` | `[{"type":"heading","attrs":{"level":1},"content":[{"type":"text","text":""}]},{"type":"paragraph","content":[…` | `[{"type":"heading","attrs":{"level":1},"content":[]},{"type":"paragraph","content":[{"type":"text","text":"*"…` |
| 331 | rt_adf | 1 | gen-adf 1 | `` {"type":"doc","content":[{"type":"blockquote","content":[{"type":"text","text":"`\n\ne"}]}]} `` | `` [{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"`"},{"type":"hardBreak… `` | `` [{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"`"},{"type":"hardBreak… `` |
| 336 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"heading"},{"type":"text","text":"-"}]}` | `[{"type":"heading","attrs":{"level":1},"content":[{"type":"text","text":""}]},{"type":"paragraph","content":[…` | `[{"type":"heading","attrs":{"level":1},"content":[]},{"type":"paragraph","content":[{"type":"text","text":"-"…` |
| 337 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"blockquote","content":[{"type":"text","text":"a\n\n]"}]}]}` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"a"},{"type":"hardBreak…` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"a"},{"type":"hardBreak…` |

### 2c. A `blockCard` no longer fuses with the next block (57 groups, 122 cells)

**What changed.** Old renders a block-level smart-link card as its bare URL with no block separator. B ends it with a blank line, like every other block.

**Real-shaped example.** `[p("See:"), blockCard("https://example.atlassian.net/browse/ABC-1"), p("Thanks")]`:

- Old gives `…/ABC-1Thanks`, which marked shows as a single link to a wrong URL.
- B gives the card URL and `Thanks` as separate paragraphs.

**Scope.** This is display only, because the gate refuses writes over cards. Most members come from the `spec` profile; some carriers, such as cards in table rows, are malformed.

| # | fn | cells | sources | minimal input | old | B |
|---|---|---|---|---|---|---|
| 36 | a2m | 9 | gen-adf 9 | `{"type":"doc","content":[{"type":"blockCard","attrs":{"url":"o"}},{"type":"text","text":"n"}]}` | `"on"` | `"o\n\nn"` |
| 40 | a2m | 8 | gen-adf 8 | `{"type":"doc","content":[{"type":"blockCard","attrs":{"url":")"}},{"type":"blockquote"}]}` | `")>"` | `")\n\n>"` |
| 44 | a2m | 7 | gen-adf 7 | `{"type":"doc","content":[{"type":"blockCard","attrs":{"url":")"}},{"type":"heading"}]}` | `")#"` | `")\n\n#"` |
| 45 | rt_adf | 7 | gen-adf 7 | `{"type":"doc","content":[{"type":"blockCard","attrs":{"url":"o"}},{"type":"text","text":"n"}]}` | `[{"type":"paragraph","content":[{"type":"text","text":"on"}]}]` | `[{"type":"paragraph","content":[{"type":"text","text":"o"}]},{"type":"paragraph","content":[{"type":"text","t…` |
| 51 | rt_adf | 6 | gen-adf 6 | `{"type":"doc","content":[{"type":"blockCard","attrs":{"url":")"}},{"type":"heading"}]}` | `[{"type":"paragraph","content":[{"type":"text","text":")#"}]}]` | `[{"type":"paragraph","content":[{"type":"text","text":")"}]},{"type":"paragraph","content":[{"type":"text","t…` |
| 61 | rt_adf | 5 | gen-adf 5 | `{"type":"doc","content":[{"type":"blockCard","attrs":{"url":")"}},{"type":"orderedList","content":[{"type":"listItem"}]…` | `[{"type":"paragraph","content":[{"type":"text","text":")1."}]}]` | `[{"type":"paragraph","content":[{"type":"text","text":")"}]},{"type":"paragraph","content":[{"type":"text","t…` |
| 67 | a2m | 4 | gen-adf 4 | `{"type":"doc","content":[{"type":"blockCard","attrs":{"url":"r"}},{"type":"codeBlock"}]}` | ```` "r```\n\n```" ```` | ```` "r\n\n```\n\n```" ```` |
| 75 | rt_adf | 4 | gen-adf 4 | `{"type":"doc","content":[{"type":"blockCard","attrs":{"url":"r"}},{"type":"rule"}]}` | `[{"type":"paragraph","content":[{"type":"text","text":"r---"}]}]` | `[{"type":"paragraph","content":[{"type":"text","text":"r"}]},{"type":"rule"}]` |
| 76 | a2m | 4 | gen-adf 4 | `{"type":"doc","content":[{"type":"blockCard","attrs":{"url":"h"}},{"type":"bulletList","content":[{"type":"listItem"}]}…` | `"h-"` | `"h\n\n-"` |
| 81 | rt_adf | 3 | gen-adf 3 | `{"type":"doc","content":[{"type":"blockCard","attrs":{"url":"h"}},{"type":"blockquote"}]}` | `[{"type":"paragraph","content":[{"type":"text","text":"h>"}]}]` | `[{"type":"paragraph","content":[{"type":"text","text":"h"}]},{"type":"paragraph","content":[{"type":"text","t…` |
| 82 | a2m | 3 | gen-adf 3 | `{"type":"doc","content":[{"type":"blockCard","attrs":{"url":"r"}},{"type":"rule"}]}` | `"r---"` | `"r\n\n---"` |
| 83 | a2m | 3 | gen-adf 3 | `{"type":"doc","content":[{"type":"tableRow","content":[{"type":"blockCard","attrs":{"url":"m"}},{"type":"blockquote"}]}…` | `"m>"` | `"m\n\n>"` |
| 85 | a2m | 3 | gen-adf 3 | `{"type":"doc","content":[{"type":"blockCard","attrs":{"url":"d"}},{"type":"orderedList","content":[{"type":"listItem"}]…` | `"d1."` | `"d\n\n1."` |
| 89 | rt_adf | 3 | gen-adf 3 | `{"type":"doc","content":[{"type":"tableRow","content":[{"type":"blockCard","attrs":{"url":"m"}},{"type":"text","text":"…` | `[{"type":"paragraph","content":[{"type":"text","text":"mE"}]}]` | `[{"type":"paragraph","content":[{"type":"text","text":"m"}]},{"type":"paragraph","content":[{"type":"text","t…` |
| 96 | a2m | 2 | gen-adf 2 | `{"type":"doc","content":[{"type":"blockCard","attrs":{"url":"o"}},{"type":"blockCard","attrs":{"url":"m"}}]}` | `"om"` | `"o\n\nm"` |
| 98 | a2m | 2 | gen-adf 2 | `{"type":"doc","content":[{"type":"tableHeader","content":[{"type":"blockCard","attrs":{"url":"d"}},{"type":"blockquote"…` | `"d>"` | `"d\n\n>"` |
| 100 | rt_adf | 2 | gen-adf 2 | `{"type":"doc","content":[{"type":"blockCard","attrs":{"url":"r"}},{"type":"text","text":"+"}]}` | `[{"type":"paragraph","content":[{"type":"text","text":"r+"}]}]` | `[{"type":"paragraph","content":[{"type":"text","text":"r"}]},{"type":"paragraph","content":[{"type":"text","t…` |
| 106 | a2m | 2 | gen-adf 2 | `{"type":"doc","content":[{"type":"expand","content":[{"type":"blockCard","attrs":{"url":"h"}},{"type":"bulletList","con…` | `"h-"` | `"h\n\n-"` |
| 111 | rt_adf | 2 | gen-adf 2 | `{"type":"doc","content":[{"type":"tableCell","content":[{"type":"blockCard","attrs":{"url":"m"}},{"type":"bulletList","…` | `[{"type":"paragraph","content":[{"type":"text","text":"m-"}]}]` | `[{"type":"paragraph","content":[{"type":"text","text":"m"}]},{"type":"paragraph","content":[{"type":"text","t…` |
| 121 | a2m | 2 | gen-adf 2 | `{"type":"doc","content":[{"type":"tableHeader","content":[{"type":"blockCard","attrs":{"url":")"}},{"type":"codeBlock"}…` | ```` ")```\n\n```" ```` | ```` ")\n\n```\n\n```" ```` |
| 128 | a2m | 2 | gen-adf 2 | `{"type":"doc","content":[{"type":"tableRow","content":[{"type":"blockCard","attrs":{"url":")"}},{"type":"text","text":"…` | `")r"` | `")\n\nr"` |
| 130 | a2m | 2 | gen-adf 2 | `{"type":"doc","content":[{"type":"tableRow","content":[{"type":"blockCard","attrs":{"url":"o"}},{"type":"heading"}]}]}` | `"o#"` | `"o\n\n#"` |
| 132 | a2m | 2 | gen-adf 2 | `{"type":"doc","content":[{"type":"blockCard","attrs":{"url":"o"}},{"type":"inlineCard","attrs":{"url":"r"}}]}` | `"or"` | `"o\n\nr"` |
| 135 | a2m | 2 | gen-adf 2 | `{"type":"doc","content":[{"type":"blockCard","attrs":{"url":"r"}},{"type":"text","text":")"}]}` | `"r)"` | `"r\n\n)"` |
| 143 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"blockCard","attrs":{"url":"o"}},{"type":"blockCard","attrs":{"url":"m"}}]}` | `[{"type":"paragraph","content":[{"type":"text","text":"om"}]}]` | `[{"type":"paragraph","content":[{"type":"text","text":"o"}]},{"type":"paragraph","content":[{"type":"text","t…` |
| 146 | a2m | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"blockCard","attrs":{"url":"r"}},{"type":"text","text":"&"}]}` | `"r&"` | `"r\n\n&"` |
| 147 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"blockCard","attrs":{"url":"r"}},{"type":"text","text":"&"}]}` | `[{"type":"paragraph","content":[{"type":"text","text":"r&"}]}]` | `[{"type":"paragraph","content":[{"type":"text","text":"r"}]},{"type":"paragraph","content":[{"type":"text","t…` |
| 154 | a2m | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"blockCard","attrs":{"url":"r"}},{"type":"text","text":"+"}]}` | `"r+"` | `"r\n\n+"` |
| 165 | a2m | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"blockCard","attrs":{"url":"d"}},{"type":"emoji","attrs":{"shortName":":"}}]}` | `"d:"` | `"d\n\n:"` |
| 166 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"blockCard","attrs":{"url":"d"}},{"type":"emoji","attrs":{"shortName":":"}}]}` | `[{"type":"paragraph","content":[{"type":"text","text":"d:"}]}]` | `[{"type":"paragraph","content":[{"type":"text","text":"d"}]},{"type":"paragraph","content":[{"type":"text","t…` |
| 169 | a2m | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"text","text":"\u00e9"},{"type":"blockCard"},{"type":"text","text":"d"}]}` | `"\u00e9d"` | `"\u00e9\n\nd"` |
| 180 | a2m | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"blockCard","attrs":{"url":"o"}},{"type":"text","text":"\udffd"}]}` | `"o\udffd"` | `"o\n\n\udffd"` |
| 181 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"blockCard","attrs":{"url":"o"}},{"type":"text","text":"\udffd"}]}` | `[{"type":"paragraph","content":[{"type":"text","text":"o\udffd"}]}]` | `[{"type":"paragraph","content":[{"type":"text","text":"o"}]},{"type":"paragraph","content":[{"type":"text","t…` |
| 193 | a2m | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"tableCell","content":[{"type":"blockCard","attrs":{"url":"m"}},{"type":"bulletList","…` | `"m-"` | `"m\n\n-"` |
| 206 | a2m | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"expand","content":[{"type":"blockCard","attrs":{"url":"o"}},{"type":"text","text":"t"…` | `"ot"` | `"o\n\nt"` |
| 207 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"expand","content":[{"type":"blockCard","attrs":{"url":"o"}},{"type":"text","text":"t"…` | `[{"type":"paragraph","content":[{"type":"text","text":"ot"}]}]` | `[{"type":"paragraph","content":[{"type":"text","text":"o"}]},{"type":"paragraph","content":[{"type":"text","t…` |
| 226 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"tableHeader","content":[{"type":"blockCard","attrs":{"url":"o"}},{"type":"text","mark…` | `[{"type":"paragraph","content":[{"type":"text","text":"o"},{"type":"text","text":"","marks":[{"type":"link","…` | `[{"type":"paragraph","content":[{"type":"text","text":"o"}]},{"type":"paragraph","content":[{"type":"text","t…` |
| 240 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"expand","content":[{"type":"blockCard","attrs":{"url":")"}},{"type":"bulletList","con…` | `[{"type":"paragraph","content":[{"type":"text","text":")-"}]}]` | `[{"type":"paragraph","content":[{"type":"text","text":")"}]},{"type":"paragraph","content":[{"type":"text","t…` |
| 255 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"blockCard","attrs":{"url":"h"}},{"type":"bulletList","content":[{"type":"listItem"}]}…` | `[{"type":"paragraph","content":[{"type":"text","text":"h-"}]}]` | `[{"type":"paragraph","content":[{"type":"text","text":"h"}]},{"type":"paragraph","content":[{"type":"text","t…` |
| 271 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"tableRow","content":[{"type":"blockCard","attrs":{"url":"o"}},{"type":"heading"}]}]}` | `[{"type":"paragraph","content":[{"type":"text","text":"o#"}]}]` | `[{"type":"paragraph","content":[{"type":"text","text":"o"}]},{"type":"paragraph","content":[{"type":"text","t…` |
| 282 | a2m | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"tableRow","content":[{"type":"blockCard","attrs":{"url":"m"}},{"type":"codeBlock"}]}]}` | ```` "m```\n\n```" ```` | ```` "m\n\n```\n\n```" ```` |
| 284 | a2m | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"tableHeader","content":[{"type":"blockCard","attrs":{"url":"r"}},{"type":"heading"}]}…` | `"r#"` | `"r\n\n#"` |
| 285 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"tableHeader","content":[{"type":"blockCard","attrs":{"url":"r"}},{"type":"heading"}]}…` | `[{"type":"paragraph","content":[{"type":"text","text":"r#"}]}]` | `[{"type":"paragraph","content":[{"type":"text","text":"r"}]},{"type":"paragraph","content":[{"type":"text","t…` |
| 286 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"tableHeader","content":[{"type":"blockCard","attrs":{"url":"d"}},{"type":"blockquote"…` | `[{"type":"paragraph","content":[{"type":"text","text":"d>"}]}]` | `[{"type":"paragraph","content":[{"type":"text","text":"d"}]},{"type":"paragraph","content":[{"type":"text","t…` |
| 290 | a2m | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"table","content":[{"type":"blockCard","attrs":{"url":"r"}},{"type":"text","text":"a"}…` | `"ra"` | `"r\n\na"` |
| 294 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"blockCard","attrs":{"url":"r"}},{"type":"text","text":"*"}]}` | `[{"type":"paragraph","content":[{"type":"text","text":"r*"}]}]` | `[{"type":"paragraph","content":[{"type":"text","text":"r"}]},{"type":"paragraph","content":[{"type":"text","t…` |
| 295 | a2m | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"text","text":"o"},{"type":"blockCard"},{"type":"blockquote"}]}` | `"o>"` | `"o\n\n>"` |
| 304 | a2m | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"tableCell","content":[{"type":"blockCard","attrs":{"url":"m"}},{"type":"codeBlock"}]}…` | ```` "m```\n\n```" ```` | ```` "m\n\n```\n\n```" ```` |
| 305 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"blockCard","attrs":{"url":"r"}},{"type":"text","text":")"}]}` | `[{"type":"paragraph","content":[{"type":"text","text":"r)"}]}]` | `[{"type":"paragraph","content":[{"type":"text","text":"r"}]},{"type":"paragraph","content":[{"type":"text","t…` |
| 308 | a2m | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"tableCell","content":[{"type":"blockCard","attrs":{"url":"d"}},{"type":"text","text":…` | `"dr"` | `"d\n\nr"` |
| 309 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"tableCell","content":[{"type":"blockCard","attrs":{"url":"d"}},{"type":"text","text":…` | `[{"type":"paragraph","content":[{"type":"text","text":"dr"}]}]` | `[{"type":"paragraph","content":[{"type":"text","text":"d"}]},{"type":"paragraph","content":[{"type":"text","t…` |
| 320 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"tableRow","content":[{"type":"blockCard","attrs":{"url":"o"}},{"type":"blockquote"}]}…` | `[{"type":"paragraph","content":[{"type":"text","text":"o>"}]}]` | `[{"type":"paragraph","content":[{"type":"text","text":"o"}]},{"type":"paragraph","content":[{"type":"text","t…` |
| 325 | a2m | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"tableCell","content":[{"type":"blockCard","attrs":{"url":"o"}},{"type":"heading"}]}]}` | `"o#"` | `"o\n\n#"` |
| 326 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"tableCell","content":[{"type":"blockCard","attrs":{"url":"o"}},{"type":"heading"}]}]}` | `[{"type":"paragraph","content":[{"type":"text","text":"o#"}]}]` | `[{"type":"paragraph","content":[{"type":"text","text":"o"}]},{"type":"paragraph","content":[{"type":"text","t…` |
| 329 | a2m | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"tableCell","content":[{"type":"blockCard","attrs":{"url":"m"}},{"type":"blockquote"}]…` | `"m>"` | `"m\n\n>"` |
| 332 | rt_adf | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"tableRow","content":[{"type":"blockCard","attrs":{"url":"m"}},{"type":"bulletList","c…` | `[{"type":"paragraph","content":[{"type":"text","text":"m-"}]}]` | `[{"type":"paragraph","content":[{"type":"text","text":"m"}]},{"type":"paragraph","content":[{"type":"text","t…` |
| 335 | a2m | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"text","text":"r"},{"type":"blockCard"},{"type":"text","text":"-"}]}` | `"r-"` | `"r\n\n-"` |

### 2d. `----` is written as a rule (2 groups, 11 cells)

**What changed.** Old's writer makes a rule only when the block, after trimming, is exactly `---`, so `----` was stored as literal text. B accepts any `^-{3,}$`, and CommonMark agrees that this is a thematic break.

**Caveat.** These two groups' full inputs differ for other reasons (the shrinker drifted). The opposite case is a lone `--- ` or ` ---` block: old makes it a rule, B makes it text. The corpus does not reach that case; see "Not reached by the corpus".

| # | fn | cells | sources | minimal input | old | B |
|---|---|---|---|---|---|---|
| 33 | rt_md | 9 | gen-md 9 | `"----"` | `"\\----"` | `"---"` |
| 91 | m2a | 2 | gen-md 2 | `"----"` | `[{"type":"paragraph","content":[{"type":"text","text":"----"}]}]` | `[{"type":"rule"}]` |

## Class 3: regressions in B (18 groups, 1,217 cells)

### 3a. Link URLs containing `(` (#0, #1, #42, #313; 1,085 cells)

**What changed.** The original's reader escapes `\`, `(` and `)` in an href, and its writer unescapes all three. B escapes and unescapes only `\` and `)`. This follows the comment's wording ("only an unescaped `)` ends it"), not the code.

**Why the tests still pass.** Inside Harbour the round trip is still exact, because B's writer reads up to the first unescaped `)`.

**What breaks is the display.** `adfToMarkdown` output is rendered by marked. When a URL holds a balanced pair, B leaves the `(` unescaped and escapes the `)`. To CommonMark (and to marked) the parentheses no longer balance, so the destination is not a link. The test suite's own fixture shows it (tests-adf#99: link text `Foo`, href `https://e.com/wiki/Foo_(bar)`):

- old: `[Foo](https://e.com/wiki/Foo_\(bar\))` becomes `<a href="https://e.com/wiki/Foo_(bar)">Foo</a>`.
- B: `[Foo](https://e.com/wiki/Foo_(bar\))` becomes the literal text `[Foo](`, then an autolink to `…Foo_(bar%5C)`, then `)`. The link text is lost and the URL gains a backslash.

**Measured.**

- **#0:** in 309 of 715 cells, B loses a link that old renders correctly. The reverse never happens. The rest hold only a lone `(`, which renders the same in both, or lose the link for other reasons in both. All 7 test cells (tests-adf#99 and #1402–#1407, the "paren-truncation" fixtures) break.
- **#42 (m2a, all 7 cells from tests-md):** Markdown that escapes the parens itself, e.g. `[Foo](https://e.com/wiki/Foo_\(bar\))`. CommonMark makes `\(` a literal `(`. Old stores `…Foo_(bar)`. B stores `…Foo_\(bar)`, so a broken URL is written to Jira; browsers turn the `\` into `/`.
- **#1 (rt_md):** 319 of 362 cells display differently from what was stored. Most are hand-written `[w](https://ex.com/a_(b))`, which **both** writers truncate at the first `)`. Old's display shows that truncated link faithfully. B's display shows the intended full URL, which hides the fact that Jira holds a truncated one.

**How a user notices.** In Harbour's issue and comment view, a Jira link to a Wikipedia- or MSDN-style URL shows as raw `[text](…\)` text instead of a link. A link written as `\(…\)` in Harbour's editor or by an agent comment points to a wrong URL in Jira. Stored descriptions are not damaged by an edit (gate permits, round trip exact).

| # | fn | cells | sources | minimal input | old | B |
|---|---|---|---|---|---|---|
| 0 | a2m | 715 | tests-adf 7, gen-adf 708 | `{"type":"doc","content":[{"type":"text","marks":[{"type":"link","attrs":{"href":"("}}]}]}` | `"[](\\()"` | `"[](()"` |
| 1 | rt_md | 362 | tests-md 7, gen-md 355 | `"[](()"` | `"[](\\()"` | `"[](()"` |
| 42 | m2a | 7 | tests-md 7 | `"[](\\()"` | `[{"type":"paragraph","content":[{"type":"text","text":"","marks":[{"type":"link","attrs":{"href":"("}}]}]}]` | `[{"type":"paragraph","content":[{"type":"text","text":"","marks":[{"type":"link","attrs":{"href":"\\("}}]}]}]` |
| 313 | a2m | 1 | gen-adf 1 | `{"content":[{"type":"text","marks":[{"type":"link","attrs":{"href":"("}}]}]}` | `"[](\\()"` | `"[](()"` |

### 3b. Fences of four backticks (#7, #8; 112 cells, all gen-md)

**Minimal example.** For a line of four backticks alone (````` ```` `````), old gives a code block with no language. B gives `` language: "`" ``. Under CommonMark, the info string of a backtick fence cannot contain a backtick, so that line opens a 4-backtick fence with no language. Old is right here only by accident: its fallback always drops the language.

**Closed 4-backtick fences.** In ````` ````md … ```` `````, both versions stamp the language `` `md ``. Old leaks one stray backtick into the body; B leaks the whole closing four-backtick line.

**Scale.** 178 of the 692 fence-related Markdown cells contain a fence line of 4 or more backticks.

**How a user notices.** Comments or descriptions written through Harbour that nest a code sample in a 4-backtick fence arrive in Jira with a code block labelled `` ` ``, and with the closing fence inside the code. This is the usual way to quote Markdown that itself contains fences, so agent-written comments are the likeliest place to see it.

| # | fn | cells | sources | minimal input | old | B |
|---|---|---|---|---|---|---|
| 7 | m2a | 60 | gen-md 60 | ````` "````" ````` | `[{"type":"codeBlock","content":[]}]` | `` [{"type":"codeBlock","attrs":{"language":"`"},"content":[]}] `` |
| 8 | rt_md | 52 | gen-md 52 | ````` "````" ````` | ```` "```\n\n```" ```` | ````` "````\n\n```" ````` |

### 3c. Dash lines with surrounding whitespace or CR (12 groups, 20 cells)

**What changed.** Old escapes every paragraph line matching `^\s*-{3,}\s*$`. B escapes only `^-{3,}$`, which matches what its own writer reads as a rule. So B's write round trip is fine: its writer reads `--- ` as text, and the gate refuses the document-edge cases.

**What breaks is the display.** Marked reads ` ---`, `--- ` and `---\r` as a thematic break. After a text line it reads them as a setext underline. Example: a paragraph `Title` + hardBreak + `--- ` gives `Title\n\---` in old (rendered literally) and `Title\n---` in B, which renders as `<h2>Title</h2>`.

**How a user notices.** Rarely. A Jira line of dashes with a stray space, tab or CR shows as a rule, or turns the line above it into a heading. 18 of the 20 cells are CRLF or trailing-space Markdown from gen-md; 2 are generated ADF.

| # | fn | cells | sources | minimal input | old | B |
|---|---|---|---|---|---|---|
| 68 | rt_md | 4 | gen-md 4 | `"---\r\nn"` | `"\\---\r\nn"` | `"---\r\nn"` |
| 78 | rt_md | 3 | gen-md 3 | `"s\n---\r"` | `"s\n\\---"` | `"s\n---"` |
| 92 | rt_md | 2 | gen-md 2 | `"~\n--- "` | `"\\~\n\\---"` | `"\\~\n---"` |
| 93 | rt_md | 2 | gen-md 2 | `"---\r\n&"` | `"\\---\r\n&"` | `"---\r\n&"` |
| 97 | rt_md | 2 | gen-md 2 | `"---\r\n<"` | `"\\---\r\n<"` | `"---\r\n<"` |
| 173 | rt_md | 1 | gen-md 1 | `"---\r\n*"` | `"\\---\r\n\\*"` | `"---\r\n\\*"` |
| 189 | rt_md | 1 | gen-md 1 | `"2\n---\r"` | `"2\n\\---"` | `"2\n---"` |
| 199 | rt_md | 1 | gen-md 1 | `")\n---\r"` | `")\n\\---"` | `")\n---"` |
| 205 | rt_md | 1 | gen-md 1 | `"=\n--- "` | `"=\n\\---"` | `"=\n---"` |
| 227 | a2m | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"--- "}]}]}` | `"\\---"` | `"---"` |
| 233 | rt_md | 1 | gen-md 1 | `"t\n--- "` | `"t\n\\---"` | `"t\n---"` |
| 300 | a2m | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":" ---"}]}]}` | `"\\---"` | `"---"` |

## Class 5: needs John's call (1 group, 1 cell)

**#145 (gate, tests-adf#629).** The test's "two bullet items" cell with an empty payload: `bulletList[listItem(paragraph[{text: ''}]), listItem(paragraph["plain"])]`.

- **Old permits it.** Its writer rebuilds the empty run exactly.
- **B refuses it (422).** Its writer cannot emit an empty run (2b), and the gate is derived from the writer.

Both versions are self-consistent. The input is schema-invalid ADF, but it is exactly what **old Harbour's writer produced** for an empty `- `, `# ` or `> ` line.

**The call.** Does Jira accept and store `{type: 'text', text: ''}`? One test write of a description with an empty bullet through the old writer would tell.

- **If Jira rejects it**, as the schema's non-empty rule suggests, B's refusal never fires on real data. Old Harbour then had a real bug that B fixes: such writes failed. This group becomes class 2.
- **If Jira stored it**, B will 422 later in-app edits of every description that old Harbour wrote with an empty item. John then chooses between two options:
  1. Accept that.
  2. Make B's gate treat an empty text run as no content, i.e. ignore `{text: ''}` before the shape checks. Those descriptions then stay editable, and are normalised to `content: []` on save.

| # | fn | cells | sources | minimal input | old | B |
|---|---|---|---|---|---|---|
| 145 | gate | 1 | tests-adf 1 | `{"type":"doc","content":[{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{…` | `false` | `true` |

## Class 1: malformed input only (79 groups, 900 cells)

Neither the Jira API nor its users produce these inputs. For each, which version throws and which degrades gracefully:

| Behaviour | Groups | Cells | Old | B |
|---|---:|---:|---|---|
| `content` is a string; `marks: [null]`; null list item | 29 | 318 | **throws** TypeError in a2m, rt_adf and the gate | degrades: renders `''`; the gate refuses |
| Gate with `orderedList.attrs: null`, or heading `content` a string (#73, #150, #278) | 3 | 6 | **throws** | refuses (`true`) |
| `text` is a number (#9, #14) | 2 | 90 | renders it (`"1"`): the more informative degradation | silently drops it (`""`) |
| Mention with no `text` and a missing or empty `id` (#5, #6) | 2 | 356 | `@user` | `@` |
| A list child that is not a `listItem` (32 groups) | 32 | 105 | prints a bare `-`/`1.` and drops the child's text | renders the child: the better degradation |
| A list with no items (#174, #178, #196, #243, #244) | 5 | 5 | ends with one `\n`, which can glue onto the next line | ends with a blank line |
| Code language made of backticks, e.g. `` "```" `` (#30) | 1 | 15 | drops it on the round trip | keeps it |
| Gate: `content: [1]` or `[null]` (#138, #139) | 2 | 2 | permits a lossy write | refuses: fails closed, better |
| Gate: a marked text run inside a `codeBlock` (#142) | 1 | 1 | permits, and the mark is dropped | refuses: better |
| Gate: code language `"x\ny"` (#140, #141) | 2 | 2 | refuses | **permits a lossy write** (`y` moves into the body): the one class-1 item where B is worse |

Neither version throws on anything else in the corpus. B throws on none of the 9,953 inputs, under any function.

## Class 4: harmless (5 groups, 22 cells)

- **#25 (rt_adf, 18 cells).** A text run carrying link and code marks. It has two marks, so the gate refuses it, and both writers lose the link. The only difference is the escaping (`\(` against `(`) inside the resulting code span.
- **#156, #275, #327, #333 (1 cell each).** A `blockCard` with no URL between blocks. B emits an empty block, i.e. extra blank lines; marked renders both versions identically.

| # | fn | cells | sources | minimal input | old | B |
|---|---|---|---|---|---|---|
| 25 | rt_adf | 18 | gen-adf 18 | `{"type":"doc","content":[{"type":"text","marks":[{"type":"link","attrs":{"href":"("}},{"type":"code"}]}]}` | `[{"type":"paragraph","content":[{"type":"text","text":"[](\\()","marks":[{"type":"code"}]}]}]` | `[{"type":"paragraph","content":[{"type":"text","text":"[](()","marks":[{"type":"code"}]}]}]` |

| # | fn | cells | sources | minimal input | old | B |
|---|---|---|---|---|---|---|
| 156 | a2m | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"codeBlock"},{"type":"blockCard"},{"type":"blockquote"}]}` | ```` "```\n\n```\n\n>" ```` | ```` "```\n\n```\n\n\n\n>" ```` |
| 275 | a2m | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"blockquote"},{"type":"expand","content":[{"type":"blockCard"},{"type":"text","text":"…` | `"> \n\no"` | `"> \n\n\n\no"` |
| 327 | a2m | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"blockquote"},{"type":"blockCard"},{"type":"rule"}]}` | `"> \n\n---"` | `"> \n\n\n\n---"` |
| 333 | a2m | 1 | gen-adf 1 | `{"type":"doc","content":[{"type":"bulletList","content":[{"type":"listItem"}]},{"type":"blockCard"},{"type":"orderedLis…` | `"- \n\n1."` | `"- \n\n\n\n1."` |

## The 5 differences that matter most to a Harbour user

1. **Regression: links whose URL contains parentheses (#0, #1, #42).**
   - Display: a Jira description or comment with a balanced-paren URL, such as `…/wiki/Foo_(bar)`, now shows in Harbour as raw `[text](…\)` instead of a link. The suite's own paren fixtures break this way.
   - Writes: `\(` in a Markdown link written through Harbour is stored with a literal backslash, so the link in Jira is broken.
   - Fix: escape and unescape `(` again in B's `HREF_TEXT`. That two-regex change removes all 842 cells whose only cause is this one.
2. **Fix: block smart-link cards (2c).** Old fused a card's URL with the following paragraph (`…/ABC-1Thanks`), producing a wrong link in Harbour's view. B separates them.
3. **Fix: code fences keep their language (2a).** When a fenced block has a blank line inside, trailing lines after its closing fence, or no clean close, B keeps the language. This is the only difference on the 1,037 real ticket texts (one real comment), and it affects descriptions and comments written through Harbour.
4. **Fix, with a caveat: empty bullet, heading and quote lines (2b and class 5).** B writes schema-valid empty content, and Jira-style empty list items now round-trip exactly. Whether descriptions that old Harbour stored with empty text runs become un-editable (422) depends on whether Jira ever accepted them.
5. **Regression: 4-backtick fences (3b).** A nested code sample in a four-backtick fence is written with language `` ` ``, and with the closing fence inside the code. Agent-written comments are the likeliest place to see it.

## Not reached by the corpus (found by reading the two files)

- **Lone dash blocks.** A block that is only `--- `, ` ---` or `---\r` is a rule in old, matching CommonMark. In B it is a text paragraph: a small writer regression, the mirror of 2d.
- **`>\tquote`** is a blockquote in B and a paragraph in old: a fix.
- **A closing fence glued to the code**, as in ```` ```js\ncode``` ````. Old closes the fence there. B keeps the backticks in the body, which matches CommonMark: that line is not a closing fence.
- **A `codeBlock` with non-text children**, such as a `hardBreak`. Old renders `\n`; B drops it. ADF does not allow these children (malformed).

## Caveats

- **Grouping is by minimal example, and the shrinker can drift.** The predicate is only "outputs differ", so 34 groups' minimal behaviour is not what their full inputs show:
  - In the 32 list-child groups (class 1, 105 cells), no full input needs that change. Their real differences are mostly 2b, plus some 2a and 3a. This includes the 3 tests-adf cells counted in class 1.
  - #33 and #91 (class 2, 11 cells) likewise: 6 of #33's cells are really 3c.
  - The cell-level counts above correct for this.
- **No real Jira ADF is in the corpus.** Judgements about the read path and the gate rest on generated `spec` documents and test fixtures.
- **Jira's validation of empty text nodes was not tested.** Everything here ran offline.

## Files in this folder

- **Rebuild and attribute:** `regroup.mjs` (with its output `regrouped.json`), `patches.mjs` with `build-hybrids.mjs`, and `build-flagged.mjs`, which produces `hybrids/FLAGGED.mjs`.
- **Analysis:** `loo.mjs` (`loo.json`), `enrich.mjs` (`enriched.txt`), `assign.py` (`assign.json`) and `tables.py`.
- **Probes:** `marked-check.mjs`, `href-impact.mjs`, `href-rtmd.mjs`, `extra-probe.mjs` and `minimal-marked.mjs`.
- **Private structural probes:** `priv-probe*.mjs`. They print shapes only, never text.
