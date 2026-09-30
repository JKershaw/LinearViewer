// LIN-3167: the independent check of why-throughput-halved.md and which-rules-pay.md. Each subcommand prints one of the check's tables.
// Usage (from the repo root, after each paper's own scripts have filled data/):
//   node scripts/survey-check-3.mjs blocks            # the halving paper's measures under other "June" blocks (data/survey-halving/analysis.json)
//   node scripts/survey-check-3.mjs finder            # escapes that are finder rows, by block (data/survey/scorecard.json + reliability-baseline-defects.json)
//   node scripts/survey-check-3.mjs sample <dir>      # draw the blind recode sample and write the coders' packet (digests, rubric, rules) to <dir>
//   node scripts/survey-check-3.mjs agree             # score the committed recode (survey-check-3-codes.json) against which-rules-pay-codes.json
//   node scripts/survey-check-3.mjs earlier [cache]   # fetch a systematic sample of earlier merged Done changes over the local proxy (42 calls, one per 4.5 s)
//   node scripts/survey-check-3.mjs months <timeline> # compare the paper's population with that sample, after survey-rules-timeline.mjs has read the sample
// No proxy calls except `earlier`.
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'fs';

const [cmd, ...rest] = process.argv.slice(2);
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const num = (id) => Number(String(id).split('-')[1]);
const med = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
const CODES = 'docs/papers/harbour/which-rules-pay-codes.json';
const RECODE = 'docs/papers/harbour/survey-check-3-codes.json';
// The paper's own two second-read samples, which the fresh sample skips.
const SECOND_READ = ['LIN-3138', 'LIN-3055', 'LIN-3014', 'LIN-3012', 'LIN-2980', 'LIN-2923', 'LIN-2671', 'LIN-2757',
  'LIN-3131', 'LIN-3035', 'LIN-3022', 'LIN-2812', 'LIN-2787', 'LIN-2838', 'LIN-2623'];

function blocks() {
  const a = read('data/survey-halving/analysis.json');
  const W = new Map(a.weekly.map((w) => [w.week, w]));
  const later = a.weekly.map((w) => w.week).filter((w) => w >= '2026-07-13' && w <= '2026-09-21');
  const B = {
    'paper June (weeks of 8–29 Jun)': ['2026-06-08', '2026-06-15', '2026-06-22', '2026-06-29'],
    'calendar June (weeks of 1–22 Jun)': ['2026-06-01', '2026-06-08', '2026-06-15', '2026-06-22'],
    'wholly June (weeks of 8–22 Jun)': ['2026-06-08', '2026-06-15', '2026-06-22'],
    'before plan-review (weeks of 13–20 Jul)': ['2026-07-13', '2026-07-20'],
    'after plan-review (weeks of 27 Jul–21 Sep)': later.filter((w) => w >= '2026-07-27'),
  };
  const sum = (ws, f) => ws.reduce((s, w) => s + f(W.get(w)), 0);
  const agg = (ws) => {
    const n = ws.length;
    return { good: sum(ws, (w) => w.good) / n, merged: sum(ws, (w) => w.merged) / n, share: sum(ws, (w) => w.good) / sum(ws, (w) => w.merged),
      lv: sum(ws, (w) => w.goodLV) / n, sd: sum(ws, (w) => w.goodSD) / n, ui: sum(ws, (w) => w.byArea?.ui || 0) / n,
      bands: [0, 1, 2, 3].map((i) => sum(ws, (w) => Object.values(w.band)[i]) / n) };
  };
  const L = agg(later);
  console.log(`later (weeks of 13 Jul–21 Sep): ${L.good.toFixed(1)} a week, merged ${L.merged.toFixed(1)}, share ${(100 * L.share).toFixed(1)}%`);
  for (const [name, ws] of Object.entries(B)) {
    const b = agg(ws);
    const r = L.good / b.good; const m = Math.log(L.merged / b.merged) / Math.log(r);
    console.log(`${name.padEnd(36)} ${b.good.toFixed(1)} a week; later ×${r.toFixed(2)}; fewer merged ${Math.round(100 * m)}% of the log fall, share ${Math.round(100 - 100 * m)}%;`
      + ` bands (none/1–49/50–299/300+) ×${b.bands.map((x, i) => (L.bands[i] / x).toFixed(2)).join('/')}; UI ${Math.round((100 * (b.ui - L.ui)) / (b.good - L.good))}% of the loss;`
      + ` Harbour ×${(L.lv / b.lv).toFixed(2)}, simple-dispatcher ×${(L.sd / b.sd).toFixed(2)}`);
  }
}

// A finder row names the ticket whose review found an older fault, not the one that wrote it (survey-check.md, survey-check-2.md).
// Read here from the verdict's own reason text, or its residue label.
const FINDER = /pre-?exist|predat|older code|left out of (its )?scope|out of scope|already (present|existed|broken)|long-standing|older sibling|residue/i;
function finder() {
  const s = read('data/survey/scorecard.json');
  const by = new Map();
  for (const v of read('docs/papers/harbour/reliability-baseline-defects.json').verdicts) {
    if (v.verdict === 'escaped' && v.introducedBy) (by.get(v.introducedBy) || by.set(v.introducedBy, []).get(v.introducedBy)).push(v);
  }
  for (const [name, a, b, weeks] of [['June (8–29 Jun)', '2026-06-08', '2026-06-29', 4], ['Later (13 Jul–21 Sep)', '2026-07-13', '2026-09-21', 11]]) {
    const all = s.changes.filter((c) => c.week >= a && c.week <= b);
    const cs = all.filter((c) => c.done);
    const esc = cs.filter((c) => c.escapes);
    let rows = 0, finderRows = 0, finderOnly = 0, flips = 0;
    for (const c of esc) {
      const vs = by.get(c.id) || [];
      const f = vs.filter((v) => FINDER.test(v.reason) || v.residueLabel);
      rows += vs.length; finderRows += f.length;
      if (vs.length && f.length === vs.length) { finderOnly++; if (!c.namedFix && c.complete) flips++; }
    }
    const good = cs.filter((c) => c.good).length;
    console.log(`${name}: merged ${all.length}, escaped ${esc.length} (${((100 * esc.length) / all.length).toFixed(1)}%); verdict rows ${rows}, finder rows ${finderRows};`
      + ` changes escaped only by finder rows ${finderOnly} (escaped without them ${((100 * (esc.length - finderOnly)) / all.length).toFixed(1)}%);`
      + ` correct, complete ${(good / weeks).toFixed(1)} a week (${((100 * good) / all.length).toFixed(1)}%), without finder rows ${((good + flips) / weeks).toFixed(1)} (${((100 * (good + flips)) / all.length).toFixed(1)}%)`);
  }
}

// Every 2nd coded ticket with a production change and every 8th of the rest, by ticket number, skipping the paper's second reads.
function sample(dir) {
  const coded = read(CODES).tickets.slice().sort((a, b) => num(a.id) - num(b.id)).filter((t) => !SECOND_READ.includes(t.id));
  const hasProd = (t) => t.consequences.some((k) => k.effect === 'prod');
  const pick = [...coded.filter(hasProd).filter((_, i) => i % 2 === 0), ...coded.filter((t) => !hasProd(t)).filter((_, i) => i % 8 === 3)].map((t) => t.id);
  console.log(pick.join(' '));
  if (!dir) return;
  mkdirSync(`${dir}/digests`, { recursive: true });
  for (const id of pick) copyFileSync(`data/survey/rules-digests/${id}.md`, `${dir}/digests/${id}.md`);
  writeFileSync(`${dir}/RUBRIC.md`, readFileSync('data/survey/coding/RUBRIC.md', 'utf8').replace('`data/survey/coding/rules.json`', '`rules.json` (next to this file)'));
  copyFileSync('data/survey/coding/rules.json', `${dir}/rules.json`);
}

const cls = (k) => (k.effect === 'prod' && k.realFault ? 'fault' : k.effect === 'prod' ? 'prod' : ['tests', 'docs-wording', 'tooling'].includes(k.effect) ? 'tests-wording' : 'nothing');
function agree() {
  const P = new Map(read(CODES).tickets.map((t) => [t.id, t.consequences]));
  const R = read(RECODE);
  const readers = { paper: P, ...Object.fromEntries(Object.entries(R.readers).map(([k, v]) => [k, new Map(v.tickets.map((t) => [t.id, t.consequences]))])) };
  const leads = (cs) => { const m = {}; for (const k of cs) if (k.effect === 'prod') m[k.rules[0]] = (m[k.rules[0]] || 0) + 1; return m; };
  for (const [name, m] of Object.entries(readers)) {
    const cs = R.sample.flatMap((id) => m.get(id) || []);
    const prod = cs.filter((k) => k.effect === 'prod'); const faults = prod.filter((k) => k.realFault);
    const any = (r, xs) => xs.filter((k) => k.rules.includes(r)).length;
    const n = (c) => cs.filter((k) => cls(k) === c).length;
    console.log(`${name.padEnd(6)} findings ${cs.length}; production ${prod.length} (faults ${faults.length}); tests or wording ${n('tests-wording')}; nothing ${n('nothing')};`
      + ` low confidence ${cs.filter((k) => k.confidence === 'low').length}; on faults: ledger ${any('ledger', faults)}, class check ${any('class-check', faults)}`);
    console.log(`${''.padEnd(6)} production changes by lead rule: ${Object.entries(leads(cs)).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  }
  const names = Object.keys(readers);
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
    const [x, y] = [readers[names[i]], readers[names[j]]];
    let same = 0, prodSame = 0, faultSame = 0, overlap = 0, px = 0, py = 0;
    for (const id of R.sample) {
      const a = x.get(id) || [], b = y.get(id) || [];
      const la = leads(a), lb = leads(b);
      const pa = a.filter((k) => k.effect === 'prod').length, pb = b.filter((k) => k.effect === 'prod').length;
      px += pa; py += pb;
      if (pa === pb) prodSame++;
      if (a.filter((k) => cls(k) === 'fault').length === b.filter((k) => cls(k) === 'fault').length) faultSame++;
      if (JSON.stringify(Object.entries(la).sort()) === JSON.stringify(Object.entries(lb).sort())) same++;
      for (const r of Object.keys(la)) overlap += Math.min(la[r], lb[r] || 0);
    }
    console.log(`${names[i]} vs ${names[j]}: tickets with the same production count ${prodSame}/${R.sample.length}, same fault count ${faultSame}/${R.sample.length},`
      + ` same lead rules ${same}/${R.sample.length}; production changes whose lead rule both name ${overlap} of ${Math.min(px, py)} (${Math.round((100 * overlap) / Math.min(px, py))}%)`);
  }
}

// A systematic sample of merged Done changes with code, 14 a month, in survey-rules-fetch.mjs's cache shape.
async function earlier(out = 'data/survey/rules-tickets-earlier.json') {
  const B = `${process.env.HARBOUR_LOCAL_BASE}/api/proxy`;
  const s = read('data/survey/scorecard.json');
  const MONTHS = { June: ['2026-06-08', '2026-06-29'], July: ['2026-07-06', '2026-07-27'], August: ['2026-08-03', '2026-08-31'] };
  const months = {};
  for (const [m, [a, b]] of Object.entries(MONTHS)) {
    const cs = s.changes.filter((c) => c.done && c.week >= a && c.week <= b && c.prodLines + c.testLines > 0).sort((x, y) => num(x.id) - num(y.id));
    months[m] = Array.from({ length: 14 }, (_, i) => cs[Math.floor((cs.length / 14) * (i + 0.5))].id);
  }
  const cache = existsSync(out) ? read(out) : { fetchedAt: new Date().toISOString(), list: [], details: {}, months };
  for (const id of Object.values(months).flat()) {
    if (cache.details[id]) continue;
    await new Promise((r) => setTimeout(r, 4500));
    const res = await fetch(`${B}/issues/${id}`);
    if (!res.ok) { cache.details[id] = { missing: true }; continue; }
    const d = await res.json();
    cache.details[id] = {
      title: d.title, createdAt: d.createdAt, completedAt: d.completedAt, state: d.state, labels: d.labels, description: d.description || '',
      comments: (d.comments || []).map((c) => ({ createdAt: c.createdAt, body: c.body || '' })),
      relations: [...(d.relations || []), ...(d.inverseRelations || [])].map((r) => ({ type: r.type, other: r.relatedIssue?.identifier || r.issue?.identifier || null })),
    };
    writeFileSync(out, JSON.stringify(cache));
  }
  writeFileSync(out, JSON.stringify(cache));
  console.log(JSON.stringify(months));
}

// Observable review measures for the paper's population and each earlier month; the earlier timeline comes from
// node scripts/survey-rules-timeline.mjs data/survey/rules-tickets-earlier.json --out <timeline> --digests <dir> --n 1000
function months(timeline, cachePath = 'data/survey/rules-tickets-earlier.json') {
  const pop = read('data/survey/rules-timeline.json').population;
  const early = read(timeline);
  const byMonth = read(cachePath).months;
  const score = new Map(read('data/survey/scorecard.json').changes.map((c) => [c.id, c]));
  const rev = new Map(early.population.map((t) => [t.id, t]));
  const RULES = ['class-check', 'requirements', 'direct-verification', 'mutation-check', 'risk-lanes', 'cannot-close'];
  const row = (name, sampled, ts) => {
    const pct = (f) => `${Math.round((100 * ts.filter(f).length) / Math.max(1, ts.length))}%`;
    const words = ts.reduce((s, t) => s + t.comments.filter((c) => c.leg === 'review').reduce((a, c) => a + c.words, 0), 0) / Math.max(1, ts.length);
    console.log(`${name.padEnd(10)} sampled ${sampled}, reviewed ${ts.length}; active ${pct((t) => t.active)}, sent back ${pct((t) => t.sendBacks)}, held ${pct((t) => t.holds)};`
      + ` review rounds ${(ts.reduce((s, t) => s + t.reviewRounds, 0) / Math.max(1, ts.length)).toFixed(2)}; review words ${Math.round(words)};`
      + ` median production lines ${med(ts.map((t) => score.get(t.id)?.prodLines).filter((x) => x != null))}; touch simple-dispatcher ${pct((t) => t.repos.includes('simple-dispatcher'))};`
      + ` signature matches: ${RULES.map((k) => `${k} ${pct((t) => t.rules?.[k])}`).join(', ')}`);
  };
  row('September', pop.length, pop);
  for (const [m, ids] of Object.entries(byMonth)) row(m, ids.length, ids.map((id) => rev.get(id)).filter(Boolean));
}

const run = { blocks, finder, sample: () => sample(rest[0]), agree, earlier: () => earlier(rest[0]), months: () => months(rest[0], rest[1]) }[cmd];
if (!run) { console.error('usage: node scripts/survey-check-3.mjs blocks|finder|sample <dir>|agree|earlier [cache]|months <timeline> [cache]'); process.exit(1); }
await run();
