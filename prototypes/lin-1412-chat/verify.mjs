/**
 * verify.mjs — drive the prototypes and assert the contract, rule by rule.
 *
 *   node prototypes/lin-1412-chat/verify.mjs           # both shapes
 *   node prototypes/lin-1412-chat/verify.mjs a         # one shape
 *
 * This is the point of building interactive prototypes rather than PNGs: a
 * screenshot cannot show a scroll hijack NOT happening, a draft surviving an
 * error, or focus returning. Every assertion uses a technique that already
 * exists in tests/e2e/ (boundingBox, keyboard.press, focus checks, computed
 * style) EXCEPT the scroll-position reads, which beat 4 identified as the one
 * genuinely new technique — so this doubles as proof that the measurement plan
 * in plans/lin-1412-design-notes.md §3 is buildable.
 *
 * Both shapes run the SAME contract block, from the same scenes module and the
 * same behaviour layer, so a difference in the results is a difference in the
 * shape and nothing else. Shape B then gets the extra rules only it can reach.
 *
 * It is NOT a CI gate: it drives prototypes with a mock transport, not the four
 * live surfaces.
 */
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';

let chromium;
try { ({ chromium } = await import('playwright')); }
catch { ({ chromium } = await import('@playwright/test')); }

const here = dirname(fileURLToPath(import.meta.url));
const pageUrl = (shape) => 'file://' + join(here, `shape-${shape}.html`);

const thread = '[data-testid="chat-thread"]';
const send = '[data-testid="chat-send"]';
const input = '#composer-input';
const jump = '[data-testid="chat-jump-latest"]';
const composer = '[data-testid="chat-composer"]';

const wanted = process.argv.slice(2).map(s => s.toLowerCase());
const shapes = wanted.length ? wanted : ['a', 'b'];

const browser = await chromium.launch();
const totals = {};
const metrics = {};

for (const shape of shapes) {
  console.log(`\n── Shape ${shape.toUpperCase()} ${'─'.repeat(52)}`);
  const results = [];
  const check = (rule, ok, detail) => {
    results.push({ rule, ok });
    console.log(`${ok ? '  ok  ' : '  FAIL'} ${rule}${detail !== undefined ? ' — ' + detail : ''}`);
  };

  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));

  const threadMetrics = () => page.$eval(thread, t => ({
    top: t.scrollTop, height: t.scrollHeight, client: t.clientHeight,
    overflowY: getComputedStyle(t).overflowY
  }));

  const fresh = async (scene) => {
    await page.goto(`${pageUrl(shape)}${scene ? '?scene=' + scene : ''}`);
    await page.waitForTimeout(250);
  };

  // ── §11 semantics ─────────────────────────────────────────────────────────
  await fresh();
  check('§11 transcript is role="log" with a polite live region',
    await page.$eval(thread, t => t.getAttribute('role') === 'log' && t.getAttribute('aria-live') === 'polite'));

  // ── §6.3 empty send blocked, and the disabled state RENDERED ─────────────
  check('§6.3 send is disabled (rendered) with an empty composer',
    await page.$eval(send, b => b.disabled));

  // ── §6.8 target size ──────────────────────────────────────────────────────
  const box = await page.locator(send).boundingBox();
  check("§6.8 send meets Harbour's own 40px floor (LIN-786)", box.height >= 40, `${Math.round(box.height)}px`);

  // ── §6.1 auto-grow ────────────────────────────────────────────────────────
  const h0 = (await page.locator(input).boundingBox()).height;
  await page.fill(input, 'one\ntwo\nthree\nfour');
  await page.waitForTimeout(120);
  const hGrown = (await page.locator(input).boundingBox()).height;
  check('§6.1 textarea auto-grows with content', hGrown > h0 + 20, `${Math.round(h0)}px → ${Math.round(hGrown)}px`);

  // ── §6.2 Shift+Enter ──────────────────────────────────────────────────────
  await page.fill(input, 'draft');
  await page.focus(input);
  await page.keyboard.press('Shift+Enter');
  check('§6.2 Shift+Enter inserts a newline and sends nothing',
    (await page.$eval(input, i => i.value)).includes('\n')
    && (await page.$$eval(thread + ' > li', n => n.length)) === 0);

  // ── §6.2 / §7.2 Enter sends, optimistically ──────────────────────────────
  await page.fill(input, 'why is the collective scroll check wrong?');
  await page.focus(input);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(120);   // the mock's first token is 700ms away
  check('§7.2 the user turn is in the DOM before any response arrives',
    await page.$eval(thread, t => {
      const li = t.querySelector('li');
      return li ? li.textContent.includes('why is the collective') : false;
    }));
  check('§6.5 the composer cleared on send', (await page.$eval(input, i => i.value)) === '');
  check('§6.5 focus returned to the composer', await page.$eval(input, i => i === document.activeElement));
  check('§6.5 the composer is NOT disabled during generation', !(await page.$eval(input, i => i.disabled)));

  // ── §7.3 thinking indicator ───────────────────────────────────────────────
  check('§7.3 a thinking indicator is showing before the first token',
    await page.$eval(thread, t => !!t.querySelector('.chat-cursor')));

  // ── §6.4 Stop ─────────────────────────────────────────────────────────────
  check('§6.4 the send control became Stop during generation',
    (await page.$eval(send, b => b.textContent.trim())) === 'Stop');
  await page.click(send);
  await page.waitForTimeout(400);
  check('§6.4 Stop actually stops, and the control reverts',
    (await page.$eval(thread, t => t.textContent)).includes('stopped by you')
    && (await page.$eval(send, b => b.textContent.trim())) === 'Send');

  // ── §9 scroll ─────────────────────────────────────────────────────────────
  await fresh('long');
  await page.waitForFunction(() => {
    const t = document.querySelector('[data-testid="chat-thread"]');
    return t.scrollHeight > t.clientHeight + 200;
  }, null, { timeout: 20000 });

  const m0 = await threadMetrics();
  check('§9 the thread is its OWN scroller (the box C1 says to measure)',
    m0.overflowY === 'auto' && m0.height > m0.client);

  await page.$eval(thread, t => { t.scrollTop = t.scrollHeight; });
  await page.waitForTimeout(700);
  const mFollow = await threadMetrics();
  check('§9.1 follows new content while the reader is at the bottom',
    mFollow.height - mFollow.top - mFollow.client <= 120);

  await page.$eval(thread, t => { t.scrollTop = 0; });
  await page.waitForTimeout(1500);
  const mHeld = await threadMetrics();
  check('§9.1 does NOT hijack a reader who scrolled up mid-stream',
    mHeld.top === 0, `scrollTop=${mHeld.top} after 1.5s of streaming`);

  check('§9.2 a jump-to-latest affordance appeared instead', await page.isVisible(jump));
  check('§9.2 it counts a streaming reply as one pending thing, not one per repaint',
    (await page.$eval(jump, b => b.textContent)).includes('new reply'),
    (await page.$eval(jump, b => b.textContent.trim())));

  if (await page.isVisible(jump)) await page.click(jump);
  await page.waitForTimeout(700);
  const mJumped = await threadMetrics();
  check('§9.2 clicking it returns to the bottom',
    mJumped.height - mJumped.top - mJumped.client <= 120);

  // Comparative metric, not a pass/fail: how much of the viewport is reading area.
  metrics[shape] = await page.evaluate(() => {
    const t = document.querySelector('[data-testid="chat-thread"]');
    return { readingArea: Math.round(t.clientHeight / window.innerHeight * 100), viewport: window.innerHeight };
  });

  // ── §7.5 / §6.6 error, Retry, surviving draft ────────────────────────────
  await fresh('error');
  await page.waitForTimeout(1600);
  check('§7.5 the error is attached to the failed turn',
    await page.$eval(thread, t => !!t.querySelector('.chat-msg--failed')));
  check('§7.5 the failed turn carries a Retry control',
    await page.$eval(thread, t => {
      const b = t.querySelector('.chat-msg__retry');
      return !!b && b.textContent.trim() === 'Retry';
    }));
  check('§7.5 the message states the failure, not a stack trace and not "something went wrong"',
    await page.$eval(thread, t => /upstream 502/.test(t.querySelector('.chat-msg__error').textContent)));
  check('§6.6 the draft came back after the failure',
    (await page.$eval(input, i => i.value)).includes('what broke in run 3'));

  // ── §7.6 blocked input ────────────────────────────────────────────────────
  await fresh('limited');
  await page.waitForTimeout(300);
  const notice = await page.$eval('.chat-notice', n => n.textContent);
  check('§7.6 a blocked composer says what and for how long',
    /Free-tier limit/.test(notice) && /midnight UTC/.test(notice));
  check('§7.6 the draft survives the block', (await page.$eval(input, i => i.value)).length > 0);

  // ── §4 markdown + code ────────────────────────────────────────────────────
  await fresh('populated');
  await page.waitForTimeout(400);
  check('§4.1/§4.2 markdown renders as real elements, not escaped text',
    await page.$eval(thread, t => !!t.querySelector('.chat-md h3') && !!t.querySelector('.chat-md ul li')));
  check('§4.3 the fenced block carries a language label',
    (await page.$eval('.chat-code__lang', e => e.textContent.trim())) === 'js');
  check('§4.3 the fenced block has a copy button', await page.isVisible('.chat-code__copy'));
  check('§4.3 a wide block scrolls INSIDE itself rather than clipping',
    await page.$eval('.chat-code pre', p => {
      const cs = getComputedStyle(p);
      return cs.overflowX === 'auto' && p.scrollWidth > p.clientWidth;
    }));
  check('§4.5 identity is shown once per speaker group',
    await page.$eval(thread, t => {
      const stacked = t.querySelectorAll('.chat-msg--stacked');
      return stacked.length > 0 && [...stacked].every(li => getComputedStyle(li.querySelector('.chat-msg__who')).display === 'none');
    }));

  // ── §2 applied ────────────────────────────────────────────────────────────
  const size = await page.$eval('.chat-msg__text', e => getComputedStyle(e).fontSize);
  check('§2 message prose is 15px (the §5 floor, kept)', size === '15px', size);
  check('§2 prose is the sans face', /Inter/.test(await page.$eval('.chat-md p', e => getComputedStyle(e).fontFamily)));
  check('§2 code is JetBrains Mono', /JetBrains/.test(await page.$eval('.chat-code pre code', e => getComputedStyle(e).fontFamily)));

  // ── §10 the page must never scroll horizontally, at any width ────────────
  // The guide's phrasing: a wide code block scrolls inside its block "without
  // breaking the page layout". Checked at a real mobile width because that is
  // where it breaks — a flex ancestor with the default `min-width: auto` is
  // dragged wider than the viewport by one long code line.
  await page.setViewportSize({ width: 430, height: 900 });
  await fresh('populated');
  await page.waitForTimeout(400);
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return { docWidth: doc.scrollWidth, viewport: window.innerWidth };
  });
  check('§10 no horizontal page overflow at 430px',
    overflow.docWidth <= overflow.viewport + 1,
    `document scrollWidth ${overflow.docWidth} vs viewport ${overflow.viewport}`);
  check('§10 the wide code block still scrolls inside itself at 430px',
    await page.$eval('.chat-code pre', p => p.scrollWidth > p.clientWidth));
  await page.setViewportSize({ width: 1100, height: 900 });

  // ── the rules only Shape B can reach ─────────────────────────────────────
  if (shape === 'b') {
    const geom = await page.evaluate(() => {
      const c = document.querySelector('[data-testid="chat-page-footer"]').getBoundingClientRect();
      const shell = document.querySelector('.chat-page').getBoundingClientRect();
      const doc = document.scrollingElement;
      return {
        composerBottom: c.bottom, composerTop: c.top,
        shellHeight: shell.height, innerHeight: window.innerHeight,
        docScrollable: doc.scrollHeight > doc.clientHeight + 1
      };
    });
    check('§3 the composer is anchored to the VIEWPORT bottom',
      Math.abs(geom.composerBottom - geom.innerHeight) <= 1,
      `composer bottom ${Math.round(geom.composerBottom)} vs viewport ${geom.innerHeight}`);
    check('§3 the page itself does not scroll — the thread is the one scroller',
      !geom.docScrollable);
    check('§10 the shell is sized in dynamic viewport units (the keyboard mechanism)',
      Math.abs(geom.shellHeight - geom.innerHeight) <= 1,
      `${Math.round(geom.shellHeight)}px`);

    // The rule §3's "~120px bottom padding" is actually protecting: the last
    // message must be readable, not hidden behind the input.
    await fresh('long');
    await page.waitForTimeout(3000);
    await page.$eval(thread, t => { t.scrollTop = t.scrollHeight; });
    await page.waitForTimeout(200);
    const clearance = await page.evaluate(() => {
      const msgs = document.querySelectorAll('[data-testid="chat-thread"] > li');
      const last = msgs[msgs.length - 1].getBoundingClientRect();
      const foot = document.querySelector('[data-testid="chat-page-footer"]').getBoundingClientRect();
      return { lastBottom: last.bottom, footTop: foot.top };
    });
    check('§3 the last message clears the composer (what the 120px rule protects)',
      clearance.lastBottom <= clearance.footTop + 1,
      `last message ends ${Math.round(clearance.footTop - clearance.lastBottom)}px above the composer`);

    // Static, and labelled as static: the safe-area mechanism is declared.
    const css = readFileSync(join(here, 'chat-next.css'), 'utf8');
    check('§10 the composer row declares env(safe-area-inset-bottom) [static check]',
      /\.chat-page__footer[\s\S]*?env\(safe-area-inset-bottom\)/.test(css));
  }

  check('no uncaught page errors across the run', pageErrors.length === 0, pageErrors.join(' | ') || undefined);
  await page.close();

  const failed = results.filter(r => !r.ok);
  totals[shape] = { pass: results.length - failed.length, total: results.length, failed: failed.map(f => f.rule) };
}

await browser.close();

console.log(`\n── Summary ${'─'.repeat(58)}`);
for (const shape of shapes) {
  const t = totals[shape];
  const m = metrics[shape];
  console.log(`  Shape ${shape.toUpperCase()}: ${t.pass}/${t.total} contract checks pass` +
    (m ? `  ·  reading area ${m.readingArea}% of a ${m.viewport}px viewport` : ''));
  if (t.failed.length) console.log('    failed:', t.failed);
}
if (Object.values(totals).some(t => t.failed.length)) process.exit(1);
