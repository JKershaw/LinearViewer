// =============================================================================
// Jira ADF (Atlassian Document Format) <-> Markdown codec (LIN-2399).
//
// Pure functions, no imports, and nothing here throws. The only consumer is
// lib/providers/jira/index.js, through the three exports:
//
//   adfToMarkdown(doc)              read: Jira's rich text → Markdown
//   markdownToAdf(markdown)         write: the inverse, over a smaller vocabulary
//   adfHasUnrenderableContent(doc)  the write gate: may this stored doc be
//                                   overwritten by a read-edit-write round trip?
//
// The three are halves of one round trip. An in-app description edit renders
// the stored ADF to Markdown, hands it to a human, and writes back whatever
// comes back through `markdownToAdf`. So:
//   - the reader ESCAPES everything the writer would read as markup;
//   - the writer honours exactly those escapes;
//   - the gate is derived from what the WRITER can rebuild, never from what the
//     reader can render (LIN-1886 review Blocker 3).
// =============================================================================

/** `markdownToAdf` splits a document into blocks on this, and on nothing else. See `BLANK_LINE`'s note in the writer section. */
const BLANK_LINE = /\n{2,}/

const children = node => (Array.isArray(node?.content) ? node.content : [])

// -----------------------------------------------------------------------------
// ADF → Markdown.
// -----------------------------------------------------------------------------
//
// Jira Cloud's `description`/comment `body` fields are ADF documents, not plain
// text or HTML. This is a deliberately MINIMAL renderer covering the node/mark
// types real Jira content actually uses — not a full ADF implementation.
// Unknown node types fall through to their child content (if any), so an
// unhandled node degrades to its text rather than vanishing.
//
// ESCAPING (LIN-1886 review F1, John's Option A). Any character sequence the
// writer reads as markup leaves here neutralised, or ordinary Jira prose is
// silently reinterpreted on save — `foo_bar_baz` growing an `em` mark, a
// paragraph beginning `- ` becoming a real `bulletList`, a paragraph reading
// ```` ```js ```` having its text deleted. Refusing such prose was rejected (it
// would 422 nearly every technical description); escaping it is the decision.
// The accepted cost: the raw textarea shows `foo\_bar\_baz`. Rendered Markdown
// is unaffected — a backslash before ASCII punctuation is a CommonMark escape,
// so `marked` (the dashboard renderer) prints the character, not the backslash.
//
// Escaping is UNCONDITIONAL, not "only where a construct would actually match":
// the conditional version has to reason about how escaping one position changes
// the parse of every later one. Escaping every metacharacter makes the argument
// trivial and total — after the pass every metacharacter is the second half of
// a `\x` pair, `parseInline` consumes both as one literal, and no construct can
// begin anywhere. Keep it that way.
// -----------------------------------------------------------------------------

/** Every character `parseInline` can OPEN a construct with, plus the escape itself. */
const escapeInline = text => text.replace(/[\\`*_~[]/g, '\\$&')

/**
 * Link text also escapes `]`, the one character that ENDS it there — an
 * unescaped `]` in `[a]b](http://x)` used to lose the link mark (LIN-1886 F1).
 */
const escapeLinkText = text => text.replace(/[\\`*_~[\]]/g, '\\$&')

/**
 * A `code` run is fenced by backticks and re-read as one opaque span, so only
 * the backtick and the escape can end it. Escaping `_`/`*` in there would be
 * pure noise in the textarea.
 */
const escapeCode = text => text.replace(/[\\`]/g, '\\$&')

/** Inside a link's href only an unescaped `)` ends it — the `(`-truncation bug (`.../Foo_(bar)`). */
const escapeHref = text => text.replace(/[\\)]/g, '\\$&')

/**
 * How each mark the round trip supports is written. Its keys are the mark
 * vocabulary for the whole codec: `parseInline` parses exactly these back and
 * the gate permits exactly these (never a second hand-copied list). Marks wrap
 * in array order, so `[strong, em]` renders `_**x**_`.
 */
const MARK_SYNTAX = {
  strong: text => `**${text}**`,
  em: text => `_${text}_`,
  code: text => `\`${text}\``,
  strike: text => `~~${text}~~`,
  link: (text, attrs) => `[${text}](${escapeHref(String(attrs?.href ?? ''))})`,
}

/** A text run, escaped for the context its marks put it in, then wrapped in them. */
function renderText(node) {
  const marks = Array.isArray(node.marks) ? node.marks : []
  const types = marks.map(mark => mark?.type)
  const escape = types.includes('code') ? escapeCode
    : types.includes('link') ? escapeLinkText
      : escapeInline
  return marks.reduce(
    (out, mark) => (Object.hasOwn(MARK_SYNTAX, mark?.type) ? MARK_SYNTAX[mark.type](out, mark.attrs) : out),
    escape(String(node.text ?? '')),
  )
}

// Block markers `parseBlock` recognises at the start of a line. The reader
// escapes a line that matches one, the writer parses a block that matches one;
// sharing the patterns is what keeps the two sides from drifting.
const RULE = /^-{3,}$/
const QUOTE_LINE = /^>\s/
const BULLET_LINE = /^-\s+/
const ORDERED_LINE = /^\d+\.\s+/
// `(\s|$)`, not `\s`: a line of nothing but hashes is a heading leader too.
// `parseBlock`'s `^(#{1,6})\s+` is matched against the whole BLOCK, and that
// `\s+` happily consumes the `\n` a hardBreak rendered — so an unescaped
// `"#\nrest"` would read back as `{heading, level: 1}` and the `#` line would
// be gone (LIN-1886 re-review R2).
const HEADING_LEADER = /^#{1,6}(\s|$)/

/**
 * Neutralise a LEADING token `parseBlock` reads as a block marker. Inline
 * escaping cannot reach these: `#`, `>`, `-` and `.` are only markup in first
 * position. Applied to every line of a rendered paragraph (`parseBlock` tests
 * the heading/rule forms against the block's first line and the
 * quote/bullet/ordered forms against every line; escaping every line covers
 * both). A fence needs no case: the inline pass has already escaped its
 * backticks, so ```` ```js ```` leaves as `` \`\`\`js ``.
 */
function escapeBlockLeader(line) {
  if (HEADING_LEADER.test(line) || RULE.test(line) || QUOTE_LINE.test(line) || BULLET_LINE.test(line)) {
    return `\\${line}`
  }
  // `1. x` → `1\. x`: the first `.` on the line is the marker's.
  return ORDERED_LINE.test(line) ? line.replace('.', '\\.') : line
}

const renderNodes = nodes => nodes.map(renderAdfNode).join('')

const renderParagraph = node => renderNodes(children(node)).split('\n').map(escapeBlockLeader).join('\n')

const headingLevel = node => Math.min(6, Math.max(1, Number(node.attrs?.level) || 1))

/** Each item is trimmed, then prefixed; ordered lists always number from 1, whatever `attrs.order` says. */
const renderList = (node, marker) => children(node)
  .map((item, k) => `${marker(k)} ${renderNodes(children(item)).trim()}`)
  .join('\n')

/**
 * A code BLOCK's body, verbatim. It sits between fences and `parseBlock` reads
 * it back with no inline pass at all, so escaping it would corrupt exactly the
 * content the fence exists to protect. Trailing newlines are dropped.
 */
const codeBody = node => children(node).map(run => String(run?.text ?? '')).join('').replace(/\n+$/, '')

/** Every block ends in `\n\n`; `adfToMarkdown`'s final `.trim()` removes the last one. */
function renderAdfNode(node) {
  const attrs = node?.attrs
  switch (node?.type) {
    case 'text': return renderText(node)
    case 'hardBreak': return '\n'
    case 'paragraph': return `${renderParagraph(node)}\n\n`
    case 'heading': return `${'#'.repeat(headingLevel(node))} ${renderNodes(children(node))}\n\n`
    case 'bulletList': return `${renderList(node, () => '-')}\n\n`
    case 'orderedList': return `${renderList(node, k => `${k + 1}.`)}\n\n`
    case 'codeBlock': return `\`\`\`${attrs?.language ?? ''}\n${codeBody(node)}\n\`\`\`\n\n`
    case 'blockquote': {
      const lines = renderNodes(children(node)).trim().split('\n')
      return `${lines.map(line => `> ${line}`).join('\n')}\n\n`
    }
    case 'rule': return '---\n\n'
    // Read-only types: rendered for display, but the writer has no inverse,
    // so the gate refuses to overwrite them.
    case 'mention': return attrs?.text || `@${attrs?.id ?? ''}`
    case 'emoji': return attrs?.text || attrs?.shortName || ''
    case 'inlineCard': return attrs?.url ?? ''
    case 'blockCard': return `${attrs?.url ?? ''}\n\n`
    default: return renderNodes(children(node))
  }
}

/**
 * Convert an ADF document (Jira's rich-text wire shape) to Markdown.
 * @param {{type?: string, content?: Array}|null|undefined} doc
 * @returns {string}
 */
export function adfToMarkdown(doc) {
  if (!doc || typeof doc !== 'object') return ''
  return renderNodes(children(doc)).trim()
}

// -----------------------------------------------------------------------------
// Markdown → ADF (LIN-1886) — the write-direction inverse of `adfToMarkdown`.
// Its vocabulary is a STRICT SUBSET of the reader's: paragraphs, headings,
// bullet/ordered lists, code blocks, blockquotes, rules, hard breaks and the
// `MARK_SYNTAX` marks — but NOT mention/emoji/inlineCard/blockCard, which the
// reader renders and this direction has no inverse for.
//
// Anything else in the input degrades to plain text; this never throws.
// Refusing unrenderable content is `adfHasUnrenderableContent`'s job, applied
// to the STORED ADF being overwritten, not to freshly-authored Markdown.
// -----------------------------------------------------------------------------

const ASCII_PUNCTUATION = /[!-/:-@[-`{-~]/

/**
 * CommonMark's escape rule: a backslash escapes ASCII punctuation and nothing
 * else. This is what keeps a hand-typed `C:\Users\me` or a regex's `\d`
 * intact — only `\` + punctuation is consumed, so the codec round-trips its own
 * escapes without eating a user's literal backslashes.
 */
const isEscapePair = (text, i) => text[i] === '\\' && i + 1 < text.length && ASCII_PUNCTUATION.test(text[i + 1])

const unescapeInline = text => text.replace(/\\([!-/:-@[-`{-~])/g, '$1')
// A code span and an href were escaped with a narrower set on the way out, so
// they are unescaped with the matching narrower set, or this would eat
// backslashes the writer never put there.
const unescapeCode = text => text.replace(/\\([\\`])/g, '$1')
const unescapeHref = text => text.replace(/\\([\\)])/g, '$1')

/**
 * Index of the next UNESCAPED `close` at or after `from`; `-1` if there is
 * none, or if an unescaped `stopAt` character comes first. `stopAt` keeps the
 * old single-regex classes (`[^*]+`, `[^~]+`): a lone `*` inside `**…**` still
 * means "this is not a strong run".
 */
function findClose(text, from, close, stopAt) {
  for (let j = from; j < text.length; j += 1) {
    if (isEscapePair(text, j)) j += 1
    else if (text.startsWith(close, j)) return j
    else if (text[j] === stopAt) return -1
  }
  return -1
}

/**
 * `[delimiter, markType, unescape]`; a run may not contain an unescaped
 * delimiter character. At one position the first entry that matches wins, so
 * `**` is tried before `*`. `__x__` and `*x*` are not what the reader writes,
 * but hand-typed Markdown uses them.
 */
const DELIMITED_RUNS = [
  ['**', 'strong', unescapeInline],
  ['__', 'strong', unescapeInline],
  ['`', 'code', unescapeCode],
  ['~~', 'strike', unescapeInline],
  ['*', 'em', unescapeInline],
  ['_', 'em', unescapeInline],
]

/** A link `[text](href)` starting at `i`, or null. Empty text and an empty href are both a link. */
function linkAt(text, i) {
  if (text[i] !== '[') return null
  const textEnd = findClose(text, i + 1, ']')
  if (textEnd === -1 || text[textEnd + 1] !== '(') return null
  const hrefEnd = findClose(text, textEnd + 2, ')')
  if (hrefEnd === -1) return null
  const href = unescapeHref(text.slice(textEnd + 2, hrefEnd))
  return {
    node: { type: 'text', text: unescapeInline(text.slice(i + 1, textEnd)), marks: [{ type: 'link', attrs: { href } }] },
    end: hrefEnd + 1,
  }
}

/** The marked run starting at `i`, or null. A link is tried first, so its text is captured whole. */
function markedRunAt(text, i) {
  const link = linkAt(text, i)
  if (link) return link
  for (const [delim, type, unescape] of DELIMITED_RUNS) {
    if (!text.startsWith(delim, i)) continue
    const start = i + delim.length
    const close = findClose(text, start, delim, delim[0])
    // `close === start` is an empty run, which stays literal: `**`, `____`, `~~~~`.
    if (close > start) {
      return { node: { type: 'text', text: unescape(text.slice(start, close)), marks: [{ type }] }, end: close + delim.length }
    }
  }
  return null
}

/**
 * One line (or a heading's whole text) → inline nodes, by a left-to-right scan:
 * leftmost construct wins and runs do not nest. Contiguous literal text
 * becomes ONE text node. An empty string is one empty text run — what the
 * reader renders an empty list item (`- `) from.
 */
function parseInline(text) {
  const nodes = []
  let literalStart = 0
  const flushLiteral = end => {
    if (end > literalStart) nodes.push({ type: 'text', text: unescapeInline(text.slice(literalStart, end)) })
  }
  let i = 0
  while (i < text.length) {
    if (isEscapePair(text, i)) {
      i += 2
      continue
    }
    const run = markedRunAt(text, i)
    if (!run) {
      i += 1
      continue
    }
    flushLiteral(i)
    nodes.push(run.node)
    i = literalStart = run.end
  }
  flushLiteral(text.length)
  return nodes.length ? nodes : [{ type: 'text', text: '' }]
}

/**
 * A block's text, split on single `\n`s into `hardBreak`-joined inline runs.
 * The ONLY emitter of `hardBreak`, reached only for a paragraph and a
 * blockquote's inner text.
 */
const parseLines = text => text.split('\n').flatMap((line, k) => (
  k === 0 ? parseInline(line) : [{ type: 'hardBreak' }, ...parseInline(line)]
))

const paragraph = content => ({ type: 'paragraph', content })

const list = (type, lines, marker) => ({
  type,
  content: lines.map(line => ({ type: 'listItem', content: [paragraph(parseInline(line.replace(marker, '')))] })),
})

const FENCE = /^```(.*)\n([\s\S]*)\n```$/
const HEADING = /^(#{1,6})\s+([\s\S]*)$/

/** One blank-line-delimited Markdown block → one ADF block node. */
function parseBlock(block) {
  const fence = FENCE.exec(block)
  if (fence) {
    // `{language}` only when the fence carries one, read back through `.trim()`.
    const language = fence[1].trim()
    return { type: 'codeBlock', ...(language ? { attrs: { language } } : {}), content: [{ type: 'text', text: fence[2] }] }
  }
  const heading = HEADING.exec(block)
  if (heading) {
    // Bare `parseInline`: a heading has no line concept, so a `\n` in it stays text.
    return { type: 'heading', attrs: { level: heading[1].length }, content: parseInline(heading[2].trim()) }
  }
  if (RULE.test(block)) return { type: 'rule' }
  const lines = block.split('\n')
  if (lines.every(line => QUOTE_LINE.test(line))) {
    return { type: 'blockquote', content: [paragraph(parseLines(lines.map(line => line.replace(QUOTE_LINE, '')).join('\n')))] }
  }
  if (lines.every(line => BULLET_LINE.test(line))) return list('bulletList', lines, BULLET_LINE)
  if (lines.every(line => ORDERED_LINE.test(line))) return list('orderedList', lines, ORDERED_LINE)
  return paragraph(parseLines(block))
}

// `BLANK_LINE` (top of file) is what this splits blocks on — TWO LITERAL
// NEWLINES, nothing else. The gate's shape rules test the same constant
// against a rendered body, so the two cannot drift: a rule that refused a
// "blank" line the split does not actually break on (`"\n \n"`, very common in
// pasted code) would refuse content that round-trips perfectly (R3.1).

/**
 * Convert Markdown to an ADF document — the write-direction inverse of
 * `adfToMarkdown`. Unsupported Markdown degrades to a plain paragraph of text
 * rather than throwing. The gate's node set and shape rules are derived from
 * THIS function, so it can never itself manufacture something the gate flags.
 * @param {string|null|undefined} markdown
 * @returns {{type: 'doc', version: 1, content: Array}}
 */
export function markdownToAdf(markdown) {
  const text = typeof markdown === 'string' ? markdown : ''
  if (!text.trim()) return { type: 'doc', version: 1, content: [] }
  const blocks = text.replace(/^\n+|\n+$/g, '').split(BLANK_LINE)
  return { type: 'doc', version: 1, content: blocks.map(parseBlock) }
}

// -----------------------------------------------------------------------------
// The write gate (LIN-1886, D1 policy) — a pure recursive walk over an ADF tree.
//
// DERIVED FROM THE WRITER, NOT THE READER (LIN-1886 review Blocker 3). A write
// is read-then-rewrite, so the property it needs is
//
//     markdownToAdf(adfToMarkdown(doc)) deep-equals doc
//
// and that does NOT hold across the reader's vocabulary: `mention`, `emoji`,
// `inlineCard` and `blockCard` render fine but have no Markdown→ADF inverse,
// so a reader-derived gate let an @-mention or smart link be flattened into an
// anonymous text run by a 200-OK write. Keep this list in lockstep with what
// `parseBlock`/`parseLines`/`parseInline` can EMIT, never with `renderAdfNode`.
// -----------------------------------------------------------------------------

const WRITER_NODE_TYPES = new Set([
  'paragraph', 'heading', 'bulletList', 'orderedList', 'listItem',
  'codeBlock', 'blockquote', 'rule', 'hardBreak', 'text',
])

const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const hasExactKeys = (attrs, keys) => isPlainObject(attrs)
  && Object.keys(attrs).length === keys.length
  && keys.every(key => Object.hasOwn(attrs, key))

/**
 * The `attrs` each node type may carry because `markdownToAdf` re-emits them
 * (LIN-1886 review F1 sub-class (b)). Any other type must carry NO `attrs` at
 * all — not even `{}` — because the writer emits none for it.
 */
const WRITER_EMITTED_ATTRS = {
  // Always stamped as `{level}` from the `#` run, so only an integer 1-6
  // survives (the review's `{level: 7}` is clamped to 6).
  heading: attrs => hasExactKeys(attrs, ['level']) && Number.isInteger(attrs.level) && attrs.level >= 1 && attrs.level <= 6,
  // Stamped `{language}` only when the fence carries one, read back through
  // `.trim()` — so a blank or space-padded language is lost.
  codeBlock: attrs => attrs === undefined
    || (hasExactKeys(attrs, ['language']) && typeof attrs.language === 'string'
      && attrs.language !== '' && attrs.language === attrs.language.trim()),
  // The writer emits NO attrs here and the reader numbers every list from 1,
  // so the identity `{order: 1}` (or a bare `{}`) is dropped without changing
  // a rendered character — permitted, per John's ruling `d38d3755` ("the
  // identity value is harmless"); invariant exception 2 below. Only the exact
  // integer 1: `{order: 0}`/`{order: -3}` would visibly renumber a list, and a
  // non-identity order stays refused "UNTIL THE WRITER MODELS THE ATTRIBUTE"
  // (out of scope: it would change what a hand-typed `5. foo` means).
  orderedList: attrs => attrs === undefined || hasExactKeys(attrs, []) || (hasExactKeys(attrs, ['order']) && attrs.order === 1),
}

/**
 * Attrs keys that render as nothing and are ignored before any attrs check
 * (LIN-2019, invariant exception 3). Jira's own editor stamps `localId` on
 * virtually every node and re-stamps it on the next edit regardless of what
 * Harbour stores. Fail-closed by construction: an explicit allowlist of one
 * key, so any OTHER unknown key still refuses.
 */
const PRESENTATION_NEUTRAL_ATTRS = ['localId']

function storedAttrs(node) {
  const { attrs } = node
  if (!isPlainObject(attrs) || !PRESENTATION_NEUTRAL_ATTRS.some(key => Object.hasOwn(attrs, key))) return attrs
  const rest = Object.fromEntries(Object.entries(attrs).filter(([key]) => !PRESENTATION_NEUTRAL_ATTRS.includes(key)))
  // An attrs object that held nothing else counts as absent, as it will be after the write.
  return Object.keys(rest).length ? rest : undefined
}

function attrsUnrebuildable(node) {
  const attrs = storedAttrs(node)
  const permitted = WRITER_EMITTED_ATTRS[node.type]
  return permitted ? !permitted(attrs) : attrs !== undefined
}

/** The inline Markdown of a container's single paragraph child, or null if it does not hold exactly one paragraph. */
function soleParagraphMarkdown(node) {
  const content = children(node)
  return content.length === 1 && content[0]?.type === 'paragraph' ? renderParagraph(content[0]) : null
}

/**
 * The STRUCTURAL half of the derivation (Blocker 3): `markdownToAdf` builds
 * each container in exactly one shape, so a permitted type in a shape the
 * writer never emits is as unrebuildable as an unmodeled type. Several sides
 * of the round trip `.trim()` a container's rendered text, so edge whitespace
 * in the STORED text is destroyed even when every node type is rebuildable.
 *
 * `true` = the writer cannot rebuild this node, so a write must refuse.
 */
const SHAPE_UNREBUILDABLE = {
  // Content goes through bare `parseInline`, which has no line concept: a
  // hardBreak comes back as a literal `\n` in the text. The text is trimmed on
  // the way back (`^(#{1,6})\s+`, then `.trim()`); an empty heading loses its
  // `# ` marker and re-reads as a paragraph; a blank line splits the block.
  heading(node) {
    const md = renderNodes(children(node))
    return children(node).some(child => child?.type === 'hardBreak')
      || md === '' || md !== md.trim() || BLANK_LINE.test(md)
  },
  // Blocks are split on blank lines, so a paragraph whose text carries one is
  // TORN IN TWO, and a leading/trailing newline is lost to the split.
  //
  // A paragraph that renders to NOTHING is permitted anywhere: in a list item
  // it is the rebuildable `- ` line; at top level it is invariant exception 4
  // (LIN-2019), a deliberately accepted loss of one blank line. A LEADING
  // top-level empty paragraph is still refused, by the document-edge rule.
  paragraph(node) {
    const md = renderNodes(children(node))
    return BLANK_LINE.test(md) || md.startsWith('\n') || md.endsWith('\n')
  },
  // Always rebuilt as exactly one paragraph, trimmed before each line gets `> `.
  // Two paragraphs would collapse into one; a codeBlock or heading child would
  // lose its block type.
  blockquote(node) {
    const md = soleParagraphMarkdown(node)
    return md === null || md !== md.trim()
  },
  // Always rebuilt as exactly one paragraph — which is also what makes NESTED
  // LISTS unrebuildable at any depth (the nested list is a second child). A
  // line break would split the `- ` line so the list no longer parses, and
  // the item is trimmed out and its marker stripped greedily on the way back
  // (`"  padded  "`, LIN-1886 review F1 sub-class (b)).
  listItem(node) {
    const md = soleParagraphMarkdown(node)
    return md === null || md.includes('\n') || md !== md.trim()
  },
  // Blocks are split BEFORE a fence is seen, so a body with a blank line (or an
  // empty body) is torn apart; the reader also drops trailing newlines. Only a
  // single plain, non-empty run with no blank line and no edge newline survives.
  codeBlock(node) {
    const [run, ...rest] = children(node)
    if (rest.length > 0 || run?.type !== 'text' || run.marks?.length || attrsUnrebuildable(run)) return true
    const text = String(run.text ?? '')
    return text === '' || BLANK_LINE.test(text) || text.startsWith('\n') || text.endsWith('\n')
  },
}

function textUnrebuildable(node, parent) {
  const marks = Array.isArray(node.marks) ? node.marks : []
  const [mark] = marks
  const text = String(node.text ?? '')
  // The inline scan does not nest, so `[strong, em]` renders `_**x**_` and
  // re-parses as ONE em run whose text is `**x**` (Blocker 3).
  if (marks.length > 1) return true
  if (mark && !Object.hasOwn(MARK_SYNTAX, mark?.type)) return true
  // An empty run cannot carry a mark home (`**`, `__`, `~~~~` stay literal);
  // a link is the exception, `[](href)` is a link.
  if (mark && text === '' && mark.type !== 'link') return true
  // An href rides the line-bounded `](…)` slot.
  if (mark?.type === 'link' && String(mark.attrs?.href ?? '').includes('\n')) return true
  // `parseLines` turns every `\n` into a hardBreak. A heading's text is the
  // exception: bare `parseInline` hands the newline straight back.
  return text.includes('\n') && parent?.type !== 'heading'
}

const isUnmarkedText = node => node?.type === 'text' && !node.marks?.length

/**
 * Two adjacent UNMARKED runs render as one stretch of text and `parseInline`
 * makes contiguous literal text one node, so the split is not recoverable.
 * Adjacent MARKED runs are fine: their delimiters re-split them.
 */
const hasAdjacentUnmarkedText = content => content.some((node, k) => k > 0 && isUnmarkedText(node) && isUnmarkedText(content[k - 1]))

function isUnrebuildable(node, parent) {
  if (!WRITER_NODE_TYPES.has(node?.type)) return true
  if (attrsUnrebuildable(node)) return true
  if (SHAPE_UNREBUILDABLE[node.type]?.(node)) return true
  if (node.type === 'text') return textUnrebuildable(node, parent)
  // The one place a `\n`-bearing run IS rebuildable (fenced, read back
  // verbatim); its shape rule has validated the single child in full.
  if (node.type === 'codeBlock') return false
  const content = children(node)
  return hasAdjacentUnmarkedText(content) || content.some(child => isUnrebuildable(child, node))
}

/**
 * The document's OWN edges. `adfToMarkdown` finishes with a `.trim()`, which no
 * per-node rule can see. The trailing side ignores the block-separating
 * newlines every block emits — structure, not content — and asks only about
 * what precedes them. So a TRAILING empty paragraph is permitted (exception 4)
 * while a LEADING one, or a doc that is one empty paragraph, is refused.
 */
function breaksDocumentEdges(content) {
  const raw = renderNodes(content)
  const body = raw.replace(/\n+$/, '')
  return raw !== raw.trimStart() || body !== body.trimEnd()
}

/**
 * True if `doc` contains anything `markdownToAdf` cannot reconstruct from
 * `adfToMarkdown(doc)`. Used to refuse (422) an in-app description overwrite
 * that would silently destroy Jira-native content — never to reject a READ.
 * The invariant it buys:
 *
 *     adfHasUnrenderableContent(doc) === false
 *       ⟹  markdownToAdf(adfToMarkdown(doc)) deep-equals doc,
 *           EXCEPT for the four enumerated classes below
 *
 * This is evidence, not proof: it is asserted in both directions (permitted ⟹
 * round-trips, refused ⟹ genuinely lossy) over hand-written fixtures and a
 * generated cross-product of an adversarial text corpus against every
 * structural slot in tests/unit/jira-provider-adf-codec.test.js (LIN-1886
 * review F2). When you add a node type, a mark or an escape, add it to that
 * corpus too.
 *
 * The exceptions are named rather than claimed away (LIN-1886, John's ruling
 * `d38d3755`), and each is pinned by a fixture. 1-3 change no rendered
 * character; 4 does.
 *
 *   1. An empty, unmarked text run — LIN-1939, pre-existing, deliberately not
 *      fixed here. It slips both run rules (the empty-run rule needs a mark,
 *      the adjacent-unmarked rule needs both neighbours unmarked):
 *      `[text(''), text('x', em)]` renders `_x_` and re-reads without the
 *      empty run.
 *   2. An `orderedList`'s identity `attrs` — `{order: 1}` or `{}`. The writer
 *      emits no `attrs` key, so the key is ABSENT after the round trip. A
 *      non-identity `order` is still refused: dropping it renumbers the list.
 *   3. A `localId` attrs key on any node — LIN-2019. Absent after the round
 *      trip. Only this key is ignored, and only by the attrs check: a node
 *      with `localId` plus another unknown key, or in an unrebuildable shape,
 *      still refuses.
 *   4. A top-level empty paragraph, mid-document or trailing — LIN-2019,
 *      GENUINELY LOSSY: its blank line is dropped on write
 *      (`"one\n\n\n\ntwo"` reads back as `"one\n\ntwo"`). Refusing every
 *      description with one of Jira's editor's blank lines was judged worse.
 *      A LEADING empty paragraph, or a doc that is only one, is still refused
 *      by the document-edge rule.
 *
 * Everything else this gate permits deep-equals in the strict sense.
 *
 * Checked recursively through the WHOLE tree, five things trip it:
 *   - a node `type` outside `WRITER_NODE_TYPES`;
 *   - a permitted type in a shape the writer never emits (`SHAPE_UNREBUILDABLE`);
 *   - `attrs` the writer cannot re-emit (`WRITER_EMITTED_ATTRS`);
 *   - whitespace a `.trim()` on either side destroys — at a list item, a
 *     blockquote, a heading, or the document's own edges;
 *   - a text run with a mark outside `MARK_SYNTAX`, more than one mark, or a
 *     newline outside a fence or heading.
 *
 * NOT on this list, deliberately (LIN-1886 review F1, decision `599551c2`):
 * Markdown-syntax collisions in prose. `- not a list`, `foo_bar_baz` or
 * ```` ```js ```` are escaped by `adfToMarkdown` and round-trip faithfully.
 *
 * Like `adfToMarkdown`, the wrapper's own `type` is never validated, only its
 * `content`, so a bare `{ content: [...] }` is inspected like a real doc.
 * @param {object|null|undefined} doc - an ADF document (or any ADF node)
 * @returns {boolean}
 */
export function adfHasUnrenderableContent(doc) {
  if (!isPlainObject(doc)) return false
  const content = children(doc)
  return breaksDocumentEdges(content) || content.some(node => isUnrebuildable(node, doc))
}
