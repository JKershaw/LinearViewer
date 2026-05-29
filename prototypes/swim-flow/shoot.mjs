import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

let chromium;
try { ({ chromium } = await import('playwright')); }
catch { ({ chromium } = await import('@playwright/test')); }

const here = dirname(fileURLToPath(import.meta.url));
const fileUrl = 'file://' + join(here, 'index.html');

const variants = process.argv.slice(2);
const combos = variants.length
  ? variants.map(s => { const [v, w] = s.split(':'); return { v, w: w || 'desktop' }; })
  : [
      { v: 'spine', w: 'desktop' }, { v: 'spine', w: 'mobile' },
      { v: 'hybrid', w: 'desktop' }, { v: 'hybrid', w: 'mobile' },
      { v: 'rail', w: 'desktop' }, { v: 'rail', w: 'mobile' }
    ];

const browser = await chromium.launch();
for (const { v, w } of combos) {
  const width = w === 'mobile' ? 430 : 1000;
  const page = await browser.newPage({ viewport: { width, height: 1400 }, deviceScaleFactor: 2 });
  await page.goto(`${fileUrl}?v=${v}&w=${w}`);
  await page.waitForTimeout(350);
  const out = join(here, 'screenshots', `${v}-${w}.png`);
  await page.screenshot({ path: out, fullPage: true });
  console.log('wrote', out);
  await page.close();
}
await browser.close();
