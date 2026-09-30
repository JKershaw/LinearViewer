// LIN-3156: join the population timeline, the committed consequence and near-miss codes and the merged census into one row per rule (exercised, production changes, tests/wording only, cost), print the paper's tables and draw its SVG charts.
// Usage: node scripts/survey-rules-analyse.mjs [timeline=data/survey/rules-timeline.json] [--sd ../simple-dispatcher] [--figures docs/papers/harbour/figures/which-rules-pay] [--json]
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { census } from './survey-rules-census.mjs';
import { gitCommits } from './survey-rules-timeline.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv.splice(i, 2)[1] : d; };
const sdPath = opt('--sd', '../simple-dispatcher');
const figDir = opt('--figures', 'docs/papers/harbour/figures/which-rules-pay');
const asJson = argv.includes('--json') && argv.splice(argv.indexOf('--json'), 1);
const tl = JSON.parse(readFileSync(argv[0] || 'data/survey/rules-timeline.json', 'utf8'));
const codes = JSON.parse(readFileSync('docs/papers/harbour/which-rules-pay-codes.json', 'utf8'));
const near = JSON.parse(readFileSync('docs/papers/harbour/which-rules-pay-nearmiss.json', 'utf8'));
const rules = census();
const pop = tl.population;
const num = (id) => Number(String(id).split('-')[1]);
const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '–');
const tokens = (bytes) => bytes / 4;

// Poisson 95% interval for a count (exact, via chi-square quantiles approximated by Wilson–Hilferty).
function chi2q(p, k) { if (k <= 0) return 0; const z = p > 0.5 ? 1.959964 : -1.959964; const a = 2 / (9 * k); return k * (1 - a + z * Math.sqrt(a)) ** 3; }
export const poissonCI = (n) => [n === 0 ? 0 : chi2q(0.025, 2 * n) / 2, chi2q(0.975, 2 * (n + 1)) / 2];

// ---- population facts
const repoOf = (t) => (t.repos.length > 1 ? 'both' : t.repos[0]);
const popFacts = {
  n: pop.length, from: pop.at(-1).completedAt, to: pop[0].completedAt,
  repos: pop.reduce((m, t) => ((m[repoOf(t)] = (m[repoOf(t)] || 0) + 1), m), {}),
  active: pop.filter((t) => t.active).length, sendBackTickets: pop.filter((t) => t.sendBacks).length,
  holdTickets: pop.filter((t) => t.holds).length, reviewRounds: pop.reduce((s, t) => s + t.reviewRounds, 0),
  reviewComments: pop.reduce((s, t) => s + t.comments.filter((c) => c.leg === 'review').length, 0),
  closeOutComments: pop.reduce((s, t) => s + t.comments.filter((c) => c.leg === 'close-out').length, 0),
  reviewWords: pop.reduce((s, t) => s + t.comments.filter((c) => c.leg === 'review').reduce((a, c) => a + c.words, 0), 0),
  closeOutWords: pop.reduce((s, t) => s + t.comments.filter((c) => c.leg === 'close-out').reduce((a, c) => a + c.words, 0), 0),
  candidates: tl.candidates, doneScanned: tl.done.length, reviewedScanned: tl.done.filter((d) => d.reviewed).length,
};

// ---- consequences
const codedTickets = new Map(codes.tickets.map((t) => [t.id, t]));
const cons = [];
for (const t of pop) {
  const c = codedTickets.get(t.id);
  if (t.active && !c) throw new Error(`active ticket ${t.id} has no codes`);
  for (const k of c?.consequences || []) cons.push({ ...k, ticket: t.id, repo: repoOf(t) });
}
const classOf = (k) => (k.effect === 'prod' && k.realFault ? 'fault' : k.effect === 'prod' ? 'prod-other' : ['tests', 'docs-wording', 'tooling'].includes(k.effect) ? 'tests-wording' : 'nothing');

// follow-ups a close-out filed: did they later change production code on main (either repo)?
const commits = [...gitCommits('LinearViewer', '.'), ...gitCommits('simple-dispatcher', sdPath)];
const prodBy = new Map();
for (const c of commits) if (c.lines.prod) for (const id of c.ids) prodBy.set(id, (prodBy.get(id) || 0) + c.lines.prod);
const followUpIds = [...new Set(cons.filter((k) => k.effect === 'follow-up').flatMap((k) => k.followUp ? [k.followUp] : []))];

// Coded rounds double-count a round that addressed several findings; scale them to the observed extra legs (review rounds after the first, plus close-out holds).
const roundsObserved = pop.reduce((s, t) => s + Math.max(0, t.reviewRounds - 1) + t.holds, 0);
const roundsCoded = cons.reduce((s, k) => s + (k.rounds || 0), 0);
const roundScale = roundsCoded ? roundsObserved / roundsCoded : 0;

// ---- one row per rule
const ids = [...rules.map((r) => r.id), 'general-judgement'];
const rows = ids.map((id) => {
  const r = rules.find((x) => x.id === id) || { id, name: 'No specific rule: the reviewer read the change and saw it', bytes: 0, templates: ['review'], origin: null, restatements: 0 };
  const primary = cons.filter((k) => k.rules[0] === id);
  const any = cons.filter((k) => k.rules.includes(id));
  const by = (cls) => primary.filter((k) => classOf(k) === cls).length;
  const exT = pop.filter((t) => t.rules?.[id]).length;
  const exC = pop.reduce((s, t) => s + (t.rules?.[id]?.comments || 0), 0);
  const wordsW = pop.reduce((s, t) => s + (t.rules?.[id]?.words || 0), 0);
  // carry: each review / close-out comment is taken as one session that rendered the template once
  const sessions = (r.templates.includes('review') ? popFacts.reviewComments : 0) + (r.templates.includes('close-out') ? popFacts.closeOutComments : 0);
  const rounds = primary.reduce((s, k) => s + (k.rounds || 0), 0);
  const prod = by('fault') + by('prod-other');
  return {
    id, name: r.name, origin: r.origin, restatements: r.restatements, bytes: r.bytes,
    exercisedTickets: id === 'general-judgement' ? null : exT, exercisedComments: id === 'general-judgement' ? null : exC,
    consequences: primary.length, anyConsequences: any.length,
    fault: by('fault'), prodOther: by('prod-other'), prod, prodAny: any.filter((k) => k.effect === 'prod').length, faultAny: any.filter((k) => classOf(k) === 'fault').length, testsWording: by('tests-wording'), nothing: by('nothing'), followUp: primary.filter((k) => k.effect === 'follow-up').length,
    rounds, roundsApportioned: +(rounds * roundScale).toFixed(1), wordsWritten: wordsW, carryTokens: Math.round((r.bytes / 4) * sessions),
    prodPer10kWords: wordsW ? (10000 * prod) / wordsW : null,
    prodCI: poissonCI(prod).map((x) => +x.toFixed(1)),
    reposProd: primary.filter((k) => k.effect === 'prod').reduce((m, k) => ((m[k.repo] = (m[k.repo] || 0) + 1), m), {}),
  };
});

// ---- near misses: escaped defects whose class a rule was written to prevent; did they come after the rule's origin ticket?
const defects = new Map(JSON.parse(readFileSync('docs/papers/harbour/reliability-baseline-defects.json', 'utf8')).verdicts.map((v) => [v.identifier, v]));
const popById = new Map(pop.map((t) => [t.id, t]));
const nearRows = rules.map((r) => {
  const hits = near.codes.filter((c) => c.rules.includes(r.id));
  // "after" = filed after the earliest ticket the rule cites (ticket numbers rise with creation date), so some form of the rule existed
  const first = r.tickets.length ? Math.min(...r.tickets.map(num)) : 0;
  const after = hits.filter((c) => num(c.identifier) > first);
  const residue = after.filter((c) => defects.get(c.identifier)?.residueLabel);
  const shipIn = after.map((c) => defects.get(c.identifier)?.introducedBy).filter((x) => x && popById.has(x));
  return {
    id: r.id, origin: r.origin, defects: hits.length, highConf: hits.filter((c) => c.confidence === 'high').length,
    afterRule: after.length, afterRuleFoundByLaterReview: residue.length, afterRuleOther: after.length - residue.length,
    shippedByPopTicket: shipIn.length, shippedByPopTicketExercised: shipIn.filter((x) => popById.get(x).rules?.[r.id]).length,
    examples: after.filter((c) => !defects.get(c.identifier)?.residueLabel).slice(0, 4).map((c) => c.identifier),
  };
}).filter((x) => x.defects);

const out = { popFacts, rows, nearRows, followUps: { filed: followUpIds.length, laterProd: followUpIds.filter((id) => prodBy.get(id)).length },
  consequenceClasses: cons.reduce((m, k) => ((m[classOf(k)] = (m[classOf(k)] || 0) + 1), m), {}),
  consequencesByRepo: cons.reduce((m, k) => { const o = m[k.repo] || (m[k.repo] = {}); o[classOf(k)] = (o[classOf(k)] || 0) + 1; return m; }, {}),
  lowConfidence: cons.filter((k) => k.confidence === 'low').length, consequencesTotal: cons.length,
  tickets: ['LinearViewer', 'simple-dispatcher', 'both', 'all'].map((repo) => {
    const ts = pop.filter((t) => repo === 'all' || repoOf(t) === repo);
    const has = (f) => ts.filter((t) => cons.some((k) => k.ticket === t.id && f(k))).length;
    return { repo, tickets: ts.length, withProd: has((k) => k.effect === 'prod'), withFault: has((k) => classOf(k) === 'fault'), withAny: has(() => true),
      faults: cons.filter((k) => ts.some((t) => t.id === k.ticket) && classOf(k) === 'fault').length };
  }),
  faultTickets: [...new Set(cons.filter((k) => classOf(k) === 'fault').map((k) => k.ticket))],
  faultRules: cons.filter((k) => classOf(k) === 'fault').reduce((m, k) => ((m[k.rules[0]] = (m[k.rules[0]] || 0) + 1), m), {}),
  faultRulesAny: cons.filter((k) => classOf(k) === 'fault').reduce((m, k) => { for (const r of k.rules) m[r] = (m[r] || 0) + 1; return m; }, {}),
  roundsCoded, roundsObserved,
  effectsByLeg: cons.reduce((m, k) => { const o = m[k.leg] || (m[k.leg] = {}); o[classOf(k)] = (o[classOf(k)] || 0) + 1; return m; }, {}) };

// second read: a blind recode of a 1-in-10 systematic sample of the active tickets
try {
  const second = JSON.parse(readFileSync('docs/papers/harbour/which-rules-pay-second-read.json', 'utf8'));
  out.secondRead = second.samples.flatMap((sample) => sample.tickets.map((s) => ({ ...s, sample: sample.name }))).map((s) => {
    const first = cons.filter((k) => k.ticket === s.id);
    const tally = (ks) => ks.reduce((m, k) => ((m[classOf(k)] = (m[classOf(k)] || 0) + 1), m), {});
    const prodRules = (ks) => [...new Set(ks.filter((k) => k.effect === 'prod').map((k) => k.rules[0]))].sort().join('+') || '–';
    return { sample: s.sample, id: s.id, first: tally(first), second: tally(s.consequences.map((k) => ({ ...k, realFault: k.effect === 'prod' && !!k.realFault }))),
      firstN: first.length, secondN: s.consequences.length, firstProdRules: prodRules(first), secondProdRules: prodRules(s.consequences) };
  });
} catch (e) { if (e.code !== 'ENOENT') throw e; }

if (asJson) { console.log(JSON.stringify(out, null, 1)); process.exit(0); }
if (out.secondRead) { console.log('second read'); for (const s of out.secondRead) console.log(s); }
console.log('population', popFacts);
console.log('consequences', out.consequencesTotal, out.consequenceClasses, 'by repo', out.consequencesByRepo, 'low confidence', out.lowConfidence, 'follow-ups', out.followUps);
const sorted = rows.slice().sort((a, b) => (b.prodPer10kWords ?? -1) - (a.prodPer10kWords ?? -1) || b.prod - a.prod || a.wordsWritten - b.wordsWritten);
console.log('\n| Rule | Earliest cited ticket | Exercised (tickets of 100) | Production changes, as lead rule (real faults) | 95% interval | As any rule (real faults) | Tests, tooling or wording only | Changed nothing here (filed as follow-up) | Extra legs (apportioned) | Words written | Prompt carry (k tokens) | Production changes per 10k words |');
console.log('|---|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|');
for (const r of sorted) console.log(`| ${r.id} | ${r.origin || '–'} | ${r.exercisedTickets ?? '–'} | ${r.prod} (${r.fault}) | ${r.prodCI[0].toFixed(1)}–${r.prodCI[1].toFixed(1)} | ${r.prodAny} (${r.faultAny}) | ${r.testsWording} | ${r.nothing} (${r.followUp}) | ${r.roundsApportioned.toFixed(1)} | ${r.wordsWritten.toLocaleString('en-GB')} | ${Math.round(r.carryTokens / 1000)} | ${r.prodPer10kWords == null ? '–' : r.prodPer10kWords.toFixed(2)} |`);
console.log('\nnear misses'); for (const n of nearRows) console.log(n);

// ---- charts
const C = { ink: '#1f2328', dim: '#667085', grid: '#e5e7eb', bg: '#ffffff', fault: '#b42318', prod: '#0f766e', none: '#98a2b3' };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const txt = (x, y, s, o = {}) => `<text x="${x.toFixed ? x.toFixed(1) : x}" y="${y.toFixed ? y.toFixed(1) : y}" font-size="${o.size || 12}" fill="${o.fill || C.ink}" text-anchor="${o.anchor || 'start'}"${o.weight ? ` font-weight="${o.weight}"` : ''}>${esc(s)}</text>`;
const svg = (w, h, body, title) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" font-family="Inter, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif" role="img" aria-label="${esc(title)}">\n<rect width="${w}" height="${h}" fill="${C.bg}"/>\n${body}\n</svg>\n`;

function scatter() {
  const W = 760, H = 600, x0 = 70, y0 = 80, w = 640, h = 360;
  const pts = rows.filter((r) => r.id !== 'general-judgement');
  const gj = rows.find((r) => r.id === 'general-judgement');
  const xmin = 100, xmax = 10 ** Math.ceil(Math.log10(Math.max(...pts.map((p) => p.wordsWritten), 1000)));
  const ymax = Math.max(4, Math.ceil((Math.max(...pts.map((p) => p.prod)) + 1) / 2) * 2);
  const X = (v) => x0 + (w * (Math.log10(Math.max(v, xmin)) - Math.log10(xmin))) / (Math.log10(xmax) - Math.log10(xmin));
  const Y = (v) => y0 + h - (h * v) / ymax;
  let b = txt(20, 26, 'Cost each rule causes against the production changes it led to', { size: 15, weight: 600 });
  b += txt(20, 46, `Last ${popFacts.n} Done tickets that went through code review, both repos. Cost: words written into review and close-out`, { size: 11.5, fill: C.dim });
  b += txt(20, 61, 'comments exercising the rule. Changes: production-code changes its findings led to, counted under the lead rule.', { size: 11.5, fill: C.dim });
  for (let d = Math.log10(xmin); d <= Math.log10(xmax); d++) { const xv = X(10 ** d); b += `<line x1="${xv}" x2="${xv}" y1="${y0}" y2="${y0 + h}" stroke="${C.grid}"/>` + txt(xv, y0 + h + 18, (10 ** d).toLocaleString('en-GB'), { anchor: 'middle', size: 11, fill: C.dim }); }
  for (let v = 0; v <= ymax; v += ymax > 10 ? 2 : 1) b += `<line x1="${x0}" x2="${x0 + w}" y1="${Y(v)}" y2="${Y(v)}" stroke="${C.grid}"/>` + txt(x0 - 8, Y(v) + 4, v, { anchor: 'end', size: 11, fill: C.dim });
  b += txt(x0 + w / 2, y0 + h + 40, 'Words written exercising the rule (log scale)', { anchor: 'middle', size: 12 });
  b += `<text transform="translate(22 ${y0 + h / 2}) rotate(-90)" font-size="12" fill="${C.ink}" text-anchor="middle">Production-code changes it led to</text>`;
  // labels: greedy vertical nudge so none overlap
  const placed = [];
  for (const p of pts.slice().sort((a, b2) => b2.prod - a.prod || b2.wordsWritten - a.wordsWritten)) {
    const cx = X(p.wordsWritten || xmin), cy = Y(p.prod);
    const col = p.fault ? C.fault : p.prod ? C.prod : C.none;
    b += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="5" fill="${col}" fill-opacity="${p.prod ? 0.9 : 0.6}"/>`;
    if (!p.prod) continue;
    let ly = cy - 8; const lw = p.id.length * 6.2, right = cx + 8 + lw < x0 + w;
    const lx = right ? cx + 8 : cx - 8;
    for (let guard = 0; guard < 40 && placed.some((q) => Math.abs(q.y - ly) < 12 && !(lx + (right ? lw : 0) < q.x0 || lx - (right ? 0 : lw) > q.x1)); guard++) ly -= p.prod ? 12 : -12;
    placed.push({ y: ly, x0: right ? lx : lx - lw, x1: right ? lx + lw : lx });
    b += txt(lx, ly, p.id, { size: 10.5, anchor: right ? 'start' : 'end', fill: p.prod ? C.ink : C.dim });
  }
  b += `<rect x="${x0 + 12}" y="${y0 + 8}" width="300" height="44" fill="#fff7ed" stroke="#fdba74"/>`
    + txt(x0 + 22, y0 + 26, `Not plotted: findings no named rule directed`, { size: 11.5, weight: 600 })
    + txt(x0 + 22, y0 + 43, `${gj.prod} production changes, ${gj.fault} of them real faults`, { size: 11.5 });
  // the rules with no production change are listed rather than labelled, cheapest first
  const zero = pts.filter((p) => !p.prod).sort((a, b2) => a.wordsWritten - b2.wordsWritten).map((p) => p.id);
  const lines = [''];
  for (const z of zero) { const next = lines.at(-1) ? `${lines.at(-1)}, ${z}` : z; if (next.length > 112) lines.push(z); else lines[lines.length - 1] = next; }
  b += txt(20, y0 + h + 66, `Grey dots on the baseline, cheapest first: ${zero.length} rules with no production change`, { size: 11.5, weight: 600 });
  lines.forEach((l, i) => { b += txt(20, y0 + h + 84 + 16 * i, l, { size: 11, fill: C.dim }); });
  const ly = H - 16;
  b += `<circle cx="80" cy="${ly - 4}" r="5" fill="${C.fault}"/>` + txt(90, ly, 'led to at least one fix of a real fault', { size: 11.5 });
  b += `<circle cx="330" cy="${ly - 4}" r="5" fill="${C.prod}"/>` + txt(340, ly, 'production changes, none a real fault', { size: 11.5 });
  b += `<circle cx="580" cy="${ly - 4}" r="5" fill="${C.none}" fill-opacity="0.6"/>` + txt(590, ly, 'no production change', { size: 11.5 });
  return svg(W, H, b, 'Scatter of each review and close-out rule: words written exercising it against production-code changes it led to');
}

function outcomes() {
  // One bar per consequence class, split by the rule that raised it being a named rule or reviewer judgement.
  const W = 800, H = 250, x0 = 300, w = 250, top = 64, bh = 26, gap = 14;
  const cls = [['fault', 'Fixed a real fault in production code', C.fault], ['prod-other', 'Other production-code change', C.prod], ['tests-wording', 'Changed only tests, tooling, docs or wording', '#6941c6'], ['nothing', 'Changed nothing here (dropped, accepted or filed)', C.none]];
  const named = (k) => k.rules[0] !== 'general-judgement';
  const max = Math.max(...cls.map(([c]) => cons.filter((k) => classOf(k) === c).length), 1);
  let b = txt(20, 26, `What the ${cons.length} review and close-out findings changed`, { size: 15, weight: 600 });
  b += txt(20, 46, 'Solid: raised under a named rule. Pale: raised by reviewer judgement with no specific rule behind it.', { size: 11.5, fill: C.dim });
  cls.forEach(([c, label, col], i) => {
    const y = top + i * (bh + gap);
    const a = cons.filter((k) => classOf(k) === c && named(k)).length, g = cons.filter((k) => classOf(k) === c && !named(k)).length;
    b += txt(x0 - 10, y + bh / 2 + 4, label, { anchor: 'end', size: 12 });
    b += `<rect x="${x0}" y="${y}" width="${((w * a) / max).toFixed(1)}" height="${bh}" fill="${col}"/>`;
    b += `<rect x="${(x0 + (w * a) / max).toFixed(1)}" y="${y}" width="${((w * g) / max).toFixed(1)}" height="${bh}" fill="${col}" fill-opacity="0.35"/>`;
    b += txt(x0 + (w * (a + g)) / max + 6, y + bh / 2 + 4, `${a + g} (${a} named rule, ${g} judgement)`, { size: 11.5, fill: C.dim });
  });
  return svg(W, H, b, 'Bars: review and close-out findings by what they changed, split by named rule or reviewer judgement');
}

mkdirSync(figDir, { recursive: true });
writeFileSync(`${figDir}/cost-vs-production-changes.svg`, scatter());
writeFileSync(`${figDir}/what-findings-changed.svg`, outcomes());
console.log(`\nwrote ${figDir}/cost-vs-production-changes.svg, ${figDir}/what-findings-changed.svg`);
