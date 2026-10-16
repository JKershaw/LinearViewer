// display-kinds.mjs <old> <new>: for real texts whose round-trip display differs, aggregate tag-count deltas
// and text-length deltas (structure only; no content printed)
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
const S = '/tmp/claude-0/-home-user/61183684-9674-527e-9fe5-98f9bb5cc446/scratchpad'
const { marked } = await import('/home/user/LinearViewer/node_modules/marked/lib/marked.esm.js')
const [o, n] = await Promise.all(process.argv.slice(2, 4).map(p => import(pathToFileURL(p).href)))
const t = JSON.parse(readFileSync(S + '/rebuild-exp1/private-corpus/real-markdown.json', 'utf8'))
const arr = (Array.isArray(t) ? t : (t.texts || t.items || Object.values(t))).map(x => typeof x === 'string' ? x : (x.markdown || x.text || x.description || ''))
const tags = ['p', 'br', 'li', 'ul', 'ol', 'h1', 'h2', 'h3', 'h4', 'code', 'pre', 'em', 'strong', 'del', 'a', 'blockquote', 'hr', 'table']
const count = h => Object.fromEntries(tags.map(g => [g, (h.match(new RegExp('<' + g + '[ >/]', 'g')) || []).length]))
const txt = h => h.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
const rt = (m, s) => marked.parse(m.adfToMarkdown(m.markdownToAdf(s)))
const agg = {}; let n0 = 0, textSame = 0, textChanged = 0
for (const s of arr) {
  const a = rt(o, s), b = rt(n, s); if (a === b) continue; n0++
  const ca = count(a), cb = count(b)
  for (const g of tags) { const d = cb[g] - ca[g]; if (d) { agg[g] ??= { texts: 0, net: 0 }; agg[g].texts++; agg[g].net += d } }
  if (txt(a) === txt(b)) textSame++; else textChanged++
}
console.log(JSON.stringify({ differing: n0, visibleTextSame: textSame, visibleTextChanged: textChanged, tagDeltas: agg }))
