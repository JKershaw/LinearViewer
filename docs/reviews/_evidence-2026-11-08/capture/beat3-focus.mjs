/**
 * LIN-3750 beat 3 — focus-order walks (09-26 §7.10): task page, merge confirm, email family, nav.
 *
 * For each target the walk presses Tab from the top of the document, up to MAX stops or until
 * focus cycles back to the first stop, and logs per stop: the element (tag/role/testid/accessible
 * text/href), whether it matches :focus-visible, the computed focus indicator (outline /
 * box-shadow), its box, and whether it is in the viewport. Output: one JSON log per target in
 * authenticated/focus-<id>--<state>.json, one PNG of the first stop that shows the focus ring,
 * and an entry per target in manifest.json (keyed to a registry id).
 *
 *   BASE_URL=http://localhost:3197 node beat3-focus.mjs [target ...]
 */
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { launch, newCtx, establish, upsertManifest, BASE, OUT, D1400, D390, REGISTRY_IDS, APP_SESSION, ws } from './beat3-lib.mjs';
import { STATES, clearAll } from './beat3-task.mjs';
import { RENDERERS } from './renderer-args.mjs';

const MAX = 60;
const want = process.argv.slice(2);

const STOP_JS = `(() => {
  const el = document.activeElement;
  if (!el || el === document.body || el === document.documentElement) return { body: true };
  const cs = getComputedStyle(el), r = el.getBoundingClientRect();
  const name = (el.getAttribute('aria-label') || el.innerText || el.value || el.getAttribute('title') || el.getAttribute('alt') || '').replace(/\\s+/g, ' ').trim().slice(0, 60);
  const outlineVisible = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0;
  const shadowVisible = cs.boxShadow && cs.boxShadow !== 'none';
  return {
    tag: el.tagName.toLowerCase(), role: el.getAttribute('role') || null, type: el.getAttribute('type') || null,
    testid: el.dataset.testid || null, id: el.id || null, name, href: el.getAttribute('href') || null,
    expanded: el.getAttribute('aria-expanded'), focusVisible: el.matches(':focus-visible'),
    outline: { style: cs.outlineStyle, width: cs.outlineWidth, color: cs.outlineColor, offset: cs.outlineOffset },
    boxShadow: shadowVisible ? cs.boxShadow.slice(0, 80) : null,
    indicator: outlineVisible || !!shadowVisible,
    box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    inViewport: r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth,
    tabindex: el.getAttribute('tabindex'),
  };
})()`;

async function walk(page, { max = MAX, pre } = {}) {
  if (pre) await pre(page);
  await page.evaluate(() => { window.scrollTo(0, 0); document.activeElement && document.activeElement.blur && document.activeElement.blur(); });
  const stops = [];
  let first = null;
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    await page.waitForTimeout(40);
    const s = await page.evaluate(STOP_JS);
    const sig = JSON.stringify([s.tag, s.testid, s.id, s.name, s.href]);
    if (s.body) { stops.push({ i: i + 1, ...s }); break; } // focus left the document (browser chrome)
    if (first === null) first = sig; else if (sig === first) { stops.push({ i: i + 1, cycle: true }); break; }
    stops.push({ i: i + 1, ...s });
  }
  return stops;
}

function verdict(stops) {
  const real = stops.filter(s => s.tag);
  return {
    stops: real.length,
    withoutIndicator: real.filter(s => !s.indicator).map(s => `${s.i}:${s.tag}${s.testid ? '[' + s.testid + ']' : ''} "${s.name}"`),
    notFocusVisible: real.filter(s => !s.focusVisible).map(s => `${s.i}:${s.tag} "${s.name}"`),
    offscreen: real.filter(s => !s.inViewport).length,
    zeroSize: real.filter(s => s.box.w === 0 || s.box.h === 0).map(s => `${s.i}:${s.tag} "${s.name}"`),
    positiveTabindex: real.filter(s => s.tabindex && +s.tabindex > 0).map(s => `${s.i}:${s.tag}`),
    cycled: stops.some(s => s.cycle), leftDocument: stops.some(s => s.body),
  };
}

const TARGETS = [];
// registry id, state, how to reach it
TARGETS.push({ key: 'task-page-pr-ready-owner', id: 'ws-task-page', state: 'pr-ready-owner', local: true,
  async prep(admin, browser) { await clearAll(admin); const body = await STATES['pr-ready-owner'].seed(admin, browser); return { session: { local: body }, path: STATES['pr-ready-owner'].path, pre: STATES['pr-ready-owner'].prepare }; } });
TARGETS.push({ key: 'task-page-running', id: 'ws-task-page', state: 'running', local: true,
  async prep(admin, browser) { await clearAll(admin); const body = await STATES.running.seed(admin, browser); return { session: { local: body }, path: STATES.running.path }; } });
TARGETS.push({ key: 'merge-confirm-live-409', id: 'renderer:renderMergeConfirmPage', state: 'live-409',
  async prep() { return { session: 'none', path: '/test/set-merge-conflict-session', expectStatus: 409 }; } });
for (const [r, label] of [['renderEmailSignInPage', 'signin'], ['renderEmailRegisterPage', 'register'], ['renderEmailCheckInboxPage', 'check-inbox'], ['renderEmailLinkConfirmPage', 'link-confirm'], ['renderEmailReproofPage', 'reproof'], ['renderEmailConfirmPage', 'confirm'], ['renderEmailSendRefusedPage', 'send-refused']]) {
  TARGETS.push({ key: `email-${label}`, id: `renderer:${r}`, state: 'intercepted-synthetic', intercept: r, async prep() { return { session: 'none', path: '/__intercept__' }; } });
}
TARGETS.push({ key: 'nav-tree', id: 'ws-tree', state: 'nav-keyboard',
  async prep() { return { session: 'app', path: ws('/') }; } });
TARGETS.push({ key: 'nav-tree-more-opened-by-keyboard', id: 'ws-tree', state: 'nav-more-by-keyboard',
  async prep() { return { session: 'app', path: ws('/'), pre: async (page) => {
    // reach the ⋯ more toggle by keyboard and open it with Enter, then walk on
    await page.evaluate(() => document.querySelector('[data-testid="nav-more-toggle"]')?.focus());
    await page.keyboard.press('Enter'); await page.waitForTimeout(300);
  } }; } });

const browser = await launch();
const admin = await newCtx(browser, 'light', D1400);
await mkdir(OUT, { recursive: true });
const rows = [];
for (const t of TARGETS) {
  if (want.length && !want.includes(t.key)) continue;
  let prep;
  try { prep = await t.prep(admin, browser); } catch (e) { console.log(`PREP-FAIL ${t.key}: ${e.message}`); rows.push({ key: `focus|${t.id}|${t.state}`, registryId: t.id, state: t.state, ok: false, reason: `prep: ${e.message}` }); continue; }
  const logs = {};
  for (const [theme, vp] of [['light', D1400], ['dark', D390]]) {
    const ctx = await newCtx(browser, theme, vp);
    try {
      await establish(ctx, prep.session);
      const page = await ctx.newPage();
      if (t.intercept) {
        const html = RENDERERS[t.intercept]();
        await page.route('**/*', r => r.request().resourceType() === 'document' ? r.fulfill({ status: 200, body: html, contentType: 'text/html' }) : r.continue());
      }
      const resp = await page.goto(`${BASE}${prep.path}`, { waitUntil: 'load' });
      await page.waitForTimeout(700);
      const htmlClass = await page.evaluate(() => document.documentElement.className);
      const themeOk = theme === 'dark' ? htmlClass.split(/\s+/).includes('theme-dark') : !htmlClass.includes('theme-dark');
      const stops = await walk(page, { pre: prep.pre });
      // one PNG with a focus ring on screen: stop 3 of the walk, re-focused (a walk screenshot at the end would show nothing)
      let png = null;
      if (theme === 'light') {
        await page.evaluate(() => { window.scrollTo(0, 0); document.activeElement && document.activeElement.blur && document.activeElement.blur(); });
        for (let i = 0; i < Math.min(3, stops.length); i++) await page.keyboard.press('Tab');
        png = `authenticated/focus-${t.key}--light-1400px.png`;
        await page.screenshot({ path: path.join(OUT, `focus-${t.key}--light-1400px.png`) });
      }
      logs[`${theme}-${vp.width}`] = { httpStatus: resp ? resp.status() : null, htmlClass, themeAssertion: { expected: theme === 'dark' ? 'theme-dark' : 'no theme-dark', actual: htmlClass, passed: themeOk }, verdict: verdict(stops), stops, png };
    } catch (e) { logs[`${theme}-${vp.width}`] = { error: String(e.message).split('\n')[0] }; }
    finally { await ctx.close(); }
  }
  const file = `focus-${t.key}.json`;
  await writeFile(path.join(OUT, file), JSON.stringify({ registryId: t.id, state: t.state, target: t.key, note: 'Tab walk from top of document; light 1400 and dark 390; theme asserted in the same read', logs }, null, 2));
  const L = logs['light-1400'] || {};
  console.log(`${t.key}: stops=${L.verdict?.stops} noIndicator=${L.verdict?.withoutIndicator?.length} http=${L.httpStatus} ${L.error || ''} | dark390 stops=${logs['dark-390']?.verdict?.stops} themeOk=${logs['dark-390']?.themeAssertion?.passed}`);
  rows.push({ key: `focus|${t.id}|${t.state}`, registryId: t.id, state: t.state, kind: 'focus-walk', ok: !L.error && !logs['dark-390']?.error && logs['dark-390']?.themeAssertion?.passed !== false, files: { json: `authenticated/${file}`, png: L.png }, summary: { light1400: L.verdict, dark390: logs['dark-390']?.verdict } });
}
await upsertManifest(rows);
await admin.close(); await browser.close();
