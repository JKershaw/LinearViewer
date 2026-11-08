/** LIN-4391 session 1: re-measure run-9 finding 10 (h1 count per Library document) across the 117-document catalogue. */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
const BASE = process.env.BASE_URL || 'http://localhost:3199';
const census = JSON.parse(readFileSync(new URL('../census.json', import.meta.url), 'utf8'));
const slugs = Object.values(census.entries).filter(e => e.id.startsWith('library-doc:')).map(e => Object.values(e.themes)[0].finalUrl);
const b = await chromium.launch({ args: ['--no-sandbox'] });
const p = await (await b.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
const hist = {}; const rows = [];
for (const s of slugs) {
  await p.goto(BASE + s, { waitUntil: 'load' });
  const r = await p.evaluate(() => ({ h1: [...document.querySelectorAll('h1')].map(h => h.textContent.trim().slice(0, 60)) }));
  hist[r.h1.length] = (hist[r.h1.length] || 0) + 1;
  rows.push({ slug: s, ...r });
}
await b.close();
mkdirSync(new URL('../remeasure/', import.meta.url), { recursive: true });
writeFileSync(new URL('../remeasure/library-h1.json', import.meta.url), JSON.stringify({ probe: 'library-h1.mjs', documents: slugs.length, h1CountHistogram: hist, rows }, null, 1));
console.log(JSON.stringify({ documents: slugs.length, hist }));
