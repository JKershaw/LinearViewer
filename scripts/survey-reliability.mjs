// LIN-3149: the reliability baseline — escaped defects per 100 merged PRs by month and repo, routed vs escaped, by ticket size and process depth, plus the git-side series — from the two caches and the committed Bug verdicts.
// Usage: node scripts/survey-reliability.mjs [--github data/survey/reliability-github.json] [--tracker data/survey/reliability-tracker.json] [--depth data/survey/reliability-depth.json] [--verdicts docs/papers/harbour/reliability-baseline-defects.json] [--blockers docs/papers/harbour/reliability-baseline-review-blockers.json] [--json]
import { readFileSync, existsSync, readdirSync } from 'fs';
import { pathToFileURL } from 'url';
import { MONTHS, REPO_LABEL, ticketOf, load, measure } from './survey-reliability-git.mjs';
import { shippedSample } from './survey-reliability-tracker.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const DAY = 86400000;
export const REPOS = ['LinearViewer', 'simple-dispatcher'];
export const ESCAPED = new Set(['escaped']); // product behaviour; 'escaped-test' is reported beside it, not in the headline

// Gate signatures on a comment's first three non-empty lines (after ticket-record-and-quality.md's ordered rules).
const head = (body) => body.split('\n').filter((l) => l.trim()).slice(0, 3).join(' ');
export function gatesOf(comments) {
  const g = new Set();
  for (const { body } of comments) {
    const h = head(body);
    if (/plan[- ]review/i.test(h)) g.add('plan-review');
    else if (/close-?out|closing out|closed out/i.test(h)) g.add('close-out');
    else if (/\b(code )?review\b|\bverdict\b/i.test(h) && !/ready for review|for review\b/i.test(h)) g.add('review');
  }
  return g;
}
export const sizeBucket = (lines) => (lines <= 50 ? '≤50 lines' : lines <= 400 ? '51–400 lines' : '>400 lines');
export const SIZES = ['≤50 lines', '51–400 lines', '>400 lines'];

export function analyse({ github, tracker, dirs, depth, verdicts, blockers }) {
  const details = { ...(depth?.details || {}), ...tracker.details };
  const git = measure({ github, tracker, dirs });
  // Shipped tickets: every ticket a merged PR names, with its repos, first merge and total PR lines.
  const shipped = new Map();
  for (const repo of REPOS) for (const p of github.repos[repo].prs) {
    const t = ticketOf(`${p.title} ${p.headRefName}`); if (!t) continue;
    const s = shipped.get(t) || { repos: new Set(), firstMerge: p.mergedAt, lines: 0, prs: 0 };
    s.repos.add(repo); s.lines += p.additions + p.deletions; s.prs++;
    if (p.mergedAt < s.firstMerge) s.firstMerge = p.mergedAt;
    shipped.set(t, s);
  }
  const prsByMonth = Object.fromEntries(REPOS.map((r) => [r, Object.fromEntries(MONTHS.map((m) => [m, git[r].rows[m].mergedPRs]))]));

  // Bugs: every Bug-labelled ticket, with its verdict and its filing date.
  const bugs = verdicts.verdicts.map((v) => ({ ...v, createdAt: details[v.identifier]?.createdAt || null }));
  const missingDates = bugs.filter((b) => !b.createdAt).map((b) => b.identifier);
  const count = (pred) => bugs.filter(pred).length;
  const tally = {}; for (const b of bugs) tally[b.verdict] = (tally[b.verdict] || 0) + 1;

  // Headline: escaped (product) defects filed in a month, per 100 PRs merged that month, by repo ("both" counts in each repo, once combined).
  const monthly = MONTHS.map((m) => {
    const inM = bugs.filter((b) => b.createdAt?.startsWith(m));
    const row = { month: m, prs: 0, escaped: 0, escapedTest: 0, routed: 0, notDefect: 0, byHuman: 0 };
    for (const r of REPOS) {
      const esc = inM.filter((b) => ESCAPED.has(b.verdict) && (b.repo === r || b.repo === 'both')).length;
      const later = inM.filter((b) => ESCAPED.has(b.verdict) && b.residueLabel && (b.repo === r || b.repo === 'both')).length;
      row[r] = { prs: prsByMonth[r][m], escaped: esc, laterGate: later, per100: prsByMonth[r][m] ? (100 * esc) / prsByMonth[r][m] : null, laterPer100: prsByMonth[r][m] ? (100 * later) / prsByMonth[r][m] : null };
      row.prs += prsByMonth[r][m];
    }
    row.escaped = inM.filter((b) => ESCAPED.has(b.verdict)).length;
    row.escapedTest = inM.filter((b) => b.verdict === 'escaped-test').length;
    row.routed = inM.filter((b) => b.verdict === 'routed').length;
    row.notDefect = inM.filter((b) => b.verdict === 'not-defect').length;
    row.byHuman = inM.filter((b) => ESCAPED.has(b.verdict) && b.foundBy === 'human').length;
    row.byLaterGate = inM.filter((b) => ESCAPED.has(b.verdict) && b.residueLabel).length;
    row.per100 = row.prs ? (100 * row.escaped) / row.prs : null;
    row.unattributedRepo = inM.filter((b) => ESCAPED.has(b.verdict) && !REPOS.includes(b.repo) && b.repo !== 'both').length;
    return row;
  });

  // Attributed escapes: the Bug names the shipped ticket that introduced, exposed or left the fault.
  // Escapes found by a later ticket's review (kind:review-residue) are left out: their introducedBy can name the deferring reviewer, not the author.
  const attributed = bugs.filter((b) => ESCAPED.has(b.verdict) && !b.residueLabel && b.introducedBy && shipped.has(b.introducedBy) && b.createdAt)
    .map((b) => { const s = shipped.get(b.introducedBy); return { ...b, mergeMonth: s.firstMerge.slice(0, 7), lagDays: (Date.parse(b.createdAt) - Date.parse(s.firstMerge)) / DAY, lines: s.lines }; })
    .filter((b) => b.lagDays >= 0);
  const lags = attributed.map((b) => b.lagDays).sort((a, b) => a - b);
  const q = (p) => (lags.length ? lags[Math.min(lags.length - 1, Math.floor(p * lags.length))] : null);

  // Size: attributed escapes per 100 shipped tickets in each size bucket, June–September (the window where PRs name tickets).
  const fleet = [...shipped.entries()].filter(([, s]) => s.firstMerge >= '2026-06');
  const bySize = SIZES.map((k) => {
    const pop = fleet.filter(([, s]) => sizeBucket(s.lines) === k).length;
    const esc = new Set(attributed.filter((b) => b.mergeMonth >= '2026-06' && sizeBucket(b.lines) === k).map((b) => b.introducedBy)).size;
    return { size: k, tickets: pop, withEscape: esc, per100: pop ? (100 * esc) / pop : null };
  });

  // Depth: gates seen in each ticket's comments. Denominator from the systematic sample (every 8th shipped ticket), scaled to the June–September population.
  const inSample = new Set(shippedSample(github)); // the cache also holds introducers fetched by name; only the systematic sample is a denominator
  const sampleIds = Object.keys(depth?.details || {}).filter((id) => inSample.has(id) && shipped.get(id)?.firstMerge >= '2026-06' && !depth.details[id].missing);
  const depthOf = (id) => gatesOf(details[id]?.comments || []).size;
  const sampleDepth = [0, 1, 2, 3].map((d) => sampleIds.filter((id) => depthOf(id) === d).length);
  const introducers = [...new Set(attributed.filter((b) => b.mergeMonth >= '2026-06').map((b) => b.introducedBy))];
  const introDetail = introducers.filter((id) => details[id] && !details[id].missing);
  const byDepth = [0, 1, 2, 3].map((d) => {
    const est = sampleIds.length ? (fleet.length * sampleDepth[d]) / sampleIds.length : 0;
    const esc = introDetail.filter((id) => depthOf(id) === d).length;
    return { gates: d, sample: sampleDepth[d], estTickets: Math.round(est), withEscape: esc, per100: est ? (100 * esc) / est : null };
  });
  const gateMix = {}; for (const id of sampleIds) { const k = [...gatesOf(details[id].comments)].sort().join('+') || 'none'; gateMix[k] = (gateMix[k] || 0) + 1; }

  // Labelling drift: Bug-labelled share of all tickets per 250-number band.
  const bands = {};
  for (const i of tracker.list) { const n = +i.identifier.split('-')[1]; const k = Math.floor(n / 250) * 250; bands[k] ||= { tickets: 0, bug: 0 }; bands[k].tickets++; if (i.labels.includes('Bug')) bands[k].bug++; }

  // Incidents: tickets titled as an incident, plus the records under docs/incidents/.
  const incidents = tracker.list.filter((i) => /\bincident\b/i.test(i.title)).map((i) => ({ id: i.identifier, createdAt: details[i.identifier]?.createdAt || null, title: i.title }));
  const incidentRecords = REPOS.flatMap((r) => { const d = `${dirs[r]}/docs/incidents`; return existsSync(d) ? readdirSync(d).filter((f) => f.endsWith('.md')).map((f) => `${r}: docs/incidents/${f}`) : []; });

  // Review catches: blockers in the send-back reviews of the sampled, review-gated fleet tickets, by class.
  let review = null;
  if (blockers) {
    const reviewed = sampleIds.filter((id) => gatesOf(details[id].comments).has('review')).length;
    const cls = {}; for (const t of blockers.tickets) for (const b of t.blockers) cls[b.class] = (cls[b.class] || 0) + 1;
    const withBug = blockers.tickets.filter((t) => t.blockers.some((b) => b.class === 'bug')).length;
    const bugs = cls.bug || 0;
    // Per 100 reviewed tickets: bugs the review stopped before merge, against bugs its own gate routed and bugs that escaped, on the same tickets' footing.
    const perTicket = blockers.tickets.map((t) => t.blockers.filter((b) => b.class === 'bug').length).sort((x, y) => y - x);
    const withoutTop = reviewed > 1 ? (100 * (bugs - perTicket[0])) / (reviewed - 1) : null;
    const reviewedPop = Math.round((fleet.length * reviewed) / sampleIds.length);
    review = { withoutTopPer100: withoutTop, topTicketBugs: perTicket[0], reviewedPop, estCaughtLow: Math.round((withoutTop / 100) * reviewedPop), sampleFleet: sampleIds.length, reviewed, sentBack: blockers.tickets.filter((t) => t.blockers.length).length, classes: cls, ticketsWithBug: withBug,
      caughtPer100Reviewed: reviewed ? (100 * bugs) / reviewed : null, estCaughtFleet: reviewed ? Math.round((bugs / reviewed) * fleet.length * (reviewed / sampleIds.length)) : null };
  }

  return {
    review,
    tally, total: bugs.length, missingDates, monthly, git: Object.fromEntries(REPOS.map((r) => [r, git[r].rows])),
    attributed: { n: attributed.length, of: count((b) => ESCAPED.has(b.verdict)), lagMedian: q(0.5), lagP25: q(0.25), lagP75: q(0.75), within30: lags.filter((x) => x <= 30).length, byMergeMonth: MONTHS.map((m) => ({ month: m, n: attributed.filter((b) => b.mergeMonth === m).length })) },
    laterGate: count((b) => ESCAPED.has(b.verdict) && b.residueLabel),
    foundBy: { human: count((b) => ESCAPED.has(b.verdict) && b.foundBy === 'human'), agent: count((b) => ESCAPED.has(b.verdict) && b.foundBy === 'agent'), unclear: count((b) => ESCAPED.has(b.verdict) && b.foundBy === 'unclear') },
    bySize, byDepth, depthSample: { n: sampleIds.length, population: fleet.length, gateMix, introducersWithDetail: introDetail.length, introducers: introducers.length },
    bands, incidents, incidentRecords,
  };
}

function print(a) {
  const f = (x) => (x == null ? '–' : x.toFixed(1));
  console.log(`Bug-labelled tickets: ${a.total}; verdicts ${JSON.stringify(a.tally)}; no filing date: ${a.missingDates.length}`);
  console.log('\nEscaped (product) defects filed per month, per 100 merged PRs');
  console.log('month    all: esc/PRs  per100 | LinearViewer (Harbour) | simple-dispatcher | test-only routed not-defect  found-by-human  by-later-gate');
  for (const r of a.monthly) console.log(`${r.month}  ${`${r.escaped}/${r.prs}`.padStart(11)}  ${f(r.per100).padStart(6)} | ${`${r.LinearViewer.escaped}/${r.LinearViewer.prs}`.padStart(8)} ${f(r.LinearViewer.per100).padStart(6)} | ${`${r['simple-dispatcher'].escaped}/${r['simple-dispatcher'].prs}`.padStart(7)} ${f(r['simple-dispatcher'].per100).padStart(6)} | ${String(r.escapedTest).padStart(9)} ${String(r.routed).padStart(6)} ${String(r.notDefect).padStart(10)}  ${String(r.byHuman).padStart(5)}  ${r.byLaterGate}`);
  console.log(`\nAttributed escapes (Bug names the shipped ticket): ${a.attributed.n} of ${a.attributed.of}; lag days median ${f(a.attributed.lagMedian)} (IQR ${f(a.attributed.lagP25)}–${f(a.attributed.lagP75)}), ${a.attributed.within30} within 30 days`);
  console.log('by merge month:', a.attributed.byMergeMonth.map((x) => `${x.month}:${x.n}`).join(' '));
  console.log('found by:', JSON.stringify(a.foundBy), '; found by a later ticket\'s review (kind:review-residue):', a.laterGate);
  console.log('\nBy ticket size (June–September shipped tickets):');
  for (const s of a.bySize) console.log(`  ${s.size.padEnd(13)} ${String(s.withEscape).padStart(3)} of ${s.tickets}  ${f(s.per100)} per 100`);
  console.log(`\nBy process depth (gates seen in comments; sample ${a.depthSample.n} of ${a.depthSample.population}; introducers with detail ${a.depthSample.introducersWithDetail}/${a.depthSample.introducers}):`);
  for (const d of a.byDepth) console.log(`  ${d.gates} gates  sample ${String(d.sample).padStart(3)}  est. ${String(d.estTickets).padStart(4)} tickets  ${d.withEscape} with an attributed escape  ${f(d.per100)} per 100`);
  console.log('  gate mix in sample:', JSON.stringify(a.depthSample.gateMix));
  if (a.review) console.log(`\nReview catches (sample): ${a.review.reviewed} of ${a.review.sampleFleet} sampled fleet tickets reviewed, ${a.review.sentBack} sent back; blockers ${JSON.stringify(a.review.classes)}; ${a.review.ticketsWithBug} tickets had a real-bug blocker; ${a.review.caughtPer100Reviewed?.toFixed(1)} bugs caught per 100 reviewed tickets (${a.review.withoutTopPer100?.toFixed(1)} without the top ticket, which had ${a.review.topTicketBugs}); ≈${a.review.estCaughtLow}–${a.review.estCaughtFleet} across ≈${a.review.reviewedPop} reviewed Jun–Sep tickets`);
    const jf = a.monthly.filter((m) => m.month >= '2026-06'); const esc = jf.reduce((s, m) => s + m.escaped, 0); const rt = jf.reduce((s, m) => s + m.routed, 0);
    console.log(`  Jun–Sep Bugs: ${esc} escaped (product), ${rt} routed; share stopped at review ≈ ${((100 * a.review.estCaughtLow) / (a.review.estCaughtLow + esc + rt)).toFixed(0)}–${((100 * a.review.estCaughtFleet) / (a.review.estCaughtFleet + esc + rt)).toFixed(0)}%`);
  console.log('\nBug label share by ticket-number band:', Object.entries(a.bands).map(([k, v]) => `${k}:${((100 * v.bug) / v.tickets).toFixed(0)}%`).join(' '));
  console.log('\nIncident records:', a.incidentRecords.join(', ') || 'none');
  console.log('Incident-titled tickets:', a.incidents.map((i) => `${i.id} ${i.createdAt?.slice(0, 10)}`).join(', '));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const base = load();
  const depthPath = arg('--depth', 'data/survey/reliability-depth.json');
  const a = analyse({ ...base, depth: existsSync(depthPath) ? readJson(depthPath) : null, verdicts: readJson(arg('--verdicts', 'docs/papers/harbour/reliability-baseline-defects.json')),
    blockers: existsSync(arg('--blockers', 'docs/papers/harbour/reliability-baseline-review-blockers.json')) ? readJson(arg('--blockers', 'docs/papers/harbour/reliability-baseline-review-blockers.json')) : null });
  if (argv.includes('--json')) console.log(JSON.stringify(a, null, 1)); else print(a);
}
