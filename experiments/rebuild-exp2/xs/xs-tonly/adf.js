/**
 * Jira ADF (Atlassian Document Format) <-> Markdown codec.
 *
 * - `adfToMarkdown(doc)`  reads Jira content for display.
 * - `markdownToAdf(md)`   is the writer: a deliberately small Markdown dialect.
 * - `adfHasUnrenderableContent(doc)` is the write gate: true when writing the
 *   doc back through `markdownToAdf(adfToMarkdown(doc))` would change it.
 *
 * The writer's dialect, which the reader escapes against:
 *
 *   Blocks are separated by blank lines (/\n{2,}/), and each block is ONE of:
 *     ```lang\nbody\n```   codeBlock (body verbatim, never escaped)
 *     # text .. ###### text  heading (single line)
 *     ---                    rule (the whole block)
 *     - text                 bulletList (every line), item text trimmed
 *     1. text                orderedList (every line), item text trimmed
 *     > text                 blockquote (every line) holding ONE paragraph
 *     anything else          paragraph; each newline is a hardBreak
 *
 *   Inline, within one line, with no nesting (one mark per run):
 *     **strong**  _em_  `code`  ~~strike~~  [text](href)
 *   and a backslash before any ASCII punctuation is that literal character.
 *
 * Because the reader backslash-escapes every character that could start one of
 * these constructs, ordinary prose such as `foo_bar_baz` or `- not a list`
 * survives a write unchanged instead of being reinterpreted as markup.
 */

const isObject = (value) => typeof value === 'object' && value !== null
const list = (value) => (Array.isArray(value) ? value : [])

// =============================================================================
// ADF -> Markdown
// =============================================================================

/** Inline node types: an unknown container holding any of these joins its children without blank lines. */
const INLINE_TYPES = new Set(['text', 'hardBreak', 'mention', 'emoji', 'inlineCard'])

export function adfToMarkdown(doc) {
  if (!isObject(doc)) return ''
  // Whitespace at the document's edges is not content: Markdown cannot express
  // it, and `markdownToAdf` trims it too. This is also what lets a trailing
  // empty paragraph render identically to no paragraph at all.
  return renderNode(doc).trim()
}

const renderBlocks = (nodes) => list(nodes).map(renderNode).join('\n\n')
const renderInline = (nodes) => list(nodes).map(renderNode).join('')

function renderNode(node) {
  if (!isObject(node)) return ''
  const attrs = isObject(node.attrs) ? node.attrs : {}
  switch (node.type) {
    case 'doc':
      return renderBlocks(node.content)
    case 'paragraph':
      return renderInline(node.content).split('\n').map(escapeLineStart).join('\n')
    case 'heading':
      return `${'#'.repeat(clampLevel(attrs.level))} ${renderInline(node.content)}`
    case 'bulletList':
      return renderList(node.content, () => '- ')
    case 'orderedList':
      // Always numbered from 1: a stored `order` is not displayed (the write
      // gate refuses any `order` other than the identity value 1).
      return renderList(node.content, (index) => `${index + 1}. `)
    case 'listItem':
      return renderBlocks(node.content)
    case 'blockquote':
      return renderBlocks(node.content).split('\n').map((line) => `> ${line}`).join('\n')
    case 'codeBlock':
      return '```' + (attrs.language ?? '') + '\n' + list(node.content).map(plainText).join('') + '\n```'
    case 'rule':
      return '---'
    case 'text':
      return renderText(node)
    case 'hardBreak':
      return '\n'
    // The next four render for display only; the writer has no inverse for
    // them, so the write gate refuses any doc that contains one.
    case 'mention':
      return attrs.text || `@${attrs.id ?? ''}`
    case 'emoji':
      return attrs.text ?? attrs.shortName ?? ''
    case 'inlineCard':
    case 'blockCard':
      return attrs.url ?? ''
    default: {
      // An unknown node shows its children rather than vanishing.
      const children = list(node.content)
      return children.some((child) => INLINE_TYPES.has(child?.type)) ? renderInline(children) : renderBlocks(children)
    }
  }
}

const clampLevel = (level) => Math.min(6, Math.max(1, Number(level) || 1))

const plainText = (node) => (typeof node?.text === 'string' ? node.text : '')

function renderList(items, markerFor) {
  return list(items).map((item, index) => {
    const marker = markerFor(index)
    // Continuation lines (a nested list, a second paragraph) are indented
    // under the marker so they read as part of the item.
    return marker + renderNode(item).replaceAll('\n', '\n' + ' '.repeat(marker.length))
  }).join('\n')
}

function renderText(node) {
  const text = plainText(node)
  // An empty run shows nothing, whatever its marks; `****` would read back
  // as literal asterisks rather than as an empty strong run.
  if (text === '') return ''
  const marks = list(node.marks)
  const isCode = marks.some((mark) => mark?.type === 'code')
  // Marks wrap in stored order, so strong+em renders as `_**x**_`. The writer
  // does not nest, so such a run reads back differently and the gate refuses it.
  return marks.reduce(wrapInMark, isCode ? escapeCode(text) : escapeInline(text))
}

function wrapInMark(markdown, mark) {
  switch (mark?.type) {
    case 'strong': return `**${markdown}**`
    case 'em': return `_${markdown}_`
    case 'code': return `\`${markdown}\``
    case 'strike': return `~~${markdown}~~`
    case 'link': return `[${markdown}](${escapeHref(mark.attrs?.href ?? '')})`
    default: return markdown // unmodelled marks (underline, textColor, ...) show as plain text
  }
}

// --- Escaping: each function escapes exactly what the parser below could
// --- misread in that context, using the one backslash rule it undoes.

/** Characters that open or close an inline construct (and the escape itself). */
const escapeInline = (text) => text.replace(/[\\`*_~[\]]/g, '\\$&')

/** Inside a code span only the backtick and the backslash are special. */
const escapeCode = (text) => text.replace(/[\\`]/g, '\\$&')

/** Inside a link destination only `)` ends it (so `Foo_(bar)` keeps its paren). */
const escapeHref = (href) => href.replace(/[\\)]/g, '\\$&')

/**
 * A paragraph line must never begin like a heading, quote, bullet or ordered
 * item. Fences (```), `**` and `~~` are already covered by `escapeInline`.
 * Escaping unconditionally (even `#nospace`) keeps the rule independent of
 * the exact block patterns the parser uses.
 */
const escapeLineStart = (line) => line.replace(/^[#>-]/, '\\$&').replace(/^(\d+)\./, '$1\\.')

// =============================================================================
// Markdown -> ADF
// =============================================================================

export function markdownToAdf(markdown) {
  const content = typeof markdown === 'string'
    ? markdown.trim().split(/\n{2,}/).filter((block) => block.trim() !== '').map(parseBlock)
    : []
  return { type: 'doc', version: 1, content }
}

const FENCE = /^```([^\n]*)\n([\s\S]*)\n```$/
const HEADING = /^(#{1,6}) (.*)$/
const BULLET = /^- (.*)$/
const ORDINAL = /^\d+\. (.*)$/

/**
 * One block, classified as a whole: anything that is not exactly one of the
 * forms in the header comment is a paragraph. Unsupported Markdown (tables,
 * nested lists, ...) therefore degrades to literal text and never throws.
 */
function parseBlock(block) {
  const fence = block.match(FENCE)
  if (fence) {
    const [, language, body] = fence
    const content = [{ type: 'text', text: body }]
    return language ? { type: 'codeBlock', attrs: { language }, content } : { type: 'codeBlock', content }
  }

  const lines = block.split('\n')
  const heading = lines.length === 1 && block.match(HEADING)
  if (heading) return { type: 'heading', attrs: { level: heading[1].length }, content: parseInline(heading[2]) }
  if (block === '---') return { type: 'rule' }
  if (lines.every((line) => BULLET.test(line))) return listNode('bulletList', lines, BULLET)
  if (lines.every((line) => ORDINAL.test(line))) return listNode('orderedList', lines, ORDINAL)
  if (lines.every((line) => line.startsWith('>'))) {
    return { type: 'blockquote', content: [paragraph(lines.map((line) => line.replace(/^> ?/, '')))] }
  }
  return paragraph(lines)
}

/**
 * Item text is trimmed, as in CommonMark (the spaces after a marker are
 * indentation, not content). A consequence the tests pin: an item whose text
 * is padded with spaces cannot round-trip, so the gate refuses it.
 */
function listNode(type, lines, pattern) {
  const items = lines.map((line) => ({ type: 'listItem', content: [paragraph([line.match(pattern)[1].trim()])] }))
  return { type, content: items }
}

function paragraph(lines) {
  const content = lines.flatMap((line, index) => (index === 0 ? parseInline(line) : [{ type: 'hardBreak' }, ...parseInline(line)]))
  return { type: 'paragraph', content }
}

const ASCII_PUNCTUATION = /[!-/:-@[-`{-~]/
const isEscapable = (char) => char !== undefined && ASCII_PUNCTUATION.test(char)
const unescape = (text) => text.replace(/\\([!-/:-@[-`{-~])/g, '$1')

const textNode = (text, mark) => (mark ? { type: 'text', text, marks: [mark] } : { type: 'text', text })

/** Parses one line into text runs; adjacent plain text always lands in a single run. */
function parseInline(line) {
  const nodes = []
  let plain = ''
  let i = 0
  while (i < line.length) {
    const span = readSpan(line, i)
    if (span) {
      if (plain) nodes.push(textNode(plain))
      plain = ''
      nodes.push(span.node)
      i = span.end
    } else if (line[i] === '\\' && isEscapable(line[i + 1])) {
      plain += line[i + 1]
      i += 2
    } else {
      plain += line[i]
      i += 1
    }
  }
  if (plain) nodes.push(textNode(plain))
  return nodes
}

const DELIMITED_MARKS = [['**', 'strong'], ['~~', 'strike'], ['_', 'em'], ['`', 'code']]

/**
 * The marked run starting at `start`, or null. A span needs non-empty content
 * and a closer on the same line; otherwise its opener is literal text.
 */
function readSpan(line, start) {
  for (const [delimiter, type] of DELIMITED_MARKS) {
    if (!line.startsWith(delimiter, start)) continue
    const from = start + delimiter.length
    const close = findUnescaped(line, delimiter, from)
    if (close > from) {
      return { node: textNode(unescape(line.slice(from, close)), { type }), end: close + delimiter.length }
    }
  }
  if (line[start] === '[') {
    const textEnd = findUnescaped(line, ']', start + 1)
    if (textEnd > start + 1 && line[textEnd + 1] === '(') {
      const hrefEnd = findUnescaped(line, ')', textEnd + 2)
      if (hrefEnd !== -1) {
        const href = unescape(line.slice(textEnd + 2, hrefEnd))
        return {
          node: textNode(unescape(line.slice(start + 1, textEnd)), { type: 'link', attrs: { href } }),
          end: hrefEnd + 1,
        }
      }
    }
  }
  return null
}

/** Index of the first `target` at or after `from` that is not backslash-escaped, else -1. */
function findUnescaped(line, target, from) {
  for (let i = from; i < line.length; i += 1) {
    if (line[i] === '\\' && isEscapable(line[i + 1])) i += 1
    else if (line.startsWith(target, i)) return i
  }
  return -1
}

// =============================================================================
// The write gate
// =============================================================================

/**
 * True when writing `doc` back (`markdownToAdf(adfToMarkdown(doc))`) would
 * lose or change anything a reader could notice. The gate does not keep its
 * own list of supported nodes and marks: it performs the write and compares,
 * so it cannot drift from what the codec actually does. Mentions, emoji,
 * cards, tables, unmodelled marks, nested lists, a heading level above 6 and
 * so on are all refused simply because they do not come back.
 *
 * Four kinds of detail are allowed to be lost, because losing them changes
 * nothing a reader sees (see `withoutDroppableDetail` / `isEmptyParagraph`):
 *   1. an orderedList `order` of exactly 1 (the writer always numbers from 1);
 *   2. `localId` attrs, stamped by Jira's editor on most nodes, and the
 *      empty `attrs` object left once those are gone;
 *   3. an empty unmarked text run whose neighbours are all marked runs (LIN-1939);
 *   4. a top-level empty paragraph that is not the first block (LIN-2019).
 * For those docs the gate permits a write that is not a deep-equal round trip.
 */
export function adfHasUnrenderableContent(doc) {
  if (!isObject(doc)) return false
  const expected = list(withoutDroppableDetail(doc).content).filter((node, index) => index === 0 || !isEmptyParagraph(node))
  const written = markdownToAdf(adfToMarkdown(doc)).content
  return !sameTree(written, expected)
}

/** A copy of `node` without the detail the writer may drop (exceptions 1-3). */
function withoutDroppableDetail(node) {
  if (!isObject(node)) return node
  const copy = { ...node }
  const attrs = keptAttrs(node)
  if (attrs === undefined) delete copy.attrs
  else copy.attrs = attrs
  if (Array.isArray(node.content)) {
    const children = node.content.map(withoutDroppableDetail)
    copy.content = children.filter((child, i) => !isInvisibleRun(child, [children[i - 1], children[i + 1]]))
  }
  return copy
}

/** The attrs the writer must reproduce. Anything that is not a plain object is kept, so it fails closed. */
function keptAttrs(node) {
  if (!isObject(node.attrs)) return node.attrs
  const attrs = { ...node.attrs }
  delete attrs.localId
  // Only the integer 1 is the identity: 0, 2, '1' etc. would renumber or change type.
  if (node.type === 'orderedList' && attrs.order === 1) delete attrs.order
  return Object.keys(attrs).length > 0 ? attrs : undefined
}

const isEmptyPlainText = (node) => node?.type === 'text' && node.text === '' && !list(node.marks).length
const isMarkedText = (node) => node?.type === 'text' && list(node.marks).length > 0

/**
 * Exception 3. An empty run next to plain text is NOT droppable: the write
 * merges adjacent plain runs, so that loss is real and stays refused.
 */
function isInvisibleRun(node, neighbours) {
  const present = neighbours.filter((neighbour) => neighbour !== undefined)
  return isEmptyPlainText(node) && present.length > 0 && present.every(isMarkedText)
}

/**
 * Exception 4. Jira's editor leaves empty spacer paragraphs between and after
 * content; Markdown has no form for one (blank lines are block separators), so
 * the write drops it. Only a leading one (including a doc that is nothing but
 * an empty paragraph) stays refused, as the tests pin.
 */
const isEmptyParagraph = (node) => node?.type === 'paragraph' && node.attrs === undefined && list(node.content).every(isEmptyPlainText)

/** Structural equality of JSON-shaped values; key order is irrelevant. */
function sameTree(a, b) {
  if (a === b) return true
  if (!isObject(a) || !isObject(b) || Array.isArray(a) !== Array.isArray(b)) return false
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && sameTree(a[key], b[key]))
}
