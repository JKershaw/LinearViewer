/**
 * LIN-3749 (LIN-3747 beat 2) — cold-surface captures that need state, interception or a
 * lifecycle the beat-1 `capture.mjs` list does not carry. Drives the patched beat-1
 * `captureOne` (same M1–M4 measurement, same theme contract) and adds, per group:
 *
 *   kpis    /kpis populated through /test/seed-kpi-rollup, rate + total toggle states
 *   library /library index + three document cases + programmatic sweep of the catalog
 *   share   /t/:token mint → view → revoke → 404, 503 by interception (synthetic)
 *   email   13 page renderers (interception) + real routes + the sent-email body (/test/email-outbox)
 *   held    /connect/:provider/held 404 / expired / 409 / picker / 503-by-interception
 *   states  the renderer STATES and the remaining intercepted error renderers
 *   redir   legacy redirects /audit /settings /prompts, cold
 *   lh      Lighthouse over every real cold route
 *   live    https://harbour.cat comparison for every cold surface (curl + one capture)
 *
 * Docs-only research tool. Run (server up on :3199 via boot-3199.mjs):
 *   PLAYWRIGHT_BROWSERS_PATH=... BASE_URL=http://localhost:3199 node capture/beat2.mjs <group ...>
 */
import { chromium } from 'playwright';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { captureOne, upsertManifest } from './capture.mjs';
import { RENDERERS, STATES } from './renderer-args.mjs';
import { PARSE_COLOR_JS, OVERFLOW_JS } from './metrics.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.OUT_DIR || path.resolve(__dirname, '..');
const BASE = process.env.BASE_URL || 'http://localhost:3199';
const LIVE = 'https://harbour.cat';
const LH = process.env.LIGHTHOUSE_CLI || '/Users/work/.npm/_npx/8003d8991b0d346b/node_modules/lighthouse/cli/index.js';

const D1400 = { width: 1400, height: 1000 };
const D390 = { width: 390, height: 844 };
const D320 = { width: 320, height: 720 };
const TWO = [D1400, D390];
const THREE = [D1400, D390, D320];

const groups = {};
const log = (...a) => console.log(...a);

// ---------------------------------------------------------------------------
async function run(browser, surfaces, rows) {
  for (const surface of surfaces) {
    for (const theme of surface.themes || ['light', 'dark']) {
      for (const viewport of surface.viewports || TWO) {
        let r;
        try { r = await captureOne(browser, surface, theme, viewport); }
        catch (e) { r = { ok: false, reason: `exception: ${String(e.message || e).split('\n')[0]}` }; }
        rows.push({ surface: surface.key, theme, viewport: viewport.width, ok: r.ok, reason: r.reason, registryId: surface.registryId });
        log(r.ok ? 'OK  ' : 'FAIL', surface.key, theme, viewport.width, r.ok ? `${r.record.status} "${r.record.title}" ovf=${r.record.overflow.overflows}` : r.reason);
      }
    }
  }
}

async function jsonOut(name, data) {
  await mkdir(path.join(OUT, 'data'), { recursive: true });
  await writeFile(path.join(OUT, 'data', name), JSON.stringify(data, null, 2));
}

// --- kpis -------------------------------------------------------------------
const MONTHS_KEY = 'kpis-beat2-rollup';
const dayKey = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
groups.kpis = async (browser, rows) => {
  const req = (p) => fetch(`${BASE}${p}`).then(r => r.status);
  log('seed', await req(`/test/seed-kpi-rollup?urlKey=${MONTHS_KEY}&day=${dayKey(60)}&done=2`), await req(`/test/seed-kpi-rollup?urlKey=${MONTHS_KEY}&day=${dayKey(58)}&done=3`), await req('/test/clear-kpi-cache'));
  const clickMode = (mode) => async (page) => { await page.locator(`[data-testid="kpis-toggle-done-daily"] button[data-mode="${mode}"]`).click(); await page.waitForTimeout(600); };
  const state = (page) => page.evaluate(() => ({
    pressed: [...document.querySelectorAll('[data-testid="kpis-toggle-done-daily"] button[data-mode]')].map(b => [b.dataset.mode, b.getAttribute('aria-pressed')]),
    captionHidden: document.querySelector('[data-testid="kpis-total-caption"]')?.hidden,
    chartType: window.Chart?.getChart(document.getElementById('chart-done-daily'))?.config.type || null,
    since: document.querySelector('[data-testid="kpis-done-since"]')?.textContent || null,
    datasetStyle: (() => { const c = window.Chart?.getChart(document.getElementById('chart-done-daily')); return c ? c.data.datasets.map(d => ({ label: d.label, borderDash: d.borderDash || null, pointStyle: d.pointStyle || null, type: d.type || c.config.type })) : null; })(),
    chartTypesAll: window.Chart ? [...document.querySelectorAll('canvas')].map(cv => ({ id: cv.id, type: window.Chart.getChart(cv)?.config.type || null, datasets: window.Chart.getChart(cv)?.data.datasets.length ?? null, legend: window.Chart.getChart(cv)?.options?.plugins?.legend?.display ?? null })) : null
  }));
  const surfaces = [
    { key: 'kpis-rate', registryId: 'kpis-public', kind: 'cold', path: '/kpis', label: '/kpis seeded rollup — rate (default) toggle state', settleMs: 1200, viewports: THREE, post: async (p) => { await jsonOut(`kpis-rate-state.json`, await state(p)); } },
    { key: 'kpis-total', registryId: 'kpis-public', kind: 'cold', path: '/kpis', label: '/kpis seeded rollup — total toggle state', settleMs: 1200, viewports: THREE, post: async (p) => { await clickMode('total')(p); await jsonOut(`kpis-total-state.json`, await state(p)); } }
  ];
  try { await run(browser, surfaces, rows); }
  finally { await req(`/test/clear-kpi-rollup?urlKey=${MONTHS_KEY}`); await req('/test/clear-kpi-cache'); }
};

// --- library ----------------------------------------------------------------
const SWEEP_JS = `
  (() => {
    ${PARSE_COLOR_JS}
    const lum = v => { v/=255; return v<=0.03928? v/12.92 : Math.pow((v+0.055)/1.055,2.4); };
    const L = c => 0.2126*lum(c[0])+0.7152*lum(c[1])+0.0722*lum(c[2]);
    const over = (d,s) => [s[0]*s[3]+d[0]*(1-s[3]), s[1]*s[3]+d[1]*(1-s[3]), s[2]*s[3]+d[2]*(1-s[3])];
    function effBg(el){ const layers=[]; for(let a=el;a;a=a.parentElement){ const c=parseColor(getComputedStyle(a).backgroundColor); if(c&&c[3]>0){layers.push(c); if(c[3]>=1)break;} } let base=[255,255,255]; if(layers.length&&layers[layers.length-1][3]>=1) base=layers.pop().slice(0,3); for(let i=layers.length-1;i>=0;i--) base=over(base,layers[i]); return base; }
    const ratio = (a,b) => { const [hi,lo]=[L(a),L(b)].sort((x,y)=>y-x); return (hi+0.05)/(lo+0.05); };
    const groupsMap = {};
    for (const el of document.querySelectorAll('p,li,a,h1,h2,h3,h4,td,th,figcaption,blockquote,code,summary,label,span')) {
      if (![...el.childNodes].some(n => n.nodeType===3 && n.textContent.trim())) continue;
      const cs = getComputedStyle(el); if (cs.visibility==='hidden'||cs.display==='none') continue;
      const fg = parseColor(cs.color); if (!fg) continue;
      const bg = effBg(el); const fgc = fg[3]<1 ? over(bg, fg) : fg;
      const r = ratio(fgc.slice(0,3), bg);
      const big = parseFloat(cs.fontSize) >= 24 || (parseFloat(cs.fontSize) >= 18.66 && parseInt(cs.fontWeight) >= 700);
      if (r < (big ? 3 : 4.5)) { const k = el.tagName.toLowerCase()+'|'+cs.color+'|rgb('+bg.map(Math.round)+')'; (groupsMap[k] ||= { tag: el.tagName.toLowerCase(), color: cs.color, bg: 'rgb('+bg.map(Math.round)+')', ratio: +r.toFixed(2), count: 0, sample: (el.textContent||'').trim().slice(0,40) }).count++; }
    }
    const imgs = [...document.images];
    const geo = ${OVERFLOW_JS};
    return {
      title: document.title, h1: document.querySelectorAll('h1').length,
      headings: [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map(h=>+h.tagName[1]),
      imgsTotal: imgs.length, imgsNoAlt: imgs.filter(i=>!i.hasAttribute('alt')||!i.getAttribute('alt').trim()).length,
      imgsBroken: imgs.filter(i=>i.complete && i.naturalWidth===0).length,
      overflows: geo.overflows, spill: (geo.spill||[]).slice(0,3),
      contrastGroupsUnder: Object.values(groupsMap).sort((a,b)=>b.count-a.count).slice(0,8)
    };
  })()
`;
groups.library = async (browser, rows) => {
  // the catalog itself (lib/library.js loadLibrary, read-only), not the index links: the index omits some documents
  const { loadLibrary } = await import('../../../../lib/library.js');
  const slugs = [...loadLibrary().bySlug.keys()].map(k => `/library/${k}`);
  log('library catalog documents', slugs.length);
  const surfaces = [
    { key: 'library-index', registryId: 'library-index', kind: 'cold', path: '/library', darkMode: 'media', label: 'Library index', viewports: THREE },
    { key: 'library-paper-figures', registryId: 'library-paper', kind: 'cold', path: '/library/drawing-the-ship', darkMode: 'media', label: 'Library paper — figure-heavy (7 images)', viewports: TWO },
    { key: 'library-paper-svg', registryId: 'library-paper', kind: 'cold', path: '/library/theseus-method', darkMode: 'media', label: 'Library paper — SVG figures (LIN-3351 dark recheck)', viewports: TWO },
    { key: 'library-doc-listed', registryId: 'library-doc', kind: 'cold', path: '/library/doc/autopilot-operating-manual-v2', darkMode: 'media', label: 'Library listed doc', viewports: TWO },
    { key: 'library-404', registryId: 'state-library-404', kind: 'cold', path: '/library/no-such-document', darkMode: 'media', label: 'Library unknown slug (route 404)', viewports: TWO }
  ];
  await run(browser, surfaces, rows);

  // programmatic sweep: every catalog document, 390 light + dark (media), one context per scheme
  const sweep = [];
  for (const scheme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: D390, colorScheme: scheme });
    const page = await ctx.newPage();
    for (const slug of slugs) {
      const r = await page.goto(`${BASE}${slug}`, { waitUntil: 'load' }).catch(() => null);
      let rec = { slug, scheme, status: r ? r.status() : null };
      try { await page.waitForTimeout(80); rec = { ...rec, ...(await page.evaluate(SWEEP_JS)) }; } catch (e) { rec.error = String(e.message).split('\n')[0]; }
      sweep.push(rec);
    }
    await ctx.close();
  }
  const bad = sweep.filter(s => s.status !== 200 || s.overflows || s.h1 !== 1 || s.imgsNoAlt || s.imgsBroken || (s.contrastGroupsUnder || []).length);
  await jsonOut('library-sweep.json', {
    note: 'LIN-3749 programmatic sweep over every catalog link served by /library (index links + doc/ links), 390px, light and dark (prefers-color-scheme emulation, darkMode: media). contrastGroupsUnder = composited text/background groups under 4.5:1 (3:1 large); blind to background-image, pseudo-elements and non-ancestor layers (coverage-map item 5).',
    documents: slugs.length, records: sweep.length, flagged: bad.length,
    summary: { non200: sweep.filter(s => s.status !== 200).length, overflow: sweep.filter(s => s.overflows).length, noH1OrMany: sweep.filter(s => s.h1 !== 1).length, imgsNoAlt: sweep.filter(s => s.imgsNoAlt).length, imgsBroken: sweep.filter(s => s.imgsBroken).length, withContrastGroups: sweep.filter(s => (s.contrastGroupsUnder || []).length).length, noTitle: sweep.filter(s => !s.title).length },
    sweep
  });
  rows.push({ surface: 'library-sweep', theme: 'both', viewport: 390, ok: true, registryId: 'library-doc:*', evidence: 'data/library-sweep.json' });
  log('sweep', slugs.length, 'docs;', bad.length, 'flagged');
};

// --- guest share ------------------------------------------------------------
groups.share = async (browser, rows) => {
  const URL_KEY = 'beat2-share';
  const lifecycle = {};
  const owner = await browser.newContext({ viewport: D1400 });
  const op = owner.request;
  const id = (raw) => `${URL_KEY}-${raw}`;
  await fetch(`${BASE}/test/clear-task-shares?urlKey=${URL_KEY}`);
  const seed = await op.post(`${BASE}/test/set-local-session`, { data: { urlKey: URL_KEY, append: true, features: { dispatch: true },
    projects: [{ id: id('proj'), name: 'Share project', content: 'A project', sortOrder: 1 }],
    issues: [{ id: id('task'), identifier: 'LOCAL-SHARE1', title: 'A shared task', description: 'Seeded for sharing', projectId: id('proj'), sortOrder: 1, state: { name: 'In Progress', type: 'started' }, url: `/workspace/${URL_KEY}/issue/${id('task')}` }] } });
  lifecycle.seed = seed.status();
  const minted = await op.post(`${BASE}/workspace/${URL_KEY}/api/task/LOCAL-SHARE1/share`, { data: { source: 'local' } });
  lifecycle.mint = { status: minted.status() };
  const mj = await minted.json().catch(() => ({}));
  const sharePath = mj.path; lifecycle.mint.pathShape = /^\/t\/[A-Za-z0-9_-]{43}$/.test(sharePath || '');
  const listed = await (await op.get(`${BASE}/workspace/${URL_KEY}/api/task/LOCAL-SHARE1/shares`)).json().catch(() => ({}));
  lifecycle.listed = { count: (listed.shares || []).length, tokenInList: JSON.stringify(listed).includes((sharePath || '').slice(3)) };
  if (!sharePath) { lifecycle.error = 'mint failed: ' + JSON.stringify(mj); await jsonOut('guest-share-lifecycle.json', lifecycle); await owner.close(); throw new Error(lifecycle.error); }

  // view: fresh signed-out contexts (captureOne makes one per capture)
  await run(browser, [{ key: 'guest-share-view', registryId: 'guest-share', kind: 'cold', path: sharePath, label: 'Guest share /t/:token — live view (minted)', viewports: THREE }], rows);
  const hdr = await fetch(`${BASE}${sharePath}`, { redirect: 'manual' });
  lifecycle.view = { status: hdr.status, referrerPolicy: hdr.headers.get('referrer-policy'), cacheControl: hdr.headers.get('cache-control'), robots: hdr.headers.get('x-robots-tag') };

  const revoked = await op.post(`${BASE}/workspace/${URL_KEY}/api/task/LOCAL-SHARE1/shares/${mj.id}/revoke`);
  lifecycle.revoke = { status: revoked.status() };
  await run(browser, [{ key: 'guest-share-revoked-404', registryId: 'guest-share', kind: 'cold', path: sharePath, label: 'Guest share — same URL after revoke (404)', viewports: TWO }], rows);
  lifecycle.afterRevoke = (await fetch(`${BASE}${sharePath}`)).status;
  lifecycle.neverIssued = (await fetch(`${BASE}/t/${'A'.repeat(43)}`)).status;
  lifecycle.retiredS = (await fetch(`${BASE}/s/${'A'.repeat(43)}`)).status;
  await owner.close();

  // 503 by interception (SYNTHETIC: no seam makes the owner check throw)
  await run(browser, [{ key: 'state-guest-share-503', registryId: 'state-guest-share-503', kind: 'intercept', html: STATES['state-guest-share-503'], label: 'Guest share 503 — SYNTHETIC (interception, production renderer)', viewports: TWO }], rows);
  await run(browser, [{ key: 'state-guest-share-404', registryId: 'state-guest-share-404', kind: 'intercept', html: STATES['state-guest-share-404'], label: 'Guest share 404 body — SYNTHETIC copy of the route page', viewports: TWO }], rows);
  lifecycle.synthetic = ['state-guest-share-503', 'state-guest-share-404 (body re-render; the live 404 is guest-share-revoked-404)'];
  await jsonOut('guest-share-lifecycle.json', lifecycle);
  await fetch(`${BASE}/test/clear-task-shares?urlKey=${URL_KEY}`);
};

// --- email ------------------------------------------------------------------
groups.email = async (browser, rows) => {
  const emailR = Object.keys(RENDERERS).filter(k => k.startsWith('renderEmail'));
  const surfaces = emailR.map(k => ({ key: `email-${k.replace(/^renderEmail/, '').replace(/Page$/, '')}`, registryId: `renderer:${k}`, kind: 'intercept', html: RENDERERS[k], label: `${k} — SYNTHETIC input to the production renderer (interception)`, viewports: TWO }));
  surfaces.push(
    { key: 'email-signin-real', registryId: 'email-signin', kind: 'cold', path: '/auth/email', darkMode: 'media', label: '/auth/email real route', viewports: THREE },
    { key: 'email-register-real', registryId: 'email-register', kind: 'cold', path: '/auth/email/register', darkMode: 'media', label: '/auth/email/register signed-out', viewports: TWO },
    { key: 'email-reproof-real', registryId: 'email-reproof', kind: 'cold', path: '/auth/email/reproof', darkMode: 'media', label: '/auth/email/reproof signed-out', viewports: TWO },
    { key: 'email-confirm-real', registryId: 'email-confirm', kind: 'cold', path: '/auth/email/confirm', darkMode: 'media', label: '/auth/email/confirm without token', viewports: TWO },
    { key: 'account-cold', registryId: 'account', kind: 'cold', path: '/account', darkMode: 'media', label: '/account signed-out (redirect)', viewports: TWO },
    { key: 'account-home', registryId: 'renderer:renderAccountHomePage', kind: 'intercept', html: RENDERERS.renderAccountHomePage, label: 'renderAccountHomePage — SYNTHETIC', viewports: TWO }
  );
  // the sent email itself: real send through the capture transport, read back from /test/email-outbox
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/auth/email`);
  const nonce = await page.locator('input[name="nonce"]').inputValue().catch(() => null);
  const to = 'beat2-reviewer@example.com';
  let sendStatus = null;
  if (nonce) { const r = await ctx.request.post(`${BASE}/auth/email/send`, { form: { email: to, nonce, mode: 'signin' } }); sendStatus = r.status(); }
  const box = await fetch(`${BASE}/test/email-outbox?to=${encodeURIComponent(to)}`);
  const msg = box.ok ? await box.json() : null;
  await ctx.close();
  await jsonOut('email-outbox.json', { sendStatus, outboxStatus: box.status, subject: msg?.subject || null, htmlBytes: msg?.html?.length ?? null, textBytes: msg?.text?.length ?? null, hasHtml: !!msg?.html,
    htmlHasInlineStyles: msg?.html ? /style="/.test(msg.html) : null, htmlHasAlt: msg?.html ? (msg.html.match(/<img/g) || []).length : null, note: 'the token in the body is redacted before commit', text: msg?.text?.replace(/[A-Za-z0-9_-]{30,}/g, '<token>') });
  if (msg?.html) surfaces.push({ key: 'email-message-signin', registryId: 'renderer:renderEmailSignInPage', kind: 'intercept', html: () => msg.html.replace(/[A-Za-z0-9_-]{30,}/g, 'TOKEN'), label: 'Sent sign-in email body (real send, capture transport) rendered in a page; email HTML is not themed, light only', themes: ['light'], viewports: TWO });
  await run(browser, surfaces, rows);
};

// --- held connection --------------------------------------------------------
groups.held = async (browser, rows) => {
  const seedHeld = (page) => page.request.post(`${BASE}/test/set-github-session`, { data: { connectionBacked: true, repos: [{ full_name: 'octocat/repo-a', private: false }, { full_name: 'octocat/repo-b', private: true }, { full_name: 'octocat/repo-c', private: false }] } }).then(r => r.json());
  let urlKey = null;
  const settings = () => `/workspace/${urlKey}/settings`;
  const surfaces = [
    { key: 'held-404', registryId: 'held-connection', kind: 'cold', path: '/connect/nope/held', darkMode: 'media', label: '/connect/nope/held — unsupported provider (404)', viewports: TWO },
    { key: 'held-expired', registryId: 'held-connection', kind: 'cold', path: '/connect/github/held', darkMode: 'media', label: '/connect/github/held without a held entry (expired, 400)', viewports: TWO },
    { key: 'held-409', registryId: 'held-connection', kind: 'cold', path: '/__held409__', label: 'Held add-source onto a workspace already holding a GitHub source (409, LIN-3334)', viewports: TWO,
      pre: async (page) => { urlKey = (await seedHeld(page)).urlKey; },
      get path() { return settings(); },
      post: async (page) => { await page.locator('[data-testid="settings-provider-add-github"] button[type="submit"]').click(); await page.waitForLoadState('networkidle'); } },
    { key: 'held-picker', registryId: 'held-connection', kind: 'cold', path: '/__held__', label: 'Held repo picker via "as a new workspace" (3002 GitHub twin env on :3199)', viewports: THREE,
      pre: async (page) => { urlKey = (await seedHeld(page)).urlKey; },
      get path() { return settings(); },
      post: async (page) => { await page.locator('[data-testid="settings-provider-new-workspace-github"]').click(); await page.waitForURL('**/connect/github/held'); } },
    { key: 'state-held-connection-503-retry', registryId: 'state-held-connection-503-retry', kind: 'intercept', html: STATES['state-held-connection-503-retry'], label: 'Held bind unavailable (503 body) — SYNTHETIC (interception)', viewports: TWO }
  ];
  // the 400 "bad request" body: the bind POST without a pick is the route's own 400
  await run(browser, surfaces, rows);
  const ctx = await browser.newContext(); const p = await ctx.newPage();
  const probes = {};
  for (const [name, url] of [['unknownProvider', '/connect/nope/held'], ['noHeldEntry', '/connect/github/held'], ['linear', '/connect/linear/held']]) probes[name] = (await ctx.request.get(`${BASE}${url}`, { maxRedirects: 0 })).status();
  probes.bindNoEntry = (await ctx.request.post(`${BASE}/connect/github/held/bind`, { form: {}, maxRedirects: 0 })).status();
  await ctx.close();
  await jsonOut('held-connection-probes.json', { note: 'status probes on :3199 (GitHub App env as :3002 twin); 503/400 bind bodies that no seam can produce are interception states', probes });
};

// --- states / remaining intercepted renderers -------------------------------
groups.states = async (browser, rows) => {
  const surfaces = Object.entries(STATES).filter(([k]) => /upstream/.test(k)).map(([k, f]) => ({ key: k, registryId: k, kind: 'intercept', html: f, label: `${k} — SYNTHETIC (interception; {status}/{code}/Error)`, viewports: TWO }));
  for (const k of ['renderWorkspaceLimitPage', 'renderServiceUnavailablePage', 'renderTaskNotFoundPage', 'renderLoginPage']) surfaces.push({ key: `err-${k.replace(/^render/, '').replace(/Page$/, '')}`, registryId: `renderer:${k}`, kind: 'intercept', html: RENDERERS[k], label: `${k} — SYNTHETIC`, viewports: TWO });
  await run(browser, surfaces, rows);
};

// --- legacy redirects -------------------------------------------------------
groups.redir = async (browser, rows) => {
  const out = [];
  for (const [id, p] of [['legacy-audit', '/audit'], ['legacy-settings', '/settings'], ['legacy-prompts', '/prompts']]) {
    const ctx = await browser.newContext(); const first = await ctx.request.get(`${BASE}${p}`, { maxRedirects: 0 });
    const final = await ctx.request.get(`${BASE}${p}`);
    out.push({ id, path: p, status: first.status(), location: first.headers()['location'] || null, finalUrl: final.url().replace(BASE, ''), finalStatus: final.status() });
    await ctx.close();
    rows.push({ surface: id, theme: 'n/a', viewport: 0, ok: first.status() >= 300 && first.status() < 400, registryId: id, evidence: 'data/legacy-redirects.json' });
  }
  await jsonOut('legacy-redirects.json', { note: 'cold (no session) hops; app-session hops are beat 3', hops: out });
  log(JSON.stringify(out));
};


// --- extras: landing doors, archive dark-scheme check ------------------------
groups.extras = async (browser, rows) => {
  const out = { landing: {}, archives: {} };
  for (const [label, vp] of [['1400', D1400], ['390', D390]]) {
    const ctx = await browser.newContext({ viewport: vp }); const page = await ctx.newPage();
    await page.goto(`${BASE}/`, { waitUntil: 'load' });
    out.landing[label] = await page.evaluate(() => {
      const doors = [...document.querySelectorAll('a[href^="/auth/"]')];
      const rect = (e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
      return { doors: doors.map(d => { const cs = getComputedStyle(d); return { href: d.getAttribute('href'), text: d.textContent.trim().slice(0, 40), className: d.className, background: cs.backgroundColor, color: cs.color, border: cs.borderTopColor, fontWeight: cs.fontWeight, rect: rect(d) }; }),
        distinctBackgrounds: [...new Set(doors.map(d => getComputedStyle(d).backgroundColor))],
        buttonsAndLinksAboveFold: [...document.querySelectorAll('a,button')].filter(e => e.getBoundingClientRect().top < innerHeight && e.getBoundingClientRect().height > 0).length };
    });
    await ctx.close();
  }
  for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
    const html = await (await fetch(`${BASE}/archive/${n}`)).text();
    const css = [...html.matchAll(/<link[^>]+href="([^"]+\.css[^"]*)"/g)].map(m => m[1]);
    let linkedHas = false;
    for (const href of css) { const t = await (await fetch(new URL(href, BASE))).text(); if (/prefers-color-scheme\s*:\s*dark/.test(t)) linkedHas = true; }
    out.archives[n] = { inlineHasPrefersColorSchemeDark: /prefers-color-scheme\s*:\s*dark/.test(html), linkedCssHasIt: linkedHas, linkedCss: css, bodyClass: (html.match(/<body[^>]*class="([^"]*)"/) || [])[1] || null, colorSchemeMeta: /<meta[^>]+color-scheme/.test(html) };
  }
  await jsonOut('landing-and-archive-checks.json', out);
  rows.push({ surface: 'landing-doors', theme: 'light', viewport: 1400, ok: true, registryId: 'landing', evidence: 'data/landing-and-archive-checks.json' });
  rows.push({ surface: 'archive-dark-scheme-check', theme: 'dark', viewport: 0, ok: true, registryId: 'archive-8', evidence: 'data/landing-and-archive-checks.json' });
  log(JSON.stringify(out.landing['1400'].distinctBackgrounds), Object.entries(out.archives).map(([k, v]) => `${k}:${v.inlineHasPrefersColorSchemeDark || v.linkedCssHasIt}`).join(' '));
};

// --- lighthouse -------------------------------------------------------------
const LH_ROUTES = [['landing', '/'], ['templates', '/templates'], ['styleguide', '/styleguide'], ['privacy', '/privacy'], ['terms', '/terms'], ['kpis-public', '/kpis'], ['archive-1', '/archive/1'], ['archive-2', '/archive/2'], ['archive-3', '/archive/3'], ['archive-4', '/archive/4'], ['archive-5', '/archive/5'], ['archive-6', '/archive/6'], ['archive-7', '/archive/7'], ['archive-8', '/archive/8'], ['archive-9', '/archive/9'], ['archive-999', '/archive/999'], ['swipe-public', '/swipe'], ['swim-public', '/swim'], ['ship-public', '/ship'], ['library-index', '/library'], ['library-paper', '/library/theseus-method'], ['library-doc', '/library/doc/autopilot-operating-manual-v2'], ['email-signin', '/auth/email'], ['email-register', '/auth/email/register'], ['email-reproof', '/auth/email/reproof'], ['email-confirm', '/auth/email/confirm'], ['held-connection', '/connect/github/held'], ['guest-share', '/t/not-a-real-token']];
groups.lh = async (browser, rows) => {
  await mkdir(path.join(OUT, 'lighthouse'), { recursive: true });
  const only = process.argv.slice(2).filter(a => a.startsWith('lh:')).map(a => a.slice(3));
  for (const [id, p] of LH_ROUTES) {
    if (only.length && !only.includes(id)) continue;
    const tmp = path.join(OUT, 'lighthouse', `_${id}.raw.json`);
    try {
      execFileSync('node', [LH, `${BASE}${p}`, '--quiet', '--output=json', `--output-path=${tmp}`, '--only-categories=accessibility,best-practices,seo,performance', '--ignore-status-code', '--chrome-flags=--headless=new --no-sandbox'], { stdio: 'pipe', timeout: 180000, env: { ...process.env, CHROME_PATH: process.env.CHROME_PATH || chromium.executablePath() } });
      const raw = JSON.parse(await readFile(tmp, 'utf8'));
      const failing = Object.values(raw.audits).filter(a => a.score !== null && a.score < 1 && a.scoreDisplayMode !== 'informative' && a.scoreDisplayMode !== 'notApplicable' && a.scoreDisplayMode !== 'manual').map(a => ({ id: a.id, score: a.score, title: a.title, items: (Array.isArray(a.details?.items) ? a.details.items : []).slice(0, 4).map(i => ({ selector: i.node?.selector, snippet: i.node?.snippet?.slice(0, 80), explanation: i.node?.explanation?.slice(0, 160), url: i.url, wastedMs: i.wastedMs })) }));
      await writeFile(path.join(OUT, 'lighthouse', `${id}.json`), JSON.stringify({ id, url: p, lighthouseVersion: raw.lighthouseVersion, fetchTime: raw.fetchTime, finalUrl: raw.finalUrl.replace(BASE, ''), runtimeError: raw.runtimeError || null, scores: Object.fromEntries(Object.entries(raw.categories).map(([k, v]) => [k, v.score])), metrics: Object.fromEntries(['first-contentful-paint', 'largest-contentful-paint', 'cumulative-layout-shift', 'total-blocking-time'].map(m => [m, raw.audits[m]?.numericValue])), failing }, null, 1));
      rows.push({ surface: `lh-${id}`, theme: 'light', viewport: 412, ok: true, registryId: id, evidence: `lighthouse/${id}.json` });
      log('LH ', id, JSON.stringify(Object.fromEntries(Object.entries(raw.categories).map(([k, v]) => [k, v.score]))));
    } catch (e) { rows.push({ surface: `lh-${id}`, theme: 'light', viewport: 412, ok: false, registryId: id, reason: String(e.message).split('\n')[0] }); log('LH FAIL', id, String(e.message).split('\n')[0]); }
    finally { await import('node:fs/promises').then(f => f.rm(tmp, { force: true })); }
  }
};

// --- live harbour.cat -------------------------------------------------------
groups.live = async (browser, rows) => {
  const out = [];
  const ctx = await browser.newContext({ viewport: D1400 });
  for (const [id, p] of LH_ROUTES) {
    const rec = { id, path: p };
    try {
      const mine = await fetch(`${BASE}${p}`, { redirect: 'manual' });
      const r = await fetch(`${LIVE}${p}`, { redirect: 'manual', signal: AbortSignal.timeout(20000) });
      const body = await r.text();
      const title = (body.match(/<title>([^<]*)/i) || [])[1] || null;
      const mineBody = await mine.text();
      const doors = (b) => (b.match(/href="\/auth\/(linear|github|jira|email)/g) || []).length;
      Object.assign(rec, { liveStatus: r.status, localStatus: mine.status, liveTitle: title, localTitle: (mineBody.match(/<title>([^<]*)/i) || [])[1] || null, liveBytes: body.length, localBytes: mineBody.length, liveDoors: doors(body), localDoors: doors(mineBody), liveLocation: r.headers.get('location'), selfHostNoticeLocalOnly: /LINEAR_ACCESS_TOKEN/.test(mineBody) });
      const page = await ctx.newPage();
      const resp = await page.goto(`${LIVE}${p}`, { waitUntil: 'load', timeout: 25000 }).catch(() => null);
      if (resp) { await page.waitForTimeout(400); const png = path.join(OUT, `live-${id}-light-1400px.png`); await page.screenshot({ path: png }); rec.capture = path.basename(png); }
      await page.close();
      rows.push({ surface: `live-${id}`, theme: 'light', viewport: 1400, ok: !!resp, registryId: id, ...(resp ? {} : { reason: 'live unreachable (named limit)' }) });
    } catch (e) { rec.error = String(e.message).split('\n')[0]; rows.push({ surface: `live-${id}`, theme: 'light', viewport: 1400, ok: false, registryId: id, reason: `live unreachable: ${rec.error}` }); }
    out.push(rec); log('LIVE', id, rec.liveStatus ?? rec.error, 'doors live/local', rec.liveDoors, rec.localDoors);
  }
  await ctx.close();
  await jsonOut('live-comparison.json', { liveBase: LIVE, comparedAt: new Date().toISOString(), note: 'Self-host "set LINEAR_ACCESS_TOKEN" notice appears locally only: a diff, not a defect. Local = :3199 landing-faithful env (boot-3199.mjs).', surfaces: out });
};

// ---------------------------------------------------------------------------
const want = process.argv.slice(2).filter(a => !a.startsWith('lh:'));
const todo = want.length ? want : Object.keys(groups);
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const rows = [];
let failed = false;
for (const g of todo) {
  if (!groups[g]) { console.error('unknown group', g, Object.keys(groups)); process.exit(2); }
  log(`\n== ${g} ==`);
  try { await groups[g](browser, rows); } catch (e) { failed = true; console.error(`group ${g} failed:`, e.message); }
}
await browser.close();
await upsertManifest(rows.map(r => ({ ...r, surface: r.surface, theme: r.theme, viewport: r.viewport })));
log(`\n== summary == rows=${rows.length} ok=${rows.filter(r => r.ok).length} failed=${rows.filter(r => !r.ok).length}`);
process.exit(failed || rows.some(r => !r.ok) ? 1 : 0);
