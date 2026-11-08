/** LIN-4391: reachability witness for LIN-3761 — is the widest Library table inside a scroller that can scroll? */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
const BASE = process.env.BASE_URL || 'http://localhost:3199';
const DOCS = ['/library/which-rules-pay', '/library/coherence-as-it-grows', '/library/between-the-sessions-check'];
const b = await chromium.launch({ args: ['--no-sandbox'] });
const rows = [];
for (const w of [390, 320]) {
  const p = await (await b.newContext({ viewport: { width: w, height: 800 } })).newPage();
  for (const slug of DOCS) {
    const res = await p.goto(BASE + slug, { waitUntil: 'load' });
    rows.push({ slug, width: w, status: res.status(), ...(await p.evaluate(() => {
      const ts = [...document.querySelectorAll('.library-doc__body table')];
      if (!ts.length) return { tables: 0 };
      const t = ts.sort((a, c) => c.getBoundingClientRect().width - a.getBoundingClientRect().width)[0];
      let scroller = null;
      for (let e = t.parentElement; e && e !== document.body; e = e.parentElement) { if (/auto|scroll/.test(getComputedStyle(e).overflowX)) { scroller = e; break; } }
      if (!scroller) return { tables: ts.length, scroller: null, tableRight: Math.round(t.getBoundingClientRect().right) };
      const before = scroller.scrollLeft; scroller.scrollLeft = 9999; const after = scroller.scrollLeft; scroller.scrollLeft = before;
      return { tables: ts.length, scrollerClass: scroller.className, scrollerClientWidth: scroller.clientWidth, scrollerScrollWidth: scroller.scrollWidth, scrolledTo: after, reachable: after > 0 };
    }))});
  }
}
await b.close();
mkdirSync(new URL('../remeasure/', import.meta.url), { recursive: true });
writeFileSync(new URL('../remeasure/library-table-reach.json', import.meta.url), JSON.stringify({ probe: 'library-table-reach.mjs', rows }, null, 1));
console.log(JSON.stringify(rows));
