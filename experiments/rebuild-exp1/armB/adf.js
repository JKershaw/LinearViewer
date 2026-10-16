// =============================================================================
// Jira ADF (Atlassian Document Format) <-> Markdown codec (LIN-2399).
//
// Pure functions, no imports, throws nothing. Reached only by
// lib/providers/jira/index.js, through these three exports:
//
//   adfToMarkdown(doc)              read: stored ADF -> Markdown, for display and editing
//   markdownToAdf(markdown)         write: the inverse, for an edited description
//   adfHasUnrenderableContent(doc)  gate: would a read-then-write lose content?
//
// The three share one vocabulary, defined first: the escape sets, the inline
// mark syntax and the block markers. The reader and the writer are inverses
// because they read the same tables, and the gate is derived from what the
// WRITER can rebuild (LIN-1886 review Blocker 3).
// =============================================================================

const isObject = value => typeof value === 'object' && value !== null
const arrayOf = value => (Array.isArray(value) ? value : [])
const textOf = node => (typeof node?.text === 'string' ? node.text : '')

// -----------------------------------------------------------------------------
// Escaping (LIN-1886 review F1, John's Option A; human decision 599551c2).
//
// The read path is half of a round trip: an in-app description edit renders the
// stored ADF to Markdown, hands it to a human, and writes back whatever returns
// through markdownToAdf. So every character sequence the writer reads as markup
// leaves the reader neutralised, or ordinary Jira prose is silently
// reinterpreted on save: `foo_bar_baz` growing an em mark, a paragraph beginning
// `- ` becoming a bulletList, a paragraph reading ```` ```js ```` losing its text.
//
// Refusing that prose was rejected (it would 422 nearly every technical
// description); escaping it is the decision. The accepted cost: the raw textarea
// shows `foo\_bar\_baz`. Rendered Markdown is unaffected — a backslash before
// ASCII punctuation is a CommonMark escape, so `marked` prints the character.
//
// Escaping is UNCONDITIONAL, not "only where a construct would match": the
// cheap-looking version has to reason about how escaping one position changes
// the parse of every later one. Escaping every metacharacter makes the argument
// total — every metacharacter is then the second half of a `\x` pair, the inline
// scanner consumes the pair as one literal, and no construct can begin anywhere.
// Keep it that way.
//
// Each context is escaped with its own set and unescaped with the SAME set, so
// the writer never eats a backslash the reader did not put there.
// -----------------------------------------------------------------------------

/**
 * Plain and marked text: every character that opens or closes an inline
 * construct, plus the escape itself. Unescaping follows CommonMark — a backslash
 * escapes ASCII punctuation and nothing else — so a hand-typed `C:\Users\me` or
 * a regex's `\d` stays intact.
 */
const INLINE_TEXT = {
  escape: text => text.replace(/[\\`*_~[\]]/g, '\\$&'),
  unescape: md => md.replace(/\\([!-/:-@[-`{-~])/g, '$1'),
}

/**
 * Inside a `code` mark only the fence character and the escape can end the run.
 * Escaping `_`/`*` there would be pure noise in the textarea.
 */
const CODE_TEXT = {
  escape: text => text.replace(/[\\`]/g, '\\$&'),
  unescape: md => md.replace(/\\([\\`])/g, '$1'),
}

/** Inside a link's href only an unescaped `)` ends it — the `(`-truncation bug (`…/Foo_(bar)`). */
const HREF_TEXT = {
  escape: href => href.replace(/[\\)]/g, '\\$&'),
  unescape: md => md.replace(/\\([\\)])/g, '$1'),
}

/**
 * The delimited inline marks, in the writer's scan order: at one position
 * `link` is tried first (so a link whose text holds a marker character is
 * captured whole), then these in order. `stopAt` means an UNESCAPED occurrence
 * of that character inside the run disqualifies it: a lone `*` inside `**…**`
 * is not a strong run.
 *
 * This table plus `link` IS the mark vocabulary: the reader renders exactly
 * these, the writer parses exactly these back, and the gate refuses any other.
 */
const DELIMITED_MARKS = [
  { type: 'strong', delimiter: '**', stopAt: '*', text: INLINE_TEXT },
  { type: 'code', delimiter: '`', text: CODE_TEXT },
  { type: 'strike', delimiter: '~~', stopAt: '~', text: INLINE_TEXT },
  { type: 'em', delimiter: '_', text: INLINE_TEXT },
]

/**
 * What markdownToAdf splits a document into blocks on — TWO LITERAL NEWLINES,
 * nothing else. The gate tests the same pattern against rendered bodies, so the
 * two cannot drift: a "blank" line holding a space (`"\n \n"`, common in pasted
 * code) does not split, and refusing it would refuse content that round-trips
 * (LIN-1886 re-review R3.1). Share the constant; do not re-type the regex.
 */
const BLOCK_SPLIT = /\n{2,}/

// Block markers. FENCE, HEADING and RULE are tested against the start of a whole
// block; the *_LINE forms against EVERY line of it.
const FENCE = '```'
const HEADING = /^(#{1,6})\s+/
const RULE = /^-{3,}$/
const QUOTE_LINE = /^>\s/
const BULLET_LINE = /^-\s+/
const ORDERED_LINE = /^\d+\.\s+/

// -----------------------------------------------------------------------------
// ADF → Markdown.
//
// Jira Cloud's description/comment bodies are ADF documents, not plain text or
// HTML. This is a deliberately MINIMAL renderer covering the node/mark types
// real Jira content uses. An unknown node renders its children, so it degrades
// to its text rather than vanishing. Block nodes end in "\n\n"; the document is
// trimmed as a whole.
// -----------------------------------------------------------------------------

/**
 * Convert an ADF document (Jira's rich-text wire shape) to Markdown.
 * @param {{type?: string, content?: Array}|null|undefined} doc
 * @returns {string}
 */
export function adfToMarkdown(doc) {
  return renderDocument(doc).trim()
}

/** The document before adfToMarkdown's final trim. Only `doc.content` is rendered; the wrapper's type is never looked at. */
function renderDocument(doc) {
  return isObject(doc) ? renderAll(doc.content) : ''
}

function renderAll(nodes) {
  return arrayOf(nodes).map(renderNode).join('')
}

function renderNode(node) {
  switch (node?.type) {
    case 'text': return renderText(node)
    case 'hardBreak': return '\n'
    case 'paragraph': return `${renderParagraph(node)}\n\n`
    case 'heading': return `${'#'.repeat(headingLevel(node))} ${renderAll(node.content)}\n\n`
    case 'bulletList': return renderList(node, () => '- ')
    // Numbered from 1 whatever `attrs.order` says.
    case 'orderedList': return renderList(node, i => `${i + 1}. `)
    case 'blockquote': return `${renderAll(node.content).trim().split('\n').map(line => `> ${line}`).join('\n')}\n\n`
    case 'codeBlock': return renderCodeBlock(node)
    case 'rule': return '---\n\n'
    // Display only: the writer has no inverse for these, so the gate refuses a write over them.
    case 'mention': return node.attrs?.text || `@${node.attrs?.id ?? ''}`
    case 'emoji': return node.attrs?.text || node.attrs?.shortName || ''
    case 'inlineCard': return node.attrs?.url ?? ''
    case 'blockCard': return `${node.attrs?.url ?? ''}\n\n`
    // listItem (its paragraphs render as themselves), and any unknown node.
    default: return renderAll(node?.content)
  }
}

/** Each item is trimmed before its marker is prefixed. */
function renderList(node, marker) {
  return `${arrayOf(node.content).map((item, i) => marker(i) + renderNode(item).trim()).join('\n')}\n\n`
}

/** Clamped into 1-6; the gate refuses a stored level the clamp would change. */
function headingLevel(node) {
  return Math.min(6, Math.max(1, Math.trunc(Number(node.attrs?.level)) || 1))
}

/**
 * A code BLOCK's body, verbatim, minus trailing newlines. It sits between
 * fences and the writer reads it back with no inline pass, so escaping it would
 * corrupt exactly the content the fence exists to protect.
 */
function renderCodeBlock(node) {
  const body = arrayOf(node.content).map(textOf).join('').replace(/\n+$/, '')
  return `${FENCE}${node.attrs?.language ?? ''}\n${body}\n${FENCE}\n\n`
}

/** A paragraph's inline Markdown, with a block leader neutralised on every line. */
function renderParagraph(node) {
  return renderAll(node.content).split('\n').map(escapeBlockLeader).join('\n')
}

/**
 * Neutralise a LEADING token parseBlock would read as a block marker. Inline
 * escaping cannot reach these: `#`, `>`, `-` and `.` are markup only in first
 * position. Applied to every line, because the quote/bullet/ordered forms are
 * tested against every line of a block. A fence needs no case: the inline pass
 * has already escaped its backticks, so ```` ```js ```` leaves as `` \`\`\`js ``.
 */
function escapeBlockLeader(line) {
  // `(\s|$)`, not `\s`: HEADING is matched against the whole BLOCK, and its
  // `\s+` happily consumes the `\n` a hardBreak rendered — so a line of nothing
  // but hashes is a heading leader too (`"#\nrest"` would read back as a
  // heading, losing the `#` line; LIN-1886 re-review R2).
  if (/^#{1,6}(\s|$)/.test(line) || RULE.test(line) || QUOTE_LINE.test(line) || BULLET_LINE.test(line)) {
    return `\\${line}`
  }
  return ORDERED_LINE.test(line) ? line.replace('.', '\\.') : line
}

/**
 * A text run, escaped for the context its marks put it in: a `code` run is
 * re-read as one opaque span, so only its CODE_TEXT set needs neutralising;
 * everything else takes the full inline set. Marks wrap in array order.
 */
function renderText(node) {
  const marks = arrayOf(node.marks)
  const escaper = marks.some(mark => mark?.type === 'code') ? CODE_TEXT : INLINE_TEXT
  return marks.reduce(wrapInMark, escaper.escape(textOf(node)))
}

function wrapInMark(md, mark) {
  if (mark?.type === 'link') return `[${md}](${HREF_TEXT.escape(String(mark.attrs?.href ?? ''))})`
  const syntax = DELIMITED_MARKS.find(({ type }) => type === mark?.type)
  return syntax ? syntax.delimiter + md + syntax.delimiter : md
}

// -----------------------------------------------------------------------------
// Markdown → ADF (LIN-1886) — the write-direction inverse of adfToMarkdown.
//
// Its vocabulary is a STRICT SUBSET of the reader's: paragraphs, headings,
// bullet/ordered lists, code blocks, blockquotes, rules, hard breaks, and the
// DELIMITED_MARKS + link marks — but NOT mention/emoji/inlineCard/blockCard,
// which the reader renders and nothing here can rebuild. That asymmetry is why
// the gate is derived from THIS side (LIN-1886 review Blocker 3).
// -----------------------------------------------------------------------------

/**
 * Convert Markdown to an ADF document — the write-direction inverse of
 * `adfToMarkdown`. Unsupported or unrecognised Markdown degrades to a plain
 * paragraph of text; this never throws. Refusing unrenderable content is
 * `adfHasUnrenderableContent`'s job, applied to the EXISTING stored ADF a write
 * is about to overwrite — and that gate is derived from this function, so this
 * function can never itself manufacture something the gate would flag.
 * @param {string|null|undefined} markdown
 * @returns {{type: 'doc', version: 1, content: Array}}
 */
export function markdownToAdf(markdown) {
  const source = String(markdown ?? '')
  const blocks = source.trim() ? source.replace(/^\n+|\n+$/g, '').split(BLOCK_SPLIT) : []
  return { type: 'doc', version: 1, content: blocks.map(parseBlock) }
}

/** One blank-line-delimited Markdown block → one ADF block node. */
function parseBlock(block) {
  const lines = block.split('\n')
  if (block.startsWith(FENCE)) return parseFence(lines)
  const heading = HEADING.exec(block)
  if (heading) {
    // HEADING's `\s+` eats the leading run, then `.trim()`; the text has no line
    // concept, so a newline in it comes back as a newline, not a hardBreak.
    const text = block.slice(heading[0].length).trim()
    return { type: 'heading', attrs: { level: heading[1].length }, content: parseInline(text) }
  }
  if (RULE.test(block)) return { type: 'rule' }
  if (lines.every(line => QUOTE_LINE.test(line))) {
    return { type: 'blockquote', content: [parseParagraph(lines.map(line => line.replace(QUOTE_LINE, '')).join('\n'))] }
  }
  if (lines.every(line => BULLET_LINE.test(line))) return parseList('bulletList', lines, BULLET_LINE)
  if (lines.every(line => ORDERED_LINE.test(line))) return parseList('orderedList', lines, ORDERED_LINE)
  return parseParagraph(block)
}

/**
 * The fence's language is stamped ONLY when present, read through `.trim()`.
 * The body runs to a closing fence line, or to the end of the block.
 */
function parseFence(lines) {
  const language = lines[0].slice(FENCE.length).trim()
  const closed = lines.length > 1 && lines[lines.length - 1].trim() === FENCE
  const body = lines.slice(1, closed ? -1 : lines.length).join('\n')
  return {
    type: 'codeBlock',
    ...(language && { attrs: { language } }),
    content: body ? [{ type: 'text', text: body }] : [],
  }
}

/**
 * Every line is one item, with exactly one paragraph child. The greedy marker
 * pattern eats any leading whitespace with it, and the item text has no line
 * concept (it is one line).
 */
function parseList(type, lines, marker) {
  return {
    type,
    content: lines.map(line => ({
      type: 'listItem',
      content: [{ type: 'paragraph', content: parseInline(line.replace(marker, '')) }],
    })),
  }
}

/**
 * A block's text, split on single `\n`s into hardBreak-joined inline runs.
 * Reached only for a paragraph and a blockquote's inner text: the only place a
 * hardBreak is ever emitted.
 */
function parseParagraph(text) {
  const content = []
  text.split('\n').forEach((line, i) => {
    if (i > 0) content.push({ type: 'hardBreak' })
    content.push(...parseInline(line))
  })
  return { type: 'paragraph', content }
}

// The inline pass is a hand-rolled left-to-right scan rather than one regex:
// honouring a `\x` escape is not something a single alternation can express —
// `[^\]]*` cannot be taught that `\]` is a literal, which is the bug that lost
// the link mark on `[a]b](http://x)` (LIN-1886 fix cycle 3). Leftmost position
// wins; at one position, link first, then DELIMITED_MARKS in order. It does not
// nest: a run carries at most one mark.

function parseInline(md) {
  const nodes = []
  let plainFrom = 0
  let i = 0
  while (i < md.length) {
    const construct = md[i] === '\\' ? null : constructAt(md, i)
    if (!construct) {
      i += md[i] === '\\' ? 2 : 1 // an escaped character never opens a construct
      continue
    }
    pushPlain(nodes, md.slice(plainFrom, i))
    nodes.push(construct.node)
    i = construct.end
    plainFrom = i
  }
  pushPlain(nodes, md.slice(plainFrom))
  return nodes
}

/** Contiguous literal text becomes a single node. */
function pushPlain(nodes, raw) {
  if (raw) nodes.push(textNode(INLINE_TEXT.unescape(raw)))
}

function textNode(text, mark) {
  return mark ? { type: 'text', text, marks: [mark] } : { type: 'text', text }
}

/** The construct starting at `i`, as `{node, end}`, or null. */
function constructAt(md, i) {
  if (md[i] === '[') return linkAt(md, i)
  for (const { type, delimiter, stopAt, text } of DELIMITED_MARKS) {
    if (!md.startsWith(delimiter, i)) continue
    const start = i + delimiter.length
    const close = findClose(md, delimiter, start, stopAt)
    // `close === start` is an empty run, rejected: `**` and `____` stay literal.
    if (close > start) {
      return { node: textNode(text.unescape(md.slice(start, close)), { type }), end: close + delimiter.length }
    }
  }
  return null
}

/** `[text](href)`; empty link text has always been allowed. */
function linkAt(md, i) {
  const textEnd = findClose(md, ']', i + 1)
  if (textEnd < 0 || md[textEnd + 1] !== '(') return null
  const hrefEnd = findClose(md, ')', textEnd + 2)
  if (hrefEnd < 0) return null
  const mark = { type: 'link', attrs: { href: HREF_TEXT.unescape(md.slice(textEnd + 2, hrefEnd)) } }
  return { node: textNode(INLINE_TEXT.unescape(md.slice(i + 1, textEnd)), mark), end: hrefEnd + 1 }
}

/**
 * Index of the next UNESCAPED `close` at or after `from`; -1 if there is none,
 * or if an unescaped `stopAt` character comes first. Only escaped occurrences
 * of `stopAt` stop counting.
 */
function findClose(md, close, from, stopAt) {
  for (let j = from; j < md.length; j += 1) {
    if (md[j] === '\\') {
      j += 1
      continue
    }
    if (md.startsWith(close, j)) return j
    if (md[j] === stopAt) return -1
  }
  return -1
}

// -----------------------------------------------------------------------------
// The write gate (LIN-1886, D1 policy).
// -----------------------------------------------------------------------------

/**
 * True if `doc` contains anything `markdownToAdf` cannot rebuild from
 * `adfToMarkdown(doc)`. Used to refuse (422) an in-app description overwrite
 * that would silently destroy Jira-native content — never to reject a READ:
 * `adfToMarkdown` still renders mentions, emoji and cards for display.
 *
 * The invariant this gate buys:
 *
 *     adfHasUnrenderableContent(doc) === false
 *       ⟹  markdownToAdf(adfToMarkdown(doc)) deep-equals doc,
 *           EXCEPT for the four enumerated classes below
 *
 * It is asserted in both directions (permitted ⟹ round-trips, refused ⟹
 * genuinely lossy) over hand-written fixtures and a generated adversarial
 * corpus in the codec's test file. That is evidence over a corpus, not a proof
 * over all ADF (LIN-1886 review F2): when you add a node type, a mark or an
 * escape, add it to the corpus too.
 *
 * The exceptions are ENUMERATED rather than papered over — an overclaiming
 * invariant is what let a real defect through three review cycles (John's
 * ruling d38d3755). Each is pinned by a fixture. 1-3 change no rendered
 * character; 4 drops a blank line, as a deliberate trade.
 *
 *   1. An empty, unmarked text run beside a marked one — LIN-1939, pre-existing
 *      and deliberately not fixed here. `[text '', em 'x']` renders `_x_` and
 *      reads back without the empty run: it slips the empty-run rule (which
 *      needs a mark) and the adjacent-plain-runs rule (which needs both
 *      neighbours unmarked). See LIN-1939 before relying on the invariant for a
 *      mark-adjacency case.
 *   2. An `orderedList`'s identity attrs, `{order: 1}` or a bare `{}` — ruling
 *      d38d3755. The writer emits no attrs, so the key is ABSENT after the
 *      round trip; the reader numbers from 1 regardless, so nothing visible
 *      changes. A non-identity `order` is refused: dropping THAT renumbers.
 *   3. A `localId` attrs key, on any node — LIN-2019. Jira's editor stamps it on
 *      virtually every node; it renders as nothing and is re-stamped on the
 *      next edit. It is ignored before the attrs check, so it is ABSENT after
 *      the round trip. Only this one key is allowlisted: `localId` plus any
 *      other unknown key still refuses, and an independently unrebuildable
 *      shape (a nested list, a multi-paragraph blockquote, a non-identity
 *      `order`) still refuses whatever its attrs.
 *   4. A top-level empty paragraph, mid-document or trailing — LIN-2019,
 *      genuinely lossy. `[p("one"), p(""), p("two")]` renders
 *      `"one\n\n\n\ntwo"` and reads back as `"one\n\ntwo"`, one node fewer; a
 *      trailing `[p("one"), p("")]` is dropped the same way. A LEADING one
 *      (`[p(""), p("one")]`) or one alone (`[p("")]`) is still refused, by the
 *      document-edge rule, which has no trailing-side equivalent. The trade is
 *      deliberate: refusing every description holding one of Jira's own blank
 *      lines is worse than dropping a blank line a reader is unlikely to notice.
 *
 * Everything else this gate permits deep-equals in the strict sense.
 *
 * Derived from the WRITER's vocabulary, not the reader's (LIN-1886 review
 * Blocker 3: deriving it from the reader let a 200-OK write flatten a
 * mention/emoji/smart-link description into one anonymous text run). Checked
 * recursively through the WHOLE tree, five things trip it:
 *   - a node type the writer never emits;
 *   - a permitted type in a shape the writer never emits;
 *   - attrs the writer cannot re-emit (LIN-1886 review F1 sub-class (b));
 *   - whitespace a `.trim()` on either side destroys — at a list item, a
 *     blockquote, a heading, or the document's own edges;
 *   - a text run with a mark outside the vocabulary, MORE THAN ONE mark, or a
 *     newline outside a fence or heading.
 *
 * NOT on the list, deliberately (LIN-1886 review F1, decision 599551c2):
 * Markdown-syntax collisions in ordinary prose. `- not a list`, `foo_bar_baz`
 * and ```` ```js ```` are escaped by the reader and round-trip faithfully.
 *
 * Like `adfToMarkdown`, only `doc.content` is inspected — the wrapper's `type`
 * is not, so a bare `{ content: [...] }` is treated like a `{ type: 'doc' }`.
 * @param {object|null|undefined} doc - an ADF document (or any ADF node)
 * @returns {boolean}
 */
export function adfHasUnrenderableContent(doc) {
  if (!isObject(doc)) return false
  return arrayOf(doc.content).some(node => unrebuildable(node, doc)) || edgesUnrebuildable(renderDocument(doc))
}

function unrebuildable(node, parent) {
  if (!isObject(node) || !attrsRebuildable(node) || shapeUnrebuildable(node, parent)) return true
  // A code block's shape rule has validated its single child in full; recursing
  // would trip the newline rule on legitimate multi-line code.
  return node.type !== 'codeBlock' && arrayOf(node.content).some(child => unrebuildable(child, node))
}

/**
 * The `attrs` markdownToAdf would re-emit for each node type. Every type not
 * listed must carry NO attrs: the writer emits none, so any stored attrs object
 * — even an empty one — cannot survive a write.
 */
function attrsRebuildable(node) {
  const attrs = withoutLocalId(node.attrs)
  switch (node.type) {
    // Always stamped, from the `#` run length — so `{level: 7}` (clamped) is not.
    case 'heading':
      return hasOnlyKeys(attrs, 'level') && Number.isInteger(attrs.level) && attrs.level >= 1 && attrs.level <= 6
    // Never stamped; exception 2 permits only the exact identity. `{order: 0}`
    // or `{order: -3}` would renumber a visibly 0-based list, so they are not
    // identity values. Modelling `order` instead would change what a
    // hand-authored `5. foo` means — out of scope (ruling d38d3755).
    case 'orderedList':
      return attrs === undefined || hasOnlyKeys(attrs) || (hasOnlyKeys(attrs, 'order') && attrs.order === 1)
    // Stamped only when the fence carries a language, read back through
    // `.trim()` — so a blank or space-padded language is lost.
    case 'codeBlock':
      return attrs === undefined || (hasOnlyKeys(attrs, 'language') && typeof attrs.language === 'string'
        && attrs.language !== '' && attrs.language === attrs.language.trim())
    default:
      return attrs === undefined
  }
}

/** Exception 3: `localId` is ignored before anything else; an attrs holding only it counts as none. */
function withoutLocalId(attrs) {
  if (!isObject(attrs) || !Object.hasOwn(attrs, 'localId')) return attrs
  const { localId, ...rest } = attrs
  return Object.keys(rest).length ? rest : undefined
}

function hasOnlyKeys(attrs, ...keys) {
  return isObject(attrs) && Object.keys(attrs).join() === keys.join()
}

/**
 * The node types markdownToAdf can emit, each in the one fixed shape it emits
 * it in; true = a stored node the writer would not rebuild. Keep this in
 * lockstep with parseBlock / parseParagraph / parseInline — never with the
 * reader's switch.
 */
function shapeUnrebuildable(node, parent) {
  switch (node.type) {
    case 'bulletList':
    case 'orderedList':
    case 'rule':
    case 'hardBreak':
      return false
    case 'paragraph': {
      // The reader ends each paragraph with "\n\n" and the writer splits blocks
      // on exactly that, so a blank line inside one TEARS IT IN TWO and an edge
      // newline merges into the separator. An empty paragraph is permitted
      // here: in a list item it is the rebuildable `- ` line of a multi-item
      // list, and at top level it is exception 4.
      const md = renderParagraph(node)
      return BLOCK_SPLIT.test(md) || md.startsWith('\n') || md.endsWith('\n') || hasAdjacentPlainRuns(node)
    }
    case 'heading': {
      // Read back with no line concept (so a hardBreak cannot come back) and
      // trimmed twice; an empty heading loses its `# ` marker; a blank line
      // splits the block, taking the `# ` with it.
      const md = renderAll(node.content)
      return !md || md !== md.trim() || BLOCK_SPLIT.test(md) || hasHardBreak(node) || hasAdjacentPlainRuns(node)
    }
    case 'listItem':
    case 'blockquote':
      return wrapperUnrebuildable(node)
    case 'codeBlock': {
      // The writer splits blocks on blank lines BEFORE it sees a fence, so a
      // blank line (or an empty body) tears the fence in two, and the reader
      // drops trailing newlines: rebuildable only as one non-empty, unmarked
      // text run with no blank line and no edge newline.
      const [run, ...rest] = arrayOf(node.content)
      const body = run?.type === 'text' && !arrayOf(run.marks).length && !rest.length ? textOf(run) : ''
      return !body || BLOCK_SPLIT.test(body) || body.startsWith('\n') || body.endsWith('\n')
    }
    case 'text':
      return textUnrebuildable(node, parent)
    default:
      return true // a node type the writer never emits
  }
}

/**
 * A listItem or blockquote: the writer builds each with exactly ONE paragraph
 * child. That is also what makes NESTED LISTS unrebuildable at any depth (a
 * nested list is a second child of its item) and what collapses a
 * multi-paragraph blockquote.
 */
function wrapperUnrebuildable(node) {
  const [paragraph, ...rest] = arrayOf(node.content)
  if (paragraph?.type !== 'paragraph' || rest.length) return true
  // The reader trims before prefixing `- ` / `> `, and the writer's greedy
  // `^-\s+` eats leading whitespace too: `"  padded  "` is destroyed.
  const md = renderParagraph(paragraph)
  if (md !== md.trim()) return true
  // A bare `- ` / `> ` line reads back as a paragraph with NO content, so an
  // empty item survives only when stored that way, not as an empty text run.
  if (md === '' && arrayOf(paragraph.content).length > 0) return true
  // A list item's text has no line concept: a hardBreak breaks its `- ` line,
  // and a block whose every line is not a bullet is no list at all. (A
  // blockquote's inner text is read back like a paragraph's, hardBreaks included.)
  return node.type === 'listItem' && hasHardBreak(paragraph)
}

function textUnrebuildable(node, parent) {
  const text = textOf(node)
  // parseParagraph turns every `\n` into a hardBreak, so a run carrying one
  // re-reads as several. A heading's text has no line concept and hands the
  // newline straight back (its own rule refuses a blank line or edge newline).
  if (text.includes('\n') && parent.type !== 'heading') return true
  const marks = arrayOf(node.marks)
  if (marks.length === 0) return false
  // Only ONE mark per run: the inline pass does not nest, so strong+em renders
  // `_**x**_` and re-reads as one em run of literal `**x**` (LIN-1886 review
  // Blocker 3).
  if (marks.length > 1) return true
  const [mark] = marks
  // A link's href rides the `](…)` slot, which is line-bounded.
  if (mark?.type === 'link') return String(mark.attrs?.href ?? '').includes('\n')
  // An empty run cannot carry a delimited mark home: `****`, `__`, `~~~~`
  // read back as literal text. (`[](href)` has always allowed empty link text.)
  return !DELIMITED_MARKS.some(({ type }) => type === mark?.type) || text === ''
}

function hasHardBreak(node) {
  return arrayOf(node.content).some(child => child?.type === 'hardBreak')
}

/**
 * Two adjacent UNMARKED runs render as one stretch of text and the writer reads
 * contiguous literal text back as one node, so the split is lost. Marked
 * neighbours are fine: their delimiters survive and re-split them.
 */
function hasAdjacentPlainRuns(node) {
  const isPlainRun = child => child?.type === 'text' && arrayOf(child.marks).length === 0
  return arrayOf(node.content).some((child, i, all) => i > 0 && isPlainRun(child) && isPlainRun(all[i - 1]))
}

/**
 * The document's OWN edges: `adfToMarkdown` ends with a `.trim()`, which no
 * per-node rule can see — every node can be rebuildable and the first block's
 * leading space still be eaten. The trailing side ignores the block-separating
 * newlines every block renders (structure, not content) and asks only about
 * what precedes them; that is why a trailing empty paragraph passes
 * (exception 4) and a leading one does not.
 */
function edgesUnrebuildable(raw) {
  const beforeSeparators = raw.replace(/\n+$/, '')
  return raw !== raw.trimStart() || beforeSeparators !== beforeSeparators.trimEnd()
}
