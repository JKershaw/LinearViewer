/**
 * LIN-3752 (beat 5): fresh witness for the Library wide-table finding.
 * Usage (repo root, :3199 booted by boot-3199.mjs):  node docs/reviews/_evidence-2026-10-21/capture/library-table-clip.mjs
 * Writes remeasure/library-table-clip.json. Docs-only tooling.
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:3199';
const DOCS = ['/library/which-rules-pay', '/library/coherence-as-it-grows', '/library/between-the-sessions-check'];
const b = await chromium.launch();
const rows = [];
for (const w of [390, 320]) {
  const p = await (await b.newContext({ viewport: { width: w, height: 800 } })).newPage();
  for (const slug of DOCS) {
    await p.goto(BASE + slug);
    rows.push({ slug, width: w, ...(await p.evaluate(() => {
      const t = [...document.querySelectorAll('.library-doc__body table')].sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right)[0]; // widest table
      const cells = [...t.querySelectorAll('th,td')];
      let scroller = null;
      for (let e = t.parentElement; e && e !== document.body; e = e.parentElement) {
        if (/auto|scroll|hidden|clip/.test(getComputedStyle(e).overflowX)) { scroller = e.className; break; }
      }
      window.scrollTo(9999, 0);
      return {
        viewport: document.documentElement.clientWidth,
        tables: document.querySelectorAll('.library-doc__body table').length,
        tableLeft: Math.round(t.getBoundingClientRect().left),
        tableRight: Math.round(t.getBoundingClientRect().right),
        maxCellRight: Math.round(Math.max(...cells.map(c => c.getBoundingClientRect().right))),
        scrolledX: window.scrollX,
        rootOverflowX: getComputedStyle(document.documentElement).overflowX,
        bodyOverflowX: getComputedStyle(document.body).overflowX,
        containingScroller: scroller,
      };
    })) });
  }
}
await b.close();
writeFileSync(new URL('../remeasure/library-table-clip.json', import.meta.url), JSON.stringify({ base: BASE, rows }, null, 2));
console.log(JSON.stringify(rows, null, 1));
