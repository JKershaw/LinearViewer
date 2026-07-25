/**
 * compare.mjs — measure the two shapes against each other (LIN-1412, beat 4).
 *
 *   node prototypes/lin-1412-chat/compare.mjs
 *
 * Analysis only: it drives the prototypes already built and reports numbers, so
 * the reachability matrix in the design comment is measured rather than
 * asserted. Nothing here has an opinion; `verify.mjs` owns pass/fail.
 */
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

let chromium;
try { ({ chromium } = await import('playwright')); }
catch { ({ chromium } = await import('@playwright/test')); }

const here = dirname(fileURLToPath(import.meta.url));
const url = (shape, scene, w) => `file://${join(here, `shape-${shape}.html`)}?scene=${scene}`;

const VIEWPORTS = { desktop: { width: 1100, height: 900 }, mobile: { width: 430, height: 900 } };

const browser = await chromium.launch();
const out = {};

for (const shape of ['a', 'b']) {
  out[shape] = {};
  for (const [name, vp] of Object.entries(VIEWPORTS)) {
    const page = await browser.newPage({ viewport: vp });
    await page.goto(url(shape, 'populated'));
    await page.waitForTimeout(500);

    const m = await page.evaluate(() => {
      const t = document.querySelector('[data-testid="chat-thread"]');
      const composer = document.querySelector('[data-testid="chat-composer"]');
      const doc = document.scrollingElement;

      // Reading area: how much of the viewport is transcript.
      const readingArea = t.clientHeight / window.innerHeight;

      // How much of ONE realistic agent answer is visible at once.
      const msgs = [...t.querySelectorAll('li.chat-msg')];
      const agent = msgs.find(li => li.textContent.includes('Short answer:'));
      const visibleFraction = (() => {
        if (!agent) return null;
        const tr = t.getBoundingClientRect(), ar = agent.getBoundingClientRect();
        const overlap = Math.max(0, Math.min(tr.bottom, ar.bottom) - Math.max(tr.top, ar.top));
        return overlap / ar.height;
      })();

      // Is the composer reachable without scrolling, from the top of the page?
      doc.scrollTop = 0;
      const cr = composer.getBoundingClientRect();
      const composerInView = cr.top >= 0 && cr.bottom <= window.innerHeight + 1;
      const composerGapFromBottom = window.innerHeight - cr.bottom;

      // How many scrollable boxes the reader has to reason about.
      const scrollers = [...document.querySelectorAll('*')].filter(el => {
        const oy = getComputedStyle(el).overflowY;
        return (oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 1;
      }).length + (doc.scrollHeight > doc.clientHeight + 1 ? 1 : 0);

      return {
        readingArea: Math.round(readingArea * 100),
        answerVisible: visibleFraction === null ? null : Math.round(visibleFraction * 100),
        composerInView,
        composerGapFromBottom: Math.round(composerGapFromBottom),
        scrollers,
        pageScrolls: doc.scrollHeight > doc.clientHeight + 1
      };
    });

    // Does jump-to-latest overlap message content, or sit clear of it?
    await page.goto(url(shape, 'long'));
    await page.waitForFunction(() => {
      const t = document.querySelector('[data-testid="chat-thread"]');
      return t.scrollHeight > t.clientHeight + 200;
    }, null, { timeout: 20000 });
    await page.$eval('[data-testid="chat-thread"]', t => { t.scrollTop = 0; });
    await page.waitForTimeout(900);
    m.jumpOverlapsContent = await page.evaluate(() => {
      const j = document.querySelector('[data-testid="chat-jump-latest"]');
      if (!j || j.hidden) return null;
      const jr = j.getBoundingClientRect();
      return [...document.querySelectorAll('[data-testid="chat-thread"] li')].some(li => {
        const r = li.getBoundingClientRect();
        return !(r.bottom < jr.top || r.top > jr.bottom || r.right < jr.left || r.left > jr.right);
      });
    });

    out[shape][name] = m;
    await page.close();
  }
}

await browser.close();

const row = (label, get) =>
  `${label.padEnd(42)} A: ${String(get(out.a.desktop)).padEnd(10)} B: ${String(get(out.b.desktop)).padEnd(10)}` +
  `  (mobile  A: ${String(get(out.a.mobile)).padEnd(8)} B: ${get(out.b.mobile)})`;

console.log('\nMeasured on the populated scene — same conversation, same layer, only the shape differs.\n');
console.log(row('reading area (% of viewport)', m => m.readingArea + '%'));
console.log(row('one agent answer visible at once (%)', m => m.answerVisible + '%'));
console.log(row('composer in view without scrolling', m => m.composerInView ? 'yes' : 'NO'));
console.log(row('composer gap from viewport bottom (px)', m => m.composerGapFromBottom));
console.log(row('scrollable boxes on the page', m => m.scrollers));
console.log(row('page itself scrolls', m => m.pageScrolls ? 'yes' : 'no'));
console.log(row('jump-to-latest overlaps content', m => m.jumpOverlapsContent === null ? 'n/a' : (m.jumpOverlapsContent ? 'YES' : 'no')));
console.log('');
