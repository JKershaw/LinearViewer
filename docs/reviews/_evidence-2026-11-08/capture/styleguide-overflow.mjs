/** LIN-4391 session 1: resolve the /styleguide 390px bodyOver:1 spike (docs-only check). */
import { chromium } from 'playwright';
const BASE = process.env.BASE_URL || 'http://localhost:3199';
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const out = {};
for (const theme of ['light', 'dark']) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  if (theme === 'dark') await ctx.addCookies([{ name: 'theme', value: 'dark', url: BASE }]);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/styleguide`, { waitUntil: 'load' });
  out[theme] = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const bodyRect = document.body.getBoundingClientRect();
    const offenders = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.right > vw + 0.5) offenders.push({ tag: el.tagName, cls: String(el.className).slice(0, 60), right: +r.right.toFixed(2) });
    }
    return {
      clientWidth: vw, scrollWidth: document.documentElement.scrollWidth, bodyOver: document.body.scrollWidth - document.body.clientWidth,
      bodyWidth: +bodyRect.width.toFixed(3), bodyRight: +bodyRect.right.toFixed(3),
      themeDark: document.documentElement.classList.contains('theme-dark'),
      offenders: offenders.slice(0, 10), offenderCount: offenders.length,
    };
  });
  await ctx.close();
}
await browser.close();
import { writeFileSync, mkdirSync } from 'node:fs';
mkdirSync(new URL('../remeasure/', import.meta.url), { recursive: true });
writeFileSync(new URL('../remeasure/styleguide-390-overflow.json', import.meta.url), JSON.stringify({ probe: 'styleguide-overflow.mjs', viewport: 390, out }, null, 1));
console.log(JSON.stringify(out, null, 1));
