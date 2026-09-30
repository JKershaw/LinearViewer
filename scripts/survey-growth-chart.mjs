// LIN-3147: draw the growth atlas's SVG charts and print its summary numbers from the JSON the other survey-growth-* scripts wrote to data/survey/.
// Usage: node scripts/survey-growth-chart.mjs [dataDir=data/survey] [outDir=docs/papers/harbour/figures/growth-atlas]
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { report as trackerReport } from './survey-growth-tracker.mjs';

const [dataDir = 'data/survey', outDir = 'docs/papers/harbour/figures/growth-atlas'] = process.argv.slice(2);
const load = (f) => JSON.parse(readFileSync(join(dataDir, f), 'utf8'));
const lv = load('git-lv.json').rows, sd = load('git-sd.json').rows;
const ciLv = load('ci-lv.json').rows, ciSd = load('ci-sd.json').rows;
const fleet = load('fleet.json').rows;
const tracker = trackerReport(load('tracker-cache.json')).weeks.filter((r) => r.week >= '2026-01-01');
mkdirSync(outDir, { recursive: true });

// Last complete week: the survey ran on Wednesday 30 September, so the week of 28 September is partial.
const PARTIAL = '2026-09-28';
const complete = (rows) => rows.filter((r) => r.week < PARTIAL);
const X0 = Date.parse('2026-01-01'), X1 = Date.parse('2026-10-01');
const MARKS = [['2026-06-01', 'fleet starts'], ['2026-08-31', '31 Aug step']];
const LV_C = '#1f6feb', SD_C = '#d9480f', GREY = '#6e7781', GREEN = '#2f9e44';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const fmt = (v) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e4 ? `${Math.round(v / 1e3)}k` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}k` : Number.isInteger(v) ? String(v) : v.toFixed(1));

function panel({ x, y, w, h, title, series, yMax }) {
  const pts = series.flatMap((s) => s.points.map((p) => p[1])).filter((v) => v != null);
  const top = yMax ?? Math.max(1, ...pts) * 1.08;
  const px = (d) => x + ((Date.parse(d) - X0) / (X1 - X0)) * w;
  const py = (v) => y + h - (v / top) * h;
  let s = `<g><text x="${x}" y="${y - 8}" class="t">${esc(title)}</text>`;
  s += `<rect x="${x}" y="${y}" width="${w}" height="${h}" class="f"/>`;
  for (const frac of [0.5, 1]) s += `<line x1="${x}" x2="${x + w}" y1="${py(top * frac / 1.08)}" y2="${py(top * frac / 1.08)}" class="g"/><text x="${x - 4}" y="${py(top * frac / 1.08) + 3}" class="a" text-anchor="end">${fmt(top * frac / 1.08)}</text>`;
  for (const [d, label] of MARKS) s += `<line x1="${px(d)}" x2="${px(d)}" y1="${y}" y2="${y + h}" class="m"/>` + (label && y < 80 ? `<text x="${px(d) + 3}" y="${y + 10}" class="a">${label}</text>` : '');
  for (const m of ['2026-02-01', '2026-04-01', '2026-06-01', '2026-08-01', '2026-10-01']) s += `<text x="${px(m)}" y="${y + h + 12}" class="a" text-anchor="middle">${new Date(m).toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })}</text>`;
  series.forEach((sr, i) => {
    const p = sr.points.filter((q) => q[1] != null);
    if (!p.length) return;
    // A gap of more than three weeks with no data (no commits, no logs) is left as a gap, not bridged.
    const d = p.map((q, j) => `${j && Date.parse(q[0]) - Date.parse(p[j - 1][0]) <= 21 * 864e5 ? 'L' : 'M'}${px(q[0]).toFixed(1)},${py(q[1]).toFixed(1)}`).join(' ');
    s += `<path d="${d}" fill="none" stroke="${sr.color}" stroke-width="1.6"${sr.dash ? ' stroke-dasharray="3 2"' : ''}/>`;
    s += `<text x="${x + 4}" y="${y + 12 + i * 11}" class="l" fill="${sr.color}">${esc(sr.label)}</text>`;
  });
  return s + '</g>';
}

function svg(w, h, body, title) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" font-family="Inter, Helvetica, Arial, sans-serif" role="img" aria-label="${esc(title)}">
<style>.t{font-size:12px;font-weight:600;fill:#1f2328}.a{font-size:9px;fill:#57606a}.l{font-size:9.5px;font-weight:600}.f{fill:#fff;stroke:#d0d7de}.g{stroke:#eaeef2}.m{stroke:#8250df;stroke-dasharray:4 3}.h{font-size:15px;font-weight:700;fill:#1f2328}.s{font-size:10.5px;fill:#57606a}</style>
<rect width="100%" height="100%" fill="#fff"/>${body}</svg>\n`;
}

const pt = (rows, f) => rows.map((r) => [r.week, f(r)]);
const nonComment = (r) => r.prodLines - r.prodCommentLines;
// The proxy instructions catalogue lived inside routes/proxy.js until 3 September (LIN-2245), so the
// consistent series leaves it out; its size is reported on its own.
const readingNoCatalogue = (r) => r.readingBytes - (r.reading['proxy instructions'] || 0);
const readingKB = (r) => readingNoCatalogue(r) / 1024;
// Harbour's unit tests got their own job on 6 April; before that one job ran unit and e2e together.
// One pass of the unit suite is the longest unit-test step (LIN-1880 made CI run it twice from 4 September).
const unitMinutes = (r) => r.jobs.find((j) => /^unit tests$/i.test(j.name))?.unitStepMinutes ?? null;
const done = Object.fromEntries(tracker.map((r) => [r.week, r.closed]));

// Figure 1: the atlas — every main series on one time axis.
const PANELS = [
  ['Production lines (non-blank)', [{ label: 'Harbour', color: LV_C, points: pt(lv, (r) => r.prodLines) }, { label: 'simple-dispatcher', color: SD_C, points: pt(sd, (r) => r.prodLines) }]],
  ['Test lines', [{ label: 'Harbour', color: LV_C, points: pt(lv, (r) => r.testLines) }, { label: 'simple-dispatcher', color: SD_C, points: pt(sd, (r) => r.testLines) }]],
  ['Test cases and text pins', [{ label: 'Harbour tests', color: LV_C, points: pt(lv, (r) => r.testCases) }, { label: 'Harbour text pins', color: LV_C, dash: true, points: pt(lv, (r) => r.textPins) }, { label: 'SD tests', color: SD_C, points: pt(sd, (r) => r.testCases) }]],
  ['Comment share of production lines (%)', [{ label: 'Harbour', color: LV_C, points: pt(lv, (r) => 100 * r.prodCommentLines / r.prodLines) }, { label: 'simple-dispatcher', color: SD_C, points: pt(sd, (r) => 100 * r.prodCommentLines / r.prodLines) }], 60],
  ['What agents are told to read (KB)', [{ label: 'Harbour prompts + docs', color: LV_C, points: pt(lv, readingKB) }, { label: 'SD CLAUDE.md + docs', color: SD_C, points: pt(sd, readingKB) }]],
  ['CI minutes, green push to main', [{ label: 'Harbour: one unit-suite pass', color: LV_C, points: pt(ciLv, unitMinutes) }, { label: 'Harbour: whole run, median', color: LV_C, dash: true, points: pt(ciLv, (r) => r.medianRunMinutes) }, { label: 'SD: one unit-suite pass', color: SD_C, points: pt(ciSd, unitMinutes) }]],
  ['Merged PRs per week', [{ label: 'Harbour', color: LV_C, points: pt(complete(lv), (r) => r.mergedPRs) }, { label: 'simple-dispatcher', color: SD_C, points: pt(complete(sd), (r) => r.mergedPRs) }]],
  ['Tickets created and Done per week (tracker)', [{ label: 'created', color: GREY, points: pt(complete(tracker), (r) => r.created) }, { label: 'Done', color: GREEN, points: pt(complete(tracker), (r) => r.closed) }]],
  ['Open pile (tracker)', [{ label: 'not Done, not canceled', color: GREY, points: pt(tracker, (r) => r.openPile) }]],
  ['Comment words per ticket, by creation week (median)', [{ label: 'comments', color: GREY, points: pt(complete(tracker), (r) => r.medianCommentWordsPerTicket) }, { label: 'description', color: GREEN, points: pt(complete(tracker), (r) => r.medianDescWords) }]],
  ['Dispatches per week (fleet, from SD logs)', [{ label: 'fresh sessions', color: SD_C, points: pt(complete(fleet), (r) => r.launch) }, { label: 'follow-up beats', color: SD_C, dash: true, points: pt(complete(fleet), (r) => r.followUp) }]],
  ['Dispatches per Done ticket', [{ label: 'fresh sessions / Done', color: SD_C, points: complete(fleet).map((r) => [r.week, done[r.week] ? r.launch / done[r.week] : null]) }, { label: 'all dispatches / Done', color: SD_C, dash: true, points: complete(fleet).map((r) => [r.week, done[r.week] ? r.harbour / done[r.week] : null]) }]],
];
const COLS = 3, PW = 250, PH = 120, GX = 70, GY = 62, LEFT = 44, TOP = 70;
const rowsN = Math.ceil(PANELS.length / COLS);
const W1 = LEFT + COLS * PW + (COLS - 1) * GX + 20, H1 = TOP + rowsN * (PH + GY) + 20;
let body = `<text x="${LEFT}" y="24" class="h">How Harbour grew, week by week, January to September 2026</text><text x="${LEFT}" y="40" class="s">Both repos (blue Harbour/LinearViewer, orange simple-dispatcher); grey/green the tracker. Weekly, last commit of each ISO week. Dashed purple: fleet starts (1 Jun) and the 31 Aug step.</text>`;
PANELS.forEach(([title, series, yMax], i) => { body += panel({ x: LEFT + (i % COLS) * (PW + GX), y: TOP + Math.floor(i / COLS) * (PH + GY), w: PW, h: PH, title, series, yMax }); });
writeFileSync(join(outDir, 'atlas.svg'), svg(W1, H1, body, 'Growth atlas: small multiples'));

// Figure 2: process weight against delivered product, each indexed to the week of 1 June = 1, log scale.
const at = (rows, wk, f) => { const r = rows.filter((q) => q.week <= wk).at(-1); return r ? f(r) : null; };
const BASE = '2026-06-01';
const cumDone = []; let c = 0; for (const r of tracker) { c += r.closed; cumDone.push({ week: r.week, v: c }); }
const productCode = (r) => nonComment(r) - (r.areas['prompt text'] ? r.areas['prompt text'].lines - r.areas['prompt text'].comments : 0);
const both = (f) => lv.map((r) => ({ week: r.week, v: f(r) + (at(sd, r.week, f) || 0) }));
const INDEX = [
  ['product: non-comment, non-prompt code (both repos)', GREEN, false, both(productCode)],
  ['product: HTTP endpoints (Harbour)', GREEN, true, lv.map((r) => ({ week: r.week, v: r.endpoints }))],
  ['product: tickets Done, cumulative', '#0b7285', false, cumDone],
  ['process: what agents read (both repos)', '#8250df', false, both(readingNoCatalogue)],
  ['process: test lines (both repos)', LV_C, false, both((r) => r.testLines)],
  ['process: text pins (both repos)', LV_C, true, both((r) => r.textPins)],
  ['process: production comment lines (both repos)', SD_C, false, both((r) => r.prodCommentLines)],
];
const W2 = 760, H2 = 430, x2 = 60, y2 = 60, w2 = 440, h2 = 320;
const LOG0 = Math.log(0.2), LOG1 = Math.log(25);
const px2 = (d) => x2 + ((Date.parse(d) - Date.parse('2026-04-01')) / (X1 - Date.parse('2026-04-01'))) * w2;
const py2 = (v) => y2 + h2 - ((Math.log(v) - LOG0) / (LOG1 - LOG0)) * h2;
let b2 = `<text x="${x2}" y="24" class="h">Process weight against delivered product, indexed to the week of 1 June</text><text x="${x2}" y="40" class="s">Log scale; 1 = the week the fleet started. A line above the green ones grew faster than the product did.</text><rect x="${x2}" y="${y2}" width="${w2}" height="${h2}" class="f"/>`;
for (const v of [0.25, 0.5, 1, 2, 4, 8, 16]) b2 += `<line x1="${x2}" x2="${x2 + w2}" y1="${py2(v)}" y2="${py2(v)}" class="g"/><text x="${x2 - 4}" y="${py2(v) + 3}" class="a" text-anchor="end">${v}×</text>`;
b2 += `<line x1="${px2(BASE)}" x2="${px2(BASE)}" y1="${y2}" y2="${y2 + h2}" class="m"/><line x1="${px2('2026-08-31')}" x2="${px2('2026-08-31')}" y1="${y2}" y2="${y2 + h2}" class="m"/>`;
for (const m of ['2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01', '2026-10-01']) b2 += `<text x="${px2(m)}" y="${y2 + h2 + 13}" class="a" text-anchor="middle">${new Date(m).toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })}</text>`;
const endIdx = [];
INDEX.forEach(([label, color, dash, rows], i) => {
  const base = at(rows, BASE, (r) => r.v);
  const p = rows.filter((r) => r.week >= '2026-04-01' && r.v > 0 && base).map((r) => [r.week, r.v / base]);
  if (!p.length) return;
  b2 += `<path d="${p.map((q, j) => `${j ? 'L' : 'M'}${px2(q[0]).toFixed(1)},${py2(Math.max(0.2, q[1])).toFixed(1)}`).join(' ')}" fill="none" stroke="${color}" stroke-width="1.8"${dash ? ' stroke-dasharray="4 2"' : ''}/>`;
  const last = p.at(-1);
  endIdx.push({ label, color, dash, v: last[1] });
});
endIdx.sort((a, b) => b.v - a.v).forEach((e, i) => {
  const ly = y2 + 8 + i * 20;
  b2 += `<line x1="${x2 + w2 + 14}" x2="${x2 + w2 + 32}" y1="${ly}" y2="${ly}" stroke="${e.color}" stroke-width="2"${e.dash ? ' stroke-dasharray="4 2"' : ''}/><text x="${x2 + w2 + 36}" y="${ly + 3}" class="l" fill="${e.color}">${e.v.toFixed(1)}×  ${esc(e.label)}</text>`;
});
writeFileSync(join(outDir, 'process-vs-product.svg'), svg(W2 + 240, H2, b2, 'Process weight against delivered product'));

// Figure 3: where Harbour's production code sits and how fast each area grew in the fleet era.
const first = lv.find((r) => r.week === BASE), last = lv.at(-1);
const areas = Object.keys(last.areas).map((a) => ({ a, from: first.areas[a]?.lines || 0, to: last.areas[a].lines, cmt: last.areas[a].comments })).sort((p, q) => q.to - p.to);
const sdFirst = sd.find((r) => r.week === BASE), sdLast = sd.at(-1);
const sdAreas = Object.keys(sdLast.areas).map((a) => ({ a: `SD: ${a}`, from: sdFirst.areas[a]?.lines || 0, to: sdLast.areas[a].lines, cmt: sdLast.areas[a].comments })).sort((p, q) => q.to - p.to);
const all = [...areas, ...sdAreas];
const W3 = 760, rowH = 22, H3 = 70 + all.length * rowH + 30, bx = 220, bw = 360, maxTo = Math.max(...all.map((r) => r.to));
let b3 = `<text x="20" y="24" class="h">Production lines by area, week of 1 June → week of ${new Date(last.week).toLocaleString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' })}</text><text x="20" y="40" class="s">Grey: lines on 1 June. Bar: lines now, the hatched part comments. Right: growth multiple. Harbour first, then simple-dispatcher (SD).</text>`;
b3 += `<defs><pattern id="hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="4" stroke="#fff" stroke-width="1.5"/></pattern></defs>`;
all.forEach((r, i) => {
  const yy = 60 + i * rowH, col = r.a.startsWith('SD:') ? SD_C : LV_C;
  const wTo = (r.to / maxTo) * bw, wC = (r.cmt / maxTo) * bw, wFrom = (r.from / maxTo) * bw;
  b3 += `<text x="${bx - 8}" y="${yy + 13}" class="l" fill="#1f2328" text-anchor="end">${esc(r.a)}</text>`;
  b3 += `<rect x="${bx}" y="${yy + 3}" width="${wTo.toFixed(1)}" height="14" fill="${col}"/><rect x="${bx + wTo - wC}" y="${yy + 3}" width="${wC.toFixed(1)}" height="14" fill="url(#hatch)"/>`;
  b3 += `<rect x="${bx}" y="${yy + 7}" width="${wFrom.toFixed(1)}" height="6" fill="#adb5bd"/>`;
  b3 += `<text x="${bx + wTo + 6}" y="${yy + 14}" class="a">${fmt(r.to)}  (${r.from ? (r.to / r.from).toFixed(1) + '×' : 'new'})</text>`;
});
writeFileSync(join(outDir, 'areas.svg'), svg(W3, H3, b3, 'Production lines by area'));

// Summary numbers the paper cites.
const summ = (rows, wk, f) => at(rows, wk, f);
const WKS = ['2026-01-05', '2026-03-02', '2026-06-01', '2026-07-06', '2026-08-03', '2026-08-31', '2026-09-21', '2026-09-28'];
console.log('Harbour (git):');
for (const wk of WKS) console.log(`  ${wk} prod=${summ(lv, wk, (r) => r.prodLines)} nonCommentNonPrompt=${summ(lv, wk, productCode)} comments=${summ(lv, wk, (r) => r.prodCommentLines)} test=${summ(lv, wk, (r) => r.testLines)} cases=${summ(lv, wk, (r) => r.testCases)} pins=${summ(lv, wk, (r) => r.textPins)} endpoints=${summ(lv, wk, (r) => r.endpoints)} readingKB=${summ(lv, wk, (r) => Math.round(readingKB(r)))} ${JSON.stringify(summ(lv, wk, (r) => Object.fromEntries(Object.entries(r.reading).map(([k, v]) => [k, Math.round(v / 1024)]))))}`);
console.log('simple-dispatcher (git):');
for (const wk of WKS.filter((w) => w >= '2026-03-02')) console.log(`  ${wk} prod=${summ(sd, wk, (r) => r.prodLines)} nonComment=${summ(sd, wk, nonComment)} comments=${summ(sd, wk, (r) => r.prodCommentLines)} test=${summ(sd, wk, (r) => r.testLines)} cases=${summ(sd, wk, (r) => r.testCases)} pins=${summ(sd, wk, (r) => r.textPins)} readingKB=${summ(sd, wk, (r) => Math.round(readingKB(r)))}`);
console.log('CI, one unit-suite pass (min) / whole-run median:'); for (const wk of WKS) console.log(`  ${wk} LV ${summ(ciLv, wk, unitMinutes)} / ${summ(ciLv, wk, (r) => r.medianRunMinutes)}  SD ${summ(ciSd, wk, unitMinutes)}`);
console.log('index at the last week (1 June = 1):'); for (const e of endIdx) console.log(`  ${e.v.toFixed(2)}× ${e.label}`);
console.log('areas:'); for (const r of all) console.log(`  ${r.a}: ${r.from} → ${r.to} (${r.from ? (r.to / r.from).toFixed(2) : 'new'}×), comments ${r.cmt}`);
const sumBy = (rows, f, from, to) => rows.filter((r) => r.week >= from && r.week < to).reduce((s, r) => s + f(r), 0);
for (const [from, to, label] of [['2026-01-01', '2026-06-01', 'Jan–May'], ['2026-06-01', '2026-08-31', 'Jun–Aug'], ['2026-08-31', PARTIAL, '31 Aug–27 Sep']]) {
  const weeks = tracker.filter((r) => r.week >= from && r.week < to).length;
  console.log(`${label}: ${weeks} weeks; created=${sumBy(tracker, (r) => r.created, from, to)} done=${sumBy(tracker, (r) => r.closed, from, to)} LV PRs=${sumBy(lv, (r) => r.mergedPRs, from, to)} SD PRs=${sumBy(sd, (r) => r.mergedPRs, from, to)} launches=${sumBy(fleet, (r) => r.launch, from, to)} followUps=${sumBy(fleet, (r) => r.followUp, from, to)}`);
}
console.log('tracker weeks:'); for (const r of tracker) console.log(`  ${r.week} created=${r.created} done=${r.closed} open=${r.openPile} descW=${r.medianDescWords} commentW=${r.medianCommentWordsPerTicket} posted=${r.commentWordsPosted} n=${r.sampleCreated} launches=${fleet.find((f) => f.week === r.week)?.launch ?? '-'} all=${fleet.find((f) => f.week === r.week)?.harbour ?? '-'}`);

// What shrinks, and where a series levels off: weekly declines, and mean weekly change per period.
const SERIES = [
  ['LV prod lines', lv, (r) => r.prodLines], ['LV non-comment non-prompt', lv, productCode], ['LV comment lines', lv, (r) => r.prodCommentLines],
  ['LV test lines', lv, (r) => r.testLines], ['LV test cases', lv, (r) => r.testCases], ['LV text pins', lv, (r) => r.textPins], ['LV endpoints', lv, (r) => r.endpoints],
  ['LV reading (excl. catalogue)', lv, readingNoCatalogue], ['LV CLAUDE.md', lv, (r) => r.reading['CLAUDE.md']], ['LV worker templates', lv, (r) => r.reading['worker templates']], ['LV meta-prompt', lv, (r) => r.reading['meta-prompt']],
  ['SD prod lines', sd, (r) => r.prodLines], ['SD comment lines', sd, (r) => r.prodCommentLines], ['SD test lines', sd, (r) => r.testLines], ['SD text pins', sd, (r) => r.textPins], ['SD reading', sd, (r) => r.readingBytes],
];
console.log('declines and weekly change (mean per week: Jan–May | Jun–Aug | 31 Aug on):');
for (const [name, rows, f] of SERIES) {
  const drops = [];
  for (let i = 1; i < rows.length; i++) { const d = f(rows[i]) - f(rows[i - 1]); if (d < 0) drops.push([rows[i].week, d]); }
  const per = (a, b) => { const x = rows.filter((r) => r.week >= a && r.week < b); if (x.length < 2) return '-'; const i0 = rows.indexOf(x[0]); const prev = i0 ? rows[i0 - 1] : x[0]; return Math.round((f(x.at(-1)) - f(prev)) / x.length); };
  const worst = drops.sort((a, b) => a[1] - b[1])[0];
  console.log(`  ${name.padEnd(28)} declining weeks=${drops.length}${worst ? ` (largest ${worst[1]} in ${worst[0]})` : ''}; ${per('2026-01-01', '2026-06-01')} | ${per('2026-06-01', '2026-08-31')} | ${per('2026-08-31', '2026-10-05')}`);
}

console.log('areas, mean lines added per week: Jan–May | Jun–Aug | 31 Aug on:');
for (const [repoName, rows] of [['LV', lv], ['SD', sd]]) for (const a of Object.keys(rows.at(-1).areas)) {
  const f = (r) => r.areas[a]?.lines || 0;
  const per = (x0, x1) => { const x = rows.filter((r) => r.week >= x0 && r.week < x1); if (x.length < 2) return '-'; const i0 = rows.indexOf(x[0]); return Math.round((f(x.at(-1)) - f(i0 ? rows[i0 - 1] : x[0])) / x.length); };
  console.log(`  ${repoName} ${a.padEnd(26)} ${per('2026-01-01', '2026-06-01')} | ${per('2026-06-01', '2026-08-31')} | ${per('2026-08-31', '2026-10-05')}`);
}
