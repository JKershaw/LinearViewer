/**
 * LIN-3751: re-render the four account-home cells. Beat 1's synthetic input passed emails as objects
 * ([{address}]) but the production caller (routes/email-auth.js /account) passes string[] from
 * accountStore.listEmailIdentities, so the original PNGs showed "Signed in as [object Object]" -- a harness
 * input error, NOT a product defect. renderer-args.mjs is corrected; the cells are re-rendered here.
 */
import { chromium } from 'playwright';
import { writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RENDERERS } from './renderer-args.mjs';
const EVID = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.BASE_URL || 'http://localhost:3199';
const html = RENDERERS.renderAccountHomePage();
const b = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const out = [];
for (const theme of ['light', 'dark']) for (const w of [1400, 390]) {
  const ctx = await b.newContext({ viewport: { width: w, height: w > 600 ? 1000 : 844 }, colorScheme: theme });
  await ctx.addCookies([{ name: 'theme', value: theme, url: BASE }]);
  const page = await ctx.newPage();
  await page.route('**/*', r => r.request().resourceType() === 'document' ? r.fulfill({ status: 200, body: html, contentType: 'text/html' }) : r.continue());
  await page.goto(`${BASE}/__intercept__`, { waitUntil: 'load' }); await page.waitForTimeout(300);
  const t = await page.evaluate(() => ({ htmlClass: document.documentElement.className, who: document.querySelector('[data-testid=account-home-email]')?.textContent }));
  const f = `account-home-${theme}-${w}px`;
  await page.screenshot({ path: path.join(EVID, `${f}.png`) });
  const j = JSON.parse(await readFile(path.join(EVID, `${f}.json`), 'utf8'));
  j.correction = { by: 'LIN-3751', note: 'Re-rendered with emails as string[] (production shape). Original PNG showed "Signed in as [object Object]" from a beat-1 synthetic input error, not a product defect. Measurements below are from the original render; the text node is the only difference.', whoAfter: t.who };
  await writeFile(path.join(EVID, `${f}.json`), JSON.stringify(j, null, 2));
  out.push(`${f} ${t.who} ${t.htmlClass}`); await ctx.close();
}
await b.close(); console.log(out.join('\n'));
