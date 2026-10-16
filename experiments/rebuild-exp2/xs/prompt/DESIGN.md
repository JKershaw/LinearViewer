# Design: the Jira ADF ↔ Markdown codec (`lib/providers/jira/adf.js`)

## What it must do

Three pure functions, no imports, never throw.

| Export | Who sees the result | Contract |
|---|---|---|
| `adfToMarkdown(doc)` | Harbour's dashboard (via `marked`) and the description textarea | Render Jira ADF as Markdown. Mentions, emoji and cards render. Unknown nodes render their children. Anything the writer would read as markup is backslash-escaped, except inside code: code spans are fenced, code blocks are verbatim. |
| `markdownToAdf(md)` | Jira (the ADF Harbour stores) | Parse the Markdown the reader produces (and what a human types). Unsupported syntax falls back to a paragraph. |
| `adfHasUnrenderableContent(doc)` | the user, as a 422 refusal or an allowed save | `true` when a read-then-rewrite of `doc` would change it, apart from four enumerated exceptions (ruling `d38d3755`, LIN-2019). |

The property the gate exists for: gate is false ⟹ `markdownToAdf(adfToMarkdown(doc))` deep-equals `doc`, apart from the exceptions. It must also not over-refuse: a refused doc must really fail that round trip.

## The central decision: the gate runs the round trip

The gate does not keep its own model of what the writer can build. It **performs the write it guards**, then compares the result with the stored document:

```
stored    = comparable(doc.content)
rewritten = comparable(markdownToAdf(adfToMarkdown(doc)).content)
refuse    = stored ≠ rewritten  ||  stored has an empty heading
```

So the property holds by construction. A rule list kept "in lockstep" with the writer can drift from it, and a round trip can't. Any later change to the reader or the writer moves the gate with it automatically. That covers new node types, new marks and new escapes. Cost: one render and one parse per write, on a single description. That's negligible.

`comparable(node)` keeps a node's ADF content: `type`, `text`, `attrs`, `marks` and `content`. Other keys are dropped. A missing `marks` or `content` counts the same as an empty array. It then forgets exactly the losses the rulings accept, and nothing else:

1. **An empty, unmarked text run with no unmarked run beside it** (LIN-1939). It shows nothing. This rule also makes a list item's empty paragraph equal to the writer's `- ` item, which holds one empty run.
2. **An `orderedList`'s identity attrs**, `{}` or `{order: 1}` (ruling `d38d3755`). The reader numbers every list from 1 anyway.
3. **A `localId` attrs key on any node** (LIN-2019). If removing it leaves the attrs empty, the attrs are dropped too.
4. **A top-level empty paragraph that is not the first block** (LIN-2019). A leading empty paragraph, or one alone, stays and is refused.

One refusal is a policy rather than a measured loss. **A heading with no text is refused wherever it sits.** At the document's edge the trim really does lose it. In the middle of a document it survives, but the pinned decision is to refuse it everywhere.

Equality is a small structural `sameJson`. It doesn't depend on key order, as `JSON.stringify` would.

## Read direction: ADF → Markdown

```
doc.content ─► render(node) per node, concatenated ─► trim
```

- `render(node)` is one `switch` on `node.type` that returns a string. Block nodes end with a blank line, inline nodes don't. An unknown type renders its children. This concatenation model is display behaviour: an empty paragraph between two others produces `one\n\n\n\ntwo`, and unknown wrappers such as tables show their cell text. So it stays.
- `renderText(run)` escapes the text unless it carries a `code` mark. It then wraps the text in each mark in turn: `markText`.
- `codeSpan(text)` fences code the CommonMark way. The fence is one backtick longer than the longest run inside it, with padding where needed (LIN-3564).
- `escapeLeader(line)` is applied to every line of a paragraph. If the writer would read the line as a block opener, it escapes the line's **first ASCII punctuation character**. That one rule covers `#`, `>`, `-`, the `.` of `1.` and the first `-` of an indented rule. The test for "would the writer read it so" uses **the writer's own block patterns**. A line is tested against the heading pattern as `line + '\n'`, because the writer tests headings against the whole block (`#\nrest` is a heading, re-review R2).

## Write direction: Markdown → ADF

```
md ─► strip edge newlines ─► split on /\n{2,}/ ─► readBlock per block
readBlock: fence | heading | rule | quote | bullets | numbers | paragraph
paragraph/quote lines ─► readInline per line, joined by hardBreak
```

- `readBlock(block)` makes one ordered decision and returns one node. The first matching form wins.
- `readFence(lines)` handles a code block. The closing fence is optional (LIN-3557 review), and its line may carry trailing whitespace or a CR.
- `readInline(source)` is a **tokenizer over a table of sticky regular expressions**: escape pair, link, code span, unmatched backtick run, `**`, `~~`, `_`. If none matches, it takes one literal character. Literal output accumulates into a single text node. Every delimited body uses one idiom, `(?:\\[\s\S]|[^\\X])`: any character but X, with a backslash carrying the next character. That idiom makes the escape-aware matching declarative, which the `[a]b](…)` link bug needed. Each table row maps a match to either literal text or a node.

## The shared grammar (defined once, used by both directions)

- `BLOCK_SPLIT`: the writer splits on this and nothing else. `"\n \n"` doesn't split (R3.1).
- `HEADING`, `RULE`, `QUOTE`, `BULLET`, `ORDERED`, `FENCE`: the writer's block openers. The reader's `escapeLeader` tests lines against these same patterns.
- `PUNCTUATION`: CommonMark's escapable set. It drives the reader's leader escape, the writer's escape token and inline unescaping.
- `hasStrippableSpaces`: the code-span space rule. The reader pads a span exactly when the writer would strip the padding.

## Departures from the previous structure

- The gate no longer models anything. The child-type table, the attrs allow-list, the per-type shape rules, the adjacency check and the document-edge check are all gone. A comparison with four named exceptions replaces them.
- The reader no longer needs separate paragraph helpers for the gate's use.
- One leader-escape rule (first punctuation) replaces three special cases.
- The inline writer is a regex token table rather than hand-written index scanning.

Not changed, and why: the reader is still one string-returning recursive render with a blank line at the end of each block. That model is simple, and the bytes it produces are what users see. The block reader is still an ordered chain of tests. Precedence is the whole point of block reading, and an ordered `if` chain states it most directly.
