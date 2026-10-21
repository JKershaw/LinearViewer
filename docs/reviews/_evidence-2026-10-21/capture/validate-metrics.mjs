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
import { OVERFLOW_JS, CLIP_JS, CENSUS_SAMPLER_JS, PARSE_COLOR_JS, COMPOSITE_JS } from './metrics.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EVID = path.resolve(__dirname, '..');
const BASE = process.env.BASE_URL || 'http://localhost:3199';
const near = (v, t, tol = 0.02) => Math.abs(v - t) <= tol;
const results = {};
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

// ---- M1 ---------------------------------------------------------------------------
// Review F1/F2: the detector under test is the code capture.mjs SHIPS, not a copy. DOM_JS is
// pulled out of capture.mjs's source and evaluated (it interpolates OVERFLOW_JS from metrics.mjs);
// CLIP_JS is the string capture.mjs imports. A mutation check then swaps the body-limited walk
// for the old walk-to-<html> version and requires the fixtures to go red.
{
  const captureSrc = await readFile(path.join(__dirname, 'capture.mjs'), 'utf8');
  const domBody = /const DOM_JS = `([\s\S]*?)`;\n/.exec(captureSrc)[1];
  const buildDom = (ov) => new Function('OVERFLOW_JS', 'return `' + domBody + '`')(ov);
  const domJs = buildDom(OVERFLOW_JS);
  // the old (rejected) walk: climbs past <body> to <html>, where overflow-x: clip counts as containment
  const toHtml = (src) => src.replace('p !== document.body', 'p');
  const mutatedOverflow = toHtml(OVERFLOW_JS);
  const mutatedClip = CLIP_JS.replace('a !== document.body', 'a');
  if (mutatedOverflow === OVERFLOW_JS || mutatedClip === CLIP_JS) throw new Error('M1 mutation did not apply');
  const mutatedDom = buildDom(mutatedOverflow);

  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const page = await ctx.newPage();
  const fixture = (inner) => `<style>html,body{margin:0;overflow-x:clip}#clip{overflow-x:auto;width:300px}</style>${inner}`;
  const FIX = {
    injected2000: '<div data-testid="injected-2000" style="width:2000px;height:20px;background:red"></div>',
    nested900: '<main><section><div data-testid="nested-900" style="width:900px;height:20px;background:red"></div></section></main>',
    translateX: '<div data-testid="shifted" style="width:100px;height:20px;transform:translateX(500px)"></div>',
    contained: '<div id="clip"><div data-testid="wide-in-scroller" style="width:500px;height:20px;background:blue"></div></div>',
    truncated: '<p data-testid="trunc" style="width:500px;margin:0;white-space:nowrap;font:14px monospace">' + 'x'.repeat(200) + '</p>',
  };
  const run = async (js, html) => { await page.setContent(fixture(html)); return page.evaluate(js); };
  const flagged = async (js, html, get) => get(await run(js, html));
  const domOver = r => r.overflow.overflows;

  await page.setContent(fixture(FIX.injected2000));
  const oldMetric = await page.evaluate(() => { const de = document.documentElement; return de.scrollWidth > de.clientWidth; });
  const shipped = {}, mutated = {};
  for (const k of ['injected2000', 'nested900', 'translateX']) {
    shipped[k] = await flagged(domJs, FIX[k], domOver);
    mutated[k] = await flagged(mutatedDom, FIX[k], domOver);
  }
  const shippedContained = await flagged(domJs, FIX.contained, domOver);
  const shippedSpill = (await run(domJs, FIX.injected2000)).overflow.offenders;
  const clipShipped = (await run(CLIP_JS, FIX.truncated)).length > 0;
  const clipMutated = (await run(mutatedClip, FIX.truncated)).length > 0;
  const geometry = await run(OVERFLOW_JS, FIX.injected2000);
  results.M1 = {
    oldMetricFlagsInjected2000px: oldMetric,
    captureDomJsFlags: shipped, captureDomJsIgnoresContainedWide: !shippedContained, captureDomJsSpill: shippedSpill,
    captureClipJsFlagsTruncatedText: clipShipped,
    mutation_walkToHtml: { domJsFlags: mutated, clipJsFlagsTruncatedText: clipMutated },
    sharedGeometryFlagsInjected2000px: geometry.overflows,
    passed: oldMetric === false
      && shipped.injected2000 && shipped.nested900 && shipped.translateX && !shippedContained
      && shippedSpill.some(s => s.startsWith('injected-2000')) && clipShipped
      && !mutated.injected2000 && !mutated.nested900 && !mutated.translateX && !clipMutated,
    note: 'oldMetric false = the 09-26 check is vacuous under overflow-x: clip (LIN-3715). Detector = capture.mjs DOM_JS/CLIP_JS as shipped; mutation_walkToHtml is the rejected walk-to-<html> variant and must read all-false (it is what the PR shipped).',
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
    // F3: bounced/errored pages must not read as plain `measured`
    labels: Object.fromEntries(['account', 'email-register', 'email-reproof', 'ws-roadmap-local', 'ws-task-page', 'ws-task-edit', 'swipe-public', 'ws-dashboard'].map(id => [id, census.entries[id]?.status])),
    passed: ['account', 'email-register', 'email-reproof'].every(id => /^measured:redirected/.test(census.entries[id]?.status)) && census.entries['ws-task-page']?.status === 'measured:error-503' && census.entries['swipe-public']?.status === 'measured' && census.entries['ws-dashboard']?.status === 'measured'
      && save.length > 0 && save.every(g => near(g.ratio, 2.71)) && halt.length === 3 && halt.every(g => near(g.ratio, 1.35)) && prog.length > 0 && prog.every(g => near(g.ratio, 2.27)) && census.coverage.passed === true,
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
