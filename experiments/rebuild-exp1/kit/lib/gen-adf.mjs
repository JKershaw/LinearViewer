// Seeded generator of ADF documents.
//
// Node / mark vocabulary from Atlassian's ADF structure reference
// (developer.atlassian.com/cloud/jira/platform/apis/document/structure/ and the
// per-node pages): doc, paragraph, heading, bulletList, orderedList, listItem,
// codeBlock, blockquote, rule, panel, expand, nestedExpand, table, tableRow,
// tableHeader, tableCell, mediaSingle, mediaGroup, media, blockCard; inline
// text, hardBreak, mention, emoji, inlineCard, date, status, mediaInline;
// marks strong, em, code, strike, underline, link, subsup, textColor,
// backgroundColor, border.
//
// Three profiles, so the corpus exercises every branch of a codec like adf.js:
//   writer — only shapes markdownToAdf itself can emit (exercises the
//            round-trip / gate-false paths with adversarial text);
//   spec   — schema-valid documents across the whole vocabulary;
//   wild   — spec plus malformations: unknown node types, empty / missing /
//            null content, missing or wrong attrs, bad marks, nulls and
//            primitives where nodes belong, deep nesting, non-doc roots.
import { makeRng } from './prng.mjs'

const WORDS = ['alpha', 'beta', 'gamma', 'Delta', 'eps', 'x', 'id', 'API', 'v2', '42', 'foo', 'bar', 'TODO', 'NOTE', 'é', 'naïve', 'über', 'straße']
const TRICKY = [
  'foo_bar_baz', '__init__', 'a*b*c', '**', '*', '_', '~~', '~', '`', '``', '```', '```js', '[x]', '[a]b](http://x)', '](', '(', ')', '\\', '\\\\', 'C:\\Users\\me',
  '\\d+', '\\*', '#', '# not heading', '##', '#######', '> not quote', '>', '- not list', '-', '---', '--', '***', '1. one', '1.', '10. ten', '2)', '+ plus',
  '<b>bold</b>', '<br>', '&amp;', '&lt;', '|', '| a | b |', '!', '![img](x.png)', 'http://example.com/a_(b)', '<http://auto.link>', '@user', ':smile:',
  '🚀', '👍🏽', '日本語', 'שלום', 'مرحبا', 'e\u0301', '\u200b', '\u00a0', '\t', '$', '^', '{', '}', '"', "'", '%', '&', '=', '==', '+',
]
const LANGS = ['js', 'javascript', 'ts', 'python', 'sh', 'json', 'diff', 'text', 'c++', 'objective-c', 'plain text', ' js', 'js ', '', 'A', '```', 'x\ny']
const HREFS = ['https://example.com', 'https://example.com/a_(b)', 'http://x.y/?q=a b&c=d', 'mailto:a@b.co', '', '#anchor', '/relative/path', 'https://x.com/p\\q', 'https://x.com/(', 'https://x.com/)', 'javascript:alert(1)', 'https://ex.com/ü', 'https://ex.com/\nnl']
const COLORS = ['#ff5630', '#36b37e', '#6554c0', 'red', '#FFF']
const UNKNOWN_BLOCKS = ['extension', 'bodiedExtension', 'taskList', 'decisionList', 'layoutSection', 'syncBlock', 'bodiedSyncBlock', 'multiBodiedExtension', 'embedCard', 'foo']
const UNKNOWN_INLINE = ['inlineExtension', 'placeholder', 'taskItem', 'decisionItem', 'unsupportedInline', 'bar']

export function generateAdfCorpus({ seed = 20261015, count = 3000 } = {}) {
  const rng = makeRng(seed)
  const items = []
  for (let i = 0; i < count; i += 1) {
    const profile = rng.weighted([[35, 'writer'], [40, 'spec'], [25, 'wild']])
    const size = rng.weighted([[50, 'small'], [35, 'medium'], [15, 'large']])
    const g = makeGen(rng, profile, size)
    items.push({ id: `gen-adf#${i}`, tag: `${profile}/${size}`, input: g.doc() })
  }
  return items
}

function makeGen(rng, profile, size) {
  const wild = profile === 'wild'
  const writer = profile === 'writer'
  const maxDepth = size === 'small' ? 2 : size === 'medium' ? 4 : 7
  const localId = () => `${rng.int(0, 0xffff).toString(16)}-${rng.int(0, 0xffff).toString(16)}`

  function text() {
    const n = rng.weighted([[10, 1], [40, 2], [30, 4], [15, 8], [5, 20]])
    let s = ''
    for (let i = 0; i < n; i += 1) {
      const tok = rng.chance(0.35) ? rng.pick(TRICKY) : rng.pick(WORDS)
      s += (i === 0 ? '' : rng.weighted([[80, ' '], [10, ''], [5, '  '], [5, rng.chance(0.5) ? '\n' : '\n\n']])) + tok
    }
    if (rng.chance(0.08)) s = ` ${s}`
    if (rng.chance(0.08)) s = `${s} `
    if (rng.chance(0.03)) s = ''
    if (rng.chance(0.02)) s = rng.pick(['\n', ' ', '\n\nx', 'x\n'])
    if (writer && rng.chance(0.85)) s = s.replace(/\n+/g, ' ') // the writer never emits a newline in a run
    return s
  }

  function maybeLocalId(attrs) {
    if (rng.chance(writer ? 0.12 : 0.3)) return { ...(attrs || {}), localId: localId() }
    return attrs
  }

  function mark() {
    const type = writer
      ? rng.pick(['strong', 'em', 'code', 'strike', 'link'])
      : rng.pick(['strong', 'em', 'code', 'strike', 'underline', 'link', 'link', 'subsup', 'textColor', 'backgroundColor', 'border'])
    switch (type) {
      case 'link': {
        const attrs = { href: rng.pick(HREFS) }
        if (!writer && rng.chance(0.2)) attrs.title = rng.pick(WORDS)
        if (wild && rng.chance(0.15)) return rng.pick([{ type: 'link' }, { type: 'link', attrs: {} }, { type: 'link', attrs: { href: null } }])
        return { type, attrs }
      }
      case 'subsup': return { type, attrs: { type: rng.pick(['sub', 'sup']) } }
      case 'textColor':
      case 'backgroundColor': return { type, attrs: { color: rng.pick(COLORS) } }
      case 'border': return { type, attrs: { size: rng.int(1, 3), color: '#091e4224' } }
      default: return { type }
    }
  }

  function textNode() {
    const node = { type: 'text', text: text() }
    const nMarks = writer ? rng.weighted([[55, 0], [45, 1]]) : rng.weighted([[50, 0], [30, 1], [15, 2], [5, 3]])
    if (nMarks) {
      const marks = []
      for (let i = 0; i < nMarks; i += 1) marks.push(mark())
      node.marks = marks
    }
    if (wild && rng.chance(0.12)) {
      const fault = rng.int(0, 7)
      if (fault === 0) delete node.text
      else if (fault === 1) node.text = null
      else if (fault === 2) node.text = rng.int(0, 99)
      else if (fault === 3) node.marks = []
      else if (fault === 4) node.marks = [{ type: 'unknownMark' }]
      else if (fault === 5) node.marks = [{}]
      else if (fault === 6) node.marks = null
      else node.marks = [null]
    }
    return node
  }

  function inline() {
    if (writer) return rng.chance(0.15) ? { type: 'hardBreak' } : textNode()
    const kind = rng.weighted([[70, 'text'], [7, 'hardBreak'], [5, 'mention'], [4, 'emoji'], [4, 'inlineCard'], [3, 'date'], [3, 'status'], [2, 'mediaInline'], [wild ? 4 : 0, 'unknown'], [wild ? 2 : 0, 'garbage']])
    switch (kind) {
      case 'text': return textNode()
      case 'hardBreak': return { type: 'hardBreak' }
      case 'mention': {
        const attrs = { id: rng.pick(['557058:abc', 'all', 'here', '']) }
        if (rng.chance(0.7)) attrs.text = rng.pick(['@John Smith', '@all', '', '@_under_score'])
        if (rng.chance(0.3)) attrs.accessLevel = rng.pick(['CONTAINER', 'APPLICATION', ''])
        return wild && rng.chance(0.2) ? { type: 'mention' } : { type: 'mention', attrs }
      }
      case 'emoji': {
        const attrs = { shortName: rng.pick([':smile:', ':grinning:', ':+1:', ':custom_emoji:']) }
        if (rng.chance(0.5)) attrs.id = rng.pick(['1f600', 'atlassian-check_mark'])
        if (rng.chance(0.6)) attrs.text = rng.pick(['😀', '👍', '✔', ''])
        return wild && rng.chance(0.2) ? { type: 'emoji', attrs: {} } : { type: 'emoji', attrs }
      }
      case 'inlineCard': return rng.chance(0.85) ? { type: 'inlineCard', attrs: { url: rng.pick(HREFS.slice(0, 7)) } } : { type: 'inlineCard', attrs: { data: { '@type': 'Document', name: 'Doc' } } }
      case 'date': return { type: 'date', attrs: { timestamp: String(1700000000000 + rng.int(0, 1e9)) } }
      case 'status': return { type: 'status', attrs: { text: rng.pick(['IN PROGRESS', 'done', '']), color: rng.pick(['neutral', 'purple', 'blue', 'red', 'yellow', 'green']), localId: localId() } }
      case 'mediaInline': return { type: 'mediaInline', attrs: { id: localId(), collection: 'c', type: rng.pick(['file', 'link']) } }
      case 'unknown': {
        const n = { type: rng.pick(UNKNOWN_INLINE) }
        if (rng.chance(0.5)) n.content = [textNode()]
        if (rng.chance(0.3)) n.attrs = { extensionKey: 'k', text: 'fallback' }
        return n
      }
      default: return rng.pick([null, undefined, 'bare string', 7, [], {}, { text: 'typeless' }])
    }
  }

  function inlineContent(lo = 0, hi = 6) {
    const content = []
    const n = rng.int(lo, hi)
    for (let i = 0; i < n; i += 1) content.push(inline())
    return content
  }

  function withContentFaults(node) {
    if (!wild || !rng.chance(0.12)) return node
    const fault = rng.int(0, 4)
    if (fault === 0) node.content = []
    else if (fault === 1) delete node.content
    else if (fault === 2) node.content = null
    else if (fault === 3) node.content = 'not an array'
    else node.attrs = null
    return node
  }

  function paragraph(lo = 0, hi = 6) {
    const p = { type: 'paragraph', content: inlineContent(lo, hi) }
    const attrs = maybeLocalId(undefined)
    if (attrs) p.attrs = attrs
    if (!writer && rng.chance(0.05)) p.marks = [{ type: 'alignment', attrs: { align: rng.pick(['center', 'end']) } }]
    return withContentFaults(p)
  }

  function heading() {
    let level = rng.int(1, 6)
    if (wild && rng.chance(0.25)) level = rng.pick([0, 7, 9, -1, '2', 2.5, null, undefined])
    const h = { type: 'heading', attrs: maybeLocalId({ level }) }
    if (wild && rng.chance(0.1)) delete h.attrs
    h.content = writer ? Array.from({ length: rng.int(1, 3) }, () => textNode()) : inlineContent(0, 4)
    return withContentFaults(h)
  }

  function listItem(depth) {
    const content = [paragraph(1, 4)]
    if (!writer && depth < maxDepth) {
      const extra = rng.weighted([[60, 0], [30, 1], [10, 2]])
      for (let i = 0; i < extra; i += 1) content.push(rng.pick([() => list(depth + 1), () => list(depth + 1), () => paragraph(1, 3), () => codeBlock()])())
    }
    if (writer) for (const n of content[0].content) if (n.type === 'hardBreak') n.type = 'text', n.text = 'x' // writer list items never break lines
    const li = { type: 'listItem', content }
    const attrs = maybeLocalId(undefined)
    if (attrs) li.attrs = attrs
    return withContentFaults(li)
  }

  function list(depth) {
    const ordered = rng.chance(0.45)
    const node = { type: ordered ? 'orderedList' : 'bulletList', content: Array.from({ length: rng.int(1, 5) }, () => listItem(depth + 1)) }
    if (ordered) {
      const choice = writer ? rng.weighted([[70, 'none'], [20, 1], [10, 'empty']]) : rng.weighted([[50, 'none'], [20, 1], [10, 'empty'], [20, 'other']])
      if (choice === 1) node.attrs = { order: 1 }
      else if (choice === 'empty') node.attrs = {}
      else if (choice === 'other') node.attrs = { order: rng.pick([0, 2, 5, 10, 99, -3, '3', null, 1.5]) }
    }
    if (rng.chance(0.15)) node.attrs = maybeLocalId(node.attrs) || node.attrs
    return withContentFaults(node)
  }

  function codeBlock() {
    const cb = { type: 'codeBlock' }
    if (rng.chance(0.6)) cb.attrs = { language: rng.pick(writer ? LANGS.slice(0, 11) : LANGS) }
    const lines = Array.from({ length: rng.int(1, 6) }, () => rng.pick(['const x = 1;', 'if (a && b) {', '  return `${y}`', '}', '# comment', '- item', '> quote', '```', '**not bold**', 'foo_bar', 'C:\\dir', '', '\tindented', '    four', '日本']))
    let body = lines.join('\n')
    if (writer) body = body.replace(/\n{2,}/g, '\n').replace(/^\n+|\n+$/g, '') || 'x'
    if (writer || rng.chance(0.8)) cb.content = [{ type: 'text', text: body }]
    else cb.content = rng.pick([[], [{ type: 'text', text: body }, { type: 'text', text: '\nmore' }], [{ type: 'text', text: body, marks: [{ type: 'strong' }] }], [{ type: 'hardBreak' }], [{ type: 'text', text: `${body}\n\n` }]])
    if (rng.chance(0.1) && !writer) cb.marks = [{ type: 'breakout', attrs: { mode: 'wide' } }]
    return withContentFaults(cb)
  }

  function media() {
    const m = { type: 'media', attrs: { id: localId(), type: rng.pick(['file', 'link', 'external']), collection: 'MediaServicesSample' } }
    if (rng.chance(0.6)) Object.assign(m.attrs, { width: rng.int(10, 900), height: rng.int(10, 900) })
    if (rng.chance(0.3)) m.attrs.alt = rng.pick(['moon.jpeg', 'diagram (1).png', ''])
    if (m.attrs.type === 'external') { delete m.attrs.collection; delete m.attrs.id; m.attrs.url = 'https://example.com/x.png' }
    return m
  }

  function tableCell(depth, header) {
    const c = { type: header ? 'tableHeader' : 'tableCell', attrs: {} }
    if (rng.chance(0.3)) c.attrs.colspan = rng.int(1, 3)
    if (rng.chance(0.2)) c.attrs.rowspan = rng.int(1, 2)
    if (rng.chance(0.3)) c.attrs.colwidth = [rng.int(0, 300)]
    if (rng.chance(0.2)) c.attrs.background = rng.pick(COLORS)
    c.content = Array.from({ length: rng.int(1, 2) }, () => block(depth + 1, 'cell'))
    return withContentFaults(c)
  }

  function block(depth = 0, ctx = 'doc') {
    if (writer) {
      const kind = rng.weighted([[40, 'paragraph'], [12, 'heading'], [16, 'list'], [10, 'codeBlock'], [10, 'blockquote'], [6, 'rule'], [6, 'empty']])
      switch (kind) {
        case 'paragraph': return paragraph(1, 6)
        case 'heading': return heading()
        case 'list': return list(depth)
        case 'codeBlock': return codeBlock()
        case 'blockquote': return { type: 'blockquote', content: [paragraph(1, 5)] }
        case 'rule': return { type: 'rule' }
        default: return { type: 'paragraph', content: [] }
      }
    }
    const deep = depth >= maxDepth
    const kind = rng.weighted([
      [30, 'paragraph'], [10, 'heading'], [deep ? 0 : 14, 'list'], [8, 'codeBlock'], [deep ? 0 : 7, 'blockquote'], [4, 'rule'],
      [deep || ctx === 'cell' ? 0 : 4, 'panel'], [deep ? 0 : 3, ctx === 'cell' ? 'nestedExpand' : 'expand'], [deep || ctx === 'cell' ? 0 : 4, 'table'],
      [ctx === 'cell' ? 0 : 3, 'mediaSingle'], [2, 'mediaGroup'], [2, 'blockCard'],
      [wild ? 5 : 0, 'unknown'], [wild ? 2 : 0, 'inlineAtBlock'], [wild ? 2 : 0, 'garbage'], [wild ? 2 : 0, 'deepNest'],
    ])
    switch (kind) {
      case 'paragraph': return paragraph()
      case 'heading': return heading()
      case 'list': return list(depth)
      case 'codeBlock': return codeBlock()
      case 'blockquote': {
        const n = rng.weighted([[70, 1], [20, 2], [10, 3]])
        return withContentFaults({ type: 'blockquote', content: Array.from({ length: n }, () => rng.pick([() => paragraph(1, 5), () => paragraph(1, 5), () => list(depth + 1), () => codeBlock()])()) })
      }
      case 'rule': return { type: 'rule' }
      case 'panel': return withContentFaults({ type: 'panel', attrs: { panelType: rng.pick(['info', 'note', 'warning', 'success', 'error']) }, content: Array.from({ length: rng.int(1, 3) }, () => rng.pick([() => paragraph(1, 4), () => heading(), () => list(depth + 1), () => codeBlock()])()) })
      case 'expand':
      case 'nestedExpand': return withContentFaults({ type: kind, attrs: { title: rng.pick(['Details', '', 'Click _here_']) }, content: Array.from({ length: rng.int(1, 3) }, () => block(depth + 1, ctx)) })
      case 'table': {
        const cols = rng.int(1, 4)
        const rows = rng.int(1, 4)
        const attrs = { isNumberColumnEnabled: rng.chance(0.2), layout: rng.pick(['default', 'center', 'wide', 'full-width', 'align-start']) }
        return withContentFaults({ type: 'table', attrs, content: Array.from({ length: rows }, (_, r) => ({ type: 'tableRow', content: Array.from({ length: cols }, () => tableCell(depth, r === 0 && rng.chance(0.6))) })) })
      }
      case 'mediaSingle': return { type: 'mediaSingle', attrs: { layout: rng.pick(['center', 'wrap-left', 'wide', 'full-width', 'align-end']), ...(rng.chance(0.4) ? { width: rng.int(10, 100) } : {}) }, content: [media()] }
      case 'mediaGroup': return { type: 'mediaGroup', content: Array.from({ length: rng.int(1, 3) }, media) }
      case 'blockCard': return { type: 'blockCard', attrs: { url: rng.pick(HREFS.slice(0, 7)) } }
      case 'unknown': {
        const n = { type: rng.pick(UNKNOWN_BLOCKS) }
        if (rng.chance(0.6)) n.content = Array.from({ length: rng.int(0, 3) }, () => (rng.chance(0.5) ? block(depth + 1, ctx) : inline()))
        if (rng.chance(0.4)) n.attrs = { extensionKey: 'k', parameters: { a: 1 } }
        return n
      }
      case 'inlineAtBlock': return inline()
      case 'garbage': return rng.pick([null, undefined, 'string block', 0, [], {}, { content: [textNode()] }, { type: '' }])
      default: {
        // deepNest: a chain of nested lists / quotes well past any normal depth.
        let node = paragraph(1, 2)
        const levels = rng.int(4, 12)
        for (let i = 0; i < levels; i += 1) {
          node = rng.chance(0.6)
            ? { type: rng.pick(['bulletList', 'orderedList']), content: [{ type: 'listItem', content: [paragraph(1, 2), node] }] }
            : { type: 'blockquote', content: [node] }
        }
        return node
      }
    }
  }

  function doc() {
    const n = size === 'small' ? rng.int(1, 3) : size === 'medium' ? rng.int(2, 8) : rng.int(8, 30)
    const content = Array.from({ length: n }, () => block(0))
    if (wild && rng.chance(0.1)) {
      return rng.pick([
        () => ({ content }),
        () => ({ type: 'doc' }),
        () => ({ type: 'doc', version: 1, content: [] }),
        () => ({ type: 'doc', version: 1, content: null }),
        () => ({ type: 'paragraph', content: inlineContent(1, 3) }),
        () => ({ type: 'doc', version: 2, content }),
        () => content,
        () => null,
        () => 'plain string',
        () => 42,
      ])()
    }
    return { type: 'doc', version: 1, content }
  }

  return { doc }
}
