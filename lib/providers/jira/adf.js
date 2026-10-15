// =============================================================================
// Jira ADF (Atlassian Document Format) <-> Markdown codec (LIN-2399: extracted
// from lib/providers/jira/index.js). Pure functions, no imports; reached by
// index.js through the three exports below and by nothing else. This module
// throws nothing deliberately.
//
// Three parts, in dependency order:
//   1. Reader  — adfToMarkdown          (ADF → Markdown)
//   2. Writer  — markdownToAdf          (Markdown → ADF, a strict subset inverse)
//   3. Gate    — adfHasUnrenderableContent (derived from the WRITER, calls the reader)
// =============================================================================

// -----------------------------------------------------------------------------
// 1. Reader: ADF → Markdown.
//
// Jira Cloud's `description`/comment `body` fields are ADF documents. This is a
// deliberately MINIMAL renderer covering the node/mark types real Jira content
// uses. Unknown node types fall through to their child content (if any), so an
// unhandled node degrades to its text rather than vanishing.
//
// ESCAPING IS UNCONDITIONAL (LIN-1886 review F1, John's Option A). The read path
// is half of a round trip: an in-app edit renders stored ADF to Markdown and
// writes whatever comes back through `markdownToAdf`. Any sequence the writer
// reads as markup must leave here neutralised, or ordinary prose is silently
// reinterpreted on save (`foo_bar_baz` growing an `em`, `- x` becoming a list).
// Refusing such prose was rejected (it would 422 nearly every technical
// description); escaping is the decision, and its cost — `foo\_bar\_baz` in the
// raw textarea — is accepted. Rendered Markdown is unaffected (a backslash
// before ASCII punctuation is CommonMark).
//
// Unconditional rather than "only where a construct would match": after the
// pass every metacharacter is the second half of a `\x` pair, `parseInline`
// consumes both as one literal, and no construct can begin anywhere. The
// argument is trivial and total; keep it that way.
// -----------------------------------------------------------------------------

const escaper = pattern => text => String(text).replace(pattern, c => `\\${c}`)

/** Every character `parseInline` can OPEN a construct with, plus the escape itself. */
const escapeInlineText = escaper(/[\\`*_~[\]]/g)
/** Inside a `code` mark only the fence character and the escape can end the run. */
const escapeCodeText = escaper(/[\\`]/g)
/** Inside a link's href only an unescaped `)` ends it. */
const escapeHref = escaper(/[\\()]/g)

/**
 * Neutralise a LEADING token `parseBlock` reads as a block marker — inline
 * escaping cannot reach these (`#`, `>`, `-`, `.` are markup only in first
 * position). Applied per line of a rendered paragraph. The order of checks is
 * semantic. A fence needs no case: the inline pass already escaped its backticks.
 */
function escapeBlockLeader(line) {
  // `(\s|$)`: `parseBlock`'s `^(#{1,6})\s+` runs over the whole block and its
  // `\s+` can consume a hardBreak's `\n`, so a line of bare hashes is a leader.
  if (/^#{1,6}(\s|$)/.test(line)) return `\\${line}`
  if (/^>\s/.test(line)) return `\\${line}`
  if (/^-\s/.test(line)) return `\\${line}`
  if (/^\s*-{3,}\s*$/.test(line)) return line.replace('-', '\\-')
  const ordered = line.match(/^\d+\.\s/)
  if (ordered) {
    const digits = ordered[0].length - 2
    return `${line.slice(0, digits)}\\.${line.slice(digits + 1)}`
  }
  return line
}

const MARK_RENDERERS = {
  strong: text => `**${text}**`,
  em: text => `_${text}_`,
  code: text => `\`${text}\``,
  strike: text => `~~${text}~~`,
  link: (text, mark) => `[${text}](${escapeHref(mark?.attrs?.href || '')})`,
}

function renderMarks(text, marks) {
  return (marks || []).reduce((out, mark) => {
    const render = MARK_RENDERERS[mark.type]
    return render ? render(out, mark) : out
  }, text)
}

/**
 * A `code` run is fenced by backticks and re-read as one opaque span, so only
 * the backtick and the escape need neutralising there; everything else takes
 * the full inline set.
 */
function renderTextNode(node) {
  const marks = node.marks || []
  const escape = marks.some(m => m?.type === 'code') ? escapeCodeText : escapeInlineText
  return renderMarks(escape(node.text || ''), marks)
}

/** A code BLOCK's body, verbatim: `parseBlock` reads it back with no inline pass. */
function renderCodeBlockText(nodes) {
  return (nodes || []).map(n => (n?.type === 'text' ? (n.text || '') : renderAdfNode(n))).join('')
}

function renderAdfNodes(nodes) {
  return (nodes || []).map(renderAdfNode).join('')
}

function renderAdfNode(node) {
  if (!node || typeof node !== 'object') return ''
  switch (node.type) {
    case 'text':
      return renderTextNode(node)
    case 'paragraph':
      return `${renderAdfNodes(node.content).split('\n').map(escapeBlockLeader).join('\n')}\n\n`
    case 'heading': {
      const level = Math.min(Math.max(node.attrs?.level || 1, 1), 6)
      return `${'#'.repeat(level)} ${renderAdfNodes(node.content)}\n\n`
    }
    case 'bulletList':
      return `${(node.content || []).map(li => `- ${renderAdfNodes(li.content).trim()}\n`).join('')}\n`
    case 'orderedList':
      return `${(node.content || []).map((li, i) => `${i + 1}. ${renderAdfNodes(li.content).trim()}\n`).join('')}\n`
    case 'codeBlock': {
      const lang = node.attrs?.language || ''
      const code = renderCodeBlockText(node.content).replace(/\n+$/, '')
      return `\`\`\`${lang}\n${code}\n\`\`\`\n\n`
    }
    case 'blockquote':
      return `${renderAdfNodes(node.content).trim().split('\n').map(l => `> ${l}`).join('\n')}\n\n`
    case 'rule':
      return '---\n\n'
    case 'hardBreak':
      return '\n'
    case 'mention':
      return node.attrs?.text || `@${node.attrs?.id || 'user'}`
    case 'inlineCard':
    case 'blockCard':
      return node.attrs?.url || ''
    case 'emoji':
      return node.attrs?.text || node.attrs?.shortName || ''
    default:
      return node.content ? renderAdfNodes(node.content) : ''
  }
}

/**
 * Convert an ADF document (Jira's rich-text wire shape) to Markdown.
 * @param {{type?: string, content?: Array}|null|undefined} doc
 * @returns {string}
 */
export function adfToMarkdown(doc) {
  if (!doc || typeof doc !== 'object') return ''
  return renderAdfNodes(doc.content).trim()
}

// -----------------------------------------------------------------------------
// 2. Writer: Markdown → ADF (LIN-1886, Phase 2) — the inverse of the reader.
//
// Its vocabulary is a STRICT SUBSET of the reader's: paragraphs, headings,
// bullet/ordered lists, code blocks, blockquotes, hr, hard breaks, and the
// strong/em/code/strike/link marks — NOT mention/emoji/inlineCard/blockCard,
// which have no inverse. That asymmetry is why the write gate is derived from
// THIS side (LIN-1886 review Blocker 3).
//
// The reader/writer correspondence is pinned by the ADF → Markdown → ADF
// property test (tests/unit/jira-provider.test.js) over a fixture list and a
// ~1000-document generated adversarial corpus. That is evidence over a corpus,
// not a proof over all ADF: when you add a node type, a mark or an escape, add
// it to the corpus too.
//
// Unsupported Markdown degrades to plain text; this function never throws.
//
// The inline pass is a hand-rolled left-to-right scan, not one regex: honouring
// a `\x` escape is not something a non-backtracking alternation can express
// (`[^\]]*` cannot be taught that `\]` is literal). Link is tried before
// strong/code/strike/em, so a link whose text holds another marker is captured
// whole; leftmost position wins, and at the same position that order is the
// tiebreak. The vocabulary mirrors MARK_RENDERERS exactly.
// -----------------------------------------------------------------------------

/**
 * CommonMark's escape rule: a backslash escapes ASCII punctuation and nothing
 * else, so a hand-typed `C:\Users\me` or a regex `\d` survives intact.
 */
const ASCII_PUNCTUATION = /[!-/:-@[-`{-~]/

const isEscapeAt = (text, i) => text[i] === '\\' && i + 1 < text.length && ASCII_PUNCTUATION.test(text[i + 1])

function unescapeInline(text) {
  let out = ''
  for (let i = 0; i < text.length; i += 1) {
    if (isEscapeAt(text, i)) { out += text[i + 1]; i += 1 } else out += text[i]
  }
  return out
}

// A code span and an href were escaped with a narrower set on the way out, so
// they unescape with the matching narrower set — not `unescapeInline` — or the
// pass would eat backslashes the reader never put there.
const unescapeCode = text => text.replace(/\\([\\`])/g, '$1')
const unescapeHref = text => text.replace(/\\([\\()])/g, '$1')

/**
 * Index of the next UNESCAPED `close` at or after `from`; `-1` if there is none,
 * or if an unescaped `stopAt` character is reached first (a lone `*` inside
 * `**…**` means "not a strong run").
 */
function scanForClose(text, from, close, stopAt) {
  for (let i = from; i < text.length; i += 1) {
    if (text[i] === '\\') { i += 1; continue }
    if (text.startsWith(close, i)) return i
    if (stopAt && text[i] === stopAt) return -1
  }
  return -1
}

/** `[delimiter, markType, forbidden-inside, how to unescape the content]`. */
const PAIRED_INLINE_MARKS = [
  ['**', 'strong', '*', unescapeInline],
  ['`', 'code', null, unescapeCode],
  ['~~', 'strike', '~', unescapeInline],
  ['_', 'em', null, unescapeInline],
]

/** The construct starting at `i`, or null. */
function matchInlineConstruct(text, i) {
  if (text[i] === '[') {
    const textEnd = scanForClose(text, i + 1, ']', null)
    if (textEnd === -1 || text[textEnd + 1] !== '(') return null
    const hrefEnd = scanForClose(text, textEnd + 2, ')', null)
    if (hrefEnd === -1) return null
    return {
      end: hrefEnd + 1,
      node: {
        type: 'text',
        text: unescapeInline(text.slice(i + 1, textEnd)),
        marks: [{ type: 'link', attrs: { href: unescapeHref(text.slice(textEnd + 2, hrefEnd)) } }],
      },
    }
  }
  for (const [delim, markType, stopAt, unescape] of PAIRED_INLINE_MARKS) {
    if (!text.startsWith(delim, i)) continue
    const close = scanForClose(text, i + delim.length, delim, stopAt)
    // An empty run (`**`, `____`) stays literal.
    if (close === -1 || close === i + delim.length) continue
    return {
      end: close + delim.length,
      node: { type: 'text', text: unescape(text.slice(i + delim.length, close)), marks: [{ type: markType }] },
    }
  }
  return null
}

function parseInline(text) {
  const nodes = []
  let literal = ''
  const flush = () => { if (literal !== '') { nodes.push({ type: 'text', text: literal }); literal = '' } }
  let i = 0
  while (i < text.length) {
    if (isEscapeAt(text, i)) { literal += text[i + 1]; i += 2; continue }
    const match = matchInlineConstruct(text, i)
    if (match) { flush(); nodes.push(match.node); i = match.end; continue }
    literal += text[i]
    i += 1
  }
  flush()
  if (nodes.length === 0) nodes.push({ type: 'text', text: '' })
  return nodes
}

/** A block's text, split on single `\n`s into `hardBreak`-joined inline runs. */
function parseParagraphContent(blockText) {
  const content = []
  blockText.split('\n').forEach((line, i) => {
    if (i > 0) content.push({ type: 'hardBreak' })
    content.push(...parseInline(line))
  })
  return content
}

/** A list whose every line starts with `marker`: one single-paragraph item per line. */
function parseList(type, lines, marker) {
  return {
    type,
    content: lines.map(l => ({
      type: 'listItem',
      content: [{ type: 'paragraph', content: parseInline(l.replace(marker, '')) }],
    })),
  }
}

const BULLET_MARKER = /^-\s+/
const ORDERED_MARKER = /^\d+\.\s+/

/** One blank-line-delimited Markdown block → one ADF block node. */
function parseBlock(block) {
  const headingMatch = block.match(/^(#{1,6})\s+([\s\S]*)$/)
  if (headingMatch) {
    return { type: 'heading', attrs: { level: headingMatch[1].length }, content: parseInline(headingMatch[2].trim()) }
  }

  if (/^```/.test(block)) {
    const m = block.match(/^```([^\n]*)\n([\s\S]*?)\n?```$/)
    const lang = (m?.[1] || '').trim()
    // An unterminated fence still yields a codeBlock.
    const code = m ? m[2] : block.replace(/^```[^\n]*\n?/, '').replace(/```$/, '')
    return {
      type: 'codeBlock',
      ...(lang ? { attrs: { language: lang } } : {}),
      content: code.length ? [{ type: 'text', text: code }] : [],
    }
  }

  if (block.trim() === '---') return { type: 'rule' }

  const lines = block.split('\n')
  // A quote with any non-`> ` line degrades to a paragraph.
  if (lines.every(l => l.startsWith('> '))) {
    const inner = lines.map(l => l.slice(2)).join('\n')
    return { type: 'blockquote', content: [{ type: 'paragraph', content: parseParagraphContent(inner) }] }
  }
  if (lines.every(l => BULLET_MARKER.test(l))) return parseList('bulletList', lines, BULLET_MARKER)
  if (lines.every(l => ORDERED_MARKER.test(l))) return parseList('orderedList', lines, ORDERED_MARKER)

  return { type: 'paragraph', content: parseParagraphContent(block) }
}

/**
 * What `markdownToAdf` splits a document into blocks on — TWO LITERAL NEWLINES,
 * nothing else (`\r\n` is not a separator; neither is `"\n \n"`). The gate's
 * shape rules test this same pattern against a rendered body, so the two cannot
 * drift: share the constant, never re-type the regex at a use site.
 */
const BLOCK_SPLIT_PATTERN = /\n{2,}/

/**
 * Convert Markdown to an ADF document — the write-direction inverse of
 * `adfToMarkdown`. Unrecognised constructs degrade to a plain paragraph rather
 * than throwing; refusing unrenderable content is `adfHasUnrenderableContent`'s
 * job, applied to the EXISTING stored ADF a write is about to overwrite, and its
 * node set and structural rules are derived from THIS function.
 * @param {string|null|undefined} markdown
 * @returns {{type: 'doc', version: 1, content: Array}}
 */
export function markdownToAdf(markdown) {
  const text = String(markdown ?? '')
  if (!text.trim()) return { type: 'doc', version: 1, content: [] }
  const blocks = text
    .split(BLOCK_SPLIT_PATTERN)
    .map(b => b.replace(/^\n+|\n+$/g, ''))
    .filter(b => b.length > 0)
  return { type: 'doc', version: 1, content: blocks.map(parseBlock) }
}

// -----------------------------------------------------------------------------
// 3. Gate: unrenderable-content detection (LIN-1886, D1 policy).
//
// A pure recursive walk over an ADF tree, gating a WRITE. A write does
// read-then-rewrite, so the property it needs is
//
//     markdownToAdf(adfToMarkdown(doc)) deep-equals doc
//
// That does NOT hold across the reader's vocabulary: `mention`, `emoji`,
// `inlineCard` and `blockCard` render fine but have no inverse, so gating on the
// reader's set let a 200-OK write flatten them into anonymous text (LIN-1886
// review Blocker 3). THE GATE IS DERIVED FROM THE WRITER: keep the type set,
// shapes and attrs below in lockstep with `parseBlock`/`parseInline`/
// `parseParagraphContent`, never with `renderAdfNode`'s switch.
// -----------------------------------------------------------------------------

const WRITER_REBUILDABLE_NODE_TYPES = new Set([
  'doc', 'text', 'paragraph', 'heading', 'bulletList', 'orderedList', 'listItem',
  'codeBlock', 'blockquote', 'rule', 'hardBreak',
])

/**
 * The `attrs` each rebuildable node type may carry; every type not listed must
 * carry NO `attrs` at all (even an empty object cannot survive a write — this
 * catches `heading {level: 7}`, clamped to 6). Each check returns true when the
 * attrs are ones the writer re-emits.
 */
const WRITER_EMITTED_ATTRS = {
  // `parseBlock` always stamps `{level}` on a heading, from the `#` run length.
  heading: node => {
    const level = node.attrs?.level
    return Number.isInteger(level) && level >= 1 && level <= 6 && Object.keys(node.attrs).length === 1
  },
  // The one CONTENT-PRESERVING exception, per John's ruling `d38d3755` ("the
  // identity value is harmless"): the reader renumbers every ordered list from
  // 1, so dropping `{order: 1}` or a bare `{}` changes not one rendered
  // character. MEASURED: they do NOT deep-equal round-trip (the writer emits no
  // `attrs` key), so this is a named exception (#2 below), pinned by the
  // `WRITER_PERMITTED_LOSSY_ADF` fixtures. Only the EXACT identity `1` is
  // permitted: `{order: 0}`/`{order: -3}` would renumber a visibly 0-based list,
  // and `{order: 5}` silently renumbers 5,6 → 1,2. Those stay refused until the
  // writer models the attribute — a behaviour change outside this gate.
  // Re-review `5ae61f22` measured that modelling it would not close the
  // deep-equal gap either: stamping `{order: 1}` on every emitted list just
  // moves the mismatch onto the commoner list that stores no `attrs`.
  orderedList: node => {
    if (node.attrs === undefined) return true
    const keys = Object.keys(node.attrs)
    if (keys.length === 0) return true
    return keys.length === 1 && node.attrs.order === 1
  },
  // `parseBlock` stamps `{language}` ONLY when the fence carries one, and reads
  // it back through `.trim()` — so a blank or space-padded language is lost.
  codeBlock: node => {
    if (node.attrs === undefined) return true
    const lang = node.attrs?.language
    return typeof lang === 'string' && lang !== '' && lang === lang.trim()
      && !/\n/.test(lang) && Object.keys(node.attrs).length === 1
  },
}

/**
 * `localId` (LIN-2019, exception 3 below) is the one attrs key ignored before
 * any attrs rule runs: Jira's editor stamps it on virtually every node, it
 * renders as nothing and is re-stamped on the next edit. Fail-closed: an
 * allowlist of ONE key, so any other unknown key still refuses. An emptied
 * `attrs` becomes `undefined`. (`in` throws on a non-object `attrs`; kept.)
 */
function withoutLocalId(node) {
  if (!node.attrs || !('localId' in node.attrs)) return node
  const { localId, ...attrs } = node.attrs
  return { ...node, attrs: Object.keys(attrs).length === 0 ? undefined : attrs }
}

function attrsAreUnrebuildable(node) {
  const effective = withoutLocalId(node)
  const check = WRITER_EMITTED_ATTRS[effective.type]
  return check ? !check(effective) : effective.attrs !== undefined
}

/**
 * `parseParagraphContent` (the only thing that emits `hardBreak`) is reached
 * ONLY for a paragraph and a blockquote's inner text. Heading content and a
 * listItem's paragraph go through bare `parseInline`, so a `\n` the reader
 * emits inside either is re-read as a block boundary.
 */
function containsHardBreak(nodes) {
  return (nodes || []).some(n => n?.type === 'hardBreak' || (Array.isArray(n?.content) && containsHardBreak(n.content)))
}

/** The inline Markdown a container's first child paragraph renders to. */
function renderedParagraphText(node) {
  return renderAdfNodes(node.content?.[0]?.content)
}

const hasEdgeWhitespace = text => text !== text.trim()
const hasEdgeNewline = text => /^\n|\n$/.test(text)

const isSingleParagraph = node => node.content?.length === 1 && node.content[0]?.type === 'paragraph'

/**
 * Per-type SHAPE rules: `markdownToAdf` builds each container in exactly one
 * fixed shape, so a permitted type in any other shape is as unrebuildable as an
 * unmodeled type. Each returns true when the writer cannot rebuild the node.
 * Each rule is pinned by a fixture in tests/unit/jira-provider.test.js.
 */
const SHAPE_RULES = {
  // Heading content goes through bare `parseInline` (see containsHardBreak),
  // is trimmed twice on the way back, and an empty heading re-reads as a
  // paragraph of literal `#`. A blank line inside splits the block.
  heading: node => {
    if (containsHardBreak(node.content)) return true
    const text = renderAdfNodes(node.content)
    return text === '' || hasEdgeWhitespace(text) || BLOCK_SPLIT_PATTERN.test(text)
  },
  // A paragraph rendering to nothing is dropped on write; one whose text holds
  // a blank line is torn in two. An EMPTY paragraph is permitted wherever it
  // sits (LIN-2019, exception 4 below): in a list item it is a rebuildable `- `
  // line, and at top level it is a deliberate lossy trade. A leading empty
  // paragraph, or one alone, is refused by the document-edge rule instead.
  paragraph: node => {
    const text = renderAdfNodes(node.content)
    if (text === '') return false
    return hasEdgeNewline(text) || BLOCK_SPLIT_PATTERN.test(text)
  },
  // Always exactly one paragraph child. The reader trims before prefixing `> `.
  blockquote: node => !isSingleParagraph(node) || hasEdgeWhitespace(renderedParagraphText(node)),
  // Always exactly one paragraph child, which also makes a nested list
  // unrebuildable at any depth (it lives as a second child). A hardBreak breaks
  // the `- ` line, so `parseBlock` degrades the whole list to a paragraph. The
  // reader trims each item and the writer's greedy marker strip eats leading
  // whitespace, so padding is destroyed both ways (LIN-1886 review F1 (b)).
  listItem: node => {
    if (!isSingleParagraph(node)) return true
    if (containsHardBreak(node.content)) return true
    return hasEdgeWhitespace(renderedParagraphText(node))
  },
  // A fenced body with a blank line (or an empty one) is torn in two by the
  // block split, and the reader strips trailing newlines, so a fence is
  // rebuildable only as one non-empty text run with no blank line and no
  // leading/trailing newline.
  codeBlock: node => {
    if (node.content?.length !== 1 || node.content[0]?.type !== 'text') return true
    const code = node.content[0].text || ''
    return code === '' || BLOCK_SPLIT_PATTERN.test(code) || hasEdgeNewline(code)
  },
}

/** A text run the writer cannot rebuild. `newlineOk`: a heading's direct child. */
function textRunIsUnrebuildable(node, newlineOk) {
  // `parseParagraphContent` splits every `\n` into a hardBreak, so a stored run
  // carrying one re-reads as several. A heading is the exception: bare
  // `parseInline` hands the newline straight back.
  if (/\n/.test(node.text || '') && !newlineOk) return true
  if (!Array.isArray(node.marks)) return false
  // An empty run cannot carry a mark home (`**`, `__`, `~~~~` re-read as
  // literal text) — except a `link`: `[](href)` allows empty link text.
  if ((node.text || '') === '' && node.marks.some(m => m?.type !== 'link')) return true
  // Marks come from MARK_RENDERERS directly: `matchInlineConstruct` parses
  // exactly that vocabulary back. Own-property lookup here; the reader's
  // `MARK_RENDERERS[mark.type]` deliberately stays a plain lookup.
  for (const mark of node.marks) {
    if (!Object.prototype.hasOwnProperty.call(MARK_RENDERERS, mark?.type)) return true
  }
  // Only ONE mark per run: the inline scan does not nest, so strong+em renders
  // `_**x**_` and re-parses as one em run with literal `**x**` text.
  if (node.marks.length > 1) return true
  // A link's href rides the line-bounded `](…)` slot; a newline breaks the block.
  const link = node.marks.find(m => m?.type === 'link')
  return Boolean(link && /\n/.test(link.attrs?.href || ''))
}

/**
 * Two adjacent UNMARKED runs render as one stretch of text and `parseInline`
 * merges contiguous literal text, so the split is unrecoverable. Marked runs
 * keep their delimiters and re-split fine.
 */
const isUnmarkedTextRun = node => node?.type === 'text' && !(node.marks?.length > 0)

/**
 * One recursive predicate; the steps run in the order that decides throw-vs-
 * boolean on malformed input, so do not reorder them: type allowed → attrs →
 * shape → text-run rules → children (each child, THEN the adjacent-pair test).
 */
function nodeIsUnrebuildable(node, newlineOk = false) {
  if (!node || typeof node !== 'object') return false
  if (!WRITER_REBUILDABLE_NODE_TYPES.has(node.type)) return true
  if (attrsAreUnrebuildable(node)) return true
  if (SHAPE_RULES[node.type]?.(node)) return true
  // A code block's single child was validated in full by its shape rule; stop
  // here so its legitimately multi-line text does not trip the newline rule.
  if (node.type === 'codeBlock') return false
  if (node.type === 'text' && textRunIsUnrebuildable(node, newlineOk)) return true
  if (Array.isArray(node.content)) {
    // Only a heading's DIRECT children may carry newlines.
    const childNewlineOk = node.type === 'heading'
    for (let i = 0; i < node.content.length; i += 1) {
      if (nodeIsUnrebuildable(node.content[i], childNewlineOk)) return true
      if (i > 0 && isUnmarkedTextRun(node.content[i - 1]) && isUnmarkedTextRun(node.content[i])) return true
    }
  }
  return false
}

/**
 * True if `doc` contains anything `markdownToAdf` cannot reconstruct from
 * `adfToMarkdown(doc)`. The invariant this gate buys:
 *
 *     adfHasUnrenderableContent(doc) === false
 *       ⟹  markdownToAdf(adfToMarkdown(doc)) deep-equals doc,
 *           EXCEPT for the four enumerated classes below
 *
 * — asserted in both directions over the fixtures and the generated corpus in
 * `tests/unit/jira-provider.test.js`; that is evidence over a corpus, not a
 * proof. The exceptions are ENUMERATED rather than papered over (LIN-1886, John's
 * ruling `d38d3755`). 1-3 are STRUCTURE-ONLY (no rendered character changes);
 * 4 drops a rendered blank line, a deliberate trade. All are pinned by fixtures.
 *
 *   1. **An empty, unmarked text run — LIN-1939.** Slips both guards (the
 *      empty-run rule needs a mark; the adjacent-pair rule needs both
 *      neighbours unmarked), so `[text '', text 'x' (em)]` is permitted, renders
 *      `_x_`, and re-reads without the empty run. Pre-existing, not fixed here.
 *   2. **An `orderedList`'s identity `attrs`** — `{order: 1}` or `{}` (ruling
 *      `d38d3755`, see `WRITER_EMITTED_ATTRS`). The key is ABSENT after the
 *      round trip; the rendered Markdown is identical. A non-identity `order`
 *      is still refused, since dropping it renumbers the list.
 *   3. **A `localId` attrs key, on any node type — LIN-2019.** Stripped by
 *      `withoutLocalId` before the attrs check, so it is ABSENT after the round
 *      trip. A node with `localId` PLUS another unknown attrs key, or in an
 *      independently unrebuildable shape, still refuses.
 *   4. **A top-level empty paragraph — LIN-2019, genuinely lossy.** Permitted,
 *      its blank line dropped on write, mid-document (`[p("one"), p(""),
 *      p("two")]` reads back one node shorter) and trailing (`[p("one"), p("")]`:
 *      the document-edge rule strips trailing newlines before its `trimEnd`
 *      comparison, so only the node rule guarded it). A LEADING one, or one
 *      alone, is refused by the document-edge `trimStart()` check, which has no
 *      trailing equivalent — an asymmetry that pre-dates this exception. The
 *      trade is deliberate: refusing every human-touched Jira description is
 *      worse than dropping a blank line.
 *
 * Five things trip the gate, checked through the WHOLE tree:
 *   - a node `type` outside `WRITER_REBUILDABLE_NODE_TYPES`;
 *   - a permitted type in a shape the writer never emits (`SHAPE_RULES`);
 *   - `attrs` the writer cannot re-emit (`WRITER_EMITTED_ATTRS`);
 *   - whitespace a `.trim()` on either side of the round trip destroys — at a
 *     list item, blockquote, heading, or the document's own edges;
 *   - a text node with a mark outside `MARK_RENDERERS`'s keys, MORE THAN ONE
 *     mark, or an embedded newline outside a fence.
 *
 * NOT on this list, deliberately (human decision `599551c2`): Markdown-syntax
 * collisions in ordinary prose (`- not a list`, `foo_bar_baz`, a ```` ```js ````
 * line). `adfToMarkdown` escapes them and they round-trip; refusing prose was
 * rejected as a remedy.
 *
 * Used to refuse (422) an in-app description overwrite that would silently
 * destroy Jira-native content — never to reject a READ. Like `adfToMarkdown`, it
 * validates only `doc.content`, never the wrapper's `type`.
 * @param {object|null|undefined} doc - an ADF document (or any ADF node)
 * @returns {boolean}
 */
export function adfHasUnrenderableContent(doc) {
  if (!doc || typeof doc !== 'object') return false
  if ((doc.content || []).some(node => nodeIsUnrebuildable(node))) return true
  // The document's OWN edges: `adfToMarkdown` ends in a `.trim()`, invisible to
  // any per-node rule. The trailing side ignores the block-separating newlines
  // every renderer emits (structure, not content).
  const raw = renderAdfNodes(doc.content)
  if (raw !== raw.trimStart()) return true
  const withoutBlockBreaks = raw.replace(/\n+$/, '')
  return withoutBlockBreaks !== withoutBlockBreaks.trimEnd()
}
