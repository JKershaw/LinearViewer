// =============================================================================
// Jira ADF (Atlassian Document Format) <-> Markdown codec (LIN-2399). Pure
// functions, no imports, throws nothing. Reached only by
// lib/providers/jira/index.js, through the three exports:
//
//   adfToMarkdown(doc)              the READER: stored ADF -> editable Markdown
//   markdownToAdf(markdown)         the WRITER: edited Markdown -> ADF
//   adfHasUnrenderableContent(doc)  the WRITE GATE: would a read-then-write of
//                                   this stored ADF lose anything? (LIN-1886 D1)
//
// The three are halves of one round trip: an in-app description edit renders
// the stored ADF, hands the Markdown to a human, and writes back whatever
// returns. The reader escapes so the writer cannot misread prose as markup; the
// gate refuses what the writer cannot rebuild. All three share the syntax tables
// directly below, so they cannot drift apart.
// =============================================================================

// -----------------------------------------------------------------------------
// The shared Markdown dialect.
// -----------------------------------------------------------------------------

/**
 * What `markdownToAdf` splits a document into blocks on: TWO LITERAL NEWLINES,
 * nothing else. The gate tests the same pattern against a rendered body, so the
 * two cannot drift: a rule that refused a "blank" line the split does not
 * break on (`"\n \n"`, trailing whitespace on an otherwise blank line, common
 * in pasted code) would refuse content that round-trips perfectly. Share the
 * constant; do not re-type the regex at a use site.
 */
const BLOCK_SPLIT = /\n{2,}/

// Block forms. HEADING and RULE are matched against the whole block; the
// list/quote forms must match EVERY line of the block.
const HEADING = /^(#{1,6})\s+/
const RULE = /^-{3,}$/
const QUOTE_LINE = /^>\s/
const BULLET_LINE = /^-\s+/
const ORDERED_LINE = /^\d+\.\s+/
const FENCE = '```'

/**
 * The delimited inline marks, in scan order: `[delimiter, markType,
 * forbidden-inside, which escape set applies to the content]`. A `link`
 * (`[text](href)`) is the fifth mark and is scanned BEFORE all of these, so a
 * link whose text contains another marker character is captured whole.
 * `forbidden-inside` reproduces the original pattern's `[^*]+` / `[^~]+`
 * classes: a lone unescaped `*` inside `**…**` means "this is not a strong run".
 * This table is the whole inline vocabulary: the reader renders it, the writer
 * parses it, and the gate permits exactly these marks plus `link`.
 */
const DELIMITED_MARKS = [
  ['**', 'strong', '*', 'inline'],
  ['`', 'code', '`', 'code'],
  ['~~', 'strike', '~', 'inline'],
  ['_', 'em', '_', 'inline'],
]
const DELIMITER_OF = Object.fromEntries(DELIMITED_MARKS.map(([delim, type]) => [type, delim]))

// -----------------------------------------------------------------------------
// Escaping (LIN-1886 review F1, John's Option A).
//
// Any character sequence the WRITER reads as markup has to leave the reader
// neutralised, or ordinary Jira prose is silently reinterpreted on save:
// `foo_bar_baz` growing an `em` mark, a paragraph beginning `- ` becoming a
// real `bulletList`, a paragraph reading ```` ```js ```` having its text deleted.
// Refusing such prose was explicitly rejected (it would 422 nearly every
// technical description); escaping it is the decision. The visible, accepted
// cost: the raw textarea shows `foo\_bar\_baz`. Rendered Markdown is unaffected:
// a backslash before ASCII punctuation is CommonMark, so `marked` (the
// dashboard renderer) prints the character, not the backslash.
//
// Escaping is UNCONDITIONAL, not "only where a construct would match": every
// metacharacter becomes the second half of a `\x` pair, the scanner consumes the
// pair as one literal, and so no construct can begin anywhere. That argument is
// trivial and total; the conditional version is not. Keep it that way.
//
// Each escape set has a matching unescape set. A code span and an href are
// escaped with a narrower set, so they are unescaped with that same narrower
// set, or the writer would eat backslashes the reader never put there.
// -----------------------------------------------------------------------------

const ESCAPES = {
  // Every character that opens an inline construct, `]` (which closes link
  // text: `[a]b](http://x)` otherwise loses its link mark), and the escape.
  inline: { escape: /[\\`*_~[\]]/g, unescape: /\\([!-/:-@[-`{-~])/g },
  // Inside a code span only the fence character and the escape can end the run;
  // escaping `_`/`*` there would be pure noise in the textarea.
  code: { escape: /[\\`]/g, unescape: /\\([\\`])/g },
  // Inside an href only an unescaped `)` ends it (the `(`-truncation bug).
  href: { escape: /[\\)]/g, unescape: /\\([\\)])/g },
}
// The inline unescape is CommonMark's rule: a backslash escapes ASCII
// punctuation and nothing else, so a hand-typed `C:\Users\me` or a regex `\d`
// survives a write intact.

const escapeAs = (set, text) => text.replace(ESCAPES[set].escape, '\\$&')
const unescapeAs = (set, text) => text.replace(ESCAPES[set].unescape, '$1')

/**
 * Neutralise a LEADING token the writer would read as a block marker. Inline
 * escaping cannot reach these: `#`, `>`, `-` and `.` are only markup in first
 * position. Applied to every line of a rendered paragraph, because the quote
 * and list forms are tested against every line. A fence needs no case here:
 * the inline pass already escaped its backticks.
 */
function escapeBlockLeader(line) {
  // `(\s|$)`, not `\s`: HEADING is matched against the whole block, and its
  // `\s+` happily consumes the `\n` a hardBreak rendered, so `"#\nrest"` would
  // read back as a heading and the `#` line would be gone (re-review R2).
  if (/^#{1,6}(\s|$)/.test(line) || QUOTE_LINE.test(line) || BULLET_LINE.test(line) || RULE.test(line)) {
    return `\\${line}`
  }
  if (ORDERED_LINE.test(line)) return line.replace('.', '\\.')
  return line
}

// -----------------------------------------------------------------------------
// Small ADF helpers.
// -----------------------------------------------------------------------------

const isObject = value => typeof value === 'object' && value !== null
const childrenOf = node => (Array.isArray(node.content) ? node.content : [])
const marksOf = node => (Array.isArray(node.marks) ? node.marks : [])
const textOf = node => (typeof node.text === 'string' ? node.text : '')
const textNode = (text, marks) => (marks ? { type: 'text', text, marks } : { type: 'text', text })
const paragraphNode = content => ({ type: 'paragraph', content })

// =============================================================================
// ADF -> Markdown (the reader).
//
// A deliberately MINIMAL renderer covering the node/mark types real Jira
// content uses, not a full ADF implementation. An unknown node type falls
// through to its children, so it degrades to its text rather than vanishing.
// Every block emits its own trailing `\n\n`; the document is trimmed once at
// the end.
// =============================================================================

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
    case 'text': return renderText(node)
    case 'hardBreak': return '\n'
    case 'paragraph': return `${renderChildren(node).split('\n').map(escapeBlockLeader).join('\n')}\n\n`
    case 'heading': return `${'#'.repeat(clampHeadingLevel(attrs.level))} ${renderChildren(node)}\n\n`
    case 'bulletList': return renderList(node, () => '- ')
    case 'orderedList': return renderList(node, index => `${index + 1}. `) // always from 1
    case 'codeBlock': return renderCodeBlock(node, attrs)
    case 'blockquote': return `${renderChildren(node).trim().split('\n').map(line => `> ${line}`).join('\n')}\n\n`
    case 'rule': return '---\n\n'
    // Read-only vocabulary: rendered for display, but the writer has no
    // inverse, so the gate refuses a write over any of these.
    case 'mention': return attrs.text || (attrs.id ? `@${attrs.id}` : '')
    case 'emoji': return attrs.text || attrs.shortName || ''
    case 'inlineCard': return attrs.url || ''
    case 'blockCard': return `${attrs.url || ''}\n\n`
    default: return renderChildren(node)
  }
}

/**
 * A text run, escaped for the context its marks put it in. A `code` run is
 * re-read as one opaque span, so only the backtick and the escape need
 * neutralising there; everything else takes the full inline set. Marks wrap in
 * array order, so `[strong, em]` renders `_**x**_`.
 */
function renderText(node) {
  const marks = marksOf(node).filter(isObject)
  const escapeSet = marks.some(mark => mark.type === 'code') ? 'code' : 'inline'
  return marks.reduce(wrapInMark, escapeAs(escapeSet, textOf(node)))
}

function wrapInMark(inner, mark) {
  if (mark.type === 'link') return `[${inner}](${escapeAs('href', String(mark.attrs?.href ?? ''))})`
  const delimiter = DELIMITER_OF[mark.type] ?? ''
  return delimiter + inner + delimiter
}

function clampHeadingLevel(level) {
  return Math.min(6, Math.max(1, Math.trunc(Number(level)) || 1))
}

function renderList(node, marker) {
  const lines = childrenOf(node).map((item, index) => marker(index) + renderNode(item).trim())
  return `${lines.join('\n')}\n\n`
}

/**
 * A code BLOCK's body is emitted verbatim (minus trailing newlines). The writer
 * reads it back with no inline pass at all, so escaping it would corrupt exactly
 * the content the fence exists to protect.
 */
function renderCodeBlock(node, attrs) {
  const language = typeof attrs.language === 'string' ? attrs.language : ''
  const body = childrenOf(node).map(child => (isObject(child) ? textOf(child) : '')).join('').replace(/\n+$/, '')
  return `${FENCE}${language}\n${body}\n${FENCE}\n\n`
}

// =============================================================================
// Markdown -> ADF (the writer; LIN-1886 Phase 2).
//
// Its vocabulary is a STRICT SUBSET of the reader's: paragraphs, headings,
// bullet/ordered lists, code blocks, blockquotes, rules, hard breaks, and the
// strong/em/code/strike/link marks. It has no inverse for mention, emoji,
// inlineCard or blockCard. That asymmetry is why the write gate is derived from
// THIS side (LIN-1886 review Blocker 3).
//
// The correspondence is pinned by the ADF -> Markdown -> ADF property test, over
// hand-written fixtures AND a generated cross-product of an adversarial text
// corpus against every structural slot (LIN-1886 review F2). That is evidence
// over a corpus, not a proof over all ADF: when you add a node type, a mark or
// an escape, add it to the corpus too.
//
// Anything else in the input degrades to plain text; this never throws.
// =============================================================================

/**
 * Convert Markdown to an ADF document, the write-direction inverse of
 * `adfToMarkdown`. Unrecognised constructs degrade to a plain paragraph of text.
 * Refusing unrenderable content is `adfHasUnrenderableContent`'s job, applied
 * to the EXISTING stored ADF a write is about to overwrite, not to freshly
 * authored Markdown on its way in.
 * @param {string|null|undefined} markdown
 * @returns {{type: 'doc', version: 1, content: Array}}
 */
export function markdownToAdf(markdown) {
  const source = (typeof markdown === 'string' ? markdown : '').replace(/^\n+|\n+$/g, '')
  const content = source.trim() === '' ? [] : source.split(BLOCK_SPLIT).map(parseBlock)
  return { type: 'doc', version: 1, content }
}

/** One blank-line-delimited Markdown block -> one ADF block node. */
function parseBlock(block) {
  if (block.startsWith(FENCE)) return parseFence(block)

  // Heading text is trimmed twice: HEADING's `\s+` eats the leading run, then
  // `.trim()`. It goes through bare `parseInline`, which has no line concept.
  const heading = block.match(HEADING)
  if (heading) {
    return {
      type: 'heading',
      attrs: { level: heading[1].length },
      content: parseInline(block.slice(heading[0].length).trim()),
    }
  }

  if (RULE.test(block)) return { type: 'rule' }

  const lines = block.split('\n')
  if (lines.every(line => QUOTE_LINE.test(line))) {
    // Always exactly one paragraph child; its lines become hardBreaks.
    const inner = lines.map(line => line.replace(QUOTE_LINE, '')).join('\n')
    return { type: 'blockquote', content: [paragraphNode(parseLines(inner))] }
  }
  if (lines.every(line => BULLET_LINE.test(line))) return parseList('bulletList', lines, BULLET_LINE)
  // Emitted with NO attrs: the source numbering is not modelled.
  if (lines.every(line => ORDERED_LINE.test(line))) return parseList('orderedList', lines, ORDERED_LINE)

  return paragraphNode(parseLines(block))
}

/**
 * Each item is `{listItem, content: [one paragraph]}`, its text through bare
 * `parseInline`. The marker regexes are greedy, so they eat any leading
 * whitespace of the item along with the marker.
 */
function parseList(type, lines, marker) {
  return {
    type,
    content: lines.map(line => ({ type: 'listItem', content: [paragraphNode(parseInline(line.replace(marker, '')))] })),
  }
}

/**
 * The opening line carries the language (trimmed; stamped only when present).
 * A closing fence is optional: an unclosed fence runs to the end of its block.
 * The body is read back verbatim.
 */
function parseFence(block) {
  const [opener, ...body] = block.split('\n')
  if (body.length > 0 && body[body.length - 1].trim() === FENCE) body.pop()
  const language = opener.slice(FENCE.length).trim()
  const code = body.join('\n')
  return {
    type: 'codeBlock',
    ...(language ? { attrs: { language } } : {}),
    content: code ? [textNode(code)] : [],
  }
}

/** A block's text, split on single `\n`s into `hardBreak`-joined inline runs. */
function parseLines(text) {
  return text.split('\n').flatMap((line, index) => (
    index === 0 ? parseInline(line) : [{ type: 'hardBreak' }, ...parseInline(line)]
  ))
}

/**
 * The inline pass: a hand-rolled left-to-right scan, not one regex, because
 * honouring `\x` escapes is not something a single non-backtracking alternation
 * can express (`[^\]]*` cannot be taught that `\]` is literal: the bug that lost
 * the link mark on `[a]b](http://x)`). The leftmost construct wins; at one
 * position, link is tried before the DELIMITED_MARKS, in their order.
 * Contiguous literal text accumulates into a single text node.
 */
function parseInline(text) {
  const nodes = []
  let literal = ''
  const flushLiteral = () => {
    if (literal) nodes.push(textNode(unescapeAs('inline', literal)))
    literal = ''
  }

  let i = 0
  while (i < text.length) {
    const construct = text[i] === '\\' ? null : constructAt(text, i)
    if (construct) {
      flushLiteral()
      nodes.push(construct.node)
      i = construct.end
    } else {
      // An escape pair is carried whole, so its second half can open nothing.
      const width = text[i] === '\\' ? 2 : 1
      literal += text.slice(i, i + width)
      i += width
    }
  }
  flushLiteral()
  return nodes
}

/** The construct starting at `i`, as `{node, end}`, or null. */
function constructAt(text, i) {
  if (text[i] === '[') return linkAt(text, i)
  for (const [delimiter, type, forbidden, escapeSet] of DELIMITED_MARKS) {
    if (!text.startsWith(delimiter, i)) continue
    const start = i + delimiter.length
    const close = findUnescaped(text, delimiter, start, forbidden)
    // `close === start` is an empty run; the original pattern's `+`
    // quantifiers rejected those, so `**` and `____` stay literal.
    if (close <= start) return null
    return {
      node: textNode(unescapeAs(escapeSet, text.slice(start, close)), [{ type }]),
      end: close + delimiter.length,
    }
  }
  return null
}

/** `[text](href)`. Empty link text and an empty href are both allowed. */
function linkAt(text, i) {
  const textEnd = findUnescaped(text, ']', i + 1)
  if (textEnd < 0 || text[textEnd + 1] !== '(') return null
  const hrefEnd = findUnescaped(text, ')', textEnd + 2)
  if (hrefEnd < 0) return null
  const href = unescapeAs('href', text.slice(textEnd + 2, hrefEnd))
  return {
    node: textNode(unescapeAs('inline', text.slice(i + 1, textEnd)), [{ type: 'link', attrs: { href } }]),
    end: hrefEnd + 1,
  }
}

/**
 * Index of the next UNESCAPED `close` at or after `from`; -1 if there is none,
 * or if an unescaped `forbidden` character is reached first.
 */
function findUnescaped(text, close, from, forbidden) {
  for (let j = from; j < text.length; j += 1) {
    if (text[j] === '\\') {
      j += 1
    } else if (text.startsWith(close, j)) {
      return j
    } else if (text[j] === forbidden) {
      return -1
    }
  }
  return -1
}

// =============================================================================
// The write gate (LIN-1886, D1 policy): a pure recursive walk over stored ADF.
//
// DERIVED FROM THE WRITER, NOT THE READER (LIN-1886 review Blocker 3). A write
// is read-then-rewrite, so the question is "can markdownToAdf rebuild this from
// adfToMarkdown's output?", not "can the reader render it?". `mention`,
// `emoji`, `inlineCard` and `blockCard` render fine but have no inverse, and
// gating on the reader's vocabulary let a 200-OK write flatten an @-mention,
// smart link or emoji into one anonymous text run. Keep these tables in
// lockstep with the writer above, never with the reader's switch.
// =============================================================================

/** Every node type the writer can EMIT. */
const WRITER_NODE_TYPES = new Set([
  'paragraph', 'heading', 'bulletList', 'orderedList', 'listItem',
  'codeBlock', 'blockquote', 'rule', 'hardBreak', 'text',
])

/** Every mark the writer can parse back. */
const WRITER_MARK_TYPES = new Set(['link', ...DELIMITED_MARKS.map(([, type]) => type)])

const hasOnlyKey = (attrs, key) => isObject(attrs) && Object.keys(attrs).length === 1 && key in attrs

/**
 * The `attrs` each node type may carry, given what `markdownToAdf` re-emits
 * (LIN-1886 review F1 sub-class (b)). `attrs` is `undefined` when absent. A
 * type not listed must carry NO attrs at all: the writer emits none for it, so
 * any stored `attrs` object, even an empty one, cannot survive a write.
 */
const ATTRS_REBUILDABLE = {
  // The writer always stamps `{level}`, from the `#` run length; the reader
  // clamps into 1-6, so `{level: 7}` would come back as 6.
  heading: attrs => hasOnlyKey(attrs, 'level') && Number.isInteger(attrs.level) && attrs.level >= 1 && attrs.level <= 6,

  // The writer emits an orderedList with NO attrs and the reader renumbers from
  // 1, so only the EXACT identity `{order: 1}` (or a bare `{}`) can be dropped
  // without changing a rendered character: permitted per John's ruling
  // `d38d3755` ("the identity value is harmless"), and the one place this gate
  // trades strict deep-equality for content fidelity (exception 2 below).
  // Anything else is a real renumber or a real loss and is refused: `{order: 5}`
  // silently renumbers 5,6 -> 1,2 (the review's counterexample); `{order: 0}`
  // or `{order: -3}` would turn a visibly 0-based list 1-based; a string `"1"`
  // or any extra key cannot be re-emitted. Refusing rather than modelling
  // `order` stands, per the earlier human decision ("refuse … UNTIL THE WRITER
  // MODELS THE ATTRIBUTE"): modelling it changes what hand-authored `5. foo`
  // means, and (re-review `5ae61f22`, since measured) stamping `{order: 1}` on
  // every emitted list would only move the deep-equal gap onto the far commoner
  // list that stores no attrs.
  orderedList: attrs => attrs === undefined
    || (isObject(attrs) && Object.keys(attrs).length === 0)
    || (hasOnlyKey(attrs, 'order') && attrs.order === 1),

  // The writer stamps `{language}` ONLY when the fence carries one, and reads it
  // back through `.trim()`, so a blank or space-padded language is lost.
  codeBlock: attrs => attrs === undefined
    || (hasOnlyKey(attrs, 'language') && typeof attrs.language === 'string'
      && attrs.language !== '' && attrs.language === attrs.language.trim()),
}
const NO_ATTRS = attrs => attrs === undefined

/**
 * `localId` is ignored before any attrs rule runs (LIN-2019, exception 3):
 * Jira's editor stamps it on virtually every node, it renders as nothing, and
 * it is re-stamped on the next edit whatever Harbour stores. Fail-closed by
 * construction: an allowlist of exactly one key, so any OTHER key still
 * refuses, and attrs holding only `localId` count as absent.
 */
function attrsRebuildable(node) {
  let attrs = node.attrs
  if (isObject(attrs) && 'localId' in attrs) {
    const { localId, ...rest } = attrs
    attrs = Object.keys(rest).length > 0 ? rest : undefined
  }
  return (ATTRS_REBUILDABLE[node.type] ?? NO_ATTRS)(attrs)
}

const hasHardBreak = node => childrenOf(node).some(child => child?.type === 'hardBreak')
const hasEdgeNewline = text => /^\n|\n$/.test(text)

/** The container's content if it is exactly one paragraph, else null. */
function soleParagraph(node) {
  const content = childrenOf(node)
  return content.length === 1 && content[0]?.type === 'paragraph' ? content[0] : null
}

/**
 * Whether a list item's or blockquote's paragraph text is lost in the round
 * trip. The reader `.trim()`s the container's rendered content on the way out
 * (and the list-marker regexes eat leading whitespace on the way in), so edge
 * whitespace in the stored text is destroyed (LIN-1886 review F1 sub-class
 * (b): `"  padded  "`). An item or quote line that renders to nothing is
 * rebuilt as a paragraph with NO content, so it survives only if it held none.
 */
function containerParagraphLost(paragraph) {
  const markdown = renderChildren(paragraph)
  if (markdown === '') return childrenOf(paragraph).length > 0
  return markdown !== markdown.trim()
}

/**
 * The STRUCTURAL half of the derivation (LIN-1886 review Blocker 3). The writer
 * builds each container in exactly one fixed shape, so a permitted type in any
 * other shape is just as unrebuildable as an unmodelled type. `true` = the
 * writer cannot rebuild this node. Each rule is pinned by a fixture in the
 * ADF -> Markdown -> ADF property test.
 */
const SHAPE_UNREBUILDABLE = {
  // The writer splits blocks on BLOCK_SPLIT, so a paragraph whose text carries
  // a blank line is TORN IN TWO, and the split's own edge-newline strip eats a
  // leading or trailing newline. A paragraph that renders to nothing is dropped
  // on write but PERMITTED regardless of position: inside a list item it is the
  // rebuildable `- ` line of a multi-item list; at top level it is the
  // deliberately accepted, genuinely lossy exception 4 (LIN-2019). A LEADING
  // top-level empty paragraph is still refused, by the document-edge rule.
  paragraph: node => {
    const markdown = renderChildren(node)
    return markdown !== '' && (BLOCK_SPLIT.test(markdown) || hasEdgeNewline(markdown))
  },

  // Heading content goes through bare `parseInline`, which has no line concept,
  // so a hardBreak comes back as a literal newline. Its text is trimmed twice on
  // the way back; an empty heading loses its `# ` and re-reads as a paragraph of
  // literal `#`; a blank line inside splits the block, taking the `# ` with it.
  heading: node => {
    const markdown = renderChildren(node)
    return hasHardBreak(node) || markdown === '' || markdown !== markdown.trim() || BLOCK_SPLIT.test(markdown)
  },

  // Always exactly one paragraph child. Two paragraphs collapse into one
  // hardBreak-joined paragraph; a codeBlock or heading child loses its type.
  blockquote: node => {
    const paragraph = soleParagraph(node)
    return !paragraph || containerParagraphLost(paragraph)
  },

  // Always exactly one paragraph child, which also makes NESTED LISTS
  // unrebuildable at any depth (a nested list is a second child of its parent
  // item; the writer would re-emit it as flat siblings). A hardBreak inside
  // the item breaks its `- ` line in two, and the writer requires EVERY line of
  // a list block to carry the marker, so the whole list degrades to a paragraph.
  listItem: node => {
    const paragraph = soleParagraph(node)
    return !paragraph || hasHardBreak(paragraph) || containerParagraphLost(paragraph)
  },

  // The writer splits blocks BEFORE it ever sees a fence, so a body containing a
  // blank line (or an empty one) is torn in two and the closing fence leaks out
  // as paragraph text; the reader strips trailing newlines off the body. So a
  // fence is rebuildable only as a single plain text run, non-empty, with no
  // blank line and no leading/trailing newline. This validates that child in
  // full, so the walk does not descend into it.
  codeBlock: node => {
    const content = childrenOf(node)
    if (content.length !== 1) return true
    const [child] = content
    if (!isObject(child) || child.type !== 'text' || marksOf(child).length > 0 || !attrsRebuildable(child)) return true
    const body = child.text
    return typeof body !== 'string' || body === '' || BLOCK_SPLIT.test(body) || hasEdgeNewline(body)
  },
}

/**
 * A text run the writer cannot rebuild. `parentType` matters for newlines: the
 * writer turns every `\n` into a hardBreak, except in a heading, whose content
 * goes through bare `parseInline` and hands the newline straight back (the
 * heading's own rule still refuses a blank line or an edge newline).
 */
function textUnrebuildable(node, parentType) {
  const marks = marksOf(node)
  // ONE mark per run: the inline pass does not nest, so strong+em renders
  // `_**x**_` and re-parses as ONE em run whose text is literally `**x**`.
  if (marks.length > 1) return true
  const [mark] = marks
  if (mark !== undefined && !WRITER_MARK_TYPES.has(mark?.type)) return true
  const text = textOf(node)
  // An empty marked run cannot carry its mark home (`**`, `__`, `~~~~` re-read
  // as literal text); `[](href)` has always allowed empty link text.
  if (mark && text === '' && mark.type !== 'link') return true
  // An href rides the line-bounded `](…)` slot; a newline would break it.
  if (mark?.type === 'link' && String(mark.attrs?.href ?? '').includes('\n')) return true
  return text.includes('\n') && parentType !== 'heading'
}

const isUnmarkedText = node => node?.type === 'text' && marksOf(node).length === 0

/**
 * A content list the writer cannot rebuild. Two adjacent UNMARKED runs render
 * as one stretch of text and the writer accumulates contiguous literal text into
 * a single node, so their split is unrecoverable. (Adjacent MARKED runs are
 * fine: their delimiters survive and re-split them.)
 */
function contentUnrebuildable(content, parentType) {
  const adjacentUnmarked = content.some((node, i) => i > 0 && isUnmarkedText(node) && isUnmarkedText(content[i - 1]))
  return adjacentUnmarked || content.some(child => nodeUnrebuildable(child, parentType))
}

function nodeUnrebuildable(node, parentType) {
  if (!isObject(node) || !WRITER_NODE_TYPES.has(node.type)) return true
  if (!attrsRebuildable(node)) return true
  if (SHAPE_UNREBUILDABLE[node.type]?.(node)) return true
  if (node.type === 'text') return textUnrebuildable(node, parentType)
  // A code block's body is the one place a `\n`-bearing run IS rebuildable; its
  // shape rule already validated that single child in full.
  if (node.type === 'codeBlock') return false
  return contentUnrebuildable(childrenOf(node), node.type)
}

/**
 * The document's OWN edges. `adfToMarkdown` finishes with a `.trim()`, which no
 * per-node rule can see: every node can be individually rebuildable and the
 * first block's leading space still be eaten. The trailing side ignores the
 * block-separating newlines every block emits (structure, not content) and
 * asks only about what precedes them, so it has no equivalent of the leading
 * side's refusal of an empty first paragraph.
 */
function documentEdgesLost(raw) {
  const body = raw.replace(/\n+$/, '')
  return raw !== raw.trimStart() || body !== body.trimEnd()
}

/**
 * True if `doc` contains anything `markdownToAdf` cannot reconstruct from
 * `adfToMarkdown(doc)`. Used to refuse (422) an in-app description overwrite
 * that would silently destroy Jira-native content; never used to reject a READ.
 * The invariant it buys:
 *
 *     adfHasUnrenderableContent(doc) === false
 *       ⟹  markdownToAdf(adfToMarkdown(doc)) deep-equals doc,
 *           EXCEPT for the four enumerated classes below
 *
 * asserted in both directions over the fixture list and the generated
 * adversarial corpus in the codec's unit test. That is evidence over a corpus,
 * not a proof over all ADF. The exceptions are ENUMERATED, not papered over: an
 * overclaiming invariant once let a real defect sit through three review
 * cycles, so this is the weakest claim the evidence supports and no weaker
 * (LIN-1886, John's ruling `d38d3755`). Exceptions 1-3 change no rendered
 * character; exception 4 drops a blank line, a deliberate trade. All four are
 * pinned by fixtures, so widening any of them fails a test.
 *
 *   1. An empty, unmarked text run (LIN-1939; pre-existing, deliberately not
 *      fixed here). `{type: 'text', text: ''}` with no marks slips both text
 *      guards (the empty-run rule needs a mark; the adjacency rule needs BOTH
 *      neighbours unmarked), e.g. `[text(''), text('x', em)]` renders `_x_` and
 *      re-reads WITHOUT the empty run. See LIN-1939 before relying on the
 *      invariant for a mark-adjacency case.
 *   2. An orderedList's identity attrs, `{order: 1}` or a bare `{}`: the writer
 *      emits no `attrs` key, so it is ABSENT after the round trip. The reader
 *      renumbers from 1 regardless, so the rendered Markdown is identical. A
 *      non-identity `order` is still refused.
 *   3. A `localId` attrs key on any node (LIN-2019): stripped before the attrs
 *      check, so it is absent after the round trip. Only this one key is
 *      allowlisted, and shape/type checks are untouched by it.
 *   4. A top-level empty paragraph (LIN-2019), GENUINELY LOSSY: permitted
 *      mid-document (`[p("one"), p(""), p("two")]` renders `"one\n\n\n\ntwo"`
 *      and reads back as `"one\n\ntwo"`) and trailing (`[p("one"), p("")]`),
 *      with the blank line dropped. A LEADING one (`[p(""), p("one")]`) or one
 *      alone (`[p("")]`) is still refused, by the document-edge rule. The
 *      trade is deliberate: refusing every description Jira's own editor left
 *      a blank line in is worse than dropping a blank line nobody will notice.
 *
 * Everything else this gate permits deep-equals in the strict sense.
 *
 * Checked recursively through the WHOLE tree, five things trip it:
 *   - a node type outside WRITER_NODE_TYPES;
 *   - a permitted type in a shape the writer never emits (SHAPE_UNREBUILDABLE);
 *   - attrs the writer cannot re-emit (ATTRS_REBUILDABLE);
 *   - whitespace a `.trim()` destroys, at a list item, a blockquote, a heading
 *     or the document's own edges;
 *   - a text run with a mark outside WRITER_MARK_TYPES, more than one mark, or
 *     a newline outside a fence or heading.
 *
 * NOT on this list, deliberately (LIN-1886 review F1, human decision
 * `599551c2`): Markdown-syntax collisions in ordinary prose. `- not a list`,
 * `foo_bar_baz` or ```` ```js ```` round-trip faithfully because the reader
 * escapes them; refusing prose was rejected as a remedy.
 *
 * Like `adfToMarkdown`, only `doc.content` is inspected, never the wrapper's
 * own `type`, so a bare `{content: [...]}` is gated like a real `doc`.
 * @param {object|null|undefined} doc - an ADF document (or any ADF node)
 * @returns {boolean}
 */
export function adfHasUnrenderableContent(doc) {
  if (!isObject(doc)) return false
  return contentUnrebuildable(childrenOf(doc), 'doc') || documentEdgesLost(renderChildren(doc))
}
