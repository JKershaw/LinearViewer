#!/usr/bin/env node
/**
 * scripts/figure-contact-sheet.mjs  (LIN-3351, dev tool — not wired into CI)
 *
 * Renders every Library figure as an <img> in a grid under a chosen
 * color-scheme and writes PNG sheets for eyeballing the dark-mode treatment.
 *
 *   node scripts/figure-contact-sheet.mjs <outDir> [dark|light] [perSheet]
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { FIGURES_DIR, listFigures } from './figure-theme.mjs';

const [outDir, scheme = 'dark', per = '8'] = process.argv.slice(2);
if (!outDir) { console.error('usage: figure-contact-sheet.mjs <outDir> [dark|light] [perSheet]'); process.exit(2); }
mkdirSync(outDir, { recursive: true });

const files = listFigures().sort();
const browser = await chromium.launch();
const page = await browser.newPage({ colorScheme: scheme, viewport: { width: 1000, height: 800 } });
const n = Number(per);
for (let i = 0; i * n < files.length; i++) {
  const cells = files.slice(i * n, (i + 1) * n).map(f =>
    `<figure><figcaption>${relative(FIGURES_DIR, f)}</figcaption><img src="file://${f}"></figure>`).join('');
  // file:// images are blocked from about:blank, so write the sheet to disk and open it.
  const htmlPath = join(outDir, `sheet-${scheme}-${String(i).padStart(2, '0')}.html`);
  writeFileSync(htmlPath, `<html style="color-scheme:${scheme}"><body style="margin:8px;background:${scheme === 'dark' ? '#16181d' : '#fff'};font:11px monospace;color:#888">
    <style>img{max-width:100%;color-scheme:${scheme};outline:1px solid #888}figure{margin:0 0 12px}</style>${cells}</body></html>`);
  await page.goto(`file://${htmlPath}`);
  await page.waitForFunction(() => [...document.images].every(im => im.complete));
  await page.screenshot({ path: join(outDir, `sheet-${scheme}-${String(i).padStart(2, '0')}.png`), fullPage: true });
}
await browser.close();
console.log(`${files.length} figures -> ${outDir}`);
