/**
 * LIN-3101 beat-4 corrective: fullPage + pageEnd capture pass.
 *
 * Beat 3 sampled everything at viewport height; the report stage needs the
 * BELOW-THE-FOLD evidence the measurements describe (archive footers/colophon D7,
 * §3 product links at the page end, error-page full text). This script adds:
 *   - `fullPage` PNGs for the ship/error/operator-readout surfaces (short pages
 *     where full-page is cheap), and
 *   - `pageEnd` PNGs for archives 1-7 + archive-404 (a clip of the final section
 *     — from the last heading, or the bottom ~2200px whichever is shorter — so a
 *     ~26k-px archive essay doesn't become a 5 MB PNG).
 *
 * Each output is suffixed `.fp.png` / `.pe.png` with a matching `.json`, and every
 * row carries `captureMode`. Docs-only; run with the server up.
 */

import { chromium } from 'playwright';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  renderMergeConfirmPage, renderMergeReauthRequiredPage, renderErrorPage,
  renderWorkspaceNotFoundPage, renderUpstreamAwareErrorPage,
  renderGitHubRepoSelectPage, renderGitHubProjectSelectPage,
  renderJiraSiteSelectPage, renderJiraLinkForm, renderOpenRouterConsentPage
} from '../../../../lib/render-pages.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '..');
const BASE = process.env.BASE_URL || 'http://localhost:3199';
const D1400 = { width: 1400, height: 1000 };
const D390 = { width: 390, height: 844 };
const T = '2026-09-26T00:00:00.000Z';

const REPOS = Array.from({ length: 12 }, (_, i) => ({
  slug: `acme/repo-${i + 1}`, name: `acme/repo-${i + 1}`, installationId: i < 6 ? 'inst-1' : 'inst-2', private: i % 3 === 0
}));
const BOARDS = [{ login: 'acme', number: 4, title: 'Roadmap board' }, { login: 'acme', number: 7, title: 'Sprint board' }, { login: 'widgets', number: 2, title: 'Backlog' }];
const SITES = [{ name: 'acme.atlassian.net', url: 'https://acme.atlassian.net' }, { name: 'widgets.atlassian.net', url: 'https://widgets.atlassian.net' }];

// --- fullPage jobs (cookie dark for app surfaces) ----------------------------
const ALL_FEATURES = encodeURIComponent(JSON.stringify({
  dispatch: true, proxy: true, roadmap: true, collective: true, taskChat: true, ship: true,
  nextRun: true, flightCompanion: true, passagePlanner: true, shipBiscuit: true,
  liveConsole: true, shipJourney: true, feedbackWidget: true
}));

const FP = [
  { key: 'styleguide', kind: 'cold', path: '/styleguide', themes: ['light'] },
  { key: 'ship-public', kind: 'cold', path: '/ship', darkMode: 'media', themes: ['light', 'dark'] },
  { key: 'ship', kind: 'auth', seed: `/test/set-session?features=${ALL_FEATURES}`, path: '/workspace/test-workspace/ship', themes: ['light', 'dark'] },
  { key: 'effort-readout', kind: 'auth', seed: `/test/set-session?features=${ALL_FEATURES}`, path: '/workspace/test-workspace/effort-readout', themes: ['light', 'dark'] },
  { key: 'escalation-kpis', kind: 'auth', seed: `/test/set-session?features=${ALL_FEATURES}`, path: '/workspace/test-workspace/escalation-kpis', themes: ['light', 'dark'] },
  { key: 'err-merge-confirm', kind: 'intercept', html: () => renderMergeConfirmPage({ identityLabel: 'Linear' }), themes: ['light', 'dark'] },
  { key: 'err-merge-reauth', kind: 'intercept', html: () => renderMergeReauthRequiredPage({ identityLabel: 'Linear', reauthUrl: '/auth/linear' }), themes: ['light', 'dark'] },
  { key: 'err-generic', kind: 'intercept', html: () => renderErrorPage('Something Went Wrong', 'An unexpected error occurred. Please try again.', { action: 'Try again', actionUrl: '/' }), themes: ['light', 'dark'] },
  { key: 'err-workspace-notfound', kind: 'intercept', html: () => renderWorkspaceNotFoundPage('nope', [{ name: 'Demo Workspace', urlKey: 'demo' }]), themes: ['light', 'dark'] },
  { key: 'err-upstream-auth', kind: 'intercept', html: () => renderUpstreamAwareErrorPage({ status: 401 }, { time: T }), themes: ['light', 'dark'] },
  { key: 'err-upstream-5xx', kind: 'intercept', html: () => renderUpstreamAwareErrorPage({ status: 503 }, { time: T }), themes: ['light', 'dark'] },
  { key: 'err-upstream-429', kind: 'intercept', html: () => renderUpstreamAwareErrorPage({ status: 429 }, { time: T }), themes: ['light', 'dark'] },
  { key: 'err-upstream-net', kind: 'intercept', html: () => renderUpstreamAwareErrorPage({ code: 'ECONNRESET' }, { time: T }), themes: ['light', 'dark'] },
  { key: 'err-upstream-internal', kind: 'intercept', html: () => renderUpstreamAwareErrorPage(new Error('boom'), { time: T }), themes: ['light', 'dark'] },
  { key: 'gh-repo-picker', kind: 'intercept', html: () => renderGitHubRepoSelectPage(REPOS, { login: 'octocat', installationId: 'inst-1' }), themes: ['light', 'dark'] },
  { key: 'gh-projects-picker', kind: 'intercept', html: () => renderGitHubProjectSelectPage(BOARDS, { login: 'octocat' }), themes: ['light', 'dark'] },
  { key: 'jira-site-picker', kind: 'intercept', html: () => renderJiraSiteSelectPage(SITES), themes: ['light', 'dark'] },
  { key: 'jira-link-form', kind: 'intercept', html: () => renderJiraLinkForm({ workspaceUrlKey: 'test-workspace' }), themes: ['light', 'dark'] },
  { key: 'openrouter-consent', kind: 'intercept', html: () => renderOpenRouterConsentPage({ urlKey: 'test-workspace' }), themes: ['light', 'dark'] },
  { key: 'raw-openrouter-cb-nocode', kind: 'auth', seed: '/test/set-session', path: '/auth/openrouter/callback', themes: ['light', 'dark'] },
  { key: 'raw-jira-nows', kind: 'cold', path: '/auth/jira', themes: ['light', 'dark'] },
  { key: 'raw-auth-callback', kind: 'cold', path: '/auth/callback', themes: ['light', 'dark'] }
];

// --- pageEnd jobs (archives + archive-404; media dark) ------------------------
const PE = [
  { key: 'archive-1', path: '/archive/1' },
  { key: 'archive-2', path: '/archive/2' },
  { key: 'archive-3', path: '/archive/3' },
  { key: 'archive-4', path: '/archive/4' },
  { key: 'archive-5', path: '/archive/5' },
  { key: 'archive-6', path: '/archive/6' },
  { key: 'archive-7', path: '/archive/7' },
  { key: 'archive-404', path: '/archive/999' }
].map(s => ({ ...s, kind: 'cold' }));

const MEASURE = `
  (() => {
    const de = document.documentElement;
    const c = { h1:0,h2:0,h3:0,h4:0,h5:0,h6:0 };
    document.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach(h => c[h.tagName.toLowerCase()]++);
    const hs = document.querySelectorAll('h1,h2,h3,h4,h5,h6');
    let lastY = 0;
    hs.forEach(h => { const y = h.getBoundingClientRect().top + window.scrollY; if (y > lastY) lastY = y; });
    return {
      title: document.title,
      headings: { ...c, totalDom: c.h1+c.h2+c.h3+c.h4+c.h5+c.h6 },
      scrollHeight: de.scrollHeight,
      clientWidth: de.clientWidth,
      innerWidth: window.innerWidth,
      lastHeadingY: Math.round(lastY),
      footerCount: document.querySelectorAll('footer').length
    };
  })()`;

async function measure(page) {
  const dom = await page.evaluate(MEASURE);
  let roleHeading = 0;
  for (let lvl = 1; lvl <= 6; lvl++) roleHeading += await page.getByRole('heading', { level: lvl }).count();
  return { ...dom, headings: { ...dom.headings, a11yRoleHeading: roleHeading } };
}

async function capture(browser, job, mode, theme, viewport) {
  const darkMode = job.darkMode || 'cookie';
  const ctx = await browser.newContext({ viewport, colorScheme: darkMode === 'media' ? theme : undefined });
  if (darkMode === 'cookie') await ctx.addCookies([{ name: 'theme', value: theme, url: BASE }]);
  const page = await ctx.newPage();

  if (job.seed) await page.goto(`${BASE}${job.seed}`, { waitUntil: 'load' }).catch(() => {});
  if (job.kind === 'intercept') {
    const html = job.html();
    await page.route('**/*', (route) => route.request().resourceType() === 'document'
      ? route.fulfill({ body: html, contentType: 'text/html' })
      : route.continue());
  }
  await page.goto(`${BASE}${job.path || '/__full__'}`, { waitUntil: 'load' }).catch(() => {});
  await page.waitForTimeout(300);

  const m = await measure(page);

  const suffix = mode === 'fullPage' ? 'fp' : 'pe';
  const name = `${job.key}-${theme}-${viewport.width}px.${suffix}`;
  const pngPath = path.join(OUT, `${name}.png`);
  const jsonPath = path.join(OUT, `${name}.json`);

  let capturedHeight;
  let clip = null;
  if (mode === 'fullPage') {
    await page.screenshot({ path: pngPath, fullPage: true });
    capturedHeight = m.scrollHeight;
  } else {
    // pageEnd: capture the FINAL viewport of the document (scroll to the bottom,
    // then shoot the viewport) — the page end including any footer/colophon (D7)
    // and the trailing links (§3). Disable scroll-behavior:smooth first (archive 7
    // sets it on <html>, which would otherwise animate the jump and leave the
    // viewport mid-scroll); a direct scrollTop write is instant.
    await page.evaluate(() => {
      document.documentElement.style.scrollBehavior = 'auto';
      document.documentElement.scrollTop = document.documentElement.scrollHeight;
    });
    await page.waitForTimeout(200);
    await page.screenshot({ path: pngPath, fullPage: false });
    const scrollY = await page.evaluate(() => Math.round(window.scrollY));
    capturedHeight = viewport.height;
    clip = { y: scrollY, height: viewport.height };
  }

  const record = {
    surface: job.key, theme, viewport: viewport.width, captureMode: mode, darkMode,
    title: m.title, headings: m.headings, scrollHeight: m.scrollHeight,
    capturedPixelHeight: capturedHeight, clip,
    footerCount: m.footerCount
  };
  await writeFile(jsonPath, JSON.stringify(record, null, 2));
  await ctx.close();
  return record;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

  const manifestPath = path.join(__dirname, 'manifest.json');
  let manifest = {};
  try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')); } catch (e) { manifest = {}; }

  const counts = { fullPage: 0, pageEnd: 0 };
  for (const job of FP) {
    for (const theme of job.themes) {
      for (const viewport of [D1400, D390]) {
        const r = await capture(browser, job, 'fullPage', theme, viewport);
        const k = `${job.key}--${theme}--${viewport.width}px--fp`;
        manifest[k] = { surface: job.key, theme, viewport: viewport.width, captureMode: 'fullPage', status: 'kept', pixelHeight: r.capturedPixelHeight };
        counts.fullPage++;
      }
    }
  }
  for (const job of PE) {
    for (const theme of ['light', 'dark']) {
      for (const viewport of [D1400, D390]) {
        const r = await capture(browser, job, 'pageEnd', theme, viewport);
        const k = `${job.key}--${theme}--${viewport.width}px--pe`;
        manifest[k] = { surface: job.key, theme, viewport: viewport.width, captureMode: 'pageEnd', darkMode: 'media', status: 'kept', pixelHeight: r.capturedPixelHeight, scrollHeight: r.scrollHeight };
        counts.pageEnd++;
      }
    }
  }

  await browser.close();
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  console.log('capture counts:', JSON.stringify(counts), 'manifest entries:', Object.keys(manifest).length);
}

main().catch(e => { console.error(e); process.exit(1); });