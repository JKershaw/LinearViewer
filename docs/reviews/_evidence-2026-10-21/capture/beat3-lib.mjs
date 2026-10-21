/**
 * LIN-3750 (LIN-3747 beat 3): shared helpers for the authenticated captures.
 *
 * Docs-only research tooling. It does NOT extend tests/visual/*.spec.js or tests/screenshots/
 * (LIN-868/LIN-941); it reuses beat 1's measurement primitives (metrics.mjs: M1 OVERFLOW_JS,
 * CLIP_JS, M3/M4 CENSUS_SAMPLER_JS) and writes into the shared evidence directory.
 *
 * Contract (per the approved plan):
 *   - fresh renders only, never a committed screenshot;
 *   - 1400/390 x light/dark, dark via the real `theme` cookie, `theme-dark` asserted in the
 *     SAME page.evaluate read that measures the page (a failed assertion records a failure,
 *     no PNG is written);
 *   - every capture is keyed to a registry.json id and upserted into manifest.json.
 */
import { chromium } from 'playwright';
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PARSE_COLOR_JS, OVERFLOW_JS, CLIP_JS, CENSUS_SAMPLER_JS } from './metrics.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const EVID = path.resolve(__dirname, '..');
export const BASE = process.env.BASE_URL || 'http://localhost:3197';
export const OUT = path.join(EVID, 'authenticated');
export const MANIFEST = path.join(EVID, 'manifest.json');
export const REGISTRY = JSON.parse(await readFile(path.join(EVID, 'registry.json'), 'utf8'));
export const REGISTRY_IDS = new Set(REGISTRY.entries.map(e => e.id));

export const D1400 = { width: 1400, height: 1000 };
export const D390 = { width: 390, height: 844 };
export const MATRIX = [
  ['light', D1400], ['light', D390], ['dark', D1400], ['dark', D390],
];

export const ALL_FEATURES = {
  dispatch: true, proxy: true, roadmap: true, collective: true, taskChat: true, ship: true,
  nextRun: true, flightCompanion: true, passagePlanner: true, shipBiscuit: true,
  liveConsole: true, shipJourney: true, feedbackWidget: true,
};
export const featuresQuery = (f = ALL_FEATURES) => encodeURIComponent(JSON.stringify(f));
export const APP_SESSION = `/test/set-session?features=${featuresQuery()}`;
export const WS = 'test-workspace';
export const ws = (p = '') => `/workspace/${WS}${p}`;

const INIT = `window.__parseColor = (() => { ${PARSE_COLOR_JS}\n return parseColor; })();`;

export async function launch() {
  return chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
}

/** Same-read measurement: html class, geometry, clipping, nav/footer facts, heading counts. */
const READ_JS = `(() => {
  const de = document.documentElement;
  const heads = {}; document.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach(h => { heads[h.tagName.toLowerCase()] = (heads[h.tagName.toLowerCase()] || 0) + 1; });
  const pick = (sel) => [...new Set(Array.from(document.querySelectorAll(sel)).map(e => (e.textContent || '').trim()).filter(Boolean))].slice(0, 40);
  return {
    htmlClass: de.className,
    title: document.title,
    h1: (document.querySelector('h1') || {}).textContent ? document.querySelector('h1').textContent.trim().slice(0, 120) : null,
    headings: heads,
    geometry: ${OVERFLOW_JS},
    mainCount: document.querySelectorAll('main, [role="main"]').length,
    footerCount: document.querySelectorAll('footer').length,
    navLinks: pick('nav a'),
    footerLinks: pick('footer a, footer button'),
    hasThemeToggle: !!document.querySelector('[data-testid="footer-theme-toggle"]'),
    hasTeamSelector: !!document.querySelector('[data-selector="team"]'),
    hasAssigneeSelector: !!document.querySelector('[data-selector="assignee"]'),
    bodyText: (document.body.innerText || '').replace(/\\s+/g, ' ').trim().length,
  };
})()`;

export async function measurePage(page, { theme, darkMode }) {
  const read = await page.evaluate(READ_JS);
  const clip = await page.evaluate(CLIP_JS);
  const sweep = await page.evaluate(CENSUS_SAMPLER_JS);
  let themeAssertion;
  if (darkMode === 'media') {
    themeAssertion = { mode: 'media-emulated', actual: read.htmlClass, passed: true };
  } else if (theme === 'dark') {
    themeAssertion = { mode: 'cookie', expected: 'theme-dark', actual: read.htmlClass, passed: read.htmlClass.split(/\s+/).includes('theme-dark') };
  } else {
    themeAssertion = { mode: 'cookie', expected: 'no theme-dark', actual: read.htmlClass, passed: !read.htmlClass.includes('theme-dark') };
  }
  return { themeAssertion, read, clip, contrast: { sampled: sweep.sampled, belowThreshold: sweep.groups } };
}

export async function upsertManifest(rows) {
  let m = {};
  try { m = JSON.parse(await readFile(MANIFEST, 'utf8')); } catch { m = {}; }
  m.entries = m.entries || {};
  m.note = m.note || 'LIN-3747 evidence manifest. Every entry maps a capture to a registry.json id. Beat 3 (LIN-3750) owns authenticated/ entries.';
  for (const r of rows) m.entries[r.key] = r;
  const sorted = Object.fromEntries(Object.entries(m.entries).sort(([a], [b]) => a.localeCompare(b)));
  await writeFile(MANIFEST, JSON.stringify({ ...m, entries: sorted }, null, 2));
}

/** A fresh context that carries the theme cookie / colour scheme and the colour-parse init script. */
export async function newCtx(browser, theme, viewport, { darkMode } = {}) {
  const opts = { viewport };
  if (darkMode === 'media') opts.colorScheme = theme;
  const ctx = await browser.newContext(opts);
  await ctx.addInitScript(INIT);
  if (darkMode !== 'media') await ctx.addCookies([{ name: 'theme', value: theme, url: BASE }]);
  return ctx;
}

/** Establish the session a surface needs, inside `ctx`. */
export async function establish(ctx, session) {
  if (!session || session === 'none') return;
  const req = ctx.request;
  if (session === 'app') return void (await req.get(`${BASE}${APP_SESSION}`));
  if (session.startsWith?.('/')) return void (await req.get(`${BASE}${session}`));
  if (session.local) {
    const r = await req.post(`${BASE}/test/set-local-session`, { data: session.local });
    if (!r.ok()) throw new Error(`set-local-session failed: ${r.status()} ${await r.text()}`);
    return;
  }
  throw new Error(`unknown session: ${JSON.stringify(session)}`);
}

/**
 * Capture one state of one registry id across the matrix.
 *   surface: { id, state, path, session, prepare?(page,ctx), settleMs?, populated?, expect?, note?, full? , matrix?}
 * Returns the manifest rows (also upserted).
 */
export async function captureState(browser, surface, { quiet } = {}) {
  if (!REGISTRY_IDS.has(surface.id)) throw new Error(`not a registry id: ${surface.id}`);
  await mkdir(OUT, { recursive: true });
  const rows = [];
  const matrix = surface.matrix || MATRIX;
  for (const [theme, viewport] of matrix) {
    const name = `${surface.id.replace(/[^\w.-]+/g, '_')}--${surface.state}--${theme}-${viewport.width}px`;
    const key = `${surface.id}|${surface.state}|${theme}|${viewport.width}`;
    const row = { key, registryId: surface.id, state: surface.state, theme, viewport: viewport.width, path: surface.path, populated: surface.populated ?? null, note: surface.note || undefined };
    const ctx = await newCtx(browser, theme, viewport, { darkMode: surface.darkMode });
    try {
      await establish(ctx, surface.session);
      if (surface.permissions) await ctx.grantPermissions(surface.permissions, { origin: BASE });
      if (surface.before) await surface.before(ctx, { theme, viewport });
      const page = await ctx.newPage();
      page.setDefaultTimeout(15000);
      const consoleErrors = [];
      page.on('pageerror', e => consoleErrors.push(String(e.message).slice(0, 200)));
      const failedReqs = [];
      page.on('response', r => { if (r.status() >= 400 && new URL(r.url()).origin === BASE) failedReqs.push(`${r.status()} ${new URL(r.url()).pathname}`); });
      const resp = await page.goto(`${BASE}${surface.path}`, { waitUntil: 'load' });
      row.httpStatus = resp ? resp.status() : null;
      row.finalPath = new URL(page.url()).pathname + new URL(page.url()).search;
      if (surface.prepare) await surface.prepare(page, ctx, { theme, viewport });
      await page.waitForTimeout(surface.settleMs ?? 600);
      const m = await measurePage(page, { theme, darkMode: surface.darkMode });
      row.themeAssertion = m.themeAssertion;
      if (!m.themeAssertion.passed) { row.ok = false; row.reason = 'theme-assertion'; rows.push(row); continue; }
      const want = surface.expect || {};
      row.expected = { status: 200, ...want };
      row.outcome = (row.httpStatus === row.expected.status && (!want.finalPath || row.finalPath.split('?')[0] === want.finalPath)) ? 'as-expected' : 'unexpected';
      await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: !!surface.full });
      const extra = surface.extra ? await surface.extra(page, { theme, viewport }) : undefined;
      await writeFile(path.join(OUT, `${name}.json`), JSON.stringify({ ...row, ...m, extra, consoleErrors, failedRequests: failedReqs }, null, 2));
      row.ok = true;
      row.files = { png: `authenticated/${name}.png`, json: `authenticated/${name}.json` };
      row.summary = { title: m.read.title, h1: m.read.h1, overflows: m.read.geometry.overflows, contrastGroups: m.contrast.belowThreshold.length, clipped: m.clip.length, bodyText: m.read.bodyText };
    } catch (e) {
      row.ok = false; row.reason = `exception: ${String(e.message || e).split('\n')[0]}`;
    } finally {
      await ctx.close();
    }
    rows.push(row);
    if (!quiet) console.log(`${row.ok ? 'OK  ' : 'FAIL'} ${surface.id} [${surface.state}] ${theme} ${viewport.width}px  http=${row.httpStatus ?? '-'} ${row.outcome ?? ''} ${row.reason ?? ''}${row.summary ? ` ovf=${row.summary.overflows} lowContrast=${row.summary.contrastGroups}` : ''}`);
  }
  await upsertManifest(rows);
  return rows;
}

export async function getJson(ctx, url) {
  const r = await ctx.request.get(`${BASE}${url}`);
  return { status: r.status(), body: await r.text() };
}
