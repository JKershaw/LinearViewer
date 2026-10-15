# Specification: the Jira ADF ↔ Markdown codec

Every comment from the original module, in order, with all code removed. The comments record the behaviour decisions and their reasons.
Names of the original's internal helpers are replaced with `(internal helper)`: they are not part of the contract.
Where a block sits directly above one of the three exported functions, its signature is shown.
The test file in `tests/unit/` is the other half of the specification; where the two seem to disagree, the tests win.

---

```
// =============================================================================
// Jira ADF (Atlassian Document Format) <-> Markdown codec (LIN-2399, mechanical
// extraction of the self-contained codec formerly at lib/providers/jira/index.js
// :220-:1020, LIN-2378 code quality review finding F3). Pure functions only, no
// imports — reached by lib/providers/jira/index.js through the three exports
// below, and by nothing else (a whole-tree grep at extraction time found zero
// other consumers). `JiraInProgressCapExceededError` (index.js) is on the
// fail-whole update path and is untouched by this extraction — this module
// throws nothing and knows nothing about it.
// =============================================================================
```

---

```
// -----------------------------------------------------------------------------
// ADF (Atlassian Document Format) → Markdown.
// -----------------------------------------------------------------------------
//
// Jira Cloud's `description`/comment `body` fields are ADF documents, not
// plain text or HTML. This is a deliberately MINIMAL renderer covering the
// node/mark types real Jira content actually uses — not a full ADF spec
// implementation. Unknown node types fall through to their child content (if
// any) so an unhandled node degrades to its text rather than vanishing.
// -----------------------------------------------------------------------------
// Markdown ESCAPING on the way out (LIN-1886 review F1, John's Option A).
//
// The read path is half of a round trip: an in-app description edit renders the
// stored ADF to Markdown, hands it to a human, and writes whatever comes back
// through `markdownToAdf`. So any character sequence the WRITER reads as markup
// has to leave here neutralised, or ordinary Jira prose is silently reinterpreted
// on save — `foo_bar_baz` growing an `em` mark, a paragraph beginning `- ` becoming
// a real `bulletList`, a paragraph reading ```` ```js ```` having its text deleted
// outright. The review found 16 such counterexamples.
//
// Refusing that prose was explicitly rejected as the remedy (it would 422 nearly
// every technical description); escaping it is the decision. The cost is visible
// and accepted: the raw textarea now shows `foo\_bar\_baz`. Rendered Markdown is
// unaffected — a backslash escape before ASCII punctuation is CommonMark, so
// `marked` (the dashboard renderer) prints the character, not the backslash.
//
// WHY UNCONDITIONAL, not "escape only where a construct would actually match":
// the cheap-looking version has to reason about how escaping one position changes
// the parse landscape for every later one. Escaping every metacharacter makes the
// argument trivial and total — after the pass, every metacharacter is the second
// half of a `\x` pair, `(internal helper)` consumes both as one literal, and no
// construct can begin anywhere. Keep it that way.
// -----------------------------------------------------------------------------
```

---

```
/** Every character `(internal helper)` can OPEN a construct with, plus the escape itself. */
```

---

```
/** Inside a `code` mark only the fence character and the escape can end the run. */
```

---

```
/** Inside a link's href only an unescaped `)` ends it — the `(`-truncation bug. */
```

---

```
/**
 * Neutralise a LEADING token `(internal helper)` reads as a block marker. Inline
 * escaping cannot reach these: `#`, `>`, `-` and `.` are not inline markup, they
 * are only markup in first position. Applied per line of a rendered paragraph
 * (`(internal helper)` tests the heading/fence/rule forms against the block's first
 * line, and the quote/bullet/ordered forms against EVERY line).
 *
 * A fence marker needs no case here — the inline pass has already escaped its
 * backticks, so ```` ```js ```` leaves as `` \`\`\`js `` and cannot open a block.
 */
```

---

```
// `(\s|$)`, not `\s`: a line of nothing but hashes is a heading leader too.
// `(internal helper)`'s `^(#{1,6})\s+` is matched against the whole BLOCK, and that
// `\s+` happily consumes the `\n` a hardBreak rendered — so `"#\nrest"` reads
// back as `{heading, level:1}` and the `#` line is gone. Requiring whitespace
// on the same line here is the one-character asymmetry that let that through.
```

---

```
/**
 * A text run, escaped for the context its marks put it in. A `code` run is
 * fenced by backticks and re-read as one opaque span, so only the backtick and
 * the escape need neutralising there — escaping `_`/`*` inside a code span would
 * be pure noise in the textarea, and `(internal helper)` would have to strip them back
 * out again. Everything else takes the full inline set.
 */
```

---

```
/**
 * A code BLOCK's body, verbatim. It sits between fences and `(internal helper)` reads
 * it back with no inline pass at all, so escaping it would corrupt exactly the
 * content the fence exists to protect.
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
// Markdown → ADF (LIN-1886, Phase 2) — the write-direction inverse of
// adfToMarkdown/`(internal helper)` above. Its vocabulary is a STRICT SUBSET of the
// reader's: paragraphs, headings, bullet/ordered lists, code blocks,
// blockquotes, hr, hard breaks, and the strong/em/code/strike/link marks — but
// NOT mention/emoji/inlineCard/blockCard, which the reader renders and this
// direction has no inverse for. That asymmetry is exactly why the D1 write gate
// is derived from THIS side and not from `(internal helper)`'s switch (LIN-1886
// review Blocker 3); `(internal helper)` below enumerates what
// `(internal helper)`/`(internal helper)`/`(internal helper)` can emit.
//
// The correspondence is pinned by the ADF → Markdown → ADF property test. Read
// the scope of that claim carefully (LIN-1886 review F2): it is checked over a
// hand-written fixture list AND over a generated cross-product of an adversarial
// text corpus against every structural slot — roughly a thousand documents, both
// directions (permitted ⟹ round-trips, refused ⟹ genuinely lossy). That is a
// strong claim, not a total one: it is evidence over a corpus, not a proof over
// all ADF. When you add a node type, a mark, or an escape, add it to the corpus
// too — the previous framing asserted a general property off 21 chosen fixtures,
// and the gap between those two statements is where the F1 counterexamples lived.
//
// Anything else in the input Markdown degrades to plain text; this function
// never throws — refusal-on-unrenderable-content is
// `adfHasUnrenderableContent`'s job, applied to the STORED ADF being
// overwritten, not to freshly-authored Markdown on its way in.
// -----------------------------------------------------------------------------
```

---

```
// The inline pass is a hand-rolled left-to-right scan rather than one regex
// (`INLINE_PATTERN`, removed in LIN-1886 fix cycle 3). It has to be: the reader
// now escapes Markdown collisions, and honouring a `\x` escape is not something
// a single non-backtracking alternation can express — `[^\]]*` cannot be taught
// that `\]` is a literal rather than the end of the link text, which is exactly
// the bug that lost the link mark on `[a]b](http://x)`.
//
// Scan order is preserved from that pattern and still matters: link before
// strong/code/strike/em, so a link whose text contains another marker character
// is captured whole. Leftmost position wins; at the same position, this order is
// the tiebreak. The vocabulary mirrors `(internal helper)` exactly — no mark type is
// parsed here that `(internal helper)` cannot also render.
```

---

```
/**
 * CommonMark's escape rule: a backslash escapes ASCII punctuation and nothing
 * else. This is what keeps a hand-typed `C:\Users\me` or a `\d` in a regex
 * intact — only `\` + punctuation is consumed, so the codec can round-trip its
 * own escapes without eating a user's literal backslashes.
 */
```

---

```
// A code span and an href were escaped with a narrower set on the way out (see
// `(internal helper)` / `(internal helper)`), so they are unescaped with the matching narrower
// set — not `(internal helper)` — or the pass would eat backslashes the writer
// never put there.
```

---

```
/**
 * Index of the next UNESCAPED `close` at or after `from`; `-1` if there is none,
 * or if an unescaped `stopAt` character is reached first. `stopAt` reproduces the
 * old pattern's `[^*]+` / `[^~]+` classes: a lone `*` inside `**…**` still means
 * "this is not a strong run", it is only escaped occurrences that stop counting.
 */
```

---

```
/** `[delimiter, markType, forbidden-inside, how to unescape the content]`. */
```

---

```
/** The construct starting at `i`, or null. */
```

---

```
// `close === i + delim.length` is an empty run; the old pattern's `+`
// quantifiers rejected those, so `**` and `____` stay literal.
```

---

```
/** A block's text, split on single `\n`s into `hardBreak`-joined inline runs. */
```

---

```
/** One blank-line-delimited Markdown block → one ADF block node. */
```

---

```
/**
 * What `markdownToAdf` splits a document into blocks on — TWO LITERAL NEWLINES,
 * nothing else. The gate's shape rules test the same pattern against a rendered
 * body, so the two cannot drift: a rule that refuses a "blank" line the split
 * does not actually break on (`"\n \n"` — trailing whitespace on an otherwise
 * blank line, very common in pasted code) refuses content that round-trips
 * perfectly. Share the constant; do not re-type the regex at a use site.
 */
```

### Above `markdownToAdf(markdown)`

```
/**
 * Convert Markdown to an ADF document — the write-direction inverse of
 * `adfToMarkdown`. Unsupported/unrecognized Markdown constructs degrade to a
 * plain paragraph of text rather than throwing; refusing unrenderable content
 * is `adfHasUnrenderableContent`'s job, applied to the EXISTING stored ADF a
 * write is about to overwrite; that gate's node set and structural rules are
 * derived from THIS function, so it can never itself manufacture something the
 * gate would flag.
 * @param {string|null|undefined} markdown
 * @returns {{type: 'doc', version: 1, content: Array}}
 */
```

---

```
// -----------------------------------------------------------------------------
// Unrenderable-content detection (LIN-1886, D1 policy) — a pure recursive walk
// over an ADF tree, gating a WRITE.
//
// THIS SET IS DERIVED FROM THE WRITER (`markdownToAdf`), NOT THE READER
// (`(internal helper)`). That distinction is the whole of LIN-1886 review Blocker 3:
// the set used to mirror `(internal helper)`'s switch — i.e. "what the reader can
// turn into Markdown" — which is the wrong question for a write. A write does
// read-then-rewrite, so the property it needs is
//
//     markdownToAdf(adfToMarkdown(doc)) deep-equals doc
//
// and that does NOT hold across the reader's vocabulary. `mention`, `emoji`,
// `inlineCard` and `blockCard` all render to Markdown fine but have NO
// Markdown→ADF inverse anywhere in `(internal helper)`/`(internal helper)`, so gating on the
// reader's set let ordinary Jira content (an @-mention, a smart link, an emoji)
// be flattened into one anonymous text run by a 200-OK write. Everything listed
// below is a type `(internal helper)`/`(internal helper)`/`(internal helper)` can
// actually EMIT; keep this list in lockstep with those three functions, never
// with `(internal helper)`'s switch.
// -----------------------------------------------------------------------------
```

---

```
/**
 * `(internal helper)` (the only thing that emits `hardBreak`) is reached
 * ONLY for a paragraph block and a blockquote's inner text. Heading content and
 * a listItem's paragraph go through bare `(internal helper)`, which has no line
 * concept — so a `\n` the reader emits inside either one is re-read as a block
 * boundary (a list item becomes a plain paragraph; a heading swallows a literal
 * newline). Hence: a hardBreak under a heading or a listItem is unrebuildable.
 */
```

---

```
/**
 * The STRUCTURAL half of the same derivation (LIN-1886 review Blocker 3). The
 * node types above are necessary but not sufficient: `markdownToAdf` builds
 * each of these containers in exactly one fixed shape, so a stored node of a
 * permitted type in a shape the writer never emits is just as unrebuildable as
 * an unmodeled type. Each rule below is pinned by a fixture in the ADF→md→ADF
 * property test (tests/unit/the codec test file).
 *
 * `true` = the writer cannot rebuild this node, so a write must refuse.
 */
/**
 * The `attrs` each rebuildable node type is allowed to carry, and what
 * `markdownToAdf` would have to see in order to re-emit them (LIN-1886 review
 * F1 sub-class (b)). Everything not listed here must carry NO `attrs` at all:
 * the writer emits none for it, so any stored `attrs` object — even an empty
 * one — cannot survive a write. This is the rule that catches the review's
 * `heading {level: 7}` (clamped to 6).
 *
 * `orderedList` is the one CONTENT-PRESERVING exception, per John's ruling
 * `d38d3755` ("the identity value is harmless"). The reader renumbers every
 * ordered list from 1 regardless of what is stored, so dropping an identity
 * `{order: 1}` — or a bare `{}` — changes not one rendered character.
 * `{order: 5}` is different in kind: dropping it silently renumbers 5,6 → 1,2,
 * which is the review's original counterexample and is still refused.
 *
 * MEASURED, because "harmless" and "deep-equals" are not the same claim: the
 * two newly-permitted shapes do NOT deep-equal round-trip. `markdownToAdf`
 * emits no `attrs` key at all (`(internal helper)`'s `orderedList` branch), so both
 * `{order: 1}` and `{}` come back as a node with the key ABSENT — a mismatch
 * under `deepEqual` and `deepStrictEqual` alike. That is a real exception to
 * the invariant documented on `adfHasUnrenderableContent` below, named there
 * rather than papered over, and pinned by the `WRITER_PERMITTED_LOSSY_ADF`
 * fixtures — which assert the permit, the rendered-output identity, AND the
 * deep-equal failure together, so none of the three can drift unnoticed.
 *
 * Only the EXACT identity `1` is permitted, which is narrower than the
 * ruling's literal "refuse `order > 1`": `{order: 0}` or `{order: -3}` would
 * renumber a visibly 0-based list to 1-based, so they are not identity values
 * and not harmless. Refusing a non-identity `order` rather than modelling it
 * stands, per the earlier human decision: "refuse … e.g. `orderedList` with
 * `order ≠ 1` UNTIL THE WRITER MODELS THE ATTRIBUTE". Modelling it means the
 * reader numbering from `attrs.order` and the writer reading the first list
 * number back, which changes what hand-authored `5. foo` means — a behaviour
 * change outside this cycle. Re-review `5ae61f22` recorded that modelling it
 * would not close the deep-equal gap anyway, and that is now measured too:
 * stamping `{order: 1}` on every emitted list would merely move the mismatch
 * onto the far commoner list that stores no `attrs` at all.
 */
```

---

```
// `(internal helper)` always stamps `{level}` on a heading, from the `#` run length.
```

---

```
// `(internal helper)` emits an `orderedList` with NO attrs and `(internal helper)`
// renumbers from 1, so an identity `{order: 1}` (or a bare `{}`) is dropped
// by a write without changing a rendered character — permitted, and the one
// place this gate trades strict deep-equality for content fidelity. Anything
// else is a real renumber or a real loss: a non-identity `order`, a
// non-integer, or any additional key.
```

---

```
// `(internal helper)` stamps `{language}` ONLY when the fence carries one, and reads
// it back through `.trim()` — so a blank or space-padded language is lost.
```

---

```
// `localId` is the one attrs key every rule below ignores before checking
// anything else: Jira's own editor stamps it on virtually every node it
// writes, it renders as nothing, and it is re-stamped on the next edit
// regardless of what Harbour stores. Fail-closed by construction — this is an
// explicit allowlist of one key, so any OTHER unknown attrs key still refuses
// exactly as before. See `adfHasUnrenderableContent`'s docstring, exception 3.
```

---

```
/**
 * The inline Markdown a container's single paragraph child renders to. Used by
 * the trim rules below — several containers `.trim()` their rendered content on
 * the way out, or have it trimmed on the way back in, so leading/trailing
 * whitespace in the STORED text is destroyed by the round trip even though every
 * node type involved is perfectly rebuildable.
 */
```

---

```
// A heading's content goes through bare `(internal helper)` — see `(internal helper)`.
// Its text is also trimmed twice on the way back (`^(#{1,6})\s+` eats the
// leading run, then `.trim()`), and an empty heading loses the `# ` marker
// entirely and re-reads as a paragraph of literal `#`. A blank line inside
// it splits the block in two, taking the `# ` with it.
```

---

```
// `(internal helper)` emits `\n\n` per paragraph and `markdownToAdf` splits
// blocks on exactly that, so a paragraph that renders to nothing is DROPPED
// on write (the review's empty spacer paragraph) and one whose text carries
// a blank line is TORN IN TWO. Leading/trailing newlines are stripped by
// the block split's own `replace(/^\n+|\n+$/g, '')`.
//
// An empty paragraph is PERMITTED here regardless of position — nested in a
// list item it is the perfectly rebuildable `- ` line of a multi-item list;
// at top level (mid-document or trailing) it is a genuinely lossy but
// deliberately accepted trade (LIN-2019, `adfHasUnrenderableContent`'s
// docstring exception 4): the blank line is silently dropped rather than
// refusing the write. A LEADING top-level empty paragraph, and a
// document consisting of nothing else, are still refused — not by this
// rule, but by the document-edge rule in `adfHasUnrenderableContent`,
// which sees the whole render rather than one node and has no trailing
// equivalent of its leading-edge check.
```

---

```
// `(internal helper)` always builds `{blockquote, content: [{paragraph, ...}]}` —
// exactly one paragraph child. A stored blockquote holding two paragraphs
// collapses into one hardBreak-joined paragraph; one holding a codeBlock or
// heading loses that child's block type entirely.
```

---

```
// `(internal helper)` trims before prefixing each line with `> `.
```

---

```
// `(internal helper)` always builds `{listItem, content: [{paragraph, ...}]}` —
// exactly one paragraph child. This is also what makes NESTED LISTS
// unrebuildable at any depth: a nested list lives as a second child of its
// parent listItem, so every nesting level trips this rule (the writer would
// otherwise re-emit the nested items as flat siblings of the outer list).
```

---

```
// A `- ` line the reader broke across two lines no longer parses as a
// list at all — `(internal helper)` requires EVERY line of the block to carry
// the bullet, so the whole list degrades to one paragraph.
```

---

```
// `(internal helper)` trims each item before prefixing its marker, and
// `(internal helper)` strips the marker with a greedy `^-\s+` / `^\d+\.\s+` that
// eats any leading whitespace with it. So `"  padded  "` is destroyed in
// both directions (LIN-1886 review F1 sub-class (b)).
```

---

```
// `markdownToAdf` splits its input into blocks on blank lines BEFORE
// `(internal helper)` ever sees a fence, so a fenced body containing a blank line
// (or an empty one) is torn into two blocks and the closing ``` leaks out
// as literal paragraph text. The reader also strips trailing newlines off
// the body, so a fence is only rebuildable as a single non-empty text run
// with no blank line and no leading/trailing newline.
```

---

```
// A code block's body is the one place a `\n`-bearing text run IS rebuildable
// (it is fenced and read back verbatim). Its shape rule above has already
// validated that single child in full, so stop here rather than recursing into
// it and tripping the newline rule below on legitimate multi-line code.
```

---

```
// `(internal helper)` splits every `\n` into a `hardBreak`, so a stored
// run carrying one re-reads as several runs. The writer never emits such a
// run — `(internal helper)` only ever sees one line. A HEADING is the exception:
// its content goes through bare `(internal helper)`, which has no line concept and
// hands the newline straight back (the heading's own shape rule above still
// refuses a blank line or an edge newline, which would break the block).
```

---

```
// An empty run cannot carry a mark home: `**` / `__` / `~~~~` are all
// empty-content forms the inline pass rejects (its `+` quantifiers), so
// they re-read as literal text and the mark is lost. A `link` is the one
// exception — `[](href)` has always allowed empty link text.
```

---

```
// Marks are derived from `(internal helper)` directly (never a second
// hand-copied list) — `(internal helper)` parses exactly that
// vocabulary back.
```

---

```
// ...but only ONE mark per run. The inline pass is a single non-nesting
// left-to-right scan, so a strong+em run renders `_**x**_` and re-parses
// as ONE em run whose literal text is `**x**` — a mark silently lost and
// raw Markdown leaked into the body (LIN-1886 review Blocker 3, confirmed
// by the property test).
```

---

```
// A link's href rides the `](…)` slot, which is line-bounded and (since
// fix cycle 3) paren-escaped. A newline in it would still break the block.
```

---

```
// Two adjacent UNMARKED runs render as one uninterrupted stretch of text,
// and `(internal helper)` accumulates contiguous literal text into a single
// node — so the split between them is not recoverable. (Adjacent runs
// carrying a mark are fine: their delimiters survive and re-split them,
// which is why this is narrowed to unmarked pairs rather than any pair.)
```

### Above `adfHasUnrenderableContent(doc)`

```
/**
 * True if `doc` contains anything `markdownToAdf` cannot reconstruct from
 * `adfToMarkdown(doc)`. The invariant this gate exists to buy is:
 *
 *     adfHasUnrenderableContent(doc) === false
 *       ⟹  markdownToAdf(adfToMarkdown(doc)) deep-equals doc,
 *           EXCEPT for the four enumerated classes below
 *
 * — asserted, in both directions, over the fixture list and the generated
 * adversarial corpus in `tests/unit/the codec test file`. See the note above
 * `(internal helper)` for exactly how far that evidence reaches.
 *
 * The exceptions are ENUMERATED rather than papered over. This docstring
 * previously asserted the invariant unqualified, and it was not true; an
 * overclaiming property is what let a real defect sit through three review
 * cycles, so the wording is now the weakest claim the evidence actually
 * supports and no weaker (LIN-1886, John's ruling `d38d3755`). Exceptions 1-3
 * are STRUCTURE-ONLY — none changes a rendered character. Exception 4 is
 * different in kind and is called out as such below: it does drop a rendered
 * character (a blank line), a deliberate trade rather than a harmless one. All
 * four are pinned by fixtures, so a regression that widened any of them would
 * fail.
 *
 *   1. **An empty, unmarked text run — tracked as LIN-1939.** Pre-existing and
 *      orthogonal: it is NOT introduced by LIN-1886 (the identical probe gives
 *      byte-identical results at this head and at the pre-change base) and is
 *      deliberately not fixed here. `{type: 'text', text: ''}` carrying no
 *      marks slips both guards below — the empty-run rule needs the run to
 *      CARRY a mark, the adjacent-unmarked-pair rule needs BOTH neighbours
 *      unmarked — and the round trip drops it:
 *
 *          { type: 'paragraph', content: [
 *              { type: 'text', text: '' },
 *              { type: 'text', text: 'x', marks: [{ type: 'em' }] } ] }
 *
 *      → permitted; renders `_x_`; re-reads WITHOUT the empty run. Nothing
 *      visible is lost (the run is empty), but the document is restructured
 *      under a 200. See LIN-1939 before relying on the invariant for a
 *      mark-adjacency case.
 *
 *   2. **An `orderedList`'s identity `attrs`** — `{order: 1}`, or a bare `{}`,
 *      permitted by `(internal helper)` above per the same ruling. The
 *      writer emits no `attrs` key at all, so the key is ABSENT after the
 *      round trip. The rendered Markdown is identical either way (the reader
 *      renumbers from 1 regardless), which is the sense in which the identity
 *      value is harmless; the deep-equality is nevertheless genuinely lost, so
 *      it is named here rather than claimed away. A non-identity `order` is
 *      still refused, because dropping THAT renumbers the list.
 *
 *   3. **A `localId` attrs key, on any node type — LIN-2019.** Jira's own
 *      editor stamps it on virtually every node it writes; it renders as
 *      nothing and is re-stamped on the next edit regardless of what Harbour
 *      stores. `(internal helper)` strips it before the attrs
 *      check runs, so the key is simply ABSENT after the round trip — the same
 *      shape of exception as #2, just keyed on an attrs NAME rather than a
 *      node type. Fail-closed by construction: only this one key is
 *      allowlisted, so a node carrying `localId` PLUS any other unrecognized
 *      attrs key still refuses, and a shape that is independently
 *      unrebuildable (a nested list, a multi-paragraph blockquote, a
 *      non-identity `orderedList.order`) still refuses regardless of
 *      `localId`'s presence — the shape/type checks are untouched, only the
 *      attrs check ignores this one key.
 *
 *   4. **A top-level empty paragraph — LIN-2019, genuinely lossy, not
 *      structure-only.** Permitted, with its blank line silently dropped on
 *      write, in two positions:
 *      - **mid-document**, e.g. `[p("one"), p(""), p("two")]`: the blank line
 *        collapses — `"one\n\n\n\ntwo"` renders, and reads back as
 *        `"one\n\ntwo"` (one fewer top-level node).
 *      - **trailing**, e.g. `[p("one"), p("")]`: also permitted and dropped.
 *        The document-edge rule below strips trailing block-separator
 *        newlines with `raw.replace(/\n+$/, '')` BEFORE its `trimEnd`
 *        comparison, so it cannot see a trailing empty paragraph — this
 *        node-level rule was its only guard, and removing that guard exposes
 *        the trailing case along with the mid-document one.
 *      A **leading** top-level empty paragraph (`[p(""), p("one")]`) and a
 *      description that is an empty paragraph ALONE (`[p("")]`) are still
 *      refused — not by this rule (which now permits an empty paragraph
 *      unconditionally), but by the document-edge rule's `trimStart()` check,
 *      which has no trailing-side equivalent. This leading/trailing asymmetry
 *      pre-dates this exception and is now worth naming explicitly. The trade
 *      is deliberate: refusing every human-touched Jira description (every
 *      one of Jira's own editor's blank lines) is worse than silently
 *      dropping a blank line a reader is unlikely to notice.
 *
 * Everything else this gate permits deep-equals in the strict sense.
 *
 * The gate is derived from the WRITER's vocabulary, not the reader's (LIN-1886
 * review Blocker 3 — deriving it from the reader is what let a 200-OK append
 * flatten a mention/emoji/smart-link description into one anonymous text run).
 * Five things trip it, checked recursively through the WHOLE tree (a table
 * nested three levels inside an otherwise-modeled list is still caught):
 *   - a node `type` outside `(internal helper)`;
 *   - a permitted type in a shape the writer never emits
 *     (`(internal helper)` — a multi-paragraph blockquote, a listItem
 *     holding anything but one paragraph (hence any nested list), a fenced code
 *     body with a blank line, a hardBreak inside a heading or a list item);
 *   - `attrs` the writer cannot re-emit (`(internal helper)` — a
 *     NON-IDENTITY `orderedList` `order`, a heading `level` outside 1-6, a
 *     padded `codeBlock` language: LIN-1886 review F1 sub-class (b));
 *   - whitespace a `.trim()` on either side of the round trip destroys — at a
 *     list item, a blockquote, a heading, or the document's own edges;
 *   - a text node carrying a mark outside `(internal helper)`'s keys, MORE THAN
 *     ONE mark, or an embedded newline outside a fence.
 *
 * WHAT IS NOT ON THIS LIST, and deliberately (LIN-1886 review F1, human
 * decision `599551c2`): Markdown-syntax collisions in ordinary prose. A
 * paragraph reading `- not a list`, or `foo_bar_baz`, or ```` ```js ```` is NOT
 * refused — `adfToMarkdown` escapes it and it round-trips faithfully. Refusing
 * prose was rejected as a remedy; escaping is the one this cycle implements.
 *
 * Used to refuse (422) an in-app description overwrite that would silently
 * destroy Jira-native content — never used to reject a READ. `adfToMarkdown`
 * still renders mentions, emoji and cards for display; only the write tightens.
 *
 * Mirrors `adfToMarkdown`'s own contract: the wrapper's `type` (`'doc'` on a
 * real Jira document) is never itself validated, only `doc.content` — so a
 * bare `{ content: [...] }`, exactly what `adfToMarkdown`'s own test literals
 * use, is inspected the same way a `{ type: 'doc', content: [...] }` document
 * would be.
 * @param {object|null|undefined} doc - an ADF document (or any ADF node)
 * @returns {boolean}
 */
```

---

```
// The document's OWN edges. `adfToMarkdown` finishes with a `.trim()`, which
// is invisible to any per-node rule: every node here can be individually
// rebuildable and the first block's leading space still be eaten. The
// trailing side ignores the block-separating newlines every renderer emits —
// those are structure, not content — and asks only about what precedes them.
```
