// =============================================================================
// Jira ADF (Atlassian Document Format) <-> Markdown codec (LIN-2399).
//
// Pure, no imports, throws nothing. lib/providers/jira/index.js reaches it only
// through the three exports:
//
//   adfToMarkdown(doc)              read:  stored ADF → the Markdown Harbour shows
//   markdownToAdf(markdown)         write: edited Markdown → the ADF Harbour stores
//   adfHasUnrenderableContent(doc)  the write gate (LIN-1886, D1 policy)
//
// A description edit is read-then-rewrite: the stored ADF is rendered, a human
// edits the Markdown, and the result is written back. So the reader escapes
// whatever the writer would read as markup, and the gate refuses a write
// exactly when that round trip would change the stored document. The gate does
// not model the writer; it runs it. See DESIGN.md.
// =============================================================================

// -----------------------------------------------------------------------------
// The Markdown both directions share
// -----------------------------------------------------------------------------

const BLOCK_END = '\n\n'

// The writer splits blocks on two or more LITERAL newlines and nothing else, so
// a "blank" line holding a space (common in pasted code) does not split a block
// (LIN-1886 re-review R3.1).
const BLOCK_SPLIT = /\n{2,}/

const FENCE = '```'

// The writer's block openers. HEADING and RULE are tested against a whole
// block, so their `\s` can cross a newline: `#\nrest` is a heading (LIN-1886
// re-review R2). The other three are tested against every line of a block. The
// reader's `escapeLeader` tests lines against these same patterns.
const HEADING = /^(#{1,6})\s+/
const RULE = /^\s*-{3,}\s*$/
const QUOTE = /^>\s/
const BULLET = /^-\s+/
const ORDERED = /^\d+\.\s+/

// CommonMark: a backslash escapes ASCII punctuation and nothing else. That is
// what keeps a typed `C:\Users\me` or a regex's `\d` intact while the codec
// still round-trips its own escapes.
const PUNCTUATION = '[!-/:-@[-`{-~]'
const FIRST_PUNCTUATION = new RegExp(PUNCTUATION)
const ESCAPED_PUNCTUATION = new RegExp(`\\\\(${PUNCTUATION})`, 'g')

// What the reader escapes in text: every character that can open an inline
// construct, `]` (which ends link text), and the backslash itself.
const TEXT_SPECIALS = /[\\`*_~[\]]/g

// What it escapes in an href: the backslash and BOTH brackets. `)` because the
// writer ends an href at the first unescaped `)` (the `(`-truncation bug,
// LIN-1886 review F1). `(` because `marked` accepts an unescaped `(` in a
// destination only when it is balanced, and with `)` escaped it never is
// (LIN-3561). An href is unescaped with this narrow set, not CommonMark's, or
// the writer would eat backslashes it never put there.
const HREF_SPECIALS = /[\\()]/g
const ESCAPED_HREF_SPECIAL = /\\([\\()])/g

const backslash = (text, specials) => text.replace(specials, '\\$&')
const unescapeText = text => text.replace(ESCAPED_PUNCTUATION, '$1')

// CommonMark strips one space from each side of a code span when both are
// present and the span is not all spaces. The reader pads exactly when the
// writer would strip.
const hasStrippableSpaces = code => code.startsWith(' ') && code.endsWith(' ') && code.trim() !== ''

// -----------------------------------------------------------------------------
// ADF helpers
// -----------------------------------------------------------------------------

const isObject = value => value !== null && typeof value === 'object'
const contentOf = node => (isObject(node) && Array.isArray(node.content) ? node.content : [])
const marksOf = node => (isObject(node) && Array.isArray(node.marks) ? node.marks : [])
const textRun = (text, marks) => (marks ? { type: 'text', text, marks } : { type: 'text', text })

// -----------------------------------------------------------------------------
// ADF → Markdown
// -----------------------------------------------------------------------------
//
// A deliberately MINIMAL renderer for the node and mark types real Jira content
// uses, not the full ADF spec. An unknown node renders its children, so it
// degrades to its text rather than vanishing.
//
// ESCAPING (LIN-1886 review F1, John's Option A). Text leaves here with every
// markup character backslash-escaped, or ordinary Jira prose is reinterpreted
// on save: `foo_bar_baz` growing an em mark, a paragraph beginning `- `
// becoming a list, a paragraph reading ```` ```js ```` losing its text.
// Refusing such prose was rejected (it would 422 nearly every technical
// description). The accepted cost: the raw textarea shows `foo\_bar\_baz`,
// while `marked` prints just the character. Escaping is UNCONDITIONAL, not
// "only where a construct would match": then every markup character is half of
// a `\x` pair and no construct can begin anywhere. Keep it that way.
//
// CODE IS NOT ESCAPED (LIN-3564). CommonMark processes no escapes inside a code
// span, so `marked` would show them. A code run is fenced instead (`codeSpan`),
// and a code block's body is written verbatim between fences.

/**
 * Convert an ADF document (Jira's rich-text wire shape) to Markdown.
 * @param {{type?: string, content?: Array}|null|undefined} doc
 * @returns {string}
 */
export function adfToMarkdown(doc) {
  return renderAll(contentOf(doc)).trim()
}

function renderAll(nodes) {
  return nodes.map(render).join('')
}

/** One node as Markdown. Block nodes end with a blank line; inline nodes do not. */
function render(node) {
  if (!isObject(node)) return ''
  const attrs = isObject(node.attrs) ? node.attrs : {}
  switch (node.type) {
    case 'text': return renderText(node)
    case 'hardBreak': return '\n'
    case 'paragraph': return renderAll(contentOf(node)).split('\n').map(escapeLeader).join('\n') + BLOCK_END
    case 'heading': return `${'#'.repeat(headingLevel(attrs.level))} ${renderAll(contentOf(node))}${BLOCK_END}`
    case 'bulletList': return renderList(node, () => '- ')
    // Always numbered from 1, whatever `attrs.order` says (ruling `d38d3755`).
    case 'orderedList': return renderList(node, index => `${index + 1}. `)
    case 'codeBlock': return renderCodeBlock(node, attrs)
    case 'blockquote': return renderAll(contentOf(node)).trim().split('\n').map(line => `> ${line}`).join('\n') + BLOCK_END
    case 'rule': return `---${BLOCK_END}`
    case 'mention': return attrs.text || `@${attrs.id ?? ''}`
    case 'emoji': return attrs.text || attrs.shortName || ''
    case 'inlineCard': return attrs.url ?? ''
    case 'blockCard': return (attrs.url ?? '') + BLOCK_END
    default: return renderAll(contentOf(node))
  }
}

const headingLevel = level => Math.min(6, Math.max(1, Math.trunc(Number(level)) || 1))

/** One item per line; each item's own rendering is trimmed of its block ending. */
function renderList(node, marker) {
  return contentOf(node).map((item, index) => marker(index) + render(item).trim()).join('\n') + BLOCK_END
}

/** The body verbatim, minus trailing newlines: the writer reads it back with no inline pass. */
function renderCodeBlock(node, attrs) {
  const language = typeof attrs.language === 'string' ? attrs.language : ''
  const body = contentOf(node).map(run => String(run?.text ?? '')).join('').replace(/\n+$/, '')
  return `${FENCE}${language}\n${body}\n${FENCE}${BLOCK_END}`
}

/**
 * Neutralise a line the writer would read as a block opener, by escaping its
 * first punctuation character: the `#`, `>` or `-`, the `.` of `1.`, or the
 * first `-` of an indented rule. Applied to every line, because the writer
 * tests quotes and list items against every line of a block. A heading is
 * tested with a newline after the line, as the writer sees it when the block
 * goes on: so a bare `#` line is escaped too (re-review R2). Fences need nothing
 * here: text backticks are already escaped, and a code span that would open a
 * fence fails the gate's round trip.
 */
function escapeLeader(line) {
  const opensBlock = HEADING.test(`${line}\n`) || [RULE, QUOTE, BULLET, ORDERED].some(form => form.test(line))
  return opensBlock ? line.replace(FIRST_PUNCTUATION, '\\$&') : line
}

/** A text run: escaped (unless it is code), then wrapped in each of its marks in order. */
function renderText(node) {
  const text = String(node.text ?? '')
  const marks = marksOf(node)
  const isCode = marks.some(mark => mark?.type === 'code')
  return marks.reduce(markText, isCode ? text : backslash(text, TEXT_SPECIALS))
}

/** Wrap Markdown in one mark. A mark the codec does not know shows as its plain text. */
function markText(markdown, mark) {
  switch (mark?.type) {
    case 'strong': return `**${markdown}**`
    case 'em': return `_${markdown}_`
    case 'strike': return `~~${markdown}~~`
    case 'code': return codeSpan(markdown)
    case 'link': return `[${markdown}](${backslash(String(mark.attrs?.href ?? ''), HREF_SPECIALS)})`
    default: return markdown
  }
}

/**
 * A code span, CommonMark's way: the text verbatim, fenced by a backtick run
 * one longer than the longest inside it. One space pads each side when a
 * backtick sits at an edge (it would merge into the fence) or when the writer
 * would otherwise strip the text's own edge spaces.
 */
function codeSpan(text) {
  const longestRun = Math.max(0, ...(text.match(/`+/g) ?? []).map(run => run.length))
  const fence = '`'.repeat(longestRun + 1)
  const pad = text.startsWith('`') || text.endsWith('`') || hasStrippableSpaces(text)
  return pad ? `${fence} ${text} ${fence}` : fence + text + fence
}

// -----------------------------------------------------------------------------
// Markdown → ADF (LIN-1886)
// -----------------------------------------------------------------------------
//
// The reader's inverse, over a STRICT SUBSET of its vocabulary: paragraphs,
// headings, bullet and ordered lists, code blocks, blockquotes, rules, hard
// breaks, and the strong/em/code/strike/link marks. There is no Markdown for
// mention, emoji, inlineCard or blockCard, which is why the gate is a round
// trip through this side, not a check against the reader's vocabulary
// (LIN-1886 review Blocker 3). Anything else falls back to plain text.

/**
 * Convert Markdown to an ADF document. Unsupported Markdown becomes a plain
 * paragraph rather than throwing. Refusing content a write would destroy is
 * `adfHasUnrenderableContent`'s job, applied to the stored ADF being replaced.
 * @param {string|null|undefined} markdown
 * @returns {{type: 'doc', version: 1, content: Array}}
 */
export function markdownToAdf(markdown) {
  if (typeof markdown !== 'string' || markdown.trim() === '') return { type: 'doc', version: 1, content: [] }
  const blocks = markdown.replace(/^\n+|\n+$/g, '').split(BLOCK_SPLIT)
  return { type: 'doc', version: 1, content: blocks.map(readBlock) }
}

/** One block → one ADF block node. The first form that matches wins. */
function readBlock(block) {
  const lines = block.split('\n')
  if (lines.length > 1 && lines[0].startsWith(FENCE)) return readFence(lines)

  const heading = block.match(HEADING)
  if (heading) {
    // No line concept in a heading: a `\n` inside it stays text.
    const content = readInline(block.slice(heading[0].length).trim())
    return { type: 'heading', attrs: { level: heading[1].length }, content }
  }

  if (RULE.test(block)) return { type: 'rule' }
  if (lines.every(line => QUOTE.test(line))) {
    return { type: 'blockquote', content: [readParagraph(lines.map(line => line.replace(QUOTE, '')))] }
  }
  if (lines.every(line => BULLET.test(line))) return readList('bulletList', lines, BULLET)
  if (lines.every(line => ORDERED.test(line))) return readList('orderedList', lines, ORDERED)
  return readParagraph(lines)
}

/**
 * A fence line plus at least one more line. The closing fence is optional: a
 * snippet split by a blank line leaves an unclosed fence, which stays code
 * (LIN-3557 review). A closing fence may carry trailing whitespace or a CR
 * (LIN-3557). A lone fence line is not a block of its own; it is text.
 */
function readFence(lines) {
  const closed = lines.at(-1).trimEnd() === FENCE
  const language = lines[0].slice(FENCE.length).trim()
  const body = lines.slice(1, closed ? -1 : undefined).join('\n')
  return {
    type: 'codeBlock',
    ...(language && { attrs: { language } }),
    content: body ? [textRun(body)] : [],
  }
}

/** Lines joined by hard breaks. */
function readParagraph(lines) {
  return {
    type: 'paragraph',
    content: lines.flatMap((line, index) => (index === 0 ? readInline(line) : [{ type: 'hardBreak' }, ...readInline(line)])),
  }
}

/** One item per line. The marker and any whitespace after it are stripped. */
function readList(type, lines, marker) {
  const item = line => ({ type: 'listItem', content: [{ type: 'paragraph', content: readInline(line.replace(marker, '')) }] })
  return { type, content: lines.map(item) }
}

// The inline tokens, tried in order at each position. Each pattern is sticky,
// so it matches only where the scan stands. A token yields literal text (a
// string) or a node. In the bodies, `(?:\\[\s\S]|[^\\X])` reads "any character
// but X, a backslash taking the next character with it": that is what makes
// `\]` literal inside link text (the bug that lost the link mark on
// `[a]b](http://x)`).
const markedRun = type => match => textRun(unescapeText(match[1]), [{ type }])
const INLINE_TOKENS = [
  // A backslash before punctuation: the punctuation, literally.
  [new RegExp(`\\\\${PUNCTUATION}`, 'y'), match => match[0][1]],
  // `[text](href)`. Empty link text is allowed.
  [/\[((?:\\[\s\S]|[^\\\]])*)\]\(((?:\\[\s\S]|[^\\)])*)\)/y,
    match => textRun(unescapeText(match[1]), [{ type: 'link', attrs: { href: match[2].replace(ESCAPED_HREF_SPECIAL, '$1') } }])],
  // A code span, as CommonMark reads it: the opening is the WHOLE backtick run,
  // it closes at the next run of exactly that length, and nothing inside is
  // unescaped.
  [/(`+)(?!`)([\s\S]*?)(?<!`)\1(?!`)/y,
    match => textRun(hasStrippableSpaces(match[2]) ? match[2].slice(1, -1) : match[2], [{ type: 'code' }])],
  // A backtick run with no closing run is literal as a whole, so its tail is
  // not re-read as a shorter opening.
  [/`+/y, match => match[0]],
  // Non-empty delimited runs, unnested. A lone unescaped `*` inside `**…**`
  // (or `~` inside `~~…~~`) means it is not a run. `**`, `____` stay literal.
  [/\*\*((?:\\[\s\S]|[^\\*])+)\*\*/y, markedRun('strong')],
  [/~~((?:\\[\s\S]|[^\\~])+)~~/y, markedRun('strike')],
  [/_((?:\\[\s\S]|[^\\_])+)_/y, markedRun('em')],
]

/**
 * Inline Markdown → text runs. Contiguous literal text becomes one node. An
 * empty input still yields one empty run: that is what makes an empty list
 * item (a bare `- ` line in a multi-item list) rebuildable.
 */
function readInline(source) {
  const nodes = []
  let literal = ''
  for (let at = 0; at < source.length;) {
    const [token, length] = tokenAt(source, at)
    if (typeof token === 'string') {
      literal += token
    } else {
      if (literal) nodes.push(textRun(literal))
      literal = ''
      nodes.push(token)
    }
    at += length
  }
  if (literal || nodes.length === 0) nodes.push(textRun(literal))
  return nodes
}

/** The token at `at` as `[token, length]`; a single literal character if none matches. */
function tokenAt(source, at) {
  for (const [pattern, toToken] of INLINE_TOKENS) {
    pattern.lastIndex = at
    const match = pattern.exec(source)
    if (match) return [toToken(match), match[0].length]
  }
  return [source[at], 1]
}

// -----------------------------------------------------------------------------
// The write gate (LIN-1886, D1 policy)
// -----------------------------------------------------------------------------

/**
 * True if writing back `adfToMarkdown(doc)` would change `doc`: used to refuse
 * (422) a description overwrite that would silently destroy Jira-native
 * content. Never used to reject a READ, which still renders mentions, emoji and
 * cards for display.
 *
 * It performs the write it guards and compares, so it is derived from the
 * writer by construction (LIN-1886 review Blocker 3) and cannot drift from it:
 *
 *     adfHasUnrenderableContent(doc) === false
 *       ⟹  markdownToAdf(adfToMarkdown(doc)) deep-equals doc,
 *           EXCEPT for the four enumerated classes `comparable` forgets
 *
 * A refusal is always a refusal of a real loss, apart from the one policy in
 * `isEmptyHeading`. The codec's tests check both directions over fixtures and a
 * generated adversarial corpus (LIN-1886 review F2).
 *
 * Deliberately NOT refused (LIN-1886 review F1, human decision `599551c2`):
 * Markdown-looking prose. `- not a list`, `foo_bar_baz` and ```` ```js ```` are
 * escaped by `adfToMarkdown` and round-trip faithfully.
 *
 * Like `adfToMarkdown`, only `doc.content` is inspected, never the wrapper, so
 * a bare `{ content: [...] }` is treated as a document.
 * @param {object|null|undefined} doc - an ADF document (or any ADF node)
 * @returns {boolean}
 */
export function adfHasUnrenderableContent(doc) {
  if (!isObject(doc)) return false
  const stored = comparableBlocks(contentOf(doc))
  const rewritten = comparableBlocks(markdownToAdf(adfToMarkdown(doc)).content)
  return !sameJson(stored, rewritten) || stored.some(isEmptyHeading)
}

/**
 * The policy refusal: a heading with no text is refused wherever it sits. At
 * the document's edge it really is lost (it re-reads as a paragraph of literal
 * `#`). In the middle it survives, but it is refused there too. Headings
 * survive only at the top level, so only top-level blocks are checked.
 */
const isEmptyHeading = block => block?.type === 'heading' && block.content.length === 0

/**
 * The top-level blocks, compared as `comparable` nodes. Exception 4 (LIN-2019):
 * an empty paragraph after the first block is forgotten. Its blank line is
 * dropped on the round trip, and refusing every Jira description with a blank
 * line in it is worse than dropping a blank line. A leading empty paragraph, or
 * one alone, is kept and so refused: the reader's trim eats it.
 */
function comparableBlocks(blocks) {
  const isEmptyParagraph = block => block?.type === 'paragraph' && block.content.length === 0
  return blocks.map(comparable).filter((block, index) => index === 0 || !isEmptyParagraph(block))
}

/**
 * A node as the codec models it: its type, text, attrs, marks and content. A
 * missing `marks` or `content` counts as empty, and any other key is ignored.
 * It forgets what the rulings accept a write losing (ruling `d38d3755`,
 * LIN-2019). Exceptions 1 to 3 change no rendered character, and each is
 * pinned by a fixture:
 *
 *   1. an empty unmarked text run with no unmarked run beside it (`forgettable`);
 *   2. an orderedList's identity attrs (`comparableAttrs`);
 *   3. a `localId` attrs key on any node (`comparableAttrs`).
 *
 * Exception 4 is in `comparableBlocks`.
 */
function comparable(node) {
  if (!isObject(node)) return node
  const children = contentOf(node)
  return {
    type: node.type,
    text: node.text,
    attrs: comparableAttrs(node),
    marks: marksOf(node),
    content: children.filter((child, index) => !forgettable(child, index, children)).map(comparable),
  }
}

/**
 * Exception 1 (LIN-1939, deliberately not fixed here): an empty, unmarked run
 * whose neighbours are not unmarked runs. `[text(''), text('x', em)]` renders
 * `_x_` and re-reads without the empty run. Beside an unmarked run it is NOT
 * forgotten, because the two would merge into one. This also makes a list
 * item's empty paragraph equal to the writer's empty `- ` item, which holds
 * one empty run.
 */
function forgettable(node, index, siblings) {
  const isPlainRun = sibling => isObject(sibling) && sibling.type === 'text' && marksOf(sibling).length === 0
  return isPlainRun(node) && node.text === '' && !isPlainRun(siblings[index - 1]) && !isPlainRun(siblings[index + 1])
}

function comparableAttrs(node) {
  if (!isObject(node.attrs)) return node.attrs
  // Exception 3 (LIN-2019): `localId` is ignored. Jira's editor stamps it on
  // virtually every node, it renders as nothing, and it is re-stamped on the
  // next edit. Exactly one key: anything else still has to survive the write.
  const { localId, ...attrs } = node.attrs
  // Exception 2 (ruling `d38d3755`): the writer emits an orderedList with no
  // attrs and the reader numbers from 1, so the identity `{order: 1}` (or a
  // bare `{}`) is safe to drop. Only the EXACT integer 1: `{order: 0}` would
  // renumber a visibly 0-based list. A non-identity order is refused "UNTIL THE
  // WRITER MODELS THE ATTRIBUTE". Modelling it would change what a typed `5.
  // foo` means, and re-review `5ae61f22` measured that it would only move the
  // gap onto the far commoner no-attrs list.
  if (node.type === 'orderedList' && (sameJson(attrs, {}) || sameJson(attrs, { order: 1 }))) return undefined
  const onlyLocalId = Object.hasOwn(node.attrs, 'localId') && Object.keys(attrs).length === 0
  return onlyLocalId ? undefined : attrs
}

/** Structural equality of JSON-shaped values, independent of key order. */
function sameJson(a, b) {
  if (a === b) return true
  if (!isObject(a) || !isObject(b) || Array.isArray(a) !== Array.isArray(b)) return false
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && sameJson(a[key], b[key]))
}
