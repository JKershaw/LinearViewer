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
// escaped), and the gate refuses exactly what the writer cannot rebuild. The
// Markdown grammar both directions share is defined once, below, so the
// reader, the writer and the gate cannot drift apart.
// =============================================================================

// -----------------------------------------------------------------------------
// The shared Markdown grammar
// -----------------------------------------------------------------------------

/**
 * What `markdownToAdf` splits a document into blocks on: TWO LITERAL NEWLINES,
 * nothing else. The gate's shape rules test the same pattern against a rendered
 * body, so the two cannot drift: a rule that refused a "blank" line the split
 * does not actually break on (`"\n \n"`, trailing whitespace on an otherwise
 * blank line, very common in pasted code) would refuse content that
 * round-trips perfectly. Share the constant; do not re-type the regex.
 */
const BLANK_LINE = /\n{2,}/

/** Every renderer ends a block with this; the writer splits on it. */
const BLOCK_END = '\n\n'

// Block forms the writer recognises. FENCE and HEADING are matched against the
// whole BLOCK (so their `\s` can cross a newline); RULE cannot span lines, and
// the others are matched against every line of the block, so their `\s` never
// can cross a newline.
//
// FENCE: an opening ``` line (its remainder is the language) and at least one
// body line, or the closing line straight away (an empty block). The closing
// line is otherwise optional: a snippet split by a blank line leaves an
// unclosed fence, which stays code. A lone ``` line is text. The closing line
// and a rule tolerate trailing whitespace or a CR (LIN-3557), and a rule may
// be indented (LIN-3557 review).
const FENCE = /^```([^\n]*)\n(?:```[^\S\n]*|([\s\S]+?)(?:\n```[^\S\n]*)?)$/
const HEADING = /^(#{1,6})\s+(\S[\s\S]*)$/
const RULE = /^[^\S\n]*-{3,}[^\S\n]*$/
const QUOTE_LINE = /^\s*>\s/
const BULLET_ITEM = /^\s*[-*]\s+/
const ORDERED_ITEM = /^\s*\d+\.\s+/

// `(\s|$)`, not `\s`: a line of nothing but hashes is a heading leader too.
// HEADING is matched against the whole block, and its `\s+` happily consumes
// the `\n` a hardBreak rendered, so `"#\nrest"` would read back as a level-1
// heading with the `#` line gone (LIN-1886 re-review R2).
const HEADING_LEADER = /^#{1,6}(\s|$)/

/**
 * The delimited marks, in the writer's scan order. The reader renders with the
 * same table and the gate's mark vocabulary is this table plus `link` and
 * `code` (whose variable-length backtick fence does not fit a fixed
 * delimiter), so no mark is parsed that the reader cannot render, or vice
 * versa.
 *
 * Inside a run, an unescaped occurrence of the delimiter's character ends the
 * attempt (the old pattern's `[^*]+` / `[^~]+` classes): a lone `*` inside
 * `**…**` means "this is not a strong run".
 */
const MARKS = [
  { type: 'strong', delimiter: '**' },
  { type: 'em', delimiter: '_' },
  { type: 'strike', delimiter: '~~' },
]

/**
 * Escape contexts: which characters are backslash-escaped on the way out, and
 * which `\x` pairs are consumed on the way back in.
 *
 * Inline text: every character the inline pass can open a construct with
 * (`[`, a backtick, and each MARKS delimiter's character), plus `]` (which
 * ends link text) and the backslash itself. Unescaping follows CommonMark: a
 * backslash escapes ASCII punctuation and nothing else. That is what keeps a
 * hand-typed `C:\Users\me` or a regex's `\d` intact, while the codec still
 * round-trips its own escapes.
 *
 * Hrefs: both brackets and the backslash are escaped, and both brackets are
 * unescaped on the way back in. `)` because the writer ends an href at the
 * first unescaped `)` (the `(`-truncation bug, LIN-1886 review F1). `(` because
 * `marked`, the dashboard renderer, accepts an unescaped `(` in a destination
 * only when it is balanced, and with `)` escaped it never is: `Foo_(bar\)`
 * renders as literal text plus a wrong auto-link (LIN-3561). An href is
 * unescaped with its own narrow set, not the inline one, or the pass would eat
 * backslashes the writer never put there.
 *
 * Code spans have no escape context: CommonMark processes no escapes inside
 * one, so they are fenced instead (`codeSpan` / `parseCodeSpan`).
 */
const INLINE_SPECIAL = /[\\[\]`*_~]/g
const ASCII_PUNCTUATION = '[!-/:-@[-`{-~]'
const ESCAPED_ASCII_PUNCTUATION = new RegExp(`\\\\(${ASCII_PUNCTUATION})`, 'g')
const ONE_ASCII_PUNCTUATION = new RegExp(`^${ASCII_PUNCTUATION}$`)
const isAsciiPunctuation = char => char !== undefined && ONE_ASCII_PUNCTUATION.test(char)
const HREF_SPECIAL = /[\\()]/g
const ESCAPED_HREF_SPECIAL = /\\([\\()])/g

const escapeInline = text => text.replace(INLINE_SPECIAL, '\\$&')
const unescapeInline = text => text.replace(ESCAPED_ASCII_PUNCTUATION, '$1')
const escapeHref = href => href.replace(HREF_SPECIAL, '\\$&')
const unescapeHref = href => href.replace(ESCAPED_HREF_SPECIAL, '$1')

/**
 * CommonMark strips one space from each side of a code span when both are
 * present and the content is not all spaces (a line ending counts as a space). The writer applies the strip;
 * the reader pads exactly when the strip would otherwise eat the text's own
 * spaces.
 */
const hasStrippablePadding = text => text.startsWith(' ') && text.endsWith(' ') && /[^ \n]/.test(text)

// -----------------------------------------------------------------------------
// Small ADF helpers
// -----------------------------------------------------------------------------

const isObject = value => typeof value === 'object' && value !== null && !Array.isArray(value)
const childrenOf = node => (Array.isArray(node.content) ? node.content : [])
const marksOf = run => (Array.isArray(run.marks) ? run.marks.filter(isObject) : [])
const textOf = run => (typeof run.text === 'string' ? run.text : '')
const textNode = (text, marks) => (marks ? { type: 'text', text, marks } : { type: 'text', text })

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
// why `escapeHref` escapes both brackets.
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

/**
 * Convert an ADF document (Jira's rich-text wire shape) to Markdown.
 * @param {{type?: string, content?: Array}|null|undefined} doc
 * @returns {string}
 */
export function adfToMarkdown(doc) {
  return isObject(doc) ? renderChildren(doc).trim() : ''
}

function renderChildren(node) {
  return childrenOf(node).map(renderNode).join('')
}

function renderNode(node) {
  if (!isObject(node)) return ''
  const attrs = isObject(node.attrs) ? node.attrs : {}
  switch (node.type) {
    case 'text': return renderTextRun(node)
    case 'hardBreak': return '\n'
    case 'paragraph': return renderParagraph(node) + BLOCK_END
    case 'heading': return `${'#'.repeat(headingLevel(attrs.level))} ${renderChildren(node)}${BLOCK_END}`
    case 'bulletList': return renderList(node, () => '- ')
    // Always numbered from 1, whatever `attrs.order` says (see the gate's attrs rules).
    case 'orderedList': return renderList(node, i => `${i + 1}. `)
    case 'listItem': return renderChildren(node)
    // The reader trims before prefixing each line with `> `.
    case 'blockquote': return renderChildren(node).trim().split('\n').map(line => `> ${line}`).join('\n') + BLOCK_END
    case 'codeBlock': return '```' + (attrs.language ?? '') + '\n' + codeBlockBody(node) + '\n```' + BLOCK_END
    case 'rule': return '---' + BLOCK_END
    case 'mention': return attrs.text || (attrs.id ? `@${attrs.id}` : '')
    case 'emoji': return attrs.text || attrs.shortName || ''
    case 'inlineCard': return attrs.url || ''
    case 'blockCard': return (attrs.url || '') + BLOCK_END
    default: return renderChildren(node)
  }
}

/** Clamped into 1-6; a missing or non-numeric level is 1. */
function headingLevel(level) {
  return Math.min(6, Math.max(1, Math.trunc(Number(level)) || 1))
}

/** Each item is trimmed, one per line. */
function renderList(node, marker) {
  return childrenOf(node).map((item, i) => marker(i) + renderNode(item).trim()).join('\n') + BLOCK_END
}

/**
 * A paragraph's inline Markdown, with any line that would open a block
 * neutralised. Applied per line, because the writer tests the quote, bullet
 * and ordered forms against EVERY line of a block.
 */
function renderParagraph(node) {
  return renderChildren(node).split('\n').map(neutraliseBlockLeader).join('\n')
}

/**
 * Neutralise a LEADING token the writer reads as a block marker. Inline
 * escaping cannot reach these: `#`, `>`, `-` and `.` are not inline markup,
 * they are only markup in first position. A fence needs no case here: the
 * inline pass has already escaped a text run's backticks, so ```` ```js ````
 * leaves as `` \`\`\`js `` and cannot open a block. A code span cannot be
 * escaped; one that would start the block with a fence is refused by the gate.
 *
 * The backslash goes directly before the marker, never at the start of the
 * line: a rule or list marker may carry leading whitespace, and `"\ ---"` is
 * not an escape. An ordered marker's digits are not punctuation, so its `.` is
 * escaped instead (`1\. not a list`).
 */
function neutraliseBlockLeader(line) {
  if (ORDERED_ITEM.test(line)) return line.replace('.', '\\.')
  const opensBlock = [HEADING_LEADER, RULE, QUOTE_LINE, BULLET_ITEM].some(form => form.test(line))
  return opensBlock ? line.replace(/\S/, '\\$&') : line
}

/** A text run, escaped (code: left raw for `codeSpan`), then wrapped in each mark. */
function renderTextRun(run) {
  const text = textOf(run)
  const marks = marksOf(run)
  const isCode = marks.some(mark => mark.type === 'code')
  return marks.reduce(wrapInMark, isCode ? codeSpan(text) : escapeInline(text))
}

function wrapInMark(markdown, mark) {
  if (mark.type === 'link') {
    const href = mark.attrs?.href
    return `[${markdown}](${escapeHref(typeof href === 'string' ? href : '')})`
  }
  const delimited = MARKS.find(({ type }) => type === mark.type)
  return delimited ? delimited.delimiter + markdown + delimited.delimiter : markdown
}

/**
 * A code span, CommonMark's way: the text verbatim, fenced by a backtick run
 * one longer than the longest inside it, padded by one space each side where
 * the reader's edge-space strip would otherwise eat the text's own spaces or a
 * fence-adjacent backtick would merge into the fence.
 */
function codeSpan(text) {
  const longestRun = Math.max(0, ...(text.match(/`+/g) ?? []).map(run => run.length))
  const fence = '`'.repeat(longestRun + 1)
  const pad = text.startsWith('`') || text.endsWith('`') || hasStrippablePadding(text) ? ' ' : ''
  return fence + pad + text + pad + fence
}

/**
 * A code BLOCK's body, verbatim, minus trailing newlines. It sits between
 * fences and the writer reads it back with no inline pass, so escaping it
 * would corrupt exactly the content the fence exists to protect.
 */
function codeBlockBody(node) {
  return plainText(node).replace(/\n+$/, '')
}

function plainText(node) {
  if (!isObject(node)) return ''
  return typeof node.text === 'string' ? node.text : childrenOf(node).map(plainText).join('')
}

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

/**
 * Convert Markdown to an ADF document, the write-direction inverse of
 * `adfToMarkdown`. Unsupported Markdown degrades to a plain paragraph rather
 * than throwing; refusing unrenderable content is `adfHasUnrenderableContent`'s
 * job, applied to the EXISTING stored ADF a write is about to overwrite. That
 * gate is derived from this function, so it can never flag what this emits.
 * @param {string|null|undefined} markdown
 * @returns {{type: 'doc', version: 1, content: Array}}
 */
export function markdownToAdf(markdown) {
  // Trimming the whole input first means no block carries an edge newline
  // after the split. The reader's own output is already trimmed.
  const source = typeof markdown === 'string' ? markdown.trim() : ''
  return { type: 'doc', version: 1, content: source ? source.split(BLANK_LINE).map(parseBlock) : [] }
}

/** One blank-line-delimited Markdown block → one ADF block node. */
function parseBlock(block) {
  const fence = FENCE.exec(block)
  if (fence) {
    const language = fence[1].trim()
    return { type: 'codeBlock', ...(language && { attrs: { language } }), content: fence[2] ? [textNode(fence[2])] : [] }
  }
  const heading = HEADING.exec(block)
  // Bare inline pass: a heading has no line concept, so a `\n` stays text.
  if (heading) return { type: 'heading', attrs: { level: heading[1].length }, content: parseInline(heading[2].trim()) }
  if (RULE.test(block)) return { type: 'rule' }

  const lines = block.split('\n')
  if (lines.every(line => QUOTE_LINE.test(line))) {
    return { type: 'blockquote', content: [paragraph(lines.map(line => line.replace(QUOTE_LINE, '')))] }
  }
  if (lines.every(line => BULLET_ITEM.test(line))) return list('bulletList', lines, BULLET_ITEM)
  if (lines.every(line => ORDERED_ITEM.test(line))) return list('orderedList', lines, ORDERED_ITEM)
  return paragraph(lines)
}

/** Each line is one item; its marker is stripped greedily, along with any leading whitespace. */
function list(type, lines, marker) {
  return { type, content: lines.map(line => ({ type: 'listItem', content: [paragraph([line.replace(marker, '')])] })) }
}

/** A block's lines, as `hardBreak`-joined inline runs. */
function paragraph(lines) {
  return { type: 'paragraph', content: lines.flatMap((line, i) => (i ? [{ type: 'hardBreak' }] : []).concat(parseInline(line))) }
}

/**
 * The inline pass: a left-to-right scan, not one regex, because honouring a
 * `\x` escape is not something a single alternation can express (`[^\]]*`
 * cannot be taught that `\]` is literal, which is the bug that lost the link
 * mark on `[a]b](http://x)`).
 *
 * Leftmost construct wins; at the same position the order is link, then
 * MARKS' order, so a link whose text contains another marker is captured
 * whole. Contiguous literal text accumulates into a single node. The inline
 * pass does not nest: a construct's inner text is only unescaped.
 *
 * An empty input still yields one empty run: that is what makes an empty list
 * item (a bare `- ` line in a multi-item list) rebuildable.
 */
function parseInline(source) {
  const nodes = []
  let literal = ''
  let i = 0
  while (i < source.length) {
    if (source[i] === '\\' && isAsciiPunctuation(source[i + 1])) {
      literal += source[i + 1]
      i += 2
      continue
    }
    const found = parseLink(source, i) ?? parseCodeSpan(source, i) ?? parseDelimited(source, i)
    if (!found) {
      literal += source[i]
      i += 1
      continue
    }
    if (found.node) {
      if (literal) nodes.push(textNode(literal))
      literal = ''
      nodes.push(found.node)
    } else {
      literal += found.literal
    }
    i = found.end
  }
  if (literal || !nodes.length) nodes.push(textNode(literal))
  return nodes
}

/** `[text](href)`. Unlike the delimited marks, empty link text is allowed. */
function parseLink(source, start) {
  if (source[start] !== '[') return null
  const textEnd = findUnescaped(source, start + 1, ']')
  if (textEnd < 0 || source[textEnd + 1] !== '(') return null
  const hrefEnd = findUnescaped(source, textEnd + 2, ')')
  if (hrefEnd < 0) return null
  const href = unescapeHref(source.slice(textEnd + 2, hrefEnd))
  const text = unescapeInline(source.slice(start + 1, textEnd))
  return { node: textNode(text, [{ type: 'link', attrs: { href } }]), end: hrefEnd + 1 }
}

/**
 * A code span, as CommonMark reads it: the opening is the WHOLE run of N
 * backticks, and it closes at the next run of exactly N. Nothing inside is
 * unescaped. With no closing run the opening run is literal text: returned as
 * `{literal, end}` so the scan resumes after the whole run rather than
 * re-reading its tail as a shorter opening.
 */
function parseCodeSpan(source, start) {
  if (source[start] !== '`') return null
  const open = backtickRunLength(source, start)
  for (let i = start + open; i < source.length;) {
    if (source[i] !== '`') { i += 1; continue }
    const run = backtickRunLength(source, i)
    if (run === open) {
      const content = source.slice(start + open, i)
      const text = hasStrippablePadding(content) ? content.slice(1, -1) : content
      return { node: textNode(text, [{ type: 'code' }]), end: i + run }
    }
    i += run
  }
  return { literal: source.slice(start, start + open), end: start + open }
}

function backtickRunLength(source, start) {
  let end = start
  while (source[end] === '`') end += 1
  return end - start
}

// `close === start` is an empty run; those stay literal, so `**` and `____`
// are plain text.
function parseDelimited(source, start) {
  const mark = MARKS.find(({ delimiter }) => source.startsWith(delimiter, start))
  if (!mark) return null
  const { type, delimiter } = mark
  const contentStart = start + delimiter.length
  const close = findUnescaped(source, contentStart, delimiter, delimiter[0])
  if (close <= contentStart) return null
  return { node: textNode(unescapeInline(source.slice(contentStart, close)), [{ type }]), end: close + delimiter.length }
}

/**
 * Index of the next UNESCAPED `close` at or after `from`; -1 if there is none,
 * or if an unescaped `stopAt` character comes first.
 */
function findUnescaped(source, from, close, stopAt) {
  for (let i = from; i < source.length; i += 1) {
    if (source[i] === '\\') i += 1
    else if (source.startsWith(close, i)) return i
    else if (source[i] === stopAt) return -1
  }
  return -1
}

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
// `parseBlock` / `parseInline` / MARKS / the block forms, never with
// `renderNode`'s vocabulary.
//
// Every rule is pinned by a fixture in the ADF → Markdown → ADF property tests.

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
 * - codeBlock: exactly one text run (its body is checked by its shape rule).
 * - lists: at least one item; an empty list renders to nothing.
 */
const WRITER_CHILDREN = {
  doc: { types: ['paragraph', 'heading', 'bulletList', 'orderedList', 'codeBlock', 'blockquote', 'rule'] },
  paragraph: { types: ['text', 'hardBreak'] },
  heading: { types: ['text'] },
  bulletList: { types: ['listItem'], min: 1 },
  orderedList: { types: ['listItem'], min: 1 },
  listItem: { types: ['paragraph'], min: 1, max: 1 },
  blockquote: { types: ['paragraph'], min: 1, max: 1 },
  codeBlock: { types: ['text'], min: 1, max: 1 },
  rule: { types: [] },
  text: { types: [] },
  hardBreak: { types: [] },
}

/** The mark types the writer can emit: MARKS plus `link` and `code`. */
const WRITER_MARKS = new Set([...MARKS.map(({ type }) => type), 'link', 'code'])

/**
 * The `attrs` each node (or mark) type may carry, and the value the writer
 * would have to see to re-emit each (LIN-1886 review F1 sub-class (b)). A type
 * not listed must carry NO `attrs` at all: the writer emits none for it, so
 * any stored `attrs` object, even an empty one, cannot survive a write.
 */
const WRITER_ATTRS = {
  // The writer always stamps `{level}` from the `#` run length, so it is
  // required; the reader clamps anything outside 1-6 (the review's `{level: 7}`).
  heading: { level: { required: true, valid: v => Number.isInteger(v) && v >= 1 && v <= 6 } },
  // Stamped ONLY when the fence carries a language, and read back through
  // `.trim()`, so a blank or space-padded language is lost, and a newline in it
  // ends the fence line, moving the rest of the language into the body.
  codeBlock: { language: { valid: v => typeof v === 'string' && v !== '' && v === v.trim() && !v.includes('\n') } },
  // Exception 2 (John's ruling `d38d3755`): the writer emits an orderedList
  // with no attrs and the reader renumbers from 1, so dropping an identity
  // `{order: 1}` (or a bare `{}`) changes no rendered character. Only the
  // EXACT integer 1: `{order: 0}` or `{order: -3}` would renumber a visibly
  // 0-based list. A non-identity order is refused rather than modelled, "UNTIL
  // THE WRITER MODELS THE ATTRIBUTE"; modelling it would change what a
  // hand-typed `5. foo` means, and re-review `5ae61f22` measured that it would
  // only move the deep-equal gap onto the far commoner no-attrs list.
  orderedList: { order: { valid: v => v === 1 } },
  // An href rides the line-bounded `](…)` slot; a newline would break the block.
  link: { href: { required: true, valid: v => typeof v === 'string' && !v.includes('\n') } },
}

function hasRebuildableAttrs({ type, attrs }) {
  const allowed = WRITER_ATTRS[type] ?? {}
  const required = Object.keys(allowed).filter(key => allowed[key].required)
  if (attrs === undefined) return required.length === 0
  if (!isObject(attrs)) return false
  // Exception 3 (LIN-2019): `localId` is ignored before anything else. Jira's
  // editor stamps it on virtually every node, it renders as nothing, and it is
  // re-stamped on the next edit. Fail-closed: an allowlist of exactly one key.
  const { localId, ...rest } = attrs
  if (!required.every(key => key in rest)) return false
  const keys = Object.keys(rest)
  // An attrs object with nothing left in it survives only as an exception
  // (3: it held a `localId`; 2: an orderedList's bare `{}`).
  if (keys.length === 0) return 'localId' in attrs || type === 'orderedList'
  return keys.every(key => Object.hasOwn(allowed, key) && allowed[key].valid(rest[key]))
}

/**
 * Rules for a permitted type in a shape the writer never emits, beyond which
 * children it holds. Most compare against what the node RENDERS to, because
 * several containers `.trim()` their content on the way out or have it
 * trimmed on the way back in. `true` = the writer cannot rebuild this node.
 */
const UNREBUILDABLE_SHAPE = {
  // Heading text is trimmed twice on the way back (HEADING's `\s+`, then
  // `.trim()`); an empty heading loses its `# ` and re-reads as a paragraph of
  // literal `#`; a blank line inside it splits the block.
  heading: node => {
    const markdown = renderChildren(node)
    return markdown === '' || markdown !== markdown.trim() || BLANK_LINE.test(markdown)
      || hasUnrebuildableRuns(childrenOf(node), { newlinesAllowed: true })
  },

  // The writer splits blocks on blank lines and strips the edges' newlines, so
  // a paragraph whose text carries a blank line is TORN IN TWO and an edge
  // newline is lost.
  //
  // An EMPTY paragraph is permitted anywhere. In a list item it is the
  // rebuildable `- ` line of a multi-item list. At top level it is exception 4
  // (LIN-2019): genuinely lossy, deliberately accepted. A leading empty
  // paragraph, or one alone, is still refused, by the document-edge rule.
  //
  // A multi-line paragraph whose first line opens with ``` reads back as a
  // code block. Only a code span can do that (a text run's backticks are
  // escaped), and a backslash cannot neutralise it, so it is refused rather
  // than escaped.
  paragraph: node => {
    const markdown = renderParagraph(node)
    return BLANK_LINE.test(markdown) || markdown.startsWith('\n') || markdown.endsWith('\n') || FENCE.test(markdown)
      || hasUnrebuildableRuns(childrenOf(node), { newlinesAllowed: false })
  },

  // A list item broken across two lines no longer parses as a list (the writer
  // requires EVERY line of the block to carry the marker). The reader trims
  // each item and the writer's greedy marker regex eats leading whitespace, so
  // `"  padded  "` is destroyed in both directions (LIN-1886 review F1 (b)).
  listItem: node => {
    const markdown = renderParagraph(childrenOf(node)[0])
    return markdown.includes('\n') || markdown !== markdown.trim()
  },

  // The reader trims before prefixing each line with `> `.
  blockquote: node => {
    const markdown = renderParagraph(childrenOf(node)[0])
    return markdown !== markdown.trim()
  },

  // The block split runs BEFORE the fence is seen, so a body containing a
  // blank line (or an empty body) is torn in two and the closing ``` leaks out
  // as text. The reader also strips trailing newlines off the body. So a fence
  // is rebuildable only as one unmarked, non-empty run with no blank line and
  // no edge newline.
  codeBlock: node => {
    const [run] = childrenOf(node)
    const body = textOf(run)
    return marksOf(run).length > 0 || body === '' || BLANK_LINE.test(body) || body.startsWith('\n') || body.endsWith('\n')
  },

  text: run => {
    const marks = marksOf(run)
    if (marks.length === 0) return false
    // Only ONE mark per run. The inline pass does not nest, so strong+em renders
    // `_**x**_` and re-parses as ONE em run whose text is literally `**x**`.
    if (marks.length > 1) return true
    const [mark] = marks
    if (!WRITER_MARKS.has(mark.type) || !hasRebuildableAttrs(mark)) return true
    // An empty run cannot carry a mark home: `**`, `__`, `~~~~` stay literal.
    // A link is the exception: `[](href)` has always allowed empty text.
    return textOf(run) === '' && mark.type !== 'link'
  },
}

function hasUnrebuildableRuns(runs, { newlinesAllowed }) {
  return runs.some((run, i) => run.type === 'text' && (
    // The writer splits every `\n` into a hardBreak, so a run carrying one
    // re-reads as several runs. A heading is the exception: its bare inline
    // pass hands the newline straight back (its own rule still refuses a
    // blank line or an edge newline).
    (!newlinesAllowed && textOf(run).includes('\n'))
    || (i > 0 && runsMerge(runs[i - 1], run))
  ))
}

/**
 * Two adjacent UNMARKED runs render as one stretch of text, and the writer
 * accumulates contiguous literal text into a single node, so the split is not
 * recoverable. Two adjacent CODE runs fail the same way: their fences touch
 * (`a` then `b` is ``` `a``b` ```), and CommonMark reads that as one span.
 * Other adjacent marked runs are fine: their delimiters re-split them.
 *
 * Exception 1 (LIN-1939) lives here: an empty unmarked run next to a marked
 * one slips both this rule and the empty-run rule.
 */
function runsMerge(previous, run) {
  if (previous.type !== 'text') return false
  const kind = node => marksOf(node).map(mark => mark.type).join()
  return kind(previous) === kind(run) && (kind(run) === '' || kind(run) === 'code')
}

function isRebuildable(node) {
  if (!isObject(node)) return false
  const allowed = WRITER_CHILDREN[node.type]
  if (!allowed) return false
  const children = childrenOf(node)
  const { types, min = 0, max = Infinity } = allowed
  const childrenFit = children.length >= min && children.length <= max
    && children.every(child => isObject(child) && types.includes(child.type))
  return hasRebuildableAttrs(node) && childrenFit && !UNREBUILDABLE_SHAPE[node.type]?.(node)
    // A code block's body is the one place a `\n`-bearing run IS rebuildable,
    // and its shape rule has already validated it in full: do not recurse.
    && (node.type === 'codeBlock' || children.every(isRebuildable))
}

/**
 * The document's OWN edges. `adfToMarkdown` finishes with a `.trim()`, which
 * no per-node rule can see: every node can be rebuildable and the first
 * block's leading space still be eaten. The trailing side ignores the
 * block-separating newlines every renderer emits (structure, not content) and
 * asks only about what precedes them. That asymmetry is why a leading empty
 * paragraph, or one alone, is refused while a trailing one is permitted.
 */
function losesDocumentEdges(root) {
  const markdown = renderChildren(root)
  const content = markdown.replace(/\n+$/, '')
  return markdown !== markdown.trimStart() || content !== content.trimEnd()
}

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
 * or a shape rule, add it to the corpus too.
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
export function adfHasUnrenderableContent(doc) {
  if (!isObject(doc)) return false
  const root = { type: 'doc', content: childrenOf(doc) }
  return !isRebuildable(root) || losesDocumentEdges(root)
}
