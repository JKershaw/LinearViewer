/**
 * verify.mjs — drive the Shape A prototype and assert the contract, rule by rule.
 *
 *   node prototypes/lin-1412-chat/verify.mjs
 *
 * This is the point of building an interactive prototype rather than a PNG: a
 * screenshot cannot show a scroll hijack NOT happening, a draft surviving an
 * error, or focus returning. Every assertion below uses a technique that
 * already exists in tests/e2e/ (boundingBox, keyboard.press, toBeFocused,
 * computed style) EXCEPT the scroll-position reads, which beat 4 identified as
 * the one genuinely new technique — so this doubles as the proof that the
 * measurement plan in plans/lin-1412-design-notes.md §3 is buildable.
 *
 * It is NOT a CI gate and not a replacement for the real specs: it drives a
 * prototype with a mock transport, not the four live surfaces.
 */
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

let chromium;
try { ({ chromium } = await import('playwright')); }
catch { ({ chromium } = await import('@playwright/test')); }

const here = dirname(fileURLToPath(import.meta.url));
const url = 'file://' + join(here, 'shape-a.html');

const results = [];
function check(rule, ok, detail) {
  results.push({ rule, ok, detail });
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${rule}${detail ? ' — ' + detail : ''}`);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(String(e)));

const thread = '[data-testid="chat-thread"]';
const send = '[data-testid="chat-send"]';
const input = '#composer-input';
const jump = '[data-testid="chat-jump-latest"]';

const threadMetrics = () => page.$eval(thread, t => ({
  top: t.scrollTop, height: t.scrollHeight, client: t.clientHeight,
  overflowY: getComputedStyle(t).overflowY
}));

async function fresh(scene) {
  await page.goto(`${url}${scene ? '?scene=' + scene : ''}`);
  await page.waitForTimeout(250);
}

// ── §11 semantics ───────────────────────────────────────────────────────────
await fresh();
check('§11 transcript is role="log" with a polite live region',
  await page.$eval(thread, t => t.getAttribute('role') === 'log' && t.getAttribute('aria-live') === 'polite'));

// ── §6.3 empty send is blocked, and the disabled state is RENDERED ─────────
check('§6.3 send is disabled (rendered) with an empty composer',
  await page.$eval(send, b => b.disabled));

// ── §6.8 target size ────────────────────────────────────────────────────────
const box = await page.locator(send).boundingBox();
check('§6.8 send meets Harbour\'s own 40px floor (LIN-786)', box.height >= 40, `${Math.round(box.height)}px`);

// ── §6.1 auto-grow, and shrink-back after send ─────────────────────────────
const h0 = (await page.locator(input).boundingBox()).height;
await page.fill(input, 'one\ntwo\nthree\nfour');
await page.waitForTimeout(120);
const hGrown = (await page.locator(input).boundingBox()).height;
check('§6.1 textarea auto-grows with content', hGrown > h0 + 20, `${Math.round(h0)}px → ${Math.round(hGrown)}px`);

// ── §6.2 Shift+Enter inserts a newline and does NOT send ───────────────────
await page.fill(input, 'draft');
await page.focus(input);
await page.keyboard.press('Shift+Enter');
const afterShift = await page.$eval(input, i => i.value);
const turnsAfterShift = await page.$$eval(thread + ' > li', n => n.length);
check('§6.2 Shift+Enter inserts a newline and sends nothing',
  afterShift.includes('\n') && turnsAfterShift === 0);

// ── §6.2 / §7.2 Enter sends, optimistically ────────────────────────────────
await page.fill(input, 'why is the collective scroll check wrong?');
await page.focus(input);
await page.keyboard.press('Enter');
// The mock's first token is 700ms away, so this window is the pre-network one.
await page.waitForTimeout(120);
const optimistic = await page.$eval(thread, t => {
  const li = t.querySelector('li');
  return li ? li.textContent.includes('why is the collective') : false;
});
check('§7.2 the user turn is in the DOM before any response arrives', optimistic);
check('§6.5 the composer cleared on send', (await page.$eval(input, i => i.value)) === '');
check('§6.5 focus returned to the composer', await page.$eval(input, i => i === document.activeElement));
check('§6.5 the composer is NOT disabled during generation', !(await page.$eval(input, i => i.disabled)));

// ── §7.3 thinking indicator, held until the first token ────────────────────
check('§7.3 a thinking indicator is showing before the first token',
  await page.$eval(thread, t => !!t.querySelector('.chat-cursor')));

// ── §6.4 Stop exists during generation, and stops ──────────────────────────
const stopLabel = await page.$eval(send, b => b.textContent.trim());
check('§6.4 the send control became Stop during generation', stopLabel === 'Stop');
await page.click(send);
await page.waitForTimeout(400);
const stoppedText = await page.$eval(thread, t => t.textContent);
const stoppedLabel = await page.$eval(send, b => b.textContent.trim());
check('§6.4 Stop actually stops, and the control reverts',
  stoppedText.includes('stopped by you') && stoppedLabel === 'Send');

// ── §9 the scroll rules ────────────────────────────────────────────────────
await fresh('long');
await page.waitForFunction(() => {
  const t = document.querySelector('[data-testid="chat-thread"]');
  return t.scrollHeight > t.clientHeight + 200;
}, null, { timeout: 15000 });

const m0 = await threadMetrics();
check('§9 the thread is its OWN scroller (the box C1 says to measure)',
  m0.overflowY === 'auto' && m0.height > m0.client);

// follows while at the bottom
await page.$eval(thread, t => { t.scrollTop = t.scrollHeight; });
await page.waitForTimeout(700);
const mFollow = await threadMetrics();
check('§9.1 follows new content while the reader is at the bottom',
  mFollow.height - mFollow.top - mFollow.client <= 120);

// does not hijack once scrolled up
await page.$eval(thread, t => { t.scrollTop = 0; });
await page.waitForTimeout(1500);
const mHeld = await threadMetrics();
check('§9.1 does NOT hijack a reader who scrolled up mid-stream',
  mHeld.top === 0, `scrollTop=${mHeld.top} after 1.5s of streaming`);

check('§9.2 a jump-to-latest affordance appeared instead', await page.isVisible(jump));
check('§9.2 it counts a streaming reply as one pending thing, not one per repaint',
  (await page.$eval(jump, b => b.textContent)).includes('new reply'),
  await page.$eval(jump, b => b.textContent.trim()));

if (await page.isVisible(jump)) await page.click(jump);
await page.waitForTimeout(700);
const mJumped = await threadMetrics();
check('§9.2 clicking it returns to the bottom',
  mJumped.height - mJumped.top - mJumped.client <= 120);

// ── §7.5 / §6.6 error, Retry, and the surviving draft ──────────────────────
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

// ── §7.6 blocked input says why, and keeps the draft ───────────────────────
await fresh('limited');
await page.waitForTimeout(300);
const notice = await page.$eval('.chat-notice', n => n.textContent);
check('§7.6 a blocked composer says what and for how long',
  /Free-tier limit/.test(notice) && /midnight UTC/.test(notice));
check('§7.6 the draft survives the block',
  (await page.$eval(input, i => i.value)).length > 0);

// ── §4 markdown + code blocks ──────────────────────────────────────────────
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
    if (!stacked.length) return false;
    return [...stacked].every(li => getComputedStyle(li.querySelector('.chat-msg__who')).display === 'none');
  }));

// ── §2 applied ─────────────────────────────────────────────────────────────
const size = await page.$eval('.chat-msg__text', e => getComputedStyle(e).fontSize);
check('§2 message prose is 15px (the §5 floor, kept)', size === '15px', size);
const fam = await page.$eval('.chat-md p', e => getComputedStyle(e).fontFamily);
check('§2 prose is the sans face, machine facts are mono', /Inter/.test(fam), fam.split(',')[0]);
const codeFam = await page.$eval('.chat-code pre code', e => getComputedStyle(e).fontFamily);
check('§2 code is JetBrains Mono', /JetBrains/.test(codeFam), codeFam.split(',')[0]);

check('no uncaught page errors across the run', pageErrors.length === 0, pageErrors.join(' | '));

await browser.close();

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} contract checks pass`);
if (failed.length) { console.log('failed:', failed.map(f => f.rule)); process.exit(1); }
