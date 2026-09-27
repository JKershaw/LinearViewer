/**
 * LIN-3101 implementation beat 1: capture-gap + visual-pass probe.
 *
 * The research stage left two newly-in-remit surfaces with JSON only (no PNG):
 * Settings and Dispatch (Workspace Halt). Those are captured full-page with the
 * existing capture.mjs (`--fullpage`), then copied in as `.fp.png`/`.fp.json`.
 * This script covers what capture.mjs cannot express:
 *
 *   1. The Scan-due tab (plus a settled Dispatch capture, see FP_JOBS). It is the FOURTH TAB OF OBSERVATION
 *      (lib/render-observation.js:183, LIN-2667), not a Settings tab as the
 *      research notes say, and it only renders after a click. Captured
 *      full-page, both themes, 1400 + 390, with the same theme contract as
 *      capture.mjs (real `theme` cookie, `theme-dark` asserted before shooting).
 *   2. A full-page contrast sweep. capture.mjs's CONTRAST_JS samples only the
 *      FIRST element per selector, so it cannot see a low-contrast control
 *      further down the page. This sweeps every visible element that owns a
 *      text node and records each distinct (class, colour, bg) group below
 *      4.5:1. The effective-background walk is the same ancestor heuristic as
 *      capture.mjs (research-notes §7.5 names its limits).
 *   3. Dispatch async sections: what the four "Loading…" placeholders show after
 *      a longer settle, plus every >=400 / failed request, so a stuck placeholder
 *      can be attributed to the test seam or to the product.
 *
 *   6. `darksweep`: V1 blast radius — every authenticated surface in dark
 *      (writes gap-dark-sweep.json).
 *   5. `extra`: computed colour/font reads for the workspace-not-found link,
 *      the Jira API-token form controls, the GitHub Projects <select>, and the
 *      archive sign-offs (writes gap-extra-probe.json).
 *   4. `archives`: settled page-end re-shoots of archives 1/2/4 (see
 *      captureSettledArchiveEnds).
 *
 * Docs-only research tool; run with the keyless NODE_ENV=test server up:
 *   PLAYWRIGHT_BROWSERS_PATH=… BASE_URL=http://localhost:3199 \
 *     node docs/reviews/_evidence-2026-09-26/capture/capture-gap.mjs [archives|extra|darksweep]
 */

import { chromium } from 'playwright';
import { writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '..');
const BASE = process.env.BASE_URL || 'http://localhost:3199';
const D1400 = { width: 1400, height: 1000 };
const D390 = { width: 390, height: 844 };

const ALL_FEATURES = encodeURIComponent(JSON.stringify({
  dispatch: true, proxy: true, roadmap: true, collective: true, taskChat: true, ship: true,
  nextRun: true, flightCompanion: true, passagePlanner: true, shipBiscuit: true,
  liveConsole: true, shipJourney: true, feedbackWidget: true
}));
const SEED = `/test/set-session?features=${ALL_FEATURES}`;
const ws = (p) => `/workspace/test-workspace${p}`;

const SWEEP_SURFACES = [
  { key: 'settings', path: ws('/settings') },
  { key: 'dispatch', path: ws('/dispatch') },
  { key: 'proxy', path: ws('/proxy') },
  { key: 'observation-due', path: ws('/observation'), tab: 'due' },
  { key: 'tree', path: ws('/') },
  { key: 'effort-readout', path: ws('/effort-readout') },
  { key: 'escalation-kpis', path: ws('/escalation-kpis') },
  { key: 'ship', path: ws('/ship') }
];

const SWEEP_JS = `
  (() => {
    function lum(v){ v/=255; return v<=0.03928? v/12.92 : Math.pow((v+0.055)/1.055,2.4); }
    function rgb(s){
      const m = (s||'').match(/rgba?\\(([\\d.]+),\\s*([\\d.]+),\\s*([\\d.]+)(?:,\\s*([\\d.]+))?\\)/);
      if(!m) return null;
      return [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]), m[4]===undefined?1:parseFloat(m[4])];
    }
    // Composite every translucent ancestor background down to the first opaque
    // one (capture.mjs stops at the first alpha>0 layer, so an rgba(0,0,0,.03)
    // card tint reads as solid black — research-notes §7.5's mis-resolution).
    function effBg(el){
      const layers = [];
      let a = el;
      while(a){
        const c = rgb(getComputedStyle(a).backgroundColor);
        if(c && c[3] > 0){ layers.push(c); if(c[3] >= 1) break; }
        a = a.parentElement;
      }
      let base = [255,255,255];
      if (layers.length && layers[layers.length-1][3] >= 1) base = layers.pop().slice(0,3);
      for (let i = layers.length - 1; i >= 0; i--) {
        const [r,g,b,al] = layers[i];
        base = [r*al + base[0]*(1-al), g*al + base[1]*(1-al), b*al + base[2]*(1-al)].map(Math.round);
      }
      return base;
    }
    function contrast(a,b){ const l1=lum(a[0])*0.2126+lum(a[1])*0.7152+lum(a[2])*0.0722; const l2=lum(b[0])*0.2126+lum(b[1])*0.7152+lum(b[2])*0.0722; const [hi,lo]=[l1,l2].sort((x,y)=>y-x); return (hi+0.05)/(lo+0.05); }
    const groups = new Map();
    for (const el of document.querySelectorAll('body *')) {
      if (['SCRIPT','STYLE','NOSCRIPT','OPTION'].includes(el.tagName)) continue;
      const ownText = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim();
      if (!ownText) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) === 0) continue;
      const fg = rgb(cs.color);
      if (!fg || fg[3] === 0) continue;
      const bg = effBg(el);
      const ratio = +contrast(fg, bg).toFixed(2);
      if (ratio >= 4.5) continue;
      const cls = (typeof el.className === 'string' && el.className.trim()) ? '.' + el.className.trim().split(/\\s+/).join('.') : '';
      const key = el.tagName.toLowerCase() + cls + '|' + cs.color + '|' + bg.join(',');
      const g = groups.get(key) || { element: el.tagName.toLowerCase() + cls, color: cs.color, bg: 'rgb(' + bg.join(',') + ')', ratio, fontSize: cs.fontSize, fontWeight: cs.fontWeight, count: 0, samples: [] };
      g.count++;
      if (g.samples.length < 3) g.samples.push(ownText.slice(0, 50));
      groups.set(key, g);
    }
    return [...groups.values()].sort((a, b) => a.ratio - b.ratio);
  })()
`;

const FONT_JS = `
  (() => {
    const sels = ['.guide-halt-note', '.halt-status', '.halt-disclaimer', '.halt-pause', '.model-hint', 'h1', '.section-header'];
    const out = {};
    for (const s of sels) {
      const el = document.querySelector(s);
      if (!el) continue;
      const cs = getComputedStyle(el);
      out[s] = { fontFamily: cs.fontFamily, fontSize: cs.fontSize, color: cs.color, text: (el.textContent || '').trim().slice(0, 60) };
    }
    return out;
  })()
`;

async function open(browser, surface, theme, viewport, { settleMs = 400, net = null } = {}) {
  const ctx = await browser.newContext({ viewport });
  await ctx.addCookies([{ name: 'theme', value: theme, url: BASE }]);
  const page = await ctx.newPage();
  if (net) {
    page.on('response', (r) => { if (r.status() >= 400) net.push({ url: r.url().replace(BASE, ''), status: r.status() }); });
    page.on('requestfailed', (r) => net.push({ url: r.url().replace(BASE, ''), failed: r.failure()?.errorText }));
    page.on('console', (m) => { if (m.type() === 'error') net.push({ console: m.text().slice(0, 200) }); });
  }
  await page.goto(`${BASE}${SEED}`, { waitUntil: 'load' }).catch(() => {});
  await page.goto(`${BASE}${surface.path}`, { waitUntil: 'load' }).catch(() => {});
  if (surface.tab) {
    await page.click(`.obs-tab[data-view="${surface.tab}"]`);
  }
  await page.waitForTimeout(settleMs);
  const htmlClass = await page.evaluate(() => document.documentElement.className);
  const passed = theme === 'dark' ? htmlClass === 'theme-dark' : !htmlClass.includes('theme-dark');
  return { ctx, page, themeAssertion: { expected: theme === 'dark' ? 'theme-dark' : '(no theme-dark)', actual: htmlClass, passed } };
}

// Full-page captures capture.mjs cannot express: a tab click, or a longer
// settle so Dispatch's four async sections (halt status, queue, tokens,
// history) show their loaded state instead of the 300ms "Loading…" placeholder.
const FP_JOBS = [
  { key: 'observation-due', path: ws('/observation'), tab: 'due', settleMs: 1500, source: 'capture/capture-gap.mjs (Scan-due tab click)' },
  { key: 'dispatch-settled', path: ws('/dispatch'), settleMs: 6000, source: 'capture/capture-gap.mjs (6s settle; async sections loaded)' }
];

async function captureFullPageJobs(browser) {
  const rows = [];
  for (const job of FP_JOBS) for (const theme of ['light', 'dark']) {
    for (const viewport of [D1400, D390]) {
      const { ctx, page, themeAssertion } = await open(browser, job, theme, viewport, { settleMs: job.settleMs });
      if (!themeAssertion.passed) {
        rows.push({ job, theme, viewport: viewport.width, ok: false, reason: 'theme-assertion', themeAssertion });
        await ctx.close();
        continue;
      }
      const state = await page.evaluate(() => {
        const active = document.querySelector('.obs-tab.is-active');
        const due = document.getElementById('obs-due-section');
        const halt = document.querySelector('[data-testid="dispatch-halt-status"]');
        const c = { h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 };
        document.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach(h => c[h.tagName.toLowerCase()]++);
        const de = document.documentElement;
        return {
          title: document.title,
          activeTab: active ? active.textContent.trim() : null,
          dueSectionVisible: due ? due.offsetParent !== null : null,
          dueSectionText: due ? due.innerText.trim().slice(0, 600) : null,
          haltStatus: halt ? halt.innerText.trim() : null,
          headings: c,
          scrollWidth: de.scrollWidth, clientWidth: de.clientWidth, scrollHeight: de.scrollHeight
        };
      });
      const name = `${job.key}-${theme}-${viewport.width}px.fp`;
      await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
      await writeFile(path.join(OUT, `${name}.json`), JSON.stringify({ surface: job.key, settleMs: job.settleMs, theme, viewport: viewport.width, captureMode: 'fullPage', darkMode: 'cookie', themeAssertion, ...state }, null, 2));
      rows.push({ job, theme, viewport: viewport.width, ok: true, pixelHeight: state.scrollHeight });
      await ctx.close();
    }
  }
  return rows;
}

async function sweep(browser) {
  const out = {};
  for (const surface of SWEEP_SURFACES) {
    for (const theme of ['light', 'dark']) {
      const net = surface.key === 'dispatch' ? [] : null;
      const { ctx, page, themeAssertion } = await open(browser, surface, theme, D1400, { settleMs: surface.key === 'dispatch' ? 6000 : 1200, net });
      const lowContrast = await page.evaluate(SWEEP_JS);
      const fonts = await page.evaluate(FONT_JS);
      const row = { themeAssertion, lowContrast, fonts };
      if (surface.key === 'dispatch') {
        row.asyncSectionsAfter6s = await page.evaluate(() => ({
          haltStatus: document.querySelector('[data-testid="dispatch-halt-status"]')?.innerText.trim(),
          loadingTexts: [...document.querySelectorAll('body *')].filter(e => e.children.length === 0 && /Loading/.test(e.textContent)).map(e => e.textContent.trim())
        }));
        row.network = net;
      }
      out[`${surface.key}--${theme}--1400px`] = row;
      await ctx.close();
    }
  }
  return out;
}

// Archives 1/2/4 fade content in via IntersectionObserver (`.reveal`,
// `transition: opacity .5s`). capture-full.mjs shoots 200ms after the jump to
// the page end, so its pageEnd PNGs for those three catch the fade mid-way and
// render the final section washed out. Re-shoot them after the transition.
async function captureSettledArchiveEnds(browser) {
  const rows = [];
  for (const n of [1, 2, 4]) for (const viewport of [D1400, D390]) {
    const ctx = await browser.newContext({ viewport, colorScheme: 'light' });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/archive/${n}`, { waitUntil: 'load' });
    await page.evaluate(() => {
      document.documentElement.style.scrollBehavior = 'auto';
      document.documentElement.scrollTop = document.documentElement.scrollHeight;
    });
    await page.waitForTimeout(1500);
    const state = await page.evaluate(() => ({
      scrollY: Math.round(window.scrollY),
      scrollHeight: document.documentElement.scrollHeight,
      revealInViewport: [...document.querySelectorAll('.reveal')].filter(e => { const r = e.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; })
        .map(e => ({ opacity: getComputedStyle(e).opacity, cls: e.className }))
    }));
    const name = `archive-${n}-light-${viewport.width}px.pe-settled`;
    await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false });
    await writeFile(path.join(OUT, `${name}.json`), JSON.stringify({ surface: `archive-${n}`, theme: 'light', viewport: viewport.width, captureMode: 'pageEnd', settleMs: 1500, darkMode: 'media', ...state }, null, 2));
    rows.push({ n, viewport: viewport.width, scrollHeight: state.scrollHeight, reveal: state.revealInViewport });
    await ctx.close();
  }
  return rows;
}

// `extra`: computed colour/font reads backing visual-pass observations on
// intercept-rendered consent pages and archive sign-offs (not covered by the
// SWEEP_SURFACES list, which is authenticated app pages only).
const EXTRA_JS = `
  (sels) => {
    function lum(v){ v/=255; return v<=0.03928? v/12.92 : Math.pow((v+0.055)/1.055,2.4); }
    function rgb(s){ const m=(s||'').match(/rgba?\\(([\\d.]+),\\s*([\\d.]+),\\s*([\\d.]+)(?:,\\s*([\\d.]+))?\\)/); return m?[+m[1],+m[2],+m[3],m[4]===undefined?1:+m[4]]:null; }
    function effBg(el){ const L=[]; let a=el; while(a){ const c=rgb(getComputedStyle(a).backgroundColor); if(c&&c[3]>0){L.push(c); if(c[3]>=1) break;} a=a.parentElement; } let b=[255,255,255]; if(L.length&&L[L.length-1][3]>=1) b=L.pop().slice(0,3); for(let i=L.length-1;i>=0;i--){const [r,g,bb,al]=L[i]; b=[r*al+b[0]*(1-al),g*al+b[1]*(1-al),bb*al+b[2]*(1-al)].map(Math.round);} return b; }
    function ratio(a,b){ const l=x=>lum(x[0])*0.2126+lum(x[1])*0.7152+lum(x[2])*0.0722; const [h,lo]=[l(a),l(b)].sort((x,y)=>y-x); return +((h+0.05)/(lo+0.05)).toFixed(2); }
    const out = {};
    for (const s of sels) {
      const el = document.querySelector(s); if (!el) { out[s] = null; continue; }
      const cs = getComputedStyle(el); const bg = effBg(el); const fg = rgb(cs.color);
      out[s] = { text: (el.textContent||el.placeholder||'').trim().slice(0,50), color: cs.color, bg: 'rgb('+bg.join(',')+')', ratio: fg ? ratio(fg,bg) : null,
        fontFamily: cs.fontFamily, fontSize: cs.fontSize, background: cs.backgroundColor, border: cs.border };
    }
    return out;
  }
`;

async function extraProbe(browser) {
  const { renderWorkspaceNotFoundPage, renderJiraLinkForm, renderGitHubProjectSelectPage } = await import('../../../../lib/render-pages.js');
  const jobs = [
    { key: 'err-workspace-notfound', html: () => renderWorkspaceNotFoundPage('nope', [{ name: 'Demo Workspace', urlKey: 'demo' }]), sels: ['ul a', 'ul', 'li'] },
    { key: 'jira-link-form', html: () => renderJiraLinkForm({ workspaceUrlKey: 'test-workspace' }), sels: ['input[type="url"], input[name*="site" i]', 'input[type="email"]', 'input[type="password"]', 'form a', 'label'] },
    { key: 'gh-projects-picker', html: () => renderGitHubProjectSelectPage([{ login: 'acme', number: 4, title: 'Roadmap board' }], { login: 'octocat' }), sels: ['select'] }
  ];
  const out = {};
  for (const job of jobs) for (const theme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: D390 });
    await ctx.addCookies([{ name: 'theme', value: theme, url: BASE }]);
    const page = await ctx.newPage();
    const html = job.html();
    await page.route('**/*', (r) => r.request().resourceType() === 'document' ? r.fulfill({ body: html, contentType: 'text/html' }) : r.continue());
    await page.goto(`${BASE}/__intercept__`, { waitUntil: 'load' });
    await page.waitForTimeout(300);
    const htmlClass = await page.evaluate(() => document.documentElement.className);
    out[`${job.key}--${theme}--390px`] = { htmlClass, probe: await page.evaluate(`(${EXTRA_JS})(${JSON.stringify(job.sels)})`) };
    await ctx.close();
  }
  for (const n of [1, 4, 5, 7]) {
    const ctx = await browser.newContext({ viewport: D1400, colorScheme: 'light' });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/archive/${n}`, { waitUntil: 'load' });
    await page.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; document.documentElement.scrollTop = document.documentElement.scrollHeight; });
    await page.waitForTimeout(1500);
    // the last text-bearing block on the page is the provenance sign-off
    const sel = await page.evaluate(() => {
      const els = [...document.querySelectorAll('body *')].filter(e => e.children.length === 0 && e.textContent.trim().length > 20 && e.getBoundingClientRect().height > 0);
      const last = els[els.length - 1]; last.setAttribute('data-probe-signoff', '1'); return '[data-probe-signoff]';
    });
    out[`archive-${n}--light--1400px--signoff`] = { probe: await page.evaluate(`(${EXTRA_JS})(${JSON.stringify([sel])})`) };
    await ctx.close();
  }
  return out;
}

// `darksweep` (impl beat 2): the same composited sweep over EVERY authenticated
// app surface in cookie dark, to size V1 (unthemed .action-btn / links) beyond
// the three pages beat 1 swept. Records groups under 3:1 only.
const DARK_SWEEP = ['/', '/swipe', '/swim', '/ship', '/roadmap', '/audit', '/settings', '/prompts', '/prompts/custom',
  '/dispatch', '/proxy', '/observation', '/dashboard', '/escalation-kpis', '/effort-readout', '/flight-companion',
  '/live-console', '/next-run', '/passage-planner', '/ship-biscuit', '/ship-journey', '/task-chat', '/task/new', '/collective'];

async function darkSweep(browser) {
  const out = {};
  for (const p of DARK_SWEEP) {
    const { ctx, page, themeAssertion } = await open(browser, { path: ws(p) }, 'dark', D1400, { settleMs: p === '/dispatch' || p === '/collective' ? 4000 : 1200 });
    const groups = (await page.evaluate(SWEEP_JS)).filter(g => g.ratio < 3);
    out[p] = { themeAssertion: themeAssertion.passed, groups: groups.map(g => ({ element: g.element, color: g.color, bg: g.bg, ratio: g.ratio, count: g.count, samples: g.samples })) };
    await ctx.close();
  }
  return out;
}

async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  if (process.argv.includes('darksweep')) {
    const out = await darkSweep(browser);
    await browser.close();
    await writeFile(path.join(OUT, 'gap-dark-sweep.json'), JSON.stringify({ note: 'Cookie-dark (theme-dark asserted) composited contrast sweep of 24 authenticated app surfaces @1400; groups <3:1 only. Test-workspace seed with all flags on; Collective against the in-process mock Yap.', surfaces: out }, null, 2));
    for (const [k, v] of Object.entries(out)) console.log(k, v.themeAssertion, v.groups.map(g => `${g.element}@${g.ratio}x${g.count}`).join(' | '));
    return;
  }
  if (process.argv.includes('extra')) {
    const out = await extraProbe(browser);
    await browser.close();
    await writeFile(path.join(OUT, 'gap-extra-probe.json'), JSON.stringify(out, null, 2));
    console.log(JSON.stringify(out, null, 1));
    return;
  }
  if (process.argv.includes('archives')) {
    const rows = await captureSettledArchiveEnds(browser);
    await browser.close();
    const manifestPath = path.join(__dirname, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    for (const r of rows) {
      manifest[`archive-${r.n}--light--${r.viewport}px--pe-settled`] = { surface: `archive-${r.n}`, theme: 'light', viewport: r.viewport, captureMode: 'pageEnd', darkMode: 'media', status: 'kept', scrollHeight: r.scrollHeight, source: 'capture/capture-gap.mjs archives (1.5s settle past the .reveal fade)' };
    }
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(JSON.stringify(rows));
    return;
  }
  const fp = await captureFullPageJobs(browser);
  const probe = await sweep(browser);
  await browser.close();

  await writeFile(path.join(OUT, 'gap-contrast-sweep.json'), JSON.stringify({
    note: 'Full-page low-contrast sweep (<4.5:1) grouped by element+colour+effective-bg; cookie theme; 1400px. Effective bg = translucent ancestor backgrounds alpha-composited down to the first opaque one (fixes capture.mjs stopping at the first alpha>0 layer). Still blind to background-image, pseudo-elements and text over non-ancestor layers.',
    surfaces: probe
  }, null, 2));

  const manifestPath = path.join(__dirname, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  for (const r of fp) {
    manifest[`${r.job.key}--${r.theme}--${r.viewport}px--fp`] = r.ok
      ? { surface: r.job.key, theme: r.theme, viewport: r.viewport, captureMode: 'fullPage', darkMode: 'cookie', status: 'kept', pixelHeight: r.pixelHeight, source: r.job.source }
      : { surface: r.job.key, theme: r.theme, viewport: r.viewport, captureMode: 'fullPage', status: `failed — ${r.reason}` };
  }
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  console.log('full-page captures:', JSON.stringify(fp.map(r => ({ key: r.job.key, theme: r.theme, viewport: r.viewport, ok: r.ok, pixelHeight: r.pixelHeight }))));
  for (const [k, v] of Object.entries(probe)) {
    console.log(k, 'theme ok:', v.themeAssertion.passed, 'low-contrast groups:', v.lowContrast.length, v.asyncSectionsAfter6s ? JSON.stringify(v.asyncSectionsAfter6s) : '');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
