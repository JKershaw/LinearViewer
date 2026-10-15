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
// writer would read as markup, and the gate refuses exactly what the writer
// cannot rebuild. The Markdown grammar both directions share is defined once,
// below, so the reader, the writer and the gate cannot drift apart.
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
const BLOCK_SEPARATOR = /\n{2,}/

/** Every renderer ends a block with this; the writer splits on it. */
const BLOCK_END = '\n\n'

const FENCE = '```'

// Block forms the writer recognises. The heading form is matched against the
// whole BLOCK (so its `\s+` can cross a newline); the others against every
// line of the block, so their `\s` never can.
const HEADING = /^(#{1,6})\s+/
const RULE = /^-{3,}\s*$/
const QUOTE_LINE = /^>\s/
const BULLET_LINE = /^-\s+/
const ORDERED_LINE = /^\d+\.\s+/

// `(\s|$)`, not `\s`: a line of nothing but hashes is a heading leader too.
// HEADING is matched against the whole block, and its `\s+` happily consumes
// the `\n` a hardBreak rendered, so `"#\nrest"` would read back as a level-1
// heading with the `#` line gone (LIN-1886 re-review R2).
const HEADING_LEADER = /^#{1,6}(\s|$)/

/**
 * Escape contexts: which characters are backslash-escaped on the way out, and
 * which `\x` pairs are consumed on the way back in.
 *
 * INLINE: every character the inline pass can open a construct with, plus `]`
 * (which ends link text) and the escape itself. Unescaping follows
 * CommonMark: a backslash escapes ASCII punctuation and nothing else. That is
 * what keeps a hand-typed `C:\Users\me` or a regex's `\d` intact, while the
 * codec still round-trips its own escapes.
 *
 * CODE_SPAN: a `code` run is fenced by backticks and re-read as one opaque
 * span, so only the backtick and the escape need neutralising. Escaping `_`/`*`
 * there would be pure noise in the textarea.
 *
 * HREF: inside a link's href only an unescaped `)` ends it (the `(`-truncation
 * bug, LIN-1886 review F1).
 *
 * A code span and an href are unescaped with their own narrow set, not
 * INLINE's, or the pass would eat backslashes the writer never put there.
 */
const ASCII_PUNCTUATION = /[!-/:-@[-`{-~]/
const INLINE = { escape: /[\\`*_~[\]]/g, unescape: /\\([!-/:-@[-`{-~])/g }
const CODE_SPAN = { escape: /[\\`]/g, unescape: /\\([\\`])/g }
const HREF = { escape: /[\\)]/g, unescape: /\\([\\)])/g }

const escape = (context, text) => text.replace(context.escape, '\\$&')
const unescape = (context, text) => text.replace(context.unescape, '$1')

/**
 * The delimited marks, in the writer's scan order: `[markType, delimiter,
 * stopAt, escape context]`. The reader renders with the same table and the
 * gate's mark vocabulary is this table plus `link`, so no mark is parsed that
 * the reader cannot render, or vice versa.
 *
 * `stopAt` reproduces the old pattern's `[^*]+` / `[^~]+` classes: a lone
 * unescaped `*` inside `**…**` means "this is not a strong run".
 */
const DELIMITED_MARKS = [
  ['strong', '**', '*', INLINE],
  ['code', '`', null, CODE_SPAN],
  ['strike', '~~', '~', INLINE],
  ['em', '_', null, INLINE],
]
const MARK_TYPES = new Set(['link', ...DELIMITED_MARKS.map(([type]) => type)])

// -----------------------------------------------------------------------------
// Small ADF helpers
// -----------------------------------------------------------------------------

const isObject = value => value !== null && typeof value === 'object'
const hasOwn = (table, key) => typeof key === 'string' && Object.hasOwn(table, key)
const contentOf = node => (isObject(node) && Array.isArray(node.content) ? node.content : [])
const marksOf = node => (Array.isArray(node.marks) ? node.marks : [])
const textNode = (text, marks) => (marks ? { type: 'text', text, marks } : { type: 'text', text })
const HARD_BREAK = { type: 'hardBreak' }

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
// is visible and accepted: the raw textarea shows `foo\_bar\_baz`. Rendered
// Markdown is unaffected, since a backslash before ASCII punctuation is
// CommonMark and `marked` (the dashboard renderer) prints just the character.
//
// Escaping is UNCONDITIONAL, not "only where a construct would match": that
// version has to reason about how escaping one position changes the parse of
// every later one. Escaping every metacharacter makes the argument total:
// after the pass every metacharacter is the second half of a `\x` pair, the
// writer consumes both as one literal, and no construct can begin anywhere.
// Keep it that way.

const NODE_RENDERERS = {
  text: renderTextRun,
  hardBreak: () => '\n',
  paragraph: node => renderParagraph(node) + BLOCK_END,
  heading: node => `${'#'.repeat(headingLevel(node))} ${renderChildren(node)}${BLOCK_END}`,
  bulletList: node => renderList(node, () => '- '),
  // Always numbered from 1, whatever `attrs.order` says (see the gate's attrs rules).
  orderedList: node => renderList(node, index => `${index + 1}. `),
  codeBlock: node => `${FENCE}${codeLanguage(node)}\n${codeBody(node)}\n${FENCE}${BLOCK_END}`,
  blockquote: node => renderChildren(node).trim().split('\n').map(line => `> ${line}`).join('\n') + BLOCK_END,
  rule: () => `---${BLOCK_END}`,
  mention: node => node.attrs?.text || `@${node.attrs?.id ?? ''}`,
  emoji: node => node.attrs?.text || node.attrs?.shortName || '',
  inlineCard: node => node.attrs?.url ?? '',
  blockCard: node => (node.attrs?.url ?? '') + BLOCK_END,
}

function renderNode(node) {
  if (!isObject(node)) return ''
  return hasOwn(NODE_RENDERERS, node.type) ? NODE_RENDERERS[node.type](node) : renderChildren(node)
}

function renderChildren(node) {
  return contentOf(node).map(renderNode).join('')
}

function renderList(node, marker) {
  return contentOf(node).map((item, index) => marker(index) + renderNode(item).trim()).join('\n') + BLOCK_END
}

/**
 * A paragraph's inline Markdown, with any line that would open a block
 * neutralised. Applied per line, because the writer tests the quote, bullet
 * and ordered forms against EVERY line of a block.
 */
function renderParagraph(node) {
  return renderChildren(node).split('\n').map(escapeBlockLeader).join('\n')
}

/**
 * Neutralise a LEADING token the writer reads as a block marker. Inline
 * escaping cannot reach these: `#`, `>`, `-` and `.` are not inline markup,
 * they are only markup in first position. A fence needs no case here: the
 * inline pass has already escaped its backticks, so ```` ```js ```` leaves as
 * `` \`\`\`js `` and cannot open a block.
 */
function escapeBlockLeader(line) {
  if (HEADING_LEADER.test(line) || RULE.test(line) || QUOTE_LINE.test(line) || BULLET_LINE.test(line)) {
    return `\\${line}`
  }
  return ORDERED_LINE.test(line) ? line.replace(/^(\d+)\./, '$1\\.') : line
}

/** A text run, escaped for the context its marks put it in, then wrapped in each mark. */
function renderTextRun(node) {
  const marks = marksOf(node)
  const context = marks.some(mark => mark?.type === 'code') ? CODE_SPAN : INLINE
  let markdown = escape(context, String(node.text ?? ''))
  for (const mark of marks) {
    if (mark?.type === 'link') {
      markdown = `[${markdown}](${escape(HREF, String(mark.attrs?.href ?? ''))})`
      continue
    }
    const delimited = DELIMITED_MARKS.find(([type]) => type === mark?.type)
    if (delimited) markdown = delimited[1] + markdown + delimited[1]
  }
  return markdown
}

function headingLevel(node) {
  return Math.min(6, Math.max(1, Math.trunc(Number(node.attrs?.level)) || 1))
}

function codeLanguage(node) {
  const language = node.attrs?.language
  return typeof language === 'string' ? language : ''
}

/**
 * A code BLOCK's body, verbatim, minus trailing newlines. It sits between
 * fences and the writer reads it back with no inline pass, so escaping it
 * would corrupt exactly the content the fence exists to protect.
 */
function codeBody(node) {
  return contentOf(node).map(child => String(child?.text ?? '')).join('').replace(/\n+$/, '')
}

function renderBlocks(blocks) {
  return blocks.map(renderNode).join('')
}

/**
 * Convert an ADF document (Jira's rich-text wire shape) to Markdown.
 * @param {{type?: string, content?: Array}|null|undefined} doc
 * @returns {string}
 */
export function adfToMarkdown(doc) {
  return renderBlocks(contentOf(doc)).trim()
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
  if (typeof markdown !== 'string' || markdown.trim() === '') return { type: 'doc', version: 1, content: [] }
  const blocks = markdown.replace(/^\n+|\n+$/g, '').split(BLOCK_SEPARATOR)
  return { type: 'doc', version: 1, content: blocks.map(parseBlock) }
}

/** One blank-line-delimited Markdown block → one ADF block node. */
function parseBlock(block) {
  const lines = block.split('\n')

  // A fence is only recognised whole: an opening line and a closing ``` line.
  // An unclosed fence is ordinary text, never deleted.
  if (lines.length >= 2 && lines[0].startsWith(FENCE) && lines.at(-1).trimEnd() === FENCE) {
    const language = lines[0].slice(FENCE.length).trim()
    const body = lines.slice(1, -1).join('\n')
    return {
      type: 'codeBlock',
      ...(language && { attrs: { language } }),
      content: body ? [textNode(body)] : [],
    }
  }

  const heading = block.match(HEADING)
  if (heading) {
    // Bare inline pass: a heading has no line concept, so a `\n` stays text.
    return {
      type: 'heading',
      attrs: { level: heading[1].length },
      content: parseInline(block.slice(heading[0].length).trim()),
    }
  }

  if (RULE.test(block)) return { type: 'rule' }

  if (lines.every(line => QUOTE_LINE.test(line))) {
    const inner = lines.map(line => line.replace(QUOTE_LINE, '')).join('\n')
    return { type: 'blockquote', content: [{ type: 'paragraph', content: parseLines(inner) }] }
  }

  if (lines.every(line => BULLET_LINE.test(line))) return parseList('bulletList', lines, BULLET_LINE)
  if (lines.every(line => ORDERED_LINE.test(line))) return parseList('orderedList', lines, ORDERED_LINE)

  return { type: 'paragraph', content: parseLines(block) }
}

/** Each line is one item; its marker is stripped greedily, along with any leading whitespace. */
function parseList(type, lines, marker) {
  return {
    type,
    content: lines.map(line => ({
      type: 'listItem',
      content: [{ type: 'paragraph', content: parseInline(line.replace(marker, '')) }],
    })),
  }
}

/** A block's text, split on single `\n`s into `hardBreak`-joined inline runs. */
function parseLines(text) {
  return text.split('\n').flatMap((line, index) => (index === 0 ? parseInline(line) : [HARD_BREAK, ...parseInline(line)]))
}

/**
 * The inline pass: a left-to-right scan, not one regex, because honouring a
 * `\x` escape is not something a single alternation can express (`[^\]]*`
 * cannot be taught that `\]` is literal, which is the bug that lost the link
 * mark on `[a]b](http://x)`).
 *
 * Leftmost construct wins; at the same position the order is link, then
 * DELIMITED_MARKS' order, so a link whose text contains another marker is
 * captured whole. Contiguous literal text accumulates into a single node.
 *
 * An empty input still yields one empty run: that is what makes an empty list
 * item (a bare `- ` line in a multi-item list) rebuildable.
 */
function parseInline(text) {
  const nodes = []
  let literal = ''
  const flushLiteral = () => {
    if (literal) nodes.push(textNode(unescape(INLINE, literal)))
    literal = ''
  }

  for (let i = 0; i < text.length;) {
    if (text[i] === '\\' && ASCII_PUNCTUATION.test(text[i + 1] ?? '')) {
      literal += text.slice(i, i + 2)
      i += 2
      continue
    }
    const construct = constructAt(text, i)
    if (construct) {
      flushLiteral()
      nodes.push(construct.node)
      i = construct.end
    } else {
      literal += text[i]
      i += 1
    }
  }
  flushLiteral()
  return nodes.length > 0 ? nodes : [textNode('')]
}

/** The construct starting at `i`, as `{node, end}`, or null. */
function constructAt(text, i) {
  if (text[i] === '[') return linkAt(text, i)
  for (const [type, delimiter, stopAt, context] of DELIMITED_MARKS) {
    if (!text.startsWith(delimiter, i)) continue
    const start = i + delimiter.length
    const close = findUnescaped(text, start, delimiter, stopAt)
    // `close === start` is an empty run; those stay literal, so `**` and `____`
    // are plain text.
    if (close > start) {
      return { node: textNode(unescape(context, text.slice(start, close)), [{ type }]), end: close + delimiter.length }
    }
  }
  return null
}

/** `[text](href)`. Unlike the delimited marks, empty link text is allowed. */
function linkAt(text, i) {
  const textEnd = findUnescaped(text, i + 1, ']')
  if (textEnd < 0 || text[textEnd + 1] !== '(') return null
  const hrefEnd = findUnescaped(text, textEnd + 2, ')')
  if (hrefEnd < 0) return null
  const href = unescape(HREF, text.slice(textEnd + 2, hrefEnd))
  return {
    node: textNode(unescape(INLINE, text.slice(i + 1, textEnd)), [{ type: 'link', attrs: { href } }]),
    end: hrefEnd + 1,
  }
}

/**
 * Index of the next UNESCAPED `close` at or after `from`; -1 if there is none,
 * or if an unescaped `stopAt` character comes first.
 */
function findUnescaped(text, from, close, stopAt = null) {
  for (let j = from; j < text.length; j += 1) {
    if (text[j] === '\\') {
      j += 1
      continue
    }
    if (text.startsWith(close, j)) return j
    if (text[j] === stopAt) return -1
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
// `parseBlock` / `parseList` / `parseLines` / `parseInline`, never with
// NODE_RENDERERS.
//
// Every rule is pinned by a fixture in the ADF → Markdown → ADF property tests.

const BLOCK_TYPES = ['paragraph', 'heading', 'bulletList', 'orderedList', 'codeBlock', 'blockquote', 'rule']

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
 * - codeBlock: exactly one text run (its body is checked by SHAPE_RULES).
 */
const WRITER_CHILDREN = {
  doc: { types: BLOCK_TYPES },
  paragraph: { types: ['text', 'hardBreak'] },
  heading: { types: ['text'] },
  bulletList: { types: ['listItem'], min: 1 },
  orderedList: { types: ['listItem'], min: 1 },
  listItem: { types: ['paragraph'], min: 1, max: 1 },
  blockquote: { types: ['paragraph'], min: 1, max: 1 },
  codeBlock: { types: ['text'], min: 1, max: 1 },
  rule: { types: [] },
  hardBreak: { types: [] },
  text: { types: [] },
}

/**
 * The `attrs` each node type may carry, and the value the writer would have
 * to see to re-emit each (LIN-1886 review F1 sub-class (b)). A type not listed
 * must carry NO `attrs` at all: the writer emits none for it, so any stored
 * `attrs` object, even an empty one, cannot survive a write.
 */
const WRITER_ATTRS = {
  // The writer always stamps `{level}` from the `#` run length, so it is
  // required; the reader clamps anything outside 1-6 (the review's `{level: 7}`).
  heading: { level: level => Number.isInteger(level) && level >= 1 && level <= 6 },
  // Stamped ONLY when the fence carries a language, and read back through
  // `.trim()`, so a blank or space-padded language is lost.
  codeBlock: { language: language => typeof language === 'string' && language !== '' && language === language.trim() && !language.includes('\n') },
  // Exception 2 (John's ruling `d38d3755`): the writer emits an orderedList
  // with no attrs and the reader renumbers from 1, so dropping an identity
  // `{order: 1}` (or a bare `{}`) changes no rendered character. Only the
  // EXACT integer 1: `{order: 0}` or `{order: -3}` would renumber a visibly
  // 0-based list. A non-identity order is refused rather than modelled, "UNTIL
  // THE WRITER MODELS THE ATTRIBUTE"; modelling it would change what a
  // hand-typed `5. foo` means, and re-review `5ae61f22` measured that it would
  // only move the deep-equal gap onto the far commoner no-attrs list.
  orderedList: { order: order => order === 1 },
}

function attrsAreRebuildable(node) {
  if (node.attrs === undefined) return node.type !== 'heading'
  if (!isObject(node.attrs)) return false
  // Exception 3 (LIN-2019): `localId` is ignored before anything else. Jira's
  // editor stamps it on virtually every node, it renders as nothing, and it is
  // re-stamped on the next edit. Fail-closed: an allowlist of exactly one key.
  const { localId, ...attrs } = node.attrs
  const allowed = hasOwn(WRITER_ATTRS, node.type) ? WRITER_ATTRS[node.type] : {}
  const keys = Object.keys(attrs)
  if (!keys.every(key => hasOwn(allowed, key) && allowed[key](attrs[key]))) return false
  if (node.type === 'heading') return keys.includes('level')
  // An attrs object with nothing left in it survives only as an exception.
  return keys.length > 0 || 'localId' in node.attrs || node.type === 'orderedList'
}

const isPadded = markdown => markdown !== markdown.trim()

/**
 * Rules for a permitted type in a shape the writer never emits, beyond which
 * children it holds. Most compare against what the node RENDERS to, because
 * several containers `.trim()` their content on the way out or have it
 * trimmed on the way back in. `true` = the writer cannot rebuild this node.
 */
const SHAPE_RULES = {
  // Heading text is trimmed twice on the way back (HEADING's `\s+`, then
  // `.trim()`); an empty heading loses its `# ` and re-reads as a paragraph of
  // literal `#`; a blank line inside it splits the block.
  heading: node => {
    const markdown = renderChildren(node)
    return markdown === '' || isPadded(markdown) || BLOCK_SEPARATOR.test(markdown)
  },

  // The writer splits blocks on blank lines and strips the edges' newlines, so
  // a paragraph whose text carries a blank line is TORN IN TWO and an edge
  // newline is lost.
  //
  // An EMPTY paragraph is permitted anywhere. In a list item it is the
  // rebuildable `- ` line of a multi-item list. At top level it is exception 4
  // (LIN-2019): genuinely lossy, deliberately accepted. A leading empty
  // paragraph, or one alone, is still refused, by the document-edge rule.
  paragraph: node => {
    const markdown = renderChildren(node)
    return BLOCK_SEPARATOR.test(markdown) || markdown.startsWith('\n') || markdown.endsWith('\n')
  },

  // A list item broken across two lines no longer parses as a list (the writer
  // requires EVERY line of the block to carry the marker). The reader trims
  // each item and the writer's greedy marker regex eats leading whitespace, so
  // `"  padded  "` is destroyed in both directions (LIN-1886 review F1 (b)).
  listItem: node => {
    const markdown = renderParagraph(node.content[0])
    return markdown.includes('\n') || isPadded(markdown)
  },

  // The reader trims before prefixing each line with `> `.
  blockquote: node => isPadded(renderParagraph(node.content[0])),

  // The block split runs BEFORE the fence is seen, so a body containing a
  // blank line (or an empty body) is torn in two and the closing ``` leaks out
  // as text. The reader also strips trailing newlines off the body. So a fence
  // is rebuildable only as one unmarked, non-empty run with no blank line and
  // no edge newline.
  codeBlock: node => {
    const [run] = node.content
    const body = String(run.text ?? '')
    return marksOf(run).length > 0 || body === '' || BLOCK_SEPARATOR.test(body)
      || body.startsWith('\n') || body.endsWith('\n')
  },

  text: (node, parentType) => {
    if (typeof node.text !== 'string') return true
    const marks = marksOf(node)
    // Only ONE mark per run. The inline pass does not nest, so strong+em renders
    // `_**x**_` and re-parses as ONE em run whose text is literally `**x**`.
    if (marks.length > 1) return true
    const [mark] = marks
    if (mark && !MARK_TYPES.has(mark.type)) return true
    // An empty run cannot carry a mark home: `**`, `__`, `~~~~` stay literal.
    // A link is the exception: `[](href)` has always allowed empty text.
    if (mark && mark.type !== 'link' && node.text === '') return true
    // An href rides the line-bounded `](…)` slot; a newline would break the block.
    if (mark?.type === 'link' && (typeof mark.attrs?.href !== 'string' || mark.attrs.href.includes('\n'))) return true
    // The writer splits every `\n` into a hardBreak, so a run carrying one
    // re-reads as several runs. A heading is the exception: its bare inline
    // pass hands the newline straight back (its own rule still refuses a
    // blank line or an edge newline).
    return parentType !== 'heading' && node.text.includes('\n')
  },
}

/**
 * Two adjacent UNMARKED runs render as one stretch of text, and the writer
 * accumulates contiguous literal text into a single node, so the split is not
 * recoverable. Adjacent marked runs are fine: their delimiters re-split them.
 */
function hasAdjacentUnmarkedRuns(children) {
  const isUnmarkedRun = node => node?.type === 'text' && marksOf(node).length === 0
  return children.some((node, index) => index > 0 && isUnmarkedRun(node) && isUnmarkedRun(children[index - 1]))
}

function isUnrebuildable(node, parentType) {
  if (!isObject(node) || !WRITER_CHILDREN[parentType].types.includes(node.type)) return true
  if (!attrsAreRebuildable(node)) return true

  const children = contentOf(node)
  const { min = 0, max = Infinity } = WRITER_CHILDREN[node.type]
  if (children.length < min || children.length > max) return true
  if (SHAPE_RULES[node.type]?.(node, parentType)) return true

  // A code block's body is the one place a `\n`-bearing run IS rebuildable, and
  // its shape rule has already validated it in full: do not recurse into it.
  if (node.type === 'codeBlock') return false

  return hasAdjacentUnmarkedRuns(children) || children.some(child => isUnrebuildable(child, node.type))
}

/**
 * The document's OWN edges. `adfToMarkdown` finishes with a `.trim()`, which
 * no per-node rule can see: every node can be rebuildable and the first
 * block's leading space still be eaten. The trailing side ignores the
 * block-separating newlines every renderer emits (structure, not content) and
 * asks only about what precedes them. That asymmetry is why a leading empty
 * paragraph, or one alone, is refused while a trailing one is permitted.
 */
function docEdgesAreLost(blocks) {
  const raw = renderBlocks(blocks)
  const body = raw.replace(/\n+$/, '')
  return raw !== raw.trimStart() || body !== body.trimEnd()
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
 * or an escape, add it to the corpus too.
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
  const blocks = contentOf(doc)
  return blocks.some(block => isUnrebuildable(block, 'doc')) || docEdgesAreLost(blocks)
}
