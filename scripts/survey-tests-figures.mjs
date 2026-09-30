// LIN-3151: draw the test-estate figures as hand-written SVG from data/survey-tests/analysis.json (no dependencies).
// Usage: node scripts/survey-tests-figures.mjs [--dir data/survey-tests] [--out docs/papers/harbour/figures/test-estate] [--e2e-minutes <LinearViewer e2e shard minutes, summed>]
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const dir = arg('--dir', 'data/survey-tests');
const outDir = arg('--out', 'docs/papers/harbour/figures/test-estate');
const e2eMinutes = Number(arg('--e2e-minutes', 0));
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

const CLASSES = ['behavioural', 'text pin', 'census', 'source scan', 'e2e'];
const CAUSES = ['caught a fault', 'pin or doc bump', 'test updated', 'flaky', 'other'];
const CC = { 'caught a fault': '#1a9850', 'pin or doc bump': '#d73027', 'test updated': '#fdae61', flaky: '#9e9ac8', other: '#bbb' };
const causeOf = (k) => (k === 'fault' || k === 'prod fix' ? 'caught a fault' : ['pin bump', 'doc/prompt', 'pin/literal update', 'doc/prompt edit'].includes(k) ? 'pin or doc bump'
  : ['test updated', 'test rewrite'].includes(k) ? 'test updated' : ['flaky', 'environment/flaky'].includes(k) ? 'flaky' : 'other');
const fold = (m) => { const o = {}; for (const [k, v] of Object.entries(m || {})) o[causeOf(k)] = (o[causeOf(k)] || 0) + v; return o; };

// Figure 1 (headline): per class — how many tests, what they cost to run, and why they failed on pull requests.
{
  const W = 1180; const rowH = 46; const T = 112; const L = 110;
  const panels = [{ x: L, w: 150, title: 'Tests (both repos)' }, { x: L + 200, w: 150, title: 'Run time, seconds' },
    { x: L + 400, w: 260, title: 'Failed PR CI attempts, by fix' }, { x: L + 730, w: 260, title: 'Failures inside agent sessions, by fix' }];
  let b = text(20, 26, 'The test estate by class: size, run time and why tests failed', 'font-size="15" font-weight="600"')
    + text(20, 46, 'LinearViewer (Harbour) and simple-dispatcher at origin/main, 30 Sep 2026. Unit time: each file run alone. e2e time: CI shard minutes.', 'fill="#666"')
    + text(20, 62, 'CI: every failed PR attempt of the test workflow since 1 June (LinearViewer 3,190 runs; simple-dispatcher 280, CI since 25 July).', 'fill="#666"')
    + text(20, 78, 'Sessions: local transcripts, 30 Jul–30 Sep; deliberate reds, test-first reds and unresolved episodes left out. Failure bars are each class\'s own mix.', 'fill="#666"');
  for (const p of panels) b += text(p.x, T - 12, p.title, 'font-weight="600"');
  const tests = (c) => (A.shape.lv.byClass[c]?.tests || 0) + (A.shape.sd.byClass[c]?.tests || 0);
  const secs = (c) => (c === 'e2e' ? e2eMinutes * 60 : ((A.shape.lv.byClass[c]?.ms || 0) + (A.shape.sd.byClass[c]?.ms || 0)) / 1000);
  const maxT = Math.max(...CLASSES.map(tests)); const maxS = Math.max(...CLASSES.map(secs));
  const SKIP = ['deliberate red', 'new test red (TDD)', 'unknown'];
  const panelData = [
    Object.fromEntries(CLASSES.map((c) => [c, fold(A.ci.pr[c])])),
    Object.fromEntries(CLASSES.map((c) => [c, fold(Object.fromEntries(Object.entries(A.local?.episodes[c] || {}).filter(([k]) => !SKIP.includes(k))))])),
  ];
  CLASSES.forEach((c, i) => {
    const y = T + i * rowH;
    b += text(20, y + 19, c, 'font-weight="600"');
    const t = tests(c); const tw = (panels[0].w * t) / maxT;
    b += rect(panels[0].x, y + 4, tw, 22, '#4575b4', `${c}: ${t} tests`) + text(panels[0].x + tw + 4, y + 19, t.toLocaleString('en-GB'), 'font-size="11"');
    const s = secs(c); const sw = (panels[1].w * s) / maxS;
    b += rect(panels[1].x, y + 4, sw, 22, c === 'e2e' ? '#91bfdb' : '#4575b4', `${c}: ${Math.round(s)} s`) + text(panels[1].x + sw + 4, y + 19, `${Math.round(s)}`, 'font-size="11"');
    panelData.forEach((fails, pi) => {
      const p = panels[2 + pi];
      // Each bar is the class's own mix of causes (100%), labelled with its count.
      const tot = Object.values(fails[c]).reduce((s2, v) => s2 + v, 0);
      let x = p.x;
      for (const k of CAUSES) {
        const v = fails[c][k] || 0; if (!v) continue; const w = (p.w * v) / tot;
        b += rect(x, y + 4, w, 22, CC[k], `${c}: ${k} ${v}`); if (w > 16) b += text(x + 3, y + 19, `${v}`, 'font-size="11" fill="#fff"'); x += w;
      }
      b += text(tot ? p.x + p.w + 4 : p.x, y + 19, tot ? `n=${tot}` : 'none', 'font-size="11" fill="#666"');
    });
  });
  const ly = T + CLASSES.length * rowH + 20;
  b += legend(panels[2].x, ly, CAUSES, CC);
  b += text(20, ly + 22, 'A failed attempt counts once for each class among its failing tests; attempts whose logs expired count under their failing job.', 'font-size="11" fill="#888"');
  writeFileSync(join(outDir, 'by-class.svg'), svg(W, ly + 36, b));
}

// Figure 2: where the unit suites' serial time goes — the slowest files, split into time inside tests and time outside them.
{
  const rows = [...A.timing.lv.slowest.slice(0, 14).map((r) => ({ ...r, repo: 'LinearViewer' })), ...A.timing.sd.slowest.slice(0, 6).map((r) => ({ ...r, repo: 'simple-dispatcher' }))];
  const W = 900; const L = 390; const bw = W - L - 70; const T = 80; const rh = 22;
  const max = Math.max(...rows.map((r) => r.wallMs));
  let b = text(20, 26, 'The slowest unit-test files, each run alone', 'font-size="15" font-weight="600"')
    + text(20, 46, `LinearViewer: ${A.timing.lv.files} files, ${A.timing.lv.serialS} s serial, ${A.timing.lv.testWorkS} s inside tests. simple-dispatcher: ${A.timing.sd.files} files, ${A.timing.sd.serialS} s, ${A.timing.sd.testWorkS} s inside tests.`, 'fill="#666"');
  rows.forEach((r, i) => {
    const y = T + i * rh + (r.repo === 'simple-dispatcher' ? 16 : 0);
    const label = `${r.repo === 'simple-dispatcher' ? 'sd ' : ''}${r.file.split('/').pop().replace(/\.test\.js$/, '')}`;
    b += text(20, y + 14, label.length > 58 ? `${label.slice(0, 56)}…` : label, 'font-size="11"');
    const w1 = (bw * r.testMs) / max; const w2 = (bw * (r.wallMs - r.testMs)) / max;
    b += rect(L, y + 3, w1, 15, '#4575b4', `inside tests ${r.testMs} ms`) + rect(L + w1, y + 3, w2, 15, '#d9d9d9', `outside tests ${r.wallMs - r.testMs} ms`);
    b += text(L + w1 + w2 + 4, y + 14, `${(r.wallMs / 1000).toFixed(1)} s`, 'font-size="11"');
  });
  const ly = T + rows.length * rh + 34;
  b += legend(L, ly, ['inside tests', 'outside tests (start-up, imports, open handles)'], { 'inside tests': '#4575b4', 'outside tests (start-up, imports, open handles)': '#d9d9d9' });
  writeFileSync(join(outDir, 'slowest-files.svg'), svg(W, ly + 16, b));
}

// Figure 3: which classes kill sampled mutants.
{
  // Rows from both LinearViewer draws pool by module and kind; simple-dispatcher's curated mutants are one group.
  const all = Object.entries(A.mutants).flatMap(([key, m]) => m.rows.map((r) => ({ ...r, group: key === 'sd' ? 'simple-dispatcher curated mutants' : `${r.file.replace(/^lib\//, '')} (${r.kind})` })));
  const groups = [...new Set(all.map((r) => r.group))].sort((a, b) => (a.includes('simple-dispatcher') - b.includes('simple-dispatcher')) || (a.includes('prose') - b.includes('prose'))).map((g) => {
    const rs = all.filter((r) => r.group === g);
    const parts = { 'behavioural only': 0, 'behavioural and a pin class': 0, 'pin class only': 0, survived: 0 };
    for (const r of rs) {
      const beh = r.classes.includes('behavioural'); const pin = r.classes.some((c) => ['text pin', 'census', 'source scan'].includes(c));
      parts[!r.killed ? 'survived' : beh && pin ? 'behavioural and a pin class' : beh ? 'behavioural only' : 'pin class only']++;
    }
    return { label: g, n: rs.length, parts };
  });
  const keys = ['behavioural only', 'behavioural and a pin class', 'pin class only', 'survived'];
  const colors = { 'behavioural only': '#4575b4', 'behavioural and a pin class': '#74add1', 'pin class only': '#d73027', survived: '#bbb' };
  const W = 900; const L = 330; const bw = W - L - 40; const T = 70; const rh = 30;
  let b = text(20, 26, 'Which tests kill a mutant: one source edit at a time, whole unit suite', 'font-size="15" font-weight="600"')
    + text(20, 46, 'Logic: an operator flipped. Prose: one line of prompt text deleted. simple-dispatcher: its own curated mutants, unit suite only.', 'fill="#666"');
  groups.forEach((g, i) => {
    const y = T + i * rh; let x = L;
    b += text(20, y + 16, `${g.label}  n=${g.n}`, 'font-size="11"');
    for (const k of keys) { const w = (bw * g.parts[k]) / g.n; if (!w) continue; b += rect(x, y + 4, w, 18, colors[k], `${k}: ${g.parts[k]}`); if (w > 16) b += text(x + 3, y + 17, `${g.parts[k]}`, 'font-size="11" fill="#fff"'); x += w; }
  });
  const ly = T + groups.length * rh + 22;
  b += legend(20, ly, keys, colors);
  writeFileSync(join(outDir, 'mutants.svg'), svg(W, ly + 16, b));
}
console.log(`wrote ${outDir}/by-class.svg, slowest-files.svg, mutants.svg`);
