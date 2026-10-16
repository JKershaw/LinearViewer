// Seeded generator of Markdown strings: CommonMark + GFM constructs plus the
// malformed edge cases a hand-typed ticket description actually contains.
import { makeRng } from './prng.mjs'

const WORDS = ['the', 'build', 'fails', 'on', 'CI', 'when', 'x', 'API', 'v2', '42', 'naïve', 'café', 'ok', 'Fix', 'retry', 'user_id', 'snake_case_name', 'camelCase', 'TODO:']
const UNICODE = ['🚀', '👍🏽', '日本語', 'שלום', 'مرحبا', 'e\u0301', '\u200b', '\u00a0', '—', '…', '“quoted”', '©', '\u2028']

export function generateMdCorpus({ seed = 20261016, count = 3000 } = {}) {
  const rng = makeRng(seed)
  const items = []
  const nonStrings = [null, undefined, 0, 42, true, false, {}, [], ['# a'], '   ']
  for (let i = 0; i < count; i += 1) {
    if (i < nonStrings.length) { items.push({ id: `gen-md#${i}`, tag: 'non-string', input: nonStrings[i] }); continue }
    const size = rng.weighted([[45, 'small'], [40, 'medium'], [15, 'large']])
    items.push({ id: `gen-md#${i}`, tag: size, input: makeDoc(rng, size) })
  }
  return items
}

function makeDoc(rng, size) {
  const word = () => rng.pick(WORDS)
  const words = (lo, hi) => Array.from({ length: rng.int(lo, hi) }, word).join(' ')

  function inlineToken() {
    const k = rng.weighted([
      [30, 'words'], [6, 'strong'], [3, 'strong_'], [5, 'em'], [5, 'em_'], [2, 'strongem'], [4, 'strike'], [1, 'strike1'], [6, 'code'], [2, 'code2'],
      [5, 'link'], [1, 'linkTitle'], [1, 'refLink'], [1, 'image'], [2, 'autolink'], [3, 'bareUrl'], [2, 'html'], [1, 'br'], [1, 'entity'],
      [3, 'escape'], [3, 'stray'], [2, 'unclosed'], [3, 'unicode'], [1, 'mention'], [1, 'emojiCode'], [1, 'winPath'], [1, 'nestedMarks'], [1, 'linkInLink'],
    ])
    switch (k) {
      case 'words': return words(1, 6)
      case 'strong': return `**${words(1, 3)}**`
      case 'strong_': return `__${words(1, 3)}__`
      case 'em': return `*${words(1, 3)}*`
      case 'em_': return `_${words(1, 3)}_`
      case 'strongem': return rng.pick([`***${word()}***`, `**_${word()}_**`, `_**${word()}**_`, `**${word()} _${word()}_**`])
      case 'strike': return `~~${words(1, 2)}~~`
      case 'strike1': return `~${word()}~`
      case 'code': return `\`${rng.pick(['npm test', 'a_b', '**x**', 'x < y', 'C:\\dir', '[a](b)', '\\', '`'.repeat(0) + 'ok'])}\``
      case 'code2': return rng.pick(['`` a ` b ``', '``code``', '` spaced `', '``'])
      case 'link': return `[${words(1, 3)}](${rng.pick(['https://example.com', 'https://ex.com/a_(b)', 'http://x/y?q=1&r=2', '/rel', '#frag', '<https://angle.com>', 'https://x.com/a\\)b'])})`
      case 'linkTitle': return `[${word()}](https://example.com "${word()}")`
      case 'refLink': return `[${word()}][ref]`
      case 'image': return `![${word()}](https://example.com/i.png)`
      case 'autolink': return rng.pick(['<https://auto.link/path>', '<mailto:a@b.co>', '<a@b.co>'])
      case 'bareUrl': return rng.pick(['https://example.com/path_with_underscores', 'www.example.com', 'https://ex.com/(x)', 'http://a.b/c*d*e'])
      case 'html': return rng.pick(['<b>bold</b>', '<span style="color:red">red</span>', '<kbd>Ctrl</kbd>', '<!-- note -->', '<img src=x>', '</div>'])
      case 'br': return '<br>'
      case 'entity': return rng.pick(['&amp;', '&lt;tag&gt;', '&nbsp;', '&#123;', '&copy;'])
      case 'escape': return rng.pick(['\\*not em\\*', '\\_x\\_', '\\#', '\\\\', '\\`', '\\[x\\]', '\\>', '\\-', '1\\.', '\\a', '\\'])
      case 'stray': return rng.pick(['*', '_', '**', '~~', '`', '[', ']', '(', ')', '2 * 3 * 4', 'a_b_c', '*/', '~'])
      case 'unclosed': return rng.pick(['**bold', '_em', '`code', '[link](http://x', '[text', '~~gone', '<b>open'])
      case 'unicode': return rng.pick(UNICODE)
      case 'mention': return rng.pick(['@john', '[~accountid:557058]', '@here'])
      case 'emojiCode': return rng.pick([':smile:', ':+1:', ':white_check_mark:'])
      case 'winPath': return rng.pick(['C:\\Users\\me\\file.txt', '\\\\server\\share', 'regex \\d+\\s*'])
      case 'nestedMarks': return rng.pick(['**a _b_ c**', '*a **b** c*', '~~a **b**~~', '**`code`**', '[**bold link**](http://x)'])
      default: return '[a [b] c](http://x)'
    }
  }

  function inlineLine(lo = 1, hi = 5) {
    const n = rng.int(lo, hi)
    let s = ''
    for (let i = 0; i < n; i += 1) s += (i ? rng.weighted([[85, ' '], [10, ''], [5, '  ']]) : '') + inlineToken()
    return s
  }

  function paragraph() {
    const lines = Array.from({ length: rng.weighted([[60, 1], [25, 2], [15, 4]]) }, () => inlineLine())
    return lines.map((l, i) => (i < lines.length - 1 ? l + rng.weighted([[70, ''], [15, '  '], [10, '\\'], [5, ' ']]) : l)).join('\n')
  }

  function heading() {
    const hashes = '#'.repeat(rng.weighted([[25, 1], [30, 2], [25, 3], [8, 4], [5, 5], [4, 6], [3, 7]]))
    const sep = rng.weighted([[85, ' '], [5, ''], [5, '   '], [5, '\t']])
    const closing = rng.chance(0.08) ? ` ${hashes}` : ''
    const body = rng.chance(0.05) ? '' : inlineLine(1, 3)
    return `${rng.chance(0.05) ? ' ' : ''}${hashes}${sep}${body}${closing}`
  }

  function setext() { return `${inlineLine(1, 2)}\n${rng.pick(['===', '---', '=', '-----'])}` }

  function fence() {
    const marker = rng.weighted([[80, '```'], [12, '~~~'], [8, '````']])
    const lang = rng.weighted([[40, ''], [30, rng.pick(['js', 'python', 'bash', 'json', 'diff'])], [10, ' js'], [5, 'js title="x"'], [5, '{.class}'], [10, 'text']])
    const lines = Array.from({ length: rng.int(0, 7) }, () => rng.pick(['const a = 1', 'if (x) {', '  y()', '}', '', '# not heading', '- not list', '**not bold**', '```', 'a_b_c', '\tTAB', '    indented', '<div>', '日本']))
    const close = rng.weighted([[80, marker], [10, ''], [5, '```'], [5, `${marker} trailing`]])
    const indent = rng.chance(0.05) ? '  ' : ''
    return [`${indent}${marker}${lang}`, ...lines, close].filter((l, i, a) => !(i === a.length - 1 && l === '')).join('\n')
  }

  function indentedCode() { return Array.from({ length: rng.int(1, 3) }, () => `    ${rng.pick(['code line', 'x = 1', '# comment'])}`).join('\n') }

  function list(depth = 0) {
    const ordered = rng.chance(0.4)
    const start = ordered ? rng.weighted([[60, 1], [10, 0], [10, 3], [10, 10], [5, 99], [5, 123456789]]) : 0
    const bullet = rng.weighted([[70, '-'], [20, '*'], [10, '+']])
    const delim = rng.chance(0.85) ? '.' : ')'
    const indentUnit = rng.pick(['  ', '   ', '    ', '\t'])
    const n = rng.int(1, 5)
    const out = []
    for (let i = 0; i < n; i += 1) {
      const marker = ordered ? `${start + (rng.chance(0.9) ? i : 0)}${delim}` : bullet
      const task = !ordered && rng.chance(0.1) ? rng.pick(['[ ] ', '[x] ', '[X] ']) : ''
      const space = rng.weighted([[90, ' '], [5, '  '], [5, '']])
      out.push(`${indentUnit.repeat(depth)}${marker}${space}${task}${rng.chance(0.03) ? '' : inlineLine(1, 3)}`)
      if (rng.chance(0.1)) out.push(`${indentUnit.repeat(depth + 1)}${inlineLine(1, 2)}`) // continuation line
      if (depth < 3 && rng.chance(0.18)) out.push(list(depth + 1))
      if (rng.chance(0.06)) out.push('') // loose list
    }
    return out.join('\n')
  }

  function quote(depth = 0) {
    const lines = []
    const n = rng.int(1, 4)
    for (let i = 0; i < n; i += 1) {
      const prefix = rng.weighted([[80, '> '], [10, '>'], [5, '>  '], [5, '']]) // '' = lazy continuation
      const inner = rng.weighted([[70, 'text'], [10, 'list'], [8, 'heading'], [6, 'nested'], [6, 'code']])
      if (inner === 'nested' && depth < 2) lines.push(...quote(depth + 1).split('\n').map(l => `> ${l}`))
      else if (inner === 'list') lines.push(`${prefix}- ${inlineLine(1, 2)}`)
      else if (inner === 'heading') lines.push(`${prefix}${heading()}`)
      else if (inner === 'code') lines.push(`${prefix}\`\`\``, `${prefix}code`, `${prefix}\`\`\``)
      else lines.push(`${prefix}${inlineLine(1, 4)}`)
    }
    return lines.join('\n')
  }

  function table() {
    const cols = rng.int(1, 4)
    const row = () => `| ${Array.from({ length: cols - (rng.chance(0.1) ? 1 : 0) }, () => rng.pick([word(), inlineToken(), '', 'a \\| b'])).join(' | ')} |`
    const sep = `|${Array.from({ length: cols }, () => rng.pick(['---', ':--', '--:', ':-:', '-'])).join('|')}|`
    const lines = [row(), sep, ...Array.from({ length: rng.int(0, 4) }, row)]
    if (rng.chance(0.15)) return lines.map(l => l.replace(/^\| | \|$/g, '')).join('\n') // pipe-less GFM form
    return lines.join('\n')
  }

  function htmlBlock() {
    return rng.pick([
      '<div>\nhtml block\n</div>',
      '<details>\n<summary>More</summary>\n\nhidden **text**\n</details>',
      '<!--\ncomment\n-->',
      '<table><tr><td>x</td></tr></table>',
      '<p align="center">\n  <img src="logo.png">\n</p>',
    ])
  }

  function edge() {
    return rng.pick([
      '```', '```js', '~~~', '*', '**', '***', '___', '- - -', '---', '* * *', '#', '######', '####### seven', '>', '> ', '-', '1.', '1)', '+',
      '   ', '\t', ' \n ', 'trailing spaces   ', '\\', '\\\n', '[ref]: https://example.com', '[^1]: footnote', 'Term\n: definition',
      '| lonely pipe', '<', '&', '\u0000nul', 'x'.repeat(rng.int(200, 2000)), Array.from({ length: 60 }, () => '*').join(' '),
      '[link](', '![](', '`unterminated', '**unterminated strong', '_a_b_c_', '1. a\n1. b\n1. c', '0. zero', '- [ ] task', '-not list', '#not heading',
    ])
  }

  function block() {
    const k = rng.weighted([[34, paragraph], [10, heading], [3, setext], [9, fence], [2, indentedCode], [12, list], [7, quote], [5, table], [3, htmlBlock], [4, () => rng.pick(['---', '***', '___', '- - -'])], [11, edge]])
    return k()
  }

  const n = size === 'small' ? rng.int(1, 3) : size === 'medium' ? rng.int(3, 9) : rng.int(10, 30)
  let doc = ''
  for (let i = 0; i < n; i += 1) {
    doc += (i ? rng.weighted([[60, '\n\n'], [20, '\n'], [8, '\n\n\n'], [5, '\n \n'], [3, '\n\t\n'], [4, '\n\n\n\n']]) : '') + block()
  }
  if (rng.chance(0.08)) doc = `\n\n${doc}`
  if (rng.chance(0.15)) doc = `${doc}${rng.pick(['\n', '\n\n', '  ', ' \n', '\n\n\n'])}`
  if (rng.chance(0.06)) doc = doc.replace(/\n/g, '\r\n')
  else if (rng.chance(0.01)) doc = doc.replace(/\n/g, '\r')
  return doc
}
