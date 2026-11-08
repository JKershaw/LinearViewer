/** LIN-4391 session 1: measure the computed font sizes of the public Ship radial labels at default zoom (1400 and 390). */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
const BASE = process.env.BASE_URL || 'http://localhost:3199';
const b = await chromium.launch({ args: ['--no-sandbox'] });
const out = {};
for (const w of [1400, 390]) {
  const p = await (await b.newContext({ viewport: { width: w, height: 1000 } })).newPage();
  await p.goto(BASE + '/ship', { waitUntil: 'load' });
  out[w] = await p.evaluate(() => {
    const texts = [...document.querySelectorAll('body *')].filter(el => el.children.length === 0 && el.textContent.trim().length > 1 && el.getBoundingClientRect().width > 0);
    const hist = {};
    for (const el of texts) { const fs = getComputedStyle(el).fontSize; hist[fs] = (hist[fs] || 0) + 1; }
    const zoomEl = [...document.querySelectorAll('button,span,div')].find(e => /^\s*45%\s*$/.test(e.textContent));
    return { leafTextElements: texts.length, fontSizeHistogram: Object.fromEntries(Object.entries(hist).sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]))), zoomLabel: zoomEl ? zoomEl.textContent.trim() : null };
  });
}
await b.close();
mkdirSync(new URL('../remeasure/', import.meta.url), { recursive: true });
writeFileSync(new URL('../remeasure/ship-public-type.json', import.meta.url), JSON.stringify({ probe: 'ship-public-type.mjs', out }, null, 1));
console.log(JSON.stringify(out));
