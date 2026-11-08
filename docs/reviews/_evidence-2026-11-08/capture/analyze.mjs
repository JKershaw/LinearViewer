/**
 * LIN-3101 beat-3 analysis: compiles re-measure evidence from the captured JSONs
 * and renders the two things the generic capture didn't record numerically —
 * (a) merge-confirm / openrouter-consent primary-vs-secondary button box sizes,
 * (b) the exact D5/§6 copy on the upstream-aware error branches.
 *
 * Docs-only research artifact. Run with the server up:
 *   PLAYWRIGHT_BROWSERS_PATH=... BASE_URL=http://localhost:3199 node .../analyze.mjs
 */

import { chromium } from 'playwright';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  renderMergeConfirmPage,
  renderOpenRouterConsentPage,
  renderUpstreamAwareErrorPage
} from '../../../../lib/render-pages.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '..');
const BASE = process.env.BASE_URL || 'http://localhost:3199';
const T = '2026-09-26T00:00:00.000Z';

// --- 1. Compile from captured JSONs -----------------------------------------
const files = (await readdir(OUT)).filter(f => f.endsWith('.json') && !f.includes('manifest'));
const rows = [];
for (const f of files) {
  const j = JSON.parse(await readFile(path.join(OUT, f), 'utf8'));
  rows.push(j);
}

function bySurface(key) { return rows.filter(r => r.surface === key); }

// D6 title census
const titleGroups = {};
for (const r of rows) {
  if (r.expectedTheme !== 'light') continue; // dedupe across themes
  if (r.viewport && r.viewport.width !== 1400) continue; // dedupe across viewports
  const t = r.title || '(empty)';
  titleGroups[t] = (titleGroups[t] || 0) + 1;
}
const titleCensus = Object.entries(titleGroups).map(([title, count]) => ({ title, count })).sort((a, b) => b.count - a.count);

// Classify each title into a convention bucket
function convention(title) {
  if (title.startsWith('Harbour —')) return 'landing (one-off)';
  if (title.endsWith('- Experimental')) return '- Experimental';
  if (title.endsWith('- Projects')) return '- Projects';
  if (title.endsWith('- Harbour')) return '- Harbour';
  if (/ - (Test Workspace|Local Workspace|GitHub Workspace|GitHub Projects Workspace|Jira Workspace|Operator Dashboard|Settings|Prompts|Dispatch|Proxy|Custom Prompts|Escalation KPIs|Effort Self-Assessment|Roadmap)/.test(title)) return '<Workspace> - <Page>';
  if (title === 'Ship' || title === 'Observation' || title === 'New task' || title === 'Choose a Jira site' || title === 'Connect Jira') return 'bare';
  if (/The Harbour Archive|Harbour Archive #|Project Brief/.test(title)) return 'archive (document titles)';
  if (title.startsWith('Swipe -') && !title.endsWith('- Projects')) return 'one-off (Swipe <issue>)';
  if (title === 'Swim - Lanes') return 'one-off (Swim - Lanes)';
  return 'other';
}
const conventionCounts = {};
for (const [title, count] of Object.entries(titleGroups)) { const c = convention(title); conventionCounts[c] = (conventionCounts[c] || 0) + count; }

// Archive tables: D7 (colophon), §3 (links), LIN-2402 (overflow @320)
const archiveTable = [];
for (let n = 1; n <= 7; n++) {
  const key = `archive-${n}`;
  const light320 = bySurface(key).find(r => r.expectedTheme === 'light' && r.viewport && r.viewport.width === 320);
  const light390 = bySurface(key).find(r => r.expectedTheme === 'light' && r.viewport && r.viewport.width === 390);
  const light1400 = bySurface(key).find(r => r.expectedTheme === 'light' && r.viewport && r.viewport.width === 1400);
  archiveTable.push({
    archive: n,
    title: light1400 ? light1400.title : '(none)',
    footerCount: light1400 ? light1400.footerCount : null,
    colophon: light1400 ? lights(light1400) : null,
    overflowsAt320: light320 ? light320.overflow.overflows : null,
    scrollW320: light320 ? light320.overflow.scrollWidth : null,
    clientW320: light320 ? 320 : null,
    offenders320: light320 ? light320.overflow.offenders.slice(0, 5) : [],
    overflowsAt390: light390 ? light390.overflow.overflows : null,
    linksTotal: light1400 ? light1400.linksIntoProduct.total : null,
    linksToRoot: light1400 ? light1400.linksIntoProduct.toRoot : null,
    linksToWorkspace: light1400 ? light1400.linksIntoProduct.toWorkspace : null,
    linksToAppNav: light1400 ? light1400.linksIntoProduct.toAppNav : null,
    linksSample: light1400 ? light1400.linksIntoProduct.sample : []
  });
}
function lights(r) { return r.navFoot ? r.navFoot.footerHasColophon : null; }

// LIN-2402 verdict: any archive overflow at any viewport?
const archiveOverflow = archiveTable.filter(a => a.overflowsAt320 || a.overflowsAt390);

// D8: ship heading counts
const shipPublic = bySurface('ship-public').filter(r => r.expectedTheme === 'light' && r.viewport && r.viewport.width === 1400)[0];
const shipAuth = bySurface('ship').filter(r => r.expectedTheme === 'light' && r.viewport && r.viewport.width === 1400)[0];

// LIN-2401: error pages a11y heading role count
const errFamilyKeys = ['err-merge-confirm','err-generic','err-upstream-auth','err-upstream-5xx','err-workspace-notfound','raw-jira-nows','raw-openrouter-cb-nocode','gh-repo-picker','jira-site-picker'];
const errHeadings = errFamilyKeys.map(k => {
  const r = bySurface(k).find(x => x.expectedTheme === 'light' && x.viewport && x.viewport.width === 1400);
  return { surface: k, title: r ? r.title : null, h1: r ? r.headings.h1 : null, h2: r ? r.headings.h2 : null, totalDom: r ? r.headings.totalDom : null, a11yRoleHeading: r ? r.headings.a11y.roleHeading : null };
});

// §6: provider tree titles (already in rows) — gather non-linear tree titles
const providerTrees = ['local-tree','github-tree','ghp-tree','jira-tree','tree','local-roadmap'].map(k => {
  const r = bySurface(k).find(x => x.expectedTheme === 'light' && x.viewport && x.viewport.width === 1400);
  return { surface: k, title: r ? r.title : null };
});

// Nav/footer census for auth pages
const navFoot = rows.filter(r => r.kind === 'auth' && r.expectedTheme === 'light' && r.viewport && r.viewport.width === 1400).map(r => ({
  surface: r.surface, hasThemeToggle: r.navFoot.hasThemeToggle, hasTeamSelector: r.navFoot.hasTeamSelector,
  hasAssigneeSelector: r.navFoot.hasAssigneeSelector, hasNavFeedback: r.navFoot.hasNavFeedback,
  navLinks: r.navFoot.navLinks, footerHasColophon: r.navFoot.footerHasColophon
}));

// --- 2. Render button box sizes + D5 copy ------------------------------------
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

async function inspectButtons(key, html, selectors) {
  const out = {};
  for (const vp of [{ width: 1400, height: 1000 }, { width: 390, height: 844 }]) {
    const ctx = await browser.newContext({ viewport: vp });
    const page = await ctx.newPage();
    await page.route('**/*', (route) => route.request().resourceType() === 'document'
      ? route.fulfill({ body: html, contentType: 'text/html' })
      : route.continue());
    await page.goto(`${BASE}/__inspect__`, { waitUntil: 'load' });
    await page.waitForTimeout(200);
    const m = await page.evaluate((sels) => {
      const res = {};
      for (const [nm, sel] of Object.entries(sels)) {
        const el = document.querySelector(sel);
        if (!el) { res[nm] = null; continue; }
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        res[nm] = {
          background: cs.backgroundColor, color: cs.color, border: cs.border, borderRadius: cs.borderRadius,
          padding: cs.padding, fontSize: cs.fontSize, fontWeight: cs.fontWeight, fontFamily: cs.fontFamily, cursor: cs.cursor,
          width: Math.round(r.width), height: Math.round(r.height)
        };
      }
      return res;
    }, selectors);
    out[vp.width] = m;
    await ctx.close();
  }
  return out;
}

const mergeButtons = await inspectButtons('merge', renderMergeConfirmPage({ identityLabel: 'Linear' }), {
  primary: '[data-testid="merge-confirm-submit"]', secondary: '[data-testid="merge-decline-submit"]'
});
const openrouterButtons = await inspectButtons('or', renderOpenRouterConsentPage({ urlKey: 'test-workspace' }), {
  primary: '[data-testid="openrouter-consent-grant-submit"]', secondary: '[data-testid="openrouter-consent-decline-submit"]'
});

async function inspectCopy(key, html) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await ctx.newPage();
  await page.route('**/*', (route) => route.request().resourceType() === 'document'
    ? route.fulfill({ body: html, contentType: 'text/html' })
    : route.continue());
  await page.goto(`${BASE}/__copy__`, { waitUntil: 'load' });
  await page.waitForTimeout(200);
  const m = await page.evaluate(() => ({
    title: document.title,
    errorMessage: (document.querySelector('.error-message') || {}).textContent || '',
    diagnostic: Array.from(document.querySelectorAll('.error-detail-row')).map(r => r.textContent.trim())
  }));
  await ctx.close();
  return m;
}

const upstreamCopy = {
  '5xx': await inspectCopy('5xx', renderUpstreamAwareErrorPage({ status: 503 }, { time: T })),
  '429': await inspectCopy('429', renderUpstreamAwareErrorPage({ status: 429 }, { time: T })),
  'net': await inspectCopy('net', renderUpstreamAwareErrorPage({ code: 'ECONNRESET' }, { time: T })),
  'auth': await inspectCopy('auth', renderUpstreamAwareErrorPage({ status: 401 }, { time: T }))
};

await browser.close();

const result = {
  titleCensus,
  conventionCounts,
  archiveTable,
  archiveOverflow,
  shipPublicHeadings: shipPublic ? shipPublic.headings : null,
  shipAuthHeadings: shipAuth ? shipAuth.headings : null,
  errHeadings,
  providerTrees,
  navFoot,
  mergeButtons,
  openrouterButtons,
  upstreamCopy
};
await writeFile(path.join(__dirname, 'analysis.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify({
  conventionCounts,
  archiveTable: archiveTable.map(a => ({ archive: a.archive, title: a.title, footerCount: a.footerCount, colophon: a.colophon, ovf320: a.overflowsAt320, scroll320: a.scrollW320, links: `r${a.linksToRoot}/w${a.linksToWorkspace}/nav${a.linksToAppNav}/t${a.linksTotal}` })),
  shipPublicHeadings: result.shipPublicHeadings, shipAuthHeadings: result.shipAuthHeadings,
  errHeadings, providerTrees,
  mergeButtons, openrouterButtons, upstreamCopy
}, null, 2));
console.error('wrote analysis.json');