/**
 * LIN-3101 (eighth design/interface review) — full-scope evidence capture.
 *
 * Research tool, docs-only: lives under docs/reviews/_evidence-2026-09-26/capture/,
 * writes PNG + measurement JSON into the evidence dir, and mirrors the run in
 * capture/manifest.json. Not wired into `npm test`/CI; never touches product code.
 *
 * Invocation (server must be up; see playwright.visual.config.js webServer.command):
 *   PLAYWRIGHT_BROWSERS_PATH=/Users/work/Library/Caches/ms-playwright \
 *   BASE_URL=http://localhost:3199 \
 *   node docs/reviews/_evidence-2026-09-26/capture/capture.mjs [key ...]
 *
 * No args → the whole registry. Keys are grouped so a partial re-run is cheap:
 *   cold · archive · auth · providers · errors · rawfail
 *
 * Theme contract:
 *   - cookie dark: set the real `theme` cookie, assert documentElement.className
 *     === 'theme-dark' BEFORE shooting (landing/swipe/swim/ship/archive are the
 *     exceptions — they are standalone/landing documents whose dark is driven by
 *     prefers-color-scheme, recorded as `darkMode:'media'`).
 */

import { chromium } from 'playwright';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  renderMergeConfirmPage,
  renderMergeReauthRequiredPage,
  renderErrorPage,
  renderWorkspaceNotFoundPage,
  renderUpstreamAwareErrorPage,
  renderGitHubRepoSelectPage,
  renderGitHubProjectSelectPage,
  renderJiraSiteSelectPage,
  renderJiraLinkForm,
  renderOpenRouterConsentPage
} from '../../../../lib/render-pages.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE_URL = process.env.BASE_URL || 'http://localhost:3199';
const OUT_DIR = process.env.OUT_DIR || path.resolve(__dirname, '..');
const MANIFEST_PATH = path.join(__dirname, 'manifest.json');
const FULLPAGE = process.argv.includes('--fullpage');

const D1400 = { width: 1400, height: 1000 };
const D390 = { width: 390, height: 844 };
const D360 = { width: 360, height: 800 };
const D320 = { width: 320, height: 720 };

const T = '2026-09-26T00:00:00.000Z';

const ALL_FEATURES = encodeURIComponent(JSON.stringify({
  dispatch: true, proxy: true, roadmap: true,
  collective: true, taskChat: true, ship: true, nextRun: true,
  flightCompanion: true, passagePlanner: true, shipBiscuit: true,
  liveConsole: true, shipJourney: true, feedbackWidget: true
}));

// ---------------------------------------------------------------------------
// Surface registry
// ---------------------------------------------------------------------------

const cold = [
  { key: 'landing', path: '/', label: 'Landing (cold)', darkMode: 'media', uncertain: true },
  { key: 'swipe-public', path: '/swipe', label: 'Public Swipe preview', darkMode: 'media', uncertain: true },
  { key: 'swim-public', path: '/swim', label: 'Public Swim preview', darkMode: 'media', uncertain: true },
  { key: 'ship-public', path: '/ship', label: 'Public Ship preview (cold, D8 #1)', darkMode: 'media', uncertain: true },
  { key: 'privacy', path: '/privacy', label: 'Privacy' },
  { key: 'terms', path: '/terms', label: 'Terms' },
  { key: 'styleguide', path: '/styleguide', label: 'Styleguide (baseline)' },
  { key: 'templates', path: '/templates', label: 'Templates' },
  { key: 'kpis', path: '/kpis', label: 'Public KPIs', settleMs: 800 }
].map(s => ({ kind: 'cold', ...s }));

const archive = [1, 2, 3, 4, 5, 6, 7].map(n => ({
  key: `archive-${n}`, kind: 'cold', path: `/archive/${n}`,
  label: `Archive #${n}`, darkMode: 'media', uncertain: true
}));

// The archive route's own 404 (server.js:1873) — a renderErrorPage "Not Found"
// surface the beat-1 inventory did not name (it is not a distinct route, but a
// distinct rendered state of the /archive/:n handler).
const archive404 = {
  key: 'archive-404', kind: 'cold', path: '/archive/999',
  label: 'Archive #999 (route 404 "Not Found")', uncertain: true
};

const ws = 'test-workspace';
const wsPath = (p) => `/workspace/${ws}${p}`;
const auth = [
  { key: 'tree', path: wsPath('/'), label: 'Tree / dashboard' },
  { key: 'swipe', path: wsPath('/swipe'), label: 'Swipe' },
  { key: 'swim', path: wsPath('/swim'), label: 'Swim' },
  { key: 'ship', path: wsPath('/ship'), label: 'Ship (D8 #2)', uncertain: true },
  { key: 'roadmap', path: wsPath('/roadmap'), label: 'Roadmap' },
  { key: 'audit', path: wsPath('/audit'), label: 'Operator dashboard' },
  { key: 'settings', path: wsPath('/settings'), label: 'Settings (Scan-due tab)', settleMs: 400 },
  { key: 'prompts', path: wsPath('/prompts'), label: 'Prompts' },
  { key: 'custom-prompts', path: wsPath('/prompts/custom'), label: 'Custom prompts' },
  { key: 'dispatch', path: wsPath('/dispatch'), label: 'Dispatch (halt section)' },
  { key: 'proxy', path: wsPath('/proxy'), label: 'Proxy' },
  { key: 'observation', path: wsPath('/observation'), label: 'Observation' },
  { key: 'observation-session', path: wsPath('/observation/session/none'), label: 'Observation session detail' },
  { key: 'dashboard', path: wsPath('/dashboard'), label: 'Dashboard (assignee selector)' },
  { key: 'escalation-kpis', path: wsPath('/escalation-kpis'), label: 'Escalation KPIs' },
  { key: 'effort-readout', path: wsPath('/effort-readout'), label: 'Effort read-out' },
  { key: 'flight-companion', path: wsPath('/flight-companion'), label: 'Flight Companion (experimental)' },
  { key: 'live-console', path: wsPath('/live-console'), label: 'Live Console (experimental)' },
  { key: 'next-run', path: wsPath('/next-run'), label: 'Suggested Next Run (experimental)' },
  { key: 'passage-planner', path: wsPath('/passage-planner'), label: 'Passage Planner (experimental)' },
  { key: 'ship-biscuit', path: wsPath('/ship-biscuit'), label: "Ship's Biscuit (experimental)" },
  { key: 'ship-journey', path: wsPath('/ship-journey'), label: 'Ship Journey (experimental)' },
  { key: 'task-chat', path: wsPath('/task-chat'), label: 'Task Chat (experimental)' },
  { key: 'task-new', path: wsPath('/task/new'), label: 'Task create' },
  { key: 'task-edit', path: wsPath('/task/123/edit'), label: 'Task edit' },
  { key: 'collective', path: wsPath('/collective'), label: 'Collective (experimental, mock Yap)', settleMs: 800 }
].map(s => ({ kind: 'auth', seed: `/test/set-session?features=${ALL_FEATURES}`, ...s }));

const providers = [
  { key: 'local-tree', seed: '/test/set-local-session', path: '/workspace/local-workspace/', label: 'Tree under Local provider' },
  { key: 'local-roadmap', seed: '/test/set-local-session', path: '/workspace/local-workspace/roadmap', label: 'Roadmap under Local' },
  { key: 'github-tree', seed: '/test/set-github-session', path: '/workspace/github-workspace/', label: 'Tree under GitHub' },
  { key: 'ghp-tree', seed: '/test/set-github-projects-session', path: '/workspace/github-projects-workspace/', label: 'Tree under GitHub Projects' },
  { key: 'jira-tree', seed: '/test/set-jira-session', path: '/workspace/jira-workspace/', label: 'Tree under Jira' },
  { key: 'jira-settings', seed: '/test/set-jira-session', path: '/workspace/jira-workspace/settings', label: 'Settings under Jira' }
].map(s => ({ kind: 'auth', ...s }));

// Error/consent family, rendered from pure renderers via request interception.
const errors = [
  { key: 'err-merge-confirm', label: 'Account-merge confirm (LIN-2400)', uncertain: true,
    html: () => renderMergeConfirmPage({ identityLabel: 'Linear' }) },
  { key: 'err-merge-reauth', label: 'Account-merge reauth', uncertain: true,
    html: () => renderMergeReauthRequiredPage({ identityLabel: 'Linear', reauthUrl: '/auth/linear' }) },
  { key: 'err-generic', label: 'Generic renderErrorPage', uncertain: true,
    html: () => renderErrorPage('Something Went Wrong', 'An unexpected error occurred. Please try again.', { action: 'Try again', actionUrl: '/' }) },
  { key: 'err-workspace-notfound', label: 'Workspace not found', uncertain: true,
    html: () => renderWorkspaceNotFoundPage('nope', [{ name: 'Demo Workspace', urlKey: 'demo' }]) },
  { key: 'err-upstream-auth', label: 'Upstream-aware error — auth (401)', uncertain: true,
    html: () => renderUpstreamAwareErrorPage({ status: 401 }, { time: T }) },
  { key: 'err-upstream-5xx', label: 'Upstream-aware error — 503 (D5)', uncertain: true,
    html: () => renderUpstreamAwareErrorPage({ status: 503 }, { time: T }) },
  { key: 'err-upstream-429', label: 'Upstream-aware error — 429 (D5)', uncertain: true,
    html: () => renderUpstreamAwareErrorPage({ status: 429 }, { time: T }) },
  { key: 'err-upstream-net', label: 'Upstream-aware error — ECONNRESET (D5)', uncertain: true,
    html: () => renderUpstreamAwareErrorPage({ code: 'ECONNRESET' }, { time: T }) },
  { key: 'err-upstream-internal', label: 'Upstream-aware error — internal (D5)', uncertain: true,
    html: () => renderUpstreamAwareErrorPage(new Error('boom'), { time: T }) },
  { key: 'gh-repo-picker', label: 'GitHub repo picker (LIN-2820)', uncertain: true,
    html: () => renderGitHubRepoSelectPage(REPOS, { login: 'octocat', installationId: 'inst-1' }) },
  { key: 'gh-projects-picker', label: 'GitHub Projects board picker', uncertain: true,
    html: () => renderGitHubProjectSelectPage(BOARDS, { login: 'octocat' }) },
  { key: 'jira-site-picker', label: 'Jira site picker', uncertain: true,
    html: () => renderJiraSiteSelectPage(SITES) },
  { key: 'jira-link-form', label: 'Jira API-token link form (LIN-2302)', uncertain: true,
    html: () => renderJiraLinkForm({ workspaceUrlKey: 'test-workspace' }) },
  { key: 'openrouter-consent', label: 'OpenRouter consent interstitial (LIN-2412/2497)', uncertain: true,
    html: () => renderOpenRouterConsentPage({ urlKey: 'test-workspace' }) }
].map(s => ({ kind: 'intercept', ...s }));

// Real-route failure renders (exercise the production handler, not the renderer).
const rawfail = [
  { key: 'raw-openrouter-cb-nocode', seed: '/test/set-session', path: '/auth/openrouter/callback',
    label: 'OpenRouter callback — no code (400 Authorization Failed)', uncertain: true },
  { key: 'raw-jira-nows', path: '/auth/jira', label: 'Jira — no workspace (400)', uncertain: true },
  { key: 'raw-auth-callback', path: '/auth/callback', label: 'Linear callback — no code', uncertain: true }
].map(s => ({ kind: 'auth', seed: s.seed || undefined, ...s }));

const ends = ['cold', 'auth', 'archive', 'providers', 'errors', 'rawfail'];
const ALL = [...cold, ...auth, ...archive, archive404, ...providers, ...errors, ...rawfail];

// ---------------------------------------------------------------------------
// Sample data for picker renderers
// ---------------------------------------------------------------------------
const REPOS = Array.from({ length: 12 }, (_, i) => ({
  slug: `acme/repo-${i + 1}`, name: `acme/repo-${i + 1}`,
  installationId: i < 6 ? 'inst-1' : 'inst-2', private: i % 3 === 0
}));
const BOARDS = [
  { login: 'acme', number: 4, title: 'Roadmap board' },
  { login: 'acme', number: 7, title: 'Sprint board' },
  { login: 'widgets', number: 2, title: 'Backlog' }
];
const SITES = [
  { name: 'acme.atlassian.net', url: 'https://acme.atlassian.net' },
  { name: 'widgets.atlassian.net', url: 'https://widgets.atlassian.net' }
];

// ---------------------------------------------------------------------------
// Measurement primitives (run in the page)
// ---------------------------------------------------------------------------

function lum(v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
const CONTRAST_JS = `
  (() => {
    function lum(v){ v/=255; return v<=0.03928? v/12.92 : Math.pow((v+0.055)/1.055,2.4); }
    function rgb(s){
      const m = (s||'').match(/rgba?\\(([\\d.]+),\\s*([\\d.]+),\\s*([\\d.]+)(?:,\\s*([\\d.]+))?\\)/);
      if(!m) return null;
      return [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]), m[4]===undefined?1:parseFloat(m[4])];
    }
    function effBg(el){
      let a = el;
      while(a){
        const c = rgb(getComputedStyle(a).backgroundColor);
        if(c && c[3] > 0) return c.slice(0,3);
        a = a.parentElement;
      }
      return [255,255,255];
    }
    function contrast(a,b){ const l1=lum(a[0])*0.2126+lum(a[1])*0.7152+lum(a[2])*0.0722; const l2=lum(b[0])*0.2126+lum(b[1])*0.7152+lum(b[2])*0.0722; const [hi,lo]=[l1,l2].sort((x,y)=>y-x); return (hi+0.05)/(lo+0.05); }
    const sels = ['body','p','a','button','.error-title','.error-message','.section-description','.settings-subtitle','.field-muted','.proxy-hint','.repo-picker-slug','.kpi-tree-glyph','.chip','.footer','.nav-action'];
    const out = [];
    for(const sel of sels){
      const el = document.querySelector(sel);
      if(!el) continue;
      const cs = getComputedStyle(el);
      const fg = rgb(cs.color);
      if(!fg) continue;
      const bg = effBg(el);
      out.push({ selector: sel, color: cs.color, bg: 'rgb('+bg.join(',')+')', ratio: +contrast(fg,bg).toFixed(2), text: (el.textContent||'').trim().slice(0,40) });
    }
    return out;
  })()
`;

const CLIP_JS = `
  (() => {
    const innerWidth = window.innerWidth;
    const out = [];
    // text truncation: element scrollWidth > clientWidth with no scroll container, or ellipsis
    for(const el of document.querySelectorAll('p,span,a,button,td,th,li,h1,h2,h3,h4,h5,h6,label,strong')){
      const cs = getComputedStyle(el);
      const clippedByParent = (() => { let a=el.parentElement; while(a){ const o=getComputedStyle(a).overflowX; if(/(auto|scroll|hidden|clip)/.test(o)) return true; a=a.parentElement; } return false; })();
      if((el.scrollWidth > el.clientWidth + 1 && !clippedByParent) || cs.textOverflow === 'ellipsis'){
        const r = el.getBoundingClientRect();
        if(r.right < innerWidth + 1) continue; // not a viewport exceedance — skip pure box truncation noise
        out.push({ tag: el.tagName.toLowerCase(), cls: (el.className&&typeof el.className==='string')?el.className.slice(0,40):'', text:(el.textContent||'').trim().slice(0,50), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, right: Math.round(r.right) });
      }
    }
    return out.slice(0, 20);
  })()
`;

const NAVFOOT_JS = `
  (() => {
    const pick = (sel) => Array.from(document.querySelectorAll(sel)).map(e => (e.textContent||'').trim()).filter(Boolean);
    const navLinks = pick('nav a').slice(0, 40);
    const footerLinks = pick('footer a, footer button').slice(0, 40);
    const footerText = Array.from(document.querySelectorAll('footer')).map(f=>f.textContent.trim()).join(' ');
    return {
      navLinks: [...new Set(navLinks)],
      footerLinks: [...new Set(footerLinks)],
      hasThemeToggle: !!document.querySelector('[data-testid="footer-theme-toggle"]'),
      hasTeamSelector: !!document.querySelector('[data-selector="team"]'),
      hasAssigneeSelector: !!document.querySelector('[data-selector="assignee"]'),
      hasNavFeedback: !!document.querySelector('[data-testid="nav-feedback-trigger"]'),
      footerHasColophon: /colophon|provenance/i.test(footerText)
    };
  })()
`;

const DOM_JS = `
  (() => {
    const de = document.documentElement;
    const counts = { h1:0,h2:0,h3:0,h4:0,h5:0,h6:0 };
    document.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach(h=>{ counts[h.tagName.toLowerCase()] += 1; });
    const offenders = [];
    const innerWidth = window.innerWidth;
    for(const el of document.querySelectorAll('*')){
      const r = el.getBoundingClientRect();
      if(r.right <= innerWidth + 1) continue;
      let clipped=false, a=el.parentElement;
      while(a){ const cs=getComputedStyle(a); if(/(auto|scroll|hidden|clip)/.test(cs.overflowX)){clipped=true;break;} a=a.parentElement; }
      if(!clipped) offenders.push({ sel:(el.id?('#'+el.id):(el.className&&typeof el.className==='string'?el.tagName.toLowerCase()+'.'+el.className.trim().split(/\\s+/).join('.'):el.tagName.toLowerCase())), tag:el.tagName.toLowerCase(), right:Math.round(r.right), width:Math.round(r.width) });
    }
    const links=[];
    document.querySelectorAll('a[href]').forEach(a=>{ const h=a.getAttribute('href')||''; if(!h.startsWith('/'))return; if(/\\.(css|js|png|svg|jpg|jpeg|gif|webp|woff2?|ico|map)(\\?|$)/.test(h))return; links.push(h); });
    return {
      title: document.title,
      headings: { ...counts, totalDom: counts.h1+counts.h2+counts.h3+counts.h4+counts.h5+counts.h6 },
      htmlClass: de.className,
      overflow: { scrollWidth: de.scrollWidth, clientWidth: de.clientWidth, innerWidth, overflows: de.scrollWidth > de.clientWidth, offenders: offenders.slice(0,25) },
      footerCount: document.querySelectorAll('footer').length,
      mainCount: document.querySelectorAll('main, [role="main"]').length,
      linksIntoProduct: {
        total: links.length,
        toRoot: links.filter(h=>h==='/').length,
        toWorkspace: links.filter(h=>h.startsWith('/workspace/')).length,
        toAppNav: links.filter(h=>/^\\/(swipe|swim|ship|templates|kpis|styleguide|privacy|terms|auth|observation|settings|prompts|dispatch|proxy)/.test(h)).length,
        sample: links.slice(0,12)
      }
    };
  })()
`;

// ---------------------------------------------------------------------------
// capture helpers
// ---------------------------------------------------------------------------

async function measure(page, { expectedTheme, viewport, darkMode }) {
  const dom = await page.evaluate(DOM_JS);
  const contrast = await page.evaluate(CONTRAST_JS);
  const clip = await page.evaluate(CLIP_JS);
  const navFoot = await page.evaluate(NAVFOOT_JS);
  const fonts = await page.evaluate(() => {
    const set = new Set();
    try { for (const f of document.fonts) set.add(`${f.family} ${f.weight}`); } catch (e) {}
    return [...set];
  });

  const a11yHeadings = { roleHeading: 0, levels: {} };
  for (let lvl = 1; lvl <= 6; lvl += 1) {
    const n = await page.getByRole('heading', { level: lvl }).count();
    a11yHeadings.levels['h' + lvl] = n;
    a11yHeadings.roleHeading += n;
  }

  let themeAssertion;
  if (darkMode === 'media') {
    themeAssertion = { expected: 'media-emulated (prefers-color-scheme: dark)', actual: dom.htmlClass, passed: true, note: 'media dark, not cookie' };
  } else if (expectedTheme === 'dark') {
    const passed = dom.htmlClass === 'theme-dark';
    themeAssertion = { expected: 'theme-dark', actual: dom.htmlClass, passed };
  } else {
    const passed = !dom.htmlClass.includes('theme-dark');
    themeAssertion = { expected: '(no theme-dark)', actual: dom.htmlClass, passed };
  }

  return {
    url: page.url(), viewport, expectedTheme, darkMode: darkMode || 'cookie',
    themeAssertion,
    ...dom,
    headings: { ...dom.headings, a11y: a11yHeadings },
    contrast,
    clip,
    navFoot,
    fonts
  };
}

async function captureOne(browser, surface, theme, viewport) {
  const opts = { viewport };
  const darkMode = surface.darkMode || 'cookie';
  if (darkMode === 'media') opts.colorScheme = theme;

  const ctx = await browser.newContext(opts);
  if (darkMode !== 'media') {
    await ctx.addCookies([{ name: 'theme', value: theme, url: BASE_URL }]);
  }

  const page = await ctx.newPage();

  let status = null;
  if (surface.seed) {
    await page.goto(`${BASE_URL}${surface.seed}`, { waitUntil: 'load' }).catch(() => null);
  }

  if (surface.kind === 'intercept') {
    const html = surface.html();
    await page.route('**/*', (route) => {
      if (route.request().resourceType() === 'document') {
        return route.fulfill({ body: html, contentType: 'text/html' });
      }
      return route.continue();
    });
  }

  const r = await page.goto(`${BASE_URL}${surface.path || '/__intercept__'}`, { waitUntil: 'load' }).catch(() => null);
  status = r ? r.status() : (surface.kind === 'intercept' ? 200 : null);

  await page.waitForTimeout(surface.settleMs || 300);

  const m = await measure(page, { expectedTheme: theme, viewport, darkMode });

  if (!m.themeAssertion.passed) {
    await ctx.close();
    return { ok: false, reason: 'theme-assertion', surface, theme, viewport, record: m };
  }

  const name = `${surface.key}-${theme}-${viewport.width}px`;
  const pngPath = path.join(OUT_DIR, `${name}.png`);
  const jsonPath = path.join(OUT_DIR, `${name}.json`);
  // Viewport-height captures only: full-page geometry (overflow, footer/colophon,
  // product links) is already recorded numerically in the JSON, so a tall fullPage
  // PNG buys nothing the measurements don't. Keeps the evidence set repo-sane.
  // Pass --fullpage to opt back into full-page PNGs for the beat-4 re-capture pass.
  await page.screenshot({ path: pngPath, fullPage: FULLPAGE });
  await writeFile(jsonPath, JSON.stringify({ surface: surface.key, label: surface.label, kind: surface.kind, theme, persisted: false, status, ...m }, null, 2));
  await ctx.close();
  return { ok: true, surface, theme, viewport, name, record: { surface: surface.key, status, title: m.title, overflow: m.overflow, headings: m.headings } };
}

async function upsertManifest(entries) {
  let existing = {};
  try { existing = JSON.parse(await readFile(MANIFEST_PATH, 'utf8')); } catch (e) { existing = {}; }
  for (const e of entries) {
    const k = `${e.surface}--${e.theme}--${e.viewport}px`;
    existing[k] = { surface: e.surface, theme: e.theme, viewport: e.viewport, ok: e.ok, ...(e.reason ? { reason: e.reason } : {}) };
  }
  await writeFile(MANIFEST_PATH, JSON.stringify(existing, null, 2));
}

// ---------------------------------------------------------------------------

function resolveSurfaces(names) {
  if (!names || !names.length) return ALL;
  const map = Object.fromEntries(ALL.map(s => [s.key, s]));
  return names.map(n => map[n]).filter(Boolean);
}

async function main() {
  const argv = process.argv.slice(2).filter(a => a !== '--fullpage');
  const keys = argv;
  const surfaces = resolveSurfaces(keys);
  if (keys.length && surfaces.length !== keys.length) {
    const known = ALL.map(s => s.key);
    console.error('Unknown key. Known group keys and surface keys include:', known.join(', '));
    process.exit(2);
  }

  await mkdir(OUT_DIR, { recursive: true });
  await mkdir(path.dirname(MANIFEST_PATH), { recursive: true });

  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

  const manifestRows = [];
  const failed = [];
  let ok = 0;

  for (const surface of surfaces) {
    const themes = ['light', 'dark'];
    for (const theme of themes) {
      const viewports = surface.uncertain ? [D1400, D390, D360, D320] : [D1400, D390];
      for (const viewport of viewports) {
        let r;
        try {
          r = await captureOne(browser, surface, theme, viewport);
        } catch (e) {
          r = { ok: false, reason: `exception: ${String(e.message || e).split('\n')[0]}`, surface: surface.key, theme, viewport };
        }
        manifestRows.push({ surface: surface.key, theme, viewport: viewport.width, ok: r.ok, reason: r.reason });
        if (r.ok) {
          ok += 1;
          const rec = r.record;
          console.log(`OK   ${surface.key} ${theme} ${viewport.width}px — ${rec.status ?? '-'} · "${rec.title}" · h="${rec.headings.totalDom}" · ovf=${rec.overflow.overflows} (${rec.overflow.scrollWidth}/${rec.overflow.clientWidth})`);
        } else {
          failed.push(r);
          console.log(`FAIL ${surface.key} ${theme} ${viewport.width}px — ${r.reason}`);
        }
      }
    }
  }

  await browser.close();
  await upsertManifest(manifestRows);

  console.log(`\n== summary == attempted=${manifestRows.length} ok=${ok} failed=${failed.length}`);
  const byReason = {};
  for (const f of failed) { const k = f.reason || 'unknown'; byReason[k] = (byReason[k] || 0) + 1; }
  console.log('failure reasons:', JSON.stringify(byReason));
  process.exit(failed.length ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });