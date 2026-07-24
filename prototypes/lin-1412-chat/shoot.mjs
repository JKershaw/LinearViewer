/**
 * shoot.mjs — screenshot the LIN-1412 chat prototypes.
 *
 * Modelled on prototypes/swim-flow/shoot.mjs: no server, no fixtures, just
 * Playwright over the file:// page.
 *
 *   node prototypes/lin-1412-chat/shoot.mjs                 # the default set
 *   node prototypes/lin-1412-chat/shoot.mjs populated:dark:desktop
 *
 * Console errors are reported — a prototype that throws is not evidence.
 */
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

let chromium;
try { ({ chromium } = await import('playwright')); }
catch { ({ chromium } = await import('@playwright/test')); }

const here = dirname(fileURLToPath(import.meta.url));
const page1 = 'file://' + join(here, 'shape-a.html');

const args = process.argv.slice(2);
const combos = args.length
  ? args.map(s => { const [scene, theme, w] = s.split(':'); return { scene, theme: theme || 'light', w: w || 'desktop' }; })
  : [
      { scene: 'empty', theme: 'light', w: 'desktop' },
      { scene: 'populated', theme: 'light', w: 'desktop' },
      { scene: 'populated', theme: 'dark', w: 'desktop' },
      { scene: 'populated', theme: 'light', w: 'mobile' },
      { scene: 'populated', theme: 'dark', w: 'mobile' },
      { scene: 'thinking', theme: 'light', w: 'desktop' },
      { scene: 'long', theme: 'light', w: 'desktop' },
      { scene: 'error', theme: 'dark', w: 'desktop' },
      { scene: 'limited', theme: 'light', w: 'desktop' }
    ];

// Scenes that need time to reach the moment worth capturing.
const SETTLE = { empty: 300, populated: 500, thinking: 900, long: 1600, error: 1400, limited: 500 };

const browser = await chromium.launch();
let failures = 0;

for (const { scene, theme, w } of combos) {
  const width = w === 'mobile' ? 430 : 1100;
  const page = await browser.newPage({ viewport: { width, height: 1200 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => {
    // The console 'error' for a failed subresource carries no URL, so the
    // requestfailed handler below is the one that can tell fonts apart.
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text());
  });
  // public/style.css declares its faces at root-absolute `/fonts/*.woff2`, which
  // only a server can resolve. shape-a.html re-declares the same files by
  // relative path, so the faces DO render — but Chromium still logs the first
  // attempt. Expected under file://, and the price of linking the real
  // stylesheet rather than a copy of it.
  const ignorable = url => /\/fonts\/[\w-]+\.woff2$/.test(url);
  page.on('requestfailed', r => { if (!ignorable(r.url())) errors.push(`request failed: ${r.url()}`); });

  await page.goto(`${page1}?scene=${scene}&theme=${theme}`);
  await page.waitForTimeout(SETTLE[scene] ?? 500);

  // The long-stream scene is the §9 proof: scroll the THREAD up mid-stream and
  // capture that the position holds and jump-to-latest appears.
  if (scene === 'long') {
    // Scrolling a thread that is not yet overflowing is a no-op that fires no
    // scroll event, so wait until it genuinely scrolls before proving anything.
    await page.waitForFunction(() => {
      const t = document.getElementById('thread');
      return t.scrollHeight > t.clientHeight + 200;
    }, null, { timeout: 15000 });
    await page.evaluate(() => { document.getElementById('thread').scrollTop = 0; });
    await page.waitForTimeout(1500);
    const held = await page.evaluate(() => document.getElementById('thread').scrollTop);
    const jumpVisible = await page.isVisible('[data-testid="chat-jump-latest"]');
    console.log(`  §9 proof — thread.scrollTop after 1.2s of streaming: ${held} (expect 0); jump-to-latest visible: ${jumpVisible}`);
    if (held !== 0 || !jumpVisible) { failures++; console.log('  ✗ §9 PROOF FAILED'); }
  }

  const out = join(here, 'screenshots', `shape-a-${scene}-${theme}-${w}.png`);
  await page.screenshot({ path: out, fullPage: true });
  console.log('wrote', out);
  if (errors.length) { failures++; console.log('  ✗ console errors:', errors.slice(0, 4)); }
  await page.close();
}

await browser.close();
if (failures) { console.log(`\n${failures} problem(s)`); process.exit(1); }
console.log('\nno console errors; §9 proof held');
