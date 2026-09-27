/**
 * LIN-3101 metric validation (throwaway — not part of the capture tool proper).
 *
 * Proves three things about the measurement primitives in capture.mjs, using a
 * THROWAWAY page (page.setContent) for the overflow checks so no product file is
 * touched:
 *
 *   A. The overflow detector flags a real, unclipped horizontal overflow.
 *   B. The same detector does NOT flag an element whose overflow is clipped by
 *      an ancestor with overflow-x: auto|scroll|hidden|clip (so a scrollable
 *      table doesn't read as a page-level overflow).
 *   C. The DOM h1–h6 census and the accessibility-tree census (getByRole) agree
 *      on a real page (/styleguide).
 *
 * Run (server must be up):
 *   PLAYWRIGHT_BROWSERS_PATH=... BASE_URL=http://localhost:3199 \
 *   node docs/reviews/_evidence-2026-09-26/capture/validate-metrics.mjs
 */

import { chromium } from 'playwright';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3199';

// The SAME detector shipped in capture.mjs (kept in sync by hand).
const OVERFLOW_DETECTOR = `(() => {
  const de = document.documentElement;
  const innerWidth = window.innerWidth;
  const offenders = [];
  for (const el of document.querySelectorAll('*')) {
    const r = el.getBoundingClientRect();
    if (r.right <= innerWidth + 1) continue;
    let clipped = false;
    let a = el.parentElement;
    while (a) { const cs = getComputedStyle(a); if (/(auto|scroll|hidden|clip)/.test(cs.overflowX)) { clipped = true; break; } a = a.parentElement; }
    if (!clipped) offenders.push(el.getAttribute('data-tag') || el.tagName.toLowerCase());
  }
  return { scrollWidth: de.scrollWidth, clientWidth: de.clientWidth, innerWidth, offenders };
})()`;

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

// --- A + B: throwaway overflow page ---
const ctx = await browser.newContext({ viewport: { width: 300, height: 400 } });
const page = await ctx.newPage();

await page.setContent(`
  <style>
    body { margin: 0; }
    #wide { width: 500px; height: 20px; background: red; }
    #clip { overflow-x: auto; width: 300px; }
    #wide-clipped { width: 500px; height: 20px; background: blue; }
  </style>
  <div id="wide" data-tag="wide-unclipped"></div>
  <div id="clip"><div id="wide-clipped" data-tag="wide-clipped"></div></div>
`);

const a = await page.evaluate(OVERFLOW_DETECTOR);
const A = a.offenders.includes('wide-unclipped') && a.scrollWidth > a.clientWidth;
const B = !a.offenders.includes('wide-clipped');
console.log('A) real unclipped overflow flagged:', A, '→', JSON.stringify(a));
console.log('B) clipped-by-ancestor overflow NOT flagged:', B);

// --- C: heading census agreement on /styleguide ---
const page2 = await ctx.newPage();
await page2.goto(`${BASE_URL}/styleguide`, { waitUntil: 'load' });
await page2.waitForTimeout(300);
const domCounts = await page2.evaluate(() => {
  const c = {};
  document.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach(h => { const t = h.tagName.toLowerCase(); c[t] = (c[t] || 0) + 1; });
  return c;
});
const a11y = {};
let a11yTotal = 0;
for (let lvl = 1; lvl <= 6; lvl += 1) {
  const n = await page2.getByRole('heading', { level: lvl }).count();
  a11y['h' + lvl] = n;
  a11yTotal += n;
}
const domTotal = Object.values(domCounts).reduce((s, n) => s + n, 0);
const agree = Object.entries(domCounts).every(([tag, n]) => (a11y[tag] ?? 0) === n) && domTotal === a11yTotal;
console.log('C) heading census DOM vs a11y:');
console.log('   DOM :', domCounts, '=', domTotal);
console.log('   a11y:', a11y, '=', a11yTotal);
console.log('   agree:', agree);

await browser.close();
process.exit(A && B && agree ? 0 : 1);