// display-diff.mjs <old adf.js> <new adf.js>: on the private real texts, count texts whose DISPLAY after a
// Jira round trip (marked.parse of adfToMarkdown(markdownToAdf(md))) differs, and whose gate verdict differs. Counts only.
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
const S = '/tmp/claude-0/-home-user/61183684-9674-527e-9fe5-98f9bb5cc446/scratchpad'
const { marked } = await import('/home/user/LinearViewer/node_modules/marked/lib/marked.esm.js')
const [o, n] = await Promise.all(process.argv.slice(2, 4).map(p => import(pathToFileURL(p).href)))
const t = JSON.parse(readFileSync(S + '/rebuild-exp1/private-corpus/real-markdown.json', 'utf8'))
const arr = (Array.isArray(t) ? t : (t.texts || t.items || Object.values(t))).map(x => typeof x === 'string' ? x : (x.markdown || x.text || x.description || ''))
const show = (m, s) => { try { const adf = m.markdownToAdf(s); return { html: marked.parse(m.adfToMarkdown(adf)), gate: m.adfHasUnrenderableContent(adf) } } catch (e) { return { html: 'THROW', gate: 'THROW' } } }
let display = 0, gate = 0, throwsNew = 0, origVsNew = 0
for (const s of arr) {
  const a = show(o, s), b = show(n, s)
  if (a.html !== b.html) display++
  if (a.gate !== b.gate) gate++
  if (b.html === 'THROW' && a.html !== 'THROW') throwsNew++
}
console.log(JSON.stringify({ texts: arr.length, displayDiffers: display, gateDiffers: gate, newThrows: throwsNew }))
