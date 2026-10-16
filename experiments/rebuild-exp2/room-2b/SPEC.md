# Specification: the Jira ADF ↔ Markdown codec

Every comment from the original module, in order, with all code removed. The comments record the behaviour decisions and their reasons.
Names of the original's internal helpers are replaced with `(internal helper)`: they are not part of the contract.
Where a block sits directly above one of the three exported functions, its signature is shown.
The test file in `tests/unit/` is the other half of the specification; where the two seem to disagree, the tests win.

---

```
// =============================================================================
// Jira ADF (Atlassian Document Format) <-> Markdown codec (LIN-2399).
//
// Pure functions, no imports, throws nothing. Reached only by
// lib/providers/jira/index.js through the three exports:
//
//   adfToMarkdown(doc)              ADF → Markdown (the read path)
//   markdownToAdf(markdown)         Markdown → ADF (the write path)
//   adfHasUnrenderableContent(doc)  the write gate (LIN-1886, D1 policy)
//
// The three are one design. A description edit is read-then-rewrite: the
// stored ADF is rendered to Markdown, a human edits it, and the result is
// written back through `markdownToAdf`. So the reader escapes everything the
// writer would read as markup (code spans excepted: they are fenced, not
// escaped), and the gate refuses exactly what the writer
// cannot rebuild. The Markdown grammar both directions share is defined once,
// below, so the reader, the writer and the gate cannot drift apart.
// =============================================================================
```

---

```
// -----------------------------------------------------------------------------
// The shared Markdown grammar
// -----------------------------------------------------------------------------
```

---

```
/**
 * What `markdownToAdf` splits a document into blocks on: TWO LITERAL NEWLINES,
 * nothing else. The gate's shape rules test the same pattern against a rendered
 * body, so the two cannot drift: a rule that refused a "blank" line the split
 * does not actually break on (`"\n \n"`, trailing whitespace on an otherwise
 * blank line, very common in pasted code) would refuse content that
 * round-trips perfectly. Share the constant; do not re-type the regex.
 */
```

---

```
/** Every renderer ends a block with this; the writer splits on it. */
```

---

```
// Block forms the writer recognises. `(internal helper)` and `(internal helper)` are matched against the
// whole BLOCK (so their `\s` can cross a newline); the others against every
// line of the block, so their `\s` never can.
```

---

```
// `(\s|$)`, not `\s`: a line of nothing but hashes is a heading leader too.
// `(internal helper)` is matched against the whole block, and its `\s+` happily consumes
// the `\n` a hardBreak rendered, so `"#\nrest"` would read back as a level-1
// heading with the `#` line gone (LIN-1886 re-review R2).
```

---

```
/**
 * Escape contexts: which characters are backslash-escaped on the way out, and
 * which `\x` pairs are consumed on the way back in.
 *
 * `(internal helper)`: every character the inline pass can open a construct with, plus `]`
 * (which ends link text) and the `(internal helper)` itself. Unescaping follows
 * CommonMark: a backslash escapes ASCII punctuation and nothing else. That is
 * what keeps a hand-typed `C:\Users\me` or a regex's `\d` intact, while the
 * codec still round-trips its own escapes.
 *
 * `(internal helper)`: both brackets and the `(internal helper)` are escaped, and both brackets are
 * unescaped on the way back in. `)` because the writer ends an href at the
 * first unescaped `)` (the `(`-truncation bug, LIN-1886 review F1). `(` because
 * `marked`, the dashboard renderer, accepts an unescaped `(` in a destination
 * only when it is balanced, and with `)` escaped it never is: `Foo_(bar\)`
 * renders as literal text plus a wrong auto-link (LIN-3561).
 *
 * An href is unescaped with its own narrow set, not `(internal helper)`'s, or the pass
 * would eat backslashes the writer never put there.
 *
 * Code spans have no `(internal helper)` context: CommonMark processes no escapes inside
 * one, so they are fenced instead (`(internal helper)` / `(internal helper)`).
 */
```

---

```
/**
 * The delimited marks, in the writer's scan order: `[markType, delimiter,
 * stopAt, `(internal helper)` context]`. The reader renders with the same table and the
 * gate's mark vocabulary is this table plus `link` and `code` (whose
 * variable-length backtick fence does not fit a fixed delimiter), so no mark is
 * parsed that the reader cannot render, or vice versa.
 *
 * `stopAt` reproduces the old pattern's `[^*]+` / `[^~]+` classes: a lone
 * unescaped `*` inside `**…**` means "this is not a strong run".
 */
```

---

```
// -----------------------------------------------------------------------------
// Small ADF helpers
// -----------------------------------------------------------------------------
```

---

```
// -----------------------------------------------------------------------------
// ADF → Markdown
// -----------------------------------------------------------------------------
//
// Jira Cloud's `description`/comment `body` fields are ADF documents. This is
// a deliberately MINIMAL renderer covering the node/mark types real Jira
// content uses, not the full ADF spec. Unknown node types fall through to
// their child content, so an unhandled node degrades to its text rather than
// vanishing.
//
// ESCAPING (LIN-1886 review F1, John's Option A). Any character sequence the
// writer reads as markup leaves here neutralised, or ordinary Jira prose is
// silently reinterpreted on save: `foo_bar_baz` growing an `em` mark, a
// paragraph beginning `- ` becoming a real list, a paragraph reading ```` ```js
// ```` having its text deleted. Refusing such prose was rejected (it would 422
// nearly every technical description); escaping it is the decision. The cost
// is visible and accepted: the raw textarea shows `foo\_bar\_baz`. In rendered
// Markdown, prose and link text are unaffected: a backslash before ASCII
// punctuation is CommonMark and `marked` (the dashboard renderer) prints just
// the character. An href consumes `\(`, `\)` and `\\` the same way, which is
// why `(internal helper)` escapes both brackets.
//
// CODE SPANS ARE NOT ESCAPED (LIN-3564). CommonMark processes no escapes
// inside a code span, so `marked` would show them literally. A code run is
// instead FENCED the CommonMark way, so it displays exactly its own text: the
// fence is one backtick longer than the longest backtick run inside, and one
// space pads each side when the text begins or ends with a backtick, or begins
// and ends with a space around a non-space character (the reader strips one
// space from each side in that case). The text run `C:\dir` is written
// `` `C:\dir` ``.
//
// Escaping is UNCONDITIONAL, not "only where a construct would match": that
// version has to reason about how escaping one position changes the parse of
// every later one. Escaping every metacharacter makes the argument total:
// after the pass every metacharacter is the second half of a `\x` pair, the
// writer consumes both as one literal, and no construct can begin anywhere.
// Keep it that way.
```

---

```
// Always numbered from 1, whatever `attrs.order` says (see the gate's attrs rules).
```

---

```
/**
 * A paragraph's inline Markdown, with any line that would open a block
 * neutralised. Applied per line, because the writer tests the quote, bullet
 * and ordered forms against EVERY line of a block.
 */
```

---

```
/**
 * Neutralise a LEADING token the writer reads as a block marker. Inline
 * escaping cannot reach these: `#`, `>`, `-` and `.` are not inline markup,
 * they are only markup in first position. A fence needs no case here: the
 * inline pass has already escaped a text run's backticks, so ```` ```js ````
 * leaves as `` \`\`\`js `` and cannot open a block. A code span cannot be
 * escaped; one that would start the block with a fence is refused by the gate.
 */
```

---

```
// A rule may carry leading whitespace, so a backslash prefix would not be an
// `(internal helper)` (`"\ ---"`): `(internal helper)` the first dash instead.
```

---

```
/**
 * A code span, CommonMark's way: the text verbatim, fenced by a backtick run
 * one longer than the longest inside it, padded by one space each side where
 * the reader's edge-space strip would otherwise eat the text's own spaces or a
 * fence-adjacent backtick would merge into the fence.
 */
```

---

```
/** A text run, escaped (code: left raw for `(internal helper)`), then wrapped in each mark. */
```

---

```
/**
 * A code BLOCK's body, verbatim, minus trailing newlines. It sits between
 * fences and the writer reads it back with no inline pass, so escaping it
 * would corrupt exactly the content the fence exists to protect.
 */
```

### Above `adfToMarkdown(doc)`

```
/**
 * Convert an ADF document (Jira's rich-text wire shape) to Markdown.
 * @param {{type?: string, content?: Array}|null|undefined} doc
 * @returns {string}
 */
```

---

```
// -----------------------------------------------------------------------------
// Markdown → ADF (LIN-1886)
// -----------------------------------------------------------------------------
//
// The write-direction inverse of `adfToMarkdown`. Its vocabulary is a STRICT
// SUBSET of the reader's: paragraphs, headings, bullet/ordered lists, code
// blocks, blockquotes, rules, hard breaks, and the strong/em/code/strike/link
// marks, but NOT mention/emoji/inlineCard/blockCard, which the reader renders
// and this direction has no inverse for. That asymmetry is why the write gate
// is derived from THIS side (LIN-1886 review Blocker 3).
//
// Anything else degrades to plain text; this direction never throws.
```

### Above `markdownToAdf(markdown)`

```
/**
 * Convert Markdown to an ADF document, the write-direction inverse of
 * `adfToMarkdown`. Unsupported Markdown degrades to a plain paragraph rather
 * than throwing; refusing unrenderable content is `adfHasUnrenderableContent`'s
 * job, applied to the EXISTING stored ADF a write is about to overwrite. That
 * gate is derived from this function, so it can never flag what this emits.
 * @param {string|null|undefined} markdown
 * @returns {{type: 'doc', version: 1, content: Array}}
 */
```

---

```
/** One blank-line-delimited Markdown block → one ADF block node. */
```

---

```
// A fence opens with a ``` line and has a body line at least. The closing
// ``` line is optional: a snippet split by a blank line leaves an unclosed
// fence, which stays code. A lone ``` line is text.
```

---

```
// Bare inline pass: a heading has no line concept, so a `\n` stays text.
```

---

```
/** Each line is one item; its marker is stripped greedily, along with any leading whitespace. */
```

---

```
/** A block's text, split on single `\n`s into `hardBreak`-joined inline runs. */
```

---

```
/**
 * The inline pass: a left-to-right scan, not one regex, because honouring a
 * `\x` `(internal helper)` is not something a single alternation can express (`[^\]]*`
 * cannot be taught that `\]` is literal, which is the bug that lost the link
 * mark on `[a]b](http://x)`).
 *
 * Leftmost construct wins; at the same position the order is link, then
 * `(internal helper)`' order, so a link whose text contains another marker is
 * captured whole. Contiguous literal text accumulates into a single node.
 *
 * An empty input still yields one empty run: that is what makes an empty list
 * item (a bare `- ` line in a multi-item list) rebuildable.
 */
```

---

```
/** The construct starting at `i`, as `{node, end}`, or null. */
```

---

```
// `close === start` is an empty run; those stay literal, so `**` and `____`
// are plain text.
```

---

```
/**
 * A code span, as CommonMark reads it: the opening is the WHOLE run of N
 * backticks, and it closes at the next run of exactly N. Nothing inside is
 * unescaped. One space is stripped from each side when both are present and
 * the content is not all spaces. With no closing run the opening run is
 * literal text: returned as `{literal, end}` so the scan resumes after the
 * whole run rather than re-reading its tail as a shorter opening.
 */
```

---

```
/** `[text](href)`. Unlike the delimited marks, empty link text is allowed. */
```

---

```
/**
 * Index of the next UNESCAPED `close` at or after `from`; -1 if there is none,
 * or if an unescaped `stopAt` character comes first.
 */
```

---

```
// -----------------------------------------------------------------------------
// The write gate (LIN-1886, D1 policy)
// -----------------------------------------------------------------------------
//
// DERIVED FROM THE WRITER, NOT THE READER (LIN-1886 review Blocker 3). A write
// is read-then-rewrite, so the property it needs is
//
//     markdownToAdf(adfToMarkdown(doc)) deep-equals doc
//
// and that does NOT hold across the reader's vocabulary: `mention`, `emoji`,
// `inlineCard` and `blockCard` render fine but have no Markdown → ADF inverse,
// so gating on the reader's set let ordinary Jira content be flattened into one
// anonymous text run by a 200-OK write. Keep everything below in lockstep with
// `(internal helper)` / `(internal helper)` / `(internal helper)` / `(internal helper)`, never with
// `(internal helper)`.
//
// Every rule is pinned by a fixture in the ADF → Markdown → ADF property tests.
```

---

```
/**
 * The node types the writer can emit, and the only children it ever puts in
 * each (with how many). A node of a type missing here, or in a place the
 * writer never puts it, cannot be rebuilt.
 *
 * - heading: no hardBreak. Heading content goes through the bare inline pass,
 *   which has no line concept, so a hardBreak comes back as a `\n` in the text.
 * - listItem: exactly one paragraph. This is also what makes NESTED LISTS
 *   unrebuildable at any depth: a nested list lives as a second child of its
 *   parent listItem (the writer would re-emit its items as flat siblings).
 * - blockquote: exactly one paragraph. Two paragraphs collapse into one
 *   hardBreak-joined paragraph; a codeBlock or heading child loses its type.
 * - codeBlock: exactly one text run (its body is checked by `(internal helper)`).
 */
```

---

```
/**
 * The `attrs` each node type may carry, and the value the writer would have
 * to see to re-emit each (LIN-1886 review F1 sub-class (b)). A type not listed
 * must carry NO `attrs` at all: the writer emits none for it, so any stored
 * `attrs` object, even an empty one, cannot survive a write.
 */
```

---

```
// The writer always stamps `{level}` from the `#` run length, so it is
// required; the reader clamps anything outside 1-6 (the review's `{level: 7}`).
```

---

```
// Stamped ONLY when the fence carries a language, and read back through
// `.trim()`, so a blank or space-padded language is lost.
```

---

```
// Exception 2 (John's ruling `d38d3755`): the writer emits an orderedList
// with no attrs and the reader renumbers from 1, so dropping an identity
// `{order: 1}` (or a bare `{}`) changes no rendered character. Only the
// EXACT integer 1: `{order: 0}` or `{order: -3}` would renumber a visibly
// 0-based list. A non-identity order is refused rather than modelled, "UNTIL
// THE WRITER MODELS THE ATTRIBUTE"; modelling it would change what a
// hand-typed `5. foo` means, and re-review `5ae61f22` measured that it would
// only move the deep-equal gap onto the far commoner no-attrs list.
```

---

```
// Exception 3 (LIN-2019): `localId` is ignored before anything else. Jira's
// editor stamps it on virtually every node, it renders as nothing, and it is
// re-stamped on the next edit. Fail-closed: an allowlist of exactly one key.
```

---

```
// An attrs object with nothing left in it survives only as an exception.
```

---

```
/**
 * A multi-line paragraph whose first line opens with ``` reads back as a code
 * block. Only a code span can do that (a text run's backticks are escaped), and
 * a backslash cannot neutralise it, so it is refused rather than escaped.
 */
```

---

```
/**
 * Rules for a permitted type in a shape the writer never emits, beyond which
 * children it holds. Most compare against what the node RENDERS to, because
 * several containers `.trim()` their content on the way out or have it
 * trimmed on the way back in. `true` = the writer cannot rebuild this node.
 */
```

---

```
// Heading text is trimmed twice on the way back (`(internal helper)`'s `\s+`, then
// `.trim()`); an empty heading loses its `# ` and re-reads as a paragraph of
// literal `#`; a blank line inside it splits the block.
```

---

```
// The writer splits blocks on blank lines and strips the edges' newlines, so
// a paragraph whose text carries a blank line is TORN IN TWO and an edge
// newline is lost.
//
// An EMPTY paragraph is permitted anywhere. In a list item it is the
// rebuildable `- ` line of a multi-item list. At top level it is exception 4
// (LIN-2019): genuinely lossy, deliberately accepted. A leading empty
// paragraph, or one alone, is still refused, by the document-edge rule.
```

---

```
// A list item broken across two lines no longer parses as a list (the writer
// requires EVERY line of the block to carry the marker). The reader trims
// each item and the writer's greedy marker regex eats leading whitespace, so
// `"  padded  "` is destroyed in both directions (LIN-1886 review F1 (b)).
```

---

```
// The reader trims before prefixing each line with `> `.
```

---

```
// The block split runs BEFORE the fence is seen, so a body containing a
// blank line (or an empty body) is torn in two and the closing ``` leaks out
// as text. The reader also strips trailing newlines off the body. So a fence
// is rebuildable only as one unmarked, non-empty run with no blank line and
// no edge newline.
```

---

```
// Only ONE mark per run. The inline pass does not nest, so strong+em renders
// `_**x**_` and re-parses as ONE em run whose text is literally `**x**`.
```

---

```
// An empty run cannot carry a mark home: `**`, `__`, `~~~~` stay literal.
// A link is the exception: `[](href)` has always allowed empty text.
```

---

```
// An href rides the line-bounded `](…)` slot; a newline would break the block.
```

---

```
// The writer splits every `\n` into a hardBreak, so a run carrying one
// re-reads as several runs. A heading is the exception: its bare inline
// pass hands the newline straight back (its own rule still refuses a
// blank line or an edge newline).
```

---

```
/**
 * Two adjacent UNMARKED runs render as one stretch of text, and the writer
 * accumulates contiguous literal text into a single node, so the split is not
 * recoverable. Two adjacent CODE runs fail the same way: their fences touch
 * (`a` then `b` is ``` `a``b` ```), and CommonMark reads that as one span.
 * Other adjacent marked runs are fine: their delimiters re-split them.
 */
```

---

```
// A code block's body is the one place a `\n`-bearing run IS rebuildable, and
// its shape rule has already validated it in full: do not recurse into it.
```

---

```
/**
 * The document's OWN edges. `adfToMarkdown` finishes with a `.trim()`, which
 * no per-node rule can see: every node can be rebuildable and the first
 * block's leading space still be eaten. The trailing side ignores the
 * block-separating newlines every renderer emits (structure, not content) and
 * asks only about what precedes them. That asymmetry is why a leading empty
 * paragraph, or one alone, is refused while a trailing one is permitted.
 */
```

### Above `adfHasUnrenderableContent(doc)`

```
/**
 * True if `doc` contains anything `markdownToAdf` cannot reconstruct from
 * `adfToMarkdown(doc)`. Used to refuse (422) an in-app description overwrite
 * that would silently destroy Jira-native content; never used to reject a
 * READ, which still renders mentions, emoji and cards for display.
 *
 * The invariant it buys:
 *
 *     adfHasUnrenderableContent(doc) === false
 *       ⟹  markdownToAdf(adfToMarkdown(doc)) deep-equals doc,
 *           EXCEPT for the four enumerated classes below
 *
 * asserted in both directions over the fixture list and a generated
 * adversarial corpus in the codec's tests. That is evidence over a corpus, not
 * a proof over all ADF (LIN-1886 review F2): when you add a node type, a mark
 * or an `(internal helper)`, add it to the corpus too.
 *
 * The exceptions are ENUMERATED, not papered over (John's ruling `d38d3755`).
 * 1-3 are structure-only and change no rendered character; 4 drops a blank
 * line. All four are pinned by fixtures.
 *
 *   1. An empty, unmarked text run (LIN-1939, pre-existing, deliberately not
 *      fixed here). It slips both guards (the empty-run rule needs a mark, the
 *      adjacent-pair rule needs both neighbours unmarked), so
 *      `[text(''), text('x', em)]` is permitted, renders `_x_`, and re-reads
 *      without the empty run.
 *   2. An `orderedList`'s identity attrs, `{order: 1}` or `{}`: the key is
 *      absent after the round trip; the list reads identically.
 *   3. A `localId` attrs key on any node (LIN-2019): absent after the round
 *      trip. Only this key is allowlisted, and shape/type rules still apply.
 *   4. A top-level empty paragraph, mid-document or trailing (LIN-2019): its
 *      blank line is silently dropped. A leading one, or one alone, is still
 *      refused by the document-edge rule. Refusing every Jira description with
 *      a blank line in it is worse than dropping a blank line.
 *
 * Deliberately NOT refused (LIN-1886 review F1, human decision `599551c2`):
 * Markdown-syntax collisions in ordinary prose. `- not a list`,
 * `foo_bar_baz` and ```` ```js ```` are escaped by `adfToMarkdown` and
 * round-trip faithfully.
 *
 * Like `adfToMarkdown`, only `doc.content` is inspected, never the wrapper's
 * `type`, so a bare `{ content: [...] }` is treated as a document.
 * @param {object|null|undefined} doc - an ADF document (or any ADF node)
 * @returns {boolean}
 */
```
