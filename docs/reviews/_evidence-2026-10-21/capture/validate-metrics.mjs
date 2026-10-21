/**
 * LIN-3748 beat 1: tool-validation fixtures. Every measurement later beats rely on must
 * pass here first. Writes ../validation/validation.json; exit 1 if any fixture fails.
 *
 *   M1  an injected 2000px div is flagged by the geometry rule while the OLD metric
 *       (de.scrollWidth > de.clientWidth) reads green under overflow-x: clip (LIN-3715);
 *       a wide child inside an overflow-x:auto scroller is NOT flagged.
 *   M2  `/` on the :3199 boot renders 4 CTAs (landing-cta-{linear,github,jira,email}).
 *       Live harbour.cat is checked if reachable (unreachable = named limit, not a fail).
 *   M3  `.action-btn.save` light reads ~2.71:1 (not 3.08:1) on /workspace/test-workspace/settings;
 *       the 09-26 first-match walk is re-run alongside to show the delta; Lighthouse
 *       color-contrast cross-check is read from validation/lighthouse-settings-contrast.json.
 *   M4  the census reproduces ~2.71 (save), 1.35 (dark Dispatch/Workspace Halt, LIN-3119),
 *       2.27 (◐ In Progress, LIN-3123), and its coverage assertion passed (census.json).
 *   C   (kept from 09-26) DOM vs accessibility-tree heading census agree on /styleguide.
 *
 *   BASE_URL=http://localhost:3199 node validate-metrics.mjs   (after census.mjs has written census.json)
 */
import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OVERFLOW_JS, CENSUS_SAMPLER_JS, PARSE_COLOR_JS, COMPOSITE_JS } from './metrics.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EVID = path.resolve(__dirname, '..');
const BASE = process.env.BASE_URL || 'http://localhost:3199';
const near = (v, t, tol = 0.02) => Math.abs(v - t) <= tol;
const results = {};
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

// ---- M1 ---------------------------------------------------------------------------
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const page = await ctx.newPage();
  const fixture = (inner) => `<style>html,body{margin:0;overflow-x:clip}#clip{overflow-x:auto;width:300px}</style>${inner}`;
  await page.setContent(fixture('<div data-testid="injected-2000" style="width:2000px;height:20px;background:red"></div>'));
  const oldMetric = await page.evaluate(() => { const de = document.documentElement; return de.scrollWidth > de.clientWidth; });
  const injected = await page.evaluate(OVERFLOW_JS);
  await page.setContent(fixture('<div id="clip"><div data-testid="wide-in-scroller" style="width:500px;height:20px;background:blue"></div></div>'));
  const contained = await page.evaluate(OVERFLOW_JS);
  results.M1 = {
    oldMetricFlagsInjected2000px: oldMetric, geometryFlagsInjected2000px: injected.overflows, geometrySpill: injected.spill,
    geometryIgnoresContainedWide: !contained.overflows,
    passed: oldMetric === false && injected.overflows === true && injected.spill.some(s => s.startsWith('injected-2000')) && !contained.overflows,
    note: 'oldMetric false = the 09-26 check is vacuous under overflow-x: clip (LIN-3715); geometry rule flags the same page.',
  };
  await ctx.close();
}

// ---- M2 ---------------------------------------------------------------------------
{
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`, { waitUntil: 'load' });
  const ctas = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="landing-cta-"]')].map(e => e.dataset.testid).sort());
  const want = ['landing-cta-email', 'landing-cta-github', 'landing-cta-jira', 'landing-cta-linear'];
  let live = { reachable: false };
  try {
    const r = await fetch('https://harbour.cat/', { signal: AbortSignal.timeout(15000) });
    const html = await r.text();
    live = { reachable: true, status: r.status, ctas: want.filter(t => html.includes(`data-testid="${t}"`)) };
  } catch (e) { live = { reachable: false, reason: String(e.message).slice(0, 120) }; }
  results.M2 = { localCtas: ctas, expected: want, live, passed: JSON.stringify(ctas) === JSON.stringify(want) && (!live.reachable || live.ctas.length === 4) };
  await ctx.close();
}

// ---- M3 ---------------------------------------------------------------------------
{
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  await ctx.addInitScript(`window.__parseColor = (() => { ${PARSE_COLOR_JS}\n return parseColor; })();`);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/test/set-session`, { waitUntil: 'load' });
  await page.goto(`${BASE}/workspace/test-workspace/settings`, { waitUntil: 'load' });
  const m = await page.evaluate(`(() => { ${PARSE_COLOR_JS}\n${COMPOSITE_JS}
    const el = document.querySelector('.action-btn.save'); const cs = getComputedStyle(el);
    const fg = parseColor(cs.color), bg = effBg(el);
    // the 09-26 first-match walk: first ancestor with alpha>0 is taken as solid (no composite, own bg ignored when unparsed)
    let a = el, first = null; while (a) { const c = parseColor(getComputedStyle(a).backgroundColor); if (c[3] > 0) { first = c.slice(0, 3); break; } a = a.parentElement; }
    const solid = (() => { let p = el.parentElement; while (p) { const c = parseColor(getComputedStyle(p).backgroundColor); if (c[3] >= 1) return c.slice(0, 3); p = p.parentElement; } return [255,255,255]; })();
    return { rawBg: cs.backgroundColor, color: cs.color, composited: +ratio(fg, bg).toFixed(2), ownBgIgnored: +ratio(fg, solid).toFixed(2), effBg: bg };
  })()`);
  const lh = JSON.parse(await readFile(path.join(EVID, 'validation/lighthouse-settings-contrast.json'), 'utf8'));
  const lhSave = lh.items.filter(i => /action-btn save/.test(i.snippet)).map(i => +/contrast of ([\d.]+)/.exec(i.explanation)[1]);
  results.M3 = { ...m, lighthouseSaveButtons: lhSave, lighthouseVersion: '12.8.2', passed: near(m.composited, 2.71, 0.02) && !near(m.composited, 3.08, 0.1) && lhSave.length > 0 && lhSave.every(v => near(v, 2.7, 0.06)) };
  await ctx.close();
}

// ---- M4 ---------------------------------------------------------------------------
{
  const census = JSON.parse(await readFile(path.join(EVID, 'census.json'), 'utf8'));
  const groups = (id, theme) => census.entries[id]?.themes?.[theme]?.groups ?? [];
  const find = (id, theme, re) => groups(id, theme).filter(g => re.test(g.element + ' ' + g.samples.join(' ')));
  const save = find('ws-settings', 'light', /action-btn\.save/);
  const halt = find('ws-dispatch', 'dark', /halt-(pause|stop|resume)/);
  const prog = find('ws-tree', 'light', /In Progress|◐/);
  results.M4 = {
    saveLight: save.map(g => g.ratio), haltDark: halt.map(g => ({ el: g.element, ratio: g.ratio })), inProgressLight: prog.map(g => ({ el: g.element, ratio: g.ratio })),
    coverage: census.coverage,
    passed: save.length > 0 && save.every(g => near(g.ratio, 2.71)) && halt.length === 3 && halt.every(g => near(g.ratio, 1.35)) && prog.length > 0 && prog.every(g => near(g.ratio, 2.27)) && census.coverage.passed === true,
  };
}

// ---- C (heading census, carried from 09-26) -----------------------------------------
{
  const page = await (await browser.newContext()).newPage();
  await page.goto(`${BASE}/styleguide`, { waitUntil: 'load' });
  const dom = await page.evaluate(() => { const c = {}; document.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach(h => { const t = h.tagName.toLowerCase(); c[t] = (c[t] || 0) + 1; }); return c; });
  const a11y = {};
  for (let l = 1; l <= 6; l++) { const n = await page.getByRole('heading', { level: l }).count(); if (n) a11y['h' + l] = n; }
  results.C = { dom, a11y, passed: JSON.stringify(Object.entries(dom).sort()) === JSON.stringify(Object.entries(a11y).sort()) };
}

await browser.close();
const passed = Object.values(results).every(r => r.passed);
await writeFile(path.join(EVID, 'validation/validation.json'), JSON.stringify({ passed, results }, null, 2));
for (const [k, v] of Object.entries(results)) console.log(k, v.passed ? 'PASS' : 'FAIL');
console.log(passed ? 'ALL FIXTURES PASS' : 'FIXTURE FAILURE');
process.exit(passed ? 0 : 1);
