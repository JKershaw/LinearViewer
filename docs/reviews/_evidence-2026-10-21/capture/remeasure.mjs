/**
 * LIN-3751 (LIN-3747 beat 4): fresh-render re-measure of the cited regressions and the
 * unminted F4/F5/F6/A-items. Docs-only tooling; does not touch tests/visual or tests/screenshots.
 *
 * Every figure lands in remeasure/<id>.json; the report cites the JSON, never this log.
 * Server: BASE_URL (default :3199, boot-3199.mjs). Dark via the real `theme` cookie with
 * `theme-dark` asserted in the same read. Intercepted renders are SYNTHETIC production-renderer output.
 *
 *   BASE_URL=http://localhost:3199 node remeasure.mjs
 */
import { chromium } from 'playwright';
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PARSE_COLOR_JS, COMPOSITE_JS, CENSUS_SAMPLER_JS } from './metrics.mjs';
import { STATES, RENDERERS } from './renderer-args.mjs';
import * as pages from '../../../../lib/render-pages.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EVID = path.resolve(__dirname, '..');
const OUT = path.join(EVID, 'remeasure');
const BASE = process.env.BASE_URL || 'http://localhost:3199';
const WS = '/workspace/test-workspace';
const FEATURES = encodeURIComponent(JSON.stringify({
  dispatch: true, proxy: true, roadmap: true, collective: true, taskChat: true, ship: true,
  nextRun: true, flightCompanion: true, passagePlanner: true, shipBiscuit: true,
  liveConsole: true, shipJourney: true, feedbackWidget: true,
}));
const APP = `/test/set-session?features=${FEATURES}`;
const head = execSync('git rev-parse --short HEAD', { cwd: EVID }).toString().trim();
const save = (id, obj) => writeFile(path.join(OUT, `${id}.json`), JSON.stringify({ id, base: BASE, head, ...obj }, null, 2));

const HELPERS = `${PARSE_COLOR_JS}\n${COMPOSITE_JS}`;
/** computed colour + composited ratio for every element matching `sel`. */
const COLOURS_JS = (sel) => `(() => { ${HELPERS}
  return [...document.querySelectorAll(${JSON.stringify(sel)})].map(el => {
    const cs = getComputedStyle(el); const bg = effBg(el); const fg = parseColor(cs.color);
    const fgc = fg[3] < 1 ? over(bg, fg) : fg;
    return { tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 60), text: (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 50),
      color: cs.color, bg: 'rgb(' + bg.join(',') + ')', ratio: +ratio(fgc, bg).toFixed(2), fontSize: cs.fontSize, fontFamily: cs.fontFamily.slice(0, 60) };
  }); })()`;

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
async function ctxFor(theme, width = 1400, { session = APP, media = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: width > 600 ? 1000 : 844 }, ...(media ? { colorScheme: theme } : {}) });
  if (!media) await ctx.addCookies([{ name: 'theme', value: theme, url: BASE }]);
  if (session) await ctx.request.get(`${BASE}${session}`);
  return ctx;
}
async function open(ctx, p) {
  const page = await ctx.newPage(); page.setDefaultTimeout(15000);
  const resp = await page.goto(`${BASE}${p}`, { waitUntil: 'load' }); await page.waitForTimeout(500);
  return { page, status: resp.status() };
}
const themeOf = (page) => page.evaluate(() => document.documentElement.className);
async function intercepted(html, theme, width) {
  const ctx = await browser.newContext({ viewport: { width, height: width > 600 ? 1000 : 844 }, colorScheme: theme });
  await ctx.addCookies([{ name: 'theme', value: theme, url: BASE }]);
  const page = await ctx.newPage();
  await page.route('**/*', r => r.request().resourceType() === 'document' ? r.fulfill({ status: 200, body: html, contentType: 'text/html' }) : r.continue());
  await page.goto(`${BASE}/__intercept__/x`, { waitUntil: 'load' }); await page.waitForTimeout(300);
  return { ctx, page };
}

await mkdir(OUT, { recursive: true });

// ---- LIN-3119 (F1): dark bare action-btn / a.settings-action / a.stat-link / UA-blue links --------
{
  const rows = {};
  for (const [name, p] of [['dispatch', `${WS}/dispatch`], ['settings', `${WS}/settings`], ['runner', `${WS}/runner`], ['proxy', `${WS}/proxy`]]) {
    const ctx = await ctxFor('dark'); const { page, status } = await open(ctx, p);
    const cls = await themeOf(page);
    rows[name] = {
      status, htmlClass: cls, themeAssertion: cls.split(/\s+/).includes('theme-dark'),
      actionBtn: await page.evaluate(COLOURS_JS('.action-btn')),
      settingsAction: await page.evaluate(COLOURS_JS('a.settings-action')),
      statLink: await page.evaluate(COLOURS_JS('a.stat-link')),
      namedLinks: (await page.evaluate(COLOURS_JS('a'))).filter(l => /create a preset|set up a runner/i.test(l.text)),
    };
    await ctx.close();
  }
  const css = await readFile(path.resolve(EVID, '../../../public/common-actions.css'), 'utf8');
  const actionBtnRule = css.split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => /\.action-btn\b/.test(l)).slice(0, 6);
  const below = Object.values(rows).flatMap(r => [...r.actionBtn, ...r.settingsAction, ...r.statLink, ...r.namedLinks]).filter(e => e.ratio < 4.5);
  await save('lin-3119', { question: 'dark theme: bare .action-btn / a.settings-action / a.stat-link / UA-blue links below AA?', rows, actionBtnRuleLines: actionBtnRule,
    summary: { elementsBelow4_5: below.length, worst: below.sort((a, b) => a.ratio - b.ratio)[0] || null, namedLinksFound: Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, v.namedLinks.map(l => `${l.text} ${l.color} ${l.ratio}:1`)])) } });
}

// ---- LIN-3120 (F2): /ship and /workspace/:k/ship headings and title --------------------------------
{
  const out = {};
  for (const [name, p, session] of [['ship-public', '/ship', null], ['ship-workspace', `${WS}/ship`, APP]]) {
    const ctx = await ctxFor('light', 1400, { session }); const { page, status } = await open(ctx, p);
    out[name] = await page.evaluate(() => ({ title: document.title, headings: [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map(h => h.tagName + ':' + h.textContent.trim().slice(0, 40)), ariaLabelled: [...document.querySelectorAll('[role=heading],[aria-label]')].length, landmarkMain: document.querySelectorAll('main,[role=main]').length }));
    out[name].status = status; out[name].finalPath = new URL(page.url()).pathname; await ctx.close();
  }
  await save('lin-3120', { question: '/ship and /workspace/:k/ship: zero headings, bare title?', rows: out, summary: Object.fromEntries(Object.entries(out).map(([k, v]) => [k, { headingCount: v.headings.length, title: v.title }])) });
}

// ---- LIN-3121 (F3) + F5: upstream prose vs diagnostic; provider-neutral copy ------------------------
{
  const cases = {};
  for (const id of ['state-upstream-429', 'state-upstream-5xx', 'state-upstream-auth', 'state-upstream-internal']) {
    const { ctx, page } = await intercepted(STATES[id](), 'light', 1400);
    cases[id] = await page.evaluate(() => ({ title: document.title, h: (document.querySelector('h1,h2') || {}).textContent, message: (document.querySelector('.error-message') || {}).textContent, diagnostic: ((document.querySelector('.error-details') || {}).innerText || '').replace(/\s+/g, ' ').trim() }));
    await ctx.close();
  }
  const src = execSync(`sed -n 690,712p lib/render-pages.js`, { cwd: path.resolve(EVID, '../../..') }).toString();
  const lines = execSync(`grep -n "Trouble Reaching Linear\\|reach Linear's API\\|Linear rejected" lib/render-pages.js`, { cwd: path.resolve(EVID, '../../..') }).toString().trim().split('\n');
  const log = execSync(`git log --oneline 0b4bd287..HEAD -- lib/render-pages.js | head`, { cwd: path.resolve(EVID, '../../..') }).toString().trim().split('\n').filter(Boolean);
  await save('lin-3121-f5', { question: 'upstream prose contradicts its own diagnostic (3121); "Linear" hardcoded for every backend (F5)?', cases, sourceLines: lines, sourceExcerpt: src, commitsTouchingFileSinceGrounding: log,
    summary: { prose429: cases['state-upstream-429']?.message, diagnostic429: cases['state-upstream-429']?.diagnostic, prose5xx: cases['state-upstream-5xx']?.message, diagnostic5xx: cases['state-upstream-5xx']?.diagnostic, linearInTitleForNonLinearBackend: /Linear/.test(cases['state-upstream-5xx']?.h || '') } });
}

// ---- LIN-3123 (F8): light fill tokens used as text -----------------------------------------------------
{
  const census = JSON.parse(await readFile(path.join(EVID, 'census.json'), 'utf8'));
  const FILL = { 'rgb(212, 166, 0)': '--yellow', 'rgb(22, 163, 74)': '--green', 'rgb(255, 178, 36)': '--amber' };
  const hits = [];
  for (const e of Object.values(census.entries)) {
    const t = e.themes?.light; if (!t) continue;
    for (const g of t.groups || []) if (FILL[g.color]) hits.push({ id: e.id, token: FILL[g.color], element: g.element, ratio: g.ratio, samples: g.samples });
  }
  const ctx = await ctxFor('light'); const { page } = await open(ctx, `${WS}/`);
  const tree = (await page.evaluate(COLOURS_JS('*'))).filter(e => /◐|In Progress/.test(e.text) && e.color === 'rgb(212, 166, 0)');
  await ctx.close();
  const runner = JSON.parse(await readFile(path.join(EVID, 'authenticated/ws-runner--minted-and-copied--light-1400px.json'), 'utf8').catch(() => 'null'));
  const css = execSync(`sed -n 70,80p public/runner-setup.css`, { cwd: path.resolve(EVID, '../../..') }).toString();
  await save('lin-3123', { question: 'light: --yellow/--green/--amber fill tokens used as text below AA?', censusSource: 'census.json (light, 1400, own-background composited)',
    censusHits: hits, treeInProgress: tree.slice(0, 4), runnerCss: css, runnerMintedLightGroups: runner?.contrast?.belowThreshold?.filter(g => FILL[g.color]) || null,
    summary: { pagesWithFillTokenAsText: [...new Set(hits.map(h => h.id))].length, treeInProgressRatio: tree[0]?.ratio ?? null, byToken: hits.reduce((a, h) => ((a[h.token] = (a[h.token] || 0) + 1), a), {}) } });
}

// ---- F4: UA-default controls on the error/consent family ---------------------------------------------
{
  const targets = { 'jira-link-form': () => pages.renderJiraLinkForm ? pages.renderJiraLinkForm({}) : null, 'jira-site-picker': RENDERERS.renderJiraSiteSelectPage, 'github-repo-picker': RENDERERS.renderGitHubRepoSelectPage, 'github-projects-picker': RENDERERS.renderGitHubProjectSelectPage, 'workspace-not-found': RENDERERS.renderWorkspaceNotFoundPage, 'email-signin': RENDERERS.renderEmailSignInPage };
  const out = {};
  for (const [name, fn] of Object.entries(targets)) {
    const html = fn?.(); if (!html) { out[name] = { skipped: 'renderer not exported' }; continue; }
    out[name] = {};
    for (const theme of ['light', 'dark']) {
      const { ctx, page } = await intercepted(html, theme, 1400);
      out[name][theme] = await page.evaluate(`(() => { ${HELPERS}
        const ua = (el) => { const cs = getComputedStyle(el); return { tag: el.tagName.toLowerCase(), type: el.type || null, text: (el.textContent || el.placeholder || '').trim().slice(0, 30), color: cs.color, bg: 'rgb(' + effBg(el).join(',') + ')', border: cs.borderTopWidth + ' ' + cs.borderTopStyle + ' ' + cs.borderTopColor, font: cs.fontFamily.slice(0, 30), ratio: +ratio(parseColor(cs.color), effBg(el)).toFixed(2) }; };
        return { controls: [...document.querySelectorAll('input:not([type=hidden]),select,textarea')].map(ua), links: [...document.querySelectorAll('a')].map(ua) }; })()`);
      await ctx.close();
    }
  }
  const flat = Object.entries(out).flatMap(([n, v]) => ['light', 'dark'].flatMap(t => (v[t]?.links || []).map(l => ({ page: n, theme: t, ...l }))));
  const uaBlue = flat.filter(l => l.color === 'rgb(0, 0, 238)' || l.color === 'rgb(158, 158, 255)');
  const whiteDark = Object.entries(out).flatMap(([n, v]) => (v.dark?.controls || []).filter(c => /255, ?255, ?255/.test(c.bg)).map(c => ({ page: n, ...c })));
  await save('f4', { question: 'UA-default controls on the error/consent family (Jira API-token form, provider selects, workspace-not-found link)?', note: 'SYNTHETIC production-renderer output via interception', pages: out, summary: { uaDefaultBlueLinks: uaBlue.map(l => `${l.page}/${l.theme}: ${l.text} ${l.color} ${l.ratio}:1`), whiteControlsOnDark: whiteDark.map(c => `${c.page}: ${c.tag}${c.type ? '[' + c.type + ']' : ''}`) } });
}

// ---- F6: archive sign-off contrast ----------------------------------------------------------------------
{
  const census = JSON.parse(await readFile(path.join(EVID, 'census.json'), 'utf8'));
  const rows = [];
  for (const e of Object.values(census.entries)) {
    if (!/^archive/.test(e.id)) continue;
    for (const theme of ['light', 'dark']) for (const g of e.themes?.[theme]?.groups || []) rows.push({ id: e.id, theme, element: g.element, ratio: g.ratio, color: g.color, bg: g.bg, samples: g.samples });
  }
  await save('f6', { question: 'archive sign-offs at 2.94:1?', census: 'census.json', rows, summary: { signOffRows: rows.filter(r => /sign|foot|colophon|compiled/i.test(r.element + r.samples.join(' '))).map(r => `${r.id} ${r.theme} ${r.element} ${r.ratio}:1`), anyGroupBelow: rows.length } });
}

// ---- A1 titles, A4 nav order, A13/A14 wordmark at 390, A10 internal IDs, A5 mono prose, A3 Stop styling -------
{
  const routes = [['landing', '/', null], ['library', '/library', null], ['guest-404', '/t/not-a-token', null], ['email-signin', '/auth/email', null], ['kpis-public', '/kpis', null], ['ship-public', '/ship', null], ['swim-public', '/swim', null], ['swipe-public', '/swipe', null], ['templates', '/templates', null], ['styleguide', '/styleguide', null], ['terms', '/terms', null], ['privacy', '/privacy', null],
    ...['', '/settings', '/dispatch', '/proxy', '/roadmap', '/kpis', '/runner', '/ship', '/swim', '/swipe', '/audit', '/prompts', '/collective', '/observation', '/live-console', '/next-run', '/ship-biscuit', '/flight-companion', '/passage-planner'].map(s => [`ws${s || '-tree'}`, `${WS}${s}/`.replace(/\/\/$/, '/'), APP])];
  const rows = [];
  for (const [name, p, session] of routes) {
    for (const width of [1400, 390]) {
      const ctx = await ctxFor('light', width, { session }); const { page, status } = await open(ctx, p);
      const r = await page.evaluate(() => {
        const vis = (el) => { const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
        const text = document.body.innerText || '';
        const prose = [...document.querySelectorAll('p,li,div,span')].filter(el => !el.children.length && vis(el)).map(el => ({ el, t: (el.textContent || '').trim(), cs: getComputedStyle(el) })).filter(x => x.t.split(/\s+/).length >= 12 && /mono|courier/i.test(x.cs.fontFamily));
        const nav = [...document.querySelectorAll('nav a')].filter(vis).map(a => a.textContent.trim()).filter(Boolean);
        return { title: document.title, finalPath: location.pathname, wordmarkVisible: [...document.querySelectorAll('.wordmark-nav')].filter(el => { if (!vis(el)) return false; const b = el.getBoundingClientRect(); const hit = document.elementFromPoint(Math.min(b.left + b.width / 2, innerWidth - 1), b.top + b.height / 2); return b.right > 0 && b.left < innerWidth && hit && (el === hit || el.contains(hit) || hit.contains(el)); }).length, wordmarkInDom: document.querySelectorAll('.wordmark-nav').length, shellH1: (() => { const h = document.querySelector('h1'); if (!h) return null; const cs = getComputedStyle(h); return { text: h.textContent.trim().slice(0, 30), font: cs.fontFamily.slice(0, 30), px: cs.fontSize }; })(), brandMarks: document.querySelectorAll('.wordmark-nav,.wordmark-footer').length + ([...document.querySelectorAll('h1')].some(h => /^harbour$/i.test(h.textContent.trim())) ? 1 : 0), nav, ticketIds: [...new Set(text.match(/\b(?:LIN|LV|SD)-\d{2,5}\b/g) || [])], monoProse: prose.slice(0, 3).map(x => `${x.cs.fontFamily.slice(0, 20)} ${x.cs.fontSize} "${x.t.slice(0, 50)}"`), monoProseCount: prose.length };
      });
      rows.push({ name, path: p, width, status, ...r }); await ctx.close();
    }
  }
  const t = rows.filter(r => r.width === 1400);
  const nav390 = rows.filter(r => r.width === 390 && r.nav.length);
  await save('a-items-routes', { question: 'A1 title drift, A4 nav order, A5 mono prose, A10 internal ids, A13/A14 wordmark at 390', rows });
  const navOrders = {}; t.filter(r => r.nav.length).forEach(r => { (navOrders[r.nav.join(' | ')] ||= []).push(r.name); });
  await save('a1', { question: 'title drift: "- Projects" suffix and bare titles', titles: t.map(r => ({ name: r.name, status: r.status, title: r.title })), summary: { endsWithProjects: t.filter(r => / - Projects$/.test(r.title)).map(r => r.name), bareOrSuffixless: t.filter(r => !/ - /.test(r.title)).map(r => `${r.name}: ${r.title}`), guest404: t.find(r => r.name === 'guest-404') } });
  await save('a4', { question: 'per-page nav order', distinctOrders: navOrders, summary: { distinctOrderCount: Object.keys(navOrders).length } });
  await save('a5', { question: 'mono used for prose (>=12 words in a monospace element)', rows: t.map(r => ({ name: r.name, monoProseCount: r.monoProseCount, examples: r.monoProse })), summary: { pagesWithMonoProse: t.filter(r => r.monoProseCount).map(r => `${r.name}:${r.monoProseCount}`) } });
  await save('a10', { question: 'internal ticket ids in user copy', rows: t.filter(r => r.ticketIds.length).map(r => ({ name: r.name, ids: r.ticketIds })), summary: { pages: t.filter(r => r.ticketIds.length).map(r => `${r.name}: ${r.ticketIds.join(',')}`) } });
  await save('a13-a14', { question: 'wordmark missing at 390; two brand marks', rows: rows.map(r => ({ name: r.name, width: r.width, status: r.status, wordmarkInDom: r.wordmarkInDom, wordmarkVisible: r.wordmarkVisible, shellH1: r.shellH1 })), summary: { navWordmarkVisibleAt1400: rows.filter(r => r.width === 1400 && r.wordmarkVisible).map(r => r.name), navWordmarkInDomButNotVisibleAt390: rows.filter(r => r.width === 390 && r.wordmarkInDom && !r.wordmarkVisible).map(r => r.name), navWordmarkVisibleAt390: rows.filter(r => r.width === 390 && r.wordmarkVisible).map(r => r.name), pagesWithoutNavWordmark1400: rows.filter(r => r.width === 1400 && !r.wordmarkInDom).map(r => `${r.name}: h1=${r.shellH1 ? r.shellH1.text + ' / ' + r.shellH1.font : 'none'}`) } });
}
{
  const ctx = await ctxFor('light'); const { page } = await open(ctx, `${WS}/dispatch`);
  const btns = await page.evaluate(`(() => [...document.querySelectorAll('button,.action-btn,a.action-btn')].filter(b => /^(pause|stop|resume)$/i.test((b.textContent || '').trim())).map(b => { const cs = getComputedStyle(b); return { text: b.textContent.trim(), cls: String(b.className), testid: b.dataset.testid || null, color: cs.color, bg: cs.backgroundColor, border: cs.borderTopColor, fontWeight: cs.fontWeight }; }))()`);
  await ctx.close();
  const same = btns.length > 1 && btns.every(b => b.color === btns[0].color && b.bg === btns[0].bg && b.border === btns[0].border);
  await save('a3', { question: 'Stop styled like Pause and Resume?', buttons: btns, summary: { found: btns.map(b => b.text), identicalStyle: same } });
}

{
  const c = await ctxFor('light'); const d = await open(c, `${WS}/dispatch`); const st = await open(c, `${WS}/settings`);
  const f = (pg, sel) => pg.page.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const cs = getComputedStyle(e); const sec = e.closest('section,.card,details') && e.closest('section,.card,details').querySelector('h2,h3,summary,.section-title'); const sc = sec && getComputedStyle(sec); return { sel: ${JSON.stringify(sel)}, fontFamily: cs.fontFamily.slice(0, 40), fontSize: cs.fontSize, fontWeight: cs.fontWeight, words: e.textContent.trim().split(/\\s+/).length, sectionTitle: sec ? { text: sec.textContent.trim().slice(0, 30), fontSize: sc.fontSize, fontFamily: sc.fontFamily.slice(0, 30) } : null }; })()`);
  const a5named = { 'dispatch .guide-halt-note': await f(d, '.guide-halt-note'), 'settings .model-workspace-note': await f(st, '.model-workspace-note') };
  await c.close();
  const prev = JSON.parse(await readFile(path.join(OUT, 'a5.json'), 'utf8'));
  await save('a5', { ...prev, id: undefined, named: a5named });
}

// ---- Research hypotheses: guest 404, library double h1, Integration Guide mono prose -----------------------
{
  const ctx = await ctxFor('light', 1400, { session: null }); const g = await open(ctx, '/t/not-a-token');
  const guest = await g.page.evaluate(() => ({ title: document.title, headings: [...document.querySelectorAll('h1,h2')].map(h => h.tagName + ':' + h.textContent.trim()), body: document.body.innerText.replace(/\s+/g, ' ').trim().slice(0, 300), links: [...document.querySelectorAll('a,button')].map(a => `${a.tagName}:${a.textContent.trim()}->${a.getAttribute('href') || ''}`) }));
  guest.status = g.status; await ctx.close();
  const lib = {};
  for (const p of ['/library', '/library/drawing-the-ship', '/library/doc/charter']) {
    const c = await ctxFor('light', 1400, { session: null }); const r = await open(c, p);
    lib[p] = await r.page.evaluate(() => ({ title: document.title, h1: [...document.querySelectorAll('h1')].map(h => h.textContent.trim().slice(0, 60)) })); lib[p].status = r.status; await c.close();
  }
  const c3 = await ctxFor('dark'); const d = await open(c3, `${WS}/dispatch`);
  const guide = await d.page.evaluate(() => { const els = [...document.querySelectorAll('.guide-halt-note')]; return els.map(e => { const cs = getComputedStyle(e); return { text: e.textContent.trim().replace(/\s+/g, ' ').slice(0, 90), fontFamily: cs.fontFamily.slice(0, 40), fontSize: cs.fontSize, fontWeight: cs.fontWeight }; }); });
  await c3.close();
  await save('hypotheses', { guest404: guest, library: lib, integrationGuideDark: guide, summary: { guest404Title: guest.title, guest404LinksOnly: guest.links, guest404Status: guest.status, libraryH1Counts: Object.fromEntries(Object.entries(lib).map(([k, v]) => [k, v.h1.length])), integrationGuideMono: guide.map(g => `${g.fontFamily} ${g.fontSize} ${g.fontWeight}`) } });
}

// ---- Synthetic non-Linear merge-consent / reauth (09-26 §7.1) ----------------------------------------------
{
  await mkdir(path.join(OUT, 'synthetic'), { recursive: true });
  const cases = [
    ['merge-github', 'renderMergeConfirmPage', pages.renderMergeConfirmPage({ identityLabel: 'GitHub' })],
    ['merge-jira', 'renderMergeConfirmPage', pages.renderMergeConfirmPage({ identityLabel: 'Jira' })],
    ['merge-email', 'renderMergeConfirmPage', pages.renderMergeConfirmPage({ identityLabel: 'email' })],
    ['reauth-github', 'renderMergeReauthRequiredPage', pages.renderMergeReauthRequiredPage({ identityLabel: 'GitHub', reauthUrl: '/auth/github' })],
    ['reauth-jira', 'renderMergeReauthRequiredPage', pages.renderMergeReauthRequiredPage({ identityLabel: 'Jira', reauthUrl: '/auth/jira/oauth?mode=new' })],
    ['reauth-email-noproof', 'renderMergeReauthRequiredPage', pages.renderMergeReauthRequiredPage({ identityLabel: 'email', reauthUrl: null, note: 'The sign-in link you used has already been spent.' })],
  ];
  const rows = [];
  for (const [name, renderer, html] of cases) {
    for (const [theme, width] of [['light', 1400], ['light', 390], ['dark', 1400], ['dark', 390]]) {
      const { ctx, page } = await intercepted(html, theme, width);
      const m = await page.evaluate(`(() => { ${HELPERS}
        const sweep = ${CENSUS_SAMPLER_JS};
        const btns = [...document.querySelectorAll('.login-button')].map(b => { const r = b.getBoundingClientRect(); return { text: b.textContent.trim(), w: Math.round(r.width), top: Math.round(r.top), bottom: Math.round(r.bottom) }; });
        return { title: document.title, headings: [...document.querySelectorAll('h1,h2')].map(h => h.tagName + ':' + h.textContent.trim()), text: document.body.innerText.replace(/\\s+/g, ' ').trim(), htmlClass: document.documentElement.className, bodyBg: getComputedStyle(document.body).backgroundColor, sampled: sweep.sampled, contrastBelow: sweep.groups, buttons: btns, buttonGapPx: btns.length === 2 ? btns[1].top - btns[0].bottom : null, scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth }; })()`);
      const cell = `${name}--${theme}-${width}px`;
      const keep = (theme === 'light' && width === 1400) || (theme === 'dark' && width === 390);
      if (keep) await page.screenshot({ path: path.join(OUT, 'synthetic', `${cell}.png`) });
      rows.push({ cell, renderer, label: 'synthetic', pngKept: keep, ...m });
      await ctx.close();
    }
  }
  await save('synthetic-merge-reauth', { label: 'SYNTHETIC: production renderers, non-Linear identityLabel, served by request interception at a real origin. /test/set-merge-conflict-session hardcodes linear (routes/test.js:360/380/382); no seam added.', rows,
    summary: { rendered: rows.length, buttonGaps: rows.filter(r => r.buttonGapPx !== null).map(r => `${r.cell}: ${r.buttonGapPx}px`), contrastGroupsBelow: rows.filter(r => r.contrastBelow.length).map(r => `${r.cell}: ${r.contrastBelow.map(g => g.element + ' ' + g.ratio).join(', ')}`), themeClassDark: rows.filter(r => r.cell.includes('dark')).map(r => `${r.cell}: ${r.htmlClass || '(none)'} bg ${r.bodyBg}`) } });
}

await browser.close();
console.log('remeasure done ->', OUT);
