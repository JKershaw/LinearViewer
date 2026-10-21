/**
 * LIN-3751: cookie-dark recapture of the beat-2 public cells whose media-emulated "dark" rendered light
 * (dark-cell-audit.json). theme-dark is asserted in the same read; output -> remeasure/dark-recapture/.
 */
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const EVID = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(EVID, 'remeasure', 'dark-recapture');
const BASE = process.env.BASE_URL || 'http://localhost:3199';
const CELLS = [['ship-public', '/ship'], ['swim-public', '/swim'], ['swipe-public', '/swipe/LV-2'], ['email-signin-real', '/auth/email'], ['email-confirm-real', '/auth/email/confirm'], ['held-404', '/connect/nope/held'], ['held-expired', '/connect/github/held'], ['library-404', '/library/no-such-document']];
await mkdir(OUT, { recursive: true });
const b = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const rows = [];
for (const [name, p] of CELLS) {
  const ctx = await b.newContext({ viewport: { width: 1400, height: 1000 } });
  await ctx.addCookies([{ name: 'theme', value: 'dark', url: BASE }]);
  const page = await ctx.newPage();
  const r = await page.goto(`${BASE}${p}`, { waitUntil: 'load' }); await page.waitForTimeout(400);
  const read = await page.evaluate(() => ({ htmlClass: document.documentElement.className, bodyBg: getComputedStyle(document.body).backgroundColor, title: document.title }));
  const ok = read.htmlClass.split(/\s+/).includes('theme-dark');
  if (ok) await page.screenshot({ path: path.join(OUT, `${name}-cookie-dark-1400px.png`) });
  rows.push({ name, path: p, status: r.status(), ...read, themeAssertionPassed: ok });
  await ctx.close();
}
await b.close();
await writeFile(path.join(OUT, 'dark-recapture.json'), JSON.stringify({ note: 'cookie-dark recapture, theme-dark asserted in the same read', rows }, null, 2));
console.log(rows.map(r => `${r.name} ${r.status} ${r.themeAssertionPassed} ${r.bodyBg}`).join('\n'));
