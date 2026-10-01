// LIN-3168: draw the browser-flake figures as hand-written SVG from data/survey-flakes/analysis.json (no dependencies).
// Usage: node scripts/survey-flakes-figures.mjs [--dir data/survey-flakes] [--out docs/papers/harbour/figures/browser-flakes] [--top 10]
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const dir = arg('--dir', 'data/survey-flakes');
const outDir = arg('--out', 'docs/papers/harbour/figures/browser-flakes');
const top = Number(arg('--top', '10'));
mkdirSync(outDir, { recursive: true });
const A = JSON.parse(readFileSync(join(dir, 'analysis.json'), 'utf8'));

const FONT = 'font-family="Inter, Helvetica, Arial, sans-serif"';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const text = (x, y, s, o = '') => {
  const at = { 'font-size': '12', fill: '#333' }; for (const [, k, v] of o.matchAll(/([a-z-]+)="([^"]*)"/g)) at[k] = v;
  return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" ${FONT} ${Object.entries(at).map(([k, v]) => `${k}="${v}"`).join(' ')}>${esc(s)}</text>`;
};
const svg = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#fff"/>${body}</svg>\n`;
const rect = (x, y, w, h, fill, title) => `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(0, w).toFixed(1)}" height="${h}" fill="${fill}"><title>${esc(title)}</title></rect>`;
const legend = (x, y, keys, colors) => { let b = ''; let lx = x; for (const k of keys) { b += `<rect x="${lx}" y="${y - 10}" width="12" height="12" fill="${colors[k]}"/>` + text(lx + 16, y, k, 'font-size="11"'); lx += 30 + k.length * 6.2; } return b; };

const CLS = ['flake', 'real fault', 'count pin', 'environment', 'other'];
const CC = { flake: '#9e9ac8', 'real fault': '#1a9850', 'count pin': '#d73027', environment: '#969696', other: '#d9d9d9', unverified: '#d9d9d9', unresolved: '#fdae61', 'main moved': '#d9d9d9' };
const G = A.green;

// Figure 1 (headline): specs ranked by CI-red flakes, with what else failed them, their retried-away flakes in green runs, and the wall-clock the red flakes cost.
{
  const specs = A.ranked.filter((e) => e.flake > 0 || e.greenRetries > 0).slice(0, top);
  for (const [s, n] of A.greenOnly) if (specs.length < top + 2) specs.push({ spec: s, attempts: 0, flake: 0, 'real fault': 0, 'count pin': 0, environment: 0, other: 0, greenRetries: n, flakeMinutes: 0 });
  const W = 1180; const rowH = 34; const T = 136; const L = 250;
  const P = [{ x: L, w: 260, title: 'E2E-red CI attempts on the spec, by class' }, { x: L + 330, w: 230, title: 'Green runs with it retried away (sample)' }, { x: L + 640, w: 200, title: 'Wall-clock of its red flakes, min' }];
  const maxA = Math.max(...specs.map((e) => e.attempts)); const maxM = Math.max(...specs.map((e) => e.flakeMinutes));
  let b = text(20, 26, 'Which browser specs flake, and what else fails them', 'font-size="15" font-weight="600"')
    + text(20, 46, `LinearViewer (Harbour) CI, 1 Jun–30 Sep 2026: every failed attempt with a red E2E shard and a readable log (from 3 Jul). simple-dispatcher CI runs no browser.`, 'fill="#666"')
    + text(20, 62, `Middle: a systematic sample of ${G.runs} green runs (every 8th since 3 Jul) — the share in which Playwright failed the spec and passed it on an in-job retry.`, 'fill="#666"')
    + text(20, 78, 'Right: minutes the red flaky attempts ran plus their re-runs (runner time, not waiting time). Ranked by CI-red flakes.', 'fill="#666"')
    + legend(20, T - 32, CLS, CC);
  for (const p of P) b += text(p.x, T - 10, p.title, 'font-weight="600" font-size="11"');
  specs.forEach((e, i) => {
    const y = T + i * rowH;
    b += text(20, y + 17, e.spec.replace(/\.spec\.js$/, ''), 'font-weight="600"');
    let x = P[0].x;
    for (const k of CLS) {
      const n = e[k] || 0; const w = (P[0].w * n) / maxA;
      if (n) { b += rect(x, y + 4, w, 20, CC[k], `${e.spec}: ${n} ${k}`); if (w > 14) b += text(x + w / 2 - 3, y + 18, n, 'font-size="10" fill="#fff"'); }
      x += w;
    }
    b += text(x + 4, y + 18, e.attempts ? `${e.attempts}` : 'none red', 'font-size="11" fill="#666"');
    const share = G.runs ? e.greenRetries / G.runs : 0; const gw = P[1].w * share;
    b += rect(P[1].x, y + 4, P[1].w, 20, '#f0f0f0', '') + rect(P[1].x, y + 4, gw, 20, '#6a51a3', `${e.spec}: retried away in ${e.greenRetries} of ${G.runs} sampled green runs`)
      + text(P[1].x + P[1].w + 4, y + 18, `${Math.round(share * 100)}% (${e.greenRetries})`, 'font-size="11"');
    const mw = maxM ? (P[2].w * e.flakeMinutes) / maxM : 0;
    b += rect(P[2].x, y + 4, mw, 20, '#fdae61', `${e.spec}: ${Math.round(e.flakeMinutes)} min`) + text(P[2].x + mw + 4, y + 18, e.flakeMinutes ? `${Math.round(e.flakeMinutes)}` : '0', 'font-size="11"');
  });
  writeFileSync(join(outDir, 'specs-ranked.svg'), svg(W, T + specs.length * rowH + 20, b));
}

// Figure 2: E2E-red CI attempts per month by class, beside the green-run retry rate per month.
{
  const months = ['2026-06', '2026-07', '2026-08', '2026-09'];
  const KEYS = ['flake', 'real fault', 'count pin', 'environment', 'unverified', 'unresolved'];
  const by = Object.fromEntries(months.map((m) => [m, {}]));
  for (const x of A.census) { const m = x.date.slice(0, 7); if (!by[m]) continue; const k = KEYS.includes(x.class) ? x.class : 'unresolved'; by[m][k] = (by[m][k] || 0) + 1; }
  const gm = A.green.byMonth || {};
  const W = 1060; const H = 372; const L = 60; const T = 104; const ph = 180; const bw = 70;
  const max = Math.max(...months.map((m) => Object.values(by[m]).reduce((s, v) => s + v, 0)));
  let b = text(20, 26, 'Browser-test reds by month, and how often a green run hid a retry', 'font-size="15" font-weight="600"')
    + text(20, 46, 'Left: LinearViewer CI attempts with a red E2E shard (pull requests and pushes to main). Right: share of sampled green runs with ≥1 retried-away flaky test.', 'fill="#666"')
    + text(20, 62, 'June logs have expired, so June reds are classed from what the next green run changed, not from the failing test. Workers went from 1 to 2 on 24 June.', 'fill="#666"')
    + legend(L, T - 22, KEYS, { ...CC, unverified: '#d9d9d9' });
  months.forEach((m, i) => {
    const x = L + i * (bw + 30); let y = T + 10 + ph;
    for (const k of KEYS) { const n = by[m][k] || 0; const h = (ph * n) / max; if (n) { y -= h; b += rect(x, y, bw, h, k === 'unverified' ? '#d9d9d9' : CC[k], `${m}: ${n} ${k}`); if (h > 12) b += text(x + bw / 2 - 5, y + h / 2 + 4, n, 'font-size="10" fill="#fff"'); } }
    b += text(x + 10, T + ph + 28, m.replace('2026-', '') === '06' ? 'June' : m === '2026-07' ? 'July' : m === '2026-08' ? 'Aug' : 'Sept', 'font-size="11"');
  });
  const gx = L + 4 * (bw + 30) + 60; const gw = 60;
  b += text(gx, T + ph + 60, 'Green runs hiding a retry (inner bar: other than the livebar test)', 'font-weight="600" font-size="11"');
  months.slice(1).forEach((m, i) => {
    const g = gm[m]; if (!g) return; const share = g.withFlaky / g.runs; const h = ph * share; const x = gx + i * (gw + 20);
    const h2 = (ph * g.withoutLivebar) / g.runs;
    b += rect(x, T + 10 + ph - h, gw, h, '#6a51a3', `${m}: ${g.withFlaky} of ${g.runs}`) + text(x + 8, T + 4 + ph - h, `${Math.round(share * 100)}%`, 'font-size="11"')
      + rect(x + 12, T + 10 + ph - h2, gw - 24, h2, '#cbc9e2', `${m}: ${g.withoutLivebar} of ${g.runs} without counting the livebar test`) + text(x + 14, T + 4 + ph - h2, `${Math.round((100 * g.withoutLivebar) / g.runs)}%`, 'font-size="10" fill="#fff"')
      + text(x + 8, T + ph + 28, m === '2026-07' ? 'July' : m === '2026-08' ? 'Aug' : 'Sept', 'font-size="11"') + text(x + 4, T + ph + 42, `n=${g.runs}`, 'font-size="10" fill="#666"');
  });
  writeFileSync(join(outDir, 'by-month.svg'), svg(W, H, b));
}
console.log(`wrote ${outDir}/specs-ranked.svg, by-month.svg`);
