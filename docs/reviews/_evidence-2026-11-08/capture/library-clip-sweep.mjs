/**
 * LIN-4391 session 1: re-measure LIN-3761 (Library wide tables clipped at phone width) across
 * every Library document, by element geometry (not scrollWidth, which is vacuous under
 * overflow-x: clip). Docs-only probe; writes remeasure/library-clip-sweep.json.
 */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:3199';
const b = await chromium.launch({ args: ['--no-sandbox'] });
// The census catalogue (117 library-doc ids, from loadLibrary) is the full set; the /library index links only 80 of them.
const census = JSON.parse(readFileSync(new URL('../census.json', import.meta.url), 'utf8'));
const slugs = Object.values(census.entries).filter(e => e.id.startsWith('library-doc:')).map(e => Object.values(e.themes)[0].finalUrl);
const out = { base: BASE, documents: slugs.length, widths: {}, perDoc: [] };
for (const w of [390, 320]) {
  const ctx = await b.newContext({ viewport: { width: w, height: 800 } });
  const p = await ctx.newPage();
  let clipped = 0, nonOk = 0, tableClipped = 0;
  const rows = [];
  for (const slug of slugs) {
    const res = await p.goto(BASE + slug, { waitUntil: 'load' });
    const r = await p.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const hasScroller = el => { for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) { if (/auto|scroll/.test(getComputedStyle(e).overflowX)) return true; } return false; };
      const over = [];
      for (const el of document.querySelectorAll('.library-doc__body *')) {
        const rc = el.getBoundingClientRect();
        if (rc.width === 0) continue;
        if (rc.right > vw + 1 && !hasScroller(el)) over.push({ tag: el.tagName.toLowerCase(), right: Math.round(rc.right) });
      }
      const tables = [...document.querySelectorAll('.library-doc__body table')];
      const tableOver = tables.some(t => t.getBoundingClientRect().right > vw + 1 && !hasScroller(t));
      return { vw, overCount: over.length, sample: over.slice(0, 3), tableOver, tables: tables.length };
    });
    const isClip = r.overCount > 0;
    if (isClip) clipped++;
    if (r.tableOver) tableClipped++;
    if (res.status() !== 200) nonOk++;
    rows.push({ slug, status: res.status(), ...r });
  }
  out.widths[w] = { documentsWithOverflowPastViewport: clipped, documentsWithUnscrolledTableOverflow: tableClipped, non200: nonOk, total: slugs.length };
  out.perDoc.push(...rows.map(x => ({ width: w, ...x })));
  await ctx.close();
}
await b.close();
mkdirSync(new URL('../remeasure/', import.meta.url), { recursive: true });
writeFileSync(new URL('../remeasure/library-clip-sweep.json', import.meta.url), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out.widths), 'documents', out.documents);
