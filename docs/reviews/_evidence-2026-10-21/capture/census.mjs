/**
 * LIN-3748 M4: registry-driven composited-contrast census.
 *
 * Replaces capture-gap.mjs's hardcoded 24-path DARK_SWEEP / fullsweep (:314-316,:389).
 * Input is registry.json, never a list in this file. Every entry is swept in BOTH
 * themes with the M3 in-page sampler (own background composited; color(srgb) parsed):
 *   - route entries      cookie theme (theme-dark asserted in the same read) for app pages;
 *                        standalone documents (landing, archives, library, ...) use
 *                        prefers-color-scheme emulation, labelled darkMode:'media', plus the
 *                        cookie so a page that honours it is not mislabelled;
 *   - intercepted entries (renderers + error/consent/email states) are rendered in Node, served
 *                        through request interception at a real origin (real /style.css);
 *   - library entries    expanded from the live loadLibrary catalog (one id per document).
 * Output census.json lists every id as `measured` or `excluded:<reason>`. The run FAILS (exit 1)
 * if any expanded registry id is unlisted, any status is neither of those, or any entry errored.
 *
 *   BASE_URL=http://localhost:3199 node census.mjs [--only id,id] [--resume] [--out file]
 */
import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CENSUS_SAMPLER_JS, PARSE_COLOR_JS } from './metrics.mjs';
import { RENDERERS, STATES } from './renderer-args.mjs';
import { loadLibrary } from '../../../../lib/library.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EVID = path.resolve(__dirname, '..');
const BASE = process.env.BASE_URL || 'http://localhost:3199';
const arg = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null; };
const OUT = arg('--out') || path.join(EVID, 'census.json');
const ONLY = arg('--only')?.split(',');
const RESUME = process.argv.includes('--resume');
const VIEW = { width: 1400, height: 1000 };

const registry = JSON.parse(await readFile(path.join(EVID, 'registry.json'), 'utf8'));

// ---- expand the registry into the concrete ids to measure --------------------
const catalog = loadLibrary();
const expanded = [];
for (const e of registry.entries) {
  if (e.method === 'expand:library-catalog') {
    for (const d of catalog.docs) {
      expanded.push({ id: `library-doc:${d.slug}`, class: 'library', kind: 'page', method: 'route', seed: 'none', theme: 'media', standalone: true, path: `/library/${d.slug}`, parent: e.id });
    }
  } else if (e.id === 'library-paper' || e.id === 'library-doc') {
    // route templates: measured through the per-document expansion above
    expanded.push({ ...e, method: `excluded:covered-by-expansion:library-doc:*` });
  } else expanded.push(e);
}
const expectedIds = expanded.map(e => e.id);

// ---- seeds (kept in sync with build-registry.mjs) -----------------------------
const FEATURES = encodeURIComponent(JSON.stringify({
  dispatch: true, proxy: true, roadmap: true, collective: true, taskChat: true, ship: true,
  nextRun: true, flightCompanion: true, passagePlanner: true, shipBiscuit: true,
  liveConsole: true, shipJourney: true, feedbackWidget: true,
}));
const SEED_URL = {
  app: `/test/set-session?features=${FEATURES}`, github: '/test/set-github-session', ghp: '/test/set-github-projects-session',
  jira: '/test/set-jira-session', local: '/test/set-local-session',
};

const INIT = `window.__parseColor = (() => { ${PARSE_COLOR_JS}\n return parseColor; })();`;

async function sweepPage(page, entry, theme, status, finalUrl) {
  await page.waitForTimeout(entry.settleMs || 700);
  const htmlClass = await page.evaluate(() => document.documentElement.className);
  const bodyBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const sweep = await page.evaluate(CENSUS_SAMPLER_JS);
  const cookieMode = entry.theme === 'cookie' && !entry.standalone;
  const assertion = theme === 'dark'
    ? (cookieMode ? { mode: 'cookie', expected: 'theme-dark', actual: htmlClass, passed: htmlClass.split(/\s+/).includes('theme-dark') }
                  : { mode: 'media-emulated (labelled)', htmlClass, bodyBg, note: 'standalone document / intercepted renderer; honours prefers-color-scheme or the cookie, not guaranteed to change' })
    : { mode: cookieMode ? 'cookie' : 'media', expected: 'no theme-dark', actual: htmlClass, passed: !htmlClass.includes('theme-dark') };
  return { httpStatus: status, finalUrl, themeAssertion: assertion, sampled: sweep.sampled, groups: sweep.groups };
}

async function measure(browser, entry) {
  const res = { id: entry.id, class: entry.class, method: entry.method, isNew: !!entry.isNew, themes: {} };
  for (const theme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: VIEW, colorScheme: theme });
    try {
      await ctx.addInitScript(INIT);
      await ctx.addCookies([{ name: 'theme', value: theme, url: BASE }]);
      const page = await ctx.newPage();
      let status = null;
      if (entry.method === 'intercept' || entry.method === 'intercept-state') {
        const html = (entry.method === 'intercept' ? RENDERERS[entry.renderer] : STATES[entry.id])();
        await page.route('**/*', r => r.request().resourceType() === 'document' ? r.fulfill({ status: 200, body: html, contentType: 'text/html' }) : r.continue());
        const r = await page.goto(`${BASE}/__intercept__/${encodeURIComponent(entry.id)}`, { waitUntil: 'load' });
        status = 'synthetic';
        res.themes[theme] = await sweepPage(page, entry, theme, status, '(intercepted)');
      } else {
        if (entry.seed && entry.seed !== 'none') await page.goto(`${BASE}${SEED_URL[entry.seed]}`, { waitUntil: 'load' }).catch(() => {});
        const r = await page.goto(`${BASE}${entry.path}`, { waitUntil: 'load' });
        status = r ? r.status() : null;
        res.themes[theme] = await sweepPage(page, entry, theme, status, page.url().replace(BASE, ''));
      }
    } finally { await ctx.close(); }
  }
  res.status = 'measured';
  return res;
}

// ---- run ------------------------------------------------------------------------
let census = { generatedFrom: registry.generatedFrom, note: 'Composited contrast census (M3 sampler, own background layered), 1400px, both themes. Threshold 4.5:1 normal text, 3:1 large text. Intercepted entries are SYNTHETIC production-renderer output, not live states.', entries: {} };
if (RESUME && existsSync(OUT)) census = JSON.parse(await readFile(OUT, 'utf8'));

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const todo = expanded.filter(e => (!ONLY || ONLY.includes(e.id)) && !(RESUME && census.entries[e.id]));
let failed = 0, idx = 0;
async function worker() {
  while (idx < todo.length) {
    const entry = todo[idx++];
    if (entry.method.startsWith('excluded:')) { census.entries[entry.id] = { id: entry.id, class: entry.class, status: entry.method }; continue; }
    if (entry.method === 'hop') { census.entries[entry.id] = { id: entry.id, class: entry.class, status: `excluded:${entry.legacy ? 'legacy-redirect-measured-at-destination' : 'oauth-hop-no-own-body'}` }; continue; }
    try {
      census.entries[entry.id] = await measure(browser, entry);
      const t = census.entries[entry.id].themes;
      console.log(`OK   ${entry.id}  L:${t.light.groups.length}g D:${t.dark.groups.length}g  [${t.light.httpStatus}/${t.dark.httpStatus}]`);
    } catch (err) {
      failed++;
      census.entries[entry.id] = { id: entry.id, class: entry.class, status: `failed:${String(err.message).split('\n')[0]}` };
      console.log(`FAIL ${entry.id}: ${err.message.split('\n')[0]}`);
    }
  }
}
await Promise.all([worker(), worker(), worker(), worker()]);
await browser.close();

// ---- coverage assertion --------------------------------------------------------
const listed = new Set(Object.keys(census.entries));
const unlisted = expectedIds.filter(id => !listed.has(id));
const badStatus = Object.values(census.entries).filter(e => !(e.status === 'measured' || e.status.startsWith('excluded:')));
const orphan = [...listed].filter(id => !expectedIds.includes(id));
census.coverage = {
  registryIds: expectedIds.length,
  measured: Object.values(census.entries).filter(e => e.status === 'measured').length,
  excluded: Object.values(census.entries).filter(e => e.status.startsWith('excluded:')).length,
  unlisted, notMeasuredOrExcluded: badStatus.map(e => `${e.id}=${e.status}`), orphanCensusIds: orphan,
  passed: !ONLY && unlisted.length === 0 && badStatus.length === 0 && orphan.length === 0,
};
await writeFile(OUT, JSON.stringify(census, null, 2));
console.log('coverage', JSON.stringify(census.coverage, null, 1));
if (!ONLY && !census.coverage.passed) { console.error('COVERAGE ASSERTION FAILED'); process.exit(1); }
